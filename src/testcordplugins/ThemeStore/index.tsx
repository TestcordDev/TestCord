/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Settings } from "@api/Settings";
import definePlugin from "@utils/types";
import { Forms, React, Toasts } from "@webpack/common";

// ─── Types ────────────────────────────────────────────────────────────────────

interface EquiTheme {
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

// ─── Constants ────────────────────────────────────────────────────────────────

const THEMES_API_URL = "https://raw.githubusercontent.com/Equicord/EquiThemesAPI/main/themes.json";

// ─── Native fetch ─────────────────────────────────────────────────────────────

async function nativeFetch(url: string): Promise<string> {
    const helper = (window as any).VencordNative?.pluginHelpers?.ThemeStore;
    if (!helper?.fetchUrl) throw new Error("ThemeStore native helper not found.");
    return await helper.fetchUrl(url);
}

// ─── Theme API ────────────────────────────────────────────────────────────────

async function fetchThemes(): Promise<EquiTheme[]> {
    const raw = await nativeFetch(THEMES_API_URL);
    const data: EquiTheme[] = JSON.parse(raw);
    if (!Array.isArray(data)) throw new Error("Unexpected API response format");
    return data.filter(t => t.type === "theme" || !t.type);
}

// ─── Install ──────────────────────────────────────────────────────────────────

function convertGithubToRaw(url: string): string {
    if (!url) return url;
    return url
        .replace("https://github.com/", "https://raw.githubusercontent.com/")
        .replace("/blob/", "/");
}

function addOnlineTheme(url: string): boolean {
    const S: any = (window as any).Vencord?.Settings ?? Settings;
    if (!S) throw new Error("Could not access Vencord Settings.");
    const currentLinks: string[] = Array.isArray(S.themeLinks) ? [...S.themeLinks] : [];
    const alreadyIn = currentLinks.includes(url);
    if (!alreadyIn) S.themeLinks = [...currentLinks, url];
    const currentEnabled: string[] = Array.isArray(S.enabledThemeLinks) ? [...S.enabledThemeLinks] : [];
    if (!currentEnabled.includes(url)) S.enabledThemeLinks = [...currentEnabled, url];
    return !alreadyIn;
}

async function installTheme(theme: EquiTheme): Promise<boolean> {
    const sourceUrl = convertGithubToRaw(theme.source);
    return addOnlineTheme(sourceUrl);
}

// ─── CSS ──────────────────────────────────────────────────────────────────────

const STYLES = `
/* ── Overlay ── */
.ts-overlay {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.85);
    backdrop-filter: blur(12px);
    display: flex; align-items: center; justify-content: center;
    z-index: 10000;
    animation: ts-fade-in 0.2s ease;
}
@keyframes ts-fade-in { from{opacity:0} to{opacity:1} }

/* ── Modal shell ── */
.ts-modal {
    display: flex;
    width: min(1100px, 95vw);
    height: min(88vh, 820px);
    background: #111214;
    border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 32px 80px rgba(0,0,0,0.8);
    animation: ts-modal-in 0.25s cubic-bezier(0.34,1.2,0.64,1);
    border: 1px solid rgba(255,255,255,0.06);
}
@keyframes ts-modal-in {
    from { opacity:0; transform: scale(0.94) translateY(20px); }
    to   { opacity:1; transform: scale(1)    translateY(0); }
}

/* ── Left panel: list ── */
.ts-left {
    display: flex; flex-direction: column;
    width: 340px; flex-shrink: 0;
    background: #111214;
    border-right: 1px solid rgba(255,255,255,0.06);
}

/* ── Header ── */
.ts-header {
    padding: 20px 20px 16px;
    background: linear-gradient(160deg, #5865f2, #3b45c4);
    flex-shrink: 0;
}
.ts-header-top { display: flex; align-items: center; justify-content: space-between; }
.ts-title { margin: 0; font-size: 20px; font-weight: 800; color: #fff; letter-spacing: -0.3px; }
.ts-subtitle { margin: 3px 0 0; font-size: 11px; color: rgba(255,255,255,0.6); }
.ts-close-btn {
    background: rgba(255,255,255,0.15); border: none; border-radius: 50%;
    width: 30px; height: 30px; color: #fff; font-size: 18px; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: background 0.15s;
}
.ts-close-btn:hover { background: rgba(255,255,255,0.28); }

/* ── Search ── */
.ts-search-wrap { padding: 12px 14px; flex-shrink: 0; border-bottom: 1px solid rgba(255,255,255,0.06); }
.ts-search {
    width: 100%; box-sizing: border-box;
    background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px; color: #dbdee1; font-size: 13px;
    padding: 8px 12px; outline: none; font-family: inherit;
    transition: border-color 0.15s, background 0.15s;
}
.ts-search:focus { border-color: #5865f2; background: rgba(255,255,255,0.09); }
.ts-search::placeholder { color: #4e5058; }

/* ── Sort tabs ── */
.ts-sort-tabs {
    display: flex; gap: 4px; padding: 8px 14px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    flex-shrink: 0;
}
.ts-sort-tab {
    flex: 1; padding: 5px 0; font-size: 11px; font-weight: 600;
    background: transparent; border: 1px solid rgba(255,255,255,0.08);
    border-radius: 6px; color: #72767d; cursor: pointer;
    transition: all 0.15s; font-family: inherit; text-align: center;
}
.ts-sort-tab:hover { color: #b5bac1; border-color: rgba(255,255,255,0.15); }
.ts-sort-tab.active { background: #5865f2; color: #fff; border-color: #5865f2; }

/* ── Stats ── */
.ts-stats { padding: 6px 14px; font-size: 10px; color: #4e5058; flex-shrink: 0; }

/* ── Theme list ── */
.ts-list {
    flex: 1; overflow-y: auto;
    padding: 6px 8px;
    scrollbar-width: thin; scrollbar-color: #2e2f35 transparent;
}
.ts-list::-webkit-scrollbar { width: 4px; }
.ts-list::-webkit-scrollbar-thumb { background: #2e2f35; border-radius: 2px; }

/* ── List item ── */
.ts-item {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 10px; border-radius: 8px; cursor: pointer;
    transition: background 0.12s;
    border: 1px solid transparent;
}
.ts-item:hover { background: rgba(255,255,255,0.04); }
.ts-item.selected {
    background: rgba(88,101,242,0.15);
    border-color: rgba(88,101,242,0.3);
}
.ts-item-thumb {
    width: 56px; height: 36px; border-radius: 5px;
    object-fit: cover; flex-shrink: 0;
    background: #1e1f22;
}
.ts-item-thumb-placeholder {
    width: 56px; height: 36px; border-radius: 5px;
    background: #1e1f22; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    font-size: 16px;
}
.ts-item-info { flex: 1; min-width: 0; }
.ts-item-name {
    font-size: 13px; font-weight: 600; color: #f2f3f5;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    margin: 0 0 2px;
}
.ts-item-author { font-size: 11px; color: #72767d; margin: 0; }
.ts-item-author span { color: #5865f2; }
.ts-item-badge {
    font-size: 9px; padding: 2px 6px; border-radius: 10px;
    background: #248046; color: #fff; flex-shrink: 0;
    font-weight: 700; letter-spacing: 0.3px;
}

/* ── Right panel: preview ── */
.ts-right {
    flex: 1; display: flex; flex-direction: column;
    background: #111214; overflow: hidden;
}

/* ── Preview image ── */
.ts-preview-img-wrap {
    width: 100%; flex-shrink: 0;
    position: relative; overflow: hidden;
    background: #0d0d0f;
    max-height: 320px;
}
.ts-preview-img {
    width: 100%; display: block;
    object-fit: cover;
    max-height: 320px;
    transition: opacity 0.3s;
}
.ts-preview-placeholder {
    width: 100%; height: 220px;
    display: flex; align-items: center; justify-content: center;
    font-size: 56px; color: #2e2f35;
}

/* ── Preview info ── */
.ts-preview-info {
    flex: 1; padding: 24px 28px;
    overflow-y: auto;
    scrollbar-width: thin; scrollbar-color: #2e2f35 transparent;
}
.ts-preview-info::-webkit-scrollbar { width: 4px; }
.ts-preview-info::-webkit-scrollbar-thumb { background: #2e2f35; border-radius: 2px; }

.ts-preview-name {
    margin: 0 0 4px; font-size: 26px; font-weight: 800;
    color: #f2f3f5; letter-spacing: -0.5px;
}
.ts-preview-author { margin: 0 0 16px; font-size: 14px; color: #72767d; }
.ts-preview-author span { color: #5865f2; font-weight: 600; }
.ts-preview-desc {
    margin: 0 0 20px; font-size: 14px; color: #949ba4;
    line-height: 1.6;
}

/* ── Meta row ── */
.ts-meta-row { display: flex; gap: 20px; margin-bottom: 20px; }
.ts-meta-item { display: flex; flex-direction: column; gap: 2px; }
.ts-meta-label { font-size: 10px; font-weight: 700; color: #4e5058; text-transform: uppercase; letter-spacing: 0.8px; }
.ts-meta-value { font-size: 15px; font-weight: 700; color: #f2f3f5; }

/* ── Tags ── */
.ts-preview-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 24px; }
.ts-ptag {
    font-size: 11px; padding: 4px 10px; border-radius: 20px;
    background: rgba(255,255,255,0.06); color: #949ba4;
    border: 1px solid rgba(255,255,255,0.08);
}

/* ── Install button ── */
.ts-install-btn {
    width: 100%; padding: 14px 0;
    background: linear-gradient(135deg, #5865f2, #4752c4);
    border: none; border-radius: 10px;
    color: #fff; font-size: 15px; font-weight: 700;
    cursor: pointer; font-family: inherit; letter-spacing: 0.3px;
    transition: opacity 0.15s, transform 0.1s;
    box-shadow: 0 4px 16px rgba(88,101,242,0.4);
}
.ts-install-btn:hover  { opacity: 0.9; }
.ts-install-btn:active { transform: scale(0.98); }
.ts-install-btn.done {
    background: linear-gradient(135deg, #248046, #1a6b37);
    box-shadow: 0 4px 16px rgba(36,128,70,0.4);
    cursor: default;
}
.ts-install-btn.busy {
    background: #2e2f35; box-shadow: none; cursor: wait;
}

.ts-source-link {
    display: block; margin-top: 12px; text-align: center;
    font-size: 12px; color: #4e5058; cursor: pointer;
    text-decoration: underline;
    background: none; border: none; font-family: inherit; width: 100%;
    transition: color 0.15s;
}
.ts-source-link:hover { color: #949ba4; }

/* ── Empty state ── */
.ts-empty {
    flex: 1; display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 12px; color: #4e5058;
}
.ts-empty-ico { font-size: 48px; }
.ts-empty p { margin: 0; font-size: 14px; }

/* ── Loading / Error ── */
.ts-center {
    flex: 1; display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 16px; color: #72767d;
}
.ts-center p { margin: 0; font-size: 14px; }
.ts-center .sub { font-size: 12px; color: #4e5058; }
.ts-loader {
    font-size: 32px; display: inline-block;
    animation: ts-spin 0.9s linear infinite;
}
@keyframes ts-spin { to { transform: rotate(360deg); } }
.ts-retry-btn {
    padding: 10px 24px; background: #5865f2;
    border: none; border-radius: 8px;
    color: #fff; font-size: 14px; font-weight: 700;
    cursor: pointer; font-family: inherit;
    transition: background 0.15s;
}
.ts-retry-btn:hover { background: #4752c4; }

/* ── No selection ── */
.ts-no-selection {
    flex: 1; display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 12px; color: #4e5058;
}
.ts-no-selection-ico { font-size: 56px; opacity: 0.4; }
.ts-no-selection p { margin: 0; font-size: 14px; }

/* ── Tag filter bar ── */
.ts-tag-bar {
    display: flex; gap: 6px; flex-wrap: wrap;
    padding: 8px 14px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    flex-shrink: 0;
    max-height: 80px; overflow-y: auto;
    scrollbar-width: thin; scrollbar-color: #2e2f35 transparent;
}
.ts-tag-filter {
    font-size: 10px; padding: 3px 9px; border-radius: 20px;
    background: rgba(255,255,255,0.05); color: #72767d;
    border: 1px solid rgba(255,255,255,0.08);
    cursor: pointer; font-family: inherit;
    transition: all 0.12s; white-space: nowrap;
}
.ts-tag-filter:hover { color: #b5bac1; border-color: rgba(255,255,255,0.2); }
.ts-tag-filter.active {
    background: rgba(88,101,242,0.25); color: #8891f2;
    border-color: rgba(88,101,242,0.5);
}
.ts-tag-filter.active:hover { background: rgba(88,101,242,0.35); }

/* ── Open button ── */
.ts-open-btn {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 9px 18px; background: #5865f2; border: none; border-radius: 8px;
    color: #fff; font-size: 14px; font-weight: 700;
    cursor: pointer; font-family: inherit; margin-top: 8px;
    transition: background 0.15s, transform 0.1s;
}
.ts-open-btn:hover  { background: #4752c4; }
.ts-open-btn:active { transform: scale(0.97); }

/* ── Refresh btn ── */
.ts-refresh-btn {
    background: transparent; border: none; padding: 4px 6px;
    color: rgba(255,255,255,0.5); font-size: 16px; cursor: pointer;
    border-radius: 4px; transition: color 0.15s;
}
.ts-refresh-btn:hover { color: #fff; }
.ts-refresh-btn.spinning { animation: ts-spin 0.65s linear infinite; }
`;

function injectStyles() {
    if (document.getElementById("ts-plugin-styles")) return;
    const el = document.createElement("style");
    el.id = "ts-plugin-styles";
    el.textContent = STYLES;
    document.head.appendChild(el);
}
function removeStyles() { document.getElementById("ts-plugin-styles")?.remove(); }

// ─── Sort options ─────────────────────────────────────────────────────────────

type SortKey = "downloads" | "likes" | "name" | "newest";
const SORTS: { key: SortKey; label: string; }[] = [
    { key: "downloads", label: "↓ Popular" },
    { key: "likes", label: "❤ Liked" },
    { key: "newest", label: "✨ New" },
    { key: "name", label: "A–Z" },
];

// ─── ThemePreview (right panel) ───────────────────────────────────────────────

function ThemePreview({ theme, installed, onInstall }: {
    theme: EquiTheme;
    installed: boolean;
    onInstall(): Promise<void>;
}) {
    const [state, setState] = React.useState<"idle" | "busy" | "done">(installed ? "done" : "idle");
    const [imgErr, setImgErr] = React.useState(false);

    React.useEffect(() => {
        setState(installed ? "done" : "idle");
    }, [theme.id, installed]);

    async function handleInstall() {
        if (state !== "idle") return;
        setState("busy");
        try {
            await onInstall();
            setState("done");
        } catch {
            setState("idle");
        }
    }

    const releaseDate = theme.release_date
        ? new Date(theme.release_date).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
        : "Unknown";

    return (
        <div className="ts-right">
            {/* Preview image */}
            <div className="ts-preview-img-wrap">
                {theme.thumbnail_url && !imgErr ? (
                    <img
                        key={theme.id}
                        className="ts-preview-img"
                        src={theme.thumbnail_url}
                        alt={theme.name}
                        onError={() => setImgErr(true)}
                    />
                ) : (
                    <div className="ts-preview-placeholder">🎨</div>
                )}
            </div>

            {/* Info */}
            <div className="ts-preview-info">
                <h2 className="ts-preview-name">{theme.name}</h2>
                <p className="ts-preview-author">
                    by <span>{theme.author?.discord_name ?? theme.author?.github_name ?? "Unknown"}</span>
                </p>

                {theme.description && (
                    <p className="ts-preview-desc">{theme.description}</p>
                )}

                {/* Stats */}
                <div className="ts-meta-row">
                    <div className="ts-meta-item">
                        <span className="ts-meta-label">Downloads</span>
                        <span className="ts-meta-value">⬇ {(theme.downloads ?? 0).toLocaleString()}</span>
                    </div>
                    <div className="ts-meta-item">
                        <span className="ts-meta-label">Likes</span>
                        <span className="ts-meta-value">❤ {(theme.likes ?? 0).toLocaleString()}</span>
                    </div>
                    <div className="ts-meta-item">
                        <span className="ts-meta-label">Released</span>
                        <span className="ts-meta-value" style={{ fontSize: 13 }}>{releaseDate}</span>
                    </div>
                </div>

                {/* Tags */}
                {theme.tags?.length > 0 && (
                    <div className="ts-preview-tags">
                        {theme.tags.map(tag => (
                            <span key={tag} className="ts-ptag">{tag}</span>
                        ))}
                    </div>
                )}

                {/* Install */}
                <button
                    className={`ts-install-btn${state === "done" ? " done" : state === "busy" ? " busy" : ""}`}
                    onClick={handleInstall}
                    disabled={state !== "idle"}
                >
                    {state === "done" ? "✓ Installed & Active" : state === "busy" ? "Installing…" : "Install Theme"}
                </button>

                <button
                    className="ts-source-link"
                    onClick={() => (window as any).VencordNative?.native?.openExternal?.(theme.source)}
                >
                    View source on GitHub ↗
                </button>
            </div>
        </div>
    );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────

function ThemeStoreModal({ onClose }: { onClose(): void; }) {
    const [themes, setThemes] = React.useState<EquiTheme[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);
    const [search, setSearch] = React.useState("");
    const [sort, setSort] = React.useState<SortKey>("downloads");
    const [selected, setSelected] = React.useState<EquiTheme | null>(null);
    const [installed, setInstalled] = React.useState<Set<number>>(new Set());
    const [refreshing, setRefreshing] = React.useState(false);
    const [activeTag, setActiveTag] = React.useState<string | null>(null);

    async function load(isRefresh = false) {
        if (isRefresh) setRefreshing(true);
        else { setLoading(true); setThemes([]); }
        setError(null);
        try {
            const data = await fetchThemes();
            setThemes(data);
            if (!selected && data.length > 0) setSelected(data[0]);
        } catch (e: any) {
            setError(e?.message ?? "Unknown error");
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }

    React.useEffect(() => { load(); }, []);

    // All unique tags sorted by frequency
    const allTags = React.useMemo(() => {
        const freq: Record<string, number> = {};
        themes.forEach(t => t.tags?.forEach(tag => { freq[tag] = (freq[tag] ?? 0) + 1; }));
        return Object.entries(freq)
            .sort((a, b) => b[1] - a[1])
            .map(([tag]) => tag);
    }, [themes]);

    React.useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    // Hide Website/Source Code bar
    React.useEffect(() => {
        const hiddenEls: HTMLElement[] = [];
        const hideBar = () => {
            document.querySelectorAll<HTMLElement>(".vc-plugin-modal-links").forEach(el => {
                let parent: HTMLElement | null = el;
                while (parent?.parentElement && parent.parentElement !== document.body) {
                    parent = parent.parentElement;
                    const h = parent.getBoundingClientRect().height;
                    if (h > 0 && h < 60) {
                        if (!hiddenEls.includes(parent)) {
                            parent.style.setProperty("display", "none", "important");
                            hiddenEls.push(parent);
                        }
                        break;
                    }
                }
            });
        };
        hideBar();
        const t1 = setTimeout(hideBar, 80);
        const t2 = setTimeout(hideBar, 250);
        return () => {
            clearTimeout(t1); clearTimeout(t2);
            hiddenEls.forEach(el => el.style.removeProperty("display"));
        };
    }, []);

    const visible = React.useMemo(() => {
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
        if (activeTag) {
            list = list.filter(t => t.tags?.includes(activeTag));
        }
        const sorted = [...list];
        if (sort === "downloads") sorted.sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0));
        if (sort === "likes") sorted.sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0));
        if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
        if (sort === "newest") sorted.sort((a, b) => new Date(b.release_date ?? 0).getTime() - new Date(a.release_date ?? 0).getTime());
        return sorted;
    }, [themes, search, sort, activeTag]);

    async function handleInstall(theme: EquiTheme) {
        try {
            const wasNew = await installTheme(theme);
            setInstalled(prev => new Set(prev).add(theme.id));
            Toasts.show({
                id: Toasts.genId(),
                message: wasNew
                    ? `✅ "${theme.name}" installed and activated!`
                    : `ℹ️ "${theme.name}" is already installed.`,
                type: wasNew ? Toasts.Type.SUCCESS : Toasts.Type.MESSAGE,
            });
        } catch (e: any) {
            Toasts.show({
                id: Toasts.genId(),
                message: `❌ Failed: ${e?.message ?? "Unknown error"}`,
                type: Toasts.Type.FAILURE,
            });
        }
    }

    return (
        <div
            className="ts-overlay"
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}
            role="dialog" aria-modal="true"
        >
            <div className="ts-modal">

                {/* ── Left panel ── */}
                <div className="ts-left">
                    <div className="ts-header">
                        <div className="ts-header-top">
                            <h2 className="ts-title">🎨 Theme Store</h2>
                            <button className="ts-close-btn" onClick={onClose}>×</button>
                        </div>
                        <p className="ts-subtitle">Equicord Theme Library • {themes.length} themes</p>
                    </div>

                    <div className="ts-search-wrap">
                        <input
                            className="ts-search"
                            placeholder="Search themes, authors, tags…"
                            value={search}
                            onChange={e => setSearch(e.currentTarget.value)}
                        />
                    </div>

                    <div className="ts-sort-tabs">
                        {SORTS.map(s => (
                            <button
                                key={s.key}
                                className={`ts-sort-tab${sort === s.key ? " active" : ""}`}
                                onClick={() => setSort(s.key)}
                            >{s.label}</button>
                        ))}
                        <button
                            className={`ts-refresh-btn${refreshing ? " spinning" : ""}`}
                            onClick={() => load(true)}
                            title="Refresh"
                        >↻</button>
                    </div>

                    {/* Tag filter bar */}
                    {!loading && !error && allTags.length > 0 && (
                        <div className="ts-tag-bar">
                            {allTags.map(tag => (
                                <button
                                    key={tag}
                                    className={`ts-tag-filter${activeTag === tag ? " active" : ""}`}
                                    onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                                >
                                    {tag}
                                </button>
                            ))}
                        </div>
                    )}

                    {!loading && !error && (
                        <div className="ts-stats">
                            {visible.length} theme{visible.length !== 1 ? "s" : ""}
                            {activeTag ? ` tagged "${activeTag}"` : search ? ` for "${search}"` : ""}
                            {" · "}{installed.size} installed
                            {activeTag && (
                                <span
                                    onClick={() => setActiveTag(null)}
                                    style={{ marginLeft: 6, color: "#5865f2", cursor: "pointer" }}
                                >✕ clear</span>
                            )}
                        </div>
                    )}

                    <div className="ts-list">
                        {loading ? (
                            <div className="ts-center" style={{ minHeight: 200 }}>
                                <span className="ts-loader">⟳</span>
                                <p>Loading themes…</p>
                            </div>
                        ) : error ? (
                            <div className="ts-center" style={{ minHeight: 200 }}>
                                <span style={{ fontSize: 36 }}>⚠️</span>
                                <p>Failed to load</p>
                                <p className="sub">{error}</p>
                                <button className="ts-retry-btn" onClick={() => load()}>Retry</button>
                            </div>
                        ) : visible.length === 0 ? (
                            <div className="ts-empty">
                                <span className="ts-empty-ico">🔍</span>
                                <p>No themes found</p>
                            </div>
                        ) : visible.map(theme => (
                            <ThemeListItem
                                key={theme.id}
                                theme={theme}
                                selected={selected?.id === theme.id}
                                installed={installed.has(theme.id)}
                                onClick={() => setSelected(theme)}
                            />
                        ))}
                    </div>
                </div>

                {/* ── Right panel ── */}
                {selected ? (
                    <ThemePreview
                        theme={selected}
                        installed={installed.has(selected.id)}
                        onInstall={() => handleInstall(selected)}
                    />
                ) : (
                    <div className="ts-right">
                        <div className="ts-no-selection">
                            <span className="ts-no-selection-ico">🎨</span>
                            <p>Select a theme to preview</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── List item ────────────────────────────────────────────────────────────────

function ThemeListItem({ theme, selected, installed, onClick }: {
    theme: EquiTheme;
    selected: boolean;
    installed: boolean;
    onClick(): void;
}) {
    const [imgErr, setImgErr] = React.useState(false);

    return (
        <div
            className={`ts-item${selected ? " selected" : ""}`}
            onClick={onClick}
        >
            {theme.thumbnail_url && !imgErr ? (
                <img
                    className="ts-item-thumb"
                    src={theme.thumbnail_url}
                    alt={theme.name}
                    loading="lazy"
                    onError={() => setImgErr(true)}
                />
            ) : (
                <div className="ts-item-thumb-placeholder">🎨</div>
            )}
            <div className="ts-item-info">
                <p className="ts-item-name">{theme.name}</p>
                <p className="ts-item-author">
                    by <span>{theme.author?.discord_name ?? theme.author?.github_name ?? "Unknown"}</span>
                </p>
            </div>
            {installed && <span className="ts-item-badge">ON</span>}
        </div>
    );
}

// ─── Open button ──────────────────────────────────────────────────────────────

function OpenStoreButton() {
    const [open, setOpen] = React.useState(false);
    return (
        <>
            <button className="ts-open-btn" onClick={() => setOpen(true)}>
                🎨 Open Theme Store
            </button>
            {open && <ThemeStoreModal onClose={() => setOpen(false)} />}
        </>
    );
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export default definePlugin({
    name: "ThemeStore",
    description: "Browse and install themes from Equicord's EquiThemesAPI. Requires native.ts companion file.",
    authors: [{ name: "ThemeStore Plugin", id: 0n }],
    tags: ["Appearance"],
    version: "7.0.0",

    start() { injectStyles(); },
    stop() { removeStyles(); },

    settingsAboutComponent: () => (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Forms.FormText>
                Browse 130+ themes with full previews. Click <strong>Install Theme</strong> to
                activate it instantly via Online Themes.
            </Forms.FormText>
            <OpenStoreButton />
        </div>
    ),

    patches: [
        {
            find: "\"theme-links\"",
            replacement: {
                match: /(\i\.jsx\)\((\i),\{[^}]*?"theme-links"[^}]*?\}\))/,
                replace: "$1,$self.renderThemeStoreBtn()",
            },
            noWarn: true,
        },
    ],

    renderThemeStoreBtn() {
        return React.createElement(OpenStoreButton);
    },
});

/*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  INSTALLATION INSTRUCTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Two files required:
  src/userplugins/ThemeStore/
    ├── index.tsx
    └── native.ts

pnpm build && pnpm inject → restart Discord
Settings → Vencord → Plugins → enable ThemeStore
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
*/
