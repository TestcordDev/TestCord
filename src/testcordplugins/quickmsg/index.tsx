/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { sleep } from "@utils/misc";
import definePlugin, { IconComponent, OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Constants, DraftStore, DraftType, RestAPI } from "@webpack/common";

const DraftManager = findByPropsLazy("clearDraft", "saveDraft");

const settings = definePluginSettings({
    deleteDelay: {
        type: OptionType.NUMBER,
        description: "Delay in milliseconds between sending and deleting the message (lower = harder to catch, but may fail if the server is slow).",
        default: 0
    },
    suppressNotifications: {
        type: OptionType.BOOLEAN,
        description: "Send the message as a silent message (no pings).",
        default: true
    }
});

const QuickMsgIcon: IconComponent = ({ height = 20, width = 20, className }) => (
    <svg
        aria-hidden="true"
        role="img"
        width={width}
        height={height}
        className={className}
        viewBox="0 0 24 24"
        fill="currentColor"
    >
        <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />
    </svg>
);

async function quickSend(channelId: string) {
    const draft = DraftStore.getDraft(channelId, DraftType.ChannelMessage);
    if (!draft || !draft.trim()) return;

    const { deleteDelay, suppressNotifications } = settings.store;

    try {
        const res = await RestAPI.post({
            url: Constants.Endpoints.MESSAGES(channelId),
            body: {
                content: draft,
                flags: suppressNotifications ? 4096 : 0,
                mobile_network_type: "unknown",
                nonce: String(Date.now()),
                tts: false
            }
        });

        try {
            DraftManager.clearDraft(channelId, DraftType.ChannelMessage);
        } catch { }

        const messageId = res?.body?.id;
        if (!messageId) return;

        if (deleteDelay > 0) {
            await sleep(deleteDelay);
        }

        await RestAPI.del({ url: Constants.Endpoints.MESSAGE(channelId, messageId) });
    } catch (err) {
        console.error("[QuickMsg] Failed to send/delete:", err);
    }
}

const QuickMsgButton: ChatBarButtonFactory = ({ isAnyChat, channel }) => {
    if (!isAnyChat) return null;

    return (
        <ChatBarButton
            tooltip="Quick Send & Delete"
            onClick={() => quickSend(channel.id)}
        >
            <QuickMsgIcon />
        </ChatBarButton>
    );
};

export default definePlugin({
    name: "QuickMsg",
    description: "Adds a chatbar button that sends the typed message and instantly deletes it",
    tags: ["Chat", "Privacy"],
    authors: [TestcordDevs.x2b],
    dependencies: ["ChatInputButtonAPI"],
    settings,

    chatBarButton: {
        icon: QuickMsgIcon,
        render: QuickMsgButton
    }
});
