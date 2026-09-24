/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { openImageModal } from "@utils/discord";
import { findByPropsLazy } from "@webpack";
import { Button, openMediaModal, React, showToast, Toasts, Tooltip, useEffect, useRef, useState } from "@webpack/common";

import { downloadItemsToFolder } from "../utils/download";
import type { GalleryItem } from "../utils/extractImages";
import { ArrowLeftIcon, ChevronLeftIcon, ChevronRightIcon, DownloadIcon, JumpMessageIcon, SpinnerIcon } from "./Icons";

const jumper: any = findByPropsLazy("jumpToMessage");

function preload(url: string) {
    const img = new Image();
    img.src = url;
}

export function LightboxViewer(props: {
    items: GalleryItem[];
    index: number;
    channelId: string;
    onClose(): void;
    onChangeIndex(nextIndex: number): void;
    onOpenMessage(): void;
}) {
    const { items, index, channelId, onClose, onChangeIndex } = props;
    const item = items[index];
    const url = item?.proxyUrl ?? item?.url;

    const [downloading, setDownloading] = useState(false);
    const [imgFailed, setImgFailed] = useState(false);

    const hasPrev = index > 0;
    const hasNext = index < items.length - 1;

    const prevIndex = hasPrev ? index - 1 : index;
    const nextIndex = hasNext ? index + 1 : index;

    const isNativeViewerOpen = useRef(false);

    const handleOpenNative = () => {
        if (!item || !url) return;
        isNativeViewerOpen.current = true;
        try {
            openMediaModal({
                items: items.map(it => ({
                    type: "IMAGE",
                    url: it.url,
                    original: it.url,
                    width: it.width ?? 1280,
                    height: it.height ?? 720
                })),
                startingIndex: index,
                onIndexChange: (idx: any) => {
                    const nextIdx = typeof idx === "number" ? idx : idx?.index;
                    if (typeof nextIdx === "number" && nextIdx >= 0 && nextIdx < items.length) {
                        onChangeIndex(nextIdx);
                    }
                },
                onCloseCallback: () => {
                    isNativeViewerOpen.current = false;
                }
            });
        } catch {
            openImageModal(
                {
                    url: item.url,
                    original: item.url,
                    width: item.width ?? 1280,
                    height: item.height ?? 720
                },
                {
                    onCloseCallback: () => {
                        isNativeViewerOpen.current = false;
                    }
                }
            );
        }
    };

    useEffect(() => {
        const isMediaModalActive = () => {
            return isNativeViewerOpen.current || Boolean(document.querySelector('[class*="mediaModal"], [aria-label*="Media Viewer"]'));
        };

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                if (isMediaModalActive()) {
                    isNativeViewerOpen.current = false;
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                onClose();
            } else if (e.key === "ArrowLeft" && hasPrev) {
                if (isMediaModalActive()) return;
                e.preventDefault();
                onChangeIndex(prevIndex);
            } else if (e.key === "ArrowRight" && hasNext) {
                if (isMediaModalActive()) return;
                e.preventDefault();
                onChangeIndex(nextIndex);
            }
        };
        window.addEventListener("keydown", onKeyDown, { capture: true });
        return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
    }, [hasNext, hasPrev, nextIndex, onChangeIndex, onClose, prevIndex]);

    useEffect(() => {
        const prev = items[prevIndex];
        const next = items[nextIndex];
        if (prev?.url) preload(prev.url);
        if (next?.url) preload(next.url);
    }, [items, nextIndex, prevIndex]);

    useEffect(() => {
        setImgFailed(false);
    }, [index, url]);

    if (!item || !url) {
        return (
            <div
                style={{
                    height: "min(72vh, 680px)",
                    minHeight: 380,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 16,
                    padding: 24,
                    background: "var(--background-primary)",
                    color: "var(--text-muted)",
                    fontSize: 14
                }}
            >
                <span>Unable to load this image.</span>
                <Button size={Button.Sizes.SMALL} onClick={onClose}>
                    Back to gallery
                </Button>
            </div>
        );
    }

    const jump = () => {
        try {
            jumper.jumpToMessage({
                channelId,
                messageId: item.messageId,
                flash: true,
                jumpType: "INSTANT"
            });
        } finally {
            props.onOpenMessage();
        }
    };

    async function handleDownload() {
        if (downloading) return;
        setDownloading(true);
        try {
            const { saved, failed } = await downloadItemsToFolder([item]);
            if (saved || failed) {
                showToast(
                    failed ? `Saved ${saved} of 1 file. ${failed} failed.` : "Saved 1 file.",
                    failed ? Toasts.Type.FAILURE : Toasts.Type.SUCCESS
                );
            }
        } finally {
            setDownloading(false);
        }
    }

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                height: "min(72vh, 680px)",
                minHeight: 420,
                width: "100%",
                background: "var(--background-primary)",
                overflow: "hidden"
            }}
        >
            <div
                style={{
                    height: 48,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "0 14px",
                    borderBottom: "1px solid var(--background-modifier-accent)",
                    background: "var(--background-secondary)",
                    flexShrink: 0,
                    gap: 12
                }}
            >
                <div style={{ display: "flex", alignItems: "center", height: 32, minWidth: 72 }}>
                    <Tooltip text="Back">
                        {(tooltipProps: any) => (
                            <button
                                {...tooltipProps}
                                className="vc-channel-gallery-icon-btn square"
                                onClick={onClose}
                                aria-label="Back"
                            >
                                <ArrowLeftIcon size={18} />
                            </button>
                        )}
                    </Tooltip>
                </div>

                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flex: 1,
                        minWidth: 0,
                        height: 32
                    }}
                >
                    <div
                        className="vc-channel-gallery-title-pill"
                        title={item.filename ? `${item.filename} (${index + 1} / ${items.length})` : undefined}
                    >
                        <span className="vc-channel-gallery-title-name">
                            {item.filename ?? "Image"}
                        </span>
                        <span className="vc-channel-gallery-title-count">
                            • {index + 1} / {items.length}
                        </span>
                    </div>
                </div>

                <div
                    style={{
                        display: "flex",
                        gap: 8,
                        alignItems: "center",
                        justifyContent: "flex-end",
                        height: 32,
                        minWidth: 72
                    }}
                >
                    <Tooltip text={downloading ? "Downloading…" : "Download"}>
                        {(tooltipProps: any) => (
                            <button
                                {...tooltipProps}
                                className="vc-channel-gallery-icon-btn square"
                                disabled={downloading}
                                onClick={handleDownload}
                                aria-label="Download"
                            >
                                {downloading ? <SpinnerIcon size={18} /> : <DownloadIcon size={18} />}
                            </button>
                        )}
                    </Tooltip>

                    <Tooltip text="Jump to message">
                        {(tooltipProps: any) => (
                            <button
                                {...tooltipProps}
                                className="vc-channel-gallery-icon-btn square"
                                onClick={jump}
                                aria-label="Jump to message"
                            >
                                <JumpMessageIcon size={18} />
                            </button>
                        )}
                    </Tooltip>
                </div>
            </div>

            <div
                style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "16px 20px",
                    gap: 16,
                    overflow: "hidden",
                    position: "relative"
                }}
            >
                <Tooltip text="Previous">
                    {(tooltipProps: any) => (
                        <button
                            {...tooltipProps}
                            className="vc-channel-gallery-nav-btn"
                            disabled={!hasPrev}
                            onClick={() => hasPrev && onChangeIndex(prevIndex)}
                            aria-label="Previous"
                        >
                            <ChevronLeftIcon size={22} />
                        </button>
                    )}
                </Tooltip>

                <div
                    style={{
                        flex: 1,
                        height: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        overflow: "hidden",
                        userSelect: "none"
                    }}
                >
                    <img
                        src={imgFailed && item.url ? item.url : url}
                        alt={item.filename ?? "Image"}
                        onClick={handleOpenNative}
                        onError={() => {
                            if (!imgFailed && item.url && item.url !== url) setImgFailed(true);
                        }}
                        style={{
                            maxWidth: "100%",
                            maxHeight: "100%",
                            objectFit: "contain",
                            borderRadius: 8,
                            boxShadow: "0 6px 24px rgba(0, 0, 0, 0.35)",
                            background: "var(--background-secondary)",
                            cursor: "pointer"
                        }}
                    />
                </div>

                <Tooltip text="Next">
                    {(tooltipProps: any) => (
                        <button
                            {...tooltipProps}
                            className="vc-channel-gallery-nav-btn"
                            disabled={!hasNext}
                            onClick={() => hasNext && onChangeIndex(nextIndex)}
                            aria-label="Next"
                        >
                            <ChevronRightIcon size={22} />
                        </button>
                    )}
                </Tooltip>
            </div>
        </div>
    );
}
