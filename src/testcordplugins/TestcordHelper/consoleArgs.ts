/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const ARG_MAX = 500;
const ARG_ITEMS = 6;
const ARG_VALUE_MAX = 80;
/** Object levels expanded before collapsing to `{…}`. Two is enough for triage payloads. */
const ARG_DEPTH = 2;

/**
 * Render one console argument for the LiveFix buffer.
 *
 * Every console call in the client passes through here, so this must stay cheap and
 * must never throw: it runs inside the global console override, and an exception here
 * would break the caller instead of reaching the real console. The previous version
 * ran a full `JSON.stringify` on any object argument and only then applied
 * `.slice(0, 500)`, so a multi-megabyte object was fully serialised and discarded.
 *
 * Values are still rendered, because the buffer is the documented crash triage path
 * and payloads like `{ avError: "NO_AUDIO" }` or `[{ code: "AVError" }]` have to stay
 * greppable. They are just rendered shallowly, with a hard depth, item-count and
 * width budget.
 */
export function describeConsoleArg(a: any): string {
    try {
        return renderArg(a, 0);
    } catch {
        try { return String(a).slice(0, ARG_MAX); } catch { return "[unprintable]"; }
    }
}

function renderArg(a: any, depth: number): string {
    if (a === null) return "null";

    const type = typeof a;
    if (type === "string") return a.slice(0, ARG_MAX);
    if (type !== "object") return String(a).slice(0, ARG_MAX);

    if (a instanceof Error) return (a.stack ?? `${a.name}: ${a.message}`).slice(0, ARG_MAX);

    const ctorName = a.constructor?.name;
    const prefix = ctorName && ctorName !== "Object" && ctorName !== "Array" ? `[${ctorName}]` : "";

    if (Array.isArray(a)) {
        // Bounded on both axes: a wide array of wide strings must not be able to eat a
        // whole buffer entry, and a self-referential array must not recurse to RangeError.
        if (depth >= ARG_DEPTH) return `${prefix.slice(0, ARG_MAX)}[…]`;
        const shown = a.slice(0, ARG_ITEMS).map(v => renderArg(v, depth + 1).slice(0, ARG_VALUE_MAX));
        const rest = a.length > ARG_ITEMS ? `, +${a.length - ARG_ITEMS}` : "";
        return `${prefix}[${shown.join(", ")}${rest}]`.slice(0, ARG_MAX);
    }

    if (depth >= ARG_DEPTH) return `${prefix.slice(0, ARG_MAX)}{…}`;

    const parts: string[] = [];
    for (const key in a) {
        if (parts.length >= ARG_ITEMS) { parts.push("…"); break; }
        parts.push(`${key.slice(0, 32)}=${renderArg(a[key], depth + 1).slice(0, ARG_VALUE_MAX)}`);
    }
    return `${prefix}{${parts.join(", ")}}`.slice(0, ARG_MAX);
}
