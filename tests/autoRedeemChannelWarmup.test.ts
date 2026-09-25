/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import test from "node:test";

import { CHANNEL_WARMUP_MESSAGE_LIMIT, warmupChannels } from "../src/testcordplugins/autoRedeem/channelWarmup.ts";

interface TestChannel {
    id: string;
    priority: number;
}

interface TestMessage {
    id: string;
}

function nextTurn(): Promise<void> {
    return new Promise(resolve => setImmediate(resolve));
}

test("deduplicates channels, orders priority, and skips unavailable collections", async () => {
    const channels: TestChannel[] = [
        { id: "other", priority: 20 },
        { id: "current", priority: 0 },
        { id: "private", priority: 10 },
        { id: "unread", priority: 5 },
        { id: "other", priority: 999 },
        { id: "loaded", priority: 20 },
        { id: "loading", priority: 20 },
        { id: "denied", priority: 20 },
    ];
    const requests: Array<{ channelId: string; limit: number; }> = [];
    const processed: Array<{ channelId: string; messageId: string; }> = [];

    const result = await warmupChannels<TestChannel, TestMessage>({
        enumerateChannels: () => channels,
        getCurrentChannelId: () => "current",
        canReadChannel: channel => channel.id !== "denied",
        isChannelFetched: channelId => channelId === "loaded",
        isChannelLoading: channelId => channelId === "loading",
        getPriority: channel => channel.priority,
        fetchMessages: async request => {
            requests.push(request);
            return [{ id: `${request.channelId}:message` }];
        },
        onMessages: (channelId, messages) => {
            const message = messages[0];
            if (message) processed.push({ channelId, messageId: message.id });
        },
        isCurrent: () => true,
        concurrency: 1,
    });

    assert.deepEqual(requests, [
        { channelId: "current", limit: CHANNEL_WARMUP_MESSAGE_LIMIT },
        { channelId: "unread", limit: CHANNEL_WARMUP_MESSAGE_LIMIT },
        { channelId: "private", limit: CHANNEL_WARMUP_MESSAGE_LIMIT },
        { channelId: "other", limit: CHANNEL_WARMUP_MESSAGE_LIMIT },
    ]);
    assert.deepEqual(processed, [
        { channelId: "current", messageId: "current:message" },
        { channelId: "unread", messageId: "unread:message" },
        { channelId: "private", messageId: "private:message" },
        { channelId: "other", messageId: "other:message" },
    ]);
    assert.deepEqual(result, {
        discovered: 8,
        unique: 7,
        attempted: 4,
        fetched: 4,
        processed: 4,
        skipped: 3,
        failed: 0,
        cancelled: 0,
        stopped: false,
        channels: [
            { channelId: "current", status: "processed" },
            { channelId: "unread", status: "processed" },
            { channelId: "private", status: "processed" },
            { channelId: "other", status: "processed" },
            { channelId: "loaded", status: "skipped" },
            { channelId: "loading", status: "skipped" },
            { channelId: "denied", status: "skipped" },
        ],
    });
});

test("limits one warmup pass to the requested channel budget", async () => {
    const requested: string[] = [];
    const result = await warmupChannels<TestChannel, TestMessage>({
        enumerateChannels: () => ["a", "b", "c", "d"].map(id => ({ id, priority: 0 })),
        getCurrentChannelId: () => null,
        canReadChannel: () => true,
        isChannelFetched: () => false,
        isChannelLoading: () => false,
        getPriority: channel => channel.priority,
        fetchMessages: request => {
            requested.push(request.channelId);
            return Promise.resolve([{ id: request.channelId }]);
        },
        onMessages: () => undefined,
        isCurrent: () => true,
        concurrency: 2,
        maxChannels: 2,
    });
    assert.deepEqual(requested, ["a", "b"]);
    assert.equal(result.unique, 2);
});

test("keeps lower-priority channel buckets represented in a bounded pass", async () => {
    const requested: string[] = [];
    await warmupChannels<TestChannel, TestMessage>({
        enumerateChannels: () => [
            { id: "private-a", priority: 1 },
            { id: "private-b", priority: 1 },
            { id: "guild-a", priority: 2 },
            { id: "guild-b", priority: 2 },
        ],
        getCurrentChannelId: () => null,
        canReadChannel: () => true,
        isChannelFetched: () => false,
        isChannelLoading: () => false,
        getPriority: channel => channel.priority,
        fetchMessages: request => {
            requested.push(request.channelId);
            return Promise.resolve([{ id: request.channelId }]);
        },
        onMessages: () => undefined,
        isCurrent: () => true,
        maxChannels: 3,
    });
    assert.equal(requested.length, 3);
    assert.ok(requested.some(id => id.startsWith("private-")));
    assert.ok(requested.some(id => id.startsWith("guild-")));
});

test("uses the default concurrency bound and preserves result order", async () => {
    const calls: string[] = [];
    const releases: Array<() => void> = [];
    let active = 0;
    let maximumActive = 0;

    const warmup = warmupChannels<TestChannel, TestMessage>({
        enumerateChannels: () => ["a", "b", "c", "d"].map(id => ({ id, priority: 0 })),
        getCurrentChannelId: () => null,
        canReadChannel: () => true,
        isChannelFetched: () => false,
        isChannelLoading: () => false,
        getPriority: channel => channel.priority,
        fetchMessages: request => {
            calls.push(request.channelId);
            active++;
            maximumActive = Math.max(maximumActive, active);
            return new Promise(resolve => {
                releases.push(() => {
                    active--;
                    resolve([{ id: request.channelId }]);
                });
            });
        },
        onMessages: () => undefined,
        isCurrent: () => true,
    });

    await nextTurn();
    assert.deepEqual(calls, ["a", "b", "c"]);
    assert.equal(maximumActive, 3);

    while (releases.length > 0) {
        const release = releases.shift();
        if (release === undefined) break;
        release();
        await nextTurn();
    }

    const result = await warmup;
    assert.equal(maximumActive, 3);
    assert.deepEqual(calls, ["a", "b", "c", "d"]);
    assert.deepEqual(result.channels, [
        { channelId: "a", status: "processed" },
        { channelId: "b", status: "processed" },
        { channelId: "c", status: "processed" },
        { channelId: "d", status: "processed" },
    ]);
});

test("stops before starting another channel when the generation becomes stale", async () => {
    let current = true;
    const requests: string[] = [];
    const processed: string[] = [];

    const result = await warmupChannels<TestChannel, TestMessage>({
        enumerateChannels: () => [
            { id: "current", priority: 0 },
            { id: "next", priority: 0 },
            { id: "last", priority: 0 },
        ],
        getCurrentChannelId: () => "current",
        canReadChannel: () => true,
        isChannelFetched: () => false,
        isChannelLoading: () => false,
        getPriority: channel => channel.priority,
        fetchMessages: async request => {
            requests.push(request.channelId);
            return [{ id: request.channelId }];
        },
        onMessages: channelId => {
            processed.push(channelId);
            current = false;
        },
        isCurrent: () => current,
        concurrency: 1,
    });

    assert.deepEqual(requests, ["current"]);
    assert.deepEqual(processed, ["current"]);
    assert.equal(result.stopped, true);
    assert.equal(result.processed, 1);
    assert.equal(result.cancelled, 2);
    assert.deepEqual(result.channels, [
        { channelId: "current", status: "processed" },
        { channelId: "next", status: "cancelled" },
        { channelId: "last", status: "cancelled" },
    ]);
});

test("does not deliver a fetched page after the generation becomes stale", async () => {
    let current = true;
    let delivered = false;

    const result = await warmupChannels<TestChannel, TestMessage>({
        enumerateChannels: () => [
            { id: "first", priority: 0 },
            { id: "second", priority: 0 },
        ],
        getCurrentChannelId: () => null,
        canReadChannel: () => true,
        isChannelFetched: () => false,
        isChannelLoading: () => false,
        getPriority: channel => channel.priority,
        fetchMessages: async request => {
            current = false;
            return [{ id: request.channelId }];
        },
        onMessages: () => {
            delivered = true;
        },
        isCurrent: () => current,
        concurrency: 1,
    });

    assert.equal(delivered, false);
    assert.equal(result.fetched, 1);
    assert.equal(result.processed, 0);
    assert.equal(result.cancelled, 2);
    assert.equal(result.stopped, true);
    assert.deepEqual(result.channels, [
        { channelId: "first", status: "cancelled" },
        { channelId: "second", status: "cancelled" },
    ]);
});

test("continues after fetch and callback failures", async () => {
    const result = await warmupChannels<TestChannel, TestMessage>({
        enumerateChannels: () => [
            { id: "fetch-fails", priority: 0 },
            { id: "callback-fails", priority: 0 },
            { id: "works", priority: 0 },
        ],
        getCurrentChannelId: () => null,
        canReadChannel: () => true,
        isChannelFetched: () => false,
        isChannelLoading: () => false,
        getPriority: channel => channel.priority,
        fetchMessages: async request => {
            if (request.channelId === "fetch-fails") throw new Error("network failure");
            return [{ id: request.channelId }];
        },
        onMessages: channelId => {
            if (channelId === "callback-fails") throw new Error("processing failure");
        },
        isCurrent: () => true,
        concurrency: 2,
    });

    assert.equal(result.attempted, 3);
    assert.equal(result.fetched, 2);
    assert.equal(result.processed, 1);
    assert.equal(result.failed, 2);
    assert.equal(result.stopped, false);
    assert.deepEqual(result.channels, [
        { channelId: "fetch-fails", status: "failed" },
        { channelId: "callback-fails", status: "failed" },
        { channelId: "works", status: "processed" },
    ]);
});
