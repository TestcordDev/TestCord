/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 nin0
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
export class VariableWithCallbacks {
    #value;
    #callbacks = [];
    constructor(value) {
        this.#value = value;
    }
    value(newValue) {
        if (newValue !== undefined) {
            this.#value = newValue;
            this.#callbacks.forEach(c => c.callback(this.#value, c.id));
        }
        return this.#value;
    }
    registerCallback(callback) {
        const id = Date.now();
        this.#callbacks.push({
            id,
            callback
        });
        return id;
    }
    deregisterCallback(id) {
        const possibleFallback = this.#callbacks.find(cb => cb.id === id);
        if (!possibleFallback)
            return;
        this.#callbacks.splice(this.#callbacks.indexOf(possibleFallback), 1);
    }
}
