/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const CODE_PATTERN = /^[A-Za-z0-9]{16,32}$/;
const GIFT_LINK = /(?:https?:\/\/)?(?:discord\.gift|discord\.com|app\.com)\/[^\s<>"'`\\*_~]*/gi;
const URL_LEAD = /[\s"'`~*([<_]/;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/;
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;
const MAX_DELETED_MESSAGES = 2048;
const MAX_RECORDS = 5000;

export interface GiftCodeMessage {
    readonly id: string;
    readonly content?: string;
    readonly giftCodes?: unknown;
}

export type GiftCodeSource = "giftCodes" | "content" | "none";

export interface GiftCodeExtraction {
    codes: string[];
    source: GiftCodeSource;
}

export interface MessageCodeState {
    /** Returns codes not handed out before; optionally defer marking them as emitted. */
    sync(message: GiftCodeMessage, options?: { emit?: boolean; }): string[];
    /** Marks a currently observed code as handed out. */
    claim(messageId: string, code: string): void;
    /** Releases a code that was canceled before submission. */
    release(messageId: string, code: string): void;
    /** Returns the codes the message stopped advertising, then tombstones them. */
    remove(messageId: string): string[];
    codesForMessage(messageId: string): string[];
    isCurrentCode(code: string): boolean;
    reset(): void;
}

export function normalizeGiftCode(raw: unknown): string | null {
    if (typeof raw !== "string") return null;
    const code = raw.trim();
    return CODE_PATTERN.test(code) ? code : null;
}

function canonical(code: string): string {
    return code.toUpperCase();
}

function pushUnique(codes: string[], code: string) {
    const key = canonical(code);
    if (codes.some(existing => canonical(existing) === key)) return;
    codes.push(code);
}

function codeFromUrl(url: URL): string | null {
    if (url.port !== "" || url.username !== "" || url.password !== "") return null;
    if (url.search !== "" || url.hash !== "") return null;
    const segments = url.pathname.split("/");
    if (url.hostname === "discord.gift") {
        return segments.length === 2 ? normalizeGiftCode(segments[1]) : null;
    }
    if (url.hostname === "discord.com" || url.hostname === "app.com") {
        if (segments.length !== 3 || !["gift", "gifts"].includes(segments[1].toLowerCase())) return null;
        return normalizeGiftCode(segments[2]);
    }
    return null;
}

// Only http(s) reaches codeFromUrl: GIFT_LINK is the scheme allowlist, and a
// schemeless paste is upgraded to https before parsing. Everything else in a
// message (embeds, component labels, titles) is never read.
export function parseGiftCodesFromContent(content: unknown): string[] {
    if (typeof content !== "string" || content === "") return [];
    const codes: string[] = [];
    for (const match of content.matchAll(GIFT_LINK)) {
        const start = match.index ?? 0;
        if (start > 0 && !URL_LEAD.test(content[start - 1])) continue;
        const token = match[0].replace(TRAILING_PUNCTUATION, "");
        if (token === "") continue;
        let url: URL;
        try {
            url = new URL(SCHEME.test(token) ? token : `https://${token}`);
        } catch {
            continue;
        }
        const code = codeFromUrl(url);
        if (code) pushUnique(codes, code);
    }
    return codes;
}

function readGiftCodeField(field: unknown): string[] {
    if (!Array.isArray(field)) return [];
    const codes: string[] = [];
    for (const entry of field) {
        const code = normalizeGiftCode(entry);
        if (code) pushUnique(codes, code);
    }
    return codes;
}

export function extractGiftCodes(message: GiftCodeMessage): GiftCodeExtraction {
    const field = readGiftCodeField(message.giftCodes);
    if (field.length) return { codes: field, source: "giftCodes" };
    const codes = parseGiftCodesFromContent(message.content);
    return { codes, source: codes.length ? "content" : "none" };
}

interface MessageRecord {
    codes: string[];
    emitted: Set<string>;
}

export function createMessageCodeState(): MessageCodeState {
    const records = new Map<string, MessageRecord>();
    const deletedMessageIds = new Set<string>();

    return {
        sync(message, options) {
            if (deletedMessageIds.has(message.id)) return [];
            const existing = records.get(message.id);
            const record = existing ?? { codes: [], emitted: new Set<string>() };
            const { codes } = extractGiftCodes(message);
            const fresh: string[] = [];
            const emit = options?.emit !== false;
            for (const code of codes) {
                const key = canonical(code);
                if (record.emitted.has(key)) continue;
                if (emit) record.emitted.add(key);
                fresh.push(code);
            }
            record.codes = codes;
            if (codes.length || existing) {
                records.delete(message.id);
                records.set(message.id, record);
                while (records.size > MAX_RECORDS) {
                    const oldest = records.keys().next();
                    if (oldest.done || oldest.value === message.id) break;
                    records.delete(oldest.value);
                }
            }
            return fresh;
        },

        claim(messageId, code) {
            const record = records.get(messageId);
            const normalized = normalizeGiftCode(code);
            if (!record || !normalized) return;
            if (record.codes.some(current => canonical(current) === canonical(normalized))) {
                record.emitted.add(canonical(normalized));
            }
        },

        release(messageId, code) {
            const record = records.get(messageId);
            const normalized = normalizeGiftCode(code);
            if (record && normalized) record.emitted.delete(canonical(normalized));
        },

        remove(messageId) {
            deletedMessageIds.add(messageId);
            while (deletedMessageIds.size > MAX_DELETED_MESSAGES) {
                const oldest = deletedMessageIds.values().next();
                if (oldest.done) break;
                deletedMessageIds.delete(oldest.value);
            }
            const record = records.get(messageId);
            if (!record) return [];
            records.delete(messageId);
            const removed = record.codes;
            record.codes = [];
            return removed;
        },

        codesForMessage(messageId) {
            const record = records.get(messageId);
            return record ? [...record.codes] : [];
        },

        isCurrentCode(code) {
            const normalized = normalizeGiftCode(code);
            if (normalized === null) return false;
            const key = canonical(normalized);
            for (const record of records.values()) {
                if (record.codes.some(current => canonical(current) === key)) return true;
            }
            return false;
        },

        reset() {
            records.clear();
            deletedMessageIds.clear();
        },
    };
}
