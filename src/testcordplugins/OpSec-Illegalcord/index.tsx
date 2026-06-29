/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";

const settings = definePluginSettings({
    enable: {
        type: OptionType.BOOLEAN,
        description: "Enable autocorrect",
        default: true,
        restartNeeded: false
    },
    fixSpaces: {
        type: OptionType.BOOLEAN,
        description: "Fix double spaces to single space",
        default: true,
        restartNeeded: false
    },
    fixQuotes: {
        type: OptionType.BOOLEAN,
        description: "Convert straight quotes to curly quotes",
        default: true,
        restartNeeded: false
    },
    fixContractions: {
        type: OptionType.BOOLEAN,
        description: "Fix contractions (dont -> don't, cant -> can't)",
        default: true,
        restartNeeded: false
    },
    fixCapitalization: {
        type: OptionType.BOOLEAN,
        description: "Capitalize first letter of sentences",
        default: true,
        restartNeeded: false
    },
    addPeriod: {
        type: OptionType.BOOLEAN,
        description: "Add period if sentence has no ending punctuation",
        default: true,
        restartNeeded: false
    },
    customReplacements: {
        type: OptionType.STRING,
        description: "Custom word replacements (format: word=replacement, one per line)",
        default: "zman1064=dumbass",
        restartNeeded: false
    },
    contextualCorrection: {
        type: OptionType.BOOLEAN,
        description: "Use context (replies, nearby messages) to find corrections",
        default: true,
        restartNeeded: false
    },
    contextualWindow: {
        type: OptionType.NUMBER,
        description: "How many recent messages to scan for context (1-20)",
        default: 5,
        restartNeeded: false
    },
    enableItalian: {
        type: OptionType.BOOLEAN,
        description: "Enable Italian language support (supporto per la lingua italiana)",
        default: false,
        restartNeeded: false
    },
    fixItalianAccents: {
        type: OptionType.BOOLEAN,
        description: "Fix Italian accents (perche -> perché, cioe -> cioè)",
        default: true,
        restartNeeded: false
    },
    enableEnglish: {
        type: OptionType.BOOLEAN,
        description: "Enable English language corrections",
        default: true,
        restartNeeded: false
    }
});

function levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];

    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }

    return matrix[b.length][a.length];
}

function getContextVocabulary(message: any): Set<string> {
    const vocab = new Set<string>();

    if (message?.content) {
        const words = message.content.toLowerCase().match(/[a-zA-Z]+/g) || [];
        words.forEach(w => vocab.add(w));
    }

    if (message?.messageReference?.message_id) {
        const MessageStore = (window as any).DiscordModules?.MessageStore;
        if (MessageStore) {
            try {
                const refMsg = MessageStore.getMessage(message.messageReference.message_id);
                if (refMsg?.content) {
                    const words = refMsg.content.toLowerCase().match(/[a-zA-Z]+/g) || [];
                    words.forEach((w: string) => vocab.add(w));
                }
            } catch { }
        }
    }

    return vocab;
}

function findContextCorrections(text: string, vocab: Set<string>): Map<string, string> {
    const corrections = new Map<string, string>();
    const words = text.match(/[a-zA-Z]+/g) || [];
    const knownMisspellings = new Set([
        "dont", "cant", "wont", "isnt", "arent", "wasnt", "werent",
        "hasnt", "havent", "hadnt", "doesnt", "didnt", "shouldnt", "wouldnt", "couldnt",
        "im", "ive", "id", "ill", "youre", "youve", "youd", "youll",
        "hes", "hed", "hell", "shes", "shes", "shed", "shell",
        "its", "itll", "weve", "wed", "well", "were",
        "theyre", "theyd", "theyll", "theyve", "thats", "thatll", "whats",
        "lets", "wanna", "gonna", "gotta", "kinda", "sorta", "lotta",
        "teh", "recieve", "seperate", "occured", "definately", "enviroment",
        "goverment", "neccessary", "bassicly", "liek", "trynig", "fuccking"
    ]);

    for (const word of words) {
        const lowerWord = word.toLowerCase();

        if (knownMisspellings.has(lowerWord)) continue;

        if (vocab.has(lowerWord)) continue;

        let bestMatch: string | null = null;
        let bestDistance = Infinity;

        for (const known of vocab) {
            if (known.length < 2 || lowerWord.length < 2) continue;

            const maxDist = Math.max(1, Math.floor(Math.min(known.length, lowerWord.length) / 3));
            if (Math.abs(known.length - lowerWord.length) > maxDist) continue;

            const dist = levenshteinDistance(lowerWord, known);

            if (dist > 0 && dist <= maxDist) {
                if (dist < bestDistance) {
                    bestDistance = dist;
                    bestMatch = known;
                }
            }
        }

        if (bestMatch) {
            corrections.set(lowerWord, bestMatch);
        }
    }

    return corrections;
}

function applyContextCorrections(text: string, corrections: Map<string, string>): string {
    let result = text;

    for (const [misspelled, correct] of corrections) {
        const regex = new RegExp(`\\b${misspelled}\\b`, "gi");
        result = result.replace(regex, match => {
            if (match[0] === match[0].toUpperCase()) {
                return correct.charAt(0).toUpperCase() + correct.slice(1);
            }
            return correct;
        });
    }

    return result;
}

function isSlang(text: string): boolean {
    const slangPatterns = [
        /\blol\b/i,
        /\blmao\b/i,
        /\brofl\b/i,
        /\bwth\b/i,
        /\bwtf\b/i,
        /\bidk\b/i,
        /\bimo\b/i,
        /\bngl\b/i,
        /\btbh\b/i,
        /\bsmh\b/i,
        /\bhbu\b/i,
        /\bhru\b/i,
        /\bsrsly\b/i,
        /\bfr\b/i,
        /\bfrfr\b/i,
        /\byo\b/i,
        /\byall\b/i,
        /\bya\b/i,
        /\bnvm\b/i,
        /\bimo\b/i,
        /\bomg\b/i,
        /\bjk\b/i,
        /\blmk\b/i,
        /\bily\b/i,
        /\bily2k\b/i,
        /\bbrb\b/i,
        /\bgtg\b/i,
        /\bafk\b/i,
        /\bikr\b/i,
        /\bwbu\b/i,
        /\bbff\b/i,
        /\bffs\b/i,
        /\bftw\b/i,
        /\bftb\b/i,
        /\bppl\b/i,
        /\bstr8\b/i,
        /\bstr8\b/i,
        /\bcul8r\b/i,
        /\bgr8\b/i,
        /\b2day\b/i,
        /\b2moro\b/i,
        /\b2nite\b/i,
        /\bb4\b/i,
        /\bl8r\b/i,
        /\bc ya\b/i,
        /\bnoob\b/i,
        /\bn00b\b/i,
        /\bnewb\b/i,
        /\bhax\b/i,
        /\bhaxor\b/i,
        /\bskr\b/i,
        /\bsmh\b/i,
        /\bdw\b/i,
        /\bsrsly\b/i,
        /\birl\b/i,
        /\basap\b/i,
        /\bfyi\b/i,
        /\bnvm\b/i,
        // Italian slang
        /\bboh\b/i,
        /\bva bè\b/i,
        /\bvabbè\b/i,
        /\babbasta\b/i,
        /\bniente\b/i,
        /\bninte\b/i,
        /\bdai\b/i,
        /\bandiamo\b/i,
        /\bstai\b/i,
        /\bbasta\b/i,
        /\bfigo\b/i,
        /\bforte\b/i,
        /\bcazzo\b/i,
        /\bmerda\b/i,
        /\bporco\b/i,
        /\bmadonna\b/i,
        /\bdaiii\b/i,
        /\bmah\b/i,
        /\beh\b/i,
        /\boh\b/i,
        /\bah\b/i,
    ];

    const lowerText = text.toLowerCase();
    let slangCount = 0;
    const totalWords = lowerText.split(/\s+/).length;

    for (const pattern of slangPatterns) {
        if (pattern.test(lowerText)) slangCount++;
    }

    if (totalWords === 0) return false;

    const slangRatio = slangCount / totalWords;
    return slangRatio > 0.15;
}

function getCustomReplacements(): [RegExp, string][] {
    const text = settings.store.customReplacements || "";
    const lines = text.split("\n").filter(line => line.includes("="));

    return lines.map(line => {
        const [word, replacement] = line.split("=").map(s => s.trim());
        if (word && replacement) {
            return [new RegExp(`\\b${word}\\b`, "gi"), replacement] as [RegExp, string];
        }
        return null;
    }).filter(Boolean) as [RegExp, string][];
}

const CONTRACTIONS: [RegExp, string][] = [
    [/\bim\b/gi, "I'm"],
    [/\bive\b/gi, "I've"],
    [/\bid\b/gi, "I'd"],
    [/\bill\b/gi, "I'll"],
    [/\byoure\b/gi, "you're"],
    [/\byouve\b/gi, "you've"],
    [/\byoud\b/gi, "you'd"],
    [/\byoull\b/gi, "you'll"],
    [/\bhes\b/gi, "he's"],
    [/\bhed\b/gi, "he'd"],
    [/\bhell\b/gi, "he'll"],
    [/\bshes\b/gi, "she's"],
    [/\bshed\b/gi, "she'd"],
    [/\bshell\b/gi, "she'll"],
    [/\bits\b/gi, "it's"],
    [/\bitll\b/gi, "it'll"],
    [/\bwere\b/gi, "we're"],
    [/\bweve\b/gi, "we've"],
    [/\bwed\b/gi, "we'd"],
    [/\bwell\b/gi, "we'll"],
    [/\btheyre\b/gi, "they're"],
    [/\btheyve\b/gi, "they've"],
    [/\btheyd\b/gi, "they'd"],
    [/\btheyll\b/gi, "they'll"],
    [/\bwhos\b/gi, "who's"],
    [/\bwhod\b/gi, "who'd"],
    [/\bwholl\b/gi, "who'll"],
    [/\bwhats\b/gi, "what's"],
    [/\bwhatd\b/gi, "what'd"],
    [/\bwhatll\b/gi, "what'll"],
    [/\bwhens\b/gi, "when's"],
    [/\bwhend\b/gi, "when'd"],
    [/\bwhenll\b/gi, "when'll"],
    [/\bwheres\b/gi, "where's"],
    [/\bwhered\b/gi, "where'd"],
    [/\bwherell\b/gi, "where'll"],
    [/\bhows\b/gi, "how's"],
    [/\bhowd\b/gi, "how'd"],
    [/\bhowll\b/gi, "how'll"],
    [/\bthats\b/gi, "that's"],
    [/\bthatll\b/gi, "that'll"],
    [/\btheres\b/gi, "there's"],
    [/\btherell\b/gi, "there'll"],
    [/\beres\b/gi, "here's"],
    [/\bheres\b/gi, "here's"],
    [/\blets\b/gi, "let's"],
    [/\bcant\b/gi, "can't"],
    [/\bwont\b/gi, "won't"],
    [/\bwouldnt\b/gi, "wouldn't"],
    [/\bcouldnt\b/gi, "couldn't"],
    [/\bshouldnt\b/gi, "shouldn't"],
    [/\bisnt\b/gi, "isn't"],
    [/\barent\b/gi, "aren't"],
    [/\bwasnt\b/gi, "wasn't"],
    [/\bwerent\b/gi, "weren't"],
    [/\bhasnt\b/gi, "hasn't"],
    [/\bhavent\b/gi, "haven't"],
    [/\bhadnt\b/gi, "hadn't"],
    [/\bdoesnt\b/gi, "doesn't"],
    [/\bdidnt\b/gi, "didn't"],
    [/\bdont\b/gi, "don't"],
    [/\baint\b/gi, "ain't"],
    [/\bdidnt\b/gi, "didn't"],
    [/\bneednt\b/gi, "needn't"],
    [/\bmustnt\b/gi, "mustn't"],
    [/\bhadnt\b/gi, "hadn't"],
];

const ITALIAN_CONTRACTIONS: [RegExp, string][] = [
    [/\bc\u00e8\b/gi, "c'è"],
    [/\bc\u00e8\b/gi, "c'è"],
    [/\bl\u00e8\b/gi, "l'è"],
    [/\bm\u00e8\b/gi, "m'è"],
    [/\bt\u00e8\b/gi, "t'è"],
    [/\bs\u00e8\b/gi, "s'è"],
    [/\bn\u00e8\b/gi, "n'è"],
    [/\bv\u00e8\b/gi, "v'è"],
    [/\bl\u00f2\b/gi, "l'ò"],
    [/\bl\u00e0\b/gi, "l'à"],
    [/\bm\u00e0\b/gi, "m'à"],
    [/\bt\u00e0\b/gi, "t'à"],
    [/\bn\u00e0\b/gi, "n'à"],
    [/\bs\u00e0\b/gi, "s'à"],
    [/\bv\u00e0\b/gi, "v'à"],
    [/\bpo\b/gi, "po'"],
    [/\bmo\b/gi, "mo'"],
    [/\bda\b/gi, "da'"],
    [/\bfa\b/gi, "fa'"],
    [/\bsta\b/gi, "sta'"],
    [/\bva\b/gi, "va'"],
    [/\bdia\b/gi, "dia'"],
    [/\bdie\b/gi, "die'"],
    [/\bpie\b/gi, "pie'"],
    [/\bzie\b/gi, "zie'"],
    [/\bgie\b/gi, "gie'"],
    [/\bbie\b/gi, "bie'"],
    [/\bcie\b/gi, "cie'"],
    [/\blie\b/gi, "lie'"],
    [/\bmie\b/gi, "mie'"],
    [/\bdue\b/gi, "due'"],
    [/\bre\b/gi, "re'"],
    [/\blu\b/gi, "lu'"],
    [/\bli\b/gi, "li'"],
    [/\bla\b/gi, "la'"],
    [/\ble\b/gi, "le'"],
    [/\blo\b/gi, "lo'"],
    [/\bun\b/gi, "un'"],
    [/\bqual\b/gi, "qual'"],
    [/\btal\b/gi, "tal'"],
    [/\bqual\b/gi, "qual'"],
    [/\bciao\b/gi, "ciao!"],
    [/\bbuon giorno\b/gi, "buongiorno"],
    [/\bbuona sera\b/gi, "buonasera"],
    [/\bbuona notte\b/gi, "buonanotte"],
    [/\bperche\b/gi, "perché"],
    [/\bcome\b/gi, "come"],
    [/\bdove\b/gi, "dove"],
    [/\bquale\b/gi, "quale"],
    [/\bquanto\b/gi, "quanto"],
    [/\bquando\b/gi, "quando"],
    [/\bperche\b/gi, "perché"],
    [/\bse\b/gi, "se"],
    [/\bma\b/gi, "ma"],
    [/\bo\b/gi, "o"],
    [/\be\b/gi, "e"],
    [/\bche\b/gi, "che"],
    [/\bchi\b/gi, "chi"],
    [/\bcui\b/gi, "cui"],
    [/\bcosa\b/gi, "cosa"],
    [/\bnon\b/gi, "non"],
    [/\bno\b/gi, "no"],
    [/\bsi\b/gi, "sì"],
    [/\bne\b/gi, "ne"],
    [/\bci\b/gi, "ci"],
    [/\bvi\b/gi, "vi"],
    [/\bli\b/gi, "li"],
    [/\ble\b/gi, "le"],
    [/\bmi\b/gi, "mi"],
    [/\bti\b/gi, "ti"],
    [/\bsi\b/gi, "si"],
    [/\bgli\b/gi, "gli"],
    [/\ble\b/gi, "le"],
    [/\blo\b/gi, "lo"],
    [/\bun\b/gi, "un"],
    [/\buna\b/gi, "una"],
    [/\buno\b/gi, "uno"],
    [/\bdei\b/gi, "dei"],
    [/\bdelle\b/gi, "delle"],
    [/\bdello\b/gi, "dello"],
    [/\bdella\b/gi, "della"],
    [/\bdagli\b/gi, "dagli"],
    [/\bdalle\b/gi, "dalle"],
    [/\bdal\b/gi, "dal"],
    [/\bdei\b/gi, "dei"],
    [/\bnel\b/gi, "nel"],
    [/\bnella\b/gi, "nella"],
    [/\bnei\b/gi, "nei"],
    [/\bnelle\b/gi, "nelle"],
    [/\bnello\b/gi, "nello"],
    [/\bsul\b/gi, "sul"],
    [/\bsulla\b/gi, "sulla"],
    [/\bsui\b/gi, "sui"],
    [/\bsulle\b/gi, "sulle"],
    [/\bsullo\b/gi, "sullo"],
    [/\ball\b/gi, "all'"],
    [/\bdall\b/gi, "dall'"],
    [/\bnell\b/gi, "nell'"],
    [/\bsull\b/gi, "sull'"],
    [/\bcoll\b/gi, "coll'"],
];

function fixPossessive(text: string): string {
    return text.replace(/\b([A-Z][a-z]+)([a-z])\b/g, (match, name, lastChar) => {
        if (/[aeiouyAEIOUY]/.test(lastChar)) {
            return name + lastChar + "'";
        }
        return name + lastChar + "'s";
    });
}

const COMMON_MISSPELLINGS: [RegExp, string | ((match: string) => string)][] = [
    [/\bi\b/g, "I"],
    [/\bteh\b/gi, "the"],
    [/\bliek\b/gi, "like"],
    [/\blieing\b/gi, "lying"],
    [/\blie\b/gi, "lie"],
    [/\blieng\b/gi, "lying"],
    [/\bbassicly\b/gi, "basically"],
    [/\bbaiscally\b/gi, "basically"],
    [/\bbasicaly\b/gi, "basically"],
    [/\brecieve\b/gi, "receive"],
    [/\brecieveing\b/gi, "receiving"],
    [/\bpaticular\b/gi, "particular"],
    [/\bseperate\b/gi, "separate"],
    [/\bseperately\b/gi, "separately"],
    [/\boccured\b/gi, "occurred"],
    [/\boccuring\b/gi, "occurring"],
    [/\buntill\b/gi, "until"],
    [/\boccurrance\b/gi, "occurrence"],
    [/\bremembeer\b/gi, "remember"],
    [/\bdefinately\b/gi, "definitely"],
    [/\boccassion\b/gi, "occasion"],
    [/\boccassional\b/gi, "occasional"],
    [/\bgoverment\b/gi, "government"],
    [/\benviroment\b/gi, "environment"],
    [/\bpriveleges\b/gi, "privileges"],
    [/\bpriviledge\b/gi, "privilege"],
    [/\bneccessary\b/gi, "necessary"],
    [/\bneccessarily\b/gi, "necessarily"],
    [/\bsuccesful\b/gi, "successful"],
    [/\bsuccesfully\b/gi, "successfully"],
    [/\bsurprize\b/gi, "surprise"],
    [/\bsurprized\b/gi, "surprised"],
    [/\bmispell\b/gi, "misspell"],
    [/\bmisspeled\b/gi, "misspelled"],
    [/\bforeighn\b/gi, "foreign"],
    [/\bforiegn\b/gi, "foreign"],
    [/\bindependant\b/gi, "independent"],
    [/\bindependantly\b/gi, "independently"],
    [/\bcalender\b/gi, "calendar"],
    [/\bremmember\b/gi, "remember"],
    [/\bacheive\b/gi, "achieve"],
    [/\bacheived\b/gi, "achieved"],
    [/\bacheiving\b/gi, "achieving"],
    [/\baccomodate\b/gi, "accommodate"],
    [/\baccomodation\b/gi, "accommodation"],
    [/\bacomplish\b/gi, "accomplish"],
    [/\bacomplished\b/gi, "accomplished"],
    [/\brecomend\b/gi, "recommend"],
    [/\brecomended\b/gi, "recommended"],
    [/\bbeginning\b/gi, "beginning"],
    [/\bbeggining\b/gi, "beginning"],
    [/\bbegining\b/gi, "beginning"],
    [/\bconsistant\b/gi, "consistent"],
    [/\bconsistantly\b/gi, "consistently"],
    [/\bsucess\b/gi, "success"],
    [/\bsucessful\b/gi, "successful"],
    [/\bbenefitted\b/gi, "benefited"],
    [/\bbenifited\b/gi, "benefited"],
    [/\bdefinatly\b/gi, "definitely"],
    [/\bgoverner\b/gi, "governor"],
    [/\bgrammer\b/gi, "grammar"],
    [/\bhappend\b/gi, "happened"],
    [/\bimmediatly\b/gi, "immediately"],
    [/\bimmedietly\b/gi, "immediately"],
    [/\bintresting\b/gi, "interesting"],
    [/\blittel\b/gi, "little"],
    [/\bmispelling\b/gi, "misspelling"],
    [/\bnoticable\b/gi, "noticeable"],
    [/\bnoticably\b/gi, "noticeably"],
    [/\bpersistant\b/gi, "persistent"],
    [/\bpossable\b/gi, "possible"],
    [/\bposible\b/gi, "possible"],
    [/\bprobly\b/gi, "probably"],
    [/\brealy\b/gi, "really"],
    [/\brember\b/gi, "remember"],
    [/\bsuprise\b/gi, "surprise"],
    [/\btommorow\b/gi, "tomorrow"],
    [/\btomorow\b/gi, "tomorrow"],
    [/\btruely\b/gi, "truly"],
    [/\busefull\b/gi, "useful"],
    [/\bwritting\b/gi, "writing"],
    [/\byourself\b/gi, "yourself"],
    [/\btrynig\b/gi, "trying"],
    [/\btryin\b/gi, "trying"],
    [/\btryign\b/gi, "trying"],
    [/\btryng\b/gi, "trying"],
    [/\bfuccking\b/gi, "fucking"],
    [/\bfucking\b/gi, "fucking"],
    [/\bfukcing\b/gi, "fucking"],
    [/\bfucking\b/gi, "fucking"],
    [/\bfuking\b/gi, "fucking"],
    [/\bphuking\b/gi, "fucking"],
    [/\bfucc\b/gi, "fuck"],
    [/\bfuk\b/gi, "fuck"],
    [/\bfuckng\b/gi, "fucking"],
    [/\bwassup\b/gi, "what's up"],
    [/\bwassup\b/gi, "what's up"],
    [/\bwhatsup\b/gi, "what's up"],
    [/\bwassup\b/gi, "what's up"],
    [/\bsup\b/gi, "what's up"],
    [/\bnormie\b/gi, "normie"],
    [/\bnormies\b/gi, "normies"],
    [/\bselfie\b/gi, "selfie"],
    [/\bselfies\b/gi, "selfies"],
    [/\bhmu\b/gi, "hit me up"],
    [/\bbtw\b/gi, "by the way"],
    [/\bidk\b/gi, "I don't know"],
    [/\bimo\b/gi, "in my opinion"],
    [/\bimho\b/gi, "in my humble opinion"],
    [/\birl\b/gi, "in real life"],
    [/\basap\b/gi, "as soon as possible"],
    [/\bfyi\b/gi, "for your information"],
    [/\brly\b/gi, "really"],
    [/\bomg\b/gi, "oh my god"],
    [/\bwtf\b/gi, "what the fuck"],
    [/\bwth\b/gi, "what the hell"],
    [/\blol\b/gi, "laughing out loud"],
    [/\blmao\b/gi, "laughing my ass off"],
    [/\brofl\b/gi, "rolling on the floor laughing"],
    [/\bbruh\b/gi, "bro"],
    [/\bbruh\b/gi, "bro"],
    [/\breeee\b/gi, "ree"],
    [/\bngl\b/gi, "not gonna lie"],
    [/\bsmh\b/gi, "shaking my head"],
    [/\bfomo\b/gi, "fear of missing out"],
    [/\byolo\b/gi, "you only live once"],
    [/\btbh\b/gi, "to be honest"],
    [/\bikr\b/gi, "I know, right"],
    [/\bihv\b/gi, "I have"],
    [/\bjdib\b/gi, "just doing my business"],
    [/\bhbd\b/gi, "happy birthday"],
    [/\bgg\b/gi, "good game"],
    [/\bgn\b/gi, "good night"],
    [/\bgm\b/gi, "good morning"],
    [/\bily\b/gi, "I love you"],
    [/\bsry\b/gi, "sorry"],
    [/\btho\b/gi, "though"],
    [/\bthru\b/gi, "through"],
    [/\bwanna\b/gi, "want to"],
    [/\bgonna\b/gi, "going to"],
    [/\bgotta\b/gi, "got to"],
    [/\bkinda\b/gi, "kind of"],
    [/\bsorta\b/gi, "sort of"],
    [/\blotta\b/gi, "lot of"],
    [/\boutta\b/gi, "out of"],
    [/\bdunno\b/gi, "don't know"],
    [/\bcuz\b/gi, "because"],
    [/\bcoz\b/gi, "because"],
    [/\bcause\b/gi, "because"],
    [/\blemme\b/gi, "let me"],
    [/\bgimme\b/gi, "give me"],
    [/\bwontcha\b/gi, "won't you"],
    [/\bdontcha\b/gi, "don't you"],
    [/\bcantcha\b/gi, "can't you"],
    [/\bwouldntcha\b/gi, "wouldn't you"],
    [/\blmao\b/gi, "laughing my ass off"],
    [/\bgettin\b/gi, "getting"],
    [/\bgoin\b/gi, "going"],
    [/\bdoin\b/gi, "doing"],
    [/\bwatchin\b/gi, "watching"],
    [/\blistenin\b/gi, "listening"],
    [/\bfixin\b/gi, "fixing"],
    [/\bneeda\b/gi, "need to"],
    [/\bgotsta\b/gi, "got to"],
    [/\bhafta\b/gi, "have to"],
    [/\bmusta\b/gi, "must have"],
    [/\bainta\b/gi, "isn't a"],
    [/\bwhered\b/gi, "where did"],
    [/\bwhend\b/gi, "when did"],
    [/\bwhod\b/gi, "who did"],
    [/\bhowd\b/gi, "how did"],
    [/\blets\b/gi, "let's"],
    [/\byall\b/gi, "y'all"],
    [/\byalls\b/gi, "y'all's"],
    [/\bna\b/gi, "not a"],
    [/\bwan\b/gi, "want"],
    [/\bwerkin\b/gi, "working"],
    [/\brelly\b/gi, "really"],
    [/\bevry\b/gi, "every"],
    [/\bevery1\b/gi, "everyone"],
    [/\beverybody1\b/gi, "everybody"],
    [/\bevryone\b/gi, "everyone"],
    [/\bevery1\b/gi, "everyone"],
    [/\bnothin\b/gi, "nothing"],
    [/\banythin\b/gi, "anything"],
    [/\bsumthin\b/gi, "something"],
    [/\bno1\b/gi, "no one"],
    [/\bnobdy\b/gi, "nobody"],
    [/\bsome1\b/gi, "someone"],
    [/\bsomebody1\b/gi, "somebody"],
    [/\bsum1\b/gi, "someone"],
    [/\bpls\b/gi, "please"],
    [/\bplz\b/gi, "please"],
    [/\bpleez\b/gi, "please"],
    [/\bcmon\b/gi, "come on"],
    [/\bcomon\b/gi, "come on"],
    [/\bcomin\b/gi, "coming"],
    [/\bcummin\b/gi, "coming"],
    [/\bovr\b/gi, "over"],
    [/\bovous\b/gi, "over us"],
    [/\bluv\b/gi, "love"],
    [/\bwuv\b/gi, "love"],
    [/\bwuvv\b/gi, "love"],
    [/\bdef\b/gi, "definitely"],
    [/\bdeffo\b/gi, "definitely"],
    [/\bdefo\b/gi, "definitely"],
    [/\bprobs\b/gi, "probably"],
    [/\bmaybe\b/gi, "maybe"],
    [/\bkinda\b/gi, "kind of"],
    [/\bsorta\b/gi, "sort of"],
    [/\balot\b/gi, "a lot"],
    [/\balol\b/gi, "a lot"],
    [/\bguys\b/gi, "guys"],
    [/\bgais\b/gi, "guys"],
    [/\bguyz\b/gi, "guys"],
    [/\byall\b/gi, "y'all"],
    [/\byalll\b/gi, "y'all"],
    [/\byouall\b/gi, "you all"],
    [/\bya\b/gi, "you"],
    [/\byall\b/gi, "y'all"],
    [/\btheyre\b/gi, "they're"],
    [/\btheyll\b/gi, "they'll"],
    [/\btheyd\b/gi, "they'd"],
    [/\btheyd\b/gi, "they would"],
    [/\btheyv\b/gi, "they've"],
    [/\bthats\b/gi, "that's"],
    [/\bthatll\b/gi, "that'll"],
    [/\bthatd\b/gi, "that'd"],
    [/\bthats\b/gi, "that's"],
    [/\bwhos\b/gi, "who's"],
    [/\bwholl\b/gi, "who'll"],
    [/\bwhod\b/gi, "who'd"],
    [/\bwhos\b/gi, "who is"],
    [/\bwheres\b/gi, "where's"],
    [/\bwhereve\b/gi, "wherever"],
    [/\bwhens\b/gi, "when's"],
    [/\bwhens\b/gi, "when is"],
    [/\bhows\b/gi, "how's"],
    [/\bhowll\b/gi, "how'll"],
    [/\bhowd\b/gi, "how'd"],
    [/\bwhats\b/gi, "what's"],
    [/\bwhatll\b/gi, "what'll"],
    [/\bwhatd\b/gi, "what'd"],
    [/\bwhats\b/gi, "what is"],
    [/\bits\b/gi, "it's"],
    [/\bitll\b/gi, "it'll"],
    [/\bitd\b/gi, "it'd"],
    [/\bits\b/gi, "it is"],
    [/\bdont\b/gi, "don't"],
    [/\bdoesnt\b/gi, "doesn't"],
    [/\bdidnt\b/gi, "didn't"],
    [/\bwouldnt\b/gi, "wouldn't"],
    [/\bcouldnt\b/gi, "couldn't"],
    [/\bshouldnt\b/gi, "shouldn't"],
    [/\bwont\b/gi, "won't"],
    [/\bcant\b/gi, "can't"],
    [/\baint\b/gi, "ain't"],
    [/\bisnt\b/gi, "isn't"],
    [/\barent\b/gi, "aren't"],
    [/\bwasnt\b/gi, "wasn't"],
    [/\bwerent\b/gi, "weren't"],
    [/\bhasnt\b/gi, "hasn't"],
    [/\bhavent\b/gi, "haven't"],
    [/\bhadnt\b/gi, "hadn't"],
    [/\bneednt\b/gi, "needn't"],
    [/\bmustnt\b/gi, "mustn't"],
    [/\bhes\b/gi, "he's"],
    [/\bhed\b/gi, "he'd"],
    [/\bhell\b/gi, "he'll"],
    [/\bhes\b/gi, "he is"],
    [/\bshes\b/gi, "she's"],
    [/\bshed\b/gi, "she'd"],
    [/\bshell\b/gi, "she'll"],
    [/\bshes\b/gi, "she is"],
    [/\bwere\b/gi, "we're"],
    [/\bwed\b/gi, "we'd"],
    [/\bwell\b/gi, "we'll"],
    [/\bweve\b/gi, "we've"],
    [/\bweren\b/gi, "weren't"],
    [/\bim\b/gi, "I'm"],
    [/\bive\b/gi, "I've"],
    [/\bid\b/gi, "I'd"],
    [/\bill\b/gi, "I'll"],
    [/\byoure\b/gi, "you're"],
    [/\byouve\b/gi, "you've"],
    [/\byoud\b/gi, "you'd"],
    [/\byoull\b/gi, "you'll"],
    [/\blets\b/gi, "let's"],
    [/\bgonnai\b/gi, "gonna I"],
    [/\bgonnayou\b/gi, "gonna you"],
    [/\bgonnawe\b/gi, "gonna we"],
    [/\bgonnathey\b/gi, "gonna they"],
    [/\bgonnashe\b/gi, "gonna she"],
    [/\bgonnahe\b/gi, "gonna he"],
    [/\bgonnait\b/gi, "gonna it"],
    [/\bgonna([a-z])/gi, m => "gonna " + m.slice(5)],
    [/\bwannai\b/gi, "wanna I"],
    [/\bwannayou\b/gi, "wanna you"],
    [/\bwannawe\b/gi, "wanna we"],
    [/\bwannathey\b/gi, "wanna they"],
    [/\bwannashe\b/gi, "wanna she"],
    [/\bwannahe\b/gi, "wanna he"],
    [/\bwannait\b/gi, "wanna it"],
    [/\bwanna([a-z])/gi, m => "wanna " + m.slice(5)],
    [/\bgotta([a-z])/gi, m => "gotta " + m.slice(5)],
    [/\bkindai\b/gi, "kinda i"],
    [/\bkindaa\b/gi, "kinda a"],
    [/\bsortai\b/gi, "sorta i"],
    [/\bsortaa\b/gi, "sorta a"],
    [/\bima\b/gi, "i'm a"],
    [/\bimo\b/gi, "i'm o"],
    [/\bimma\b/gi, "i'm ma"],
    [/\bwouldai\b/gi, "would i"],
    [/\bcouldai\b/gi, "could i"],
    [/\bshouldai\b/gi, "should i"],
    [/\bwouldve\b/gi, "would've"],
    [/\bcouldve\b/gi, "could've"],
    [/\bshouldve\b/gi, "should've"],
    [/\bcouldnt\b/gi, "couldn't"],
    [/\bshouldnt\b/gi, "shouldn't"],
    [/\bdontcha\b/gi, "don't you"],
    [/\bwontcha\b/gi, "won't you"],
    [/\bcantcha\b/gi, "can't you"],
    [/\bdunno\b/gi, "don't know"],
    [/\blemme\b/gi, "let me"],
    [/\bgimme\b/gi, "give me"],
    [/\btryna\b/gi, "trying to"],
    [/\btryina\b/gi, "trying to"],
    [/\btrynah\b/gi, "trying to"],
    [/\btrynai\b/gi, "trying to"],
    [/\bwhatcha\b/gi, "what are you"],
    [/\bwhatcha\b/gi, "what are you"],
    [/\bhowzit\b/gi, "how's it"],
    [/\bhowsit\b/gi, "how's it"],
    [/\bhowdyou\b/gi, "how do you"],
    [/\bwhozit\b/gi, "who is it"],
    [/\bwheredyou\b/gi, "where did you"],
    [/\bwhendyou\b/gi, "when did you"],
    [/\bhowdyou\b/gi, "how did you"],
    [/\bwhodyou\b/gi, "who did you"],
    [/\baint\b/gi, "ain't"],
    [/\balot\b/gi, "a lot"],
];

const ITALIAN_MISSPELLINGS: [RegExp, string | ((match: string) => string)][] = [
    // Common abbreviations and numbers
    [/\bxke\b/gi, "perché"],
    [/\bxké\b/gi, "perché"],
    [/\bk\b/gi, "che"],
    [/\b6\b/gi, "sei"],
    [/\b3\b/gi, "tre"],
    [/\b2\b/gi, "due"],

    // Accent errors
    [/\bun pò\b/gi, "un po'"],
    [/\bpò\b/gi, "po'"],
    [/\bqual'è\b/gi, "qual è"],
    [/\bqual'era\b/gi, "qual era"],
    [/\bcioe\b/gi, "cioè"],
    [/\bcioé\b/gi, "cioè"],

    // Compound words
    [/\bbuon giorno\b/gi, "buongiorno"],
    [/\bbuona sera\b/gi, "buonasera"],
    [/\bbuona notte\b/gi, "buonanotte"],
    [/\bperfavore\b/gi, "per favore"],
    [/\bperpiacere\b/gi, "per piacere"],
    [/\bdaccordo\b/gi, "d'accordo"],
    [/\bdacordo\b/gi, "d'accordo"],
    [/\bvabene\b/gi, "va bene"],

    // Spelling errors - double consonants
    [/\bassieme\b/gi, "insieme"],
    [/\binsiemme\b/gi, "insieme"],
    [/\bqundi\b/gi, "quindi"],
    [/\bpropro\b/gi, "proprio"],
    [/\bvereamente\b/gi, "veramente"],
    [/\brealmente\b/gi, "veramente"],
    [/\bperfeto\b/gi, "perfetto"],
    [/\bokey\b/gi, "ok"],

    // Missing letters
    [/\bnesuno\b/gi, "nessuno"],
    [/\bnesuna\b/gi, "nessuna"],
    [/\bninte\b/gi, "niente"],
    [/\bqualke\b/gi, "qualche"],
    [/\bqalke\b/gi, "qualche"],
    [/\bongni\b/gi, "ogni"],

    // Word endings
    [/\btuto\b/gi, "tutto"],
    [/\btuta\b/gi, "tutta"],
    [/\btuti\b/gi, "tutti"],
    [/\bute\b/gi, "tutte"],
    [/\bfrose\b/gi, "forse"],
    [/\bprobabilimente\b/gi, "probabilmente"],
    [/\bsicuramenta\b/gi, "sicuramente"],

    // Common word errors
    [/\bvelece\b/gi, "veloce"],
    [/\bvelocementre\b/gi, "velocemente"],
    [/\bfortre\b/gi, "forte"],
    [/\brabo\b/gi, "bravo"],
    [/\braba\b/gi, "brava"],
    [/\bbeli\b/gi, "belli"],
    [/\bbele\b/gi, "belle"],
    [/\bbelo\b/gi, "bello"],
    [/\bbela\b/gi, "bella"],
    [/\bbruto\b/gi, "brutto"],
    [/\bbruta\b/gi, "brutta"],
    [/\bgrandre\b/gi, "grande"],
    [/\bpicolla\b/gi, "piccola"],
    [/\bnuvo\b/gi, "nuovo"],
    [/\bvecio\b/gi, "vecchio"],
    [/\bvecia\b/gi, "vecchia"],
    [/\bmacina\b/gi, "macchina"],
    [/\bnote\b/gi, "notte"],
    [/\bsetimana\b/gi, "settimana"],
    [/\bano\b/gi, "anno"],

    // More common errors
    [/\bamico\b/gi, "amico"],
    [/\bamica\b/gi, "amica"],
    [/\bfamiglia\b/gi, "famiglia"],
    [/\blavoro\b/gi, "lavoro"],
    [/\bscuola\b/gi, "scuola"],
    [/\bauto\b/gi, "auto"],
    [/\btreno\b/gi, "treno"],
    [/\bmangiare\b/gi, "mangiare"],
    [/\bbere\b/gi, "bere"],
    [/\bdormire\b/gi, "dormire"],
    [/\bparlare\b/gi, "parlare"],
    [/\bchiaro\b/gi, "chiaro"],
    [/\bscurro\b/gi, "scuro"],
    [/\bcaldo\b/gi, "caldo"],
    [/\bfreddo\b/gi, "freddo"],
];

const MERGED_WORDS: [RegExp, string][] = [
    [/\bgonnado\b/gi, "gonna do"],
    [/\bgonnasay\b/gi, "gonna say"],
    [/\bgonnago\b/gi, "gonna go"],
    [/\bgonnakill\b/gi, "gonna kill"],
    [/\bgonnahit\b/gi, "gonna hit"],
    [/\bgonnafight\b/gi, "gonna fight"],
    [/\bgonnawin\b/gi, "gonna win"],
    [/\bgonnaleave\b/gi, "gonna leave"],
    [/\bgonnaget\b/gi, "gonna get"],
    [/\bgonnamake\b/gi, "gonna make"],
    [/\bgonnatake\b/gi, "gonna take"],
    [/\bgonnagive\b/gi, "gonna give"],
    [/\bgonnasee\b/gi, "gonna see"],
    [/\bgonnatell\b/gi, "gonna tell"],
    [/\bgonnafind\b/gi, "gonna find"],
    [/\bgonnabuy\b/gi, "gonna buy"],
    [/\bgonnaplay\b/gi, "gonna play"],
    [/\bgonnawork\b/gi, "gonna work"],
    [/\bgonnalearn\b/gi, "gonna learn"],
    [/\bgonnatry\b/gi, "gonna try"],
    [/\bgonnastop\b/gi, "gonna stop"],
    [/\bgonnaopen\b/gi, "gonna open"],
    [/\bgonnacome\b/gi, "gonna come"],
    [/\bgonnawatch\b/gi, "gonna watch"],
    [/\bgonnalist\b/gi, "gonna list"],
    [/\bgonnalisten\b/gi, "gonna listen"],
    [/\bgonnause\b/gi, "gonna use"],
    [/\bgonnahelp\b/gi, "gonna help"],
    [/\bgonnasleep\b/gi, "gonna sleep"],
    [/\bgonnadie\b/gi, "gonna die"],
    [/\bgonnacry\b/gi, "gonna cry"],
    [/\bgonnalaugh\b/gi, "gonna laugh"],
    [/\bgonnajoin\b/gi, "gonna join"],
    [/\bgonnasend\b/gi, "gonna send"],
    [/\bgonnatype\b/gi, "gonna type"],
    [/\bgonnacall\b/gi, "gonna call"],
    [/\bgonnatext\b/gi, "gonna text"],
    [/\bgonnabring\b/gi, "gonna bring"],
    [/\bgonnapick\b/gi, "gonna pick"],
    [/\bgonnathrow\b/gi, "gonna throw"],
    [/\bgonnacatch\b/gi, "gonna catch"],
    [/\bgonnabuy\b/gi, "gonna buy"],
    [/\bgonnasell\b/gi, "gonna sell"],
    [/\bgonnafix\b/gi, "gonna fix"],
    [/\bgonnabreak\b/gi, "gonna break"],
    [/\bgonnahurt\b/gi, "gonna hurt"],
    [/\bgonnasave\b/gi, "gonna save"],
    [/\bgonnaspend\b/gi, "gonna spend"],
    [/\bgonnapay\b/gi, "gonna pay"],
    [/\bgonnaswitch\b/gi, "gonna switch"],
    [/\bgonnachange\b/gi, "gonna change"],
    [/\bgonnacook\b/gi, "gonna cook"],
    [/\bgonnaeat\b/gi, "gonna eat"],
    [/\bgonnadrink\b/gi, "gonna drink"],
    [/\bgonnarun\b/gi, "gonna run"],
    [/\bgonnawalk\b/gi, "gonna walk"],
    [/\bgonnastand\b/gi, "gonna stand"],
    [/\bgonnasit\b/gi, "gonna sit"],
    [/\bgonnalay\b/gi, "gonna lay"],
    [/\bgonnalie\b/gi, "gonna lie"],
    [/\bgonnaimplode\b/gi, "gonna implode"],
    [/\bgonnadouse\b/gi, "gonna douse"],
    [/\bgonnasplash\b/gi, "gonna splash"],
    [/\bgonnaflood\b/gi, "gonna flood"],
    [/\bwannadelete\b/gi, "wanna delete"],
    [/\bwannaplay\b/gi, "wanna play"],
    [/\bwannafight\b/gi, "wanna fight"],
    [/\bwannakiss\b/gi, "wanna kiss"],
    [/\bwannahug\b/gi, "wanna hug"],
    [/\bwannasee\b/gi, "wanna see"],
    [/\bwannatalk\b/gi, "wanna talk"],
    [/\bwannaknow\b/gi, "wanna know"],
    [/\bwannabe\b/gi, "wanna be"],
    [/\bwannaget\b/gi, "wanna get"],
    [/\bwannamake\b/gi, "wanna make"],
    [/\bwannago\b/gi, "wanna go"],
    [/\bwannado\b/gi, "wanna do"],
    [/\bwannasay\b/gi, "wanna say"],
    [/\bwannaleave\b/gi, "wanna leave"],
    [/\bwannacome\b/gi, "wanna come"],
    [/\bwannahit\b/gi, "wanna hit"],
    [/\bwannakill\b/gi, "wanna kill"],
    [/\bwannadie\b/gi, "wanna die"],
    [/\bwannacry\b/gi, "wanna cry"],
    [/\bwannalaugh\b/gi, "wanna laugh"],
    [/\bwannajoin\b/gi, "wanna join"],
    [/\bwannasend\b/gi, "wanna send"],
    [/\bwannatype\b/gi, "wanna type"],
    [/\bwannacall\b/gi, "wanna call"],
    [/\bwannatext\b/gi, "wanna text"],
    [/\bwannabuy\b/gi, "wanna buy"],
    [/\bwannasell\b/gi, "wanna sell"],
    [/\bwannafix\b/gi, "wanna fix"],
    [/\bwannabreak\b/gi, "wanna break"],
    [/\bwannaeat\b/gi, "wanna eat"],
    [/\bwannadrink\b/gi, "wanna drink"],
    [/\bwannarun\b/gi, "wanna run"],
    [/\bwannawalk\b/gi, "wanna walk"],
    [/\bwannaswitch\b/gi, "wanna switch"],
    [/\bwannacook\b/gi, "wanna cook"],
    [/\bgottabe\b/gi, "gotta be"],
    [/\bottaget\b/gi, "gotta get"],
    [/\bottado\b/gi, "gotta do"],
    [/\bottago\b/gi, "gotta go"],
    [/\bottasee\b/gi, "gotta see"],
    [/\bottamake\b/gi, "gotta make"],
    [/\bottatry\b/gi, "gotta try"],
    [/\bottawork\b/gi, "gotta work"],
    [/\bottaswitch\b/gi, "gotta switch"],
    [/\bottaplay\b/gi, "gotta play"],
    [/\bottawin\b/gi, "gotta win"],
    [/\bottacook\b/gi, "gotta cook"],
    [/\bottagofirst\b/gi, "gotta go first"],
    [/\bottagosecond\b/gi, "gotta go second"],
    [/\bottacome\b/gi, "gotta come"],
    [/\bottaleave\b/gi, "gotta leave"],
    [/\bottasend\b/gi, "gotta send"],
    [/\bottatype\b/gi, "gotta type"],
    [/\bottacall\b/gi, "gotta call"],
    [/\bottatext\b/gi, "gotta text"],
    [/\bottahit\b/gi, "gotta hit"],
    [/\bottakill\b/gi, "gotta kill"],
    [/\bottadie\b/gi, "gotta die"],
    [/\bottacry\b/gi, "gotta cry"],
    [/\bottalaugh\b/gi, "gotta laugh"],
    [/\bottajoin\b/gi, "gotta join"],
    [/\bottabuy\b/gi, "gotta buy"],
    [/\bottasell\b/gi, "gotta sell"],
    [/\bottaswitch\b/gi, "gotta switch"],
    [/\bimma\s/gi, "I'm a "],
    [/\bimo\s/gi, "I'm o"],
    [/\bima\s/gi, "I'm a "],
    [/\bima\b/gi, "I'ma"],
    [/\bdunno\b/gi, "don't know"],
    [/\bgotta\b/gi, "gotta"],
    [/\bkinda\b/gi, "kinda"],
    [/\bsorta\b/gi, "sorta"],
    [/\blotta\b/gi, "lotta"],
    [/\boutta\b/gi, "outta"],
    [/\bwoulda\b/gi, "woulda"],
    [/\bcoulda\b/gi, "coulda"],
    [/\bshoulda\b/gi, "shoulda"],
    [/\bwouldnt\b/gi, "wouldn't"],
    [/\bshouldnt\b/gi, "shouldn't"],
    [/\bcouldnt\b/gi, "couldn't"],
    [/\baint\b/gi, "ain't"],
    [/\balot\b/gi, "a lot"],
];

const COMMON_PUNCTUATION_ERRORS: [RegExp, string][] = [
    [/\.\.+/g, "."],
    [/!!+/g, "!"],
    [/\?\?+/g, "?"],
    [/,,+/g, ","],
    [/,,,/g, ","],
    [/!\?/g, "?"],
    [/\?!/g, "?"],
    [/\.\?/g, "?"],
    [/\?\./g, "."],
    [/\s+([.!?,;:'"»」』】》』〙〛〞〟])/g, "$1"],
    [/([«「『【《『〙〛〞〟])\s+/g, "$1"],
    [/\( +/g, "("],
    [/ +\)/g, ")"],
    [/ +\. +/g, ". "],
    [/@everyone/g, "@everyone"],
    [/@here/g, "@here"],
];

const STRAIGHT_TO_CURLY_START: Record<string, string> = {
    "'": "'",
    "\"": "\"",
    "`": "`"
};

const STRAIGHT_TO_CURLY_END: Record<string, string> = {
    "'": "'",
    "\"": "\"",
    "`": "`"
};

function isProbablyEnglish(text: string): boolean {
    const englishChars = text.match(/[a-zA-Z]/g) || [];
    const totalChars = text.match(/[a-zA-Z\u0400-\u04FF\u0600-\u06FF\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g) || [];

    if (totalChars.length === 0) return true;

    const englishRatio = englishChars.length / totalChars.length;
    return englishRatio > 0.5;
}

function isProbablyItalian(text: string): boolean {
    const italianPatterns = [
        /\b(ciao|buongiorno|buonasera|buonanotte|grazie|prego|per favore|per piacere)\b/i,
        /\b(perché|perche|come|dove|quale|quanto|quando)\b/i,
        /\b(sono|hai|ha|abbiamo|avete|hanno|è|e|o|ma|se|che)\b/i,
        /\b(io|tu|lui|lei|noi|voi|loro)\b/i,
        /\b(mio|tuo|suo|nostro|vostro|loro)\b/i,
        /\b(questo|quello|questa|quella|questi|quei|quelle)\b/i,
        /\b(nel|nella|nei|nelle|allo|alla|ai|alle)\b/i,
        /\b(di|da|in|con|su|per|tra|fra)\b/i,
        /\b(non|no|sì|si|ne|ci|vi|mi|ti)\b/i,
        /\b(più|meno|molto|poco|tanto|troppo|abbastanza)\b/i,
        /\b(faccio|fatto|andato|venuto|detto|preso|messo)\b/i,
        /\b(bene|male|bravo|bello|brutto|grande|piccolo)\b/i,
        /\b(ragazzo|ragazza|amico|amica|casa|lavoro|scuola)\b/i,
        /\b(giorno|notte|mattina|pomeriggio|sera|settimana|mese|anno)\b/i,
        /[àèìòù]/i // Accented characters are strong indicator
    ];

    let matchCount = 0;
    for (const pattern of italianPatterns) {
        if (pattern.test(text)) matchCount++;
    }

    // Need at least 2 matches to consider it Italian
    return matchCount >= 2;
}

function isAllCaps(text: string): boolean {
    const letters = text.match(/[a-zA-Z]/g);
    if (!letters || letters.length === 0) return false;
    return letters.every(letter => letter === letter.toUpperCase()) &&
        text.match(/[a-zA-Z]/g)!.length > 3;
}

function fixContractions(text: string): string {
    let result = text;

    for (const [pattern, replacement] of CONTRACTIONS) {
        result = result.replace(pattern, replacement);
    }

    return result;
}

function fixItalianContractions(text: string): string {
    let result = text;

    // Fix accents first if enabled
    // Only apply these when we're confident it's Italian
    if (settings.store.fixItalianAccents) {
        const accentFixes: [RegExp, string][] = [
            [/\bperche\b/gi, "perché"],
            [/\bcioe\b/gi, "cioè"],
            [/\bpo\b/gi, "po'"], // Only "po'" (meaning "little") not every "po"
        ];

        for (const [pattern, replacement] of accentFixes) {
            result = result.replace(pattern, replacement);
        }

        // Apply apostrophe fixes only for specific Italian patterns
        // These should be more specific to avoid false positives
        const apostropheFixes: [RegExp, string][] = [
            [/\bda'\s/gi, "da' "], // "da'" followed by space (imperative)
            [/\bfa'\s/gi, "fa' "], // "fa'" followed by space
            [/\bsta'\s/gi, "sta' "], // "sta'" followed by space
            [/\bva'\s/gi, "va' "], // "va'" followed by space
            // Day of month pattern: "il di 5" -> "il dì 5"
            [/\bil di (\d+)/gi, "il dì $1"],
        ];

        for (const [pattern, replacement] of apostropheFixes) {
            result = result.replace(pattern, replacement);
        }
    }

    // Apply contractions
    for (const [pattern, replacement] of ITALIAN_CONTRACTIONS) {
        result = result.replace(pattern, replacement);
    }

    // Apply misspelling fixes
    for (const [pattern, replacement] of ITALIAN_MISSPELLINGS) {
        if (typeof replacement === "function") {
            result = result.replace(pattern, replacement as any);
        } else {
            result = result.replace(pattern, replacement);
        }
    }

    return result;
}

function fixPunctuation(text: string, allCaps: boolean = false): string {
    if (!settings.store.enable) return text;

    let result = text;

    const skipGrammar = isSlang(text);

    if (allCaps) {
        result = result.charAt(0).toUpperCase() + result.slice(1).toLowerCase();
    }

    for (const [pattern, replacement] of COMMON_PUNCTUATION_ERRORS) {
        result = result.replace(pattern, replacement);
    }

    if (settings.store.enableEnglish && settings.store.fixContractions && !skipGrammar) {
        result = fixContractions(result);
        for (const [pattern, replacement] of COMMON_MISSPELLINGS) {
            if (typeof replacement === "function") {
                result = result.replace(pattern, replacement as any);
            } else {
                result = result.replace(pattern, replacement);
            }
        }
        result = fixPossessive(result);
    }

    if (settings.store.enableItalian) {
        result = fixItalianContractions(result);
    }

    for (const [pattern, replacement] of getCustomReplacements()) {
        result = result.replace(pattern, replacement);
    }

    if (settings.store.fixSpaces) {
        result = result.replace(/  +/g, " ");
        result = result.replace(/^ +/gm, "");
        result = result.replace(/ +$/gm, "");
    }

    if (settings.store.fixQuotes) {
        const words = result.split(/(\s+)/);
        const fixedWords = words.map((word, index) => {
            if (/^[a-zA-Z]+$/i.test(word)) {
                const prevWord = index > 0 ? words[index - 1] : "";
                const nextWord = index < words.length - 1 ? words[index + 1] : "";

                const openBrackets = "[{(";
                const closeBrackets = "]})\"'";

                const endsWithOpen = openBrackets.includes(prevWord.slice(-1)) ||
                    prevWord.match(/^\s+$/) !== null ||
                    prevWord === "" ||
                    prevWord === "^";

                const startsWithClose = closeBrackets.includes(nextWord[0]) ||
                    nextWord.match(/^\s+$/) !== null ||
                    nextWord === "";

                if (word.startsWith("'") && STRAIGHT_TO_CURLY_START[word[0]]) {
                    if (endsWithOpen || prevWord === "" || prevWord === "^") {
                        return STRAIGHT_TO_CURLY_START[word[0]] + word.slice(1);
                    }
                }

                if (word.endsWith("'") && STRAIGHT_TO_CURLY_END[word[word.length - 1]]) {
                    if (startsWithClose || nextWord === "" || nextWord.match(/^[.!?]$/)) {
                        return word.slice(0, -1) + STRAIGHT_TO_CURLY_END[word[word.length - 1]];
                    }
                }

                if (word.startsWith("\"") && STRAIGHT_TO_CURLY_START[word[0]]) {
                    if (endsWithOpen || prevWord === "" || prevWord === "^") {
                        return STRAIGHT_TO_CURLY_START[word[0]] + word.slice(1);
                    }
                }

                if (word.endsWith("\"") && STRAIGHT_TO_CURLY_END[word[word.length - 1]]) {
                    if (startsWithClose || nextWord === "" || nextWord.match(/^[.!?]$/)) {
                        return word.slice(0, -1) + STRAIGHT_TO_CURLY_END[word[word.length - 1]];
                    }
                }
            }
            return word;
        });
        result = fixedWords.join("");
    }

    if (settings.store.fixCapitalization) {
        result = fixCapitalization(result);
    }

    if (settings.store.addPeriod) {
        result = addPeriodIfNeeded(result);
    }

    return result;
}

function fixCapitalization(text: string): string {
    let result = text;

    result = result.replace(/(?:^|[.!?]\s+)([a-z])/g, (match, letter) => {
        return match.replace(letter, letter.toUpperCase());
    });

    return result;
}

function addPeriodIfNeeded(text: string): string {
    const trimmed = text.trim();

    if (trimmed.length === 0) return text;

    const lastChar = trimmed.slice(-1);

    if (/[.!?]/.test(lastChar)) {
        return text;
    }

    if (text.endsWith(" ") || text.endsWith("\n")) {
        return text + ".";
    }

    return text + ".";
}

export default definePlugin({
    name: "OpSec",
    description: "Autocorrect for English & Italian - Toggle each language in settings (contractions, punctuation, accents)",
    tags: ["Privacy", "Utility"],
    authors: [
        { name: "Solace", id: 1472732509241479218n },
        { name: "irritably", id: 928787166916640838n }
    ],
    settings,

    onBeforeMessageSend(_: any, msg: any) {
        if (!msg?.content) return;
        if (!settings.store.enable) return;

        const isItalian = settings.store.enableItalian && isProbablyItalian(msg.content);
        const isEnglish = isProbablyEnglish(msg.content);

        if (!isItalian && !isEnglish) return;
        if (msg.content.startsWith("/")) return;

        const allCaps = isAllCaps(msg.content);

        if (settings.store.contextualCorrection) {
            const vocab = getContextVocabulary(msg);
            const corrections = findContextCorrections(msg.content, vocab);
            if (corrections.size > 0) {
                msg.content = applyContextCorrections(msg.content, corrections);
            }
        }

        const fixed = fixPunctuation(msg.content, allCaps);
        if (fixed !== msg.content) {
            msg.content = fixed;
        }
    },

    start() {
        console.log("[OpSec] Started - Contractions & punctuation autocorrect");
    },

    stop() {
        console.log("[OpSec] Stopped");
    }
});
