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
import { classNameFactory } from "@utils/css";
import { Margins } from "@utils/margins";
import { classes } from "@utils/misc";
import { showToast, TextInput, Toasts, useEffect, useMemo, useState } from "@webpack/common";

import { openThemeCodeModal } from "./ThemeMarketplace";
import { fetchMarketplaceCatalog, getItemLink, MarketplaceItem } from "./MarketplaceData";

// Reuse the exact same class prefix as ThemeMarketplace so all its existing
// grid/card/toolbar CSS applies for free. SnippetMarketplace.css only adds
// the small bits that make snippets look distinct (badge color, tighter cards).
const cl = classNameFactory("vc-settings-theme-market-");

const THEMES_API_URL = "https://themes.equicord.org/api/themes";
const THEME_RAW_API_URL = "https://themes.equicord.org/api";

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

function SnippetCard({ snippet, installed, onToggleInstall, onTagClick }: {
    snippet: MarketplaceSnippet;
    installed: boolean;
    onToggleInstall(): void;
    onTagClick(tag: string): void;
}) {
    const authorName = snippet.author?.discord_name ?? snippet.author?.github_name ?? "Unknown";

    return (
        <div className={classes(cl("card"), "vc-snippet-card")}>
            <div className={cl("card-body")}>
                <div className={cl("card-header")}>
                    <span className="vc-snippet-pill">SNIPPET</span>
                    <span className={cl("card-name")}>{snippet.name}</span>
                    <span className={cl("card-likes")}>♥ {snippet.likes ?? 0}</span>
                </div>
                <p
                    className={classes(cl("card-author"), cl("author-clickable"))}
                    onClick={() => onTagClick(authorName)}
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
                                onClick={() => onTagClick(tag)}
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
                        onClick={onToggleInstall}
                    >
                        {installed ? "Remove" : "Add Snippet"}
                    </Button>
                    {snippet.content && (
                        <Button
                            size="small"
                            variant="secondary"
                            className={cl("action-btn")}
                            onClick={() => openThemeCodeModal(snippet.name, snippet.content)}
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
    const settings = useSettings(["themeLinks", "enabledThemeLinks"]);
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
            <Heading className={Margins.top20}>Snippet Marketplace</Heading>
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
                            onTagClick={(tag: string) => setSearch(tag)}
                        />
                    ))}
                </div>
            )}

            <Divider className={Margins.top20} />
        </>
    );
}
