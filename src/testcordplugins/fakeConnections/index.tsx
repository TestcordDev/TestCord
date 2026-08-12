/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { get as dsGet, set as dsSet } from "@api/DataStore";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { OptionType } from "@utils/types";
import { findByCodeLazy, findByPropsLazy, findComponentByCodeLazy } from "@webpack";
import { React, SearchableSelect, showToast, TextInput, Toasts, UserStore } from "@webpack/common";

const useLegacyPlatformType: (t: string) => string = findByCodeLazy(".TWITTER_LEGACY:");
const platforms: { get(t: string): { icon: { lightSVG: string; darkSVG: string; }; }; } = findByPropsLazy("isSupported", "getByUrl");
const getProfileThemeProps = findByCodeLazy(".getPreviewThemeColors", "primaryColor:");
const Section = findComponentByCodeLazy("headingVariant:", '"section"', "headingIcon:");

interface FakeConnection {
    uid: string;
    type: string;
    name: string;
    url: string;
}

const DS_KEY = "FakeConnections_list_v2";
let _cache: FakeConnection[] = [];
let _cacheLoaded = false;

async function loadConnections(): Promise<FakeConnection[]> {
    const stored = await dsGet<FakeConnection[]>(DS_KEY);
    _cache = stored ?? [];
    _cacheLoaded = true;
    return _cache;
}
async function saveConnections(list: FakeConnection[]) {
    _cache = list;
    await dsSet(DS_KEY, list);
}

const PLATFORM_OPTIONS = [
    { label: "YouTube", value: "youtube" },
    { label: "Twitch", value: "twitch" },
    { label: "Twitter / X", value: "twitter" },
    { label: "GitHub", value: "github" },
    { label: "Steam", value: "steam" },
    { label: "Spotify", value: "spotify" },
    { label: "Reddit", value: "reddit" },
    { label: "TikTok", value: "tiktok" },
    { label: "Instagram", value: "instagram" },
    { label: "Roblox", value: "roblox" },
    { label: "Facebook", value: "facebook" },
    { label: "Xbox", value: "xbox" },
    { label: "PlayStation", value: "playstation" },
    { label: "Epic Games", value: "epicgames" },
    { label: "Battle.net", value: "battlenet" },
    { label: "League of Legends", value: "leagueoflegends" },
    { label: "Riot Games", value: "riotgames" },
    { label: "SoundCloud", value: "soundcloud" },
    { label: "Bluesky", value: "bluesky" },
    { label: "Mastodon", value: "mastodon" },
    { label: "Crunchyroll", value: "crunchyroll" },
    { label: "Domain", value: "domain" },
];

function getPlatformLabel(type: string) {
    return PLATFORM_OPTIONS.find(o => o.value === type)?.label ?? type;
}

function getPlatformIcon(type: string, theme: string): string | null {
    try {
        const p = platforms.get(useLegacyPlatformType(type));
        if (!p) return null;
        return theme === "light" ? p.icon.lightSVG : p.icon.darkSVG;
    } catch { return null; }
}

function ConnectionRow({ connection, theme }: { connection: FakeConnection; theme: string; }) {
    const iconSrc = getPlatformIcon(connection.type, theme);
    const textColor = settings.store.textColor === "black" ? "rgba(0,0,0,0.85)" : "#ffffff";
    const hasLink = connection.url.trim().length > 0;

    const inner = (
        <div className="vc-fc-account-name">
            <span className="vc-fc-name" style={{ color: textColor }}>
                {connection.name}
            </span>
            <svg
                className="vc-fc-arrow"
                style={{ color: textColor }}
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                width="16" height="16"
                fill="none" viewBox="0 0 24 24"
            >
                <path fill="currentColor" d="M8 5a1 1 0 0 0 0 2h7.59L5.29 17.3a1 1 0 1 0 1.42 1.4L17 8.42V16a1 1 0 1 0 2 0V6a1 1 0 0 0-1-1H8Z" />
            </svg>
        </div>
    );

    return (
        <div className="vc-fc-row">
            <div className="vc-fc-icon-box">
                {iconSrc
                    ? <img className="vc-fc-icon" src={iconSrc} alt="" aria-hidden="true" />
                    : <div className="vc-fc-icon-letter" style={{ color: textColor }}>
                        {getPlatformLabel(connection.type)[0]}
                    </div>
                }
            </div>

            {hasLink
                ? <a
                    className="vc-fc-link"
                    href={connection.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    style={{ textDecoration: "none", cursor: "pointer", flex: 1, minWidth: 0 }}
                >
                    {inner}
                </a>
                : <div style={{ flex: 1, minWidth: 0, cursor: "default" }}>
                    {inner}
                </div>
            }
        </div>
    );
}

const ConnectionsSection = ErrorBoundary.wrap(
    ({ userId, isSideBar }: { userId: string; isSideBar: boolean; }) => {
        const myId = UserStore.getCurrentUser()?.id;
        const [connections, setConnections] = React.useState<FakeConnection[]>(() => _cache);
        const [theme, setTheme] = React.useState("dark");

        React.useEffect(() => {
            if (!_cacheLoaded) loadConnections().then(setConnections);
            else setConnections([..._cache]);
            try { setTheme(getProfileThemeProps({})?.theme ?? "dark"); } catch { }
        }, [userId]);

        if (!myId || userId !== myId || !connections.length) return null;

        return (
            <Section
                heading="Connections"
                headingVariant={isSideBar ? "text-xs/semibold" : "text-xs/medium"}
                headingColor={isSideBar ? "text-strong" : "text-default"}
            >
                <div className="vc-fc-list">
                    {connections.map(c => (
                        <ConnectionRow key={c.uid} connection={c} theme={theme} />
                    ))}
                </div>
            </Section>
        );
    },
    { noop: true }
);

function FakeConnectionsPanel() {
    const [list, setList] = React.useState<FakeConnection[]>([]);
    const [pending, setPending] = React.useState<FakeConnection[]>([]);
    const [selType, setSelType] = React.useState("youtube");
    const [name, setName] = React.useState("");
    const [url, setUrl] = React.useState("");
    const [dirty, setDirty] = React.useState(false);
    const [loaded, setLoaded] = React.useState(false);

    React.useEffect(() => {
        loadConnections().then(d => { setList(d); setPending([...d]); setLoaded(true); });
    }, []);

    function update(u: FakeConnection[]) { setPending(u); setDirty(true); }

    async function save() {
        await saveConnections(pending);
        setList([...pending]);
        setDirty(false);
        showToast("Saved! Reopen your profile to see connections.", Toasts.Type.SUCCESS);
    }

    if (!loaded) return <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading...</div>;

    return (
        <div className="vc-fc-settings">

            <div className="vc-fc-note">
                💾 Saved in Discord's own database — nothing leaves your device.<br />
                <code style={{ fontSize: 11, opacity: 0.6 }}>%APPDATA%\discord\Local Storage\leveldb\</code>
            </div>

            {dirty && (
                <div className="vc-fc-banner">
                    <span>⚠ Unsaved changes</span>
                    <div style={{ display: "flex", gap: 8 }}>
                        <Button variant="primary" size="small" onClick={save}>Save</Button>
                        <Button variant="dangerPrimary" size="small" onClick={() => { setPending([...list]); setDirty(false); }}>Discard</Button>
                    </div>
                </div>
            )}

            <div>
                <div className="vc-fc-label">Your Connections</div>
                {pending.length === 0
                    ? <div className="vc-fc-empty">No connections yet. Add one below.</div>
                    : pending.map(c => (
                        <div key={c.uid} className="vc-fc-card">
                            <span className="vc-fc-card-platform">{getPlatformLabel(c.type)}</span>
                            <span className="vc-fc-card-name">{c.name}</span>
                            {c.url && <span className="vc-fc-card-url" title={c.url}>🔗</span>}
                            <Button
                                variant="dangerPrimary"
                                size="small"
                                onClick={() => update(pending.filter(x => x.uid !== c.uid))}
                                style={{ marginLeft: "auto", flexShrink: 0 }}
                            >
                                Remove
                            </Button>
                        </div>
                    ))
                }
            </div>

            <div className="vc-fc-divider" />

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div className="vc-fc-label">Add Connection</div>

                <div>
                    <label className="vc-fc-field-label">Platform</label>
                    <SearchableSelect
                        options={PLATFORM_OPTIONS}
                        value={PLATFORM_OPTIONS.find(o => o.value === selType)?.value}
                        placeholder="Select a platform..."
                        maxVisibleItems={8}
                        onChange={(v: string) => setSelType(v)}
                    />
                </div>

                <div>
                    <label className="vc-fc-field-label">Display Name</label>
                    <TextInput value={name} onChange={setName} placeholder="e.g. YourUsername" />
                </div>

                <div>
                    <label className="vc-fc-field-label">
                        Link <span style={{ fontWeight: 400, opacity: 0.6 }}>(optional — makes it clickable)</span>
                    </label>
                    <TextInput
                        value={url}
                        onChange={setUrl}
                        placeholder="e.g. https://youtube.com/@YourChannel"
                    />
                </div>

                <Button
                    variant="primary"
                    size="medium"
                    disabled={!name.trim() || !selType}
                    onClick={() => {
                        const t = name.trim();
                        if (!t) return;
                        update([...pending, {
                            uid: `fc-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                            type: selType,
                            name: t,
                            url: url.trim(),
                        }]);
                        setName("");
                        setUrl("");
                    }}
                >
                    Add to list
                </Button>
            </div>

            <div className="vc-fc-divider" />

            <Button
                variant="positive"
                size="medium"
                disabled={!dirty}
                onClick={save}
            >
                Save Connections
            </Button>

            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                After saving, reopen your profile to see the connections. Only visible to you.
            </div>
        </div>
    );
}

const settings = definePluginSettings({
    textColor: {
        type: OptionType.SELECT,
        description: "Text color for connection names on your profile",
        default: "white",
        options: [
            { label: "White (dark themes)", value: "white" },
            { label: "Black (light / Nitro gradient themes)", value: "black" },
        ]
    },
    _panel: {
        type: OptionType.COMPONENT,
        description: "",
        component: FakeConnectionsPanel,
    }
});

export default definePlugin({
    name: "FakeConnections",
    description: "Add fake connections to your own profile, visible only to you. Supports custom display names, optional clickable links, and per-theme text color. Manage in plugin settings.",
    authors: [{ name: "lastclipped", id: 0n }],
    tags: ["Appearance", "Customisation"],
    dependencies: ["ProfileSectionsAPI"],
    settings,

    renderProfileSection: {
        render: ConnectionsSection,
        priority: 0,
    },

    async start() {
        await loadConnections();
    },
});
