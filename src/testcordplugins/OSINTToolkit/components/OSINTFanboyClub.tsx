/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import * as DataStore from "@api/DataStore";
import { HeadingPrimary, HeadingTertiary } from "@components/Heading";
import { SettingsTab, wrapTab } from "@components/settings/tabs/BaseTab";
import { classNameFactory } from "@utils/css";
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

const SETTING_KEYS = ["cordCatApiKey", "geoSeeerApiKey", "enableLogging", "clearRecentInvestigationsOnRestart"] satisfies Array<keyof typeof settings.store>;
const cl = classNameFactory("vc-osint-club-");

const sections: Array<{ id: SectionId; label: string; description: string; }> = [
    { id: "cordcat", label: "CordCat", description: "Discord intelligence" },
    { id: "network", label: "Network", description: "Domains and IPs" },
    { id: "identity", label: "Identity", description: "Users and breaches" },
    { id: "geo", label: "Geo Lab", description: "Images and locations" },
    { id: "resources", label: "Resources", description: "OSINT launchpad" },
    { id: "api", label: "API Vault", description: "Keys and diagnostics" }
];

function ToolCard({ title, description, children }: ToolCardProps) {
    return (
        <section className={cl("card")}>
            <div className={cl("card-head")}>
                <HeadingTertiary>{title}</HeadingTertiary>
                <span>{description}</span>
            </div>
            <div className={cl("card-body")}>{children}</div>
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
            <span className={cl("toggle-label")}>{label}</span>
        </Checkbox>
    );
}

function ResourceGroup({ title, items }: ResourceGroupProps) {
    return (
        <ToolCard title={title} description={`${items.length} curated destinations.`}>
            <div className={cl("resource-grid")}>
                {items.map(item => (
                    <div className={cl("resource")} key={item.id}>
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
        <div className={tone ? cl("metric", `metric-${tone}`) : cl("metric")}>
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
        <section className={cl("visual-section")}>
            <div className={cl("visual-section-head")}>
                <HeadingTertiary>{title}</HeadingTertiary>
                {subtitle ? <span>{subtitle}</span> : null}
            </div>
            <div className={cl("visual-section-body")}>{children}</div>
        </section>
    );
}

interface DataExplorerProps {
    value: unknown;
    depth?: number;
}

function DataExplorer({ value, depth = 0 }: DataExplorerProps) {
    if (Array.isArray(value)) {
        if (!value.length) return <div className={cl("data-empty")}>No entries.</div>;

        return (
            <div className={cl("record-list")}>
                {value.map(item => {
                    const key = formatResult(item);
                    return (
                        <div className={cl("record-card")} key={key}>
                            <DataExplorer value={item} depth={depth + 1} />
                        </div>
                    );
                })}
            </div>
        );
    }

    if (!isRecord(value)) return <span className={cl("primitive")}>{formatPrimitive(value)}</span>;

    const entries = Object.entries(value);
    if (!entries.length) return <div className={cl("data-empty")}>No details available.</div>;

    return (
        <div className={cl("data-grid")}>
            {entries.map(([key, field]) => {
                if (Array.isArray(field) || isRecord(field)) {
                    return (
                        <details className={cl("data-group")} key={key} open={depth === 0}>
                            <summary>
                                <span>{humanize(key)}</span>
                                <small>{Array.isArray(field) ? `${field.length} entries` : `${Object.keys(field).length} fields`}</small>
                            </summary>
                            <DataExplorer value={field} depth={depth + 1} />
                        </details>
                    );
                }

                return (
                    <div className={cl("data-field")} key={key}>
                        <div>
                            <span>{humanize(key)}</span>
                            <Button
                                className={cl("copy-mini")}
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
        <div className={cl("profile-result")}>
            <div className={cl("profile-hero")}>
                {cachedUser ? (
                    <Avatar src={cachedUser.getAvatarURL(undefined, 80, true)} size="SIZE_80" />
                ) : (
                    <div className={cl("avatar-fallback")}>{displayName.slice(0, 2).toUpperCase()}</div>
                )}
                <div className={cl("profile-title")}>
                    <span>Discord identity</span>
                    <HeadingPrimary>{displayName}</HeadingPrimary>
                    <p>@{username}{userId ? ` · ${userId}` : ""}</p>
                </div>
                {userId ? (
                    <Button color={Button.Colors.PRIMARY} onClick={() => openUserProfile(userId)}>
                        Open in Discord
                    </Button>
                ) : null}
            </div>

            <div className={cl("metrics")}>
                <Metric label="Risk" value={risk === undefined ? "Not scored" : `${risk}/100`} tone={riskTone} />
                <Metric label="Risk level" value={getString(score, "level") ?? "Not scored"} tone={riskTone} />
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
        <div className={cl("visual-stack")}>
            <div className={cl("metrics")}>
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
        <div className={cl("visual-stack")}>
            <div className={cl("metrics")}>
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
        <div className={cl("visual-stack")}>
            <div className={cl("service-grid")}>
                {Object.entries(services ?? {}).map(([name, value]) => {
                    const service = isRecord(value) ? value : undefined;
                    const healthy = service?.ok === true;
                    return (
                        <div className={healthy ? cl("service", "service-up") : cl("service", "service-down")} key={name}>
                            <span />
                            <div>
                                <strong>{humanize(name)}</strong>
                                <small>{healthy ? "Operational" : "Unavailable"}</small>
                            </div>
                            {getNumber(service, "latency") !== undefined ? <b>{getNumber(service, "latency")} ms</b> : null}
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
        <div className={cl("visual-stack")}>
            <div className={cl("metrics")}>
                <Metric label="Candidates" value={locations.length} />
                <Metric label="Processing time" value={getString(root, "processingTime") ?? "Unknown"} />
                <Metric label="Requests left" value={getNumber(root, "requestsRemaining") ?? "Unknown"} />
            </div>
            <div className={cl("location-grid")}>
                {locations.map(location => {
                    const record = isRecord(location) ? location : undefined;
                    const latitude = getNumber(record, "latitude");
                    const longitude = getNumber(record, "longitude");
                    const address = getString(record, "address") ?? "Unknown location";
                    const reasoning = getString(record, "reasoning") ?? "No reasoning provided.";
                    const coordinates = latitude !== undefined && longitude !== undefined ? `${latitude}, ${longitude}` : undefined;
                    const key = `${latitude ?? "x"}-${longitude ?? "y"}-${address}`;
                    return (
                        <div className={cl("location-card")} key={key}>
                            <span>{getNumber(record, "confidence") === undefined ? "Unknown confidence" : `${Math.round((getNumber(record, "confidence") ?? 0) * 100)}% confidence`}</span>
                            <strong>{address}</strong>
                            <p>{latitude ?? "?"}, {longitude ?? "?"}</p>
                            <small>{reasoning}</small>
                            <div className={cl("location-actions")}>
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
            <div className={cl("error-state")}>
                <span>Lookup failed</span>
                <HeadingTertiary>{error ?? "The service did not return a usable result."}</HeadingTertiary>
                <p>Check the input and API key, then retry. CordCat profile lookups automatically fall back to the full query endpoint when its lightweight endpoint rejects a valid ID.</p>
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
                <div className={cl("visual-stack")}>
                    <div className={cl("metrics")}><Metric label="Matching records" value={getNumber(root, "total") ?? 0} tone="warning" /></div>
                    <ResultSection title="Breach records"><DataExplorer value={getArray(root, "results")} /></ResultSection>
                </div>
            );
        }
        case "username": {
            const root = isRecord(entry.data) ? entry.data : undefined;
            return (
                <div className={cl("pivot-grid")}>
                    {Object.entries(root ?? {}).map(([name, url]) => typeof url === "string" ? (
                        <div className={cl("pivot-card")} key={name}>
                            <div><span>Public search pivot</span><strong>{humanize(name)}</strong></div>
                            <Button onClick={() => openExternal(url)}>Open search</Button>
                        </div>
                    ) : null)}
                </div>
            );
        }
        default:
            return <DataExplorer value={entry.data} />;
    }
}

function OSINTFanboyClub() {
    const { cordCatApiKey, geoSeeerApiKey, enableLogging, clearRecentInvestigationsOnRestart } = settings.use(SETTING_KEYS);
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
            <div className={cl("root")}>
                <header className={cl("hero")}>
                    <div>
                        <span className={cl("eyebrow")}>OSINT TOOLKIT WORKSPACE</span>
                        <HeadingPrimary>Osint Fanboy club</HeadingPrimary>
                        <p>A unified investigation desk for Discord intelligence, public infrastructure and image analysis.</p>
                    </div>
                    <div className={cl("health")}>
                        <span className={cordCatApiKey.trim() ? cl("ready") : cl("missing")}>
                            CordCat {cordCatApiKey.trim() ? "ready" : "needs key"}
                        </span>
                        <span className={geoKeyCount ? cl("ready") : cl("missing")}>
                            GeoSeeer {geoKeyCount ? `${geoKeyCount} key${geoKeyCount === 1 ? "" : "s"}` : "needs key"}
                        </span>
                    </div>
                </header>

                <nav className={cl("nav")} aria-label="Osint Fanboy club sections">
                    {sections.map(item => (
                        <Button
                            key={item.id}
                            className={cl("nav-button", { "nav-button-active": section === item.id })}
                            color={Button.Colors.TRANSPARENT}
                            size={Button.Sizes.SMALL}
                            onClick={() => setSection(item.id)}
                        >
                            <span>{item.label}</span>
                            <small>{item.description}</small>
                        </Button>
                    ))}
                </nav>

                <div className={cl("workspace")}>
                    <main className={cl("tools")}>
                        {section === "cordcat" ? (
                            <>
                                <ToolCard title="Discord user intelligence" description="Full exposure, risk and public profile lookups.">
                                    <TextInput value={discordId} placeholder="Discord user ID" onChange={setDiscordId} />
                                    <Toggle label="Bypass the cached full lookup and request changes." value={refreshCordCat} onChange={setRefreshCordCat} />
                                    <div className={cl("actions")}>
                                        <Button disabled={Boolean(busy)} onClick={() => void run("cordcat", "CordCat full lookup", () => lookupCordCat("query", discordId.trim(), refreshCordCat))}>
                                            Full lookup
                                        </Button>
                                        <Button color={Button.Colors.PRIMARY} disabled={Boolean(busy)} onClick={() => void run("cordcat", "CordCat user lookup", () => lookupCordCat("user", discordId.trim(), false))}>
                                            Public profile
                                        </Button>
                                    </div>
                                </ToolCard>

                                <div className={cl("split")}>
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
                                </div>

                                <ToolCard title="Service status" description="Check CordCat API, database, Discord and breach services without an API key.">
                                    <Button color={Button.Colors.GREEN} disabled={Boolean(busy)} onClick={() => void run("status", "CordCat service status", () => lookupCordCat("status", "", false))}>
                                        Run health check
                                    </Button>
                                </ToolCard>
                            </>
                        ) : null}

                        {section === "network" ? (
                            <div className={cl("split")}>
                                <ToolCard title="Domain dossier" description="RDAP registration, lifecycle, DNSSEC and name servers.">
                                    <TextInput value={domain} placeholder="example.com" onChange={setDomain} />
                                    <Button disabled={Boolean(busy)} onClick={() => void run("domain", "Domain lookup", () => lookupDomain(domain))}>
                                        Analyze domain
                                    </Button>
                                </ToolCard>
                                <ToolCard title="IP intelligence" description="Public geolocation, ASN, ISP, timezone and coordinates.">
                                    <TextInput value={ip} placeholder="8.8.8.8" onChange={setIp} />
                                    <div className={cl("actions")}>
                                        <Button disabled={Boolean(busy)} onClick={() => void run("ip", "IP lookup", () => lookupIP(ip))}>
                                            Analyze IP
                                        </Button>
                                        <Button color={Button.Colors.PRIMARY} disabled={Boolean(busy)} onClick={() => void run("ip", "My public IP", () => lookupIP())}>
                                            Detect my IP
                                        </Button>
                                    </div>
                                </ToolCard>
                            </div>
                        ) : null}

                        {section === "identity" ? (
                            <>
                                <ToolCard title="Username footprint" description="Generate public search pivots without transmitting a Discord message.">
                                    <TextInput value={username} placeholder="Username" onChange={setUsername} />
                                    <div className={cl("actions")}>
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
                                    <div className={cl("split")}>
                                        <TextInput value={breachTerm} placeholder="Search term" onChange={setBreachTerm} />
                                        <TextInput value={breachFields} placeholder="email,username,discordid" onChange={setBreachFields} />
                                    </div>
                                    <div className={cl("toggles")}>
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
                                    <div className={cl("actions")}>
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
                                <div className={cl("actions")}>
                                    <Button disabled={Boolean(busy)} onClick={() => void run("geo", "GeoSeeer image analysis", () => geolocateImage(imageUrl))}>
                                        Analyze location
                                    </Button>
                                    <Button color={Button.Colors.PRIMARY} disabled={!lensUrl} onClick={() => lensUrl && openExternal(lensUrl)}>
                                        Reverse search
                                    </Button>
                                </div>
                                <div className={cl("note")}>
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
                                    <div className={cl("links")}>
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
                                    <Toggle label="Enable OSINTToolkit debug logging." value={enableLogging} onChange={value => settings.store.enableLogging = value} />
                                    <Toggle label="Clear recent investigations whenever OSINTToolkit starts." value={clearRecentInvestigationsOnRestart} onChange={value => settings.store.clearRecentInvestigationsOnRestart = value} />
                                </ToolCard>
                            </>
                        ) : null}
                    </main>

                    <aside className={cl("results")} aria-live="polite">
                        <div className={cl("results-head")}>
                            <div>
                                <span className={cl("eyebrow")}>INVESTIGATION BOARD</span>
                                <HeadingTertiary>{busy ?? result?.title ?? "Ready for a lookup"}</HeadingTertiary>
                            </div>
                            {result ? (
                                <div className={cl("result-actions")}>
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

                        <div className={cl("history")}>
                            <div className={cl("history-head")}>
                                <strong>Recent investigations</strong>
                                <span>{history.length}/20</span>
                            </div>
                            <div className={cl("history-track")}>
                                {history.length ? history.map(entry => (
                                    <Button
                                        key={entry.id}
                                        className={cl("history-item", { "history-item-active": result?.id === entry.id })}
                                        color={Button.Colors.TRANSPARENT}
                                        size={Button.Sizes.SMALL}
                                        onClick={() => setResult(entry)}
                                    >
                                        <span>{entry.title}</span>
                                        <small>{new Date(entry.createdAt).toLocaleTimeString()}</small>
                                    </Button>
                                )) : <span className={cl("history-empty")}>Your completed lookups will appear here.</span>}
                            </div>
                        </div>

                        <div className={cl("visual-output")}>
                            {busy ? (
                                <div className={cl("loading")}>
                                    <span />
                                    Running {busy.toLowerCase()}...
                                </div>
                            ) : result ? (
                                <>
                                    <div className={cl("result-meta")}>
                                        <span className={result.status === "success" ? cl("success") : cl("error")}>{result.status}</span>
                                        <time>{new Date(result.createdAt).toLocaleString()}</time>
                                    </div>
                                    <ResultVisual entry={result} />
                                </>
                            ) : (
                                <div className={cl("empty")}>
                                    Run any tool to build a visual investigation report with identity cards, metrics, grouped records and service diagnostics.
                                </div>
                            )}
                        </div>
                    </aside>
                </div>
            </div>
        </SettingsTab>
    );
}

export default wrapTab(OSINTFanboyClub, "Osint Fanboy club");
