/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { brushCanvas } from "@equicordplugins/remix/editor/components/Canvas";
export function fillCircle(x, y, radius, canvas = brushCanvas) {
    canvas.beginPath();
    canvas.arc(x, y, radius, 0, Math.PI * 2);
    canvas.fill();
}
export function strokeCircle(x, y, radius, canvas = brushCanvas) {
    canvas.beginPath();
    canvas.arc(x, y, radius, 0, Math.PI * 2);
    canvas.stroke();
}
export function line(x1, y1, x2, y2, canvas = brushCanvas) {
    canvas.beginPath();
    canvas.moveTo(x1, y1);
    canvas.lineTo(x2, y2);
    canvas.stroke();
}
export function dist(x1, y1, x2, y2) {
    return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}
export function widthFromBounds(bounds) {
    return bounds.right - bounds.left;
}
export function heightFromBounds(bounds) {
    return bounds.bottom - bounds.top;
}
export async function urlToImage(url) {
    return new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.src = url;
    });
}
export function imageToBlob(image) {
    return new Promise(resolve => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        canvas.width = image.width;
        canvas.height = image.height;
        ctx.drawImage(image, 0, 0);
        canvas.toBlob(blob => {
            if (!blob)
                return;
            resolve(new File([blob], "image.png", { type: "image/png" }));
        });
    });
}
