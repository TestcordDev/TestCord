/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PencilIcon } from "@components/Icons";
import { EquicordDevs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { ExpressionPickerStore,React, Select } from "@webpack/common";

import captionGif from "./render/gif";
import managedStyle from "./styles.css?managed";
import type { CaptionMedia, GifTransform } from "./types";
import Modal from "./ui/modal";
import { showError } from "./ui/statusCard";
import { fetchMedia } from "./utils/fetchMedia";
import { inspectMedia } from "./utils/media";

const cl = classNameFactory("vc-gif-captioner-");

interface GoogleFontAxis {
    tag: string;
    min: number;
    max: number;
}

interface GoogleFontVariant {
    axes: GoogleFontAxis[];
}

interface GoogleFontMetadata {
    family: string;
    displayName: string;
    authors: string[];
    category?: number;
    popularity?: number;
    variants: GoogleFontVariant[];
}

interface GifPickerItemProps {
    format?: number;
    src?: string;
    [key: string]: unknown;
}

interface GifPickerItemInstance {
    props?: GifPickerItemProps;
}

interface SelectOption {
    key: string;
    label: string;
    value: string;
}

const URL_KEYWORDS = ["url", "src", "proxy"];
const URL_CONTAINER_KEYS = ["gif", "media", "image", "video", "thumbnail", "preview", "result", "item"];
const loadedFontFamilies = new Set<string>();
const loadingFontFamilies = new Map<string, Promise<void>>();
const MAX_MEDIA_PIXELS = 4_000_000;

export const createGoogleFontUrl = (family: string, options = "") =>
    `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}${options}&display=swap`;

let cachedFonts: GoogleFontMetadata[] | null = null;
let fontsPromise: Promise<GoogleFontMetadata[]> | null = null;
let currentFont = "Arial";

function normalizeUrl(url: string) {
    return url.startsWith("//") ? `https:${url}` : url;
}

function looksLikeUrl(value: string) {
    return value.startsWith("http://") || value.startsWith("https://") || value.startsWith("//");
}

function applyTenorMp4Fix(url: string, isGif: boolean) {
    if (isGif) return url;

    try {
        const { host } = new URL(url);
        if (!host.endsWith("tenor.com")) return url;
    } catch {
        return url;
    }

    const typeIndex = url.lastIndexOf("/") - 1;
    if (typeIndex <= 0 || url[typeIndex] === "o") return url;

    return url.slice(0, typeIndex) + "o" + url.slice(typeIndex + 1);
}

function collectCandidateUrls(source: unknown, depth = 0, out = new Set<string>()) {
    if (!source || depth > 2) return out;

    if (typeof source === "string") {
        if (looksLikeUrl(source)) out.add(normalizeUrl(source));
        return out;
    }

    if (Array.isArray(source)) {
        for (const entry of source) collectCandidateUrls(entry, depth + 1, out);
        return out;
    }

    if (typeof source !== "object") return out;

    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
        const keyLower = key.toLowerCase();

        if (typeof value === "string") {
            if (looksLikeUrl(value) && URL_KEYWORDS.some(keyword => keyLower.includes(keyword))) {
                out.add(normalizeUrl(value));
            }
            continue;
        }

        if (value && typeof value === "object" && URL_CONTAINER_KEYS.some(keyword => keyLower.includes(keyword))) {
            collectCandidateUrls(value, depth + 1, out);
        }
    }

    return out;
}

function scoreUrl(url: string) {
    let host = "";

    try {
        host = new URL(url).host;
    } catch { }

    let score = 0;
    if (host.endsWith("discordapp.net") || host.endsWith("discordapp.com")) score += 100;
    if (host.includes("images-ext")) score += 20;
    if (host.includes("media.discordapp.net") || host.includes("cdn.discordapp.com")) score += 10;
    if (host.endsWith("klipy.com")) score += 5;
    if (host.endsWith("tenor.com")) score += 5;
    if (url.includes(".gif")) score += 1;

    return score;
}

function orderCandidateUrls(preferred: string | null, candidates: Set<string>) {
    const all = Array.from(candidates);
    if (!all.length) return [];

    const rest = preferred ? all.filter(url => url !== preferred) : all;
    rest.sort((a, b) => scoreUrl(b) - scoreUrl(a));

    return preferred ? [preferred, ...rest] : rest;
}

function isLikelyVideoUrl(url: string) {
    return /\.(webm|mp4|m4v)(\?|$)/i.test(url);
}

async function resolveMedia(urls: string[]) {
    for (const url of urls) {
        const result = await fetchMedia(url);
        if (!result) continue;

        const blob = new Blob([result.buffer], { type: result.contentType });
        const metadata = await inspectMedia(result.buffer, result.contentType, blob);
        if (!metadata) continue;
        if (metadata.width * metadata.height > MAX_MEDIA_PIXELS) continue;

        const previewUrl = URL.createObjectURL(blob);
        let released = false;

        return {
            buffer: result.buffer,
            contentType: result.contentType,
            ...metadata,
            release: () => {
                if (released) return;
                released = true;
                URL.revokeObjectURL(previewUrl);
            },
            url: previewUrl
        };
    }

    return null;
}

async function fetchAllGoogleFonts(): Promise<GoogleFontMetadata[]> {
    if (cachedFonts) return cachedFonts;
    if (fontsPromise) return fontsPromise;

    fontsPromise = fetch("https://fonts.google.com/$rpc/fonts.fe.catalog.actions.metadata.MetadataService/FontSearch", {
        body: JSON.stringify([["", null, null, null, null, null, 1], [5], null, 400]),
        headers: {
            "content-type": "application/json+protobuf",
            "x-user-agent": "grpc-web-javascript/0.1"
        },
        method: "POST"
    })
        .then(response => response.ok ? response.json() : null)
        .then(data => {
            const rows = Array.isArray(data?.[1]) ? data[1] as unknown[] : [];
            const fonts: GoogleFontMetadata[] = [];

            for (const row of rows) {
                if (!Array.isArray(row) || !Array.isArray(row[1])) continue;

                const fontData = row[1] as unknown[];
                const family = typeof fontData[0] === "string" ? fontData[0] : "";
                if (!family || family.length > 100 || !/^[a-zA-Z0-9\s\-_']+$/.test(family)) continue;

                const displayName = typeof fontData[1] === "string" ? fontData[1] : family;
                const authors = Array.isArray(fontData[2])
                    ? fontData[2].filter((author): author is string => typeof author === "string")
                    : [];
                const category = typeof fontData[3] === "number" ? fontData[3] : undefined;
                const variants = Array.isArray(fontData[6])
                    ? fontData[6]
                        .filter((variant): variant is unknown[] => Array.isArray(variant))
                        .map(variant => {
                            const axesSource = Array.isArray(variant[0]) ? variant[0] as unknown[] : [];
                            const axes = axesSource
                                .filter((axis): axis is unknown[] => Array.isArray(axis))
                                .map(axis => {
                                    const tag = axis[0];
                                    const min = axis[1];
                                    const max = axis[2];

                                    if (typeof tag !== "string" || typeof min !== "number" || typeof max !== "number") {
                                        return null;
                                    }

                                    return { tag, min, max };
                                })
                                .filter((axis): axis is GoogleFontAxis => axis !== null);

                            return { axes };
                        })
                    : [];

                fonts.push({
                    authors,
                    category,
                    displayName,
                    family,
                    popularity: 0,
                    variants
                });
            }

            fonts.sort((a, b) => a.family.localeCompare(b.family));
            cachedFonts = fonts;
            return fonts;
        })
        .catch(() => {
            cachedFonts = [];
            return cachedFonts;
        });

    return fontsPromise;
}

export function loadGoogleFont(fontFamily: string) {
    currentFont = fontFamily;
    if (loadedFontFamilies.has(fontFamily)) return Promise.resolve();

    const loading = loadingFontFamilies.get(fontFamily);
    if (loading) return loading;

    const loadPromise = fetch(createGoogleFontUrl(fontFamily))
        .then(response => response.ok ? response.text() : "")
        .then(css => {
            const source = css.match(/url\(([^)]+)\)/)?.[1]?.replace(/^['"]|['"]$/g, "");
            if (!source) return;

            return new FontFace(fontFamily, `url(${source})`).load().then(font => {
                document.fonts.add(font);
                loadedFontFamilies.add(fontFamily);
            });
        })
        .catch(() => { })
        .finally(() => {
            loadingFontFamilies.delete(fontFamily);
        });

    loadingFontFamilies.set(fontFamily, loadPromise);
    return loadPromise;
}

export function getSelectedFont() {
    return currentFont;
}

export function FontSelector({ onSelect }: { onSelect: (font: GoogleFontMetadata) => void; }) {
    const [fonts, setFonts] = React.useState<GoogleFontMetadata[]>(() => cachedFonts ?? []);
    const [selectedFont, setSelectedFont] = React.useState<string | null>(currentFont !== "Arial" ? currentFont : null);

    React.useEffect(() => {
        if (cachedFonts) return;

        void fetchAllGoogleFonts().then(fetchedFonts => {
            setFonts(fetchedFonts);
        });
    }, []);

    const options = fonts.map<SelectOption>(font => ({
        key: font.family,
        label: font.displayName,
        value: font.family
    }));

    const handleSelect = (fontFamily: string) => {
        setSelectedFont(fontFamily);
        currentFont = fontFamily;

        const font = fonts.find(entry => entry.family === fontFamily);
        if (!font) return;

        loadGoogleFont(fontFamily);
        onSelect(font);
    };

    if (!fonts.length) {
        return <div>Loading fonts...</div>;
    }

    return (
        <Select
            placeholder="Select a font..."
            options={options}
            maxVisibleItems={10}
            closeOnSelect={true}
            select={handleSelect}
            isSelected={value => value === selectedFont}
            serialize={value => String(value)}
            renderOptionLabel={(option: SelectOption) => {
                loadGoogleFont(option.value);
                return (
                    <span style={{ fontFamily: `"${option.value}", sans-serif` }}>
                        {option.label}
                    </span>
                );
            }}
        />
    );
}

function showCaptioner(media: CaptionMedia, onConfirm: (transform: GifTransform) => Promise<void> | void) {
    let submitCallback: (() => GifTransform) | undefined;
    let released = false;

    const release = () => {
        if (released) return;
        released = true;
        media.release();
    };

    openModal((modalProps: any) => (
        <Modal
            {...modalProps}
            onClose={() => {
                release();
                modalProps.onClose();
            }}
            media={media}
            onCancel={release}
            onSubmit={callback => {
                submitCallback = callback;
            }}
            onConfirm={async transform => {
                const resolvedTransform = transform ?? submitCallback?.();
                if (!resolvedTransform) return;

                ExpressionPickerStore.closeExpressionPicker();
                try {
                    await onConfirm(resolvedTransform);
                } finally {
                    release();
                }
            }}
        />
    ));
}

export default definePlugin({
    name: "GifCaptioner",
    description: "Add captions to GIFs in the GIF picker.",
    tags: ["Media", "Utility"],
    authors: [EquicordDevs.benjii],
    managedStyle,
    patches: [
        {
            find: "renderGIF",
            noWarn: true,
            replacement: {
                match: /(children:\[)(\i\([^)]+\)\?null:this\.renderGIF\(\))/,
                replace: "$1$self.renderCaptionButton(this),$2"
            }
        }
    ],

    start() {
        void fetchAllGoogleFonts();
    },

    stop() {},

    renderCaptionButton(instance: GifPickerItemInstance) {
        const props = instance?.props;
        if (!props) return null;

        const isGif = props.format === 1;
        const directUrl = typeof props.src === "string" ? props.src : null;

        return (
            <button
                type="button"
                className={classes(cl("trigger"), cl("trigger-icon"))}
                onClick={async event => {
                    event.stopPropagation();

                    const candidates = collectCandidateUrls(props);
                    const adjustedCandidates = new Set<string>();
                    if (directUrl) adjustedCandidates.add(applyTenorMp4Fix(normalizeUrl(directUrl), isGif));

                    for (const candidate of candidates) {
                        adjustedCandidates.add(applyTenorMp4Fix(candidate, isGif));
                    }

                    const preferredUrl = directUrl ? applyTenorMp4Fix(normalizeUrl(directUrl), isGif) : null;
                    const orderedUrls = orderCandidateUrls(preferredUrl, adjustedCandidates);
                    const media = await resolveMedia(orderedUrls);

                    if (!media) {
                        showError("Failed to load GIF.");
                        return;
                    }

                    showCaptioner(media, async transform => {
                        if (!transform) return;
                        await captionGif(media, transform);
                    });
                }}
            >
                <PencilIcon
                    className={cl("trigger-icon")}
                    width={16}
                    height={16}
                />
            </button>
        );
    }
});
