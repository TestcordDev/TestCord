/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
export class EventEmitter {
    events;
    constructor() {
        this.events = {};
    }
    on(eventName, callback) {
        if (!this.events[eventName]) {
            this.events[eventName] = [];
        }
        this.events[eventName].push(callback);
    }
    emit(eventName, val) {
        if (!this.events[eventName]) {
            return;
        }
        this.events[eventName].forEach(callback => {
            callback(val);
        });
    }
    off(eventName, callback) {
        if (!this.events[eventName]) {
            return;
        }
        this.events[eventName] = this.events[eventName].filter(cb => {
            return cb !== callback;
        });
    }
    clear() {
        this.events = {};
    }
    once(eventName, callback) {
        const onceCallback = (val) => {
            callback(val);
            this.off(eventName, onceCallback);
        };
        this.on(eventName, onceCallback);
    }
}
