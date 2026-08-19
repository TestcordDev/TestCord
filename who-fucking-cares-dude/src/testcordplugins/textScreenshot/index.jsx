/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { findOption, sendBotMessage } from "@api/Commands";
import { TestcordDevs } from "@utils/constants";
import { getCurrentChannel } from "@utils/discord";
import definePlugin from "@utils/types";
import { DraftType, UploadHandler, UserStore } from "@webpack/common";
import { createTextScreenshot } from "./utils";
export default definePlugin({
    name: "TextScreenshot",
    description: "Send text as a screenshot of a Discord message with your profile",
    tags: ["Commands", "Fun"],
    authors: [TestcordDevs.x2b],
    dependencies: ["CommandsAPI"],
    commands: [
        {
            name: "txtss",
            description: "Send text as a fake Discord message screenshot",
            inputType: 0 /* ApplicationCommandInputType.BUILT_IN */,
            options: [
                {
                    name: "text",
                    description: "The text to screenshot",
                    type: 3 /* ApplicationCommandOptionType.STRING */,
                    required: true,
                }
            ],
            execute: async (opts, ctx) => {
                const text = findOption(opts, "text", "");
                if (!text) {
                    sendBotMessage(ctx.channel.id, { content: "Please provide some text." });
                    return;
                }
                try {
                    const user = UserStore.getCurrentUser();
                    const blob = await createTextScreenshot(text, user);
                    const file = new File([blob], "text-screenshot.png", { type: "image/png" });
                    const channel = getCurrentChannel();
                    if (!channel)
                        return sendBotMessage(ctx.channel.id, { content: "No channel found." });
                    setTimeout(() => UploadHandler.promptToUpload([file], channel, DraftType.ChannelMessage), 10);
                }
                catch (e) {
                    sendBotMessage(ctx.channel.id, { content: `Failed to create screenshot: ${e}` });
                }
            },
        },
        {
            name: "texttoscreen",
            description: "Send text as a fake Discord message screenshot",
            inputType: 0 /* ApplicationCommandInputType.BUILT_IN */,
            options: [
                {
                    name: "text",
                    description: "The text to screenshot",
                    type: 3 /* ApplicationCommandOptionType.STRING */,
                    required: true,
                }
            ],
            execute: async (opts, ctx) => {
                const text = findOption(opts, "text", "");
                if (!text) {
                    sendBotMessage(ctx.channel.id, { content: "Please provide some text." });
                    return;
                }
                try {
                    const user = UserStore.getCurrentUser();
                    const blob = await createTextScreenshot(text, user);
                    const file = new File([blob], "text-screenshot.png", { type: "image/png" });
                    const channel = getCurrentChannel();
                    if (!channel)
                        return sendBotMessage(ctx.channel.id, { content: "No channel found." });
                    setTimeout(() => UploadHandler.promptToUpload([file], channel, DraftType.ChannelMessage), 10);
                }
                catch (e) {
                    sendBotMessage(ctx.channel.id, { content: `Failed to create screenshot: ${e}` });
                }
            },
        },
    ],
});
