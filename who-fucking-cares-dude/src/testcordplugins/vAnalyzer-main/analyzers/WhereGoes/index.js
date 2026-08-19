/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Toasts } from "@webpack/common";
import { safeToast } from "../../utils";
const Native = VencordNative.pluginHelpers.vAnalyzer;
function parseTraceHtml(html) {
    const hops = [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const rows = doc.querySelectorAll(".trace-results .row.details");
    for (const row of rows) {
        const numCell = row.querySelector(".cell.num");
        const statusCell = row.querySelector(".cell.status a, .cell.status");
        const urlCell = row.querySelector(".cell.url .no-crawl-url, .cell.url a[href]");
        const step = parseInt(numCell?.textContent?.trim() ?? "0", 10);
        const parsedStatus = parseInt(statusCell?.textContent?.trim() ?? "", 10);
        const statusCode = Number.isFinite(parsedStatus) ? parsedStatus : 0;
        let url = "";
        if (urlCell) {
            if (urlCell.classList.contains("no-crawl-url")) {
                url = urlCell.textContent?.replace(/\|/g, "").trim() ?? "";
            }
            else {
                url = urlCell.getAttribute("href") || (urlCell.textContent?.trim() ?? "");
            }
        }
        if (step > 0 && url) {
            hops.push({ step, statusCode, url });
        }
    }
    return hops;
}
function buildUrlDetails(hops) {
    const details = [];
    if (hops.length === 0) {
        details.push({ message: "[WhereGoes] No redirects detected: direct URL", type: "safe" });
        return details;
    }
    const finalHop = hops[hops.length - 1];
    const redirectCount = hops.filter(h => h.statusCode >= 300 && h.statusCode < 400).length;
    const hasError = hops.some(h => h.statusCode >= 400);
    if (redirectCount > 0) {
        let redirectType;
        if (hasError) {
            redirectType = "error";
        }
        else if (redirectCount > 3) {
            redirectType = "suspicious";
        }
        else {
            redirectType = "safe";
        }
        details.push({
            message: `[WhereGoes] ${redirectCount} redirect(s) -> ${finalHop.url}`,
            type: redirectType
        });
    }
    else {
        let directType;
        if (finalHop.statusCode >= 400) {
            directType = "error";
        }
        else {
            directType = "safe";
        }
        const statusLabel = finalHop.statusCode > 0 ? String(finalHop.statusCode) : "unknown";
        details.push({
            message: `[WhereGoes] Direct URL (${statusLabel})`,
            type: directType
        });
    }
    return details;
}
export async function analyzeWithWhereGoes(url, silent = false) {
    if (!silent)
        safeToast("Tracing URL redirects...");
    const result = await Native.traceUrl(url);
    if (result.debug) {
        console.log("[vAnalyzer] WhereGoes debug:", result.debug);
    }
    if (result.status !== 200 || !result.html) {
        if (!silent)
            safeToast(`Trace failed: ${result.error ?? "unknown error"}`, Toasts.Type.FAILURE);
        return null;
    }
    const hops = parseTraceHtml(result.html);
    if (hops.length === 0) {
        return { details: [{ message: "No redirects detected: direct URL", type: "safe" }], timestamp: Date.now() };
    }
    if (!silent)
        safeToast(`${hops.length} hop(s) found`, Toasts.Type.SUCCESS);
    return { details: buildUrlDetails(hops), timestamp: Date.now() };
}
