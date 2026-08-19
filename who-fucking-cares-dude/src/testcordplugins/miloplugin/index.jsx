/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { ChatBarButton } from "@api/ChatButtons";
import { addMessagePreSendListener, removeMessagePreSendListener } from "@api/MessageEvents";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { React } from "@webpack/common";
// Word replacements
const wordMapFiltered = {
    // Pronouns / fun replacements (keep all, as they include symbols or numbers)
    I: "nya",
    you: "nyou",
    he: "he 0-0",
    she: "she -w-",
    we: "we OwO",
    they: "thwey :3",
    me: "Mwee",
    him: "Him",
    us: "us OwO",
    my: "Kittens",
    your: "Nyours",
    his: "his -w-",
    our: "nyaour",
    their: "thwey",
    mine: "Kittens",
    yours: "Masters",
    // Demonstratives / determiners with symbols/numbers
    that: "Nyat",
    this: "dis",
    these: "theze",
    those: "thoze",
    // Verbs with symbols/numbers
    love: "luv~",
    like: "lyk~",
    play: "play~",
    run: "run~",
    walk: "walkies~",
    eat: "nom~",
    drink: "sip~",
    // Nouns with symbols/numbers
    man: "Daddy~",
    part: "pwart",
    eye: "eyenya",
    government: "gov~",
    company: "comp~",
    home: "home~",
    room: "room~",
    mother: "mommy~",
    father: "daddy~",
    friend: "friend~",
    family: "fam~",
    story: "story~",
    health: "health~",
    president: "pres~",
    x2b: "fatass",
    money: "mwoney :3",
    cat: "nyan~",
    dog: "woof~",
    food: "nom~",
    // Adjectives with flair
    own: "own~",
    different: "diff~",
    early: "early~",
    public: "public~",
    bad: "bad~",
    major: "majr~",
    clear: "clear~",
    special: "spec~",
    cute: "kawaii~",
    happy: "happy~",
    funny: "funny~",
    // Adverbs / connectors with flair
    as_if: "as if~",
    as_long_as: "as long as~",
    as_much_as: "as much as~",
    as_soon_as: "as soon as~",
    even_if: "even if~",
    even_though: "even tho~",
    if_only: "if only~",
    in_order_that: "so that~",
    once: "once~",
    provided_that: "provided~",
    rather_than: "rather~",
    until: "until~",
    when: "when~",
    whenever: "whenever~",
    nevertheless: "neverthless~",
    nonetheless: "nonetheless~",
    assuming: "assum~",
    supposing: "suppose~",
    // Fun extras
    yes: "yep~",
    no: "nop~",
    ok: "okie~",
    thanks: "thx~",
    welcome: "welc~",
    hey: "hewwo~",
    hello: "hewwo~",
    bye: "bai~",
    party: "party~",
    lol: "lol~",
    omg: "omg~",
    wow: "wow~",
};
const cuteFaces = ["OwO", "UwU", "-w-", ":3", ";3c", ";3", "qwq", "0w0", "'w'", "-3-"];
const mapWords = (text, wordMap) => {
    return text.split(/(\s+)/).map(part => {
        if (/^\s+$/.test(part))
            return part;
        const lower = part.toLowerCase();
        if (wordMap[lower])
            return wordMap[lower];
        return part;
    }).join("");
};
const addRandomFaces = (text, chance = 0.3) => {
    const words = text.split(/(\s+)/);
    const result = [];
    let hasFace = false;
    for (const part of words) {
        if (/^\s+$/.test(part)) {
            result.push(part);
            continue;
        }
        if (Math.random() < chance) {
            const face = cuteFaces[Math.floor(Math.random() * cuteFaces.length)];
            result.push(part + " " + face);
            hasFace = true;
        }
        else {
            result.push(part);
        }
    }
    if (!hasFace && words.some(w => !/^\s+$/.test(w))) {
        const face = cuteFaces[Math.floor(Math.random() * cuteFaces.length)];
        result.push(" " + face);
    }
    return result.join("");
};
// tekst - DO NAPRAWY
const sillyKittenTransform = (text) => {
    const mapped = mapWords(text, wordMapFiltered);
    return addRandomFaces(mapped);
};
const settings = definePluginSettings({
    location: {
        type: 4 /* OptionType.SELECT */,
        description: "Where to show the button",
        options: [
            { label: "Chat bar", value: "chatbar", default: true },
            { label: "Header bar", value: "headerbar" },
            { label: "Channel toolbar", value: "channeltoolbar" },
            { label: "Disabled", value: "disabled" },
        ],
        restartNeeded: true,
    },
    sillyMode: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Enable Silly Kitten mode!~~",
        default: false
    }
});
function handleMessageSend(channelId, messageObj) {
    if (!settings.store.sillyMode)
        return;
    if (messageObj.content) {
        messageObj.content = sillyKittenTransform(messageObj.content);
    }
}
// Chat bar button
const SillyKittenButton = ({ isMainChat }) => {
    if (!isMainChat)
        return null;
    const { sillyMode } = settings.use(["sillyMode"]);
    return (<ChatBarButton tooltip={sillyMode ? "Silly Kitten: ON" : "Silly Kitten: OFF"} onClick={() => { settings.store.sillyMode = !settings.store.sillyMode; }}>
            <svg width="20" height="20" viewBox="0 0 24 24" style={{ color: sillyMode ? "#da373c" : "currentColor" }}>
                {sillyMode ? (<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>) : (<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z"/>)}
            </svg>
        </ChatBarButton>);
};
// Export plugin
export default definePlugin({
    name: "Silly Kitten",
    description: "Transform your messages into cute silly kitten text! >w<",
    tags: ["Utility", "Fun"],
    authors: [TestcordDevs.x2b, TestcordDevs.milo],
    settings: settings,
    dependencies: ["ChatInputButtonAPI"],
    start() {
        addMessagePreSendListener(handleMessageSend);
    },
    stop() {
        removeMessagePreSendListener(handleMessageSend);
    },
    renderChatBarButton: SillyKittenButton
});
