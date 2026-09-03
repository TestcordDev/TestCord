/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import * as DataStore from "@api/DataStore";
import { type NetworkDomainSummary, NetworkMonitor } from "@api/NetworkMonitor";
import { type PatchFailure, PluginHealth, type PluginHealthEntry, type RuntimeError, type SessionRecord, type StabilityScore } from "@api/PluginHealth";
import { pluginStartTimings } from "@api/PluginManager";
import { PluginProfileData, PluginProfiler } from "@api/PluginProfiler";
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { Divider } from "@components/Divider";
import { Heading, HeadingSecondary } from "@components/Heading";
import { Link } from "@components/Link";
import { Paragraph } from "@components/Paragraph";
import { openPluginModal, SettingsTab, wrapTab } from "@components/settings";
import { buildIssueUrl, generateGitHubIssueBody } from "@utils/debugReport";
import { redactDiagnosticValue } from "@utils/diagnosticRedaction";
import { Margins } from "@utils/margins";
import { RenderModalProps } from "@vencord/discord-types";
import { wreq } from "@webpack";
import { Modal, openModal, React, Select, TextInput, Toasts, useEffect, useMemo, useState } from "@webpack/common";
import { getBuildNumber, getFactoryPatchedSource, SYM_ORIGINAL_FACTORY } from "@webpack/patcher";

import Plugins from "~plugins";

type DiagnosticTabKey = "overview" | "diagnostics" | "impact" | "monitor" | "finder" | "guide";

function formatRelative(ts: number): string {
    const diff = Date.now() - ts;
    if (diff < 5_000) return "just now";
    if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
    if (diff < 3600_000) return `${Math.round(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.round(diff / 3600_000)}h ago`;
    return new Date(ts).toLocaleString();
}

function formatUptime(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = (n: number) => String(n).padStart(2, "0");
    return hours > 0
        ? `${hours}h ${pad(minutes)}m ${pad(seconds)}s`
        : `${minutes}m ${pad(seconds)}s`;
}

/** Live "time since the client launched" readout for the score card. */
function UptimeClock() {
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);
    const { startedAt } = PluginHealth.getCurrentSession();
    return (
        <div
            className="vc-plugin-health-uptime"
            title={`Client launched ${new Date(startedAt).toLocaleString()}`}
        >
            <span className="vc-plugin-health-uptime-label">Uptime</span>
            <span className="vc-plugin-health-uptime-value">
                {formatUptime(Math.max(0, now - startedAt))}
            </span>
        </div>
    );
}

function truncateForDisplay(value: string, max = 140): string {
    if (value.length <= max) return value;
    return value.slice(0, max) + "…";
}

const KIND_LABEL: Record<string, string> = {
    noModule: "module missing",
    noEffect: "no effect",
    errored: "errored",
    undoingGroup: "group rolled back",
    conflict: "conflict",
    codeChanged: "code changed"
};

const BADGE_LABEL: Record<StabilityScore["badge"], string> = {
    stable: "Stable",
    flaky: "Flaky",
    unstable: "Unstable",
    unknown: "Not enough data"
};

const NO_MODULE_DISCLAIMER =
    "This patch's target module was not found in Discord's bundle. " +
    "This usually means a Discord update removed or renamed the module the plugin " +
    "was targeting. The plugin likely needs an update from its author. " +
    "If the plugin still works, this entry can be safely dismissed.";

type FilterKey = "all" | "conflict" | "noModule" | "noEffect" | "errored" | "undoingGroup" | "codeChanged" | "runtime";

const FILTER_OPTIONS: Array<{ value: FilterKey; label: string; key: string; }> = [
    { key: "all", value: "all", label: "All issues" },
    { key: "conflict", value: "conflict", label: "Conflicts" },
    { key: "noModule", value: "noModule", label: "Missing modules" },
    { key: "noEffect", value: "noEffect", label: "No effect" },
    { key: "errored", value: "errored", label: "Errored patches" },
    { key: "undoingGroup", value: "undoingGroup", label: "Rolled back groups" },
    { key: "codeChanged", value: "codeChanged", label: "Source code changes" },
    { key: "runtime", value: "runtime", label: "Runtime errors" }
];

type SortKey = "errors" | "name" | "stability" | "recent";

const SORT_OPTIONS: Array<{ value: SortKey; label: string; key: string; }> = [
    { key: "errors", value: "errors", label: "Most errors" },
    { key: "name", value: "name", label: "Plugin name (A–Z)" },
    { key: "stability", value: "stability", label: "Stability (worst first)" },
    { key: "recent", value: "recent", label: "Most recent" }
];

const STABILITY_RANK: Record<StabilityScore["badge"], number> = {
    unstable: 0,
    flaky: 1,
    unknown: 2,
    stable: 3
};

const DB_KEY_BANNER_DISMISSED = "PluginHealthBannerDismissed_v1";
const DB_KEY_NOTICE_DISMISSED = "PluginHealthNoticeDismissed_v1";
const DB_KEY_CONFLICTS_HIDDEN = "PluginHealthConflictsHidden_v1";
const DB_KEY_IGNORE_SOURCE_HEALTH = "PluginHealth_IgnoreSourceHealth_v1";
const DB_KEY_IGNORE_SOURCE_HISTORY = "PluginHealth_IgnoreSourceHistory_v1";

function filterEntry(entry: PluginHealthEntry, filter: FilterKey): boolean {
    if (filter === "all") return true;
    if (filter === "runtime") return entry.runtimeErrors.length > 0;
    return entry.patchFailures.some(f => f.kind === filter);
}

// Dismiss only what the user can currently see: honours the active filter,
// conflicts-hidden preference, and source-changes-hidden preference.
function dismissEntry(name: string, filter: FilterKey, conflictsHidden: boolean, ignoreSourceHealth = false) {
    if (filter === "runtime") {
        PluginHealth.clearRuntimeErrors(name);
        return;
    }
    if (filter === "all") {
        if (conflictsHidden || ignoreSourceHealth) {
            PluginHealth.clearPatchFailures(name, f => {
                if (conflictsHidden && f.kind === "conflict") return false;
                if (ignoreSourceHealth && f.kind === "codeChanged") return false;
                return true;
            });
            PluginHealth.clearRuntimeErrors(name);
        } else {
            PluginHealth.clear(name);
        }
        return;
    }
    PluginHealth.clearPatchFailures(name, f => f.kind === filter);
}

type DiffLine = { type: "same" | "added" | "removed"; text: string; };

// Line diff with a real LCS on the differing region. Common prefix/suffix are
// trimmed first (the overwhelmingly common case for a patch), so a one-line
// insertion no longer marks the whole tail of the file as changed.
function diffSources(original: string, patched: string): DiffLine[] {
    const a = original.split("\n");
    const b = patched.split("\n");

    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    let endA = a.length, endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
        endA--;
        endB--;
    }

    const midA = a.slice(start, endA);
    const midB = b.slice(start, endB);
    let mid: DiffLine[];

    if (midA.length === 0) {
        mid = midB.map(text => ({ type: "added", text }));
    } else if (midB.length === 0) {
        mid = midA.map(text => ({ type: "removed", text }));
    } else if (midA.length <= 400 && midB.length <= 400) {
        // LCS table over the differing region only.
        const n = midA.length, m = midB.length;
        const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
        for (let i = n - 1; i >= 0; i--) {
            for (let j = m - 1; j >= 0; j--) {
                dp[i][j] = midA[i] === midB[j]
                    ? dp[i + 1][j + 1] + 1
                    : Math.max(dp[i + 1][j], dp[i][j + 1]);
            }
        }
        const out: DiffLine[] = [];
        let i = 0, j = 0;
        while (i < n && j < m) {
            if (midA[i] === midB[j]) {
                out.push({ type: "same", text: midA[i] });
                i++;
                j++;
            } else if (dp[i + 1][j] >= dp[i][j + 1]) {
                out.push({ type: "removed", text: midA[i] });
                i++;
            } else {
                out.push({ type: "added", text: midB[j] });
                j++;
            }
        }
        while (i < n) out.push({ type: "removed", text: midA[i++] });
        while (j < m) out.push({ type: "added", text: midB[j++] });
        mid = out;
    } else {
        // Very large differing region — index alignment beats a huge table.
        const maxLen = Math.max(midA.length, midB.length);
        const out: DiffLine[] = [];
        for (let k = 0; k < maxLen; k++) {
            const o = midA[k], p = midB[k];
            if (o === p) out.push({ type: "same", text: o ?? "" });
            else {
                if (o !== undefined) out.push({ type: "removed", text: o });
                if (p !== undefined) out.push({ type: "added", text: p });
            }
        }
        mid = out;
    }

    return [
        ...a.slice(0, start).map(text => ({ type: "same" as const, text })),
        ...mid,
        ...a.slice(endA).map(text => ({ type: "same" as const, text })),
    ];
}

// Group repeated runtime errors by fingerprint (source + first line) so one
// noisy handler shows as "×214" instead of flooding the per-plugin buffer.
function clusterErrors(errors: RuntimeError[]): Array<{ rep: RuntimeError; count: number; lastAt: number; }> {
    const map = new Map<string, { rep: RuntimeError; count: number; lastAt: number; }>();
    for (const e of errors) {
        const key = `${e.source}\u0000${e.error.split("\n")[0]}`;
        const existing = map.get(key);
        if (existing) {
            existing.count++;
            if (e.at > existing.lastAt) existing.lastAt = e.at;
        } else {
            map.set(key, { rep: e, count: 1, lastAt: e.at });
        }
    }
    return Array.from(map.values()).sort((a, b) => b.lastAt - a.lastAt);
}

interface ModuleFinderResult {
    id: string;
    size: number;
    snippet: string;
}

// Search every loaded webpack module's source for a `find` string. Accepts a
// plain substring or a /regex/flags form (matching how patches define finds).
// Turns "module missing" failures into "the code now lives in module #N".
function searchModules(query: string): { results: ModuleFinderResult[]; searched: number; regex: boolean; } {
    const modules = wreq.m;
    const ids = Object.keys(modules);

    let matcher: (src: string) => boolean = src => src.includes(query);
    let isRegex = false;
    const regexForm = query.match(/^\/(.+)\/([a-z]*)$/s);
    if (regexForm) {
        try {
            // 'g' is stateful with .test — strip it.
            const flags = regexForm[2].replace(/g/g, "");
            const re = new RegExp(regexForm[1], flags);
            matcher = src => re.test(src);
            isRegex = true;
        } catch {
            // Invalid regex — fall back to substring matching.
        }
    }

    const results: ModuleFinderResult[] = [];
    for (const id of ids) {
        const src = String(modules[id as keyof typeof modules]);
        if (matcher(src)) {
            results.push({ id, size: src.length, snippet: src.slice(0, 300) });
            if (results.length >= 25) break;
        }
    }
    return { results, searched: ids.length, regex: isRegex };
}

function openModuleSource(id: string) {
    openModal(modalProps => (
        <Modal
            {...modalProps}
            size="lg"
            title={<div className="vc-patch-viewer-title">Module {id}</div>}
        >
            <div className="vc-patch-viewer-body">
                <pre className="vc-patch-viewer-code">{String(wreq.m[id as PropertyKey] ?? "")}</pre>
            </div>
        </Modal>
    ));
}

function getLastSeen(entry: PluginHealthEntry): number {
    let latest = 0;
    for (const f of entry.patchFailures) if (f.at > latest) latest = f.at;
    for (const e of entry.runtimeErrors) if (e.at > latest) latest = e.at;
    return latest;
}

function sortSnapshot(
    entries: Array<[string, PluginHealthEntry]>,
    sort: SortKey
): Array<[string, PluginHealthEntry]> {
    const arr = [...entries];
    switch (sort) {
        case "name":
            arr.sort((a, b) => a[0].localeCompare(b[0]));
            break;
        case "stability":
            arr.sort((a, b) => {
                const sa = PluginHealth.getStability(a[0]);
                const sb = PluginHealth.getStability(b[0]);
                return STABILITY_RANK[sa.badge] - STABILITY_RANK[sb.badge];
            });
            break;
        case "recent":
            arr.sort((a, b) => getLastSeen(b[1]) - getLastSeen(a[1]));
            break;
        case "errors":
        default:
            arr.sort((a, b) => {
                const ae = a[1].runtimeErrors.length + a[1].patchFailures.length;
                const be = b[1].runtimeErrors.length + b[1].patchFailures.length;
                if (ae !== be) return be - ae;
                return a[0].localeCompare(b[0]);
            });
            break;
    }
    return arr;
}

// Single source of truth for impact-score badge severity. Thresholds live here
// so the diagnostics table, impact list, and per-plugin monitor can never drift.
function impactBadgeClass(score: number): string {
    if (score > 50) return "high";
    if (score > 15) return "medium";
    return "low";
}

function buildExportReport(excludeConflicts = false, excludeSourceChanges = false): string {
    const all = PluginHealth.getAll();
    const currentSession = PluginHealth.getCurrentSession();
    const history = PluginHealth.getHistory();
    const profiles = PluginProfiler.getAllProfiles();

    const report: Record<string, unknown> = {
        schemaVersion: 2,
        exportedAt: new Date().toISOString(),
        testcordBuild: { version: VERSION, builtAt: BUILD_TIMESTAMP },
        discordBuild: {
            number: getBuildNumber(),
            id: window.GLOBAL_ENV.SENTRY_TAGS.buildId,
            channel: window.GLOBAL_ENV.RELEASE_CHANNEL
        },
        redaction: {
            applied: true,
            fields: ["tokens", "message content", "user IDs", "URLs", "headers", "absolute paths"]
        },
        currentSession,
        sessionHistory: [...history],
        profiles,
        safeMode: PluginHealth.isSafeModeEnabled(),
        quarantinedPlugins: PluginHealth.getQuarantinedPlugins(),
        conflictsExcluded: excludeConflicts,
        sourceChangesExcluded: excludeSourceChanges,
        plugins: {} as Record<string, unknown>
    };
    for (const [name, entry] of all) {
        const patchFailures = entry.patchFailures.filter(f => {
            if (excludeConflicts && f.kind === "conflict") return false;
            if (excludeSourceChanges && f.kind === "codeChanged") return false;
            return true;
        });
        (report.plugins as Record<string, unknown>)[name] = {
            ...entry,
            patchFailures,
            stability: PluginHealth.getStability(name)
        };
    }
    return JSON.stringify(redactDiagnosticValue(report), null, 2);
}

function downloadExport(excludeConflicts = false, excludeSourceChanges = false) {
    try {
        const json = buildExportReport(excludeConflicts, excludeSourceChanges);
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `vencord-health-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        Toasts.show({
            id: Toasts.genId(),
            type: Toasts.Type.SUCCESS,
            message: "Health report exported",
            options: { position: Toasts.Position.TOP }
        });
    } catch (e) {
        Toasts.show({
            id: Toasts.genId(),
            type: Toasts.Type.FAILURE,
            message: "Failed to export report",
            options: { position: Toasts.Position.TOP }
        });
        console.error(e);
    }
}

function openPatchViewer(pluginName: string, failure: PatchFailure) {
    openModal(modalProps => (
        <PatchViewerModal
            {...modalProps}
            pluginName={pluginName}
            failure={failure}
        />
    ));
}

function PatchViewerModal({
    transitionState,
    onClose,
    pluginName,
    failure
}: RenderModalProps & { pluginName: string; failure: PatchFailure; }) {
    const [showOriginal, setShowOriginal] = useState(false);

    const { originalSource, patchedSource } = useMemo(() => {
        let original = "";
        let patched = "";
        try {
            if (failure.moduleId) {
                const modId = failure.moduleId as PropertyKey;
                patched = getFactoryPatchedSource(modId) ?? "";
                const factory = wreq.m[modId];
                if (factory) {
                    const orig = (factory as any)[SYM_ORIGINAL_FACTORY];
                    if (orig) original = String(orig);
                    else original = String(factory);
                }
            }
        } catch {
            // Best-effort
        }
        return { originalSource: original, patchedSource: patched };
    }, [failure.moduleId]);

    const diffLines = useMemo(() => {
        if (!originalSource || !patchedSource) return null;
        return diffSources(originalSource, patchedSource);
    }, [originalSource, patchedSource]);

    return (
        <Modal
            transitionState={transitionState}
            onClose={onClose}
            size="lg"
            title={
                <div className="vc-patch-viewer-title">
                    Patch viewer: {pluginName}
                </div>
            }
        >
            <div className="vc-patch-viewer-body">
                <div className="vc-patch-viewer-meta">
                    <div><strong>Kind</strong> <span className="vc-plugin-health-kind" data-kind={failure.kind}>{KIND_LABEL[failure.kind] ?? failure.kind}</span></div>
                    <div><strong>Find</strong> <code>{truncateForDisplay(failure.find, 200)}</code></div>
                    {failure.match && <div><strong>Match</strong> <code>{truncateForDisplay(failure.match, 200)}</code></div>}
                    {failure.moduleId && <div><strong>Module ID</strong> <code>{failure.moduleId}</code></div>}
                    {failure.error && <div><strong>Error</strong> <ExpandableError text={failure.error} /></div>}
                    <div className="vc-plugin-health-timestamp">{formatRelative(failure.at)}</div>
                </div>

                {(originalSource || patchedSource) && (
                    <div className="vc-patch-viewer-sources">
                        <div className="vc-patch-viewer-tabs">
                            <button
                                className={`vc-patch-viewer-tab${!showOriginal ? " vc-patch-viewer-tab-active" : ""}`}
                                onClick={() => setShowOriginal(false)}
                            >
                                Diff
                            </button>
                            <button
                                className={`vc-patch-viewer-tab${showOriginal ? " vc-patch-viewer-tab-active" : ""}`}
                                onClick={() => setShowOriginal(true)}
                            >
                                Raw source
                            </button>
                        </div>
                        {showOriginal ? (
                            <div className="vc-patch-viewer-raw">
                                <div className="vc-patch-viewer-raw-section">
                                    <HeadingSecondary className={Margins.bottom4}>Original</HeadingSecondary>
                                    <pre className="vc-patch-viewer-code">{originalSource || "(unavailable)"}</pre>
                                </div>
                                <div className="vc-patch-viewer-raw-section">
                                    <HeadingSecondary className={Margins.bottom4}>Patched</HeadingSecondary>
                                    <pre className="vc-patch-viewer-code">{patchedSource || "(unavailable)"}</pre>
                                </div>
                            </div>
                        ) : (
                            <div className="vc-patch-viewer-diff">
                                {diffLines ? (
                                    <pre className="vc-patch-viewer-code vc-patch-viewer-diff-code">
                                        {diffLines.map((line, i) => (
                                            <span
                                                key={i}
                                                className={`vc-patch-viewer-diff-line vc-patch-viewer-diff-${line.type}`}
                                            >
                                                {line.type === "added" ? "+ " : line.type === "removed" ? "- " : "  "}
                                                {line.text}
                                                {"\n"}
                                            </span>
                                        ))}
                                    </pre>
                                ) : (
                                    <Paragraph color="text-subtle">
                                        Source comparison unavailable. The module may have been unloaded.
                                    </Paragraph>
                                )}
                            </div>
                        )}
                    </div>
                )}

                <div className="vc-patch-viewer-footer">
                    <Button size="small" variant="primary" onClick={onClose}>
                        Close
                    </Button>
                </div>
            </div>
        </Modal>
    );
}

function StabilityBadge({ score }: { score: StabilityScore; }) {
    const { badge, sessionsSeen, sessionsBroken, ratio } = score;
    const tooltip =
        badge === "unknown"
            ? `Seen in ${sessionsSeen} recorded session${sessionsSeen === 1 ? "" : "s"}. Needs at least 3 to score.`
            : `Broken in ${sessionsBroken} of the last ${sessionsSeen} sessions (${(ratio * 100).toFixed(0)}%).`;
    return (
        <span
            className="vc-plugin-health-stability"
            data-badge={badge}
            title={tooltip}
        >
            {BADGE_LABEL[badge]}
        </span>
    );
}

function ExpandableError({ text, max = 400 }: { text: string; max?: number; }) {
    const [expanded, setExpanded] = useState(false);
    const isTruncated = text.length > max;
    return (
        <pre
            className="vc-plugin-health-error"
            onClick={isTruncated ? () => setExpanded(e => !e) : undefined}
            data-clickable={isTruncated || undefined}
            title={isTruncated ? (expanded ? "Click to collapse" : "Click to expand") : undefined}
        >
            {expanded ? text : truncateForDisplay(text, max)}
        </pre>
    );
}

function PluginHealthCard({ name, entry, expanded, onToggle, filter, conflictsHidden, ignoreSourceHealth, onLocate }: { name: string; entry: PluginHealthEntry; expanded: boolean; onToggle: () => void; filter: FilterKey; conflictsHidden: boolean; ignoreSourceHealth: boolean; onLocate?: (find: string) => void; }) {
    const plugin = Plugins[name];
    const showPatchFailures = filter !== "runtime";
    const showRuntimeErrors = filter === "all" || filter === "runtime";
    const visiblePatchFailures = showPatchFailures
        ? entry.patchFailures.filter(f => filter === "all" || f.kind === filter)
        : [];
    const visibleRuntimeErrors = showRuntimeErrors ? entry.runtimeErrors : [];
    const patchCount = visiblePatchFailures.length;
    const errorCount = visibleRuntimeErrors.length;
    const stability = PluginHealth.getStability(name);
    const [dismissing, setDismissing] = useState(false);

    const openReport = () => {
        try {
            const body = generateGitHubIssueBody({ pluginName: name, excludeConflicts: conflictsHidden, excludeSourceChanges: ignoreSourceHealth });
            const url = buildIssueUrl(`[${name}] Bug report`, body, ["bug"]);
            VencordNative.native.openExternal(url);
        } catch (e) {
            Toasts.show({
                id: Toasts.genId(),
                type: Toasts.Type.FAILURE,
                message: "Failed to build issue URL. See console for details.",
                options: { position: Toasts.Position.TOP }
            });
            console.error(e);
        }
    };

    const copyReport = async () => {
        try {
            const body = generateGitHubIssueBody({ pluginName: name, excludeConflicts: conflictsHidden, excludeSourceChanges: ignoreSourceHealth });
            await navigator.clipboard.writeText(body);
            Toasts.show({
                id: Toasts.genId(),
                type: Toasts.Type.SUCCESS,
                message: "Report copied to clipboard",
                options: { position: Toasts.Position.TOP }
            });
        } catch (e) {
            Toasts.show({
                id: Toasts.genId(),
                type: Toasts.Type.FAILURE,
                message: "Failed to copy report",
                options: { position: Toasts.Position.TOP }
            });
            console.error(e);
        }
    };

    const handleDismiss = () => {
        setDismissing(true);
        setTimeout(() => dismissEntry(name, filter, conflictsHidden, ignoreSourceHealth), 250);
    };

    return (
        <Card className={`vc-plugin-health-card${dismissing ? " vc-plugin-health-card-dismissing" : ""}`}>
            <div
                className="vc-plugin-health-card-header"
                onClick={() => onToggle()}
                role="button"
                tabIndex={0}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") onToggle(); }}
            >
                <div className="vc-plugin-health-card-title-row">
                    <span className={`vc-plugin-health-chevron${expanded ? " vc-plugin-health-chevron-open" : ""}`}>▸</span>
                    <div>
                        <div className="vc-plugin-health-card-title">
                            <HeadingSecondary>{name}</HeadingSecondary>
                            <StabilityBadge score={stability} />
                        </div>
                        <Paragraph color="text-subtle">
                            {patchCount > 0 && `${patchCount} patch issue${patchCount === 1 ? "" : "s"}`}
                            {patchCount > 0 && errorCount > 0 && " • "}
                            {errorCount > 0 && `${errorCount} runtime error${errorCount === 1 ? "" : "s"}`}
                        </Paragraph>
                    </div>
                </div>
                <div className="vc-plugin-health-card-actions" onClick={e => e.stopPropagation()}>
                    {plugin && (
                        <Button size="small" variant="secondary" onClick={() => openPluginModal(plugin)}>
                            Open
                        </Button>
                    )}
                    <Button size="small" variant="secondary" onClick={copyReport}>
                        Copy
                    </Button>
                    <Button size="small" variant="primary" onClick={openReport}>
                        Report
                    </Button>
                    <Button size="small" variant="link" onClick={handleDismiss}>
                        Dismiss
                    </Button>
                </div>
            </div>

            {expanded && (
                <div className="vc-plugin-health-card-body">
                    {patchCount > 0 && (
                        <>
                            <Heading className="vc-plugin-health-section-heading">Patch failures</Heading>
                            {visiblePatchFailures.some(f => f.kind === "noModule") && (
                                <Paragraph color="text-subtle" className="vc-plugin-health-no-module-note">
                                    {NO_MODULE_DISCLAIMER}
                                </Paragraph>
                            )}
                            <ul className="vc-plugin-health-list">
                                {visiblePatchFailures.map((f, i) => (
                                    <li key={i}>
                                        <div className="vc-plugin-health-kind" data-kind={f.kind}>{KIND_LABEL[f.kind] ?? f.kind}</div>
                                        <div className="vc-plugin-health-detail">
                                            <div><strong>find</strong> <code>{truncateForDisplay(f.find)}</code></div>
                                            {f.match && (
                                                <div><strong>match</strong> <code>{truncateForDisplay(f.match)}</code></div>
                                            )}
                                            {f.moduleId && (
                                                <div><strong>module</strong> <code>{f.moduleId}</code></div>
                                            )}
                                            {f.error && (
                                                <ExpandableError text={f.error} />
                                            )}
                                            <div className="vc-plugin-health-timestamp">{formatRelative(f.at)}</div>
                                            {(f.moduleId || (f.kind === "noModule" && onLocate)) && (
                                                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                                                    {f.moduleId && (
                                                        <Button
                                                            size="min"
                                                            variant="secondary"
                                                            onClick={() => openPatchViewer(name, f)}
                                                        >
                                                            View patch
                                                        </Button>
                                                    )}
                                                    {f.kind === "noModule" && onLocate && (
                                                        <Button
                                                            size="min"
                                                            variant="secondary"
                                                            onClick={() => onLocate(f.find)}
                                                        >
                                                            Find module
                                                        </Button>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}

                    {errorCount > 0 && (
                        <>
                            <Heading className="vc-plugin-health-section-heading">Runtime errors</Heading>
                            <ul className="vc-plugin-health-list">
                                {clusterErrors(visibleRuntimeErrors).map((cluster, i) => (
                                    <li key={i}>
                                        <div className="vc-plugin-health-kind" data-kind="error">
                                            {cluster.rep.source}
                                            {cluster.count > 1 && (
                                                <span className="vc-plugin-health-cluster-count">×{cluster.count}</span>
                                            )}
                                        </div>
                                        <div className="vc-plugin-health-detail">
                                            <ExpandableError text={cluster.rep.error} />
                                            <div className="vc-plugin-health-timestamp">
                                                {cluster.count > 1
                                                    ? `last of ${cluster.count} · ${formatRelative(cluster.lastAt)}`
                                                    : formatRelative(cluster.rep.at)}
                                            </div>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}
                </div>
            )}
        </Card>
    );
}

function HealthSummaryBar({ total, broken }: { total: number; broken: number; }) {
    const healthy = Math.max(0, total - broken);
    const pct = total === 0 ? 100 : Math.round((healthy / total) * 100);
    const color = pct === 100 ? "positive" : pct >= 75 ? "idle" : "danger";
    return (
        <div className="vc-plugin-health-summary" data-color={color}>
            <div className="vc-plugin-health-summary-label">
                <span>{healthy} / {total} plugins healthy</span>
                <span className="vc-plugin-health-summary-pct">{pct}%</span>
            </div>
            <div className="vc-plugin-health-summary-track">
                <div
                    className="vc-plugin-health-summary-fill"
                    style={{ width: `${pct}%` }}
                />
            </div>
        </div>
    );
}

function SessionRow({ session, isCurrent, ignoreSourceHistory }: { session: SessionRecord; isCurrent: boolean; ignoreSourceHistory: boolean; }) {
    const brokenNames = Object.entries(session.plugins || {})
        .filter(([, counts]) => {
            const hasPatch = counts.patchFailures > 0;
            const hasRuntime = counts.runtimeErrors > 0;
            const hasSource = !ignoreSourceHistory && (counts.sourceChanges ?? 0) > 0;
            return hasPatch || hasRuntime || hasSource;
        })
        .map(([name]) => name)
        .sort();
    const [expanded, setExpanded] = useState(false);
    const hasBroken = brokenNames.length > 0;

    return (
        <li>
            <div
                className="vc-plugin-health-session-meta"
                onClick={hasBroken ? () => setExpanded(e => !e) : undefined}
                role={hasBroken ? "button" : undefined}
                tabIndex={hasBroken ? 0 : undefined}
            >
                <div>
                    {hasBroken && (
                        <span className={`vc-plugin-health-chevron vc-plugin-health-chevron-sm${expanded ? " vc-plugin-health-chevron-open" : ""}`}>▸</span>
                    )}
                    <strong>{new Date(session.startedAt).toLocaleString()}</strong>
                    {isCurrent && <span className="vc-plugin-health-session-current"> (current)</span>}
                </div>
                <div className="vc-plugin-health-session-counts">
                    {session.enabledPlugins?.length || 0} plugin{(session.enabledPlugins?.length || 0) === 1 ? "" : "s"} enabled
                    {" · "}
                    {hasBroken
                        ? `${brokenNames.length} broken`
                        : "no failures"}
                </div>
            </div>
            {hasBroken && expanded && (
                <div className="vc-plugin-health-session-broken">
                    {brokenNames.map(name => {
                        const counts = session.plugins[name];
                        const detail = [
                            counts.patchFailures > 0 && `${counts.patchFailures} patch`,
                            counts.runtimeErrors > 0 && `${counts.runtimeErrors} runtime`,
                            !ignoreSourceHistory && (counts.sourceChanges ?? 0) > 0 && `${counts.sourceChanges} source change${counts.sourceChanges === 1 ? "" : "s"}`
                        ].filter(Boolean).join(", ");
                        return (
                            <span key={name} className="vc-plugin-health-session-broken-item" title={detail}>
                                {name}
                            </span>
                        );
                    })}
                </div>
            )}
        </li>
    );
}

function SessionHistoryPanel({ ignoreSourceHistory }: { ignoreSourceHistory: boolean; }) {
    const [tick, setTick] = useState(0);
    useEffect(() => {
        void PluginHealth.loadHistory();
    }, []);
    useEffect(() => PluginHealth.subscribe(() => setTick(t => t + 1)), []);

    const sessions = useMemo(() => {
        const past = [...PluginHealth.getHistory()];
        const current = PluginHealth.getCurrentSession();
        const withoutDupe = past.filter(s => s.id !== current.id).reverse();
        return [current, ...withoutDupe];
    }, [tick]);

    if (sessions.length === 0) return null;

    return (
        <Card className="vc-plugin-health-history">
            <div className="vc-plugin-health-history-header">
                <HeadingSecondary>Session history</HeadingSecondary>
                <Button
                    size="small"
                    variant="link"
                    onClick={async () => {
                        await PluginHealth.clearHistory();
                        Toasts.show({
                            id: Toasts.genId(),
                            type: Toasts.Type.SUCCESS,
                            message: "Session history cleared. Stability badges and install score reset to 100.",
                            options: { position: Toasts.Position.TOP }
                        });
                    }}
                >
                    Clear history
                </Button>
            </div>
            <Paragraph color="text-subtle" className={Margins.bottom8}>
                The last {sessions.length} recorded session{sessions.length === 1 ? "" : "s"}. Used to
                compute the stability badge next to each plugin.
            </Paragraph>
            <ul className="vc-plugin-health-session-list">
                {sessions.map(session => (
                    <SessionRow
                        key={session.id}
                        session={session}
                        isCurrent={session.id === PluginHealth.getCurrentSession().id}
                        ignoreSourceHistory={ignoreSourceHistory}
                    />
                ))}
            </ul>
        </Card>
    );
}

function DiscordUpdateBanner({ noModuleCount, dismissed, onDismiss }: { noModuleCount: number; dismissed: boolean; onDismiss: () => void; }) {
    if (dismissed || noModuleCount < 3) return null;
    return (
        <Card variant="warning" className="vc-plugin-health-update-banner">
            <div className="vc-plugin-health-update-banner-header">
                <HeadingSecondary>Discord may have updated</HeadingSecondary>
                <Button size="min" variant="link" onClick={onDismiss}>
                    Don't show again
                </Button>
            </div>
            <Paragraph>
                {noModuleCount} plugins can't find the code they patch. This almost always
                means a recent Discord update removed or renamed that code. Reporting the
                affected plugins helps their authors ship a fix.
            </Paragraph>
        </Card>
    );
}

function NetworkActivityPanel() {
    const [tick, setTick] = useState(0);
    const [enabled, setEnabled] = useState(NetworkMonitor.isEnabled());

    useEffect(() => {
        void NetworkMonitor.loadPreference().then(pref => {
            if (pref && !NetworkMonitor.isEnabled()) {
                NetworkMonitor.start();
                setEnabled(true);
            }
        });
    }, []);
    useEffect(() => NetworkMonitor.subscribe(() => setTick(t => t + 1)), []);

    const summaries: NetworkDomainSummary[] = useMemo(() => {
        return NetworkMonitor.getDomainSummaries();
    }, [tick]);

    const totalRequests = useMemo(() => {
        return NetworkMonitor.getRecords().length;
    }, [tick]);

    const handleToggle = () => {
        const newState = NetworkMonitor.toggle();
        setEnabled(newState);
    };

    return (
        <Card className="vc-plugin-health-network">
            <div className="vc-plugin-health-network-header">
                <HeadingSecondary>Network activity</HeadingSecondary>
                <div className="vc-plugin-health-network-actions">
                    <Button
                        size="small"
                        variant={enabled ? "dangerPrimary" : "primary"}
                        onClick={handleToggle}
                    >
                        {enabled ? "Stop monitoring" : "Start monitoring"}
                    </Button>
                    {totalRequests > 0 && (
                        <Button
                            size="small"
                            variant="link"
                            onClick={() => NetworkMonitor.clearRecords()}
                        >
                            Clear
                        </Button>
                    )}
                </div>
            </div>
            <Paragraph color="text-subtle" className={Margins.bottom8}>
                {enabled
                    ? "Monitoring fetch/XHR requests to non-Discord hosts. Plugin attribution is best-effort from stack traces."
                    : "Monitoring is off. Enable to track requests plugins make to external servers."}
            </Paragraph>
            {enabled && totalRequests === 0 && (
                <Paragraph color="text-subtle" className={Margins.top8}>
                    No external requests recorded yet.
                </Paragraph>
            )}
            {summaries.length > 0 && (
                <ul className="vc-plugin-health-network-list">
                    {summaries.map(s => (
                        <li key={s.domain}>
                            <div className="vc-plugin-health-network-domain">
                                <strong>{s.domain}</strong>
                                <span className="vc-plugin-health-network-count">{s.totalRequests} request{s.totalRequests === 1 ? "" : "s"}</span>
                            </div>
                            <div className="vc-plugin-health-network-meta">
                                {s.plugins.size > 0
                                    ? `plugins: ${[...s.plugins].join(", ")}`
                                    : "plugin: unknown"}
                                {" · "}
                                {formatRelative(s.lastAt)}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </Card>
    );
}

function CrashRecoveryPanel() {
    const [tick, setTick] = useState(0);
    useEffect(() => {
        void PluginHealth.loadCrashHistory();
        void PluginHealth.loadQuarantine();
        return PluginHealth.subscribe(() => setTick(t => t + 1));
    }, []);

    const crashes = useMemo(() => PluginHealth.getCrashHistory(), [tick]);
    const quarantined = useMemo(() => PluginHealth.getQuarantinedPlugins(), [tick]);

    if (crashes.length === 0 && quarantined.length === 0) return null;

    const lastCrashFor = (pluginName: string) =>
        crashes.find(c => c.pluginName === pluginName);

    const handleUnquarantine = (name: string) => {
        void PluginHealth.unquarantinePlugin(name).then(() => {
            Toasts.show({
                id: Toasts.genId(),
                type: Toasts.Type.SUCCESS,
                message: `${name} restored. Restart the client to start it again.`,
                options: { position: Toasts.Position.TOP }
            });
        });
    };

    return (
        <Card className="vc-plugin-health-crash-recovery">
            <div className="vc-plugin-health-history-header">
                <HeadingSecondary>Crash recovery</HeadingSecondary>
                {crashes.length > 0 && (
                    <Button
                        size="small"
                        variant="link"
                        onClick={() => { void PluginHealth.clearCrashHistory(); }}
                    >
                        Clear crash history
                    </Button>
                )}
            </div>

            {quarantined.length > 0 && (
                <>
                    <Paragraph color="text-subtle" className={Margins.bottom8}>
                        These plugins crashed three or more times within 24 hours and are kept
                        disabled at startup. Restoring one takes effect after a restart.
                    </Paragraph>
                    <ul className="vc-plugin-health-list">
                        {quarantined.map(name => {
                            const last = lastCrashFor(name);
                            return (
                                <li key={name}>
                                    <div className="vc-plugin-health-kind" data-kind="error">quarantined</div>
                                    <div className="vc-plugin-health-detail">
                                        <div><strong>{name}</strong></div>
                                        {last && (
                                            <ExpandableError text={last.stack ? `${last.reason}\n\n${last.stack}` : last.reason} />
                                        )}
                                        <div className="vc-plugin-health-timestamp">
                                            {last ? `last crash ${formatRelative(last.timestamp)}` : "no recorded crash"}
                                        </div>
                                        <Button
                                            size="min"
                                            variant="secondary"
                                            onClick={() => handleUnquarantine(name)}
                                        >
                                            Remove from quarantine
                                        </Button>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                </>
            )}

            {crashes.length > 0 && (
                <>
                    <Heading className="vc-plugin-health-section-heading">Recent crashes</Heading>
                    <ul className="vc-plugin-health-list">
                        {crashes.slice(0, 10).map((c, i) => (
                            <li key={`${c.timestamp}:${i}`}>
                                <div className="vc-plugin-health-kind" data-kind={c.pluginName ? "error" : "noModule"}>
                                    {c.pluginName ?? "unknown plugin"}
                                </div>
                                <div className="vc-plugin-health-detail">
                                    <ExpandableError text={c.stack ? `${c.reason}\n\n${c.stack}` : c.reason} />
                                    <div className="vc-plugin-health-timestamp">{formatRelative(c.timestamp)}</div>
                                </div>
                            </li>
                        ))}
                    </ul>
                </>
            )}
        </Card>
    );
}

function PluginChangesPanel() {
    const [tick, setTick] = useState(0);
    useEffect(() => PluginHealth.subscribe(() => setTick(t => t + 1)), []);

    const changes = useMemo(() => PluginHealth.getRecentPluginChanges(), [tick]);
    if (changes.length === 0) return null;

    return (
        <Card className="vc-plugin-health-changes">
            <div className="vc-plugin-health-history-header">
                <HeadingSecondary>Recent enable/disable changes</HeadingSecondary>
                <Button
                    size="small"
                    variant="link"
                    onClick={() => { void PluginHealth.clearPluginChanges(); }}
                >
                    Clear
                </Button>
            </div>
            <Paragraph color="text-subtle" className={Margins.bottom8}>
                Plugin toggles you made recently — useful when investigating why a plugin
                is (no longer) running.
            </Paragraph>
            <ul className="vc-plugin-health-session-list">
                {changes.slice(0, 10).map((c, i) => (
                    <li key={`${c.timestamp}:${i}`}>
                        <div className="vc-plugin-health-session-meta">
                            <div>
                                <strong>{c.pluginName}</strong>{" "}
                                {c.enabled ? "enabled" : "disabled"}
                            </div>
                            <div className="vc-plugin-health-session-counts">
                                {formatRelative(c.timestamp)}
                            </div>
                        </div>
                    </li>
                ))}
            </ul>
        </Card>
    );
}

function HealthTab() {
    const [activeTab, setActiveTab] = useState<DiagnosticTabKey>("overview");
    const [tick, setTick] = useState(0);

    // Original state variables
    const [searchQuery, setSearchQuery] = useState("");
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
    const [filter, setFilter] = useState<FilterKey>("all");
    const [sort, setSort] = useState<SortKey>("errors");
    const [bannerDismissed, setBannerDismissed] = useState(true);
    const [noticeDismissed, setNoticeDismissed] = useState(true);
    const [conflictsHidden, setConflictsHidden] = useState(true);
    const [ignoreSourceHealth, setIgnoreSourceHealth] = useState(PluginHealth.isIgnoreSourceHealth());
    const [ignoreSourceHistory, setIgnoreSourceHistory] = useState(PluginHealth.isIgnoreSourceHistory());

    // Diagnostic & profiling states
    const [diagSearchQuery, setDiagSearchQuery] = useState("");
    const [sortColumn, setSortColumn] = useState<keyof PluginProfileData>("impactScore");
    const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

    // Monitor tab master-list controls
    const [monitorSearchQuery, setMonitorSearchQuery] = useState("");
    const [monitorSort, setMonitorSort] = useState<"impact" | "name" | "cpu" | "calls">("impact");
    const [monitorImpactFilter, setMonitorImpactFilter] = useState<"all" | "high" | "medium" | "low">("all");

    // Module finder tab (replaces the old patch-changes tab)
    const [finderQuery, setFinderQuery] = useState("");
    const [finderState, setFinderState] = useState<{
        results: ModuleFinderResult[] | null;
        searched: number;
        regex: boolean;
        error: string | null;
    }>({ results: null, searched: 0, regex: false, error: null });

    const runFinder = (raw?: string) => {
        const q = (raw ?? finderQuery).trim();
        setFinderQuery(q);
        if (q.length < 3) {
            setFinderState({ results: null, searched: 0, regex: false, error: "Enter at least 3 characters to search." });
            return;
        }
        try {
            const { results, searched, regex } = searchModules(q);
            setFinderState({ results, searched, regex, error: null });
        } catch (e: any) {
            setFinderState({ results: null, searched: 0, regex: false, error: String(e?.message ?? e) });
        }
    };

    /** Jump to the Module finder with a broken patch's `find` pre-filled. */
    const locateInFinder = (find: string) => {
        setActiveTab("finder");
        runFinder(find);
    };

    // Clicking a header sorts by that column. Clicking the already-active
    // column toggles direction; switching to a new column resets to "desc".
    const handleSortColumn = (column: keyof PluginProfileData) => {
        if (column === sortColumn) {
            setSortDirection(d => (d === "desc" ? "asc" : "desc"));
        } else {
            setSortColumn(column);
            setSortDirection("desc");
        }
    };

    const sortIndicator = (column: keyof PluginProfileData) =>
        column === sortColumn ? (sortDirection === "desc" ? " ▼" : " ▲") : "";

    const SortableTh = ({ column, label }: { column: keyof PluginProfileData; label: string; }) => (
        <th
            onClick={() => handleSortColumn(column)}
            onKeyDown={e => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleSortColumn(column);
                }
            }}
            role="button"
            tabIndex={0}
            scope="col"
        >
            {label}{sortIndicator(column)}
        </th>
    );
    const [selectedPluginName, setSelectedPluginName] = useState<string | null>(null);
    const [safeMode, setSafeModeState] = useState(PluginHealth.isSafeModeEnabled());

    useEffect(() => {
        const unsubHealth = PluginHealth.subscribe(() => setTick(t => t + 1));
        const unsubProfiler = PluginProfiler.subscribe(() => setTick(t => t + 1));

        void PluginHealth.loadHistory();
        void PluginHealth.loadSafeMode().then(sm => setSafeModeState(sm));
        void PluginHealth.loadQuarantine();
        void PluginHealth.loadCrashHistory();
        void PluginHealth.loadPluginChanges();

        void DataStore.get<boolean>(DB_KEY_BANNER_DISMISSED).then(v => {
            setBannerDismissed(v ?? true);
        });
        void DataStore.get<boolean>(DB_KEY_NOTICE_DISMISSED).then(v => {
            setNoticeDismissed(v ?? true);
        });
        void DataStore.get<boolean>(DB_KEY_CONFLICTS_HIDDEN).then(v => {
            setConflictsHidden(v ?? true);
        });
        void PluginHealth.loadSourceSettings().then(settings => {
            setIgnoreSourceHealth(settings.ignoreHealth);
            setIgnoreSourceHistory(settings.ignoreHistory);
        });

        return () => {
            unsubHealth();
            unsubProfiler();
        };
    }, []);

    const snapshot = useMemo(() => {
        const out: Array<[string, PluginHealthEntry]> = [];
        for (const [name, rawEntry] of PluginHealth.getAll()) {
            if (Plugins[name]?.required) continue;
            let { patchFailures } = rawEntry;
            if (conflictsHidden) {
                patchFailures = patchFailures.filter(f => f.kind !== "conflict");
            }
            if (ignoreSourceHealth) {
                patchFailures = patchFailures.filter(f => f.kind !== "codeChanged");
            }
            if (!patchFailures.length && !rawEntry.runtimeErrors.length) continue;
            out.push([name, { patchFailures, runtimeErrors: rawEntry.runtimeErrors }]);
        }
        return out;
    }, [tick, conflictsHidden, ignoreSourceHealth]);

    const filtered = useMemo(() => {
        let result = snapshot;
        const q = searchQuery.trim().toLowerCase();
        if (q) result = result.filter(([name]) => name.toLowerCase().includes(q));
        if (filter !== "all") result = result.filter(([, entry]) => filterEntry(entry, filter));
        return sortSnapshot(result, sort);
    }, [snapshot, searchQuery, filter, sort]);

    const enabledSet = useMemo(() => {
        return new Set(PluginHealth.getCurrentSession().enabledPlugins.filter(name => !Plugins[name]?.required));
    }, [tick]);

    const totalEnabled = enabledSet.size;

    // Count broken plugins from the SAME population as `totalEnabled` (plugins
    // enabled this session), so the summary bar can never report more broken
    // than total. `snapshot` spans the whole runtime registry, so intersect it
    // with the current session's enabled set.
    const brokenEnabled = useMemo(() => {
        let count = 0;
        for (const [name] of snapshot) {
            if (enabledSet.has(name)) count++;
        }
        return count;
    }, [snapshot, enabledSet]);

    const noModuleCount = useMemo(() => {
        let count = 0;
        for (const [, entry] of snapshot) {
            if (entry.patchFailures.some(f => f.kind === "noModule")) count++;
        }
        return count;
    }, [snapshot]);

    const profiles = useMemo(() => PluginProfiler.getAllProfiles(), [tick]);

    const diagRows = useMemo(() => {
        const query = diagSearchQuery.toLowerCase();
        return profiles
            .filter(p => p.pluginName.toLowerCase().includes(query))
            .sort((a, b) => {
                const valA = a[sortColumn] as any;
                const valB = b[sortColumn] as any;
                if (valA < valB) return sortDirection === "asc" ? -1 : 1;
                if (valA > valB) return sortDirection === "asc" ? 1 : -1;
                return 0;
            });
    }, [profiles, diagSearchQuery, sortColumn, sortDirection]);

    const monitorRows = useMemo(() => {
        const query = monitorSearchQuery.toLowerCase();
        return profiles
            .filter(p => p.pluginName.toLowerCase().includes(query))
            .filter(p => monitorImpactFilter === "all" || impactBadgeClass(p.impactScore) === monitorImpactFilter)
            .sort((a, b) => {
                switch (monitorSort) {
                    case "name":
                        return a.pluginName.localeCompare(b.pluginName);
                    case "cpu":
                        return b.totalCpuTimeMs - a.totalCpuTimeMs;
                    case "calls":
                        return b.callCount - a.callCount;
                    case "impact":
                    default:
                        return b.impactScore - a.impactScore;
                }
            });
    }, [profiles, monitorSearchQuery, monitorImpactFilter, monitorSort]);

    // Whole-install health score: 100 minus penalties. Explainable by design —
    // the formula is shown next to the number.
    const installHealth = useMemo(() => {
        const quarantined = PluginHealth.getQuarantinedPlugins().length;
        const dayAgo = Date.now() - 86_400_000;
        const crashesDay = PluginHealth.getCrashHistory().filter(c => c.timestamp >= dayAgo).length;
        let unstable = 0, flaky = 0;
        const unstablePlugins: string[] = [];
        const flakyPlugins: string[] = [];
        for (const name of enabledSet) {
            const { badge } = PluginHealth.getStability(name);
            if (badge === "unstable") {
                unstable++;
                unstablePlugins.push(name);
            } else if (badge === "flaky") {
                flaky++;
                flakyPlugins.push(name);
            }
        }
        const score = Math.max(0, Math.min(100,
            100 - unstable * 8 - flaky * 3 - quarantined * 10 - Math.min(crashesDay * 5, 25)
        ));
        const rating = score >= 90 ? "healthy" : score >= 70 ? "fair" : score >= 40 ? "degraded" : "poor";
        return { score, rating, unstable, flaky, quarantined, crashesDay, unstablePlugins, flakyPlugins };
    }, [tick, enabledSet, ignoreSourceHistory]);

    // Startup timeline from PluginManager's per-plugin start measurements.
    const startTimings = useMemo(() => {
        const entries = Array.from(pluginStartTimings.entries(), ([name, t]) => ({ name, ...t }));
        const total = entries.reduce((acc, e) => acc + e.duration, 0);
        const slowest = [...entries].sort((a, b) => b.duration - a.duration).slice(0, 10);
        const failed = entries.filter(e => !e.success).length;
        const max = slowest[0]?.duration ?? 0;
        return { total, slowest, failed, measured: entries.length, max };
    }, [tick]);

    // "What changed since the last healthy session?" — diffs the enabled
    // plugin set and newly-broken plugins against the most recent session
    // that recorded no failures.
    const sinceHealthy = useMemo(() => {
        const past = PluginHealth.getHistory();
        const lastHealthy = [...past].reverse().find(s =>
            !Object.values(s.plugins ?? {}).some(c => {
                const source = !ignoreSourceHistory ? (c.sourceChanges ?? 0) : 0;
                return (c.patchFailures + c.runtimeErrors + source) > 0;
            })
        );
        if (!lastHealthy) return null;
        // Session records include required (always-on) plugins; the current
        // enabled set excludes them. Filter both sides the same way so core
        // plugins never show up as "removed", and uninstalled user plugins
        // (no Plugins entry) still correctly do.
        const then = new Set(
            (lastHealthy.enabledPlugins ?? []).filter(n => !Plugins[n]?.required)
        );
        const brokenNow = new Set(snapshot.map(([n]) => n));
        const added = Array.from(enabledSet).filter(n => !then.has(n)).sort();
        const removed = Array.from(then).filter(n => !enabledSet.has(n)).sort();
        const newlyBroken = Array.from(brokenNow)
            .filter(n => enabledSet.has(n) && !lastHealthy.plugins?.[n])
            .sort();
        if (!added.length && !removed.length && !newlyBroken.length) return null;
        return { at: lastHealthy.startedAt, added, removed, newlyBroken };
    }, [tick, enabledSet, snapshot, ignoreSourceHistory]);

    const handleBannerToggle = (show: boolean) => {
        setBannerDismissed(!show);
        void DataStore.set(DB_KEY_BANNER_DISMISSED, !show);
    };

    const handleNoticeToggle = (show: boolean) => {
        setNoticeDismissed(!show);
        void DataStore.set(DB_KEY_NOTICE_DISMISSED, !show);
    };

    const handleConflictsToggle = (show: boolean) => {
        setConflictsHidden(!show);
        void DataStore.set(DB_KEY_CONFLICTS_HIDDEN, !show);
    };

    const handleIgnoreSourceHealthToggle = async (ignore: boolean) => {
        setIgnoreSourceHealth(ignore);
        await PluginHealth.setIgnoreSourceHealth(ignore);
    };

    const handleIgnoreSourceHistoryToggle = async (ignore: boolean) => {
        setIgnoreSourceHistory(ignore);
        await PluginHealth.setIgnoreSourceHistory(ignore);
    };

    const handleToggleSafeMode = async (enabled: boolean) => {
        setSafeModeState(enabled);
        await PluginHealth.setSafeMode(enabled);
        Toasts.show({
            id: Toasts.genId(),
            type: Toasts.Type.SUCCESS,
            message: enabled ? "Safe Mode enabled. Restart client to apply." : "Safe Mode disabled.",
            options: { position: Toasts.Position.TOP }
        });
    };

    const toggleCard = (name: string) => {
        setCollapsed(prev => {
            const next = new Set(prev);
            if (next.has(name)) next.delete(name);
            else next.add(name);
            return next;
        });
    };

    const handleExpandAll = () => setCollapsed(new Set());
    const handleCollapseAll = () => setCollapsed(new Set(filtered.map(([n]) => n)));

    const dismissAll = () => {
        for (const [name] of filtered) {
            dismissEntry(name, filter, conflictsHidden, ignoreSourceHealth);
        }
        Toasts.show({
            id: Toasts.genId(),
            type: Toasts.Type.SUCCESS,
            message: "Dismissed filtered entries",
            options: { position: Toasts.Position.TOP }
        });
    };

    const copyAllReports = async () => {
        try {
            const json = buildExportReport(conflictsHidden, ignoreSourceHealth);
            await navigator.clipboard.writeText(json);
            Toasts.show({
                id: Toasts.genId(),
                type: Toasts.Type.SUCCESS,
                message: "Full health report copied to clipboard",
                options: { position: Toasts.Position.TOP }
            });
        } catch (e) {
            Toasts.show({
                id: Toasts.genId(),
                type: Toasts.Type.FAILURE,
                message: "Failed to copy report",
                options: { position: Toasts.Position.TOP }
            });
            console.error(e);
        }
    };

    // Diagnostics stats
    const totalHeapMB = (performance as any).memory?.usedJSHeapSize
        ? Math.round(((performance as any).memory.usedJSHeapSize / (1024 * 1024)) * 10) / 10
        : 0;
    const totalCpuTimeMs = profiles.reduce((acc, p) => acc + p.totalCpuTimeMs, 0);
    const totalActiveResources = profiles.reduce((acc, p) => acc + p.activeResources, 0);

    const currentPluginProfile = useMemo(() => {
        if (!selectedPluginName && profiles.length > 0) {
            return profiles[0];
        }
        return profiles.find(p => p.pluginName === selectedPluginName) || profiles[0];
    }, [profiles, selectedPluginName]);

    const allCollapsed = useMemo(() => {
        return filtered.length > 0 && filtered.every(([name]) => collapsed.has(name));
    }, [filtered, collapsed]);

    return (
        <SettingsTab>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
                <div>
                    <Heading>Plugin health & Diagnostics</Heading>
                    <Paragraph color="text-subtle" className={Margins.bottom8}>
                        Tracks patch failures, runtime exceptions, memory footprint, Flux event overhead, and performance diagnostics.
                    </Paragraph>
                </div>
                <Button
                    size="small"
                    variant="primary"
                    onClick={copyAllReports}
                >
                    Copy full report
                </Button>
            </div>

            {/* Native Sub-Navigation Header */}
            <div className="vc-health-nav">
                <button
                    className={`vc-health-nav-item ${activeTab === "overview" ? "vc-health-nav-item-active" : ""}`}
                    onClick={() => setActiveTab("overview")}
                >
                    Overview
                </button>
                <button
                    className={`vc-health-nav-item ${activeTab === "diagnostics" ? "vc-health-nav-item-active" : ""}`}
                    onClick={() => setActiveTab("diagnostics")}
                >
                    Client Diagnostics
                </button>
                <button
                    className={`vc-health-nav-item ${activeTab === "impact" ? "vc-health-nav-item-active" : ""}`}
                    onClick={() => setActiveTab("impact")}
                >
                    Impact analysis
                </button>
                <button
                    className={`vc-health-nav-item ${activeTab === "monitor" ? "vc-health-nav-item-active" : ""}`}
                    onClick={() => setActiveTab("monitor")}
                >
                    Plugin monitor
                </button>
                <button
                    className={`vc-health-nav-item ${activeTab === "finder" ? "vc-health-nav-item-active" : ""}`}
                    onClick={() => setActiveTab("finder")}
                >
                    Module finder
                </button>
                <button
                    className={`vc-health-nav-item ${activeTab === "guide" ? "vc-health-nav-item-active" : ""}`}
                    onClick={() => setActiveTab("guide")}
                >
                    Guide
                </button>
            </div>

            {/* TAB 1: OVERVIEW (Complete Original Plugin Health UI + Diagnostics Integration) */}
            {activeTab === "overview" && (
                <div className="vc-health-tab-content">
                    <Paragraph color="text-subtle" className={Margins.bottom20}>
                        Discord's frequent updates can break individual plugins. If a plugin here
                        looks broken, click <em>Report</em> to open a pre-filled bug report on <Link href="https://github.com/TestcordDev/TestCord/issues">GitHub</Link>.
                    </Paragraph>

                    <DiscordUpdateBanner
                        noModuleCount={noModuleCount}
                        dismissed={bannerDismissed}
                        onDismiss={() => handleBannerToggle(false)}
                    />

                    {/* Install health score */}
                    <Card className="vc-plugin-health-score" defaultPadding>
                        <div className="vc-plugin-health-score-value" data-rating={installHealth.rating}>
                            {installHealth.score}
                        </div>
                        <div className="vc-plugin-health-score-body">
                            <HeadingSecondary className={Margins.bottom4}>Install health: {installHealth.rating}</HeadingSecondary>
                            <div className="vc-plugin-health-score-breakdown">
                                <span><strong>{installHealth.unstable}</strong> unstable · <strong>{installHealth.flaky}</strong> flaky (of {totalEnabled} enabled)</span>
                                <span><strong>{installHealth.quarantined}</strong> quarantined · <strong>{installHealth.crashesDay}</strong> crashes in the last 24h</span>
                                <span className="vc-plugin-health-score-formula">
                                    100 − 8/unstable − 3/flaky − 10/quarantined − 5/recent crash (max 25)
                                </span>
                                {(installHealth.unstablePlugins.length > 0 || installHealth.flakyPlugins.length > 0) && (
                                    <span style={{ marginTop: "0.25rem", color: "var(--text-muted)", display: "block" }}>
                                        Past session issues: {[
                                            ...installHealth.unstablePlugins.map(p => `${p} (unstable)`),
                                            ...installHealth.flakyPlugins.map(p => `${p} (flaky)`)
                                        ].join(", ")}
                                    </span>
                                )}
                            </div>
                        </div>
                        <UptimeClock />
                    </Card>

                    {/* Notice & System Settings Card */}
                    <Card className="vc-plugin-health-notice-settings">
                        <div className="vc-plugin-health-notice-settings-row">
                            <div>
                                <HeadingSecondary>Safe Mode Boot Flag</HeadingSecondary>
                                <Paragraph color="text-subtle">
                                    Start client with non-essential plugins disabled to isolate crash issues.
                                </Paragraph>
                            </div>
                            <label className="vc-plugin-health-toggle">
                                <input
                                    type="checkbox"
                                    checked={safeMode}
                                    onChange={e => handleToggleSafeMode(e.target.checked)}
                                />
                                <span className="vc-plugin-health-toggle-slider" />
                            </label>
                        </div>
                        <div className="vc-plugin-health-notice-settings-divider" />
                        <div className="vc-plugin-health-notice-settings-row">
                            <div>
                                <HeadingSecondary>In-app update notice</HeadingSecondary>
                                <Paragraph color="text-subtle">
                                    Show the banner at the top of Discord when 3+ plugins have missing modules after a Discord update.
                                </Paragraph>
                            </div>
                            <label className="vc-plugin-health-toggle">
                                <input
                                    type="checkbox"
                                    checked={!noticeDismissed}
                                    onChange={e => handleNoticeToggle(e.target.checked)}
                                />
                                <span className="vc-plugin-health-toggle-slider" />
                            </label>
                        </div>
                        <div className="vc-plugin-health-notice-settings-divider" />
                        <div className="vc-plugin-health-notice-settings-row">
                            <div>
                                <HeadingSecondary>Show conflicts</HeadingSecondary>
                                <Paragraph color="text-subtle">
                                    Show patch conflicts, where multiple plugins patch the same module. A conflict doesn't necessarily mean a plugin is broken; plugins often patch the same code on purpose.
                                </Paragraph>
                            </div>
                            <label className="vc-plugin-health-toggle">
                                <input
                                    type="checkbox"
                                    checked={!conflictsHidden}
                                    onChange={e => handleConflictsToggle(e.target.checked)}
                                />
                                <span className="vc-plugin-health-toggle-slider" />
                            </label>
                        </div>
                        <div className="vc-plugin-health-notice-settings-divider" />
                        <div className="vc-plugin-health-notice-settings-row">
                            <div>
                                <HeadingSecondary>Ignore source changes in health</HeadingSecondary>
                                <Paragraph color="text-subtle">
                                    Do not count Discord module source code changes as patch failures or mark plugins as broken in current session health.
                                </Paragraph>
                            </div>
                            <label className="vc-plugin-health-toggle">
                                <input
                                    type="checkbox"
                                    checked={ignoreSourceHealth}
                                    onChange={e => handleIgnoreSourceHealthToggle(e.target.checked)}
                                />
                                <span className="vc-plugin-health-toggle-slider" />
                            </label>
                        </div>
                        <div className="vc-plugin-health-notice-settings-divider" />
                        <div className="vc-plugin-health-notice-settings-row">
                            <div>
                                <HeadingSecondary>Ignore source changes in past history</HeadingSecondary>
                                <Paragraph color="text-subtle">
                                    Do not count Discord module source code changes as broken sessions in past history or penalize plugin stability scores.
                                </Paragraph>
                            </div>
                            <label className="vc-plugin-health-toggle">
                                <input
                                    type="checkbox"
                                    checked={ignoreSourceHistory}
                                    onChange={e => handleIgnoreSourceHistoryToggle(e.target.checked)}
                                />
                                <span className="vc-plugin-health-toggle-slider" />
                            </label>
                        </div>
                        <div className="vc-plugin-health-notice-settings-divider" />
                        <div className="vc-plugin-health-notice-settings-row">
                            <div>
                                <HeadingSecondary>In-tab update banner</HeadingSecondary>
                                <Paragraph color="text-subtle">
                                    Show the warning banner at the top of this tab when 3+ plugins have missing modules.
                                </Paragraph>
                            </div>
                            <label className="vc-plugin-health-toggle">
                                <input
                                    type="checkbox"
                                    checked={!bannerDismissed}
                                    onChange={e => handleBannerToggle(e.target.checked)}
                                />
                                <span className="vc-plugin-health-toggle-slider" />
                            </label>
                        </div>
                    </Card>

                    <HealthSummaryBar total={totalEnabled} broken={brokenEnabled} />

                    <Divider className={Margins.top16 + " " + Margins.bottom16} />

                    {snapshot.length === 0 ? (
                        <Card variant="brand" className="vc-plugin-health-empty">
                            <HeadingSecondary>All plugins healthy this session</HeadingSecondary>
                            <Paragraph>
                                No patch failures or runtime errors have been recorded this session.
                            </Paragraph>
                            {(installHealth.unstablePlugins.length > 0 || installHealth.flakyPlugins.length > 0) && (
                                <div style={{ marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid rgba(255, 255, 255, 0.1)" }}>
                                    <Paragraph color="text-subtle">
                                        Install score is {installHealth.score}/100 because {installHealth.unstablePlugins.length + installHealth.flakyPlugins.length} enabled plugin(s) ({[...installHealth.unstablePlugins, ...installHealth.flakyPlugins].join(", ")}) had errors in past sessions.
                                    </Paragraph>
                                    <Button
                                        size="small"
                                        variant="secondary"
                                        className={Margins.top8}
                                        onClick={async () => {
                                            await PluginHealth.clearHistory();
                                            Toasts.show({
                                                id: Toasts.genId(),
                                                type: Toasts.Type.SUCCESS,
                                                message: "Session history cleared. Install score reset to 100.",
                                                options: { position: Toasts.Position.TOP }
                                            });
                                        }}
                                    >
                                        Reset session history
                                    </Button>
                                </div>
                            )}
                        </Card>
                    ) : (
                        <>
                            <div className="vc-plugin-health-toolbar">
                                <div className="vc-plugin-health-search">
                                    <TextInput
                                        placeholder="Search plugins…"
                                        value={searchQuery}
                                        onChange={(v: string) => setSearchQuery(v)}
                                    />
                                </div>
                                <div className="vc-plugin-health-filter-select">
                                    <Select
                                        options={FILTER_OPTIONS}
                                        closeOnSelect
                                        select={(v: FilterKey) => setFilter(v)}
                                        isSelected={(v: FilterKey) => v === filter}
                                        serialize={v => String(v)}
                                    />
                                </div>
                                <div className="vc-plugin-health-sort-select">
                                    <Select
                                        options={SORT_OPTIONS}
                                        closeOnSelect
                                        select={(v: SortKey) => setSort(v)}
                                        isSelected={(v: SortKey) => v === sort}
                                        serialize={v => String(v)}
                                    />
                                </div>
                                <div className="vc-plugin-health-toolbar-actions">
                                    <Button
                                        size="small"
                                        variant="secondary"
                                        onClick={allCollapsed ? handleExpandAll : handleCollapseAll}
                                    >
                                        {allCollapsed ? "Expand all" : "Collapse all"}
                                    </Button>
                                    <Button
                                        size="small"
                                        variant="secondary"
                                        onClick={copyAllReports}
                                    >
                                        Copy report
                                    </Button>
                                    <Button
                                        size="small"
                                        variant="secondary"
                                        onClick={() => downloadExport(conflictsHidden, ignoreSourceHealth)}
                                    >
                                        Export
                                    </Button>
                                    <Button
                                        size="small"
                                        variant="link"
                                        onClick={dismissAll}
                                    >
                                        Dismiss all
                                    </Button>
                                </div>
                            </div>

                            {filtered.length === 0 ? (
                                <Card className="vc-plugin-health-empty">
                                    <Paragraph color="text-subtle">
                                        No plugins match the current search and filter.
                                    </Paragraph>
                                </Card>
                            ) : (
                                filtered.map(([name, entry]) => (
                                    <PluginHealthCard
                                        key={name}
                                        name={name}
                                        entry={entry}
                                        expanded={!collapsed.has(name)}
                                        onToggle={() => toggleCard(name)}
                                        filter={filter}
                                        conflictsHidden={conflictsHidden}
                                        ignoreSourceHealth={ignoreSourceHealth}
                                        onLocate={locateInFinder}
                                    />
                                ))
                            )}
                        </>
                    )}

                    <Divider className={Margins.top20 + " " + Margins.bottom16} />
                    <NetworkActivityPanel />

                    {sinceHealthy && (
                        <>
                            <Divider className={Margins.top20 + " " + Margins.bottom16} />
                            <Card className="vc-plugin-health-since-healthy">
                                <HeadingSecondary>Changes since your last healthy session</HeadingSecondary>
                                <Paragraph color="text-subtle" className={Margins.bottom8}>
                                    Comparing against {new Date(sinceHealthy.at).toLocaleString()} — the most recent
                                    session with no recorded failures.
                                </Paragraph>
                                <div className="vc-plugin-health-changes-row">
                                    {sinceHealthy.added.map(n => (
                                        <span key={`a-${n}`} className="vc-plugin-health-change-chip vc-plugin-health-change-added">+ {n}</span>
                                    ))}
                                    {sinceHealthy.removed.map(n => (
                                        <span key={`r-${n}`} className="vc-plugin-health-change-chip vc-plugin-health-change-removed">− {n}</span>
                                    ))}
                                    {sinceHealthy.newlyBroken.map(n => (
                                        <span key={`b-${n}`} className="vc-plugin-health-change-chip vc-plugin-health-change-broken">⚠ {n}</span>
                                    ))}
                                </div>
                            </Card>
                        </>
                    )}

                    <Divider className={Margins.top20 + " " + Margins.bottom16} />
                    <SessionHistoryPanel ignoreSourceHistory={ignoreSourceHistory} />

                    <Divider className={Margins.top20 + " " + Margins.bottom16} />
                    <CrashRecoveryPanel />

                    <Divider className={Margins.top20 + " " + Margins.bottom16} />
                    <PluginChangesPanel />
                </div>
            )}

            {/* TAB 2: CLIENT DIAGNOSTICS */}
            {activeTab === "diagnostics" && (
                <div className="vc-health-tab-content">
                    <div className="vc-health-stats-grid">
                        <div className="vc-health-stat-card">
                            <div className="vc-health-stat-value">{totalHeapMB.toFixed(1)} MB</div>
                            <div className="vc-health-stat-label">Renderer heap (all code)</div>
                        </div>
                        <div className="vc-health-stat-card">
                            <div className="vc-health-stat-value">{profiles.length}</div>
                            <div className="vc-health-stat-label">Measured plugins</div>
                        </div>
                        <div className="vc-health-stat-card">
                            <div className="vc-health-stat-value">{totalCpuTimeMs.toFixed(1)} ms</div>
                            <div className="vc-health-stat-label">Callback time</div>
                        </div>
                        <div className="vc-health-stat-card">
                            <div className="vc-health-stat-value">{totalActiveResources}</div>
                            <div className="vc-health-stat-label">Active resources</div>
                        </div>
                        <div className="vc-health-stat-card">
                            <div className="vc-health-stat-value">{startTimings.total.toFixed(0)} ms</div>
                            <div className="vc-health-stat-label">Plugin startup time</div>
                        </div>
                    </div>

                    {!IS_DEV && (
                        <Paragraph color="text-subtle" className={Margins.bottom8}>
                            Note: interval and listener attribution only runs in development builds,
                            so the Resources column reads 0 here. CPU, calls, and slow spikes are
                            always measured.
                        </Paragraph>
                    )}

                    <div style={{ marginBottom: "1rem" }}>
                        <TextInput
                            placeholder="Filter plugins by name..."
                            value={diagSearchQuery}
                            onChange={(val: string) => setDiagSearchQuery(val)}
                        />
                    </div>

                    <div className="vc-health-table-wrapper">
                        <table className="vc-health-table">
                            <thead>
                                <tr>
                                    <SortableTh column="pluginName" label="Plugin" />
                                    <SortableTh column="impactScore" label="Impact Score" />
                                    <SortableTh column="totalCpuTimeMs" label="CPU (ms)" />
                                    <SortableTh column="callCount" label="Calls" />
                                    <SortableTh column="slowSpikes" label="Slow Spikes" />
                                    <SortableTh column="maxCallMs" label="Max Call (ms)" />
                                    <SortableTh column="activeResources" label="Resources" />
                                </tr>
                            </thead>
                            <tbody>
                                {diagRows.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="vc-health-table-empty">
                                            {profiles.length === 0
                                                ? "No plugins measured yet. Metrics appear once plugins run after startup."
                                                : `No plugins match "${diagSearchQuery}".`}
                                        </td>
                                    </tr>
                                ) : (
                                    diagRows.map(p => (
                                        <tr
                                            key={p.pluginName}
                                            className="vc-health-table-row-clickable"
                                            onClick={() => {
                                                setSelectedPluginName(p.pluginName);
                                                setActiveTab("monitor");
                                            }}
                                            role="button"
                                            tabIndex={0}
                                            onKeyDown={e => {
                                                if (e.key === "Enter" || e.key === " ") {
                                                    e.preventDefault();
                                                    setSelectedPluginName(p.pluginName);
                                                    setActiveTab("monitor");
                                                }
                                            }}
                                            title={`View ${p.pluginName} details`}
                                        >
                                            <td><strong>{p.pluginName}</strong></td>
                                            <td>
                                                <span className={`vc-health-impact-badge ${impactBadgeClass(p.impactScore)}`}>
                                                    {p.impactScore}
                                                </span>
                                            </td>
                                            <td>{p.totalCpuTimeMs} ms</td>
                                            <td>{p.callCount}</td>
                                            <td>{p.slowSpikes}</td>
                                            <td>{p.maxCallMs} ms</td>
                                            <td>{p.activeResources}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    <HeadingSecondary className={Margins.top16 + " " + Margins.bottom8}>
                        Slowest plugin startups
                    </HeadingSecondary>
                    {startTimings.measured === 0 ? (
                        <Paragraph color="text-subtle">
                            No plugin startups measured yet this session. Timings appear after a restart.
                        </Paragraph>
                    ) : (
                        <div className="vc-health-startup-list">
                            {startTimings.slowest.map(e => (
                                <div className="vc-health-startup-row" key={e.name}>
                                    <span className="vc-health-startup-name" title={e.name}>{e.name}</span>
                                    <div className="vc-health-startup-bar">
                                        <div
                                            className="vc-health-startup-fill"
                                            data-failed={e.success ? undefined : "true"}
                                            style={{ width: `${Math.max(2, (e.duration / (startTimings.max || 1)) * 100)}%` }}
                                        />
                                    </div>
                                    <span className="vc-health-startup-ms">
                                        {e.duration.toFixed(1)} ms{e.success ? "" : " · failed"}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                    {startTimings.failed > 0 && (
                        <Paragraph color="text-subtle" className={Margins.top8}>
                            {startTimings.failed} plugin{startTimings.failed === 1 ? "" : "s"} failed to start this session.
                        </Paragraph>
                    )}
                </div>
            )}

            {/* TAB 3: IMPACT ANALYSIS */}
            {activeTab === "impact" && (
                <div className="vc-health-tab-content">
                    <HeadingSecondary className={Margins.bottom16}>Ranked Lag Impact Score</HeadingSecondary>
                    {profiles
                        .sort((a, b) => b.impactScore - a.impactScore)
                        .map(p => (
                            <Card key={p.pluginName} className="vc-health-impact-card" style={{ marginBottom: "1rem" }}>
                                <div className="vc-health-impact-header">
                                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                                        <h3 style={{ margin: 0, color: "var(--text-normal)" }}>{p.pluginName}</h3>
                                        <span className={`vc-health-impact-badge ${impactBadgeClass(p.impactScore)}`}>
                                            Impact Score: {p.impactScore}
                                        </span>
                                    </div>
                                    <Button
                                        size="small"
                                        variant="secondary"
                                        onClick={() => {
                                            setSelectedPluginName(p.pluginName);
                                            setActiveTab("monitor");
                                        }}
                                    >
                                        Details
                                    </Button>
                                </div>

                                <div style={{ margin: "0.5rem 0" }}>
                                    {p.signals.map(s => (
                                        <span key={s} className="vc-health-signal-badge">
                                            {s}
                                        </span>
                                    ))}
                                </div>

                                {p.advisory && (
                                    <div className="vc-health-advisory-box">
                                        {p.advisory}
                                    </div>
                                )}
                            </Card>
                        ))}
                </div>
            )}

            {/* TAB 4: PLUGIN MONITOR */}
            {activeTab === "monitor" && (
                <div className="vc-health-tab-content">
                    {!IS_DEV && (
                        <Paragraph color="text-subtle" className={Margins.bottom8}>
                            Note: the Resources / Intervals / Listeners metrics only run in
                            development builds and read 0 here. CPU, calls, and slow spikes are
                            always measured.
                        </Paragraph>
                    )}
                    <div className="vc-health-master-detail">
                        {/* Master Left Column */}
                        <div className="vc-health-master-column">
                            <HeadingSecondary className={Margins.bottom8}>Monitored Plugins</HeadingSecondary>

                            <div className="vc-health-master-controls">
                                <TextInput
                                    placeholder="Search plugins..."
                                    value={monitorSearchQuery}
                                    onChange={(val: string) => setMonitorSearchQuery(val)}
                                />
                                <div className="vc-health-master-selects">
                                    <Select
                                        options={[
                                            { label: "Sort: Impact", value: "impact" },
                                            { label: "Sort: Name", value: "name" },
                                            { label: "Sort: CPU", value: "cpu" },
                                            { label: "Sort: Calls", value: "calls" }
                                        ]}
                                        closeOnSelect
                                        select={val => setMonitorSort(val)}
                                        isSelected={val => val === monitorSort}
                                        serialize={String}
                                    />
                                    <Select
                                        options={[
                                            { label: "Impact: All", value: "all" },
                                            { label: "Impact: High", value: "high" },
                                            { label: "Impact: Medium", value: "medium" },
                                            { label: "Impact: Low", value: "low" }
                                        ]}
                                        closeOnSelect
                                        select={val => setMonitorImpactFilter(val)}
                                        isSelected={val => val === monitorImpactFilter}
                                        serialize={String}
                                    />
                                </div>
                            </div>

                            <div className="vc-health-master-list">
                                {monitorRows.length === 0 ? (
                                    <div className="vc-health-master-empty">
                                        {profiles.length === 0
                                            ? "No plugins measured yet."
                                            : "No plugins match your filters."}
                                    </div>
                                ) : (
                                    monitorRows.map(p => (
                                        <div
                                            key={p.pluginName}
                                            className={`vc-health-master-item ${currentPluginProfile?.pluginName === p.pluginName ? "selected" : ""}`}
                                            onClick={() => setSelectedPluginName(p.pluginName)}
                                        >
                                            <span className="vc-health-master-item-name">{p.pluginName}</span>
                                            <span className={`vc-health-impact-badge ${impactBadgeClass(p.impactScore)}`}>
                                                {p.impactScore}
                                            </span>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>

                        {/* Detail Right Column */}
                        {currentPluginProfile && (
                            <div className="vc-health-detail-column">
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <h2 style={{ margin: 0, color: "var(--text-normal)" }}>{currentPluginProfile.pluginName}</h2>
                                    <span className={`vc-health-impact-badge ${impactBadgeClass(currentPluginProfile.impactScore)}`}>
                                        Impact Score: {currentPluginProfile.impactScore}
                                    </span>
                                </div>

                                <div className="vc-health-metrics-grid-8">
                                    <div className="vc-health-metric-card-sm">
                                        <div className="vc-health-metric-val">{currentPluginProfile.totalCpuTimeMs} ms</div>
                                        <div className="vc-health-metric-label">Extra CPU</div>
                                    </div>
                                    <div className="vc-health-metric-card-sm">
                                        <div className="vc-health-metric-val">
                                            {totalCpuTimeMs > 0 ? ((currentPluginProfile.totalCpuTimeMs / totalCpuTimeMs) * 100).toFixed(1) : 0}%
                                        </div>
                                        <div className="vc-health-metric-label">CPU Share</div>
                                    </div>
                                    <div className="vc-health-metric-card-sm">
                                        <div className="vc-health-metric-val">{currentPluginProfile.callCount}</div>
                                        <div className="vc-health-metric-label">Calls</div>
                                    </div>
                                    <div className="vc-health-metric-card-sm">
                                        <div className="vc-health-metric-val">{currentPluginProfile.slowSpikes}</div>
                                        <div className="vc-health-metric-label">Slow Spikes</div>
                                    </div>
                                    <div className="vc-health-metric-card-sm">
                                        <div className="vc-health-metric-val">{currentPluginProfile.maxCallMs} ms</div>
                                        <div className="vc-health-metric-label">Max Call</div>
                                    </div>
                                    <div className="vc-health-metric-card-sm">
                                        <div className="vc-health-metric-val">{currentPluginProfile.activeResources}</div>
                                        <div className="vc-health-metric-label">Resources</div>
                                    </div>
                                    <div className="vc-health-metric-card-sm">
                                        <div className="vc-health-metric-val">{currentPluginProfile.activeIntervals}</div>
                                        <div className="vc-health-metric-label">Intervals</div>
                                    </div>
                                    <div className="vc-health-metric-card-sm">
                                        <div className="vc-health-metric-val">{currentPluginProfile.activeListeners}</div>
                                        <div className="vc-health-metric-label">Listeners</div>
                                    </div>
                                </div>

                                <div>
                                    <HeadingSecondary>Signals & Advisories</HeadingSecondary>
                                    <div style={{ marginTop: "0.5rem" }}>
                                        {currentPluginProfile.signals.length > 0 ? (
                                            currentPluginProfile.signals.map(s => (
                                                <span key={s} className="vc-health-signal-badge">{s}</span>
                                            ))
                                        ) : (
                                            <span style={{ fontSize: "0.85rem", color: "var(--text-subtle)" }}>No lag signals detected for this plugin.</span>
                                        )}
                                    </div>
                                    {currentPluginProfile.advisory && (
                                        <div className="vc-health-advisory-box" style={{ marginTop: "0.75rem" }}>
                                            {currentPluginProfile.advisory}
                                        </div>
                                    )}
                                </div>

                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* TAB: MODULE FINDER */}
            {activeTab === "finder" && (
                <div className="vc-health-tab-content">
                    <Paragraph color="text-subtle" className={Margins.bottom20}>
                        When a patch fails with <code>noModule</code>, Discord usually renamed or moved the module it
                        targeted. Paste the patch's <code>find</code> string here (or any code snippet) to locate
                        which currently-loaded webpack module contains that code — plain text or <code>/regex/flags</code>.
                        Use "Find module" on a failed patch to jump here pre-filled.
                    </Paragraph>

                    <div className="vc-health-finder-controls">
                        <TextInput
                            placeholder="e.g. sendMessage:args=> or /displayName.\(\)/"
                            value={finderQuery}
                            onChange={(v: string) => setFinderQuery(v)}
                            onKeyDown={e => {
                                if (e.key === "Enter") runFinder();
                            }}
                        />
                        <Button onClick={() => runFinder()}>Search modules</Button>
                    </div>

                    {finderState.error && (
                        <Paragraph color="text-subtle">{finderState.error}</Paragraph>
                    )}

                    {finderState.results !== null && (
                        <Paragraph color="text-subtle" className={Margins.bottom8}>
                            {finderState.results.length >= 25
                                ? `Showing first ${finderState.results.length} matches `
                                : `${finderState.results.length} match${finderState.results.length === 1 ? "" : "es"}`}
                            {" "}across {finderState.searched} loaded modules
                            {finderState.regex ? " (regex mode)" : ""}.
                            {finderState.results.length === 0 && " If nothing matched, the code may not be loaded yet (lazy chunk) or was removed entirely."}
                        </Paragraph>
                    )}

                    {finderState.results?.map(r => (
                        <div key={r.id} className="vc-health-finder-result">
                            <div className="vc-health-finder-head">
                                <span className="vc-health-finder-id">module #{r.id}</span>
                                <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                                    <span className="vc-health-finder-size">{(r.size / 1024).toFixed(1)} kB</span>
                                    <Button size="min" variant="secondary" onClick={() => openModuleSource(r.id)}>
                                        View source
                                    </Button>
                                </div>
                            </div>
                            <pre className="vc-health-finder-snippet">{r.snippet}…</pre>
                        </div>
                    ))}
                </div>
            )}

            {/* TAB 5: GUIDE */}
            {activeTab === "guide" && (
                <div className="vc-health-tab-content">
                    <div className="vc-health-guide-container">
                        <Card className="vc-health-guide-card">
                            <HeadingSecondary>Performance Diagnostics Engine</HeadingSecondary>
                            <Paragraph color="text-subtle">
                                The diagnostic suite instruments plugin lifecycle hooks (`onStart`, `onStop`), Flux event dispatches, and event listeners with high-resolution timers (`performance.now()`). Any single callback taking longer than 16ms is flagged as a slow call spike.
                            </Paragraph>
                        </Card>

                        <Card className="vc-health-guide-card">
                            <HeadingSecondary>Composite Impact Score Algorithm</HeadingSecondary>
                            <Paragraph color="text-subtle">
                                Impact Score ranks plugins by measurable resource footprint using the formula:
                            </Paragraph>
                            <div className="vc-health-formula-box">
                                Impact Score = (CPU_ms * 0.5) + (Slow_Spikes * 25) + (Active_Resources * 5)
                            </div>
                            <Paragraph color="text-subtle" style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>
                                Per-plugin RAM is intentionally excluded: browsers expose only a
                                process-wide heap counter (all of Discord plus every plugin), which
                                cannot be attributed to an individual plugin, so including it would
                                only add noise. Active resources are live intervals and event
                                listeners created by the plugin, tracked automatically.
                            </Paragraph>
                        </Card>

                        <Card className="vc-health-guide-card">
                            <HeadingSecondary>Patch Health Classifications</HeadingSecondary>
                            <ul style={{ paddingLeft: "1.25rem", color: "var(--text-subtle)", fontSize: "0.9rem" }}>
                                <li><code>noModule</code>: Target Webpack module ID missing after a Discord client update.</li>
                                <li><code>noEffect</code>: Patch regex produced 0 replacements against module source.</li>
                                <li><code>errored</code>: Exception thrown during patch execution.</li>
                                <li><code>undoingGroup</code>: Webpack transaction group rolled back.</li>
                                <li><code>conflict</code>: Multiple plugins patching the exact same code location.</li>
                                <li><code>codeChanged</code>: Discord updated the underlying module source code between sessions.</li>
                            </ul>
                        </Card>

                        <Card className="vc-health-guide-card">
                            <HeadingSecondary>Safe Mode & Crash Recovery</HeadingSecondary>
                            <Paragraph color="text-subtle">
                                Safe Mode boots TestCord with optional plugins disabled to help isolate client stutter and crashes. A plugin that crashes three or more times within 24 hours is quarantined automatically and kept disabled at startup; you can restore it from the Crash Recovery card on the Overview tab.
                            </Paragraph>
                        </Card>
                    </div>
                </div>
            )}
        </SettingsTab>
    );
}

export default wrapTab(HealthTab, "PluginHealth");
