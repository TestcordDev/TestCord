/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { sleep } from "@utils/misc";
import { decompressFrames, parseGIF } from "gifuct-js";

import type { CaptionMedia, GifTransform } from "../types";
import { showError } from "../ui/statusCard";
import { looksLikeGif } from "../utils/media";
import GifRenderer from "./gifRenderer";
import captionMp4 from "./mp4";

const MAX_GIF_FRAMES = 600;
const MAX_GIF_DURATION_MS = 30_000;
const MAX_GIF_PIXELS = 4_000_000;

export default async function captionGif(media: CaptionMedia, transform: GifTransform) {
    if (!looksLikeGif(media)) {
        await captionMp4(media, transform);
        return;
    }

    const parsed = parseGIF(media.buffer);
    if (parsed.lsd.width * parsed.lsd.height > MAX_GIF_PIXELS || transform.width * transform.height > MAX_GIF_PIXELS) {
        showError("GIF is too large to caption safely.");
        return;
    }

    const frames = decompressFrames(parsed, true);
    const duration = frames.reduce((total, frame) => total + frame.delay, 0);
    if (frames.length > MAX_GIF_FRAMES || duration > MAX_GIF_DURATION_MS) {
        showError("GIF is too long to caption safely.");
        return;
    }
    const renderer = new GifRenderer({
        frames: frames.length,
        width: transform.width,
        height: transform.height,
        transform
    });

    for (const frame of frames) {
        renderer.addGifFrame(frame, parsed);
        await sleep(0);
    }

    renderer.render();
}
