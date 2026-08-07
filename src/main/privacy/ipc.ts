/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IpcEvents } from "@shared/IpcEvents";
import { ipcMain } from "electron";

import { dnsResolver } from "./dnsResolver";
import { trafficGuard } from "./trafficGuard";

export function registerPrivacyIpcHandlers() {
    ipcMain.handle(IpcEvents.PRIVACY_GET_DATA, () => {
        return {
            counters: trafficGuard.getCounters(),
            shields: trafficGuard.getShields(),
            outboundRoutes: trafficGuard.getOutboundRoutes(),
            logs: trafficGuard.getLogs(),
            hostRules: trafficGuard.getHostRules(),
            alerts: trafficGuard.getAlerts(),
            dnsProviders: dnsResolver.getAllProviders(),
            selectedDnsProvider: dnsResolver.getSelectedProviderName(),
            dnsLatencies: dnsResolver.getLatencies(),
            dnsCacheStats: dnsResolver.getCacheStats(),
            dnsDiagnosticLogs: dnsResolver.getDiagnosticLogs()
        };
    });

    ipcMain.handle(IpcEvents.PRIVACY_GET_HOST_RULES, () => {
        return trafficGuard.getHostRules();
    });

    ipcMain.handle(IpcEvents.PRIVACY_SET_HOST_RULE, (_, host: string, rule: "allow" | "block") => {
        return trafficGuard.setHostRule(host, rule);
    });

    ipcMain.handle(IpcEvents.PRIVACY_CLEAR_HOST_RULE, (_, host: string) => {
        return trafficGuard.clearHostRule(host);
    });

    ipcMain.handle(IpcEvents.PRIVACY_ACK_ALERTS, () => {
        return trafficGuard.acknowledgeAlerts();
    });

    ipcMain.handle(IpcEvents.PRIVACY_TOGGLE_SHIELD, (_, key: any, value: boolean) => {
        trafficGuard.setShield(key, value);
        return trafficGuard.getShields();
    });

    ipcMain.handle(IpcEvents.PRIVACY_SET_DNS_PROVIDER, (_, name: string) => {
        return dnsResolver.setSelectedProvider(name);
    });

    ipcMain.handle(IpcEvents.PRIVACY_ADD_CUSTOM_DNS, (_, name: string, doh: string, fallback: string) => {
        return dnsResolver.addCustomEndpoint(name, doh, fallback);
    });

    ipcMain.handle(IpcEvents.PRIVACY_PING_LATENCIES, async () => {
        return await dnsResolver.pingAllLatencies();
    });

    ipcMain.handle(IpcEvents.PRIVACY_RUN_DIAGNOSTIC, async (_, mode: "doh" | "dot" | "auto") => {
        await dnsResolver.runDiagnostic(mode || "auto");
        return dnsResolver.getDiagnosticLogs();
    });

    ipcMain.handle(IpcEvents.PRIVACY_STOP_DIAGNOSTIC, () => {
        dnsResolver.stopDiagnostic();
        return dnsResolver.getDiagnosticLogs();
    });

    ipcMain.handle(IpcEvents.PRIVACY_CLEAR_DNS_CACHE, () => {
        dnsResolver.clearCache();
        return dnsResolver.getCacheStats();
    });

    ipcMain.handle(IpcEvents.PRIVACY_CLEAR_LOGS, () => {
        trafficGuard.clearLogs();
        return [];
    });

    ipcMain.handle(IpcEvents.PRIVACY_INCREMENT_COUNTER, (_, key: any, amount?: number) => {
        trafficGuard.incrementCounter(key, amount);
        return trafficGuard.getCounters();
    });
}
