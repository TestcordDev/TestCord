/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
export function getMimeFromExtension(filename, fallback = "application/octet-stream") {
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    switch (ext) {
        case "png":
            return "image/png";
        case "jpg":
        case "jpeg":
            return "image/jpeg";
        case "webp":
            return "image/webp";
        case "gif":
            return "image/gif";
        case "mp4":
            return "video/mp4";
        case "webm":
            return "video/webm";
        case "mp3":
            return "audio/mpeg";
        case "wav":
            return "audio/wav";
        case "ogg":
            return "audio/ogg";
        default:
            if (["apng", "heic", "heif", "tiff", "bmp", "ico"].includes(ext)) {
                return `image/${ext}`;
            }
            return fallback;
    }
}
