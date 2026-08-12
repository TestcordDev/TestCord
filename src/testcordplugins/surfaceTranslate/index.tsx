/*
 * OpenCord, a Discord client mod
 * Copyright (c) 2026 OpenCord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OpenCordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import type { Channel, Message } from "@vencord/discord-types";
import { ChannelStore, FluxDispatcher, MessageStore } from "@webpack/common";

const logger = new Logger("SurfaceTranslate");

interface CachedTranslation {
    original: string;
    translated: string;
}

interface MessageWithContent extends Message {
    content: string;
}

const translationCache = new Map<string, CachedTranslation>();
const skippedTranslations = new Set<string>();
const inProgress = new Set<string>();
const abortControllers = new Set<AbortController>();

let generation = 0;
let originalGetChannel: typeof ChannelStore.getChannel | undefined;
let originalGetBasicChannel: typeof ChannelStore.getBasicChannel | undefined;
let originalGetDMChannelFromUserId: typeof ChannelStore.getDMChannelFromUserId | undefined;
let originalGetMutableBasicGuildChannelsForGuild: typeof ChannelStore.getMutableBasicGuildChannelsForGuild | undefined;
let originalGetMutableGuildChannelsForGuild: typeof ChannelStore.getMutableGuildChannelsForGuild | undefined;
let originalGetMutablePrivateChannels: typeof ChannelStore.getMutablePrivateChannels | undefined;
let originalGetInitialOverlayState: typeof ChannelStore.getInitialOverlayState | undefined;
let originalGetAllThreadsForGuild: typeof ChannelStore.getAllThreadsForGuild | undefined;
let originalGetAllThreadsForParent: typeof ChannelStore.getAllThreadsForParent | undefined;
let originalGetSortedLinkedChannelsForGuild: typeof ChannelStore.getSortedLinkedChannelsForGuild | undefined;
let originalGetSortedPrivateChannels: typeof ChannelStore.getSortedPrivateChannels | undefined;

function resetTranslations() {
    generation++;
    translationCache.clear();
    skippedTranslations.clear();
    inProgress.clear();

    for (const controller of abortControllers) controller.abort();
    abortControllers.clear();
}

const settings = definePluginSettings({
    targetLanguage: {
        type: OptionType.STRING,
        description: "Target language code for surface translations.",
        default: "en",
        onChange: resetTranslations,
    },
    translateChannelNames: {
        type: OptionType.BOOLEAN,
        description: "Translate guild channel and thread names.",
        default: true,
    },
    translateChannelTopics: {
        type: OptionType.BOOLEAN,
        description: "Translate guild channel topics and descriptions.",
        default: true,
    },
    translateSearchResults: {
        type: OptionType.BOOLEAN,
        description: "Translate message text when Discord renders search results.",
        default: true,
    },
    showOriginal: {
        type: OptionType.BOOLEAN,
        description: "Show the original text next to translated channel names and topics.",
        default: false,
    },
});

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function getTranslationCacheKey(kind: string, id: string, text: string) {
    return `${settings.store.targetLanguage}:${kind}:${id}:${text}`;
}

function getTranslatedText(kind: string, id: string, text: string, onTranslated: () => void): string | undefined {
    const trimmed = text.trim();
    if (!trimmed) return;

    const key = getTranslationCacheKey(kind, id, trimmed);
    if (skippedTranslations.has(key)) return;

    const cached = translationCache.get(key);
    if (cached?.original === trimmed) return cached.translated;

    queueTranslation(key, trimmed, onTranslated);
}

function queueTranslation(key: string, text: string, onTranslated: () => void) {
    if (inProgress.has(key)) return;

    const currentGeneration = generation;
    const controller = new AbortController();
    inProgress.add(key);
    abortControllers.add(controller);

    fetchTranslation(text, controller.signal).then(translated => {
        if (generation !== currentGeneration) return;
        if (!translated || translated === text) {
            skippedTranslations.add(key);
            return;
        }

        translationCache.set(key, { original: text, translated });
        onTranslated();
    }).catch(error => {
        if (error instanceof Error && error.name === "AbortError") return;
        logger.warn("Surface translation failed", error);
    }).finally(() => {
        inProgress.delete(key);
        abortControllers.delete(controller);
    });
}

function getBaseLanguage(language: string) {
    return language.toLowerCase().split(/[-_]/)[0];
}

async function fetchTranslation(text: string, signal: AbortSignal): Promise<string | null> {
    const targetLanguage = settings.store.targetLanguage.trim();
    const targetBaseLanguage = getBaseLanguage(targetLanguage);
    if (!targetBaseLanguage) return null;

    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLanguage)}&dt=t&dj=1&q=${encodeURIComponent(text)}`;
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Translation API returned ${response.status} ${response.statusText}`);

    const data: unknown = await response.json();
    if (!isRecord(data) || !Array.isArray(data.sentences)) return null;

    const sourceLanguage = typeof data.src === "string" ? getBaseLanguage(data.src) : "";
    if (sourceLanguage && sourceLanguage === targetBaseLanguage) return null;

    const translated = data.sentences.map(sentence => {
        if (!isRecord(sentence)) return "";
        return typeof sentence.trans === "string" ? sentence.trans : "";
    }).join("").trim();

    return translated || null;
}

function dispatchChannelRefresh(channelId: string) {
    const getChannel = originalGetChannel;
    const channel = getChannel?.call(ChannelStore, channelId);
    if (!channel) return;

    FluxDispatcher.dispatch({
        type: "CHANNEL_UPDATES",
        channels: [channel],
    });
}

function dispatchMessageRefresh(message: MessageWithContent) {
    const current = MessageStore.getMessage(message.channel_id, message.id) as MessageWithContent | undefined;

    FluxDispatcher.dispatch({
        type: "MESSAGE_UPDATE",
        message: current ?? message,
    });
}

function formatTranslatedText(translated: string, original: string) {
    if (!settings.store.showOriginal) return translated;
    return `${translated} (${original})`;
}

function formatTranslatedTopic(translated: string, original: string) {
    if (!settings.store.showOriginal) return translated;
    return `${translated}\n\nOriginal: ${original}`;
}

function getChannelTopic(channel: Channel) {
    const { topic } = channel;
    return typeof topic === "string" ? topic : "";
}

function translateChannel(channel: Channel): Channel;
function translateChannel(channel: null | undefined): null | undefined;
function translateChannel(channel: Channel | null | undefined): Channel | null | undefined {
    if (!channel?.guild_id || typeof channel.merge !== "function") return channel;

    const changes: Record<string, unknown> = {};

    if (settings.store.translateChannelNames && channel.name) {
        const translatedName = getTranslatedText("channel-name", channel.id, channel.name, () => dispatchChannelRefresh(channel.id));
        if (translatedName) changes.name = formatTranslatedText(translatedName, channel.name);
    }

    const topic = getChannelTopic(channel);
    if (settings.store.translateChannelTopics && topic) {
        const translatedTopic = getTranslatedText("channel-topic", channel.id, topic, () => dispatchChannelRefresh(channel.id));
        if (translatedTopic) changes.topic_ = formatTranslatedTopic(translatedTopic, topic);
    }

    return Object.keys(changes).length ? channel.merge(changes) : channel;
}

function translateOptionalChannel(channel: Channel | undefined): Channel | undefined {
    return channel ? translateChannel(channel) : channel;
}

function translateChannelRecord(channels: Record<string, Channel> | null | undefined): Record<string, Channel> {
    if (!channels) return {};

    const translated = { ...channels };
    for (const channelId in channels) translated[channelId] = translateChannel(channels[channelId]);
    return translated;
}

function translateChannelArray(channels: Channel[] | null | undefined): Channel[] {
    return channels ? channels.map(channel => translateChannel(channel)) : [];
}

function hasSearchMarker(value: unknown, depth = 0, seen = new WeakSet<object>()): boolean {
    if (!isRecord(value) || seen.has(value)) return false;
    seen.add(value);

    for (const key of Object.keys(value)) {
        if (key.toLowerCase().includes("search")) return true;
        if (depth < 2 && hasSearchMarker(value[key], depth + 1, seen)) return true;
    }

    return false;
}

function isSearchResultProps(value: unknown): boolean {
    return hasSearchMarker(value);
}

function translateSearchMessage(message: MessageWithContent): MessageWithContent {
    const translated = getTranslatedText("search-message", message.id, message.content, () => dispatchMessageRefresh(message));
    if (!translated) return message;

    return Object.assign(Object.create(Object.getPrototypeOf(message)), message, {
        content: translated,
    }) as MessageWithContent;
}

function patchChannelStore() {
    const { getChannel } = ChannelStore;
    const { getBasicChannel } = ChannelStore;
    const { getDMChannelFromUserId } = ChannelStore;
    const { getMutableBasicGuildChannelsForGuild } = ChannelStore;
    const { getMutableGuildChannelsForGuild } = ChannelStore;
    const { getMutablePrivateChannels } = ChannelStore;
    const { getInitialOverlayState } = ChannelStore;
    const { getAllThreadsForGuild } = ChannelStore;
    const { getAllThreadsForParent } = ChannelStore;
    const { getSortedLinkedChannelsForGuild } = ChannelStore;
    const { getSortedPrivateChannels } = ChannelStore;

    originalGetChannel = getChannel;
    originalGetBasicChannel = getBasicChannel;
    originalGetDMChannelFromUserId = getDMChannelFromUserId;
    originalGetMutableBasicGuildChannelsForGuild = getMutableBasicGuildChannelsForGuild;
    originalGetMutableGuildChannelsForGuild = getMutableGuildChannelsForGuild;
    originalGetMutablePrivateChannels = getMutablePrivateChannels;
    originalGetInitialOverlayState = getInitialOverlayState;
    originalGetAllThreadsForGuild = getAllThreadsForGuild;
    originalGetAllThreadsForParent = getAllThreadsForParent;
    originalGetSortedLinkedChannelsForGuild = getSortedLinkedChannelsForGuild;
    originalGetSortedPrivateChannels = getSortedPrivateChannels;

    ChannelStore.getChannel = function (this: typeof ChannelStore, channelId: string) {
        const channel = getChannel.call(this, channelId);
        return channel ? translateChannel(channel) : channel;
    };
    ChannelStore.getBasicChannel = function (this: typeof ChannelStore, channelId: string) {
        return translateOptionalChannel(getBasicChannel.call(this, channelId));
    };
    ChannelStore.getDMChannelFromUserId = function (this: typeof ChannelStore, userId: string) {
        return translateOptionalChannel(getDMChannelFromUserId.call(this, userId));
    };
    ChannelStore.getMutableBasicGuildChannelsForGuild = function (this: typeof ChannelStore, guildId: string) {
        return translateChannelRecord(getMutableBasicGuildChannelsForGuild.call(this, guildId));
    };
    ChannelStore.getMutableGuildChannelsForGuild = function (this: typeof ChannelStore, guildId: string) {
        return translateChannelRecord(getMutableGuildChannelsForGuild.call(this, guildId));
    };
    ChannelStore.getMutablePrivateChannels = function (this: typeof ChannelStore) {
        return translateChannelRecord(getMutablePrivateChannels.call(this));
    };
    ChannelStore.getInitialOverlayState = function (this: typeof ChannelStore) {
        return translateChannelRecord(getInitialOverlayState.call(this));
    };
    ChannelStore.getAllThreadsForGuild = function (this: typeof ChannelStore, guildId: string) {
        return translateChannelArray(getAllThreadsForGuild.call(this, guildId));
    };
    ChannelStore.getAllThreadsForParent = function (this: typeof ChannelStore, parentChannelId: string) {
        return translateChannelArray(getAllThreadsForParent.call(this, parentChannelId));
    };
    if (typeof getSortedLinkedChannelsForGuild === "function") {
        ChannelStore.getSortedLinkedChannelsForGuild = function (this: typeof ChannelStore, guildId: string) {
            return translateChannelArray(getSortedLinkedChannelsForGuild.call(this, guildId));
        };
    }
    if (typeof getSortedPrivateChannels === "function") {
        ChannelStore.getSortedPrivateChannels = function (this: typeof ChannelStore) {
            return translateChannelArray(getSortedPrivateChannels.call(this));
        };
    }
}

function restoreChannelStore() {
    if (originalGetChannel) ChannelStore.getChannel = originalGetChannel;
    if (originalGetBasicChannel) ChannelStore.getBasicChannel = originalGetBasicChannel;
    if (originalGetDMChannelFromUserId) ChannelStore.getDMChannelFromUserId = originalGetDMChannelFromUserId;
    if (originalGetMutableBasicGuildChannelsForGuild) ChannelStore.getMutableBasicGuildChannelsForGuild = originalGetMutableBasicGuildChannelsForGuild;
    if (originalGetMutableGuildChannelsForGuild) ChannelStore.getMutableGuildChannelsForGuild = originalGetMutableGuildChannelsForGuild;
    if (originalGetMutablePrivateChannels) ChannelStore.getMutablePrivateChannels = originalGetMutablePrivateChannels;
    if (originalGetInitialOverlayState) ChannelStore.getInitialOverlayState = originalGetInitialOverlayState;
    if (originalGetAllThreadsForGuild) ChannelStore.getAllThreadsForGuild = originalGetAllThreadsForGuild;
    if (originalGetAllThreadsForParent) ChannelStore.getAllThreadsForParent = originalGetAllThreadsForParent;
    if (originalGetSortedLinkedChannelsForGuild) ChannelStore.getSortedLinkedChannelsForGuild = originalGetSortedLinkedChannelsForGuild;
    if (originalGetSortedPrivateChannels) ChannelStore.getSortedPrivateChannels = originalGetSortedPrivateChannels;

    originalGetChannel = undefined;
    originalGetBasicChannel = undefined;
    originalGetDMChannelFromUserId = undefined;
    originalGetMutableBasicGuildChannelsForGuild = undefined;
    originalGetMutableGuildChannelsForGuild = undefined;
    originalGetMutablePrivateChannels = undefined;
    originalGetInitialOverlayState = undefined;
    originalGetAllThreadsForGuild = undefined;
    originalGetAllThreadsForParent = undefined;
    originalGetSortedLinkedChannelsForGuild = undefined;
    originalGetSortedPrivateChannels = undefined;
}

export default definePlugin({
    name: "SurfaceTranslate",
    description: "Translate channel names, channel topics, and search result text.",
    authors: [OpenCordDevs.MasuRii],
    tags: ["Chat", "Utility"],
    settings,

    patches: [
        {
            find: '.CUSTOM_GIFT?""',
            replacement: {
                match: /message:(\i),message:\{id:\i\}.{0,200}renderContentOnly:\i.{0,30}\}=\i;/,
                replace: "$&$1=$self.transformSearchMessage($1,arguments[0]);",
            },
        },
    ],

    start() {
        if (originalGetChannel) return;
        patchChannelStore();
    },

    stop() {
        restoreChannelStore();
        resetTranslations();
    },

    transformSearchMessage(message: MessageWithContent, props: unknown): MessageWithContent {
        if (!settings.store.translateSearchResults || !message.content || !isSearchResultProps(props)) return message;
        return translateSearchMessage(message);
    },
});
