/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import definePlugin from "@utils/types";
const settings = definePluginSettings({
    blockExperimentTracking: {
        description: "Block Discord from reporting which A/B experiments your account is enrolled in.",
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
        restartNeeded: true,
    },
    blockRtcDiagnostics: {
        description: "Block Discord from sending call quality diagnostics reports to their servers.",
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
        restartNeeded: true,
    },
    blockRemoteLogging: {
        description: "Block Discord's remote debug log collection system.",
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
        restartNeeded: true,
    },
});
export default definePlugin({
    name: "NoTelemetry",
    description: "Blocks additional Discord telemetry beyond the built-in NoTrack plugin: experiment exposure reporting, call diagnostics, and remote debug logging.",
    tags: ["Privacy"],
    authors: [{ name: "Sharp", id: 0n }],
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
    ],
});
