/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import "./styles.css";
import { findGroupChildrenByChildId } from "@api/ContextMenu";
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { ChannelStore, Menu } from "@webpack/common";
import { settings } from "./settings";
import { setShouldShowTranslateEnabledTooltip, TranslateChatBarIcon, TranslateIcon } from "./TranslateIcon";
import { handleTranslate, TranslationAccessory } from "./TranslationAccessory";
import { translate } from "./utils";
function normalizeText(text) {
    return text
        .toLowerCase()
        .replace(/[.,]/g, "");
}
function getMessageContent(message) {
    return message.content
        || message.messageSnapshots?.[0]?.message.content
        || message.embeds?.find(embed => embed.type === "auto_moderation_message")?.rawDescription || "";
}
const messageCtxPatch = (children, { message }) => {
    const content = getMessageContent(message);
    if (!content)
        return;
    const group = findGroupChildrenByChildId("copy-text", children);
    if (!group)
        return;
    group.splice(group.findIndex(c => c?.props?.id === "copy-text") + 1, 0, (<Menu.MenuItem id="vc-native-trans" label="NativeTranslate" icon={TranslateIcon} action={async () => {
            const trans = await translate("received", content);
            trans.text = normalizeText(trans.text);
            handleTranslate(message.id, trans);
        }}/>));
};
let tooltipTimeout;
export default definePlugin({
    name: "NativeTranslate",
    description: "translate plugin for those who wanna seem like real native lang speakers (removes capital letters commas and dots from translated content to seem more natural)",
    tags: ["Chat", "Utility"],
    dependencies: ["ChatInputButtonAPI", "MessageAccessoriesAPI", "MessagePopoverAPI"],
    authors: [TestcordDevs.x2b],
    settings,
    contextMenus: {
        "message": messageCtxPatch
    },
    translate,
    renderMessageAccessory: props => <TranslationAccessory message={props.message}/>,
    chatBarButton: {
        icon: TranslateIcon,
        render: TranslateChatBarIcon
    },
    messagePopoverButton: {
        icon: TranslateIcon,
        render(message) {
            const content = getMessageContent(message);
            if (!content)
                return null;
            return {
                label: "NativeTranslate",
                icon: TranslateIcon,
                message,
                channel: ChannelStore.getChannel(message.channel_id),
                onClick: async () => {
                    const trans = await translate("received", content);
                    trans.text = normalizeText(trans.text);
                    handleTranslate(message.id, trans);
                }
            };
        }
    },
    async onBeforeMessageSend(_, message) {
        if (!settings.store.autoTranslate)
            return;
        if (!message.content)
            return;
        setShouldShowTranslateEnabledTooltip?.(true);
        clearTimeout(tooltipTimeout);
        tooltipTimeout = setTimeout(() => setShouldShowTranslateEnabledTooltip?.(false), 2000);
        const trans = await translate("sent", message.content);
        message.content = normalizeText(trans.text);
    }
});
