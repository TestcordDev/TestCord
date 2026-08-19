/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { PluginHealth } from "@api/PluginHealth";
import { FluxDispatcher } from "@webpack/common";
import { createInterpositionSlot } from "./RuntimeInterpositionCore";
export const RuntimeInterpositionPriority = {
    BEHAVIOR: 0,
    DIAGNOSTICS: 10_000
};
let sequence = 0;
const ownershipListeners = new Set();
const interactionListeners = new Set();
let activeInteractions = 0;
function notifyOwnershipListeners() {
    for (const listener of ownershipListeners)
        listener();
}
const nextSequence = () => sequence++;
const slots = {
    requestAnimationFrame: createInterpositionSlot("requestAnimationFrame", () => window.requestAnimationFrame, value => { window.requestAnimationFrame = value; }, nextSequence, notifyOwnershipListeners),
    cancelAnimationFrame: createInterpositionSlot("cancelAnimationFrame", () => window.cancelAnimationFrame, value => { window.cancelAnimationFrame = value; }, nextSequence, notifyOwnershipListeners),
    fetch: createInterpositionSlot("fetch", () => window.fetch, value => { window.fetch = value; }, nextSequence, notifyOwnershipListeners),
    addEventListener: createInterpositionSlot("addEventListener", () => EventTarget.prototype.addEventListener, value => { EventTarget.prototype.addEventListener = value; }, nextSequence, notifyOwnershipListeners),
    removeEventListener: createInterpositionSlot("removeEventListener", () => EventTarget.prototype.removeEventListener, value => { EventTarget.prototype.removeEventListener = value; }, nextSequence, notifyOwnershipListeners),
    ResizeObserver: createInterpositionSlot("ResizeObserver", () => window.ResizeObserver, value => { window.ResizeObserver = value; }, nextSequence, notifyOwnershipListeners),
    requestIdleCallback: createInterpositionSlot("requestIdleCallback", () => window.requestIdleCallback, value => { window.requestIdleCallback = value; }, nextSequence, notifyOwnershipListeners),
    cancelIdleCallback: createInterpositionSlot("cancelIdleCallback", () => window.cancelIdleCallback, value => { window.cancelIdleCallback = value; }, nextSequence, notifyOwnershipListeners),
    fluxDispatch: createInterpositionSlot("fluxDispatch", () => FluxDispatcher.dispatch, value => { FluxDispatcher.dispatch = value; }, nextSequence, notifyOwnershipListeners),
    fluxSubscribe: createInterpositionSlot("fluxSubscribe", () => FluxDispatcher.subscribe, value => { FluxDispatcher.subscribe = value; }, nextSequence, notifyOwnershipListeners),
    fluxUnsubscribe: createInterpositionSlot("fluxUnsubscribe", () => FluxDispatcher.unsubscribe, value => { FluxDispatcher.unsubscribe = value; }, nextSequence, notifyOwnershipListeners)
};
function register(registration) {
    switch (registration.hook) {
        case "requestAnimationFrame": return slots.requestAnimationFrame.register(registration.owner, registration.priority, registration.wrap);
        case "cancelAnimationFrame": return slots.cancelAnimationFrame.register(registration.owner, registration.priority, registration.wrap);
        case "fetch": return slots.fetch.register(registration.owner, registration.priority, registration.wrap);
        case "addEventListener": return slots.addEventListener.register(registration.owner, registration.priority, registration.wrap);
        case "removeEventListener": return slots.removeEventListener.register(registration.owner, registration.priority, registration.wrap);
        case "ResizeObserver": return slots.ResizeObserver.register(registration.owner, registration.priority, registration.wrap);
        case "requestIdleCallback": return slots.requestIdleCallback.register(registration.owner, registration.priority, registration.wrap);
        case "cancelIdleCallback": return slots.cancelIdleCallback.register(registration.owner, registration.priority, registration.wrap);
        case "fluxDispatch": return slots.fluxDispatch.register(registration.owner, registration.priority, registration.wrap);
        case "fluxSubscribe": return slots.fluxSubscribe.register(registration.owner, registration.priority, registration.wrap);
        case "fluxUnsubscribe": return slots.fluxUnsubscribe.register(registration.owner, registration.priority, registration.wrap);
    }
}
export const RuntimeInterposition = {
    register,
    getActiveHooks(owner) {
        const active = [];
        for (const slot of Object.values(slots)) {
            for (const layer of slot.ownership())
                active.push(layer);
        }
        return active
            .filter(layer => owner == null || layer.owner === owner)
            .sort((a, b) => a.hook.localeCompare(b.hook) || a.priority - b.priority || a.owner.localeCompare(b.owner));
    },
    subscribe(listener) {
        ownershipListeners.add(listener);
        return () => ownershipListeners.delete(listener);
    }
};
export const RuntimeInteractions = {
    begin() {
        activeInteractions++;
        for (const listener of interactionListeners)
            listener();
        let ended = false;
        return () => {
            if (ended)
                return;
            ended = true;
            activeInteractions--;
            for (const listener of interactionListeners)
                listener();
        };
    },
    isActive() {
        return activeInteractions > 0;
    },
    subscribe(listener) {
        interactionListeners.add(listener);
        return () => interactionListeners.delete(listener);
    }
};
PluginHealth.setRuntimeHookProvider(owner => RuntimeInterposition.getActiveHooks(owner));
