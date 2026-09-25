/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const externalClaims = new Set<string>();
const releaseListeners = new Set<() => void>();

export function markExternalClaim(code: string) {
    externalClaims.add(code.toUpperCase());
}

export function releaseExternalClaim(code: string) {
    externalClaims.delete(code.toUpperCase());
    for (const listener of releaseListeners) {
        try { listener(); } catch (error) { void error; }
    }
}

export function onExternalClaimRelease(listener: () => void) {
    releaseListeners.add(listener);
    return () => releaseListeners.delete(listener);
}

export function isExternalClaimed(code: string) {
    return externalClaims.has(code.toUpperCase());
}
