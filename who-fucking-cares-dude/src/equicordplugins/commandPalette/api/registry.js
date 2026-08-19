/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
const owners = new Map();
const listeners = new Set();
export function notifyPaletteChange() {
    for (const listener of listeners)
        listener();
}
export function subscribePalette(listener) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
}
export function registerCommands(ownerId, commands) {
    owners.set(ownerId, commands);
    notifyPaletteChange();
}
export function unregisterOwner(ownerId) {
    owners.delete(ownerId);
    notifyPaletteChange();
}
export function clearRegistry() {
    owners.clear();
    listeners.clear();
}
export function getVisibleCommands() {
    const result = [];
    for (const commands of owners.values()) {
        for (const command of commands) {
            if (command.predicate && !command.predicate())
                continue;
            result.push(command);
        }
    }
    return result;
}
export function getCommandById(id) {
    for (const commands of owners.values()) {
        const match = commands.find(c => c.id === id);
        if (match)
            return match;
    }
    return undefined;
}
