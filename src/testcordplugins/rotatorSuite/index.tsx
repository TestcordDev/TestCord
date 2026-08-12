/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DataStore } from "@api/index";
import { definePluginSettings } from "@api/Settings";
import { UserAreaButton, UserAreaRenderProps } from "@api/UserArea";
import { getUserSettingLazy } from "@api/UserSettings";
import { Logger } from "@utils/Logger";
import { ModalContent, ModalFooter, ModalHeader, ModalRoot, openModal,RenderModalProps } from "@utils/modal";
import { useForceUpdater } from "@utils/react";
import definePlugin, { OptionType } from "@utils/types";
import { findByProps } from "@webpack";
import { Button, Forms, React, RestAPI, TextInput, Toasts, UserStore } from "@webpack/common";

const logger = new Logger("RotatorSuite");

const SK = "RS_v1";
const AR_SK = "AvatarRotator_v6";
const RS_CLOSE_SK = "RS_closeConfig_v1";
const RS_CLOSE_LS = "rs_close_v1";
const AR_DEFAULT_S = 300;
const AR_WARN_S = 60;
const AR_CIRC_R = 115;
const AR_CIRC_D = AR_CIRC_R * 2;
const AR_CONT_H = 300;
const AR_EXP_S = 512;
const AR_ACCEPT = ".jpg,.jpeg,.jfif,.png,.gif,.webp,.avif";
const AR_ALL_EXTS = ["png", "jpg", "jpeg", "jfif", "gif", "webp", "avif"] as const;
type ArExt = typeof AR_ALL_EXTS[number];
const AR = {
    bg1: "var(--background-tertiary)",
    bg2: "rgba(156,103,255,.09)",
    line: "rgba(255,255,255,.07)",
    accent: "#9c67ff",
    aD: "rgba(156,103,255,.18)",
    green: "#3ba55c",
    red: "#ed4245",
    text: "#e0d8ff",
    sub: "var(--text-muted)",
    warn: "#faa61a",
};
const AR_EXT_COLORS: Record<string, string> = {
    png: "#5865f2", jpg: "#43b581", jpeg: "#43b581", jfif: "#4a9e70",
    gif: "#faa61a", webp: "#9c67ff", avif: "#00b0f4",
};
interface CropParams { ox: number; oy: number; zoom: number; rot: number; }
interface AvatarEntry { id: string; label: string; data: string; cropParams?: CropParams; previewData?: string; }
interface ArStoreData { avatars: AvatarEntry[]; seqIndex: number; shuffleQueue: number[]; }
let arAvatars: AvatarEntry[] = [];
let arSeqIndex = 0;
let arShuffleQueue: number[] = [];
let arRotatorTimer: ReturnType<typeof setTimeout> | null = null;
const PALETTE = ["#7c4dff","#9c67ff","#b24df7","#6a1fff","#a855f7","#8b5cf6","#7e22ce","#c084fc","#d946ef","#a21caf","#6d28d9","#4c1d95"];
const UNICODE_EMOJI_RE = /^(\p{Emoji_Presentation}|\p{Extended_Pictographic})\s*/u;
const CUSTOM_EMOJI_RE = /^:([^:]+):(\d{17,20}):\s*/;
const DISCORD_EMOJI_RE = /<a?:([^:]+):(\d+)>/;

const BCR_SK = "BannerColorRotator_v3";
const BCR_DEFAULT_S = 300;
type BcrCycleMode =
    | "full_random" | "avatar_hue" | "mono_cycle" | "warm" | "cool" | "pastel"
    | "dark" | "vivid" | "gradient_walk" | "chromatic" | "rgb_loop" | "complementary"
    | "triadic" | "analogous" | "earth" | "neon" | "sunset" | "ocean"
    | "shade_light_dark" | "shade_dark_light" | "shade_oscillate"
    | "favs_sequential" | "favorites_only" | "favorites_mix" | "favorites_hue" | "favs_shade";
interface BcrStoreData { favorites: string[]; usedFavs: string[]; wasRunning: boolean; currentColor: string | null; }
let bcrFavorites: string[] = [];
let bcrUsedFavs: string[] = [];
let bcrRandomBatch: string[] = [];
let bcrSeqBatch: string[] = [];
let bcrRotatorTimer: ReturnType<typeof setTimeout> | null = null;
let bcrCachedHue: number | null = null;
let bcrGradientState: [number, number, number] | null = null;
let bcrMonoBaseHue: number | null = null;
let bcrSeqBaseHue = 0;
let bcrShadeStep = 0;
let bcrShadeDir = 1;
let bcrCurrentColor: string | null = null;
let bcrOnColorApplied: ((hex: string) => void) | null = null;

function bcrIsValidHex(v: string): boolean { return /^#[0-9a-fA-F]{6}$/.test(v); }
function bcrHsvToHex(h: number, s: number, v: number): string {
    h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(1, s)); v = Math.max(0, Math.min(1, v));
    const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    const toB = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, "0");
    return "#" + toB(r) + toB(g) + toB(b);
}
function bcrHexToHsv(hex: string): [number, number, number] {
    const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d !== 0) {
        switch (max) {
            case r: h = ((g - b) / d + (g < b ? 6 : 0)) * 60; break;
            case g: h = ((b - r) / d + 2) * 60; break;
            case b: h = ((r - g) / d + 4) * 60; break;
        }
    }
    return [h, max === 0 ? 0 : d / max, max];
}
function bcrHslToHex(h: number, s: number, l: number): string {
    s /= 100; l /= 100;
    const v = l + s * Math.min(l, 1 - l);
    return bcrHsvToHex(h, v === 0 ? 0 : 2 * (1 - l / v), v);
}
function bcrRandomHex(): string { return "#" + Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, "0"); }
function bcrSfShuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
}
function bcrBuildBatch(size: number, gen: () => string): string[] {
    const set = new Set<string>(); let tries = 0;
    while (set.size < size && tries++ < size * 8) set.add(gen());
    return [...set];
}
function bcrPickFromFavs(): string {
    if (!bcrFavorites.length) return bcrRandomHex();
    const available = bcrFavorites.filter(c => !bcrUsedFavs.includes(c));
    if (!available.length) { bcrUsedFavs = []; return bcrPickFromFavs(); }
    const color = available[Math.floor(Math.random() * available.length)];
    bcrUsedFavs = [...bcrUsedFavs, color]; return color;
}
function bcrGetBaseHsv(): [number, number, number] {
    const base = settings.store.bannerCustomBaseColor ?? "#c084fc";
    return bcrIsValidHex(base) ? bcrHexToHsv(base) : [270, 0.48, 0.79];
}
async function bcrGetAvatarHue(): Promise<number> {
    if (bcrCachedHue !== null) return bcrCachedHue;
    try {
        const me = await RestAPI.get({ url: "/users/@me" });
        const { avatar, id } = me?.body ?? {};
        if (!avatar || !id) return Math.random() * 360;
        return await new Promise<number>(res => {
            const img = new Image(); img.crossOrigin = "anonymous";
            img.onload = () => {
                const cv = document.createElement("canvas"); cv.width = 8; cv.height = 8;
                const ctx = cv.getContext("2d")!; ctx.drawImage(img, 0, 0, 8, 8);
                const d = ctx.getImageData(0, 0, 8, 8).data;
                let rS = 0, gS = 0, bS = 0, n = 0;
                for (let i = 0; i < d.length; i += 4) { if (d[i + 3] > 128) { rS += d[i]; gS += d[i + 1]; bS += d[i + 2]; n++; } }
                if (!n) { res(Math.random() * 360); return; }
                const hex = "#" + [rS, gS, bS].map(x => Math.round(x / n).toString(16).padStart(2, "0")).join("");
                bcrCachedHue = bcrHexToHsv(hex)[0]; res(bcrCachedHue!);
            };
            img.onerror = () => res(Math.random() * 360);
            img.src = `https://cdn.discordapp.com/avatars/${id}/${avatar}.webp?size=32`;
        });
    } catch { return Math.random() * 360; }
}
function bcrBuildShadeSequence(lightFirst: boolean): string[] {
    const [h, s] = bcrGetBaseHsv(); const steps = 20; const seq: string[] = [];
    for (let i = 0; i < steps; i++) { const t = i / (steps - 1); const l = lightFirst ? 88 - t * 83 : 5 + t * 83; seq.push(bcrHslToHex(h * 360, s * 100, l)); }
    return seq;
}
async function bcrPickNextColor(): Promise<string> {
    const mode = (settings.store.bannerMode ?? "full_random") as BcrCycleMode;
    const R = Math.max(1, Math.min(180, settings.store.bannerHueRadius ?? 35));
    if (mode === "full_random") { if (!bcrRandomBatch.length) bcrRandomBatch = bcrSfShuffle(bcrBuildBatch(32, bcrRandomHex)); return bcrRandomBatch.shift()!; }
    if (mode === "avatar_hue") {
        if (!bcrRandomBatch.length) { const hue = await bcrGetAvatarHue(); bcrRandomBatch = bcrSfShuffle(bcrBuildBatch(32, () => bcrHslToHex(hue + (Math.random() * 2 - 1) * R, 40 + Math.random() * 55, 20 + Math.random() * 50))); }
        return bcrRandomBatch.shift()!;
    }
    if (mode === "mono_cycle") {
        if (bcrMonoBaseHue === null || !bcrRandomBatch.length) { const [h] = bcrGetBaseHsv(); bcrMonoBaseHue = h * 360; bcrRandomBatch = bcrSfShuffle(bcrBuildBatch(32, () => bcrHslToHex(bcrMonoBaseHue!, 25 + Math.random() * 70, 10 + Math.random() * 75))); }
        return bcrRandomBatch.shift()!;
    }
    if (mode === "warm") { if (!bcrRandomBatch.length) bcrRandomBatch = bcrSfShuffle(bcrBuildBatch(32, () => bcrHslToHex(Math.random() * 60, 55 + Math.random() * 45, 20 + Math.random() * 50))); return bcrRandomBatch.shift()!; }
    if (mode === "cool") { if (!bcrRandomBatch.length) bcrRandomBatch = bcrSfShuffle(bcrBuildBatch(32, () => bcrHslToHex(180 + Math.random() * 120, 50 + Math.random() * 50, 20 + Math.random() * 45))); return bcrRandomBatch.shift()!; }
    if (mode === "pastel") { if (!bcrRandomBatch.length) bcrRandomBatch = bcrSfShuffle(bcrBuildBatch(32, () => bcrHslToHex(Math.random() * 360, 25 + Math.random() * 35, 70 + Math.random() * 18))); return bcrRandomBatch.shift()!; }
    if (mode === "dark") { if (!bcrRandomBatch.length) bcrRandomBatch = bcrSfShuffle(bcrBuildBatch(32, () => bcrHslToHex(Math.random() * 360, 40 + Math.random() * 55, 4 + Math.random() * 16))); return bcrRandomBatch.shift()!; }
    if (mode === "vivid") { if (!bcrRandomBatch.length) bcrRandomBatch = bcrSfShuffle(bcrBuildBatch(32, () => bcrHslToHex(Math.random() * 360, 88 + Math.random() * 12, 38 + Math.random() * 22))); return bcrRandomBatch.shift()!; }
    if (mode === "gradient_walk") {
        if (!bcrGradientState) bcrGradientState = [Math.random() * 360, 50 + Math.random() * 40, 25 + Math.random() * 40];
        bcrGradientState = [(bcrGradientState[0] + 12 + Math.random() * 28) % 360, Math.max(30, Math.min(95, bcrGradientState[1] + (Math.random() - 0.5) * 20)), Math.max(14, Math.min(76, bcrGradientState[2] + (Math.random() - 0.5) * 14))];
        return bcrHslToHex(...bcrGradientState);
    }
    if (mode === "chromatic") {
        if (!bcrSeqBatch.length) { const STEPS = 24; bcrSeqBatch = Array.from({ length: STEPS }, (_, i) => bcrHslToHex((bcrSeqBaseHue + (360 / STEPS) * i) % 360, 75, 42)); bcrSeqBaseHue = (bcrSeqBaseHue + 15) % 360; }
        return bcrSeqBatch.shift()!;
    }
    if (mode === "rgb_loop") {
        if (!bcrSeqBatch.length) { const r2: string[] = Array.from({ length: 8 }, (_, i) => bcrHslToHex(0, 55 + i * 5, 20 + i * 7)); const g2: string[] = Array.from({ length: 8 }, (_, i) => bcrHslToHex(120, 55 + i * 5, 20 + i * 7)); const b2: string[] = Array.from({ length: 8 }, (_, i) => bcrHslToHex(240, 55 + i * 5, 20 + i * 7)); bcrSeqBatch = [...r2, ...g2, ...b2]; }
        return bcrSeqBatch.shift()!;
    }
    if (mode === "complementary") {
        if (!bcrSeqBatch.length) { const h0 = Math.random() * 360; bcrSeqBatch = bcrSfShuffle([...Array.from({ length: 8 }, () => bcrHslToHex(h0 + (Math.random() - 0.5) * 10, 50 + Math.random() * 40, 25 + Math.random() * 40)), ...Array.from({ length: 8 }, () => bcrHslToHex((h0 + 180) % 360 + (Math.random() - 0.5) * 10, 50 + Math.random() * 40, 25 + Math.random() * 40))]); }
        return bcrSeqBatch.shift()!;
    }
    if (mode === "triadic") {
        if (!bcrSeqBatch.length) { const h0 = Math.random() * 360; bcrSeqBatch = bcrSfShuffle([...Array.from({ length: 6 }, () => bcrHslToHex(h0 + (Math.random() - 0.5) * 8, 55 + Math.random() * 35, 28 + Math.random() * 35)), ...Array.from({ length: 6 }, () => bcrHslToHex((h0 + 120) % 360 + (Math.random() - 0.5) * 8, 55 + Math.random() * 35, 28 + Math.random() * 35)), ...Array.from({ length: 6 }, () => bcrHslToHex((h0 + 240) % 360 + (Math.random() - 0.5) * 8, 55 + Math.random() * 35, 28 + Math.random() * 35))]); }
        return bcrSeqBatch.shift()!;
    }
    if (mode === "analogous") {
        if (!bcrRandomBatch.length) { const hue = await bcrGetAvatarHue(); bcrRandomBatch = bcrSfShuffle(bcrBuildBatch(24, () => bcrHslToHex(hue + (Math.random() * 2 - 1) * Math.min(R, 60), 45 + Math.random() * 50, 22 + Math.random() * 48))); }
        return bcrRandomBatch.shift()!;
    }
    if (mode === "earth") {
        if (!bcrRandomBatch.length) bcrRandomBatch = bcrSfShuffle(bcrBuildBatch(32, () => { const h = [25, 32, 40, 50, 20, 15][Math.floor(Math.random() * 6)]; return bcrHslToHex(h + (Math.random() - 0.5) * 14, 30 + Math.random() * 40, 18 + Math.random() * 40); }));
        return bcrRandomBatch.shift()!;
    }
    if (mode === "neon") { if (!bcrRandomBatch.length) bcrRandomBatch = bcrSfShuffle(bcrBuildBatch(32, () => bcrHslToHex(Math.random() * 360, 100, 50 + Math.random() * 12))); return bcrRandomBatch.shift()!; }
    if (mode === "sunset") { if (!bcrRandomBatch.length) bcrRandomBatch = bcrSfShuffle(bcrBuildBatch(32, () => { const h = 0 + Math.random() * 55; return bcrHslToHex(h, 70 + Math.random() * 30, 28 + Math.random() * 38); })); return bcrRandomBatch.shift()!; }
    if (mode === "ocean") { if (!bcrRandomBatch.length) bcrRandomBatch = bcrSfShuffle(bcrBuildBatch(32, () => bcrHslToHex(175 + Math.random() * 50, 50 + Math.random() * 45, 18 + Math.random() * 42))); return bcrRandomBatch.shift()!; }
    if (mode === "shade_light_dark") { if (!bcrSeqBatch.length) { bcrSeqBatch = bcrBuildShadeSequence(true); bcrShadeStep = 0; } const out1 = bcrSeqBatch[bcrShadeStep % bcrSeqBatch.length]; bcrShadeStep++; if (bcrShadeStep >= bcrSeqBatch.length) bcrSeqBatch = []; return out1; }
    if (mode === "shade_dark_light") { if (!bcrSeqBatch.length) { bcrSeqBatch = bcrBuildShadeSequence(false); bcrShadeStep = 0; } const out2 = bcrSeqBatch[bcrShadeStep % bcrSeqBatch.length]; bcrShadeStep++; if (bcrShadeStep >= bcrSeqBatch.length) bcrSeqBatch = []; return out2; }
    if (mode === "shade_oscillate") { if (!bcrSeqBatch.length) { bcrSeqBatch = bcrBuildShadeSequence(true); bcrShadeStep = 0; bcrShadeDir = 1; } const out3 = bcrSeqBatch[Math.max(0, Math.min(bcrSeqBatch.length - 1, bcrShadeStep))]; bcrShadeStep += bcrShadeDir; if (bcrShadeStep >= bcrSeqBatch.length - 1) bcrShadeDir = -1; if (bcrShadeStep <= 0) bcrShadeDir = 1; return out3; }
    if (mode === "favs_sequential") { if (!bcrFavorites.length) return bcrRandomHex(); if (!bcrSeqBatch.length) bcrSeqBatch = [...bcrFavorites]; return bcrSeqBatch.shift()!; }
    if (mode === "favorites_only") return bcrPickFromFavs();
    if (mode === "favorites_mix") { if (bcrFavorites.length && Math.random() < 0.5) return bcrPickFromFavs(); if (!bcrRandomBatch.length) bcrRandomBatch = bcrSfShuffle(bcrBuildBatch(32, bcrRandomHex)); return bcrRandomBatch.shift()!; }
    if (mode === "favorites_hue") { if (bcrFavorites.length && Math.random() < 0.5) return bcrPickFromFavs(); if (!bcrRandomBatch.length) { const hue = await bcrGetAvatarHue(); bcrRandomBatch = bcrSfShuffle(bcrBuildBatch(32, () => bcrHslToHex(hue + (Math.random() * 2 - 1) * R, 40 + Math.random() * 55, 20 + Math.random() * 50))); } return bcrRandomBatch.shift()!; }
    if (mode === "favs_shade") { const base = bcrFavorites.length ? bcrPickFromFavs() : bcrRandomHex(); const [hF, , vF] = bcrHexToHsv(base); const lF = vF * 100; return bcrHslToHex(hF * (180 / Math.PI) || hF, 60 + Math.random() * 35, Math.max(8, Math.min(88, lF + (Math.random() * 2 - 1) * 40))); }
    return bcrRandomHex();
}
async function bcrApplyColor(hex: string): Promise<void> {
    const p = (async () => {
        try {
            await RestAPI.patch({ url: "/users/@me", body: { banner_color: hex } });
            if (!pluginActive) return;
            bcrCurrentColor = hex; bcrOnColorApplied?.(hex);
            if (settings.store.bannerShowToast) Toasts.show({ message: `Banner → ${hex}`, type: Toasts.Type.SUCCESS, id: Toasts.genId() });
            await bcrSaveData();
        } catch (e: any) {
            if (settings.store.bannerShowToast) Toasts.show({ message: `Banner failed: ${e?.body?.message ?? "Unknown"}`, type: Toasts.Type.FAILURE, id: Toasts.genId() });
        }
    })();
    bcrApplyPromise = p;
    await p;
}
async function bcrRotateNext(): Promise<void> { if (!pluginActive || isManualStop || wasInvisible) return; await bcrApplyColor(await bcrPickNextColor()); if (!pluginActive || isManualStop || wasInvisible) return; bcrSchedule(); }
function bcrSchedule() { if (bcrRotatorTimer) clearTimeout(bcrRotatorTimer); if (!pluginActive || isManualStop || wasInvisible) return; bcrRotatorTimer = setTimeout(bcrRotateNext, Math.max(1, settings.store.bannerIntervalSeconds ?? BCR_DEFAULT_S) * 1000); }
function bcrStartRotator(immediate = false) {
    if (!pluginActive) return;
    if (bcrRotatorTimer) clearTimeout(bcrRotatorTimer);
    bcrRandomBatch = []; bcrSeqBatch = []; bcrUsedFavs = []; bcrGradientState = null; bcrMonoBaseHue = null; bcrSeqBaseHue = 0; bcrShadeStep = 0; bcrShadeDir = 1;
    if (immediate) void bcrRotateNext(); else bcrRotatorTimer = setTimeout(bcrRotateNext, Math.max(1, settings.store.bannerIntervalSeconds ?? BCR_DEFAULT_S) * 1000);
}
function bcrStopRotator() { if (bcrRotatorTimer) { clearTimeout(bcrRotatorTimer); bcrRotatorTimer = null; } void bcrSaveData(); }
const bcrSaveData = (): Promise<void> => DataStore.set(BCR_SK, { favorites: bcrFavorites, usedFavs: bcrUsedFavs, wasRunning: bcrRotatorTimer !== null, currentColor: bcrCurrentColor } as BcrStoreData);

const BCR_MODES: { id: BcrCycleMode; emoji: string; label: string; desc: string; needsBase?: boolean; needsHueR?: boolean }[] = [
    { id: "full_random", emoji: "🎲", label: "Full Random", desc: "Any hex, 32-batch no repeats" },
    { id: "avatar_hue", emoji: "🖼", label: "Avatar Hue", desc: "Near your avatar color", needsHueR: true },
    { id: "mono_cycle", emoji: "🔵", label: "Mono Cycle", desc: "All shades of base color", needsBase: true },
    { id: "warm", emoji: "🔥", label: "Warm", desc: "Reds, oranges, yellows" },
    { id: "cool", emoji: "❄️", label: "Cool", desc: "Blues, purples, teals" },
    { id: "pastel", emoji: "🌸", label: "Pastel", desc: "Soft high-lightness tones" },
    { id: "dark", emoji: "🌑", label: "Dark", desc: "Very dark shades" },
    { id: "vivid", emoji: "⚡", label: "Vivid", desc: "High saturation" },
    { id: "gradient_walk", emoji: "🌈", label: "Gradient Walk", desc: "Smooth hue drift" },
    { id: "chromatic", emoji: "🎡", label: "Chromatic", desc: "Full hue wheel sweep" },
    { id: "rgb_loop", emoji: "🔴", label: "RGB Loop", desc: "R→G→B shades" },
    { id: "complementary", emoji: "🔄", label: "Complementary", desc: "Opposite hues 180°" },
    { id: "triadic", emoji: "△", label: "Triadic", desc: "Three hues 120° apart" },
    { id: "analogous", emoji: "〰", label: "Analogous", desc: "Near avatar hue", needsHueR: true },
    { id: "earth", emoji: "🌍", label: "Earth Tones", desc: "Browns, ochres" },
    { id: "neon", emoji: "💡", label: "Neon", desc: "100% saturation" },
    { id: "sunset", emoji: "🌅", label: "Sunset", desc: "Warm reds, golds" },
    { id: "ocean", emoji: "🌊", label: "Ocean", desc: "Deep teals and blues" },
    { id: "shade_light_dark", emoji: "⬛", label: "Shade L→D", desc: "Base light to dark", needsBase: true },
    { id: "shade_dark_light", emoji: "⬜", label: "Shade D→L", desc: "Base dark to light", needsBase: true },
    { id: "shade_oscillate", emoji: "↕️", label: "Shade Oscillate", desc: "Base bouncing L↔D", needsBase: true },
    { id: "favs_sequential", emoji: "📋", label: "Favs Sequential", desc: "Favorites in order" },
    { id: "favorites_only", emoji: "⭐", label: "Favs Only", desc: "Favorites shuffled" },
    { id: "favorites_mix", emoji: "🎨", label: "Favs + Random", desc: "50/50 favs & random" },
    { id: "favorites_hue", emoji: "🎯", label: "Favs + Hue", desc: "Favs or near-avatar hue", needsHueR: true },
    { id: "favs_shade", emoji: "🎭", label: "Favs Shade", desc: "Each fav with shade variation" },
];

function msToLabel(ms: number): string {
    if (!ms) return "";
    const m = Math.round(ms / 60000);
    return m >= 60 ? `${Math.round(m / 60)}h` : `${m}m`;
}
function minutesToMs(raw: string): number {
    const n = parseFloat(raw);
    return isNaN(n) || n <= 0 ? 0 : Math.round(n * 60000);
}

type StatusType = "online" | "idle" | "dnd" | "invisible" | "auto";
const STATUS_OPTIONS: { value: StatusType; label: string; color: string; hint: string }[] = [
    { value: "online", label: "Online", color: "#23a55a", hint: "Sets your presence to Online - you appear active and available to everyone." },
    { value: "idle", label: "Idle", color: "#f0b232", hint: "Sets your presence to Idle - shows you as away (crescent moon icon)." },
    { value: "dnd", label: "DND", color: "#f23f43", hint: "Do Not Disturb - suppresses all notifications and marks you as busy." },
    { value: "invisible", label: "Invis", color: "#80848e", hint: "Invisible - you appear fully offline to others while still using Discord." },
    { value: "auto", label: "Auto", color: "#9c67ff", hint: "Auto - keeps your current presence unchanged; only updates the status text/emoji." },
];

type NickMode = "custom" | "global" | "both";
const NM_NEXT: Record<NickMode, NickMode> = { custom: "global", global: "both", both: "custom" };
const NM_LABEL: Record<NickMode, string> = { custom: "Custom", global: "Global", both: "Both" };
const NM_COLOR: Record<NickMode, string> = { custom: "#9575cd", global: "#4dd0e1", both: "#f48fb1" };

const C = {
    status: "#4caf50", clan: "#42a5f5", bio: "#ce93d8", pronoun: "#f48fb1",
    nick: "#4dd0e1", data: "#ffa726", enabled: "#66bb6a", text: "#f0eaff",
    hint: "#9e9e9e", muted: "#5a4a7a", del: "#ef9a9a",
};
const ACT = "#43a047";
const INACT = "#e53935";

interface GuildEntry {
    id: string; name: string; nicks: string[]; enabled: boolean; seqIndex: number;
    manual: boolean; nickMode: NickMode; lastNickVal?: string | null;
    guildPronouns: string[]; guildPronounsEnabled: boolean;
    guildPronounsSeqIdx: number; guildPronounsLastVal: string | null;
    guildPronounsMode: NickMode; voiceActivated: boolean;
    nickVoiceEnabled: boolean;
    pronounsVoiceEnabled: boolean;
}
interface StatusEntry {
    emojiName: string | null; emojiId: string | null; text: string;
    animated?: boolean; status?: StatusType; preset?: string;
    clearAfter?: number;
}
interface StatusPreset { id: string; name: string; clearAfter?: number; }
interface StoreData {
    createdAt: string; globalNicks: string[]; guilds: GuildEntry[];
    bioEntries: string[]; pronounsList: string;
    statusEntries: StatusEntry[]; statusPresets: StatusPreset[];
    statuses?: string;
    clanIds: string[];
    statusSeqIdx: number; clanSeqIdx: number; bioSeqIdx: number; prSeqIdx: number;
    statusLastVal?: string | null; clanLastVal?: string | null;
    bioLastVal?: string | null; prLastVal?: string | null;
    globalNickEntries: string[]; globalNickSeqIdx: number; globalNickLastVal?: string | null;
    globalGuildPronouns: string[];
    clanServerNames?: Record<string, { name: string; tag: string | null }>;
}

let storeCreatedAt = "";
let globalNicks: string[] = [];
let guilds: GuildEntry[] = [];
let bioEntries: string[] = [];
let pronounsList = "";
let statusEntries: StatusEntry[] = [];
let statusPresets: StatusPreset[] = [];
let clanIds: string[] = [];
let clanServerNames: Record<string, { name: string; tag: string | null }> = {};
let statusSeqIdx = 0; let clanSeqIdx = 0; let bioSeqIdx = 0; let prSeqIdx = 0;
let statusLastVal: string | null = null;
let clanLastVal: string | null = null;
let bioLastVal: string | null = null;
let prLastVal: string | null = null;
let globalNickEntries: string[] = [];
let globalNickSeqIdx = 0;
let globalNickLastVal: string | null = null;
let globalGuildPronouns: string[] = [];

let cachedToken: any = null; let cachedGuildStore: any = null;
let cachedClanGuilds: string[] = []; let lastClanFetch = 0;
const domTagCache = new Map<string, string>();
const nickTimers = new Map<string, ReturnType<typeof setTimeout>>();
const guildPronounsTimers = new Map<string, ReturnType<typeof setTimeout>>();
let statusTimer: ReturnType<typeof setTimeout> | null = null;
let clanTimer: ReturnType<typeof setTimeout> | null = null;
let clanAbortCtrl: AbortController | null = null;
let bcrApplyPromise: Promise<void> = Promise.resolve();
let bioTimer: ReturnType<typeof setTimeout> | null = null;
let pronounsTimer: ReturnType<typeof setTimeout> | null = null;
let globalNickTimer: ReturnType<typeof setTimeout> | null = null;
let globalSyncTimer: ReturnType<typeof setTimeout> | null = null;
let lastGlobalNickApply = 0;
const GLOBAL_NICK_MIN_MS = 429000;
let pluginActive = false;
let voiceCheckInterval: ReturnType<typeof setInterval> | null = null;
let lastVoiceGuildId: string | null = null;
let cachedVoiceStateStore: any = null;
let cachedChannelStore: any = null;
let globalStopTimer: ReturnType<typeof setTimeout> | null = null;
let globalStopEndTime: number | null = null;
let isManualStop = false;
let invisibleWatchInterval: ReturnType<typeof setInterval> | null = null;
let wasInvisible = false;
let cachedPresenceStore: any = null;
const sleepTimers = new Map<ReturnType<typeof setTimeout>, () => void>();

function rsSleep(ms: number): Promise<void> {
    return new Promise(resolve => {
        const timeout = setTimeout(() => {
            sleepTimers.delete(timeout);
            resolve();
        }, ms);
        sleepTimers.set(timeout, resolve);
    });
}

function clearSleepTimers() {
    for (const [timeout, resolve] of sleepTimers) {
        clearTimeout(timeout);
        resolve();
    }
    sleepTimers.clear();
}

let closeStatusEnabled = false;
let closeStatusText = "";
let closeStatusEmoji = "";
let closeStatusType: StatusType = "auto";
let closeClanEnabled = false;
let closeClanId = "";
let closeBannerEnabled = false;
let closeBannerColor = "#111214";

const saveCloseConfig = () => {
    const cfg = { closeStatusEnabled, closeStatusText, closeStatusEmoji, closeStatusType, closeClanEnabled, closeClanId, closeBannerEnabled, closeBannerColor };
    DataStore.set(RS_CLOSE_SK, cfg);
    try { localStorage.setItem(RS_CLOSE_LS, JSON.stringify(cfg)); } catch {}
};

async function applyOnCloseAll(): Promise<void> {
    if (closeStatusEnabled) {
        const raw = closeStatusText.trim(); const emojiRaw = closeStatusEmoji.trim();
        if (raw || emojiRaw) {
            const parsed = parseDiscordEmoji(emojiRaw + (raw ? " " + raw : ""));
            void applyStatus({ ...parsed, status: closeStatusType === "auto" ? undefined : closeStatusType, clearAfter: undefined });
        }
    }
    if (closeClanEnabled) {
        const id = closeClanId.trim();
        if (id && /^\d{17,20}$/.test(id)) void applyClan(id);
    }
    if (closeBannerEnabled) {
        try {
            if (settings.store.bannerNitroCheck && arHasNitro()) {}
            else {
                const hex = closeBannerColor.trim();
                if (bcrIsValidHex(hex)) { await bcrApplyPromise.catch(() => {}); void bcrApplyColor(hex); }
            }
        } catch {}
    }
}

function loadCloseConfigSync(): void {
    try {
        const raw = localStorage.getItem(RS_CLOSE_LS);
        if (!raw) return;
        const c = JSON.parse(raw);
        closeStatusEnabled = c.closeStatusEnabled ?? false;
        closeStatusText = c.closeStatusText ?? "";
        closeStatusEmoji = c.closeStatusEmoji ?? "";
        closeStatusType = c.closeStatusType ?? "auto";
        closeClanEnabled = c.closeClanEnabled ?? false;
        closeClanId = c.closeClanId ?? "";
        closeBannerEnabled = c.closeBannerEnabled ?? false;
        closeBannerColor = c.closeBannerColor ?? "#111214";
    } catch {}
}

function fireCloseKeepalive(): void {
    const token = getToken(); if (!token) return;
    const hdrs = { "authorization": token, "content-type": "application/json", "x-discord-locale": "en-US", "x-discord-timezone": "UTC" };
    if (closeStatusEnabled) {
        const raw = closeStatusText.trim(); const emojiRaw = closeStatusEmoji.trim();
        if (raw || emojiRaw) {
            const parsed = parseDiscordEmoji(emojiRaw + (raw ? " " + raw : ""));
            fetch("https://discord.com/api/v9/users/@me/settings", { method: "PATCH", keepalive: true, headers: hdrs,
                body: JSON.stringify({ custom_status: { text: parsed.text || null, emoji_name: parsed.emojiName ?? null, emoji_id: parsed.emojiId ?? null, expires_at: null } }) });
            if (closeStatusType && closeStatusType !== "auto")
                fetch("https://discord.com/api/v9/users/@me/settings", { method: "PATCH", keepalive: true, headers: hdrs, body: JSON.stringify({ status: closeStatusType }) });
        }
    }
    if (closeClanEnabled) {
        const id = closeClanId.trim();
        if (id && /^\d{17,20}$/.test(id))
            fetch("https://discord.com/api/v9/users/@me/clan", { method: "PUT", keepalive: true, headers: hdrs, body: JSON.stringify({ identity_enabled: true, identity_guild_id: id }) });
    }
    if (closeBannerEnabled) {
        try {
            if (settings.store.bannerNitroCheck && arHasNitro()) {}
            else { const hex = closeBannerColor.trim(); if (bcrIsValidHex(hex)) fetch("https://discord.com/api/v9/users/@me", { method: "PATCH", keepalive: true, headers: hdrs, body: JSON.stringify({ banner_color: hex }) }); }
        } catch {}
    }
}

function rsBeforeUnloadHandler() { loadCloseConfigSync(); void applyOnCloseAll(); fireCloseKeepalive(); }

async function applyCloseStatus(): Promise<void> {
    if (!closeStatusEnabled) return;
    const raw = closeStatusText.trim();
    const emojiRaw = closeStatusEmoji.trim();
    if (!raw && !emojiRaw) return;
    const parsed = parseDiscordEmoji(emojiRaw + (raw ? " " + raw : ""));
    const entry: StatusEntry = {
        ...parsed,
        status: closeStatusType === "auto" ? undefined : closeStatusType,
        clearAfter: undefined,
    };
    await applyStatus(entry);
}

async function applyCloseBanner(): Promise<void> {
    if (!closeBannerEnabled) return;
    const hex = closeBannerColor.trim();
    if (!bcrIsValidHex(hex)) return;
    await bcrApplyColor(hex);
}

async function applyCloseClan(): Promise<void> {
    if (!closeClanEnabled) return;
    const id = closeClanId.trim();
    if (!id || !/^\d{17,20}$/.test(id)) return;
    await applyClan(id);
}

function fireCloseStatus(): void {
    if (!closeStatusEnabled) return;
    const raw = closeStatusText.trim();
    const emojiRaw = closeStatusEmoji.trim();
    if (!raw && !emojiRaw) return;
    const parsed = parseDiscordEmoji(emojiRaw + (raw ? " " + raw : ""));
    const token = getToken();
    if (!token) return;
    fetch("https://discord.com/api/v9/users/@me/settings", {
        method: "PATCH", keepalive: true,
        headers: { "authorization": token, "content-type": "application/json" },
        body: JSON.stringify({ custom_status: { text: parsed.text || null, emoji_name: parsed.emojiName ?? null, emoji_id: parsed.emojiId ?? null, expires_at: null } })
    });
    if (closeStatusType && closeStatusType !== "auto")
        fetch("https://discord.com/api/v9/users/@me/settings", {
            method: "PATCH", keepalive: true,
            headers: { "authorization": token, "content-type": "application/json" },
            body: JSON.stringify({ status: closeStatusType })
        });
}

function fireCloseClan(): void {
    if (!closeClanEnabled) return;
    const id = closeClanId.trim();
    if (!id || !/^\d{17,20}$/.test(id)) return;
    const token = getToken();
    if (!token) return;
    fetch("https://discord.com/api/v9/users/@me/clan", {
        method: "PUT", keepalive: true,
        headers: { "authorization": token, "content-type": "application/json", "x-discord-locale": "en-US", "x-discord-timezone": "UTC" },
        body: JSON.stringify({ identity_enabled: true, identity_guild_id: id })
    });
}

function fireCloseBanner(): void {
    if (!closeBannerEnabled) return;
    const hex = closeBannerColor.trim();
    if (!bcrIsValidHex(hex)) return;
    const token = getToken();
    if (!token) return;
    fetch("https://discord.com/api/v9/users/@me", {
        method: "PATCH", keepalive: true,
        headers: { "authorization": token, "content-type": "application/json" },
        body: JSON.stringify({ banner_color: hex })
    });
}

const saveData = () => DataStore.set(SK, {
    createdAt: storeCreatedAt, globalNicks,
    guilds: guilds.map(g => { const { lastNickVal: _, ...rest } = g as any; return rest; }),
    bioEntries, pronounsList, statusEntries, statusPresets, clanIds,
    statusSeqIdx, clanSeqIdx, bioSeqIdx, prSeqIdx,
    statusLastVal, clanLastVal, bioLastVal, prLastVal,
    globalNickEntries, globalNickSeqIdx, globalNickLastVal,
    globalGuildPronouns, clanServerNames,
} as StoreData);

function parseList(raw: string): string[] { return raw.split("§").map(s => s.trim()).filter(Boolean); }
function reorder<T>(arr: T[], from: number, to: number): T[] {
    const r = [...arr]; const [x] = r.splice(from, 1); r.splice(to, 0, x); return r;
}
function colorFor(id: string): string {
    let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
}
function getMs(sec: string): number { return Math.max(1000, (parseFloat(sec) || 30) * 1000); }

function pickItem<T>(list: T[], idx: number, rnd: boolean, lastVal: T | null | undefined): { val: T | null; next: number; lastPicked: T | null } {
    if (!list.length) return { val: null, next: idx, lastPicked: lastVal ?? null };
    if (!rnd) { const i = idx % list.length; return { val: list[i], next: idx + 1, lastPicked: list[i] }; }
    if (list.length === 1) return { val: list[0], next: idx, lastPicked: list[0] };
    if (settings.store.noDuplicateRandom && lastVal != null) {
        const pool = list.filter(v => v !== lastVal);
        if (pool.length > 0) { const v = pool[Math.floor(Math.random() * pool.length)]; return { val: v, next: idx, lastPicked: v }; }
    }
    const v = list[Math.floor(Math.random() * list.length)];
    return { val: v, next: idx, lastPicked: v };
}

function getToken(): string | null { if (!cachedToken) cachedToken = findByProps("getToken"); return cachedToken?.getToken?.() ?? null; }
function getGuildStore() { if (!cachedGuildStore) cachedGuildStore = findByProps("getGuilds"); return cachedGuildStore; }
function getDiscordGuilds(): { id: string; name: string }[] {
    try { return Object.values(getGuildStore()?.getGuilds?.() ?? {}).map((x: any) => ({ id: x.id, name: x.name })); }
    catch { return []; }
}
function syncGuildsFromDiscord() {
    for (const { id, name } of getDiscordGuilds())
        if (!guilds.find(g => g.id === id))
            guilds.push({ id, name, nicks: [], enabled: false, seqIndex: 0, manual: false, nickMode: "both", guildPronouns: [], guildPronounsEnabled: false, guildPronounsSeqIdx: 0, guildPronounsLastVal: null, guildPronounsMode: "both", voiceActivated: false, nickVoiceEnabled: false, pronounsVoiceEnabled: false });
}

function nickModeOf(g: GuildEntry): NickMode { return g.nickMode ?? ((g as any).useGlobal ? "global" : "custom"); }
function nicksForGuild(g: GuildEntry): string[] {
    const m = nickModeOf(g);
    if (m === "global") return globalNicks;
    if (m === "both") return [...new Set([...globalNicks, ...g.nicks])];
    return g.nicks.length ? g.nicks : globalNicks;
}

async function applyNick(guildId: string, nick: string): Promise<number | null> {
    try {
        await RestAPI.patch({ url: `/guilds/${guildId}/members/@me`, body: { nick } });
        if (settings.store.enableLogs) console.log(`[RS/Nick] [${guildId}] -> "${nick}"`);
        return null;
    } catch (err: any) {
        const st = err?.status ?? err?.response?.status ?? 0;
        if (st === 429) {
            const ra = Math.max(parseFloat(err?.body?.retry_after ?? err?.retry_after ?? "5") || 5, 1);
            if (settings.store.enableLogs) console.warn(`[RS/Nick] 429 retry ${ra}s`);
            return ra;
        }
        if (settings.store.enableLogs) console.error("[RS/Nick] err:", err);
        return null;
    }
}

function scheduleNickTick(g: GuildEntry, ms: number) {
    nickTimers.set(g.id, setTimeout(async () => {
        if (!pluginActive || !g.enabled || !settings.store.nickEnabled || !nickTimers.has(g.id)) return;
        if (g.voiceActivated && settings.store.voiceActivateEnabled && !settings.store.voiceActivateGlobal) {
            if (getMyVoiceGuildId() !== g.id) { nickTimers.delete(g.id); return; }
        }
        const nks = nicksForGuild(g);
        if (!nks.length) { nickTimers.delete(g.id); return; }
        if (g.seqIndex < 0 || g.seqIndex > nks.length * 2) g.seqIndex = 0;
        const { val: nick, next, lastPicked } = pickItem(nks, g.seqIndex, settings.store.nickRandomize, g.lastNickVal);
        g.seqIndex = next; g.lastNickVal = lastPicked;
        if (nick) {
            const retry = await applyNick(g.id, nick);
            if (!pluginActive || !g.enabled || !nickTimers.has(g.id)) return;
            if (retry !== null) {
                nickTimers.set(g.id, setTimeout(() => {
                    if (pluginActive && g.enabled && nickTimers.has(g.id))
                        scheduleNickTick(g, getMs(settings.store.nickIntervalSeconds));
                }, retry * 1000 + 429));
                return;
            }
        }
        saveData();
        if (!settings.store.globalSync) scheduleNickTick(g, getMs(settings.store.nickIntervalSeconds));
        else nickTimers.delete(g.id);
    }, ms));
}
function startNickGuild(g: GuildEntry) {
    if (!nickTimers.has(g.id) && !settings.store.globalSync && settings.store.nickEnabled)
        scheduleNickTick(g, getMs(settings.store.nickIntervalSeconds));
}
function stopNickGuild(id: string) { const t = nickTimers.get(id); if (t) { clearTimeout(t); nickTimers.delete(id); } }
function stopAllNicks() { [...nickTimers.keys()].forEach(stopNickGuild); }
function tickAllNicks() {
    if (!settings.store.nickEnabled) return;
    const vcGuildId = (settings.store.voiceActivateEnabled && !settings.store.voiceActivateGlobal)
        ? getMyVoiceGuildId() : null;
    for (const g of guilds.filter(x => x.enabled)) {
        if (g.voiceActivated && settings.store.voiceActivateEnabled && !settings.store.voiceActivateGlobal) {
            if (vcGuildId !== g.id) continue;
        }
        const nks = nicksForGuild(g);
        if (!nks.length) continue;
        if (g.seqIndex < 0 || g.seqIndex > nks.length * 2) g.seqIndex = 0;
        const { val: nick, next, lastPicked } = pickItem(nks, g.seqIndex, settings.store.nickRandomize, g.lastNickVal);
        g.seqIndex = next; g.lastNickVal = lastPicked;
        if (nick) applyNick(g.id, nick);
    }
}

function pronounsForGuild(g: GuildEntry): string[] {
    const m: NickMode = g.guildPronounsMode ?? "custom";
    if (m === "global") return globalGuildPronouns;
    if (m === "both") return [...new Set([...globalGuildPronouns, ...(g.guildPronouns ?? [])])];
    const local = g.guildPronouns ?? [];
    return local.length > 0 ? local : globalGuildPronouns;
}

function scheduleGuildPronounsTick(g: GuildEntry, ms: number) {
    const tid = setTimeout(async () => {
        if (guildPronounsTimers.get(g.id) !== tid) return;
        guildPronounsTimers.delete(g.id);
        if (!pluginActive || !g.guildPronounsEnabled || !settings.store.serverPronounsEnabled) return;
        if (g.voiceActivated && settings.store.voiceActivateEnabled && !settings.store.voiceActivateGlobal) {
            if (getMyVoiceGuildId() !== g.id) return;
        }
        const pool = pronounsForGuild(g);
        if (!pool.length) return;
        const { val: pr, next, lastPicked } = pickItem(pool, g.guildPronounsSeqIdx ?? 0, settings.store.serverPronounsRandomize, g.guildPronounsLastVal);
        g.guildPronounsSeqIdx = next; g.guildPronounsLastVal = lastPicked;
        if (pr) await applyGuildPronoun(g.id, pr);
        saveData();
        if (pluginActive && g.guildPronounsEnabled && settings.store.serverPronounsEnabled && !settings.store.globalSync && !guildPronounsTimers.has(g.id))
            scheduleGuildPronounsTick(g, getMs(settings.store.serverPronounsIntervalSeconds));
    }, ms) as ReturnType<typeof setTimeout>;
    guildPronounsTimers.set(g.id, tid);
}
function startGuildPronouns(g: GuildEntry) {
    if (!guildPronounsTimers.has(g.id) && !settings.store.globalSync && g.guildPronounsEnabled && settings.store.serverPronounsEnabled && pronounsForGuild(g).length > 0)
        scheduleGuildPronounsTick(g, getMs(settings.store.serverPronounsIntervalSeconds));
}
function stopGuildPronouns(id: string) { const t = guildPronounsTimers.get(id); if (t) { clearTimeout(t); guildPronounsTimers.delete(id); } }
function stopAllGuildPronouns() { [...guildPronounsTimers.keys()].forEach(stopGuildPronouns); }
function tickAllGuildPronouns() {
    if (!settings.store.serverPronounsEnabled) return;
    const vcGuildId = (settings.store.voiceActivateEnabled && !settings.store.voiceActivateGlobal)
        ? getMyVoiceGuildId() : null;
    for (const g of guilds.filter(x => x.guildPronounsEnabled && pronounsForGuild(x).length > 0)) {
        if (g.voiceActivated && settings.store.voiceActivateEnabled && !settings.store.voiceActivateGlobal) {
            if (vcGuildId !== g.id) continue;
        }
        const pool = pronounsForGuild(g);
        const { val: pr, next, lastPicked } = pickItem(pool, g.guildPronounsSeqIdx ?? 0, settings.store.serverPronounsRandomize, g.guildPronounsLastVal);
        g.guildPronounsSeqIdx = next; g.guildPronounsLastVal = lastPicked;
        if (pr) applyGuildPronoun(g.id, pr);
    }
}

function parseLegacyStatuses(raw: string): StatusEntry[] {
    return parseList(raw).map(line => {
        const cm = line.match(CUSTOM_EMOJI_RE);
        if (cm) return { emojiName: cm[1], emojiId: cm[2], text: line.slice(cm[0].length).trim() };
        const um = line.match(UNICODE_EMOJI_RE);
        if (um) return { emojiName: um[1], emojiId: null, text: line.slice(um[0].length).trim() };
        return { emojiName: null, emojiId: null, text: line };
    });
}
function parseStatuses(raw: string): StatusEntry[] { return parseLegacyStatuses(raw); }

function parseDiscordEmoji(input: string): Pick<StatusEntry, "text" | "emojiName" | "emojiId" | "animated"> {
    const dm = input.replace(/^\\/, "").match(DISCORD_EMOJI_RE);
    if (dm) return { text: input.replace(DISCORD_EMOJI_RE, "").trim(), emojiName: dm[1], emojiId: dm[2], animated: input.includes("<a:") };
    const cm = input.match(CUSTOM_EMOJI_RE);
    if (cm) return { text: input.slice(cm[0].length).trim(), emojiName: cm[1], emojiId: cm[2], animated: false };
    const um = input.match(UNICODE_EMOJI_RE);
    if (um) return { text: input.slice(um[0].length).trim(), emojiName: um[1], emojiId: null, animated: false };
    return { text: input, emojiName: null, emojiId: null, animated: false };
}

function statusKey(e: StatusEntry): string { return `${e.emojiId ?? ""}|${e.emojiName ?? ""}|${e.text}`; }

const RS_EVAL = "eval ";
async function resolveField(value: string): Promise<string> {
    if (!value.startsWith(RS_EVAL)) return value;
    try {
        const _eval = globalThis.eval;
        const result = _eval(value.slice(RS_EVAL.length));
        return String(result ?? "");
    } catch (e: any) {
        if (settings.store.enableLogs) console.error("[RS/eval]", e?.message ?? e);
        return "";
    }
}
async function resolveStatusEntry(entry: StatusEntry): Promise<StatusEntry> {
    const [text, emojiName] = await Promise.all([
        resolveField(entry.text ?? ""),
        entry.emojiName ? resolveField(entry.emojiName) : Promise.resolve(entry.emojiName),
    ]);
    return { ...entry, text, emojiName: emojiName as string | null };
}

const CustomStatusSetting = getUserSettingLazy<{ text: string; emojiId: string; emojiName: string; expiresAtMs: string; createdAtMs: string }>("status", "customStatus");
const PresenceSetting = getUserSettingLazy<string>("status", "status");

async function applyStatus(entry: StatusEntry, retries = 3): Promise<void> {
    const clearMs = entry.clearAfter ?? 0;
    const expiresAtMs = clearMs > 0 ? String(Date.now() + clearMs) : "0";
    const expiresAtIso = clearMs > 0 ? new Date(Date.now() + clearMs).toISOString() : null;
    if (CustomStatusSetting) {
        try {
            await CustomStatusSetting.updateSetting({
                text: entry.text || "",
                emojiName: entry.emojiName ?? "",
                emojiId: entry.emojiId ?? "0",
                createdAtMs: Date.now().toString(),
                expiresAtMs,
            });
            if (entry.status && entry.status !== "auto" && PresenceSetting) await PresenceSetting.updateSetting(entry.status);
            if (settings.store.enableLogs) console.log(`[RS/Status] -> "${entry.text}" [${entry.status ?? "auto"}]`);
            return;
        } catch (e: any) {
            const st = e?.status ?? e?.response?.status ?? 0;
            if (st === 429) return;
            if (settings.store.enableLogs) console.warn("[RS/Status] UserSetting fallback RestAPI:", e);
        }
    }
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            await RestAPI.patch({
                url: "/users/@me/settings",
                body: { custom_status: { text: entry.text || null, emoji_name: entry.emojiName, emoji_id: entry.emojiId, expires_at: expiresAtIso } }
            });
            if (settings.store.enableLogs) console.log(`[RS/Status] -> "${entry.text}" attempt=${attempt + 1}`);
            return;
        } catch (e: any) {
            const st = e?.status ?? e?.response?.status ?? 0;
            if (st === 429) {
                const ra = Math.max(parseFloat(e?.body?.retry_after ?? e?.retry_after ?? "3") || 3, 1);
                await rsSleep(ra * 1000 + 200);
                if (!pluginActive) return;
                continue;
            }
            if (settings.store.enableLogs) console.error(`[RS/Status] attempt=${attempt + 1} err:`, e);
            if (attempt < retries - 1) {
                await rsSleep(1500);
                if (!pluginActive) return;
            }
        }
    }
}

function getActiveStatusPool(): StatusEntry[] {
    const mode = settings.store.statusRunMode as "all" | "presets" | "none";
    if (mode === "none") return [];
    if (mode !== "presets") return statusEntries;
    try {
        const sel: string[] = JSON.parse(settings.store.statusSelectedPresets || "[]");
        if (!sel.length) return statusEntries;
        return statusEntries.filter(e => e.preset && sel.includes(e.preset));
    } catch { return statusEntries; }
}

function isEvalEntry(e: StatusEntry): boolean {
    return !!(e.text?.startsWith("eval ") || e.emojiName?.startsWith("eval "));
}

function tickStatus() {
    if (!settings.store.statusEnabled) return;
    const pool = getActiveStatusPool();
    if (!pool.length) return;
    if (pool.length === 1 && isEvalEntry(pool[0])) {
        resolveStatusEntry(pool[0]).then(resolved => applyStatus(resolved));
        return;
    }
    const { val: entry, next, lastPicked } = pickItem(pool, statusSeqIdx, settings.store.statusRandomize, pool.find(e => statusKey(e) === statusLastVal) ?? null);
    statusSeqIdx = next; statusLastVal = lastPicked ? statusKey(lastPicked) : null;
    if (entry) resolveStatusEntry(entry).then(resolved => applyStatus(resolved));
}

function scheduleStatusLoop() {
    if (statusTimer !== null) return;
    statusTimer = setTimeout(() => {
        statusTimer = null;
        if (!pluginActive || settings.store.globalSync) return;
        tickStatus(); saveData();
        if (settings.store.statusEnabled) scheduleStatusLoop();
    }, getMs(settings.store.statusIntervalSeconds));
}
function stopStatusTimer() { if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; } }

function getActiveClanIds(): string[] {
    if (!settings.store.clanAutoDetect) return clanIds;
    const refreshMs = Math.max(10000, (parseFloat(settings.store.clanAutoDetectRefreshSeconds) || 180) * 1000);
    const now = Date.now();
    if (!cachedClanGuilds.length || now - lastClanFetch >= refreshMs) {
        cachedClanGuilds = getDiscordGuilds().map(g => g.id); lastClanFetch = now;
        if (settings.store.enableLogs) console.log(`[RS/Clan] Auto-detect: ${cachedClanGuilds.length} guilds`);
    }
    return cachedClanGuilds;
}

async function applyClan(id: string, retries = 4, signal?: AbortSignal): Promise<void> {
    const token = getToken(); if (!token) return;
    for (let attempt = 0; attempt < retries; attempt++) {
        if (signal?.aborted) return;
        try {
            const res = await fetch("https://discord.com/api/v9/users/@me/clan", {
                method: "PUT",
                headers: { "authorization": token, "content-type": "application/json", "x-discord-locale": "en-US", "x-discord-timezone": "UTC" },
                body: JSON.stringify({ identity_enabled: true, identity_guild_id: id }),
                signal,
            });
            if (signal?.aborted) return;
            if (res.ok) { if (settings.store.enableLogs) console.log(`[RS/Clan] -> ${id} attempt=${attempt + 1}`); return; }
            if (res.status === 300) {
                const json = await res.json().catch(() => ({}));
                if (signal?.aborted) return;
                const ra = Math.max((json?.retry_after ?? 3), 1);
                await rsSleep(ra * 1000 + 300);
                if (signal?.aborted || !pluginActive) return;
                continue;
            }
            if (settings.store.enableLogs) console.error(`[RS/Clan] HTTP ${res.status} attempt=${attempt + 1}`);
            if (attempt < retries - 1) {
                await rsSleep(1500);
                if (signal?.aborted || !pluginActive) return;
            }
        } catch (e) {
            if (signal?.aborted) return;
            if (settings.store.enableLogs) console.error(`[RS/Clan] attempt=${attempt + 1} err:`, e);
            if (attempt < retries - 1) {
                await rsSleep(1500);
                if (signal?.aborted || !pluginActive) return;
            }
        }
    }
}

function tickClan() {
    if (!settings.store.clanEnabled || !pluginActive || isManualStop || wasInvisible) return;
    const list = getActiveClanIds(); if (!list.length) return;
    const { val: id, next, lastPicked } = pickItem(list, clanSeqIdx, settings.store.clanRandomize, clanLastVal);
    clanSeqIdx = next; clanLastVal = lastPicked;
    if (id) {
        if (clanAbortCtrl) clanAbortCtrl.abort();
        clanAbortCtrl = new AbortController();
        applyClan(id, 4, clanAbortCtrl.signal);
    }
}

function scheduleClanLoop() {
    if (clanTimer !== null) return;
    clanTimer = setTimeout(() => {
        clanTimer = null;
        if (!pluginActive || isManualStop || wasInvisible) return;
        tickClan(); saveData();
        if (settings.store.clanEnabled) scheduleClanLoop();
    }, getMs(settings.store.clanIntervalSeconds));
}
function stopClanTimer() {
    if (clanTimer) { clearTimeout(clanTimer); clanTimer = null; }
    if (clanAbortCtrl) { clanAbortCtrl.abort(); clanAbortCtrl = null; }
}

async function patchProfile(body: Record<string, string>) {
    try {
        await RestAPI.patch({ url: "/users/@me/profile", body });
        if (settings.store.enableLogs) console.log("[RS/Profile] ->", body);
    } catch (e: any) { if (settings.store.enableLogs) console.error("[RS/Profile]:", e); }
}

async function applyGlobalNick(displayName: string, retries = 3): Promise<void> {
    for (let attempt = 0; attempt < retries; attempt++) {
        if (!pluginActive) return;
        try {
            await RestAPI.patch({ url: "/users/@me", body: { global_name: displayName } });
            if (settings.store.enableLogs) console.log(`[RS/GlobalNick] -> "${displayName}"`);
            return;
        } catch (e: any) {
            const st = e?.status ?? e?.response?.status ?? 0;
            if (st === 429) {
                const ra = Math.max(parseFloat(e?.body?.retry_after ?? e?.retry_after ?? "300") || 300, 10);
                if (settings.store.enableLogs) console.warn(`[RS/GlobalNick] 429 retry ${ra}s`);
                await rsSleep(ra * 1000 + 500);
                if (!pluginActive) return;
                continue;
            }
            if (settings.store.enableLogs) console.error(`[RS/GlobalNick] attempt=${attempt + 1}:`, e);
            if (attempt < retries - 1) {
                await rsSleep(2000);
                if (!pluginActive) return;
            }
        }
    }
}

async function applyGuildPronoun(guildId: string, pronouns: string): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            await RestAPI.patch({ url: `/users/@me/guilds/${guildId}/profile`, body: { pronouns } });
            if (settings.store.enableLogs) console.log(`[RS/GuildPronouns] [${guildId}] -> "${pronouns}"`);
            return;
        } catch (e: any) {
            const st = e?.status ?? e?.response?.status ?? 0;
            if (st === 300) {
                const ra = Math.max(parseFloat(e?.body?.retry_after ?? e?.retry_after ?? "5") || 5, 1);
                if (settings.store.enableLogs) console.warn(`[RS/GuildPronouns] 429 [${guildId}] retry ${ra}s`);
                await rsSleep(ra * 1000 + 300);
                if (!pluginActive) return;
                continue;
            }
            if (st === 403 || st === 404) {
                if (settings.store.enableLogs) console.warn(`[RS/GuildPronouns] [${guildId}] HTTP ${st} - server pronouns not supported for this server`);
                return;
            }
            if (settings.store.enableLogs) console.error("[RS/GuildPronouns]:", e);
            return;
        }
    }
}

function tickBio() {
    if (!settings.store.profileBioEnabled || !bioEntries.length) return;
    const { val, next, lastPicked } = pickItem(bioEntries, bioSeqIdx, settings.store.bioRandomize, bioLastVal);
    bioSeqIdx = next; bioLastVal = lastPicked;
    if (val) patchProfile({ bio: val });
}
function scheduleBioLoop() {
    if (bioTimer !== null) return;
    bioTimer = setTimeout(() => {
        bioTimer = null;
        if (!pluginActive || settings.store.globalSync) return;
        tickBio(); saveData();
        if (settings.store.profileBioEnabled) scheduleBioLoop();
    }, getMs(settings.store.bioIntervalSeconds));
}
function stopBioTimer() { if (bioTimer) { clearTimeout(bioTimer); bioTimer = null; } }

function tickPronouns() {
    if (!settings.store.profilePronounsEnabled) return;
    const pList = parseList(pronounsList);
    if (!pList.length) return;
    const { val, next, lastPicked } = pickItem(pList, prSeqIdx, settings.store.pronounsRandomize, prLastVal);
    prSeqIdx = next; prLastVal = lastPicked;
    if (val) patchProfile({ pronouns: val });
}
function schedulePronounsLoop() {
    if (pronounsTimer !== null) return;
    pronounsTimer = setTimeout(() => {
        pronounsTimer = null;
        if (!pluginActive || settings.store.globalSync) return;
        tickPronouns(); saveData();
        if (settings.store.profilePronounsEnabled) schedulePronounsLoop();
    }, getMs(settings.store.pronounsIntervalSeconds));
}
function stopPronounsTimer() { if (pronounsTimer) { clearTimeout(pronounsTimer); pronounsTimer = null; } }

function tickGlobalNick() {
    if (!settings.store.globalNickEnabled || !globalNickEntries.length) return;
    const now = Date.now();
    if (now - lastGlobalNickApply < GLOBAL_NICK_MIN_MS) return;
    lastGlobalNickApply = now;
    const { val, next, lastPicked } = pickItem(globalNickEntries, globalNickSeqIdx, settings.store.globalNickRandomize, globalNickLastVal);
    globalNickSeqIdx = next; globalNickLastVal = lastPicked;
    if (val) applyGlobalNick(val);
}
function scheduleGlobalNickLoop() {
    if (globalNickTimer !== null) return;
    const ms = Math.max(429000, getMs(settings.store.globalNickIntervalSeconds));
    globalNickTimer = setTimeout(() => {
        globalNickTimer = null;
        if (!pluginActive || settings.store.globalSync) return;
        tickGlobalNick(); saveData();
        if (settings.store.globalNickEnabled) scheduleGlobalNickLoop();
    }, ms);
}
function stopGlobalNickTimer() { if (globalNickTimer) { clearTimeout(globalNickTimer); globalNickTimer = null; } }

function globalTick() { tickStatus(); tickBio(); tickPronouns(); tickGlobalNick(); tickAllNicks(); tickAllGuildPronouns(); saveData(); }

function scheduleGlobalLoop() {
    if (globalSyncTimer !== null) return;
    globalSyncTimer = setTimeout(() => {
        globalSyncTimer = null;
        if (!pluginActive || !settings.store.globalSync) return;
        globalTick();
        scheduleGlobalLoop();
    }, getMs(settings.store.globalSyncSeconds));
}
function stopGlobalTimer() { if (globalSyncTimer) { clearTimeout(globalSyncTimer); globalSyncTimer = null; } }

function getMyVoiceGuildId(): string | null {
    try {
        const user = UserStore.getCurrentUser(); if (!user) return null;
        if (!cachedVoiceStateStore) cachedVoiceStateStore = findByProps("getVoiceStateForUser", "getVoiceStatesForChannel");
        const state = cachedVoiceStateStore?.getVoiceStateForUser?.(user.id);
        if (!state?.channelId) return null;
        if (!cachedChannelStore) cachedChannelStore = findByProps("getChannel", "getDMFromUserId");
        const ch = cachedChannelStore?.getChannel?.(state.channelId);
        return ch ? (ch.guild_id ?? "DM") : null;
    } catch { return null; }
}

function onVoiceJoin(guildId: string | null) {
    if (!pluginActive || settings.store.globalSync) return;
    if (settings.store.voiceActivateGlobal) {
        if (settings.store.nickEnabled)
            for (const g of guilds.filter(x => x.enabled && !nickTimers.has(x.id)))
                scheduleNickTick(g, getMs(settings.store.nickIntervalSeconds));
        if (settings.store.serverPronounsEnabled)
            for (const g of guilds.filter(x => x.guildPronounsEnabled && pronounsForGuild(x).length > 0 && !guildPronounsTimers.has(x.id)))
                scheduleGuildPronounsTick(g, getMs(settings.store.serverPronounsIntervalSeconds));
        return;
    }
    if (!guildId || guildId === "DM") return;
    const g = guilds.find(x => x.id === guildId && x.voiceActivated);
    if (!g) return;
    if (settings.store.nickEnabled && g.enabled && g.nickVoiceEnabled && !nickTimers.has(g.id))
        scheduleNickTick(g, 300);
    if (g.guildPronounsEnabled && pronounsForGuild(g).length > 0 && settings.store.serverPronounsEnabled && g.pronounsVoiceEnabled && !guildPronounsTimers.has(g.id))
        scheduleGuildPronounsTick(g, 300);
}

function onVoiceLeave(prevGuildId: string | null) {
    if (!pluginActive) return;
    if (settings.store.voiceActivateGlobal) { stopAllNicks(); stopAllGuildPronouns(); return; }
    if (!prevGuildId || prevGuildId === "DM") return;
    const g = guilds.find(x => x.id === prevGuildId && x.voiceActivated);
    if (g) { stopNickGuild(prevGuildId); stopGuildPronouns(prevGuildId); }
}

function startVoiceWatcher() {
    if (voiceCheckInterval !== null) return;
    lastVoiceGuildId = getMyVoiceGuildId();
    if (lastVoiceGuildId) onVoiceJoin(lastVoiceGuildId);
    voiceCheckInterval = setInterval(() => {
        if (!pluginActive) return;
        const curr = getMyVoiceGuildId();
        if (curr === lastVoiceGuildId) return;
        const prev = lastVoiceGuildId; lastVoiceGuildId = curr;
        if (curr && !prev) onVoiceJoin(curr);
        else if (!curr && prev) onVoiceLeave(prev);
        else { onVoiceLeave(prev); onVoiceJoin(curr); }
    }, 2000);
}

function stopVoiceWatcher() {
    if (voiceCheckInterval) { clearInterval(voiceCheckInterval); voiceCheckInterval = null; }
    lastVoiceGuildId = null;
}

function stopAllRotators() {
    stopAllNicks(); stopAllGuildPronouns();
    stopStatusTimer(); stopClanTimer();
    stopBioTimer(); stopPronounsTimer(); stopGlobalNickTimer();
    stopGlobalTimer(); stopVoiceWatcher(); bcrStopRotator(); arStopRotator();
}

function startAllRotators() {
    stopAllRotators();
    if (!pluginActive) return;
    if (isManualStop || wasInvisible) return;
    if (settings.store.avatarEnabled && arGetActive().length) arStartRotator(false);
    if (settings.store.clanEnabled) scheduleClanLoop();
    if (settings.store.globalSync) {
        globalTick(); scheduleGlobalLoop();
    } else {
        if (settings.store.statusEnabled) scheduleStatusLoop();
        if (settings.store.profileBioEnabled) scheduleBioLoop();
        if (settings.store.profilePronounsEnabled) schedulePronounsLoop();
        if (settings.store.globalNickEnabled) scheduleGlobalNickLoop();
        if (!settings.store.voiceActivateGlobal) {
            if (settings.store.nickEnabled)
                for (const g of guilds.filter(x => x.enabled && !x.voiceActivated)) startNickGuild(g);
            for (const g of guilds.filter(x => x.guildPronounsEnabled && !x.voiceActivated && pronounsForGuild(x).length > 0))
                startGuildPronouns(g);
        }
    }
    if (settings.store.voiceActivateEnabled) startVoiceWatcher();
    if (settings.store.bannerEnabled) bcrStartRotator(false);
}

function formatStopDuration(ms: number): string {
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
    return `${Math.round(ms / 3600000)}h`;
}

function doGlobalStop(durationMs: number | null) {
    isManualStop = true;
    stopAllRotators();
    void applyOnCloseAll();
    if (globalStopTimer) { clearTimeout(globalStopTimer); globalStopTimer = null; }
    if (durationMs !== null && durationMs > 0) {
        globalStopEndTime = Date.now() + durationMs;
        globalStopTimer = setTimeout(() => {
            isManualStop = false; globalStopEndTime = null; globalStopTimer = null;
            if (pluginActive && !wasInvisible) startAllRotators();
            Toasts.show({ message: "All Rotators resumed (timer ended)", type: Toasts.Type.SUCCESS, id: Toasts.genId() });
        }, durationMs);
    } else {
        globalStopEndTime = null;
    }
    Toasts.show({ message: durationMs ? `Rotators stopped for ${formatStopDuration(durationMs)}` : "All Rotators stopped", type: Toasts.Type.MESSAGE, id: Toasts.genId() });
}

function doGlobalResume() {
    isManualStop = false;
    if (globalStopTimer) { clearTimeout(globalStopTimer); globalStopTimer = null; }
    globalStopEndTime = null;
    if (pluginActive) startAllRotators();
    Toasts.show({ message: "All Rotators resumed", type: Toasts.Type.SUCCESS, id: Toasts.genId() });
}

function getMyCurrentStatus(): string {
    try {
        if (!cachedPresenceStore) cachedPresenceStore = findByProps("getStatus", "getActivities");
        const user = UserStore.getCurrentUser();
        if (!user) return "unknown";
        return cachedPresenceStore?.getStatus?.(user.id) ?? "unknown";
    } catch { return "unknown"; }
}

function startInvisibleWatcher() {
    if (invisibleWatchInterval !== null) return;
    wasInvisible = getMyCurrentStatus() === "invisible";
    invisibleWatchInterval = setInterval(() => {
        if (!pluginActive || !settings.store.stopOnInvisible) return;
        const nowInvis = getMyCurrentStatus() === "invisible";
        if (nowInvis && !wasInvisible) {
            wasInvisible = true;
            stopAllRotators();
            void applyOnCloseAll();
            Toasts.show({ message: "Invisible detected - Rotators paused", type: Toasts.Type.MESSAGE, id: Toasts.genId() });
        } else if (!nowInvis && wasInvisible) {
            wasInvisible = false;
            if (!isManualStop && pluginActive) startAllRotators();
            Toasts.show({ message: "Status visible - Rotators resumed", type: Toasts.Type.SUCCESS, id: Toasts.genId() });
        }
    }, 3000);
}

function stopInvisibleWatcher() {
    if (invisibleWatchInterval) { clearInterval(invisibleWatchInterval); invisibleWatchInterval = null; }
    wasInvisible = false;
}

function startNitroWatcher() {
    stopNitroWatcher();
    if (!settings.store.bannerNitroCheck) return;
    let bcrWasStopped = false;
    const check = () => {
        if (!pluginActive || !settings.store.bannerNitroCheck) return;
        if (arHasNitro()) {
            if (!bcrWasStopped && bcrRotatorTimer !== null) {
                bcrWasStopped = true;
                bcrStopRotator();
                (settings.store as any).bannerEnabled = false;
                arToast("Nitro detected - ColorBanner paused. Disable Nitro Check in Banner tab to override.", Toasts.Type.FAILURE);
            }
        } else {
            if (bcrWasStopped) {
                bcrWasStopped = false;
                bcrStartRotator(false);
                (settings.store as any).bannerEnabled = true;
                arToast("Nitro no longer detected - ColorBanner resumed.");
            }
        }
    };
    check();
    UserStore.addChangeListener(check);
    (startNitroWatcher as any)._cleanup = () => UserStore.removeChangeListener(check);
}

function startAvatarNitroWatcher() {
    stopAvatarNitroWatcher();
    if (!settings.store.avatarNitroCheck) return;
    const check = () => {
        if (!pluginActive || !settings.store.avatarNitroCheck) return;
        const excl = arGetExcluded();
        const hasGifExcl = excl.includes("gif");
        if (!arHasNitro() && !hasGifExcl) {
            arSetExcluded([...excl, "gif"]);
            arToast("No Nitro detected - GIFs excluded from avatar rotation.", Toasts.Type.FAILURE);
        } else if (arHasNitro() && hasGifExcl && (settings.store.avatarNitroCheck)) {
            arSetExcluded(excl.filter(e => e !== "gif"));
            arToast("Nitro detected - GIFs re-included in avatar rotation.");
        }
    };
    check();
    UserStore.addChangeListener(check);
    (startAvatarNitroWatcher as any)._cleanup = () => UserStore.removeChangeListener(check);
}

function stopAvatarNitroWatcher() {
    if ((startAvatarNitroWatcher as any)._cleanup) { (startAvatarNitroWatcher as any)._cleanup(); delete (startAvatarNitroWatcher as any)._cleanup; }
}

function stopNitroWatcher() {
    if ((startNitroWatcher as any)._cleanup) { (startNitroWatcher as any)._cleanup(); delete (startNitroWatcher as any)._cleanup; }
}

function SettingsSep({ title, color = "#9c67ff" }: { title: string; color?: string }) {
    return (
        <div style={{ margin: "14px 0 2px", display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ flex: 1, height: 1, background: `${color}55` }} />
            <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "1px", color, whiteSpace: "nowrap" }}>{title}</span>
            <div style={{ flex: 1, height: 1, background: `${color}55` }} />
        </div>
    );
}

const settings = definePluginSettings({
    _sOpen: {
        type: OptionType.COMPONENT, description: "",
        component: () => (
            <div style={{ marginTop: 4 }}>
                <Button color={Button.Colors.BRAND} onClick={() => openModal(props => <RotatorSuiteModal modalProps={props} />)}>
                    Open Rotator Suite Panel
                </Button>
                <div style={{ fontSize: 11, color: "#9e9e9e", marginTop: 6, lineHeight: 1.5 }}>
                    All rotator settings (intervals, enable/disable, randomize, Master Sync) are configured directly inside the panel tabs.
                </div>
            </div>
        )
    },
    _sSyncGroup: { type: OptionType.COMPONENT, description: "", component: () => <SettingsSep title="Master Sync" color={C.data} /> },
    globalSync: { type: OptionType.BOOLEAN, default: false, description: "Master Sync (configure in Data tab).", onChange: () => { if (pluginActive) startAllRotators(); } },
    globalSyncSeconds: { type: OptionType.STRING, default: "500", description: "Master Sync interval seconds (configure in Data tab)." },
    noDuplicateRandom: { type: OptionType.BOOLEAN, default: true, description: "No-Duplicate Random (configure in Data tab)." },
    _sStatusGroup: { type: OptionType.COMPONENT, description: "", component: () => <SettingsSep title="Status" color={C.status} /> },
    statusEnabled: { type: OptionType.BOOLEAN, default: false, description: "Status rotator enabled (configure in Status tab)." },
    statusIntervalSeconds: { type: OptionType.STRING, default: "10", description: "Status interval seconds (configure in Status tab)." },
    statusRandomize: { type: OptionType.BOOLEAN, default: true, description: "Status randomize (configure in Status tab)." },
    statusRunMode: { type: OptionType.STRING, default: "all", description: "Status run mode: all | presets | none (configure in Status tab)." },
    statusSelectedPresets: { type: OptionType.STRING, default: "[]", description: "JSON array of preset names to include when run mode is presets." },
    _sClanGroup: { type: OptionType.COMPONENT, description: "", component: () => <SettingsSep title="Clan" color={C.clan} /> },
    clanEnabled: { type: OptionType.BOOLEAN, default: false, description: "Clan switcher enabled (configure in Clan tab)." },
    clanIntervalSeconds: { type: OptionType.STRING, default: "5", description: "Clan interval seconds (configure in Clan tab)." },
    clanAutoDetect: { type: OptionType.BOOLEAN, default: false, description: "Clan auto-detect (configure in Clan tab)." },
    clanAutoDetectRefreshSeconds: { type: OptionType.STRING, default: "429", description: "Clan auto-detect refresh seconds (configure in Clan tab)." },
    clanRandomize: { type: OptionType.BOOLEAN, default: true, description: "Clan randomize (configure in Clan tab)." },
    _sProfileGroup: { type: OptionType.COMPONENT, description: "", component: () => <SettingsSep title="Profile" color={C.bio} /> },
    globalNickEnabled: { type: OptionType.BOOLEAN, default: false, description: "Global display name rotation enabled (Profile tab)." },
    globalNickRandomize: { type: OptionType.BOOLEAN, default: true, description: "Randomize global display name rotation order (Profile tab)." },
    globalNickIntervalSeconds: { type: OptionType.STRING, default: "429", description: "Seconds between display name changes. Discord rate-limits /users/@me - minimum enforced at 429." },
    profilePronounsEnabled: { type: OptionType.BOOLEAN, default: false, description: "Global pronouns rotation enabled (Profile tab)." },
    pronounsRandomize: { type: OptionType.BOOLEAN, default: true, description: "Randomize global pronouns rotation order (Profile tab)." },
    pronounsIntervalSeconds: { type: OptionType.STRING, default: "30", description: "Seconds between global pronoun changes (Profile tab)." },
    profileBioEnabled: { type: OptionType.BOOLEAN, default: false, description: "Bio rotation enabled (Profile tab)." },
    bioRandomize: { type: OptionType.BOOLEAN, default: true, description: "Randomize bio rotation order (Profile tab)." },
    bioIntervalSeconds: { type: OptionType.STRING, default: "60", description: "Seconds between bio changes (Profile tab)." },
    _sAvatarGroup: { type: OptionType.COMPONENT, description: "", component: () => <SettingsSep title="Avatar" color="#9c67ff" /> },
    avatarEnabled: { type: OptionType.BOOLEAN, default: false, description: "Avatar rotator enabled (configure in Avatar tab)." },
    avatarIntervalSeconds: { type: OptionType.NUMBER, default: AR_DEFAULT_S, description: "Seconds between avatar changes (min 60 recommended - Discord rate-limits)." },
    avatarRandom: { type: OptionType.BOOLEAN, default: true, description: "Random avatar order - no repeats until all shown once." },
    avatarShowToast: { type: OptionType.BOOLEAN, default: false, description: "Show toast notifications for avatar changes." },
    avatarNitroCheck: { type: OptionType.BOOLEAN, default: true, description: "Skip GIF avatars automatically if no Nitro detected. Toggle in the Avatar tab." },
    avatarExcludedExtensions: { type: OptionType.STRING, default: "", description: "Comma-separated extensions to skip during avatar rotation (e.g. gif,avif)." },
    _sBannerGroup: { type: OptionType.COMPONENT, description: "", component: () => <SettingsSep title="Banner Color" color="#c084fc" /> },
    bannerEnabled: { type: OptionType.BOOLEAN, default: false, description: "Banner color rotator enabled (configure in Banner tab)." },
    bannerIntervalSeconds: { type: OptionType.NUMBER, default: BCR_DEFAULT_S, description: "Seconds between banner color changes." },
    bannerMode: { type: OptionType.STRING, default: "full_random", description: "Banner color cycle mode (configure in Banner tab)." },
    bannerHueRadius: { type: OptionType.NUMBER, default: 35, description: "Hue spread for avatar-hue based modes (1-180)." },
    bannerCustomBaseColor: { type: OptionType.STRING, default: "#c084fc", description: "Base color for shade/mono modes (configure in Banner tab)." },
    bannerShowToast: { type: OptionType.BOOLEAN, default: false, description: "Show toast on each banner color change." },
    bannerShowCurrentColor: { type: OptionType.BOOLEAN, default: false, description: "Show active color hex+swatch in the footer next to ColorBanner (updates live)." },
    bannerNitroCheck: { type: OptionType.BOOLEAN, default: true, description: "Auto-pause ColorBanner cycle when Nitro is detected (you can use animated banners instead). Toggle in the Banner tab." },
    _sServerProfilesGroup: { type: OptionType.COMPONENT, description: "", component: () => <SettingsSep title="Server Profiles" color={C.nick} /> },
    nickEnabled: { type: OptionType.BOOLEAN, default: false, description: "Server nicknames master switch - when OFF, no nick timers run even if servers are toggled on." },
    nickIntervalSeconds: { type: OptionType.STRING, default: "30", description: "Seconds between server nickname changes (Server Profiles tab)." },
    nickRandomize: { type: OptionType.BOOLEAN, default: true, description: "Randomize server nickname order (Server Profiles tab)." },
    serverPronounsEnabled: { type: OptionType.BOOLEAN, default: false, description: "Server pronouns master switch - when OFF, no server pronoun timers run." },
    serverPronounsRandomize: { type: OptionType.BOOLEAN, default: true, description: "Randomize server pronoun order (Server Profiles tab)." },
    serverPronounsIntervalSeconds: { type: OptionType.STRING, default: "30", description: "Seconds between server pronoun changes (Server Profiles tab)." },
    _sVoice: { type: OptionType.COMPONENT, description: "", component: () => <SettingsSep title="Voice Activation" color="#7986cb" /> },
    voiceActivateEnabled: { type: OptionType.BOOLEAN, default: false, description: "Enable voice-based activation (configure in Server Profiles tab).", onChange: v => { if (pluginActive) { stopVoiceWatcher(); if (v) startVoiceWatcher(); else startAllRotators(); } } },
    voiceActivateGlobal: { type: OptionType.BOOLEAN, default: false, description: "Global: activate ALL server nick+pronoun rotators when in any voice/call. Overrides per-server." },
    _sMisc: { type: OptionType.COMPONENT, description: "", component: () => <SettingsSep title="Misc" color={C.hint} /> },
    showButton: { type: OptionType.BOOLEAN, default: true, description: "Show the Rotator Suite button in the user area (bottom-left)." },
    autoStart: { type: OptionType.BOOLEAN, default: true, description: "Auto-start all enabled rotators when Discord loads." },
    enableLogs: { type: OptionType.BOOLEAN, default: false, description: "Print rotator activity and errors to the console (F12)." },
    stopOnInvisible: { type: OptionType.BOOLEAN, default: true, description: "Pause all rotators automatically when status is set to invisible." },
});

function injectCSS() {
    if (document.getElementById("rs-css")) return;
    const s = document.createElement("style"); s.id = "rs-css";
    s.textContent = `
.rs-modal{width:760px;max-width:95vw}
.rs-tab-bar{display:flex;border-bottom:2px solid rgba(124,77,255,.3);margin-bottom:11px}
.rs-tab{padding:6px 14px;font-size:12px;font-weight:700;border:none;background:none;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;color:#9575cd;border-radius:4px 4px 0 0}
.rs-tab:hover{color:#ce93d8;background:rgba(124,77,255,.1)}
.rs-dot{border-radius:50%;flex-shrink:0;display:inline-block}
.rs-item{display:flex;align-items:center;gap:6px;padding:5px 9px;border-radius:7px;border:1px solid rgba(124,77,255,.2);margin-bottom:3px;background:rgba(20,5,50,.55)}
.rs-item:hover{background:rgba(124,77,255,.09)}
.rs-item.rs-over{border-color:#ffa726!important;background:rgba(255,167,38,.07)!important}
.rs-item.rs-dragging{opacity:.3;border-style:dashed}
.rs-item-compact{padding:4px 8px}
.rs-drag{cursor:grab;color:#5a4a7a;font-size:14px;user-select:none;flex-shrink:0;line-height:1;padding:0 3px}
.rs-drag:hover{color:#ce93d8}
.rs-item-icon{font-size:14px;flex-shrink:0;min-width:18px;text-align:center;color:#ce93d8}
.rs-item-text{flex:1;font-size:12px;color:#f0eaff;cursor:pointer}
.rs-item-text:hover{color:#ce93d8}
.rs-item-mono{flex:1;font-size:12px;font-family:monospace;color:#b0c4de;cursor:pointer}
.rs-item-input{flex:1;background:rgba(10,0,30,.7);border:1px solid #9c67ff;border-radius:5px;color:#f0eaff;font-size:12px;outline:none;font-family:inherit;min-width:0;caret-color:#9c67ff;padding:1px 6px}
.rs-pill-row{display:flex;flex-wrap:wrap;gap:5px;margin-top:5px;min-height:20px}
.rs-pill{display:flex;align-items:center;gap:4px;padding:3px 9px 3px 11px;border-radius:20px;font-size:12px;font-weight:700;color:#f3e5ff}
.rs-pill button{background:none;border:none;cursor:pointer;color:rgba(243,229,255,.5);font-size:13px;padding:0;line-height:1}
.rs-pill button:hover{color:#fff}
.rs-row{display:flex;gap:7px;align-items:center;margin-top:7px}
.rs-row>*:first-child{flex:1}
.rs-empty{font-size:12px;color:#757575;font-style:italic;padding:3px 0}
.rs-btn-sm{font-size:12px!important;padding:4px 10px!important;min-height:unset!important;height:28px!important}
.rs-sort-btn{font-size:11px!important;padding:3px 9px!important;min-height:unset!important;height:26px!important;border-radius:6px!important}
.rs-divider{height:1px;background:rgba(124,77,255,.2);margin:9px 0}
.rs-toolbar{display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap}
.rs-toolbar>*:first-child{flex:1}
.rs-card{border-radius:9px;padding:9px 12px;margin-bottom:6px;border:1.5px solid rgba(124,77,255,.25);background:rgba(20,5,50,.55)}
.rs-card-header{display:flex;align-items:center;justify-content:space-between;gap:8px}
.rs-card-left{display:flex;align-items:center;gap:7px;min-width:0;flex:1}
.rs-server-name{font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#e8d5ff;max-width:100%}
.rs-server-id{display:none}
.rs-badge{font-size:10px;padding:1px 7px;border-radius:8px;font-weight:700;flex-shrink:0;white-space:nowrap}
.rs-actions{display:flex;gap:5px;align-items:center;flex-shrink:0}
.rs-manual-add{border:2px dashed rgba(124,77,255,.25);border-radius:8px;padding:9px;margin:6px 0}
.rs-manual-add-title{font-size:11px;color:#9575cd;margin-bottom:6px}
.rs-count-badge{font-size:10px;background:rgba(124,77,255,.2);border-radius:8px;padding:2px 8px;color:#ce93d8}
.rs-count{font-size:10px;padding:2px 7px;border-radius:8px;font-weight:700;background:rgba(124,77,255,.18);color:#ce93d8}
.rs-sec-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:7px}
.rs-bio-list{display:flex;flex-direction:column;gap:3px;margin-bottom:6px;max-height:220px;overflow-y:auto;padding-right:2px}
.rs-bio-item{display:flex;align-items:flex-start;border-radius:7px;border:1px solid rgba(124,77,255,.25);background:rgba(124,77,255,.06)}
.rs-bio-item.editing{border-color:#9c67ff;background:rgba(124,77,255,.13)}
.rs-bio-item.rs-over{border-color:#ffa726!important}
.rs-bio-item.rs-dragging{opacity:.3}
.rs-bio-view{flex:1;padding:6px 9px;font-size:12px;color:#e8d5ff;white-space:pre-wrap;word-break:break-word;line-height:1.4;font-family:monospace;cursor:pointer;min-height:24px;max-height:72px;overflow:hidden}
.rs-bio-view:hover{background:rgba(124,77,255,.07)}
.rs-bio-edit-area{flex:1;resize:vertical;min-height:60px;max-height:200px;font-size:12px;background:transparent;border:none;padding:6px 9px;color:#f0eaff;font-family:monospace;line-height:1.4;outline:none;width:0;caret-color:#9c67ff}
.rs-bio-btns{display:flex;flex-direction:column;border-left:1px solid rgba(124,77,255,.18)}
.rs-bio-btn{background:none;border:none;cursor:pointer;padding:4px 7px;color:#757575;font-size:12px;flex:1;white-space:nowrap}
.rs-bio-btn:hover{color:#e8d5ff;background:rgba(124,77,255,.12)}
.rs-bio-btn.save{color:#9c67ff}.rs-bio-btn.save:hover{color:#fff;background:#7c4dff}
.rs-bio-btn.del:hover{color:#ef9a9a;background:rgba(239,83,80,.1)}
.rs-add-row{display:flex;gap:6px;align-items:flex-start;margin-top:6px}
.rs-add-row textarea{flex:1;min-height:52px;resize:vertical;font-size:12px;background:rgba(15,5,40,.8);border:1px solid rgba(124,77,255,.3);border-radius:8px;padding:6px 9px;color:#f0eaff;font-family:monospace;box-sizing:border-box;caret-color:#9c67ff}
.rs-add-row textarea:focus{outline:none;border-color:#9c67ff}
.rs-add-row textarea::placeholder{color:#4a3a6a}
.rs-btn{padding:5px 13px;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;border:none;color:#f3e5ff}
.rs-btn:hover{filter:brightness(1.2)}
.rs-clearall{background:rgba(239,83,80,.15)!important;border:1px solid rgba(239,83,80,.3)!important;color:#ef9a9a!important;font-size:11px;padding:3px 9px;border-radius:6px;cursor:pointer;font-weight:700}
.rs-clearall:hover{background:rgba(239,83,80,.3)!important;color:#fff!important}
.rs-confirm-box{background:rgba(239,83,80,.1);border:1px solid rgba(239,83,80,.35);border-radius:8px;padding:8px 12px;margin-top:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.rs-confirm-box span{font-size:12px;color:#ef9a9a;flex:1;min-width:120px}
.rs-hint{font-size:11px;color:#9e9e9e;margin-top:3px;line-height:1.5}
.rs-hint b{color:#ce93d8}
.rs-del-btn{background:none;border:none;cursor:pointer;color:#5a4a7a;padding:2px 5px;border-radius:4px;font-size:12px;flex-shrink:0}
.rs-del-btn:hover{color:#ef9a9a;background:rgba(239,83,80,.12)}
.rs-edit-btn{background:none;border:none;cursor:pointer;color:#5a4a7a;padding:2px 5px;border-radius:4px;font-size:11px;flex-shrink:0}
.rs-edit-btn:hover{color:#9c67ff;background:rgba(124,77,255,.15)}
.rs-data-card{border:1px solid rgba(124,77,255,.25);border-radius:9px;padding:11px;margin-bottom:8px;background:rgba(20,5,50,.55)}
.rs-data-title{font-size:11px;font-weight:800;color:#ffa726;margin-bottom:5px;text-transform:uppercase;letter-spacing:.7px}
.rs-data-desc{font-size:12px;color:#9e9e9e;margin-bottom:8px;line-height:1.5}
.rs-master-box{border:2px solid rgba(255,167,38,.35);border-radius:9px;padding:11px 13px;margin-bottom:8px;background:rgba(30,15,5,.5)}
.rs-master-title{font-size:13px;font-weight:800;color:#f0eaff;margin-bottom:3px}
.rs-master-sub{font-size:11px;color:#9e9e9e;line-height:1.5}
.rs-master-state{display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:800;padding:2px 9px;border-radius:10px;margin-top:6px;text-transform:uppercase;letter-spacing:.4px}
.rs-master-on{background:rgba(255,167,38,.15);color:#ffa726;border:1px solid rgba(255,167,38,.4)}
.rs-master-off{background:rgba(40,20,70,.5);color:#757575;border:1px solid rgba(100,80,140,.28)}
.rs-warn-box{background:rgba(255,152,0,.08);border:1px solid rgba(255,152,0,.3);border-radius:7px;padding:7px 11px;font-size:11px;color:#ffb74d;margin-top:7px;line-height:1.5}
.rs-footer-info{flex:1;font-size:11px;color:#9e9e9e;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.rs-footer-info b{color:#ce93d8}
.rs-import-status{font-size:12px;margin-bottom:7px;padding:6px 10px;border-radius:7px;border:1px solid}
.rs-summary-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;font-size:12px;color:#9e9e9e}
.rs-summary-grid b{color:#ce93d8}
.rs-nick-expand{margin-top:6px;border-top:1px solid rgba(124,77,255,.18);padding-top:7px}
.rs-nick-list{display:flex;flex-direction:column;gap:3px;margin-bottom:5px;max-height:150px;overflow-y:auto;padding-right:2px}
.rs-sec-hdr{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.rs-sec-hdr-line{flex:1;height:1px}
.rs-sec-hdr-label{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.8px}
.rs-settings-panel{border:1px solid rgba(124,77,255,.22);border-radius:9px;padding:8px 10px;margin-bottom:8px;background:rgba(20,5,50,.5)}
.rs-run-mode-row{display:flex;gap:4px;margin-bottom:4px}
.rs-run-mode-btn{flex:1;padding:5px 0;border-radius:6px;font-size:11px;font-weight:800;cursor:pointer;border:1.5px solid rgba(80,60,110,.4);background:rgba(15,5,35,.6);color:#5a4a7a;transition:all .15s;text-align:center}
.rs-run-mode-btn:hover{border-color:rgba(124,77,255,.5);color:#ce93d8}
.rs-run-mode-btn.active-all{background:rgba(76,175,80,.12);border-color:#4caf5088;color:#4caf50}
.rs-run-mode-btn.active-presets{background:rgba(124,77,255,.12);border-color:#9c67ff88;color:#ce93d8}
.rs-run-mode-btn.active-none{background:rgba(239,83,80,.1);border-color:#ef9a9a66;color:#ef9a9a}
.rs-preset-check-row{display:flex;flex-direction:column;gap:3px;margin-top:5px;padding:6px 8px;border-radius:7px;background:rgba(10,0,25,.4);border:1px solid rgba(124,77,255,.18)}
.rs-preset-check-item{display:flex;align-items:center;gap:7px;padding:4px 6px;border-radius:5px;cursor:pointer;transition:background .12s}
.rs-preset-check-item:hover{background:rgba(124,77,255,.1)}
.rs-preset-check-box{width:14px;height:14px;border-radius:3px;border:1.5px solid rgba(124,77,255,.5);display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .12s}
.rs-preset-check-box.checked{background:#9c67ff;border-color:#9c67ff}
.rs-preset-check-label{font-size:12px;font-weight:600;flex:1}
.rs-preset-check-count{font-size:10px;color:#757575}
.rs-run-mode-hint{font-size:10px;color:#757575;margin-top:4px;line-height:1.4}
.rs-status-preview{border:1px solid rgba(124,77,255,.28);border-radius:10px;padding:9px 13px;margin-bottom:9px;background:rgba(20,5,50,.6);display:flex;align-items:center;gap:10px}
.rs-preview-avatar{width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0;border:2px solid rgba(124,77,255,.3)}
.rs-preview-info{flex:1;min-width:0}
.rs-preview-name{font-size:12px;font-weight:700;color:#e8d5ff;margin-bottom:2px}
.rs-preview-row{display:flex;align-items:center;gap:4px}
.rs-preview-emoji{font-size:14px;flex-shrink:0}
.rs-preview-emoji-img{width:16px;height:16px;object-fit:contain;flex-shrink:0}
.rs-preview-text{font-size:12px;color:#b0a0cc;font-style:italic}
.rs-preview-label{font-size:9px;font-weight:800;color:#9c67ff;text-transform:uppercase;letter-spacing:.9px;margin-bottom:5px}
.rs-status-dot-indicator{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.rs-status-type-row{display:flex;gap:4px;flex-wrap:wrap;margin:5px 0}
.rs-status-type-btn{display:flex;align-items:center;gap:4px;padding:2px 8px;border-radius:10px;border:1px solid rgba(124,77,255,.3);background:rgba(20,5,50,.6);cursor:pointer;font-size:11px;font-weight:700;color:#b0a0cc;transition:all .15s}
.rs-status-type-btn:hover{border-color:rgba(124,77,255,.6);color:#f0eaff}
.rs-status-type-btn.active{border-color:currentColor;color:#f0eaff;background:rgba(124,77,255,.18)}
.rs-status-type-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.rs-entry-status-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;margin-left:1px}
.rs-preset-tag{font-size:10px;padding:1px 7px;border-radius:8px;background:rgba(124,77,255,.18);color:#ce93d8;font-weight:700;border:1px solid rgba(124,77,255,.28)}
.rs-preset-section{margin-bottom:6px;border-radius:8px;border:1px solid rgba(124,77,255,.2);overflow:hidden}
.rs-preset-header{display:flex;align-items:center;justify-content:space-between;padding:5px 10px;background:rgba(124,77,255,.07);cursor:pointer;user-select:none}
.rs-preset-header:hover{background:rgba(124,77,255,.12)}
.rs-preset-name{font-size:11px;font-weight:800;color:#ce93d8;text-transform:uppercase;letter-spacing:.5px}
.rs-preset-count{font-size:10px;background:rgba(124,77,255,.2);border-radius:8px;padding:1px 7px;color:#9575cd}
.rs-preset-body{padding:4px 6px 6px}
.rs-no-preset-label{font-size:10px;color:#5a4a7a;font-style:italic;padding:3px 0}
.rs-add-preset-row{display:flex;gap:5px;margin-top:5px}
.rs-preset-pill-row{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:7px}
.ar-card{border-radius:10px;overflow:hidden;margin-bottom:14px;background:var(--background-tertiary);border:1px solid rgba(255,255,255,.07)}
.ar-card-row{padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.07);display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.ar-card-row:last-child{border-bottom:none}
.ar-toggle{width:34px;height:18px;border-radius:9px;flex-shrink:0;cursor:pointer;position:relative;user-select:none}
.ar-toggle-knob{position:absolute;top:2px;width:14px;height:14px;border-radius:50%;background:#fff}
.ar-ext-btn{padding:3px 9px;border-radius:5px;font-size:11px;font-weight:700;cursor:pointer;outline:none;user-select:none}
.ar-avatar-card{display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:8px;margin-bottom:4px;border:1px solid rgba(255,255,255,.07);user-select:none}
.ar-avatar-card:hover{background:rgba(156,103,255,.06)}
.ar-avatar-card.ar-drag-over{background:rgba(156,103,255,.09);border-color:#9c67ff}
.ar-avatar-card.ar-dragging{opacity:.3}
.ar-icon-btn{width:26px;height:26px;border-radius:6px;flex-shrink:0;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;outline:none}
.ar-upload-zone{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:12px 8px;border-radius:10px;cursor:pointer;user-select:none}
.ar-import-zone{width:120px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:12px 8px;border-radius:10px;cursor:pointer;user-select:none}
.bcr-sub-tab-bar{display:flex;border-bottom:1px solid rgba(255,255,255,.07);margin:0 -2px 8px}
.bcr-sub-tab{flex:1;text-align:center;font-size:10px;font-weight:700;padding:5px 0;cursor:pointer;user-select:none;border-bottom:2px solid transparent}
.bcr-mode-grid{display:grid;grid-template-columns:1fr 1fr;gap:3px;margin-bottom:6px}
.bcr-mode-item{display:flex;align-items:center;gap:5px;padding:5px 7px;border-radius:6px;cursor:pointer;user-select:none;border:1px solid}
`;
    document.head.appendChild(s);
}

type TabId = "status" | "clan" | "profile" | "avatar" | "colorbanner" | "servers" | "data";
type SortMode = "name" | "enabled" | "nicks" | "running" | "pronouns";

function useDrag(onReorder: (from: number, to: number) => void) {
    const dragRef = React.useRef<number | null>(null);
    const [overIdx, setOverIdx] = React.useState<number | null>(null);
    const props = (i: number) => ({
        draggable: true as const,
        onDragStart: (e: React.DragEvent) => { dragRef.current = i; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); },
        onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOverIdx(prev => prev !== i ? i : prev); },
        onDrop: (e: React.DragEvent) => { e.preventDefault(); const from = dragRef.current; if (from !== null && from !== i) onReorder(from, i); dragRef.current = null; setOverIdx(null); },
        onDragEnd: (e: React.DragEvent) => { e.preventDefault(); dragRef.current = null; setOverIdx(null); },
        onDragLeave: () => { setOverIdx(prev => prev === i ? null : prev); },
    });
    const cls = (i: number, base: string) =>
        `${base}${overIdx === i && dragRef.current !== i ? " rs-over" : ""}${dragRef.current === i ? " rs-dragging" : ""}`;
    return { props, cls };
}

function Hdr({ label, color, count }: { label: string; color: string; count?: string | number }) {
    return (
        <div className="rs-sec-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
            <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: ".8px", color }}>{label}</span>
            {count !== undefined && <span className="rs-count">{count}</span>}
        </div>
    );
}

function ConfirmBox({ msg, onConfirm, onCancel }: { msg: string; onConfirm: () => void; onCancel: () => void }) {
    return (
        <div className="rs-confirm-box">
            <span>{msg}</span>
            <button className="rs-btn" style={{ background: "#c62828", fontSize: 11, padding: "3px 11px" }} onClick={onConfirm}>Yes, delete</button>
            <button className="rs-btn" style={{ background: "rgba(100,80,140,.35)", fontSize: 11, padding: "3px 11px" }} onClick={onCancel}>Cancel</button>
        </div>
    );
}

function PanelToggle({ label, description, value, color, onChange, compact }: { label: string; description?: string; value: boolean; color?: string; onChange: (v: boolean) => void; compact?: boolean }) {
    const activeColor = color ?? C.enabled;
    return (
        <div
            onClick={() => onChange(!value)}
            style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: compact ? "4px 8px" : "7px 10px", borderRadius: 7, marginBottom: compact ? 0 : 4, cursor: "pointer",
                border: `1px solid ${value ? activeColor + "55" : "rgba(80,60,110,.35)"}`,
                background: value ? `${activeColor}12` : "rgba(15,5,35,.5)",
                transition: "border-color .15s, background .15s",
            }}>
            <div style={{ flex: 1, pointerEvents: "none" }}>
                <span style={{ fontSize: compact ? 11 : 12, fontWeight: 700, color: value ? activeColor : "#6a5a8a" }}>{label}</span>
                {description && <div style={{ fontSize: 10, color: value ? "#9e9e9e" : "#4a3a6a", marginTop: 1 }}>{description}</div>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, pointerEvents: "none" }}>
                <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".5px", color: value ? activeColor : "#4a3a6a" }}>{value ? "ON" : "OFF"}</span>
                <div style={{
                    width: 36, height: 20, borderRadius: 10, position: "relative",
                    background: value ? activeColor : "#1a0f2e",
                    border: `1.5px solid ${value ? activeColor : "#3a2a5a"}`,
                    transition: "background .18s, border-color .18s",
                }}>
                    <span style={{
                        position: "absolute", top: 2, left: value ? 17 : 2,
                        width: 13, height: 13, borderRadius: "50%",
                        background: value ? "#fff" : "#5a4a7a",
                        transition: "left .18s, background .18s", display: "block",
                        boxShadow: value ? "0 1px 3px rgba(0,0,0,.4)" : "none",
                    }} />
                </div>
            </div>
        </div>
    );
}

function PanelInterval({ label, description, storeKey, onApply, disabled }: {
    label: string; description?: string;
    storeKey: keyof typeof settings.store & string;
    onApply?: () => void; disabled?: boolean;
}) {
    const [val, setVal] = React.useState(String((settings.store as any)[storeKey]));
    const commit = () => {
        const n = Math.max(1, parseFloat(val) || 1);
        (settings.store as any)[storeKey] = String(n);
        setVal(String(n));
        onApply?.();
    };
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", borderRadius: 7, border: "1px solid rgba(124,77,255,.18)", background: "rgba(20,5,50,.45)", marginBottom: 4, opacity: disabled ? .45 : 1 }}>
            <div style={{ flex: 1 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#f0eaff" }}>{label}</span>
                {description && <div style={{ fontSize: 10, color: "#757575", marginTop: 1 }}>{description}</div>}
            </div>
            <input
                value={val}
                onChange={e => setVal(e.target.value)}
                onBlur={commit}
                onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") commit(); }}
                disabled={disabled}
                style={{ width: 52, background: "rgba(10,0,30,.7)", border: "1px solid rgba(124,77,255,.35)", borderRadius: 5, color: "#f0eaff", fontSize: 12, padding: "2px 6px", outline: "none", textAlign: "center", fontFamily: "monospace" }}
            />
            <span style={{ fontSize: 11, color: "#757575" }}>s</span>
        </div>
    );
}

function getAvatarUrl(userId: string, avatar: string | null): string {
    return avatar
        ? `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png?size=64`
        : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(userId) >> 22n) % 6}.png`;
}
function getEmojiUrl(id: string, animated?: boolean): string {
    return `https://cdn.discordapp.com/emojis/${id}.${animated ? "gif" : "png"}`;
}

const EVAL_SNIPPETS: { cat: string; items: [string, string][] }[] = [
    { cat: "🕐 Time", items: [
        ["HH:MM:SS", "eval let f=t=>(t<10?'0':'')+t,d=new Date();`${f(d.getHours())}:${f(d.getMinutes())}:${f(d.getSeconds())}`"],
        ["HH:MM", "eval let f=t=>(t<10?'0':'')+t,d=new Date();`${f(d.getHours())}:${f(d.getMinutes())}`"],
        ["H:MM am/pm", "eval new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})"],
        ["Full time", "eval new Date().toLocaleTimeString()"],
        ["Hour :00", "eval new Date().getHours()+':00'"],
    ] },
    { cat: "📅 Date", items: [
        ["Short date", "eval new Date().toLocaleDateString()"],
        ["DD/MM/YYYY", "eval let d=new Date();`${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()}`"],
        ["Day name", "eval ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date().getDay()]"],
        ["Day short", "eval ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date().getDay()]"],
        ["Date+Time", "eval new Date().toLocaleString()"],
        ["Month name", "eval ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][new Date().getMonth()]"],
    ] },
    { cat: "🕛 Emoji clock", items: [
        ["Clock emoji", "eval ['🕛','🕐','🕑','🕒','🕓','🕔','🕕','🕖','🕗','🕘','🕙','🕚'][new Date().getHours()%12]"],
        ["Moon phase", "eval ['🌑','🌒','🌓','🌔','🌕','🌖','🌗','🌘'][Math.floor(new Date().getDate()/3.75)%8]"],
        ["Day emoji", "eval ['☀️','🌙','🌙','🌙','☀️','☀️','☀️'][new Date().getDay()]"],
        ["AM/PM emoji", "eval new Date().getHours()<12?'🌅':'🌆'"],
    ] },
    { cat: "🎲 Fun", items: [
        ["Random 1-100", "eval Math.floor(Math.random()*100)+1"],
        ["Coin flip", "eval Math.random()<.5?'heads':'tails'"],
        ["Dice 🎲", "eval ['⚀','⚁','⚂','⚃','⚄','⚅'][Math.floor(Math.random()*6)]"],
        ["Random color", "eval '#'+Math.floor(Math.random()*0xFFFFFF).toString(16).padStart(6,'0')"],
    ] },
    { cat: "📊 System", items: [
        ["Memory MB", "eval Math.round(performance.memory?.usedJSHeapSize/1048576||0)+'MB'"],
        ["Timestamp", "eval Date.now()"],
        ["ISO time", "eval new Date().toISOString().slice(11,19)"],
        ["UTC offset", "eval 'UTC'+(new Date().getTimezoneOffset()>0?'-':'+')+Math.abs(new Date().getTimezoneOffset()/60)"],
    ] },
];

const EVAL_TOKENS: { label: string; code: string; pad: boolean }[] = [
    { label: "HH:MM:SS", code: "${f(d.getHours())}:${f(d.getMinutes())}:${f(d.getSeconds())}", pad: true },
    { label: "HH:MM", code: "${f(d.getHours())}:${f(d.getMinutes())}", pad: true },
    { label: "H:MM am/pm", code: "${new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}", pad: false },
    { label: "Day name", code: "${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date().getDay()]}", pad: false },
    { label: "DD/MM/YYYY", code: "${new Date().toLocaleDateString()}", pad: false },
    { label: "Clock emoji", code: "${['🕛','🕐','🕑','🕒','🕓','🕔','🕕','🕖','🕗','🕘','🕙','🕚'][new Date().getHours()%12]}", pad: false },
    { label: "Random 1-100", code: "${Math.floor(Math.random()*100)+1}", pad: false },
    { label: "Dice 🎲", code: "${['⚀','⚁','⚂','⚃','⚄','⚅'][Math.floor(Math.random()*6)]}", pad: false },
];

function EvalSnippetPanel({ setDraft }: { setDraft: (v: string) => void }) {
    const [cat, setCat] = React.useState(0);
    const [builderOpen, setBuilderOpen] = React.useState(false);
    const [bLeft, setBLeft] = React.useState("");
    const [bToken, setBToken] = React.useState(0);
    const [bRight, setBRight] = React.useState("");

    const buildExpr = () => {
        const tok = EVAL_TOKENS[bToken];
        const l = bLeft, r = bRight;
        if (tok.pad) {
            return `eval let f=t=>(t<10?'0':'')+t,d=new Date();\`${l}${tok.code}${r}\``;
        }
        return `eval \`${l}${tok.code}${r}\``;
    };

    const btnStyle = (active: boolean): React.CSSProperties => ({
        display: "inline-flex", alignItems: "center", margin: "2px 2px 2px 0", padding: "2px 7px",
        borderRadius: 5, border: `1px solid ${active ? "rgba(255,167,38,.6)" : "rgba(255,167,38,.25)"}`,
        background: active ? "rgba(255,167,38,.2)" : "rgba(255,167,38,.07)",
        color: active ? "#ffd580" : "#c8a050", cursor: "pointer", fontSize: 10, fontWeight: 700, outline: "none",
    });

    return (
        <div>
            <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 2, marginBottom: 5 }}>
                {EVAL_SNIPPETS.map((s, ci) => (
                    <button key={s.cat} style={btnStyle(cat === ci)} onClick={() => setCat(ci)}>{s.cat}</button>
                ))}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 2 }}>
                {EVAL_SNIPPETS[cat].items.map(([label, snippet]) => (
                    <button key={label} title={snippet} onClick={() => setDraft(snippet)}
                        style={{ display: "inline-flex", alignItems: "center", margin: "2px 2px 2px 0", padding: "2px 8px", borderRadius: 5, border: "1px solid rgba(255,167,38,.3)", background: "rgba(255,167,38,.1)", color: "#faa61a", cursor: "pointer", fontSize: 10, fontWeight: 600, outline: "none" }}>
                        {label}
                    </button>
                ))}
            </div>
            <div style={{ marginTop: 6, borderTop: "1px solid rgba(255,167,38,.15)", paddingTop: 5 }}>
                <button onClick={() => setBuilderOpen(o => !o)}
                    style={{ fontSize: 10, fontWeight: 800, color: builderOpen ? "#ffd580" : "#c8a050", background: "none", border: "none", cursor: "pointer", outline: "none", padding: 0 }}>
                    {builderOpen ? "▾" : "▸"} Text builder - left text | dynamic | right text
                </button>
                {builderOpen && (
                    <div style={{ marginTop: 5, display: "flex", flexDirection: "column" as const, gap: 5 }}>
                        <div style={{ fontSize: 10, color: "#9e9e9e" }}>
                            Write text around a dynamic part. Example: <span style={{ fontFamily: "monospace", color: "#faa61a", userSelect: "all" as const }}>🖤 ... | HH:MM:SS</span>
                        </div>
                        <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" as const }}>
                            <input value={bLeft} onChange={e => setBLeft(e.target.value)} placeholder="text before..."
                                style={{ flex: 1, minWidth: 80, background: "rgba(10,0,30,.7)", border: "1px solid rgba(255,167,38,.3)", borderRadius: 5, color: "#f0eaff", fontSize: 11, padding: "3px 7px", outline: "none", fontFamily: "monospace" }} />
                            <select value={bToken} onChange={e => setBToken(Number(e.target.value))}
                                style={{ background: "rgba(10,0,30,.85)", border: "1px solid rgba(255,167,38,.4)", borderRadius: 5, color: "#ffa726", fontSize: 11, padding: "3px 6px", outline: "none" }}>
                                {EVAL_TOKENS.map((t, i) => <option key={t.label} value={i}>{t.label}</option>)}
                            </select>
                            <input value={bRight} onChange={e => setBRight(e.target.value)} placeholder="text after..."
                                style={{ flex: 1, minWidth: 80, background: "rgba(10,0,30,.7)", border: "1px solid rgba(255,167,38,.3)", borderRadius: 5, color: "#f0eaff", fontSize: 11, padding: "3px 7px", outline: "none", fontFamily: "monospace" }} />
                        </div>
                        <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                            <span style={{ flex: 1, fontSize: 10, color: "#9e9e9e", fontFamily: "monospace", wordBreak: "break-all" as const, userSelect: "all" as const }}>{buildExpr()}</span>
                            <button onClick={() => setDraft(buildExpr())}
                                style={{ padding: "3px 11px", borderRadius: 5, border: "1px solid rgba(255,167,38,.5)", background: "rgba(255,167,38,.18)", color: "#ffd580", cursor: "pointer", fontSize: 10, fontWeight: 800, outline: "none", flexShrink: 0 }}>
                                Insert ↑
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function StatusLivePreview({ entry, statusType }: { entry: Pick<StatusEntry, "emojiId" | "emojiName" | "animated" | "text">; statusType: StatusType }) {
    const user = UserStore.getCurrentUser() as any;
    const dot = STATUS_OPTIONS.find(s => s.value === statusType)?.color ?? "#23a55a";
    return (
        <div className="rs-status-preview">
            <div style={{ position: "relative", flexShrink: 0 }}>
                <img className="rs-preview-avatar"
                    src={user ? getAvatarUrl(user.id, user.avatar) : undefined}
                    alt="" />
                <span style={{ position: "absolute", bottom: 0, right: 0, width: 10, height: 10, borderRadius: "50%", background: dot === "#9c67ff" ? "linear-gradient(135deg,#9c67ff,#6a1fff)" : dot, border: "2px solid rgba(20,5,50,.9)", display: "block" }} />
            </div>
            <div className="rs-preview-info">
                <div className="rs-preview-label">PREVIEW</div>
                <div className="rs-preview-name">{user?.username ?? "user"}</div>
                <div className="rs-preview-row">
                    {entry.emojiId
                        ? <img className="rs-preview-emoji-img" src={getEmojiUrl(entry.emojiId, entry.animated)} alt="" />
                        : entry.emojiName
                            ? <span className="rs-preview-emoji">{entry.emojiName}</span>
                            : null}
                    <span className="rs-preview-text">{entry.text || <em>No text set...</em>}</span>
                </div>
            </div>
        </div>
    );
}

function StatusTypeSelector({ value, onChange }: { value: StatusType; onChange: (v: StatusType) => void }) {
    const hint = STATUS_OPTIONS.find(s => s.value === value)?.hint ?? "";
    return (
        <div>
            <div className="rs-status-type-row">
                {STATUS_OPTIONS.map(s => (
                    <button key={s.value}
                        title={s.hint}
                        className={`rs-status-type-btn${value === s.value ? " active" : ""}`}
                        style={value === s.value ? { color: s.color, borderColor: s.color } : {}}
                        onClick={() => onChange(s.value)}>
                        <span className="rs-status-type-dot" style={{ background: s.color }} />
                        {s.label}
                    </button>
                ))}
            </div>
            {hint && <div style={{ fontSize: 10, color: "#757575", marginTop: 3, lineHeight: 1.4, paddingLeft: 2 }}>{hint}</div>}
        </div>
    );
}

function ClearAfterSelector({ value, onChange }: { value: number; onChange: (v: number) => void }) {
    const [raw, setRaw] = React.useState(value > 0 ? String(Math.round(value / 60000)) : "");
    const commit = () => onChange(minutesToMs(raw));
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 6, margin: "4px 0" }}>
            <span style={{ fontSize: 11, color: C.hint, flexShrink: 0 }}>Clear after:</span>
            <input value={raw} onChange={e => setRaw(e.target.value)} onBlur={commit}
                onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") commit(); }}
                placeholder="0 = never"
                style={{ width: 72, background: "rgba(10,0,30,.7)", border: "1px solid rgba(124,77,255,.35)", borderRadius: 5, color: "#f0eaff", fontSize: 11, padding: "2px 6px", outline: "none", fontFamily: "monospace" }} />
            <span style={{ fontSize: 11, color: "#757575" }}>min</span>
        </div>
    );
}

function StatusRunModeSelector({ presets, forceUpdate }: { presets: StatusPreset[]; forceUpdate: () => void }) {
    const mode = settings.store.statusRunMode as "all" | "presets" | "none";
    const getSel = (): string[] => { try { return JSON.parse(settings.store.statusSelectedPresets || "[]"); } catch { return []; } };
    const setSel = (v: string[]) => { settings.store.statusSelectedPresets = JSON.stringify(v); forceUpdate(); };
    const selected = getSel();

    const setMode = (m: "all" | "presets" | "none") => {
        settings.store.statusRunMode = m;
        if (pluginActive) { stopStatusTimer(); if (settings.store.statusEnabled && m !== "none" && !settings.store.globalSync) scheduleStatusLoop(); }
        forceUpdate();
    };

    const togglePreset = (name: string) => {
        const next = selected.includes(name) ? selected.filter(x => x !== name) : [...selected, name];
        setSel(next);
        if (pluginActive && settings.store.statusEnabled && !settings.store.globalSync) { stopStatusTimer(); scheduleStatusLoop(); }
    };

    const MODES: { key: "all" | "presets" | "none"; label: string; cls: string; hint: string }[] = [
        { key: "all", label: "All Entries", cls: "active-all", hint: "Cycle through every status entry regardless of preset" },
        { key: "presets", label: "Selected Presets", cls: "active-presets", hint: "Only cycle entries belonging to the checked presets below" },
        { key: "none", label: "None", cls: "active-none", hint: "Status rotator is paused - no entries will be cycled" },
    ];

    const activeHint = MODES.find(m => m.key === mode)?.hint ?? "";
    const pool = (() => {
        if (mode === "none") return 0;
        if (mode !== "presets") return statusEntries.length;
        return statusEntries.filter(e => e.preset && selected.includes(e.preset)).length;
    })();

    return (
        <div style={{ marginBottom: 4 }}>
            <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: ".7px", color: C.status, marginBottom: 5 }}>
                Run Mode - pool: <span style={{ color: pool > 0 ? C.enabled : C.del }}>{pool} entries</span>
            </div>
            <div className="rs-run-mode-row">
                {MODES.map(m => (
                    <button key={m.key}
                        className={`rs-run-mode-btn${mode === m.key ? ` ${m.cls}` : ""}`}
                        onClick={() => setMode(m.key)}>
                        {m.label}
                    </button>
                ))}
            </div>
            <div className="rs-run-mode-hint">{activeHint}</div>
            {mode === "presets" && (
                <div className="rs-preset-check-row">
                    {presets.length === 0 && <span style={{ fontSize: 11, color: "#5a4a7a", fontStyle: "italic" }}>No presets yet - create one below.</span>}
                    {presets.map(p => {
                        const cnt = statusEntries.filter(e => e.preset === p.name).length;
                        const checked = selected.includes(p.name);
                        return (
                            <div key={p.id} className="rs-preset-check-item" onClick={() => togglePreset(p.name)}>
                                <div className={`rs-preset-check-box${checked ? " checked" : ""}`}>
                                    {checked && <svg width="9" height="9" viewBox="0 0 24 24" fill="#fff"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>}
                                </div>
                                <span className="rs-preset-check-label" style={{ color: checked ? "#e8d5ff" : "#6a5a8a" }}>{p.name}</span>
                                <span className="rs-preset-check-count">{cnt} {cnt === 1 ? "entry" : "entries"}</span>
                            </div>
                        );
                    })}
                    {presets.length > 0 && (
                        <div style={{ display: "flex", gap: 6, marginTop: 4, paddingTop: 4, borderTop: "1px solid rgba(124,77,255,.15)" }}>
                            <button className="rs-btn" style={{ background: "rgba(124,77,255,.25)", fontSize: 10, padding: "2px 9px" }}
                                onClick={() => setSel(presets.map(p => p.name))}>Select All</button>
                            <button className="rs-btn" style={{ background: "rgba(80,60,110,.25)", fontSize: 10, padding: "2px 9px" }}
                                onClick={() => setSel([])}>Clear</button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function OnCloseStatusPanel({ forceUpdate }: { forceUpdate: () => void }) {
    const [enabled, setEnabled] = React.useState(closeStatusEnabled);
    const [text, setText] = React.useState(closeStatusText);
    const [emoji, setEmoji] = React.useState(closeStatusEmoji);
    const [type, setType] = React.useState<StatusType>(closeStatusType);

    const save = () => {
        closeStatusText = text.trim(); closeStatusEmoji = emoji.trim(); closeStatusType = type;
        void saveCloseConfig(); forceUpdate();
    };

    return (
        <div>
            <PanelToggle label="On-Close Status" description="Apply a fixed status when Discord closes (beforeunload - not fired on crash/kill)"
                value={enabled} color="#64b5f6"
                onChange={v => { closeStatusEnabled = v; setEnabled(v); void saveCloseConfig(); forceUpdate(); }} />
            {enabled && (
                <div style={{ display: "flex", flexDirection: "column", gap: 5, padding: "7px 10px", border: "1px solid rgba(100,181,246,.2)", borderRadius: 7, background: "rgba(10,20,50,.5)", marginTop: 3 }}>
                    <StatusTypeSelector value={type} onChange={v => { setType(v); closeStatusType = v; void saveCloseConfig(); }} />
                    <div style={{ display: "flex", gap: 6 }}>
                        <input value={emoji} onChange={e => setEmoji(e.target.value)} onBlur={save}
                            placeholder="Emoji (opt.)"
                            style={{ width: 110, background: "rgba(10,0,30,.7)", border: "1px solid rgba(124,77,255,.35)", borderRadius: 5, color: "#f0eaff", fontSize: 11, padding: "3px 7px", outline: "none", fontFamily: "monospace" }} />
                        <input value={text} onChange={e => setText(e.target.value)} onBlur={save}
                            onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") save(); }}
                            placeholder="Status text..."
                            style={{ flex: 1, background: "rgba(10,0,30,.7)", border: "1px solid rgba(124,77,255,.35)", borderRadius: 5, color: "#f0eaff", fontSize: 11, padding: "3px 7px", outline: "none" }} />
                    </div>
                    <div style={{ fontSize: 10, color: "#64b5f6", opacity: .7 }}>
                        <b>Auto</b> = keep current presence, only update text. Leave text empty to clear status on close.
                    </div>
                </div>
            )}
        </div>
    );
}

function StatusTab({ forceUpdate }: { forceUpdate: () => void }) {
    const [draft, setDraft] = React.useState("");
    const [draftStatusType, setDraftStatusType] = React.useState<StatusType>("online");
    const [draftPreset, setDraftPreset] = React.useState("");
    const [draftClearAfter, setDraftClearAfter] = React.useState(0);
    const [newPresetName, setNewPresetName] = React.useState("");
    const [editIdx, setEditIdx] = React.useState<number | null>(null);
    const [editText, setEditText] = React.useState("");
    const [editStatusType, setEditStatusType] = React.useState<StatusType>("online");
    const [editPreset, setEditPreset] = React.useState("");
    const [editClearAfter, setEditClearAfter] = React.useState(0);
    const [confirm, setConfirm] = React.useState(false);
    const [filterPreset, setFilterPreset] = React.useState<string | null>(null);

    const list = statusEntries;
    const presets = statusPresets;
    const filteredList = filterPreset ? list.filter(e => e.preset === filterPreset) : list;
    const previewEntry = editIdx !== null && list[editIdx] ? list[editIdx] : parseDiscordEmoji(draft);
    const previewStatus = editIdx !== null && list[editIdx] ? (list[editIdx].status ?? "online") : draftStatusType;

    const { props: dProps, cls } = useDrag((f, t) => {
        const realF = list.indexOf(filteredList[f]);
        const realT = list.indexOf(filteredList[t]);
        if (realF !== -1 && realT !== -1) {
            statusEntries = reorder(list, realF, realT);
            statusSeqIdx = 0; statusLastVal = null;
            saveData(); forceUpdate();
        }
    });

    function add() {
        const v = draft.trim(); if (!v) return;
        const parsed = parseDiscordEmoji(v);
        if (!parsed.text && !parsed.emojiId && !parsed.emojiName) return;
        statusEntries = [...list, { ...parsed, status: draftStatusType, preset: draftPreset.trim() || undefined, clearAfter: draftClearAfter || undefined }];
        statusSeqIdx = 0; statusLastVal = null;
        saveData(); setDraft(""); setDraftPreset(""); setDraftClearAfter(0); forceUpdate();
    }

    function remove(i: number) {
        statusEntries = list.filter((_, j) => j !== i);
        statusSeqIdx = 0; statusLastVal = null;
        saveData(); forceUpdate();
    }

    function startEdit(i: number) {
        const e = list[i];
        const raw = e.emojiId
            ? `<${e.animated ? "a" : ""}:${e.emojiName}:${e.emojiId}> ${e.text}`
            : e.emojiName ? `${e.emojiName} ${e.text}` : e.text;
        setEditIdx(i); setEditText(raw.trim()); setEditStatusType(e.status ?? "online"); setEditPreset(e.preset ?? ""); setEditClearAfter(e.clearAfter ?? 0);
    }

    function saveEdit(i: number) {
        const v = editText.trim(); if (!v) { setEditIdx(null); return; }
        const parsed = parseDiscordEmoji(v);
        const updated = [...list];
        updated[i] = { ...parsed, status: editStatusType, preset: editPreset.trim() || undefined, clearAfter: editClearAfter || undefined };
        statusEntries = updated; saveData(); setEditIdx(null); forceUpdate();
    }

    function addPreset() {
        const name = newPresetName.trim(); if (!name) return;
        if (statusPresets.some(p => p.name.toLowerCase() === name.toLowerCase())) return;
        statusPresets = [...statusPresets, { id: Date.now().toString(), name }];
        setNewPresetName(""); saveData(); forceUpdate();
    }

    function removePreset(id: string) {
        const pName = presets.find(p => p.id === id)?.name;
        statusPresets = presets.filter(p => p.id !== id);
        if (pName) statusEntries = list.map(e => e.preset === pName ? { ...e, preset: undefined } : e);
        if (filterPreset === pName) setFilterPreset(null);
        saveData(); forceUpdate();
    }

    function applyPresetClearAfter(presetName: string, ms: number) {
        statusEntries = list.map(e => e.preset === presetName ? { ...e, clearAfter: ms || undefined } : e);
        saveData(); forceUpdate();
    }

    return (
        <div>
            <div className="rs-settings-panel">
                <PanelToggle label="Enabled" description="Automatically cycle your Discord custom status" value={settings.store.statusEnabled} color={C.status}
                    onChange={v => { settings.store.statusEnabled = v; if (pluginActive) { stopStatusTimer(); if (v && !settings.store.globalSync) scheduleStatusLoop(); } }} />
                <PanelToggle label="Randomize" description="Pick randomly instead of cycling in order" value={settings.store.statusRandomize}
                    onChange={v => { settings.store.statusRandomize = v; }} />
                <PanelInterval label="Interval" description="Seconds between status changes (ignored when Master Sync is ON)"
                    storeKey="statusIntervalSeconds" disabled={settings.store.globalSync}
                    onApply={() => { if (pluginActive && settings.store.statusEnabled && !settings.store.globalSync) { stopStatusTimer(); scheduleStatusLoop(); } }} />
                <div className="rs-divider" style={{ margin: "6px 0" }} />
                <StatusRunModeSelector presets={statusPresets} forceUpdate={forceUpdate} />
                <div className="rs-divider" style={{ margin: "6px 0" }} />
                <OnCloseStatusPanel forceUpdate={forceUpdate} />
            </div>
            <div className="rs-divider" style={{ margin: "8px 0" }} />
            <StatusLivePreview entry={previewEntry} statusType={previewStatus} />

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: ".8px", color: C.status }}>Add Status</span>
            </div>
            <TextInput value={draft} onChange={setDraft}
                placeholder="Status text... or Discord emoji <:name:id> + text"
                onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter" && e.ctrlKey) { e.preventDefault(); add(); } }} />
            <div style={{ margin: "4px 0 6px", padding: "7px 10px", borderRadius: 7, border: "1px solid rgba(255,167,38,.22)", background: "rgba(255,167,38,.04)", userSelect: "text" as const }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: "#faa61a", marginBottom: 4, letterSpacing: ".5px", textTransform: "uppercase" as const }}>
                    ⚡ eval prefix - dynamic JS
                </div>
                <div style={{ fontSize: 10, color: "#9e9e9e", marginBottom: 5 }}>
                    Prefix with <span style={{ fontFamily: "monospace", background: "rgba(255,167,38,.2)", padding: "0px 5px", borderRadius: 3, color: "#ffd580", userSelect: "all" as const, letterSpacing: 1 }}>eval&nbsp;</span> to evaluate JS live. Click snippet to insert:
                </div>
                <EvalSnippetPanel setDraft={setDraft} />
            </div>
            <StatusTypeSelector value={draftStatusType} onChange={setDraftStatusType} />
            <ClearAfterSelector value={draftClearAfter} onChange={setDraftClearAfter} />
            {presets.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                    <span style={{ fontSize: 11, color: C.hint }}>Preset:</span>
                    <select value={draftPreset} onChange={e => setDraftPreset(e.target.value)}
                        style={{ flex: 1, background: "rgba(10,0,30,.7)", border: "1px solid rgba(124,77,255,.3)", borderRadius: 6, color: "#f0eaff", fontSize: 11, padding: "2px 6px", outline: "none" }}>
                        <option value="">- none -</option>
                        {presets.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                    </select>
                </div>
            )}
            <div style={{ marginBottom: 8 }}>
                <button className="rs-btn" style={{ background: C.status }} onClick={add}>+ Add</button>
            </div>

            <div className="rs-divider" />

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "7px 0 5px" }}>
                <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: ".8px", color: C.status }}>
                    Preset Groups
                </span>
                <span className="rs-count">{presets.length}</span>
            </div>
            <div className="rs-preset-pill-row">
                <button className="rs-preset-tag"
                    style={{ cursor: "pointer", opacity: filterPreset === null ? 1 : .5 }}
                    onClick={() => setFilterPreset(null)}>All ({list.length})</button>
                {presets.map(p => {
                    const cnt = list.filter(e => e.preset === p.name).length;
                    return (
                        <span key={p.id} style={{ display: "flex", alignItems: "center", gap: 3 }}>
                            <button className="rs-preset-tag"
                                style={{ cursor: "pointer", opacity: filterPreset === p.name ? 1 : .6 }}
                                onClick={() => setFilterPreset(filterPreset === p.name ? null : p.name)}>
                                {p.name} ({cnt})
                            </button>
                            <button className="rs-del-btn" onClick={() => removePreset(p.id)} title="Delete preset">✕</button>
                        </span>
                    );
                })}
            </div>
            {presets.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 6, padding: "6px 8px", border: "1px solid rgba(124,77,255,.18)", borderRadius: 7, background: "rgba(10,0,25,.4)" }}>
                    <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: ".6px", color: C.hint, marginBottom: 2 }}>Bulk clear after (per preset)</span>
                    {presets.map(p => {
                        const cur = list.find(e => e.preset === p.name)?.clearAfter ?? 0;
                        const [rawMin, setRawMin] = React.useState(cur > 0 ? String(Math.round(cur / 60000)) : "");
                        const commit = () => applyPresetClearAfter(p.name, minutesToMs(rawMin));
                        return (
                            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <span style={{ fontSize: 11, fontWeight: 700, color: "#ce93d8", minWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                                <input value={rawMin} onChange={e => setRawMin(e.target.value)} onBlur={commit}
                                    onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") commit(); }}
                                    placeholder="0 = never"
                                    style={{ width: 72, background: "rgba(10,0,30,.7)", border: "1px solid rgba(124,77,255,.3)", borderRadius: 5, color: "#f0eaff", fontSize: 11, padding: "2px 6px", outline: "none", fontFamily: "monospace" }} />
                                <span style={{ fontSize: 11, color: "#757575" }}>min</span>
                                <button className="rs-btn" style={{ background: "rgba(124,77,255,.25)", fontSize: 10, padding: "2px 9px" }} onClick={commit}>Apply all</button>
                            </div>
                        );
                    })}
                </div>
            )}
            <div className="rs-add-preset-row">
                <TextInput value={newPresetName} onChange={setNewPresetName} placeholder="New preset name..."
                    onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") addPreset(); }} />
                <Button size={Button.Sizes.SMALL} color={Button.Colors.BRAND} onClick={addPreset} className="rs-btn-sm">+ Preset</Button>
            </div>

            <div className="rs-divider" style={{ margin: "8px 0" }} />

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
                <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: ".8px", color: C.status }}>
                    List {filterPreset ? `"${filterPreset}"` : "- All"}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span className="rs-count">{filteredList.length}</span>
                    {list.length > 0 && <button className="rs-clearall" onClick={() => setConfirm(true)}>Clear All</button>}
                </div>
            </div>
            {filteredList.length === 0 && <div className="rs-empty">No entries yet. Add one above.</div>}
            <div style={{ maxHeight: 280, overflowY: "auto", paddingRight: 2 }}>
            {filteredList.map((entry, fi) => {
                const i = list.indexOf(entry);
                const isEdit = editIdx === i;
                const dot = STATUS_OPTIONS.find(s => s.value === (entry.status ?? "online"))?.color ?? "#23a55a";
                return (
                    <div key={`st_${i}`} {...dProps(fi)} className={cls(fi, "rs-item")}>
                        <span className="rs-drag">⠿</span>
                        {entry.emojiId
                            ? <img style={{ width: 16, height: 16, objectFit: "contain", flexShrink: 0 }} src={getEmojiUrl(entry.emojiId, entry.animated)} alt="" />
                            : entry.emojiName
                                ? <span className="rs-item-icon">{entry.emojiName}</span>
                                : null}
                        {isEdit ? (
                            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
                                <input autoFocus className="rs-item-input" value={editText}
                                    onChange={e => setEditText(e.target.value)}
                                    onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") saveEdit(i); if (e.key === "Escape") setEditIdx(null); }} />
                                <StatusTypeSelector value={editStatusType} onChange={setEditStatusType} />
                                <ClearAfterSelector value={editClearAfter} onChange={setEditClearAfter} />
                                {presets.length > 0 && (
                                    <select value={editPreset} onChange={e => setEditPreset(e.target.value)}
                                        style={{ background: "rgba(10,0,30,.7)", border: "1px solid rgba(124,77,255,.3)", borderRadius: 5, color: "#f0eaff", fontSize: 11, padding: "2px 5px", outline: "none" }}>
                                        <option value="">- no preset -</option>
                                        {presets.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                                    </select>
                                )}
                                <div style={{ display: "flex", gap: 4 }}>
                                    <button className="rs-btn" style={{ background: C.status, fontSize: 11, padding: "2px 9px" }} onClick={() => saveEdit(i)}>✓ Save</button>
                                    <button className="rs-btn" style={{ background: "rgba(100,80,140,.35)", fontSize: 11, padding: "2px 9px" }} onClick={() => setEditIdx(null)}>✕</button>
                                </div>
                            </div>
                        ) : (
                            <>
                                <span className="rs-item-text" style={{ flex: 1 }} onClick={() => startEdit(i)}>
                                    {entry.text || <em style={{ color: "#4a3a6a" }}>(emoji only)</em>}
                                </span>
                                {(entry.text?.startsWith("eval ") || entry.emojiName?.startsWith("eval ")) && (
                                    <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 6, background: "rgba(255,167,38,.15)", color: "#ffa726", fontWeight: 800, border: "1px solid rgba(255,167,38,.3)", flexShrink: 0 }}>EVAL</span>
                                )}
                                <span className="rs-entry-status-dot" style={{ background: dot }} title={entry.status ?? "online"} />
                                {entry.clearAfter && entry.clearAfter > 0 && (
                                    <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 6, background: "rgba(66,165,245,.12)", color: "#64b5f6", fontWeight: 800, border: "1px solid rgba(66,165,245,.25)", flexShrink: 0 }}>
                                        {msToLabel(entry.clearAfter)}
                                    </span>
                                )}
                                {entry.preset && <span className="rs-preset-tag" style={{ fontSize: 9 }}>{entry.preset}</span>}
                            </>
                        )}
                        {!isEdit && <button className="rs-del-btn" onClick={() => remove(i)}>✕</button>}
                    </div>
                );
            })}
            </div>
            {confirm && <ConfirmBox msg="Delete all status entries?" onConfirm={() => { statusEntries = []; statusSeqIdx = 0; statusLastVal = null; saveData(); forceUpdate(); setConfirm(false); }} onCancel={() => setConfirm(false)} />}
            <div className="rs-hint" style={{ marginTop: 6 }}>
                Ctrl+Enter to add · Enabled: <b style={{ color: settings.store.statusEnabled ? C.enabled : "#757575" }}>{settings.store.statusEnabled ? "yes" : "no"}</b> · Interval: <b style={{ color: C.data }}>{settings.store.statusIntervalSeconds}s</b> · Mode: <b style={{ color: "#ab47bc" }}>{settings.store.statusRandomize ? "random" : "seq"}</b>
            </div>
        </div>
    );
}

function OnCloseClanPanel({ forceUpdate }: { forceUpdate: () => void }) {
    const [enabled, setEnabled] = React.useState(closeClanEnabled);
    const [id, setId] = React.useState(closeClanId);

    const save = () => { closeClanId = id.trim(); void saveCloseConfig(); forceUpdate(); };

    const resolved = React.useMemo((): { name: string; tag: string | null } | null => {
        const v = id.trim();
        if (!/^\d{17,20}$/.test(v)) return null;
        try {
            updateDomTagCache();
            const gs = getGuildStore()?.getGuilds?.() ?? {};
            const g = gs[v];
            if (g) {
                const storeTag = g.clan?.tag ?? g.clanTag ?? g.clan?.identity_tag ?? g.clan?.identityTag ?? null;
                const tag = (storeTag ?? domTagCache.get(v) ?? clanServerNames[v]?.tag ?? null) as string | null;
                return { name: g.name as string, tag };
            }
            const saved = clanServerNames[v];
            if (saved) return saved;
        } catch {}
        return null;
    }, [id]);

    return (
        <div>
            <PanelToggle label="On-Close Clan" description="Switch to a specific clan server when Discord closes (beforeunload - not fired on crash/kill)"
                value={enabled} color={C.clan}
                onChange={v => { closeClanEnabled = v; setEnabled(v); void saveCloseConfig(); forceUpdate(); }} />
            {enabled && (
                <div style={{ display: "flex", flexDirection: "column", gap: 5, padding: "7px 10px", border: `1px solid ${C.clan}33`, borderRadius: 7, background: "rgba(10,20,50,.5)", marginTop: 3 }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <span style={{ fontSize: 11, color: C.hint, flexShrink: 0 }}>Clan Server ID:</span>
                        <input value={id} onChange={e => setId(e.target.value)} onBlur={save}
                            onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") save(); }}
                            placeholder="Server ID (17-20 digits)..."
                            style={{ flex: 1, background: "rgba(10,0,30,.7)", border: `1px solid ${C.clan}44`, borderRadius: 5, color: "#f0eaff", fontSize: 11, padding: "3px 7px", outline: "none", fontFamily: "monospace" }} />
                    </div>
                    {id.trim() && !/^\d{17,20}$/.test(id.trim()) && (
                        <div style={{ fontSize: 10, color: "#ef9a9a" }}>⚠ Invalid ID - must be 17-20 digits.</div>
                    )}
                    {resolved && (
                        <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 8px", borderRadius: 5, background: `${C.clan}10`, border: `1px solid ${C.clan}30` }}>
                            <span style={{ fontSize: 10, color: C.clan, fontWeight: 700 }}>✓ Detected:</span>
                            <span style={{ fontSize: 11, color: "#e8d5ff", fontWeight: 600, flex: 1 }}>{resolved.name}</span>
                            {resolved.tag
                                ? <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 8, background: `${C.clan}30`, color: C.clan, border: `1px solid ${C.clan}55`, fontWeight: 800 }}>[{resolved.tag}]</span>
                                : <span style={{ fontSize: 9, color: "#5a7a9a", opacity: .7 }}>no tag</span>
                            }
                        </div>
                    )}
                    {id.trim() && /^\d{17,20}$/.test(id.trim()) && !resolved && (
                        <div style={{ fontSize: 10, color: "#faa61a", opacity: .8 }}>⚠ Server not found in your guild list or cache.</div>
                    )}
                    <div style={{ fontSize: 10, color: C.hint, opacity: .7 }}>Paste the ID of the server whose clan badge you want to show upon closure.</div>
                </div>
            )}
        </div>
    );
}

function updateDomTagCache(): void {
    try {
        document.querySelectorAll<HTMLImageElement>('img[src*="/clan-badges/"]').forEach(img => {
            const m = img.src.match(/clan-badges\/(\d{17,20})\//);
            if (!m) return;
            const id = m[1];
            if (domTagCache.has(id)) return;
            const labeled = img.closest("[aria-label]");
            if (labeled) {
                const al = labeled.getAttribute("aria-label") ?? "";
                const am = al.match(/[:\uff1a]\s*(.+)$/);
                if (am?.[1]?.trim()) { domTagCache.set(id, am[1].trim()); return; }
            }
            const par = img.parentElement;
            if (!par) return;
            for (const sp of Array.from(par.querySelectorAll("span"))) {
                const t = sp.textContent?.trim() ?? "";
                if (t && t.length >= 1 && t.length <= 16 && !sp.querySelector("img") && !sp.querySelector("span")) {
                    domTagCache.set(id, t); return;
                }
            }
        });
    } catch {}
}

function ClanTab({ forceUpdate }: { forceUpdate: () => void }) {
    const [input, setInput] = React.useState("");
    const [editIdx, setEditIdx] = React.useState<number | null>(null);
    const [editVal, setEditVal] = React.useState("");
    const [confirm, setConfirm] = React.useState(false);
    const [showBrowser, setShowBrowser] = React.useState(false);
    const [browserFilter, setBrowserFilter] = React.useState("");
    const autoDetect = settings.store.clanAutoDetect;
    const detected = autoDetect ? getDiscordGuilds() : [];
    const { props: dProps, cls } = useDrag((f, t) => {
        clanIds = reorder(clanIds, f, t); clanSeqIdx = 0; clanLastVal = null;
        saveData(); forceUpdate();
    });

    function add() {
        const v = input.trim();
        if (!v || !/^\d{17,20}$/.test(v) || clanIds.includes(v)) return;
        const g = allDiscordGuilds.find(x => x.id === v);
        if (g) clanServerNames[v] = { name: g.name, tag: g.tag };
        clanIds = [...clanIds, v]; saveData(); setInput(""); forceUpdate();
    }
    function remove(id: string) { clanIds = clanIds.filter(c => c !== id); clanSeqIdx = 0; clanLastVal = null; saveData(); forceUpdate(); }
    function saveEdit(i: number) {
        const v = editVal.trim(); if (!v || !/^\d{17,20}$/.test(v)) { setEditIdx(null); return; }
        const oldId = clanIds[i];
        if (oldId !== v) delete clanServerNames[oldId];
        const g = allDiscordGuilds.find(x => x.id === v);
        if (g) clanServerNames[v] = { name: g.name, tag: g.tag };
        const n = [...clanIds]; n[i] = v; clanIds = n; saveData(); setEditIdx(null); forceUpdate();
    }

    const allDiscordGuilds = React.useMemo(() => {
        updateDomTagCache();
        try {
            const raw = Object.values(getGuildStore()?.getGuilds?.() ?? {}) as any[];
            const result = raw.map((g: any) => {
                const storeTag = g.clan?.tag ?? g.clanTag ?? g.clan?.identity_tag ?? g.clan?.identityTag ?? null;
                const tag = (storeTag ?? domTagCache.get(g.id) ?? null) as string | null;
                return { id: g.id as string, name: g.name as string, tag };
            });
            for (const g of result) {
                if (clanIds.includes(g.id)) clanServerNames[g.id] = { name: g.name, tag: g.tag };
            }
            return result;
        } catch { return []; }
    }, [showBrowser, autoDetect]);

    const clanGuilds = React.useMemo(() => {
        return allDiscordGuilds.filter(g => {
            if (g.tag) return true;
            try {
                const raw = (getGuildStore()?.getGuilds?.() ?? {})[g.id];
                const feat = raw?.features;
                if (!feat) return false;
                return Array.isArray(feat) ? feat.includes("CLAN") : (feat.has?.("CLAN") ?? false);
            } catch { return false; }
        });
    }, [allDiscordGuilds]);

    const browserGuilds = React.useMemo(() => {
        const source = allDiscordGuilds;
        if (!browserFilter.trim()) return source;
        const f = browserFilter.toLowerCase();
        return source.filter(g => g.name.toLowerCase().includes(f) || g.id.includes(f));
    }, [allDiscordGuilds, browserFilter]);

    return (
        <div>
            <div className="rs-settings-panel">
                <PanelToggle label="Enabled" description="Rotate your visible clan badge through server IDs" value={settings.store.clanEnabled} color={C.clan}
                    onChange={v => { settings.store.clanEnabled = v; if (pluginActive) { stopClanTimer(); if (v) scheduleClanLoop(); } }} />
                <PanelToggle label="Randomize" description="Pick clan randomly instead of in order" value={settings.store.clanRandomize}
                    onChange={v => { settings.store.clanRandomize = v; }} />
                <PanelToggle label="Auto-Detect" description="Automatically cycle through all your joined servers" value={settings.store.clanAutoDetect}
                    onChange={v => { settings.store.clanAutoDetect = v; cachedClanGuilds = []; lastClanFetch = 0; forceUpdate(); }} />
                <PanelInterval label="Interval" description="Seconds between clan changes (always independent timer)"
                    storeKey="clanIntervalSeconds"
                    onApply={() => { if (pluginActive && settings.store.clanEnabled) { stopClanTimer(); scheduleClanLoop(); } }} />
                {settings.store.clanAutoDetect && (
                    <PanelInterval label="Auto-Detect Refresh" description="How often to re-fetch your server list (seconds)"
                        storeKey="clanAutoDetectRefreshSeconds" />
                )}
                <div className="rs-divider" style={{ margin: "6px 0" }} />
                <OnCloseClanPanel forceUpdate={forceUpdate} />
            </div>
            <div className="rs-divider" style={{ margin: "8px 0" }} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
                <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: ".8px", color: C.clan }}>Clan IDs</span>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span className="rs-count">{autoDetect ? "auto" : `${clanIds.length}`}</span>
                    {!autoDetect && clanIds.length > 0 && <button className="rs-clearall" onClick={() => setConfirm(true)}>Clear All</button>}
                </div>
            </div>
            <div className="rs-hint" style={{ marginBottom: 8 }}>
                {autoDetect ? <span>Auto-Detect <b style={{ color: C.enabled }}>ON</b> - cycling all joined servers.</span>
                    : <span>Server IDs to rotate clan tag. Click ID to edit inline.</span>}
            </div>
            {confirm && <ConfirmBox msg="Delete all clan IDs?" onConfirm={() => { clanIds = []; clanSeqIdx = 0; clanLastVal = null; saveData(); forceUpdate(); setConfirm(false); }} onCancel={() => setConfirm(false)} />}
            {autoDetect ? (
                <div style={{ padding: "8px 10px", border: "1px solid rgba(66,165,245,.2)", borderRadius: 8, marginBottom: 8, background: "rgba(10,20,50,.6)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                        <span className="rs-hint" style={{ flex: 1 }}>Cycling <b style={{ color: C.clan }}>{allDiscordGuilds.length}</b> servers {clanGuilds.length > 0 && <span style={{ color: "#5a7a9a" }}>({clanGuilds.length} with clan tag)</span>}</span>
                        <TextInput placeholder="Filter..." value={browserFilter} onChange={setBrowserFilter} />
                    </div>
                    <div style={{ maxHeight: 200, overflowY: "auto" as const }}>
                        {browserGuilds.length === 0 && <div className="rs-empty">No servers found.</div>}
                        {browserGuilds.map(g => (
                            <div className="rs-item rs-item-compact" key={g.id} style={{ marginBottom: 2 }}>
                                <div style={{ width: 6, height: 6, borderRadius: "50%", background: colorFor(g.id), flexShrink: 0 }} />
                                <span className="rs-item-text" style={{ flex: 1 }}>{g.name}</span>
                                {g.tag && <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 8, background: `${C.clan}22`, color: C.clan, border: `1px solid ${C.clan}33`, fontWeight: 800, flexShrink: 0 }}>[{g.tag}]</span>}
                                <span style={{ fontSize: 9, color: "#5a7a9a", fontFamily: "monospace", flexShrink: 0, userSelect: "text" as const, cursor: "text" }}>{g.id}</span>
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                <>
                    {clanIds.length === 0 && <div className="rs-empty" style={{ marginBottom: 6 }}>No clan IDs yet.</div>}
                    <div style={{ maxHeight: 220, overflowY: "auto", paddingRight: 2 }}>
                        {clanIds.map((id, i) => {
                            const currentG = allDiscordGuilds.find(x => x.id === id);
                            const saved = clanServerNames[id];
                            const inGuild = !!currentG;
                            const displayName = currentG?.name ?? saved?.name ?? null;
                            const displayTag = currentG?.tag ?? saved?.tag ?? null;
                            return (
                            <div key={id} {...dProps(i)} className={cls(i, "rs-item")}>
                                <span className="rs-drag">⠿</span>
                                {editIdx === i
                                    ? <input autoFocus className="rs-item-input" value={editVal}
                                        onChange={e => setEditVal(e.target.value)}
                                        onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") saveEdit(i); if (e.key === "Escape") setEditIdx(null); }}
                                        onBlur={() => saveEdit(i)} />
                                    : <span className="rs-item-mono" onClick={() => { setEditIdx(i); setEditVal(id); }}>{id}</span>
                                }
                                <span style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0, maxWidth: 220, overflow: "hidden" }}>
                                    {displayTag && <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 8, background: `${C.clan}30`, color: C.clan, border: `1px solid ${C.clan}55`, fontWeight: 800, flexShrink: 0 }}>[{displayTag}]</span>}
                                    {displayName
                                        ? <span style={{ fontSize: 10, color: inGuild ? C.text : "#faa61a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, maxWidth: 160 }} title={displayName}>{displayName}</span>
                                        : <span style={{ fontSize: 9, color: "#5a7a9a", fontStyle: "italic", flexShrink: 0 }}>? not found</span>
                                    }
                                    {!inGuild && displayName && <span style={{ fontSize: 8, color: "#faa61a", fontWeight: 800, flexShrink: 0, padding: "1px 4px", borderRadius: 4, background: "rgba(250,166,26,.12)", border: "1px solid rgba(250,166,26,.25)" }}>left</span>}
                                </span>
                                <button className="rs-del-btn" onClick={() => remove(id)}>✕</button>
                            </div>
                            );
                        })}
                    </div>
                    <div className="rs-row" style={{ marginTop: 6 }}>
                        <TextInput value={input} onChange={setInput} placeholder="Server ID (17-20 digits)..."
                            onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") add(); }} />
                        <Button size={Button.Sizes.SMALL} color={Button.Colors.BRAND} onClick={add} className="rs-btn-sm">Add</Button>
                    </div>
                </>
            )}
            <div className="rs-hint" style={{ marginTop: 6 }}>
                Enabled: <b style={{ color: settings.store.clanEnabled ? C.enabled : "#757575" }}>{settings.store.clanEnabled ? "yes" : "no"}</b> · Interval: <b style={{ color: C.data }}>{settings.store.clanIntervalSeconds}s</b> · Mode: <b style={{ color: "#ab47bc" }}>{settings.store.clanRandomize ? "random" : "seq"}</b>
            </div>

            {!autoDetect && (
                <div style={{ marginTop: 10 }}>
                    <button
                        onClick={() => { setShowBrowser(!showBrowser); setBrowserFilter(""); }}
                        style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", padding: "7px 12px", borderRadius: 8, border: `1px solid ${showBrowser ? C.clan + "55" : "rgba(66,165,245,.2)"}`, background: showBrowser ? `${C.clan}14` : "rgba(10,20,50,.5)", color: showBrowser ? C.clan : "#5a7a9a", cursor: "pointer", fontSize: 11, fontWeight: 800, textAlign: "left" as const }}>
                        <span style={{ fontSize: 13 }}>{showBrowser ? "▾" : "▸"}</span>
                        Browse Clan Servers
                        <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 10, background: `${C.clan}22`, color: C.clan, marginLeft: 4 }}>{clanGuilds.length > 0 ? `${clanGuilds.length} with tag` : `${allDiscordGuilds.length} servers`}</span>
                        {!showBrowser && <span style={{ fontSize: 9, color: "#5a7a9a", fontWeight: 600, marginLeft: "auto" }}>hidden by default</span>}
                    </button>

                    {showBrowser && (
                        <div style={{ marginTop: 6, padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.clan}33`, background: "rgba(5,15,40,.7)" }}>
                            <div className="rs-hint" style={{ marginBottom: 4 }}>
                                <b style={{ color: C.clan }}>+</b> to add · <b style={{ color: ACT }}>✕</b> to remove
                            </div>
                            <div style={{ fontSize: 10, color: "#faa61a", padding: "3px 7px", borderRadius: 5, background: "rgba(250,166,26,.08)", border: "1px solid rgba(250,166,26,.18)", marginBottom: 6 }}>
                                ⚠ Tag detection uses the internal store + DOM scan. Tags may not appear if Discord hasn't rendered the clan selector yet.
                            </div>
                            <TextInput placeholder="Filter by name or ID..." value={browserFilter} onChange={setBrowserFilter} />
                            <div style={{ marginTop: 6, maxHeight: 260, overflowY: "auto" as const }}>
                                {browserGuilds.length === 0 && <div className="rs-empty">No servers match your filter.</div>}
                                {browserGuilds.map(g => {
                                    const inList = clanIds.includes(g.id);
                                    return (
                                        <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 6px", borderRadius: 6, marginBottom: 2, background: inList ? `${ACT}0e` : "rgba(255,255,255,.02)", border: `1px solid ${inList ? ACT + "33" : "transparent"}` }}>
                                            <div style={{ width: 6, height: 6, borderRadius: "50%", background: colorFor(g.id), flexShrink: 0 }} title={g.id} />
                                            <span style={{ flex: 1, fontSize: 11, color: inList ? ACT : C.text, fontWeight: inList ? 700 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }} title={g.name}>{g.name}</span>
                                            {g.tag
                                                ? <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 8, background: `${C.clan}35`, color: C.clan, border: `1px solid ${C.clan}55`, fontWeight: 800, flexShrink: 0 }}>[{g.tag}]</span>
                                                : <span style={{ fontSize: 9, color: "#5a7a9a", fontWeight: 600, flexShrink: 0, opacity: 0.6 }}>?tag</span>
                                            }
                                            <span style={{ fontSize: 9, color: "#5a7a9a", fontFamily: "monospace", flexShrink: 0, userSelect: "all" as const, cursor: "text", padding: "1px 4px", borderRadius: 3, background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.06)" }} title="Click to select ID">{g.id}</span>
                                            {inList
                                                ? <button onClick={() => { clanIds = clanIds.filter(c => c !== g.id); clanSeqIdx = 0; clanLastVal = null; saveData(); forceUpdate(); }}
                                                    style={{ padding: "2px 8px", borderRadius: 5, border: `1px solid ${INACT}44`, background: `${INACT}18`, color: INACT, cursor: "pointer", fontSize: 10, fontWeight: 800, flexShrink: 0 }}>✕</button>
                                                : <button onClick={() => { clanIds = [...clanIds, g.id]; saveData(); forceUpdate(); }}
                                                    style={{ padding: "2px 8px", borderRadius: 5, border: `1px solid ${C.clan}44`, background: `${C.clan}18`, color: C.clan, cursor: "pointer", fontSize: 10, fontWeight: 800, flexShrink: 0 }}>+</button>
                                            }
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function RndBtn({ value, color, onChange }: { value: boolean; color: string; onChange: (v: boolean) => void }) {
    return (
        <button
            onClick={() => onChange(!value)}
            style={{
                display: "flex", alignItems: "center", gap: 5, padding: "3px 10px",
                borderRadius: 6, border: `1px solid ${value ? color + "55" : "rgba(80,60,110,.35)"}`,
                background: value ? `${color}20` : "rgba(15,5,35,.55)",
                color: value ? color : "#5a4a7a", cursor: "pointer",
                fontSize: 11, fontWeight: 800, flexShrink: 0,
                transition: "all .15s",
            }}>
            <span style={{ fontSize: 12 }}>{value ? "⟳" : "→"}</span>
            {value ? "Random" : "Sequential"}
        </button>
    );
}

function SectionHeader({ label, color, count, enabled, onToggleEnabled, rndValue, onToggleRnd, enableColor }: {
    label: string; color: string; count?: number;
    enabled: boolean; onToggleEnabled: (v: boolean) => void;
    rndValue: boolean; onToggleRnd: (v: boolean) => void;
    enableColor?: string;
}) {
    const ec = enableColor ?? C.enabled;
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: ".8px", color }}>{label}</span>
            {count !== undefined && <span className="rs-count">{count}</span>}
            <div style={{ flex: 1, height: 1, background: `${color}33` }} />
            <RndBtn value={rndValue} color={color} onChange={onToggleRnd} />
            <button
                onClick={() => onToggleEnabled(!enabled)}
                style={{
                    display: "flex", alignItems: "center", gap: 4, padding: "3px 10px",
                    borderRadius: 6, border: `1px solid ${enabled ? ec + "55" : "rgba(80,60,110,.35)"}`,
                    background: enabled ? `${ec}20` : "rgba(15,5,35,.55)",
                    color: enabled ? ec : "#5a4a7a", cursor: "pointer",
                    fontSize: 11, fontWeight: 800, flexShrink: 0,
                    transition: "all .15s",
                }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: enabled ? ec : "#3a2a5a", display: "inline-block", flexShrink: 0 }} />
                {enabled ? "Enabled" : "Disabled"}
            </button>
        </div>
    );
}

function ProfileTab({ forceUpdate }: { forceUpdate: () => void }) {
    const [bioDraft, setBioDraft] = React.useState("");
    const [bioEditIdx, setBioEditIdx] = React.useState<number | null>(null);
    const [bioEditVal, setBioEditVal] = React.useState("");
    const [prDraft, setPrDraft] = React.useState("");
    const [prEditIdx, setPrEditIdx] = React.useState<number | null>(null);
    const [prEditVal, setPrEditVal] = React.useState("");
    const [gnDraft, setGnDraft] = React.useState("");
    const [gnEditIdx, setGnEditIdx] = React.useState<number | null>(null);
    const [gnEditVal, setGnEditVal] = React.useState("");
    const [confirmBio, setConfirmBio] = React.useState(false);
    const [confirmPr, setConfirmPr] = React.useState(false);
    const [confirmGn, setConfirmGn] = React.useState(false);
    const prList = parseList(pronounsList);

    const { props: bioDProps, cls: bioCls } = useDrag((f, t) => { bioEntries = reorder(bioEntries, f, t); bioSeqIdx = 0; bioLastVal = null; saveData(); forceUpdate(); });
    const { props: prDProps, cls: prCls } = useDrag((f, t) => { pronounsList = reorder(prList, f, t).join("§"); prSeqIdx = 0; prLastVal = null; saveData(); forceUpdate(); });
    const { props: gnDProps, cls: gnCls } = useDrag((f, t) => { globalNickEntries = reorder(globalNickEntries, f, t); globalNickSeqIdx = 0; globalNickLastVal = null; saveData(); forceUpdate(); });

    function addBio() { const v = bioDraft.trim(); if (!v) return; bioEntries = [...bioEntries, v]; saveData(); setBioDraft(""); forceUpdate(); }
    function removeBio(i: number) { bioEntries = bioEntries.filter((_, j) => j !== i); if (bioEditIdx === i) setBioEditIdx(null); bioSeqIdx = 0; bioLastVal = null; saveData(); forceUpdate(); }
    function saveBioEdit(i: number) { const v = bioEditVal.trim(); if (!v) { setBioEditIdx(null); return; } bioEntries = [...bioEntries]; bioEntries[i] = v; saveData(); setBioEditIdx(null); forceUpdate(); }
    function addPronoun() { const v = prDraft.trim(); if (!v || prList.includes(v)) return; pronounsList = [...prList, v].join("§"); saveData(); setPrDraft(""); forceUpdate(); }
    function removePronoun(i: number) { pronounsList = prList.filter((_, j) => j !== i).join("§"); prSeqIdx = 0; prLastVal = null; saveData(); forceUpdate(); }
    function savePrEdit(i: number) { const v = prEditVal.trim(); if (!v) { setPrEditIdx(null); return; } const n = [...prList]; n[i] = v; pronounsList = n.join("§"); saveData(); setPrEditIdx(null); forceUpdate(); }
    function addGn() { const v = gnDraft.trim(); if (!v || globalNickEntries.includes(v)) return; globalNickEntries = [...globalNickEntries, v]; saveData(); setGnDraft(""); forceUpdate(); }
    function removeGn(i: number) { globalNickEntries = globalNickEntries.filter((_, j) => j !== i); globalNickSeqIdx = 0; globalNickLastVal = null; saveData(); forceUpdate(); }
    function saveGnEdit(i: number) { const v = gnEditVal.trim(); if (!v) { setGnEditIdx(null); return; } globalNickEntries = [...globalNickEntries]; globalNickEntries[i] = v; saveData(); setGnEditIdx(null); forceUpdate(); }

    return (
        <div>

            <div className="rs-card">
                <SectionHeader
                    label="Global Display Name" color={C.nick} count={globalNickEntries.length}
                    enabled={settings.store.globalNickEnabled}
                    onToggleEnabled={v => { settings.store.globalNickEnabled = v; if (pluginActive) { stopGlobalNickTimer(); if (v && !settings.store.globalSync) scheduleGlobalNickLoop(); } forceUpdate(); }}
                    rndValue={settings.store.globalNickRandomize} onToggleRnd={v => { settings.store.globalNickRandomize = v; forceUpdate(); }}
                    enableColor={C.nick}
                />
                <PanelInterval label="Display Name Interval" description="Seconds between display name changes. Min enforced: 429s. Uses /users/@me global_name - separate endpoint from bio/pronouns."
                    storeKey="globalNickIntervalSeconds" disabled={settings.store.globalSync}
                    onApply={() => { if (pluginActive && settings.store.globalNickEnabled && !settings.store.globalSync) { stopGlobalNickTimer(); scheduleGlobalNickLoop(); } }} />
                <div className="rs-hint" style={{ margin: "4px 0 6px" }}>
                    Changes your <b style={{ color: C.nick }}>global display name</b> via <b style={{ color: C.hint }}>/users/@me</b> (global_name). Max 32 chars. Minimum interval: 429s.
                </div>
                <div className="rs-divider" style={{ margin: "5px 0 6px" }} />
                {confirmGn && <ConfirmBox msg="Delete all display name entries?" onConfirm={() => { globalNickEntries = []; globalNickSeqIdx = 0; globalNickLastVal = null; saveData(); forceUpdate(); setConfirmGn(false); }} onCancel={() => setConfirmGn(false)} />}
                {globalNickEntries.length === 0 && <div className="rs-empty" style={{ marginBottom: 5 }}>No display name entries yet.</div>}
                <div style={{ maxHeight: 180, overflowY: "auto", paddingRight: 2 }}>
                {globalNickEntries.map((n, i) => (
                    <div key={`gn_${i}_${n}`} {...gnDProps(i)} className={gnCls(i, "rs-item rs-item-compact")}>
                        <span className="rs-drag">⠿</span>
                        {gnEditIdx === i
                            ? <input autoFocus className="rs-item-input" value={gnEditVal}
                                onChange={e => setGnEditVal(e.target.value)}
                                onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") saveGnEdit(i); if (e.key === "Escape") setGnEditIdx(null); }}
                                onBlur={() => saveGnEdit(i)} maxLength={32} />
                            : <span className="rs-item-text" style={{ fontWeight: 600, color: C.nick }} onClick={() => { setGnEditIdx(i); setGnEditVal(n); }}>{n}</span>
                        }
                        <span style={{ fontSize: 9, color: "#757575" }}>{n.length}/32</span>
                        <button className="rs-edit-btn" onClick={() => { setGnEditIdx(i); setGnEditVal(n); }}>&#9998;</button>
                        <button className="rs-del-btn" onClick={() => removeGn(i)}>&#10005;</button>
                    </div>
                ))}
                </div>
                <div className="rs-row" style={{ marginTop: 5 }}>
                    <TextInput value={gnDraft} onChange={(v: string) => setGnDraft(v.slice(0, 32))} placeholder="Add display name (max 32)..."
                        onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") addGn(); }} />
                    <Button size={Button.Sizes.SMALL} color={Button.Colors.BRAND} onClick={addGn} className="rs-btn-sm">Add</Button>
                    {globalNickEntries.length > 0 && <button className="rs-clearall" onClick={() => setConfirmGn(true)}>Clear</button>}
                </div>
            </div>

            <div className="rs-card" style={{ marginBottom: 8 }}>
                <SectionHeader
                    label="Global Pronouns" color={C.pronoun} count={prList.length}
                    enabled={settings.store.profilePronounsEnabled}
                    onToggleEnabled={v => { settings.store.profilePronounsEnabled = v; if (pluginActive) { stopPronounsTimer(); if (v && !settings.store.globalSync) schedulePronounsLoop(); } forceUpdate(); }}
                    rndValue={settings.store.pronounsRandomize} onToggleRnd={v => { settings.store.pronounsRandomize = v; forceUpdate(); }}
                    enableColor={C.pronoun}
                />
                <PanelInterval label="Pronouns Interval" description="Seconds between global pronoun changes (ignored when Master Sync is ON)"
                    storeKey="pronounsIntervalSeconds" disabled={settings.store.globalSync}
                    onApply={() => { if (pluginActive && settings.store.profilePronounsEnabled && !settings.store.globalSync) { stopPronounsTimer(); schedulePronounsLoop(); } }} />
                <div className="rs-hint" style={{ margin: "4px 0 6px" }}>Applied globally via <b style={{ color: C.hint }}>/users/@me/profile</b>. Drag to reorder.</div>
                <div className="rs-divider" style={{ margin: "5px 0 6px" }} />
                {confirmPr && <ConfirmBox msg="Delete all pronouns?" onConfirm={() => { pronounsList = ""; prSeqIdx = 0; prLastVal = null; saveData(); forceUpdate(); setConfirmPr(false); }} onCancel={() => setConfirmPr(false)} />}
                {prList.length === 0 && <div className="rs-empty" style={{ marginBottom: 5 }}>No pronouns yet.</div>}
                <div style={{ maxHeight: 160, overflowY: "auto", paddingRight: 2 }}>
                {prList.map((p, i) => (
                    <div key={`pr_${i}_${p}`} {...prDProps(i)} className={prCls(i, "rs-item rs-item-compact")}>
                        <span className="rs-drag">⠿</span>
                        {prEditIdx === i
                            ? <input autoFocus className="rs-item-input" value={prEditVal} maxLength={40}
                                onChange={e => setPrEditVal(e.target.value)}
                                onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") savePrEdit(i); if (e.key === "Escape") setPrEditIdx(null); }}
                                onBlur={() => savePrEdit(i)} />
                            : <span className="rs-item-text" style={{ flex: 1, fontSize: 12, color: C.pronoun, fontWeight: 600 }}
                                onClick={() => { setPrEditIdx(i); setPrEditVal(p); }}
                                onDoubleClick={() => { setPrEditIdx(i); setPrEditVal(p); }}>{p}</span>
                        }
                        <button className="rs-edit-btn" onClick={() => { setPrEditIdx(i); setPrEditVal(p); }}>&#9998;</button>
                        <button className="rs-del-btn" onClick={() => removePronoun(i)}>&#10005;</button>
                    </div>
                ))}
                </div>
                <div className="rs-row" style={{ marginTop: 5 }}>
                    <TextInput value={prDraft} onChange={setPrDraft} placeholder="Add pronoun (e.g. he/him)..."
                        onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") addPronoun(); }} />
                    <Button size={Button.Sizes.SMALL} color={Button.Colors.BRAND} onClick={addPronoun} className="rs-btn-sm">Add</Button>
                    {prList.length > 0 && <button className="rs-clearall" onClick={() => setConfirmPr(true)}>Clear</button>}
                </div>
            </div>

            <div className="rs-card" style={{ marginBottom: 8 }}>
                <SectionHeader
                    label="Bio" color={C.bio} count={bioEntries.length}
                    enabled={settings.store.profileBioEnabled}
                    onToggleEnabled={v => { settings.store.profileBioEnabled = v; if (pluginActive) { stopBioTimer(); if (v && !settings.store.globalSync) scheduleBioLoop(); } forceUpdate(); }}
                    rndValue={settings.store.bioRandomize} onToggleRnd={v => { settings.store.bioRandomize = v; forceUpdate(); }}
                    enableColor={C.bio}
                />
                <PanelInterval label="Bio Interval" description="Seconds between bio changes (ignored when Master Sync is ON)"
                    storeKey="bioIntervalSeconds" disabled={settings.store.globalSync}
                    onApply={() => { if (pluginActive && settings.store.profileBioEnabled && !settings.store.globalSync) { stopBioTimer(); scheduleBioLoop(); } }} />
                <div className="rs-divider" style={{ margin: "7px 0 6px" }} />
                {confirmBio && <ConfirmBox msg="Delete all bio entries?" onConfirm={() => { bioEntries = []; bioSeqIdx = 0; bioLastVal = null; saveData(); forceUpdate(); setConfirmBio(false); }} onCancel={() => setConfirmBio(false)} />}
                <div className="rs-bio-list">
                    {bioEntries.length === 0 && <div className="rs-empty">No bio entries - add below.</div>}
                    {bioEntries.map((e, i) => (
                        <div key={`bio_${i}_${e.slice(0, 8)}`} {...bioDProps(i)} className={bioCls(i, `rs-bio-item${bioEditIdx === i ? " editing" : ""}`)}>
                            <span className="rs-drag" style={{ padding: "5px 3px", display: "flex", alignItems: "center", alignSelf: "stretch" }}>⠿</span>
                            {bioEditIdx === i
                                ? <textarea autoFocus className="rs-bio-edit-area" value={bioEditVal}
                                    onChange={ev => setBioEditVal(ev.target.value)}
                                    onKeyDown={(ev: React.KeyboardEvent) => { if (ev.key === "Enter" && ev.ctrlKey) saveBioEdit(i); if (ev.key === "Escape") setBioEditIdx(null); }} />
                                : <div className="rs-bio-view" onClick={() => { setBioEditIdx(i); setBioEditVal(e); }}>{e}</div>
                            }
                            <div className="rs-bio-btns">
                                {bioEditIdx === i
                                    ? (<><button className="rs-bio-btn save" onClick={() => saveBioEdit(i)}>&#10004;</button><button className="rs-bio-btn" onClick={() => setBioEditIdx(null)}>&#10005;</button></>)
                                    : (<><button className="rs-bio-btn" onClick={() => { setBioEditIdx(i); setBioEditVal(e); }}>&#9998;</button><button className="rs-bio-btn del" onClick={() => removeBio(i)}>&#10005;</button></>)
                                }
                            </div>
                        </div>
                    ))}
                </div>
                <div className="rs-add-row">
                    <textarea value={bioDraft} onChange={e => setBioDraft(e.target.value)} placeholder="New bio entry... (multi-line OK)"
                        onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter" && e.ctrlKey) { e.preventDefault(); addBio(); } }} />
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <button className="rs-btn" style={{ background: C.bio }} onClick={addBio}>Add</button>
                        {bioEntries.length > 0 && <button className="rs-clearall" onClick={() => setConfirmBio(true)}>Clear</button>}
                    </div>
                </div>
                <div className="rs-hint" style={{ marginTop: 3 }}>Click to edit · Drag to reorder · Ctrl+Enter to add · Interval: <b style={{ color: C.data }}>{settings.store.bioIntervalSeconds}s</b></div>
            </div>

        </div>
    );
}

const arSaveData = (): Promise<void> => DataStore.set(AR_SK, { avatars: arAvatars, seqIndex: arSeqIndex, shuffleQueue: arShuffleQueue } as ArStoreData);

function arGetExcluded(): string[] {
    return settings.store.avatarExcludedExtensions.split(",").map((s: string) => s.trim().toLowerCase()).filter(Boolean);
}
function arSetExcluded(arr: string[]) { settings.store.avatarExcludedExtensions = arr.join(","); }

function arSfShuffle(len: number): number[] {
    const a = Array.from({ length: len }, (_, i) => i);
    for (let i = len - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
}

function arToast(msg: string, type: typeof Toasts.Type[keyof typeof Toasts.Type] = Toasts.Type.SUCCESS) {
    if (!settings.store.avatarShowToast) return;
    Toasts.show({ message: msg, type, id: Toasts.genId() });
}

function arGetExt(data: string): string {
    const m = data.match(/^data:image\/([a-z0-9]+);/i);
    if (!m) return "?";
    return m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase();
}

function arIsGif(data: string) { return /^data:image\/gif;/i.test(data); }

function arStampGif(data: string): string {
    try {
        const b64 = data.split(",")[1];
        if (!b64) return data;
        const raw = atob(b64);
        const n = raw.length;
        const src = new Uint8Array(n);
        for (let i = 0; i < n; i++) src[i] = raw.charCodeAt(i);
        if (src[0] !== 0x47 || src[1] !== 0x49 || src[2] !== 0x46) return data;
        let tp = n - 1;
        while (tp > 6 && src[tp] !== 0x3B) tp--;
        if (tp <= 6) return data;
        const stamp = new TextEncoder().encode(Date.now().toString(36));
        const sLen = Math.min(stamp.length, 255);
        const ext = new Uint8Array(sLen + 4);
        ext[0] = 0x21; ext[1] = 0xFE; ext[2] = sLen;
        ext.set(stamp.subarray(0, sLen), 3); ext[sLen + 3] = 0x00;
        const out = new Uint8Array(tp + ext.length + 1);
        out.set(src.subarray(0, tp)); out.set(ext, tp); out[out.length - 1] = 0x3B;
        const C = 0x8000;
        let bin = "";
        for (let i = 0; i < out.length; i += C) bin += String.fromCharCode(...out.subarray(i, Math.min(i + C, out.length)));
        return "data:image/gif;base64," + btoa(bin);
    } catch { return data; }
}

function arFmtSec(s: number): string {
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60), r = s % 60;
    if (s < 3600) return r === 0 ? `${m}m` : `${m}m ${r}s`;
    const h = Math.floor(s / 3600), mr = Math.floor((s % 3600) / 60);
    return mr === 0 ? `${h}h` : `${h}h ${mr}m`;
}

function arFmtPreset(s: number) {
    if (s % 3600 === 0) return `${s / 3600}h`;
    if (s % 60 === 0) return `${s / 60}m`;
    return `${s}s`;
}

function arUid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
function arReorderArr<T>(arr: T[], from: number, to: number): T[] { const r = [...arr]; const [x] = r.splice(from, 1); r.splice(to, 0, x); return r; }

async function arBlobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(blob); });
}

async function arPrepareForDiscord(data: string): Promise<string> {
    const ext = arGetExt(data);
    if (ext === "gif") return data;
    const okExts = ["png", "jpg", "jpeg", "webp"];
    const bytes = (data.split(",")[1]?.length ?? 0) * 0.75;
    if (okExts.includes(ext) && bytes < 8_000_000) return data;
    return new Promise<string>((res, rej) => {
        const img = new Image();
        img.onload = () => {
            let w = img.naturalWidth, h = img.naturalHeight;
            const MAX = 1024;
            if (w > MAX || h > MAX) { const s = MAX / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
            const c = document.createElement("canvas"); c.width = w; c.height = h;
            c.getContext("2d")!.drawImage(img, 0, 0, w, h);
            res(c.toDataURL("image/png"));
        };
        img.onerror = rej; img.src = data;
    });
}

async function arGifFirstFramePng(data: string, cropParams?: CropParams): Promise<string> {
    const S = AR_EXP_S;
    return new Promise<string>((res, rej) => {
        const img = new Image();
        img.onload = () => {
            const c = document.createElement("canvas"); c.width = S; c.height = S;
            const ctx = c.getContext("2d")!;
            if (cropParams) {
                const ratio = S / AR_CIRC_D;
                ctx.save();
                ctx.translate(S / 2 + cropParams.ox * ratio, S / 2 + cropParams.oy * ratio);
                ctx.rotate(cropParams.rot * Math.PI / 180);
                ctx.scale(cropParams.zoom * ratio, cropParams.zoom * ratio);
                ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
                ctx.restore();
            } else {
                ctx.drawImage(img, 0, 0, S, S);
            }
            res(c.toDataURL("image/png"));
        };
        img.onerror = rej;
        img.src = data;
    });
}

async function arGenPreview(data: string, cropParams?: CropParams): Promise<string> {
    const S = 76;
    return new Promise<string>(res => {
        const img = new Image();
        img.onload = () => {
            const c = document.createElement("canvas"); c.width = S; c.height = S;
            const ctx = c.getContext("2d")!;
            if (cropParams) {
                const ratio = S / AR_CIRC_D;
                ctx.save();
                ctx.translate(S / 2 + cropParams.ox * ratio, S / 2 + cropParams.oy * ratio);
                ctx.rotate(cropParams.rot * Math.PI / 180);
                ctx.scale(cropParams.zoom * ratio, cropParams.zoom * ratio);
                ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
                ctx.restore();
            } else { ctx.drawImage(img, 0, 0, S, S); }
            res(c.toDataURL("image/png"));
        };
        img.onerror = () => res(data);
        img.src = data;
    });
}

function arHasNitro(): boolean {
    try {
        const u = UserStore.getCurrentUser() as any;
        return (u?.premiumType ?? 0) >= 1 || u?.premium === true;
    } catch { return false; }
}

function arHasCrop(cp: CropParams | undefined): boolean {
    if (!cp) return false;
    return cp.ox !== 0 || cp.oy !== 0 || cp.rot !== 0;
}

async function arApplyAvatar(entry: AvatarEntry): Promise<void> {
    try {
        const isGif = arIsGif(entry.data);
        if (isGif) {
            let uploadData: string;
            if (arHasCrop(entry.cropParams)) {
                const { ox, oy, zoom, rot } = entry.cropParams!;
                uploadData = (await gifApplyCrop(entry.data, ox, oy, zoom, rot)) ?? arStampGif(entry.data);
            } else {
                uploadData = arStampGif(entry.data);
            }
            try {
                await RestAPI.patch({ url: "/users/@me", body: { avatar: uploadData } });
                if (!pluginActive) return;
                arToast(`Avatar → ${entry.label}`);
                return;
            } catch (gifErr: any) {
                const code = gifErr?.body?.code ?? gifErr?.status;
                const isNitroErr = code === 50035 || code === 10002 || String(gifErr?.body?.message ?? "").toLowerCase().includes("nitro");
                if (!isNitroErr) throw gifErr;
                const fb = await arGifFirstFramePng(entry.data, entry.cropParams);
                if (!pluginActive) return;
                await RestAPI.patch({ url: "/users/@me", body: { avatar: fb } });
                if (!pluginActive) return;
                arToast(`Avatar → ${entry.label} (static, Nitro required for animated)`);
                return;
            }
        }
        const data = await arPrepareForDiscord(entry.data);
        if (!pluginActive) return;
        if (!data?.split(",")[1] || data.split(",")[1].length < 10) throw new Error("Invalid image data");
        await RestAPI.patch({ url: "/users/@me", body: { avatar: data } });
        if (!pluginActive) return;
        arToast(`Avatar → ${entry.label}`);
    } catch (e: any) {
        const msg = e?.body?.errors?.avatar?._errors?.[0]?.message ?? e?.body?.message ?? e?.message ?? "Unknown";
        arToast(`Failed: ${msg}`, Toasts.Type.FAILURE);
    }
}

function arGetActive(): AvatarEntry[] {
    const excl = arGetExcluded();
    return excl.length ? arAvatars.filter(a => !excl.includes(arGetExt(a.data))) : [...arAvatars];
}

async function arRotateNext(): Promise<void> {
    if (!pluginActive) return;
    const active = arGetActive();
    if (!active.length) { arSchedule(); return; }
    let idx: number;
    if (settings.store.avatarRandom) { if (!arShuffleQueue.length) arShuffleQueue = arSfShuffle(active.length); idx = arShuffleQueue.shift()!; }
    else { idx = arSeqIndex % active.length; arSeqIndex = (arSeqIndex + 1) % active.length; }
    if (idx >= active.length) idx = 0;
    await arApplyAvatar(active[idx]);
    if (!pluginActive) return;
    await arSaveData();
    if (!pluginActive) return;
    arSchedule();
}

function arSchedule() {
    if (arRotatorTimer) clearTimeout(arRotatorTimer);
    if (!settings.store.avatarEnabled || !pluginActive || !arGetActive().length) return;
    arRotatorTimer = setTimeout(arRotateNext, Math.max(1, settings.store.avatarIntervalSeconds || AR_DEFAULT_S) * 1000);
}

function arStartRotator(immediate = false) {
    if (!pluginActive) return;
    if (arRotatorTimer) clearTimeout(arRotatorTimer);
    const active = arGetActive();
    if (settings.store.avatarRandom) arShuffleQueue = arSfShuffle(active.length);
    if (immediate && active.length) arRotateNext(); else arSchedule();
    arToast("Avatar Rotator started");
}

function arStopRotator() {
    if (arRotatorTimer) { clearTimeout(arRotatorTimer); arRotatorTimer = null; }
}

function arExportJSON() {
    const a = Object.assign(document.createElement("a"), {
        href: "data:application/json;charset=utf-8," + encodeURIComponent(JSON.stringify({ version: 6, avatars: arAvatars.map(({ label, data }) => ({ label, data })) }, null, 2)),
        download: "avatar-rotator.json",
    });
    a.click(); arToast("Exported");
}

async function arImportJSON(file: File): Promise<AvatarEntry[]> {
    const obj = JSON.parse(await file.text());
    const raw = Array.isArray(obj) ? obj : (obj.avatars ?? []);
    const out: AvatarEntry[] = [];
    for (const x of raw) {
        if (typeof x.data === "string" && typeof x.label === "string")
            out.push({ id: arUid(), label: x.label, data: x.data });
    }
    return out;
}

function ArExtBadge({ ext, excluded }: { ext: string; excluded?: boolean }) {
    const color = excluded ? "#6b7280" : (AR_EXT_COLORS[ext] ?? "#6b7280");
    return (
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, padding: "1px 5px", borderRadius: 4, background: color + "28", color, border: `1px solid ${color}55`, textTransform: "uppercase" as const, flexShrink: 0, textDecoration: excluded ? "line-through" : "none" }}>
            {ext}
        </span>
    );
}

function ArExtFilterChips({ excluded, onChange }: { excluded: string[]; onChange: (e: string[]) => void }) {
    return (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {AR_ALL_EXTS.map(ext => {
                const isEx = excluded.includes(ext);
                const color = isEx ? "#6b7280" : (AR_EXT_COLORS[ext] ?? "#6b7280");
                return (
                    <button key={ext} onClick={() => onChange(isEx ? excluded.filter(e => e !== ext) : [...excluded, ext])}
                        style={{ padding: "3px 9px", borderRadius: 5, fontSize: 11, fontWeight: 700, cursor: "pointer", outline: "none", border: `1px solid ${color}55`, background: color + "22", color, textDecoration: isEx ? "line-through" : "none", userSelect: "none" as const }}>
                        {ext.toUpperCase()}{isEx ? " ✕" : ""}
                    </button>
                );
            })}
        </div>
    );
}

function ArExtFilterSection({ excluded, onChange }: { excluded: string[]; onChange: (e: string[]) => void }) {
    return (
        <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <div>
                    <div style={{ fontSize: 13, color: AR.text, fontWeight: 600 }}>Skip Extensions During Rotation</div>
                    <div style={{ fontSize: 11, color: AR.sub, marginTop: 2 }}>Tagged avatars stay in list but are skipped when cycling</div>
                </div>
                {excluded.length > 0 && (
                    <button onClick={() => onChange([])} style={{ fontSize: 11, color: AR.red, background: "none", border: "none", cursor: "pointer", outline: "none" }}>Clear all</button>
                )}
            </div>
            <ArExtFilterChips excluded={excluded} onChange={onChange} />
        </div>
    );
}

function ArCropModal({ src, onApply, onSkip, modalProps }: { src: string; onApply: (d: string, cropParams?: CropParams) => void; onSkip: () => void; modalProps: any; }) {
    const [loaded, setLoaded] = React.useState(false);
    const [imgNat, setImgNat] = React.useState({ w: 1, h: 1 });
    const [offset, setOffS] = React.useState({ x: 0, y: 0 });
    const [zoom, setZoomS] = React.useState(1);
    const [rotation, setRotS] = React.useState(0);
    const [minZoom, setMinZoom] = React.useState(1);
    const zoomR = React.useRef(1);
    const rotR = React.useRef(0);
    const offR = React.useRef({ x: 0, y: 0 });
    const natR = React.useRef({ w: 1, h: 1 });
    const minZR = React.useRef(1);
    const drag = React.useRef(false);
    const lastP = React.useRef({ x: 0, y: 0 });
    const maskId = React.useRef("cm-" + arUid());
    const gif = arIsGif(src);

    const sync = (o: { x: number; y: number }, z: number, r: number) => {
        const cos = Math.abs(Math.cos(r * Math.PI / 180)), sin = Math.abs(Math.sin(r * Math.PI / 180));
        const { w, h } = natR.current;
        const bbW = (w * cos + h * sin) * z, bbH = (w * sin + h * cos) * z;
        const mx = Math.max(0, bbW / 2 - AR_CIRC_R), my = Math.max(0, bbH / 2 - AR_CIRC_R);
        return { x: Math.max(-mx, Math.min(mx, o.x)), y: Math.max(-my, Math.min(my, o.y)) };
    };

    const setAll = (o: { x: number; y: number }, z: number, r: number) => {
        const c = sync(o, z, r);
        zoomR.current = z; rotR.current = r; offR.current = c;
        setZoomS(z); setRotS(r); setOffS(c);
    };

    React.useEffect(() => {
        const img = new Image();
        img.onload = () => {
            const w = img.naturalWidth, h = img.naturalHeight;
            const mz = Math.max(AR_CIRC_D / w, AR_CIRC_D / h);
            natR.current = { w, h }; minZR.current = mz;
            setImgNat({ w, h }); setMinZoom(mz);
            setAll({ x: 0, y: 0 }, mz, 0);
            setLoaded(true);
        };
        img.src = src;
    }, []);

    const doApply = async () => {
        const cp: CropParams = { ox: offR.current.x, oy: offR.current.y, zoom: zoomR.current, rot: rotR.current };
        if (gif) { onApply(src, cp); modalProps.onClose(); return; }
        const img = new Image();
        img.crossOrigin = "anonymous";
        await new Promise<void>(r => { img.onload = () => r(); img.src = src; });
        const canvas = document.createElement("canvas");
        canvas.width = AR_EXP_S; canvas.height = AR_EXP_S;
        const ctx = canvas.getContext("2d")!;
        const ratio = AR_EXP_S / AR_CIRC_D;
        ctx.save();
        ctx.translate(AR_EXP_S / 2 + cp.ox * ratio, AR_EXP_S / 2 + cp.oy * ratio);
        ctx.rotate(cp.rot * Math.PI / 180);
        ctx.scale(cp.zoom * ratio, cp.zoom * ratio);
        ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
        ctx.restore();
        onApply(canvas.toDataURL("image/png"), cp);
        modalProps.onClose();
    };

    return (
        <ModalRoot {...modalProps} size="medium">
            <ModalHeader separator={false}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: AR.aD, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                            <circle cx="12" cy="12" r="9" stroke={AR.accent} strokeWidth="2"/>
                            <circle cx="12" cy="12" r="4" fill={AR.accent}/>
                        </svg>
                    </div>
                    <div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: AR.text }}>Edit Avatar</div>
                        <div style={{ fontSize: 11, color: AR.sub }}>Drag to reposition · Scroll or slider to zoom · Rotate</div>
                    </div>
                </div>
            </ModalHeader>
            <ModalContent style={{ padding: 0, overflow: "hidden" }}>
                <div style={{ width: "100%", height: AR_CONT_H, background: "#0b0b0e", position: "relative", cursor: loaded ? "grab" : "default", userSelect: "none", overflow: "hidden" }}
                    onPointerDown={e => { if (!loaded) return; drag.current = true; lastP.current = { x: e.clientX, y: e.clientY }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); e.preventDefault(); }}
                    onPointerMove={e => { if (!drag.current) return; const dx = e.clientX - lastP.current.x, dy = e.clientY - lastP.current.y; lastP.current = { x: e.clientX, y: e.clientY }; const no = sync({ x: offR.current.x + dx, y: offR.current.y + dy }, zoomR.current, rotR.current); offR.current = no; setOffS({ ...no }); }}
                    onPointerUp={() => { drag.current = false; }}
                    onPointerCancel={() => { drag.current = false; }}
                    onWheel={e => { if (!loaded) return; const z = Math.max(minZR.current, Math.min(minZR.current * 4, zoomR.current * (e.deltaY < 0 ? 1.08 : 0.92))); const c = sync(offR.current, z, rotR.current); zoomR.current = z; offR.current = c; setZoomS(z); setOffS({ ...c }); }}
                >
                    {loaded && (
                        <div style={{ position: "absolute", left: "50%", top: "50%", width: 0, height: 0, transform: `translate(${offset.x}px, ${offset.y}px)` }}>
                            <img src={src} draggable={false} style={{ position: "absolute", width: imgNat.w, height: imgNat.h, maxWidth: "none", transform: `translate(-50%, -50%) rotate(${rotation}deg) scale(${zoom})`, transformOrigin: "center center", pointerEvents: "none", userSelect: "none" }} />
                        </div>
                    )}
                    {!loaded && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: AR.sub, fontSize: 13 }}>Loading…</div>}
                    <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
                        <defs><mask id={maskId.current}><rect width="100%" height="100%" fill="white"/><circle cx="50%" cy="50%" r={AR_CIRC_R} fill="black"/></mask></defs>
                        <rect width="100%" height="100%" fill="rgba(0,0,0,.72)" mask={`url(#${maskId.current})`}/>
                        <circle cx="50%" cy="50%" r={AR_CIRC_R} fill="none" stroke="rgba(255,255,255,.85)" strokeWidth="2.5"/>
                    </svg>
                </div>
                <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill={AR.sub}><path fillRule="evenodd" clipRule="evenodd" d="M2 5a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V5Zm13.35 8.13 3.5 4.67c.37.5.02 1.2-.6 1.2H5.81a.75.75 0 0 1-.59-1.22l1.86-2.32a1.5 1.5 0 0 1 2.34 0l.5.64 2.23-2.97a2 2 0 0 1 3.2 0Z"/></svg>
                        <input type="range" min={minZoom} max={minZoom * 4} step={0.0005} value={zoom} disabled={!loaded}
                            onChange={e => { const z = Math.max(minZR.current, parseFloat(e.target.value)); const c = sync(offR.current, z, rotR.current); zoomR.current = z; offR.current = c; setZoomS(z); setOffS({ ...c }); }}
                            style={{ flex: 1, accentColor: AR.accent, cursor: loaded ? "pointer" : "default" } as React.CSSProperties} />
                        <svg width="19" height="19" viewBox="0 0 24 24" fill={AR.sub}><path fillRule="evenodd" clipRule="evenodd" d="M2 5a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V5Zm13.35 8.13 3.5 4.67c.37.5.02 1.2-.6 1.2H5.81a.75.75 0 0 1-.59-1.22l1.86-2.32a1.5 1.5 0 0 1 2.34 0l.5.64 2.23-2.97a2 2 0 0 1 3.2 0Z"/></svg>
                    </div>
                    <div>
                        <button disabled={!loaded} onClick={() => { const nr = (rotR.current + 90) % 360; rotR.current = nr; const c = sync(offR.current, zoomR.current, nr); offR.current = c; setRotS(nr); setOffS({ ...c }); }}
                            style={{ padding: "6px 14px", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: loaded ? "pointer" : "not-allowed", outline: "none", border: `1px solid ${AR.accent}44`, background: AR.aD, color: AR.accent, opacity: loaded ? 1 : 0.45 }}>
                            ↻ 90°
                        </button>
                    </div>
                    {gif && (
                        <div style={{ padding: "8px 11px", borderRadius: 7, background: `${AR.warn}15`, border: `1px solid ${AR.warn}40`, fontSize: 11, color: AR.warn, lineHeight: 1.5 }}>
                            🎞 <b>GIF:</b> Apply saves crop - animated on upload with Nitro, static without. Skip keeps original unchanged.
                        </div>
                    )}
                </div>
            </ModalContent>
            <ModalFooter separator={false}>
                <div style={{ display: "flex", width: "100%", alignItems: "center" }}>
                    <button disabled={!loaded} onClick={() => setAll({ x: 0, y: 0 }, minZR.current, 0)}
                        style={{ background: "none", border: "none", color: loaded ? AR.text : AR.sub, cursor: loaded ? "pointer" : "not-allowed", fontSize: 13, fontWeight: 500, padding: "0 4px", outline: "none" }}>
                        Reset
                    </button>
                    <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                        <button onClick={() => { onSkip(); modalProps.onClose(); }}
                            style={{ padding: "8px 18px", borderRadius: 7, fontSize: 13, fontWeight: 500, background: "transparent", border: `1px solid ${AR.line}`, color: AR.sub, cursor: "pointer", outline: "none" }}>
                            Skip
                        </button>
                        <button disabled={!loaded} onClick={doApply}
                            style={{ padding: "8px 18px", borderRadius: 7, fontSize: 13, fontWeight: 600, border: "none", cursor: loaded ? "pointer" : "not-allowed", background: loaded ? AR.accent : "rgba(156,103,255,.3)", color: "#fff", outline: "none", opacity: loaded ? 1 : 0.45 }}>
                            Apply
                        </button>
                    </div>
                </div>
            </ModalFooter>
        </ModalRoot>
    );
}

async function gifDecode(data: string): Promise<{ frames: Array<{ canvas: HTMLCanvasElement; delay: number }>; w: number; h: number; loops: number } | null> {
    if (typeof (window as any).ImageDecoder === "undefined") return null;
    try {
        const b64 = data.split(",")[1]; if (!b64) return null;
        const raw = atob(b64);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        if (bytes[0] !== 0x47 || bytes[1] !== 0x49 || bytes[2] !== 0x46) return null;
        const W = bytes[6] | (bytes[7] << 8), H = bytes[8] | (bytes[9] << 8);
        const dec = new (window as any).ImageDecoder({ data: bytes.buffer, type: "image/gif" });
        const frames: Array<{ canvas: HTMLCanvasElement; delay: number }> = [];
        let fi = 0;
        while (true) {
            let r: any;
            try { r = await dec.decode({ frameIndex: fi, completeFramesOnly: true }); fi++; } catch { break; }
            const vf = r.image;
            const delay = typeof vf.duration === "number" ? Math.max(20, Math.round(vf.duration / 1000)) : 100;
            const fc = document.createElement("canvas"); fc.width = W; fc.height = H;
            fc.getContext("2d")!.drawImage(vf, 0, 0, W, H);
            vf.close();
            frames.push({ canvas: fc, delay });
            await rsSleep(0);
            if (!pluginActive) return null;
        }
        dec.close();
        return frames.length ? { frames, w: W, h: H, loops: 0 } : null;
    } catch { return null; }
}

function gifLZWEnc(indices: Uint8Array, minCodeSize: number): Uint8Array {
    const cc = 1 << minCodeSize, eoi = cc + 1;
    const out: number[] = [];
    let buf = 0, bits = 0, cs = minCodeSize + 1, nxt = cc + 2;
    const emit = (code: number) => { buf |= code << bits; bits += cs; while (bits >= 8) { out.push(buf & 0xFF); buf >>>= 8; bits -= 8; } };
    const dict = new Map<number, number>();
    emit(cc);
    if (!indices.length) { emit(eoi); if (bits) out.push(buf & 0xFF); return new Uint8Array(out); }
    let prev = indices[0];
    for (let i = 1; i < indices.length; i++) {
        const sym = indices[i], key = prev * 256 + sym;
        const found = dict.get(key);
        if (found !== undefined) { prev = found; }
        else {
            emit(prev);
            if (nxt <= 4095) { dict.set(key, nxt++); if (nxt === (1 << cs) && cs < 12) cs++; }
            else { emit(cc); dict.clear(); nxt = cc + 2; cs = minCodeSize + 1; }
            prev = sym;
        }
    }
    emit(prev); emit(eoi); if (bits) out.push(buf & 0xFF);
    return new Uint8Array(out);
}

function gifPackSubs(data: Uint8Array): Uint8Array {
    const C = 255, out = new Uint8Array(data.length + Math.ceil(data.length / C) + 1);
    let pos = 0;
    for (let i = 0; i < data.length; i += C) {
        const ch = data.subarray(i, Math.min(i + C, data.length));
        out[pos++] = ch.length; out.set(ch, pos); pos += ch.length;
    }
    out[pos] = 0; return out;
}

function gifQuantize(imageData: ImageData): { palette: Uint8Array; indices: Uint8Array } {
    const { data, width, height } = imageData, n = width * height;
    const freq = new Map<number, number>();
    for (let i = 0; i < n; i++) {
        if (data[i*4+3] < 128) continue;
        const k = (data[i*4]<<16)|(data[i*4+1]<<8)|data[i*4+2];
        freq.set(k, (freq.get(k) ?? 0) + 1);
    }
    const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
    const nc = Math.min(sorted.length, 256);
    const palette = new Uint8Array(256 * 3);
    const cmap = new Map<number, number>();
    for (let i = 0; i < nc; i++) {
        const k = sorted[i][0];
        palette[i*3] = (k>>16)&0xFF; palette[i*3+1] = (k>>8)&0xFF; palette[i*3+2] = k&0xFF;
        cmap.set(k, i);
    }
    const lut = new Uint8Array(4096).fill(0xFF);
    for (let i = nc - 1; i >= 0; i--) lut[((palette[i*3]>>4)<<8)|((palette[i*3+1]>>4)<<4)|(palette[i*3+2]>>4)] = i;
    const indices = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
        const r = data[i*4], g = data[i*4+1], b = data[i*4+2];
        if (data[i*4+3] < 128) { indices[i] = 0; continue; }
        const ex = cmap.get((r<<16)|(g<<8)|b);
        if (ex !== undefined) { indices[i] = ex; continue; }
        const lv = lut[((r>>4)<<8)|((g>>4)<<4)|(b>>4)];
        if (lv !== 0xFF) { indices[i] = lv; continue; }
        let best = 0, bestD = Infinity;
        for (let j = 0; j < nc; j++) {
            const dr = r-palette[j*3], dg = g-palette[j*3+1], db = b-palette[j*3+2];
            const d = dr*dr+dg*dg+db*db; if (d < bestD) { bestD = d; best = j; }
        }
        lut[((r>>4)<<8)|((g>>4)<<4)|(b>>4)] = best; indices[i] = best;
    }
    return { palette, indices };
}

function gifEncode(frames: Array<{ imageData: ImageData; delay: number }>, w: number, h: number, loops: number): string {
    const w16 = (a: Uint8Array, i: number, v: number) => { a[i] = v&0xFF; a[i+1] = (v>>8)&0xFF; };
    const parts: Uint8Array[] = [];
    parts.push(new Uint8Array([0x47,0x49,0x46,0x38,0x39,0x61]));
    const lsd = new Uint8Array(7); w16(lsd,0,w); w16(lsd,2,h); parts.push(lsd);
    parts.push(new Uint8Array([0x21,0xFF,0x0B,0x4E,0x45,0x54,0x53,0x43,0x41,0x50,0x45,0x32,0x2E,0x30,0x03,0x01,loops&0xFF,(loops>>8)&0xFF,0x00]));
    for (const { imageData, delay } of frames) {
        const { palette, indices } = gifQuantize(imageData);
        const dc = Math.max(2, Math.round(delay/10));
        parts.push(new Uint8Array([0x21,0xF9,0x04,0x04,dc&0xFF,(dc>>8)&0xFF,0x00,0x00]));
        const imd = new Uint8Array(10); imd[0]=0x2C; w16(imd,5,w); w16(imd,7,h); imd[9]=0x87; parts.push(imd);
        parts.push(palette);
        parts.push(new Uint8Array([8]));
        parts.push(gifPackSubs(gifLZWEnc(indices, 8)));
    }
    parts.push(new Uint8Array([0x3B]));
    const total = parts.reduce((s,p) => s+p.length, 0);
    const out = new Uint8Array(total); let pos = 0;
    for (const p of parts) { out.set(p, pos); pos += p.length; }
    const C = 0x8000; let bin = "";
    for (let i = 0; i < out.length; i += C) bin += String.fromCharCode(...out.subarray(i, Math.min(i+C, out.length)));
    return "data:image/gif;base64," + btoa(bin);
}

async function gifApplyCrop(src: string, ox: number, oy: number, zoom: number, rot: number): Promise<string | null> {
    const decoded = await gifDecode(src);
    if (!decoded || !decoded.frames.length) return null;
    const { frames, w: sw, h: sh, loops } = decoded;
    const S = 256, ratio = S / AR_CIRC_D;
    const encFrames: Array<{ imageData: ImageData; delay: number }> = [];
    for (let fi = 0; fi < frames.length; fi++) {
        await rsSleep(0);
        if (!pluginActive) return null;
        const { canvas, delay } = frames[fi];
        const oc = document.createElement("canvas"); oc.width = S; oc.height = S;
        const ctx = oc.getContext("2d")!;
        ctx.save();
        ctx.translate(S/2 + ox*ratio, S/2 + oy*ratio);
        ctx.rotate(rot * Math.PI/180);
        ctx.scale(zoom*ratio, zoom*ratio);
        ctx.drawImage(canvas, -sw/2, -sh/2);
        ctx.restore();
        encFrames.push({ imageData: ctx.getImageData(0, 0, S, S), delay });
    }
    return arStampGif(gifEncode(encFrames, S, S, loops));
}

function arOpenCropFor(data: string, onDone: (d: string, cropParams?: CropParams) => void) {
    if (arIsGif(data)) {
        openModal((p: any) => (
            <ModalRoot {...p} size="small">
                <ModalHeader separator={false}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: AR.text }}>⚠ GIF Crop Unavailable</div>
                </ModalHeader>
                <ModalContent>
                    <div style={{ padding: "10px 4px 14px", fontSize: 13, color: AR.sub, lineHeight: 1.6 }}>
                        Crop/Edit is not supported for GIF avatars due to browser frame-compositing limitations that cause rendering artifacts across animation frames. The original GIF will be used as-is.
                    </div>
                </ModalContent>
                <ModalFooter separator={false}>
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <button onClick={() => { onDone(data); p.onClose(); }}
                            style={{ padding: "8px 20px", borderRadius: 7, fontSize: 13, fontWeight: 600, border: "none", background: AR.accent, color: "#fff", cursor: "pointer", outline: "none" }}>
                            OK
                        </button>
                    </div>
                </ModalFooter>
            </ModalRoot>
        ));
        return;
    }
    openModal(p => <ArCropModal src={data} onApply={onDone} onSkip={() => onDone(data)} modalProps={p} />);
}

function ArAvatarCard({
    entry, isDragged, isDragOver, isExcluded,
    onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd,
    onRemove, onApplyNow, onCrop, onRename,
}: {
    entry: AvatarEntry; isDragged: boolean; isDragOver: boolean; isExcluded: boolean;
    onDragStart: (e: React.DragEvent) => void; onDragOver: (e: React.DragEvent) => void;
    onDragLeave: () => void; onDrop: (e: React.DragEvent) => void; onDragEnd: () => void;
    onRemove: () => void; onApplyNow: () => void; onCrop?: () => void;
    onRename: (l: string) => void;
}) {
    const [editing, setEditing] = React.useState(false);
    const [editText, setEditText] = React.useState(entry.label);
    const ext = arGetExt(entry.data);

    React.useEffect(() => { setEditText(entry.label); }, [entry.label]);

    const commit = () => {
        const t = editText.trim();
        if (t && t !== entry.label) onRename(t); else setEditText(entry.label);
        setEditing(false);
    };

    const iStyle: React.CSSProperties = { flex: 1, background: "rgba(0,0,0,.38)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 6, color: AR.text, fontSize: 12, padding: "2px 6px", outline: "none", minWidth: 0 };

    return (
        <div draggable={!editing} onDragStart={editing ? undefined : onDragStart}
            onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} onDragEnd={onDragEnd}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 9px", borderRadius: 8, marginBottom: 4, background: isDragOver ? AR.bg2 : AR.bg1, border: `1px solid ${isDragOver ? AR.accent : AR.line}`, opacity: isDragged ? 0.3 : isExcluded ? 0.5 : 1, cursor: editing ? "default" : "grab", userSelect: "none" as const }}>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="var(--text-muted)" style={{ flexShrink: 0 }}>
                <rect y="1" width="12" height="1.8" rx="0.9"/>
                <rect y="5" width="12" height="1.8" rx="0.9"/>
                <rect y="9" width="12" height="1.8" rx="0.9"/>
            </svg>
            <div style={{ position: "relative", flexShrink: 0, width: 38, height: 38, borderRadius: "50%", overflow: "hidden", border: `2px solid ${isExcluded ? "#6b7280" : ext === "gif" ? AR.warn : AR.accent}`, cursor: arIsGif(entry.data) ? "zoom-in" : "default" }}>
                <img
                    src={entry.previewData ?? entry.data}
                    alt=""
                    draggable={false}
                    onMouseEnter={arIsGif(entry.data) ? e => {
                        const img = e.currentTarget as HTMLImageElement;
                        const cp = entry.cropParams;
                        if (cp && arHasCrop(cp)) {
                            const r = 38 / AR_CIRC_D;
                            img.style.cssText = `position:absolute;top:50%;left:50%;width:${entry.previewData ? 38 : "auto"}px;height:${entry.previewData ? 38 : "auto"}px;max-width:none;max-height:none;transform:translate(-50%,-50%) translate(${cp.ox * r}px,${cp.oy * r}px) rotate(${cp.rot}deg) scale(${cp.zoom * r});`;
                        }
                        try {
                            const b64 = entry.data.split(",")[1];
                            const raw = atob(b64);
                            const bytes = new Uint8Array(raw.length);
                            for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
                            const url = URL.createObjectURL(new Blob([bytes], { type: "image/gif" }));
                            img.dataset.gifUrl = url;
                            img.src = url;
                        } catch { img.src = entry.data; }
                    } : undefined}
                    onMouseLeave={arIsGif(entry.data) ? e => {
                        const img = e.currentTarget as HTMLImageElement;
                        if (img.dataset.gifUrl) { URL.revokeObjectURL(img.dataset.gifUrl); delete img.dataset.gifUrl; }
                        img.src = entry.previewData ?? entry.data;
                        img.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;";
                    } : undefined}
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
                {isExcluded && <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ fontSize: 14 }}>⛔</span></div>}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                {editing
                    ? <input autoFocus value={editText} onChange={e => setEditText(e.target.value)} onBlur={commit}
                        onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setEditText(entry.label); setEditing(false); } e.stopPropagation(); }}
                        onClick={e => e.stopPropagation()} style={iStyle} />
                    : (
                        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                            <span title="Double-click to rename" onDoubleClick={e => { e.stopPropagation(); setEditing(true); setEditText(entry.label); }}
                                style={{ fontSize: 13, color: isExcluded ? AR.sub : AR.text, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "text" }}>
                                {entry.label}
                            </span>
                            <ArExtBadge ext={ext} excluded={isExcluded} />
                            {ext === "gif" && !isExcluded && <span style={{ fontSize: 10, color: AR.warn, flexShrink: 0 }}>⚠ Nitro</span>}
                            {isExcluded && <span style={{ fontSize: 10, color: AR.sub, flexShrink: 0 }}>skipped</span>}
                        </div>
                    )}
            </div>
            <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
                {[
                    { color: AR.accent, title: "Use now", onClick: onApplyNow, icon: <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/> },
                    { color: arIsGif(entry.data) ? "#4a5568" : "#00b0f4", title: arIsGif(entry.data) ? "Crop unavailable for GIFs" : "Edit/Crop", onClick: arIsGif(entry.data) ? undefined : onCrop, icon: <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/> },
                    { color: AR.red, title: "Remove", onClick: onRemove, icon: <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/> },
                ].map(({ color, title, onClick, icon }) => (
                    <button key={title} onClick={e => { e.stopPropagation(); onClick?.(); }} title={title}
                        style={{ width: 26, height: 26, borderRadius: 6, flexShrink: 0, border: `1px solid ${color}33`, background: `${color}18`, color, cursor: onClick ? "pointer" : "not-allowed", display: "flex", alignItems: "center", justifyContent: "center", outline: "none", padding: 0, opacity: onClick ? 1 : 0.4 }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">{icon}</svg>
                    </button>
                ))}
            </div>
        </div>
    );
}

function AvatarTab({ forceUpdate }: { forceUpdate: () => void }) {
    const [list, setList] = React.useState<AvatarEntry[]>([...arAvatars]);
    const [urlInput, setUrlInput] = React.useState("");
    const [labelInput, setLabelInput] = React.useState("");
    const [loading, setLoading] = React.useState(false);
    const [running, setRunning] = React.useState(() => arRotatorTimer !== null);
    const [lSecStr, setLSecStr] = React.useState(() => String(settings.store.avatarIntervalSeconds ?? AR_DEFAULT_S));
    const [lRandom, setLRandom] = React.useState(() => settings.store.avatarRandom ?? true);
    const [lToast, setLToast] = React.useState(() => settings.store.avatarShowToast ?? true);
    const [excluded, setExcludedS] = React.useState(() => arGetExcluded());
    const [draggedIdx, setDraggedIdx] = React.useState<number | null>(null);
    const [dragOverIdx, setDragOverIdx] = React.useState<number | null>(null);

    const sec = parseInt(lSecStr) || AR_DEFAULT_S;
    const activeCount = list.filter(a => !excluded.includes(arGetExt(a.data))).length;
    const warnSec = sec > 0 && sec < AR_WARN_S;
    const hasGifs = list.some(e => arIsGif(e.data) && !excluded.includes("gif"));

    const commit = (next: AvatarEntry[]) => { arAvatars = next; setList([...next]); void arSaveData(); };

    const setExcl = (arr: string[]) => {
        setExcludedS(arr); arSetExcluded(arr);
        if (arRotatorTimer) { clearTimeout(arRotatorTimer); arRotatorTimer = null; arSchedule(); }
    };

    const applyInterval = (s: number) => {
        settings.store.avatarIntervalSeconds = s;
        if (arRotatorTimer) { clearTimeout(arRotatorTimer); arRotatorTimer = null; arSchedule(); }
    };

    const validateApply = () => {
        const s = Math.max(1, parseInt(lSecStr) || AR_DEFAULT_S);
        setLSecStr(String(s)); applyInterval(s);
    };

    const setPreset = (s: number) => { setLSecStr(String(s)); applyInterval(s); };

    const toggleEnabled = () => {
        const next = !running;
        settings.store.avatarEnabled = next;
        if (next && activeCount > 0) {
            if (settings.store.avatarNitroCheck) startAvatarNitroWatcher();
            arStartRotator(false); setRunning(true);
        } else {
            stopAvatarNitroWatcher(); arStopRotator(); setRunning(false);
        }
        forceUpdate();
    };

    const toggleRandom = () => {
        const n = !lRandom; setLRandom(n); settings.store.avatarRandom = n;
        if (n) arShuffleQueue = arSfShuffle(activeCount);
    };

    const toggleToast = () => {
        const n = !lToast; setLToast(n); settings.store.avatarShowToast = n;
    };

    const handleAddUrl = async () => {
        const url = urlInput.trim();
        if (!url) { arToast("Please enter a URL", Toasts.Type.FAILURE); return; }
        let parsed: URL;
        try { parsed = new URL(url); if (!["http:", "https:"].includes(parsed.protocol)) throw new Error(); }
        catch { arToast("Invalid URL - must start with http:// or https://", Toasts.Type.FAILURE); return; }
        const label = labelInput.trim() || parsed.pathname.split("/").pop()?.replace(/\.[^.]+$/, "") || "Avatar";
        setLoading(true);
        arToast("Fetching image…", Toasts.Type.MESSAGE);
        try {
            const ctrl = new AbortController();
            const timeout = setTimeout(() => ctrl.abort(), 15000);
            const res = await fetch(url, { signal: ctrl.signal });
            clearTimeout(timeout);
            if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
            const ct = res.headers.get("content-type") ?? "";
            if (ct && !ct.startsWith("image/") && !ct.startsWith("application/octet")) throw new Error(`Not an image (${ct})`);
            const blob = await res.blob();
            if (!blob.size) throw new Error("Empty response");
            if (blob.size > 50_000_000) throw new Error("Image too large (>50 MB)");
            const data = await arBlobToDataUrl(blob);
            if (!data.startsWith("data:image/")) throw new Error("Could not read image data");
            arToast("Image loaded", Toasts.Type.SUCCESS);
            setLoading(false);
            arOpenCropFor(data, async (cropped, cropParams) => { const previewData = await arGenPreview(cropped, cropParams); commit([...arAvatars, { id: arUid(), label, data: cropped, cropParams, previewData }]); setUrlInput(""); setLabelInput(""); arToast(`Added "${label}"`); });
        } catch (e: any) {
            arToast(e?.name === "AbortError" ? "Request timed out (15s)" : `Failed: ${e.message ?? "Unknown"}`, Toasts.Type.FAILURE);
            setLoading(false);
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files ?? []);
        if (!files.length) return;
        setLoading(true);
        if (files.length === 1) {
            try {
                const data = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(files[0]); });
                setLoading(false);
                arOpenCropFor(data, async (cropped, cropParams) => { const previewData = await arGenPreview(cropped, cropParams); commit([...arAvatars, { id: arUid(), label: files[0].name.replace(/\.[^.]+$/, ""), data: cropped, cropParams, previewData }]); arToast("Added"); });
            } catch { arToast("Failed to read file", Toasts.Type.FAILURE); setLoading(false); }
        } else {
            const entries: AvatarEntry[] = [];
            for (const f of files) {
                try {
                    const data = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(f); });
                    entries.push({ id: arUid(), label: f.name.replace(/\.[^.]+$/, ""), data });
                } catch {}
            }
            if (entries.length) { commit([...arAvatars, ...entries]); arToast(`Added ${entries.length} avatar(s)`); }
            setLoading(false);
        }
        e.target.value = "";
    };

    const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0]; if (!f) return;
        setLoading(true);
        try { const imp = await arImportJSON(f); if (!imp.length) arToast("No valid avatars in file", Toasts.Type.MESSAGE); else { commit([...arAvatars, ...imp]); arToast(`Imported ${imp.length}`); } }
        catch { arToast("Import failed - invalid JSON", Toasts.Type.FAILURE); }
        setLoading(false); e.target.value = "";
    };

    const removeEntry = (id: string) => {
        const next = arAvatars.filter(a => a.id !== id);
        arShuffleQueue = next.length ? arSfShuffle(next.filter(a => !excluded.includes(arGetExt(a.data))).length) : [];
        commit(next);
        if (!next.filter(a => !excluded.includes(arGetExt(a.data))).length && running) { arStopRotator(); setRunning(false); forceUpdate(); }
    };

    const moveEntry = (from: number, to: number) => {
        if (to < 0 || to >= arAvatars.length) return;
        commit(arReorderArr(arAvatars, from, to));
    };

    const onDS = (e: React.DragEvent, i: number) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); setDraggedIdx(i); };
    const onDO = (e: React.DragEvent, i: number) => { e.preventDefault(); e.stopPropagation(); if (draggedIdx !== null && draggedIdx !== i) setDragOverIdx(i); };
    const onDL = () => setDragOverIdx(null);
    const onDP = (e: React.DragEvent, to: number) => { e.preventDefault(); e.stopPropagation(); if (draggedIdx !== null && draggedIdx !== to) moveEntry(draggedIdx, to); setDraggedIdx(null); setDragOverIdx(null); };
    const onDE = () => { setDraggedIdx(null); setDragOverIdx(null); };

    const inputBaseStyle: React.CSSProperties = { flex: 1, background: "rgba(0,0,0,.38)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 6, color: AR.text, fontSize: 13, padding: "6px 10px", outline: "none", minWidth: 0 };

    return (
        <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 10, marginBottom: 14, background: running ? `${AR.green}0f` : AR.bg1, border: `1px solid ${running ? AR.green + "2e" : AR.line}` }}>
                <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: running ? AR.green : AR.text, marginBottom: 2 }}>{running ? "Rotation active" : "Rotation stopped"}</div>
                    <div style={{ fontSize: 12, color: AR.sub }}>
                        {running ? `Cycling every ${arFmtSec(sec)} - ${lRandom ? "Random" : "Sequential"} - ${activeCount} active` : activeCount === 0 ? "Add avatars or unexclude extensions to start" : "Press Start to begin cycling"}
                    </div>
                </div>
                <button onClick={toggleEnabled} disabled={!running && !activeCount}
                    style={{ padding: "9px 22px", borderRadius: 8, fontWeight: 700, fontSize: 14, border: "none", outline: "none", background: running ? AR.red : AR.green, color: "#fff", cursor: (!running && !activeCount) ? "not-allowed" : "pointer", opacity: (!running && !activeCount) ? 0.4 : 1 }}>
                    {running ? "Stop" : "Start"}
                </button>
            </div>

            <div className="ar-card">
                <div className="ar-card-row">
                    <div style={{ flexShrink: 0 }}>
                        <div style={{ fontSize: 13, color: AR.text }}>Interval</div>
                        <div style={{ fontSize: 10, color: AR.sub, opacity: 0.7 }}>recommended min: 60s</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" as const }}>
                        <input type="number" min={1} value={lSecStr}
                            onChange={e => setLSecStr(e.target.value)}
                            onFocus={e => e.target.select()}
                            onBlur={validateApply}
                            onKeyDown={e => { if (e.key === "Enter") { validateApply(); (e.target as HTMLInputElement).blur(); } e.stopPropagation(); }}
                            style={{ ...inputBaseStyle, flex: "none", width: 72, textAlign: "center", padding: "3px 6px" }} />
                        <span style={{ fontSize: 12, color: AR.sub }}>sec</span>
                        <div style={{ display: "flex", gap: 3 }}>
                            {[60, 120, 300, 600, 900].map(s => (
                                <button key={s} onClick={() => setPreset(s)}
                                    style={{ padding: "3px 7px", borderRadius: 5, fontSize: 11, cursor: "pointer", outline: "none", border: `1px solid ${sec === s ? AR.accent : AR.line}`, background: sec === s ? AR.aD : "transparent", color: sec === s ? AR.accent : AR.sub }}>
                                    {arFmtPreset(s)}
                                </button>
                            ))}
                        </div>
                    </div>
                    {warnSec && (
                        <div style={{ width: "100%", marginTop: 4, padding: "5px 9px", borderRadius: 6, background: `${AR.warn}14`, border: `1px solid ${AR.warn}33`, fontSize: 11, color: AR.warn }}>
                            ⚠ Below 60s - Discord rate-limits changes (~2 per 10 min).
                        </div>
                    )}
                </div>
                <div className="ar-card-row">
                    <span style={{ fontSize: 13, color: AR.text }}>{lRandom ? "🔀 Random (no repeats)" : "🔁 Sequential"}</span>
                    <div onClick={toggleRandom} style={{ width: 34, height: 18, borderRadius: 9, flexShrink: 0, cursor: "pointer", background: lRandom ? AR.accent : "rgba(255,255,255,.13)", position: "relative", userSelect: "none" as const }}>
                        <div style={{ position: "absolute", top: 2, left: lRandom ? 16 : 2, width: 14, height: 14, borderRadius: "50%", background: "#fff" }} />
                    </div>
                </div>
                <div className="ar-card-row">
                    <span style={{ fontSize: 13, color: AR.text }}>Toast notifications</span>
                    <div onClick={toggleToast} style={{ width: 34, height: 18, borderRadius: 9, flexShrink: 0, cursor: "pointer", background: lToast ? AR.accent : "rgba(255,255,255,.13)", position: "relative", userSelect: "none" as const }}>
                        <div style={{ position: "absolute", top: 2, left: lToast ? 16 : 2, width: 14, height: 14, borderRadius: "50%", background: "#fff" }} />
                    </div>
                </div>
                <div className="ar-card-row">
                    <span style={{ fontSize: 13, color: AR.text }}>
                        🔍 Nitro Check - skip GIFs if no Nitro
                        <span style={{ fontSize: 10, color: arHasNitro() ? "#23a55a" : "#faa61a", marginLeft: 6 }}>
                            {settings.store.avatarNitroCheck ? (arHasNitro() ? "Nitro ✓ - GIFs included" : "No Nitro - GIFs auto-skipped") : "disabled"}
                        </span>
                    </span>
                    <div onClick={() => {
                        const n = !settings.store.avatarNitroCheck;
                        (settings.store as any).avatarNitroCheck = n;
                        if (running) { if (n) startAvatarNitroWatcher(); else { stopAvatarNitroWatcher(); const excl = arGetExcluded(); if (excl.includes("gif")) arSetExcluded(excl.filter(e => e !== "gif")); } }
                        forceUpdate();
                    }} style={{ width: 34, height: 18, borderRadius: 9, flexShrink: 0, cursor: "pointer", background: settings.store.avatarNitroCheck ? AR.accent : "rgba(255,255,255,.13)", position: "relative", userSelect: "none" as const }}>
                        <div style={{ position: "absolute", top: 2, left: settings.store.avatarNitroCheck ? 16 : 2, width: 14, height: 14, borderRadius: "50%", background: "#fff" }} />
                    </div>
                </div>
            </div>

            <div style={{ background: AR.bg1, border: `1px solid ${AR.line}`, borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
                <ArExtFilterSection excluded={excluded} onChange={setExcl} />
            </div>

            <div style={{ height: 1, background: AR.line, margin: "12px 0" }} />

            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, color: AR.sub, textTransform: "uppercase" as const, marginBottom: 6 }}>Add Avatar</div>
            <div style={{ display: "flex", gap: 6, marginTop: 6, marginBottom: 8, flexWrap: "wrap" as const }}>
                <input placeholder="https://example.com/avatar.png" value={urlInput} onChange={e => setUrlInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") handleAddUrl(); }} style={inputBaseStyle} />
                <input placeholder="Label (optional)" value={labelInput} onChange={e => setLabelInput(e.target.value)} style={{ ...inputBaseStyle, flex: "none", width: 130 }} />
                <button onClick={handleAddUrl} disabled={loading || !urlInput.trim()}
                    style={{ padding: "6px 16px", borderRadius: 6, fontSize: 13, fontWeight: 700, background: loading || !urlInput.trim() ? "rgba(156,103,255,.15)" : `linear-gradient(135deg, #7c3aed, ${AR.accent})`, border: `1px solid ${AR.accent}55`, color: loading || !urlInput.trim() ? AR.sub : "#fff", cursor: (loading || !urlInput.trim()) ? "not-allowed" : "pointer", outline: "none", flexShrink: 0 }}>
                    {loading ? "…" : "Add URL"}
                </button>
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <label style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, padding: "12px 8px", borderRadius: 10, cursor: loading ? "not-allowed" : "pointer", userSelect: "none" as const, background: "linear-gradient(135deg, rgba(88,101,242,.14), rgba(156,103,255,.14))", border: `1.5px dashed ${AR.accent}70` }}>
                    <input type="file" multiple accept={AR_ACCEPT} style={{ display: "none" }} onChange={handleFileUpload} disabled={loading} />
                    <span style={{ fontSize: 22 }}>📁</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: AR.accent }}>{loading ? "Loading…" : "Upload Images"}</span>
                    <span style={{ fontSize: 9, color: AR.sub, textAlign: "center", lineHeight: 1.4 }}>jpg · jpeg · jfif · png · gif · webp · avif</span>
                </label>
                <label style={{ width: 120, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, padding: "12px 8px", borderRadius: 10, cursor: loading ? "not-allowed" : "pointer", userSelect: "none" as const, background: "linear-gradient(135deg, rgba(59,165,92,.12), rgba(156,103,255,.10))", border: `1.5px dashed ${AR.green}60` }}>
                    <input type="file" accept="application/json" style={{ display: "none" }} onChange={handleImport} disabled={loading} />
                    <span style={{ fontSize: 22 }}>📥</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: AR.green }}>Import JSON</span>
                </label>
            </div>

            {hasGifs && (
                <div style={{ padding: "7px 11px", borderRadius: 8, marginBottom: 8, background: `${AR.warn}12`, border: `1px solid ${AR.warn}33`, fontSize: 12, color: AR.warn }}>
                    ⚠ GIF avatars require <b>Nitro</b> to animate on Discord.
                </div>
            )}

            <div style={{ padding: "7px 11px", borderRadius: 8, marginBottom: 10, background: "rgba(88,101,242,.09)", border: "1px solid rgba(88,101,242,.22)", fontSize: 12, color: "#90caf9" }}>
                ✏️ Double-click a name to rename - ✏ to edit/crop - Drag ⠿ to reorder
            </div>

            <div style={{ height: 1, background: AR.line, margin: "12px 0" }} />

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, color: AR.sub, textTransform: "uppercase" as const }}>Avatar List ({list.length})</span>
                {list.length > 0 && (
                    <div style={{ display: "flex", gap: 5 }}>
                        <button onClick={arExportJSON} style={{ padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", border: `1px solid ${AR.accent}44`, background: AR.aD, color: AR.accent, outline: "none" }}>📤 Export</button>
                        <button onClick={() => { commit([]); arSeqIndex = 0; arShuffleQueue = []; if (running) { arStopRotator(); setRunning(false); settings.store.avatarEnabled = false; } forceUpdate(); }}
                            style={{ padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", border: `1px solid ${AR.red}44`, background: `${AR.red}18`, color: AR.red, outline: "none" }}>Clear all</button>
                    </div>
                )}
            </div>

            <div style={{ maxHeight: 230, overflowY: "auto", paddingRight: 2 }}>
                {list.length === 0
                    ? <div style={{ textAlign: "center", padding: "24px 0", color: AR.sub, fontSize: 13 }}><div style={{ fontSize: 26, marginBottom: 6 }}>🖼️</div>No avatars yet - add some above</div>
                    : list.map((entry, i) => (
                        <ArAvatarCard key={entry.id} entry={entry}
                            isDragged={draggedIdx === i} isDragOver={dragOverIdx === i}
                            isExcluded={excluded.includes(arGetExt(entry.data))}
                            onDragStart={e => onDS(e, i)} onDragOver={e => onDO(e, i)}
                            onDragLeave={onDL} onDrop={e => onDP(e, i)} onDragEnd={onDE}
                            onRemove={() => removeEntry(entry.id)}
                            onApplyNow={() => void arApplyAvatar(entry)}
                            onCrop={() => arOpenCropFor(entry.data, async (d, cropParams) => { const previewData = await arGenPreview(d, cropParams); commit(arAvatars.map(a => a.id === entry.id ? { ...a, data: d, cropParams, previewData } : a)); arToast("Updated"); })}
                            onRename={l => commit(arAvatars.map(a => a.id === entry.id ? { ...a, label: l } : a))}
                        />
                    ))
                }
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, paddingTop: 10, borderTop: `1px solid ${AR.line}` }}>
                <button onClick={() => void arRotateNext()} disabled={!activeCount}
                    style={{ padding: "8px 18px", borderRadius: 7, fontSize: 13, fontWeight: 600, background: activeCount ? AR.aD : "rgba(156,103,255,.1)", border: `1px solid ${AR.accent}44`, color: activeCount ? AR.accent : AR.sub, cursor: !activeCount ? "not-allowed" : "pointer", opacity: !activeCount ? 0.5 : 1, outline: "none" }}>
                    ⏭ Skip
                </button>
                <span style={{ fontSize: 11, color: AR.sub }}>{running ? `● Cycling every ${arFmtSec(sec)} - ${activeCount} active` : "○ Not running"}</span>
            </div>
        </div>
    );
}

function NicksTab({ forceUpdate }: { forceUpdate: () => void }) {
    const [filter, setFilter] = React.useState("");
    const [sort, setSort] = React.useState<SortMode>("enabled");
    const [nickInputs, setNickInputs] = React.useState<Record<string, string>>({});
    const [nickEdit, setNickEdit] = React.useState<Record<string, { idx: number; val: string } | null>>({});
    const [manualId, setManualId] = React.useState("");
    const [manualName, setManualName] = React.useState("");
    const [confirmBulk, setConfirmBulk] = React.useState<string | null>(null);
    const [confirmClear, setConfirmClear] = React.useState<string | null>(null);

    const { props: gnDProps, cls: gnCls } = useDrag((f, t) => {
        globalNicks = reorder(globalNicks, f, t); saveData(); forceUpdate();
    });
    const { props: gpDProps, cls: gpCls } = useDrag((f, t) => {
        globalGuildPronouns = reorder(globalGuildPronouns, f, t); saveData(); forceUpdate();
    });

    function addNick(g: GuildEntry) { const v = (nickInputs[g.id] ?? "").trim(); if (!v || g.nicks.includes(v)) return; g.nicks = [...g.nicks, v]; saveData(); setNickInputs(p => ({ ...p, [g.id]: "" })); forceUpdate(); }
    function removeNick(g: GuildEntry, i: number) { g.nicks = g.nicks.filter((_, j) => j !== i); g.seqIndex = 0; g.lastNickVal = null; saveData(); forceUpdate(); }
    function saveNickEdit(g: GuildEntry) {
        const es = nickEdit[g.id]; if (!es) return;
        const v = es.val.trim();
        setNickEdit(p => ({ ...p, [g.id]: null }));
        if (!v) return;
        g.nicks = [...g.nicks]; g.nicks[es.idx] = v; saveData(); forceUpdate();
    }
    function toggleGuild(g: GuildEntry) {
        g.enabled = !g.enabled;
        if (g.enabled) {
            const voiceOnly = g.voiceActivated && settings.store.voiceActivateEnabled && !settings.store.voiceActivateGlobal;
            if (!voiceOnly && !settings.store.globalSync) {
                if (settings.store.nickEnabled) scheduleNickTick(g, getMs(settings.store.nickIntervalSeconds));
                if (g.guildPronounsEnabled && pronounsForGuild(g).length > 0) startGuildPronouns(g);
            }
        } else {
            stopNickGuild(g.id); stopGuildPronouns(g.id);
        }
        saveData(); forceUpdate();
    }
    function toggleNickActive(g: GuildEntry) {
        if (g.voiceActivated && settings.store.voiceActivateEnabled && !settings.store.voiceActivateGlobal) {
            g.nickVoiceEnabled = !g.nickVoiceEnabled;
            saveData();
            if (pluginActive) {
                const inVoice = getMyVoiceGuildId() === g.id;
                if (g.nickVoiceEnabled && inVoice && settings.store.nickEnabled && !nickTimers.has(g.id)) {
                    scheduleNickTick(g, getMs(settings.store.nickIntervalSeconds));
                } else if (!g.nickVoiceEnabled && nickTimers.has(g.id)) {
                    stopNickGuild(g.id);
                }
            }
            forceUpdate();
            return;
        }
        if (nickTimers.has(g.id)) stopNickGuild(g.id);
        else if (settings.store.nickEnabled && !settings.store.globalSync) scheduleNickTick(g, getMs(settings.store.nickIntervalSeconds));
        forceUpdate();
    }
    function toggleGuildPronounsActive(g: GuildEntry) {
        if (g.voiceActivated && settings.store.voiceActivateEnabled && !settings.store.voiceActivateGlobal) {
            g.pronounsVoiceEnabled = !g.pronounsVoiceEnabled;
            saveData();
            if (pluginActive) {
                const inVoice = getMyVoiceGuildId() === g.id;
                if (g.pronounsVoiceEnabled && inVoice && settings.store.serverPronounsEnabled && !guildPronounsTimers.has(g.id)) {
                    scheduleGuildPronounsTick(g, getMs(settings.store.serverPronounsIntervalSeconds));
                } else if (!g.pronounsVoiceEnabled && guildPronounsTimers.has(g.id)) {
                    stopGuildPronouns(g.id);
                }
            }
            forceUpdate();
            return;
        }
        if (!settings.store.serverPronounsEnabled) return;
        g.guildPronounsEnabled = !g.guildPronounsEnabled;
        if (pluginActive) {
            if (g.guildPronounsEnabled) startGuildPronouns(g);
            else stopGuildPronouns(g.id);
        }
        saveData(); forceUpdate();
    }
    function cycleMode(g: GuildEntry) { g.nickMode = NM_NEXT[nickModeOf(g)]; g.seqIndex = 0; g.lastNickVal = null; saveData(); forceUpdate(); }
    function addManual() {
        const id = manualId.trim(); const name = manualName.trim() || id;
        if (!id || !/^\d{17,20}$/.test(id) || guilds.find(g => g.id === id)) return;
        guilds.push({ id, name, nicks: [], enabled: false, seqIndex: 0, manual: true, nickMode: "both", guildPronouns: [], guildPronounsEnabled: false, guildPronounsSeqIdx: 0, guildPronounsLastVal: null, guildPronounsMode: "both", voiceActivated: false, nickVoiceEnabled: false, pronounsVoiceEnabled: false });
        saveData(); setManualId(""); setManualName(""); forceUpdate();
    }
    function removeGuild(g: GuildEntry) { stopNickGuild(g.id); guilds = guilds.filter(x => x.id !== g.id); saveData(); forceUpdate(); }
    function enableAll() { guilds.forEach(g => { if (!g.enabled) { g.enabled = true; if (!settings.store.globalSync) { startNickGuild(g); startGuildPronouns(g); } } }); saveData(); forceUpdate(); }
    function disableAll() { guilds.forEach(g => { g.enabled = false; stopNickGuild(g.id); }); saveData(); forceUpdate(); }
    function resetAllNicks() { guilds.forEach(g => { g.nicks = []; g.seqIndex = 0; g.lastNickVal = null; }); saveData(); forceUpdate(); }
    function allActiveNicks() {
        guilds.forEach(g => {
            if (!g.enabled) return;
            if (g.voiceActivated && settings.store.voiceActivateEnabled && !settings.store.voiceActivateGlobal) {
                g.nickVoiceEnabled = true;
                if (pluginActive && getMyVoiceGuildId() === g.id && settings.store.nickEnabled && !nickTimers.has(g.id))
                    scheduleNickTick(g, getMs(settings.store.nickIntervalSeconds));
            } else {
                if (pluginActive && settings.store.nickEnabled && !settings.store.globalSync && !nickTimers.has(g.id))
                    scheduleNickTick(g, getMs(settings.store.nickIntervalSeconds));
            }
        });
        saveData(); forceUpdate();
    }
    function allInactiveNicks() {
        guilds.forEach(g => { stopNickGuild(g.id); if (g.voiceActivated) g.nickVoiceEnabled = false; });
        saveData(); forceUpdate();
    }
    function allActivePronouns() {
        guilds.forEach(g => {
            if (g.voiceActivated && settings.store.voiceActivateEnabled && !settings.store.voiceActivateGlobal) {
                g.pronounsVoiceEnabled = true;
                if (pluginActive && getMyVoiceGuildId() === g.id && settings.store.serverPronounsEnabled && pronounsForGuild(g).length > 0 && !guildPronounsTimers.has(g.id))
                    scheduleGuildPronounsTick(g, getMs(settings.store.serverPronounsIntervalSeconds));
            } else {
                g.guildPronounsEnabled = true;
                if (pluginActive && settings.store.serverPronounsEnabled && !settings.store.globalSync && pronounsForGuild(g).length > 0 && !guildPronounsTimers.has(g.id))
                    startGuildPronouns(g);
            }
        });
        saveData(); forceUpdate();
    }
    function allInactivePronouns() {
        guilds.forEach(g => {
            stopGuildPronouns(g.id);
            if (g.voiceActivated && settings.store.voiceActivateEnabled && !settings.store.voiceActivateGlobal) g.pronounsVoiceEnabled = false;
            else g.guildPronounsEnabled = false;
        });
        saveData(); forceUpdate();
    }
    function allVCOnly() {
        guilds.forEach(g => { g.voiceActivated = true; stopNickGuild(g.id); stopGuildPronouns(g.id); });
        saveData(); forceUpdate();
    }
    function allAlways() {
        guilds.forEach(g => {
            g.voiceActivated = false;
            if (pluginActive && g.enabled && !settings.store.globalSync) {
                if (settings.store.nickEnabled && !nickTimers.has(g.id)) startNickGuild(g);
                if (g.guildPronounsEnabled && pronounsForGuild(g).length > 0 && !guildPronounsTimers.has(g.id)) startGuildPronouns(g);
            }
        });
        saveData(); forceUpdate();
    }
    function allBoth() { guilds.forEach(g => { g.nickMode = "both"; g.seqIndex = 0; g.lastNickVal = null; }); saveData(); forceUpdate(); }
    function allCustom() { guilds.forEach(g => { g.nickMode = "custom"; g.seqIndex = 0; g.lastNickVal = null; }); saveData(); forceUpdate(); }
    function allGlobal() { guilds.forEach(g => { g.nickMode = "global"; g.seqIndex = 0; g.lastNickVal = null; }); saveData(); forceUpdate(); }
    function allPrBoth() { guilds.forEach(g => { g.guildPronounsMode = "both"; g.guildPronounsSeqIdx = 0; g.guildPronounsLastVal = null; }); saveData(); forceUpdate(); }
    function allPrCustom() { guilds.forEach(g => { g.guildPronounsMode = "custom"; g.guildPronounsSeqIdx = 0; g.guildPronounsLastVal = null; }); saveData(); forceUpdate(); }
    function allPrGlobal() { guilds.forEach(g => { g.guildPronounsMode = "global"; g.guildPronounsSeqIdx = 0; g.guildPronounsLastVal = null; }); saveData(); forceUpdate(); }

    let sorted = [...guilds];
    if (filter) sorted = sorted.filter(g => g.name.toLowerCase().includes(filter.toLowerCase()) || g.id.includes(filter));
    if (sort === "enabled") sorted.sort((a, b) => Number(b.enabled) - Number(a.enabled));
    else if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "nicks") sorted.sort((a, b) => b.nicks.length - a.nicks.length);
    else if (sort === "running") sorted.sort((a, b) => Number(nickTimers.has(b.id)) - Number(nickTimers.has(a.id)));
    else if (sort === "pronouns") sorted.sort((a, b) => (b.guildPronouns?.length ?? 0) - (a.guildPronouns?.length ?? 0));

    const activeCount = nickTimers.size;
    const enabledCount = guilds.filter(g => g.enabled).length;

    const bulkFns: Record<string, () => void> = {
        "All Active Nicks": allActiveNicks,
        "All Inactive Nicks": allInactiveNicks,
        "All Active Pronouns": allActivePronouns,
        "All Inactive Pronouns": allInactivePronouns,
        "All Nick Both": allBoth,
        "All Nick Custom": allCustom,
        "All Nick Global": allGlobal,
        "All Pr Both": allPrBoth,
        "All Pr Custom": allPrCustom,
        "All Pr Global": allPrGlobal,
        "All VC-Only": allVCOnly,
        "All Always": allAlways,
    };

    return (
        <div>
            <div className="rs-card" style={{ marginBottom: 8 }}>
                <SectionHeader
                    label="Server Nicknames" color={C.nick}
                    enabled={settings.store.nickEnabled}
                    onToggleEnabled={v => { settings.store.nickEnabled = v; if (pluginActive) { if (v) { for (const g of guilds.filter(x => x.enabled)) startNickGuild(g); } else stopAllNicks(); } forceUpdate(); }}
                    rndValue={settings.store.nickRandomize} onToggleRnd={v => { settings.store.nickRandomize = v; forceUpdate(); }}
                    enableColor={C.nick}
                />
                <PanelInterval label="Nickname Interval" description="Seconds between nickname changes per server (ignored when Master Sync is ON)"
                    storeKey="nickIntervalSeconds" disabled={settings.store.globalSync}
                    onApply={() => { if (pluginActive && settings.store.nickEnabled && !settings.store.globalSync) { stopAllNicks(); for (const g of guilds.filter(x => x.enabled)) startNickGuild(g); } }} />
                <div className="rs-hint" style={{ marginTop: 5 }}>
                    Nick source mode per server - <b style={{ color: NM_COLOR.custom }}>Custom</b>: server-specific only · <b style={{ color: NM_COLOR.global }}>Global</b>: shared pool · <b style={{ color: NM_COLOR.both }}>Both</b>: merged
                </div>
            </div>

            <div className="rs-card" style={{ marginBottom: 8 }}>
                <SectionHeader
                    label="Server Pronouns" color={C.pronoun}
                    enabled={settings.store.serverPronounsEnabled}
                    onToggleEnabled={v => { settings.store.serverPronounsEnabled = v; if (pluginActive) { if (v) { for (const g of guilds.filter(x => x.guildPronounsEnabled && pronounsForGuild(x).length > 0)) startGuildPronouns(g); } else stopAllGuildPronouns(); } forceUpdate(); }}
                    rndValue={settings.store.serverPronounsRandomize} onToggleRnd={v => { settings.store.serverPronounsRandomize = v; forceUpdate(); }}
                    enableColor={C.pronoun}
                />
                <PanelInterval label="Pronouns Interval" description="Seconds between pronoun changes per server (ignored when Master Sync is ON)"
                    storeKey="serverPronounsIntervalSeconds" disabled={settings.store.globalSync}
                    onApply={() => { if (pluginActive && settings.store.serverPronounsEnabled && !settings.store.globalSync) { stopAllGuildPronouns(); for (const g of guilds.filter(x => x.guildPronounsEnabled && pronounsForGuild(x).length > 0)) startGuildPronouns(g); } }} />
                <div className="rs-hint" style={{ marginTop: 5 }}>Each server can have its own pronoun list. Servers with no local entries fall back to the <b style={{ color: C.pronoun }}>Global Pronoun Pool</b>.</div>
                <div className="rs-warn-box" style={{ marginTop: 6 }}>
                    ⚠️ Server pronouns use <b>/users/@me/guilds/&#123;id&#125;/profile</b> - Discord may return 403/404 on servers where this is restricted. 429 errors in console during cycles are expected and handled automatically.
                </div>
            </div>

            <div className="rs-card" style={{ marginBottom: 8, border: "1.5px solid rgba(121,134,203,.3)", background: "rgba(10,10,40,.5)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: ".8px", color: "#7986cb" }}>Voice Activation</span>
                    <div style={{ flex: 1, height: 1, background: "rgba(121,134,203,.2)" }} />
                    <button
                        style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 6, border: `1px solid ${settings.store.voiceActivateEnabled ? "#7986cb55" : "rgba(80,60,110,.3)"}`, background: settings.store.voiceActivateEnabled ? "#7986cb20" : "rgba(15,5,35,.5)", color: settings.store.voiceActivateEnabled ? "#7986cb" : "#5a4a7a", cursor: "pointer", fontSize: 11, fontWeight: 800 }}
                        onClick={() => { settings.store.voiceActivateEnabled = !settings.store.voiceActivateEnabled; if (pluginActive) { stopVoiceWatcher(); if (settings.store.voiceActivateEnabled) startVoiceWatcher(); else startAllRotators(); } forceUpdate(); }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: settings.store.voiceActivateEnabled ? "#7986cb" : "#3a2a5a", display: "inline-block" }} />
                        {settings.store.voiceActivateEnabled ? "Enabled" : "Disabled"}
                    </button>
                </div>
                {settings.store.voiceActivateEnabled && (
                    <div style={{ display: "flex", flexDirection: "column" as const, gap: 4 }}>
                        <PanelToggle label="Global Voice" description="Join ANY voice/call/DM → start ALL enabled server nick+pronoun cycles. Leave → stop all. Overrides per-server."
                            value={settings.store.voiceActivateGlobal} color="#7986cb"
                            onChange={v => { settings.store.voiceActivateGlobal = v; if (pluginActive) startAllRotators(); forceUpdate(); }} />
                        <div className="rs-hint">
                            {settings.store.voiceActivateGlobal
                                ? "Global: all server nicks+pronouns activate on any voice join, deactivate on leave."
                                : "Per-server: use the 🔊 VC-only / Always button (left of ON/OFF) on each server card to set its mode."
                            }
                        </div>
                    </div>
                )}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: ".8px", color: C.nick }}>Global Nick Pool</span>
                <div style={{ flex: 1, height: 1, background: `${C.nick}33` }} />
                <span className="rs-count">{globalNicks.length}</span>
                {globalNicks.length > 0 && <button className="rs-clearall" onClick={() => setConfirmClear("global-nicks")}>Clear</button>}
            </div>
            {confirmClear === "global-nicks" && <ConfirmBox msg="Clear all global nicks?" onConfirm={() => { globalNicks = []; saveData(); forceUpdate(); setConfirmClear(null); }} onCancel={() => setConfirmClear(null)} />}
            <div className="rs-hint" style={{ marginBottom: 5 }}>Shared nicknames for servers in <b style={{ color: NM_COLOR.global }}>Global</b> or <b style={{ color: NM_COLOR.both }}>Both</b> mode. Drag to reorder, click to edit.</div>
            <div className="rs-nick-list">
                {globalNicks.length === 0 && <span className="rs-empty">No shared nicks yet.</span>}
                {globalNicks.map((n, ni) => {
                    const es = nickEdit.__g;
                    return (
                        <div key={`gn_${ni}`} {...gnDProps(ni)} className={gnCls(ni, "rs-item rs-item-compact")}>
                            <span className="rs-drag">⠿</span>
                            {es && es.idx === ni
                                ? <input autoFocus className="rs-item-input" value={es.val}
                                    onChange={e => setNickEdit(p => ({ ...p, __g: { idx: ni, val: e.target.value } }))}
                                    onKeyDown={(e: React.KeyboardEvent) => {
                                        if (e.key === "Enter") { const v = es.val.trim(); if (v) { globalNicks = [...globalNicks]; globalNicks[ni] = v; saveData(); } setNickEdit(p => ({ ...p, __g: null })); forceUpdate(); }
                                        if (e.key === "Escape") setNickEdit(p => ({ ...p, __g: null }));
                                    }}
                                    onBlur={() => { const v = es.val.trim(); if (v) { globalNicks = [...globalNicks]; globalNicks[ni] = v; saveData(); } setNickEdit(p => ({ ...p, __g: null })); forceUpdate(); }} />
                                : <span className="rs-item-text" style={{ fontWeight: 600, color: C.nick }}>{n}</span>
                            }
                            <button className="rs-edit-btn" onClick={() => setNickEdit(p => ({ ...p, __g: { idx: ni, val: n } }))}>&#9998;</button>
                            <button className="rs-del-btn" onClick={() => { globalNicks = globalNicks.filter((_, j) => j !== ni); saveData(); forceUpdate(); }}>&#10005;</button>
                        </div>
                    );
                })}
            </div>
            <div className="rs-row" style={{ marginTop: 5, marginBottom: 10 }}>
                <TextInput placeholder="Add to global nick pool..." value={nickInputs.__g ?? ""} onChange={(v: string) => setNickInputs(p => ({ ...p, __g: v }))}
                    onKeyDown={(e: React.KeyboardEvent) => {
                        if (e.key === "Enter") { const v = (nickInputs.__g ?? "").trim(); if (v && !globalNicks.includes(v)) { globalNicks = [...globalNicks, v]; saveData(); setNickInputs(p => ({ ...p, __g: "" })); forceUpdate(); } }
                    }} />
                <Button size={Button.Sizes.SMALL} color={Button.Colors.BRAND} className="rs-btn-sm" onClick={() => {
                    const v = (nickInputs.__g ?? "").trim();
                    if (v && !globalNicks.includes(v)) { globalNicks = [...globalNicks, v]; saveData(); setNickInputs(p => ({ ...p, __g: "" })); forceUpdate(); }
                }}>Add</Button>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: ".8px", color: C.pronoun }}>Global Pronoun Pool</span>
                <div style={{ flex: 1, height: 1, background: `${C.pronoun}33` }} />
                <span className="rs-count">{globalGuildPronouns.length}</span>
                {globalGuildPronouns.length > 0 && <button className="rs-clearall" onClick={() => setConfirmClear("global-pronouns")}>Clear</button>}
            </div>
            {confirmClear === "global-pronouns" && <ConfirmBox msg="Clear all global pronouns?" onConfirm={() => { globalGuildPronouns = []; saveData(); forceUpdate(); setConfirmClear(null); }} onCancel={() => setConfirmClear(null)} />}
            <div className="rs-hint" style={{ marginBottom: 5 }}>Fallback pool for servers with no local pronouns. Drag to reorder, click to edit.</div>
            <div className="rs-nick-list">
                {globalGuildPronouns.length === 0 && <span className="rs-empty">No global pronouns yet.</span>}
                {globalGuildPronouns.map((pr, pi) => {
                    const key = `__gpr_${pi}`;
                    const es = nickEdit[key];
                    return (
                        <div key={`ggpr_${pi}`} {...gpDProps(pi)} className={gpCls(pi, "rs-item rs-item-compact")}>
                            <span className="rs-drag">⠿</span>
                            {es
                                ? <input autoFocus className="rs-item-input" value={es.val} maxLength={40}
                                    onChange={e => setNickEdit(p => ({ ...p, [key]: { idx: pi, val: e.target.value } }))}
                                    onKeyDown={(e: React.KeyboardEvent) => {
                                        if (e.key === "Enter") { const v = es.val.trim(); if (v) { globalGuildPronouns = [...globalGuildPronouns]; globalGuildPronouns[pi] = v; saveData(); } setNickEdit(p => ({ ...p, [key]: null })); forceUpdate(); }
                                        if (e.key === "Escape") setNickEdit(p => ({ ...p, [key]: null }));
                                    }}
                                    onBlur={() => { const v = es.val.trim(); if (v) { globalGuildPronouns = [...globalGuildPronouns]; globalGuildPronouns[pi] = v; saveData(); } setNickEdit(p => ({ ...p, [key]: null })); forceUpdate(); }} />
                                : <span className="rs-item-text" style={{ fontWeight: 600, color: C.pronoun }}
                                    onDoubleClick={() => setNickEdit(p => ({ ...p, [key]: { idx: pi, val: pr } }))}>{pr}</span>
                            }
                            <button className="rs-edit-btn" onClick={() => setNickEdit(p => ({ ...p, [key]: { idx: pi, val: pr } }))}>&#9998;</button>
                            <button className="rs-del-btn" onClick={() => { globalGuildPronouns = globalGuildPronouns.filter((_, j) => j !== pi); saveData(); forceUpdate(); }}>&#10005;</button>
                        </div>
                    );
                })}
            </div>
            <div className="rs-row" style={{ marginTop: 5, marginBottom: 10 }}>
                <TextInput placeholder="Add to global pronoun pool (max 40)..." value={nickInputs.__gpr ?? ""} onChange={(v: string) => setNickInputs(p => ({ ...p, __gpr: v.slice(0, 40) }))}
                    onKeyDown={(e: React.KeyboardEvent) => {
                        if (e.key === "Enter") { const v = (nickInputs.__gpr ?? "").trim(); if (v && !globalGuildPronouns.includes(v)) { globalGuildPronouns = [...globalGuildPronouns, v]; saveData(); setNickInputs(p => ({ ...p, __gpr: "" })); forceUpdate(); } }
                    }} />
                <Button size={Button.Sizes.SMALL} color={Button.Colors.BRAND} className="rs-btn-sm" onClick={() => {
                    const v = (nickInputs.__gpr ?? "").trim();
                    if (v && !globalGuildPronouns.includes(v)) { globalGuildPronouns = [...globalGuildPronouns, v]; saveData(); setNickInputs(p => ({ ...p, __gpr: "" })); forceUpdate(); }
                }}>Add</Button>
            </div>

            <div className="rs-divider" style={{ margin: "4px 0 8px" }} />

            <div style={{ display: "flex", flexDirection: "column" as const, gap: 5, marginBottom: 8, padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(124,77,255,.18)", background: "rgba(10,5,30,.5)" }}>
                {confirmBulk && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", borderRadius: 6, background: "rgba(239,83,80,.1)", border: "1px solid rgba(239,83,80,.3)" }}>
                        <span style={{ flex: 1, fontSize: 11, color: "#ef9a9a", fontWeight: 700 }}>Apply "{confirmBulk}" to all servers?</span>
                        <button onClick={() => { const fn = bulkFns[confirmBulk!]; if (fn) fn(); setConfirmBulk(null); }} style={{ padding: "2px 10px", borderRadius: 5, border: `1px solid ${ACT}44`, background: `${ACT}18`, color: ACT, cursor: "pointer", fontSize: 10, fontWeight: 800 }}>Yes</button>
                        <button onClick={() => setConfirmBulk(null)} style={{ padding: "2px 10px", borderRadius: 5, border: "1px solid rgba(80,60,110,.4)", background: "rgba(15,5,35,.6)", color: "#9e9e9e", cursor: "pointer", fontSize: 10, fontWeight: 800 }}>No</button>
                    </div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" as const }}>
                    <span style={{ fontSize: 9, fontWeight: 900, textTransform: "uppercase" as const, letterSpacing: ".8px", color: C.nick, minWidth: 48 }}>Nicks</span>
                    <button onClick={() => setConfirmBulk("All Active Nicks")} style={{ padding: "2px 9px", borderRadius: 5, border: `1px solid ${ACT}44`, background: `${ACT}18`, color: ACT, cursor: "pointer", fontSize: 10, fontWeight: 800 }}>All Active</button>
                    <button onClick={() => setConfirmBulk("All Inactive Nicks")} style={{ padding: "2px 9px", borderRadius: 5, border: `1px solid ${INACT}44`, background: `${INACT}15`, color: INACT, cursor: "pointer", fontSize: 10, fontWeight: 800 }}>All Inactive</button>
                    <div style={{ width: 1, height: 14, background: "rgba(124,77,255,.25)" }} />
                    <span style={{ fontSize: 9, fontWeight: 900, textTransform: "uppercase" as const, letterSpacing: ".8px", color: C.pronoun, minWidth: 56 }}>Pronouns</span>
                    <button onClick={() => setConfirmBulk("All Active Pronouns")} style={{ padding: "2px 9px", borderRadius: 5, border: `1px solid ${ACT}44`, background: `${ACT}18`, color: ACT, cursor: "pointer", fontSize: 10, fontWeight: 800 }}>All Active</button>
                    <button onClick={() => setConfirmBulk("All Inactive Pronouns")} style={{ padding: "2px 9px", borderRadius: 5, border: `1px solid ${INACT}44`, background: `${INACT}15`, color: INACT, cursor: "pointer", fontSize: 10, fontWeight: 800 }}>All Inactive</button>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" as const }}>
                    <span style={{ fontSize: 9, fontWeight: 900, textTransform: "uppercase" as const, letterSpacing: ".8px", color: C.nick, minWidth: 72 }}>Nick Mode</span>
                    <button onClick={() => setConfirmBulk("All Nick Both")} style={{ padding: "2px 9px", borderRadius: 5, border: `1px solid ${NM_COLOR.both}44`, background: `${NM_COLOR.both}18`, color: NM_COLOR.both, cursor: "pointer", fontSize: 10, fontWeight: 800 }}>All Both</button>
                    <button onClick={() => setConfirmBulk("All Nick Custom")} style={{ padding: "2px 9px", borderRadius: 5, border: `1px solid ${NM_COLOR.custom}44`, background: `${NM_COLOR.custom}18`, color: NM_COLOR.custom, cursor: "pointer", fontSize: 10, fontWeight: 800 }}>All Custom</button>
                    <button onClick={() => setConfirmBulk("All Nick Global")} style={{ padding: "2px 9px", borderRadius: 5, border: `1px solid ${NM_COLOR.global}44`, background: `${NM_COLOR.global}18`, color: NM_COLOR.global, cursor: "pointer", fontSize: 10, fontWeight: 800 }}>All Global</button>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" as const }}>
                    <span style={{ fontSize: 9, fontWeight: 900, textTransform: "uppercase" as const, letterSpacing: ".8px", color: C.pronoun, minWidth: 72 }}>Pr Mode</span>
                    <button onClick={() => setConfirmBulk("All Pr Both")} style={{ padding: "2px 9px", borderRadius: 5, border: `1px solid ${NM_COLOR.both}44`, background: `${NM_COLOR.both}18`, color: NM_COLOR.both, cursor: "pointer", fontSize: 10, fontWeight: 800 }}>All Both</button>
                    <button onClick={() => setConfirmBulk("All Pr Custom")} style={{ padding: "2px 9px", borderRadius: 5, border: `1px solid ${NM_COLOR.custom}44`, background: `${NM_COLOR.custom}18`, color: NM_COLOR.custom, cursor: "pointer", fontSize: 10, fontWeight: 800 }}>All Custom</button>
                    <button onClick={() => setConfirmBulk("All Pr Global")} style={{ padding: "2px 9px", borderRadius: 5, border: `1px solid ${NM_COLOR.global}44`, background: `${NM_COLOR.global}18`, color: NM_COLOR.global, cursor: "pointer", fontSize: 10, fontWeight: 800 }}>All Global</button>
                </div>
                {settings.store.voiceActivateEnabled && !settings.store.voiceActivateGlobal && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" as const }}>
                        <span style={{ fontSize: 9, fontWeight: 900, textTransform: "uppercase" as const, letterSpacing: ".8px", color: "#7986cb", minWidth: 48 }}>Voice</span>
                        <button onClick={() => setConfirmBulk("All VC-Only")} style={{ padding: "2px 9px", borderRadius: 5, border: "1px solid #7986cb44", background: "#7986cb18", color: "#7986cb", cursor: "pointer", fontSize: 10, fontWeight: 800 }}>All VC-Only</button>
                        <button onClick={() => setConfirmBulk("All Always")} style={{ padding: "2px 9px", borderRadius: 5, border: "1px solid #80cbc444", background: "#80cbc418", color: "#80cbc4", cursor: "pointer", fontSize: 10, fontWeight: 800 }}>All Always</button>
                    </div>
                )}
            </div>

            <div className="rs-toolbar">
                <TextInput placeholder="Filter servers..." value={filter} onChange={setFilter} />
                {(["enabled", "name", "nicks", "pronouns", "running"] as SortMode[]).map(m => (
                    <button key={m} className="rs-sort-btn"
                        style={{ background: sort === m ? "rgba(124,77,255,.35)" : "rgba(124,77,255,.1)", border: "1px solid rgba(124,77,255,.25)", color: sort === m ? "#e8d5ff" : "#757575", cursor: "pointer" }}
                        onClick={() => setSort(m)}>{m}</button>
                ))}
            </div>

            {sorted.length === 0 && <div className="rs-empty">No servers found.</div>}
            <div style={{ maxHeight: 520, overflowY: "auto", paddingRight: 2 }}>
            {sorted.map(g => {
                const color = colorFor(g.id);
                const running = nickTimers.has(g.id) && settings.store.nickEnabled;
                const mode = nickModeOf(g);
                const effective = [...new Set(nicksForGuild(g))];
                const es = nickEdit[g.id] ?? null;
                const gPrList = g.guildPronouns ?? [];
                const effectivePrList = pronounsForGuild(g);
                const isNickActive = g.voiceActivated && settings.store.voiceActivateEnabled && !settings.store.voiceActivateGlobal
                    ? g.nickVoiceEnabled
                    : running;
                const isPronounsActive = g.voiceActivated && settings.store.voiceActivateEnabled && !settings.store.voiceActivateGlobal
                    ? g.pronounsVoiceEnabled
                    : g.guildPronounsEnabled;
                return (
                    <div key={g.id} className="rs-card" style={{ borderColor: (g.enabled && settings.store.nickEnabled) ? `${color}60` : "rgba(124,77,255,.2)" }}>
                        <div className="rs-card-header">
                            <div className="rs-card-left">
                                <div className="rs-dot" title={g.id} style={{ width: 8, height: 8, background: running ? color : "#2a1a4a", cursor: "help", flexShrink: 0 }} />
                                <div style={{ minWidth: 0, flex: 1 }}>
                                    <span className="rs-server-name" title={g.name}>{g.name}</span>
                                    <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 3, marginTop: 2 }}>
                                        <span className="rs-badge" style={{ background: `${NM_COLOR[mode]}30`, color: NM_COLOR[mode], border: `1px solid ${NM_COLOR[mode]}55` }}>
                                            {NM_LABEL[mode]} · {mode === "global" ? globalNicks.length : mode === "both" ? effective.length : g.nicks.length}n
                                        </span>
                                        {g.guildPronounsEnabled && (
                                            <span className="rs-badge" style={{ background: `${NM_COLOR[g.guildPronounsMode ?? "custom"]}30`, color: NM_COLOR[g.guildPronounsMode ?? "custom"], border: `1px solid ${NM_COLOR[g.guildPronounsMode ?? "custom"]}55` }}>
                                                {NM_LABEL[g.guildPronounsMode ?? "custom"]} · {effectivePrList.length}pr
                                            </span>
                                        )}
                                        {g.manual && <span className="rs-badge" style={{ background: "rgba(120,120,120,.2)", color: "#bdbdbd", border: "1px solid rgba(120,120,120,.35)" }}>manual</span>}
                                    </div>
                                </div>
                            </div>
                            <div className="rs-actions">
                                {settings.store.voiceActivateEnabled && !settings.store.voiceActivateGlobal && (
                                    <button
                                        style={{ display: "flex", alignItems: "center", gap: 3, padding: "3px 8px", borderRadius: 6, border: `1px solid ${g.voiceActivated ? "#7986cb55" : "rgba(80,60,110,.3)"}`, background: g.voiceActivated ? "#7986cb22" : "rgba(15,5,35,.5)", color: g.voiceActivated ? "#7986cb" : "#5a4a7a", cursor: "pointer", fontSize: 10, fontWeight: 800, flexShrink: 0 }}
                                        title="Toggle: Voice-only activates nicks+pronouns only when in this server's voice"
                                        onClick={() => {
                                            g.voiceActivated = !g.voiceActivated;
                                            saveData();
                                            if (pluginActive) {
                                                if (g.voiceActivated) {
                                                    const inVoice = getMyVoiceGuildId() === g.id;
                                                    if (!inVoice) { stopNickGuild(g.id); stopGuildPronouns(g.id); }
                                                } else {
                                                    if (g.enabled && !settings.store.globalSync) {
                                                        if (settings.store.nickEnabled && !nickTimers.has(g.id)) startNickGuild(g);
                                                        if (g.guildPronounsEnabled && pronounsForGuild(g).length > 0 && !guildPronounsTimers.has(g.id)) startGuildPronouns(g);
                                                    }
                                                }
                                            }
                                            forceUpdate();
                                        }}>
                                        🔊 {g.voiceActivated ? "VC-only" : "Always"}
                                    </button>
                                )}
                                <Button size={Button.Sizes.SMALL} color={g.enabled ? Button.Colors.GREEN : Button.Colors.PRIMARY} className="rs-btn-sm"
                                    onClick={() => toggleGuild(g)}>{g.enabled ? "ON" : "OFF"}</Button>
                                {g.manual && <button className="rs-del-btn" onClick={() => removeGuild(g)}>&#10005;</button>}
                            </div>
                        </div>
                        {g.enabled && (
                            <div className="rs-nick-expand">
                                <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 5 }}>
                                    <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: ".7px", color: NM_COLOR[mode] }}>Nicks</span>
                                    <div style={{ flex: 1, height: 1, background: `${NM_COLOR[mode]}22` }} />
                                    <span className="rs-count" style={{ background: `${NM_COLOR[mode]}18`, color: NM_COLOR[mode] }}>
                                        {mode === "global" ? globalNicks.length : mode === "both" ? effective.length : g.nicks.length}
                                    </span>
                                    <button
                                        style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 9px", borderRadius: 6, border: `1px solid ${NM_COLOR[mode]}44`, background: `${NM_COLOR[mode]}18`, color: NM_COLOR[mode], cursor: "pointer", fontSize: 10, fontWeight: 800, flexShrink: 0, transition: "all .15s" }}
                                        title="Cycle: Custom → Global → Both" onClick={() => cycleMode(g)}>{NM_LABEL[mode]}
                                    </button>
                                    <button
                                        style={{
                                            display: "flex", alignItems: "center", gap: 4, padding: "3px 9px", borderRadius: 6,
                                            border: `1px solid ${isNickActive ? ACT + "55" : INACT + "44"}`,
                                            background: isNickActive ? `${ACT}20` : `${INACT}15`,
                                            color: isNickActive ? ACT : INACT,
                                            cursor: settings.store.nickEnabled ? "pointer" : "not-allowed",
                                            fontSize: 10, fontWeight: 800, flexShrink: 0,
                                            opacity: settings.store.nickEnabled ? 1 : 0.4
                                        }}
                                        onClick={() => { if (settings.store.nickEnabled) toggleNickActive(g); }}>
                                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: isNickActive ? ACT : INACT, display: "inline-block" }} />
                                        {settings.store.nickEnabled ? (isNickActive ? "Active" : "Inactive") : "Disabled"}
                                    </button>
                                </div>
                                <div className="rs-hint" style={{ marginBottom: 5, color: NM_COLOR[mode] }}>
                                    {mode === "custom" ? "Server-specific nicks only (falls back to global if empty)" : mode === "global" ? "Global pool only" : "Global pool + server-specific, merged"}
                                </div>
                                {(mode === "custom" || mode === "both") && (
                                    <>
                                        {confirmClear === `nicks-${g.id}` && <ConfirmBox msg={`Clear all custom nicks for ${g.name}?`} onConfirm={() => { g.nicks = []; g.seqIndex = 0; g.lastNickVal = null; saveData(); forceUpdate(); setConfirmClear(null); }} onCancel={() => setConfirmClear(null)} />}
                                        <div className="rs-nick-list">
                                            {g.nicks.length === 0
                                                ? <span className="rs-empty">{mode === "custom" ? `No custom nicks - using global pool (${globalNicks.length}).` : "No custom nicks yet."}</span>
                                                : g.nicks.map((n, ni) => (
                                                    <div key={`${g.id}_n_${ni}`}
                                                        draggable
                                                        onDragStart={de => { de.dataTransfer.effectAllowed = "move"; de.dataTransfer.setData("text/plain", `NICK:${g.id}:${ni}`); }}
                                                        onDragOver={de => de.preventDefault()}
                                                        onDrop={de => {
                                                            de.preventDefault();
                                                            const [type, dGid, dI] = de.dataTransfer.getData("text/plain").split(":");
                                                            if (type === "NICK" && dGid === g.id) { const from = parseInt(dI, 10); if (!isNaN(from) && from !== ni) { g.nicks = reorder(g.nicks, from, ni); g.seqIndex = 0; g.lastNickVal = null; saveData(); forceUpdate(); } }
                                                        }}
                                                        className="rs-item rs-item-compact">
                                                        <span className="rs-drag">⠿</span>
                                                        {es && es.idx === ni
                                                            ? <input autoFocus className="rs-item-input" value={es.val}
                                                                onChange={e2 => setNickEdit(p => ({ ...p, [g.id]: { idx: ni, val: e2.target.value } }))}
                                                                onKeyDown={(e2: React.KeyboardEvent) => { if (e2.key === "Enter") saveNickEdit(g); if (e2.key === "Escape") setNickEdit(p => ({ ...p, [g.id]: null })); }}
                                                                onBlur={() => saveNickEdit(g)} />
                                                            : <span className="rs-item-text" style={{ color: color, fontWeight: 600 }}>{n}</span>
                                                        }
                                                        <button className="rs-edit-btn" onClick={() => setNickEdit(p => ({ ...p, [g.id]: { idx: ni, val: n } }))}>&#9998;</button>
                                                        <button className="rs-del-btn" onClick={() => removeNick(g, ni)}>&#10005;</button>
                                                    </div>
                                                ))}
                                        </div>
                                        <div className="rs-row">
                                            <TextInput value={nickInputs[g.id] ?? ""} onChange={(v: string) => setNickInputs(p => ({ ...p, [g.id]: v }))}
                                                placeholder="Add a custom nick for this server..."
                                                onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") addNick(g); }} />
                                            <Button size={Button.Sizes.SMALL} color={Button.Colors.BRAND} onClick={() => addNick(g)} className="rs-btn-sm">Add</Button>
                                            {g.nicks.length > 0 && <button className="rs-clearall" onClick={() => setConfirmClear(`nicks-${g.id}`)}>Clear</button>}
                                        </div>
                                    </>
                                )}
                                {mode === "global" && (
                                    <div className="rs-hint">Using global pool (<b style={{ color: C.nick }}>{globalNicks.length} nicks</b>). Switch to Custom or Both to add server-specific nicks.</div>
                                )}

                                <div style={{ marginTop: 8, borderTop: `1px solid ${C.pronoun}22`, paddingTop: 7 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 5 }}>
                                        <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: ".7px", color: C.pronoun }}>Pronouns</span>
                                        <div style={{ flex: 1, height: 1, background: `${C.pronoun}22` }} />
                                        <span className="rs-count" style={{ background: `${C.pronoun}18`, color: C.pronoun }}>
                                            {effectivePrList.length}
                                        </span>
                                        <button
                                            style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 9px", borderRadius: 6, border: `1px solid ${NM_COLOR[g.guildPronounsMode ?? "custom"]}44`, background: `${NM_COLOR[g.guildPronounsMode ?? "custom"]}18`, color: NM_COLOR[g.guildPronounsMode ?? "custom"], cursor: "pointer", fontSize: 10, fontWeight: 800, flexShrink: 0, transition: "all .15s" }}
                                            title="Cycle pronoun‑source mode: Custom → Global → Both"
                                            onClick={() => { const cur: NickMode = g.guildPronounsMode ?? "custom"; g.guildPronounsMode = NM_NEXT[cur]; g.guildPronounsSeqIdx = 0; g.guildPronounsLastVal = null; saveData(); forceUpdate(); }}>
                                            {NM_LABEL[g.guildPronounsMode ?? "custom"]}
                                        </button>
                                        <button
                                            style={{
                                                display: "flex", alignItems: "center", gap: 4, padding: "3px 9px", borderRadius: 6,
                                                border: `1px solid ${isPronounsActive ? ACT + "55" : INACT + "44"}`,
                                                background: isPronounsActive ? `${ACT}20` : `${INACT}15`,
                                                color: isPronounsActive ? ACT : INACT,
                                                cursor: settings.store.serverPronounsEnabled ? "pointer" : "not-allowed",
                                                fontSize: 10, fontWeight: 800, flexShrink: 0,
                                                opacity: settings.store.serverPronounsEnabled ? 1 : 0.4
                                            }}
                                            onClick={() => { if (settings.store.serverPronounsEnabled) toggleGuildPronounsActive(g); }}>
                                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: isPronounsActive ? ACT : INACT, display: "inline-block" }} />
                                            {settings.store.serverPronounsEnabled ? (isPronounsActive ? "Active" : "Inactive") : "Disabled"}
                                        </button>
                                    </div>
                                    {(g.guildPronounsMode ?? "custom") === "custom" && gPrList.length === 0 && effectivePrList.length > 0 && (
                                        <div className="rs-hint" style={{ marginBottom: 4, color: C.pronoun }}>No local entries - using {effectivePrList.length} from the global pronoun pool.</div>
                                    )}
                                    {(g.guildPronounsMode ?? "custom") === "global" && (
                                        <div className="rs-hint" style={{ marginBottom: 4, color: NM_COLOR.global }}>Using global pool only (<b>{globalGuildPronouns.length} entries</b>). Switch to Custom or Both to use local.</div>
                                    )}
                                    {(g.guildPronounsMode ?? "custom") === "both" && (
                                        <div className="rs-hint" style={{ marginBottom: 4, color: NM_COLOR.both }}>Merged: {globalGuildPronouns.length} global + {gPrList.length} local = <b>{effectivePrList.length} total</b>.</div>
                                    )}
                                    {effectivePrList.length === 0 && (
                                        <div className="rs-empty" style={{ marginBottom: 4 }}>No pronouns set - add local entries or fill the global pronoun pool above.</div>
                                    )}
                                    {confirmClear === `pr-${g.id}` && <ConfirmBox msg={`Clear all local pronouns for ${g.name}?`} onConfirm={() => { g.guildPronouns = []; g.guildPronounsSeqIdx = 0; g.guildPronounsLastVal = null; saveData(); forceUpdate(); setConfirmClear(null); }} onCancel={() => setConfirmClear(null)} />}
                                    <div style={{ maxHeight: 130, overflowY: "auto", paddingRight: 2 }}>
                                    {gPrList.map((pr, pi) => (
                                        <div key={`${g.id}_pr_${pi}`}
                                            draggable
                                            onDragStart={de => { de.dataTransfer.effectAllowed = "move"; de.dataTransfer.setData("text/plain", `PR:${g.id}:${pi}`); }}
                                            onDragOver={de => de.preventDefault()}
                                            onDrop={de => {
                                                de.preventDefault();
                                                const parts = de.dataTransfer.getData("text/plain").split(":");
                                                if (parts[0] === "PR" && parts[1] === g.id) { const from = parseInt(parts[2], 10); if (!isNaN(from) && from !== pi) { g.guildPronouns = reorder(gPrList, from, pi); g.guildPronounsSeqIdx = 0; g.guildPronounsLastVal = null; saveData(); forceUpdate(); } }
                                            }}
                                            className="rs-item rs-item-compact" style={{ marginBottom: 2 }}>
                                            <span className="rs-drag">⠿</span>
                                            {nickEdit[`__pr_${g.id}_${pi}`]
                                                ? <input autoFocus className="rs-item-input" value={(nickEdit[`__pr_${g.id}_${pi}`] as any).val} maxLength={40}
                                                    onChange={e2 => setNickEdit(p => ({ ...p, [`__pr_${g.id}_${pi}`]: { idx: pi, val: e2.target.value } }))}
                                                    onKeyDown={(e2: React.KeyboardEvent) => {
                                                        if (e2.key === "Enter") { const v = (nickEdit[`__pr_${g.id}_${pi}`] as any).val.trim(); if (v) { g.guildPronouns = [...gPrList]; g.guildPronouns[pi] = v; saveData(); } setNickEdit(p => ({ ...p, [`__pr_${g.id}_${pi}`]: null })); forceUpdate(); }
                                                        if (e2.key === "Escape") setNickEdit(p => ({ ...p, [`__pr_${g.id}_${pi}`]: null }));
                                                    }}
                                                    onBlur={() => { const ek = nickEdit[`__pr_${g.id}_${pi}`]; const v = (ek as any)?.val?.trim(); if (v) { g.guildPronouns = [...gPrList]; g.guildPronouns[pi] = v; saveData(); } setNickEdit(p => ({ ...p, [`__pr_${g.id}_${pi}`]: null })); forceUpdate(); }} />
                                                : <span className="rs-item-text" style={{ color: C.pronoun, fontWeight: 600 }}
                                                    onDoubleClick={() => setNickEdit(p => ({ ...p, [`__pr_${g.id}_${pi}`]: { idx: pi, val: pr } }))}>{pr}</span>
                                            }
                                            <button className="rs-edit-btn" onClick={() => setNickEdit(p => ({ ...p, [`__pr_${g.id}_${pi}`]: { idx: pi, val: pr } }))}>&#9998;</button>
                                            <button className="rs-del-btn" onClick={() => { g.guildPronouns = gPrList.filter((_, j) => j !== pi); g.guildPronounsSeqIdx = 0; g.guildPronounsLastVal = null; saveData(); forceUpdate(); }}>&#10005;</button>
                                        </div>
                                    ))}
                                    </div>
                                    <div className="rs-row" style={{ marginTop: 4 }}>
                                        <TextInput value={nickInputs[`__pr_${g.id}`] ?? ""} onChange={(v: string) => setNickInputs(p => ({ ...p, [`__pr_${g.id}`]: v.slice(0, 40) }))}
                                            placeholder="Add a pronoun for this server (max 40)..."
                                            onKeyDown={(e: React.KeyboardEvent) => {
                                                if (e.key === "Enter") { const v = (nickInputs[`__pr_${g.id}`] ?? "").trim(); if (v && !gPrList.includes(v)) { g.guildPronouns = [...gPrList, v]; saveData(); setNickInputs(p => ({ ...p, [`__pr_${g.id}`]: "" })); forceUpdate(); } }
                                            }} />
                                        <Button size={Button.Sizes.SMALL} color={Button.Colors.BRAND} className="rs-btn-sm" onClick={() => {
                                            const v = (nickInputs[`__pr_${g.id}`] ?? "").trim();
                                            if (v && !gPrList.includes(v)) { g.guildPronouns = [...gPrList, v]; saveData(); setNickInputs(p => ({ ...p, [`__pr_${g.id}`]: "" })); forceUpdate(); }
                                        }}>Add</Button>
                                        {gPrList.length > 0 && <button className="rs-clearall" onClick={() => setConfirmClear(`pr-${g.id}`)}>Clear</button>}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}
            </div>

            <div className="rs-manual-add">
                <div className="rs-manual-add-title">Add server manually</div>
                <div style={{ display: "flex", gap: 6 }}>
                    <TextInput placeholder="Server ID (17-20 digits)" value={manualId} onChange={setManualId} style={{ flex: 1 }} />
                    <TextInput placeholder="Label (optional)" value={manualName} onChange={setManualName} style={{ flex: 1 }} />
                    <Button size={Button.Sizes.SMALL} color={Button.Colors.BRAND} className="rs-btn-sm" onClick={addManual}>Add</Button>
                </div>
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 7, flexWrap: "wrap" as const, alignItems: "center" }}>
                {confirmClear === "__enableAll"
                    ? <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 6, background: "rgba(67,160,71,.1)", border: "1px solid rgba(67,160,71,.3)" }}>
                        <span style={{ fontSize: 11, color: ACT, fontWeight: 700 }}>Enable all servers?</span>
                        <button onClick={() => { enableAll(); setConfirmClear(null); }} style={{ padding: "1px 8px", borderRadius: 4, border: `1px solid ${ACT}44`, background: `${ACT}18`, color: ACT, cursor: "pointer", fontSize: 10, fontWeight: 800 }}>Yes</button>
                        <button onClick={() => setConfirmClear(null)} style={{ padding: "1px 8px", borderRadius: 4, border: "1px solid rgba(80,60,110,.4)", background: "rgba(15,5,35,.6)", color: "#9e9e9e", cursor: "pointer", fontSize: 10, fontWeight: 800 }}>No</button>
                      </div>
                    : <Button color={Button.Colors.GREEN} onClick={() => setConfirmClear("__enableAll")} className="rs-btn-sm">Enable All</Button>
                }
                {confirmClear === "__disableAll"
                    ? <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 6, background: "rgba(120,120,120,.1)", border: "1px solid rgba(120,120,120,.3)" }}>
                        <span style={{ fontSize: 11, color: "#bdbdbd", fontWeight: 700 }}>Disable all servers?</span>
                        <button onClick={() => { disableAll(); setConfirmClear(null); }} style={{ padding: "1px 8px", borderRadius: 4, border: "1px solid #bdbdbd44", background: "#bdbdbd18", color: "#bdbdbd", cursor: "pointer", fontSize: 10, fontWeight: 800 }}>Yes</button>
                        <button onClick={() => setConfirmClear(null)} style={{ padding: "1px 8px", borderRadius: 4, border: "1px solid rgba(80,60,110,.4)", background: "rgba(15,5,35,.6)", color: "#9e9e9e", cursor: "pointer", fontSize: 10, fontWeight: 800 }}>No</button>
                      </div>
                    : <Button color={Button.Colors.PRIMARY} onClick={() => setConfirmClear("__disableAll")} className="rs-btn-sm">Disable All</Button>
                }
                {confirmClear === "__resetNicks"
                    ? <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 6, background: "rgba(239,83,80,.1)", border: "1px solid rgba(239,83,80,.3)" }}>
                        <span style={{ fontSize: 11, color: INACT, fontWeight: 700 }}>Reset ALL server nick lists?</span>
                        <button onClick={() => { resetAllNicks(); setConfirmClear(null); }} style={{ padding: "1px 8px", borderRadius: 4, border: `1px solid ${INACT}44`, background: `${INACT}18`, color: INACT, cursor: "pointer", fontSize: 10, fontWeight: 800 }}>Yes</button>
                        <button onClick={() => setConfirmClear(null)} style={{ padding: "1px 8px", borderRadius: 4, border: "1px solid rgba(80,60,110,.4)", background: "rgba(15,5,35,.6)", color: "#9e9e9e", cursor: "pointer", fontSize: 10, fontWeight: 800 }}>No</button>
                      </div>
                    : <Button color={Button.Colors.RED} onClick={() => setConfirmClear("__resetNicks")} className="rs-btn-sm">Reset All Nicks</Button>
                }
            </div>
            <div className="rs-hint" style={{ marginTop: 6 }}>
                Nicks: <b style={{ color: settings.store.nickEnabled ? C.enabled : "#ef9a9a" }}>{settings.store.nickEnabled ? "on" : "off"}</b> · {activeCount} running · {enabledCount} servers enabled
                <br />Pronouns: <b style={{ color: settings.store.serverPronounsEnabled ? C.enabled : "#ef9a9a" }}>{settings.store.serverPronounsEnabled ? "on" : "off"}</b> · {guildPronounsTimers.size} running · {settings.store.serverPronounsIntervalSeconds}s interval
            </div>
        </div>
    );

}

function StopAllPanel({ forceUpdate }: { forceUpdate: () => void }) {
    const [durVal, setDurVal] = React.useState("30");
    const [durUnit, setDurUnit] = React.useState<"s" | "m" | "h">("m");
    const [now, setNow] = React.useState(Date.now());
    const stopped = isManualStop || wasInvisible;

    React.useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, []);

    function toMs(): number {
        const n = Math.max(1, parseFloat(durVal) || 1);
        if (durUnit === "h") return n * 3600000;
        if (durUnit === "m") return n * 60000;
        return n * 1000;
    }

    function remaining(): string {
        if (!globalStopEndTime) return "";
        const diff = globalStopEndTime - now;
        if (diff <= 0) return "";
        const s = Math.ceil(diff / 1000);
        if (s < 60) return `${s}s`;
        const m = Math.floor(s / 60); const rs = s % 60;
        if (m < 60) return `${m}m ${rs}s`;
        const h = Math.floor(m / 60); const rm = m % 60;
        return `${h}h ${rm}m`;
    }

    const rem = remaining();
    const invisPaused = wasInvisible && !isManualStop;

    return (
        <div style={{ marginTop: 10 }}>
            <div className="rs-divider" style={{ margin: "8px 0" }} />
            <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: ".7px", color: "#e57373", marginBottom: 6 }}>Rotator Control</div>
            {stopped && (
                <div style={{ padding: "7px 11px", borderRadius: 8, background: "rgba(239,83,80,.1)", border: "1px solid rgba(239,83,80,.35)", marginBottom: 8, fontSize: 11, color: "#ef9a9a", lineHeight: 1.6 }}>
                    {invisPaused
                        ? "⛔ All rotators paused - invisible status detected. They will resume when you become visible."
                        : rem
                            ? `⏸ All rotators stopped - resuming in ${rem}.`
                            : "⏸ All rotators manually stopped. Press Resume to restart."
                    }
                </div>
            )}
            {!stopped && (
                <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" as const, marginBottom: 8 }}>
                    <span style={{ fontSize: 11, color: "#9e9e9e" }}>Stop for:</span>
                    <input type="number" min={1} value={durVal}
                        onChange={e => setDurVal(e.target.value)}
                        onFocus={e => e.target.select()}
                        onKeyDown={e => e.stopPropagation()}
                        style={{ width: 56, background: "rgba(10,0,30,.7)", border: "1px solid rgba(239,83,80,.35)", borderRadius: 5, color: "#f0eaff", fontSize: 12, padding: "3px 7px", outline: "none", textAlign: "center" }} />
                    {(["s", "m", "h"] as const).map(u => (
                        <button key={u} onClick={() => setDurUnit(u)}
                            style={{ padding: "3px 9px", borderRadius: 5, fontSize: 11, fontWeight: 700, cursor: "pointer", border: `1px solid ${durUnit === u ? "rgba(239,83,80,.6)" : "rgba(239,83,80,.25)"}`, background: durUnit === u ? "rgba(239,83,80,.18)" : "rgba(10,0,30,.6)", color: durUnit === u ? "#ef9a9a" : "#5a4a7a" }}>
                            {u}
                        </button>
                    ))}
                    <button onClick={() => { doGlobalStop(toMs()); forceUpdate(); }}
                        style={{ padding: "4px 12px", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer", border: "1px solid rgba(239,83,80,.4)", background: "rgba(239,83,80,.15)", color: "#ef9a9a" }}>
                        ⏹ Stop
                    </button>
                    <button onClick={() => { doGlobalStop(null); forceUpdate(); }}
                        style={{ padding: "4px 12px", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer", border: "1px solid rgba(239,83,80,.25)", background: "rgba(239,83,80,.08)", color: "#ef9a9a88" }}>
                        ⏹ Stop ∞
                    </button>
                </div>
            )}
            <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" as const }}>
                {stopped && !invisPaused && (
                    <button onClick={() => { doGlobalResume(); forceUpdate(); }}
                        style={{ padding: "4px 14px", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer", border: "1px solid rgba(67,160,71,.5)", background: "rgba(67,160,71,.15)", color: "#81c784" }}>
                        ▶ Resume Now
                    </button>
                )}
                <Button color={Button.Colors.BRAND} onClick={() => { if (!isManualStop && !wasInvisible) { startAllRotators(); forceUpdate(); } }} className="rs-btn-sm"
                    style={{ opacity: (isManualStop || wasInvisible) ? 0.4 : 1 }}>
                    ↺ Restart All Rotators
                </Button>
                <span className="rs-hint">Use after changing interval values in other tabs.</span>
            </div>
        </div>
    );
}

function DataTab({ forceUpdate }: { forceUpdate: () => void }) {
    const [importMsg, setImportMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
    const [confirmReset, setConfirmReset] = React.useState(false);
    const isGlobalSync = settings.store.globalSync;

    function doExport() {
        const blob = new Blob([JSON.stringify({
            exportedAt: new Date().toISOString(), createdAt: storeCreatedAt,
            globalNicks, guilds, bioEntries, pronounsList, statusEntries, statusPresets, clanIds,
            statusSeqIdx, clanSeqIdx, bioSeqIdx, prSeqIdx,
            globalNickEntries, globalNickSeqIdx, globalGuildPronouns,
            avatars: arAvatars, avatarSeqIndex: arSeqIndex,
            bannerFavorites: bcrFavorites,
            bannerMode: settings.store.bannerMode,
            bannerIntervalSeconds: settings.store.bannerIntervalSeconds,
            bannerHueRadius: settings.store.bannerHueRadius,
            bannerCustomBaseColor: settings.store.bannerCustomBaseColor,
            bannerShowToast: settings.store.bannerShowToast,
            bannerShowCurrentColor: settings.store.bannerShowCurrentColor,
        }, null, 2)], { type: "application/json" });
        const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `rotator-suite-${new Date().toISOString().slice(0, 10)}.json` });
        a.click(); URL.revokeObjectURL(a.href);
    }

    function doImport() {
        const inp = Object.assign(document.createElement("input"), { type: "file", accept: ".json" });
        inp.onchange = async () => {
            const file = inp.files?.[0]; if (!file) return;
            try {
                const p = JSON.parse(await file.text());
                if (Array.isArray(p.globalNicks)) globalNicks = p.globalNicks;
                if (Array.isArray(p.guilds)) guilds = p.guilds.map((g: any) => ({ ...g, nickMode: g.nickMode ?? (g.useGlobal ? "global" : "custom"), lastNickVal: null, nickVoiceEnabled: g.nickVoiceEnabled ?? g.enabled, pronounsVoiceEnabled: g.pronounsVoiceEnabled ?? g.guildPronounsEnabled }));
                if (Array.isArray(p.bioEntries)) bioEntries = p.bioEntries;
                if (typeof p.pronounsList === "string") pronounsList = p.pronounsList;
                if (Array.isArray(p.statusEntries)) statusEntries = p.statusEntries;
                else if (typeof p.statuses === "string") statusEntries = parseLegacyStatuses(p.statuses);
                if (Array.isArray(p.statusPresets)) statusPresets = p.statusPresets;
                if (Array.isArray(p.clanIds)) clanIds = p.clanIds;
                statusSeqIdx = 0; clanSeqIdx = 0; bioSeqIdx = 0; prSeqIdx = 0;
                statusLastVal = null; clanLastVal = null; bioLastVal = null; prLastVal = null;
                if (Array.isArray(p.globalNickEntries)) globalNickEntries = p.globalNickEntries;
                globalNickSeqIdx = 0; globalNickLastVal = null;
                if (Array.isArray(p.globalGuildPronouns)) globalGuildPronouns = p.globalGuildPronouns;
                if (Array.isArray(p.avatars)) {
                    arAvatars = p.avatars.filter((a: any) => typeof a.id === "string" && typeof a.label === "string" && typeof a.data === "string");
                    arSeqIndex = typeof p.avatarSeqIndex === "number" ? p.avatarSeqIndex : 0;
                    arShuffleQueue = [];
                    await arSaveData();
                }
                if (Array.isArray(p.bannerFavorites)) {
                    bcrFavorites = p.bannerFavorites.filter((x: any) => typeof x === "string" && bcrIsValidHex(x));
                    bcrUsedFavs = []; await bcrSaveData();
                }
                if (typeof p.bannerMode === "string") (settings.store as any).bannerMode = p.bannerMode;
                if (typeof p.bannerIntervalSeconds === "number") (settings.store as any).bannerIntervalSeconds = p.bannerIntervalSeconds;
                if (typeof p.bannerHueRadius === "number") (settings.store as any).bannerHueRadius = p.bannerHueRadius;
                if (typeof p.bannerCustomBaseColor === "string" && bcrIsValidHex(p.bannerCustomBaseColor)) (settings.store as any).bannerCustomBaseColor = p.bannerCustomBaseColor;
                if (typeof p.bannerShowToast === "boolean") (settings.store as any).bannerShowToast = p.bannerShowToast;
                if (typeof p.bannerShowCurrentColor === "boolean") (settings.store as any).bannerShowCurrentColor = p.bannerShowCurrentColor;
                await saveData(); startAllRotators();
                const d = p.exportedAt ? new Date(p.exportedAt).toLocaleString() : "unknown";
                setImportMsg({ ok: true, text: `Imported successfully (exported ${d})` });
                forceUpdate(); setTimeout(() => setImportMsg(null), 5000);
            } catch {
                setImportMsg({ ok: false, text: "Import failed - invalid or corrupt JSON" });
                setTimeout(() => setImportMsg(null), 5000);
            }
        };
        inp.click();
    }

    function doResetAll() {
        stopAllRotators();
        globalNicks = []; guilds = []; bioEntries = [];
        pronounsList = ""; statusEntries = []; statusPresets = []; clanIds = [];
        statusSeqIdx = 0; clanSeqIdx = 0; bioSeqIdx = 0; prSeqIdx = 0;
        statusLastVal = null; clanLastVal = null; bioLastVal = null; prLastVal = null;
        globalNickEntries = []; globalNickSeqIdx = 0; globalNickLastVal = null;
        globalGuildPronouns = [];
        arAvatars = []; arSeqIndex = 0; arShuffleQueue = []; arStopRotator();
        bcrFavorites = []; bcrUsedFavs = []; bcrCurrentColor = null;
        storeCreatedAt = new Date().toISOString();
        cachedClanGuilds = []; lastClanFetch = 0;
        syncGuildsFromDiscord();
        saveData(); arSaveData(); bcrSaveData(); startAllRotators(); forceUpdate(); setConfirmReset(false);
    }

    const activeLabels = [
        settings.store.statusEnabled && "Status",
        settings.store.clanEnabled && "Clan",
        settings.store.profileBioEnabled && "Bio",
        settings.store.profilePronounsEnabled && "Pronouns",
        settings.store.globalNickEnabled && "Display Name",
        settings.store.nickEnabled && guilds.some(g => g.enabled) && "Server Nicks",
        guilds.some(g => g.guildPronounsEnabled && (g.guildPronouns?.length ?? 0) > 0) && "Server Pronouns",
        settings.store.avatarEnabled && arGetActive().length > 0 && "Avatar",
        settings.store.bannerEnabled && "ColorBanner",
    ].filter(Boolean) as string[];

    return (
        <div>
            <div className="rs-data-card rs-master-box">
                <div className="rs-data-title">Master Sync</div>
                <div style={{ marginBottom: 7, fontSize: 11, color: "#9e9e9e", lineHeight: 1.5 }}>
                    <b style={{ color: "#f0eaff" }}>ON:</b> all rotators fire together every N seconds. Clan always runs independently.
                    <br /><b style={{ color: "#f0eaff" }}>OFF:</b> each rotator uses its own timer. Changes apply immediately.
                </div>
                <PanelToggle label="Master Sync" description={isGlobalSync ? `All rotators fire every ${settings.store.globalSyncSeconds}s` : "Each rotator runs on its own independent timer"} value={isGlobalSync} color={C.data}
                    onChange={v => { settings.store.globalSync = v; if (pluginActive) startAllRotators(); forceUpdate(); }} />
                <PanelInterval label="Master Sync Interval" description="Unified interval in seconds (only used when Master Sync is ON)"
                    storeKey="globalSyncSeconds" disabled={!isGlobalSync}
                    onApply={() => { if (pluginActive && isGlobalSync) startAllRotators(); }} />
                {isGlobalSync && settings.store.globalNickEnabled && parseFloat(settings.store.globalSyncSeconds) < 429 && (
                    <div className="rs-warn-box" style={{ marginTop: 5 }}>
                        ⚠️ Master Sync interval ({settings.store.globalSyncSeconds}s) is below 429s while Display Name rotation is enabled. Display name changes are automatically throttled to 1 per 429s to avoid rate limits - but going below 429s here is not recommended and may cause repeated 429 errors on /users/@me.
                    </div>
                )}
                <div className="rs-divider" style={{ margin: "8px 0" }} />
                <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: ".7px", color: "#ab47bc", marginBottom: 5 }}>Random Behavior</div>
                <PanelToggle label="No-Duplicate Random" description="Never pick the same entry twice in a row (applies to all rotators)" value={settings.store.noDuplicateRandom}
                    onChange={v => { settings.store.noDuplicateRandom = v; }} />
                <div className="rs-divider" style={{ margin: "8px 0" }} />
                <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: ".7px", color: "#9e9e9e", marginBottom: 5 }}>Misc</div>
                <PanelToggle label="Show User Area Button" description="Show the Rotator Suite button in the bottom-left user area" value={settings.store.showButton}
                    onChange={v => { settings.store.showButton = v; forceUpdate(); }} />
                <PanelToggle label="Console Logs" description="Print all rotator activity and errors to the browser console (F12)" value={settings.store.enableLogs}
                    onChange={v => { settings.store.enableLogs = v; }} />
                <PanelToggle label="Stop When Invisible" description="Automatically pause all rotators when your status is set to Invisible (resumes on visible)" value={settings.store.stopOnInvisible}
                    onChange={v => { settings.store.stopOnInvisible = v; if (v) startInvisibleWatcher(); else stopInvisibleWatcher(); forceUpdate(); }} />
                {activeLabels.length > 0 && (
                    <div style={{ fontSize: 11, color: "#9e9e9e", marginTop: 8 }}>
                        Active: <b style={{ color: C.enabled }}>{activeLabels.join(" · ")}</b>
                    </div>
                )}
                <StopAllPanel forceUpdate={forceUpdate} />
            </div>

            <div className="rs-data-card">
                <div className="rs-data-title">Import / Export</div>
                <div className="rs-data-desc">Export everything to JSON (including avatars). Import to fully restore any config.</div>
                {storeCreatedAt && <div className="rs-hint" style={{ marginBottom: 8 }}>Data created: <b>{new Date(storeCreatedAt).toLocaleString()}</b></div>}
                {importMsg && (
                    <div className="rs-import-status" style={{
                        background: importMsg.ok ? "rgba(67,160,71,.1)" : "rgba(239,83,80,.1)",
                        borderColor: importMsg.ok ? "rgba(67,160,71,.3)" : "rgba(239,83,80,.3)",
                        color: importMsg.ok ? "#81c784" : "#ef9a9a",
                    }}>{importMsg.text}</div>
                )}
                <div style={{ display: "flex", gap: 7 }}>
                    <Button color={Button.Colors.BRAND} onClick={doExport} className="rs-btn-sm">Export JSON</Button>
                    <Button color={Button.Colors.PRIMARY} onClick={doImport} className="rs-btn-sm">Import JSON</Button>
                </div>
            </div>

            <div className="rs-data-card" style={{ borderColor: "rgba(239,83,80,.28)" }}>
                <div className="rs-data-title" style={{ color: "#ef9a9a" }}>Reset All Data</div>
                <div className="rs-data-desc">Permanently deletes ALL entries: nicks, bio, statuses, clans, pronouns, avatars. Servers are re-synced from Discord. Cannot be undone.</div>
                {confirmReset
                    ? <ConfirmBox msg="Permanently delete ALL data? This cannot be undone." onConfirm={doResetAll} onCancel={() => setConfirmReset(false)} />
                    : <button className="rs-clearall" style={{ fontSize: 12, padding: "4px 12px" }} onClick={() => setConfirmReset(true)}>Reset All</button>
                }
            </div>

            <div className="rs-data-card">
                <div className="rs-data-title">Overview</div>
                <div className="rs-summary-grid">
                    <span>Global nicks (server): <b>{globalNicks.length}</b></span>
                    <span>Nick servers: <b>{guilds.length}</b></span>
                    <span>Bio entries: <b>{bioEntries.length}</b></span>
                    <span>Global pronouns: <b>{parseList(pronounsList).length}</b></span>
                    <span>Display names: <b>{globalNickEntries.length}</b></span>
                    <span>Status entries: <b>{statusEntries.length}</b></span>
                    <span>Clan IDs: <b>{settings.store.clanAutoDetect ? "auto" : clanIds.length}</b></span>
                    <span>Servers w/ guild pronouns: <b>{guilds.filter(g => (g.guildPronouns?.length ?? 0) > 0).length}</b></span>
                    <span>Avatars: <b>{arAvatars.length}</b></span>
                    <span>Banner favorites: <b>{bcrFavorites.length}</b></span>
                </div>
            </div>
        </div>
    );
}

function OnCloseBannerPanel({ forceUpdate }: { forceUpdate: () => void }) {
    const [enabled, setEnabled] = React.useState(closeBannerEnabled);
    const [color, setColor] = React.useState(closeBannerColor);
    const save = () => { closeBannerColor = color.trim(); void saveCloseConfig(); forceUpdate(); };
    return (
        <div>
            <PanelToggle label="On-Close Banner" description="Apply a fixed banner color when Discord closes (beforeunload - not fired on crash/kill)"
                value={enabled} color="#c084fc"
                onChange={v => { closeBannerEnabled = v; setEnabled(v); void saveCloseConfig(); forceUpdate(); }} />
            {enabled && (
                <div style={{ display: "flex", flexDirection: "column", gap: 5, padding: "7px 10px", border: "1px solid rgba(192,132,252,.25)", borderRadius: 7, background: "rgba(10,0,30,.5)", marginTop: 3 }}>
                    <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
                        <div style={{ width: 22, height: 22, borderRadius: 4, background: bcrIsValidHex(color) ? color : "#333", border: "1.5px solid rgba(255,255,255,.18)", flexShrink: 0 }} />
                        <input value={color} onChange={e => setColor(e.target.value)} onBlur={save}
                            onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") save(); }}
                            placeholder="#rrggbb"
                            maxLength={7}
                            style={{ flex: 1, background: "rgba(10,0,30,.7)", border: `1px solid ${bcrIsValidHex(color) ? "rgba(192,132,252,.44)" : "rgba(239,83,80,.5)"}`, borderRadius: 5, color: "#f0eaff", fontSize: 12, padding: "3px 7px", outline: "none", fontFamily: "monospace" }} />
                        <button onClick={() => { const c = bcrCurrentColor ?? "#111214"; setColor(c); closeBannerColor = c; void saveCloseConfig(); forceUpdate(); }}
                            style={{ padding: "3px 9px", borderRadius: 5, border: "1px solid rgba(192,132,252,.3)", background: "rgba(192,132,252,.12)", color: "#c084fc", cursor: "pointer", fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
                            Use current
                        </button>
                    </div>
                    {color.trim() && !bcrIsValidHex(color.trim()) && (
                        <div style={{ fontSize: 10, color: "#ef9a9a" }}>⚠ Invalid hex - must be #rrggbb format.</div>
                    )}
                    {bcrIsValidHex(color.trim()) && (
                        <div style={{ fontSize: 10, color: "#c084fc", opacity: .8 }}>Banner will be set to <b>{color.trim()}</b> upon closure.</div>
                    )}
                </div>
            )}
        </div>
    );
}

function BcrHr() { return <div style={{ height: 1, background: "rgba(255,255,255,.07)", margin: "7px 0" }} />; }
function BcrSwatch({ color, size = 22, active, onClick, title: t }: { color: string; size?: number; active?: boolean; onClick?: () => void; title?: string }) {
    return <div title={t ?? color} onClick={onClick} style={{ width: size, height: size, borderRadius: 5, background: bcrIsValidHex(color) ? color : "#333", flexShrink: 0, cursor: onClick ? "pointer" : "default", border: active ? "2px solid #c084fc" : "1.5px solid rgba(255,255,255,.18)", boxSizing: "border-box" }} />;
}
function BcrToggle({ value, onChange }: { value: boolean; onChange: () => void }) {
    return <div onClick={onChange} style={{ width: 34, height: 18, borderRadius: 9, flexShrink: 0, cursor: "pointer", background: value ? "#c084fc" : "rgba(255,255,255,.13)", position: "relative", userSelect: "none" }}><div style={{ position: "absolute", top: 2, left: value ? 16 : 2, width: 14, height: 14, borderRadius: "50%", background: "#fff" }} /></div>;
}
function BcrHsvPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
    const W = 200, H = 110;
    const cvRef = React.useRef<HTMLCanvasElement>(null);
    const hsvR = React.useRef<[number, number, number]>(bcrIsValidHex(value) ? bcrHexToHsv(value) : [270, 0.48, 0.79]);
    const dragCv = React.useRef(false); const dragHue = React.useRef(false);
    const [hsv, setHsv] = React.useState<[number, number, number]>(hsvR.current);
    const [hex, setHex] = React.useState(bcrIsValidHex(value) ? value : "#c084fc");
    const draw = (hue: number) => { const cv = cvRef.current; if (!cv) return; const ctx = cv.getContext("2d")!; const gH = ctx.createLinearGradient(0, 0, W, 0); gH.addColorStop(0, "#fff"); gH.addColorStop(1, bcrHsvToHex(hue, 1, 1)); ctx.fillStyle = gH; ctx.fillRect(0, 0, W, H); const gV = ctx.createLinearGradient(0, 0, 0, H); gV.addColorStop(0, "rgba(0,0,0,0)"); gV.addColorStop(1, "#000"); ctx.fillStyle = gV; ctx.fillRect(0, 0, W, H); };
    React.useEffect(() => { draw(hsvR.current[0]); }, []);
    React.useEffect(() => { if (!bcrIsValidHex(value)) return; const vl = value.toLowerCase(); if (vl !== bcrHsvToHex(...hsvR.current)) { const h = bcrHexToHsv(vl); hsvR.current = h; setHsv([...h]); setHex(vl); draw(h[0]); } }, [value]);
    const emit = (h: number, s: number, v: number) => { hsvR.current = [h, s, v]; setHsv([h, s, v]); const out = bcrHsvToHex(h, s, v); setHex(out); onChange(out); };
    const onSvPtr = (e: React.PointerEvent<HTMLCanvasElement>) => { const rect = cvRef.current!.getBoundingClientRect(); emit(hsvR.current[0], Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height))); };
    const onHuePtr = (e: React.PointerEvent<HTMLDivElement>) => { const rect = (e.currentTarget as HTMLElement).getBoundingClientRect(); const t = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)); const h = t * 360; draw(h); emit(h, hsvR.current[1], hsvR.current[2]); };
    const HUE_GRAD = "linear-gradient(to right,#f00 0%,#ff0 17%,#0f0 33%,#0ff 50%,#00f 67%,#f0f 83%,#f00 100%)";
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ position: "relative", width: W, height: H, borderRadius: 5, overflow: "hidden", cursor: "crosshair", flexShrink: 0 }}>
                <canvas ref={cvRef} width={W} height={H} style={{ display: "block" }}
                    onPointerDown={e => { dragCv.current = true; (e.target as HTMLElement).setPointerCapture(e.pointerId); onSvPtr(e); }}
                    onPointerMove={e => { if (dragCv.current) onSvPtr(e); }}
                    onPointerUp={() => { dragCv.current = false; }} onPointerCancel={() => { dragCv.current = false; }} />
                <div style={{ position: "absolute", top: Math.max(4, Math.min(H - 4, (1 - hsv[2]) * H)) - 4, left: Math.max(4, Math.min(W - 4, hsv[1] * W)) - 4, width: 8, height: 8, borderRadius: "50%", border: "2px solid #fff", pointerEvents: "none", boxSizing: "border-box" }} />
            </div>
            <div style={{ position: "relative", height: 14, borderRadius: 7, background: HUE_GRAD, cursor: "pointer" }}
                onPointerDown={e => { dragHue.current = true; (e.target as HTMLElement).setPointerCapture(e.pointerId); onHuePtr(e); }}
                onPointerMove={e => { if (dragHue.current) onHuePtr(e); }}
                onPointerUp={() => { dragHue.current = false; }} onPointerCancel={() => { dragHue.current = false; }}>
                <div style={{ position: "absolute", top: 1, left: `${(hsv[0] / 360) * 100}%`, width: 12, height: 12, borderRadius: "50%", background: bcrHsvToHex(hsv[0], 1, 1), border: "2px solid #fff", transform: "translateX(-50%)", pointerEvents: "none", boxSizing: "border-box" }} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 22, height: 22, borderRadius: 4, background: bcrIsValidHex(hex) ? hex : "#333", border: "1.5px solid rgba(255,255,255,.18)", flexShrink: 0 }} />
                <input value={hex} onChange={e => { const v = e.target.value; setHex(v); if (bcrIsValidHex(v)) { const h = bcrHexToHsv(v); hsvR.current = h; setHsv([...h]); draw(h[0]); onChange(v); } }} maxLength={7} style={{ flex: 1, background: "rgba(0,0,0,.4)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 5, color: "#f0e6ff", fontSize: 12, padding: "3px 7px", outline: "none", fontFamily: "monospace" }} />
            </div>
        </div>
    );
}
function BcrHueRadiusSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
    const pct = ((value - 1) / 179) * 100;
    const dragRef = React.useRef(false);
    const onPtr = (e: React.PointerEvent<HTMLDivElement>) => { const rect = (e.currentTarget as HTMLElement).getBoundingClientRect(); const t = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)); onChange(Math.round(1 + t * 179)); };
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 10, color: "#9e9e9e" }}>Hue Radius</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#c084fc", fontFamily: "monospace" }}>{value}°</span>
            </div>
            <div style={{ position: "relative", height: 20, cursor: "pointer" }}
                onPointerDown={e => { dragRef.current = true; (e.target as HTMLElement).setPointerCapture(e.pointerId); onPtr(e); }}
                onPointerMove={e => { if (dragRef.current) onPtr(e); }}
                onPointerUp={() => { dragRef.current = false; }} onPointerCancel={() => { dragRef.current = false; }}>
                <div style={{ position: "absolute", top: "50%", left: 0, right: 0, height: 4, borderRadius: 2, background: "rgba(255,255,255,.12)", transform: "translateY(-50%)" }} />
                <div style={{ position: "absolute", top: "50%", left: 0, width: `${pct}%`, height: 4, borderRadius: 2, background: "#c084fc", transform: "translateY(-50%)" }} />
                <div style={{ position: "absolute", top: "50%", left: `${pct}%`, width: 14, height: 14, borderRadius: "50%", background: "#c084fc", border: "2px solid #fff", transform: "translate(-50%,-50%)", boxShadow: "0 0 4px rgba(0,0,0,.5)" }} />
            </div>
        </div>
    );
}

function FavsReorderList({ favs, commitFavs, setPreview, setSubTab }: {
    favs: string[];
    commitFavs: (nf: string[]) => Promise<void>;
    setPreview: (hex: string) => void;
    setSubTab: (t: "color" | "cycle" | "favs") => void;
}) {
    const dragRef = React.useRef<number | null>(null);
    const [overIdx, setOverIdx] = React.useState<number | null>(null);
    const [editIdx, setEditIdx] = React.useState<number | null>(null);
    const [editVal, setEditVal] = React.useState("");

    const saveHexEdit = (i: number) => {
        const v = editVal.trim().toLowerCase();
        if (bcrIsValidHex(v) && v !== favs[i]) {
            const next = [...favs]; next[i] = v; void commitFavs(next);
        }
        setEditIdx(null);
    };

    const onDS = (e: React.DragEvent, i: number) => { dragRef.current = i; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); };
    const onDO = (e: React.DragEvent, i: number) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOverIdx(prev => prev !== i ? i : prev); };
    const onDL = (i: number) => setOverIdx(prev => prev === i ? null : prev);
    const onDP = (e: React.DragEvent, to: number) => {
        e.preventDefault();
        const from = dragRef.current;
        if (from !== null && from !== to) {
            const next = [...favs];
            const [item] = next.splice(from, 1);
            next.splice(to, 0, item);
            void commitFavs(next);
        }
        dragRef.current = null; setOverIdx(null);
    };
    const onDE = () => { dragRef.current = null; setOverIdx(null); };

    return (
        <div style={{ maxHeight: 280, overflowY: "auto", paddingRight: 2 }}>
            {favs.map((hex, i) => {
                const isDragged = dragRef.current === i;
                const isOver = overIdx === i && dragRef.current !== i;
                return (
                    <div key={`${hex}_${i}`} draggable={editIdx !== i}
                        onDragStart={e => editIdx !== i && onDS(e, i)} onDragOver={e => onDO(e, i)}
                        onDragLeave={() => onDL(i)} onDrop={e => onDP(e, i)} onDragEnd={onDE}
                        style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 8px", borderRadius: 7, marginBottom: 3, background: isOver ? "rgba(192,132,252,.09)" : "rgba(255,255,255,.03)", border: `1px solid ${isOver ? "rgba(192,132,252,.5)" : "rgba(255,255,255,.07)"}`, opacity: isDragged ? 0.3 : 1, cursor: editIdx === i ? "default" : "grab", userSelect: "none" }}>
                        <svg width="10" height="10" viewBox="0 0 12 12" fill="rgba(255,255,255,.3)" style={{ flexShrink: 0 }}>
                            <rect y="1" width="12" height="1.8" rx="0.9"/>
                            <rect y="5" width="12" height="1.8" rx="0.9"/>
                            <rect y="9" width="12" height="1.8" rx="0.9"/>
                        </svg>
                        <div style={{ width: 18, height: 18, borderRadius: 4, background: editIdx === i ? (bcrIsValidHex(editVal) ? editVal : "#333") : hex, border: "1.5px solid rgba(255,255,255,.18)", flexShrink: 0, cursor: "pointer" }}
                            onClick={() => { if (editIdx !== i) { setPreview(hex); setSubTab("color"); } }} title="Edit in Color tab" />
                        {editIdx === i
                            ? <input autoFocus className="rs-item-input"
                                value={editVal} maxLength={7}
                                onChange={e => setEditVal(e.target.value)}
                                onKeyDown={(e: React.KeyboardEvent) => { e.stopPropagation(); if (e.key === "Enter") saveHexEdit(i); if (e.key === "Escape") setEditIdx(null); }}
                                onBlur={() => saveHexEdit(i)}
                                style={{ flex: 1, fontFamily: "monospace", fontSize: 11, userSelect: "text" }} />
                            : <span style={{ flex: 1, fontSize: 11, color: "#f0e6ff", fontFamily: "monospace", userSelect: "all", cursor: "text" }}
                                onDoubleClick={e => { e.stopPropagation(); setEditIdx(i); setEditVal(hex); }}>{hex}</span>
                        }
                        <button className="rs-edit-btn" title="Edit hex" onClick={e => { e.stopPropagation(); setEditIdx(i); setEditVal(hex); }}>&#9998;</button>
                        <button onClick={e => { e.stopPropagation(); if (editIdx === i) setEditIdx(null); void commitFavs(favs.filter((_, j) => j !== i)); }}
                            style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,.3)", fontSize: 12, padding: 0, outline: "none", lineHeight: 1, flexShrink: 0 }}>✕</button>
                    </div>
                );
            })}
        </div>
    );
}

function BannerTab({ forceUpdate }: { forceUpdate: () => void }) {
    const [running, setRunning] = React.useState(bcrRotatorTimer !== null);
    const [subTab, setSubTab] = React.useState<"color" | "cycle" | "favs">("color");
    const [mode, setMode] = React.useState<BcrCycleMode>((settings.store.bannerMode as BcrCycleMode) ?? "full_random");
    const [sec, setSec] = React.useState(settings.store.bannerIntervalSeconds ?? BCR_DEFAULT_S);
    const [secStr, setSecStr] = React.useState(String(settings.store.bannerIntervalSeconds ?? BCR_DEFAULT_S));
    const [hueR, setHueR] = React.useState(settings.store.bannerHueRadius ?? 35);
    const [baseColor, setBase] = React.useState(settings.store.bannerCustomBaseColor ?? "#c084fc");
    const [favs, setFavs] = React.useState<string[]>([...bcrFavorites]);
    const [preview, setPreview] = React.useState(bcrCurrentColor ?? "#111214");
    const [applying, setApplying] = React.useState(false);
    const [liveColor, setLive] = React.useState<string | null>(bcrCurrentColor);

    React.useEffect(() => { bcrOnColorApplied = hex => { setLive(hex); forceUpdate(); }; return () => { bcrOnColorApplied = null; }; }, []);

    const PRESET_HEX = ["#111214", "#5865f2", "#3ba55c", "#ed4245", "#faa61a", "#c084fc", "#00b0f4", "#ff6b6b", "#1e3a5f", "#2d1b69", "#701a75", "#065f46"];
    const PRESET_S = [30, 60, 120, 300, 600, 1800, 3600];

    const commitFavs = async (nf: string[]) => { bcrFavorites = nf; setFavs([...nf]); bcrUsedFavs = bcrUsedFavs.filter(c => nf.includes(c)); await bcrSaveData(); };
    const handleModeChange = (m: BcrCycleMode) => { setMode(m); (settings.store as any).bannerMode = m; bcrRandomBatch = []; bcrSeqBatch = []; bcrUsedFavs = []; bcrGradientState = null; bcrMonoBaseHue = null; bcrSeqBaseHue = 0; bcrShadeStep = 0; bcrShadeDir = 1; if (running) { bcrStopRotator(); bcrRotatorTimer = setTimeout(bcrRotateNext, Math.max(1, settings.store.bannerIntervalSeconds ?? BCR_DEFAULT_S) * 1000); setRunning(true); } };
    const handleSecBlur = (raw: string) => { const v = Math.max(5, parseInt(raw) || BCR_DEFAULT_S); setSec(v); setSecStr(String(v)); (settings.store as any).bannerIntervalSeconds = v; if (running) { if (bcrRotatorTimer) clearTimeout(bcrRotatorTimer); bcrRotatorTimer = setTimeout(bcrRotateNext, v * 1000); } };
    const handleHueRChange = (v: number) => { setHueR(v); (settings.store as any).bannerHueRadius = v; bcrRandomBatch = []; };
    const handleBaseChange = (hex: string) => { setBase(hex); (settings.store as any).bannerCustomBaseColor = hex; bcrRandomBatch = []; bcrSeqBatch = []; bcrMonoBaseHue = null; bcrShadeStep = 0; bcrShadeDir = 1; };
    const handleToggle = () => {
        if (running) {
            bcrStopRotator(); (settings.store as any).bannerEnabled = false; setRunning(false);
            if (settings.store.bannerNitroCheck) stopNitroWatcher();
        } else {
            bcrStartRotator(true); (settings.store as any).bannerEnabled = true; setRunning(true);
            if (settings.store.bannerNitroCheck) startNitroWatcher();
        }
        forceUpdate();
    };
    const applyNow = async () => { if (applying || !bcrIsValidHex(preview)) return; setApplying(true); await bcrApplyColor(preview); setApplying(false); };
    const skipNow = async () => { const color = await bcrPickNextColor(); setPreview(color); await bcrApplyColor(color); if (running) { if (bcrRotatorTimer) clearTimeout(bcrRotatorTimer); bcrRotatorTimer = setTimeout(bcrRotateNext, Math.max(1, sec) * 1000); } };

    const prevLower = preview.toLowerCase();
    const curMode = BCR_MODES.find(m => m.id === mode);
    const needsBase = curMode?.needsBase;
    const needsHueR = curMode?.needsHueR;
    const showLive = settings.store.bannerShowCurrentColor && bcrIsValidHex(liveColor ?? "");

    const fmtS = (s: number) => s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;

    return (
        <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 8, marginBottom: 8, background: "rgba(192,132,252,.07)", border: `1px solid ${running ? "rgba(192,132,252,.4)" : "rgba(192,132,252,.18)"}` }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: running ? "#c084fc" : "#3a2a5a", flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: running ? "#f0e6ff" : "#6a5a8a" }}>Color Banner Rotator</span>
                    <div style={{ fontSize: 10, color: "#9e9e9e", marginTop: 1 }}>{running ? `${fmtS(sec)} · ${curMode?.emoji} ${curMode?.label}` : "Stopped"}</div>
                </div>
                <BcrToggle value={running} onChange={handleToggle} />
            </div>

            <div className="bcr-sub-tab-bar">
                {([["color", "🎨 Color"], ["cycle", "⚙ Cycle"], ["favs", "⭐ Favs"]] as const).map(([id, label]) => (
                    <div key={id} className="bcr-sub-tab" onClick={() => setSubTab(id)}
                        style={{ color: subTab === id ? "#c084fc" : "var(--text-muted)", borderBottomColor: subTab === id ? "#c084fc" : "transparent" }}>
                        {label}
                    </div>
                ))}
            </div>

            {subTab === "color" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <BcrHsvPicker value={preview} onChange={setPreview} />
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                        {PRESET_HEX.map(p => <BcrSwatch key={p} color={p} active={prevLower === p} onClick={() => setPreview(p)} />)}
                    </div>
                    <div style={{ display: "flex", gap: 5 }}>
                        <button onClick={applyNow} disabled={applying || !bcrIsValidHex(preview)}
                            style={{ flex: 1, padding: "6px 0", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: applying ? "wait" : "pointer", background: "rgba(192,132,252,.18)", border: "1px solid rgba(192,132,252,.44)", color: "#c084fc", outline: "none", opacity: !bcrIsValidHex(preview) ? 0.4 : 1 }}>
                            {applying ? "Applying…" : "Apply Now"}
                        </button>
                        <button onClick={() => { if (bcrIsValidHex(preview) && !favs.includes(prevLower)) void commitFavs([...favs, prevLower]); }}
                            disabled={!bcrIsValidHex(preview) || favs.includes(prevLower)}
                            style={{ flex: 1, padding: "6px 0", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer", background: "rgba(59,165,92,.13)", border: "1px solid rgba(59,165,92,.38)", color: "#3ba55c", outline: "none", opacity: (!bcrIsValidHex(preview) || favs.includes(prevLower)) ? 0.4 : 1 }}>
                            {favs.includes(prevLower) ? "✓ Saved" : "★ Save to Favs"}
                        </button>
                        <button onClick={() => void skipNow()} style={{ padding: "6px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", background: "rgba(192,132,252,.1)", border: "1px solid rgba(192,132,252,.28)", color: "#c084fc", outline: "none" }}>⏭</button>
                    </div>
                    {needsBase && (
                        <div style={{ padding: "8px 10px", borderRadius: 6, background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.07)" }}>
                            <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Base Color for cycle mode</div>
                            <BcrHsvPicker value={baseColor} onChange={handleBaseChange} />
                        </div>
                    )}
                    <div style={{ padding: "5px 8px", borderRadius: 5, background: "rgba(250,166,26,.09)", border: "1px solid rgba(250,166,26,.22)", fontSize: 10, color: "#faa61a" }}>
                        ⚠ Banner color is free - no Nitro required
                    </div>
                </div>
            )}

            {subTab === "cycle" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    <div className="bcr-mode-grid">
                        {BCR_MODES.map(m => {
                            const active = mode === m.id;
                            return (
                                <div key={m.id} className="bcr-mode-item" onClick={() => handleModeChange(m.id)}
                                    style={{ background: active ? "rgba(192,132,252,.18)" : "rgba(255,255,255,.03)", borderColor: active ? "rgba(192,132,252,.55)" : "rgba(255,255,255,.07)" }}>
                                    <span style={{ fontSize: 11, flexShrink: 0 }}>{m.emoji}</span>
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ fontSize: 10, fontWeight: 700, color: active ? "#f0e6ff" : "var(--text-muted)" }}>{m.label}</div>
                                        <div style={{ fontSize: 9, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.desc}</div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    {needsHueR && (
                        <>
                            <BcrHr />
                            <div style={{ padding: "7px 10px", borderRadius: 6, background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.07)" }}>
                                <BcrHueRadiusSlider value={hueR} onChange={handleHueRChange} />
                            </div>
                        </>
                    )}
                    <BcrHr />
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, color: "var(--text-muted)", textTransform: "uppercase" }}>Interval</div>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {PRESET_S.map(p => { const label = p < 60 ? `${p}s` : p < 3600 ? `${p / 60}m` : `${p / 3600}h`; const active = sec === p; return <button key={p} onClick={() => { setSec(p); setSecStr(String(p)); (settings.store as any).bannerIntervalSeconds = p; if (running) { if (bcrRotatorTimer) clearTimeout(bcrRotatorTimer); bcrRotatorTimer = setTimeout(bcrRotateNext, p * 1000); } }} style={{ padding: "3px 8px", borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: "pointer", outline: "none", border: `1px solid ${active ? "rgba(192,132,252,.55)" : "rgba(255,255,255,.07)"}`, background: active ? "rgba(192,132,252,.18)" : "rgba(255,255,255,.03)", color: active ? "#c084fc" : "var(--text-muted)", userSelect: "none" }}>{label}</button>; })}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <input type="number" min={5} value={secStr} onChange={e => setSecStr(e.target.value)} onBlur={e => handleSecBlur(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSecBlur((e.target as HTMLInputElement).value)} style={{ width: 62, background: "rgba(0,0,0,.4)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 5, color: "#f0e6ff", fontSize: 12, padding: "4px 7px", outline: "none" }} />
                        <span style={{ fontSize: 10, color: "var(--text-muted)" }}>sec = {fmtS(sec)}</span>
                    </div>
                    <BcrHr />
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {([["bannerShowToast", "Toast on each change"], ["bannerShowCurrentColor", "Show active color in footer (ColorBanner:)"]] as [keyof typeof settings.store, string][]).map(([key, label]) => (
                            <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                                <span style={{ fontSize: 11, color: "#f0e6ff" }}>{label}</span>
                                <BcrToggle value={!!(settings.store as any)[key]} onChange={() => { (settings.store as any)[key] = !(settings.store as any)[key]; void bcrSaveData(); forceUpdate(); }} />
                            </div>
                        ))}
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                            <span style={{ fontSize: 11, color: "#f0e6ff" }}>
                                🔍 Nitro Check - pause banner if Nitro detected
                                <span style={{ fontSize: 9, color: arHasNitro() ? "#ef9a9a" : "#23a55a", marginLeft: 5 }}>
                                    {settings.store.bannerNitroCheck
                                        ? (arHasNitro() ? "Nitro detected - banner paused ⚠" : "No Nitro - banner running ✓")
                                        : "disabled - banner runs regardless"}
                                </span>
                            </span>
                            <BcrToggle value={!!settings.store.bannerNitroCheck} onChange={() => {
                                const n = !settings.store.bannerNitroCheck;
                                (settings.store as any).bannerNitroCheck = n;
                                if (n) { startNitroWatcher(); }
                                else { stopNitroWatcher(); }
                                forceUpdate();
                            }} />
                        </div>
                    </div>
                    <BcrHr />
                    <OnCloseBannerPanel forceUpdate={forceUpdate} />
                </div>
            )}

            {subTab === "favs" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    {favs.length === 0
                        ? <div style={{ textAlign: "center", padding: "20px 0", color: "var(--text-muted)", fontSize: 11 }}><div style={{ fontSize: 20, marginBottom: 4 }}>🎨</div>No favorites yet - pick a color and save it</div>
                        : <>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span style={{ fontSize: 10, color: "var(--text-muted)" }}>Drag to reorder · click swatch to edit</span>
                                <button onClick={() => void commitFavs([])} style={{ fontSize: 10, color: "#ed4245", background: "none", border: "none", cursor: "pointer", outline: "none" }}>Clear all</button>
                            </div>
                            <FavsReorderList favs={favs} commitFavs={commitFavs} setPreview={setPreview} setSubTab={setSubTab} />
                        </>
                    }
                </div>
            )}
        </div>
    );
}

function RotatorSuiteModal({ modalProps }: { modalProps: RenderModalProps }) {
    const forceUpdate = useForceUpdater();
    const [tab, setTab] = React.useState<TabId>("status");
    const [notActive] = React.useState(!pluginActive);

    React.useEffect(() => {
        const id = setInterval(forceUpdate, 1000);
        return () => clearInterval(id);
    }, []);

    const tabs: { id: TabId; label: string; color: string }[] = [
        { id: "status", label: "Status", color: C.status },
        { id: "clan", label: "Clan", color: C.clan },
        { id: "profile", label: "Profile", color: C.bio },
        { id: "avatar", label: "Avatar", color: "#9c67ff" },
        { id: "colorbanner", label: "ColorBanner", color: "#c084fc" },
        { id: "servers", label: "Server Profiles", color: C.nick },
        { id: "data", label: "Data", color: C.data },
    ];

    const isGlobalSync = settings.store.globalSync;
    const totalActive = nickTimers.size + guildPronounsTimers.size + (statusTimer ? 1 : 0) + (clanTimer ? 1 : 0) + (bioTimer ? 1 : 0) + (pronounsTimer ? 1 : 0) + (globalNickTimer ? 1 : 0) + (globalSyncTimer ? 1 : 0) + (arRotatorTimer ? 1 : 0) + (bcrRotatorTimer ? 1 : 0);

    return (
        <ModalRoot {...modalProps} className="rs-modal">
            <ModalHeader>
                <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
                    <div className="rs-dot" style={{ width: 8, height: 8, background: totalActive > 0 ? "#9c67ff" : "#2a1a4a" }} />
                    <Forms.FormTitle tag="h2" style={{ margin: 0, flex: 1, background: "linear-gradient(90deg,#9c67ff,#b24df7,#7c4dff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
                        Rotator Suite
                    </Forms.FormTitle>
                    {isGlobalSync && (
                        <div style={{ fontSize: 10, padding: "2px 9px", borderRadius: 10, background: "rgba(255,167,38,.15)", color: C.data, fontWeight: 800, border: "1px solid rgba(255,167,38,.35)" }}>
                            SYNC · {settings.store.globalSyncSeconds}s
                        </div>
                    )}
                    <span className="rs-count-badge">{totalActive} timer{totalActive !== 1 ? "s" : ""}</span>
                </div>
            </ModalHeader>

            <ModalContent style={{ padding: "11px 15px", overflowY: "auto", maxHeight: "65vh" }}>
                {notActive && (
                    <div style={{ background: "rgba(239,83,80,.1)", border: "1px solid rgba(239,83,80,.4)", borderRadius: 8, padding: "8px 13px", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 18 }}>⚠️</span>
                        <div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: "#ef9a9a" }}>Plugin is disabled</div>
                            <div style={{ fontSize: 11, color: "#9e9e9e", marginTop: 2 }}>
                                Rotator Suite is not currently running. Enable it in <b style={{ color: "#f0eaff" }}>Settings → Plugins → Rotator Suite</b>. The panel may display stale or empty data until the plugin is active.
                            </div>
                        </div>
                    </div>
                )}
                <div className="rs-tab-bar">
                    {tabs.map(t => (
                        <button key={t.id} className="rs-tab"
                            style={tab === t.id ? { color: t.color, borderBottomColor: t.color } : {}}
                            onClick={() => setTab(t.id)}>{t.label}</button>
                    ))}
                </div>
                {tab === "status" && <StatusTab forceUpdate={forceUpdate} />}
                {tab === "clan" && <ClanTab forceUpdate={forceUpdate} />}
                {tab === "profile" && <ProfileTab forceUpdate={forceUpdate} />}
                {tab === "avatar" && <AvatarTab forceUpdate={forceUpdate} />}
                {tab === "colorbanner" && <BannerTab forceUpdate={forceUpdate} />}
                {tab === "servers" && <NicksTab forceUpdate={forceUpdate} />}
                {tab === "data" && <DataTab forceUpdate={forceUpdate} />}
            </ModalContent>

            <ModalFooter>
                <div style={{ display: "flex", gap: 8, width: "100%", alignItems: "center", flexWrap: "wrap" as const }}>
                    {(isManualStop || wasInvisible) && (
                        <div style={{ width: "100%", padding: "5px 10px", borderRadius: 7, background: "rgba(239,83,80,.1)", border: "1px solid rgba(239,83,80,.3)", fontSize: 11, color: "#ef9a9a", fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                            {wasInvisible && !isManualStop ? "⛔ PAUSED - Invisible status" : isManualStop && globalStopEndTime ? "⏸ STOPPED - Go to Data tab to resume" : "⏸ MANUALLY STOPPED - Go to Data tab to resume"}
                        </div>
                    )}
                    {settings.store.stopOnInvisible && !wasInvisible && !isManualStop && (
                        <div style={{ width: "100%", padding: "4px 10px", borderRadius: 7, background: "rgba(124,77,255,.07)", border: "1px solid rgba(124,77,255,.18)", fontSize: 10, color: "#9575cd" }}>
                            👁 Stop-on-Invisible is active - rotators pause automatically when you go invisible.
                        </div>
                    )}
                    <div className="rs-footer-info">
                        {isGlobalSync
                            ? <>
                                <span>Sync: <b style={{ color: C.data }}>{settings.store.globalSyncSeconds}s</b></span>
                                <span>Clan: <b style={{ color: settings.store.clanEnabled ? C.clan : `${C.clan}80` }}>{settings.store.clanEnabled ? settings.store.clanIntervalSeconds + "s" : "off"}</b></span>
                              </>
                            : <>
                                <span>Status: <b style={{ color: settings.store.statusEnabled ? C.status : `${C.status}80` }}>{settings.store.statusEnabled ? settings.store.statusIntervalSeconds + "s" : "off"}</b></span>
                                <span>Clan: <b style={{ color: settings.store.clanEnabled ? C.clan : `${C.clan}80` }}>{settings.store.clanEnabled ? settings.store.clanIntervalSeconds + "s" : "off"}</b></span>
                                <span>DisplayName: <b style={{ color: settings.store.globalNickEnabled ? C.nick : `${C.nick}80` }}>{settings.store.globalNickEnabled ? settings.store.globalNickIntervalSeconds + "s" : "off"}</b></span>
                                <span>DisplayPronoun: <b style={{ color: settings.store.profilePronounsEnabled ? C.pronoun : `${C.pronoun}80` }}>{settings.store.profilePronounsEnabled ? settings.store.pronounsIntervalSeconds + "s" : "off"}</b></span>
                                <span>Bio: <b style={{ color: settings.store.profileBioEnabled ? C.bio : `${C.bio}80` }}>{settings.store.profileBioEnabled ? settings.store.bioIntervalSeconds + "s" : "off"}</b></span>
                                <span>Avatar: <b style={{ color: settings.store.avatarEnabled ? "#9c67ff" : "#9c67ff80" }}>{settings.store.avatarEnabled ? settings.store.avatarIntervalSeconds + "s" : "off"}</b></span>
                                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                    ColorBanner: <b style={{ color: settings.store.bannerEnabled ? "#c084fc" : "#c084fc80" }}>{settings.store.bannerEnabled ? settings.store.bannerIntervalSeconds + "s" : "off"}</b>
                                    {settings.store.bannerShowCurrentColor && bcrCurrentColor && bcrIsValidHex(bcrCurrentColor) && (
                                        <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                                            <span style={{ width: 10, height: 10, borderRadius: 2, background: bcrCurrentColor, border: "1px solid rgba(255,255,255,.2)", display: "inline-block", flexShrink: 0 }} />
                                            <span style={{ fontFamily: "monospace", fontSize: 9, color: "#c084fc" }}>{bcrCurrentColor}</span>
                                        </span>
                                    )}
                                </span>
                                <span>Nicks: <b style={{ color: settings.store.nickEnabled ? C.nick : `${C.nick}80` }}>{settings.store.nickEnabled ? settings.store.nickIntervalSeconds + "s" : "off"}</b></span>
                                <span>Pronouns: <b style={{ color: settings.store.serverPronounsEnabled ? C.pronoun : `${C.pronoun}80` }}>{settings.store.serverPronounsEnabled ? settings.store.serverPronounsIntervalSeconds + "s" : "off"}</b></span>
                            </>
                        }
                    </div>
                    <Button color={Button.Colors.TRANSPARENT} onClick={modalProps.onClose}>Close</Button>
                </div>
            </ModalFooter>
        </ModalRoot>
    );
}

function RSUserAreaButton({ iconForeground, hideTooltips, nameplate }: UserAreaRenderProps) {
    const [active, setActive] = React.useState(false);
    React.useEffect(() => {
        const id = setInterval(() => {
            const timers = nickTimers.size + guildPronounsTimers.size + (statusTimer ? 1 : 0) + (clanTimer ? 1 : 0) + (bioTimer ? 1 : 0) + (pronounsTimer ? 1 : 0) + (globalNickTimer ? 1 : 0) + (globalSyncTimer ? 1 : 0) + (arRotatorTimer ? 1 : 0) + (bcrRotatorTimer ? 1 : 0);
            setActive(timers > 0);
        }, 800);
        return () => clearInterval(id);
    }, []);

    if (!settings.store.showButton) return null;

    const lineLength = 30;
    const lineStyle: React.CSSProperties = {
        strokeDasharray: lineLength,
        strokeDashoffset: active ? lineLength : 0,
        transition: "stroke-dashoffset 0.1s ease-in-out",
    };

    return (
        <UserAreaButton
            tooltipText={hideTooltips ? void 0 : active ? "Rotator Suite - [Running]" : "Rotator Suite"}
            redGlow={!active}
            plated={nameplate != null}
            icon={
                <svg className={iconForeground} width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <mask id="rotatorSuiteLine">
                        <rect width="100%" height="100%" fill="#ffffff" />
                        <line
                            className="blackLine"
                            x1="22"
                            y1="2"
                            x2="2"
                            y2="22"
                            stroke="#000000"
                            strokeWidth="6"
                            strokeLinecap="round"
                            style={lineStyle}
                        />
                    </mask>

                    <path mask="url(#rotatorSuiteLine)" fill={!active ? "var(--status-danger)" : "currentColor"} d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>

                    <line
                        x1="22"
                        y1="2"
                        x2="2"
                        y2="22"
                        stroke="var(--status-danger, currentColor)"
                        strokeWidth="2"
                        strokeLinecap="round"
                        style={lineStyle}
                    />

                    {active &&
                        <circle cx="18" cy="6" r="4" fill="#9c67ff" stroke="none" />
                    }
                </svg>
            }
            onClick={() => openModal(props => <RotatorSuiteModal modalProps={props} />)}
        />
    );
}

export default definePlugin({
    name: "Rotator Suite",
    description: "All-in-one Discord identity rotator. Cycles status, clan, bio, global pronouns, display name, server nicknames, per-server pronouns, avatar, and banner color (26 modes, HSV picker, favorites). Master Sync, DataStore-persisted, drag-to-reorder, JSON import/export.",
    authors: [{ name: "zfrancesck1", id: 456195985404592149n }],
    tags: ["Appearance", "Customisation"],
    enabledByDefault: false,
    settings,
    dependencies: ["UserAreaAPI"],

    toolboxActions: {
        "Open Rotator Suite"() {
            openModal(props => <RotatorSuiteModal modalProps={props} />);
        },
    },

    settingsAboutComponent: () => (
        <div style={{ marginTop: 10 }}>
            <Button color={Button.Colors.BRAND} onClick={() => openModal(props => <RotatorSuiteModal modalProps={props} />)}>
                Open Rotator Suite Panel
            </Button>
            <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 8, background: "rgba(239,83,80,.08)", border: "1px solid rgba(239,83,80,.25)" }}>
                <span style={{ fontSize: 12, color: "#ef9a9a", fontWeight: 700 }}>⚠️ Note: </span>
                <span style={{ fontSize: 12, color: "#9e9e9e" }}>The panel may show stale or empty data if the plugin was just enabled. Reload Discord or toggle the plugin off/on if something looks wrong.</span>
            </div>
        </div>
    ),

    async start() {
        injectCSS();
        if (!(window as any)._rsCloseReg) {
            window.addEventListener("beforeunload", rsBeforeUnloadHandler);
            (window as any)._rsCloseReg = true;
        }
        cachedToken = null; cachedGuildStore = null; cachedClanGuilds = []; lastClanFetch = 0;
        statusLastVal = null; clanLastVal = null; bioLastVal = null; prLastVal = null;
        pluginActive = true;

        const defaults: StoreData = {
            createdAt: new Date().toISOString(), globalNicks: [], guilds: [], bioEntries: [],
            pronounsList: "", statusEntries: [], statusPresets: [],
            clanIds: [], statusSeqIdx: 0, clanSeqIdx: 0, bioSeqIdx: 0, prSeqIdx: 0,
            globalNickEntries: [], globalNickSeqIdx: 0,
            globalGuildPronouns: [],
        };

        const stored: StoreData = (await DataStore.get(SK)) ?? defaults;
        storeCreatedAt = stored.createdAt ?? defaults.createdAt;
        globalNicks = stored.globalNicks ?? [];
        guilds = (stored.guilds ?? []).map((g: any) => ({
            ...g,
            nickMode: g.nickMode ?? (g.useGlobal ? "global" : "custom") as NickMode,
            lastNickVal: null,
            guildPronouns: g.guildPronouns ?? [],
            guildPronounsEnabled: g.guildPronounsEnabled ?? false,
            guildPronounsSeqIdx: g.guildPronounsSeqIdx ?? 0,
            guildPronounsLastVal: g.guildPronounsLastVal ?? null,
            guildPronounsMode: g.guildPronounsMode ?? "custom" as NickMode,
            voiceActivated: g.voiceActivated ?? false,
            nickVoiceEnabled: g.nickVoiceEnabled ?? g.enabled,
            pronounsVoiceEnabled: g.pronounsVoiceEnabled ?? g.guildPronounsEnabled,
        }));
        bioEntries = stored.bioEntries ?? [];
        pronounsList = stored.pronounsList ?? "";
        if (Array.isArray((stored as any).statusEntries)) {
            statusEntries = (stored as any).statusEntries;
        } else if (typeof (stored as any).statuses === "string") {
            statusEntries = parseLegacyStatuses((stored as any).statuses);
        }
        statusPresets = Array.isArray((stored as any).statusPresets) ? (stored as any).statusPresets : [];
        clanIds = stored.clanIds ?? [];
        clanServerNames = (stored as any).clanServerNames ?? {};
        statusSeqIdx = stored.statusSeqIdx ?? 0;
        clanSeqIdx = stored.clanSeqIdx ?? 0;
        bioSeqIdx = stored.bioSeqIdx ?? 0;
        prSeqIdx = stored.prSeqIdx ?? 0;
        statusLastVal = (stored as any).statusLastVal ?? null;
        clanLastVal = (stored as any).clanLastVal ?? null;
        bioLastVal = (stored as any).bioLastVal ?? null;
        prLastVal = (stored as any).prLastVal ?? null;
        globalNickEntries = (stored as any).globalNickEntries ?? [];
        globalNickSeqIdx = (stored as any).globalNickSeqIdx ?? 0;
        globalNickLastVal = (stored as any).globalNickLastVal ?? null;
        globalGuildPronouns = (stored as any).globalGuildPronouns ?? [];

        syncGuildsFromDiscord();
        await saveData();

        const arStored: ArStoreData = (await DataStore.get(AR_SK)) ?? { avatars: [], seqIndex: 0, shuffleQueue: [] };
        arAvatars = arStored.avatars ?? [];
        arSeqIndex = arStored.seqIndex ?? 0;
        arShuffleQueue = arStored.shuffleQueue ?? [];
        if (settings.store.avatarEnabled && arGetActive().length) arStartRotator(false);

        const bcrStored: BcrStoreData = (await DataStore.get(BCR_SK)) ?? { favorites: [], usedFavs: [], wasRunning: false, currentColor: null };
        bcrFavorites = bcrStored.favorites ?? [];
        bcrUsedFavs = bcrStored.usedFavs ?? [];
        bcrCurrentColor = bcrStored.currentColor ?? null;
        if (bcrStored.wasRunning || settings.store.bannerEnabled) bcrStartRotator(false);

        const closeStored = (await DataStore.get(RS_CLOSE_SK)) ?? {};
        closeStatusEnabled = closeStored.closeStatusEnabled ?? false;
        closeStatusText = closeStored.closeStatusText ?? "";
        closeStatusEmoji = closeStored.closeStatusEmoji ?? "";
        closeStatusType = closeStored.closeStatusType ?? "auto";
        closeClanEnabled = closeStored.closeClanEnabled ?? false;
        closeClanId = closeStored.closeClanId ?? "";
        closeBannerEnabled = closeStored.closeBannerEnabled ?? false;
        closeBannerColor = closeStored.closeBannerColor ?? "#111214";
        try { localStorage.setItem(RS_CLOSE_LS, JSON.stringify({ closeStatusEnabled, closeStatusText, closeStatusEmoji, closeStatusType, closeClanEnabled, closeClanId, closeBannerEnabled, closeBannerColor })); } catch {}

        Vencord.Api.UserArea.addUserAreaButton("rotator-suite", RSUserAreaButton);

        if (settings.store.autoStart) {
            startAllRotators();
        }

        if (settings.store.stopOnInvisible) startInvisibleWatcher();
        if (settings.store.bannerNitroCheck) startNitroWatcher();
        if (settings.store.avatarEnabled && settings.store.avatarNitroCheck) startAvatarNitroWatcher();
    },

    stop() {
        pluginActive = false;
        lastGlobalNickApply = 0;
        cachedToken = null; cachedGuildStore = null; cachedVoiceStateStore = null; cachedChannelStore = null;
        isManualStop = false; wasInvisible = false;
        domTagCache.clear();
        if (globalStopTimer) { clearTimeout(globalStopTimer); globalStopTimer = null; }
        globalStopEndTime = null; cachedPresenceStore = null;
        stopInvisibleWatcher();
        stopNitroWatcher();
        stopAvatarNitroWatcher();
        stopAllRotators();
        clearSleepTimers();
        arAvatars = []; arSeqIndex = 0; arShuffleQueue = [];
        bcrFavorites = []; bcrUsedFavs = []; bcrRandomBatch = []; bcrSeqBatch = [];
        bcrCachedHue = null; bcrGradientState = null; bcrMonoBaseHue = null;
        bcrCurrentColor = null; bcrOnColorApplied = null;
        Vencord.Api.UserArea.removeUserAreaButton("rotator-suite");
        document.getElementById("rs-css")?.remove();
        window.removeEventListener("beforeunload", rsBeforeUnloadHandler);
        (window as any)._rsCloseReg = false;
    },
});
