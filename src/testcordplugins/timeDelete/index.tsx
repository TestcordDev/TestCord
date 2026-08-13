/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { HeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { IconProps, OptionType } from "@utils/types";
import type { MessageJSON } from "@vencord/discord-types";
import { findByPropsLazy } from "@webpack";
import { FluxDispatcher, UserStore } from "@webpack/common";

const DEFAULT_DELAY_SECONDS = 5;
const ACTIVE_ICON_COLOR = "#ed4245";

const logger = new Logger("timeDelete");

const MessageActions = findByPropsLazy("deleteMessage") as {
    deleteMessage(channelId: string, messageId: string): Promise<void> | void;
};

interface MessageCreatePayload {
    message: MessageJSON;
    optimistic: boolean;
    type?: string;
}

const settings = definePluginSettings({
    isActive: {
        type: OptionType.BOOLEAN,
        description: "Toggle timed deletion on or off.",
        default: false,
        hidden: true
    },
    delaySeconds: {
        type: OptionType.NUMBER,
        description: "Delay before deleting your sent messages in seconds.",
        default: DEFAULT_DELAY_SECONDS,
        isValid: value => {
            const delaySeconds = Number(value);
            return Number.isFinite(delaySeconds) && delaySeconds >= 1 && delaySeconds <= 3600;
        }
    }
});

function getDelayMs() {
    const delaySeconds = Number.isFinite(settings.store.delaySeconds)
        ? settings.store.delaySeconds
        : DEFAULT_DELAY_SECONDS;

    return Math.max(1, delaySeconds) * 1000;
}

function TimeDeleteIcon({ height = 20, width = 20, className, color = "currentColor" }: IconProps & { color?: string; }) {
    return (
        <svg viewBox="0 0 24 24" width={width} height={height} className={className} aria-hidden="true">
            <path
                fill={color}
                d="M12 1.75A10.25 10.25 0 1 0 22.25 12 10.26 10.26 0 0 0 12 1.75Zm0 18.5A8.25 8.25 0 1 1 20.25 12 8.26 8.26 0 0 1 12 20.25Z"
            />
            <path
                fill={color}
                d="M12 6.25a1 1 0 0 0-1 1v4.34l-2.62 1.57a1 1 0 1 0 1.02 1.72l3.1-1.86a1 1 0 0 0 .5-.86V7.25a1 1 0 0 0-1-1Z"
            />
        </svg>
    );
}

const TIME_DELETE_KEYS = ["isActive"] as const;

function TimeDeleteButton() {
    const { isActive } = settings.use(TIME_DELETE_KEYS);

    const ButtonIcon = (props: IconProps & { color?: string; }) => (
        <TimeDeleteIcon
            {...props}
            color={isActive ? ACTIVE_ICON_COLOR : props.color}
        />
    );

    return (
        <HeaderBarButton
            icon={ButtonIcon}
            tooltip={isActive ? "timeDelete: ON" : "timeDelete: OFF"}
            aria-label="Toggle timeDelete"
            selected={isActive}
            onClick={() => {
                settings.store.isActive = !settings.store.isActive;
            }}
        />
    );
}

export default definePlugin({
    name: "timeDelete",
    description: "Automatically deletes your sent messages after a configurable delay.",
    tags: ["Utility", "Chat", "Privacy"],
    authors: [TestcordDevs.x2b],
    dependencies: ["HeaderBarAPI"],
    settings,

    pendingTimeouts: new Map<string, ReturnType<typeof setTimeout>>(),
    boundOnMessageCreate: null as ((event: MessageCreatePayload) => void) | null,

    async deleteMessage(channelId: string, messageId: string) {
        try {
            await MessageActions.deleteMessage(channelId, messageId);
        } catch (error) {
            logger.warn(`Failed to delete message ${messageId}.`, error);
        }
    },

    scheduleDeletion(message: MessageCreatePayload["message"]) {
        if (this.pendingTimeouts.has(message.id)) return;

        const timeout = setTimeout(() => {
            this.pendingTimeouts.delete(message.id);
            void this.deleteMessage(message.channel_id, message.id);
        }, getDelayMs());

        this.pendingTimeouts.set(message.id, timeout);
    },

    onMessageCreate({ message, optimistic, type }: MessageCreatePayload) {
        if (!settings.store.isActive || optimistic || type !== "MESSAGE_CREATE") return;

        const currentUserId = UserStore.getCurrentUser()?.id;
        if (!currentUserId || message.author.id !== currentUserId) return;

        this.scheduleDeletion(message);
    },

    headerBarButton: {
        icon: TimeDeleteIcon,
        render: TimeDeleteButton,
        priority: 1335
    },

    start() {
        this.boundOnMessageCreate = this.onMessageCreate.bind(this);
        FluxDispatcher.subscribe("MESSAGE_CREATE", this.boundOnMessageCreate);
    },

    stop() {
        if (this.boundOnMessageCreate) {
            FluxDispatcher.unsubscribe("MESSAGE_CREATE", this.boundOnMessageCreate);
            this.boundOnMessageCreate = null;
        }

        this.pendingTimeouts.forEach(timeout => clearTimeout(timeout));
        this.pendingTimeouts.clear();
    }
});
