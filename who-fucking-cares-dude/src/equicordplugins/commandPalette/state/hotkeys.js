/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { createPersistedValue } from "./persist";
const hotkeys = createPersistedValue("hotkeys", {});
export const loadHotkeys = hotkeys.load;
export function getHotkey(commandId) {
    return hotkeys.get()[commandId];
}
export function getAllHotkeys() {
    return hotkeys.get();
}
export function setHotkey(commandId, combo) {
    const next = { ...hotkeys.get() };
    if (combo?.length)
        next[commandId] = combo;
    else
        delete next[commandId];
    hotkeys.set(next);
}
