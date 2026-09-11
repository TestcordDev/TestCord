/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { findGroupChildrenByChildId, type NavContextMenuPatchCallback } from "@api/ContextMenu";
import * as DataStore from "@api/DataStore";
import { HeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { ImageIcon } from "@components/Icons";
import SettingsPlugin from "@plugins/_core/settings";
import { TestcordDevs } from "@utils/constants";
import { copyWithToast } from "@utils/discord";
import { LazyComponent } from "@utils/lazyReact";
import { Logger } from "@utils/Logger";
import { classes, parseUrl, removeFromArray, sleep } from "@utils/misc";
import { ModalContent, ModalFooter, openModal } from "@utils/modal";
import { formatDurationVerbose, makeCodeblock } from "@utils/text";
import definePlugin, { OptionType, type PluginNative } from "@utils/types";
import type { CommandArgument, CommandContext, Message, User } from "@vencord/discord-types";
import { Button, ChannelStore, Constants, GuildMemberStore, GuildStore, IconUtils, Menu, Modal, PermissionsBits, PermissionStore, Popout, React, RelationshipStore, RestAPI, SelectedChannelStore, SettingsRouter, showToast, TextInput, Toasts, useCallback, useEffect, useMemo, useRef, UserStore, useState } from "@webpack/common";
import type { ComponentProps } from "react";

import { callAI, CordCatResult, fetchCordCatData } from "./aiManager";
import { AlgorithmResult, analyzeMessages, MessageData } from "./algorithms";

const logger = new Logger("TestcordOSINTToolkit");

const SETTINGS_ENTRY_KEY = "testcord_osint";
export const OSINT_HISTORY_KEY = "TestcordOSINTToolkit_recentInvestigations";
const SCAN_HISTORY_KEY = "testcord-osint-history";
const MAX_SCAN_HISTORY = 5;
const REQUEST_TIMEOUT_MS = 12_000;
const Native = VencordNative.pluginHelpers.TestcordOSINTToolkit as PluginNative<typeof import("./native")>;
const OSINTPanel = LazyComponent(() => require("./components/OSINTPanel").default);
let pluginActive = true;
let nextGeoSeeerApiKey = 0;
let recentInvestigationsReady = Promise.resolve();
const activeRequests = new Set<AbortController>();

const CORDCAT_TITLES = {
    query: "full lookup",
    user: "user lookup",
    invite: "invite lookup",
    guild: "guild widget",
    status: "service status"
} as const;
type CordCatTool = keyof typeof CORDCAT_TITLES;

export const OSINT_TOOLS = [
    { id: "see-know", name: "See-Know", url: "https://see-know.vip/", description: "Searches public web signals." },
    { id: "epieos", name: "Epieos", url: "https://epieos.com/", description: "Checks public email and phone traces." },
    { id: "osintx", name: "Osintx_", url: "https://www.osintx.io/", description: "Collects OSINT links and workflows." },
    { id: "socialeye", name: "SocialEye", url: "https://socialeye.net/", description: "Searches usernames across public sites." },
    { id: "cloudsint", name: "Cloudsint", url: "https://cloudsint.net/", description: "Checks cloud storage exposure." },
    { id: "proximity", name: "Proximity OSINT", url: "https://www.proximityosint.com/", description: "Provides OSINT workflows and resources." },
    { id: "deadeye", name: "DeadEye", url: "https://deadeye.cc/", description: "Searches public profile signals." },
    { id: "indicia", name: "Indicia", url: "https://indicia.app/", description: "Enriches public indicators." },
    { id: "tempemail", name: "Snapmail", url: "https://www.snapmail.in/", description: "Creates temporary email inboxes." }
] as const;

export const OSINT_RESOURCES = [
    { id: "osint-catalog", name: "Osint Catalog", url: "https://osint-catalog.xyz/", description: "Catalog of OSINT tools and resources." },
    { id: "pikaosint", name: "PikaOSINT", url: "https://pikaosint.pages.dev/", description: "Curated OSINT tools collection." },
    { id: "osintframework", name: "OSINT Framework", url: "https://osintframework.com/", description: "Categorized OSINT resource index." },
    { id: "photo-osint", name: "Photo OSINT", url: "https://start.me/p/0PgzqO/photo-osint", description: "Photo investigation resource board." }
] as const;

export const OPSEC_RESOURCES = [
    { id: "fake-name-generator", name: "Fake Name Generator", url: "https://www.fakenamegenerator.com/", description: "Generates fictional identity details." },
    { id: "random-user", name: "Random User", url: "https://randomuser.me/", description: "Generates random user profiles." },
    { id: "this-person-does-not-exist", name: "This Person Does Not Exist", url: "https://thispersondoesnotexist.com/", description: "Generates synthetic profile photos." }
] as const;

export const PRIVACY_BROWSERS = [
    { id: "waterfox", name: "Waterfox", url: "https://www.waterfox.com/", description: "Privacy-focused Firefox-based browser." },
    { id: "mullvad", name: "Mullvad Browser", url: "https://mullvad.net/en/download/browser/windows", description: "Privacy browser developed with the Tor Project." },
    { id: "librewolf", name: "LibreWolf", url: "https://librewolf.net/", description: "Privacy-focused Firefox fork." }
] as const;

const BREACH_VIP_FIELDS: readonly string[] = [
    "uuid", "username", "ip", "domain", "discordid", "steamid", "email", "password", "name", "phone"
];

export const settings = definePluginSettings({
    cordCatApiKey: {
        type: OptionType.STRING,
        description: "CordCat API key used by the CordCat slash commands.",
        default: "",
        placeholder: "cc_your_api_key_here",
        componentProps: { type: "password" }
    },
    geoSeeerApiKey: {
        type: OptionType.STRING,
        description: "GeoSeeer API keys used for image geolocation. One key per line.",
        default: "",
        placeholder: "Enter one GeoSeeer API key per line.",
        multiline: true,
        componentProps: { type: "password" }
    },
    ipProvider: {
        type: OptionType.SELECT,
        description: "IP lookup provider used by /iplookup and /myip.",
        options: [
            { label: "freeipapi.com", value: "freeipapi", default: true },
            { label: "ip-api.com", value: "ip-api" },
            { label: "ipwho.is", value: "ipwhois" },
            { label: "ipapi.is", value: "ipapi-is" }
        ]
    },
    enableLogging: {
        type: OptionType.BOOLEAN,
        description: "Log lookup details while debugging.",
        default: false
    },
    clearRecentInvestigationsOnRestart: {
        type: OptionType.BOOLEAN,
        description: "Clear recent investigations whenever OSINT starts.",
        default: true
    },
    useAI: {
        type: OptionType.BOOLEAN,
        description: "Use AI for user scan analysis (requires API key)",
        default: false,
    },
    unlimitedMessages: {
        type: OptionType.BOOLEAN,
        description: "Fetch all messages (unlimited) with live-updating results",
        default: false,
    },
    scanMutualServers: {
        type: OptionType.BOOLEAN,
        description: "Scan messages across all mutual servers (slower but comprehensive)",
        default: false,
    },
    scanDMs: {
        type: OptionType.BOOLEAN,
        description: "Also scan DM conversations with the target user",
        default: false,
    },
    messageLimit: {
        type: OptionType.SLIDER,
        description: "Max messages per channel (ignored when unlimited is on)",
        markers: [25, 50, 100, 250, 500],
        default: 100,
        stickToMarkers: false,
    },
    aiProvider: {
        type: OptionType.SELECT,
        description: "AI provider for scan analysis",
        options: [
            { label: "Groq", value: "groq", default: true },
            { label: "OpenAI", value: "openai" },
            { label: "Anthropic", value: "anthropic" },
            { label: "Together AI", value: "together" },
            { label: "OpenRouter", value: "openrouter" },
            { label: "Localhost (Ollama/LM Studio)", value: "localhost" },
            { label: "Custom Endpoint", value: "custom" },
        ],
    },
    apiKey: {
        type: OptionType.STRING,
        description: "API key for the selected AI provider",
        default: "",
    },
    customApiUrl: {
        type: OptionType.STRING,
        description: "Custom API URL (for localhost/custom)",
        default: "http://localhost:11434",
    },
    customModel: {
        type: OptionType.STRING,
        description: "Custom model name (empty = provider default)",
        default: "",
    },
    use24hTime: {
        type: OptionType.BOOLEAN,
        description: "Use 24-hour time format in analysis results",
        default: false,
    },
});

function OSINTAbout() {
    return (
        <div style={{ padding: 12, borderRadius: 8, background: "var(--background-secondary)", border: "1px solid var(--background-modifier-accent)" }}>
            <strong>Lawful and authorized OSINT use only.</strong>
            <p style={{ margin: "6px 0 0", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>
                You are responsible for having a lawful purpose and any required legal basis before searching for another person.
                Queries can send identifiers to independent services including CordCat, Breach.vip and GeoSeeer. Review each provider&apos;s terms before use.
            </p>
            <p style={{ margin: "6px 0 0", color: "var(--text-muted)", fontSize: 12 }}>
                Commands: /osint, /domain, /iplookup, /myip, /usersearch, /breachvip, /cordcat, /cordcatuser, /cordcatinvite, /cordcatguild, /cordcatstatus.
            </p>
        </div>
    );
}
const SafeOSINTAbout = ErrorBoundary.wrap(OSINTAbout, { noop: true });

function debug(...args: unknown[]) {
    if (settings.store.enableLogging) logger.debug(...args);
}
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}
function getString(record: Record<string, unknown>, key: string): string | undefined {
    const value = record[key];
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
}
function getNumber(record: Record<string, unknown>, key: string): number | undefined {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "string") return undefined;
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
}
function getStringArray(record: Record<string, unknown>, key: string): string[] {
    const value = record[key];
    if (!Array.isArray(value)) return [];
    return value.flatMap(item => {
        if (typeof item !== "string") return [];
        const trimmed = item.trim();
        return trimmed ? [trimmed] : [];
    });
}
function firstString(value: unknown): string | undefined {
    if (!Array.isArray(value)) return undefined;
    for (const item of value) {
        if (typeof item === "string" && item.trim()) return item.trim();
    }
}
function normalizeDomain(input: string): string {
    const trimmed = input.trim();
    const parsed = parseUrl(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    const host = parsed?.hostname ?? trimmed;
    return host.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
}
function isValidDomain(domain: string): boolean {
    if (domain.length > 253) return false;
    const labels = domain.split(".");
    if (labels.length < 2) return false;
    return labels.every(label => label.length >= 1 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label));
}
function parseIPv4(ip: string): number[] | undefined {
    const parts = ip.split(".");
    if (parts.length !== 4) return undefined;
    const octets = parts.map(part => {
        if (!/^\d{1,3}$/.test(part)) return Number.NaN;
        return Number(part);
    });
    return octets.every(octet => Number.isInteger(octet) && octet >= 0 && octet <= 255) ? octets : undefined;
}
function isPublicIPv4(ip: string): boolean {
    const octets = parseIPv4(ip);
    if (!octets) return false;
    const [first, second] = octets;
    return !(
        first === 0 || first === 10 || first === 127 || first >= 224
        || (first === 100 && second >= 64 && second <= 127)
        || (first === 169 && second === 254)
        || (first === 172 && second >= 16 && second <= 31)
        || (first === 192 && second === 168)
        || (first === 198 && (second === 18 || second === 19))
    );
}
function normalizeUsername(input: string): string {
    return input.trim().replace(/^@+/, "");
}
async function fetchJson(url: string, init?: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    activeRequests.add(controller);
    try {
        const response = await fetch(url, { ...init, signal: controller.signal });
        if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
        return await response.json() as unknown;
    } finally {
        clearTimeout(timeout);
        activeRequests.delete(controller);
    }
}
function getRegistrar(entities: unknown): string | undefined {
    if (!Array.isArray(entities)) return undefined;
    for (const entity of entities) {
        if (!isRecord(entity) || !Array.isArray(entity.roles) || !entity.roles.includes("registrar")) continue;
        const vcardRows = Array.isArray(entity.vcardArray) ? entity.vcardArray[1] : undefined;
        if (!Array.isArray(vcardRows)) continue;
        for (const row of vcardRows) {
            if (Array.isArray(row) && row[0] === "fn" && typeof row[3] === "string" && row[3].trim()) return row[3].trim();
        }
    }
}
function getEventDate(events: unknown, actions: string[]): string | undefined {
    if (!Array.isArray(events)) return undefined;
    for (const event of events) {
        if (!isRecord(event)) continue;
        const action = getString(event, "eventAction");
        if (action && actions.includes(action)) return getString(event, "eventDate");
    }
}
function getNameServers(nameServers: unknown): string[] {
    if (!Array.isArray(nameServers)) return [];
    return nameServers.flatMap(nameServer => {
        if (!isRecord(nameServer)) return [];
        const name = getString(nameServer, "ldhName");
        return name ? [name] : [];
    });
}
interface DomainInfo {
    domain: string;
    registrar?: string;
    registrationDate?: string;
    expirationDate?: string;
    updatedAt?: string;
    status: string[];
    nameServers: string[];
    dnssec: "Signed" | "Unsigned" | "Unknown";
}
interface IPInfo { ip: string; [key: string]: unknown; }
interface GeoLocation { latitude: number; longitude: number; confidence?: number; address?: string; reasoning?: string; }
interface GeoAnalysis { locations: GeoLocation[]; processingTime?: string; requestsRemaining?: number; }

async function getDomainInfo(domain: string): Promise<DomainInfo | undefined> {
    const data = await fetchJson(`https://rdap.org/domain/${encodeURIComponent(domain)}`);
    if (!isRecord(data)) return undefined;
    const { secureDNS } = data;
    const dnssec = isRecord(secureDNS) ? secureDNS.delegationSigned === true ? "Signed" : "Unsigned" : "Unknown";
    return {
        domain: getString(data, "ldhName") ?? domain,
        registrar: getRegistrar(data.entities),
        registrationDate: getEventDate(data.events, ["registration", "registered"]),
        expirationDate: getEventDate(data.events, ["expiration", "expire"]),
        updatedAt: getEventDate(data.events, ["last changed", "last update of RDAP database"]),
        status: getStringArray(data, "status"),
        nameServers: getNameServers(data.nameservers),
        dnssec
    };
}
type IpProvider = "freeipapi" | "ip-api" | "ipwhois" | "ipapi-is";
function getProviderUrl(ip?: string): string {
    switch (settings.store.ipProvider as IpProvider) {
        case "ip-api": return ip ? `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=66846719` : "http://ip-api.com/json/?fields=66846719";
        case "ipwhois": return ip ? `https://ipwho.is/${encodeURIComponent(ip)}` : "https://ipwho.is/";
        case "ipapi-is": return ip ? `https://api.ipapi.is/?q=${encodeURIComponent(ip)}` : "https://api.ipapi.is/";
        default: return ip ? `https://free.freeipapi.com/api/json/${encodeURIComponent(ip)}` : "https://free.freeipapi.com/api/json";
    }
}
function parseProviderResponse(data: Record<string, unknown>, ip?: string): IPInfo {
    switch (settings.store.ipProvider as IpProvider) {
        case "ip-api":
            return {
                ip: (data.query as string) ?? ip ?? "",
                continent: data.continent, continentCode: data.continentCode, country: data.country, countryCode: data.countryCode,
                region: data.regionName, regionCode: data.region, city: data.city, district: data.district, zip: data.zip,
                lat: data.lat, lon: data.lon, timezone: data.timezone, utcOffset: data.offset, currency: data.currency,
                isp: data.isp, org: data.org, as: data.as, asname: data.asname, reverse: data.reverse, mobile: data.mobile, proxy: data.proxy, hosting: data.hosting
            };
        case "ipwhois":
            return {
                ip: (data.ip as string) ?? ip ?? "",
                type: data.type, continent: data.continent, continentCode: data.continent_code, country: data.country, countryCode: data.country_code,
                region: data.region, city: data.city, lat: data.latitude, lon: data.longitude, postal: data.postal, callingCode: data.calling_code,
                capital: data.capital, isEU: data.is_eu, flag: (data.flag as Record<string, unknown>)?.emoji,
                asn: (data.connection as Record<string, unknown>)?.asn, org: (data.connection as Record<string, unknown>)?.org,
                isp: (data.connection as Record<string, unknown>)?.isp, domain: (data.connection as Record<string, unknown>)?.domain,
                timezone: (data.timezone as Record<string, unknown>)?.id, timezoneAbbr: (data.timezone as Record<string, unknown>)?.abbr,
                timezoneUtc: (data.timezone as Record<string, unknown>)?.utc, currentTime: (data.timezone as Record<string, unknown>)?.current_time,
                proxy: (data.security as Record<string, unknown>)?.proxy, vpn: (data.security as Record<string, unknown>)?.vpn,
                tor: (data.security as Record<string, unknown>)?.tor, hosting: (data.security as Record<string, unknown>)?.hosting,
                anonymous: (data.security as Record<string, unknown>)?.anonymous
            };
        case "ipapi-is":
            return {
                ip: (data.ip as string) ?? ip ?? "",
                rir: data.rir, isBogon: data.is_bogon, isMobile: data.is_mobile, isSatellite: data.is_satellite, isCrawler: data.is_crawler,
                isDatacenter: data.is_datacenter, isTor: data.is_tor, isProxy: data.is_proxy, isVpn: data.is_vpn, isAbuser: data.is_abuser,
                datacenterName: (data.datacenter as Record<string, unknown>)?.datacenter, datacenterDomain: (data.datacenter as Record<string, unknown>)?.domain,
                datacenterNetwork: (data.datacenter as Record<string, unknown>)?.network, datacenterRegion: (data.datacenter as Record<string, unknown>)?.region,
                datacenterService: (data.datacenter as Record<string, unknown>)?.service,
                companyName: (data.company as Record<string, unknown>)?.name, companyAbuserScore: (data.company as Record<string, unknown>)?.abuser_score,
                companyDomain: (data.company as Record<string, unknown>)?.domain, companyType: (data.company as Record<string, unknown>)?.type,
                companyNetwork: (data.company as Record<string, unknown>)?.network, companyNetname: (data.company as Record<string, unknown>)?.netname,
                abuseName: (data.abuse as Record<string, unknown>)?.name, abuseAddress: (data.abuse as Record<string, unknown>)?.address,
                abuseEmail: (data.abuse as Record<string, unknown>)?.email, abusePhone: (data.abuse as Record<string, unknown>)?.phone,
                asn: (data.asn as Record<string, unknown>)?.asn, asnAbuserScore: (data.asn as Record<string, unknown>)?.abuser_score,
                asnRoute: (data.asn as Record<string, unknown>)?.route, asnDescr: (data.asn as Record<string, unknown>)?.descr,
                asnCountry: (data.asn as Record<string, unknown>)?.country, asnActive: (data.asn as Record<string, unknown>)?.active,
                asnOrg: (data.asn as Record<string, unknown>)?.org, asnDomain: (data.asn as Record<string, unknown>)?.domain,
                asnAbuse: (data.asn as Record<string, unknown>)?.abuse, asnType: (data.asn as Record<string, unknown>)?.type,
                asnCreated: (data.asn as Record<string, unknown>)?.created, asnUpdated: (data.asn as Record<string, unknown>)?.updated,
                asnRir: (data.asn as Record<string, unknown>)?.rir,
                isEU: (data.location as Record<string, unknown>)?.is_eu_member, callingCode: (data.location as Record<string, unknown>)?.calling_code,
                currencyCode: (data.location as Record<string, unknown>)?.currency_code, continent: (data.location as Record<string, unknown>)?.continent,
                country: (data.location as Record<string, unknown>)?.country, countryCode: (data.location as Record<string, unknown>)?.country_code,
                state: (data.location as Record<string, unknown>)?.state, city: (data.location as Record<string, unknown>)?.city,
                lat: (data.location as Record<string, unknown>)?.latitude, lon: (data.location as Record<string, unknown>)?.longitude,
                zip: (data.location as Record<string, unknown>)?.zip, timezone: (data.location as Record<string, unknown>)?.timezone,
                localTime: (data.location as Record<string, unknown>)?.local_time, localTimeUnix: (data.location as Record<string, unknown>)?.local_time_unix,
                isDst: (data.location as Record<string, unknown>)?.is_dst, utcOffset: (data.location as Record<string, unknown>)?.utcoffset,
                accuracy: (data.location as Record<string, unknown>)?.accuracy,
                vpnService: (data.vpn as Record<string, unknown>)?.service, vpnUrl: (data.vpn as Record<string, unknown>)?.url,
                vpnType: (data.vpn as Record<string, unknown>)?.type, vpnLastSeen: (data.vpn as Record<string, unknown>)?.last_seen_str,
                vpnRegion: (data.vpn as Record<string, unknown>)?.exit_node_region, elapsedMs: data.elapsed_ms
            };
        default: {
            const timezone = firstString(data.timeZones) ?? getString(data, "timeZone") ?? getString(data, "timezone");
            const currency = isRecord(data.currency) ? `${(data.currency.name as string) ?? ""} (${(data.currency.code as string) ?? ""})` : undefined;
            return {
                ip: getString(data, "ipAddress") ?? getString(data, "ip") ?? ip ?? "",
                ipVersion: data.ipVersion, continent: data.continent, continentCode: data.continentCode, country: data.countryName,
                countryCode: data.countryCode, region: data.regionName, city: data.cityName, lat: getNumber(data, "latitude"),
                lon: getNumber(data, "longitude"), zip: data.zipCode, timezone, isProxy: data.isProxy, currency, language: data.language
            };
        }
    }
}
async function getIPInfo(ip?: string): Promise<IPInfo | undefined> {
    const data = await fetchJson(getProviderUrl(ip));
    if (!isRecord(data)) return undefined;
    return parseProviderResponse(data, ip);
}
function calculateDomainAge(registrationDate: string): string {
    const timestamp = Date.parse(registrationDate);
    if (Number.isNaN(timestamp)) return "Unknown";
    const days = Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
    return formatDurationVerbose(days, "days", true);
}
function formatDate(value?: string): string {
    if (!value) return "N/A";
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? value : new Date(timestamp).toLocaleString();
}
function formatLimited(values: string[], limit = 4): string {
    if (!values.length) return "N/A";
    if (values.length <= limit) return values.join(", ");
    return `${values.slice(0, limit).join(", ")} and ${values.length - limit} more`;
}
function createDomainMessage(info: DomainInfo): string {
    const ageText = info.registrationDate ? calculateDomainAge(info.registrationDate) : "Unknown";
    return makeCodeblock([
        `[DOMAIN LOOKUP] ${info.domain}`,
        `Registration : ${formatDate(info.registrationDate)}`,
        `Age          : ${ageText}`,
        `Expiration   : ${formatDate(info.expirationDate)}`,
        `Registrar    : ${info.registrar ?? "Unknown"}`,
        `Updated      : ${formatDate(info.updatedAt)}`,
        `DNSSEC       : ${info.dnssec}`,
        `Status       : ${formatLimited(info.status)}`,
        `Name servers : ${formatLimited(info.nameServers)}`
    ].join("\n"), "txt");
}
function fmtLine(label: string, value: unknown): string | null {
    if (value === undefined || value === null || value === "") return null;
    return `${label.padEnd(20)}: ${value}`;
}
function createIPMessage(info: IPInfo): string {
    const provider = settings.store.ipProvider as IpProvider;
    const coords = typeof info.lat === "number" && typeof info.lon === "number" ? `${info.lat}, ${info.lon}` : undefined;
    let lines: (string | null)[];
    switch (provider) {
        case "ipapi-is":
            lines = [
                "```txt",
                `[IP LOOKUP - ipapi.is] ${info.ip}`,
                fmtLine("RIR", info.rir), fmtLine("Is Bogon", info.isBogon), fmtLine("Is Mobile", info.isMobile), fmtLine("Is Satellite", info.isSatellite),
                fmtLine("Is Crawler", info.isCrawler), fmtLine("Is Datacenter", info.isDatacenter), fmtLine("Is Tor", info.isTor), fmtLine("Is Proxy", info.isProxy), fmtLine("Is VPN", info.isVpn), fmtLine("Is Abuser", info.isAbuser),
                "", "── Location ──",
                fmtLine("Continent", info.continent), fmtLine("Country", info.country), fmtLine("Country Code", info.countryCode), fmtLine("State", info.state), fmtLine("City", info.city), fmtLine("ZIP", info.zip), fmtLine("Coordinates", coords), fmtLine("Timezone", info.timezone), fmtLine("Local Time", info.localTime), fmtLine("Is DST", info.isDst), fmtLine("UTC Offset", info.utcOffset), fmtLine("Accuracy", info.accuracy), fmtLine("Is EU Member", info.isEU), fmtLine("Calling Code", info.callingCode), fmtLine("Currency", info.currencyCode),
                "", "── ASN ──",
                fmtLine("ASN", info.asn), fmtLine("Route", info.asnRoute), fmtLine("Description", info.asnDescr), fmtLine("Country", info.asnCountry), fmtLine("Active", info.asnActive), fmtLine("Org", info.asnOrg), fmtLine("Domain", info.asnDomain), fmtLine("Type", info.asnType), fmtLine("Abuse Email", info.asnAbuse), fmtLine("Abuser Score", info.asnAbuserScore), fmtLine("Created", info.asnCreated), fmtLine("Updated", info.asnUpdated), fmtLine("RIR", info.asnRir),
                "", "── Company ──",
                fmtLine("Name", info.companyName), fmtLine("Domain", info.companyDomain), fmtLine("Type", info.companyType), fmtLine("Network", info.companyNetwork), fmtLine("Netname", info.companyNetname), fmtLine("Abuser Score", info.companyAbuserScore),
                "", "── Abuse Contact ──",
                fmtLine("Name", info.abuseName), fmtLine("Address", info.abuseAddress), fmtLine("Email", info.abuseEmail), fmtLine("Phone", info.abusePhone),
                "", "── Datacenter ──",
                fmtLine("Name", info.datacenterName), fmtLine("Domain", info.datacenterDomain), fmtLine("Network", info.datacenterNetwork), fmtLine("Region", info.datacenterRegion), fmtLine("Service", info.datacenterService),
                info.vpnService ? "" : null, info.vpnService ? "── VPN ──" : null,
                fmtLine("Service", info.vpnService), fmtLine("URL", info.vpnUrl), fmtLine("Type", info.vpnType), fmtLine("Last Seen", info.vpnLastSeen), fmtLine("Region", info.vpnRegion),
                "", fmtLine("Elapsed", info.elapsedMs != null ? `${info.elapsedMs}ms` : undefined), "```"
            ];
            break;
        case "ip-api":
            lines = [
                "```txt",
                `[IP LOOKUP - ip-api.com] ${info.ip}`,
                fmtLine("Continent", info.continent), fmtLine("Continent Code", info.continentCode), fmtLine("Country", info.country), fmtLine("Country Code", info.countryCode), fmtLine("Region", info.region), fmtLine("Region Code", info.regionCode), fmtLine("City", info.city), fmtLine("District", info.district), fmtLine("ZIP", info.zip), fmtLine("Coordinates", coords), fmtLine("Timezone", info.timezone), fmtLine("UTC Offset", info.utcOffset != null ? `${info.utcOffset}s` : undefined), fmtLine("Currency", info.currency), fmtLine("ISP", info.isp), fmtLine("Organization", info.org), fmtLine("AS", info.as), fmtLine("AS Name", info.asname), fmtLine("Reverse DNS", info.reverse), fmtLine("Mobile", info.mobile), fmtLine("Proxy", info.proxy), fmtLine("Hosting", info.hosting), "```"
            ];
            break;
        case "ipwhois":
            lines = [
                "```txt",
                `[IP LOOKUP - ipwho.is] ${info.ip}`,
                fmtLine("Type", info.type), fmtLine("Continent", info.continent), fmtLine("Continent Code", info.continentCode), fmtLine("Country", info.country), fmtLine("Country Code", info.countryCode), fmtLine("Region", info.region), fmtLine("City", info.city), fmtLine("Postal", info.postal), fmtLine("Coordinates", coords), fmtLine("Calling Code", info.callingCode), fmtLine("Capital", info.capital), fmtLine("Is EU", info.isEU), fmtLine("Flag", info.flag),
                "", "── Connection ──",
                fmtLine("ASN", info.asn), fmtLine("Organization", info.org), fmtLine("ISP", info.isp), fmtLine("Domain", info.domain),
                "", "── Timezone ──",
                fmtLine("Timezone", info.timezone), fmtLine("Abbreviation", info.timezoneAbbr), fmtLine("UTC", info.timezoneUtc), fmtLine("Current Time", info.currentTime),
                "", "── Security ──",
                fmtLine("Anonymous", info.anonymous), fmtLine("Proxy", info.proxy), fmtLine("VPN", info.vpn), fmtLine("Tor", info.tor), fmtLine("Hosting", info.hosting), "```"
            ];
            break;
        default:
            lines = [
                "```txt",
                `[IP LOOKUP - freeipapi.com] ${info.ip}`,
                fmtLine("IP Version", info.ipVersion), fmtLine("Continent", info.continent), fmtLine("Continent Code", info.continentCode), fmtLine("Country", info.country), fmtLine("Country Code", info.countryCode), fmtLine("Region", info.region), fmtLine("City", info.city), fmtLine("ZIP", info.zip), fmtLine("Coordinates", coords), fmtLine("Timezone", info.timezone), fmtLine("Currency", info.currency), fmtLine("Language", info.language), fmtLine("Is Proxy", info.isProxy), "```"
            ];
            break;
    }
    return lines.filter(line => line !== null).join("\n");
}
export function getUsernameSearchUrls(username: string) {
    const encoded = encodeURIComponent(username);
    return {
        userSearch: `https://usersearch.org/results.php?type=standard&URL_username=${encoded}`,
        whatsMyName: `https://whatsmyname.app/?q=${encoded}`
    };
}
function createUserSearchMessage(username: string): string {
    const urls = getUsernameSearchUrls(username);
    return makeCodeblock([`[USER SEARCH] ${username}`, `UserSearch  : ${urls.userSearch}`, `WhatsMyName : ${urls.whatsMyName}`].join("\n"), "txt");
}
function createBreachVipMessage(results: unknown[], total: number): string {
    if (!total) return makeCodeblock("[BREACH.VIP]\nNo matching records found.", "txt");
    const lines = ["[BREACH.VIP]", `Results: ${total}`, ""];
    let shown = 0;
    for (const result of results.slice(0, 10)) {
        const serialized = JSON.stringify(result) ?? String(result);
        const line = `${shown + 1}. ${serialized.slice(0, 600)}${serialized.length > 600 ? "..." : ""}`;
        if (lines.join("\n").length + line.length > 1_750) break;
        lines.push(line);
        shown++;
    }
    if (shown < total) lines.push("", `Showing ${shown} of ${total} results.`);
    return makeCodeblock(lines.join("\n"), "json");
}
function createCordCatMessage(tool: CordCatTool, data: unknown): string {
    const serialized = JSON.stringify(data, null, 2) ?? "null";
    const truncated = serialized.length > 1_750 ? `${serialized.slice(0, 1_750)}\n... Response truncated.` : serialized;
    return `**CordCat ${CORDCAT_TITLES[tool]}**\n${makeCodeblock(truncated, "json")}`;
}
async function executeCordCat(tool: CordCatTool, value: string, refresh: boolean, ctx: CommandContext) {
    try {
        const data = await lookupCordCat(tool, value, refresh);
        if (!pluginActive) return;
        sendBotMessage(ctx.channel.id, { content: createCordCatMessage(tool, data) });
    } catch (error) {
        sendBotMessage(ctx.channel.id, { content: error instanceof Error ? error.message : "Could not complete the CordCat lookup." });
    }
}
export async function lookupDomain(input: string): Promise<DomainInfo> {
    const domain = normalizeDomain(input);
    if (!isValidDomain(domain)) throw new Error("Invalid domain. Use a root domain like example.com.");
    const info = await getDomainInfo(domain);
    if (!info) throw new Error(`Could not retrieve public RDAP information for ${domain}.`);
    return info;
}
export async function lookupIP(input?: string): Promise<IPInfo> {
    const ip = input?.trim();
    if (ip && !isPublicIPv4(ip)) throw new Error("Invalid public IPv4 address. Use an address like 8.8.8.8.");
    const info = await getIPInfo(ip);
    if (!info) throw new Error("Could not retrieve public IP information.");
    return info;
}
export function lookupUsername(input: string) {
    const username = normalizeUsername(input);
    if (!username) throw new Error("Invalid username.");
    return getUsernameSearchUrls(username);
}
export async function lookupBreachVip(term: string, fields: string[], minecraft: boolean, wildcard: boolean, caseSensitive: boolean): Promise<{ results: unknown[]; total: number; }> {
    const result = await Native.searchBreachVip(term, fields, minecraft, wildcard, caseSensitive);
    if (!result.success) throw new Error(result.error);
    return { results: result.results, total: result.total };
}
export async function lookupCordCat(tool: CordCatTool, value: string, refresh: boolean): Promise<unknown> {
    const apiKey = settings.store.cordCatApiKey.trim();
    if (tool !== "status" && !apiKey) throw new Error("Your CordCat API key is missing. Add it in OSINT settings.");
    debug("Querying CordCat", tool, value);
    const result = await Native.queryCordCat(tool, value, refresh, apiKey);
    if (!result.success) throw new Error(result.error);
    return result.data;
}
export async function geolocateImage(imageUrl: string): Promise<GeoAnalysis> {
    const apiKeys = [...new Set(settings.store.geoSeeerApiKey.split(/\r?\n/).map(key => key.trim()).filter(Boolean))];
    if (!apiKeys.length) throw new Error("Your GeoSeeer API keys are missing. Add at least one key in OSINT settings.");
    const parsedUrl = parseUrl(imageUrl);
    if (!parsedUrl || (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:")) throw new Error("Enter a public HTTP or HTTPS image URL.");
    const analysis = await analyzeGeoImage(parsedUrl.href, apiKeys);
    if (!analysis) throw new Error("GeoSeeer returned an invalid response.");
    return analysis;
}
export async function getRecentInvestigations(): Promise<unknown> {
    await recentInvestigationsReady;
    const data = await DataStore.get<unknown>(OSINT_HISTORY_KEY);
    if (data != null) return data;
    const legacy = await DataStore.get<unknown>("OSINTToolkit_recentInvestigations");
    return legacy;
}
function parseGeoAnalysis(data: unknown): GeoAnalysis | undefined {
    if (!isRecord(data) || data.status !== "success" || !Array.isArray(data.locations)) return;
    const locations = data.locations.flatMap(location => {
        if (!isRecord(location)) return [];
        const latitude = getNumber(location, "latitude");
        const longitude = getNumber(location, "longitude");
        if (latitude === undefined || longitude === undefined) return [];
        return [{ latitude, longitude, confidence: getNumber(location, "confidence"), address: getString(location, "address"), reasoning: getString(location, "reasoning") }];
    });
    return { locations, processingTime: getString(data, "processing_time"), requestsRemaining: getNumber(data, "API_Requests_remaining") };
}
async function analyzeGeoImage(imageUrl: string, apiKeys: string[]): Promise<GeoAnalysis | undefined> {
    const firstKey = nextGeoSeeerApiKey % apiKeys.length;
    nextGeoSeeerApiKey = (firstKey + 1) % apiKeys.length;
    for (let offset = 0; offset < apiKeys.length; offset++) {
        const result = await Native.analyzeGeoImage(imageUrl, apiKeys[(firstKey + offset) % apiKeys.length]);
        if (result.success) return parseGeoAnalysis(result.data);
        if (!result.retryable || offset === apiKeys.length - 1) throw new Error(result.error);
    }
    return undefined;
}
function createGeoAnalysisMessage(analysis: GeoAnalysis): string {
    const lines = ["[GEO OSINT]"];
    if (!analysis.locations.length) {
        lines.push("No likely locations found.");
    } else {
        analysis.locations.slice(0, 3).forEach((location, index) => {
            lines.push("", `Candidate ${index + 1}`, `Address     : ${location.address ?? "Unknown"}`, `Coordinates : ${location.latitude}, ${location.longitude}`, `Confidence  : ${location.confidence === undefined ? "Unknown" : `${Math.round(location.confidence * 100)}%`}`, `Reasoning   : ${location.reasoning?.replace(/\s+/g, " ").slice(0, 400) ?? "Not provided"}`);
        });
    }
    if (analysis.processingTime) lines.push("", `Processing time    : ${analysis.processingTime}`);
    if (analysis.requestsRemaining !== undefined) lines.push(`Requests remaining : ${analysis.requestsRemaining}`);
    return makeCodeblock(lines.join("\n"), "txt");
}
function getDiscordUserUrl(user: User): string {
    return `https://discord.com/users/${encodeURIComponent(user.id)}`;
}
function getAvatarSearchUrl(avatarUrl: string): string {
    return `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(avatarUrl)}`;
}
export function openExternal(url: string) {
    VencordNative.native.openExternal(url);
}
function GeoImageIcon(props: ComponentProps<typeof ImageIcon>) {
    return <ImageIcon {...props} className={classes(props.className, "vc-osint-geo-icon")} />;
}
function abortActiveRequests() {
    activeRequests.forEach(controller => controller.abort());
    activeRequests.clear();
}

interface HistoryEntry {
    userId: string;
    username: string;
    globalName?: string;
    avatar?: string;
    messageCount: number;
    scannedAt: number;
    algorithmResult?: AlgorithmResult;
    aiResult?: string;
    mode: string;
}
async function loadHistory(): Promise<HistoryEntry[]> {
    const primary = await DataStore.get(SCAN_HISTORY_KEY) as HistoryEntry[] | undefined;
    if (primary?.length) return primary;
    const legacy = await DataStore.get("testcord-osint-history") as HistoryEntry[] | undefined;
    return legacy ?? [];
}
async function saveToHistory(entry: HistoryEntry): Promise<void> {
    const history = await loadHistory();
    history.unshift(entry);
    if (history.length > MAX_SCAN_HISTORY) history.length = MAX_SCAN_HISTORY;
    await DataStore.set(SCAN_HISTORY_KEY, history);
    await DataStore.set("testcord-osint-history", history);
}
async function removeFromHistory(userId: string): Promise<void> {
    const history = await loadHistory();
    await DataStore.set(SCAN_HISTORY_KEY, history.filter(h => h.userId !== userId));
    await DataStore.set("testcord-osint-history", history.filter(h => h.userId !== userId));
}
interface MutualGuildInfo { id: string; name: string; iconUrl: string | null; }
function getMutualGuildsForUser(userId: string): MutualGuildInfo[] {
    const guilds: MutualGuildInfo[] = [];
    const allGuilds = GuildStore.getGuilds();
    for (const guild of Object.values(allGuilds)) {
        if (!GuildMemberStore.isMember(guild.id, userId)) continue;
        const iconUrl = guild.icon ? IconUtils.getGuildIconURL({ id: guild.id, icon: guild.icon, size: 20 }) ?? null : null;
        guilds.push({ id: guild.id, name: guild.name, iconUrl });
    }
    return guilds;
}
function canAccessChannel(channelId: string): boolean {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return false;
    if (!channel.guild_id) return true;
    return PermissionStore.can(PermissionsBits.VIEW_CHANNEL, channel) && PermissionStore.can(PermissionsBits.READ_MESSAGE_HISTORY, channel);
}
function getDMChannelsWithUser(userId: string): string[] {
    const dmChannelIds: string[] = [];
    const privateChannels = ChannelStore.getMutablePrivateChannels();
    for (const [id, channel] of Object.entries(privateChannels)) {
        if (channel.type !== 1) continue;
        const { recipients } = (channel as any);
        if (Array.isArray(recipients) && recipients.includes(userId)) dmChannelIds.push(id);
    }
    return dmChannelIds;
}
function toMessageData(msg: Message, ctx?: { channelId?: string; guildId?: string; }): MessageData {
    const raw = msg as any;
    const channelId = raw.channel_id ?? ctx?.channelId;
    const channel = channelId ? ChannelStore.getChannel(channelId) : null;
    const guildId = raw.guildId ?? ctx?.guildId ?? channel?.guild_id;
    return {
        id: msg.id,
        content: msg.content,
        timestamp: String(msg.timestamp),
        author: {
            id: msg.author.id,
            username: msg.author.username,
            globalName: (msg.author as any).globalName,
            discriminator: (msg.author as any).discriminator,
            avatar: msg.author.avatar,
            banner: (msg.author as any).banner,
            accentColor: (msg.author as any).accentColor,
            publicFlags: (msg.author as any).publicFlags,
            bot: msg.author.bot,
        },
        attachments: (msg.attachments ?? []).map(a => ({
            filename: a.filename, url: a.url, content_type: a.content_type, size: a.size, width: a.width, height: a.height,
        })),
        embeds: msg.embeds ?? [],
        reactions: msg.reactions,
        stickerItems: raw.stickerItems ?? raw.sticker_items,
        message_reference: raw.messageReference ?? raw.message_reference,
        type: msg.type,
        flags: msg.flags,
        tts: raw.tts,
        pinned: msg.pinned,
        editedTimestamp: raw.editedTimestamp ?? null,
        interaction: raw.interaction ? { name: raw.interaction.name, applicationId: raw.interaction.applicationId } : undefined,
        mentionsList: (msg.mentions ?? []).filter((u: any) => u?.id).map((u: any) => ({ id: u.id, username: u.username ?? "unknown" })),
        referencedAuthor: raw.referencedMessage?.author ? { id: raw.referencedMessage.author.id, username: raw.referencedMessage.author.username ?? "" } : undefined,
        channelId,
        channelName: channel?.name,
        guildId,
        guildName: GuildStore.getGuild(guildId)?.name,
    } as MessageData;
}
interface FetchState { running: boolean; aborted: boolean; total: number; }
async function searchMessages(userId: string, guildId: string | null, channelId: string, offset: number): Promise<{ messages: Message[]; total: number; }> {
    const query: Record<string, any> = { author_id: userId, sort_by: "timestamp", sort_order: "desc", offset, limit: 25 };
    const channel = ChannelStore.getChannel(channelId);
    const channelBelongsToGuild = channel?.guild_id && channel.guild_id === guildId;
    if (channelBelongsToGuild) query.channel_id = channelId;
    const url = guildId ? Constants.Endpoints.SEARCH_GUILD(guildId) : `/channels/${channelId}/messages/search`;
    const res = await RestAPI.get({ url, query, retries: 2 });
    const body = res?.body as any;
    const flat: Message[] = (body?.messages ?? []).flat();
    return { messages: flat, total: body?.total_results ?? 0 };
}
async function buildAIPrompt(messages: MessageData[], algorithmResult: AlgorithmResult): Promise<string> {
    const user = messages[0]?.author;
    const username = user?.globalName || user?.username || "Unknown";
    const messageSummaries = messages.slice(0, 200).map(m => `[${new Date(m.timestamp).toISOString()}] ${m.content || "(no text)"}`).join("\n");
    const attachInfo = messages.flatMap(m => m.attachments.map(a => `  - ${a.filename} (${a.content_type}, ${a.size} bytes)`)).join("\n");
    return `You are an OSINT analyst. Analyze the following Discord user based on their message history and provide a comprehensive profile.\n\nUser: ${username} (ID: ${user?.id})\nMessages analyzed: ${messages.length}\n\nAlgorithm Analysis Results:\n${algorithmResult.sections.map(s => `${s.title}:\n${s.content}`).join("\n\n")}\n\nMessage Samples (first 200):\n${messageSummaries}\n\nAttachments:\n${attachInfo || "None"}\n\nProvide a detailed OSINT profile including:\n1. Personality Assessment\n2. Interests & Topics\n3. Activity Patterns\n4. Social Behavior\n5. Technical Profile\n6. Notable Observations\n7. Risk Indicators\n\nBe thorough but factual. Base everything on the data provided.`;
}
function ResultSections({ algorithmResult, aiResult }: { algorithmResult: AlgorithmResult | null; aiResult: string; }) {
    return (
        <>
            {algorithmResult?.sections.map((section, i) => (
                <div key={i} className="vc-osint-section">
                    <div className="vc-osint-section-title">{section.title}</div>
                    <div className="vc-osint-section-content">{section.content}</div>
                </div>
            ))}
            {aiResult && (
                <div className="vc-osint-section">
                    <div className="vc-osint-section-title">AI Analysis</div>
                    <div className="vc-osint-section-content">{aiResult}</div>
                </div>
            )}
        </>
    );
}
function LinksModal({ modalProps, messages }: { modalProps: any; messages: MessageData[]; }) {
    const urlRegex = /https?:\/\/[^\s<>"')\]]+/g;
    const links = new Map<string, { count: number; firstTimestamp: string; }>();
    for (const msg of messages) {
        const matches = msg.content.match(urlRegex);
        if (!matches) continue;
        for (const url of matches) {
            const cleaned = url.replace(/[.,;:!?)}\]]+$/, "");
            const existing = links.get(cleaned);
            if (existing) existing.count++;
            else links.set(cleaned, { count: 1, firstTimestamp: msg.timestamp });
        }
    }
    const sorted = [...links.entries()].sort((a, b) => b[1].count - a[1].count).map(([url, info]) => ({ url, ...info }));
    function copyAll() { navigator.clipboard.writeText(sorted.map(l => l.url).join("\n")); }
    return (
        <Modal {...modalProps} size="lg" className="vc-osint-root" title={
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", paddingRight: 8 }}>
                <div className="vc-osint-header-left">
                    <div className="vc-osint-header-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z" /></svg>
                    </div>
                    <div>
                        <div className="vc-osint-header-title">Links Found</div>
                        <div className="vc-osint-header-subtitle">{sorted.length} unique URL{sorted.length !== 1 ? "s" : ""}</div>
                    </div>
                </div>
                <Button size={Button.Sizes.SMALL} onClick={copyAll}>Copy All</Button>
            </div>
        }>
            <ModalContent>
                <div className="vc-osint-body">
                    {sorted.length === 0 && <div className="vc-osint-empty"><p>No links found in messages</p></div>}
                    {sorted.map(({ url, count, firstTimestamp }) => (
                        <div key={url} className="vc-osint-link-entry">
                            <a href={url} target="_blank" rel="noopener noreferrer" className="vc-osint-link-url" title={url}>{url}</a>
                            <div className="vc-osint-link-meta"><span>{count} time{count !== 1 ? "s" : ""}</span><span>{new Date(firstTimestamp).toLocaleDateString()}</span></div>
                        </div>
                    ))}
                </div>
            </ModalContent>
        </Modal>
    );
}
function AttachmentsModal({ modalProps, messages }: { modalProps: any; messages: MessageData[]; }) {
    const attachments = messages.flatMap(m => m.attachments.map(a => ({ ...a, timestamp: m.timestamp, messageId: m.id })));
    const imageExts = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]);
    const videoExts = new Set(["mp4", "webm", "mov", "avi", "mkv"]);
    const audioExts = new Set(["mp3", "ogg", "wav", "flac", "aac"]);
    function getAttachmentType(a: { filename: string; content_type?: string; }) {
        const ext = a.filename.split(".").pop()?.toLowerCase() ?? "";
        if (a.content_type?.startsWith("image/") || imageExts.has(ext)) return "image";
        if (a.content_type?.startsWith("video/") || videoExts.has(ext)) return "video";
        if (a.content_type?.startsWith("audio/") || audioExts.has(ext)) return "audio";
        return "other";
    }
    function formatSize(bytes: number) {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    const images = attachments.filter(a => getAttachmentType(a) === "image");
    const videos = attachments.filter(a => getAttachmentType(a) === "video");
    const audio = attachments.filter(a => getAttachmentType(a) === "audio");
    const other = attachments.filter(a => getAttachmentType(a) === "other");
    function copyAllUrls() { navigator.clipboard.writeText(attachments.map(a => a.url).join("\n")); }
    return (
        <Modal {...modalProps} size="lg" className="vc-osint-root" title={
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", paddingRight: 8 }}>
                <div className="vc-osint-header-left">
                    <div className="vc-osint-header-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" /></svg>
                    </div>
                    <div>
                        <div className="vc-osint-header-title">Attachments</div>
                        <div className="vc-osint-header-subtitle">{attachments.length} file{attachments.length !== 1 ? "s" : ""}</div>
                    </div>
                </div>
                <Button size={Button.Sizes.SMALL} onClick={copyAllUrls}>Copy URLs</Button>
            </div>
        }>
            <ModalContent>
                <div className="vc-osint-body">
                    {attachments.length === 0 && <div className="vc-osint-empty"><p>No attachments found</p></div>}
                    {images.length > 0 && (
                        <div className="vc-osint-section">
                            <div className="vc-osint-section-title">Images ({images.length})</div>
                            <div className="vc-osint-attachment-grid">
                                {images.map((a, i) => (
                                    <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" className="vc-osint-attachment-thumb">
                                        <img src={a.url} alt={a.filename} loading="lazy" />
                                        <div className="vc-osint-attachment-label">{a.filename}</div>
                                    </a>
                                ))}
                            </div>
                        </div>
                    )}
                    {videos.length > 0 && (
                        <div className="vc-osint-section">
                            <div className="vc-osint-section-title">Videos ({videos.length})</div>
                            {videos.map((a, i) => (
                                <div key={i} className="vc-osint-link-entry">
                                    <div className="vc-osint-link-url" title={a.filename}>{a.filename}</div>
                                    <div className="vc-osint-link-meta"><span>{formatSize(a.size)}</span>{a.width && a.height && <span>{a.width}x{a.height}</span>}</div>
                                </div>
                            ))}
                        </div>
                    )}
                    {audio.length > 0 && (
                        <div className="vc-osint-section">
                            <div className="vc-osint-section-title">Audio ({audio.length})</div>
                            {audio.map((a, i) => (
                                <div key={i} className="vc-osint-link-entry">
                                    <div className="vc-osint-link-url" title={a.filename}>{a.filename}</div>
                                    <div className="vc-osint-link-meta"><span>{formatSize(a.size)}</span></div>
                                </div>
                            ))}
                        </div>
                    )}
                    {other.length > 0 && (
                        <div className="vc-osint-section">
                            <div className="vc-osint-section-title">Other Files ({other.length})</div>
                            {other.map((a, i) => (
                                <div key={i} className="vc-osint-link-entry">
                                    <div className="vc-osint-link-url" title={a.filename}>{a.filename}</div>
                                    <div className="vc-osint-link-meta"><span>{formatSize(a.size)}</span></div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </ModalContent>
        </Modal>
    );
}
function OSINTScanPanel({ userId, channelId, modalProps }: { userId: string; channelId: string; modalProps: any; }) {
    const unlimited = settings.store.unlimitedMessages;
    const scanMutual = settings.store.scanMutualServers;
    const { scanDMs } = settings.store;
    const limit = settings.store.messageLimit;
    const [phase, setPhase] = useState<"fetching" | "analyzing" | "done" | "error">("fetching");
    const [progress, setProgress] = useState("Starting scan...");
    const [allMessages, setAllMessages] = useState<MessageData[]>([]);
    const [algorithmResult, setAlgorithmResult] = useState<AlgorithmResult | null>(null);
    const [aiResult, setAiResult] = useState<string>("");
    const [error, setError] = useState("");
    const [mutualGuilds, setMutualGuilds] = useState<MutualGuildInfo[]>([]);
    const [currentGuildName, setCurrentGuildName] = useState("");
    const [guildsScanned, setGuildsScanned] = useState(0);
    const [cordcatResult, setCordcatResult] = useState<CordCatResult | null>(null);
    const [cordcatLoading, setCordcatLoading] = useState(false);
    const fetchStateRef = useRef<FetchState>({ running: false, aborted: false, total: 0 } as FetchState);
    const messagesRef = useRef<MessageData[]>([]);
    const lastMessagesUpdateRef = useRef(0);
    const user = UserStore.getUser(userId);
    const runAnalysis = useCallback((msgs: MessageData[]) => {
        if (msgs.length === 0) return;
        setAlgorithmResult(analyzeMessages(msgs, settings.store.use24hTime));
    }, []);
    useEffect(() => {
        if (!userId) { setError("No user specified"); setPhase("error"); return; }
        if (!user) { setError("User not found"); setPhase("error"); return; }
        let cancelled = false;
        const state = fetchStateRef.current;
        state.running = true;
        state.aborted = false;
        state.total = 0;
        const acc: MessageData[] = [];
        messagesRef.current = acc;
        async function searchGuild(guildId: string | null, guildName: string, chanId?: string): Promise<void> {
            let offset = 0;
            while (state.running && !cancelled) {
                try {
                    const { messages, total } = await searchMessages(userId, guildId, chanId ?? channelId, offset);
                    if (cancelled || messages.length === 0) break;
                    acc.push(...messages.map(m => toMessageData(m, { channelId: chanId ?? channelId, guildId: guildId ?? undefined })));
                    state.total = acc.length;
                    const now = Date.now();
                    if (!unlimited || now - lastMessagesUpdateRef.current > 500) {
                        lastMessagesUpdateRef.current = now;
                        setAllMessages([...acc]);
                    }
                    offset += messages.length;
                    if (!unlimited && acc.length >= limit) break;
                    if (offset >= total) break;
                    await sleep(250);
                } catch (e: any) {
                    if (cancelled) break;
                    if (!unlimited) throw e;
                    await sleep(1000);
                }
            }
        }
        async function loop() {
            if (scanMutual) {
                const guilds = getMutualGuildsForUser(userId);
                setMutualGuilds(guilds);
                let scanned = 0;
                for (const guild of guilds) {
                    if (cancelled || !state.running) break;
                    if (!canAccessChannel(channelId) && guild.id !== ChannelStore.getChannel(channelId)?.guild_id) continue;
                    setCurrentGuildName(guild.name);
                    setProgress(`Searching ${guild.name}... (${scanned}/${guilds.length})`);
                    try {
                        await searchGuild(guild.id, guild.name);
                        scanned++;
                        setGuildsScanned(scanned);
                    } catch {}
                    if (acc.length > 0) runAnalysis([...acc]);
                }
                if (cancelled || !state.running) return;
            } else {
                const chan = ChannelStore.getChannel(channelId);
                const guildId = chan?.guild_id;
                if (!canAccessChannel(channelId)) { setError("No access to this channel"); setPhase("error"); return; }
                setCurrentGuildName(chan?.name || channelId);
                setProgress(unlimited ? "Searching current channel..." : `Searching ${chan?.name || "DM"}...`);
                await searchGuild(guildId ?? null, chan?.name || channelId, channelId);
            }
            if (scanDMs && !cancelled && state.running) {
                const dmChannels = getDMChannelsWithUser(userId);
                for (const dmId of dmChannels) {
                    if (cancelled || !state.running) break;
                    const dmChannel = ChannelStore.getChannel(dmId);
                    setCurrentGuildName(`DM: ${dmChannel?.name || dmId}`);
                    setProgress("Searching DMs...");
                    try { await searchGuild(null, "DM", dmId); } catch {}
                    if (acc.length > 0) runAnalysis([...acc]);
                }
            }
            if (!cancelled) {
                setAllMessages([...acc]);
                runAnalysis([...acc]);
                setPhase("analyzing");
                if (settings.store.useAI && acc.length > 0) {
                    try {
                        const prompt = await buildAIPrompt([...acc], analyzeMessages([...acc], settings.store.use24hTime));
                        const result = await callAI({
                            messages: [
                                { role: "system", content: "You are an expert OSINT analyst specializing in Discord user profiling. Be thorough, factual, and base all conclusions on the provided data." },
                                { role: "user", content: prompt },
                            ],
                            provider: settings.store.aiProvider,
                            model: settings.store.customModel || undefined,
                            customUrl: settings.store.customApiUrl,
                        });
                        setAiResult(result);
                    } catch (e: any) { setAiResult(`AI analysis failed: ${e.message}`); }
                }
                const finalResult = analyzeMessages([...acc], settings.store.use24hTime);
                saveToHistory({
                    userId,
                    username: user?.username ?? "",
                    globalName: (user as any)?.globalName,
                    avatar: user?.avatar,
                    messageCount: acc.length,
                    scannedAt: Date.now(),
                    algorithmResult: finalResult,
                    aiResult: aiResult || undefined,
                    mode: unlimited ? "unlimited" : `limited-${limit}`,
                });
                setPhase("done");
                state.running = false;
                setCordcatLoading(true);
                fetchCordCatData(userId).then(r => {
                    if (!cancelled && r) setCordcatResult(r);
                    setCordcatLoading(false);
                }).catch(() => setCordcatLoading(false));
            }
        }
        loop();
        return () => { cancelled = true; state.running = false; state.aborted = true; };
    }, [userId, channelId, unlimited, scanMutual, scanDMs, limit, runAnalysis]);
    function handleStop() {
        fetchStateRef.current.running = false;
        fetchStateRef.current.aborted = true;
        const msgs = messagesRef.current;
        if (msgs.length > 0) runAnalysis([...msgs]);
        setPhase("done");
    }
    function copyResults() {
        const text = [
            `OSINT Report: ${user?.globalName || user?.username} (${user?.username})`,
            `Scanned: ${new Date().toLocaleString()}`,
            `Messages: ${allMessages.length}`,
            `Mode: ${unlimited ? "Unlimited" : `Limited (${limit})`}${scanMutual ? " | Mutual servers" : ""}`,
            "",
            ...(algorithmResult?.sections ?? []).map(s => `[${s.title}]\n${s.content}`),
            "",
            ...(aiResult ? ["[AI Analysis]", aiResult] : []),
        ].filter(Boolean).join("\n\n");
        navigator.clipboard.writeText(text);
    }
    return (
        <Modal {...modalProps} size="lg" className="vc-osint-root" title={
            <div className="vc-osint-header-left">
                <div className="vc-osint-header-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
                </div>
                <div>
                    <div className="vc-osint-header-title">OSINT Scan</div>
                    <div className="vc-osint-header-subtitle">
                        {user ? `@${user.username}` : "Loading..."}
                        {scanMutual ? " | Mutual servers" : ""}
                        {unlimited ? " | Live" : ` | Limit: ${limit}`}
                    </div>
                </div>
            </div>
        }>
            <ModalContent>
                {phase === "error" && <div className="vc-osint-empty"><p>{error}</p></div>}
                {(phase === "fetching" || phase === "analyzing") && allMessages.length === 0 && (
                    <div className="vc-osint-progress">
                        <div className="vc-osint-spinner" />
                        <div>{progress}</div>
                        {unlimited && <button className="vc-osint-stop-btn" onClick={handleStop}>Stop & Analyze</button>}
                    </div>
                )}
                {allMessages.length > 0 && (
                    <div className="vc-osint-body">
                        <div className="vc-osint-user-info">
                            <img className="vc-osint-user-avatar" src={user?.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.webp?size=48` : `https://cdn.discordapp.com/embed/avatars/${(BigInt(userId) >> 22n) % 6n}.png`} alt="" />
                            <div className="vc-osint-user-details">
                                <div className="vc-osint-user-name">{user?.globalName || user?.username || "Unknown"}</div>
                                <div className="vc-osint-user-id">@{user?.username} | ID: {userId}</div>
                                {scanMutual && mutualGuilds.length > 0 && (
                                    <div className="vc-osint-guild-list">
                                        {mutualGuilds.map(g => (
                                            <span key={g.id} className="vc-osint-guild-chip">
                                                {g.iconUrl && <img src={g.iconUrl} alt="" />}
                                                {g.name}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div className="vc-osint-user-badges">
                                <span className="vc-osint-tag">{settings.store.useAI ? "AI" : "Algorithm"}</span>
                                {unlimited && phase === "fetching" && <span className="vc-osint-tag vc-osint-tag--live"><span className="vc-osint-live-dot" />LIVE</span>}
                            </div>
                        </div>
                        {phase === "fetching" && (
                            <div className="vc-osint-live-bar">
                                <div className="vc-osint-live-bar-left">
                                    <div className="vc-osint-spinner-small" />
                                    <span>{allMessages.length} messages</span>
                                    {scanMutual && <><span>|</span><span>{guildsScanned} guilds</span>{currentGuildName && <><span>|</span><span>{currentGuildName}</span></>}</>}
                                    {!scanMutual && currentGuildName && <><span>|</span><span>{currentGuildName}</span></>}
                                </div>
                                <Button size={Button.Sizes.SMALL} color={Button.Colors.RED} onClick={handleStop}>Stop & Analyze</Button>
                            </div>
                        )}
                        <ResultSections algorithmResult={algorithmResult} aiResult={aiResult} />
                        {(cordcatLoading || cordcatResult) && (
                            <div className={`vc-osint-section ${cordcatLoading ? "vc-osint-section--analyzing" : ""}`}>
                                <div className="vc-osint-section-title">
                                    {cordcatLoading && <div className="vc-osint-spinner-small" />}
                                    CordCat Intelligence
                                </div>
                                {!cordcatLoading && cordcatResult && (
                                    <div className="vc-osint-section-content">
                                        {cordcatResult.actions.length === 0 && cordcatResult.breaches.length === 0 && <div style={{ opacity: 0.6 }}>No DSA actions or breach records found.</div>}
                                        {cordcatResult.actions.length > 0 && (
                                            <div style={{ marginBottom: 12 }}>
                                                <div style={{ fontWeight: 600, marginBottom: 6 }}>DSA Actions ({cordcatResult.actions.length})</div>
                                                {cordcatResult.actions.map((a, i) => (
                                                    <div key={i} className="vc-osint-cordcat-action">
                                                        <div className="vc-osint-cordcat-action-header">
                                                            <span className="vc-osint-tag">{a.category}</span>
                                                            {a.application_date && <span className="vc-osint-cordcat-date">{a.application_date}</span>}
                                                        </div>
                                                        {a.decision_account && <div>Account: {a.decision_account}</div>}
                                                        {a.decision_visibility && <div>Visibility: {Array.isArray(a.decision_visibility) ? a.decision_visibility.join(", ") : a.decision_visibility}</div>}
                                                        {a.decision_provision && <div>Provision: {a.decision_provision}</div>}
                                                        {a.decision_monetary && <div>Monetary: {a.decision_monetary}</div>}
                                                        {a.decision_ground && <div>Ground: {a.decision_ground}</div>}
                                                        {a.incompatible_content_ground && <div>Content Ground: {a.incompatible_content_ground}</div>}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        {cordcatResult.breaches.length > 0 && (
                                            <div>
                                                <div style={{ fontWeight: 600, marginBottom: 6 }}>Breach Records ({cordcatResult.breaches.length})</div>
                                                {cordcatResult.breaches.map((b, i) => {
                                                    const leakedFields = [b.ip ? "IP" : null, b.username ? "username" : null, b.password ? "password" : null].filter(Boolean) as string[];
                                                    return (
                                                        <div key={i} className="vc-osint-cordcat-action">
                                                            <div className="vc-osint-cordcat-action-header">
                                                                <span className="vc-osint-tag">{b.source}</span>
                                                                {b.date && <span className="vc-osint-cordcat-date">{b.date}</span>}
                                                            </div>
                                                            {b.categories && b.categories.length > 0 && <div>Categories: {b.categories.join(", ")}</div>}
                                                            {b.ip && <div>IP: {b.ip}</div>}
                                                            {b.tag && <div>Username at leak: {b.tag}</div>}
                                                            {leakedFields.length > 0 && <div style={{ color: "var(--status-danger)" }}>Leaked data: {leakedFields.join(", ")}</div>}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                        {phase === "analyzing" && (
                            <div className="vc-osint-section vc-osint-section--analyzing">
                                <div className="vc-osint-section-title">
                                    <div className="vc-osint-spinner-small" />
                                    {settings.store.useAI ? "Running AI analysis..." : "Finalizing..."}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </ModalContent>
            {(phase === "done" || phase === "error") && (
                <ModalFooter>
                    {phase === "done" && (
                        <>
                            <Button size={Button.Sizes.SMALL} onClick={() => openModal(p => <LinksModal modalProps={p} messages={allMessages} />)}>View Links</Button>
                            <Button size={Button.Sizes.SMALL} onClick={() => openModal(p => <AttachmentsModal modalProps={p} messages={allMessages} />)}>View Attachments</Button>
                            <Button onClick={copyResults}>Copy Report</Button>
                        </>
                    )}
                    <Button onClick={modalProps.onClose} color={Button.Colors.PRIMARY}>Close</Button>
                </ModalFooter>
            )}
        </Modal>
    );
}
function OSINTHistoryPanel({ modalProps, onSelect }: { modalProps: any; onSelect: (userId: string) => void; }) {
    const [history, setHistory] = useState<HistoryEntry[]>([]);
    const [loading, setLoading] = useState(true);
    useEffect(() => { loadHistory().then(h => { setHistory(h); setLoading(false); }); }, []);
    async function handleDelete(userId: string) {
        await removeFromHistory(userId);
        setHistory(prev => prev.filter(h => h.userId !== userId));
    }
    return (
        <Modal {...modalProps} size="md" className="vc-osint-root" title={
            <div className="vc-osint-header-left">
                <div className="vc-osint-header-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z" /></svg>
                </div>
                <div>
                    <div className="vc-osint-header-title">Scan History</div>
                    <div className="vc-osint-header-subtitle">Last {MAX_SCAN_HISTORY} scans</div>
                </div>
            </div>
        }>
            <ModalContent>
                <div className="vc-osint-body">
                    {loading && <div className="vc-osint-progress"><div className="vc-osint-spinner" /></div>}
                    {!loading && history.length === 0 && <div className="vc-osint-empty"><p>No scan history yet</p></div>}
                    {history.map(entry => (
                        <div key={entry.userId} className="vc-osint-history-entry" onClick={() => { modalProps.onClose(); onSelect(entry.userId); }}>
                            <img className="vc-osint-history-avatar" src={entry.avatar ? `https://cdn.discordapp.com/avatars/${entry.userId}/${entry.avatar}.webp?size=32` : `https://cdn.discordapp.com/embed/avatars/${(BigInt(entry.userId) >> 22n) % 6n}.png`} alt="" />
                            <div className="vc-osint-history-info">
                                <div className="vc-osint-history-name">{entry.globalName || entry.username}</div>
                                <div className="vc-osint-history-meta">@{entry.username} | {entry.messageCount} msgs | {new Date(entry.scannedAt).toLocaleDateString()}</div>
                            </div>
                            <span className="vc-osint-tag">{entry.mode === "unlimited" ? "Live" : "Limited"}</span>
                            <button className="vc-osint-history-delete" onClick={e => { e.stopPropagation(); handleDelete(entry.userId); }} title="Remove">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
                            </button>
                        </div>
                    ))}
                </div>
            </ModalContent>
        </Modal>
    );
}
function OSINTMultiScan({ modalProps }: { modalProps: any; }) {
    const [userInput, setUserInput] = useState("");
    const [targets, setTargets] = useState<Array<{ userId: string; username: string; status: "pending" | "scanning" | "done" | "error"; result?: AlgorithmResult; aiResult?: string; msgCount: number; }>>([]);
    const [scanning, setScanning] = useState(false);
    const abortRef = useRef(false);
    function addTarget() {
        const input = userInput.trim();
        if (!input) return;
        const idMatch = input.match(/^<?@?!?(\d{17,20})>?$/);
        const userId = idMatch ? idMatch[1] : input;
        const user = UserStore.getUser(userId);
        if (!user) return;
        if (targets.some(t => t.userId === userId)) return;
        setTargets(prev => [...prev, { userId, username: user.username, status: "pending", msgCount: 0 }]);
        setUserInput("");
    }
    function removeTarget(userId: string) { setTargets(prev => prev.filter(t => t.userId !== userId)); }
    async function startBatchScan() {
        if (targets.length === 0 || scanning) return;
        setScanning(true);
        abortRef.current = false;
        const channelId = SelectedChannelStore.getChannelId();
        const chan = ChannelStore.getChannel(channelId);
        const guildId = chan?.guild_id;
        const unlimited = settings.store.unlimitedMessages;
        const limit = settings.store.messageLimit;
        const { scanDMs } = settings.store;
        for (let i = 0; i < targets.length; i++) {
            if (abortRef.current) break;
            setTargets(prev => prev.map((t, idx) => idx === i ? { ...t, status: "scanning" } : t));
            try {
                const acc: MessageData[] = [];
                let offset = 0;
                if (guildId) {
                    while (true) {
                        const { messages, total } = await searchMessages(targets[i].userId, guildId, channelId, offset);
                        if (messages.length === 0) break;
                        acc.push(...messages.map(m => toMessageData(m, { channelId, guildId })));
                        offset += messages.length;
                        if (!unlimited && acc.length >= limit) break;
                        if (offset >= total) break;
                        await sleep(250);
                    }
                }
                if (scanDMs) {
                    const dmChannels = getDMChannelsWithUser(targets[i].userId);
                    for (const dmId of dmChannels) {
                        if (abortRef.current) break;
                        let dmOffset = 0;
                        while (true) {
                            const { messages, total } = await searchMessages(targets[i].userId, null, dmId, dmOffset);
                            if (messages.length === 0) break;
                            acc.push(...messages.map(m => toMessageData(m, { channelId: dmId })));
                            dmOffset += messages.length;
                            if (!unlimited && acc.length >= limit) break;
                            if (dmOffset >= total) break;
                            await sleep(250);
                        }
                    }
                }
                const result = analyzeMessages(acc, settings.store.use24hTime);
                let aiRes = "";
                if (settings.store.useAI && acc.length > 0) {
                    try {
                        const prompt = await buildAIPrompt(acc, result);
                        aiRes = await callAI({
                            messages: [
                                { role: "system", content: "You are an expert OSINT analyst. Be thorough and factual." },
                                { role: "user", content: prompt },
                            ],
                            provider: settings.store.aiProvider,
                            model: settings.store.customModel || undefined,
                            customUrl: settings.store.customApiUrl,
                        });
                    } catch { aiRes = "AI analysis failed"; }
                }
                setTargets(prev => prev.map((t, idx) => idx === i ? { ...t, status: "done", result, aiResult: aiRes, msgCount: acc.length } : t));
                await saveToHistory({
                    userId: targets[i].userId, username: targets[i].username, globalName: UserStore.getUser(targets[i].userId)?.globalName,
                    avatar: UserStore.getUser(targets[i].userId)?.avatar, messageCount: acc.length, scannedAt: Date.now(), algorithmResult: result, aiResult: aiRes || undefined, mode: unlimited ? "unlimited" : `limited-${limit}`,
                });
            } catch {
                setTargets(prev => prev.map((t, idx) => idx === i ? { ...t, status: "error" } : t));
            }
        }
        setScanning(false);
    }
    return (
        <Modal {...modalProps} size="lg" className="vc-osint-root" title={
            <div className="vc-osint-header-left">
                <div className="vc-osint-header-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" /></svg>
                </div>
                <div>
                    <div className="vc-osint-header-title">Multi-Target Scan</div>
                    <div className="vc-osint-header-subtitle">{targets.length} target{targets.length !== 1 ? "s" : ""} queued</div>
                </div>
            </div>
        }>
            <ModalContent>
                <div className="vc-osint-body">
                    <div className="vc-osint-multi-input">
                        <input className="vc-osint-input" value={userInput} onChange={e => setUserInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") addTarget(); }} placeholder="Enter user ID or @mention..." disabled={scanning} />
                        <Button size={Button.Sizes.SMALL} onClick={addTarget} disabled={scanning || !userInput.trim()}>Add</Button>
                    </div>
                    {targets.map(t => (
                        <div key={t.userId} className={`vc-osint-target ${t.status === "scanning" ? "vc-osint-target--active" : ""} ${t.status === "done" ? "vc-osint-target--done" : ""}`}>
                            <img className="vc-osint-target-avatar" src={UserStore.getUser(t.userId)?.avatar ? `https://cdn.discordapp.com/avatars/${t.userId}/${UserStore.getUser(t.userId)?.avatar}.webp?size=24` : `https://cdn.discordapp.com/embed/avatars/${(BigInt(t.userId) >> 22n) % 6n}.png`} alt="" />
                            <div className="vc-osint-target-info">
                                <span className="vc-osint-target-name">{t.username}</span>
                                <span className="vc-osint-target-status">
                                    {t.status === "pending" && "Queued"}
                                    {t.status === "scanning" && <><div className="vc-osint-spinner-small" /> Scanning...</>}
                                    {t.status === "done" && `${t.msgCount} msgs`}
                                    {t.status === "error" && "Failed"}
                                </span>
                            </div>
                            {!scanning && <button className="vc-osint-target-remove" onClick={() => removeTarget(t.userId)}><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg></button>}
                        </div>
                    ))}
                    {targets.filter(t => t.status === "done").map(t => (
                        <div key={t.userId} className="vc-osint-section" style={{ marginTop: 16 }}>
                            <div className="vc-osint-section-title">@{t.username} — {t.msgCount} messages</div>
                            {t.result?.sections.slice(0, 3).map((s, i) => (
                                <div key={i} className="vc-osint-section-content" style={{ marginBottom: 8 }}>{s.title}: {s.content.split("\n")[0]}</div>
                            ))}
                            {t.aiResult && <div className="vc-osint-section-content" style={{ marginTop: 8 }}>{t.aiResult.slice(0, 300)}...</div>}
                        </div>
                    ))}
                </div>
            </ModalContent>
            <ModalFooter>
                <Button onClick={startBatchScan} disabled={scanning || targets.length === 0}>{scanning ? "Scanning..." : `Scan ${targets.filter(t => t.status === "pending").length} Targets`}</Button>
                <Button onClick={modalProps.onClose} color={Button.Colors.PRIMARY}>Close</Button>
            </ModalFooter>
        </Modal>
    );
}
function UserPickerModal({ modalProps, onSelect }: { modalProps: any; onSelect: (userId: string) => void; }) {
    const [query, setQuery] = useState("");
    const [suggestions, setSuggestions] = useState<Array<{ id: string; username: string; globalName?: string; avatar?: string; }>>([]);
    useEffect(() => {
        const users: Array<{ id: string; username: string; globalName?: string; avatar?: string; }> = [];
        const seen = new Set<string>();
        const friendIds: string[] = RelationshipStore.getFriendIDs?.() ?? [];
        for (const id of friendIds.slice(0, 100)) {
            const user = UserStore.getUser(id);
            if (user && !seen.has(id)) { seen.add(id); users.push({ id, username: user.username, globalName: (user as any).globalName, avatar: user.avatar }); }
        }
        for (const guild of Object.values(GuildStore.getGuilds())) {
            for (const member of GuildMemberStore.getMembers(guild.id).slice(0, 50)) {
                if (seen.has(member.userId)) continue;
                const user = UserStore.getUser(member.userId);
                if (user) { seen.add(member.userId); users.push({ id: member.userId, username: user.username, globalName: (user as any).globalName, avatar: user.avatar }); }
            }
            if (users.length > 300) break;
        }
        setSuggestions(users);
    }, []);
    const filtered = useMemo(() => {
        if (!query.trim()) return suggestions.slice(0, 20);
        const q = query.toLowerCase();
        return suggestions.filter(u => u.username.toLowerCase().includes(q) || u.globalName?.toLowerCase().includes(q) || u.id === query.trim()).slice(0, 20);
    }, [query, suggestions]);
    function select(userId: string) { modalProps.onClose(); onSelect(userId); }
    return (
        <Modal {...modalProps} size="sm" className="vc-osint-root" title={
            <div className="vc-osint-header-left">
                <div className="vc-osint-header-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
                </div>
                <div>
                    <div className="vc-osint-header-title">Select User</div>
                    <div className="vc-osint-header-subtitle">Search by name or paste a user ID</div>
                </div>
            </div>
        }>
            <ModalContent>
                <div className="vc-osint-body">
                    <TextInput autoFocus placeholder="Username, display name, or user ID..." value={query} onChange={setQuery} onKeyDown={(e: any) => {
                        if (e.key === "Enter") {
                            const m = query.trim().match(/^<?@?!?(\d{17,20})>?$/);
                            if (m) { select(m[1]); return; }
                            if (filtered.length > 0) select(filtered[0].id);
                        }
                    }} />
                    <div className="vc-osint-picker-list">
                        {filtered.map(user => (
                            <div key={user.id} className="vc-osint-picker-item" onClick={() => select(user.id)}>
                                <img className="vc-osint-picker-avatar" src={user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.webp?size=32` : `https://cdn.discordapp.com/embed/avatars/${(BigInt(user.id) >> 22n) % 6n}.png`} alt="" />
                                <div className="vc-osint-picker-info">
                                    <span className="vc-osint-picker-name">{user.globalName || user.username}</span>
                                    <span className="vc-osint-picker-tag">@{user.username}</span>
                                </div>
                            </div>
                        ))}
                        {filtered.length === 0 && query.trim() && <div className="vc-osint-empty"><p>No users found. Paste a user ID and press Enter.</p></div>}
                    </div>
                </div>
            </ModalContent>
        </Modal>
    );
}
function openScan(userId: string, channelId: string) {
    openModal(props => <OSINTScanPanel userId={userId} channelId={channelId} modalProps={props} />);
}
export function openOsintScanFor(userId: string, channelId?: string) {
    openScan(userId, channelId ?? SelectedChannelStore.getChannelId());
}
function openUserPicker(channelId: string) {
    openModal(props => <UserPickerModal modalProps={props} onSelect={userId => openScan(userId, channelId)} />);
}
function openMultiScan() { openModal(props => <OSINTMultiScan modalProps={props} />); }
function openHistory() {
    openModal(props => <OSINTHistoryPanel modalProps={props} onSelect={userId => {
        const channelId = SelectedChannelStore.getChannelId();
        openScan(userId, channelId);
    }} />);
}

let raiding = false;
async function raidLoop(channelIds: string[], content: string) {
    let i = 0;
    while (raiding && channelIds.length > 0) {
        const channelId = channelIds[i % channelIds.length];
        try {
            await RestAPI.post({ url: `/channels/${channelId}/messages`, body: { content } });
            i++;
        } catch (e) {
            logger.error("Raid send failed,", e);
            await sleep(1000);
        }
    }
}

function OSINTButton() {
    const [show, setShow] = useState(false);
    const buttonRef = useRef<HTMLDivElement>(null);
    const SearchIcon = () => (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
    );
    function renderPopout(onClose: () => void) {
        return (
            <Menu.Menu navId="vc-osint-menu" onClose={onClose}>
                <Menu.MenuItem id="vc-osint-scan-user" label="Scan User" action={() => { onClose(); openUserPicker(SelectedChannelStore.getChannelId()); }} />
                <Menu.MenuItem id="vc-osint-multi" label="Multi-Target Scan" action={() => { onClose(); openMultiScan(); }} />
                <Menu.MenuItem id="vc-osint-history" label="Scan History" action={() => { onClose(); openHistory(); }} />
                <Menu.MenuSeparator />
                <Menu.MenuItem id="vc-osint-panel" label="Open OSINT Panel" action={() => { onClose(); SettingsRouter.openUserSettings(`${SETTINGS_ENTRY_KEY}_panel`); }} />
            </Menu.Menu>
        );
    }
    return (
        <span ref={buttonRef} style={{ display: "inline-flex", alignItems: "center" }}>
            <Popout position="bottom" align="center" spacing={0} animation={Popout.Animation.NONE} shouldShow={show} onRequestClose={() => setShow(false)} targetElementRef={buttonRef} renderPopout={() => renderPopout(() => setShow(false))}>
                {(_, { isShown }) => (
                    <HeaderBarButton icon={SearchIcon} tooltip={isShown ? null : "OSINT Tools"} selected={isShown} onClick={() => setShow(v => !v)} />
                )}
            </Popout>
        </span>
    );
}

interface MessageContextProps { itemSrc?: string; message?: { author?: User; }; }
interface ImageContextProps { src?: string; }

const messageContextMenuPatch: NavContextMenuPatchCallback = (children, { itemSrc, message }: MessageContextProps) => {
    const author = message?.author;
    if (!author || children.find(child => child?.props?.id === "vc-osint-toolkit-group")) return;
    const username = normalizeUsername(author.username);
    const urls = getUsernameSearchUrls(username);
    const avatarUrl = IconUtils.getUserAvatarURL(author, true, 512);
    children.push(
        <Menu.MenuGroup id="vc-osint-toolkit-group">
            {itemSrc ? (
                <Menu.MenuItem id="vc-osint-geo" label={<span className="vc-osint-geo-label">Geo Osint</span>} action={() => void handleGeoImage(itemSrc)} icon={GeoImageIcon} />
            ) : null}
            <Menu.MenuItem id="vc-osint-toolkit" label={<span className="vc-osint-toolkit-label">OSINT</span>}>
                <Menu.MenuItem id="vc-osint-author" label="Message Author">
                    <Menu.MenuItem id="vc-osint-copy-user-id" label="Copy User ID" action={() => void copyWithToast(author.id, "User ID copied.")} />
                    <Menu.MenuItem id="vc-osint-copy-user-url" label="Copy User URL" action={() => void copyWithToast(getDiscordUserUrl(author), "User URL copied.")} />
                    <Menu.MenuItem id="vc-osint-open-user-url" label="Open User URL" action={() => openExternal(getDiscordUserUrl(author))} />
                    <Menu.MenuItem id="vc-osint-search-usersearch" label="Search with UserSearch" action={() => openExternal(urls.userSearch)} />
                    <Menu.MenuItem id="vc-osint-search-whatsmyname" label="Search with WhatsMyName" action={() => openExternal(urls.whatsMyName)} />
                    {avatarUrl ? (
                        <Menu.MenuItem id="vc-osint-search-avatar" label="Reverse Search Avatar" action={() => openExternal(getAvatarSearchUrl(avatarUrl))} />
                    ) : null}
                </Menu.MenuItem>
                <Menu.MenuItem id="vc-osint-lookup-tools" label="Lookup Tools">
                    {OSINT_TOOLS.map(tool => (
                        <Menu.MenuItem key={`vc-osint-tool-${tool.id}`} id={`vc-osint-tool-${tool.id}`} label={tool.name} hint={tool.description} action={() => openExternal(tool.url)} />
                    ))}
                </Menu.MenuItem>
                <Menu.MenuItem id="vc-osint-resource-lists" label="Resource Lists">
                    {OSINT_RESOURCES.map(resource => (
                        <Menu.MenuItem key={`vc-osint-resource-${resource.id}`} id={`vc-osint-resource-${resource.id}`} label={resource.name} hint={resource.description} action={() => openExternal(resource.url)} />
                    ))}
                </Menu.MenuItem>
                <Menu.MenuItem id="vc-osint-opsec" label="Opsec">
                    {OPSEC_RESOURCES.map(resource => (
                        <Menu.MenuItem key={`vc-osint-opsec-${resource.id}`} id={`vc-osint-opsec-${resource.id}`} label={resource.name} hint={resource.description} action={() => openExternal(resource.url)} />
                    ))}
                </Menu.MenuItem>
                <Menu.MenuItem id="vc-osint-privacy-browsers" label="Privacy Browsers">
                    {PRIVACY_BROWSERS.map(browser => (
                        <Menu.MenuItem key={`vc-osint-browser-${browser.id}`} id={`vc-osint-browser-${browser.id}`} label={browser.name} hint={browser.description} action={() => openExternal(browser.url)} />
                    ))}
                </Menu.MenuItem>
            </Menu.MenuItem>
        </Menu.MenuGroup>
    );
};
async function handleGeoImage(imageUrl: string) {
    const apiKeys = [...new Set(settings.store.geoSeeerApiKey.split(/\r?\n/).map(key => key.trim()).filter(Boolean))];
    if (!apiKeys.length) {
        sendBotMessage(SelectedChannelStore.getChannelId(), { content: "Your GeoSeeer API keys are missing. Add them in OSINT settings (User Settings > OSINT)." });
        return;
    }
    const parsedUrl = parseUrl(imageUrl);
    if (!parsedUrl || (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:")) {
        showToast("This image does not have a public URL that GeoSeeer can analyze.", Toasts.Type.FAILURE);
        return;
    }
    const channelId = SelectedChannelStore.getChannelId();
    showToast("Geo Osint analysis started.", Toasts.Type.MESSAGE);
    debug("Starting Geo Osint analysis");
    try {
        const analysis = await analyzeGeoImage(parsedUrl.href, apiKeys);
        if (!pluginActive) return;
        sendBotMessage(channelId, { content: analysis ? createGeoAnalysisMessage(analysis) : "GeoSeeer returned an invalid response." });
    } catch (error) {
        if (!pluginActive) return;
        debug("Geo Osint analysis failed", error);
        sendBotMessage(channelId, { content: "Could not complete the Geo Osint analysis." });
    }
}
const imageContextMenuPatch: NavContextMenuPatchCallback = (children, { src }: ImageContextProps) => {
    if (!src) return;
    const group = findGroupChildrenByChildId("copy-native-link", children) ?? children;
    if (group.find(child => child?.props?.id === "vc-osint-geo")) return;
    group.push(
        <Menu.MenuItem id="vc-osint-geo" label={<span className="vc-osint-geo-label">Geo Osint</span>} action={() => void handleGeoImage(src)} icon={GeoImageIcon} />
    );
};

export default definePlugin({
    name: "TestcordOSINTToolkit",
    description: "OSINT scanner for Discord users. Analyzes messages, attachments, network lookups, breach records, CordCat intelligence, and image geolocation.",
    tags: ["Utility", "Privacy"],
    authors: [TestcordDevs.x2b],
    settings,
    settingsAboutComponent: SafeOSINTAbout,
    dependencies: ["HeaderBarAPI"],

    contextMenus: {
        message: messageContextMenuPatch,
        "image-context": imageContextMenuPatch,
        "user-context"(children, { id }: { id: string; }) {
            if (!id) return;
            const OSINTIcon = () => (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--interactive-normal)"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
            );
            children.push(
                <Menu.MenuSeparator />,
                <Menu.MenuItem id="vc-osint-scan" label="OSINT Scan" icon={OSINTIcon} action={() => openScan(id, SelectedChannelStore.getChannelId())} />
            );
        },
    },
    toolboxActions: {
        "OSINT Scan"() { openUserPicker(SelectedChannelStore.getChannelId()); },
        "Multi-Target Scan"() { openMultiScan(); },
        "Scan History"() { openHistory(); },
        "Open OSINT"() { SettingsRouter.openUserSettings(`${SETTINGS_ENTRY_KEY}_panel`); }
    },

    headerBarButton: {
        icon: () => (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
        ),
        render: OSINTButton,
        priority: 100,
    },

    async start() {
        pluginActive = true;
        activeRequests.clear();
        recentInvestigationsReady = settings.store.clearRecentInvestigationsOnRestart ? DataStore.del(OSINT_HISTORY_KEY).then(() => DataStore.del("OSINTToolkit_recentInvestigations" as any)).catch(() => {}) : Promise.resolve();
        try {
            const legacy = await DataStore.get("testcord-osint-history" as any) as unknown;
            const current = await DataStore.get(SCAN_HISTORY_KEY) as unknown;
            if (legacy && !current) await DataStore.set(SCAN_HISTORY_KEY, legacy as any);
        } catch {}
        if (!SettingsPlugin.customEntries.some(entry => entry.key === SETTINGS_ENTRY_KEY)) {
            SettingsPlugin.customEntries.push({
                key: SETTINGS_ENTRY_KEY,
                title: "OSINT",
                Component: OSINTPanel,
                Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
            });
        }
    },

    stop() {
        pluginActive = false;
        raiding = false;
        abortActiveRequests();
        removeFromArray(SettingsPlugin.customEntries, entry => entry.key === SETTINGS_ENTRY_KEY);
    },

    commands: [
        {
            name: "osint",
            description: "Run an OSINT scan on a user.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                { name: "user", description: "The user to scan", type: 6, required: true },
                { name: "limit", description: "Max messages per channel (0 = unlimited)", type: 4, required: false },
                { name: "mutual-servers", description: "Scan across all mutual servers", type: 5, required: false },
            ],
            execute: async (args, ctx) => {
                const userId = findOption(args, "user", "") as string;
                const limitOverride = findOption(args, "limit", 0) as number;
                const mutualOverride = findOption(args, "mutual-servers", false) as boolean;
                if (!userId) { sendBotMessage(ctx.channel.id, { content: "Please specify a user to scan." }); return; }
                if (limitOverride < 0) settings.store.unlimitedMessages = true;
                else if (limitOverride > 0) { settings.store.unlimitedMessages = false; settings.store.messageLimit = limitOverride; }
                if (mutualOverride) settings.store.scanMutualServers = true;
                openScan(userId, ctx.channel.id);
            },
        },
        {
            name: "raid",
            description: "Spam a message in the current channel.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [{ name: "message", description: "The message to spam", type: 3, required: true }],
            execute: async (args, ctx) => {
                const content = findOption(args, "message", "");
                if (!content) { sendBotMessage(ctx.channel.id, { content: "Please provide a message." }); return; }
                if (raiding) { sendBotMessage(ctx.channel.id, { content: "A raid is already running." }); return; }
                raiding = true;
                void raidLoop([ctx.channel.id], content);
                sendBotMessage(ctx.channel.id, { content: "Raid started. Use /stopraid to stop." });
            },
        },
        {
            name: "multiraid",
            description: "Spam a message in every channel of this server you can send in.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [{ name: "message", description: "The message to spam", type: 3, required: true }],
            execute: async (args, ctx) => {
                const content = findOption(args, "message", "");
                if (!content) { sendBotMessage(ctx.channel.id, { content: "Please provide a message." }); return; }
                if (raiding) { sendBotMessage(ctx.channel.id, { content: "A raid is already running." }); return; }
                const channel = ChannelStore.getChannel(ctx.channel.id);
                const guildId = (channel as any)?.guild_id;
                if (!guildId) { sendBotMessage(ctx.channel.id, { content: "You need to be in a server for this." }); return; }
                const targets: string[] = [];
                const guildChannels = ChannelStore.getMutableGuildChannelsForGuild(guildId);
                for (const id in guildChannels) {
                    const chan = guildChannels[id];
                    if (chan.type !== 0 && chan.type !== 5) continue;
                    if (!PermissionStore.can(PermissionsBits.SEND_MESSAGES, chan)) continue;
                    targets.push(id);
                }
                if (targets.length === 0) { sendBotMessage(ctx.channel.id, { content: "No channels you can send in." }); return; }
                raiding = true;
                void raidLoop(targets, content);
                sendBotMessage(ctx.channel.id, { content: `Raid started across ${targets.length} channels. Use /stopraid to stop.` });
            },
        },
        {
            name: "stopraid",
            description: "Stop any running raid.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: async (_args, ctx) => {
                if (!raiding) { sendBotMessage(ctx.channel.id, { content: "No raid is running." }); return; }
                raiding = false;
                sendBotMessage(ctx.channel.id, { content: "Raid stopped." });
            },
        },
        {
            name: "domain",
            description: "Looks up public RDAP registration information for a domain.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [{ name: "domain", description: "Domain to look up, like example.com.", type: ApplicationCommandOptionType.STRING, required: true }],
            execute: async (args: CommandArgument[], ctx: CommandContext) => {
                const domainInput = findOption<string>(args, "domain", "");
                const domain = normalizeDomain(domainInput);
                if (!isValidDomain(domain)) { sendBotMessage(ctx.channel.id, { content: "Invalid domain. Use a root domain like example.com." }); return; }
                debug("Looking up domain", domain);
                try {
                    const info = await getDomainInfo(domain);
                    if (!pluginActive) return;
                    if (!info) { sendBotMessage(ctx.channel.id, { content: `Could not retrieve public RDAP information for **${domain}**.` }); return; }
                    sendBotMessage(ctx.channel.id, { content: createDomainMessage(info) });
                } catch (error) {
                    debug("Domain lookup failed", error);
                    sendBotMessage(ctx.channel.id, { content: `Could not complete the domain lookup for **${domain}**.` });
                }
            }
        },
        {
            name: "iplookup",
            description: "Looks up public geolocation and network information for an IPv4 address.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [{ name: "ip", description: "Public IPv4 address to look up.", type: ApplicationCommandOptionType.STRING, required: true }],
            execute: async (args: CommandArgument[], ctx: CommandContext) => {
                const ip = findOption<string>(args, "ip", "").trim();
                if (!isPublicIPv4(ip)) { sendBotMessage(ctx.channel.id, { content: "Invalid public IPv4 address. Use an address like 8.8.8.8." }); return; }
                debug("Looking up IP", ip);
                try {
                    const info = await getIPInfo(ip);
                    if (!pluginActive) return;
                    if (!info) { sendBotMessage(ctx.channel.id, { content: `Could not retrieve public IP information for **${ip}**.` }); return; }
                    sendBotMessage(ctx.channel.id, { content: createIPMessage(info) });
                } catch (error) {
                    debug("IP lookup failed", error);
                    sendBotMessage(ctx.channel.id, { content: `Could not complete the IP lookup for **${ip}**.` });
                }
            }
        },
        {
            name: "myip",
            description: "Shows your public IP address and approximate geolocation.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: async (_args: CommandArgument[], ctx: CommandContext) => {
                try {
                    const info = await getIPInfo();
                    if (!pluginActive) return;
                    if (!info) { sendBotMessage(ctx.channel.id, { content: "Could not retrieve your public IP information." }); return; }
                    sendBotMessage(ctx.channel.id, { content: createIPMessage(info) });
                } catch (error) {
                    debug("My IP lookup failed", error);
                    sendBotMessage(ctx.channel.id, { content: "Could not complete your public IP lookup." });
                }
            }
        },
        {
            name: "usersearch",
            description: "Generates public username search links.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [{ name: "username", description: "Username to search.", type: ApplicationCommandOptionType.STRING, required: true }],
            execute: async (args: CommandArgument[], ctx: CommandContext) => {
                const username = normalizeUsername(findOption<string>(args, "username", ""));
                if (!username) { sendBotMessage(ctx.channel.id, { content: "Invalid username." }); return; }
                debug("Generating username search links", username);
                sendBotMessage(ctx.channel.id, { content: createUserSearchMessage(username) });
            }
        },
        {
            name: "breachvip",
            description: "Searches Breach.vip records by one or more fields.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                { name: "term", description: "Search term between 1 and 100 characters.", type: ApplicationCommandOptionType.STRING, required: true },
                { name: "fields", description: "Comma-separated fields, like email,username or discordid.", type: ApplicationCommandOptionType.STRING, required: true },
                { name: "minecraft", description: "Only searches records in the Minecraft category.", type: ApplicationCommandOptionType.BOOLEAN },
                { name: "wildcard", description: "Enables * and ? wildcard operators.", type: ApplicationCommandOptionType.BOOLEAN },
                { name: "case_sensitive", description: "Makes the search case-sensitive.", type: ApplicationCommandOptionType.BOOLEAN }
            ],
            execute: async (args: CommandArgument[], ctx: CommandContext) => {
                const term = findOption<string>(args, "term", "").trim();
                const fields = [...new Set(findOption<string>(args, "fields", "").toLowerCase().split(",").map(field => field.trim()).filter(Boolean))];
                const minecraft = findOption<boolean>(args, "minecraft", false);
                const wildcard = findOption<boolean>(args, "wildcard", false);
                const caseSensitive = findOption<boolean>(args, "case_sensitive", false);
                if (!term || term.length > 100) { sendBotMessage(ctx.channel.id, { content: "The search term must contain between 1 and 100 characters." }); return; }
                const invalidFields = fields.filter(field => !BREACH_VIP_FIELDS.includes(field));
                if (!fields.length || fields.length > 10 || invalidFields.length) {
                    sendBotMessage(ctx.channel.id, { content: `Invalid fields. Choose up to 10 comma-separated values from: ${BREACH_VIP_FIELDS.join(", ")}.` });
                    return;
                }
                if (wildcard && (term.startsWith("*") || term.startsWith("?"))) { sendBotMessage(ctx.channel.id, { content: "Wildcard searches cannot begin with * or ?." }); return; }
                debug("Searching Breach.vip", { fields, minecraft, wildcard, caseSensitive });
                const result = await Native.searchBreachVip(term, fields, minecraft, wildcard, caseSensitive);
                if (!pluginActive) return;
                sendBotMessage(ctx.channel.id, { content: result.success ? createBreachVipMessage(result.results, result.total) : result.error });
            }
        },
        {
            name: "cordcat",
            description: "Runs a full CordCat lookup for a Discord user ID.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                { name: "discord_id", description: "Discord user ID to look up.", type: ApplicationCommandOptionType.STRING, required: true },
                { name: "refresh", description: "Bypasses CordCat's cached result and returns changes.", type: ApplicationCommandOptionType.BOOLEAN }
            ],
            execute: async (args: CommandArgument[], ctx: CommandContext) => {
                const discordId = findOption<string>(args, "discord_id", "").trim();
                if (!/^\d{17,20}$/.test(discordId)) { sendBotMessage(ctx.channel.id, { content: "Invalid Discord user ID. Use a 17 to 20 digit snowflake." }); return; }
                await executeCordCat("query", discordId, findOption<boolean>(args, "refresh", false), ctx);
            }
        },
        {
            name: "cordcatuser",
            description: "Fetches a Discord user's public profile through CordCat.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [{ name: "discord_id", description: "Discord user ID to look up.", type: ApplicationCommandOptionType.STRING, required: true }],
            execute: async (args: CommandArgument[], ctx: CommandContext) => {
                const discordId = findOption<string>(args, "discord_id", "").trim();
                if (!/^\d{17,20}$/.test(discordId)) { sendBotMessage(ctx.channel.id, { content: "Invalid Discord user ID. Use a 17 to 20 digit snowflake." }); return; }
                await executeCordCat("user", discordId, false, ctx);
            }
        },
        {
            name: "cordcatinvite",
            description: "Validates a Discord invite through CordCat.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [{ name: "code", description: "Discord invite code without the URL.", type: ApplicationCommandOptionType.STRING, required: true }],
            execute: async (args: CommandArgument[], ctx: CommandContext) => {
                const code = findOption<string>(args, "code", "").trim();
                if (!/^[a-z0-9_-]{2,100}$/i.test(code)) { sendBotMessage(ctx.channel.id, { content: "Invalid Discord invite code." }); return; }
                await executeCordCat("invite", code, false, ctx);
            }
        },
        {
            name: "cordcatguild",
            description: "Fetches a Discord server's public widget through CordCat.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [{ name: "guild_id", description: "Discord server ID with its public widget enabled.", type: ApplicationCommandOptionType.STRING, required: true }],
            execute: async (args: CommandArgument[], ctx: CommandContext) => {
                const guildId = findOption<string>(args, "guild_id", "").trim();
                if (!/^\d{17,20}$/.test(guildId)) { sendBotMessage(ctx.channel.id, { content: "Invalid Discord server ID. Use a 17 to 20 digit snowflake." }); return; }
                await executeCordCat("guild", guildId, false, ctx);
            }
        },
        {
            name: "cordcatstatus",
            description: "Shows the current CordCat service status.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: async (_args: CommandArgument[], ctx: CommandContext) => {
                await executeCordCat("status", "", false, ctx);
            }
        }
    ],
});
