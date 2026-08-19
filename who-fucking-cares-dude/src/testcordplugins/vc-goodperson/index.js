/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { FluxDispatcher } from "@webpack/common";
/** * SEXUAL ***/
const badVerbsSexual = ["fuck", "cum"];
const badNounsSexual = ["cunt", "yuri", "whore", "dick", "pussy", "slut", "tit", "cum", "cock", "blowjob", "sex", "ass", "furry", "bewbs", "boob", "booba", "boobies", "boobs", "booby", "porn", "pron", "pronhub", "r34", "rape", "raped", "raping", "rapist"];
/** * BRAINROT ***/
const badNounsBrainrot = ["mewing", "mew", "skibidi", "gyat", "gyatt", "rizzler", "nettspend", "boykisser", "ohio", "rizz", "tickle my toes bruh", "crack my spine like a whip", "hawk tuah"];
/** * SLURS ***/
const badNounsSlurs = ["retard", "faggot", "fag", "faggots", "fags", "retards", "n*g", "n*gg*", "n*gg*r"];
const badRegexesSlurs = ["\\bn{1,}(i|!|1){1,}(b|g){2,}(a|@|e|3){1,}?"];
/** * GENERAL ***/
const badVerbsGeneral = ["kill", "destroy"];
const badNounsGeneral = ["shit", "bullshit", "bitch", "bastard", "die", "brainless"];
/** * FUN ***/
const badNounsFun = ["kotlin", "avast"];
/** * REPLACEMENTS ***/
const badVerbsReplacements = ["love", "eat", "deconstruct", "marry", "fart", "teach", "display", "plug", "explode", "undress", "finish", "freeze", "beat", "free", "brush", "allocate", "date", "melt", "breed", "educate", "injure", "change"];
const badNounsReplacements = ["pasta", "kebab", "cake", "potato", "woman", "computer", "java", "hamburger", "monster truck", "osu!", "Ukrainian ball in search of gas game", "Anime", "Anime girl", "good", "keyboard", "NVIDIA RTX 3090 Graphics Card", "storm", "queen", "single", "umbrella", "mosque", "physics", "bath", "virus", "bathroom", "mom", "owner", "airport", "Avast Antivirus Free"];
const plugin = definePlugin({
    name: "GoodPerson",
    description: "Makes you (or others) a good person",
    tags: ["Utility", "Fun"],
    authors: [Devs.nin0dev, Devs.mantikafasi],
    dependencies: ["MessageEventsAPI"],
    settings: definePluginSettings({
        incoming: {
            type: 3 /* OptionType.BOOLEAN */,
            description: "Filter incoming messages",
            default: true
        },
        blockSexual: {
            type: 3 /* OptionType.BOOLEAN */,
            description: "Block sexual words/hornyspeak",
            default: true
        },
        blockBrainrot: {
            type: 3 /* OptionType.BOOLEAN */,
            description: "Block things commonly said by Gen Alpha children",
            default: true
        },
        blockSlurs: {
            type: 3 /* OptionType.BOOLEAN */,
            description: "Block targeted slurs",
            default: true
        },
        blockInsults: {
            type: 3 /* OptionType.BOOLEAN */,
            description: "Block more general insults",
            default: true
        },
        blockOthers: {
            type: 3 /* OptionType.BOOLEAN */,
            description: "Block words mantikafasi personally dislikes",
            default: true
        }
    }),
    onBeforeMessageSend: (c, msg) => {
        const newContent = plugin.replaceBadVerbs(plugin.replaceBadNouns(msg.content));
        msg.content = newContent;
    },
    getEnabledBadNouns() {
        const thingToReturn = [];
        if (this.settings.store.blockBrainrot)
            thingToReturn.push(...badNounsBrainrot);
        if (this.settings.store.blockInsults)
            thingToReturn.push(...badNounsGeneral);
        if (this.settings.store.blockOthers)
            thingToReturn.push(...badNounsFun);
        if (this.settings.store.blockSexual)
            thingToReturn.push(...badNounsSexual);
        if (this.settings.store.blockSlurs)
            thingToReturn.push(...badNounsSlurs);
        return thingToReturn;
    },
    getEnabledBadVerbs() {
        const thingToReturn = [];
        if (this.settings.store.blockSexual)
            thingToReturn.push(...badVerbsSexual);
        if (this.settings.store.blockInsults)
            thingToReturn.push(...badVerbsGeneral);
        return thingToReturn;
    },
    _nounRegex: null,
    _nounRegexKey: "",
    _verbRegex: null,
    _verbRegexKey: "",
    _settingsKey() {
        const s = this.settings.store;
        return `${s.blockBrainrot}|${s.blockInsults}|${s.blockOthers}|${s.blockSexual}|${s.blockSlurs}`;
    },
    getNounRegex() {
        const key = this._settingsKey();
        if (!this._nounRegex || this._nounRegexKey !== key) {
            this._nounRegex = new RegExp("\\b(" + this.getEnabledBadNouns().join("|") + ")\\b", "gi");
            this._nounRegexKey = key;
        }
        return this._nounRegex;
    },
    getVerbRegex() {
        const key = this._settingsKey();
        if (!this._verbRegex || this._verbRegexKey !== key) {
            this._verbRegex = new RegExp("\\b(" + this.getEnabledBadVerbs().join("|") + ")\\b", "gi");
            this._verbRegexKey = key;
        }
        return this._verbRegex;
    },
    replaceBadNouns(content) {
        const regex = this.getNounRegex();
        regex.lastIndex = 0;
        return content.replace(regex, function (match) {
            const randomIndex = Math.floor(Math.random() * badNounsReplacements.length);
            return badNounsReplacements[randomIndex];
        });
    },
    replaceBadVerbs(content) {
        const regex = this.getVerbRegex();
        regex.lastIndex = 0;
        return content.replace(regex, function (match) {
            const randomIndex = Math.floor(Math.random() * badVerbsReplacements.length);
            return badVerbsReplacements[randomIndex];
        });
    },
    flux: {
        async MESSAGE_CREATE({ guildId, message }) {
            if (plugin.settings?.store.incoming) {
                const msg = message;
                let newMessageContent = plugin.replaceBadVerbs(plugin.replaceBadNouns(msg.content));
                if (message.content !== newMessageContent) {
                    newMessageContent += "\n-# <:husk:1280158956341297225> **GoodPerson made this message good. Reload your client to clear changes**";
                    msg.content = newMessageContent;
                    FluxDispatcher.dispatch({
                        type: "MESSAGE_UPDATE",
                        message: msg,
                        guildId
                    });
                }
            }
        },
        async MESSAGE_UPDATE({ guildId, message }) {
            if (plugin.settings?.store.incoming) {
                const msg = message;
                if (msg.content.includes("-# <:husk:1280158956341297225> **GoodPerson made this message good. Reload your client to clear changes**"))
                    return;
                let newMessageContent = plugin.replaceBadVerbs(plugin.replaceBadNouns(msg.content));
                if (message.content !== newMessageContent) {
                    newMessageContent += "\n-# <:husk:1280158956341297225> **GoodPerson made this message good. Reload your client to clear changes**";
                    msg.content = newMessageContent;
                    FluxDispatcher.dispatch({
                        type: "MESSAGE_UPDATE",
                        message: msg,
                        guildId
                    });
                }
            }
        }
    }
});
export default plugin;
