/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const TOKEN = /\b[\w-]{20,}\.[\w-]{5,}\.[\w-]{20,}\b/g;
const URL = /https?:\/\/[^\s"'<>]+/gi;
const USER_ID = /\b\d{17,20}\b/g;
const WINDOWS_PATH = /\b[A-Za-z]:\\[^\r\n"']+/g;
const POSIX_PATH = /\/(?:Users|home|tmp|var\/folders)\/[^\r\n"']+/g;
const AUTHORIZATION = /(authorization\s*[:=]\s*)([^\s,;}]+)/gi;

export function redactDiagnosticString(value: string): string {
    return value
        .replace(AUTHORIZATION, "$1[redacted]")
        .replace(TOKEN, "[redacted-token]")
        .replace(URL, "[redacted-url]")
        .replace(WINDOWS_PATH, "[redacted-path]")
        .replace(POSIX_PATH, "[redacted-path]")
        .replace(USER_ID, "[redacted-user-id]");
}

export function redactDiagnosticValue(value: unknown): unknown {
    if (typeof value === "string") return redactDiagnosticString(value);
    if (Array.isArray(value)) return value.map(redactDiagnosticValue);
    if (value == null || typeof value !== "object") return value;

    const redacted: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
        redacted[key] = /^(?:content|message|headers?|token|authorization)$/i.test(key)
            ? "[redacted]"
            : redactDiagnosticValue(nested);
    }
    return redacted;
}
