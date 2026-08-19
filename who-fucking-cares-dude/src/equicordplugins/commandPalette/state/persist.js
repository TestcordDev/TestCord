/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as DataStore from "@api/DataStore";
import { notifyPaletteChange } from "../api/registry";
export function createPersistedValue(key, fallback) {
    const fullKey = `CommandPalette_${key}`;
    let value = fallback;
    return {
        async load() {
            const stored = await DataStore.get(fullKey);
            if (stored !== undefined)
                value = stored;
        },
        get() {
            return value;
        },
        set(next) {
            value = next;
            void DataStore.set(fullKey, next);
            notifyPaletteChange();
        }
    };
}
