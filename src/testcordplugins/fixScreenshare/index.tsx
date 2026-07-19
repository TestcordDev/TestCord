/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";
import { FluxDispatcher } from "@webpack/common";

let origReload: (() => void) | undefined;
let origAssign: ((url: string) => void) | undefined;
let origReplace: ((url: string) => void) | undefined;
let origHrefDescriptor: PropertyDescriptor | undefined;
let oldOnError: OnErrorEventHandler | null = null;
let oldOnUnhandledRejection: ((event: PromiseRejectionEvent) => void) | null = null;
let preventMediaRejection: ((event: PromiseRejectionEvent) => void) | null = null;
let suppressTimer: ReturnType<typeof setTimeout> | undefined;
let suppressReload = false;

function armSuppress(ms = 6000) {
    suppressReload = true;
    clearTimeout(suppressTimer);
    suppressTimer = setTimeout(() => suppressReload = false, ms);
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

export default definePlugin({
    name: "FixScreenshare",
    description: "Prevents Discord from crashing and reloading when screensharing by stabilizing the media engine and intercepting media-related errors.",
    tags: ["Performance", "Voice"],
    authors: [{ name: "Nightcord", id: 0n }, { name: "x2b", id: 0n }],
    required: false,

    start() {
        FluxDispatcher.subscribe("VOICE_CHANNEL_SELECT", () => {
            armSuppress(10000);
        });
        FluxDispatcher.subscribe("STREAM_START", () => {
            armSuppress(10000);
        });
        FluxDispatcher.subscribe("STREAM_STOP", () => { });
        FluxDispatcher.subscribe("RTC_CONNECTION_STATE", () => {
            armSuppress(10000);
        });
        FluxDispatcher.subscribe("STREAM_VIEWER_COUNT_UPDATE", () => {
            armSuppress(10000);
        });

        oldOnError = window.onerror;
        window.onerror = function (event, source, lineno, colno, error) {
            const msg = typeof event === "string" ? event : "";
            if (isMediaErrorMsg(msg) || error?.message && isMediaErrorMsg(error.message)) {
                if (suppressReload) armSuppress(3000);
                return true;
            }
            if (oldOnError) return oldOnError(event, source, lineno, colno, error);
            return false;
        };

        oldOnUnhandledRejection = window.onunhandledrejection;
        preventMediaRejection = function (event) {
            const msg = event.reason?.message ?? String(event.reason);
            if (isMediaErrorMsg(msg)) {
                event.preventDefault();
                return;
            }
            if (oldOnUnhandledRejection) oldOnUnhandledRejection(event);
        };
        window.addEventListener("unhandledrejection", preventMediaRejection);

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
    },

    stop() {
        clearTimeout(suppressTimer);
        suppressReload = false;
        window.onerror = oldOnError;
        oldOnError = null;
        if (preventMediaRejection) {
            window.removeEventListener("unhandledrejection", preventMediaRejection);
            preventMediaRejection = null;
        }
        oldOnUnhandledRejection = null;
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
    }
});
