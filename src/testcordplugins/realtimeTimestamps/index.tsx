/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Nightcord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { moment, useEffect, useReducer } from "@webpack/common";

// ─── Settings ────────────────────────────────────────────────────────────────

const settings = definePluginSettings({
    format: {
        type: OptionType.SELECT,
        description: "Seconds format displayed on every message timestamp",
        default: "HH:mm:ss",
        options: [
            { label: "15:34:21  (24h)", value: "HH:mm:ss", default: true },
            { label: "3:34:21 PM  (12h)", value: "h:mm:ss A" },
        ],
    },
    showInTooltip: {
        type: OptionType.BOOLEAN,
        description: "Show seconds in the hover tooltip",
        default: true,
    },
    showInCompact: {
        type: OptionType.BOOLEAN,
        description: "Show seconds in compact mode",
        default: true,
    },
});

// ─── Shared global tick — one interval for all timestamps ────────────────────

let tickInterval: ReturnType<typeof setInterval> | null = null;
let tickVersion = 0;
const tickListeners = new Set<() => void>();

function notifyTickListeners() {
    tickVersion++;
    for (const listener of tickListeners) listener();
}

function startTick() {
    if (tickInterval !== null) return;
    tickVersion = 0;
    tickInterval = setInterval(notifyTickListeners, 1000);
}

function stopTick() {
    if (tickInterval !== null) {
        clearInterval(tickInterval);
        tickInterval = null;
    }
    tickVersion = 0;
    tickListeners.clear();
}

function subscribeTick(callback: () => void): () => void {
    tickListeners.add(callback);
    return () => { tickListeners.delete(callback); };
}

function getTickVersion() {
    return tickVersion;
}

// ─── Hook that re-renders on the global tick ─────────────────────────────────

function useGlobalTick() {
    const [, forceUpdate] = useReducer((n: number) => n + 1, 0);
    useEffect(() => { return subscribeTick(forceUpdate); }, []);
}

// ─── Renderers called by the patches ─────────────────────────────────────────

// Formatted output is identical for every timestamp that lands in the same
// second with the same settings, so cache by second + the settings that affect
// the string. On a busy guild this turns N moment().format() calls per tick
// into one per unique second, while keeping the same string return type the
// patch sites depend on. Bounded so it can't grow without limit.
const formatCache = new Map<string, string>();
const FORMAT_CACHE_MAX = 512;

function formatCached(date: Date, type: "cozy" | "compact" | "tooltip", fmt: string): string {
    const { showInCompact, showInTooltip } = settings.store;
    const time = date.getTime();
    if (Number.isNaN(time)) return "";
    const second = Math.floor(time / 1000);
    const key = `${type}|${second}|${fmt}|${showInCompact ? 1 : 0}|${showInTooltip ? 1 : 0}`;

    const cached = formatCache.get(key);
    if (cached !== undefined) return cached;

    let out: string;
    switch (type) {
        case "cozy":
            out = moment(date).format(fmt);
            break;
        case "compact":
            out = showInCompact ? moment(date).format(fmt) : moment(date).format("LT");
            break;
        case "tooltip":
            out = showInTooltip
                ? moment(date).format(`dddd, MMMM D, YYYY [at] ${fmt}`)
                : moment(date).format("LLLL");
            break;
    }

    if (formatCache.size >= FORMAT_CACHE_MAX) {
        const oldest = formatCache.keys().next().value;
        if (oldest !== undefined) formatCache.delete(oldest);
    }
    formatCache.set(key, out);
    return out;
}

function toDate(input: unknown): Date | null {
    if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input;
    if (typeof input === "number" && Number.isFinite(input)) {
        const ms = input > 1e9 && input < 1e11 ? input * 1000 : input;
        const d = new Date(ms);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    if (typeof input === "string") {
        const d = new Date(input);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    try {
        const maybe = input as { toDate?: unknown; valueOf?: unknown; };
        if (typeof maybe?.toDate === "function") {
            const d = (maybe.toDate as () => unknown)();
            if (d instanceof Date && !Number.isNaN(d.getTime())) return d;
        }
        if (typeof maybe?.valueOf === "function") {
            const ms = Number((maybe.valueOf as () => unknown)());
            if (Number.isFinite(ms)) {
                const normalized = ms > 1e9 && ms < 1e11 ? ms * 1000 : ms;
                const d = new Date(normalized);
                if (!Number.isNaN(d.getTime())) return d;
            }
        }
    } catch { }
    return null;
}

function renderTimestamp(input: unknown, type: "cozy" | "compact" | "tooltip"): string {
    useGlobalTick();

    const date = toDate(input);
    if (!date) return "";

    const fmt = settings.store.format ?? "HH:mm:ss";
    return formatCached(date, type, fmt);
}

// ─── Plugin ──────────────────────────────────────────────────────────────────

export default definePlugin({
    name: "RealtimeTimestamps",
    description: "Replaces Discord timestamps (e.g. 15:31) with live seconds (e.g. 15:34:21), updated every second.",
    tags: ["Appearance", "Chat", "Utility", "Nightcord"],
    authors: [{ name: "Nightcord", id: 253979869n }],
    settings,

    renderTimestamp,

    patches: [
        // ─── Main Timestamp component (cozy + compact messages + hover tooltip) ─
        {
            find: "#{intl::MESSAGE_EDITED_TIMESTAMP_A11Y_LABEL}",
            replacement: [
                {
                    // Compact mode: the useMemo that formats with "LT"
                    match: /(\i\.useMemo\(.{0,50}"LT".{0,30}\]\))/,
                    replace: "$self.renderTimestamp(arguments[0].timestamp,'compact')",
                },
                {
                    // Cozy mode: the useMemo that calls the calendar/relative formatter
                    match: /(\i\.useMemo\(.{0,10}\i\.\i\)\(.{0,10}\]\))/,
                    replace: "$self.renderTimestamp(arguments[0].timestamp,'cozy')",
                },
                {
                    // Tooltip shown when hovering a message timestamp
                    match: /(__unsupportedReactNodeAsText:).{0,25}"LLLL"\)/,
                    replace: "$1$self.renderTimestamp(arguments[0].timestamp,'tooltip')",
                },
            ],
        },

        // ─── Timestamp markdown <t:unix:t> — hover tooltip ────────────────────
        {
            find: /\.full,.{0,15}children:/,
            replacement: {
                match: /(__unsupportedReactNodeAsText:)\i\.full/,
                replace: "$1$self.renderTimestamp(new Date(arguments[0].node.timestamp*1000),'tooltip')",
            },
        },
    ],

    start() {
        startTick();
    },

    stop() {
        stopTick();
    },
});
