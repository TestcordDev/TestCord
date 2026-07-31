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

const frakturCharMap: Record<string, string> = {
    a: "𝔞", b: "𝔟", c: "𝔠", d: "𝔡", e: "𝔢", f: "𝔣", g: "𝔤", h: "𝔥", i: "𝔦", j: "𝔧", k: "𝔨", l: "𝔩", m: "𝔪", n: "𝔫", o: "𝔬", p: "𝔭", q: "𝔮", r: "𝔯", s: "𝔰", t: "𝔱", u: "𝔲", v: "𝔳", w: "𝔴", x: "𝔵", y: "𝔶", z: "𝔷",
    A: "𝔄", B: "𝔅", C: "ℭ", D: "𝔇", E: "𝔈", F: "𝔉", G: "𝔊", H: "ℌ", I: "ℑ", J: "𝔍", K: "𝔎", L: "𝔏", M: "𝔐", N: "𝔑", O: "𝔒", P: "𝔓", Q: "𝔔", R: "ℜ", S: "𝔖", T: "𝔗", U: "𝔘", V: "𝔙", W: "𝔚", X: "𝔛", Y: "𝔜", Z: "ℤ",
};

const squaredCharMap: Record<string, string> = {
    a: "🅰", b: "🅱", c: "🅲", d: "🅳", e: "🅴", f: "🅵", g: "🅶", h: "🅷", i: "🅸", j: "🅹", k: "🅺", l: "🅻", m: "🅼", n: "🅽", o: "🅾", p: "🅿", q: "🆀", r: "🆁", s: "🆂", t: "🆃", u: "🆄", v: "🆅", w: "🆆", x: "🆇", y: "🆈", z: "🆉",
    A: "🅰", B: "🅱", C: "🅲", D: "🅳", E: "🅴", F: "🅵", G: "🅶", H: "🅷", I: "🅸", J: "🅹", K: "🅺", L: "🅻", M: "🅼", N: "🅽", O: "🅾", P: "🅿", Q: "🆀", R: "🆁", S: "🆂", T: "🆃", U: "🆄", V: "🆅", W: "🆆", X: "🆇", Y: "🆈", Z: "🆉",
};

const circledCharMap: Record<string, string> = {
    a: "ⓐ", b: "ⓑ", c: "ⓒ", d: "ⓓ", e: "ⓔ", f: "ⓕ", g: "ⓖ", h: "ⓗ", i: "ⓘ", j: "ⓙ", k: "ⓚ", l: "ⓛ", m: "ⓜ", n: "ⓝ", o: "ⓞ", p: "ⓟ", q: "ⓠ", r: "ⓡ", s: "ⓢ", t: "ⓣ", u: "ⓤ", v: "ⓥ", w: "ⓦ", x: "ⓧ", y: "ⓨ", z: "ⓩ",
    A: "Ⓐ", B: "Ⓑ", C: "Ⓒ", D: "Ⓓ", E: "Ⓔ", F: "Ⓕ", G: "Ⓖ", H: "Ⓗ", I: "Ⓘ", J: "Ⓙ", K: "Ⓚ", L: "Ⓛ", M: "Ⓜ", N: "Ⓝ", O: "Ⓞ", P: "Ⓟ", Q: "Ⓠ", R: "Ⓡ", S: "Ⓢ", T: "Ⓣ", U: "Ⓤ", V: "Ⓥ", W: "Ⓦ", X: "Ⓧ", Y: "Ⓨ", Z: "Ⓩ",
};

const boldItalicCharMap: Record<string, string> = {
    a: "𝙖", b: "𝙗", c: "𝙘", d: "𝙙", e: "𝙚", f: "𝙛", g: "𝙜", h: "𝙝", i: "𝙞", j: "𝙟", k: "𝙠", l: "𝙡", m: "𝙢", n: "𝙣", o: "𝙤", p: "𝙥", q: "𝙦", r: "𝙧", s: "𝙨", t: "𝙩", u: "𝙪", v: "𝙫", w: "𝙬", x: "𝙭", y: "𝙮", z: "𝙯",
    A: "𝘼", B: "𝘽", C: "𝘾", D: "𝘿", E: "𝙀", F: "𝙁", G: "𝙂", H: "𝙃", I: "𝙄", J: "𝙅", K: "𝙆", L: "𝙇", M: "𝙈", N: "𝙉", O: "𝙊", P: "𝙋", Q: "𝙌", R: "𝙍", S: "𝙎", T: "𝙏", U: "𝙐", V: "𝙑", W: "𝙒", X: "𝙓", Y: "𝙔", Z: "𝙕",
};

const custom1CharMap: Record<string, string> = {
    Q: "Q", W: "Щ", E: "Σ", R: "Я", T: "Ƭ", Y: "Y", U: "Ц", I: "I", O: "Ө", P: "P", L: "ᄂ", K: "K", J: "J", H: "Ή", G: "G", F: "F", D: "Ƨ", S: "Λ", A: "A", Z: "Z", X: "X", C: "ᄃ", V: "V", B: "B", N: "П", M: "M",
    q: "q", w: "w", e: "e", r: "r", t: "t", y: "y", u: "u", i: "i", o: "o", p: "p", l: "l", k: "k", j: "j", h: "h", g: "g", f: "f", d: "d", s: "s", a: "a", z: "z", x: "x", c: "c", v: "v", b: "b", n: "n", m: "m",
};

const custom2CharMap: Record<string, string> = {
    Q: "Q", W: "₩", E: "Ɇ", R: "Ɽ", T: "₮", Y: "Ɏ", U: "Ʉ", I: "ł", O: "Ø", P: "₱", L: "Ⱡ", K: "₭", J: "J", H: "Ⱨ", G: "₲", F: "₣", D: "Đ", S: "₴", A: "₳", Z: "Ⱬ", X: "Ӿ", C: "₵", V: "V", B: "฿", N: "₦", M: "₥",
    q: "q", w: "w", e: "e", r: "r", t: "t", y: "y", u: "u", i: "i", o: "o", p: "p", l: "l", k: "k", j: "j", h: "h", g: "g", f: "f", d: "d", s: "s", a: "a", z: "z", x: "x", c: "c", v: "v", b: "b", n: "n", m: "m",
};

const custom3CharMap: Record<string, string> = {
    Q: "Ɋ", W: "山", E: "乇", R: "尺", T: "ㄒ", Y: "ㄚ", U: "ㄩ", I: "丨", O: "卩", P: "卩", L: "ㄥ", K: "Ҝ", J: "ﾌ", H: "卄", G: "Ꮆ", F: "千", D: "ᗪ", S: "丂", A: "卂", Z: "乙", X: "乂", C: "匚", V: "ᐯ", B: "乃", N: "几", M: "爪",
    q: "q", w: "w", e: "e", r: "r", t: "t", y: "y", u: "u", i: "i", o: "o", p: "p", l: "l", k: "k", j: "j", h: "h", g: "g", f: "f", d: "d", s: "s", a: "a", z: "z", x: "x", c: "c", v: "v", b: "b", n: "n", m: "m",
};

const fullWidthCharMap: Record<string, string> = {
    a: "ａ", b: "ｂ", c: "ｃ", d: "ｄ", e: "ｅ", f: "ｆ", g: "ｇ", h: "ｈ", i: "ｉ", j: "ｊ", k: "ｋ", l: "ｌ", m: "ｍ", n: "ｎ", o: "ｏ", p: "ｐ", q: "ｑ", r: "ｒ", s: "ｓ", t: "ｔ", u: "ｕ", v: "ｖ", w: "ｗ", x: "ｘ", y: "ｙ", z: "ｚ",
    A: "Ａ", B: "Ｂ", C: "Ｃ", D: "Ｄ", E: "Ｅ", F: "Ｆ", G: "Ｇ", H: "Ｈ", I: "Ｉ", J: "Ｊ", K: "Ｋ", L: "Ｌ", M: "Ｍ", N: "Ｎ", O: "Ｏ", P: "Ｐ", Q: "Ｑ", R: "Ｒ", S: "Ｓ", T: "Ｔ", U: "Ｕ", V: "Ｖ", W: "Ｗ", X: "Ｘ", Y: "Ｙ", Z: "Ｚ",
};

const strikethroughCharMap: Record<string, string> = {
    a: "a̶", b: "b̶", c: "c̶", d: "d̶", e: "e̶", f: "f̶", g: "g̶", h: "h̶", i: "i̶", j: "j̶", k: "k̶", l: "l̶", m: "m̶", n: "n̶", o: "o̶", p: "p̶", q: "q̶", r: "r̶", s: "s̶", t: "t̶", u: "u̶", v: "v̶", w: "w̶", x: "x̶", y: "y̶", z: "z̶",
    A: "A̶", B: "B̶", C: "C̶", D: "D̶", E: "E̶", F: "F̶", G: "G̶", H: "H̶", I: "I̶", J: "J̶", K: "K̶", L: "L̶", M: "M̶", N: "N̶", O: "O̶", P: "P̶", Q: "Q̶", R: "R̶", S: "S̶", T: "T̶", U: "U̶", V: "V̶", W: "W̶", X: "X̶", Y: "Y̶", Z: "Z̶",
};

const invisibleSeparatorCharMap: Record<string, string> = {
    a: "a⁠", b: "b⁠", c: "c⁠", d: "d⁠", e: "e⁠", f: "f⁠", g: "g⁠", h: "h⁠", i: "i⁠", j: "j⁠", k: "k⁠", l: "l⁠", m: "m⁠", n: "n⁠", o: "o⁠", p: "p⁠", q: "q⁠", r: "r⁠", s: "s⁠", t: "t⁠", u: "u⁠", v: "v⁠", w: "w⁠", x: "x⁠", y: "y⁠", z: "z⁠",
    A: "A⁠", B: "B⁠", C: "C⁠", D: "D⁠", E: "E⁠", F: "F⁠", G: "G⁠", H: "H⁠", I: "I⁠", J: "J⁠", K: "K⁠", L: "L⁠", M: "M⁠", N: "N⁠", O: "O⁠", P: "P⁠", Q: "Q⁠", R: "R⁠", S: "S⁠", T: "T⁠", U: "U⁠", V: "V⁠", W: "W⁠", X: "X⁠", Y: "Y⁠", Z: "Z⁠",
};

const undetectedCharMap: Record<string, string> = {
    q: "q⁠", w: "w⁠", е: "е⁠", r: "r⁠", т: "т⁠", у: "у⁠", ц: "ц⁠", і: "і⁠", о: "о⁠", р: "р⁠", l: "l⁠", к: "к⁠", ј: "ј⁠", н: "н⁠", g: "g⁠", f: "f⁠", d: "d⁠", ѕ: "ѕ⁠", а: "а⁠", ᴢ: "ᴢ⁠", х: "х⁠", с: "с⁠", v: "v⁠", Ь: "Ь⁠", п: "п⁠", м: "м⁠",
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
            { label: "Final Boss (Invisible + Zalgo)", value: "finalboss" },
            { label: "Fraktur (Gothic)", value: "fraktur" },
            { label: "Squared", value: "squared" },
            { label: "Circled", value: "circled" },
            { label: "Bold Italic", value: "boldItalic" },
            { label: "Custom Style 1", value: "custom1" },
            { label: "Custom Style 2", value: "custom2" },
            { label: "Custom Style 3", value: "custom3" },
            { label: "Full Width", value: "fullWidth" },
            { label: "Strikethrough", value: "strikethrough" },
            { label: "Invisible Separator", value: "invisibleSeparator" },
            { label: "Undetected", value: "undetected" }
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
        case "fraktur":
            return mapCharacters(text, frakturCharMap);
        case "squared":
            return mapCharacters(text, squaredCharMap);
        case "circled":
            return mapCharacters(text, circledCharMap);
        case "boldItalic":
            return mapCharacters(text, boldItalicCharMap);
        case "custom1":
            return mapCharacters(text, custom1CharMap);
        case "custom2":
            return mapCharacters(text, custom2CharMap);
        case "custom3":
            return mapCharacters(text, custom3CharMap);
        case "fullWidth":
            return mapCharacters(text, fullWidthCharMap);
        case "strikethrough":
            return mapCharacters(text, strikethroughCharMap);
        case "invisibleSeparator":
            return mapCharacters(text, invisibleSeparatorCharMap);
        case "undetected":
            return mapCharacters(text, undetectedCharMap);
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
    description: "Bypass automod filters using lookalike Unicode characters. Supports Fraktur, Squared, Circled, Bold Italic, custom styles, Full Width, Strikethrough, Invisible Separator, Undetected and more (credits to dot for givin me the dadscord bypass)",
    tags: ["Privacy", "Utility"],
    authors: [TestcordDevs.x2b, TestcordDevs.sirphantom89,
    { name: "dot", id: 1400610916285812776n }
    ],
    settings: settings,
    dependencies: ["ChatInputButtonAPI", "CommandsAPI", "MessageEventsAPI", "HeaderBarAPI"],

    commands: [
        {
            name: "antifilter",
            description: "Bypass automod using various Unicode text styles",
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
