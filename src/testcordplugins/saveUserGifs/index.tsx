/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addContextMenuPatch, NavContextMenuPatchCallback, removeContextMenuPatch } from "@api/ContextMenu";
import { DataStore } from "@api/index";
import { definePluginSettings } from "@api/Settings";
import { Link } from "@components/Link";
import { TestcordDevs } from "@utils/constants";
import { sleep } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import { findByCodeLazy,findByPropsLazy } from "@webpack";
import { Menu, SelectedChannelStore,showToast, Toasts } from "@webpack/common";

const TokenStore = findByPropsLazy("getToken");
const addFavoriteGif = findByCodeLazy("favoriteGifs", "order", "updateAsync");
const favoriteGifsStore = findByPropsLazy("bW", "getCurrentValue");

// ─── Types ───────────────────────────────────────────────────────────────────

interface GifEntry {
    url: string;
    src: string;
    width: number;
    height: number;
    format: number;
    order: number;
}

// ─── Settings ────────────────────────────────────────────────────────────────

const settings = definePluginSettings({
    scanMode: {
        type: OptionType.SELECT,
        description: "Where to scan for GIFs",
        options: [
            { label: "Current channel only", value: "channel", default: true },
            { label: "Entire server", value: "server" },
        ],
    },
    saveMode: {
        type: OptionType.SELECT,
        description: "What to do with found GIFs",
        options: [
            { label: "Export to JSON file", value: "export", default: true },
            { label: "Add to favorites", value: "favorites" },
            { label: "Both (export + add to favorites)", value: "both" },
        ],
    },
    maxMessages: {
        type: OptionType.NUMBER,
        description: "Max messages to scan (99999 = all)",
        default: 99999,
    },
    useHeartGifs: {
        type: OptionType.BOOLEAN,
        description: "Save to HeartGifs (unlimited local storage) instead of Discord favorites. Requires HeartGifs plugin.",
        default: false,
    },
});

// ─── State ───────────────────────────────────────────────────────────────────

let isScanning = false;
let currentGifsFound = 0;
let stopRequested = false;

// ─── HeartGifs Integration ───────────────────────────────────────────────────

const HG_DATA_KEY = "heartGifs-data";

async function addToHeartGifs(gif: GifEntry): Promise<boolean> {
    try {
        const items: any[] = (await DataStore.get(HG_DATA_KEY)) ?? [];
        if (items.some((g: any) => g.url === gif.url)) return false;
        const newItem = {
            id: "nogl-" + Date.now() + "-" + Math.random().toString(36).substr(2, 9),
            url: gif.url,
            src: gif.src || gif.url,
            width: gif.width || 498,
            height: gif.height || 280,
            type: "gif",
            addedAt: Date.now(),
        };
        items.unshift(newItem);
        await DataStore.set(HG_DATA_KEY, items);
        return true;
    } catch {
        return false;
    }
}

async function addToHeartGifsBatch(gifs: GifEntry[]): Promise<number> {
    if (gifs.length === 0) return 0;
    try {
        const items: any[] = (await DataStore.get(HG_DATA_KEY)) ?? [];
        const existingUrls = new Set(items.map((g: any) => g.url));
        let added = 0;
        for (const gif of gifs) {
            if (existingUrls.has(gif.url)) continue;
            existingUrls.add(gif.url);
            items.unshift({
                id: "nogl-" + Date.now() + "-" + Math.random().toString(36).substr(2, 9),
                url: gif.url,
                src: gif.src || gif.url,
                width: gif.width || 498,
                height: gif.height || 280,
                type: "gif",
                addedAt: Date.now(),
            });
            added++;
        }
        if (added > 0) await DataStore.set(HG_DATA_KEY, items);
        return added;
    } catch {
        return 0;
    }
}

async function isInHeartGifs(url: string): Promise<boolean> {
    try {
        const items: any[] = (await DataStore.get(HG_DATA_KEY)) ?? [];
        return items.some((g: any) => g.url === url);
    } catch {
        return false;
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getToken(): string | null {
    try {
        return TokenStore?.getToken() ?? null;
    } catch {
        return null;
    }
}

async function discordFetch(url: string): Promise<any> {
    const token = getToken();
    if (!token) return null;
    const res = await fetch("https://discord.com/api/v9" + url, {
        headers: { "Authorization": token }
    });
    if (res.status === 429) throw { status: 429 };
    if (!res.ok) return null;
    return res.json();
}

function getAddGifFn(): ((gif: any) => void) | null {
    return typeof addFavoriteGif === "function" ? addFavoriteGif : null;
}

function getCurrentFavoriteUrls(): Set<string> {
    try {
        const store = favoriteGifsStore?.bW;
        if (store && typeof store.getCurrentValue === "function") {
            const gifs = store.getCurrentValue()?.favoriteGifs?.gifs ?? {};
            return new Set(Object.keys(gifs));
        }
    } catch { }
    return new Set();
}

function getCurrentChannelId(): string | null {
    try {
        return SelectedChannelStore?.getChannelId?.() ?? null;
    } catch { }
    return null;
}

// ─── GIF Extraction ──────────────────────────────────────────────────────────

function extractGifsFromMessage(msg: any): GifEntry[] {
    const gifs: GifEntry[] = [];

    for (const att of msg.attachments ?? []) {
        const url: string = att.url ?? "";
        if (url.match(/\.gif/i) || att.content_type?.includes("gif")) {
            gifs.push({ url: att.url, src: att.proxy_url ?? att.url, width: att.width ?? 498, height: att.height ?? 280, format: 1, order: 0 });
        }
    }

    for (const embed of msg.embeds ?? []) {
        const embedUrl: string = embed.url ?? "";
        const videoUrl: string = embed.video?.url ?? "";
        const thumbUrl: string = embed.thumbnail?.url ?? embed.image?.url ?? "";
        if (embed.type === "gifv" || embedUrl.includes("tenor.com") || embedUrl.includes("giphy.com") || videoUrl.includes("tenor.com") || embedUrl.match(/\.gif/i)) {
            const finalUrl = embedUrl || videoUrl || thumbUrl;
            if (finalUrl) gifs.push({ url: finalUrl, src: videoUrl || thumbUrl || finalUrl, width: embed.video?.width ?? embed.thumbnail?.width ?? 498, height: embed.video?.height ?? embed.thumbnail?.height ?? 280, format: 2, order: 0 });
        }
    }

    const content: string = msg.content ?? "";
    for (const url of (content.match(/https?:\/\/[^\s<>"]+/g) ?? [])) {
        if (url.match(/\.gif(\?|$)/i) || url.includes("tenor.com/view/") || url.includes("giphy.com/gifs/") || url.includes("giphy.com/media/") || url.includes("klipy.com/gifs/") || url.includes("klipy.com/g/") || url.includes("media.tenor.com")) {
            gifs.push({ url, src: url, width: 498, height: 280, format: url.endsWith(".gif") ? 1 : 2, order: 0 });
        }
    }

    return gifs;
}

// ─── Search ───────────────────────────────────────────────────────────────────

async function searchMessages(
    guildId: string,
    userId: string,
    filter: { type: "content" | "has"; value: string; },
    maxResults: number,
    channelId: string | null,
    seen: Set<string>,
    label: string,
    onGifFound?: (g: GifEntry) => void
): Promise<GifEntry[]> {
    const gifs: GifEntry[] = [];
    let offset = 0;
    const pageSize = 25;
    let total = 0;

    do {
        if (stopRequested) break;

        let url = "/guilds/" + guildId + "/messages/search?author_id=" + userId + "&offset=" + offset + "&limit=" + pageSize;
        if (filter.type === "content") url += "&content=" + encodeURIComponent(filter.value);
        else url += "&has=" + filter.value;
        if (channelId) url += "&channel_id=" + channelId;

        try {
            const body = await discordFetch(url);
            if (!body) break;
            const messages: any[] = (body.messages ?? []).flat();
            total = body.total_results ?? 0;
            if (messages.length === 0) break;

            for (const msg of messages) {
                for (const g of extractGifsFromMessage(msg)) {
                    if (!seen.has(g.url)) {
                        seen.add(g.url);
                        gifs.push(g);
                        currentGifsFound++;
                        if (onGifFound) onGifFound(g);
                    }
                }
            }

            console.log("[SaveUserGifs] [" + label + "] " + (offset + messages.length) + "/" + total + " | GIFs: " + currentGifsFound);
            offset += pageSize;
            if (messages.length < pageSize) break;
            if (stopRequested) break;
            await sleep(800);
        } catch (e: any) {
            if (e?.status === 429) {
                console.warn("[SaveUserGifs] Rate limited, waiting 5s...");
                await sleep(5000);
                continue;
            }
            console.warn("[SaveUserGifs] Error:", e);
            break;
        }
    } while (offset < total && offset < maxResults);

    return gifs;
}

// ─── Main Scan ────────────────────────────────────────────────────────────────

async function scanUserGifs(userId: string, username: string, guildId: string | null): Promise<void> {
    if (isScanning) {
        showToast("Already scanning! Use the stop button.", Toasts.Type.FAILURE);
        return;
    }
    if (!guildId) {
        showToast("This plugin only works in servers, not DMs.", Toasts.Type.FAILURE);
        return;
    }

    const saveMode = settings.store.saveMode ?? "favorites";
    const maxMessages = settings.store.maxMessages ?? 99999;
    const mode = settings.store.scanMode ?? "channel";

    isScanning = true;
    stopRequested = false;
    currentGifsFound = 0;
    const savePromises: Promise<void>[] = [];

    const channelFilter = mode === "channel" ? (getCurrentChannelId() ?? null) : null;

    showToast(`Scanning GIFs from ${username}...`, Toasts.Type.MESSAGE);
    console.log(`[SaveUserGifs] Starting scan for ${username} (${userId})`);

    const useHeartGifs = settings.store.useHeartGifs ?? false;
    const addGif = !useHeartGifs ? getAddGifFn() : null;
    const favUrls = !useHeartGifs ? getCurrentFavoriteUrls() : new Set<string>();
    const savedRealtime = new Set<string>();

    const heartGifsPending: GifEntry[] = [];

    const onGifFound = (saveMode === "favorites" || saveMode === "both")
        ? (useHeartGifs
            ? (g: GifEntry) => {
                if (!savedRealtime.has(g.url)) {
                    savedRealtime.add(g.url);
                    heartGifsPending.push(g);
                }
            }
            : (addGif
                ? (g: GifEntry) => {
                    if (!favUrls.has(g.url) && !savedRealtime.has(g.url)) {
                        savedRealtime.add(g.url);
                        try { addGif({ url: g.url, src: g.src ?? g.url, width: Number(g.width) || 498, height: Number(g.height) || 280, format: Number(g.format) || 2 }); } catch { }
                    }
                }
                : undefined))
        : undefined;

    const seen = new Set<string>();
    const allGifs: GifEntry[] = [];
    const searches = [
        { type: "content" as const, value: "tenor.com", label: "tenor" },
        { type: "content" as const, value: "giphy.com", label: "giphy" },
        { type: "content" as const, value: "klipy.com", label: "klipy" },
        { type: "has" as const, value: "file", label: "files" },
    ];

    for (const s of searches) {
        if (stopRequested) break;
        const found = await searchMessages(guildId, userId, { type: s.type, value: s.value }, maxMessages, channelFilter, seen, s.label, onGifFound);
        allGifs.push(...found);
    }

    // Batch-write HeartGifs after scan (single read+write instead of per-GIF)
    if (heartGifsPending.length > 0) {
        showToast("Saving HeartGifs...", Toasts.Type.MESSAGE);
        await addToHeartGifsBatch(heartGifsPending);
    }

    isScanning = false;
    stopRequested = false;

    if (allGifs.length === 0) {
        showToast(`No GIFs found from ${username}.`, Toasts.Type.FAILURE);
        return;
    }

    if (saveMode === "export" || saveMode === "both") {
        const blob = new Blob([JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), collectedFrom: { userId, username }, totalGifs: allGifs.length, gifs: allGifs }, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `gifs-from-${username}-${Date.now()}.json`;
        a.click();
    }

    showToast(`✅ Found ${allGifs.length} GIFs from ${username}`, Toasts.Type.SUCCESS);
    await sleep(1500);

    if (useHeartGifs && (saveMode === "favorites" || saveMode === "both")) {
        // HeartGifs: verify against DataStore after a short wait
        await sleep(800);
        let hgSaved = 0;
        let hgAlreadyHad = 0;
        for (const g of allGifs) {
            if (await isInHeartGifs(g.url)) {
                if (savedRealtime.has(g.url)) hgSaved++;
                else hgAlreadyHad++;
            }
        }
        console.log(`[SaveUserGifs] Done! Found: ${allGifs.length} | Saved to HeartGifs: ${hgSaved} | Already had: ${hgAlreadyHad}`);
        showToast(`💾 HeartGifs: Saved ${hgSaved} | Already had: ${hgAlreadyHad}`, Toasts.Type.SUCCESS);
    } else {
        const alreadyHad = allGifs.filter(g => favUrls.has(g.url)).length;

        // Wait a moment for the Discord store to update, then verify what actually got saved
        await sleep(1000);
        const favUrlsAfter = getCurrentFavoriteUrls();
        const reallySaved = allGifs.filter(g => !favUrls.has(g.url) && favUrlsAfter.has(g.url));
        const failedToSave = allGifs.filter(g => !favUrls.has(g.url) && !favUrlsAfter.has(g.url) && savedRealtime.has(g.url));

        console.log(`[SaveUserGifs] Done! Found: ${allGifs.length} | Actually saved: ${reallySaved.length} | Already had: ${alreadyHad} | Failed: ${failedToSave.length}`);
        if (failedToSave.length > 0) {
            console.warn("[SaveUserGifs] These GIFs failed to save:", failedToSave.map(g => g.url));
        }

        if (failedToSave.length > 0) {
            showToast(`⚠️ Saved: ${reallySaved.length} | Failed: ${failedToSave.length} | Already had: ${alreadyHad}`, Toasts.Type.FAILURE);
        } else {
            showToast(`✅ Saved: ${reallySaved.length} | Already had: ${alreadyHad}`, Toasts.Type.SUCCESS);
        }
    }
}

// ─── Context Menu ─────────────────────────────────────────────────────────────

const userContextMenuPatch: NavContextMenuPatchCallback = (children, { user, guildId }) => {
    if (!user) return;
    children.push(
        <Menu.MenuSeparator key="save-user-gifs-separator" />,
        <Menu.MenuItem
            key="save-user-gifs"
            id="save-user-gifs"
            label="Save GIFs from user"
            disabled={isScanning}
            action={() => scanUserGifs(user.id, user.username ?? user.globalName ?? user.id, guildId ?? null)}
        />,
        ...(isScanning ? [
            <Menu.MenuItem
                key="save-user-gifs-stop"
                id="save-user-gifs-stop"
                label="⏹ Stop saving GIFs"
                action={() => {
                    stopRequested = true;
                    showToast("Stopping...", Toasts.Type.MESSAGE);
                }}
            />,
            <Menu.MenuItem
                key="save-user-gifs-status"
                id="save-user-gifs-status"
                label={`📊 ${currentGifsFound} GIFs found so far`}
                action={() => showToast(`${currentGifsFound} GIFs found so far`, Toasts.Type.MESSAGE)}
            />
        ] : [])
    );
};

// ─── Plugin ───────────────────────────────────────────────────────────────────

export default definePlugin({
    name: "SaveUserGifs",
    description: "Right-click a user to save all GIFs they have sent to your favorites. Due to Discord's search API being non-deterministic, some GIFs may be missed on the first scan — simply run it again to pick up any remaining ones.",
    tags: ["Media", "Utility"],
    authors: [TestcordDevs.nnenaza],
    dependencies: ["ContextMenuAPI"],
    settings,

    settingsAboutComponent() {
        return (
            <div style={{ fontSize: "14px", lineHeight: "1.8" }}>
                <p style={{ marginBottom: "12px", color: "var(--header-secondary, #b9bbbe)" }}>
                    Right-click any user → <b style={{ color: "var(--header-primary, #fff)" }}>Save GIFs from user</b> to collect all GIFs they have sent. GIFs are saved to favorites in real-time as they are found.
                </p>
                <p style={{ marginBottom: "4px", color: "var(--header-primary, #fff)" }}>⚙️ <b>Scan Mode</b></p>
                <p style={{ marginBottom: "12px", color: "var(--header-secondary, #b9bbbe)" }}>
                    <b style={{ color: "var(--header-primary, #fff)" }}>Current channel</b> — only scans the channel you are in.<br />
                    <b style={{ color: "var(--header-primary, #fff)" }}>Entire server</b> — scans all channels.
                </p>
                <p style={{ marginBottom: "4px", color: "var(--header-primary, #fff)" }}>💾 <b>Save Mode</b></p>
                <p style={{ marginBottom: "12px", color: "var(--header-secondary, #b9bbbe)" }}>
                    <b style={{ color: "var(--header-primary, #fff)" }}>Export to JSON</b> — downloads a .json file.<br />
                    <b style={{ color: "var(--header-primary, #fff)" }}>Add to favorites</b> — adds directly to Discord GIF favorites.<br />
                    <b style={{ color: "var(--header-primary, #fff)" }}>Both</b> — exports and adds to favorites.
                </p>
                <p style={{ marginBottom: "8px", color: "var(--text-warning, #faa61a)", fontWeight: "700" }}>
                    ⚠️ You can stop the scan at any time by right-clicking any user and selecting "Stop saving GIFs". GIFs found so far will already be saved.
                </p>
                <p style={{ marginBottom: "16px", color: "var(--header-secondary, #b9bbbe)" }}>
                    Due to Discord's search API being non-deterministic, some GIFs may be missed on the first scan. Simply run it again on the same user to pick up any remaining ones — already saved GIFs will be skipped automatically.
                </p>
                <Link href="https://github.com/Mixiruri" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <img
                        src="https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png"
                        alt="GitHub"
                        style={{ width: 20, height: 20, borderRadius: "50%", verticalAlign: "middle" }}
                    />
                    <span>Mixiruri on GitHub</span>
                </Link>
            </div>
        );
    },

    start() {
        addContextMenuPatch("user-context", userContextMenuPatch);
        addContextMenuPatch("user-profile-actions", userContextMenuPatch);
    },

    stop() {
        removeContextMenuPatch("user-context", userContextMenuPatch);
        removeContextMenuPatch("user-profile-actions", userContextMenuPatch);
    },
});
