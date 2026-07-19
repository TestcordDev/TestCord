/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, sendBotMessage } from "@api/Commands";
import { TestcordDevs } from "@utils/constants";
import { sendMessage } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { sleep } from "@utils/misc";
import definePlugin from "@utils/types";
import { UserSettingsProtoStore } from "@webpack/common";

const logger = new Logger("GifSpammer");

export default definePlugin({
    name: "GifSpammer",
    description: "Send all your favorite GIFs to the current channel with a 2 second delay between each.",
    tags: ["Media", "Fun"],
    authors: [TestcordDevs.nnenaza],

    commands: [
        {
            name: "gifspam",
            description: "Send all your favorite GIFs to this channel",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "delay",
                    description: "Delay between GIFs in milliseconds (default: 2000)",
                    type: ApplicationCommandOptionType.NUMBER,
                    required: false,
                },
            ],
            execute: async (args, ctx) => {
                const delayArg = args.find(arg => arg.name === "delay")?.value;
                const delay = typeof delayArg === "number" ? delayArg : 2000;

                let favs: any[] = [];
                try {
                    const gifs = UserSettingsProtoStore.frecencyWithoutFetchingLatest?.favoriteGifs?.gifs ?? {};
                    favs = Object.values(gifs).map(g => ({ url: (g as any).src, src: (g as any).src }));
                } catch (e) {
                    logger.error("Failed to get favorites", e);
                    sendBotMessage(ctx.channel.id, { content: "? Could not get your favorite GIFs." });
                    return;
                }

                if (!favs || favs.length === 0) {
                    sendBotMessage(ctx.channel.id, { content: "? You have no favorite GIFs!" });
                    return;
                }

                sendBotMessage(ctx.channel.id, { content: `?? Sending ${favs.length} GIFs with ${delay}ms delay...` });

                for (let i = 0; i < favs.length; i++) {
                    const gif = favs[i];
                    const url = gif.url ?? gif.src;
                    if (!url) continue;

                    try {
                        sendMessage(ctx.channel.id, { content: url });
                    } catch (e) {
                        logger.error(`Failed to send GIF ${i}`, e);
                    }

                    if (i < favs.length - 1) {
                        await sleep(delay);
                    }
                }

                sendBotMessage(ctx.channel.id, { content: "? All GIFs sent!" });
            },
        },
    ],
});
