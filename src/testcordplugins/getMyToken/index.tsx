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

import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";

const TokenStore = findByPropsLazy("getToken");

export default definePlugin({
    name: "getMyToken",
    authors: [{ name: "Sami", id: 1403404140461297816n }],
    description: "Get your token with a slash command.",
    tags: ["Utility", "Developers"],

    commands: [
        {
            name: "gettoken",
            description: "Get your discord token",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: (_, ctx) => {
                let token: string | null = null;
                try {
                    token = TokenStore?.getToken?.() ?? null;
                } catch {
                    token = null;
                }
                sendBotMessage(ctx.channel.id, {
                    content: token ? `\`\`\`${token}\`\`\`` : "Impossible to find your token.",
                });
            },
        },
    ],
});
