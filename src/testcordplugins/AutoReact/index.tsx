/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import { sleep } from "@utils/misc";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, ModalSize, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { Button, FluxDispatcher, Forms, Menu, React, RestAPI, showToast, TextArea, TextInput, Toasts, UserStore } from "@webpack/common";

const logger = new Logger("AutoReact");

type Emoji = { name: string; id: string | null; animated: boolean; };

interface UserReactRule {
    userId: string;
    username: string;
    reactions: Emoji[];
}

interface ContentRule {
    word: string;
    reactions: Emoji[];
}

interface ChannelRule {
    channelId: string;
    channelName: string;
    reactions: Emoji[];
}

const settings = definePluginSettings({
    rules: {
        type: OptionType.STRING,
        description: "User reaction rules (JSON format)",
        default: "[]",
    },
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Enable AutoReact functionality",
        default: true,
    },
    contentRules: {
        type: OptionType.STRING,
        description: "Content word triggers. Format: word:emoji1,emoji2|word2:emoji3",
        default: "",
    },
    contentCaseSensitive: {
        type: OptionType.BOOLEAN,
        description: "Case sensitive word matching for content triggers",
        default: false,
    },
    channelRules: {
        type: OptionType.STRING,
        description: "Channel reaction rules (JSON format). Configure via the channel right-click menu.",
        default: "[]",
    },
    selfReactEnabled: {
        type: OptionType.BOOLEAN,
        description: "React to your own messages too. When off, your own messages are always skipped. Configure emojis with /selfreact.",
        default: false,
    },
    selfReactEmojis: {
        type: OptionType.STRING,
        description: "Emojis to react to your own messages with (JSON array). Set via /selfreact.",
        default: "[]",
    },
    selfReactTargetUserId: {
        type: OptionType.STRING,
        description: "When set, self-react applies to this user's messages instead of your own. Configure via the /selfreact user option. Empty = your own messages.",
        default: "",
    },
});

function emojiToString(emoji: { name: string; id: string | null; animated: boolean; }): string {
    if (emoji.id) {
        return `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`;
    }
    return emoji.name;
}

function parseRules(rulesStr: string): UserReactRule[] {
    try {
        const parsed = JSON.parse(rulesStr);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function saveRules(rules: UserReactRule[]) {
    settings.store.rules = JSON.stringify(rules);
}

function parseSingleEmoji(emojiStr: string): Emoji | null {
    const trimmed = emojiStr.trim();
    if (!trimmed) return null;
    const customMatch = trimmed.match(/<(a)?:(\w+):(\d+)>/);
    if (customMatch) {
        return { name: customMatch[2], id: customMatch[3], animated: customMatch[1] === "a" };
    }
    return { name: trimmed, id: null, animated: false };
}

// Parses a space-separated / pasted emoji string into emoji objects.
// Accepts custom <:name:id>/<a:name:id> tokens and unicode emoji.
function parseEmojiInput(input: string): Emoji[] {
    const emojis: Emoji[] = [];
    const customRegex = /<(a)?:(\w+):(\d+)>/g;
    let match: RegExpExecArray | null;
    let remaining = input;
    while ((match = customRegex.exec(input)) !== null) {
        emojis.push({ name: match[2], id: match[3], animated: match[1] === "a" });
        remaining = remaining.replace(match[0], " ");
    }
    for (const token of remaining.split(/\s+/)) {
        const trimmed = token.trim();
        if (trimmed && trimmed.codePointAt(0)! > 127) {
            emojis.push({ name: trimmed, id: null, animated: false });
        }
    }
    return emojis;
}

function parseContentRules(rulesStr: string): ContentRule[] {
    if (!rulesStr?.trim()) return [];
    const rules: ContentRule[] = [];
    for (const part of rulesStr.split("|")) {
        const colonIndex = part.indexOf(":");
        if (colonIndex === -1) continue;
        const word = part.substring(0, colonIndex).trim();
        const emojiPart = part.substring(colonIndex + 1).trim();
        if (!word || !emojiPart) continue;
        const reactions = emojiPart.split(",").map(parseSingleEmoji).filter((e): e is Emoji => e !== null);
        if (reactions.length > 0) rules.push({ word, reactions });
    }
    return rules;
}

function parseChannelRules(rulesStr: string): ChannelRule[] {
    try {
        const parsed = JSON.parse(rulesStr);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function saveChannelRules(rules: ChannelRule[]) {
    settings.store.channelRules = JSON.stringify(rules);
}

function parseSelfReactEmojis(emojisStr: string): Emoji[] {
    try {
        const parsed = JSON.parse(emojisStr);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

async function addReactionsSequentially(
    channelId: string,
    messageId: string,
    reactions: Emoji[]
) {
    for (const emoji of reactions) {
        try {
            const delay = Math.floor(Math.random() * 2000) + 1;
            await sleep(delay);

            let emojiStr: string;
            if (emoji.id) {
                emojiStr = `${emoji.animated ? "a:" : ""}${emoji.name}:${emoji.id}`;
            } else {
                emojiStr = encodeURIComponent(emoji.name);
            }

            await RestAPI.put({
                url: `/channels/${channelId}/messages/${messageId}/reactions/${emojiStr}/@me`
            });
        } catch (e: any) {
            if (e?.status !== 404) {
                logger.error("Failed to add reaction:", e);
            }
        }
    }
}

function handleMessageCreate(data: any) {
    const { message } = data;
    if (!message) return;

    if (!settings.store.enabled) return;

    const channelId = message.channel_id;
    const messageId = message.id;
    if (!channelId || !messageId) return;

    const isOwnMessage = message.author?.id === UserStore.getCurrentUser().id;

    if (isOwnMessage) {
        // Self-react: react to your own messages, or to a configured target user's messages.
        if (settings.store.selfReactEnabled) {
            const target = settings.store.selfReactTargetUserId?.trim();
            const isTarget = !target || target === message.author?.id;
            if (isTarget) {
                const emojis = parseSelfReactEmojis(settings.store.selfReactEmojis);
                if (emojis.length > 0) addReactionsSequentially(channelId, messageId, emojis);
            }
        }
        return;
    }

    // User rules: react to every message from a configured user.
    const userRule = parseRules(settings.store.rules).find(r => r.userId === message.author?.id);
    if (userRule && userRule.reactions.length > 0) {
        addReactionsSequentially(channelId, messageId, userRule.reactions);
    }

    // Content rules: react when the message content matches a configured word.
    const content: string = message.content || "";
    if (content) {
        const caseSensitive = settings.store.contentCaseSensitive;
        const haystack = caseSensitive ? content : content.toLowerCase();
        const matched: Emoji[] = [];
        for (const rule of parseContentRules(settings.store.contentRules)) {
            const needle = caseSensitive ? rule.word : rule.word.toLowerCase();
            if (haystack.includes(needle)) matched.push(...rule.reactions);
        }
        if (matched.length > 0) addReactionsSequentially(channelId, messageId, matched);
    }

    // Channel rules: react to every message in a configured channel.
    const channelRule = parseChannelRules(settings.store.channelRules).find(r => r.channelId === channelId);
    if (channelRule && channelRule.reactions.length > 0) {
        addReactionsSequentially(channelId, messageId, channelRule.reactions);
    }
}

// Emoji Picker Modal Component
function EmojiPickerModal(props: any) {
    const [selectedEmojis, setSelectedEmojis] = React.useState<{ name: string; id: string | null; animated: boolean; }[]>([]);
    const [inputValue, setInputValue] = React.useState("");

    const { userId, username, onClose, transitionState } = props;

    const rules = parseRules(settings.store.rules);
    const existingRule = rules.find(r => r.userId === userId);

    React.useEffect(() => {
        if (existingRule) {
            setSelectedEmojis([...existingRule.reactions]);
        }
    }, []);

    const removeEmoji = (index: number) => {
        setSelectedEmojis(selectedEmojis.filter((_, i) => i !== index));
    };

    const saveRule = () => {
        const rules = parseRules(settings.store.rules);
        const existingIndex = rules.findIndex(r => r.userId === userId);

        if (selectedEmojis.length === 0) {
            if (existingIndex !== -1) {
                rules.splice(existingIndex, 1);
            }
        } else {
            const newRule: UserReactRule = {
                userId,
                username,
                reactions: selectedEmojis
            };

            if (existingIndex !== -1) {
                rules[existingIndex] = newRule;
            } else {
                rules.push(newRule);
            }
        }

        saveRules(rules);
        showToast(`AutoReact rule ${selectedEmojis.length === 0 ? "removed" : "saved"} for ${username}`, Toasts.Type.SUCCESS);
        onClose();
    };

    const addEmoji = (emoji: { name: string; id: string | null; animated: boolean; }) => {
        if (!selectedEmojis.find(e => e.name === emoji.name && e.id === emoji.id)) {
            setSelectedEmojis([...selectedEmojis, emoji]);
        }
    };

    return (
        <ModalRoot {...props} size={ModalSize.DYNAMIC}>
            <ModalHeader>
                <Forms.FormTitle tag="h4">AutoReact: {username}</Forms.FormTitle>
                <ModalCloseButton onClick={onClose} />
            </ModalHeader>
            <ModalContent>
                <Forms.FormText style={{ marginBottom: "12px", color: "var(--text-muted)" }}>
                    Select emojis to auto-react to every message from this user
                </Forms.FormText>

                {/* Selected Emojis Display */}
                <div style={{
                    padding: "12px",
                    background: "var(--background-secondary)",
                    borderRadius: "8px",
                    marginBottom: "16px",
                    minHeight: "50px",
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "8px",
                    alignItems: "center"
                }}>
                    {selectedEmojis.length === 0 && (
                        <Forms.FormText style={{ color: "var(--text-muted)" }}>No emojis selected</Forms.FormText>
                    )}
                    {selectedEmojis.map((emoji, i) => (
                        <div
                            key={i}
                            style={{
                                position: "relative",
                                cursor: "pointer",
                            }}
                            onClick={() => removeEmoji(i)}
                            title="Click to remove"
                        >
                            {emoji.id
                                ? <img
                                    src={`https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? "gif" : "png"}?size=32`}
                                    alt={emoji.name}
                                    style={{ width: "32px", height: "32px" }}
                                />
                                : <span style={{ fontSize: "28px" }}>{emoji.name}</span>
                            }
                            <div style={{
                                position: "absolute",
                                top: "-4px",
                                right: "-4px",
                                background: "var(--red-400)",
                                borderRadius: "50%",
                                width: "14px",
                                height: "14px",
                                fontSize: "10px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                color: "white"
                            }}>×</div>
                        </div>
                    ))}
                </div>

                {/* Emoji Input */}
                <div style={{ marginBottom: "16px" }}>
                    <Forms.FormText style={{ marginBottom: "8px" }}>Paste or pick emojis:</Forms.FormText>
                    <TextInput
                        value={inputValue}
                        onChange={text => {
                            setInputValue(text);
                            const customMatch = text.match(/<(a)?:(\w+):(\d+)>/);
                            if (customMatch) {
                                addEmoji({
                                    name: customMatch[2],
                                    id: customMatch[3],
                                    animated: customMatch[1] === "a"
                                });
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
                            <button
                                key={emoji}
                                type="button"
                                onClick={() => addEmoji({ name: emoji, id: null, animated: false })}
                                style={{
                                    fontSize: "20px",
                                    padding: "4px 8px",
                                    cursor: "pointer",
                                    background: "var(--background-secondary)",
                                    border: "none",
                                    borderRadius: "4px"
                                }}
                            >
                                {emoji}
                            </button>
                        ))}
                    </div>
                </div>
            </ModalContent>
            <ModalFooter>
                <Button
                    color={selectedEmojis.length > 0 ? Button.Colors.GREEN : Button.Colors.RED}
                    onClick={saveRule}
                    style={{ margin: "0 0 0 8px" }}
                >
                    {selectedEmojis.length > 0 ? "Save Rule" : "Remove Rule"}
                </Button>
                <Button
                    color={Button.Colors.TRANSPARENT}
                    look={Button.Looks.LINK}
                    onClick={onClose}
                >
                    Cancel
                </Button>
            </ModalFooter>
        </ModalRoot>
    );
}

// Context Menu Component for User React
function UserContextMenuPatch(): NavContextMenuPatchCallback {
    return (children, props: any) => {
        const user = props?.user;
        if (!user || user.id === UserStore.getCurrentUser().id) return;

        const rules = parseRules(settings.store.rules);
        const hasRule = rules.some(r => r.userId === user.id);

        const openEmojiPicker = () => {
            openModal(modalProps => (
                <EmojiPickerModal
                    {...modalProps}
                    userId={user.id}
                    username={user.globalName || user.username}
                />
            ));
        };

        children.splice(-1, 0, (
            <Menu.MenuGroup>
                <Menu.MenuItem
                    id="userreact-toggle"
                    label={hasRule ? "Edit AutoReact" : "AutoReact"}
                    action={openEmojiPicker}
                />
            </Menu.MenuGroup>
        ));
    };
}

// Emoji Picker Modal for AutoReact Channel
function ChannelEmojiPickerModal(props: any) {
    const { channelId, channelName, onClose } = props;
    const [selectedEmojis, setSelectedEmojis] = React.useState<Emoji[]>([]);
    const [inputValue, setInputValue] = React.useState("");

    React.useEffect(() => {
        const existing = parseChannelRules(settings.store.channelRules).find(r => r.channelId === channelId);
        if (existing) setSelectedEmojis([...existing.reactions]);
    }, []);

    const addEmoji = (emoji: Emoji) => {
        if (!selectedEmojis.find(e => e.name === emoji.name && e.id === emoji.id)) {
            setSelectedEmojis([...selectedEmojis, emoji]);
        }
    };

    const save = () => {
        const rules = parseChannelRules(settings.store.channelRules);
        const idx = rules.findIndex(r => r.channelId === channelId);

        if (selectedEmojis.length === 0) {
            if (idx !== -1) rules.splice(idx, 1);
        } else {
            const rule: ChannelRule = { channelId, channelName, reactions: selectedEmojis };
            if (idx !== -1) rules[idx] = rule;
            else rules.push(rule);
        }

        saveChannelRules(rules);
        showToast(`AutoReact Channel ${selectedEmojis.length === 0 ? "removed for" : "saved for"} #${channelName}`, Toasts.Type.SUCCESS);
        onClose();
    };

    return (
        <ModalRoot {...props} size={ModalSize.DYNAMIC}>
            <ModalHeader>
                <Forms.FormTitle tag="h4">AutoReact Channel: #{channelName}</Forms.FormTitle>
                <ModalCloseButton onClick={onClose} />
            </ModalHeader>
            <ModalContent>
                <Forms.FormText style={{ marginBottom: "12px", color: "var(--text-muted)" }}>
                    Select emojis to auto-react to every new message in this channel
                </Forms.FormText>

                <div style={{
                    padding: "12px",
                    background: "var(--background-secondary)",
                    borderRadius: "8px",
                    marginBottom: "16px",
                    minHeight: "50px",
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "8px",
                    alignItems: "center"
                }}>
                    {selectedEmojis.length === 0 && (
                        <Forms.FormText style={{ color: "var(--text-muted)" }}>No emojis selected</Forms.FormText>
                    )}
                    {selectedEmojis.map((emoji, i) => (
                        <div
                            key={i}
                            style={{ position: "relative", cursor: "pointer" }}
                            onClick={() => setSelectedEmojis(selectedEmojis.filter((_, idx) => idx !== i))}
                            title="Click to remove"
                        >
                            {emoji.id
                                ? <img
                                    src={`https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? "gif" : "png"}?size=32`}
                                    alt={emoji.name}
                                    style={{ width: "32px", height: "32px" }}
                                />
                                : <span style={{ fontSize: "28px" }}>{emoji.name}</span>
                            }
                            <div style={{
                                position: "absolute",
                                top: "-4px",
                                right: "-4px",
                                background: "var(--red-400)",
                                borderRadius: "50%",
                                width: "14px",
                                height: "14px",
                                fontSize: "10px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                color: "white"
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
                            <button
                                key={emoji}
                                type="button"
                                onClick={() => addEmoji({ name: emoji, id: null, animated: false })}
                                style={{
                                    fontSize: "20px",
                                    padding: "4px 8px",
                                    cursor: "pointer",
                                    background: "var(--background-secondary)",
                                    border: "none",
                                    borderRadius: "4px"
                                }}
                            >
                                {emoji}
                            </button>
                        ))}
                    </div>
                </div>
            </ModalContent>
            <ModalFooter>
                <Button
                    color={selectedEmojis.length > 0 ? Button.Colors.GREEN : Button.Colors.RED}
                    onClick={save}
                    style={{ margin: "0 0 0 8px" }}
                >
                    {selectedEmojis.length > 0 ? "Save Rule" : "Remove Rule"}
                </Button>
                <Button
                    color={Button.Colors.TRANSPARENT}
                    look={Button.Looks.LINK}
                    onClick={onClose}
                >
                    Cancel
                </Button>
            </ModalFooter>
        </ModalRoot>
    );
}

// Context Menu Component for AutoReact Channel
function ChannelContextMenuPatch(): NavContextMenuPatchCallback {
    return (children, props: any) => {
        const channel = props?.channel;
        if (!channel) return;

        const rules = parseChannelRules(settings.store.channelRules);
        const hasRule = rules.some(r => r.channelId === channel.id);

        children.splice(-1, 0, (
            <Menu.MenuGroup>
                <Menu.MenuItem
                    id="userreact-channel-toggle"
                    label={hasRule ? "Edit AutoReact Channel" : "AutoReact Channel"}
                    action={() => openModal(modalProps => (
                        <ChannelEmojiPickerModal
                            {...modalProps}
                            channelId={channel.id}
                            channelName={channel.name || channel.id}
                        />
                    ))}
                />
            </Menu.MenuGroup>
        ));
    };
}

// Settings Panel Component
function ContentRulesSection() {
    const [text, setText] = React.useState(settings.store.contentRules || "");
    const rules = parseContentRules(text);

    return (
        <div style={{ marginTop: "24px" }}>
            <Forms.FormTitle tag="h5" style={{ marginBottom: "8px" }}>Content Triggers</Forms.FormTitle>
            <Forms.FormText style={{ marginBottom: "8px", color: "var(--text-muted)", fontSize: "12px" }}>
                React when a message contains a word. Format: <code style={{ background: "var(--background-secondary)", padding: "2px 4px", borderRadius: "3px" }}>word:emoji1,emoji2|word2:emoji3</code>
            </Forms.FormText>
            <TextArea
                style={{ marginBottom: "12px", minHeight: "80px", fontFamily: "monospace" }}
                value={text}
                onChange={(value: string) => {
                    setText(value);
                    settings.store.contentRules = value;
                }}
                placeholder="happy:😀,🔥|ok:👌"
            />
            {rules.length > 0 && (
                <div>
                    {rules.map((rule, i) => (
                        <div key={i} style={{
                            padding: "8px",
                            background: "var(--background-secondary)",
                            borderRadius: "4px",
                            marginBottom: "4px"
                        }}>
                            <Forms.FormText style={{ fontWeight: 600 }}>
                                Trigger: "{rule.word}" → {rule.reactions.map(emojiToString).join(" ")}
                            </Forms.FormText>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function SettingsPanel() {
    const [rulesText, setRulesText] = React.useState(() => {
        const rules = parseRules(settings.store.rules);
        return rules.map(r => `${r.username} (${r.userId}): ${r.reactions.map(emojiToString).join(" ")}`).join("\n");
    });

    const rules = parseRules(settings.store.rules);

    return (
        <div>
            <Forms.FormTitle tag="h5" style={{ marginBottom: "12px" }}>AutoReact Rules</Forms.FormTitle>
            <Forms.FormText style={{ marginBottom: "8px", color: "var(--text-muted)" }}>
                Right-click on a user and select "AutoReact" to add or edit rules
            </Forms.FormText>
            <Forms.FormText style={{ marginBottom: "16px", color: "var(--text-muted)" }}>
                Currently configured for <strong>{rules.length} {rules.length === 1 ? "user" : "users"}</strong>
            </Forms.FormText>

            {rules.length > 0 ? (
                <div style={{
                    padding: "12px",
                    background: "var(--background-secondary)",
                    borderRadius: "8px",
                    marginBottom: "16px"
                }}>
                    {rules.map((rule, i) => (
                        <div key={i} style={{
                            padding: "8px",
                            marginBottom: "8px",
                            background: "var(--background-tertiary)",
                            borderRadius: "4px",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center"
                        }}>
                            <div>
                                <Forms.FormText style={{ fontWeight: 600 }}>
                                    {rule.username}
                                </Forms.FormText>
                                <Forms.FormText style={{ color: "var(--text-muted)", fontSize: "12px" }}>
                                    {rule.reactions.map(emojiToString).join(" ")}
                                </Forms.FormText>
                            </div>
                            <Button
                                color={Button.Colors.RED}
                                size={Button.Sizes.SMALL}
                                onClick={() => {
                                    const newRules = parseRules(settings.store.rules);
                                    newRules.splice(i, 1);
                                    saveRules(newRules);
                                    setRulesText(newRules.map(r => `${r.username} (${r.userId}): ${r.reactions.map(emojiToString).join(" ")}`).join("\n"));
                                    showToast("Rule removed", Toasts.Type.SUCCESS);
                                }}
                            >
                                Remove
                            </Button>
                        </div>
                    ))}
                </div>
            ) : (
                <Forms.FormText style={{
                    marginBottom: "16px",
                    color: "var(--text-muted)",
                    padding: "16px",
                    background: "var(--background-secondary)",
                    borderRadius: "8px",
                    textAlign: "center"
                }}>
                    No rules configured. Right-click on a user to add one!
                </Forms.FormText>
            )}
            <ContentRulesSection />
        </div>
    );
}

export default definePlugin({
    name: "AutoReact",
    description: "Automatically react to messages from specific users, every message in chosen channels, or messages containing trigger words. Also supports self-react and a /selfreact command.",
    tags: ["Reactions", "Utility"],
    authors: [TestcordDevs.x2b],
    settings,
    settingsPanel: SettingsPanel,

    contextMenus: {
        "user-context": UserContextMenuPatch(),
        "channel-context": ChannelContextMenuPatch(),
    },

    commands: [
        {
            name: "selfreact",
            description: "Toggle reacting to your own messages and set the emojis to use",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "state",
                    description: "Turn self-react on or off",
                    required: false,
                    type: ApplicationCommandOptionType.STRING,
                    choices: [
                        { label: "On", name: "on", value: "on" },
                        { label: "Off", name: "off", value: "off" },
                    ],
                },
                {
                    name: "emojis",
                    description: "Emojis to react with (space-separated, unicode or <:name:id>)",
                    required: false,
                    type: ApplicationCommandOptionType.STRING,
                },
                {
                    name: "user",
                    description: "Target user (leave empty for your own messages)",
                    required: false,
                    type: ApplicationCommandOptionType.USER,
                },
            ],
            execute: (args, ctx) => {
                const state = findOption<string>(args, "state", "");
                const emojisStr = findOption<string>(args, "emojis", "");
                const targetUserId = findOption<string>(args, "user", "");

                if (state === "off") {
                    settings.store.selfReactEnabled = false;
                    sendBotMessage(ctx.channel.id, { content: "Self-react **disabled**. Your own messages will be skipped." });
                    return;
                }

                if (emojisStr.trim()) {
                    const emojis = parseEmojiInput(emojisStr);
                    if (emojis.length === 0) {
                        sendBotMessage(ctx.channel.id, { content: "No valid emojis found. Provide unicode or `<:name:id>` emojis." });
                        return;
                    }
                    settings.store.selfReactEmojis = JSON.stringify(emojis);
                }

                if (targetUserId) {
                    settings.store.selfReactTargetUserId = targetUserId;
                }

                if (state === "on" || emojisStr.trim()) {
                    const stored = parseSelfReactEmojis(settings.store.selfReactEmojis);
                    if (stored.length === 0) {
                        sendBotMessage(ctx.channel.id, { content: "No emojis set. Provide emojis like `/selfreact emojis:😀 👍`." });
                        return;
                    }
                    settings.store.selfReactEnabled = true;
                    const targetLabel = settings.store.selfReactTargetUserId ? `<@${settings.store.selfReactTargetUserId}>` : "your own messages";
                    sendBotMessage(ctx.channel.id, {
                        content: `Self-react **enabled**.\nTarget: ${targetLabel}\nEmojis: ${stored.map(emojiToString).join(" ")}`
                    });
                    return;
                }

                const stored = parseSelfReactEmojis(settings.store.selfReactEmojis);
                const targetLabel = settings.store.selfReactTargetUserId ? `<@${settings.store.selfReactTargetUserId}>` : "your own messages";
                sendBotMessage(ctx.channel.id, {
                    content: `Self-react is **${settings.store.selfReactEnabled ? "enabled" : "disabled"}**.\nTarget: ${targetLabel}\nEmojis: ${stored.length > 0 ? stored.map(emojiToString).join(" ") : "None set"}`
                });
            },
        },
    ],

    start() {
        FluxDispatcher.subscribe("MESSAGE_CREATE", handleMessageCreate);
    },

    stop() {
        FluxDispatcher.unsubscribe("MESSAGE_CREATE", handleMessageCreate);
    }
});
