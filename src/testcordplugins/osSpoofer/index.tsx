/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { sendBotMessage } from "@api/Commands/commandHelpers";
import { definePluginSettings } from "@api/Settings";
import { Notice } from "@components/Notice";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { findByProps } from "@webpack";

const settings = definePluginSettings({
    os: {
        type: OptionType.SELECT,
        description: "Operating system to spoof",
        restartNeeded: true,
        options: [
            { label: "Linux", value: "linux", default: true },
            { label: "Windows", value: "windows" },
            { label: "macOS", value: "macos" }
        ]
    }
});

export default definePlugin({
    name: "OSSpoofer",
    description: "Maximum possible OS spoofing at plugin level",
    tags: ["Privacy", "Utility"],
    authors: [TestcordDevs.x2b],
    settings,
    settingsAboutComponent: () => (
        <Notice.Warning>
            This modifies IDENTIFY and client metadata. Risk is non-zero.
        </Notice.Warning>
    ),

    patches: [
        {
            find: "_doIdentify(){",
            replacement: {
                match: /(\[IDENTIFY\].*?let.{0,5}=\{)/,
                replace: "$1...$self.getIdentifyOverrides(),"
            }
        }
    ],

    getIdentifyOverrides() {
        const os = settings.store.os ?? "linux";

        const base = {
            browser: "Chrome",
            device: "",
            system_locale: "en-US",
            referrer: "",
            referring_domain: "",
            release_channel: "stable",
            client_version: "1.0.9000",
            client_build_number: 999999
        };

        switch (os) {
            case "windows":
                return {
                    properties: {
                        os: "Windows",
                        browser: "Chrome",
                        device: "",
                        system_locale: "en-US"
                    },
                    os_version: "10.0.22631",
                    browser_user_agent:
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    browser_version: "120.0.0.0",
                    ...base
                };

            case "macos":
                return {
                    properties: {
                        os: "Mac OS X",
                        browser: "Chrome",
                        device: "",
                        system_locale: "en-US"
                    },
                    os_version: "13.6.1",
                    browser_user_agent:
                        "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    browser_version: "120.0.0.0",
                    ...base
                };

            case "linux":
            default:
                return {
                    properties: {
                        os: "Linux",
                        browser: "Chrome",
                        device: "",
                        system_locale: "en-US"
                    },
                    os_version: "6.6.0",
                    browser_user_agent:
                        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    browser_version: "120.0.0.0",
                    ...base
                };
        }
    },

    commands: [
        {
            name: "verify-os",
            description: "Verify the spoofed OS by triggering a reconnect and displaying the current spoofed OS.",
            execute: (args, ctx) => {
                const os = settings.store.os ?? "linux";
                const osName = os === "linux" ? "Linux" : os === "windows" ? "Windows" : "macOS";
                sendBotMessage(ctx.channel.id, {
                    content: `Current spoofed OS: ${osName}. Triggering reconnect to send IDENTIFY payload.`,
                    author: {
                        username: "OSSpoofer"
                    }
                });
                // Trigger reconnect
                const gateway = findByProps("connect", "destroy");
                if (gateway) {
                    gateway.destroy();
                    setTimeout(() => gateway.connect(), 1000);
                }
            }
        }
    ]
});
