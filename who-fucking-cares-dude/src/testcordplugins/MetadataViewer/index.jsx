/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { findGroupChildrenByChildId } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { SafetyIcon } from "@components/Icons";
import { TestcordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import { openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { Menu, MessageStore, React, UploadHandler } from "@webpack/common";
import { MetadataScannerModal } from "./modal";
import { getMimeFromExtension } from "./utils";
const logger = new Logger("MetadataScanner");
const settings = definePluginSettings({
    autoStripMetadata: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Automatically strip metadata from images before sending them.",
        default: false,
    }
});
let originalPromptToUpload;
function stripPngMetadata(buffer) {
    const view = new DataView(buffer);
    if (view.byteLength < 8 || view.getUint32(0) !== 0x89504E47 || view.getUint32(4) !== 0x0D0A1A0A) {
        return buffer;
    }
    const newChunks = [];
    newChunks.push(new Uint8Array(buffer, 0, 8)); // PNG Signature
    let offset = 8;
    while (offset < view.byteLength - 12) {
        const length = view.getUint32(offset);
        const typeBytes = new Uint8Array(buffer, offset + 4, 4);
        const type = String.fromCharCode(...typeBytes);
        const chunkLength = 12 + length;
        if (offset + chunkLength > view.byteLength)
            break;
        // Keep only critical chunks
        if (type === "IHDR" || type === "IDAT" || type === "PLTE" || type === "IEND") {
            newChunks.push(new Uint8Array(buffer, offset, chunkLength));
        }
        offset += chunkLength;
    }
    const totalLen = newChunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const output = new Uint8Array(totalLen);
    let newOffset = 0;
    for (const chunk of newChunks) {
        output.set(chunk, newOffset);
        newOffset += chunk.length;
    }
    return output.buffer;
}
function stripJpegMetadata(buffer) {
    const view = new DataView(buffer);
    if (view.byteLength < 4 || view.getUint16(0) !== 0xFFD8) {
        return buffer;
    }
    const newSegments = [];
    newSegments.push(new Uint8Array([0xFF, 0xD8])); // SOI
    let offset = 2;
    while (offset < view.byteLength - 3) {
        const marker = view.getUint16(offset);
        if ((marker & 0xFF00) !== 0xFF00) {
            offset++;
            continue;
        }
        const markerType = marker & 0xFF;
        if (markerType === 0x00 || markerType === 0xFF) {
            offset++;
            continue;
        }
        if (markerType === 0xD9) { // EOI
            newSegments.push(new Uint8Array([0xFF, 0xD9]));
            offset += 2;
            break;
        }
        if (markerType === 0xDA) { // SOS - Start of Scan
            // Append SOS and the rest of the file directly
            newSegments.push(new Uint8Array(buffer, offset));
            break;
        }
        const length = view.getUint16(offset + 2);
        const segmentLength = 2 + length;
        if (offset + segmentLength > view.byteLength)
            break;
        // Exclude APP1 (0xE1) and COM (0xFE)
        if (markerType !== 0xE1 && markerType !== 0xFE) {
            newSegments.push(new Uint8Array(buffer, offset, segmentLength));
        }
        offset += segmentLength;
    }
    const totalLen = newSegments.reduce((acc, segment) => acc + segment.length, 0);
    const output = new Uint8Array(totalLen);
    let newOffset = 0;
    for (const segment of newSegments) {
        output.set(segment, newOffset);
        newOffset += segment.length;
    }
    return output.buffer;
}
function stripWebpMetadata(buffer) {
    const view = new DataView(buffer);
    if (view.byteLength < 12 || view.getUint32(0) !== 0x52494646 || view.getUint32(8) !== 0x57454250) {
        return buffer;
    }
    const newChunks = [];
    let offset = 12;
    while (offset < view.byteLength - 8) {
        const typeBytes = new Uint8Array(buffer, offset, 4);
        const type = String.fromCharCode(...typeBytes);
        const size = view.getUint32(offset + 4, true);
        const pad = size % 2 === 1 ? 1 : 0;
        const totalChunkLen = 8 + size + pad;
        if (offset + totalChunkLen > view.byteLength)
            break;
        // Exclude EXIF chunk
        if (type !== "EXIF") {
            newChunks.push(new Uint8Array(buffer, offset, totalChunkLen));
        }
        offset += totalChunkLen;
    }
    const chunksLen = newChunks.reduce((acc, c) => acc + c.length, 0);
    const riffHeader = new Uint8Array(12);
    riffHeader.set(new Uint8Array(buffer, 0, 4), 0); // "RIFF"
    const viewHeader = new DataView(riffHeader.buffer);
    viewHeader.setUint32(4, 4 + chunksLen, true);
    riffHeader.set(new Uint8Array(buffer, 8, 4), 8); // "WEBP"
    const output = new Uint8Array(12 + chunksLen);
    output.set(riffHeader, 0);
    let newOffset = 12;
    for (const chunk of newChunks) {
        output.set(chunk, newOffset);
        newOffset += chunk.length;
    }
    return output.buffer;
}
async function stripImageMetadata(file) {
    try {
        const arrayBuffer = await file.arrayBuffer();
        let strippedBuffer;
        if (file.type === "image/png" || file.name.endsWith(".png")) {
            strippedBuffer = stripPngMetadata(arrayBuffer);
        }
        else if (file.type === "image/jpeg" || file.name.endsWith(".jpg") || file.name.endsWith(".jpeg")) {
            strippedBuffer = stripJpegMetadata(arrayBuffer);
        }
        else if (file.type === "image/webp" || file.name.endsWith(".webp")) {
            strippedBuffer = stripWebpMetadata(arrayBuffer);
        }
        else {
            return file;
        }
        return new File([strippedBuffer], file.name, { type: file.type });
    }
    catch (e) {
        logger.error("Failed to strip metadata from file " + file.name, e);
        return file;
    }
}
function resolveMediaFromProps(props) {
    if (!props)
        return null;
    const { mediaItem, attachment: propsAttachment, attachmentUrl, message: propsMessage, channelId, messageId } = props;
    let message = propsMessage;
    if (!message && channelId && messageId) {
        try {
            message = MessageStore.getMessage(channelId, messageId);
        }
        catch (e) {
            logger.error("Failed to retrieve message from store", e);
        }
    }
    let attachment = propsAttachment;
    if (!attachment && message && mediaItem) {
        attachment = message.attachments?.find(a => a.proxy_url === mediaItem.proxyUrl ||
            a.url === mediaItem.url ||
            a.proxy_url === mediaItem.url ||
            a.url === mediaItem.proxyUrl);
    }
    if (!attachment && message?.messageSnapshots) {
        for (const snapshot of message.messageSnapshots) {
            const snapMsg = snapshot.message;
            if (!snapMsg)
                continue;
            if (mediaItem) {
                attachment = snapMsg.attachments?.find(a => a.proxy_url === mediaItem.proxyUrl ||
                    a.url === mediaItem.url ||
                    a.proxy_url === mediaItem.url ||
                    a.url === mediaItem.proxyUrl);
            }
            if (!attachment && snapMsg.attachments && snapMsg.attachments.length > 0) {
                attachment = snapMsg.attachments[0];
            }
            if (attachment)
                break;
        }
    }
    if (!attachment && message?.attachments && message.attachments.length > 0) {
        attachment = message.attachments[0];
    }
    let url = attachment?.url ||
        attachment?.proxy_url ||
        mediaItem?.url ||
        mediaItem?.proxyUrl ||
        attachmentUrl ||
        props.itemSrc ||
        props.itemHref;
    if (!url && message?.embeds && message.embeds.length > 0) {
        for (const embed of message.embeds) {
            const embedMediaUrl = embed.video?.url || embed.image?.url || embed.thumbnail?.url || embed.url;
            if (embedMediaUrl && (embedMediaUrl.startsWith("http://") || embedMediaUrl.startsWith("https://"))) {
                url = embedMediaUrl;
                break;
            }
        }
    }
    if (!url && message?.content) {
        const urlMatch = message.content.match(/(https?:\/\/[^\s]+\.(png|jpg|jpeg|gif|webp|mp4|webm|mov|mp3|wav|ogg))/i);
        if (urlMatch) {
            url = urlMatch[1];
        }
    }
    if (!url)
        return null;
    const name = attachment?.filename ||
        attachment?.title ||
        mediaItem?.filename ||
        mediaItem?.name ||
        url.split("/").pop()?.split("?")[0] ||
        "file";
    let mimeType = attachment?.content_type ||
        mediaItem?.contentType ||
        "";
    if (!mimeType) {
        mimeType = getMimeFromExtension(name);
    }
    const size = attachment?.size ||
        mediaItem?.size ||
        0;
    return { url, name, mimeType, size };
}
function hasItemWithId(children, id) {
    for (const child of children) {
        if (!child)
            continue;
        if (child.props?.id === id)
            return true;
        if (Array.isArray(child.props?.children)) {
            if (hasItemWithId(child.props.children, id))
                return true;
        }
    }
    return false;
}
function MessageContextMenu(children, props) {
    try {
        if (hasItemWithId(children, "metadata-scanner-scan") || hasItemWithId(children, "metadata-scanner-scan-image")) {
            return;
        }
        const resolved = resolveMediaFromProps(props);
        if (!resolved)
            return;
        const { url, name, mimeType, size } = resolved;
        const targetGroup = findGroupChildrenByChildId("vc-analyze-ha-file", children)
            || findGroupChildrenByChildId("vc-analyze-vt", children)
            || findGroupChildrenByChildId("vc-analyze-dangecord", children)
            || findGroupChildrenByChildId("copy-text", children)
            || findGroupChildrenByChildId("copy-link", children)
            || children;
        targetGroup.push(<Menu.MenuItem id="metadata-scanner-scan" label="Scan Metadata" icon={SafetyIcon} action={() => {
                openModal(modalProps => (<MetadataScannerModal rootProps={modalProps} url={url} name={name} mimeType={mimeType} size={size}/>));
            }}/>);
    }
    catch (e) {
        logger.error("Error adding scan metadata to message context menu", e);
    }
}
function ImageContextMenu(children, props) {
    try {
        if (hasItemWithId(children, "metadata-scanner-scan") || hasItemWithId(children, "metadata-scanner-scan-image")) {
            return;
        }
        const url = props?.src;
        if (!url)
            return;
        const name = url.split("/").pop()?.split("?")[0] || "image.png";
        const mimeType = getMimeFromExtension(name, "image/png");
        const targetGroup = findGroupChildrenByChildId("vc-analyze-ha-file", children)
            || findGroupChildrenByChildId("vc-analyze-vt", children)
            || findGroupChildrenByChildId("vc-analyze-dangecord", children)
            || findGroupChildrenByChildId("copy-text", children)
            || findGroupChildrenByChildId("copy-link", children)
            || children;
        targetGroup.push(<Menu.MenuItem id="metadata-scanner-scan-image" label="Scan Metadata" icon={SafetyIcon} action={() => {
                openModal(modalProps => (<MetadataScannerModal rootProps={modalProps} url={url} name={name} mimeType={mimeType} size={0}/>));
            }}/>);
    }
    catch (e) {
        logger.error("Error adding scan metadata to image context menu", e);
    }
}
export default definePlugin({
    name: "MetadataScanner",
    description: "Scan attachments and images for EXIF, PNG chunks, and location metadata.",
    tags: ["Utility", "Media"],
    authors: [TestcordDevs.SirPhantom89],
    settings,
    start() {
        originalPromptToUpload = UploadHandler.promptToUpload;
        UploadHandler.promptToUpload = async (files, channel, draftType) => {
            if (settings.store.autoStripMetadata) {
                try {
                    const strippedFiles = await Promise.all(files.map(async (file) => {
                        if (file.type.startsWith("image/") && (file.type === "image/png" || file.type === "image/jpeg" || file.type === "image/webp")) {
                            return await stripImageMetadata(file);
                        }
                        return file;
                    }));
                    return originalPromptToUpload(strippedFiles, channel, draftType);
                }
                catch (e) {
                    logger.error("Failed to auto strip metadata from uploaded files", e);
                    return originalPromptToUpload(files, channel, draftType);
                }
            }
            return originalPromptToUpload(files, channel, draftType);
        };
    },
    stop() {
        if (originalPromptToUpload) {
            UploadHandler.promptToUpload = originalPromptToUpload;
            originalPromptToUpload = undefined;
        }
    },
    contextMenus: {
        "message": MessageContextMenu,
        "image-context": ImageContextMenu,
        "attachment-link-context": MessageContextMenu
    }
});
