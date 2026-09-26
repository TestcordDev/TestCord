/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * "When a deleted image fails to load, why not just use the saved on disk one?"
 *
 * The capability already existed: getAttachmentBlobUrl reads the saved bytes, makes a blob
 * url, and repoints att.url / att.proxy_url at it - but only when att.deleted is set. So the
 * bytes were on disk and the mechanism was right; it just never ran on the paths that put a
 * deleted message in front of the user.
 *
 * The subtle part is that a disk read cannot fix it on its own. All three delete handlers
 * mark attachments with `(a.deleted = true), a`, which mutates and returns the same object,
 * and they must write the store synchronously so the patch can suppress Discord's own
 * removal. By the time the read resolves, Discord's image component has already painted the
 * dead CDN url. Mutating the object in place does not create a new record identity, so React
 * never repaints. Hence the deliberate second store write.
 */
const index = readFileSync(
    new URL("../src/testcordplugins/messageLoggerTestcord/index.tsx", import.meta.url),
    "utf8"
);
const saveImage = readFileSync(
    new URL("../src/testcordplugins/messageLoggerTestcord/saveImage.ts", import.meta.url),
    "utf8"
);

const helper = index.match(/function repointDeletedAttachments[\s\S]*?\n\}/);
assert.ok(helper, "repointDeletedAttachments not found");

test("it falls back to the on-disk copy rather than the dead CDN url", () => {
    assert.match(helper[0], /restoreAttachmentBlobs\(atts\)/, "must reuse the existing disk read");
    // Only ever repoints already-deleted attachments; that is the guard getAttachmentBlobUrl
    // itself uses before overwriting url/proxy_url.
    assert.match(saveImage, /if \(att\.deleted\) \{/);
    assert.match(saveImage, /att\.url = url \+ "#";/, "the disk copy is only wired up for deleted attachments");
});

test("it repaints with a new record identity, because in-place mutation is not enough", () => {
    // Same attachment objects, new array. A new array gives the record a new identity so
    // React re-renders and the image picks up the already-mutated local urls.
    assert.match(helper[0], /m\.set\?\.\("attachments", \[\.\.\.m\.attachments\]\)/);
    assert.match(helper[0], /Internal\.commit\?\.\(next\)/, "the rewrite must be committed to the store");
});

test("it only writes the store when a url actually changed", () => {
    // Attachments that were never saved have no path, so nothing resolves and a pointless
    // re-render on every delete would be pure cost.
    assert.match(helper[0], /const before = atts\.map\(a => a\?\.url\);/);
    assert.match(helper[0], /if \(atts\.every\(\(a, i\) => a\?\.url === before\[i\]\)\) return;/);
});

test("it bails when the message is no longer in the store", () => {
    // A delete can land after the user has already navigated away from the channel.
    assert.match(helper[0], /if \(!cache\?\.has\?\.\(messageId\)\) return;/);
});

test("a failed read can never break the delete", () => {
    // Fire and forget: the store write above already happened, so a rejected disk read must
    // not escape as an unhandled rejection.
    assert.match(helper[0], /\.catch\(\(\) => \{ \}\);/);
});

test("all three delete paths are wired up", () => {
    const sites = [...index.matchAll(/repointDeletedAttachments\(/g)];
    // Declaration plus handleStoreDelete, handleStoreDelete2 and reInjectDeletedLive.
    assert.equal(sites.length, 4, `expected 4 references, found ${sites.length}`);
    for (const site of ["reInjectDeletedLive", "handleStoreDelete(cache", "handleStoreDelete2(data"]) {
        assert.ok(index.includes(site), `${site} disappeared`);
    }
});
