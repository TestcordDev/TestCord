/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

function ipv4Parts(address: string): number[] | null {
    const parts = address.split(".").map(Number);
    if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return null;
    return parts;
}

export function isPrivateAddress(address: string): boolean {
    const parts = ipv4Parts(address);
    if (!parts) return false;

    return parts[0] === 10
        || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
        || (parts[0] === 192 && parts[1] === 168);
}

export function isLocalAddress(address: string): boolean {
    const parts = ipv4Parts(address);
    if (!parts) return false;

    return isPrivateAddress(address) || parts[0] === 127 || (parts[0] === 169 && parts[1] === 254);
}
