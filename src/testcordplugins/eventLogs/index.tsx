/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import * as DataStore from "@api/DataStore";
import { addHeaderBarButton, HeaderBarButton, removeHeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import { ModalCloseButton,ModalContent, ModalHeader, ModalRoot, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { ContextMenuApi, Forms, Menu, React, Select, showToast, Toasts, useCallback, useEffect, useMemo, useState } from "@webpack/common";

import { t, useTranslation } from "../autoTranslateNightcord";

const Dispatcher = findByPropsLazy("dispatch", "subscribe", "unsubscribe");
const UserStore = findStoreLazy("UserStore");
const ChannelStore = findStoreLazy("ChannelStore");
const GuildStore = findStoreLazy("GuildStore");
const MessageStore = findStoreLazy("MessageStore");
const SelectedChannelStore = findStoreLazy("SelectedChannelStore");

// Alternative navigation strategy via Dispatcher
const navigateTo = (path: string) => {
    try {
        const Router = findByPropsLazy("transitionTo") || findByPropsLazy("push");
        if (Router?.transitionTo) return Router.transitionTo(path);
        if (Router?.push) return Router.push(path);

        // Last resort via the dispatcher
        Dispatcher.dispatch({
            type: "NAVIGATE_TO",
            path: path
        });
    } catch (e) {
        console.error("Navigation error", e);
    }
};

const VoiceStateActionCreators = findByPropsLazy("selectVoiceChannel") || findByPropsLazy("connectToVoiceChannel");
const ClipboardModule = findByPropsLazy("copy", "copyLink");

type LogType =
    | "message_delete" | "message_edit"
    | "voice_join" | "voice_leave" | "voice_move"
    | "voice_mute" | "voice_deaf" | "voice_stream" | "voice_mute_mod"
    | "friend_add" | "friend_remove" | "friend_request" | "friend_request_cancel"
    | "block" | "guild_member_add" | "guild_member_remove" | "guild_ban"
    | "guild_timeout" | "guild_kick" | "user_disconnect" | "ping";

interface LogEntry {
    id: string; // Internal unique ID
    realId?: string; // Original ID (message, user, etc.)
    type: LogType;
    timestamp: number;
    timeStr: string;
    content: string;
    authorId?: string;
    authorName?: string;
    authorAvatar?: string | null;
    channelId?: string;
    channelName?: string;
    guildId?: string;
    guildName?: string;
    extra?: string;
    isMyVoice?: boolean;
}

const DEFAULT_MAX_LOGS = 10000;
const PAGE_SIZE = 40;
const MAX_VOICE_STATES = 2000;
const STORE_KEY = "EventLogs_logs";
const logger = new Logger("EventLogs");
let logs: LogEntry[] = [];

const settings = definePluginSettings({
    maxLogs: {
        type: OptionType.NUMBER,
        description: "Maximum logs to keep. Set to 0 for infinite.",
        default: DEFAULT_MAX_LOGS,
        isValid: (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 0,
        onChange: () => {
            pruneLogs();
            savePersistLogs();
            globalVersion++;
            for (const fn of updateListeners) {
                try { fn(); } catch { }
            }
        }
    }
});

// Track the user's current voice channel ID for "My Voice" filter
let myVoiceChannelId: string | null = null;
let logCount = 0;

const NOTIF_TYPES = new Set(["ping", "friend_add", "friend_remove", "friend_request", "friend_request_cancel", "block"]);
const unreadLogEntries = new Set<LogEntry>();

function getMaxLogs() {
    const { maxLogs } = settings.store;
    return Number.isInteger(maxLogs) && maxLogs >= 0 ? maxLogs : DEFAULT_MAX_LOGS;
}

function pruneLogs() {
    const maxLogs = getMaxLogs();
    if (maxLogs === 0) return;

    while (logs.length > maxLogs) {
        const removed = logs.pop();
        if (removed) unreadLogEntries.delete(removed);
    }
}

async function loadPersistLogs() {
    const savedLogs = await DataStore.get<LogEntry[]>(STORE_KEY).catch(() => undefined);
    let persistedLogs = savedLogs;

    if (!Array.isArray(persistedLogs)) {
        try {
            const oldLogs = localStorage.getItem("nightcord_logs");
            const parsed = oldLogs ? JSON.parse(oldLogs) as unknown : undefined;
            if (Array.isArray(parsed)) persistedLogs = parsed as LogEntry[];
        } catch (error) {
            logger.error("Failed to migrate event logs:", error);
        }
    }

    if (!Array.isArray(persistedLogs)) return;

    logs = persistedLogs.concat(logs).sort((a, b) => b.timestamp - a.timestamp);
    pruneLogs();
    logCount = logs.length;

    if (persistedLogs !== savedLogs) {
        savePersistLogs();
        try { localStorage.removeItem("nightcord_logs"); } catch { }
    }
}

function savePersistLogs() {
    const maxLogs = getMaxLogs();
    const toSave = logs.slice(0, maxLogs === 0 ? undefined : maxLogs);
    void DataStore.set(STORE_KEY, toSave).catch(error => logger.error("Failed to save event logs:", error));
}

// Single version counter — no snapshot, no copy
let globalVersion = 0;
const updateListeners = new Set<() => void>();

let saveTimer: ReturnType<typeof setTimeout> | null = null;
// savePersistLogs structured-clones up to DEFAULT_MAX_LOGS entries into IndexedDB. Running it
// on the 500ms UI debounce meant a busy guild rewrote the whole log twice a second. This
// interval is also the worst-case data loss window, since stop() doesn't run on a crash.
function scheduleSave() {
    if (saveTimer !== null) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        savePersistLogs();
    }, 10_000);
}

let flushTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleFlush() {
    if (flushTimer !== null) return;
    // FIX DM SCROLL CRASH: debounce increased from 50ms → 500ms
    // A flush at 50ms during DM scroll triggered a globalVersion++ on each
    // LOAD_MESSAGES_SUCCESS batch, forcing a React re-render in the middle of
    // Discord's DOM virtualization → removeChild crash (node not a child of this node).
    // 500ms gives time for the scroll to stabilize before notifying listeners.
    flushTimer = setTimeout(() => {
        flushTimer = null;
        globalVersion++;
        // Immediate notification for listeners
        for (const fn of updateListeners) {
            try { fn(); } catch { }
        }
        scheduleSave();
    }, 500);
}

function fmtNow(): string {
    const d = new Date();
    const h = d.getHours().toString().padStart(2, "0");
    const m = d.getMinutes().toString().padStart(2, "0");
    const s = d.getSeconds().toString().padStart(2, "0");
    return `${h}:${m}:${s}`;
}

function pushLog(entry: Omit<LogEntry, "id" | "timestamp" | "timeStr">) {
    const now = Date.now();
    const newLog: LogEntry = { id: `${now}_${logCount++}`, timestamp: now, timeStr: fmtNow(), ...(entry as any) };
    logs.unshift(newLog);
    pruneLogs();
    if (NOTIF_TYPES.has(newLog.type)) {
        unreadLogEntries.add(newLog);
    }
    scheduleFlush();
}

const getUser = (id?: string) => { try { return id ? UserStore?.getUser?.(id) : null; } catch { return null; } };
const getChannel = (id?: string) => { try { return id ? ChannelStore?.getChannel?.(id) : null; } catch { return null; } };
const getGuild = (id?: string) => { try { return id ? GuildStore?.getGuild?.(id) : null; } catch { return null; } };

function chInfo(channelId?: string) {
    const ch = getChannel(channelId); const g = getGuild(ch?.guild_id);
    return { channelId, channelName: ch?.name ?? channelId, guildId: ch?.guild_id, guildName: g?.name };
}
function uInfo(userId?: string) {
    const u = getUser(userId);
    return { authorId: userId, authorName: u?.globalName ?? u?.username ?? userId ?? "?", authorAvatar: u?.avatar ?? null };
}
function authorFrom(msg: any) {
    const id = msg?.author?.id ?? msg?.authorId;
    let name = msg?.author?.global_name ?? msg?.author?.username ?? "?";
    let av: string | null = msg?.author?.avatar ?? null;
    if (id) { const u = getUser(id); if (u) { if (name === "?") name = u.globalName ?? u.username ?? name; if (!av) av = u.avatar ?? null; } }
    return { authorId: id, authorName: name, authorAvatar: av };
}

// FIX CRASH DM SCROLL: msgCache reduced from 8000 → 3000 entries, purge from 1000 → 500
// The brutal purge of 1000 entries at once during scroll caused a spike of
// synchronous work that blocked the main thread at the critical re-render moment.
// Reduced size + smaller purge = less impact during scroll.
const MSG_CACHE_MAX = 3000;
const MSG_CACHE_PURGE = 500;
const msgCache = new Map<string, { content: string; authorId: string; authorName: string; authorAvatar: string | null; }>();

// Flag to block cache purges during scroll (LOAD_MESSAGES_SUCCESS active)
let isLoadingMessages = false;

function cacheMsg(msg: any) {
    if (!msg?.id) return;
    // FIX: Do not purge the cache during message loading (DM scroll)
    // Purging in the middle of a LOAD_MESSAGES_SUCCESS forced a recalculation of
    // Node globalPaths that conflicted with Discord's virtualization.
    if (msgCache.size >= MSG_CACHE_MAX && !isLoadingMessages) {
        const keys = Array.from(msgCache.keys());
        for (let i = 0; i < MSG_CACHE_PURGE; i++) msgCache.delete(keys[i]);
    }
    const a = authorFrom(msg);
    msgCache.set(msg.id, { content: msg.content ?? "", authorId: a.authorId ?? "", authorName: a.authorName, authorAvatar: a.authorAvatar });
}

function purgeMsgCache() {
    while (msgCache.size > MSG_CACHE_MAX - MSG_CACHE_PURGE) {
        const oldest = msgCache.keys().next().value;
        if (!oldest) break;
        msgCache.delete(oldest);
    }
}

function prunePrevVS() {
    while (prevVS.size > MAX_VOICE_STATES) {
        const oldest = prevVS.keys().next().value;
        if (!oldest) break;
        prevVS.delete(oldest);
    }
}

const CFG: Record<LogType, { label: string; color: string; }> = {
    message_delete: { label: t("Deleted"), color: "#ed4245" },
    message_edit: { label: t("Edited"), color: "#faa61a" },
    voice_join: { label: t("Voice +"), color: "#3ba55c" },
    voice_leave: { label: t("Voice -"), color: "#747f8d" },
    voice_move: { label: t("Moved"), color: "#5865f2" },
    voice_mute: { label: t("Mic"), color: "#faa61a" },
    voice_deaf: { label: t("Deaf"), color: "#faa61a" },
    voice_stream: { label: t("Stream"), color: "#5865f2" },
    voice_mute_mod: { label: t("Muted"), color: "#ed4245" },
    friend_add: { label: t("Friend +"), color: "#3ba55c" },
    friend_remove: { label: t("Friend -"), color: "#ed4245" },
    friend_request: { label: t("Request"), color: "#5865f2" },
    friend_request_cancel: { label: t("Cancelled"), color: "#747f8d" },
    block: { label: t("Blocked"), color: "#ed4245" },
    guild_member_add: { label: t("Joined"), color: "#3ba55c" },
    guild_member_remove: { label: t("Left"), color: "#ed4245" },
    guild_ban: { label: t("Banned"), color: "#ed4245" },
    guild_timeout: { label: t("Timeout"), color: "#faa61a" },
    guild_kick: { label: t("Kick"), color: "#ed4245" },
    user_disconnect: { label: t("Disconnected"), color: "#747f8d" },
    ping: { label: t("Ping"), color: "#eb459f" },
};

const FRIENDS_SET = new Set(["friend_add", "friend_remove", "friend_request", "friend_request_cancel", "block"]);
const GUILD_SET = new Set(["guild_member_add", "guild_member_remove", "guild_ban", "guild_timeout", "guild_kick", "user_disconnect"]);

const avatarUrl = (userId: string, av?: string | null) =>
    av ? `https://cdn.discordapp.com/avatars/${userId}/${av}.webp?size=32`
        : `https://cdn.discordapp.com/embed/avatars/${Math.abs(parseInt(userId.slice(-4), 16)) % 5}.png`;

function renderContent(text: string) {
    if (!text) return text;
    // Replace pings <@ID> or <@!ID> with @username
    return text.replace(/<@!?(\d+)>/g, (match, id) => {
        const u = getUser(id);
        return u ? `@${u.globalName || u.username}` : match;
    });
}

function LogRow({ e }: { e: LogEntry; }) {
    const cfg = CFG[e.type] ?? { label: e.type, color: "#747f8d" };

    const onDoubleClick = () => {
        if (!e.channelId) return;

        try {
            // For voice
            if (e.type.startsWith("voice_")) {
                if (VoiceStateActionCreators?.selectVoiceChannel) {
                    VoiceStateActionCreators.selectVoiceChannel(e.channelId);
                } else if (VoiceStateActionCreators?.connectToVoiceChannel) {
                    VoiceStateActionCreators.connectToVoiceChannel(e.guildId, e.channelId);
                }
                return;
            }

            // For messages
            const guildId = e.guildId || "@me";
            const path = e.realId
                ? `/channels/${guildId}/${e.channelId}/${e.realId}`
                : `/channels/${guildId}/${e.channelId}`;

            navigateTo(path);
        } catch (err) {
            console.error("Nightcord Navigation Error:", err);
            showToast(t("Navigation failed"), Toasts.Type.FAILURE);
        }
    };

    const copyToClipboard = (text: string) => {
        try {
            const el = document.createElement("textarea");
            el.value = text;
            el.style.position = "absolute";
            el.style.left = "-9999px";
            el.style.top = "0";
            document.body.appendChild(el);
            el.select();
            document.execCommand("copy");
            document.body.removeChild(el);
            return true;
        } catch (err) {
            console.error("[EventLogs] Copy failed:", err);
            return false;
        }
    };

    const onContextMenu = (event: React.MouseEvent) => {
        const user = e.authorId ? getUser(e.authorId) : null;
        const realUsername = user?.username || e.authorName;

        ContextMenuApi.openContextMenu(event as any, () => (
            <Menu.Menu navId="log-row-context" onClose={ContextMenuApi.closeContextMenu}>
                {e.authorId && (
                    <>
                        <Menu.MenuItem
                            id="open-profile"
                            label={t("Open Profile")}
                            action={() => {
                                const UserProfileModal = findByPropsLazy("openUserProfileModal") || findByPropsLazy("fetchProfile");
                                if (UserProfileModal?.openUserProfileModal) {
                                    UserProfileModal.openUserProfileModal({ userId: e.authorId });
                                } else {
                                    // Fallback navigation
                                    navigateTo(`/channels/@me/${e.authorId}`);
                                }
                            }}
                        />
                        <Menu.MenuSeparator />
                        <Menu.MenuItem
                            id="copy-user-id"
                            label={t("Copy User ID")}
                            action={() => {
                                if (copyToClipboard(String(e.authorId))) {
                                    showToast(t("User ID copied!"), Toasts.Type.SUCCESS);
                                }
                            }}
                        />
                        <Menu.MenuItem
                            id="copy-username"
                            label={t("Copy Username")}
                            action={() => {
                                if (copyToClipboard(String(realUsername))) {
                                    showToast(t("Username copied!"), Toasts.Type.SUCCESS);
                                }
                            }}
                        />
                    </>
                )}
                <Menu.MenuSeparator />
                {e.channelId && (
                    <Menu.MenuItem
                        id="copy-channel-id"
                        label={t("Copy Channel ID")}
                        action={() => {
                            if (copyToClipboard(String(e.channelId))) {
                                showToast(t("Channel ID copied!"), Toasts.Type.SUCCESS);
                            }
                        }}
                    />
                )}
            </Menu.Menu>
        ));
    };

    return (
        <div className="el-row"
            onDoubleClick={onDoubleClick}
            onContextMenu={onContextMenu}
            style={{ cursor: e.channelId ? "pointer" : "default" }}>
            <div className="el-left">
                {e.authorId
                    ? <img src={avatarUrl(e.authorId, e.authorAvatar)} className="el-avatar" alt=""
                        loading="lazy"
                        onError={ev => { (ev.currentTarget as HTMLImageElement).style.display = "none"; }} />
                    : <span className="el-icon-placeholder" />}
            </div>
            <div className="el-body">
                <div className="el-top">
                    <span className="el-badge" style={{ background: cfg.color }}>{t(cfg.label)}</span>
                    {e.authorName && e.authorName !== "?" && <span className="el-author">{e.authorName}</span>}
                    {e.channelName && <><span className="el-sep">·</span><span className="el-channel">#{e.channelName}</span></>}
                    {e.guildName && <span className="el-guild">{e.guildName}</span>}
                    <span className="el-time">{e.timeStr}</span>
                </div>
                {e.type === "message_delete" && (
                    <div className="el-msg el-msg--deleted">
                        <span className="el-msg-label">{t("Message:")} </span>
                        <span>{renderContent(e.content) || <em style={{ opacity: 0.5 }}>{t("not in cache")}</em>}</span>
                    </div>
                )}
                {e.type === "message_edit" && (
                    <div className="el-edit-wrap">
                        <div className="el-msg el-msg--before"><span className="el-msg-label">{t("Before:")} </span><span>{renderContent(e.extra || "?")}</span></div>
                        <div className="el-msg el-msg--after"><span className="el-msg-label">{t("After:")} </span><span>{renderContent(e.content || "—")}</span></div>
                    </div>
                )}
                {e.type !== "message_delete" && e.type !== "message_edit" && e.content && (
                    <div className="el-content-text">{renderContent(t(e.content))}</div>
                )}
            </div>
        </div>
    );
}

const FILTERS = [
    { key: "all", label: "All" }, { key: "delete", label: "Deleted" }, { key: "edit", label: "Edited" },
    { key: "vocal", label: "Voice" }, { key: "myvoice", label: "My Voice" }, { key: "friends", label: "Friends" }, { key: "guild", label: "Servers" }, { key: "ping", label: "Ping" },
];

function applyFilter(entries: LogEntry[], f: string, q: string, guildId: string): LogEntry[] {
    let r: LogEntry[];
    if (f === "delete") r = entries.filter(l => l.type === "message_delete");
    else if (f === "edit") r = entries.filter(l => l.type === "message_edit");
    else if (f === "vocal") r = entries.filter(l => l.type.charCodeAt(0) === 118); // "v"oice_
    else if (f === "myvoice") {
        r = entries.filter(l => l.isMyVoice);
    }
    else if (f === "friends") r = entries.filter(l => FRIENDS_SET.has(l.type));
    else if (f === "guild") r = entries.filter(l => GUILD_SET.has(l.type));
    else if (f === "ping") r = entries.filter(l => l.type === "ping");
    else r = entries;

    if (guildId !== "all") {
        r = r.filter(l => l.guildId === guildId);
    }

    if (!q) return r;
    const lq = q.toLowerCase();
    return r.filter(l => {
        const user = l.authorId ? getUser(l.authorId) : null;
        const realUsername = user?.username?.toLowerCase() || "";

        return l.content?.toLowerCase().includes(lq) ||
            l.authorName?.toLowerCase().includes(lq) ||
            realUsername.includes(lq) ||
            l.channelName?.toLowerCase().includes(lq) ||
            l.realId?.includes(q) ||
            l.authorId?.includes(q);
    });
}

function LogsModal({ rootProps }: { rootProps: any; }) {
    const { t } = useTranslation();
    const [version, setVersion] = useState(globalVersion);
    const [filter, setFilter] = useState("all");
    const [selectedGuild, setSelectedGuild] = useState("all");
    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [page, setPage] = useState(0);

    // Extract unique guilds for the select
    const guildOptions = useMemo(() => {
        const map = new Map<string, { label: string, guild: any; }>();
        for (const l of logs) {
            if (l.guildId && l.guildName) {
                if (!map.has(l.guildId)) {
                    map.set(l.guildId, { label: l.guildName, guild: getGuild(l.guildId) });
                }
            }
        }
        const options = [{ value: "all", label: t("All Servers") }];
        const sorted = Array.from(map.entries()).sort((a, b) => a[1].label.localeCompare(b[1].label));
        for (const [id, data] of sorted) {
            options.push({ value: id, label: data.label });
        }
        return options;
    }, [version, t]);

    useEffect(() => {
        const fn = () => setVersion(globalVersion);
        updateListeners.add(fn);
        return () => { updateListeners.delete(fn); };
    }, []);

    // Debounce search at 200ms
    useEffect(() => {
        const t = setTimeout(() => { setDebouncedSearch(search); setPage(0); }, 200);
        return () => clearTimeout(t);
    }, [search]);

    useEffect(() => { setPage(0); }, [filter, selectedGuild]);

    const filtered = useMemo(() => applyFilter(logs, filter, debouncedSearch, selectedGuild), [version, filter, debouncedSearch, selectedGuild]);
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const slice = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

    // Clear unread categories when viewed
    useEffect(() => {
        let changed = false;
        for (const l of unreadLogEntries) {
            if (filter === "all" || (filter === "ping" && l.type === "ping") || (filter === "friends" && FRIENDS_SET.has(l.type))) {
                unreadLogEntries.delete(l);
                changed = true;
            }
        }
        if (changed) { globalVersion++; setVersion(globalVersion); }
    }, [filter, version]);

    const clearLogs = useCallback(() => {
        if (filter === "all" && selectedGuild === "all") {
            logs = [];
            unreadLogEntries.clear();
        } else {
            const matchesFilter = (l: LogEntry) => applyFilter([l], filter, "", selectedGuild).length > 0;
            for (const l of unreadLogEntries) {
                if (matchesFilter(l)) unreadLogEntries.delete(l);
            }
            logs = logs.filter(l => !matchesFilter(l));
        }
        globalVersion++; setVersion(globalVersion);
        savePersistLogs();
    }, [filter, selectedGuild]);

    const saveAsTxt = useCallback(() => {
        try {
            const content = filtered.map(l => {
                const type = CFG[l.type]?.label || l.type;
                const author = l.authorName || "Unknown";
                const authorId = l.authorId ? ` (${l.authorId})` : "";
                const channel = l.channelName ? `#${l.channelName}` : "";
                const guild = l.guildName ? `[${l.guildName}]` : "";
                const messageId = l.realId ? ` [ID:${l.realId}]` : "";
                const body = l.type === "message_edit" ? `Before: ${l.extra} | After: ${l.content}` : l.content;
                return `[${l.timeStr}] [${type}] ${author}${authorId} ${channel} ${guild}${messageId}: ${body}`;
            }).join("\n");

            const blob = new Blob([content], { type: "text/plain" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `nightcord_logs_${new Date().toISOString().slice(0, 10)}.txt`;
            a.click();
            URL.revokeObjectURL(url);
            showToast(t("Logs saved!"), Toasts.Type.SUCCESS);
        } catch (err) {
            showToast(t("Error saving logs"), Toasts.Type.FAILURE);
        }
    }, [filtered, t]);

    return (
        <ModalRoot {...rootProps} size="large">
            <ModalHeader separator={false}>
                <Forms.FormTitle tag="h4" style={{ margin: 0, display: "flex", alignItems: "center", gap: 8, color: "#ffffff" }}>
                    Logs <span className="el-count">{logs.length}</span>
                </Forms.FormTitle>
                <ModalCloseButton onClick={rootProps.onClose} />
            </ModalHeader>
            <ModalContent className="el-content">
                <div className="el-toolbar">
                    <div className="el-filters">
                        {FILTERS.map(f => {
                            let tbUnread = 0;
                            for (const l of unreadLogEntries) {
                                if (f.key === "all" || (f.key === "ping" && l.type === "ping") || (f.key === "friends" && FRIENDS_SET.has(l.type))) {
                                    tbUnread++;
                                }
                            }
                            return (
                                <button key={f.key}
                                    style={{ position: "relative" }}
                                    className={`el-filter-btn ${filter === f.key ? "el-filter-btn--active" : ""}`}
                                    onClick={() => setFilter(f.key)}>
                                    {t(f.label)}
                                    {tbUnread > 0 && (
                                        <div style={{
                                            position: "absolute", top: -4, right: -4, background: "#ed4245", color: "white",
                                            fontSize: "9px", fontWeight: "bold", padding: "1px 4px", borderRadius: "8px", lineHeight: 1
                                        }}>{tbUnread}</div>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                    <div className="el-search-row">
                        <div className="el-guild-select-wrap">
                            <Select
                                options={guildOptions}
                                isSelected={(v: string) => selectedGuild === v}
                                select={(v: string) => setSelectedGuild(v)}
                                serialize={(v: string) => v}
                                placeholder={t("All Servers")}
                            />
                        </div>
                        <input className="el-search-input"
                            placeholder={t("Filter...")} value={search} onChange={e => setSearch(e.target.value)} />
                        {search && <button className="el-clear" onClick={() => setSearch("")}>✕</button>}
                        <button className="el-clear-all" style={{ marginRight: 4 }} onClick={saveAsTxt} title={t("Save as .txt")}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" /></svg>
                        </button>
                        <button className="el-clear-all" onClick={clearLogs} title={t("Clear")}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z" /></svg>
                        </button>
                    </div>
                </div>

                <div className="el-list">
                    {slice.length === 0
                        ? <div className="el-empty">{t("No events")}</div>
                        : slice.map(e => <LogRow key={e.id} e={e} />)}
                </div>

                {totalPages > 1 && (
                    <div className="el-pagination">
                        <button disabled={page === 0} onClick={() => setPage(0)}>«</button>
                        <button disabled={page === 0} onClick={() => setPage(p => p - 1)}>‹</button>
                        <span>{page + 1} / {totalPages}</span>
                        <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>›</button>
                        <button disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)}>»</button>
                    </div>
                )}
            </ModalContent>
        </ModalRoot>
    );
}

function LogsIconWithBadge({ width = 20, height = 20, count = 0 }) {
    return (
        <div style={{ position: "relative", display: "flex" }}>
            <svg width={width} height={height} viewBox="0 0 24 24" fill="currentColor">
                <path fillRule="evenodd" d="M18.5 23c.88 0 1.7-.25 2.4-.69l1.4 1.4a1 1 0 0 0 1.4-1.42l-1.39-1.4A4.5 4.5 0 1 0 18.5 23Zm0-2a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" clipRule="evenodd" />
                <path d="M3 3a1 1 0 0 0 0 2h18a1 1 0 1 0 0-2H3ZM2 8a1 1 0 0 1 1-1h18a1 1 0 1 1 0 2H3a1 1 0 0 1-1-1ZM3 11a1 1 0 1 0 0 2h11a1 1 0 1 0 0-2H3ZM2 16a1 1 0 0 1 1-1h8a1 1 0 1 1 0 2H3a1 1 0 0 1-1-1ZM3 19a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2H3Z" />
            </svg>
        </div>
    );
}

function LogsButton() {
    const [count, setCount] = useState(logs.length);
    const [notif, setNotif] = useState(unreadLogEntries.size);

    useEffect(() => {
        const fn = () => { setCount(logs.length); setNotif(unreadLogEntries.size); };
        updateListeners.add(fn);
        return () => { updateListeners.delete(fn); };
    }, []);

    const onClick = () => {
        unreadLogEntries.clear();
        globalVersion++;
        for (const fn of updateListeners) { try { fn(); } catch { } }
        openModal(props => <LogsModal rootProps={props} />);
    };

    return (
        <HeaderBarButton
            icon={() => <LogsIconWithBadge count={notif} />}
            tooltip={`${t("Logs")} (${count})`}
            onClick={onClick}
        />
    );
}

let unsubs: Array<() => void> = [];
const prevVS = new Map<string, any>();

function subscribeToEvents() {
    const sub = (ev: string, fn: (d: any) => void) => {
        Dispatcher.subscribe(ev, fn);
        unsubs.push(() => Dispatcher.unsubscribe(ev, fn));
    };

    sub("MESSAGE_CREATE", d => {
        if (d.message) {
            cacheMsg(d.message);
            const meId = UserStore?.getCurrentUser?.()?.id;
            if (meId && d.message.mentions?.some((m: any) => m.id === meId)) {
                const a = authorFrom(d.message);
                pushLog({
                    type: "ping",
                    content: d.message.content || "",
                    authorId: a.authorId ?? "",
                    authorName: a.authorName,
                    authorAvatar: a.authorAvatar,
                    realId: d.message.id,
                    ...chInfo(d.message.channel_id)
                });
            }
        }
    });
    sub("LOAD_MESSAGES_SUCCESS", d => {
        if (!d) return;
        // FIX CRASH DM SCROLL: isLoadingMessages blocks msgCache purge during
        // batch processing — avoids a synchronous spike on the main thread.
        const msgs = [
            ...(Array.isArray(d.messages) ? d.messages : []),
            ...(Array.isArray(d.jump) ? d.jump : []),
            ...(Array.isArray(d.around) ? d.around : []),
            ...(Array.isArray(d.before) ? d.before : [])
        ];
        if (msgs.length === 0) return;

        // requestIdleCallback is ideal for background scanning without lag
        if (typeof requestIdleCallback !== "undefined") {
            requestIdleCallback(() => {
                isLoadingMessages = true;
                try { for (const m of msgs) cacheMsg(m); } finally { isLoadingMessages = false; }
                // Deferred purge if the cache exceeds the limit
                if (msgCache.size >= MSG_CACHE_MAX) purgeMsgCache();
            }, { timeout: 3000 });
        } else {
            setTimeout(() => {
                isLoadingMessages = true;
                try { for (const m of msgs) cacheMsg(m); } finally { isLoadingMessages = false; }
                if (msgCache.size >= MSG_CACHE_MAX) purgeMsgCache();
            }, 100);
        }
    });
    sub("MESSAGE_UPDATE", d => {
        if (!d.message) return;
        const m = d.message; const cached = msgCache.get(m.id);
        const oldC = cached?.content ?? "", newC = m.content ?? "";
        if (oldC === newC) return;
        const a = authorFrom(m);
        pushLog({
            type: "message_edit", content: newC, extra: oldC || "(unknown)", realId: m.id,
            authorId: a.authorId ?? cached?.authorId, authorName: a.authorName !== "?" ? a.authorName : (cached?.authorName ?? "?"),
            authorAvatar: a.authorAvatar ?? cached?.authorAvatar ?? null, ...chInfo(m.channel_id)
        });
        if (cached) cached.content = newC; else cacheMsg(m);
    });
    sub("MESSAGE_DELETE", d => {
        if (d.mlDeleted) return;
        const cached = msgCache.get(d.id);
        let content = "", authorId = "", authorName = "?", authorAvatar: string | null = null;
        try { const sm = MessageStore?.getMessage?.(d.channelId, d.id); if (sm) { content = sm.content ?? ""; const a = authorFrom(sm); authorId = a.authorId ?? ""; authorName = a.authorName; authorAvatar = a.authorAvatar; } } catch { }
        if (cached) { if (!content) content = cached.content; if (!authorId) { authorId = cached.authorId; authorName = cached.authorName; authorAvatar = cached.authorAvatar; } }
        if (authorId) { const u = getUser(authorId); if (u) { authorName = u.globalName ?? u.username ?? authorName; authorAvatar = u.avatar ?? authorAvatar; } }
        pushLog({ type: "message_delete", content, authorId, authorName, authorAvatar, realId: d.id, ...chInfo(d.channelId) });
        msgCache.delete(d.id);
    });
    sub("VOICE_STATE_UPDATES", d => {
        const meId = UserStore?.getCurrentUser?.()?.id;
        for (const s of d?.voiceStates ?? []) {
            const { userId, channelId, oldChannelId, guildId } = s;
            if (!userId) continue;

            // Determine if the event happened in our current VC before we possibly change myVoiceChannelId
            let isMyVoice = false;
            // Our own actions are always tagged as our voice
            if (userId === meId) {
                isMyVoice = true;
            }
            // Others interacting with the channel we are currently in
            else if (myVoiceChannelId != null && (channelId === myVoiceChannelId || oldChannelId === myVoiceChannelId)) {
                isMyVoice = true;
            }

            // Track our own voice channel for future events
            if (userId === meId) {
                myVoiceChannelId = channelId ?? null;
            }

            const u = getUser(userId); const ch = getChannel(channelId ?? oldChannelId); const g = getGuild(guildId ?? ch?.guild_id);
            const b = {
                authorId: userId, authorName: u?.globalName ?? u?.username ?? userId, authorAvatar: u?.avatar ?? null,
                channelId: channelId ?? oldChannelId, channelName: ch?.name, guildId: g?.id, guildName: g?.name,
                isMyVoice
            };
            if (!oldChannelId && channelId) pushLog({ type: "voice_join", content: "Joined", ...b });
            else if (oldChannelId && !channelId) {
                const p = prevVS.get(userId);
                const content = (s.selfStream === false && p?.selfStream === true) ? "Stream stopped" : "Left";
                pushLog({ type: "voice_leave", content, ...b, channelId: oldChannelId });
            }
            else if (oldChannelId && channelId && oldChannelId !== channelId) { const oc = getChannel(oldChannelId); pushLog({ type: "voice_move", content: `${oc?.name ?? "?"} → ${ch?.name ?? "?"}`, ...b }); }
            const p = prevVS.get(userId);
            if (p) {
                if (s.selfMute !== p.selfMute) pushLog({ type: "voice_mute", content: s.selfMute ? t("Mic muted") : t("Mic unmuted"), ...b });
                if (s.selfDeaf !== p.selfDeaf) pushLog({ type: "voice_deaf", content: s.selfDeaf ? t("Headphones muted") : t("Headphones unmuted"), ...b });
                if (s.mute && !p.mute) pushLog({ type: "voice_mute_mod", content: t("Muted by staff"), ...b });
                if (!s.mute && p.mute) pushLog({ type: "voice_mute_mod", content: t("Unmuted by staff"), ...b });
                if (s.selfStream !== p.selfStream) pushLog({ type: "voice_stream", content: s.selfStream ? t("Stream started") : t("Stream stopped"), ...b });
            }
            prevVS.set(userId, s);
            prunePrevVS();
        }
    });
    const relUser = (data: any) => {
        const rel = data?.relationship ?? data; const userId = rel?.user?.id ?? rel?.id ?? data?.userId ?? "?";
        let name = rel?.user?.global_name ?? rel?.user?.globalName ?? rel?.user?.username ?? null;
        let av: string | null = rel?.user?.avatar ?? null;
        if (userId !== "?") { const u = getUser(userId); if (u) { name = name ?? u.globalName ?? u.username ?? null; av = av ?? u.avatar ?? null; } }
        return { authorId: userId, authorName: name ?? userId, authorAvatar: av };
    };
    const relType = (data: any) => { const raw = data?.relationship?.type ?? data?.type ?? -1; return typeof raw === "number" ? raw : parseInt(String(raw), 10) || -1; };
    sub("RELATIONSHIP_ADD", d => {
        const b = relUser(d); const t_type = relType(d);
        const [type, content]: [LogType, string] = t_type === 2 ? ["block", t("Blocked")] : t_type === 3 ? ["friend_request", t("Request received")] : t_type === 4 ? ["friend_request", t("Request sent")] : ["friend_add", t("Friend added")];
        pushLog({ type, content, ...b });
    });
    sub("RELATIONSHIP_REMOVE", d => {
        const b = relUser(d); const t_type = relType(d);
        const [type, content]: [LogType, string] = (t_type === 3 || t_type === 4) ? ["friend_request_cancel", t("Request cancelled")] : t_type === 2 ? ["friend_remove", t("Unblocked")] : ["friend_remove", t("Friend removed")];
        pushLog({ type, content, ...b });
    });
    sub("GUILD_MEMBER_ADD", d => { const b = uInfo(d.user?.id); const g = getGuild(d.guildId); pushLog({ type: "guild_member_add", content: t("Joined"), ...b, guildId: d.guildId, guildName: g?.name }); });
    sub("GUILD_MEMBER_REMOVE", d => {
        const b = uInfo(d.user?.id); const g = getGuild(d.guildId);
        pushLog({ type: "guild_member_remove", content: t("Left/Kick"), ...b, guildId: d.guildId, guildName: g?.name });
    });
    sub("GUILD_BAN_ADD", d => { const b = uInfo(d.user?.id); const g = getGuild(d.guildId); pushLog({ type: "guild_ban", content: t("Banned"), ...b, guildId: d.guildId, guildName: g?.name }); });
    sub("GUILD_BAN_REMOVE", d => { const b = uInfo(d.user?.id); const g = getGuild(d.guildId); pushLog({ type: "friend_remove", content: t("Unbanned"), ...b, guildId: d.guildId, guildName: g?.name }); });

    sub("GUILD_MEMBER_UPDATE", d => {
        if (!d.guildId || !d.user?.id) return;
        const b = uInfo(d.user.id); const g = getGuild(d.guildId);
        if (d.communicationDisabledUntil) {
            pushLog({ type: "guild_timeout", content: t("Temporarily timed out (Timeout)"), ...b, guildId: d.guildId, guildName: g?.name });
        }
    });

    sub("CHANNEL_SELECT", d => {
        if (!d.channelId) return;
        let changed = false;
        for (const l of unreadLogEntries) {
            if (l.channelId === d.channelId) {
                unreadLogEntries.delete(l);
                changed = true;
            }
        }
        if (changed) scheduleFlush();
    });

    // Capture logout/disconnect (partial since the plugin stops on full disconnect)
    sub("LOGOUT", () => { pushLog({ type: "user_disconnect", content: t("Account disconnected"), authorName: "System" }); });
}

export default definePlugin({
    name: "EventLogs",
    description: "Logs: deleted/edited messages, voice, friends, servers.",
    tags: ["Notifications", "Utility", "Nightcord"],
    authors: [{ name: "Nightcord", id: 0n }, TestcordDevs.x2b],
    dependencies: ["HeaderBarAPI"],
    settings,
    async start() {
        // Initialize current voice channel on start
        try {
            const vcId = (SelectedChannelStore as any)?.getVoiceChannelId?.();
            if (vcId) myVoiceChannelId = vcId;
        } catch { }
        await loadPersistLogs();
        addHeaderBarButton("nightcord-event-logs", () => <LogsButton />, 7);
        subscribeToEvents();
    },
    stop() {
        removeHeaderBarButton("nightcord-event-logs");
        unsubs.forEach(fn => fn()); unsubs = [];
        if (flushTimer !== null) { clearTimeout(flushTimer); flushTimer = null; }
        if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null; }
        savePersistLogs();
        logs = []; msgCache.clear(); prevVS.clear(); unreadLogEntries.clear(); updateListeners.clear();
        isLoadingMessages = false;
        myVoiceChannelId = null;
    },
});
