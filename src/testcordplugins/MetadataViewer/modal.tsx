/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { copyToClipboard } from "@utils/clipboard";
import { Logger } from "@utils/Logger";
import { type RenderModalProps } from "@utils/modal";
import type { PluginNative } from "@utils/types";
import { findStoreLazy } from "@webpack";
import { Button, Modal, React, ReactDOM, showToast, Toasts, useEffect, useMemo, useState, useStateFromStores } from "@webpack/common";

import { formatBytes, MetadataResult, parseMetadata } from "./parser";
import { getMimeFromExtension } from "./utils";

const logger = new Logger("MetadataScanner");
const MAX_SCAN_BYTES = 50 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15000;

interface ThemeStoreShape {
    theme: "light" | "dark";
}

const ThemeStore = findStoreLazy("ThemeStore") as ThemeStoreShape;

function formatDuration(seconds: number): string {
    if (isNaN(seconds) || !isFinite(seconds)) return "Unknown";
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hrs > 0) {
        return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }
    return `${mins}:${String(secs).padStart(2, "0")}`;
}

declare const VencordNative: {
    pluginHelpers: {
        MetadataScanner: unknown;
    };
};

const Native = typeof VencordNative !== "undefined"
    ? (VencordNative.pluginHelpers.MetadataScanner as PluginNative<typeof import("./native")>)
    : null;

interface CopyButtonProps {
    text: string;
}

const CopyButton = ({ text }: CopyButtonProps) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        copyToClipboard(text);
        setCopied(true);
        showToast("Copied to clipboard!", Toasts.Type.SUCCESS);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <button
            onClick={handleCopy}
            className="vc-mds-copy-btn"
            title="Copy to clipboard"
            type="button"
        >
            {copied ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#23a55a" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                </svg>
            ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
            )}
        </button>
    );
};

export function MetadataScannerModal({ rootProps, url, name, mimeType, size }: {
    rootProps: RenderModalProps;
    url: string;
    name?: string;
    mimeType?: string;
    size?: number;
}) {
    const theme = useStateFromStores([ThemeStore], () => ThemeStore.theme);
    const themeClass = theme === "light" ? "theme-light" : "theme-dark";

    const [confirmScanLargeFile, setConfirmScanLargeFile] = useState(size ? size > 25 * 1024 * 1024 : false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<MetadataResult | null>(null);
    const [activeTab, setActiveTab] = useState("file");
    const [dynamicMedia, setDynamicMedia] = useState<{ duration?: number; width?: number; height?: number }>({});
    const [searchQuery, setSearchQuery] = useState("");
    const [isFullscreen, setIsFullscreen] = useState(false);

    const [zoomScale, setZoomScale] = useState(1);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const fullscreenRef = React.useRef<HTMLDivElement>(null);

    const zoomIn = () => {
        setZoomScale(prev => Math.min(prev + 0.25, 4));
    };

    const zoomOut = () => {
        setZoomScale(prev => {
            const next = Math.max(prev - 0.25, 1);
            if (next === 1) {
                setDragOffset({ x: 0, y: 0 });
            }
            return next;
        });
    };

    const resetZoom = () => {
        setZoomScale(1);
        setDragOffset({ x: 0, y: 0 });
    };

    const handleWheel = (e: React.WheelEvent) => {
        try {
            if (e.cancelable) e.preventDefault();
        } catch (err) {
            // Ignore passive listener errors
        }
        if (e.deltaY < 0) {
            setZoomScale(prev => Math.min(prev + 0.1, 4));
        } else {
            setZoomScale(prev => {
                const next = Math.max(prev - 0.1, 1);
                if (next === 1) {
                    setDragOffset({ x: 0, y: 0 });
                }
                return next;
            });
        }
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        if (zoomScale > 1) {
            setIsDragging(true);
            setDragStart({ x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y });
        }
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (isDragging && zoomScale > 1) {
            setDragOffset({
                x: e.clientX - dragStart.x,
                y: e.clientY - dragStart.y
            });
        }
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };

    const handleMouseLeave = () => {
        setIsDragging(false);
    };

    const copyImageToClipboard = async () => {
        try {
            showToast("Copying image...", Toasts.Type.MESSAGE);
            const response = await fetch(url);
            const blob = await response.blob();

            let pngBlob = blob;
            if (blob.type !== "image/png") {
                const img = new Image();
                img.crossOrigin = "anonymous";
                img.src = url;
                await new Promise((resolve, reject) => {
                    img.onload = resolve;
                    img.onerror = reject;
                });
                const canvas = document.createElement("canvas");
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                const ctx = canvas.getContext("2d");
                ctx?.drawImage(img, 0, 0);
                pngBlob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), "image/png"));
            }

            await navigator.clipboard.write([
                new ClipboardItem({
                    "image/png": pngBlob
                })
            ]);
            showToast("Image copied to clipboard!", Toasts.Type.SUCCESS);
        } catch (err) {
            logger.error("Failed to copy image to clipboard", err);
            showToast("Failed to copy image: " + String(err), Toasts.Type.FAILURE);
        }
    };

    const downloadImage = async () => {
        let blobUrl: string | null = null;
        try {
            showToast("Downloading image...", Toasts.Type.MESSAGE);
            const response = await fetch(url);
            const blob = await response.blob();
            blobUrl = URL.createObjectURL(blob);

            const a = document.createElement("a");
            a.href = blobUrl;
            a.download = name || url.split("/").pop()?.split("?")[0] || "download.png";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            showToast("Image download started!", Toasts.Type.SUCCESS);
        } catch (err) {
            logger.error("Failed to download image", err);
            showToast("Failed to download: " + String(err), Toasts.Type.FAILURE);
        } finally {
            if (blobUrl) URL.revokeObjectURL(blobUrl);
        }
    };

    useEffect(() => {
        resetZoom();
        setIsFullscreen(false);
    }, [url]);

    useEffect(() => {
        setSearchQuery("");
    }, [activeTab]);

    useEffect(() => {
        if (!isFullscreen) return;

        function handleKeyDown(e: KeyboardEvent) {
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setIsFullscreen(false);
                resetZoom();
            }
        }

        window.addEventListener("keydown", handleKeyDown, true);
        return () => {
            window.removeEventListener("keydown", handleKeyDown, true);
        };
    }, [isFullscreen]);

    useEffect(() => {
        if (!isFullscreen) return;

        const el = fullscreenRef.current;
        if (!el) return;

        function handleNativeWheel(e: WheelEvent) {
            e.preventDefault();
            if (e.deltaY < 0) {
                setZoomScale(prev => Math.min(prev + 0.1, 4));
            } else {
                setZoomScale(prev => {
                    const next = Math.max(prev - 0.1, 1);
                    if (next === 1) {
                        setDragOffset({ x: 0, y: 0 });
                    }
                    return next;
                });
            }
        }

        el.addEventListener("wheel", handleNativeWheel, { passive: false });
        return () => {
            el.removeEventListener("wheel", handleNativeWheel);
        };
    }, [isFullscreen]);

    useEffect(() => {
        if (!url || !data) return;

        const resolvedMime = data.fileInfo.mimeType;
        const isVideo = resolvedMime.startsWith("video/");
        const isAudio = resolvedMime.startsWith("audio/");

        if (!isVideo && !isAudio) return;

        let mediaEl: HTMLAudioElement | HTMLVideoElement;
        if (isVideo) {
            mediaEl = document.createElement("video");
        } else {
            mediaEl = new Audio();
        }

        const handleLoadedMetadata = () => {
            setDynamicMedia({
                duration: mediaEl.duration,
                width: "videoWidth" in mediaEl ? mediaEl.videoWidth : undefined,
                height: "videoHeight" in mediaEl ? mediaEl.videoHeight : undefined,
            });
        };

        mediaEl.addEventListener("loadedmetadata", handleLoadedMetadata);
        mediaEl.src = url;
        mediaEl.load();

        return () => {
            mediaEl.removeEventListener("loadedmetadata", handleLoadedMetadata);
            mediaEl.src = "";
            mediaEl.load();
        };
    }, [url, data]);

    useEffect(() => {
        if (confirmScanLargeFile) return;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        let active = true;

        async function fetchAndParse() {
            try {
                if (size && size > MAX_SCAN_BYTES) throw new Error("File exceeds size limit (50MB)");

                let buffer: ArrayBuffer;
                let resolvedMimeType = mimeType || "";
                if (Native) {
                    const res = await Native.fetchAttachment(url);
                    if (!active) return;
                    if (!res.success || !res.data) {
                        throw new Error(res.error || "Failed to fetch attachment via native helper");
                    }
                    const uint8 = res.data;
                    if (uint8.byteLength > MAX_SCAN_BYTES) throw new Error("File exceeds size limit (50MB)");
                    buffer = uint8.byteOffset === 0 && uint8.byteLength === uint8.buffer.byteLength
                        ? uint8.buffer as ArrayBuffer
                        : uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength) as ArrayBuffer;
                } else {
                    const response = await fetch(url, { signal: controller.signal });
                    if (!response.ok) throw new Error(`HTTP error ${response.status}`);
                    const contentLength = Number(response.headers.get("content-length"));
                    if (contentLength > MAX_SCAN_BYTES) throw new Error("File exceeds size limit (50MB)");
                    resolvedMimeType = resolvedMimeType || response.headers.get("Content-Type") || "";
                    buffer = await response.arrayBuffer();
                    if (buffer.byteLength > MAX_SCAN_BYTES) throw new Error("File exceeds size limit (50MB)");
                }

                if (!active) return;

                const resolvedName = name || url.split("/").pop()?.split("?")[0] || "file";
                const resolvedSize = size || buffer.byteLength;

                if (!resolvedMimeType) {
                    resolvedMimeType = getMimeFromExtension(resolvedName);
                }

                const parsed = parseMetadata(buffer, resolvedName, resolvedMimeType, resolvedSize);
                setData(parsed);
                setLoading(false);
            } catch (e: unknown) {
                logger.error("Failed to load metadata", e);
                if (active) {
                    setError((e instanceof Error ? e.message : String(e)) || "Failed to fetch file. CORS restrictions might apply.");
                    setLoading(false);
                }
            } finally {
                clearTimeout(timeout);
            }
        }

        fetchAndParse();

        return () => {
            active = false;
            clearTimeout(timeout);
            controller.abort();
        };
    }, [url, confirmScanLargeFile]);

    if (confirmScanLargeFile) {
        return (
            <Modal {...rootProps} className={`vc-mds-modal ${themeClass}`} size="sm" title="Large File Warning">
                <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px", alignItems: "center", textAlign: "center" }}>
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-warning)" strokeWidth="2" style={{ color: "var(--status-warning, #f0b232)" }}>
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                        <line x1="12" y1="9" x2="12" y2="13" />
                        <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    <div style={{ fontSize: "15px", fontWeight: "600", color: "var(--header-primary, #fff)" }}>
                        This file is quite large ({formatBytes(size || 0)})
                    </div>
                    <p style={{ fontSize: "13px", color: "var(--text-muted, #949ba4)", margin: 0, lineHeight: 1.4 }}>
                        Downloading and parsing large files can cause your Discord client to lag or freeze. Are you sure you want to scan it?
                    </p>
                    <div style={{ display: "flex", gap: "12px", width: "100%", marginTop: "8px" }}>
                        <Button
                            size={Button.Sizes.MEDIUM}
                            color={Button.Colors.PRIMARY}
                            style={{ flex: 1 }}
                            onClick={rootProps.onClose}
                        >
                            Cancel
                        </Button>
                        <Button
                            size={Button.Sizes.MEDIUM}
                            color={Button.Colors.RED}
                            style={{ flex: 1 }}
                            onClick={() => setConfirmScanLargeFile(false)}
                        >
                            Scan Anyway
                        </Button>
                    </div>
                </div>
            </Modal>
        );
    }

    const tabs = useMemo(() => {
        const list = [{ id: "file", label: "File Info" }];
        if (data?.exif && Object.keys(data.exif).length > 0) {
            list.push({ id: "exif", label: "EXIF Tags" });
        }
        if (data?.pngChunks && data.pngChunks.length > 0) {
            list.push({ id: "chunks", label: "PNG Chunks" });
        }
        if (data?.sdParams) {
            list.push({ id: "sd", label: "SD Prompts" });
        }
        if (data?.gps) {
            list.push({ id: "gps", label: "GPS / Map" });
        }
        if (data && Object.keys(data.rawTags).length > 0) {
            list.push({ id: "raw", label: "Raw JSON" });
        }
        return list;
    }, [data]);

    const renderPreview = () => {
        const resolvedMime = data ? data.fileInfo.mimeType : (mimeType || "");
        const isImage = resolvedMime.startsWith("image/");
        const isVideo = resolvedMime.startsWith("video/");
        const isAudio = resolvedMime.startsWith("audio/");

        if (isImage) {
            return (
                <div
                    style={{
                        position: "relative",
                        width: "100%",
                        height: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        overflow: "hidden",
                        cursor: zoomScale > 1 ? (isDragging ? "grabbing" : "grab") : "default"
                    }}
                    onWheel={handleWheel}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseLeave}
                >
                    <img
                        src={url}
                        alt="Preview"
                        style={{
                            maxWidth: "100%",
                            maxHeight: "100%",
                            objectFit: "contain",
                            transform: `translate(${dragOffset.x}px, ${dragOffset.y}px) scale(${zoomScale})`,
                            transformOrigin: "center center",
                            transition: isDragging ? "none" : "transform 0.15s ease-out",
                            userSelect: "none",
                            pointerEvents: "none"
                        }}
                    />

                    <div
                        style={{
                            position: "absolute",
                            top: "8px",
                            right: "8px",
                            display: "flex",
                            gap: "6px",
                            zIndex: 10
                        }}
                    >
                        <button
                            onClick={copyImageToClipboard}
                            style={{
                                background: "rgba(0, 0, 0, 0.6)",
                                border: "none",
                                borderRadius: "4px",
                                padding: "6px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: "pointer",
                                color: "#fff",
                                transition: "background 0.2s"
                            }}
                            onMouseEnter={e => { e.currentTarget.style.backgroundColor = "rgba(0, 0, 0, 0.8)"; }}
                            onMouseLeave={e => { e.currentTarget.style.backgroundColor = "rgba(0, 0, 0, 0.6)"; }}
                            title="Copy Image"
                            type="button"
                        >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                        </button>
                        <button
                            onClick={downloadImage}
                            style={{
                                background: "rgba(0, 0, 0, 0.6)",
                                border: "none",
                                borderRadius: "4px",
                                padding: "6px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: "pointer",
                                color: "#fff",
                                transition: "background 0.2s"
                            }}
                            onMouseEnter={e => { e.currentTarget.style.backgroundColor = "rgba(0, 0, 0, 0.8)"; }}
                            onMouseLeave={e => { e.currentTarget.style.backgroundColor = "rgba(0, 0, 0, 0.6)"; }}
                            title="Download Image"
                            type="button"
                        >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="7 10 12 15 17 10" />
                                <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                        </button>
                        <button
                            onClick={() => setIsFullscreen(true)}
                            style={{
                                background: "rgba(0, 0, 0, 0.6)",
                                border: "none",
                                borderRadius: "4px",
                                padding: "6px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: "pointer",
                                color: "#fff",
                                transition: "background 0.2s"
                            }}
                            onMouseEnter={e => { e.currentTarget.style.backgroundColor = "rgba(0, 0, 0, 0.8)"; }}
                            onMouseLeave={e => { e.currentTarget.style.backgroundColor = "rgba(0, 0, 0, 0.6)"; }}
                            title="Fullscreen"
                            type="button"
                        >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                            </svg>
                        </button>
                    </div>
                </div>
            );
        }
        if (isVideo) {
            return <video src={url} controls className="vc-mds-preview-media" />;
        }
        if (isAudio) {
            return <audio src={url} controls className="vc-mds-preview-media" style={{ width: "90%" }} />;
        }

        return (
            <div className="vc-mds-preview-fallback">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="vc-mds-preview-icon">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                </svg>
                <span style={{ fontSize: "12px" }}>No preview<br />available</span>
            </div>
        );
    };

    const renderTabContent = () => {
        if (!data) return null;

        const renderSearchInput = () => (
            <div style={{ marginBottom: "12px", width: "100%" }}>
                <input
                    type="text"
                    placeholder="Search tags or values..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    style={{
                        width: "100%",
                        padding: "8px 12px",
                        backgroundColor: "var(--background-secondary)",
                        border: "1px solid var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.15))",
                        borderRadius: "6px",
                        color: "#dbdee1",
                        fontSize: "13px",
                        outline: "none",
                        boxSizing: "border-box"
                    }}
                />
            </div>
        );

        switch (activeTab) {
            case "file":
                return (
                    <table className="vc-mds-table">
                        <tbody>
                            <tr>
                                <td className="vc-mds-tag-name">Filename</td>
                                <td className="vc-mds-tag-val-cell">
                                    <span className="vc-mds-tag-value" style={{ fontWeight: 600 }}>{data.fileInfo.name}</span>
                                    <CopyButton text={data.fileInfo.name} />
                                </td>
                            </tr>
                            <tr>
                                <td className="vc-mds-tag-name">File Size</td>
                                <td className="vc-mds-tag-val-cell">
                                    <span className="vc-mds-tag-value">{formatBytes(data.fileInfo.size)} ({data.fileInfo.size} bytes)</span>
                                    <CopyButton text={String(data.fileInfo.size)} />
                                </td>
                            </tr>
                            <tr>
                                <td className="vc-mds-tag-name">MIME Type</td>
                                <td className="vc-mds-tag-val-cell">
                                    <span className="vc-mds-tag-value" style={{ fontFamily: "monospace", fontSize: "12px" }}>{data.fileInfo.mimeType}</span>
                                    <CopyButton text={data.fileInfo.mimeType} />
                                </td>
                            </tr>
                            {(data.fileInfo.dimensions || (dynamicMedia.width && dynamicMedia.height)) && (
                                <tr>
                                    <td className="vc-mds-tag-name">Dimensions</td>
                                    <td className="vc-mds-tag-val-cell">
                                        <span className="vc-mds-tag-value">
                                            {data.fileInfo.dimensions || `${dynamicMedia.width} × ${dynamicMedia.height}`}
                                        </span>
                                        <CopyButton text={data.fileInfo.dimensions || `${dynamicMedia.width}x${dynamicMedia.height}`} />
                                    </td>
                                </tr>
                            )}
                            {dynamicMedia.duration !== undefined && (
                                <tr>
                                    <td className="vc-mds-tag-name">Duration</td>
                                    <td className="vc-mds-tag-val-cell">
                                        <span className="vc-mds-tag-value">
                                            {formatDuration(dynamicMedia.duration)} ({dynamicMedia.duration.toFixed(2)}s)
                                        </span>
                                        <CopyButton text={formatDuration(dynamicMedia.duration)} />
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                );

            case "exif": {
                if (!data.exif) return null;
                const filtered = Object.entries(data.exif).filter(([key, val]) => {
                    const k = key.toLowerCase();
                    const v = String(val).toLowerCase();
                    const q = searchQuery.toLowerCase();
                    return k.includes(q) || v.includes(q);
                });
                return (
                    <div>
                        {renderSearchInput()}
                        {filtered.length === 0 ? (
                            <div style={{ padding: "16px", textAlign: "center", color: "var(--text-muted)" }}>No tags matching search query.</div>
                        ) : (
                            <table className="vc-mds-table">
                                <tbody>
                                    {filtered.map(([key, val]) => {
                                        let strVal = "";
                                        if (val && typeof val === "object" && "numerator" in val && "denominator" in val) {
                                            const r = val as { numerator: number; denominator: number; value?: number; };
                                            strVal = r.value !== undefined ? String(r.value) : `${r.numerator}/${r.denominator}`;
                                        } else if (val instanceof Uint8Array) {
                                            strVal = `[Binary Data: ${val.length} bytes]`;
                                        } else if (val !== undefined && val !== null) {
                                            strVal = String(val);
                                        }

                                        let displayVal = strVal;
                                        if (key === "ExposureTime" && val && typeof val === "object" && "numerator" in val && "denominator" in val) {
                                            const r = val as { numerator: number; denominator: number; };
                                            displayVal = r.numerator === 1 ? `1/${r.denominator}s` : `${r.numerator}/${r.denominator}s`;
                                        } else if (key === "FNumber" && typeof val === "number") {
                                            displayVal = `f/${val}`;
                                        } else if (key === "FocalLength" && typeof val === "number") {
                                            displayVal = `${val} mm`;
                                        } else if (key === "ISOSpeedRatings" && val !== undefined && val !== null) {
                                            displayVal = `ISO ${strVal}`;
                                        }

                                        return (
                                            <tr key={key}>
                                                <td className="vc-mds-tag-name">{key}</td>
                                                <td className="vc-mds-tag-val-cell">
                                                    <span className="vc-mds-tag-value">{displayVal}</span>
                                                    <CopyButton text={displayVal} />
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>
                );
            }

            case "chunks": {
                if (!data.pngChunks) return null;
                const filtered = data.pngChunks.filter(chunk => {
                    const kw = chunk.keyword.toLowerCase();
                    const txt = chunk.text.toLowerCase();
                    const q = searchQuery.toLowerCase();
                    return kw.includes(q) || txt.includes(q);
                });
                return (
                    <div>
                        {renderSearchInput()}
                        {filtered.length === 0 ? (
                            <div style={{ padding: "16px", textAlign: "center", color: "var(--text-muted)" }}>No chunks matching search query.</div>
                        ) : (
                            <table className="vc-mds-table">
                                <tbody>
                                    {filtered.map((chunk, i) => (
                                        <tr key={i}>
                                            <td className="vc-mds-tag-name" style={{ fontFamily: "monospace" }}>
                                                {chunk.keyword}
                                                {chunk.compressed && <span style={{ fontSize: "10px", color: "#85c2ff", marginLeft: "6px", fontWeight: "normal" }}>(zip)</span>}
                                            </td>
                                            <td className="vc-mds-tag-val-cell">
                                                <span className="vc-mds-tag-value" style={{ whiteSpace: "pre-wrap" }}>{chunk.text}</span>
                                                <CopyButton text={chunk.text} />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                );
            }

            case "sd":
                if (!data.sdParams) return null;
                const { sdParams } = data;
                return (
                    <div className="vc-mds-sd-container">
                        <div>
                            <div className="vc-mds-info-label" style={{ marginBottom: "4px" }}>Prompt</div>
                            <div className="vc-mds-sd-box">{sdParams.prompt}</div>
                            <div style={{ marginTop: "6px", display: "flex", justifyContent: "flex-end" }}>
                                <Button size={Button.Sizes.MIN} color={Button.Colors.PRIMARY} onClick={() => {
                                    navigator.clipboard.writeText(sdParams.prompt);
                                    showToast("Copied prompt!", Toasts.Type.SUCCESS);
                                }}>Copy Prompt</Button>
                            </div>
                        </div>
                        {sdParams.negativePrompt && (
                            <div>
                                <div className="vc-mds-info-label" style={{ marginBottom: "4px" }}>Negative Prompt</div>
                                <div className="vc-mds-sd-box" style={{ color: "#f23f43" }}>{sdParams.negativePrompt}</div>
                                <div style={{ marginTop: "6px", display: "flex", justifyContent: "flex-end" }}>
                                    <Button size={Button.Sizes.MIN} color={Button.Colors.PRIMARY} onClick={() => {
                                        navigator.clipboard.writeText(sdParams.negativePrompt!);
                                        showToast("Copied negative prompt!", Toasts.Type.SUCCESS);
                                    }}>Copy Negative Prompt</Button>
                                </div>
                            </div>
                        )}
                        <div className="vc-mds-info-label">Parameters</div>
                        <div className="vc-mds-sd-grid">
                            {sdParams.steps && (
                                <div className="vc-mds-sd-badge">
                                    <span className="vc-mds-sd-badge-label">Steps</span>
                                    <span className="vc-mds-sd-badge-value">{sdParams.steps}</span>
                                </div>
                            )}
                            {sdParams.sampler && (
                                <div className="vc-mds-sd-badge">
                                    <span className="vc-mds-sd-badge-label">Sampler</span>
                                    <span className="vc-mds-sd-badge-value">{sdParams.sampler}</span>
                                </div>
                            )}
                            {sdParams.cfgScale && (
                                <div className="vc-mds-sd-badge">
                                    <span className="vc-mds-sd-badge-label">CFG Scale</span>
                                    <span className="vc-mds-sd-badge-value">{sdParams.cfgScale}</span>
                                </div>
                            )}
                            {sdParams.seed && (
                                <div className="vc-mds-sd-badge" style={{ cursor: "pointer" }} onClick={() => {
                                    navigator.clipboard.writeText(sdParams.seed!);
                                    showToast("Copied seed!", Toasts.Type.SUCCESS);
                                }} title="Click to copy Seed">
                                    <span className="vc-mds-sd-badge-label">Seed</span>
                                    <span className="vc-mds-sd-badge-value">{sdParams.seed}</span>
                                </div>
                            )}
                            {sdParams.size && (
                                <div className="vc-mds-sd-badge">
                                    <span className="vc-mds-sd-badge-label">Size</span>
                                    <span className="vc-mds-sd-badge-value">{sdParams.size}</span>
                                </div>
                            )}
                            {sdParams.model && (
                                <div className="vc-mds-sd-badge">
                                    <span className="vc-mds-sd-badge-label">Model</span>
                                    <span className="vc-mds-sd-badge-value" title={sdParams.model}>{sdParams.model}</span>
                                </div>
                            )}
                        </div>
                    </div>
                );

            case "gps": {
                if (!data.gps) return null;
                const { gps } = data;
                const bbox = `${gps.longitude - 0.005},${gps.latitude - 0.005},${gps.longitude + 0.005},${gps.latitude + 0.005}`;
                return (
                    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                        <div className="vc-mds-gps-card">
                            <span className="vc-mds-gps-title">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M12 2a8 8 0 0 0-8 8c0 5.25 8 12 8 12s8-6.75 8-12a8 8 0 0 0-8-8z" />
                                    <circle cx="12" cy="10" r="3" />
                                </svg>
                                Coordinates Extracted
                            </span>
                            <div className="vc-mds-gps-coords">
                                {gps.latitude.toFixed(6)}, {gps.longitude.toFixed(6)}
                            </div>
                            {gps.altitude !== undefined && (
                                <div style={{ fontSize: "13px", color: "var(--text-muted)" }}>
                                    Altitude: <strong>{gps.altitude.toFixed(1)} meters</strong> (above sea level)
                                </div>
                            )}
                            <div className="vc-mds-gps-actions">
                                <button
                                    onClick={() => window.open(gps.googleMapsUrl, "_blank")}
                                    className="vc-mds-button"
                                    type="button"
                                >
                                    Open in Google Maps
                                </button>
                                <button
                                    onClick={() => window.open(gps.osmUrl, "_blank")}
                                    className="vc-mds-button vc-mds-button-secondary"
                                    type="button"
                                >
                                    Open in OpenStreetMap
                                </button>
                            </div>
                        </div>
                        <div style={{ borderRadius: "8px", overflow: "hidden", border: "1px solid var(--border-neutral-semi-weak, rgba(255, 255, 255, 0.15))", height: "300px", width: "100%" }}>
                            <iframe
                                width="100%"
                                height="100%"
                                frameBorder="0"
                                scrolling="no"
                                marginHeight={0}
                                marginWidth={0}
                                src={`https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${gps.latitude},${gps.longitude}`}
                                style={{ border: 0 }}
                            />
                        </div>
                    </div>
                );
            }

            case "raw": {
                const filteredRaw = Object.keys(data.rawTags)
                    .filter(key => {
                        const val = data.rawTags[key];
                        const k = key.toLowerCase();
                        const v = JSON.stringify(val).toLowerCase();
                        const q = searchQuery.toLowerCase();
                        return k.includes(q) || v.includes(q);
                    })
                    .reduce<Record<string, unknown>>((acc, key) => {
                        acc[key] = data.rawTags[key];
                        return acc;
                    }, {});
                const jsonText = JSON.stringify(filteredRaw, null, 2);
                return (
                    <div>
                        {renderSearchInput()}
                        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "8px" }}>
                            <Button size={Button.Sizes.MIN} color={Button.Colors.PRIMARY} onClick={() => {
                                navigator.clipboard.writeText(jsonText);
                                showToast("Copied raw JSON!", Toasts.Type.SUCCESS);
                            }}>Copy Raw JSON</Button>
                        </div>
                        <pre className="vc-mds-raw-pre">{jsonText}</pre>
                    </div>
                );
            }

            default:
                return null;
        }
    };

    return (
        <>
            <Modal {...rootProps} className={`vc-mds-modal ${themeClass}`} size="lg" title="Metadata Inspector">

                <div className="vc-mds-layout">
                    <div className="vc-mds-sidebar">
                        <div className="vc-mds-preview-container">
                            {renderPreview()}
                        </div>
                        <div className="vc-mds-file-info">
                            <div className="vc-mds-info-row">
                                <span className="vc-mds-info-label">Name</span>
                                <span className="vc-mds-info-value" title={data ? data.fileInfo.name : name}>{data ? data.fileInfo.name : name}</span>
                            </div>
                            <div className="vc-mds-info-row">
                                <span className="vc-mds-info-label">Size</span>
                                <span className="vc-mds-info-value">{formatBytes(data ? data.fileInfo.size : (size || 0))}</span>
                            </div>
                            <div className="vc-mds-info-row">
                                <span className="vc-mds-info-label">MIME</span>
                                <span className="vc-mds-info-value">{data ? data.fileInfo.mimeType : (mimeType || "unknown")}</span>
                            </div>
                        </div>
                        <div style={{ marginTop: "auto" }}>
                            <Button
                                size={Button.Sizes.MEDIUM}
                                color={Button.Colors.BRAND}
                                style={{ width: "100%" }}
                                onClick={() => window.open(url, "_blank")}
                            >
                                Open in Browser
                            </Button>
                        </div>
                    </div>

                    <div className="vc-mds-main">
                        {loading ? (
                            <div className="vc-mds-loading-state">
                                <div className="vc-mds-spinner" />
                                <span>Reading file structures…</span>
                            </div>
                        ) : error ? (
                            <div className="vc-mds-error-state">
                                <span className="vc-mds-error-title">Analysis Failed</span>
                                <span style={{ fontSize: "13px" }}>{error}</span>
                            </div>
                        ) : (
                            <>
                                <div className="vc-mds-tabs">
                                    {tabs.map(tab => (
                                        <button
                                            key={tab.id}
                                            onClick={() => setActiveTab(tab.id)}
                                            className={`vc-mds-tab ${activeTab === tab.id ? "active" : ""}`}
                                            type="button"
                                        >
                                            {tab.label}
                                        </button>
                                    ))}
                                </div>
                                <div className="vc-mds-tab-content">
                                    {renderTabContent()}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </Modal>
            {isFullscreen && (ReactDOM as any).createPortal(
                <div
                    ref={fullscreenRef}
                    style={{
                        position: "fixed",
                        top: 0,
                        left: 0,
                        width: "100vw",
                        height: "100vh",
                        backgroundColor: "rgba(0, 0, 0, 0.9)",
                        backdropFilter: "blur(10px)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        zIndex: 100000,
                        overflow: "hidden"
                    }}
                    onWheel={handleWheel}
                    onMouseDown={e => {
                        e.stopPropagation();
                        handleMouseDown(e);
                    }}
                    onMouseMove={handleMouseMove}
                    onMouseUp={e => {
                        e.stopPropagation();
                        handleMouseUp();
                    }}
                    onMouseLeave={handleMouseLeave}
                    onClick={e => {
                        e.stopPropagation();
                        if (e.target === e.currentTarget) {
                            setIsFullscreen(false);
                            resetZoom();
                        }
                    }}
                >
                    <img
                        src={url}
                        alt="Fullscreen Preview"
                        style={{
                            maxWidth: "90%",
                            maxHeight: "90%",
                            objectFit: "contain",
                            transform: `translate(${dragOffset.x}px, ${dragOffset.y}px) scale(${zoomScale})`,
                            transformOrigin: "center center",
                            transition: isDragging ? "none" : "transform 0.15s ease-out",
                            userSelect: "none",
                            pointerEvents: "auto",
                            cursor: zoomScale > 1 ? (isDragging ? "grabbing" : "grab") : "default"
                        }}
                        onDragStart={e => e.preventDefault()}
                    />
                    <div
                        onMouseDown={e => e.stopPropagation()}
                        onMouseUp={e => e.stopPropagation()}
                        onClick={e => e.stopPropagation()}
                        onWheel={e => e.stopPropagation()}
                        style={{
                            position: "absolute",
                            bottom: "30px",
                            left: "50%",
                            transform: "translateX(-50%)",
                            display: "flex",
                            alignItems: "center",
                            gap: "16px",
                            backgroundColor: "rgba(0, 0, 0, 0.75)",
                            padding: "10px 20px",
                            borderRadius: "30px",
                            backdropFilter: "blur(8px)",
                            border: "1px solid rgba(255, 255, 255, 0.15)",
                            zIndex: 100001
                        }}
                    >
                        <button
                            onClick={e => {
                                e.stopPropagation();
                                copyImageToClipboard();
                            }}
                            style={{
                                background: "none",
                                border: "none",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: "pointer",
                                color: "#fff",
                                opacity: 0.8,
                                transition: "opacity 0.2s"
                            }}
                            onMouseEnter={e => { e.currentTarget.style.opacity = "1"; }}
                            onMouseLeave={e => { e.currentTarget.style.opacity = "0.8"; }}
                            title="Copy Image"
                            type="button"
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                        </button>
                        <button
                            onClick={e => {
                                e.stopPropagation();
                                downloadImage();
                            }}
                            style={{
                                background: "none",
                                border: "none",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: "pointer",
                                color: "#fff",
                                opacity: 0.8,
                                transition: "opacity 0.2s"
                            }}
                            onMouseEnter={e => { e.currentTarget.style.opacity = "1"; }}
                            onMouseLeave={e => { e.currentTarget.style.opacity = "0.8"; }}
                            title="Download Image"
                            type="button"
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="7 10 12 15 17 10" />
                                <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                        </button>
                        <div style={{ width: "1px", height: "16px", backgroundColor: "rgba(255, 255, 255, 0.2)" }} />
                        <button
                            onClick={e => {
                                e.stopPropagation();
                                setIsFullscreen(false);
                                resetZoom();
                            }}
                            style={{
                                background: "none",
                                border: "none",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: "pointer",
                                color: "#fff",
                                opacity: 0.8,
                                transition: "opacity 0.2s"
                            }}
                            onMouseEnter={e => { e.currentTarget.style.opacity = "1"; }}
                            onMouseLeave={e => { e.currentTarget.style.opacity = "0.8"; }}
                            title="Close Fullscreen"
                            type="button"
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                        </button>
                    </div>
                </div>,
                document.body
            )}
        </>
    );
}
