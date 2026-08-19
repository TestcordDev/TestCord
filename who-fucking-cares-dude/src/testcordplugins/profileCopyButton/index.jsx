/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { addContextMenuPatch, removeContextMenuPatch } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { getUserSettingLazy } from "@api/UserSettings";
import ErrorBoundary from "@components/ErrorBoundary";
import { Flex } from "@components/Flex";
import { TestcordDevs } from "@utils/constants";
import { fetchUserProfile } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { Margins } from "@utils/margins";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { findComponentByCodeLazy } from "@webpack";
import { Button, Constants, DisplayProfileUtils, FluxDispatcher, GuildStore, IconUtils, Menu, PermissionsBits, PermissionStore, PresenceStore, RestAPI, Select, showToast, Text, TextInput, Toasts, UserStore, useState } from "@webpack/common";
const CustomizationSection = findComponentByCodeLazy(".DESCRIPTION", "hasBackground:");
const CustomStatusSetting = getUserSettingLazy("status", "customStatus");
const logger = new Logger("ProfileCopyButton");
const CUSTOM_EMOJI_RE = /<(a?):([A-Za-z0-9_~]+):(\d+)>/g;
const ID_RE = /^\d{17,20}$/;
const settings = definePluginSettings({
    copyGameCollection: {
        type: 3 /* OptionType.BOOLEAN */,
        default: false,
        description: "Also copy the target user's profile game widgets (favourite game, currently playing, want to play, played, game stats). Applies immediately, not via Save."
    },
    clearMissingFields: {
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
        description: "If the target user doesn't have a profile effect, name style, banner, etc., clear those fields from your profile too."
    }
});
// ─── Emoji helpers ────────────────────────────────────────────────────────────
function parseEmojisFromBio(bio) {
    const found = [];
    const seen = new Set();
    for (const match of bio.matchAll(CUSTOM_EMOJI_RE)) {
        const [full, anim, name, id] = match;
        if (!seen.has(id)) {
            seen.add(id);
            found.push({ animated: anim === "a", name, id, full });
        }
    }
    return found;
}
/** Returns all emoji IDs the current user already has access to (across all guilds). */
function getOwnedEmojiMap() {
    const map = new Map();
    for (const guild of Object.values(GuildStore.getGuilds())) {
        for (const emoji of guild.emojis ?? []) {
            map.set(emoji.id, { id: emoji.id, name: emoji.name, animated: !!emoji.animated });
        }
    }
    return map;
}
/** Returns guilds where the current user can manage emojis, sorted by name. */
function getManageableGuilds() {
    return Object.values(GuildStore.getGuilds())
        .filter(g => PermissionStore.can(PermissionsBits.MANAGE_GUILD_EXPRESSIONS, g))
        .sort((a, b) => a.name.localeCompare(b.name));
}
async function uploadEmojiToGuild(guildId, emoji) {
    try {
        const ext = emoji.animated ? "gif" : "png";
        const url = `https://cdn.discordapp.com/emojis/${emoji.id}.${ext}`;
        const dataUri = await urlToDataUri(url);
        if (!dataUri)
            return null;
        const res = await RestAPI.post({
            url: Constants.Endpoints.GUILD_EMOJIS(guildId),
            body: {
                name: emoji.name,
                image: dataUri,
                roles: []
            }
        });
        return res?.body?.id ?? null;
    }
    catch (err) {
        logger.error("Failed to upload emoji", emoji.name, err);
        return null;
    }
}
/** Opens a modal to pick a guild, uploads missing emojis, returns remapped bio. */
function resolveEmojisInBio(bio) {
    return new Promise(resolve => {
        const emojis = parseEmojisFromBio(bio);
        if (emojis.length === 0) {
            resolve(bio);
            return;
        }
        const ownedMap = getOwnedEmojiMap();
        const missing = emojis.filter(e => !ownedMap.has(e.id));
        if (missing.length === 0) {
            // All emojis already owned — nothing to upload
            resolve(bio);
            return;
        }
        openModal(props => (<EmojiGuildPickerModal modalProps={props} missingEmojis={missing} onConfirm={async (guildId) => {
                if (!guildId) {
                    // User skipped — strip missing emojis from bio
                    let result = bio;
                    for (const e of missing)
                        result = result.split(e.full).join("");
                    resolve(result.replace(/[ \t]+\n/g, "\n").trim());
                    return;
                }
                let result = bio;
                for (const e of missing) {
                    const newId = await uploadEmojiToGuild(guildId, e);
                    if (newId) {
                        const prefix = e.animated ? "a" : "";
                        result = result.split(e.full).join(`<${prefix}:${e.name}:${newId}>`);
                    }
                    else {
                        // Upload failed — strip that emoji
                        result = result.split(e.full).join("");
                    }
                }
                resolve(result.replace(/[ \t]+\n/g, "\n").trim());
            }}/>));
    });
}
// ─── Guild picker modal ───────────────────────────────────────────────────────
function EmojiGuildPickerModal({ modalProps, missingEmojis, onConfirm }) {
    const guilds = getManageableGuilds();
    const [selectedGuildId, setSelectedGuildId] = useState(guilds[0]?.id ?? "");
    const [busy, setBusy] = useState(false);
    async function handleUpload() {
        if (!selectedGuildId || busy)
            return;
        setBusy(true);
        modalProps.onClose();
        await onConfirm(selectedGuildId);
    }
    function handleSkip() {
        modalProps.onClose();
        onConfirm(null);
    }
    const emojiList = missingEmojis.map(e => `${e.animated ? "(animated) " : ""}:${e.name}:`).join(", ");
    return (<ModalRoot {...modalProps} size={"small" /* ModalSize.SMALL */}>
            <ModalHeader>
                <Text variant="heading-lg/semibold" style={{ flexGrow: 1 }}>Upload missing emojis</Text>
                <ModalCloseButton onClick={handleSkip}/>
            </ModalHeader>
            <ModalContent>
                <Text variant="text-sm/normal" className={Margins.bottom8}>
                    The bio contains {missingEmojis.length} custom emoji{missingEmojis.length !== 1 ? "s" : ""} you don't have access to:
                </Text>
                <Text variant="text-sm/normal" style={{ fontStyle: "italic" }} className={Margins.bottom16}>
                    {emojiList}
                </Text>
                <Text variant="text-sm/normal" className={Margins.bottom8}>
                    Select a server to upload them to, or skip to remove them from the bio.
                </Text>
                {guilds.length === 0
            ? <Text variant="text-sm/normal" style={{ color: "var(--text-danger)" }}>
                        You don't have Manage Expressions permission in any server.
                    </Text>
            : <Select options={guilds.map(g => ({ label: g.name, value: g.id }))} select={setSelectedGuildId} isSelected={v => v === selectedGuildId} serialize={v => v}/>}
            </ModalContent>
            <ModalFooter>
                <Flex>
                    <Button color={Button.Colors.PRIMARY} onClick={handleSkip}>
                        Skip (remove from bio)
                    </Button>
                    <Button onClick={handleUpload} disabled={busy || guilds.length === 0 || !selectedGuildId}>
                        {busy ? "Uploading..." : "Upload & Continue"}
                    </Button>
                </Flex>
            </ModalFooter>
        </ModalRoot>);
}
// ─── Core helpers ─────────────────────────────────────────────────────────────
async function fetchRawProfile(targetId, guildId) {
    try {
        const qs = guildId
            ? `with_mutual_guilds=false&guild_id=${guildId}`
            : "with_mutual_guilds=false";
        const res = await RestAPI.get({ url: `/users/${targetId}/profile?${qs}` });
        return (res?.body ?? null);
    }
    catch (err) {
        logger.error("Failed to fetch raw profile", err);
        return null;
    }
}
async function urlToDataUri(url) {
    try {
        const res = await fetch(url);
        if (!res.ok)
            return null;
        const blob = await res.blob();
        return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }
    catch (err) {
        logger.error("Failed to fetch image", url, err);
        return null;
    }
}
function hasNitro() {
    const premium = UserStore.getCurrentUser()?.premiumType ?? 0;
    return premium >= 1;
}
function setPendingChange(payload) {
    FluxDispatcher.dispatch({ type: "USER_PROFILE_SETTINGS_SET_PENDING_CHANGES", ...payload });
}
function getCustomStatusActivity(userId) {
    const activities = (PresenceStore.getActivities(userId) ?? []);
    return activities.find(a => a.type === 4);
}
function resolveTargetUserId(input) {
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
// ─── Guild auto-join ──────────────────────────────────────────────────────────
async function tryAutoJoinGuild(guildId) {
    // Already a member?
    if (GuildStore.getGuild(guildId))
        return;
    let inviteCode = null;
    let guildName = "the server";
    // Try vanity URL first — works for most public servers
    try {
        const vanityRes = await RestAPI.get({ url: `/guilds/${guildId}/vanity-url` });
        if (vanityRes?.body?.code)
            inviteCode = vanityRes.body.code;
    }
    catch { /* no vanity */ }
    // Try guild preview for discoverable servers
    if (!inviteCode) {
        try {
            const previewRes = await RestAPI.get({ url: `/guilds/${guildId}/preview` });
            if (previewRes?.body) {
                guildName = previewRes.body.name ?? guildName;
                if (previewRes.body.vanity_url_code)
                    inviteCode = previewRes.body.vanity_url_code;
            }
        }
        catch { /* not discoverable */ }
    }
    if (!inviteCode) {
        showToast("Server is private — can't auto-join.", Toasts.Type.MESSAGE);
        return;
    }
    try {
        const joinRes = await RestAPI.post({ url: `/invites/${inviteCode}`, body: {} });
        guildName = joinRes?.body?.guild?.name ?? guildName;
        // Set the guild as primary clan (shows the tag on profile)
        try {
            await RestAPI.patch({ url: "/users/@me", body: { primary_guild: guildId } });
            showToast(`Joined ${guildName} and set clan tag!`, Toasts.Type.SUCCESS);
        }
        catch {
            showToast(`Joined ${guildName}! (Could not set clan tag automatically)`, Toasts.Type.SUCCESS);
        }
    }
    catch (err) {
        logger.error("Failed to join guild", guildId, err);
        showToast("Could not join the server (may be private).", Toasts.Type.MESSAGE);
    }
}
// ─── Server profile copy logic ────────────────────────────────────────────────
/** Returns true if the user has a meaningful server profile different from their global one. */
function hasServerProfile(rawProfile) {
    if (!rawProfile)
        return false;
    const gm = rawProfile.guild_member;
    if (!gm)
        return false;
    // Has a guild-specific avatar, banner, bio or nick
    return !!(gm.avatar || gm.banner || gm.bio || gm.nick);
}
async function copyServerProfile(targetId, rawProfile, guildId) {
    const targetUser = UserStore.getUser(targetId);
    if (!targetUser) {
        showToast("Could not load that user.", Toasts.Type.FAILURE);
        return;
    }
    const nitro = hasNitro();
    const clear = settings.store.clearMissingFields;
    let dispatched = 0;
    const gm = rawProfile.guild_member;
    // Nick → display name
    const nick = gm?.nick ?? targetUser.globalName;
    if (nick) {
        setPendingChange({ pendingGlobalName: nick });
        dispatched++;
    }
    else if (clear) {
        setPendingChange({ pendingGlobalName: "" });
    }
    // Bio
    const rawBio = gm?.bio ?? rawProfile.user_profile?.bio ?? "";
    if (rawBio) {
        let bioToSet = nitro ? rawBio : rawBio.replace(CUSTOM_EMOJI_RE, "").replace(/[ \t]+\n/g, "\n").trim();
        if (nitro)
            bioToSet = await resolveEmojisInBio(bioToSet);
        setPendingChange({ pendingBio: bioToSet });
        dispatched++;
    }
    else if (clear) {
        setPendingChange({ pendingBio: "" });
    }
    // Avatar (guild-specific or global fallback)
    const guildAvatar = gm?.avatar;
    if (guildAvatar) {
        const url = `https://cdn.discordapp.com/guilds/${guildId}/users/${targetId}/avatars/${guildAvatar}.${guildAvatar.startsWith("a_") ? "gif" : "png"}?size=512`;
        const dataUri = await urlToDataUri(url);
        if (dataUri) {
            setPendingChange({ pendingAvatar: { assetOrigin: "NEW_ASSET", imageUri: dataUri, description: `server-profile-copy-${targetId}` } });
            dispatched++;
        }
    }
    else if (targetUser.avatar) {
        const url = IconUtils.getUserAvatarURL(targetUser, nitro, 512);
        const dataUri = url ? await urlToDataUri(url) : null;
        if (dataUri) {
            setPendingChange({ pendingAvatar: { assetOrigin: "NEW_ASSET", imageUri: dataUri, description: `profile-copy-${targetId}` } });
            dispatched++;
        }
    }
    // Banner (guild-specific or global fallback)
    if (nitro) {
        const guildBanner = gm?.banner;
        if (guildBanner) {
            const url = `https://cdn.discordapp.com/guilds/${guildId}/users/${targetId}/banners/${guildBanner}.${guildBanner.startsWith("a_") ? "gif" : "png"}?size=1024`;
            const dataUri = await urlToDataUri(url);
            if (dataUri) {
                setPendingChange({ pendingBanner: dataUri });
                dispatched++;
            }
        }
        else {
            const profile = await fetchUserProfile(targetId, undefined, false).catch(() => null);
            if (profile?.banner) {
                const display = DisplayProfileUtils.getDisplayProfile(targetId);
                const url = display?.getBannerURL({ canAnimate: true, size: 1024 })
                    ?? IconUtils.getUserBannerURL({ id: targetUser.id, banner: profile.banner, canAnimate: true, size: 1024 });
                const dataUri = url ? await urlToDataUri(url) : null;
                if (dataUri) {
                    setPendingChange({ pendingBanner: dataUri });
                    dispatched++;
                }
            }
            else if (clear) {
                setPendingChange({ pendingBanner: null });
            }
        }
    }
    // Auto-join guild
    await tryAutoJoinGuild(guildId);
    if (dispatched === 0) {
        showToast("Nothing to copy from that server profile.", Toasts.Type.MESSAGE);
        return;
    }
    showToast(`Copied server profile from ${targetUser.username}. Click Save to apply.`, Toasts.Type.SUCCESS);
}
async function copyGameWidgets(targetId, rawProfile) {
    const display = DisplayProfileUtils.getDisplayProfile(targetId);
    const widgets = display?.widgets ?? rawProfile?.widgets;
    const endpoint = Constants.Endpoints.USER_PROFILE_WIDGETS ?? "/users/@me/widgets";
    if (!widgets || widgets.length === 0) {
        if (settings.store.clearMissingFields) {
            try {
                await RestAPI.put({ url: endpoint, body: { widgets: [] } });
            }
            catch (err) {
                logger.error("Failed to clear game widgets", err);
            }
        }
        return false;
    }
    try {
        // Discord's PUT /widgets API requires a specific format:
        // - each widget keeps its id (any valid snowflake works)
        // - games must be nested inside a "data" object with a "type" field
        // - each game uses "game_id" instead of "applicationId"
        const sanitized = widgets.map((w) => ({
            id: w.id,
            type: w.type,
            data: {
                type: w.type,
                games: (w.games ?? []).map((g) => ({
                    game_id: g.applicationId ?? g.game_id,
                    ...(g.comment != null && { comment: g.comment }),
                    tags: g.tags ?? []
                }))
            }
        }));
        await RestAPI.put({ url: endpoint, body: { widgets: sanitized } });
        return true;
    }
    catch (err) {
        logger.error("Failed to copy game widgets", err);
        return false;
    }
}
// ─── Main copy logic ──────────────────────────────────────────────────────────
export async function copyProfileFromId(targetId, guildId) {
    const [profile, rawProfile] = await Promise.all([
        fetchUserProfile(targetId, undefined, false).catch(err => {
            logger.error("Failed to fetch profile", err);
            return null;
        }),
        fetchRawProfile(targetId, guildId)
    ]);
    const targetUser = UserStore.getUser(targetId);
    if (!targetUser) {
        showToast("Could not load that user.", Toasts.Type.FAILURE);
        return;
    }
    const nitro = hasNitro();
    const clear = settings.store.clearMissingFields;
    let dispatched = 0;
    // Display name
    if (targetUser.globalName) {
        setPendingChange({ pendingGlobalName: targetUser.globalName });
        dispatched++;
    }
    else if (clear) {
        setPendingChange({ pendingGlobalName: "" });
    }
    // Pronouns
    if (profile?.pronouns) {
        setPendingChange({ pendingPronouns: profile.pronouns });
        dispatched++;
    }
    else if (clear) {
        setPendingChange({ pendingPronouns: "" });
    }
    // Bio — resolve custom emojis first
    const rawBio = profile?.bio ?? "";
    if (rawBio) {
        let bioToSet = nitro ? rawBio : rawBio.replace(CUSTOM_EMOJI_RE, "").replace(/[ \t]+\n/g, "\n").trim();
        if (nitro) {
            bioToSet = await resolveEmojisInBio(bioToSet);
        }
        setPendingChange({ pendingBio: bioToSet });
        dispatched++;
    }
    else if (clear) {
        setPendingChange({ pendingBio: "" });
    }
    if (nitro) {
        // Theme colors
        if (profile?.themeColors) {
            setPendingChange({ pendingThemeColors: [...profile.themeColors] });
            dispatched++;
        }
        else if (clear) {
            setPendingChange({ pendingThemeColors: null });
        }
        // Accent color
        if (profile?.accentColor != null) {
            setPendingChange({ pendingAccentColor: profile.accentColor });
            dispatched++;
        }
        else if (clear) {
            setPendingChange({ pendingAccentColor: null });
        }
        // Profile effect
        const effectSkuId = rawProfile?.user_profile?.profile_effect?.sku_id;
        if (effectSkuId) {
            setPendingChange({ pendingProfileEffectId: effectSkuId });
            dispatched++;
        }
        else if (clear) {
            setPendingChange({ pendingProfileEffectId: null });
        }
        // Display name styles
        const dns = rawProfile?.user?.display_name_styles;
        if (dns && (dns.font_id != null || dns.effect_id != null || dns.colors?.length)) {
            setPendingChange({
                pendingDisplayNameStyles: {
                    ...(dns.font_id != null && { fontId: dns.font_id }),
                    ...(dns.effect_id != null && { effectId: dns.effect_id }),
                    colors: dns.colors ? [...dns.colors] : []
                }
            });
            dispatched++;
        }
        else if (clear) {
            setPendingChange({ pendingDisplayNameStyles: null });
        }
    }
    // Avatar
    if (targetUser.avatar) {
        const url = IconUtils.getUserAvatarURL(targetUser, nitro, 512);
        const dataUri = url ? await urlToDataUri(url) : null;
        if (dataUri) {
            setPendingChange({
                pendingAvatar: {
                    assetOrigin: "NEW_ASSET",
                    imageUri: dataUri,
                    description: `profile-copy-${targetUser.id}`
                }
            });
            dispatched++;
        }
    }
    // Banner
    if (nitro && profile?.banner) {
        const display = DisplayProfileUtils.getDisplayProfile(targetId);
        const url = display?.getBannerURL({ canAnimate: true, size: 1024 })
            ?? IconUtils.getUserBannerURL({ id: targetUser.id, banner: profile.banner, canAnimate: true, size: 1024 });
        const dataUri = url ? await urlToDataUri(url) : null;
        if (dataUri) {
            setPendingChange({ pendingBanner: dataUri });
            dispatched++;
        }
    }
    else if (nitro && clear) {
        setPendingChange({ pendingBanner: null });
    }
    // Custom status
    const status = getCustomStatusActivity(targetId);
    if (status?.state || status?.emoji) {
        const { emoji } = status;
        const useCustomEmoji = nitro && !!emoji?.id;
        CustomStatusSetting.updateSetting({
            text: status.state ?? "",
            emojiId: useCustomEmoji && emoji?.id ? emoji.id : "0",
            emojiName: emoji?.name ?? "",
            expiresAtMs: "0",
            createdAtMs: String(Date.now())
        });
        dispatched++;
    }
    // Clan tag
    const clan = rawProfile?.user?.clan ?? rawProfile?.user?.primary_guild;
    const clanGuildId = rawProfile?.user?.clan?.identity_guild_id ?? clan?.identity_guild_id;
    if (clanGuildId) {
        try {
            await tryAutoJoinGuild(clanGuildId);
            // tryAutoJoinGuild already sets primary_guild on join.
            // If already a member, just set the tag directly.
            if (GuildStore.getGuild(clanGuildId)) {
                await RestAPI.patch({ url: "/users/@me", body: { primary_guild: clanGuildId } });
            }
        }
        catch (err) {
            logger.error("Failed to copy clan", err);
        }
    }
    // Game widgets
    let widgetsCopied = false;
    if (settings.store.copyGameCollection) {
        widgetsCopied = await copyGameWidgets(targetId, rawProfile);
    }
    if (dispatched === 0 && !widgetsCopied) {
        showToast("Nothing to copy from that profile.", Toasts.Type.MESSAGE);
        return;
    }
    const widgetSuffix = widgetsCopied ? " Game widgets applied." : "";
    if (dispatched > 0) {
        showToast(`Copied profile from ${targetUser.username}. Click Save to apply.${widgetSuffix}`, Toasts.Type.SUCCESS);
    }
    else {
        showToast(`Copied game widgets from ${targetUser.username}.`, Toasts.Type.SUCCESS);
    }
}
async function copyProfileFromInput(input) {
    const targetId = resolveTargetUserId(input);
    if (!targetId) {
        showToast(`No cached user matches "${input}". Try a user ID.`, Toasts.Type.FAILURE);
        return;
    }
    await copyProfileFromId(targetId);
}
// ─── Context menu patch ───────────────────────────────────────────────────────
const userContextMenuPatch = (children, { user, guildId }) => {
    if (!user || user.id === UserStore.getCurrentUser()?.id)
        return;
    // We need the raw profile to know if the user has a server profile.
    // We fetch it lazily when the submenu is opened to avoid spamming the API.
    let cachedRaw = undefined;
    async function getRaw() {
        if (cachedRaw !== undefined)
            return cachedRaw;
        cachedRaw = await fetchRawProfile(user.id, guildId ?? undefined);
        return cachedRaw;
    }
    const showSubmenu = !!guildId;
    if (!showSubmenu) {
        // No guild context — just show a single "Copy Profile" item
        children.push(<Menu.MenuSeparator />, <Menu.MenuItem id="copy-profile" label="Copy Profile" action={async () => {
                showToast(`Copying profile from ${user.username}...`, Toasts.Type.MESSAGE);
                try {
                    await copyProfileFromId(user.id);
                }
                catch (err) {
                    logger.error("Context menu copy failed", err);
                    showToast("Failed to copy profile.", Toasts.Type.FAILURE);
                }
            }}/>);
        return;
    }
    // Guild context — show submenu with Global and Server Profile options
    children.push(<Menu.MenuSeparator />, <Menu.MenuItem id="copy-profile" label="Copy Profile">
            <Menu.MenuItem id="copy-profile-global" label="Copy Global Profile" action={async () => {
            showToast(`Copying global profile from ${user.username}...`, Toasts.Type.MESSAGE);
            try {
                await copyProfileFromId(user.id);
            }
            catch (err) {
                logger.error("Context menu global copy failed", err);
                showToast("Failed to copy profile.", Toasts.Type.FAILURE);
            }
        }}/>
            <Menu.MenuItem id="copy-profile-server" label="Copy Server Profile" action={async () => {
            showToast(`Fetching server profile from ${user.username}...`, Toasts.Type.MESSAGE);
            try {
                const raw = await getRaw();
                if (!raw || !hasServerProfile(raw)) {
                    showToast(`${user.username} has no server profile here. Copying global profile instead.`, Toasts.Type.MESSAGE);
                    await copyProfileFromId(user.id, guildId);
                    return;
                }
                await copyServerProfile(user.id, raw, guildId);
            }
            catch (err) {
                logger.error("Context menu server copy failed", err);
                showToast("Failed to copy server profile.", Toasts.Type.FAILURE);
            }
        }}/>
        </Menu.MenuItem>);
};
// ─── Profile editor button ────────────────────────────────────────────────────
function PromptModal({ modalProps }) {
    const [value, setValue] = useState("");
    const [busy, setBusy] = useState(false);
    async function submit() {
        if (!value.trim() || busy)
            return;
        setBusy(true);
        try {
            await copyProfileFromInput(value);
            modalProps.onClose();
        }
        catch (err) {
            logger.error("Profile copy failed", err);
            showToast("Failed to copy profile.", Toasts.Type.FAILURE);
            setBusy(false);
        }
    }
    return (<ModalRoot {...modalProps} size={"small" /* ModalSize.SMALL */}>
            <ModalHeader>
                <Text variant="heading-lg/semibold" style={{ flexGrow: 1 }}>Copy profile from user</Text>
                <ModalCloseButton onClick={modalProps.onClose}/>
            </ModalHeader>
            <ModalContent>
                <Text variant="text-sm/normal" className={Margins.bottom8}>
                    Enter a user ID or a cached username. The profile editor fields are filled with their info, but you still need to click Save to apply.
                </Text>
                <TextInput placeholder="User ID or username" value={value} onChange={setValue} autoFocus/>
            </ModalContent>
            <ModalFooter>
                <Flex>
                    <Button color={Button.Colors.PRIMARY} onClick={modalProps.onClose}>Cancel</Button>
                    <Button onClick={submit} disabled={busy || !value.trim()}>
                        {busy ? "Copying..." : "Copy"}
                    </Button>
                </Flex>
            </ModalFooter>
        </ModalRoot>);
}
function CopySection() {
    return (<CustomizationSection title="Profile Copy" hasBackground={true} hideDivider={false}>
            <Flex>
                <Button onClick={() => openModal(props => <PromptModal modalProps={props}/>)} size={Button.Sizes.MEDIUM}>
                    Copy from User
                </Button>
            </Flex>
        </CustomizationSection>);
}
export default definePlugin({
    name: "ProfileCopyButton",
    description: "Adds a button to the profile editor and a right-click menu option to copy another user's profile (avatar, banner, bio, theme colors, name styles, profile effect, status, optional game widgets). Missing emojis in bios can be uploaded to a server of your choice.",
    tags: ["Utility", "Customisation"],
    authors: [TestcordDevs.x2b, TestcordDevs.nnenaza],
    settings,
    CopySection: ErrorBoundary.wrap(CopySection, { noop: true }),
    start() {
        addContextMenuPatch("user-context", userContextMenuPatch);
        addContextMenuPatch("user-profile-actions", userContextMenuPatch);
    },
    stop() {
        removeContextMenuPatch("user-context", userContextMenuPatch);
        removeContextMenuPatch("user-profile-actions", userContextMenuPatch);
    },
    patches: [
        {
            find: "DefaultCustomizationSections",
            replacement: {
                match: /(?<=#{intl::USER_SETTINGS_AVATAR_DECORATION}\)},"decoration"\),)/,
                replace: "$self.CopySection(),"
            }
        }
    ]
});
