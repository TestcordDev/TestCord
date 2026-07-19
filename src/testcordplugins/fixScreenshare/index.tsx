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
let origGo: ((delta?: number) => void) | undefined;
let preventMediaError: ((event: ErrorEvent) => void) | null = null;
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
    description: "Prevents Discord from crashing and reloading when screensharing by intercepting media-related errors and blocking reloads.",
    tags: ["Performance", "Voice"],
    authors: [{ name: "x2b", id: 0n }],
    required: true,

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

        // Use addEventListener so Discord's own window.onerror still runs.
        // event.preventDefault() prevents window.onerror from firing,
        // so we can intercept media errors before Discord's handler sees them.
        preventMediaError = function (event) {
            const msg = event.message ?? "";
            if (isMediaErrorMsg(msg) || event.error?.message && isMediaErrorMsg(event.error.message)) {
                event.preventDefault();
                if (suppressReload) armSuppress(3000);
            }
        };
        window.addEventListener("error", preventMediaError);

        preventMediaRejection = function (event) {
            const msg = event.reason?.message ?? String(event.reason);
            if (isMediaErrorMsg(msg)) {
                event.preventDefault();
            }
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
        clearTimeout(suppressTimer);
        suppressReload = false;
        if (preventMediaError) {
            window.removeEventListener("error", preventMediaError);
            preventMediaError = null;
        }
        if (preventMediaRejection) {
            window.removeEventListener("unhandledrejection", preventMediaRejection);
            preventMediaRejection = null;
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
