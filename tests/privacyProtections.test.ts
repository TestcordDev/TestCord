/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import test from "node:test";

const FIRST_PARTY_HOSTS = [
    "discord.com",
    "discordapp.com",
    "discordapp.net",
    "discord.gg",
    "discord.media",
    "discord.dev"
];

function isFirstParty(host: string): boolean {
    return FIRST_PARTY_HOSTS.some(h => host === h || host.endsWith("." + h));
}

function evaluateTelemetryRules(urlStr: string, shields: {
    experimentalTracing: boolean;
    experimentalRtcDiagnostics: boolean;
    experimentalRemoteLogging: boolean;
}) {
    const url = new URL(urlStr);
    const host = url.hostname;
    const path = url.pathname.toLowerCase();

    const isDiscordApi = isFirstParty(host) && path.includes("/api/");
    const isBadgeSpoofer = isDiscordApi && (urlStr.includes("source=badge_spoofer") || urlStr.includes("badge_spoofer=true") || urlStr.includes("badge_spoofer=1"));

    if (isBadgeSpoofer) {
        return { blocked: false, category: "badge_spoofer_allowed" };
    }

    const isTracing = isDiscordApi && /\/tracing(?:\/|$)/.test(path);
    const isRtcDiagnostics = isDiscordApi && /\/(?:rtc|voice)\/(?:quality-report|diagnostics)(?:\/|$)/.test(path);
    const isRemoteLogging = isDiscordApi && /\/debug-logs?(?:\/|$)/.test(path);

    const shouldBlock =
        (isTracing && shields.experimentalTracing) ||
        (isRtcDiagnostics && shields.experimentalRtcDiagnostics) ||
        (isRemoteLogging && shields.experimentalRemoteLogging);

    let category = "none";
    if (isTracing) category = "tracing";
    else if (isRtcDiagnostics) category = "rtcDiagnostics";
    else if (isRemoteLogging) category = "remoteLogging";

    return { blocked: shouldBlock, category };
}

test("tracing shield blocks Discord API tracing requests only when enabled", () => {
    const testUrl = "https://discord.com/api/v9/tracing";
    const subPathUrl = "https://discord.com/api/v9/tracing/events";
    const thirdPartyUrl = "https://analytics.example.com/api/v9/tracing";
    const normalApiUrl = "https://discord.com/api/v9/channels/123/messages";

    // Disabled shield
    assert.deepEqual(evaluateTelemetryRules(testUrl, {
        experimentalTracing: false,
        experimentalRtcDiagnostics: false,
        experimentalRemoteLogging: false
    }), { blocked: false, category: "tracing" });

    // Enabled shield
    assert.deepEqual(evaluateTelemetryRules(testUrl, {
        experimentalTracing: true,
        experimentalRtcDiagnostics: false,
        experimentalRemoteLogging: false
    }), { blocked: true, category: "tracing" });

    // Tracing subpath
    assert.deepEqual(evaluateTelemetryRules(subPathUrl, {
        experimentalTracing: true,
        experimentalRtcDiagnostics: false,
        experimentalRemoteLogging: false
    }), { blocked: true, category: "tracing" });

    // Third-party host should not match first-party tracing rule
    assert.deepEqual(evaluateTelemetryRules(thirdPartyUrl, {
        experimentalTracing: true,
        experimentalRtcDiagnostics: false,
        experimentalRemoteLogging: false
    }), { blocked: false, category: "none" });

    // Normal message API endpoint should never be blocked by tracing
    assert.deepEqual(evaluateTelemetryRules(normalApiUrl, {
        experimentalTracing: true,
        experimentalRtcDiagnostics: false,
        experimentalRemoteLogging: false
    }), { blocked: false, category: "none" });
});

test("rtc diagnostics shield blocks diagnostic reports while preserving normal voice", () => {
    const rtcQualityUrl = "https://discord.com/api/v9/rtc/quality-report";
    const voiceDiagUrl = "https://discord.com/api/v9/voice/diagnostics";
    const voiceRegionsUrl = "https://discord.com/api/v9/voice/regions";

    // Disabled shield
    assert.deepEqual(evaluateTelemetryRules(rtcQualityUrl, {
        experimentalTracing: false,
        experimentalRtcDiagnostics: false,
        experimentalRemoteLogging: false
    }), { blocked: false, category: "rtcDiagnostics" });

    // Enabled shield
    assert.deepEqual(evaluateTelemetryRules(rtcQualityUrl, {
        experimentalTracing: false,
        experimentalRtcDiagnostics: true,
        experimentalRemoteLogging: false
    }), { blocked: true, category: "rtcDiagnostics" });

    assert.deepEqual(evaluateTelemetryRules(voiceDiagUrl, {
        experimentalTracing: false,
        experimentalRtcDiagnostics: true,
        experimentalRemoteLogging: false
    }), { blocked: true, category: "rtcDiagnostics" });

    // Normal voice endpoint is preserved
    assert.deepEqual(evaluateTelemetryRules(voiceRegionsUrl, {
        experimentalTracing: false,
        experimentalRtcDiagnostics: true,
        experimentalRemoteLogging: false
    }), { blocked: false, category: "none" });
});

test("remote logging shield blocks debug-log uploads while preserving normal requests", () => {
    const debugLogsUrl = "https://discord.com/api/v9/debug-logs";
    const singleDebugLogUrl = "https://discord.com/api/v9/debug-log";

    // Disabled shield
    assert.deepEqual(evaluateTelemetryRules(debugLogsUrl, {
        experimentalTracing: false,
        experimentalRtcDiagnostics: false,
        experimentalRemoteLogging: false
    }), { blocked: false, category: "remoteLogging" });

    // Enabled shield
    assert.deepEqual(evaluateTelemetryRules(debugLogsUrl, {
        experimentalTracing: false,
        experimentalRtcDiagnostics: false,
        experimentalRemoteLogging: true
    }), { blocked: true, category: "remoteLogging" });

    assert.deepEqual(evaluateTelemetryRules(singleDebugLogUrl, {
        experimentalTracing: false,
        experimentalRtcDiagnostics: false,
        experimentalRemoteLogging: true
    }), { blocked: true, category: "remoteLogging" });
});

test("badge spoofer requests bypass telemetry shields", () => {
    const spoofUrl = "https://discord.com/api/v9/tracing?source=badge_spoofer";

    assert.deepEqual(evaluateTelemetryRules(spoofUrl, {
        experimentalTracing: true,
        experimentalRtcDiagnostics: true,
        experimentalRemoteLogging: true
    }), { blocked: false, category: "badge_spoofer_allowed" });
});
