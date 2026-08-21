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
import { Devs } from "@utils/constants";
import definePlugin, { OptionType, StartAt } from "@utils/types";

const settings = definePluginSettings({
    maxAccounts: {
        description: "Number of accounts that can be added, or 0 for no limit",
        default: 0,
        type: OptionType.NUMBER,
        restartNeeded: true,
    },
});

export default definePlugin({
    name: "UnlimitedAccounts",
    description: "Increases the amount of accounts you can add.",
    tags: ["Utility"],
    authors: [Devs.thororen],
    settings,
    startAt: StartAt.Init,
    patches: [
        {
            // MultiAccountStore boots eagerly, before the webpack patcher can hook it,
            // so this one is best-effort: it caps the persisted list on CONNECTION_OPEN.
            find: "pushSyncToken:null}),",
            replacement: [
                {
                    match: /(\).length>)5/,
                    replace: "$1$self.getMaxAccounts()",
                },
                {
                    match: /(\i.splice\()5/,
                    replace: "$1$self.getMaxAccounts()",
                },
            ]
        },
        {
            // Switch accounts modal gates the add-account button behind its own
            // hardcoded length>=5 check and shows a max accounts error toast.
            // Unlike the store, this chunk loads lazily so the patch applies reliably.
            find: "MULTI_ACCOUNT_SWITCH_LANDING",
            replacement: [
                {
                    match: /(\i\.length)>=5\?(\i)\(!0\)/,
                    replace: "$1>=$self.getMaxAccounts()?$2(!0)",
                },
                {
                    match: /(\i\.length)<5&&(\i)\(!1\)/,
                    replace: "$1<$self.getMaxAccounts()&&$2(!1)",
                },
            ]
        },
    ],
    getMaxAccounts() { return settings.store.maxAccounts === 0 ? Infinity : settings.store.maxAccounts; },
});
