/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled, plugins as Plugins } from "@api/PluginManager";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher } from "@webpack/common";

const logger = new Logger("OrchestratorAPI");

type FluxHandler = (event: any) => void;

const settings = definePluginSettings({
    fluxBus: {
        type: OptionType.BOOLEAN,
        description: "Coalesce duplicate Flux event subscriptions into a single dispatch. Reduces event-loop overhead when many plugins listen to the same events.",
        default: true,
    },
    messageCoalesce: {
        type: OptionType.BOOLEAN,
        description: "Batch rapid MESSAGE_CREATE events per channel: within a 50ms window only the newest message reaches plugin handlers. Cuts re-render storms in busy channels. Discord's own stores are never coalesced, so nothing goes missing from the client itself.",
        default: false,
    },
});

let originalSubscribe: typeof FluxDispatcher.subscribe | null = null;
let originalUnsubscribe: typeof FluxDispatcher.unsubscribe | null = null;
/** Holds the handlers exactly as they were passed to subscribe, so unsubscribe still matches. */
const fluxSubscribers = new Map<string, Set<FluxHandler>>();
const fluxFans = new Map<string, FluxHandler>();
/** Subscribed handler -> the instrumented version to call in its place. */
const fluxAliases = new Map<FluxHandler, FluxHandler>();
let fluxBusActive = false;

// Only plugin handlers belong on the bus. Discord's own stores subscribe lazily as chunks
// load, and routing those through the fan would both reorder them against the dependencies
// the dispatcher tracks and, with coalescing on, silently drop messages from the client.
function isPluginFluxHandler(handler: FluxHandler) {
    for (const name in Plugins) {
        const { flux } = Plugins[name];
        if (!flux) continue;
        for (const event in flux) {
            if (flux[event] === handler) return true;
        }
    }
    return false;
}

const COALESCE_MS = 50;
const pendingCoalesce = new Map<string, { event: any; timer: ReturnType<typeof setTimeout> }>();

function dispatchCoalesced(actionType: string, event: any) {
    const set = fluxSubscribers.get(actionType);
    if (!set) return;
    for (const handler of set) {
        try {
            (fluxAliases.get(handler) ?? handler)(event);
        } catch (e) {
            logger.error(`Flux handler for ${actionType} errored,`, e);
        }
    }
}

// Leading-edge throttle per channel. The first message of a burst goes through
// immediately (no added latency), and the trailing timer only fires if something newer
// arrived while the window was open. Previously the first message was both dispatched
// inline AND re-dispatched by the timer, so every single message ran all subscribed
// handlers twice - the opposite of what coalescing is for.
function maybeCoalesce(actionType: string, event: any): boolean {
    if (actionType !== "MESSAGE_CREATE" || !settings.store.messageCoalesce) return false;
    const channelId = event.message?.channel_id;
    if (!channelId) return false;

    const pending = pendingCoalesce.get(channelId);
    if (pending) {
        pending.event = event;
        return true;
    }

    const entry: { event: any; timer: ReturnType<typeof setTimeout>; } = {
        event: null,
        timer: setTimeout(() => {
            const latest = pendingCoalesce.get(channelId);
            pendingCoalesce.delete(channelId);
            if (latest?.event) dispatchCoalesced(actionType, latest.event);
        }, COALESCE_MS)
    };
    pendingCoalesce.set(channelId, entry);
    return false;
}

function clearAllCoalesce() {
    for (const { timer } of pendingCoalesce.values()) clearTimeout(timer);
    pendingCoalesce.clear();
}

function fluxFan(actionType: string): FluxHandler {
    return event => {
        if (maybeCoalesce(actionType, event)) return;
        dispatchCoalesced(actionType, event);
    };
}

function wrappedSubscribe(this: typeof FluxDispatcher, actionType: any, handler: FluxHandler) {
    if (!fluxBusActive || !originalSubscribe) {
        return originalSubscribe!.call(FluxDispatcher, actionType, handler);
    }
    if (!isPluginFluxHandler(handler)) {
        return originalSubscribe.call(FluxDispatcher, actionType, handler);
    }
    let set = fluxSubscribers.get(actionType);
    if (!set) {
        set = new Set();
        fluxSubscribers.set(actionType, set);
    }
    set.add(handler);
    if (set.size === 1) {
        const fan = fluxFan(actionType);
        fluxFans.set(actionType, fan);
        originalSubscribe.call(FluxDispatcher, actionType, fan);
    }
    return handler;
}

function wrappedUnsubscribe(this: typeof FluxDispatcher, actionType: any, handler: FluxHandler) {
    if (!fluxBusActive || !originalUnsubscribe) {
        return originalUnsubscribe!.call(FluxDispatcher, actionType, handler);
    }
    const set = fluxSubscribers.get(actionType);
    if (!set || !set.has(handler)) {
        originalUnsubscribe.call(FluxDispatcher, actionType, handler);
        return;
    }
    set.delete(handler);
    fluxAliases.delete(handler);
    if (set.size === 0) {
        const fan = fluxFans.get(actionType);
        if (fan) {
            originalUnsubscribe.call(FluxDispatcher, actionType, fan);
            fluxFans.delete(actionType);
        }
        fluxSubscribers.delete(actionType);
    }
}

function startFluxBus() {
    if (fluxBusActive) return;
    originalSubscribe = FluxDispatcher.subscribe.bind(FluxDispatcher) as typeof FluxDispatcher.subscribe;
    originalUnsubscribe = FluxDispatcher.unsubscribe.bind(FluxDispatcher) as typeof FluxDispatcher.unsubscribe;
    fluxBusActive = true;
    (FluxDispatcher as any).subscribe = wrappedSubscribe;
    (FluxDispatcher as any).unsubscribe = wrappedUnsubscribe;

    for (const name in Plugins) {
        const p = Plugins[name];
        if (!p?.flux || !isPluginEnabled(name)) continue;
        for (const event of Object.keys(p.flux)) {
            const handler = p.flux[event] as FluxHandler | undefined;
            if (!handler) continue;
            try {
                originalUnsubscribe.call(FluxDispatcher, event, handler);
            } catch { /* not subscribed yet */ }
            wrappedSubscribe.call(FluxDispatcher, event, handler);
        }
    }
}

export function wrapFluxHandlers(wrapper: (handler: FluxHandler) => FluxHandler) {
    for (const set of fluxSubscribers.values()) {
        for (const handler of set) {
            const current = fluxAliases.get(handler) ?? handler;
            const wrapped = wrapper(current);
            if (wrapped !== current) fluxAliases.set(handler, wrapped);
        }
    }
}

function stopFluxBus() {
    if (!fluxBusActive || !originalSubscribe || !originalUnsubscribe) return;
    fluxBusActive = false;
    (FluxDispatcher as any).subscribe = originalSubscribe;
    (FluxDispatcher as any).unsubscribe = originalUnsubscribe;

    for (const [actionType, set] of fluxSubscribers) {
        const fan = fluxFans.get(actionType);
        if (fan) {
            try {
                originalUnsubscribe.call(FluxDispatcher, actionType, fan);
            } catch { /* already gone */ }
        }
        for (const handler of set) {
            try {
                originalSubscribe.call(FluxDispatcher, actionType, handler);
            } catch (e) {
                logger.error(`Failed to re-subscribe handler for ${actionType},`, e);
            }
        }
    }
    fluxSubscribers.clear();
    fluxFans.clear();
    fluxAliases.clear();
    clearAllCoalesce();
    originalSubscribe = null;
    originalUnsubscribe = null;
}

export default definePlugin({
    name: "OrchestratorAPI",
    description: "Transparent performance orchestrator. Coalesces duplicate Flux subscriptions so the client stays smooth under heavy plugin load. Opt-in via TestcordHelper.",
    authors: [TestcordDevs.x2b],
    tags: ["Utility"],
    hidden: true,
    settings,

    start() {
        try {
            if (settings.store.fluxBus) startFluxBus();
        } catch (e) {
            logger.error("Failed to start FluxDispatcherBus,", e);
        }
        if (settings.store.messageCoalesce) {
            logger.info("MESSAGE_CREATE coalescing active (window:", COALESCE_MS, "ms)");
        }
    },

    stop() {
        try {
            stopFluxBus();
        } catch (e) {
            logger.error("Failed to stop FluxDispatcherBus,", e);
        }
    },
});
