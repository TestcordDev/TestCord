/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const CHANNEL_WARMUP_MESSAGE_LIMIT = 50;
export const DEFAULT_CHANNEL_WARMUP_CONCURRENCY = 3;

export interface ChannelWarmupChannel {
    id: string;
}

export type ChannelWarmupStatus = "processed" | "skipped" | "failed" | "cancelled";

export interface ChannelWarmupChannelResult {
    channelId: string;
    status: ChannelWarmupStatus;
}

export interface ChannelWarmupResult {
    discovered: number;
    unique: number;
    attempted: number;
    fetched: number;
    processed: number;
    skipped: number;
    failed: number;
    cancelled: number;
    stopped: boolean;
    channels: readonly ChannelWarmupChannelResult[];
}

export interface ChannelWarmupFetchRequest {
    channelId: string;
    limit: number;
}

export interface ChannelWarmupOptions<TChannel extends ChannelWarmupChannel, TMessage> {
    enumerateChannels: () => Iterable<TChannel>;
    getCurrentChannelId: () => string | null | undefined;
    canReadChannel: (channel: TChannel) => boolean;
    isChannelFetched: (channelId: string) => boolean;
    isChannelLoading: (channelId: string) => boolean;
    getPriority: (channel: TChannel) => number;
    fetchMessages: (request: ChannelWarmupFetchRequest) => Promise<readonly TMessage[]>;
    onMessages: (channelId: string, messages: readonly TMessage[]) => void | Promise<void>;
    onError?: (channelId: string, error: unknown) => void;
    isCurrent?: () => boolean;
    concurrency?: number;
    maxChannels?: number;
    processFetched?: boolean;
}

interface ChannelCandidate<TChannel extends ChannelWarmupChannel> {
    channel: TChannel;
    current: boolean;
    order: number;
    priority: number;
    priorityFailed: boolean;
    status: ChannelWarmupStatus;
}

function normalizePriority(priority: number): number {
    return Number.isFinite(priority) ? priority : 0;
}

function getConcurrency(concurrency: number | undefined): number {
    if (concurrency === undefined || !Number.isFinite(concurrency)) return DEFAULT_CHANNEL_WARMUP_CONCURRENCY;
    return Math.max(1, Math.floor(concurrency));
}

function applyChannelBudget<TChannel extends ChannelWarmupChannel>(candidates: ChannelCandidate<TChannel>[], maxChannels: number | undefined) {
    if (maxChannels === undefined || !Number.isFinite(maxChannels)) return;
    const limit = Math.max(1, Math.floor(maxChannels));
    if (candidates.length <= limit) return;

    const selected: ChannelCandidate<TChannel>[] = [];
    const selectedIds = new Set<string>();
    for (const candidate of candidates) {
        if (!candidate.current || selected.length >= limit) continue;
        selected.push(candidate);
        selectedIds.add(candidate.channel.id);
    }

    const groups = new Map<number, ChannelCandidate<TChannel>[]>();
    for (const candidate of candidates) {
        if (selectedIds.has(candidate.channel.id)) continue;
        const group = groups.get(candidate.priority) ?? [];
        group.push(candidate);
        groups.set(candidate.priority, group);
    }
    const indexes = new Map<number, number>();
    const priorities = [...groups.keys()].sort((left, right) => left - right);
    while (selected.length < limit) {
        let added = false;
        for (const priority of priorities) {
            const group = groups.get(priority);
            const index = indexes.get(priority) ?? 0;
            const candidate = group?.[index];
            if (!candidate) continue;
            indexes.set(priority, index + 1);
            selected.push(candidate);
            added = true;
            if (selected.length >= limit) break;
        }
        if (!added) break;
    }
    candidates.splice(0, candidates.length, ...selected);
}

export async function warmupChannels<TChannel extends ChannelWarmupChannel, TMessage>(
    options: ChannelWarmupOptions<TChannel, TMessage>,
): Promise<ChannelWarmupResult> {
    const isCurrent = options.isCurrent ?? (() => true);
    let stopped = false;

    const isStillCurrent = (): boolean => {
        if (stopped) return false;
        try {
            if (isCurrent()) return true;
        } catch {
            stopped = true;
            return false;
        }
        stopped = true;
        return false;
    };

    if (!isStillCurrent()) {
        return {
            discovered: 0,
            unique: 0,
            attempted: 0,
            fetched: 0,
            processed: 0,
            skipped: 0,
            failed: 0,
            cancelled: 0,
            stopped: true,
            channels: [],
        };
    }

    let currentChannelId: string | null | undefined;
    try {
        currentChannelId = options.getCurrentChannelId();
    } catch {
        currentChannelId = undefined;
    }

    const uniqueChannels = new Map<string, TChannel>();
    let discovered = 0;
    try {
        for (const channel of options.enumerateChannels()) {
            discovered++;
            if (!uniqueChannels.has(channel.id)) uniqueChannels.set(channel.id, channel);
        }
    } catch (error) {
        void error;
    }

    const candidates: ChannelCandidate<TChannel>[] = [];
    let order = 0;
    for (const channel of uniqueChannels.values()) {
        const candidate: ChannelCandidate<TChannel> = {
            channel,
            current: channel.id === currentChannelId,
            order,
            priority: 0,
            priorityFailed: false,
            status: "cancelled",
        };
        order++;

        if (isStillCurrent()) {
            try {
                candidate.priority = normalizePriority(options.getPriority(channel));
            } catch {
                candidate.priorityFailed = true;
            }
        }
        candidates.push(candidate);
    }

    candidates.sort((left, right) => {
        if (left.current !== right.current) return left.current ? -1 : 1;
        if (left.priority !== right.priority) return left.priority - right.priority;
        return left.order - right.order;
    });
    applyChannelBudget(candidates, options.maxChannels);

    let nextIndex = 0;
    let attempted = 0;
    let fetched = 0;

    const processCandidate = async (candidate: ChannelCandidate<TChannel>): Promise<void> => {
        if (!isStillCurrent()) return;

        if (candidate.priorityFailed) {
            candidate.status = "failed";
            return;
        }

        try {
            if (!options.canReadChannel(candidate.channel)) {
                candidate.status = "skipped";
                return;
            }
            if (!isStillCurrent()) return;

            if (!options.processFetched && (options.isChannelFetched(candidate.channel.id) || options.isChannelLoading(candidate.channel.id))) {
                candidate.status = "skipped";
                return;
            }
            if (!isStillCurrent()) return;

            attempted++;
            const messages = await options.fetchMessages({
                channelId: candidate.channel.id,
                limit: CHANNEL_WARMUP_MESSAGE_LIMIT,
            });
            fetched++;

            if (!isStillCurrent()) return;
            await options.onMessages(candidate.channel.id, messages);
            candidate.status = "processed";
        } catch (error) {
            if (isStillCurrent()) {
                try { options.onError?.(candidate.channel.id, error); } catch (callbackError) {
                    void callbackError;
                }
            }
            candidate.status = isStillCurrent() ? "failed" : "cancelled";
        }
    };

    const worker = async (): Promise<void> => {
        while (true) {
            if (!isStillCurrent() || nextIndex >= candidates.length) return;
            const candidate = candidates[nextIndex];
            nextIndex++;
            if (candidate === undefined) return;
            await processCandidate(candidate);
        }
    };

    const workerCount = Math.min(getConcurrency(options.concurrency), candidates.length);
    const workers: Promise<void>[] = [];
    for (let index = 0; index < workerCount; index++) workers.push(worker());
    await Promise.all(workers);

    let processed = 0;
    let skipped = 0;
    let failed = 0;
    let cancelled = 0;
    for (const candidate of candidates) {
        if (candidate.status === "processed") processed++;
        else if (candidate.status === "skipped") skipped++;
        else if (candidate.status === "failed") failed++;
        else cancelled++;
    }

    return {
        discovered,
        unique: candidates.length,
        attempted,
        fetched,
        processed,
        skipped,
        failed,
        cancelled,
        stopped,
        channels: candidates.map(candidate => ({
            channelId: candidate.channel.id,
            status: candidate.status,
        })),
    };
}
