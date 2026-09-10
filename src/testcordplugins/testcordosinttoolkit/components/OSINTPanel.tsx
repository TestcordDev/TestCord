/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { HeadingPrimary, HeadingTertiary } from "@components/Heading";
import { SettingsTab, wrapTab } from "@components/settings/tabs/BaseTab";
import { copyWithToast, openUserProfile } from "@utils/discord";
import { Avatar, Button, Checkbox, MaskedLink, TextArea, TextInput, useEffect, UserStore, useState } from "@webpack/common";
import type { PointerEvent, ReactNode } from "react";

import {
    geolocateImage,
    getRecentInvestigations,
    getUsernameSearchUrls,
    lookupBreachVip,
    lookupCordCat,
    lookupDomain,
    lookupIP,
    lookupUsername,
    openExternal,
    OPSEC_RESOURCES,
    OSINT_HISTORY_KEY,
    OSINT_RESOURCES,
    OSINT_TOOLS,
    PRIVACY_BROWSERS,
    settings
} from "..";

type SectionId = "cordcat" | "network" | "identity" | "geo" | "resources" | "api";
type ResultStatus = "success" | "error";
type ResultKind = "breach" | "cordcat" | "domain" | "geo" | "guild" | "invite" | "ip" | "status" | "username";

interface ResultEntry {
    id: string;
    kind: ResultKind;
    title: string;
    status: ResultStatus;
    data: unknown;
    createdAt: number;
}

interface ToolCardProps {
    title: string;
    description: string;
    children: ReactNode;
}

interface ToggleProps {
    label: string;
    value: boolean;
    onChange(value: boolean): void;
}

interface ResourceItem {
    readonly id: string;
    readonly name: string;
    readonly url: string;
    readonly description: string;
}

interface ResourceGroupProps {
    title: string;
    items: readonly ResourceItem[];
}

const SETTING_KEYS = ["cordCatApiKey", "geoSeeerApiKey", "enableLogging", "clearRecentInvestigationsOnRestart"] as const;

const sections: Array<{ id: SectionId; label: string; description: string; icon: ReactNode; }> = [
    {
        id: "cordcat", label: "CordCat", description: "Discord intelligence",
        icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a7 7 0 0 0-7 7c0 2.38 1.19 4.47 3 5.74V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.26A7 7 0 0 0 12 2zm-2 12.5V17h4v-2.5a6.98 6.98 0 0 0 1.2-.7V13H8.8a6.9 6.9 0 0 0 1.2.7z" /></svg>
    },
    {
        id: "network", label: "Network", description: "Domains and IPs",
        icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9v-2h2v2zm0-4H9V7h2v5zm4 4h-2v-2h2v2zm0-4h-2V7h2v5z" /></svg>
    },
    {
        id: "identity", label: "Identity", description: "Users and breaches",
        icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" /></svg>
    },
    {
        id: "geo", label: "Geo Lab", description: "Images and locations",
        icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z" /></svg>
    },
    {
        id: "resources", label: "Resources", description: "OSINT launchpad",
        icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z" /></svg>
    },
    {
        id: "api", label: "API Vault", description: "Keys and diagnostics",
        icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2z" /></svg>
    },
];

function ToolCard({ title, description, children }: ToolCardProps) {
    // pick an icon based on title for visual weight
    const iconMap: Record<string, ReactNode> = {
        "Discord user intelligence": <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a7 7 0 0 0-7 7c0 2.38 1.19 4.47 3 5.74V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.26A7 7 0 0 0 12 2z" /></svg>,
        "Invite intelligence": <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M10 16l4-4-4-4v8zm8 2H6V6h12v12z" /></svg>,
        "Guild widget": <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M16 11c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 3-1.34 3-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05A3 3 0 0 1 19 16.5V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" /></svg>,
        "Domain dossier": <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9v-2h2v2zm0-4H9V7h2v5zm4 4h-2v-2h2v2zm0-4h-2V7h2v5z" /></svg>,
        "IP intelligence": <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 14h-2v-2h2v2zm-1-4a2 2 0 1 1 0-4 2 2 0 0 1 0 4z" /></svg>,
    };
    const icon = iconMap[title] ?? <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5-10-5-10 5z" /></svg>;
    return (
        <section className="vc-osint-card">
            <div className="vc-osint-card-head">
                <div className="vc-osint-card-icon">{icon}</div>
                <div style={{ minWidth: 0 }}>
                    <HeadingTertiary style={{ fontSize: 14 }}>{title}</HeadingTertiary>
                    <p>{description}</p>
                </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>{children}</div>
        </section>
    );
}

function Toggle({ label, value, onChange }: ToggleProps) {
    return (
        <Checkbox
            value={value}
            size={20}
            onChange={(_event: PointerEvent<Element>, checked: boolean) => onChange(checked)}
        >
            <span style={{ fontSize: 13 }}>{label}</span>
        </Checkbox>
    );
}

function ResourceGroup({ title, items }: ResourceGroupProps) {
    return (
        <ToolCard title={title} description={`${items.length} curated destinations.`}>
            <div className="vc-osint-resource-grid">
                {items.map(item => (
                    <div className="vc-osint-resource" key={item.id}>
                        <div>
                            <strong>{item.name}</strong>
                            <span>{item.description}</span>
                        </div>
                        <Button
                            color={Button.Colors.PRIMARY}
                            size={Button.Sizes.SMALL}
                            onClick={() => openExternal(item.url)}
                        >
                            Open
                        </Button>
                    </div>
                ))}
            </div>
        </ToolCard>
    );
}

function formatResult(data: unknown): string {
    return JSON.stringify(data, null, 2) ?? String(data);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isResultKind(value: unknown): value is ResultKind {
    return value === "breach"
        || value === "cordcat"
        || value === "domain"
        || value === "geo"
        || value === "guild"
        || value === "invite"
        || value === "ip"
        || value === "status"
        || value === "username";
}

function isResultEntry(value: unknown): value is ResultEntry {
    return isRecord(value)
        && typeof value.id === "string"
        && isResultKind(value.kind)
        && typeof value.title === "string"
        && (value.status === "success" || value.status === "error")
        && typeof value.createdAt === "number";
}

function getRecord(record: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
    const value = record?.[key];
    return isRecord(value) ? value : undefined;
}

function getArray(record: Record<string, unknown> | undefined, key: string): unknown[] {
    const value = record?.[key];
    return Array.isArray(value) ? value : [];
}

function getString(record: Record<string, unknown> | undefined, key: string): string | undefined {
    const value = record?.[key];
    return typeof value === "string" && value.trim() ? value : undefined;
}

function getNumber(record: Record<string, unknown> | undefined, key: string): number | undefined {
    const value = record?.[key];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function humanize(key: string): string {
    return key
        .replace(/_/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/^./, character => character.toUpperCase());
}

function formatTextResult(value: unknown, depth = 0): string {
    const indent = "  ".repeat(depth);
    if (Array.isArray(value)) {
        if (!value.length) return `${indent}No entries.`;
        return value.map((item, index) => `${indent}Result ${index + 1}:\n${formatTextResult(item, depth + 1)}`).join("\n\n");
    }
    if (isRecord(value)) {
        const entries = Object.entries(value);
        if (!entries.length) return `${indent}No details available.`;
        return entries.map(([key, field]) => Array.isArray(field) || isRecord(field)
            ? `${indent}${humanize(key)}:\n${formatTextResult(field, depth + 1)}`
            : `${indent}${humanize(key)}: ${formatPrimitive(field)}`
        ).join("\n");
    }
    return `${indent}${formatPrimitive(value)}`;
}

function formatPrimitive(value: unknown): string {
    if (value === null) return "Not available";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (typeof value === "string" || typeof value === "number") return String(value);
    return "Not available";
}

interface MetricProps {
    label: string;
    value: unknown;
    tone?: "danger" | "positive" | "warning";
}

function Metric({ label, value, tone }: MetricProps) {
    return (
        <div className={`vc-osint-metric ${tone ? `vc-osint-metric--${tone}` : ""}`}>
            <span>{label}</span>
            <strong>{formatPrimitive(value)}</strong>
        </div>
    );
}

interface ResultSectionProps {
    title: string;
    subtitle?: string;
    children: ReactNode;
}

function ResultSection({ title, subtitle, children }: ResultSectionProps) {
    return (
        <section style={{ overflow: "hidden", border: "1px solid var(--border-subtle)", borderRadius: 6, background: "var(--background-secondary)" }}>
            <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border-subtle)", background: "var(--background-tertiary)" }}>
                <HeadingTertiary style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.02em", textTransform: "uppercase", color: "var(--text-muted)" }}>{title}</HeadingTertiary>
                {subtitle ? <span style={{ display: "block", marginTop: 2, color: "var(--text-muted)", fontSize: 11 }}>{subtitle}</span> : null}
            </div>
            <div style={{ padding: 10 }}>{children}</div>
        </section>
    );
}

interface DataExplorerProps {
    value: unknown;
    depth?: number;
}

function DataExplorer({ value, depth = 0 }: DataExplorerProps) {
    if (Array.isArray(value)) {
        if (!value.length) return <div style={{ padding: 8, color: "var(--text-muted)", fontSize: 12 }}>No entries.</div>;
        return (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {value.map(item => {
                    const key = formatResult(item);
                    return (
                        <div key={key} style={{ padding: 8, border: "1px solid var(--border-subtle)", borderRadius: 4, background: "var(--background-tertiary)" }}>
                            <DataExplorer value={item} depth={depth + 1} />
                        </div>
                    );
                })}
            </div>
        );
    }
    if (!isRecord(value)) return <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{formatPrimitive(value)}</span>;
    const entries = Object.entries(value);
    if (!entries.length) return <div style={{ padding: 8, color: "var(--text-muted)", fontSize: 12 }}>No details available.</div>;
    return (
        <div className="vc-osint-data-grid">
            {entries.map(([key, field]) => {
                if (Array.isArray(field) || isRecord(field)) {
                    return (
                        <details key={key} style={{ gridColumn: "1 / -1", border: "1px solid var(--border-subtle)", borderRadius: 4, background: "var(--background-primary)" }} open={depth === 0}>
                            <summary style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", padding: "8px 10px", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                                <span>{humanize(key)}</span>
                                <small style={{ color: "var(--text-muted)", fontWeight: 500 }}>{Array.isArray(field) ? `${field.length} entries` : `${Object.keys(field).length} fields`}</small>
                            </summary>
                            <div style={{ padding: "0 8px 8px" }}><DataExplorer value={field} depth={depth + 1} /></div>
                        </details>
                    );
                }
                return (
                    <div className="vc-osint-data-field" key={key}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
                            <span>{humanize(key)}</span>
                            <Button
                                color={Button.Colors.TRANSPARENT}
                                size={Button.Sizes.SMALL}
                                onClick={() => void copyWithToast(formatPrimitive(field), `${humanize(key)} copied.`)}
                            >
                                Copy
                            </Button>
                        </div>
                        <strong>{formatPrimitive(field)}</strong>
                    </div>
                );
            })}
        </div>
    );
}

interface ProfileResultProps {
    data: unknown;
}

function ProfileResult({ data }: ProfileResultProps) {
    const root = isRecord(data) ? data : undefined;
    const user = getRecord(root, "userInfo") ?? root;
    const breach = getRecord(root, "breach");
    const breachData = getRecord(breach, "data");
    const fivem = getRecord(root, "fivem");
    const fivemData = getRecord(fivem, "data");
    const score = getRecord(root, "score");
    const bot = getRecord(score, "bot");
    const meta = getRecord(root, "meta");
    const userId = getString(user, "id");
    const username = getString(user, "username") ?? "Unknown user";
    const displayName = getString(user, "global_name") ?? username;
    const cachedUser = userId ? UserStore.getUser(userId) : undefined;
    const breachCount = getNumber(breach, "resultsCount") ?? 0;
    const fivemTotal = getNumber(fivemData, "total") ?? 0;
    const statements = getArray(root, "statements");
    const risk = getNumber(score, "risk");
    const riskTone = risk === undefined ? undefined : risk >= 60 ? "danger" : risk >= 25 ? "warning" : "positive";

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="vc-osint-profile-hero">
                {cachedUser ? (
                    <Avatar src={cachedUser.getAvatarURL(undefined, 80, true)} size="SIZE_56" />
                ) : (
                    <div style={{ display: "grid", placeItems: "center", width: 44, height: 44, borderRadius: 4, background: "var(--background-secondary)", border: "1px solid var(--border-subtle)", fontSize: 16, fontWeight: 700, flexShrink: 0, color: "var(--text-muted)", fontFamily: "var(--font-code, ui-monospace, Consolas, monospace)" }}>{displayName.slice(0, 2).toUpperCase()}</div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ color: "var(--text-muted)", fontSize: 10, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase" }}>Discord identity</span>
                    <HeadingPrimary style={{ fontSize: 18, lineHeight: "1.2" }}>{displayName}</HeadingPrimary>
                    <p style={{ margin: 0, color: "var(--text-muted)", fontFamily: "var(--font-code)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>@{username}{userId ? ` · ${userId}` : ""}</p>
                </div>
                {userId ? (
                    <Button color={Button.Colors.PRIMARY} size={Button.Sizes.SMALL} onClick={() => openUserProfile(userId)} className="vc-osint-profile-open">
                        Open
                    </Button>
                ) : null}
            </div>

            <div className="vc-osint-metric-grid">
                <Metric label="Risk" value={risk === undefined ? "Not scored" : `${risk}/100`} tone={riskTone as any} />
                <Metric label="Risk level" value={getString(score, "level") ?? "Not scored"} tone={riskTone as any} />
                <Metric label="Bot likelihood" value={getString(bot, "level") ?? "Unknown"} />
                <Metric label="Breaches" value={breachCount} tone={breachCount ? "danger" : "positive"} />
                <Metric label="FiveM records" value={fivemTotal} tone={fivemTotal ? "warning" : "positive"} />
                <Metric label="DSA sanctions" value={statements.length} tone={statements.length ? "danger" : "positive"} />
            </div>

            {user ? <ResultSection title="Public profile"><DataExplorer value={user} /></ResultSection> : null}
            {score ? <ResultSection title="Transparent score" subtitle="Signals and bot-likelihood reasoning."><DataExplorer value={score} /></ResultSection> : null}
            {breachData ? <ResultSection title="Dataset exposure" subtitle={`${breachCount} matching records.`}><DataExplorer value={breachData} /></ResultSection> : null}
            {fivemData ? <ResultSection title="FiveM records" subtitle={`${fivemTotal} records found.`}><DataExplorer value={fivemData} /></ResultSection> : null}
            {statements.length ? <ResultSection title="EU DSA statements"><DataExplorer value={statements} /></ResultSection> : null}
            {meta ? <ResultSection title="Lookup metadata"><DataExplorer value={meta} /></ResultSection> : null}
        </div>
    );
}

interface SpecializedResultProps {
    data: unknown;
}

function InviteResult({ data }: SpecializedResultProps) {
    const root = isRecord(data) ? data : undefined;
    const guild = getRecord(root, "guild");
    const channel = getRecord(root, "channel");
    const inviter = getRecord(root, "inviter");
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="vc-osint-metric-grid">
                <Metric label="Server" value={getString(guild, "name") ?? "Unknown"} />
                <Metric label="Members" value={getNumber(root, "approximate_member_count") ?? "Unknown"} />
                <Metric label="Online" value={getNumber(root, "approximate_presence_count") ?? "Unknown"} tone="positive" />
                <Metric label="Channel" value={getString(channel, "name") ?? "Unknown"} />
            </div>
            {guild ? <ResultSection title="Server"><DataExplorer value={guild} /></ResultSection> : null}
            {channel ? <ResultSection title="Destination channel"><DataExplorer value={channel} /></ResultSection> : null}
            {inviter ? <ResultSection title="Inviter"><DataExplorer value={inviter} /></ResultSection> : null}
        </div>
    );
}

function GuildResult({ data }: SpecializedResultProps) {
    const root = isRecord(data) ? data : undefined;
    const channels = getArray(root, "channels");
    const members = getArray(root, "members");
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="vc-osint-metric-grid">
                <Metric label="Server" value={getString(root, "name") ?? "Unknown"} />
                <Metric label="Online" value={getNumber(root, "presence_count") ?? members.length} tone="positive" />
                <Metric label="Public channels" value={channels.length} />
                <Metric label="Visible members" value={members.length} />
            </div>
            <ResultSection title="Public channels"><DataExplorer value={channels} /></ResultSection>
            <ResultSection title="Online members"><DataExplorer value={members} /></ResultSection>
        </div>
    );
}

function StatusResult({ data }: SpecializedResultProps) {
    const root = isRecord(data) ? data : undefined;
    const services = getRecord(root, "services");
    const stats = getRecord(root, "stats");
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {Object.entries(services ?? {}).map(([name, value]) => {
                    const service = isRecord(value) ? value : undefined;
                    const healthy = service?.ok === true;
                    return (
                        <div key={name} style={{ display: "flex", gap: 10, alignItems: "center", padding: 12, borderRadius: 4, border: `1px solid ${healthy ? "var(--status-positive)" : "var(--status-danger)"}`, background: healthy ? "color-mix(in srgb, var(--status-positive) 10%, var(--background-secondary))" : "color-mix(in srgb, var(--status-danger) 10%, var(--background-secondary))" }}>
                            <span style={{ width: 8, height: 8, borderRadius: 2, background: healthy ? "var(--status-positive)" : "var(--status-danger)", flexShrink: 0 }} />
                            <div style={{ flex: 1 }}>
                                <strong style={{ fontSize: 12 }}>{humanize(name)}</strong>
                                <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{healthy ? "Operational" : "Unavailable"}</div>
                            </div>
                            {getNumber(service, "latency") !== undefined ? <b style={{ fontSize: 11 }}>{getNumber(service, "latency")} ms</b> : null}
                        </div>
                    );
                })}
            </div>
            {stats ? <ResultSection title="Platform statistics"><DataExplorer value={stats} /></ResultSection> : null}
        </div>
    );
}

function GeoResult({ data }: SpecializedResultProps) {
    const root = isRecord(data) ? data : undefined;
    const locations = getArray(root, "locations");
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="vc-osint-metric-grid">
                <Metric label="Candidates" value={locations.length} />
                <Metric label="Processing time" value={getString(root, "processingTime") ?? "Unknown"} />
                <Metric label="Requests left" value={getNumber(root, "requestsRemaining") ?? "Unknown"} />
            </div>
            <div className="vc-osint-location-grid">
                {locations.map(location => {
                    const record = isRecord(location) ? location : undefined;
                    const latitude = getNumber(record, "latitude");
                    const longitude = getNumber(record, "longitude");
                    const address = getString(record, "address") ?? "Unknown location";
                    const reasoning = getString(record, "reasoning") ?? "No reasoning provided.";
                    const coordinates = latitude !== undefined && longitude !== undefined ? `${latitude}, ${longitude}` : undefined;
                    const key = `${latitude ?? "x"}-${longitude ?? "y"}-${address}`;
                    return (
                        <div className="vc-osint-location-card" key={key}>
                            <span style={{ alignSelf: "flex-start", padding: "3px 7px", borderRadius: 4, background: "var(--background-tertiary)", border: "1px solid var(--border-subtle)", borderLeft: "2px solid var(--status-positive)", color: "var(--text-normal)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", fontFamily: "var(--font-code, ui-monospace, Consolas, monospace)" }}>{getNumber(record, "confidence") === undefined ? "Unknown confidence" : `${Math.round((getNumber(record, "confidence") ?? 0) * 100)}% confidence`}</span>
                            <strong style={{ color: "var(--header-primary)", fontSize: 13 }}>{address}</strong>
                            <p style={{ margin: 0, fontFamily: "var(--font-code, ui-monospace, Consolas, monospace)", fontSize: 11, color: "var(--text-muted)" }}>{latitude ?? "?"}, {longitude ?? "?"}</p>
                            <small style={{ color: "var(--text-muted)", fontSize: 11, lineHeight: 1.4 }}>{reasoning}</small>
                            <div style={{ display: "flex", gap: 6, paddingTop: 7, marginTop: "auto", borderTop: "1px solid var(--border-subtle)" }}>
                                <Button
                                    color={Button.Colors.TRANSPARENT}
                                    size={Button.Sizes.SMALL}
                                    disabled={!coordinates}
                                    onClick={() => coordinates && void copyWithToast(coordinates, "Coordinates copied.")}
                                >
                                    Copy coordinates
                                </Button>
                                <Button
                                    color={Button.Colors.TRANSPARENT}
                                    size={Button.Sizes.SMALL}
                                    onClick={() => void copyWithToast(`${address}\n${coordinates ?? "Coordinates unavailable"}\n${reasoning}`, "Location text copied.")}
                                >
                                    Copy text
                                </Button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

interface ResultVisualProps {
    entry: ResultEntry;
}

function ResultVisual({ entry }: ResultVisualProps) {
    if (entry.status === "error") {
        const error = isRecord(entry.data) ? getString(entry.data, "error") : undefined;
        return (
            <div style={{ padding: 16, borderRadius: 6, background: "color-mix(in srgb, var(--status-danger) 8%, var(--background-secondary))", border: "1px solid var(--border-subtle)", borderLeft: "2px solid var(--status-danger)", display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ alignSelf: "flex-start", padding: "3px 8px", borderRadius: 4, background: "var(--background-tertiary)", border: "1px solid var(--border-subtle)", borderLeft: "2px solid var(--status-danger)", color: "var(--text-normal)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", fontFamily: "var(--font-code, ui-monospace, Consolas, monospace)" }}>Lookup failed</span>
                <HeadingTertiary style={{ color: "var(--header-primary)" }}>{error ?? "The service did not return a usable result."}</HeadingTertiary>
                <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 12 }}>Check the input and API key, then retry.</p>
            </div>
        );
    }
    switch (entry.kind) {
        case "cordcat":
            return <ProfileResult data={entry.data} />;
        case "invite":
            return <InviteResult data={entry.data} />;
        case "guild":
            return <GuildResult data={entry.data} />;
        case "status":
            return <StatusResult data={entry.data} />;
        case "geo":
            return <GeoResult data={entry.data} />;
        case "breach": {
            const root = isRecord(entry.data) ? entry.data : undefined;
            return (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div className="vc-osint-metric-grid"><Metric label="Matching records" value={getNumber(root, "total") ?? 0} tone="warning" /></div>
                    <ResultSection title="Breach records"><DataExplorer value={getArray(root, "results")} /></ResultSection>
                </div>
            );
        }
        case "username": {
            const root = isRecord(entry.data) ? entry.data : undefined;
            return (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {Object.entries(root ?? {}).map(([name, url]) => typeof url === "string" ? (
                        <div key={name} style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", padding: 12, borderRadius: 4, background: "var(--background-tertiary)", border: "1px solid var(--border-subtle)" }}>
                            <div><span style={{ display: "block", color: "var(--text-muted)", fontSize: 10, textTransform: "uppercase", fontFamily: "var(--font-code, ui-monospace, monospace)", letterSpacing: "0.04em" }}>Public pivot</span><strong style={{ fontSize: 13 }}>{humanize(name)}</strong></div>
                            <Button size={Button.Sizes.SMALL} onClick={() => openExternal(url)}>Open</Button>
                        </div>
                    ) : null)}
                </div>
            );
        }
        default:
            return <DataExplorer value={entry.data} />;
    }
}

function OSINTPanel() {
    const { cordCatApiKey, geoSeeerApiKey, enableLogging, clearRecentInvestigationsOnRestart } = settings.use(SETTING_KEYS as any);
    const [section, setSection] = useState<SectionId>("cordcat");
    const [busy, setBusy] = useState<string>();
    const [result, setResult] = useState<ResultEntry>();
    const [history, setHistory] = useState<ResultEntry[]>([]);
    const [discordId, setDiscordId] = useState("");
    const [inviteCode, setInviteCode] = useState("");
    const [guildId, setGuildId] = useState("");
    const [refreshCordCat, setRefreshCordCat] = useState(false);
    const [domain, setDomain] = useState("");
    const [ip, setIp] = useState("");
    const [username, setUsername] = useState("");
    const [breachTerm, setBreachTerm] = useState("");
    const [breachFields, setBreachFields] = useState("email,username,discordid");
    const [minecraftOnly, setMinecraftOnly] = useState(false);
    const [wildcard, setWildcard] = useState(false);
    const [caseSensitive, setCaseSensitive] = useState(false);
    const [profileId, setProfileId] = useState("");
    const [imageUrl, setImageUrl] = useState("");

    useEffect(() => {
        let active = true;
        void getRecentInvestigations().then(stored => {
            if (!active || !Array.isArray(stored)) return;
            const entries = stored.filter(isResultEntry).slice(0, 20);
            setHistory(entries);
            setResult(entries[0]);
        });
        return () => { active = false; };
    }, []);

    const geoKeyCount = geoSeeerApiKey.split(/\r?\n/).filter(key => key.trim()).length;

    const saveResult = (entry: ResultEntry) => {
        const entries = [entry, ...history].slice(0, 20);
        setResult(entry);
        setHistory(entries);
        void DataStore.set(OSINT_HISTORY_KEY, entries);
    };

    const run = async (kind: ResultKind, title: string, task: () => Promise<unknown>) => {
        if (busy) return;
        setBusy(title);
        try {
            const data = await task();
            const entry: ResultEntry = {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                kind,
                title,
                status: "success",
                data,
                createdAt: Date.now()
            };
            saveResult(entry);
        } catch (error) {
            const entry: ResultEntry = {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                kind,
                title,
                status: "error",
                data: { error: error instanceof Error ? error.message : "The lookup failed." },
                createdAt: Date.now()
            };
            saveResult(entry);
        } finally {
            setBusy(undefined);
        }
    };

    const normalizedUsername = username.trim().replace(/^@+/, "");
    const usernameUrls = normalizedUsername ? getUsernameSearchUrls(normalizedUsername) : undefined;
    const profileUrl = /^\d{17,20}$/.test(profileId.trim()) ? `https://discord.com/users/${profileId.trim()}` : undefined;
    const lensUrl = imageUrl.trim() ? `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(imageUrl.trim())}` : undefined;

    return (
        <SettingsTab>
            <div className="vc-osint-panel">
                <div className="vc-osint-panel-hero">
                    <span className="vc-osint-panel-hero-kicker">OSINT // WORKSPACE</span>
                    <HeadingPrimary style={{ fontSize: 19, lineHeight: "1.15", letterSpacing: "-0.02em" }}>Investigation Workspace</HeadingPrimary>
                    <p>Forensic lookup board for Discord intel, network traces and image geolocation. All queries stay on your client.</p>
                    <div className="vc-osint-panel-badges">
                        <span className={`vc-osint-panel-badge ${cordCatApiKey.trim() ? "vc-osint-panel-badge--ok" : "vc-osint-panel-badge--warn"}`}>
                            CordCat {cordCatApiKey.trim() ? "ready" : "needs key"}
                        </span>
                        <span className={`vc-osint-panel-badge ${geoKeyCount ? "vc-osint-panel-badge--ok" : "vc-osint-panel-badge--warn"}`}>
                            GeoSeeer {geoKeyCount ? `${geoKeyCount} key${geoKeyCount === 1 ? "" : "s"}` : "needs key"}
                        </span>
                    </div>
                </div>

                <nav className="vc-osint-panel-nav" aria-label="OSINT sections">
                    {sections.map(item => (
                        <button
                            key={item.id}
                            type="button"
                            className={`vc-osint-panel-nav-tab ${section === item.id ? "vc-osint-panel-nav-tab--active" : ""}`}
                            onClick={() => setSection(item.id)}
                            aria-current={section === item.id ? "page" : undefined}
                        >
                            {item.icon}
                            {item.label}
                        </button>
                    ))}
                </nav>

                <div className="vc-osint-dashboard">
                    <div className="vc-osint-dashboard-tools">
                        {section === "cordcat" ? (
                            <>
                                <ToolCard title="Discord user intelligence" description="Full exposure, risk and public profile lookups.">
                                    <TextInput value={discordId} placeholder="Discord user ID" onChange={setDiscordId} />
                                    <Toggle label="Bypass cached result and request changes." value={refreshCordCat} onChange={setRefreshCordCat} />
                                    <div className="vc-osint-card-actions">
                                        <Button disabled={Boolean(busy)} onClick={() => void run("cordcat", "CordCat full lookup", () => lookupCordCat("query", discordId.trim(), refreshCordCat))}>
                                            Full lookup
                                        </Button>
                                        <Button color={Button.Colors.PRIMARY} disabled={Boolean(busy)} onClick={() => void run("cordcat", "CordCat user lookup", () => lookupCordCat("user", discordId.trim(), false))}>
                                            Public profile
                                        </Button>
                                    </div>
                                </ToolCard>

                                <ToolCard title="Invite intelligence" description="Validate a code and inspect its guild, channel and inviter.">
                                    <TextInput value={inviteCode} placeholder="Invite code" onChange={setInviteCode} />
                                    <Button disabled={Boolean(busy)} onClick={() => void run("invite", "CordCat invite lookup", () => lookupCordCat("invite", inviteCode.trim(), false))}>
                                        Inspect invite
                                    </Button>
                                </ToolCard>
                                <ToolCard title="Guild widget" description="Read a server's public widget, channels and online members.">
                                    <TextInput value={guildId} placeholder="Discord server ID" onChange={setGuildId} />
                                    <Button disabled={Boolean(busy)} onClick={() => void run("guild", "CordCat guild widget", () => lookupCordCat("guild", guildId.trim(), false))}>
                                        Inspect server
                                    </Button>
                                </ToolCard>

                                <ToolCard title="Service status" description="Check CordCat API, database, Discord and breach services without an API key.">
                                    <Button color={Button.Colors.GREEN} disabled={Boolean(busy)} onClick={() => void run("status", "CordCat service status", () => lookupCordCat("status", "", false))}>
                                        Run health check
                                    </Button>
                                </ToolCard>
                            </>
                        ) : null}

                        {section === "network" ? (
                            <>
                                <ToolCard title="Domain dossier" description="RDAP registration, lifecycle, DNSSEC and name servers.">
                                    <TextInput value={domain} placeholder="example.com" onChange={setDomain} />
                                    <Button disabled={Boolean(busy)} onClick={() => void run("domain", "Domain lookup", () => lookupDomain(domain))}>
                                        Analyze domain
                                    </Button>
                                </ToolCard>
                                <ToolCard title="IP intelligence" description="Public geolocation, ASN, ISP, timezone and coordinates.">
                                    <TextInput value={ip} placeholder="8.8.8.8" onChange={setIp} />
                                    <div className="vc-osint-card-actions">
                                        <Button disabled={Boolean(busy)} onClick={() => void run("ip", "IP lookup", () => lookupIP(ip))}>
                                            Analyze IP
                                        </Button>
                                        <Button color={Button.Colors.PRIMARY} disabled={Boolean(busy)} onClick={() => void run("ip", "My public IP", () => lookupIP())}>
                                            Detect my IP
                                        </Button>
                                    </div>
                                </ToolCard>
                            </>
                        ) : null}

                        {section === "identity" ? (
                            <>
                                <ToolCard title="Username footprint" description="Generate public search pivots without transmitting a Discord message.">
                                    <TextInput value={username} placeholder="Username" onChange={setUsername} />
                                    <div className="vc-osint-card-actions">
                                        <Button disabled={Boolean(busy) || !username.trim()} onClick={() => void run("username", "Username footprint", async () => lookupUsername(username))}>
                                            Generate pivots
                                        </Button>
                                        <Button color={Button.Colors.PRIMARY} disabled={!usernameUrls} onClick={() => usernameUrls && openExternal(usernameUrls.userSearch)}>
                                            UserSearch
                                        </Button>
                                        <Button color={Button.Colors.PRIMARY} disabled={!usernameUrls} onClick={() => usernameUrls && openExternal(usernameUrls.whatsMyName)}>
                                            WhatsMyName
                                        </Button>
                                    </div>
                                </ToolCard>

                                <ToolCard title="Breach.vip explorer" description="Search selected public record fields with the same controls as /breachvip.">
                                    <div className="vc-osint-panel-grid">
                                        <TextInput value={breachTerm} placeholder="Search term" onChange={setBreachTerm} />
                                        <TextInput value={breachFields} placeholder="email,username,discordid" onChange={setBreachFields} />
                                    </div>
                                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                        <Toggle label="Minecraft records only." value={minecraftOnly} onChange={setMinecraftOnly} />
                                        <Toggle label="Enable * and ? wildcards." value={wildcard} onChange={setWildcard} />
                                        <Toggle label="Case-sensitive search." value={caseSensitive} onChange={setCaseSensitive} />
                                    </div>
                                    <Button
                                        disabled={Boolean(busy)}
                                        onClick={() => void run("breach", "Breach.vip search", () => lookupBreachVip(
                                            breachTerm.trim(),
                                            [...new Set(breachFields.toLowerCase().split(",").map(field => field.trim()).filter(Boolean))],
                                            minecraftOnly,
                                            wildcard,
                                            caseSensitive
                                        ))}
                                    >
                                        Search records
                                    </Button>
                                </ToolCard>

                                <ToolCard title="Discord profile utilities" description="Copy or open a canonical Discord user URL.">
                                    <TextInput value={profileId} placeholder="Discord user ID" onChange={setProfileId} />
                                    <div className="vc-osint-card-actions">
                                        <Button color={Button.Colors.PRIMARY} disabled={!profileUrl} onClick={() => void copyWithToast(profileId.trim(), "User ID copied.")}>
                                            Copy ID
                                        </Button>
                                        <Button color={Button.Colors.PRIMARY} disabled={!profileUrl} onClick={() => profileUrl && void copyWithToast(profileUrl, "User URL copied.")}>
                                            Copy profile URL
                                        </Button>
                                        <Button disabled={!profileUrl} onClick={() => profileUrl && openUserProfile(profileId.trim())}>
                                            Open profile
                                        </Button>
                                    </div>
                                </ToolCard>
                            </>
                        ) : null}

                        {section === "geo" ? (
                            <ToolCard title="Geo image laboratory" description="Analyze a public image with GeoSeeer or pivot into Google Lens.">
                                <TextInput value={imageUrl} placeholder="https://example.com/photo.jpg" onChange={setImageUrl} />
                                <div className="vc-osint-card-actions">
                                    <Button disabled={Boolean(busy)} onClick={() => void run("geo", "GeoSeeer image analysis", () => geolocateImage(imageUrl))}>
                                        Analyze location
                                    </Button>
                                    <Button color={Button.Colors.PRIMARY} disabled={!lensUrl} onClick={() => lensUrl && openExternal(lensUrl)}>
                                        Reverse search
                                    </Button>
                                </div>
                                <div style={{ padding: "8px 10px", borderRadius: 8, background: "var(--background-tertiary)", borderLeft: "3px solid var(--background-modifier-accent)", color: "var(--text-muted)", fontSize: 12 }}>
                                    The API receives the public image URL. Results include candidate coordinates, confidence, reasoning and request balance.
                                </div>
                            </ToolCard>
                        ) : null}

                        {section === "resources" ? (
                            <>
                                <ResourceGroup title="Lookup tools" items={OSINT_TOOLS} />
                                <ResourceGroup title="Resource lists" items={OSINT_RESOURCES} />
                                <ResourceGroup title="Opsec resources" items={OPSEC_RESOURCES} />
                                <ResourceGroup title="Privacy browsers" items={PRIVACY_BROWSERS} />
                            </>
                        ) : null}

                        {section === "api" ? (
                            <>
                                <ToolCard title="CordCat API" description="Stored in the plugin settings and shared by the UI and slash commands.">
                                    <TextInput
                                        type="password"
                                        value={cordCatApiKey}
                                        placeholder="cc_your_api_key_here"
                                        onChange={(value: string) => settings.store.cordCatApiKey = value}
                                    />
                                    <div style={{ display: "flex", gap: 16, fontSize: 13 }}>
                                        <MaskedLink href="https://dis.cord.cat/dashboard">CordCat dashboard</MaskedLink>
                                        <MaskedLink href="https://dis.cord.cat/docs#intro">API documentation</MaskedLink>
                                    </div>
                                </ToolCard>
                                <ToolCard title="GeoSeeer API pool" description="One key per line. Requests rotate through the configured keys.">
                                    <TextArea
                                        rows={6}
                                        value={geoSeeerApiKey}
                                        placeholder="Enter one GeoSeeer API key per line."
                                        onChange={(value: string) => settings.store.geoSeeerApiKey = value}
                                    />
                                    <MaskedLink href="https://geoseeer.com/">Open GeoSeeer</MaskedLink>
                                </ToolCard>
                                <ToolCard title="Diagnostics" description="Optional local debug logging. API keys are never logged.">
                                    <Toggle label="Enable debug logging." value={enableLogging} onChange={value => settings.store.enableLogging = value} />
                                    <Toggle label="Clear recent investigations on start." value={clearRecentInvestigationsOnRestart} onChange={value => settings.store.clearRecentInvestigationsOnRestart = value} />
                                </ToolCard>
                            </>
                        ) : null}
                    </div>

                    <div className="vc-osint-dashboard-output">
                        <div className="vc-osint-dashboard-head">
                            <div style={{ minWidth: 0 }}>
                                <span className="vc-osint-dashboard-head-kicker">Investigation board // {busy ? "active" : result ? result.kind : "standby"}</span>
                                <HeadingTertiary style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.02em" }}>{busy ?? result?.title ?? "Ready for a lookup"}</HeadingTertiary>
                            </div>
                            {result ? (
                                <div style={{ display: "flex", gap: 6 }}>
                                    <Button
                                        color={Button.Colors.TRANSPARENT}
                                        size={Button.Sizes.SMALL}
                                        onClick={() => void copyWithToast(`${result.title}\n\n${formatTextResult(result.data)}`, "Result text copied.")}
                                    >
                                        Copy text
                                    </Button>
                                    <Button
                                        color={Button.Colors.TRANSPARENT}
                                        size={Button.Sizes.SMALL}
                                        onClick={() => void copyWithToast(formatResult(result.data), "Raw data copied.")}
                                    >
                                        Copy raw
                                    </Button>
                                </div>
                            ) : null}
                        </div>

                        <div className="vc-osint-history-row">
                            <strong style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap", alignSelf: "center" }}>Recent {history.length}/20</strong>
                            <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
                                {history.length ? history.map(entry => (
                                    <Button
                                        key={entry.id}
                                        color={result?.id === entry.id ? Button.Colors.BRAND : Button.Colors.TRANSPARENT}
                                        size={Button.Sizes.SMALL}
                                        onClick={() => setResult(entry)}
                                    >
                                        <span style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.title}</span>
                                    </Button>
                                )) : <span style={{ color: "var(--text-muted)", fontSize: 12, padding: "6px 0" }}>Your completed lookups will appear here.</span>}
                            </div>
                        </div>

                        <div className="vc-osint-dashboard-body">
                            {busy ? (
                                <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "center", minHeight: 200, color: "var(--text-muted)", fontSize: 13, fontFamily: "var(--font-code, ui-monospace, Consolas, monospace)" }}>
                                    <span className="vc-osint-spinner-small" />
                                    Running {busy.toLowerCase()}...
                                </div>
                            ) : result ? (
                                <>
                                    <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", padding: "6px 0 10px", borderBottom: "1px solid var(--border-subtle)", marginBottom: 12 }}>
                                        <span className={result.status === "success" ? "vc-osint-status-pill vc-osint-status-pill--ok" : "vc-osint-status-pill vc-osint-status-pill--err"}>{result.status}</span>
                                        <time style={{ color: "var(--text-muted)", fontSize: 10, fontFamily: "var(--font-code, ui-monospace, monospace)" }}>{new Date(result.createdAt).toLocaleString()}</time>
                                    </div>
                                    <ResultVisual entry={result} />
                                </>
                            ) : (
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 200, color: "var(--text-muted)", fontSize: 13, textAlign: "center", padding: 20 }}>
                                    Run any tool to build a visual investigation report with identity cards, metrics, grouped records and service diagnostics.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </SettingsTab>
    );
}

export default wrapTab(OSINTPanel, "OSINT");
