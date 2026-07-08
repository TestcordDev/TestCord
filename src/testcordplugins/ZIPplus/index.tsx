/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { definePluginSettings } from "@api/Settings";
import { EquicordDevs } from "@utils/constants";
import { openModal } from "@utils/modal";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { ChannelStore, DraftType, Menu, React, SelectedChannelStore, showToast, UploadHandler, useEffect, useState } from "@webpack/common";
import { zipSync } from "fflate";

import ZipPreview from "./ZipPreview";

const settings = definePluginSettings({
    enableAutoZipper: {
        type: OptionType.BOOLEAN,
        description: "Automatically zip specified file types and folders before upload",
        default: true
    },
    extensions: {
        type: OptionType.STRING,
        description: "Comma-separated list of file extensions to auto-zip (e.g., .psd,.blend,.exe,.dmg)",
        default: ".psd,.blend,.exe,.dmg,.app,.apk,.iso",
        onChange: () => {
            extensionsToZip.clear();
            parseExtensions();
        }
    }
});

const extensionsToZip = new Set<string>();
const MAX_ZIP_SOURCE_BYTES = 1024 * 1024 * 1024;
const MAX_ZIP_SOURCE_FILES = 10_000;
let interceptingEvents = false;

type ZipPreviewNative = PluginNative<typeof import("./native")>;

interface ZipAttachmentLike {
    content_type?: string;
    filename?: string;
    id?: string;
    name?: string;
    proxy_url?: string;
    title?: string;
    url?: string;
}

interface ZipMediaItemLike {
    contentType?: string;
    filename?: string;
    name?: string;
    proxyUrl?: string;
    url?: string;
}

interface ZipMessageLike {
    attachments?: ZipAttachmentLike[];
}

interface ZipMessageContextMenuProps {
    mediaItem?: ZipMediaItemLike;
    message?: ZipMessageLike;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object";
}

function isZipPreviewNative(value: unknown): value is ZipPreviewNative {
    return isRecord(value) && typeof value.fetchAttachment === "function";
}

function isExpectedFetchError(error: unknown) {
    if (!(error instanceof Error)) return false;

    return error.name === "TypeError"
        && (error.message.includes("CORS") || error.message.includes("Failed to fetch"));
}

function notNull<T>(value: T | null): value is T {
    return value !== null;
}

function getAttachmentKey(attachment: ZipAttachmentLike) {
    return attachment.id
        ?? attachment.proxy_url
        ?? attachment.url
        ?? attachment.filename
        ?? attachment.name
        ?? "archive.zip";
}

function findAttachment(message: ZipMessageLike, mediaItem: ZipMediaItemLike) {
    return (message.attachments ?? []).find(attachment => (
        attachment.proxy_url === mediaItem.proxyUrl
        || attachment.url === mediaItem.url
        || attachment.proxy_url === mediaItem.url
        || attachment.url === mediaItem.proxyUrl
    ));
}

function parseExtensions() {
    extensionsToZip.clear();
    const exts = settings.store.extensions.split(",").map(ext => ext.trim().toLowerCase());
    exts.forEach(ext => {
        if (ext && !ext.startsWith(".")) {
            extensionsToZip.add("." + ext);
        } else if (ext) {
            extensionsToZip.add(ext);
        }
    });
}

function shouldZipFile(file: File): boolean {
    const ext = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();
    return ext !== "" && extensionsToZip.has(ext);
}

async function zipFile(file: File): Promise<File> {
    if (file.size > MAX_ZIP_SOURCE_BYTES) throw new Error("File is too large to zip.");

    const arrayBuffer = await file.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);

    const zipData = zipSync({
        [file.name]: data
    });

    const baseName = file.name.substring(0, file.name.lastIndexOf(".")) || file.name;
    return new File([zipData as BlobPart], `${baseName}.zip`, { type: "application/zip" });
}

async function zipFolder(folderName: string, fileEntries: Record<string, Uint8Array>): Promise<File> {
    const zipData = zipSync(fileEntries);
    return new File([zipData as BlobPart], `${folderName}.zip`, { type: "application/zip" });
}

async function readFileEntry(entry: FileSystemFileEntry): Promise<File> {
    return new Promise((resolve, reject) => {
        entry.file(resolve, reject);
    });
}

async function readDirectoryEntry(entry: FileSystemDirectoryEntry): Promise<Record<string, Uint8Array>> {
    const files: Record<string, Uint8Array> = {};
    let totalBytes = 0;
    let totalFiles = 0;

    async function readEntries(dirEntry: FileSystemDirectoryEntry, path = ""): Promise<void> {
        const reader = dirEntry.createReader();

        const readBatch = async (): Promise<void> => {
            return new Promise((resolve, reject) => {
                reader.readEntries(async entries => {
                    if (entries.length === 0) {
                        resolve();
                        return;
                    }

                    for (const entry of entries) {
                        const entryPath = path ? `${path}/${entry.name}` : entry.name;

                        if (entry.isFile) {
                            const file = await readFileEntry(entry as FileSystemFileEntry);
                            totalBytes += file.size;
                            totalFiles++;
                            if (totalBytes > MAX_ZIP_SOURCE_BYTES || totalFiles > MAX_ZIP_SOURCE_FILES) {
                                throw new Error("Folder is too large to zip.");
                            }

                            const arrayBuffer = await file.arrayBuffer();
                            files[entryPath] = new Uint8Array(arrayBuffer);
                        } else if (entry.isDirectory) {
                            await readEntries(entry as FileSystemDirectoryEntry, entryPath);
                        }
                    }

                    await readBatch();
                    resolve();
                }, reject);
            });
        };

        await readBatch();
    }

    await readEntries(entry);
    return files;
}

async function processFiles(files: File[]): Promise<File[]> {
    const processedFiles: File[] = [];

    for (const file of files) {
        if (shouldZipFile(file)) {
            try {
                const zippedFile = await zipFile(file);
                processedFiles.push(zippedFile);
            } catch {
                processedFiles.push(file);
            }
        } else {
            processedFiles.push(file);
        }
    }

    return processedFiles;
}

function handleDrop(event: DragEvent) {
    if (!event.dataTransfer) return;
    if (!settings.store.enableAutoZipper) return;

    const items = Array.from(event.dataTransfer.items);
    if (items.length === 0) return;

    const hasTargetedItem = items.some(item => {
        const entry = item.webkitGetAsEntry();
        const file = item.getAsFile();
        return entry?.isDirectory || (item.kind === "file" && !!file && shouldZipFile(file));
    });

    if (!hasTargetedItem) return;

    event.preventDefault();
    event.stopPropagation();

    const processPromises: Array<Promise<File | null>> = [];

    for (const item of items) {
        const entry = item.webkitGetAsEntry();

        if (entry?.isDirectory) {
            const folderPromise = readDirectoryEntry(entry as FileSystemDirectoryEntry)
                .then(fileEntries => zipFolder(entry.name, fileEntries))
                .catch(() => null);
            processPromises.push(folderPromise);
        } else if (entry?.isFile) {
            const file = item.getAsFile();
            if (file) {
                if (shouldZipFile(file)) {
                    processPromises.push(
                        zipFile(file).catch(() => file)
                    );
                } else {
                    processPromises.push(Promise.resolve(file));
                }
            }
        }
    }

    Promise.all(processPromises).then(processedFiles => {
        const validFiles = processedFiles.filter(notNull);
        const channelId = SelectedChannelStore.getChannelId();
        const channel = ChannelStore.getChannel(channelId);
        if (channel && validFiles.length > 0) {
            setTimeout(() => UploadHandler.promptToUpload(validFiles, channel, DraftType.ChannelMessage), 10);
        }
    });
}

function handlePaste(event: ClipboardEvent) {
    if (!settings.store.enableAutoZipper) return;

    const files = Array.from(event.clipboardData?.files || []);
    if (files.length === 0) return;

    const hasTargetedFile = files.some(shouldZipFile);
    if (!hasTargetedFile) return;

    event.preventDefault();
    event.stopPropagation();

    processFiles(files).then(processedFiles => {
        const channelId = SelectedChannelStore.getChannelId();
        const channel = ChannelStore.getChannel(channelId);
        if (channel && processedFiles.length > 0) {
            setTimeout(() => UploadHandler.promptToUpload(processedFiles, channel, DraftType.ChannelMessage), 10);
        }
    });
}

// Get native helper for desktop
function getNative(): ZipPreviewNative | null {
    if (!IS_DISCORD_DESKTOP || !VencordNative?.pluginHelpers) return null;
    const helpers = VencordNative.pluginHelpers as Record<string, unknown>;
    const directCandidates = [helpers.ZipPreview, helpers.zipPreview];

    for (const candidate of directCandidates) {
        if (isZipPreviewNative(candidate)) return candidate;
    }

    for (const candidate of Object.values(helpers)) {
        if (!isZipPreviewNative(candidate)) continue;
        if (typeof candidate.zipPreviewUniqueIdThingyIdkMan === "function") return candidate;
    }

    return null;
}

async function fetchBlob(url: string): Promise<Blob | null> {
    const native = getNative();
    if (native?.fetchAttachment) {
        try {
            const buffer = await native.fetchAttachment(url);
            if (buffer instanceof Uint8Array && buffer.length > 0 && buffer.length <= MAX_FETCH_BLOB_BYTES) {
                return new Blob([buffer as Uint8Array<ArrayBuffer>]);
            }
        } catch {
            return null;
        }
    }

    if (IS_DISCORD_DESKTOP) return null;

    try {
        const res = await fetch(url, {
            mode: "cors",
            credentials: "include",
            cache: "no-cache"
        });
        if (res.ok) {
            const length = Number(res.headers.get("content-length"));
            if (length > MAX_FETCH_BLOB_BYTES) return null;
            const blob = await res.blob();
            if (blob.size > 0 && blob.size <= MAX_FETCH_BLOB_BYTES) return blob;
        }
    } catch (error) {
        if (!isExpectedFetchError(error)) return null;
    }

    try {
        const blob = await fetchBlobWithXHR(url);
        if (blob) return blob;
    } catch {
        return null;
    }

    return null;
}

async function fetchBlobWithXHR(url: string): Promise<Blob | null> {
    return new Promise(resolve => {
        try {
            const xhr = new XMLHttpRequest();
            xhr.open("GET", url, true);
            xhr.responseType = "blob";
            xhr.withCredentials = true;
            xhr.timeout = 30000;

            xhr.onload = () => {
                if (xhr.status === 200 && xhr.response instanceof Blob && xhr.response.size > 0) {
                    resolve(xhr.response.size <= MAX_FETCH_BLOB_BYTES ? xhr.response : null);
                } else {
                    resolve(null);
                }
            };

            xhr.onerror = () => resolve(null);
            xhr.ontimeout = () => resolve(null);

            xhr.send();
        } catch {
            resolve(null);
        }
    });
}

function MessageContextMenu(children: React.ReactNode[], props: ZipMessageContextMenuProps) {
    try {
        const { mediaItem, message } = props ?? {};
        if (!mediaItem || !message) return;

        const attachment = findAttachment(message, mediaItem);

        const filename = attachment?.filename || attachment?.title || mediaItem?.filename || mediaItem?.name || "";
        const contentType = (attachment?.content_type || mediaItem?.contentType || "").toLowerCase();
        const looksLikeZip = contentType.includes("zip") || filename.toLowerCase().endsWith(".zip") || (mediaItem?.url || "").toLowerCase().endsWith(".zip");
        if (!looksLikeZip) return;

        children.push(
            <Menu.MenuItem
                id="zippreview-open"
                label="Preview zip"
                action={async () => {
                    try {
                        const url = attachment?.proxy_url || attachment?.url || mediaItem?.proxyUrl || mediaItem?.url;
                        if (!url) {
                            showToast("No URL available for attachment");
                            return;
                        }

                        let blob = await fetchBlob(url);
                        if (!blob && attachment?.url && attachment?.proxy_url && attachment.url !== attachment.proxy_url) {
                            const altUrl = url === attachment.proxy_url ? attachment.url : attachment.proxy_url;
                            blob = await fetchBlob(altUrl);
                        }

                        if (!blob) {
                            const native = getNative();
                            const message = native?.fetchAttachment
                                ? "Failed to fetch attachment. Please try again."
                                : (IS_DISCORD_DESKTOP
                                ? "ZIP+ native helper missing. Please rebuild Equicord."
                                : "Unable to fetch attachment: CORS restrictions on web. Desktop app required for zip preview.");
                            showToast(message);
                            return;
                        }

                        if (blob.size === 0) {
                            showToast("Failed to fetch attachment for preview (empty response). Try Download.");
                            return;
                        }

                        openModal(() => <ZipPreview blob={blob} name={filename} />);
                    } catch {
                        showToast("Failed to open zip preview");
                    }
                }}
            />
        );
    } catch {
        // ignore
    }
}

// Store for expanded state and loaded blobs per attachment.
// blobCache holds decompressed blobs in memory, so cap it with LRU eviction.
const expandedState = new Map<string, boolean>();
const blobCache = new Map<string, Blob>();
const MAX_BLOB_CACHE = 30;
const MAX_BLOB_CACHE_BYTES = 100 * 1024 * 1024;
const MAX_FETCH_BLOB_BYTES = 100 * 1024 * 1024;
let blobCacheBytes = 0;

function cacheBlob(key: string, blob: Blob) {
    // Refresh insertion order so the most recently used key is last
    const existing = blobCache.get(key);
    if (existing) {
        blobCacheBytes -= existing.size;
        blobCache.delete(key);
    }
    blobCache.set(key, blob);
    blobCacheBytes += blob.size;
    while (blobCache.size > MAX_BLOB_CACHE || blobCacheBytes > MAX_BLOB_CACHE_BYTES) {
        const oldest = blobCache.keys().next().value;
        if (oldest === undefined) break;
        blobCacheBytes -= blobCache.get(oldest)?.size ?? 0;
        blobCache.delete(oldest);
    }
}

// Component to render inside each zip attachment
function ZipAttachmentPreview({ attachment }: { attachment: ZipAttachmentLike; }) {
    const cacheKey = getAttachmentKey(attachment);
    const [blob, setBlob] = useState<Blob | null>(() => blobCache.get(cacheKey) || null);
    const [error, setError] = useState<string | null>(null);
    const [expanded, setExpanded] = useState<boolean>(() => expandedState.get(cacheKey) ?? false);

    useEffect(() => {
        if (blobCache.has(cacheKey)) return;

        let mounted = true;
        (async () => {
            try {
                const url = attachment.proxy_url || attachment.url;
                if (!url) {
                    if (mounted) setError("No URL for attachment");
                    return;
                }

                let b = await fetchBlob(url);
                if (!b && attachment.proxy_url && attachment.url && attachment.proxy_url !== attachment.url) {
                    const altUrl = url === attachment.proxy_url ? attachment.url : attachment.proxy_url;
                    b = await fetchBlob(altUrl);
                }

                if (!b) {
                    if (mounted) {
                        const native = getNative();
                        setError(native?.fetchAttachment
                            ? "Failed to fetch archive. Please try again."
                            : (IS_DISCORD_DESKTOP
                                ? "ZIP+ native helper missing. Please rebuild Equicord."
                                : "Unable to fetch: CORS restrictions on web. Desktop app required."));
                    }
                    return;
                }

                if (b.size === 0) {
                    if (mounted) setError("Failed to fetch archive (empty file)");
                    return;
                }

                if (mounted) {
                    setBlob(b);
                    cacheBlob(cacheKey, b);
                }
            } catch {
                if (mounted) setError("Failed to fetch archive");
            }
        })();
        return () => { mounted = false; };
    }, [attachment.proxy_url, attachment.url, cacheKey]);

    if (error) return <div className="zp-error">{error}</div>;
    if (!blob) return <div className="zp-loading">Loading preview…</div>;

    return (
        <div className="zp-attachment-integrated">
            <ZipPreview
                blob={blob}
                name={attachment.filename || attachment.name || "archive.zip"}
                expanded={expanded}
                onExpandedChange={value => {
                    setExpanded(value);
                    expandedState.set(cacheKey, value);
                }}
            />
        </div>
    );
}

export default definePlugin({
    name: "ZIP+",
    description: "Preview and navigate inside zip files, plus auto-zip uploads.",
    tags: ["Utility", "Chat"],
    authors: [EquicordDevs.justjxke, EquicordDevs.SSnowly, EquicordDevs.benjii],

    settings,

    patches: [
        {
            find: "#{intl::ATTACHMENT_PROCESSING}",
            noWarn: true,
            replacement: {
                match: /(renderAdjacentContent[\s\S]{0,200}\}=(\i);[\s\S]{0,200})null!=\i&&\i\(\)/,
                replace: "$1$self.ZipAttachmentPreview({ attachment: $2 })"
            }
        }
    ],

    contextMenus: {
        "message": MessageContextMenu
    },

    ZipAttachmentPreview,

    start() {
        if (interceptingEvents) return;
        interceptingEvents = true;

        parseExtensions();

        document.addEventListener("drop", handleDrop, true);
        document.addEventListener("paste", handlePaste, true);
    },

    stop() {
        document.removeEventListener("drop", handleDrop, true);
        document.removeEventListener("paste", handlePaste, true);
        interceptingEvents = false;
        blobCache.clear();
        blobCacheBytes = 0;
        expandedState.clear();
    }
});
