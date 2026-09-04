/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import experimentalIconBase64 from "file://../../browser/ExpirimentalIcon.png?base64";
import legacyIconBase64 from "file://../../browser/LegacyIcon.png?base64";

export const ExperimentalIconUrl = `data:image/png;base64,${experimentalIconBase64}`;
export const LegacyIconUrl = `data:image/png;base64,${legacyIconBase64}`;

export type PluginWarningType = "experimental" | "legacy" | "warning";

export interface PluginWarningInfo {
    type: PluginWarningType;
    label: string;
    title: string;
    description: string;
    icon: string;
    badgeClass?: string;
    replacementPlugin?: string;
}

/**
 * Add plugin names here that should be marked as EXPERIMENTAL.
 */
export const EXPERIMENTAL_PLUGINS: string[] = [
    "BadgeSpoofer",
    "AntilogPremium",
    "ChromeTabs",
    "ActivityBanner",
    "FastDiscord",
    "TestcordOptimizer",
    "NoButtons",
    "NSFWGateBypass",
    "PerformanceBoost",
    "TrustMeBro",
    "trustmebro"
];

/**
 * Add plugin names here that should be marked as LEGACY.
 */
export const LEGACY_PLUGINS: string[] = [
    "StereoInstaller",
    "AntiStereo",
    "FakeMuteDeafen",
    "fakemuteanddeafen",
    "NitroSniper",
    "GuildCopier",
    "TokenImporter",
    "UserAreaTweaks"
];

/**
 * Map of legacy plugin names to their replacement plugin names.
 * Matching is case-insensitive and ignores spaces, hyphens, and underscores.
 */
export const LEGACY_REPLACEMENTS: Record<string, string> = {
    "AntiStereo": "Force Mono",
    "antistereo": "Force Mono",
    "FakeMuteDeafen": "FakeVoicePremium",
    "fakemutedeafen": "FakeVoicePremium",
    "fakemuteanddeafen": "FakeVoicePremium",
    "GuildCopier": "ServerToolkit",
    "guildcopier": "ServerToolkit",
    "NitroSniper": "AutoRedeem",
    "nitrosniper": "AutoRedeem",
    "StereoInstaller": "StereoLoader",
    "stereoinstaller": "StereoLoader",
    "TokenImporter": "DXTokenImporter",
    "tokenimporter": "DXTokenImporter",
    "UserAreaTweaks": "deraculpanellayout",
    "userareatweaks": "deraculpanellayout"
};

/**
 * Optional custom warning configurations for specific plugins.
 */
export const CUSTOM_PLUGIN_WARNINGS: Record<string, {
    label: string;
    title?: string;
    description: string;
    type?: PluginWarningType;
    icon?: string;
    replacementPlugin?: string;
}> = {};

const EXPERIMENTAL_INFO: PluginWarningInfo = {
    type: "experimental",
    label: "Experimental",
    title: "Experimental Plugin",
    description: "This plugin is in active experimentation and may be unstable, have bugs, or change frequently.",
    icon: ExperimentalIconUrl,
    badgeClass: "vc-plugin-warning-experimental",
};

const LEGACY_INFO: PluginWarningInfo = {
    type: "legacy",
    label: "Legacy",
    title: "Legacy Plugin",
    description: "This plugin is legacy and may no longer be actively maintained or receive updates.",
    icon: LegacyIconUrl,
    badgeClass: "vc-plugin-warning-legacy",
};

/**
 * Normalizes plugin names for consistent matching.
 */
export function normalizeName(name: string): string {
    return name.trim().toLowerCase().replace(/[\s\-_]/g, "");
}

/**
 * Gets the replacement plugin name for a legacy plugin if defined.
 */
export function getLegacyReplacement(pluginName: string): string | undefined {
    const norm = normalizeName(pluginName);
    for (const [key, replacement] of Object.entries(LEGACY_REPLACEMENTS)) {
        if (normalizeName(key) === norm) {
            return replacement;
        }
    }
    return undefined;
}

/**
 * Checks whether a given plugin name is in the EXPERIMENTAL list.
 */
export function isExperimentalPlugin(pluginName: string): boolean {
    const norm = normalizeName(pluginName);
    return EXPERIMENTAL_PLUGINS.some(p => normalizeName(p) === norm);
}

/**
 * Checks whether a given plugin name is in the LEGACY list or has a legacy replacement.
 */
export function isLegacyPlugin(pluginName: string): boolean {
    const norm = normalizeName(pluginName);
    return !!getLegacyReplacement(pluginName) || LEGACY_PLUGINS.some(p => normalizeName(p) === norm);
}

/**
 * Determines the warning info (if any) for a given plugin or plugin name.
 * Checks the central registry lists, custom warnings, plugin definition properties, and tags.
 */
export function getPluginWarning(pluginOrName: { name?: string; experimental?: boolean; legacy?: boolean; tags?: string[]; } | string | undefined | null): PluginWarningInfo | null {
    if (!pluginOrName) return null;

    const name = typeof pluginOrName === "string" ? pluginOrName : pluginOrName.name;
    if (!name) return null;

    const norm = normalizeName(name);
    const replacementPlugin = getLegacyReplacement(name);

    const customMatch = Object.entries(CUSTOM_PLUGIN_WARNINGS).find(([key]) => normalizeName(key) === norm);
    if (customMatch) {
        const [, val] = customMatch;
        const type = val.type ?? "warning";
        const rep = val.replacementPlugin ?? (type === "legacy" ? replacementPlugin : undefined);
        return {
            type,
            label: val.label,
            title: val.title ?? `${val.label} Plugin`,
            description: rep
                ? `This plugin is legacy and has been replaced by ${rep}.`
                : val.description,
            icon: val.icon ?? (type === "legacy" ? LegacyIconUrl : ExperimentalIconUrl),
            badgeClass: `vc-plugin-warning-${type}`,
            replacementPlugin: rep,
        };
    }

    if (EXPERIMENTAL_PLUGINS.some(p => normalizeName(p) === norm)) {
        return EXPERIMENTAL_INFO;
    }

    if (replacementPlugin || LEGACY_PLUGINS.some(p => normalizeName(p) === norm)) {
        return {
            ...LEGACY_INFO,
            replacementPlugin,
            description: replacementPlugin
                ? `This plugin is legacy and has been replaced by ${replacementPlugin}.`
                : LEGACY_INFO.description,
        };
    }

    if (typeof pluginOrName !== "string") {
        if (pluginOrName.experimental || pluginOrName.tags?.includes("experimental")) {
            return EXPERIMENTAL_INFO;
        }
        if (pluginOrName.legacy || pluginOrName.tags?.includes("legacy")) {
            return {
                ...LEGACY_INFO,
                replacementPlugin,
                description: replacementPlugin
                    ? `This plugin is legacy and has been replaced by ${replacementPlugin}.`
                    : LEGACY_INFO.description,
            };
        }
    }

    return null;
}
