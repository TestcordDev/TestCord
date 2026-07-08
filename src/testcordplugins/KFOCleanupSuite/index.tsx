/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// src/userplugins/KFOCleanupSuite/index.tsx
import {
    ApplicationCommandInputType,
    ApplicationCommandOptionType,
    sendBotMessage,
} from "@api/Commands";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { sleep } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import { RestAPI, UserStore } from "@webpack/common";

const settings = definePluginSettings({
    // General search and delete settings
    searchDelay: {
        type: OptionType.NUMBER,
        default: 800,
        description: "Delay between search operations (ms)",
    },
    deleteDelay: {
        type: OptionType.NUMBER,
        default: 800,
        description: "Delay between deleting each message (ms)",
    },
    maxBatch: {
        type: OptionType.NUMBER,
        default: 25,
        description: "Maximum number of messages per batch",
    },
    progressStep: {
        type: OptionType.NUMBER,
        default: 50,
        description: "Send progress message every N messages (0 = no progress)",
    },
    maxSearchRounds: {
        type: OptionType.NUMBER,
        default: 5,
        description: "Maximum consecutive rounds with no messages found before stopping",
    },
    maxTotalDeletes: {
        type: OptionType.NUMBER,
        default: 2000,
        description: "Maximum messages to delete in one session (0 = unlimited)",
    },

    // Smart Cleanup settings
    spamMaxLength: {
        type: OptionType.NUMBER,
        default: 3,
        description: "Maximum length to consider message as spam (g, ok, .)",
    },
    trackedDays: {
        type: OptionType.NUMBER,
        default: 7,
        description: "Maximum age of messages (in days) to process",
    },
    protectedUsers: {
        type: OptionType.STRING,
        default: "",
        description: "User IDs whose messages will never be deleted (comma-separated)",
        placeholder: "123,456,789",
    },
    ignoredBots: {
        type: OptionType.STRING,
        default: "",
        description: "Bot IDs whose messages won't be deleted",
        placeholder: "botId1,botId2",
    },
});

type DeleteMode = "mine" | "all";
type CleanMode = "spam" | "media" | "between";

interface ChannelState {
    running: boolean;
    count: number;
    start: number;
}

const deleteStates: Record<string, ChannelState> = {};

function getDeleteState(channelId: string): ChannelState {
    if (!deleteStates[channelId]) {
        deleteStates[channelId] = {
            running: false,
            count: 0,
            start: 0,
        };
    }
    return deleteStates[channelId];
}

function getGuildId(ctx: any): string | null {
    return ctx.guild?.id ?? ctx.guildId ?? null;
}

async function searchMessages(
    channelId: string,
    authorId?: string,
    guildId?: string,
    offset = 0
) {
    const params: any = {
        include_nsfw: true,
        offset,
        channel_id: channelId,
    };
    if (authorId) params.author_id = authorId;

    const qs = new URLSearchParams(params).toString();
    const url = guildId
        ? `/guilds/${guildId}/messages/search?${qs}`
        : `/channels/${channelId}/messages/search?${qs}`;

    const res = await RestAPI.get({ url });
    return (res.body?.messages?.flat() ?? []) as any[];
}

async function deleteOne(channelId: string, msgId: string) {
    await RestAPI.del({ url: `/channels/${channelId}/messages/${msgId}` });
}

function parseIds(str: string): string[] {
    return str
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);
}

function isOld(msg: any): boolean {
    const days = settings.store.trackedDays;
    if (!msg.timestamp) return false;
    const ts = new Date(msg.timestamp).getTime();
    const diffDays = (Date.now() - ts) / (1000 * 60 * 60 * 24);
    return diffDays > days;
}

function isFromProtected(msg: any): boolean {
    const protectedIds = parseIds(settings.store.protectedUsers);
    if (!msg.author?.id) return false;
    return protectedIds.includes(msg.author.id);
}

function isFromIgnoredBot(msg: any): boolean {
    if (!msg.author?.bot) return false;
    const ids = parseIds(settings.store.ignoredBots);
    return ids.includes(msg.author.id);
}

function isShortSpam(msg: any): boolean {
    if (!msg.content) return false;
    const c = msg.content.trim();
    return c.length > 0 && c.length <= settings.store.spamMaxLength;
}

function isMedia(msg: any): boolean {
    return (msg.attachments?.length ?? 0) > 0 || (msg.embeds?.length ?? 0) > 0;
}

async function runCleanup(ctx: any, mode: CleanMode, extra?: { fromId?: string; toId?: string; }) {
    const channelId = ctx.channel.id;
    const state = { running: true, count: 0, start: Date.now() };

    sendBotMessage(channelId, {
        content:
            mode === "spam"
                ? "🧹 Starting cleanup of short/spam messages..."
                : mode === "media"
                    ? "🧹 Deleting media messages (images/videos/files)..."
                    : "🧹 Deleting messages between two messages...",
    });

    try {
        let offset = 0;
        let empty = 0;
        const maxRounds = settings.store.maxSearchRounds || 3;
        const maxTotal = settings.store.maxTotalDeletes || 0;

        while (state.running && empty < maxRounds) {
            if (maxTotal > 0 && state.count >= maxTotal) break;

            await sleep(settings.store.searchDelay);

            let msgs: any[];
            try {
                msgs = await searchMessages(channelId, undefined, undefined, offset);
            } catch (e: any) {
                console.error("[Cleanup] SEARCH ERROR", e);
                sendBotMessage(channelId, {
                    content: `❌ Error searching for messages: ${e?.status ?? ""} ${e?.body?.message ?? ""}`,
                });
                break;
            }

            if (!msgs.length) {
                empty++;
                offset = 0;
                continue;
            }

            empty = 0;

            for (const msg of msgs.slice(0, settings.store.maxBatch)) {
                if (!state.running) break;
                if (maxTotal > 0 && state.count >= maxTotal) break;

                if (isOld(msg)) continue;
                if (isFromProtected(msg)) continue;
                if (isFromIgnoredBot(msg)) continue;

                let shouldDelete = false;

                if (mode === "spam") {
                    shouldDelete = isShortSpam(msg);
                } else if (mode === "media") {
                    shouldDelete = isMedia(msg);
                } else if (mode === "between") {
                    const fromId = extra?.fromId;
                    const toId = extra?.toId;
                    if (!fromId || !toId) continue;

                    if (msg.id === fromId || msg.id === toId) {
                        shouldDelete = true;
                    } else {
                        const idNum = BigInt(msg.id);
                        const a = BigInt(fromId);
                        const b = BigInt(toId);
                        const min = a < b ? a : b;
                        const max = a > b ? a : b;
                        shouldDelete = idNum > min && idNum < max;
                    }
                }

                if (!shouldDelete) continue;

                await sleep(settings.store.deleteDelay);
                try {
                    await deleteOne(channelId, msg.id);
                    state.count++;
                } catch (e: any) {
                    console.error("[Cleanup] DELETE ERROR", e);
                    if (e?.status === 429) {
                        const retry = e?.body?.retry_after
                            ? Math.ceil(e.body.retry_after * 1000)
                            : 5000;
                        await sleep(retry);
                    }
                }
            }

            offset += 25;
        }

        const elapsed = Math.round((Date.now() - state.start) / 1000);
        sendBotMessage(channelId, {
            content: `✅ Cleanup finished (${mode}) | Messages: ${state.count} | Time: ${elapsed}s`,
        });
    } catch (e: any) {
        console.error("[Cleanup] RUN ERROR", e);
        sendBotMessage(channelId, { content: `❌ Error during cleanup: ${e?.message ?? e}` });
    }
}

async function runDelete(ctx: any, mode: DeleteMode) {
    const channelId = ctx.channel.id;
    const guildId = getGuildId(ctx);
    const state = getDeleteState(channelId);

    if (state.running) {
        sendBotMessage(channelId, {
            content: `⏳ Delete operation in progress, deleted so far: ${state.count} messages.`,
        });
        return;
    }

    state.running = true;
    state.count = 0;
    state.start = Date.now();

    sendBotMessage(channelId, {
        content:
            mode === "mine"
                ? "🧹 Deleting your messages in this conversation..."
                : "🔥 Deleting all messages in this conversation...",
    });

    try {
        let offset = 0;
        let emptyCount = 0;
        const step = settings.store.progressStep;
        const maxRounds = settings.store.maxSearchRounds || 3;
        const maxTotal = settings.store.maxTotalDeletes || 0;

        while (state.running && emptyCount < maxRounds) {
            if (maxTotal > 0 && state.count >= maxTotal) break;

            await sleep(settings.store.searchDelay);

            let msgs: any[];
            try {
                msgs = await searchMessages(
                    channelId,
                    mode === "mine" ? UserStore.getCurrentUser().id : undefined,
                    guildId as any,
                    offset
                );
            } catch (e: any) {
                console.error("[Delete] SEARCH ERROR", e);
                sendBotMessage(channelId, {
                    content: `❌ Error searching for messages: ${e?.status ?? ""} ${e?.body?.message ?? ""}`,
                });
                break;
            }

            if (!msgs.length) {
                emptyCount++;
                offset = 0;
                continue;
            }

            emptyCount = 0;

            for (const msg of msgs.slice(0, settings.store.maxBatch)) {
                if (!state.running) break;
                if (maxTotal > 0 && state.count >= maxTotal) break;

                if (msg.channel_id !== channelId) continue;
                if (mode === "mine" && msg.author?.id !== UserStore.getCurrentUser().id) continue;

                await sleep(settings.store.deleteDelay);

                try {
                    await deleteOne(channelId, msg.id);
                    state.count++;

                    if (step > 0 && state.count % step === 0) {
                        const elapsed = Math.round((Date.now() - state.start) / 1000);
                        sendBotMessage(channelId, {
                            content: `⚡ Deleted ${state.count} messages so far | Time: ${elapsed}s`,
                        });
                    }
                } catch (e: any) {
                    console.error("[Delete] DELETE ERROR", e);
                    const status = e?.status;
                    const msgErr = e?.body?.message;

                    if (status === 429) {
                        const retry = e?.body?.retry_after
                            ? Math.ceil(e.body.retry_after * 1000)
                            : 5000;
                        await sleep(retry);
                        continue;
                    }

                    sendBotMessage(channelId, {
                        content: `❌ Delete error: ${status ?? "unknown"} ${msgErr ?? ""}`,
                    });
                }
            }

            offset += 25;
        }

        const elapsed = Math.round((Date.now() - state.start) / 1000);
        sendBotMessage(channelId, {
            content: `✅ Delete finished | Messages: ${state.count} | Time: ${elapsed}s ✅`,
        });
    } catch (e: any) {
        console.error("[Delete] RUN ERROR", e);
        sendBotMessage(channelId, {
            content: `❌ Unexpected error during deletion: ${e?.message ?? e}`,
        });
    } finally {
        state.running = false;
    }
}

async function stopDelete(ctx: any) {
    const channelId = ctx.channel.id;
    const state = deleteStates[channelId];

    if (state?.running) {
        state.running = false;
        const elapsed = Math.round((Date.now() - state.start) / 1000);
        sendBotMessage(channelId, {
            content: `⏹️ Delete stopped | Deleted: ${state.count} messages | Time: ${elapsed}s`,
        });
    } else {
        sendBotMessage(channelId, {
            content: "🚫 No delete operation currently running.",
        });
    }
}

export default definePlugin({
    name: "Smart Cleanup Suite",
    description: "Delete your messages or all messages + cleanup spam, media, and messages between two points",
    tags: ["Utility", "Developers"],
    authors: [TestcordDevs.SirPhantom89,],
    settings,
    commands: [
        // Regular delete commands
        {
            name: "delete",
            description: "🧹 Delete only your messages in this conversation",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: (_, ctx) => runDelete(ctx, "mine"),
        },
        {
            name: "delete-all",
            description: "🔥 Delete all messages (requires server permissions)",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: (_, ctx) => runDelete(ctx, "all"),
        },
        {
            name: "stop-delete",
            description: "⏹️ Stop the current delete operation",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: (_, ctx) => stopDelete(ctx),
        },

        // Smart Cleanup commands
        {
            name: "clean-spam",
            description: "🧹 Delete short/spam messages in this channel",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: (_, ctx) => runCleanup(ctx, "spam"),
        },
        {
            name: "clean-media",
            description: "🧹 Delete messages containing media (images/videos/files)",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: (_, ctx) => runCleanup(ctx, "media"),
        },
        {
            name: "clean-between",
            description: "🧹 Delete messages between two messages (provide from-to IDs)",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "from",
                    description: "Starting Message ID",
                    type: ApplicationCommandOptionType.STRING,
                    required: true,
                },
                {
                    name: "to",
                    description: "Ending Message ID",
                    type: ApplicationCommandOptionType.STRING,
                    required: true,
                },
            ],
            execute: (opts, ctx) => {
                const fromId = String(opts[0].value);
                const toId = String(opts[1].value);
                return runCleanup(ctx, "between", { fromId, toId });
            },
        },
    ],
});
