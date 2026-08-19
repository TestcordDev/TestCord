/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2025 Vendicated and contributors
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
const settingsSharedProps = {
    description: "",
    type: 3 /* OptionType.BOOLEAN */,
    default: true,
    restartNeeded: true,
};
const settings = definePluginSettings({
    autoCorrect: {
        ...settingsSharedProps,
        description: "Enable auto correct",
    },
    autoComplete: {
        ...settingsSharedProps,
        description: "Enable auto complete*",
    },
    autoCapitalize: {
        ...settingsSharedProps,
        description: "Enable auto capitalize*",
    },
});
export default definePlugin({
    name: "AutoCorrect",
    description: "Configure auto text correction, completion, and capitalization",
    tags: ["Chat", "Utility"],
    settings,
    authors: [TestcordDevs.x2b],
    patches: [
        {
            find: /autocorrect:"?(off|false|none)"?/i,
            replacement: {
                match: /autocorrect:"?(off|false|none)"?/i,
                replace: "autoCorrect:'on'",
            },
            all: true,
            predicate: () => settings.store.autoCorrect,
        },
        {
            find: /autocomplete:"?(off|false|none|list)"?/i,
            replacement: {
                match: /autocomplete:"?(off|false|none|list)"?/i,
                replace: "autoComplete:'on'",
            },
            all: true,
            predicate: () => settings.store.autoComplete,
        },
        {
            find: /autocapitalize:"?(off|false|none)"?/i,
            replacement: {
                match: /autocapitalize:"?(off|false|none)"?/i,
                replace: "autoCapitalize:'on'",
            },
            all: true,
            predicate: () => settings.store.autoCapitalize,
        },
    ],
});
