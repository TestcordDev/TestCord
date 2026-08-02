/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { UserStore } from "@webpack/common";

const infos: Record<string, { os: string; browser: string }> = {
    windows: { os: "Windows", browser: "Discord Client" },
    linux: { os: "Linux", browser: "Discord Client" },
    darwin: { os: "Darwin", browser: "Discord Client" },
    macos: { os: "Mac OS X", browser: "Discord Client" },
    android: { os: "Android", browser: "Discord Android" },
    mobile: { os: "iOS", browser: "Discord iOS" },
    ipad: { os: "iPadOS", browser: "Discord iOS" },
    xbox: { os: "Xbox", browser: "Discord Embedded" },
    playstation: { os: "PlayStation", browser: "Discord Embedded" },
    vr: { os: "VR", browser: "Discord VR" },
    console: { os: "Windows", browser: "Discord Embedded" },
    smarttv: { os: "Linux", browser: "Discord Smart TV" },
    other: { os: "Other", browser: "Discord Web" },
    web: { os: "Web", browser: "Discord Web" },
};

const settings = definePluginSettings({
    plateforme: {
        type: OptionType.SELECT,
        description: "The platform to spoof",
        restartNeeded: true,
        default: "windows",
        options: [
            { label: "Windows", value: "windows", default: true },
            { label: "Linux", value: "linux" },
            { label: "Darwin", value: "darwin" },
            { label: "macOS", value: "macos" },
            { label: "Android", value: "android" },
            { label: "iOS (iPhone)", value: "mobile" },
            { label: "iPadOS (iPad)", value: "ipad" },
            { label: "Xbox", value: "xbox" },
            { label: "PlayStation", value: "playstation" },
            { label: "VR Headset", value: "vr" },
            { label: "Console", value: "console" },
            { label: "Smart TV", value: "smarttv" },
            { label: "Web", value: "web" },
            { label: "Other", value: "other" }
        ],
    },
});

export default definePlugin({
    name: "PlatformEmulator",
    description: "PlatformEmulator allows you to spoof your Discord platform (Windows, Linux, Android, iOS, etc.)",
    tags: ["Privacy", "Utility"],
    authors: [TestcordDevs.sirphantom89],
    settings,
    patches: [
        {
            find: "_doIdentify(){",
            replacement: [
                {
                    match: /window._ws=null,null!=\i/,
                    replace: "false"
                },
                {
                    match: /(?<="GatewaySocket"\)\}\),properties:)(\i)/,
                    replace: "{...$1,...$self.getData(true)}"
                },
            ]
        }
    ],
    getData(bypass?: boolean, userId?: any) {
        const selected = settings.store.plateforme ?? "windows";
        const info = infos[selected] ?? infos.windows;

        if (bypass || !userId || userId === UserStore?.getCurrentUser?.()?.id) {
            return {
                os: info.os,
                browser: info.browser
            };
        }

        return {
            os: info.os,
            browser: info.browser
        };
    }
});
