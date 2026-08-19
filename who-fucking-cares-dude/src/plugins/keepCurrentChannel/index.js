/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/
import * as DataStore from "@api/DataStore";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { ChannelRouter, ChannelStore, NavigationRouter, SelectedChannelStore, SelectedGuildStore } from "@webpack/common";
let isSwitchingAccount = false;
let previousCache;
export default definePlugin({
    name: "KeepCurrentChannel",
    description: "Attempt to navigate to the channel you were in before switching accounts or loading Discord.",
    tags: ["Utility", "Organisation"],
    authors: [Devs.Nuckyz],
    patches: [
        {
            find: '"Switching accounts"',
            replacement: {
                match: /goHomeAfterSwitching:\i/,
                replace: "goHomeAfterSwitching:!1"
            }
        }
    ],
    flux: {
        LOGOUT(e) {
            ({ isSwitchingAccount } = e);
        },
        CONNECTION_OPEN() {
            if (!isSwitchingAccount)
                return;
            isSwitchingAccount = false;
            if (previousCache?.channelId) {
                if (ChannelStore.hasChannel(previousCache.channelId)) {
                    ChannelRouter.transitionToChannel(previousCache.channelId);
                }
                else {
                    NavigationRouter.transitionToGuild("@me");
                }
            }
        },
        async CHANNEL_SELECT({ guildId, channelId }) {
            if (isSwitchingAccount)
                return;
            previousCache = {
                guildId,
                channelId
            };
            await DataStore.set("KeepCurrentChannel_previousData", previousCache);
        }
    },
    async start() {
        previousCache = await DataStore.get("KeepCurrentChannel_previousData");
        if (!previousCache) {
            previousCache = {
                guildId: SelectedGuildStore.getGuildId(),
                channelId: SelectedChannelStore.getChannelId() ?? null
            };
            await DataStore.set("KeepCurrentChannel_previousData", previousCache);
        }
        else if (previousCache.channelId) {
            ChannelRouter.transitionToChannel(previousCache.channelId);
        }
    }
});
