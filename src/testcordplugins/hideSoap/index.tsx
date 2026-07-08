/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { Message } from "@vencord/discord-types";
import { React, RelationshipStore } from "@webpack/common";

const HEBREW_UNICODE_REGEX = /[\u0590-\u05FF]/;

const COMMON_HEBREW_WORDS = [
    "shalom", "todah", "barruch", "hashem", "adonai",
    "amen", "shabbat", "kabbalah", "mitzvah", "torah",
    "talmud", "kippah", "tzitzit", "menorah", "mezuzah",
    "synagogue", "rabbi", "kosher", "pesach", "hanukkah",
    "yom kippur", "rosh hashanah", "bar mitzvah",
    "bracha", "daven", "minyan", "siddur", "challah",
    "matzah", "seder", "haggadah", "tefillin",
    "מה שלומך", "שלום", "תודה", "ברוך", "השם",
    "אמן", "שבת", "קבלה", "מצווה", "תורה",
    "תלמוד", "כיפה", "מנורה", "מזוזה",
    "רב", "כושר", "פסח", "חנוכה",
];

const LATIN_HEBREW_WORDS = COMMON_HEBREW_WORDS.filter(w => !HEBREW_UNICODE_REGEX.test(w));
const HEBREW_CHAR_WORDS = COMMON_HEBREW_WORDS.filter(w => HEBREW_UNICODE_REGEX.test(w));

let _latinWordRegex: RegExp | null = null;
let _hebrewWordRegex: RegExp | null = null;
let _wordRegexCaseSensitive: boolean | null = null;

function getWordRegexes() {
    const caseSensitive = settings.store.caseSensitiveWordDetection;
    if (_wordRegexCaseSensitive === caseSensitive && _latinWordRegex && _hebrewWordRegex) {
        return { latin: _latinWordRegex, hebrew: _hebrewWordRegex };
    }
    _wordRegexCaseSensitive = caseSensitive;
    _latinWordRegex = new RegExp(`\\b(?:${LATIN_HEBREW_WORDS.join("|")})\\b`, caseSensitive ? "" : "i");
    _hebrewWordRegex = new RegExp(HEBREW_CHAR_WORDS.join("|"), "i");
    return { latin: _latinWordRegex, hebrew: _hebrewWordRegex };
}

const settings = definePluginSettings({
    detectHebrewChars: {
        type: OptionType.BOOLEAN,
        description: "Detect Hebrew Unicode characters (\u0590-\u05FF)",
        default: true,
        restartNeeded: true
    },
    detectHebrewWords: {
        type: OptionType.BOOLEAN,
        description: "Detect common Hebrew words written in Latin characters",
        default: true,
        restartNeeded: true
    },
    caseSensitiveWordDetection: {
        type: OptionType.BOOLEAN,
        description: "Make Hebrew word detection case sensitive",
        default: false,
        restartNeeded: true
    },
    customBlockedUsers: {
        type: OptionType.STRING,
        description: "Manually add user IDs to block (separated by comma and space, e.g: 123456789, 987654321)",
        default: "",
        restartNeeded: true
    },
    hideBlockedMessages: {
        type: OptionType.BOOLEAN,
        description: "Hide the '1 blocked message' indicator",
        default: true,
        restartNeeded: true
    },
    hideReplies: {
        type: OptionType.BOOLEAN,
        description: "Hide replies from blocked users",
        default: true,
        restartNeeded: true
    }
});

function detectHebrewText(message: Message): boolean {
    if (!message?.content) return false;

    const { content } = message;

    // Check for Hebrew Unicode characters
    if (settings.store.detectHebrewChars && HEBREW_UNICODE_REGEX.test(content)) {
        return true;
    }

    // Check for common Hebrew words
    if (settings.store.detectHebrewWords) {
        const { latin, hebrew } = getWordRegexes();
        if (hebrew.test(content) || latin.test(content)) {
            return true;
        }
    }

    // Also check embed fields
    if (message.embeds?.length) {
        for (const embed of message.embeds) {
            // @ts-ignore
            if (embed.rawTitle && detectText(embed.rawTitle)) return true;
            // @ts-ignore
            if (embed.rawDescription && detectText(embed.rawDescription)) return true;
        }
    }

    return false;
}

function detectText(text: string): boolean {
    if (settings.store.detectHebrewChars && HEBREW_UNICODE_REGEX.test(text)) {
        return true;
    }

    if (settings.store.detectHebrewWords) {
        const { latin, hebrew } = getWordRegexes();
        if (hebrew.test(text) || latin.test(text)) {
            return true;
        }
    }

    return false;
}

function shouldHideUser(userId: string): boolean {
    // Check Discord's native block list
    if (RelationshipStore.isBlocked(userId)) return true;

    // Check manually added user IDs
    if (settings.store.customBlockedUsers.length > 0) {
        const customUsers = settings.store.customBlockedUsers.split(", ").filter(Boolean);
        if (customUsers.includes(userId)) return true;
    }

    return false;
}

function hiddenReplyComponent() {
    return (
        <div style={{ marginTop: "0px", marginBottom: "0px" }}>
            <i>↓ Replying to hidden message</i>
        </div>
    );
}

const hebrewCheckCache = new Map<string, boolean>();
const HEBREW_CACHE_MAX = 500;

export default definePlugin({
    name: "AntiSoap (hideSoap)",
    description: "basically hide all messages from j*ws",
    authors: [TestcordDevs.x2b],
    tags: ["Customisation", "Appearance"],
    settings,
    shouldHideUser,
    hiddenReplyComponent,

    stop() {
        hebrewCheckCache.clear();
    },

    flux: {
        MESSAGE_CREATE({ message }) {
            if (!message?.author?.id || message.author.bot) return;

            // Check if message contains Hebrew text
            const userId = message.author.id;
            const cached = hebrewCheckCache.get(userId);
            if (cached === true) return;
            if (cached === false) return;

            const hasHebrew = detectHebrewText(message);
            if (hebrewCheckCache.size >= HEBREW_CACHE_MAX) {
                const firstKey = hebrewCheckCache.keys().next().value;
                if (firstKey) hebrewCheckCache.delete(firstKey);
            }
            hebrewCheckCache.set(userId, hasHebrew);
            if (!hasHebrew) return;

            // Add user to custom blocked list if not already there
            const currentBlocked = settings.store.customBlockedUsers;
            const blockedList = currentBlocked.length > 0
                ? currentBlocked.split(", ").filter(Boolean)
                : [];

            if (!blockedList.includes(userId)) {
                blockedList.push(userId);
                settings.store.customBlockedUsers = blockedList.join(", ");
            }
        }
    },

    patches: [
        // Hide messages in chat
        {
            find: ".NITRO_NOTIFICATION,[",
            replacement: {
                match: /renderContentOnly:\i}=\i;/,
                replace: "$&if($self.shouldHideUser(arguments[0].message.author.id)) return null; "
            }
        },
        {
            find: "#{intl::BLOCKED_MESSAGE_COUNT}}",
            replacement: {
                match: /1:\i\.content.length;/,
                replace: "$&return null;"
            },
            predicate: () => settings.store.hideBlockedMessages
        },
        {
            find: ".GUILD_APPLICATION_PREMIUM_SUBSCRIPTION||",
            replacement: [
                {
                    match: /(?=let \i,\{repliedAuthor:)/,
                    replace: "if(arguments[0]?.referencedMessage?.message && $self.shouldHideUser(arguments[0].referencedMessage.message.author.id)) { return $self.hiddenReplyComponent(); }"
                }
            ],
            predicate: () => settings.store.hideReplies
        },
        {
            find: "this.updateMaxContentFeedRowSeen()",
            replacement: [
                {
                    match: /(?<=user:(\i),guildId:\i,channel:(\i).*?)BOOST_GEM_ICON.{0,10}\);/,
                    replace: "$&if($self.shouldHideUser($1.id)) return null; "
                }
            ]
        },
        {
            find: "peopleListItemRef.current.componentWillLeave",
            replacement: {
                match: /\i}=this.state;/,
                replace: "$&if($self.shouldHideUser(this.props.user.id)) return null; "
            }
        },
        {
            find: "PrivateChannel.renderAvatar",
            replacement: {
                match: /(return \i\.isMultiUserDM\(\))(?<=function\(\i,(\i),\i\){.*)/,
                replace: "if($2.rawRecipients[0] && $2.rawRecipients[0]?.id){if($self.shouldHideUser($2.rawRecipients[0].id)) return null;}$1"
            }
        },
        {
            find: "getFriendIDs(){",
            replacement: {
                match: /\?\?\[\]\)\),\i\.friends/,
                replace: "$&.filter(id => !$self.shouldHideUser(id))"
            }
        },
        {
            find: "ACTIVE_NOW_COLUMN)",
            replacement: {
                match: /(\i\.\i),\{(?=\}\)\])/,
                replace: '"div",{children:$self.activeNowView($1())'
            }
        },
    ],

    activeNowView(cards: any) {
        if (!Array.isArray(cards)) return cards;

        return cards.filter((card: any) => {
            if (!card?.key) return false;

            const newKey = card.key.match(/(?:user-|party-spotify:)(.+)/)?.[1];
            if (newKey) return !this.shouldHideUser(newKey);

            return true;
        });
    },

    start() {
        console.log("[hideSoap] Plugin started - Hebrew/Jewish text detection enabled");
    }
});
