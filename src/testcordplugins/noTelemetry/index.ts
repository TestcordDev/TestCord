/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";

const settings = definePluginSettings({
    blockExperimentTracking: {
        description: "Block Discord from reporting which A/B experiments your account is enrolled in.",
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: true,
    },
    blockRtcDiagnostics: {
        description: "Block Discord from sending call quality diagnostics reports to their servers.",
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: true,
    },
    blockRemoteLogging: {
        description: "Block Discord's remote debug log collection system.",
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: true,
    },
    blockSentry: {
        description: "Stop Discord's Sentry crash reporting entirely. Every captured event serializes huge state blobs on the main thread; with a repeating error loop active this alone froze the client for seconds at a time.",
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: true,
    },
});

export default definePlugin({
    name: "NoTelemetry",
    description: "Blocks additional Discord telemetry beyond the built-in NoTrack plugin: experiment exposure reporting, call diagnostics, remote debug logging, and Sentry crash reporting.",
    tags: ["Privacy"],
    authors: [{ name: "Sharp", id: 0n }],
    enabledByDefault: true,
    settings,

    patches: [
        // Block experiment enrollment/exposure analytics
        {
            find: '"experiment_user_override"',
            predicate: () => settings.store.blockExperimentTracking,
            replacement: {
                match: /\i\.\i\.track\("experiment_user_override"/,
                replace: "(()=>{})(\"experiment_user_override\"",
            },
            noWarn: true,
        },
        // Block RTC call diagnostics/stats reporting
        {
            find: "sendDiagnosticsReport",
            predicate: () => settings.store.blockRtcDiagnostics,
            replacement: {
                match: /sendDiagnosticsReport\(\)\{/,
                replace: "sendDiagnosticsReport(){return;",
            },
            noWarn: true,
        },
        // Block remote debug log collection
        {
            find: '"RemoteLog"',
            predicate: () => settings.store.blockRemoteLogging,
            replacement: {
                match: /submit\(\i\)\{/,
                replace: "submit(){return;",
            },
            noWarn: true,
        },
        // Neutralize Sentry by blanking the DSN so the SDK never boots. The SDK
        // instruments setTimeout and dispatch globally; with the repeating frozen-array
        // TypeError active, each throw triggered a multi-hundred-ms capture+serialize.
        {
            find: "Sentry.init",
            predicate: () => settings.store.blockSentry,
            replacement: {
                match: /Sentry\.init\(\{([^}]*?)dsn:[^,}]*/,
                replace: 'Sentry.init({$1dsn:""',
            },
            noWarn: true,
        },
    ],
});
