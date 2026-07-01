/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addProfileBadge, BadgePosition, type ProfileBadge, removeProfileBadge } from "@api/Badges";
import { addContextMenuPatch, NavContextMenuPatchCallback, removeContextMenuPatch } from "@api/ContextMenu";
import { buttons, UserAreaButton, UserAreaRenderProps } from "@api/UserArea";
import BadgeAPIPlugin from "@plugins/_api/badges";
import { TestcordDevs } from "@utils/constants";
import { openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import type { User } from "@vencord/discord-types";
import { findByProps, waitFor } from "@webpack";
import { ApplicationAssetUtils, ChannelStore, FluxDispatcher, GuildMemberStore, IconUtils, Menu, PresenceStore, React, RestAPI, showToast, SnowflakeUtils, Toasts, Tooltip, UsernameUtils, UserStore } from "@webpack/common";

import { _setOriginalGetCurrentUser, clearTarget, getActiveTargetForGuild, getCachedTarget, getOriginalMeId, getRealCurrentUser, getSavedIdentityForSwitcherId, getSavedUsers, getSwitcherAccounts, isActive, isCurrentUser, isManualSavedIdentity, loadCacheFromSettings, loadTarget, logger, makeDateInRange, preLoadGuildTargets, resolveBadge, setEnabled, setSavedUsers, setTarget, settings, subscribe, targetsCache } from "./data";
import { FakeUserProfileModal } from "./legacyModal";
import { FakeUserSwitcherModal } from "./modal";

let manualActivityStartTimestamp = 0;
let resolvedLargeImageAssetId = "";
let resolvedSmallImageAssetId = "";
let resolvingAssets = false;

async function resolveManualAssets() {
    if ((!settings.store.manualMode && !settings.store.customRpcEnabled) || !settings.store.spoofActive) {
        resolvedLargeImageAssetId = "";
        resolvedSmallImageAssetId = "";
        return;
    }
    if (resolvingAssets) return;
    resolvingAssets = true;
    try {
        const large = settings.store.manualActivityLargeImage;
        const small = settings.store.manualActivitySmallImage;
        const appId = "962776363578798130";

        if (large && ApplicationAssetUtils?.fetchAssetIds) {
            try {
                const res = await ApplicationAssetUtils.fetchAssetIds(appId, [large]);
                resolvedLargeImageAssetId = res[0] || large;
            } catch {
                resolvedLargeImageAssetId = large;
            }
        } else {
            resolvedLargeImageAssetId = large || "";
        }

        if (small && ApplicationAssetUtils?.fetchAssetIds) {
            try {
                const res = await ApplicationAssetUtils.fetchAssetIds(appId, [small]);
                resolvedSmallImageAssetId = res[0] || small;
            } catch {
                resolvedSmallImageAssetId = small;
            }
        } else {
            resolvedSmallImageAssetId = small || "";
        }
    } finally {
        resolvingAssets = false;
    }
}

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

const NITRO_BADGE_ICONS = [
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
// Indexed by manualNitroLevel (0 = basic Nitro, 1 = Bronze … 8 = Opal). Each
// entry is the badge-tier age in months that the modal label promises, so the
// "Subscriber since" date lands in the right year. Aligned 1:1 with
// NITRO_TIER_NAMES / NITRO_BADGE_ICONS (all length 9).
const NITRO_TIER_MONTHS = [0, 1, 2, 3, 6, 12, 24, 36, 72];

const BOOST_BADGE_ICONS = [
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
const BOOST_MONTHS = [1, 2, 3, 6, 9, 12, 15, 18, 24];
const BOOST_MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function NitroBadgeTooltip({ icon, tierName, dateStr, premiumType }: { icon: string; tierName: string; dateStr: string; premiumType: number; }) {
    const accentColor = premiumType === 1 ? "#2dc770" : "#a970ff";
    return (
        <Tooltip
            text={
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "12px 16px", gap: 2, position: "relative", overflow: "hidden", minWidth: 120 }}>
                    <div style={{ position: "absolute", top: -20, left: -20, width: 60, height: 60, borderRadius: "50%", background: accentColor, opacity: 0.25, filter: "blur(16px)", pointerEvents: "none" }} />
                    <div style={{ position: "absolute", top: -20, right: -20, width: 60, height: 60, borderRadius: "50%", background: accentColor, opacity: 0.25, filter: "blur(16px)", pointerEvents: "none" }} />
                    <img src={icon} alt="" style={{ width: 72, height: 72, objectFit: "contain", marginBottom: 6, position: "relative" }} />
                    <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: "0.04em", lineHeight: 1.3, position: "relative", color: "#fff" }}>NITRO</div>
                    {tierName && <div style={{ fontWeight: 400, fontSize: 13, lineHeight: 1.2, position: "relative", color: "#fff" }}>{tierName.toUpperCase()}</div>}
                    <div style={{ fontSize: 12, opacity: 0.7, position: "relative", marginTop: 2 }}>Subscriber since</div>
                    <div style={{ fontSize: 12, opacity: 0.7, position: "relative" }}>{dateStr}</div>
                </div>
            }
        >
            {(tooltipProps: any) => (
                <img {...tooltipProps} src={icon} alt="Nitro" style={{ borderRadius: "50%", width: "22px", height: "22px", cursor: "pointer" }} />
            )}
        </Tooltip>
    );
}

/**
 * Resolve the spoofed avatar-decoration descriptor for the current user. The
 * `getAvatarDecorationURL` patch only rewrites the decoration's image URL once
 * a component has already decided to render a ring; this hook is what makes the
 * component decide to render one in the first place (and with which asset).
 * Without it, the avatar component reads the real user's decoration (none) and
 * falls back to the broken placeholder preset — which is the bug. Resolves from
 * the active target's avatarDecorationData (set by buildManualActiveTarget for
 * manual mode, or carried from a cloned target).
 */
function useUserAvatarDecoration(user: User): { asset: string; skuId: string; animated: boolean; } | undefined {
    if (!isActive()) return undefined;
    if (!isCurrentUser(user?.id)) return undefined;
    const t = getTargetUser() as any;
    const deco = t?.avatarDecorationData;
    const asset = deco?.asset;
    if (!asset) return undefined;
    return {
        asset,
        skuId: deco?.skuId || asset,
        animated: deco?.animated ?? asset.startsWith("a_"),
    };
}

const SNOWFLAKE_EPOCH = 1420070400000n;
function makeSnowflake(): string {
    return ((BigInt(Date.now()) - SNOWFLAKE_EPOCH) << 22n).toString();
}

function getCreatedAtFromId(id: string): Date {
    try {
        const idBin = BigInt(id);
        const timestampMs = (idBin >> 22n) + SNOWFLAKE_EPOCH;
        return new Date(Number(timestampMs));
    } catch {
        return new Date();
    }
}

function getTargetUser(guildId?: string | null): any {
    return getActiveTargetForGuild(guildId)?.user ?? null;
}

function getTargetProfile(): any {
    return getActiveTargetForGuild(undefined)?.profile ?? null;
}

function buildOverrides(active: any): Record<string, unknown> {
    const { user: target, profile, isManual, manualData } = active;

    // Overlay mode: keep the REAL identity, apply cosmetics only. We must NOT set
    // username / globalName / avatar / discriminator / id / tag here — overriding
    // identity on your own user is what makes the patched getCurrentUser resolve
    // against a second "target" that is also you, re-entering and freezing Discord.
    if (manualData?.overlaySelf) {
        const ov: Record<string, unknown> = {};
        if (target.avatarDecorationData !== undefined) ov.avatarDecorationData = target.avatarDecorationData;
        if (target.collectibles !== undefined) ov.collectibles = target.collectibles;
        ov.publicFlags = target.publicFlags ?? target.flags ?? 0;
        ov.flags = target.flags ?? 0;
        // Same premiumType≠0 guard as below (0 crashes the popout's SKU lookup).
        ov.premiumType = (() => {
            const fromProfile = profile?.premiumType;
            const fromTarget = target.premiumType;
            if (fromProfile != null && fromProfile !== 0) return fromProfile;
            if (fromTarget != null && fromTarget !== 0) return fromTarget;
            return 2;
        })();
        if (target.accentColor != null) ov.accentColor = target.accentColor;
        return ov;
    }

    const banner = target.banner ?? profile?.banner ?? null;
    const overrides: Record<string, unknown> = {
        username: target.username,
        globalName: target.globalName ?? target.global_name ?? target.username,
        global_name: target.global_name ?? target.globalName ?? target.username,
        discriminator: target.discriminator,
        avatar: target.avatar,
        banner,
        publicFlags: target.publicFlags ?? target.flags ?? 0,
        flags: target.flags ?? 0,
        // Never feed Discord premiumType=0 on a patched user — its ProductCatalog
        // has no SKU mapping for that value, which throws inside `canRedeemPremiumPerks`
        // / `canUseIncreasedMessageLength` and crashes the user popout with
        // `Cannot read properties of undefined (reading 'length')`. Prefer any
        // non-zero value from target or profile, otherwise default to 2 (Nitro)
        // — a guaranteed-valid SKU. We deliberately do NOT call back into
        // UserStore.getCurrentUser() here (even the original) because
        // buildOverrides runs inside wrapUser, which runs inside the patched
        // getCurrentUser, and any re-entry can trigger a Flux render loop that
        // freezes Discord.
        premiumType: (() => {
            const fromProfile = profile?.premiumType;
            const fromTarget = target.premiumType;
            if (fromProfile != null && fromProfile !== 0) return fromProfile;
            if (fromTarget != null && fromTarget !== 0) return fromTarget;
            return 2;
        })(),
        accentColor: target.accentColor ?? profile?.accentColor ?? null,
        usernameNormalized: typeof target.username === "string" ? target.username.toLowerCase() : undefined,
        bot: target.bot ?? false,
    };
    if (target.primaryGuild !== undefined) overrides.primaryGuild = target.primaryGuild;
    if (target.avatarDecorationData !== undefined) overrides.avatarDecorationData = target.avatarDecorationData;

    // Auto/Target mode clan tag overrides
    const profileClan = profile?.clan ?? profile?.primaryGuild ?? profile?.primary_guild ?? null;
    overrides.clan = target.clan ?? profileClan;
    overrides.primaryGuild = target.primaryGuild ?? target.primary_guild ?? profileClan;
    overrides.primary_guild = target.primary_guild ?? target.primaryGuild ?? profileClan;

    if (target.collectibles !== undefined) overrides.collectibles = target.collectibles;
    if (target.displayNameStyles !== undefined) overrides.displayNameStyles = target.displayNameStyles;
    overrides.tag = `${target.username}${target.discriminator && target.discriminator !== "0" ? `#${target.discriminator}` : ""}`;
    if (isManual) {
        if (manualData?.manualEmail) {
            overrides.email = manualData.manualEmail;
        }
        if (manualData?.manualPhone) {
            overrides.phone = manualData.manualPhone;
        }
        const dateStr = manualData?.manualCreatedAt || settings.store.manualCreatedAt;
        if (dateStr && dateStr.trim() !== "") {
            const parsedDate = new Date(dateStr);
            if (!isNaN(parsedDate.getTime())) {
                overrides.createdAt = parsedDate;
                // Do NOT override user.id — that breaks the avatar URL (CDN 404s on
                // a fake snowflake id) and Discord's "is this me" check for the
                // Edit Profile button. "Member Since" is handled by patchSnowflake /
                // spoofMemberSinceTimestamp at runtime, which intercepts
                // extractTimestamp(user.id) and returns the spoofed date.
            }
        }
        const tag = manualData?.manualClanTag || manualData?.clanTag;
        if (tag && tag.trim() !== "") {
            const guildId = manualData?.manualClanGuildId || settings.store.manualClanGuildId || "0";
            const badgeVal = resolveBadge(
                manualData?.manualClanBadge || settings.store.manualClanBadge || "",
                manualData?.manualClanBadgeCustom || settings.store.manualClanBadgeCustom || ""
            );
            const manualClan = {
                tag: tag.trim(),
                identityGuildId: guildId,
                identity_guild_id: guildId,
                identityEnabled: true,
                identity_enabled: true,
                badge: badgeVal
            };
            overrides.clan = manualClan;
            overrides.primaryGuild = manualClan;
            overrides.primary_guild = manualClan;
        } else {
            overrides.clan = null;
            overrides.primaryGuild = null;
            overrides.primary_guild = null;
        }
    } else {
        // Do NOT override id to target.id — this breaks Discord's
        // UserProfileInteractionContextProvider and hides the "Edit Profile" button.
        // The createdAt is set from the target's snowflake for display purposes only.
        overrides.createdAt = target.createdAt ?? getCreatedAtFromId(target.id);
    }
    return overrides;
}

function mergeUser(base: any, overrides: Record<string, unknown>): any {
    const wrap = Object.create(Object.getPrototypeOf(base));
    for (const key of Object.getOwnPropertyNames(base)) {
        const desc = Object.getOwnPropertyDescriptor(base, key);
        if (desc) {
            try {
                Object.defineProperty(wrap, key, desc);
            } catch { /* ignore */ }
        }
    }
    for (const sym of Object.getOwnPropertySymbols(base)) {
        const desc = Object.getOwnPropertyDescriptor(base, sym);
        if (desc) {
            try {
                Object.defineProperty(wrap, sym, desc);
            } catch { /* ignore */ }
        }
    }
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
    return wrap;
}

let wrappedUsers = new WeakMap<any, any>();

function cloneWithPremium(user: any, months: number): any {
    const clone = Object.create(Object.getPrototypeOf(user));
    for (const key of Object.getOwnPropertyNames(user)) {
        const desc = Object.getOwnPropertyDescriptor(user, key);
        if (desc) {
            try {
                Object.defineProperty(clone, key, desc);
            } catch { /* ignore */ }
        }
    }
    for (const sym of Object.getOwnPropertySymbols(user)) {
        const desc = Object.getOwnPropertyDescriptor(user, sym);
        if (desc) {
            try {
                Object.defineProperty(clone, sym, desc);
            } catch { /* ignore */ }
        }
    }
    const since = new Date();
    since.setMonth(since.getMonth() - months);
    try {
        Object.defineProperty(clone, "premiumSince", {
            value: since,
            writable: true,
            enumerable: true,
            configurable: true,
        });
        Object.defineProperty(clone, "premiumType", {
            value: 2,
            writable: true,
            enumerable: true,
            configurable: true,
        });
    } catch {
        clone.premiumSince = since;
        clone.premiumType = 2;
    }
    return clone;
}

function wrapUser(base: any): any {
    const active = getActiveTargetForGuild(undefined);
    if (!base) return base;

    if (!active || !isActive()) {
        if (settings.store.fakeNitroMonths && settings.store.fakeNitroMonths > 0 && isCurrentUser(base.id)) {
            let wrapped = wrappedUsers.get(base);
            if (!wrapped) {
                wrapped = cloneWithPremium(base, settings.store.fakeNitroMonths);
                wrappedUsers.set(base, wrapped);
            }
            return wrapped;
        }
        return base;
    }

    let wrapped = wrappedUsers.get(base);
    if (!wrapped) {
        wrapped = mergeUser(base, buildOverrides(active));
        if (active.isManual && settings.store.fakeNitroMonths && settings.store.fakeNitroMonths > 0) {
            wrapped = cloneWithPremium(wrapped, settings.store.fakeNitroMonths);
        }
        wrappedUsers.set(base, wrapped);
    }
    return wrapped;
}

let cachedManualWrap: { base: any; manualId: string; active: any; wrap: any; } | null = null;

function wrapUserForManualId(base: any, manualId: string, active: any): any {
    if (cachedManualWrap && cachedManualWrap.base === base && cachedManualWrap.manualId === manualId && cachedManualWrap.active === active) {
        return cachedManualWrap.wrap;
    }
    const overrides = {
        ...buildOverrides(active),
        id: manualId,
    };
    let wrap = mergeUser(base, overrides);
    if (settings.store.fakeNitroMonths && settings.store.fakeNitroMonths > 0) {
        wrap = cloneWithPremium(wrap, settings.store.fakeNitroMonths);
    }
    cachedManualWrap = { base, manualId, active, wrap };
    return wrap;
}

function clearWrapCache() {
    wrappedUsers = new WeakMap<any, any>();
    cachedManualWrap = null;
}

let originalGetUser: typeof UserStore.getUser | null = null;
let originalGetCurrentUser: typeof UserStore.getCurrentUser | null = null;
let originalSet: typeof buttons.set | null = null;
let originalGetUserAvatarURL: typeof IconUtils.getUserAvatarURL | null = null;
let originalGetUserBannerURL: typeof IconUtils.getUserBannerURL | null = null;
let originalGetName: typeof UsernameUtils.getName | null = null;
let originalGetGlobalName: typeof UsernameUtils.getGlobalName | null = null;
let originalGetFormattedName: typeof UsernameUtils.getFormattedName | null = null;
let originalGetUserTag: typeof UsernameUtils.getUserTag | null = null;
let originalGetStatus: typeof PresenceStore.getStatus | null = null;
let originalGetClientStatus: typeof PresenceStore.getClientStatus | null = null;
let originalGetActivities: typeof PresenceStore.getActivities | null = null;
let originalGetPrimaryActivity: typeof PresenceStore.getPrimaryActivity | null = null;
let originalGetUnfilteredActivities: typeof PresenceStore.getUnfilteredActivities | null = null;
let originalFindActivity: typeof PresenceStore.findActivity | null = null;
let originalGetApplicationActivity: typeof PresenceStore.getApplicationActivity | null = null;
let originalGetMember: typeof GuildMemberStore.getMember | null = null;
let originalGetNick: typeof GuildMemberStore.getNick | null = null;
let originalGet: any = null;

let storePatched = false;
let utilsPatched = false;
let presencePatched = false;
let memberPatched = false;
let apiPatched = false;

const SWITCHER_DROPDOWN_SELECTORS = [
    "[class*='accountProfileCard']",
    "[class*='accountOption']",
    "[class*='accountSwitcher']",
    "[class*='multiAccount']"
];

let switcherDropdownOpen = false;
let switcherDropdownObserver: MutationObserver | null = null;
let switcherDropdownCheckQueued = false;
let accountSwitcherRenderUntil = 0;

function readSwitcherDropdownOpen(): boolean {
    try {
        return SWITCHER_DROPDOWN_SELECTORS.some(sel => !!document.querySelector(sel));
    } catch {
        return false;
    }
}

function startSwitcherDropdownObserver() {
    if (switcherDropdownObserver || typeof document === "undefined") return;

    const { body } = document;
    if (!body) {
        setTimeout(startSwitcherDropdownObserver, 0);
        return;
    }

    switcherDropdownOpen = readSwitcherDropdownOpen();
    switcherDropdownObserver = new MutationObserver(() => {
        // Coalesce: class mutations fire continuously across the whole body
        // (hover, typing, animations). Schedule at most one querySelector scan
        // per frame instead of running it on every mutation record.
        if (switcherDropdownCheckQueued) return;
        switcherDropdownCheckQueued = true;
        requestAnimationFrame(() => {
            switcherDropdownCheckQueued = false;
            switcherDropdownOpen = readSwitcherDropdownOpen();
        });
    });
    switcherDropdownObserver.observe(body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class"]
    });
}

function stopSwitcherDropdownObserver() {
    switcherDropdownObserver?.disconnect();
    switcherDropdownObserver = null;
    switcherDropdownOpen = false;
    switcherDropdownCheckQueued = false;
    accountSwitcherRenderUntil = 0;
}

function markAccountSwitcherRendering() {
    accountSwitcherRenderUntil = Date.now() + 1500;
}

function isAccountSwitcherCall(): boolean {
    // switcherDropdownOpen is updated async (rAF-coalesced), so for up to a frame
    // after the dropdown opens it's still false — during which getCurrentUser/getUser
    // would hand the switcher a wrapped (fake) user and Discord renders the row as an
    // "Unclaimed Account". The render window stamped synchronously by injectFakes
    // (getUsers is the earliest reliable signal the switcher is rendering) closes that
    // gap. Do NOT do a synchronous DOM querySelector here: this runs inside the patched
    // getCurrentUser/getUser on every call, and the hover tooltip's layer matches the
    // broad switcher selectors → flips the result mid-render → re-entrant render loop
    // that freezes Discord on hover.
    return switcherDropdownOpen || (accountSwitcherRenderUntil > 0 && Date.now() < accountSwitcherRenderUntil);
}

let isGettingUsers = false;

function patchStore() {
    if (storePatched) return;
    storePatched = true;

    originalGetUser = UserStore.getUser;
    originalGetCurrentUser = UserStore.getCurrentUser;

    // Capture the real current-user id BEFORE wrapping, otherwise getOriginalMeId
    // would read the wrapped (fake) id and break isCurrentUser checks.
    try { _setOriginalGetCurrentUser(originalGetCurrentUser); } catch { /* ignore */ }

    UserStore.getUser = function (userId: string) {
        if (isGettingUsers || isAccountSwitcherCall()) {
            return originalGetUser!.call(this, userId);
        }
        if (isActive()) {
            const active = getActiveTargetForGuild(undefined);
            const originalMeId = getOriginalMeId();
            if (active) {
                if (userId === originalMeId) {
                    const me = originalGetCurrentUser!.call(UserStore);
                    if (me) return wrapUser(me);
                } else if (userId === active.user.id) {
                    if (active.isManual) {
                        const me = originalGetCurrentUser!.call(UserStore);
                        if (me) return wrapUserForManualId(me, active.user.id, active);
                    } else {
                        const u = originalGetUser!.call(this, userId);
                        if (u) return wrapUser(u);
                    }
                }
            }
        }
        const u = originalGetUser!.call(this, userId);
        if (!isActive()) {
            if (u && isCurrentUser(userId) && settings.store.fakeNitroMonths && settings.store.fakeNitroMonths > 0) {
                return wrapUser(u);
            }
            return u;
        }
        if (!u) return u;
        if (!isCurrentUser(userId)) return u;
        return wrapUser(u);
    };

    UserStore.getCurrentUser = function () {
        const u = originalGetCurrentUser!.call(this);
        if (isGettingUsers || isAccountSwitcherCall()) {
            return u;
        }
        if (!isActive()) {
            if (u && settings.store.fakeNitroMonths && settings.store.fakeNitroMonths > 0) {
                return wrapUser(u);
            }
            return u;
        }
        if (settings.store.patchInternalAccountSwitcher && isAccountSwitcherCall()) {
            return u;
        }
        return wrapUser(u);
    };

    if (GuildMemberStore && !memberPatched) {
        originalGetMember = GuildMemberStore.getMember;
        GuildMemberStore.getMember = function (guildId: string, userId: string) {
            const m = originalGetMember!.call(this, guildId, userId);
            if (isActive(guildId) && isCurrentUser(userId)) {
                const active = getActiveTargetForGuild(guildId);
                // Overlay mode keeps your REAL identity — return your genuine member
                // (real nick/name) so sent messages and the member list show you, not
                // "FakeUser". Cosmetics are applied elsewhere, not via the member nick.
                if (active?.manualData?.overlaySelf) return m;
                if (active) {
                    if (active.isManual) {
                        const nick = active.manualData?.manualUsername || active.manualData?.name || "FakeUser";
                        const manualClan = active.user.clan;
                        if (m) {
                            return {
                                ...m,
                                nick,
                                clan: manualClan,
                                primaryGuild: manualClan,
                                primary_guild: manualClan,
                            };
                        }
                        return {
                            nick,
                            userId,
                            roles: [],
                            joinedAt: new Date().toISOString(),
                            clan: manualClan,
                            primaryGuild: manualClan,
                            primary_guild: manualClan,
                        } as any;
                    } else {
                        const target = active.user;
                        const targetMember = originalGetMember!.call(this, guildId, target.id);
                        const nick = targetMember?.nick || target.globalName || target.global_name || target.username;
                        const targetProfile = active.profile;
                        const clan = targetProfile?.clan ?? target?.clan ?? null;
                        const primaryGuild = targetProfile?.primaryGuild ?? targetProfile?.primary_guild ?? target?.primaryGuild ?? target?.primary_guild ?? null;
                        const primary_guild = targetProfile?.primary_guild ?? targetProfile?.primaryGuild ?? target?.primary_guild ?? target?.primaryGuild ?? null;

                        if (m) {
                            return {
                                ...m,
                                nick,
                                clan,
                                primaryGuild,
                                primary_guild,
                            };
                        }
                        return {
                            nick,
                            userId,
                            roles: [],
                            joinedAt: new Date().toISOString(),
                            clan,
                            primaryGuild,
                            primary_guild,
                        } as any;
                    }
                }
            }
            return m;
        };

        originalGetNick = GuildMemberStore.getNick;
        GuildMemberStore.getNick = function (guildId: string, userId: string) {
            if (isActive(guildId) && isCurrentUser(userId)) {
                const active = getActiveTargetForGuild(guildId);
                // Overlay mode keeps your REAL nick — fall through to the original.
                if (active?.manualData?.overlaySelf) return originalGetNick!.call(this, guildId, userId);
                if (active) {
                    if (active.isManual) {
                        return active.manualData?.manualUsername || active.manualData?.name || "FakeUser";
                    } else {
                        const target = active.user;
                        const targetMember = originalGetMember!.call(this, guildId, target.id);
                        return targetMember?.nick || target.globalName || target.global_name || target.username;
                    }
                }
            }
            return originalGetNick!.call(this, guildId, userId);
        };
        memberPatched = true;
    }
    if (RestAPI && !apiPatched) {
        originalGet = RestAPI.get;
        RestAPI.get = function (options: any) {
            if (isActive()) {
                const url = typeof options === "string" ? options : options?.url;
                if (typeof url === "string") {
                    const match = url.match(/\/content-inventory\/users\/(\d+)\/outbox/);
                    if (match) {
                        const userId = match[1];
                        if (isCurrentUser(userId)) {
                            if (settings.store.manualMode) {
                                return Promise.resolve({ body: { entries: [] } });
                            } else {
                                const target = getCachedTarget();
                                if (target) {
                                    const nextOptions = typeof options === "string" ? options.replace(userId, target.id) : {
                                        ...options,
                                        url: url.replace(userId, target.id)
                                    };
                                    return originalGet.call(this, nextOptions).catch(() => {
                                        return { body: { entries: [] } };
                                    });
                                }
                            }
                        }
                    }
                    const profileMatch = url.match(/\/users\/([a-zA-Z0-9_@]+)\/profile/);
                    if (profileMatch) {
                        let userId = profileMatch[1];
                        const originalId = getOriginalMeId();
                        if (userId === "@me") {
                            userId = originalId;
                        }
                        if (userId && isCurrentUser(userId)) {
                            const nextOptions = typeof options === "string"
                                ? options.replace(/\/users\/[a-zA-Z0-9_@]+\/profile/, `/users/${originalId}/profile`)
                                : {
                                    ...options,
                                    url: url.replace(/\/users\/[a-zA-Z0-9_@]+\/profile/, `/users/${originalId}/profile`)
                                };
                            return originalGet.call(this, nextOptions).then((res: any) => {
                                if (res && res.body) {
                                    res.body = plugin.profileHook(userId, res.body);
                                }
                                return res;
                            });
                        }
                    }
                }
            }
            return originalGet.call(this, options);
        };
        apiPatched = true;
    }
}

function unpatchStore() {
    if (!storePatched) return;
    if (originalGetUser) UserStore.getUser = originalGetUser;
    if (originalGetCurrentUser) UserStore.getCurrentUser = originalGetCurrentUser;
    if (memberPatched && GuildMemberStore) {
        if (originalGetMember) GuildMemberStore.getMember = originalGetMember;
        if (originalGetNick) GuildMemberStore.getNick = originalGetNick;
        memberPatched = false;
    }

    if (apiPatched && RestAPI) {
        if (originalGet) RestAPI.get = originalGet;
        apiPatched = false;
    }

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

    IconUtils.getUserAvatarURL = function (user: any, animated?: any, size?: any, format?: any) {
        if (isActive() && user && (isCurrentUser(user.id) || user.id === "0")) {
            const active = getActiveTargetForGuild(undefined);
            if (active) {
                // Overlay mode keeps the REAL account's avatar — only cosmetics are
                // applied on top, identity (incl. pfp) stays the logged-in user.
                if (active.manualData?.overlaySelf) {
                    return originalGetUserAvatarURL!.call(this, user, animated, size, format);
                }
                if (active.isManual) {
                    return active.manualData?.manualAvatar || active.manualData?.avatar || "https://cdn.discordapp.com/embed/avatars/0.png";
                }
                const t = active.user;
                if (t) return originalGetUserAvatarURL!.call(this, t, animated, size, format);
            }
        }
        return originalGetUserAvatarURL!.call(this, user, animated, size, format);
    };

    IconUtils.getUserBannerURL = function (params: any) {
        if (isActive(params?.guildId ?? params?.guild_id) && params && isCurrentUser(params.id)) {
            const active = getActiveTargetForGuild(params.guildId ?? params.guild_id);
            if (active) {
                // Overlay mode: use the overlay banner if the user set one, otherwise
                // fall through to the REAL account's banner (the default).
                if (active.manualData?.overlaySelf) {
                    const ovDataUrl = active.manualData?.manualOverlayBannerDataUrl;
                    if (ovDataUrl) return ovDataUrl;
                    const ovBanner = active.manualData?.manualOverlayBanner;
                    if (ovBanner && !ovBanner.startsWith("#")) return ovBanner;
                    return originalGetUserBannerURL!.call(this, params);
                }
                if (active.isManual) {
                    const dataUrl = active.manualData?.manualBannerDataUrl;
                    if (dataUrl) return dataUrl;
                    const banner = active.manualData?.manualBanner || active.manualData?.banner;
                    if (banner && !banner.startsWith("#")) {
                        return banner;
                    }
                    return originalGetUserBannerURL!.call(this, params);
                }
                const t = active.user;
                const targetBanner = params.banner ?? t?.banner ?? active.profile?.banner;
                if (t && targetBanner) {
                    return originalGetUserBannerURL!.call(this, { ...params, id: t.id, banner: targetBanner });
                }
            }
        }
        return originalGetUserBannerURL!.call(this, params);
    };

    // When manual mode is active (especially with a spoofed creation date that makes
    // the synthetic user.id a fake snowflake not present in UserStore), do NOT hand
    // the synthetic user back to Discord's name selectors — they internally re-query
    // UserStore.getUser(syntheticId), which round-trips through our patch and can end
    // up returning the raw real user, breaking the displayed name in the user-area
    // popout and the full profile popup. Instead, short-circuit and return the spoofed
    // display name directly.
    function getManualDisplayName(): string | undefined {
        const active = getActiveTargetForGuild(undefined);
        if (!active?.isManual) return undefined;
        // Overlay mode keeps your REAL name — return undefined so name resolvers fall
        // through to the genuine account instead of the spoofed "FakeUser".
        if (active.manualData?.overlaySelf) return undefined;
        const md = active.manualData;
        return (
            md?.manualDisplayName
            || md?.manualUsername
            || md?.name
            || (active.user as any)?.globalName
            || (active.user as any)?.global_name
            || (active.user as any)?.username
            || "FakeUser"
        );
    }

    function getManualUsername(): string | undefined {
        const active = getActiveTargetForGuild(undefined);
        if (!active?.isManual) return undefined;
        if (active.manualData?.overlaySelf) return undefined;
        const md = active.manualData;
        return md?.manualUsername || md?.name || (active.user as any)?.username || "FakeUser";
    }

    // Overlay mode keeps your real identity — never override your name in any name
    // resolver, so messages, the member list, etc. all show your genuine account.
    const isOverlayActive = () => !!getActiveTargetForGuild(undefined)?.manualData?.overlaySelf;

    UsernameUtils.getName = function (user: User) {
        if (isActive() && !isOverlayActive() && user && isCurrentUser(user.id)) {
            const manualName = getManualDisplayName();
            if (manualName != null) return manualName;
            const t = getTargetUser();
            if (t) return originalGetName!.call(this, t);
        }
        return originalGetName!.call(this, user);
    };

    UsernameUtils.getGlobalName = function (user: User) {
        if (isActive() && !isOverlayActive() && user && isCurrentUser(user.id)) {
            const manualName = getManualDisplayName();
            if (manualName != null) return manualName;
            const t = getTargetUser();
            if (t) return originalGetGlobalName!.call(this, t);
        }
        return originalGetGlobalName!.call(this, user);
    };

    UsernameUtils.getFormattedName = function (user: User, useTag?: boolean) {
        if (isActive() && !isOverlayActive() && user && isCurrentUser(user.id)) {
            const manualName = getManualDisplayName();
            if (manualName != null) {
                if (useTag) {
                    const uname = getManualUsername();
                    return uname ? `${manualName} (${uname})` : manualName;
                }
                return manualName;
            }
            const t = getTargetUser();
            if (t) return originalGetFormattedName!.call(this, t, useTag);
        }
        return originalGetFormattedName!.call(this, user, useTag);
    };

    UsernameUtils.getUserTag = function (user: User, options?: any) {
        if (isActive() && !isOverlayActive() && user && isCurrentUser(user.id)) {
            const t = getTargetUser();
            if (t) {
                // Build a synthetic user that carries the spoofed manual names so
                // Discord's own getUserTag formats them correctly per `options`,
                // without us guessing the format string.
                const manualName = getManualDisplayName();
                const manualUname = getManualUsername();
                if (manualName != null || manualUname != null) {
                    const synth = {
                        ...t,
                        username: manualUname ?? (t as any).username,
                        globalName: manualName ?? (t as any).globalName,
                        global_name: manualName ?? (t as any).global_name,
                    };
                    return originalGetUserTag!.call(this, synth as any, options);
                }
                return originalGetUserTag!.call(this, t, options);
            }
        }
        return originalGetUserTag!.call(this, user, options);
    };

    // INTENTIONALLY NOT PATCHING useName / useUserTag.
    //
    // These are React hooks. Monkey-patching a hook at runtime is unsafe because
    // the hook's internal call count can shift between renders when its input
    // (the `user` object) changes shape — which is exactly what happens when
    // spoofing flips on, because UserStore.getCurrentUser starts returning a
    // wrapped user with a different id. React then crashes with
    // "Should have a queue. You are likely calling Hooks conditionally".
    //
    // The non-hook getters above (getName / getGlobalName / getFormattedName /
    // getUserTag) already cover every name-display path. The synthetic
    // USER_UPDATE dispatch from notifyUpdate() will cause any component using
    // useName/useUserTag to re-render, and on re-render those hooks read from
    // UserStore.getUser — which IS patched — so the spoofed name still appears.
}

function unpatchUtils() {
    if (!utilsPatched) return;
    if (originalGetUserAvatarURL) IconUtils.getUserAvatarURL = originalGetUserAvatarURL;
    if (originalGetUserBannerURL) IconUtils.getUserBannerURL = originalGetUserBannerURL;
    if (originalGetName) UsernameUtils.getName = originalGetName;
    if (originalGetGlobalName) UsernameUtils.getGlobalName = originalGetGlobalName;
    if (originalGetFormattedName) UsernameUtils.getFormattedName = originalGetFormattedName;
    if (originalGetUserTag) UsernameUtils.getUserTag = originalGetUserTag;
    utilsPatched = false;
}

function getManualActivityListFor(manualData: any) {
    if (!manualData) return [];
    if (manualData.manualActivityName || manualData.activity) {
        const name = manualData.manualActivityName || manualData.activity;
        const type = Number(manualData.manualActivityType ?? 0);
        const activity: any = {
            id: "manual-activity",
            type,
            createdAt: Date.now()
        };

        if (type === 4) { // Custom Status
            activity.name = "Custom Status";
            activity.state = name;
        } else {
            activity.name = name;
            activity.state = manualData.manualActivityState || undefined;
            activity.details = manualData.manualActivityDetails || undefined;
        }

        if (manualData.manualActivityStartTimer) {
            if (!manualActivityStartTimestamp) {
                manualActivityStartTimestamp = Date.now();
            }
            activity.timestamps = {
                start: manualActivityStartTimestamp
            };
        } else {
            manualActivityStartTimestamp = 0;
        }

        const assets: any = {};
        const largeImg = resolvedLargeImageAssetId || manualData.manualActivityLargeImage;
        if (largeImg) {
            assets.large_image = largeImg;
            if (manualData.manualActivityLargeText) {
                assets.large_text = manualData.manualActivityLargeText;
            }
        }
        const smallImg = resolvedSmallImageAssetId || manualData.manualActivitySmallImage;
        if (smallImg) {
            assets.small_image = smallImg;
            if (manualData.manualActivitySmallText) {
                assets.small_text = manualData.manualActivitySmallText;
            }
        }
        if (Object.keys(assets).length > 0) {
            activity.assets = assets;
            activity.application_id = "962776363578798130"; // Dummy application ID to trigger image rendering
        }

        return [activity];
    }
    if (manualActivityStartTimestamp) {
        manualActivityStartTimestamp = 0;
    }
    return [];
}

let _origExtractTimestamp: ((id: string) => number) | null = null;
let _snowflakePatchTimer: any = null;
function patchSnowflake() {
    if (_origExtractTimestamp) return;
    let su: any = SnowflakeUtils;
    if (!su?.extractTimestamp) {
        try { su = (window as any).Vencord?.Webpack?.findByProps?.("extractTimestamp", "fromTimestamp"); } catch { /* ignore */ }
    }
    if (!su?.extractTimestamp) {
        if (!_snowflakePatchTimer) {
            _snowflakePatchTimer = setInterval(() => {
                patchSnowflake();
                if (_origExtractTimestamp && _snowflakePatchTimer) {
                    clearInterval(_snowflakePatchTimer);
                    _snowflakePatchTimer = null;
                }
            }, 500);
        }
        return;
    }
    try {
        _origExtractTimestamp = su.extractTimestamp.bind(su);
        const orig = _origExtractTimestamp!;
        const wrapped = function (id: string) {
            try {
                if (id && typeof id === "string" && id === getOriginalMeId()) {
                    const spoofed = plugin.spoofMemberSinceTimestamp(id);
                    if (spoofed != null) return spoofed;
                }
            } catch { /* ignore */ }
            return orig(id);
        };
        try { su.extractTimestamp = wrapped; } catch { /* ignore */ }
        try { Object.defineProperty(su, "extractTimestamp", { value: wrapped, writable: true, configurable: true, enumerable: true }); } catch { /* ignore */ }
    } catch { /* ignore */ }
}
function unpatchSnowflake() {
    if (_snowflakePatchTimer) { clearInterval(_snowflakePatchTimer); _snowflakePatchTimer = null; }
    if (_origExtractTimestamp) {
        const su: any = SnowflakeUtils ?? (typeof window !== "undefined" ? (window as any).Vencord?.Webpack?.findByProps?.("extractTimestamp", "fromTimestamp") : null);
        try { if (su) su.extractTimestamp = _origExtractTimestamp; } catch { /* ignore */ }
        _origExtractTimestamp = null;
    }
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
        const id = userId ?? UserStore.getCurrentUser()?.id;
        if (isActive() && id && isCurrentUser(id)) {
            if (settings.store.spoofedStatus && settings.store.spoofedStatus !== "none") {
                return settings.store.spoofedStatus;
            }
            const active = getActiveTargetForGuild(guildId);
            if (active) {
                if (active.isManual) {
                    return active.manualData?.manualStatus || active.manualData?.status || "online";
                }
                const target = active.user;
                if (target && target.id !== "0") {
                    return originalGetStatus!.call(this, target.id, guildId, defaultStatus);
                }
            }
            return "offline";
        }
        return originalGetStatus!.call(this, userId, guildId, defaultStatus);
    };

    PresenceStore.getClientStatus = function (userId: string): any {
        const id = userId ?? UserStore.getCurrentUser()?.id;
        if (isActive() && id && isCurrentUser(id)) {
            if (settings.store.spoofedStatus && settings.store.spoofedStatus !== "none") {
                const status = settings.store.spoofedStatus;
                return { desktop: status, web: status, mobile: status } as any;
            }
            const active = getActiveTargetForGuild(undefined);
            if (active) {
                if (active.isManual) {
                    const status = active.manualData?.manualStatus || active.manualData?.status || "online";
                    return { desktop: status, web: status, mobile: status } as any;
                }
                const target = active.user;
                if (target && target.id !== "0") {
                    return originalGetClientStatus!.call(this, target.id);
                }
            }
            return {} as any;
        }
        return originalGetClientStatus!.call(this, userId);
    };

    function getCurrentActivityList(this: any, active: any, guildId?: string): any[] {
        if (settings.store.customRpcEnabled) {
            const manualData = active.isManual ? active.manualData : {
                manualActivityName: settings.store.manualActivityName,
                manualActivityType: settings.store.manualActivityType,
                manualActivityState: settings.store.manualActivityState,
                manualActivityDetails: settings.store.manualActivityDetails,
                manualActivityStartTimer: settings.store.manualActivityStartTimer,
                manualActivityLargeImage: settings.store.manualActivityLargeImage,
                manualActivityLargeText: settings.store.manualActivityLargeText,
                manualActivitySmallImage: settings.store.manualActivitySmallImage,
                manualActivitySmallText: settings.store.manualActivitySmallText,
            };
            return getManualActivityListFor(manualData);
        }
        if (active.isManual) {
            return [];
        }
        const target = active.user;
        if (target && target.id !== "0") {
            return originalGetActivities!.call(this, target.id, guildId) ?? [];
        }
        return [];
    }

    PresenceStore.getActivities = function (userId: string, guildId?: string): any {
        const id = userId ?? UserStore.getCurrentUser()?.id;
        if (isActive() && id && isCurrentUser(id)) {
            const active = getActiveTargetForGuild(guildId);
            if (active) {
                return getCurrentActivityList.call(this, active, guildId);
            }
            return [];
        }
        return originalGetActivities!.call(this, userId, guildId);
    };

    PresenceStore.getPrimaryActivity = function (userId: string, guildId?: string): any {
        const id = userId ?? UserStore.getCurrentUser()?.id;
        if (isActive() && id && isCurrentUser(id)) {
            const active = getActiveTargetForGuild(guildId);
            if (active) {
                const acts = getCurrentActivityList.call(this, active, guildId);
                return acts[0] ?? null;
            }
            return null;
        }
        return originalGetPrimaryActivity!.call(this, userId, guildId);
    };

    PresenceStore.getUnfilteredActivities = function (userId: string, guildId?: string): any {
        const id = userId ?? UserStore.getCurrentUser()?.id;
        if (isActive() && id && isCurrentUser(id)) {
            const active = getActiveTargetForGuild(guildId);
            if (active) {
                return getCurrentActivityList.call(this, active, guildId);
            }
            return [];
        }
        return originalGetUnfilteredActivities!.call(this, userId, guildId);
    };

    PresenceStore.findActivity = function (userId: string, predicate: any, guildId?: string): any {
        const id = userId ?? UserStore.getCurrentUser()?.id;
        if (isActive() && id && isCurrentUser(id)) {
            const active = getActiveTargetForGuild(guildId);
            if (active) {
                const acts = getCurrentActivityList.call(this, active, guildId);
                return acts.find(predicate);
            }
            return undefined;
        }
        return originalFindActivity!.call(this, userId, predicate, guildId);
    };

    PresenceStore.getApplicationActivity = function (userId: string, applicationId: string, guildId?: string): any {
        const id = userId ?? UserStore.getCurrentUser()?.id;
        if (isActive() && id && isCurrentUser(id)) {
            const active = getActiveTargetForGuild(guildId);
            if (active) {
                const acts = getCurrentActivityList.call(this, active, guildId);
                return acts[0] ?? null; // simple fallback
            }
            return null;
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

let originalGetTestcordCustomBadges: any = null;
let badgesPatched = false;

function getSpoofedCreatedAtMs(): number | null {
    const active = getActiveTargetForGuild(undefined);
    if (!active) return null;
    if (active.isManual) {
        const dateStr = active.manualData?.manualCreatedAt || settings.store.manualCreatedAt;
        if (!dateStr || dateStr.trim() === "") return null;
        // Match the same parsing rules used by getFakeIdFromDate so the popout's
        // displayed "Member Since" matches the snowflake id we generated for the
        // manual user. A bare YYYY-MM-DD is parsed in local time (mid-day) to
        // avoid timezone rollover making the displayed day off-by-one.
        let d: Date;
        const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
        if (ymd) {
            d = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]), 12, 0, 0, 0);
        } else {
            d = new Date(dateStr);
        }
        return isNaN(d.getTime()) ? null : d.getTime();
    }
    const t = active.user;
    if (!t) return null;
    if (t.createdAt instanceof Date) return t.createdAt.getTime();
    if (typeof t.createdAt === "string") {
        const d = new Date(t.createdAt);
        if (!isNaN(d.getTime())) return d.getTime();
    }
    return getCreatedAtFromId(t.id).getTime();
}

function patchBadges() {
    if (badgesPatched) return;
    if (typeof BadgeAPIPlugin?.getTestCordCustomBadges !== "function") return;
    badgesPatched = true;
    originalGetTestcordCustomBadges = BadgeAPIPlugin.getTestCordCustomBadges.bind(BadgeAPIPlugin);
    BadgeAPIPlugin.getTestCordCustomBadges = function (userId: string) {
        if (settings.store.spoofBadges && isActive() && isCurrentUser(userId)) {
            const target = getTargetUser();
            if (target && target.id !== "0") return originalGetTestcordCustomBadges(target.id);
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
    setTimeout(() => {
        try {
            FluxDispatcher.dispatch({ type: "USER_UPDATE", user: me });
            // Do NOT dispatch CURRENT_USER_UPDATE with a spread (`{...me}`): `me` is a
            // User class instance whose email/username/verified live on the prototype,
            // so a shallow spread drops them. Discord's CURRENT_USER_UPDATE reducer then
            // writes that stripped object into your REAL account state — blanking your
            // username/email and triggering the "claim your account" banner. Under heavy
            // message sending notifyUpdate runs often enough that the blank state sticks.
            // USER_UPDATE above already drives the re-renders we need.
            FluxDispatcher.dispatch({ type: "USER_SETTINGS_PROTO_UPDATE", settings: { type: 1, proto: {} } });
            FluxDispatcher.dispatch({ type: "IDLE" });
        } catch (e) {
            logger.warn("USER_UPDATE dispatch failed", e);
        }
        try {
            UserStore.emitChange();
            PresenceStore.emitChange();
            GuildMemberStore?.emitChange?.();
        } catch (e) {
            logger.warn("Manual emitChange failed", e);
        }
    }, 0);
}

function syncSpoofState() {
    const generation = switcherGeneration;
    clearWrapCache();
    resolveManualAssets().then(() => {
        if (generation !== switcherGeneration) return;
        notifyUpdate();
    });
}

function FakeUserSwitcherIcon({ className, style }: { className?: string; style?: React.CSSProperties; }) {
    const active = isActive();
    return (
        <svg className={className} style={style} width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path fill={active ? "var(--status-danger)" : "currentColor"} d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2a7.2 7.2 0 0 1-6-3.22c.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08a7.2 7.2 0 0 1-6 3.22z" />
            {active && <path fill="var(--status-danger)" d="M22.7 2.7a1 1 0 0 0-1.4-1.4l-20 20a1 1 0 1 0 1.4 1.4Z" />}
        </svg>
    );
}

function FakeUserSwitcherButton({ iconForeground, hideTooltips, nameplate }: UserAreaRenderProps) {
    const [, force] = React.useReducer(x => x + 1, 0);
    React.useEffect(() => subscribe(() => force()), []);

    const activeTarget = getActiveTargetForGuild(undefined);
    const active = !!activeTarget;

    let displayName = "Fake User Switcher";
    if (activeTarget) {
        if (activeTarget.isManual) {
            displayName = activeTarget.user.username;
        } else {
            displayName = activeTarget.user.globalName || activeTarget.user.global_name || activeTarget.user.username;
        }
    }

    const tooltip = hideTooltips
        ? undefined
        : active
            ? `Spoofing as ${displayName} — click to manage`
            : "Fake User Switcher";

    return (
        <UserAreaButton
            tooltipText={tooltip}
            icon={<FakeUserSwitcherIcon className={iconForeground} />}
            role="button"
            plated={nameplate != null}
            redGlow={active}
            onClick={() => {
                if (settings.store.uiMode === "legacy") {
                    openModal(modalProps => <FakeUserProfileModal modalProps={modalProps as any} />);
                } else {
                    openModal(modalProps => <FakeUserSwitcherModal modalProps={modalProps as any} />);
                }
            }}
            onContextMenu={() => {
                const target = getCachedTarget();
                if (settings.store.manualMode) {
                    setEnabled(!settings.store.spoofActive);
                    force();
                    return;
                }
                if (!target) {
                    if (settings.store.uiMode === "legacy") {
                        openModal(modalProps => <FakeUserProfileModal modalProps={modalProps as any} />);
                    } else {
                        openModal(modalProps => <FakeUserSwitcherModal modalProps={modalProps as any} />);
                    }
                    return;
                }
                setEnabled(!settings.store.spoofActive);
                force();
            }}
        />
    );
}

const dynamicBadge: ProfileBadge = {
    id: "fakeuserswitcher-target",
    description: "Fake User Switcher",
    position: BadgePosition.END,
    shouldShow: ({ userId }) => settings.store.spoofBadges && isActive() && isCurrentUser(userId),
    getBadges: () => {
        const target = getTargetUser();
        if (!target) return [];

        const flags = (target as any).publicFlags ?? (target as any).flags ?? 0;
        const badges: ProfileBadge[] = [];

        for (const fb of FLAG_BADGES) {
            if ((flags & fb.flag) === fb.flag) {
                badges.push({
                    id: `fakeuserswitcher-flag-${fb.flag}`,
                    description: fb.description,
                    iconSrc: fb.image,
                    position: BadgePosition.END,
                });
            }
        }

        const active = getActiveTargetForGuild(undefined);
        const manual = active?.isManual ? active.manualData : null;

        // Parse a user-entered YYYY-MM-DD (or any Date-parseable string) to a Date,
        // mid-day local to avoid timezone day-rollover. Returns null when blank/invalid
        // so callers fall back to the auto makeDateInRange date.
        const parseManualSince = (raw: string | undefined | null): Date | null => {
            if (!raw || raw.trim() === "") return null;
            const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
            const d = ymd
                ? new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]), 12, 0, 0, 0)
                : new Date(raw);
            return isNaN(d.getTime()) ? null : d;
        };

        const premium = (target as any).premiumType ?? 0;
        if (premium >= 1) {
            const nitroLevel: number = manual?.manualNitroLevel ?? -1;
            const icon = nitroLevel >= 0 && nitroLevel < NITRO_BADGE_ICONS.length ? NITRO_BADGE_ICONS[nitroLevel] : NITRO_BADGE_ICONS[0];
            const tierName = nitroLevel >= 0 && nitroLevel < NITRO_TIER_NAMES.length ? NITRO_TIER_NAMES[nitroLevel] : "";
            let dateStr = "";
            if (nitroLevel != null && nitroLevel >= 1) {
                // Prefer the user-specified 'Nitro since' date; fall back to the auto date.
                const manualSince = parseManualSince(manual?.manualNitroSince);
                const nitroDate = manualSince ?? makeDateInRange(
                    target.id,
                    NITRO_TIER_MONTHS[nitroLevel] ?? 1,
                    NITRO_TIER_MONTHS[nitroLevel + 1] ?? (NITRO_TIER_MONTHS[nitroLevel] ?? 1) + 12
                );
                dateStr = `${nitroDate.getMonth() + 1}/${nitroDate.getDate()}/${String(nitroDate.getFullYear()).slice(-2)}`;
            }
            const description = dateStr ? `NITRO ${tierName}\nSubscriber since ${dateStr}` : (tierName ? `NITRO ${tierName}` : "Discord Nitro");
            badges.push({
                id: "fakeuserswitcher-nitro",
                description,
                iconSrc: icon,
                position: BadgePosition.END,
                props: { style: { borderRadius: "50%", width: "22px", height: "22px" } },
                component: () => (
                    <NitroBadgeTooltip icon={icon} tierName={tierName} dateStr={dateStr} premiumType={premium} />
                ),
            });
        }

        // Boost tier badge (manual mode only — derived from the chosen boost tier)
        const boostMonths: number = manual?.manualBoostMonths ?? -1;
        if (boostMonths >= 0 && boostMonths < BOOST_BADGE_ICONS.length) {
            // Prefer the user-specified 'Boosting since' date; fall back to the auto date.
            const manualBoostSince = parseManualSince(manual?.manualBoostSince);
            const boostDate = manualBoostSince ?? makeDateInRange(
                target.id,
                BOOST_MONTHS[boostMonths] ?? 1,
                BOOST_MONTHS[boostMonths + 1] ?? (BOOST_MONTHS[boostMonths] ?? 1) + 6
            );
            const dateStr = `${BOOST_MONTH_NAMES[boostDate.getMonth()]} ${boostDate.getDate()}, ${boostDate.getFullYear()}`;
            badges.push({
                id: "fakeuserswitcher-boost",
                description: `Server boosting since ${dateStr}`,
                iconSrc: BOOST_BADGE_ICONS[boostMonths],
                position: BadgePosition.END,
            });
        }

        return badges;
    },
};

function buildFakeMessage(channelId: string, content: string, replyMessageReference: any) {
    const channel = ChannelStore.getChannel?.(channelId);
    const guildId = channel?.guild_id;
    const u = getTargetUser(guildId);
    if (!u) return null;

    const id = makeSnowflake();

    return {
        type: "MESSAGE_CREATE" as const,
        channelId,
        message: {
            attachments: [],
            author: {
                id: u.id,
                username: u.username,
                avatar: u.avatar === "manual" ? null : u.avatar,
                discriminator: u.discriminator,
                public_flags: u.publicFlags ?? u.flags ?? 0,
                premium_type: u.premiumType ?? 0,
                flags: u.flags ?? 0,
                banner: u.banner,
                accent_color: u.accentColor ?? null,
                global_name: u.globalName ?? u.global_name ?? null,
                avatar_decoration_data: u.avatarDecorationData
                    ? { asset: u.avatarDecorationData.asset, sku_id: u.avatarDecorationData.skuId }
                    : null,
                banner_color: null,
                bot: u.bot ?? false,
            },
            member: {
                nick: u.globalName ?? u.global_name ?? u.username,
                roles: [],
                joined_at: new Date().toISOString(),
                deaf: false,
                mute: false,
                flags: 0,
                clan: u.clan ?? null,
                primary_guild: u.primary_guild ?? u.primaryGuild ?? null,
                primaryGuild: u.primaryGuild ?? u.primary_guild ?? null,
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
const userContextMenuPatch: NavContextMenuPatchCallback = (children, { user }) => {
    if (!user || isCurrentUser(user.id)) return;

    children.push(
        <Menu.MenuSeparator />,
        <Menu.MenuItem
            id="fake-user-switcher-clone"
            label="Clone User to Fake User Switcher"
            action={async () => {
                showToast(`Cloning profile of ${user.username}...`, Toasts.Type.MESSAGE);
                try {
                    await loadTarget(user.id);
                    setEnabled(true);
                    settings.store.manualMode = false;
                    showToast(`Spoofing as ${user.username}!`, Toasts.Type.SUCCESS);
                } catch (e: any) {
                    logger.error("Context menu clone failed", e);
                    showToast(e?.message || "Failed to clone user profile.", Toasts.Type.FAILURE);
                }
            }}
        />
    );
};

let multiAccountStore: any = null;
let switcherRunning = false;
let switcherGeneration = 0;
let originalMultiGetUsers: any = null;
let originalMultiGetValidUsers: any = null;
let originalMultiGetHasLoggedInAccounts: any = null;
let multiAuthModule: any = null;
let originalSwitchAccount: any = null;
let switcherClickInterceptor: ((event: MouseEvent) => void) | null = null;

function isHttpUrl(value: unknown): value is string {
    return typeof value === "string" && /^(https?:|data:)/.test(value);
}

function normalizeSwitcherAvatar(user: any): string | null {
    const avatar = user?.avatar ?? null;
    if (isHttpUrl(avatar)) return avatar;
    if (avatar) return avatar;
    return null;
}

function getAvatarUrlForSwitcher(user: any, size = 80): string | null {
    const avatar = normalizeSwitcherAvatar(user);
    if (!avatar) return null;
    if (isHttpUrl(avatar)) return avatar;
    const id = user?.id ?? user?.userId;
    if (!id) return null;
    const animated = String(avatar).startsWith("a_");
    return `https://cdn.discordapp.com/avatars/${id}/${avatar}.${animated ? "gif" : "png"}?size=${size}`;
}

function buildSwitcherUser(user: any, extra?: Record<string, unknown>) {
    const id = String(user?.id ?? user?.userId ?? "");
    const username = user?.username ?? user?.name ?? `User_${id.slice(-4)}`;
    const globalName = user?.globalName ?? user?.global_name ?? username;

    return {
        ...user,
        ...extra,
        id,
        userId: id,
        username,
        globalName,
        global_name: globalName,
        discriminator: user?.discriminator ?? "0",
        avatar: normalizeSwitcherAvatar(user),
        avatarURL: getAvatarUrlForSwitcher(user),
        avatarUrl: getAvatarUrlForSwitcher(user),
        getAvatarURL: (_guildId?: string, size?: number) => getAvatarUrlForSwitcher(user, size) ?? undefined,
        tokenStatus: user?.tokenStatus ?? 1,
        pushSyncToken: user?.pushSyncToken ?? null,
    };
}

function getSwitcherActionId(action: any): string | undefined {
    const nested = action?.account ?? action?.user;
    const raw = action?.targetUserId
        ?? action?.userId
        ?? action?.user_id
        ?? action?.id
        ?? action?.targetId
        ?? action?.target_id
        ?? nested?.id
        ?? nested?.userId;

    return raw != null ? String(raw) : undefined;
}

function looksLikeMultiAccountStore(mod: any): boolean {
    try {
        if (typeof mod?.getUsers !== "function") return false;
        if (typeof mod.getValidUsers !== "function" && typeof mod.getHasLoggedInAccounts !== "function") return false;
        const users = mod.getUsers();
        if (!Array.isArray(users)) return false;
        if (typeof mod.getFrequentlyUsedEmojis === "function") return false;
        if (!users.length) return true;
        const first = users[0];
        if (!first || typeof first !== "object") return false;
        if (typeof first.id !== "string") return false;
        if (!("tokenStatus" in first) && !("pushSyncToken" in first)) {
            if ("type" in first || "permissions" in first || "parentId" in first) return false;
        }
        return true;
    } catch {
        return false;
    }
}

function injectFakes(real: any[]): any[] {
    markAccountSwitcherRendering();
    isGettingUsers = true;
    queueMicrotask(() => {
        isGettingUsers = false;
    });

    if (!settings.store.patchInternalAccountSwitcher) return real;
    const originalId = getOriginalMeId();
    const realMe = originalGetUser && originalId ? originalGetUser.call(UserStore, originalId) : originalGetCurrentUser?.call(UserStore);
    let hasRealAccount = false;

    const displayReal = real.map(user => {
        if (realMe && originalId && user?.id === originalId) {
            hasRealAccount = true;
            return buildSwitcherUser({
                ...realMe,
                ...user,
                id: originalId,
                userId: originalId,
                username: realMe.username,
                globalName: (realMe as any).globalName ?? realMe.username,
                global_name: (realMe as any).global_name ?? (realMe as any).globalName ?? realMe.username,
                discriminator: realMe.discriminator ?? "0",
                avatar: realMe.avatar ?? null,
                tokenStatus: user?.tokenStatus ?? 1,
                pushSyncToken: user?.pushSyncToken ?? null,
            });
        }
        return buildSwitcherUser(user);
    });

    if (realMe && originalId && !hasRealAccount) {
        displayReal.unshift(buildSwitcherUser({
            ...realMe,
            id: originalId,
            userId: originalId,
            tokenStatus: 1,
            pushSyncToken: null,
        }));
    }

    const realIds = new Set(displayReal.map(user => user?.id));
    const extras = getSwitcherAccounts()
        .map(user => buildSwitcherUser(user))
        .filter(user => !realIds.has(user.id));
    const combined = extras.length ? [...displayReal, ...extras] : displayReal;

    const seenIds = new Set<string>();
    const deduplicated: any[] = [];
    for (const user of combined) {
        if (user?.id && !seenIds.has(user.id)) {
            seenIds.add(user.id);
            deduplicated.push(user);
        }
    }
    return deduplicated;
}

function patchInternalAccountSwitcher() {
    if (originalMultiGetUsers) return;

    waitFor(["getUsers", "getValidUsers", "getHasLoggedInAccounts"], (store: any) => {
        if (originalMultiGetUsers || !looksLikeMultiAccountStore(store)) return;

        multiAccountStore = store;
        originalMultiGetUsers = store.getUsers.bind(store);
        originalMultiGetValidUsers = store.getValidUsers?.bind(store) ?? null;
        originalMultiGetHasLoggedInAccounts = store.getHasLoggedInAccounts?.bind(store) ?? null;

        const withFakeAccounts = injectFakes;

        store.getUsers = () => withFakeAccounts(originalMultiGetUsers?.() ?? []);
        if (store.getValidUsers) {
            store.getValidUsers = () => withFakeAccounts(originalMultiGetValidUsers?.() ?? []);
        }
        if (store.getHasLoggedInAccounts) {
            store.getHasLoggedInAccounts = () => {
                isGettingUsers = true;
                queueMicrotask(() => {
                    isGettingUsers = false;
                });
                if (settings.store.patchInternalAccountSwitcher && getSwitcherAccounts().length) return true;
                return originalMultiGetHasLoggedInAccounts?.() ?? false;
            };
        }

        store.emitChange?.();
    });

    waitFor(["switchAccount"], (module: any) => {
        multiAuthModule = module;
        originalSwitchAccount = module.switchAccount;
        module.switchAccount = function (id: string, ...args: any[]) {
            if (settings.store.patchInternalAccountSwitcher) {
                const saved = getSavedIdentityForSwitcherId(id);
                if (saved) {
                    void activateSwitcherIdentity({ type: "FAKE_USER_SWITCHER_CLICK", targetUserId: id });
                    return;
                }
            }
            return originalSwitchAccount.call(this, id, ...args);
        };
    });
}

function unpatchInternalAccountSwitcher() {
    if (!multiAccountStore || !originalMultiGetUsers) return;
    multiAccountStore.getUsers = originalMultiGetUsers;
    if (originalMultiGetValidUsers) multiAccountStore.getValidUsers = originalMultiGetValidUsers;
    if (originalMultiGetHasLoggedInAccounts) multiAccountStore.getHasLoggedInAccounts = originalMultiGetHasLoggedInAccounts;
    multiAccountStore.emitChange?.();
    multiAccountStore = null;
    originalMultiGetUsers = null;
    originalMultiGetValidUsers = null;
    originalMultiGetHasLoggedInAccounts = null;

    if (multiAuthModule && originalSwitchAccount) {
        multiAuthModule.switchAccount = originalSwitchAccount;
        multiAuthModule = null;
        originalSwitchAccount = null;
    }
}

function emitInternalAccountSwitcherChange() {
    if (settings.store.patchInternalAccountSwitcher) multiAccountStore?.emitChange?.();
}

function switchRealAccount(id: string): boolean {
    if (id === getOriginalMeId()) return false;
    if (getSavedIdentityForSwitcherId(id)) return false;

    try {
        const multiAuth = findByProps("switchAccount", "loginToken") ?? findByProps("switchAccount");
        if (multiAuth?.switchAccount) {
            multiAuth.switchAccount(id);
            return true;
        }
    } catch (e) {
        logger.warn("Native switchAccount failed", e);
    }

    return false;
}

async function activateSwitcherIdentity(action: any) {
    if (!settings.store.patchInternalAccountSwitcher) return;
    logger.log("[FakeUserSwitcher] activateSwitcherIdentity triggered with action:", JSON.stringify(action));
    const id = getSwitcherActionId(action);
    if (!id) return;
    if (id === getOriginalMeId()) {
        if (settings.store.spoofActive) {
            clearTarget();
            emitInternalAccountSwitcherChange();
            showToast("Restored your real account locally.", Toasts.Type.SUCCESS);
        }
        return;
    }

    const saved = getSavedIdentityForSwitcherId(id);
    if (!saved) {
        switchRealAccount(id);
        logger.log("[FakeUserSwitcher] No saved identity found for ID:", id);
        return;
    }

    try {
        if (isManualSavedIdentity(saved)) {
            settings.store.manualUsername = saved.manualUsername ?? saved.name;
            settings.store.manualDisplayName = saved.manualDisplayName ?? "";
            settings.store.manualAvatar = saved.manualAvatar ?? saved.avatar ?? "";
            settings.store.manualMode = true;
            setEnabled(true);
            showToast(`Spoofing as ${saved.name}`, Toasts.Type.SUCCESS);
        } else {
            const cachedTarget = targetsCache.get(saved.id);
            if (cachedTarget) {
                setTarget(cachedTarget);
                settings.store.manualMode = false;
                setEnabled(true);
                showToast(`Spoofing as ${cachedTarget.user.globalName || cachedTarget.user.username}`, Toasts.Type.SUCCESS);
                loadTarget(saved.id, true, true).catch(() => { });
            } else {
                const next = await loadTarget(saved.id);
                settings.store.manualMode = false;
                setEnabled(true);
                showToast(`Spoofing as ${next.user.globalName || next.user.username}`, Toasts.Type.SUCCESS);
            }
        }
        emitInternalAccountSwitcherChange();
    } catch (e) {
        logger.error("Failed to activate fake account-switcher identity", e);
        showToast("Failed to activate fake identity.", Toasts.Type.FAILURE);
    }
}

function removeSwitcherIdentity(action: any) {
    const id = getSwitcherActionId(action);
    if (!id) return;
    const saved = getSavedIdentityForSwitcherId(id);
    if (saved) {
        const list = getSavedUsers().filter(s => s.id !== id);
        setSavedUsers(list);
        emitInternalAccountSwitcherChange();
        showToast(`Removed saved identity: ${saved.name}`, Toasts.Type.SUCCESS);
        if (settings.store.spoofActive && settings.store.targetId === id) {
            clearTarget();
        }
    }
}

function getClickedSwitcherIdentity(event: MouseEvent): string | undefined {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return undefined;

    const option = target.closest(SWITCHER_DROPDOWN_SELECTORS.join(","));
    if (!option) return undefined;

    const accounts = [...getSwitcherAccounts()];
    const originalId = getOriginalMeId();
    if (originalId) {
        const realMe = originalGetUser?.call(UserStore, originalId) ?? originalGetCurrentUser?.call(UserStore);
        if (realMe) accounts.unshift(buildSwitcherUser(realMe, { id: originalId, userId: originalId }));
    }

    const optionText = option.textContent?.toLowerCase() ?? "";
    for (const account of accounts) {
        const id = String(account.id);
        const names = [account.username, account.globalName, account.global_name, account.name]
            .filter((name): name is string => typeof name === "string" && name.length > 0)
            .map(name => name.toLowerCase());

        if (optionText.includes(id) || names.some(name => optionText.includes(name))) return id;
    }

    const imgs = Array.from(option.querySelectorAll("img"));
    for (const img of imgs) {
        const src = img.getAttribute("src") ?? "";
        const account = accounts.find(user => {
            const avatar = normalizeSwitcherAvatar(user);
            return avatar && (src.includes(avatar) || src === avatar || src.includes(encodeURIComponent(avatar)));
        });
        if (account?.id) return String(account.id);
    }

    return undefined;
}

function startSwitcherClickInterceptor() {
    if (switcherClickInterceptor || typeof document === "undefined") return;

    switcherClickInterceptor = event => {
        if (!settings.store.patchInternalAccountSwitcher) return;
        const id = getClickedSwitcherIdentity(event);
        if (!id || !getSavedIdentityForSwitcherId(id)) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        void activateSwitcherIdentity({ type: "FAKE_USER_SWITCHER_CLICK", targetUserId: id });
    };

    document.addEventListener("click", switcherClickInterceptor, true);
    document.addEventListener("mouseup", switcherClickInterceptor, true);
}

function stopSwitcherClickInterceptor() {
    if (!switcherClickInterceptor || typeof document === "undefined") return;
    document.removeEventListener("click", switcherClickInterceptor, true);
    document.removeEventListener("mouseup", switcherClickInterceptor, true);
    switcherClickInterceptor = null;
}

let unsub: (() => void) | null = null;

const plugin = definePlugin({
    name: "fakeuserswitcher",
    description: "Visually impersonate any Discord user client-side. Advanced status, activities, bio, and visual spoofing.",
    tags: ["Customisation", "Privacy", "Fun"],
    authors: [TestcordDevs.x2b, TestcordDevs.SirPhantom89],
    dependencies: ["UserAreaAPI", "BadgeAPI", "MessageEventsAPI"],

    settings,

    userAreaButton: {
        icon: FakeUserSwitcherIcon,
        render: (props: UserAreaRenderProps) => <FakeUserSwitcherButton {...props} />,
        priority: -1,
    },

    async start() {
        const generation = ++switcherGeneration;
        logger.info("[FUS-BUILD-CHECK] build loaded — badge+overlay+message fixes v3 active");
        loadCacheFromSettings();
        addProfileBadge(dynamicBadge);
        startSwitcherDropdownObserver();
        startSwitcherClickInterceptor();
        patchStore();
        patchUtils();
        patchBadges();
        patchPresence();
        patchSnowflake();
        patchInternalAccountSwitcher();

        FluxDispatcher.subscribe("MULTI_ACCOUNT_SWITCH_ATTEMPT", activateSwitcherIdentity);
        FluxDispatcher.subscribe("MULTI_ACCOUNT_SWITCH_FAILURE", activateSwitcherIdentity);
        FluxDispatcher.subscribe("MULTI_ACCOUNT_REMOVE_ACCOUNT", removeSwitcherIdentity);

        addContextMenuPatch("user-context", userContextMenuPatch);
        addContextMenuPatch("user-profile-actions", userContextMenuPatch);

        unsub = subscribe(() => {
            syncSpoofState();
            emitInternalAccountSwitcherChange();
        });

        const { targetId } = settings.store;
        if (targetId && !settings.store.manualMode) {
            try {
                await loadTarget(targetId);
                if (generation !== switcherGeneration) return;
            } catch (e) {
                logger.warn("Failed to restore cached target", e);
            }
        }
        if (generation !== switcherGeneration) return;

        preLoadGuildTargets();

        if (settings.store.spoofActive) {
            syncSpoofState();
        }

        if (settings.store.patchInternalAccountSwitcher) {
            switcherRunning = true;
            waitFor(["getUsers", "getValidUsers", "getHasLoggedInAccounts"], (mod: any) => {
                if (!switcherRunning) return;
                if (!looksLikeMultiAccountStore(mod)) {
                    logger.warn("Store ignored — doesn't look like MultiAccountStore:", mod);
                    return;
                }
                multiAccountStore = mod;
                patchInternalAccountSwitcher();
                try { mod.emitChange?.(); } catch { /* ignore */ }
            });
        }
    },

    stop() {
        switcherGeneration++;
        if (originalSet) {
            buttons.set = originalSet;
            originalSet = null;
        }
        switcherRunning = false;
        unpatchInternalAccountSwitcher();
        multiAccountStore = null;
        clearWrapCache();
        stopSwitcherDropdownObserver();
        stopSwitcherClickInterceptor();
        unpatchSnowflake();
        unpatchPresence();
        unpatchBadges();
        unpatchUtils();
        unpatchStore();
        unpatchInternalAccountSwitcher();
        removeProfileBadge(dynamicBadge);

        FluxDispatcher.unsubscribe("MULTI_ACCOUNT_SWITCH_ATTEMPT", activateSwitcherIdentity);
        FluxDispatcher.unsubscribe("MULTI_ACCOUNT_SWITCH_FAILURE", activateSwitcherIdentity);
        FluxDispatcher.unsubscribe("MULTI_ACCOUNT_REMOVE_ACCOUNT", removeSwitcherIdentity);

        removeContextMenuPatch("user-context", userContextMenuPatch);
        removeContextMenuPatch("user-profile-actions", userContextMenuPatch);

        if (unsub) { unsub(); unsub = null; }
        notifyUpdate();
    },

    flux: {
        CONNECTION_OPEN() {
            if (settings.store.spoofActive && (settings.store.manualMode || getCachedTarget())) {
                syncSpoofState();
            }
        },
        MULTI_ACCOUNT_SWITCH_ATTEMPT(action: any) {
            void activateSwitcherIdentity(action);
        },
    },

    patches: [
        {
            find: ",getUserTag:",
            replacement: {
                match: /getName:([A-Za-z_$][\w$]*),/,
                replace: "getName:e=>$self.getUsername(e)??$1(e),"
            }
        },
        {
            find: "getUserAvatarURL:",
            replacement: {
                match: /(getUserAvatarURL:)([^,]+),/,
                replace: "$1$self.wrapAvatar($2),"
            }
        },
        {
            find: "getAvatarDecorationURL:",
            replacement: {
                match: /(?<=function \i\(\i\){)(?=let{avatarDecoration)/,
                replace: "const vcFupDeco=$self.getAvatarDecorationURL(arguments[0]);if(vcFupDeco)return vcFupDeco;"
            }
        },
        {
            // Render patch: inject the spoofed decoration into the avatar component
            // so it actually decides to render a ring. Without this, the URL patch
            // above fires too late and Discord shows the placeholder preset.
            find: "isAvatarDecorationAnimating:",
            group: true,
            replacement: [
                {
                    match: /(?<=\.avatarDecoration,guildId:\i\}\)\),)(?<=user:(\i).+?)/,
                    replace: "vcFusAvatarDecoration=$self.useUserAvatarDecoration($1),"
                },
                {
                    match: /(?<={avatarDecoration:).{1,20}?(?=,)(?<=avatarDecorationOverride:(\i).+?)/,
                    replace: "$1??vcFusAvatarDecoration??($&)"
                },
                {
                    match: /(?<=size:\i}\),\[)/,
                    replace: "vcFusAvatarDecoration,"
                }
            ]
        },
        {
            find: "#{intl::ACCOUNT_SPEAKING_WHILE_MUTED}",
            replacement: [
                {
                    match: /(?<=\i\)\({avatarDecoration:)\i(?=,)(?<=currentUser:(\i).+?)/,
                    replace: "$self.useUserAvatarDecoration($1)??$&"
                }
            ]
        },
        ...[
            '"Message Username"',
            ".nameplatePreview,{",
            "#{intl::ayozFl::raw}",
        ].map(find => ({
            find,
            replacement: [
                {
                    match: /(\i)\.length>0\?void 0:(\i)\.avatarDecoration/,
                    replace: "$self.useUserAvatarDecoration($2)??$2.avatarDecoration"
                }
            ]
        })),
        {
            find: "UserProfileStore",
            replacement: {
                match: /(?<=getUserProfile\(\i\){return )(.+?)(?=})/,
                replace: "$self.profileHook(arguments[0],$1)"
            }
        },
        {
            find: ".banner)==null",
            replacement: {
                match: /(?<=void 0:)\i\.getPreviewBanner\(\i,\i,\i\)/,
                replace: "($self.bannerHook(arguments[0])??($&))"
            }
        },
        {
            find: "\"ProfileEffectStore\"",
            replacement: {
                match: /getProfileEffectById\((\i)\){return null!=\i\?(\i)\[\i\]:void 0/,
                replace: "getProfileEffectById($1){return $self.getProfileEffectById($1,$2)??(null!=$2?$2[$1]:void 0)"
            }
        },
        {
            find: "getAssetImage: size must === [",
            replacement: {
                match: /(getAssetImage)\s*(=|:)?\s*(function)?\s*\(\s*(\i)\s*,\s*(\i)\s*(,[^)]*)?\)\s*\{/,
                replace: "$1$2$3($4,$5$6){if(typeof $5===\"string\"&&($5.startsWith(\"http://\")||$5.startsWith(\"https://\")||$5.startsWith(\"data:\")))return $5;"
            }
        },
        {
            find: "getGuildTagBadgeURL",
            replacement: {
                match: /(getGuildTagBadgeURL:)(\i),/,
                replace: "$1$self.wrapBadge($2),"
            }
        },
        {
            find: "memberSinceWrapper",
            replacement: [
                {
                    match: /([A-Za-z_$][\w$]*(?:\.default)?)\.extractTimestamp\(([A-Za-z_$][\w$]*)\)/g,
                    replace: "($self.spoofMemberSinceTimestamp($2)??$1.extractTimestamp($2))",
                    noWarn: true
                },
                {
                    match: /\(0,([A-Za-z_$][\w$]*(?:\.default)?)\.extractTimestamp\)\(([A-Za-z_$][\w$]*)\)/g,
                    replace: "($self.spoofMemberSinceTimestamp($2)??(0,$1.extractTimestamp)($2))",
                    noWarn: true
                }
            ]
        },
        {
            find: "fromTimestamp:",
            replacement: [
                // `extractTimestamp: function(x){...}`
                {
                    match: /(extractTimestamp\s*:\s*function\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\{)/,
                    replace: "$1const __vcFupSpoof=$self.spoofMemberSinceTimestamp($2);if(__vcFupSpoof!=null)return __vcFupSpoof;"
                },
                // `extractTimestamp: (x) => expr` (arrow, expression body)
                {
                    match: /extractTimestamp\s*:\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*=>\s*([^,}]+)/,
                    replace: "extractTimestamp:($1)=>{const __s=$self.spoofMemberSinceTimestamp($1);return __s!=null?__s:($2);}",
                    noWarn: true
                },
                // `extractTimestamp(x){...}` (shorthand method form, most common in modern minified bundles)
                {
                    match: /(extractTimestamp\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\{)/,
                    replace: "$1const __vcFupSpoof=$self.spoofMemberSinceTimestamp($2);if(__vcFupSpoof!=null)return __vcFupSpoof;",
                    noWarn: true
                },
                // `function extractTimestamp(x){...}` (top-level function declaration form)
                {
                    match: /(function\s+extractTimestamp\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\{)/,
                    replace: "$1const __vcFupSpoof=$self.spoofMemberSinceTimestamp($2);if(__vcFupSpoof!=null)return __vcFupSpoof;",
                    noWarn: true
                }
            ]
        },
        {
            find: "getIsValidatingUsers",
            replacement: {
                match: /getUsers\(\)\{return (\i)\}/,
                replace: "getUsers(){return $self.injectFakes($1)}"
            }
        },
        {
            find: "multiAccountUsers",
            replacement: {
                match: /(\w+)\.default\.track\((\w+)\.HAw\.MULTI_ACCOUNT_SWITCH_ATTEMPT[^)]+\),(\w+)\.Mx\((\w+)\)/,
                replace: "$1.default.track($2.HAw.MULTI_ACCOUNT_SWITCH_ATTEMPT,{location:{section:$2.JJy.USER_PROFILE}}),$self.handleSwitch($3.Mx.bind($3),$4)"
            }
        }
    ],

    injectFakes(real: any[]): any[] {
        return injectFakes(real);
    },

    handleSwitch(originalFn: (id: string) => void, userId: string) {
        if (settings.store.patchInternalAccountSwitcher) {
            const saved = getSavedIdentityForSwitcherId(userId);
            if (saved) {
                void activateSwitcherIdentity({ type: "FAKE_USER_SWITCHER_CLICK", targetUserId: userId });
                return;
            }
        }
        if (settings.store.spoofActive) {
            clearTarget();
            emitInternalAccountSwitcherChange();
        }
        originalFn(userId);
    },

    getUsername(user: User) {
        if (!isActive() || !isCurrentUser(user?.id)) return undefined;
        const t = getTargetUser();
        if (!t) return undefined;
        return t.globalName || t.username;
    },

    spoofMemberSinceTimestamp(userId: string) {
        try {
            if (!isActive() || !userId || typeof userId !== "string") return undefined;
            // Only spoof the member-since date when resolving our own account ID.
            // Target IDs and manual synthetic IDs already encode their correct dates,
            // and checking isCurrentUser on every snowflake creates high CPU overhead.
            if (userId !== getOriginalMeId()) return undefined;
            return getSpoofedCreatedAtMs() ?? undefined;
        } catch {
            return undefined;
        }
    },

    wrapAvatar(original: any) {
        return (user: User, animated: boolean, size: number) => {
            if (isActive() && (isCurrentUser(user?.id) || user?.id === "0")) {
                const active = getActiveTargetForGuild(undefined);
                if (active) {
                    if (active.manualData?.overlaySelf) {
                        return original(getRealCurrentUser() ?? user, animated, size);
                    }
                    if (active.isManual) {
                        return active.manualData?.manualAvatarDataUrl || active.manualData?.manualAvatar || active.manualData?.avatar || "https://cdn.discordapp.com/embed/avatars/0.png";
                    }
                    const t = active.user;
                    if (t) return original(t, animated, size);
                }
            }
            return original(user, animated, size);
        };
    },

    wrapBadge(original: any) {
        return (guildId: string, badgeHash: string, ...args: any[]) => {
            if (typeof badgeHash === "string" && (badgeHash.startsWith("http://") || badgeHash.startsWith("https://") || badgeHash.startsWith("data:"))) {
                return badgeHash;
            }
            return original(guildId, badgeHash, ...args);
        };
    },

    useUserAvatarDecoration,

    getAvatarDecorationURL({ user, canAnimate }: { user?: User; avatarDecoration?: any; canAnimate?: boolean; }) {
        if (!isActive()) return undefined;
        const targetUserId = user?.id;
        if (!isCurrentUser(targetUserId)) return undefined;
        const t = getTargetUser() as any;
        const deco = t?.avatarDecorationData;
        if (!deco?.asset) return undefined;
        // Mirror Discord's own preset URL exactly (same as the modal grid preview,
        // which renders correctly). For a static render of an animated asset, strip
        // the a_ prefix and request passthrough=false so the APNG collapses to its
        // first frame; otherwise use the bare preset URL with no query string. A
        // stray ?passthrough=false on a non-animated preset returns an invalid
        // response, which is what produced the broken-image placeholder.
        // Discord serves decoration presets (free AND animated shop-style a_ assets)
        // from avatar-decoration-presets, but the `passthrough` query param is
        // mandatory and decides animation:
        //   animated + allowed to animate -> a_<hash>.png?passthrough=true  (APNG)
        //   otherwise                      -> <hash without a_>.png?passthrough=false (static frame)
        // The previous code omitted passthrough entirely on the animated branch,
        // which made the CDN return an unusable response -> broken-image placeholder.
        const isAnimated = deco.asset.startsWith("a_");
        let url: string;
        if (isAnimated && canAnimate) {
            url = `https://cdn.discordapp.com/avatar-decoration-presets/${deco.asset}.png?passthrough=true`;
        } else {
            const staticAsset = deco.asset.replace(/^a_/, "");
            url = `https://cdn.discordapp.com/avatar-decoration-presets/${staticAsset}.png?passthrough=false`;
        }
        return url;
    },

    getProfileEffectById(skuId: string, effects: Record<string, any>) {
        if (!isActive() || !settings.store.spoofProfileEffect) return null;
        const targetProfile = getTargetProfile();
        const eff = targetProfile?.profileEffect;
        if (eff && (eff.skuId === skuId || (eff as any).id === skuId)) return eff;
        return (effects && effects[skuId]) || null;
    },

    profileHook(userId: string, original: any) {
        const active = getActiveTargetForGuild(undefined);
        const activeSpoof = isActive() && active;
        const selfNitro = settings.store.fakeNitroMonths && settings.store.fakeNitroMonths > 0;

        if (!isCurrentUser(userId)) return original;
        if (!activeSpoof && !selfNitro) return original;

        const overrides: any = {};
        let targetUser = original?.user;
        let targetProfile: any = null;
        let isManual = false;
        let manualData: any = null;

        if (activeSpoof) {
            targetUser = active.user;
            targetProfile = active.profile;
            isManual = active.isManual;
            manualData = active.manualData;
        } else {
            targetUser = original?.user ?? UserStore.getCurrentUser();
        }

        overrides.user = wrapUser(targetUser);

        if (activeSpoof && isManual) {
            const overlaySelf = !!manualData?.overlaySelf;
            // Propagate fake creation date into the profile object so the popout's "Member Since"
            // section reflects the manual date. Discord reads user.createdAt for this; we shadow it
            // on the wrapped user above. We also pass it on the profile for any code that checks it there.
            // Skipped in overlay mode — your real Member Since stays intact.
            const manualDateStr = manualData?.manualCreatedAt || settings.store.manualCreatedAt;
            if (!overlaySelf && manualDateStr && manualDateStr.trim() !== "") {
                const parsedManualDate = new Date(manualDateStr);
                if (!isNaN(parsedManualDate.getTime())) {
                    overrides.createdAt = parsedManualDate;
                    overrides.created_at = parsedManualDate.toISOString();
                    overrides.premiumGuildSince = overrides.premiumGuildSince; // no-op, just keeping context
                }
            }
            // Overlay mode is cosmetics-only — bio and pronouns are profile content,
            // not cosmetics, so leave the real account's values intact (same rule as
            // createdAt above).
            if (!overlaySelf) {
                overrides.bio = manualData?.manualBio || manualData?.bio || "";
                overrides.pronouns = manualData?.manualPronouns || manualData?.pronouns || "";
            }
            // Banner source differs by mode:
            //  - identity mode: the manual-identity banner fields (manualBanner*).
            //  - overlay mode: the dedicated overlay banner fields (manualOverlayBanner*),
            //    which default to blank so the REAL account banner is kept.
            // Prefer an uploaded data URL, then a URL/hex string.
            const overlayBanner = overlaySelf
                ? (manualData?.manualOverlayBannerDataUrl || manualData?.manualOverlayBanner)
                : (manualData?.manualBannerDataUrl || manualData?.manualBanner || manualData?.banner);
            if (!overlaySelf) {
                overrides.banner = overlayBanner || null;
            } else if (overlayBanner && !overlayBanner.startsWith("#")) {
                // Image/gif banner set in overlay mode -> override; a #hex is handled
                // below as an accent/theme color, not a banner image.
                overrides.banner = overlayBanner;
            }
            // A #hex banner (either mode's banner field) becomes the accent/theme color.
            const bannerColor = overlaySelf
                ? (manualData?.manualOverlayBanner || "")
                : (manualData?.manualBanner || manualData?.banner || "");
            if (bannerColor && bannerColor.startsWith("#")) {
                try {
                    const cleanHex = bannerColor.replace("#", "");
                    const colorVal = parseInt(cleanHex, 16);
                    if (!isNaN(colorVal)) overrides.accentColor = colorVal;
                } catch { /* ignore */ }
            }
            // Explicit accent color + gradient (overrides any hex-banner-derived accent above).
            const accent1 = manualData?.manualAccentColor && String(manualData.manualAccentColor).trim() !== ""
                ? Number(manualData.manualAccentColor) : null;
            const accent2 = manualData?.manualAccentColor2 && String(manualData.manualAccentColor2).trim() !== ""
                ? Number(manualData.manualAccentColor2) : null;
            if (accent1 != null && !isNaN(accent1)) {
                overrides.accentColor = accent1;
                overrides.themeColors = [accent1, (accent2 != null && !isNaN(accent2)) ? accent2 : accent1];
            }
            // Avatar decoration (asset already normalized onto active.user by buildManualActiveTarget).
            if (active.user?.avatarDecorationData) {
                overrides.avatarDecorationData = active.user.avatarDecorationData;
            }
            // Profile effect.
            if (settings.store.spoofProfileEffect && targetProfile?.profileEffect) {
                overrides.profileEffect = targetProfile.profileEffect;
                if (targetProfile.profileEffectId != null) overrides.profileEffectId = targetProfile.profileEffectId;
                if (targetProfile.profileEffectExpiresAt !== undefined) overrides.profileEffectExpiresAt = targetProfile.profileEffectExpiresAt;
            }

            // Drop Discord's NATIVE premium/boost badges so only our rich dynamic ones
            // (dynamicBadge.getBadges, with the custom NITRO/Subscriber-since tooltip)
            // render. In overlay mode the account's REAL premiumSince/premiumGuildSince
            // make Discord derive and draw its own Nitro/boost tier badge live, which
            // duplicated ours (and the live component re-rendering looked like the
            // tooltip "reopening"). Clearing the *Since fields removes Discord's tier
            // derivation; premiumType stays non-zero to avoid the popout SKU crash.
            const spoofNitroTier = (manualData?.manualNitroLevel ?? -1) >= 0;
            const spoofBoostTier = (manualData?.manualBoostMonths ?? -1) >= 0;
            if (spoofNitroTier) {
                overrides.premiumSince = null;
            }
            if (spoofBoostTier) {
                overrides.premiumGuildSince = null;
            } // Clan / server-tag identity swap is skipped in overlay mode (keeps your real tag).
            const tag = overlaySelf ? "" : (manualData?.manualClanTag || manualData?.clanTag);
            if (!overlaySelf && tag && tag.trim() !== "") {
                const guildId = manualData?.manualClanGuildId || settings.store.manualClanGuildId || "0";
                const badgeVal = resolveBadge(
                    manualData?.manualClanBadge || settings.store.manualClanBadge || "",
                    manualData?.manualClanBadgeCustom || settings.store.manualClanBadgeCustom || ""
                );
                const manualClan = {
                    tag: tag.trim(),
                    identityGuildId: guildId,
                    identity_guild_id: guildId,
                    identityEnabled: true,
                    identity_enabled: true,
                    badge: badgeVal
                };
                overrides.clan = manualClan;
                overrides.primaryGuild = manualClan;
                overrides.primary_guild = manualClan;
            } else if (!overlaySelf) {
                overrides.clan = null;
                overrides.primaryGuild = null;
                overrides.primary_guild = null;
            }
            if (settings.store.fakeNitroMonths && settings.store.fakeNitroMonths > 0) {
                const since = new Date();
                since.setMonth(since.getMonth() - settings.store.fakeNitroMonths);
                overrides.premiumType = 2;
                overrides.premiumSince = since.toISOString();
            }
            overrides.widgets = [];
            overrides.connectedAccounts = [];
            overrides.legacyApplications = [];
            overrides.applicationRoleConnections = [];
        } else if (activeSpoof) {
            // Cloner mode
            if (targetProfile && targetProfile.bio != null) overrides.bio = targetProfile.bio;
            if (targetProfile && targetProfile.pronouns != null) overrides.pronouns = targetProfile.pronouns;
            if (targetProfile && targetProfile.themeColors) overrides.themeColors = targetProfile.themeColors;
            overrides.banner = targetProfile?.banner ?? (targetUser as any).banner ?? null;
            overrides.accentColor = targetProfile?.accentColor ?? (targetUser as any).accentColor ?? null;
            if (targetProfile && targetProfile.profileEffect) overrides.profileEffect = targetProfile.profileEffect;
            if (targetProfile && targetProfile.popoutAnimationParticleType != null) overrides.popoutAnimationParticleType = targetProfile.popoutAnimationParticleType;
            if (targetProfile && targetProfile.profileEffectExpiresAt != null) overrides.profileEffectExpiresAt = targetProfile.profileEffectExpiresAt;

            const premiumType = targetProfile?.premiumType ?? targetUser.premiumType;
            if (premiumType != null) overrides.premiumType = premiumType;
            if (targetProfile && targetProfile.premiumSince != null) overrides.premiumSince = targetProfile.premiumSince;
            if (targetProfile && targetProfile.premiumGuildSince != null) overrides.premiumGuildSince = targetProfile.premiumGuildSince;

            overrides.clan = targetProfile?.clan ?? targetUser.clan ?? null;
            overrides.primaryGuild = targetProfile?.primaryGuild ?? targetProfile?.primary_guild ?? targetUser.primaryGuild ?? targetUser.primary_guild ?? null;
            overrides.primary_guild = targetProfile?.primary_guild ?? targetProfile?.primaryGuild ?? targetUser.primary_guild ?? targetUser.primaryGuild ?? null;

            const targetConnections = Array.isArray(targetProfile?.connectedAccounts)
                ? targetProfile.connectedAccounts
                : (Array.isArray(targetProfile?.connected_accounts)
                    ? targetProfile.connected_accounts
                    : []);
            overrides.connectedAccounts = targetConnections;

            if (settings.store.spoofActivities) {
                overrides.legacyApplications = Array.isArray(targetProfile?.legacyApplications) ? targetProfile.legacyApplications : [];
                overrides.applicationRoleConnections = Array.isArray(targetProfile?.applicationRoleConnections) ? targetProfile.applicationRoleConnections : [];
                overrides.widgets = Array.isArray(targetProfile?.widgets) ? targetProfile.widgets : [];
            } else {
                overrides.widgets = [];
                overrides.legacyApplications = [];
                overrides.applicationRoleConnections = [];
            }
        } else {
            // We are NOT actively spoofing (activeSpoof is false), but selfNitro is true.
            // We just override premiumType/premiumSince on our own profile.
            const since = new Date();
            since.setMonth(since.getMonth() - settings.store.fakeNitroMonths);
            overrides.premiumType = 2;
            overrides.premiumSince = since.toISOString();

            if (original) {
                if (original.bio != null) overrides.bio = original.bio;
                if (original.pronouns != null) overrides.pronouns = original.pronouns;
                if (original.themeColors) overrides.themeColors = original.themeColors;
                overrides.banner = original.banner;
                overrides.accentColor = original.accentColor;
                overrides.widgets = original.widgets ?? [];
                overrides.connectedAccounts = original.connectedAccounts ?? [];
                overrides.legacyApplications = original.legacyApplications ?? [];
                overrides.applicationRoleConnections = original.applicationRoleConnections ?? [];
            }
        }

        if (settings.store.fakeConnectionsEnabled) {
            try {
                const parsed = JSON.parse(settings.store.fakeConnectionsList || "[]");
                if (Array.isArray(parsed)) overrides.connectedAccounts = parsed;
            } catch { /* ignore */ }
        }

        // Final safety net: every array field the user popout reads must be a real array.
        // Discord's profile hooks call .length / .map / .filter on these unconditionally,
        // and an undefined or null value crashes the popout with
        // "Cannot read properties of undefined (reading 'length')".
        if (!Array.isArray(overrides.connectedAccounts)) overrides.connectedAccounts = Array.isArray(original?.connectedAccounts) ? original.connectedAccounts : [];
        if (!Array.isArray(overrides.legacyApplications)) overrides.legacyApplications = Array.isArray(original?.legacyApplications) ? original.legacyApplications : [];
        if (!Array.isArray(overrides.applicationRoleConnections)) overrides.applicationRoleConnections = Array.isArray(original?.applicationRoleConnections) ? original.applicationRoleConnections : [];
        if (!Array.isArray(overrides.widgets)) overrides.widgets = Array.isArray(original?.widgets) ? original.widgets : [];
        if (overrides.badges !== undefined && !Array.isArray(overrides.badges)) overrides.badges = [];

        // Mirror the userProfile sub-object so the popout's display-name section reflects the target.
        const targetUserProfile = (activeSpoof && !isManual) ? ((targetProfile as any)?.userProfile ?? {}) : {};
        const spoofedDisplayName = activeSpoof
            ? (manualData?.manualDisplayName || manualData?.manualUsername || manualData?.name || targetUser.globalName || targetUser.username || "FakeUser")
            : (original?.userProfile?.displayName ?? original?.userProfile?.display_name ?? targetUser.globalName ?? targetUser.username);

        overrides.userProfile = {
            ...(original?.userProfile ?? {}),
            ...targetUserProfile,
            displayName: spoofedDisplayName,
            display_name: spoofedDisplayName,
        };

        if (settings.store.spoofBadges || selfNitro) {
            let baseBadges = original?.badges ?? (targetProfile?.badges || []);

            // De-dupe real vs spoofed tier badges. When the user picks a spoofed Nitro
            // or Boost tier, Discord still renders their REAL Nitro/boost badge from the
            // profile's badges array, and dynamicBadge.getBadges adds the spoofed tier on
            // top — producing two of the same kind (e.g. real Bronze + spoofed Opal).
            // Strip the native premium / guild-boost badges here so only the spoofed
            // tier (rendered by the dynamic profile badge) remains.
            const spoofingNitroTier = isManual && (manualData?.manualNitroLevel ?? -1) >= 0;
            const spoofingBoostTier = isManual && (manualData?.manualBoostMonths ?? -1) >= 0;
            logger.info("[FUS-BADGE] profileHook badges — spoofNitro=", spoofingNitroTier, "spoofBoost=", spoofingBoostTier, "rawBadges=", JSON.stringify((Array.isArray(baseBadges) ? baseBadges : []).map((b: any) => ({ id: b?.id, desc: b?.description }))));
            if (Array.isArray(baseBadges) && (spoofingNitroTier || spoofingBoostTier)) {
                baseBadges = baseBadges.filter((b: any) => {
                    const id = String(b?.id ?? "");
                    const desc = String(b?.description ?? "");
                    const isNativeNitro = id === "premium" || id === "nitro"
                        || id.startsWith("premium") || /\bnitro\b/i.test(desc) || /\bnitro\b/i.test(id);
                    const isNativeBoost = id.startsWith("guild_booster") || id === "premium_guild"
                        || id.startsWith("guild_boost") || /boosting|server boost/i.test(desc) || /boost/i.test(id);
                    if (spoofingNitroTier && isNativeNitro) { logger.info("[FUS-BADGE] stripping native nitro:", id, desc); return false; }
                    if (spoofingBoostTier && isNativeBoost) { logger.info("[FUS-BADGE] stripping native boost:", id, desc); return false; }
                    return true;
                });
                overrides.badges = baseBadges;
            }

            const hasNitroBadge = baseBadges.some((b: any) => b.id === "nitro" || b.id === "fakeuserswitcher-nitro" || b.description === "Discord Nitro" || b.icon === "2ba85e8026a8614b640c2837bcdfe21b");
            if (selfNitro && !hasNitroBadge) {
                overrides.badges = [
                    ...baseBadges,
                    {
                        id: "fakeuserswitcher-nitro",
                        description: "Discord Nitro",
                        icon: "https://cdn.discordapp.com/badge-icons/2ba85e8026a8614b640c2837bcdfe21b.png",
                    }
                ];
            } else if (activeSpoof) {
                // When spoofing a real target that carries its own profile badges,
                // mirror them. Otherwise leave badges to the dynamic profile badge
                // (addProfileBadge / dynamicBadge.getBadges), which already renders
                // the flag + Nitro/Boost tier badges with the correct tier icon and
                // subscriber-since tooltip. Recomputing them here produced a second,
                // plain Nitro badge alongside the rich one.
                if (targetProfile && targetProfile.badges && targetProfile.badges.length) {
                    overrides.badges = targetProfile.badges;
                }
            }
        }

        if (activeSpoof && settings.store.spoofActivities && !isManual) {
            if (targetProfile && targetProfile.userProfile) {
                overrides.userProfile = {
                    ...overrides.userProfile,
                    ...targetProfile.userProfile,
                    displayName: spoofedDisplayName,
                    display_name: spoofedDisplayName,
                };
            }
        }

        const finalClan = overrides.clan !== undefined ? overrides.clan : (original?.clan ?? null);
        const finalPrimary = overrides.primaryGuild !== undefined ? overrides.primaryGuild : (original?.primaryGuild ?? original?.primary_guild ?? null);

        if (original?.guild_member) {
            overrides.guild_member = {
                ...original.guild_member,
                clan: finalClan,
                primaryGuild: finalPrimary,
                primary_guild: finalPrimary
            };
        }
        if (original?.guildMember) {
            overrides.guildMember = {
                ...original.guildMember,
                clan: finalClan,
                primaryGuild: finalPrimary,
                primary_guild: finalPrimary
            };
        }

        const originalUserProfile = original?.user_profile ?? original?.userProfile ?? {};
        overrides.user_profile = {
            ...originalUserProfile,
            ...(overrides.userProfile ?? {}),
            clan: finalClan,
            primaryGuild: finalPrimary,
            primary_guild: finalPrimary
        };
        overrides.userProfile = overrides.user_profile;

        const merged = original
            ? Object.assign(Object.create(Object.getPrototypeOf(original)), original, overrides)
            : { userId, ...overrides };
        return merged;
    },

    bannerHook({ displayProfile, user }: any) {
        const guildId = displayProfile?.guildId ?? displayProfile?.guild_id;
        if (!isActive(guildId)) return undefined;
        const id = displayProfile?.userId ?? user?.id;
        if (!isCurrentUser(id)) return undefined;

        const active = getActiveTargetForGuild(guildId);
        if (!active) return undefined;

        if (active.isManual) {
            const dataUrl = active.manualData?.manualBannerDataUrl;
            if (dataUrl) return dataUrl;
            const banner = active.manualData?.manualBanner || active.manualData?.banner;
            if (banner) {
                if (banner.startsWith("#")) return "";
                return banner;
            }
            return "";
        }

        const target = active.user;
        if (target?.banner && target.banner !== "manual") {
            const animated = target.banner.startsWith("a_");
            const ext = animated ? "gif" : "png";
            return `https://cdn.discordapp.com/banners/${target.id}/${target.banner}.${ext}?size=600`;
        }
        return "";
    },

    onBeforeMessageSend(channelId, msg, options) {
        if (!isActive() || !settings.store.fakeMessages) return;
        // Overlay mode keeps your REAL identity (only cosmetics are applied), so a
        // message must send for real, as you — never replaced by a local fake authored
        // as "FakeUser". Returning here lets Discord's normal send path run unchanged.
        const active = getActiveTargetForGuild(undefined);
        if (active?.manualData?.overlaySelf) return;
        const replyRef = options?.replyOptions?.messageReference;
        const fake = buildFakeMessage(channelId, msg.content, replyRef);
        if (!fake) return;

        try {
            FluxDispatcher.dispatch(fake);
        } catch (e) {
            logger.error("Failed to dispatch fake message", e);
        }

        if (settings.store.sendRealToo) return;
        return { cancel: true };
    },
});

export default plugin;
