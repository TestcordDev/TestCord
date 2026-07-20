/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addContextMenuPatch, NavContextMenuPatchCallback, removeContextMenuPatch } from "@api/ContextMenu";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { findByProps } from "@webpack";
import { Button, GuildChannelStore, GuildMemberStore, GuildRoleStore, GuildStore, Menu, React, Select, TextArea } from "@webpack/common";

// ─── Global State ──────────────────────────────────────────────────────────────
// isEnabled is the SINGLE source of truth — read from DataStore at start()
// Context menu patches are always registered, they check isEnabled at runtime
let isEnabled = false;

let domInterval: ReturnType<typeof setInterval> | null = null;
let domTimer: ReturnType<typeof setTimeout> | null = null;
let pluginSelf: { applyDomOverrides: () => void; } | null = null;

function ensureDomObserver() {
    if (domInterval || !isEnabled || typeof document === "undefined") return;
    domInterval = setInterval(() => {
        if (!isEnabled) return;
        if (fakeNicks.size === 0 && disconnectedUsers.size === 0 && kickedUsers.size === 0) return;
        if (domTimer) return;
        domTimer = setTimeout(() => { domTimer = null; if (isEnabled) pluginSelf?.applyDomOverrides(); }, 150);
    }, 3000);
}

function destroyDomObserver() {
    if (domInterval) { clearInterval(domInterval); domInterval = null; }
    if (domTimer) { clearTimeout(domTimer); domTimer = null; }
}

const DS_KEY = "FakePerm.options.enabled"; // Standard Equicord key for plugin options

// injectHideStyle / removeHideStyle removed — caused display bugs
// by hiding Discord elements via too broad CSS selectors (roles, permissions, copy-user-id)
// which made some rooms invisible. Complete removal.
function injectHideStyle() { /* intentionally removed */ }
function removeHideStyle() { /* intentionally removed */ }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fpHide(el: HTMLElement) {
    el.style.display = "none";
    el.setAttribute("data-fp-hidden", "true");
}

const mutedUsers = new Map<string, boolean>();
const deafenedUsers = new Map<string, boolean>();
const fakeNicks = new Map<string, string>();
const disconnectedUsers = new Set<string>();
const kickedUsers = new Set<string>();
const bannedUsers = new Set<string>();
const deletedMessages = new Set<string>();

let badgeVersion = 0;
const badgeListeners = new Set<() => void>();
function notifyBadgeChange() { badgeVersion++; badgeListeners.forEach(fn => fn()); }

function getCurrentGuildId(): string | null {
    try { return (findByProps("getGuildId", "getLastSelectedGuildId") as any)?.getGuildId?.() ?? null; } catch { return null; }
}

function notifyMemberListChange() {
    // Absolute guard: never call if FakePerm is disabled
    if (!isEnabled) return;
    try {
        // Critical guard: never dispatch GUILD_MEMBER_LIST_UPDATE with empty or null guildId.
        // An empty guildId ("") sent to Discord corrupts the internal state of GuildChannelStore
        // and causes all rooms to disappear on servers with permissions.
        const guildId = getCurrentGuildId();
        if (!guildId) return;

        // Additional verification: we only dispatch if the user is in
        // a voice channel of the current server. Outside voice, this dispatch is useless
        // and can corrupt the channel permissions state (invisible channels).
        const FluxDispatcher = findByProps("dispatch", "subscribe") as any;
        const voiceStates = findByProps("getVoiceStatesForChannel", "getVoiceStateForUser") as any;
        const myId = (() => { try { return (findByProps("getCurrentUser") as any)?.getCurrentUser?.()?.id ?? null; } catch { return null; } })();
        if (myId) {
            const myVS = voiceStates?.getVoiceStateForUser?.(myId);
            // Only dispatch if we are in voice in this server
            if (!myVS || myVS.guildId !== guildId) return;
        }

        FluxDispatcher?.dispatch?.({ type: "GUILD_MEMBER_LIST_UPDATE", ops: [], id: "everyone", guildId });
    } catch { }
}

function isDateSeparatorEl(el: HTMLElement): boolean {
    if (el.querySelector("article")) return false;
    return !!el.querySelector("[class*='divider'], [class*='Divider'], [class*='separator'], [class*='Separator'], [class*='unreadPill']");
}

function hideMessageInDOM(messageId: string) {
    let msgEl: HTMLElement | null =
        document.querySelector(`[id$="-${messageId}"]`) ??
        document.querySelector(`[data-list-item-id$="${messageId}"]`);
    if (!msgEl) {
        for (const li of document.querySelectorAll("ol[data-list-id='chat-messages'] > li")) {
            if ((li as HTMLElement).id.includes(messageId)) { msgEl = li as HTMLElement; break; }
        }
    }
    if (!msgEl) return;
    fpHide(msgEl);
    setTimeout(() => {
        const parent = msgEl!.parentElement;
        if (!parent) return;
        const items = Array.from(parent.children) as HTMLElement[];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.getAttribute("data-fp-hidden") === "true") continue;
            if (!isDateSeparatorEl(item)) continue;
            let hasVisible = false;
            for (let j = i + 1; j < items.length; j++) {
                if (isDateSeparatorEl(items[j])) break;
                if (items[j].getAttribute("data-fp-hidden") !== "true") { hasVisible = true; break; }
            }
            if (!hasVisible) fpHide(item);
        }
    }, 20);
}

function getGuild(guildId: string | null) {
    if (!guildId) return null;
    try { return (GuildStore as any)?.getGuild?.(guildId) ?? null; } catch { return null; }
}

function getMember(guildId: string | null, userId: string) {
    if (!guildId) return null;
    try { return (findByProps("getMember", "getMembers") as any)?.getMember?.(guildId, userId) ?? null; } catch { return null; }
}

function isUserInVoice(userId: string, guildId: string | null): boolean {
    if (!guildId) return false;
    try { const vs = (findByProps("getVoiceStateForUser") as any)?.getVoiceStateForUser?.(userId); return !!(vs && vs.guildId === guildId && vs.channelId); } catch { return false; }
}

function getVoiceChannelId(userId: string, guildId: string | null): string | null {
    if (!guildId) return null;
    try { return (findByProps("getVoiceStateForUser") as any)?.getVoiceStateForUser?.(userId)?.channelId ?? null; } catch { return null; }
}

function getGuildRoles(guildId: string | null): Array<{ id: string; name: string; color: number; }> {
    if (!guildId) return [];
    try {
        const sortedRoles = (GuildRoleStore as any)?.getSortedRoles?.(guildId);
        if (sortedRoles) {
            const out: Array<{ id: string; name: string; color: number; }> = [];
            for (const r of sortedRoles) {
                if (r.id !== guildId) out.push({ id: r.id, name: r.name, color: r.color });
            }
            return out;
        }
        return [];
    } catch {
        try {
            const guild = getGuild(guildId);
            if (!guild?.roles) return [];
            const vals = Object.values(guild.roles as Record<string, any>);
            const filtered: any[] = [];
            for (const r of vals) {
                if (r.id !== guildId) filtered.push(r);
            }
            filtered.sort((a: any, b: any) => b.position - a.position);
            const out2: Array<{ id: string; name: string; color: number; }> = [];
            for (const r of filtered) {
                out2.push({ id: r.id, name: r.name, color: r.color });
            }
            return out2;
        } catch { return []; }
    }
}

function getMemberRoleIds(guildId: string | null, userId: string): string[] {
    if (!guildId) return [];
    try { return (GuildMemberStore as any)?.getMember?.(guildId, userId)?.roles ?? []; } catch { return getMember(guildId, userId)?.roles ?? []; }
}

function toast(msg: string) {
    try { const T = findByProps("show", "pop") as any; T?.show?.({ message: msg, type: 1, id: T.genId?.() ?? String(Date.now()) }); } catch { }
}

function findVoiceUserElement(userId: string): HTMLElement | null {
    const byAttr = document.querySelector(`[data-user-id="${userId}"]`) as HTMLElement | null;
    if (byAttr) return byAttr;
    const voiceUsers = document.querySelectorAll("[class*='voiceUser'], [class*='VoiceUser']");
    for (const el of voiceUsers) {
        for (const img of el.querySelectorAll("img")) {
            if ((img as HTMLImageElement).src.includes(userId)) return el as HTMLElement;
        }
    }
    return null;
}

function Btn({ label, onClick, primary = false }: { label: string; onClick: () => void; primary?: boolean; }) {
    return <button onClick={onClick} style={{ background: primary ? "var(--brand-experiment)" : "none", border: "none", borderRadius: primary ? 3 : 0, color: primary ? "#fff" : "var(--text-normal)", cursor: "pointer", padding: "8px 16px", fontWeight: primary ? 600 : 400 }}>{label}</button>;
}

// ─── Common Styles ───────────────────────────────────────────────────────────

const modalTitle: React.CSSProperties = { fontFamily: "var(--font-display)", fontSize: "20px", fontWeight: 600, lineHeight: "24px", color: "#ffffff", margin: 0, padding: 0 };
const footerStyle: React.CSSProperties = { display: "flex", gap: "24px", padding: "16px" };
function footerBtn(bg: string): React.CSSProperties { return { flex: 1, fontFamily: "var(--font-primary)", fontSize: "14px", fontWeight: 500, height: "38px", background: bg, color: "#ffffff", border: "none", borderRadius: "8px", cursor: "pointer" }; }
function textareaStyle(height = "100px"): React.CSSProperties { return { fontFamily: "var(--font-primary)", width: "100%", height, background: "#383a40", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "8px", padding: "10px 12px", color: "#ffffff", fontSize: "16px", fontWeight: 400, lineHeight: "22px", outline: "none", resize: "none", boxSizing: "border-box", overflowY: "auto", scrollbarWidth: "thin" } as React.CSSProperties; }
function sectionLabel(mb = "8px"): React.CSSProperties { return { fontFamily: "var(--font-primary)", fontSize: "16px", fontWeight: 600, color: "#ffffff", marginBottom: mb }; }

// ─── Modals ───────────────────────────────────────────────────────────────────

function RenameModal({ rootProps, user, guildId }: { rootProps: any; user: any; guildId: string | null; }) {
    const member = getMember(guildId, user.id);
    const [nick, setNick] = React.useState<string>(fakeNicks.get(user.id) ?? member?.nick ?? user.username ?? "");
    function applyNick() {
        const trimmed = nick.trim();
        if (trimmed) fakeNicks.set(user.id, trimmed);
        else fakeNicks.delete(user.id);
        notifyMemberListChange();
        toast(`Nickname changed → ${trimmed || "(reset)"}`);
        rootProps.onClose();
    }
    return (
        <ModalRoot {...rootProps} size="small">
            <ModalHeader separator={false}><h2 style={{ ...modalTitle, flex: 1 }}>Change Nickname</h2><ModalCloseButton onClick={rootProps.onClose} /></ModalHeader>
            <ModalContent style={{ padding: "0 16px 20px" }}>
                <div style={sectionLabel()}>Nickname</div>
                <input value={nick} onChange={e => setNick(e.target.value)} autoFocus maxLength={32} onKeyDown={e => { if (e.key === "Enter") applyNick(); }} style={{ width: "100%", background: "#383a40", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "8px", padding: "10px 12px", color: "#ffffff", fontFamily: "var(--font-primary)", fontSize: "16px", outline: "none", boxSizing: "border-box" as any }} />
            </ModalContent>
            <ModalFooter>
                <div style={{ display: "flex", gap: "12px", width: "100%", padding: "16px" }}>
                    <button onClick={rootProps.onClose} style={footerBtn("#4e5058") as any}>Cancel</button>
                    <button onClick={applyNick} style={footerBtn("#5865f2") as any}>Apply</button>
                </div>
            </ModalFooter>
        </ModalRoot>
    );
}

function KickModal({ rootProps, user, guildId }: { rootProps: any; user: any; guildId: string | null; }) {
    const [reason, setReason] = React.useState("");
    const username = user.globalName ?? user.username ?? "this user";
    const tag = user.username ?? "";
    return (
        <ModalRoot {...rootProps} size="small">
            <ModalHeader separator={false}>
                <h2 style={{ fontFamily: "var(--font-display)", fontSize: "20px", fontWeight: 700, color: "#ffffff", margin: 0, flex: 1 }}>
                    Kick {username} from server
                </h2>
                <ModalCloseButton onClick={rootProps.onClose} />
            </ModalHeader>
            <ModalContent style={{ padding: "8px 16px 20px" }}>
                <p style={{ fontFamily: "var(--font-primary)", fontSize: "14px", color: "#ffffff", lineHeight: "20px", marginBottom: "16px", marginTop: "4px" }}>
                    Are you sure you want to kick @{tag} from the server? They will be able to return with a new invitation.
                </p>
                <div style={{ fontFamily: "var(--font-primary)", fontSize: "14px", fontWeight: 600, color: "#ffffff", marginBottom: "8px" }}>Reason for kick</div>
                <textarea
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    placeholder=""
                    style={{ width: "100%", height: "120px", background: "var(--input-background, #1e1f22)", border: "1px solid var(--background-tertiary, #1e1f22)", borderRadius: "4px", padding: "10px", color: "#ffffff", fontFamily: "var(--font-primary)", fontSize: "14px", lineHeight: "20px", resize: "none", outline: "none", boxSizing: "border-box" as any }}
                />
            </ModalContent>
            <ModalFooter>
                <div style={{ display: "flex", gap: "8px", width: "100%", padding: "16px" }}>
                    <button onClick={rootProps.onClose} style={footerBtn("#4e5058") as any}>Cancel</button>
                    <button onClick={() => { kickedUsers.add(user.id); disconnectedUsers.add(user.id); notifyMemberListChange(); toast(`@${tag} kicked (local)`); rootProps.onClose(); }}
                        style={footerBtn("#da373c") as any}>
                        Kick
                    </button>
                </div>
            </ModalFooter>
        </ModalRoot>
    );
}

const BAN_REASONS = [
    { label: "Suspicious account or spam", value: "spam" },
    { label: "Compromised or hacked account", value: "compromised" },
    { label: "Non-respect of server rules", value: "rules" },
    { label: "Other", value: "other" },
];
const DELETE_OPTIONS = [
    { label: "Don't delete anything", value: "0" },
    { label: "Last hour", value: "3600" },
    { label: "Last 24 hours", value: "86400" },
    { label: "Last 7 days", value: "604800" },
];

function BanModal({ rootProps, user }: { rootProps: any; user: any; }) {
    const [reason, setReason] = React.useState<string | null>(null);
    const [customReason, setCustomReason] = React.useState("");
    const [deleteValue, setDeleteValue] = React.useState("3600");
    return (
        <ModalRoot {...rootProps} size="small">
            <ModalHeader separator={false}><h2 style={{ ...modalTitle, flex: 1 }}>Ban @{user.username}?</h2><ModalCloseButton onClick={rootProps.onClose} /></ModalHeader>
            <ModalContent style={{ padding: "0 16px 20px" }}>
                <div style={sectionLabel()}>Reason</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "16px" }}>
                    {BAN_REASONS.map(opt => (
                        <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: "12px", cursor: "pointer", fontFamily: "var(--font-primary)", fontSize: "16px", color: "#ffffff", userSelect: "none" as any }} onClick={() => setReason(opt.value)}>
                            <div style={{ width: 20, height: 20, borderRadius: "50%", flexShrink: 0, border: reason === opt.value ? "6px solid #5865f2" : "2px solid #4e5058", background: reason === opt.value ? "#fff" : "transparent", boxSizing: "border-box" as any }} />
                            {opt.label}
                        </label>
                    ))}
                </div>
                {reason === "other" && <TextArea value={customReason} onChange={(v: string) => setCustomReason(v)} rows={3} style={{ marginBottom: "16px" }} />}
                <div style={sectionLabel()}>Delete messages</div>
                <Select options={DELETE_OPTIONS} select={(v: string) => setDeleteValue(v)} isSelected={(v: string) => v === deleteValue} serialize={(v: string) => v} maxVisibleItems={5} closeOnSelect={true} />
            </ModalContent>
            <ModalFooter>
                <div style={{ display: "flex", gap: "12px", width: "100%", padding: "16px", justifyContent: "flex-end" }}>
                    <Button look={Button.Looks.LINK} color={Button.Colors.PRIMARY} onClick={rootProps.onClose}>Cancel</Button>
                    <Button look={Button.Looks.FILLED} color={Button.Colors.RED} onClick={() => { if (!reason) return toast("Select a reason"); bannedUsers.add(user.id); kickedUsers.add(user.id); disconnectedUsers.add(user.id); notifyMemberListChange(); toast(`@${user.username} banned (local)`); rootProps.onClose(); }}>Ban</Button>
                </div>
            </ModalFooter>
        </ModalRoot>
    );
}

const TIMEOUT_DURATIONS = [
    { label: "60 sec", seconds: 60 }, { label: "5 min", seconds: 300 },
    { label: "10 min", seconds: 600 }, { label: "1 hour", seconds: 3600 },
    { label: "1 day", seconds: 86400 }, { label: "1 week", seconds: 604800 },
];

function TimeoutModal({ rootProps, user }: { rootProps: any; user: any; }) {
    const [selectedIdx, setSelectedIdx] = React.useState(0);
    const [reason, setReason] = React.useState("");
    const username = user.globalName ?? user.username ?? "this user";
    const tag = user.username ?? "";
    return (
        <ModalRoot {...rootProps} size="small">
            <ModalHeader separator={false}>
                <h2 style={{ fontFamily: "var(--font-display)", fontSize: "20px", fontWeight: 700, color: "#ffffff", margin: 0, flex: 1 }}>
                    Timeout {username}
                </h2>
                <ModalCloseButton onClick={rootProps.onClose} />
            </ModalHeader>
            <ModalContent style={{ padding: "8px 16px 20px" }}>
                <p style={{ fontFamily: "var(--font-primary)", fontSize: "14px", color: "#ffffff", lineHeight: "20px", marginBottom: "20px", marginTop: "4px" }}>
                    Temporarily timed out members cannot send messages or react in text channels. They are also not allowed to join voice or conference channels.{" "}
                    <span style={{ color: "#00a8fc", cursor: "pointer" }}>Learn more</span>
                </p>
                <div style={{ fontFamily: "var(--font-primary)", fontSize: "14px", fontWeight: 600, color: "#ffffff", marginBottom: "8px" }}>Duration</div>
                <div style={{ display: "flex", marginBottom: "20px", borderRadius: "4px", overflow: "hidden", border: "1px solid var(--background-modifier-accent, rgba(255,255,255,0.1))" }}>
                    {TIMEOUT_DURATIONS.map((d, i) => (
                        <button key={i} onClick={() => setSelectedIdx(i)} style={{
                            flex: 1,
                            fontFamily: "var(--font-primary)",
                            fontSize: "14px",
                            fontWeight: 500,
                            background: selectedIdx === i ? "#5865f2" : "var(--background-secondary, #2b2d31)",
                            color: "#ffffff",
                            border: "none",
                            borderRight: i < TIMEOUT_DURATIONS.length - 1 ? "1px solid var(--background-modifier-accent, rgba(255,255,255,0.1))" : "none",
                            padding: "8px 2px",
                            height: "36px",
                            cursor: "pointer",
                            whiteSpace: "nowrap" as any,
                            textAlign: "center" as any,
                            boxSizing: "border-box" as any,
                        }}>
                            {d.label}
                        </button>
                    ))}
                </div>
                <div style={{ fontFamily: "var(--font-primary)", fontSize: "14px", fontWeight: 600, color: "#ffffff", marginBottom: "8px" }}>Reason</div>
                <textarea
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    placeholder="Enter a reason. It will only be visible in server logs and this member won't be able to see it."
                    style={{ width: "100%", height: "100px", background: "var(--input-background, #1e1f22)", border: "1px solid var(--background-tertiary, #1e1f22)", borderRadius: "4px", padding: "10px", color: "#ffffff", fontFamily: "var(--font-primary)", fontSize: "14px", lineHeight: "20px", resize: "none", outline: "none", boxSizing: "border-box" as any }}
                />
            </ModalContent>
            <ModalFooter>
                <div style={{ display: "flex", gap: "8px", width: "100%", padding: "16px" }}>
                    <button onClick={rootProps.onClose} style={footerBtn("#4e5058") as any}>Cancel</button>
                    <button onClick={() => {
                        const d = TIMEOUT_DURATIONS[selectedIdx];
                        disconnectedUsers.add(user.id);
                        notifyMemberListChange();
                        toast(`@${tag} timed out for ${d.label} (local)`);
                        setTimeout(() => { disconnectedUsers.delete(user.id); notifyMemberListChange(); }, d.seconds * 1000);
                        rootProps.onClose();
                    }} style={footerBtn("#5865f2") as any}>
                        Timeout
                    </button>
                </div>
            </ModalFooter>
        </ModalRoot>
    );
}

function AddRoleModal({ rootProps, user, guildId }: { rootProps: any; user: any; guildId: string | null; }) {
    const [search, setSearch] = React.useState("");
    const allRoles = getGuildRoles(guildId);
    const memberRoleIds = getMemberRoleIds(guildId, user.id);
    const filtered = allRoles.filter(r => r.name.toLowerCase().includes(search.toLowerCase()));
    return (
        <ModalRoot {...rootProps} size="small">
            <ModalContent style={{ padding: "8px 0 0", background: "var(--background-floating, #18191c)", borderRadius: 8, minWidth: 220 }}>
                <div style={{ padding: "4px 8px" }}>
                    <input autoFocus placeholder="Role" value={search} onChange={e => setSearch(e.target.value)} style={{ width: "100%", background: "transparent", border: "1px solid var(--brand-experiment, #5865f2)", borderRadius: 4, outline: "none", color: "var(--text-normal, #dcddde)", fontSize: 14, padding: "4px 8px", boxSizing: "border-box" }} />
                </div>
                <div style={{ maxHeight: 300, overflowY: "auto", scrollbarWidth: "none", padding: "4px 0" }}>
                    {filtered.map(role => {
                        const color = role.color ? `#${role.color.toString(16).padStart(6, "0")}` : "#80848e";
                        return (
                            <div key={role.id} onClick={() => { toast(`Role ${role.name} — simulation`); rootProps.onClose(); }} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", cursor: "pointer", opacity: memberRoleIds.includes(role.id) ? 0.5 : 1 }} onMouseEnter={e => (e.currentTarget.style.background = "var(--background-modifier-hover)")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                                <div style={{ width: 12, height: 12, borderRadius: "50%", background: color, flexShrink: 0 }} />
                                <span style={{ color: "var(--text-normal, #dcddde)", fontSize: 14 }}>{role.name}</span>
                            </div>
                        );
                    })}
                </div>
            </ModalContent>
        </ModalRoot>
    );
}

// ─── Context menu patches ─────────────────────────────────────────────────────

function findGroupWithItem(children: any[], itemIds: string[]): number {
    for (let i = 0; i < children.length; i++) {
        const el = children[i];
        if (!el?.props) continue;
        const sub = Array.isArray(el.props.children) ? el.props.children : el.props.children ? [el.props.children] : [];
        for (const child of sub) {
            if (child?.props?.id && itemIds.includes(child.props.id)) return i;
        }
    }
    return -1;
}

const messageContextPatch: NavContextMenuPatchCallback = (children, { message }: any) => {
    if (!children || !Array.isArray(children) || !isEnabled || !message?.id) return;
    try {
        // Only show in guilds (servers), not in DMs
        const guildId = getCurrentGuildId();
        if (!guildId) return;
        const hasDelete = children.some((g: any) => {
            const sub = Array.isArray(g?.props?.children) ? g.props.children : [];
            return sub.some((c: any) => c?.props?.id === "delete-message");
        });
        children.splice(-1, 0, (
            <Menu.MenuGroup key="fp-msg-group">
                <Menu.MenuItem key="fp-delete-msg" id="fp-delete-msg" label={hasDelete ? "Delete for me (fake)" : "Delete message"} color="danger"
                    action={() => { deletedMessages.add(message.id); hideMessageInDOM(message.id); toast("Message deleted (local)"); }} />
            </Menu.MenuGroup>
        ));
    } catch (e) {
        console.error("[FakePerm] Message context patch error:", e);
    }
};

const userContextPatch: NavContextMenuPatchCallback = (children, { user }: any) => {
    if (!children || !Array.isArray(children) || !isEnabled || !user) return;
    try {
        const guildId = getCurrentGuildId();
        if (!guildId) return;

        // Hide native Roles and Permissions viewer when FakePerm is enabled
        const HIDDEN_IDS = new Set(["roles", "perm-viewer-permissions"]);
        for (let i = 0; i < children.length; i++) {
            const group = children[i];
            if (!group?.props?.children) continue;
            const sub: any[] = Array.isArray(group.props.children)
                ? group.props.children
                : [group.props.children];
            const filtered = sub.filter((child: any) => !HIDDEN_IDS.has(child?.props?.id ?? ""));
            if (filtered.length !== sub.length) {
                children[i] = React.cloneElement(group, { children: filtered });
            }
        }
        const { username } = user;
        const allRoles = getGuildRoles(guildId);
        const memberRoleIds = getMemberRoleIds(guildId, user.id);

        const groupA = (
            <Menu.MenuGroup key="fp-group-a">
                <Menu.MenuItem key="fp-rename" id="fp-rename" label="Change Nickname" action={() => openModal(p => <RenameModal rootProps={p} user={user} guildId={guildId} />)} />
                <Menu.MenuItem key="fp-roles" id="fp-roles" label="Roles">
                    {allRoles.length === 0
                        ? <Menu.MenuItem key="fp-roles-empty" id="fp-roles-empty" label="No roles" disabled />
                        : [...allRoles.map(role => {
                            const hasRole = memberRoleIds.includes(role.id);
                            const color = role.color ? `#${role.color.toString(16).padStart(6, "0")}` : "#80848e";
                            return (
                                <Menu.MenuItem key={`fp-role-${role.id}`} id={`fp-role-${role.id}`} label={role.name} action={() => { }}
                                    render={() => (
                                        <div style={{ display: "flex", alignItems: "center", padding: "8px 10px", gap: 8, width: "100%", boxSizing: "border-box", cursor: "pointer" }}>
                                            <div style={{ width: 14, height: 14, borderRadius: "50%", background: color, flexShrink: 0 }} />
                                            <span style={{ flex: 1, color: "#ffffff", fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{role.name}</span>
                                            <div style={{ width: 16, height: 16, borderRadius: 3, flexShrink: 0, border: hasRole ? "none" : "1.5px solid #72767d", background: hasRole ? "#5865f2" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                                {hasRole && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                                            </div>
                                        </div>
                                    )} />
                            );
                        }),
                        <Menu.MenuItem key="fp-role-add" id="fp-role-add" label="+ Add a role" action={() => openModal(p => <AddRoleModal rootProps={p} user={user} guildId={guildId} />)}
                            render={() => <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderTop: "1px solid rgba(79,84,92,0.48)", color: "#b9bbbe", fontSize: 13, cursor: "pointer" }}><span>+</span><span>Add a role</span></div>} />,
                        ]}
                </Menu.MenuItem>
                <Menu.MenuItem key="fp-move" id="fp-move" label="Move to">
                    {(() => {
                        const allChannels: Array<{ id: string; name: string; position: number; }> = [];
                        try {
                            const gc = (GuildChannelStore as any)?.getChannels?.(guildId) ?? {};
                            const va: any[] = [...(gc.VOCAL ?? []), ...(gc[2] ?? []), ...(gc[13] ?? [])];
                            if (va.length === 0) for (const arr of Object.values(gc)) { if (Array.isArray(arr)) for (const item of arr as any[]) { const ch = (item as any).channel ?? item; if ((ch?.type === 2 || ch?.type === 13) && ch.id && ch.name) va.push(item); } }
                            const seen = new Set<string>();
                            for (const item of va) { const ch = (item as any).channel ?? item; if (ch?.id && ch?.name && !seen.has(ch.id)) { seen.add(ch.id); allChannels.push({ id: ch.id, name: ch.name, position: ch.position ?? 0 }); } }
                        } catch { }
                        allChannels.sort((a, b) => a.position - b.position);
                        if (allChannels.length === 0) return <Menu.MenuItem key="fp-move-empty" id="fp-move-empty" label="No voice channels" disabled />;
                        return allChannels.map(ch => <Menu.MenuItem key={`fp-move-${ch.id}`} id={`fp-move-${ch.id}`} label={`🔊 ${ch.name}`} action={() => toast(`Moved to #${ch.name} — simulation`)} />);
                    })()}
                </Menu.MenuItem>
                <Menu.MenuCheckboxItem key="fp-mute" id="fp-mute" label="Server Mute" color="danger" checked={mutedUsers.get(user.id) === true} action={() => { const next = !mutedUsers.get(user.id); mutedUsers.set(user.id, next); notifyBadgeChange(); }} />
                <Menu.MenuCheckboxItem key="fp-deafen" id="fp-deafen" label="Server Deafen" color="danger" checked={deafenedUsers.get(user.id) === true} action={() => { const next = !deafenedUsers.get(user.id); deafenedUsers.set(user.id, next); notifyBadgeChange(); }} />
                <Menu.MenuItem key="fp-disconnect" id="fp-disconnect" label="Disconnect" color="danger" action={() => { disconnectedUsers.add(user.id); notifyMemberListChange(); toast(`@${username} disconnected from voice (local)`); }} />
                <Menu.MenuItem key="fp-kick" id="fp-kick" label={`Timeout ${username}`} color="danger" action={() => openModal(p => <TimeoutModal rootProps={p} user={user} />)} />
                <Menu.MenuItem key="fp-expulser" id="fp-expulser" label={`Kick ${username}`} color="danger" action={() => openModal(p => <KickModal rootProps={p} user={user} guildId={guildId} />)} />
                <Menu.MenuItem key="fp-ban" id="fp-ban" label={`Ban ${username}`} color="danger" action={() => openModal(p => <BanModal rootProps={p} user={user} />)} />
            </Menu.MenuGroup>
        );

        const idxBlock = findGroupWithItem(children, ["block", "ignore"]);
        if (idxBlock >= 0) children.splice(idxBlock + 1, 0, groupA);
        else children.splice(-1, 0, groupA);
    } catch (e) {
        console.error("[FakePerm] User context patch error:", e);
    }
};

// ─── Plugin ───────────────────────────────────────────────────────────────────

export default definePlugin({
    name: "FakePerm",
    enabledByDefault: false,
    description: "Visually simulates moderation options in the right-click menu. No real action.",
    tags: ["Roles", "Nightcord"],
    authors: [{ name: "Nightcord", id: 0n }],
    dependencies: ["ContextMenuAPI"],
    requiresRestart: false,

    patches: [
        {
            find: "showCommunicationDisabledStyles",
            predicate: () => isEnabled,
            replacement: {
                match: /&&\i\.\i\.canManageUser\(\i\.\i\.MODERATE_MEMBERS,\i\.author,\i\)/,
                replace: "",
            },
        },
        {
            find: "INVITES_DISABLED)||",
            predicate: () => isEnabled,
            replacement: {
                match: /\i\.\i\.can\(\i\.\i.MANAGE_GUILD,\i\)/,
                replace: "true",
            },
        },
        {
            find: /,checkElevated:!1}\),\i\.\i\)}(?<=getCurrentUser\(\);return.+?)/,
            predicate: () => isEnabled,
            replacement: {
                match: /return \i\.\i\(\i\.\i\(\{user:\i,context:\i,checkElevated:!1\}\),\i\.\i\)/,
                replace: "return true",
            }
        },
        // fixes a bug where Members page must be loaded to see highest role
        {
            find: "#{intl::GUILD_MEMBER_MOD_VIEW_HIGHEST_ROLE}),children:",
            predicate: () => isEnabled,
            replacement: {
                match: /(#{intl::GUILD_MEMBER_MOD_VIEW_HIGHEST_ROLE}.{0,80})role:\i(?<=\[\i\.roles,\i\.highestRoleId,(\i)\].+?)/,
                replace: (_, rest, roles) => `${rest}role:$self.getHighestRole(arguments[0],${roles})`,
            }
        }
    ],

    getHighestRole({ member }: { member: any; }, roles: any[]): any | undefined {
        try {
            return roles.find(role => role.id === member.highestRoleId);
        } catch {
            return undefined;
        }
    },

    options: {
        enabled: {
            type: OptionType.BOOLEAN,
            description: "Enable fake permissions in right-click menu",
            default: false,
            onChange(v: boolean) {
                isEnabled = Boolean(v);
                if (!isEnabled) {
                    destroyDomObserver();
                    // Full cleanup when disabling
                    document.querySelectorAll("[id^='fp-ibadge-']").forEach(el => el.remove());
                    document.querySelectorAll("[data-fp-hidden='true']").forEach(el => {
                        (el as HTMLElement).style.display = "";
                        (el as HTMLElement).removeAttribute("data-fp-hidden");
                    });
                    mutedUsers.clear();
                    deafenedUsers.clear();
                    fakeNicks.clear();
                    disconnectedUsers.clear();
                    kickedUsers.clear();
                    bannedUsers.clear();
                    deletedMessages.clear();
                    notifyBadgeChange();
                } else {
                    ensureDomObserver();
                }
                toast(isEnabled ? "FakePerm enabled ✓" : "FakePerm disabled ✓");
            }
        }
    },

    applyDomOverrides() { if (!isEnabled) return;
        for (const [userId, fakeNick] of fakeNicks) {
            document.querySelectorAll(`[data-user-id="${userId}"]`).forEach(el => {
                const nickEl = el.querySelector("[class*='nick'], [class*='Nick'], [class*='username'], [class*='Username']") as HTMLElement | null;
                if (nickEl && nickEl.dataset.fpOriginal === undefined) nickEl.dataset.fpOriginal = nickEl.textContent ?? "";
                if (nickEl && nickEl.dataset.fpNick !== fakeNick) { nickEl.dataset.fpNick = fakeNick; nickEl.textContent = fakeNick; }
            });
        }
        for (const userId of disconnectedUsers) {
            document.querySelectorAll(`[class*='voiceUser'] [data-user-id="${userId}"], [class*='VoiceUser'] [data-user-id="${userId}"]`).forEach(el => {
                const voiceEl = el.closest("li, [class*='voiceUser'], [class*='VoiceUser']") as HTMLElement | null;
                if (voiceEl && voiceEl.getAttribute("data-fp-hidden") !== "true") fpHide(voiceEl);
            });
        }
        for (const userId of kickedUsers) {
            document.querySelectorAll(`[data-user-id="${userId}"]`).forEach(el => {
                const memberEl = el.closest("li, [class*='member'], [class*='Member']") as HTMLElement | null;
                if (memberEl && memberEl.getAttribute("data-fp-hidden") !== "true") fpHide(memberEl);
            });
        }
    },

    async start() {
        // Read isEnabled from Equicord Settings
        try {
            const S = (Vencord as any)?.Settings?.plugins?.FakePerm;
            isEnabled = S?.enabled === true;
        } catch {
            isEnabled = false;
        }
        pluginSelf = this;

        // Patches are ALWAYS registered — they check isEnabled at runtime
        addContextMenuPatch("user-context", userContextPatch);
        addContextMenuPatch("message", messageContextPatch);

        // Style scrollbar submenu
        const style = document.createElement("style");
        style.id = "fakeperm-roles-style";
        style.textContent = "[class*='submenu']::-webkit-scrollbar{display:none!important}[class*='submenu']{scrollbar-width:none!important} .fp-footer-fix { display: flex; gap: 8px; padding: 16px; }";
        document.head.appendChild(style);

        // MutationObserver for DOM overrides — only active while enabled
        ensureDomObserver();
    },

    stop() {
        destroyDomObserver();
        pluginSelf = null;
        removeHideStyle();
        removeContextMenuPatch("user-context", userContextPatch);
        removeContextMenuPatch("message", messageContextPatch);
        isEnabled = false;
        document.getElementById("fakeperm-roles-style")?.remove();
        document.querySelectorAll("[id^='fp-ibadge-']").forEach(el => el.remove());
        document.querySelectorAll("[data-fp-hidden='true']").forEach(el => {
            (el as HTMLElement).style.display = "";
            (el as HTMLElement).removeAttribute("data-fp-hidden");
        });
        mutedUsers.clear(); deafenedUsers.clear(); fakeNicks.clear();
        disconnectedUsers.clear(); kickedUsers.clear(); bannedUsers.clear(); deletedMessages.clear();
        notifyBadgeChange();
    },
});
