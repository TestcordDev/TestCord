/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Heading } from "@components/Heading";
import { ModalCloseButton, ModalContent, ModalHeader, ModalProps, ModalRoot, ModalSize } from "@utils/modal";
import { ChannelStore, MessageStore, React, useEffect, useMemo, useRef, useState } from "@webpack/common";

import { extractImages, GalleryItem } from "../utils/extractImages";
import { fetchMessagesPage } from "../utils/pagination";
import { GalleryGrid } from "./GalleryGrid";
import { LightboxViewer } from "./LightboxViewer";

type PluginSettings = {
    includeGifs: boolean;
    includeEmbeds: boolean;
    showCaptions: boolean;
    pageSize: number;
    preloadPages: number;
};

type GalleryCache = {
    items: GalleryItem[];
    keys: Set<string>;
    oldestMessageId: string | null;
    hasMore: boolean;
};

const cacheByChannel = new Map<string, GalleryCache>();
const MAX_CHANNEL_CACHES = 25;
const MAX_CACHE_ITEMS = 1000;

function pruneChannelCaches() {
    while (cacheByChannel.size > MAX_CHANNEL_CACHES) {
        const oldest = cacheByChannel.keys().next().value;
        if (!oldest) break;
        cacheByChannel.delete(oldest);
    }
}

function pushCacheItem(cache: GalleryCache, item: GalleryItem) {
    if (cache.items.length >= MAX_CACHE_ITEMS) {
        const removed = cache.items.shift();
        if (removed) cache.keys.delete(removed.key);
    }

    cache.keys.add(item.key);
    cache.items.push(item);
}

function seedCacheFromMessageStore(cache: GalleryCache, channelId: string, settings: PluginSettings) {
    try {
        const localMsgs = MessageStore?.getMessages?.(channelId);
        const msgsArray: any[] = (localMsgs as any)?._array ?? (localMsgs as any)?.toArray?.() ?? (Array.isArray(localMsgs) ? localMsgs : []);

        if (msgsArray.length > 0) {
            const extracted = extractImages(msgsArray, channelId, {
                includeEmbeds: settings.includeEmbeds,
                includeGifs: settings.includeGifs
            });

            for (const it of extracted) {
                if (cache.keys.has(it.key)) continue;
                pushCacheItem(cache, it);
            }

            if (!cache.oldestMessageId && msgsArray.length > 0) {
                const oldest = msgsArray[0]?.id ?? msgsArray[msgsArray.length - 1]?.id;
                if (oldest) cache.oldestMessageId = String(oldest);
            }
        }
    } catch (e) {
        console.warn("[ChannelGallery] Failed to seed from MessageStore:", e);
    }
}

function getOrCreateCache(channelId: string, settings: PluginSettings): GalleryCache {
    const existing = cacheByChannel.get(channelId);
    if (existing) {
        cacheByChannel.delete(channelId);
        cacheByChannel.set(channelId, existing);
        return existing;
    }
    const created: GalleryCache = {
        items: [],
        keys: new Set(),
        oldestMessageId: null,
        hasMore: true
    };
    cacheByChannel.set(channelId, created);
    pruneChannelCaches();

    seedCacheFromMessageStore(created, channelId, settings);
    return created;
}

export function GalleryModal(props: ModalProps & { channelId: string; settings: PluginSettings; }) {
    const { channelId, settings, ...modalProps } = props;

    const channel = ChannelStore?.getChannel?.(channelId);
    const title = channel?.name ? `Gallery — #${channel.name}` : "Gallery";

    const cache = useMemo(() => getOrCreateCache(channelId, settings), [channelId, settings]);

    const [items, setItems] = useState<GalleryItem[]>(() => cache.items);
    const [hasMore, setHasMore] = useState<boolean>(() => cache.hasMore);
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [viewerIndex, setViewerIndex] = useState<number | null>(null);

    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        return () => abortRef.current?.abort();
    }, []);

    async function loadNextPages(pages: number) {
        if (loading) return;
        if (!hasMore) return;

        setLoading(true);
        setError(null);

        const controller = new AbortController();
        abortRef.current?.abort();
        abortRef.current = controller;

        try {
            let before = cache.oldestMessageId;
            let localHasMore = cache.hasMore;

            for (let i = 0; i < pages && localHasMore; i++) {
                const msgs = await fetchMessagesPage({
                    channelId,
                    before,
                    limit: Math.max(1, Math.floor(settings.pageSize ?? 100)),
                    signal: controller.signal
                });

                if (!msgs.length) {
                    localHasMore = false;
                    break;
                }

                before = msgs[msgs.length - 1]?.id ?? before;
                cache.oldestMessageId = before;

                const extracted = extractImages(msgs, channelId, {
                    includeEmbeds: settings.includeEmbeds,
                    includeGifs: settings.includeGifs
                });

                for (const it of extracted) {
                    if (cache.keys.has(it.key)) continue;
                    pushCacheItem(cache, it);
                }
            }

            cache.hasMore = localHasMore;

            setItems([...cache.items]);
            setHasMore(cache.hasMore);
        } catch (e: any) {
            if (e?.name === "AbortError") return;
            setError("Unable to load gallery items");
            setItems([...cache.items]);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        if (cache.items.length) {
            setItems([...cache.items]);
        }
        void loadNextPages(Math.max(1, Math.floor(settings.preloadPages ?? 2)));
    }, [channelId]);

    const onCloseAll = () => {
        abortRef.current?.abort();
        modalProps.onClose();
    };

    const viewerItem = viewerIndex != null ? items[viewerIndex] : null;

    return (
        <ModalRoot {...modalProps} size={ModalSize.LARGE} aria-label="Gallery">
            <ModalHeader>
                <Heading tag="h3" style={{ flex: 1, margin: 0 }}>
                    {title}
                </Heading>
                <ModalCloseButton onClick={onCloseAll} />
            </ModalHeader>
            <ModalContent
                className="vc-channel-gallery-modal"
                style={{ padding: 0, overflow: "hidden" }}
            >
                {viewerItem ? (
                    <LightboxViewer
                        items={items}
                        index={viewerIndex!}
                        onClose={() => setViewerIndex(null)}
                        onChangeIndex={setViewerIndex}
                        onOpenMessage={onCloseAll}
                        channelId={channelId}
                    />
                ) : (
                    <GalleryGrid
                        items={items}
                        showCaptions={settings.showCaptions}
                        isLoading={loading}
                        hasMore={hasMore}
                        error={error}
                        onRetry={() => loadNextPages(1)}
                        onLoadMore={() => loadNextPages(1)}
                        onSelect={setViewerIndex}
                    />
                )}
            </ModalContent>
        </ModalRoot>
    );
}
