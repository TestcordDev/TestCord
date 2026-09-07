/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { disableStyle, enableStyle, setStyleClassNames } from "@api/Styles";
import { registerModule, unregisterModule } from "@testcordplugins/PanelLayout";
import definePlugin, { ReporterTestable } from "@utils/types";
import { findCssClassesLazy } from "@webpack";

import { YMusicSyncPlayer } from "./components/Player";
import { startRichPresence, stopRichPresence } from "./richPresence";
import { settings } from "./settings";
import { YMusicSyncStore } from "./store";
import style from "./styles.css?managed";

const SliderClasses = findCssClassesLazy("slider", "bar", "barFill", "grabber");

export default definePlugin({
    name: "YMusicSync",
    description: "Control Yandex Music through Ynison and Discord RPC",
    authors: [{ name: "diram1x", id: 710580442180485120n }],
    tags: ["Media", "Utility"],
    searchTerms: ["Yandex Music", "Ynison", "YMusicSync", "Music Controls"],
    settings,
    reporterTestable: ReporterTestable.None,

    start() {
        setStyleClassNames(style, { ...SliderClasses }, false);
        enableStyle(style);
        void YMusicSyncStore.start();
        startRichPresence();
        registerModule({
            id: "ymusic-sync",
            name: "Yandex Music Sync",
            description: "Control Yandex Music through Ynison and Discord RPC",
            authors: [{ name: "diram1x", id: 710580442180485120n }],
            version: "1.0.0",
            tags: ["Media", "Audio", "Yandex Music"],
            icon: "📻",
            position: "above",
            render: YMusicSyncPlayer,
        });
    },

    stop() {
        unregisterModule("ymusic-sync");
        disableStyle(style);
        stopRichPresence();
        void YMusicSyncStore.stop();
    },

    toolboxActions: {
        "Reconnect to Ynison": () => void YMusicSyncStore.restart(),
        "Rescan for Yandex Station": () => void YMusicSyncStore.rescanStations(),
        "Log YMusicSync diagnostics": () => void YMusicSyncStore.logDiagnostics()
    }
});
