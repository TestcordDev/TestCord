/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { isPluginEnabled } from "@api/PluginManager";
import { useSettings } from "@api/Settings";
import { Card } from "@components/Card";
import { Heading } from "@components/Heading";
import { Link } from "@components/Link";
import { Paragraph } from "@components/Paragraph";
import { SettingsTab, wrapTab } from "@components/settings/tabs/BaseTab";
import { copyToClipboard } from "@utils/clipboard";
import { Margins } from "@utils/margins";
import { Plugin } from "@utils/types";
import { React, showToast, Toasts } from "@webpack/common";

import gitHash from "~git-hash";
import gitRemote from "~git-remote";
import { PluginMeta } from "~plugins";

// Same filter venfetch uses: API/required plugins aren't user-facing.
const isApiPlugin = (plugin: Plugin) => plugin.name?.endsWith("API") || plugin.required;

// Hoisted so its identity is stable across renders — a fresh array literal would
// make useSettings re-subscribe on every render.
const WATCHED_PATHS = ["plugins.*"];

function forkOf(name: string): "testcord" | "equicord" | "vencord" | "user" {
    const folder = PluginMeta[name]?.folderName ?? "";
    if (PluginMeta[name]?.userPlugin || folder.startsWith("src/userplugins/")) return "user";
    if (folder.startsWith("src/testcordplugins/")) return "testcord";
    if (folder.startsWith("src/equicordplugins/")) return "equicord";
    return "vencord";
}

interface Stats {
    total: number;
    enabled: number;
    forks: Record<string, { enabled: number; total: number; }>;
    categories: [string, number][]; // tag -> enabled count, sorted desc
    caps: Record<string, number>; // capability -> enabled count
    authors: [string, number][]; // author name -> plugin count, sorted desc, top 10
    restartNeeded: number;
    totalPatches: number;
    nightcord: number;
}

function computeStats(): Stats {
    const forks = {
        testcord: { enabled: 0, total: 0 },
        equicord: { enabled: 0, total: 0 },
        vencord: { enabled: 0, total: 0 },
        user: { enabled: 0, total: 0 },
    };
    const categories = new Map<string, number>();
    const authorCounts = new Map<string, number>();
    const caps = {
        "Patches": 0,
        "Commands": 0,
        "Context menus": 0,
        "Flux events": 0,
        "Profile badges": 0,
        "Chat bar buttons": 0,
        "Message hooks": 0,
        "Settings": 0,
    };

    let total = 0;
    let enabled = 0;
    let restartNeeded = 0;
    let totalPatches = 0;
    let nightcord = 0;

    for (const plugin of Object.values(Vencord.Plugins.plugins)) {
        if (!plugin?.name || isApiPlugin(plugin)) continue;

        const on = isPluginEnabled(plugin.name);
        total++;
        if (on) enabled++;

        const fork = forkOf(plugin.name);
        forks[fork].total++;
        if (on) forks[fork].enabled++;

        // Category breakdown counts ENABLED plugins per tag.
        if (on) {
            for (const tag of plugin.tags ?? []) {
                categories.set(tag, (categories.get(tag) ?? 0) + 1);
                if (tag === "Nightcord") nightcord++;
            }
            for (const author of plugin.authors ?? []) {
                if (author?.name) authorCounts.set(author.name, (authorCounts.get(author.name) ?? 0) + 1);
            }
            if (plugin.requiresRestart || (plugin.patches?.length && plugin.requiresRestart !== false)) restartNeeded++;

            if (plugin.patches?.length) { caps.Patches++; totalPatches += plugin.patches.length; }
            if (plugin.commands?.length) caps.Commands++;
            if (plugin.contextMenus && Object.keys(plugin.contextMenus).length) caps["Context menus"]++;
            if (plugin.flux && Object.keys(plugin.flux).length) caps["Flux events"]++;
            if (plugin.userProfileBadge || plugin.userProfileBadges?.length) caps["Profile badges"]++;
            if (plugin.chatBarButton || plugin.renderChatBarButton) caps["Chat bar buttons"]++;
            if (plugin.onBeforeMessageSend || plugin.onBeforeMessageEdit || plugin.onMessageClick) caps["Message hooks"]++;
            if (plugin.settings) caps.Settings++;
        }
    }

    const categoriesSorted = [...categories.entries()].sort((a, b) => b[1] - a[1]);
    const authorsSorted = [...authorCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

    return {
        total, enabled, forks,
        categories: categoriesSorted,
        caps,
        authors: authorsSorted,
        restartNeeded, totalPatches, nightcord,
    };
}

function StatRow({ label, value }: { label: string; value: React.ReactNode; }) {
    const canCopy = typeof value === "string" || typeof value === "number";
    const copy = () => {
        if (!canCopy) return;
        copyToClipboard(String(value));
        showToast(`${label} copied.`, Toasts.Type.SUCCESS);
    };

    return (
        <div
            className={`vc-stats-row${canCopy ? " vc-stats-row-copyable" : ""}`}
            role={canCopy ? "button" : undefined}
            tabIndex={canCopy ? 0 : undefined}
            title={canCopy ? "Click to copy" : undefined}
            onClick={copy}
            onKeyDown={e => {
                if (!canCopy || (e.key !== "Enter" && e.key !== " ")) return;
                e.preventDefault();
                copy();
            }}
        >
            <span className="vc-stats-label">{label}</span>
            <span className="vc-stats-value">{value}</span>
        </div>
    );
}

function StatCard({ title, rows }: { title: string; rows: [string, React.ReactNode][]; }) {
    if (rows.length === 0) return null;
    return (
        <Card className={`vc-stats-card ${Margins.bottom16}`}>
            <Heading tag="h3" className={Margins.bottom8}>{title}</Heading>
            {rows.map(([label, value]) => <StatRow key={label} label={label} value={value} />)}
        </Card>
    );
}

function HeroStat({ value, label, tone }: { value: React.ReactNode; label: string; tone: string; }) {
    return (
        <Card className={`vc-stats-card vc-stats-hero vc-stats-hero-${tone}`}>
            <Heading tag="h2">{value}</Heading>
            <Paragraph>{label}</Paragraph>
        </Card>
    );
}

function StatsTab() {
    // Subscribing forces a re-render whenever any plugin's enabled state
    // changes, so recomputing inline picks up toggles live.
    useSettings(WATCHED_PATHS as Parameters<typeof useSettings>[0]);
    const s = computeStats();

    const buildDate = new Intl.DateTimeFormat(navigator.language, {
        dateStyle: "medium", timeStyle: "short"
    }).format(BUILD_TIMESTAMP);

    const fork = (k: keyof typeof s.forks) => `${s.forks[k].enabled} / ${s.forks[k].total}`;

    return (
        <SettingsTab>
            <div className="vc-stats-grid">
                <HeroStat value={s.enabled} label="plugins enabled" tone="enabled" />
                <HeroStat value={s.total} label="plugins available" tone="available" />
                <HeroStat value={s.categories.length} label="categories in use" tone="categories" />
                <HeroStat value={s.totalPatches} label="active patches" tone="patches" />
            </div>

            <StatCard title="Overview" rows={[
                ["Enabled", s.enabled],
                ["Disabled", s.total - s.enabled],
                ["Total available", s.total],
                ["Require restart to toggle", s.restartNeeded],
                ["Nightcord plugins enabled", s.nightcord],
            ]} />

            <StatCard title="By category (enabled)" rows={s.categories.map(([tag, n]) => [tag, n])} />

            <StatCard title="By source" rows={[
                ["TestCord-exclusive", fork("testcord")],
                ["Equicord", fork("equicord")],
                ["Vencord", fork("vencord")],
                ...(s.forks.user.total > 0 ? [["User plugins", fork("user")] as [string, React.ReactNode]] : []),
            ]} />

            <StatCard title="Capabilities (enabled plugins)"
                rows={Object.entries(s.caps).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])} />

            <StatCard title="Top authors (by enabled plugins)"
                rows={s.authors.map(([name, n]) => [name, n])} />

            <StatCard title="Build" rows={[
                ["Version", VERSION],
                ["Commit", <Link key="commit" href={`https://github.com/${gitRemote}/commit/${gitHash}`}>{gitHash}</Link>],
                ["Repository", <Link key="repo" href={`https://github.com/${gitRemote}`}>{gitRemote}</Link>],
                ["Built", buildDate],
                ["Standalone", IS_STANDALONE ? "yes" : "no (dev)"],
            ]} />

            <Paragraph className={Margins.top16} style={{ opacity: 0.6 }}>
                Counts exclude API and required plugins. Category, capability, and author
                breakdowns count only currently-enabled plugins, so they update live as you
                toggle plugins.
            </Paragraph>
        </SettingsTab>
    );
}

export default wrapTab(StatsTab, "Stats");
