/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { ChannelStore, FluxDispatcher, MessageStore } from "@webpack/common";
const logger = new Logger("SurfaceTranslate");
const translationCache = new Map();
const skippedTranslations = new Set();
const inProgress = new Set();
const abortControllers = new Set();
let generation = 0;
let originalGetChannel;
let originalGetBasicChannel;
let originalGetDMChannelFromUserId;
let originalGetMutableBasicGuildChannelsForGuild;
let originalGetMutableGuildChannelsForGuild;
let originalGetMutablePrivateChannels;
let originalGetInitialOverlayState;
let originalGetAllThreadsForGuild;
let originalGetAllThreadsForParent;
let originalGetSortedLinkedChannelsForGuild;
let originalGetSortedPrivateChannels;
function resetTranslations() {
    generation++;
    translationCache.clear();
    skippedTranslations.clear();
    inProgress.clear();
    for (const controller of abortControllers)
        controller.abort();
    abortControllers.clear();
}
const settings = definePluginSettings({
    targetLanguage: {
        type: 0 /* OptionType.STRING */,
        description: "Target language code for surface translations.",
        default: "en",
        onChange: resetTranslations,
    },
    translateChannelNames: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Translate guild channel and thread names.",
        default: true,
    },
    translateChannelTopics: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Translate guild channel topics and descriptions.",
        default: true,
    },
    translateSearchResults: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Translate message text when Discord renders search results.",
        default: true,
    },
    showOriginal: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show the original text next to translated channel names and topics.",
        default: false,
    },
});
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
function getTranslationCacheKey(kind, id, text) {
    return `${settings.store.targetLanguage}:${kind}:${id}:${text}`;
}
function getTranslatedText(kind, id, text, onTranslated) {
    const trimmed = text.trim();
    if (!trimmed)
        return;
    const key = getTranslationCacheKey(kind, id, trimmed);
    if (skippedTranslations.has(key))
        return;
    const cached = translationCache.get(key);
    if (cached?.original === trimmed)
        return cached.translated;
    queueTranslation(key, trimmed, onTranslated);
}
function queueTranslation(key, text, onTranslated) {
    if (inProgress.has(key))
        return;
    const currentGeneration = generation;
    const controller = new AbortController();
    inProgress.add(key);
    abortControllers.add(controller);
    fetchTranslation(text, controller.signal).then(translated => {
        if (generation !== currentGeneration)
            return;
        if (!translated || translated === text) {
            skippedTranslations.add(key);
            return;
        }
        translationCache.set(key, { original: text, translated });
        onTranslated();
    }).catch(error => {
        if (error instanceof Error && error.name === "AbortError")
            return;
        logger.warn("Surface translation failed", error);
    }).finally(() => {
        inProgress.delete(key);
        abortControllers.delete(controller);
    });
}
function getBaseLanguage(language) {
    return language.toLowerCase().split(/[-_]/)[0];
}
async function fetchTranslation(text, signal) {
    const targetLanguage = settings.store.targetLanguage.trim();
    const targetBaseLanguage = getBaseLanguage(targetLanguage);
    if (!targetBaseLanguage)
        return null;
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLanguage)}&dt=t&dj=1&q=${encodeURIComponent(text)}`;
    const response = await fetch(url, { signal });
    if (!response.ok)
        throw new Error(`Translation API returned ${response.status} ${response.statusText}`);
    const data = await response.json();
    if (!isRecord(data) || !Array.isArray(data.sentences))
        return null;
    const sourceLanguage = typeof data.src === "string" ? getBaseLanguage(data.src) : "";
    if (sourceLanguage && sourceLanguage === targetBaseLanguage)
        return null;
    const translated = data.sentences.map(sentence => {
        if (!isRecord(sentence))
            return "";
        return typeof sentence.trans === "string" ? sentence.trans : "";
    }).join("").trim();
    return translated || null;
}
function dispatchChannelRefresh(channelId) {
    const getChannel = originalGetChannel;
    const channel = getChannel?.call(ChannelStore, channelId);
    if (!channel)
        return;
    FluxDispatcher.dispatch({
        type: "CHANNEL_UPDATES",
        channels: [channel],
    });
}
function dispatchMessageRefresh(message) {
    const current = MessageStore.getMessage(message.channel_id, message.id);
    FluxDispatcher.dispatch({
        type: "MESSAGE_UPDATE",
        message: current ?? message,
    });
}
function formatTranslatedText(translated, original) {
    if (!settings.store.showOriginal)
        return translated;
    return `${translated} (${original})`;
}
function formatTranslatedTopic(translated, original) {
    if (!settings.store.showOriginal)
        return translated;
    return `${translated}\n\nOriginal: ${original}`;
}
function getChannelTopic(channel) {
    const { topic } = channel;
    return typeof topic === "string" ? topic : "";
}
function translateChannel(channel) {
    if (!channel?.guild_id || typeof channel.merge !== "function")
        return channel;
    const changes = {};
    if (settings.store.translateChannelNames && channel.name) {
        const translatedName = getTranslatedText("channel-name", channel.id, channel.name, () => dispatchChannelRefresh(channel.id));
        if (translatedName)
            changes.name = formatTranslatedText(translatedName, channel.name);
    }
    const topic = getChannelTopic(channel);
    if (settings.store.translateChannelTopics && topic) {
        const translatedTopic = getTranslatedText("channel-topic", channel.id, topic, () => dispatchChannelRefresh(channel.id));
        if (translatedTopic)
            changes.topic_ = formatTranslatedTopic(translatedTopic, topic);
    }
    return Object.keys(changes).length ? channel.merge(changes) : channel;
}
function translateOptionalChannel(channel) {
    return channel ? translateChannel(channel) : channel;
}
function translateChannelRecord(channels) {
    if (!channels)
        return {};
    const translated = { ...channels };
    for (const channelId in channels)
        translated[channelId] = translateChannel(channels[channelId]);
    return translated;
}
function translateChannelArray(channels) {
    return channels ? channels.map(channel => translateChannel(channel)) : [];
}
function hasSearchMarker(value, depth = 0, seen = new WeakSet()) {
    if (!isRecord(value) || seen.has(value))
        return false;
    seen.add(value);
    for (const key of Object.keys(value)) {
        if (key.toLowerCase().includes("search"))
            return true;
        if (depth < 2 && hasSearchMarker(value[key], depth + 1, seen))
            return true;
    }
    return false;
}
function isSearchResultProps(value) {
    return hasSearchMarker(value);
}
function translateSearchMessage(message) {
    const translated = getTranslatedText("search-message", message.id, message.content, () => dispatchMessageRefresh(message));
    if (!translated)
        return message;
    return Object.assign(Object.create(Object.getPrototypeOf(message)), message, {
        content: translated,
    });
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
    ChannelStore.getChannel = function (channelId) {
        const channel = getChannel.call(this, channelId);
        return channel ? translateChannel(channel) : channel;
    };
    ChannelStore.getBasicChannel = function (channelId) {
        return translateOptionalChannel(getBasicChannel.call(this, channelId));
    };
    ChannelStore.getDMChannelFromUserId = function (userId) {
        return translateOptionalChannel(getDMChannelFromUserId.call(this, userId));
    };
    ChannelStore.getMutableBasicGuildChannelsForGuild = function (guildId) {
        return translateChannelRecord(getMutableBasicGuildChannelsForGuild.call(this, guildId));
    };
    ChannelStore.getMutableGuildChannelsForGuild = function (guildId) {
        return translateChannelRecord(getMutableGuildChannelsForGuild.call(this, guildId));
    };
    ChannelStore.getMutablePrivateChannels = function () {
        return translateChannelRecord(getMutablePrivateChannels.call(this));
    };
    ChannelStore.getInitialOverlayState = function () {
        return translateChannelRecord(getInitialOverlayState.call(this));
    };
    ChannelStore.getAllThreadsForGuild = function (guildId) {
        return translateChannelArray(getAllThreadsForGuild.call(this, guildId));
    };
    ChannelStore.getAllThreadsForParent = function (parentChannelId) {
        return translateChannelArray(getAllThreadsForParent.call(this, parentChannelId));
    };
    if (typeof getSortedLinkedChannelsForGuild === "function") {
        ChannelStore.getSortedLinkedChannelsForGuild = function (guildId) {
            return translateChannelArray(getSortedLinkedChannelsForGuild.call(this, guildId));
        };
    }
    if (typeof getSortedPrivateChannels === "function") {
        ChannelStore.getSortedPrivateChannels = function () {
            return translateChannelArray(getSortedPrivateChannels.call(this));
        };
    }
}
function restoreChannelStore() {
    if (originalGetChannel)
        ChannelStore.getChannel = originalGetChannel;
    if (originalGetBasicChannel)
        ChannelStore.getBasicChannel = originalGetBasicChannel;
    if (originalGetDMChannelFromUserId)
        ChannelStore.getDMChannelFromUserId = originalGetDMChannelFromUserId;
    if (originalGetMutableBasicGuildChannelsForGuild)
        ChannelStore.getMutableBasicGuildChannelsForGuild = originalGetMutableBasicGuildChannelsForGuild;
    if (originalGetMutableGuildChannelsForGuild)
        ChannelStore.getMutableGuildChannelsForGuild = originalGetMutableGuildChannelsForGuild;
    if (originalGetMutablePrivateChannels)
        ChannelStore.getMutablePrivateChannels = originalGetMutablePrivateChannels;
    if (originalGetInitialOverlayState)
        ChannelStore.getInitialOverlayState = originalGetInitialOverlayState;
    if (originalGetAllThreadsForGuild)
        ChannelStore.getAllThreadsForGuild = originalGetAllThreadsForGuild;
    if (originalGetAllThreadsForParent)
        ChannelStore.getAllThreadsForParent = originalGetAllThreadsForParent;
    if (originalGetSortedLinkedChannelsForGuild)
        ChannelStore.getSortedLinkedChannelsForGuild = originalGetSortedLinkedChannelsForGuild;
    if (originalGetSortedPrivateChannels)
        ChannelStore.getSortedPrivateChannels = originalGetSortedPrivateChannels;
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
    authors: [TestcordDevs.MasuRii],
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
        if (originalGetChannel)
            return;
        patchChannelStore();
    },
    stop() {
        restoreChannelStore();
        resetTranslations();
    },
    transformSearchMessage(message, props) {
        if (!settings.store.translateSearchResults || !message.content || !isSearchResultProps(props))
            return message;
        return translateSearchMessage(message);
    },
});
