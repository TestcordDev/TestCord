/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addChatBarButton, ChatBarButton, ChatBarButtonFactory, removeChatBarButton } from "@api/ChatButtons";
import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { IconComponent, OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { ChannelStore, Menu, React } from "@webpack/common";

const CHANNEL_TYPE_DM = 1;
const CHANNEL_TYPE_GROUP_DM = 3;

const logger = new Logger("SilentCall");
const CallActions: any = findByPropsLazy("ring", "stopRinging");

const settings = definePluginSettings({
    isEnabled: {
        type: OptionType.BOOLEAN,
        description: "Master toggle: Block call ringing in DMs and Group DMs",
        default: true,
    },
    showIcon: {
        type: OptionType.BOOLEAN,
        description: "Show toggle button in the chat bar",
        default: true,
    },
    silenceGroupCalls: {
        type: OptionType.BOOLEAN,
        description: "Silence Group DM call ringing",
        default: true,
    },
    silenceDMCalls: {
        type: OptionType.BOOLEAN,
        description: "Silence 1-on-1 DM call ringing",
        default: true,
    },
});

let originalRing: ((...args: any[]) => any) | null = null;

const toggle = () => {
    settings.store.isEnabled = !settings.store.isEnabled;
};

const SettingsPhoneIcon: IconComponent = ({ width = 20, height = 20, className }) => (
    <svg width={width} height={height} viewBox="0 0 24 24" className={className}>
        <path
            fill="currentColor"
            d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C9.6 21 3 14.4 3 6c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.3 1l-2.2 2.2z"
        />
    </svg>
);

// Phone icon showing a slash overlay when Silent Call (block ringing) is ON
function PhoneIcon({ isSilent }: { isSilent: boolean; }) {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24">
            <path
                fill={isSilent ? "var(--interactive-normal)" : "var(--status-positive)"}
                d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C9.6 21 3 14.4 3 6c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.3 1l-2.2 2.2z"
            />
            {isSilent && (
                <rect
                    x="11"
                    y="1"
                    width="2.5"
                    height="22"
                    rx="1.25"
                    fill="var(--status-danger)"
                    transform="rotate(45 12 12)"
                />
            )}
        </svg>
    );
}

const SilentCallButton: ChatBarButtonFactory = ({ isMainChat, channel }) => {
    const { isEnabled, showIcon } = settings.use(["isEnabled", "showIcon"]);

    if (!isMainChat || !showIcon || !channel) return null;
    if (channel.type !== CHANNEL_TYPE_DM && channel.type !== CHANNEL_TYPE_GROUP_DM) return null;

    return (
        <ChatBarButton
            tooltip={isEnabled ? "Silent Call: Enabled (Will NOT ring)" : "Silent Call: Disabled (Will ring)"}
            onClick={toggle}
            buttonProps={{ style: { padding: "0 2px" } }}
        >
            <PhoneIcon isSilent={isEnabled} />
        </ChatBarButton>
    );
};

const patchCtxMenu: NavContextMenuPatchCallback = (children, { channel }) => {
    if (!channel || (channel.type !== CHANNEL_TYPE_DM && channel.type !== CHANNEL_TYPE_GROUP_DM)) return;

    children.push(
        <Menu.MenuGroup key="sc-group">
            <Menu.MenuCheckboxItem
                id="vc-silent-call"
                label="Silent Call (No Ringing)"
                checked={settings.store.isEnabled}
                action={toggle}
            />
        </Menu.MenuGroup>
    );
};

export default definePlugin({
    name: "SilentCall",
    description: "Join DM/Group DM calls without ringing anyone.",
    authors: [
        TestcordDevs.sirphantom89,
        { name: "k1ng_op", id: 641266820187160576n },
    ],
    settings,
    dependencies: ["ChatInputButtonAPI"],

    contextMenus: {
        "user-context": patchCtxMenu,
        "gdm-context": patchCtxMenu,
    },

    commands: [{
        name: "silentcall",
        description: "Toggle silent call mode",
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: [],
        execute(_, ctx) {
            toggle();
            sendBotMessage(ctx.channel.id, {
                content: `Silent Call is now **${settings.store.isEnabled ? "enabled (no ringing)" : "disabled (normal ringing)"}**.`,
            });
        },
    }],

    start() {
        if (!originalRing) {
            let ring: unknown;
            try {
                ring = CallActions.ring;
            } catch (e) {
                logger.error("Could not find CallActions module:", e);
            }

            if (typeof ring === "function") {
                originalRing = ring as (...args: any[]) => any;
                CallActions.ring = function (this: unknown, channelId: string, ...rest: any[]) {
                    let channel: any;
                    try {
                        channel = ChannelStore.getChannel(channelId);
                    } catch {
                        channel = undefined;
                    }

                    const isDM = channel?.type === CHANNEL_TYPE_DM;
                    const isGDM = channel?.type === CHANNEL_TYPE_GROUP_DM;

                    const shouldBlock = settings.store.isEnabled && (
                        (isGDM && settings.store.silenceGroupCalls) ||
                        (isDM && settings.store.silenceDMCalls) ||
                        (!isDM && !isGDM && false)
                    );

                    if (shouldBlock) {
                        logger.info(`Blocked call ring for channel: ${channelId}`);
                        return;
                    }

                    return originalRing!.call(this, channelId, ...rest);
                };
            }
        }

        addChatBarButton("SilentCall", SilentCallButton, SettingsPhoneIcon);
    },

    stop() {
        removeChatBarButton("SilentCall");
        if (originalRing && CallActions) {
            try {
                CallActions.ring = originalRing;
            } catch (e) {
                logger.error("Failed to restore original CallActions.ring:", e);
            } finally {
                originalRing = null;
            }
        }
    },
});
