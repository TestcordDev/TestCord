/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { Menu } from "@webpack/common";

interface DomainInfo {
    domain: string;
    registrar?: string;
    registrationDate?: string;
    expirationDate?: string;
    updatedAt?: string;
    status?: string[];
    nameServers?: string[];
    dnssec?: string;
}

interface IPInfo {
    ip: string;
    [key: string]: any;
}

const OSINT_TOOLS = [
    { id: "see-know", name: "See-Know", url: "https://see-know.eu/", description: "" },
    { id: "epieos", name: "Epieos", url: "https://epieos.com/", description: "" },
    { id: "osintx", name: "Osintx_", url: "https://www.osintx.io/", description: "" },
    { id: "socialeye", name: "SocialEye", url: "https://socialeye.net/", description: "" },
    { id: "cloudsint", name: "Cloudsint", url: "https://cloudsint.net/", description: "" },
    { id: "proximity", name: "Proximity OSINT", url: "https://www.proximityosint.com/", description: "" },
    { id: "deadeye", name: "DeadEye", url: "https://deadeye.cc/", description: "" },
    { id: "indicia", name: "Indicia", url: "https://indicia.app/", description: "" },
    { id: "tempemail", name: "Snapmail (Temp-Email)", url: "https://www.snapmail.in/", description: "" }
];

const OSINT_RESOURCES = [
    { id: "pikaosint", name: "PikaOSINT", url: "https://pikaosint.pages.dev/", description: "OSINT tools collection" },
    { id: "osintframework", name: "OSINT Framework", url: "https://osintframework.com/", description: "OSINT framework and tools" },
    { id: "photo-osint", name: "Photo OSINT", url: "https://start.me/p/0PgzqO/photo-osint", description: "Photo investigation resources" }
];

const settings = definePluginSettings({
    enableLogging: {
        type: OptionType.BOOLEAN,
        description: "Enable debug logging",
        default: false
    },
    ipProvider: {
        type: OptionType.SELECT,
        description: "IP lookup provider",
        options: [
            { label: "freeipapi.com", value: "freeipapi", default: true },
            { label: "ip-api.com", value: "ip-api" },
            { label: "ipwho.is", value: "ipwhois" },
            { label: "ipapi.is", value: "ipapi-is" },
        ]
    },
    availableCommands: {
        type: OptionType.STRING,
        description:
            "Available commands:\n" +
            "/domain <domain> - Lookup a domain via RDAP\n" +
            "/iplookup <ipv4> - Lookup an IPv4 address\n" +
            "/myip - Show your public IP information\n" +
            "/usersearch <username> - Generate a usersearch.org link for a username\n" +
            "\n" +
            "Example:\n" +
            "/domain google.com\n" +
            "/iplookup 1.1.1.1\n" +
            "/myip\n" +
            "/usersearch johndoe\n" +
            "\n" +
            "Right-click on any message to access OSINT tools!",
        default: "OSINTToolkit command list"
    }
});

function logDebug(...args: any[]) {
    if (settings.store.enableLogging) {
        console.log("[OSINT]", ...args);
    }
}

function normalizeDomain(input: string): string {
    return input
        .toLowerCase()
        .trim()
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .replace(/\/.*$/, "")
        .replace(/\.$/, "");
}

function isValidIPv4(ip: string): boolean {
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipRegex.test(ip)) return false;
    return ip.split(".").every(octet => {
        const num = Number(octet);
        return Number.isInteger(num) && num >= 0 && num <= 255;
    });
}

function normalizeUsername(input: string): string {
    return input.trim().replace(/^@+/, "");
}

async function getDomainInfo(domain: string): Promise<DomainInfo | null> {
    try {
        const response = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error(`RDAP lookup failed with status ${response.status}`);
        const data = await response.json();

        let registrar = "Unknown";
        if (Array.isArray(data.entities)) {
            const registrarEntity = data.entities.find((e: any) =>
                Array.isArray(e.roles) && e.roles.includes("registrar")
            );
            if (registrarEntity?.vcardArray?.[1]) {
                const fn = registrarEntity.vcardArray[1].find((p: any) => p[0] === "fn");
                if (fn?.[3]) registrar = fn[3];
            }
        }

        const registrationDate =
            data.events?.find((e: any) => e.eventAction === "registration")?.eventDate ??
            data.events?.find((e: any) => e.eventAction === "registered")?.eventDate;
        const expirationDate =
            data.events?.find((e: any) => e.eventAction === "expiration")?.eventDate ??
            data.events?.find((e: any) => e.eventAction === "expire")?.eventDate;
        const updatedAt =
            data.events?.find((e: any) => e.eventAction === "last changed")?.eventDate ??
            data.events?.find((e: any) => e.eventAction === "last update of RDAP database")?.eventDate;

        return {
            domain: data.ldhName || domain,
            registrar,
            registrationDate,
            expirationDate,
            updatedAt,
            status: Array.isArray(data.status) ? data.status : [],
            nameServers: Array.isArray(data.nameservers)
                ? data.nameservers.map((ns: any) => ns.ldhName).filter(Boolean)
                : [],
            dnssec: data.secureDNS?.delegationSigned ? "signed" : "unsigned"
        };
    } catch (error) {
        console.error("Domain lookup error:", error);
        return null;
    }
}

function getProviderUrl(ip?: string): string {
    const provider = settings.store.ipProvider;
    switch (provider) {
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

function parseProviderResponse(data: any, ip?: string): IPInfo {
    const provider = settings.store.ipProvider;
    switch (provider) {
        case "ip-api":
            return {
                ip: data.query || ip || "",
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
                ip: data.ip || ip || "",
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
                flag: data.flag?.emoji,
                asn: data.connection?.asn,
                org: data.connection?.org,
                isp: data.connection?.isp,
                domain: data.connection?.domain,
                timezone: data.timezone?.id,
                timezoneAbbr: data.timezone?.abbr,
                timezoneUtc: data.timezone?.utc,
                currentTime: data.timezone?.current_time,
                proxy: data.security?.proxy,
                vpn: data.security?.vpn,
                tor: data.security?.tor,
                hosting: data.security?.hosting,
                anonymous: data.security?.anonymous
            };
        case "ipapi-is":
            return {
                ip: data.ip || ip || "",
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
                datacenterName: data.datacenter?.datacenter,
                datacenterDomain: data.datacenter?.domain,
                datacenterNetwork: data.datacenter?.network,
                datacenterRegion: data.datacenter?.region,
                datacenterService: data.datacenter?.service,
                companyName: data.company?.name,
                companyAbuserScore: data.company?.abuser_score,
                companyDomain: data.company?.domain,
                companyType: data.company?.type,
                companyNetwork: data.company?.network,
                companyNetname: data.company?.netname,
                abuseName: data.abuse?.name,
                abuseAddress: data.abuse?.address,
                abuseEmail: data.abuse?.email,
                abusePhone: data.abuse?.phone,
                asn: data.asn?.asn,
                asnAbuserScore: data.asn?.abuser_score,
                asnRoute: data.asn?.route,
                asnDescr: data.asn?.descr,
                asnCountry: data.asn?.country,
                asnActive: data.asn?.active,
                asnOrg: data.asn?.org,
                asnDomain: data.asn?.domain,
                asnAbuse: data.asn?.abuse,
                asnType: data.asn?.type,
                asnCreated: data.asn?.created,
                asnUpdated: data.asn?.updated,
                asnRir: data.asn?.rir,
                isEU: data.location?.is_eu_member,
                callingCode: data.location?.calling_code,
                currencyCode: data.location?.currency_code,
                continent: data.location?.continent,
                country: data.location?.country,
                countryCode: data.location?.country_code,
                state: data.location?.state,
                city: data.location?.city,
                lat: data.location?.latitude,
                lon: data.location?.longitude,
                zip: data.location?.zip,
                timezone: data.location?.timezone,
                localTime: data.location?.local_time,
                localTimeUnix: data.location?.local_time_unix,
                isDst: data.location?.is_dst,
                utcOffset: data.location?.utcoffset,
                accuracy: data.location?.accuracy,
                vpnService: data.vpn?.service,
                vpnUrl: data.vpn?.url,
                vpnType: data.vpn?.type,
                vpnLastSeen: data.vpn?.last_seen_str,
                vpnRegion: data.vpn?.exit_node_region,
                elapsedMs: data.elapsed_ms
            };
        default: {
            const timezone = Array.isArray(data.timeZones) && data.timeZones.length > 0
                ? data.timeZones[0]
                : data.timeZone || data.timezone;
            return {
                ip: data.ipAddress || data.ip || ip || "",
                ipVersion: data.ipVersion,
                continent: data.continent,
                continentCode: data.continentCode,
                country: data.countryName,
                countryCode: data.countryCode,
                region: data.regionName,
                city: data.cityName,
                lat: data.latitude,
                lon: data.longitude,
                zip: data.zipCode,
                timezone,
                isProxy: data.isProxy,
                currency: data.currency ? `${data.currency.name} (${data.currency.code})` : undefined,
                language: data.language
            };
        }
    }
}

async function getIPInfo(ip: string): Promise<IPInfo | null> {
    try {
        const response = await fetch(getProviderUrl(ip), { signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error(`IP lookup failed with status ${response.status}`);
        const data = await response.json();
        return parseProviderResponse(data, ip);
    } catch (error) {
        console.error("IP lookup error:", error);
        return null;
    }
}

async function getMyIP(): Promise<IPInfo | null> {
    try {
        const response = await fetch(getProviderUrl(), { signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error(`My IP lookup failed with status ${response.status}`);
        const data = await response.json();
        return parseProviderResponse(data);
    } catch (error) {
        console.error("My IP lookup error:", error);
        return null;
    }
}

function calculateDomainAge(registrationDate: string): string {
    const now = new Date();
    const regDate = new Date(registrationDate);
    if (Number.isNaN(regDate.getTime())) return "Unknown";
    const diffTime = Math.abs(now.getTime() - regDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const years = Math.floor(diffDays / 365);
    const months = Math.floor((diffDays % 365) / 30);
    const days = (diffDays % 365) % 30;
    return `${years}y ${months}m ${days}d`;
}

function createDomainMessage(info: DomainInfo) {
    const ageText = info.registrationDate ? calculateDomainAge(info.registrationDate) : "Unknown";
    return [
        "```txt",
        `[DOMAIN LOOKUP] ${info.domain}`,
        `Registration : ${info.registrationDate || "N/A"}`,
        `Age          : ${ageText}`,
        `Expiration   : ${info.expirationDate || "N/A"}`,
        `Registrar    : ${info.registrar || "Unknown"}`,
        `Updated      : ${info.updatedAt || "N/A"}`,
        `DNSSEC       : ${info.dnssec || "N/A"}`,
        `Status       : ${info.status?.length ? info.status.join(", ") : "N/A"}`,
        `Nameservers  : ${info.nameServers?.length ? info.nameServers.join(", ") : "N/A"}`,
        "```"
    ].join("\n");
}

function createIPMessage(info: IPInfo) {
    const provider = settings.store.ipProvider;
    const fmt = (label: string, value: any): string | null => {
        if (value === undefined || value === null || value === "") return null;
        return `${label.padEnd(20)}: ${value}`;
    };
    const coords = typeof info.lat === "number" && typeof info.lon === "number"
        ? `${info.lat}, ${info.lon}` : undefined;

    let lines: (string | null)[];
    switch (provider) {
        case "ipapi-is":
            lines = [
                "```txt",
                `[IP LOOKUP - ipapi.is] ${info.ip}`,
                fmt("RIR", info.rir),
                fmt("Is Bogon", info.isBogon),
                fmt("Is Mobile", info.isMobile),
                fmt("Is Satellite", info.isSatellite),
                fmt("Is Crawler", info.isCrawler),
                fmt("Is Datacenter", info.isDatacenter),
                fmt("Is Tor", info.isTor),
                fmt("Is Proxy", info.isProxy),
                fmt("Is VPN", info.isVpn),
                fmt("Is Abuser", info.isAbuser),
                "",
                "── Location ──",
                fmt("Continent", info.continent),
                fmt("Country", info.country),
                fmt("Country Code", info.countryCode),
                fmt("State", info.state),
                fmt("City", info.city),
                fmt("ZIP", info.zip),
                fmt("Coordinates", coords),
                fmt("Timezone", info.timezone),
                fmt("Local Time", info.localTime),
                fmt("Is DST", info.isDst),
                fmt("UTC Offset", info.utcOffset),
                fmt("Accuracy", info.accuracy),
                fmt("Is EU Member", info.isEU),
                fmt("Calling Code", info.callingCode),
                fmt("Currency", info.currencyCode),
                "",
                "── ASN ──",
                fmt("ASN", info.asn),
                fmt("Route", info.asnRoute),
                fmt("Description", info.asnDescr),
                fmt("Country", info.asnCountry),
                fmt("Active", info.asnActive),
                fmt("Org", info.asnOrg),
                fmt("Domain", info.asnDomain),
                fmt("Type", info.asnType),
                fmt("Abuse Email", info.asnAbuse),
                fmt("Abuser Score", info.asnAbuserScore),
                fmt("Created", info.asnCreated),
                fmt("Updated", info.asnUpdated),
                fmt("RIR", info.asnRir),
                "",
                "── Company ──",
                fmt("Name", info.companyName),
                fmt("Domain", info.companyDomain),
                fmt("Type", info.companyType),
                fmt("Network", info.companyNetwork),
                fmt("Netname", info.companyNetname),
                fmt("Abuser Score", info.companyAbuserScore),
                "",
                "── Abuse Contact ──",
                fmt("Name", info.abuseName),
                fmt("Address", info.abuseAddress),
                fmt("Email", info.abuseEmail),
                fmt("Phone", info.abusePhone),
                "",
                "── Datacenter ──",
                fmt("Name", info.datacenterName),
                fmt("Domain", info.datacenterDomain),
                fmt("Network", info.datacenterNetwork),
                fmt("Region", info.datacenterRegion),
                fmt("Service", info.datacenterService),
                info.vpnService ? "" : null,
                info.vpnService ? "── VPN ──" : null,
                fmt("Service", info.vpnService),
                fmt("URL", info.vpnUrl),
                fmt("Type", info.vpnType),
                fmt("Last Seen", info.vpnLastSeen),
                fmt("Region", info.vpnRegion),
                "",
                fmt("Elapsed", info.elapsedMs != null ? `${info.elapsedMs}ms` : undefined),
                "```"
            ];
            break;
        case "ip-api":
            lines = [
                "```txt",
                `[IP LOOKUP - ip-api.com] ${info.ip}`,
                fmt("Continent", info.continent),
                fmt("Continent Code", info.continentCode),
                fmt("Country", info.country),
                fmt("Country Code", info.countryCode),
                fmt("Region", info.region),
                fmt("Region Code", info.regionCode),
                fmt("City", info.city),
                fmt("District", info.district),
                fmt("ZIP", info.zip),
                fmt("Coordinates", coords),
                fmt("Timezone", info.timezone),
                fmt("UTC Offset", info.utcOffset != null ? `${info.utcOffset}s` : undefined),
                fmt("Currency", info.currency),
                fmt("ISP", info.isp),
                fmt("Organization", info.org),
                fmt("AS", info.as),
                fmt("AS Name", info.asname),
                fmt("Reverse DNS", info.reverse),
                fmt("Mobile", info.mobile),
                fmt("Proxy", info.proxy),
                fmt("Hosting", info.hosting),
                "```"
            ];
            break;
        case "ipwhois":
            lines = [
                "```txt",
                `[IP LOOKUP - ipwho.is] ${info.ip}`,
                fmt("Type", info.type),
                fmt("Continent", info.continent),
                fmt("Continent Code", info.continentCode),
                fmt("Country", info.country),
                fmt("Country Code", info.countryCode),
                fmt("Region", info.region),
                fmt("City", info.city),
                fmt("Postal", info.postal),
                fmt("Coordinates", coords),
                fmt("Calling Code", info.callingCode),
                fmt("Capital", info.capital),
                fmt("Is EU", info.isEU),
                fmt("Flag", info.flag),
                "",
                "── Connection ──",
                fmt("ASN", info.asn),
                fmt("Organization", info.org),
                fmt("ISP", info.isp),
                fmt("Domain", info.domain),
                "",
                "── Timezone ──",
                fmt("Timezone", info.timezone),
                fmt("Abbreviation", info.timezoneAbbr),
                fmt("UTC", info.timezoneUtc),
                fmt("Current Time", info.currentTime),
                "",
                "── Security ──",
                fmt("Anonymous", info.anonymous),
                fmt("Proxy", info.proxy),
                fmt("VPN", info.vpn),
                fmt("Tor", info.tor),
                fmt("Hosting", info.hosting),
                "```"
            ];
            break;
        default:
            lines = [
                "```txt",
                `[IP LOOKUP - freeipapi.com] ${info.ip}`,
                fmt("IP Version", info.ipVersion),
                fmt("Continent", info.continent),
                fmt("Continent Code", info.continentCode),
                fmt("Country", info.country),
                fmt("Country Code", info.countryCode),
                fmt("Region", info.region),
                fmt("City", info.city),
                fmt("ZIP", info.zip),
                fmt("Coordinates", coords),
                fmt("Timezone", info.timezone),
                fmt("Currency", info.currency),
                fmt("Language", info.language),
                fmt("Is Proxy", info.isProxy),
                "```"
            ];
            break;
    }
    return lines.filter(l => l !== null).join("\n");
}

function openUrl(url: string) {
    window.open(url, "_blank", "noopener,noreferrer");
}

const messageContextMenuPatch: NavContextMenuPatchCallback = (children, { message }) => {
    if (!message || !message.author) return;
    const osintGroup = children.find((child: any) => child?.props?.id === "osint-tools");
    if (osintGroup) return;

    children.push(
        <Menu.MenuGroup id="osint-tools">
            <Menu.MenuItem id="osint-toolkit-main" label="OSINT Toolkit">
                <Menu.MenuItem id="csint-tools" label="CSINT Tools">
                    {OSINT_TOOLS.map(tool => (
                        <Menu.MenuItem
                            key={`csint-${tool.id}`}
                            id={`csint-${tool.id}`}
                            label={tool.name}
                            hint={tool.description}
                            action={() => openUrl(tool.url)}
                        />
                    ))}
                </Menu.MenuItem>
                <Menu.MenuItem id="osint-tools" label="OSINT Tools">
                    {OSINT_RESOURCES.map(resource => (
                        <Menu.MenuItem
                            key={`osint-${resource.id}`}
                            id={`osint-${resource.id}`}
                            label={resource.name}
                            hint={resource.description}
                            action={() => openUrl(resource.url)}
                        />
                    ))}
                </Menu.MenuItem>
            </Menu.MenuItem>
        </Menu.MenuGroup>
    );
};

export default definePlugin({
    name: "OSINTToolkit",
    description: "OSINT - Domain age lookup, IP information, and username search",
    tags: ["Utility", "Developers", "Privacy"],
    authors: [{ name: "irritably", id: 928787166916640838n }],
    settings,

    contextMenus: {
        "message": messageContextMenuPatch
    },

    commands: [
        {
            name: "domain",
            description: "Get domain registration information and age",
            inputType: ApplicationCommandInputType.BUILT_IN,
            predicate: () => true,
            options: [{ name: "domain", description: "The domain to lookup (e.g., google.com)", type: 3, required: true }],
            execute: async (args: any[], ctx: any) => {
                const channelId = ctx.channel.id;
                const domainInput = args[0]?.value as string;
                if (!domainInput) { sendBotMessage(channelId, { content: "Please provide a domain name!" }); return; }
                const domain = normalizeDomain(domainInput);
                logDebug("Looking up domain:", domain);
                try {
                    const info = await getDomainInfo(domain);
                    if (!info) {
                        sendBotMessage(channelId, { content: `Failed to retrieve information for **${domain}**\nPossible reasons:\n• Domain doesn't exist\n• RDAP server unavailable\n• Invalid domain format` });
                        return;
                    }
                    sendBotMessage(channelId, { content: createDomainMessage(info) });
                } catch {
                    sendBotMessage(channelId, { content: `An unexpected error occurred while looking up **${domain}**` });
                }
            }
        },
        {
            name: "iplookup",
            description: "Get geolocation and network information for an IP",
            inputType: ApplicationCommandInputType.BUILT_IN,
            predicate: () => true,
            options: [{ name: "ip", description: "The IP address to lookup (IPv4)", type: 3, required: true }],
            execute: async (args: any[], ctx: any) => {
                const channelId = ctx.channel.id;
                const ipInput = args[0]?.value as string;
                if (!ipInput) { sendBotMessage(channelId, { content: "Please provide an IP address!" }); return; }
                const ip = ipInput.trim();
                if (!isValidIPv4(ip)) {
                    sendBotMessage(channelId, { content: "Invalid IP address format! Please use IPv4 format (e.g., 8.8.8.8)" });
                    return;
                }
                logDebug("Looking up IP:", ip);
                try {
                    const info = await getIPInfo(ip);
                    if (!info) {
                        sendBotMessage(channelId, { content: `Failed to retrieve information for **${ip}**\nPossible reasons:\n• Provider unavailable\n• Rate limit exceeded\n• Network error\n• Unsupported IP format` });
                        return;
                    }
                    sendBotMessage(channelId, { content: createIPMessage(info) });
                } catch {
                    sendBotMessage(channelId, { content: `An unexpected error occurred while looking up **${ip}**` });
                }
            }
        },
        {
            name: "myip",
            description: "Show your public IP address and geolocation",
            inputType: ApplicationCommandInputType.BUILT_IN,
            predicate: () => true,
            execute: async (_args: any[], ctx: any) => {
                const channelId = ctx.channel.id;
                try {
                    const info = await getMyIP();
                    if (!info) {
                        sendBotMessage(channelId, { content: "Failed to retrieve your IP information.\nPossible reasons:\n• Provider unavailable\n• Rate limit exceeded\n• Network error" });
                        return;
                    }
                    sendBotMessage(channelId, { content: createIPMessage(info) });
                } catch {
                    sendBotMessage(channelId, { content: "An unexpected error occurred while retrieving your IP." });
                }
            }
        },
        {
            name: "usersearch",
            description: "Generate a usersearch.org link for a username",
            inputType: ApplicationCommandInputType.BUILT_IN,
            predicate: () => true,
            options: [{ name: "username", description: "The username to search (e.g., johndoe)", type: 3, required: true }],
            execute: async (args: any[], ctx: any) => {
                const channelId = ctx.channel.id;
                const usernameInput = args[0]?.value as string;
                if (!usernameInput) { sendBotMessage(channelId, { content: "Please provide a username!" }); return; }
                const username = normalizeUsername(usernameInput);
                if (!username) { sendBotMessage(channelId, { content: "Invalid username!" }); return; }
                const searchUrl = `https://usersearch.org/results.php?type=standard&URL_username=${encodeURIComponent(username)}`;
                const whatsMyNameUrl = `https://whatsmyname.app/?q=${encodeURIComponent(username)}`;
                logDebug("Generating usersearch link for:", username);
                sendBotMessage(channelId, {
                    content: [
                        "```txt",
                        `[USER SEARCH] ${username}`,
                        `Link UserSearch : ${searchUrl}`,
                        `Link Whatsmyname : ${whatsMyNameUrl}`,
                        "```"
                    ].join("\n")
                });
            }
        }
    ]
});
