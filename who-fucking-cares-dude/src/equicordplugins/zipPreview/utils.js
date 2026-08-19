/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { saveFile } from "@utils/web";
import { unzipSync } from "fflate";
const Native = VencordNative?.pluginHelpers?.ZipPreview;
export const MAX_ZIP_BYTES = 50 * 1024 * 1024;
export const MAX_ENTRIES = 1000;
export const MAX_PREVIEW_BYTES = 10 * 1024 * 1024;
const CANCELLED_PREVIEW_MESSAGE = "ZIP preview was cancelled.";
const NATIVE_UNAVAILABLE_MESSAGE = "Native helper is unavailable.";
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp"]);
const DISCORD_ATTACHMENT_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);
const TEXT_EXTENSIONS = new Set([
    "c",
    "cpp",
    "cs",
    "css",
    "csv",
    "go",
    "h",
    "html",
    "java",
    "js",
    "json",
    "jsx",
    "log",
    "lua",
    "md",
    "php",
    "py",
    "rs",
    "scss",
    "sh",
    "svg",
    "toml",
    "ts",
    "tsx",
    "txt",
    "xml",
    "yaml",
    "yml"
]);
import { ZIP_CACHE_MAX } from "@utils/cacheLimits";
const zipCache = new Map();
function trimZipCache() {
    if (ZIP_CACHE_MAX === Infinity)
        return;
    if (zipCache.size > ZIP_CACHE_MAX) {
        const first = zipCache.keys().next().value;
        if (first !== undefined)
            zipCache.delete(first);
    }
}
export function isZipFile(fileName) {
    return typeof fileName === "string" && /\.zip$/i.test(fileName);
}
export function getAttachmentFileName(props) {
    return props.fileName ?? props.item?.originalItem?.filename ?? props.item?.originalItem?.title;
}
export function getAttachmentUrl(props) {
    return props.url ?? props.item?.downloadUrl ?? props.item?.originalItem?.url ?? props.item?.originalItem?.proxy_url;
}
export function getCachedZip(url) {
    const cached = zipCache.get(url);
    if (cached)
        return cached;
    const promise = loadZip(url)
        .then(result => {
        zipCache.set(url, { status: "resolved", result });
        trimZipCache();
        return result;
    })
        .catch(error => {
        const message = error instanceof Error ? error.message : "Failed to preview ZIP.";
        if (message === CANCELLED_PREVIEW_MESSAGE || message === NATIVE_UNAVAILABLE_MESSAGE)
            zipCache.delete(url);
        else {
            zipCache.set(url, { status: "rejected", message });
            trimZipCache();
        }
        throw error;
    });
    const pending = { status: "pending", promise };
    zipCache.set(url, pending);
    trimZipCache();
    return pending;
}
export function clearZipPreviewCache() {
    zipCache.clear();
}
export function makeDownload(entry) {
    const type = entry.kind === "image" ? getImageMimeType(entry.extension) : "text/plain;charset=utf-8";
    saveFile(new File([entry.data], entry.name, { type }));
}
export function createImageObjectUrl(entry) {
    return URL.createObjectURL(new Blob([entry.data], { type: getImageMimeType(entry.extension) }));
}
export function readTextEntry(entry) {
    return new TextDecoder("utf-8").decode(entry.data);
}
export function getCodeLanguage(entry) {
    const languageMap = {
        js: "javascript",
        jsx: "jsx",
        md: "markdown",
        py: "python",
        rs: "rust",
        sh: "bash",
        ts: "typescript",
        tsx: "tsx",
        yml: "yaml"
    };
    return languageMap[entry.extension] ?? entry.extension;
}
async function loadZip(url) {
    const attachmentPath = getDiscordAttachmentPath(url);
    if (attachmentPath) {
        const nativeResult = await fetchNativeDiscordAttachment(attachmentPath);
        if (nativeResult.success && nativeResult.data) {
            if (nativeResult.data.byteLength > MAX_ZIP_BYTES)
                throw new Error("ZIP is too large to preview.");
            return parseZipBuffer(nativeResult.data);
        }
        throw new Error(nativeResult.error || "Could not fetch ZIP through native Discord attachment fetch.");
    }
    const response = await fetch(url);
    if (!response.ok)
        throw new Error("Could not fetch ZIP.");
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_ZIP_BYTES) {
        throw new Error("ZIP is too large to preview.");
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_ZIP_BYTES)
        throw new Error("ZIP is too large to preview.");
    return parseZipBuffer(buffer);
}
async function fetchNativeDiscordAttachment(attachmentPath) {
    if (!Native)
        return { success: false, error: NATIVE_UNAVAILABLE_MESSAGE };
    if (typeof Native.fetchDiscordAttachment === "function")
        return Native.fetchDiscordAttachment(attachmentPath);
    return { success: false, error: "Native helper does not support attachment fetch." };
}
export function getDiscordAttachmentPath(url) {
    try {
        const parsedUrl = new URL(url);
        if (parsedUrl.protocol !== "https:")
            return null;
        if (!DISCORD_ATTACHMENT_HOSTS.has(parsedUrl.hostname))
            return null;
        if (!parsedUrl.pathname.startsWith("/attachments/"))
            return null;
        const attachmentPath = parsedUrl.pathname.slice("/attachments/".length);
        if (!isValidDiscordAttachmentPath(attachmentPath))
            return null;
        return `${attachmentPath}${parsedUrl.search}`;
    }
    catch {
        return null;
    }
}
function isValidDiscordAttachmentPath(path) {
    if (path.includes("\\") || path.includes("..") || path.startsWith("/") || path.startsWith("//"))
        return false;
    const parts = path.split("/");
    return parts.length >= 3
        && /^\d+$/.test(parts[0])
        && /^\d+$/.test(parts[1])
        && parts.slice(2).every(part => part.length > 0);
}
function parseZipBuffer(buffer) {
    const unzipped = unzipSync(new Uint8Array(buffer));
    const files = Object.entries(unzipped)
        .filter(([path]) => !path.endsWith("/"))
        .sort(([a], [b]) => a.localeCompare(b));
    const truncated = files.length > MAX_ENTRIES;
    const entries = files.slice(0, MAX_ENTRIES).map(([path, data]) => {
        const normalizedPath = normalizePath(path);
        const extension = getExtension(normalizedPath);
        return {
            path: normalizedPath,
            name: getFileName(normalizedPath),
            size: data.byteLength,
            data,
            extension,
            kind: getPreviewKind(extension, data.byteLength)
        };
    });
    return {
        entries,
        truncated
    };
}
function getPreviewKind(extension, size) {
    if (size > MAX_PREVIEW_BYTES)
        return "unsupported";
    if (IMAGE_EXTENSIONS.has(extension))
        return "image";
    if (TEXT_EXTENSIONS.has(extension))
        return "text";
    return "unsupported";
}
function getImageMimeType(extension) {
    if (extension === "jpg")
        return "image/jpeg";
    return `image/${extension}`;
}
function normalizePath(path) {
    return path.replace(/^\/+/, "").replaceAll("\\", "/");
}
function getFileName(path) {
    return path.split("/").at(-1) || path;
}
function getExtension(path) {
    const fileName = getFileName(path);
    const dotIndex = fileName.lastIndexOf(".");
    return dotIndex === -1 ? "" : fileName.slice(dotIndex + 1).toLowerCase();
}
