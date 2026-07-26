/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { addHeaderBarButton, HeaderBarButton, removeHeaderBarButton } from "@api/HeaderBar";
import { disableStyle, enableStyle } from "@api/Styles";
import { sleep } from "@utils/misc";
import { ModalCloseButton,ModalContent, ModalHeader, ModalRoot, openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { Forms, React, useEffect,useRef, UserStore, useState } from "@webpack/common";

import { t } from "../autoTranslateNightcord";
import sidebarStyle from "./sidebar.css?managed";

const GuildStore = findStoreLazy("GuildStore");
const GuildChannelStore = findStoreLazy("GuildChannelStore");
const VoiceStateStore = findStoreLazy("VoiceStateStore");
const ChannelStore = findStoreLazy("ChannelStore");
const PermissionStore = findStoreLazy("PermissionStore");
const ChannelActions = findByPropsLazy("selectVoiceChannel", "selectChannel");

interface VoiceChannel {
    channelId: string;
    channelName: string;
    channelType: number;
    guildId: string;
    guildName: string;
    guildIcon: string | null;
    memberCount: number;
    canAccess: boolean; // false = channel visible but no permission to join
    // Pre-built unique search index: "channel name · server name"
    searchIndex: string;
}

// Scan cache — avoids rescanning if done recently
let scanCache: VoiceChannel[] | null = null;
let scanCacheAt = 0;
const SCAN_TTL = 10000; // 10s de cache

async function scan(): Promise<VoiceChannel[]> {
    // Returns cache if fresh
    if (scanCache && Date.now() - scanCacheAt < SCAN_TTL) return scanCache;

    return new Promise(resolve => {
        setTimeout(() => {
            try {
                const memberCount: Record<string, number> = {};
                try {
                    const all: any = VoiceStateStore.getAllVoiceStates?.() ?? {};
                    for (const gId in all) {
                        for (const uId in all[gId]) {
                            const cid = all[gId][uId]?.channelId;
                            if (cid) memberCount[cid] = (memberCount[cid] ?? 0) + 1;
                        }
                    }
                } catch { }

                const guilds: any = GuildStore.getGuilds?.() ?? {};
                const out: VoiceChannel[] = [];

                for (const guildId in guilds) {
                    const guild = guilds[guildId];
                    if (!guild) continue;
                    const gName: string = guild.name ?? "";
                    const gIcon: string | null = guild.icon
                        ? `https://cdn.discordapp.com/icons/${guildId}/${guild.icon}.webp?size=32`
                        : null;

                    // Utilise getChannels() qui retourne TOUS les canaux du serveur
                    // (including those without permission) — exactly like the Discord Gateway
                    const allChannels = GuildChannelStore.getChannels?.(guildId) ?? {};
                    // Iterate through all categories: VOCAL, GUILD_STAGE_VOICE, and raw arrays
                    const voiceItems: any[] = [
                        ...(allChannels.VOCAL ?? []),
                        ...(allChannels[2] ?? []), // type 2 = voice
                        ...(allChannels[13] ?? []), // type 13 = stage
                    ];
                    // Deduplicate by id
                    const seen = new Set<string>();
                    for (const item of voiceItems) {
                        const ch = item?.channel ?? item;
                        if (!ch?.id || seen.has(ch.id)) continue;
                        seen.add(ch.id);
                        const cName: string = ch.name ?? "";
                        out.push({
                            channelId: ch.id,
                            channelName: cName,
                            channelType: ch.type ?? 2,
                            guildId,
                            guildName: gName,
                            guildIcon: gIcon,
                            memberCount: memberCount[ch.id] ?? 0,
                            canAccess: true,
                            searchIndex: `${cName.toLowerCase()} ${gName.toLowerCase()}`,
                        });
                    }
                }

                // Sort once here
                out.sort((a, b) => b.memberCount - a.memberCount || a.guildName.localeCompare(b.guildName));

                scanCache = out;
                scanCacheAt = Date.now();
                resolve(out);
            } catch { resolve([]); }
        }, 0);
    });
}

function SearchIcon({ width = 20, height = 20 }: { width?: number; height?: number; }) {
    return (
        <svg width={width} height={height} viewBox="0 0 24 24" fill="currentColor">
            <path fillRule="evenodd" d="M15.62 17.03a9 9 0 1 1 1.41-1.41l4.68 4.67a1 1 0 0 1-1.42 1.42l-4.67-4.68ZM17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" clipRule="evenodd" />
        </svg>
    );
}
function VoiceIcon() {
    return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.7 }}><path d="M12 3a1 1 0 0 0-1 1v16a1 1 0 0 0 2 0V4a1 1 0 0 0-1-1ZM8 6a1 1 0 0 0-1 1v10a1 1 0 0 0 2 0V7a1 1 0 0 0-1-1ZM4 9a1 1 0 0 0-1 1v4a1 1 0 0 0 2 0v-4a1 1 0 0 0-1-1ZM16 6a1 1 0 0 0-1 1v10a1 1 0 0 0 2 0V7a1 1 0 0 0-1-1ZM20 9a1 1 0 0 0-1 1v4a1 1 0 0 0 2 0v-4a1 1 0 0 0-1-1Z" /></svg>;
}
function StageIcon() {
    return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.7 }}><path d="M12 3a1 1 0 0 0-1 1v4.586l-3.293-3.293a1 1 0 0 0-1.414 1.414L9.586 10H5a1 1 0 0 0 0 2h4.586l-3.293 3.293a1 1 0 1 0 1.414 1.414L11 13.414V18a1 1 0 0 0 2 0v-4.586l3.293 3.293a1 1 0 0 0 1.414-1.414L14.414 12H19a1 1 0 0 0 0-2h-4.586l3.293 3.293a1 1 0 0 0-1.414-1.414L13 8.586V4a1 1 0 0 0-1-1Z" /></svg>;
}
function SpinnerIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            style={{ animation: "vcs-spin 0.8s linear infinite" }}>
            <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
            <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
        </svg>
    );
}

function VoiceSearchModal({ rootProps, channels }: { rootProps: any; channels: VoiceChannel[] | null; }) {
    const [query, setQuery] = useState("");
    const [filtered, setFiltered] = useState<VoiceChannel[] | null>(null);
    const [joiningId, setJoiningId] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    // Debounce timer stored in a ref to avoid re-renders
    const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // When channels arrive, initialize filtered directly (no useMemo)
    useEffect(() => {
        if (channels !== null) setFiltered(channels);
    }, [channels]);

    function handleQueryChange(e: React.ChangeEvent<HTMLInputElement>) {
        const val = e.target.value;
        setQuery(val);

        // Filter debounce: cancels the previous timer
        if (debounceTimer.current) clearTimeout(debounceTimer.current);

        if (!val.trim()) {
            // Immediate reset without debounce
            setFiltered(channels);
            return;
        }

        debounceTimer.current = setTimeout(() => {
            if (!channels) return;
            const q = val.trim().toLowerCase();
            // searchIndex is already in lowercase — fast includes()
            setFiltered(channels.filter(c => c.searchIndex.includes(q)));
        }, 80); // 80ms — almost imperceptible
    }

    async function join(ch: VoiceChannel) {
        if (joiningId) return;
        setJoiningId(ch.channelId);
        try {
            ChannelActions.selectVoiceChannel(ch.channelId);
            // Short delay for visual effect before closing
            await sleep(400);
        } catch { }
        setJoiningId(null);
        rootProps.onClose();
    }

    const displayList = filtered ?? channels;
    const count = displayList?.length ?? 0;

    return (
        <ModalRoot {...rootProps} size="medium">
            <ModalHeader separator={false}>
                <Forms.FormTitle tag="h4" style={{ margin: 0, display: "flex", alignItems: "center", gap: 8, color: "#ffffff" }}>
                    <SearchIcon width={16} height={16} /> {t("Voice Channels")}
                    {displayList !== null && <span className="vcs-count-badge">{count}</span>}
                </Forms.FormTitle>
                <ModalCloseButton onClick={rootProps.onClose} />
            </ModalHeader>
            <ModalContent className="vcs-content">
                {channels === null ? (
                    <div className="vcs-loading">
                        <SpinnerIcon />
                        <span>{t("Loading channels...")}</span>
                    </div>
                ) : (
                    <>
                        <div className="vcs-search-bar">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.4, flexShrink: 0 }}>
                                <path d="M21.71 20.29l-5.01-5.01A7.94 7.94 0 0 0 18 10a8 8 0 1 0-8 8 7.94 7.94 0 0 0 5.28-1.3l5.01 5.01a1 1 0 0 0 1.42-1.42ZM4 10a6 6 0 1 1 6 6 6 6 0 0 1-6-6Z" />
                            </svg>
                            <input
                                ref={inputRef}
                                autoFocus
                                className="vcs-search-input"
                                placeholder={t("Channel or server...")}
                                value={query}
                                onChange={handleQueryChange}
                            />
                            {query && (
                                <button className="vcs-search-clear" onClick={() => { setQuery(""); setFiltered(channels); }}>
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
                                </button>
                            )}
                        </div>
                        <div className="vcs-channel-list">
                            {displayList!.length === 0 && (
                                <div className="vcs-empty">{query ? t("No channel found") : t("No voice channels")}</div>
                            )}
                            {displayList!.slice(0, 150).map(ch => (
                                <div key={ch.channelId}
                                    className={`vcs-row${ch.canAccess ? "" : " vcs-row--locked"}`}
                                    onClick={() => ch.canAccess && join(ch)}
                                    title={ch.canAccess ? undefined : t("No permission to join this channel")}
                                >
                                    <span className="vcs-icon">
                                        {ch.canAccess
                                            ? (ch.channelType === 13 ? <StageIcon /> : <VoiceIcon />)
                                            : <span style={{ opacity: 0.5, fontSize: 13 }}>🔒</span>
                                        }
                                    </span>
                                    <div className="vcs-info">
                                        <span className="vcs-name">{ch.channelName}</span>
                                        <div className="vcs-guild">
                                            {ch.guildIcon && <img src={ch.guildIcon} className="vcs-guild-icon" alt="" loading="lazy" />}
                                            <span className="vcs-guild-name">{ch.guildName}</span>
                                            {ch.memberCount > 0 && (
                                                <div className="vcs-members-info">
                                                    <span className="vcs-members-count"> · {ch.memberCount}</span>
                                                    <div className="vcs-member-avatars">
                                                        {(() => {
                                                            const allStates = VoiceStateStore.getAllVoiceStates();
                                                            const guildStates = allStates[ch.guildId] || {};
                                                            const channelStates = Object.values(guildStates).filter((s: any) => s.channelId === ch.channelId);

                                                            return channelStates.slice(0, 10).map((s: any) => {
                                                                const user = UserStore.getUser(s.userId);
                                                                if (!user) return null;
                                                                const avatarUrl = user.getAvatarURL(ch.guildId, 16);
                                                                return <img key={s.userId} src={avatarUrl} className="vcs-member-avatar" />;
                                                            });
                                                        })()}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    {joiningId === ch.channelId
                                        ? <span className="vcs-joining-label">{t("Joining...")}</span>
                                        : ch.canAccess
                                            ? <button className="vcs-join-btn" onClick={e => { e.stopPropagation(); join(ch); }}>{t("Join")}</button>
                                            : <span className="vcs-locked-label">{t("Private")}</span>
                                    }
                                </div>
                            ))}
                            {displayList!.length > 80 && !query && (
                                <div className="vcs-empty" style={{ fontSize: 11, opacity: 0.5 }}>
                                    {displayList!.length - 80} {t("more channels — use search")}
                                </div>
                            )}
                        </div>
                    </>
                )}
            </ModalContent>
        </ModalRoot>
    );
}

function VoiceSearchModalWrapper({ rootProps }: { rootProps: any; }) {
    const [channels, setChannels] = useState<VoiceChannel[] | null>(
        // If cache is fresh, display immediately without spinner
        scanCache && Date.now() - scanCacheAt < SCAN_TTL ? scanCache : null
    );

    useEffect(() => {
        if (channels !== null) return; // already loaded from cache
        scan().then(setChannels);
    }, []);

    return <VoiceSearchModal rootProps={rootProps} channels={channels} />;
}

function VCSHeaderButton() {
    return (
        <HeaderBarButton
            icon={SearchIcon}
            tooltip={t("Search voice channel")}
            onClick={() => openModal(props => <VoiceSearchModalWrapper rootProps={props} />)}
        />
    );
}

export default definePlugin({
    name: "VoiceChannelSearch",
    description: "Search and join any voice channel across all your servers.",
    tags: ["Voice", "Utility", "Nightcord"],
    authors: [{ name: "Nightcord", id: 0n }],
    dependencies: ["HeaderBarAPI"],

    start() {
        enableStyle(sidebarStyle);
        addHeaderBarButton("nightcord-voice-channel-search", () => <VCSHeaderButton />, 9);
    },
    stop() {
        disableStyle(sidebarStyle);
        removeHeaderBarButton("nightcord-voice-channel-search");
        scanCache = null;
    },
});
