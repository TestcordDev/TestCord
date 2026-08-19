/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { ApplicationCommandIndexStore, AuthenticationStore, ChannelStore, FluxDispatcher, RestAPI, SnowflakeUtils } from "@webpack/common";
const DISBOARD_APP_ID = "302050872383242240";
const BUMP_COMMAND_NAME = "bump";
const BUMP_INTERVAL_MS = 120 * 60 * 1000;
const MIN_BETWEEN_SENDS_MS = 2_000;
const MAX_BETWEEN_SENDS_MS = 5_000;
const SCAN_INTERVAL_MS = 15_000;
const logger = new Logger("AutoBump");
const settings = definePluginSettings({
    channelIds: {
        type: 0 /* OptionType.STRING */,
        description: "Channel IDs to auto bump in (comma, space, or newline separated).",
        default: "",
        placeholder: "123456789012345678, 987654321098765432"
    }
});
let running = false;
let scanTimer = null;
let sendQueue = [];
let queuedChannels = new Set();
let nextAllowedAt = new Map();
let queueWorkerPromise = null;
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function requestCommandIndexRefresh(channelId) {
    FluxDispatcher.dispatch({
        type: "APPLICATION_COMMAND_INDEX_FETCH_REQUEST",
        target: { type: "channel", channelId }
    });
    const guildId = ChannelStore.getChannel(channelId)?.guild_id;
    if (guildId) {
        FluxDispatcher.dispatch({
            type: "APPLICATION_COMMAND_INDEX_FETCH_REQUEST",
            target: { type: "guild", guildId }
        });
    }
    FluxDispatcher.dispatch({
        type: "APPLICATION_COMMAND_INDEX_FETCH_REQUEST",
        target: { type: "application", applicationId: DISBOARD_APP_ID }
    });
}
function parseChannelIds(raw) {
    if (!raw?.trim())
        return [];
    const unique = new Set();
    for (const token of raw.split(/[\s,]+/g)) {
        const id = token.trim();
        if (!id)
            continue;
        if (!/^\d{17,20}$/.test(id))
            continue;
        unique.add(id);
    }
    return [...unique];
}
function cleanupStateForRemovedChannels(validIds) {
    for (const channelId of [...nextAllowedAt.keys()]) {
        if (!validIds.has(channelId)) {
            nextAllowedAt.delete(channelId);
        }
    }
    sendQueue = sendQueue.filter(id => validIds.has(id));
    queuedChannels = new Set(sendQueue);
}
function enqueueChannel(channelId) {
    if (queuedChannels.has(channelId))
        return;
    sendQueue.push(channelId);
    queuedChannels.add(channelId);
}
async function processQueue() {
    if (queueWorkerPromise)
        return;
    queueWorkerPromise = (async () => {
        while (running && sendQueue.length > 0) {
            const channelId = sendQueue.shift();
            if (!channelId)
                continue;
            queuedChannels.delete(channelId);
            const channel = ChannelStore.getChannel(channelId);
            if (!channel) {
                logger.warn(`Skipping unknown channel ${channelId}`);
                nextAllowedAt.set(channelId, Date.now() + 60_000);
                continue;
            }
            try {
                await executeBumpCommand(channelId);
                nextAllowedAt.set(channelId, Date.now() + BUMP_INTERVAL_MS);
                logger.info(`Sent /${BUMP_COMMAND_NAME} in #${channel.name ?? channelId}`);
            }
            catch (error) {
                logger.error(`Failed to send /${BUMP_COMMAND_NAME} in ${channelId}`, error);
                nextAllowedAt.set(channelId, Date.now() + 60_000);
            }
            if (!running || sendQueue.length <= 0)
                continue;
            await wait(randomInt(MIN_BETWEEN_SENDS_MS, MAX_BETWEEN_SENDS_MS));
        }
    })().finally(() => {
        queueWorkerPromise = null;
    });
}
function scheduleDueChannels() {
    const channels = parseChannelIds(settings.store.channelIds);
    const validIds = new Set(channels);
    cleanupStateForRemovedChannels(validIds);
    const now = Date.now();
    for (const channelId of channels) {
        const dueAt = nextAllowedAt.get(channelId) ?? 0;
        if (dueAt <= now) {
            enqueueChannel(channelId);
        }
    }
    void processQueue();
}
function findBumpCommand(channelId) {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel)
        return null;
    const result = ApplicationCommandIndexStore.query({ type: "channel", channel }, {
        commandTypes: [1],
        text: BUMP_COMMAND_NAME,
        builtIns: "deny",
        applicationCommands: true
    }, {
        allowFetch: true,
        allowApplicationState: true
    });
    if (!result?.commands?.length)
        return null;
    return result.commands.find(cmd => cmd.applicationId === DISBOARD_APP_ID
        && (cmd.untranslatedName?.toLowerCase?.() === BUMP_COMMAND_NAME || cmd.displayName?.toLowerCase?.() === BUMP_COMMAND_NAME)) ?? result.commands.find(cmd => cmd.untranslatedName?.toLowerCase?.() === BUMP_COMMAND_NAME || cmd.displayName?.toLowerCase?.() === BUMP_COMMAND_NAME) ?? null;
}
async function executeBumpCommand(channelId) {
    let command = findBumpCommand(channelId);
    if (!command) {
        requestCommandIndexRefresh(channelId);
        // Discord can take a moment to populate command indexes.
        for (let attempt = 0; attempt < 4 && !command; attempt++) {
            await wait(750);
            command = findBumpCommand(channelId);
        }
    }
    if (!command) {
        throw new Error("Could not find DISBOARD /bump command after refreshing command index.");
    }
    const appCommandId = command.rootCommand?.id ?? command.id;
    const appCommandVersion = command.rootCommand?.version ?? command.version;
    if (!appCommandId || !appCommandVersion) {
        throw new Error("Missing command id/version for /bump.");
    }
    const subCommandPath = command.subCommandPath?.map(opt => ({ type: opt.type, name: opt.name })) ?? [];
    const options = subCommandPath.length ? [{ type: 1, name: subCommandPath[0].name, options: [] }] : [];
    const sessionId = AuthenticationStore.getSessionId?.();
    if (!sessionId)
        throw new Error("Missing Discord session id for interaction.");
    const payload = {
        type: 2,
        application_id: command.applicationId,
        guild_id: ChannelStore.getChannel(channelId)?.guild_id ?? null,
        channel_id: channelId,
        session_id: sessionId,
        nonce: SnowflakeUtils.fromTimestamp(Date.now()),
        data: {
            version: appCommandVersion,
            id: appCommandId,
            name: command.rootCommand?.name ?? command.untranslatedName ?? BUMP_COMMAND_NAME,
            type: 1,
            options,
            application_command: {
                id: appCommandId,
                type: 1,
                application_id: command.applicationId,
                version: appCommandVersion,
                name: command.rootCommand?.name ?? command.untranslatedName ?? BUMP_COMMAND_NAME,
                description: command.rootCommand?.description ?? command.untranslatedDescription ?? ""
            }
        }
    };
    await RestAPI.post({
        url: "/interactions",
        body: payload
    });
}
export default definePlugin({
    name: "AutoBump",
    description: "Automatically sends DISBOARD /bump on a timer. This is considered selfbot behavior and can get you banned.",
    tags: ["Servers", "Utility"],
    authors: [TestcordDevs.x2b],
    settings,
    start() {
        running = true;
        sendQueue = [];
        queuedChannels = new Set();
        nextAllowedAt = new Map();
        scheduleDueChannels();
        scanTimer = setInterval(scheduleDueChannels, SCAN_INTERVAL_MS);
        logger.info("AutoBump started");
    },
    stop() {
        running = false;
        if (scanTimer) {
            clearInterval(scanTimer);
            scanTimer = null;
        }
        sendQueue = [];
        queuedChannels.clear();
        nextAllowedAt.clear();
        logger.info("AutoBump stopped");
    }
});
