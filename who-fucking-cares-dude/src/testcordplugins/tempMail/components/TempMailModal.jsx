/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import "../styles.css";
import { copyToClipboard } from "@utils/clipboard";
import { Modal, React, showToast, TextInput, Toasts, useEffect, useRef, useState } from "@webpack/common";
import { createAccount, deleteAccount, deleteMessage, getDomains, getMessage, getMessages, getToken, randomString, } from "../api";
import { deleteMessageFromStore, getActiveId, getDataStorePath, getSavedAccounts, getSavedMessages, mergeAndSaveMessages, removeAccount, saveAccount, setActiveId, } from "../store";
export function TempMailModal({ modalProps }) {
    const [view, setView] = useState("inbox");
    const [accounts, setAccounts] = useState([]);
    const [active, setActive] = useState(null);
    const [messages, setMessages] = useState([]);
    const [openMsg, setOpenMsg] = useState(null);
    const [loading, setLoading] = useState(false);
    const [msgLoading, setMsgLoading] = useState(false);
    const [error, setError] = useState("");
    const [domains, setDomains] = useState([]);
    const [selDomain, setSelDomain] = useState("");
    const [customUser, setCustomUser] = useState("");
    const pollRef = useRef(null);
    useEffect(() => {
        (async () => {
            const saved = await getSavedAccounts();
            setAccounts(saved);
            const id = await getActiveId();
            const act = saved.find(a => a.id === id) ?? saved[0] ?? null;
            setActive(act);
            if (act) {
                const stored = await getSavedMessages(act.id);
                if (stored.length)
                    setMessages(stored);
                fetchInbox(act);
            }
        })();
        fetchDomains();
        return () => clearInterval(pollRef.current);
    }, []);
    useEffect(() => {
        clearInterval(pollRef.current);
        if (!active)
            return;
        pollRef.current = setInterval(() => fetchInbox(active, true), 15_000);
        return () => clearInterval(pollRef.current);
    }, [active]);
    async function fetchDomains() {
        try {
            const d = await getDomains();
            const names = d.filter(x => x.isActive).map(x => x.domain);
            setDomains(names);
            if (names.length)
                setSelDomain(names[0]);
        }
        catch { }
    }
    async function fetchInbox(acc, silent = false) {
        if (!silent)
            setLoading(true);
        setError("");
        try {
            const fresh = await getMessages(acc.token);
            const merged = await mergeAndSaveMessages(acc.id, fresh);
            setMessages(merged);
        }
        catch (e) {
            if (!silent)
                setError("Failed to load inbox: " + e.message);
        }
        finally {
            if (!silent)
                setLoading(false);
        }
    }
    async function openMessage(msg) {
        if (!active)
            return;
        setMsgLoading(true);
        try {
            const full = await getMessage(msg.id, active.token);
            setOpenMsg(full);
            setView("message");
        }
        catch (e) {
            setError("Could not load message: " + e.message);
        }
        finally {
            setMsgLoading(false);
        }
    }
    async function handleDeleteMessage(id) {
        if (!active)
            return;
        try {
            await deleteMessage(id, active.token);
        }
        catch { }
        await deleteMessageFromStore(active.id, id);
        setMessages(m => m.filter(x => x.id !== id));
        if (openMsg?.id === id) {
            setOpenMsg(null);
            setView("inbox");
        }
    }
    async function createAddress(random) {
        const domain = selDomain || domains[0];
        if (!domain) {
            setError("No domains available yet.");
            return;
        }
        const user = random ? randomString(10) : customUser.trim();
        if (!user) {
            setError("Enter a username first.");
            return;
        }
        setLoading(true);
        setError("");
        try {
            const address = `${user}@${domain}`;
            const password = randomString(16);
            const { id } = await createAccount(address, password);
            const token = await getToken(address, password);
            const acc = { id, address, token, createdAt: Date.now() };
            await saveAccount(acc);
            await setActiveId(id);
            const fresh = await getSavedAccounts();
            setAccounts(fresh);
            setActive(acc);
            setMessages([]);
            fetchInbox(acc);
            setView("inbox");
            setCustomUser("");
            showToast("Created: " + address, Toasts.Type.SUCCESS);
        }
        catch (e) {
            setError(e.message);
        }
        finally {
            setLoading(false);
        }
    }
    async function switchTo(acc) {
        setActive(acc);
        await setActiveId(acc.id);
        const stored = await getSavedMessages(acc.id);
        setMessages(stored);
        fetchInbox(acc);
        setView("inbox");
    }
    async function deleteAcc(acc) {
        if (!confirm(`Delete ${acc.address} permanently?`))
            return;
        try {
            await deleteAccount(acc.id, acc.token);
        }
        catch { }
        await removeAccount(acc.id);
        const fresh = await getSavedAccounts();
        setAccounts(fresh);
        if (active?.id === acc.id) {
            const next = fresh[0] ?? null;
            setActive(next);
            setMessages([]);
            if (next) {
                await setActiveId(next.id);
                fetchInbox(next);
            }
        }
    }
    const unread = messages.filter(m => !m.seen).length;
    return (<Modal {...modalProps} size="lg" title="Temp Mail">
            <div className="tm-shell">

                {/* ── Sidebar ─────────────────────────────────────── */}
                <div className="tm-sidebar">
                    <div className="tm-brand">
                        <svg viewBox="0 0 24 24" width={18} height={18} fill="currentColor"><path d="M20 4H4C2.9 4 2 4.9 2 6v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/></svg>
                        <span>Temp Mail</span>
                    </div>

                    {active && (<div className="tm-active-addr">
                            <div className="tm-active-label">Active</div>
                            <div className="tm-active-text">{active.address}</div>
                            <button className="tm-copy-btn" onClick={() => { copyToClipboard(active.address); showToast("Copied!", Toasts.Type.SUCCESS); }}>
                                Copy address
                            </button>
                        </div>)}

                    <nav className="tm-nav">
                        <button className={`tm-nav-item ${view === "inbox" ? "tm-active" : ""}`} onClick={() => setView("inbox")}>
                            <span className="tm-nav-icon">📥</span>
                            <span>Inbox</span>
                            {unread > 0 && <span className="tm-unread-pill">{unread}</span>}
                        </button>
                        <button className={`tm-nav-item ${view === "accounts" ? "tm-active" : ""}`} onClick={() => setView("accounts")}>
                            <span className="tm-nav-icon">👤</span>
                            <span>Accounts</span>
                            <span className="tm-count-dim">{accounts.length}</span>
                        </button>
                        <button className={`tm-nav-item ${view === "new" ? "tm-active" : ""}`} onClick={() => setView("new")}>
                            <span className="tm-nav-icon">✉</span>
                            <span>New address</span>
                        </button>
                    </nav>

                    <div className="tm-sidebar-footer">
                        <div className="tm-storage-info">
                            <span className="tm-storage-icon">💾</span>
                            <div>
                                <div className="tm-storage-title">Emails saved to</div>
                                <div className="tm-storage-path">{getDataStorePath()}</div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* ── Content ─────────────────────────────────────── */}
                <div className="tm-content">
                    {error && (<div className="tm-error-bar">
                            <span>⚠ {error}</span>
                            <button onClick={() => setError("")}>✕</button>
                        </div>)}

                    {/* INBOX */}
                    {view === "inbox" && (<div className="tm-view">
                            <div className="tm-view-header">
                                <div>
                                    <div className="tm-view-title">Inbox</div>
                                    {active && <div className="tm-view-sub">{active.address}</div>}
                                </div>
                                <button className="tm-icon-btn" title="Refresh" onClick={() => active && fetchInbox(active)} disabled={loading}>
                                    <svg viewBox="0 0 24 24" width={16} height={16} fill="currentColor"><path d="M17.65 6.35A7.95 7.95 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
                                </button>
                            </div>

                            {!active && (<div className="tm-empty-state">
                                    <div className="tm-empty-icon">✉</div>
                                    <div className="tm-empty-title">No account yet</div>
                                    <div className="tm-empty-sub">Create a temporary address to start receiving emails</div>
                                    <button className="tm-btn-primary" onClick={() => setView("new")}>Create address</button>
                                </div>)}

                            {active && loading && <div className="tm-spinner">Loading…</div>}

                            {active && !loading && messages.length === 0 && (<div className="tm-empty-state">
                                    <div className="tm-empty-icon">📭</div>
                                    <div className="tm-empty-title">No messages yet</div>
                                    <div className="tm-empty-sub">Auto-refreshes every 15 seconds</div>
                                </div>)}

                            {active && !loading && messages.length > 0 && (<div className="tm-message-list">
                                    {messages.map(m => (<div key={m.id} className={`tm-msg-row ${!m.seen ? "tm-msg-unread" : ""}`} onClick={() => openMessage(m)}>
                                            <div className="tm-msg-left">
                                                <div className="tm-msg-from">{m.from.name || m.from.address}</div>
                                                <div className="tm-msg-subject">{m.subject || "(no subject)"}</div>
                                                <div className="tm-msg-preview">{m.intro}</div>
                                            </div>
                                            <div className="tm-msg-right">
                                                <div className="tm-msg-time">{fmtDate(m.createdAt)}</div>
                                                <button className="tm-del-btn" title="Delete" onClick={e => { e.stopPropagation(); handleDeleteMessage(m.id); }}>
                                                    <svg viewBox="0 0 24 24" width={14} height={14} fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                                                </button>
                                            </div>
                                        </div>))}
                                </div>)}
                        </div>)}

                    {/* MESSAGE VIEW */}
                    {view === "message" && (<div className="tm-view">
                            <div className="tm-view-header">
                                <button className="tm-back-btn" onClick={() => setView("inbox")}>← Back</button>
                                {openMsg && (<button className="tm-btn-danger-sm" onClick={() => openMsg && handleDeleteMessage(openMsg.id)}>Delete</button>)}
                            </div>
                            {msgLoading && <div className="tm-spinner">Loading message…</div>}
                            {openMsg && !msgLoading && (<div className="tm-msg-view">
                                    <div className="tm-msg-view-subject">{openMsg.subject || "(no subject)"}</div>
                                    <div className="tm-msg-view-meta">
                                        <span>From <strong>{openMsg.from.name || openMsg.from.address}</strong></span>
                                        <span>{fmtDate(openMsg.createdAt)}</span>
                                    </div>
                                    <div className="tm-msg-view-body">
                                        {openMsg.text || stripHtml(openMsg.html?.[0] ?? "") || "(empty)"}
                                    </div>
                                </div>)}
                        </div>)}

                    {/* ACCOUNTS */}
                    {view === "accounts" && (<div className="tm-view">
                            <div className="tm-view-header">
                                <div className="tm-view-title">Accounts</div>
                                <button className="tm-btn-primary-sm" onClick={() => setView("new")}>+ New</button>
                            </div>
                            {accounts.length === 0 && (<div className="tm-empty-state">
                                    <div className="tm-empty-icon">👤</div>
                                    <div className="tm-empty-title">No saved accounts</div>
                                </div>)}
                            <div className="tm-account-list">
                                {accounts.map(acc => (<div key={acc.id} className={`tm-account-card ${active?.id === acc.id ? "tm-account-active" : ""}`}>
                                        <div className="tm-account-main">
                                            {active?.id === acc.id && <span className="tm-active-dot"/>}
                                            <div>
                                                <div className="tm-account-addr">{acc.address}</div>
                                                <div className="tm-account-date">Created {new Date(acc.createdAt).toLocaleDateString()}</div>
                                            </div>
                                        </div>
                                        <div className="tm-account-btns">
                                            {active?.id !== acc.id && (<button className="tm-btn-primary-sm" onClick={() => switchTo(acc)}>Use</button>)}
                                            <button className="tm-icon-btn" title="Copy" onClick={() => { copyToClipboard(acc.address); showToast("Copied!", Toasts.Type.SUCCESS); }}>
                                                <svg viewBox="0 0 24 24" width={14} height={14} fill="currentColor"><path d="M16 1H4C2.9 1 2 1.9 2 3v14h2V3h12V1zm3 4H8C6.9 5 6 5.9 6 7v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
                                            </button>
                                            <button className="tm-icon-btn tm-icon-btn-danger" title="Delete account" onClick={() => deleteAcc(acc)}>
                                                <svg viewBox="0 0 24 24" width={14} height={14} fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                                            </button>
                                        </div>
                                    </div>))}
                            </div>
                        </div>)}

                    {/* NEW ADDRESS */}
                    {view === "new" && (<div className="tm-view">
                            <div className="tm-view-header">
                                <div className="tm-view-title">New address</div>
                            </div>
                            <div className="tm-new-section">
                                <div className="tm-new-label">Quick generate</div>
                                <div className="tm-new-desc">Creates a random address instantly</div>
                                <button className="tm-btn-primary" onClick={() => createAddress(true)} disabled={loading || !domains.length}>
                                    {loading ? "Creating…" : "⚡ Generate random address"}
                                </button>
                            </div>

                            <div className="tm-divider"><span>or choose your own</span></div>

                            <div className="tm-new-section">
                                <div className="tm-new-label">Custom address</div>
                                <div className="tm-custom-input-row">
                                    <TextInput placeholder="username" value={customUser} onChange={v => setCustomUser(v)} className="tm-text-input"/>
                                    <span className="tm-at-sign">@</span>
                                    <select className="tm-domain-select" value={selDomain} onChange={e => setSelDomain(e.currentTarget.value)}>
                                        {domains.map(d => <option key={d} value={d}>{d}</option>)}
                                    </select>
                                </div>
                                <button className="tm-btn-primary" onClick={() => createAddress(false)} disabled={loading || !customUser.trim() || !domains.length}>
                                    {loading ? "Creating…" : "Create address"}
                                </button>
                            </div>
                        </div>)}
                </div>
            </div>
        </Modal>);
}
function fmtDate(iso) {
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString())
        return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
function stripHtml(html) {
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
