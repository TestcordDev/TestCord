/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { sendBotMessage } from "@api/Commands";
import * as DataStore from "@api/DataStore";
import { addMessagePreSendListener, removeMessagePreSendListener } from "@api/MessageEvents";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { React, useEffect, useState } from "@webpack/common";

const KEY = "MallCord_MessageStats";
const DAY = 24 * 60 * 60 * 1000;

interface StoredStats {
    version: 1;
    days: Record<string, number>;
    total: number;
}

function emptyStats(): StoredStats {
    return { version: 1, days: {}, total: 0 };
}

function dayKey(ts: number) {
    return startOfDay(ts).toString();
}

function keyTime(key: string) {
    const numeric = Number(key);
    return Number.isNaN(numeric) ? Date.parse(key) : numeric;
}

function normalizeStats(value: unknown): StoredStats {
    if (Array.isArray(value)) {
        const stats = emptyStats();
        for (const t of value) {
            if (typeof t !== "number") continue;
            const key = dayKey(t);
            stats.days[key] = (stats.days[key] ?? 0) + 1;
            stats.total++;
        }
        return pruneStats(stats);
    }

    if (value && typeof value === "object" && "days" in value) {
        const raw = value as Partial<StoredStats>;
        const days: Record<string, number> = {};
        for (const [key, count] of Object.entries(raw.days ?? {})) {
            if (typeof count === "number" && count > 0) days[key] = count;
        }
        return pruneStats({ version: 1, days, total: Object.values(days).reduce((sum, count) => sum + count, 0) });
    }

    return emptyStats();
}

function pruneStats(stats: StoredStats) {
    const cutoff = Date.now() - 365 * DAY;
    for (const key of Object.keys(stats.days)) {
        if (keyTime(key) < cutoff) delete stats.days[key];
    }
    stats.total = Object.values(stats.days).reduce((sum, count) => sum + count, 0);
    return stats;
}

async function record() {
    await DataStore.update<unknown>(KEY, old => {
        const stats = normalizeStats(old);
        const today = dayKey(Date.now());
        stats.days[today] = (stats.days[today] ?? 0) + 1;
        stats.total++;
        return stats;
    });
}

function startOfDay(ts: number) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

function streak(stats: StoredStats, goal: number) {
    let count = 0;
    let day = startOfDay(Date.now());
    while (true) {
        const hit = (stats.days[dayKey(day)] ?? 0) >= goal;
        if (hit) count++;
        else if (day < startOfDay(Date.now())) break;
        day -= DAY;
        if (count > 0 && !hit) break;
        if (day < startOfDay(Date.now()) - 400 * DAY) break;
    }
    return count;
}

const row = (label: string, value: React.ReactNode, color?: string) => (
    <tr style={{ borderBottom: "1px solid var(--background-modifier-accent)" }}>
        <td style={{ padding: "10px" }}>{label}</td>
        <td style={{ padding: "10px", fontWeight: "bold", color }}>{value}</td>
    </tr>
);

function StatsPanel() {
    const { dailyGoal } = settings.use(["dailyGoal"]);
    const [stats, setStats] = useState<StoredStats>(emptyStats);

    const reload = () => DataStore.get<unknown>(KEY).then(v => setStats(normalizeStats(v)));
    useEffect(() => { reload(); }, []);

    const now = Date.now();
    const since = (ms: number) => {
        const cutoff = now - ms;
        let count = 0;
        for (const [key, value] of Object.entries(stats.days)) {
            if (keyTime(key) >= cutoff) count += value;
        }
        return count;
    };

    const goal = dailyGoal || 100;
    const today = stats.days[dayKey(now)] ?? 0;
    const pct = Math.min(Math.round((today / goal) * 100), 100);

    const dayKeys = Object.keys(stats.days);
    const earliest = dayKeys.length ? Math.min(...dayKeys.map(keyTime)) : now;
    const days = Math.max(1, Math.ceil((now - earliest) / DAY));
    const avg = Math.round(stats.total / days);
    const best = dayKeys.length ? Math.max(...Object.values(stats.days)) : 0;

    return (
        <div style={{ color: "var(--text-normal)" }}>
            <div style={{ marginBottom: 20, background: "var(--background-secondary)", padding: 15, borderRadius: 8 }}>
                <h3 style={{ marginTop: 0, color: "var(--header-primary)" }}>🎯 Daily goal</h3>
                <p>Aiming for <strong>{goal}</strong> messages a day.</p>
                <div style={{ background: "var(--background-modifier-accent)", height: 20, borderRadius: 10, overflow: "hidden", marginTop: 10 }}>
                    <div style={{ background: "var(--brand-experiment)", width: `${pct}%`, height: "100%", textAlign: "center", color: "white", fontSize: 12, lineHeight: "20px", fontWeight: "bold" }}>
                        {pct}%
                    </div>
                </div>
                <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 5 }}>Sent today: {today} / {goal}</p>
            </div>

            <h3 style={{ color: "var(--header-primary)", marginBottom: 10 }}>📊 Stats</h3>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", background: "var(--background-secondary)", borderRadius: 8, overflow: "hidden" }}>
                <tbody>
                    {row("Today", today, "var(--text-positive)")}
                    {row("This week", since(7 * DAY))}
                    {row("This month", since(30 * DAY))}
                    {row("This year", since(365 * DAY))}
                    {row("All time (tracked)", stats.total)}
                    {row("Daily average", avg)}
                    {row("Best day", best)}
                    {row("Current streak", `${streak(stats, goal)} day(s)`, "var(--text-brand)")}
                </tbody>
            </table>

            <button
                onClick={async () => { await DataStore.set(KEY, emptyStats()); reload(); }}
                style={{ marginTop: 15, background: "var(--background-tertiary)", color: "var(--text-normal)", border: "1px solid var(--background-modifier-accent)", padding: "8px 12px", borderRadius: 4, cursor: "pointer" }}
            >
                Reset stats
            </button>
        </div>
    );
}

const settings = definePluginSettings({
    dailyGoal: {
        type: OptionType.NUMBER,
        description: "How many messages you want to send per day",
        default: 100
    },
    display: {
        type: OptionType.COMPONENT,
        description: "",
        component: StatsPanel
    }
});

export default definePlugin({
    name: "MessageStatistics",
    description: "Tracks how many messages you send per day, week, month and year, with a daily goal and streaks.",
    authors: [{ name: "Dann", id: 0n }],
    tags: ["Utility"],
    dependencies: ["CommandsAPI"],
    settings,

    commands: [
        {
            name: "mystats",
            description: "Show your message stats here in chat",
            options: [],
            execute: async (_, ctx) => {
                const stats = normalizeStats(await DataStore.get<unknown>(KEY));
                const now = Date.now();
                const since = (ms: number) => {
                    const cutoff = now - ms;
                    let count = 0;
                    for (const [key, value] of Object.entries(stats.days)) {
                        if (keyTime(key) >= cutoff) count += value;
                    }
                    return count;
                };
                sendBotMessage(ctx.channel.id, {
                    content: `📊 **Your messages** — today **${stats.days[dayKey(now)] ?? 0}** · week **${since(7 * DAY)}** · month **${since(30 * DAY)}** · year **${since(365 * DAY)}** · all-time **${stats.total}**`
                });
            }
        }
    ],

    start() {
        this.pre = addMessagePreSendListener(() => { record(); });
    },
    stop() {
        removeMessagePreSendListener(this.pre);
    }
});
