/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher, Forms, React, RestAPI,TextInput, UserStore } from "@webpack/common";

interface AutoReactRule {
    triggerWord: string;
    reactions: { name: string; id: string | null; animated: boolean; }[];
}

const settings = definePluginSettings({
    rules: {
        type: OptionType.STRING,
        description: "Rules in format: word1:😀,😀|word2:<:name:id>,<a:name:id>",
        default: "",
    },
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Enable AutoReact functionality",
        default: true,
    },
});

function parseEmojiString(emojiStr: string): { name: string; id: string | null; animated: boolean; } {
    // Custom emoji format: name:id or a:name:id
    const customMatch = emojiStr.match(/^(a)?:([^:]+):(\d+)$/);
    if (customMatch) {
        return {
            name: customMatch[2],
            id: customMatch[3],
            animated: customMatch[1] === "a"
        };
    }
    // Standard emoji
    return {
        name: emojiStr,
        id: null,
        animated: false
    };
}

function emojiToString(emoji: { name: string; id: string | null; animated: boolean; }): string {
    if (emoji.id) {
        return `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`;
    }
    return emoji.name;
}

function parseRules(rulesStr: string): AutoReactRule[] {
    if (!rulesStr?.trim()) return [];

    const rules: AutoReactRule[] = [];
    const ruleStrings = rulesStr.split("|").filter(r => r.trim());

    for (const ruleStr of ruleStrings) {
        const colonIndex = ruleStr.indexOf(":");
        if (colonIndex === -1) continue;

        const triggerWord = ruleStr.substring(0, colonIndex).trim();
        const emojiPart = ruleStr.substring(colonIndex + 1).trim();

        if (!triggerWord || !emojiPart) continue;

        const emojis = emojiPart.split(",").filter(e => e.trim()).map(parseEmojiString);
        if (emojis.length > 0) {
            rules.push({ triggerWord, reactions: emojis });
        }
    }

    return rules;
}

function RulesEditor() {
    const [rulesText, setRulesText] = React.useState(settings.store.rules || "");

    const handleChange = (text: string) => {
        setRulesText(text);
        settings.store.rules = text;
    };

    const rules = parseRules(rulesText);

    return (
        <div>
            <Forms.FormText style={{ marginBottom: "8px", color: "var(--text-muted)" }}>
                Enter rules in the format: <code style={{ background: "var(--background-secondary)", padding: "2px 4px", borderRadius: "3px" }}>word:emoji1,emoji2|word2:emoji3</code>
            </Forms.FormText>
            <Forms.FormText style={{ marginBottom: "8px", color: "var(--text-muted)", fontSize: "12px" }}>
                • Use <code style={{ background: "var(--background-secondary)", padding: "2px 4px", borderRadius: "3px" }}>|</code> to separate rules
            </Forms.FormText>
            <Forms.FormText style={{ marginBottom: "8px", color: "var(--text-muted)", fontSize: "12px" }}>
                • Use <code style={{ background: "var(--background-secondary)", padding: "2px 4px", borderRadius: "3px" }}>,</code> to separate multiple reactions per rule
            </Forms.FormText>
            <Forms.FormText style={{ marginBottom: "8px", color: "var(--text-muted)", fontSize: "12px" }}>
                • Standard emoji: 😀 | Custom: <code style={{ background: "var(--background-secondary)", padding: "2px 4px", borderRadius: "3px" }}>name:id</code> or <code style={{ background: "var(--background-secondary)", padding: "2px 4px", borderRadius: "3px" }}>a:name:id</code> for animated
            </Forms.FormText>
            <TextInput
                style={{ marginBottom: "16px", minHeight: "100px", fontFamily: "monospace" }}
                value={rulesText}
                onChange={handleChange}
                placeholder="happy:😀,🔥|ok:👌"
                // @ts-ignore API changed
                multiLine={true}
            />
            {rules.length > 0 && (
                <div>
                    <Forms.FormTitle tag="h5" style={{ marginBottom: "8px" }}>Parsed Rules:</Forms.FormTitle>
                    {rules.map((rule, i) => (
                        <div key={i} style={{
                            padding: "8px",
                            background: "var(--background-secondary)",
                            borderRadius: "4px",
                            marginBottom: "4px"
                        }}>
                            <Forms.FormText style={{ fontWeight: 600 }}>
                                Trigger: "{rule.triggerWord}" → {rule.reactions.map(emojiToString).join(" ")}
                            </Forms.FormText>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function addReactionsSequentially(
    channelId: string,
    messageId: string,
    reactions: AutoReactRule["reactions"]
) {
    for (const emoji of reactions) {
        try {
            // Random delay between 1ms and 2000ms
            const delay = Math.floor(Math.random() * 2000) + 1;
            await new Promise(resolve => setTimeout(resolve, delay));

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
            // Ignore 404 errors (message deleted/not found) - harmless
            if (e?.status !== 404) {
                console.error("[AutoReact] Failed to add reaction:", e);
            }
        }
    }
}

function handleMessageCreate(data: any) {
    const { message } = data;
    if (!message) return;

    if (!settings.store.enabled) return;

    // Ignore own messages
    if (message.author?.id === UserStore.getCurrentUser().id) return;

    const rules = parseRules(settings.store.rules);
    if (rules.length === 0) return;

    const content = message.content?.toLowerCase() || "";
    const channelId = message.channel_id;
    const messageId = message.id;

    if (!channelId || !messageId) return;

    // Collect all matching reactions from all rules
    const allReactions: AutoReactRule["reactions"] = [];

    for (const rule of rules) {
        if (!rule.triggerWord || !rule.reactions?.length) continue;

        // Substring match (case-insensitive)
        if (content.includes(rule.triggerWord.toLowerCase())) {
            allReactions.push(...rule.reactions);
        }
    }

    // Add all collected reactions
    if (allReactions.length > 0) {
        addReactionsSequentially(channelId, messageId, allReactions);
    }
}

export default definePlugin({
    name: "AutoReact",
    description: "Automatically react to messages containing specific words",
    tags: ["Reactions", "Utility"],
    authors: [TestcordDevs.x2b],
    settings,
    settingsPanel: RulesEditor,

    start() {
        FluxDispatcher.subscribe("MESSAGE_CREATE", handleMessageCreate);
    },

    stop() {
        FluxDispatcher.unsubscribe("MESSAGE_CREATE", handleMessageCreate);
    }
});
