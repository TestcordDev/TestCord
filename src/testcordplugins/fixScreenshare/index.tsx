/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { FluxDispatcher, showToast, Toasts } from "@webpack/common";

const logger = new Logger("FixScreenshare");

let origReload: (() => void) | undefined;
let origAssign: ((url: string) => void) | undefined;
let origReplace: ((url: string) => void) | undefined;
let origHrefDescriptor: PropertyDescriptor | undefined;
let origGo: ((delta?: number) => void) | undefined;
let preventMediaError: ((event: ErrorEvent) => void) | null = null;
let preventMediaRejection: ((event: PromiseRejectionEvent) => void) | null = null;
let origConsoleError: typeof console.error | null = null;
let suppressTimer: ReturnType<typeof setTimeout> | undefined;
let suppressReload = false;
let streaming = false;
let inVoiceChannel = false;

const onVoiceChannelSelect = ({ channelId }: { channelId: string | null }) => {
    if (channelId) {
        inVoiceChannel = true;
        armSuppress();
    } else {
        inVoiceChannel = false;
        if (!streaming) {
            clearTimeout(suppressTimer);
            suppressTimer = setTimeout(() => suppressReload = false, 5000);
        }
    }
};

const onStreamStart = () => {
    streaming = true;
    armSuppress();
};

const onStreamStop = () => {
    streaming = false;
    if (!inVoiceChannel) {
        clearTimeout(suppressTimer);
        suppressTimer = setTimeout(() => suppressReload = false, 5000);
    }
};

const onRtcConnectionState = () => {
    armSuppress();
};

const onAudioReset = () => {
    armSuppress();
};

const onStreamViewerCountUpdate = () => {
    armSuppress();
};

function armSuppress(ms = 6000) {
    suppressReload = true;
    clearTimeout(suppressTimer);
    if (!streaming && !inVoiceChannel) {
        suppressTimer = setTimeout(() => suppressReload = false, ms);
    }
}

function isMediaErrorMsg(msg: string) {
    return msg.includes("RTCPeerConnection")
        || msg.includes("getUserMedia")
        || msg.includes("getDisplayMedia")
        || msg.includes("MediaStream")
        || msg.includes("setVideoCapturerSource")
        || msg.includes("reconfigure")
        || msg.includes("ICE")
        || msg.includes("AVError")
        || msg.includes("NoiseCanceller")
        || msg.includes("screenshare")
        || msg.includes("screen share")
        || msg.includes("ScreenShare")
        || msg.includes("Request has been terminated")
        || msg.includes("crossDomainError")
        || msg.includes("Krisp")
        || msg.includes("krisp")
        || msg.includes("NoiseCancellation");
}

const CRASH_LOG_KEY = "vc_fixScreenshare_log";

function logErrorSync(source: string, error: any) {
    try {
        const entry = JSON.stringify({
            source,
            message: error?.message ?? String(error),
            stack: error?.stack ?? "",
            time: Date.now()
        });
        const existing = localStorage.getItem(CRASH_LOG_KEY);
        const log = existing ? JSON.parse(existing) : [];
        log.push(entry);
        localStorage.setItem(CRASH_LOG_KEY, JSON.stringify(log.slice(-10)));
    } catch { }
}

export default definePlugin({
    name: "FixScreenshare",
    description: "Prevents Discord from crashing and reloading when screensharing by intercepting media-related errors and blocking reloads.",
    tags: ["Performance", "Voice"],
    authors: [{ name: "x2b", id: 0n }],
    required: true,

    patches: [],

    start() {
        // Report any errors from the previous session
        try {
            const raw = localStorage.getItem(CRASH_LOG_KEY);
            if (raw) {
                localStorage.removeItem(CRASH_LOG_KEY);
                const log = JSON.parse(raw);
                if (log.length > 0) {
                    const entries = log.map((e: string) => JSON.parse(e));
                    for (const entry of entries) {
                        logger.warn(`Previous crash: [${entry.source}] ${entry.message}`);
                        if (entry.stack) logger.warn(`Stack: ${entry.stack}`);
                    }
                    const last = entries[entries.length - 1];
                    showToast(`Stream crash cause: ${last.message}`, Toasts.Type.FAILURE);
                }
            }
        } catch { }

        FluxDispatcher.subscribe("VOICE_CHANNEL_SELECT", onVoiceChannelSelect);
        FluxDispatcher.subscribe("STREAM_START", onStreamStart);
        FluxDispatcher.subscribe("STREAM_STOP", onStreamStop);
        FluxDispatcher.subscribe("RTC_CONNECTION_STATE", onRtcConnectionState);
        FluxDispatcher.subscribe("AUDIO_RESET", onAudioReset);
        FluxDispatcher.subscribe("STREAM_VIEWER_COUNT_UPDATE", onStreamViewerCountUpdate);

        // Use addEventListener so Discord's own window.onerror still runs.
        // event.preventDefault() prevents window.onerror from firing,
        // so we can intercept media errors before Discord's handler sees them.
        preventMediaError = function (event) {
            const msg = event.message ?? "";
            const err = event.error;
            const isMedia = isMediaErrorMsg(msg) || (err?.message && isMediaErrorMsg(err.message));
            if (!isMedia) return;
            logErrorSync("error", err ?? msg);
            event.preventDefault();
            if (suppressReload) armSuppress(3000);
        };
        window.addEventListener("error", preventMediaError);

        preventMediaRejection = function (event) {
            const msg = event.reason?.message ?? String(event.reason);
            if (!isMediaErrorMsg(msg)) return;
            logErrorSync("unhandledRejection", event.reason);
            event.preventDefault();
        };
        window.addEventListener("unhandledrejection", preventMediaRejection);

        // Discord's FluxDispatcher catches exceptions in handlers and logs them
        // via console.error. Intercept to capture those too.
        origConsoleError = console.error;
        console.error = function (...args: any[]) {
            const msg = args.map(a => String(a)).join(" ");
            if (isMediaErrorMsg(msg)) {
                logErrorSync("console.error", args[0]);
            }
            return origConsoleError!.apply(console, args);
        };

        try {
            const proto = Object.getPrototypeOf(window.location) as any;

            origReload = proto.reload.bind(window.location);
            proto.reload = function () {
                if (suppressReload) return;
                return origReload!();
            };

            origAssign = proto.assign.bind(window.location);
            proto.assign = function (url: string) {
                if (suppressReload && (!url || url === window.location.href)) return;
                return origAssign!(url);
            };

            origReplace = proto.replace.bind(window.location);
            proto.replace = function (url: string) {
                if (suppressReload && (!url || url === window.location.href)) return;
                return origReplace!(url);
            };

            origHrefDescriptor = Object.getOwnPropertyDescriptor(proto, "href");
            if (origHrefDescriptor?.set) {
                Object.defineProperty(proto, "href", {
                    get: origHrefDescriptor.get,
                    set(url: string) {
                        if (suppressReload && (!url || url === window.location.href)) return;
                        origHrefDescriptor!.set!.call(this, url);
                    },
                    configurable: true
                });
            }
        } catch { }

        // history.go(0) is an alternate way to reload
        try {
            origGo = history.go.bind(history);
            history.go = function (delta?: number) {
                if (suppressReload && (delta === undefined || delta === 0)) return;
                return origGo!(delta);
            };
        } catch { }
    },

    stop() {
        FluxDispatcher.unsubscribe("VOICE_CHANNEL_SELECT", onVoiceChannelSelect);
        FluxDispatcher.unsubscribe("STREAM_START", onStreamStart);
        FluxDispatcher.unsubscribe("STREAM_STOP", onStreamStop);
        FluxDispatcher.unsubscribe("RTC_CONNECTION_STATE", onRtcConnectionState);
        FluxDispatcher.unsubscribe("AUDIO_RESET", onAudioReset);
        FluxDispatcher.unsubscribe("STREAM_VIEWER_COUNT_UPDATE", onStreamViewerCountUpdate);
        clearTimeout(suppressTimer);
        suppressReload = false;
        streaming = false;
        inVoiceChannel = false;
        if (preventMediaError) {
            window.removeEventListener("error", preventMediaError);
            preventMediaError = null;
        }
        if (preventMediaRejection) {
            window.removeEventListener("unhandledrejection", preventMediaRejection);
            preventMediaRejection = null;
        }
        if (origConsoleError) {
            console.error = origConsoleError;
            origConsoleError = null;
        }
        try {
            const proto = Object.getPrototypeOf(window.location) as any;
            if (origReload) { proto.reload = origReload; origReload = undefined; }
            if (origAssign) { proto.assign = origAssign; origAssign = undefined; }
            if (origReplace) { proto.replace = origReplace; origReplace = undefined; }
            if (origHrefDescriptor) {
                Object.defineProperty(proto, "href", origHrefDescriptor);
                origHrefDescriptor = undefined;
            }
        } catch { }
        try {
            if (origGo) { history.go = origGo; origGo = undefined; }
        } catch { }
    }
});
