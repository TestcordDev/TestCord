/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { PlayerSnapshot, YnisonEvent, YnisonStatus } from "../types";
import { MAX_EVENTS } from "./constants";
import { state } from "./state";

const eventQueue: YnisonEvent[] = [];
let eventWaiter: ((events: YnisonEvent[]) => void) | null = null;

export function enqueue(event: YnisonEvent): void {
    const stale = event.type === "snapshot" || event.type === "status"
        ? eventQueue.findIndex(queued => queued.type === event.type)
        : -1;

    if (stale === -1) eventQueue.push(event);
    else eventQueue[stale] = event;

    if (eventQueue.length > MAX_EVENTS) {
        eventQueue.splice(0, eventQueue.length - MAX_EVENTS);
    }

    if (eventWaiter) {
        const resolve = eventWaiter;
        eventWaiter = null;
        resolve(eventQueue.splice(0, MAX_EVENTS));
    }
}

function sameSnapshot(a: PlayerSnapshot, b: PlayerSnapshot): boolean {
    for (const key of Object.keys(a) as (keyof PlayerSnapshot)[]) {
        if (key === "devices") continue;
        if (a[key] !== b[key]) return false;
    }

    if (a.devices.length !== b.devices.length) return false;
    return a.devices.every((device, index) => {
        const other = b.devices[index];
        return device.id === other.id && device.title === other.title && device.canBePlayer === other.canBePlayer;
    });
}

export function emitSnapshot(snapshot: PlayerSnapshot): void {
    if (state.lastSnapshot && sameSnapshot(state.lastSnapshot, snapshot)) return;

    state.lastSnapshot = snapshot;
    enqueue({ type: "snapshot", snapshot, at: Date.now() });
}

export function statusSnapshot(): YnisonStatus {
    return { state: state.connectionState, lastError: state.lastError };
}

export function emitStatus(connectionState: YnisonStatus["state"], error: string | null = null): void {
    state.connectionState = connectionState;
    state.lastError = error;
    enqueue({ type: "status", status: statusSnapshot(), at: Date.now() });
}

export function awaitEvents(timeoutMs: number): Promise<YnisonEvent[]> {
    const previous = eventWaiter;
    eventWaiter = null;
    previous?.([]);

    if (eventQueue.length > 0) return Promise.resolve(eventQueue.splice(0, MAX_EVENTS));

    return new Promise(resolve => {
        const waiter = (events: YnisonEvent[]) => {
            clearTimeout(timer);
            resolve(events);
        };

        const timer = setTimeout(() => {
            if (eventWaiter === waiter) eventWaiter = null;
            resolve([]);
        }, timeoutMs);
        timer.unref();

        eventWaiter = waiter;
    });
}
