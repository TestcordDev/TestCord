/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Toasts } from "@webpack/common";
import { safeToast } from "../../utils";
const Native = VencordNative.pluginHelpers.vAnalyzer;
export async function runModularScan(module, fileUrl, fileName, silent = false) {
    if (!silent)
        safeToast(`Running ${module.name}...`);
    const result = await Native.executeModularScan(module, fileUrl, fileName);
    const details = [];
    if (!result.ok) {
        if (!silent)
            safeToast(`${module.name} failed: ${result.status}`, Toasts.Type.FAILURE);
        // only report actual errors, not normal scan results
        if (result.status === -1) {
            details.push({ message: `[Modular] ${module.name} - Connection error`, type: "malicious" });
        }
        else {
            details.push({ message: `[Modular] ${module.name} - HTTP ${result.status}`, type: "neutral" });
        }
    }
    else {
        details.push({ message: `[Modular] ${module.name} - OK`, type: "safe" });
    }
    if (result.body) {
        let snippet;
        if (result.body.length > 100) {
            snippet = result.body.slice(0, 97) + "...";
        }
        else {
            snippet = result.body;
        }
        snippet = snippet.replace(/\r?\n|\r/g, " ");
        details.push({ message: `Response: ${snippet}`, type: "neutral" });
    }
    return {
        details,
        timestamp: Date.now()
    };
}
