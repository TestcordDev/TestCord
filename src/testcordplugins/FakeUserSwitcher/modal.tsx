/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./manualFields.css";

import { Flex } from "@components/Flex";
import { FormSwitch } from "@components/FormSwitch";
import { Span } from "@components/Span";
import { fetchUserProfile } from "@utils/discord";
import { ModalContent, ModalFooter, ModalHeader, ModalProps, ModalRoot, ModalSize } from "@utils/modal";
import { Button, GuildStore, React, Select, SelectedGuildStore, showToast, Toasts, UserProfileStore, UserStore, UserUtils } from "@webpack/common";

import { clearTarget, getCachedTarget, getSavedUsers, isActive, loadTarget, logger, notify, resolveTargetUserId, setEnabled, setSavedUsers, settings, subscribe } from "./data";

const ID_RE = /^\d{17,20}$/;

const DECORATIONS_API = "https://fakeprofile.sampath.me/decorations";
const EFFECTS_API = "https://fakeprofile.sampath.me/profile-effects";
const NAMEPLATES_API = "https://fakeprofile.sampath.me/nameplates";

interface NameplatePreset { name: string; src: string; asset: string | null; }

/**
 * Extract the Discord collectibles asset ID from a nameplate `src` URL.
 * Two shapes carry a usable asset the spoof can apply:
 *   - `collectibles-shop/{numericId}/static` → the numeric id
 *   - `assets/collectibles/nameplates/{category}/{name}/static(.png)` → the
 *     `{category}/{name}` path segment (Discord's own static-asset shape)
 * The raw `fakeprofile.sampath.me/nameplates/{hash}.png` rehosts have no
 * Discord collectible behind them, so they return null (preview-only).
 */
function extractNameplateAsset(src: string): string | null {
    const shop = /collectibles-shop\/(\d+)\//.exec(src);
    if (shop) return shop[1];
    const asset = /assets\/collectibles\/nameplates\/(.+?)\/static/.exec(src);
    if (asset) return asset[1];
    return null;
}

const NITRO_LEVELS = [
    { label: "None", icon: "" },
    { label: "Nitro", icon: "https://cdn.discordapp.com/badge-icons/2ba85e8026a8614b640c2837bcdfe21b.png" },
    { label: "Bronze (1 mo)", icon: "https://cdn.discordapp.com/badge-icons/4f33c4a9c64ce221936bd256c356f91f.png" },
    { label: "Silver (2 mo)", icon: "https://cdn.discordapp.com/badge-icons/4514fab914bdbfb4ad2fa23df76121a6.png" },
    { label: "Gold (3 mo)", icon: "https://cdn.discordapp.com/badge-icons/2895086c18d5531d499862e41d1155a6.png" },
    { label: "Platinum (6 mo)", icon: "https://cdn.discordapp.com/badge-icons/0334688279c8359120922938dcb1d6f8.png" },
    { label: "Diamond (12 mo)", icon: "https://cdn.discordapp.com/badge-icons/0d61871f72bb9a33a7ae568c1fb4f20a.png" },
    { label: "Emerald (24 mo)", icon: "https://cdn.discordapp.com/badge-icons/11e2d339068b55d3a506cff34d3780f3.png" },
    { label: "Ruby (36 mo)", icon: "https://cdn.discordapp.com/badge-icons/cd5e2cfd9d7f27a8cdcd3e8a8d5dc9f4.png" },
    { label: "Opal (72 mo)", icon: "https://cdn.discordapp.com/badge-icons/5b154df19c53dce2af92c9b61e6be5e2.png" },
];

// Minimum subscription age (in months) each Nitro tier requires. Indexed to match
// the NITRO_LEVELS grid: index 0 = None, 1 = Nitro (0 mo), 2 = Bronze (1 mo) … 9 = Opal (72 mo).
// Mirrors NITRO_TIER_MONTHS in index.tsx (offset by the leading None entry).
const NITRO_TIER_MIN_MONTHS = [0, 0, 1, 2, 3, 6, 12, 24, 36, 72];
// Boost tier minimum months, indexed to BOOST_LEVELS (0 = None, then 1/2/3/6/9/12/15/18/24).
const BOOST_TIER_MIN_MONTHS = [0, 1, 2, 3, 6, 9, 12, 15, 18, 24];

// Discord Nitro/boosting can't predate the platform — floor the picker here.
const SINCE_MIN_DATE = "2015-01-01";

function toDateInputValue(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

// The latest valid "since" date for a tier: you cannot have held a tier badge
// more recently than its minimum age requires. minMonths back from today.
function maxSinceDateForMonths(minMonths: number): string {
    const d = new Date();
    d.setMonth(d.getMonth() - minMonths);
    return toDateInputValue(d);
}

const BOOST_LEVELS = [
    { label: "None", icon: "" },
    { label: "1 mo", icon: "https://cdn.discordapp.com/badge-icons/51040c70d4f20a921ad6674ff86fc95c.png" },
    { label: "2 mo", icon: "https://cdn.discordapp.com/badge-icons/0e4080d1d333bc7ad29ef6528b6f2fb7.png" },
    { label: "3 mo", icon: "https://cdn.discordapp.com/badge-icons/72bed924410c304dbe3d00a6e593ff59.png" },
    { label: "6 mo", icon: "https://cdn.discordapp.com/badge-icons/df199d2050d3ed4ebf84d64ae83989f8.png" },
    { label: "9 mo", icon: "https://cdn.discordapp.com/badge-icons/996b3e870e8a22ce519b3a50e6bdd52f.png" },
    { label: "12 mo", icon: "https://cdn.discordapp.com/badge-icons/991c9f39ee33d7537d9f408c3e53141e.png" },
    { label: "15 mo", icon: "https://cdn.discordapp.com/badge-icons/cb3ae83c15e970e8f3d410bc62cb8b99.png" },
    { label: "18 mo", icon: "https://cdn.discordapp.com/badge-icons/7142225d31238f6387d9f09efaa02759.png" },
    { label: "24 mo", icon: "https://cdn.discordapp.com/badge-icons/ec92202290b48d0879b7413d2dde3bab.png" },
];

const FLAG_BADGE_OPTIONS = [
    { flag: 1 << 0, label: "Discord Staff", icon: "https://cdn.discordapp.com/badge-icons/5e74e9b61934fc1f67c65515d1f7e60d.png" },
    { flag: 1 << 1, label: "Partnered Server Owner", icon: "https://cdn.discordapp.com/badge-icons/3f9748e53446a137a052f3454e2de41e.png" },
    { flag: 1 << 2, label: "HypeSquad Events", icon: "https://cdn.discordapp.com/badge-icons/bf01d1073931f921909045f3a39fd264.png" },
    { flag: 1 << 3, label: "Bug Hunter Lvl 1", icon: "https://cdn.discordapp.com/badge-icons/2717692c7dca7289b35297368a940dd0.png" },
    { flag: 1 << 6, label: "HypeSquad Bravery", icon: "https://cdn.discordapp.com/badge-icons/8a88d63823d8a71cd5e390baa45efa02.png" },
    { flag: 1 << 7, label: "HypeSquad Brilliance", icon: "https://cdn.discordapp.com/badge-icons/011940fd013da3f7fb926e4a1cd2e618.png" },
    { flag: 1 << 8, label: "HypeSquad Balance", icon: "https://cdn.discordapp.com/badge-icons/3aa41de486fa12454c3761e8e223442e.png" },
    { flag: 1 << 9, label: "Early Supporter", icon: "https://cdn.discordapp.com/badge-icons/7060786766c9c840eb3019e725d2b358.png" },
    { flag: 1 << 14, label: "Bug Hunter Lvl 2", icon: "https://cdn.discordapp.com/badge-icons/848f79194d4be5ff5f81505cbd0ce1e6.png" },
    { flag: 1 << 17, label: "Verified Developer", icon: "https://cdn.discordapp.com/badge-icons/6df5892e0f35b051f8b61eace34f4967.png" },
    { flag: 1 << 18, label: "Former Moderator", icon: "https://cdn.discordapp.com/badge-icons/fee1624003e2fee35cb398e125dc479b.png" },
    { flag: 1 << 22, label: "Active Developer", icon: "https://cdn.discordapp.com/badge-icons/6bdc42827a38498929a4920da12695d9.png" },
];

const CUSTOM_BADGE_OPTIONS = [
    { id: "quest", label: "Completed a quest", icon: "https://cdn.discordapp.com/badge-icons/7d9ae358c8c5e118768335dbe68b4fb8.png" },
    { id: "orbs", label: "Orbs — Apprentice", icon: "https://cdn.discordapp.com/badge-icons/83d8a1eb09a8d64e59233eec5d4d5c2d.png" },
    { id: "oldname", label: "Old username", icon: "https://cdn.discordapp.com/badge-icons/6de6d34650760ba5551a79732e98ed60.png" },
];

const NAMEPLATE_PALETTES = ["cobalt", "crimson", "green", "orange", "pink", "red", "sky", "violet", "yellow"];

interface DecorationPreset { asset: string; skuId: string; animated: boolean; name?: string; }
interface ProfileEffectPreset { id: string; skuId: string; config: { title: string; thumbnailPreviewSrc: string; }; }

async function readImageAsDataUrl(file: File): Promise<string> {
    return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Failed to read the image."));
        reader.onload = () => {
            if (typeof reader.result === "string") resolve(reader.result);
            else reject(new Error("Failed to read the image."));
        };
        reader.readAsDataURL(file);
    });
}

function MfSectionLabel({ children }: { children: React.ReactNode; }) {
    return <div className="fus-mf-section-label">{children}</div>;
}

function MfColorPicker({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void; }) {
    const hex = value ? "#" + Number(value).toString(16).padStart(6, "0") : "";
    return (
        <div className="fus-mf-field">
            <MfSectionLabel>{label}</MfSectionLabel>
            <div className="fus-mf-color-row">
                <input
                    type="color"
                    className="fus-mf-color-swatch"
                    value={hex || "#5865f2"}
                    onChange={e => {
                        const n = parseInt(e.target.value.replace("#", ""), 16);
                        if (!isNaN(n)) onChange(String(n));
                    }}
                />
                <input
                    className="fus-mf-input fus-mf-color-input"
                    placeholder="#5865f2 (decimal)"
                    value={value}
                    onChange={e => onChange(e.target.value)}
                />
                {value && (
                    <button className="fus-mf-clear-btn" onClick={() => onChange("")} title="Clear">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                    </button>
                )}
            </div>
        </div>
    );
}

function MfImageUpload({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void; }) {
    const fileRef = React.useRef<HTMLInputElement>(null);
    function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        readImageAsDataUrl(file).then(onChange).catch(() => showToast("Failed to read the image.", Toasts.Type.FAILURE));
    }
    return (
        <div className="fus-mf-field">
            <MfSectionLabel>{label}</MfSectionLabel>
            <div className="fus-mf-image-row">
                <input className="fus-mf-input fus-mf-url-input" placeholder="Image URL or upload..." value={value.startsWith("data:") ? "" : value} onChange={e => onChange(e.target.value)} />
                <button className="fus-mf-file-btn" onClick={() => fileRef.current?.click()} title="Choose a file">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2Z" /></svg>
                </button>
                <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFile} />
                {value && <>
                    <img src={value} alt="" className="fus-mf-preview-avatar" />
                    <button className="fus-mf-clear-btn" onClick={() => onChange("")} title="Delete">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                    </button>
                </>}
            </div>
        </div>
    );
}

function MfBadgeBtn({ label, icon, active, onClick }: { label: string; icon?: string; active: boolean; onClick: () => void; }) {
    return (
        <button onClick={onClick} className={`fus-mf-badge ${active ? "fus-mf-badge--on" : ""}`} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            {icon && <img src={icon} alt="" style={{ width: 16, height: 16, objectFit: "contain", flexShrink: 0 }} />}
            <span>{label}</span>
        </button>
    );
}

/**
 * Collapsible header for a long option grid. Keeps the panel scannable by
 * letting heavy sections (decorations, effects, badge flags) fold away, and
 * caps the open grid's height with an internal scroll so it never pushes the
 * sections below it out of reach.
 */
function MfCollapse({ label, count, open, onToggle, children }: { label: string; count?: number; open: boolean; onToggle: () => void; children: React.ReactNode; }) {
    return (
        <div className="fus-mf-field">
            <button type="button" className="fus-mf-collapse-header" onClick={onToggle} aria-expanded={open}>
                <span className="fus-mf-collapse-title">
                    {label}{count != null ? ` (${count})` : ""}
                </span>
                <svg className="fus-mf-collapse-chevron" style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
            </button>
            {open && <div className="fus-mf-collapse-body">{children}</div>}
        </div>
    );
}

const RPC_PRESETS: Record<string, {
    activityName: string;
    activityType: number;
    activityState?: string;
    activityDetails?: string;
    activityLargeImage?: string;
    activityLargeText?: string;
    activitySmallImage?: string;
    activitySmallText?: string;
}> = {
    minecraft: {
        activityName: "Minecraft",
        activityType: 0,
        activityState: "Exploring Caves",
        activityDetails: "Singleplayer",
        activityLargeImage: "https://raw.githubusercontent.com/homarr-labs/dashboard-icons/main/png/minecraft.png",
        activityLargeText: "Minecraft",
        activitySmallImage: "https://raw.githubusercontent.com/homarr-labs/dashboard-icons/main/png/minecraft.png",
        activitySmallText: "Survival Mode"
    },
    vscode: {
        activityName: "Visual Studio Code",
        activityType: 0,
        activityState: "Editing index.tsx",
        activityDetails: "Workspace: testcord-plugins",
        activityLargeImage: "https://raw.githubusercontent.com/homarr-labs/dashboard-icons/main/png/vscode.png",
        activityLargeText: "Visual Studio Code",
        activitySmallImage: "https://raw.githubusercontent.com/homarr-labs/dashboard-icons/main/png/vscode.png",
        activitySmallText: "Line 42:15"
    },
    spotify: {
        activityName: "Spotify",
        activityType: 2,
        activityState: "Rick Astley",
        activityDetails: "Never Gonna Give You Up",
        activityLargeImage: "https://raw.githubusercontent.com/homarr-labs/dashboard-icons/main/png/spotify.png",
        activityLargeText: "Rick Astley - Never Gonna Give You Up",
    },
    youtube: {
        activityName: "YouTube",
        activityType: 3,
        activityState: "Watching tech videos",
        activityDetails: "0:42 / 10:00",
        activityLargeImage: "https://raw.githubusercontent.com/homarr-labs/dashboard-icons/main/png/youtube.png",
        activityLargeText: "YouTube",
    }
};

export function FakeUserSwitcherModal({ modalProps }: { modalProps: ModalProps; }) {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);

    React.useEffect(() => { return subscribe(() => forceUpdate()); }, []);

    const [inputId, setInputId] = React.useState("");
    const [loading, setLoading] = React.useState(false);
    const [previewUser, setPreviewUser] = React.useState<any>(getCachedTarget()?.user ?? null);
    const [previewProfile, setPreviewProfile] = React.useState<any>(getCachedTarget()?.profile ?? null);
    const [saved, setSaved] = React.useState(getSavedUsers());
    const [searchQuery, setSearchQuery] = React.useState("");
    const [compact, setCompact] = React.useState(false);
    const [compactHovered, setCompactHovered] = React.useState(false);
    const [manualExpanded, setManualExpanded] = React.useState(settings.store.manualExpanded);
    const [configExpanded, setConfigExpanded] = React.useState(settings.store.configExpanded);
    const [serverExpanded, setServerExpanded] = React.useState(false);
    const [customRpcExpanded, setCustomRpcExpanded] = React.useState(settings.store.customRpcExpanded);
    const [connectionsExpanded, setConnectionsExpanded] = React.useState(settings.store.connectionsExpanded);
    const [nitroExpanded, setNitroExpanded] = React.useState(settings.store.nitroExpanded);
    const [connType, setConnType] = React.useState("github");
    const [connName, setConnName] = React.useState("");
    const [connVerified, setConnVerified] = React.useState(true);
    const [profileExpanded, setProfileExpanded] = React.useState(false);
    const [decoGridOpen, setDecoGridOpen] = React.useState(false);
    const [effectGridOpen, setEffectGridOpen] = React.useState(false);
    const [flagGridOpen, setFlagGridOpen] = React.useState(false);
    const [nameplateGridOpen, setNameplateGridOpen] = React.useState(false);
    const [decorations, setDecorations] = React.useState<DecorationPreset[]>([]);
    const [effects, setEffects] = React.useState<ProfileEffectPreset[]>([]);
    const [nameplates, setNameplates] = React.useState<NameplatePreset[]>([]);
    const mountedRef = React.useRef(true);

    React.useEffect(() => {
        return () => { mountedRef.current = false; };
    }, []);

    React.useEffect(() => {
        const ctrl = new AbortController();
        fetch(DECORATIONS_API, { signal: ctrl.signal })
            .then(r => r.json())
            .then((data: any) => {
                if (!mountedRef.current) return;
                const items = Array.isArray(data) ? data : (data && typeof data === "object" ? Object.values(data) : []);
                setDecorations(items as DecorationPreset[]);
            })
            .catch(e => logger.error("Failed to fetch decorations", e));
        fetch(EFFECTS_API, { signal: ctrl.signal })
            .then(r => r.json())
            .then((data: any) => {
                if (!mountedRef.current) return;
                const items = Array.isArray(data) ? data : (data && typeof data === "object" ? Object.values(data) : []);
                setEffects(items as ProfileEffectPreset[]);
            })
            .catch(e => logger.error("Failed to fetch effects", e));
        fetch(NAMEPLATES_API, { signal: ctrl.signal })
            .then(r => r.json())
            .then((data: any) => {
                if (!mountedRef.current) return;
                const raw = Array.isArray(data) ? data : (data && typeof data === "object" ? Object.values(data) : []);
                const items = (raw as any[])
                    .filter(n => n && typeof n.src === "string")
                    .map(n => ({ name: n.name ?? "Nameplate", src: n.src, asset: extractNameplateAsset(n.src) }));
                setNameplates(items as NameplatePreset[]);
            })
            .catch(e => logger.error("Failed to fetch nameplates", e));
        return () => ctrl.abort();
    }, []);

    const resolvedId = resolveTargetUserId(inputId.trim());
    const isIdInvalid = inputId.trim() !== "" && !ID_RE.test(inputId.trim()) && !resolvedId;
    const isAvatarInvalid = settings.store.manualAvatar.trim() !== "" &&
        !settings.store.manualAvatar.startsWith("http://") &&
        !settings.store.manualAvatar.startsWith("https://");
    const isBannerInvalid = settings.store.manualBanner.trim() !== "" &&
        !settings.store.manualBanner.startsWith("http://") &&
        !settings.store.manualBanner.startsWith("https://") &&
        !/^#[0-9A-Fa-f]{3,6}$/.test(settings.store.manualBanner);

    function doEditSaved(s: any) {
        if (s.id.startsWith("manual_") || s.isManual) {
            settings.store.manualUsername = s.manualUsername ?? s.name;
            settings.store.manualDisplayName = s.manualDisplayName ?? "";
            settings.store.manualClanTag = s.manualClanTag ?? "";
            settings.store.manualAvatar = s.manualAvatar ?? s.avatar ?? "";
            settings.store.manualBio = s.manualBio ?? "";
            settings.store.manualPronouns = s.manualPronouns ?? "";
            settings.store.manualBanner = s.manualBanner ?? "";
            settings.store.manualEmail = s.manualEmail ?? "";
            settings.store.manualPhone = s.manualPhone ?? "";
            settings.store.manualCreatedAt = s.manualCreatedAt ?? "";
            settings.store.manualClanGuildId = s.manualClanGuildId ?? "";
            settings.store.manualClanBadge = s.manualClanBadge ?? "";
            settings.store.manualClanBadgeCustom = s.manualClanBadgeCustom ?? "";
            settings.store.manualStatus = s.manualStatus ?? "online";
            settings.store.manualActivityName = s.manualActivityName ?? "";
            settings.store.manualActivityType = s.manualActivityType ?? 0;
            settings.store.manualActivityState = s.manualActivityState ?? "";
            settings.store.manualActivityDetails = s.manualActivityDetails ?? "";
            settings.store.manualActivityStartTimer = !!s.manualActivityStartTimer;
            settings.store.manualActivityLargeImage = s.manualActivityLargeImage ?? "";
            settings.store.manualActivityLargeText = s.manualActivityLargeText ?? "";
            settings.store.manualActivitySmallImage = s.manualActivitySmallImage ?? "";
            settings.store.manualActivitySmallText = s.manualActivitySmallText ?? "";
            settings.store.customRpcEnabled = !!(s.manualActivityName || s.activity);
            // ── Ported profile-cosmetic fields ──
            settings.store.manualAvatarDataUrl = s.manualAvatarDataUrl ?? "";
            settings.store.manualBannerDataUrl = s.manualBannerDataUrl ?? "";
            settings.store.manualAccentColor = s.manualAccentColor ?? "";
            settings.store.manualAccentColor2 = s.manualAccentColor2 ?? "";
            settings.store.manualPublicFlags = s.manualPublicFlags ?? 0;
            settings.store.manualPremiumType = s.manualPremiumType ?? 0;
            settings.store.manualNitroLevel = s.manualNitroLevel ?? -1;
            settings.store.manualBoostMonths = s.manualBoostMonths ?? -1;
            settings.store.manualNitroSince = s.manualNitroSince ?? "";
            settings.store.manualBoostSince = s.manualBoostSince ?? "";
            settings.store.manualBot = !!s.manualBot;
            settings.store.manualDiscriminator = s.manualDiscriminator ?? "0";
            settings.store.manualAvatarDecoration = s.manualAvatarDecoration ?? "";
            settings.store.manualDecorationAsset = s.manualDecorationAsset ?? "";
            settings.store.manualNameplateAsset = s.manualNameplateAsset ?? "";
            settings.store.manualNameplateSkuId = s.manualNameplateSkuId ?? "";
            settings.store.manualNameplatePalette = s.manualNameplatePalette ?? "";
            settings.store.manualNameplateLabel = s.manualNameplateLabel ?? "";
            settings.store.manualProfileEffectId = s.manualProfileEffectId ?? "";
            settings.store.manualProfileEffectAsset = s.manualProfileEffectAsset ?? "";
            settings.store.manualCustomBadgeIds = JSON.stringify(Array.isArray(s.manualCustomBadgeIds) ? s.manualCustomBadgeIds : []);
            settings.store.manualOldName = s.manualOldName ?? "";

            setManualExpanded(true);
            settings.store.manualExpanded = true;
            setCustomRpcExpanded(true);
            settings.store.customRpcExpanded = true;
            showToast(`Loaded preset details for ${s.name}`, Toasts.Type.SUCCESS);
            forceUpdate();
        } else {
            setInputId(s.id);
            doPreview();
            showToast(`Loaded ID ${s.id} for editing`, Toasts.Type.SUCCESS);
        }
    }

    const active = isActive();
    const currentTargetId = settings.store.targetId;

    const Col = {
        primary: "var(--text-normal, #dbdee1)",
        muted: "var(--text-muted, #949ba4)",
        section: "var(--header-secondary, #b5bac1)",
        online: "var(--status-positive, #23a55a)",
        idle: "var(--status-warning, #f0b232)",
        dnd: "var(--status-danger, #f23f43)",
        offline: "var(--status-offline, #80848e)"
    };

    const Label = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties; }) => (
        <div
            title={typeof children === "string" ? children : undefined}
            style={{
                fontSize: "11px",
                fontWeight: 700,
                letterSpacing: "0.07em",
                textTransform: "uppercase",
                color: Col.section,
                marginBottom: "8px",
                marginTop: "4px",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                ...style
            }}
        >
            {children}
        </div>
    );

    const Pfp = ({ user, size, status }: { user: any; size: number; status?: string; }) => {
        const isManual = user?.id && String(user.id).startsWith("manual_");
        let di = 0;
        if (!isManual && user?.id && user.id !== "0") {
            try { di = Number(BigInt(user.id) >> 22n) % 6; } catch { }
        }
        let src = `https://cdn.discordapp.com/embed/avatars/${di}.png`;
        if (user?.avatar) {
            if (isManual || user.avatar.startsWith("http")) {
                src = user.avatar;
            } else if (user.id && user.id !== "0") {
                src = `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.webp?size=${size <= 32 ? 64 : 128}`;
            }
        }

        const statusColor = status === "idle" ? Col.idle : status === "dnd" ? Col.dnd : status === "offline" ? Col.offline : Col.online;

        return (
            <div style={{ position: "relative", width: size, height: size, flexShrink: 0, transition: settings.store.disableAnimations ? "none" : "width 0.25s cubic-bezier(0.4, 0, 0.2, 1), height 0.25s cubic-bezier(0.4, 0, 0.2, 1)" }}>
                <img
                    src={src}
                    onError={e => { (e.target as HTMLImageElement).src = "https://cdn.discordapp.com/embed/avatars/0.png"; }}
                    style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }}
                />
                {status && (
                    <div style={{
                        position: "absolute",
                        bottom: 0,
                        right: 0,
                        width: Math.max(8, Math.floor(size * 0.3)),
                        height: Math.max(8, Math.floor(size * 0.3)),
                        borderRadius: "50%",
                        backgroundColor: statusColor,
                        border: "2px solid var(--background-secondary)",
                        transition: settings.store.disableAnimations ? "none" : "width 0.25s cubic-bezier(0.4, 0, 0.2, 1), height 0.25s cubic-bezier(0.4, 0, 0.2, 1)"
                    }} />
                )}
            </div>
        );
    };

    async function doPreview() {
        const input = inputId.trim();
        if (!input) return;
        const id = resolveTargetUserId(input);
        if (!id) {
            showToast("Could not resolve username to a cached User ID. Please enter their ID.", Toasts.Type.FAILURE);
            return;
        }
        const me = UserStore.getCurrentUser();
        if (me && me.id === id) {
            showToast("You cannot spoof as yourself! Use 'Apply cosmetics to my account' instead.", Toasts.Type.FAILURE);
            return;
        }
        setLoading(true);
        try {
            const u = await UserUtils.getUser(id);
            if (!mountedRef.current) return;
            if (u) {
                setPreviewUser(u);
                try {
                    const prof = await fetchUserProfile(id, {}, false);
                    if (!mountedRef.current) return;
                    setPreviewProfile(prof);
                } catch {
                    if (!mountedRef.current) return;
                    const prof = UserProfileStore.getUserProfile(id);
                    setPreviewProfile(prof);
                }
            } else {
                showToast("User not found.", Toasts.Type.FAILURE);
            }
        } catch {
            if (!mountedRef.current) return;
            showToast("Failed to fetch user.", Toasts.Type.FAILURE);
        }
        if (!mountedRef.current) return;
        setLoading(false);
    }

    async function doActivate(userId?: string) {
        const input = userId || inputId.trim();
        if (!input) return;

        let id = input;
        if (!id.startsWith("manual_")) {
            const resolved = resolveTargetUserId(input);
            if (!resolved) {
                showToast("Could not resolve username to a cached User ID. Please enter their ID.", Toasts.Type.FAILURE);
                return;
            }
            id = resolved;
        }

        const me = UserStore.getCurrentUser();
        if (me && me.id === id) {
            showToast("You cannot spoof as yourself! Use 'Apply cosmetics to my account' instead.", Toasts.Type.FAILURE);
            return;
        }
        if (id.startsWith("manual_")) {
            const savedItem = saved.find(s => s.id === id);
            if (savedItem) {
                doEditSaved(savedItem);
                settings.store.manualMode = true;
                setEnabled(true);
                showToast(`Activated manual mode as ${savedItem.name}`, Toasts.Type.SUCCESS);
                forceUpdate();
            }
            return;
        }

        setLoading(true);
        try {
            const next = await loadTarget(id);
            if (!mountedRef.current) return;
            setEnabled(true);
            settings.store.manualMode = false;
            setPreviewUser(next.user);
            showToast(`Spoofing as ${next.user.globalName || next.user.username}`, Toasts.Type.SUCCESS);
        } catch (e: any) {
            if (!mountedRef.current) return;
            showToast(e?.message || "Failed to load that user.", Toasts.Type.FAILURE);
        }
        if (!mountedRef.current) return;
        setLoading(false);
    }

    function doDeactivate() {
        clearTarget();
        setPreviewUser(null);
        setPreviewProfile(null);
        showToast("Fake identity disabled.", Toasts.Type.SUCCESS);
    }

    // Upload a local image and store it as a data URL in the given manual
    // setting (manualAvatar / manualBanner). Those fields already accept
    // data: URLs in the render path, so no separate dataUrl field is needed.
    function uploadManualImage(target: "manualAvatar" | "manualBanner" | "manualOverlayBannerDataUrl") {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.onchange = () => {
            const file = input.files?.[0];
            if (!file) return;
            readImageAsDataUrl(file)
                .then(dataUrl => {
                    if (!mountedRef.current) return;
                    settings.store[target] = dataUrl;
                    notify();
                    forceUpdate();
                    const label = target === "manualAvatar" ? "Avatar" : "Banner";
                    showToast(`${label} uploaded.`, Toasts.Type.SUCCESS);
                })
                .catch(() => showToast("Failed to read the image.", Toasts.Type.FAILURE));
        };
        input.click();
    }

    function doRemoveSaved(id: string) {
        const list = getSavedUsers().filter(s => s.id !== id);
        setSavedUsers(list); setSaved(list);
    }

    const renderCompactButton = (
        onClick: () => void,
        title: string,
        defaultBg: string,
        hoverBg: string,
        defaultColor: string,
        hoverColor: string,
        defaultBorder: string,
        hoverBorder: string,
        children: React.ReactNode
    ) => (
        <div
            onClick={onClick}
            title={title}
            style={{
                width: "22px",
                height: "22px",
                borderRadius: "4px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                backgroundColor: defaultBg,
                color: defaultColor,
                border: `1px solid ${defaultBorder}`,
                boxSizing: "border-box",
                transition: settings.store.disableAnimations ? "none" : "background-color 0.12s ease, color 0.12s ease, border-color 0.12s ease, transform 0.1s ease",
            }}
            onMouseEnter={e => {
                e.currentTarget.style.backgroundColor = hoverBg;
                e.currentTarget.style.color = hoverColor;
                e.currentTarget.style.borderColor = hoverBorder;
            }}
            onMouseLeave={e => {
                e.currentTarget.style.backgroundColor = defaultBg;
                e.currentTarget.style.color = defaultColor;
                e.currentTarget.style.borderColor = defaultBorder;
            }}
            onMouseDown={e => { if (!settings.store.disableAnimations) e.currentTarget.style.transform = "scale(0.95)"; }}
            onMouseUp={e => { if (!settings.store.disableAnimations) e.currentTarget.style.transform = "scale(1)"; }}
        >
            {children}
        </div>
    );

    // Get the profile from Discord's UserProfileStore if we have a real user preview
    const getBannerUrl = (user: any, profile: any) => {
        if (!user) return null;
        if (settings.store.manualMode && user.id === "0") {
            return settings.store.manualBanner || null;
        }
        const banner = user.banner ?? profile?.banner;
        if (banner) {
            const animated = banner.startsWith("a_");
            const ext = animated ? "gif" : "png";
            return `https://cdn.discordapp.com/banners/${user.id}/${banner}.${ext}?size=600`;
        }
        return null;
    };

    // Determine currently displayable active user preview
    const activeManualUser = settings.store.manualMode && settings.store.spoofActive ? {
        id: "0",
        username: settings.store.manualUsername || "FakeUser",
        globalName: settings.store.manualUsername || "FakeUser",
        avatar: settings.store.manualAvatar || "",
        bio: settings.store.manualBio,
        pronouns: settings.store.manualPronouns,
        banner: settings.store.manualBanner,
        status: settings.store.manualStatus,
        activity: settings.store.manualActivityName,
        clan: settings.store.manualClanTag && settings.store.manualClanTag.trim() !== "" ? {
            tag: settings.store.manualClanTag.trim(),
            identity_guild_id: "962776363578798130",
            identity_enabled: true
        } : null,
        accentColor: undefined
    } : null;

    const displayUser = previewUser ? {
        id: previewUser.id,
        username: previewUser.username,
        globalName: previewUser.globalName || previewUser.username,
        avatar: previewUser.avatar,
        bio: previewProfile?.bio ?? "",
        pronouns: previewProfile?.pronouns ?? "",
        banner: getBannerUrl(previewUser, previewProfile),
        accentColor: previewProfile?.accentColor,
        clan: previewUser.clan ?? previewProfile?.clan ?? null,
    } : activeManualUser;

    const isCurrentlyActive = (id: string, name?: string, avatar?: string | null) => {
        if (!active) return false;
        if (id.startsWith("manual_")) {
            return settings.store.manualMode && settings.store.manualUsername === name && settings.store.manualAvatar === avatar;
        }
        return !settings.store.manualMode && currentTargetId === id;
    };

    const filteredSaved = saved.filter(s => {
        const query = searchQuery.toLowerCase().trim();
        if (!query) return true;
        const displayUsername = s.username || UserStore.getUser(s.id)?.username;
        return s.name.toLowerCase().includes(query) ||
            s.id.toLowerCase().includes(query) ||
            (displayUsername && displayUsername.toLowerCase().includes(query));
    });

    return (
        <ModalRoot {...modalProps} size={ModalSize.MEDIUM}>
            {/* @ts-ignore */}
            <ModalHeader separator={false} style={{ padding: "20px 20px 0 20px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", width: "100%", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <svg width="22" height="22" viewBox="0 0 24 24"><path fill="var(--header-primary, #ffffff)" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2a7.2 7.2 0 0 1-6-3.22c.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08a7.2 7.2 0 0 1-6 3.22z" /></svg>
                        <span style={{ fontSize: "20px", fontWeight: 700, color: "var(--header-primary, #ffffff)" }}>Fake User Switcher</span>
                        {active && <span style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", color: "var(--status-danger, #f23f43)", backgroundColor: "rgba(237,66,69,0.15)", padding: "2px 8px", borderRadius: "4px" }}>Active</span>}
                    </div>
                    <Button color={Button.Colors.PRIMARY} size={Button.Sizes.NONE} style={{ padding: "4px 8px" }} onClick={() => modalProps.onClose()}>✕</Button>
                </div>
            </ModalHeader>

            <ModalContent style={{ padding: "16px 20px 8px 20px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "16px", paddingBottom: "8px" }}>

                    {/* Input Cloner */}
                    <div>
                        <Label>Target User ID Cloner</Label>
                        <div style={{ display: "flex", gap: "8px" }}>
                            <input
                                type="text"
                                value={inputId}
                                onChange={e => setInputId(e.target.value)}
                                onKeyDown={e => { if (e.key === "Enter") doPreview(); }}
                                placeholder="Enter a Discord User ID"
                                style={{ flex: 1, padding: "10px 14px", backgroundColor: "var(--background-tertiary)", border: `1px solid ${isIdInvalid ? "var(--status-danger)" : "var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.15))"}`, borderRadius: "8px", color: "#dbdee1", fontSize: "14px", outline: "none", fontFamily: "var(--font-code, monospace)" }}
                            />
                            <Button size={Button.Sizes.MEDIUM} color={Button.Colors.BRAND} disabled={loading || !inputId.trim() || isIdInvalid} onClick={doPreview}>{loading ? "..." : "Preview"}</Button>
                        </div>
                        {isIdInvalid && <div style={{ color: "var(--status-danger)", fontSize: "12px", marginTop: "4px" }}>Invalid User ID format. Must be 17-20 digits.</div>}
                    </div>

                    {/* Live Preview Card */}
                    {displayUser && (
                        <div>
                            <Label>{active && (activeManualUser || currentTargetId === displayUser.id) ? "Currently Spoofing As" : "Spoof Preview"}</Label>
                            <div style={{
                                display: "block",
                                backgroundColor: "var(--background-secondary)",
                                borderRadius: "8px",
                                border: `2px solid ${active && (activeManualUser || currentTargetId === displayUser.id) ? "var(--status-danger)" : "var(--background-modifier-accent)"}`,
                                position: "relative",
                                overflow: "hidden"
                            }}>
                                {/* Banner section */}
                                <div style={{
                                    height: "60px",
                                    backgroundColor: displayUser.banner?.startsWith("#")
                                        ? displayUser.banner
                                        : displayUser.accentColor != null
                                            ? `#${displayUser.accentColor.toString(16).padStart(6, "0")}`
                                            : "rgba(255,255,255,0.05)",
                                    backgroundImage: displayUser.banner && !displayUser.banner.startsWith("#") ? `url(${displayUser.banner})` : undefined,
                                    backgroundSize: "cover",
                                    backgroundPosition: "center",
                                    position: "relative"
                                }}>
                                    {active && (activeManualUser || currentTargetId === displayUser.id) && (
                                        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "4px", backgroundColor: "var(--status-danger)" }} />
                                    )}
                                </div>

                                <div style={{ display: "flex", gap: "12px", alignItems: "flex-start", padding: "16px" }}>
                                    <Pfp user={displayUser} size={64} status={settings.store.manualMode ? settings.store.manualStatus : "online"} />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: "18px", fontWeight: 700, color: "#e0e1e5", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: "6px" }}>
                                            <span>{displayUser.globalName || displayUser.username}</span>
                                            {displayUser.clan?.tag && (
                                                <span style={{
                                                    fontSize: "10px",
                                                    fontWeight: 700,
                                                    backgroundColor: "var(--brand-experiment-500, #5865f2)",
                                                    color: "#ffffff",
                                                    padding: "1px 5px",
                                                    borderRadius: "4px",
                                                    textTransform: "uppercase",
                                                    lineHeight: "1.2"
                                                }}>
                                                    {displayUser.clan.tag}
                                                </span>
                                            )}
                                        </div>
                                        <div style={{ fontSize: "13px", color: Col.muted }}>
                                            @{displayUser.username}
                                        </div>
                                        {displayUser.id && displayUser.id !== "0" && (
                                            <div
                                                onClick={() => {
                                                    navigator.clipboard.writeText(displayUser.id);
                                                    showToast("Copied ID to clipboard", Toasts.Type.SUCCESS);
                                                }}
                                                style={{
                                                    display: "block",
                                                    width: "fit-content",
                                                    fontSize: "11px",
                                                    color: Col.section,
                                                    fontFamily: "var(--font-code, monospace)",
                                                    marginTop: "2px",
                                                    cursor: "pointer",
                                                    lineHeight: 1
                                                }}
                                                title="Click to copy ID"
                                            >
                                                ID: {displayUser.id}
                                            </div>
                                        )}
                                        {displayUser.pronouns && (
                                            <div style={{ fontSize: "12px", color: Col.muted, marginTop: "2px", fontStyle: "italic" }}>
                                                {displayUser.pronouns}
                                            </div>
                                        )}
                                        {displayUser.bio && (
                                            <div style={{ fontSize: "12px", color: Col.muted, marginTop: "4px", whiteSpace: "pre-wrap", borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "4px" }}>
                                                {displayUser.bio}
                                            </div>
                                        )}
                                        {settings.store.manualMode && settings.store.manualActivityName && (
                                            <div style={{ fontSize: "12px", color: Col.primary, marginTop: "6px", display: "flex", gap: "4px", alignItems: "center", backgroundColor: "rgba(255,255,255,0.03)", padding: "4px 8px", borderRadius: "4px" }}>
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 12h12M12 6v12" /></svg>
                                                <span>
                                                    <strong>Activity:</strong> {settings.store.manualActivityName} {settings.store.manualActivityState ? `(${settings.store.manualActivityState})` : ""}
                                                </span>
                                            </div>
                                        )}
                                    </div>

                                    <div style={{ display: "flex", flexDirection: "column", gap: "8px", flexShrink: 0 }}>
                                        {!(active && (activeManualUser || currentTargetId === displayUser.id)) ? (
                                            <Button size={Button.Sizes.MEDIUM} color={Button.Colors.GREEN} disabled={loading} onClick={() => doActivate(displayUser.id)}>
                                                {loading ? "..." : "Activate"}
                                            </Button>
                                        ) : (
                                            <Button size={Button.Sizes.MEDIUM} color={Button.Colors.RED} onClick={doDeactivate}>
                                                Deactivate
                                            </Button>
                                        )}
                                        {displayUser && displayUser.id !== "0" && !saved.find(s => s.id === displayUser.id) && (
                                            <Button size={Button.Sizes.MEDIUM} color={Button.Colors.PRIMARY} onClick={() => {
                                                const list = getSavedUsers();
                                                list.push({
                                                    id: displayUser.id,
                                                    name: displayUser.globalName || displayUser.username,
                                                    username: displayUser.username,
                                                    avatar: displayUser.avatar || null
                                                });
                                                setSavedUsers(list); setSaved(list);
                                                showToast("Saved profile!", Toasts.Type.SUCCESS);
                                            }}>Save</Button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Saved Identities */}
                    <div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                <Label>
                                    {searchQuery.trim()
                                        ? `Saved Identities (${filteredSaved.length} of ${saved.length} found)`
                                        : `Saved Identities (${saved.length})`}
                                </Label>
                                <div
                                    role="button"
                                    title="Export saved identities"
                                    className="fus-io-btn"
                                    onClick={() => {
                                        if (saved.length === 0) {
                                            showToast("No presets to export.", Toasts.Type.FAILURE);
                                            return;
                                        }
                                        const blob = new Blob([JSON.stringify(saved, null, 2)], { type: "application/json" });
                                        const a = document.createElement("a");
                                        a.href = URL.createObjectURL(blob);
                                        a.download = `fake-user-presets-${Date.now()}.json`;
                                        a.click();
                                        showToast("Exported presets successfully!", Toasts.Type.SUCCESS);
                                    }}
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                                </div>
                                <div
                                    role="button"
                                    title="Import saved identities"
                                    className="fus-io-btn"
                                    onClick={() => {
                                        const input = document.createElement("input");
                                        input.type = "file";
                                        input.accept = ".json";
                                        input.onchange = async (e: any) => {
                                            const file = e.target.files?.[0];
                                            if (!file) return;
                                            try {
                                                const text = await file.text();
                                                const parsed = JSON.parse(text);
                                                if (Array.isArray(parsed)) {
                                                    const list = [...getSavedUsers()];
                                                    for (const item of parsed) {
                                                        if (item && item.id && item.name) {
                                                            if (!list.find(x => x.id === item.id)) {
                                                                list.push(item);
                                                            }
                                                        }
                                                    }
                                                    setSavedUsers(list);
                                                    setSaved(list);
                                                    showToast(`Imported ${parsed.length} presets successfully!`, Toasts.Type.SUCCESS);
                                                } else {
                                                    showToast("Invalid format. Must be a JSON array.", Toasts.Type.FAILURE);
                                                }
                                            } catch {
                                                showToast("Failed to parse JSON file.", Toasts.Type.FAILURE);
                                            }
                                        };
                                        input.click();
                                    }}
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                                </div>
                            </div>
                            {saved.length > 0 && (
                                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "6px", backgroundColor: "var(--background-tertiary)", border: "1px solid var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.15))", borderRadius: "4px", padding: "4px 8px" }}>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: Col.muted, marginLeft: "2px" }}>
                                            <circle cx="11" cy="11" r="8" />
                                            <line x1="21" y1="21" x2="16.65" y2="16.65" />
                                        </svg>
                                        <input
                                            type="text"
                                            placeholder="Search..."
                                            value={searchQuery}
                                            onChange={e => setSearchQuery(e.target.value)}
                                            style={{
                                                backgroundColor: "transparent",
                                                border: "none",
                                                color: "#dbdee1",
                                                fontSize: "12px",
                                                outline: "none",
                                                width: "120px",
                                                padding: "2px 0"
                                            }}
                                        />
                                    </div>
                                    <div
                                        onClick={() => setCompact(!compact)}
                                        title={compact ? "Show detailed list" : "Show compact list"}
                                        style={{
                                            cursor: "pointer",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            width: "32px",
                                            height: "32px",
                                            borderRadius: "4px",
                                            color: compact ? "#ffffff" : (compactHovered ? "#ffffff" : Col.muted),
                                            backgroundColor: compact
                                                ? (compactHovered ? "var(--brand-experiment-560, #4752c4)" : "var(--brand-experiment, #5865f2)")
                                                : (compactHovered ? "rgba(255, 255, 255, 0.08)" : "transparent"),
                                            transition: settings.store.disableAnimations ? "none" : "color 0.15s ease, background-color 0.15s ease",
                                        }}
                                        onMouseEnter={() => setCompactHovered(true)}
                                        onMouseLeave={() => setCompactHovered(false)}
                                    >
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            {compact ? (
                                                <path d="M3 6h18M3 12h18M3 18h18" />
                                            ) : (
                                                <path d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                                            )}
                                        </svg>
                                    </div>
                                </div>
                            )}
                        </div>
                        {saved.length > 0 ? (
                            <div style={{
                                display: "grid",
                                gridTemplateColumns: compact ? "repeat(3, 1fr)" : "repeat(1, 1fr)",
                                gap: compact ? "8px" : "6px",
                                transition: "grid-template-columns 0.25s cubic-bezier(0.4, 0, 0.2, 1), gap 0.25s ease"
                            }}>
                                {filteredSaved.length > 0 ? (
                                    filteredSaved.map(s => {
                                        const isCurrent = isCurrentlyActive(s.id, s.name, s.avatar);
                                        const displayUsername = s.username || UserStore.getUser(s.id)?.username;
                                        return (
                                            <div
                                                key={s.id}
                                                style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: compact ? "6px" : "12px",
                                                    padding: compact ? "6px 8px" : "10px 14px",
                                                    backgroundColor: "var(--background-secondary)",
                                                    borderRadius: "8px",
                                                    border: `1px solid ${isCurrent ? "var(--status-danger)" : "var(--background-modifier-accent)"}`,
                                                    minWidth: 0,
                                                    boxSizing: "border-box",
                                                    transition: "padding 0.25s cubic-bezier(0.4, 0, 0.2, 1), gap 0.25s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.15s ease, background-color 0.15s ease"
                                                }}
                                            >
                                                <Pfp user={{ id: s.id, avatar: s.avatar }} size={compact ? 24 : 36} />
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div
                                                        onClick={compact ? () => {
                                                            navigator.clipboard.writeText(s.id);
                                                            showToast("Copied ID to clipboard", Toasts.Type.SUCCESS);
                                                        } : undefined}
                                                        title={compact ? `ID: ${s.id}\n(Click to copy)` : undefined}
                                                        style={{
                                                            width: "fit-content",
                                                            maxWidth: "100%",
                                                            cursor: compact ? "pointer" : "default",
                                                            display: "flex",
                                                            flexDirection: "column",
                                                            minWidth: 0
                                                        }}
                                                    >
                                                        <div style={{
                                                            display: "flex",
                                                            flexDirection: compact ? "column" : "row",
                                                            alignItems: compact ? "flex-start" : "center",
                                                            gap: compact ? "0px" : "6px",
                                                            minWidth: 0,
                                                            transition: "gap 0.25s ease"
                                                        }}>
                                                            <span style={{ fontSize: compact ? "13px" : "14px", fontWeight: 600, color: "#e0e1e5", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%", transition: "font-size 0.25s ease" }}>{s.name}</span>
                                                            {displayUsername && (
                                                                <span style={{ fontSize: "11px", color: Col.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
                                                                    @{displayUsername}
                                                                </span>
                                                            )}
                                                            {isCurrent && (
                                                                <span style={{
                                                                    fontSize: "9px",
                                                                    fontWeight: 700,
                                                                    textTransform: "uppercase",
                                                                    color: "var(--status-danger)",
                                                                    backgroundColor: "rgba(237,66,69,0.15)",
                                                                    padding: compact ? "0px" : "1px 6px",
                                                                    borderRadius: "4px",
                                                                    maxHeight: compact ? "0px" : "16px",
                                                                    opacity: compact ? 0 : 1,
                                                                    overflow: "hidden",
                                                                    whiteSpace: "nowrap",
                                                                    transition: "max-height 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease, padding 0.25s ease"
                                                                }}>
                                                                    Active
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div
                                                        onClick={!compact ? () => {
                                                            navigator.clipboard.writeText(s.id);
                                                            showToast("Copied ID to clipboard", Toasts.Type.SUCCESS);
                                                        } : undefined}
                                                        style={{
                                                            display: "block",
                                                            width: "fit-content",
                                                            fontSize: "11px",
                                                            color: Col.section,
                                                            fontFamily: "var(--font-code, monospace)",
                                                            cursor: compact ? "default" : "pointer",
                                                            maxHeight: compact ? "0px" : "16px",
                                                            opacity: compact ? 0 : 1,
                                                            marginTop: compact ? "0px" : "2px",
                                                            overflow: "hidden",
                                                            lineHeight: 1,
                                                            pointerEvents: compact ? "none" : "auto",
                                                            transition: "max-height 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease, margin-top 0.25s ease"
                                                        }}
                                                        title={!compact ? "Click to copy ID" : undefined}
                                                    >
                                                        {s.id}
                                                    </div>
                                                </div>
                                                <div style={{ display: "flex", gap: compact ? "4px" : "6px", flexShrink: 0 }}>
                                                    {compact ? (
                                                        <>
                                                            {!isCurrent ? (
                                                                renderCompactButton(
                                                                    () => doActivate(s.id),
                                                                    "Use identity",
                                                                    "var(--background-tertiary)",
                                                                    "var(--status-positive)",
                                                                    "var(--text-muted)",
                                                                    "#ffffff",
                                                                    "var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.15))",
                                                                    "var(--status-positive)",
                                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                                                                )
                                                            ) : (
                                                                renderCompactButton(
                                                                    doDeactivate,
                                                                    "Stop spoofing",
                                                                    "var(--background-tertiary)",
                                                                    "var(--status-danger)",
                                                                    "var(--text-muted)",
                                                                    "#ffffff",
                                                                    "var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.15))",
                                                                    "var(--status-danger)",
                                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><rect x="5" y="5" width="14" height="14" rx="2" ry="2" /></svg>
                                                                )
                                                            )}
                                                            {renderCompactButton(
                                                                () => doEditSaved(s),
                                                                "Edit identity",
                                                                "var(--background-tertiary)",
                                                                "var(--brand-experiment)",
                                                                "var(--text-muted)",
                                                                "#ffffff",
                                                                "var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.15))",
                                                                "var(--brand-experiment)",
                                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
                                                            )}
                                                            {renderCompactButton(
                                                                () => doRemoveSaved(s.id),
                                                                "Remove",
                                                                "var(--background-tertiary)",
                                                                "var(--status-danger)",
                                                                "var(--text-muted)",
                                                                "#ffffff",
                                                                "var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.15))",
                                                                "var(--status-danger)",
                                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                                                            )}
                                                        </>
                                                    ) : (
                                                        <>
                                                            {!isCurrent && (
                                                                <Button
                                                                    size={Button.Sizes.SMALL}
                                                                    color={Button.Colors.GREEN}
                                                                    disabled={loading}
                                                                    onClick={() => doActivate(s.id)}
                                                                >
                                                                    Use
                                                                </Button>
                                                            )}
                                                            {isCurrent && (
                                                                <Button
                                                                    size={Button.Sizes.SMALL}
                                                                    color={Button.Colors.RED}
                                                                    onClick={doDeactivate}
                                                                >
                                                                    Stop
                                                                </Button>
                                                            )}
                                                            <Button
                                                                size={Button.Sizes.SMALL}
                                                                color={Button.Colors.BRAND}
                                                                onClick={() => doEditSaved(s)}
                                                            >
                                                                Edit
                                                            </Button>
                                                            <Button
                                                                size={Button.Sizes.SMALL}
                                                                color={Button.Colors.PRIMARY}
                                                                onClick={() => doRemoveSaved(s.id)}
                                                            >
                                                                ✕
                                                            </Button>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })
                                ) : (
                                    <div style={{ padding: "10px", color: Col.muted, fontSize: "13px", textAlign: "center" }}>
                                        No matching profiles found.
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div style={{ padding: "14px", backgroundColor: "var(--background-secondary)", borderRadius: "8px", border: "1px dashed var(--background-modifier-accent)", color: Col.muted, fontSize: "13px", textAlign: "center" }}>
                                No saved identities yet. Cloned user profiles will show up here.
                            </div>
                        )}
                    </div>

                    {/* Advanced Manual Spoofing */}
                    <div>
                        <div
                            onClick={() => {
                                const next = !manualExpanded;
                                setManualExpanded(next);
                                settings.store.manualExpanded = next;
                            }}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                cursor: "pointer",
                                userSelect: "none",
                                padding: "12px 16px",
                                backgroundColor: "var(--background-secondary-alt)",
                                borderRadius: "8px",
                                border: "1px solid var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.08))",
                                transition: "background-color 0.2s, border-color 0.2s",
                                marginBottom: "6px"
                            }}
                            onMouseEnter={e => {
                                e.currentTarget.style.backgroundColor = "var(--background-modifier-hover)";
                                e.currentTarget.style.borderColor = "var(--border-neutral-medium, rgba(255, 255, 255, 0.15))";
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.backgroundColor = "var(--background-secondary-alt)";
                                e.currentTarget.style.borderColor = "var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.08))";
                            }}
                        >
                            <span style={{ fontSize: "13px", fontWeight: 700, textTransform: "uppercase", color: Col.primary, letterSpacing: "0.02em" }}>
                                Manual Spoofing
                            </span>
                            <svg
                                style={{
                                    transform: manualExpanded ? "rotate(180deg)" : "rotate(0deg)",
                                    transition: settings.store.disableAnimations ? "none" : "transform 0.2s ease",
                                    color: Col.section
                                }}
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <polyline points="6 9 12 15 18 9" />
                            </svg>
                        </div>
                        <div
                            style={{
                                maxHeight: manualExpanded ? "1200px" : "0px",
                                overflow: "hidden",
                                transition: settings.store.disableAnimations ? "none" : "max-height 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
                                opacity: manualExpanded ? 1 : 0
                            }}
                        >
                            <div style={{ padding: "8px 12px 16px 12px", backgroundColor: "var(--background-secondary)", borderRadius: "8px", border: "1px solid var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.15))", display: "flex", flexDirection: "column", gap: "12px", marginBottom: "8px" }}>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
                                        <div>
                                            <Label>Custom Username</Label>
                                            <input type="text" value={settings.store.manualUsername} onChange={e => { settings.store.manualUsername = e.target.value; notify(); }} placeholder="FakeUser" style={{ width: "100%", padding: "10px", backgroundColor: "var(--background-tertiary)", border: "1px solid var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.15))", borderRadius: "8px", color: "#dbdee1", fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
                                        </div>
                                        <div>
                                            <Label>Custom Display Name</Label>
                                            <input type="text" value={settings.store.manualDisplayName} onChange={e => { settings.store.manualDisplayName = e.target.value; notify(); }} placeholder="Leave blank to use username" style={{ width: "100%", padding: "10px", backgroundColor: "var(--background-tertiary)", border: "1px solid var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.15))", borderRadius: "8px", color: "#dbdee1", fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
                                        </div>
                                        <div>
                                            <Label>Custom Created Date</Label>
                                            <input type="text" value={settings.store.manualCreatedAt} onChange={e => { settings.store.manualCreatedAt = e.target.value; notify(); }} placeholder="YYYY-MM-DD" style={{ width: "100%", padding: "10px", backgroundColor: "var(--background-tertiary)", border: "1px solid var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.15))", borderRadius: "8px", color: "#dbdee1", fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
                                        </div>
                                    </div>

                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
                                        <div>
                                            <Label>Custom Avatar URL</Label>
                                            <div style={{ position: "relative" }}>
                                                <input type="text" value={settings.store.manualAvatar.startsWith("data:") ? "" : settings.store.manualAvatar} onChange={e => { settings.store.manualAvatar = e.target.value; notify(); }} placeholder={settings.store.manualAvatar.startsWith("data:") ? "Uploaded image" : "https://image.png"} style={{ width: "100%", padding: "10px", paddingRight: "38px", backgroundColor: "var(--background-tertiary)", border: `1px solid ${isAvatarInvalid ? "var(--status-warning)" : "var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.15))"}`, borderRadius: "8px", color: "#dbdee1", fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
                                                <button title="Upload an image file" onClick={() => uploadManualImage("manualAvatar")} style={{ position: "absolute", top: "50%", right: "6px", transform: "translateY(-50%)", display: "flex", alignItems: "center", justifyContent: "center", width: "26px", height: "26px", borderRadius: "5px", border: "none", background: "transparent", color: "var(--text-muted, #949ba4)", cursor: "pointer" }} onMouseEnter={e => { e.currentTarget.style.color = "#dbdee1"; e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }} onMouseLeave={e => { e.currentTarget.style.color = "var(--text-muted, #949ba4)"; e.currentTarget.style.background = "transparent"; }}>
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2Z" /></svg>
                                                </button>
                                            </div>
                                            {isAvatarInvalid && <div style={{ color: "var(--status-warning)", fontSize: "11px", marginTop: "2px" }}>Should be a valid http:// or https:// URL</div>}
                                        </div>
                                        <div>
                                            <Label>Custom Banner URL/Hex</Label>
                                            <div style={{ position: "relative" }}>
                                                <input type="text" value={settings.store.manualBanner.startsWith("data:") ? "" : settings.store.manualBanner} onChange={e => { settings.store.manualBanner = e.target.value; notify(); }} placeholder={settings.store.manualBanner.startsWith("data:") ? "Uploaded image" : "#ff0077 or https://banner.png"} style={{ width: "100%", padding: "10px", paddingRight: "38px", backgroundColor: "var(--background-tertiary)", border: `1px solid ${isBannerInvalid ? "var(--status-warning)" : "var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.15))"}`, borderRadius: "8px", color: "#dbdee1", fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
                                                <button title="Upload an image file" onClick={() => uploadManualImage("manualBanner")} style={{ position: "absolute", top: "50%", right: "6px", transform: "translateY(-50%)", display: "flex", alignItems: "center", justifyContent: "center", width: "26px", height: "26px", borderRadius: "5px", border: "none", background: "transparent", color: "var(--text-muted, #949ba4)", cursor: "pointer" }} onMouseEnter={e => { e.currentTarget.style.color = "#dbdee1"; e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }} onMouseLeave={e => { e.currentTarget.style.color = "var(--text-muted, #949ba4)"; e.currentTarget.style.background = "transparent"; }}>
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2Z" /></svg>
                                                </button>
                                            </div>
                                            {isBannerInvalid && <div style={{ color: "var(--status-warning)", fontSize: "11px", marginTop: "2px" }}>Should be a valid URL or hex color (e.g. #ff0077)</div>}
                                        </div>
                                        <div>
                                            <Label>Custom Pronouns</Label>
                                            <input type="text" value={settings.store.manualPronouns} onChange={e => { settings.store.manualPronouns = e.target.value; notify(); }} placeholder="they/them" style={{ width: "100%", padding: "10px", backgroundColor: "var(--background-tertiary)", border: "1px solid var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.15))", borderRadius: "8px", color: "#dbdee1", fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
                                        </div>
                                    </div>

                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
                                        <div>
                                            <Label>Fake Email</Label>
                                            <input type="text" value={settings.store.manualEmail} onChange={e => { settings.store.manualEmail = e.target.value; notify(); }} placeholder="fake@gmail.com" style={{ width: "100%", padding: "10px", backgroundColor: "var(--background-tertiary)", border: "1px solid var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.15))", borderRadius: "8px", color: "#dbdee1", fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
                                        </div>
                                        <div>
                                            <Label>Fake Phone Number</Label>
                                            <input type="text" value={settings.store.manualPhone} onChange={e => { settings.store.manualPhone = e.target.value; notify(); }} placeholder="+1234567890" style={{ width: "100%", padding: "10px", backgroundColor: "var(--background-tertiary)", border: "1px solid var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.15))", borderRadius: "8px", color: "#dbdee1", fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
                                        </div>
                                        <div>
                                            <Label>Custom Status</Label>
                                            <Select
                                                options={[
                                                    { label: "Online", value: "online" },
                                                    { label: "Idle", value: "idle" },
                                                    { label: "Do Not Disturb", value: "dnd" },
                                                    { label: "Invisible / Offline", value: "offline" }
                                                ]}
                                                isSelected={v => v === (settings.store.manualStatus || "online")}
                                                serialize={v => String(v)}
                                                select={v => {
                                                    settings.store.manualStatus = v;
                                                    notify();
                                                }}
                                            />
                                        </div>
                                    </div>

                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
                                        <div>
                                            <Label>Custom Server Tag</Label>
                                            <input type="text" value={settings.store.manualClanTag} onChange={e => { settings.store.manualClanTag = e.target.value; notify(); }} placeholder="e.g. /testcord" style={{ width: "100%", padding: "10px", backgroundColor: "var(--background-tertiary)", border: "1px solid var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.15))", borderRadius: "8px", color: "#dbdee1", fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
                                        </div>
                                        <div>
                                            <Label>Guild Tag Source</Label>
                                            <Select
                                                options={(() => {
                                                    const guilds = Object.values(GuildStore.getGuilds() || {});
                                                    return [
                                                        { label: "None / Default", value: "" },
                                                        ...guilds.map((g: any) => ({
                                                            label: g.name,
                                                            value: g.id
                                                        }))
                                                    ];
                                                })()}
                                                isSelected={v => v === settings.store.manualClanGuildId}
                                                serialize={v => String(v)}
                                                select={v => {
                                                    settings.store.manualClanGuildId = v;
                                                    notify();
                                                }}
                                            />
                                        </div>
                                        <div>
                                            <Label>Guild Tag Badge</Label>
                                            <Select
                                                options={[
                                                    { label: "None", value: "" },
                                                    { label: "Sword", value: "sword" },
                                                    { label: "Leaf", value: "leaf" },
                                                    { label: "Flame", value: "flame" },
                                                    { label: "Heart", value: "heart" },
                                                    { label: "Compass", value: "compass" },
                                                    { label: "Trophy", value: "trophy" },
                                                    { label: "Shield", value: "shield" },
                                                    { label: "Crown", value: "crown" },
                                                    { label: "Star", value: "star" },
                                                    { label: "Moon", value: "moon" },
                                                    { label: "Zap / Lightning", value: "zap" },
                                                    { label: "Skull", value: "skull" },
                                                    { label: "Custom Badge Hash / URL", value: "custom" }
                                                ]}
                                                isSelected={v => v === settings.store.manualClanBadge}
                                                serialize={v => String(v)}
                                                select={v => {
                                                    settings.store.manualClanBadge = v;
                                                    notify();
                                                }}
                                            />
                                        </div>
                                    </div>

                                    {settings.store.manualClanBadge === "custom" && (
                                        <div>
                                            <Label>Custom Guild Tag Badge Hash / URL</Label>
                                            <input type="text" value={settings.store.manualClanBadgeCustom} onChange={e => { settings.store.manualClanBadgeCustom = e.target.value; notify(); }} placeholder="Hash or absolute image URL" style={{ width: "100%", padding: "10px", backgroundColor: "var(--background-tertiary)", border: "1px solid var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.15))", borderRadius: "8px", color: "#dbdee1", fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
                                        </div>
                                    )}

                                    <div>
                                        <Label>Custom Bio / About Me</Label>
                                        <textarea rows={2} value={settings.store.manualBio} onChange={e => { settings.store.manualBio = e.target.value; notify(); }} placeholder="Write a custom bio..." style={{ width: "100%", padding: "10px", backgroundColor: "var(--background-tertiary)", border: "1px solid var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.15))", borderRadius: "8px", color: "#dbdee1", fontSize: "14px", outline: "none", fontFamily: "inherit", resize: "none", boxSizing: "border-box" }} />
                                    </div>

                                    <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "8px", borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "12px" }}>
                                        <Button size={Button.Sizes.MEDIUM} color={Button.Colors.PRIMARY} onClick={() => {
                                            const name = settings.store.manualUsername || "FakeUser";
                                            const list = getSavedUsers();
                                            list.push({
                                                id: `manual_${Date.now()}`,
                                                name,
                                                username: name,
                                                avatar: settings.store.manualAvatar || null,
                                                isManual: true,
                                                manualUsername: settings.store.manualUsername,
                                                manualDisplayName: settings.store.manualDisplayName,
                                                manualClanTag: settings.store.manualClanTag,
                                                manualAvatar: settings.store.manualAvatar,
                                                manualBio: settings.store.manualBio,
                                                manualPronouns: settings.store.manualPronouns,
                                                manualBanner: settings.store.manualBanner,
                                                manualEmail: settings.store.manualEmail,
                                                manualPhone: settings.store.manualPhone,
                                                manualCreatedAt: settings.store.manualCreatedAt,
                                                manualClanGuildId: settings.store.manualClanGuildId,
                                                manualClanBadge: settings.store.manualClanBadge,
                                                manualClanBadgeCustom: settings.store.manualClanBadgeCustom,
                                                manualStatus: settings.store.manualStatus,
                                                manualActivityName: settings.store.manualActivityName,
                                                manualActivityType: settings.store.manualActivityType,
                                                manualActivityState: settings.store.manualActivityState,
                                                manualActivityDetails: settings.store.manualActivityDetails,
                                                manualActivityStartTimer: settings.store.manualActivityStartTimer,
                                                manualActivityLargeImage: settings.store.manualActivityLargeImage,
                                                manualActivityLargeText: settings.store.manualActivityLargeText,
                                                manualActivitySmallImage: settings.store.manualActivitySmallImage,
                                                manualActivitySmallText: settings.store.manualActivitySmallText,
                                                manualAvatarDataUrl: settings.store.manualAvatarDataUrl,
                                                manualBannerDataUrl: settings.store.manualBannerDataUrl,
                                                manualAccentColor: settings.store.manualAccentColor,
                                                manualAccentColor2: settings.store.manualAccentColor2,
                                                manualPublicFlags: settings.store.manualPublicFlags,
                                                manualPremiumType: settings.store.manualPremiumType,
                                                manualNitroLevel: settings.store.manualNitroLevel,
                                                manualBoostMonths: settings.store.manualBoostMonths,
                                                manualBot: settings.store.manualBot,
                                                manualDiscriminator: settings.store.manualDiscriminator,
                                                manualAvatarDecoration: settings.store.manualAvatarDecoration,
                                                manualDecorationAsset: settings.store.manualDecorationAsset,
                                                manualNameplateAsset: settings.store.manualNameplateAsset,
                                                manualNitroSince: settings.store.manualNitroSince,
                                                manualBoostSince: settings.store.manualBoostSince,
                                                manualNameplateSkuId: settings.store.manualNameplateSkuId,
                                                manualNameplatePalette: settings.store.manualNameplatePalette,
                                                manualNameplateLabel: settings.store.manualNameplateLabel,
                                                manualProfileEffectId: settings.store.manualProfileEffectId,
                                                manualProfileEffectAsset: settings.store.manualProfileEffectAsset,
                                                manualCustomBadgeIds: (() => { try { const p = JSON.parse(settings.store.manualCustomBadgeIds || "[]"); return Array.isArray(p) ? p : []; } catch { return []; } })(),
                                                manualOldName: settings.store.manualOldName
                                            });
                                            setSavedUsers(list); setSaved(list);
                                            showToast("Saved custom profile preset!", Toasts.Type.SUCCESS);
                                        }}>Save Identity</Button>
                                        {active && settings.store.manualMode ? (
                                            <Button size={Button.Sizes.MEDIUM} color={Button.Colors.RED} onClick={() => { settings.store.manualMode = false; setEnabled(false); showToast("Manual spoof disabled.", Toasts.Type.SUCCESS); forceUpdate(); }}>Deactivate</Button>
                                        ) : (
                                            <Button size={Button.Sizes.MEDIUM} color={Button.Colors.GREEN} onClick={() => { settings.store.manualMode = true; setEnabled(true); showToast("Manual spoof activated.", Toasts.Type.SUCCESS); forceUpdate(); }}>Activate Spoof</Button>
                                        )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Profile Cosmetics (manual mode) */}
                    <div>
                        <div
                            onClick={() => setProfileExpanded(!profileExpanded)}
                            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", userSelect: "none", padding: "12px 16px", backgroundColor: "var(--background-secondary-alt)", borderRadius: "8px", border: "1px solid var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.08))", transition: "background-color 0.2s, border-color 0.2s", marginBottom: "6px" }}
                            onMouseEnter={e => { e.currentTarget.style.backgroundColor = "var(--background-modifier-hover)"; e.currentTarget.style.borderColor = "var(--border-neutral-medium, rgba(255, 255, 255, 0.15))"; }}
                            onMouseLeave={e => { e.currentTarget.style.backgroundColor = "var(--background-secondary-alt)"; e.currentTarget.style.borderColor = "var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.08))"; }}
                        >
                            <span style={{ fontSize: "13px", fontWeight: 700, textTransform: "uppercase", color: Col.primary, letterSpacing: "0.02em" }}>Profile Cosmetics</span>
                            <svg style={{ transform: profileExpanded ? "rotate(180deg)" : "rotate(0deg)", transition: settings.store.disableAnimations ? "none" : "transform 0.2s ease", color: Col.section }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
                        </div>
                        <div style={{ maxHeight: profileExpanded ? "none" : "0px", overflow: profileExpanded ? "visible" : "hidden", transition: settings.store.disableAnimations ? "none" : "opacity 0.35s cubic-bezier(0.4, 0, 0.2, 1)", opacity: profileExpanded ? 1 : 0 }}>
                            <div style={{ padding: "8px 12px 16px 12px", backgroundColor: "var(--background-secondary)", borderRadius: "8px", border: "1px solid var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.15))", display: "flex", flexDirection: "column", gap: "4px", marginBottom: "8px" }}>

                                <FormSwitch
                                    value={settings.store.overlaySelf}
                                    onChange={v => {
                                        settings.store.overlaySelf = v;
                                        if (v) {
                                            // Overlay and full manual mode are mutually exclusive.
                                            settings.store.manualMode = false;
                                            setEnabled(true);
                                        } else if (!settings.store.manualMode) {
                                            setEnabled(false);
                                        }
                                        notify();
                                        forceUpdate();
                                    }}
                                    description="Apply the cosmetics below (decoration, nameplate, effect, badges, accent, bio, pronouns) onto your OWN real account, keeping your real name and avatar."
                                    title="Apply cosmetics to my account"
                                />

                                <MfColorPicker label="Accent color" value={settings.store.manualAccentColor} onChange={v => { settings.store.manualAccentColor = v; notify(); forceUpdate(); }} />
                                <MfColorPicker label="Accent color 2 (gradient)" value={settings.store.manualAccentColor2} onChange={v => { settings.store.manualAccentColor2 = v; notify(); forceUpdate(); }} />

                                <MfCollapse label="Badges" count={FLAG_BADGE_OPTIONS.length} open={flagGridOpen} onToggle={() => setFlagGridOpen(o => !o)}>
                                    <div className="fus-mf-badges fus-mf-grid-scroll" style={{ marginBottom: 14 }}>
                                        {FLAG_BADGE_OPTIONS.map(b => (
                                            <MfBadgeBtn key={b.flag} label={b.label} icon={b.icon} active={!!((settings.store.manualPublicFlags || 0) & b.flag)} onClick={() => { settings.store.manualPublicFlags = (settings.store.manualPublicFlags || 0) ^ b.flag; notify(); forceUpdate(); }} />
                                        ))}
                                    </div>
                                </MfCollapse>

                                <MfSectionLabel>Nitro badge tier</MfSectionLabel>
                                <div className="fus-mf-badges" style={{ marginBottom: 14 }}>
                                    {NITRO_LEVELS.map((n, i) => (
                                        <MfBadgeBtn key={i} label={n.label} icon={n.icon || undefined} active={(settings.store.manualNitroLevel ?? -1) === (i - 1)} onClick={() => {
                                            const level = i - 1;
                                            settings.store.manualNitroLevel = level;
                                            if (level >= 0) { settings.store.manualPremiumType = 2; } else { settings.store.manualPremiumType = 0; }
                                            notify(); forceUpdate();
                                        }} />
                                    ))}
                                </div>

                                <div className="fus-mf-field">
                                    <MfSectionLabel>Nitro since (optional)</MfSectionLabel>
                                    {(() => {
                                        // manualNitroLevel: -1 none, 0 Nitro, 1 Bronze … 8 Opal.
                                        // Grid index into NITRO_TIER_MIN_MONTHS is level + 1.
                                        const lvl = settings.store.manualNitroLevel ?? -1;
                                        const minMonths = lvl >= 0 ? (NITRO_TIER_MIN_MONTHS[lvl + 1] ?? 0) : 0;
                                        const maxDate = minMonths > 0 ? maxSinceDateForMonths(minMonths) : maxSinceDateForMonths(0);
                                        return (
                                            <input className="fus-mf-input" type="date" min={SINCE_MIN_DATE} max={maxDate} value={settings.store.manualNitroSince} onChange={e => { settings.store.manualNitroSince = e.target.value; notify(); forceUpdate(); }} />
                                        );
                                    })()}
                                </div>

                                <MfSectionLabel>Boost badge tier</MfSectionLabel>
                                <div className="fus-mf-badges" style={{ marginBottom: 14 }}>
                                    {BOOST_LEVELS.map((b, i) => (
                                        <MfBadgeBtn key={i} label={b.label} icon={b.icon || undefined} active={(settings.store.manualBoostMonths ?? -1) === (i - 1)} onClick={() => { settings.store.manualBoostMonths = i - 1; notify(); forceUpdate(); }} />
                                    ))}
                                </div>
                                <div className="fus-mf-field">
                                    <MfSectionLabel>Boosting since (optional)</MfSectionLabel>
                                    {(() => {
                                        // manualBoostMonths: -1 none, 0 = 1mo … 8 = 24mo.
                                        // Grid index into BOOST_TIER_MIN_MONTHS is level + 1.
                                        const lvl = settings.store.manualBoostMonths ?? -1;
                                        const minMonths = lvl >= 0 ? (BOOST_TIER_MIN_MONTHS[lvl + 1] ?? 0) : 0;
                                        const maxDate = minMonths > 0 ? maxSinceDateForMonths(minMonths) : maxSinceDateForMonths(0);
                                        return (
                                            <input className="fus-mf-input" type="date" min={SINCE_MIN_DATE} max={maxDate} value={settings.store.manualBoostSince} onChange={e => { settings.store.manualBoostSince = e.target.value; notify(); forceUpdate(); }} />
                                        );
                                    })()}
                                </div>

                                <MfCollapse label="Avatar decoration" count={decorations.length} open={decoGridOpen} onToggle={() => setDecoGridOpen(o => !o)}>
                                    <div className="fus-mf-decoration-grid fus-mf-grid-scroll">
                                        <div className={`fus-mf-decoration-item ${!settings.store.manualAvatarDecoration ? "fus-mf-decoration-item--selected" : ""}`} onClick={() => { settings.store.manualAvatarDecoration = ""; settings.store.manualDecorationAsset = ""; notify(); forceUpdate(); }}>
                                            <div className="fus-mf-decoration-preview"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" /></svg></div>
                                            <span className="fus-mf-decoration-label">None</span>
                                        </div>
                                        {decorations.map(d => (
                                            <div key={d.asset} className={`fus-mf-decoration-item ${settings.store.manualAvatarDecoration === d.asset ? "fus-mf-decoration-item--selected" : ""}`} onClick={() => { const nv = settings.store.manualAvatarDecoration === d.asset ? "" : d.asset; settings.store.manualAvatarDecoration = nv; settings.store.manualDecorationAsset = nv; notify(); forceUpdate(); }}>
                                                <div className="fus-mf-decoration-preview"><img src={`https://cdn.discordapp.com/avatar-decoration-presets/${d.asset}.png`} alt={d.name || d.asset} className="fus-mf-decoration-img" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} /></div>
                                                <span className="fus-mf-decoration-label">{d.name || d.asset.slice(0, 8)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </MfCollapse>
                                <div className="fus-mf-field">
                                    <MfSectionLabel>Custom decoration asset ID</MfSectionLabel>
                                    <input className="fus-mf-input" value={settings.store.manualDecorationAsset} placeholder="1144307957425778779" onChange={e => { settings.store.manualDecorationAsset = e.target.value; settings.store.manualAvatarDecoration = e.target.value; notify(); forceUpdate(); }} />
                                </div>

                                <MfCollapse label="Nameplate" count={nameplates.length} open={nameplateGridOpen} onToggle={() => setNameplateGridOpen(o => !o)}>
                                    <div className="fus-mf-nameplate-grid fus-mf-grid-scroll">
                                        <div className={`fus-mf-nameplate-item ${!settings.store.manualNameplateAsset ? "fus-mf-nameplate-item--selected" : ""}`} onClick={() => { settings.store.manualNameplateAsset = ""; settings.store.manualNameplateSkuId = ""; notify(); forceUpdate(); }}>
                                            <div className="fus-mf-nameplate-preview"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" /></svg></div>
                                            <span className="fus-mf-nameplate-label">None</span>
                                        </div>
                                        {nameplates.map((n, i) => (
                                            <div key={n.asset || n.src || i} className={`fus-mf-nameplate-item ${n.asset && settings.store.manualNameplateAsset === n.asset ? "fus-mf-nameplate-item--selected" : ""} ${!n.asset ? "fus-mf-nameplate-item--disabled" : ""}`} title={n.asset ? n.name : `${n.name} (preview only — not spoofable)`} onClick={() => { if (!n.asset) { showToast("That nameplate has no spoofable asset ID.", Toasts.Type.FAILURE); return; } const nv = settings.store.manualNameplateAsset === n.asset ? "" : n.asset; settings.store.manualNameplateAsset = nv; settings.store.manualNameplateSkuId = nv; notify(); forceUpdate(); }}>
                                            <div className="fus-mf-nameplate-preview"><img src={n.src} alt={n.name} className="fus-mf-nameplate-img" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} /></div>
                                                <span className="fus-mf-nameplate-label">{n.name}</span>
                                            </div>
                                        ))}
                                    </div>
                                </MfCollapse>
                                <div className="fus-mf-field">
                                    <input className="fus-mf-input" value={settings.store.manualNameplateAsset} placeholder="Nameplate asset ID (e.g. a_abc123)" onChange={e => { settings.store.manualNameplateAsset = e.target.value; notify(); forceUpdate(); }} />
                                </div>
                                <div className="fus-mf-field">
                                    <input className="fus-mf-input" value={settings.store.manualNameplateSkuId} placeholder="SKU ID (same as asset if unsure)" onChange={e => { settings.store.manualNameplateSkuId = e.target.value; notify(); forceUpdate(); }} />
                                </div>
                                <div className="fus-mf-field">
                                    <MfSectionLabel>Palette</MfSectionLabel>
                                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                        <button className={`fus-mf-badge ${!settings.store.manualNameplatePalette ? "fus-mf-badge--on" : ""}`} onClick={() => { settings.store.manualNameplatePalette = ""; notify(); forceUpdate(); }}>None</button>
                                        {NAMEPLATE_PALETTES.map(p => (
                                            <button key={p} className={`fus-mf-badge ${settings.store.manualNameplatePalette === p ? "fus-mf-badge--on" : ""}`} onClick={() => { settings.store.manualNameplatePalette = p; notify(); forceUpdate(); }}>{p}</button>
                                        ))}
                                    </div>
                                </div>
                                <div className="fus-mf-field">
                                    <input className="fus-mf-input" value={settings.store.manualNameplateLabel} placeholder="Label (optional)" onChange={e => { settings.store.manualNameplateLabel = e.target.value; notify(); forceUpdate(); }} />
                                </div>

                                <MfCollapse label="Profile effect" count={effects.length} open={effectGridOpen} onToggle={() => setEffectGridOpen(o => !o)}>
                                    <div className="fus-mf-effect-grid fus-mf-grid-scroll">
                                        <div className={`fus-mf-effect-item ${!settings.store.manualProfileEffectId ? "fus-mf-effect-item--selected" : ""}`} onClick={() => { settings.store.manualProfileEffectId = ""; settings.store.manualProfileEffectAsset = ""; notify(); forceUpdate(); }}>
                                            <div className="fus-mf-effect-preview"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" /></svg></div>
                                            <span className="fus-mf-effect-label">None</span>
                                        </div>
                                        {effects.map(ef => (
                                            <div key={ef.skuId} className={`fus-mf-effect-item ${settings.store.manualProfileEffectId === ef.skuId ? "fus-mf-effect-item--selected" : ""}`} onClick={() => { const nv = settings.store.manualProfileEffectId === ef.skuId ? "" : ef.skuId; settings.store.manualProfileEffectId = nv; settings.store.manualProfileEffectAsset = nv; notify(); forceUpdate(); }}>
                                                <div className="fus-mf-effect-preview"><img src={ef.config.thumbnailPreviewSrc} alt={ef.config.title || ef.skuId} className="fus-mf-effect-img" onError={ev => { (ev.target as HTMLImageElement).style.display = "none"; }} /></div>
                                                <span className="fus-mf-effect-label">{ef.config.title || ef.skuId.slice(0, 8)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </MfCollapse>
                                <div className="fus-mf-field">
                                    <MfSectionLabel>Custom effect SKU ID</MfSectionLabel>
                                    <input className="fus-mf-input" value={settings.store.manualProfileEffectAsset} placeholder="e.g. 1234567890" onChange={e => { settings.store.manualProfileEffectAsset = e.target.value; settings.store.manualProfileEffectId = e.target.value; notify(); forceUpdate(); }} />
                                </div>

                                <MfSectionLabel>Custom badges</MfSectionLabel>
                                <div className="fus-mf-badges" style={{ marginBottom: 14 }}>
                                    {(() => {
                                        let ids: string[] = [];
                                        try { const p = JSON.parse(settings.store.manualCustomBadgeIds || "[]"); if (Array.isArray(p)) ids = p; } catch { /* ignore */ }
                                        return CUSTOM_BADGE_OPTIONS.map(b => (
                                            <MfBadgeBtn key={b.id} label={b.label} icon={b.icon} active={ids.includes(b.id)} onClick={() => {
                                                const next = ids.includes(b.id) ? ids.filter(x => x !== b.id) : [...ids, b.id];
                                                settings.store.manualCustomBadgeIds = JSON.stringify(next);
                                                notify(); forceUpdate();
                                            }} />
                                        ));
                                    })()}
                                </div>
                                {(() => { try { const p = JSON.parse(settings.store.manualCustomBadgeIds || "[]"); return Array.isArray(p) && p.includes("oldname"); } catch { return false; } })() && (
                                    <div className="fus-mf-field">
                                        <MfSectionLabel>Old username</MfSectionLabel>
                                        <input className="fus-mf-input" value={settings.store.manualOldName} placeholder="OldUser#0000" onChange={e => { settings.store.manualOldName = e.target.value; notify(); forceUpdate(); }} />
                                    </div>
                                )}

                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                                    <div className="fus-mf-field">
                                        <MfSectionLabel>Discriminator</MfSectionLabel>
                                        <input className="fus-mf-input" value={settings.store.manualDiscriminator} placeholder="0" onChange={e => { settings.store.manualDiscriminator = e.target.value; notify(); forceUpdate(); }} />
                                    </div>
                                    <div className="fus-mf-field">
                                        <MfSectionLabel>Nitro type (0-3)</MfSectionLabel>
                                        <input className="fus-mf-input" type="number" min="0" max="3" value={String(settings.store.manualPremiumType || 0)} onChange={e => { settings.store.manualPremiumType = Math.min(3, Math.max(0, Number(e.target.value) || 0)); notify(); forceUpdate(); }} />
                                    </div>
                                </div>

                                <FormSwitch value={!!settings.store.manualBot} onChange={v => { settings.store.manualBot = v; notify(); forceUpdate(); }} description="Show the profile as a bot user." title="Bot" />
                                <FormSwitch value={settings.store.spoofNameplate} onChange={v => { settings.store.spoofNameplate = v; notify(); }} description="Mirror the chosen nameplate onto your client-side profile." title="Spoof nameplate" />
                                <FormSwitch value={settings.store.spoofProfileEffect} onChange={v => { settings.store.spoofProfileEffect = v; notify(); }} description="Mirror the chosen profile effect onto your client-side profile." hideBorder title="Spoof profile effect" />
                            </div>
                        </div>
                    </div>

                    {/* Custom Rich Presence (RPC) */}
                    <div>
                        <div
                            onClick={() => {
                                const next = !customRpcExpanded;
                                setCustomRpcExpanded(next);
                                settings.store.customRpcExpanded = next;
                            }}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                cursor: "pointer",
                                userSelect: "none",
                                padding: "12px 16px",
                                backgroundColor: "var(--background-secondary-alt)",
                                borderRadius: "8px",
                                border: "1px solid var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.08))",
                                transition: "background-color 0.2s, border-color 0.2s",
                                marginBottom: "6px"
                            }}
                            onMouseEnter={e => {
                                e.currentTarget.style.backgroundColor = "var(--background-modifier-hover)";
                                e.currentTarget.style.borderColor = "var(--border-neutral-medium, rgba(255, 255, 255, 0.15))";
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.backgroundColor = "var(--background-secondary-alt)";
                                e.currentTarget.style.borderColor = "var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.08))";
                            }}
                        >
                            <span style={{ fontSize: "13px", fontWeight: 700, textTransform: "uppercase", color: Col.primary, letterSpacing: "0.02em" }}>
                                Custom Rich Presence (RPC)
                            </span>
                            <svg
                                style={{
                                    transform: customRpcExpanded ? "rotate(180deg)" : "rotate(0deg)",
                                    transition: settings.store.disableAnimations ? "none" : "transform 0.2s ease",
                                    color: Col.section
                                }}
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <polyline points="6 9 12 15 18 9" />
                            </svg>
                        </div>

                        <div
                            style={{
                                maxHeight: customRpcExpanded ? "1200px" : "0px",
                                overflow: "hidden",
                                transition: settings.store.disableAnimations ? "none" : "max-height 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
                                opacity: customRpcExpanded ? 1 : 0
                            }}
                        >
                            <div style={{ padding: "8px 12px 16px 12px", backgroundColor: "var(--background-secondary)", borderRadius: "8px", border: "1px solid var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.15))", display: "flex", flexDirection: "column", gap: "12px", marginBottom: "8px" }}>
                                <FormSwitch
                                    value={settings.store.customRpcEnabled}
                                    onChange={v => {
                                        settings.store.customRpcEnabled = v;
                                        notify();
                                    }}
                                    description="Override client-side Rich Presence activity with your custom configuration."
                                    title="Enable Custom Rich Presence"
                                />

                                <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "8px" }}>
                                    <div style={{ marginBottom: "10px" }}>
                                        <Label>Activity Preset</Label>
                                        <Select
                                            options={[
                                                { label: "Select a preset...", value: "" },
                                                { label: "Minecraft", value: "minecraft" },
                                                { label: "Visual Studio Code", value: "vscode" },
                                                { label: "Spotify", value: "spotify" },
                                                { label: "YouTube", value: "youtube" }
                                            ]}
                                            select={v => {
                                                if (!v) return;
                                                const preset = RPC_PRESETS[v];
                                                if (preset) {
                                                    settings.store.manualActivityName = preset.activityName;
                                                    settings.store.manualActivityType = preset.activityType;
                                                    settings.store.manualActivityState = preset.activityState ?? "";
                                                    settings.store.manualActivityDetails = preset.activityDetails ?? "";
                                                    settings.store.manualActivityLargeImage = preset.activityLargeImage ?? "";
                                                    settings.store.manualActivityLargeText = preset.activityLargeText ?? "";
                                                    settings.store.manualActivitySmallImage = preset.activitySmallImage ?? "";
                                                    settings.store.manualActivitySmallText = preset.activitySmallText ?? "";
                                                    notify();
                                                }
                                            }}
                                            isSelected={v => false}
                                            serialize={v => v}
                                        />
                                    </div>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                                        <div>
                                            <Label>Activity Status</Label>
                                            <Select
                                                options={[
                                                    { label: "Online", value: "online" },
                                                    { label: "Idle", value: "idle" },
                                                    { label: "Do Not Disturb", value: "dnd" },
                                                    { label: "Invisible", value: "offline" }
                                                ]}
                                                select={v => { settings.store.manualStatus = v; notify(); }}
                                                isSelected={v => v === settings.store.manualStatus}
                                                serialize={v => v}
                                            />
                                        </div>
                                        <div>
                                            <Label>Activity Type</Label>
                                            <Select
                                                options={[
                                                    { label: "Playing", value: 0 },
                                                    { label: "Streaming", value: 1 },
                                                    { label: "Listening to", value: 2 },
                                                    { label: "Watching", value: 3 },
                                                    { label: "Custom Status", value: 4 },
                                                    { label: "Competing in", value: 5 }
                                                ]}
                                                select={v => { settings.store.manualActivityType = Number(v); notify(); }}
                                                isSelected={v => v === settings.store.manualActivityType}
                                                serialize={v => String(v)}
                                            />
                                        </div>
                                    </div>

                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", marginTop: "10px" }}>
                                        <div style={{ gridColumn: "span 1" }}>
                                            <Label>Activity Name</Label>
                                            <input type="text" value={settings.store.manualActivityName} onChange={e => { settings.store.manualActivityName = e.target.value; notify(); }} placeholder="Minecraft" style={{ width: "100%", padding: "10px", backgroundColor: "var(--background-tertiary)", border: "1px solid var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.15))", borderRadius: "8px", color: "#dbdee1", fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
                                        </div>
                                        <div style={{ gridColumn: "span 1" }}>
                                            <Label>State</Label>
                                            <input type="text" value={settings.store.manualActivityState} onChange={e => { settings.store.manualActivityState = e.target.value; notify(); }} placeholder="Survival Mode" style={{ width: "100%", padding: "10px", backgroundColor: "var(--background-tertiary)", border: "1px solid var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.15))", borderRadius: "8px", color: "#dbdee1", fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
                                        </div>
                                        <div style={{ gridColumn: "span 1" }}>
                                            <Label>Details</Label>
                                            <input type="text" value={settings.store.manualActivityDetails} onChange={e => { settings.store.manualActivityDetails = e.target.value; notify(); }} placeholder="Exploring Caves" style={{ width: "100%", padding: "10px", backgroundColor: "var(--background-tertiary)", border: "1px solid var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.15))", borderRadius: "8px", color: "#dbdee1", fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
                                        </div>
                                    </div>

                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginTop: "10px", alignItems: "center" }}>
                                        <FormSwitch
                                            value={settings.store.manualActivityStartTimer}
                                            onChange={v => { settings.store.manualActivityStartTimer = v; notify(); }}
                                            description="Display elapsed time since you started the activity."
                                            title="Enable Activity Timer"
                                        />
                                    </div>

                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginTop: "10px" }}>
                                        <div>
                                            <Label>Large Image URL / Asset Key</Label>
                                            <input type="text" value={settings.store.manualActivityLargeImage} onChange={e => { settings.store.manualActivityLargeImage = e.target.value; notify(); }} placeholder="https://image.png or asset_key" style={{ width: "100%", padding: "10px", backgroundColor: "var(--background-tertiary)", border: "1px solid var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.15))", borderRadius: "8px", color: "#dbdee1", fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
                                        </div>
                                        <div>
                                            <Label>Large Image Text (Tooltip)</Label>
                                            <input type="text" value={settings.store.manualActivityLargeText} onChange={e => { settings.store.manualActivityLargeText = e.target.value; notify(); }} placeholder="Playing Minecraft" style={{ width: "100%", padding: "10px", backgroundColor: "var(--background-tertiary)", border: "1px solid var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.15))", borderRadius: "8px", color: "#dbdee1", fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
                                        </div>
                                    </div>

                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginTop: "10px" }}>
                                        <div>
                                            <Label>Small Image URL / Asset Key</Label>
                                            <input type="text" value={settings.store.manualActivitySmallImage} onChange={e => { settings.store.manualActivitySmallImage = e.target.value; notify(); }} placeholder="https://image.png or asset_key" style={{ width: "100%", padding: "10px", backgroundColor: "var(--background-tertiary)", border: "1px solid var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.15))", borderRadius: "8px", color: "#dbdee1", fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
                                        </div>
                                        <div>
                                            <Label>Small Image Text (Tooltip)</Label>
                                            <input type="text" value={settings.store.manualActivitySmallText} onChange={e => { settings.store.manualActivitySmallText = e.target.value; notify(); }} placeholder="Lvl 42" style={{ width: "100%", padding: "10px", backgroundColor: "var(--background-tertiary)", border: "1px solid var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.15))", borderRadius: "8px", color: "#dbdee1", fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Fake Connections */}
                    <div>
                        <div
                            onClick={() => {
                                const next = !connectionsExpanded;
                                setConnectionsExpanded(next);
                                settings.store.connectionsExpanded = next;
                            }}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                cursor: "pointer",
                                userSelect: "none",
                                padding: "12px 16px",
                                backgroundColor: "var(--background-secondary-alt)",
                                borderRadius: "8px",
                                border: "1px solid var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.08))",
                                transition: "background-color 0.2s, border-color 0.2s",
                                marginBottom: "6px"
                            }}
                            onMouseEnter={e => {
                                e.currentTarget.style.backgroundColor = "var(--background-modifier-hover)";
                                e.currentTarget.style.borderColor = "var(--border-neutral-medium, rgba(255, 255, 255, 0.15))";
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.backgroundColor = "var(--background-secondary-alt)";
                                e.currentTarget.style.borderColor = "var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.08))";
                            }}
                        >
                            <span style={{ fontSize: "13px", fontWeight: 700, textTransform: "uppercase", color: Col.primary, letterSpacing: "0.02em" }}>
                                Fake Connections
                            </span>
                            <svg
                                style={{
                                    transform: connectionsExpanded ? "rotate(180deg)" : "rotate(0deg)",
                                    transition: settings.store.disableAnimations ? "none" : "transform 0.2s ease",
                                    color: Col.section
                                }}
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <polyline points="6 9 12 15 18 9" />
                            </svg>
                        </div>

                        <div
                            style={{
                                maxHeight: connectionsExpanded ? "1200px" : "0px",
                                overflow: "hidden",
                                transition: settings.store.disableAnimations ? "none" : "max-height 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
                                opacity: connectionsExpanded ? 1 : 0
                            }}
                        >
                            <div style={{ padding: "8px 12px 16px 12px", backgroundColor: "var(--background-secondary)", borderRadius: "8px", border: "1px solid var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.15))", display: "flex", flexDirection: "column", gap: "12px", marginBottom: "8px" }}>
                                <FormSwitch
                                    value={settings.store.fakeConnectionsEnabled}
                                    onChange={v => {
                                        settings.store.fakeConnectionsEnabled = v;
                                        notify();
                                    }}
                                    description="Display fake connected social accounts on your profile."
                                    title="Enable Fake Connections"
                                />

                                <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "8px" }}>
                                    <Label>Current Fake Connections</Label>
                                    {(() => {
                                        let list: any[] = [];
                                        try {
                                            list = JSON.parse(settings.store.fakeConnectionsList || "[]");
                                        } catch { }
                                        if (list.length === 0) {
                                            return <div style={{ color: Col.muted, fontSize: "13px", fontStyle: "italic", margin: "8px 0" }}>No connections added yet.</div>;
                                        }
                                        return (
                                            <div style={{ display: "flex", flexDirection: "column", gap: "8px", margin: "8px 0" }}>
                                                {list.map((c: any, index: number) => (
                                                    <div key={c.id || index} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", backgroundColor: "var(--background-tertiary)", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.05)" }}>
                                                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                                            <span style={{ fontWeight: 600, textTransform: "capitalize", color: Col.primary }}>{c.type}</span>
                                                            <span style={{ color: Col.muted }}>•</span>
                                                            <span style={{ color: Col.primary }}>{c.name}</span>
                                                            {c.verified && (
                                                                <span style={{ fontSize: "10px", fontWeight: 700, color: "var(--status-positive)", backgroundColor: "rgba(35,165,90,0.15)", padding: "1px 6px", borderRadius: "4px" }}>Verified</span>
                                                            )}
                                                        </div>
                                                        <Button
                                                            size={Button.Sizes.NONE}
                                                            color={Button.Colors.RED}
                                                            style={{ padding: "4px 8px", fontSize: "12px" }}
                                                            onClick={() => {
                                                                const filtered = list.filter((_, i) => i !== index);
                                                                settings.store.fakeConnectionsList = JSON.stringify(filtered);
                                                                notify();
                                                            }}
                                                        >
                                                            Delete
                                                        </Button>
                                                    </div>
                                                ))}
                                            </div>
                                        );
                                    })()}

                                    <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "12px", marginTop: "12px", display: "flex", flexDirection: "column", gap: "10px" }}>
                                        <Label>Add New Fake Connection</Label>
                                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                                            <div>
                                                <Label>Platform Type</Label>
                                                <Select
                                                    options={[
                                                        { label: "GitHub", value: "github" },
                                                        { label: "Spotify", value: "spotify" },
                                                        { label: "Twitter", value: "twitter" },
                                                        { label: "YouTube", value: "youtube" },
                                                        { label: "Steam", value: "steam" },
                                                        { label: "Twitch", value: "twitch" },
                                                        { label: "Reddit", value: "reddit" },
                                                        { label: "TikTok", value: "tiktok" },
                                                        { label: "Instagram", value: "instagram" },
                                                        { label: "Roblox", value: "roblox" },
                                                        { label: "Xbox", value: "xbox" },
                                                        { label: "PlayStation", value: "playstation" },
                                                        { label: "Epic Games", value: "epicgames" }
                                                    ]}
                                                    select={v => setConnType(v)}
                                                    isSelected={v => v === connType}
                                                    serialize={v => v}
                                                />
                                            </div>
                                            <div>
                                                <Label>Account Name</Label>
                                                <input
                                                    type="text"
                                                    value={connName}
                                                    onChange={e => setConnName(e.target.value)}
                                                    placeholder="e.g. Octocat"
                                                    style={{ width: "100%", padding: "10px", backgroundColor: "var(--background-tertiary)", border: "1px solid var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.15))", borderRadius: "8px", color: "#dbdee1", fontSize: "14px", outline: "none", boxSizing: "border-box" }}
                                                />
                                            </div>
                                        </div>

                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "4px" }}>
                                            <FormSwitch
                                                value={connVerified}
                                                onChange={v => setConnVerified(v)}
                                                description="Show verified badge next to connection."
                                                title="Verified Connection"
                                            />
                                            <Button
                                                size={Button.Sizes.MEDIUM}
                                                color={Button.Colors.BRAND}
                                                disabled={!connName.trim()}
                                                onClick={() => {
                                                    let currentList: any[] = [];
                                                    try {
                                                        currentList = JSON.parse(settings.store.fakeConnectionsList || "[]");
                                                    } catch { }
                                                    currentList.push({
                                                        id: `${connType}_${Date.now()}`,
                                                        type: connType,
                                                        name: connName.trim(),
                                                        verified: connVerified
                                                    });
                                                    settings.store.fakeConnectionsList = JSON.stringify(currentList);
                                                    setConnName("");
                                                    notify();
                                                    showToast(`Added fake ${connType} connection!`, Toasts.Type.SUCCESS);
                                                }}
                                            >
                                                Add Connection
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Server-Specific Identities */}
                    <div>
                        <div
                            onClick={() => setServerExpanded(!serverExpanded)}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                cursor: "pointer",
                                userSelect: "none",
                                padding: "12px 16px",
                                backgroundColor: "var(--background-secondary-alt)",
                                borderRadius: "8px",
                                border: "1px solid var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.08))",
                                transition: "background-color 0.2s, border-color 0.2s",
                                marginBottom: "6px"
                            }}
                            onMouseEnter={e => {
                                e.currentTarget.style.backgroundColor = "var(--background-modifier-hover)";
                                e.currentTarget.style.borderColor = "var(--border-neutral-medium, rgba(255, 255, 255, 0.15))";
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.backgroundColor = "var(--background-secondary-alt)";
                                e.currentTarget.style.borderColor = "var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.08))";
                            }}
                        >
                            <span style={{ fontSize: "13px", fontWeight: 700, textTransform: "uppercase", color: Col.primary, letterSpacing: "0.02em" }}>
                                Server-Specific Spoofs
                            </span>
                            <svg
                                style={{
                                    transform: serverExpanded ? "rotate(180deg)" : "rotate(0deg)",
                                    transition: settings.store.disableAnimations ? "none" : "transform 0.2s ease",
                                    color: Col.section
                                }}
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <polyline points="6 9 12 15 18 9" />
                            </svg>
                        </div>
                        <div
                            style={{
                                maxHeight: serverExpanded ? "1200px" : "0px",
                                overflow: "hidden",
                                transition: settings.store.disableAnimations ? "none" : "max-height 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
                                opacity: serverExpanded ? 1 : 0
                            }}
                        >
                            <div style={{ padding: "8px 12px 16px 12px", backgroundColor: "var(--background-secondary)", borderRadius: "8px", border: "1px solid var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.15))", display: "flex", flexDirection: "column", gap: "12px", marginBottom: "8px" }}>
                                    {(() => {
                                        const currentGuildId = SelectedGuildStore?.getGuildId?.();
                                        if (!currentGuildId) {
                                            return (
                                                <div style={{ color: Col.muted, fontSize: "13px" }}>
                                                    Please open this modal from within a Discord server to configure server-specific identity overrides.
                                                </div>
                                            );
                                        }
                                        const currentGuildName = GuildStore?.getGuild?.(currentGuildId)?.name || "Current Server";
                                        let guildMap: Record<string, string> = {};
                                        try {
                                            guildMap = JSON.parse(settings.store.guildIdentities || "{}");
                                        } catch { /* ignore */ }

                                        const activeIdentityId = guildMap[currentGuildId] || "";

                                        const options = [
                                            { label: "None (Use Global Identity)", value: "" },
                                            ...saved.map(s => ({ label: `${s.name} (${(s as any).isManual ? "Manual" : "Target"})`, value: s.id }))
                                        ];

                                        return (
                                            <>
                                                <div style={{ color: Col.primary, fontSize: "14px", fontWeight: 600 }}>
                                                    Configure identity override for: <span style={{ color: "var(--brand-experiment, #5865f2)" }}>{currentGuildName}</span>
                                                </div>
                                                <div>
                                                    <Label>Select Preset Profile</Label>
                                                    <Select
                                                        options={options}
                                                        select={v => {
                                                            const newMap = { ...guildMap };
                                                            if (v === "") {
                                                                delete newMap[currentGuildId];
                                                                settings.store.guildIdentities = JSON.stringify(newMap);
                                                                notify();
                                                                forceUpdate();
                                                            } else {
                                                                newMap[currentGuildId] = v;
                                                                settings.store.guildIdentities = JSON.stringify(newMap);
                                                                const savedItem = saved.find(s => s.id === v);
                                                                if (savedItem && !(savedItem as any).isManual) {
                                                                    loadTarget(savedItem.id, false)
                                                                        .then(() => {
                                                                            if (!mountedRef.current) return;
                                                                            notify();
                                                                            forceUpdate();
                                                                        })
                                                                        .catch(e => {
                                                                            logger.error("Failed to preload guild target on select", e);
                                                                        });
                                                                } else {
                                                                    notify();
                                                                    forceUpdate();
                                                                }
                                                            }
                                                        }}
                                                        isSelected={v => v === activeIdentityId}
                                                        serialize={v => v}
                                                    />
                                                </div>
                                            </>
                                        );
                                    })()}
                                </div>
                            </div>
                        </div>

                    {/* Fake Nitro Status */}
                    <div>
                        <div
                            onClick={() => {
                                const next = !nitroExpanded;
                                setNitroExpanded(next);
                                settings.store.nitroExpanded = next;
                            }}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                cursor: "pointer",
                                userSelect: "none",
                                padding: "12px 16px",
                                backgroundColor: "var(--background-secondary-alt)",
                                borderRadius: "8px",
                                border: "1px solid var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.08))",
                                transition: "background-color 0.2s, border-color 0.2s",
                                marginBottom: "6px"
                            }}
                            onMouseEnter={e => {
                                e.currentTarget.style.backgroundColor = "var(--background-modifier-hover)";
                                e.currentTarget.style.borderColor = "var(--border-neutral-medium, rgba(255, 255, 255, 0.15))";
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.backgroundColor = "var(--background-secondary-alt)";
                                e.currentTarget.style.borderColor = "var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.08))";
                            }}
                        >
                            <span style={{ fontSize: "13px", fontWeight: 700, textTransform: "uppercase", color: Col.primary, letterSpacing: "0.02em" }}>
                                Fake Nitro Status
                            </span>
                            <svg
                                style={{
                                    transform: nitroExpanded ? "rotate(180deg)" : "rotate(0deg)",
                                    transition: settings.store.disableAnimations ? "none" : "transform 0.2s ease",
                                    color: Col.section
                                }}
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <polyline points="6 9 12 15 18 9" />
                            </svg>
                        </div>
                        <div
                            style={{
                                maxHeight: nitroExpanded ? "1200px" : "0px",
                                overflow: "hidden",
                                transition: settings.store.disableAnimations ? "none" : "max-height 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
                                opacity: nitroExpanded ? 1 : 0
                            }}
                        >
                            <div style={{ padding: "8px 12px 16px 12px", backgroundColor: "var(--background-secondary)", borderRadius: "8px", border: "1px solid var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.15))", display: "flex", flexDirection: "column", gap: "12px", marginBottom: "8px" }}>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                                    <div>
                                        <Label>Nitro Age Presets</Label>
                                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                                            {[
                                                { label: "1 Mo", val: 1 },
                                                { label: "3 Mo", val: 3 },
                                                { label: "6 Mo", val: 6 },
                                                { label: "1 Yr", val: 12 },
                                                { label: "2 Yr", val: 24 },
                                                { label: "3 Yr", val: 36 },
                                                { label: "6 Yr", val: 72 }
                                            ].map(preset => (
                                                <Button
                                                    key={preset.val}
                                                    size={Button.Sizes.MIN}
                                                    color={settings.store.fakeNitroMonths === preset.val ? Button.Colors.BRAND : Button.Colors.PRIMARY}
                                                    onClick={() => {
                                                        settings.store.fakeNitroMonths = preset.val;
                                                        notify();
                                                    }}
                                                >
                                                    {preset.label}
                                                </Button>
                                            ))}
                                        </div>
                                    </div>
                                    <div>
                                        <Label>Custom Months</Label>
                                        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                                            <input
                                                type="number"
                                                min="0"
                                                value={settings.store.fakeNitroMonths}
                                                onChange={e => {
                                                    const val = Math.max(0, parseInt(e.target.value) || 0);
                                                    settings.store.fakeNitroMonths = val;
                                                    notify();
                                                }}
                                                style={{ width: "100%", padding: "10px", backgroundColor: "var(--background-tertiary)", border: "1px solid var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.15))", borderRadius: "8px", color: "#dbdee1", fontSize: "14px", outline: "none", boxSizing: "border-box" }}
                                            />
                                            <Button
                                                size={Button.Sizes.MEDIUM}
                                                color={Button.Colors.RED}
                                                disabled={settings.store.fakeNitroMonths === 0}
                                                onClick={() => {
                                                    settings.store.fakeNitroMonths = 0;
                                                    notify();
                                                }}
                                            >
                                                Reset
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Plugin Options */}
                    <div>
                        <div
                            onClick={() => {
                                const next = !configExpanded;
                                setConfigExpanded(next);
                                settings.store.configExpanded = next;
                            }}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                transition: "background-color 0.2s, border-color 0.2s",
                                justifyContent: "space-between",
                                cursor: "pointer",
                                userSelect: "none",
                                padding: "12px 16px",
                                backgroundColor: "var(--background-secondary-alt)",
                                borderRadius: "8px",
                                border: "1px solid var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.08))",
                                marginBottom: "6px"
                            }}
                            onMouseEnter={e => {
                                e.currentTarget.style.backgroundColor = "var(--background-modifier-hover)";
                                e.currentTarget.style.borderColor = "var(--border-neutral-medium, rgba(255, 255, 255, 0.15))";
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.backgroundColor = "var(--background-secondary-alt)";
                                e.currentTarget.style.borderColor = "var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.08))";
                            }}
                        >
                            <span style={{ fontSize: "13px", fontWeight: 700, textTransform: "uppercase", color: Col.primary, letterSpacing: "0.02em" }}>
                                Configuration
                            </span>
                            <svg
                                style={{
                                    transform: configExpanded ? "rotate(180deg)" : "rotate(0deg)",
                                    transition: settings.store.disableAnimations ? "none" : "transform 0.2s ease",
                                    color: Col.section
                                }}
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <polyline points="6 9 12 15 18 9" />
                            </svg>
                        </div>
                        <div
                            style={{
                                maxHeight: configExpanded ? "1200px" : "0px",
                                overflow: "hidden",
                                transition: settings.store.disableAnimations ? "none" : "max-height 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
                                opacity: configExpanded ? 1 : 0
                            }}
                        >
                            <div style={{ padding: "8px 12px 16px 12px", backgroundColor: "var(--background-secondary)", borderRadius: "8px", border: "1px solid var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.15))", display: "flex", flexDirection: "column", gap: "16px", marginBottom: "8px" }}>
                                    <FormSwitch
                                        value={settings.store.fakeMessages}
                                        onChange={v => { settings.store.fakeMessages = v; notify(); }}
                                        description="Post local fake messages as the spoofed target user instead of actually sending them."
                                        title="Fake outgoing messages"
                                    />
                                    <FormSwitch
                                        value={settings.store.sendRealToo}
                                        onChange={v => { settings.store.sendRealToo = v; notify(); }}
                                        description="Also transmit the real message to the server (visible to others) in addition to displaying the fake one."
                                        disabled={!settings.store.fakeMessages}
                                        title="Send real message too"
                                    />
                                    <FormSwitch
                                        value={settings.store.spoofBadges}
                                        onChange={v => { settings.store.spoofBadges = v; notify(); }}
                                        description="Replicate the target's badges onto your client-side profile."
                                        title="Spoof profile badges"
                                    />
                                    <FormSwitch
                                        value={settings.store.spoofActivities}
                                        onChange={v => { settings.store.spoofActivities = v; notify(); }}
                                        description="Replicate the target's connected accounts and game library (in cloned mode)."
                                        title="Spoof activities and connections"
                                    />
                                    <FormSwitch
                                        value={settings.store.disableAnimations}
                                        onChange={v => { settings.store.disableAnimations = v; notify(); }}
                                        description="Disable all layout transitions and sliding animations inside this settings panel."
                                        title="Disable animations"
                                    />
                                    <FormSwitch
                                        value={settings.store.patchInternalAccountSwitcher}
                                        onChange={v => { settings.store.patchInternalAccountSwitcher = v; notify(); }}
                                        description="Integrate spoofed profiles directly into Discord's account switcher menu."
                                        title="Account switcher integration"
                                    />
                                    <div className="vc-form-switch-container vc-form-switch-no-border" style={{ marginBottom: 0, paddingBottom: 0 }}>
                                        <div className="vc-form-switch">
                                            <div className="vc-form-switch-text">
                                                <Flex flexDirection="column" gap="4px">
                                                    <Span size="md" weight="medium" color="text-strong">Spoofed Status</Span>
                                                    <Span size="sm" color="text-subtle">Override your client-side presence status globally.</Span>
                                                </Flex>
                                            </div>
                                            <div className="vc-form-switch-control" style={{ width: "180px", flexShrink: 0 }}>
                                                <Select
                                                    options={[
                                                        { label: "None (Use Real/Target)", value: "none" },
                                                        { label: "Online", value: "online" },
                                                        { label: "Idle", value: "idle" },
                                                        { label: "Do Not Disturb", value: "dnd" },
                                                        { label: "Invisible", value: "offline" }
                                                    ]}
                                                    select={v => { settings.store.spoofedStatus = v; notify(); forceUpdate(); }}
                                                    isSelected={v => v === settings.store.spoofedStatus}
                                                    serialize={v => v}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                    <div className="vc-form-switch-container vc-form-switch-no-border" style={{ marginBottom: 0, paddingBottom: 0 }}>
                                        <div className="vc-form-switch">
                                            <div className="vc-form-switch-text">
                                                <Flex flexDirection="column" gap="4px">
                                                    <Span size="md" weight="medium" color="text-strong">UI Mode</Span>
                                                    <Span size="sm" color="text-subtle">Choose between the modern settings UI or the legacy visual spoofing modal.</Span>
                                                </Flex>
                                            </div>
                                            <div className="vc-form-switch-control" style={{ width: "140px", flexShrink: 0 }}>
                                                <Select
                                                    options={[
                                                        { label: "Legacy", value: "legacy" },
                                                        { label: "Modern", value: "modern" }
                                                    ]}
                                                    select={v => { settings.store.uiMode = v; notify(); }}
                                                    isSelected={v => v === settings.store.uiMode}
                                                    serialize={v => v}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                </div>
                </div>
            </ModalContent>

            {/* @ts-ignore */}
            <ModalFooter style={{ padding: "16px 20px" }}>
                <Button color={Button.Colors.PRIMARY} onClick={() => modalProps.onClose()}>Close</Button>
            </ModalFooter>
        </ModalRoot>
    );
}
