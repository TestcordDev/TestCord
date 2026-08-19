/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
const Native = VencordNative.pluginHelpers.Socket;
const settings = definePluginSettings({
    port: {
        type: 1 /* OptionType.NUMBER */,
        description: "self explanatory",
        default: 3009
    },
    host: {
        type: 0 /* OptionType.STRING */,
        description: "IP that the plugin will listen on (0.0.0.0 for all interfaces)",
        default: "127.0.0.1"
    },
    password: {
        type: 0 /* OptionType.STRING */,
        description: "Password clients must send as their first line before messaging. If left empty, a random one is generated at startup and shown in a notification."
    },
    allowUnauthedLocalConnections: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Allow connections coming from localhost to be unauthenticated",
        default: false
    }
});
export default definePlugin({
    name: "Socket",
    description: "Send messages to a channel through a TCP socket",
    tags: ["Utility", "Developers"],
    authors: [Devs.nin0dev],
    settings,
    start: () => Native.startServer(),
    stop: () => Native.stopServer()
});
