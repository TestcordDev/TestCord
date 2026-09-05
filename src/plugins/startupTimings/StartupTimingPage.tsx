/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./StartupTimingPage.css";

import { Button } from "@components/Button";
import { Card } from "@components/Card";
import ErrorBoundary from "@components/ErrorBoundary";
import { HeadingSecondary } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { findByPropsLazy } from "@webpack";
import { React, Select, TextInput, Toasts, useMemo, useState } from "@webpack/common";

interface AppStartPerformance {
    prefix: string;
    logs: Log[];
    logGroups: LogGroup[];
    endTime_: number;
    isTracing_: boolean;
}

interface LogGroup {
    index: number;
    timestamp: number;
    logs: Log[];
    nativeLogs: any[];
    serverTrace: string;
}

interface Log {
    emoji: string;
    prefix: string;
    log: string;
    timestamp?: number;
    delta?: number;
}

const AppStartPerformance = findByPropsLazy("markWithDelta", "markAndLog", "markAt") as AppStartPerformance;

interface EnrichedLog {
    log: Log;
    index: number;
    sinceStart: number;
    sinceLast: number;
}

function enrichLogs(logs: Log[]): { rows: EnrichedLog[]; startTime: number; total: number; slowest: number; } {
    const startTime = logs.find(l => l.timestamp)?.timestamp ?? 0;
    let last = startTime;
    let slowest = 0;
    const rows = logs.map((log, index) => {
        const timestamp = log.timestamp ?? last;
        const sinceStart = (timestamp - startTime) / 1000;
        const sinceLast = (timestamp - last) / 1000;
        last = timestamp;
        if (sinceLast > slowest) slowest = sinceLast;
        return { log, index, sinceStart, sinceLast };
    });
    const total = rows.length ? rows[rows.length - 1].sinceStart : 0;
    return { rows, startTime, total, slowest };
}

function gapLevel(gapSeconds: number): "fast" | "ok" | "slow" {
    const ms = gapSeconds * 1000;
    if (ms < 100) return "fast";
    if (ms < 500) return "ok";
    return "slow";
}

function formatGap(gapSeconds: number): string {
    const ms = gapSeconds * 1000;
    if (ms < 1000) return `${ms.toFixed(0)} ms`;
    return `${gapSeconds.toFixed(2)} s`;
}

function formatAt(sinceStart: number): string {
    return `${sinceStart.toFixed(3)}s`;
}

function eventText(log: Log): string {
    return `${log.emoji ?? ""} ${log.prefix ?? ""}${log.log ?? ""}`.trim();
}

type SortKey = "chrono" | "slowest";

const SORT_OPTIONS = [
    { key: "chrono", value: "chrono" as SortKey, label: "Chronological" },
    { key: "slowest", value: "slowest" as SortKey, label: "Slowest first" }
];

function Stat({ value, label }: { value: string; label: string; }) {
    return (
        <Card className="vc-startup-stat">
            <span className="vc-startup-stat-value">{value}</span>
            <span className="vc-startup-stat-label">{label}</span>
        </Card>
    );
}

function TimingRow({ row }: { row: EnrichedLog; }) {
    const { log, index, sinceStart, sinceLast } = row;
    const text = eventText(log);
    const level = gapLevel(sinceLast);

    return (
        <div className="vc-startup-row" title={`${text}\nAt ${formatAt(sinceStart)} · +${formatGap(sinceLast)}${log.delta != null ? ` · delta ${log.delta.toFixed(0)}` : ""}`}>
            <span className="vc-startup-index">#{index + 1}</span>
            <span className="vc-startup-event">
                <span className="vc-startup-event-text">{text}</span>
            </span>
            <span className="vc-startup-times">
                <span className="vc-startup-at">{formatAt(sinceStart)}</span>
                <span className="vc-startup-gap" data-level={level}>+{formatGap(sinceLast)}</span>
            </span>
        </div>
    );
}

function TimingSection({ title, logs, subtitle }: { title: string; logs: Log[]; subtitle?: string; }) {
    const [query, setQuery] = useState("");
    const [sort, setSort] = useState<SortKey>("chrono");

    const { rows, total, slowest } = useMemo(() => enrichLogs(logs), [logs]);

    const visible = useMemo(() => {
        const q = query.trim().toLowerCase();
        const out = q
            ? rows.filter(r => eventText(r.log).toLowerCase().includes(q))
            : [...rows];
        if (sort === "slowest") out.sort((a, b) => b.sinceLast - a.sinceLast);
        return out;
    }, [rows, query, sort]);

    const slowestRow = useMemo(() => rows.reduce<EnrichedLog | null>((acc, r) => !acc || r.sinceLast > acc.sinceLast ? r : acc, null), [rows]);

    const copyReport = async () => {
        try {
            const lines = visible.map(r => `+${formatGap(r.sinceLast).padEnd(8)} @${formatAt(r.sinceStart).padEnd(9)} ${eventText(r.log)}`);
            await navigator.clipboard.writeText(`${title} (total ${total.toFixed(3)}s, ${rows.length} steps)\n${lines.join("\n")}`);
            Toasts.show({ id: Toasts.genId(), type: Toasts.Type.SUCCESS, message: "Timings copied to clipboard", options: { position: Toasts.Position.TOP } });
        } catch {
            Toasts.show({ id: Toasts.genId(), type: Toasts.Type.FAILURE, message: "Failed to copy timings", options: { position: Toasts.Position.TOP } });
        }
    };

    if (!logs.length) return null;

    return (
        <section className="vc-startup-page">
            <HeadingSecondary>{title}</HeadingSecondary>
            {subtitle && <Paragraph color="text-subtle"><span className="vc-startup-meta">{subtitle}</span></Paragraph>}

            <div className="vc-startup-stats">
                <Stat value={`${total.toFixed(2)}s`} label="Total time" />
                <Stat value={String(rows.length)} label="Steps" />
                <Stat value={`+${formatGap(slowest)}`} label="Slowest gap" />
                <Stat value={slowestRow ? `#${slowestRow.index + 1}` : "—"} label="Slowest step" />
            </div>

            <div className="vc-startup-toolbar">
                <div className="vc-startup-search">
                    <TextInput
                        placeholder="Filter events…"
                        value={query}
                        onChange={(v: string) => setQuery(v)}
                    />
                </div>
                <div className="vc-startup-sort">
                    <Select
                        options={SORT_OPTIONS}
                        closeOnSelect
                        select={(v: SortKey) => setSort(v)}
                        isSelected={(v: SortKey) => v === sort}
                        serialize={v => String(v)}
                    />
                </div>
                <div className="vc-startup-toolbar-actions">
                    <Button size="small" variant="secondary" onClick={copyReport}>Copy</Button>
                </div>
            </div>

            {slowestRow && sort === "chrono" && (
                <Paragraph color="text-subtle">
                    <span className="vc-startup-meta">
                        Slowest: {eventText(slowestRow.log)} (+{formatGap(slowestRow.sinceLast)})
                    </span>
                </Paragraph>
            )}

            <Card className="vc-startup-list">
                {visible.length === 0
                    ? <div className="vc-startup-empty"><Paragraph color="text-subtle">No events match “{query}”.</Paragraph></div>
                    : visible.map(r => <TimingRow key={r.index} row={r} />)}
            </Card>
        </section>
    );
}

function StartupTimingPage() {
    const [showTrace, setShowTrace] = useState(false);

    if (!AppStartPerformance?.logs) return <div>Loading...</div>;

    const { logs, logGroups, endTime_ } = AppStartPerformance;
    const serverTrace = logGroups?.find(g => g.serverTrace)?.serverTrace;
    const traceEnd = endTime_ ? new Date(endTime_).toLocaleTimeString() : null;

    const distinctGroups = useMemo(() => {
        if (!logGroups?.length || !logs?.length) return [];
        const signature = (items: Log[]) => items.map(l => `${l.timestamp}:${l.prefix}:${l.log}`).join("\n");
        const mainSig = signature(logs);
        return logGroups.filter(g => {
            if (!g.logs?.length) return false;
            if (g.logs === logs) return false;
            return signature(g.logs) !== mainSig;
        });
    }, [logs, logGroups]);

    const copyTrace = async () => {
        if (!serverTrace) return;
        try {
            await navigator.clipboard.writeText(serverTrace);
            Toasts.show({ id: Toasts.genId(), type: Toasts.Type.SUCCESS, message: "Server trace copied", options: { position: Toasts.Position.TOP } });
        } catch {
            Toasts.show({ id: Toasts.genId(), type: Toasts.Type.FAILURE, message: "Failed to copy trace", options: { position: Toasts.Position.TOP } });
        }
    };

    return (
        <div className="vc-startup-root">
            {serverTrace && (
                <section className="vc-startup-page">
                    <HeadingSecondary>Server Trace</HeadingSecondary>
                    <Card className="vc-startup-trace-card">
                        <div className="vc-startup-trace-head vc-startup-toolbar">
                            <Paragraph color="text-subtle">
                                <span className="vc-startup-meta">{serverTrace.split("\n").length} lines</span>
                            </Paragraph>
                            <div className="vc-startup-toolbar-actions">
                                <Button size="small" variant="secondary" onClick={() => setShowTrace(v => !v)}>
                                    {showTrace ? "Collapse" : "Expand"}
                                </Button>
                                <Button size="small" variant="secondary" onClick={copyTrace}>Copy</Button>
                            </div>
                        </div>
                        {showTrace && <pre className="vc-startup-trace">{serverTrace}</pre>}
                    </Card>
                </section>
            )}
            <TimingSection
                title="Startup Timings"
                logs={logs}
                subtitle={traceEnd ? `Trace ended at ${traceEnd}` : undefined}
            />
            {distinctGroups.map(g => (
                <TimingSection
                    key={g.index}
                    title={`Group ${g.index}`}
                    logs={g.logs}
                />
            ))}
        </div>
    );
}

export default ErrorBoundary.wrap(StartupTimingPage);
