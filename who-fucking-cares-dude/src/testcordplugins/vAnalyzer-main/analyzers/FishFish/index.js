/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Toasts } from "@webpack/common";
import { extractDomain, safeToast } from "../../utils";
const Native = VencordNative.pluginHelpers.vAnalyzer;
export async function analyzeWithFishFish(url, silent = false) {
    const domain = extractDomain(url);
    if (!silent)
        safeToast(`Checking ${domain} against FishFish phishing list...`);
    const result = await Native.queryFishFish(domain);
    if (result.error) {
        if (!silent)
            safeToast(`FishFish lookup failed: ${result.error}`, Toasts.Type.FAILURE);
        return null;
    }
    const details = [];
    if (result.found) {
        details.push({ message: `[FishFish] [PHISHING] ${domain} found in phishing database`, type: "malicious" });
    }
    else {
        details.push({ message: `[FishFish] ${domain} not in phishing database`, type: "safe" });
    }
    if (!silent) {
        if (result.found) {
            safeToast(`WARNING: ${domain} is a known phishing domain!`, Toasts.Type.FAILURE);
        }
        else {
            safeToast(`${domain} not found in FishFish database`, Toasts.Type.SUCCESS);
        }
    }
    return { details, timestamp: Date.now() };
}
