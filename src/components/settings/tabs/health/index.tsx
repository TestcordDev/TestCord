/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2026 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import "./styles.css";

import * as DataStore from "@api/DataStore";
import { type NetworkDomainSummary, NetworkMonitor } from "@api/NetworkMonitor";
import { type PatchFailure, PluginHealth, type PluginHealthEntry, type SessionRecord, type StabilityScore } from "@api/PluginHealth";
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { Divider } from "@components/Divider";
import { Heading, HeadingSecondary } from "@components/Heading";
import { Link } from "@components/Link";
import { Paragraph } from "@components/Paragraph";
import { openPluginModal, SettingsTab, wrapTab } from "@components/settings";
import { buildIssueUrl, generateGitHubIssueBody } from "@utils/debugReport";
import { Margins } from "@utils/margins";
import { RenderModalProps } from "@vencord/discord-types";
import { wreq } from "@webpack";
import { Modal, openModal, React, Select, TextInput, Toasts } from "@webpack/common";
import { getFactoryPatchedSource,SYM_ORIGINAL_FACTORY } from "@webpack/patcher";

import Plugins from "~plugins";

function formatRelative(ts: number): string {
    const diff = Date.now() - ts;
    if (diff < 5_000) return "just now";
    if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
    if (diff < 3600_000) return `${Math.round(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.round(diff / 3600_000)}h ago`;
    return new Date(ts).toLocaleString();
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

type FilterKey = "all" | "conflict" | "noModule" | "noEffect" | "errored" | "undoingGroup" | "runtime";

const FILTER_OPTIONS: Array<{ value: FilterKey; label: string; key: string; }> = [
    { key: "all", value: "all", label: "All issues" },
    { key: "conflict", value: "conflict", label: "Conflicts" },
    { key: "noModule", value: "noModule", label: "Missing modules" },
    { key: "noEffect", value: "noEffect", label: "No effect" },
    { key: "errored", value: "errored", label: "Errored patches" },
    { key: "undoingGroup", value: "undoingGroup", label: "Rolled back groups" },
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

function filterEntry(entry: PluginHealthEntry, filter: FilterKey): boolean {
    if (filter === "all") return true;
    if (filter === "runtime") return entry.runtimeErrors.length > 0;
    return entry.patchFailures.some(f => f.kind === filter);
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

function buildExportReport(): string {
    const all = PluginHealth.getAll();
    const currentSession = PluginHealth.getCurrentSession();
    const history = PluginHealth.getHistory();
    const report: Record<string, unknown> = {
        exportedAt: new Date().toISOString(),
        currentSession,
        sessionHistory: [...history],
        plugins: {} as Record<string, unknown>
    };
    for (const [name, entry] of all) {
        (report.plugins as Record<string, unknown>)[name] = {
            ...entry,
            stability: PluginHealth.getStability(name)
        };
    }
    return JSON.stringify(report, null, 2);
}

function downloadExport() {
    try {
        const json = buildExportReport();
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
    const [showOriginal, setShowOriginal] = React.useState(false);

    const { originalSource, patchedSource } = React.useMemo(() => {
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
            // Best-effort — module may have been garbage collected
        }
        return { originalSource: original, patchedSource: patched };
    }, [failure.moduleId]);

    const diffLines = React.useMemo(() => {
        if (!originalSource || !patchedSource) return null;
        const origLines = originalSource.split("\n");
        const patchedLines = patchedSource.split("\n");
        const maxLen = Math.max(origLines.length, patchedLines.length);
        const result: Array<{ type: "same" | "added" | "removed"; text: string; }> = [];
        for (let i = 0; i < maxLen; i++) {
            const o = origLines[i];
            const p = patchedLines[i];
            if (o === p) {
                result.push({ type: "same", text: o ?? "" });
            } else {
                if (o !== undefined) result.push({ type: "removed", text: o });
                if (p !== undefined) result.push({ type: "added", text: p });
            }
        }
        return result;
    }, [originalSource, patchedSource]);

    return (
        <Modal
            transitionState={transitionState}
            onClose={onClose}
            size="lg"
            title={
                <div className="vc-patch-viewer-title">
                    Patch viewer — {pluginName}
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
                                        Source comparison unavailable — the module may have been unloaded.
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
            ? `Seen in ${sessionsSeen} recorded session${sessionsSeen === 1 ? "" : "s"} — need at least 3 to score.`
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
    const [expanded, setExpanded] = React.useState(false);
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

function PluginHealthCard({ name, entry, expanded, onToggle, filter }: { name: string; entry: PluginHealthEntry; expanded: boolean; onToggle: () => void; filter: FilterKey; }) {
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
    const [dismissing, setDismissing] = React.useState(false);

    const openReport = () => {
        try {
            const body = generateGitHubIssueBody({ pluginName: name });
            const url = buildIssueUrl(`[${name}] Bug report`, body, ["bug"]);
            VencordNative.native.openExternal(url);
        } catch (e) {
            Toasts.show({
                id: Toasts.genId(),
                type: Toasts.Type.FAILURE,
                message: "Failed to build issue URL — see console",
                options: { position: Toasts.Position.TOP }
            });
            console.error(e);
        }
    };

    const copyReport = async () => {
        try {
            const body = generateGitHubIssueBody({ pluginName: name });
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
        // Wait for the exit animation before removing from the registry.
        setTimeout(() => PluginHealth.clear(name), 250);
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
                                            {f.moduleId && (
                                                <Button
                                                    size="min"
                                                    variant="secondary"
                                                    onClick={() => openPatchViewer(name, f)}
                                                >
                                                    View patch
                                                </Button>
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
                                {visibleRuntimeErrors.map((e, i) => (
                                    <li key={i}>
                                        <div className="vc-plugin-health-kind" data-kind="error">{e.source}</div>
                                        <div className="vc-plugin-health-detail">
                                            <ExpandableError text={e.error} />
                                            <div className="vc-plugin-health-timestamp">{formatRelative(e.at)}</div>
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

function SessionRow({ session, isCurrent }: { session: SessionRecord; isCurrent: boolean; }) {
    const brokenNames = Object.entries(session.plugins)
        .filter(([, counts]) => counts.patchFailures > 0 || counts.runtimeErrors > 0)
        .map(([name]) => name)
        .sort();
    const [expanded, setExpanded] = React.useState(false);
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
                    {session.enabledPlugins.length} plugin{session.enabledPlugins.length === 1 ? "" : "s"} enabled
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
                            counts.runtimeErrors > 0 && `${counts.runtimeErrors} runtime`
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

function SessionHistoryPanel() {
    const [tick, setTick] = React.useState(0);
    React.useEffect(() => {
        void PluginHealth.loadHistory();
    }, []);
    React.useEffect(() => PluginHealth.subscribe(() => setTick(t => t + 1)), []);

    const sessions = React.useMemo(() => {
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
                    onClick={() => { void PluginHealth.clearHistory(); }}
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
                {noModuleCount} plugins have missing modules — this usually means
                Discord shipped an update that removed or renamed code the plugins
                were targeting. Report the broken plugins so their authors can fix them.
            </Paragraph>
        </Card>
    );
}

function NetworkActivityPanel() {
    const [tick, setTick] = React.useState(0);
    const [enabled, setEnabled] = React.useState(NetworkMonitor.isEnabled());

    React.useEffect(() => {
        void NetworkMonitor.loadPreference().then(pref => {
            if (pref && !NetworkMonitor.isEnabled()) {
                NetworkMonitor.start();
                setEnabled(true);
            }
        });
    }, []);
    React.useEffect(() => NetworkMonitor.subscribe(() => setTick(t => t + 1)), []);

    const summaries: NetworkDomainSummary[] = React.useMemo(() => {
        return NetworkMonitor.getDomainSummaries();
    }, [tick]);

    const totalRequests = React.useMemo(() => {
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

function HealthTab() {
    const [tick, setTick] = React.useState(0);
    const [searchQuery, setSearchQuery] = React.useState("");
    const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());
    const [filter, setFilter] = React.useState<FilterKey>("all");
    const [sort, setSort] = React.useState<SortKey>("errors");
    const [bannerDismissed, setBannerDismissed] = React.useState(false);
    const [noticeDismissed, setNoticeDismissed] = React.useState(false);
    const [conflictsHidden, setConflictsHidden] = React.useState(true);
    React.useEffect(() => PluginHealth.subscribe(() => setTick(t => t + 1)), []);
    React.useEffect(() => {
        void PluginHealth.loadHistory();
        void DataStore.get<boolean>(DB_KEY_BANNER_DISMISSED).then(v => {
            if (v) setBannerDismissed(true);
        });
        void DataStore.get<boolean>(DB_KEY_NOTICE_DISMISSED).then(v => {
            if (v) setNoticeDismissed(true);
        });
        void DataStore.get<boolean>(DB_KEY_CONFLICTS_HIDDEN).then(v => {
            if (v === false) setConflictsHidden(false);
        });
    }, []);

    const snapshot = React.useMemo(() => {
        const out: Array<[string, PluginHealthEntry]> = [];
        for (const [name, rawEntry] of PluginHealth.getAll()) {
            if (Plugins[name]?.required) continue;
            const patchFailures = conflictsHidden
                ? rawEntry.patchFailures.filter(f => f.kind !== "conflict")
                : rawEntry.patchFailures;
            if (!patchFailures.length && !rawEntry.runtimeErrors.length) continue;
            out.push([name, { patchFailures, runtimeErrors: rawEntry.runtimeErrors }]);
        }
        return out;
    }, [tick, conflictsHidden]);

    const filtered = React.useMemo(() => {
        let result = snapshot;
        const q = searchQuery.trim().toLowerCase();
        if (q) result = result.filter(([name]) => name.toLowerCase().includes(q));
        if (filter !== "all") result = result.filter(([, entry]) => filterEntry(entry, filter));
        return sortSnapshot(result, sort);
    }, [snapshot, searchQuery, filter, sort]);

    const totalEnabled = React.useMemo(() => {
        return new Set(PluginHealth.getCurrentSession().enabledPlugins.filter(name => !Plugins[name]?.required)).size;
    }, [tick]);

    const noModuleCount = React.useMemo(() => {
        const plugins = new Set<string>();
        for (const [name, rawEntry] of PluginHealth.getAll()) {
            const hasRealNoModule = rawEntry.patchFailures.some(f =>
                f.kind === "noModule"
                && !f.find.startsWith(".")
                && !f.find.startsWith("[\"")
            );
            if (hasRealNoModule) plugins.add(name);
        }
        return plugins.size;
    }, [tick]);

    const allCollapsed = filtered.length > 0 && filtered.every(([name]) => collapsed.has(name));

    const handleCollapseAll = () => {
        setCollapsed(new Set(filtered.map(([name]) => name)));
    };

    const handleExpandAll = () => {
        setCollapsed(new Set());
    };

    const toggleCard = (name: string) => {
        setCollapsed(prev => {
            const next = new Set(prev);
            if (next.has(name)) next.delete(name);
            else next.add(name);
            return next;
        });
    };

    const copyAllReports = async () => {
        try {
            const parts: string[] = [];
            for (const [name] of filtered) {
                parts.push(generateGitHubIssueBody({ pluginName: name }));
            }
            const combined = parts.join("\n\n---\n\n");
            await navigator.clipboard.writeText(combined);
            Toasts.show({
                id: Toasts.genId(),
                type: Toasts.Type.SUCCESS,
                message: `Copied ${filtered.length} report${filtered.length === 1 ? "" : "s"} to clipboard`,
                options: { position: Toasts.Position.TOP }
            });
        } catch (e) {
            Toasts.show({
                id: Toasts.genId(),
                type: Toasts.Type.FAILURE,
                message: "Failed to copy reports",
                options: { position: Toasts.Position.TOP }
            });
            console.error(e);
        }
    };

    const dismissAll = () => {
        PluginHealth.clearAll();
        setCollapsed(new Set());
    };

    const handleBannerToggle = (value: boolean) => {
        setBannerDismissed(!value);
        void DataStore.set(DB_KEY_BANNER_DISMISSED, !value);
    };

    const handleConflictsToggle = (value: boolean) => {
        setConflictsHidden(value);
        void DataStore.set(DB_KEY_CONFLICTS_HIDDEN, value);
    };

    const handleNoticeDismiss = (value: boolean) => {
        setNoticeDismissed(value);
        void DataStore.set(DB_KEY_NOTICE_DISMISSED, value);
    };

    return (
        <SettingsTab>
            <Heading className={Margins.top16}>Plugin Health</Heading>
            <Paragraph className={Margins.bottom8}>
                This page lists plugins that have reported patch failures or runtime errors during
                this session. A rolling summary of the last 10 sessions is stored locally so we
                can flag plugins that keep breaking.
            </Paragraph>
            <Paragraph color="text-subtle" className={Margins.bottom20}>
                Discord ships frequent updates that can break individual plugins. If a plugin here
                looks broken, the fastest way to help is to click <em>Report</em> — it opens a
                pre-filled bug report on <Link href="https://github.com/TestcordDev/TestCord/issues">GitHub</Link>.
            </Paragraph>

            <DiscordUpdateBanner
                noModuleCount={noModuleCount}
                dismissed={bannerDismissed}
                onDismiss={() => handleBannerToggle(false)}
            />

            <Card className="vc-plugin-health-notice-settings">
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
                            onChange={e => handleNoticeDismiss(!e.target.checked)}
                        />
                        <span className="vc-plugin-health-toggle-slider" />
                    </label>
                </div>
                <div className="vc-plugin-health-notice-settings-divider" />
                <div className="vc-plugin-health-notice-settings-row">
                    <div>
                        <HeadingSecondary>Show conflicts</HeadingSecondary>
                        <Paragraph color="text-subtle">
                            Display patch conflicts (multiple plugins patching the same module). Conflicts don't necessarily mean a plugin is broken — many plugins intentionally patch the same code.
                        </Paragraph>
                    </div>
                    <label className="vc-plugin-health-toggle">
                        <input
                            type="checkbox"
                            checked={!conflictsHidden}
                            onChange={e => handleConflictsToggle(!e.target.checked)}
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
                            onChange={e => handleBannerToggle(!e.target.checked)}
                        />
                        <span className="vc-plugin-health-toggle-slider" />
                    </label>
                </div>
            </Card>

            <HealthSummaryBar total={totalEnabled} broken={snapshot.length} />

            <Divider className={Margins.top16 + " " + Margins.bottom16} />

            {snapshot.length === 0 ? (
                <Card variant="brand" className="vc-plugin-health-empty">
                    <HeadingSecondary>All plugins healthy this session</HeadingSecondary>
                    <Paragraph>
                        No patch failures or runtime errors have been recorded this session.
                    </Paragraph>
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
                                onClick={downloadExport}
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
                            />
                        ))
                    )}
                </>
            )}

            <Divider className={Margins.top20 + " " + Margins.bottom16} />
            <NetworkActivityPanel />

            <Divider className={Margins.top20 + " " + Margins.bottom16} />
            <SessionHistoryPanel />
        </SettingsTab>
    );
}

export default wrapTab(HealthTab, "PluginHealth");
