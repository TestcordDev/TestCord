/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, ModalSize, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { Button, FluxDispatcher, Forms, Menu, React, RestAPI, showToast, TextInput, Toasts, UserStore } from "@webpack/common";

interface ChannelReactRule {
    channelId: string;
    channelName: string;
    reactions: { name: string; id: string | null; animated: boolean; }[];
}

const settings = definePluginSettings({
    rules: {
        type: OptionType.STRING,
        description: "Channel reaction rules (JSON format)",
        default: "[]",
    },
});

// Cached parsed rules — avoids JSON.parse on every MESSAGE_CREATE.
// Invalidated whenever saveRules() runs or settings.store.rules changes externally.
let rulesCache: ChannelReactRule[] | null = null;
let rulesCacheKey: string | null = null;

function parseRules(): ChannelReactRule[] {
    const raw = settings.store.rules;
    if (rulesCache && rulesCacheKey === raw) return rulesCache;
    try {
        const parsed = JSON.parse(raw);
        rulesCache = Array.isArray(parsed) ? parsed : [];
    } catch {
        rulesCache = [];
    }
    rulesCacheKey = raw;
    return rulesCache;
}

function saveRules(rules: ChannelReactRule[]) {
    const serialized = JSON.stringify(rules);
    settings.store.rules = serialized;
    rulesCache = rules;
    rulesCacheKey = serialized;
}

// Tracks in-flight reaction-delay timeouts so stop() can cancel them.
const pendingTimeouts = new Set<ReturnType<typeof setTimeout>>();
let stopped = false;

function emojiToString(emoji: { name: string; id: string | null; animated: boolean; }): string {
    if (emoji.id) return `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`;
    return emoji.name;
}

async function addReactions(channelId: string, messageId: string, reactions: ChannelReactRule["reactions"]) {
    for (const emoji of reactions) {
        if (stopped) return;
        try {
            await new Promise<void>(resolve => {
                const t = setTimeout(() => {
                    pendingTimeouts.delete(t);
                    resolve();
                }, Math.floor(Math.random() * 2000) + 1);
                pendingTimeouts.add(t);
            });
            if (stopped) return;
            const emojiStr = emoji.id
                ? `${emoji.animated ? "a:" : ""}${emoji.name}:${emoji.id}`
                : encodeURIComponent(emoji.name);
            await RestAPI.put({ url: `/channels/${channelId}/messages/${messageId}/reactions/${emojiStr}/@me` });
        } catch (e: any) {
            if (e?.status !== 404) console.error("[AutoChannelReact]", e);
        }
    }
}

function handleMessageCreate(data: any) {
    const { message } = data;
    if (!message || message.author?.id === UserStore.getCurrentUser().id) return;

    const rules = parseRules();
    const rule = rules.find(r => r.channelId === message.channel_id);
    if (!rule || rule.reactions.length === 0) return;

    addReactions(message.channel_id, message.id, rule.reactions);
}

function EmojiPickerModal(props: any) {
    const { channelId, channelName, onClose } = props;
    const [selectedEmojis, setSelectedEmojis] = React.useState<{ name: string; id: string | null; animated: boolean; }[]>([]);
    const [inputValue, setInputValue] = React.useState("");

    React.useEffect(() => {
        const existing = parseRules().find(r => r.channelId === channelId);
        if (existing) setSelectedEmojis([...existing.reactions]);
    }, []);

    const addEmoji = (emoji: { name: string; id: string | null; animated: boolean; }) => {
        if (!selectedEmojis.find(e => e.name === emoji.name && e.id === emoji.id))
            setSelectedEmojis([...selectedEmojis, emoji]);
    };

    const save = () => {
        const rules = parseRules();
        const idx = rules.findIndex(r => r.channelId === channelId);

        if (selectedEmojis.length === 0) {
            if (idx !== -1) rules.splice(idx, 1);
        } else {
            const rule: ChannelReactRule = { channelId, channelName, reactions: selectedEmojis };
            if (idx !== -1) rules[idx] = rule;
            else rules.push(rule);
        }

        saveRules(rules);
        showToast(`AutoChannelReact ${selectedEmojis.length === 0 ? "removed for" : "saved for"} #${channelName}`, Toasts.Type.SUCCESS);
        onClose();
    };

    return (
        <ModalRoot {...props} size={ModalSize.DYNAMIC}>
            <ModalHeader>
                <Forms.FormTitle tag="h4">AutoChannelReact: #{channelName}</Forms.FormTitle>
                <ModalCloseButton onClick={onClose} />
            </ModalHeader>
            <ModalContent>
                <Forms.FormText style={{ marginBottom: "12px", color: "var(--text-muted)" }}>
                    Select emojis to auto-react to every new message in this channel
                </Forms.FormText>

                <div style={{
                    padding: "12px", background: "var(--background-secondary)", borderRadius: "8px",
                    marginBottom: "16px", minHeight: "50px", display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center"
                }}>
                    {selectedEmojis.length === 0 && (
                        <Forms.FormText style={{ color: "var(--text-muted)" }}>No emojis selected</Forms.FormText>
                    )}
                    {selectedEmojis.map((emoji, i) => (
                        <div key={i} style={{ position: "relative", cursor: "pointer" }}
                            onClick={() => setSelectedEmojis(selectedEmojis.filter((_, idx) => idx !== i))}
                            title="Click to remove">
                            {emoji.id
                                ? <img src={`https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? "gif" : "png"}?size=32`}
                                    alt={emoji.name} style={{ width: "32px", height: "32px" }} />
                                : <span style={{ fontSize: "28px" }}>{emoji.name}</span>}
                            <div style={{
                                position: "absolute", top: "-4px", right: "-4px", background: "var(--red-400)",
                                borderRadius: "50%", width: "14px", height: "14px", fontSize: "10px",
                                display: "flex", alignItems: "center", justifyContent: "center", color: "white"
                            }}>×</div>
                        </div>
                    ))}
                </div>

                <div style={{ marginBottom: "16px" }}>
                    <Forms.FormText style={{ marginBottom: "8px" }}>Paste or pick emojis:</Forms.FormText>
                    <TextInput
                        value={inputValue}
                        onChange={text => {
                            setInputValue(text);
                            const customMatch = text.match(/<(a)?:(\w+):(\d+)>/);
                            if (customMatch) {
                                addEmoji({ name: customMatch[2], id: customMatch[3], animated: customMatch[1] === "a" });
                                setInputValue("");
                                return;
                            }
                            const trimmed = text.trim();
                            if (trimmed.length > 0 && trimmed.length <= 10) {
                                addEmoji({ name: trimmed, id: null, animated: false });
                                setInputValue("");
                            }
                        }}
                        placeholder="Paste emoji or <:name:id> here"
                    />
                    <div style={{ marginTop: "8px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        {["👍", "❤️", "😂", "🔥", "👀", "💯", "🎉", "😎", "👌", "💪", "🙌", "✨"].map(emoji => (
                            <button key={emoji} type="button"
                                onClick={() => addEmoji({ name: emoji, id: null, animated: false })}
                                style={{ fontSize: "20px", padding: "4px 8px", cursor: "pointer", background: "var(--background-secondary)", border: "none", borderRadius: "4px" }}>
                                {emoji}
                            </button>
                        ))}
                    </div>
                </div>
            </ModalContent>
            <ModalFooter>
                <Button color={selectedEmojis.length > 0 ? Button.Colors.GREEN : Button.Colors.RED} onClick={save}>
                    {selectedEmojis.length > 0 ? "Save Rule" : "Remove Rule"}
                </Button>
                <Button color={Button.Colors.TRANSPARENT} look={Button.Looks.LINK} onClick={onClose}>Cancel</Button>
            </ModalFooter>
        </ModalRoot>
    );
}

function ChannelContextMenuPatch(): NavContextMenuPatchCallback {
    return (children, props: any) => {
        const channel = props?.channel;
        if (!channel) return;

        const rules = parseRules();
        const hasRule = rules.some(r => r.channelId === channel.id);

        children.splice(-1, 0, (
            <Menu.MenuGroup>
                <Menu.MenuItem
                    id="autochannelreact"
                    label={hasRule ? "Edit AutoReact" : "AutoReact Every Msg"}
                    action={() => openModal(modalProps => (
                        <EmojiPickerModal {...modalProps} channelId={channel.id} channelName={channel.name || channel.id} />
                    ))}
                />
            </Menu.MenuGroup>
        ));
    };
}

export default definePlugin({
    name: "AutoChannelReact",
    description: "Autoreact to every new message in specific channels with chosen emojis via rclick context menu",
    tags: ["Reactions", "Utility"],
    authors: [TestcordDevs.x2b],
    settings,

    contextMenus: {
        "channel-context": ChannelContextMenuPatch(),
    },

    start() {
        stopped = false;
        FluxDispatcher.subscribe("MESSAGE_CREATE", handleMessageCreate);
    },

    stop() {
        stopped = true;
        FluxDispatcher.unsubscribe("MESSAGE_CREATE", handleMessageCreate);
        for (const t of pendingTimeouts) clearTimeout(t);
        pendingTimeouts.clear();
        rulesCache = null;
        rulesCacheKey = null;
    }
});
