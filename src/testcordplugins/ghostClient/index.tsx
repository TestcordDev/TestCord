/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { DataStore } from "@api/index";
import { UserAreaButton, UserAreaButtonFactory, UserAreaRenderProps } from "@api/UserArea";
import { sleep } from "@utils/misc";
import definePlugin, { PluginNative } from "@utils/types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { React, ReactDOM, Toasts, useEffect, useRef,useState } from "@webpack/common";

const VoiceStateStore = findStoreLazy("VoiceStateStore");
const ChannelStore = findStoreLazy("ChannelStore");
const FluxDispatcher = findByPropsLazy("dispatch", "subscribe");
const UserStore = findStoreLazy("UserStore");

const DS_KEY_TOKENS = "nightcord-ghost-tokens";
const DS_KEY_AUTO_FOLLOW = "nightcord-ghost-autofollow";
const DS_KEY_MIC_DEVICE = "nightcord-ghost-mic-device-label";
const DS_KEY_SELECTED = "nightcord-ghost-selected";

const MI_TOKEN_CACHE_KEY = "nightcord-mi-token-cache";
const TI_ACCOUNTS_KEY = "TokenImporter_accounts";

let ghostMicLabel: string = "default";

const Native = VencordNative.pluginHelpers.GhostClient as PluginNative<typeof import("./native")>;

function GhostIcon({ width = 20, height = 20, className, active }: { width?: number; height?: number; className?: string; active?: boolean }) {
    const lineLength = 30;
    const lineStyle: React.CSSProperties = {
        strokeDasharray: lineLength,
        strokeDashoffset: active ? lineLength : 0,
        transition: "stroke-dashoffset 0.1s ease-in-out",
    };

    return (
        <svg aria-hidden="true" role="img" xmlns="http://www.w3.org/2000/svg" width={width} height={height} className={className} fill="none" viewBox="0 0 24 24">
            <mask id="ghostClientLine">
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

            <g mask="url(#ghostClientLine)">
                <path fill={!active ? "var(--status-danger)" : "currentColor"} d="M16 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM2 20.53A9.53 9.53 0 0 1 11.53 11h.94c1.28 0 2.5.25 3.61.7.41.18.36.77-.05.96a7 7 0 0 0-3.65 8.6c.11.36-.13.74-.5.74H6.15a.5.5 0 0 1-.5-.55l.27-2.6c.02-.26-.27-.37-.41-.16-.48.74-1.03 1.8-1.32 2.9a.53.53 0 0 1-.5.41h-.22C2.66 22 2 21.34 2 20.53Z" />
                <path fill={!active ? "var(--status-danger)" : "currentColor"} d="M24 19a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z" />
            </g>

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
function ChevronIcon() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z" /></svg>; }
function MicIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1a4 4 0 0 0-4 4v7a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4Zm0 17a7 7 0 0 1-7-7H3a9 9 0 0 0 8 8.94V22h2v-2.06A9 9 0 0 0 21 11h-2a7 7 0 0 1-7 7Z" /></svg>; }
function UserIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm-7 8a7 7 0 0 1 14 0H5Z" /></svg>; }
function CheckIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17Z" /></svg>; }
function TrashIcon() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2h4a1 1 0 1 1 0 2h-1.1l-.9 12.1A3 3 0 0 1 17 23H7a3 3 0 0 1-3-2.9L3.1 8H2a1 1 0 0 1 0-2h4V4Zm2 0v2h6V4H9ZM5.1 8l.9 11.9a1 1 0 0 0 1 .1h6a1 1 0 0 0 1-.1L14.9 8H5.1Z" /></svg>; }
function VideoIcon() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M4 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3.3l3.4 2.5A1 1 0 0 0 23 14V9a1 1 0 0 0-1.6-.8L18 10.7V6a2 2 0 0 0-2-2H4Z" /></svg>; }

interface GhostAccount { token: string; userId: string; username: string; avatar: string | null; }
interface GhostState { active: boolean; connecting: boolean; error: string | null; }

const ghostStates = new Map<string, GhostState>();
let ghostListeners: Array<() => void> = [];
let ipcHandlerRegistered = false;
function notify() { ghostListeners.forEach(f => f()); }

function useGhostStates() {
    const [, setTick] = useState(0);
    useEffect(() => {
        const fn = () => setTick(n => n + 1);
        ghostListeners.push(fn);
        return () => { ghostListeners = ghostListeners.filter(f => f !== fn); };
    }, []);
    return new Map(ghostStates);
}

function getMyId() { try { return UserStore?.getCurrentUser?.()?.id ?? ""; } catch { return ""; } }

function getMyVoiceState() {
    try {
        const id = getMyId();
        if (!id) return null;
        const vs = VoiceStateStore?.getVoiceStateForUser?.(id);
        if (vs?.channelId) return { channelId: vs.channelId, guildId: vs.guildId ?? ChannelStore?.getChannel?.(vs.channelId)?.guild_id ?? "" };
        const chId = VoiceStateStore?.getCurrentClientVoiceChannelId?.();
        if (chId) { const ch = ChannelStore?.getChannel?.(chId); return { channelId: chId, guildId: ch?.guild_id ?? "" }; }
    } catch { }
    return null;
}

function avatarUrl(userId: string, avatar: string | null) {
    if (avatar) return `https://cdn.discordapp.com/avatars/${userId}/${avatar}.webp?size=80`;
    try {
        const idNum = userId ? BigInt(userId) : 0n;
        const idx = idNum ? Number(idNum >> 22n) % 6 : 0;
        return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
    } catch {
        return "https://cdn.discordapp.com/embed/avatars/0.png";
    }
}

async function fetchUser(token: string) {
    try {
        const r = await fetch("https://discord.com/api/v10/users/@me", { headers: { "Authorization": token }, signal: AbortSignal.timeout(8000) });
        if (!r.ok) {
            const body = await r.json().catch(() => ({}));
            console.error("[GhostClient] fetchUser error", r.status, body);
            return null;
        }
        const d = await r.json();
        return { userId: d.id, username: d.global_name ?? d.username, avatar: d.avatar ?? null };
    } catch (e: any) { console.error("[GhostClient] fetchUser exception:", e?.message); return null; }
}

async function getAllSavedAccounts(): Promise<GhostAccount[]> {
    // 1. Retrieve accounts specific to GhostAccounts
    const ghostAccs = await DataStore.get<GhostAccount[]>(DS_KEY_TOKENS) ?? [];

    // 2. Retrieve TokenImporter accounts
    const tiAccsRaw = await DataStore.get<any[]>(TI_ACCOUNTS_KEY) ?? [];
    const tiAccs: GhostAccount[] = tiAccsRaw.map(a => ({
        token: a.token,
        userId: a.id,
        username: a.username,
        avatar: a.avatar ? a.avatar.split("/").pop()?.split(".")[0] || null : null // Extract the avatar hash
    }));

    // 3. Merge both lists without duplicates (based on userId)
    const combined = new Map<string, GhostAccount>();
    tiAccs.forEach(a => combined.set(a.userId, a));
    ghostAccs.forEach(a => combined.set(a.userId, a));

    return Array.from(combined.values());
}

let savedAccounts: GhostAccount[] = [];
let preConnectRunning = false;

async function ghostActivate(account: GhostAccount) {
    if (ghostStates.get(account.userId)?.connecting) return;
    ghostStates.set(account.userId, { active: false, connecting: true, error: null });
    notify();
    const vs = getMyVoiceState();
    try {
        // Add a short delay to avoid collisions during mass activations
        await sleep(100);
        const result = await Native.connectGhost(account.userId, account.token, vs?.guildId ?? "", vs?.channelId ?? "", ghostMicLabel);
        if (!result.ok) {
            ghostStates.set(account.userId, { active: false, connecting: false, error: result.error ?? "Error" });
        } else {
            const current = ghostStates.get(account.userId);
            if (current && current.connecting) {
                ghostStates.set(account.userId, { active: true, connecting: false, error: null });
            }
        }
    } catch (e: any) {
        ghostStates.set(account.userId, { active: false, connecting: false, error: String(e) });
    }
    notify();
}

async function ghostDeactivate(userId: string) {
    ghostStates.delete(userId);
    notify();
    // Don't await to not block the UI
    Native.leaveVoice(userId).catch(() => { });
}

async function ghostDeactivateAll() {
    const ids = Array.from(ghostStates.keys());
    // Clear local state IMMEDIATELY so the UI is clean
    ghostStates.clear();
    notify();

    // Clean disconnection in waves to not overload the ghost-server
    (async () => {
        for (let i = 0; i < ids.length; i++) {
            Native.leaveVoice(ids[i]).catch(() => { });
            // Progressive delay: the more accounts, the more spacing to let the server breathe
            if (i % 3 === 0) await sleep(150);
        }
        // Final safety call to ensure EVERYTHING is cut server-side
        Native.leaveVoiceAll(ids).catch(() => { });
    })();
}

let voiceUnsub: (() => void) | null = null;
let globalAutoFollow = false;
let myLastChannelId: string | null = null;

function startFollowing() {
    if (voiceUnsub) return;
    globalAutoFollow = true;
    myLastChannelId = getMyVoiceState()?.channelId ?? null;
    console.log("[GhostClient] Voice tracking active, current channel:", myLastChannelId);

    const handler = async (data: any) => {
        if (!data) return;
        const myId = getMyId();
        let statesList: any[] = [];
        try {
            if (data?.voiceStates != null) {
                statesList = Array.isArray(data.voiceStates) ? data.voiceStates : Array.from(data.voiceStates as any);
            } else if (data?.userId != null) {
                statesList = [data];
            }
        } catch { statesList = []; }

        for (const s of statesList) {
            if (s.userId !== myId) continue;
            const newCh: string | null = s.channelId ?? null;
            if (newCh === myLastChannelId) continue;
            myLastChannelId = newCh;
            const guild: string = s.guildId ?? (newCh ? ChannelStore?.getChannel?.(newCh)?.guild_id ?? "" : "");
            const accounts: GhostAccount[] = savedAccounts.length > 0
                ? savedAccounts
                : (await DataStore.get(DS_KEY_TOKENS) as GhostAccount[] | null ?? []);
            if (savedAccounts.length === 0 && accounts.length > 0) savedAccounts = accounts;
            const activeAccs = accounts.filter(a => {
                const st = ghostStates.get(a.userId);
                return st?.active === true;
            });
            console.log(`[GhostClient] Voice tracking: newCh=${newCh} guild=${guild} actives=${activeAccs.length}`);
            if (activeAccs.length === 0) continue;
            if (newCh) {
                Native.joinVoiceAll(activeAccs.map(a => a.userId), guild, newCh, ghostMicLabel).catch(() => { });
            } else {
                Native.leaveVoiceAll(activeAccs.map(a => a.userId)).catch(() => { });
            }
        }
    };

    FluxDispatcher?.subscribe?.("VOICE_STATE_UPDATES", handler);
    FluxDispatcher?.subscribe?.("VOICE_STATE_UPDATE", handler);
    voiceUnsub = () => {
        FluxDispatcher?.unsubscribe?.("VOICE_STATE_UPDATES", handler);
        FluxDispatcher?.unsubscribe?.("VOICE_STATE_UPDATE", handler);
        myLastChannelId = null;
    };
}
function stopFollowing() { globalAutoFollow = false; voiceUnsub?.(); voiceUnsub = null; }

// Dropdown with lazy loading of devices
function Dropdown({ icon, label, value, options, onChange }: {
    icon: React.ReactNode; label: string; value: string;
    options: Array<{ value: string; label: string; avatar?: string | null; userId?: string; }>;
    onChange: (v: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const [listStyle, setListStyle] = useState<React.CSSProperties>({});
    const btnRef = useRef<HTMLButtonElement>(null);
    const selected = options.find(o => o.value === value);

    useEffect(() => {
        const h = (e: MouseEvent) => {
            const t = e.target as HTMLElement;
            // Safety: check if the element still exists before checking its classes
            if (!t || !document.body.contains(t)) return;
            if (!t.closest(".gc-dropdown-wrap") && !t.closest(".gc-dropdown-list")) {
                setOpen(false);
            }
        };
        if (open) {
            // Use a timeout to avoid immediate trigger on the opening click
            const timer = setTimeout(() => document.addEventListener("mousedown", h), 10);
            return () => { clearTimeout(timer); document.removeEventListener("mousedown", h); };
        }
    }, [open]);

    function openDropdown(e: React.MouseEvent) {
        e.preventDefault();
        e.stopPropagation();
        if (!btnRef.current) { setOpen(v => !v); return; }
        const rect = btnRef.current.getBoundingClientRect();
        // ... (rest of code unchanged)
        const listH = Math.min(200, options.length * 40);
        const spaceBelow = window.innerHeight - rect.bottom - 8;
        const spaceAbove = rect.top - 8;
        let top: number;
        if (spaceBelow >= listH || spaceBelow >= spaceAbove) {
            top = rect.bottom + 4;
        } else {
            top = rect.top - listH - 4;
        }
        top = Math.max(8, Math.min(top, window.innerHeight - listH - 8));
        setListStyle({ top, left: rect.left, width: rect.width });
        setOpen(v => !v);
    }

    return (
        <div className="gc-dropdown-wrap">
            <div className="gc-dropdown-label">{icon}<span>{label}</span></div>
            <button ref={btnRef} className={`gc-dropdown-btn ${open ? "gc-dropdown-btn--open" : ""}`} onClick={e => openDropdown(e)}>
                <div className="gc-dropdown-selected">
                    {selected?.avatar !== undefined && (selected.avatar
                        ? <img src={avatarUrl(selected.userId!, selected.avatar)} className="gc-dropdown-avatar" alt="" />
                        : <div className="gc-dropdown-avatar-placeholder">{selected.label[0]?.toUpperCase()}</div>)}
                    <span className="gc-dropdown-selected-label">{selected?.label ?? "—"}</span>
                </div>
                <ChevronIcon />
            </button>
            {open && (
                <div className="gc-dropdown-list" style={listStyle}>
                    {options.map(opt => (
                        <div key={opt.value} className={`gc-dropdown-item ${opt.value === value ? "gc-dropdown-item--selected" : ""}`}
                            onMouseDown={e => { e.preventDefault(); onChange(opt.value); setOpen(false); }}>
                            {opt.avatar !== undefined && (opt.avatar
                                ? <img src={avatarUrl(opt.userId!, opt.avatar)} className="gc-dropdown-avatar" alt="" />
                                : <div className="gc-dropdown-avatar-placeholder">{opt.label[0]?.toUpperCase()}</div>)}
                            <span className="gc-dropdown-item-label">{opt.label}</span>
                            {opt.value === value && <span className="gc-dropdown-check"><CheckIcon /></span>}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// FIX infinite streaming: /stream-status polling hook
// /stream-start now responds immediately (resolving: true).
// This hook polls the state every 800ms until the stream is active or in error.
// The UI displays a real-time progress message without ever blocking.
function useStreamPoller(userId: string | null, active: boolean) {
    const [status, setStatus] = useState<string | null>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        if (!active || !userId) {
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
            return;
        }
        let cancelled = false;

        pollRef.current = setInterval(async () => {
            try {
                const r = await fetch("http://127.0.0.1:47821/stream-status", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ userId }),
                });
                const d = await r.json();
                if (cancelled) return;
                if (d.state === "resolving") setStatus("🔍 Resolving URL...");
                else if (d.state === "starting") setStatus("⏳ Starting stream...");
                else if (d.state === "active") {
                    setStatus("🎥 Stream active");
                    // Stop polling once active
                    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
                } else if (d.state === "error") {
                    setStatus("❌ Error: " + (d.error ?? "unknown"));
                    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
                } else if (d.state === "idle") {
                    // Stream ended
                    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
                }
            } catch {
                // ghost-server temporarily unavailable — keep polling
            }
        }, 800);

        return () => {
            cancelled = true;
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        };
    }, [userId, active]);

    return [status, setStatus] as const;
}

function GhostPopover({ onClose, anchorRect }: { onClose: () => void; anchorRect: DOMRect | null; }) {
    const [accounts, setAccounts] = useState<GhostAccount[]>([]);
    const [selectedId, setSelectedId] = useState<string>("all");
    const [tokenInput, setTokenInput] = useState("");
    const [adding, setAdding] = useState(false);
    const [autoFollow, setAutoFollowState] = useState(globalAutoFollow);
    const [micLabel, setMicLabel] = useState(ghostMicLabel);
    const [dshowDevices, setDshowDevices] = useState<string[]>([]);
    const [streamingUserId, setStreamingUserId] = useState<string | null>(null);
    const [streamInput, setStreamInput] = useState("");
    const [isPolling, setIsPolling] = useState(false);
    // FIX: streamStatus and polling separated — setStreamStatus can write an instant message,
    // polling takes over once /stream-start has responded
    const [streamStatus, setStreamStatusDirect] = useState<string | null>(null);
    const [pollStatus, setPollStatus] = useStreamPoller(streamingUserId, isPolling);
    const states = useGhostStates();
    const popoverRef = useRef<HTMLDivElement>(null);
    const mountedRef = useRef(true);

    // The displayed status is either the direct one (during initial request) or the poll
    const displayStatus = isPolling ? pollStatus : streamStatus;

    function setStreamStatus(msg: string | null) {
        setStreamStatusDirect(msg);
        if (!msg) setPollStatus(null);
    }

    const style = React.useMemo<React.CSSProperties>(() => {
        if (!anchorRect) return { position: "fixed", bottom: 80, left: 8, zIndex: 2147483647 };
        const PW = 320, PH = 560;
        const margin = 8;
        let { left } = anchorRect;
        let top = anchorRect.top - PH - 8;
        if (top < margin) top = anchorRect.bottom + 8;
        if (top + PH > window.innerHeight - margin) top = window.innerHeight - PH - margin;
        if (left + PW > window.innerWidth - margin) left = window.innerWidth - PW - margin;
        if (left < margin) left = margin;
        return { position: "fixed", top, left, zIndex: 2147483647 };
    }, [anchorRect]);

    useEffect(() => {
        getAllSavedAccounts().then(v => {
            if (!mountedRef.current) return;
            setAccounts(v);
            savedAccounts = v;
        });

        // Auto-follow enabled by default (true if no value yet in DataStore)
        DataStore.get(DS_KEY_AUTO_FOLLOW).then((v: boolean | null) => {
            if (!mountedRef.current) return;
            const shouldFollow = v ?? true;
            setAutoFollowState(shouldFollow);
            if (shouldFollow) startFollowing();
        });

        DataStore.get(DS_KEY_SELECTED).then((v: string | null) => { if (mountedRef.current && v) setSelectedId(v); });

        // Smart auto-selection of virtual cable on VERY FIRST launch
        Native.listAudioInputDevices().catch(() => []).then(async (devs: any[]) => {
            const names = (devs as any[])?.map((d: any) => d.dshowName ?? d.name ?? d.label ?? "").filter(Boolean) ?? [];
            if (!mountedRef.current) return;
            if (names.length) {
                setDshowDevices(names);

                const savedMic = await DataStore.get(DS_KEY_MIC_DEVICE);
                if (!mountedRef.current) return;
                // If the user has NEVER chosen a mic (first time)
                if (savedMic === null || savedMic === undefined) {
                    const virtualMic = names.find(n =>
                        n.toLowerCase().includes("cable output") ||
                        n.toLowerCase().includes("vb-audio virtual cable")
                    );
                    if (virtualMic) {
                        setMicLabel(virtualMic);
                        ghostMicLabel = virtualMic;
                        DataStore.set(DS_KEY_MIC_DEVICE, virtualMic);
                        console.log("[GhostClient] First launch: Virtual cable detected and selected by default.");
                    }
                } else {
                    // Otherwise we strictly respect the user's choice
                    setMicLabel(savedMic as string);
                    ghostMicLabel = savedMic as string;
                    console.log("[GhostClient] Loading user's preferred mic:", savedMic);
                }
            }
        }).catch(() => { });

        return () => { mountedRef.current = false; };
    }, []);

    async function saveAccounts(next: GhostAccount[]) {
        if (mountedRef.current) setAccounts(next);
        savedAccounts = next;
        await DataStore.set(DS_KEY_TOKENS, next);
    }

    async function addAccount() {
        const raw = tokenInput.trim();
        if (!raw) return;
        setAdding(true);
        const tokens = raw.split(/[\r\n]+/).map((t: string) => t.trim()).filter(Boolean);
        let added = 0, failed = 0, updated = [...accounts];
        for (const token of tokens) {
            const info = await fetchUser(token);
            if (!mountedRef.current) return;
            if (!info) { failed++; continue; }
            updated = [...updated.filter(a => a.userId !== info.userId), { ...info, token }];
            added++;
        }
        if (added > 0) {
            await saveAccounts(updated);
            if (!mountedRef.current) return;
            Toasts.show({ message: `${added} account${added > 1 ? "s" : ""} added${failed > 0 ? `, ${failed} failed` : ""}`, type: Toasts.Type.SUCCESS, id: Toasts.genId() });
        } else {
            Toasts.show({ message: `All tokens invalid (${failed})`, type: Toasts.Type.FAILURE, id: Toasts.genId() });
        }
        setTokenInput(""); setAdding(false);
    }

    function toggleAutoFollow(v: boolean) {
        setAutoFollowState(v);
        DataStore.set(DS_KEY_AUTO_FOLLOW, v);
        if (v) startFollowing(); else stopFollowing();
    }

    // FIX infinite streaming: startStream sends /stream-start and returns IMMEDIATELY.
    // The server responds { ok: true, resolving: true } in < 5ms.
    // The useStreamPoller polling takes over and displays progress.
    async function startStream(url: string, userId: string) {
        if (!url.trim()) return;
        setStreamStatus("Sending request...");
        setIsPolling(false);
        try {
            const r = await fetch("http://127.0.0.1:47821/stream-start", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId, url: url.trim() }),
                signal: AbortSignal.timeout(5000), // short timeout — the server now responds immediately
            });
            const d = await r.json();
            if (!mountedRef.current) return;
            if (!d.ok) {
                setStreamStatus("❌ Error: " + (d.error ?? "unknown"));
                setIsPolling(false);
            } else {
                // The server accepted the request and is processing in the background
                // Switch to polling mode to track the state
                setStreamStatusDirect(null);
                setIsPolling(true);
            }
        } catch (e: any) {
            if (!mountedRef.current) return;
            setStreamStatus("❌ ghost-server unreachable: " + (e?.message ?? String(e)));
            setIsPolling(false);
        }
    }

    const accountOptions = [
        { value: "all", label: "All accounts", avatar: undefined },
        ...accounts.map(a => ({ value: a.userId, label: a.username, avatar: a.avatar, userId: a.userId }))
    ];
    const micOptions = [
        { value: "default", label: "Default mic" },
        ...dshowDevices.map(d => ({ value: d, label: d }))
    ];

    return (
        <div ref={popoverRef} className="gc-popover" style={style}>
            <div className="gc-popover-header">
                <GhostIcon width={16} height={16} />
                <span className="gc-popover-title">Ghost Accounts</span>
                <button className="gc-popover-close" onClick={onClose}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /></svg>
                </button>
            </div>
            <div className="gc-popover-body">
                <Dropdown icon={<UserIcon />} label="Active account" value={selectedId} options={accountOptions}
                    onChange={v => {
                        if (v !== "all" && v === getMyId()) {
                            Toasts.show({ message: "You cannot use your own account as a ghost!", type: Toasts.Type.FAILURE, id: Toasts.genId() });
                            return;
                        }
                        setSelectedId(v);
                        DataStore.set(DS_KEY_SELECTED, v);
                    }} />
                <Dropdown icon={<MicIcon />} label="Source mic" value={micLabel} options={micOptions}
                    onChange={v => { setMicLabel(v); ghostMicLabel = v; DataStore.set(DS_KEY_MIC_DEVICE, v); }} />
                <div className="gc-popover-divider" />
                <div className="gc-follow-row" onClick={() => toggleAutoFollow(!autoFollow)}>
                    <div className="gc-follow-info">
                        <span className="gc-follow-title">Automatic voice tracking</span>
                        <span className="gc-follow-sub">Ghosts join your channel in real time</span>
                    </div>
                    <div className={`gc-toggle ${autoFollow ? "gc-toggle--on" : ""}`}><div className="gc-toggle-thumb" /></div>
                </div>
                <div className="gc-popover-divider" />
                <div className="gc-section-label">Accounts (Native + Imported)</div>
                <div className="gc-accounts" style={{ maxHeight: 160, overflowY: "auto", scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.15) rgba(255,255,255,0.04)" }}>
                    {accounts.length === 0 && <div className="gc-empty">No accounts — add a token below</div>}
                    {accounts.map(acc => {
                        const state = states.get(acc.userId);
                        const isActive = state?.active === true;
                        const isConnecting = state?.connecting === true;
                        const isStreaming = streamingUserId === acc.userId;
                        return (
                            <div key={acc.userId} className={`gc-account ${isActive ? "gc-account--on" : ""}`}>
                                <div className="gc-account-left">
                                    <div className="gc-avatar-wrap">
                                        <img src={avatarUrl(acc.userId, acc.avatar)} className="gc-avatar" alt="" />
                                        <div className={`gc-status-dot ${isStreaming ? "gc-dot--stream" : isActive ? "gc-dot--voice" : isConnecting ? "gc-dot--connecting" : "gc-dot--off"}`} />
                                    </div>
                                    <div className="gc-account-info">
                                        <span className="gc-account-name">{acc.username}</span>
                                        <span className="gc-account-status">
                                            {isConnecting ? "⏳ Connecting to voice..." : isStreaming ? "🎥 Stream active" : isActive ? "✅ Active · In voice" : state?.error ? "❌ " + state.error.slice(0, 35) : "⚪ Disconnected"}
                                        </span>
                                    </div>
                                </div>
                                <div className="gc-account-actions">
                                    {isActive && (
                                        <button
                                            className={`gc-btn-video ${isStreaming ? "gc-btn-video--on" : ""}`}
                                            title={isStreaming ? "Stop stream" : "Start video stream"}
                                            onClick={async () => {
                                                if (isStreaming) {
                                                    setIsPolling(false);
                                                    setStreamStatus("Stopping...");
                                                    await fetch("http://127.0.0.1:47821/stream-stop", {
                                                        method: "POST",
                                                        headers: { "Content-Type": "application/json" },
                                                        body: JSON.stringify({ userId: acc.userId }),
                                                    }).catch(() => { });
                                                    setStreamingUserId(null);
                                                    setStreamStatus(null);
                                                } else {
                                                    setStreamingUserId(acc.userId);
                                                    setStreamInput("");
                                                    setStreamStatus(null);
                                                    setIsPolling(false);
                                                }
                                            }}
                                        >
                                            <VideoIcon />
                                        </button>
                                    )}
                                    <button className="gc-btn-del" onClick={async () => { await ghostDeactivate(acc.userId); await saveAccounts(accounts.filter(a => a.userId !== acc.userId)); }}>
                                        <TrashIcon />
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Video stream panel — FIX: uses non-blocking startStream() + polling */}
                {streamingUserId && (() => {
                    const acc = accounts.find(a => a.userId === streamingUserId);
                    if (!acc) return null;
                    return (
                        <div style={{ padding: "8px 12px", borderTop: "1px solid rgba(255,255,255,0.07)", display: "flex", flexDirection: "column" as const, gap: 6 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)", textTransform: "uppercase" as const, letterSpacing: ".06em" }}>
                                🎥 Stream for {acc.username}
                            </div>
                            <div style={{ display: "flex", gap: 6 }}>
                                <input
                                    className="gc-input"
                                    style={{ flex: 1, fontSize: 12, fontFamily: "monospace" }}
                                    placeholder="YouTube, MP4, M3U8..."
                                    value={streamInput}
                                    onChange={e => setStreamInput(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === "Enter" && streamInput.trim()) {
                                            startStream(streamInput, streamingUserId);
                                        }
                                    }}
                                />
                                <button
                                    className="gc-add-btn"
                                    style={{ padding: "4px 10px", fontSize: 12, whiteSpace: "nowrap" }}
                                    disabled={!streamInput.trim() || isPolling}
                                    onClick={() => startStream(streamInput, streamingUserId)}
                                >
                                    {isPolling ? "⏳" : "Start"}
                                </button>
                                <button
                                    style={{ background: "rgba(237,66,69,.1)", border: "none", borderRadius: 6, color: "#ed4245", padding: "4px 8px", cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}
                                    onClick={() => { setStreamingUserId(null); setIsPolling(false); setStreamStatus(null); }}
                                >✕</button>
                            </div>
                            {displayStatus && (
                                <div style={{ fontSize: 11, color: displayStatus.startsWith("❌") ? "#ed4245" : displayStatus.startsWith("🎥") ? "#3ba55c" : "rgba(255,255,255,0.6)" }}>
                                    {displayStatus}
                                </div>
                            )}
                            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.28)" }}>YouTube, MP4 direct, M3U8, Twitch… (requires yt-dlp)</div>
                        </div>
                    );
                })()}

                <div className="gc-section-label" style={{ marginTop: 4 }}>Add one or more accounts</div>
                <div className="gc-add-row" style={{ flexDirection: "column" as const, gap: 6 }}>
                    <textarea className="gc-input"
                        placeholder="Discord Token... (one per line to add multiple)"
                        value={tokenInput}
                        rows={2}
                        style={{ resize: "none", fontFamily: "monospace", fontSize: 11 }}
                        onChange={e => setTokenInput(e.target.value)} />
                    <button className="gc-add-btn" style={{ width: "100%" }} onClick={addAccount} disabled={adding || !tokenInput.trim()}>
                        {adding ? "Adding..." : "Add"}
                    </button>
                </div>
                <div className="gc-note">Use a secondary account — selfbots are against Discord TOS.</div>
            </div>
        </div>
    );
}

const GhostUserAreaButton: UserAreaButtonFactory = ({ iconForeground, hideTooltips, nameplate }: UserAreaRenderProps) => {
    const states = useGhostStates();
    const [showPopover, setShowPopover] = useState(false);
    const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
    const btnRef = useRef<HTMLDivElement>(null);

    const anyActive = Array.from(states.values()).some(s => s.active || s.connecting);

    useEffect(() => {
        if (!showPopover) return;
        const handler = (e: MouseEvent) => {
            const t = e.target as HTMLElement;
            if (t.closest(".gc-popover")) return;
            if (btnRef.current?.contains(t)) return;
            setShowPopover(false);
        };
        const timer = setTimeout(() => document.addEventListener("mousedown", handler), 50);
        return () => { clearTimeout(timer); document.removeEventListener("mousedown", handler); };
    }, [showPopover]);

    async function handleLeftClick() {
        // Get ALL accounts (Native + Imported) for left click
        const storedAccounts = await getAllSavedAccounts();
        const storedSelected = await DataStore.get(DS_KEY_SELECTED) as string | null ?? "all";
        const myId = getMyId();

        // ALWAYS filter our own account to avoid disconnections
        const filteredAccounts = storedAccounts.filter(a => a.userId !== myId);
        const targets = storedSelected === "all" ? filteredAccounts : filteredAccounts.filter(a => a.userId === storedSelected);

        if (targets.length === 0) {
            if (storedSelected !== "all" && storedSelected === myId) {
                Toasts.show({ message: "You cannot connect your own account as a ghost", type: Toasts.Type.FAILURE, id: Toasts.genId() });
            }
            openPopover();
            return;
        }

        const vs = getMyVoiceState();
        const anyActive = targets.some(a => ghostStates.get(a.userId)?.active || ghostStates.get(a.userId)?.connecting);

        if (anyActive) {
            await ghostDeactivateAll();
        } else {
            if (!vs?.channelId) {
                Toasts.show({ message: "Join a voice channel first", type: Toasts.Type.FAILURE, id: Toasts.genId() });
                return;
            }
            for (const acc of targets) {
                ghostStates.set(acc.userId, { active: false, connecting: true, error: null });
            }
            notify();
            // Parallel connection
            await Promise.all(targets.map(async acc => {
                ghostStates.set(acc.userId, { active: false, connecting: true, error: null });
                notify();
                try {
                    const result = await Native.connectGhost(acc.userId, acc.token, vs.guildId, vs.channelId, ghostMicLabel);
                    ghostStates.set(acc.userId, { active: result.ok, connecting: false, error: result.ok ? null : (result.error ?? "Error") });
                } catch (e: any) {
                    ghostStates.set(acc.userId, { active: false, connecting: false, error: String(e) });
                }
                notify();
            }));
        }
    }

    function openPopover() {
        const rect = btnRef.current?.getBoundingClientRect() ?? null;
        setAnchorRect(rect);
        setShowPopover(v => !v);
    }

    return (
        <div ref={btnRef} style={{ position: "relative" }}>
            <UserAreaButton
                tooltipText={hideTooltips ? undefined : "Ghost Accounts — left click: toggle | right click: config"}
                icon={<GhostIcon className={`${iconForeground} ${anyActive ? "gc-icon--active" : ""}`} active={anyActive} />}
                plated={nameplate != null}
                redGlow={!anyActive}
                onClick={handleLeftClick}
                onContextMenu={e => { e.preventDefault(); e.stopPropagation(); openPopover(); }}
            />
            {showPopover && (ReactDOM as any).createPortal(
                <GhostPopover
                    onClose={() => setShowPopover(false)}
                    anchorRect={anchorRect}
                />,
                document.body
            )}
        </div>
    );
};

export default definePlugin({
    name: "GhostClient",
    description: "Discord ghost accounts — left-click to enable/disable, right-click to configure.",
    tags: ["Privacy", "Voice", "Nightcord"],
    authors: [{ name: "Nightcord", id: 0n }],
    userAreaButton: { icon: GhostIcon, render: GhostUserAreaButton, priority: 1 },

    async start() {
        preConnectRunning = true;
        const autoFollow = await DataStore.get(DS_KEY_AUTO_FOLLOW);
        if (!preConnectRunning) return;
        if (autoFollow === true) startFollowing();
        const mic = await DataStore.get(DS_KEY_MIC_DEVICE);
        if (!preConnectRunning) return;
        if (mic) ghostMicLabel = mic;
        const allAccs = await getAllSavedAccounts();
        if (!preConnectRunning) return;
        if (allAccs.length > 0) savedAccounts = allAccs;

        this._preConnectTimer = setTimeout(() => {
            this._preConnectTimer = null;
            if (!preConnectRunning) return;
            Native.init().catch(() => { });

            (async () => {
                if (!preConnectRunning || savedAccounts.length === 0) return;
                console.log("[GhostClient] Pre-connecting", savedAccounts.length, "account(s)...");
                for (const acc of savedAccounts) {
                    if (!preConnectRunning) return;
                    Native.preConnectGhost(acc.userId, acc.token, ghostMicLabel)
                        .then(r => console.log("[GhostClient] Pre-connected:", acc.username, r?.ok))
                        .catch(() => { });
                    await sleep(800);
                }
            })();
        }, 10000);

        // Register the IPC disconnect listener only once for the lifetime of the
        // module. VencordNative.ipc does not currently exist in this build, so the
        // guard keeps this future-proof: if a build ever exposes ipc.on, the
        // handler still cannot stack across enable/disable cycles.
        try {
            const ipc = (VencordNative as any)?.ipc;
            if (!ipcHandlerRegistered && typeof ipc?.on === "function") {
                ipcHandlerRegistered = true;
                ipc.on("ghost-client-disconnected", (_: any, userId: string, code: number, reason: string) => {
                    console.error(`[GhostClient] ${userId} forcefully disconnected (code=${code} reason=${reason})`);
                    ghostStates.set(userId, { active: false, connecting: false, error: `Disconnected (${code})` });
                    notify();
                });
            }
        } catch (e: any) {
            console.warn("[GhostClient] ipc.on not available:", e?.message);
        }
    },

    _preConnectTimer: null as ReturnType<typeof setTimeout> | null,

    stop() {
        preConnectRunning = false;
        if (this._preConnectTimer) {
            clearTimeout(this._preConnectTimer);
            this._preConnectTimer = null;
        }
        stopFollowing();
        const ids = Array.from(ghostStates.keys());
        ghostStates.clear();
        notify();
        (ids.length ? Native.leaveVoiceAll(ids) : Promise.resolve()).finally(() => Native.stop().catch(() => { }));
    },
});
