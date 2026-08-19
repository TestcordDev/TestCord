/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
class CustomStreamPreviewStateManager {
    state = {
        isStreaming: false,
        isSendingCustomStreamPreview: false,
        lastStreamPreviewSend: 0,
        resendStreamPreviewIntervalId: null,
    };
    listeners = new Set();
    fieldListeners = {};
    selectorListeners = new Set();
    getState() {
        return { ...this.state };
    }
    setState(partial) {
        const prevState = this.state;
        const newState = { ...this.state, ...partial };
        this.state = newState;
        const changed = Object.keys(partial).some(key => newState[key] !== prevState[key]);
        if (!changed)
            return;
        this.listeners.forEach(fn => fn());
        for (const key in partial) {
            const k = key;
            const newVal = newState[k];
            const oldVal = prevState[k];
            if (newVal !== oldVal) {
                const listeners = this.fieldListeners[k];
                if (listeners) {
                    listeners.forEach(fn => fn(newVal));
                }
            }
        }
        for (const entry of this.selectorListeners) {
            const next = entry.selector(newState);
            if (next !== entry.prevValue) {
                entry.prevValue = next;
                entry.callback(next);
            }
        }
    }
    subscribe(callback) {
        const wrapper = () => callback(this.getState());
        this.listeners.add(wrapper);
        return () => this.listeners.delete(wrapper);
    }
    subscribeToField(field, callback) {
        const listeners = this.getOrCreateFieldListeners(field);
        listeners.add(callback);
        return () => listeners.delete(callback);
    }
    subscribeWithSelector(selector, callback) {
        const entry = {
            selector,
            prevValue: selector(this.state),
            callback
        };
        this.selectorListeners.add(entry);
        return () => this.selectorListeners.delete(entry);
    }
    reset() {
        this.setState({
            isStreaming: false,
            isSendingCustomStreamPreview: false,
            lastStreamPreviewSend: 0,
            resendStreamPreviewIntervalId: null,
        });
    }
    getOrCreateFieldListeners(field) {
        if (!this.fieldListeners[field]) {
            this.fieldListeners[field] = new Set();
        }
        return this.fieldListeners[field];
    }
}
export const CustomStreamPreviewState = new CustomStreamPreviewStateManager();
