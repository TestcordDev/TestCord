/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, GuildMemberStore, GuildStore, IconUtils, NavigationRouter, ReadStateStore, SelectedChannelStore, SelectedGuildStore, UserStore } from "@webpack/common";

interface ChannelSelectEvent {
    channelId: string | null;
    guildId: string | null;
}

interface RecentLocation {
    channelId: string;
    guildId: string;
}

interface MessageCreateEvent {
    message?: {
        author?: { id?: string; };
        channel_id?: string;
        guild_id?: string | null;
        mentioned?: boolean;
        mention_everyone?: boolean;
        mention_roles?: string[];
        mentions?: Array<{ id?: string; }>;
    };
}

const MAX_RECENTS = 25;
const STARRED_DATA_KEY = "RecentChannelSwitcher_starredLocations";
const RECENTS_DATA_KEY = "RecentChannelSwitcher_recentLocations";

const settings = definePluginSettings({
    maxRecentChannels: {
        type: OptionType.NUMBER,
        description: "Maximum recent channels to keep in the switcher",
        default: MAX_RECENTS,
        minimum: 2,
        maximum: 100
    },
    starredFirst: {
        type: OptionType.BOOLEAN,
        description: "Show starred channels above recent channels",
        default: true
    },
    persistRecents: {
        type: OptionType.BOOLEAN,
        description: "Remember recent channels after restarting Discord",
        default: true
    },
    animations: {
        type: OptionType.BOOLEAN,
        description: "Enable switcher hover and close animations",
        default: true
    },
    showUnreadBadges: {
        type: OptionType.BOOLEAN,
        description: "Show unread mention counts in the switcher",
        default: true
    },
    addMentionedChannels: {
        type: OptionType.BOOLEAN,
        description: "Add channels to the switcher when you are mentioned there",
        default: true
    }
});

let recents: RecentLocation[] = [];
let starredLocations: RecentLocation[] = [];
let overlay: HTMLDivElement | null = null;
let switcherCandidates: RecentLocation[] = [];
let selectedIndex = 0;
let cancelSwitch = false;

function normalizeGuildId(guildId: string | null | undefined) {
    return guildId ?? "@me";
}

function rememberLocation(guildId: string | null | undefined, channelId: string | null | undefined) {
    if (!channelId) return;

    const next = {
        guildId: normalizeGuildId(guildId),
        channelId
    };

    recents = [
        next,
        ...recents.filter(location => location.channelId !== channelId)
    ].slice(0, settings.store.maxRecentChannels);

    saveRecents();
}

function isSameLocation(a: RecentLocation, b: RecentLocation) {
    return a.channelId === b.channelId;
}

function isStarred(location: RecentLocation) {
    return starredLocations.some(starred => isSameLocation(starred, location));
}

function saveStarredLocations() {
    void DataStore.set(STARRED_DATA_KEY, starredLocations);
}

function saveRecents() {
    if (!settings.store.persistRecents) return;
    void DataStore.set(RECENTS_DATA_KEY, recents);
}

function toggleStarred(location: RecentLocation) {
    if (isStarred(location)) {
        starredLocations = starredLocations.filter(starred => !isSameLocation(starred, location));
    } else {
        starredLocations = [location, ...starredLocations.filter(starred => !isSameLocation(starred, location))];
    }

    saveStarredLocations();
}

function navigateTo(location: RecentLocation) {
    if (location.guildId === "@me") {
        NavigationRouter.transitionTo(`/channels/@me/${location.channelId}`);
        return;
    }

    NavigationRouter.transitionToGuild(location.guildId, location.channelId);
}

function removeLocation(location: RecentLocation) {
    recents = recents.filter(recent => recent.channelId !== location.channelId);
    saveRecents();
    starredLocations = starredLocations.filter(starred => !isSameLocation(starred, location));
    saveStarredLocations();
    switcherCandidates = switcherCandidates.filter(candidate => candidate.channelId !== location.channelId);
    selectedIndex = Math.min(selectedIndex, Math.max(0, switcherCandidates.length - 1));
}

function getValidLocations() {
    const locations = settings.store.starredFirst
        ? [...starredLocations, ...recents]
        : [...recents, ...starredLocations];
    const seen = new Set<string>();

    return locations.filter(location => {
        if (seen.has(location.channelId)) return false;
        seen.add(location.channelId);
        return ChannelStore.hasChannel?.(location.channelId) ?? true;
    });
}

function getChannelName(location: RecentLocation) {
    const channel = ChannelStore.getChannel(location.channelId) as any;

    if (!channel) return "Unknown Channel";
    if (channel.name) return channel.isDM?.() || channel.isGroupDM?.() || channel.isMultiUserDM?.() ? channel.name : `#${channel.name}`;

    const recipientIds = channel.recipients ?? channel.rawRecipients?.map((recipient: any) => recipient.id) ?? [];
    const recipientNames = recipientIds
        .map((id: string) => UserStore.getUser(id)?.globalName ?? UserStore.getUser(id)?.username)
        .filter(Boolean);

    if (recipientNames.length) return recipientNames.join(", ");

    const rawRecipientNames = channel.rawRecipients?.map((recipient: any) => recipient.globalName ?? recipient.username).filter(Boolean);
    if (rawRecipientNames?.length) return rawRecipientNames.join(", ");

    return "Direct Message";
}

function getGuildName(location: RecentLocation) {
    if (location.guildId === "@me") return "Direct Messages";
    return GuildStore.getGuild(location.guildId)?.name ?? "Unknown Server";
}

function getInitial(location: RecentLocation) {
    const name = getChannelName(location).replace(/^#/, "").trim();
    return name.charAt(0).toUpperCase() || "#";
}

function getIconUrl(location: RecentLocation) {
    const channel = ChannelStore.getChannel(location.channelId) as any;

    if (location.guildId !== "@me") {
        const guild = GuildStore.getGuild(location.guildId);
        if (!guild?.icon) return null;
        return IconUtils.getGuildIconURL({ id: guild.id, icon: guild.icon, size: 64 });
    }

    if (channel?.isGroupDM?.() || channel?.isMultiUserDM?.()) {
        if (!channel.icon) return null;
        return `https://cdn.discordapp.com/channel-icons/${channel.id}/${channel.icon}.webp?size=64`;
    }

    const recipientId = channel?.getRecipientId?.() ?? channel?.recipients?.[0] ?? channel?.rawRecipients?.[0]?.id;
    const user = recipientId ? UserStore.getUser(recipientId) : null;

    return user ? IconUtils.getUserAvatarURL(user, true, 64) : null;
}

function getMentionCount(location: RecentLocation) {
    if (!settings.store.showUnreadBadges) return 0;
    return ReadStateStore.getMentionCount?.(location.channelId) ?? 0;
}

function messageMentionsCurrentUser(message: NonNullable<MessageCreateEvent["message"]>) {
    const currentUserId = UserStore.getCurrentUser()?.id;
    if (!currentUserId || message.author?.id === currentUserId) return false;

    if (message.mentioned) return true;
    if (message.mentions?.some(user => user.id === currentUserId)) return true;
    if (message.mention_everyone) return true;

    const guildId = message.guild_id;
    if (!guildId || !message.mention_roles?.length) return false;

    const roles = GuildMemberStore.getMember(guildId, currentUserId)?.roles ?? [];
    return message.mention_roles.some(roleId => roles.includes(roleId));
}

function rememberMentionedChannel({ message }: MessageCreateEvent) {
    if (!settings.store.addMentionedChannels || !message?.channel_id) return;
    if (!messageMentionsCurrentUser(message)) return;

    const channel = ChannelStore.getChannel(message.channel_id) as any;
    rememberLocation(message.guild_id ?? channel?.guild_id ?? null, message.channel_id);
}

function createTextElement<K extends keyof HTMLElementTagNameMap>(tagName: K, text: string) {
    const element = document.createElement(tagName);
    element.textContent = text;
    return element;
}

function styleCard(card: HTMLDivElement, selected: boolean) {
    card.style.borderColor = selected ? "var(--brand-500,#5865f2)" : "transparent";
    card.style.background = selected ? "var(--background-modifier-selected,rgba(88,101,242,.2))" : "var(--background-secondary-alt,#232428)";
}

function createIcon(location: RecentLocation, size: number) {
    const iconUrl = getIconUrl(location);
    const icon = iconUrl ? document.createElement("img") : createTextElement("div", getInitial(location));

    icon.style.cssText = `width:${size}px;height:${size}px;border-radius:${location.guildId === "@me" ? "50%" : "12px"};display:flex;align-items:center;justify-content:center;flex:0 0 auto;background:var(--background-modifier-accent,rgba(255,255,255,.1));color:var(--text-normal,#dbdee1);font-weight:700;object-fit:cover;`;
    if (iconUrl && icon instanceof HTMLImageElement) {
        icon.src = iconUrl;
        icon.alt = "";
    }

    return icon;
}

function animateRemoveLocation(card: HTMLDivElement, location: RecentLocation) {
    if (!settings.store.animations) {
        removeLocation(location);
        if (!switcherCandidates.length) removeOverlay();
        else renderOverlay();
        return;
    }

    card.style.pointerEvents = "none";
    card.style.transition = "opacity .14s ease,transform .14s ease";
    card.style.opacity = "0";
    card.style.transform = "translateX(14px) scale(.96)";

    setTimeout(() => {
        removeLocation(location);
        if (!switcherCandidates.length) removeOverlay();
        else renderOverlay();
    }, 140);
}

function ensureOverlay() {
    overlay ??= document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.35);pointer-events:auto;";
    overlay.onmousedown = event => {
        if (event.target === overlay) cancelSwitcher();
    };

    if (!overlay.isConnected) document.body.appendChild(overlay);
}

function renderOverlay() {
    ensureOverlay();
    if (!overlay) return;

    overlay.replaceChildren();

    const shell = document.createElement("div");
    shell.style.cssText = "width:min(720px,calc(100vw - 48px));max-height:min(500px,calc(100vh - 48px));padding:16px;border-radius:12px;background:var(--background-floating,#111214);box-shadow:var(--elevation-high,0 8px 24px rgba(0,0,0,.35));border:1px solid var(--background-modifier-accent,rgba(255,255,255,.08));font-family:var(--font-primary,Arial,sans-serif);color:var(--text-normal,#dbdee1);";
    shell.onmousedown = event => event.stopPropagation();
    shell.onwheel = event => {
        event.preventDefault();
        cycleSwitcher(event.deltaY >= 0 ? 1 : -1);
    };

    const title = createTextElement("div", "Switch Channel");
    title.style.cssText = "font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted,#949ba4);margin:0 0 12px 2px;";
    shell.appendChild(title);

    const selected = switcherCandidates[selectedIndex];
    if (selected) {
        const preview = document.createElement("div");
        preview.style.cssText = "display:flex;align-items:center;gap:14px;padding:14px;margin-bottom:12px;border-radius:8px;background:var(--background-secondary,#2b2d31);border:1px solid var(--brand-500,#5865f2);cursor:pointer;transition:background-color .12s ease,border-color .12s ease;";
        preview.onmouseenter = () => {
            preview.style.background = "var(--background-modifier-hover,rgba(255,255,255,.08))";
        };
        preview.onmouseleave = () => {
            preview.style.background = "var(--background-secondary,#2b2d31)";
        };
        preview.onmousedown = event => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            removeOverlay();
            navigateTo(selected);
        };

        preview.appendChild(createIcon(selected, 48));

        const text = document.createElement("div");
        text.style.cssText = "min-width:0;";

        const name = createTextElement("div", getChannelName(selected));
        name.style.cssText = "font-size:20px;font-weight:700;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
        text.appendChild(name);

        const guild = createTextElement("div", getGuildName(selected));
        guild.style.cssText = "font-size:14px;color:var(--text-muted,#949ba4);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
        text.appendChild(guild);

        preview.appendChild(text);
        shell.appendChild(preview);
    }

    const list = document.createElement("div");
    list.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;overflow:auto;max-height:300px;padding:1px;";
    const cards: HTMLDivElement[] = [];
    let lastSection = "";

    for (let i = 0; i < switcherCandidates.length; i++) {
        const location = switcherCandidates[i];
        const section = isStarred(location) ? "Starred" : "Recent";
        if (section !== lastSection) {
            const sectionLabel = createTextElement("div", section);
            sectionLabel.style.cssText = "grid-column:1/-1;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted,#949ba4);margin:6px 2px 0;";
            list.appendChild(sectionLabel);
            lastSection = section;
        }

        const card = document.createElement("div");
        card.style.cssText = "display:flex;align-items:center;gap:10px;min-width:0;padding:8px;border-radius:8px;border:1px solid transparent;background:var(--background-secondary-alt,#232428);cursor:pointer;transition:background-color .12s ease,border-color .12s ease,transform .08s ease;";
        styleCard(card, i === selectedIndex);
        card.onmouseenter = () => {
            selectedIndex = i;
            for (let j = 0; j < cards.length; j++) styleCard(cards[j], j === selectedIndex);
            if (settings.store.animations) card.style.transform = "translateY(-1px)";
        };
        card.onmouseleave = () => {
            card.style.transform = "translateY(0)";
        };
        card.onmousedown = event => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            removeOverlay();
            navigateTo(location);
        };

        card.appendChild(createIcon(location, 32));

        const label = document.createElement("div");
        label.style.cssText = "min-width:0;flex:1;";

        const channelName = createTextElement("div", getChannelName(location));
        channelName.style.cssText = "font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
        label.appendChild(channelName);

        const guildName = createTextElement("div", getGuildName(location));
        guildName.style.cssText = "font-size:12px;color:var(--text-muted,#949ba4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px;";
        label.appendChild(guildName);

        card.appendChild(label);

        const mentionCount = getMentionCount(location);
        if (mentionCount > 0) {
            const unreadBadge = createTextElement("div", mentionCount > 99 ? "99+" : String(mentionCount));
            unreadBadge.style.cssText = "min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--status-danger,#f23f42);color:white;font-size:11px;font-weight:700;line-height:18px;text-align:center;flex:0 0 auto;";
            card.appendChild(unreadBadge);
        }

        const star = document.createElement("button");
        star.type = "button";
        star.textContent = "*";
        star.title = isStarred(location) ? "Unstar channel" : "Star channel";
        star.style.cssText = `width:22px;height:22px;border:0;border-radius:4px;background:transparent;color:${isStarred(location) ? "var(--text-warning,#f0b232)" : "var(--interactive-muted,#80848e)"};font:700 15px var(--font-primary,Arial,sans-serif);cursor:pointer;flex:0 0 auto;`;
        star.onmouseenter = () => {
            star.style.background = "var(--background-modifier-hover,rgba(255,255,255,.08))";
            star.style.color = isStarred(location) ? "var(--text-warning,#f0b232)" : "var(--interactive-hover,#dbdee1)";
        };
        star.onmouseleave = () => {
            star.style.background = "transparent";
            star.style.color = isStarred(location) ? "var(--text-warning,#f0b232)" : "var(--interactive-muted,#80848e)";
        };
        star.onmousedown = event => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            toggleStarred(location);
            switcherCandidates = getValidLocations();
            selectedIndex = switcherCandidates.findIndex(candidate => isSameLocation(candidate, location));
            renderOverlay();
        };
        card.appendChild(star);

        const close = document.createElement("button");
        close.type = "button";
        close.textContent = "x";
        close.disabled = isStarred(location);
        close.title = isStarred(location) ? "Unstar this channel before removing it" : "Remove from switcher";
        close.style.cssText = `width:22px;height:22px;border:0;border-radius:4px;background:transparent;color:${isStarred(location) ? "var(--interactive-muted,#80848e)" : "var(--interactive-muted,#80848e)"};opacity:${isStarred(location) ? ".35" : "1"};font:700 13px var(--font-primary,Arial,sans-serif);cursor:${isStarred(location) ? "not-allowed" : "pointer"};flex:0 0 auto;`;
        close.onmouseenter = () => {
            if (isStarred(location)) return;
            close.style.background = "var(--background-modifier-hover,rgba(255,255,255,.08))";
            close.style.color = "var(--interactive-hover,#dbdee1)";
        };
        close.onmouseleave = () => {
            close.style.background = "transparent";
            close.style.color = "var(--interactive-muted,#80848e)";
        };
        close.onmousedown = event => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            if (isStarred(location)) return;
            animateRemoveLocation(card, location);
        };
        card.appendChild(close);
        cards.push(card);
        list.appendChild(card);
    }

    shell.appendChild(list);

    if (!switcherCandidates.some(candidate => candidate.channelId !== SelectedChannelStore.getChannelId())) {
        const empty = createTextElement("div", "No other channels yet. Star channels or visit more channels to fill this menu.");
        empty.style.cssText = "padding:16px;border-radius:8px;background:var(--background-secondary-alt,#232428);color:var(--text-muted,#949ba4);font-size:13px;text-align:center;";
        list.appendChild(empty);
    }

    const hint = createTextElement("div", "Hold Ctrl and press Tab to cycle. Release Ctrl to switch. Esc cancels.");
    hint.style.cssText = "font-size:12px;color:var(--text-muted,#949ba4);margin:12px 4px 0;";
    shell.appendChild(hint);

    overlay.appendChild(shell);
}

function removeOverlay() {
    overlay?.remove();
    overlay = null;
    switcherCandidates = [];
    selectedIndex = 0;
    cancelSwitch = false;
}

function cycleSwitcher(direction: 1 | -1) {
    const candidates = getValidLocations();
    if (!candidates.length) return;

    if (!overlay) {
        switcherCandidates = candidates;
        const currentChannelId = SelectedChannelStore.getChannelId();
        selectedIndex = direction === 1
            ? candidates.findIndex(candidate => candidate.channelId !== currentChannelId)
            : candidates.findLastIndex(candidate => candidate.channelId !== currentChannelId);
        if (selectedIndex === -1) selectedIndex = 0;
    } else {
        selectedIndex = (selectedIndex + direction + switcherCandidates.length) % switcherCandidates.length;
    }

    renderOverlay();
}

function finishSwitcher() {
    if (!overlay) return;

    const selected = switcherCandidates[selectedIndex];
    const shouldNavigate = !cancelSwitch && selected && selected.channelId !== SelectedChannelStore.getChannelId();

    removeOverlay();
    if (shouldNavigate) navigateTo(selected);
}

function cancelSwitcher() {
    if (!overlay) return;

    cancelSwitch = true;
    removeOverlay();
}

function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
        cancelSwitcher();
        return;
    }

    if (overlay && event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        finishSwitcher();
        return;
    }

    if (!event.ctrlKey || event.altKey || event.metaKey || event.key !== "Tab") return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    cycleSwitcher(event.shiftKey ? -1 : 1);
}

function onKeyUp(event: KeyboardEvent) {
    if (event.key !== "Control") return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    finishSwitcher();
}

export default definePlugin({
    name: "RecentChannelSwitcher",
    description: "Use Ctrl+Tab to preview and switch between recently opened channels and DMs.",
    tags: ["Shortcuts", "Chat", "Utility"],
    authors: [TestcordDevs.sirphantom89],
    settings,

    async start() {
        starredLocations = await DataStore.get<RecentLocation[]>(STARRED_DATA_KEY) ?? [];
        recents = settings.store.persistRecents ? await DataStore.get<RecentLocation[]>(RECENTS_DATA_KEY) ?? [] : [];
        rememberLocation(SelectedGuildStore.getGuildId(), SelectedChannelStore.getChannelId());
        window.addEventListener("keydown", onKeyDown, true);
        window.addEventListener("keyup", onKeyUp, true);
    },

    stop() {
        window.removeEventListener("keydown", onKeyDown, true);
        window.removeEventListener("keyup", onKeyUp, true);
        removeOverlay();
        recents = [];
        starredLocations = [];
    },

    flux: {
        CHANNEL_SELECT({ guildId, channelId }: ChannelSelectEvent) {
            rememberLocation(guildId, channelId);
        },

        MESSAGE_CREATE(event: MessageCreateEvent) {
            rememberMentionedChannel(event);
        }
    }
});
