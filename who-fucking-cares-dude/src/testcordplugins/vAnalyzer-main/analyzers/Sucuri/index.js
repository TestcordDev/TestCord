/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Toasts } from "@webpack/common";
import { safeToast } from "../../utils";
const Native = VencordNative.pluginHelpers.vAnalyzer;
function gradeFromRatings(ratings) {
    const ratingsToCheck = [
        ratings?.security?.rating,
        ratings?.total?.rating,
        ratings?.domain?.rating,
        ratings?.tls?.rating
    ];
    for (const value of ratingsToCheck) {
        if (typeof value !== "string" || value.length === 0)
            continue;
        const letter = value[0].toUpperCase();
        if (letter === "D" || letter === "E" || letter === "F")
            return "suspicious";
        if (letter === "A")
            return "safe";
    }
    return "neutral";
}
export async function analyzeWithSucuriDetailed(url, silent = false, suppressUnresolvedResult = false) {
    if (!silent)
        safeToast(`Scanning reputation for ${url} (Sucuri)...`);
    const result = await Native.querySucuri(url);
    if (result.error) {
        if (!silent)
            safeToast(`Sucuri scan failed: ${result.error}`, Toasts.Type.FAILURE);
        return { analysis: null, domainResolved: null };
    }
    const { data } = result;
    const details = [];
    const site = data?.site || {};
    const ratings = data?.ratings || {};
    let ip;
    if (site.ip?.length) {
        ip = site.ip[0];
    }
    else {
        ip = "Unknown";
    }
    // if IP is unknown
    if (ip === "Unknown") {
        if (!silent)
            safeToast(`Sucuri: ${url} could not be resolved`, Toasts.Type.FAILURE);
        if (suppressUnresolvedResult) {
            return { analysis: null, domainResolved: false };
        }
        // this should not appear bc now if the domain cannot be resolved, the analyzer avoid other scans
        details.push({
            message: "[Sucuri] Domain could not be resolved (DNS lookup failed: the domain may not exist or is expired or has no DNS records)",
            type: "error"
        });
        return { analysis: { details, timestamp: Date.now() }, domainResolved: false };
    }
    const ratingType = gradeFromRatings(ratings);
    const warningMessages = Array.isArray(data?.warnings?.malware)
        ? data.warnings.malware
            .map((w) => w?.msg)
            .filter((message) => typeof message === "string" && message.length > 0)
        : [];
    const blacklists = Array.isArray(data?.blacklists) ? data.blacklists : [];
    const detectedBlacklists = blacklists.filter((b) => b?.status === "BLOCK");
    const securityRating = ratings?.security?.rating ?? "?";
    const totalRating = ratings?.total?.rating ?? "?";
    const tlsRating = ratings?.tls?.rating ?? "?";
    details.push({
        message: `[Sucuri] Ratings: Security ${securityRating} | Total ${totalRating} | TLS ${tlsRating}`,
        type: ratingType
    });
    const cdn = site.cdn?.join(", ") || "None";
    const software = site.running_on?.join(", ") || "Unknown";
    details.push({
        message: `[Sucuri] IP: ${ip} | CDN: ${cdn} | Server: ${software}`,
        type: "neutral"
    });
    if (warningMessages.length > 0) {
        details.push({
            message: `[Sucuri] Threats: ${warningMessages.join(", ")}`,
            type: "neutral"
        });
    }
    if (detectedBlacklists.length > 0) {
        details.push({
            message: `[Sucuri] Blacklists: ${detectedBlacklists.map((b) => b.vendor || "unknown vendor").join(", ")}`,
            type: "neutral"
        });
    }
    else {
        details.push({ message: "[Sucuri] Not detected on major blacklists", type: "safe" });
    }
    if (!silent) {
        const isSafe = ratingType === "safe";
        if (isSafe) {
            safeToast(`Sucuri: ${url} looks safe.`, Toasts.Type.SUCCESS);
        }
        else {
            safeToast(`Sucuri: Issues found on ${url}!`, Toasts.Type.FAILURE);
        }
    }
    return { analysis: { details, timestamp: Date.now() }, domainResolved: true };
}
export async function analyzeWithSucuri(url, silent = false) {
    const result = await analyzeWithSucuriDetailed(url, silent);
    return result.analysis;
}
