/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { settings } from "./settings";

export type ListType = "whitelistedIds" | "blacklistedIds";

function getItems(list: ListType): string[] {
    return (settings.store[list] ?? "").split(",").map(s => s.trim()).filter(Boolean);
}

function setItems(list: ListType, items: string[]) {
    settings.store[list] = [...new Set(items)].join(",");
}

export function isInList(list: ListType, id: string): boolean {
    return getItems(list).includes(id);
}

export function removeFromList(list: ListType, id: string) {
    setItems(list, getItems(list).filter(item => item !== id));
}

export function addToOppositeAndList(list: ListType, id: string) {
    const opposite: ListType = list === "blacklistedIds" ? "whitelistedIds" : "blacklistedIds";
    removeFromList(opposite, id);
    const items = getItems(list);
    if (!items.includes(id)) items.push(id);
    setItems(list, items);
}
