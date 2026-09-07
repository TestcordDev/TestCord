/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs, EquicordDevs, TestcordDevs } from "@utils/constants";

import { activityBannerModule } from "../activityBanner";
import { devBannerModule } from "../devBanner";
import { musicControlsModule } from "../musicControls";
import type { MarketplaceCatalogItem, UserAreaModule } from "../types";
import { clockModule } from "./clockWidget";
import { quickNotesModule } from "./quickNotes";
import { quotesModule } from "./quotesWidget";
import { systemMonitorModule } from "./systemMonitor";

export function getBuiltinModules(): Array<Omit<UserAreaModule, "order" | "enabled">> {
    return [
        musicControlsModule,
        activityBannerModule,
        devBannerModule,
        clockModule,
        systemMonitorModule,
        quickNotesModule,
        quotesModule,
    ];
}

export const BUILTIN_MODULES: Array<Omit<UserAreaModule, "order" | "enabled">> = [
    musicControlsModule,
    activityBannerModule,
    devBannerModule,
    clockModule,
    systemMonitorModule,
    quickNotesModule,
    quotesModule,
];

export const MARKETPLACE_CATALOG: MarketplaceCatalogItem[] = [
    {
        id: "music-controls",
        name: "Music Controls",
        description: "Control Spotify & Tidal playback and display synced lyrics in the user area.",
        authors: [Devs.Ven, Devs.afn, Devs.KraXen72, Devs.Av32000, Devs.nin0dev, Devs.thororen, EquicordDevs.vmohammad, Devs.Joona],
        version: "2.0.0",
        tags: ["Media", "Audio", "Spotify", "Tidal"],
        category: "audio",
        isBuiltin: true,
        factory: () => musicControlsModule,
    },
    {
        id: "activity-banner",
        name: "Activity Banner",
        description: "Displays rich presence details, game artwork, elapsed timers, and activity switcher in the user area.",
        authors: [TestcordDevs.sirphantom89],
        version: "1.0.0",
        tags: ["Utility", "Activity", "Rich Presence"],
        category: "utility",
        isBuiltin: true,
        factory: () => activityBannerModule,
    },
    {
        id: "dev-banner",
        name: "Developer Banner",
        description: "Displays Discord & Testcord build number, channel, commit hash, and client information.",
        authors: [EquicordDevs.KrystalSkull, Devs.thororen, TestcordDevs.sirphantom89],
        version: "1.0.0",
        tags: ["Developers", "Appearance"],
        category: "developer",
        isBuiltin: true,
        factory: () => devBannerModule,
    },
    {
        id: "clock-widget",
        name: "Digital Clock & Date",
        description: "A clean digital clock and calendar date directly above your profile in the user area.",
        authors: [TestcordDevs.sirphantom89],
        version: "1.0.0",
        tags: ["Utility", "Time"],
        category: "utility",
        isBuiltin: true,
        factory: () => clockModule,
    },
    {
        id: "system-monitor",
        name: "System & Ping Monitor",
        description: "Live Discord gateway ping latency, memory consumption, and session uptime.",
        authors: [TestcordDevs.sirphantom89],
        version: "1.0.0",
        tags: ["Utility", "Monitor"],
        category: "utility",
        isBuiltin: true,
        factory: () => systemMonitorModule,
    },
    {
        id: "quick-notes",
        name: "Quick Notes",
        description: "A convenient collapsible scratchpad for notes and reminders saved locally.",
        authors: [TestcordDevs.sirphantom89],
        version: "1.0.0",
        tags: ["Utility", "Productivity"],
        category: "utility",
        isBuiltin: true,
        factory: () => quickNotesModule,
    },
    {
        id: "quotes-widget",
        name: "Daily Quotes",
        description: "Displays daily motivational quotes and positive thoughts in your user area.",
        authors: [TestcordDevs.sirphantom89],
        version: "1.0.0",
        tags: ["Aesthetics", "Quotes"],
        category: "appearance",
        isBuiltin: true,
        factory: () => quotesModule,
    },
];

export { clockModule, quickNotesModule, quotesModule, systemMonitorModule };
