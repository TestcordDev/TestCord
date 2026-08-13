/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType } from "@api/Commands";
import { gitHash } from "@shared/vencordUserAgent";
import { Devs } from "@utils/constants";
import { sendMessage } from "@utils/discord";
import { isPluginDev, tryOrElse } from "@utils/misc";
import definePlugin, { Plugin, PluginNative } from "@utils/types";
import { findByCodeLazy } from "@webpack";
import { GuildMemberStore, UserStore } from "@webpack/common";

import { PluginMeta } from "~plugins";

import { getUserSettingLazy } from "../../api/UserSettings.js";
import SettingsPlugin from "../../plugins/_core/settings";

const Native = VencordNative.pluginHelpers.venfetch as PluginNative<typeof import("./native")>;

const clientVersion = () => {
    const version = IS_DISCORD_DESKTOP ? DiscordNative.app.getVersion() : IS_VESKTOP ? VesktopNative.app.getVersion() : null;
    // @ts-ignore
    const name = IS_DISCORD_DESKTOP ? "Desktop" : IS_VESKTOP ? "Vesktop" : typeof unsafeWindow !== "undefined" ? "UserScript" : "Web";

    return `${name}${version ? ` v${version}` : ""}`;
};

const COLOR_TEST = "[2;40m[2;30m███[0m[2;40m[0m[2;31m[0m[2;30m███[0m[2;31m███[0m[2;32m███[0m[2;33m███[0m[2;34m███[0m[2;35m███[0m[2;36m███[0m[2;37m███[0m";

const LOGO_WITH_ANSI = `\
\n\
\tVV       VV
\t VV     VV
\t  VV   VV
\t   VV VV
\t    VVV
\t        [2;35mCCCCCCC
\t       [2;35mCC
\t      [2;35mCC
\t       [2;35mCC
\t        [2;35mCCCCCCC[0m\
`.split("\n");
const LOGO_NO_ANSI = `\
\n\
\tVV       VV
\t VV     VV
\t  VV   VV
\t   VV VV
\t    VVV
\t        CCCCCCC
\t       CC
\t      CC
\t       CC
\t        CCCCCCC\
`.split("\n");

// ```ansi
// VV       VV                 thepotatofamine
//  VV     VV                  ---------------
//   VV   VV                   Version: v1.10.5 • 88e8fa7e (Dev) - 25 Oct 2024
//    VV VV                    [2;35m[0m[2;35mClient: [0m[0mcanary ~ Vesktop v1.5.3[0m[2;35m[0m
//     VVV                     [2;35m[0m[2;35mPlatform: [0m[0mMacIntel[0m[2;35m[0m
//         [2;35mCCCCCCC             [2;35m[0m[2;35mPlugin Count: [0m[0m119[0m[2;35m[0m
//        [2;35mCC                   [2;35m[0m[2;35mUptime: [0m[0m1997s[0m[2;35m[0m
//       [2;35mCC                    [2;35m[0m[2;35mDonor: [0m[0myes[0m[2;35m[0m
//        [2;35mCC
//         [2;35mCCCCCCC[0m             [2;40m[2;30m███[0m[2;40m[0m[2;31m[0m[2;30m███[0m[2;31m███[0m[2;32m███[0m[2;33m███[0m[2;34m███[0m[2;35m███[0m[2;36m███[0m[2;37m███[0m
// ```;

const isApiPlugin = (plugin: Plugin) => plugin.name?.endsWith("API") || plugin.required;

function getEnabledPlugins() {
    const counters = {
        official: {
            enabled: 0,
            total: 0
        },
        user: {
            enabled: 0,
            total: 0
        }
    };

    Object.values(Vencord.Plugins.plugins).filter(plugin => !isApiPlugin(plugin)).forEach(plugin => {
        if (PluginMeta[plugin.name]?.userPlugin) {
            if (plugin.started) counters.user.enabled++;
            counters.user.total++;
        } else {
            if (plugin.started) counters.official.enabled++;
            counters.official.total++;
        }
    });

    return `${counters.official.enabled} / ${counters.official.total} (official)` + (counters.user.total ? `, ${counters.user.enabled} / ${counters.user.total} (userplugins)` : "");
}
function getDonorStatus() {
    const member = GuildMemberStore.getMember("1015060230222131221", UserStore.getCurrentUser().id);
    return member ? member.roles.includes("1042507929485586532") : false;
}
function getContribStatus() {
    const userId = UserStore.getCurrentUser().id;
    const member = GuildMemberStore.getMember("1015060230222131221", userId);
    return isPluginDev(userId) || (member ? member.roles.includes("1026534353167208489") : false);
}

const getVersions = findByCodeLazy("logsUploaded:new Date().toISOString(),");
const ShowCurrentGame = getUserSettingLazy<boolean>("status", "showCurrentGame")!;

export default definePlugin({
    name: "venfetch",
    description: "neofetch for vencord",
    tags: ["Utility", "Developers", "Fun"],
    authors: [Devs.nin0dev],
    commands: [
        {
            name: "venfetch",
            description: "neofetch for vencord",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: async (args: any[], ctx: any) => {
                const commonIssues = {
                    "NoRPC": Vencord.Plugins.isPluginEnabled("NoRPC"),
                    "disabled activities": tryOrElse(() => !ShowCurrentGame.getSetting(), false),
                    "outdated": BUILD_TIMESTAMP < Date.now() - 12096e5,
                };

                const memory = await Native?.getMemory();

                const { username } = UserStore.getCurrentUser();
                const versions = getVersions();
                const info: Record<string, string | null> = {
                    version: `${VERSION} ~ ${gitHash}${SettingsPlugin.additionalInfo} - ${Intl.DateTimeFormat(navigator.language, { dateStyle: "medium" }).format(BUILD_TIMESTAMP)}${!IS_STANDALONE ? " ~ dev" : ""}`,
                    client: `${t(window.GLOBAL_ENV.RELEASE_CHANNEL)} ~ ${clientVersion()}`,
                    "Build Number": `${versions.buildNumber} ~ Hash: ${versions.versionHash?.slice(0, 7) ?? "unknown"}`,
                    issues: Object.entries(commonIssues).filter(([_, value]) => value).map(([key]) => key).join(", ") || "",

                    _: null,

                    // @ts-ignore
                    platform: navigator.userAgentData?.platform ? `${navigator.userAgentData?.platform} (${navigator.platform})` : navigator.platform,
                    plugins: getEnabledPlugins(),
                    uptime: `${~~((Date.now() - window.GLOBAL_ENV.HTML_TIMESTAMP) / 1000)}s`,
                    memory: memory ? `${humanFileSize(memory.heapUsed)} / ${humanFileSize(memory.heapTotal)}` : "",

                    __: null,

                    donor: getDonorStatus() ? "yes" : "no",
                    contributor: getContribStatus() ? "yes" : "no",

                    ___: null,

                    // electron web context, want to get total memory usage
                };

                const computed: [string, string | null][] = Object.entries(info).filter(([key, value]) => value === null || value!.length).map(([key, value]) => [key, value]);

                let str = "";
                const MAGIC_NUMBER = 25;

                str += `${LOGO_WITH_ANSI[0]}${" ".repeat(MAGIC_NUMBER - LOGO_NO_ANSI[0].length)}[1;2m[4;2m[0m[0m[4;2m[1;2m${username}[0m[0m\n`;

                for (let i = 1; i < computed.length + 1; i++) {
                    const logoLine = LOGO_WITH_ANSI[i];
                    const line = computed[i - 1];

                    if (logoLine) {
                        str += logoLine;
                        str += " ".repeat(MAGIC_NUMBER - 3 - LOGO_NO_ANSI[i].length);
                    } else {
                        str += " ".repeat(MAGIC_NUMBER);
                    }

                    const [key, value] = line;

                    if (!key.startsWith("_") && value) {
                        str += `[2;35m${key[0].toUpperCase()}${key.slice(1)}: [0m${value}`;
                    }

                    str += "\n";
                }

                str += `${" ".repeat(MAGIC_NUMBER)}${COLOR_TEST}\n`;

                sendMessage(ctx.channel.id, {
                    content: `\`\`\`ansi\n${str}\n\`\`\``
                });
                return;
            }
        }
    ]
});

const t = (e: string) => e.length > 0 ? e[0].toUpperCase() + e.slice(1) : "";
function humanFileSize(bytes, si = false, dp = 1) {
    const thresh = si ? 1000 : 1024;

    if (Math.abs(bytes) < thresh) {
        return bytes + " B";
    }

    const units = si
        ? ["kB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"]
        : ["KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB", "YiB"];
    let u = -1;
    const r = 10 ** dp;

    do {
        bytes /= thresh;
        ++u;
    } while (Math.round(Math.abs(bytes) * r) / r >= thresh && u < units.length - 1);

    return bytes.toFixed(dp) + " " + units[u];
}
