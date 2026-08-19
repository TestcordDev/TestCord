/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { GIFEncoder, nearestColorIndex, quantize } from "gifenc";
import { getSelectedFont } from "../index";
import { showError } from "../ui/statusCard";
import { getLines } from "../utils/canvas";
import { getMaxFileSize } from "../utils/permissions";
import { uploadFile } from "../utils/upload";
const MAX_CANVAS_PIXELS = 4_000_000;
function rgb888ToRgb565(r, g, b) {
    return ((r << 8) & 0xf800) | ((g << 3) & 0x07e0) | (b >> 3);
}
function getCanvasContext(canvas) {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
        throw new Error("Failed to create canvas context.");
    }
    return context;
}
function applyPaletteTransparent(data, palette, threshold) {
    const cache = new Array(2 ** 16);
    const index = new Uint8Array(Math.floor(data.length / 4));
    for (let i = 0; i < index.length; i++) {
        const r = data[4 * i];
        const g = data[4 * i + 1];
        const b = data[4 * i + 2];
        const a = data[4 * i + 3];
        if (a < threshold) {
            index[i] = 255;
            continue;
        }
        const key = rgb888ToRgb565(r, g, b);
        const cached = cache[key];
        index[i] = cached ?? (cache[key] = nearestColorIndex(palette, [r, g, b]));
    }
    return index;
}
export default class GifRenderer {
    canvas = new OffscreenCanvas(1, 1);
    ctx = getCanvasContext(this.canvas);
    gif = GIFEncoder();
    transform;
    topOffset = 0;
    width;
    height;
    hasFrames = false;
    tempCanvas;
    tempCtx;
    gifCanvas;
    gifCtx;
    frameImageData;
    needsDisposal = false;
    constructor({ frames, width, height, transform }) {
        this.width = width;
        this.height = height;
        this.transform = transform;
        this.ctx.font = `${transform.size}px ${getSelectedFont()}`;
        const lines = getLines(this.ctx, transform.text, this.width);
        const fullHeight = lines.length * transform.size + 10 + this.height;
        const fullSize = fullHeight * this.width;
        const sizeEstimate = fullSize * frames;
        const scaleFactor = Math.max(1, Math.sqrt(sizeEstimate / getMaxFileSize()), Math.sqrt(fullSize / MAX_CANVAS_PIXELS));
        const newWidth = Math.max(1, Math.floor(this.width / scaleFactor));
        const newHeight = Math.max(1, Math.floor(this.height / scaleFactor));
        const newFullHeight = Math.max(1, Math.floor(fullHeight / scaleFactor));
        const newSize = Math.max(1, Math.floor(transform.size / scaleFactor));
        this.width = this.canvas.width = newWidth;
        this.height = newHeight;
        this.canvas.height = newFullHeight;
        this.drawCaption(transform.text, newWidth, newSize);
    }
    addGifFrame(source, parsed) {
        if (!this.tempCanvas)
            this.tempCanvas = new OffscreenCanvas(1, 1);
        if (!this.tempCtx)
            this.tempCtx = getCanvasContext(this.tempCanvas);
        if (!this.gifCanvas) {
            this.gifCanvas = new OffscreenCanvas(parsed.lsd.width, parsed.lsd.height);
            this.gifCanvas.width = parsed.lsd.width;
            this.gifCanvas.height = parsed.lsd.height;
        }
        if (!this.gifCtx)
            this.gifCtx = getCanvasContext(this.gifCanvas);
        if (this.needsDisposal) {
            this.gifCtx.clearRect(0, 0, this.gifCanvas.width, this.gifCanvas.height);
            this.needsDisposal = false;
        }
        if (source.disposalType === 2)
            this.needsDisposal = true;
        if (!this.frameImageData
            || source.dims.width !== this.frameImageData.width
            || source.dims.height !== this.frameImageData.height) {
            this.tempCanvas.width = source.dims.width;
            this.tempCanvas.height = source.dims.height;
            this.frameImageData = this.tempCtx.createImageData(source.dims.width, source.dims.height);
        }
        this.frameImageData.data.set(source.patch);
        this.tempCtx.putImageData(this.frameImageData, 0, 0);
        this.gifCtx.drawImage(this.tempCanvas, source.dims.left, source.dims.top);
        this.ctx.clearRect(0, this.topOffset, this.width, this.height);
        this.ctx.drawImage(this.gifCanvas, 0, this.topOffset, this.width, this.height);
        this.addFrameToGif(source.delay);
    }
    addVideoFrame(source, delay) {
        this.ctx.clearRect(0, this.topOffset, this.width, this.height);
        this.ctx.drawImage(source, 0, this.topOffset, this.width, this.height);
        this.addFrameToGif(delay);
    }
    render() {
        if (!this.hasFrames) {
            showError("Failed to encode GIF.");
            return;
        }
        this.gif.finish();
        const bytes = this.gif.bytesView();
        const file = new File([bytes], "rendered.gif", { type: "image/gif" });
        if (file.size > getMaxFileSize()) {
            showError("Rendered GIF is too large to upload.");
            return;
        }
        uploadFile(file);
    }
    addFrameToGif(delay) {
        const { data } = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        const palette = quantize(data, 255);
        const index = applyPaletteTransparent(data, palette, 1);
        this.gif.writeFrame(index, this.canvas.width, this.canvas.height, {
            delay,
            palette,
            transparent: true,
            transparentIndex: 255
        });
        this.hasFrames = true;
    }
    drawCaption(text, width, size) {
        this.ctx.font = `${size}px ${getSelectedFont()}`;
        const lines = getLines(this.ctx, text, width);
        this.topOffset = lines.length * size + 10;
        this.ctx.fillStyle = "white";
        this.ctx.fillRect(0, 0, width, this.topOffset);
        this.ctx.fillStyle = "black";
        this.ctx.textAlign = "center";
        this.ctx.textBaseline = "top";
        for (let i = 0; i < lines.length; i++) {
            this.ctx.fillText(lines[i], width / 2, size * i + 5);
        }
    }
}
