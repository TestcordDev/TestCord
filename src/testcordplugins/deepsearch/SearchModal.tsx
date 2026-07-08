/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { classNameFactory } from "@utils/css";
import { ModalCloseButton, ModalContent, ModalHeader, ModalRoot, ModalSize, RenderModalProps } from "@utils/modal";
import { saveFile } from "@utils/web";
import { ChannelStore, GuildStore, NavigationRouter, React, SelectedGuildStore, useCallback, useEffect, useRef, useState } from "@webpack/common";

import { settings } from "./index";
import { deepSearch, FilterState, loadLastQuery, saveLastQuery, SearchResult } from "./search";

const cl = classNameFactory("vc-deepsearch-");

const DEFAULT_FILTERS: FilterState = {
    authorId: null,
    channelId: null,
    mentions: null,
    hasAttachments: false,
    hasEmbeds: false,
    isPinned: false,
    includeNSFW: false,
    linkDomain: null,
    linkContains: null,
    excludeKeywords: null,
    excludeDomains: null,
    dateFrom: null,
    dateTo: null
};

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void; }) {
    return (
        <button className={cl("chip", { active })} onClick={onClick}>
            {label}
        </button>
    );
}

function FilterInput({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange: (val: string) => void; }) {
    return (
        <div className={cl("filter-input-group")}>
            <span className={cl("filter-input-label")}>{label}</span>
            <input
                className={cl("filter-input")}
                type="text"
                value={value}
                placeholder={placeholder}
                onChange={e => onChange(e.target.value)}
            />
        </div>
    );
}

const highlightRegexCache = new Map<string, RegExp>();
function getHighlightRegex(highlight: string): RegExp {
    let rx = highlightRegexCache.get(highlight);
    if (!rx) {
        const escaped = highlight.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        rx = new RegExp(`(${escaped})`, "gi");
        highlightRegexCache.set(highlight, rx);
        if (highlightRegexCache.size > 64) {
            const oldest = highlightRegexCache.keys().next().value;
            if (oldest !== undefined) highlightRegexCache.delete(oldest);
        }
    }
    return rx;
}

function highlightText(text: string, highlight: string): React.ReactNode {
    if (!highlight || !text) return text;
    const parts = text.split(getHighlightRegex(highlight));
    return parts.map((part, i) =>
        part.toLowerCase() === highlight.toLowerCase() ? (
            <mark key={i} className={cl("highlight")}>{part}</mark>
        ) : part
    );
}

function formatTimestamp(timestamp: any): string {
    if (!timestamp) return "";
    try {
        let date: Date;
        if (timestamp instanceof Date) {
            date = timestamp;
        } else if (typeof timestamp === "number") {
            date = new Date(timestamp);
        } else if (typeof timestamp === "string") {
            date = new Date(timestamp);
        } else if (timestamp?.valueOf) {
            date = new Date(timestamp.valueOf());
        } else {
            return "";
        }
        if (isNaN(date.getTime())) return "";
        return date.toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        });
    } catch {
        return "";
    }
}

function formatMessagePreview(message: any): string {
    if (message.content) {
        return message.content.length > 200
            ? message.content.substring(0, 200) + "..."
            : message.content;
    }
    if (message.attachments?.length > 0) {
        return `${message.attachments.length} attachment${message.attachments.length === 1 ? "" : "s"}`;
    }
    if (message.embeds?.length > 0) {
        return `${message.embeds.length} embed${message.embeds.length === 1 ? "" : "s"}`;
    }
    return "No text content";
}

function formatSearchResultsForExport(results: SearchResult[], query: string, guildId: string | undefined): string {
    const lines = [
        "Deep Search results",
        `Exported: ${new Date().toLocaleString()}`,
        `Query: ${query.trim() || "Filters only"}`,
        `Results: ${results.length}`,
        ""
    ];

    for (const [index, result] of results.entries()) {
        const { message, user, matchedUrls } = result;
        const channel = ChannelStore.getChannel(message.channel_id);
        const author = user?.globalName || user?.username || message.author?.username || "Unknown";
        const channelName = channel?.name || message.channel_id;
        const messageGuildId = guildId || result.channel.guild_id || "@me";

        lines.push(`${index + 1}. [${formatTimestamp(message.timestamp) || "Unknown time"}] ${author} in #${channelName}`);
        lines.push(formatMessagePreview(message));
        lines.push(`Message: https://discord.com/channels/${messageGuildId}/${message.channel_id}/${message.id}`);

        if (message.attachments?.length > 0) {
            lines.push("Attachments:");
            for (const attachment of message.attachments) lines.push(`- ${attachment.filename} (${attachment.url})`);
        }

        if (matchedUrls.length > 0) {
            lines.push("Links:");
            for (const url of matchedUrls) lines.push(`- ${url}`);
        }

        lines.push("");
    }

    return lines.join("\n");
}

function SearchResultItem({
    result,
    query,
    selected,
    onSelect,
    onNavigate
}: {
    result: SearchResult;
    query: string;
    selected: boolean;
    onSelect: () => void;
    onNavigate: () => void;
}) {
    const { message, user, channel, matchedUrls } = result;
    const channelObj = ChannelStore.getChannel(message.channel_id);
    const channelName = channelObj?.name || "Unknown Channel";

    return (
        <div
            className={cl("result-item", { selected })}
            onClick={onNavigate}
            onMouseEnter={onSelect}
        >
            <div className={cl("result-avatar")}>
                {user?.avatar ? (
                    <img
                        className={cl("result-avatar-img")}
                        src={user.getAvatarURL?.(channel.guild_id, 80) ?? undefined}
                        alt=""
                    />
                ) : (
                    <div className={cl("result-avatar-fallback")}>
                        {(user?.username || "?")[0].toUpperCase()}
                    </div>
                )}
            </div>
            <div className={cl("result-body")}>
                <div className={cl("result-header")}>
                    <span className={cl("result-author")}>
                        {user?.globalName || user?.username || "Unknown"}
                    </span>
                    <span className={cl("result-channel")}>
                        #{channelName}
                    </span>
                    {message.pinned && <span className={cl("result-pin")}>Pinned</span>}
                    <span className={cl("result-time")}>
                        {formatTimestamp(message.timestamp)}
                    </span>
                </div>
                <div className={cl("result-content")}>
                    {highlightText(formatMessagePreview(message), query)}
                </div>
                <div className={cl("result-meta")}>
                    {message.attachments?.length > 0 && (
                        <span className={cl("result-badge")}>
                            {message.attachments.length} file{message.attachments.length === 1 ? "" : "s"}
                        </span>
                    )}
                    {message.embeds?.length > 0 && (
                        <span className={cl("result-badge")}>
                            {message.embeds.length} embed{message.embeds.length === 1 ? "" : "s"}
                        </span>
                    )}
                    {matchedUrls.length > 0 && (
                        <span className={cl("result-badge", "link")}>
                            {matchedUrls.length} link{matchedUrls.length === 1 ? "" : "s"}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}

export function DeepSearchModal({ rootProps }: { rootProps: RenderModalProps; }) {
    const [query, setQuery] = useState("");
    const [filters, setFilters] = useState<FilterState>({ ...DEFAULT_FILTERS });
    const [results, setResults] = useState<SearchResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(-1);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const resultsRef = useRef<HTMLDivElement>(null);
    const searchRunIdRef = useRef(0);
    const abortRef = useRef<AbortController | null>(null);

    const currentGuildId = SelectedGuildStore.getGuildId() as string | undefined;

    // Load saved query on mount
    useEffect(() => {
        (async () => {
            const saved = await loadLastQuery();
            if (saved) {
                setQuery(saved.query);
                const savedFilters = { ...DEFAULT_FILTERS, ...saved.filters };
                setFilters(savedFilters);
                if (savedFilters.linkDomain || savedFilters.linkContains || savedFilters.excludeKeywords || savedFilters.excludeDomains || savedFilters.dateFrom || savedFilters.dateTo) {
                    setShowAdvanced(true);
                }
            }
            setLoaded(true);
        })();
        searchInputRef.current?.focus();
    }, []);

    const doSearch = useCallback(async (q: string, f: FilterState) => {
        if (!currentGuildId) return;
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        const searchRunId = ++searchRunIdRef.current;
        const trimmed = q.trim();
        const hasAnyFilter = f.authorId || f.channelId || f.mentions ||
            f.hasAttachments || f.hasEmbeds || f.isPinned ||
            f.linkDomain || f.linkContains || f.excludeKeywords || f.excludeDomains || f.dateFrom || f.dateTo;
        if (!trimmed && !hasAnyFilter) {
            setResults([]);
            setSelectedIndex(-1);
            setLoading(false);
            return;
        }

        setLoading(true);
        setSelectedIndex(-1);
        setResults([]);
        try {
            const res = await deepSearch(currentGuildId, trimmed, f, settings.store.maxResults ?? 100, progress => {
                if (searchRunIdRef.current === searchRunId) setResults(progress);
            }, controller.signal);
            if (searchRunIdRef.current === searchRunId) setResults(res);
        } catch (e) {
            console.error("[DeepSearch] Search failed:", e);
            if (searchRunIdRef.current === searchRunId) setResults([]);
        } finally {
            if (searchRunIdRef.current === searchRunId) setLoading(false);
        }
    }, [currentGuildId]);

    useEffect(() => () => {
        searchRunIdRef.current++;
        abortRef.current?.abort();
    }, []);

    const exportResults = useCallback(async () => {
        if (results.length === 0) {
            showNotification({ title: "Deep Search", body: "No search results to export." });
            return;
        }

        const filename = `deepsearch-results-${new Date().toISOString().split("T")[0]}.txt`;
        const content = formatSearchResultsForExport(results, query, currentGuildId);

        try {
            if (IS_DISCORD_DESKTOP) {
                const data = new TextEncoder().encode(content);
                await DiscordNative.fileManager.saveWithDialog(data, filename);
            } else {
                saveFile(new File([content], filename, { type: "text/plain" }));
            }

            showNotification({ title: "Deep Search", body: `Saved search results as ${filename}.` });
        } catch {
            showNotification({ title: "Deep Search", body: "Failed to export search results." });
        }
    }, [currentGuildId, query, results]);

    // Save query and run search on changes (debounced)
    useEffect(() => {
        if (!loaded) return;
        const timeout = setTimeout(() => {
            saveLastQuery(query, filters);
            doSearch(query, filters);
        }, settings.store.searchTimeout ?? 300);
        return () => clearTimeout(timeout);
    }, [query, filters, loaded, doSearch]);

    const navigateToMessage = useCallback((result: SearchResult) => {
        const msg = result.message;
        const guildId = result.channel.guild_id || "@me";
        NavigationRouter.transitionTo(`/channels/${guildId}/${msg.channel_id}/${msg.id}`);
        rootProps.onClose();
    }, [rootProps]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelectedIndex(prev => prev < results.length - 1 ? prev + 1 : prev);
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelectedIndex(prev => prev > 0 ? prev - 1 : 0);
            } else if (e.key === "Enter" && selectedIndex >= 0 && results[selectedIndex]) {
                e.preventDefault();
                navigateToMessage(results[selectedIndex]);
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [results, selectedIndex, navigateToMessage]);

    useEffect(() => {
        if (selectedIndex >= 0 && resultsRef.current) {
            const el = resultsRef.current.children[selectedIndex] as HTMLElement;
            el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
    }, [selectedIndex]);

    const updateFilter = useCallback(<K extends keyof FilterState>(key: K, value: FilterState[K]) => {
        setFilters(prev => ({ ...prev, [key]: value }));
    }, []);

    const toggleBoolFilter = useCallback((key: keyof FilterState) => {
        setFilters(prev => ({ ...prev, [key]: !prev[key] }));
    }, []);

    const activeFilterCount = Object.entries(filters).filter(([k, v]) => {
        if (k === "includeNSFW") return false;
        if (typeof v === "boolean") return v;
        return v !== null && v !== "";
    }).length;

    return (
        <ModalRoot {...rootProps} size={ModalSize.LARGE} className={cl("modal-root")}>
            <ModalHeader className={cl("header")}>
                <span className={cl("header-title")}>Deep Search</span>
                {currentGuildId && (
                    <span className={cl("header-guild")}>
                        {GuildStore.getGuild(currentGuildId)?.name || "Server"}
                    </span>
                )}
                <ModalCloseButton onClick={rootProps.onClose} />
            </ModalHeader>
            <ModalContent className={cl("content")}>
                <div className={cl("container")}>
                    <div className={cl("search-section")}>
                        <div className={cl("search-bar")}>
                            <svg className={cl("search-icon")} viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                                <path d="M21.707 20.293l-5.395-5.395A7.46 7.46 0 0018 10.5a7.5 7.5 0 10-7.5 7.5 7.46 7.46 0 004.398-1.688l5.395 5.395a1 1 0 001.414-1.414zM10.5 16a5.5 5.5 0 110-11 5.5 5.5 0 010 11z" />
                            </svg>
                            <input
                                ref={searchInputRef}
                                className={cl("search-input")}
                                type="text"
                                value={query}
                                placeholder="Search messages..."
                                onChange={e => setQuery(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === "Enter") doSearch(query, filters);
                                }}
                            />
                            {query && (
                                <button
                                    className={cl("search-clear")}
                                    onClick={() => {
                                        searchRunIdRef.current++;
                                        abortRef.current?.abort();
                                        setQuery("");
                                        setResults([]);
                                        setSelectedIndex(-1);
                                        setLoading(false);
                                    }}
                                >
                                    X
                                </button>
                            )}
                        </div>

                        <div className={cl("quick-filters")}>
                            <FilterChip
                                label="Links"
                                active={!!filters.linkDomain || !!filters.linkContains}
                                onClick={() => setShowAdvanced(v => !v)}
                            />
                            <FilterChip
                                label="Files"
                                active={filters.hasAttachments}
                                onClick={() => toggleBoolFilter("hasAttachments")}
                            />
                            <FilterChip
                                label="Embeds"
                                active={filters.hasEmbeds}
                                onClick={() => toggleBoolFilter("hasEmbeds")}
                            />
                            <FilterChip
                                label="Pinned"
                                active={filters.isPinned}
                                onClick={() => toggleBoolFilter("isPinned")}
                            />
                            {activeFilterCount > 0 && (
                                <button
                                    className={cl("clear-filters")}
                                    onClick={() => { setFilters({ ...DEFAULT_FILTERS }); setShowAdvanced(false); }}
                                >
                                    Clear ({activeFilterCount})
                                </button>
                            )}
                        </div>

                        {showAdvanced && (
                            <div className={cl("advanced-filters")}>
                                <div className={cl("advanced-row")}>
                                    <FilterInput
                                        label="From user ID"
                                        value={filters.authorId || ""}
                                        placeholder="User ID"
                                        onChange={v => updateFilter("authorId", v || null)}
                                    />
                                    <FilterInput
                                        label="In channel ID"
                                        value={filters.channelId || ""}
                                        placeholder="Channel ID"
                                        onChange={v => updateFilter("channelId", v || null)}
                                    />
                                    <FilterInput
                                        label="Mentions user ID"
                                        value={filters.mentions || ""}
                                        placeholder="User ID"
                                        onChange={v => updateFilter("mentions", v || null)}
                                    />
                                </div>
                                <div className={cl("advanced-row")}>
                                    <FilterInput
                                        label="Link domain"
                                        value={filters.linkDomain || ""}
                                        placeholder="e.g. youtube.com"
                                        onChange={v => updateFilter("linkDomain", v || null)}
                                    />
                                    <FilterInput
                                        label="Link contains"
                                        value={filters.linkContains || ""}
                                        placeholder="e.g. playlist"
                                        onChange={v => updateFilter("linkContains", v || null)}
                                    />
                                </div>
                                <div className={cl("advanced-row")}>
                                    <FilterInput
                                        label="Exclude keywords"
                                        value={filters.excludeKeywords || ""}
                                        placeholder="spoiler, leak"
                                        onChange={v => updateFilter("excludeKeywords", v || null)}
                                    />
                                    <FilterInput
                                        label="Exclude domains"
                                        value={filters.excludeDomains || ""}
                                        placeholder="twitter.com, tiktok.com"
                                        onChange={v => updateFilter("excludeDomains", v || null)}
                                    />
                                </div>
                                <div className={cl("advanced-row")}>
                                    <FilterInput
                                        label="After date"
                                        value={filters.dateFrom || ""}
                                        placeholder="YYYY-MM-DD"
                                        onChange={v => updateFilter("dateFrom", v || null)}
                                    />
                                    <FilterInput
                                        label="Before date"
                                        value={filters.dateTo || ""}
                                        placeholder="YYYY-MM-DD"
                                        onChange={v => updateFilter("dateTo", v || null)}
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    <div className={cl("results-header")}>
                        {loading ? (
                            <span className={cl("results-stats")}>Searching...</span>
                        ) : results.length > 0 ? (
                            <span className={cl("results-stats")}>
                                {results.length} result{results.length === 1 ? "" : "s"} found
                            </span>
                        ) : query || activeFilterCount > 0 ? (
                            <span className={cl("results-stats")}>No results found</span>
                        ) : (
                            <span className={cl("results-stats")}>Type a query or select filters to search</span>
                        )}
                        {results.length > 0 && (
                            <button className={cl("export")} onClick={exportResults}>
                                Export .txt
                            </button>
                        )}
                    </div>

                    <div className={cl("results")} ref={resultsRef}>
                        {results.map((result, i) => (
                            <SearchResultItem
                                key={`${result.message.id}-${i}`}
                                result={result}
                                query={query}
                                selected={i === selectedIndex}
                                onSelect={() => setSelectedIndex(i)}
                                onNavigate={() => navigateToMessage(result)}
                            />
                        ))}
                    </div>
                </div>
            </ModalContent>
        </ModalRoot>
    );
}
