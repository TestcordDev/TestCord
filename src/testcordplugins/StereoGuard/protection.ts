/* eslint-disable simple-header/header -- This standalone user plugin is MIT licensed. */
/* Copyright (c) 2026 DavidHiFi. SPDX-License-Identifier: MIT */

// Safety decisions use fresh source samples. A timer alone never opens a held volume.
export class VolumeHold {
    applied = 0;
    private quietSince: number | null = null;
    private lastEvidence: number | null = null;
    private lastTick: number;
    private recovering = false;
    private volume = 0;

    constructor(readonly base: number, now: number, private readonly maxGap: number) {
        this.lastTick = now;
    }

    observe(safe: boolean, at: number) {
        if (!Number.isFinite(at) || (this.lastEvidence !== null && at <= this.lastEvidence)) return;
        const gap = this.lastEvidence === null || at - this.lastEvidence > this.maxGap;
        this.lastEvidence = at;
        if (!safe) {
            this.quietSince = null;
            this.recovering = false;
            this.volume = 0;
        } else if (gap || this.quietSince === null) {
            this.quietSince = at;
            this.recovering = false;
            this.volume = 0;
        }
    }

    tick(now: number, quietMs: number) {
        const dt = Math.max(0, Math.min(250, now - this.lastTick));
        this.lastTick = now;
        if (this.lastEvidence === null || now - this.lastEvidence > this.maxGap) {
            this.quietSince = null;
            this.recovering = false;
            this.volume = 0;
        }
        if (!Number.isFinite(quietMs) || quietMs <= 0 || this.quietSince === null || now - this.quietSince < quietMs) {
            return { volume: 0, done: false };
        }
        if (!this.recovering) {
            this.recovering = true;
            return { volume: 0, done: false };
        }
        this.volume = Math.min(this.base, this.volume + this.base * dt / 1500);
        const done = this.volume >= this.base - 0.00001;
        return { volume: done ? this.base : Math.round(this.volume * 10) / 10, done };
    }
}
