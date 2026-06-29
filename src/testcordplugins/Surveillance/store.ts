/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { Logger } from "@utils/Logger";

import type { SurveillanceEvent } from "./types";

const STORE_KEY = "Illegalcord_Surveillance_events";
const MIN_EVENTS = 50;
const SAVE_DELAY = 750;
const logger = new Logger("Surveillance");
const listeners = new Set<() => void>();

let events: SurveillanceEvent[] = [];
let loaded = false;
let loading: Promise<SurveillanceEvent[]> | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

const notify = () => {
    for (const listener of listeners) {
        listener();
    }
};

export const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

export const getEvents = () => events;

const persistEvents = () =>
    DataStore.set(STORE_KEY, events).catch(error => logger.error("Failed to save surveillance events:", error));

const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);

    saveTimer = setTimeout(() => {
        saveTimer = undefined;
        void persistEvents();
    }, SAVE_DELAY);
};

const persistNow = async () => {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = undefined;
    }

    await persistEvents();
};

const trimToLimit = (nextEvents: SurveillanceEvent[], limit?: number) => {
    if (limit == null) return nextEvents;

    return nextEvents.slice(0, Math.max(MIN_EVENTS, limit));
};

const applyLimit = async (limit?: number) => {
    const trimmedEvents = trimToLimit(events, limit);
    if (trimmedEvents.length === events.length) return;

    events = trimmedEvents;
    await persistNow();
    notify();
};

export async function loadEvents(limit?: number) {
    if (loaded) {
        await applyLimit(limit);
        return events;
    }

    if (loading) {
        await loading;
        await applyLimit(limit);
        return events;
    }

    loading = DataStore.get<SurveillanceEvent[]>(STORE_KEY)
        .then(async savedEvents => {
            const saved = Array.isArray(savedEvents) ? savedEvents : [];
            events = trimToLimit(saved, limit);
            loaded = true;
            notify();
            if (events.length !== saved.length) await persistEvents();
            return events;
        })
        .catch(error => {
            logger.error("Failed to load surveillance events:", error);
            events = [];
            loaded = true;
            notify();
            return events;
        });

    return loading;
}

export async function recordEvent(event: SurveillanceEvent, limit: number) {
    await loadEvents(limit);

    events.unshift(event);
    events.length = Math.min(events.length, Math.max(MIN_EVENTS, limit));
    notify();
    scheduleSave();
}

export async function clearEvents() {
    events = [];
    loaded = true;
    await persistNow();
    notify();
}

export async function trimEvents(limit: number) {
    await loadEvents(limit);
    events = events.slice(0, Math.max(MIN_EVENTS, limit));
    await persistNow();
    notify();
}
