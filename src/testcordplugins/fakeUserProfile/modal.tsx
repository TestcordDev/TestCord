/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { Flex } from "@components/Flex";
import { FormSwitch } from "@components/FormSwitch";
import { Margins } from "@utils/margins";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalProps, ModalRoot, ModalSize } from "@utils/modal";
import { Button, Forms, IconUtils, React, showToast, Text, Toasts, useEffect, useState } from "@webpack/common";

import { clearTarget, getCachedTarget, getManualProfile, loadTarget, logger, saveManualProfile, setEnabled, settings } from "./data";

const DECORATIONS_API = "https://fakeprofile.sampath.me/decorations";
const EFFECTS_API = "https://fakeprofile.sampath.me/profile-effects";
const NAMEPLATES_API = "https://fakeprofile.sampath.me/nameplates";

interface NameplatePreset { name: string; src: string; asset: string | null; }

function extractNameplateAsset(src: string): string | null {
    const shop = /collectibles-shop\/(\d+)\//.exec(src);
    if (shop) return shop[1];
    const asset = /assets\/collectibles\/nameplates\/(.+?)\/static/.exec(src);
    if (asset) return asset[1];
    return null;
}

let DecorationGridItem: React.ComponentType<any> | null = null;
let DecorationGridDecoration: React.ComponentType<any> | null = null;
let AvatarDecorationModalPreview: React.ComponentType<any> | null = null;

export function setCapturedComponents(components: {
    DecorationGridItem: React.ComponentType<any> | null;
    DecorationGridDecoration: React.ComponentType<any> | null;
    AvatarDecorationModalPreview: React.ComponentType<any> | null;
}) {
    DecorationGridItem = components.DecorationGridItem;
    DecorationGridDecoration = components.DecorationGridDecoration;
    AvatarDecorationModalPreview = components.AvatarDecorationModalPreview;
}

const ID_RE = /^\d{17,20}$/;

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

function SectionLabel({ children }: { children: React.ReactNode; }) {
    return <div className="fup-section-label">{children}</div>;
}

function Collapsible({ label, count, open, onToggle, children }: { label: string; count?: number; open: boolean; onToggle: () => void; children: React.ReactNode; }) {
    return (
        <div className="fup-field">
            <button type="button" className="fup-collapse-header" onClick={onToggle} aria-expanded={open}>
                <span className="fup-collapse-title">
                    {label}{count != null ? ` (${count})` : ""}
                </span>
                <svg className="fup-collapse-chevron" style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
            </button>
            {open && <div className="fup-collapse-body">{children}</div>}
        </div>
    );
}

function Field({ label, value, placeholder, onChange, type = "text" }: {
    label: string; value: string; placeholder?: string; onChange: (v: string) => void; type?: string;
}) {
    return (
        <div className="fup-field">
            <SectionLabel>{label}</SectionLabel>
            <input className="fup-input" type={type} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
        </div>
    );
}

function ColorPicker({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void; }) {
    const hex = value ? "#" + value : "";
    return (
        <div className="fup-field">
            <SectionLabel>{label}</SectionLabel>
            <div className="fup-color-row">
                <input
                    type="color"
                    className="fup-color-swatch"
                    value={hex || "#5865f2"}
                    onChange={e => {
                        const n = parseInt(e.target.value.replace("#", ""), 16);
                        if (!isNaN(n)) onChange(String(n));
                    }}
                />
                <input
                    className="fup-input fup-color-input"
                    placeholder="#5865f2 (decimal)"
                    value={value}
                    onChange={e => onChange(e.target.value)}
                />
                {value && (
                    <button className="fup-clear-btn" onClick={() => onChange("")} title="Clear">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                    </button>
                )}
            </div>
        </div>
    );
}

function ImageUpload({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void; }) {
    const fileRef = React.useRef<HTMLInputElement>(null);
    function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => { if (ev.target?.result) onChange(ev.target.result as string); };
        reader.readAsDataURL(file);
    }
    return (
        <div className="fup-field">
            <SectionLabel>{label}</SectionLabel>
            <div className="fup-image-row">
                <input className="fup-input fup-url-input" placeholder="Image URL or upload..." value={value.startsWith("data:") ? "" : value} onChange={e => onChange(e.target.value)} />
                <button className="fup-file-btn" onClick={() => fileRef.current?.click()} title="Choose a file">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2Z" /></svg>
                </button>
                <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFile} />
                {value && <>
                    <img src={value} alt="" className="fup-preview-avatar" />
                    <button className="fup-clear-btn" onClick={() => onChange("")} title="Delete">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                    </button>
                </>}
            </div>
        </div>
    );
}

function BadgeBtn({ label, icon, active, onClick }: { label: string; icon?: string; active: boolean; onClick: () => void; }) {
    return (
        <button onClick={onClick} className={`fup-badge ${active ? "fup-badge--on" : ""}`}
            style={{ display: "flex", alignItems: "center", gap: 5 }}>
            {icon && <img src={icon} alt="" style={{ width: 16, height: 16, objectFit: "contain", flexShrink: 0 }} />}
            <span>{label}</span>
        </button>
    );
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

interface DecorationPreset {
    asset: string;
    skuId: string;
    animated: boolean;
    name?: string;
}

interface ProfileEffectPreset {
    id: string;
    skuId: string;
    config: {
        title: string;
        description: string;
        thumbnailPreviewSrc: string;
        animationType: number;
        type: number;
        effects: Array<{
            src: string;
            loop: boolean;
            height: number;
            width: number;
            duration: number;
            start: number;
            loopDelay: number;
            position: { x: number; y: number; };
            zIndex: number;
        }>;
    };
}

const NAMEPLATE_PALETTES = ["cobalt", "crimson", "green", "orange", "pink", "red", "sky", "violet", "yellow"];

export function FakeUserProfileModal({ modalProps }: { modalProps: ModalProps; }) {
    const initial = getCachedTarget();
    const initialManual = getManualProfile();
    const [value, setValue] = useState(initial?.id ?? settings.store.targetId ?? "");
    const [busy, setBusy] = useState(false);
    const [enabled, setEnabledLocal] = useState(settings.store.spoofActive);
    const [fakeMessages, setFakeMessages] = useState(settings.store.fakeMessages);
    const [sendRealToo, setSendRealToo] = useState(settings.store.sendRealToo);
    const [spoofBadges, setSpoofBadges] = useState(settings.store.spoofBadges);
    const [spoofActivities, setSpoofActivities] = useState(settings.store.spoofActivities);
    const [target, setTarget] = useState(initial);
    const [mode, setMode] = useState(settings.store.targetMode ?? "lookup");
    const [decorations, setDecorations] = useState<DecorationPreset[]>([]);
    const [effects, setEffects] = useState<ProfileEffectPreset[]>([]);
    const [nameplates, setNameplates] = useState<NameplatePreset[]>([]);
    const [nameplatesLoaded, setNameplatesLoaded] = useState(false);
    const [decoOpen, setDecoOpen] = useState(false);
    const [effectOpen, setEffectOpen] = useState(false);
    const [nameplateOpen, setNameplateOpen] = useState(false);

    useEffect(() => {
        fetch(DECORATIONS_API)
            .then(r => r.json())
            .then((data: any) => {
                let items: any[] = [];
                if (Array.isArray(data)) {
                    items = data;
                } else if (data && typeof data === "object") {
                    items = Object.values(data);
                }
                if (!items.length) logger.warn("Decorations API returned no usable data", data);
                setDecorations(items as DecorationPreset[]);
            })
            .catch(e => logger.error("Failed to fetch decorations", e));
        fetch(EFFECTS_API)
            .then(r => r.json())
            .then((data: any) => {
                let items: any[] = [];
                if (Array.isArray(data)) {
                    items = data;
                } else if (data && typeof data === "object") {
                    items = Object.values(data);
                }
                if (!items.length) logger.warn("Effects API returned no usable data at fakeprofile.sampath.me/profile-effects", data);
                setEffects(items as ProfileEffectPreset[]);
            })
            .catch(e => logger.error("Failed to fetch effects", e));
    }, []);

    const [manualId, setManualId] = useState(initialManual.id);
    const [manualUsername, setManualUsername] = useState(initialManual.username);
    const [manualGlobalName, setManualGlobalName] = useState(initialManual.globalName);
    const [manualDiscriminator, setManualDiscriminator] = useState(initialManual.discriminator);
    const [manualBio, setManualBio] = useState(initialManual.bio);
    const [manualPronouns, setManualPronouns] = useState(initialManual.pronouns);
    const [manualAccentColor, setManualAccentColor] = useState(initialManual.accentColor);
    const [manualAccentColor2, setManualAccentColor2] = useState(initialManual.accentColor2);
    const [manualAvatarDataUrl, setManualAvatarDataUrl] = useState(initialManual.avatarDataUrl);
    const [manualBannerDataUrl, setManualBannerDataUrl] = useState(initialManual.bannerDataUrl);
    const [manualFlags, setManualFlags] = useState(initialManual.publicFlags);
    const [manualPremiumType, setManualPremiumType] = useState(String(initialManual.premiumType));
    const [manualBot, setManualBot] = useState(initialManual.bot);
    const [manualNitroLevel, setManualNitroLevel] = useState(initialManual.nitroLevel);
    const [manualBoostMonths, setManualBoostMonths] = useState(initialManual.boostMonths);
    const [manualAvatarDecoration, setManualAvatarDecoration] = useState(initialManual.avatarDecoration);
    const [manualCreatedAt, setManualCreatedAt] = useState(initialManual.createdAt);
    const [manualEmail, setManualEmail] = useState(initialManual.email);
    const [manualPhone, setManualPhone] = useState(initialManual.phone);
    const [manualCustomBadgeIds, setManualCustomBadgeIds] = useState<string[]>(initialManual.customBadgeIds ?? []);
    const [manualOldName, setManualOldName] = useState(initialManual.oldName);
    const [manualNitro, setManualNitro] = useState(initialManual.nitro);
    const [manualDecorationAsset, setManualDecorationAsset] = useState(initialManual.decorationAsset);
    const [manualNameplateAsset, setManualNameplateAsset] = useState(initialManual.nameplateAsset);
    const [manualNameplateSkuId, setManualNameplateSkuId] = useState(initialManual.nameplateSkuId);
    const [manualNameplatePalette, setManualNameplatePalette] = useState(initialManual.nameplatePalette);
    const [manualNameplateLabel, setManualNameplateLabel] = useState(initialManual.nameplateLabel);
    const [manualProfileEffectId, setManualProfileEffectId] = useState(initialManual.profileEffectId);
    const [manualProfileEffectAsset, setManualProfileEffectAsset] = useState(initialManual.profileEffectAsset);
    const [spoofNameplate, setSpoofNameplate] = useState(settings.store.spoofNameplate);
    const [spoofProfileEffect, setSpoofProfileEffect] = useState(settings.store.spoofProfileEffect);

    async function apply() {
        settings.store.targetMode = "lookup";
        const id = value.trim();
        if (!ID_RE.test(id)) {
            showToast("Enter a valid Discord user ID.", Toasts.Type.FAILURE);
            return;
        }
        setBusy(true);
        try {
            const next = await loadTarget(id);
            setTarget(next);
            setEnabled(true);
            setEnabledLocal(true);
            showToast(`Spoofing as ${next.user.username}.`, Toasts.Type.SUCCESS);
        } catch (e: any) {
            logger.error("apply failed", e);
            showToast(e?.message || "Failed to load that user.", Toasts.Type.FAILURE);
        } finally {
            setBusy(false);
        }
    }

    function applyManual() {
        const id = manualId.trim();
        const username = manualUsername.trim();

        const premiumType = Number(manualPremiumType);
        if (!Number.isInteger(premiumType) || premiumType < 0 || premiumType > 3) {
            showToast("Nitro type must be between 0 and 3.", Toasts.Type.FAILURE);
            return;
        }

        const manual = saveManualProfile({
            id,
            username,
            globalName: manualGlobalName.trim(),
            discriminator: manualDiscriminator.trim() || "0",
            bio: manualBio,
            pronouns: manualPronouns,
            accentColor: manualAccentColor.trim(),
            accentColor2: manualAccentColor2.trim(),
            avatarDataUrl: manualAvatarDataUrl,
            bannerDataUrl: manualBannerDataUrl,
            avatarHash: "manual-avatar",
            bannerHash: "manual-banner",
            publicFlags: manualFlags,
            premiumType,
            bot: manualBot,
            nitro: manualNitro,
            nitroLevel: manualNitroLevel,
            boostMonths: manualBoostMonths,
            avatarDecoration: manualAvatarDecoration,
            decorationAsset: manualDecorationAsset,
            nameplateAsset: manualNameplateAsset,
            nameplateSkuId: manualNameplateSkuId,
            nameplatePalette: manualNameplatePalette,
            nameplateLabel: manualNameplateLabel,
            profileEffectId: manualProfileEffectId,
            profileEffectAsset: manualProfileEffectAsset,
            createdAt: manualCreatedAt,
            email: manualEmail,
            phone: manualPhone,
            customBadgeIds: manualCustomBadgeIds,
            oldName: manualOldName,
            copiedUserId: "",
        });

        setTarget(manual);
        setEnabled(true);
        setEnabledLocal(true);
        showToast(`Spoofing as ${username}.`, Toasts.Type.SUCCESS);
    }

    function clear() {
        clearTarget();
        setTarget(null);
        setEnabledLocal(false);
        setValue("");
        showToast("Cleared spoof target.", Toasts.Type.MESSAGE);
    }

    function toggle(v: boolean) {
        if (v && !target) { showToast("Pick a target user first.", Toasts.Type.FAILURE); return; }
        setEnabled(v);
        setEnabledLocal(v);
    }

    async function uploadImage(kind: "avatar" | "banner") {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
                const dataUrl = await readImageAsDataUrl(file);
                if (kind === "avatar") setManualAvatarDataUrl(dataUrl);
                else setManualBannerDataUrl(dataUrl);
                showToast(`${kind === "avatar" ? "Avatar" : "Banner"} uploaded.`, Toasts.Type.SUCCESS);
            } catch (e) {
                logger.error("image upload failed", e);
                showToast("Failed to read the image.", Toasts.Type.FAILURE);
            }
        };
        input.click();
    }

    function toggleFlag(flag: number, v: boolean) {
        setManualFlags(current => v ? current | flag : current & ~flag);
    }

    function loadNameplates() {
        if (nameplatesLoaded) return;
        fetch(NAMEPLATES_API)
            .then(r => r.json())
            .then((data: any) => {
                const raw = Array.isArray(data) ? data : (data && typeof data === "object" ? Object.values(data) : []);
                const items = (raw as any[])
                    .filter((n: any) => n && typeof n.src === "string")
                    .map((n: any) => ({ name: n.name ?? "Nameplate", src: n.src as string, asset: extractNameplateAsset(n.src) }));
                setNameplates(items as NameplatePreset[]);
                setNameplatesLoaded(true);
            })
            .catch(e => logger.error("Failed to fetch nameplates", e));
    }

    return (
        <ModalRoot {...modalProps} size={ModalSize.LARGE}>
            <ModalHeader>
                <Text variant="heading-lg/semibold" style={{ flexGrow: 1 }}>Fake User Profile</Text>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>
            <ModalContent className="fup-content">
                <Forms.FormText className={Margins.bottom8}>
                    Pick a user by ID, or create a fully manual profile. Your client will visually treat you as them.
                </Forms.FormText>

                <SectionLabel>Mode</SectionLabel>
                <Flex style={{ gap: 8 }} className={Margins.bottom16}>
                    <Button
                        color={mode === "lookup" ? Button.Colors.PRIMARY : Button.Colors.TRANSPARENT}
                        onClick={() => { settings.store.targetMode = "lookup"; setMode("lookup"); }}
                    >
                        Lookup user
                    </Button>
                    <Button
                        color={mode === "manual" ? Button.Colors.PRIMARY : Button.Colors.TRANSPARENT}
                        onClick={() => { settings.store.targetMode = "manual"; setMode("manual"); }}
                    >
                        Manual profile
                    </Button>
                </Flex>

                {mode === "lookup" ? (
                    <>
                        <SectionLabel>Target user ID</SectionLabel>
                        <Flex style={{ alignItems: "center", gap: 8 }} className={Margins.bottom16}>
                            <div style={{ flexGrow: 1 }}>
                                <input className="fup-input" placeholder="123456789012345678" value={value} onChange={e => setValue(e.target.value)} autoFocus />
                            </div>
                            <Button onClick={apply} disabled={busy || !value.trim()}>
                                {busy ? "Loading..." : "Apply"}
                            </Button>
                        </Flex>
                    </>
                ) : (
                    <>
                        <SectionLabel>User ID</SectionLabel>
                        <input className="fup-input" value={manualId} onChange={e => setManualId(e.target.value)} placeholder="123456789012345678" />

                        <SectionLabel>Username</SectionLabel>
                        <input className="fup-input" value={manualUsername} onChange={e => setManualUsername(e.target.value)} placeholder="fakeuser" />

                        <SectionLabel>Display name</SectionLabel>
                        <input className="fup-input" value={manualGlobalName} onChange={e => setManualGlobalName(e.target.value)} placeholder="Fake User" />

                        <SectionLabel>Discriminator</SectionLabel>
                        <input className="fup-input" value={manualDiscriminator} onChange={e => setManualDiscriminator(e.target.value)} placeholder="0" />

                        <div className="fup-divider" />

                        <SectionLabel>Bio</SectionLabel>
                        <input className="fup-input" value={manualBio} onChange={e => setManualBio(e.target.value)} placeholder="Anything you want" />

                        <SectionLabel>Pronouns</SectionLabel>
                        <input className="fup-input" value={manualPronouns} onChange={e => setManualPronouns(e.target.value)} placeholder="they/them" />

                        <div className="fup-divider" />

                        <ColorPicker label="Accent color" value={manualAccentColor} onChange={setManualAccentColor} />
                        <ColorPicker label="Accent color 2 (gradient)" value={manualAccentColor2} onChange={setManualAccentColor2} />

                        <div className="fup-divider" />

                        <SectionLabel>Badges</SectionLabel>
                        <div className="fup-badges" style={{ marginBottom: 14 }}>
                            {[
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
                            ].map(b => (
                                <BadgeBtn key={b.flag} label={b.label} icon={b.icon} active={!!(manualFlags & b.flag)} onClick={() => setManualFlags(v => v ^ b.flag)} />
                            ))}
                        </div>

                        <SectionLabel>Nitro badge tier</SectionLabel>
                        <div className="fup-badges" style={{ marginBottom: 14 }}>
                            {NITRO_LEVELS.map((n, i) => (
                                <BadgeBtn key={i} label={n.label} icon={n.icon || undefined} active={manualNitroLevel === (i - 1)} onClick={() => {
                                    const level = i - 1;
                                    setManualNitroLevel(level);
                                    if (level >= 0) {
                                        setManualPremiumType("2");
                                        setManualNitro(true);
                                    } else {
                                        setManualPremiumType("0");
                                        setManualNitro(false);
                                    }
                                }} />
                            ))}
                        </div>

                        <SectionLabel>Boost badge tier</SectionLabel>
                        <div className="fup-badges" style={{ marginBottom: 14 }}>
                            {BOOST_LEVELS.map((b, i) => (
                                <BadgeBtn key={i} label={b.label} icon={b.icon || undefined} active={manualBoostMonths === (i - 1)} onClick={() => setManualBoostMonths(i - 1)} />
                            ))}
                        </div>

                        <div className="fup-divider" />

                        <SectionLabel>Profile picture</SectionLabel>
                        <ImageUpload label="" value={manualAvatarDataUrl} onChange={setManualAvatarDataUrl} />

                        <SectionLabel>Banner</SectionLabel>
                        <ImageUpload label="" value={manualBannerDataUrl} onChange={setManualBannerDataUrl} />

                        <div className="fup-divider" />

                        <Collapsible label="Avatar decoration" count={decorations.length} open={decoOpen} onToggle={() => setDecoOpen(!decoOpen)}>
                            <div className="fup-decoration-grid">
                                <div
                                    className={`fup-decoration-item ${!manualAvatarDecoration ? "fup-decoration-item--selected" : ""}`}
                                    onClick={() => { setManualAvatarDecoration(""); setManualDecorationAsset(""); }}
                                >
                                    <div className="fup-decoration-preview">
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <circle cx="12" cy="12" r="10" />
                                            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                                        </svg>
                                    </div>
                                    <span className="fup-decoration-label">None</span>
                                </div>
                                {decorations.map(d => (
                                    <div
                                        key={d.asset}
                                        className={`fup-decoration-item ${manualAvatarDecoration === d.asset ? "fup-decoration-item--selected" : ""}`}
                                        onClick={() => {
                                            const newval = manualAvatarDecoration === d.asset ? "" : d.asset;
                                            setManualAvatarDecoration(newval);
                                            setManualDecorationAsset(newval);
                                        }}
                                    >
                                        <div className="fup-decoration-preview">
                                            <img
                                                src={`https://cdn.discordapp.com/avatar-decoration-presets/${d.asset}.png`}
                                                alt={d.name || d.asset}
                                                className="fup-decoration-img"
                                                onError={e => {
                                                    (e.target as HTMLImageElement).style.display = "none";
                                                }}
                                            />
                                        </div>
                                        <span className="fup-decoration-label">{d.name || d.asset.slice(0, 8)}</span>
                                    </div>
                                ))}
                            </div>
                            <Field label="Custom decoration asset ID" value={manualDecorationAsset} placeholder="1144307957425778779" onChange={v => { setManualDecorationAsset(v); setManualAvatarDecoration(v); }} />
                        </Collapsible>

                        <div className="fup-divider" />

                        <Collapsible label="Nameplate" count={nameplatesLoaded ? nameplates.length : undefined} open={nameplateOpen} onToggle={() => setNameplateOpen(!nameplateOpen)}>
                            {!nameplatesLoaded ? (
                                <button className="fup-btn fup-btn-primary" style={{ width: "100%", justifyContent: "center", marginBottom: 10 }} onClick={loadNameplates}>Load nameplates</button>
                            ) : (
                                <div className="fup-decoration-grid">
                                    <div
                                        className={`fup-decoration-item ${!manualNameplateAsset ? "fup-decoration-item--selected" : ""}`}
                                        onClick={() => { setManualNameplateAsset(""); setManualNameplateSkuId(""); }}
                                    >
                                        <div className="fup-decoration-preview">
                                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <circle cx="12" cy="12" r="10" />
                                                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                                            </svg>
                                        </div>
                                        <span className="fup-decoration-label">None</span>
                                    </div>
                                    {nameplates.filter(n => n.asset).map(n => (
                                        <div
                                            key={n.src}
                                            className={`fup-decoration-item ${manualNameplateAsset === n.asset ? "fup-decoration-item--selected" : ""}`}
                                            onClick={() => {
                                                const newval = manualNameplateAsset === n.asset ? "" : n.asset!;
                                                setManualNameplateAsset(newval);
                                                setManualNameplateSkuId(newval);
                                            }}
                                        >
                                            <div className="fup-decoration-preview" style={{ height: 40, borderRadius: 6 }}>
                                                <img
                                                    src={n.src}
                                                    alt={n.name}
                                                    className="fup-decoration-img"
                                                    style={{ objectFit: "cover" }}
                                                    onError={e => {
                                                        (e.target as HTMLImageElement).style.display = "none";
                                                    }}
                                                />
                                            </div>
                                            <span className="fup-decoration-label">{n.name}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                            <Field label="Nameplate asset ID" value={manualNameplateAsset} placeholder="e.g. a_abc123" onChange={setManualNameplateAsset} />
                            <Field label="SKU ID" value={manualNameplateSkuId} placeholder="Same as asset ID if unsure" onChange={setManualNameplateSkuId} />
                            <div className="fup-field">
                                <SectionLabel>Palette</SectionLabel>
                                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                    <button
                                        className={`fup-badge ${!manualNameplatePalette ? "fup-badge--on" : ""}`}
                                        onClick={() => setManualNameplatePalette("")}
                                    >None</button>
                                    {NAMEPLATE_PALETTES.map(p => (
                                        <button
                                            key={p}
                                            className={`fup-badge ${manualNameplatePalette === p ? "fup-badge--on" : ""}`}
                                            onClick={() => setManualNameplatePalette(p)}
                                        >{p}</button>
                                    ))}
                                </div>
                            </div>
                            <Field label="Label (optional)" value={manualNameplateLabel} placeholder="Display name" onChange={setManualNameplateLabel} />
                        </Collapsible>

                        <div className="fup-divider" />

                        <Collapsible label="Profile effect" count={effects.length} open={effectOpen} onToggle={() => setEffectOpen(!effectOpen)}>
                            <div className="fup-effect-grid">
                                <div
                                    className={`fup-effect-item ${!manualProfileEffectId ? "fup-effect-item--selected" : ""}`}
                                    onClick={() => { setManualProfileEffectId(""); setManualProfileEffectAsset(""); }}
                                >
                                    <div className="fup-effect-preview">
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <circle cx="12" cy="12" r="10" />
                                            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                                        </svg>
                                    </div>
                                    <span className="fup-effect-label">None</span>
                                </div>
                                {effects.map(e => (
                                    <div
                                        key={e.skuId}
                                        className={`fup-effect-item ${manualProfileEffectId === e.skuId ? "fup-effect-item--selected" : ""}`}
                                        onClick={() => {
                                            const newval = manualProfileEffectId === e.skuId ? "" : e.skuId;
                                            setManualProfileEffectId(newval);
                                            setManualProfileEffectAsset(newval);
                                        }}
                                    >
                                        <div className="fup-effect-preview">
                                            <img
                                                src={e.config.thumbnailPreviewSrc}
                                                alt={e.config.title || e.skuId}
                                                className="fup-effect-img"
                                                onError={ev => {
                                                    (ev.target as HTMLImageElement).style.display = "none";
                                                }}
                                            />
                                        </div>
                                        <span className="fup-effect-label">{e.config.title || e.skuId.slice(0, 8)}</span>
                                    </div>
                                ))}
                            </div>
                            <Field label="Custom effect SKU ID" value={manualProfileEffectAsset} placeholder="e.g. 1234567890" onChange={v => { setManualProfileEffectAsset(v); setManualProfileEffectId(v); }} />
                        </Collapsible>

                        <SectionLabel>Custom badges</SectionLabel>
                        <div className="fup-badges" style={{ marginBottom: 14 }}>
                            {[
                                { id: "quest", label: "Completed a quest", icon: "https://cdn.discordapp.com/badge-icons/7d9ae358c8c5e118768335dbe68b4fb8.png" },
                                { id: "orbs", label: "Orbs — Apprentice", icon: "https://cdn.discordapp.com/badge-icons/83d8a1eb09a8d64e59233eec5d4d5c2d.png" },
                                { id: "oldname", label: "Old username", icon: "https://cdn.discordapp.com/badge-icons/6de6d34650760ba5551a79732e98ed60.png" },
                            ].map(b => (
                                <BadgeBtn key={b.id} label={b.label} icon={b.icon} active={manualCustomBadgeIds.includes(b.id)} onClick={() => setManualCustomBadgeIds(
                                    manualCustomBadgeIds.includes(b.id) ? manualCustomBadgeIds.filter(x => x !== b.id) : [...manualCustomBadgeIds, b.id]
                                )} />
                            ))}
                        </div>
                        {manualCustomBadgeIds.includes("oldname") && (
                            <Field label="Old username" value={manualOldName} placeholder="OldUser#0000" onChange={setManualOldName} />
                        )}

                        <div className="fup-divider" />

                        <Field label="Creation date" value={manualCreatedAt} placeholder="2010-06-29" type="date" onChange={setManualCreatedAt} />

                        <SectionLabel>Bot</SectionLabel>
                        <FormSwitch value={manualBot} onChange={setManualBot} description="Show the profile as a bot user." title="Bot" />

                        <div className="fup-divider" />

                        <SectionLabel>Badge flags (bitfield)</SectionLabel>
                        <input className="fup-input" type="number" value={String(manualFlags)} onChange={e => setManualFlags(Number(e.target.value) || 0)} placeholder="0" />

                        <SectionLabel>Nitro type (0-3)</SectionLabel>
                        <input className="fup-input" type="number" value={manualPremiumType} onChange={e => setManualPremiumType(e.target.value)} placeholder="0" min="0" max="3" />

                        <Field label="Email (local display only)" value={manualEmail} placeholder="user@example.com" onChange={setManualEmail} />
                        <Field label="Phone (local display only)" value={manualPhone} placeholder="+1 234 567 890" onChange={setManualPhone} />

                        <button className="fup-btn fup-btn-primary" style={{ marginTop: 8, width: "100%", justifyContent: "center" }} onClick={applyManual}>Apply manual profile</button>
                    </>
                )}

                {target && (
                    <Flex style={{ alignItems: "center", gap: 12 }} className={Margins.bottom16}>
                        <img
                            src={mode === "manual" && manualAvatarDataUrl ? manualAvatarDataUrl : IconUtils.getUserAvatarURL(target.user, true, 64)}
                            alt="" width={48} height={48} style={{ borderRadius: "50%" }}
                        />
                        <div>
                            <Text variant="text-md/semibold">{target.user.globalName ?? target.user.username}</Text>
                            <Text variant="text-sm/normal" style={{ opacity: 0.7 }}>@{target.user.username} · {target.id}</Text>
                        </div>
                    </Flex>
                )}

                <div className="fup-divider" />

                <FormSwitch value={enabled} onChange={toggle} description="Enable the visual spoof. The user area button toggles the same setting." title="Spoof active" />
                <FormSwitch value={fakeMessages} onChange={v => { settings.store.fakeMessages = v; setFakeMessages(v); }} description="When you send a message, post a local fake one as the target instead of really sending it." title="Fake outgoing messages" />
                <FormSwitch value={sendRealToo} onChange={v => { settings.store.sendRealToo = v; setSendRealToo(v); }} description="Also send the real message in addition to the local fake." disabled={!fakeMessages} title="Send real message too" />
                <FormSwitch value={spoofBadges} onChange={v => { settings.store.spoofBadges = v; setSpoofBadges(v); }} description="Mirror the target's badges onto your client-side profile." title="Spoof badges" />
                <FormSwitch value={spoofActivities} onChange={v => { settings.store.spoofActivities = v; setSpoofActivities(v); }} description="Mirror the target's connected accounts and game collection." title="Spoof activities and connections" />
                <FormSwitch value={spoofNameplate} onChange={v => { settings.store.spoofNameplate = v; setSpoofNameplate(v); }} description="Mirror the chosen nameplate onto your client-side profile." title="Spoof nameplate" />
                <FormSwitch value={spoofProfileEffect} onChange={v => { settings.store.spoofProfileEffect = v; setSpoofProfileEffect(v); }} description="Mirror the chosen profile effect onto your client-side profile." hideBorder title="Spoof profile effect" />
            </ModalContent>
            <ModalFooter className="fup-footer">
                <button className="fup-btn fup-btn-danger" onClick={clear} disabled={!target}>Clear</button>
                <button className="fup-btn fup-btn-ghost" onClick={modalProps.onClose}>Close</button>
            </ModalFooter>
        </ModalRoot>
    );
}
