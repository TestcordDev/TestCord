/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * Pinterest Tool modifications Copyright (c) 2026 szaleniec1327
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { copyWithToast, openImageModal } from "@utils/discord";
import { ModalCloseButton, ModalContent, ModalHeader, ModalProps, ModalRoot, ModalSize } from "@utils/modal";
import { Logger } from "@utils/Logger";
import { classes } from "@utils/misc";
import { saveFile } from "@utils/web";
import { findByPropsLazy, findComponentByCodeLazy } from "@webpack";
import { ExpressionPickerStore, FluxDispatcher, showToast, Toasts, useEffect, useMemo, useRef, useState } from "@webpack/common";

// @webpack/common's "ReactDOM" export is not guaranteed to exist across
// Vencord/Equicord/Testcord versions (it was removed in some recent builds
// in favor of individual named exports like createRoot). Looking up the
// react-dom module directly by its own exported props is more resilient
// than depending on @webpack/common re-exporting it as "ReactDOM".
const ReactDOMPortal = findByPropsLazy("createPortal");
import { Dispatch, PointerEvent as ReactPointerEvent, ReactNode, SetStateAction } from "react";

import { cl, getPinterestThemeStyle, ManaSearchBarProps, Native, NativeMediaResult, PINTEREST_THEMES, PinterestImageResult, PinterestPickerProps, PinterestSearchPayload, PinterestTheme, SearchBucketState, SearchKind, SearchTarget, settings } from "./shared";

const ManaSearchBar = findComponentByCodeLazy<ManaSearchBarProps>("MagnifyingGlassIcon", "clearable");
const logger = new Logger("PinterestTool");

// Fixed page sizes keep the profile picker layout predictable across installs.
const AVATAR_RESULTS_PER_PAGE = 8;
const BANNER_RESULTS_PER_PAGE = 4;
const IMAGE_RESULTS_PER_PAGE = 8;

function createEmptyBucket(): SearchBucketState {
    return {
        data: null,
        activeQuery: "",
        bookmark: null,
        page: 0,
        loadingNextPage: false,
        error: ""
    };
}

type SearchMediaMode = "IMAGES" | "GIFS";
type SearchBuckets = Record<SearchKind, SearchBucketState>;

function createEmptyBuckets(): SearchBuckets {
    return {
        IMAGE: createEmptyBucket(),
        AVATAR: createEmptyBucket(),
        BANNER: createEmptyBucket()
    };
}

function getSearchKinds(target: SearchTarget): SearchKind[] {
    return target === "ALL" ? ["AVATAR", "BANNER"] : [target];
}

function getPrimaryKind(target: SearchTarget): SearchKind {
    if (target === "ALL") return "AVATAR";
    return target;
}

function targetLabel(target: SearchKind) {
    if (target === "IMAGE") return "image";
    return target === "AVATAR" ? "avatar" : "banner";
}

function getResultLabel(result: PinterestImageResult) {
    if (result.title.trim()) return result.title;

    try {
        const { pathname } = new URL(result.url);
        const filename = pathname.split("/").pop()?.trim();
        if (!filename) return "Pinterest image";
        return decodeURIComponent(filename);
    } catch {
        return "Pinterest image";
    }
}


function mergeUniqueResults(
    current: PinterestImageResult[],
    incoming: PinterestImageResult[]
): PinterestImageResult[] {
    const seenIds = new Set(current.map(result => result.id));
    const seenUrls = new Set(current.map(result => result.url));
    const merged = [...current];

    for (const result of incoming) {
        if (seenIds.has(result.id) || seenUrls.has(result.url)) continue;
        seenIds.add(result.id);
        seenUrls.add(result.url);
        merged.push(result);
    }

    return merged;
}

interface PendingImageAsset {
    assetOrigin: "NEW_ASSET";
    imageUri: string;
    description: string;
}

interface PendingProfileActionPayload {
    pendingAvatar?: PendingImageAsset;
    pendingBanner?: PendingImageAsset;
}

function setPendingProfileChanges(payload: PendingProfileActionPayload, guildId?: string) {
    FluxDispatcher.dispatch({
        type: "USER_PROFILE_SETTINGS_SET_PENDING_CHANGES",
        ...(guildId ? { guildId } : {}),
        ...payload
    });
}

function getPendingImageAsset(image: string, description: string): PendingImageAsset {
    return {
        assetOrigin: "NEW_ASSET",
        imageUri: image,
        description
    };
}

function applyImageData(image: string, target: SearchKind, filename: string, guildId?: string) {
    // Discord's own profile settings store expects pendingBanner in the same
    // "new asset" descriptor shape it uses for pendingAvatar (assetOrigin +
    // imageUri + description), not a bare data URL string. Sending a raw
    // string previously meant the store had nothing to read a preview from,
    // so the banner appeared black and never actually applied.
    const asset = getPendingImageAsset(image, `pinterest-${filename || "image"}`);

    const payload: PendingProfileActionPayload = target === "BANNER"
        ? { pendingBanner: asset }
        : { pendingAvatar: asset };

    setPendingProfileChanges(payload, guildId);
}

async function cropStaticBanner(dataUrl: string): Promise<string> {
    return await new Promise((resolve, reject) => {
        const image = new Image();

        image.onload = () => {
            try {
                const width = 1200;
                const height = 480;
                const canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;

                const context = canvas.getContext("2d");
                if (!context) throw new Error("Could not create banner canvas.");

                const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
                const drawWidth = image.naturalWidth * scale;
                const drawHeight = image.naturalHeight * scale;
                const x = (width - drawWidth) / 2;
                const y = (height - drawHeight) / 2;

                context.drawImage(image, x, y, drawWidth, drawHeight);
                resolve(canvas.toDataURL("image/png"));
            } catch (error) {
                reject(error);
            }
        };

        image.onerror = () => reject(new Error("Could not prepare the Pinterest banner."));
        image.src = dataUrl;
    });
}

async function fetchProfileFile(result: PinterestImageResult): Promise<File> {
    const media = await Native.fetchMedia(result.url) as NativeMediaResult;
    return new File([media.data], media.filename, { type: media.type });
}

async function applyProfileResult(result: PinterestImageResult, target: SearchKind, guildId?: string): Promise<boolean> {
    try {
        const media = await Native.fetchMedia(result.url) as NativeMediaResult;

        // Do not redraw profile banners through canvas here. Some Pinterest media
        // formats/color profiles can turn into a black frame when re-encoded in
        // Discord's renderer. The native Discord editor already handles crop/zoom,
        // and the direct fallback should preserve the original fetched image data.
        applyImageData(media.dataUrl, target, media.filename, guildId);
        return true;
    } catch (error) {
        logger.error("Failed to apply Pinterest result", error);
        copyWithToast(result.url, "Media URL copied to clipboard.");
        showToast("Could not apply that media. The URL was copied instead.", Toasts.Type.FAILURE);
        return false;
    }
}

async function saveResult(result: PinterestImageResult) {
    try {
        const media = await Native.fetchMedia(result.url) as NativeMediaResult;
        saveFile(new File([media.data], media.filename, { type: media.type }));
    } catch (error) {
        logger.error("Failed to save Pinterest result", error);
        showToast("Could not save that media.", Toasts.Type.FAILURE);
    }
}


const FAVORITES_STORAGE_KEYS: Record<Extract<SearchKind, "AVATAR" | "BANNER">, string> = {
    AVATAR: "PinterestTool_favorites_avatar_v2",
    BANNER: "PinterestTool_favorites_banner_v2"
};

interface PinterestFavorite extends PinterestImageResult {
    target: SearchKind;
    savedAt: number;
}

function sanitizeFavorites(
    rawValue: unknown,
    target: Extract<SearchKind, "AVATAR" | "BANNER">
): PinterestFavorite[] {
    if (!Array.isArray(rawValue)) return [];

    return rawValue
        .filter(item =>
            item
            && typeof item.id === "string"
            && typeof item.url === "string"
        )
        .map(item => ({
            ...(item as PinterestImageResult),
            target,
            savedAt: typeof (item as PinterestFavorite).savedAt === "number"
                ? (item as PinterestFavorite).savedAt
                : Date.now()
        }));
}

async function readFavoritesForTarget(
    target: Extract<SearchKind, "AVATAR" | "BANNER">
): Promise<PinterestFavorite[]> {
    try {
        const stored = await DataStore.get(FAVORITES_STORAGE_KEYS[target]);
        return sanitizeFavorites(stored, target);
    } catch (error) {
        logger.error(`Could not load Pinterest ${target.toLowerCase()} favorites`, error);
        return [];
    }
}

async function readFavorites(): Promise<PinterestFavorite[]> {
    const [avatars, banners] = await Promise.all([
        readFavoritesForTarget("AVATAR"),
        readFavoritesForTarget("BANNER")
    ]);

    return [...avatars, ...banners].sort((a, b) => b.savedAt - a.savedAt);
}

async function writeFavoritesForTarget(
    target: Extract<SearchKind, "AVATAR" | "BANNER">,
    favorites: PinterestFavorite[]
) {
    try {
        await DataStore.set(
            FAVORITES_STORAGE_KEYS[target],
            favorites.map(item => ({ ...item, target }))
        );
    } catch (error) {
        logger.error(`Could not save Pinterest ${target.toLowerCase()} favorites`, error);
        showToast("Could not save Pinterest favorites.", Toasts.Type.FAILURE);
    }
}

function favoriteKey(result: PinterestImageResult, target: SearchKind) {
    return `${target}:${result.id}`;
}

// These were referenced in the pagination buttons below but never defined
// anywhere in this file, causing "ChevronLeftIcon is not defined" as soon as
// the avatar/banner picker rendered pagination controls.
function ChevronLeftIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function ChevronRightIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function HeartIcon({ filled = false }: { filled?: boolean; }) {
    return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} aria-hidden="true">
            <path
                d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function PillButton({
    children,
    compact = false,
    onClick,
    disabled = false,
    type = "button"
}: {
    children: ReactNode;
    compact?: boolean;
    onClick?(): void;
    disabled?: boolean;
    type?: "button" | "submit";
}) {
    return (
        <button
            type={type}
            className={classes(cl("button"), compact && cl("button-compact"))}
            onClick={onClick}
            disabled={disabled}
        >
            {children}
        </button>
    );
}

function SelectionDropdown({
    target,
    open,
    onToggle,
    onSelect
}: {
    target: SearchTarget;
    open: boolean;
    onToggle(): void;
    onSelect(target: SearchTarget): void;
}) {
    const options: SearchTarget[] = ["ALL", "AVATAR", "BANNER"];

    return (
        <div className={cl("selection-wrap")}>
            <button type="button" className={cl("selection-button")} onClick={onToggle}>
                <span>{target === "ALL" ? "All" : target === "AVATAR" ? "Avatar" : "Banner"}</span>
                <span className={cl("selection-caret")}>⌄</span>
            </button>
            {open ? (
                <div className={cl("selection-menu")}>
                    {options.map(option => (
                        <button
                            key={option}
                            type="button"
                            className={classes(cl("selection-item"), option === target && cl("selection-item-active"))}
                            onClick={() => onSelect(option)}
                        >
                            {option === "ALL" ? "All" : option === "AVATAR" ? "Avatar" : "Banner"}
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}


function PinterestLogo({ size = 18 }: { size?: number; }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
        >
            <path d="M12 0C5.4 0 0 5.4 0 12c0 5.1 3.2 9.4 7.6 11.1-.1-.9-.2-2.3 0-3.3.2-.9 1.3-5.6 1.3-5.6s-.3-.7-.3-1.6c0-1.5.9-2.7 2-2.7.9 0 1.4.7 1.4 1.6 0 1-.6 2.4-1 3.7-.3 1.1.5 2 1.6 2 1.9 0 3.4-2 3.4-5 0-2.6-1.9-4.5-4.6-4.5-3.1 0-5 2.3-5 4.8 0 .9.3 1.8.8 2.4.1.1.1.2 0 .3l-.3 1.2c-.1.2-.2.3-.4.2-1.5-.7-2.4-2.8-2.4-4.6 0-3.7 2.7-7.2 7.8-7.2 4.1 0 7.3 2.9 7.3 6.8 0 4.1-2.6 7.3-6.1 7.3-1.2 0-2.3-.6-2.7-1.4l-.7 2.8c-.3 1-1 2.3-1.4 3.1.1 0 .2.1.3.1 1.1.4 2.2.6 3.4.6 6.6 0 12-5.4 12-12S18.6 0 12 0z" />
        </svg>
    );
}

function clamp(value: number, min = 0, max = 1) {
    return Math.min(max, Math.max(min, value));
}

function parseHexColor(hex: string) {
    const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    const normalized = match ? match[1] : "f59e0b";

    return {
        r: parseInt(normalized.slice(0, 2), 16),
        g: parseInt(normalized.slice(2, 4), 16),
        b: parseInt(normalized.slice(4, 6), 16)
    };
}

function rgbToHex(r: number, g: number, b: number) {
    const channel = (value: number) => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, "0");
    return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function rgbToHsv(r: number, g: number, b: number) {
    r /= 255;
    g /= 255;
    b /= 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;

    let h = 0;
    if (delta !== 0) {
        if (max === r) h = ((g - b) / delta) % 6;
        else if (max === g) h = (b - r) / delta + 2;
        else h = (r - g) / delta + 4;
        h *= 60;
        if (h < 0) h += 360;
    }

    return {
        h,
        s: max === 0 ? 0 : delta / max,
        v: max
    };
}

function hsvToHex(h: number, s: number, v: number) {
    const chroma = v * s;
    const x = chroma * (1 - Math.abs((h / 60) % 2 - 1));
    const m = v - chroma;

    let r = 0;
    let g = 0;
    let b = 0;

    if (h < 60) [r, g, b] = [chroma, x, 0];
    else if (h < 120) [r, g, b] = [x, chroma, 0];
    else if (h < 180) [r, g, b] = [0, chroma, x];
    else if (h < 240) [r, g, b] = [0, x, chroma];
    else if (h < 300) [r, g, b] = [x, 0, chroma];
    else [r, g, b] = [chroma, 0, x];

    return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

function ThemePicker({
    theme,
    customAccent
}: {
    theme: PinterestTheme;
    customAccent: string;
}) {
    const pickerRef = useRef<HTMLDivElement>(null);
    const draggingSv = useRef(false);
    const initialHsv = useMemo(() => {
        const { r, g, b } = parseHexColor(customAccent);
        return rgbToHsv(r, g, b);
    }, [customAccent]);

    const [pickerOpen, setPickerOpen] = useState(false);
    const [hue, setHue] = useState(initialHsv.h);
    const [saturation, setSaturation] = useState(initialHsv.s);
    const [value, setValue] = useState(initialHsv.v);
    const [hexDraft, setHexDraft] = useState(customAccent.toUpperCase());

    useEffect(() => {
        const { r, g, b } = parseHexColor(customAccent);
        const hsv = rgbToHsv(r, g, b);
        setHue(hsv.h);
        setSaturation(hsv.s);
        setValue(hsv.v);
        setHexDraft(customAccent.toUpperCase());
    }, [customAccent]);

    useEffect(() => {
        if (!pickerOpen) return;

        function handleOutside(event: PointerEvent) {
            if (!pickerRef.current?.contains(event.target as Node)) setPickerOpen(false);
        }

        function handleEscape(event: KeyboardEvent) {
            if (event.key === "Escape") setPickerOpen(false);
        }

        document.addEventListener("pointerdown", handleOutside, true);
        document.addEventListener("keydown", handleEscape);

        return () => {
            document.removeEventListener("pointerdown", handleOutside, true);
            document.removeEventListener("keydown", handleEscape);
        };
    }, [pickerOpen]);

    function applyCustom(nextHue = hue, nextSaturation = saturation, nextValue = value) {
        const hex = hsvToHex(nextHue, nextSaturation, nextValue);
        settings.store.customAccent = hex;
        settings.store.colorTheme = "custom";
        setHexDraft(hex.toUpperCase());
    }

    function updateSv(event: ReactPointerEvent<HTMLDivElement>) {
        const rect = event.currentTarget.getBoundingClientRect();
        const nextSaturation = clamp((event.clientX - rect.left) / rect.width);
        const nextValue = clamp(1 - (event.clientY - rect.top) / rect.height);
        setSaturation(nextSaturation);
        setValue(nextValue);
        applyCustom(hue, nextSaturation, nextValue);
    }

    function commitHex() {
        if (/^#[0-9a-f]{6}$/i.test(hexDraft.trim())) {
            settings.store.customAccent = hexDraft.trim().toLowerCase();
            settings.store.colorTheme = "custom";
        } else {
            setHexDraft(customAccent.toUpperCase());
        }
    }

    async function pickColorFromScreen() {
        const EyeDropperCtor = (window as any).EyeDropper;

        if (!EyeDropperCtor) {
            showToast("The system color picker is not available in this Discord build.", Toasts.Type.FAILURE);
            return;
        }

        try {
            const result = await new EyeDropperCtor().open();
            const hex = String(result?.sRGBHex || "").toLowerCase();

            if (!/^#[0-9a-f]{6}$/i.test(hex)) return;

            settings.store.customAccent = hex;
            settings.store.colorTheme = "custom";
            setHexDraft(hex.toUpperCase());

            const { r, g, b } = parseHexColor(hex);
            const hsv = rgbToHsv(r, g, b);
            setHue(hsv.h);
            setSaturation(hsv.s);
            setValue(hsv.v);
        } catch {
            // EyeDropper rejects when the user presses Escape/cancels.
        }
    }

    function copyCurrentHex() {
        copyWithToast(customAccent.toUpperCase(), "Color copied.");
    }

    const hueColor = hsvToHex(hue, 1, 1);
    const customContrast = (() => {
        const { r, g, b } = parseHexColor(customAccent);
        return (r * 299 + g * 587 + b * 114) / 1000 >= 165 ? "#111214" : "#ffffff";
    })();

    const presets = ["#1e293b", "#b9dceb", "#2f7d46", "#8b6a2f", "#7b3376"];

    return (
        <div ref={pickerRef} className={cl("theme-picker")} aria-label="Pinterest Tool color theme">
            <span className={cl("theme-label")}>Theme</span>
            <div className={cl("theme-swatches")}>
                {PINTEREST_THEMES.map(option => (
                    <button
                        key={option.value}
                        type="button"
                        className={classes(cl("theme-swatch"), option.value === theme && cl("theme-swatch-active"))}
                        style={{ "--pt-swatch": option.accent } as any}
                        aria-label={`${option.label} theme`}
                        title={option.label}
                        onClick={() => {
                            settings.store.colorTheme = option.value;
                            setPickerOpen(false);
                        }}
                    />
                ))}

                <button
                    type="button"
                    className={classes(cl("theme-custom"), theme === "custom" && cl("theme-custom-active"))}
                    style={{
                        "--pt-custom-swatch": customAccent,
                        "--pt-custom-contrast": customContrast
                    } as any}
                    title="Custom colour"
                    aria-label="Choose custom colour"
                    aria-expanded={pickerOpen}
                    onClick={() => setPickerOpen(open => !open)}
                >
                    <span className={cl("theme-custom-icon")} aria-hidden="true">+</span>
                </button>
            </div>

            {pickerOpen ? (
                <div className={cl("color-popover")}>
                    <div
                        className={cl("color-sv")}
                        style={{ "--pt-picker-hue": hueColor } as any}
                        onPointerDown={event => {
                            draggingSv.current = true;
                            event.currentTarget.setPointerCapture?.(event.pointerId);
                            updateSv(event);
                        }}
                        onPointerMove={event => {
                            if (draggingSv.current) updateSv(event);
                        }}
                        onPointerUp={event => {
                            draggingSv.current = false;
                            event.currentTarget.releasePointerCapture?.(event.pointerId);
                        }}
                        onPointerCancel={() => {
                            draggingSv.current = false;
                        }}
                    >
                        <span
                            className={cl("color-sv-handle")}
                            style={{
                                left: `${saturation * 100}%`,
                                top: `${(1 - value) * 100}%`
                            }}
                        />
                    </div>

                    <input
                        className={cl("color-hue")}
                        type="range"
                        min={0}
                        max={359}
                        value={Math.round(hue)}
                        aria-label="Hue"
                        onChange={event => {
                            const nextHue = Number(event.currentTarget.value);
                            setHue(nextHue);
                            applyCustom(nextHue, saturation, value);
                        }}
                    />

                    <div className={cl("color-hex-row")}>
                        <div className={cl("color-hex-wrap")}>
                            <input
                                className={cl("color-hex-input")}
                                value={hexDraft}
                                maxLength={7}
                                spellCheck={false}
                                aria-label="HEX color"
                                onChange={event => setHexDraft(event.currentTarget.value)}
                                onBlur={commitHex}
                                onKeyDown={event => {
                                    if (event.key === "Enter") {
                                        commitHex();
                                        event.currentTarget.blur();
                                    }
                                }}
                            />
                            <div className={cl("color-hex-actions")}>
                                <button
                                    type="button"
                                    className={cl("color-action-button")}
                                    title="Copy HEX"
                                    aria-label="Copy HEX color"
                                    onClick={copyCurrentHex}
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                        <path d="M8 7V5a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-2v3a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3v-9a3 3 0 0 1 3-3h3Zm3 0h3a3 3 0 0 1 3 3v3h2V5h-8v2Zm3 3H5v9h9v-9Z" />
                                    </svg>
                                </button>
                                <button
                                    type="button"
                                    className={classes(cl("color-action-button"), cl("color-eyedropper"))}
                                    title="Pick a color from your screen"
                                    aria-label="Pick a color from your screen"
                                    onClick={() => void pickColorFromScreen()}
                                >
                                    <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                        <path d="m19.35 2.65 2 2a2.2 2.2 0 0 1 0 3.11l-3.12 3.12.71.71a1 1 0 0 1 0 1.41l-1.41 1.42a1 1 0 0 1-1.42 0l-.7-.71-7.08 7.08a4 4 0 0 1-2.83 1.17H3a1 1 0 0 1-1-1v-2.5a4 4 0 0 1 1.17-2.83l7.08-7.08-.71-.7a1 1 0 0 1 0-1.42l1.42-1.41a1 1 0 0 1 1.41 0l.71.71 3.12-3.12a2.2 2.2 0 0 1 3.11 0ZM11.66 10.1l-7.08 7.08A1.8 1.8 0 0 0 4 18.46V20h1.54c.48 0 .94-.19 1.28-.53l7.08-7.08-2.24-2.29Zm6.13-6.04-3.29 3.29 2.15 2.15 3.29-3.29a.2.2 0 0 0 0-.28l-1.87-1.87a.2.2 0 0 0-.28 0Z" />
                                    </svg>
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className={cl("color-presets")}>
                        {presets.map(preset => (
                            <button
                                key={preset}
                                type="button"
                                className={cl("color-preset")}
                                style={{ "--pt-preset": preset } as any}
                                aria-label={`Use ${preset}`}
                                title={preset}
                                onClick={() => {
                                    settings.store.customAccent = preset;
                                    settings.store.colorTheme = "custom";
                                }}
                            />
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function ResultMenu({
    result,
    open,
    onToggle
}: {
    result: PinterestImageResult;
    open: boolean;
    onToggle(): void;
}) {
    const buttonRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, accent: "#e60023" });

    function closeMenu() {
        if (open) onToggle();
    }

    function updateMenuPosition() {
        const button = buttonRef.current;
        if (!button) return;

        const rect = button.getBoundingClientRect();
        const menuWidth = 164;
        const estimatedMenuHeight = 190;
        const gap = 6;
        const margin = 8;

        let left = rect.right - menuWidth;
        left = Math.max(margin, Math.min(left, window.innerWidth - menuWidth - margin));

        let top = rect.bottom + gap;
        if (top + estimatedMenuHeight > window.innerHeight - margin) {
            top = Math.max(margin, rect.top - estimatedMenuHeight - gap);
        }

        const accent = getComputedStyle(button).getPropertyValue("--pt-accent").trim() || "#e60023";
        setMenuPosition({ top, left, accent });
    }

    useEffect(() => {
        if (!open) return;

        updateMenuPosition();

        function handlePointerDown(event: PointerEvent) {
            const target = event.target as Node;
            if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
            closeMenu();
        }

        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") closeMenu();
        }

        function handleViewportChange() {
            updateMenuPosition();
        }

        document.addEventListener("pointerdown", handlePointerDown, true);
        document.addEventListener("keydown", handleKeyDown);
        window.addEventListener("resize", handleViewportChange);
        window.addEventListener("scroll", handleViewportChange, true);

        return () => {
            document.removeEventListener("pointerdown", handlePointerDown, true);
            document.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("resize", handleViewportChange);
            window.removeEventListener("scroll", handleViewportChange, true);
        };
    }, [open]);

    const floatingMenu = open ? ReactDOMPortal.createPortal(
        <div
            ref={menuRef}
            className={classes(cl("menu"), cl("menu-floating"))}
            role="menu"
            style={{
                top: menuPosition.top,
                left: menuPosition.left,
                "--pt-accent": menuPosition.accent
            } as any}
            onPointerDown={event => event.stopPropagation()}
            onClick={event => event.stopPropagation()}
        >
            <button type="button" role="menuitem" className={cl("menu-item")} onClick={() => {
                openImageModal({ url: result.url, original: result.url, width: result.width, height: result.height });
                closeMenu();
            }}>
                <span className={cl("menu-item-icon")} aria-hidden="true">⌕</span>
                <span>Preview</span>
            </button>

            <button type="button" role="menuitem" className={cl("menu-item")} onClick={() => {
                copyWithToast(result.url, "Media URL copied to clipboard.");
                closeMenu();
            }}>
                <span className={cl("menu-item-icon")} aria-hidden="true">⧉</span>
                <span>Copy link</span>
            </button>

            <button type="button" role="menuitem" className={cl("menu-item")} onClick={() => {
                void saveResult(result);
                closeMenu();
            }}>
                <span className={cl("menu-item-icon")} aria-hidden="true">↓</span>
                <span>Save image</span>
            </button>

            {result.pinterestUrl ? (
                <>
                    <div className={cl("menu-separator")} />
                    <button type="button" role="menuitem" className={cl("menu-item")} onClick={() => {
                        VencordNative.native.openExternal(result.pinterestUrl!);
                        closeMenu();
                    }}>
                        <span className={cl("menu-item-icon")} aria-hidden="true">↗</span>
                        <span>Open Pinterest</span>
                    </button>
                </>
            ) : null}

            <div className={cl("menu-resolution")}>{result.width} × {result.height}</div>
        </div>,
        document.body
    ) : null;

    return (
        <div className={cl("menu-wrap")}>
            <button
                ref={buttonRef}
                type="button"
                className={cl("menu-button")}
                aria-label="Image options"
                aria-expanded={open}
                onPointerDown={event => {
                    // Do not let the lower-row options button receive browser focus.
                    // Discord's modal can scroll/recenter focused descendants, which was
                    // the small "zoom backwards" seen on the second row.
                    event.preventDefault();
                    event.stopPropagation();
                }}
                onClick={event => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (!open) updateMenuPosition();
                    onToggle();
                }}
            >
                <span className={cl("menu-button-dots")} aria-hidden="true">•••</span>
            </button>
            {floatingMenu}
        </div>
    );
}

function ResultsSection({
    kind,
    bucket,
    menuId,
    gifsOnly,
    slotCount,
    setMenuId,
    setBuckets,
    onLoadNextPage,
    onPageChange,
    onSelectResult,
    isFavorite,
    onToggleFavorite
}: {
    kind: SearchKind;
    bucket: SearchBucketState;
    menuId: string;
    gifsOnly: boolean;
    slotCount: number;
    setMenuId: Dispatch<SetStateAction<string>>;
    setBuckets: Dispatch<SetStateAction<Record<SearchKind, SearchBucketState>>>;
    onLoadNextPage(kind: SearchKind): void;
    onPageChange(kind: SearchKind): void;
    onSelectResult(result: PinterestImageResult, kind: SearchKind): void;
    isFavorite(result: PinterestImageResult, kind: SearchKind): boolean;
    onToggleFavorite(result: PinterestImageResult, kind: SearchKind): void;
}) {
    const visibleResults = useMemo(() => bucket.data?.results ?? [], [bucket.data]);

    const totalPages = Math.max(1, Math.ceil(visibleResults.length / slotCount));
    const pagedResults = visibleResults.slice(bucket.page * slotCount, bucket.page * slotCount + slotCount);
    const basePageLabel = bucket.bookmark?.length ? `Page ${bucket.page + 1}` : `Page ${bucket.page + 1} / ${totalPages}`;
    const pageLabel = gifsOnly && pagedResults.length
        ? `${basePageLabel} · ${pagedResults.length} GIF${pagedResults.length === 1 ? "" : "s"}`
        : basePageLabel;

    if (!bucket.error && bucket.data == null) return null;

    return (
        <section className={cl("section")}>
            <div className={cl("section-header")}>
                <div className={cl("section-title")}>
                    {kind === "BANNER" ? "Banner results" : "Icon results"}
                </div>
                <div className={cl("page-indicator")}>{pageLabel}</div>
            </div>
            {bucket.error ? <div className={cl("state")}>{bucket.error}</div> : null}
            {!bucket.error && bucket.data != null && !pagedResults.length ? (
                <div className={cl("empty-state")}>
                    <div className={cl("empty-state-title")}>
                        {gifsOnly ? "No direct GIFs found" : "No results found"}
                    </div>
                    <div className={cl("empty-state-copy")}>
                        {gifsOnly
                            ? "Pinterest often returns video previews instead of real .gif files. Try another search or use Images."
                            : "Try a shorter or different search."}
                    </div>
                </div>
            ) : null}
            {bucket.data != null && (pagedResults.length > 0 || bucket.page > 0 || Boolean(bucket.bookmark?.length)) ? (
                <div className={cl("section-body")}>
                    <div className={cl("page-nav-sticky")}>
                        <button
                            type="button"
                            aria-label="Previous results"
                            title="Previous"
                            className={classes(cl("page-button"), cl("page-button-side"), cl("page-button-left"))}
                            disabled={bucket.page === 0}
                            onMouseDown={event => event.preventDefault()}
                            onClick={() => {
                                onPageChange(kind);
                                setBuckets(current => ({
                                    ...current,
                                    [kind]: {
                                        ...current[kind],
                                        page: Math.max(0, current[kind].page - 1)
                                    }
                                }));
                            }}
                        >
                            <ChevronLeftIcon />
                        </button>

                        <button
                            type="button"
                            aria-label="Next results"
                            title="Next"
                            className={classes(cl("page-button"), cl("page-button-side"), cl("page-button-right"))}
                            disabled={bucket.loadingNextPage || (bucket.page >= totalPages - 1 && !bucket.bookmark?.length)}
                            onMouseDown={event => event.preventDefault()}
                            onClick={() => {
                                onPageChange(kind);

                                if (bucket.page < totalPages - 1) {
                                    setBuckets(current => ({
                                        ...current,
                                        [kind]: {
                                            ...current[kind],
                                            page: Math.min(totalPages - 1, current[kind].page + 1)
                                        }
                                    }));
                                    return;
                                }

                                onLoadNextPage(kind);
                            }}
                        >
                            {bucket.loadingNextPage ? <span className={cl("page-loading")}>•••</span> : <ChevronRightIcon />}
                        </button>
                    </div>

                    {pagedResults.length ? (
                    <div className={classes(
                        cl("grid"),
                        kind === "BANNER" && cl("grid-banner"),
                        gifsOnly && kind !== "BANNER" && pagedResults.length > 0 && pagedResults.length < slotCount && cl("grid-gif-sparse")
                    )}>
                        {pagedResults.map(result => (
                            <div
                                key={`${kind}-${result.id}`}
                                role="button"
                                tabIndex={0}
                                className={cl("card")}
                                onMouseDown={event => event.preventDefault()}
                                onClick={() => onSelectResult(result, kind)}
                                onKeyDown={event => {
                                    if (event.currentTarget !== event.target) return;
                                    if (event.key === "Enter" || event.key === " ") {
                                        event.preventDefault();
                                        onSelectResult(result, kind);
                                    }
                                }}
                            >
                                <div className={cl("card-top")}>
                                    <button
                                        type="button"
                                        className={classes(cl("favorite-button"), isFavorite(result, kind) && cl("favorite-button-active"))}
                                        aria-label={isFavorite(result, kind) ? "Remove from favorites" : "Add to favorites"}
                                        title={isFavorite(result, kind) ? "Remove from favorites" : "Add to favorites"}
                                        onMouseDown={event => event.stopPropagation()}
                                        onClick={event => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            onToggleFavorite(result, kind);
                                        }}
                                    >
                                        <HeartIcon filled={isFavorite(result, kind)} />
                                    </button>
                                    <ResultMenu
                                        result={result}
                                        open={menuId === `${kind}:${result.id}`}
                                        onToggle={() => setMenuId(current => current === `${kind}:${result.id}` ? "" : `${kind}:${result.id}`)}
                                    />
                                </div>
                                <div className={classes(cl("art"), kind === "BANNER" && cl("art-banner"))}>
                                    <img src={result.url} alt={result.title || bucket.activeQuery} />
                                    <span className={cl("card-use")}>Select</span>
                                </div>
                                <div className={cl("card-bottom")}>
                                    <div className={cl("card-title")}>{getResultLabel(result)}</div>
                                    <div className={cl("card-meta")}>
                                        {result.isGif ? <span>GIF</span> : <span>Image</span>}
                                        <span>{targetLabel(kind)}</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                    ) : null}
                </div>
            ) : null}
        </section>
    );
}


function FavoritesSection({
    target,
    favorites,
    slotCount,
    page,
    setPage,
    menuId,
    setMenuId,
    onSelectResult,
    onToggleFavorite
}: {
    target: SearchKind;
    favorites: PinterestFavorite[];
    slotCount: number;
    page: number;
    setPage(page: number): void;
    menuId: string;
    setMenuId: Dispatch<SetStateAction<string>>;
    onSelectResult(result: PinterestImageResult, kind: SearchKind): void;
    onToggleFavorite(result: PinterestImageResult, kind: SearchKind): void;
}) {
    const visible = useMemo(
        () => favorites.filter(item => item.target === target).sort((a, b) => b.savedAt - a.savedAt),
        [favorites, target]
    );

    const totalPages = Math.max(1, Math.ceil(visible.length / slotCount));
    const safePage = Math.min(page, totalPages - 1);
    const paged = visible.slice(safePage * slotCount, safePage * slotCount + slotCount);

    useEffect(() => {
        if (page !== safePage) setPage(safePage);
    }, [page, safePage]);

    return (
        <section className={cl("section")}>
            <div className={cl("section-header")}>
                <div className={cl("section-title")}>{target === "BANNER" ? "Banner Favorites" : "Avatar Favorites"}</div>
                <div className={cl("page-indicator")}>
                    {visible.length ? `Page ${safePage + 1} / ${totalPages}` : "Saved pins"}
                </div>
            </div>

            {!visible.length ? (
                <div className={cl("favorites-empty")}>
                    <div className={cl("favorites-empty-heart")}><HeartIcon /></div>
                    <div className={cl("empty-state-title")}>No favorites yet</div>
                    <div className={cl("empty-state-copy")}>Tap the heart on a result to keep it here.</div>
                </div>
            ) : (
                <div className={cl("section-body")}>
                    <div className={cl("page-nav-sticky")}>
                        <button
                            type="button"
                            aria-label="Previous favorites"
                            title="Previous"
                            className={classes(cl("page-button"), cl("page-button-side"), cl("page-button-left"))}
                            disabled={safePage === 0}
                            onClick={() => setPage(Math.max(0, safePage - 1))}
                        >
                            <ChevronLeftIcon />
                        </button>

                        <button
                            type="button"
                            aria-label="Next favorites"
                            title="Next"
                            className={classes(cl("page-button"), cl("page-button-side"), cl("page-button-right"))}
                            disabled={safePage >= totalPages - 1}
                            onClick={() => setPage(Math.min(totalPages - 1, safePage + 1))}
                        >
                            <ChevronRightIcon />
                        </button>
                    </div>

                    <div className={classes(cl("grid"), target === "BANNER" && cl("grid-banner"))}>
                        {paged.map(result => (
                            <div
                                key={`favorite-${target}-${result.id}`}
                                role="button"
                                tabIndex={0}
                                className={cl("card")}
                                onMouseDown={event => event.preventDefault()}
                                onClick={() => onSelectResult(result, target)}
                                onKeyDown={event => {
                                    if (event.currentTarget !== event.target) return;
                                    if (event.key === "Enter" || event.key === " ") {
                                        event.preventDefault();
                                        onSelectResult(result, target);
                                    }
                                }}
                            >
                                <div className={cl("card-top")}>
                                    <button
                                        type="button"
                                        className={classes(cl("favorite-button"), cl("favorite-button-active"))}
                                        aria-label="Remove from favorites"
                                        title="Remove from favorites"
                                        onMouseDown={event => event.stopPropagation()}
                                        onClick={event => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            onToggleFavorite(result, target);
                                        }}
                                    >
                                        <HeartIcon filled />
                                    </button>
                                    <ResultMenu
                                        result={result}
                                        open={menuId === `favorite:${target}:${result.id}`}
                                        onToggle={() => setMenuId(current =>
                                            current === `favorite:${target}:${result.id}`
                                                ? ""
                                                : `favorite:${target}:${result.id}`
                                        )}
                                    />
                                </div>

                                <div className={classes(cl("art"), target === "BANNER" && cl("art-banner"))}>
                                    <img src={result.url} alt={result.title || "Favorite Pinterest image"} />
                                    <span className={cl("card-use")}>Select</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </section>
    );
}

interface PinterestBrowserProps {
    query: string;
    setQuery(query: string): void;
    clearQuery(): void;
    onSelectResult(result: PinterestImageResult, kind: SearchKind): void;
    rootClassName: string;
    initialTarget: SearchTarget;
    showTargetSelector: boolean;
    initialDiscoveryQuery?: string;
    panelProps?: {
        id?: string;
        role?: "tabpanel";
        "aria-labelledby"?: string;
    };
}

function PinterestBrowser({
    query,
    setQuery,
    clearQuery,
    onSelectResult,
    rootClassName,
    initialTarget,
    showTargetSelector,
    initialDiscoveryQuery,
    panelProps
}: PinterestBrowserProps) {
    const { colorTheme, customAccent } = settings.use(["colorTheme", "customAccent"]);

    const scrollRef = useRef<HTMLDivElement>(null);
    const browserRef = useRef<HTMLDivElement>(null);
    // Images and GIFs own independent request generations. Switching tabs must
    // never invalidate a request that is still finishing in the background.
    const requestGenerationRef = useRef<Record<SearchMediaMode, number>>({ IMAGES: 0, GIFS: 0 });
    const [target, setTarget] = useState<SearchTarget>(initialTarget);
    const [gifsOnly, setGifsOnly] = useState(false);
    const [favoritesOnly, setFavoritesOnly] = useState(false);
    const [favorites, setFavorites] = useState<PinterestFavorite[]>([]);
    const [favoritesPage, setFavoritesPage] = useState(0);
    const [loadingByMode, setLoadingByMode] = useState<Record<SearchMediaMode, boolean>>({
        IMAGES: false,
        GIFS: false
    });
    const [manualSearchingByMode, setManualSearchingByMode] = useState<Record<SearchMediaMode, boolean>>({
        IMAGES: false,
        GIFS: false
    });
    // Track the exact query currently being searched in each tab. This lets the
    // user correct/extend the text and immediately submit a replacement search
    // without waiting for the previous request to finish.
    const [manualSearchQueryByMode, setManualSearchQueryByMode] = useState<Record<SearchMediaMode, string>>({
        IMAGES: "",
        GIFS: ""
    });
    const [menuId, setMenuId] = useState("");
    const [selectionOpen, setSelectionOpen] = useState(false);
    const [tabQueries, setTabQueries] = useState<Record<SearchMediaMode, string>>({
        IMAGES: query,
        GIFS: ""
    });
    const [tabLastSearchQueries, setTabLastSearchQueries] = useState<Record<SearchMediaMode, string>>({
        IMAGES: "",
        GIFS: ""
    });
    const [bucketsByMode, setBucketsByMode] = useState<Record<SearchMediaMode, SearchBuckets>>({
        IMAGES: createEmptyBuckets(),
        GIFS: createEmptyBuckets()
    });
    const scrollPositionsRef = useRef<Record<SearchMediaMode | "FAVORITES", number>>({
        IMAGES: 0,
        GIFS: 0,
        FAVORITES: 0
    });

    const activeMediaMode: SearchMediaMode = gifsOnly ? "GIFS" : "IMAGES";
    const buckets = bucketsByMode[activeMediaMode];
    const lastSearchQuery = tabLastSearchQueries[activeMediaMode];
    const manualSearching = manualSearchingByMode[activeMediaMode];
    const manualSearchQuery = manualSearchQueryByMode[activeMediaMode];
    const trimmedVisibleQuery = query.trim();
    const isSearchingVisibleQuery = manualSearching && trimmedVisibleQuery === manualSearchQuery;
    const isLoadingNextPage = Object.values(buckets).some(bucket => bucket.loadingNextPage);
    const isSameAsLastSearch = Boolean(lastSearchQuery) && trimmedVisibleQuery === lastSearchQuery.trim();
    // While Next is already fetching more of the same query, Enter/Search should not
    // accidentally start a brand-new randomized search. Editing the text still makes
    // Search available immediately, so typo corrections remain instant.
    const isPagingVisibleQuery = isLoadingNextPage && isSameAsLastSearch;

    function focusSearchInput() {
        const input = browserRef.current?.querySelector<HTMLInputElement>(`.${cl("search-field")} input`);
        input?.focus({ preventScroll: true });
    }

    // Typing should work immediately after opening Pinterest Tool. Also restore
    // keyboard focus to the independent search field when switching Images/GIFs
    // or returning from Favorites, without changing either tab's saved query.
    useEffect(() => {
        if (favoritesOnly) return;

        const frame = window.requestAnimationFrame(focusSearchInput);
        return () => window.cancelAnimationFrame(frame);
    }, [activeMediaMode, favoritesOnly]);

    function setBucketsForMode(
        mode: SearchMediaMode,
        action: SetStateAction<SearchBuckets>
    ) {
        setBucketsByMode(current => {
            const currentBuckets = current[mode];
            const nextBuckets = typeof action === "function"
                ? (action as (value: SearchBuckets) => SearchBuckets)(currentBuckets)
                : action;

            return {
                ...current,
                [mode]: nextBuckets
            };
        });
    }

    const setActiveBuckets: Dispatch<SetStateAction<SearchBuckets>> = action => {
        setBucketsForMode(activeMediaMode, action);
    };

    function updateVisibleQuery(value: string) {
        setQuery(value);
        setTabQueries(current => ({
            ...current,
            [activeMediaMode]: value
        }));
    }

    function rememberCurrentScroll() {
        const view = favoritesOnly ? "FAVORITES" : activeMediaMode;
        scrollPositionsRef.current[view] = scrollRef.current?.scrollTop ?? 0;
    }

    function restoreScroll(view: SearchMediaMode | "FAVORITES") {
        window.requestAnimationFrame(() => {
            scrollRef.current?.scrollTo({ top: scrollPositionsRef.current[view] ?? 0 });
        });
    }

    function getResultsPerRequest(kind: SearchKind) {
        // Keep the broad fetch pool used by the stable build while page sizes stay fixed.
        const base = Math.max(AVATAR_RESULTS_PER_PAGE, BANNER_RESULTS_PER_PAGE);
        return kind === "BANNER"
            ? Math.max(48, base * 18)
            : Math.max(32, base * 12);
    }


    function currentFavoriteTarget(): SearchKind {
        return target === "ALL" ? "AVATAR" : target;
    }

    function isFavorite(result: PinterestImageResult, kind: SearchKind) {
        const key = favoriteKey(result, kind);
        return favorites.some(item => favoriteKey(item, item.target) === key);
    }

    function toggleFavorite(result: PinterestImageResult, kind: SearchKind) {
        if (kind !== "AVATAR" && kind !== "BANNER") return;

        const key = favoriteKey(result, kind);

        setFavorites(current => {
            const currentForKind = current.filter(item => item.target === kind);
            const otherKinds = current.filter(item => item.target !== kind);
            const exists = currentForKind.some(item => favoriteKey(item, item.target) === key);

            const nextForKind = exists
                ? currentForKind.filter(item => favoriteKey(item, item.target) !== key)
                : [{ ...result, target: kind, savedAt: Date.now() }, ...currentForKind];

            void writeFavoritesForTarget(kind, nextForKind);

            return [...nextForKind, ...otherKinds].sort((a, b) => b.savedAt - a.savedAt);
        });
    }

    async function runSearch(nextQuery = query, nextGifsOnly = gifsOnly, manual = false) {
        const trimmed = nextQuery.trim();
        if (!trimmed) return;

        const mode: SearchMediaMode = nextGifsOnly ? "GIFS" : "IMAGES";
        const kinds = getSearchKinds(target);
        const generation = ++requestGenerationRef.current[mode];

        setFavoritesOnly(false);
        setLoadingByMode(current => ({ ...current, [mode]: true }));
        // Search feedback belongs to the tab that launched it. The other tab can
        // be opened while this request keeps running and caching its result.
        setManualSearchingByMode(current => ({ ...current, [mode]: manual }));
        if (manual) {
            setManualSearchQueryByMode(current => ({ ...current, [mode]: trimmed }));
        }
        setMenuId("");
        setBucketsForMode(mode, current => {
            const next = { ...current };
            for (const kind of kinds) {
                next[kind] = createEmptyBucket();
            }
            return next;
        });

        try {
            const responses = await Promise.all(kinds.map(async kind => {
                const response = await Native.search(
                    trimmed,
                    getResultsPerRequest(kind),
                    nextGifsOnly ? "GIFS" : "STATIC",
                    [],
                    kind
                ) as PinterestSearchPayload;
                return [kind, response] as const;
            }));

            if (generation !== requestGenerationRef.current[mode]) return;

            setBucketsForMode(mode, current => {
                const next = { ...current };
                for (const [kind, response] of responses) {
                    next[kind] = {
                        data: response,
                        activeQuery: response.query,
                        bookmark: response.bookmark,
                        page: 0,
                        loadingNextPage: false,
                        error: ""
                    };
                }
                return next;
            });

            // Discovery feeds stay invisible in the search field. Only explicit
            // user searches/guides become the remembered query for this tab.
            if (manual) {
                setTabLastSearchQueries(current => ({
                    ...current,
                    [mode]: trimmed
                }));
                setTabQueries(current => ({
                    ...current,
                    [mode]: trimmed
                }));
            }

            scrollPositionsRef.current[mode] = 0;
            setSelectionOpen(false);
            window.requestAnimationFrame(() => {
                if (!favoritesOnly && (gifsOnly ? "GIFS" : "IMAGES") === mode) {
                    scrollRef.current?.scrollTo({ top: 0 });
                }
            });
        } catch (error) {
            if (generation !== requestGenerationRef.current[mode]) return;

            logger.error("Pinterest search failed", error);
            const message = error instanceof Error ? error.message : "Pinterest search failed.";

            setBucketsForMode(mode, current => {
                const next = { ...current };
                for (const kind of kinds) {
                    next[kind] = {
                        ...createEmptyBucket(),
                        error: message
                    };
                }
                return next;
            });
        } finally {
            if (generation === requestGenerationRef.current[mode]) {
                setLoadingByMode(current => ({ ...current, [mode]: false }));
                setManualSearchingByMode(current => ({ ...current, [mode]: false }));
                setManualSearchQueryByMode(current => ({ ...current, [mode]: "" }));
            }
        }
    }

    function hasCachedResults(mode: SearchMediaMode) {
        return Object.values(bucketsByMode[mode]).some(bucket =>
            bucket.data !== null || Boolean(bucket.error)
        );
    }

    function changeMediaMode(mode: "IMAGES" | "GIFS" | "FAVORITES") {
        setMenuId("");
        setSelectionOpen(false);
        rememberCurrentScroll();

        if (mode === "FAVORITES") {
            // Favorites is only a view switch. Do not cancel Images/GIFs requests:
            // they can finish in the background and will be ready when the user returns.
            setFavoritesOnly(true);
            restoreScroll("FAVORITES");
            return;
        }

        const nextMode: SearchMediaMode = mode;
        const nextGifsOnly = nextMode === "GIFS";
        if (!favoritesOnly && nextGifsOnly === gifsOnly) return;

        setFavoritesOnly(false);
        setGifsOnly(nextGifsOnly);

        // Images and GIFs keep completely independent search text/results.
        // Switching tabs must never copy the currently typed query into the other tab:
        // a user may intentionally search "reze" in Images and "sung jinwoo" in GIFs.
        // If the destination tab has never been searched, its field stays empty while
        // the optional discovery feed can load invisibly in the background.
        const nextQuery = tabQueries[nextMode];

        setQuery(nextQuery);
        restoreScroll(nextMode);

        // If this tab already has a request in flight, simply show its state. Never
        // start a duplicate request and never invalidate the background request.
        if (loadingByMode[nextMode]) return;

        // Cached results preserve page + scroll exactly where this tab was left.
        if (hasCachedResults(nextMode)) return;

        if (nextQuery.trim()) {
            void runSearch(nextQuery, nextGifsOnly, true);
            return;
        }

        if (initialDiscoveryQuery) {
            void runSearch(initialDiscoveryQuery, nextGifsOnly, false);
        }
    }

    function handleResultPageChange(kind: SearchKind) {
        // Banner pages are vertically tall. When the user changes page from the
        // sticky arrows near the bottom, start the new page at its first result
        // instead of preserving the previous page's deep scroll position.
        if (kind !== "BANNER") return;

        scrollPositionsRef.current[activeMediaMode] = 0;
        scrollRef.current?.scrollTo({ top: 0 });
    }

    async function loadNextPage(kind: SearchKind) {
        const mode = activeMediaMode;
        const bucket = bucketsByMode[mode][kind];
        if (!bucket.data || !bucket.bookmark?.length || bucket.loadingNextPage) return;

        setBucketsForMode(mode, current => ({
            ...current,
            [kind]: {
                ...current[kind],
                loadingNextPage: true
            }
        }));

        const generation = requestGenerationRef.current[mode];

        try {
            const response = await Native.search(
                bucket.activeQuery || tabLastSearchQueries[mode] || tabQueries[mode] || query,
                getResultsPerRequest(kind),
                mode === "GIFS" ? "GIFS" : "STATIC",
                bucket.bookmark,
                kind
            ) as PinterestSearchPayload;
            if (generation !== requestGenerationRef.current[mode]) {
                // A newer manual search superseded this pagination request. Never leave
                // the old bucket stuck showing the three-dot loading indicator.
                setBucketsForMode(mode, current => ({
                    ...current,
                    [kind]: {
                        ...current[kind],
                        loadingNextPage: false
                    }
                }));
                return;
            }

            setBucketsForMode(mode, current => {
                const currentBucket = current[kind];
                const existingResults = currentBucket.data?.results ?? [];
                const mergedResults = mergeUniqueResults(existingResults, response.results);
                const nextPage = currentBucket.page + 1;
                const nextPageStart = nextPage * getSlotCount(kind);
                const canShowNextPage = mergedResults.length > nextPageStart;

                return {
                    ...current,
                    [kind]: {
                        ...currentBucket,
                        data: currentBucket.data == null ? response : {
                            query: currentBucket.data.query,
                            guides: currentBucket.data.guides,
                            results: mergedResults,
                            bookmark: response.bookmark
                        },
                        bookmark: response.bookmark,
                        // A Pinterest backend page is not the same thing as a visible
                        // plugin page. GIF batches can contain zero direct .gif files.
                        // Only advance the UI after enough real results exist to show it.
                        page: canShowNextPage ? nextPage : currentBucket.page,
                        loadingNextPage: false,
                        error: ""
                    }
                };
            });
        } catch (error) {
            logger.error("Pinterest next page failed", error);
            showToast(error instanceof Error ? error.message : "Could not load more Pinterest results.", Toasts.Type.FAILURE);
            setBucketsForMode(mode, current => ({
                ...current,
                [kind]: {
                    ...current[kind],
                    loadingNextPage: false
                }
            }));
        }
    }

    useEffect(() => {
        setMenuId("");
        setSelectionOpen(false);
    }, [target]);

    useEffect(() => {
        let cancelled = false;

        void readFavorites().then(loaded => {
            if (!cancelled) setFavorites(loaded);
        });

        return () => {
            cancelled = true;
        };
    }, [target, favoritesOnly]);

    useEffect(() => {
        if (!initialDiscoveryQuery) return;
        if (tabQueries.IMAGES.trim() || tabLastSearchQueries.IMAGES || hasCachedResults("IMAGES")) return;
        void runSearch(initialDiscoveryQuery, false, false);
    }, []);

    function getGuideSource() {
        const primary = getPrimaryKind(target);
        return buckets[primary].data ?? buckets.IMAGE.data ?? buckets.AVATAR.data ?? buckets.BANNER.data;
    }

    function getPlaceholder() {
        return "Search Pinterest";
    }

    function resetToDiscovery() {
        const mode = activeMediaMode;
        const modeIsGifs = mode === "GIFS";

        clearQuery();
        setTabQueries(current => ({
            ...current,
            [mode]: ""
        }));
        setTabLastSearchQueries(current => ({
            ...current,
            [mode]: ""
        }));
        setMenuId("");
        setSelectionOpen(false);
        setFavoritesOnly(false);
        setFavoritesPage(0);
        scrollPositionsRef.current[mode] = 0;

        // The X resets only the active Images/GIFs tab. The other tab keeps its
        // own search, page and cached results exactly as the user left them.
        if (initialDiscoveryQuery) {
            void runSearch(initialDiscoveryQuery, modeIsGifs, false);
            return;
        }

        ++requestGenerationRef.current[mode];
        setBucketsForMode(mode, createEmptyBuckets());
        setLoadingByMode(current => ({ ...current, [mode]: false }));
        setManualSearchingByMode(current => ({ ...current, [mode]: false }));
    }

    function getSlotCount(kind: SearchKind) {
        if (kind === "BANNER") return BANNER_RESULTS_PER_PAGE;
        if (kind === "IMAGE") return IMAGE_RESULTS_PER_PAGE;
        return AVATAR_RESULTS_PER_PAGE;
    }

    const guideSource = getGuideSource();

    return (
        <div ref={browserRef} {...panelProps} className={rootClassName} style={getPinterestThemeStyle(colorTheme, customAccent) as any}>
            <div className={cl("container-header")}>
                <form className={cl("search-shell")} onSubmit={event => {
                    event.preventDefault();
                    // Do not duplicate the exact same in-flight search, but allow a
                    // corrected/extended query to supersede it immediately. The old
                    // network request is not force-aborted; its stale result is simply
                    // ignored by the per-tab request generation guard.
                    if (!trimmedVisibleQuery || isSearchingVisibleQuery || isPagingVisibleQuery) return;

                    if (favoritesOnly) {
                        setFavoritesOnly(false);
                    }

                    void runSearch(query, gifsOnly, true);
                }}>
                    <div className={cl("media-controls")}>
                        <div className={cl("media-tabs")} role="tablist" aria-label="Pinterest media type">
                            <button
                                type="button"
                                role="tab"
                                aria-selected={!gifsOnly && !favoritesOnly}
                                className={classes(cl("media-tab"), !gifsOnly && !favoritesOnly && cl("media-tab-active"))}
                                onClick={() => changeMediaMode("IMAGES")}
                            >
                                <span className={cl("media-tab-icon")} aria-hidden="true">▧</span>
                                Images
                            </button>
                            <button
                                type="button"
                                role="tab"
                                aria-selected={gifsOnly && !favoritesOnly}
                                className={classes(cl("media-tab"), gifsOnly && !favoritesOnly && cl("media-tab-active"))}
                                onClick={() => changeMediaMode("GIFS")}
                            >
                                <span className={classes(cl("media-tab-icon"), cl("media-tab-gif"))} aria-hidden="true">GIF</span>
                                GIFs
                            </button>
                            <button
                                type="button"
                                role="tab"
                                aria-selected={favoritesOnly}
                                className={classes(cl("media-tab"), cl("media-tab-favorites"), favoritesOnly && cl("media-tab-active"))}
                                onClick={() => changeMediaMode("FAVORITES")}
                            >
                                <span className={cl("media-tab-icon")} aria-hidden="true"><HeartIcon filled={favoritesOnly} /></span>
                                Favorites
                            </button>
                        </div>
                        <ThemePicker theme={colorTheme} customAccent={customAccent} />
                    </div>
                    {!favoritesOnly ? (
                        <div className={cl("search-row")}>
                            <div className={cl("search-field")}>
                                <ManaSearchBar
                                    autoFocus
                                    placeholder={getPlaceholder()}
                                    query={query}
                                    onChange={updateVisibleQuery}
                                    onClear={resetToDiscovery}
                                />
                            </div>
                            {/* A running search only locks re-submitting the exact same text. If the
                                user edits the query while Pinterest is still working, Search becomes available
                                immediately so typos can be corrected without waiting. */}
                            <PillButton compact type="submit" disabled={!trimmedVisibleQuery || isSearchingVisibleQuery || isPagingVisibleQuery}>
                                {isSearchingVisibleQuery || isPagingVisibleQuery ? (
                                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.28" />
                                            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                                                <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.75s" repeatCount="indefinite" />
                                            </path>
                                        </svg>
                                        <span>{isPagingVisibleQuery ? "Loading…" : "Searching…"}</span>
                                    </span>
                                ) : "Search"}
                            </PillButton>
                            {showTargetSelector ? (
                                <SelectionDropdown
                                    target={target}
                                    open={selectionOpen}
                                    onToggle={() => setSelectionOpen(current => !current)}
                                    onSelect={value => {
                                        setTarget(value);
                                        setSelectionOpen(false);
                                    }}
                                />
                            ) : null}
                        </div>
                    ) : null}
                    {!favoritesOnly && guideSource?.guides.length ? (
                        <div className={cl("guides-row")}>
                            {guideSource.guides.slice(0, 6).map(guide => (
                                <button
                                    key={guide.query}
                                    type="button"
                                    className={classes(cl("guide"), guide.query === guideSource.query && cl("guide-active"))}
                                    onClick={() => {
                                        updateVisibleQuery(guide.query);
                                        void runSearch(guide.query, gifsOnly, true);
                                    }}
                                >
                                    {guide.label}
                                </button>
                            ))}
                        </div>
                    ) : null}
                </form>
            </div>
            <div ref={scrollRef} className={cl("container-body")}>
                {favoritesOnly ? (
                    <FavoritesSection
                        target={currentFavoriteTarget()}
                        favorites={favorites}
                        slotCount={getSlotCount(currentFavoriteTarget())}
                        page={favoritesPage}
                        setPage={setFavoritesPage}
                        menuId={menuId}
                        setMenuId={setMenuId}
                        onSelectResult={onSelectResult}
                        onToggleFavorite={toggleFavorite}
                    />
                ) : (
                    getSearchKinds(target).map(kind => (
                        <ResultsSection
                            key={kind}
                            kind={kind}
                            bucket={buckets[kind]}
                            menuId={menuId}
                            gifsOnly={gifsOnly}
                            slotCount={getSlotCount(kind)}
                            setMenuId={setMenuId}
                            setBuckets={setActiveBuckets}
                            onLoadNextPage={loadNextPage}
                            onPageChange={handleResultPageChange}
                            onSelectResult={onSelectResult}
                            isFavorite={isFavorite}
                            onToggleFavorite={toggleFavorite}
                        />
                    ))
                )}
            </div>
        </div>
    );
}

export function PinterestPicker({ onSelectItem }: PinterestPickerProps) {
    const query = ExpressionPickerStore.useExpressionPickerStore(store => store.searchQuery);

    return (
        <PinterestBrowser
            query={query}
            setQuery={value => ExpressionPickerStore.setSearchQuery(value)}
            clearQuery={() => ExpressionPickerStore.setSearchQuery("")}
            onSelectResult={result => {
                onSelectItem({ url: result.url });
                ExpressionPickerStore.closeExpressionPicker();
            }}
            rootClassName={cl("container")}
            initialTarget="IMAGE"
            showTargetSelector={false}
            panelProps={{
                id: "pinterest-picker-tab-panel",
                role: "tabpanel",
                "aria-labelledby": "pinterest-picker-tab"
            }}
        />
    );
}

export function PinterestProfilePanel({ guildId }: { guildId?: string; }) {
    const [query, setQuery] = useState("");

    return (
        <PinterestBrowser
            query={query}
            setQuery={setQuery}
            clearQuery={() => setQuery("")}
            onSelectResult={(result, kind) => {
                void applyProfileResult(result, kind, guildId);
            }}
            rootClassName={classes(cl("container"), cl("inline-wrap"))}
            initialTarget="ALL"
            showTargetSelector={true}
        />
    );
}


interface PinterestProfileModalProps extends ModalProps {
    target: Extract<SearchKind, "AVATAR" | "BANNER">;
    onEditFile?(file: File, onApplyStart?: () => void): Promise<"APPLIED" | "CANCELLED" | false>;
    onApplied?(): void;
}

export function PinterestProfileModal({ target, onEditFile, onApplied, ...props }: PinterestProfileModalProps) {
    const [query, setQuery] = useState("");
    // Guards against a fast double-click (or double-tap) on a result card
    // triggering onSelectResult twice concurrently, which raced two parallel
    // fetch/hand-off attempts against the same Discord dialog/input and
    // caused the flicker + error some people saw when clicking quickly.
    const isSelectingRef = useRef(false);
    const { colorTheme, customAccent, editBeforeApply } = settings.use(["colorTheme", "customAccent", "editBeforeApply"]);
    const discoveryQuery = useMemo(() => {
        const avatarQueries = [
            "aesthetic profile icon",
            "dark aesthetic pfp",
            "anime profile picture",
            "minimal profile icon",
            "art profile picture"
        ];
        // Discovery should feel broad, not like an exact-size Discord banner search.
        // The native search layer still ranks wider results first for BANNER, while
        // Edit Image handles the final crop/zoom chosen by the user.
        const bannerQueries = [
            "aesthetic wallpaper",
            "dark aesthetic art",
            "anime scenery",
            "cinematic art",
            "fantasy landscape art",
            "minimal aesthetic",
            "illustration wallpaper",
            "scenery art"
        ];
        const choices = target === "BANNER" ? bannerQueries : avatarQueries;
        return choices[Math.floor(Math.random() * choices.length)];
    }, [target]);

    return (
        <ModalRoot {...props} size={ModalSize.LARGE} className={cl("profile-modal")} style={getPinterestThemeStyle(colorTheme, customAccent) as any}>
            <ModalHeader separator={false} className={cl("profile-modal-header")}>
                <div className={cl("profile-modal-heading")}>
                    <div className={cl("profile-modal-mark")} aria-hidden="true"><PinterestLogo size={22} /></div>
                    <div>
                        <div className={cl("profile-modal-title")}>Pinterest</div>
                        <div className={cl("profile-modal-subtitle")}>
                            Pick a {target === "BANNER" ? "banner" : "profile icon"}, preview/edit it, then apply
                        </div>
                    </div>
                </div>
                <ModalCloseButton onClick={props.onClose} />
            </ModalHeader>
            <ModalContent className={cl("profile-modal-content")}>
                <PinterestBrowser
                    query={query}
                    setQuery={setQuery}
                    clearQuery={() => setQuery("")}
                    onSelectResult={async result => {
                        if (isSelectingRef.current) return;
                        isSelectingRef.current = true;

                        try {
                            await selectResult(result);
                        } finally {
                            isSelectingRef.current = false;
                        }

                        async function selectResult(result: PinterestImageResult) {
                        if (editBeforeApply && onEditFile) {
                            try {
                                const file = await fetchProfileFile(result);

                                // Hand the file to Discord's own upload/editor flow. The
                                // previous flashing/disappearing editor was actually caused
                                // by handing the file to the wrong <input> (the chat
                                // attachment uploader) — now that the correct dialog input
                                // is used, Discord's real editor should open and stay open.
                                const editorResult = await onEditFile(file, () => {
                                    // Close Pinterest as soon as Discord's Apply button is pressed,
                                    // while Edit Image is still covering it. Waiting until the editor
                                    // disappears causes one frame of Pinterest to flash back onscreen.
                                    props.onClose();
                                });

                                // Keep Pinterest mounted underneath Discord's native editor.
                                // If the user presses Cancel (or closes the editor), Discord
                                // reveals this same Pinterest modal again with the search/results
                                // preserved. Only close Pinterest after a successful Apply.
                                if (editorResult === "APPLIED") {
                                    // Pinterest was already closed on the Apply click to avoid a
                                    // visible flash between Discord's editor and the profile page.
                                    return;
                                }

                                if (editorResult === "CANCELLED") {
                                    return;
                                }
                            } catch (error) {
                                logger.error("Could not open Discord image editor", error);
                            }
                        }

                        const applied = await applyProfileResult(result, target);
                        if (!applied) return;

                        props.onClose();
                        window.setTimeout(() => onApplied?.(), 90);
                        }
                    }}
                    rootClassName={classes(
                        cl("container"),
                        cl("profile-browser"),
                        target === "BANNER" && cl("profile-browser-banner")
                    )}
                    initialTarget={target}
                    showTargetSelector={false}
                    initialDiscoveryQuery={discoveryQuery}
                />
            </ModalContent>
        </ModalRoot>
    );
}
