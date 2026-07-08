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

import { PluginHealth, type PluginHealthEntry, type SessionRecord, type StabilityScore } from "@api/PluginHealth";
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { Divider } from "@components/Divider";
import { Heading, HeadingSecondary } from "@components/Heading";
import { Link } from "@components/Link";
import { Paragraph } from "@components/Paragraph";
import { openPluginModal, SettingsTab, wrapTab } from "@components/settings";
import { buildIssueUrl, generateGitHubIssueBody } from "@utils/debugReport";
import { Margins } from "@utils/margins";
import { React, Toasts } from "@webpack/common";

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
    undoingGroup: "group rolled back"
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

function PluginHealthCard({ name, entry }: { name: string; entry: PluginHealthEntry; }) {
    const plugin = Plugins[name];
    const patchCount = entry.patchFailures.length;
    const errorCount = entry.runtimeErrors.length;
    const stability = PluginHealth.getStability(name);
    const [expanded, setExpanded] = React.useState(true);
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
                onClick={() => setExpanded(e => !e)}
                role="button"
                tabIndex={0}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") setExpanded(x => !x); }}
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
                            {entry.patchFailures.some(f => f.kind === "noModule") && (
                                <Paragraph color="text-subtle" className="vc-plugin-health-no-module-note">
                                    {NO_MODULE_DISCLAIMER}
                                </Paragraph>
                            )}
                            <ul className="vc-plugin-health-list">
                                {entry.patchFailures.map((f, i) => (
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
                                {entry.runtimeErrors.map((e, i) => (
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

function HealthTab() {
    const [tick, setTick] = React.useState(0);
    React.useEffect(() => PluginHealth.subscribe(() => setTick(t => t + 1)), []);
    React.useEffect(() => {
        void PluginHealth.loadHistory();
    }, []);

    const snapshot = React.useMemo(() => {
        const out: Array<[string, PluginHealthEntry]> = [];
        for (const [name, entry] of PluginHealth.getAll()) {
            out.push([name, entry]);
        }
        out.sort((a, b) => {
            const aErrors = a[1].runtimeErrors.length;
            const bErrors = b[1].runtimeErrors.length;
            if (aErrors !== bErrors) return bErrors - aErrors;
            return a[0].localeCompare(b[0]);
        });
        return out;
    }, [tick]);

    const totalEnabled = React.useMemo(() => {
        let count = 0;
        for (const name in Plugins) {
            if (Plugins[name]?.required || Plugins[name]?.isDependency) continue;
            count++;
        }
        return count;
    }, []);

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
                    <div className={Margins.bottom16}>
                        <Button
                            size="small"
                            variant="link"
                            onClick={() => PluginHealth.clearAll()}
                        >
                            Dismiss all
                        </Button>
                    </div>
                    {snapshot.map(([name, entry]) => (
                        <PluginHealthCard key={name} name={name} entry={entry} />
                    ))}
                </>
            )}

            <Divider className={Margins.top20 + " " + Margins.bottom16} />
            <SessionHistoryPanel />
        </SettingsTab>
    );
}

export default wrapTab(HealthTab, "PluginHealth");
