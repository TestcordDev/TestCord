/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { IconUtils } from "@webpack/common";
const DISCORD_BG = "#313338";
const DISCORD_TEXT = "#dbdee1";
const DISCORD_USERNAME = "#f2f3f5";
const DISCORD_TIMESTAMP = "#949ba4";
const CANVAS_PADDING = 16;
const AVATAR_SIZE = 40;
const DECO_SIZE = 48;
const DECO_OVERLAY_SIZE = 56;
const AVATAR_RIGHT_MARGIN = 12;
const HEADER_TOP_MARGIN = 4;
const NAME_FONT_SIZE = 16;
const TIMESTAMP_FONT_SIZE = 12;
const BODY_FONT_SIZE = 16;
const BODY_LINE_HEIGHT = 22;
const MIN_WIDTH = 400;
const MAX_WIDTH = 600;
const FONT_FAMILY = '"gg sans", "Noto Sans", "Helvetica Neue", Helvetica, Arial, sans-serif';
function fetchImageAsBlob(url) {
    return fetch(url).then(r => {
        if (!r.ok)
            throw new Error(`Failed to fetch image: ${r.status}`);
        return r.blob();
    });
}
async function loadImage(url) {
    const blob = await fetchImageAsBlob(url);
    const img = new Image();
    const blobUrl = URL.createObjectURL(blob);
    try {
        await new Promise((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error("Failed to load image"));
            img.src = blobUrl;
        });
        return img;
    }
    finally {
        URL.revokeObjectURL(blobUrl);
    }
}
function wrapText(ctx, text, maxWidth) {
    if (!text)
        return [""];
    const words = text.split(" ");
    const lines = [];
    let currentLine = "";
    for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        if (ctx.measureText(testLine).width > maxWidth && currentLine) {
            lines.push(currentLine);
            currentLine = word;
        }
        else {
            currentLine = testLine;
        }
    }
    if (currentLine)
        lines.push(currentLine);
    return lines;
}
function getTimestamp() {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes().toString().padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    const h12 = hours % 12 || 12;
    return `Today at ${h12}:${minutes} ${ampm}`;
}
function drawAvatarWithDecoration(ctx, avatar, decoration, centerX, centerY) {
    // Avatar circle
    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, centerY, AVATAR_SIZE / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(avatar, centerX - AVATAR_SIZE / 2, centerY - AVATAR_SIZE / 2, AVATAR_SIZE, AVATAR_SIZE);
    ctx.restore();
    // Decoration ring (drawn over the avatar border)
    if (decoration) {
        const decoX = centerX - DECO_OVERLAY_SIZE / 2;
        const decoY = centerY - DECO_OVERLAY_SIZE / 2;
        ctx.drawImage(decoration, decoX, decoY, DECO_OVERLAY_SIZE, DECO_OVERLAY_SIZE);
    }
}
function drawMessage(ctx, avatar, decoration, author, text, canvasWidth) {
    const contentX = CANVAS_PADDING + AVATAR_SIZE + AVATAR_RIGHT_MARGIN;
    const textAreaWidth = canvasWidth - contentX - CANVAS_PADDING;
    const avatarCenterX = CANVAS_PADDING + AVATAR_SIZE / 2;
    const avatarCenterY = CANVAS_PADDING + AVATAR_SIZE / 2;
    drawAvatarWithDecoration(ctx, avatar, decoration, avatarCenterX, avatarCenterY);
    // Username
    const displayName = author.globalName || author.username;
    ctx.font = `600 ${NAME_FONT_SIZE}px ${FONT_FAMILY}`;
    ctx.fillStyle = DISCORD_USERNAME;
    ctx.fillText(displayName, contentX, CANVAS_PADDING + HEADER_TOP_MARGIN + NAME_FONT_SIZE);
    // Timestamp
    const nameWidth = ctx.measureText(displayName).width;
    ctx.font = `500 ${TIMESTAMP_FONT_SIZE}px ${FONT_FAMILY}`;
    ctx.fillStyle = DISCORD_TIMESTAMP;
    ctx.fillText(getTimestamp(), contentX + nameWidth + 8, CANVAS_PADDING + HEADER_TOP_MARGIN + NAME_FONT_SIZE);
    // Message text baseline sits just below the username line
    const textStartY = CANVAS_PADDING + HEADER_TOP_MARGIN + NAME_FONT_SIZE + BODY_FONT_SIZE + 6;
    ctx.font = `400 ${BODY_FONT_SIZE}px ${FONT_FAMILY}`;
    ctx.fillStyle = DISCORD_TEXT;
    const lines = wrapText(ctx, text, textAreaWidth);
    for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], contentX, textStartY + i * BODY_LINE_HEIGHT);
    }
}
function calculateCanvasSize(ctx, text) {
    const textAreaWidth = MAX_WIDTH - CANVAS_PADDING - AVATAR_SIZE - AVATAR_RIGHT_MARGIN - CANVAS_PADDING;
    const textWidth = ctx.measureText(text).width;
    const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, CANVAS_PADDING + AVATAR_SIZE + AVATAR_RIGHT_MARGIN + textWidth + CANVAS_PADDING + 20));
    const actualTextAreaWidth = width - CANVAS_PADDING - AVATAR_SIZE - AVATAR_RIGHT_MARGIN - CANVAS_PADDING;
    const lines = wrapText(ctx, text, actualTextAreaWidth);
    const textHeight = lines.length * BODY_LINE_HEIGHT;
    const height = CANVAS_PADDING + Math.max(AVATAR_SIZE, BODY_FONT_SIZE + textHeight) + CANVAS_PADDING;
    return { width, height };
}
function getDecorationUrl(user) {
    const decoData = user.avatarDecorationData;
    if (!decoData?.asset)
        return null;
    return `https://cdn.discordapp.com/avatar-decoration-presets/${decoData.asset}.png`;
}
export async function createTextScreenshot(text, author) {
    const avatarUrl = IconUtils.getUserAvatarURL(author, true, 128);
    const decoUrl = getDecorationUrl(author);
    const [avatar, decoration] = await Promise.all([
        loadImage(avatarUrl),
        decoUrl ? loadImage(decoUrl).catch(() => null) : Promise.resolve(null)
    ]);
    const measureCanvas = document.createElement("canvas");
    const measureCtx = measureCanvas.getContext("2d");
    measureCtx.font = `400 ${BODY_FONT_SIZE}px ${FONT_FAMILY}`;
    const { width: canvasWidth, height: canvasHeight } = calculateCanvasSize(measureCtx, text);
    const canvas = document.createElement("canvas");
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = DISCORD_BG;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    drawMessage(ctx, avatar, decoration, author, text, canvasWidth);
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
            if (!blob)
                return reject(new Error("Failed to create blob"));
            resolve(blob);
        }, "image/png");
    });
}
