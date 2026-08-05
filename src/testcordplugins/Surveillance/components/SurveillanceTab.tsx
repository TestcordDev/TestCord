/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { plugins } from "@api/PluginManager";
import ErrorBoundary from "@components/ErrorBoundary";
import { HeadingPrimary, HeadingTertiary } from "@components/Heading";
import { CogWheel, HeadphonesIcon, Microphone, ScreenshareIcon, VideoIcon } from "@components/Icons";
import { openPluginModal, SettingsTab, wrapTab } from "@components/settings";
import { copyToClipboard } from "@utils/clipboard";
import { classNameFactory } from "@utils/css";
import { openUserProfile } from "@utils/discord";
import { classes } from "@utils/misc";
import { ModalCloseButton, ModalContent, ModalHeader, type ModalProps, ModalRoot, ModalSize, openModal } from "@utils/modal";
import { formatDurationMs } from "@utils/text";
import { ChannelStore, GuildStore, IconUtils, NavigationRouter, React, Select, TextInput, Toasts, Tooltip, useEffect, useMemo, UserStore, useState, useStateFromStores } from "@webpack/common";

import { addServerTarget, getServerTargets, getTargets, removeServerTarget, removeTarget, setTargets, settings, subscribeServerTargets, subscribeTargets } from "..";
import { analyzeSurveillanceEvents, OsintAnalysisResult } from "../osintAnalysis";
import { clearEvents, getEvents, loadEvents, subscribe } from "../store";
import type { IdentityHistoryEntry, SurveillanceEvent, SurveillanceEventType } from "../types";

type EventFilter = "all" | "activity" | "message" | "presence" | "profile" | "reaction" | "server" | "typing" | "voice";

interface GuildOption {
    label: string;
    value: string;
}

interface UserOption {
    label: string;
    value: string;
}

interface UserStats {
    userId: string;
    username: string;
    avatarUrl?: string;
    firstSeen?: number;
    lastSeen?: number;
    messageCount: number;
    editCount: number;
    deleteCount: number;
    attachmentCount: number;
    reactionAdds: number;
    reactionRemoves: number;
    typingCount: number;
    voiceJoins: number;
    voiceLeaves: number;
    voiceMoves: number;
    voiceUpdates: number;
    totalVoiceMs: number;
    streamMs: number;
    cameraMs: number;
    muteMs: number;
    deafMs: number;
    statusTransitions: number;
    lastStatus?: string;
    onlineMs: number;
    idleMs: number;
    dndMs: number;
    offlineMs: number;
    activityStarts: number;
    activityStops: number;
    activityUpdates: number;
    activityMs: number;
    memberAdds: number;
    memberRemoves: number;
    memberUpdates: number;
    profileUpdates: number;
    identityHistory: IdentityHistoryEntry[];
    topChannel?: string;
    topGuild?: string;
}

const EVENT_PAGE_SIZE = 250;
const SECTION_NAV = ["timeline", "targets", "stats"] as const;
const cl = classNameFactory("vc-surveillance-");

const filterOptions: Array<{ label: string; value: EventFilter; }> = [
    { label: "All", value: "all" },
    { label: "Messages", value: "message" },
    { label: "Profile", value: "profile" },
    { label: "Server", value: "server" },
    { label: "Reactions", value: "reaction" },
    { label: "Presence", value: "presence" },
    { label: "Voice", value: "voice" },
    { label: "Activities", value: "activity" },
    { label: "Typing", value: "typing" },
];

const typeLabels: Record<SurveillanceEventType, string> = {
    activity_start: "Activity",
    activity_stop: "Activity",
    activity_update: "Activity",
    channel_create: "Channel",
    channel_delete: "Channel",
    channel_update: "Channel",
    guild_member_add: "Member",
    guild_member_remove: "Member",
    guild_member_update: "Member",
    guild_update: "Server",
    message: "Message",
    message_delete: "Deleted",
    message_edit: "Edited",
    profile_update: "Profile",
    reaction_add: "Reaction",
    reaction_remove: "Reaction",
    reaction_remove_all: "Reaction",
    role_create: "Role",
    role_delete: "Role",
    role_update: "Role",
    status: "Status",
    thread_create: "Thread",
    thread_delete: "Thread",
    thread_update: "Thread",
    typing: "Typing",
    voice_join: "Voice",
    voice_leave: "Voice",
    voice_move: "Voice",
    voice_update: "Voice",
};

const eventMatchesFilter = (event: SurveillanceEvent, filter: EventFilter) => {
    if (filter === "all") return true;
    if (filter === "presence") return event.type === "status";
    if (filter === "profile") return event.type === "profile_update";
    if (filter === "server") return event.scope === "server" || ["channel_", "thread_", "guild_", "role_"].some(prefix => event.type.startsWith(prefix));
    return event.type.startsWith(filter);
};

const eventMatchesQuery = (event: SurveillanceEvent, query: string) => {
    if (!query) return true;

    const value = query.toLowerCase();
    return [
        event.username,
        event.userId,
        event.details,
        event.channelName,
        event.guildName,
        event.content,
        event.before,
        event.after,
        ...(event.links ?? []),
        ...(event.attachments?.map(attachment => attachment.filename) ?? []),
        ...(event.identityHistory?.flatMap(entry => [entry.field, entry.value, entry.guildName]) ?? []),
    ].some(part => part?.toLowerCase().includes(value));
};

const formatTime = (timestamp: number) =>
    new Date(timestamp).toLocaleString();

const formatLabel = (label: string) =>
    label.replace(/[A-Z]/g, match => ` ${match}`).replace(/^./, match => match.toUpperCase());

const getEventAvatarUrl = (event: SurveillanceEvent) => {
    const user = UserStore.getUser(event.userId);
    return user ? IconUtils.getUserAvatarURL(user, true, 64) : event.avatarUrl;
};

const getStringMetadata = (event: SurveillanceEvent, key: string) => {
    const value = event.metadata?.[key];
    return typeof value === "string" ? value : undefined;
};

const getNumberMetadata = (event: SurveillanceEvent, key: string) => {
    const value = event.metadata?.[key];
    return typeof value === "number" ? value : undefined;
};

const getBooleanMetadata = (event: SurveillanceEvent, key: string) =>
    event.metadata?.[key] === true;

const formatCount = (value: number) =>
    value.toLocaleString();

const formatDuration = (value: number) =>
    value > 0 ? formatDurationMs(value, true) : "0s";

const formatBytes = (size: number) => {
    if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
    if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${size} B`;
};

const IMAGE_URL_REGEX = /\.(?:avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i;

const isImageUrl = (url: string) =>
    IMAGE_URL_REGEX.test(url);

const isImageAttachment = (contentType: string | undefined) =>
    contentType?.startsWith("image/") === true;

const scrollToSection = (section: typeof SECTION_NAV[number]) => {
    document.getElementById(`vc-surveillance-${section}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
};

const toast = (message: string, type: string = Toasts.Type.SUCCESS) =>
    Toasts.show({
        type,
        message,
        id: Toasts.genId(),
    });

function DetailField({ label, value, wide, preserve }: { label: string; value?: string | number | boolean | null; wide?: boolean; preserve?: boolean; }) {
    if (value == null || value === "") return null;

    const text = String(value);

    return (
        <div className={classes(cl("modal-field"), wide && cl("modal-wide"))}>
            <strong>{label}</strong>
            {preserve ? <pre>{text}</pre> : <span>{text}</span>}
        </div>
    );
}

function MessageMedia({ event }: { event: SurveillanceEvent; }) {
    if (!event.attachments?.length && !event.links?.length) return null;

    return (
        <div className={cl("message-media")}>
            {event.attachments?.length ? (
                <section>
                    <HeadingTertiary>Attachments</HeadingTertiary>
                    <div className={cl("attachment-grid")}>
                        {event.attachments.map(attachment => (
                            <a key={attachment.id} className={cl("attachment")} href={attachment.url} target="_blank" rel="noreferrer">
                                {isImageAttachment(attachment.contentType) || isImageUrl(attachment.url) ? (
                                    <img src={attachment.proxyUrl ?? attachment.url} alt={attachment.filename} />
                                ) : null}
                                <span>{attachment.spoiler ? `SPOILER_${attachment.filename}` : attachment.filename}</span>
                                <small>{[attachment.contentType, formatBytes(attachment.size)].filter(Boolean).join(" · ")}</small>
                            </a>
                        ))}
                    </div>
                </section>
            ) : null}

            {event.links?.length ? (
                <section>
                    <HeadingTertiary>Links</HeadingTertiary>
                    <div className={cl("link-list")}>
                        {event.links.map(link => (
                            <a key={link} className={cl("link-preview", { image: isImageUrl(link) })} href={link} target="_blank" rel="noreferrer">
                                {isImageUrl(link) ? <img src={link} alt="" /> : null}
                                <span>{link}</span>
                            </a>
                        ))}
                    </div>
                </section>
            ) : null}
        </div>
    );
}

function IdentityHistory({ history }: { history: IdentityHistoryEntry[] | undefined; }) {
    if (!history?.length) return null;

    return (
        <section className={cl("identity-history")}>
            <HeadingTertiary>Identity History</HeadingTertiary>
            <div className={cl("identity-list")}>
                {history.slice().reverse().map(entry => (
                    <div key={`${entry.timestamp}-${entry.field}-${entry.guildId ?? ""}-${entry.value ?? ""}`} className={cl("identity-entry")}>
                        <strong>{entry.field}</strong>
                        <span>{entry.value ?? "unset"}</span>
                        <small>{formatTime(entry.timestamp)}{entry.guildName ? ` · ${entry.guildName}` : ""}</small>
                    </div>
                ))}
            </div>
        </section>
    );
}

function VoiceStateIcon({ enabled, label, tone, children }: { enabled: boolean; label: string; tone: "danger" | "positive" | "stream"; children: React.ReactNode; }) {
    if (!enabled) return null;

    return (
        <span className={classes(cl("voice-state"), cl(`voice-state-${tone}`))} title={label}>
            {children}
        </span>
    );
}

function VoiceParticipants({ event }: { event: SurveillanceEvent; }) {
    if (!event.voiceParticipants?.length) return null;

    return (
        <div className={cl("voice-members")}>
            <HeadingTertiary>Voice Channel Members</HeadingTertiary>
            <div className={cl("voice-member-grid")}>
                {event.voiceParticipants.map(member => (
                    <div key={member.userId} className={cl("voice-member")}>
                        {member.avatarUrl ? <img className={cl("voice-member-avatar")} src={member.avatarUrl} alt="" /> : <span className={cl("voice-member-avatar-placeholder")} />}
                        <div className={cl("voice-member-main")}>
                            <strong>{member.username} {member.tag ? <span>({member.tag})</span> : null}</strong>
                            <span>{member.userId}</span>
                        </div>
                        <div className={cl("voice-states")}>
                            <VoiceStateIcon enabled={member.mute || member.selfMute} label={member.mute ? "Server muted" : "Muted"} tone="danger">
                                <Microphone width={18} height={18} />
                            </VoiceStateIcon>
                            <VoiceStateIcon enabled={member.deaf || member.selfDeaf} label={member.deaf ? "Server deafened" : "Deafened"} tone="danger">
                                <HeadphonesIcon width={18} height={18} />
                            </VoiceStateIcon>
                            <VoiceStateIcon enabled={member.selfVideo} label="Camera on" tone="positive">
                                <VideoIcon width={18} height={18} />
                            </VoiceStateIcon>
                            <VoiceStateIcon enabled={member.selfStream} label="Streaming" tone="stream">
                                <ScreenshareIcon width={18} height={18} />
                            </VoiceStateIcon>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function VoiceEventStateSummary({ event }: { event: SurveillanceEvent; }) {
    if (!event.type.startsWith("voice_")) return null;

    const durationMs = getNumberMetadata(event, "durationMs");

    return (
        <div className={cl("event-voice-summary")}>
            <VoiceStateIcon enabled={getBooleanMetadata(event, "mute") || getBooleanMetadata(event, "selfMute")} label="Muted" tone="danger">
                <Microphone width={16} height={16} />
            </VoiceStateIcon>
            <VoiceStateIcon enabled={getBooleanMetadata(event, "deaf") || getBooleanMetadata(event, "selfDeaf")} label="Deafened" tone="danger">
                <HeadphonesIcon width={16} height={16} />
            </VoiceStateIcon>
            <VoiceStateIcon enabled={getBooleanMetadata(event, "selfVideo")} label="Camera on" tone="positive">
                <VideoIcon width={16} height={16} />
            </VoiceStateIcon>
            <VoiceStateIcon enabled={getBooleanMetadata(event, "selfStream")} label="Streaming" tone="stream">
                <ScreenshareIcon width={16} height={16} />
            </VoiceStateIcon>
            {durationMs != null ? <span>{formatDurationMs(durationMs, true)}</span> : null}
        </div>
    );
}

const getChannelRoute = (event: SurveillanceEvent) =>
    event.channelId ? `/channels/${event.guildId ?? "@me"}/${event.channelId}` : undefined;

const getEventAction = (event: SurveillanceEvent) => {
    const messageId = getStringMetadata(event, "messageId");
    const channelRoute = getChannelRoute(event);

    if (messageId && channelRoute) {
        return {
            label: "Jump to message",
            run: () => NavigationRouter.transitionTo(`${channelRoute}/${messageId}`),
        };
    }

    if (event.type.startsWith("voice_") && channelRoute) {
        return {
            label: "Open voice channel",
            run: () => NavigationRouter.transitionTo(channelRoute),
        };
    }

    if (event.type.startsWith("activity_") || event.type === "status" || event.type === "profile_update") {
        return {
            label: "Open profile",
            run: () => openUserProfile(event.userId),
        };
    }

    if (channelRoute) {
        return {
            label: "Open channel",
            run: () => NavigationRouter.transitionTo(channelRoute),
        };
    }
};

const EventDetailsModal = ErrorBoundary.wrap(function EventDetailsModal({ event, modalProps }: { event: SurveillanceEvent; modalProps: ModalProps; }) {
    const channel = event.channelId ? ChannelStore.getChannel(event.channelId) : undefined;
    const guild = event.guildId ? GuildStore.getGuild(event.guildId) : undefined;
    const metadata = Object.entries(event.metadata ?? {}).filter(([, value]) => value != null);

    const copyEvent = () => {
        try {
            void Promise.resolve(copyToClipboard(JSON.stringify(event, null, 2))).then(
                () => toast("Event copied."),
                () => toast("Failed to copy event.", Toasts.Type.FAILURE)
            );
        } catch {
            toast("Failed to copy event.", Toasts.Type.FAILURE);
        }
    };

    return (
        <ModalRoot {...modalProps} title="" size={ModalSize.MEDIUM}>
            <ModalHeader>
                <HeadingPrimary className={cl("modal-title")}>Event Details</HeadingPrimary>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>
            <ModalContent className={cl("modal-content")}>
                <div className={cl("modal-grid")}>
                    <DetailField label="Type" value={typeLabels[event.type]} />
                    <DetailField label="Time" value={formatTime(event.timestamp)} />
                    <DetailField label="User" value={event.username} />
                    <DetailField label="User ID" value={event.userId} />
                    <DetailField label="Avatar URL" value={getEventAvatarUrl(event)} wide={true} />
                    <DetailField label="Scope" value={event.scope} />
                    <DetailField label="Server" value={event.guildName ?? guild?.name} />
                    <DetailField label="Server ID" value={event.guildId} />
                    <DetailField label="Channel" value={event.channelName ?? channel?.name} />
                    <DetailField label="Channel ID" value={event.channelId} />
                    <DetailField label="Details" value={event.details} wide={true} preserve={true} />
                    <DetailField label="Message Content" value={event.content} wide={true} preserve={true} />
                    <DetailField label="Before" value={event.before} wide={true} preserve={true} />
                    <DetailField label="After" value={event.after} wide={true} preserve={true} />
                </div>

                {metadata.length ? (
                    <div className={cl("modal-grid")}>
                        {metadata.map(([key, value]) => (
                            <DetailField key={key} label={formatLabel(key)} value={value} />
                        ))}
                    </div>
                ) : null}

                <VoiceParticipants event={event} />
                <MessageMedia event={event} />
                <IdentityHistory history={event.identityHistory} />

                <div className={cl("actions")}>
                    <button className={cl("action")} onClick={copyEvent}>Copy Event JSON</button>
                </div>
                <div className={cl("modal-meta")}>Event ID: {event.id}</div>
            </ModalContent>
        </ModalRoot>
    );
}, { noop: true });

const openEventModal = (event: SurveillanceEvent) => {
    openModal((modalProps: any) => <EventDetailsModal event={event} modalProps={modalProps} />);
};

function TargetPill({ userId }: { userId: string; }) {
    const user = UserStore.getUser(userId);
    const avatarUrl = user ? IconUtils.getUserAvatarURL(user, true, 32) : undefined;

    return (
        <button className={cl("target-pill")} onClick={() => removeTarget(userId)}>
            {avatarUrl ? <img className={cl("target-avatar")} src={avatarUrl} alt="" /> : <span className={cl("target-avatar-placeholder")} />}
            <span>{user?.globalName ?? user?.username ?? userId}</span>
            <span className={cl("target-id")}>{userId}</span>
        </button>
    );
}

function ServerPill({ guildId }: { guildId: string; }) {
    const guild = GuildStore.getGuild(guildId);

    return (
        <button className={cl("target-pill")} onClick={() => removeServerTarget(guildId)}>
            <span>{guild?.name ?? guildId}</span>
            <span className={cl("target-id")}>{guildId}</span>
        </button>
    );
}

function UserStat({ label, value }: { label: string; value: string | number | undefined; }) {
    return (
        <div className={cl("user-stat")}>
            <span>{value ?? "-"}</span>
            <small>{label}</small>
        </div>
    );
}

function UserStatGroup({ title, children }: { title: string; children: React.ReactNode; }) {
    return (
        <section className={cl("user-stat-group")}>
            <HeadingTertiary>{title}</HeadingTertiary>
            <div className={cl("user-stat-grid")}>{children}</div>
        </section>
    );
}

const increment = (map: Map<string, number>, key: string | undefined) => {
    if (!key) return;
    map.set(key, (map.get(key) ?? 0) + 1);
};

const getTopLabel = (map: Map<string, number>) => {
    let top: [string, number] | undefined;

    for (const entry of map) {
        if (!top || entry[1] > top[1]) top = entry;
    }

    return top?.[0];
};

const getMetadataStatus = (event: SurveillanceEvent) => {
    const status = getStringMetadata(event, "to");
    if (status) return status;

    return event.details.match(/ to ([^.]+)\./)?.[1];
};

const getActivityName = (event: SurveillanceEvent) =>
    getStringMetadata(event, "activity")
    ?? getStringMetadata(event, "to")
    ?? event.details.replace(/^(Started|Stopped) /, "").replace(/^Changed activity from .+ to /, "").replace(/\.$/, "");

const getUserStats = (events: SurveillanceEvent[], userId: string): UserStats => {
    const userEvents = events
        .filter(event => event.userId === userId)
        .sort((a, b) => a.timestamp - b.timestamp);
    const user = UserStore.getUser(userId);
    const channelCounts = new Map<string, number>();
    const guildCounts = new Map<string, number>();
    const openVoice = new Map<string, SurveillanceEvent>();
    const activeVoiceFlags = new Map<"camera" | "deaf" | "mute" | "stream", number>();
    const activeActivities = new Map<string, number>();
    const now = Date.now();
    const stats: UserStats = {
        userId,
        username: user?.globalName ?? user?.username ?? userEvents.at(-1)?.username ?? userId,
        avatarUrl: user ? IconUtils.getUserAvatarURL(user, true, 64) : userEvents.at(-1)?.avatarUrl,
        messageCount: 0,
        editCount: 0,
        deleteCount: 0,
        attachmentCount: 0,
        reactionAdds: 0,
        reactionRemoves: 0,
        typingCount: 0,
        voiceJoins: 0,
        voiceLeaves: 0,
        voiceMoves: 0,
        voiceUpdates: 0,
        totalVoiceMs: 0,
        streamMs: 0,
        cameraMs: 0,
        muteMs: 0,
        deafMs: 0,
        statusTransitions: 0,
        onlineMs: 0,
        idleMs: 0,
        dndMs: 0,
        offlineMs: 0,
        activityStarts: 0,
        activityStops: 0,
        activityUpdates: 0,
        activityMs: 0,
        memberAdds: 0,
        memberRemoves: 0,
        memberUpdates: 0,
        profileUpdates: 0,
        identityHistory: [],
    };

    const closeFlag = (flag: "camera" | "deaf" | "mute" | "stream", timestamp: number) => {
        const startedAt = activeVoiceFlags.get(flag);
        if (startedAt == null) return;

        const duration = timestamp - startedAt;
        if (flag === "camera") stats.cameraMs += duration;
        else if (flag === "deaf") stats.deafMs += duration;
        else if (flag === "mute") stats.muteMs += duration;
        else stats.streamMs += duration;
        activeVoiceFlags.delete(flag);
    };

    let activeStatus: string | undefined;
    let activeStatusStartedAt: number | undefined;

    const addStatusDuration = (status: string | undefined, duration: number) => {
        if (status === "online") stats.onlineMs += duration;
        else if (status === "idle") stats.idleMs += duration;
        else if (status === "dnd") stats.dndMs += duration;
        else stats.offlineMs += duration;
    };

    const syncFlag = (flag: "camera" | "deaf" | "mute" | "stream", enabled: boolean, timestamp: number) => {
        if (enabled) {
            if (!activeVoiceFlags.has(flag)) activeVoiceFlags.set(flag, timestamp);
            return;
        }

        closeFlag(flag, timestamp);
    };

    for (const event of userEvents) {
        stats.firstSeen ??= event.timestamp;
        stats.lastSeen = event.timestamp;
        increment(channelCounts, event.channelName ?? event.channelId);
        increment(guildCounts, event.guildName ?? event.guildId);

        switch (event.type) {
            case "message":
                stats.messageCount++;
                stats.attachmentCount += getNumberMetadata(event, "attachmentCount") ?? 0;
                break;
            case "message_edit":
                stats.editCount++;
                break;
            case "message_delete":
                stats.deleteCount++;
                break;
            case "reaction_add":
                stats.reactionAdds++;
                break;
            case "reaction_remove":
                stats.reactionRemoves++;
                break;
            case "typing":
                stats.typingCount++;
                break;
            case "voice_join":
                stats.voiceJoins++;
                if (event.channelId) openVoice.set(event.channelId, event);
                syncFlag("mute", getBooleanMetadata(event, "mute") || getBooleanMetadata(event, "selfMute"), event.timestamp);
                syncFlag("deaf", getBooleanMetadata(event, "deaf") || getBooleanMetadata(event, "selfDeaf"), event.timestamp);
                syncFlag("camera", getBooleanMetadata(event, "selfVideo"), event.timestamp);
                syncFlag("stream", getBooleanMetadata(event, "selfStream"), event.timestamp);
                break;
            case "voice_leave":
                stats.voiceLeaves++;
                stats.totalVoiceMs += getNumberMetadata(event, "durationMs") ?? 0;
                if (event.channelId) openVoice.delete(event.channelId);
                closeFlag("mute", event.timestamp);
                closeFlag("deaf", event.timestamp);
                closeFlag("camera", event.timestamp);
                closeFlag("stream", event.timestamp);
                break;
            case "voice_move":
                stats.voiceMoves++;
                stats.totalVoiceMs += getNumberMetadata(event, "durationMs") ?? 0;
                for (const channelId of openVoice.keys()) openVoice.delete(channelId);
                if (event.channelId) openVoice.set(event.channelId, event);
                syncFlag("mute", getBooleanMetadata(event, "mute") || getBooleanMetadata(event, "selfMute"), event.timestamp);
                syncFlag("deaf", getBooleanMetadata(event, "deaf") || getBooleanMetadata(event, "selfDeaf"), event.timestamp);
                syncFlag("camera", getBooleanMetadata(event, "selfVideo"), event.timestamp);
                syncFlag("stream", getBooleanMetadata(event, "selfStream"), event.timestamp);
                break;
            case "voice_update":
                stats.voiceUpdates++;
                syncFlag("mute", getBooleanMetadata(event, "mute") || getBooleanMetadata(event, "selfMute"), event.timestamp);
                syncFlag("deaf", getBooleanMetadata(event, "deaf") || getBooleanMetadata(event, "selfDeaf"), event.timestamp);
                syncFlag("camera", getBooleanMetadata(event, "selfVideo"), event.timestamp);
                syncFlag("stream", getBooleanMetadata(event, "selfStream"), event.timestamp);
                break;
            case "status":
                stats.statusTransitions++;
                if (activeStatus && activeStatusStartedAt != null) addStatusDuration(activeStatus, event.timestamp - activeStatusStartedAt);
                activeStatus = getMetadataStatus(event) ?? stats.lastStatus;
                activeStatusStartedAt = event.timestamp;
                stats.lastStatus = activeStatus;
                break;
            case "activity_start":
                stats.activityStarts++;
                activeActivities.set(getActivityName(event), event.timestamp);
                break;
            case "activity_stop": {
                stats.activityStops++;
                const activity = getActivityName(event);
                const startedAt = activeActivities.get(activity);
                if (startedAt != null) stats.activityMs += event.timestamp - startedAt;
                activeActivities.delete(activity);
                break;
            }
            case "activity_update":
                stats.activityUpdates++;
                activeActivities.clear();
                activeActivities.set(getActivityName(event), event.timestamp);
                break;
            case "guild_member_add":
                stats.memberAdds++;
                break;
            case "guild_member_remove":
                stats.memberRemoves++;
                break;
            case "guild_member_update":
                stats.memberUpdates++;
                break;
            case "profile_update":
                stats.profileUpdates++;
                if (event.identityHistory?.length) stats.identityHistory = event.identityHistory;
                break;
        }
    }

    for (const event of openVoice.values()) {
        if (event.channelId) stats.totalVoiceMs += now - event.timestamp;
    }

    for (const [flag, startedAt] of activeVoiceFlags) {
        const duration = now - startedAt;
        if (flag === "camera") stats.cameraMs += duration;
        else if (flag === "deaf") stats.deafMs += duration;
        else if (flag === "mute") stats.muteMs += duration;
        else stats.streamMs += duration;
    }

    if (activeStatus && activeStatusStartedAt != null) addStatusDuration(activeStatus, now - activeStatusStartedAt);

    for (const startedAt of activeActivities.values()) {
        stats.activityMs += now - startedAt;
    }

    stats.topChannel = getTopLabel(channelCounts);
    stats.topGuild = getTopLabel(guildCounts);
    return stats;
};

function UserStatsPanel({ events, selectedUserId, setSelectedUserId }: { events: SurveillanceEvent[]; selectedUserId?: string; setSelectedUserId: (userId: string) => void; }) {
    const [showAllStats, setShowAllStats] = useState(false);
    const userOptions = useMemo<UserOption[]>(() => {
        const options = new Map<string, string>();

        for (const event of events) {
            if (!options.has(event.userId)) options.set(event.userId, `${event.username} (${event.userId})`);
        }

        return [...options.entries()]
            .map(([value, label]) => ({ label, value }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }, [events]);
    const userId = selectedUserId ?? userOptions[0]?.value;
    const stats = useMemo(() => userId ? getUserStats(events, userId) : undefined, [events, userId]);

    useEffect(() => {
        if (!selectedUserId && userId) setSelectedUserId(userId);
        return () => undefined;
    }, [selectedUserId, setSelectedUserId, userId]);

    return (
        <section className={cl("panel")}>
            <div className={cl("section-head")}>
                <HeadingTertiary>User Stats</HeadingTertiary>
                <Select
                    placeholder="Select a user..."
                    options={userOptions}
                    maxVisibleItems={8}
                    closeOnSelect={true}
                    select={setSelectedUserId}
                    isSelected={value => value === userId}
                    serialize={value => value}
                />
            </div>
            {stats ? (
                <>
                    <div className={cl("user-stats-head")}>
                        {stats.avatarUrl ? <img className={cl("event-avatar")} src={stats.avatarUrl} alt="" /> : <span className={cl("event-avatar-placeholder")} />}
                        <div>
                            <strong>{stats.username}</strong>
                            <span>{stats.userId}</span>
                        </div>
                        <button className={cl("action")} onClick={() => openUserProfile(stats.userId)}>Open profile</button>
                    </div>
                    <div className={cl("user-stat-summary")}>
                        <UserStat label="Messages" value={formatCount(stats.messageCount)} />
                        <UserStat label="Voice Time" value={formatDuration(stats.totalVoiceMs)} />
                        <UserStat label="Last Status" value={stats.lastStatus} />
                        <UserStat label="Last Seen" value={stats.lastSeen ? formatTime(stats.lastSeen) : undefined} />
                    </div>
                    <button className={cl("text-action")} onClick={() => setShowAllStats(value => !value)}>
                        {showAllStats ? "Hide detailed stats" : "Show detailed stats"}
                    </button>
                    {showAllStats ? (
                    <div className={cl("user-stat-groups")}>
                        <UserStatGroup title="Overview">
                            <UserStat label="First Seen" value={stats.firstSeen ? formatTime(stats.firstSeen) : undefined} />
                            <UserStat label="Last Seen" value={stats.lastSeen ? formatTime(stats.lastSeen) : undefined} />
                            <UserStat label="Top Channel" value={stats.topChannel} />
                            <UserStat label="Top Server" value={stats.topGuild} />
                        </UserStatGroup>
                        <UserStatGroup title="Messages">
                            <UserStat label="Messages" value={formatCount(stats.messageCount)} />
                            <UserStat label="Edits" value={formatCount(stats.editCount)} />
                            <UserStat label="Deletes" value={formatCount(stats.deleteCount)} />
                            <UserStat label="Attachments" value={formatCount(stats.attachmentCount)} />
                            <UserStat label="Reaction Adds" value={formatCount(stats.reactionAdds)} />
                            <UserStat label="Reaction Removes" value={formatCount(stats.reactionRemoves)} />
                            <UserStat label="Typing Signals" value={formatCount(stats.typingCount)} />
                        </UserStatGroup>
                        <UserStatGroup title="Voice">
                            <UserStat label="Joins" value={formatCount(stats.voiceJoins)} />
                            <UserStat label="Leaves" value={formatCount(stats.voiceLeaves)} />
                            <UserStat label="Moves" value={formatCount(stats.voiceMoves)} />
                            <UserStat label="Updates" value={formatCount(stats.voiceUpdates)} />
                            <UserStat label="Voice Time" value={formatDuration(stats.totalVoiceMs)} />
                            <UserStat label="Streaming Time" value={formatDuration(stats.streamMs)} />
                            <UserStat label="Camera Time" value={formatDuration(stats.cameraMs)} />
                            <UserStat label="Muted Time" value={formatDuration(stats.muteMs)} />
                            <UserStat label="Deafened Time" value={formatDuration(stats.deafMs)} />
                        </UserStatGroup>
                        <UserStatGroup title="Presence">
                            <UserStat label="Status Changes" value={formatCount(stats.statusTransitions)} />
                            <UserStat label="Last Status" value={stats.lastStatus} />
                            <UserStat label="Online Time" value={formatDuration(stats.onlineMs)} />
                            <UserStat label="Idle Time" value={formatDuration(stats.idleMs)} />
                            <UserStat label="DND Time" value={formatDuration(stats.dndMs)} />
                            <UserStat label="Offline Time" value={formatDuration(stats.offlineMs)} />
                        </UserStatGroup>
                        <UserStatGroup title="Activity">
                            <UserStat label="Starts" value={formatCount(stats.activityStarts)} />
                            <UserStat label="Stops" value={formatCount(stats.activityStops)} />
                            <UserStat label="Updates" value={formatCount(stats.activityUpdates)} />
                            <UserStat label="Activity Time" value={formatDuration(stats.activityMs)} />
                        </UserStatGroup>
                        <UserStatGroup title="Server And Profile">
                            <UserStat label="Member Adds" value={formatCount(stats.memberAdds)} />
                            <UserStat label="Member Removes" value={formatCount(stats.memberRemoves)} />
                            <UserStat label="Member Updates" value={formatCount(stats.memberUpdates)} />
                            <UserStat label="Profile Updates" value={formatCount(stats.profileUpdates)} />
                        </UserStatGroup>
                        <IdentityHistory history={stats.identityHistory} />
                    </div>
                    ) : null}
                </>
            ) : <div className={cl("empty")}>No user events.</div>}
        </section>
    );
}

function EventRow({ event }: { event: SurveillanceEvent; }) {
    const channel = event.channelId ? ChannelStore.getChannel(event.channelId) : undefined;
    const guild = event.guildId ? GuildStore.getGuild(event.guildId) : undefined;
    const location = [
        event.guildName ?? guild?.name,
        event.channelName ?? channel?.name,
    ].filter(Boolean).join(" / ");
    const avatarUrl = getEventAvatarUrl(event);
    const action = getEventAction(event);
    const openDetails = () => openEventModal(event);

    return (
        <div className={cl("event-row")} onClick={openDetails} role="button" tabIndex={0} onKeyDown={event => {
            if (event.key === "Enter" || event.key === " ") openDetails();
        }}>
            <div className={classes(cl("event-badge"), cl(`event-${event.type}`), event.type === "profile_update" && cl("event-profile"))}>
                {typeLabels[event.type]}
            </div>
            <div className={cl("event-main")}>
                <div className={cl("event-head")}>
                    <span className={cl("event-user")}>
                        {avatarUrl ? <img className={cl("event-avatar")} src={avatarUrl} alt="" /> : <span className={cl("event-avatar-placeholder")} />}
                        <strong>{event.username}</strong>
                    </span>
                    <span>{formatTime(event.timestamp)}</span>
                </div>
                <div className={cl("event-details")}>{event.details}</div>
                {location ? <div className={cl("event-location")}>{location}</div> : null}
                <VoiceEventStateSummary event={event} />
                {event.before || event.after ? (
                    <div className={cl("event-diff")}>
                        {event.before ? <span>Before: {event.before}</span> : null}
                        {event.after ? <span>After: {event.after}</span> : null}
                    </div>
                ) : null}
            </div>
            {action ? (
                <button
                    className={cl("event-action")}
                    onClick={mouseEvent => {
                        mouseEvent.stopPropagation();
                        action.run();
                    }}
                    type="button"
                >
                    {action.label}
                </button>
            ) : null}
        </div>
    );
}

function OsintAnalysisPanel({ events, selectedUserId }: { events: SurveillanceEvent[]; selectedUserId?: string; }) {
    const [result, setResult] = useState<OsintAnalysisResult | null>(null);
    const [expanded, setExpanded] = useState(false);

    useEffect(() => {
        if (!selectedUserId) {
            setResult(null);
            return;
        }
        const userEvents = events.filter(e => e.userId === selectedUserId);
        setResult(analyzeSurveillanceEvents(userEvents));
    }, [events, selectedUserId]);

    if (!selectedUserId || !result || result.sections.length === 0) return null;

    return (
        <section className={cl("panel")}>
            <div className={cl("section-head")}>
                <HeadingTertiary>OSINT Analysis</HeadingTertiary>
                <button className={cl("text-action")} onClick={() => setExpanded(v => !v)}>
                    {expanded ? "Collapse" : "Expand all"}
                </button>
            </div>
            <div className={cl("osint-summary")}>{result.summary}</div>
            <div className={cl("osint-sections")}>
                {(expanded ? result.sections : result.sections.slice(0, 3)).map((section, i) => (
                    <div key={i} className={cl("osint-section")}>
                        <div className={cl("osint-section-title")}>{section.title}</div>
                        <div className={cl("osint-section-body")}>
                            {section.content.split("\n").map((line, j) => (
                                <div key={j} className={cl("osint-line", { indent: line.startsWith("  -") })}>
                                    {line.replace(/^ {2}- /, "")}
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
            {!expanded && result.sections.length > 3 && (
                <button className={cl("text-action")} onClick={() => setExpanded(true)}>
                    Show all {result.sections.length} sections
                </button>
            )}
        </section>
    );
}

function SurveillanceTab() {
    const [events, setEvents] = useState<SurveillanceEvent[]>(getEvents());
    const [targets, setLocalTargets] = useState(getTargets());
    const [serverTargets, setLocalServerTargets] = useState(getServerTargets());
    const [targetInput, setTargetInput] = useState("");
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState<EventFilter>("all");
    const [visibleEventCount, setVisibleEventCount] = useState(EVENT_PAGE_SIZE);
    const [selectedStatsUserId, setSelectedStatsUserId] = useState<string | undefined>();
    const guilds = useStateFromStores([GuildStore], () => GuildStore.getGuildsArray());

    useEffect(() => {
        void loadEvents(settings.store.maxEvents).then(() => setEvents([...getEvents()]));

        const unsubscribeEvents = subscribe(() => setEvents([...getEvents()]));
        const unsubscribeTargets = subscribeTargets(() => setLocalTargets([...getTargets()]));
        const unsubscribeServerTargets = subscribeServerTargets(() => setLocalServerTargets([...getServerTargets()]));

        return () => {
            unsubscribeEvents();
            unsubscribeTargets();
            unsubscribeServerTargets();
        };
    }, []);

    useEffect(() => {
        setVisibleEventCount(EVENT_PAGE_SIZE);
        return () => undefined;
    }, [filter, query]);

    const filteredEvents = useMemo(() =>
        events.filter(event => eventMatchesFilter(event, filter) && eventMatchesQuery(event, query)),
        [events, filter, query]
    );

    const visibleEvents = useMemo(() =>
        filteredEvents.slice(0, visibleEventCount),
        [filteredEvents, visibleEventCount]
    );

    const stats = useMemo(() => ({
        events: events.length,
        users: new Set(events.map(event => event.userId)).size,
        guilds: new Set(events.map(event => event.guildId).filter(Boolean)).size,
        channels: new Set(events.map(event => event.channelId).filter(Boolean)).size,
    }), [events]);

    const guildOptions = useMemo<GuildOption[]>(() =>
        guilds
            .filter(guild => !serverTargets.includes(guild.id))
            .map(guild => ({ label: guild.name, value: guild.id }))
            .sort((a, b) => a.label.localeCompare(b.label)),
        [guilds, serverTargets]
    );

    const addInputTargets = () => {
        const ids = targetInput.match(/\d+/g) ?? [];
        if (!ids.length) {
            toast("Enter a valid Discord user ID.", Toasts.Type.FAILURE);
            return;
        }

        setTargets([...targets, ...ids]);
        setTargetInput("");
        toast("Target list updated.");
    };

    const copyEvents = () => {
        try {
            void Promise.resolve(copyToClipboard(JSON.stringify(filteredEvents, null, 2))).then(
                () => toast("Surveillance events copied."),
                () => toast("Failed to copy surveillance events.", Toasts.Type.FAILURE)
            );
        } catch {
            toast("Failed to copy surveillance events.", Toasts.Type.FAILURE);
        }
    };

    const resetEvents = () => {
        void clearEvents().then(() => toast("Surveillance events cleared."));
    };

    return (
        <SettingsTab>
            <div className={cl("root")}>
                <div className={cl("header")}>
                    <div className={cl("header-top")}>
                        <HeadingPrimary>Surveillance</HeadingPrimary>
                        <Tooltip text="Surveillance Settings">
                            {props => (
                                <button
                                    {...props}
                                    className={cl("settings-btn")}
                                    onClick={() => {
                                        if (plugins.Surveillance) openPluginModal(plugins.Surveillance);
                                    }}
                                    aria-label="Surveillance Settings"
                                >
                                    <CogWheel width={20} height={20} className={cl("settings-icon")} />
                                </button>
                            )}
                        </Tooltip>
                    </div>
                    <div className={cl("actions")}>
                        <span className={cl("summary")}>{stats.events} events · {stats.users} users · {stats.guilds} servers · {stats.channels} channels</span>
                        {SECTION_NAV.map(section => (
                            <button key={section} className={cl("nav-action")} onClick={() => scrollToSection(section)}>
                                {formatLabel(section)}
                            </button>
                        ))}
                        <button className={cl("action")} onClick={copyEvents}>Export JSON</button>
                        <button className={classes(cl("action"), cl("danger"))} onClick={resetEvents}>Clear</button>
                    </div>
                </div>

                <section id="vc-surveillance-timeline" className={classes(cl("panel"), cl("timeline-panel"))}>
                    <div className={cl("section-head")}>
                        <HeadingTertiary>Timeline</HeadingTertiary>
                        <TextInput value={query} placeholder="Search events..." onChange={setQuery} />
                    </div>
                    <div className={cl("filters")}>
                        {filterOptions.map(option => (
                            <button
                                key={option.value}
                                className={classes(cl("filter"), filter === option.value && cl("filter-active"))}
                                onClick={() => setFilter(option.value)}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                    <div className={cl("timeline-scroll")}>
                        <div className={cl("timeline")}>
                        {visibleEvents.length ? visibleEvents.map(event => (
                            <EventRow key={event.id} event={event} />
                        )) : <div className={cl("empty")}>No events.</div>}
                        </div>
                    </div>
                    {filteredEvents.length > visibleEvents.length ? (
                        <div className={cl("timeline-footer")}>
                            <span>Showing {visibleEvents.length} of {filteredEvents.length}</span>
                            <button
                                className={cl("action")}
                                onClick={() => setVisibleEventCount(count => count + EVENT_PAGE_SIZE)}
                            >
                                Show more
                            </button>
                        </div>
                    ) : null}
                </section>

                <div id="vc-surveillance-targets" className={cl("target-grid")}>
                    <section className={cl("panel")}>
                        <div className={cl("section-head")}>
                            <HeadingTertiary>People</HeadingTertiary>
                            <span className={cl("summary")}>{targets.length} tracked</span>
                        </div>
                        <div className={cl("target-input")}>
                            <TextInput value={targetInput} placeholder="Discord user IDs..." onChange={setTargetInput} />
                            <button className={cl("action")} onClick={addInputTargets}>Add</button>
                        </div>
                        <div className={cl("target-list")}>
                            {targets.length ? targets.map(userId => (
                                <TargetPill key={userId} userId={userId} />
                            )) : <span className={cl("empty")}>No person targets.</span>}
                        </div>
                    </section>

                    <section className={cl("panel")}>
                        <div className={cl("section-head")}>
                            <HeadingTertiary>Servers</HeadingTertiary>
                            <span className={cl("summary")}>{serverTargets.length} tracked</span>
                        </div>
                        <div className={cl("server-select")}>
                            <Select
                                placeholder="Select a server..."
                                options={guildOptions}
                                maxVisibleItems={8}
                                closeOnSelect={true}
                                select={addServerTarget}
                                isSelected={value => serverTargets.includes(value)}
                                serialize={value => value}
                            />
                        </div>
                        <div className={cl("target-list")}>
                            {serverTargets.length ? serverTargets.map(guildId => (
                                <ServerPill key={guildId} guildId={guildId} />
                            )) : <span className={cl("empty")}>No server targets.</span>}
                        </div>
                    </section>
                </div>

                <div id="vc-surveillance-stats">
                    <UserStatsPanel events={events} selectedUserId={selectedStatsUserId} setSelectedUserId={setSelectedStatsUserId} />
                </div>

                {settings.store.enableOsintAnalysis && (
                    <div id="vc-surveillance-osint">
                        <OsintAnalysisPanel events={events} selectedUserId={selectedStatsUserId} />
                    </div>
                )}
            </div>
        </SettingsTab>
    );
}

export default wrapTab(SurveillanceTab, "Surveillance");
