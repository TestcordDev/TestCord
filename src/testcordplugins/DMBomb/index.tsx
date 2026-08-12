/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { addContextMenuPatch, removeContextMenuPatch } from "@api/ContextMenu";
import { sleep } from "@utils/misc";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { GuildMemberStore, GuildRoleStore, GuildStore, Menu, React, RestAPI, Select, showToast, Toasts, useEffect, useRef, UserStore, useState } from "@webpack/common";

/* ── State ── */
const state = {
    running: false,
    finished: false,
    done: 0,
    total: 0,
    log: [] as string[],
    aborted: false,
    delayMs: 1500,
    listeners: new Set<() => void>(),
    notify() { this.listeners.forEach(fn => fn()); },
    subscribe(fn: () => void) { this.listeners.add(fn); },
    unsubscribe(fn: () => void) { this.listeners.delete(fn); },
    reset() {
        this.running = false;
        this.finished = false;
        this.done = 0;
        this.total = 0;
        this.log = [];
        this.aborted = false;
        this.notify();
    },
};

const getMembers = (guildId: string): any[] => {
    try { return Object.values(GuildMemberStore.getMembers(guildId) || {}); } catch { }
    return [];
};

async function startBomb(guildId: string, roleId: string | "all", message: string) {
    if (state.running) return;

    let members = getMembers(guildId);
    if (!members.length) {
        showToast("No members found in cache, try loading the member list first (scroll through it).", Toasts.Type.FAILURE);
        return;
    }

    if (roleId !== "all") {
        members = members.filter(m => m.roles.includes(roleId));
    }

    // Filter out bots and yourself
    const meId = UserStore.getCurrentUser()?.id;
    members = members.filter(m => {
        const u = UserStore.getUser(m.userId);
        return u && !u.bot && u.id !== meId;
    });

    state.reset();
    state.total = members.length;
    state.running = true;
    state.notify();

    for (const m of members) {
        if (state.aborted) {
            state.log.push("⛔ Stopped.");
            state.notify();
            break;
        }

        const user = UserStore.getUser(m.userId);
        const name = user ? (user.globalName || user.username) : m.userId;
        try {
            const dmRes = await RestAPI.post({ url: "/users/@me/channels", body: { recipient_id: m.userId } });
            if (!dmRes?.body?.id) {
                state.log.push(`❌ ${name} — DMs closed or error`);
                state.notify();
                continue;
            }
            await RestAPI.post({ url: `/channels/${dmRes.body.id}/messages`, body: { content: message, tts: false } });
            state.done++;
            state.log.push(`✅ ${name}`);
        } catch (e: any) {
            state.log.push(`❌ ${name} — ${e?.message ?? "error (rate limit?)"}`);
        }
        state.notify();
        if (!state.aborted) await sleep(state.delayMs);
    }

    state.running = false;
    state.finished = true;
    state.notify();
}

function useObservableState() {
    const [, forceUpdate] = useState(0);
    useEffect(() => {
        const listener = () => forceUpdate(n => n + 1);
        state.subscribe(listener);
        return () => state.unsubscribe(listener);
    }, []);
    return state;
}

function BombIcon(props: any) {
    return (
        <svg aria-hidden="true" role="img" xmlns="http://www.w3.org/2000/svg" width={20} height={20} viewBox="0 0 24 24" fill="currentColor" {...props}>
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2ZM8 12a4 4 0 1 1 8 0 4 4 0 0 1-8 0ZM19 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM21 6.5A1.5 1.5 0 0 1 19.5 8 1.5 1.5 0 0 1 18 6.5 1.5 1.5 0 0 1 19.5 5 1.5 1.5 0 0 1 21 6.5Z" />
        </svg>
    );
}

function DMBombModal({ rootProps, guildId }: { rootProps: any; guildId: string; }) {
    const s = useObservableState();
    const [msg, setMsg] = useState("");
    const [roleId, setRoleId] = useState("all");
    const [editingDelay, setEditingDelay] = useState(false);
    const [delayInput, setDelayInput] = useState(String(s.delayMs / 1000));
    const logRef = useRef<HTMLDivElement>(null);

    const guild = GuildStore.getGuild(guildId);
    const roles = guild ? GuildRoleStore.getSortedRoles(guildId) : [];
    const members = getMembers(guildId);

    // Calculate counts for eligible members (excluding bots and self)
    const meId = UserStore.getCurrentUser()?.id;
    const eligibleMembers = members.filter(m => {
        const u = UserStore.getUser(m.userId);
        return u && !u.bot && u.id !== meId;
    });

    const countByRole: Record<string, number> = {};
    eligibleMembers.forEach(m => {
        m.roles?.forEach((rId: string) => {
            countByRole[rId] = (countByRole[rId] || 0) + 1;
        });
    });
    const allCount = eligibleMembers.length;

    useEffect(() => {
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    }, [s.log.length]);

    const pct = s.total > 0 ? Math.round((s.done / s.total) * 100) : 0;
    const idle = !s.running && !s.finished;

    return (
        <ModalRoot {...rootProps} className="dmb-modal">
            <ModalHeader className="dmb-header">
                <BombIcon style={{ marginRight: 8, color: "#ed4245" }} />
                <span style={{ flex: 1, fontWeight: 700, fontSize: 16, color: "#fff" }}>DM Bomb - {guild?.name ?? "Server"}</span>
                {s.running && <span className="dmb-badge">Running...</span>}
                <ModalCloseButton onClick={rootProps.onClose} />
            </ModalHeader>

            <ModalContent className="dmb-content">
                {idle && (
                    <>
                        <div style={{ marginBottom: 16 }}>
                            <p className="dmb-label">Target:</p>
                            <Select
                                options={[
                                    { label: `All members (no safe) [${allCount}]`, value: "all" },
                                    ...roles.map((r: any) => ({ label: `@${r.name} [${countByRole[r.id] || 0}]`, value: r.id }))
                                ]}
                                select={setRoleId}
                                serialize={(v: string) => v}
                                isSelected={(v: string) => v === roleId}
                            />
                        </div>

                        <p className="dmb-label">Message:</p>
                        <textarea
                            className="dmb-textarea"
                            placeholder="Type your message here..."
                            value={msg}
                            onChange={e => setMsg(e.currentTarget.value)}
                            rows={5}
                        />
                        <p className="dmb-warn">
                            ⚠️ Intensive botting can get your account banned. Delay:{" "}
                            {editingDelay ? (
                                <input
                                    className="dmb-delay-input"
                                    type="number"
                                    step="0.1"
                                    min="0.5"
                                    max="60"
                                    value={delayInput}
                                    onChange={e => setDelayInput(e.currentTarget.value)}
                                    onBlur={() => {
                                        const val = Math.max(0.5, Math.min(60, parseFloat(delayInput) || 1.5));
                                        state.delayMs = Math.round(val * 1000);
                                        setDelayInput(String(val));
                                        setEditingDelay(false);
                                        state.notify();
                                    }}
                                    onKeyDown={e => {
                                        if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                                        if (e.key === "Escape") { setDelayInput(String(state.delayMs / 1000)); setEditingDelay(false); }
                                    }}
                                    autoFocus
                                />
                            ) : (
                                <span
                                    className="dmb-delay-value"
                                    onClick={() => { setDelayInput(String(s.delayMs / 1000)); setEditingDelay(true); }}
                                    title="Click to modify delay"
                                >
                                    {s.delayMs / 1000}s
                                </span>
                            )}
                        </p>
                    </>
                )}
                {(s.running || s.finished) && (
                    <>
                        <div className="dmb-stats">
                            <span className="dmb-stats-count">{s.done} / {s.total} reached</span>
                            <span className="dmb-stats-pct">{pct}%</span>
                        </div>
                        <div className="dmb-bar-bg">
                            <div className="dmb-bar-fill" style={{ width: `${pct}%` }} />
                        </div>
                        {s.finished && (
                            <p className="dmb-done">✅ Finished with {s.done} DMs sent.</p>
                        )}
                        <div className="dmb-log" ref={logRef}>
                            {s.log.map((line, i) => <div key={i} className="dmb-log-line">{line}</div>)}
                        </div>
                    </>
                )}
            </ModalContent>

            <ModalFooter className="dmb-footer">
                {idle && (
                    <>
                        <button className="dmb-btn dmb-btn-secondary" onClick={rootProps.onClose}>Cancel</button>
                        <button className="dmb-btn dmb-btn-danger" onClick={() => startBomb(guildId, roleId, msg)} disabled={!msg.trim()}>💥 Bombard</button>
                    </>
                )}
                {s.running && (
                    <>
                        <button className="dmb-btn dmb-btn-secondary" onClick={rootProps.onClose}>Background</button>
                        <button className="dmb-btn dmb-btn-danger" onClick={() => { state.aborted = true; }}>⛔ Stop</button>
                    </>
                )}
                {s.finished && (
                    <>
                        <button className="dmb-btn dmb-btn-secondary" onClick={() => state.reset()}>New Bomb</button>
                        <button className="dmb-btn dmb-btn-primary" onClick={rootProps.onClose}>Close</button>
                    </>
                )}
            </ModalFooter>
        </ModalRoot>
    );
}

export default definePlugin({
    name: "DMBomb",
    description: "Sends an aggressive message to ALL server members or a specific role via right click.",
    tags: ["Servers", "Chat", "Nightcord"],
    authors: [{ name: "Nightcord", id: 0n }],
    dependencies: ["ContextMenuAPI"],

    start() {
        addContextMenuPatch("guild-context", this.patchGuildContext);
    },

    stop() {
        removeContextMenuPatch("guild-context", this.patchGuildContext);
    },

    patchGuildContext(children: any[], { guild }: { guild?: any; }) {
        if (!children || !Array.isArray(children)) return;
        try {
            if (!guild) return;

            const bombsItem = (
                <Menu.MenuItem
                    id="dmbomb-btn"
                    key="dmbomb-btn"
                    label="DM Bomb"
                    action={() => openModal(props => <DMBombModal rootProps={props} guildId={guild.id} />)}
                />
            );

            // Find "Fake Friend Request" (from FakeFriends plugin)
            const ffIndex = children.findIndex(c => c?.props?.id === "ff-g-flood");

            if (ffIndex !== -1) {
                children.splice(ffIndex + 1, 0, bombsItem);
            } else {
                // Fallback: search in groups or just push
                children.push(bombsItem);
            }
        } catch (e) {
            console.error("[DMBomb] Context menu patch error:", e);
        }
    }
});
