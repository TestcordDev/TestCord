/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { ChannelStore } from "@webpack/common";

// ── Discord channel type constants ───────────────────────────────────────────
// 1 = DM (1-on-1), 3 = GROUP_DM. Hardcoded here because they are stable, long-
// documented values in the Discord API; DESIGN §3 suggests Constants.ChannelTypes
// but those aren't reliably importable across Vencord versions, so we stay
// conservative with the literals.
const CHANNEL_TYPE_DM = 1;
const CHANNEL_TYPE_GROUP_DM = 3;

const settings = definePluginSettings({
    silenceGroupCalls: {
        type: OptionType.BOOLEAN,
        description: "Don't ring members when you start a group call",
        default: true,
    },
    silenceDMCalls: {
        type: OptionType.BOOLEAN,
        description: "Don't ring the other person when you start a 1-on-1 DM call",
        default: false,
    },
    debugLogs: {
        type: OptionType.BOOLEAN,
        description: "Log plugin activity to the console (DevTools → Console, filter 'SilentGroupCall')",
        default: false,
    },
});

const logger = new Logger("SilentGroupCall");
const debug = (...args: any[]) => {
    if (settings.store.debugLogs) logger.info(...args);
};

// Lazy webpack finder for the calls-actions module. Accessing any property on
// the returned proxy triggers the actual module resolution — which is why the
// first real access in start() is wrapped in try/catch (a failed lookup surfaces
// there, not at import time). VERIFY the property names if a Discord update
// breaks this (see README troubleshooting).
const CallActions: any = findByPropsLazy("ring", "stopRinging");

// The original, unpatched ring function. null means "not currently patched".
let originalRing: ((...args: any[]) => any) | null = null;

/**
 * Decide whether a ring for the given channel should be silenced, based on the
 * channel type and the user's settings. Unknown channels and any non-DM type
 * pass through (ring normally).
 */
function shouldSilence(channelId: string, channel: any): boolean {
    if (!channel) {
        debug(`unknown channel ${channelId} — passing through`);
        return false;
    }

    if (channel.type === CHANNEL_TYPE_GROUP_DM) return settings.store.silenceGroupCalls;
    if (channel.type === CHANNEL_TYPE_DM) return settings.store.silenceDMCalls;

    return false;
}

export default definePlugin({
    name: "SilentGroupCall",
    description: "Start DM and group calls without ringing the other members — they can still see and join the call, they just don't get the incoming-call notification.",
    authors: [{ name: "gandhistyle", id: 0n }],
    settings,

    start() {
        // Re-entrancy guard: if we somehow already patched, don't double-wrap
        // (which would leak the original and make stop() unable to fully revert).
        if (originalRing) {
            debug("start() called while already patched — ignoring");
            return;
        }

        // Resolve the module defensively. Lazy finders throw or hand back a proxy
        // that errors when the underlying module can't be found; the first real
        // property access is where that surfaces. Never let start() throw.
        let ring: unknown;
        try {
            ring = CallActions.ring;
        } catch (e) {
            logger.error("could not find ring/stopRinging module — plugin inactive", e);
            return;
        }

        if (typeof ring !== "function") {
            logger.error("could not find ring/stopRinging module — plugin inactive");
            return;
        }

        originalRing = ring as (...args: any[]) => any;

        CallActions.ring = function (this: unknown, channelId: string, ...rest: any[]) {
            let channel: any;
            try {
                channel = ChannelStore.getChannel(channelId);
            } catch {
                channel = undefined;
            }

            debug("ring() called", {
                channelId,
                type: channel?.type,
                settings: { ...settings.store },
            });

            if (shouldSilence(channelId, channel)) {
                // Silencing = simply not calling the original ring. We deliberately
                // send NO extra requests here (no stop-ringing "safety net"): the
                // plugin's safety property is that it only ever omits traffic the
                // client would have sent, never adds any.
                debug(`→ silencing (skipping ring) for ${channelId}`);
                return;
            }

            debug(`→ ringing normally: ${channelId}`);
            return originalRing!.call(this, channelId, ...rest);
        };

        logger.info("patched ring()");
    },

    stop() {
        // Safe to call even if start() failed / never patched.
        if (!originalRing) {
            debug("stop() called but ring was never patched — nothing to do");
            return;
        }

        try {
            CallActions.ring = originalRing;
        } catch (e) {
            logger.error("failed to restore original ring()", e);
        } finally {
            originalRing = null;
        }

        logger.info("unpatched ring()");
    },
});
