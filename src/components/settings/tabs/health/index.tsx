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
    noModule: "not found",
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
    "This patch's target module was not found within 60 seconds of startup. " +
    "Discord lazy-loads many modules (emoji picker, settings panels, voice UI, etc.) — " +
    "if the plugin works when you open the relevant UI, this entry can be safely dismissed.";

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

function PluginHealthCard({ name, entry }: { name: string; entry: PluginHealthEntry; }) {
    const plugin = Plugins[name];
    const patchCount = entry.patchFailures.length;
    const errorCount = entry.runtimeErrors.length;
    // Re-derive stability whenever the tracker notifies (deliberately not
    // memoised: recomputing is cheap and the badge must react to history
    // loading in from IndexedDB after mount).
    const stability = PluginHealth.getStability(name);

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

    return (
        <Card className="vc-plugin-health-card">
            <div className="vc-plugin-health-card-header">
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
                <div className="vc-plugin-health-card-actions">
                    {plugin && (
                        <Button size="small" variant="secondary" onClick={() => openPluginModal(plugin)}>
                            Open Plugin
                        </Button>
                    )}
                    <Button size="small" variant="secondary" onClick={copyReport}>
                        Copy Report
                    </Button>
                    <Button size="small" variant="primary" onClick={openReport}>
                        Report Issue
                    </Button>
                    <Button
                        size="small"
                        variant="link"
                        onClick={() => PluginHealth.clear(name)}
                    >
                        Dismiss
                    </Button>
                </div>
            </div>

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
                                        <pre className="vc-plugin-health-error">{truncateForDisplay(f.error, 400)}</pre>
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
                                    <pre className="vc-plugin-health-error">{truncateForDisplay(e.error, 400)}</pre>
                                    <div className="vc-plugin-health-timestamp">{formatRelative(e.at)}</div>
                                </div>
                            </li>
                        ))}
                    </ul>
                </>
            )}
        </Card>
    );
}

function SessionRow({ session, isCurrent }: { session: SessionRecord; isCurrent: boolean; }) {
    const brokenNames = Object.entries(session.plugins)
        .filter(([, counts]) => counts.patchFailures > 0 || counts.runtimeErrors > 0)
        .map(([name]) => name)
        .sort();
    return (
        <li>
            <div className="vc-plugin-health-session-meta">
                <div>
                    <strong>{new Date(session.startedAt).toLocaleString()}</strong>
                    {isCurrent && <span className="vc-plugin-health-session-current"> (current)</span>}
                </div>
                <div className="vc-plugin-health-session-counts">
                    {session.enabledPlugins.length} plugin{session.enabledPlugins.length === 1 ? "" : "s"} enabled
                    {" · "}
                    {brokenNames.length
                        ? `${brokenNames.length} broken`
                        : "no failures"}
                </div>
            </div>
            {brokenNames.length > 0 && (
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
        // Newest → oldest, with the current session (in-progress) always first.
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
    // Force re-render when the tracker changes.
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
            // Prefer plugins with runtime errors, then patch errors, then
            // alphabetical.
            const aErrors = a[1].runtimeErrors.length;
            const bErrors = b[1].runtimeErrors.length;
            if (aErrors !== bErrors) return bErrors - aErrors;
            return a[0].localeCompare(b[0]);
        });
        return out;
    }, [tick]);

    return (
        <SettingsTab>
            <Heading className={Margins.top16}>Plugin Health</Heading>
            <Paragraph className={Margins.bottom8}>
                This page lists plugins that have reported patch failures or runtime errors during
                this session. A rolling summary of the last {10} sessions is stored locally so we
                can flag plugins that keep breaking.
            </Paragraph>
            <Paragraph color="text-subtle" className={Margins.bottom20}>
                Discord ships frequent updates that can break individual plugins. If a plugin here
                looks broken, the fastest way to help is to click <em>Report Issue</em> — it opens a
                pre-filled bug report on <Link href="https://github.com/TestcordDev/TestCord/issues">GitHub</Link>.
            </Paragraph>

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
                    <Divider className={Margins.bottom16} />
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
