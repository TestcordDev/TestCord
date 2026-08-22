/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";

const logger = new Logger("NoTelemetry");

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
    starveSentryRuntime: {
        description: "Neuter Sentry's capture pipeline at runtime, even when its init lives inside a lazily loaded chunk that string patches can't reach. Waits for the SDK global to appear, then no-ops all capture and send paths.",
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: false,
    },
});

export default definePlugin({
    name: "NoTelemetry",
    description: "Blocks additional Discord telemetry beyond the built-in NoTrack plugin: experiment exposure reporting, call diagnostics, remote debug logging, and Sentry crash reporting.",
    tags: ["Privacy"],
    authors: [{ name: "Sharp", id: 0n }],
    enabledByDefault: true,
    settings,

    sentryPoll: null as ReturnType<typeof setInterval> | null,
    sentryTries: 0,

    starveSentry() {
        const g = (window as any).__SENTRY__;
        if (!g) return false;
        const noop = function () { };
        const seen = new Set<any>();
        const starveClient = (client: any) => {
            if (!client || seen.has(client)) return;
            seen.add(client);
            for (const m of ["captureException", "captureEvent", "captureMessage", "captureCheckIn", "sendEvent", "sendSession", "recordDroppedEvent"]) {
                try { client[m] = noop; } catch { }
            }
            try { if (client._eventProcessors) client._eventProcessors.length = 0; } catch { }
            try {
                if (client._options) {
                    client._options.tracesSampleRate = 0;
                    delete client._options.tracesSampler;
                }
            } catch { }
        };
        for (const ver of Object.keys(g)) {
            const bucket = g[ver];
            if (!bucket || typeof bucket !== "object") continue;
            for (const scopeName of ["globalScope", "defaultCurrentScope", "defaultIsolationScope", "hub", "currentScope", "isolationScope"]) {
                const scope = bucket[scopeName];
                if (!scope) continue;
                try { starveClient(scope.getClient?.()); } catch { }
                try { if (Array.isArray(scope._clientStack)) for (const frame of scope._clientStack) starveClient(frame?.client); } catch { }
            }
            try {
                const gs = bucket.globalScope;
                if (gs && typeof gs.setClient === "function") {
                    const origSet = gs.setClient.bind(gs);
                    gs.setClient = (c: unknown) => { starveClient(c); return origSet(c); };
                }
            } catch { }
        }
        logger.info(`Neutered ${seen.size} Sentry client(s).`);
        return seen.size > 0;
    },

    startSentryStarver() {
        if (this.sentryPoll) clearInterval(this.sentryPoll);
        this.sentryTries = 0;
        // The SDK boots from a remotely loaded chunk whose init call string patches
        // can't reach. Poll briefly for the registry global instead; once it exists
        // every client gets starved, and setClient is wrapped so later clients die too.
        this.sentryPoll = setInterval(() => {
            this.sentryTries++;
            let starved = false;
            try { starved = this.starveSentry(); } catch (err) {
                logger.warn("sentry starvation pass failed", err);
            }
            if ((starved && window.__SENTRY__) || this.sentryTries > 90) {
                if (this.sentryPoll) clearInterval(this.sentryPoll);
                this.sentryPoll = null;
            }
        }, 2000);
    },

    stopSentryStarver() {
        if (this.sentryPoll) {
            clearInterval(this.sentryPoll);
            this.sentryPoll = null;
        }
    },

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

    start() {
        if (settings.store.starveSentryRuntime) this.startSentryStarver();
    },

    stop() {
        this.stopSentryStarver();
    },
});
