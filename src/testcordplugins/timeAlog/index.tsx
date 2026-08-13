/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { HeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import { sleep } from "@utils/misc";
import definePlugin, { IconProps, OptionType } from "@utils/types";
import type { MessageJSON } from "@vencord/discord-types";
import { findByPropsLazy } from "@webpack";
import { FluxDispatcher, UserStore } from "@webpack/common";

const DEFAULT_DELAY_SECONDS = 5;
const INTERNAL_DELETE_DELAY_MS = 50;
const INTERNAL_NONCE_TTL_MS = 10_000;
const REPLACEMENT_MESSAGE = "ₓ";
const ACTIVE_ICON_COLOR = "#ed4245";

const logger = new Logger("timeAlog");

const MessageActions = findByPropsLazy("deleteMessage", "_sendMessage") as {
    deleteMessage(channelId: string, messageId: string): Promise<void> | void;
    _sendMessage(channelId: string, message: {
        content: string;
        tts: boolean;
        invalidEmojis: never[];
        validNonShortcutEmojis: never[];
    }, options: { nonce: string; }): Promise<void>;
};

interface MessageCreatePayload {
    message: MessageJSON;
    optimistic: boolean;
    type?: string;
}

const settings = definePluginSettings({
    isActive: {
        type: OptionType.BOOLEAN,
        description: "Toggle timed anti-log deletion on or off.",
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
    },
    deleteReplacementMarker: {
        type: OptionType.BOOLEAN,
        description: "Delete the replacement marker after sending it instead of leaving it in chat.",
        default: false
    }
});

function getDelayMs() {
    const delaySeconds = Number.isFinite(settings.store.delaySeconds)
        ? settings.store.delaySeconds
        : DEFAULT_DELAY_SECONDS;

    return Math.max(1, delaySeconds) * 1000;
}

function TimeAlogIcon({ height = 20, width = 20, className, color = "currentColor" }: IconProps & { color?: string; }) {
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

const TIME_ALOG_KEYS = ["isActive"] as const;

function TimeAlogButton() {
    const { isActive } = settings.use(TIME_ALOG_KEYS);

    const ButtonIcon = (props: IconProps & { color?: string; }) => (
        <TimeAlogIcon
            {...props}
            color={isActive ? ACTIVE_ICON_COLOR : props.color}
        />
    );

    return (
        <HeaderBarButton
            icon={ButtonIcon}
            tooltip={isActive ? "timeAlog: ON" : "timeAlog: OFF"}
            aria-label="Toggle timeAlog"
            selected={isActive}
            onClick={() => {
                settings.store.isActive = !settings.store.isActive;
            }}
        />
    );
}

export default definePlugin({
    name: "timeAlog",
    description: "Automatically antilog deletes your sent messages after a configurable delay.",
    tags: ["Utility", "Chat", "Privacy"],
    authors: [TestcordDevs.x2b],
    dependencies: ["HeaderBarAPI"],
    settings,

    pendingTimeouts: new Map<string, ReturnType<typeof setTimeout>>(),
    pendingReplacementDeletes: new Map<string, ReturnType<typeof setTimeout>>(),
    ignoredNonces: new Set<string>(),
    boundOnMessageCreate: null as ((event: MessageCreatePayload) => void) | null,

    queueReplacementDelete(nonce: string) {
        const existingTimeout = this.pendingReplacementDeletes.get(nonce);
        if (existingTimeout) clearTimeout(existingTimeout);

        const timeout = setTimeout(() => {
            this.pendingReplacementDeletes.delete(nonce);
        }, INTERNAL_NONCE_TTL_MS);

        this.pendingReplacementDeletes.set(nonce, timeout);
    },

    consumeReplacementDelete(nonce: string) {
        const timeout = this.pendingReplacementDeletes.get(nonce);
        if (!timeout) return false;

        clearTimeout(timeout);
        this.pendingReplacementDeletes.delete(nonce);
        return true;
    },

    async antiLogDelete(channelId: string, messageId: string) {
        this.ignoredNonces.add(messageId);

        try {
            if (settings.store.deleteReplacementMarker) {
                this.queueReplacementDelete(messageId);
            }

            await MessageActions.deleteMessage(channelId, messageId);
            await sleep(INTERNAL_DELETE_DELAY_MS);
            await MessageActions._sendMessage(channelId, {
                content: REPLACEMENT_MESSAGE,
                tts: false,
                invalidEmojis: [],
                validNonShortcutEmojis: []
            }, { nonce: messageId });
        } catch (error) {
            this.consumeReplacementDelete(messageId);
            logger.warn(`Failed to anti-log delete message ${messageId}.`, error);
        } finally {
            setTimeout(() => {
                this.ignoredNonces.delete(messageId);
            }, INTERNAL_NONCE_TTL_MS);
        }
    },

    scheduleDeletion(message: MessageCreatePayload["message"]) {
        if (this.pendingTimeouts.has(message.id)) return;

        const timeout = setTimeout(() => {
            this.pendingTimeouts.delete(message.id);
            void this.antiLogDelete(message.channel_id, message.id);
        }, getDelayMs());

        this.pendingTimeouts.set(message.id, timeout);
    },

    onMessageCreate({ message, optimistic, type }: MessageCreatePayload) {
        if (!settings.store.isActive || optimistic || type !== "MESSAGE_CREATE") return;

        if (message.nonce && this.consumeReplacementDelete(message.nonce)) {
            setTimeout(() => {
                void MessageActions.deleteMessage(message.channel_id, message.id);
            }, INTERNAL_DELETE_DELAY_MS);
            return;
        }

        if (message.nonce && this.ignoredNonces.has(message.nonce)) return;

        const currentUserId = UserStore.getCurrentUser()?.id;
        if (!currentUserId || message.author.id !== currentUserId) return;

        this.scheduleDeletion(message);
    },

    headerBarButton: {
        icon: TimeAlogIcon,
        render: TimeAlogButton,
        priority: 1336
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
        this.pendingReplacementDeletes.forEach(timeout => clearTimeout(timeout));
        this.pendingReplacementDeletes.clear();
        this.ignoredNonces.clear();
    }
});
