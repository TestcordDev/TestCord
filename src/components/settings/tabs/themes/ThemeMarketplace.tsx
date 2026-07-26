/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Settings, useSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Divider } from "@components/Divider";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { copyToClipboard } from "@utils/clipboard";
import { classNameFactory } from "@utils/css";
import { openImageModal } from "@utils/discord";
import { Margins } from "@utils/margins";
import { classes } from "@utils/misc";
import { Modal, openModal, React, showToast, TextInput, Toasts, useEffect, useMemo, useState } from "@webpack/common";

const cl = classNameFactory("vc-settings-theme-market-");

const THEMES_API_URL = "https://themes.equicord.org/api/themes";
const THEME_RAW_API_URL = "https://themes.equicord.org/api";

interface MarketplaceTheme {
    id: number;
    name: string;
    type: string;
    description: string;
    author: {
        discord_snowflake: string;
        discord_name: string;
        github_name: string;
    };
    tags: string[];
    thumbnail_url: string;
    release_date: string;
    content: string;
    source: string;
    likes: number;
    downloads: number;
}

type SortKey = "downloads" | "likes" | "name" | "newest";

const SORTS: { key: SortKey; label: string }[] = [
    { key: "downloads", label: "Most Downloaded" },
    { key: "likes", label: "Most Liked" },
    { key: "name", label: "Name" },
    { key: "newest", label: "Newest" }
];

async function fetchMarketplaceThemes(): Promise<MarketplaceTheme[]> {
    const res = await fetch(THEMES_API_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const themes: MarketplaceTheme[] = Object.values(data);
    return themes.filter(t => t.type === "theme" || !t.type);
}

function getThemeLink(themeId: number): string {
    return `${THEME_RAW_API_URL}/${themeId}`;
}

function installTheme(theme: MarketplaceTheme): boolean {
    const themeLink = getThemeLink(theme.id);
    const currentLinks: string[] = Array.isArray(Settings.themeLinks) ? Settings.themeLinks : [];
    const alreadyIn = currentLinks.includes(themeLink);
    if (!alreadyIn) {
        Settings.themeLinks = [...currentLinks, themeLink];
    }
    return !alreadyIn;
}

function uninstallTheme(theme: MarketplaceTheme) {
    const themeLink = getThemeLink(theme.id);
    const altLink = `${THEMES_API_URL}/${theme.id}`;
    Settings.themeLinks = (Settings.themeLinks ?? []).filter(l => l !== themeLink && l !== altLink);
    Settings.enabledThemeLinks = (Settings.enabledThemeLinks ?? []).filter(l => l !== themeLink && l !== altLink);
}

function openEnlargedImageModal(url: string, title?: string, width = 1280, height = 720) {
    if (!url) return;
    try {
        openImageModal({
            url,
            original: url,
            width: width || 1280,
            height: height || 720
        });
    } catch {
        openModal(props => (
            <Modal {...props} size="lg" title={title ? `${title} - Image Preview` : "Image Preview"}>
                <div style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: "16px" }}>
                    <img
                        src={url}
                        alt={title ?? "Image Preview"}
                        style={{
                            maxWidth: "100%",
                            maxHeight: "75vh",
                            borderRadius: "8px",
                            objectFit: "contain",
                            boxShadow: "0 8px 32px rgb(0 0 0 / 60%)"
                        }}
                    />
                </div>
            </Modal>
        ));
    }
}

function ThemeDetailsModalContent({
    theme,
    installed,
    onToggleInstall,
    onTagClick,
    modalProps
}: {
    theme: MarketplaceTheme;
    installed: boolean;
    onToggleInstall: () => void;
    onTagClick: (tag: string) => void;
    modalProps: any;
}) {
    const themeLink = getThemeLink(theme.id);
    const [lightboxOpen, setLightboxOpen] = useState(false);

    const handleToggleInstall = () => {
        onToggleInstall();
        modalProps.onClose();
    };

    const copyStat = (label: string, val: string | number) => {
        copyToClipboard(String(val));
        showToast(`${label} copied to clipboard!`, Toasts.Type.SUCCESS);
    };

    const authorName = theme.author?.discord_name ?? theme.author?.github_name ?? "Unknown";

    return (
        <>
            <Modal
                {...modalProps}
                size="md"
                title={theme.name}
            >
                <div className={cl("modal-body")}>
                    {theme.thumbnail_url && (
                        <div
                            className={cl("modal-banner")}
                            onClick={e => {
                                e.stopPropagation();
                                setLightboxOpen(true);
                            }}
                            title="Click to enlarge preview image"
                        >
                            <img
                                src={theme.thumbnail_url}
                                alt={theme.name}
                                className={cl("modal-img")}
                            />
                        </div>
                    )}

                    {/* Top Action Bar: Immediately visible on open without scrolling */}
                    <div className={cl("modal-top-actions")}>
                        <Button
                            variant={installed ? "dangerPrimary" : "primary"}
                            className={cl("modal-top-action-btn")}
                            onClick={handleToggleInstall}
                        >
                            {installed ? "Uninstall Theme" : "Install Theme"}
                        </Button>
                        {theme.source && (
                            <Button
                                variant="secondary"
                                className={cl("source-btn")}
                                onClick={() => VencordNative.native.openExternal(theme.source)}
                            >
                                Open GitHub / Source
                            </Button>
                        )}
                    </div>

                    {/* Tags: Immediately visible at top without scrolling */}
                    {theme.tags?.length > 0 && (
                        <div>
                            <Heading className={cl("modal-section-title")}>Tags (Click to filter)</Heading>
                            <div className={cl("card-tags")}>
                                {theme.tags.map(tag => (
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

                    {theme.description && (
                        <div>
                            <Heading className={cl("modal-section-title")}>Description</Heading>
                            <Paragraph>{theme.description}</Paragraph>
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
                                onClick={() => copyStat("Downloads", (theme.downloads ?? 0).toLocaleString())}
                                title="Click to copy downloads count"
                            >
                                <span className={cl("modal-detail-label")}>Downloads</span>
                                <span className={cl("modal-detail-value")}>{(theme.downloads ?? 0).toLocaleString()}</span>
                            </div>
                            <div
                                className={cl("modal-detail-card")}
                                onClick={() => copyStat("Likes", (theme.likes ?? 0).toLocaleString())}
                                title="Click to copy likes count"
                            >
                                <span className={cl("modal-detail-label")}>Likes</span>
                                <span className={cl("modal-detail-value")}>{(theme.likes ?? 0).toLocaleString()}</span>
                            </div>
                            <div
                                className={cl("modal-detail-card")}
                                onClick={() => copyStat("Release Date", theme.release_date ? new Date(theme.release_date).toLocaleDateString() : "N/A")}
                                title="Click to copy release date"
                            >
                                <span className={cl("modal-detail-label")}>Release Date</span>
                                <span className={cl("modal-detail-value")}>
                                    {theme.release_date ? new Date(theme.release_date).toLocaleDateString() : "N/A"}
                                </span>
                            </div>
                            <div
                                className={cl("modal-detail-card")}
                                onClick={() => copyStat("Theme ID", theme.id)}
                                title="Click to copy theme ID"
                            >
                                <span className={cl("modal-detail-label")}>Theme ID</span>
                                <span className={cl("modal-detail-value")}>{theme.id}</span>
                            </div>
                            <div
                                className={cl("modal-detail-card")}
                                onClick={() => copyStat("Status", installed ? "Installed" : "Available")}
                                title="Click to copy theme status"
                            >
                                <span className={cl("modal-detail-label")}>Status</span>
                                <span
                                    className={cl("modal-detail-value")}
                                    style={{ color: installed ? "var(--status-positive, #23a55a)" : "var(--brand-500, #5865f2)" }}
                                >
                                    {installed ? "✓ Installed" : "Available"}
                                </span>
                            </div>
                            <div
                                className={classes(cl("modal-detail-card"), cl("modal-detail-card-full"))}
                                onClick={() => copyStat("Theme Link", themeLink)}
                                title="Click to copy theme link"
                            >
                                <span className={cl("modal-detail-label")}>Direct Theme Link</span>
                                <span className={cl("modal-detail-value")}>{themeLink}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </Modal>

            {lightboxOpen && theme.thumbnail_url && (
                <div
                    className={cl("lightbox-overlay")}
                    onClick={() => setLightboxOpen(false)}
                >
                    <div className={cl("lightbox-content")} onClick={e => e.stopPropagation()}>
                        <div className={cl("lightbox-header")}>
                            <span className={cl("lightbox-title")}>{theme.name} - Image Preview</span>
                            <div className={cl("lightbox-actions")}>
                                <Button
                                    size="small"
                                    variant="secondary"
                                    className={cl("lightbox-btn")}
                                    onClick={() => VencordNative.native.openExternal(theme.thumbnail_url)}
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
                                src={theme.thumbnail_url}
                                alt={theme.name}
                                className={cl("lightbox-img")}
                            />
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

function openThemeDetailsModal(
    theme: MarketplaceTheme,
    installed: boolean,
    onToggleInstall: () => void,
    onTagClick: (tag: string) => void
) {
    openModal(modalProps => (
        <ThemeDetailsModalContent
            theme={theme}
            installed={installed}
            onToggleInstall={onToggleInstall}
            modalProps={modalProps}
            onTagClick={onTagClick}
        />
    ));
}

function MarketplaceCard({ theme, installed, onToggleInstall, onOpenDetails, onTagClick }: {
    theme: MarketplaceTheme;
    installed: boolean;
    onToggleInstall(): void;
    onOpenDetails(): void;
    onTagClick(tag: string): void;
}) {
    const [imgErr, setImgErr] = useState(false);
    const authorName = theme.author?.discord_name ?? theme.author?.github_name ?? "Unknown";

    return (
        <div
            className={cl("card")}
            onClick={onOpenDetails}
            style={{ cursor: "pointer" }}
        >
            <div className={cl("card-preview")}>
                {theme.thumbnail_url && !imgErr ? (
                    <img
                        className={cl("card-img")}
                        src={theme.thumbnail_url}
                        alt={theme.name}
                        loading="lazy"
                        onError={() => setImgErr(true)}
                    />
                ) : (
                    <div className={cl("card-img-placeholder")}>No Preview</div>
                )}
                {installed && <span className={cl("card-badge")}>Installed</span>}
            </div>
            <div className={cl("card-body")}>
                <div className={cl("card-header")}>
                    <span className={cl("card-name")}>{theme.name}</span>
                    <span className={cl("card-likes")}>♥ {theme.likes ?? 0}</span>
                </div>
                <p
                    className={classes(cl("card-author"), cl("author-clickable"))}
                    onClick={e => {
                        e.stopPropagation();
                        onTagClick(authorName);
                    }}
                    title="Click to search themes by this author"
                >
                    by {authorName}
                </p>
                {theme.description && (
                    <p className={cl("card-desc")}>{theme.description}</p>
                )}
                {theme.tags?.length > 0 && (
                    <div className={cl("card-tags")}>
                        {theme.tags.slice(0, 5).map(tag => (
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
                        className={cl("action-btn")}
                        onClick={e => {
                            e.stopPropagation();
                            onToggleInstall();
                        }}
                    >
                        {installed ? "Uninstall" : "Install"}
                    </Button>
                </div>
            </div>
        </div>
    );
}

export function ThemeMarketplaceSection() {
    const settings = useSettings(["themeLinks", "enabledThemeLinks"]);
    const [themes, setThemes] = useState<MarketplaceTheme[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [sort, setSort] = useState<SortKey>("downloads");

    async function load() {
        setLoading(true);
        setError(null);
        try {
            const data = await fetchMarketplaceThemes();
            setThemes(data);
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
        themes.forEach(t => {
            const themeLink = getThemeLink(t.id);
            const altLink = `${THEMES_API_URL}/${t.id}`;
            if (links.includes(themeLink) || links.includes(altLink)) {
                ids.add(t.id);
            }
        });
        return ids;
    }, [themes, settings.themeLinks]);

    const visible = useMemo(() => {
        let list = themes;

        if (search.trim()) {
            const q = search.toLowerCase();
            list = list.filter(t =>
                t.name.toLowerCase().includes(q) ||
                (t.author?.discord_name ?? "").toLowerCase().includes(q) ||
                (t.author?.github_name ?? "").toLowerCase().includes(q) ||
                t.description?.toLowerCase().includes(q) ||
                t.tags?.some(tag => tag.toLowerCase().includes(q))
            );
        }

        const sorted = [...list];
        if (sort === "downloads") sorted.sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0));
        if (sort === "likes") sorted.sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0));
        if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
        if (sort === "newest") sorted.sort((a, b) => new Date(b.release_date ?? 0).getTime() - new Date(a.release_date ?? 0).getTime());

        // Sort installed themes to the top
        sorted.sort((a, b) => {
            const aInstalled = installedIds.has(a.id) ? 1 : 0;
            const bInstalled = installedIds.has(b.id) ? 1 : 0;
            return bInstalled - aInstalled;
        });

        return sorted;
    }, [themes, search, sort, installedIds]);

    function handleToggleInstall(theme: MarketplaceTheme) {
        try {
            const isInstalled = installedIds.has(theme.id);
            if (isInstalled) {
                uninstallTheme(theme);
                Toasts.show({
                    id: Toasts.genId(),
                    message: `Uninstalled "${theme.name}".`,
                    type: Toasts.Type.SUCCESS,
                });
            } else {
                const wasNew = installTheme(theme);
                Toasts.show({
                    id: Toasts.genId(),
                    message: wasNew
                        ? `Installed "${theme.name}"!`
                        : `"${theme.name}" is already installed.`,
                    type: wasNew ? Toasts.Type.SUCCESS : Toasts.Type.MESSAGE,
                });
            }
        } catch (e: any) {
            Toasts.show({
                id: Toasts.genId(),
                message: `Failed: ${e?.message ?? "Unknown error"}`,
                type: Toasts.Type.FAILURE,
            });
        }
    }

    return (
        <>
            <Heading className={Margins.top20}>Theme Marketplace</Heading>
            <Paragraph className={Margins.bottom16}>
                Browse and install themes from the Equicord Theme Library. Click Install to add a theme directly as an online theme link.
            </Paragraph>

            <div className={classes(cl("toolbar"), Margins.bottom16)}>
                <div className={cl("search")}>
                    <TextInput
                        placeholder="Search themes by name, author, or tag..."
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
                    Failed to load themes: {error}
                </Paragraph>
            ) : visible.length === 0 ? (
                <Paragraph color="text-muted" className={Margins.top16}>No themes found.</Paragraph>
            ) : (
                <div className={cl("grid")}>
                    {visible.map(theme => (
                        <MarketplaceCard
                            key={theme.id}
                            theme={theme}
                            installed={installedIds.has(theme.id)}
                            onToggleInstall={() => handleToggleInstall(theme)}
                            onOpenDetails={() => openThemeDetailsModal(
                                theme,
                                installedIds.has(theme.id),
                                () => handleToggleInstall(theme),
                                (tag: string) => setSearch(tag)
                            )}
                            onTagClick={(tag: string) => setSearch(tag)}
                        />
                    ))}
                </div>
            )}

            <Divider className={Margins.top20} />
        </>
    );
}
