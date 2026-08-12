/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { addContextMenuPatch, NavContextMenuPatchCallback, removeContextMenuPatch } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { sleep } from "@utils/misc";
import { ModalCloseButton, ModalContent, ModalHeader, ModalRoot, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { findByProps, findByPropsLazy, findStoreLazy } from "@webpack";
import { Forms, Menu, React, showToast, Toasts, useEffect, useMemo, useState } from "@webpack/common";

const GuildStore = findStoreLazy("GuildStore");
const GuildActions = findByPropsLazy("leaveGuild");

interface GuildEntry {
    id: string;
    name: string;
    icon: string | null;
    ownerId: string;
}

const settings = definePluginSettings({
    safeMode: {
        description: "Do not show or select servers you own",
        type: OptionType.BOOLEAN,
        default: true
    }
});

/* ── Icons ── */
function SearchIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.5, flexShrink: 0 }}>
            <path d="M21.71 20.29l-5.01-5.01A7.94 7.94 0 0 0 18 10a8 8 0 1 0-8 8 7.94 7.94 0 0 0 5.28-1.3l5.01 5.01a1 1 0 0 0 1.42-1.42ZM4 10a6 6 0 1 1 6 6 6 6 0 0 1-6-6Z" />
        </svg>
    );
}

/* ── Modal ── */
function LeaveAllServersModal({ rootProps }: { rootProps: any; }) {
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [search, setSearch] = useState("");
    const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
    const [progress, setProgress] = useState("");
    const [currentIdx, setCurrentIdx] = useState(0);

    const myId = useMemo(() => findByProps("getCurrentUser").getCurrentUser().id, []);

    const allGuilds = useMemo<GuildEntry[]>(() => {
        const raw = GuildStore?.getGuilds?.() ?? {};
        return (Object.values(raw) as GuildEntry[]).sort((a, b) => a.name.localeCompare(b.name));
    }, []);

    // Exclude owned servers if safeMode
    const availableGuilds = useMemo(() =>
        settings.store.safeMode ? allGuilds.filter(g => g.ownerId !== myId) : allGuilds,
        [allGuilds, myId]
    );

    const filtered = useMemo(() => {
        if (!search.trim()) return availableGuilds;
        const q = search.toLowerCase();
        return availableGuilds.filter(g => g.name.toLowerCase().includes(q));
    }, [availableGuilds, search]);

    // Select all by default
    useEffect(() => {
        setSelected(new Set(availableGuilds.map(g => g.id)));
    }, [availableGuilds]);

    const toggleGuild = (id: string) => {
        if (status === "running") return;
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const selectAll = () => setSelected(new Set(availableGuilds.map(g => g.id)));
    const selectNone = () => setSelected(new Set());

    const handleLeave = async () => {
        if (selected.size === 0) return;
        setStatus("running");
        const ids = Array.from(selected);
        let count = 0;

        for (let i = 0; i < ids.length; i++) {
            const guild = GuildStore.getGuild(ids[i]);
            if (!guild) continue;
            setCurrentIdx(i + 1);
            setProgress(`[${i + 1}/${ids.length}] Leaving: ${guild.name}...`);
            try {
                await GuildActions.leaveGuild(ids[i]);
                count++;
            } catch (e) {
                console.error(`[LeaveAllServers] Failed to leave ${guild.name}:`, e);
            }
            await sleep(800);
        }

        setStatus("done");
        setProgress(`${count} server${count > 1 ? "s" : ""} left successfully`);
        showToast(`${count} servers left successfully!`, Toasts.Type.SUCCESS);
    };

    function getGuildIcon(g: GuildEntry) {
        if (g.icon) return `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.webp?size=64`;
        return null;
    }

    const pct = selected.size > 0 && status === "running"
        ? Math.round((currentIdx / selected.size) * 100) : 0;

    return (
        <ModalRoot {...rootProps} size="medium">
            <ModalHeader separator={false}>
                <Forms.FormTitle tag="h4" style={{ margin: 0, display: "flex", alignItems: "center", gap: 8, color: "#fff" }}>
                    Leave All Servers
                </Forms.FormTitle>
                <ModalCloseButton onClick={rootProps.onClose} />
            </ModalHeader>

            <ModalContent className="las-content">

                {/* Barre de recherche */}
                <div className="las-search-bar">
                    <SearchIcon />
                    <input
                        className="las-search-input"
                        type="text"
                        placeholder="Search a server..."
                        value={search}
                        onChange={e => setSearch(e.currentTarget.value)}
                        autoFocus
                    />
                    {search && (
                        <button className="las-search-clear" onClick={() => setSearch("")}>✕</button>
                    )}
                </div>

                {/* Header liste + boutons tout/rien */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <Forms.FormTitle tag="h5" className="las-label">SELECT SERVERS</Forms.FormTitle>
                    <div style={{ display: "flex", gap: 6 }}>
                        <button className="las-mini-btn" onClick={selectAll} disabled={status === "running"}>All</button>
                        <button className="las-mini-btn" onClick={selectNone} disabled={status === "running"}>None</button>
                    </div>
                </div>

                {/* Liste serveurs */}
                <div className="las-guild-list">
                    {filtered.length === 0 && (
                        <div className="las-empty">
                            {search ? `No results for "${search}"` : "No servers found"}
                        </div>
                    )}
                    {filtered.map(g => {
                        const av = getGuildIcon(g);
                        const isSel = selected.has(g.id);
                        return (
                            <div
                                key={g.id}
                                className={`las-guild-row ${isSel ? "las-guild-row--selected" : ""}`}
                                onClick={() => toggleGuild(g.id)}
                            >
                                {av
                                    ? <img src={av} className="las-avatar" alt="" />
                                    : <div className="las-avatar-placeholder">{g.name.replace(/\s+/g, "").slice(0, 2).toUpperCase()}</div>
                                }
                                <span className="las-guild-name">{g.name}</span>
                                {isSel && <span className="las-check">✓</span>}
                            </div>
                        );
                    })}
                </div>

                {/* Status */}
                {status !== "idle" && (
                    <div className={`las-status las-status--${status}`}>{progress}</div>
                )}

                {/* Compteur */}
                <div className="las-footer-info">
                    <span>{selected.size} server{selected.size > 1 ? "s" : ""} selected</span>
                    {settings.store.safeMode && (
                        <span className="las-safe-note">· Safe mode active (owners excluded)</span>
                    )}
                </div>

                {/* Bouton principal */}
                <button
                    className="las-leave-btn"
                    onClick={handleLeave}
                    disabled={selected.size === 0 || status === "running"}
                >
                    {status === "running"
                        ? `In progress... (${pct}%)`
                        : `Leave ${selected.size} server${selected.size > 1 ? "s" : ""}`}
                </button>

            </ModalContent>
        </ModalRoot>
    );
}

/* ── Context menu patch ── */
const patchGuildContext: NavContextMenuPatchCallback = (children, { guild }) => {
    if (!children || !Array.isArray(children)) return;
    try {
        if (!guild) return;

        children.push(
            <Menu.MenuSeparator key="las-sep" />,
            <Menu.MenuItem
                id="leave-all-servers"
                key="leave-all-servers"
                label="Leave All Servers"
                color="danger"
                action={() => openModal(props => <LeaveAllServersModal rootProps={props} />)}
            />
        );
    } catch (e) {
        console.error("[LeaveAllServers] Context menu patch error:", e);
    }
};

export default definePlugin({
    name: "LeaveAllServers",
    description: "Leaves all selected servers. Accessible via right-click on a server.",
    tags: ["Servers", "Nightcord"],
    authors: [{ name: "Nightcord", id: 0n }],
    dependencies: ["ContextMenuAPI"],
    settings,

    start() {
        addContextMenuPatch("guild-context", patchGuildContext);
    },

    stop() {
        removeContextMenuPatch("guild-context", patchGuildContext);
    }
});
