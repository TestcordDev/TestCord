/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
const logger = new Logger("WebCordHardened");
const DISCORD_HOSTS = [
    "discord.com",
    "discordapp.com",
    "discordapp.net",
    "discord.gg",
    "discord.media"
];
const SAFE_EXTERNAL_PROTOCOLS = new Set(["https:", "http:", "mailto:", "tel:", "sms:"]);
const settings = definePluginSettings({
    blockTelemetry: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Block Discord telemetry endpoints.",
        default: true,
    },
    blockSentry: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Block Sentry crash reporting requests.",
        default: true,
    },
    blockFingerprinting: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Block known browser fingerprinting endpoints.",
        default: true,
    },
    webRtcIcePolicy: {
        type: 4 /* OptionType.SELECT */,
        description: "Choose how WebRTC connections reveal network routes.",
        options: [
            { label: "Relay only", value: "relay", default: true },
            { label: "Public", value: "all" },
        ],
    },
    allowDeviceEnumeration: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Allow Discord to list media devices.",
        default: false,
    },
    blockNotifications: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Block notification permission prompts.",
        default: true,
    },
    blockUnsafeExternalProtocols: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Block unsafe external link protocols.",
        default: true,
    },
    hideDownloadNag: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Hide Discord desktop download prompts.",
        default: true,
    },
    logBlockedRequests: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Log blocked privacy requests.",
        default: false,
    },
    warnOnIcePolicyOverride: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Warn when Discord tries to change the WebRTC ICE policy away from the configured value.",
        default: false,
    },
});
let originalFetch = null;
let originalXhrOpen = null;
let originalXhrSend = null;
let originalSendBeacon = null;
let originalWindowOpen = null;
let originalEnumerateDevices = null;
let originalNotificationRequestPermission = null;
let originalNotificationPermissionDescriptor;
let originalConnections = [];
const blockedXhrUrls = new WeakMap();
function matchesHost(hostname, root) {
    return hostname === root || hostname.endsWith(`.${root}`);
}
function isDiscordHost(hostname) {
    return DISCORD_HOSTS.some(root => matchesHost(hostname, root));
}
function getUrl(input) {
    const rawUrl = input instanceof Request ? input.url : String(input);
    try {
        return new URL(rawUrl, location.href);
    }
    catch (error) {
        if (settings.store.logBlockedRequests)
            logger.warn("Could not parse request URL.", error);
        return null;
    }
}
function getBlockedRequestKind(url) {
    if (!url)
        return null;
    const path = url.pathname;
    if (settings.store.blockTelemetry && isDiscordHost(url.hostname) && (path.endsWith("/science") ||
        path.endsWith("/track") ||
        path.endsWith("/tracing"))) {
        return "telemetry";
    }
    if (settings.store.blockSentry && (matchesHost(url.hostname, "sentry.io") ||
        (path.includes("/assets/sentry.") && path.endsWith(".js")))) {
        return "sentry";
    }
    if (settings.store.blockFingerprinting && (path.startsWith("/cdn-cgi/") ||
        (path.endsWith("/api.js") && !url.hostname.endsWith(".hcaptcha.com")))) {
        return "fingerprinting";
    }
    return null;
}
function logBlocked(kind, url) {
    if (!settings.store.logBlockedRequests)
        return;
    logger.info(`Blocked ${kind}: ${url.hostname}${url.pathname}`);
}
function patchFetch() {
    if (originalFetch)
        return;
    originalFetch = window.fetch;
    window.fetch = (input, init) => {
        const url = getUrl(input);
        const blockedKind = getBlockedRequestKind(url);
        if (blockedKind && url) {
            logBlocked(blockedKind, url);
            return Promise.resolve(new Response(null, {
                status: 204,
                statusText: "Blocked by WebCordHardened",
            }));
        }
        return originalFetch.call(window, input, init);
    };
}
function patchXhr() {
    if (originalXhrOpen || originalXhrSend)
        return;
    originalXhrOpen = XMLHttpRequest.prototype.open;
    originalXhrSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, urlLike, async = true, username, password) {
        const url = getUrl(urlLike);
        const blockedKind = getBlockedRequestKind(url);
        if (blockedKind && url) {
            logBlocked(blockedKind, url);
            const blobUrl = URL.createObjectURL(new Blob([""], { type: "text/plain" }));
            blockedXhrUrls.set(this, blobUrl);
            return originalXhrOpen.call(this, "GET", blobUrl, async, username, password);
        }
        return originalXhrOpen.call(this, method, urlLike, async, username, password);
    };
    XMLHttpRequest.prototype.send = function (body) {
        const blockedUrl = blockedXhrUrls.get(this);
        if (!blockedUrl)
            return originalXhrSend.call(this, body);
        this.addEventListener("loadend", () => {
            URL.revokeObjectURL(blockedUrl);
            blockedXhrUrls.delete(this);
        }, { once: true });
        return originalXhrSend.call(this, null);
    };
}
function patchBeacon() {
    if (originalSendBeacon || typeof navigator.sendBeacon !== "function")
        return;
    originalSendBeacon = navigator.sendBeacon;
    navigator.sendBeacon = function (urlLike, data) {
        const url = getUrl(urlLike);
        const blockedKind = getBlockedRequestKind(url);
        if (blockedKind && url) {
            logBlocked(blockedKind, url);
            return true;
        }
        return originalSendBeacon.call(this, urlLike, data);
    };
}
function patchMediaDevices() {
    const { mediaDevices } = navigator;
    if (!mediaDevices)
        return;
    if (!originalEnumerateDevices && typeof mediaDevices.enumerateDevices === "function") {
        originalEnumerateDevices = mediaDevices.enumerateDevices;
        mediaDevices.enumerateDevices = function () {
            if (!settings.store.allowDeviceEnumeration)
                return Promise.resolve([]);
            return originalEnumerateDevices.call(this);
        };
    }
}
function patchNotifications() {
    if (typeof Notification === "undefined" || originalNotificationRequestPermission)
        return;
    originalNotificationRequestPermission = Notification.requestPermission;
    originalNotificationPermissionDescriptor = Object.getOwnPropertyDescriptor(Notification, "permission");
    Notification.requestPermission = (deprecatedCallback) => {
        if (!settings.store.blockNotifications) {
            return originalNotificationRequestPermission.call(Notification, deprecatedCallback);
        }
        deprecatedCallback?.("denied");
        return Promise.resolve("denied");
    };
    Object.defineProperty(Notification, "permission", {
        configurable: true,
        get() {
            if (settings.store.blockNotifications)
                return "denied";
            const getter = originalNotificationPermissionDescriptor?.get;
            if (getter)
                return getter.call(Notification);
            return originalNotificationPermissionDescriptor?.value ?? "default";
        },
    });
}
function isSafeWindowOpenUrl(urlLike) {
    if (!urlLike)
        return true;
    const url = getUrl(urlLike);
    if (!url)
        return false;
    if (url.origin === location.origin)
        return true;
    return SAFE_EXTERNAL_PROTOCOLS.has(url.protocol);
}
function patchWindowOpen() {
    if (originalWindowOpen)
        return;
    originalWindowOpen = window.open;
    window.open = function (url, target, features) {
        if (settings.store.blockUnsafeExternalProtocols && !isSafeWindowOpenUrl(url)) {
            if (settings.store.logBlockedRequests)
                logger.warn("Blocked unsafe external link.", url);
            return null;
        }
        return originalWindowOpen.call(this, url, target, features);
    };
}
function getWebRtcConfiguration(configuration) {
    if (settings.store.webRtcIcePolicy !== "relay")
        return configuration;
    return {
        ...configuration,
        iceTransportPolicy: "relay",
    };
}
function createPatchedConnection(OriginalConnection) {
    return class extends OriginalConnection {
        constructor(configuration) {
            super(getWebRtcConfiguration(configuration));
        }
        setConfiguration(configuration) {
            if (settings.store.warnOnIcePolicyOverride &&
                settings.store.webRtcIcePolicy === "relay" &&
                configuration?.iceTransportPolicy &&
                configuration.iceTransportPolicy !== "relay") {
                logger.warn(`Discord tried to set iceTransportPolicy to "${configuration.iceTransportPolicy}", forcing "relay".`);
            }
            super.setConfiguration(getWebRtcConfiguration(configuration));
        }
    };
}
function patchWebRtc() {
    if (originalConnections.length)
        return;
    if (typeof RTCPeerConnection !== "undefined") {
        originalConnections.push({ name: "RTCPeerConnection", ctor: RTCPeerConnection });
        window.RTCPeerConnection = createPatchedConnection(RTCPeerConnection);
    }
    const win = window;
    if (typeof win.webkitRTCPeerConnection !== "undefined") {
        originalConnections.push({ name: "webkitRTCPeerConnection", ctor: win.webkitRTCPeerConnection });
        win.webkitRTCPeerConnection = createPatchedConnection(win.webkitRTCPeerConnection);
    }
}
function setHideNag() {
    if (!settings.store.hideDownloadNag)
        return;
    try {
        localStorage.setItem("hideNag", "true");
    }
    catch (error) {
        logger.warn("Could not hide Discord download prompts.", error);
    }
}
function restoreNetwork() {
    if (originalFetch) {
        window.fetch = originalFetch;
        originalFetch = null;
    }
    if (originalXhrOpen) {
        XMLHttpRequest.prototype.open = originalXhrOpen;
        originalXhrOpen = null;
    }
    if (originalXhrSend) {
        XMLHttpRequest.prototype.send = originalXhrSend;
        originalXhrSend = null;
    }
    if (originalSendBeacon) {
        navigator.sendBeacon = originalSendBeacon;
        originalSendBeacon = null;
    }
}
function restorePermissions() {
    const { mediaDevices } = navigator;
    if (mediaDevices && originalEnumerateDevices) {
        mediaDevices.enumerateDevices = originalEnumerateDevices;
        originalEnumerateDevices = null;
    }
    if (typeof Notification !== "undefined" && originalNotificationRequestPermission) {
        Notification.requestPermission = originalNotificationRequestPermission;
        originalNotificationRequestPermission = null;
        if (originalNotificationPermissionDescriptor) {
            Object.defineProperty(Notification, "permission", originalNotificationPermissionDescriptor);
        }
        else {
            Reflect.deleteProperty(Notification, "permission");
        }
    }
}
function restoreWindowOpen() {
    if (!originalWindowOpen)
        return;
    window.open = originalWindowOpen;
    originalWindowOpen = null;
}
function restoreWebRtc() {
    if (!originalConnections.length)
        return;
    const win = window;
    for (const { name, ctor } of originalConnections) {
        if (name === "webkitRTCPeerConnection") {
            win.webkitRTCPeerConnection = ctor;
        }
        else {
            window.RTCPeerConnection = ctor;
        }
    }
    originalConnections = [];
}
export default definePlugin({
    name: "WebCordHardened",
    description: "Adds WebCord privacy hardening with network, permission, and WebRTC protections.",
    tags: ["Privacy", "Utility", "Voice"],
    authors: [{ name: "irritably", id: 928787166916640838n }],
    settings,
    startAt: "Init" /* StartAt.Init */,
    start() {
        patchFetch();
        patchXhr();
        patchBeacon();
        patchMediaDevices();
        patchNotifications();
        patchWindowOpen();
        patchWebRtc();
        setHideNag();
    },
    stop() {
        restoreNetwork();
        restorePermissions();
        restoreWindowOpen();
        restoreWebRtc();
    },
});
