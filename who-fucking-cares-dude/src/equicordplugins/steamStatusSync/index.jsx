/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import { EquicordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
var SteamStatus;
(function (SteamStatus) {
    SteamStatus["Online"] = "online";
    SteamStatus["Away"] = "away";
    SteamStatus["Invisible"] = "invisible";
    SteamStatus["Offline"] = "offline";
    SteamStatus["None"] = "none";
})(SteamStatus || (SteamStatus = {}));
export const settings = definePluginSettings({
    onlineStatus: {
        type: 4 /* OptionType.SELECT */,
        description: "Steam status when on Online",
        options: [
            { label: "Online", value: SteamStatus.Online, default: true },
            { label: "Away", value: SteamStatus.Away },
            { label: "Invisible", value: SteamStatus.Invisible },
            { label: "Offline (Disconnect Steam Chat)", value: SteamStatus.Offline },
            { label: "Disabled", value: SteamStatus.None }
        ],
    },
    idleStatus: {
        type: 4 /* OptionType.SELECT */,
        description: "Steam status when on Idle",
        options: [
            { label: "Online", value: SteamStatus.Online },
            { label: "Away", value: SteamStatus.Away, default: true },
            { label: "Invisible", value: SteamStatus.Invisible },
            { label: "Offline (Disconnect Steam Chat)", value: SteamStatus.Offline },
            { label: "Disabled", value: SteamStatus.None }
        ],
    },
    dndStatus: {
        type: 4 /* OptionType.SELECT */,
        description: "Steam status when on Do Not Disturb",
        options: [
            { label: "Online", value: SteamStatus.Online },
            { label: "Away", value: SteamStatus.Away },
            { label: "Invisible", value: SteamStatus.Invisible },
            { label: "Offline (Disconnect Steam Chat)", value: SteamStatus.Offline },
            { label: "Disabled", value: SteamStatus.None, default: true }
        ],
    },
    invisibleStatus: {
        type: 4 /* OptionType.SELECT */,
        description: "Steam status when on Invisible",
        options: [
            { label: "Online", value: SteamStatus.Online },
            { label: "Away", value: SteamStatus.Away },
            { label: "Invisible", value: SteamStatus.Invisible, default: true },
            { label: "Offline (Disconnect Steam Chat)", value: SteamStatus.Offline },
            { label: "Disabled", value: SteamStatus.None }
        ],
    },
    goInvisibleIfActivityIsHidden: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Always go invisible if hiding game activity on Discord"
    }
});
export default definePlugin({
    name: "SteamStatusSync",
    description: "Sync your status to Steam! (Online, Away, Invisible, or Offline.)",
    tags: ["Activity", "Appearance", "Customisation"],
    authors: [EquicordDevs.niko],
    settings,
    flux: {
        USER_SETTINGS_PROTO_UPDATE(settingsUpdate) {
            const protoStatus = settingsUpdate.settings.proto.status;
            if (protoStatus !== undefined) {
                const steamStatus = settings.store[`${protoStatus.status.value}Status`];
                if (settings.store.goInvisibleIfActivityIsHidden && !protoStatus.showCurrentGame.value) {
                    open(`steam://friends/status/${SteamStatus.Invisible}`);
                    return;
                }
                if (steamStatus === SteamStatus.None) {
                    return;
                }
                // Open steam protocol URI for status change
                open(`steam://friends/status/${steamStatus}`);
            }
        }
    }
});
