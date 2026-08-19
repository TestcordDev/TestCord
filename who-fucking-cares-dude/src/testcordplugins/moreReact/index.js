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
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
const settings = definePluginSettings({
    Max: {
        description: "Max reactions",
        type: 1 /* OptionType.NUMBER */,
        default: 5,
    },
});
export default definePlugin({
    name: "MoreReact",
    description: "This plugin allows you to modify the max number of reactions for the frencency reaction experiment",
    tags: ["Reactions", "Utility"],
    authors: [TestcordDevs.x2b],
    patches: [
        {
            find: ".MESSAGE_HOVER_BAR_REACTION_SUGGESTION_ADD_ALLY",
            replacement: {
                match: /(\.length>=3?.{0,40}\.slice\(0),3\)/,
                replace: "$1,$self.settings.store.Max)"
            }
        }
    ],
    settings,
});
