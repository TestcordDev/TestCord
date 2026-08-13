/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { disableStyle, enableStyle, setStyleClassNames } from "@api/Styles";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { ReporterTestable } from "@utils/types";
import { findCssClassesLazy } from "@webpack";

import { YMusicSyncPlayer } from "./components/Player";
import { startRichPresence, stopRichPresence } from "./richPresence";
import { settings } from "./settings";
import { YMusicSyncStore } from "./store";
import style from "./styles.css?managed";

const SliderClasses = findCssClassesLazy("slider", "bar", "barFill", "grabber");

interface PanelWrapperProps {
    YMusicSync: React.ComponentType<Record<string, unknown>>;
    [key: string]: unknown;
}

export default definePlugin({
    name: "YMusicSync",
    description: "Control Yandex Music through Ynison and Discord RPC",
    authors: [{ name: "diram1x", id: 710580442180485120n }],
    tags: ["Media", "Utility"],
    searchTerms: ["Yandex Music", "Ynison", "YMusicSync", "Music Controls"],
    settings,
    reporterTestable: ReporterTestable.None,

    patches: [
        {
            find: "#{intl::USER_PROFILE_ACCOUNT_POPOUT_BUTTON_A11Y_LABEL}",
            replacement: {
                match: /(?<=\i\.jsxs?\)\()((?:\i\.)*\i(?:\["[^"]+"\])?(?:\.\i)*),{(?=[^})]*?userTag:\i,occluded:)/,
                replace: "$self.PanelWrapper,{YMusicSync:$1,"
            }
        }
    ],

    PanelWrapper: ErrorBoundary.wrap(({ YMusicSync, ...props }: PanelWrapperProps) => (
        <>
            <ErrorBoundary noop>
                <YMusicSyncPlayer />
            </ErrorBoundary>
            <YMusicSync {...props} />
        </>
    ), { noop: true }),

    start() {
        setStyleClassNames(style, { ...SliderClasses }, false);
        enableStyle(style);
        void YMusicSyncStore.start();
        startRichPresence();
    },

    stop() {
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
