/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as DataStore from "@api/DataStore";
import { settings } from "./settings";
const STORE_KEY_CUSTOM_WHITELIST = "vAnalyzer_customWhitelist";
const STORE_KEY_CUSTOM_BLOCKLIST = "vAnalyzer_customBlocklist";
const STORE_KEY_FMHY_CACHE = "vAnalyzer_fmhyBlocklist";
const FMHY_FILTERLIST_URL = "https://raw.githubusercontent.com/fmhy/FMHYFilterlist/main/filterlist.txt";
const FETCH_TIMEOUT_MS = 15_000;
const MAX_FILTERLIST_BYTES = 2 * 1024 * 1024;
const BUILTIN_WHITELIST = new Set([
    "discord.com",
    "discord.gg",
    "discordapp.com",
    "discordapp.net",
    "discord.media",
    "discordcdn.com",
    "cdn.discordapp.com",
    "media.discordapp.net",
    "tenor.co",
    "tenor.com",
    "giphy.com",
    "imgur.com",
    "i.imgur.com",
    "youtube.com",
    "youtu.be",
    "www.youtube.com",
    "i.ytimg.com",
    "twitter.com",
    "x.com",
    "reddit.com",
    "www.reddit.com",
    "twitch.tv",
    "www.twitch.tv",
    "instagram.com",
    "www.instagram.com",
    "tiktok.com",
    "www.tiktok.com",
    "google.com",
    "www.google.com",
    "github.com",
    "www.github.com",
    "wikipedia.org",
    "en.wikipedia.org",
    "spotify.com",
    "open.spotify.com",
    "microsoft.com",
    "apple.com",
    "amazon.com",
    "vencord.dev",
]);
let customWhitelist = new Set();
let customBlocklist = new Set();
let fmhyBlocklist = new Set();
function extractHostname(url) {
    try {
        let normalized = url.trim();
        if (!/^https?:\/\//i.test(normalized)) {
            normalized = "https://" + normalized;
        }
        const parsed = new URL(normalized);
        return parsed.hostname.toLowerCase();
    }
    catch {
        return null;
    }
}
async function readCappedText(response) {
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_FILTERLIST_BYTES)
        throw new Error("Filterlist was too large.");
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_FILTERLIST_BYTES)
        throw new Error("Filterlist was too large.");
    return text;
}
function getDomainVariants(hostname) {
    const parts = hostname.split(".");
    const variants = [hostname];
    for (let i = 1; i < parts.length - 1; i++) {
        variants.push(parts.slice(i).join("."));
    }
    return variants;
}
function matchesDomainSet(hostname, domainSet) {
    const variants = getDomainVariants(hostname);
    return variants.some(v => domainSet.has(v));
}
export function isWhitelisted(url) {
    const hostname = extractHostname(url);
    if (!hostname)
        return false;
    if (settings.store.useBuiltinWhitelist && matchesDomainSet(hostname, BUILTIN_WHITELIST))
        return true;
    if (matchesDomainSet(hostname, customWhitelist))
        return true;
    return false;
}
export function isBlocklisted(url) {
    if (!settings.store.enableBlocklists)
        return false;
    const hostname = extractHostname(url);
    if (!hostname)
        return false;
    if (matchesDomainSet(hostname, fmhyBlocklist))
        return true;
    if (matchesDomainSet(hostname, customBlocklist))
        return true;
    return false;
}
export function getBlocklistReason(url) {
    const hostname = extractHostname(url);
    if (!hostname)
        return null;
    if (matchesDomainSet(hostname, fmhyBlocklist))
        return "FMHY Unsafe Sites Filterlist";
    if (matchesDomainSet(hostname, customBlocklist))
        return "Custom blocklist";
    return null;
}
export async function getCustomWhitelist() {
    return (await DataStore.get(STORE_KEY_CUSTOM_WHITELIST)) ?? [];
}
export async function setCustomWhitelist(domains) {
    const normalized = domains.map(d => d.trim().toLowerCase()).filter(Boolean);
    await DataStore.set(STORE_KEY_CUSTOM_WHITELIST, normalized);
    customWhitelist = new Set(normalized);
}
export async function getCustomBlocklist() {
    return (await DataStore.get(STORE_KEY_CUSTOM_BLOCKLIST)) ?? [];
}
export async function setCustomBlocklist(domains) {
    const normalized = domains.map(d => d.trim().toLowerCase()).filter(Boolean);
    await DataStore.set(STORE_KEY_CUSTOM_BLOCKLIST, normalized);
    customBlocklist = new Set(normalized);
}
// FMHY filterlist
function parseFmhyFilterlist(text) {
    const domains = [];
    for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("!"))
            continue;
        const match = trimmed.match(/^\|\|([a-z0-9.-]+)\^$/i);
        if (match) {
            domains.push(match[1].toLowerCase());
        }
    }
    return domains;
}
export async function loadFmhyBlocklist() {
    try {
        const cached = await DataStore.get(STORE_KEY_FMHY_CACHE);
        if (cached?.domains) {
            fmhyBlocklist = new Set(cached.domains);
        }
    }
    catch {
        // ign
    }
}
export async function fetchFmhyBlocklist() {
    try {
        const res = await fetch(FMHY_FILTERLIST_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!res.ok)
            throw new Error(`HTTP ${res.status}`);
        const text = await readCappedText(res);
        const domains = parseFmhyFilterlist(text);
        fmhyBlocklist = new Set(domains);
        await DataStore.set(STORE_KEY_FMHY_CACHE, { domains, fetchedAt: Date.now() });
        return domains.length;
    }
    catch (e) {
        console.error("[vAnalyzer] Failed to fetch FMHY blocklist:", e);
        return -1;
    }
}
export async function initFilters() {
    const [whitelist, blocklist] = await Promise.all([
        getCustomWhitelist(),
        getCustomBlocklist(),
    ]);
    customWhitelist = new Set(whitelist);
    customBlocklist = new Set(blocklist);
    await loadFmhyBlocklist();
    // caching
    if (settings.store.enableFmhyBlocklist) {
        const cached = await DataStore.get(STORE_KEY_FMHY_CACHE);
        const fourDays = 4 * 24 * 60 * 60 * 1000;
        if (!cached?.domains?.length || (Date.now() - cached.fetchedAt > fourDays)) {
            fetchFmhyBlocklist();
        }
    }
}
