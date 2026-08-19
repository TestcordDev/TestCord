/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
/**
 * A Map whose entries expire after a given amount of time. When an entry expires, it is automatically removed from the map and an optional callback is called.
 */
export class TTLMap extends Map {
    expiryMs;
    onExpire;
    _timers = new Map();
    constructor(expiryMs, onExpire) {
        super();
        this.expiryMs = expiryMs;
        this.onExpire = onExpire;
    }
    set(key, value) {
        const timeoutId = setTimeout(() => {
            this.delete(key);
            this.onExpire?.(key, value);
        }, this.expiryMs);
        this._timers.set(key, timeoutId);
        return super.set(key, value);
    }
    delete(key) {
        if (this._timers.has(key)) {
            clearTimeout(this._timers.get(key));
            this._timers.delete(key);
        }
        return super.delete(key);
    }
    clear() {
        for (const timeoutId of this._timers.values())
            clearTimeout(timeoutId);
        this._timers.clear();
        return super.clear();
    }
}
