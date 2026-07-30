/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { findOption, RequiredMessageOption } from "@api/Commands";
import { addChannelToolbarButton, addHeaderBarButton, ChannelToolbarButton, HeaderBarButton, removeChannelToolbarButton, removeHeaderBarButton } from "@api/HeaderBar";
import { addMessagePreSendListener, removeMessagePreSendListener } from "@api/MessageEvents";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { React } from "@webpack/common";

// Light mode - using Mathematical Alphanumeric Symbols (nearly identical)
const lightCharMap: Record<string, string> = {
    // These look nearly identical to regular Latin letters
    a: "𝑎", b: "𝑏", c: "𝑐", d: "𝑑", e: "𝑒", f: "𝑓", g: "𝑔", h: "ℎ", i: "𝑖",
    j: "𝑗", k: "𝑘", l: "𝑙", m: "𝑚", n: "𝑛", o: "𝑜", p: "𝑝", q: "𝑞", r: "𝑟",
    s: "𝑠", t: "𝑡", u: "𝑢", v: "𝑣", w: "𝑤", x: "𝑥", y: "𝑦", z: "𝑧",
    A: "𝐴", B: "𝐵", C: "𝐶", D: "𝐷", E: "𝐸", F: "𝐹", G: "𝐺", H: "𝐻", I: "𝐼",
    J: "𝐽", K: "𝐾", L: "𝐿", M: "𝑀", N: "𝑁", O: "𝑂", P: "𝑃", Q: "𝑄", R: "𝑅",
    S: "𝑆", T: "𝑇", U: "𝑈", V: "𝑉", W: "𝑊", X: "𝑋", Y: "𝑌", Z: "𝑍",
};

const middleCharMap: Record<string, string> = {
    // Latin lowercase -> Cyrillic lookalikes
    a: "а", b: "ƅ", c: "с", d: "ԁ", e: "е", f: "ƒ", g: "ɡ", h: "һ", i: "і",
    j: "ј", k: "κ", l: "ӏ", m: "м", n: "ո", o: "ο", p: "р", q: "ԛ", r: "г",
    s: "ѕ", t: "т", u: "υ", v: "ν", w: "ш", x: "х", y: "у",
    // Latin uppercase -> Cyrillic/Greek lookalikes
    A: "А", B: "Β", C: "С", D: "D", E: "Ε", F: "F", G: "G", H: "Η", I: "Ι",
    J: "Ј", K: "Κ", L: "L", M: "Μ", N: "Ν", O: "Ο", P: "Ρ", Q: "Q", R: "R",
    S: "Ѕ", T: "Τ", U: "U", V: "V", W: "W", X: "Χ", Y: "Υ", Z: "Ζ",
};

const extendedCharMap: Record<string, string> = {
    a: "а", b: "ƅ", c: "с", d: "ԁ", e: "е", f: "ƒ", g: "ɡ", h: "һ", i: "і",
    j: "ј", k: "κ", l: "ӏ", m: "м", n: "ո", o: "ο", p: "р", q: "ԛ", r: "г",
    s: "ѕ", t: "т", u: "υ", v: "ν", w: "ш", x: "х", y: "у",
    A: "А", B: "Β", C: "С", E: "Ε", F: "F", G: "G", H: "Η",
    I: "Ι", J: "Ј", K: "Κ", L: "L", M: "Μ", N: "Ν", O: "Ο",
    P: "Ρ", R: "R", S: "Ѕ", T: "Τ", U: "U", V: "V", W: "W",
    X: "Χ", Y: "Υ",
};

// Zalgo combining characters
const zalgoChars = ["", "̀", "́", "̂", "̃", "̄", "̅", "̇", "̈"];

// Heavy zalgo characters for Final Boss mode
const heavyZalgoChars = ["", "̀", "́", "̂", "̃", "̄", "̅", "̆", "̇", "̈", "̉", "̊", "̋", "̌", "̍", "̎", "̏", "̐", "̑", "̒", "̓", "̔", "̕", "̚", "̛", "̜", "̝", "̞", "̟", "̠", "̡", "̢", "̣", "̤", "̥", "̦", "̧", "̨", "̩", "̪", "̫", "̬", "̭", "̮", "̯", "̰", "̱", "̲", "̳", "̴", "̵", "̶", "̷", "̸", "̹", "̺", "̻", "̼", "̽", "̾", "̿", "ͅ", "͆", "͇", "͈", "͉", "͊", "͋", "͌", "͍", "͎", "͏", "͐", "͑", "͒", "͓", "͔", "͕", "͖", "͗", "͘", "͙", "͚", "͛", "͜", "͝", "͞", "͟", "͠", "͡", "͢", "ͣ", "ͤ", "ͥ", "ͦ", "ͧ", "ͨ", "ͩ", "ͪ", "ͫ", "ͬ", "ͭ", "ͮ", "ͯ"];

// All known invisible/zero-width Unicode characters for maximum bypass
// Removed potentially visible interlinear annotation characters (FFF9-FFFB)
// Removed ALL bidirectional control characters that can scramble text display
const zeroWidthChars = [
    "\u200B", // Zero Width Space
    "\u200C", // Zero Width Non-Joiner
    "\u200D", // Zero Width Joiner
    "\u202C", // Pop Directional Formatting
    "\u2060", // Word Joiner
    "\u2061", // Function Application
    "\u2062", // Invisible Times
    "\u2063", // Invisible Separator
    "\u2064", // Invisible Plus
    "\u2069", // Pop Directional Isolate
    "\u206A", // Inhibit Symmetric Swapping
    "\u206B", // Activate Symmetric Swapping
    "\u206C", // Inhibit Arabic Form Shaping
    "\u206D", // Activate Arabic Form Shaping
    "\u206E", // National Digit Shapes
    "\u206F", // Nominal Digit Shapes
    "\uFE00", // Variation Selector-1
    "\uFE01", // Variation Selector-2
    "\uFE02", // Variation Selector-3
    "\uFE03", // Variation Selector-4
    "\uFE04", // Variation Selector-5
    "\uFE05", // Variation Selector-6
    "\uFE06", // Variation Selector-7
    "\uFE07", // Variation Selector-8
    "\uFE08", // Variation Selector-9
    "\uFE09", // Variation Selector-10
    "\uFE0A", // Variation Selector-11
    "\uFE0B", // Variation Selector-12
    "\uFE0C", // Variation Selector-13
    "\uFE0D", // Variation Selector-14
    "\uFE0E", // Variation Selector-15 (Text)
    "\uFE0F", // Variation Selector-16 (Emoji)
    "\uFEFF", // Zero Width No-Break Space (BOM)
];

// Helper to get random zero-width character
const getRandomZeroWidth = () => zeroWidthChars[Math.floor(Math.random() * zeroWidthChars.length)];

// URL regex to detect links (updated to capture full URL)
const urlRegex = /https?:\/\/[^\s<]+/gi;

// Emoji regex to detect custom emojis: <:name:id> or <a:name:id>
const emojiRegex = /<(a)?:(\w+):(\d+)>/g;

// Mention regex to detect user/channel mentions: <@numbers> or <@!numbers> or <#numbers>
const mentionRegex = /<@!?\d+>|<#\d+>/gi;

// Combined regex for all protected patterns
const protectedPattern = new RegExp(`(${urlRegex.source}|${emojiRegex.source}|${mentionRegex.source})`, "gi");

const mapCharacters = (text: string, map: Record<string, string>) => {
    return text.split("").map(char => map[char] || char).join("");
};

const mapCharactersExtended = (text: string, map: Record<string, string>) => {
    return text.split("").map(char => {
        if (map[char]) return map[char];
        // Add subtle zalgo for unmapped alphanumeric
        if (char.match(/[a-zA-Z0-9]/)) {
            const zalgo = zalgoChars[Math.floor(Math.random() * 3)];
            return char + zalgo;
        }
        return char;
    }).join("");
};

const mapCharactersZeroWidth = (text: string): string => {
    return processZeroWidth(text);
};

const processZeroWidth = (text: string): string => {
    let modifiedMessage = "";

    text.split(" ").forEach(word => {
        if (word.length < 2) {
            modifiedMessage += word + " ";
            return;
        }

        const letterPositions: number[] = [];
        for (let i = 0; i < word.length; i++) {
            if (/[a-zA-Z]/.test(word[i])) {
                letterPositions.push(i);
            }
        }

        if (letterPositions.length === 0) {
            modifiedMessage += word + " ";
            return;
        }

        const randomIndex = Math.floor(Math.random() * letterPositions.length);
        const randomPosition = letterPositions[randomIndex];

        modifiedMessage += word.replace(
            word[randomPosition],
            word[randomPosition] + getRandomZeroWidth()
        ) + " ";
    });

    return modifiedMessage.trim();
};

// Tryhard mode - random bypass insertions at random positions
// Inserts varying amounts of invisible characters at randomized positions within each word
// Makes rule-based detection nearly impossible by varying character count and locations
const mapCharactersTryhard = (text: string): string => {
    return text.split(/(\s+)/).map(part => {
        // Preserve whitespace
        if (/^\s*$/.test(part)) return part;
        if (part.length === 0) return part;

        const word = part;
        // Find all alphanumeric positions
        const alphaPositions: number[] = [];
        for (let i = 0; i < word.length; i++) {
            if (/[a-zA-Z0-9]/.test(word[i])) {
                alphaPositions.push(i);
            }
        }

        // Not enough characters to bypass
        if (alphaPositions.length < 2) return word;

        // Determine number of bypass insertions (1 per char minimum, up to word length, max 12)
        const maxBypasses = Math.min(alphaPositions.length, 12);
        const numBypasses = Math.max(1, Math.floor(Math.random() * maxBypasses) + 1);

        // Randomly select positions (no duplicates)
        const shuffled = [...alphaPositions].sort(() => Math.random() - 0.5);
        const selectedPositions = shuffled.slice(0, numBypasses).sort((a, b) => a - b);

        // Build the modified word
        let result = "";
        let lastIdx = 0;
        for (const pos of selectedPositions) {
            // Add characters up to this position
            result += word.slice(lastIdx, pos);
            // Add random number of zero-width chars (2 to 6)
            const numZalgo = 2 + Math.floor(Math.random() * 5);
            for (let z = 0; z < numZalgo; z++) {
                result += getRandomZeroWidth();
            }
            // Add the original character
            result += word[pos];
            lastIdx = pos + 1;
        }
        // Add remaining characters
        result += word.slice(lastIdx);

        return result;
    }).join("");
};

// Final Boss mode - purely invisible characters (maximum stealth)
// Inserts zero-width characters between EVERY character in EVERY word
const mapCharactersFinalBoss = (text: string): string => {
    return text.split(/(\s+)/).map(word => {
        // Skip whitespace
        if (/^\s*$/.test(word)) return word;
        // Skip empty
        if (word.length === 0) return word;

        // Add zero-width between every character
        return word.split("").map(char => char + getRandomZeroWidth()).join("");
    }).join("");
};

const settings = definePluginSettings({
    location: {
        type: OptionType.SELECT,
        description: "Where to show the button",
        options: [
            { label: "Chat bar", value: "chatbar", default: true },
            { label: "Header bar", value: "headerbar" },
            { label: "Channel toolbar", value: "channeltoolbar" },
            { label: "Disabled", value: "disabled" },
        ],
        restartNeeded: true,
    },
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Enable AntiFilter bypass",
        default: false
    },
    isEnabled: {
        type: OptionType.BOOLEAN,
        description: "Toggle the feature on/off (button controls this)",
        default: false
    },
    mode: {
        type: OptionType.SELECT,
        description: "Bypass mode",
        options: [
            { label: "Zero-Width (Dadscord)", value: "zerowidth", default: true },
            { label: "Light (Math symbols)", value: "light" },
            { label: "Middle (Cyrillic)", value: "middle" },
            { label: "Extended (Cyrillic + Zalgo)", value: "extended" },
            { label: "Tryhard (Random bypasses)", value: "tryhard" },
            { label: "Final Boss (Invisible + Zalgo)", value: "finalboss" }
        ]
    }
});

function transformText(text: string, mode: string): string {
    switch (mode) {
        case "zerowidth":
            return mapCharactersZeroWidth(text);
        case "light":
            return mapCharacters(text, lightCharMap);
        case "middle":
            return mapCharacters(text, middleCharMap);
        case "extended":
            return mapCharactersExtended(text, extendedCharMap);
        case "tryhard":
            return mapCharactersTryhard(text);
        case "finalboss":
            return mapCharactersFinalBoss(text);
        default:
            return mapCharactersZeroWidth(text);
    }
}

// Transform text while preserving protected patterns (URLs, emojis, mentions)
function transformTextWithProtection(text: string, mode: string): string {
    const parts: string[] = [];
    let lastIndex = 0;
    let match;

    // Reset regex state
    protectedPattern.lastIndex = 0;

    while ((match = protectedPattern.exec(text)) !== null) {
        // Transform text before this protected pattern
        if (match.index > lastIndex) {
            const textToTransform = text.slice(lastIndex, match.index);
            parts.push(transformText(textToTransform, mode));
        }
        // Add protected pattern as-is
        parts.push(match[0]);
        lastIndex = match.index + match[0].length;
    }

    // Transform remaining text after last protected pattern
    if (lastIndex < text.length) {
        parts.push(transformText(text.slice(lastIndex), mode));
    }

    // If no protected patterns found, transform entire text
    if (parts.length === 0) {
        return transformText(text, mode);
    }

    return parts.join("");
}

function handleMessageSend(channelId: string, messageObj: any, options: any): void | { cancel: boolean; } {
    if (!settings.store.enabled || !settings.store.isEnabled) return;

    if (messageObj.content) {
        messageObj.content = transformTextWithProtection(messageObj.content, settings.store.mode);
    }
}

const AntiFilterIcon = ({ width = 20, height = 20 }: { width?: number; height?: number; }) => (
    <svg width={width} height={height} viewBox="0 0 24 24">
        <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z" />
    </svg>
);

const AntiFilterButton: ChatBarButtonFactory = ({ isMainChat }) => {
    const { isEnabled } = settings.use(["isEnabled"]);

    if (!isMainChat || settings.store.location !== "chatbar") return null;

    return (
        <ChatBarButton
            tooltip={isEnabled ? "AntiFilter: ON" : "AntiFilter: OFF"}
            onClick={() => {
                settings.store.isEnabled = !settings.store.isEnabled;
            }}
        >
            <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill={isEnabled ? "var(--status-danger, #da373c)" : "currentColor"}
            >
                {isEnabled ? (
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                ) : (
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z" />
                )}
            </svg>
        </ChatBarButton>
    );
};

export default definePlugin({
    name: "AntiFilter",
    description: "Bypass automod filters using lookalike Unicode characters (credits to dot for givin me the dadscord bypass)",
    tags: ["Privacy", "Utility"],
    authors: [TestcordDevs.x2b, TestcordDevs.sirphantom89,
    { name: "dot", id: 1400610916285812776n }
    ],
    settings: settings,
    dependencies: ["ChatInputButtonAPI", "CommandsAPI", "MessageEventsAPI", "HeaderBarAPI"],

    commands: [
        {
            name: "antifilter",
            description: "Bypass automod using zero-width Unicode characters",
            options: [RequiredMessageOption],
            execute: opts => {
                const originalMessage = findOption(opts, "message", "");
                const modifiedMessage = mapCharactersZeroWidth(originalMessage);
                return { content: modifiedMessage };
            }
        }
    ],

    chatBarButton: {
        icon: AntiFilterIcon as any,
        render: AntiFilterButton,
    },

    start() {
        addMessagePreSendListener(handleMessageSend);
        const { location } = settings.store;
        if (location === "headerbar") {
            addHeaderBarButton("AntiFilter", () => (
                <HeaderBarButton
                    icon={() => <AntiFilterIcon />}
                    tooltip={settings.store.isEnabled ? "AntiFilter: ON" : "AntiFilter: OFF"}
                    onClick={() => { settings.store.isEnabled = !settings.store.isEnabled; }}
                />
            ), 5);
        } else if (location === "channeltoolbar") {
            addChannelToolbarButton("AntiFilter", () => (
                <ChannelToolbarButton
                    icon={() => <AntiFilterIcon />}
                    tooltip={settings.store.isEnabled ? "AntiFilter: ON" : "AntiFilter: OFF"}
                    onClick={() => { settings.store.isEnabled = !settings.store.isEnabled; }}
                />
            ), 5);
        }
    },

    stop() {
        removeMessagePreSendListener(handleMessageSend);
        removeHeaderBarButton("AntiFilter");
        removeChannelToolbarButton("AntiFilter");
    },
});
