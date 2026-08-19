/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { showError } from "../ui/statusCard";
import GifRenderer from "./gifRenderer";
const MIN_FRAME_LENGTH = 1000 / 50;
const MAX_VIDEO_DURATION_SECONDS = 30;
const MAX_VIDEO_FRAMES = 600;
const MAX_VIDEO_PIXELS = 4_000_000;
function waitForLoadedData(video) {
    if (video.readyState >= 2)
        return Promise.resolve(true);
    return new Promise(resolve => {
        const cleanup = () => {
            video.removeEventListener("loadeddata", handleLoadedData);
            video.removeEventListener("error", handleError);
            clearTimeout(timer);
        };
        const handleLoadedData = () => {
            cleanup();
            resolve(true);
        };
        const handleError = () => {
            cleanup();
            resolve(false);
        };
        const timer = setTimeout(() => {
            cleanup();
            resolve(false);
        }, 5000);
        video.addEventListener("loadeddata", handleLoadedData, { once: true });
        video.addEventListener("error", handleError, { once: true });
    });
}
function seekTo(video, time) {
    return new Promise(resolve => {
        const targetTime = Math.max(0, time);
        if (Math.abs(video.currentTime - targetTime) < 0.001) {
            resolve(true);
            return;
        }
        const cleanup = () => {
            video.removeEventListener("seeked", handleSeeked);
            video.removeEventListener("error", handleError);
            clearTimeout(timer);
        };
        const handleSeeked = () => {
            cleanup();
            resolve(true);
        };
        const handleError = () => {
            cleanup();
            resolve(false);
        };
        const timer = setTimeout(() => {
            cleanup();
            resolve(false);
        }, 4000);
        video.addEventListener("seeked", handleSeeked, { once: true });
        video.addEventListener("error", handleError, { once: true });
        video.currentTime = targetTime;
    });
}
async function renderVideoWithElement({ transform }) {
    const video = transform.sourceVideo;
    if (!video) {
        showError("Failed to load video.");
        return;
    }
    try {
        if (!await waitForLoadedData(video)) {
            showError("Failed to load video.");
            return;
        }
        if (!await seekTo(video, 0)) {
            showError("Failed to read video metadata.");
            return;
        }
        const width = transform.width || video.videoWidth;
        const height = transform.height || video.videoHeight;
        if (!width || !height) {
            showError("Failed to read video metadata.");
            return;
        }
        if (width * height > MAX_VIDEO_PIXELS) {
            showError("Video is too large to caption safely.");
            return;
        }
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        if (!duration) {
            showError("Failed to read video metadata.");
            return;
        }
        if (duration > MAX_VIDEO_DURATION_SECONDS) {
            showError("Video is too long to caption safely.");
            return;
        }
        const frameEstimate = Math.min(MAX_VIDEO_FRAMES, Math.max(1, Math.ceil(duration * 1000 / MIN_FRAME_LENGTH)));
        const renderer = new GifRenderer({ frames: frameEstimate, width, height, transform });
        const step = duration / frameEstimate;
        const delay = Math.max(MIN_FRAME_LENGTH, step * 1000);
        renderer.addVideoFrame(video, delay);
        let time = step;
        for (let frame = 1; frame < frameEstimate; frame++) {
            const ok = await seekTo(video, time);
            if (!ok)
                break;
            renderer.addVideoFrame(video, delay);
            time += step;
        }
        renderer.render();
    }
    finally {
        video.pause();
    }
}
export default async function captionMp4(_media, transform) {
    await renderVideoWithElement({
        transform
    });
}
