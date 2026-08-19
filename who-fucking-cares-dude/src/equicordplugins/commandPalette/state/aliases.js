/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { createPersistedValue } from "./persist";
const aliases = createPersistedValue("aliases", {});
export const loadAliases = aliases.load;
export function getAlias(commandId) {
    return aliases.get()[commandId];
}
export function setAlias(commandId, alias) {
    const next = { ...aliases.get() };
    const trimmed = alias.trim();
    if (trimmed)
        next[commandId] = trimmed;
    else
        delete next[commandId];
    aliases.set(next);
}
