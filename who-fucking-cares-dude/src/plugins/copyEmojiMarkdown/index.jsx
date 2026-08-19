/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { copyWithToast } from "@utils/discord";
import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Menu } from "@webpack/common";
const { convertNameToSurrogate } = findByPropsLazy("convertNameToSurrogate");
function getEmojiMarkdown(target, copyUnicode) {
    const { id: emojiId, name: emojiName } = target.dataset;
    if (!emojiId) {
        return copyUnicode
            ? convertNameToSurrogate(emojiName)
            : `:${emojiName}:`;
    }
    const url = new URL(target.firstChild.src);
    const hasParam = url.searchParams.get("animated") === "true";
    const isGif = url.pathname.endsWith(".gif");
    return `<${(hasParam || isGif) ? "a" : ""}:${emojiName.replace(/~\d+$/, "")}:${emojiId}>`;
}
const settings = definePluginSettings({
    copyUnicode: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Copy the raw unicode character instead of :name: for default emojis (👽)",
        default: true,
    },
});
export default definePlugin({
    name: "CopyEmojiMarkdown",
    description: "Allows you to copy emojis as formatted string (<:blobcatcozy:1026533070955872337>)",
    tags: ["Emotes", "Utility"],
    authors: [Devs.HappyEnderman, Devs.Vishnya],
    settings,
    contextMenus: {
        "expression-picker"(children, { target }) {
            if (target.dataset.type !== "emoji")
                return;
            children.push(<Menu.MenuItem id="vc-copy-emoji-markdown" label="Copy Emoji Markdown" action={() => {
                    copyWithToast(getEmojiMarkdown(target, settings.store.copyUnicode), "Success! Copied emoji markdown.");
                }}/>);
        },
    },
});
