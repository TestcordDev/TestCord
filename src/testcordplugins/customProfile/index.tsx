/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { ProfileBadge } from "@api/Badges";
import { addContextMenuPatch, NavContextMenuPatchCallback, removeContextMenuPatch } from "@api/ContextMenu";
import { addHeaderBarButton, HeaderBarButton, removeHeaderBarButton } from "@api/HeaderBar";
import { DataStore } from "@api/index";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { AuthenticationStore, Button, FluxDispatcher, IconUtils, Menu, PresenceStore, React, Select, SnowflakeUtils, Tooltip, UserStore } from "@webpack/common";
import virtualMerge from "virtual-merge";

import { t } from "../autoTranslateNightcord";

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
    { label: t("Owner of a partner server"), flag: FLAG.PARTNER, icon: "https://cdn.discordapp.com/badge-icons/3f9748e53446a137a052f3454e2de41e.png" },
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
    { label: t("Nitro (0 mois)"), icon: "https://cdn.discordapp.com/badge-icons/2ba85e8026a8614b640c2837bcdfe21b.png" },
    { label: t("Bronze (1 mois)"), icon: "https://cdn.discordapp.com/badge-icons/4f33c4a9c64ce221936bd256c356f91f.png" },
    { label: t("Argent (2 mois)"), icon: "https://cdn.discordapp.com/badge-icons/4514fab914bdbfb4ad2fa23df76121a6.png" },
    { label: t("Or (3 mois)"), icon: "https://cdn.discordapp.com/badge-icons/2895086c18d5531d499862e41d1155a6.png" },
    { label: t("Platine (6 mois)"), icon: "https://cdn.discordapp.com/badge-icons/0334688279c8359120922938dcb1d6f8.png" },
    { label: t("Diamant (12 mois)"), icon: "https://cdn.discordapp.com/badge-icons/0d61871f72bb9a33a7ae568c1fb4f20a.png" },
    { label: t("Emerald (24 months)"), icon: "https://cdn.discordapp.com/badge-icons/11e2d339068b55d3a506cff34d3780f3.png" },
    { label: t("Rubis (36 mois)"), icon: "https://cdn.discordapp.com/badge-icons/cd5e2cfd9d7f27a8cdcd3e8a8d5dc9f4.png" },
    { label: t("Opale (72 mois)"), icon: "https://cdn.discordapp.com/badge-icons/5b154df19c53dce2af92c9b61e6be5e2.png" },
];

function makeBoostDate(userId: string, boostMonthsIndex: number): Date {
    const BOOST_M = [1, 2, 3, 6, 9, 12, 15, 18, 24];
    const totalMonths = BOOST_M[boostMonthsIndex] ?? 1;
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
        hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0;
    }
    const seed = Math.abs(hash);
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth() - totalMonths, 1);
    const maxDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(((seed % maxDay) + 1));
    return target;
}

function makeNitroDate(userId: string, nitroMonthsIndex: number): Date {
    const NITRO_M = [1, 2, 3, 6, 12, 24, 36, 72];
    const totalMonths = NITRO_M[nitroMonthsIndex] ?? 1;
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
        hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0;
    }
    const seed = Math.abs(hash) + 7;
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth() - totalMonths, 1);
    const maxDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(((seed % maxDay) + 1));
    return target;
}

const BOOST_LABELS_RAW = [
    "1 Mois", "2 Mois", "3 Mois", "6 Mois",
    "9 Mois", "12 Mois", "15 Mois", "18 Mois", "24 Mois"
];
const BOOST_LABELS = BOOST_LABELS_RAW.map(l => t(l));
const BOOST_MONTHS = [1, 2, 3, 6, 9, 12, 15, 18, 24];
const BOOST_ICONS = [
    "https://cdn.discordapp.com/badge-icons/51040c70d4f20a921ad6674ff86fc95c.png", // 1 mois
    "https://cdn.discordapp.com/badge-icons/0e4080d1d333bc7ad29ef6528b6f2fb7.png", // 2 mois
    "https://cdn.discordapp.com/badge-icons/72bed924410c304dbe3d00a6e593ff59.png", // 3 mois
    "https://cdn.discordapp.com/badge-icons/df199d2050d3ed4ebf84d64ae83989f8.png", // 6 mois
    "https://cdn.discordapp.com/badge-icons/996b3e870e8a22ce519b3a50e6bdd52f.png", // 9 mois
    "https://cdn.discordapp.com/badge-icons/991c9f39ee33d7537d9f408c3e53141e.png", // 12 mois
    "https://cdn.discordapp.com/badge-icons/cb3ae83c15e970e8f3d410bc62cb8b99.png", // 15 mois
    "https://cdn.discordapp.com/badge-icons/7142225d31238f6387d9f09efaa02759.png", // 18 mois
    "https://cdn.discordapp.com/badge-icons/ec92202290b48d0879b7413d2dde3bab.png", // 24 mois
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

const NITRO_TIER_NAMES_EN = ["", "Bronze", "Silver", "Gold", "Platinum", "Diamond", "Emerald", "Ruby", "Opal"];

function getDecorationUrl(assetId: string, animated = false): string {
    return `https://cdn.discordapp.com/media/v1/collectibles-shop/${assetId}/${animated ? "animated" : "static"}`;
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
    copiedUserId?: string;
}

const LS_KEY_DATA = "NightcordCP_data";
const LS_KEY_ENABLED = "NightcordCP_enabled";
const DS_ALL_DATA = "customProfile_allData";
const DS_ALL_ENABLED = "customProfile_allEnabled";
const LS_ALL_DATA = "NightcordCP_allData";
const LS_ALL_ENABLED = "NightcordCP_allEnabled";

let storedData: CustomProfileData = {};
let isEnabled = false;
let domObserver: ReturnType<typeof setInterval> | null = null;

let cachedOriginalUser: any = null;
let cachedFakeUser: any = null;
let cachedDataHash: number = 0;
let _trueOriginalUser: any = null;
let _dataVersion: number = 0;
let allAccountsData: Record<string, CustomProfileData> = {};
let allAccountsEnabled: Record<string, boolean> = {};

const _patchRestores: Array<() => void> = [];

let originalGetStatus: typeof PresenceStore.getStatus | null = null;
let originalGetClientStatus: typeof PresenceStore.getClientStatus | null = null;
let originalGetActivities: typeof PresenceStore.getActivities | null = null;
let originalGetPrimaryActivity: typeof PresenceStore.getPrimaryActivity | null = null;
let originalGetUnfilteredActivities: typeof PresenceStore.getUnfilteredActivities | null = null;
let originalFindActivity: typeof PresenceStore.findActivity | null = null;
let originalGetApplicationActivity: typeof PresenceStore.getApplicationActivity | null = null;
let presencePatched = false;

function patchPresence() {
    if (presencePatched) return;
    presencePatched = true;

    originalGetStatus = PresenceStore.getStatus;
    originalGetClientStatus = PresenceStore.getClientStatus;
    originalGetActivities = PresenceStore.getActivities;
    originalGetPrimaryActivity = PresenceStore.getPrimaryActivity;
    originalGetUnfilteredActivities = PresenceStore.getUnfilteredActivities;
    originalFindActivity = PresenceStore.findActivity;
    originalGetApplicationActivity = PresenceStore.getApplicationActivity;

    PresenceStore.getStatus = function (userId: string, guildId?: string | null, defaultStatus?: any): any {
        if (isEnabled && isMe(userId)) return undefined as any;
        return originalGetStatus!.call(this, userId, guildId, defaultStatus);
    };

    PresenceStore.getClientStatus = function (userId: string): any {
        if (isEnabled && isMe(userId)) return undefined as any;
        return originalGetClientStatus!.call(this, userId);
    };

    PresenceStore.getActivities = function (userId: string, guildId?: string): any {
        if (isEnabled && isMe(userId)) return [] as any;
        return originalGetActivities!.call(this, userId, guildId);
    };

    PresenceStore.getPrimaryActivity = function (userId: string, guildId?: string): any {
        if (isEnabled && isMe(userId)) return undefined as any;
        return originalGetPrimaryActivity!.call(this, userId, guildId);
    };

    PresenceStore.getUnfilteredActivities = function (userId: string, guildId?: string): any {
        if (isEnabled && isMe(userId)) return [] as any;
        return originalGetUnfilteredActivities!.call(this, userId, guildId);
    };

    PresenceStore.findActivity = function (userId: string, predicate: any, guildId?: string): any {
        if (isEnabled && isMe(userId)) return undefined as any;
        return originalFindActivity!.call(this, userId, predicate, guildId);
    };

    PresenceStore.getApplicationActivity = function (userId: string, applicationId: string, guildId?: string): any {
        if (isEnabled && isMe(userId)) return undefined as any;
        return originalGetApplicationActivity!.call(this, userId, applicationId, guildId);
    };
}

function unpatchPresence() {
    if (!presencePatched) return;
    if (originalGetStatus) PresenceStore.getStatus = originalGetStatus;
    if (originalGetClientStatus) PresenceStore.getClientStatus = originalGetClientStatus;
    if (originalGetActivities) PresenceStore.getActivities = originalGetActivities;
    if (originalGetPrimaryActivity) PresenceStore.getPrimaryActivity = originalGetPrimaryActivity;
    if (originalGetUnfilteredActivities) PresenceStore.getUnfilteredActivities = originalGetUnfilteredActivities;
    if (originalFindActivity) PresenceStore.findActivity = originalFindActivity;
    if (originalGetApplicationActivity) PresenceStore.getApplicationActivity = originalGetApplicationActivity;
    presencePatched = false;
}

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
        const rawAll = localStorage.getItem(LS_ALL_DATA);
        if (rawAll) {
            try { allAccountsData = JSON.parse(rawAll); } catch { allAccountsData = {}; }
            const rawEnabled = localStorage.getItem(LS_ALL_ENABLED);
            try { allAccountsEnabled = rawEnabled ? JSON.parse(rawEnabled) : {}; } catch { allAccountsEnabled = {}; }
            syncCurrentUserData();
            if (!storedData || Object.keys(storedData).length === 0) {
                const rawOld = localStorage.getItem(LS_KEY_DATA);
                const enOld = localStorage.getItem(LS_KEY_ENABLED);
                if (rawOld) {
                    try { storedData = JSON.parse(rawOld); } catch { storedData = {}; }
                    isEnabled = enOld === "1";
                }
            }
            return;
        }
        const raw = localStorage.getItem(LS_KEY_DATA);
        const en = localStorage.getItem(LS_KEY_ENABLED);
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
function applyAvatarPatchEarly() {
    if (_avatarPatchApplied || !isEnabled || !storedData.avatar) return;
    try {
        const IU = (window as any).Vencord?.Webpack?.findByProps?.("getUserAvatarURL");
        if (!IU?.getUserAvatarURL) return;
        const orig = IU.getUserAvatarURL;
        IU.getUserAvatarURL = function (user: any, ...args: any[]) {
            if (isEnabled && storedData.avatar) {
                const uid = user?.id ?? user?.userId;
                if (uid && isMe(uid)) return storedData.avatar;
            }
            return orig(user, ...args);
        };
        _patchRestores.push(() => {
            IU.getUserAvatarURL = orig;
            _avatarPatchApplied = false;
        });
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

async function copyUserProfile(userId: string) {
    try {
        const user = UserStore.getUser(userId) as any;
        if (!user) return;

        const { findByProps } = await import("@webpack") as any;
        const UserProfileStore = findByProps("getUserProfile", "getGuildMemberProfile") as any;
        const IU = IconUtils as any;
        const profile = UserProfileStore?.getUserProfile?.(userId) ?? {};

        const newData: CustomProfileData = {
            username: user.username || "",
            globalName: user.globalName || "",
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
            createdAt: undefined,
            copiedUserId: userId
        };

        if (user.bio !== undefined) newData.bio = user.bio || "";
        if (profile.bio !== undefined) newData.bio = profile.bio || "";

        try {
            const avatarUrl = IU?.getUserAvatarURL?.(user, false, 512)
                ?? (user.avatar ? `https://cdn.discordapp.com/avatars/${userId}/${user.avatar}.${user.avatar.startsWith("a_") ? "gif" : "png"}?size=512` : null);
            if (avatarUrl) newData.avatar = avatarUrl;
        } catch { }

        const hasNitro = (profile.premiumType ?? 0) > 0;
        newData.nitro = hasNitro;

        if (hasNitro) {
            const premiumSince = profile.premiumSince ?? user.premiumSince ?? null;
            const pTs = new Date(premiumSince).getTime();
            if (!isNaN(pTs)) {
                const months = Math.floor((Date.now() - pTs) / (1000 * 60 * 60 * 24 * 30));
                if (months >= 72) newData.nitroLevel = 8;
                else if (months >= 36) newData.nitroLevel = 7;
                else if (months >= 24) newData.nitroLevel = 6;
                else if (months >= 12) newData.nitroLevel = 5;
                else if (months >= 6) newData.nitroLevel = 4;
                else if (months >= 3) newData.nitroLevel = 3;
                else if (months >= 2) newData.nitroLevel = 2;
                else if (months >= 1) newData.nitroLevel = 1;
                else newData.nitroLevel = 0;
            } else {
                newData.nitroLevel = 0;
            }
        }

        const boostSince = profile.premiumGuildSince ?? null;
        if (boostSince) {
            const bTs = new Date(boostSince).getTime();
            if (!isNaN(bTs)) {
                const bMonths = Math.floor((Date.now() - bTs) / (1000 * 60 * 60 * 24 * 30));
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
        }

        const bannerId = profile.banner ?? user.banner ?? null;
        if (bannerId) newData.banner = `https://cdn.discordapp.com/banners/${userId}/${bannerId}.${bannerId.startsWith("a_") ? "gif" : "png"}?size=512`;

        if (profile.accentColor !== undefined) newData.accentColor = profile.accentColor;
        else if (user.accentColor !== undefined) newData.accentColor = user.accentColor;

        try {
            const ms = Number(BigInt(userId) >> 22n) + 1420070400000;
            newData.createdAt = new Date(ms).toISOString().slice(0, 10);
        } catch { }

        try {
            const flags = user.publicFlags ?? 0;
            let badgeFlags = 0;
            for (const { flag } of BADGES) { if (flags & flag) badgeFlags |= flag; }
            newData.badgeFlags = badgeFlags;
            if (user.avatarDecorationData?.asset) newData.decorationAsset = user.avatarDecorationData.asset;
        } catch { }

        newData.copiedUserId = userId;
        storedData = newData;
        isEnabled = true;
        saveDataSync(newData, true);
        DataStore.set(DS_ALL_DATA, allAccountsData).catch(() => { });
        DataStore.set(DS_ALL_ENABLED, allAccountsEnabled).catch(() => { });

        forceAccountPanelRerender();
    } catch (err) {
        console.error("[CustomProfile] copyUserProfile error:", err);
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
                        label={t("Remove copy profile")}
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
                                console.error("[CustomProfile] Error removing copy:", e);
                            }
                        }}
                    />
                ) : (
                    <Menu.MenuItem
                        id="copy-user-profile"
                        label={t("Copy this profile")}
                        action={() => copyUserProfile(user.id)}
                    />
                )}
            </Menu.MenuGroup>
        );
    } catch (err) {
        console.error("[CustomProfile] Context menu patch error:", err);
    }
};

function getRealNames(): { username: string | null; globalName: string | null; } {
    try {
        const u = UserStore.getCurrentUser();
        return { username: u?.username ?? null, globalName: u?.globalName ?? null };
    } catch { return { username: null, globalName: null }; }
}

let _realDateKey: string | null = null;
let _realDateVariants: string[] = [];
function getRealDateVariants(): string[] {
    try {
        const u = UserStore.getCurrentUser();
        if (!u?.id) return [];
        if (u.id === _realDateKey) return _realDateVariants;
        _realDateKey = u.id;
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
        variants.add(year.toString()); _realDateVariants = [...variants].filter(v => v.length >= 4); return _realDateVariants;
    } catch { return []; }
}

let _fakeDateKey: string | null = null;
let _fakeDateVariants: string[] = [];
function getFakeDateVariants(isoDate: string): string[] {
    try {
        if (isoDate === _fakeDateKey) return _fakeDateVariants;
        _fakeDateKey = isoDate;
        const d = new Date(isoDate + "T12:00:00Z");
        const variants = new Set<string>();
        const fmtSpecs: Intl.DateTimeFormatOptions[] = [
            { day: "numeric", month: "short", year: "numeric" },
            { day: "numeric", month: "long", year: "numeric" },
            { month: "short", day: "numeric", year: "numeric" },
            { month: "long", day: "numeric", year: "numeric" },
        ];
        for (const fmt of fmtSpecs) { try { variants.add(new Intl.DateTimeFormat(navigator.language, fmt).format(d)); } catch { } }
        _fakeDateVariants = [...variants];
        return _fakeDateVariants;
    } catch { return []; }
}

let _cachedMyId: string | null = null;
let _realUsername = "";
let _realGlobalName = "";
let customProfileGeneration = 0;

function updateCachedRealData() {
    try { const myId = AuthenticationStore?.getId?.(); if (myId) _cachedMyId = myId; } catch { }
}

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

// Walking every text node in the client is expensive, so only do it when there is
// actually a string to swap. With no fake name and no fake creation date configured
// the walk could never change anything, and it was still running every 5 seconds.
function hasTextReplacements(): boolean {
    if (storedData.createdAt) return true;
    if (storedData.username && _realUsername) return true;
    if (storedData.globalName && _realGlobalName) return true;
    return false;
}

function startDomObserver() {
    stopDomObserver(); if (!isEnabled) return;
    scanNode(document.body);
    domObserver = setInterval(() => {
        if (!isEnabled || !hasTextReplacements()) return;
        scanNode(document.body);
    }, 5000);
}

function stopDomObserver() {
    if (domObserver) { clearInterval(domObserver); domObserver = null; }
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

// Rich tooltip matching Discord's native Nitro badge popup (Image 1 style)
function NitroBadgeTooltip({ icon, tierName, dateStr }: { icon: string; tierName: string; dateStr: string; }) {
    const title = tierName ? `NITRO ${tierName.toUpperCase()}` : "NITRO";
    return (
        <Tooltip
            text={
                <div style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    textAlign: "center",
                    padding: "8px 12px",
                    gap: 2,
                }}>
                    <img
                        src={icon}
                        alt=""
                        style={{ width: 60, height: 60, objectFit: "contain", marginBottom: 4 }}
                    />
                    <div style={{
                        fontWeight: 700,
                        fontSize: 14,
                        letterSpacing: "0.06em",
                        lineHeight: 1.2,
                    }}>
                        {title}
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>
                        Subscriber since {dateStr}
                    </div>
                </div>
            }
        >
            {(tooltipProps: any) => (
                <img
                    {...tooltipProps}
                    src={icon}
                    alt={title}
                    style={{ borderRadius: "50%", width: "22px", height: "22px" }}
                />
            )}
        </Tooltip>
    );
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
                        // Reset boost when selecting nitro type manually if desired,
                        // but usually these are separate.
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

function forceAccountPanelRerender() {
    try {
        const WP = (Vencord as any).Webpack;
        const UserStore = WP?.findByStoreName("UserStore");
        if (UserStore && UserStore.emitChange) UserStore.emitChange();

        // Force UserProfileStore (side profile panel and popouts)
        const UPS = WP?.findByStoreName("UserProfileStore");
        if (UPS && UPS.emitChange) UPS.emitChange();

        // Force MultiAccountStore to re-notify the "Switch Account" switcher
        const MAS = WP?.findByProps?.("getUsers", "getValidUsers", "getHasLoggedInAccounts");
        if (MAS && MAS.emitChange) MAS.emitChange();

        // Dispatch local update without corrupting global store
        // Forces React to re-calculate useCurrentUser hooks
        FluxDispatcher.dispatch({ type: "USER_SETTINGS_PROTO_UPDATE", settings: { type: 1, proto: {} } });

        // Restart full DOM scan
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

    // Retrieve all connected accounts
    const accounts = React.useMemo(() => {
        try {
            // Attempt 1: via global MultiAccountStore
            const MAS = (window as any).Vencord?.Webpack?.findByProps?.("getUsers", "getValidUsers");
            if (MAS?.getUsers) {
                const users = MAS.getUsers();
                if (Array.isArray(users) && users.length > 0) return users;
            }

            // Attempt 2: via the internal store
            const internalStore = (window as any).Vencord?.Webpack?.findStore?.("MultiAccountStore");
            if (internalStore?.getUsers) {
                const users = internalStore.getUsers();
                if (Array.isArray(users) && users.length > 0) return users;
            }
        } catch (e) { console.error("[CustomProfile] Failed to fetch accounts:", e); }

        const me = UserStore.getCurrentUser();
        // For debug: if we only find one account, we still simulate to see if the bar displays
        return me ? [me, { ...me, id: "debug-placeholder", username: "Second Account?", globalName: "Simulation" }] : [];
    }, []);

    // When changing selected account, load its data
    React.useEffect(() => {
        const newData = allAccountsData[selectedAccountId] || {};
        setData({ ...newData });
    }, [selectedAccountId]);

    function set<K extends keyof CustomProfileData>(key: K, val: CustomProfileData[K]) {
        setData(d => ({ ...d, [key]: val }));
    }

    async function save() {
        try {
            setSaving(true);
            const savedData = { ...data };

            // Save in multi-accounts storage
            allAccountsData[selectedAccountId] = savedData;
            allAccountsEnabled[selectedAccountId] = true;

            // If it's the active account, update globals
            if (selectedAccountId === myId) {
                storedData = savedData;
                isEnabled = true;
                saveDataSync(storedData, true);
                cachedFakeUser = null;
                cachedOriginalUser = null;
                _dataVersion++;
            }

            // Save all in localStorage + IndexedDB
            saveAllDataSync();
            DataStore.set(DS_ALL_DATA, allAccountsData).catch(() => { });
            DataStore.set(DS_ALL_ENABLED, allAccountsEnabled).catch(() => { });

            updateCachedRealData();
            forceAccountPanelRerender();
        } catch (err) {
            console.error("[CustomProfile] save error:", err);
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

    return (
        <ModalRoot {...rootProps} size="medium">
            <ModalHeader separator={false}>
                <div className="cp-header">
                    <EditIcon size={16} />
                    <span className="cp-header-title">{t("Custom Profile")}</span>
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
                <ModalCloseButton onClick={rootProps.onClose} />
            </ModalHeader>
            <ModalContent className="cp-content">
                {/* Account selector bar removed since it's now a Select in the header */}
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
                        // Levels 1+ (Bronze to Opal) automatically enable Simulate Nitro
                        // Level 0 (Nitro without months) and None (-1) do not enable it
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
                    <button onClick={() => set("decorationAsset", undefined)}
                        className={`cp-badge ${!data.decorationAsset ? "cp-badge--on" : ""}`} style={{ minWidth: 60 }}>
                        {t("None")}
                    </button>
                    {AVATAR_DECORATIONS.map(dec => (
                        <button key={dec.id}
                            onClick={() => set("decorationAsset", data.decorationAsset === dec.id ? undefined : dec.id)}
                            className={`cp-badge ${data.decorationAsset === dec.id ? "cp-badge--on" : ""}`}
                            title={dec.label} style={{ padding: 3, lineHeight: 0, width: 52, height: 52, borderRadius: 6 }}>
                            <img src={getDecorationUrl(dec.id)} alt={dec.label}
                                style={{ width: 46, height: 46, objectFit: "contain", display: "block" }} />
                        </button>
                    ))}
                </div>
                <div className="cp-hint">{t("Visual and local modifications only — persistent between restarts.")}</div>
            </ModalContent>
            <ModalFooter className="cp-footer">
                <button className="cp-btn cp-btn-ghost" onClick={rootProps.onClose}>{t("Cancel")}</button>
                <button className="cp-btn cp-btn-danger" onClick={reset}><TrashIcon /><span>{t("Reset")}</span></button>
                <button className="cp-btn cp-btn-primary" onClick={save} disabled={saving}><SaveIcon /><span>{saving ? t("Saving...") : t("Save")}</span></button>
            </ModalFooter>
        </ModalRoot>
    );
}

function CustomProfileButton() {
    return <HeaderBarButton icon={() => <EditIcon size={18} />} tooltip="Custom Profile" onClick={() => openModal(props => <CustomProfileModal rootProps={props} />)} />;
}

function fakeUser(this: any, user: any): any {
    if (!user) return user;
    try {
        const uid = user?.id ?? user?.userId;
        if (!isMe(uid)) return user;
        return (this as any).fakeCurrentUser(user);
    } catch { return user; }
}

export default definePlugin({
    name: "CustomProfile",
    description: "Visually customize your Discord profile (username, PFP, banner, badges, bio...) — persistent, only visible to you.",
    tags: ["Appearance", "Nightcord"],
    authors: [{ name: "Nightcord", id: 0n }],
    dependencies: ["HeaderBarAPI", "ContextMenuAPI"],

    patches: [
        {
            find: ':"SHOULD_LOAD");',
            replacement: {
                match: /\i(?:\?)?.getPreviewBanner\(\i,\i,\i\)(?=.{0,100}"COMPLETE")/,
                replace: "$self.patchBannerUrl(arguments[0])||$&"
            }
        },
        // UserProfileStore patch removed — caused invisible channels for members
        // with high permissions. getUserProfile is called by Discord to calculate
        // VIEW_CHANNEL and other permissions. virtualMerge with premiumType:2 corrupted
        // these calculations even with isMe() guard. DomObserver + fakeCurrentUser are enough.
        {
            find: "DISPLAY_NAME",
            noWarn: true,
            replacement: {
                match: /(?<=currentUser:\i,user:)(\i)/,
                replace: "$self.fakeCurrentUser($1)"
            }
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
        }
    ],

    _copiedUserId: null as string | null,

    isCopiedUser(userId: string | null | undefined): boolean {
        if (!isEnabled || !userId || !this._copiedUserId) return false;
        return userId === this._copiedUserId;
    },

    fakeCurrentUser(user: any) {
        if (!user || (!isEnabled && this._forceNative !== true) || !isMe(user.id)) return user;

        // Fast cache: if same user + same data, return existing clone
        if (cachedOriginalUser === user && cachedFakeUser && cachedDataHash === _dataVersion) {
            return cachedFakeUser;
        }

        // Retrieve real original user (never a clone)
        const realUser = (user as any).__cp_isClone ? _trueOriginalUser || user : user;
        if (!realUser.__cp_isClone) _trueOriginalUser = realUser;

        // Read real values once
        const realUsername = realUser.__cp_isClone ? (realUser._realUsername || realUser.username) : realUser.username;
        const realGlobalName = realUser.__cp_isClone ? (realUser._realGlobalName ?? realUser.globalName) : realUser.globalName;
        const realDisplayName = realUser.__cp_isClone ? (realUser._realDisplayName ?? realUser.displayName) : realUser.displayName;

        const clone = Object.create(Object.getPrototypeOf(realUser));

        // Copy properties except username/globalName/displayName
        for (const key of Reflect.ownKeys(realUser)) {
            if (key === "username" || key === "globalName" || key === "displayName" || key === "__cp_isClone") continue;
            const desc = Object.getOwnPropertyDescriptor(realUser, key);
            if (desc) Object.defineProperty(clone, key, desc);
        }
        Object.defineProperty(clone, "__cp_isClone", { value: true, enumerable: false, configurable: true });
        // Store real values on clone for next cycles
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

        // Override createdAt: Discord calculates it from the Snowflake ID via a prototype getter
        // We redefine it directly on the clone so Discord displays the fake date
        // without needing to scan the DOM.
        if (storedData.createdAt) {
            const dateStr = storedData.createdAt.includes("T") ? storedData.createdAt : storedData.createdAt + "T12:00:00Z";
            const fakeCreatedAt = new Date(dateStr);
            if (!isNaN(fakeCreatedAt.getTime())) {
                Object.defineProperty(clone, "createdAt", {
                    get: () => fakeCreatedAt,
                    configurable: true,
                    enumerable: true
                });
            }
        }

        if (storedData.decorationAsset) {
            const decoData = {
                asset: storedData.decorationAsset,
                skuId: storedData.decorationAsset
            };
            clone.avatarDecoration = null;
            clone.avatarDecorationData = decoData;
        }

        // Override flags/nitro/boost so Discord doesn't show real native badges
        const wantedFlags = (isEnabled && storedData.badgeFlags != null) ? storedData.badgeFlags : realUser.publicFlags;
        clone.publicFlags = wantedFlags;
        clone.flags = wantedFlags;

        if (isEnabled && storedData.nitro) {
            clone.premiumType = 2;
            clone.premiumSince = makeNitroDate(realUser.id, storedData.nitroLevel ?? 0);

            const bm = storedData.boostMonths ?? -1;
            if (bm >= 0) {
                clone.premiumGuildSince = makeBoostDate(realUser.id, bm);
            } else {
                clone.premiumGuildSince = null;
            }
        } else if (isEnabled) {
            // If the plugin is enabled but Nitro simulation is OFF
            // Force removal of Nitro/Boost badges if requested or if simulated by mistake
            if (storedData.nitro === false) {
                clone.premiumType = 0;
                clone.premiumSince = null;
                clone.premiumGuildSince = null;
            }
        }

        // Save real values for next cloning cycle
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

    _cachedProfile: null as any,
    _cachedProfileInput: null as any,
    _cachedProfileVersion: 0,

    hookUserProfile(profile: any) {
        if (!profile || !isEnabled) return profile;
        // Cache: if same profile + same data version
        if (this._cachedProfileInput === profile && this._cachedProfile && this._cachedProfileVersion === _dataVersion) {
            return this._cachedProfile;
        }
        try {
            const merged: any = {};

            if (storedData.bio) merged.bio = storedData.bio;
            if (storedData.pronouns) merged.pronouns = storedData.pronouns;
            if (storedData.accentColor != null) merged.accentColor = storedData.accentColor;
            if (storedData.banner) merged.banner = storedData.banner;

            if (storedData.decorationAsset) {
                const decoData = {
                    asset: storedData.decorationAsset,
                    skuId: storedData.decorationAsset
                };
                merged.avatarDecoration = null;
                merged.avatarDecorationData = decoData;
            }

            if (isEnabled && (storedData.nitro || storedData.badgeFlags != null)) {
                merged.premiumType = storedData.nitro ? 2 : 0;

                if (storedData.nitro) {
                    if (storedData.accentColor != null) {
                        const c2 = storedData.accentColor2 ?? storedData.accentColor;
                        merged.themeColors = [storedData.accentColor, c2];
                    }
                    const nl = storedData.nitroLevel ?? 0;
                    merged.premiumSince = makeNitroDate(profile.userId, nl);

                    const bm = storedData.boostMonths ?? -1;
                    if (bm >= 0) {
                        merged.premiumGuildSince = makeBoostDate(profile.userId, bm);
                    } else {
                        merged.premiumGuildSince = null;
                    }
                } else {
                    merged.premiumSince = null;
                    merged.premiumGuildSince = null;
                }

                // Ensure that original badges are overwritten in the profile
                merged.publicFlags = (storedData.badgeFlags != null) ? storedData.badgeFlags : profile.publicFlags;
                merged.badges = []; // Force Discord to recalculate the list from publicFlags and premiumType
            } else if (isEnabled && storedData.nitro === false) {
                // If Nitro simulation is OFF, force removal of simulated badges
                merged.premiumType = profile.premiumType ?? 0;
                merged.premiumSince = profile.premiumSince ?? null;
                merged.premiumGuildSince = profile.premiumGuildSince ?? null;
            } else {
                // BACKPORT FIX : Never force to 0 or null if Nitro is not simulated.
                if (profile.premiumType) merged.premiumType = profile.premiumType;
                if (profile.premiumSince) merged.premiumSince = profile.premiumSince;
                if (profile.premiumGuildSince) merged.premiumGuildSince = profile.premiumGuildSince;
            }

            const result = virtualMerge(profile, merged);
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
        // Discord often expects to see s***@d***.com format
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

    patchBannerUrl({ displayProfile }: any) {
        if (!isEnabled || !storedData.nitro || !storedData.banner) return null;
        try { return isMe(displayProfile?.userId) ? storedData.banner : null; } catch { return null; }
    },

    toolboxActions: {
        [t("Open Custom Profile")]() { openModal(props => <CustomProfileModal rootProps={props} />); },
    },

    _origGetUserAvatarURL: null as any,
    _origExtractTimestamp: null as any,
    _forceNative: false, // Tool variable for local reset

    async start() {
        const generation = ++customProfileGeneration;
        applyAvatarPatchEarly();
        patchPresence();
        addHeaderBarButton("custom-profile-btn", () => <CustomProfileButton />, 10);
        addContextMenuPatch("user-context", userContextMenuPatch);

        // Listen for account changes to sync data
        FluxDispatcher.subscribe("CONNECTION_OPEN", onAccountSwitch);

        // PERFECT AND SECURE NATIVE INTERCEPTION ON USER STORE.
        try {
            const US = (Vencord as any).Webpack?.findByProps?.("getCurrentUser", "getUser");
            if (US && !US._cp_perfect_hook) {
                const origCurrent = US.getCurrentUser.bind(US);

                // Fast-path cache: skip clone work if user object + data version are unchanged
                let _lastRealUser: any = null;
                let _lastFakeResult: any = null;
                let _lastCacheVersion = -1;

                US.getCurrentUser = () => {
                    const realUser = origCurrent();
                    if (realUser) {
                        // Update name cache only when the user object itself changes
                        if (realUser !== _lastRealUser) {
                            if (realUser.username) _realUsername = realUser.username;
                            if (realUser.globalName) _realGlobalName = realUser.globalName;
                        }
                        // Return cached clone if nothing changed
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
                US.getUser = (id: string) => isMe(id) ? this.fakeCurrentUser(origGet(id)) : origGet(id);
                US._cp_perfect_hook = true;
                _patchRestores.push(() => {
                    US.getCurrentUser = origCurrent;
                    US.getUser = origGet;
                    US._cp_perfect_hook = false;
                });
            }
        } catch { }

        // INTERCEPTION ON UserProfileStore (for native Nitro/Boost badges in popout/modal profile)
        try {
            const UPS = (Vencord as any).Webpack?.findByProps?.("getUserProfile", "getGuildMemberProfile");
            if (UPS && !UPS._cp_profile_hook) {
                const origGetProfile = UPS.getUserProfile.bind(UPS);
                UPS.getUserProfile = (userId: string) => {
                    try {
                        const profile = origGetProfile(userId);
                        if (!isEnabled || !userId || !isMe(userId) || !profile) return profile;
                        return this.hookUserProfile(profile);
                    } catch (e) {
                        console.error("[CustomProfile] Error in getUserProfile hook:", e);
                        return origGetProfile(userId);
                    }
                };
                const origGetGuild = UPS.getGuildMemberProfile.bind(UPS);
                UPS.getGuildMemberProfile = (userId: string, guildId: string) => {
                    try {
                        const profile = origGetGuild(userId, guildId);
                        if (!isEnabled || !userId || !isMe(userId) || !profile) return profile;
                        return this.hookUserProfile(profile);
                    } catch (e) {
                        console.error("[CustomProfile] Error in getGuildMemberProfile hook:", e);
                        return origGetGuild(userId, guildId);
                    }
                };
                UPS._cp_profile_hook = true;
                _patchRestores.push(() => {
                    UPS.getUserProfile = origGetProfile;
                    UPS.getGuildMemberProfile = origGetGuild;
                    UPS._cp_profile_hook = false;
                });
            }
        } catch { }

        // INTERCEPTION ON MULTI ACCOUNT STORE (For the "Switch Account" menu)
        // Applies custom usernames for ALL accounts in the switcher
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
                    const wrappedGetUsers = MAS.getUsers;
                    const origGetUsers = MAS.getUsers.bind(MAS);
                    MAS.getUsers = () => {
                        const users = origGetUsers();
                        if (!users || !Array.isArray(users)) return users;
                        return users.map(patchAccountUser);
                    };
                    _patchRestores.push(() => { MAS.getUsers = wrappedGetUsers; });
                }

                if (MAS.getValidUsers) {
                    const wrappedGetValid = MAS.getValidUsers;
                    const origGetValid = MAS.getValidUsers.bind(MAS);
                    MAS.getValidUsers = () => {
                        const users = origGetValid();
                        if (!users || !Array.isArray(users)) return users;
                        return users.map(patchAccountUser);
                    };
                    _patchRestores.push(() => { MAS.getValidUsers = wrappedGetValid; });
                }

                MAS._cp_perfect_hook = true;
                _patchRestores.push(() => { MAS._cp_perfect_hook = false; });
                try { MAS.emitChange?.(); } catch { }
            }
        } catch { }

        // Patch SnowflakeUtils.extractTimestamp to fake the creation date
        try {
            if (SnowflakeUtils?.extractTimestamp && !this._origExtractTimestamp) {
                this._origExtractTimestamp = SnowflakeUtils.extractTimestamp;
                const origExtract = this._origExtractTimestamp;
                (SnowflakeUtils as any).extractTimestamp = (snowflake: string) => {
                    if (isEnabled && storedData.createdAt && isMe(snowflake)) {
                        const dateStr = storedData.createdAt.includes("T") ? storedData.createdAt : storedData.createdAt + "T12:00:00Z";
                        const ts = new Date(dateStr).getTime();
                        if (!isNaN(ts)) return ts;
                    }
                    return origExtract(snowflake);
                };
            }
        } catch { }

        loadData().then(() => {
            if (generation !== customProfileGeneration) return;
            updateCachedRealData();
            applyAvatarPatchEarly();
            if (isEnabled) {
                forceAccountPanelRerender();
                requestAnimationFrame(() => removeHideStyle());
            } else {
                removeHideStyle();
            }
        });

        // Patch getAvatarDecorationURL to inject our decoration only on our user
        try {
            const decoMod = (Vencord as any).Webpack?.findByProps?.("getAvatarDecorationURL");
            if (decoMod?.getAvatarDecorationURL && !decoMod._cp_deco_hook) {
                const wrappedDeco = decoMod.getAvatarDecorationURL;
                const origDeco = decoMod.getAvatarDecorationURL.bind(decoMod);
                decoMod.getAvatarDecorationURL = (opts: any) => {
                    try {
                        if (isEnabled && storedData.decorationAsset) {
                            const { avatarDecoration, userId, canAnimate } = opts ?? {};
                            const myId = UserStore.getCurrentUser()?.id;
                            const isOurs = (avatarDecoration?.skuId === "__fake__")
                                || (avatarDecoration?.asset === storedData.decorationAsset)
                                || (userId && userId === myId);
                            if (isOurs) {
                                const asset = storedData.decorationAsset;
                                const dec = AVATAR_DECORATIONS.find(d => d.id === asset);
                                const passthrough = dec ? (dec as any).passthrough : asset.startsWith("a_");
                                return getDecorationUrl(asset, passthrough);
                            }
                        }
                    } catch { }
                    return origDeco(opts);
                };
                decoMod._cp_deco_hook = true;
                _patchRestores.push(() => {
                    decoMod.getAvatarDecorationURL = wrappedDeco;
                    decoMod._cp_deco_hook = false;
                });
            }
        } catch { }

        if (IconUtils?.getUserAvatarURL && !_avatarPatchApplied) {
            this._origGetUserAvatarURL = IconUtils.getUserAvatarURL;
            const orig = this._origGetUserAvatarURL;
            (IconUtils as any).getUserAvatarURL = (user: any, ...args: any[]) => {
                if (isEnabled && storedData.avatar) {
                    const uid = user?.id ?? user?.userId;
                    if (uid && isMe(uid)) return storedData.avatar;
                }
                return orig(user, ...args);
            };
            _avatarPatchApplied = true;
        }
    },

    userProfileBadges: [
        {
            getBadges({ userId, badges: nativeBadges }: { userId: string; guildId: string; badges: ProfileBadge[]; }) {
                if (!isEnabled) return nativeBadges || [];
                if (userId !== UserStore.getCurrentUser()?.id) return nativeBadges || [];

                let badges: ProfileBadge[] = [...(nativeBadges || [])];
                const style = { borderRadius: "50%", width: "22px", height: "22px" };

                // Determine which fake badges are active to filter real ones (avoid duplicates)
                const nl = storedData.nitroLevel ?? -1;
                const bm = storedData.boostMonths ?? -1;
                const hasNitroFake = nl >= 0 && nl < NITRO_LEVELS.length;
                const hasBoostFake = bm >= 0 && bm < BOOST_ICONS.length;
                const wantedFlags = storedData.badgeFlags ?? 0;

                // Robust filtering of native badges to avoid duplicates (multi-language support)
                badges = badges.filter(b => {
                    const desc = (b.description || "").toLowerCase();
                    const icon = (b.iconSrc || "").toLowerCase();

                    // Nitro / Subscriber
                    if (isEnabled) { // ALWAYS filter native nitro/boost if plugin is enabled for this user
                        const nitroKeywords = ["nitro", "subscriber", "abonn", "premium", "inscrit"];
                        if (nitroKeywords.some(k => desc.includes(k))) return false;
                        if (icon.includes("nitro") || icon.includes("premium")) return false;

                        const boostKeywords = ["booster", "boost"];
                        if (boostKeywords.some(k => desc.includes(k))) return false;
                        if (icon.includes("boost") || icon.includes("leveling")) return false;
                    }
                    // Logic for other flags (Staff, Partner, HypeSquad, etc.)
                    for (const badge of BADGES) {
                        if (wantedFlags & badge.flag) {
                            const badgeKeywords = badge.label.toLowerCase().split(" ");
                            if (badgeKeywords.some(k => k.length > 3 && desc.includes(k))) return false;
                            const iconParts = badge.icon.split("/");
                            const iconName = iconParts[iconParts.length - 1];
                            if (icon.includes(iconName)) return false;
                        }
                    }

                    return true;
                });

                const badgeList: any[] = [];

                // 1. Staff Discord
                if (storedData.badgeFlags && (storedData.badgeFlags & FLAG.STAFF)) {
                    badgeList.push({ description: t("Staff Discord"), iconSrc: "https://cdn.discordapp.com/badge-icons/5e74e9b61934fc1f67c65515d1f7e60d.png", position: 0, props: { style } });
                }

                // 2. Partner
                if (storedData.badgeFlags && (storedData.badgeFlags & FLAG.PARTNER)) {
                    badgeList.push({ description: t("Owner of a partner server"), iconSrc: "https://cdn.discordapp.com/badge-icons/3f9748e53446a137a052f3454e2de41e.png", position: 0, props: { style } });
                }

                // 3. NITRO — rich tooltip with correct tier name and calculated date
                if (hasNitroFake) {
                    const since = makeNitroDate(UserStore.getCurrentUser()?.id ?? "", nl);
                    const dateStr = `${since.getMonth() + 1}/${since.getDate()}/${String(since.getFullYear()).slice(-2)}`;
                    const tierName = NITRO_TIER_NAMES_EN[nl] ?? "";
                    const tooltipTitle = tierName ? `Nitro ${tierName}` : "Nitro";
                    const { icon } = NITRO_LEVELS[nl];
                    badgeList.push({
                        description: `${tooltipTitle}\nSubscriber since ${dateStr}`,
                        image: icon,
                        iconSrc: icon,
                        position: 0,
                        key: "cp-nitro-badge",
                        props: { style },
                        component: () => (
                            <NitroBadgeTooltip
                                icon={icon}
                                tierName={tierName}
                                dateStr={dateStr}
                            />
                        ),
                    });
                }

                // 4. HypeSquad Events
                if (storedData.badgeFlags && (storedData.badgeFlags & FLAG.HYPESQUAD)) {
                    badgeList.push({ description: t("HypeSquad Events"), iconSrc: "https://cdn.discordapp.com/badge-icons/bf01d1073931f921909045f3a39fd264.png", position: 0, props: { style } });
                }

                // 5. Bug Hunter 2
                if (storedData.badgeFlags && (storedData.badgeFlags & FLAG.BUG_HUNTER_2)) {
                    badgeList.push({ description: t("Bug Hunter Lvl 2"), iconSrc: "https://cdn.discordapp.com/badge-icons/848f79194d4be5ff5f81505cbd0ce1e6.png", position: 0, props: { style } });
                }

                // 6. House Badges (HypeSquad Houses)
                if (storedData.badgeFlags && (storedData.badgeFlags & FLAG.BALANCE)) {
                    badgeList.push({ description: t("HypeSquad Balance"), iconSrc: "https://cdn.discordapp.com/badge-icons/3aa41de486fa12454c3761e8e223442e.png", position: 0, props: { style } });
                }
                if (storedData.badgeFlags && (storedData.badgeFlags & FLAG.BRAVERY)) {
                    badgeList.push({ description: t("HypeSquad Bravery"), iconSrc: "https://cdn.discordapp.com/badge-icons/8a88d63823d8a71cd5e390baa45efa02.png", position: 0, props: { style } });
                }
                if (storedData.badgeFlags && (storedData.badgeFlags & FLAG.BRILLIANCE)) {
                    badgeList.push({ description: t("HypeSquad Brilliance"), iconSrc: "https://cdn.discordapp.com/badge-icons/011940fd013da3f7fb926e4a1cd2e618.png", position: 0, props: { style } });
                }

                // 7. Bug Hunter 1
                if (storedData.badgeFlags && (storedData.badgeFlags & FLAG.BUG_HUNTER_1)) {
                    badgeList.push({ description: t("Bug Hunter Lvl 1"), iconSrc: "https://cdn.discordapp.com/badge-icons/2717692c7dca7289b35297368a940dd0.png", position: 0, props: { style } });
                }

                // 8. Developer (Verified)
                if (storedData.badgeFlags && (storedData.badgeFlags & FLAG.DEV_VERIFIED)) {
                    badgeList.push({ description: t("Verified Developer"), iconSrc: "https://cdn.discordapp.com/badge-icons/6df5892e0f35b051f8b61eace34f4967.png", position: 0, props: { style } });
                }

                // 9. Former Moderator
                if (storedData.badgeFlags && (storedData.badgeFlags & FLAG.MOD_ALUMNI)) {
                    badgeList.push({ description: t("Former Moderator"), iconSrc: "https://cdn.discordapp.com/badge-icons/fee1624003e2fee35cb398e125dc479b.png", position: 0, props: { style } });
                }

                // 10. Early Supporter
                if (storedData.badgeFlags && (storedData.badgeFlags & FLAG.EARLY_SUPPORTER)) {
                    badgeList.push({ description: t("Early Supporter"), iconSrc: "https://cdn.discordapp.com/badge-icons/7060786766c9c840eb3019e725d2b358.png", position: 0, props: { style } });
                }

                // 11. SERVER BOOST (Right after Early Supporter)
                if (hasBoostFake) {
                    const boostSince = makeBoostDate(UserStore.getCurrentUser()?.id ?? "", bm);
                    const boostDateStr = `${boostSince.getMonth() + 1}/${boostSince.getDate()}/${String(boostSince.getFullYear()).slice(-2)}`;
                    badgeList.push({ description: `Server Booster\nServer boosting since ${boostDateStr}`, iconSrc: BOOST_ICONS[bm], position: 0, props: { style, title: "Server Booster" } });
                }

                // 12. Active Developer
                if (storedData.badgeFlags && (storedData.badgeFlags & FLAG.ACTIVE_DEVELOPER)) {
                    badgeList.push({ description: t("Active Developer"), iconSrc: "https://cdn.discordapp.com/badge-icons/6bdc42827a38498929a4920da12695d9.png", position: 0, props: { style } });
                }

                // 13. Old Name (Ancien nom d'utilisateur)
                if (storedData.customBadgeIds?.includes("oldname")) {
                    const oldNameText = storedData.oldName ? `Old username\u00a0: ${storedData.oldName}` : "Old username";
                    badgeList.push({ description: oldNameText, iconSrc: OLD_NAME_BADGE_ICON, position: 0, props: { style, title: oldNameText } });
                }

                // 14. Completed Quest
                if (storedData.customBadgeIds?.includes("quest")) {
                    badgeList.push({ description: "Completed a quest", iconSrc: "https://cdn.discordapp.com/badge-icons/7d9ae358c8c5e118768335dbe68b4fb8.png", position: 0, props: { style } });
                }

                // 15. Orbs
                if (storedData.customBadgeIds?.includes("orbs")) {
                    badgeList.push({ description: "Orbs — Apprentice", iconSrc: "https://cdn.discordapp.com/badge-icons/83d8a1eb09a8d64e59233eec5d4d5c2d.png", position: 0, props: { style } });
                }

                badges.push(...badgeList);
                return badges;
            }
        } as ProfileBadge
    ] as ProfileBadge[],

    stop() {
        customProfileGeneration++;
        unpatchPresence();
        removeHeaderBarButton("custom-profile-btn");
        removeContextMenuPatch("user-context", userContextMenuPatch);
        FluxDispatcher.unsubscribe("CONNECTION_OPEN", onAccountSwitch);
        stopDomObserver();
        removeHideStyle();
        while (_patchRestores.length) {
            const restore = _patchRestores.pop();
            try { restore?.(); } catch { }
        }
        if (this._origExtractTimestamp && SnowflakeUtils) {
            (SnowflakeUtils as any).extractTimestamp = this._origExtractTimestamp;
            this._origExtractTimestamp = null;
        }
        if (this._origGetUserAvatarURL && IconUtils) {
            (IconUtils as any).getUserAvatarURL = this._origGetUserAvatarURL;
            this._origGetUserAvatarURL = null;
        }
        // Clean up the avatarDecoration patch
        try {
            const myUser = UserStore.getCurrentUser() as any;
            if (myUser) {
                try { delete myUser.avatarDecoration; } catch { }
                try { delete myUser.avatarDecorationData; } catch { }
            }
        } catch { }
    },

    settingsAboutComponent() {
        return <Button onClick={() => openModal(props => <CustomProfileModal rootProps={props} />)}>Open Custom Profile</Button>;
    },
});
