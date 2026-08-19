/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
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
export const settings = definePluginSettings({
    gifLink1: {
        type: 0 /* OptionType.STRING */,
        description: "Link for silly gif 1 :3 :3 (moving)",
        default: "https://media.tenor.com/El89itaAWsIAAAAi/maxwell.gif",
    },
    gifLink2: {
        type: 0 /* OptionType.STRING */,
        description: "Link for silly gif 2 :3 :3 (stationary)",
        default: "https://media.tenor.com/qJRMLPlR3_8AAAAj/maxwell-cat.gif",
    },
    gifSize: {
        type: 1 /* OptionType.NUMBER */,
        description: "Size of silliness ;3",
        default: 150,
    },
    concurrentMaxwells: {
        type: 1 /* OptionType.NUMBER */,
        description: "MaxwellMaxxing (warning this can get too silly)",
        default: 1,
    }
});
