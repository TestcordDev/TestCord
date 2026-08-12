/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import * as DataStore from "@api/DataStore";
import { showNotification } from "@api/Notifications";
import { Link } from "@components/Link";
import { Paragraph } from "@components/Paragraph";
import { EquicordDevs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { sendMessage } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { classes } from "@utils/misc";
import definePlugin, { PluginNative } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Button, Constants, GuildStore, Menu, NavigationRouter, React, RestAPI, Text, Tooltip, useCallback, useState } from "@webpack/common";

import {
    fetchProxiesForCountry,
    fetchProxiesGeneric,
    fetchScrapedProxies,
    parseProxyList,
    ProxyEntry,
    ProxySource,
} from "./proxy";
import { settings } from "./settings";

const logger = new Logger("QuestRegions");
const cl = classNameFactory("vc-quest-regions-");
const QuestsStore = findByPropsLazy("getQuest") as UnknownQuestStore;

// ─── Types ───────────────────────────────────────────────────────────────────

type DiscordDate = string | null | undefined;

interface RegionRestriction {
    id: string;
    regions: string[];
    is_global?: boolean;
    show_age_gate?: boolean;
}

interface QuestConfig {
    starts_at?: DiscordDate;
    expires_at?: DiscordDate;
    startsAt?: DiscordDate;
    expiresAt?: DiscordDate;
    ageRestricted?: boolean;
    age_restricted?: boolean;
    isAgeRestricted?: boolean;
    is_age_restricted?: boolean;
    ageGate?: boolean;
    age_gate?: boolean;
    contentRating?: string | number;
    content_rating?: string | number;
    contentRatingType?: string | number;
    content_rating_type?: string | number;
}

interface QuestEntry {
    id?: string;
    config?: QuestConfig;
}

type InferredRegionRestriction = RegionRestriction & QuestEntry;

interface QuestRegionsResponse {
    quests?: RegionRestriction[];
}

type QuestListResponse = QuestEntry[];

interface UserQuestListResponse {
    quests?: QuestEntry[];
}

interface QuestRegionCard {
    code: string;
    name: string;
    flagUrl: string;
    emoji: string;
    quests: RegionRestriction[];
}

interface QuestLike {
    id?: string;
    config?: QuestConfig;
    ageRestricted?: boolean;
    age_restricted?: boolean;
    isAgeRestricted?: boolean;
    is_age_restricted?: boolean;
    ageGate?: boolean;
    age_gate?: boolean;
    contentRating?: string | number;
    content_rating?: string | number;
}

interface CommandRegion {
    code: string;
    name: string;
    emoji: string;
}

interface QuestRegionCommandEntry {
    id: string;
    regions: CommandRegion[];
}

interface UnknownQuestStore {
    quests?: unknown;
    excludedQuests?: unknown;
    getQuest?(id: string): unknown;
    isQuestExpired?(questId: string): boolean;
}

interface SupplementalEmbed {
    url?: string;
    author?: { name?: string; };
}

interface SupplementalMessage {
    id?: string;
    channel_id?: string;
    channelId?: string;
    embeds?: SupplementalEmbed[];
}

interface MessageCreatePayload {
    type: "MESSAGE_CREATE";
    channelId: string;
    guildId?: string;
    message: unknown;
}

interface MessageUpdatePayload {
    type: "MESSAGE_UPDATE";
    channelId: string;
    guildId?: string;
    message: unknown;
}

interface ProxyQuestEntry {
    id?: string;
    config?: {
        startsAt?: string;
        starts_at?: string;
        expiresAt?: string;
        expires_at?: string;
        messages?: { questName?: string; quest_name?: string; };
    };
    userStatus?: { claimedAt?: string | null; claimed_at?: string | null; enrolledAt?: string | null; completedAt?: string | null; };
    user_status?: { claimedAt?: string | null; claimed_at?: string | null; enrolledAt?: string | null; completedAt?: string | null; };
}

interface QuestProxyFetchResult {
    quests: ProxyQuestEntry[];
    proxy: ProxyEntry;
}

interface QuestProxyActionResult {
    status: number;
    body: string;
}

interface PersistedDiscoveredQuest {
    id: string;
    regions: string[];
    quest: ProxyQuestEntry;
    lastSeenAt: number;
    expiresAt?: string;
}

interface QuestRegionsDataStore {
    discoveredQuests: Record<string, PersistedDiscoveredQuest>;
    lastProxyDiscoveryAt: number;
    lastProxyDiscoveryByRegion?: Record<string, number>;
}

interface WarmedProxyEntry {
    proxy: ProxyEntry;
    ms: number;
    at: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const REGION_NAMES: Record<string, string> = {
    AT: "Austria", AU: "Australia", BE: "Belgium", BR: "Brazil", CA: "Canada",
    CL: "Chile", CN: "China", DE: "Germany", DK: "Denmark", EC: "Ecuador",
    ES: "Spain", FI: "Finland", FR: "France", GB: "United Kingdom", HK: "Hong Kong",
    IE: "Ireland", IN: "India", IT: "Italy", JP: "Japan", KR: "South Korea",
    MY: "Malaysia", MX: "Mexico", NL: "Netherlands", NO: "Norway", NZ: "New Zealand",
    PE: "Peru", PH: "Philippines", PL: "Poland", SE: "Sweden", SG: "Singapore",
    TH: "Thailand", UK: "United Kingdom", US: "United States", VN: "Vietnam",
};

const REGION_FLAG_CODES: Record<string, string> = { UK: "gb", GB: "gb" };

const QUEST_DATA_GUILD_ID = "1317512377876480060";
const QUEST_DATA_CHANNEL_ID = "1454122889820241994";
const QUEST_DATA_INVITE_URL = "https://discord.gg/Fmdj3kFXWS";
const DISCORD_QUEST_URL_RE = /^https:\/\/discord\.com\/quests\/(\d{17,20})$/;
const SUPPLEMENTAL_FETCH_PAGES = 5;
const SUPPLEMENTAL_MESSAGES_PER_PAGE = 100;
const SUPPLEMENTAL_GLOBAL_REGION_NAMES = new Set(["global", "global 🌏"]);
const SUPPLEMENTAL_REGION_NAME_ALIASES: Record<string, string> = {
    "Hong Kong SAR China": "HK",
    "South Korea": "KR",
    "United Kingdom": "UK",
};
const CDN_BASE = "https://cdn.discordapp.com/";
const QUEST_PATH = "/quests";
const QUEST_ENROLL_LOCATION = "quest_home_desktop";
const QUEST_CLAIM_PLATFORM = 0;
const PROXY_RESPONSE_BODY_PREVIEW_LENGTH = 500;
const CURRENT_USER_REGION_CODE = "US";
const QUEST_REGIONS_DATASTORE_KEY = "QuestRegions_discoveredQuests_v1";

const regionDisplayNames = new Intl.DisplayNames(["en"], { type: "region" });
const DISCORD_ID_QUESTS_API_URL = new URL("https://api.discordquest.com/api/quests");
const DISCORDQUEST_REGIONS_URL = new URL("https://api.discordquest.com/api/regions");
const QUEST_RESTRICTIONS_URL = new URL("https://gist.githubusercontent.com/xGustavvo/3d08b7369eb34b50834815fd43176cae/raw");
const QUEST_LIST_URL = new URL("https://raw.githubusercontent.com/xGustavvo/discord-api-tracker/refs/heads/main/quests.json");
const USER_QUEST_LIST_URLS: Record<string, URL> = {
    BR: new URL("https://raw.githubusercontent.com/xGustavvo/discord-api-tracker/refs/heads/main/user-quests-br.json"),
    CA: new URL("https://raw.githubusercontent.com/xGustavvo/discord-api-tracker/refs/heads/main/user-quests-ca.json"),
    DE: new URL("https://raw.githubusercontent.com/xGustavvo/discord-api-tracker/refs/heads/main/user-quests-de.json"),
    FR: new URL("https://raw.githubusercontent.com/xGustavvo/discord-api-tracker/refs/heads/main/user-quests-fr.json"),
    UK: new URL("https://raw.githubusercontent.com/xGustavvo/discord-api-tracker/refs/heads/main/user-quests-uk.json"),
    US: new URL("https://raw.githubusercontent.com/xGustavvo/discord-api-tracker/refs/heads/main/user-quests-us.json"),
};
const PROXY_DISCOVERY_REGIONS = Object.keys(USER_QUEST_LIST_URLS).sort();
const REGION_CODES_BY_NAME = new Map(
    Object.entries(REGION_NAMES).map(([code, name]) => [name.toLowerCase(), code]),
);
const QUEST_REGION_BADGE_LIMIT = 3;

// ─── State ────────────────────────────────────────────────────────────────────

const supplementalQuestRegions = new Map<string, Map<string, CommandRegion>>();
let regionCache: { at: number; data: QuestRegionCard[]; } | null = null;
let regionPromise: Promise<QuestRegionCard[]> | null = null;
let activeQuestIds = new Set<string>();
let publicQuestRegions = new Map<string, Set<string>>();
let publicRegionQuestIds = new Map<string, Set<string>>();
let questCardRegions = new Map<string, Set<string>>();
let globalQuestIds = new Set<string>();
let ageGatedQuestIds = new Set<string>();
const discoveredQuestCache = new Map<string, ProxyQuestEntry>();
const knownQuestIds = new Set<string>();
const activeQuestStarts = new Map<string, Promise<string>>();
let proxyDiscoveryPromise: Promise<InferredRegionRestriction[]> | null = null;
let proxyDiscoveryTimer: ReturnType<typeof setInterval> | null = null;
let lastForegroundProxyCheckAt = 0;

// Per-country proxy cache: country code → ProxyEntry[]
// Populated lazily when a country is first needed.
const countryProxyCache = new Map<string, ProxyEntry[]>();
const goodProxyCache = new Map<string, ProxyEntry[]>();
const warmedProxyCache = new Map<string, WarmedProxyEntry[]>();
const proxyWarmupPromises = new Map<string, Promise<WarmedProxyEntry[]>>();
const AUTO_START_MIN_DELAY_MS = 2_500;
const AUTO_START_MAX_DELAY_MS = 8_500;
const COUNTRY_PREFLIGHT_SAMPLE_SIZE = 240;
const GENERIC_GEO_CHECK_LIMIT = 480;
const GENERIC_MATCH_TARGET = 8;
const GOOD_PROXY_CACHE_LIMIT = 12;
const PROXY_DISCOVERY_TIMER_INTERVAL_MS = 5 * 60 * 1000;
const GEO_PREFLIGHT_SAMPLE_SIZE = 360;
const WARMED_PROXY_CACHE_TTL_MS = 15 * 60 * 1000;
const WARMED_PROXY_TARGET = 4;
const BATCH_PROXY_CHECK_CHUNK_SIZE = 100;
const RARE_COUNTRY_PREFLIGHT_SAMPLE_SIZE = 700;
const RARE_GENERIC_GEO_CHECK_LIMIT = 1_600;
const RARE_GEO_PREFLIGHT_SAMPLE_SIZE = 1_000;
const RARE_PROXY_CHECK_TIMEOUT_MS = 15_000;
const RARE_REGION_CODES = new Set(["AT", "AU", "BE", "CZ", "DK", "GB", "IE", "JP", "NO", "NZ", "PT", "SK"]);

// ─── Region helpers ───────────────────────────────────────────────────────────

function getFlagUrl(region: string): string {
    const code = REGION_FLAG_CODES[region] ?? region.toLowerCase();
    return `https://hatscripts.github.io/circle-flags/flags/${code}.svg`;
}

function getRegionName(region: string): string {
    return REGION_NAMES[region] ?? regionDisplayNames.of(region) ?? region;
}

function getRegionEmoji(region: string): string {
    const code = REGION_FLAG_CODES[region] ?? region.toLowerCase();
    return `:flag_${code}:`;
}

function normalizeRegion(region: string): string {
    return region.trim().toUpperCase();
}

function getAuthoritativeRegions(questId: string, regions: string[]): string[] {
    return regions.map(normalizeRegion);
}

function getRegionFromName(name: string): CommandRegion | null {
    const trimmedName = name.trim();
    if (SUPPLEMENTAL_GLOBAL_REGION_NAMES.has(trimmedName.toLowerCase())) return null;
    const code = SUPPLEMENTAL_REGION_NAME_ALIASES[trimmedName]
        ?? REGION_CODES_BY_NAME.get(trimmedName.toLowerCase())
        ?? normalizeRegion(trimmedName);
    return { code, name: getRegionName(code), emoji: getRegionEmoji(code) };
}

// ─── Type guards / property helpers ──────────────────────────────────────────

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function getStringProperty(value: unknown, ...keys: string[]): string | null {
    if (!isObject(value)) return null;
    for (const key of keys) {
        const prop = value[key];
        if (typeof prop === "string") return prop;
    }
    return null;
}

function getObjectProperty(value: unknown, ...keys: string[]): Record<string, unknown> | null {
    if (!isObject(value)) return null;
    for (const key of keys) {
        const prop = value[key];
        if (isObject(prop)) return prop;
    }
    return null;
}

// ─── Quest CDN image ─────────────────────────────────────────────────────────

function getQuestImageUrl(questId: string): string | null {
    const stored = QuestsStore.getQuest?.(questId);
    if (!stored) return null;
    const config = getObjectProperty(stored, "config");
    const assets = getObjectProperty(config, "assets");
    const heroPath = getStringProperty(assets, "hero", "questBarHero");
    if (!heroPath) return null;
    return `${CDN_BASE}${heroPath}`;
}

// ─── Supplemental message cache ───────────────────────────────────────────────

function isSupplementalEmbed(value: unknown): value is SupplementalEmbed {
    if (!isObject(value)) return false;
    const { author } = value;
    return (
        (typeof value.url === "undefined" || typeof value.url === "string") &&
        (typeof author === "undefined" || (isObject(author) && (typeof author.name === "undefined" || typeof author.name === "string")))
    );
}

function isSupplementalMessage(value: unknown): value is SupplementalMessage {
    if (!isObject(value)) return false;
    const { embeds } = value;
    return (
        (typeof value.id === "undefined" || typeof value.id === "string") &&
        (typeof value.channel_id === "undefined" || typeof value.channel_id === "string") &&
        (typeof value.channelId === "undefined" || typeof value.channelId === "string") &&
        (typeof embeds === "undefined" || (Array.isArray(embeds) && embeds.every(isSupplementalEmbed)))
    );
}

function cacheSupplementalMessage(message: unknown) {
    if (!isSupplementalMessage(message)) return;
    const channelId = message.channel_id ?? message.channelId;
    if (channelId !== QUEST_DATA_CHANNEL_ID) return;

    for (const embed of message.embeds ?? []) {
        if (!embed.url || !embed.author?.name) continue;
        const match = DISCORD_QUEST_URL_RE.exec(embed.url);
        if (!match) continue;
        const questId = match[1];
        const region = getRegionFromName(embed.author.name);
        if (!region) continue;
        const regions = supplementalQuestRegions.get(questId) ?? new Map<string, CommandRegion>();
        regions.set(region.code, region);
        supplementalQuestRegions.set(questId, regions);
    }
}

function canFetchSupplementalQuestData() {
    return Boolean(GuildStore.getGuild(QUEST_DATA_GUILD_ID));
}

async function fetchSupplementalQuestMessages() {
    if (!canFetchSupplementalQuestData()) return;
    let before: string | undefined;

    for (let page = 0; page < SUPPLEMENTAL_FETCH_PAGES; page++) {
        const { body }: { body: unknown; } = await RestAPI.get({
            url: Constants.Endpoints.MESSAGES(QUEST_DATA_CHANNEL_ID),
            query: { limit: SUPPLEMENTAL_MESSAGES_PER_PAGE, ...(before ? { before } : {}) },
            retries: 2,
        });

        if (!Array.isArray(body) || body.length === 0) return;
        let lastMessageId: string | undefined;
        for (const message of body) {
            cacheSupplementalMessage(message);
            if (isSupplementalMessage(message)) lastMessageId = message.id;
        }
        if (!lastMessageId || body.length < SUPPLEMENTAL_MESSAGES_PER_PAGE) return;
        before = lastMessageId;
    }
}

// ─── Quest data helpers ───────────────────────────────────────────────────────

function parseDiscordDate(value: DiscordDate): Date | null {
    if (!value) return null;
    const parsed = new Date(value.replace("Z", "+00:00"));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function fetchJson<T>(url: URL, signal: AbortSignal): Promise<T> {
    console.debug(`[QuestRegions] fetchJson → ${url.toString()}`);
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`Failed to fetch ${url.toString()}: ${res.status} ${res.statusText}`);
    const data = await res.json() as T;
    console.debug(`[QuestRegions] fetchJson ← ${url.toString()} ok`);
    return data;
}

function getQuestEntriesFromBody(body: unknown): QuestEntry[] {
    if (!Array.isArray(body)) return [];
    return body.filter((quest): quest is QuestEntry & { id: string; } => (
        isObject(quest) &&
        typeof quest.id === "string" &&
        isObject(quest.config)
    ));
}

async function fetchDiscordIdQuestApi(signal: AbortSignal): Promise<QuestEntry[]> {
    const native = getNative();
    const proxies = native ? (await resolveProxiesGeneric()).slice(0, 30) : [];

    if (native && proxies.length > 0) {
        const healthyProxies = await findHealthyProxiesFast(proxies, "API", undefined, 2).catch(() => proxies.slice(0, 5));
        for (const item of (healthyProxies as any)) {
            const { proxy } = item;
            const result = await (native as typeof native & {
                fetchUrlViaProxy?: (url: string, proxy: string) => Promise<{ status: number; body: string; error?: string; }>;
            }).fetchUrlViaProxy?.(DISCORD_ID_QUESTS_API_URL.toString(), proxy.raw);
            if (!result || result.error || result.status < 200 || result.status >= 300) continue;

            try {
                const entries = getQuestEntriesFromBody(JSON.parse(result.body));
                if (entries.length > 0) return entries;
            } catch { /* try next proxy */ }
        }
    }

    const data = await fetchJson<unknown>(DISCORD_ID_QUESTS_API_URL, signal);
    return getQuestEntriesFromBody(data);
}

function getQuestId(quest: unknown): string | null {
    return getStringProperty(quest, "id");
}

function getQuestConfig(quest: unknown): Record<string, unknown> | null {
    return getObjectProperty(quest, "config");
}

function getQuestStartsAt(quest: unknown): Date | null {
    return parseDiscordDate(getStringProperty(getQuestConfig(quest), "startsAt", "starts_at"));
}

function getQuestUserStatus(quest: unknown): Record<string, unknown> | null {
    return getObjectProperty(quest, "userStatus", "user_status");
}

function getQuestName(quest: unknown): string {
    const messages = getObjectProperty(getQuestConfig(quest), "messages");
    return getStringProperty(messages, "questName", "quest_name") ?? "Unknown Quest";
}

function getQuestExpiresAt(quest: unknown): Date | null {
    return parseDiscordDate(getStringProperty(getQuestConfig(quest), "expiresAt", "expires_at"));
}

function isQuestActive(quest: unknown, now = new Date()): boolean {
    const startsAt = getQuestStartsAt(quest);
    const expiresAt = getQuestExpiresAt(quest);
    if (startsAt && now < startsAt) return false;
    if (expiresAt && now > expiresAt) return false;
    return true;
}

function isQuestUnclaimed(quest: unknown): boolean {
    const id = getQuestId(quest);
    if (!id) return false;
    if (getStringProperty(getQuestUserStatus(quest), "claimedAt", "claimed_at")) return false;
    const expiresAt = getQuestExpiresAt(quest);
    return !expiresAt || expiresAt > new Date();
}

function isQuestCompletedOrClaimed(quest: unknown): boolean {
    const status = getQuestUserStatus(quest);
    return Boolean(
        getStringProperty(status, "completedAt", "completed_at") ||
        getStringProperty(status, "claimedAt", "claimed_at")
    );
}

function getBooleanProperty(value: unknown, ...keys: string[]): boolean | null {
    if (!isObject(value)) return null;
    for (const key of keys) {
        const prop = value[key];
        if (typeof prop === "boolean") return prop;
    }
    return null;
}

function isAgeRestrictedRating(value: unknown): boolean {
    if (typeof value === "number") return value >= 18;
    if (typeof value !== "string") return false;
    return /^(?:18|18\+|mature|adult|age[_-]?restricted|restricted|m|ao)$/i.test(value.trim());
}

function isQuestAgeRestricted(quest: unknown): boolean {
    // Discord's quest objects don't expose any age-gate fields — rely solely on
    // the gist restriction data (show_age_gate) which is indexed by quest ID.
    const id = getStringProperty(quest, "id");
    return id ? ageGatedQuestIds.has(id) : false;
}

function isQuestGlobal(quest: unknown): boolean {
    const id = getStringProperty(quest, "id");
    if (!id) return false;
    // Explicitly marked global in the gist
    if (globalQuestIds.has(id)) return true;
    // Not in the gist at all and not in any regional URL → treat as global
    return !questCardRegions.has(id) && !ageGatedQuestIds.has(id);
}

function isQuestDiscoverable(quest: unknown, now = new Date()): boolean {
    return Boolean(getQuestId(quest)) && isQuestActive(quest, now) && !isQuestCompletedOrClaimed(quest);
}

function isQuestAvailableForCommand(quest: RegionRestriction): boolean {
    if (activeQuestIds.size > 0 && !activeQuestIds.has(quest.id)) return false;
    if (isQuestCompletedOrClaimed(quest)) return false;
    return true;
}

function isSupplementalRegionAuthoritative(questId: string, region: CommandRegion): boolean {
    const questRegions = publicQuestRegions.get(questId);
    if (questRegions) return questRegions.has(region.code);
    return true;
}

function getStoredQuests(): unknown[] {
    const { quests } = QuestsStore;
    if (quests instanceof Map) return Array.from(quests.values());
    if (Array.isArray(quests)) return quests;
    if (isObject(quests)) return Object.values(quests);
    return [];
}

function getQuestsFromResponseBody(body: unknown): unknown[] {
    if (Array.isArray(body)) return body;
    if (!isObject(body)) return [];
    const { quests } = body;
    if (Array.isArray(quests)) return quests;
    if (isObject(quests)) return Object.values(quests);
    return [];
}

function formatProxyResponseBody(body: string): string {
    const trimmed = body.trim();
    if (!trimmed) return "(empty body)";
    return trimmed.length > PROXY_RESPONSE_BODY_PREVIEW_LENGTH
        ? `${trimmed.slice(0, PROXY_RESPONSE_BODY_PREVIEW_LENGTH)}…`
        : trimmed;
}

async function fetchUserQuests(): Promise<unknown[]> {
    const { body }: { body: unknown; } = await RestAPI.get({ url: "/quests/@me", retries: 3 });
    return getQuestsFromResponseBody(body);
}

async function fetchRegionalUserQuestEntries(signal: AbortSignal): Promise<Map<string, InferredRegionRestriction>> {
    // Only count regions that the external per-region URLs explicitly report.
    // Do NOT fold in the current user's live quests as a regional signal — a quest
    // visible to the current user but absent from all other regional URLs is likely
    // global, not US-only. (e.g. Subnautica was falsely labelled "United States"
    // because it only appeared in user-quests-us.json but is available globally.)
    const regionalQuests = await Promise.all(
        Object.entries(USER_QUEST_LIST_URLS).map(async ([region, url]) => {
            const data = await fetchJson<UserQuestListResponse>(url, signal);
            return [region, Array.isArray(data.quests) ? data.quests : []] as const;
        })
    );

    const regionsByQuest = new Map<string, Set<string>>();
    const questsById = new Map<string, QuestEntry>();

    for (const [region, quests] of regionalQuests) {
        for (const quest of quests) {
            const id = getQuestId(quest);
            if (!id) continue;
            questsById.set(id, quest);

            const regions = regionsByQuest.get(id) ?? new Set<string>();
            regions.add(region);
            regionsByQuest.set(id, regions);
        }
    }

    const inferredRestrictions = new Map<string, InferredRegionRestriction>();
    const allRegionCount = Object.keys(USER_QUEST_LIST_URLS).length;

    for (const [id, regions] of regionsByQuest) {
        // Quest in all tracked regions → effectively global, skip.
        // Quest in none → no data to infer from, skip.
        if (regions.size === 0 || regions.size >= allRegionCount) continue;

        inferredRestrictions.set(id, {
            ...questsById.get(id),
            id,
            regions: Array.from(regions).sort(),
            is_global: false,
        });
    }

    return inferredRestrictions;
}

function getEmptyQuestRegionsDataStore(): QuestRegionsDataStore {
    return { discoveredQuests: {}, lastProxyDiscoveryAt: 0, lastProxyDiscoveryByRegion: {} };
}

async function getQuestRegionsDataStore(): Promise<QuestRegionsDataStore> {
    const data = await DataStore.get<QuestRegionsDataStore>(QUEST_REGIONS_DATASTORE_KEY);
    if (!data || !isObject(data)) return getEmptyQuestRegionsDataStore();
    return {
        discoveredQuests: isObject(data.discoveredQuests) ? data.discoveredQuests : {},
        lastProxyDiscoveryAt: typeof data.lastProxyDiscoveryAt === "number" ? data.lastProxyDiscoveryAt : 0,
        lastProxyDiscoveryByRegion: isObject(data.lastProxyDiscoveryByRegion)
            ? Object.fromEntries(Object.entries(data.lastProxyDiscoveryByRegion).filter(([, value]) => typeof value === "number")) as Record<string, number>
            : {},
    };
}

async function setQuestRegionsDataStore(data: QuestRegionsDataStore): Promise<void> {
    await DataStore.set(QUEST_REGIONS_DATASTORE_KEY, data);
}

function markQuestRegionNotified(questId: string): boolean {
    if (settings.store.notifiedQuestIds.includes(questId)) return false;
    settings.store.notifiedQuestIds = [...settings.store.notifiedQuestIds, questId];
    return true;
}

function notifyDiscoveredRegionQuest(entry: PersistedDiscoveredQuest): void {
    if (!settings.store.notifyNewQuests) return;
    if (!markQuestRegionNotified(entry.id)) return;

    const questName = getQuestName(entry.quest);
    const imageUrl = getQuestImageUrl(entry.id);
    showNotification({
        title: "New Region Quest Found",
        body: `${questName !== "Unknown Quest" ? questName + "\n" : ""}${getRegionsLabel(entry.regions)}`,
        ...(imageUrl ? { image: imageUrl } : {}),
        icon: entry.regions[0] ? getFlagUrl(entry.regions[0]) : undefined,
        dismissOnClick: true,
        onClick: () => NavigationRouter.transitionTo(`${QUEST_PATH}#${entry.id}`),
    });
}

async function getStoredDiscoveredRegionRestrictions(now = new Date()): Promise<InferredRegionRestriction[]> {
    const data = await getQuestRegionsDataStore();
    const activeEntries = Object.values(data.discoveredQuests).filter(entry => (
        Array.isArray(entry.regions) &&
        entry.regions.length > 0 &&
        isQuestDiscoverable(entry.quest, now)
    ));

    if (activeEntries.length !== Object.keys(data.discoveredQuests).length) {
        await setQuestRegionsDataStore({
            ...data,
            discoveredQuests: Object.fromEntries(activeEntries.map(entry => [entry.id, entry])),
        });
    }

    discoveredQuestCache.clear();
    for (const entry of activeEntries) discoveredQuestCache.set(entry.id, entry.quest);

    return activeEntries.map(entry => ({
        ...entry.quest,
        id: entry.id,
        regions: entry.regions,
        is_global: false,
    }));
}

async function discoverQuestRegionsViaProxies(force = false): Promise<InferredRegionRestriction[]> {
    if (proxyDiscoveryPromise) return proxyDiscoveryPromise;
    proxyDiscoveryPromise = discoverQuestRegionsViaProxiesInner(force)
        .finally(() => { proxyDiscoveryPromise = null; });
    return proxyDiscoveryPromise;
}

async function discoverQuestRegionsViaProxiesInner(force = false): Promise<InferredRegionRestriction[]> {
    const data = await getQuestRegionsDataStore();
    const intervalMs = Math.max(5, settings.store.proxyDiscoveryIntervalMinutes) * 60 * 1000;
    const nowMs = Date.now();
    const lastByRegion = data.lastProxyDiscoveryByRegion ?? {};
    const regionsToFetch = PROXY_DISCOVERY_REGIONS.filter(region => (
        force || nowMs - (lastByRegion[region] ?? 0) >= intervalMs
    ));

    if (regionsToFetch.length === 0) {
        return getStoredDiscoveredRegionRestrictions(new Date(nowMs));
    }

    const discovered = new Map<string, PersistedDiscoveredQuest>(
        Object.values(data.discoveredQuests).map(entry => [entry.id, entry]),
    );
    const nextLastByRegion = { ...lastByRegion };
    const newDiscoveries: PersistedDiscoveredQuest[] = [];

    for (const region of regionsToFetch) {
        try {
            const [quests] = await fetchQuestsViaProxyForCountry(region);
            for (const quest of quests) {
                if (!isQuestDiscoverable(quest, new Date(nowMs))) continue;
                const id = getQuestId(quest);
                if (!id) continue;

                const existing = discovered.get(id);
                const regions = new Set(existing?.regions ?? []);
                const hadRegion = regions.has(region);
                regions.add(region);
                const entry = {
                    id,
                    regions: Array.from(regions).sort(),
                    quest,
                    lastSeenAt: nowMs,
                    expiresAt: getStringProperty(getQuestConfig(quest), "expiresAt", "expires_at") ?? undefined,
                };
                discovered.set(id, entry);
                if (!existing || !hadRegion) newDiscoveries.push(entry);
            }
            nextLastByRegion[region] = nowMs;
        } catch (error) {
            logger.error(`Failed to discover quests for ${region}`, error);
        }
    }

    await setQuestRegionsDataStore({
        discoveredQuests: Object.fromEntries(Array.from(discovered.values()).map(entry => [entry.id, entry])),
        lastProxyDiscoveryAt: nowMs,
        lastProxyDiscoveryByRegion: nextLastByRegion,
    });

    for (const entry of newDiscoveries) notifyDiscoveredRegionQuest(entry);

    return getStoredDiscoveredRegionRestrictions(new Date(nowMs));
}

// ─── Auth token ───────────────────────────────────────────────────────────────

/**
 * Retrieves the current user's Discord auth token.
 * Uses the TokenModule (findByProps("getToken")) which is the standard approach
 * and matches what AuthorizationStore exposes internally.
 */
function getToken(): string {
    const TokenModule = Vencord.Webpack.findByProps("getToken") as { getToken(): string; } | null;
    const token = TokenModule?.getToken?.() ?? "";
    if (!token) {
        console.debug("[QuestRegions] getToken: FAILED — TokenModule found:", !!TokenModule, "getToken fn:", typeof TokenModule?.getToken);
    } else {
        console.debug(`[QuestRegions] getToken: OK — token length=${token.length} prefix=${token.slice(0, 6)}…`);
    }
    return token;
}

// ─── Native helper ────────────────────────────────────────────────────────────

function getNative(): PluginNative<typeof import("./native")> | null {
    const native = (globalThis as { VencordNative?: { pluginHelpers?: Record<string, unknown>; }; }).VencordNative?.pluginHelpers?.QuestRegions as
        | PluginNative<typeof import("./native")>
        | undefined;
    if (!native) {
        console.debug("[QuestRegions] getNative: native helper NOT found — is this desktop?");
    }
    return native ?? null;
}

// ─── Proxy source resolution ──────────────────────────────────────────────────

/**
 * Determine which ProxySources to use based on settings.
 */
function getConfiguredSources(): ProxySource[] {
    const src = settings.store.proxySource;
    if (src === "file") return ["file"];
    if (src === "api") return [
        "databay",
        "clearproxy",
        "iplocate",
        "proxyscrape",
        "geonode",
        "proxyradar",
        "flashproxy",
        "proxifly",
        "worldpool",
        "monosans",
        "proxygenerator",
        "vakhov",
        "jetkai",
        "stormsia",
        "thespeedx",
        "clarketm",
        "proxylistworld",
    ];
    // Individual source selections
    if (
        src === "proxyscrape" ||
        src === "flashproxy" ||
        src === "proxifly" ||
        src === "geonode" ||
        src === "proxyradar" ||
        src === "monosans" ||
        src === "clearproxy" ||
        src === "iplocate" ||
        src === "jetkai" ||
        src === "vakhov" ||
        src === "thespeedx" ||
        src === "proxylistworld" ||
        src === "databay" ||
        src === "worldpool" ||
        src === "proxygenerator" ||
        src === "stormsia" ||
        src === "clarketm"
    ) return [src];
    return ["databay", "clearproxy", "iplocate", "proxyscrape", "geonode", "proxyradar", "flashproxy", "proxifly", "worldpool", "monosans", "proxygenerator", "vakhov", "jetkai", "stormsia", "thespeedx", "clarketm", "proxylistworld"];
}

/**
 * Resolves proxies for a specific country.
 *
 * - If source is "file", parses the loaded file and returns ALL entries
 *   (geo-check will be needed in that case, handled by the caller).
 * - If source is an API source, fetches proxies already filtered by country
 *   from the relevant API(s). No geo-check needed.
 *
 * Results are cached per-country for the session.
 */
async function resolveProxiesForCountry(country: string): Promise<ProxyEntry[]> {
    const sources = getConfiguredSources();
    console.debug(`[QuestRegions] resolveProxiesForCountry: country=${country} sources=[${sources.join(",")}]`);

    // File source: return all file entries (no country filter possible from a flat file)
    if (sources.includes("file")) {
        const content = settings.store.proxyFileContent ?? "";
        const entries = parseProxyList(content, undefined, "file");
        console.debug(`[QuestRegions] resolveProxiesForCountry: file has ${entries.length} entries (no country pre-filter)`);
        return entries;
    }

    // API sources: check cache first
    const cacheKey = `${country}:${sources.join(",")}`;
    if (countryProxyCache.has(cacheKey)) {
        const cached = countryProxyCache.get(cacheKey)!;
        console.debug(`[QuestRegions] resolveProxiesForCountry: cache hit ${cacheKey} → ${cached.length} proxies`);
        return cached;
    }

    const entries = await fetchProxiesForCountry(country, sources);
    const knownGood = goodProxyCache.get(country) ?? [];
    const deduped = new Map<string, ProxyEntry>();
    for (const proxy of knownGood) deduped.set(proxy.raw, proxy);
    for (const proxy of entries) if (!deduped.has(proxy.raw)) deduped.set(proxy.raw, proxy);
    const merged = Array.from(deduped.values());

    countryProxyCache.set(cacheKey, merged);
    console.debug(`[QuestRegions] resolveProxiesForCountry: cached ${merged.length} proxies for ${cacheKey} (${knownGood.length} known-good first)`);
    return merged;
}

/**
 * Resolves a generic (non-country-specific) proxy list for fallback use.
 */
async function resolveProxiesGeneric(): Promise<ProxyEntry[]> {
    const sources = getConfiguredSources();
    console.debug(`[QuestRegions] resolveProxiesGeneric: sources=[${sources.join(",")}]`);

    if (sources.includes("file")) {
        const content = settings.store.proxyFileContent ?? "";
        const entries = parseProxyList(content, undefined, "file");
        console.debug(`[QuestRegions] resolveProxiesGeneric: ${entries.length} proxies from file`);
        return entries;
    }

    const entries = await fetchProxiesGeneric(sources);
    const knownGood = Array.from(goodProxyCache.values()).flat();
    const deduped = new Map<string, ProxyEntry>();
    for (const proxy of knownGood) deduped.set(proxy.raw, proxy);
    for (const proxy of entries) if (!deduped.has(proxy.raw)) deduped.set(proxy.raw, proxy);
    const merged = Array.from(deduped.values());
    console.debug(`[QuestRegions] resolveProxiesGeneric: ${merged.length} proxies from configured generic sources (${knownGood.length} known-good first)`);
    return merged;
}

function rememberGoodProxy(country: string, proxy: ProxyEntry) {
    const next = [proxy, ...(goodProxyCache.get(country) ?? []).filter(item => item.raw !== proxy.raw)]
        .slice(0, GOOD_PROXY_CACHE_LIMIT);
    goodProxyCache.set(country, next);
}

function formatProxySourceBreakdown(proxies: ProxyEntry[]): string {
    const counts = new Map<string, number>();

    for (const proxy of proxies) {
        const source = proxy.source?.split(":")[0] ?? "unknown";
        counts.set(source, (counts.get(source) ?? 0) + 1);
    }

    return Array.from(counts.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([source, count]) => `${source}=${count}`)
        .join(", ");
}

function hasCountryFilteredProxySource(proxies: ProxyEntry[], country: string): boolean {
    return proxies.some(proxy => proxy.country === country && proxy.source !== "file");
}

function getRegionsLabel(regions: string[]): string {
    return regions.map(region => `${getRegionEmoji(region)} ${getRegionName(region)}`).join(", ");
}

function getFreshWarmedProxies(country: string): WarmedProxyEntry[] {
    const now = Date.now();
    const warmed = warmedProxyCache.get(country) ?? [];
    return warmed.filter(entry => now - entry.at < WARMED_PROXY_CACHE_TTL_MS);
}

function setWarmedProxies(country: string, entries: WarmedProxyEntry[]): WarmedProxyEntry[] {
    const deduped = new Map<string, WarmedProxyEntry>();
    for (const entry of entries.sort((a, b) => a.ms - b.ms)) {
        if (!deduped.has(entry.proxy.raw)) deduped.set(entry.proxy.raw, entry);
    }
    const next = Array.from(deduped.values()).slice(0, GOOD_PROXY_CACHE_LIMIT);
    warmedProxyCache.set(country, next);
    for (const entry of next) rememberGoodProxy(country, entry.proxy);
    return next;
}

function getFastestWarmedCountry(countries: string[]): string | null {
    const fastest = countries
        .map(normalizeRegion)
        .map(country => ({ country, proxy: getFreshWarmedProxies(country)[0] }))
        .filter((entry): entry is { country: string; proxy: WarmedProxyEntry; } => Boolean(entry.proxy))
        .sort((a, b) => a.proxy.ms - b.proxy.ms)[0];
    return fastest?.country ?? null;
}

function orderCountriesByProxySpeed(countries: string[]): string[] {
    return Array.from(new Set(countries.map(normalizeRegion)))
        .sort((a, b) => (getFreshWarmedProxies(a)[0]?.ms ?? Number.MAX_SAFE_INTEGER) - (getFreshWarmedProxies(b)[0]?.ms ?? Number.MAX_SAFE_INTEGER));
}

function getActiveQuestCountries(cards: QuestRegionCard[]): string[] {
    return Array.from(new Set(cards.map(card => card.code))).sort();
}

function isRareProxyRegion(country: string): boolean {
    return settings.store.rareRegionProxyMode && RARE_REGION_CODES.has(normalizeRegion(country));
}

async function getQuestPageRegionCountries(): Promise<string[]> {
    await getQuestRegions(false);

    const countries = new Set<string>();
    for (const quest of getStoredQuests()) {
        const id = getQuestId(quest);
        if (!id) continue;
        const regions = questCardRegions.get(id);
        if (!regions?.size) continue;
        for (const region of regions) countries.add(region);
    }

    if (countries.size > 0) return Array.from(countries).sort();
    return Array.from(new Set(Array.from(questCardRegions.values()).flatMap(regions => Array.from(regions)))).sort();
}

// ─── Core proxy request engine ────────────────────────────────────────────────

/**
 * Tries each proxy in a list sequentially for the given IPC call, returning
 * the first successful response.
 *
 * onAttempt is called before each try so callers can log/report progress.
 */
async function tryProxiesSequentially<T extends { status: number; body: string; error?: string; }>(
    proxies: ProxyEntry[],
    action: (proxy: ProxyEntry, token: string) => Promise<T>,
    token: string,
    label: string,
): Promise<{ result: T; proxy: ProxyEntry; }> {
    const errors: string[] = [];

    for (let i = 0; i < proxies.length; i++) {
        const proxy = proxies[i];
        console.debug(`[QuestRegions] ${label}: trying proxy [${i + 1}/${proxies.length}] ${proxy.raw} (source=${proxy.source ?? "?"} country=${proxy.country ?? "?"})`);

        try {
            const result = await action(proxy, token);
            console.debug(`[QuestRegions] ${label}: proxy ${proxy.raw} → status=${result.status} error=${result.error ?? "none"} bodyLen=${result.body.length}`);

            if (result.error || result.status < 200 || result.status >= 300) {
                const reason = result.error ?? `HTTP ${result.status}`;
                console.debug(`[QuestRegions] ${label}: proxy ${proxy.raw} FAILED — ${reason}`);
                errors.push(`${proxy.raw}: ${reason}`);
                continue;
            }

            console.debug(`[QuestRegions] ${label}: ✅ proxy ${proxy.raw} succeeded`);
            return { result, proxy };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.debug(`[QuestRegions] ${label}: proxy ${proxy.raw} threw: ${msg}`);
            errors.push(`${proxy.raw}: ${msg}`);
        }
    }

    throw new Error(
        `All ${proxies.length} proxies failed for ${label}:\n` +
        errors.slice(0, 10).join("\n") +
        (errors.length > 10 ? `\n…and ${errors.length - 10} more` : ""),
    );
}

async function findHealthyProxiesFast(
    proxies: ProxyEntry[],
    country: string,
    onProgress?: (message: string) => void,
    targetAlive = 3,
): Promise<WarmedProxyEntry[]> {
    const native = getNative();
    if (!native) throw new Error("Native proxy support is not available (desktop only).");

    const rareRegion = isRareProxyRegion(country);
    const sample = proxies.slice(0, rareRegion ? RARE_COUNTRY_PREFLIGHT_SAMPLE_SIZE : COUNTRY_PREFLIGHT_SAMPLE_SIZE);
    const concurrency = Math.min(rareRegion ? 18 : 10, sample.length);
    const results: Array<{ proxy: ProxyEntry; ok: boolean; ms: number; error?: string; }> = [];
    let nextIndex = 0;
    let alive = 0;
    let checkedCount = 0;
    let lastProgressAt = 0;

    const emitProgress = (message: string, force = false) => {
        const now = Date.now();
        if (!force && now - lastProgressAt < 3000) return;
        lastProgressAt = now;
        onProgress?.(message);
    };

    emitProgress(`🩺 ${country}: ${rareRegion ? "rare-region " : ""}fast preflight checking up to ${sample.length} proxy(s) with ${settings.store.proxyCheckService}, concurrency ${concurrency}, stopping after ${targetAlive} live proxy(s).`, true);

    const workers = Array.from({ length: concurrency }, async () => {
        while (nextIndex < sample.length && alive < targetAlive) {
            const index = nextIndex++;
            const proxy = sample[index];
            try {
                const startedAt = Date.now();
                const { preflightProxy } = (native as typeof native & {
                    preflightProxy?: (proxy: string, service?: string) => Promise<{ ok: boolean; ms: number; error?: string; }>;
                });
                const res = /^[A-Z]{2}$/.test(country)
                    ? await native.geoCheckProxy(proxy.raw, rareRegion ? RARE_PROXY_CHECK_TIMEOUT_MS : undefined).then(geo => ({
                        ok: geo.countryCode === country,
                        ms: Date.now() - startedAt,
                        error: geo.error ?? (geo.countryCode ? `Exit country ${geo.countryCode}, expected ${country}` : "Could not determine exit country"),
                    }))
                    : preflightProxy
                        ? await preflightProxy(proxy.raw, settings.store.proxyCheckService)
                        : await native.geoCheckProxy(proxy.raw).then(geo => ({
                            ok: Boolean(geo.countryCode) || !geo.error,
                            ms: Date.now() - startedAt,
                            error: geo.error,
                        }));
                results[index] = { proxy, ok: res.ok, ms: res.ms, error: res.error };
                if (res.ok) alive++;
            } catch (error) {
                results[index] = {
                    proxy,
                    ok: false,
                    ms: 0,
                    error: error instanceof Error ? error.message : String(error),
                };
            }
            checkedCount++;
            emitProgress(`🩺 ${country}: checked ${checkedCount}/${sample.length}, alive=${alive}/${targetAlive}`);
        }
    });

    await Promise.all(workers);
    const checked = results.filter(Boolean);
    const healthy = checked
        .filter(result => result.ok)
        .sort((a, b) => a.ms - b.ms)
        .map(result => ({ proxy: result.proxy, ms: result.ms, at: Date.now() }));

    emitProgress(`🩺 ${country}: fast preflight complete, alive=${healthy.length}/${checked.length}.`, true);
    return healthy;
}

async function batchFilterGenericProxiesForCountry(
    country: string,
    proxies: ProxyEntry[],
    onProgress?: (message: string) => void,
): Promise<ProxyEntry[]> {
    if (settings.store.proxyCheckService === "ipify") return [];

    const native = getNative() as (PluginNative<typeof import("./native")> & {
        batchCheckProxyIps?: (
            service: string,
            ips: string[],
        ) => Promise<Array<{ ip: string; proxy: boolean; hosting: boolean; countryCode: string | null; error?: string; }>>;
    }) | null;
    if (!native?.batchCheckProxyIps) return [];

    const candidates = proxies.slice(0, isRareProxyRegion(country) ? RARE_GENERIC_GEO_CHECK_LIMIT : GENERIC_GEO_CHECK_LIMIT);
    const byHost = new Map<string, ProxyEntry[]>();
    for (const proxy of candidates) {
        const entries = byHost.get(proxy.host) ?? [];
        entries.push(proxy);
        byHost.set(proxy.host, entries);
    }

    const hosts = Array.from(byHost.keys());
    const matches: ProxyEntry[] = [];
    onProgress?.(`🌐 ${country}: batch checking ${hosts.length} proxy IP(s) with ${settings.store.proxyCheckService}.`);

    for (let offset = 0; offset < hosts.length; offset += BATCH_PROXY_CHECK_CHUNK_SIZE) {
        const chunk = hosts.slice(offset, offset + BATCH_PROXY_CHECK_CHUNK_SIZE);
        const checked = await native.batchCheckProxyIps!(settings.store.proxyCheckService as any, chunk);
        for (const entry of checked) {
            if (entry.countryCode !== country) continue;
            if (!entry.proxy && !entry.hosting) continue;
            for (const proxy of byHost.get(entry.ip) ?? []) {
                matches.push({ ...proxy, country, source: proxy.source ? `${proxy.source}:batch` : "batch" });
            }
        }
        onProgress?.(`🌐 ${country}: batch checked ${Math.min(offset + chunk.length, hosts.length)}/${hosts.length}, matched=${matches.length}.`);
    }

    return matches;
}

async function preflightBatchFilteredProxies(
    country: string,
    proxies: ProxyEntry[],
    onProgress?: (message: string) => void,
    targetAlive = 3,
): Promise<WarmedProxyEntry[]> {
    const filtered = await batchFilterGenericProxiesForCountry(country, proxies, onProgress);
    if (filtered.length === 0) return [];

    onProgress?.(`🩺 ${country}: batch filter found ${filtered.length} likely match(es); tunnel-checking fastest ${targetAlive}.`);
    return await findHealthyProxiesFast(filtered, country, onProgress, targetAlive);
}

async function findGenericProxiesForCountry(
    country: string,
    onProgress?: (message: string) => void,
    targetAlive = 3,
    candidates?: ProxyEntry[],
): Promise<WarmedProxyEntry[]> {
    const native = getNative();
    if (!native) throw new Error("Native proxy support is not available (desktop only).");

    const rareRegion = isRareProxyRegion(country);
    const genericProxies = (candidates ?? await resolveProxiesGeneric()).slice(
        0,
        candidates
            ? rareRegion ? RARE_GEO_PREFLIGHT_SAMPLE_SIZE : GEO_PREFLIGHT_SAMPLE_SIZE
            : rareRegion ? RARE_GENERIC_GEO_CHECK_LIMIT : GENERIC_GEO_CHECK_LIMIT,
    );
    if (genericProxies.length === 0) return [];

    const batchFiltered = await preflightBatchFilteredProxies(country, genericProxies, onProgress, targetAlive);
    if (batchFiltered.length > 0) return batchFiltered;
    if (settings.store.proxyCheckService !== "ipify") {
        onProgress?.(`🌐 ${country}: batch check found no matching proxy IPs; skipping individual geo-check fallback.`);
        return [];
    }

    const concurrency = Math.min(rareRegion ? 18 : 10, genericProxies.length);
    const matches: WarmedProxyEntry[] = [];
    let nextIndex = 0;
    let checkedCount = 0;
    let lastProgressAt = 0;

    const emitProgress = (message: string, force = false) => {
        const now = Date.now();
        if (!force && now - lastProgressAt < 3000) return;
        lastProgressAt = now;
        onProgress?.(message);
    };

    emitProgress(`🌐 ${country}: ${rareRegion ? "rare-region " : ""}geo-checking up to ${genericProxies.length} proxy candidate(s).`, true);

    const workers = Array.from({ length: concurrency }, async () => {
        while (nextIndex < genericProxies.length && matches.length < targetAlive) {
            const index = nextIndex++;
            const proxy = genericProxies[index];

            try {
                const startedAt = Date.now();
                const geo = await native.geoCheckProxy(proxy.raw, rareRegion ? RARE_PROXY_CHECK_TIMEOUT_MS : undefined);
                if (geo.countryCode === country) {
                    matches.push({
                        proxy: { ...proxy, country, source: proxy.source ? `${proxy.source}:geo` : "geo" },
                        ms: Date.now() - startedAt,
                        at: Date.now(),
                    });
                }
            } catch { /* noop */ }

            checkedCount++;
            emitProgress(`🌐 ${country}: geo-checked ${checkedCount}/${genericProxies.length}, matched=${matches.length}/${targetAlive}.`);
        }
    });

    await Promise.all(workers);
    emitProgress(`🌐 ${country}: generic geo-check complete, matched=${matches.length}/${checkedCount}.`, true);
    return matches;
}

async function preflightUsableProxiesForCountry(
    country: string,
    proxies: ProxyEntry[],
    onProgress?: (message: string) => void,
    targetAlive = 8,
): Promise<WarmedProxyEntry[]> {
    let healthyEntries: WarmedProxyEntry[];
    if (!hasCountryFilteredProxySource(proxies, country)) {
        healthyEntries = await findGenericProxiesForCountry(country, onProgress, targetAlive, proxies);
        if (healthyEntries.length > 0) return setWarmedProxies(country, healthyEntries);
        if (settings.store.proxySource === "file") return [];
    }

    healthyEntries = await findHealthyProxiesFast(proxies, country, onProgress, targetAlive);
    if (healthyEntries.length > 0 || settings.store.proxySource === "file") {
        return setWarmedProxies(country, healthyEntries);
    }

    const genericEntries = await findGenericProxiesForCountry(country, onProgress, Math.max(GENERIC_MATCH_TARGET, targetAlive));
    return setWarmedProxies(country, genericEntries);
}

async function warmProxiesForCountry(
    country: string,
    onProgress?: (message: string) => void,
    force = false,
    targetAlive = WARMED_PROXY_TARGET,
): Promise<WarmedProxyEntry[]> {
    const code = normalizeRegion(country);
    const warmed = getFreshWarmedProxies(code);
    if (!force && warmed.length > 0) return warmed;

    const activeWarmup = proxyWarmupPromises.get(code);
    if (activeWarmup && !force) return await activeWarmup;

    const promise = (async () => {
        let proxies = await resolveProxiesForCountry(code);
        onProgress?.(`🌐 ${code}: loaded ${proxies.length} proxy candidate(s).`);

        if (proxies.length === 0) {
            proxies = await resolveProxiesGeneric();
            onProgress?.(`🌐 ${code}: no country list, using ${proxies.length} generic proxy candidate(s).`);
        }

        if (proxies.length === 0) return [];
        return await preflightUsableProxiesForCountry(code, proxies, onProgress, targetAlive);
    })().finally(() => proxyWarmupPromises.delete(code));

    proxyWarmupPromises.set(code, promise);
    return await promise;
}

async function warmProxiesForCountries(countries: string[], onProgress?: (message: string) => void): Promise<void> {
    const uniqueCountries = Array.from(new Set(countries.map(normalizeRegion)));
    await Promise.all(uniqueCountries.map(country => warmProxiesForCountry(country, onProgress).catch(error => {
        logger.error(`Failed to warm proxies for ${country}`, error);
        return [];
    })));
}

async function findUsableProxiesForCountry(
    country: string,
    proxies: ProxyEntry[],
    onProgress?: (message: string) => void,
    targetAlive = 8,
): Promise<ProxyEntry[]> {
    const warmed = getFreshWarmedProxies(country);
    if (warmed.length > 0) {
        onProgress?.(`🩺 ${country}: using ${warmed.length} warmed proxy candidate(s).`);
        return warmed.map(entry => entry.proxy);
    }

    const entries = await preflightUsableProxiesForCountry(country, proxies, onProgress, targetAlive);
    return entries.map(entry => entry.proxy);
}

// ─── High-level proxy operations ──────────────────────────────────────────────

/**
 * Fetches /quests/@me through proxies pre-filtered for the target country.
 * Falls back to generic proxies if country-specific list is empty.
 * Returns [quests, proxyUsed].
 */
async function fetchQuestsViaProxyForCountry(
    country: string,
    onProgress?: (message: string) => void,
): Promise<[ProxyQuestEntry[], ProxyEntry]> {
    const native = getNative();
    if (!native) throw new Error("Native proxy support is not available (desktop only).");

    const token = getToken();
    if (!token) throw new Error("Could not retrieve Discord auth token. Ensure you are logged in.");

    console.debug(`[QuestRegions] fetchQuestsViaProxyForCountry: country=${country}`);

    let proxies = await resolveProxiesForCountry(country);
    onProgress?.(`🌐 ${country}: loaded ${proxies.length} country proxy candidate(s).`);
    if (proxies.length > 0) {
        onProgress?.(`🌐 ${country}: provider breakdown ${formatProxySourceBreakdown(proxies)}.`);
    }

    if (proxies.length === 0) {
        console.debug("[QuestRegions] fetchQuestsViaProxyForCountry: no country-specific proxies, falling back to generic list");
        proxies = await resolveProxiesGeneric();
        onProgress?.(`🌐 ${country}: no country list, using ${proxies.length} generic proxy candidate(s).`);
        if (proxies.length > 0) {
            onProgress?.(`🌐 ${country}: generic provider breakdown ${formatProxySourceBreakdown(proxies)}.`);
        }
    }

    if (proxies.length === 0) {
        throw new Error(
            settings.store.proxySource === "file"
                ? "No proxy file loaded. Use the file picker in plugin settings."
                : `Could not fetch any proxies for country ${country}.`,
        );
    }

    onProgress?.(`🩺 ${country}: preflight checking ${proxies.length} proxy candidate(s)…`);
    const healthyProxies = await findUsableProxiesForCountry(country, proxies, onProgress, 3);
    if (healthyProxies.length === 0) throw new Error(`No responsive proxies for ${country}.`);
    proxies = healthyProxies;

    console.debug(`[QuestRegions] fetchQuestsViaProxyForCountry: ${proxies.length} proxies to try for ${country}`);
    onProgress?.(`🩺 ${country}: ${proxies.length} healthy proxy candidate(s) ready.`);

    const { result, proxy } = await tryProxiesSequentially(
        proxies,
        async (p, tok) => native.fetchQuestsViaProxy(p.raw, tok),
        token,
        `fetchQuests(${country})`,
    );
    rememberGoodProxy(country, proxy);

    let parsed: unknown;
    try {
        parsed = JSON.parse(result.body);
    } catch {
        throw new Error(`Proxy ${proxy.raw} returned invalid JSON: ${result.body.slice(0, 100)}`);
    }

    const quests = getQuestsFromResponseBody(parsed) as ProxyQuestEntry[];
    console.debug(`[QuestRegions] fetchQuestsViaProxyForCountry: ${country} → ${quests.length} quests via ${proxy.raw}`);
    onProgress?.(`✅ ${country}: fetch via \`${proxy.raw}\` returned ${quests.length} quest(s).`);
    return [quests, proxy];
}

async function fetchQuestViaProxyForCountry(
    questId: string,
    country: string,
    onProgress?: (message: string) => void,
): Promise<QuestProxyFetchResult> {
    const native = getNative();
    if (!native) throw new Error("Native proxy support is not available (desktop only).");

    const token = getToken();
    if (!token) throw new Error("Could not retrieve Discord auth token. Ensure you are logged in.");

    let proxies = await resolveProxiesForCountry(country);
    onProgress?.(`🌐 ${country}: loaded ${proxies.length} country proxy candidate(s).`);
    if (proxies.length > 0) {
        onProgress?.(`🌐 ${country}: provider breakdown ${formatProxySourceBreakdown(proxies)}.`);
    }

    if (proxies.length === 0) {
        proxies = await resolveProxiesGeneric();
        onProgress?.(`🌐 ${country}: no country list, using ${proxies.length} generic proxy candidate(s).`);
        if (proxies.length > 0) {
            onProgress?.(`🌐 ${country}: generic provider breakdown ${formatProxySourceBreakdown(proxies)}.`);
        }
    }

    if (proxies.length === 0) {
        throw new Error(
            settings.store.proxySource === "file"
                ? "No proxy file loaded. Use the file picker in plugin settings."
                : `Could not fetch any proxies for country ${country}.`,
        );
    }

    onProgress?.(`🩺 ${country}: preflight checking ${proxies.length} proxy candidate(s)…`);
    const healthyProxies = await findUsableProxiesForCountry(country, proxies, onProgress, 8);
    if (healthyProxies.length === 0) throw new Error(`No responsive proxies for ${country}.`);

    const errors: string[] = [];
    for (let i = 0; i < healthyProxies.length; i++) {
        const proxy = healthyProxies[i];
        onProgress?.(`🔎 ${country}: checking proxy ${i + 1}/${healthyProxies.length} for quest \`${questId}\`.`);

        const result = await native.fetchQuestsViaProxy(proxy.raw, token);
        if (result.error || result.status < 200 || result.status >= 300) {
            errors.push(`${proxy.raw}: ${result.error ?? `HTTP ${result.status}`}`);
            continue;
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(result.body);
        } catch {
            errors.push(`${proxy.raw}: invalid JSON`);
            continue;
        }

        const quests = getQuestsFromResponseBody(parsed) as ProxyQuestEntry[];
        if (quests.some(quest => getQuestId(quest) === questId)) {
            rememberGoodProxy(country, proxy);
            onProgress?.(`✅ ${country}: proxy \`${proxy.raw}\` exposes quest \`${questId}\`.`);
            return { quests, proxy };
        }

        errors.push(`${proxy.raw}: quest not visible (${quests.length} quest(s) returned)`);
    }

    throw new Error(
        `No checked ${country} proxy exposed quest ${questId}. ` +
        `Last results: ${errors.slice(-5).join("; ")}`,
    );
}

/**
 * Enrolls a quest through a country-appropriate proxy.
 * Uses the same proxy entry passed in (from a prior fetchQuests call) for consistency.
 */
async function enrollQuestViaProxy(questId: string, proxy: ProxyEntry): Promise<QuestProxyActionResult> {
    const native = getNative();
    if (!native) throw new Error("Native proxy support is not available (desktop only).");

    const token = getToken();
    if (!token) throw new Error("Could not retrieve Discord auth token.");

    console.debug(`[QuestRegions] enrollQuestViaProxy: quest=${questId} proxy=${proxy.raw}`);
    const result = await native.enrollQuestViaProxy(questId, proxy.raw, token, JSON.stringify({
        location: QUEST_ENROLL_LOCATION,
        metadata_sealed: null,
        traffic_metadata_sealed: null,
    }));
    console.debug(`[QuestRegions] enrollQuestViaProxy: status=${result.status} error=${result.error ?? "none"} body=${result.body.slice(0, 300)}`);

    if (result.error) throw new Error(result.error);
    if (result.status < 200 || result.status >= 300) {
        let detail = "";
        try { detail = (JSON.parse(result.body) as { message?: string; }).message ?? ""; } catch { /* noop */ }
        throw new Error(detail ? `HTTP ${result.status}: ${detail}` : `HTTP ${result.status}`);
    }
    if (proxy.country) rememberGoodProxy(proxy.country, proxy);
    return { status: result.status, body: result.body };
}

/**
 * Claims a quest reward through the given proxy.
 */
async function claimQuestRewardViaProxy(questId: string, proxy: ProxyEntry): Promise<void> {
    const native = getNative();
    if (!native) throw new Error("Native proxy support is not available (desktop only).");

    const token = getToken();
    if (!token) throw new Error("Could not retrieve Discord auth token.");

    console.debug(`[QuestRegions] claimQuestRewardViaProxy: quest=${questId} proxy=${proxy.raw}`);
    const result = await native.claimQuestViaProxy(questId, proxy.raw, token, JSON.stringify({
        platform: QUEST_CLAIM_PLATFORM,
        location: QUEST_ENROLL_LOCATION,
        metadata_sealed: null,
        traffic_metadata_sealed: null,
    }));
    console.debug(`[QuestRegions] claimQuestRewardViaProxy: status=${result.status} error=${result.error ?? "none"} body=${result.body.slice(0, 300)}`);

    if (result.error) throw new Error(result.error);
    if (result.status < 200 || result.status >= 300) {
        let detail = "";
        try { detail = (JSON.parse(result.body) as { message?: string; }).message ?? ""; } catch { /* noop */ }
        throw new Error(detail ? `HTTP ${result.status}: ${detail}` : `HTTP ${result.status}`);
    }
    if (proxy.country) rememberGoodProxy(proxy.country, proxy);
}

/**
 * Full flow for a single quest: find proxy → fetch to verify quest exists →
 * enroll → (optionally) claim. Returns a status string for display.
 */
async function startQuestViaRegionProxy(questId: string, country: string): Promise<string> {
    return await startQuestViaRegionProxyWithProgress(questId, country);
}

async function startQuestViaRegionProxyWithProgress(
    questId: string,
    country: string,
    onProgress?: (message: string) => void,
): Promise<string> {
    const key = `${questId}:${country}`;
    const active = activeQuestStarts.get(key);
    if (active) return await active;

    const promise = startQuestViaRegionProxyInner(questId, country, onProgress)
        .finally(() => activeQuestStarts.delete(key));
    activeQuestStarts.set(key, promise);
    return await promise;
}

async function startQuestViaRegionProxyInner(
    questId: string,
    country: string,
    onProgress?: (message: string) => void,
): Promise<string> {
    const regionLabel = formatCountryLabel(country);
    console.debug(`[QuestRegions] startQuestViaRegionProxy: quest=${questId} country=${country}`);

    // 1. Fetch quests for this country to confirm quest exists & get current status
    const { quests: proxyQuests, proxy } = await fetchQuestViaProxyForCountry(questId, country, onProgress);

    console.debug(`[QuestRegions] startQuestViaRegionProxy: got ${proxyQuests.length} quests from proxy ${proxy.raw}`);
    console.debug("[QuestRegions] startQuestViaRegionProxy: quest IDs from proxy:", proxyQuests.map(q => getQuestId(q)));

    // 2. Check if already enrolled/claimed
    const questFromProxy = proxyQuests.find(q => getQuestId(q) === questId);
    if (!questFromProxy) throw new Error(`Quest ${questId} was not visible through ${country} proxy ${proxy.raw}.`);
    const status = getObjectProperty(questFromProxy ?? {}, "userStatus", "user_status");
    const alreadyEnrolled = !!getStringProperty(status, "enrolledAt", "enrolled_at");
    const alreadyClaimed = !!getStringProperty(status, "claimedAt", "claimed_at");

    if (alreadyClaimed) {
        console.debug(`[QuestRegions] startQuestViaRegionProxy: quest ${questId} already claimed`);
        return `Quest \`${questId}\` (${regionLabel}) already claimed.`;
    }

    // 3. Enroll if not already enrolled
    if (!alreadyEnrolled) {
        console.debug(`[QuestRegions] startQuestViaRegionProxy: enrolling quest ${questId} via ${proxy.raw}`);
        console.debug(`[QuestRegions] startQuestViaRegionProxy: sending one enroll request quest=${questId} proxy=${proxy.raw}`);
        const result = await enrollQuestViaProxy(questId, proxy);
        onProgress?.([
            `✅ Enroll response for \`${questId}\` via \`${proxy.raw}\`: HTTP ${result.status}`,
            `\`\`\`json\n${formatProxyResponseBody(result.body)}\n\`\`\``,
        ].join("\n"));
        console.debug("[QuestRegions] startQuestViaRegionProxy: enrolled OK");
    } else {
        console.debug(`[QuestRegions] startQuestViaRegionProxy: quest ${questId} already enrolled, skipping enroll step`);
    }

    return `✅ Enrolled quest \`${questId}\` for ${regionLabel} via \`${proxy.raw}\`${alreadyEnrolled ? " (was already enrolled)" : ""}.`;
}

async function getUnclaimedQuests(): Promise<unknown[]> {
    const fetchedQuests = await fetchUserQuests().catch(() => []);
    const quests = fetchedQuests.length ? fetchedQuests : getStoredQuests();
    return quests
        .filter(isQuestUnclaimed)
        .sort((a, b) => {
            const expiresA = getQuestExpiresAt(a)?.getTime() ?? Number.MAX_SAFE_INTEGER;
            const expiresB = getQuestExpiresAt(b)?.getTime() ?? Number.MAX_SAFE_INTEGER;
            return expiresA - expiresB || getQuestName(a).localeCompare(getQuestName(b));
        });
}

// ─── Region data loading ──────────────────────────────────────────────────────

async function loadQuestRegions(signal: AbortSignal): Promise<QuestRegionCard[]> {
    console.debug("[QuestRegions] loadQuestRegions: fetching restriction data and quest list…");
    const [restrictionData, discordQuestData, questsData, storedDiscoveredRestrictions] = await Promise.all([
        fetchJson<QuestRegionsResponse>(QUEST_RESTRICTIONS_URL, signal),
        fetchJson<QuestRegionsResponse>(DISCORDQUEST_REGIONS_URL, signal),
        fetchJson<QuestListResponse>(QUEST_LIST_URL, signal),
        getStoredDiscoveredRegionRestrictions(),
    ]);

    fetchDiscordIdQuestApi(signal).then(discordIdQuestsData => {
        if (!discordIdQuestsData.length) return;
        for (const quest of discordIdQuestsData) {
            if (typeof quest.id === "string") questMap.set(quest.id, quest as QuestEntry & { id: string; });
        }
    }).catch(() => { /* best-effort */ });

    if (!Array.isArray(questsData)) {
        console.debug("[QuestRegions] loadQuestRegions: unexpected quest list data shape", {
            questDataIsArray: Array.isArray(questsData),
        });
        return [];
    }

    const now = new Date();
    const questMap = new Map(
        questsData
            .filter((quest): quest is QuestEntry & { id: string; } => typeof quest.id === "string")
            .map(quest => [quest.id, quest]),
    );

    const restrictionsById = new Map<string, RegionRestriction>();

    for (const restriction of restrictionData.quests ?? []) restrictionsById.set(restriction.id, restriction);

    for (const restriction of discordQuestData.quests ?? []) {
        const existing = restrictionsById.get(restriction.id);
        if (existing) {
            if (restriction.show_age_gate !== undefined) existing.show_age_gate = restriction.show_age_gate;
            if (restriction.is_global !== undefined) existing.is_global = restriction.is_global;
            if (Array.isArray(restriction.regions) && restriction.regions.length > 0) {
                existing.regions = Array.from(new Set([...existing.regions, ...restriction.regions])).sort();
            }
        } else {
            restrictionsById.set(restriction.id, restriction);
        }
    }

    for (const restriction of storedDiscoveredRestrictions) {
        const existing = restrictionsById.get(restriction.id);
        if (existing) {
            if (Array.isArray(restriction.regions) && restriction.regions.length > 0) {
                existing.regions = Array.from(new Set([...(existing.regions ?? []), ...restriction.regions])).sort();
            }
        } else {
            restrictionsById.set(restriction.id, restriction);
        }
        questMap.set(restriction.id, restriction);
    }

    // Fire inferred region fetch in the background — it only merges supplemental
    // regions into existing gist entries and isn't needed for the initial render.
    // Quests not in the gist are intentionally skipped (they are global).
    fetchRegionalUserQuestEntries(signal).then(inferred => {
        let changed = false;
        for (const [id, restriction] of inferred) {
            const existing = restrictionsById.get(id);
            if (!existing) continue;
            if (!Array.isArray(restriction.regions) || restriction.regions.length === 0) continue;
            const baseRegions = Array.isArray(existing.regions) ? existing.regions : [];
            const merged = Array.from(new Set([...baseRegions, ...restriction.regions])).sort();
            if (merged.length === baseRegions.length) continue;
            restrictionsById.set(id, { ...existing, regions: merged });
            changed = true;
        }
        if (changed) regionCache = null;
    }).catch(() => { /* best-effort */ });

    questCardRegions = new Map();
    globalQuestIds = new Set();
    ageGatedQuestIds = new Set();

    for (const restriction of restrictionsById.values()) {
        if (restriction.show_age_gate) ageGatedQuestIds.add(restriction.id);
        if (restriction.is_global || !Array.isArray(restriction.regions) || restriction.regions.length === 0) {
            globalQuestIds.add(restriction.id);
            continue;
        }
        questCardRegions.set(restriction.id, new Set(getAuthoritativeRegions(restriction.id, restriction.regions)));
    }

    const activeRestrictions = Array.from(restrictionsById.values()).filter(restriction => {
        if (restriction.is_global) return false;
        if (!Array.isArray(restriction.regions) || restriction.regions.length === 0) return false;
        const quest = questMap.get(restriction.id) ?? QuestsStore.getQuest?.(restriction.id);
        if (!quest) return false;
        return isQuestActive(quest, now);
    });

    console.debug(`[QuestRegions] loadQuestRegions: ${activeRestrictions.length} active region-restricted quests found`);

    activeQuestIds = new Set(activeRestrictions.map(r => r.id));
    publicQuestRegions = new Map();
    publicRegionQuestIds = new Map();

    const byRegion = new Map<string, RegionRestriction[]>();

    for (const restriction of activeRestrictions) {
        const authoritativeRegions = getAuthoritativeRegions(restriction.id, restriction.regions);
        publicQuestRegions.set(restriction.id, new Set(authoritativeRegions));

        for (const key of authoritativeRegions) {
            const questIds = publicRegionQuestIds.get(key) ?? new Set<string>();
            questIds.add(restriction.id);
            publicRegionQuestIds.set(key, questIds);

            const list = byRegion.get(key) ?? [];
            list.push(restriction);
            byRegion.set(key, list);
        }
    }

    const cards = Array.from(byRegion.entries())
        .map(([code, quests]) => ({
            code,
            name: getRegionName(code),
            flagUrl: getFlagUrl(code),
            emoji: getRegionEmoji(code),
            quests,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

    void notifyNewQuestsIfNeeded(cards);
    return cards;
}

async function getQuestRegions(force = false): Promise<QuestRegionCard[]> {
    const now = Date.now();
    if (!force && regionCache && now - regionCache.at < 5 * 60 * 1000) {
        console.debug("[QuestRegions] getQuestRegions: returning cached data");
        return regionCache.data;
    }

    if (!regionPromise) {
        console.debug("[QuestRegions] getQuestRegions: starting fresh fetch…");
        const controller = new AbortController();
        regionPromise = loadQuestRegions(controller.signal)
            .then(data => {
                regionCache = { at: Date.now(), data };
                console.debug(`[QuestRegions] getQuestRegions: cached ${data.length} region cards`);
                return data;
            })
            .finally(() => { regionPromise = null; });
    }

    return await regionPromise;
}

function scheduleProxyQuestDiscovery(force = false): void {
    if (!settings.store.discoverQuestsViaProxies) return;

    void discoverQuestRegionsViaProxies(force)
        .then(async discoveries => {
            if (discoveries.length > 0) await getQuestRegions(true);
        })
        .catch(error => logger.error("Failed to discover region quests via proxies", error));
}

function startProxyDiscoveryTimer(): void {
    if (proxyDiscoveryTimer) clearInterval(proxyDiscoveryTimer);

    scheduleProxyQuestDiscovery();
    proxyDiscoveryTimer = setInterval(() => scheduleProxyQuestDiscovery(), PROXY_DISCOVERY_TIMER_INTERVAL_MS);
}

function stopProxyDiscoveryTimer(): void {
    if (!proxyDiscoveryTimer) return;
    clearInterval(proxyDiscoveryTimer);
    proxyDiscoveryTimer = null;
}

// ─── Quest → country mapping ──────────────────────────────────────────────────

/**
 * Returns the primary country code for a quest ID, checking both
 * the public gist data and the supplemental channel feed.
 */
function getCountryForQuest(questId: string): string | null {
    // Check public gist data first
    const regions = publicQuestRegions.get(questId);
    if (regions && regions.size > 0) {
        const code = regions.values().next().value as string;
        console.debug(`[QuestRegions] getCountryForQuest: ${questId} → ${code} (public gist)`);
        return code;
    }
    // Check supplemental channel data
    const supplemental = supplementalQuestRegions.get(questId);
    if (supplemental && supplemental.size > 0) {
        const code = supplemental.values().next().value?.code as string | undefined;
        if (code) {
            console.debug(`[QuestRegions] getCountryForQuest: ${questId} → ${code} (supplemental)`);
            return code;
        }
    }
    console.debug(`[QuestRegions] getCountryForQuest: ${questId} → no country found`);
    return null;
}

/**
 * Returns all country codes for a quest ID (public + supplemental).
 */
function getCountriesForQuest(questId: string): string[] {
    const codes = new Set<string>();
    const pub = publicQuestRegions.get(questId);
    if (pub) for (const c of pub) codes.add(c);
    const sup = supplementalQuestRegions.get(questId);
    if (sup) for (const r of sup.values()) codes.add(r.code);
    return Array.from(codes);
}

function formatCountryLabel(country: string): string {
    return `${getRegionEmoji(country)} ${getRegionName(country)} (${country})`;
}

async function startQuestViaCandidateCountries(
    questId: string,
    countries: string[],
    onProgress?: (message: string) => void,
): Promise<string> {
    const uniqueCountries = orderCountriesByProxySpeed(countries);
    if (uniqueCountries.length === 0) {
        throw new Error(`Could not determine region for quest \`${questId}\`.`);
    }

    const errors: string[] = [];

    for (let i = 0; i < uniqueCountries.length; i++) {
        const country = uniqueCountries[i];
        if (uniqueCountries.length > 1) {
            onProgress?.(`🔎 Trying ${formatCountryLabel(country)} for \`${questId}\` (${i + 1}/${uniqueCountries.length})…`);
        }

        try {
            return await startQuestViaRegionProxyWithProgress(questId, country, onProgress);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errors.push(`${country}: ${message}`);
        }
    }

    throw new Error(
        `Failed to enroll quest \`${questId}\` for all known regions. ` +
        `Last results: ${errors.slice(-5).join("; ")}`
    );
}

// ─── Command formatting ───────────────────────────────────────────────────────

function getQuestRegionCommandEntries(regions: QuestRegionCard[]): QuestRegionCommandEntry[] {
    const byQuest = new Map<string, QuestRegionCommandEntry>();

    for (const region of regions) {
        for (const quest of region.quests) {
            if (!isQuestAvailableForCommand(quest)) continue;
            const entry = byQuest.get(quest.id) ?? { id: quest.id, regions: [] };
            if (!entry.regions.some(r => r.code === region.code)) entry.regions.push(region);
            byQuest.set(quest.id, entry);
        }
    }

    for (const [questId, supplementalRegions] of supplementalQuestRegions) {
        if (!activeQuestIds.has(questId)) continue;
        const entry = byQuest.get(questId) ?? { id: questId, regions: [] };
        for (const region of supplementalRegions.values()) {
            if (!isSupplementalRegionAuthoritative(questId, region)) continue;
            if (!entry.regions.some(r => r.code === region.code)) entry.regions.push(region);
        }
        if (entry.regions.length === 0) continue;
        byQuest.set(questId, entry);
    }

    return Array.from(byQuest.values())
        .map(entry => ({ ...entry, regions: entry.regions.sort((a, b) => a.name.localeCompare(b.name)) }))
        .sort((a, b) => {
            const c = (a.regions[0]?.name ?? "").localeCompare(b.regions[0]?.name ?? "");
            return c || a.id.localeCompare(b.id);
        });
}

function formatQuestLink(questId: string, embedLinks: boolean) {
    const url = `https://discord.com/quests/${questId}`;
    return embedLinks ? url : `<${url}>`;
}

async function formatQuestRegionsCommand(regions: QuestRegionCard[], embedLinks = true): Promise<string> {
    await fetchSupplementalQuestMessages().catch(() => null);
    const entries = getQuestRegionCommandEntries(regions);
    if (entries.length === 0) return "No active region-restricted quests were found.";

    return entries.map(entry => {
        const regionText = entry.regions.map(r => `${r.emoji} ${r.name}`).join(", ");
        return `- ${regionText}: ${formatQuestLink(entry.id, embedLinks)}`;
    }).join("\n");
}

function formatUnclaimedQuestsCommand(quests: unknown[]): string {
    if (quests.length === 0) return "No unclaimed active quests were found.";
    return quests.map(quest => {
        const id = getQuestId(quest);
        const completed = Boolean(getStringProperty(getQuestUserStatus(quest), "completedAt", "completed_at"));
        const label = completed ? "completed, unclaimed" : "unclaimed";
        return `- ${getQuestName(quest)} (${label}): https://discord.com/quests/${id}`;
    }).join("\n");
}

function splitMessageContent(content: string): string[] {
    const chunks: string[] = [];
    let current = "";
    for (const line of content.split("\n")) {
        const next = current ? `${current}\n${line}` : line;
        if (next.length <= 1900) { current = next; continue; }
        if (current) chunks.push(current);
        current = line;
    }
    if (current) chunks.push(current);
    return chunks;
}

function sendBotMessageChunks(channelId: string, content: string) {
    for (const chunk of splitMessageContent(content)) sendBotMessage(channelId, { content: chunk });
}

async function sendUserMessageChunks(channelId: string, content: string) {
    for (const chunk of splitMessageContent(content)) await sendMessage(channelId, { content: chunk });
}

function getRandomAutoStartDelayMs(): number {
    return Math.round(AUTO_START_MIN_DELAY_MS + Math.random() * (AUTO_START_MAX_DELAY_MS - AUTO_START_MIN_DELAY_MS));
}

// ─── Context menu — right-click on quest tile ─────────────────────────────────

/**
 * Injected into the "quests-entry" context menu (same hook as Questify uses).
 * Adds a "Fetch Quest via Region Proxy" item that runs the full enroll flow.
 */
function QuestRegionContextMenu(children: React.ReactNode[], props: { quest: unknown; }) {
    const questId = getQuestId(props.quest);
    if (!questId) return;

    const country = getCountryForQuest(questId);
    const regionLabel = country ? `${getRegionEmoji(country)} ${getRegionName(country)}` : "Unknown Region";
    const isRegionQuest = !!country;

    children.push(
        <Menu.MenuGroup id="vc-quest-regions-group">
            {isRegionQuest && (
                <Menu.MenuItem
                    id="vc-quest-regions-fetch"
                    label={`Start via ${regionLabel} Proxy`}
                    action={async () => {
                        console.debug(`[QuestRegions] context menu: Start via proxy — quest=${questId} country=${country}`);
                        showNotification({
                            title: "QuestRegions",
                            body: `Starting quest via ${regionLabel} proxy…`,
                            dismissOnClick: true,
                        });

                        try {
                            const msg = await startQuestViaRegionProxy(questId, country!);
                            console.debug("[QuestRegions] context menu: result:", msg);
                            showNotification({
                                title: "QuestRegions",
                                body: msg,
                                dismissOnClick: true,
                            });
                        } catch (err) {
                            const msg = err instanceof Error ? err.message : String(err);
                            console.debug("[QuestRegions] context menu: error:", msg);
                            showNotification({
                                title: "QuestRegions — Error",
                                body: msg.slice(0, 200),
                                dismissOnClick: true,
                            });
                        }
                    }}
                />
            )}
            <Menu.MenuItem
                id="vc-quest-regions-debug"
                label="Log Quest Region Info"
                action={() => {
                    const countries = getCountriesForQuest(questId);
                    console.debug(`[QuestRegions] Quest ${questId} regions:`, countries);
                    console.debug("[QuestRegions] publicQuestRegions entry:", publicQuestRegions.get(questId));
                    console.debug("[QuestRegions] supplementalQuestRegions entry:", supplementalQuestRegions.get(questId));
                    console.debug("[QuestRegions] proxy source:", settings.store.proxySource);
                    console.debug("[QuestRegions] file proxies loaded:", parseProxyList(settings.store.proxyFileContent ?? "").length);
                }}
            />
        </Menu.MenuGroup>
    );
}

// ─── Notifications ────────────────────────────────────────────────────────────

function buildByQuestMap(cards: QuestRegionCard[]): Map<string, CommandRegion[]> {
    const byQuest = new Map<string, CommandRegion[]>();
    for (const card of cards) {
        for (const quest of card.quests) {
            const entry = byQuest.get(quest.id) ?? [];
            if (!entry.some(r => r.code === card.code)) entry.push(card);
            byQuest.set(quest.id, entry);
        }
    }
    return byQuest;
}

async function notifyNewQuestsIfNeeded(cards: QuestRegionCard[]) {
    if (!settings.store.notifyNewQuests) return;

    const byQuest = buildByQuestMap(cards);
    const notifiedQuestIds = new Set(settings.store.notifiedQuestIds);

    for (const [questId, regions] of byQuest) {
        if (knownQuestIds.has(questId) || notifiedQuestIds.has(questId)) continue;
        knownQuestIds.add(questId);

        const quest = QuestsStore.getQuest?.(questId)
            ?? cards.flatMap(card => card.quests).find(entry => entry.id === questId)
            ?? {};
        if (isQuestCompletedOrClaimed(quest) || !markQuestRegionNotified(questId)) continue;
        notifiedQuestIds.add(questId);

        const questName = getQuestName(quest);
        const regionNames = regions.slice(0, 4).map(r => r.name).join(", ")
            + (regions.length > 4 ? ` +${regions.length - 4} more` : "");
        const imageUrl = getQuestImageUrl(questId);

        showNotification({
            title: "New Region Quest Available",
            body: `${questName !== "Unknown Quest" ? questName + "\n" : ""}${regionNames}`,
            ...(imageUrl ? { image: imageUrl } : {}),
            icon: regions[0] ? getFlagUrl(regions[0].code) : undefined,
            dismissOnClick: true,
            onClick: () => NavigationRouter.transitionTo(`${QUEST_PATH}#${questId}`),
        });
    }
}

// ─── React components ─────────────────────────────────────────────────────────

function QuestRegionBadge({ name, flagUrl }: { name: string; flagUrl: string; }) {
    return (
        <div className={cl("badge")}>
            <img className={cl("badge-flag")} src={flagUrl} alt={name} />
            <span className={cl("badge-name")}>{name}</span>
        </div>
    );
}

function QuestRegionOverflowTooltip({ regions }: { regions: QuestRegionCard[]; }) {
    return (
        <div className={cl("quest-region-overflow-tooltip")}>
            <Text variant="text-sm/semibold" className={cl("quest-region-overflow-title")}>
                +{regions.length} other countr{regions.length === 1 ? "y" : "ies"}
            </Text>
            <div className={cl("quest-region-overflow-list")}>
                {regions.map(region => (
                    <div key={region.code} className={cl("quest-region-overflow-item")}>
                        <img className={cl("quest-region-overflow-item-flag")} src={region.flagUrl} alt={region.name} />
                        <Text variant="text-sm/normal">
                            {region.name}
                        </Text>
                    </div>
                ))}
            </div>
        </div>
    );
}

function QuestRegionOverflowBadge({ regions }: { regions: QuestRegionCard[]; }) {
    return (
        <Tooltip text={<QuestRegionOverflowTooltip regions={regions} />}>
            {tooltipProps => (
                <div {...tooltipProps} className={classes(cl("badge"), cl("badge-overflow"))}>
                    <span className={cl("badge-name")}>+{regions.length}</span>
                </div>
            )}
        </Tooltip>
    );
}

function QuestAgeRestrictedBadge() {
    return (
        <Tooltip text="Age Restricted">
            {tooltipProps => (
                <div {...tooltipProps} className={classes(cl("badge"), cl("age-restricted-badge"))}>
                    <span className={cl("badge-name")}>🔞</span>
                </div>
            )}
        </Tooltip>
    );
}

function QuestGlobalBadge() {
    return (
        <div className={classes(cl("badge"), cl("global-badge"))}>
            <span className={cl("badge-flag")}>🌐</span>
            <span className={cl("badge-name")}>Global</span>
        </div>
    );
}

async function getQuestCardRegions(questId: string): Promise<QuestRegionCard[]> {
    await getQuestRegions();
    const regions = questCardRegions.get(questId);
    if (!regions?.size) return [];

    return Array.from(regions)
        .map(code => ({
            code,
            name: getRegionName(code),
            flagUrl: getFlagUrl(code),
            emoji: getRegionEmoji(code),
            quests: [],
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

function QuestRegionInfo({ quest }: { quest: QuestLike; }) {
    const [regions, setRegions] = React.useState<QuestRegionCard[] | null>(null);

    React.useEffect(() => {
        let alive = true;
        if (!quest.id) {
            setRegions([]);
            return () => { alive = false; };
        }

        void getQuestCardRegions(quest.id).then(data => {
            if (!alive) return;
            setRegions(data);
        });
        return () => { alive = false; };
    }, [quest.id]);

    const ageRestricted = isQuestAgeRestricted(quest);
    const isGlobal = regions !== null && regions.length === 0 && isQuestGlobal(quest);
    const visibleRegions = (regions ?? []).slice(0, QUEST_REGION_BADGE_LIMIT);
    const overflowRegions = (regions ?? []).slice(QUEST_REGION_BADGE_LIMIT);

    if (!visibleRegions.length && !ageRestricted && !isGlobal) return null;

    return (
        <div className={cl("quest-region")}>
            {isGlobal && <QuestGlobalBadge />}
            {visibleRegions.map(region => (
                <QuestRegionBadge key={region.code} name={region.name} flagUrl={region.flagUrl} />
            ))}
            {overflowRegions.length > 0 && <QuestRegionOverflowBadge regions={overflowRegions} />}
            {ageRestricted && <QuestAgeRestrictedBadge />}
        </div>
    );
}

function ProxyFilePicker() {
    const [status, setStatus] = useState<string>(() => {
        const content = settings.store.proxyFileContent ?? "";
        if (!content) return "No proxy file loaded.";
        const count = parseProxyList(content).length;
        return `${count} prox${count === 1 ? "y" : "ies"} loaded.`;
    });

    const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const text = typeof reader.result === "string" ? reader.result : "";
            settings.store.proxyFileContent = text;
            const count = parseProxyList(text).length;
            setStatus(`${count} prox${count === 1 ? "y" : "ies"} loaded from ${file.name}.`);
        };
        reader.readAsText(file);
        e.target.value = "";
    }, []);

    const handleClear = useCallback(() => {
        settings.store.proxyFileContent = "";
        setStatus("No proxy file loaded.");
    }, []);

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
            <Paragraph style={{ margin: 0, fontWeight: 600 }}>Proxy List File</Paragraph>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Button
                    size={Button.Sizes.SMALL}
                    onClick={() => document.getElementById("vc-quest-regions-proxy-input")?.click()}
                >
                    Load .txt file
                </Button>
                {settings.store.proxyFileContent && (
                    <Button
                        size={Button.Sizes.SMALL}
                        color={Button.Colors.RED}
                        onClick={handleClear}
                    >
                        Clear
                    </Button>
                )}
                <span style={{ fontSize: 13, opacity: 0.75 }}>{status}</span>
            </div>
            <input
                id="vc-quest-regions-proxy-input"
                type="file"
                accept=".txt,text/plain"
                style={{ display: "none" }}
                onChange={handleFile}
            />
            <Paragraph style={{ margin: 0, fontSize: 12, opacity: 0.6 }}>
                One proxy per line, format: <code>host:port</code>. Only used when source is set to "Proxy file".
            </Paragraph>
        </div>
    );
}

const QuestRegionsAbout = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Paragraph>
            Join <Link href={QUEST_DATA_INVITE_URL}>{QUEST_DATA_INVITE_URL}</Link> for access to more recent region quest data.
        </Paragraph>
        <Paragraph style={{ margin: 0, fontSize: 13, opacity: 0.75 }}>
            When using API sources, proxies are fetched directly filtered by the quest's country — no geo-detection needed.
            Right-click any region quest tile to start it via a matching proxy.
        </Paragraph>
        <ProxyFilePicker />
    </div>
);

// ─── Slash command options ────────────────────────────────────────────────────

const linkEmbedOption = {
    name: "embed_links",
    description: "Whether quest links should embed",
    type: ApplicationCommandOptionType.BOOLEAN,
    required: false,
};

// ─── Plugin ───────────────────────────────────────────────────────────────────

export default definePlugin({
    name: "QuestRegions",
    description: "Show active region-restricted Quests and start them via country-matched proxies (right-click any quest tile).",
    authors: [EquicordDevs.omaw, EquicordDevs.justjxke],
    tags: ["Utility"],
    settings,

    start() {
        knownQuestIds.clear();
        countryProxyCache.clear();
        void getQuestRegions()
            .then(cards => {
                for (const card of cards) for (const quest of card.quests) knownQuestIds.add(quest.id);
                console.debug(`[QuestRegions] start: seeded ${knownQuestIds.size} known quest IDs`);
            })
            .catch(err => logger.error("Failed to seed known quest IDs", err));
    },

    stop() {
        knownQuestIds.clear();
        discoveredQuestCache.clear();
        questCardRegions.clear();
        globalQuestIds.clear();
        ageGatedQuestIds.clear();
        activeQuestStarts.clear();
        countryProxyCache.clear();
        warmedProxyCache.clear();
        proxyWarmupPromises.clear();
        lastForegroundProxyCheckAt = 0;
        stopProxyDiscoveryTimer();
    },

    // Right-click context menu on quest tiles — same hook as Questify
    contextMenus: {
        "quests-entry": QuestRegionContextMenu,
    },

    commands: [
        {
            name: "quest-regions",
            description: "List active region-restricted quests",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [linkEmbedOption],
            execute: async (opts, ctx) => {
                try {
                    const embedLinks = findOption(opts, "embed_links", true);
                    const regions = await getQuestRegions(true);
                    const text = await formatQuestRegionsCommand(regions, embedLinks);
                    sendBotMessageChunks(ctx.channel.id, text);
                } catch {
                    sendBotMessage(ctx.channel.id, { content: "Failed to load active region-restricted quests." });
                }
            },
        },
        {
            name: "unclaimed-quests",
            description: "Show unclaimed active quests from the Quest page",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: async (_, ctx) => {
                try {
                    const quests = await getUnclaimedQuests();
                    sendBotMessageChunks(ctx.channel.id, formatUnclaimedQuestsCommand(quests));
                } catch {
                    sendBotMessage(ctx.channel.id, { content: "Failed to load unclaimed quests." });
                }
            },
        },
        {
            name: "send-regions",
            description: "Send the active region-restricted Quest list as your message",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [linkEmbedOption],
            execute: async (opts, ctx) => {
                try {
                    const embedLinks = findOption(opts, "embed_links", true);
                    const regions = await getQuestRegions(true);
                    const text = await formatQuestRegionsCommand(regions, embedLinks);
                    await sendUserMessageChunks(ctx.channel.id, text);
                } catch {
                    sendBotMessage(ctx.channel.id, { content: "Failed to send active region-restricted quests." });
                }
            },
        },
        {
            name: "send-region",
            description: "Send quests available for a specific region as your message",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "region",
                    description: "Region code or name (e.g. US, JP, France)",
                    type: ApplicationCommandOptionType.STRING,
                    required: true,
                },
                linkEmbedOption,
            ],
            execute: async (opts, ctx) => {
                try {
                    const regionInput = findOption<string>(opts, "region", "").trim();
                    const embedLinks = findOption(opts, "embed_links", true);

                    if (!regionInput) {
                        sendBotMessage(ctx.channel.id, { content: "Please provide a region code or name." });
                        return;
                    }

                    const matchedCode = REGION_CODES_BY_NAME.get(regionInput.toLowerCase()) ?? normalizeRegion(regionInput);
                    const regions = await getQuestRegions(true);
                    await fetchSupplementalQuestMessages().catch(() => null);

                    const entries = getQuestRegionCommandEntries(regions)
                        .filter(entry => entry.regions.some(r => r.code === matchedCode));

                    if (entries.length === 0) {
                        sendBotMessage(ctx.channel.id, { content: `No active region-restricted quests found for **${regionInput}**.` });
                        return;
                    }

                    const regionName = getRegionName(matchedCode);
                    const emoji = getRegionEmoji(matchedCode);
                    const lines = entries.map(entry => `- ${formatQuestLink(entry.id, embedLinks)}`).join("\n");
                    await sendUserMessageChunks(ctx.channel.id, `${emoji} **${regionName}** quests:\n${lines}`);
                } catch {
                    sendBotMessage(ctx.channel.id, { content: "Failed to look up region quests." });
                }
            },
        },
        {
            name: "list-proxies",
            description: "Show proxies available for a country from all configured API sources",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "country",
                    description: "Country code (e.g. US, DE, JP) — required for API sources",
                    type: ApplicationCommandOptionType.STRING,
                    required: false,
                },
                {
                    name: "limit",
                    description: "Max proxies to show (default: 30)",
                    type: ApplicationCommandOptionType.INTEGER,
                    required: false,
                },
            ],
            execute: async (opts, ctx) => {
                const countryInput = findOption<string>(opts, "country", "").trim().toUpperCase();
                const limit = Math.min(Math.max(1, findOption(opts, "limit", 30)), 200);
                const src = settings.store.proxySource;

                console.debug(`[QuestRegions] /list-proxies: country=${countryInput || "(none)"} source=${src} limit=${limit}`);
                sendBotMessage(ctx.channel.id, { content: `Fetching proxies (source: **${src}**)…` });

                try {
                    let proxies: ProxyEntry[];

                    if (src === "file") {
                        proxies = parseProxyList(settings.store.proxyFileContent ?? "");
                        if (proxies.length === 0) {
                            sendBotMessage(ctx.channel.id, { content: "No proxy file loaded. Use the file picker in plugin settings." });
                            return;
                        }
                    } else if (countryInput) {
                        proxies = await resolveProxiesForCountry(countryInput);
                    } else {
                        // No country given, show all-country from proxyscrape
                        proxies = await fetchScrapedProxies();
                    }

                    if (proxies.length === 0) {
                        sendBotMessage(ctx.channel.id, { content: `No proxies found${countryInput ? ` for **${countryInput}**` : ""}.` });
                        return;
                    }

                    const shown = proxies.slice(0, limit);
                    const lines = shown.map((p, i) => `\`${i + 1}.\` \`${p.raw}\`${p.source ? ` *(${p.source})*` : ""}${p.country ? ` — ${getRegionEmoji(p.country)} ${p.country}` : ""}`);
                    const header = `**${proxies.length} proxies**${countryInput ? ` for ${getRegionEmoji(countryInput)} **${getRegionName(countryInput)}**` : ""} (source: **${src}**)${proxies.length > limit ? ` — showing first ${limit}` : ""}:`;
                    sendBotMessageChunks(ctx.channel.id, `${header}\n${lines.join("\n")}`);
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    console.debug("[QuestRegions] /list-proxies error:", msg);
                    sendBotMessage(ctx.channel.id, { content: `Failed: ${msg}` });
                }
            },
        },
        {
            name: "check-region-proxies",
            description: "Pre-check and warm fast proxies for quest page regions",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: async (_, ctx) => {
                try {
                    const countries = await getQuestPageRegionCountries();

                    if (countries.length === 0) {
                        sendBotMessage(ctx.channel.id, { content: "No quest-page region data is available to check proxies for." });
                        return;
                    }
                    sendBotMessage(ctx.channel.id, {
                        content: `Checking proxies with **${settings.store.proxyCheckService}** for **${countries.length}** region(s): ${countries.map(country => `${getRegionEmoji(country)} ${country}`).join(", ")}…`,
                    });

                    const results: string[] = [];
                    let readyCount = 0;
                    for (const country of countries) {
                        const warmed = await warmProxiesForCountry(
                            country,
                            progress => sendBotMessage(ctx.channel.id, { content: progress }),
                            true,
                        );
                        const fastest = warmed[0];
                        if (fastest) readyCount++;
                        results.push(
                            fastest
                                ? `- ${getRegionEmoji(country)} **${getRegionName(country)}**: ${warmed.length} ready, fastest \`${fastest.proxy.raw}\` (${fastest.ms}ms)`
                                : `- ${getRegionEmoji(country)} **${getRegionName(country)}**: no responsive proxies found`,
                        );
                    }

                    if (readyCount > 0) lastForegroundProxyCheckAt = Date.now();
                    sendBotMessageChunks(ctx.channel.id, `**Proxy check complete:**\n${results.join("\n")}`);
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    console.debug("[QuestRegions] /check-region-proxies error:", msg);
                    sendBotMessage(ctx.channel.id, { content: `Failed: ${msg}` });
                }
            },
        },
        {
            name: "check-new-region-quests",
            description: "Check for new regional quests with warmed proxies",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: async (_, ctx) => {
                if (!lastForegroundProxyCheckAt || warmedProxyCache.size === 0) {
                    sendBotMessage(ctx.channel.id, {
                        content: "Run `/check-region-proxies` first so regional proxies are checked and warmed before scanning for new quests.",
                    });
                    return;
                }

                sendBotMessage(ctx.channel.id, { content: "Checking for new regional quests with warmed proxies…" });

                try {
                    const before = new Set((await getStoredDiscoveredRegionRestrictions()).map(quest => quest.id));
                    const discovered = await discoverQuestRegionsViaProxies(true);
                    const afterCards = await getQuestRegions(true);
                    const after = new Set(discovered.map(quest => quest.id));
                    const newQuestIds = Array.from(after).filter(id => !before.has(id));

                    if (newQuestIds.length === 0) {
                        sendBotMessage(ctx.channel.id, { content: "No new active claimable regional quests were found." });
                        return;
                    }

                    const entries = getQuestRegionCommandEntries(afterCards).filter(entry => newQuestIds.includes(entry.id));
                    const lines = entries.length > 0
                        ? entries.map(entry => {
                            const regionText = entry.regions.map(r => `${r.emoji} ${r.name}`).join(", ");
                            return `- ${regionText}: ${formatQuestLink(entry.id, true)}`;
                        })
                        : newQuestIds.map(id => `- ${formatQuestLink(id, true)}`);

                    sendBotMessageChunks(ctx.channel.id, `**New regional quests found:**\n${lines.join("\n")}`);
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    console.debug("[QuestRegions] /check-new-region-quests error:", msg);
                    sendBotMessage(ctx.channel.id, { content: `Failed: ${msg}` });
                }
            },
        },
        {
            name: "start-region-quest",
            description: "Start a specific region quest via a country-matched proxy",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "quest_id",
                    description: "The quest ID to start",
                    type: ApplicationCommandOptionType.STRING,
                    required: true,
                },
                {
                    name: "country",
                    description: "Override the country code (auto-detected from quest data if not provided)",
                    type: ApplicationCommandOptionType.STRING,
                    required: false,
                },
            ],
            execute: async (opts, ctx) => {
                const questId = findOption<string>(opts, "quest_id", "").trim();
                const countryOverride = findOption<string>(opts, "country", "").trim().toUpperCase() || null;

                if (!questId) {
                    sendBotMessage(ctx.channel.id, { content: "Please provide a quest ID." });
                    return;
                }

                console.debug(`[QuestRegions] /start-region-quest: questId=${questId} countryOverride=${countryOverride ?? "auto"}`);

                // Load region data if not yet loaded
                await getQuestRegions(false).catch(() => null);
                await fetchSupplementalQuestMessages().catch(() => null);

                const countries = countryOverride ? [countryOverride] : getCountriesForQuest(questId);
                if (countries.length === 0) {
                    sendBotMessage(ctx.channel.id, { content: `Could not determine region for quest \`${questId}\`. Use the \`country\` option to specify one manually.` });
                    return;
                }

                const regionLabel = countries.map(country => `${getRegionEmoji(country)} **${getRegionName(country)}** (\`${country}\`)`).join(", ");
                sendBotMessage(ctx.channel.id, { content: `Starting quest \`${questId}\` via ${regionLabel} proxy…` });

                try {
                    const msg = await startQuestViaCandidateCountries(
                        questId,
                        countries,
                        progress => sendBotMessage(ctx.channel.id, { content: progress }),
                    );
                    sendBotMessage(ctx.channel.id, { content: msg });
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    console.debug("[QuestRegions] /start-region-quest error:", msg);
                    sendBotMessage(ctx.channel.id, { content: `Failed: ${msg}` });
                }
            },
        },
        {
            name: "auto-start-region-quests",
            description: "Enroll all active region quests via country-matched proxies",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: async (_, ctx) => {
                sendBotMessage(ctx.channel.id, { content: "Loading region quest data…" });

                try {
                    const [regionCards] = await Promise.all([
                        getQuestRegions(true),
                        fetchSupplementalQuestMessages().catch(() => null),
                    ]);

                    const questCountryMap = new Map<string, string[]>();

                    for (const card of regionCards) {
                        for (const quest of card.quests) {
                            const countries = questCountryMap.get(quest.id) ?? [];
                            if (!countries.includes(card.code)) countries.push(card.code);
                            questCountryMap.set(quest.id, countries);
                        }
                    }
                    for (const [questId, regions] of supplementalQuestRegions) {
                        const countries = questCountryMap.get(questId) ?? [];
                        for (const region of regions.values()) {
                            if (!countries.includes(region.code)) countries.push(region.code);
                        }
                        if (countries.length > 0) questCountryMap.set(questId, countries);
                    }

                    if (questCountryMap.size === 0) {
                        sendBotMessage(ctx.channel.id, { content: "No active region-restricted quests found." });
                        return;
                    }

                    const entries = Array.from(questCountryMap.entries());
                    const countryCount = new Set(entries.flatMap(([, countryCodes]) => countryCodes)).size;
                    sendBotMessage(ctx.channel.id, {
                        content: `Found **${entries.length}** quest(s) across **${countryCount}** countries. Starting JIT enroll with randomized delays… Check DevTools console.`,
                    });

                    const results: string[] = [];

                    for (let i = 0; i < entries.length; i++) {
                        const [questId, countryCodes] = entries[i];
                        const regionLabel = countryCodes.map(country => `${getRegionEmoji(country)} **${getRegionName(country)}** (\`${country}\`)`).join(", ");

                        if (i > 0) {
                            const delayMs = getRandomAutoStartDelayMs();
                            console.debug(`[QuestRegions] auto-start: waiting ${delayMs}ms before quest=${questId}`);
                            await new Promise<void>(res => setTimeout(res, delayMs));
                        }

                        sendBotMessage(ctx.channel.id, {
                            content: `🔎 [${i + 1}/${entries.length}] JIT enrolling \`${questId}\` for ${regionLabel}…`,
                        });

                        try {
                            const fastestCountry = getFastestWarmedCountry(countryCodes);
                            const candidateCountries = fastestCountry ? [fastestCountry] : countryCodes;
                            console.debug(`[QuestRegions] auto-start: quest=${questId} countries=${countryCodes.join(",")} candidates=${candidateCountries.join(",")}`);
                            const msg = await startQuestViaCandidateCountries(
                                questId,
                                candidateCountries,
                                progress => sendBotMessage(ctx.channel.id, { content: progress }),
                            );
                            results.push(msg);
                            sendBotMessage(ctx.channel.id, { content: `[${i + 1}/${entries.length}] ${msg}` });
                        } catch (err) {
                            const msg = err instanceof Error ? err.message : String(err);
                            console.debug(`[QuestRegions] auto-start: FAILED quest=${questId}:`, msg);
                            const result = `❌ \`${questId}\` — ${regionLabel}: ${msg}`;
                            results.push(result);
                            sendBotMessage(ctx.channel.id, { content: `[${i + 1}/${entries.length}] ${result}` });
                        }
                    }

                    sendBotMessageChunks(ctx.channel.id, `**Auto-start results:**\n${results.join("\n")}`);
                } catch (err) {
                    sendBotMessage(ctx.channel.id, {
                        content: `Failed to run auto-start: ${err instanceof Error ? err.message : String(err)}`,
                    });
                }
            },
        },
        {
            name: "claim-region-quest",
            description: "Fetch region quests via a country proxy, enroll and claim the first unclaimed one",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "region",
                    description: "Region code or name (e.g. CH, Switzerland)",
                    type: ApplicationCommandOptionType.STRING,
                    required: true,
                },
            ],
            execute: async (opts, ctx) => {
                const regionInput = findOption<string>(opts, "region", "").trim();
                if (!regionInput) {
                    sendBotMessage(ctx.channel.id, { content: "Please provide a region code or name." });
                    return;
                }

                const matchedCode = REGION_CODES_BY_NAME.get(regionInput.toLowerCase()) ?? normalizeRegion(regionInput);
                const regionLabel = `${getRegionEmoji(matchedCode)} **${getRegionName(matchedCode)}**`;

                console.debug(`[QuestRegions] /claim-region-quest: input="${regionInput}" code=${matchedCode}`);
                sendBotMessage(ctx.channel.id, { content: `Loading region data for ${regionLabel}…` });

                try {
                    const [regionCards] = await Promise.all([
                        getQuestRegions(true),
                        fetchSupplementalQuestMessages().catch(() => null),
                    ]);

                    const regionQuestIds = new Set<string>();
                    for (const card of regionCards) {
                        if (card.code !== matchedCode) continue;
                        for (const q of card.quests) regionQuestIds.add(q.id);
                    }
                    for (const [questId, supplementalRegions] of supplementalQuestRegions) {
                        if (supplementalRegions.has(matchedCode)) regionQuestIds.add(questId);
                    }

                    console.debug(`[QuestRegions] /claim-region-quest: ${regionQuestIds.size} quest IDs for ${matchedCode}:`, Array.from(regionQuestIds));

                    if (regionQuestIds.size === 0) {
                        sendBotMessage(ctx.channel.id, { content: `No known quests for ${regionLabel}.` });
                        return;
                    }

                    sendBotMessage(ctx.channel.id, { content: `Fetching quests via ${regionLabel} proxy…` });

                    // Fetch quests via a country-matched proxy
                    const [proxyQuests, proxy] = await fetchQuestsViaProxyForCountry(matchedCode);
                    console.debug(`[QuestRegions] /claim-region-quest: got ${proxyQuests.length} quests via ${proxy.raw}`);
                    console.debug("[QuestRegions] /claim-region-quest: proxy quest IDs:", proxyQuests.map(q => getQuestId(q)));

                    const target = proxyQuests.find(q => {
                        const id = getQuestId(q);
                        if (!id || !regionQuestIds.has(id)) return false;
                        if (getStringProperty(getObjectProperty(q, "userStatus", "user_status"), "claimedAt", "claimed_at")) return false;
                        const expiresAt = getQuestExpiresAt(q);
                        if (expiresAt && expiresAt <= new Date()) return false;
                        return true;
                    });

                    if (!target) {
                        const proxyQuestIds = proxyQuests.map(q => getQuestId(q)).filter(Boolean);
                        console.debug("[QuestRegions] /claim-region-quest: no match. Proxy IDs:", proxyQuestIds, "expected:", Array.from(regionQuestIds));
                        sendBotMessage(ctx.channel.id, {
                            content: [
                                `No unclaimed quests found for ${regionLabel} via proxy \`${proxy.raw}\`.`,
                                `Proxy returned ${proxyQuests.length} quest(s): ${proxyQuestIds.slice(0, 5).join(", ")}${proxyQuestIds.length > 5 ? "…" : ""}`,
                                `Expected quest IDs: ${Array.from(regionQuestIds).slice(0, 5).join(", ")}`,
                            ].join("\n"),
                        });
                        return;
                    }

                    const questId = getQuestId(target)!;
                    console.debug(`[QuestRegions] /claim-region-quest: target=${questId}, enrolling then claiming`);
                    sendBotMessage(ctx.channel.id, { content: `Found quest \`${questId}\` — enrolling via \`${proxy.raw}\`…` });

                    await enrollQuestViaProxy(questId, proxy);
                    console.debug(`[QuestRegions] /claim-region-quest: enrolled ${questId}`);

                    sendBotMessage(ctx.channel.id, { content: `Enrolled! Claiming reward for quest \`${questId}\`…` });

                    await claimQuestRewardViaProxy(questId, proxy);
                    console.debug(`[QuestRegions] /claim-region-quest: claimed ${questId}`);

                    sendBotMessage(ctx.channel.id, {
                        content: `✅ Enrolled and claimed quest \`${questId}\` for ${regionLabel} via \`${proxy.raw}\`.`,
                    });
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    console.debug("[QuestRegions] /claim-region-quest error:", msg);
                    sendBotMessage(ctx.channel.id, { content: `Failed: ${msg}` });
                }
            },
        },
    ],

    settingsAboutComponent: () => <QuestRegionsAbout />,

    flux: {
        MESSAGE_CREATE({ message, channelId, guildId }: MessageCreatePayload) {
            if (guildId !== QUEST_DATA_GUILD_ID || channelId !== QUEST_DATA_CHANNEL_ID) return;
            cacheSupplementalMessage(message);
        },
        MESSAGE_UPDATE({ message, channelId, guildId }: MessageUpdatePayload) {
            if (guildId !== QUEST_DATA_GUILD_ID || channelId !== QUEST_DATA_CHANNEL_ID) return;
            cacheSupplementalMessage(message);
        },
    },

    patches: [
        {
            find: /questContentPosition:\i,trackGuildAndChannelMetadata:\i===\i\.\i\.QUESTS_EMBED,sourceQuestContent:\i,children:\i=>/,
            replacement: {
                match: /(children:\[)(\(0,(\i)\.jsx\)\(\i,\{quest:(\i),location:\i,isInteracting:\i,sourceQuestContent:\i\}\),)/,
                replace: "$1(0,$3.jsx)($self.QuestRegionInfo,{quest:$4}),$2",
            },
        },
        {
            find: "onReceiveErrorHints:",
            replacement: {
                match: /(onBlur:\i,children:\[)(?=\(0,(\i)\.jsx\))/,
                replace: "$1(0,$2.jsx)($self.QuestRegionInfo,{quest:arguments[0].quest}),",
            },
        },
    ],

    QuestRegionInfo,
});
