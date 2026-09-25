/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import test from "node:test";

import { isExternalClaimed, markExternalClaim, onExternalClaimRelease, releaseExternalClaim } from "../src/testcordplugins/autoRedeem/claimFence.ts";

test("fences external claims case-insensitively until release", () => {
    let released = 0;
    const unsubscribe = onExternalClaimRelease(() => { released++; });
    markExternalClaim("AbCd1234");
    assert.equal(isExternalClaimed("abcd1234"), true);
    releaseExternalClaim("ABCD1234");
    assert.equal(isExternalClaimed("AbCd1234"), false);
    assert.equal(released, 1);
    unsubscribe();
});
