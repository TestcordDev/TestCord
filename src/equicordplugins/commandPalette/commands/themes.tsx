/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Settings } from "@api/Settings";
import { copyWithToast } from "@utils/discord";
import { React, showToast, Toasts } from "@webpack/common";

import type { PaletteAction, PaletteCommand, PaletteListItem } from "../api/types";
import { CompassIcon, CopyIcon, GearIcon, LinkIcon, PaintIcon, PinIcon, PlusIcon, TrashIcon } from "../ui/icons";
import { openSettingsPage } from "./openSettings";

const SECTION = "Themes";
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

let cachedMarketplaceThemes: MarketplaceTheme[] | null = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 60000; // 1 minute cache

async function fetchMarketplaceThemes(): Promise<MarketplaceTheme[]> {
    const now = Date.now();
    if (cachedMarketplaceThemes && now - lastFetchTime < CACHE_TTL_MS) {
        return cachedMarketplaceThemes;
    }

    try {
        const res = await fetch(THEMES_API_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const themes: MarketplaceTheme[] = Object.values(data);
        const filtered = themes.filter(t => t.type === "theme" || !t.type);
        cachedMarketplaceThemes = filtered;
        lastFetchTime = now;
        return filtered;
    } catch (e: any) {
        if (cachedMarketplaceThemes) return cachedMarketplaceThemes;
        throw e;
    }
}

function getThemeLink(themeId: number): string {
    return `${THEME_RAW_API_URL}/${themeId}`;
}

function isThemeInstalled(themeId: number): boolean {
    const links = Array.isArray(Settings.themeLinks) ? Settings.themeLinks : [];
    const themeLink = getThemeLink(themeId);
    const altLink = `${THEMES_API_URL}/${themeId}`;
    return links.includes(themeLink) || links.includes(altLink);
}

function installMarketplaceTheme(theme: MarketplaceTheme) {
    const themeLink = getThemeLink(theme.id);
    const currentLinks: string[] = Array.isArray(Settings.themeLinks) ? Settings.themeLinks : [];
    if (!currentLinks.includes(themeLink)) {
        Settings.themeLinks = [...currentLinks, themeLink];
        showToast(`Installed "${theme.name}"!`, Toasts.Type.SUCCESS);
    } else {
        showToast(`"${theme.name}" is already installed.`, Toasts.Type.MESSAGE);
    }
}

function uninstallMarketplaceTheme(theme: MarketplaceTheme) {
    const themeLink = getThemeLink(theme.id);
    const altLink = `${THEMES_API_URL}/${theme.id}`;
    Settings.themeLinks = (Settings.themeLinks ?? []).filter(l => l !== themeLink && l !== altLink);
    Settings.enabledThemeLinks = (Settings.enabledThemeLinks ?? []).filter(l => l !== themeLink && l !== altLink);
    showToast(`Uninstalled "${theme.name}".`, Toasts.Type.SUCCESS);
}

async function marketplaceItems(): Promise<PaletteListItem[]> {
    try {
        const themes = await fetchMarketplaceThemes();
        return themes.map(theme => {
            const authorName = theme.author?.discord_name ?? theme.author?.github_name ?? "Unknown";
            const installed = isThemeInstalled(theme.id);
            const themeLink = getThemeLink(theme.id);

            const actions: PaletteAction[] = [
                {
                    id: "toggleInstall",
                    label: installed ? "Uninstall Theme" : "Install Theme",
                    icon: installed ? TrashIcon : PlusIcon,
                    keepOpen: true,
                    run: () => {
                        if (installed) uninstallMarketplaceTheme(theme);
                        else installMarketplaceTheme(theme);
                    }
                },
                {
                    id: "details",
                    label: "View Theme Details",
                    icon: CompassIcon,
                    keepOpen: true,
                    run: ctx => {
                        ctx.push({
                            title: theme.name,
                            icon: PaintIcon,
                            spec: {
                                type: "detail",
                                heading: theme.name,
                                body: (
                                    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                                        {theme.thumbnail_url && (
                                            <img
                                                src={theme.thumbnail_url}
                                                alt={theme.name}
                                                style={{
                                                    width: "100%",
                                                    maxHeight: "220px",
                                                    borderRadius: "8px",
                                                    objectFit: "cover"
                                                }}
                                            />
                                        )}
                                        {theme.description && (
                                            <p style={{ margin: 0, opacity: 0.9, lineHeight: 1.4 }}>
                                                {theme.description}
                                            </p>
                                        )}
                                    </div>
                                ),
                                rows: [
                                    { label: "Author", value: authorName },
                                    { label: "Downloads", value: (theme.downloads ?? 0).toLocaleString() },
                                    { label: "Likes", value: (theme.likes ?? 0).toLocaleString() },
                                    { label: "Status", value: installed ? "Installed" : "Not Installed" },
                                    { label: "Tags", value: theme.tags?.length ? theme.tags.map(t => `#${t}`).join(", ") : "None" },
                                    { label: "Release Date", value: theme.release_date ? new Date(theme.release_date).toLocaleDateString() : "N/A" }
                                ],
                                actions: [
                                    {
                                        id: "detailInstall",
                                        label: installed ? "Uninstall Theme" : "Install Theme",
                                        icon: installed ? TrashIcon : PlusIcon,
                                        keepOpen: true,
                                        run: () => {
                                            if (installed) uninstallMarketplaceTheme(theme);
                                            else installMarketplaceTheme(theme);
                                        }
                                    },
                                    {
                                        id: "copyLink",
                                        label: "Copy Theme Link",
                                        icon: CopyIcon,
                                        run: () => copyWithToast(themeLink, "Theme link copied to clipboard.")
                                    },
                                    ...(theme.source ? [{
                                        id: "openSource",
                                        label: "Open Source / GitHub",
                                        icon: LinkIcon,
                                        run: () => VencordNative.native.openExternal(theme.source)
                                    }] : []),
                                    {
                                        id: "openSettings",
                                        label: "Open Themes Settings",
                                        icon: GearIcon,
                                        run: () => void openSettingsPage("equicord_themes", "Themes")
                                    }
                                ]
                            }
                        });
                    }
                },
                {
                    id: "copyLink",
                    label: "Copy Theme Link",
                    icon: CopyIcon,
                    run: () => copyWithToast(themeLink, "Theme link copied to clipboard.")
                },
                ...(theme.source ? [{
                    id: "openSource",
                    label: "Open Source Code",
                    icon: LinkIcon,
                    run: () => VencordNative.native.openExternal(theme.source)
                }] : []),
                {
                    id: "openSettings",
                    label: "Open Themes Settings",
                    icon: GearIcon,
                    run: () => void openSettingsPage("equicord_themes", "Themes")
                }
            ];

            return {
                id: `marketplace-${theme.id}`,
                label: theme.name,
                sublabel: `by ${authorName} • ♥ ${theme.likes ?? 0} • ⬇ ${(theme.downloads ?? 0).toLocaleString()}${installed ? " • [Installed]" : ""}`,
                icon: PaintIcon,
                keywords: [
                    theme.name,
                    authorName,
                    ...(theme.tags ?? []),
                    theme.description ?? ""
                ],
                actions
            };
        });
    } catch (e: any) {
        showToast(`Failed to load marketplace themes: ${e?.message ?? e}`, Toasts.Type.FAILURE);
        return [];
    }
}

async function installedThemeItems(): Promise<PaletteListItem[]> {
    const items: PaletteListItem[] = [];

    // Online Themes
    const links = Array.isArray(Settings.themeLinks) ? Settings.themeLinks : [];
    const enabledLinks = Array.isArray(Settings.enabledThemeLinks) ? Settings.enabledThemeLinks : [];
    const pinned = Array.isArray(Settings.pinnedThemes) ? Settings.pinnedThemes : [];
    const names = Settings.themeNames ?? {};

    for (const link of links) {
        const customName = names[link];
        const isEnabled = enabledLinks.includes(link);
        const isPinned = pinned.includes(link);

        items.push({
            id: link,
            label: customName ?? link,
            sublabel: `Online Theme • ${isEnabled ? "Enabled" : "Disabled"}${isPinned ? " • Pinned" : ""}`,
            icon: PaintIcon,
            keywords: [customName ?? "", link, "online"],
            actions: [
                {
                    id: "toggle",
                    label: isEnabled ? "Disable Theme" : "Enable Theme",
                    keepOpen: true,
                    run: () => {
                        if (isEnabled) {
                            Settings.enabledThemeLinks = Settings.enabledThemeLinks.filter(l => l !== link);
                        } else {
                            Settings.enabledThemeLinks = [...Settings.enabledThemeLinks, link];
                        }
                        showToast(`Theme ${isEnabled ? "disabled" : "enabled"}.`, Toasts.Type.SUCCESS);
                    }
                },
                {
                    id: "pin",
                    label: isPinned ? "Unpin Theme" : "Pin Theme",
                    icon: PinIcon,
                    keepOpen: true,
                    run: () => {
                        if (isPinned) {
                            Settings.pinnedThemes = Settings.pinnedThemes.filter(l => l !== link);
                        } else {
                            Settings.pinnedThemes = [...Settings.pinnedThemes, link];
                        }
                        showToast(`Theme ${isPinned ? "unpinned" : "pinned"}.`, Toasts.Type.SUCCESS);
                    }
                },
                {
                    id: "copyUrl",
                    label: "Copy Theme URL",
                    icon: CopyIcon,
                    run: () => copyWithToast(link, "Theme URL copied!")
                },
                {
                    id: "delete",
                    label: "Remove Theme",
                    icon: TrashIcon,
                    keepOpen: true,
                    run: () => {
                        Settings.themeLinks = Settings.themeLinks.filter(l => l !== link);
                        Settings.enabledThemeLinks = Settings.enabledThemeLinks.filter(l => l !== link);
                        showToast("Theme removed.", Toasts.Type.SUCCESS);
                    }
                }
            ]
        });
    }

    // Local Themes
    if (IS_DISCORD_DESKTOP) {
        try {
            const localThemes = await VencordNative.themes.getThemesList();
            const enabledThemes = Array.isArray(Settings.enabledThemes) ? Settings.enabledThemes : [];

            for (const theme of localThemes) {
                const isEnabled = enabledThemes.includes(theme.fileName);
                const isPinned = pinned.includes(theme.fileName);
                const name = theme.name ?? theme.fileName;

                items.push({
                    id: theme.fileName,
                    label: name,
                    sublabel: `Local Theme (${theme.fileName}) • ${isEnabled ? "Enabled" : "Disabled"}${isPinned ? " • Pinned" : ""}`,
                    icon: PaintIcon,
                    keywords: [name, theme.fileName, theme.author ?? "", "local"],
                    actions: [
                        {
                            id: "toggle",
                            label: isEnabled ? "Disable Theme" : "Enable Theme",
                            keepOpen: true,
                            run: () => {
                                if (isEnabled) {
                                    Settings.enabledThemes = Settings.enabledThemes.filter(f => f !== theme.fileName);
                                } else {
                                    Settings.enabledThemes = [...Settings.enabledThemes, theme.fileName];
                                }
                                showToast(`Theme ${isEnabled ? "disabled" : "enabled"}.`, Toasts.Type.SUCCESS);
                            }
                        },
                        {
                            id: "pin",
                            label: isPinned ? "Unpin Theme" : "Pin Theme",
                            icon: PinIcon,
                            keepOpen: true,
                            run: () => {
                                if (isPinned) {
                                    Settings.pinnedThemes = Settings.pinnedThemes.filter(f => f !== theme.fileName);
                                } else {
                                    Settings.pinnedThemes = [...Settings.pinnedThemes, theme.fileName];
                                }
                                showToast(`Theme ${isPinned ? "unpinned" : "pinned"}.`, Toasts.Type.SUCCESS);
                            }
                        },
                        {
                            id: "delete",
                            label: "Delete Local Theme File",
                            icon: TrashIcon,
                            keepOpen: true,
                            run: async () => {
                                Settings.enabledThemes = Settings.enabledThemes.filter(f => f !== theme.fileName);
                                await VencordNative.themes.deleteTheme(theme.fileName);
                                showToast(`Deleted ${theme.fileName}.`, Toasts.Type.SUCCESS);
                            }
                        }
                    ]
                });
            }
        } catch {
            // Ignore error if desktop theme fetch fails
        }
    }

    return items;
}

export const themeCommands: PaletteCommand[] = [
    {
        id: "themes.marketplace",
        title: "Browse Theme Marketplace",
        subtitle: "Browse and install themes from the Equicord Theme Library",
        section: SECTION,
        keywords: ["theme", "marketplace", "store", "download", "browse", "install", "equicord"],
        icon: PaintIcon,
        page: () => ({
            title: "Theme Marketplace",
            icon: PaintIcon,
            spec: {
                type: "list",
                placeholder: "Search themes by name, author, or tag...",
                items: marketplaceItems
            }
        })
    },
    {
        id: "themes.manage",
        title: "Manage Installed Themes",
        subtitle: "Enable, disable, pin, or delete installed local and online themes",
        section: SECTION,
        keywords: ["theme", "manage", "enable", "disable", "installed", "list"],
        icon: PaintIcon,
        page: () => ({
            title: "Installed Themes",
            icon: PaintIcon,
            spec: {
                type: "list",
                placeholder: "Search installed themes...",
                items: installedThemeItems
            }
        })
    },
    {
        id: "themes.openFolder",
        title: "Open Themes Folder",
        subtitle: "Open local folder containing theme .css files",
        section: SECTION,
        keywords: ["theme", "folder", "directory", "css", "open"],
        icon: GearIcon,
        predicate: () => IS_DISCORD_DESKTOP,
        actions: [{
            id: "open",
            label: "Open Themes Folder",
            run: () => VencordNative.themes.openFolder()
        }]
    },
    {
        id: "themes.openSettings",
        title: "Open Themes Settings",
        subtitle: "Open the Themes tab in Equicord Settings",
        section: SECTION,
        keywords: ["theme", "settings", "tab", "appearance"],
        icon: GearIcon,
        actions: [{
            id: "open",
            label: "Open Themes Settings",
            run: () => void openSettingsPage("equicord_themes", "Themes")
        }]
    }
];
