/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType, type PluginNative } from "@utils/types";
import type { Activity } from "@vencord/discord-types";
import { ActivityType } from "@vencord/discord-types/enums";
import { FluxDispatcher, Forms, lodash, PresenceStore, UserStore } from "@webpack/common";

const Native = VencordNative?.pluginHelpers?.RpcMirror as PluginNative<typeof import("./native")> | undefined;

const logger = new Logger("RpcMirror");
const MIRROR_PREFIX = "RpcMirror:";
const CHANNEL_NAME = "testcord-rpc-mirror";
const MAX_JSON_BYTES = 16 * 1024;

const settings = definePluginSettings({
    shareMyActivity: {
        type: OptionType.BOOLEAN,
        description: "Share my game and music status so my other Testcord windows can show it.",
        default: true
    },
    mirrorActivities: {
        type: OptionType.BOOLEAN,
        description: "Show status shared by my other Testcord windows on this account.",
        default: true
    },
    onlyMusic: {
        type: OptionType.BOOLEAN,
        description: "Only sync listening activity. Enable this on every window to sync music and ignore games.",
        default: false
    },
    ignoredApps: {
        type: OptionType.STRING,
        description: "Application IDs or names to never sync, separated by commas.",
        default: ""
    },
    pollInterval: {
        type: OptionType.SLIDER,
        description: "How often to sync status between windows, in seconds.",
        markers: [2, 5, 10, 15, 30],
        default: 5,
        stickToMarkers: true,
        restartNeeded: true
    }
});

let running = false;
let clientId = "";
let channel: BroadcastChannel | null = null;
let intervalId: ReturnType<typeof setInterval> | undefined;
const lastPushed = new Map<string, string>();
const lastHeartbeat = new Map<string, number>();
const remoteSeen = new Map<string, string | null>();
const remoteOwners = new Map<string, string | null>();
const remoteFreshAt = new Map<string, number>();
const mirrorApplied = new Map<string, string | null>();
const mirrored = new Set<string>();

const HEARTBEAT_TICKS = 2;
const STALE_TICKS = 6;

function tickMs(): number {
    return Math.max(2, settings.store.pollInterval) * 1000;
}

function heartbeatDue(key: string, now: number): boolean {
    return now - (lastHeartbeat.get(key) ?? 0) >= tickMs() * HEARTBEAT_TICKS;
}

function isStale(key: string, now: number): boolean {
    return now - (remoteFreshAt.get(key) ?? 0) > tickMs() * STALE_TICKS;
}

function isKey(value: unknown): value is string {
    return typeof value === "string" && /^[A-Za-z0-9:_-]{1,128}$/.test(value);
}

function isActivityRecord(value: unknown): value is Activity {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBridgeEntry(value: unknown): value is { activity: unknown; owner?: unknown; } {
    return typeof value === "object" && value !== null && "activity" in value;
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    if (value && typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, entry]) => entry !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}

function deriveKey(activity: Activity): string {
    const app = (activity.application_id ?? "noapp").replace(/[^A-Za-z0-9]/g, "").slice(0, 32) || "noapp";
    const name = (activity.name ?? "noname").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32) || "noname";
    return `${app}:${name}:${activity.type ?? -1}`;
}

function parseIgnored(): string[] {
    return settings.store.ignoredApps.split(",").map(token => token.trim().toLowerCase()).filter(token => token.length > 0);
}

function shouldSync(activity: Activity, ignored: string[]): boolean {
    if (activity.type === ActivityType.CUSTOM_STATUS) return false;
    if (settings.store.onlyMusic && activity.type !== ActivityType.LISTENING) return false;
    if (!ignored.length) return true;
    const id = (activity.application_id ?? "").toLowerCase();
    const name = (activity.name ?? "").toLowerCase();
    return !ignored.some(token => id === token || (name.length > 0 && name.includes(token)));
}

function parseBridgeActivity(rawJson: unknown): Activity | null {
    if (rawJson === null) return null;
    if (typeof rawJson !== "string" || rawJson.length === 0 || rawJson.length > MAX_JSON_BYTES) return null;
    try {
        const parsed: unknown = JSON.parse(rawJson);
        return isActivityRecord(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

async function pushBridge(key: string, activity: Activity | null): Promise<void> {
    const activityJson = activity ? JSON.stringify(activity) : null;
    channel?.postMessage({ key, activityJson, owner: activity ? clientId : null });
    if (!Native) return;
    try {
        await Native.pushMirrorActivity(key, activityJson, activity ? clientId : null);
    } catch {
        logger.debug("Bridge push failed");
    }
}

function applySingle(key: string, activity: Activity | null, ignored: string[], owner: string | null) {
    if (activity) {
        remoteSeen.set(key, stableStringify(activity));
        remoteOwners.set(key, owner);
        remoteFreshAt.set(key, Date.now());
    } else {
        remoteSeen.delete(key);
        remoteOwners.delete(key);
        remoteFreshAt.delete(key);
    }
    if (owner !== null && owner === clientId) return;

    const filtered = activity && shouldSync(activity, ignored) ? activity : null;
    const current = filtered ? stableStringify(filtered) : null;
    if (mirrorApplied.has(key) && mirrorApplied.get(key) === current) return;
    mirrorApplied.set(key, current);

    const socketId = `${MIRROR_PREFIX}${key}`;
    if (filtered) {
        mirrored.add(socketId);
        FluxDispatcher.dispatch({ type: "LOCAL_ACTIVITY_UPDATE", activity: lodash.cloneDeep(filtered), socketId });
    } else {
        mirrored.delete(socketId);
        FluxDispatcher.dispatch({ type: "LOCAL_ACTIVITY_UPDATE", activity: null, socketId });
    }
}

function clearAllMirrored() {
    for (const socketId of mirrored) {
        FluxDispatcher.dispatch({ type: "LOCAL_ACTIVITY_UPDATE", activity: null, socketId });
    }
    mirrored.clear();
    for (const key of mirrorApplied.keys()) mirrorApplied.delete(key);
}

async function publishOwn() {
    const ignored = parseIgnored();
    if (!settings.store.shareMyActivity) {
        await unpublishAll();
        return;
    }
    const me = UserStore.getCurrentUser();
    if (!me) return;
    const own: unknown = PresenceStore.getActivities(me.id);
    if (!Array.isArray(own)) return;

    const now = Date.now();
    const wanted = new Map<string, string>();
    const payloads = new Map<string, Activity>();
    const kept = new Set<string>();
    for (const entry of own) {
        if (!isActivityRecord(entry) || !shouldSync(entry, ignored)) continue;
        const key = deriveKey(entry);
        if (mirrorApplied.get(key) != null) {
            kept.add(key);
            continue;
        }
        const json = stableStringify(entry);
        if (remoteSeen.get(key) === json) {
            lastPushed.set(key, json);
            kept.add(key);
            if (heartbeatDue(key, now)) {
                lastHeartbeat.set(key, now);
                await pushBridge(key, entry);
            }
            continue;
        }
        wanted.set(key, json);
        payloads.set(key, entry);
    }

    for (const [key, json] of wanted) {
        if (lastPushed.get(key) === json) {
            kept.add(key);
            continue;
        }
        lastPushed.set(key, json);
        lastHeartbeat.set(key, now);
        kept.add(key);
        await pushBridge(key, payloads.get(key) ?? null);
    }

    for (const key of [...lastPushed.keys()]) {
        if (kept.has(key)) continue;
        const published = lastPushed.get(key);
        lastPushed.delete(key);
        lastHeartbeat.delete(key);
        if (remoteSeen.has(key) && remoteSeen.get(key) !== published) continue;
        await pushBridge(key, null);
    }
}

async function unpublishAll() {
    const keys = [...lastPushed.keys()];
    lastPushed.clear();
    lastHeartbeat.clear();
    for (const key of keys) await pushBridge(key, null);
}

async function syncFromBridge() {
    if (!settings.store.mirrorActivities) {
        if (mirrored.size) clearAllMirrored();
        return;
    }
    const ignored = parseIgnored();
    if (!Native) return;
    let entries: unknown;
    try {
        entries = (await Native.pullMirrorActivities()).entries;
    } catch {
        logger.debug("Bridge pull failed");
        return;
    }
    if (!entries || typeof entries !== "object") return;

    const now = Date.now();
    const seen = new Set<string>();
    for (const [key, value] of Object.entries(entries)) {
        if (!isKey(key) || !isBridgeEntry(value)) continue;
        const { updatedAt } = value as { updatedAt?: unknown; };
        if (typeof updatedAt === "number" && now - updatedAt > tickMs() * STALE_TICKS) {
            await pushBridge(key, null);
            continue;
        }
        seen.add(key);
        const owner = typeof value.owner === "string" ? value.owner : null;
        applySingle(key, isActivityRecord(value.activity) ? value.activity : null, ignored, owner);
    }
    for (const key of [...remoteSeen.keys()]) {
        if (!seen.has(key)) applySingle(key, null, ignored, null);
    }
}

function handleBroadcastMessage(event: MessageEvent) {
    if (!running || !settings.store.mirrorActivities) return;
    const data = event.data as { key?: unknown; activityJson?: unknown; owner?: unknown; } | null;
    if (!data || typeof data !== "object" || !isKey(data.key)) return;
    const owner = typeof data.owner === "string" ? data.owner : null;
    applySingle(data.key, parseBridgeActivity(data.activityJson), parseIgnored(), owner);
}

async function tick() {
    if (!running) return;
    try {
        await publishOwn();
        await syncFromBridge();
        if (settings.store.mirrorActivities) {
            const now = Date.now();
            const ignored = parseIgnored();
            for (const [key, applied] of mirrorApplied) {
                if (applied == null || !isStale(key, now)) continue;
                applySingle(key, null, ignored, null);
            }
        }
    } catch (error) {
        logger.debug("Sync tick failed", error);
    }
}

export default definePlugin({
    name: "RpcMirror",
    description: "Share your Rich Presence with your other Testcord windows, so alts show the same music and game status as your main.",
    authors: [TestcordDevs.x2b],
    tags: ["Activity", "Utility"],
    settings,
    settingsAboutComponent: () => (
        <>
            <Forms.FormTitle tag="h3">How to use</Forms.FormTitle>
            <Forms.FormText>
                Keep Share on where the music or game runs, and Mirror on where you want to see it.
                For a main plus alts setup, turn Mirror off on the main and Share off on the alts.
            </Forms.FormText>
        </>
    ),
    start() {
        running = true;
        clientId = Math.random().toString(36).slice(2, 10);
        if (typeof BroadcastChannel === "function") {
            channel = new BroadcastChannel(CHANNEL_NAME);
            channel.onmessage = handleBroadcastMessage;
        }
        void tick();
        intervalId = setInterval(() => void tick(), Math.max(2, settings.store.pollInterval) * 1000);
    },
    stop() {
        running = false;
        if (intervalId !== undefined) {
            clearInterval(intervalId);
            intervalId = undefined;
        }
        channel?.close();
        channel = null;
        remoteFreshAt.clear();
        lastHeartbeat.clear();
        clearAllMirrored();
        void unpublishAll();
    },
    toolboxActions: {
        "RpcMirror: sync now"() {
            void tick();
        },
        "RpcMirror: clear mirrored status"() {
            clearAllMirrored();
        }
    }
});
