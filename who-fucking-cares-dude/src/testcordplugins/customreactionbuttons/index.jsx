/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { DataStore } from "@api/index";
import { addMessagePopoverButton, removeMessagePopoverButton } from "@api/MessagePopover";
import { definePluginSettings } from "@api/Settings";
import { Paragraph } from "@components/Paragraph";
import { TestcordDevs } from "@utils/constants";
import { useForceUpdater } from "@utils/react";
import definePlugin from "@utils/types";
import { Button, ChannelStore, Constants, PermissionsBits, PermissionStore, React, RestAPI, TextInput, Toasts } from "@webpack/common";
const BUTTONS_KEY = "CustomReactionButtons_buttons";
let reactionButtons = [];
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
}
function parseEmoji(emoji) {
    if (!emoji)
        return emoji;
    // Custom emoji format: <:name:id> or :name:id
    const customMatch = emoji.match(/^(?:<(?<animated>a)?:)?(?<name>[\w]+?)(?:~\d+)?:(?<id>\d+)>?$/);
    if (customMatch) {
        const name = customMatch.groups?.name;
        const id = customMatch.groups?.id;
        return `${name}:${id}`;
    }
    // Check for :name:id format without angle brackets
    const colonMatch = emoji.match(/^:(?<name>[\w]+?):(?<id>\d+)$/);
    if (colonMatch) {
        return `${colonMatch[1]}:${colonMatch[2]}`;
    }
    // Check for name:id format (already parsed)
    const directMatch = emoji.match(/^(?<name>[\w]+?):(?<id>\d+)$/);
    if (directMatch) {
        return emoji;
    }
    // Native emoji - encode it
    return encodeURIComponent(emoji);
}
function ReactionButtonsEditor() {
    const update = useForceUpdater();
    React.useEffect(() => {
        const loadButtons = async () => {
            try {
                const stored = await DataStore.get(BUTTONS_KEY) ?? [];
                reactionButtons = stored;
                update();
            }
            catch (error) {
                console.error("[CustomReactionButtons] Failed to load buttons:", error);
            }
        };
        loadButtons();
    }, []);
    async function setEmoji(id, value) {
        try {
            const index = reactionButtons.findIndex(b => b.id === id);
            if (index !== -1) {
                reactionButtons[index].emoji = value;
                await DataStore.set(BUTTONS_KEY, reactionButtons);
                update();
            }
        }
        catch (error) {
            console.error("[CustomReactionButtons] Failed to update emoji:", error);
        }
    }
    async function setLabel(id, value) {
        try {
            const index = reactionButtons.findIndex(b => b.id === id);
            if (index !== -1) {
                reactionButtons[index].label = value;
                await DataStore.set(BUTTONS_KEY, reactionButtons);
                update();
            }
        }
        catch (error) {
            console.error("[CustomReactionButtons] Failed to update label:", error);
        }
    }
    async function addButton() {
        try {
            reactionButtons.push({
                id: generateId(),
                emoji: "👍",
                label: "React"
            });
            await DataStore.set(BUTTONS_KEY, reactionButtons);
            update();
        }
        catch (error) {
            console.error("[CustomReactionButtons] Failed to add button:", error);
        }
    }
    async function removeButton(id) {
        try {
            const index = reactionButtons.findIndex(b => b.id === id);
            if (index !== -1) {
                reactionButtons.splice(index, 1);
                await DataStore.set(BUTTONS_KEY, reactionButtons);
                update();
            }
        }
        catch (error) {
            console.error("[CustomReactionButtons] Failed to remove button:", error);
        }
    }
    return (<>
            {reactionButtons.map((btn, index) => (<div key={btn.id} style={{ marginBottom: "12px" }}>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "4px" }}>
                        <Paragraph>#{index + 1}</Paragraph>
                        <Button onClick={() => removeButton(btn.id)} look={Button.Looks.FILLED} color={Button.Colors.RED} size={Button.Sizes.MIN}>
                            Remove
                        </Button>
                    </div>
                    <div style={{ display: "flex", gap: "8px" }}>
                        <TextInput placeholder="Emoji, :name:123 or <a:name:123>" value={btn.emoji} onChange={e => setEmoji(btn.id, e)}/>
                        <TextInput placeholder="Label" value={btn.label} onChange={e => setLabel(btn.id, e)} style={{ width: "80px" }}/>
                    </div>
                </div>))}
            <Button onClick={addButton} style={{ marginTop: "8px" }}>
                Add Button
            </Button>
        </>);
}
const settings = definePluginSettings({
    buttons: {
        type: 6 /* OptionType.COMPONENT */,
        description: "Custom reaction buttons (restart needed after adding/removing)",
        component: () => <ReactionButtonsEditor />,
        restartNeeded: true
    }
});
export default definePlugin({
    name: "CustomReactionButtons",
    description: "Add custom reaction buttons to the message popover, either use the windows emoji picker or you have to copy the custom server emojis markdown.",
    tags: ["Chat", "Utility", "Reactions"],
    authors: [TestcordDevs.x2b],
    settings,
    async start() {
        try {
            const stored = await DataStore.get(BUTTONS_KEY) ?? [];
            reactionButtons = stored;
            if (reactionButtons.length === 0) {
                reactionButtons = [{ id: generateId(), emoji: "👍", label: "Like" }];
                await DataStore.set(BUTTONS_KEY, reactionButtons);
            }
        }
        catch {
            reactionButtons = [{ id: generateId(), emoji: "👍", label: "Like" }];
        }
        this.registerButtons();
    },
    stop() {
        this.unregisterAllButtons();
    },
    unregisterAllButtons() {
        for (const btn of reactionButtons) {
            removeMessagePopoverButton(`vc-emoji-${btn.id}`);
        }
    },
    registerButtons() {
        for (const btn of reactionButtons) {
            const emojiParam = parseEmoji(btn.emoji);
            if (!emojiParam)
                continue;
            addMessagePopoverButton(`vc-emoji-${btn.id}`, message => {
                const channel = ChannelStore.getChannel(message.channel_id);
                if (!channel)
                    return null;
                if (channel.guild_id && !PermissionStore.can(PermissionsBits.ADD_REACTIONS, channel)) {
                    return null;
                }
                return {
                    label: btn.label,
                    icon: () => <EmojiDisplay emoji={btn.emoji}/>,
                    message,
                    channel,
                    onClick: () => {
                        RestAPI.put({
                            url: Constants.Endpoints.REACTION(message.channel_id, message.id, emojiParam, "@me")
                        }).catch(() => {
                            Toasts.show({
                                message: "Failed to add reaction",
                                type: Toasts.Type.FAILURE,
                                id: Toasts.genId(),
                                options: { duration: 3000 }
                            });
                        });
                    }
                };
            }, () => <EmojiDisplay emoji="👍"/>);
        }
    }
});
function EmojiDisplay({ emoji }) {
    const customMatch = emoji.match(/^(?:<(?<animated>a)?:)?(?<name>[\w]+?)(?:~\d+)?:(?<id>\d+)>?$/);
    if (customMatch) {
        const id = customMatch.groups?.id;
        const animated = customMatch.groups?.animated;
        const ext = animated ? "gif" : "png";
        return <img src={`https://cdn.discordapp.com/emojis/${id}.${ext}`} alt={emoji} style={{ width: 18, height: 18, verticalAlign: "middle" }}/>;
    }
    const directMatch = emoji.match(/^(?<name>[\w]+?):(?<id>\d+)$/);
    if (directMatch) {
        const id = directMatch.groups?.id;
        return <img src={`https://cdn.discordapp.com/emojis/${id}.png`} alt={emoji} style={{ width: 18, height: 18, verticalAlign: "middle" }}/>;
    }
    return <span style={{ fontSize: 16, lineHeight: 1 }}>{emoji}</span>;
}
