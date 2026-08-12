/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    notifyNewQuests: {
        type: OptionType.BOOLEAN,
        description: "Show a notification when a new region-restricted quest is detected.",
        default: true,
        restartNeeded: false,
    },
    discoverQuestsViaProxies: {
        type: OptionType.BOOLEAN,
        description: "Use configured proxies to discover active claimable quests available in each region. Only runs from commands, not automatically.",
        default: false,
        restartNeeded: false,
    },
    proxyDiscoveryIntervalMinutes: {
        type: OptionType.NUMBER,
        description: "Minimum minutes between automatic proxy quest discovery scans.",
        default: 15,
        restartNeeded: false,
    },
    proxySource: {
        type: OptionType.SELECT,
        description: "Where to pull proxies from when fetching/enrolling region quests. 'Auto (all APIs)' fetches from all providers for the target country simultaneously.",
        options: [
            { label: "Proxy file (.txt)", value: "file", default: true },
            { label: "Auto (all APIs — ProxyScrape + FlashProxy + Proxifly + Geonode)", value: "api" },
            { label: "ProxyScrape v4", value: "proxyscrape" },
            { label: "FlashProxy", value: "flashproxy" },
            { label: "Proxifly (jsDelivr CDN)", value: "proxifly" },
            { label: "Geonode", value: "geonode" },
            { label: "ProxyRadar", value: "proxyradar" },
            { label: "monosans proxy-list", value: "monosans" },
            { label: "ClearProxy checked list", value: "clearproxy" },
            { label: "IPLocate free proxy list", value: "iplocate" },
            { label: "JetKai proxy-list", value: "jetkai" },
            { label: "Vakhov fresh proxy list", value: "vakhov" },
            { label: "TheSpeedX PROXY-List", value: "thespeedx" },
            { label: "Proxy-List-World", value: "proxylistworld" },
            { label: "Databay free proxy list", value: "databay" },
            { label: "Worldpool", value: "worldpool" },
            { label: "ProxyGenerator", value: "proxygenerator" },
            { label: "stormsia proxy-list", value: "stormsia" },
            { label: "clarketm proxy-list", value: "clarketm" },
        ] as const,
        restartNeeded: false,
    },
    proxyCheckService: {
        type: OptionType.SELECT,
        description: "Service used to pre-check proxies before fetching regional quests.",
        options: [
            { label: "proxycheck.io", value: "proxycheck", default: true },
            { label: "ip-api.com", value: "ip-api" },
            { label: "ipify.org", value: "ipify" },
        ] as const,
        restartNeeded: false,
    },
    rareRegionProxyMode: {
        type: OptionType.BOOLEAN,
        description: "Use broader samples and longer proxy checks for rare regions with weak free proxy coverage.",
        default: true,
        restartNeeded: false,
    },
    autoStartDelayMs: {
        type: OptionType.NUMBER,
        description: "Delay in milliseconds between each enroll request when running /auto-start-region-quests (default: 2000).",
        default: 2000,
        restartNeeded: false,
    },
    // Stores the raw text content of the loaded proxy file. Not shown directly — driven by the file picker in settingsAboutComponent.
    proxyFileContent: {
        type: OptionType.STRING,
        description: "Loaded proxy list (managed by file picker — do not edit manually).",
        default: "",
        restartNeeded: false,
        hidden: true,
    },
    notifiedQuestIds: {
        type: OptionType.CUSTOM,
        description: "Region quest IDs that have already triggered a new quest notification.",
        default: [] as string[],
        hidden: true,
    },
});
