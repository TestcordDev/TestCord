/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Toasts } from "@webpack/common";
export default class ProgressDisplay {
    message = "";
    toastId;
    dots = 0;
    timer = null;
    constructor(message) {
        this.toastId = Toasts.genId();
        this.setLoading(message);
    }
    show(message) {
        Toasts.show({
            message,
            type: Toasts.Type.MESSAGE,
            id: this.toastId
        });
    }
    formatLoading() {
        return `${this.message}${".".repeat(this.dots)}`;
    }
    startDots() {
        if (this.timer)
            return;
        this.dots = 0;
        this.show(this.formatLoading());
        this.timer = setInterval(() => {
            this.dots = (this.dots + 1) % 4;
            this.show(this.formatLoading());
        }, 500);
    }
    stopDots() {
        if (!this.timer)
            return;
        clearInterval(this.timer);
        this.timer = null;
        this.dots = 0;
    }
    setLoading(message) {
        this.message = message;
        this.startDots();
    }
    setStatus(message) {
        this.message = message;
        this.stopDots();
        this.show(message);
    }
    close() {
        this.stopDots();
    }
}
