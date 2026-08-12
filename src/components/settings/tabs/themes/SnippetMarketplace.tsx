/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./SnippetMarketplace.css";

import { Settings, useSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Divider } from "@components/Divider";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { copyToClipboard } from "@utils/clipboard";
import { classNameFactory } from "@utils/css";
import { Margins } from "@utils/margins";
import { classes } from "@utils/misc";
import { Modal, openModal, React, showToast, TextInput, Toasts, useEffect, useMemo, useState } from "@webpack/common";

import { fetchMarketplaceCatalog, getItemLink, MarketplaceItem } from "./MarketplaceData";
import { openThemeCodeModal } from "./ThemeMarketplace";

const cl = classNameFactory("vc-settings-theme-market-");

const THEMES_API_URL = "https://themes.equicord.org/api/themes";

type MarketplaceSnippet = MarketplaceItem;

type SortKey = "downloads" | "likes" | "name" | "newest";

const SORTS: { key: SortKey; label: string }[] = [
    { key: "downloads", label: "Most Downloaded" },
    { key: "likes", label: "Most Liked" },
    { key: "name", label: "Name" },
    { key: "newest", label: "Newest" }
];

async function fetchMarketplaceSnippets(): Promise<MarketplaceSnippet[]> {
    const all = await fetchMarketplaceCatalog();
    return all.filter(t => t.type === "snippet");
}

function getSnippetLink(id: number): string {
    return getItemLink(id);
}

function installSnippet(snippet: MarketplaceSnippet): boolean {
    const link = getSnippetLink(snippet.id);
    const currentLinks: string[] = Array.isArray(Settings.themeLinks) ? Settings.themeLinks : [];
    const alreadyIn = currentLinks.includes(link);
    if (!alreadyIn) {
        Settings.themeLinks = [...currentLinks, link];
    }
    return !alreadyIn;
}

function uninstallSnippet(snippet: MarketplaceSnippet) {
    const link = getSnippetLink(snippet.id);
    const altLink = `${THEMES_API_URL}/${snippet.id}`;
    Settings.themeLinks = (Settings.themeLinks ?? []).filter(l => l !== link && l !== altLink);
    Settings.enabledThemeLinks = (Settings.enabledThemeLinks ?? []).filter(l => l !== link && l !== altLink);
}

function SnippetDetailsModalContent({
    snippet,
    installed,
    onToggleInstall,
    onTagClick,
    modalProps
}: {
    snippet: MarketplaceSnippet;
    installed: boolean;
    onToggleInstall: () => void;
    onTagClick: (tag: string) => void;
    modalProps: any;
}) {
    const snippetLink = getSnippetLink(snippet.id);
    const [lightboxOpen, setLightboxOpen] = useState(false);

    const handleToggleInstall = () => {
        onToggleInstall();
        modalProps.onClose();
    };

    const copyStat = (label: string, val: string | number) => {
        copyToClipboard(String(val));
        showToast(`${label} copied to clipboard!`, Toasts.Type.SUCCESS);
    };

    const authorName = snippet.author?.discord_name ?? snippet.author?.github_name ?? "Unknown";

    return (
        <>
            <Modal
                {...modalProps}
                size="md"
                title={`${snippet.name} - Snippet Preview`}
            >
                <div className={cl("modal-body")}>
                    {snippet.thumbnail_url ? (
                        <div
                            className={cl("modal-banner")}
                            onClick={e => {
                                e.stopPropagation();
                                setLightboxOpen(true);
                            }}
                            title="Click to enlarge preview image"
                        >
                            <img
                                src={snippet.thumbnail_url}
                                alt={snippet.name}
                                className={cl("modal-img")}
                            />
                        </div>
                    ) : (
                        <div className="vc-snippet-modal-placeholder">
                            <div className="vc-snippet-modal-placeholder-icon">✂️</div>
                            <div className="vc-snippet-modal-placeholder-text">CSS Snippet Code Preview Available</div>
                        </div>
                    )}

                    <div className={cl("modal-top-actions")}>
                        <Button
                            variant={installed ? "dangerPrimary" : "primary"}
                            className={cl("modal-top-action-btn")}
                            onClick={handleToggleInstall}
                        >
                            {installed ? "Remove Snippet" : "Add Snippet"}
                        </Button>
                        {snippet.content && (
                            <Button
                                variant="secondary"
                                className={cl("modal-top-action-btn")}
                                onClick={() => openThemeCodeModal(snippet.name, snippet.content)}
                            >
                                View Code
                            </Button>
                        )}
                        {snippet.source && (
                            <Button
                                variant="secondary"
                                className={cl("source-btn")}
                                onClick={() => VencordNative.native.openExternal(snippet.source)}
                            >
                                Open GitHub / Source
                            </Button>
                        )}
                    </div>

                    {snippet.tags?.length > 0 && (
                        <div>
                            <Heading className={cl("modal-section-title")}>Tags (Click to filter)</Heading>
                            <div className={cl("card-tags")}>
                                {snippet.tags.map(tag => (
                                    <button
                                        key={tag}
                                        className={classes(cl("card-tag"), cl("tag-btn"))}
                                        onClick={() => {
                                            modalProps.onClose();
                                            onTagClick(tag);
                                        }}
                                    >
                                        #{tag}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {snippet.description && (
                        <div>
                            <Heading className={cl("modal-section-title")}>Description</Heading>
                            <Paragraph>{snippet.description}</Paragraph>
                        </div>
                    )}

                    <div>
                        <Heading className={cl("modal-section-title")}>Details (Click card to copy)</Heading>
                        <div className={cl("modal-details-grid")}>
                            <div
                                className={cl("modal-detail-card")}
                                onClick={() => copyStat("Author", authorName)}
                                title="Click to copy author"
                            >
                                <span className={cl("modal-detail-label")}>Author</span>
                                <span className={cl("modal-detail-value")}>{authorName}</span>
                            </div>
                            <div
                                className={cl("modal-detail-card")}
                                onClick={() => copyStat("Downloads", (snippet.downloads ?? 0).toLocaleString())}
                                title="Click to copy downloads count"
                            >
                                <span className={cl("modal-detail-label")}>Downloads</span>
                                <span className={cl("modal-detail-value")}>{(snippet.downloads ?? 0).toLocaleString()}</span>
                            </div>
                            <div
                                className={cl("modal-detail-card")}
                                onClick={() => copyStat("Likes", (snippet.likes ?? 0).toLocaleString())}
                                title="Click to copy likes count"
                            >
                                <span className={cl("modal-detail-label")}>Likes</span>
                                <span className={cl("modal-detail-value")}>{(snippet.likes ?? 0).toLocaleString()}</span>
                            </div>
                            <div
                                className={cl("modal-detail-card")}
                                onClick={() => copyStat("Release Date", snippet.release_date ? new Date(snippet.release_date).toLocaleDateString() : "N/A")}
                                title="Click to copy release date"
                            >
                                <span className={cl("modal-detail-label")}>Release Date</span>
                                <span className={cl("modal-detail-value")}>
                                    {snippet.release_date ? new Date(snippet.release_date).toLocaleDateString() : "N/A"}
                                </span>
                            </div>
                            <div
                                className={cl("modal-detail-card")}
                                onClick={() => copyStat("Snippet ID", snippet.id)}
                                title="Click to copy snippet ID"
                            >
                                <span className={cl("modal-detail-label")}>Snippet ID</span>
                                <span className={cl("modal-detail-value")}>{snippet.id}</span>
                            </div>
                            <div
                                className={cl("modal-detail-card")}
                                onClick={() => copyStat("Status", installed ? "Added" : "Available")}
                                title="Click to copy snippet status"
                            >
                                <span className={cl("modal-detail-label")}>Status</span>
                                <span
                                    className={cl("modal-detail-value")}
                                    style={{ color: installed ? "var(--status-positive, #23a55a)" : "var(--brand-500, #5865f2)" }}
                                >
                                    {installed ? "✓ Added" : "Available"}
                                </span>
                            </div>
                            <div
                                className={classes(cl("modal-detail-card"), cl("modal-detail-card-full"))}
                                onClick={() => copyStat("Snippet Link", snippetLink)}
                                title="Click to copy snippet link"
                            >
                                <span className={cl("modal-detail-label")}>Direct Snippet Link</span>
                                <span className={cl("modal-detail-value")}>{snippetLink}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </Modal>

            {lightboxOpen && snippet.thumbnail_url && (
                <div
                    className={cl("lightbox-overlay")}
                    onClick={() => setLightboxOpen(false)}
                >
                    <div className={cl("lightbox-content")} onClick={e => e.stopPropagation()}>
                        <div className={cl("lightbox-header")}>
                            <span className={cl("lightbox-title")}>{snippet.name} - Image Preview</span>
                            <div className={cl("lightbox-actions")}>
                                <Button
                                    size="small"
                                    variant="secondary"
                                    className={cl("lightbox-btn")}
                                    onClick={() => VencordNative.native.openExternal(snippet.thumbnail_url!)}
                                >
                                    Open Original
                                </Button>
                                <button
                                    className={cl("lightbox-close")}
                                    onClick={() => setLightboxOpen(false)}
                                    title="Close preview"
                                >
                                    ✕
                                </button>
                            </div>
                        </div>
                        <div className={cl("lightbox-img-wrapper")}>
                            <img
                                src={snippet.thumbnail_url}
                                alt={snippet.name}
                                className={cl("lightbox-img")}
                            />
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

function openSnippetDetailsModal(
    snippet: MarketplaceSnippet,
    installed: boolean,
    onToggleInstall: () => void,
    onTagClick: (tag: string) => void
) {
    openModal(modalProps => (
        <SnippetDetailsModalContent
            snippet={snippet}
            installed={installed}
            onToggleInstall={onToggleInstall}
            modalProps={modalProps}
            onTagClick={onTagClick}
        />
    ));
}

function SnippetCard({ snippet, installed, onToggleInstall, onOpenDetails, onTagClick }: {
    snippet: MarketplaceSnippet;
    installed: boolean;
    onToggleInstall(): void;
    onOpenDetails(): void;
    onTagClick(tag: string): void;
}) {
    const [imgErr, setImgErr] = useState(false);
    const authorName = snippet.author?.discord_name ?? snippet.author?.github_name ?? "Unknown";

    return (
        <div
            className={classes(cl("card"), "vc-snippet-card")}
            onClick={onOpenDetails}
            style={{ cursor: "pointer" }}
        >
            <div className={cl("card-preview")}>
                {snippet.thumbnail_url && !imgErr ? (
                    <img
                        className={cl("card-img")}
                        src={snippet.thumbnail_url}
                        alt={snippet.name}
                        loading="lazy"
                        onError={() => setImgErr(true)}
                    />
                ) : (
                    <div className="vc-snippet-placeholder-preview">
                        <span className="vc-snippet-placeholder-tag">✂️ CSS SNIPPET</span>
                    </div>
                )}
                {installed && <span className={classes(cl("card-badge"), "vc-snippet-badge")}>Added</span>}
            </div>
            <div className={cl("card-body")}>
                <div className={cl("card-header")}>
                    <span className={cl("card-name")}>{snippet.name}</span>
                    <span className={cl("card-likes")}>♥ {snippet.likes ?? 0}</span>
                </div>
                <p
                    className={classes(cl("card-author"), cl("author-clickable"))}
                    onClick={e => {
                        e.stopPropagation();
                        onTagClick(authorName);
                    }}
                    title="Click to search snippets by this author"
                >
                    by {authorName}
                </p>
                {snippet.description && (
                    <p className={cl("card-desc")}>{snippet.description}</p>
                )}
                {snippet.tags?.length > 0 && (
                    <div className={cl("card-tags")}>
                        {snippet.tags.slice(0, 5).map(tag => (
                            <button
                                key={tag}
                                className={classes(cl("card-tag"), cl("tag-btn"))}
                                onClick={e => {
                                    e.stopPropagation();
                                    onTagClick(tag);
                                }}
                            >
                                #{tag}
                            </button>
                        ))}
                    </div>
                )}
                <div className={cl("card-actions")}>
                    <Button
                        size="small"
                        variant={installed ? "dangerSecondary" : "primary"}
                        className={classes(cl("action-btn"), !installed && "vc-snippet-add-btn")}
                        onClick={e => {
                            e.stopPropagation();
                            onToggleInstall();
                        }}
                    >
                        {installed ? "Remove" : "Add Snippet"}
                    </Button>
                    {snippet.content && (
                        <Button
                            size="small"
                            variant="secondary"
                            className={cl("action-btn")}
                            onClick={e => {
                                e.stopPropagation();
                                openThemeCodeModal(snippet.name, snippet.content);
                            }}
                        >
                            Code
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}

export function SnippetMarketplaceSection() {
    const settings = useSettings(["themeLinks", "enabledThemeLinks", "hideSnippetMarketplace"]);
    const isHidden = settings.hideSnippetMarketplace ?? false;
    const [snippets, setSnippets] = useState<MarketplaceSnippet[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [sort, setSort] = useState<SortKey>("downloads");

    async function load() {
        setLoading(true);
        setError(null);
        try {
            const data = await fetchMarketplaceSnippets();
            setSnippets(data);
        } catch (e: any) {
            setError(e?.message ?? "Unknown error");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        void load();
    }, []);

    const installedIds = useMemo(() => {
        const links = settings.themeLinks ?? [];
        const ids = new Set<number>();
        snippets.forEach(s => {
            const link = getSnippetLink(s.id);
            const altLink = `${THEMES_API_URL}/${s.id}`;
            if (links.includes(link) || links.includes(altLink)) {
                ids.add(s.id);
            }
        });
        return ids;
    }, [snippets, settings.themeLinks]);

    const visible = useMemo(() => {
        let list = snippets;

        if (search.trim()) {
            const q = search.toLowerCase();
            list = list.filter(s =>
                s.name.toLowerCase().includes(q) ||
                (s.author?.discord_name ?? "").toLowerCase().includes(q) ||
                (s.author?.github_name ?? "").toLowerCase().includes(q) ||
                s.description?.toLowerCase().includes(q) ||
                s.tags?.some(tag => tag.toLowerCase().includes(q))
            );
        }

        const sorted = [...list];
        if (sort === "downloads") sorted.sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0));
        if (sort === "likes") sorted.sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0));
        if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
        if (sort === "newest") sorted.sort((a, b) => new Date(b.release_date ?? 0).getTime() - new Date(a.release_date ?? 0).getTime());

        sorted.sort((a, b) => {
            const aInstalled = installedIds.has(a.id) ? 1 : 0;
            const bInstalled = installedIds.has(b.id) ? 1 : 0;
            return bInstalled - aInstalled;
        });

        return sorted;
    }, [snippets, search, sort, installedIds]);

    function handleToggleInstall(snippet: MarketplaceSnippet) {
        try {
            const isInstalled = installedIds.has(snippet.id);
            if (isInstalled) {
                uninstallSnippet(snippet);
                Toasts.show({ id: Toasts.genId(), message: `Removed "${snippet.name}".`, type: Toasts.Type.SUCCESS });
            } else {
                const wasNew = installSnippet(snippet);
                Toasts.show({
                    id: Toasts.genId(),
                    message: wasNew ? `Added "${snippet.name}"! It stacks alongside your current theme.` : `"${snippet.name}" is already added.`,
                    type: wasNew ? Toasts.Type.SUCCESS : Toasts.Type.MESSAGE,
                });
            }
        } catch (e: any) {
            Toasts.show({ id: Toasts.genId(), message: `Failed: ${e?.message ?? "Unknown error"}`, type: Toasts.Type.FAILURE });
        }
    }

    return (
        <>
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    cursor: "pointer",
                    userSelect: "none"
                }}
                className={Margins.top20}
                onClick={() => {
                    Settings.hideSnippetMarketplace = !isHidden;
                }}
            >
                <Heading style={{ margin: 0 }}>Snippet Marketplace</Heading>
                <span
                    style={{
                        fontSize: "12px",
                        color: "var(--text-muted)",
                        transform: isHidden ? "rotate(-90deg)" : "rotate(0deg)",
                        transition: "transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
                        display: "inline-block"
                    }}
                >
                    ▼
                </span>
            </div>

            <div className={`vc-marketplace-collapsible ${isHidden ? "collapsed" : "expanded"}`}>
                <Paragraph className={Margins.bottom16}>
                    Snippets are small CSS tweaks from the Equicord Theme Library that stack alongside a full theme — think of them as mini themes you can mix and match, rather than replace your whole look.
                </Paragraph>

                <div className={classes(cl("toolbar"), Margins.bottom16)}>
                    <div className={cl("search")}>
                        <TextInput
                            placeholder="Search snippets by name, author, or tag..."
                            value={search}
                            onChange={setSearch}
                        />
                    </div>
                    <div className={cl("sort-tabs")}>
                        {SORTS.map(s => (
                            <button
                                key={s.key}
                                className={classes(cl("sort-tab"), sort === s.key && cl("sort-tab", "active"))}
                                onClick={() => setSort(s.key)}
                            >
                                {s.label}
                            </button>
                        ))}
                    </div>
                </div>

                {loading ? (
                    <div className={cl("grid")}>
                        {Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} className={cl("skeleton-card")} />
                        ))}
                    </div>
                ) : error ? (
                    <Paragraph color="text-muted" className={Margins.top16}>
                        Failed to load snippets: {error}
                    </Paragraph>
                ) : visible.length === 0 ? (
                    <Paragraph color="text-muted" className={Margins.top16}>No snippets found.</Paragraph>
                ) : (
                    <div className={cl("grid")}>
                        {visible.map(snippet => (
                            <SnippetCard
                                key={snippet.id}
                                snippet={snippet}
                                installed={installedIds.has(snippet.id)}
                                onToggleInstall={() => handleToggleInstall(snippet)}
                                onOpenDetails={() => openSnippetDetailsModal(
                                    snippet,
                                    installedIds.has(snippet.id),
                                    () => handleToggleInstall(snippet),
                                    (tag: string) => setSearch(tag)
                                )}
                                onTagClick={(tag: string) => setSearch(tag)}
                            />
                        ))}
                    </div>
                )}
            </div>

            <Divider className={Margins.top20} />
        </>
    );
}
