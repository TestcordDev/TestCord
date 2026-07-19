/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DataStore } from "@api/index";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { FluxDispatcher } from "@webpack/common";

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

const CRASH_LOG_KEY = "FixScreenshare_crashLog";

async function logError(source: string, error: any) {
    try {
        const entry = {
            source,
            message: error?.message ?? String(error),
            stack: error?.stack ?? "",
            time: Date.now()
        };
        const existing = await DataStore.get(CRASH_LOG_KEY) as any[] | undefined;
        const log = [...(existing ?? []).slice(-49), entry];
        await DataStore.set(CRASH_LOG_KEY, log);
    } catch { }
}

export default definePlugin({
    name: "FixScreenshare",
    description: "Prevents Discord from crashing and reloading when screensharing by intercepting media-related errors and blocking reloads.",
    tags: ["Performance", "Voice"],
    authors: [{ name: "x2b", id: 0n }],
    required: true,

    async start() {
        // Report any errors from the previous session
        try {
            const prevLog = await DataStore.get(CRASH_LOG_KEY) as any[] | undefined;
            if (prevLog && prevLog.length > 0) {
                const last = prevLog[prevLog.length - 1];
                logger.warn(`Previous session error: [${last.source}] ${last.message}`);
                logger.warn(`Stack: ${last.stack}`);
                await DataStore.del(CRASH_LOG_KEY);
            }
        } catch { }

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
            const err = event.error;
            if (isMediaErrorMsg(msg) || err?.message && isMediaErrorMsg(err.message)) {
                logError("error", err ?? msg);
                event.preventDefault();
                if (suppressReload) armSuppress(3000);
            } else {
                // Log non-media errors too for crash diagnostics
                logError("error", err ?? msg);
            }
        };
        window.addEventListener("error", preventMediaError);

        preventMediaRejection = function (event) {
            const msg = event.reason?.message ?? String(event.reason);
            if (isMediaErrorMsg(msg)) {
                logError("unhandledRejection", event.reason);
                event.preventDefault();
            } else {
                logError("unhandledRejection", event.reason);
            }
        };
        window.addEventListener("unhandledrejection", preventMediaRejection);

        // Discord's FluxDispatcher catches exceptions in handlers and logs them
        // via console.error. Intercept to capture those too.
        origConsoleError = console.error;
        console.error = function (...args: any[]) {
            const msg = args.map(a => String(a)).join(" ");
            if (isMediaErrorMsg(msg)) {
                logError("console.error", args[0]);
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
