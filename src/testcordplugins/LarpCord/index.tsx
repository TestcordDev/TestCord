/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { ProfileBadge } from "@api/Badges";
import { addContextMenuPatch, NavContextMenuPatchCallback, removeContextMenuPatch } from "@api/ContextMenu";
import { HeaderBarButton } from "@api/HeaderBar";
import { DataStore } from "@api/index";
import { definePluginSettings, Settings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { fetchUserProfile } from "@utils/discord";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import type { ProfileEffect } from "@vencord/discord-types";
import { AuthenticationStore, Button, FluxDispatcher, IconUtils, Menu, OAuth2AuthorizeModal, React, Select, SettingsRouter, SnowflakeUtils, Toasts, UserStore } from "@webpack/common";

const LarpSettings = Settings as typeof Settings & {
    seeAllCustomProfile?: boolean;
    syncOwnCustomProfile?: boolean;
};

const ICON_SETTING_KEYS: Array<"showIcon"> = ["showIcon"];

const settings = definePluginSettings({
    showIcon: {
        type: OptionType.BOOLEAN,
        description: "Show the LarpCord icon in the header bar.",
        default: true
    }
});

const LarpModalRoot = ModalRoot as React.ComponentType<any>;
const LarpModalHeader = ModalHeader as React.ComponentType<any>;
const LarpModalContent = ModalContent as React.ComponentType<any>;
const LarpModalFooter = ModalFooter as React.ComponentType<any>;
const LarpModalCloseButton = ModalCloseButton as React.ComponentType<any>;

function t(value: string) {
    return value;
}

const DS_KEY = "customProfile_data";
const DS_ENABLED = "customProfile_enabled";

const FLAG = {
    STAFF: 1,
    PARTNER: 2,
    HYPESQUAD: 4,
    BUG_HUNTER_1: 8,
    BRAVERY: 64,
    BRILLIANCE: 128,
    BALANCE: 256,
    EARLY_SUPPORTER: 512,
    BUG_HUNTER_2: 16384,
    DEV_VERIFIED: 131072,
    MOD_ALUMNI: 262144,
    ACTIVE_DEVELOPER: 4194304,
};

const BADGES = [
    { label: t("Staff Discord"), flag: FLAG.STAFF, icon: "https://cdn.discordapp.com/badge-icons/5e74e9b61934fc1f67c65515d1f7e60d.png" },
    { label: t("Partner"), flag: FLAG.PARTNER, icon: "https://cdn.discordapp.com/badge-icons/3f9748e53446a137a052f3454e2de41e.png" },
    { label: t("HypeSquad Events"), flag: FLAG.HYPESQUAD, icon: "https://cdn.discordapp.com/badge-icons/bf01d1073931f921909045f3a39fd264.png" },
    { label: t("Bug Hunter Lvl 1"), flag: FLAG.BUG_HUNTER_1, icon: "https://cdn.discordapp.com/badge-icons/2717692c7dca7289b35297368a940dd0.png" },
    { label: t("HypeSquad Bravery"), flag: FLAG.BRAVERY, icon: "https://cdn.discordapp.com/badge-icons/8a88d63823d8a71cd5e390baa45efa02.png" },
    { label: t("HypeSquad Brilliance"), flag: FLAG.BRILLIANCE, icon: "https://cdn.discordapp.com/badge-icons/011940fd013da3f7fb926e4a1cd2e618.png" },
    { label: t("HypeSquad Balance"), flag: FLAG.BALANCE, icon: "https://cdn.discordapp.com/badge-icons/3aa41de486fa12454c3761e8e223442e.png" },
    { label: t("Early Supporter"), flag: FLAG.EARLY_SUPPORTER, icon: "https://cdn.discordapp.com/badge-icons/7060786766c9c840eb3019e725d2b358.png" },
    { label: t("Former Moderator"), flag: FLAG.MOD_ALUMNI, icon: "https://cdn.discordapp.com/badge-icons/fee1624003e2fee35cb398e125dc479b.png" },
    { label: t("Bug Hunter Lvl 2"), flag: FLAG.BUG_HUNTER_2, icon: "https://cdn.discordapp.com/badge-icons/848f79194d4be5ff5f81505cbd0ce1e6.png" },
    { label: t("Verified Developer"), flag: FLAG.DEV_VERIFIED, icon: "https://cdn.discordapp.com/badge-icons/6df5892e0f35b051f8b61eace34f4967.png" },
    { label: t("Active Developer"), flag: FLAG.ACTIVE_DEVELOPER, icon: "https://cdn.discordapp.com/badge-icons/6bdc42827a38498929a4920da12695d9.png" },
];

const OLD_NAME_BADGE_ICON = "https://cdn.discordapp.com/badge-icons/6de6d34650760ba5551a79732e98ed60.png";

const NITRO_LEVELS = [
    { label: t("Nitro (0 months)"), icon: "https://cdn.discordapp.com/badge-icons/2ba85e8026a8614b640c2837bcdfe21b.png" },
    { label: t("Bronze (1 month)"), icon: "https://cdn.discordapp.com/badge-icons/4f33c4a9c64ce221936bd256c356f91f.png" },
    { label: t("Silver (2 months)"), icon: "https://cdn.discordapp.com/badge-icons/4514fab914bdbfb4ad2fa23df76121a6.png" },
    { label: t("Gold (3 months)"), icon: "https://cdn.discordapp.com/badge-icons/2895086c18d5531d499862e41d1155a6.png" },
    { label: t("Platinum (6 months)"), icon: "https://cdn.discordapp.com/badge-icons/0334688279c8359120922938dcb1d6f8.png" },
    { label: t("Diamond (12 months)"), icon: "https://cdn.discordapp.com/badge-icons/0d61871f72bb9a33a7ae568c1fb4f20a.png" },
    { label: t("Emerald (24 months)"), icon: "https://cdn.discordapp.com/badge-icons/11e2d339068b55d3a506cff34d3780f3.png" },
    { label: t("Ruby (36 months)"), icon: "https://cdn.discordapp.com/badge-icons/cd5e2cfd9d7f27a8cdcd3e8a8d5dc9f4.png" },
    { label: t("Opal (72 months)"), icon: "https://cdn.discordapp.com/badge-icons/5b154df19c53dce2af92c9b61e6be5e2.png" },
];

const BOOST_LABELS_RAW = [
    "1 Month", "2 Months", "3 Months", "6 Months",
    "9 Months", "12 Months", "15 Months", "18 Months", "24 Months"
];
const BOOST_LABELS = BOOST_LABELS_RAW.map(l => t(l));
const BOOST_MONTHS = [1, 2, 3, 6, 9, 12, 15, 18, 24];
const BOOST_ICONS = [
    "https://cdn.discordapp.com/badge-icons/51040c70d4f20a921ad6674ff86fc95c.png",
    "https://cdn.discordapp.com/badge-icons/0e4080d1d333bc7ad29ef6528b6f2fb7.png",
    "https://cdn.discordapp.com/badge-icons/72bed924410c304dbe3d00a6e593ff59.png",
    "https://cdn.discordapp.com/badge-icons/df199d2050d3ed4ebf84d64ae83989f8.png",
    "https://cdn.discordapp.com/badge-icons/996b3e870e8a22ce519b3a50e6bdd52f.png",
    "https://cdn.discordapp.com/badge-icons/991c9f39ee33d7537d9f408c3e53141e.png",
    "https://cdn.discordapp.com/badge-icons/cb3ae83c15e970e8f3d410bc62cb8b99.png",
    "https://cdn.discordapp.com/badge-icons/7142225d31238f6387d9f09efaa02759.png",
    "https://cdn.discordapp.com/badge-icons/ec92202290b48d0879b7413d2dde3bab.png",
];

const AVATAR_DECORATIONS = [
    { id: "1144307957425778779", label: "Hearts" },
    { id: "1144308196723408958", label: "Hearts Animated" },
    { id: "1212569433839636530", label: "Lofi Cafe" },
    { id: "1481387347642810480", label: "Winter" },
    { id: "1343751617362661526", label: "Magic Orb" },
    { id: "1373015260465987705", label: "Dragon" },
    { id: "1333866045303423026", label: "Ghost" },
    { id: "1144308439720394944", label: "Sakura Drift" },
    { id: "1432550258126229565", label: "Neon" },
    { id: "1462116613632426014", label: "Cyber City" },
    { id: "1462116613682757888", label: "Retro" },
    { id: "1144307629225672846", label: "Fire" },
    { id: "1341506443718688768", label: "Void" },
    { id: "1447654090640330763", label: "Celestial" },
    { id: "1483857762890022923", label: "Snowy" },
    { id: "1479561706672885811", label: "Ice" },
    { id: "1212569856189407352", label: "Cozy" },
    { id: "1485784028710830242", label: "New Year" },
    { id: "1341506444150702080", label: "Abyss" },
    { id: "1232071712695386162", label: "Spring" },
    { id: "1220514048068812901", label: "Summer" },
    { id: "1427463138634109026", label: "Autumn" },
    { id: "1341506443865489408", label: "Darkness" },
];

function getString(value: unknown) {
    return typeof value === "string" ? value : "";
}

function getDecorationData(value: unknown) {
    if (typeof value === "string") return makeDecorationData(value);
    if (!value || typeof value !== "object") return null;

    const data = value as Record<string, unknown>;
    const asset = getString(data.asset);
    if (!asset) return null;

    return {
        asset,
        skuId: getString(data.skuId) || getString(data.sku_id) || asset
    };
}

function makeDecorationData(asset: string, skuId?: string) {
    return { asset, skuId: skuId || asset };
}

function getStoredDecorationData(data: CustomProfileData) {
    const asset = getString(data.decorationAsset);
    return asset ? makeDecorationData(asset, getString(data.decorationSkuId)) : null;
}

function getDecorationUrl(assetId: string | undefined, animated = false): string {
    if (!assetId) return "";
    if (!/^\d+$/.test(assetId)) return `https://cdn.discordapp.com/avatar-decoration-presets/${assetId}.png?size=240&passthrough=${animated}`;

    return `https://cdn.discordapp.com/media/v1/collectibles-shop/${assetId}/${animated ? "animated" : "static"}`;
}

function cloneProfileEffect(effect: ProfileEffect | null | undefined): ProfileEffect | null {
    if (!effect?.skuId) return null;

    const effectItems = Array.isArray(effect.effects)
        ? effect.effects
            .map((item: any) => ({ ...item, src: getString(item?.src) }))
            .filter((item: any) => item.src)
        : [];
    const reducedMotionSrc = getString(effect.reducedMotionSrc);
    const thumbnailPreviewSrc = getString(effect.thumbnailPreviewSrc);
    const staticFrameSrc = getString(effect.staticFrameSrc);
    if (!effectItems.length && !reducedMotionSrc && !thumbnailPreviewSrc && !staticFrameSrc) return null;

    return {
        skuId: String(effect.skuId),
        title: effect.title,
        description: effect.description,
        accessibilityLabel: effect.accessibilityLabel,
        reducedMotionSrc,
        thumbnailPreviewSrc,
        effects: effectItems,
        animationType: effect.animationType,
        staticFrameSrc,
        type: effect.type || 1
    };
}

function cloneProfileBadges(badges: unknown) {
    if (!Array.isArray(badges)) return [];

    return badges
        .map((badge: any, i) => ({ ...badge, id: getString(badge?.id) || `larpcord-profile-badge-${i}`, icon: getString(badge?.icon) }))
        .filter((badge: any) => badge.icon);
}

function withBadgeIds(badges: ProfileBadge[]) {
    return badges.map((badge, i) => {
        const iconName = getString(badge.iconSrc).split("/").pop()?.replace(".png", "") || "badge";
        return { ...badge, id: badge.id || `larpcord-badge-${i}-${iconName}` };
    });
}

function mergeProfile(profile: any, merged: any) {
    try {
        const clone = Object.create(Object.getPrototypeOf(profile));
        const mergedKeys = new Set(Reflect.ownKeys(merged));

        for (const key of Reflect.ownKeys(profile)) {
            if (mergedKeys.has(key)) continue;
            const desc = Object.getOwnPropertyDescriptor(profile, key);
            if (desc) Object.defineProperty(clone, key, desc);
        }

        for (const key of mergedKeys) {
            const desc = Object.getOwnPropertyDescriptor(merged, key);
            if (desc) Object.defineProperty(clone, key, desc);
        }

        return clone;
    } catch {
        const clone = Object.create(profile);
        Object.assign(clone, merged);
        return clone;
    }
}

function addProfileEffect(effects: Map<string, ProfileEffect>, effect: ProfileEffect | null | undefined) {
    const cloned = cloneProfileEffect(effect);
    if (cloned) effects.set(cloned.skuId, cloned);
}

function getProfileEffects(selected: ProfileEffect | null | undefined) {
    const effects = new Map<string, ProfileEffect>();
    addProfileEffect(effects, selected);

    for (const data of Object.values(allAccountsData)) {
        addProfileEffect(effects, data.profileEffect);
    }

    try {
        const userId = AuthenticationStore?.getId?.();
        const UserProfileStore = (Vencord as any).Webpack?.findByProps?.("getUserProfile", "getGuildMemberProfile");
        const profile = userId ? UserProfileStore?.getUserProfile?.(userId) : null;

        addProfileEffect(effects, profile?.profileEffect);

        if (Array.isArray(profile?.collectibles)) {
            for (const effect of profile.collectibles) {
                addProfileEffect(effects, effect);
            }
        }
    } catch { }

    return [...effects.values()];
}

function getProfileEffectPreview(effect: ProfileEffect) {
    return effect.thumbnailPreviewSrc || effect.staticFrameSrc || effect.reducedMotionSrc || "";
}

function showLarpCordToast(message: string) {
    Toasts.show({ message, type: Toasts.Type.SUCCESS, id: Toasts.genId() });
}

interface CustomProfileData {
    username?: string;
    globalName?: string;
    avatar?: string;
    banner?: string;
    bio?: string;
    accentColor?: number;
    accentColor2?: number;
    pronouns?: string;
    badgeFlags?: number;
    createdAt?: string;
    nitro?: boolean;
    nitroLevel?: number;
    boostMonths?: number;
    email?: string;
    phone?: string;
    customBadgeIds?: string[];
    oldName?: string;
    decorationAsset?: string;
    decorationSkuId?: string;
    profileEffect?: ProfileEffect | null;
    copiedUserId?: string;
}

async function getPublicPluginConfig(_plugin: string, _userId: string): Promise<{ settings?: CustomProfileData; } | null> {
    return null;
}

async function saveOwnPluginConfig(_plugin: string, _token: string, _data: CustomProfileData | { private: boolean; }) {
    return null;
}

async function getStoredToken(): Promise<string | null> {
    return null;
}

async function storeToken(_token: string) {
    return null;
}

async function beginDiscordOAuth(): Promise<{ url: string; scopes: string[]; redirectUri: string; }> {
    throw new Error("LarpCord sync is unavailable.");
}

const LS_KEY_DATA = "LarpCord_data";
const LS_KEY_ENABLED = "LarpCord_enabled";
const DS_ALL_DATA = "customProfile_allData";
const DS_ALL_ENABLED = "customProfile_allEnabled";
const LS_ALL_DATA = "LarpCord_allData";
const LS_ALL_ENABLED = "LarpCord_allEnabled";
const LEGACY_LS_PREFIX = "Night" + "cordCP";
const LEGACY_LS_KEY_DATA = `${LEGACY_LS_PREFIX}_data`;
const LEGACY_LS_KEY_ENABLED = `${LEGACY_LS_PREFIX}_enabled`;
const LEGACY_LS_ALL_DATA = `${LEGACY_LS_PREFIX}_allData`;
const LEGACY_LS_ALL_ENABLED = `${LEGACY_LS_PREFIX}_allEnabled`;

let storedData: CustomProfileData = {};
let isEnabled = false;
let domObserver: MutationObserver | null = null;

const publicProfilesCache = new Map<string, { fetched: boolean, data: CustomProfileData | null, timestamp: number; }>();
const PUBLIC_CACHE_TTL = 1000 * 30;

let _lastSeeAll = false;
function checkSeeAllSettingChange() {
    const current = !!LarpSettings.seeAllCustomProfile;
    if (_lastSeeAll && !current) {
        publicProfilesCache.clear();
    }
    _lastSeeAll = current;
}

async function fetchPublicProfileIfNeeded(userId: string) {
    checkSeeAllSettingChange();
    if (!LarpSettings.seeAllCustomProfile) return;
    const existing = publicProfilesCache.get(userId);
    if (existing?.fetched && (Date.now() - existing.timestamp) < PUBLIC_CACHE_TTL) return;

    publicProfilesCache.set(userId, { fetched: false, data: null, timestamp: 0 });

    const result = await getPublicPluginConfig("customProfile", userId);
    publicProfilesCache.set(userId, { fetched: true, data: result?.settings || null, timestamp: Date.now() });

    try {
        const UPS = (Vencord as any).Webpack?.findByProps?.("getUserProfile", "getGuildMemberProfile");
        if (UPS && UPS.emitChange) UPS.emitChange();

        const US = (Vencord as any).Webpack?.findByStoreName("UserStore");
        if (US && US.emitChange) US.emitChange();
    } catch { }
}

let cachedOriginalUser: any = null;
let cachedFakeUser: any = null;
let cachedDataHash: number = 0;
let _trueOriginalUser: any = null;
let _dataVersion: number = 0;
let allAccountsData: Record<string, CustomProfileData> = {};
let allAccountsEnabled: Record<string, boolean> = {};

function saveDataSync(data: CustomProfileData, enabled: boolean) {
    try {
        localStorage.setItem(LS_KEY_DATA, JSON.stringify(data));
        localStorage.setItem(LS_KEY_ENABLED, enabled ? "1" : "0");
    } catch { }
}

function saveAllDataSync() {
    try {
        localStorage.setItem(LS_ALL_DATA, JSON.stringify(allAccountsData));
        localStorage.setItem(LS_ALL_ENABLED, JSON.stringify(allAccountsEnabled));
    } catch { }
}

function getStoredValue(key: string, legacyKey: string) {
    const value = localStorage.getItem(key);
    if (value !== null) return value;

    const legacyValue = localStorage.getItem(legacyKey);
    if (legacyValue !== null) localStorage.setItem(key, legacyValue);
    return legacyValue;
}

function syncCurrentUserData() {
    const myId = _cachedMyId || AuthenticationStore?.getId?.();
    if (myId) {
        _cachedMyId = myId;
        storedData = allAccountsData[myId] || {};
        isEnabled = allAccountsEnabled[myId] || false;
    }
}

function loadDataSync() {
    try {
        const rawAll = getStoredValue(LS_ALL_DATA, LEGACY_LS_ALL_DATA);
        if (rawAll) {
            try { allAccountsData = JSON.parse(rawAll); } catch { allAccountsData = {}; }
            const rawEnabled = getStoredValue(LS_ALL_ENABLED, LEGACY_LS_ALL_ENABLED);
            try { allAccountsEnabled = rawEnabled ? JSON.parse(rawEnabled) : {}; } catch { allAccountsEnabled = {}; }
            syncCurrentUserData();
            if (!storedData || Object.keys(storedData).length === 0) {
                const rawOld = getStoredValue(LS_KEY_DATA, LEGACY_LS_KEY_DATA);
                const enOld = getStoredValue(LS_KEY_ENABLED, LEGACY_LS_KEY_ENABLED);
                if (rawOld) {
                    try { storedData = JSON.parse(rawOld); } catch { storedData = {}; }
                    isEnabled = enOld === "1";
                }
            }
            return;
        }
        const raw = getStoredValue(LS_KEY_DATA, LEGACY_LS_KEY_DATA);
        const en = getStoredValue(LS_KEY_ENABLED, LEGACY_LS_KEY_ENABLED);
        if (raw) {
            try { storedData = JSON.parse(raw); } catch { storedData = {}; }
        } else { storedData = {}; }
        isEnabled = en === "1";
    } catch {
        storedData = {};
        isEnabled = false;
    }
}

function onAccountSwitch() {
    updateCachedRealData();
    syncCurrentUserData();
    cachedFakeUser = null;
    cachedOriginalUser = null;
    _trueOriginalUser = null;
    _dataVersion++;
    _realUsername = "";
    _realGlobalName = "";
    if (isEnabled) startDomObserver();
    else stopDomObserver();
    forceAccountPanelRerender();
}

loadDataSync();

const HIDE_STYLE_ID = "cp-hide-during-load";
function injectHideStyle() {
    if (!isEnabled) return;
    if (document.getElementById(HIDE_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = HIDE_STYLE_ID;
    style.textContent = `
        [class*='nameTag'] [class*='username'],
        [class*='nameTag'] [class*='discriminator'],
        [class*='nameTag'] [class*='panelSubtitle']
        { color: transparent !important; }
        [class*='accountProfilePopout'] [class*='avatarWrap'] img,
        [class*='accountProfilePopout'] [class*='avatarWrap'] svg
        { opacity: 0 !important; }
    `;
    const inject = () => {
        if (!document.head) { requestAnimationFrame(inject); return; }
        document.head.appendChild(style);
    };
    inject();
}
function removeHideStyle() {
    document.getElementById(HIDE_STYLE_ID)?.remove();
}
if (isEnabled) injectHideStyle();

let _avatarPatchApplied = false;
let _avatarPatchOrig: any = null;
function applyAvatarPatchEarly() {
    if (_avatarPatchApplied) return;
    try {
        const IU = (window as any).Vencord?.Webpack?.findByProps?.("getUserAvatarURL", "getDefaultAvatarURL")
            ?? (window as any).Vencord?.Webpack?.findByProps?.("getUserAvatarURL")
            ?? IconUtils;
        if (!IU?.getUserAvatarURL) return;
        _avatarPatchOrig = IU.getUserAvatarURL;
        const orig = _avatarPatchOrig;
        IU.getUserAvatarURL = function (user: any, ...args: any[]) {
            if (!user) return orig(user, ...args);
            const uid = user.id ?? user.userId;
            if (!uid) return orig(user, ...args);
            if (isEnabled && storedData.avatar && isMe(uid)) {
                return storedData.avatar;
            }
            checkSeeAllSettingChange();
            if (LarpSettings.seeAllCustomProfile && !isMe(uid)) {
                const cached = publicProfilesCache.get(uid);
                if (cached?.fetched && cached.data?.avatar) {
                    return cached.data.avatar;
                }
                fetchPublicProfileIfNeeded(uid);
            }
            return orig(user, ...args);
        };
        _avatarPatchApplied = true;
    } catch { }
}

async function loadData() {
    try {
        const allData = await DataStore.get(DS_ALL_DATA) as Record<string, CustomProfileData> | null;
        const allEnabled = await DataStore.get(DS_ALL_ENABLED) as Record<string, boolean> | null;
        if (allData && typeof allData === "object" && Object.keys(allData).length > 0) {
            allAccountsData = allData;
            allAccountsEnabled = allEnabled || {};
            syncCurrentUserData();
            saveAllDataSync();
            saveDataSync(storedData, isEnabled);
            return;
        }
        const d = await DataStore.get(DS_KEY) as CustomProfileData | null;
        const e = await DataStore.get(DS_ENABLED) as boolean | null;
        if (d !== null) storedData = d;
        if (e !== null) isEnabled = e === true;
        const myId = AuthenticationStore?.getId?.();
        if (myId && storedData && Object.keys(storedData).length > 0) {
            allAccountsData[myId] = storedData;
            allAccountsEnabled[myId] = isEnabled;
            DataStore.set(DS_ALL_DATA, allAccountsData).catch(() => { });
            DataStore.set(DS_ALL_ENABLED, allAccountsEnabled).catch(() => { });
            saveAllDataSync();
        }
        saveDataSync(storedData, isEnabled);
    } catch (err) { }
}

async function copyUserProfile(userId: string, menuUser?: unknown) {
    try {
        const user = (UserStore.getUser(userId) as any) ?? menuUser;
        if (!user) return;

        const { findByProps } = await import("@webpack") as any;
        const UserProfileStore = findByProps("getUserProfile", "getGuildMemberProfile") as any;
        const IU = IconUtils as any;
        const getProfile = UserProfileStore?._cp_orig_getUserProfile ?? UserProfileStore?.getUserProfile;
        const cachedProfile = getProfile?.call(UserProfileStore, userId);
        const fetchedProfile = await fetchUserProfile(userId, undefined, false).catch(() => null);
        const profile = getProfile?.call(UserProfileStore, userId) ?? fetchedProfile ?? cachedProfile ?? {};
        const sourceUser = (UserStore.getUser(userId) as any) ?? user;

        const newData: CustomProfileData = {
            username: getString(sourceUser.username ?? user.username),
            globalName: getString(sourceUser.globalName ?? sourceUser.global_name ?? sourceUser.displayName ?? user.globalName ?? user.global_name ?? user.displayName),
            pronouns: "",
            bio: "",
            accentColor: undefined,
            accentColor2: undefined,
            banner: "",
            avatar: "",
            badgeFlags: 0,
            customBadgeIds: [],
            nitro: false,
            nitroLevel: -1,
            boostMonths: -1,
            decorationAsset: undefined,
            decorationSkuId: undefined,
            profileEffect: null,
            createdAt: undefined,
            copiedUserId: userId
        };

        if (sourceUser.bio !== undefined) newData.bio = sourceUser.bio || "";
        if (profile.bio !== undefined) newData.bio = profile.bio || "";
        if (profile.pronouns !== undefined) newData.pronouns = profile.pronouns || "";

        try {
            const userAvatar = getString(sourceUser.avatar);
            const avatarUrl = IU?.getUserAvatarURL?.(sourceUser, false, 512)
                ?? (userAvatar ? `https://cdn.discordapp.com/avatars/${userId}/${userAvatar}.${userAvatar.startsWith("a_") ? "gif" : "png"}?size=512` : null);
            if (avatarUrl) newData.avatar = avatarUrl;
        } catch { }

        const hasNitro = (profile.premiumType ?? 0) > 0;
        newData.nitro = hasNitro;

        if (hasNitro) {
            const premiumSince = profile.premiumSince ?? sourceUser.premiumSince ?? null;
            if (premiumSince) {
                const months = Math.floor((Date.now() - new Date(premiumSince).getTime()) / (1000 * 60 * 60 * 24 * 30));
                if (months >= 72) newData.nitroLevel = 7;
                else if (months >= 36) newData.nitroLevel = 6;
                else if (months >= 24) newData.nitroLevel = 5;
                else if (months >= 12) newData.nitroLevel = 4;
                else if (months >= 6) newData.nitroLevel = 3;
                else if (months >= 3) newData.nitroLevel = 2;
                else if (months >= 2) newData.nitroLevel = 1;
                else newData.nitroLevel = 0;
            } else {
                newData.nitroLevel = 0;
            }
        }

        const boostSince = profile.premiumGuildSince ?? null;
        if (boostSince) {
            const bMonths = Math.floor((Date.now() - new Date(boostSince).getTime()) / (1000 * 60 * 60 * 24 * 30));
            if (bMonths >= 24) newData.boostMonths = 8;
            else if (bMonths >= 18) newData.boostMonths = 7;
            else if (bMonths >= 15) newData.boostMonths = 6;
            else if (bMonths >= 12) newData.boostMonths = 5;
            else if (bMonths >= 9) newData.boostMonths = 4;
            else if (bMonths >= 6) newData.boostMonths = 3;
            else if (bMonths >= 3) newData.boostMonths = 2;
            else if (bMonths >= 2) newData.boostMonths = 1;
            else newData.boostMonths = 0;
        }

        const bannerId = getString(profile.banner ?? sourceUser.banner);
        if (bannerId) newData.banner = `https://cdn.discordapp.com/banners/${userId}/${bannerId}.${bannerId.startsWith("a_") ? "gif" : "png"}?size=512`;

        if (profile.accentColor !== undefined) newData.accentColor = profile.accentColor;
        else if (sourceUser.accentColor !== undefined) newData.accentColor = sourceUser.accentColor;

        try {
            const ms = Number(BigInt(userId) >> 22n) + 1420070400000;
            newData.createdAt = new Date(ms).toISOString().slice(0, 10);
        } catch { }

        try {
            const flags = sourceUser.publicFlags ?? 0;
            let badgeFlags = 0;
            for (const { flag } of BADGES) { if (flags & flag) badgeFlags |= flag; }
            newData.badgeFlags = badgeFlags;
            const decoration = getDecorationData(sourceUser.avatarDecorationData)
                ?? getDecorationData(sourceUser.avatarDecoration)
                ?? getDecorationData(sourceUser.avatar_decoration_data)
                ?? getDecorationData(profile.avatarDecorationData)
                ?? getDecorationData(profile.avatarDecoration)
                ?? getDecorationData(profile.avatar_decoration_data)
                ?? getDecorationData(profile.user?.avatarDecorationData)
                ?? getDecorationData(profile.user?.avatarDecoration)
                ?? getDecorationData(profile.user?.avatar_decoration_data);
            if (decoration) {
                newData.decorationAsset = decoration.asset;
                newData.decorationSkuId = decoration.skuId;
            }
        } catch { }

        newData.profileEffect = cloneProfileEffect(profile.profileEffect);
        newData.copiedUserId = userId;
        const myId = AuthenticationStore?.getId?.();
        if (myId) {
            allAccountsData[myId] = newData;
            allAccountsEnabled[myId] = true;
        }
        storedData = newData;
        isEnabled = true;
        cachedFakeUser = null;
        cachedOriginalUser = null;
        _trueOriginalUser = null;
        _dataVersion++;
        saveDataSync(newData, true);
        saveAllDataSync();
        DataStore.set(DS_ALL_DATA, allAccountsData).catch(() => { });
        DataStore.set(DS_ALL_ENABLED, allAccountsEnabled).catch(() => { });

        forceAccountPanelRerender();
        showLarpCordToast("Profile imported into LarpCord.");
    } catch (err) {
        console.error("[LarpCord] copyUserProfile error:", err);
    }
}

const userContextMenuPatch: NavContextMenuPatchCallback = (children, { user }: any) => {
    if (!children || !Array.isArray(children) || !user || !user.id) return;
    try {
        const me = UserStore.getCurrentUser();
        if (!me || user.id === me.id) return;
        const isCopied = isEnabled && storedData.copiedUserId === user.id;

        children.push(
            <Menu.MenuGroup>
                {isCopied ? (
                    <Menu.MenuItem
                        id="remove-copy-profile"
                        label={t("Remove LarpCord Import")}
                        color="danger"
                        action={() => {
                            try {
                                const myId = AuthenticationStore?.getId?.();
                                if (myId) {
                                    delete allAccountsData[myId];
                                    delete allAccountsEnabled[myId];
                                }
                                storedData = {};
                                isEnabled = false;
                                saveDataSync({}, false);
                                cachedFakeUser = null;
                                cachedOriginalUser = null;
                                _trueOriginalUser = null;
                                _dataVersion++;
                                saveAllDataSync();
                                DataStore.set(DS_ALL_DATA, allAccountsData).catch(() => { });
                                DataStore.set(DS_ALL_ENABLED, allAccountsEnabled).catch(() => { });
                                forceAccountPanelRerender();
                            } catch (e) {
                                console.error("[LarpCord] Error removing copy:", e);
                            }
                        }}
                    />
                ) : (
                    <Menu.MenuItem
                        id="copy-user-profile"
                        label={t("Import Profile into LarpCord")}
                        action={() => copyUserProfile(user.id, user)}
                    />
                )}
            </Menu.MenuGroup>
        );
    } catch (err) {
        console.error("[LarpCord] Context menu patch error:", err);
    }
};

function getRealNames(): { username: string | null; globalName: string | null; } {
    try {
        const u = UserStore.getCurrentUser();
        return { username: u?.username ?? null, globalName: u?.globalName ?? null };
    } catch { return { username: null, globalName: null }; }
}

function getRealDateVariants(): string[] {
    try {
        const u = UserStore.getCurrentUser();
        if (!u?.id) return [];
        const ms = Number(BigInt(u.id) >> 22n) + 1420070400000;
        const d = new Date(ms);
        const variants = new Set<string>();
        const locales = ["en-US", "en-GB", "fr-FR", "de-DE", "it-IT", navigator.language];
        const fmtSpecs: Intl.DateTimeFormatOptions[] = [
            { day: "numeric", month: "short", year: "numeric" },
            { day: "numeric", month: "long", year: "numeric" },
            { month: "short", day: "numeric", year: "numeric" },
            { month: "long", day: "numeric", year: "numeric" },
            { day: "2-digit", month: "2-digit", year: "numeric" },
        ];
        for (const loc of locales) {
            for (const fmt of fmtSpecs) {
                try {
                    const s = new Intl.DateTimeFormat(loc, fmt).format(d);
                    variants.add(s); variants.add(s.replace(/\s/g, " ")); variants.add(s.replace(/\s/g, "\u00a0"));
                } catch { }
            }
        }
        const day = d.getDate(); const year = d.getFullYear(); const monthsShort = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const monthsLong = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        const mS = monthsShort[d.getMonth()]; const mL = monthsLong[d.getMonth()];
        const patterns = [`${day} ${mS} ${year}`, `${day} ${mL} ${year}`, `${mS} ${day}, ${year}`, `${mL} ${day}, ${year}`, d.toISOString().slice(0, 10)];
        for (const p of patterns) { variants.add(p); variants.add(p.replace(/ /g, "\u00a0")); variants.add(p.replace(/\u00a0/g, " ")); }
        variants.add(year.toString()); return [...variants].filter(v => v.length >= 4);
    } catch { return []; }
}

function getFakeDateVariants(isoDate: string): string[] {
    try {
        const d = new Date(isoDate + "T12:00:00Z");
        const variants = new Set<string>();
        const fmtSpecs: Intl.DateTimeFormatOptions[] = [
            { day: "numeric", month: "short", year: "numeric" },
            { day: "numeric", month: "long", year: "numeric" },
            { month: "short", day: "numeric", year: "numeric" },
            { month: "long", day: "numeric", year: "numeric" },
        ];
        for (const fmt of fmtSpecs) { try { variants.add(new Intl.DateTimeFormat(navigator.language, fmt).format(d)); } catch { } }
        return [...variants];
    } catch { return []; }
}

let _cachedMyId: string | null = null;
let _realUsername = "";
let _realGlobalName = "";

function updateCachedRealData() {
    try { const myId = AuthenticationStore?.getId?.(); if (myId) _cachedMyId = myId; } catch { }
}

let _domQueued = false;
let _domMutations: MutationRecord[] = [];

function scanTextNode(node: Text) {
    if (!isEnabled || !node.nodeValue) return;
    const val = (node as any).__cp_orig || node.nodeValue;
    let result = val;
    try { if (_trueOriginalUser) { _realUsername = _trueOriginalUser.username || _realUsername; _realGlobalName = _trueOriginalUser.globalName || _realGlobalName; } } catch { }
    let replaced = false;
    if (storedData.createdAt) {
        const realDates = getRealDateVariants(); const fakeDates = getFakeDateVariants(storedData.createdAt);
        if (realDates.length > 0 && fakeDates.length > 0) {
            for (let i = 0; i < realDates.length; i++) {
                const realDate = realDates[i];
                if (realDate.length >= 4 && (val.includes(realDate) || val.toLowerCase().includes(realDate.toLowerCase()))) {
                    result = result.split(realDate).join(fakeDates[0]); replaced = true;
                }
            }
        }
    }
    if (_realUsername && storedData.username && result.includes(_realUsername)) { result = result.split(_realUsername).join(storedData.username); replaced = true; }
    if (_realGlobalName && storedData.globalName && result.includes(_realGlobalName)) { result = result.split(_realGlobalName).join(storedData.globalName); replaced = true; }
    if (replaced && result !== node.nodeValue) { if ((node as any).__cp_orig === undefined) (node as any).__cp_orig = val; node.nodeValue = result; }
}

function scanNode(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) { scanTextNode(node as Text); return; }
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) scanTextNode(n as Text);
}

function processDomBatch() {
    _domQueued = false;
    if (!isEnabled) { _domMutations = []; return; }
    const batch = _domMutations; _domMutations = [];
    for (const m of batch) { if (m.type === "characterData") scanTextNode(m.target as Text); else for (const n of m.addedNodes) scanNode(n); }
}

function startDomObserver() {
    stopDomObserver(); if (!isEnabled) return;
    scanNode(document.body);
    domObserver = new MutationObserver(mutations => {
        if (!isEnabled || !mutations.length) return;
        _domMutations.push(...mutations);
        if (!_domQueued) { _domQueued = true; setTimeout(() => requestAnimationFrame(processDomBatch), 10); }
    });
    domObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
}

function stopDomObserver() {
    domObserver?.disconnect(); domObserver = null;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) { if ((n as any).__cp_orig !== undefined) { n.nodeValue = (n as any).__cp_orig; delete (n as any).__cp_orig; } }
}

function isMe(userId: string | null | undefined): boolean {
    if (!userId) return false;
    if (_cachedMyId) return _cachedMyId === userId;
    try { const myId = AuthenticationStore?.getId?.(); if (myId) { _cachedMyId = myId; return myId === userId; } } catch { }
    return false;
}

function EditIcon({ size = 18 }: { size?: number; }) {
    return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" /></svg>;
}
function FolderIcon() {
    return <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2Z" /></svg>;
}
function CloseIcon() {
    return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>;
}
function TrashIcon() {
    return <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2h4a1 1 0 1 1 0 2h-1.1l-.9 12.1A3 3 0 0 1 17 23H7a3 3 0 0 1-3-2.9L3.1 8H2a1 1 0 0 1 0-2h4V4Zm2 0v2h6V4H9ZM5.1 8l.9 11.9a1 1 0 0 0 1 .1h6a1 1 0 0 0 1-.1L14.9 8H5.1Z" /></svg>;
}
function SaveIcon() {
    return <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7l-4-4Zm-5 16a3 3 0 1 1 0-6 3 3 0 0 1 0 6Zm3-10H5V5h10v4Z" /></svg>;
}

function SectionLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties; }) {
    return <div className="cp-section-label" style={style}>{children}</div>;
}

function Field({ label, value, placeholder, onChange, type = "text" }: {
    label: string; value: string; placeholder?: string; onChange: (v: string) => void; type?: string;
}) {
    return (
        <div className="cp-field">
            <SectionLabel>{label}</SectionLabel>
            <input className="cp-input" type={type} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
        </div>
    );
}

function ImageUpload({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void; }) {
    const fileRef = React.useRef<HTMLInputElement>(null);
    function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => { if (ev.target?.result) onChange(ev.target.result as string); };
        reader.readAsDataURL(file);
    }
    return (
        <div className="cp-field">
            <SectionLabel>{label}</SectionLabel>
            <div className="cp-image-row">
                <input className="cp-input cp-url-input" placeholder={t("Image URL...")} value={value.startsWith("data:") ? "" : value} onChange={e => onChange(e.target.value)} />
                <button className="cp-file-btn" onClick={() => fileRef.current?.click()} title={t("Choose a file")}><FolderIcon /></button>
                <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFile} />
                {value && <>
                    <img src={value} alt="" className="cp-preview-avatar" />
                    <button className="cp-clear-btn" onClick={() => onChange("")} title={t("Delete")}><CloseIcon /></button>
                </>}
            </div>
        </div>
    );
}

function Toggle({ label, checked, onChange, sublabel }: { label: string; checked: boolean; onChange: (v: boolean) => void; sublabel?: string; }) {
    return (
        <div className="cp-toggle-row" onClick={() => onChange(!checked)}>
            <div className="cp-toggle-text">
                <span className="cp-toggle-label">{label}</span>
                {sublabel && <span className="cp-toggle-sub">{sublabel}</span>}
            </div>
            <div className={`cp-toggle ${checked ? "cp-toggle--on" : ""}`}><div className="cp-toggle-thumb" /></div>
        </div>
    );
}

function BadgeBtn({ label, icon, active, onClick }: { label: string; icon?: string; active: boolean; onClick: () => void; }) {
    return (
        <button onClick={onClick} className={`cp-badge ${active ? "cp-badge--on" : ""}`}
            style={{ display: "flex", alignItems: "center", gap: 5 }}>
            {icon && <img src={icon} alt="" style={{ width: 16, height: 16, objectFit: "contain", flexShrink: 0 }} />}
            <span>{label}</span>
        </button>
    );
}

function BadgePicker({ selected, onChange, nitroType, onNitroType, boostLevel, onBoostLevel, customIds, onCustomIds, oldName, onOldName }: {
    selected: number; onChange: (v: number) => void;
    nitroType: number; onNitroType: (v: number) => void;
    boostLevel: number; onBoostLevel: (v: number) => void;
    customIds: string[]; onCustomIds: (v: string[]) => void;
    oldName: string; onOldName: (v: string) => void;
}) {
    const hasOldName = customIds.includes("oldname");
    return (
        <div className="cp-field">
            <SectionLabel>{t("Badges")}</SectionLabel>
            <div className="cp-badges">
                {BADGES.map(b => (
                    <BadgeBtn key={b.flag} label={b.label} icon={b.icon}
                        active={!!(selected & b.flag)} onClick={() => onChange(selected ^ b.flag)} />
                ))}
            </div>
            <SectionLabel style={{ marginTop: 8 }}>{t("Evolving Nitro Badge")}</SectionLabel>
            <div className="cp-badges">
                <BadgeBtn label={t("None")} active={nitroType === -1} onClick={() => onNitroType(-1)} />
                {NITRO_LEVELS.map((n, i) => (
                    <BadgeBtn key={i} label={n.label} icon={n.icon} active={nitroType === i} onClick={() => {
                        onNitroType(i);
                    }} />
                ))}
            </div>
            <SectionLabel style={{ marginTop: 8 }}>{t("Special Badges")}</SectionLabel>
            <div className="cp-badges">
                <BadgeBtn label={t("Completed a quest")}
                    icon="https://cdn.discordapp.com/badge-icons/7d9ae358c8c5e118768335dbe68b4fb8.png"
                    active={customIds.includes("quest")}
                    onClick={() => onCustomIds(customIds.includes("quest") ? customIds.filter(x => x !== "quest") : [...customIds, "quest"])} />
                <BadgeBtn label={t("Orbs — Apprentice")}
                    icon="https://cdn.discordapp.com/badge-icons/83d8a1eb09a8d64e59233eec5d4d5c2d.png"
                    active={customIds.includes("orbs")}
                    onClick={() => onCustomIds(customIds.includes("orbs") ? customIds.filter(x => x !== "orbs") : [...customIds, "orbs"])} />
                <BadgeBtn label={t("Old username")} icon={OLD_NAME_BADGE_ICON} active={hasOldName}
                    onClick={() => onCustomIds(hasOldName ? customIds.filter(x => x !== "oldname") : [...customIds, "oldname"])} />
            </div>
            {hasOldName && (
                <div className="cp-field" style={{ marginTop: 6 }}>
                    <SectionLabel style={{ marginTop: 0 }}>{t("Old username displayed in tooltip")}</SectionLabel>
                    <input className="cp-input" value={oldName} placeholder="OldUser#0000"
                        onChange={e => onOldName(e.target.value)} />
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>
                        {t('Ex : Triggerr#5954 — will appear as "Old username: Triggerr#5954" when hovering the badge.')}
                    </div>
                </div>
            )}
            <SectionLabel style={{ marginTop: 8 }}>{t("Boost Badge (Server Booster)")}</SectionLabel>
            <div className="cp-badges">
                <BadgeBtn label={t("None")} active={boostLevel === -1} onClick={() => onBoostLevel(-1)} />
                {BOOST_LABELS.map((lbl, i) => (
                    <BadgeBtn key={i} label={lbl} icon={BOOST_ICONS[i]} active={boostLevel === i} onClick={() => onBoostLevel(i)} />
                ))}
            </div>
        </div>
    );
}

function ProfilePreview({ data }: { data: CustomProfileData; }) {
    const currentUser = UserStore.getCurrentUser();
    const displayName = data.globalName || currentUser.globalName || currentUser.username;
    const username = data.username || currentUser.username;
    const avatar = data.avatar || IconUtils.getUserAvatarURL(currentUser, true, 128) || IconUtils.getDefaultAvatarURL(currentUser.id);
    const effectPreview = data.profileEffect ? getProfileEffectPreview(data.profileEffect) : "";

    return (
        <div className="cp-profile-preview">
            <div className="cp-profile-preview-banner" style={{ backgroundImage: data.banner ? `url("${data.banner}")` : undefined }}>
                {effectPreview && <img src={effectPreview} alt="" className="cp-profile-effect-preview" />}
            </div>
            <div className="cp-profile-preview-body">
                <div className="cp-profile-preview-avatar-wrap">
                    <img src={avatar} alt="" className="cp-profile-preview-avatar" />
                    {data.decorationAsset && <img src={getDecorationUrl(data.decorationAsset)} alt="" className="cp-profile-preview-decoration" />}
                </div>
                <div className="cp-profile-preview-text">
                    <div className="cp-profile-preview-name-row">
                        <span className="cp-profile-preview-name">{displayName}</span>
                        <span className="cp-profile-pill">Client-side</span>
                        {data.copiedUserId && <span className="cp-profile-pill cp-profile-pill-imported">Imported</span>}
                    </div>
                    <span className="cp-profile-preview-username">@{username}</span>
                    {data.bio && <span className="cp-profile-preview-bio">{data.bio}</span>}
                </div>
            </div>
        </div>
    );
}

function ProfileEffectPicker({ value, onChange }: { value: ProfileEffect | null | undefined; onChange: (effect: ProfileEffect | null) => void; }) {
    const effects = getProfileEffects(value);
    const selectedSkuId = value?.skuId ?? "";

    return (
        <div className="cp-field">
            <SectionLabel>{t("Profile effect")}</SectionLabel>
            <div className="cp-effect-grid">
                <button
                    onClick={() => onChange(null)}
                    className={`cp-effect-tile ${!selectedSkuId ? "cp-effect-tile--on" : ""}`}
                >
                    <span className="cp-effect-empty">{t("None")}</span>
                </button>
                {effects.map(effect => {
                    const preview = getProfileEffectPreview(effect);

                    return (
                        <button
                            key={effect.skuId}
                            onClick={() => onChange(selectedSkuId === effect.skuId ? null : effect)}
                            className={`cp-effect-tile ${selectedSkuId === effect.skuId ? "cp-effect-tile--on" : ""}`}
                            title={effect.title || effect.accessibilityLabel || effect.skuId}
                        >
                            {preview ? <img src={preview} alt="" className="cp-effect-img" /> : <span className="cp-effect-empty">{effect.title || effect.skuId}</span>}
                            <span className="cp-effect-label">{effect.title || effect.accessibilityLabel || effect.skuId}</span>
                        </button>
                    );
                })}
            </div>
            {!effects.length && (
                <div className="cp-hint">{t("Open a profile with an effect and import it, or use an effect already available on your account.")}</div>
            )}
        </div>
    );
}

function forceAccountPanelRerender() {
    try {
        const WP = (Vencord as any).Webpack;
        const UserStore = WP?.findByStoreName("UserStore");
        if (UserStore && UserStore.emitChange) UserStore.emitChange();

        const UPS = WP?.findByStoreName("UserProfileStore");
        if (UPS && UPS.emitChange) UPS.emitChange();

        const MAS = WP?.findByProps?.("getUsers", "getValidUsers", "getHasLoggedInAccounts");
        if (MAS && MAS.emitChange) MAS.emitChange();

        FluxDispatcher.dispatch({ type: "USER_SETTINGS_PROTO_UPDATE", settings: { type: 1, proto: {} } });

        if (isEnabled) startDomObserver();
        else stopDomObserver();
    } catch { }
}

function CustomProfileModal({ rootProps }: { rootProps: any; }) {
    const myId = AuthenticationStore?.getId?.() || "";
    const [selectedAccountId, setSelectedAccountId] = React.useState(myId);
    const [data, setData] = React.useState<CustomProfileData>(() => ({ ...(allAccountsData[myId] || storedData || {}) }));
    const [saving, setSaving] = React.useState(false);
    const nitroLevel = data.nitroLevel ?? -1;
    const boostLevel = data.boostMonths ?? -1;
    const customIds = data.customBadgeIds ?? [];
    const oldName = data.oldName ?? "";

    const accounts = React.useMemo(() => {
        try {
            const MAS = (window as any).Vencord?.Webpack?.findByProps?.("getUsers", "getValidUsers");
            if (MAS?.getUsers) {
                const users = MAS.getUsers();
                if (Array.isArray(users) && users.length > 0) return users;
            }

            const internalStore = (window as any).Vencord?.Webpack?.findStore?.("MultiAccountStore");
            if (internalStore?.getUsers) {
                const users = internalStore.getUsers();
                if (Array.isArray(users) && users.length > 0) return users;
            }
        } catch (e) { console.error("[LarpCord] Failed to fetch accounts:", e); }

        const me = UserStore.getCurrentUser();
        return me ? [me, { ...me, id: "debug-placeholder", username: "Second Account?", globalName: "Simulation" }] : [];
    }, []);

    React.useEffect(() => {
        const newData = allAccountsData[selectedAccountId] || {};
        setData({ ...newData });
    }, [selectedAccountId]);

    function set<K extends keyof CustomProfileData>(key: K, val: CustomProfileData[K]) {
        setData(d => ({ ...d, [key]: val }));
    }

    function setDecoration(asset?: string, skuId?: string) {
        setData(d => ({ ...d, decorationAsset: asset, decorationSkuId: skuId }));
    }

    async function save() {
        try {
            setSaving(true);
            const savedData = { ...data };

            allAccountsData[selectedAccountId] = savedData;
            allAccountsEnabled[selectedAccountId] = true;

            if (selectedAccountId === myId) {
                storedData = savedData;
                isEnabled = true;
                saveDataSync(storedData, true);
                cachedFakeUser = null;
                cachedOriginalUser = null;
                _dataVersion++;

                if (LarpSettings.syncOwnCustomProfile) {
                    getStoredToken().then(token => {
                        if (token) {
                            saveOwnPluginConfig("customProfile", token, { ...savedData, private: false }).then(() => {
                                publicProfilesCache.delete(myId);
                            }).catch(e => {
                                console.error("[LarpCord] Failed to sync to cloud:", e);
                            });
                        } else {
                            beginDiscordOAuth().then(oauthData => {
                                const clientId = new URL(oauthData.url).searchParams.get("client_id") ?? "";
                                openModal((p: any) => <OAuth2AuthorizeModal
                                    {...p}
                                    scopes={oauthData.scopes}
                                    responseType="code"
                                    redirectUri={oauthData.redirectUri}
                                    permissions={0n}
                                    clientId={clientId}
                                    cancelCompletesFlow={false}
                                    callback={async ({ location }: { location: string; }) => {
                                        try {
                                            const res = await fetch(location);
                                            const json = await res.json();
                                            if (json?.token) {
                                                await storeToken(json.token);
                                                saveOwnPluginConfig("customProfile", json.token, { ...savedData, private: false }).then(() => {
                                                    publicProfilesCache.delete(myId);
                                                }).catch(e => console.error("[LarpCord] Failed to sync after OAuth:", e));
                                            }
                                        } catch (e) {
                                            console.error("[LarpCord] OAuth callback error:", e);
                                        }
                                    }}
                                />);
                            }).catch(e => console.error("[LarpCord] OAuth initiation failed:", e));
                        }
                    });
                }
            }

            saveAllDataSync();
            DataStore.set(DS_ALL_DATA, allAccountsData).catch(() => { });
            DataStore.set(DS_ALL_ENABLED, allAccountsEnabled).catch(() => { });

            updateCachedRealData();
            forceAccountPanelRerender();
        } catch (err) {
            console.error("[LarpCord] save error:", err);
        } finally {
            setSaving(false);
            rootProps.onClose();
        }
    }

    async function reset() {
        delete allAccountsData[selectedAccountId];
        delete allAccountsEnabled[selectedAccountId];

        if (selectedAccountId === myId) {
            storedData = {};
            isEnabled = false;
            saveDataSync({}, false);
            cachedFakeUser = null;
            cachedOriginalUser = null;
            _trueOriginalUser = null;
            _dataVersion++;

            if (LarpSettings.syncOwnCustomProfile) {
                getStoredToken().then(token => {
                    if (token) {
                        saveOwnPluginConfig("customProfile", token, { private: true }).catch(() => { });
                        publicProfilesCache.delete(myId);
                    }
                });
            }
        }

        saveAllDataSync();
        DataStore.set(DS_ALL_DATA, allAccountsData).catch(() => { });
        DataStore.set(DS_ALL_ENABLED, allAccountsEnabled).catch(() => { });
        DataStore.set(DS_KEY, {}).catch(() => { });
        DataStore.set(DS_ENABLED, false).catch(() => { });

        forceAccountPanelRerender();
        rootProps.onClose();
    }

    const accentHex = data.accentColor != null ? "#" + data.accentColor.toString(16).padStart(6, "0") : "";
    const selectedDecorationIsListed = data.decorationAsset
        ? AVATAR_DECORATIONS.some(dec => dec.id === data.decorationAsset)
        : false;

    return (
        <LarpModalRoot {...rootProps} size="medium">
            <LarpModalHeader separator={false}>
                <div className="cp-header">
                    <EditIcon size={16} />
                    <span className="cp-header-title">LarpCord</span>
                </div>
                <div style={{ marginLeft: "auto", marginRight: 8, minWidth: 200 }}>
                    <Select
                        options={accounts.map((acc: any) => ({
                            value: acc.id,
                            label: acc.globalName || acc.username,
                        }))}
                        isSelected={(v: string) => v === selectedAccountId}
                        select={(v: string) => setSelectedAccountId(v)}
                        serialize={(v: string) => v}
                        renderOptionLabel={(o: any) => (
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <img
                                    src={IconUtils.getUserAvatarURL(accounts.find((a: any) => a.id === o.value), false, 20)}
                                    style={{ borderRadius: "50%", width: 20, height: 20 }}
                                />
                                {o.label}
                            </div>
                        )}
                        renderOptionValue={(selected: any[]) => {
                            const option = selected[0];
                            if (!option) return "Select Account";
                            return (
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <img
                                        src={IconUtils.getUserAvatarURL(accounts.find((a: any) => a.id === option.value), false, 20)}
                                        style={{ borderRadius: "50%", width: 20, height: 20 }}
                                    />
                                    {option.label}
                                </div>
                            );
                        }}
                    />
                </div>
                <LarpModalCloseButton onClick={rootProps.onClose} />
            </LarpModalHeader>
            <LarpModalContent className="cp-content">

                <ProfilePreview data={data} />
                <Field label={t("Username")} value={data.username ?? ""} placeholder="my_username_00" onChange={v => set("username", v)} />
                <Field label={t("Display name")} value={data.globalName ?? ""} placeholder="My Name" onChange={v => set("globalName", v)} />
                <ImageUpload label={t("Profile picture")} value={data.avatar ?? ""} onChange={v => set("avatar", v)} />
                <Toggle label={t("Simulate Nitro")} sublabel={t("Enables banner and profile color")} checked={data.nitro ?? false} onChange={v => set("nitro", v)} />
                {data.nitro && <ImageUpload label={t("Banner")} value={data.banner ?? ""} onChange={v => set("banner", v)} />}
                <div className="cp-divider" />
                <Field label={t("Bio")} value={data.bio ?? ""} placeholder={t("My description...")} onChange={v => set("bio", v)} />
                <Field label={t("Pronouns")} value={data.pronouns ?? ""} placeholder={t("he/him")} onChange={v => set("pronouns", v)} />
                <div className="cp-field">
                    <SectionLabel>{t("Profile color (Nitro — gradient possible)")}</SectionLabel>
                    <div className="cp-color-row" style={{ marginBottom: 6 }}>
                        <span style={{ fontSize: 11, color: "var(--text-muted)", marginRight: 6 }}>{t("Color 1")}</span>
                        <input type="color" value={accentHex || "#5865f2"} onChange={e => { const n = parseInt(e.target.value.replace("#", ""), 16); if (!isNaN(n)) set("accentColor", n); }} className="cp-color-swatch" />
                        <input value={accentHex} placeholder="#5865f2" onChange={e => { const h = e.target.value.replace("#", ""); const n = parseInt(h, 16); if (!isNaN(n) && h.length === 6) set("accentColor", n); else if (!e.target.value || e.target.value === "#") set("accentColor", undefined); }} className="cp-input cp-color-input" />
                        {data.accentColor != null && <button className="cp-clear-btn" onClick={() => set("accentColor", undefined)}><CloseIcon /></button>}
                    </div>
                    <div className="cp-color-row">
                        <span style={{ fontSize: 11, color: "var(--text-muted)", marginRight: 6 }}>{t("Color 2")}</span>
                        {(() => {
                            const hex2 = data.accentColor2 != null ? "#" + data.accentColor2.toString(16).padStart(6, "0") : ""; return (<>
                                <input type="color" value={hex2 || "#eb459e"} onChange={e => { const n = parseInt(e.target.value.replace("#", ""), 16); if (!isNaN(n)) set("accentColor2", n); }} className="cp-color-swatch" />
                                <input value={hex2} placeholder="#eb459e (optional)" onChange={e => { const h = e.target.value.replace("#", ""); const n = parseInt(h, 16); if (!isNaN(n) && h.length === 6) set("accentColor2", n); else if (!e.target.value || e.target.value === "#") set("accentColor2", undefined); }} className="cp-input cp-color-input" />
                                {data.accentColor2 != null && <button className="cp-clear-btn" onClick={() => set("accentColor2", undefined)}><CloseIcon /></button>}
                            </>);
                        })()}
                    </div>
                </div>
                <Field label={t("Account creation date")} value={data.createdAt ?? ""} placeholder="2010-06-29" type="date" onChange={v => set("createdAt", v)} />
                <Field label={t("Email address (local display)")} value={data.email ?? ""} placeholder="exemple@mail.com" onChange={v => set("email", v)} />
                <Field label={t("Phone (local display)")} value={data.phone ?? ""} placeholder="+33 6 00 00 00 00" onChange={v => set("phone", v)} />
                <div className="cp-divider" />
                <BadgePicker
                    selected={data.badgeFlags ?? 0} onChange={v => set("badgeFlags", v)}
                    nitroType={nitroLevel} onNitroType={v => {
                        set("nitroLevel", v as any);
                        if (v >= 1) set("nitro", true);
                    }}
                    boostLevel={boostLevel} onBoostLevel={v => set("boostMonths", v)}
                    customIds={customIds} onCustomIds={v => set("customBadgeIds", v)}
                    oldName={oldName} onOldName={v => set("oldName", v)}
                />
                <div className="cp-divider" />
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <SectionLabel>{t("Avatar decoration")}</SectionLabel>
                </div>
                <div className="cp-badges" style={{ flexWrap: "wrap", gap: 6 }}>
                    <button onClick={() => setDecoration()}
                        className={`cp-badge ${!data.decorationAsset ? "cp-badge--on" : ""}`} style={{ minWidth: 60 }}>
                        {t("None")}
                    </button>
                    {data.decorationAsset && !selectedDecorationIsListed && (
                        <button
                            onClick={() => setDecoration()}
                            className="cp-badge cp-badge--on"
                            title={t("Imported decoration")} style={{ padding: 3, lineHeight: 0, width: 52, height: 52, borderRadius: 6 }}>
                            <img src={getDecorationUrl(data.decorationAsset)} alt={t("Imported decoration")}
                                style={{ width: 46, height: 46, objectFit: "contain", display: "block" }} />
                        </button>
                    )}
                    {AVATAR_DECORATIONS.map(dec => (
                        <button key={dec.id}
                            onClick={() => data.decorationAsset === dec.id ? setDecoration() : setDecoration(dec.id, dec.id)}
                            className={`cp-badge ${data.decorationAsset === dec.id ? "cp-badge--on" : ""}`}
                            title={dec.label} style={{ padding: 3, lineHeight: 0, width: 52, height: 52, borderRadius: 6 }}>
                            <img src={getDecorationUrl(dec.id)} alt={dec.label}
                                style={{ width: 46, height: 46, objectFit: "contain", display: "block" }} />
                        </button>
                    ))}
                </div>
                <div className="cp-hint">
                    <a
                        role="button"
                        style={{ color: "var(--text-link)", cursor: "pointer", fontWeight: 500 }}
                        onClick={() => {
                            rootProps.onClose();
                            try {
                                SettingsRouter.openUserSettings("equicord_main");
                            } catch {
                                try {
                                    SettingsRouter.open("equicord_main");
                                } catch {
                                    try {
                                        FluxDispatcher.dispatch({ type: "USER_SETTINGS_MODAL_OPEN", section: "equicord_main" });
                                    } catch { }
                                }
                            }
                        }}
                    >
                        LarpCord changes stay on this client. Right click another user to import their public profile into your local preview.
                    </a>
                </div>
                <div className="cp-divider" />
                <ProfileEffectPicker value={data.profileEffect} onChange={effect => set("profileEffect", effect)} />
            </LarpModalContent>
            <LarpModalFooter className="cp-footer">
                <button className="cp-btn cp-btn-ghost" onClick={rootProps.onClose}>{t("Cancel")}</button>
                <button className="cp-btn cp-btn-danger" onClick={reset}><TrashIcon /><span>{t("Reset")}</span></button>
                <button className="cp-btn cp-btn-primary" onClick={save} disabled={saving}><SaveIcon /><span>{saving ? t("Saving...") : t("Save")}</span></button>
            </LarpModalFooter>
        </LarpModalRoot>
    );
}

function CustomProfileIcon() {
    return <EditIcon size={18} />;
}

function CustomProfileButton() {
    const { showIcon } = settings.use(ICON_SETTING_KEYS);
    if (!showIcon) return null;

    return <HeaderBarButton icon={CustomProfileIcon} tooltip="LarpCord" onClick={() => openModal(props => <CustomProfileModal rootProps={props} />)} />;
}

const CustomProfileButtonWithBoundary = ErrorBoundary.wrap(CustomProfileButton, { noop: true });

function CPDMNotice({ userId }: { userId: string; }) {
    const cached = publicProfilesCache.get(userId);

    const data = cached?.fetched ? cached?.data : null;
    const hasRealModifications = data && (
        data.username || data.globalName || data.avatar || data.banner ||
        data.bio || data.pronouns || data.accentColor != null ||
        data.badgeFlags || data.nitro || data.decorationAsset ||
        data.profileEffect ||
        (data.customBadgeIds && data.customBadgeIds.length > 0) ||
        data.createdAt
    );

    const [showRaw, setShowRaw] = React.useState(false);

    if (!LarpSettings.seeAllCustomProfile || !hasRealModifications) return null;

    return (
        <div style={{
            margin: "8px 0 12px 0",
            padding: "10px 14px",
            background: "rgba(250, 166, 26, 0.1)",
            border: "1px solid rgba(250, 166, 26, 0.4)",
            borderRadius: 6,
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
        }}>
            <span style={{ fontSize: 18, flexShrink: 0 }}>⚠️</span>
            <div style={{ flex: 1 }}>
                <span style={{ color: "var(--text-warning, #faa61a)", fontWeight: 600, fontSize: 13 }}>
                    LarpCord warning. This user has a client-side profile override enabled.
                </span>
                <br />
                <span
                    role="button"
                    style={{ color: "var(--text-link)", fontSize: 12, cursor: "pointer", marginTop: 2, display: "inline-block" }}
                    onClick={() => setShowRaw(r => !r)}
                >
                    {showRaw ? "Hide raw profile" : "View raw profile"}
                </span>
                {showRaw && (() => {
                    const data = cached!.data!;
                    const fields: [string, string][] = [];
                    if (data.username) fields.push(["Username", data.username]);
                    if (data.globalName) fields.push(["Display name", data.globalName]);
                    if (data.bio) fields.push(["Bio", data.bio]);
                    if (data.pronouns) fields.push(["Pronouns", data.pronouns]);
                    if (data.createdAt) fields.push(["Account created", data.createdAt]);
                    if (data.nitro) fields.push(["Nitro", "Simulated"]);
                    return (
                        <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-muted)", display: "flex", flexDirection: "column", gap: 2 }}>
                            {fields.map(([k, v]) => (
                                <span key={k}><strong>{k}:</strong> {v}</span>
                            ))}
                        </div>
                    );
                })()}
            </div>
        </div>
    );
}

export default definePlugin({
    name: "LarpCord",
    enabledByDefault: true,
    description: t("Visually customize your local Discord profile preview with names, avatars, banners, badges and effects."),
    authors: [{ name: "irritably", id: 928787166916640838n }],
    dependencies: ["HeaderBarAPI", "ContextMenuAPI"],
    settings,

    headerBarButton: {
        icon: CustomProfileIcon,
        render: () => <CustomProfileButtonWithBoundary />,
        priority: 10
    },

    patches: [
        {
            find: "getRecipientId()",
            noWarn: true,
            replacement: {
                match: /(children:\[)(\i\.isDM\(\).{0,300})/,
                replace: "$1$self.renderDMNotice(this.props),$2"
            }
        },
        {
            find: '"SHOULD_LOAD");',
            replacement: {
                match: /\i(?:\?)?.getPreviewBanner\(\i,\i,\i\)(?=.{0,100}"COMPLETE")/,
                replace: "$self.patchBannerUrl(arguments[0])||$&"
            }
        },
        {
            find: ".WIDGETS_RTC_UPSELL_COACHMARK)",
            replacement: {
                match: /currentUser:(\i)(?=.{0,200}voiceDb)/,
                replace: "currentUser:$self.fakeCurrentUser($1)"
            }
        },
        {
            find: "DISPLAY_NAME",
            noWarn: true,
            replacement: {
                match: /(?<=currentUser:\i,user:)(\i)/,
                replace: "$self.fakeCurrentUser($1)"
            }
        },
        {
            find: "obfuscatedEmail",
            noWarn: true,
            replacement: [
                {
                    match: /obfuscatedEmail:(\i)/,
                    replace: "obfuscatedEmail:$self.fakeObfuscatedEmail($1)"
                },
                {
                    match: /obfuscatedPhone:(\i)/,
                    replace: "obfuscatedPhone:$self.fakeObfuscatedPhone($1)"
                }
            ]
        },
        {
            find: "isHoveringOrFocusing",
            replacement: [
                {
                    noWarn: true,
                    match: /user:([A-Za-z_$][\w$]*),displayProfile:([A-Za-z_$][\w$]*),themeType/,
                    replace: "user:$self.fakeCurrentUser($1),displayProfile:$2,themeType"
                }
            ]
        },
        {
            find: "AccountPanel",
            replacement: [
                {
                    match: /user:([a-zA-Z0-9_]+),/,
                    replace: "user:$self.fakeCurrentUser($1),"
                }
            ]
        },
        {
            find: "UserAccountSettings",
            replacement: [
                {
                    match: /user:([a-zA-Z0-9_]+),/,
                    replace: "user:$self.fakeCurrentUser($1),"
                },
                {
                    match: /email:([^,}]+),/,
                    replace: "email:$self.fakeObfuscatedEmail($1),"
                }
            ]
        },
        {
            find: "getObfuscatedEmail",
            replacement: [
                {
                    match: /obfuscatedEmail:([^,}]+)/g,
                    replace: "obfuscatedEmail:$self.fakeObfuscatedEmail($1)"
                },
                {
                    match: /obfuscatedPhone:([^,}]+)/g,
                    replace: "obfuscatedPhone:$self.fakeObfuscatedPhone($1)"
                }
            ]
        }
    ],

    _copiedUserId: null as string | null,

    isCopiedUser(userId: string | null | undefined): boolean {
        if (!isEnabled || !userId || !this._copiedUserId) return false;
        return userId === this._copiedUserId;
    },

    fakeCurrentUser(user: any) {
        if (!user || (!isEnabled && this._forceNative !== true) || !isMe(user.id)) return user;

        if (cachedOriginalUser === user && cachedFakeUser && cachedDataHash === _dataVersion) {
            return cachedFakeUser;
        }

        const realUser = (user as any).__cp_isClone ? _trueOriginalUser || user : user;
        if (!realUser.__cp_isClone) _trueOriginalUser = realUser;

        const realUsername = realUser.__cp_isClone ? (realUser._realUsername || realUser.username) : realUser.username;
        const realGlobalName = realUser.__cp_isClone ? (realUser._realGlobalName ?? realUser.globalName) : realUser.globalName;
        const realDisplayName = realUser.__cp_isClone ? (realUser._realDisplayName ?? realUser.displayName) : realUser.displayName;

        const clone = Object.create(Object.getPrototypeOf(realUser));

        for (const key of Reflect.ownKeys(realUser)) {
            if (key === "username" || key === "globalName" || key === "displayName" || key === "__cp_isClone") continue;
            const desc = Object.getOwnPropertyDescriptor(realUser, key);
            if (desc) Object.defineProperty(clone, key, desc);
        }
        Object.defineProperty(clone, "__cp_isClone", { value: true, enumerable: false, configurable: true });
        clone._realUsername = realUsername;
        clone._realGlobalName = realGlobalName;
        clone._realDisplayName = realDisplayName;

        if (!isEnabled) {
            clone.username = realUsername;
            clone.globalName = realGlobalName;
            clone.displayName = realDisplayName;
            cachedOriginalUser = user;
            cachedFakeUser = clone;
            cachedDataHash = _dataVersion;
            return clone;
        }

        const fakeUser = storedData.username || realUsername;
        const hasCustomGlobalName = !!storedData.globalName;
        const fakeGlobal = hasCustomGlobalName ? storedData.globalName : realGlobalName;
        const origDisplay = realGlobalName || realDisplayName || realUsername;
        const fakeDisplay = hasCustomGlobalName ? (storedData.globalName || origDisplay) : origDisplay;

        Object.defineProperty(clone, "username", {
            get: () => isEnabled ? fakeUser : realUsername,
            set: () => { }, configurable: true, enumerable: true
        });
        Object.defineProperty(clone, "globalName", {
            get: () => isEnabled ? fakeGlobal : realGlobalName,
            set: () => { }, configurable: true, enumerable: true
        });
        Object.defineProperty(clone, "displayName", {
            get: () => isEnabled ? fakeDisplay : (realDisplayName || realGlobalName || realUsername),
            set: () => { }, configurable: true, enumerable: true
        });

        if (storedData.email) clone.email = storedData.email;
        if (storedData.phone) clone.phone = storedData.phone;

        clone.getTag = () => (storedData.username || realUsername) + "#0000";
        clone.getGlobalName = () => isEnabled ? fakeGlobal : realGlobalName;
        clone.toString = () => fakeDisplay;

        if (storedData.createdAt) {
            const fakeCreatedAt = new Date(storedData.createdAt + "T12:00:00Z");
            Object.defineProperty(clone, "createdAt", {
                get: () => fakeCreatedAt,
                configurable: true,
                enumerable: true
            });
        }

        const storedDecoration = getStoredDecorationData(storedData);
        if (storedDecoration) {
            clone.avatarDecoration = storedDecoration;
            clone.avatarDecorationData = storedDecoration;
        }

        const storedProfileEffect = cloneProfileEffect(storedData.profileEffect);
        if (storedProfileEffect) {
            clone.profileEffect = storedProfileEffect;
            clone.profileEffectId = storedProfileEffect.skuId;
        }

        const wantedFlags = (isEnabled && storedData.badgeFlags != null) ? storedData.badgeFlags : realUser.publicFlags;
        clone.publicFlags = wantedFlags;
        clone.flags = wantedFlags;

        if (!realUser.__cp_isClone) {
            clone._realPremiumType = realUser.premiumType;
            clone._realPremiumSince = realUser.premiumSince;
            clone._realPremiumGuildSince = realUser.premiumGuildSince;
        }

        cachedOriginalUser = user;
        cachedFakeUser = clone;
        cachedDataHash = _dataVersion;

        return clone;
    },

    fakeOtherUser(realUser: any, data: CustomProfileData) {
        if (!realUser || !realUser.id) return realUser;
        const clone = Object.create(realUser);

        if (data.username) clone.username = data.username;
        if (data.globalName) clone.globalName = data.globalName;

        if (data.avatar) clone.avatar = data.avatar;

        if (data.email) clone.email = data.email;
        if (data.phone) clone.phone = data.phone;

        if (data.createdAt) {
            const fakeCreatedAt = new Date(data.createdAt + "T12:00:00Z");
            Object.defineProperty(clone, "createdAt", {
                get: () => fakeCreatedAt,
                configurable: true,
                enumerable: true
            });
            clone.__cp_fakeCreatedAt = fakeCreatedAt.getTime();
        }

        const decoration = getStoredDecorationData(data);
        if (decoration) {
            clone.avatarDecoration = decoration;
            clone.avatarDecorationData = decoration;
        }

        const profileEffect = cloneProfileEffect(data.profileEffect);
        if (profileEffect) {
            clone.profileEffect = profileEffect;
            clone.profileEffectId = profileEffect.skuId;
        }

        const wantedFlags = data.badgeFlags != null ? data.badgeFlags : realUser.publicFlags;
        clone.publicFlags = wantedFlags;
        clone.flags = wantedFlags;

        if (data.nitro) {
            clone.premiumType = 2;
            const LEVEL_MONTHS = [1, 2, 3, 6, 12, 24, 36, 72];
            const since = new Date();
            since.setMonth(since.getMonth() - (LEVEL_MONTHS[data.nitroLevel!] ?? 1));
            clone.premiumSince = since;

            const bm = data.boostMonths ?? -1;
            if (bm >= 0) {
                const BOOST_M = [1, 2, 3, 6, 9, 12, 15, 18, 24];
                const boostSince = new Date();
                boostSince.setMonth(boostSince.getMonth() - (BOOST_M[bm] ?? 1));
                clone.premiumGuildSince = boostSince;
            } else {
                clone.premiumGuildSince = null;
            }
        } else if (data.nitro === false) {
            clone.premiumType = 0;
            clone.premiumSince = null;
            clone.premiumGuildSince = null;
        }

        clone.__cp_fake_other = true;
        return clone;
    },

    hookOtherUserProfile(profile: any, data: CustomProfileData) {
        if (!profile) return profile;
        try {
            const merged: any = {};

            if (data.bio) merged.bio = data.bio;
            if (data.pronouns) merged.pronouns = data.pronouns;
            if (data.accentColor != null) merged.accentColor = data.accentColor;
            if (data.banner) merged.banner = data.banner;

            const decoration = getStoredDecorationData(data);
            if (decoration) {
                merged.avatarDecoration = decoration;
                merged.avatarDecorationData = decoration;
            }

            if (data.profileEffect !== undefined) {
                const profileEffect = cloneProfileEffect(data.profileEffect);
                merged.profileEffect = profileEffect;
                merged.profileEffectId = profileEffect?.skuId;
            }

            if (data.nitro || data.badgeFlags != null) {
                merged.premiumType = data.nitro ? 2 : 0;

                if (data.nitro) {
                    if (data.accentColor != null) {
                        const c2 = data.accentColor2 ?? data.accentColor;
                        merged.themeColors = [data.accentColor, c2];
                    }
                    const nl = data.nitroLevel ?? 0;
                    const LEVEL_MONTHS = [1, 2, 3, 6, 12, 24, 36, 72];
                    const since = new Date();
                    since.setMonth(since.getMonth() - (LEVEL_MONTHS[nl] ?? 1));
                    merged.premiumSince = since;

                    const bm = data.boostMonths ?? -1;
                    if (bm >= 0) {
                        const BOOST_M = [1, 2, 3, 6, 9, 12, 15, 18, 24];
                        const boostSince = new Date();
                        boostSince.setMonth(boostSince.getMonth() - (BOOST_M[bm] ?? 1));
                        merged.premiumGuildSince = boostSince;
                    } else {
                        merged.premiumGuildSince = null;
                    }
                } else {
                    merged.premiumSince = null;
                    merged.premiumGuildSince = null;
                }

                merged.publicFlags = (data.badgeFlags != null) ? data.badgeFlags : profile.publicFlags;
                merged.badges = [];
            } else if (data.nitro === false) {
                merged.premiumType = profile.premiumType ?? 0;
                merged.premiumSince = null;
                merged.premiumGuildSince = null;
            }

            const badgesArr = cloneProfileBadges(profile.badges);
            const customIds = data.customBadgeIds ?? [];
            if (customIds.includes("quest")) badgesArr.push({ id: "quest", icon: "7d9ae358c8c5e118768335dbe68b4fb8", description: "Completed a quest" });
            if (customIds.includes("orbs")) badgesArr.push({ id: "orbs", icon: "83d8a1eb09a8d64e59233eec5d4d5c2d", description: "Orbs — Apprentice" });
            if (customIds.includes("oldname")) {
                const dText = data.oldName ? "Originally known as " + data.oldName : "Originally known as ...";
                badgesArr.push({ id: "legacy_username", icon: "6de6d34650760ba5551a79732e98ed60", description: dText });
            }
            if (badgesArr.length > 0) merged.badges = badgesArr;

            return mergeProfile(profile, merged);
        } catch (e) {
            return profile;
        }
    },

    _cachedProfile: null as any,
    _cachedProfileInput: null as any,
    _cachedProfileVersion: 0,

    hookUserProfile(profile: any) {
        if (!profile || !isEnabled) return profile;
        if (this._cachedProfileInput === profile && this._cachedProfile && this._cachedProfileVersion === _dataVersion) {
            return this._cachedProfile;
        }
        try {
            const merged: any = {};

            if (storedData.bio) merged.bio = storedData.bio;
            if (storedData.pronouns) merged.pronouns = storedData.pronouns;
            if (storedData.accentColor != null) merged.accentColor = storedData.accentColor;
            if (storedData.banner) merged.banner = storedData.banner;

            const storedDecoration = getStoredDecorationData(storedData);
            if (storedDecoration) {
                merged.avatarDecoration = storedDecoration;
                merged.avatarDecorationData = storedDecoration;
            }

            if (storedData.profileEffect !== undefined) {
                const profileEffect = cloneProfileEffect(storedData.profileEffect);
                merged.profileEffect = profileEffect;
                merged.profileEffectId = profileEffect?.skuId;
            }

            if (isEnabled && (storedData.nitro || storedData.badgeFlags != null)) {
                merged.premiumType = storedData.nitro ? 2 : 0;

                if (storedData.nitro) {
                    if (storedData.accentColor != null) {
                        const c2 = storedData.accentColor2 ?? storedData.accentColor;
                        merged.themeColors = [storedData.accentColor, c2];
                    }
                    const nl = storedData.nitroLevel ?? 0;
                    const LEVEL_MONTHS = [1, 2, 3, 6, 12, 24, 36, 72];
                    const since = new Date();
                    since.setMonth(since.getMonth() - (LEVEL_MONTHS[nl] ?? 1));
                    merged.premiumSince = since;

                    const bm = storedData.boostMonths ?? -1;
                    if (bm >= 0) {
                        const BOOST_M = [1, 2, 3, 6, 9, 12, 15, 18, 24];
                        const boostSince = new Date();
                        boostSince.setMonth(boostSince.getMonth() - (BOOST_M[bm] ?? 1));
                        merged.premiumGuildSince = boostSince;
                    } else {
                        merged.premiumGuildSince = null;
                    }
                } else {
                    merged.premiumSince = null;
                    merged.premiumGuildSince = null;
                }

                merged.publicFlags = (storedData.badgeFlags != null) ? storedData.badgeFlags : profile.publicFlags;
                merged.badges = [];
            } else if (isEnabled && storedData.nitro === false) {
                merged.premiumType = profile.premiumType ?? 0;
                merged.premiumSince = profile.premiumSince ?? null;
                merged.premiumGuildSince = profile.premiumGuildSince ?? null;
            } else {
                if (profile.premiumType) merged.premiumType = profile.premiumType;
                if (profile.premiumSince) merged.premiumSince = profile.premiumSince;
                if (profile.premiumGuildSince) merged.premiumGuildSince = profile.premiumGuildSince;
            }

            const result = mergeProfile(profile, merged);
            this._cachedProfileInput = profile;
            this._cachedProfile = result;
            this._cachedProfileVersion = _dataVersion;
            return result;
        } catch {
            return profile;
        }
    },

    fakeObfuscatedEmail(real: string | null) {
        if (!isEnabled || !storedData.email || !real) return real;
        const fake = storedData.email;
        const atIdx = fake.indexOf("@");
        if (atIdx <= 1) return fake;
        return fake[0] + "***" + fake.slice(atIdx - 1);
    },

    fakeObfuscatedPhone(real: string | null) {
        if (!isEnabled || !storedData.phone || !real) return real;
        const fake = storedData.phone;
        if (fake.length < 4) return fake;
        return "***-***-" + fake.slice(-4);
    },

    renderDMNotice(props: any) {
        try {
            if (!LarpSettings.seeAllCustomProfile) return null;
            const channel = props?.channel;
            if (!channel?.isDM?.()) return null;
            const recipientId = channel.recipients?.[0];
            if (!recipientId) return null;
            fetchPublicProfileIfNeeded(recipientId);
            const cached = publicProfilesCache.get(recipientId);
            if (!cached?.fetched || !cached?.data) return null;
            const d = cached.data;
            const hasRealModifications = d.username || d.globalName || d.avatar || d.banner ||
                d.bio || d.pronouns || d.accentColor != null || d.badgeFlags ||
                d.nitro || d.decorationAsset || d.profileEffect || (d.customBadgeIds && d.customBadgeIds.length > 0) || d.createdAt;
            if (!hasRealModifications) return null;
            return <CPDMNotice userId={recipientId} />;
        } catch { return null; }
    },

    patchBannerUrl({ displayProfile }: any) {
        try {
            const uid = displayProfile?.userId;
            if (!uid) return null;

            if (isEnabled && storedData.nitro && storedData.banner && isMe(uid)) {
                return storedData.banner;
            }

            checkSeeAllSettingChange();
            if (LarpSettings.seeAllCustomProfile) {
                const cached = publicProfilesCache.get(uid);
                if (cached?.fetched && cached.data?.banner && cached.data?.nitro) {
                    return cached.data.banner;
                }
            }
            return null;
        } catch { return null; }
    },

    toolboxActions: {
        [t("Open LarpCord")]() { openModal(props => <CustomProfileModal rootProps={props} />); },
    },

    _origGetUserAvatarURL: null as any,
    _origExtractTimestamp: null as any,
    _forceNative: false,

    async start() {
        applyAvatarPatchEarly();
        addContextMenuPatch("user-context", userContextMenuPatch);

        loadData().then(() => {
            if (LarpSettings.syncOwnCustomProfile && storedData && Object.keys(storedData).length > 0) {
                getStoredToken().then(t => {
                    if (t) {
                        saveOwnPluginConfig("customProfile", t, { ...storedData, private: false }).catch(e => {
                            console.error("[LarpCord] Auto-sync on startup failed:", e);
                        });
                    }
                });
            }
        });

        FluxDispatcher.subscribe("CONNECTION_OPEN", onAccountSwitch);

        try {
            const US = (Vencord as any).Webpack?.findByProps?.("getCurrentUser", "getUser");
            if (US && !US._cp_perfect_hook) {
                const origCurrent = US.getCurrentUser.bind(US);

                let _lastRealUser: any = null;
                let _lastFakeResult: any = null;
                let _lastCacheVersion = -1;

                US.getCurrentUser = () => {
                    const realUser = origCurrent();
                    if (realUser) {
                        if (realUser !== _lastRealUser) {
                            if (realUser.username) _realUsername = realUser.username;
                            if (realUser.globalName) _realGlobalName = realUser.globalName;
                        }
                        if (realUser === _lastRealUser && _lastCacheVersion === _dataVersion && _lastFakeResult) {
                            return _lastFakeResult;
                        }
                        _lastRealUser = realUser;
                        _lastCacheVersion = _dataVersion;
                        _lastFakeResult = this.fakeCurrentUser(realUser);
                        return _lastFakeResult;
                    }
                    return this.fakeCurrentUser(realUser);
                };

                const origGet = US.getUser.bind(US);
                US.getUser = (id: string) => {
                    const user = origGet(id);
                    if (!user) return user;

                    if (isEnabled && isMe(id)) {
                        return this.fakeCurrentUser(user);
                    }

                    checkSeeAllSettingChange();

                    if (LarpSettings.seeAllCustomProfile) {
                        const cached = publicProfilesCache.get(id);
                        if (cached?.fetched && cached.data) {
                            return this.fakeOtherUser(user, cached.data);
                        }
                    }

                    return user;
                };
                US._cp_perfect_hook = true;
            }
        } catch { }

        try {
            const GMS = (Vencord as any).Webpack?.findByProps?.("getMember", "getMembers", "getMemberIds");
            if (GMS && !GMS._cp_member_hook) {
                const origGetMember = GMS.getMember.bind(GMS);
                GMS.getMember = (guildId: string, userId: string) => {
                    const member = origGetMember(guildId, userId);
                    if (!member) return member;

                    if (isEnabled && isMe(userId)) {
                        const patched = { ...member };
                        if (storedData.username) patched.nick = storedData.globalName || storedData.username;
                        return patched;
                    }

                    return member;
                };
                GMS._cp_member_hook = true;
            }
        } catch { }

        try {
            const UPS = (Vencord as any).Webpack?.findByProps?.("getUserProfile", "getGuildMemberProfile");
            if (UPS?._cp_profile_hook && UPS._cp_orig_getUserProfile) {
                UPS.getUserProfile = UPS._cp_orig_getUserProfile;
                if (UPS._cp_orig_getGuildMemberProfile) UPS.getGuildMemberProfile = UPS._cp_orig_getGuildMemberProfile;
                delete UPS._cp_profile_hook;
                delete UPS._cp_orig_getUserProfile;
                delete UPS._cp_orig_getGuildMemberProfile;
            }
            if (UPS && (!UPS._cp_profile_hook || !UPS._cp_orig_getUserProfile)) {
                const origGetProfile = UPS.getUserProfile.bind(UPS);
                UPS._cp_orig_getUserProfile = origGetProfile;
                UPS.getUserProfile = (userId: string) => {
                    try {
                        const profile = origGetProfile(userId);
                        if (!userId) return profile;

                        if (isEnabled && isMe(userId) && profile) {
                            return this.hookUserProfile(profile);
                        }

                        if (LarpSettings.seeAllCustomProfile) {
                            fetchPublicProfileIfNeeded(userId);
                            const cached = publicProfilesCache.get(userId);
                            if (cached?.fetched && cached.data && profile) {
                                return this.hookOtherUserProfile(profile, cached.data);
                            }
                        }

                        return profile;
                    } catch (e) {
                        console.error("[LarpCord] Error in getUserProfile hook:", e);
                        return origGetProfile(userId);
                    }
                };
                const origGetGuild = UPS.getGuildMemberProfile.bind(UPS);
                UPS._cp_orig_getGuildMemberProfile = origGetGuild;
                UPS.getGuildMemberProfile = (userId: string, guildId: string) => {
                    try {
                        const profile = origGetGuild(userId, guildId);
                        if (!userId) return profile;

                        if (isEnabled && isMe(userId) && profile) {
                            return this.hookUserProfile(profile);
                        }

                        if (LarpSettings.seeAllCustomProfile) {
                            fetchPublicProfileIfNeeded(userId);
                            const cached = publicProfilesCache.get(userId);
                            if (cached?.fetched && cached.data && profile) {
                                return this.hookOtherUserProfile(profile, cached.data);
                            }
                        }

                        return profile;
                    } catch (e) {
                        console.error("[LarpCord] Error in getGuildMemberProfile hook:", e);
                        return origGetGuild(userId, guildId);
                    }
                };
                UPS._cp_profile_hook = true;
            }
        } catch { }

        try {
            const WP = (Vencord as any).Webpack;
            const MAS = WP?.findByProps?.("getUsers", "getValidUsers", "getHasLoggedInAccounts");
            if (MAS && !MAS._cp_perfect_hook) {
                function patchAccountUser(u: any) {
                    if (!u?.id) return u;
                    const acctData = allAccountsData[u.id];
                    const acctEnabled = allAccountsEnabled[u.id];
                    if (!acctData || !acctEnabled) return u;
                    const patched: any = { ...u };
                    if (acctData.username) patched.username = acctData.username;
                    if (acctData.globalName) patched.globalName = acctData.globalName;
                    return patched;
                }

                if (MAS.getUsers) {
                    const origGetUsers = MAS.getUsers.bind(MAS);
                    MAS.getUsers = () => {
                        const users = origGetUsers();
                        if (!users || !Array.isArray(users)) return users;
                        return users.map(patchAccountUser);
                    };
                }

                if (MAS.getValidUsers) {
                    const origGetValid = MAS.getValidUsers.bind(MAS);
                    MAS.getValidUsers = () => {
                        const users = origGetValid();
                        if (!users || !Array.isArray(users)) return users;
                        return users.map(patchAccountUser);
                    };
                }

                MAS._cp_perfect_hook = true;
                try { MAS.emitChange?.(); } catch { }
            }
        } catch { }

        try {
            if (SnowflakeUtils?.extractTimestamp && !this._origExtractTimestamp) {
                this._origExtractTimestamp = SnowflakeUtils.extractTimestamp;
                const origExtract = this._origExtractTimestamp;
                (SnowflakeUtils as any).extractTimestamp = (snowflake: string) => {
                    if (isEnabled && storedData.createdAt && isMe(snowflake)) {
                        return new Date(storedData.createdAt + "T12:00:00Z").getTime();
                    }
                    if (LarpSettings.seeAllCustomProfile) {
                        const cached = publicProfilesCache.get(snowflake);
                        if (cached?.fetched && cached.data?.createdAt) {
                            return new Date(cached.data.createdAt + "T12:00:00Z").getTime();
                        }
                    }
                    return origExtract(snowflake);
                };
            }
        } catch { }

        loadData().then(() => {
            updateCachedRealData();
            if (!_avatarPatchApplied) {
                applyAvatarPatchEarly();
            } else {
            }
            if (isEnabled) {
                forceAccountPanelRerender();
                requestAnimationFrame(() => removeHideStyle());
            } else {
                removeHideStyle();
            }
        });

        try {
            const decoMod = (Vencord as any).Webpack?.findByProps?.("getAvatarDecorationURL");
            if (decoMod?.getAvatarDecorationURL) {
                const origDeco = decoMod.getAvatarDecorationURL.bind(decoMod);
                decoMod.getAvatarDecorationURL = (opts: any) => {
                    try {
                        const { avatarDecoration, userId, canAnimate } = opts ?? {};

                        if (isEnabled && storedData.decorationAsset) {
                            const storedAsset = getString(storedData.decorationAsset);
                            const myId = UserStore.getCurrentUser()?.id;
                            const isOurs = (avatarDecoration?.skuId === "__fake__")
                                || (avatarDecoration?.asset === storedAsset)
                                || (userId && userId === myId);
                            if (isOurs && storedAsset) {
                                const asset = storedAsset;
                                const dec = AVATAR_DECORATIONS.find(d => d.id === asset);
                                const passthrough = dec ? (dec as any).passthrough : asset.startsWith("a_");
                                return getDecorationUrl(asset, passthrough);
                            }
                        }

                        if (LarpSettings.seeAllCustomProfile && userId) {
                            const cached = publicProfilesCache.get(userId);
                            if (cached?.fetched && cached.data?.decorationAsset) {
                                const asset = getString(cached.data.decorationAsset);
                                if (asset) {
                                    const dec = AVATAR_DECORATIONS.find(d => d.id === asset);
                                    const passthrough = dec ? (dec as any).passthrough : asset.startsWith("a_");
                                    return getDecorationUrl(asset, passthrough);
                                }
                            }
                        }
                    } catch { }
                    return origDeco(opts);
                };
            }
        } catch { }

        if (!_avatarPatchApplied) {
            applyAvatarPatchEarly();
        }

        try {
            const GMS = (Vencord as any).Webpack?.findByProps?.("getMember", "getMembers", "getMemberIds");
            if (GMS?.getMember && !GMS._cp_member_hook) {
                const _origGetMember = GMS.getMember.bind(GMS);
                GMS.getMember = (guildId: string, userId: string) => {
                    const member = _origGetMember(guildId, userId);
                    try {
                        const myId = UserStore.getCurrentUser()?.id;
                        if (isEnabled && userId === myId && member) {
                            const customNick = storedData.globalName || storedData.username;
                            if (customNick) {
                                return { ...member, nick: customNick };
                            }
                        }
                    } catch { }
                    return member;
                };
                GMS._cp_member_hook = true;
                GMS._cp_orig_getMember = _origGetMember;
            }
        } catch { }
    },

    userProfileBadges: [
        {
            getBadges({ userId, badges: nativeBadges }: { userId: string; guildId: string; badges: ProfileBadge[]; }) {
                const style = { borderRadius: "50%", width: "22px", height: "22px" };

                const isCurrentUser = userId === UserStore.getCurrentUser()?.id;
                if (!isCurrentUser) {
                    if (!LarpSettings.seeAllCustomProfile) return nativeBadges || [];
                    const cached = publicProfilesCache.get(userId);
                    if (!cached?.fetched || !cached.data) return nativeBadges || [];
                    const d = cached.data;

                    const badges: ProfileBadge[] = [...(nativeBadges || [])].filter(b => {
                        const desc = (b.description || "").toLowerCase();
                        const icon = (b.iconSrc || "").toLowerCase();
                        const nitroKw = ["nitro", "subscriber", "abonn", "premium", "inscrit"];
                        if (nitroKw.some(k => desc.includes(k))) return false;
                        if (icon.includes("nitro") || icon.includes("premium")) return false;
                        const boostKw = ["booster", "boost"];
                        if (boostKw.some(k => desc.includes(k))) return false;
                        if (icon.includes("boost") || icon.includes("leveling")) return false;
                        return true;
                    });

                    const extra: any[] = [];
                    const wantedFlags = d.badgeFlags ?? 0;
                    for (const badge of BADGES) {
                        if (wantedFlags & badge.flag) {
                            extra.push({ description: badge.label, iconSrc: badge.icon, position: 0, props: { style } });
                        }
                    }
                    const nl = d.nitroLevel ?? -1;
                    if (nl >= 0 && nl < NITRO_LEVELS.length) {
                        extra.push({ description: "Nitro", iconSrc: NITRO_LEVELS[nl].icon, position: 0, props: { style } });
                    }
                    const bm = d.boostMonths ?? -1;
                    if (bm >= 0 && bm < BOOST_ICONS.length) {
                        extra.push({ description: `Server Booster \u2014 ${BOOST_LABELS[bm]}`, iconSrc: BOOST_ICONS[bm], position: 0, props: { style } });
                    }
                    if (d.customBadgeIds?.includes("quest")) extra.push({ description: "Completed a quest", iconSrc: "https://cdn.discordapp.com/badge-icons/7d9ae358c8c5e118768335dbe68b4fb8.png", position: 0, props: { style } });
                    if (d.customBadgeIds?.includes("orbs")) extra.push({ description: "Orbs \u2014 Apprentice", iconSrc: "https://cdn.discordapp.com/badge-icons/83d8a1eb09a8d64e59233eec5d4d5c2d.png", position: 0, props: { style } });
                    if (d.customBadgeIds?.includes("oldname")) {
                        const oldNameText = d.oldName ? `Old username: ${d.oldName}` : "Old username";
                        extra.push({ description: oldNameText, iconSrc: OLD_NAME_BADGE_ICON, position: 0, props: { style } });
                    }
                    badges.push(...extra);
                    return withBadgeIds(badges);
                }

                if (!isEnabled) return nativeBadges || [];

                let badges: ProfileBadge[] = [...(nativeBadges || [])];

                const nl = storedData.nitroLevel ?? -1;
                const bm = storedData.boostMonths ?? -1;
                const hasNitroFake = nl >= 0 && nl < NITRO_LEVELS.length;
                const hasBoostFake = bm >= 0 && bm < BOOST_ICONS.length;
                const wantedFlags = storedData.badgeFlags ?? 0;

                badges = badges.filter(b => {
                    const desc = (b.description || "").toLowerCase();
                    const icon = (b.iconSrc || "").toLowerCase();

                    if (isEnabled) {
                        const nitroKeywords = ["nitro", "subscriber", "abonn", "premium", "inscrit"];
                        if (nitroKeywords.some(k => desc.includes(k))) return false;
                        if (icon.includes("nitro") || icon.includes("premium")) return false;

                        const boostKeywords = ["booster", "boost"];
                        if (boostKeywords.some(k => desc.includes(k))) return false;
                        if (icon.includes("boost") || icon.includes("leveling")) return false;
                    }
                    for (const badge of BADGES) {
                        if (wantedFlags & badge.flag) {
                            const iconParts = badge.icon.split("/");
                            const iconHash = iconParts[iconParts.length - 1].replace(".png", "");
                            if (icon.includes(iconHash)) return false;
                            const badgeKeywords = badge.label.toLowerCase().split(" ");
                            if (badgeKeywords.some(k => k.length > 3 && desc.includes(k))) return false;
                        }
                    }

                    return true;
                });

                const badgeList: any[] = [];

                if (storedData.badgeFlags && (storedData.badgeFlags & FLAG.STAFF)) {
                    badgeList.push({ description: t("Staff Discord"), iconSrc: "https://cdn.discordapp.com/badge-icons/5e74e9b61934fc1f67c65515d1f7e60d.png", position: 0, props: { style } });
                }

                if (storedData.badgeFlags && (storedData.badgeFlags & FLAG.PARTNER)) {
                    badgeList.push({ description: t("Partner"), iconSrc: "https://cdn.discordapp.com/badge-icons/3f9748e53446a137a052f3454e2de41e.png", position: 0, props: { style } });
                }

                if (hasNitroFake) {
                    badgeList.push({ description: "NITRO\nSubscribed since 10/22/21", iconSrc: NITRO_LEVELS[nl].icon, position: 0, props: { style, title: "Nitro" } });
                }

                if (storedData.badgeFlags && (storedData.badgeFlags & FLAG.HYPESQUAD)) {
                    badgeList.push({ description: t("HypeSquad Events"), iconSrc: "https://cdn.discordapp.com/badge-icons/bf01d1073931f921909045f3a39fd264.png", position: 0, props: { style } });
                }

                if (storedData.badgeFlags && (storedData.badgeFlags & FLAG.BUG_HUNTER_2)) {
                    badgeList.push({ description: t("Bug Hunter Lvl 2"), iconSrc: "https://cdn.discordapp.com/badge-icons/848f79194d4be5ff5f81505cbd0ce1e6.png", position: 0, props: { style } });
                }

                if (storedData.badgeFlags && (storedData.badgeFlags & FLAG.BALANCE)) {
                    badgeList.push({ description: t("HypeSquad Balance"), iconSrc: "https://cdn.discordapp.com/badge-icons/3aa41de486fa12454c3761e8e223442e.png", position: 0, props: { style } });
                }
                if (storedData.badgeFlags && (storedData.badgeFlags & FLAG.BRAVERY)) {
                    badgeList.push({ description: t("HypeSquad Bravery"), iconSrc: "https://cdn.discordapp.com/badge-icons/8a88d63823d8a71cd5e390baa45efa02.png", position: 0, props: { style } });
                }
                if (storedData.badgeFlags && (storedData.badgeFlags & FLAG.BRILLIANCE)) {
                    badgeList.push({ description: t("HypeSquad Brilliance"), iconSrc: "https://cdn.discordapp.com/badge-icons/011940fd013da3f7fb926e4a1cd2e618.png", position: 0, props: { style } });
                }

                if (storedData.badgeFlags && (storedData.badgeFlags & FLAG.BUG_HUNTER_1)) {
                    badgeList.push({ description: t("Bug Hunter Lvl 1"), iconSrc: "https://cdn.discordapp.com/badge-icons/2717692c7dca7289b35297368a940dd0.png", position: 0, props: { style } });
                }

                if (storedData.badgeFlags && (storedData.badgeFlags & FLAG.DEV_VERIFIED)) {
                    badgeList.push({ description: t("Verified Developer"), iconSrc: "https://cdn.discordapp.com/badge-icons/6df5892e0f35b051f8b61eace34f4967.png", position: 0, props: { style } });
                }

                if (storedData.badgeFlags && (storedData.badgeFlags & FLAG.MOD_ALUMNI)) {
                    badgeList.push({ description: t("Former Moderator"), iconSrc: "https://cdn.discordapp.com/badge-icons/fee1624003e2fee35cb398e125dc479b.png", position: 0, props: { style } });
                }

                if (storedData.badgeFlags && (storedData.badgeFlags & FLAG.EARLY_SUPPORTER)) {
                    badgeList.push({ description: t("Early Supporter"), iconSrc: "https://cdn.discordapp.com/badge-icons/7060786766c9c840eb3019e725d2b358.png", position: 0, props: { style } });
                }

                if (hasBoostFake) {
                    badgeList.push({ description: `Server Booster — ${BOOST_LABELS[bm]}`, iconSrc: BOOST_ICONS[bm], position: 0, props: { style, title: `Server Booster — ${BOOST_LABELS[bm]}` } });
                }

                if (storedData.badgeFlags && (storedData.badgeFlags & FLAG.ACTIVE_DEVELOPER)) {
                    badgeList.push({ description: t("Active Developer"), iconSrc: "https://cdn.discordapp.com/badge-icons/6bdc42827a38498929a4920da12695d9.png", position: 0, props: { style } });
                }

                if (storedData.customBadgeIds?.includes("oldname")) {
                    const oldNameText = storedData.oldName ? `Old username\u00a0: ${storedData.oldName}` : "Old username";
                    badgeList.push({ description: oldNameText, iconSrc: OLD_NAME_BADGE_ICON, position: 0, props: { style, title: oldNameText } });
                }

                if (storedData.customBadgeIds?.includes("quest")) {
                    badgeList.push({ description: "Completed a quest", iconSrc: "https://cdn.discordapp.com/badge-icons/7d9ae358c8c5e118768335dbe68b4fb8.png", position: 0, props: { style } });
                }

                if (storedData.customBadgeIds?.includes("orbs")) {
                    badgeList.push({ description: "Orbs — Apprentice", iconSrc: "https://cdn.discordapp.com/badge-icons/83d8a1eb09a8d64e59233eec5d4d5c2d.png", position: 0, props: { style } });
                }

                badges.push(...badgeList);
                return withBadgeIds(badges);
            }
        } as ProfileBadge
    ] as ProfileBadge[],

    stop() {
        removeContextMenuPatch("user-context", userContextMenuPatch);
        FluxDispatcher.unsubscribe("CONNECTION_OPEN", onAccountSwitch);
        stopDomObserver();
        removeHideStyle();
        if (this._origExtractTimestamp && SnowflakeUtils) {
            (SnowflakeUtils as any).extractTimestamp = this._origExtractTimestamp;
            this._origExtractTimestamp = null;
        }
        if (this._origGetUserAvatarURL && IconUtils) {
            (IconUtils as any).getUserAvatarURL = this._origGetUserAvatarURL;
            this._origGetUserAvatarURL = null;
        }
        try {
            const GMS = (Vencord as any).Webpack?.findByProps?.("getMember", "getMembers", "getMemberIds");
            if (GMS?._cp_member_hook) {
                if (GMS._cp_orig_getMember) GMS.getMember = GMS._cp_orig_getMember;
                delete GMS._cp_member_hook;
                delete GMS._cp_orig_getMember;
            }
        } catch { }
        try {
            const UPS = (Vencord as any).Webpack?.findByProps?.("getUserProfile", "getGuildMemberProfile");
            if (UPS?._cp_profile_hook) {
                if (UPS._cp_orig_getUserProfile) UPS.getUserProfile = UPS._cp_orig_getUserProfile;
                if (UPS._cp_orig_getGuildMemberProfile) UPS.getGuildMemberProfile = UPS._cp_orig_getGuildMemberProfile;
                delete UPS._cp_profile_hook;
                delete UPS._cp_orig_getUserProfile;
                delete UPS._cp_orig_getGuildMemberProfile;
            }
        } catch { }
        try {
            const myUser = UserStore.getCurrentUser() as any;
            if (myUser) {
                try { delete myUser.avatarDecoration; } catch { }
                try { delete myUser.avatarDecorationData; } catch { }
            }
        } catch { }
    },

    settingsAboutComponent() {
        return <Button onClick={() => openModal(props => <CustomProfileModal rootProps={props} />)}>Open LarpCord</Button>;
    },
});
