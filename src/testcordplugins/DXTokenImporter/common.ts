/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Shared between the renderer module and the native module so both sides
// always validate and scan for the same token shape.
export const TOKEN_REGEX_SOURCE = "(?:mfa\\.[\\w-]{84}|[\\w-]{24,26}\\.[\\w-]{4,7}\\.[\\w-]{27,40})";
// Electron safeStorage envelope
export const ENCRYPTION_PREFIX = "dQw4w9WgXcQ:";
// Built-in AES-256-GCM envelope used when safeStorage is unavailable
export const FALLBACK_PREFIX = "TIK1:";

export function isEncryptedPayload(value: string): boolean {
    return value.startsWith(ENCRYPTION_PREFIX) || value.startsWith(FALLBACK_PREFIX);
}

// Shape of Discord's GET /users/@me response as far as this plugin cares.
export interface CheckTokenUser {
    id: string;
    username: string;
    global_name?: string;
    discriminator?: string;
    avatar?: string | null;
}
