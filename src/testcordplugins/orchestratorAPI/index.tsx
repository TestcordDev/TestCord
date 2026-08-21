/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { globalPatches, navPatches } from "@api/ContextMenu";
import { isPluginEnabled, plugins as Plugins } from "@api/PluginManager";
import { RuntimeInterposition, RuntimeInterpositionPriority } from "@api/RuntimeInterposition";
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
        description: "Batch rapid MESSAGE_CREATE events per-channel: only dispatch the latest message from each channel within a 100ms window. Drastically cuts React re-render storms in busy channels. Safe because intermediate messages settle into the store anyway via bulk fetch.",
        default: false,
    },
    presenceCoalesce: {
        type: OptionType.BOOLEAN,
        description: "Throttle PRESENCE_UPDATES storms: first event dispatches instantly, further bursts within 150ms collapse into one dispatch of the latest payload. Big servers spam hundreds of these per minute and each one re-renders the member list.",
        default: true,
    },
    contextMenuHardening: {
        type: OptionType.BOOLEAN,
        description: "Wrap context menu patches so a patch that repeatedly throws is auto-disabled instead of taxing every menu open.",
        default: true,
    },
});

let originalSubscribe: typeof FluxDispatcher.subscribe | null = null;
let originalUnsubscribe: typeof FluxDispatcher.unsubscribe | null = null;
const fluxSubscribers = new Map<string, Set<FluxHandler>>();
const fluxFans = new Map<string, FluxHandler>();
let fluxBusActive = false;

const COALESCE_MS = 50;
const pendingCoalesce = new Map<string, { event: any; timer: ReturnType<typeof setTimeout> }>();

function dispatchCoalesced(actionType: string, event: any) {
    const set = fluxSubscribers.get(actionType);
    if (!set) return;
    for (const handler of set) {
        try { handler(event); } catch (e) { logger.error(`Flux handler for ${actionType} errored,`, e); }
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

// Dispatch-level PRESENCE_UPDATES throttle. Stores register via dispatch (not
// subscribe), so throttling at the fan level never protected the member list from
// re-render storms. Holding the payload here means both stores AND plugin handlers
// see a reduced rate. Leading edge passes instantly; trailing fires with the newest
// payload so final per-user state stays exact.
const PRESENCE_COALESCE_MS = 150;
let presenceHoldTimer: ReturnType<typeof setTimeout> | null = null;
let heldPresenceEvent: any = null;
let disposePresenceDispatchHook: (() => void) | null = null;
type DispatchFn = (payload: any) => Promise<void>;
let origPresenceDispatch: DispatchFn | null = null;

function startPresenceThrottle() {
    if (disposePresenceDispatchHook || typeof RuntimeInterposition === "undefined") return;
    try {
        disposePresenceDispatchHook = RuntimeInterposition.register({
            owner: "OrchestratorAPI",
            hook: "fluxDispatch",
            priority: RuntimeInterpositionPriority.BEHAVIOR,
            wrap: next => {
                origPresenceDispatch = next as unknown as DispatchFn;
                return (payload: any): Promise<void> => {
                    if (!settings.store.presenceCoalesce || payload?.type !== "PRESENCE_UPDATES") {
                        return origPresenceDispatch!(payload);
                    }
                    if (presenceHoldTimer === null) {
                        // leading edge: pass through now, open hold window
                        presenceHoldTimer = setTimeout(() => {
                            presenceHoldTimer = null;
                            const held = heldPresenceEvent;
                            heldPresenceEvent = null;
                            if (held && origPresenceDispatch) void origPresenceDispatch(held);
                        }, PRESENCE_COALESCE_MS);
                        return origPresenceDispatch!(payload);
                    }
                    heldPresenceEvent = payload;
                    return Promise.resolve();
                };
            }
        });
    } catch (e) {
        logger.error("Failed to install presence throttle,", e);
        disposePresenceDispatchHook = null;
    }
}

function stopPresenceThrottle() {
    if (presenceHoldTimer !== null) {
        clearTimeout(presenceHoldTimer);
        presenceHoldTimer = null;
    }
    heldPresenceEvent = null;
    disposePresenceDispatchHook?.();
    disposePresenceDispatchHook = null;
    origPresenceDispatch = null;
}

function clearAllCoalesce() {
    for (const { timer } of pendingCoalesce.values()) clearTimeout(timer);
    pendingCoalesce.clear();
}

function fluxFan(actionType: string): FluxHandler {
    return event => {
        if (maybeCoalesce(actionType, event)) return;
        const set = fluxSubscribers.get(actionType);
        if (!set) return;
        for (const handler of set) {
            try {
                handler(event);
            } catch (e) {
                logger.error(`Flux handler for ${actionType} errored,`, e);
            }
        }
    };
}

function wrappedSubscribe(this: typeof FluxDispatcher, actionType: any, handler: FluxHandler) {
    if (!fluxBusActive || !originalSubscribe) {
        return originalSubscribe!.call(FluxDispatcher, actionType, handler);
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
    for (const [actionType, set] of fluxSubscribers) {
        const newSet = new Set<FluxHandler>();
        for (const handler of set) {
            newSet.add(wrapper(handler));
        }
        fluxSubscribers.set(actionType, newSet);
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
    clearAllCoalesce();
    originalSubscribe = null;
    originalUnsubscribe = null;
}

let hardeningActive = false;
const wrappedToOriginal = new Map<Function, Function>();
const failCounts = new Map<Function, number>();
const disabledPatches = new Set<Function>();

type NavPatch = (children: Array<any>, ...args: Array<any>) => void;
type GlobalPatch = (navId: string, children: Array<any>, ...args: Array<any>) => void;

function makeHardenedNav(fn: NavPatch) {
    const wrapped = function (children: Array<any>, ...args: Array<any>) {
        if (!hardeningActive) {
            return fn(children, ...args);
        }
        if (disabledPatches.has(fn)) {
            return;
        }
        try {
            fn(children, ...args);
            failCounts.delete(fn);
        } catch (e) {
            const count = (failCounts.get(fn) ?? 0) + 1;
            failCounts.set(fn, count);
            const patchName = fn.name || (fn as any).__name || "anonymous";
            if (count >= 5) {
                disabledPatches.add(fn);
                logger.warn(`Disabled context menu patch [${patchName}] after ${count} failures.`, e);
            } else {
                logger.error(`Context menu patch [${patchName}] errored,`, e);
            }
        }
    };
    wrappedToOriginal.set(wrapped, fn);
    return wrapped;
}

function makeHardenedGlobal(fn: GlobalPatch) {
    const wrapped = function (navId: string, children: Array<any>, ...args: Array<any>) {
        if (!hardeningActive) {
            return fn(navId, children, ...args);
        }
        if (disabledPatches.has(fn)) {
            return;
        }
        try {
            fn(navId, children, ...args);
            failCounts.delete(fn);
        } catch (e) {
            const count = (failCounts.get(fn) ?? 0) + 1;
            failCounts.set(fn, count);
            const patchName = fn.name || (fn as any).__name || "anonymous";
            if (count >= 5) {
                disabledPatches.add(fn);
                logger.warn(`Disabled global context menu patch [${patchName}] after ${count} failures.`, e);
            } else {
                logger.error(`Global context menu patch [${patchName}] on "${navId}" errored,`, e);
            }
        }
    };
    wrappedToOriginal.set(wrapped, fn);
    return wrapped;
}

function startContextMenuHardening() {
    if (hardeningActive) return;
    hardeningActive = true;
    for (const set of navPatches.values()) {
        const originals = [...set];
        for (const fn of originals) {
            if (typeof fn !== "function" || wrappedToOriginal.has(fn)) continue;
            set.delete(fn);
            set.add(makeHardenedNav(fn as NavPatch));
        }
    }
    const globals = [...globalPatches];
    for (const fn of globals) {
        if (typeof fn !== "function" || wrappedToOriginal.has(fn)) continue;
        globalPatches.delete(fn);
        globalPatches.add(makeHardenedGlobal(fn as GlobalPatch));
    }
}

function stopContextMenuHardening() {
    if (!hardeningActive) return;
    hardeningActive = false;
    for (const set of navPatches.values()) {
        const wrappers = [...set];
        for (const fn of wrappers) {
            const original = wrappedToOriginal.get(fn);
            if (!original) continue;
            set.delete(fn);
            set.add(original as NavPatch);
        }
    }
    const globals = [...globalPatches];
    for (const fn of globals) {
        const original = wrappedToOriginal.get(fn);
        if (!original) continue;
        globalPatches.delete(fn);
        globalPatches.add(original as GlobalPatch);
    }
    wrappedToOriginal.clear();
    failCounts.clear();
    disabledPatches.clear();
}

export default definePlugin({
    name: "OrchestratorAPI",
    description: "Transparent performance orchestrator. Coalesces duplicate Flux subscriptions and hardens context menu patches so the client stays smooth under heavy plugin load. Opt-in via TestcordHelper.",
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
        try {
            if (settings.store.contextMenuHardening) startContextMenuHardening();
        } catch (e) {
            logger.error("Failed to start ContextMenuHardening,", e);
        }
        try {
            if (settings.store.presenceCoalesce) startPresenceThrottle();
        } catch (e) {
            logger.error("Failed to start presence throttle,", e);
        }
        if (settings.store.messageCoalesce) {
            logger.info("MESSAGE_CREATE coalescing active (window:", COALESCE_MS, "ms)");
        }
        if (settings.store.presenceCoalesce) {
            logger.info("PRESENCE_UPDATES throttling active (window:", PRESENCE_COALESCE_MS, "ms)");
        }
    },

    stop() {
        try {
            stopPresenceThrottle();
        } catch (e) {
            logger.error("Failed to stop presence throttle,", e);
        }
        try {
            stopContextMenuHardening();
        } catch (e) {
            logger.error("Failed to stop ContextMenuHardening,", e);
        }
        try {
            stopFluxBus();
        } catch (e) {
            logger.error("Failed to stop FluxDispatcherBus,", e);
        }
    },
});
