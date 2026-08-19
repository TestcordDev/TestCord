/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import { Devs, IS_MAC } from "@utils/constants";
import definePlugin from "@utils/types";
import { FluxDispatcher } from "@webpack/common";
function setActivity(activity) {
    FluxDispatcher.dispatch({
        type: "LOCAL_ACTIVITY_UPDATE",
        activity,
        socketId: "AppleMusic",
    });
}
let originalUpdatePresence;
export default definePlugin({
    name: "AMRPCStatusDisplayType",
    tags: ["Activity", "Customisation"],
    description: "Make MusicRPC show the track / artist name in the member list",
    authors: [Devs.nin0dev],
    hidden: !IS_MAC,
    startAt: "DOMContentLoaded" /* StartAt.DOMContentLoaded */,
    settings: definePluginSettings({
        statusDisplayType: {
            description: "Show the track / artist name in the member list",
            type: 4 /* OptionType.SELECT */,
            options: [
                {
                    label: "Don't show (shows generic listening message)",
                    value: "off",
                    default: true
                },
                {
                    label: "Show artist name",
                    value: "artist"
                },
                {
                    label: "Show track name",
                    value: "track"
                }
            ]
        },
    }),
    start() {
        // @ts-expect-error
        originalUpdatePresence = Vencord.Plugins.plugins.AppleMusicRichPresence.updatePresence;
        // @ts-expect-error
        Vencord.Plugins.plugins.AppleMusicRichPresence.updatePresence = () => {
            // @ts-expect-error
            Vencord.Plugins.plugins.AppleMusicRichPresence.getActivity().then(activity => {
                setActivity({
                    ...activity,
                    status_display_type: {
                        "off": 0,
                        "artist": 1,
                        "track": 2
                    }[this.settings.store.statusDisplayType]
                });
            });
        };
        // @ts-expect-error
        Vencord.Plugins.plugins.AppleMusicRichPresence.updatePresence();
    },
    stop() {
        // @ts-expect-error
        Vencord.Plugins.plugins.AppleMusicRichPresence.updatePresence = originalUpdatePresence;
    }
});
