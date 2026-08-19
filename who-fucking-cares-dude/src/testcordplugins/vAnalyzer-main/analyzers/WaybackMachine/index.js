/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Toasts } from "@webpack/common";
import { extractDomain, safeToast } from "../../utils";
const Native = VencordNative.pluginHelpers.vAnalyzer;
function formatWaybackTimestamp(ts) {
    // YYYYMMDDHHmmss
    if (ts.length < 8)
        return ts;
    return `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
}
export async function analyzeWithWayback(url, silent = false) {
    const domain = extractDomain(url);
    if (!silent)
        safeToast(`Checking Wayback Machine for ${domain}...`);
    const result = await Native.queryWayback(url);
    if (result.status !== 200 || !result.data) {
        if (!silent)
            safeToast(`Wayback lookup failed: ${result.error ?? "unknown error"}`, Toasts.Type.FAILURE);
        return null;
    }
    const details = [];
    const snapshot = result.data.archived_snapshots.closest;
    if (!snapshot || !snapshot.available) {
        details.push({
            message: `No snapshots found for ${domain}`,
            type: "suspicious"
        });
        details.push({
            message: "No archive history",
            type: "suspicious"
        });
        return { details, timestamp: Date.now() };
    }
    const snapshotDate = formatWaybackTimestamp(snapshot.timestamp);
    const snapshotYear = parseInt(snapshot.timestamp.slice(0, 4), 10);
    const yearsArchived = new Date().getFullYear() - snapshotYear;
    let archiveType;
    if (yearsArchived >= 1) {
        archiveType = "safe";
    }
    else {
        archiveType = "suspicious";
    }
    details.push({
        message: `[Wayback] First seen: ${snapshotDate} (${yearsArchived}y ago)`,
        type: archiveType
    });
    details.push({
        message: `[Wayback] Snapshot: ${snapshot.url}`,
        type: "neutral"
    });
    if (!silent)
        safeToast(`Wayback snapshot found for ${domain}`, Toasts.Type.SUCCESS);
    return { details, timestamp: Date.now() };
}
