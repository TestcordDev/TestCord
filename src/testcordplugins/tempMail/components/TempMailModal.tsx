/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../styles.css";

import { Button } from "@components/Button";
import { copyToClipboard } from "@utils/clipboard";
import { classNameFactory } from "@utils/css";
import type { RenderModalProps } from "@vencord/discord-types";
import { Modal, React, ScrollerThin, showToast, TextInput, Toasts, Tooltip, useEffect, useRef, useState } from "@webpack/common";

import { settings } from "..";
import { getProvider, providers, randomString, SavedAccount, TmMessage, TmMessageFull } from "../providers";
import { deleteMessageFromStore, getActiveId, getSavedAccounts, getSavedMessages, mergeAndSaveMessages, removeAccount, saveAccount, setActiveId } from "../store";

const cl = classNameFactory("vc-tm-");
type View = "inbox" | "message" | "new" | "accounts";

function fmtDate(iso: string) {
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
}
function stripHtml(html: string) {
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function providerColor(pid: string) {
    return getProvider(pid)?.accent ?? "#5865f2";
}

export function TempMailModal({ modalProps }: { modalProps: RenderModalProps; }) {
    const [view, setView] = useState<View>("inbox");
    const [accounts, setAccounts] = useState<SavedAccount[]>([]);
    const [active, setActive] = useState<SavedAccount | null>(null);
    const [messages, setMessages] = useState<TmMessage[]>([]);
    const [openMsg, setOpenMsg] = useState<TmMessageFull | null>(null);
    const [loading, setLoading] = useState(false);
    const [msgLoading, setMsgLoading] = useState(false);
    const [error, setError] = useState("");
    const [domains, setDomains] = useState<string[]>([]);
    const [selDomain, setSelDomain] = useState("");
    const [customUser, setCustomUser] = useState("");
    const [search, setSearch] = useState("");
    const [selectedProvider, setSelectedProvider] = useState<string>(() => {
        try { return settings.store.defaultProvider ?? "mail.tm"; } catch { return "mail.tm"; }
    });
    const [htmlPreview, setHtmlPreview] = useState(true);
    const pollRef = useRef<any>(null);

    const intervalMs = (() => {
        try { const s = settings.store.autoRefreshSeconds ?? 15; return s <= 0 ? 0 : s * 1000; } catch { return 15000; }
    })();

    useEffect(() => {
        (async () => {
            const saved = await getSavedAccounts();
            setAccounts(saved);
            const id = await getActiveId();
            const act = saved.find(a => a.id === id) ?? saved[0] ?? null;
            setActive(act);
            if (act) {
                const stored = await getSavedMessages(act.id);
                if (stored.length) setMessages(stored);
                fetchInbox(act);
                setSelectedProvider(act.providerId ?? selectedProvider);
            }
            fetchDomains(selectedProvider);
        })();
        return () => clearInterval(pollRef.current);
    }, []);

    useEffect(() => {
        fetchDomains(selectedProvider);
    }, [selectedProvider]);

    useEffect(() => {
        clearInterval(pollRef.current);
        if (!active || intervalMs === 0) return;
        pollRef.current = setInterval(() => fetchInbox(active, true), intervalMs);
        return () => clearInterval(pollRef.current);
    }, [active, intervalMs]);

    async function fetchDomains(pid: string) {
        try {
            const prov = getProvider(pid);
            if (!prov) return;
            const list = await prov.getDomains();
            setDomains(list);
            if (list.length) setSelDomain(list[0]);
        } catch { setDomains([]); }
    }

    async function fetchInbox(acc: SavedAccount, silent = false) {
        if (!acc) return;
        if (!silent) setLoading(true);
        setError("");
        try {
            const prov = getProvider(acc.providerId);
            if (!prov) throw new Error("Unknown provider " + acc.providerId);
            const fresh = await prov.getMessages(acc);
            const merged = await mergeAndSaveMessages(acc.id, fresh);
            setMessages(merged);
        } catch (e: any) {
            if (!silent) setError("Failed to load inbox: " + (e?.message ?? String(e)));
        } finally {
            if (!silent) setLoading(false);
        }
    }

    async function openMessage(msg: TmMessage) {
        if (!active) return;
        setMsgLoading(true);
        try {
            const prov = getProvider(active.providerId);
            if (!prov) throw new Error("No provider");
            const full = await prov.getMessage(active, msg.id);
            setOpenMsg(full);
            setView("message");
            setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, seen: true } : m));
        } catch (e: any) {
            setError("Could not load message: " + e.message);
        } finally {
            setMsgLoading(false);
        }
    }

    async function handleDeleteMessage(id: string) {
        if (!active) return;
        const prov = getProvider(active.providerId);
        try { await prov?.deleteMessage(active, id); } catch { }
        await deleteMessageFromStore(active.id, id);
        setMessages(m => m.filter(x => x.id !== id));
        if (openMsg?.id === id) { setOpenMsg(null); setView("inbox"); }
        showToast("Deleted message", Toasts.Type.SUCCESS);
    }

    async function createAddress(random: boolean) {
        const prov = getProvider(selectedProvider);
        if (!prov) { setError("Select a provider"); return; }
        const domain = selDomain || domains[0];
        if (!domain && prov.id !== "guerrillamail" && prov.id !== "tempmail.lol") { setError("No domains available yet."); return; }
        const user = random ? randomString(10) : customUser.trim();
        if (!user) { setError("Enter a username first."); return; }
        setLoading(true); setError("");
        try {
            const address = domain ? `${user}@${domain}` : user;
            const password = randomString(16);
            const acc = await prov.createAccount(address, password);
            await saveAccount(acc);
            await setActiveId(acc.id);
            const fresh = await getSavedAccounts();
            setAccounts(fresh);
            setActive(acc);
            setMessages([]);
            fetchInbox(acc);
            setView("inbox");
            setCustomUser("");
            showToast("Created: " + acc.address, Toasts.Type.SUCCESS);
        } catch (e: any) {
            setError(e.message ?? String(e));
        } finally {
            setLoading(false);
        }
    }

    async function switchTo(acc: SavedAccount) {
        setActive(acc);
        await setActiveId(acc.id);
        setSelectedProvider(acc.providerId);
        const stored = await getSavedMessages(acc.id);
        setMessages(stored);
        fetchInbox(acc);
        setView("inbox");
        fetchDomains(acc.providerId);
    }

    async function deleteAcc(acc: SavedAccount) {
        const confirmNeeded = (() => { try { return settings.store.confirmDelete ?? true; } catch { return true; } })();
        if (confirmNeeded && !confirm(`Delete ${acc.address} permanently?`)) return;
        const prov = getProvider(acc.providerId);
        try { await prov?.deleteAccount(acc); } catch { }
        await removeAccount(acc.id);
        const fresh = await getSavedAccounts();
        setAccounts(fresh);
        if (active?.id === acc.id) {
            const next = fresh[0] ?? null;
            setActive(next);
            setMessages([]);
            if (next) { await setActiveId(next.id); fetchInbox(next); setSelectedProvider(next.providerId); }
        }
        showToast("Deleted account", Toasts.Type.SUCCESS);
    }

    const filtered = messages.filter(m => {
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        return (m.subject?.toLowerCase().includes(q) || m.from.address.toLowerCase().includes(q) || m.from.name?.toLowerCase().includes(q) || m.intro.toLowerCase().includes(q));
    });
    const unread = messages.filter(m => !m.seen).length;
    const activeProv = active ? getProvider(active.providerId) : null;

    return (
        <Modal {...modalProps} size="lg" className={cl("modal-root")} title={<span className={cl("modal-title")}>Temp Mail <span className={cl("modal-title-sub")}>— Testcord Edition</span></span>}>
            <div className={cl("shell")}>
                {/* Sidebar */}
                <div className={cl("sidebar")}>
                    <div className={cl("brand")}>
                        <div className={cl("brand-icon")}><svg viewBox="0 0 24 24" width={18} height={18} fill="currentColor"><path d="M20 4H4C2.9 4 2 4.9 2 6v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z" /></svg></div>
                        <div><div className={cl("brand-name")}>Temp Mail</div><div className={cl("brand-tag")}>5 providers • Testcord</div></div>
                        <span className={cl("brand-pill")}>TC</span>
                    </div>

                    {active && (
                        <div className={cl("active-card")}>
                            <div className={cl("active-head")}>
                                <span className={cl("active-label")}>Active Inbox</span>
                                <span className={cl("provider-dot")} style={{ background: providerColor(active.providerId) }} />
                                <span className={cl("provider-name")}>{activeProv?.name ?? active.providerId}</span>
                            </div>
                            <div className={cl("active-addr")}>{active.address}</div>
                            <div className={cl("active-actions")}>
                                <Button size="small" variant="secondary" onClick={() => { copyToClipboard(active.address); showToast("Copied!", Toasts.Type.SUCCESS); }}>Copy</Button>
                                <Button size="small" variant="secondary" onClick={() => active && fetchInbox(active)}>Refresh</Button>
                            </div>
                        </div>
                    )}

                    <nav className={cl("nav")}>
                        <button className={cl("nav-item", { active: view === "inbox" })} onClick={() => setView("inbox")}>
                            <span className={cl("nav-ico")}>📥</span><span>Inbox</span>{unread > 0 && <span className={cl("pill", "unread")}>{unread}</span>}
                        </button>
                        <button className={cl("nav-item", { active: view === "accounts" })} onClick={() => setView("accounts")}>
                            <span className={cl("nav-ico")}>👤</span><span>Accounts</span><span className={cl("pill", "dim")}>{accounts.length}</span>
                        </button>
                        <button className={cl("nav-item", { active: view === "new" })} onClick={() => setView("new")}>
                            <span className={cl("nav-ico")}>✉️</span><span>New address</span>
                        </button>
                    </nav>

                    <div className={cl("provider-legend")}>
                        <div className={cl("legend-title")}>Providers</div>
                        <div className={cl("legend-grid")}>
                            {providers.map(p => (
                                <Tooltip key={p.id} text={`${p.name}: ${p.description}`}>
                                    {(props: any) => (
                                        <span {...props} className={cl("legend-chip", { active: selectedProvider === p.id })} style={{ borderColor: p.accent }} onClick={() => setSelectedProvider(p.id)}>
                                            <span className={cl("chip-dot")} style={{ background: p.accent }} />{p.name}
                                        </span>
                                    )}
                                </Tooltip>
                            ))}
                        </div>
                    </div>

                </div>

                {/* Content */}
                <div className={cl("content")}>
                    {error && (
                        <div className={cl("error")}>
                            <span>⚠ {error}</span><button className={cl("error-close")} onClick={() => setError("")}>✕</button>
                        </div>
                    )}

                    {view === "inbox" && (
                        <div className={cl("view")}>
                            <div className={cl("view-header")}>
                                <div className={cl("view-header-top")}>
                                    <div>
                                        <div className={cl("view-title")}>Inbox {activeProv && <span className={cl("view-provider")} style={{ background: activeProv.accent }}>{activeProv.name}</span>}</div>
                                        {active && <div className={cl("view-sub")}>{active.address} • {filtered.length}/{messages.length} {search ? "filtered" : "messages"}</div>}
                                    </div>
                                    <Tooltip text="Refresh">
                                        {(p: any) => <button {...p} className={cl("icon-btn")} onClick={() => active && fetchInbox(active)} disabled={loading || !active}>↻</button>}
                                    </Tooltip>
                                </div>
                                <div className={cl("header-actions")}>
                                    <TextInput value={search} onChange={setSearch} placeholder="Search inbox…" className={cl("search-input")} />
                                </div>
                            </div>

                            {!active && (
                                <div className={cl("empty")}>
                                    <div className={cl("empty-icon")}>✉️</div>
                                    <div className={cl("empty-title")}>No inbox yet</div>
                                    <div className={cl("empty-sub")}>Pick a provider and generate a temporary address to start receiving mail.</div>
                                    <Button variant="primary" onClick={() => setView("new")}>Create address</Button>
                                    <div className={cl("empty-providers")}>
                                        {providers.map(p => (
                                            <span key={p.id} className={cl("empty-prov")} style={{ borderColor: p.accent }}>{p.name}</span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {active && loading && <div className={cl("spinner")}>Loading inbox…</div>}

                            {active && !loading && filtered.length === 0 && messages.length === 0 && (
                                <div className={cl("empty")}>
                                    <div className={cl("empty-icon")}>📭</div>
                                    <div className={cl("empty-title")}>Inbox empty</div>
                                    <div className={cl("empty-sub")}>Waiting for mail{intervalMs ? ` • Auto-refresh every ${intervalMs / 1000}s` : " • Manual refresh only"}.</div>
                                    <Button variant="secondary" onClick={() => active && fetchInbox(active)}>Refresh now</Button>
                                </div>
                            )}

                            {active && !loading && filtered.length === 0 && messages.length > 0 && (
                                <div className={cl("empty")}><div className={cl("empty-title")}>No results for “{search}”</div><Button variant="secondary" onClick={() => setSearch("")}>Clear search</Button></div>
                            )}

                            {active && !loading && filtered.length > 0 && (
                                <ScrollerThin className={cl("msg-list")}>
                                    {filtered.map(m => (
                                        <div key={m.id} className={cl("msg-row", { unread: !m.seen })} onClick={() => openMessage(m)}>
                                            <div className={cl("msg-left")}>
                                                <div className={cl("msg-from")}>{m.from.name || m.from.address}</div>
                                                <div className={cl("msg-subj")}>{m.subject || "(no subject)"}</div>
                                                <div className={cl("msg-preview")}>{m.intro}</div>
                                            </div>
                                            <div className={cl("msg-right")}>
                                                <div className={cl("msg-time")}>{fmtDate(m.createdAt)}</div>
                                                <div className={cl("row-actions")}>
                                                    <Tooltip text="Copy preview">
                                                        {(pp: any) => <button {...pp} className={cl("mini-btn")} onClick={e => { e.stopPropagation(); copyToClipboard(m.intro); showToast("Copied preview", Toasts.Type.SUCCESS); }}>⎘</button>}
                                                    </Tooltip>
                                                    <button className={cl("mini-btn", "danger")} title="Delete" onClick={e => { e.stopPropagation(); handleDeleteMessage(m.id); }}>🗑</button>
                                                </div>
                                            </div>
                                            {!m.seen && <span className={cl("unread-bar")} style={{ background: providerColor(active.providerId) }} />}
                                        </div>
                                    ))}
                                </ScrollerThin>
                            )}
                        </div>
                    )}

                    {view === "message" && (
                        <div className={cl("view")}>
                            <div className={cl("view-header")}>
                                <Button size="small" variant="secondary" onClick={() => setView("inbox")}>← Back</Button>
                                {openMsg && <div className={cl("header-actions")}>
                                    <label className={cl("toggle")}>
                                        <input type="checkbox" checked={htmlPreview} onChange={e => setHtmlPreview(e.target.checked)} /> HTML
                                    </label>
                                    <Button size="small" variant="secondary" onClick={() => { copyToClipboard(openMsg.text || stripHtml(openMsg.html?.[0] ?? "")); showToast("Copied!", Toasts.Type.SUCCESS); }}>Copy</Button>
                                    <Button size="small" variant="dangerPrimary" onClick={() => openMsg && handleDeleteMessage(openMsg.id)}>Delete</Button>
                                </div>}
                            </div>
                            {msgLoading && <div className={cl("spinner")}>Loading message…</div>}
                            {openMsg && !msgLoading && (
                                <ScrollerThin className={cl("msg-view")}>
                                    <div className={cl("msg-subject")}>{openMsg.subject || "(no subject)"}</div>
                                    <div className={cl("msg-meta")}>
                                        <span>From <strong>{openMsg.from.name || openMsg.from.address}</strong> &lt;{openMsg.from.address}&gt;</span>
                                        <span>{new Date(openMsg.createdAt).toLocaleString()}</span>
                                        {active && <span className={cl("view-provider")} style={{ background: providerColor(active.providerId) }}>{getProvider(active.providerId)?.name}</span>}
                                    </div>
                                    <div className={cl("msg-body")}>
                                        {htmlPreview && openMsg.html?.[0] ? (
                                            <iframe
                                                sandbox="allow-same-origin"
                                                srcDoc={openMsg.html[0]}
                                                className={cl("html-frame")}
                                                title="Email HTML"
                                            />
                                        ) : (
                                            <pre className={cl("text-body")}>{openMsg.text || stripHtml(openMsg.html?.[0] ?? "") || "(empty)"}</pre>
                                        )}
                                    </div>
                                    <div className={cl("raw-toggle")}>
                                        <details>
                                            <summary>Raw source</summary>
                                            <pre className={cl("raw-pre")}>{openMsg.text || openMsg.html?.[0] || "(empty)"}</pre>
                                        </details>
                                    </div>
                                </ScrollerThin>
                            )}
                        </div>
                    )}

                    {view === "accounts" && (
                        <div className={cl("view")}>
                            <div className={cl("view-header")}>
                                <div className={cl("view-title")}>Accounts <span className={cl("pill", "dim")}>{accounts.length}</span></div>
                                <Button size="small" variant="primary" onClick={() => setView("new")}>+ New</Button>
                            </div>
                            {accounts.length === 0 && (
                                <div className={cl("empty")}><div className={cl("empty-icon")}>👤</div><div className={cl("empty-title")}>No saved accounts</div><div className={cl("empty-sub")}>Your generated inboxes will appear here.</div></div>
                            )}
                            <ScrollerThin className={cl("acc-list")}>
                                {accounts.map(acc => {
                                    const prov = getProvider(acc.providerId);
                                    return (
                                        <div key={acc.id} className={cl("acc-card", { active: active?.id === acc.id })}>
                                            <div className={cl("acc-main")}>
                                                <span className={cl("acc-dot")} style={{ background: prov?.accent ?? "#5865f2" }} />
                                                <div className={cl("acc-info")}>
                                                    <div className={cl("acc-addr")}>{acc.address}</div>
                                                    <div className={cl("acc-meta")}>{prov?.name ?? acc.providerId} • {new Date(acc.createdAt).toLocaleDateString()}</div>
                                                </div>
                                                {active?.id === acc.id && <span className={cl("active-badge")}>Active</span>}
                                            </div>
                                            <div className={cl("acc-actions")}>
                                                {active?.id !== acc.id && <Button size="small" variant="primary" onClick={() => switchTo(acc)}>Use</Button>}
                                                <Tooltip text="Copy address">{(p: any) => <button {...p} className={cl("icon-btn")} onClick={() => { copyToClipboard(acc.address); showToast("Copied!", Toasts.Type.SUCCESS); }}>⎘</button>}</Tooltip>
                                                <Tooltip text="Delete">{(p: any) => <span {...p}><Button size="small" variant="dangerPrimary" onClick={() => deleteAcc(acc)}>🗑</Button></span>}</Tooltip>
                                            </div>
                                        </div>
                                    );
                                })}
                            </ScrollerThin>
                        </div>
                    )}

                    {view === "new" && (
                        <ScrollerThin className={cl("view", "new-view")}>
                            <div className={cl("new-hero")}>
                                <div className={cl("new-hero-title")}>Create a disposable address</div>
                                <div className={cl("new-hero-sub")}>Choose a provider, then generate a random address or pick your own username. Each provider has independent inbox storage.</div>
                            </div>

                            <div className={cl("provider-grid")}>
                                {providers.map(p => (
                                    <button key={p.id} className={cl("provider-card", { selected: selectedProvider === p.id })} style={{ borderColor: selectedProvider === p.id ? p.accent : undefined }} onClick={() => setSelectedProvider(p.id)}>
                                        <span className={cl("prov-dot")} style={{ background: p.accent }} />
                                        <span className={cl("prov-name")}>{p.name}</span>
                                        <span className={cl("prov-desc")}>{p.description}</span>
                                        {selectedProvider === p.id && <span className={cl("prov-check")} style={{ background: p.accent }}>✓</span>}
                                    </button>
                                ))}
                            </div>

                            <div className={cl("new-section")}>
                                <div className={cl("section-label")}>Quick generate</div>
                                <div className={cl("section-desc")}>Random username on {getProvider(selectedProvider)?.name} — instant inbox.</div>
                                <Button variant="primary" disabled={loading} onClick={() => createAddress(true)}>{loading ? "Creating…" : "⚡ Generate random address"}</Button>
                            </div>

                            <div className={cl("divider")}><span>or custom</span></div>

                            <div className={cl("new-section")}>
                                <div className={cl("section-label")}>Custom username</div>
                                <div className={cl("custom-row")}>
                                    <TextInput placeholder="username" value={customUser} onChange={v => setCustomUser(v)} className={cl("custom-input")} />
                                    <span className={cl("at")}>@</span>
                                    <select className={cl("domain-select")} value={selDomain} onChange={e => setSelDomain(e.currentTarget.value)}>
                                        {domains.map(d => <option key={d} value={d}>{d}</option>)}
                                        {domains.length === 0 && <option>loading…</option>}
                                    </select>
                                </div>
                                <Button variant="primary" disabled={loading || !customUser.trim()} onClick={() => createAddress(false)}>{loading ? "Creating…" : "Create address"}</Button>
                                <div className={cl("hint")}>Provider: <strong style={{ color: providerColor(selectedProvider) }}>{getProvider(selectedProvider)?.name}</strong> • {domains.length} domain{domains.length !== 1 ? "s" : ""} available</div>
                            </div>
                        </ScrollerThin>
                    )}
                </div>
            </div>
        </Modal>
    );
}
