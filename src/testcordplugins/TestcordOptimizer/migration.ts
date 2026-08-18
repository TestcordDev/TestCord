/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

interface StoredPluginSettings {
    enabled?: boolean;
    [setting: string]: unknown;
}

export function migrateOptimizerSettings(plugins: Record<string, StoredPluginSettings>): boolean {
    const legacy = plugins.optimizerPremium;
    if (!legacy) return false;

    const canonical = plugins.TestcordOptimizer;
    if (!canonical) {
        plugins.TestcordOptimizer = { ...legacy };
    } else {
        for (const [key, value] of Object.entries(legacy)) {
            if (key === "enabled") {
                if (value === true) canonical.enabled = true;
            } else if (!Object.hasOwn(canonical, key)) {
                canonical[key] = value;
            }
        }
    }

    delete plugins.optimizerPremium;
    return true;
}
