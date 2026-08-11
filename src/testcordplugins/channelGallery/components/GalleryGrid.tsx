/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button, React, useEffect, useMemo, useRef, useState } from "@webpack/common";

import type { GalleryItem } from "../utils/extractImages";

const GAP = 10;
const PADDING = 14;
const OVERSCAN_ROWS = 3;
const MIN_THUMB = 120;
const MAX_THUMB = 150;

function withSizeParams(url: string, size: number) {
    try {
        const u = new URL(url);
        u.searchParams.set("width", String(size));
        u.searchParams.set("height", String(size));
        return u.toString();
    } catch {
        return url;
    }
}

function getThumbUrl(item: GalleryItem, size: number) {
    const url = item.proxyUrl ?? item.url;
    return withSizeParams(url, size);
}

export function GalleryGrid(props: {
    items: GalleryItem[];
    showCaptions: boolean;
    isLoading: boolean;
    hasMore: boolean;
    error: string | null;
    onRetry(): void;
    onLoadMore(): void;
    onSelect(index: number): void;
}) {
    const { items, showCaptions, isLoading, hasMore, error, onRetry, onLoadMore, onSelect } = props;

    const scrollRef = useRef<HTMLDivElement>(null);
    const [viewport, setViewport] = useState({ width: 0, height: 0, scrollTop: 0 });

    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;

        let frameId: number | null = null;
        const updateSize = () => {
            if (!el) return;
            setViewport(v => {
                const w = el.clientWidth;
                const h = el.clientHeight;
                if (v.width === w && v.height === h) return v;
                return { ...v, width: w, height: h };
            });
        };

        const ro = new ResizeObserver(() => {
            if (frameId) cancelAnimationFrame(frameId);
            frameId = requestAnimationFrame(updateSize);
        });
        ro.observe(el);
        updateSize();

        return () => {
            if (frameId) cancelAnimationFrame(frameId);
            ro.disconnect();
        };
    }, []);

    const usableWidth = Math.max(1, viewport.width - PADDING * 2);
    const columns = Math.max(1, Math.floor((usableWidth + GAP) / (MIN_THUMB + GAP)));
    const cell = Math.max(MIN_THUMB, Math.min(MAX_THUMB, Math.floor((usableWidth - (columns - 1) * GAP) / columns)));
    const thumbSize = Math.max(128, Math.min(512, cell * 2));
    const rowHeight = cell + GAP;
    const rows = Math.ceil(items.length / columns);
    const totalHeight = rows * rowHeight + PADDING * 2;

    const { startIndex, endIndex } = useMemo(() => {
        const startRow = Math.max(0, Math.floor((viewport.scrollTop - PADDING) / rowHeight) - OVERSCAN_ROWS);
        const endRow = Math.min(rows, Math.ceil((viewport.scrollTop + viewport.height) / rowHeight) + OVERSCAN_ROWS);
        return {
            startIndex: startRow * columns,
            endIndex: Math.min(items.length, endRow * columns)
        };
    }, [columns, items.length, rowHeight, rows, viewport.height, viewport.scrollTop]);

    // Infinite load: observe a sentinel element near the bottom.
    const sentinelRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const root = scrollRef.current;
        const target = sentinelRef.current;
        if (!root || !target) return;

        const io = new IntersectionObserver(
            entries => {
                const entry = entries[0];
                if (!entry?.isIntersecting) return;
                if (isLoading || !hasMore) return;
                onLoadMore();
            },
            { root, rootMargin: "600px" }
        );
        io.observe(target);
        return () => io.disconnect();
    }, [hasMore, isLoading, onLoadMore]);

    return (
        <div
            ref={scrollRef}
            className="vc-channel-gallery-scroll"
            onScroll={e => {
                const el = e.currentTarget;
                setViewport(v => {
                    if (v.scrollTop === el.scrollTop) return v;
                    return { ...v, scrollTop: el.scrollTop };
                });
            }}
            style={{
                height: "100%",
                overflow: "auto",
                padding: PADDING,
                boxSizing: "border-box"
            }}
        >
            <div style={{ position: "relative", height: totalHeight }}>
                {items.slice(startIndex, endIndex).map((item, i) => {
                    const idx = startIndex + i;
                    const row = Math.floor(idx / columns);
                    const col = idx % columns;

                    return (
                        <button
                            key={item.key}
                            onClick={() => onSelect(idx)}
                            style={{
                                position: "absolute",
                                left: col * (cell + GAP),
                                top: row * rowHeight,
                                width: cell,
                                height: cell,
                                padding: 0,
                                border: "none",
                                background: "transparent",
                                cursor: "pointer"
                            }}
                        >
                            <div
                                style={{
                                    width: cell,
                                    height: cell,
                                    borderRadius: 10,
                                    overflow: "hidden",
                                    background: "var(--background-secondary)"
                                }}
                            >
                                <img
                                    src={getThumbUrl(item, thumbSize)}
                                    alt={item.filename ?? "Image"}
                                    loading="lazy"
                                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                                />
                            </div>
                            {showCaptions && item.filename && (
                                <div
                                    title={item.filename}
                                    style={{
                                        marginTop: 6,
                                        fontSize: 12,
                                        color: "var(--text-muted)",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                        width: cell
                                    }}
                                >
                                    {item.filename}
                                </div>
                            )}
                        </button>
                    );
                })}
                <div ref={sentinelRef} style={{ position: "absolute", left: 0, top: totalHeight - 1, width: 1, height: 1 }} />
            </div>

            <div style={{ padding: "10px 0 16px", textAlign: "center" }}>
                {error ? (
                    <div style={{ color: "var(--text-danger)" }}>
                        {error}{" "}
                        <Button size={Button.Sizes.SMALL} onClick={onRetry}>
                            Retry
                        </Button>
                    </div>
                ) : isLoading ? (
                    <div style={{ color: "var(--text-muted)" }}>Loading…</div>
                ) : !items.length ? (
                    <div style={{ color: "var(--text-muted)" }}>No images found yet</div>
                ) : !hasMore ? (
                    <div style={{ color: "var(--text-muted)" }}>End of history</div>
                ) : null}
            </div>
        </div>
    );
}
