/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { DataStore } from "@api/index";
import gitHash from "~git-hash";
import plugins from "~plugins";
const CHANGELOG_HISTORY_KEY = "EquicordChangelog_History";
const LAST_SEEN_HASH_KEY = "EquicordChangelog_LastSeenHash";
const KNOWN_PLUGINS_KEY = "EquicordChangelog_KnownPlugins";
const KNOWN_SETTINGS_KEY = "EquicordChangelog_KnownSettings";
const LAST_REPO_CHECK_KEY = "EquicordChangelog_LastRepoCheck";
const GITHUB_COMPARE_ENDPOINT = "https://api.github.com/repos";
function normalizeRepoUrl(repoUrl) {
    if (!repoUrl)
        return null;
    try {
        const normalized = repoUrl.replace(/^git\+/, "");
        const url = new URL(normalized);
        if (!url.hostname.endsWith("github.com"))
            return null;
        const segments = url.pathname.replace(/\.git$/, "").split("/").filter(Boolean);
        if (segments.length < 2)
            return null;
        return `${segments[0]}/${segments[1]}`;
    }
    catch {
        return null;
    }
}
async function fetchCommitsBetween(repoSlug, fromHash, toHash) {
    if (!repoSlug || typeof fetch !== "function")
        return [];
    try {
        const res = await fetch(`${GITHUB_COMPARE_ENDPOINT}/${repoSlug}/compare/${fromHash}...${toHash}`, {
            headers: {
                Accept: "application/vnd.github+json",
            },
        });
        if (!res.ok)
            return [];
        const data = await res.json();
        if (!data || !Array.isArray(data.commits))
            return [];
        return data.commits.map((commit) => {
            const message = commit?.commit?.message ?? "";
            const summary = message.split("\n")[0] || "No message";
            const authorName = commit?.commit?.author?.name ||
                commit?.author?.login ||
                "Unknown";
            const timestamp = commit?.commit?.author?.date
                ? Date.parse(commit.commit.author.date)
                : undefined;
            return {
                hash: commit?.sha || "",
                author: authorName,
                message: summary,
                timestamp: Number.isNaN(timestamp) ? undefined : timestamp,
            };
        });
    }
    catch (err) {
        console.warn("Failed to fetch commits between hashes", err);
        return [];
    }
}
function toStringSet(value) {
    const result = new Set();
    const addValue = (entry) => {
        if (entry === undefined || entry === null)
            return;
        result.add(typeof entry === "string" ? entry : String(entry));
    };
    if (value instanceof Set) {
        value.forEach(addValue);
    }
    else if (value instanceof Map) {
        value.forEach(addValue);
    }
    else if (Array.isArray(value)) {
        value.forEach(addValue);
    }
    else if (typeof value === "string") {
        addValue(value);
    }
    else if (value && typeof value === "object") {
        Object.values(value).forEach(addValue);
    }
    return result;
}
function normalizeKnownSettings(value) {
    const map = new Map();
    const assign = (plugin, settings) => {
        if (plugin === undefined || plugin === null)
            return;
        map.set(String(plugin), toStringSet(settings));
    };
    if (!value) {
        return map;
    }
    if (value instanceof Map) {
        value.forEach((settings, plugin) => assign(plugin, settings));
        return map;
    }
    if (Array.isArray(value)) {
        value.forEach(entry => {
            if (Array.isArray(entry) && entry.length > 0) {
                assign(entry[0], entry[1]);
            }
        });
        return map;
    }
    if (typeof value === "object") {
        Object.entries(value).forEach(([plugin, settings]) => assign(plugin, settings));
    }
    return map;
}
function serializeKnownSettings(map) {
    return Object.fromEntries(Array.from(map.entries()).map(([plugin, settings]) => [
        plugin,
        Array.from(settings),
    ]));
}
async function persistKnownSettings(map) {
    await DataStore.set(KNOWN_SETTINGS_KEY, serializeKnownSettings(map));
}
function isMapLike(value) {
    return (value &&
        typeof value.get === "function" &&
        typeof value.size === "number");
}
export function getNewSettingsSize(newSettings) {
    if (!newSettings)
        return 0;
    if (isMapLike(newSettings))
        return newSettings.size;
    return Object.keys(newSettings).length;
}
export function getNewSettingsEntries(newSettings) {
    if (!newSettings)
        return [];
    if (isMapLike(newSettings))
        return Array.from(newSettings.entries());
    return Object.entries(newSettings);
}
export async function getChangelogHistory() {
    const history = (await DataStore.get(CHANGELOG_HISTORY_KEY));
    if (history) {
        history.forEach(session => {
            if (session.newSettings && !(session.newSettings instanceof Map)) {
                session.newSettings = new Map(Object.entries(session.newSettings));
            }
        });
    }
    return history || [];
}
export async function saveUpdateSession(commits, newPlugins, updatedPlugins, newSettings, forceLog = false) {
    const history = await getChangelogHistory();
    const lastSeenHash = await getLastSeenHash();
    const currentHash = gitHash;
    // For repository fetches, check if we already have this exact state logged (to prevent duplicate logs)
    if (forceLog) {
        const lastRepoCheck = await getLastRepositoryCheckHash();
        const latestRepoHash = commits.length > 0 ? commits[0].hash : currentHash;
        if (lastRepoCheck === latestRepoHash) {
            // if the state hasn't changed last check, do NOT make a new log
            return;
        }
    }
    // Don't save if no changes, unless explicitly forcing the log (for example repository fetch)
    if (!forceLog &&
        commits.length === 0 &&
        newPlugins.length === 0 &&
        updatedPlugins.length === 0 &&
        getNewSettingsSize(newSettings) === 0) {
        return;
    }
    // Determine session type and hash logic
    const sessionType = forceLog ? "repository_fetch" : "update";
    let fromHash = currentHash;
    let toHash = currentHash;
    if (forceLog) {
        // This is a repository fetch - show current vs repository state
        if (commits.length > 0) {
            // Repository has newer commits
            toHash = commits[0].hash; // Latest repository hash
        }
        // If no commits, fromHash === toHash (up to date)
    }
    else {
        // This is an actual update session
        // Is there a better way to do this?
        fromHash = lastSeenHash || "unknown";
        toHash = currentHash;
    }
    const session = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        fromHash: fromHash,
        toHash: toHash,
        commits,
        newPlugins,
        updatedPlugins,
        newSettings: getNewSettingsSize(newSettings) > 0
            ? Object.fromEntries(newSettings)
            : undefined,
        type: sessionType,
    };
    // Add to beginning of history (most recent first)
    history.unshift(session);
    // Keep only last 50 sessions to prevent storage bloat
    if (history.length > 50) {
        history.splice(50);
    }
    await DataStore.set(CHANGELOG_HISTORY_KEY, history);
    if (!forceLog) {
        await setLastSeenHash(currentHash);
    }
    else {
        // for fetches, check the latest repo hash to make sure its not the same
        const latestRepoHash = commits.length > 0 ? commits[0].hash : currentHash;
        await setLastRepositoryCheckHash(latestRepoHash);
    }
    await updateKnownPlugins();
    await updateKnownSettings();
}
export async function getLastSeenHash() {
    return (await DataStore.get(LAST_SEEN_HASH_KEY));
}
export async function setLastSeenHash(hash) {
    await DataStore.set(LAST_SEEN_HASH_KEY, hash);
}
export async function getKnownPlugins() {
    const known = (await DataStore.get(KNOWN_PLUGINS_KEY));
    return new Set(known || []);
}
export async function updateKnownPlugins() {
    const currentPlugins = Object.keys(plugins);
    await DataStore.set(KNOWN_PLUGINS_KEY, currentPlugins);
}
function getSettingsSetForPlugin(plugin) {
    const settings = plugins[plugin]?.settings?.def || {};
    return new Set(Object.keys(settings).filter(setting => setting !== "enabled"));
}
function getCurrentSettings(pluginList) {
    return new Map(pluginList.map(name => [name, getSettingsSetForPlugin(name)]));
}
export async function getKnownSettings() {
    const mapData = (await DataStore.get(KNOWN_SETTINGS_KEY));
    if (mapData === undefined) {
        const knownPlugins = await getKnownPlugins();
        const pluginNames = [
            ...new Set([
                ...Object.keys(plugins),
                ...Array.from(knownPlugins),
            ]),
        ];
        const initialMap = getCurrentSettings(pluginNames);
        await persistKnownSettings(initialMap);
        return initialMap;
    }
    const normalized = normalizeKnownSettings(mapData);
    if (mapData instanceof Map ||
        Array.isArray(mapData) ||
        (mapData &&
            typeof mapData === "object" &&
            Object.values(mapData).some(value => value instanceof Set || value instanceof Map))) {
        await persistKnownSettings(normalized);
    }
    return normalized;
}
export async function getNewSettings() {
    const map = getCurrentSettings(Object.keys(plugins));
    const knownSettings = await getKnownSettings();
    const newSettings = new Map();
    map.forEach((settings, plugin) => {
        const known = knownSettings.get(plugin);
        if (!known)
            return;
        const filteredSettings = [...settings].filter(setting => !known.has(setting));
        if (filteredSettings.length > 0) {
            newSettings.set(plugin, filteredSettings);
        }
    });
    return newSettings;
}
export async function getCommitsSinceLastSeen(repoUrl) {
    const lastSeenHash = await getLastSeenHash();
    if (!lastSeenHash || lastSeenHash === "unknown" || lastSeenHash === gitHash)
        return [];
    const repoSlug = normalizeRepoUrl(repoUrl);
    if (!repoSlug)
        return [];
    return fetchCommitsBetween(repoSlug, lastSeenHash, gitHash);
}
export async function updateKnownSettings() {
    const currentSettings = getCurrentSettings(Object.keys(plugins));
    const knownSettings = await getKnownSettings();
    const mergedSettings = new Map();
    new Set([...currentSettings.keys(), ...knownSettings.keys()]).forEach(plugin => {
        mergedSettings.set(plugin, new Set([
            ...(knownSettings.get(plugin) || []),
            ...(currentSettings.get(plugin) || []),
        ]));
    });
    await persistKnownSettings(mergedSettings);
}
export async function getNewPlugins() {
    const currentPlugins = Object.keys(plugins);
    const knownPlugins = await getKnownPlugins();
    return currentPlugins.filter(plugin => !knownPlugins.has(plugin) &&
        typeof plugins[plugin].name === "string" &&
        !plugins[plugin].hidden &&
        !plugins[plugin].required);
}
export async function getUpdatedPlugins() {
    // This is a placeholder - in a real implementation, you'd track plugin version changes
    // For now, we'll return empty array since plugin version tracking would need to be implemented
    return [];
}
export async function clearChangelogHistory() {
    await DataStore.del(CHANGELOG_HISTORY_KEY);
    await DataStore.del(LAST_SEEN_HASH_KEY);
    await DataStore.del(KNOWN_SETTINGS_KEY);
}
export async function clearIndividualLog(logId) {
    const history = await getChangelogHistory();
    const filteredHistory = history.filter(log => log.id !== logId);
    await DataStore.set(CHANGELOG_HISTORY_KEY, filteredHistory);
}
export async function initializeChangelog() {
    // Initialize with current state if first time
    const lastSeenHash = await getLastSeenHash();
    if (!lastSeenHash) {
        await setLastSeenHash(gitHash);
        await updateKnownPlugins();
        await updateKnownSettings();
    }
}
export async function getLastRepositoryCheckHash() {
    return (await DataStore.get(LAST_REPO_CHECK_KEY));
}
export async function setLastRepositoryCheckHash(hash) {
    await DataStore.set(LAST_REPO_CHECK_KEY, hash);
}
export function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffMinutes < 60) {
        return `${diffMinutes} minute${diffMinutes !== 1 ? "s" : ""} ago`;
    }
    else if (diffHours < 24) {
        return `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`;
    }
    else if (diffDays < 7) {
        return `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;
    }
    else {
        return date.toLocaleDateString();
    }
}
