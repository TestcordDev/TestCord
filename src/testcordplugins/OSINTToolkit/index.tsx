/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { findGroupChildrenByChildId, type NavContextMenuPatchCallback } from "@api/ContextMenu";
import * as DataStore from "@api/DataStore";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { EyeIcon, ImageIcon } from "@components/Icons";
import { Margins } from "@components/margins";
import { Notice } from "@components/Notice";
import SettingsPlugin from "@plugins/_core/settings";
import { TestcordDevs } from "@utils/constants";
import { copyWithToast } from "@utils/discord";
import { LazyComponent } from "@utils/lazyReact";
import { Logger } from "@utils/Logger";
import { classes, parseUrl, removeFromArray } from "@utils/misc";
import { formatDurationVerbose, makeCodeblock } from "@utils/text";
import definePlugin, { OptionType, type PluginNative } from "@utils/types";
import type { CommandArgument, CommandContext, User } from "@vencord/discord-types";
import { IconUtils, MaskedLink, Menu, SelectedChannelStore, SettingsRouter, showToast, Toasts } from "@webpack/common";
import type { ComponentProps } from "react";

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

interface IPInfo {
    ip: string;
    [key: string]: unknown;
}

interface GeoLocation {
    latitude: number;
    longitude: number;
    confidence?: number;
    address?: string;
    reasoning?: string;
}

interface GeoAnalysis {
    locations: GeoLocation[];
    processingTime?: string;
    requestsRemaining?: number;
}

interface MessageContextProps {
    itemSrc?: string;
    message?: {
        author?: User;
    };
}

interface ImageContextProps {
    src?: string;
}

const CORDCAT_TITLES = {
    query: "full lookup",
    user: "user lookup",
    invite: "invite lookup",
    guild: "guild widget",
    status: "service status"
} as const;

type CordCatTool = keyof typeof CORDCAT_TITLES;

const SETTINGS_ENTRY_KEY = "testcord_osint_fanboy_club";
export const OSINT_HISTORY_KEY = "OSINTToolkit_recentInvestigations";
const Native = VencordNative.pluginHelpers.OSINTToolkit as PluginNative<typeof import("./native")>;
const OSINTFanboyClub = LazyComponent(() => require("./components/OSINTFanboyClub").default);
const REQUEST_TIMEOUT_MS = 12_000;
const logger = new Logger("OSINTToolkit");
const activeRequests = new Set<AbortController>();
let pluginActive = true;
let nextGeoSeeerApiKey = 0;
let recentInvestigationsReady = Promise.resolve();

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
        componentProps: {
            type: "password"
        }
    },
    geoSeeerApiKey: {
        type: OptionType.STRING,
        description: "GeoSeeer API keys used for image geolocation. Enter one key per line.",
        default: "",
        placeholder: "Enter one GeoSeeer API key per line.",
        multiline: true,
        componentProps: {
            type: "password"
        }
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
        description: "Clear recent investigations whenever OSINTToolkit starts.",
        default: true
    }
});

function OSINTToolkitSettingsAbout() {
    return (
        <Notice.Warning className={Margins.bottom8}>
            <strong>Lawful and authorized OSINT use only.</strong>
            <p>You are responsible for having a specific lawful purpose and any required legal basis, consent, or notice before searching for another person. Do not use this plugin for stalking, doxxing, harassment, credential attacks, unlawful profiling, investigations involving minors, or decisions based only on unverified results.</p>
            <p>Queries can send identifiers, search terms, images, your IP address, and request metadata to independent services including CordCat, Breach.vip, and GeoSeeer. Review each provider&apos;s terms and privacy notice before use. Illegalcord does not control their data, retention, accuracy, or legal compliance. Nothing in this notice excludes liability that cannot be excluded under applicable law.</p>
            <p>Commands: /domain, /iplookup, /myip, /usersearch, /breachvip, /cordcat, /cordcatuser, /cordcatinvite, /cordcatguild and /cordcatstatus.</p>
            <p>Get a CordCat API key from <MaskedLink href="https://dis.cord.cat/dashboard">the CordCat dashboard</MaskedLink> and see <MaskedLink href="https://dis.cord.cat/docs#intro">the API documentation</MaskedLink>. The status command works without a key.</p>
            <p>Right click a message to copy author identifiers, open username searches and browse OSINT resource lists.</p>
            <p>Right click an image and choose Geo Osint to analyze its likely location privately in your client.</p>
        </Notice.Warning>
    );
}

const SafeOSINTToolkitSettingsAbout = ErrorBoundary.wrap(OSINTToolkitSettingsAbout, { noop: true });

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

    return host
        .toLowerCase()
        .replace(/^www\./, "")
        .replace(/\.$/, "");
}

function isValidDomain(domain: string): boolean {
    if (domain.length > 253) return false;

    const labels = domain.split(".");
    if (labels.length < 2) return false;

    return labels.every(label =>
        label.length >= 1
        && label.length <= 63
        && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
    );
}

function parseIPv4(ip: string): number[] | undefined {
    const parts = ip.split(".");
    if (parts.length !== 4) return undefined;

    const octets = parts.map(part => {
        if (!/^\d{1,3}$/.test(part)) return Number.NaN;

        return Number(part);
    });

    return octets.every(octet => Number.isInteger(octet) && octet >= 0 && octet <= 255)
        ? octets
        : undefined;
}

function isPublicIPv4(ip: string): boolean {
    const octets = parseIPv4(ip);
    if (!octets) return false;

    const [first, second, third, fourth] = octets;

    return !(
        first === 0
        || first === 10
        || first === 127
        || first >= 224
        || (first === 100 && second >= 64 && second <= 127)
        || (first === 169 && second === 254)
        || (first === 172 && second >= 16 && second <= 31)
        || (first === 192 && second === 168)
        || (first === 198 && (second === 18 || second === 19))
        || (first === 255 && second === 255 && third === 255 && fourth === 255)
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

        if (!response.ok) {
            throw new Error(`Request failed with status ${response.status}`);
        }

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
            if (Array.isArray(row) && row[0] === "fn" && typeof row[3] === "string" && row[3].trim()) {
                return row[3].trim();
            }
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

async function getDomainInfo(domain: string): Promise<DomainInfo | undefined> {
    const data = await fetchJson(`https://rdap.org/domain/${encodeURIComponent(domain)}`);
    if (!isRecord(data)) return undefined;

    const { secureDNS } = data;
    const dnssec = isRecord(secureDNS)
        ? secureDNS.delegationSigned === true ? "Signed" : "Unsigned"
        : "Unknown";

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

// ── IP providers ──

type IpProvider = "freeipapi" | "ip-api" | "ipwhois" | "ipapi-is";

function getProviderUrl(ip?: string): string {
    switch (settings.store.ipProvider as IpProvider) {
        case "ip-api":
            return ip
                ? `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=66846719`
                : "http://ip-api.com/json/?fields=66846719";
        case "ipwhois":
            return ip ? `https://ipwho.is/${encodeURIComponent(ip)}` : "https://ipwho.is/";
        case "ipapi-is":
            return ip ? `https://api.ipapi.is/?q=${encodeURIComponent(ip)}` : "https://api.ipapi.is/";
        default:
            return ip ? `https://free.freeipapi.com/api/json/${encodeURIComponent(ip)}` : "https://free.freeipapi.com/api/json";
    }
}

function parseProviderResponse(data: Record<string, unknown>, ip?: string): IPInfo {
    switch (settings.store.ipProvider as IpProvider) {
        case "ip-api":
            return {
                ip: (data.query as string) ?? ip ?? "",
                continent: data.continent,
                continentCode: data.continentCode,
                country: data.country,
                countryCode: data.countryCode,
                region: data.regionName,
                regionCode: data.region,
                city: data.city,
                district: data.district,
                zip: data.zip,
                lat: data.lat,
                lon: data.lon,
                timezone: data.timezone,
                utcOffset: data.offset,
                currency: data.currency,
                isp: data.isp,
                org: data.org,
                as: data.as,
                asname: data.asname,
                reverse: data.reverse,
                mobile: data.mobile,
                proxy: data.proxy,
                hosting: data.hosting
            };
        case "ipwhois":
            return {
                ip: (data.ip as string) ?? ip ?? "",
                type: data.type,
                continent: data.continent,
                continentCode: data.continent_code,
                country: data.country,
                countryCode: data.country_code,
                region: data.region,
                city: data.city,
                lat: data.latitude,
                lon: data.longitude,
                postal: data.postal,
                callingCode: data.calling_code,
                capital: data.capital,
                isEU: data.is_eu,
                flag: (data.flag as Record<string, unknown>)?.emoji,
                asn: (data.connection as Record<string, unknown>)?.asn,
                org: (data.connection as Record<string, unknown>)?.org,
                isp: (data.connection as Record<string, unknown>)?.isp,
                domain: (data.connection as Record<string, unknown>)?.domain,
                timezone: (data.timezone as Record<string, unknown>)?.id,
                timezoneAbbr: (data.timezone as Record<string, unknown>)?.abbr,
                timezoneUtc: (data.timezone as Record<string, unknown>)?.utc,
                currentTime: (data.timezone as Record<string, unknown>)?.current_time,
                proxy: (data.security as Record<string, unknown>)?.proxy,
                vpn: (data.security as Record<string, unknown>)?.vpn,
                tor: (data.security as Record<string, unknown>)?.tor,
                hosting: (data.security as Record<string, unknown>)?.hosting,
                anonymous: (data.security as Record<string, unknown>)?.anonymous
            };
        case "ipapi-is":
            return {
                ip: (data.ip as string) ?? ip ?? "",
                rir: data.rir,
                isBogon: data.is_bogon,
                isMobile: data.is_mobile,
                isSatellite: data.is_satellite,
                isCrawler: data.is_crawler,
                isDatacenter: data.is_datacenter,
                isTor: data.is_tor,
                isProxy: data.is_proxy,
                isVpn: data.is_vpn,
                isAbuser: data.is_abuser,
                datacenterName: (data.datacenter as Record<string, unknown>)?.datacenter,
                datacenterDomain: (data.datacenter as Record<string, unknown>)?.domain,
                datacenterNetwork: (data.datacenter as Record<string, unknown>)?.network,
                datacenterRegion: (data.datacenter as Record<string, unknown>)?.region,
                datacenterService: (data.datacenter as Record<string, unknown>)?.service,
                companyName: (data.company as Record<string, unknown>)?.name,
                companyAbuserScore: (data.company as Record<string, unknown>)?.abuser_score,
                companyDomain: (data.company as Record<string, unknown>)?.domain,
                companyType: (data.company as Record<string, unknown>)?.type,
                companyNetwork: (data.company as Record<string, unknown>)?.network,
                companyNetname: (data.company as Record<string, unknown>)?.netname,
                abuseName: (data.abuse as Record<string, unknown>)?.name,
                abuseAddress: (data.abuse as Record<string, unknown>)?.address,
                abuseEmail: (data.abuse as Record<string, unknown>)?.email,
                abusePhone: (data.abuse as Record<string, unknown>)?.phone,
                asn: (data.asn as Record<string, unknown>)?.asn,
                asnAbuserScore: (data.asn as Record<string, unknown>)?.abuser_score,
                asnRoute: (data.asn as Record<string, unknown>)?.route,
                asnDescr: (data.asn as Record<string, unknown>)?.descr,
                asnCountry: (data.asn as Record<string, unknown>)?.country,
                asnActive: (data.asn as Record<string, unknown>)?.active,
                asnOrg: (data.asn as Record<string, unknown>)?.org,
                asnDomain: (data.asn as Record<string, unknown>)?.domain,
                asnAbuse: (data.asn as Record<string, unknown>)?.abuse,
                asnType: (data.asn as Record<string, unknown>)?.type,
                asnCreated: (data.asn as Record<string, unknown>)?.created,
                asnUpdated: (data.asn as Record<string, unknown>)?.updated,
                asnRir: (data.asn as Record<string, unknown>)?.rir,
                isEU: (data.location as Record<string, unknown>)?.is_eu_member,
                callingCode: (data.location as Record<string, unknown>)?.calling_code,
                currencyCode: (data.location as Record<string, unknown>)?.currency_code,
                continent: (data.location as Record<string, unknown>)?.continent,
                country: (data.location as Record<string, unknown>)?.country,
                countryCode: (data.location as Record<string, unknown>)?.country_code,
                state: (data.location as Record<string, unknown>)?.state,
                city: (data.location as Record<string, unknown>)?.city,
                lat: (data.location as Record<string, unknown>)?.latitude,
                lon: (data.location as Record<string, unknown>)?.longitude,
                zip: (data.location as Record<string, unknown>)?.zip,
                timezone: (data.location as Record<string, unknown>)?.timezone,
                localTime: (data.location as Record<string, unknown>)?.local_time,
                localTimeUnix: (data.location as Record<string, unknown>)?.local_time_unix,
                isDst: (data.location as Record<string, unknown>)?.is_dst,
                utcOffset: (data.location as Record<string, unknown>)?.utcoffset,
                accuracy: (data.location as Record<string, unknown>)?.accuracy,
                vpnService: (data.vpn as Record<string, unknown>)?.service,
                vpnUrl: (data.vpn as Record<string, unknown>)?.url,
                vpnType: (data.vpn as Record<string, unknown>)?.type,
                vpnLastSeen: (data.vpn as Record<string, unknown>)?.last_seen_str,
                vpnRegion: (data.vpn as Record<string, unknown>)?.exit_node_region,
                elapsedMs: data.elapsed_ms
            };
        default: {
            const timezone = firstString(data.timeZones) ?? getString(data, "timeZone") ?? getString(data, "timezone");
            const currency = isRecord(data.currency)
                ? `${(data.currency.name as string) ?? ""} (${(data.currency.code as string) ?? ""})`
                : undefined;
            return {
                ip: getString(data, "ipAddress") ?? getString(data, "ip") ?? ip ?? "",
                ipVersion: data.ipVersion,
                continent: data.continent,
                continentCode: data.continentCode,
                country: data.countryName,
                countryCode: data.countryCode,
                region: data.regionName,
                city: data.cityName,
                lat: getNumber(data, "latitude"),
                lon: getNumber(data, "longitude"),
                zip: data.zipCode,
                timezone,
                isProxy: data.isProxy,
                currency,
                language: data.language
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
    const coords = typeof info.lat === "number" && typeof info.lon === "number"
        ? `${info.lat}, ${info.lon}`
        : undefined;
    let lines: (string | null)[];

    switch (provider) {
        case "ipapi-is":
            lines = [
                "```txt",
                `[IP LOOKUP - ipapi.is] ${info.ip}`,
                fmtLine("RIR", info.rir),
                fmtLine("Is Bogon", info.isBogon),
                fmtLine("Is Mobile", info.isMobile),
                fmtLine("Is Satellite", info.isSatellite),
                fmtLine("Is Crawler", info.isCrawler),
                fmtLine("Is Datacenter", info.isDatacenter),
                fmtLine("Is Tor", info.isTor),
                fmtLine("Is Proxy", info.isProxy),
                fmtLine("Is VPN", info.isVpn),
                fmtLine("Is Abuser", info.isAbuser),
                "",
                "── Location ──",
                fmtLine("Continent", info.continent),
                fmtLine("Country", info.country),
                fmtLine("Country Code", info.countryCode),
                fmtLine("State", info.state),
                fmtLine("City", info.city),
                fmtLine("ZIP", info.zip),
                fmtLine("Coordinates", coords),
                fmtLine("Timezone", info.timezone),
                fmtLine("Local Time", info.localTime),
                fmtLine("Is DST", info.isDst),
                fmtLine("UTC Offset", info.utcOffset),
                fmtLine("Accuracy", info.accuracy),
                fmtLine("Is EU Member", info.isEU),
                fmtLine("Calling Code", info.callingCode),
                fmtLine("Currency", info.currencyCode),
                "",
                "── ASN ──",
                fmtLine("ASN", info.asn),
                fmtLine("Route", info.asnRoute),
                fmtLine("Description", info.asnDescr),
                fmtLine("Country", info.asnCountry),
                fmtLine("Active", info.asnActive),
                fmtLine("Org", info.asnOrg),
                fmtLine("Domain", info.asnDomain),
                fmtLine("Type", info.asnType),
                fmtLine("Abuse Email", info.asnAbuse),
                fmtLine("Abuser Score", info.asnAbuserScore),
                fmtLine("Created", info.asnCreated),
                fmtLine("Updated", info.asnUpdated),
                fmtLine("RIR", info.asnRir),
                "",
                "── Company ──",
                fmtLine("Name", info.companyName),
                fmtLine("Domain", info.companyDomain),
                fmtLine("Type", info.companyType),
                fmtLine("Network", info.companyNetwork),
                fmtLine("Netname", info.companyNetname),
                fmtLine("Abuser Score", info.companyAbuserScore),
                "",
                "── Abuse Contact ──",
                fmtLine("Name", info.abuseName),
                fmtLine("Address", info.abuseAddress),
                fmtLine("Email", info.abuseEmail),
                fmtLine("Phone", info.abusePhone),
                "",
                "── Datacenter ──",
                fmtLine("Name", info.datacenterName),
                fmtLine("Domain", info.datacenterDomain),
                fmtLine("Network", info.datacenterNetwork),
                fmtLine("Region", info.datacenterRegion),
                fmtLine("Service", info.datacenterService),
                info.vpnService ? "" : null,
                info.vpnService ? "── VPN ──" : null,
                fmtLine("Service", info.vpnService),
                fmtLine("URL", info.vpnUrl),
                fmtLine("Type", info.vpnType),
                fmtLine("Last Seen", info.vpnLastSeen),
                fmtLine("Region", info.vpnRegion),
                "",
                fmtLine("Elapsed", info.elapsedMs != null ? `${info.elapsedMs}ms` : undefined),
                "```"
            ];
            break;
        case "ip-api":
            lines = [
                "```txt",
                `[IP LOOKUP - ip-api.com] ${info.ip}`,
                fmtLine("Continent", info.continent),
                fmtLine("Continent Code", info.continentCode),
                fmtLine("Country", info.country),
                fmtLine("Country Code", info.countryCode),
                fmtLine("Region", info.region),
                fmtLine("Region Code", info.regionCode),
                fmtLine("City", info.city),
                fmtLine("District", info.district),
                fmtLine("ZIP", info.zip),
                fmtLine("Coordinates", coords),
                fmtLine("Timezone", info.timezone),
                fmtLine("UTC Offset", info.utcOffset != null ? `${info.utcOffset}s` : undefined),
                fmtLine("Currency", info.currency),
                fmtLine("ISP", info.isp),
                fmtLine("Organization", info.org),
                fmtLine("AS", info.as),
                fmtLine("AS Name", info.asname),
                fmtLine("Reverse DNS", info.reverse),
                fmtLine("Mobile", info.mobile),
                fmtLine("Proxy", info.proxy),
                fmtLine("Hosting", info.hosting),
                "```"
            ];
            break;
        case "ipwhois":
            lines = [
                "```txt",
                `[IP LOOKUP - ipwho.is] ${info.ip}`,
                fmtLine("Type", info.type),
                fmtLine("Continent", info.continent),
                fmtLine("Continent Code", info.continentCode),
                fmtLine("Country", info.country),
                fmtLine("Country Code", info.countryCode),
                fmtLine("Region", info.region),
                fmtLine("City", info.city),
                fmtLine("Postal", info.postal),
                fmtLine("Coordinates", coords),
                fmtLine("Calling Code", info.callingCode),
                fmtLine("Capital", info.capital),
                fmtLine("Is EU", info.isEU),
                fmtLine("Flag", info.flag),
                "",
                "── Connection ──",
                fmtLine("ASN", info.asn),
                fmtLine("Organization", info.org),
                fmtLine("ISP", info.isp),
                fmtLine("Domain", info.domain),
                "",
                "── Timezone ──",
                fmtLine("Timezone", info.timezone),
                fmtLine("Abbreviation", info.timezoneAbbr),
                fmtLine("UTC", info.timezoneUtc),
                fmtLine("Current Time", info.currentTime),
                "",
                "── Security ──",
                fmtLine("Anonymous", info.anonymous),
                fmtLine("Proxy", info.proxy),
                fmtLine("VPN", info.vpn),
                fmtLine("Tor", info.tor),
                fmtLine("Hosting", info.hosting),
                "```"
            ];
            break;
        default:
            lines = [
                "```txt",
                `[IP LOOKUP - freeipapi.com] ${info.ip}`,
                fmtLine("IP Version", info.ipVersion),
                fmtLine("Continent", info.continent),
                fmtLine("Continent Code", info.continentCode),
                fmtLine("Country", info.country),
                fmtLine("Country Code", info.countryCode),
                fmtLine("Region", info.region),
                fmtLine("City", info.city),
                fmtLine("ZIP", info.zip),
                fmtLine("Coordinates", coords),
                fmtLine("Timezone", info.timezone),
                fmtLine("Currency", info.currency),
                fmtLine("Language", info.language),
                fmtLine("Is Proxy", info.isProxy),
                "```"
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

    return makeCodeblock([
        `[USER SEARCH] ${username}`,
        `UserSearch  : ${urls.userSearch}`,
        `WhatsMyName : ${urls.whatsMyName}`
    ].join("\n"), "txt");
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
    const truncated = serialized.length > 1_750
        ? `${serialized.slice(0, 1_750)}\n... Response truncated.`
        : serialized;

    return `**CordCat ${CORDCAT_TITLES[tool]}**\n${makeCodeblock(truncated, "json")}`;
}

async function executeCordCat(tool: CordCatTool, value: string, refresh: boolean, ctx: CommandContext) {
    try {
        const data = await lookupCordCat(tool, value, refresh);
        if (!pluginActive) return;

        sendBotMessage(ctx.channel.id, { content: createCordCatMessage(tool, data) });
    } catch (error) {
        sendBotMessage(ctx.channel.id, {
            content: error instanceof Error ? error.message : "Could not complete the CordCat lookup."
        });
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

export async function lookupBreachVip(
    term: string,
    fields: string[],
    minecraft: boolean,
    wildcard: boolean,
    caseSensitive: boolean
): Promise<{ results: unknown[]; total: number; }> {
    const result = await Native.searchBreachVip(term, fields, minecraft, wildcard, caseSensitive);
    if (!result.success) throw new Error(result.error);
    return { results: result.results, total: result.total };
}

export async function lookupCordCat(tool: CordCatTool, value: string, refresh: boolean): Promise<unknown> {
    const apiKey = settings.store.cordCatApiKey.trim();
    if (tool !== "status" && !apiKey) {
        throw new Error("Your CordCat API key is missing. Add it in Osint Fanboy club or the OSINTToolkit settings.");
    }

    debug("Querying CordCat", tool, value);
    const result = await Native.queryCordCat(tool, value, refresh, apiKey);
    if (!result.success) throw new Error(result.error);
    return result.data;
}

export async function geolocateImage(imageUrl: string): Promise<GeoAnalysis> {
    const apiKeys = [...new Set(settings.store.geoSeeerApiKey.split(/\r?\n/).map(key => key.trim()).filter(Boolean))];
    if (!apiKeys.length) throw new Error("Your GeoSeeer API keys are missing. Add at least one key in Osint Fanboy club.");

    const parsedUrl = parseUrl(imageUrl);
    if (!parsedUrl || (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:")) {
        throw new Error("Enter a public HTTP or HTTPS image URL.");
    }

    const analysis = await analyzeGeoImage(parsedUrl.href, apiKeys);
    if (!analysis) throw new Error("GeoSeeer returned an invalid response.");
    return analysis;
}

export async function getRecentInvestigations(): Promise<unknown> {
    await recentInvestigationsReady;
    return DataStore.get<unknown>(OSINT_HISTORY_KEY);
}

function parseGeoAnalysis(data: unknown): GeoAnalysis | undefined {
    if (!isRecord(data) || data.status !== "success" || !Array.isArray(data.locations)) return;

    const locations = data.locations.flatMap(location => {
        if (!isRecord(location)) return [];

        const latitude = getNumber(location, "latitude");
        const longitude = getNumber(location, "longitude");
        if (latitude === undefined || longitude === undefined) return [];

        return [{
            latitude,
            longitude,
            confidence: getNumber(location, "confidence"),
            address: getString(location, "address"),
            reasoning: getString(location, "reasoning")
        }];
    });

    return {
        locations,
        processingTime: getString(data, "processing_time"),
        requestsRemaining: getNumber(data, "API_Requests_remaining")
    };
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
            lines.push(
                "",
                `Candidate ${index + 1}`,
                `Address     : ${location.address ?? "Unknown"}`,
                `Coordinates : ${location.latitude}, ${location.longitude}`,
                `Confidence  : ${location.confidence === undefined ? "Unknown" : `${Math.round(location.confidence * 100)}%`}`,
                `Reasoning   : ${location.reasoning?.replace(/\s+/g, " ").slice(0, 400) ?? "Not provided"}`
            );
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

const messageContextMenuPatch: NavContextMenuPatchCallback = (children, { itemSrc, message }: MessageContextProps) => {
    const author = message?.author;
    if (!author || children.find(child => child?.props?.id === "vc-osint-toolkit-group")) return;

    const username = normalizeUsername(author.username);
    const urls = getUsernameSearchUrls(username);
    const avatarUrl = IconUtils.getUserAvatarURL(author, true, 512);

    children.push(
        <Menu.MenuGroup id="vc-osint-toolkit-group">
            {itemSrc
                ? (
                    <Menu.MenuItem
                        id="vc-osint-geo"
                        label={<span className="vc-osint-geo-label">Geo Osint</span>}
                        action={() => void handleGeoImage(itemSrc)}
                        icon={GeoImageIcon}
                    />
                )
                : null}
            <Menu.MenuItem id="vc-osint-toolkit" label={<span className="vc-osint-toolkit-label">OSINT Toolkit</span>}>
                <Menu.MenuItem id="vc-osint-author" label="Message Author">
                    <Menu.MenuItem
                        id="vc-osint-copy-user-id"
                        label="Copy User ID"
                        action={() => void copyWithToast(author.id, "User ID copied.")}
                    />
                    <Menu.MenuItem
                        id="vc-osint-copy-user-url"
                        label="Copy User URL"
                        action={() => void copyWithToast(getDiscordUserUrl(author), "User URL copied.")}
                    />
                    <Menu.MenuItem
                        id="vc-osint-open-user-url"
                        label="Open User URL"
                        action={() => openExternal(getDiscordUserUrl(author))}
                    />
                    <Menu.MenuItem
                        id="vc-osint-search-usersearch"
                        label="Search with UserSearch"
                        action={() => openExternal(urls.userSearch)}
                    />
                    <Menu.MenuItem
                        id="vc-osint-search-whatsmyname"
                        label="Search with WhatsMyName"
                        action={() => openExternal(urls.whatsMyName)}
                    />
                    {avatarUrl
                        ? (
                            <Menu.MenuItem
                                id="vc-osint-search-avatar"
                                label="Reverse Search Avatar"
                                action={() => openExternal(getAvatarSearchUrl(avatarUrl))}
                            />
                        )
                        : null}
                </Menu.MenuItem>
                <Menu.MenuItem id="vc-osint-lookup-tools" label="Lookup Tools">
                    {OSINT_TOOLS.map(tool => (
                        <Menu.MenuItem
                            key={`vc-osint-tool-${tool.id}`}
                            id={`vc-osint-tool-${tool.id}`}
                            label={tool.name}
                            hint={tool.description}
                            action={() => openExternal(tool.url)}
                        />
                    ))}
                </Menu.MenuItem>
                <Menu.MenuItem id="vc-osint-resource-lists" label="Resource Lists">
                    {OSINT_RESOURCES.map(resource => (
                        <Menu.MenuItem
                            key={`vc-osint-resource-${resource.id}`}
                            id={`vc-osint-resource-${resource.id}`}
                            label={resource.name}
                            hint={resource.description}
                            action={() => openExternal(resource.url)}
                        />
                    ))}
                </Menu.MenuItem>
                <Menu.MenuItem id="vc-osint-opsec" label="Opsec">
                    {OPSEC_RESOURCES.map(resource => (
                        <Menu.MenuItem
                            key={`vc-osint-opsec-${resource.id}`}
                            id={`vc-osint-opsec-${resource.id}`}
                            label={resource.name}
                            hint={resource.description}
                            action={() => openExternal(resource.url)}
                        />
                    ))}
                </Menu.MenuItem>
                <Menu.MenuItem id="vc-osint-privacy-browsers" label="Privacy Browsers">
                    {PRIVACY_BROWSERS.map(browser => (
                        <Menu.MenuItem
                            key={`vc-osint-browser-${browser.id}`}
                            id={`vc-osint-browser-${browser.id}`}
                            label={browser.name}
                            hint={browser.description}
                            action={() => openExternal(browser.url)}
                        />
                    ))}
                </Menu.MenuItem>
            </Menu.MenuItem>
        </Menu.MenuGroup>
    );
};

async function handleGeoImage(imageUrl: string) {
    const apiKeys = [...new Set(settings.store.geoSeeerApiKey.split(/\r?\n/).map(key => key.trim()).filter(Boolean))];
    if (!apiKeys.length) {
        sendBotMessage(SelectedChannelStore.getChannelId(), {
            content: "Your GeoSeeer API keys are missing. Get them from [GeoSeeer](https://geoseeer.com/). We recommend creating the accounts with temporary emails. For a reliable temporary email, right click any message, then select OSINT Toolkit > Lookup Tools > Snapmail."
        });
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

        sendBotMessage(channelId, {
            content: analysis
                ? createGeoAnalysisMessage(analysis)
                : "GeoSeeer returned an invalid response."
        });
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
        <Menu.MenuItem
            id="vc-osint-geo"
            label={<span className="vc-osint-geo-label">Geo Osint</span>}
            action={() => void handleGeoImage(src)}
            icon={GeoImageIcon}
        />
    );
};

export default definePlugin({
    name: "OSINTToolkit",
    description: "Adds OSINT commands and quick lookup links, including CordCat Discord intelligence tools.",
    tags: ["Utility", "Privacy"],
    authors: [TestcordDevs.x2b],
    settings,
    settingsAboutComponent: SafeOSINTToolkitSettingsAbout,

    contextMenus: {
        message: messageContextMenuPatch,
        "image-context": imageContextMenuPatch
    },
    toolboxActions: {
        "Open Osint Fanboy club": () => SettingsRouter.openUserSettings(`${SETTINGS_ENTRY_KEY}_panel`)
    },

    start() {
        pluginActive = true;
        activeRequests.clear();
        recentInvestigationsReady = settings.store.clearRecentInvestigationsOnRestart
            ? DataStore.del(OSINT_HISTORY_KEY)
            : Promise.resolve();

        if (!SettingsPlugin.customEntries.some(entry => entry.key === SETTINGS_ENTRY_KEY)) {
            SettingsPlugin.customEntries.push({
                key: SETTINGS_ENTRY_KEY,
                title: "Osint Fanboy club",
                Component: OSINTFanboyClub,
                Icon: EyeIcon
            });
        }
    },

    commands: [
        {
            name: "domain",
            description: "Looks up public RDAP registration information for a domain.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "domain",
                    description: "Domain to look up, like example.com.",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                }
            ],
            execute: async (args: CommandArgument[], ctx: CommandContext) => {
                const domainInput = findOption<string>(args, "domain", "");
                const domain = normalizeDomain(domainInput);

                if (!isValidDomain(domain)) {
                    sendBotMessage(ctx.channel.id, { content: "Invalid domain. Use a root domain like example.com." });
                    return;
                }

                debug("Looking up domain", domain);

                try {
                    const info = await getDomainInfo(domain);
                    if (!pluginActive) return;

                    if (!info) {
                        sendBotMessage(ctx.channel.id, { content: `Could not retrieve public RDAP information for **${domain}**.` });
                        return;
                    }

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
            options: [
                {
                    name: "ip",
                    description: "Public IPv4 address to look up.",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                }
            ],
            execute: async (args: CommandArgument[], ctx: CommandContext) => {
                const ip = findOption<string>(args, "ip", "").trim();

                if (!isPublicIPv4(ip)) {
                    sendBotMessage(ctx.channel.id, { content: "Invalid public IPv4 address. Use an address like 8.8.8.8." });
                    return;
                }

                debug("Looking up IP", ip);

                try {
                    const info = await getIPInfo(ip);
                    if (!pluginActive) return;

                    if (!info) {
                        sendBotMessage(ctx.channel.id, { content: `Could not retrieve public IP information for **${ip}**.` });
                        return;
                    }

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

                    if (!info) {
                        sendBotMessage(ctx.channel.id, { content: "Could not retrieve your public IP information." });
                        return;
                    }

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
            options: [
                {
                    name: "username",
                    description: "Username to search.",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                }
            ],
            execute: async (args: CommandArgument[], ctx: CommandContext) => {
                const username = normalizeUsername(findOption<string>(args, "username", ""));

                if (!username) {
                    sendBotMessage(ctx.channel.id, { content: "Invalid username." });
                    return;
                }

                debug("Generating username search links", username);
                sendBotMessage(ctx.channel.id, { content: createUserSearchMessage(username) });
            }
        },
        {
            name: "breachvip",
            description: "Searches Breach.vip records by one or more fields.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "term",
                    description: "Search term between 1 and 100 characters.",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                },
                {
                    name: "fields",
                    description: "Comma-separated fields, like email,username or discordid.",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                },
                {
                    name: "minecraft",
                    description: "Only searches records in the Minecraft category.",
                    type: ApplicationCommandOptionType.BOOLEAN
                },
                {
                    name: "wildcard",
                    description: "Enables * and ? wildcard operators.",
                    type: ApplicationCommandOptionType.BOOLEAN
                },
                {
                    name: "case_sensitive",
                    description: "Makes the search case-sensitive.",
                    type: ApplicationCommandOptionType.BOOLEAN
                }
            ],
            execute: async (args: CommandArgument[], ctx: CommandContext) => {
                const term = findOption<string>(args, "term", "").trim();
                const fields = [...new Set(findOption<string>(args, "fields", "")
                    .toLowerCase()
                    .split(",")
                    .map(field => field.trim())
                    .filter(Boolean))];
                const minecraft = findOption<boolean>(args, "minecraft", false);
                const wildcard = findOption<boolean>(args, "wildcard", false);
                const caseSensitive = findOption<boolean>(args, "case_sensitive", false);

                if (!term || term.length > 100) {
                    sendBotMessage(ctx.channel.id, { content: "The search term must contain between 1 and 100 characters." });
                    return;
                }

                const invalidFields = fields.filter(field => !BREACH_VIP_FIELDS.includes(field));
                if (!fields.length || fields.length > 10 || invalidFields.length) {
                    sendBotMessage(ctx.channel.id, {
                        content: `Invalid fields. Choose up to 10 comma-separated values from: ${BREACH_VIP_FIELDS.join(", ")}.`
                    });
                    return;
                }

                if (wildcard && (term.startsWith("*") || term.startsWith("?"))) {
                    sendBotMessage(ctx.channel.id, { content: "Wildcard searches cannot begin with * or ?." });
                    return;
                }

                debug("Searching Breach.vip", { fields, minecraft, wildcard, caseSensitive });
                const result = await Native.searchBreachVip(term, fields, minecraft, wildcard, caseSensitive);
                if (!pluginActive) return;

                sendBotMessage(ctx.channel.id, {
                    content: result.success ? createBreachVipMessage(result.results, result.total) : result.error
                });
            }
        },
        {
            name: "cordcat",
            description: "Runs a full CordCat lookup for a Discord user ID.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "discord_id",
                    description: "Discord user ID to look up.",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                },
                {
                    name: "refresh",
                    description: "Bypasses CordCat's cached result and returns changes.",
                    type: ApplicationCommandOptionType.BOOLEAN
                }
            ],
            execute: async (args: CommandArgument[], ctx: CommandContext) => {
                const discordId = findOption<string>(args, "discord_id", "").trim();
                if (!/^\d{17,20}$/.test(discordId)) {
                    sendBotMessage(ctx.channel.id, { content: "Invalid Discord user ID. Use a 17 to 20 digit snowflake." });
                    return;
                }

                await executeCordCat("query", discordId, findOption<boolean>(args, "refresh", false), ctx);
            }
        },
        {
            name: "cordcatuser",
            description: "Fetches a Discord user's public profile through CordCat.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "discord_id",
                    description: "Discord user ID to look up.",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                }
            ],
            execute: async (args: CommandArgument[], ctx: CommandContext) => {
                const discordId = findOption<string>(args, "discord_id", "").trim();
                if (!/^\d{17,20}$/.test(discordId)) {
                    sendBotMessage(ctx.channel.id, { content: "Invalid Discord user ID. Use a 17 to 20 digit snowflake." });
                    return;
                }

                await executeCordCat("user", discordId, false, ctx);
            }
        },
        {
            name: "cordcatinvite",
            description: "Validates a Discord invite through CordCat.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "code",
                    description: "Discord invite code without the URL.",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                }
            ],
            execute: async (args: CommandArgument[], ctx: CommandContext) => {
                const code = findOption<string>(args, "code", "").trim();
                if (!/^[a-z0-9_-]{2,100}$/i.test(code)) {
                    sendBotMessage(ctx.channel.id, { content: "Invalid Discord invite code." });
                    return;
                }

                await executeCordCat("invite", code, false, ctx);
            }
        },
        {
            name: "cordcatguild",
            description: "Fetches a Discord server's public widget through CordCat.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "guild_id",
                    description: "Discord server ID with its public widget enabled.",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                }
            ],
            execute: async (args: CommandArgument[], ctx: CommandContext) => {
                const guildId = findOption<string>(args, "guild_id", "").trim();
                if (!/^\d{17,20}$/.test(guildId)) {
                    sendBotMessage(ctx.channel.id, { content: "Invalid Discord server ID. Use a 17 to 20 digit snowflake." });
                    return;
                }

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

    stop() {
        pluginActive = false;
        abortActiveRequests();
        removeFromArray(SettingsPlugin.customEntries, entry => entry.key === SETTINGS_ENTRY_KEY);
    }
});
