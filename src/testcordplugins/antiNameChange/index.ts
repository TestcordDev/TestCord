/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 nin0
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { openUserProfile } from "@utils/discord";
import definePlugin, { OptionType } from "@utils/types";
import { Toasts } from "@webpack/common";

const settings = definePluginSettings({
    ids: {
        description: "User IDs of the friend (comma separated)",
        type: OptionType.STRING
    },
    alias: {
        description: "alias to ping them (@alias)",
        type: OptionType.STRING
    },
    lSeenUserID: {
        type: OptionType.STRING,
        hidden: true,
        description: "vencord is abandonware"
    }
});

function handler(c, msg) {
    if (!settings.store.alias || !settings.store.lSeenUserID) {
        Toasts.show({
            type: Toasts.Type.FAILURE,
            message: "User hasn't been last seen",
            id: Toasts.genId(),
        });
        return {
            cancel: true
        };
    }

    msg.content = msg.content.replaceAll(`@${settings.store.alias}`, `<@${settings.store.lSeenUserID}>`);
}

let cachedIds: string[] = [];
let cachedIdsRaw: string | undefined;
function getTrackedIds(): string[] {
    const raw = settings.store.ids || "";
    if (raw === cachedIdsRaw) return cachedIds;
    cachedIdsRaw = raw;
    cachedIds = raw.split(",").map(t => t.trim());
    return cachedIds;
}

export default definePlugin({
    name: "AntiNameChange",
    description: "for that one friend who keeps changing their username/account",
    tags: ["Privacy", "Utility"],
    authors: [Devs.nin0dev],
    settings,
    onBeforeMessageSend: handler,
    onBeforeMessageEdit: handler,
    flux: {
        MESSAGE_CREATE(ev) {
            if (getTrackedIds().includes(ev.message.author.id)) settings.store.lSeenUserID = ev.message.author.id;
        }
    },
    commands: [
        {
            name: "profile",
            description: "Open the profile of your friend who keeps changing accounts",
            execute() {
                if (!settings.store.lSeenUserID) return Toasts.show({
                    type: Toasts.Type.FAILURE,
                    message: "User hasn't been last seen",
                    id: Toasts.genId(),
                });
                openUserProfile(settings.store.lSeenUserID);
            }
        }
    ]
});
