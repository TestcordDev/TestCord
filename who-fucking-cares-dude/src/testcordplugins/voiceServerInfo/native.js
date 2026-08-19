/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { resolve4 } from "dns/promises";
const VOICE_HOST_SUFFIXES = ["discord.gg", "discord.media"];
function normalizeVoiceHostname(value) {
    if (typeof value !== "string" || value.length > 300)
        return null;
    try {
        const url = new URL(value.includes("://") ? value : `https://${value}`);
        const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
        if (!hostname || hostname.length > 253)
            return null;
        if (!VOICE_HOST_SUFFIXES.some(suffix => hostname === suffix || hostname.endsWith(`.${suffix}`)))
            return null;
        return hostname;
    }
    catch {
        return null;
    }
}
export async function resolveVoiceServer(_event, hostname) {
    const normalizedHostname = normalizeVoiceHostname(hostname);
    if (!normalizedHostname) {
        return {
            success: false,
            hostname: "",
            addresses: [],
            error: "Discord returned an invalid voice server hostname."
        };
    }
    try {
        const addresses = Array.from(new Set(await resolve4(normalizedHostname)));
        return {
            success: addresses.length > 0,
            hostname: normalizedHostname,
            addresses,
            error: addresses.length > 0 ? undefined : "The voice server hostname did not resolve to an IPv4 address."
        };
    }
    catch {
        return {
            success: false,
            hostname: normalizedHostname,
            addresses: [],
            error: "Could not resolve the voice server hostname."
        };
    }
}
