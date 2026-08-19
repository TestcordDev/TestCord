/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { createPersistedValue } from "./persist";
const pins = createPersistedValue("pins", []);
export const loadPins = pins.load;
export function getPins() {
    return pins.get();
}
export function isPinned(commandId) {
    return pins.get().includes(commandId);
}
export function togglePin(commandId) {
    const current = pins.get();
    pins.set(current.includes(commandId)
        ? current.filter(id => id !== commandId)
        : [...current, commandId]);
}
