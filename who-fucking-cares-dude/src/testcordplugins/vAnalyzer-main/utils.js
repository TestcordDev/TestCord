/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { classNameFactory } from "@utils/css";
import { Toasts } from "@webpack/common";
export const cl = classNameFactory("vc-analyze-");
export function safeToast(message, type = Toasts.Type.MESSAGE) {
    try {
        Toasts.show({ message, id: Toasts.genId(), type });
    }
    catch { }
}
export function extractDomain(url) {
    try {
        return new URL(url).hostname.toLowerCase();
    }
    catch {
        try {
            return new URL("https://" + url).hostname.toLowerCase();
        }
        catch {
            return url;
        }
    }
}
export function pruneMap(map, isExpired, maxSize) {
    for (const [key, value] of map.entries()) {
        if (isExpired(value))
            map.delete(key);
    }
    while (map.size > maxSize) {
        const oldestKey = map.keys().next().value;
        if (!oldestKey)
            break;
        map.delete(oldestKey);
    }
}
const DISCORD_CDN_FILE_REGEX = /^https?:\/\/(?:cdn|media)\.discord(?:app)?\.(?:com|net)\/attachments\//i;
export function extractCdnFileUrls(urls) {
    const files = [];
    for (const url of urls) {
        if (!DISCORD_CDN_FILE_REGEX.test(url))
            continue;
        try {
            const { pathname } = new URL(url);
            const lastSegment = pathname.split("/").pop() ?? "";
            const fileName = decodeURIComponent(lastSegment);
            if (fileName && fileName.includes(".")) {
                files.push({ url, fileName });
            }
        }
        catch {
            // invalid URL
        }
    }
    return files;
}
export function truncateUrl(url, maxLen = 60) {
    if (url.length > maxLen) {
        return url.slice(0, maxLen - 3) + "...";
    }
    return url;
}
export class ConcurrencyLimiter {
    queue = [];
    running = 0;
    maxConcurrent;
    maxQueue;
    constructor(maxConcurrent = 3, maxQueue = 500) {
        this.maxConcurrent = maxConcurrent;
        this.maxQueue = maxQueue;
    }
    async run(task) {
        return new Promise((resolve, reject) => {
            if (this.queue.length >= this.maxQueue) {
                reject(new Error("Analysis queue is full."));
                return;
            }
            const queuedTask = {
                reject,
                run: async () => {
                    try {
                        const result = await task();
                        resolve(result);
                    }
                    catch (error) {
                        reject(error);
                    }
                    finally {
                        this.running--;
                        this.processQueue();
                    }
                }
            };
            this.queue.push(queuedTask);
            this.processQueue();
        });
    }
    processQueue() {
        while (this.running < this.maxConcurrent && this.queue.length > 0) {
            this.running++;
            const task = this.queue.shift();
            if (task) {
                task.run().catch(() => {
                    // error already handled in run()
                });
            }
        }
    }
    clear() {
        for (const task of this.queue) {
            task.reject(new Error("Analysis queue was cleared."));
        }
        this.queue = [];
    }
}
export const analyzerLimiter = new ConcurrencyLimiter(3);
