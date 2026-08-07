/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import * as DataStore from "@api/DataStore";
import { addChannelToolbarButton, addHeaderBarButton, ChannelToolbarButton, HeaderBarButton, removeChannelToolbarButton, removeHeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { ModalCloseButton, ModalContent, ModalHeader, ModalRoot, openModal } from "@utils/modal";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { ChannelStore, FluxDispatcher, GuildMemberStore, MessageStore, React, ReactDOM, SelectedChannelStore, UserStore } from "@webpack/common";

const Native = VencordNative.pluginHelpers.fakeDM as PluginNative<typeof import("./native")>;
const STORAGE_KEY = "fakedm_fakes";

// ─── Unique Snowflake Generator ─────────────────────────────────────────────
let _idCounter = 0;
function uniqueSnowflake(date: Date): string {
    const offset = _idCounter++ % 4096;
    const ms = Math.max(0, date.getTime() - 1420070400000);
    return ((BigInt(ms) << 22n) | BigInt(offset)).toString();
}

function randomSeconds(date: Date): Date {
    const sec = 1 + Math.floor(Math.random() * 59);
    return new Date(date.getTime() + sec * 1000);
}

// ─── Flexible Time Parsing Helper ───────────────────────────────────────────
function parseFlexibleDate(input: string): Date | null {
    if (!input) return null;
    const str = input.trim().toLowerCase();
    if (!str) return null;

    if (str === "now" || str === "0") return new Date();

    const relMatch = str.match(/^([+-]?\d+)\s*([smhd])(?: ago)?$/);
    if (relMatch) {
        const val = parseInt(relMatch[1], 10);
        const unit = relMatch[2];
        const mult = unit === "s" ? 1000 : unit === "m" ? 60000 : unit === "h" ? 3600000 : 86400000;
        return new Date(Date.now() + val * mult);
    }

    const timeMatch = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (timeMatch) {
        const now = new Date();
        const hrs = parseInt(timeMatch[1], 10);
        const mins = parseInt(timeMatch[2], 10);
        const secs = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
        if (hrs >= 0 && hrs < 24 && mins >= 0 && mins < 60 && secs >= 0 && secs < 60) {
            return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hrs, mins, secs);
        }
    }

    const parsed = new Date(input);
    if (!isNaN(parsed.getTime())) return parsed;

    return null;
}

// ─── Plugin Settings ────────────────────────────────────────────────────────
const fakeDMSettings = definePluginSettings({
    location: {
        type: OptionType.SELECT,
        description: "Where to show the FakeDM button",
        options: [
            { label: "Chat bar", value: "chatbar", default: true },
            { label: "Header bar", value: "headerbar" },
            { label: "Channel toolbar", value: "channeltoolbar" },
            { label: "Disabled", value: "disabled" },
        ],
        restartNeeded: true,
    },
});

// ─── Data Types ─────────────────────────────────────────────────────────────
interface PersistedMessage {
    type: "message";
    channelId: string;
    authorId: string;
    authorName?: string;
    authorAvatar?: string | null;
    content: string;
    timestamp: string;
    snowflakeId: string;
}

interface PersistedCall {
    type: "call";
    channelId: string;
    callerId: string;
    otherId: string;
    missed: boolean;
    durationSec: number;
    timestamp: string;
    endedTimestamp: string | null;
    snowflakeId: string;
}

type PersistedFake = PersistedMessage | PersistedCall;

// ─── Data Persistence & Migration ──────────────────────────────────────────
let _persistedFakes: PersistedFake[] = [];

async function loadPersisted(): Promise<PersistedFake[]> {
    try {
        const stored = await DataStore.get<PersistedFake[]>(STORAGE_KEY);
        if (stored && Array.isArray(stored)) {
            _persistedFakes = stored;
            return stored;
        }

        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            _persistedFakes = parsed;
            return parsed;
        }

        const nativeRaw = await Native?.loadFakes();
        if (nativeRaw) {
            const parsed = JSON.parse(nativeRaw);
            _persistedFakes = parsed;
            return parsed;
        }
    } catch { }

    _persistedFakes = [];
    return [];
}

async function savePersisted(fakes: PersistedFake[]) {
    _persistedFakes = fakes;
    try { await DataStore.set(STORAGE_KEY, fakes); } catch { }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(fakes)); } catch { }
    try { Native?.saveFakes(JSON.stringify(fakes)); } catch { }
}

async function removePersistedItem(snowflakeId: string) {
    const next = _persistedFakes.filter(f => f.snowflakeId !== snowflakeId);
    await savePersisted(next);
}

async function removePersistedChannel(channelId: string) {
    const next = _persistedFakes.filter(f => f.channelId !== channelId);
    await savePersisted(next);
}

// ─── Active Message Tracking ────────────────────────────────────────────────
const fakeIds = new Map<string, Set<string>>();

function registerFake(channelId: string, id: string) {
    if (!fakeIds.has(channelId)) fakeIds.set(channelId, new Set());
    fakeIds.get(channelId)!.add(id);
}

function clearSingleFake(channelId: string, snowflakeId: string) {
    FluxDispatcher.dispatch({ type: "MESSAGE_DELETE", channelId, id: snowflakeId, mlDeleted: true });
    fakeIds.get(channelId)?.delete(snowflakeId);
    removePersistedItem(snowflakeId);
}

function clearChannelFakes(channelId: string): number {
    const ids = fakeIds.get(channelId);
    const persistedChannelFakes = _persistedFakes.filter(f => f.channelId === channelId);
    const allIds = new Set<string>([...(ids ?? []), ...persistedChannelFakes.map(f => f.snowflakeId)]);

    let count = 0;
    for (const id of allIds) {
        FluxDispatcher.dispatch({ type: "MESSAGE_DELETE", channelId, id, mlDeleted: true });
        count++;
    }

    if (ids) ids.clear();
    removePersistedChannel(channelId);
    return count;
}

// ─── Avatar & Channel Context ───────────────────────────────────────────────
function getAvatarUrl(user: any): string {
    if (!user) return "";
    if (user.avatar) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.webp?size=64`;
    const idx = user.discriminator && user.discriminator !== "0"
        ? parseInt(user.discriminator) % 5
        : Number(BigInt(user.id) >> 22n) % 6;
    return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
}

function getCurrentChannel(): any | null {
    try {
        const chId = SelectedChannelStore.getChannelId();
        if (!chId) return null;
        return ChannelStore.getChannel(chId) ?? null;
    } catch { return null; }
}

function buildAuthorObject(user: any) {
    return {
        id: user.id,
        username: user.username || "User",
        discriminator: user.discriminator ?? "0",
        avatar: user.avatar ?? null,
        public_flags: user.publicFlags ?? 0,
        flags: user.flags ?? 0,
        banner: user.banner ?? null,
        accent_color: null,
        global_name: user.globalName || user.global_name || user.username || "User",
        avatar_decoration_data: user.avatarDecorationData
            ? { asset: user.avatarDecorationData.asset, sku_id: user.avatarDecorationData.skuId }
            : null,
        banner_color: null,
    };
}

function getChannelParticipants(): any[] {
    const usersMap = new Map<string, any>();
    const me = UserStore.getCurrentUser();
    if (me) usersMap.set(me.id, me);

    try {
        const ch = getCurrentChannel();
        if (!ch) return Array.from(usersMap.values());

        if (ch.recipients || ch.rawRecipients) {
            const recipientIds: string[] = ch.recipients ?? ch.rawRecipients?.map((r: any) => r.id) ?? [];
            for (const rid of recipientIds) {
                const u = UserStore.getUser(rid);
                if (u) usersMap.set(u.id, u);
            }
        }

        if (ch.guild_id) {
            const memberStore = GuildMemberStore as any;
            const members = memberStore.getMembers?.(ch.guild_id) ?? memberStore.getMemberIds?.(ch.guild_id);
            if (Array.isArray(members)) {
                for (const m of members.slice(0, 50)) {
                    const id = typeof m === "string" ? m : m?.userId || m?.user?.id;
                    if (id) {
                        const u = UserStore.getUser(id);
                        if (u) usersMap.set(u.id, u);
                    }
                }
            } else if (members && typeof members === "object") {
                for (const m of Object.values(members).slice(0, 50) as any[]) {
                    const id = m?.userId || m?.user?.id || m?.id;
                    if (id) {
                        const u = UserStore.getUser(id);
                        if (u) usersMap.set(u.id, u);
                    }
                }
            }

            const messages = MessageStore.getMessages(ch.id);
            if (messages && messages._array) {
                for (const msg of messages._array.slice(-30)) {
                    if (msg.author && msg.author.id) {
                        usersMap.set(msg.author.id, msg.author);
                    }
                }
            }
        }
    } catch { }

    return Array.from(usersMap.values());
}

// ─── Injections ─────────────────────────────────────────────────────────────
function injectMessage(channelId: string, author: any, content: string, date: Date, persistedId?: string) {
    const actualDate = persistedId ? date : randomSeconds(date);
    const id = persistedId ?? uniqueSnowflake(actualDate);

    FluxDispatcher.dispatch({
        type: "MESSAGE_CREATE",
        channelId,
        message: {
            attachments: [], components: [], embeds: [], mention_roles: [], mentions: [],
            author: buildAuthorObject(author),
            channel_id: channelId,
            content,
            edited_timestamp: null,
            flags: 0,
            id,
            mention_everyone: false,
            nonce: id,
            pinned: false,
            timestamp: actualDate.toISOString(),
            tts: false,
            type: 0,
        },
        optimistic: false,
        isPushNotification: false,
    });
    registerFake(channelId, id);

    if (!persistedId) {
        const next = [..._persistedFakes, {
            type: "message" as const,
            channelId,
            authorId: author.id,
            authorName: author.globalName || author.username,
            authorAvatar: author.avatar,
            content,
            timestamp: actualDate.toISOString(),
            snowflakeId: id,
        }];
        savePersisted(next);
    }
}

function injectCall(
    channelId: string,
    caller: any,
    other: any,
    missed: boolean,
    durationSec: number,
    date: Date,
    persistedId?: string,
    persistedEndedTs?: string | null
) {
    const actualDate = persistedId ? date : randomSeconds(date);
    const id = persistedId ?? uniqueSnowflake(actualDate);
    const participants = missed ? [caller.id] : [caller.id, other.id];
    const endedDate = missed
        ? actualDate
        : (persistedEndedTs ? new Date(persistedEndedTs) : new Date(actualDate.getTime() + durationSec * 1000));

    FluxDispatcher.dispatch({
        type: "MESSAGE_CREATE",
        channelId,
        message: {
            attachments: [], components: [], embeds: [], mention_roles: [], mentions: [],
            author: buildAuthorObject(caller),
            channel_id: channelId,
            content: "",
            edited_timestamp: null,
            flags: 0,
            id,
            mention_everyone: false,
            nonce: id,
            pinned: false,
            timestamp: actualDate.toISOString(),
            tts: false,
            type: 3, // CALL
            call: {
                participants,
                ended_timestamp: endedDate.toISOString(),
                duration: missed ? undefined : durationSec,
            },
        },
        optimistic: false,
        isPushNotification: false,
    });
    registerFake(channelId, id);

    if (!persistedId) {
        const next = [..._persistedFakes, {
            type: "call" as const,
            channelId,
            callerId: caller.id,
            otherId: other.id,
            missed,
            durationSec,
            timestamp: actualDate.toISOString(),
            endedTimestamp: endedDate.toISOString(),
            snowflakeId: id,
        }];
        savePersisted(next);
    }
}

// ─── Automatic Restoration Listener ─────────────────────────────────────────
function restoreChannelFakes(channelId: string) {
    if (!channelId || !_persistedFakes.length) return;
    const channelFakes = _persistedFakes.filter(f => f.channelId === channelId);
    if (!channelFakes.length) return;

    for (const f of channelFakes) {
        const existing = MessageStore.getMessage(channelId, f.snowflakeId);
        if (existing) continue;

        if (f.type === "message") {
            let author = UserStore.getUser(f.authorId);
            if (!author) {
                author = {
                    id: f.authorId,
                    username: f.authorName || "User",
                    globalName: f.authorName || "User",
                    avatar: f.authorAvatar ?? null,
                } as any;
            }
            injectMessage(f.channelId, author, f.content, new Date(f.timestamp), f.snowflakeId);
        } else {
            let caller = UserStore.getUser(f.callerId);
            let other = UserStore.getUser(f.otherId);
            if (!caller) caller = { id: f.callerId, username: "Caller" } as any;
            if (!other) other = { id: f.otherId, username: "User" } as any;

            injectCall(
                f.channelId, caller, other,
                f.missed, f.durationSec,
                new Date(f.timestamp),
                f.snowflakeId,
                f.endedTimestamp
            );
        }
    }
}

function restoreAllFakes() {
    const channelIds = new Set(_persistedFakes.map(f => f.channelId));
    for (const cid of channelIds) {
        restoreChannelFakes(cid);
    }
}

let _unsubscribeOpen: (() => void) | null = null;

function setupRestorationListeners() {
    const handleLoadMessages = (action: any) => {
        if (action.channelId) setTimeout(() => restoreChannelFakes(action.channelId), 50);
    };

    const handleSelectChannel = (action: any) => {
        if (action.channelId) setTimeout(() => restoreChannelFakes(action.channelId), 50);
    };

    const handleConnectionOpen = () => {
        setTimeout(() => restoreAllFakes(), 800);
    };

    FluxDispatcher.subscribe("LOAD_MESSAGES_SUCCESS", handleLoadMessages);
    FluxDispatcher.subscribe("CHANNEL_SELECT", handleSelectChannel);
    FluxDispatcher.subscribe("CONNECTION_OPEN", handleConnectionOpen);

    _unsubscribeOpen = () => {
        FluxDispatcher.unsubscribe("LOAD_MESSAGES_SUCCESS", handleLoadMessages);
        FluxDispatcher.unsubscribe("CHANNEL_SELECT", handleSelectChannel);
        FluxDispatcher.unsubscribe("CONNECTION_OPEN", handleConnectionOpen);
    };

    loadPersisted().then(() => {
        const activeCh = SelectedChannelStore.getChannelId();
        if (activeCh) restoreChannelFakes(activeCh);
    });
}

// ─── Format Utilities ───────────────────────────────────────────────────────
function toLocalDatetimeString(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ─── Sub-Components ─────────────────────────────────────────────────────────
function UserAvatar({ user, size = 22 }: { user: any; size?: number; }) {
    const [hasErr, setHasErr] = React.useState(false);
    if (!user) return null;
    const url = getAvatarUrl(user);
    const name = user.globalName || user.username || "?";

    if (hasErr || !url) {
        return (
            <div className="fakedm-avatar-placeholder" style={{ width: size, height: size }}>
                {name[0]?.toUpperCase()}
            </div>
        );
    }
    return <img src={url} className="fakedm-avatar" style={{ width: size, height: size }} alt="" onError={() => setHasErr(true)} />;
}

// User Picker Component
function UserPicker({ participants, selectedId, onSelect }: { participants: any[]; selectedId: string; onSelect(user: any): void; }) {
    const [query, setQuery] = React.useState("");
    const [isOpen, setIsOpen] = React.useState(false);
    const containerRef = React.useRef<HTMLDivElement>(null);

    const selectedUser = participants.find(p => p.id === selectedId) || UserStore.getUser(selectedId);

    React.useEffect(() => {
        const handleOutsideClick = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleOutsideClick, true);
        return () => document.removeEventListener("mousedown", handleOutsideClick, true);
    }, []);

    const filtered = React.useMemo(() => {
        if (!query.trim()) return participants.slice(0, 10);
        const q = query.toLowerCase().trim();
        return participants.filter(p =>
            p.id.includes(q) ||
            (p.username && p.username.toLowerCase().includes(q)) ||
            (p.globalName && p.globalName.toLowerCase().includes(q))
        ).slice(0, 10);
    }, [participants, query]);

    return (
        <div className="fakedm-picker" ref={containerRef}>
            <input
                type="text"
                className="fakedm-input"
                placeholder={selectedUser ? `${selectedUser.globalName || selectedUser.username} (@${selectedUser.username})` : "Search user or enter User ID..."}
                value={query}
                onChange={e => {
                    setQuery(e.target.value);
                    setIsOpen(true);
                }}
                onFocus={() => setIsOpen(true)}
            />

            {isOpen && (
                <div className="fakedm-dropdown">
                    {filtered.map(user => (
                        <div
                            key={user.id}
                            className="fakedm-dropdown-item"
                            onMouseDown={e => {
                                e.preventDefault();
                                e.stopPropagation();
                                onSelect(user);
                                setQuery("");
                                setIsOpen(false);
                            }}
                        >
                            <UserAvatar user={user} size={24} />
                            <span className="fakedm-user-name">{user.globalName || user.username} (@{user.username})</span>
                        </div>
                    ))}
                    {query.length > 3 && !filtered.length && (
                        <div
                            className="fakedm-dropdown-item"
                            onMouseDown={e => {
                                e.preventDefault();
                                e.stopPropagation();
                                const customUser = { id: query, username: `User_${query.slice(0, 4)}`, globalName: `User (${query.slice(0, 6)})` };
                                onSelect(customUser);
                                setQuery("");
                                setIsOpen(false);
                            }}
                        >
                            Use User ID: {query}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ─── Main Popout Panel ──────────────────────────────────────────────────────
function FakeDMPanel({ onClose, btnRect }: { onClose(): void; btnRect: DOMRect; }) {
    const me = UserStore.getCurrentUser();
    const currentCh = getCurrentChannel();
    const channelId = SelectedChannelStore.getChannelId();
    const participants = getChannelParticipants();

    const otherUser = participants.find(p => p.id !== me?.id) || me;

    const [tab, setTab] = React.useState<"message" | "call" | "history">("message");
    const [sender, setSender] = React.useState<any>(() => me);
    const [caller, setCaller] = React.useState<any>(() => me);
    const [callReceiver, setCallReceiver] = React.useState<any>(() => otherUser);
    const [callMissed, setCallMissed] = React.useState(false);
    const [callDuration, setCallDuration] = React.useState("5");

    const [content, setContent] = React.useState("");
    const [dateStr, setDateStr] = React.useState(() => toLocalDatetimeString(new Date()));
    const [textTimeInput, setTextTimeInput] = React.useState("");
    const [notice, setNotice] = React.useState<{ msg: string; ok: boolean; } | null>(null);

    const textareaRef = React.useRef<HTMLTextAreaElement>(null);
    const noticeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const popoutRef = React.useRef<HTMLDivElement>(null);

    const isModal = btnRect.width === 0 && btnRect.height === 0;

    // Direct DOM Position Tracking - 0 React Re-renders during motion & Guaranteed 100% Release
    const posRef = React.useRef({ x: 0, y: 0, width: 420 });

    React.useLayoutEffect(() => {
        if (isModal) return;
        const PW = 420, PH = 400, margin = 12;
        let x = btnRect.left + btnRect.width / 2 - PW / 2;
        let y = btnRect.top - PH - margin;
        x = Math.max(margin, Math.min(x, window.innerWidth - PW - margin));
        if (y < margin) y = btnRect.bottom + margin;

        posRef.current = { x, y, width: PW };
        if (popoutRef.current) {
            popoutRef.current.style.left = `${x}px`;
            popoutRef.current.style.top = `${y}px`;
        }
    }, [btnRect, isModal]);

    // Hardware-Captured Direct Pointer Dragging
    const handleHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (isModal || !popoutRef.current) return;
        if ((e.target as HTMLElement).closest(".fakedm-close-btn")) return;

        const target = e.currentTarget;
        try { target.setPointerCapture(e.pointerId); } catch { }

        const startMouseX = e.clientX;
        const startMouseY = e.clientY;
        const startX = posRef.current.x;
        const startY = posRef.current.y;
        const { width } = posRef.current;
        const elem = popoutRef.current;

        let currentX = startX;
        let currentY = startY;

        const handlePointerMove = (pe: PointerEvent) => {
            const dx = pe.clientX - startMouseX;
            const dy = pe.clientY - startMouseY;

            currentX = Math.max(10, Math.min(window.innerWidth - width - 10, startX + dx));
            currentY = Math.max(10, Math.min(window.innerHeight - 80, startY + dy));

            elem.style.left = `${currentX}px`;
            elem.style.top = `${currentY}px`;
        };

        const handlePointerUp = (pe: PointerEvent) => {
            try { target.releasePointerCapture(pe.pointerId); } catch { }
            target.removeEventListener("pointermove", handlePointerMove);
            target.removeEventListener("pointerup", handlePointerUp);
            target.removeEventListener("pointercancel", handlePointerUp);

            posRef.current.x = currentX;
            posRef.current.y = currentY;
        };

        target.addEventListener("pointermove", handlePointerMove);
        target.addEventListener("pointerup", handlePointerUp);
        target.addEventListener("pointercancel", handlePointerUp);
    };

    React.useEffect(() => {
        const timer = setTimeout(() => textareaRef.current?.focus(), 80);
        return () => {
            clearTimeout(timer);
            if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
        };
    }, [tab]);

    React.useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", handleKeyDown, true);
        return () => document.removeEventListener("keydown", handleKeyDown, true);
    }, [onClose]);

    function showNotice(msg: string, ok: boolean) {
        setNotice({ msg, ok });
        if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
        noticeTimerRef.current = setTimeout(() => setNotice(null), 2200);
    }

    function applyPreset(offsetMs: number) {
        const target = new Date(Date.now() + offsetMs);
        setDateStr(toLocalDatetimeString(target));
        setTextTimeInput("");
    }

    const parsedCustomDate = React.useMemo(() => {
        if (textTimeInput.trim()) {
            return parseFlexibleDate(textTimeInput);
        }
        const d = new Date(dateStr);
        return isNaN(d.getTime()) ? null : d;
    }, [dateStr, textTimeInput]);

    function getActiveDate(): Date | null {
        return parsedCustomDate;
    }

    function handleSendMessage() {
        if (!content.trim() || !channelId || !sender) return;
        const targetDate = getActiveDate();
        if (!targetDate) {
            showNotice("Invalid Date/Time", false);
            return;
        }
        injectMessage(channelId, sender, content.trim(), targetDate);
        setContent("");
        showNotice("Message injected", true);
        setDateStr(toLocalDatetimeString(new Date(targetDate.getTime() + 60_000)));
        setTextTimeInput("");
        textareaRef.current?.focus();
    }

    function handleSendCall() {
        if (!channelId || !caller || !callReceiver) return;
        const targetDate = getActiveDate();
        if (!targetDate) {
            showNotice("Invalid Date/Time", false);
            return;
        }
        const durSec = callMissed ? 0 : Math.max(1, Math.round((parseFloat(callDuration) || 0) * 60));
        injectCall(channelId, caller, callReceiver, callMissed, durSec, targetDate);
        showNotice(callMissed ? "Missed call injected" : "Call injected", true);
        setDateStr(toLocalDatetimeString(new Date(targetDate.getTime() + 60_000)));
        setTextTimeInput("");
    }

    const activeChannelFakes = React.useMemo(() => {
        return _persistedFakes.filter(f => f.channelId === channelId);
    }, [channelId, notice]);

    const popoutStyle: React.CSSProperties = isModal
        ? { position: "relative", display: "flex", flexDirection: "column" }
        : {
            position: "fixed",
            width: "420px",
            zIndex: 99999,
            display: "flex",
            flexDirection: "column"
        };

    return (
        <>
            {!isModal && <div className="fakedm-backdrop" onClick={onClose} />}
            <div ref={popoutRef} className="fakedm-popout" style={popoutStyle} onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="fakedm-header" onPointerDown={handleHeaderPointerDown}>
                    <div className="fakedm-header-title">
                        FakeDM
                        {currentCh?.name && <span className="fakedm-header-sub">#{currentCh.name}</span>}
                    </div>
                    <button
                        className="fakedm-close-btn"
                        onClick={onClose}
                        onPointerDown={e => e.stopPropagation()}
                        aria-label="Close"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>

                {/* Tabs */}
                <div className="fakedm-tab-bar">
                    <button className={`fakedm-tab ${tab === "message" ? "fakedm-tab--active" : ""}`} onClick={() => setTab("message")}>
                        Messages
                    </button>
                    <button className={`fakedm-tab ${tab === "call" ? "fakedm-tab--active" : ""}`} onClick={() => setTab("call")}>
                        Calls
                    </button>
                    <button className={`fakedm-tab ${tab === "history" ? "fakedm-tab--active" : ""}`} onClick={() => setTab("history")}>
                        Active Fakes {activeChannelFakes.length > 0 && <span className="fakedm-tab-badge">{activeChannelFakes.length}</span>}
                    </button>
                </div>

                {/* Content Area */}
                <div className="fakedm-content">
                    {notice && (
                        <div className={`fakedm-notice ${notice.ok ? "fakedm-notice--success" : "fakedm-notice--error"}`}>
                            {notice.msg}
                        </div>
                    )}

                    {tab === "message" && (
                        <>
                            {/* Author Selection */}
                            <div className="fakedm-form-item">
                                <span className="fakedm-form-label">Author</span>
                                <div className="fakedm-user-toggle">
                                    <button
                                        className={`fakedm-toggle-btn ${sender?.id === me?.id ? "fakedm-toggle-btn--active" : ""}`}
                                        onClick={() => setSender(me)}
                                    >
                                        <UserAvatar user={me} />
                                        <span className="fakedm-user-name">{me?.globalName || me?.username || "Self"}</span>
                                    </button>

                                    {otherUser?.id !== me?.id && (
                                        <button
                                            className={`fakedm-toggle-btn ${sender?.id === otherUser?.id ? "fakedm-toggle-btn--active" : ""}`}
                                            onClick={() => setSender(otherUser)}
                                        >
                                            <UserAvatar user={otherUser} />
                                            <span className="fakedm-user-name">{otherUser?.globalName || otherUser?.username}</span>
                                        </button>
                                    )}
                                </div>

                                <div style={{ marginTop: 4 }}>
                                    <UserPicker
                                        participants={participants}
                                        selectedId={sender?.id || ""}
                                        onSelect={u => setSender(u)}
                                    />
                                </div>
                            </div>

                            {/* Timestamp & Direct Text Time Input */}
                            <div className="fakedm-form-item">
                                <span className="fakedm-form-label">Timestamp</span>
                                <div className="fakedm-date-row">
                                    <input
                                        type="datetime-local"
                                        className="fakedm-date-input"
                                        value={dateStr}
                                        onChange={e => {
                                            setDateStr(e.target.value);
                                            setTextTimeInput("");
                                        }}
                                    />
                                    <div className="fakedm-presets">
                                        <button className="fakedm-preset-btn" onClick={() => applyPreset(0)}>Now</button>
                                        <button className="fakedm-preset-btn" onClick={() => applyPreset(-5 * 60 * 1000)}>-5m</button>
                                        <button className="fakedm-preset-btn" onClick={() => applyPreset(-60 * 60 * 1000)}>-1h</button>
                                    </div>
                                </div>

                                <div className="fakedm-time-text-wrap" style={{ marginTop: 4 }}>
                                    <input
                                        type="text"
                                        className="fakedm-input"
                                        placeholder="Or type time (e.g. 14:30, -10m, -1h, now)..."
                                        value={textTimeInput}
                                        onChange={e => setTextTimeInput(e.target.value)}
                                    />
                                    {parsedCustomDate ? (
                                        <span className="fakedm-time-preview fakedm-time-preview--valid">
                                            Parsed: {parsedCustomDate.toLocaleString()}
                                        </span>
                                    ) : textTimeInput.trim() ? (
                                        <span className="fakedm-time-preview fakedm-time-preview--invalid">
                                            Invalid date string format
                                        </span>
                                    ) : null}
                                </div>
                            </div>

                            {/* Message Text */}
                            <div className="fakedm-form-item">
                                <span className="fakedm-form-label">Message Content</span>
                                <textarea
                                    ref={textareaRef}
                                    className="fakedm-textarea"
                                    rows={3}
                                    placeholder="Enter message content..."
                                    value={content}
                                    onChange={e => setContent(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === "Enter" && !e.shiftKey) {
                                            e.preventDefault();
                                            handleSendMessage();
                                        }
                                    }}
                                />
                                <span className="fakedm-hint">Press Enter to send, Shift+Enter for new line</span>
                            </div>

                            {/* Actions */}
                            <div className="fakedm-actions">
                                <button className="fakedm-btn-primary" disabled={!content.trim() || !parsedCustomDate} onClick={handleSendMessage}>
                                    Inject Message
                                </button>
                                <button
                                    className="fakedm-btn-danger"
                                    onClick={() => {
                                        if (!channelId) return;
                                        const count = clearChannelFakes(channelId);
                                        showNotice(`Cleared ${count} fake(s)`, true);
                                    }}
                                >
                                    Clear Channel
                                </button>
                            </div>
                        </>
                    )}

                    {tab === "call" && (
                        <>
                            <div className="fakedm-form-item">
                                <span className="fakedm-form-label">Caller</span>
                                <UserPicker
                                    participants={participants}
                                    selectedId={caller?.id || ""}
                                    onSelect={u => setCaller(u)}
                                />
                            </div>

                            <div className="fakedm-form-item">
                                <span className="fakedm-form-label">Receiver</span>
                                <UserPicker
                                    participants={participants}
                                    selectedId={callReceiver?.id || ""}
                                    onSelect={u => setCallReceiver(u)}
                                />
                            </div>

                            <div className="fakedm-form-item">
                                <span className="fakedm-form-label">Status</span>
                                <div className="fakedm-call-group">
                                    <button
                                        className={`fakedm-call-btn ${!callMissed ? "fakedm-call-btn--answered" : ""}`}
                                        onClick={() => setCallMissed(false)}
                                    >
                                        Answered
                                    </button>
                                    <button
                                        className={`fakedm-call-btn ${callMissed ? "fakedm-call-btn--missed" : ""}`}
                                        onClick={() => setCallMissed(true)}
                                    >
                                        Missed
                                    </button>
                                </div>
                            </div>

                            {!callMissed && (
                                <div className="fakedm-form-item">
                                    <span className="fakedm-form-label">Duration (minutes)</span>
                                    <input
                                        type="number"
                                        min="1"
                                        step="1"
                                        className="fakedm-input"
                                        value={callDuration}
                                        onChange={e => setCallDuration(e.target.value)}
                                    />
                                </div>
                            )}

                            <div className="fakedm-form-item">
                                <span className="fakedm-form-label">Timestamp</span>
                                <div className="fakedm-date-row">
                                    <input
                                        type="datetime-local"
                                        className="fakedm-date-input"
                                        value={dateStr}
                                        onChange={e => {
                                            setDateStr(e.target.value);
                                            setTextTimeInput("");
                                        }}
                                    />
                                    <div className="fakedm-presets">
                                        <button className="fakedm-preset-btn" onClick={() => applyPreset(0)}>Now</button>
                                        <button className="fakedm-preset-btn" onClick={() => applyPreset(-5 * 60 * 1000)}>-5m</button>
                                    </div>
                                </div>

                                <div className="fakedm-time-text-wrap" style={{ marginTop: 4 }}>
                                    <input
                                        type="text"
                                        className="fakedm-input"
                                        placeholder="Or type time (e.g. 14:30, -10m, -1h, now)..."
                                        value={textTimeInput}
                                        onChange={e => setTextTimeInput(e.target.value)}
                                    />
                                    {parsedCustomDate ? (
                                        <span className="fakedm-time-preview fakedm-time-preview--valid">
                                            Parsed: {parsedCustomDate.toLocaleString()}
                                        </span>
                                    ) : textTimeInput.trim() ? (
                                        <span className="fakedm-time-preview fakedm-time-preview--invalid">
                                            Invalid date string format
                                        </span>
                                    ) : null}
                                </div>
                            </div>

                            <div className="fakedm-actions">
                                <button className="fakedm-btn-primary" disabled={!parsedCustomDate} onClick={handleSendCall}>
                                    Inject Call
                                </button>
                                <button
                                    className="fakedm-btn-danger"
                                    onClick={() => {
                                        if (!channelId) return;
                                        const count = clearChannelFakes(channelId);
                                        showNotice(`Cleared ${count} fake(s)`, true);
                                    }}
                                >
                                    Clear Channel
                                </button>
                            </div>
                        </>
                    )}

                    {tab === "history" && (
                        <div className="fakedm-form-item">
                            <span className="fakedm-form-label">Active Channel Fakes ({activeChannelFakes.length})</span>

                            {!activeChannelFakes.length ? (
                                <div className="fakedm-empty">
                                    No active fake messages or calls in this channel.
                                </div>
                            ) : (
                                <div className="fakedm-list">
                                    {activeChannelFakes.map(fake => {
                                        const user = UserStore.getUser(fake.type === "message" ? fake.authorId : fake.callerId);
                                        const date = new Date(fake.timestamp);
                                        return (
                                            <div key={fake.snowflakeId} className="fakedm-list-item">
                                                <div className="fakedm-list-info">
                                                    <UserAvatar user={user} size={20} />
                                                    <span className="fakedm-list-text">
                                                        {fake.type === "message"
                                                            ? fake.content
                                                            : `Call (${fake.missed ? "Missed" : `${fake.durationSec}s`})`}
                                                    </span>
                                                </div>
                                                <span className="fakedm-list-time">{date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                                                <button
                                                    className="fakedm-list-del"
                                                    title="Delete fake message"
                                                    onClick={() => {
                                                        if (!channelId) return;
                                                        clearSingleFake(channelId, fake.snowflakeId);
                                                        showNotice("Deleted", true);
                                                    }}
                                                >
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                        <polyline points="3 6 5 6 21 6"></polyline>
                                                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                                    </svg>
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {activeChannelFakes.length > 0 && (
                                <div className="fakedm-actions" style={{ marginTop: 8 }}>
                                    <button
                                        className="fakedm-btn-danger"
                                        style={{ width: "100%" }}
                                        onClick={() => {
                                            if (!channelId) return;
                                            const count = clearChannelFakes(channelId);
                                            showNotice(`Cleared ${count} fakes`, true);
                                        }}
                                    >
                                        Clear All Channel Fakes
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}

// ─── SVG Icon ───────────────────────────────────────────────────────────────
function FakeDMIcon({ height = 20, width = 20, className }: any) {
    return (
        <svg className={className} aria-hidden="true" role="img" xmlns="http://www.w3.org/2000/svg" width={width} height={height} fill="none" viewBox="0 0 24 24">
            <path fill="currentColor" d="M15.35 7.24C15.9 6.67 16 5.8 16 5a3 3 0 1 1 3 3c-.8 0-1.67.09-2.24.65a1.5 1.5 0 0 0 0 2.11l.4.4.46.43c.25.25.12.66-.18.84A3 3 0 0 0 16 15v.5a.5.5 0 0 1-.5.5H15c-.43 0-.84.1-1.21.26a.56.56 0 0 1-.63-.1L6.91 9.91 4.3 12.54a1 1 0 0 0 0 1.42l2.17 2.17.83-.84a1 1 0 0 1 1.42 1.42l-.84.83.59.59 1.83-1.84a1 1 0 0 1 1.42 1.42l-1.84 1.83.17.17a1 1 0 0 0 1.42 0c.2-.2.6-.07.69.22a3 3 0 0 0 .56 1c.09.11.09.27-.02.36a3 3 0 0 1-4.06-.16l-5.76-5.76a3 3 0 0 1 0-4.24L6.9 7.09h.01l.97-.97a3 3 0 0 1 4.24 0l1.12 1.12a1.5 1.5 0 0 0 2.1 0Z" />
            <path fill="currentColor" d="M19 14a1 1 0 0 1 1 1v3h3a1 1 0 0 1 0 2h-3v3a1 1 0 0 1-2 0v-3h-3a1 1 0 1 1 0-2h3v-3a1 1 0 0 1 1-1Z" />
        </svg>
    );
}

// ─── Header & Channel Buttons ───────────────────────────────────────────────
function FakeDMHeaderButton() {
    return (
        <HeaderBarButton
            icon={FakeDMIcon}
            tooltip="FakeDM"
            onClick={() => {
                openModal(modalProps => (
                    <ModalRoot {...modalProps}>
                        <ModalHeader>
                            FakeDM
                            <ModalCloseButton onClick={modalProps.onClose} />
                        </ModalHeader>
                        <ModalContent>
                            <FakeDMPanel onClose={modalProps.onClose} btnRect={new DOMRect(0, 0, 0, 0)} />
                        </ModalContent>
                    </ModalRoot>
                ));
            }}
        />
    );
}

function FakeDMChannelButton() {
    return (
        <ChannelToolbarButton
            icon={FakeDMIcon}
            tooltip="FakeDM"
            onClick={() => {
                openModal(modalProps => (
                    <ModalRoot {...modalProps}>
                        <ModalHeader>
                            FakeDM
                            <ModalCloseButton onClick={modalProps.onClose} />
                        </ModalHeader>
                        <ModalContent>
                            <FakeDMPanel onClose={modalProps.onClose} btnRect={new DOMRect(0, 0, 0, 0)} />
                        </ModalContent>
                    </ModalRoot>
                ));
            }}
        />
    );
}

// ─── Chat Bar Button ────────────────────────────────────────────────────────
const FakeDMButton: ChatBarButtonFactory = ({ isMainChat }) => {
    const [btnRect, setBtnRect] = React.useState<DOMRect | null>(null);

    if (!isMainChat || fakeDMSettings.store.location !== "chatbar") return null;

    function handleClick(e: React.MouseEvent) {
        if (btnRect) {
            setBtnRect(null);
        } else {
            const el = (e.currentTarget as HTMLElement).closest("button") ?? e.currentTarget as HTMLElement;
            setBtnRect(el.getBoundingClientRect());
        }
    }

    return (
        <div onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} onMouseUp={e => e.stopPropagation()} style={{ display: "contents" }}>
            <ChatBarButton tooltip="FakeDM" onClick={handleClick}>
                <FakeDMIcon />
            </ChatBarButton>
            {btnRect && ReactDOM.createPortal(
                <FakeDMPanel onClose={() => setBtnRect(null)} btnRect={btnRect} />,
                document.body
            )}
        </div>
    );
};

// ─── Plugin Export ──────────────────────────────────────────────────────────
export default definePlugin({
    name: "FakeDM",
    description: "Injects fake local messages and calls into any channel or DM with persistence across client restarts.",
    tags: ["Chat", "Utility"],
    authors: [{ name: "Testcord", id: 0n }],
    dependencies: ["ChatInputButtonAPI", "HeaderBarAPI"],
    settings: fakeDMSettings,

    chatBarButton: {
        icon: FakeDMIcon,
        render: FakeDMButton,
    },

    start() {
        const { location } = fakeDMSettings.store;
        if (location === "headerbar") {
            addHeaderBarButton("FakeDM", () => <FakeDMHeaderButton />, 5);
        } else if (location === "channeltoolbar") {
            addChannelToolbarButton("FakeDM", () => <FakeDMChannelButton />, 5);
        }
        setupRestorationListeners();
    },

    stop() {
        removeHeaderBarButton("FakeDM");
        removeChannelToolbarButton("FakeDM");
        if (_unsubscribeOpen) {
            _unsubscribeOpen();
            _unsubscribeOpen = null;
        }
        fakeIds.clear();
        _idCounter = 0;
    },
});
