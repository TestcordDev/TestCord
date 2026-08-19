/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import { fetchUserProfile } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { SelectedGuildStore, UserProfileStore, UserStore, UserUtils } from "@webpack/common";
export const logger = new Logger("FakeUserSwitcher");
let cached = null;
let notifying = false;
const subscribers = new Set();
const loadingGuildTargets = new Set();
const failedGuildTargets = new Set();
let _guildIdentitiesCache = null;
let _guildIdentitiesRaw = null;
function getGuildIdentities() {
    const raw = settings.store.guildIdentities || "{}";
    if (raw === _guildIdentitiesRaw && _guildIdentitiesCache)
        return _guildIdentitiesCache;
    try {
        const parsed = JSON.parse(raw);
        _guildIdentitiesCache = (parsed && typeof parsed === "object") ? parsed : {};
    }
    catch {
        _guildIdentitiesCache = {};
    }
    _guildIdentitiesRaw = raw;
    return _guildIdentitiesCache;
}
let _savedUsersCache = null;
let _savedUsersRaw = null;
// Bumped on every notify() so the manual/overlay target cache in
// getActiveTargetForGuild invalidates whenever any manual setting changes
// (every manual-field mutation in the modal calls notify()).
let manualTargetEpoch = 0;
let _manualTargetCache = null;
let _manualTargetKey = null;
export function notify() {
    if (notifying)
        return;
    notifying = true;
    manualTargetEpoch++;
    _manualTargetCache = null;
    _manualTargetKey = null;
    try {
        for (const fn of subscribers) {
            try {
                fn();
            }
            catch (e) {
                console.error("[FakeUserSwitcher] subscriber threw", e);
            }
        }
    }
    finally {
        notifying = false;
    }
}
let notifyScheduled = false;
export function scheduleNotify() {
    if (notifyScheduled)
        return;
    notifyScheduled = true;
    queueMicrotask(() => {
        notifyScheduled = false;
        notify();
    });
}
export function subscribe(fn) {
    subscribers.add(fn);
    return () => { subscribers.delete(fn); };
}
export function getCachedTarget() {
    return cached;
}
export function clearTarget() {
    cached = null;
    settings.store.targetId = "";
    settings.store.spoofActive = false;
    failedGuildTargets.clear();
    notify();
}
export function setTarget(target) {
    cached = target;
    settings.store.targetId = target.id;
    settings.store.spoofActive = true;
    notify();
}
const ID_RE = /^\d{17,20}$/;
export function resolveTargetUserId(input) {
    const trimmed = input.trim().replace(/^@/, "");
    if (!trimmed)
        return null;
    if (ID_RE.test(trimmed))
        return trimmed;
    const fromTag = UserStore.findByTag(trimmed) ?? UserStore.findByTag(trimmed, null);
    if (fromTag)
        return fromTag.id;
    const lower = trimmed.toLowerCase();
    let matchId = null;
    UserStore.forEach(u => {
        if (u.username.toLowerCase() === lower
            || u.globalName?.toLowerCase() === lower
            || u.tag.toLowerCase() === lower) {
            matchId = u.id;
            return false;
        }
    });
    return matchId;
}
export const targetsCache = new Map();
export function saveCache() {
    try {
        const serialized = Array.from(targetsCache.entries()).map(([id, target]) => {
            return [id, {
                    id: target.id,
                    user: target.user,
                    profile: target.profile,
                    fetchedAt: target.fetchedAt
                }];
        });
        settings.store.cachedProfiles = JSON.stringify(serialized);
    }
    catch (e) {
        logger.error("Failed to save targetsCache to settings", e);
    }
}
export function loadCacheFromSettings() {
    try {
        const data = settings.store.cachedProfiles;
        if (!data || data === "{}")
            return;
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
            for (const [id, target] of parsed) {
                targetsCache.set(id, target);
            }
        }
    }
    catch (e) {
        logger.error("Failed to load targetsCache from settings", e);
    }
}
export async function loadTarget(input, saveToSettings = true, silent = false) {
    const targetId = resolveTargetUserId(input);
    if (!targetId) {
        throw new Error("Could not find a cached user with that username. Please use their user ID.");
    }
    failedGuildTargets.delete(targetId);
    let user = UserStore.getUser(targetId);
    if (!user) {
        try {
            user = await UserUtils.getUser(targetId);
        }
        catch (e) {
            logger.error("Failed to fetch user", e);
            throw new Error("Could not load that user. Check the ID.");
        }
    }
    if (!user)
        throw new Error("Could not load that user. Check the ID.");
    let profile = null;
    try {
        profile = await fetchUserProfile(targetId, undefined, false);
    }
    catch (e) {
        logger.warn("Failed to fetch profile, falling back to user only", e);
        profile = UserProfileStore.getUserProfile(targetId);
    }
    user = UserStore.getUser(targetId) ?? user;
    const result = {
        id: targetId,
        user,
        profile,
        fetchedAt: Date.now(),
    };
    targetsCache.set(targetId, result);
    saveCache();
    if (saveToSettings) {
        cached = result;
        settings.store.targetId = targetId;
    }
    if (!silent)
        notify();
    return result;
}
let originalMeId = "";
let originalGetCurrentUserRef = null;
export function _setOriginalGetCurrentUser(fn) {
    originalGetCurrentUserRef = fn;
    if (fn) {
        try {
            const me = fn.call(UserStore);
            if (me?.id)
                originalMeId = me.id;
        }
        catch { /* ignore */ }
    }
}
export function getOriginalMeId() {
    if (!originalMeId) {
        try {
            const me = originalGetCurrentUserRef ? originalGetCurrentUserRef.call(UserStore) : UserStore.getCurrentUser();
            if (me?.id)
                originalMeId = me.id;
        }
        catch { /* ignore */ }
    }
    return originalMeId;
}
/**
 * Return the REAL (un-spoofed) current user object. While a spoof is active,
 * UserStore.getCurrentUser is patched to return the wrapped fake user, so this
 * routes through the captured original getter to recover the genuine account.
 */
export function getRealCurrentUser() {
    try {
        if (originalGetCurrentUserRef)
            return originalGetCurrentUserRef.call(UserStore);
        return UserStore.getCurrentUser();
    }
    catch {
        return null;
    }
}
const COLLECTIBLES_CDN = "https://cdn.discordapp.com/media/v1/collectibles-shop";
export function buildProfileEffectConfig(effectId, effectAsset) {
    if (!effectId)
        return undefined;
    const asset = effectAsset || effectId;
    const src = `${COLLECTIBLES_CDN}/${asset}/static`;
    return {
        skuId: effectId,
        type: 1,
        effects: [{
                src,
                loop: true,
                alt: null,
                height: 1280,
                width: 1280,
                duration: 0,
                start: 0,
                loopDelay: 0,
                position: { x: 0, y: 0 },
                zIndex: 1,
                randomizedSources: false,
            }],
    };
}
export function makeDateInRange(userId, minMonths, maxMonths) {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
        hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0;
    }
    const seed = Math.abs(hash);
    const monthDiff = maxMonths - minMonths;
    const randomMonths = monthDiff > 0 ? (seed % (monthDiff * 30)) / 30 : 0;
    const totalMonths = minMonths + randomMonths;
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth() - Math.floor(totalMonths), 1);
    const maxDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(((seed % maxDay) + 1));
    return target;
}
export function getFakeIdFromDate(dateStr) {
    if (!dateStr || dateStr.trim() === "")
        return "0";
    try {
        let parsedDate;
        const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
        if (ymd) {
            parsedDate = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]), 12, 0, 0, 0);
        }
        else {
            parsedDate = new Date(dateStr);
        }
        if (!isNaN(parsedDate.getTime())) {
            const timestampMs = BigInt(parsedDate.getTime());
            return ((timestampMs - 1420070400000n) << 22n).toString();
        }
    }
    catch { /* ignore */ }
    return "0";
}
export function isCurrentUser(userId) {
    if (!userId)
        return false;
    const originalId = getOriginalMeId();
    return originalId ? userId === originalId : false;
}
export function isManualSavedIdentity(saved) {
    return !!saved?.isManual || String(saved?.id).startsWith("manual_");
}
export function getSavedIdentityForSwitcherId(id) {
    return getSavedUsers().find(saved => saved.id === id);
}
export function getSwitcherAccounts() {
    return getSavedUsers()
        .map(saved => {
        const { id } = saved;
        if (!id)
            return null;
        const isManual = isManualSavedIdentity(saved);
        const username = saved.manualUsername || saved.username || saved.name || (isManual ? "FakeUser" : `User_${String(id).slice(-4)}`);
        const globalName = saved.manualDisplayName || saved.name || username;
        return {
            id,
            userId: id,
            username,
            globalName,
            global_name: globalName,
            discriminator: "0",
            avatar: saved.manualAvatar || saved.avatar || null,
            avatarURL: saved.manualAvatar || saved.avatar || null,
            avatarUrl: saved.manualAvatar || saved.avatar || null,
            getAvatarURL: () => saved.manualAvatar || saved.avatar || null,
            tokenStatus: 1,
            pushSyncToken: null,
            __fakeUserSwitcher: true,
        };
    })
        .filter(Boolean);
}
export function resolveBadge(badge, custom) {
    if (badge === "custom") {
        return custom && custom.trim() !== "" ? custom.trim() : null;
    }
    if (badge && badge !== "") {
        const presets = {
            sword: "https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/sword.svg",
            leaf: "https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/leaf.svg",
            flame: "https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/flame.svg",
            heart: "https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/heart.svg",
            compass: "https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/compass.svg",
            trophy: "https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/trophy.svg",
            shield: "https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/shield.svg",
            crown: "https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/crown.svg",
            star: "https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/star.svg",
            moon: "https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/moon.svg",
            zap: "https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/zap.svg",
            skull: "https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/skull.svg"
        };
        return presets[badge] || null;
    }
    return null;
}
/**
 * Build the active `{ isManual, manualData, user, profile }` payload from a
 * normalized manual-data object (either a SavedUser or the global settings
 * mirror). Centralizes decoration / nameplate / profile-effect / accent /
 * flags / premium / bot so the per-guild and global branches stay identical.
 */
export function buildManualActiveTarget(md) {
    const username = md.manualUsername || md.name || "FakeUser";
    const displayName = md.manualDisplayName || username;
    const badgeVal = resolveBadge(md.manualClanBadge || "", md.manualClanBadgeCustom || "");
    const manualClan = md.manualClanTag && md.manualClanTag.trim() !== "" ? {
        tag: md.manualClanTag.trim(),
        identityGuildId: md.manualClanGuildId || "0",
        identity_guild_id: md.manualClanGuildId || "0",
        identityEnabled: true,
        identity_enabled: true,
        badge: badgeVal
    } : null;
    const manualId = getFakeIdFromDate(md.manualCreatedAt);
    const decoAsset = md.manualAvatarDecoration || md.manualDecorationAsset || "";
    logger.info("[deco] buildManualActiveTarget: manualAvatarDecoration=", md.manualAvatarDecoration, "manualDecorationAsset=", md.manualDecorationAsset, "-> decoAsset=", decoAsset);
    const avatarDecorationData = decoAsset ? {
        asset: decoAsset,
        skuId: decoAsset,
        animated: decoAsset.startsWith("a_"),
    } : undefined;
    const collectibles = md.manualNameplateAsset ? {
        nameplate: {
            asset: md.manualNameplateAsset,
            skuId: md.manualNameplateSkuId || md.manualNameplateAsset,
            palette: md.manualNameplatePalette || undefined,
            label: md.manualNameplateLabel || undefined,
            type: 2,
            expires_at: null,
        },
    } : undefined;
    const publicFlags = md.manualPublicFlags || 0;
    const premiumType = md.manualPremiumType || 0;
    const accentColor = md.manualAccentColor && String(md.manualAccentColor).trim() !== ""
        ? Number(md.manualAccentColor) : null;
    const accentColor2 = md.manualAccentColor2 && String(md.manualAccentColor2).trim() !== ""
        ? Number(md.manualAccentColor2) : null;
    const themeColors = accentColor != null ? [accentColor, accentColor2 ?? accentColor] : undefined;
    const avatarVal = md.manualAvatarDataUrl || md.manualAvatar || "manual";
    const bannerVal = md.manualBannerDataUrl || md.manualBanner || null;
    const profileEffect = settings.store.spoofProfileEffect
        ? buildProfileEffectConfig(md.manualProfileEffectId || "", md.manualProfileEffectAsset)
        : undefined;
    return {
        isManual: true,
        manualData: md,
        user: {
            id: manualId,
            username,
            globalName: displayName,
            global_name: displayName,
            discriminator: md.manualDiscriminator || "0",
            avatar: avatarVal,
            publicFlags,
            flags: publicFlags,
            premiumType,
            bot: !!md.manualBot,
            accentColor,
            avatarDecorationData,
            collectibles,
            clan: manualClan,
            primaryGuild: manualClan,
            primary_guild: manualClan,
        },
        profile: {
            bio: md.manualBio || "",
            pronouns: md.manualPronouns || "",
            banner: bannerVal,
            accentColor,
            themeColors,
            publicFlags,
            premiumType,
            badges: [],
            avatarDecorationData,
            profileEffect,
            profileEffectId: (settings.store.spoofProfileEffect && md.manualProfileEffectId) ? md.manualProfileEffectId : undefined,
            profileEffectExpiresAt: (settings.store.spoofProfileEffect && md.manualProfileEffectId) ? null : undefined,
            clan: manualClan,
            primaryGuild: manualClan,
            primary_guild: manualClan,
        }
    };
}
export function getActiveTargetForGuild(guildId) {
    if (!settings.store.spoofActive)
        return null;
    // Self-spoof guard: if the resolved target is our own account, return null so
    // the real user is never wrapped into itself. Wrapping self re-enters the
    // patched getCurrentUser -> buildOverrides -> getActiveTargetForGuild chain and
    // triggers a Flux render loop that freezes Discord. Overlay mode (below) is the
    // only sanctioned way to apply cosmetics onto the real account.
    const meId = getOriginalMeId();
    const targetIsSelf = (t) => {
        if (!t)
            return false;
        // Overlay mode legitimately keeps the real id; it has its own re-entry guards.
        if (settings.store.overlaySelf)
            return false;
        const uid = t.user?.id;
        return !!meId && !!uid && uid !== "0" && String(uid) === String(meId);
    };
    const gId = guildId ?? SelectedGuildStore?.getGuildId?.();
    if (gId) {
        try {
            const map = getGuildIdentities();
            const savedId = map[gId];
            if (savedId) {
                const saved = getSavedUsers();
                const found = saved.find(s => s.id === savedId);
                if (found) {
                    if (found.isManual) {
                        const t = buildManualActiveTarget(found);
                        return targetIsSelf(t) ? null : t;
                    }
                    else {
                        const cachedTarget = targetsCache.get(found.id) ?? (cached && cached.id === found.id ? cached : null);
                        if (cachedTarget) {
                            const t = {
                                isManual: false,
                                user: cachedTarget.user,
                                profile: cachedTarget.profile
                            };
                            return targetIsSelf(t) ? null : t;
                        }
                        else {
                            // Start fetching target profile in the background
                            if (!loadingGuildTargets.has(found.id) && !failedGuildTargets.has(found.id)) {
                                loadingGuildTargets.add(found.id);
                                loadTarget(found.id, false, /* silent */ true).then(() => {
                                    loadingGuildTargets.delete(found.id);
                                    failedGuildTargets.delete(found.id);
                                    scheduleNotify();
                                }).catch(e => {
                                    loadingGuildTargets.delete(found.id);
                                    failedGuildTargets.add(found.id);
                                    logger.error("Failed to lazy load guild target profile", found.id, e);
                                });
                            }
                        }
                    }
                }
            }
        }
        catch { /* ignore */ }
    }
    // Overlay mode: apply manual cosmetics onto the REAL account, no identity swap.
    // Takes priority over manualMode. Identity stays the real user (so the patched
    // getCurrentUser returns a same-id user and never re-enters into a second target,
    // which is what crashes when you try to "spoof as yourself").
    if (settings.store.overlaySelf) {
        const me = getRealCurrentUser();
        if (!me || !me.id)
            return null;
        // Keyed on epoch + real identity: manual-field edits bump the epoch, and
        // an account switch changes the stamped-in id/avatar fields below.
        const overlayKey = `overlay:${manualTargetEpoch}:${me.id}:${me.avatar ?? ""}`;
        if (_manualTargetKey === overlayKey)
            return _manualTargetCache;
        let overlayBadgeIds = [];
        try {
            const parsed = JSON.parse(settings.store.manualCustomBadgeIds || "[]");
            if (Array.isArray(parsed))
                overlayBadgeIds = parsed;
        }
        catch { /* ignore */ }
        const payload = buildManualActiveTarget({
            manualBio: settings.store.manualBio,
            manualPronouns: settings.store.manualPronouns,
            manualAccentColor: settings.store.manualAccentColor,
            manualAccentColor2: settings.store.manualAccentColor2,
            manualPublicFlags: settings.store.manualPublicFlags,
            manualPremiumType: settings.store.manualPremiumType,
            manualNitroLevel: settings.store.manualNitroLevel,
            manualBoostMonths: settings.store.manualBoostMonths,
            manualNitroSince: settings.store.manualNitroSince,
            manualBoostSince: settings.store.manualBoostSince,
            manualOverlayBanner: settings.store.manualOverlayBanner,
            manualOverlayBannerDataUrl: settings.store.manualOverlayBannerDataUrl,
            manualAvatarDecoration: settings.store.manualAvatarDecoration,
            manualDecorationAsset: settings.store.manualDecorationAsset,
            manualNameplateAsset: settings.store.manualNameplateAsset,
            manualNameplateSkuId: settings.store.manualNameplateSkuId,
            manualNameplatePalette: settings.store.manualNameplatePalette,
            manualNameplateLabel: settings.store.manualNameplateLabel,
            manualProfileEffectId: settings.store.manualProfileEffectId,
            manualProfileEffectAsset: settings.store.manualProfileEffectAsset,
            manualCustomBadgeIds: overlayBadgeIds,
            manualOldName: settings.store.manualOldName,
        });
        // Flag overlay so buildOverrides / profileHook skip identity overrides.
        payload.manualData.overlaySelf = true;
        // Keep the REAL identity — do NOT swap name / avatar / id / discriminator.
        payload.user.id = me.id;
        payload.user.username = me.username;
        payload.user.globalName = me.globalName ?? me.username;
        payload.user.global_name = me.global_name ?? me.globalName ?? me.username;
        payload.user.discriminator = me.discriminator ?? "0";
        payload.user.avatar = me.avatar ?? null;
        payload.user.banner = me.banner ?? null;
        payload.user.bot = me.bot ?? false;
        // No identity clan swap in overlay mode.
        payload.user.clan = null;
        payload.user.primaryGuild = null;
        payload.user.primary_guild = null;
        payload.profile.clan = null;
        payload.profile.primaryGuild = null;
        payload.profile.primary_guild = null;
        _manualTargetKey = overlayKey;
        _manualTargetCache = payload;
        return payload;
    }
    // Fallback to global
    if (settings.store.manualMode) {
        const manualKey = `manual:${manualTargetEpoch}:${meId ?? ""}`;
        if (_manualTargetKey === manualKey)
            return _manualTargetCache;
        let manualCustomBadgeIds = [];
        try {
            const parsed = JSON.parse(settings.store.manualCustomBadgeIds || "[]");
            if (Array.isArray(parsed))
                manualCustomBadgeIds = parsed;
        }
        catch { /* ignore */ }
        const globalManual = buildManualActiveTarget({
            manualUsername: settings.store.manualUsername,
            manualDisplayName: settings.store.manualDisplayName,
            manualClanTag: settings.store.manualClanTag,
            manualAvatar: settings.store.manualAvatar,
            manualBio: settings.store.manualBio,
            manualPronouns: settings.store.manualPronouns,
            manualBanner: settings.store.manualBanner,
            manualEmail: settings.store.manualEmail,
            manualPhone: settings.store.manualPhone,
            manualStatus: settings.store.manualStatus,
            manualActivityName: settings.store.manualActivityName,
            manualActivityType: settings.store.manualActivityType,
            manualActivityState: settings.store.manualActivityState,
            manualActivityDetails: settings.store.manualActivityDetails,
            manualActivityStartTimer: settings.store.manualActivityStartTimer,
            manualActivityLargeImage: settings.store.manualActivityLargeImage,
            manualActivityLargeText: settings.store.manualActivityLargeText,
            manualActivitySmallImage: settings.store.manualActivitySmallImage,
            manualActivitySmallText: settings.store.manualActivitySmallText,
            manualCreatedAt: settings.store.manualCreatedAt,
            manualClanGuildId: settings.store.manualClanGuildId,
            manualClanBadge: settings.store.manualClanBadge,
            manualClanBadgeCustom: settings.store.manualClanBadgeCustom,
            manualAvatarDataUrl: settings.store.manualAvatarDataUrl,
            manualBannerDataUrl: settings.store.manualBannerDataUrl,
            manualAccentColor: settings.store.manualAccentColor,
            manualAccentColor2: settings.store.manualAccentColor2,
            manualPublicFlags: settings.store.manualPublicFlags,
            manualPremiumType: settings.store.manualPremiumType,
            manualNitroLevel: settings.store.manualNitroLevel,
            manualBoostMonths: settings.store.manualBoostMonths,
            manualNitroSince: settings.store.manualNitroSince,
            manualBoostSince: settings.store.manualBoostSince,
            manualBot: settings.store.manualBot,
            manualDiscriminator: settings.store.manualDiscriminator,
            manualAvatarDecoration: settings.store.manualAvatarDecoration,
            manualDecorationAsset: settings.store.manualDecorationAsset,
            manualNameplateAsset: settings.store.manualNameplateAsset,
            manualNameplateSkuId: settings.store.manualNameplateSkuId,
            manualNameplatePalette: settings.store.manualNameplatePalette,
            manualNameplateLabel: settings.store.manualNameplateLabel,
            manualProfileEffectId: settings.store.manualProfileEffectId,
            manualProfileEffectAsset: settings.store.manualProfileEffectAsset,
            manualCustomBadgeIds,
            manualOldName: settings.store.manualOldName,
        });
        const manualResult = targetIsSelf(globalManual) ? null : globalManual;
        _manualTargetKey = manualKey;
        _manualTargetCache = manualResult;
        return manualResult;
    }
    if (cached) {
        const t = {
            isManual: false,
            user: cached.user,
            profile: cached.profile
        };
        return targetIsSelf(t) ? null : t;
    }
    return null;
}
export function isActive(guildId) {
    if (settings.store.spoofedStatus && settings.store.spoofedStatus !== "none")
        return true;
    if (!settings.store.spoofActive)
        return false;
    const active = getActiveTargetForGuild(guildId);
    return !!active;
}
export function setEnabled(value) {
    settings.store.spoofActive = value;
    if (!value) {
        failedGuildTargets.clear();
    }
    notify();
}
export function getSavedUsers() {
    const raw = settings.store.savedUsers || "[]";
    if (raw === _savedUsersRaw && _savedUsersCache)
        return _savedUsersCache;
    try {
        const parsed = JSON.parse(raw);
        _savedUsersCache = Array.isArray(parsed) ? parsed : [];
    }
    catch {
        _savedUsersCache = [];
    }
    _savedUsersRaw = raw;
    return _savedUsersCache;
}
export function setSavedUsers(list) {
    settings.store.savedUsers = JSON.stringify(list);
    _savedUsersCache = null;
    _savedUsersRaw = null;
}
export function preLoadGuildTargets() {
    try {
        const map = getGuildIdentities();
        const saved = getSavedUsers();
        for (const savedId of Object.values(map)) {
            if (savedId) {
                const found = saved.find(s => s.id === savedId);
                if (found && !found.isManual) {
                    loadTarget(found.id, false).catch(e => {
                        logger.warn("Failed to pre-load guild target profile", found.id, e);
                    });
                }
            }
        }
    }
    catch (e) {
        logger.warn("Failed to parse guildIdentities during pre-load", e);
    }
}
export const settings = definePluginSettings({
    spoofActive: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Whether the spoof is currently active.",
        default: false,
    },
    targetId: {
        type: 0 /* OptionType.STRING */,
        description: "User ID to impersonate visually.",
        default: "",
    },
    fakeMessages: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "When sending a message, post a local fake one as the target user instead of really sending it.",
        default: true,
    },
    sendRealToo: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Also send the real message to the channel (in addition to the fake one). Off means client-side only.",
        default: false,
    },
    spoofBadges: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Mirror the target's badges onto your client-side profile.",
        default: true,
    },
    spoofActivities: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Mirror the target's connected accounts and game collection.",
        default: true,
    },
    patchInternalAccountSwitcher: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Inject fake identities into Discord's native account switcher and let them be activated from there.",
        default: false,
        restartNeeded: true,
    },
    savedUsers: {
        type: 0 /* OptionType.STRING */,
        description: "Saved user IDs (JSON)",
        default: "[]",
        hidden: true,
    },
    manualMode: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Use a custom username and avatar instead of cloning a user ID.",
        default: false,
        hidden: true,
    },
    manualUsername: {
        type: 0 /* OptionType.STRING */,
        description: "Custom username for manual mode.",
        default: "FakeUser",
        hidden: true,
    },
    manualDisplayName: {
        type: 0 /* OptionType.STRING */,
        description: "Custom display name for manual mode (separate from username).",
        default: "",
        hidden: true,
    },
    manualClanTag: {
        type: 0 /* OptionType.STRING */,
        description: "Custom server tag for manual mode.",
        default: "",
        hidden: true,
    },
    manualAvatar: {
        type: 0 /* OptionType.STRING */,
        description: "Custom avatar URL for manual mode.",
        default: "",
        hidden: true,
    },
    manualBio: {
        type: 0 /* OptionType.STRING */,
        description: "Custom bio / About Me in manual mode.",
        default: "",
        hidden: true,
    },
    manualPronouns: {
        type: 0 /* OptionType.STRING */,
        description: "Custom pronouns in manual mode.",
        default: "",
        hidden: true,
    },
    manualBanner: {
        type: 0 /* OptionType.STRING */,
        description: "Custom banner image URL or solid color hex in manual mode.",
        default: "",
        hidden: true,
    },
    manualEmail: {
        type: 0 /* OptionType.STRING */,
        description: "Custom email for manual mode.",
        default: "",
        hidden: true,
    },
    manualPhone: {
        type: 0 /* OptionType.STRING */,
        description: "Custom phone number for manual mode.",
        default: "",
        hidden: true,
    },
    manualStatus: {
        type: 4 /* OptionType.SELECT */,
        description: "Spoofed status in manual mode.",
        default: "online",
        options: [
            { label: "Online", value: "online", default: true },
            { label: "Idle", value: "idle" },
            { label: "Do Not Disturb", value: "dnd" },
            { label: "Offline", value: "offline" }
        ],
        hidden: true,
    },
    manualActivityName: {
        type: 0 /* OptionType.STRING */,
        description: "Spoofed activity name in manual mode.",
        default: "",
        hidden: true,
    },
    manualActivityType: {
        type: 4 /* OptionType.SELECT */,
        description: "Spoofed activity type in manual mode.",
        default: 0,
        options: [
            { label: "Playing", value: 0, default: true },
            { label: "Streaming", value: 1 },
            { label: "Listening to", value: 2 },
            { label: "Watching", value: 3 },
            { label: "Custom Status", value: 4 },
            { label: "Competing in", value: 5 }
        ],
        hidden: true,
    },
    manualActivityState: {
        type: 0 /* OptionType.STRING */,
        description: "Spoofed activity state (e.g. In Match, Chilling).",
        default: "",
        hidden: true,
    },
    manualActivityDetails: {
        type: 0 /* OptionType.STRING */,
        description: "Spoofed activity details (e.g. Playing Solo, Level 42).",
        default: "",
        hidden: true,
    },
    manualActivityStartTimer: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show a timer (time elapsed) in custom manual activity.",
        default: false,
        hidden: true,
    },
    manualActivityStartTimestamp: {
        type: 1 /* OptionType.NUMBER */,
        description: "Internal start timestamp for manual activity.",
        default: 0,
        hidden: true,
    },
    manualActivityLargeImage: {
        type: 0 /* OptionType.STRING */,
        description: "Custom activity Large Image URL or key.",
        default: "",
        hidden: true,
    },
    manualActivityLargeText: {
        type: 0 /* OptionType.STRING */,
        description: "Custom activity Large Image hover text.",
        default: "",
        hidden: true,
    },
    manualActivitySmallImage: {
        type: 0 /* OptionType.STRING */,
        description: "Custom activity Small Image URL or key.",
        default: "",
        hidden: true,
    },
    manualActivitySmallText: {
        type: 0 /* OptionType.STRING */,
        description: "Custom activity Small Image hover text.",
        default: "",
        hidden: true,
    },
    uiMode: {
        type: 4 /* OptionType.SELECT */,
        description: "Which user profile spoofing UI mode to use.",
        default: "modern",
        options: [
            { label: "legacy", value: "legacy" },
            { label: "modern", value: "modern", default: true }
        ],
    },
    disableAnimations: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Disable all transitions and animations in the visual settings switcher.",
        default: false,
    },
    configExpanded: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Whether the configuration accordion is expanded.",
        default: true,
        hidden: true,
    },
    manualExpanded: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Whether the manual spoofing accordion is expanded.",
        default: false,
        hidden: true,
    },
    guildIdentities: {
        type: 0 /* OptionType.STRING */,
        description: "Guild specific identities mapped (JSON)",
        default: "{}",
        hidden: true,
    },
    cachedProfiles: {
        type: 0 /* OptionType.STRING */,
        description: "Persistent cache of target profiles (JSON)",
        default: "[]",
        hidden: true,
    },
    customRpcEnabled: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Enable custom Rich Presence activity spoofing.",
        default: false,
    },
    fakeConnectionsEnabled: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Enable custom fake connections on your profile.",
        default: false,
    },
    fakeConnectionsList: {
        type: 0 /* OptionType.STRING */,
        description: "List of fake connections (JSON)",
        default: "[]",
        hidden: true,
    },
    customRpcExpanded: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Whether the custom RPC accordion is expanded.",
        default: false,
        hidden: true,
    },
    connectionsExpanded: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Whether the fake connections accordion is expanded.",
        default: false,
        hidden: true,
    },
    spoofedStatus: {
        type: 0 /* OptionType.STRING */,
        description: "Override your client-side presence status globally.",
        default: "none",
    },
    manualCreatedAt: {
        type: 0 /* OptionType.STRING */,
        description: "Custom creation date in manual mode.",
        default: "",
        hidden: true,
    },
    manualClanGuildId: {
        type: 0 /* OptionType.STRING */,
        description: "Guild/server ID whose icon is used for the server tag in manual mode.",
        default: "",
        hidden: true,
    },
    manualClanBadge: {
        type: 0 /* OptionType.STRING */,
        description: "Predefined badge type for the server tag.",
        default: "",
        hidden: true,
    },
    manualClanBadgeCustom: {
        type: 0 /* OptionType.STRING */,
        description: "Custom badge hash or direct image URL.",
        default: "",
        hidden: true,
    },
    // ── Ported from fakeUserProfile (global manual-mode mirrors) ──
    manualAvatarDataUrl: {
        type: 0 /* OptionType.STRING */,
        description: "Uploaded avatar as a data URL in manual mode.",
        default: "",
        hidden: true,
    },
    manualBannerDataUrl: {
        type: 0 /* OptionType.STRING */,
        description: "Uploaded banner as a data URL in manual mode.",
        default: "",
        hidden: true,
    },
    manualAccentColor: {
        type: 0 /* OptionType.STRING */,
        description: "Accent color (decimal) in manual mode.",
        default: "",
        hidden: true,
    },
    manualAccentColor2: {
        type: 0 /* OptionType.STRING */,
        description: "Secondary accent color for the profile gradient in manual mode.",
        default: "",
        hidden: true,
    },
    manualPublicFlags: {
        type: 1 /* OptionType.NUMBER */,
        description: "Badge-flag bitfield in manual mode.",
        default: 0,
        hidden: true,
    },
    manualPremiumType: {
        type: 1 /* OptionType.NUMBER */,
        description: "Nitro premium type (0-3) in manual mode.",
        default: 0,
        hidden: true,
    },
    manualNitroLevel: {
        type: 1 /* OptionType.NUMBER */,
        description: "Nitro tier badge level in manual mode (-1 = none).",
        default: -1,
        hidden: true,
    },
    manualBoostMonths: {
        type: 1 /* OptionType.NUMBER */,
        description: "Boost tier badge level in manual mode (-1 = none).",
        default: -1,
        hidden: true,
    },
    manualOverlayBanner: {
        type: 0 /* OptionType.STRING */,
        description: "Overlay-mode custom banner: image/gif URL or #hex color. Blank = use your real account banner.",
        default: "",
        hidden: true,
    },
    manualOverlayBannerDataUrl: {
        type: 0 /* OptionType.STRING */,
        description: "Overlay-mode uploaded banner as a data URL. Takes priority over manualOverlayBanner.",
        default: "",
        hidden: true,
    },
    manualNitroSince: {
        type: 0 /* OptionType.STRING */,
        description: "Custom 'Subscriber since' date (YYYY-MM-DD) for the spoofed Nitro badge. Blank = auto date from tier.",
        default: "",
        hidden: true,
    },
    manualBoostSince: {
        type: 0 /* OptionType.STRING */,
        description: "Custom 'Server boosting since' date (YYYY-MM-DD) for the spoofed boost badge. Blank = auto date from tier.",
        default: "",
        hidden: true,
    },
    manualBot: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show the profile as a bot user in manual mode.",
        default: false,
        hidden: true,
    },
    manualDiscriminator: {
        type: 0 /* OptionType.STRING */,
        description: "Discriminator in manual mode.",
        default: "0",
        hidden: true,
    },
    manualAvatarDecoration: {
        type: 0 /* OptionType.STRING */,
        description: "Avatar decoration asset in manual mode.",
        default: "",
        hidden: true,
    },
    manualDecorationAsset: {
        type: 0 /* OptionType.STRING */,
        description: "Custom avatar decoration asset ID in manual mode.",
        default: "",
        hidden: true,
    },
    manualNameplateAsset: {
        type: 0 /* OptionType.STRING */,
        description: "Nameplate asset in manual mode.",
        default: "",
        hidden: true,
    },
    manualNameplateSkuId: {
        type: 0 /* OptionType.STRING */,
        description: "Nameplate SKU ID in manual mode.",
        default: "",
        hidden: true,
    },
    manualNameplatePalette: {
        type: 0 /* OptionType.STRING */,
        description: "Nameplate palette in manual mode.",
        default: "",
        hidden: true,
    },
    manualNameplateLabel: {
        type: 0 /* OptionType.STRING */,
        description: "Nameplate label in manual mode.",
        default: "",
        hidden: true,
    },
    manualProfileEffectId: {
        type: 0 /* OptionType.STRING */,
        description: "Profile effect SKU ID in manual mode.",
        default: "",
        hidden: true,
    },
    manualProfileEffectAsset: {
        type: 0 /* OptionType.STRING */,
        description: "Profile effect asset in manual mode.",
        default: "",
        hidden: true,
    },
    manualCustomBadgeIds: {
        type: 0 /* OptionType.STRING */,
        description: "Custom badge IDs (JSON array) in manual mode.",
        default: "[]",
        hidden: true,
    },
    manualOldName: {
        type: 0 /* OptionType.STRING */,
        description: "Old username for the old-username custom badge in manual mode.",
        default: "",
        hidden: true,
    },
    overlaySelf: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Apply the manual cosmetic overrides onto your own real account instead of replacing your identity.",
        default: false,
        hidden: true,
    },
    spoofNameplate: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Mirror the chosen nameplate onto your client-side profile.",
        default: true,
    },
    spoofProfileEffect: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Mirror the chosen profile effect onto your client-side profile.",
        default: true,
    },
    fakeNitroMonths: {
        type: 1 /* OptionType.NUMBER */,
        description: "Spoof client-side Nitro age in months (0 to disable).",
        default: 0,
        onChange() {
            notify();
        }
    },
    nitroExpanded: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Whether the fake Nitro accordion is expanded.",
        default: false,
        hidden: true,
    },
});
