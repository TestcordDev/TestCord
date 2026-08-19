/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import { Alerts, React } from "@webpack/common";
import ModularScanSettings from "./components/ModularScanSettings";
import SeparatorSettings from "./components/SeparatorSettings";
function warnAutoScan(key, enabled) {
    if (!enabled)
        return;
    let body;
    if (key === "autoScanUrls") {
        body = "Enabling auto-scan will send URLs from messages to third-party services for analysis. This may cause rate limiting and exposes the URLs you receive to external APIs. Use with discretion.";
    }
    else {
        body = "Enabling auto-scan will upload file attachments from messages to VirusTotal for analysis. Files may contain private or sensitive content. Use with discretion.";
    }
    Alerts.show({
        title: "Auto-Scan Warning",
        body,
        confirmText: "I understand",
        cancelText: "Cancel",
        onCancel: () => { settings.store[key] = false; }
    });
}
export const settings = definePluginSettings({
    apiHeader: {
        type: 6 /* OptionType.COMPONENT */,
        component: () => <SeparatorSettings label="Services & API Keys"/>
    },
    virusTotalApiKey: {
        type: 0 /* OptionType.STRING */,
        description: "VirusTotal API Key",
        default: "",
        placeholder: "Enter your VirusTotal API key..."
    },
    hybridAnalysisApiKey: {
        type: 0 /* OptionType.STRING */,
        description: "Hybrid Analysis API Key",
        default: "",
        placeholder: "Enter your Hybrid Analysis API key..."
    },
    cordCatApiKey: {
        type: 0 /* OptionType.STRING */,
        description: "CordCat API Key",
        default: "",
        placeholder: "(Not required for now) Enter your CordCat API key..."
    },
    generalHeader: {
        type: 6 /* OptionType.COMPONENT */,
        component: () => <SeparatorSettings label="General Protection"/>
    },
    warnOnLinkClick: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show a warning when clicking a link flagged as malicious or suspicious",
        default: true
    },
    warnOnFileDownload: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show a warning when downloading a file flagged as malicious or suspicious",
        default: true
    },
    analyzeBotsProfile: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Analyze Bots Profile automatically when a bot sends a message",
        default: false
    },
    enableOsintSearchShortcuts: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show Search User / Search Server shortcuts in context menus",
        default: true
    },
    enableCordCat: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show \"Analyze User with CordCat\" in user context menus",
        default: true
    },
    enableFindUserById: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show \"Find User by ID\" in message context menus (look up any user ID via CordCat)",
        default: false
    },
    scopeHeader: {
        type: 6 /* OptionType.COMPONENT */,
        component: () => <SeparatorSettings label="Scan Scope & Direct Messages"/>
    },
    skipFriends: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Skip auto-scan for messages from friends",
        default: true
    },
    autoScanInvitesDirectMessageOnly: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Only auto-analyze invites in Direct Messages",
        default: false,
        disabled: () => !settings.store.autoScanInvites
    },
    autoScanUrlsDirectMessageOnly: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Only auto-scan URLs in Direct Messages",
        default: false,
        disabled: () => !settings.store.autoScanUrls
    },
    autoScanFilesDirectMessageOnly: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Only auto-scan files in Direct Messages",
        default: false,
        disabled: () => !settings.store.autoScanFiles
    },
    messageAgeFilter: {
        type: 5 /* OptionType.SLIDER */,
        description: "Only analyze messages from the last X days (0 = disabled)",
        default: 3,
        markers: [0, 1, 3, 7, 14, 30],
        stickToMarkers: true
    },
    autoScanHeader: {
        type: 6 /* OptionType.COMPONENT */,
        component: () => <SeparatorSettings label="URL & Invite Analysis"/>
    },
    autoScanInvites: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Automatically analyze Discord invites in messages",
        default: true
    },
    checkEmbeds: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Include URLs found in embeds during URL extraction",
        default: false
    },
    autoScanUrls: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Automatically scan URLs found in messages",
        default: false,
        onChange: (v) => warnAutoScan("autoScanUrls", v)
    },
    autoScanUrlsCertPL: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Check domains on the CERT.PL blocklist",
        default: true,
        disabled: () => !settings.store.autoScanUrls
    },
    autoScanUrlsFishFish: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Check domains against FishFish phishing database",
        default: true,
        disabled: () => !settings.store.autoScanUrls
    },
    autoScanUrlsWhereGoes: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Trace URL redirects with WhereGoes",
        default: true,
        disabled: () => !settings.store.autoScanUrls
    },
    autoScanUrlsSucuri: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Check site reputation with Sucuri",
        default: true,
        disabled: () => !settings.store.autoScanUrls
    },
    autoScanUrlsHybridAnalysis: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Scan URLs with Hybrid Analysis (requires API Key)",
        default: false,
        disabled: () => !settings.store.autoScanUrls
    },
    fileScanHeader: {
        type: 6 /* OptionType.COMPONENT */,
        component: () => <SeparatorSettings label="Automatic File Analysis"/>
    },
    autoScanFiles: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Automatically scan file attachments in messages",
        default: false,
        onChange: (v) => warnAutoScan("autoScanFiles", v)
    },
    ignoreMediaFiles: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Ignore media files (images, GIFs, videos, audio) during automatic file scanning",
        default: true,
        disabled: () => !settings.store.autoScanFiles
    },
    autoScanFilesVirusTotal: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Scan files with VirusTotal (requires API Key)",
        default: true,
        disabled: () => !settings.store.autoScanFiles
    },
    virusTotalLookupBeforeUpload: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "VirusTotal: look up hash first before uploading (no API key needed)",
        default: true,
        disabled: () => !settings.store.virusTotalApiKey?.trim().length
    },
    autoScanFilesHybridAnalysis: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Scan files with Hybrid Analysis (requires API Key)",
        default: true,
        disabled: () => !settings.store.autoScanFiles
    },
    filterHeader: {
        type: 6 /* OptionType.COMPONENT */,
        component: () => <SeparatorSettings label="Filters & Blocklists"/>
    },
    useBuiltinWhitelist: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Use built-in whitelist (Discord, YouTube, GitHub, etc. are skipped from scanning)",
        default: true
    },
    enableBlocklists: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Enable URL blocklist checking (flags URLs on known malicious lists)",
        default: true
    },
    enableFmhyBlocklist: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Use FMHY Unsafe Sites Filterlist (auto-updated every 4 days)",
        default: true,
        disabled: () => !settings.store.enableBlocklists
    },
    customWhitelist: {
        type: 0 /* OptionType.STRING */,
        description: "Custom whitelisted domains (comma-separated, e.g. example.com,mysite.org)",
        default: "",
        placeholder: "example.com, mysite.org"
    },
    customBlocklist: {
        type: 0 /* OptionType.STRING */,
        description: "Custom blocklisted domains (comma-separated, e.g. bad-site.com,scam.xyz)",
        default: "",
        placeholder: "bad-site.com, scam.xyz"
    },
    advancedHeader: {
        type: 6 /* OptionType.COMPONENT */,
        component: () => <SeparatorSettings label="Advanced Scanning"/>
    },
    modularScanSettings: {
        type: 6 /* OptionType.COMPONENT */,
        component: ModularScanSettings
    }
});
