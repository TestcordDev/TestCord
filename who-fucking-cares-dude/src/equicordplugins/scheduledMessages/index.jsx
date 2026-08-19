/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import "./styles.css";
import { definePluginSettings } from "@api/Settings";
import { Devs, EquicordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { isScheduleModeEnabled, ScheduledMessagesButton, setScheduleModeEnabled } from "./components/ChatBarButton";
import { CalendarIcon } from "./components/Icons";
import { MessageAccessory } from "./components/MessageAccessory";
import { openScheduleTimeModal } from "./components/ScheduleTimeModal";
import { openViewScheduledModal } from "./components/ViewScheduledModal";
import { cleanupAllPhantomMessages, handleReactionAdd, handleReactionRemove, isPhantomMessage, loadScheduledMessages, recreatePhantomMessages, resyncPhantomReactions, startScheduler, stopScheduler } from "./utils";
export const settings = definePluginSettings({
    maxMessagesPerMinute: {
        type: 5 /* OptionType.SLIDER */,
        description: "Max scheduled messages per channel that can fire in the same minute.",
        markers: [1, 2, 3, 4, 5],
        default: 3,
        stickToMarkers: true
    },
    checkIntervalSeconds: {
        type: 5 /* OptionType.SLIDER */,
        description: "How often to check for messages to send (seconds).",
        markers: [5, 10, 15, 30, 60],
        default: 10,
        stickToMarkers: true,
        onChange: () => {
            stopScheduler();
            startScheduler();
        }
    },
    showNotifications: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show toast notifications when messages are sent.",
        default: true
    },
    showPhantomMessages: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show scheduled messages as phantom messages in chat.",
        default: true
    }
});
function handleReactionEvent(event) {
    const { messageId, channelId, emoji } = event;
    if (!messageId || !channelId || !emoji)
        return;
    const isPhantom = isPhantomMessage(messageId);
    if (!isPhantom)
        return;
    if (event.optimistic) {
        // User-initiated reaction change - update our data
        if (event.type === "MESSAGE_REACTION_ADD") {
            handleReactionAdd(messageId, channelId, emoji);
        }
        else if (event.type === "MESSAGE_REACTION_REMOVE") {
            handleReactionRemove(messageId, channelId, emoji);
        }
    }
    else {
        setTimeout(() => {
            resyncPhantomReactions(messageId, channelId);
        }, 50);
    }
}
export default definePlugin({
    name: "ScheduledMessages",
    description: "Schedule messages to be sent at a specific time or after a delay.",
    tags: ["Chat", "Utility"],
    dependencies: ["ChatInputButtonAPI", "MessageAccessoriesAPI", "MessageEventsAPI"],
    authors: [EquicordDevs.mmeta, Devs.prism],
    settings,
    flux: {
        MESSAGE_REACTION_ADD: handleReactionEvent,
        MESSAGE_REACTION_REMOVE: handleReactionEvent
    },
    chatBarButton: {
        icon: CalendarIcon,
        render: ScheduledMessagesButton
    },
    toolboxActions: {
        "View Scheduled Messages": openViewScheduledModal
    },
    patches: [
        {
            find: "}addReaction(",
            replacement: {
                match: /this\.channel_id=(\i)\.channel_id,/,
                replace: "$&this.scheduledMessageData=$1.scheduledMessageData,"
            }
        }
    ],
    renderMessageAccessory(props) {
        return <MessageAccessory message={props.message}/>;
    },
    async onBeforeMessageSend(channelId, messageObj, options) {
        if (!isScheduleModeEnabled)
            return;
        if (!messageObj.content.trim() && !options.uploads?.length)
            return;
        setScheduleModeEnabled(false);
        let attachments;
        if (options.uploads?.length) {
            attachments = [];
            for (const upload of options.uploads) {
                const { file } = upload.item;
                try {
                    const base64 = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => {
                            const result = reader.result;
                            resolve(result.split(",")[1] ?? result);
                        };
                        reader.onerror = () => reject(reader.error);
                        reader.readAsDataURL(file);
                    });
                    attachments.push({
                        filename: upload.filename,
                        data: base64,
                        type: file.type
                    });
                }
                catch {
                    continue;
                }
            }
        }
        openScheduleTimeModal(channelId, messageObj.content, attachments);
        return { cancel: true };
    },
    async start() {
        await loadScheduledMessages();
        startScheduler();
        recreatePhantomMessages();
    },
    stop() {
        stopScheduler();
        cleanupAllPhantomMessages();
    }
});
