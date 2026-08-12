/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addProfileBadge, BadgePosition, type ProfileBadge, removeProfileBadge } from "@api/Badges";
import { UserAreaButton, UserAreaRenderProps } from "@api/UserArea";
import BadgeAPIPlugin from "@plugins/_api/badges";
import { TestcordDevs } from "@utils/constants";
import { openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import type { User } from "@vencord/discord-types";
import { ComponentDispatch, FluxDispatcher, IconUtils, PresenceStore, React, SnowflakeUtils, Tooltip, UsernameUtils, UserStore } from "@webpack/common";

let DecorationGridItem: React.ComponentType<any> | null = null;
let DecorationGridDecoration: React.ComponentType<any> | null = null;
let AvatarDecorationModalPreview: React.ComponentType<any> | null = null;

import { getCachedTarget, getManualProfile, isActive, isCurrentUser, loadData, loadTarget, logger, makeDateInRange, restoreManualProfileIfNeeded, restoreStoredTarget, setEnabled, settings, subscribe } from "./data";
import { FakeUserProfileModal, setCapturedComponents } from "./modal";

const FLAG_BADGES: { flag: number; image: string; description: string; }[] = [
    { flag: 1 << 0, image: "https://cdn.discordapp.com/badge-icons/5e74e9b61934fc1f67c65515d1f7e60d.png", description: "Discord Staff" },
    { flag: 1 << 1, image: "https://cdn.discordapp.com/badge-icons/3f9748e53446a137a052f3454e2de41e.png", description: "Partnered Server Owner" },
    { flag: 1 << 2, image: "https://cdn.discordapp.com/badge-icons/bf01d1073931f921909045f3a39fd264.png", description: "HypeSquad Events" },
    { flag: 1 << 3, image: "https://cdn.discordapp.com/badge-icons/2717692c7dca7289b35297368a940dd0.png", description: "Discord Bug Hunter" },
    { flag: 1 << 6, image: "https://cdn.discordapp.com/badge-icons/8a88d63823d8a71cd5e390baa45efa02.png", description: "HypeSquad Bravery" },
    { flag: 1 << 7, image: "https://cdn.discordapp.com/badge-icons/011940fd013da3f7fb926e4a1cd2e618.png", description: "HypeSquad Brilliance" },
    { flag: 1 << 8, image: "https://cdn.discordapp.com/badge-icons/3aa41de486fa12454c3761e8e223442e.png", description: "HypeSquad Balance" },
    { flag: 1 << 9, image: "https://cdn.discordapp.com/badge-icons/7060786766c9c840eb3019e725d2b358.png", description: "Early Supporter" },
    { flag: 1 << 14, image: "https://cdn.discordapp.com/badge-icons/848f79194d4be5ff5f81505cbd0ce1e6.png", description: "Golden Discord Bug Hunter" },
    { flag: 1 << 17, image: "https://cdn.discordapp.com/badge-icons/6df5892e0f35b051f8b61eace34f4967.png", description: "Early Verified Bot Developer" },
    { flag: 1 << 18, image: "https://cdn.discordapp.com/badge-icons/fee1624003e2fee35cb398e125dc479b.png", description: "Moderator Programs Alumni" },
    { flag: 1 << 22, image: "https://cdn.discordapp.com/badge-icons/6bdc42827a38498929a4920da12695d9.png", description: "Active Developer" },
];

const NITRO_TIER_NAMES = ["", "Bronze", "Silver", "Gold", "Platinum", "Diamond", "Emerald", "Ruby", "Opal"];

function NitroBadgeTooltip({ icon, tierName, dateStr, premiumType }: { icon: string; tierName: string; dateStr: string; premiumType: number; }) {
    const accentColor = premiumType === 1 ? "#2dc770" : "#a970ff";
    return (
        <Tooltip
            text={
                <div style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    textAlign: "center",
                    padding: "12px 16px",
                    gap: 2,
                    position: "relative",
                    overflow: "hidden",
                    minWidth: 120,
                }}>
                    <div style={{
                        position: "absolute",
                        top: -20,
                        left: -20,
                        width: 60,
                        height: 60,
                        borderRadius: "50%",
                        background: accentColor,
                        opacity: 0.25,
                        filter: "blur(16px)",
                        pointerEvents: "none",
                    }} />
                    <div style={{
                        position: "absolute",
                        top: -20,
                        right: -20,
                        width: 60,
                        height: 60,
                        borderRadius: "50%",
                        background: accentColor,
                        opacity: 0.25,
                        filter: "blur(16px)",
                        pointerEvents: "none",
                    }} />
                    <img
                        src={icon}
                        alt=""
                        style={{ width: 72, height: 72, objectFit: "contain", marginBottom: 6, position: "relative" }}
                    />
                    <div style={{
                        fontWeight: 700,
                        fontSize: 14,
                        letterSpacing: "0.04em",
                        lineHeight: 1.3,
                        position: "relative",
                        color: "#fff",
                    }}>
                        NITRO
                    </div>
                    {tierName && (
                        <div style={{
                            fontWeight: 400,
                            fontSize: 13,
                            lineHeight: 1.2,
                            position: "relative",
                            color: "#fff",
                        }}>
                            {tierName.toUpperCase()}
                        </div>
                    )}
                    <div style={{ fontSize: 12, opacity: 0.7, position: "relative", marginTop: 2 }}>
                        Subscriber since
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.7, position: "relative" }}>
                        {dateStr}
                    </div>
                </div>
            }
        >
            {(tooltipProps: any) => (
                <img
                    {...tooltipProps}
                    src={icon}
                    alt="Nitro"
                    style={{ borderRadius: "50%", width: "22px", height: "22px", cursor: "pointer" }}
                />
            )}
        </Tooltip>
    );
}

/** Extract the bare hash from a badge-icons CDN URL so Discord's internal renderer can build the URL itself. */
function badgeIconHash(url: string): string {
    const m = url.match(/\/([a-f0-9]+)\.png/);
    return m ? m[1] : url;
}

const SNOWFLAKE_EPOCH = 1420070400000n;
function makeSnowflake(): string {
    return ((BigInt(Date.now()) - SNOWFLAKE_EPOCH) << 22n).toString();
}

function getTargetUser(): User | null {
    const t = getCachedTarget();
    if (!t) return null;
    return t.user;
}

function getTargetProfile(): any {
    const t = getCachedTarget();
    if (!t) return null;
    return t.profile;
}

function getManualAvatarDataUrl(): string | null {
    const target = getCachedTarget();
    if (!target?.manual) return null;
    return target.manualProfile?.avatarDataUrl || getManualProfile().avatarDataUrl || null;
}

function getManualBannerDataUrl(): string | null {
    const target = getCachedTarget();
    if (!target?.manual) return null;
    return target.manualProfile?.bannerDataUrl || getManualProfile().bannerDataUrl || null;
}

function buildOverrides(target: any): Record<string, unknown> {
    const profile = getTargetProfile();
    const banner = target.banner ?? profile?.banner ?? null;
    const overrides: Record<string, unknown> = {
        username: target.username,
        globalName: target.globalName,
        discriminator: target.discriminator,
        avatar: target.avatar,
        banner,
        publicFlags: target.publicFlags ?? target.flags ?? 0,
        flags: target.flags ?? 0,
        premiumType: target.premiumType ?? 0,
        premiumSince: target.premiumSince ?? profile?.premiumSince ?? null,
        premiumGuildSince: target.premiumGuildSince ?? profile?.premiumGuildSince ?? null,
        accentColor: target.accentColor ?? profile?.accentColor ?? null,
        usernameNormalized: typeof target.username === "string" ? target.username.toLowerCase() : undefined,
        bot: target.bot ?? false,
    };
    if (target.primaryGuild !== undefined) overrides.primaryGuild = target.primaryGuild;
    if (target.avatarDecorationData !== undefined) overrides.avatarDecorationData = target.avatarDecorationData;
    if (target.clan !== undefined) overrides.clan = target.clan;
    if (target.collectibles !== undefined) overrides.collectibles = target.collectibles;
    if (target.displayNameStyles !== undefined) overrides.displayNameStyles = target.displayNameStyles;
    if (target.createdAt !== undefined) overrides.createdAt = target.createdAt;
    overrides.tag = `${target.username}${target.discriminator && target.discriminator !== "0" ? `#${target.discriminator}` : ""}`;
    return overrides;
}

function safeMergeUserProfile(original: any, overrides: any, userId?: string): any {
    if (!original) return { userId, ...overrides };

    let proto = Object.prototype;
    try {
        proto = Object.getPrototypeOf(original) || Object.prototype;
    } catch { /* ignore */ }

    const merged = Object.create(proto);

    try {
        Object.assign(merged, original);
    } catch {
        let keys: (string | symbol)[] = [];
        try {
            keys = [
                ...Object.getOwnPropertyNames(original),
                ...Object.getOwnPropertySymbols(original)
            ];
        } catch {
            try {
                keys = Object.keys(original);
            } catch { /* ignore */ }
        }
        const uniqueKeys = Array.from(new Set(keys));
        for (const key of uniqueKeys) {
            try {
                const desc = Object.getOwnPropertyDescriptor(original, key);
                if (desc) {
                    Object.defineProperty(merged, key, desc);
                } else {
                    merged[key as any] = original[key];
                }
            } catch {
                try {
                    merged[key as any] = original[key];
                } catch { /* ignore */ }
            }
        }
    }

    if (overrides) {
        for (const key of Object.keys(overrides)) {
            try {
                merged[key] = overrides[key];
            } catch { /* ignore */ }
        }
    }

    return merged;
}

function mergeUser(base: any, overrides: Record<string, unknown>): any {
    if (!base) return overrides;
    let proto = Object.prototype;
    try {
        proto = Object.getPrototypeOf(base) || Object.prototype;
    } catch { /* ignore */ }
    const wrap = Object.create(proto);

    let names: string[] = [];
    try {
        names = Array.from(new Set(Object.getOwnPropertyNames(base)));
    } catch {
        try {
            names = Object.keys(base);
        } catch { /* ignore */ }
    }
    for (const key of names) {
        try {
            const desc = Object.getOwnPropertyDescriptor(base, key);
            if (desc) {
                Object.defineProperty(wrap, key, desc);
            }
        } catch { /* ignore */ }
    }

    let symbols: symbol[] = [];
    try {
        symbols = Array.from(new Set(Object.getOwnPropertySymbols(base)));
    } catch { /* ignore */ }
    for (const sym of symbols) {
        try {
            const desc = Object.getOwnPropertyDescriptor(base, sym);
            if (desc) {
                Object.defineProperty(wrap, sym, desc);
            }
        } catch { /* ignore */ }
    }

    if (overrides) {
        for (const key of Object.keys(overrides)) {
            try {
                Object.defineProperty(wrap, key, {
                    value: overrides[key],
                    writable: true,
                    enumerable: true,
                    configurable: true,
                });
            } catch { /* ignore */ }
        }
    }
    return wrap;
}

function useUserAvatarDecoration(user: User) {
    if (!isActive()) return undefined;
    if (!isCurrentUser(user?.id)) return undefined;
    const t = getTargetUser() as any;
    const manual = getCachedTarget()?.manualProfile;
    const decoAsset = t?.avatarDecorationData?.asset || manual?.avatarDecoration || manual?.decorationAsset;
    if (!decoAsset) return undefined;
    return {
        asset: decoAsset,
        skuId: t?.avatarDecorationData?.skuId || decoAsset,
        animated: t?.avatarDecorationData?.animated ?? decoAsset.startsWith("a_"),
    };
}

let cachedWrap: { base: any; target: any; wrap: any; } | null = null;
let wrapping = false;

function wrapUser(base: any): any {
    const target = getTargetUser();
    if (!base || !target || !isActive()) return base;
    if (wrapping) return base;
    if (cachedWrap && cachedWrap.base === base && cachedWrap.target === target) return cachedWrap.wrap;
    wrapping = true;
    try {
        const wrap = mergeUser(base, buildOverrides(target));
        try {
            const manual = getCachedTarget()?.manualProfile;
            let createdAt: Date;
            if (manual?.createdAt) {
                const dateStr = manual.createdAt.includes("T") ? manual.createdAt : manual.createdAt + "T12:00:00Z";
                const d = new Date(dateStr);
                createdAt = !isNaN(d.getTime()) ? d : new Date(SnowflakeUtils.extractTimestamp(target.id));
            } else {
                createdAt = new Date(SnowflakeUtils.extractTimestamp(target.id));
            }
            Object.defineProperty(wrap, "createdAt", {
                get() { return createdAt; },
                enumerable: true,
                configurable: true,
            });
        } catch { /* ignore */ }
        cachedWrap = { base, target, wrap };
        return wrap;
    } finally {
        wrapping = false;
    }
}

function clearWrapCache() {
    cachedWrap = null;
    clearBadgeCache();
}

let originalGetUser: typeof UserStore.getUser | null = null;
let originalGetCurrentUser: typeof UserStore.getCurrentUser | null = null;
let originalGetUserAvatarURL: typeof IconUtils.getUserAvatarURL | null = null;
let originalGetUserBannerURL: typeof IconUtils.getUserBannerURL | null = null;
let originalGetName: typeof UsernameUtils.getName | null = null;
let originalGetGlobalName: typeof UsernameUtils.getGlobalName | null = null;
let originalGetFormattedName: typeof UsernameUtils.getFormattedName | null = null;
let originalGetUserTag: typeof UsernameUtils.getUserTag | null = null;
let originalUseName: typeof UsernameUtils.useName | null = null;
let originalUseUserTag: typeof UsernameUtils.useUserTag | null = null;
let originalExtractTimestamp: typeof SnowflakeUtils.extractTimestamp | null = null;
let originalGetStatus: typeof PresenceStore.getStatus | null = null;
let originalGetClientStatus: typeof PresenceStore.getClientStatus | null = null;
let originalGetActivities: typeof PresenceStore.getActivities | null = null;
let originalGetPrimaryActivity: typeof PresenceStore.getPrimaryActivity | null = null;
let originalGetUnfilteredActivities: typeof PresenceStore.getUnfilteredActivities | null = null;
let originalFindActivity: typeof PresenceStore.findActivity | null = null;
let originalGetApplicationActivity: typeof PresenceStore.getApplicationActivity | null = null;

let storePatched = false;
let utilsPatched = false;
let presencePatched = false;

function patchStore() {
    if (storePatched) return;
    storePatched = true;

    originalGetUser = UserStore.getUser;
    originalGetCurrentUser = UserStore.getCurrentUser;

    UserStore.getUser = function (userId: string) {
        const u = originalGetUser!.call(this, userId);
        if (!isActive() || !u) return u;
        if (!isCurrentUser(userId)) return u;
        return wrapUser(u);
    };

    UserStore.getCurrentUser = function () {
        const u = originalGetCurrentUser!.call(this);
        if (!isActive()) return u;
        return wrapUser(u);
    };
}

function unpatchStore() {
    if (!storePatched) return;
    if (originalGetUser) UserStore.getUser = originalGetUser;
    if (originalGetCurrentUser) UserStore.getCurrentUser = originalGetCurrentUser;
    storePatched = false;
}

function patchUtils() {
    if (utilsPatched) return;
    utilsPatched = true;

    originalGetUserAvatarURL = IconUtils.getUserAvatarURL;
    originalGetUserBannerURL = IconUtils.getUserBannerURL;
    originalGetName = UsernameUtils.getName;
    originalGetGlobalName = UsernameUtils.getGlobalName;
    originalGetFormattedName = UsernameUtils.getFormattedName;
    originalGetUserTag = UsernameUtils.getUserTag;
    originalUseName = UsernameUtils.useName;
    originalUseUserTag = UsernameUtils.useUserTag;

    IconUtils.getUserAvatarURL = function (user: any, animated?: any, size?: any, format?: any) {
        if (isActive() && user && isCurrentUser(user.id)) {
            const manualAvatar = getManualAvatarDataUrl();
            if (manualAvatar) return manualAvatar;
            const t = getTargetUser();
            if (t) return originalGetUserAvatarURL!.call(this, t, animated, size, format);
        }
        return originalGetUserAvatarURL!.call(this, user, animated, size, format);
    };

    IconUtils.getUserBannerURL = function (params: any) {
        if (isActive() && params && isCurrentUser(params.id)) {
            const manualBanner = getManualBannerDataUrl();
            if (manualBanner) return manualBanner;
            const t = getTargetUser() as any;
            const targetBanner = params.banner ?? t?.banner ?? getTargetProfile()?.banner;
            if (t && targetBanner) {
                return originalGetUserBannerURL!.call(this, { ...params, id: t.id, banner: targetBanner });
            }
        }
        return originalGetUserBannerURL!.call(this, params);
    };

    UsernameUtils.getName = function (user: User) {
        if (isActive() && user && isCurrentUser(user.id)) {
            const t = getTargetUser();
            if (t) return originalGetName!.call(this, t);
        }
        return originalGetName!.call(this, user);
    };

    UsernameUtils.getGlobalName = function (user: User) {
        if (isActive() && user && isCurrentUser(user.id)) {
            const t = getTargetUser();
            if (t) return originalGetGlobalName!.call(this, t);
        }
        return originalGetGlobalName!.call(this, user);
    };

    UsernameUtils.getFormattedName = function (user: User, useTag?: boolean) {
        if (isActive() && user && isCurrentUser(user.id)) {
            const t = getTargetUser();
            if (t) return originalGetFormattedName!.call(this, t, useTag);
        }
        return originalGetFormattedName!.call(this, user, useTag);
    };

    UsernameUtils.getUserTag = function (user: User, options?: any) {
        if (isActive() && user && isCurrentUser(user.id)) {
            const t = getTargetUser();
            if (t) return originalGetUserTag!.call(this, t, options);
        }
        return originalGetUserTag!.call(this, user, options);
    };

    UsernameUtils.useName = function (user: User) {
        if (isActive() && user && isCurrentUser(user.id)) {
            const t = getTargetUser();
            if (t) return originalUseName!.call(this, t);
        }
        return originalUseName!.call(this, user);
    };

    UsernameUtils.useUserTag = function (user: User, options?: any) {
        if (isActive() && user && isCurrentUser(user.id)) {
            const t = getTargetUser();
            if (t) return originalUseUserTag!.call(this, t, options);
        }
        return originalUseUserTag!.call(this, user, options);
    };

    originalExtractTimestamp = SnowflakeUtils.extractTimestamp;
    SnowflakeUtils.extractTimestamp = function (id: string) {
        if (isActive() && isCurrentUser(id)) {
            const manual = getCachedTarget()?.manualProfile;
            if (manual?.createdAt) {
                const dateStr = manual.createdAt.includes("T") ? manual.createdAt : manual.createdAt + "T12:00:00Z";
                const ts = new Date(dateStr).getTime();
                if (!isNaN(ts)) return ts;
            }
            const target = getTargetUser();
            if (target && target.id !== id) {
                return originalExtractTimestamp!.call(this, target.id);
            }
        }
        return originalExtractTimestamp!.call(this, id);
    };
}

function unpatchUtils() {
    if (!utilsPatched) return;
    if (originalGetUserAvatarURL) IconUtils.getUserAvatarURL = originalGetUserAvatarURL;
    if (originalGetUserBannerURL) IconUtils.getUserBannerURL = originalGetUserBannerURL;
    if (originalGetName) UsernameUtils.getName = originalGetName;
    if (originalGetGlobalName) UsernameUtils.getGlobalName = originalGetGlobalName;
    if (originalGetFormattedName) UsernameUtils.getFormattedName = originalGetFormattedName;
    if (originalGetUserTag) UsernameUtils.getUserTag = originalGetUserTag;
    if (originalUseName) UsernameUtils.useName = originalUseName;
    if (originalUseUserTag) UsernameUtils.useUserTag = originalUseUserTag;
    if (originalExtractTimestamp) SnowflakeUtils.extractTimestamp = originalExtractTimestamp;
    utilsPatched = false;
}

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
        if (isActive() && isCurrentUser(userId)) {
            const target = getTargetUser();
            if (target) return originalGetStatus!.call(this, target.id, guildId, defaultStatus);
        }
        return originalGetStatus!.call(this, userId, guildId, defaultStatus);
    };

    PresenceStore.getClientStatus = function (userId: string): any {
        if (isActive() && isCurrentUser(userId)) {
            const target = getTargetUser();
            if (target) return originalGetClientStatus!.call(this, target.id);
        }
        return originalGetClientStatus!.call(this, userId);
    };

    PresenceStore.getActivities = function (userId: string, guildId?: string): any {
        if (isActive() && isCurrentUser(userId) && settings.store.spoofActivities) {
            const target = getTargetUser();
            if (target) return originalGetActivities!.call(this, target.id, guildId);
        }
        return originalGetActivities!.call(this, userId, guildId);
    };

    PresenceStore.getPrimaryActivity = function (userId: string, guildId?: string): any {
        if (isActive() && isCurrentUser(userId) && settings.store.spoofActivities) {
            const target = getTargetUser();
            if (target) return originalGetPrimaryActivity!.call(this, target.id, guildId);
        }
        return originalGetPrimaryActivity!.call(this, userId, guildId);
    };

    PresenceStore.getUnfilteredActivities = function (userId: string, guildId?: string): any {
        if (isActive() && isCurrentUser(userId) && settings.store.spoofActivities) {
            const target = getTargetUser();
            if (target) return originalGetUnfilteredActivities!.call(this, target.id, guildId);
        }
        return originalGetUnfilteredActivities!.call(this, userId, guildId);
    };

    PresenceStore.findActivity = function (userId: string, predicate: any, guildId?: string): any {
        if (isActive() && isCurrentUser(userId) && settings.store.spoofActivities) {
            const target = getTargetUser();
            if (target) return originalFindActivity!.call(this, target.id, predicate, guildId);
        }
        return originalFindActivity!.call(this, userId, predicate, guildId);
    };

    PresenceStore.getApplicationActivity = function (userId: string, applicationId: string, guildId?: string): any {
        if (isActive() && isCurrentUser(userId) && settings.store.spoofActivities) {
            const target = getTargetUser();
            if (target) return originalGetApplicationActivity!.call(this, target.id, applicationId, guildId);
        }
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

// Redirect custom Testcord badges (managed by /badge, NOT the hardcoded admin/owner/dev/contributor
// ones — those have their own shouldShow() against fixed user-id lists, so they remain unspoofable).
let originalGetTestcordCustomBadges: any = null;
let badgesPatched = false;

function patchBadges() {
    if (badgesPatched) return;
    if (typeof BadgeAPIPlugin?.getTestCordCustomBadges !== "function") return;
    badgesPatched = true;
    originalGetTestcordCustomBadges = BadgeAPIPlugin.getTestCordCustomBadges.bind(BadgeAPIPlugin);
    BadgeAPIPlugin.getTestCordCustomBadges = function (userId: string) {
        if (settings.store.spoofBadges && isActive() && isCurrentUser(userId)) {
            const target = getTargetUser();
            if (target) return originalGetTestcordCustomBadges(target.id);
        }
        return originalGetTestcordCustomBadges(userId);
    };
}

function unpatchBadges() {
    if (!badgesPatched) return;
    if (originalGetTestcordCustomBadges) BadgeAPIPlugin.getTestCordCustomBadges = originalGetTestcordCustomBadges;
    badgesPatched = false;
}

function notifyUpdate() {
    clearWrapCache();
    const me = originalGetCurrentUser ? originalGetCurrentUser.call(UserStore) : UserStore.getCurrentUser();
    if (!me) return;
    try {
        FluxDispatcher.dispatch({ type: "USER_UPDATE", user: me });
    } catch (e) {
        logger.warn("USER_UPDATE dispatch failed", e);
    }
}

function syncSpoofState() {
    clearWrapCache();
    notifyUpdate();
}

function FakeUserProfileIcon({ className, style }: { className?: string; style?: React.CSSProperties; }) {
    const lineLength = 30;
    const lineStyle: React.CSSProperties = {
        strokeDasharray: lineLength,
        strokeDashoffset: isActive() ? lineLength : 0,
        transition: "stroke-dashoffset 0.1s ease-in-out",
    };

    return (
        <svg className={className} style={style} width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <mask id="fakeUserProfileLine">
                <rect width="100%" height="100%" fill="#ffffff" />
                <line
                    className="blackLine"
                    x1="22"
                    y1="2"
                    x2="2"
                    y2="22"
                    stroke="#000000"
                    strokeWidth="6"
                    strokeLinecap="round"
                    style={lineStyle}
                />
            </mask>

            <path mask="url(#fakeUserProfileLine)" fill={!isActive() ? "var(--status-danger)" : "currentColor"} d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.42 0-8 2.24-8 5v2h16v-2c0-2.76-3.58-5-8-5Zm5.5-3.5 2.3 2.3a1 1 0 0 1-1.42 1.42L16.08 12l-2.3 2.3a1 1 0 1 1-1.42-1.42l2.3-2.3-2.3-2.3a1 1 0 0 1 1.42-1.42l2.3 2.3 2.3-2.3a1 1 0 0 1 1.42 1.42L17.5 10.5Z" />

            <line
                x1="22"
                y1="2"
                x2="2"
                y2="22"
                stroke="var(--status-danger, currentColor)"
                strokeWidth="2"
                strokeLinecap="round"
                style={lineStyle}
            />
        </svg>
    );
}

function FakeUserProfileButton({ iconForeground, hideTooltips, nameplate }: UserAreaRenderProps) {
    const [, force] = React.useReducer(x => x + 1, 0);
    React.useEffect(() => { return subscribe(() => force()); }, []);

    const target = getCachedTarget();
    const active = isActive();
    const manualProfile = getManualProfile();
    const hasManualProfile = settings.store.targetMode === "manual" && manualProfile.username;

    let tooltip: string | undefined;
    if (!hideTooltips) {
        if (target) {
            tooltip = active ? `Spoofing as ${target.user.username} \u2014 click to manage` : `Click to spoof as ${target.user.username}`;
        } else if (hasManualProfile) {
            tooltip = active ? `Spoofing as ${manualProfile.username} \u2014 click to manage` : `Click to spoof as ${manualProfile.username}`;
        } else {
            tooltip = "Fake User Profile";
        }
    }

    return (
        <UserAreaButton
            tooltipText={tooltip}
            icon={<FakeUserProfileIcon className={iconForeground} />}
            role="button"
            plated={nameplate != null}
            redGlow={!active}
            onClick={() => openModal(modalProps => <FakeUserProfileModal modalProps={modalProps as any} />)}
            onContextMenu={() => {
                if (!target && !restoreManualProfileIfNeeded()) {
                    openModal(modalProps => <FakeUserProfileModal modalProps={modalProps as any} />);
                    return;
                }
                setEnabled(!settings.store.spoofActive);
                force();
            }}
        />
    );
}

let cachedBadges: ProfileBadge[] | null = null;
let cachedBadgesTarget: User | null = null;
let cachedBadgesManual: any = null;

function clearBadgeCache() {
    cachedBadges = null;
    cachedBadgesTarget = null;
    cachedBadgesManual = null;
}

const dynamicBadge: ProfileBadge = {
    id: "fakeUserProfile-target",
    description: "Fake User Profile",
    position: BadgePosition.END,
    shouldShow: ({ userId }) => settings.store.spoofBadges && isActive() && isCurrentUser(userId),
    getBadges: () => {
        const target = getTargetUser();
        const manual = getCachedTarget()?.manualProfile;
        if (!target) return [];

        if (cachedBadges && cachedBadgesTarget === target && cachedBadgesManual === manual) {
            return cachedBadges;
        }

        const flags = (target as any).publicFlags ?? (target as any).flags ?? 0;
        const badges: ProfileBadge[] = [];

        for (const fb of FLAG_BADGES) {
            if ((flags & fb.flag) === fb.flag) {
                badges.push({
                    id: `fakeUserProfile-flag-${fb.flag}`,
                    description: fb.description,
                    iconSrc: fb.image,
                    position: BadgePosition.END,
                });
            }
        }

        const premium = (target as any).premiumType ?? 0;
        if (premium >= 1) {
            const NITRO_ICONS = [
                "https://cdn.discordapp.com/badge-icons/2ba85e8026a8614b640c2837bcdfe21b.png",
                "https://cdn.discordapp.com/badge-icons/4f33c4a9c64ce221936bd256c356f91f.png",
                "https://cdn.discordapp.com/badge-icons/4514fab914bdbfb4ad2fa23df76121a6.png",
                "https://cdn.discordapp.com/badge-icons/2895086c18d5531d499862e41d1155a6.png",
                "https://cdn.discordapp.com/badge-icons/0334688279c8359120922938dcb1d6f8.png",
                "https://cdn.discordapp.com/badge-icons/0d61871f72bb9a33a7ae568c1fb4f20a.png",
                "https://cdn.discordapp.com/badge-icons/11e2d339068b55d3a506cff34d3780f3.png",
                "https://cdn.discordapp.com/badge-icons/cd5e2cfd9d7f27a8cdcd3e8a8d5dc9f4.png",
                "https://cdn.discordapp.com/badge-icons/5b154df19c53dce2af92c9b61e6be5e2.png",
            ];
            const NITRO_M = [1, 2, 3, 6, 12, 24, 36, 72];
            const nitroLevel = manual?.nitroLevel ?? -1;
            const icon = nitroLevel >= 0 && nitroLevel < NITRO_ICONS.length ? NITRO_ICONS[nitroLevel] : NITRO_ICONS[0];
            const tierName = nitroLevel >= 0 && nitroLevel < NITRO_TIER_NAMES.length ? NITRO_TIER_NAMES[nitroLevel] : "";
            let dateStr = "";
            if (manual?.nitroLevel != null && manual.nitroLevel >= 0) {
                const minMonths = NITRO_M[manual.nitroLevel] ?? 1;
                const maxMonths = NITRO_M[manual.nitroLevel + 1] ?? minMonths + 12;
                const nitroDate = makeDateInRange(target.id, minMonths, maxMonths);
                const month = nitroDate.getMonth() + 1;
                const day = nitroDate.getDate();
                const year = nitroDate.getFullYear();
                dateStr = `${month}/${day}/${String(year).slice(-2)}`;
            }
            const description = dateStr ? `NITRO ${tierName}\nSubscriber since ${dateStr}` : (tierName ? `NITRO ${tierName}` : "Discord Nitro");
            const style = { borderRadius: "50%", width: "22px", height: "22px" };
            badges.push({
                id: "fakeUserProfile-nitro",
                description,
                iconSrc: icon,
                position: BadgePosition.END,
                props: { style },
                component: () => (
                    <NitroBadgeTooltip
                        icon={icon}
                        tierName={tierName}
                        dateStr={dateStr}
                        premiumType={premium}
                    />
                ),
            });
        }

        // Boost badge
        const boostMonths = manual?.boostMonths ?? -1;
        if (boostMonths >= 0) {
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
            if (boostMonths < BOOST_ICONS.length) {
                const BOOST_M = [1, 2, 3, 6, 9, 12, 15, 18, 24];
                const minMonths = BOOST_M[boostMonths] ?? 1;
                const maxMonths = BOOST_M[boostMonths + 1] ?? minMonths + 6;
                const boostDate = makeDateInRange(target.id, minMonths, maxMonths);
                const BOOST_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                const dateStr = `${BOOST_MONTHS[boostDate.getMonth()]} ${boostDate.getDate()}, ${boostDate.getFullYear()}`;
                badges.push({
                    id: "fakeUserProfile-boost",
                    description: `Server boosting since ${dateStr}`,
                    iconSrc: BOOST_ICONS[boostMonths],
                    position: BadgePosition.END,
                });
            }
        }

        cachedBadges = badges;
        cachedBadgesTarget = target;
        cachedBadgesManual = manual;
        return badges;
    },
};

function buildFakeMessage(channelId: string, content: string, replyMessageReference: any) {
    const target = getCachedTarget();
    if (!target) return null;

    const u = target.user as any;
    const id = makeSnowflake();

    return {
        type: "MESSAGE_CREATE" as const,
        channelId,
        message: {
            attachments: [],
            author: {
                id: u.id,
                username: u.username,
                avatar: u.avatar,
                discriminator: u.discriminator,
                public_flags: u.publicFlags ?? u.flags ?? 0,
                premium_type: u.premiumType ?? 0,
                flags: u.flags ?? 0,
                banner: u.banner,
                accent_color: u.accentColor ?? null,
                global_name: u.globalName ?? null,
                avatar_decoration_data: u.avatarDecorationData
                    ? { asset: u.avatarDecorationData.asset, sku_id: u.avatarDecorationData.skuId }
                    : null,
                banner_color: null,
                bot: u.bot ?? false,
            },
            channel_id: channelId,
            components: [],
            content,
            edited_timestamp: null,
            embeds: [],
            flags: 0,
            id,
            mention_everyone: false,
            mention_roles: [],
            mentions: [],
            nonce: id,
            pinned: false,
            timestamp: new Date().toISOString(),
            tts: false,
            type: replyMessageReference ? 19 : 0,
            message_reference: replyMessageReference ?? undefined,
        },
        optimistic: false,
        isPushNotification: false,
    };
}

let unsub: (() => void) | null = null;

export default definePlugin({
    name: "fakeUserProfile",
    description: "Click a user area button to visually spoof your client as another Discord user. Avatar, banner, badges, bio, pronouns, decorations, activities, and outgoing messages all appear as them locally.",
    tags: ["Customisation", "Privacy", "Fun"],
    authors: [TestcordDevs.x2b],
    dependencies: ["UserAreaAPI", "BadgeAPI", "MessageEventsAPI"],

    settings,

    userAreaButton: {
        icon: FakeUserProfileIcon,
        render: (props: UserAreaRenderProps) => <FakeUserProfileButton {...props} />,
    },

    async start() {
        await loadData();
        addProfileBadge(dynamicBadge);
        patchStore();
        patchUtils();
        patchBadges();
        patchPresence();

        unsub = subscribe(syncSpoofState);

        const { targetId } = settings.store;
        if (restoreStoredTarget()) {
            if (settings.store.spoofActive) syncSpoofState();
            return;
        }

        if (targetId) {
            try {
                await loadTarget(targetId);
                if (settings.store.spoofActive) syncSpoofState();
            } catch (e) {
                logger.warn("Failed to restore cached target", e);
            }
        }
    },

    stop() {
        clearWrapCache();
        unpatchPresence();
        unpatchBadges();
        unpatchUtils();
        unpatchStore();
        removeProfileBadge(dynamicBadge);
        if (unsub) { unsub(); unsub = null; }
        notifyUpdate();
    },

    flux: {
        CONNECTION_OPEN() {
            if (settings.store.spoofActive && getCachedTarget()) {
                syncSpoofState();
            }
        },
    },

    patches: [
        {
            find: ",getUserTag:",
            noWarn: true,
            replacement: {
                match: /if\(\i\((\i)\.global_name\)\)return(?=.{0,100}return"\?\?\?")/,
                replace: "const vcFupName=$self.getUsername($1);if(vcFupName)return vcFupName;$&"
            }
        },
        {
            find: "getUserAvatarURL:",
            noWarn: true,
            replacement: {
                match: /(getUserAvatarURL:)(\i),/,
                replace: "$1$self.wrapAvatar($2),"
            }
        },
        {
            find: "getAvatarDecorationURL:",
            noWarn: true,
            replacement: {
                match: /(?<=function \i\(\i\){)(?=let{avatarDecoration)/,
                replace: "const vcFupDeco=$self.getAvatarDecorationURL(arguments[0]);if(vcFupDeco)return vcFupDeco;"
            }
        },
        {
            find: "UserProfileStore",
            noWarn: true,
            replacement: {
                match: /(?<=getUserProfile\(\i\){return )(.+?)(?=})/,
                replace: "$self.profileHook(arguments[0],$1)"
            }
        },
        {
            find: ":\"SHOULD_LOAD\");",
            noWarn: true,
            replacement: {
                match: /\i(?:\?)?\.getPreviewBanner\(\i,\i,\i\)(?=.{0,100}"COMPLETE")/,
                replace: "($self.bannerHook(arguments[0])??($&))"
            }
        },
        {
            find: "isAvatarDecorationAnimating:",
            group: true,
            noWarn: true,
            replacement: [
                {
                    match: /(?<=\.avatarDecoration,guildId:\i\}\)\),)(?<=user:(\i).+?)/,
                    replace: "vcFupAvatarDecoration=$self.useUserAvatarDecoration($1),"
                },
                {
                    match: /(?<={avatarDecoration:).{1,20}?(?=,)(?<=avatarDecorationOverride:(\i).+?)/,
                    replace: "$1??vcFupAvatarDecoration??($&)"
                },
                {
                    match: /(?<=size:\i}\),\[)/,
                    replace: "vcFupAvatarDecoration,"
                }
            ]
        },
        {
            find: "renderNameTag",
            replacement: [
                {
                    match: /(?<=\i\)\({avatarDecoration:)\i(?=,)(?<=currentUser:(\i).+?)/,
                    replace: "$self.useUserAvatarDecoration($1)??$&"
                }
            ]
        },
        ...[
            "#{intl::ayozFl::raw}",
        ].map(find => ({
            find,
            noWarn: true,
            replacement: [
                {
                    match: /(\i)\.length>0\?void 0:(\i)\.avatarDecoration/,
                    replace: "$self.useUserAvatarDecoration($2)??$2.avatarDecoration"
                }
            ]
        })),
        {
            find: "avatarDecorationPreview",
            noWarn: true,
            replacement: [
                {
                    match: /(?<==)\i=>{let{user:\i,guildId:\i,avatarDecoration:/,
                    replace: "$self.AvatarDecorationModalPreview=$&"
                }
            ]
        },
    ],

    getUsername(user: User) {
        if (!isActive() || !isCurrentUser(user?.id)) return undefined;
        const t = getTargetUser();
        if (!t) return undefined;
        return t.globalName || t.username;
    },

    useUserAvatarDecoration,

    set DecorationGridItem(e: any) {
        DecorationGridItem = e;
        setCapturedComponents({ DecorationGridItem, DecorationGridDecoration, AvatarDecorationModalPreview });
    },

    set DecorationGridDecoration(e: any) {
        DecorationGridDecoration = e;
        setCapturedComponents({ DecorationGridItem, DecorationGridDecoration, AvatarDecorationModalPreview });
    },

    set AvatarDecorationModalPreview(e: any) {
        AvatarDecorationModalPreview = e;
        setCapturedComponents({ DecorationGridItem, DecorationGridDecoration, AvatarDecorationModalPreview });
    },

    wrapAvatar(original: any) {
        return (user: User, animated: boolean, size: number) => {
            if (isActive() && isCurrentUser(user?.id)) {
                const t = getTargetUser();
                if (t) return original(t, animated, size);
            }
            return original(user, animated, size);
        };
    },

    getAvatarDecorationURL(args: { user?: User; avatarDecoration?: any; canAnimate?: boolean; }) {
        if (!isActive()) return undefined;
        const { user, avatarDecoration, canAnimate } = args ?? {};
        const t = getTargetUser() as any;
        const manual = getCachedTarget()?.manualProfile;
        const spoofedAsset = t?.avatarDecorationData?.asset || manual?.avatarDecoration || manual?.decorationAsset;
        if (!spoofedAsset) return undefined;
        const callerAsset: string | undefined = avatarDecoration?.asset;
        const isOurUser = user?.id != null && isCurrentUser(user.id);
        const isOurDecoration = callerAsset === spoofedAsset;
        if (!isOurUser && !isOurDecoration) return undefined;
        const asset = canAnimate && spoofedAsset.startsWith("a_") ? spoofedAsset : spoofedAsset.replace(/^a_/, "");
        const passthrough = canAnimate && spoofedAsset.startsWith("a_") ? "" : "?passthrough=false";
        const url = `https://cdn.discordapp.com/avatar-decoration-presets/${asset}.png${passthrough}`;
        return url;
    },

    profileHook(userId: string, original: any) {
        if (!isActive() || !isCurrentUser(userId)) return original;
        const targetProfile = getTargetProfile();
        const target = getTargetUser();
        if (!targetProfile || !target) return original;
        const manual = getCachedTarget()?.manualProfile;

        const overrides: any = {};
        if (targetProfile.bio != null) overrides.bio = targetProfile.bio;
        if (targetProfile.pronouns != null) overrides.pronouns = targetProfile.pronouns;
        if (targetProfile.themeColors) overrides.themeColors = targetProfile.themeColors;
        // Always override banner / accentColor so a target without one actually clears ours.
        overrides.banner = targetProfile.banner ?? (target as any).banner ?? null;
        overrides.accentColor = targetProfile.accentColor ?? (target as any).accentColor ?? null;
        if (settings.store.spoofProfileEffect && targetProfile.profileEffect) overrides.profileEffect = targetProfile.profileEffect;
        if (settings.store.spoofProfileEffect && targetProfile.popoutAnimationParticleType != null) overrides.popoutAnimationParticleType = targetProfile.popoutAnimationParticleType;
        if (settings.store.spoofProfileEffect && targetProfile.profileEffectExpiresAt != null) overrides.profileEffectExpiresAt = targetProfile.profileEffectExpiresAt;
        if (targetProfile.premiumType != null) overrides.premiumType = targetProfile.premiumType;
        if (targetProfile.premiumSince != null) overrides.premiumSince = targetProfile.premiumSince;
        if (targetProfile.premiumGuildSince != null) overrides.premiumGuildSince = targetProfile.premiumGuildSince;

        // Gradient theme colors from accentColor2 in manual mode
        if (manual && overrides.accentColor != null) {
            const c2 = manual.accentColor2 ? Number(manual.accentColor2) : overrides.accentColor;
            overrides.themeColors = [overrides.accentColor, c2];
        }

        // Mirror the userProfile sub-object so the popout's display-name section reflects the target.
        const targetUserProfile = (targetProfile as any).userProfile ?? {};
        const spoofedDisplayName = targetUserProfile.displayName
            ?? targetUserProfile.display_name
            ?? (target as any).globalName
            ?? (target as any).username;
        overrides.userProfile = {
            ...(original?.userProfile ?? {}),
            ...targetUserProfile,
            displayName: spoofedDisplayName,
        };

        if (settings.store.spoofBadges) {
            overrides.badges = [];
        }

        if (settings.store.spoofActivities) {
            if (targetProfile.connectedAccounts) overrides.connectedAccounts = targetProfile.connectedAccounts;
            if (targetProfile.legacyApplications) overrides.legacyApplications = targetProfile.legacyApplications;
            if (targetProfile.applicationRoleConnections) overrides.applicationRoleConnections = targetProfile.applicationRoleConnections;
            if (targetProfile.userProfile) {
                overrides.userProfile = {
                    ...overrides.userProfile,
                    ...targetProfile.userProfile,
                    displayName: spoofedDisplayName,
                };
            }
        }

        const merged = safeMergeUserProfile(original, overrides, userId);
        return merged;
    },

    bannerHook({ displayProfile, user }: any) {
        if (!isActive()) return undefined;
        const id = displayProfile?.userId ?? user?.id;
        if (!isCurrentUser(id)) return undefined;
        const manualBanner = getManualBannerDataUrl();
        if (manualBanner) return manualBanner;
        const target = getTargetUser() as any;
        if (target?.banner) {
            const animated = target.banner.startsWith("a_");
            const ext = animated ? "gif" : "png";
            return `https://cdn.discordapp.com/banners/${target.id}/${target.banner}.${ext}?size=600`;
        }
        // Spoofing as someone with no banner — return empty string so the `??` patches
        // suppress the user's real banner instead of falling through to it.
        return "";
    },

    onBeforeMessageSend(channelId, msg, options) {
        if (!isActive() || !settings.store.fakeMessages) return;
        if (settings.store.sendRealToo) return;
        const target = getCachedTarget();
        if (!target) return;

        const replyRef = options?.messageReference;
        const fake = buildFakeMessage(channelId, msg.content, replyRef);
        if (!fake) return;

        try {
            FluxDispatcher.dispatch(fake);
        } catch (e) {
            logger.error("Failed to dispatch fake message", e);
        }

        ComponentDispatch.dispatchToLastSubscribed("CLEAR_TEXT");

        return { cancel: true };
    },
});
