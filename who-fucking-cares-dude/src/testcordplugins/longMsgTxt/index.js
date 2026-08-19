/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { ChannelStore, ComponentDispatch, DraftType, UploadHandler, UserStore } from "@webpack/common";
const settings = definePluginSettings({
    fileName: {
        type: 0 /* OptionType.STRING */,
        description: "Base name for the generated text file (without extension).",
        default: "message"
    },
    bypassLengthLimit: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Allow typing past the character limit so long messages can be converted on send.",
        default: true,
        restartNeeded: true
    },
    overrideDiscordConversion: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Disable Discord's built-in long message to file conversion so this plugin handles it instead.",
        default: true,
        restartNeeded: true
    }
});
function getMaxLength() {
    return UserStore.getCurrentUser()?.premiumType === 2 ? 4000 : 2000;
}
function buildFileName() {
    const raw = settings.store.fileName.trim() || "message";
    const safe = raw.replace(/[\\/:*?"<>|]+/g, "_");
    return `${safe}.txt`;
}
const listener = async (channelId, msg) => {
    const { content } = msg;
    if (!content || content.length <= getMaxLength())
        return;
    const channel = ChannelStore.getChannel(channelId);
    if (!channel)
        return;
    const file = new File([content], buildFileName(), { type: "text/plain;charset=utf-8" });
    msg.content = "";
    ComponentDispatch.dispatchToLastSubscribed("CLEAR_TEXT");
    setTimeout(() => UploadHandler.promptToUpload([file], channel, DraftType.ChannelMessage), 10);
    return { cancel: true };
};
export default definePlugin({
    name: "LongMsgTxt",
    description: "Converts messages over the character limit (2000, or 4000 with Nitro) into a .txt file attachment. doesnt work with splitlargemessages.",
    tags: ["Chat", "Utility"],
    authors: [TestcordDevs.x2b],
    dependencies: ["MessageEventsAPI"],
    settings,
    onBeforeMessageSend: listener,
    patches: [
        {
            find: 'type:"MESSAGE_LENGTH_UPSELL"',
            predicate: () => settings.store.bypassLengthLimit,
            replacement: {
                match: /if\(\i\.length>\i/,
                replace: "if(false"
            }
        },
        {
            find: ".onHideAutocomplete?",
            predicate: () => settings.store.overrideDiscordConversion,
            replacement: {
                match: /(?<=getData\(\i\.type\);)if\(\i\.length>\i\)/,
                replace: "if(false)"
            }
        }
    ]
});
