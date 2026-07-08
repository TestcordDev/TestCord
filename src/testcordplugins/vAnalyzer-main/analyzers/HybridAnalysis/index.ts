/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { sleep } from "@utils/misc";
import { PluginNative } from "@utils/types";
import { Toasts } from "@webpack/common";

import { settings } from "../../settings";
import { AnalysisValue, safeToast } from "../../utils";

const Native = VencordNative.pluginHelpers.vAnalyzer as PluginNative<typeof import("./native")>;

function isFinished(data: any): boolean {
    return data.finished === true;
}

function hasResults(data: any): boolean {
    const s = data.scanners_v2;
    if (!s) return false;
    return Object.values(s).some((v: any) => v && v.status !== "in-queue");
}

function buildDetails(data: any): AnalysisValue["details"] {
    const details: AnalysisValue["details"] = [];
    const scanners = data.scanners_v2;

    if (!scanners) {
        details.push({ message: "[HA] No scanner results available", type: "neutral" });
        return details;
    }

    let malicious = 0;
    let suspicious = 0;
    let clean = 0;
    let type: "malicious" | "suspicious" | "safe";

    for (const [key, scanner] of Object.entries(scanners)) {
        if (!scanner) continue;
        const s = scanner as any;
        const name = s.name ?? key;

        /*
            this needs a rework, some endpoints have a "file_password" field to manage this cases
            for some reason, metadefender says "clean" when someone uploads a protected file in the HB endpoint,
            so I am using the crowdstrike result to show if the file was analyzed
        */
        if (typeof s.name === "string" && s.name.includes("CrowdStrike")) {
            if (s.status === "no-result") {
                type = "suspicious";
                details.unshift({ message: "[HA] This file hasnt been fully scanned", type });
            }
        }

        if (s.status === "malicious") {
            malicious++;
            details.push({ message: `[HA] ${name}: malicious`, type: "malicious" });
        } else if (s.status === "suspicious") {
            suspicious++;
            details.push({ message: `[HA] ${name}: suspicious`, type: "suspicious" });
        } else if (s.status === "no-result" || s.status === "in-queue") {
            // skip
        } else {
            clean++;
        }
    }

    if (malicious > 0) {
        type = "malicious";
    } else if (suspicious > 0) {
        type = "suspicious";
    } else {
        type = "safe";
    }

    details.unshift({ message: `[HA] ${malicious} mal / ${suspicious} sus / ${clean} clean`, type });

    return details;
}

async function waitForResults(apiKey: string, scanId: string, silent: boolean): Promise<any> {
    for (let i = 0; i < 10; i++) {
        await sleep(3000);
        if (!silent && i === 0) safeToast("Waiting for Hybrid Analysis results...");

        const poll = await Native.hybridAnalysisGetScan(apiKey, scanId);
        if (poll.status === 200 && poll.data) {
            if (isFinished(poll.data) || hasResults(poll.data)) return poll.data;
        }
    }
    return null;
}

function buildHashDetails(reports: any[]): AnalysisValue["details"] {
    const details: AnalysisValue["details"] = [];

    for (const report of reports) {
        const env = report.environment_description ?? `env ${report.environment_id}`;
        const verdict = report.verdict ?? "unknown";

        let type: "malicious" | "suspicious" | "safe" | "neutral";
        if (verdict === "malicious") {
            type = "malicious";
        } else if (verdict === "suspicious") {
            type = "suspicious";
        } else if (verdict === "no specific threat") {
            type = "safe";
        } else {
            type = "neutral";
        }

        details.push({ message: `[HA] ${env}: ${verdict}`, type });
    }

    const hasMalicious = reports.some(r => r.verdict === "malicious");
    const hasSuspicious = reports.some(r => r.verdict === "suspicious");

    let summaryType: "malicious" | "suspicious" | "safe";
    if (hasMalicious) {
        summaryType = "malicious";
    } else if (hasSuspicious) {
        summaryType = "suspicious";
    } else {
        summaryType = "safe";
    }
    details.unshift({ message: `[HA] Found ${reports.length} existing report(s)`, type: summaryType });

    return details;
}

async function submitAndWait(submitFn: () => Promise<any>, silent: boolean): Promise<AnalysisValue | null> {
    const apiKey = settings.store.hybridAnalysisApiKey;
    if (!apiKey) {
        if (!silent) safeToast("Hybrid Analysis API key required. Set it in vAnalyzer settings.", Toasts.Type.FAILURE);
        return null;
    }

    const result = await submitFn();

    if (result.status !== 200 || !result.data) {
        if (!silent) safeToast(`Hybrid Analysis scan failed: ${result.error ?? result.status}`, Toasts.Type.FAILURE);
        return null;
    }

    let { data } = result;

    if (!isFinished(data) && !hasResults(data) && data.id) {
        data = await waitForResults(apiKey, data.id, silent);
        if (!data) {
            if (!silent) safeToast("Hybrid Analysis scan timed out", Toasts.Type.FAILURE);
            return null;
        }
    }

    return { details: buildDetails(data), timestamp: Date.now() };
}

export async function analyzeUrlWithHybridAnalysis(url: string, silent = false): Promise<AnalysisValue | null> {
    if (!silent) safeToast("Submitting URL to Hybrid Analysis...");
    const apiKey = settings.store.hybridAnalysisApiKey;
    return submitAndWait(() => Native.hybridAnalysisQuickScanUrl(apiKey, url), silent);
}

export async function analyzeFileWithHybridAnalysis(fileUrl: string, fileName: string, silent = false): Promise<AnalysisValue | null> {
    const apiKey = settings.store.hybridAnalysisApiKey;
    if (!apiKey) {
        if (!silent) safeToast("Hybrid Analysis API key required. Set it in vAnalyzer settings.", Toasts.Type.FAILURE);
        return null;
    }

    // hash the file and check if its already been analyzed
    if (!silent) safeToast("Hashing file...");
    const hashResult = await Native.hybridAnalysisHashFile(fileUrl);

    if (hashResult.sha256) {
        if (!silent) safeToast(`SHA-256: ${hashResult.sha256}. Searching...`);

        const search = await Native.hybridAnalysisSearchHash(apiKey, hashResult.sha256);
        if (search.status === 200 && search.data?.reports?.length > 0) {
            if (!silent) safeToast(`Found ${search.data.reports.length} existing report(s)`, Toasts.Type.SUCCESS);
            return { details: buildHashDetails(search.data.reports), timestamp: Date.now() };
        }
    }

    // submit for quick scan
    if (!silent) safeToast("No existing report. Uploading file to Hybrid Analysis...");
    return submitAndWait(() => Native.hybridAnalysisQuickScanFile(apiKey, fileUrl, fileName), silent);
}
