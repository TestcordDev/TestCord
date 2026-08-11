/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DataStore, TestcordRequestCoordinator } from "@api/index";
import { classNameFactory } from "@utils/css";
import { sleep } from "@utils/misc";
import type { Channel, Message, User } from "@vencord/discord-types";
import { Avatar, ChannelStore, RestAPI, useMemo, UserStore } from "@webpack/common";

const DiscordAPI = RestAPI;

const cl = classNameFactory("vc-search-utility-");

// Bound the persistent caches so they can't grow without limit across sessions
const MAX_CACHED_MEDIA_ITEMS = 2000;
const MAX_CACHED_MESSAGES = 5000;

// Interfaces for the cache
export interface MediaCache {
    channelId: string;
    messages: Array<{
        id: string;
        content: string;
        timestamp: number;
        attachments: Array<{ url: string; filename: string; content_type?: string; }>;
        embeds: Array<{ url?: string; image?: { url: string; }; }>;
    }>;
    lastUpdated: number;
}

export interface MediaItemsCache {
    channelId: string;
    items: Array<{
        url: string;
        thumbnailUrl?: string;
        type: "image" | "video" | "embed" | "sticker";
        messageId: string;
        channelId: string;
        userId?: string;
        timestamp: number;
    }>;
    lastUpdated: number;
}

export interface SearchResult {
    message: Message;
    channel: Channel;
    user?: User;
    matchType: "content" | "author" | "attachment";
    highlight?: string;
    mediaInfo?: {
        url: string;
        thumbnailUrl?: string;
        type: "image" | "video" | "embed" | "sticker";
    };
}

interface MediaGridProps {
    displayedResults: SearchResult[];
    allResults: SearchResult[];
    navigateToMessage: (result: SearchResult) => void;
    setSelectedIndex: (index: number) => void;
    selectedIndex: number;
}

// Function to create an optimized thumbnail URL
function createThumbnailUrl(url: string, isVideo: boolean = false): string {
    if (!url || url.endsWith("#")) return url;

    try {
        const urlObj = new URL(url);

        // For images, use the appropriate size for thumbnails
        if (!isVideo && urlObj.hostname.includes("discord")) {
            // Discord CDN/proxy - add size parameters for thumbnails
            urlObj.searchParams.set("width", "300");
            urlObj.searchParams.set("height", "300");
            return urlObj.toString();
        }

        return url;
    } catch {
        return url;
    }
}

// Function to extract media URLs from a message
export function getMediaUrls(message: Message | any): Array<{ url: string; type: "image" | "video" | "embed" | "sticker"; thumbnailUrl?: string; }> {
    const urls: Array<{ url: string; type: "image" | "video" | "embed" | "sticker"; thumbnailUrl?: string; }> = [];

    // Attachments
    if (message.attachments?.length > 0) {
        for (const attachment of message.attachments) {
            const url = attachment.proxy_url || attachment.url || attachment.proxyUrl;
            if (url && !url.endsWith("#")) { // Ignore invalid URLs
                const contentType = attachment.content_type?.toLowerCase() || attachment.contentType?.toLowerCase() || "";
                const filename = attachment.filename?.toLowerCase() || "";
                const isImage = contentType.startsWith("image/") ||
                    /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(url) ||
                    /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(filename);
                const isVideo = contentType.startsWith("video/") ||
                    /\.(mp4|webm|mov|avi)$/i.test(url) ||
                    /\.(mp4|webm|mov|avi)$/i.test(filename);

                if (isImage || isVideo) {
                    urls.push({
                        url,
                        type: isImage ? "image" : "video",
                        thumbnailUrl: createThumbnailUrl(url, isVideo)
                    });
                }
            }
        }
    }

    // Embeds with images
    if (message.embeds?.length > 0) {
        for (const embed of message.embeds) {
            if (embed.image?.url) {
                urls.push({
                    url: embed.image.url,
                    type: "embed",
                    thumbnailUrl: createThumbnailUrl(embed.image.proxy_url || embed.image.url)
                });
            } else if (embed.thumbnail?.url) {
                urls.push({
                    url: embed.thumbnail.url,
                    type: "embed",
                    thumbnailUrl: createThumbnailUrl(embed.thumbnail.proxy_url || embed.thumbnail.url)
                });
            }
        }
    }

    // Stickers
    const stickers = message.stickerItems || message.stickers || [];
    if (stickers.length > 0) {
        for (const sticker of stickers) {
            const stickerId = sticker.id || sticker.sticker_id;
            const format = sticker.format || sticker.format_type;
            if (stickerId) {
                const url = format === 1 || format === 2
                    ? `https://cdn.discordapp.com/stickers/${stickerId}.png?size=256`
                    : format === 3
                        ? `https://cdn.discordapp.com/stickers/${stickerId}.gif?size=256`
                        : null;
                if (url) {
                    urls.push({ url, type: "sticker" });
                }
            }
        }
    }

    return urls;
}

// Function to load all media with API pagination (no limit)
export async function loadAllMediaFromAPI(channelId: string, apiRequestDelay: number, signal?: AbortSignal): Promise<any[]> {
    const allMessages: any[] = [];
    let before: string | null = null;
    const limit = 100;
    const delayBetweenRequests = Math.max(apiRequestDelay || 200, 500);

    // Load from cache first to see how much we already have
    const cacheKey = `ultra-search-media-${channelId}`;
    try {
        const cached = await DataStore.get(cacheKey) as MediaCache | null | undefined;
        if (cached && cached.messages && cached.messages.length > 0) {
            // Use the last message ID as starting point
            const lastMessage = cached.messages[cached.messages.length - 1];
            before = lastMessage.id || null;
            console.log(`[Ultra Advanced Search] Resuming from message ${before}`);
        }
    } catch (error) {
        console.error("[Ultra Advanced Search] Error loading cache for resume:", error);
    }

    let page = 1;
    const maxPages = 50; // Safety limit

    while (page <= maxPages) {
        if (signal?.aborted || !channelId || channelId === "undefined") break;
        try {
            // Delay between requests to avoid rate limits
            if (page > 1) {
                await sleep(delayBetweenRequests);
            }

            const url = before
                ? `/channels/${channelId}/messages?limit=${limit}&before=${before}`
                : `/channels/${channelId}/messages?limit=${limit}`;

            const response = await TestcordRequestCoordinator.request({
                key: `discord:messages:${channelId}:before:${before ?? ""}:limit:${limit}`,
                ttlMs: 30_000,
                run: () => DiscordAPI.get({
                    url,
                    retries: 1
                }),
            });

            if (!response?.body || !Array.isArray(response.body) || response.body.length === 0) {
                break;
            }
            if (signal?.aborted) break;

            // Filter only messages with media
            const mediaMessages = response.body.filter((msg: any) => {
                return msg.attachments?.length > 0 ||
                    msg.embeds?.length > 0 ||
                    msg.sticker_items?.length > 0 ||
                    msg.stickers?.length > 0;
            });

            allMessages.push(...mediaMessages);
            console.log(`[Ultra Advanced Search] Page ${page}: ${mediaMessages.length} media messages loaded (${allMessages.length} total)`);

            // Prepare for the next page
            before = response.body[response.body.length - 1]?.id;
            if (!before) break;

            // If we have fewer messages than the limit, we've reached the end
            if (response.body.length < limit) break;

            page++;
        } catch (error: any) {
            console.error(`[Ultra Advanced Search] Error loading page ${page}:`, error);
            break;
        }
    }

    return allMessages;
}

// Function to load all media from DMs with API pagination and infinite persistence
export async function searchMediaMessages(
    channelId: string,
    query: string,
    cacheOnly: boolean,
    apiRequestDelay: number,
    signal?: AbortSignal
): Promise<SearchResult[]> {
    console.log(`[Ultra Advanced Search] searchMediaMessages called for ${channelId}, query: "${query}"`);
    const results: SearchResult[] = [];
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) {
        console.log(`[Ultra Advanced Search] Channel ${channelId} not found`);
        return results;
    }

    const cacheKey = `ultra-search-media-${channelId}`;

    // Load from persistent cache (no time limit)
    let cached: MediaCache | null = null;
    try {
        const cachedData = await DataStore.get(cacheKey) as MediaCache | null | undefined;
        cached = cachedData || null;
        if (cached) {
            console.log(`[Ultra Advanced Search] Cache found for ${channelId}: ${cached.messages?.length || 0} messages`);
        }
    } catch (error) {
        console.error("[Ultra Advanced Search] Error loading cache:", error);
    }

    let allMediaMessages: any[] = [];

    if (cached && cached.messages && cached.messages.length > 0) {
        // Use the existing cache
        console.log(`[Ultra Advanced Search] Using cache for ${channelId} (${cached.messages.length} messages)`);
        allMediaMessages = cached.messages;
    }

    // If cacheOnly is false, load from the API too (in background)
    if (!cacheOnly && (!cached || !cached.messages || cached.messages.length === 0)) {
        // Load from the API with pagination
        console.log(`[Ultra Advanced Search] Loading media from API for ${channelId}`);
        const apiMessages = await loadAllMediaFromAPI(channelId, apiRequestDelay, signal);
        if (signal?.aborted) return results;

        // Merge with existing cache (avoid duplicates)
        if (apiMessages.length > 0) {
            const existingIds = new Set(allMediaMessages.map(m => m.id || m.message_id));
            for (const msg of apiMessages) {
                const msgId = msg.id || msg.message_id;
                if (!existingIds.has(msgId)) {
                    allMediaMessages.push(msg);
                    existingIds.add(msgId);
                }
            }

            // Save in persistent cache (bounded to the newest MAX_CACHED_MESSAGES)
            try {
                let toCache = allMediaMessages;
                if (toCache.length > MAX_CACHED_MESSAGES) {
                    toCache = toCache.slice(toCache.length - MAX_CACHED_MESSAGES);
                }
                await DataStore.set(cacheKey, {
                    channelId,
                    messages: toCache,
                    lastUpdated: Date.now()
                } as MediaCache);
                console.log(`[Ultra Advanced Search] Cache saved for ${channelId} (${toCache.length} messages)`);
            } catch (error) {
                console.error("[Ultra Advanced Search] Error saving cache:", error);
            }
        }
    }

    // Search in media messages (even without a query, display all media)
    console.log(`[Ultra Advanced Search] Recherche dans ${allMediaMessages.length} messages médias`);

    // Extract and save media items in the dedicated cache (separate from message cache)
    const mediaItems: Array<{
        url: string;
        thumbnailUrl?: string;
        type: "image" | "video" | "embed" | "sticker";
        messageId: string;
        channelId: string;
        userId?: string;
        timestamp: number;
    }> = [];

    for (const msg of allMediaMessages) {
        if (signal?.aborted) return results;
        const hasMedia = msg.attachments?.length > 0 ||
            msg.embeds?.length > 0 ||
            msg.sticker_items?.length > 0 ||
            msg.stickers?.length > 0;

        if (hasMedia) {
            // If no query, display all media. Otherwise, filter by content
            const contentMatch = !query || !query.trim() || msg.content?.includes(query);

            if (contentMatch) {
                // Use the message from cache directly (already formatted)
                results.push({
                    message: msg as any as Message,
                    channel,
                    matchType: "attachment"
                });

                // Extract media URLs for the dedicated cache (images, videos, GIFs)
                const mediaUrls = getMediaUrls(msg);
                const userId = msg.author?.id || msg.author_id;

                for (const media of mediaUrls) {
                    mediaItems.push({
                        url: media.url,
                        thumbnailUrl: media.thumbnailUrl,
                        type: media.type,
                        messageId: msg.id || msg.message_id,
                        channelId: channelId,
                        userId: userId,
                        timestamp: msg.timestamp?.valueOf() || (msg as any).timestamp || Date.now()
                    });
                }
            }
        }
    }

    // Save the media items cache (images, videos, GIFs) - SEPARATE CACHE
    if (mediaItems.length > 0 && !cacheOnly) {
        const mediaItemsCacheKey = `ultra-search-media-items-${channelId}`;
        try {
            const existingCache = await DataStore.get(mediaItemsCacheKey) as MediaItemsCache | null | undefined;
            const existingItems = existingCache?.items || [];

            // Merge with existing items (avoid duplicates)
            const existingUrls = new Set(existingItems.map(item => `${item.messageId}-${item.url}`));
            const newItems = mediaItems.filter(item => !existingUrls.has(`${item.messageId}-${item.url}`));

            if (newItems.length > 0 || existingItems.length === 0) {
                // Bound cache growth: keep only the newest MAX_CACHED_MEDIA_ITEMS entries
                let merged = [...existingItems, ...newItems];
                if (merged.length > MAX_CACHED_MEDIA_ITEMS) {
                    merged = merged
                        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
                        .slice(0, MAX_CACHED_MEDIA_ITEMS);
                }
                await DataStore.set(mediaItemsCacheKey, {
                    channelId,
                    items: merged,
                    lastUpdated: Date.now()
                } as MediaItemsCache);
                console.log(`[Ultra Advanced Search] Media items cache saved for ${channelId} (${merged.length} items)`);
            }
        } catch (error) {
            console.error("[Ultra Advanced Search] Error while saving the media item cache:", error);
        }
    }

    console.log(`[Ultra Advanced Search] ${results.length} media results found for ${channelId}`);
    return results;
}

// Function to get the avatar URL
function getAvatarURL(user: User | null, channel: Channel): string | null {
    if (!user) return null;
    try {
        return user.getAvatarURL?.(channel.guild_id, 128) ||
            (user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.webp?size=128` : null);
    } catch {
        return user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.webp?size=128` : null;
    }
}

// Optimized MediaGrid component with useMemo
export function MediaGrid({ displayedResults, navigateToMessage, setSelectedIndex, selectedIndex }: MediaGridProps) {
    // Use useMemo to avoid recalculating media on each render
    const mediaItems = useMemo(() => {
        const items: Array<{ url: string; type: "image" | "video" | "embed" | "sticker"; thumbnailUrl?: string; message: Message | any; channel: Channel; user: User | null; }> = [];

        // Collect all media from displayed results
        for (const result of displayedResults) {
            const { message } = result;
            const user = result.user || UserStore.getUser(message.author?.id || (message as any).author_id);

            // If the result already has media info (from items cache), use it directly
            if (result.mediaInfo) {
                items.push({
                    url: result.mediaInfo.url,
                    thumbnailUrl: result.mediaInfo.thumbnailUrl,
                    type: result.mediaInfo.type,
                    message: message,
                    channel: result.channel,
                    user
                });
            } else {
                // Otherwise, extract media from the message
                const mediaUrls = getMediaUrls(message);
                for (const media of mediaUrls) {
                    items.push({
                        ...media,
                        message: message,
                        channel: result.channel,
                        user
                    });
                }
            }
        }

        console.log(`[Ultra Advanced Search] Total media to display: ${items.length}`);
        return items;
    }, [displayedResults]);

    if (mediaItems.length === 0) {
        return (
            <div className={cl("no-results")}>
                <span>No media found</span>
            </div>
        );
    }

    return (
        <div className={cl("media-grid")} style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", width: "100%", gap: "2px" }}>
            {mediaItems.map((item, index) => {
                const avatarUrl = getAvatarURL(item.user, item.channel);
                const messageId = item.message.id || item.message.message_id;
                const channelId = item.message.channel_id || item.channel.id;

                return (
                    <div
                        key={`${channelId}-${messageId}-${index}`}
                        className={cl("media-item")}
                        style={{
                            aspectRatio: "1 / 1",
                            width: "100%",
                            paddingBottom: 0
                        }}
                        onClick={() => navigateToMessage({ message: item.message, channel: item.channel, matchType: "attachment" })}
                        onMouseEnter={() => setSelectedIndex(index)}
                    >
                        <div className={cl("media-thumbnail")}>
                            {item.type === "video" ? (
                                <>
                                    <img
                                        src={item.thumbnailUrl || item.url}
                                        alt=""
                                        className={cl("media-image")}
                                        style={{
                                            width: "100%",
                                            height: "100%",
                                            objectFit: "cover",
                                            objectPosition: "center"
                                        }}
                                        loading="lazy"
                                        onError={e => {
                                            (e.target as HTMLImageElement).style.display = "none";
                                        }}
                                    />
                                    <div className={cl("media-play-icon")}>▶</div>
                                </>
                            ) : (
                                <img
                                    src={item.thumbnailUrl || item.url}
                                    alt=""
                                    className={cl("media-image")}
                                    style={{
                                        width: "100%",
                                        height: "100%",
                                        objectFit: "cover",
                                        objectPosition: "center"
                                    }}
                                    loading="lazy"
                                    onError={e => {
                                        (e.target as HTMLImageElement).style.display = "none";
                                    }}
                                />
                            )}
                        </div>
                        {avatarUrl && (
                            <div className={cl("media-user-avatar")}>
                                <Avatar
                                    src={avatarUrl}
                                    size="SIZE_24"
                                    className={cl("media-avatar")}
                                />
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
