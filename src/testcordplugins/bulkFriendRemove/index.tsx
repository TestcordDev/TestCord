/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { HeaderBarButton } from "@api/HeaderBar";
import { sleep } from "@utils/misc";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { Forms, React, useEffect, useMemo, useState } from "@webpack/common";

import { t, useTranslation } from "../autoTranslateNightcord";

const RelationshipStore = findStoreLazy("RelationshipStore");
const UserStore = findStoreLazy("UserStore");
const RelationshipActions = findByPropsLazy("removeFriend", "sendFriendRequest");

function removeFriend(id: string): Promise<any> {
    // Method 1: use native Discord module (RelationshipActions)
    try {
        if (RelationshipActions?.removeFriend) {
            return Promise.resolve(RelationshipActions.removeFriend(id));
        }
    } catch { }
    // Method 2: direct REST API fallback
    const token = (() => { try { return (window as any).Vencord?.Webpack?.findByProps?.("getToken")?.getToken?.() ?? ""; } catch { return ""; } })();
    if (!token) return Promise.reject(new Error("No token"));
    return fetch(`https://discord.com/api/v9/users/@me/relationships/${encodeURIComponent(id)}`, { method: "DELETE", headers: { Authorization: token } });
}

function BulkRemoveIcon({ width = 20, height = 20 }: { width?: number; height?: number; }) {
    return <svg width={width} height={height} viewBox="0 0 24 24" fill="currentColor"><path d="M11.53 11A9.53 9.53 0 0 0 2 20.53c0 .81.66 1.47 1.47 1.47h.22c.24 0 .44-.17.5-.4.29-1.12.84-2.17 1.32-2.91.14-.21.43-.1.4.15l-.25 2.61c-.03.3.2.55.5.55h7.63c.12 0 .17-.31.06-.36C12.82 21.14 12 20.22 12 19a3 3 0 0 1 3-3h5.02c.38 0 .61-.4.4-.72A9.52 9.52 0 0 0 12.47 11h-.94ZM12 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" /><path d="M15 18a1 1 0 1 0 0 2h8a1 1 0 0 0 0-2h-8Z" /></svg>;
}

function CheckboxIcon({ checked }: { checked: boolean; }) {
    if (checked) return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect width="16" height="16" rx="4" fill="var(--brand-500, #5865f2)" />
            <path d="M3.5 8l3 3 6-6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="0.75" y="0.75" width="14.5" height="14.5" rx="3.25" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" />
        </svg>
    );
}

function TrashIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z" />
        </svg>
    );
}

function RefreshIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35Z" />
        </svg>
    );
}

function SpinnerIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ animation: "bfr-spin 1s linear infinite" }}>
            <path d="M12 4V2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8Z" />
        </svg>
    );
}

interface Friend { id: string; username: string; globalName: string; avatar: string | null; selected: boolean; removing: boolean; }

function getAvatarUrl(id: string, avatar: string | null) {
    if (avatar) return `https://cdn.discordapp.com/avatars/${id}/${avatar}.webp?size=40`;
    return `https://cdn.discordapp.com/embed/avatars/${Math.abs(parseInt(id.slice(-4), 16)) % 5}.png`;
}

function loadFriends(): Friend[] {
    try {
        let ids: string[] = [];
        try { const r = RelationshipStore.getFriendIDs?.(); if (Array.isArray(r) && r.length) ids = r; } catch { }
        if (!ids.length) {
            try { const rels = RelationshipStore.getRelationships?.(); if (rels) ids = Object.entries(rels).filter(([, t]) => t === 1).map(([id]) => id); } catch { }
        }
        return ids.map(id => {
            const u = UserStore?.getUser?.(id);
            return { id, username: u?.username ?? id, globalName: u?.globalName ?? u?.username ?? id, avatar: u?.avatar ?? null, selected: false, removing: false };
        }).sort((a, b) => a.globalName.localeCompare(b.globalName));
    } catch { return []; }
}

function BulkFriendRemoveModal({ rootProps }: { rootProps: any; }) {
    const { t } = useTranslation();
    const [friends, setFriends] = useState<Friend[]>([]);
    const [search, setSearch] = useState("");
    const [removing, setRemoving] = useState(false);
    const [progress, setProgress] = useState({ done: 0, total: 0 });

    useEffect(() => { setFriends(loadFriends()); }, []);

    const filtered = useMemo(() => {
        const q = search.toLowerCase();
        return friends.filter(f => !q || f.globalName.toLowerCase().includes(q) || f.username.toLowerCase().includes(q));
    }, [friends, search]);

    const selected = friends.filter(f => f.selected);
    const allSelected = filtered.length > 0 && filtered.every(f => f.selected);

    function toggle(id: string) { setFriends(p => p.map(f => f.id === id ? { ...f, selected: !f.selected } : f)); }
    function toggleAll() { const n = !allSelected; setFriends(p => p.map(f => filtered.find(ff => ff.id === f.id) ? { ...f, selected: n } : f)); }

    async function removeSelected() {
        if (!selected.length || removing) return;
        setRemoving(true); setProgress({ done: 0, total: selected.length });
        for (let i = 0; i < selected.length; i++) {
            const f = selected[i];
            setFriends(p => p.map(x => x.id === f.id ? { ...x, removing: true } : x));
            try {
                await removeFriend(f.id);
                setFriends(p => p.filter(x => x.id !== f.id));
            } catch (e) {
                console.warn("[BulkFriendRemove] Failed:", f.id, e);
                setFriends(p => p.map(x => x.id === f.id ? { ...x, removing: false, selected: false } : x));
            }
            setProgress({ done: i + 1, total: selected.length });
            await sleep(800);
        }
        setRemoving(false);
    }

    return (
        <ModalRoot {...rootProps} size="medium">
            <ModalHeader separator={false}>
                <Forms.FormTitle tag="h4" style={{ margin: 0, display: "flex", alignItems: "center", gap: 8, color: "#ffffff" }}>
                    <BulkRemoveIcon width={16} height={16} /> {t("Remove friends")}
                </Forms.FormTitle>
                <ModalCloseButton onClick={rootProps.onClose} />
            </ModalHeader>
            <ModalContent className="bfr-content">
                {/* Search bar + select all */}
                <div className="bfr-search-bar">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.4, flexShrink: 0 }}>
                        <path d="M21.71 20.29l-5.01-5.01A7.94 7.94 0 0 0 18 10a8 8 0 1 0-8 8 7.94 7.94 0 0 0 5.28-1.3l5.01 5.01a1 1 0 0 0 1.42-1.42ZM4 10a6 6 0 1 1 6 6 6 6 0 0 1-6-6Z" />
                    </svg>
                    <input className="bfr-search-input" placeholder={t("Search for a friend...")} value={search} onChange={e => setSearch(e.target.value)} autoFocus />
                    {search && (
                        <button className="bfr-search-clear" onClick={() => setSearch("")}>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
                        </button>
                    )}
                    <div className="bfr-search-sep" />
                    <button className="bfr-select-all" onClick={toggleAll} title={allSelected ? t("Deselect all") : t("Select all")}>
                        <CheckboxIcon checked={allSelected} />
                        <span>{t("All")}</span>
                    </button>
                </div>

                <Forms.FormTitle tag="h5" style={{ margin: "4px 0" }}>
                    {friends.length} {friends.length !== 1 ? t("friends") : t("friend")}
                    {selected.length > 0 && <span className="bfr-selected-count"> · {selected.length} {selected.length !== 1 ? t("selected") : t("selected")}</span>}
                </Forms.FormTitle>

                <div className="bfr-list">
                    {filtered.length === 0 && <div className="bfr-empty">{t("No friends found")}</div>}
                    {filtered.map(f => (
                        <div key={f.id} className={`bfr-row ${f.selected ? "bfr-row--selected" : ""}`} onClick={() => !f.removing && toggle(f.id)}>
                            <div className="bfr-checkbox"><CheckboxIcon checked={f.selected} /></div>
                            <img src={getAvatarUrl(f.id, f.avatar)} className="bfr-avatar" alt="" />
                            <div className="bfr-info">
                                <span className="bfr-name">{f.globalName}</span>
                                <span className="bfr-tag">@{f.username}</span>
                            </div>
                            {f.removing && <SpinnerIcon />}
                        </div>
                    ))}
                </div>

                {removing && (
                    <div className="bfr-progress-wrap">
                        <div className="bfr-progress-bar"><div className="bfr-progress-fill" style={{ width: `${Math.round(progress.done / progress.total * 100)}%` }} /></div>
                        <span className="bfr-progress-label">{progress.done}/{progress.total}</span>
                    </div>
                )}
            </ModalContent>
            <ModalFooter>
                <button className="bfr-btn bfr-btn-secondary" onClick={() => setFriends(loadFriends())} disabled={removing}>
                    <RefreshIcon /> {t("Refresh")}
                </button>
                <button className="bfr-btn bfr-btn-danger" onClick={removeSelected} disabled={!selected.length || removing} style={{ flex: 1 }}>
                    {removing ? <><SpinnerIcon /> {progress.done}/{progress.total}</> : <><TrashIcon /> {t("Delete")} ({selected.length})</>}
                </button>
            </ModalFooter>
        </ModalRoot>
    );
}

function BulkFriendRemoveButton() {
    return (
        <HeaderBarButton
            icon={BulkRemoveIcon}
            tooltip={t("Friends deletion")}
            onClick={() => openModal(props => <BulkFriendRemoveModal rootProps={props} />)}
        />
    );
}

export default definePlugin({
    name: "BulkFriendRemove",
    description: "Delete multiple friends at once.",
    authors: [{ name: "Nightcord", id: 0n }],
    tags: ["Friends", "Utility", "Nightcord"],
    headerBarButton: { icon: BulkRemoveIcon, render: BulkFriendRemoveButton, priority: 5 },
});
