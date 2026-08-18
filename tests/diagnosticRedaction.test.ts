/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import test from "node:test";

import { redactDiagnosticValue } from "../src/utils/diagnosticRedaction.ts";

test("diagnostic exports redact sensitive strings and fields", () => {
    const redacted = redactDiagnosticValue({
        content: "private message",
        error: "user 123456789012345678 opened https://example.com/a from C:\\Users\\name\\file.txt",
        headers: { authorization: "secret" }
    });

    assert.deepEqual(redacted, {
        content: "[redacted]",
        error: "user [redacted-user-id] opened [redacted-url] from [redacted-path]",
        headers: "[redacted]"
    });
});
