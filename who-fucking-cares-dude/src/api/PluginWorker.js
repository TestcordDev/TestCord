/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Logger } from "@utils/Logger";
const logger = new Logger("PluginWorker", "#a6d189");
let taskCounter = 0;
function createInlineWorker(fn) {
    const fnStr = fn.toString();
    const workerCode = `
self.onmessage = async function(e) {
    const { id, args } = e.data;
    try {
        const fn = ${fnStr};
        const result = await fn.apply(null, args);
        self.postMessage({ id, result });
    } catch (error) {
        self.postMessage({ id, error: { message: error.message, stack: error.stack } });
    }
};`;
    const blob = new Blob([workerCode], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    return worker;
}
export class WorkerHandle {
    worker = null;
    tasks = new Map();
    _terminated = false;
    constructor() { }
    static create() {
        const instance = new WorkerHandle();
        return instance;
    }
    init(fn) {
        if (this.worker) {
            this.worker.terminate();
            this.tasks.clear();
        }
        this.worker = createInlineWorker(fn);
        this._terminated = false;
        this.worker.onmessage = (e) => {
            const { id, result, error } = e.data;
            const task = this.tasks.get(id);
            if (!task)
                return;
            this.tasks.delete(id);
            if (error) {
                const err = new Error(error.message);
                err.stack = error.stack;
                task.reject(err);
            }
            else {
                task.resolve(result);
            }
        };
        this.worker.onerror = (e) => {
            logger.error("Worker error:", e.message);
        };
    }
    post(...args) {
        return new Promise((resolve, reject) => {
            if (!this.worker || this._terminated) {
                reject(new Error("Worker is not initialized or has been terminated"));
                return;
            }
            const id = ++taskCounter;
            this.tasks.set(id, { id, resolve, reject });
            this.worker.postMessage({ id, args });
        });
    }
    terminate() {
        if (this.worker) {
            this._terminated = true;
            this.worker.terminate();
            this.worker = null;
        }
        for (const task of this.tasks.values()) {
            task.reject(new Error("Worker was terminated"));
        }
        this.tasks.clear();
    }
    get isActive() {
        return this.worker !== null && !this._terminated;
    }
}
const defaultWorkerPool = [];
const POOL_SIZE = 2;
function getPoolWorker(index) {
    if (!defaultWorkerPool[index]) {
        defaultWorkerPool[index] = WorkerHandle.create();
    }
    return defaultWorkerPool[index];
}
export function resetPool() {
    for (const w of defaultWorkerPool) {
        w.terminate();
    }
    defaultWorkerPool.length = 0;
}
export async function exec(fn, ...args) {
    const worker = getPoolWorker(0);
    worker.init(fn);
    try {
        return await worker.post(...args);
    }
    finally {
        worker.terminate();
    }
}
export async function execBatch(fn, items) {
    const workers = [];
    const results = new Array(items.length);
    for (let i = 0; i < Math.min(items.length, POOL_SIZE); i++) {
        const w = WorkerHandle.create();
        w.init(fn);
        workers.push(w);
    }
    if (workers.length === 0)
        return results;
    let nextIndex = 0;
    const runNext = (workerIndex) => {
        if (nextIndex >= items.length)
            return Promise.resolve();
        const idx = nextIndex++;
        const worker = workers[workerIndex];
        return worker.post(...items[idx])
            .then(result => { results[idx] = result; })
            .catch(err => { results[idx] = err; })
            .then(() => runNext(workerIndex));
    };
    await Promise.all(workers.map((_, i) => runNext(i)));
    for (const w of workers)
        w.terminate();
    return results;
}
