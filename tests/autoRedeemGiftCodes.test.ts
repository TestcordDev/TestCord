/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
    createMessageCodeState,
    extractGiftCodes,
    normalizeGiftCode,
    parseGiftCodesFromContent,
    type GiftCodeMessage,
} from "../src/testcordplugins/autoRedeem/giftCodes.ts";

const CODE_A = "ABCDEFGHIJKLMNOP";
const CODE_B = "qrstuvwxyz123456";
const CODE_C = "MixedCaseCode000";

function makeMessage(id: string, extra: Partial<GiftCodeMessage> & Record<string, unknown> = {}): GiftCodeMessage {
    const message = { id, ...extra };
    return message;
}

function contentMessage(id: string, content: string): GiftCodeMessage {
    return makeMessage(id, { content });
}

test("message.giftCodes is the authoritative source", () => {
    const result = extractGiftCodes(makeMessage("1", {
        content: `https://discord.gift/${CODE_B}`,
        giftCodes: [CODE_A],
    }));
    assert.deepEqual(result, { codes: [CODE_A], source: "giftCodes" });
});

test("giftCodes entries are filtered, trimmed and deduplicated", () => {
    const result = extractGiftCodes(makeMessage("1", {
        giftCodes: [
            CODE_A,
            ` ${CODE_A} `,
            CODE_B.toLowerCase(),
            CODE_B,
            null,
            42,
            {},
            "",
            "tooshort",
            "A".repeat(33),
        ],
    }));
    assert.deepEqual(result, { codes: [CODE_A, CODE_B.toLowerCase()], source: "giftCodes" });
});

test("a malformed or empty giftCodes field falls back to content", () => {
    const fromObject = extractGiftCodes(makeMessage("1", {
        content: `https://discord.gift/${CODE_A}`,
        giftCodes: { code: CODE_A },
    }));
    assert.deepEqual(fromObject, { codes: [CODE_A], source: "content" });

    const fromEmptyArray = extractGiftCodes(makeMessage("2", {
        content: `https://discord.com/gifts/${CODE_B}`,
        giftCodes: [],
    }));
    assert.deepEqual(fromEmptyArray, { codes: [CODE_B], source: "content" });

    const fromJunkArray = extractGiftCodes(makeMessage("3", { giftCodes: [null, 7] }));
    assert.deepEqual(fromJunkArray, { codes: [], source: "none" });
});

test("content accepts only the three exact hosts and paths", () => {
    assert.deepEqual(parseGiftCodesFromContent(`https://discord.gift/${CODE_A}`), [CODE_A]);
    assert.deepEqual(parseGiftCodesFromContent(`http://discord.gift/${CODE_A}`), [CODE_A]);
    assert.deepEqual(parseGiftCodesFromContent(`discord.gift/${CODE_A}`), [CODE_A]);
    assert.deepEqual(parseGiftCodesFromContent(`https://discord.com/gift/${CODE_B}`), [CODE_B]);
    assert.deepEqual(parseGiftCodesFromContent(`https://discord.com/gifts/${CODE_B}`), [CODE_B]);
    assert.deepEqual(parseGiftCodesFromContent(`https://app.com/gifts/${CODE_C}`), [CODE_C]);
    assert.deepEqual(parseGiftCodesFromContent(`HTTPS://DISCORD.GIFT/${CODE_A}`), [CODE_A]);
    assert.deepEqual(parseGiftCodesFromContent(`_italic_ https://discord.gift/${CODE_A}`), [CODE_A]);
    assert.deepEqual(parseGiftCodesFromContent(`https://discord.com/GIFTS/${CODE_B}`), [CODE_B]);
});

test("content keeps surrounding prose, markup and several codes in order", () => {
    const content = [
        "first (https://discord.gift/" + CODE_A + "),",
        "then **https://discord.com/gifts/" + CODE_B + "**",
        "then [click](https://app.com/gifts/" + CODE_C + ")",
        "then <" + `https://discord.gift/${CODE_C}` + ">",
    ].join(" ");
    assert.deepEqual(parseGiftCodesFromContent(content), [CODE_A, CODE_B, CODE_C]);
});

test("trailing punctuation is trimmed but never part of the code", () => {
    assert.deepEqual(parseGiftCodesFromContent(`Grab https://discord.gift/${CODE_A}.`), [CODE_A]);
    assert.deepEqual(parseGiftCodesFromContent(`Grab https://discord.gift/${CODE_A}!`), [CODE_A]);
    assert.deepEqual(parseGiftCodesFromContent(`Grab https://discord.gift/${CODE_A}...`), [CODE_A]);
    assert.deepEqual(parseGiftCodesFromContent(`Grab (https://discord.gift/${CODE_A})`), [CODE_A]);
});

test("lookalike hosts and paths are rejected", () => {
    const rejected = [
        `https://discord.gift.evil.com/${CODE_A}`,
        `https://notdiscord.gift/${CODE_A}`,
        `https://discord.gift.co/${CODE_A}`,
        `https://evil.com/discord.gift/${CODE_A}`,
        `https://evil.com/?next=discord.gift/${CODE_A}`,
        `https://evil.com/?a=1&b=discord.gift/${CODE_A}`,
        `https://discordapp.com/gifts/${CODE_A}`,
        `https://discord.gg/${CODE_A}`,
        `https://discord.gift./${CODE_A}`,
        `https://discord.com/channels/@me`,
        `https://discord.com/gifts`,
        `https://discord.com/gifts/${CODE_A}/extra`,
        `https://discord.gift/${CODE_A}/extra`,
        `https://discord.gift`,
        `javascript://discord.gift/${CODE_A}`,
        `ftp://discord.gift/${CODE_A}`,
    ];
    for (const url of rejected) {
        assert.deepEqual(parseGiftCodesFromContent(url), [], url);
    }
});

test("hosts, paths and payloads with extra credentials or noise are rejected", () => {
    const rejected = [
        `https://user:pass@discord.gift/${CODE_A}`,
        `https://discord.gift@evil.com/${CODE_A}`,
        `https://discord.gift:8080/${CODE_A}`,
        `https://discord.gift/${CODE_A}?utm_source=x`,
        `https://discord.gift/${CODE_A}#frag`,
        `https://discord.gift/AB-CD-EFGH-IJKLMN`,
        `https://discord.gift/AB%2FCD`,
        `https://discord.gift/short`,
        `https://discord.gift/${"A".repeat(33)}`,
        "discord.gift/",
    ];
    for (const url of rejected) {
        assert.deepEqual(parseGiftCodesFromContent(url), [], url);
    }
});

test("embeds and components are never read", () => {
    const message = makeMessage("1", {
        content: "",
        embeds: [{ description: `https://discord.gift/${CODE_A}`, title: `discord.com/gifts/${CODE_B}` }],
        components: [{
            type: 2,
            url: `https://discord.com/gifts/${CODE_C}`,
            label: `discord.gift/${CODE_A}`,
            components: [{ content: `https://app.com/gifts/${CODE_C}` }],
        }],
    });
    assert.deepEqual(extractGiftCodes(message), { codes: [], source: "none" });
});

test("code case is preserved and case variants collapse to the first spelling", () => {
    const content = [
        `https://discord.gift/${CODE_C}`,
        `https://discord.gift/${CODE_C.toUpperCase()}`,
        `https://discord.gift/${CODE_C.toLowerCase()}`,
    ].join(" ");
    assert.deepEqual(parseGiftCodesFromContent(content), [CODE_C]);
    assert.deepEqual(extractGiftCodes(makeMessage("1", { giftCodes: [CODE_C, CODE_C.toUpperCase()] })), {
        codes: [CODE_C],
        source: "giftCodes",
    });
});

test("normalizeGiftCode rejects everything outside the gift code shape", () => {
    assert.equal(normalizeGiftCode(`  ${CODE_A}  `), CODE_A);
    assert.equal(normalizeGiftCode(CODE_A.length - 1), null);
    assert.equal(normalizeGiftCode("A".repeat(33)), null);
    assert.equal(normalizeGiftCode("abc_def_ghijklmn"), null);
    assert.equal(normalizeGiftCode(12345), null);
    assert.equal(normalizeGiftCode(undefined), null);
    assert.equal(normalizeGiftCode(""), null);
});

test("state hands out a message's codes once and keeps them current", () => {
    const state = createMessageCodeState();
    const first = state.sync(contentMessage("1", `https://discord.gift/${CODE_A}`));
    assert.deepEqual(first, [CODE_A]);
    assert.equal(state.isCurrentCode(CODE_A), true);
    assert.equal(state.isCurrentCode(CODE_A.toLowerCase()), true);
    assert.equal(state.isCurrentCode(CODE_B), false);
    assert.deepEqual(state.codesForMessage("1"), [CODE_A]);

    assert.deepEqual(state.sync(contentMessage("1", `https://discord.gift/${CODE_A}`)), []);
    assert.deepEqual(state.codesForMessage("1"), [CODE_A]);
    assert.deepEqual(state.codesForMessage("missing"), []);
});

test("deferred observation preserves codes until they are claimed", () => {
    const state = createMessageCodeState();
    const message = contentMessage("1", `https://discord.gift/${CODE_A} https://discord.gift/${CODE_B}`);
    assert.deepEqual(state.sync(message, { emit: false }), [CODE_A, CODE_B]);
    state.claim("1", CODE_A);
    assert.deepEqual(state.sync(message, { emit: false }), [CODE_B]);
    state.claim("1", CODE_B);
    assert.deepEqual(state.sync(message, { emit: false }), []);
});

test("released codes can be admitted again after cancellation", () => {
    const state = createMessageCodeState();
    const message = contentMessage("1", `https://discord.gift/${CODE_A}`);
    assert.deepEqual(state.sync(message), [CODE_A]);
    state.release("1", CODE_A);
    assert.deepEqual(state.sync(message), [CODE_A]);
});

test("an update only yields codes the message did not advertise before", () => {
    const state = createMessageCodeState();
    assert.deepEqual(state.sync(contentMessage("1", `https://discord.gift/${CODE_A}`)), [CODE_A]);
    assert.deepEqual(state.sync(contentMessage("1", `https://discord.gift/${CODE_A} https://discord.gift/${CODE_B}`)), [CODE_B]);
    assert.deepEqual(state.codesForMessage("1"), [CODE_A, CODE_B]);
    assert.equal(state.isCurrentCode(CODE_C), false);
});

test("an update that drops a code makes it no longer current", () => {
    const state = createMessageCodeState();
    state.sync(contentMessage("1", `https://discord.gift/${CODE_A} https://discord.com/gifts/${CODE_B}`));
    const added = state.sync(contentMessage("1", `https://discord.com/gifts/${CODE_B}`));
    assert.deepEqual(added, []);
    assert.deepEqual(state.codesForMessage("1"), [CODE_B]);
    assert.equal(state.isCurrentCode(CODE_A), false);
    assert.equal(state.isCurrentCode(CODE_B), true);

    const reintroduced = state.sync(contentMessage("1", `https://discord.com/gifts/${CODE_B} https://discord.gift/${CODE_A}`));
    assert.deepEqual(reintroduced, [], "a code already handed out is never re-emitted");
    assert.deepEqual(state.codesForMessage("1"), [CODE_B, CODE_A]);
    assert.equal(state.isCurrentCode(CODE_A), true);
});

test("deleting a message blocks that message without suppressing reposts", () => {
    const state = createMessageCodeState();
    state.sync(contentMessage("1", `https://discord.gift/${CODE_A} https://discord.com/gifts/${CODE_B}`));
    assert.deepEqual(state.remove("1"), [CODE_A, CODE_B]);
    assert.deepEqual(state.codesForMessage("1"), []);
    assert.equal(state.isCurrentCode(CODE_A), false);
    assert.equal(state.isCurrentCode(CODE_B), false);

    assert.deepEqual(state.remove("1"), [], "removing twice is a no-op");
    assert.deepEqual(state.sync(contentMessage("1", `https://discord.gift/${CODE_A}`)), [], "a deleted message cannot resurrect");
    assert.deepEqual(state.sync(contentMessage("2", `https://discord.gift/${CODE_A}`)), [CODE_A], "a repost in a new message remains eligible");
    assert.deepEqual(state.sync(contentMessage("2", `https://discord.gift/${CODE_C}`)), [CODE_C], "other codes still flow");
    assert.deepEqual(state.remove("missing"), []);
});

test("reset clears live records and tombstones", () => {
    const state = createMessageCodeState();
    state.sync(contentMessage("1", `https://discord.gift/${CODE_A}`));
    state.remove("1");
    state.reset();
    assert.deepEqual(state.sync(contentMessage("2", `https://discord.gift/${CODE_A}`)), [CODE_A]);
});

test("messages without codes leave no state behind", () => {
    const state = createMessageCodeState();
    assert.deepEqual(state.sync(contentMessage("1", "just chatting")), []);
    assert.deepEqual(state.codesForMessage("1"), []);
    assert.deepEqual(state.sync(makeMessage("2")), []);
    assert.deepEqual(state.remove("1"), []);
});
