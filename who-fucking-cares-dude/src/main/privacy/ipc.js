/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { ipcMain } from "electron";
import { dnsResolver } from "./dnsResolver";
import { trafficGuard } from "./trafficGuard";
export function registerPrivacyIpcHandlers() {
    ipcMain.handle("TestCordPrivacyGetData" /* IpcEvents.PRIVACY_GET_DATA */, () => {
        return {
            counters: trafficGuard.getCounters(),
            shields: trafficGuard.getShields(),
            outboundRoutes: trafficGuard.getOutboundRoutes(),
            logs: trafficGuard.getLogs(),
            allowedLogs: trafficGuard.getAllowedLogs(),
            maxLogs: trafficGuard.getMaxLogs(),
            hostRules: trafficGuard.getHostRules(),
            alerts: trafficGuard.getAlerts(),
            dnsProviders: dnsResolver.getAllProviders(),
            selectedDnsProvider: dnsResolver.getSelectedProviderName(),
            dnsEnabled: dnsResolver.isEnabled(),
            dnsLatencies: dnsResolver.getLatencies(),
            dnsCacheStats: dnsResolver.getCacheStats(),
            dnsDiagnosticLogs: dnsResolver.getDiagnosticLogs()
        };
    });
    ipcMain.handle("TestCordPrivacySetMaxLogs" /* IpcEvents.PRIVACY_SET_MAX_LOGS */, (_, limit) => {
        return trafficGuard.setMaxLogs(limit);
    });
    ipcMain.handle("TestCordPrivacyClearAllowedLogs" /* IpcEvents.PRIVACY_CLEAR_ALLOWED_LOGS */, () => {
        trafficGuard.clearAllowedLogs();
        return [];
    });
    ipcMain.handle("TestCordPrivacyGetHostRules" /* IpcEvents.PRIVACY_GET_HOST_RULES */, () => {
        return trafficGuard.getHostRules();
    });
    ipcMain.handle("TestCordPrivacySetHostRule" /* IpcEvents.PRIVACY_SET_HOST_RULE */, (_, host, rule) => {
        return trafficGuard.setHostRule(host, rule);
    });
    ipcMain.handle("TestCordPrivacyClearHostRule" /* IpcEvents.PRIVACY_CLEAR_HOST_RULE */, (_, host) => {
        return trafficGuard.clearHostRule(host);
    });
    ipcMain.handle("TestCordPrivacyAckAlerts" /* IpcEvents.PRIVACY_ACK_ALERTS */, () => {
        return trafficGuard.acknowledgeAlerts();
    });
    ipcMain.handle("TestCordPrivacyToggleShield" /* IpcEvents.PRIVACY_TOGGLE_SHIELD */, (_, key, value) => {
        trafficGuard.setShield(key, value);
        return trafficGuard.getShields();
    });
    ipcMain.handle("TestCordPrivacySetDnsProvider" /* IpcEvents.PRIVACY_SET_DNS_PROVIDER */, (_, name) => {
        return dnsResolver.setSelectedProvider(name);
    });
    ipcMain.handle("TestCordPrivacySetDnsEnabled" /* IpcEvents.PRIVACY_SET_DNS_ENABLED */, (_, enabled) => {
        return dnsResolver.setEnabled(enabled);
    });
    ipcMain.handle("TestCordPrivacyAddCustomDns" /* IpcEvents.PRIVACY_ADD_CUSTOM_DNS */, (_, name, doh, fallback) => {
        return dnsResolver.addCustomEndpoint(name, doh, fallback);
    });
    ipcMain.handle("TestCordPrivacyPingLatencies" /* IpcEvents.PRIVACY_PING_LATENCIES */, async () => {
        return await dnsResolver.pingAllLatencies();
    });
    ipcMain.handle("TestCordPrivacyRunDiagnostic" /* IpcEvents.PRIVACY_RUN_DIAGNOSTIC */, async (_, mode) => {
        await dnsResolver.runDiagnostic(mode || "auto");
        return dnsResolver.getDiagnosticLogs();
    });
    ipcMain.handle("TestCordPrivacyStopDiagnostic" /* IpcEvents.PRIVACY_STOP_DIAGNOSTIC */, () => {
        dnsResolver.stopDiagnostic();
        return dnsResolver.getDiagnosticLogs();
    });
    ipcMain.handle("TestCordPrivacyClearDnsCache" /* IpcEvents.PRIVACY_CLEAR_DNS_CACHE */, () => {
        dnsResolver.clearCache();
        return dnsResolver.getCacheStats();
    });
    ipcMain.handle("TestCordPrivacyClearLogs" /* IpcEvents.PRIVACY_CLEAR_LOGS */, () => {
        trafficGuard.clearLogs();
        return [];
    });
    ipcMain.handle("TestCordPrivacyIncrementCounter" /* IpcEvents.PRIVACY_INCREMENT_COUNTER */, (_, key, amount) => {
        trafficGuard.incrementCounter(key, amount);
        return trafficGuard.getCounters();
    });
}
