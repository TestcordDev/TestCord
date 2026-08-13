/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import { HeaderBarButton } from "@api/HeaderBar";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { makeCodeblock } from "@utils/text";
import definePlugin, { OptionType, type PluginNative } from "@utils/types";
import type { CommandArgument, CommandContext } from "@vencord/discord-types";
import { openModal, RTCConnectionStore } from "@webpack/common";

import { getLocation, type IPInfo, VoiceServerIcon, type VoiceServerInfo, VoiceServerModal } from "./VoiceServerModal";

const Native = VencordNative.pluginHelpers.VoiceServerInfo as PluginNative<typeof import("./native")>;
const REQUEST_TIMEOUT_MS = 12_000;
const activeRequests = new Set<AbortController>();

const settings = definePluginSettings({
    notifyOnConnect: {
        type: OptionType.BOOLEAN,
        description: "Show the voice relay address and location after connecting.",
        default: true
    },
    showIcon: {
        type: OptionType.BOOLEAN,
        description: "Show the Voice Server Info icon in the header bar.",
        default: true
    }
});

const ICON_SETTING_KEYS: Array<"showIcon"> = ["showIcon"];
let pluginActive = true;
let lookupGeneration = 0;
let lastReportedHostname = "";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function getString(record: Record<string, unknown>, key: string) {
    const value = record[key];
    if (typeof value !== "string") return undefined;

    const trimmed = value.trim();
    return trimmed || undefined;
}

function getNumber(record: Record<string, unknown>, key: string) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "string") return undefined;

    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
}

function getTimezone(record: Record<string, unknown>) {
    if (Array.isArray(record.timeZones)) {
        const timezone = record.timeZones.find(value => typeof value === "string" && value.trim());
        if (typeof timezone === "string") return timezone.trim();
    }

    return getString(record, "timeZone") ?? getString(record, "timezone");
}

async function fetchIPInfo(ip: string): Promise<IPInfo | undefined> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    activeRequests.add(controller);

    try {
        const response = await fetch(`https://free.freeipapi.com/api/json/${encodeURIComponent(ip)}`, {
            signal: controller.signal
        });
        if (!response.ok) return undefined;

        const data: unknown = await response.json();
        if (!isRecord(data)) return undefined;

        const resolvedIP = getString(data, "ipAddress") ?? getString(data, "ip");
        if (!resolvedIP) return undefined;

        return {
            ip: resolvedIP,
            city: getString(data, "cityName") ?? getString(data, "city"),
            region: getString(data, "regionName") ?? getString(data, "region"),
            countryCode: getString(data, "countryCode"),
            countryName: getString(data, "countryName") ?? getString(data, "country"),
            latitude: getNumber(data, "latitude"),
            longitude: getNumber(data, "longitude"),
            organization: getString(data, "asnOrganization") ?? getString(data, "organization") ?? getString(data, "org"),
            timezone: getTimezone(data)
        };
    } finally {
        clearTimeout(timeout);
        activeRequests.delete(controller);
    }
}

async function getCurrentVoiceServerInfo(): Promise<VoiceServerInfo> {
    if (!RTCConnectionStore.isConnected()) throw new Error("Join a voice channel first.");

    const hostname = RTCConnectionStore.getHostname();
    if (!hostname) throw new Error("Discord has not provided the voice server hostname yet.");

    const resolved = await Native.resolveVoiceServer(hostname);
    if (!resolved.success || !resolved.addresses.length) {
        throw new Error(resolved.error ?? "Could not resolve the voice server hostname.");
    }

    const info = await fetchIPInfo(resolved.addresses[0]);
    if (!info) throw new Error("Could not retrieve information for the voice server IP.");

    return {
        hostname: resolved.hostname,
        addresses: resolved.addresses,
        info,
        ping: RTCConnectionStore.getLastPing()
    };
}

function createVoiceServerMessage(server: VoiceServerInfo) {
    const { info } = server;
    const coordinates = info.latitude != null && info.longitude != null
        ? `${info.latitude}, ${info.longitude}`
        : "Unknown";

    return makeCodeblock([
        "[VOICE SERVER]",
        `Hostname     : ${server.hostname}`,
        `IPv4         : ${server.addresses.join(", ")}`,
        `Location     : ${getLocation(info)}`,
        `Organization : ${info.organization ?? "Unknown"}`,
        `Timezone     : ${info.timezone ?? "Unknown"}`,
        `Coordinates  : ${coordinates}`,
        `Ping         : ${server.ping != null ? `${server.ping} ms` : "Unknown"}`
    ].join("\n"), "txt");
}

async function notifyCurrentVoiceServer() {
    if (!settings.store.notifyOnConnect || !RTCConnectionStore.isConnected()) return;

    const hostname = RTCConnectionStore.getHostname();
    if (!hostname || hostname === lastReportedHostname) return;

    const generation = ++lookupGeneration;
    lastReportedHostname = hostname;

    try {
        const server = await getCurrentVoiceServerInfo();
        if (!pluginActive || generation !== lookupGeneration || !RTCConnectionStore.isConnected()) return;

        showNotification({
            title: "Voice server connected",
            body: `${server.info.ip} in ${getLocation(server.info)}. ${server.info.organization ?? "Organization unknown"}.`,
            permanent: false
        });
    } catch {
        if (generation === lookupGeneration) lastReportedHostname = "";
    }
}

function handleConnectionState() {
    if (RTCConnectionStore.isConnected()) {
        void notifyCurrentVoiceServer();
        return;
    }

    lookupGeneration++;
    lastReportedHostname = "";
    activeRequests.forEach(controller => controller.abort());
    activeRequests.clear();
}

export function openVoiceServerModal() {
    openModal(props => <VoiceServerModal rootProps={props} loadInfo={getCurrentVoiceServerInfo} />);
}

function VoiceServerButton() {
    const { showIcon } = settings.use(ICON_SETTING_KEYS);
    if (!showIcon) return null;

    return (
        <HeaderBarButton
            icon={VoiceServerIcon}
            tooltip="Voice Server Info"
            onClick={openVoiceServerModal}
        />
    );
}

const SafeVoiceServerButton = ErrorBoundary.wrap(VoiceServerButton, { noop: true });

export default definePlugin({
    name: "VoiceServerInfo",
    description: "Shows the Discord voice relay IP address, location, organization and ping.",
    authors: [{ name: "irritably", id: 928787166916640838n }],
    tags: ["Voice", "Utility"],
    dependencies: ["HeaderBarAPI"],
    settings,
    headerBarButton: {
        icon: VoiceServerIcon,
        render: () => <SafeVoiceServerButton />,
        priority: 10
    },

    commands: [{
        name: "voiceserver",
        description: "Shows information about the current Discord voice relay.",
        inputType: ApplicationCommandInputType.BUILT_IN,
        execute: async (_args: CommandArgument[], ctx: CommandContext) => {
            try {
                const server = await getCurrentVoiceServerInfo();
                if (pluginActive) sendBotMessage(ctx.channel.id, { content: createVoiceServerMessage(server) });
            } catch (error) {
                const message = error instanceof Error ? error.message : "Could not inspect the current voice server.";
                if (pluginActive) sendBotMessage(ctx.channel.id, { content: message });
            }
        }
    }],

    flux: {
        RTC_CONNECTION_STATE() {
            handleConnectionState();
        }
    },

    toolboxActions: {
        "Open Voice Server Info": openVoiceServerModal
    },

    start() {
        pluginActive = true;
        handleConnectionState();
    },

    stop() {
        pluginActive = false;
        lookupGeneration++;
        lastReportedHostname = "";
        activeRequests.forEach(controller => controller.abort());
        activeRequests.clear();
    }
});
