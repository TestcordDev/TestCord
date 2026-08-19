/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
function getHeader(buffer, length = 16) {
    return new Uint8Array(buffer, 0, Math.min(buffer.byteLength, length));
}
export function looksLikeGif({ buffer, contentType }) {
    const header = getHeader(buffer, 3);
    return contentType.includes("gif")
        || (header.length >= 3
            && header[0] === 0x47
            && header[1] === 0x49
            && header[2] === 0x46);
}
export function looksLikeVideo({ buffer, contentType }) {
    const header = getHeader(buffer, 12);
    const isMp4Header = header.length >= 8
        && header[4] === 0x66
        && header[5] === 0x74
        && header[6] === 0x79
        && header[7] === 0x70;
    const isWebmHeader = header.length >= 4
        && header[0] === 0x1a
        && header[1] === 0x45
        && header[2] === 0xdf
        && header[3] === 0xa3;
    return contentType.startsWith("video/") || isMp4Header || isWebmHeader;
}
function readGifDimensions(buffer) {
    if (!looksLikeGif({ buffer, contentType: "" }) || buffer.byteLength < 10)
        return null;
    const view = new DataView(buffer);
    return {
        width: view.getUint16(6, true),
        height: view.getUint16(8, true)
    };
}
export async function inspectMedia(buffer, contentType, blob) {
    if (looksLikeVideo({ buffer, contentType })) {
        return {
            height: 0,
            isVideo: true,
            width: 0
        };
    }
    try {
        const bitmap = await createImageBitmap(blob);
        try {
            return {
                height: bitmap.height,
                isVideo: false,
                width: bitmap.width
            };
        }
        finally {
            bitmap.close();
        }
    }
    catch {
        const gifDimensions = readGifDimensions(buffer);
        if (gifDimensions) {
            return {
                ...gifDimensions,
                isVideo: false
            };
        }
        return null;
    }
}
