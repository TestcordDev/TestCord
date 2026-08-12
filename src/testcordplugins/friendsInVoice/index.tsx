/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { findGroupChildrenByChildId } from "@api/ContextMenu";
import { DataStore } from "@api/index";
import { HeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { TestcordDevs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { isArabicMode, t } from "@utils/testcordI18n";
import { ModalContent, ModalHeader, ModalRoot, openModal } from "@utils/testcordModals";
import { ModalSize } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { Avatar, ChannelActions, ChannelStore, FluxDispatcher, GuildMemberStore, GuildStore, IconUtils, Menu, PermissionsBits, PermissionStore, React, RelationshipStore, ScrollerThin, Text, useStateFromStores, UserStore, VoiceStateStore } from "@webpack/common";

const cl = classNameFactory("vc-fiv-");
const STORE_KEY = "FriendsInVoice_watched";

const CHANNEL_TYPE_DM = 1;
const CHANNEL_TYPE_GROUP_DM = 3;

const settings = definePluginSettings({
    includeCalls: {
        type: OptionType.BOOLEAN,
        description: "Also list friends who are in a DM or group call, not just server voice channels.",
        default: true
    },
    showAllFriends: {
        type: OptionType.BOOLEAN,
        description: "Besides the people you watch, also list any other friend whose voice channel is already known to the client.",
        default: true
    }
});

/** Users the owner explicitly watches. Persisted, so it survives restarts. */
const watched = new Set<string>();
const watchListeners = new Set<() => void>();

function notifyWatchChanged() {
    for (const listener of watchListeners) listener();
}

async function persistWatched() {
    await DataStore.set(STORE_KEY, [...watched]);
}

/**
 * Discord streams a guild's voice states only once the client subscribes to that
 * guild — that is why a friend sitting in a server you never opened this session
 * is missing. Instead of subscribing to EVERY server (heavy), subscribe only to
 * the servers the watched people are actually in.
 *
 * Same request the client itself sends when you open a server.
 */
function subscribeToWatched() {
    const guildIds = new Set<string>();

    for (const userId of watched) {
        for (const guildId of GuildMemberStore.memberOf(userId) ?? []) {
            if (GuildStore.getGuild(guildId)) guildIds.add(guildId);
        }
    }

    if (!guildIds.size) return;

    const subscriptions: Record<string, { typing: boolean; }> = {};
    for (const guildId of guildIds) subscriptions[guildId] = { typing: true };

    FluxDispatcher.dispatch({ type: "GUILD_SUBSCRIPTIONS_FLUSH", subscriptions });
}

interface Entry {
    userId: string;
    name: string;
    avatarUrl: string;
    isWatched: boolean;
    channelId: string | null;
    channelName: string;
    placeName: string;
    /** No VIEW_CHANNEL: you only see it thanks to ShowHiddenChannels. */
    isHidden: boolean;
    /** Visible, but no CONNECT: you can see who is inside but cannot enter. */
    isLocked: boolean;
    canJoin: boolean;
}

function describe(userId: string, channelId: string | null): Entry | null {
    const user = UserStore.getUser(userId);
    if (!user) return null;

    const base = {
        userId,
        name: RelationshipStore.getNickname(userId) ?? user.globalName ?? user.username,
        avatarUrl: IconUtils.getUserAvatarURL(user, false, 32),
        isWatched: watched.has(userId)
    };

    const channel = channelId ? ChannelStore.getChannel(channelId) : null;
    if (!channel) {
        return { ...base, channelId: null, channelName: "", placeName: "", isHidden: false, isLocked: false, canJoin: false };
    }

    const isCall = channel.type === CHANNEL_TYPE_DM || channel.type === CHANNEL_TYPE_GROUP_DM;
    if (isCall && !settings.store.includeCalls) return null;

    // Report the channel even when it is out of reach: knowing the person sits in
    // a hidden or locked channel of that server is exactly the useful part. The
    // name is available either way, so show the real one and flag the state.
    const canView = isCall || PermissionStore.can(PermissionsBits.VIEW_CHANNEL, channel);
    const canConnect = isCall || PermissionStore.can(PermissionsBits.CONNECT, channel);

    return {
        ...base,
        channelId: channel.id,
        channelName: isCall ? t("مكالمة", "Call") : channel.name,
        placeName: isCall
            ? t("الرسائل الخاصة", "Direct messages")
            : GuildStore.getGuild(channel.guild_id)?.name ?? "",
        isHidden: !canView,
        isLocked: canView && !canConnect,
        canJoin: canView && canConnect
    };
}

/**
 * Voice state is INDEPENDENT of presence: a friend who appears offline still has
 * a voice state, so they show up here. Reads local stores only.
 */
function collectEntries(): Entry[] {
    const channelIds = new Map<string, string>();
    const friends: string[] = RelationshipStore.getFriendIDs() ?? [];
    const interesting = new Set<string>([...watched, ...(settings.store.showAllFriends ? friends : [])]);

    if (settings.store.showAllFriends) {
        const allStates = VoiceStateStore.getAllVoiceStates();
        for (const guildStates of Object.values(allStates ?? {})) {
            for (const userId in guildStates) {
                const channelId = guildStates[userId]?.channelId;
                if (interesting.has(userId) && channelId) channelIds.set(userId, channelId);
            }
        }
    }

    for (const userId of interesting) {
        if (channelIds.has(userId)) continue;
        const channelId = VoiceStateStore.getVoiceStateForUser(userId)?.channelId;
        if (channelId) channelIds.set(userId, channelId);
    }

    const entries: Entry[] = [];
    for (const userId of interesting) {
        // A watched person is always listed, so you can see they are in no channel.
        const channelId = channelIds.get(userId) ?? null;
        if (!channelId && !watched.has(userId)) continue;

        const entry = describe(userId, channelId);
        if (entry) entries.push(entry);
    }

    return entries.sort((a, b) =>
        Number(!!b.channelId) - Number(!!a.channelId)
        || Number(b.isWatched) - Number(a.isWatched)
        || a.name.localeCompare(b.name));
}

/** Cheap identity of the list, so the UI only re-renders on a real change. */
function keyOf(entries: Entry[]): string {
    return entries.map(e => `${e.userId}:${e.channelId ?? "-"}`).join(",");
}

function useEntries(): Entry[] {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);
    React.useEffect(() => {
        watchListeners.add(forceUpdate);
        return () => void watchListeners.delete(forceUpdate);
    }, []);

    return useStateFromStores(
        [VoiceStateStore, RelationshipStore, ChannelStore, GuildStore],
        collectEntries,
        undefined,
        (a: Entry[], b: Entry[]) => keyOf(a) === keyOf(b)
    );
}

function FriendRow({ entry }: { entry: Entry; }) {
    return (
        <div className={cl("row")}>
            <Avatar src={entry.avatarUrl} size="SIZE_32" />
            <div className={cl("info")}>
                <Text variant="text-sm/semibold" className={cl("name")}>
                    {entry.isWatched ? `★ ${entry.name}` : entry.name}
                </Text>
                <Text variant="text-xs/normal" className={cl("where")}>
                    {entry.channelId
                        ? (entry.placeName ? `${entry.placeName} — ${entry.channelName}` : entry.channelName)
                        : t("ليس في روم صوتي", "Not in a voice channel")}
                    {entry.isHidden && <span className={cl("state")}>🔒 {t("مخفي", "Hidden")}</span>}
                    {entry.isLocked && <span className={cl("state")}>🔒 {t("مقفل", "Locked")}</span>}
                </Text>
            </div>
            {entry.channelId && (
                <button
                    className={cl("join")}
                    disabled={!entry.canJoin}
                    onClick={() => ChannelActions.selectVoiceChannel(entry.channelId!)}
                >
                    {entry.canJoin ? t("انضمام", "Join") : t("لا صلاحية", "No access")}
                </button>
            )}
        </div>
    );
}

function FriendsInVoicePanel({ transitionState }: { transitionState: any; }) {
    const entries = useEntries();

    return (
        <ModalRoot transitionState={transitionState} size={ModalSize.SMALL}>
            <ModalHeader>
                <Text variant="heading-lg/semibold">{t("الأصدقاء في الصوت", "Friends in voice")}</Text>
            </ModalHeader>
            <ModalContent>
                <div className={cl("panel")} dir={isArabicMode() ? "rtl" : "ltr"}>
                    {entries.length === 0 ? (
                        <div className={cl("empty")}>
                            {t(
                                "لا أحد الآن. كليك يمين على شخص ← «مراقبة في الصوت» ليظهر هنا دائماً.",
                                "Nobody right now. Right-click someone → \"Watch in voice\" to always track them here."
                            )}
                        </div>
                    ) : (
                        <ScrollerThin className={cl("list")} fade>
                            {entries.map(entry => <FriendRow key={entry.userId} entry={entry} />)}
                        </ScrollerThin>
                    )}
                </div>
            </ModalContent>
        </ModalRoot>
    );
}

function PeopleIcon({ className }: { className?: string; }) {
    return (
        <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
                fill="currentColor"
                d="M9 4a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm7.5 1a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM9 12.5c-3.31 0-6 1.79-6 4 0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2 0-2.21-2.69-4-6-4Zm7.5.5c-.62 0-1.2.07-1.74.2A5.7 5.7 0 0 1 16.5 17c0 .55-.15 1.06-.4 1.5H20c1.1 0 2-.9 2-2 0-1.93-2.24-3.5-5.5-3.5Z"
            />
        </svg>
    );
}

function FriendsInVoiceButton() {
    const entries = useEntries();
    const inVoice = entries.filter(e => e.channelId).length;

    return (
        <HeaderBarButton
            icon={PeopleIcon}
            tooltip={inVoice > 0
                ? t(`الأصدقاء في الصوت (${inVoice})`, `Friends in voice (${inVoice})`)
                : t("الأصدقاء في الصوت", "Friends in voice")}
            selected={inVoice > 0}
            aria-label={t("الأصدقاء في الصوت", "Friends in voice")}
            onClick={() => {
                // Ask for the watched people's servers now: the gateway is
                // certainly connected at this point, unlike during start().
                subscribeToWatched();
                openModal(props => <FriendsInVoicePanel {...props} />);
            }}
        />
    );
}

function toggleWatch(userId: string) {
    if (watched.has(userId)) watched.delete(userId);
    else watched.add(userId);

    void persistWatched();
    subscribeToWatched();
    notifyWatchChanged();
}

const userContextPatch = (children: any[], props: any) => {
    const userId: string | undefined = props?.user?.id;
    if (!userId || userId === UserStore.getCurrentUser()?.id) return;

    const group = findGroupChildrenByChildId("user-profile", children)
        ?? findGroupChildrenByChildId("mark-as-read", children)
        ?? children;

    group.push(
        <Menu.MenuCheckboxItem
            id="vc-fiv-watch"
            key="vc-fiv-watch"
            label={t("مراقبة في الصوت", "Watch in voice")}
            checked={watched.has(userId)}
            action={() => toggleWatch(userId)}
        />
    );
};

const WrappedButton = ErrorBoundary.wrap(FriendsInVoiceButton, { noop: true });

export default definePlugin({
    name: "FriendsInVoice",
    description: "Adds a top bar button listing which voice channel your friends are in, with one click to join them. Right-click anyone to watch them, so they are tracked even in servers you have not opened. Works while they appear offline, because voice state is not tied to status.",
    authors: [TestcordDevs.LOSTSTR],
    tags: ["Voice", "Friends", "Utility"],
    enabledByDefault: false,
    dependencies: ["HeaderBarAPI", "ContextMenuAPI"],
    settings,
    headerBarButton: {
        icon: PeopleIcon,
        render: () => <WrappedButton />
    },
    contextMenus: {
        "user-context": userContextPatch,
        "gdm-context": userContextPatch
    },
    async start() {
        const saved = await DataStore.get(STORE_KEY);
        if (Array.isArray(saved)) {
            for (const id of saved) if (typeof id === "string") watched.add(id);
        }
        notifyWatchChanged();
        subscribeToWatched();
    },
    stop() {
        watched.clear();
        watchListeners.clear();
    }
});
