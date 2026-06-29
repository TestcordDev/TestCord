/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DataStore, TestcordRequestCoordinator } from "@api/index";
import { classNameFactory } from "@utils/css";
import { ModalCloseButton, ModalContent, ModalHeader, ModalProps, ModalRoot, ModalSize } from "@utils/modal";
import type { Channel, Message, User } from "@vencord/discord-types";
import { findStoreLazy } from "@webpack";
import { Avatar, ChannelStore, MessageStore, NavigationRouter, React, RestAPI, TabBar, TextInput, useCallback, useEffect, useRef, UserStore, useState } from "@webpack/common";

import { settings } from "./index";
import { MediaGrid, MediaItemsCache, searchMediaMessages } from "./MediaGrid";

const PrivateChannelSortStore = findStoreLazy("PrivateChannelSortStore") as { getPrivateChannelIds: () => string[]; };

const cl = classNameFactory("vc-search-utility-");

// Bound the per-query results cache: track written keys and evict oldest when over the cap
const SEARCH_CACHE_INDEX_KEY = "ultra-search-results-index";
const MAX_SEARCH_RESULT_KEYS = 100;

async function recordSearchCacheKey(key: string) {
    try {
        const index = (await DataStore.get(SEARCH_CACHE_INDEX_KEY) as string[] | null | undefined) ?? [];
        const existing = index.indexOf(key);
        if (existing !== -1) index.splice(existing, 1);
        index.push(key);
        while (index.length > MAX_SEARCH_RESULT_KEYS) {
            const oldest = index.shift();
            if (oldest) await DataStore.del(oldest);
        }
        await DataStore.set(SEARCH_CACHE_INDEX_KEY, index);
    } catch (error) {
        console.error("[Ultra Advanced Search] Error updating search cache index:", error);
    }
}

enum SearchFilter {
    RECENT = "recent",
    MESSAGES = "messages",
    MEDIA = "media",
    PINNED = "pinned"
}

interface SearchResultsCache {
    query: string;
    filter: SearchFilter;
    channelIds: string[];
    results: SearchResult[];
    lastUpdated: number;
}

interface SearchResult {
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

export function SearchModal({ modalProps }: { modalProps: ModalProps; }) {
    const [query, setQuery] = useState("");
    const [activeFilter, setActiveFilter] = useState<SearchFilter>(SearchFilter.RECENT);
    const [allResults, setAllResults] = useState<SearchResult[]>([]); // All results
    const [displayedResults, setDisplayedResults] = useState<SearchResult[]>([]); // Displayed results
    const [loading, setLoading] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(-1);
    const [stats, setStats] = useState({ total: 0, displayed: 0, loading: false });
    const [loadingMore, setLoadingMore] = useState(false);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const resultsRef = useRef<HTMLDivElement>(null);
    const mediaGridContainerRef = useRef<HTMLDivElement>(null);
    const searchRunIdRef = useRef(0);
    const abortRef = useRef<AbortController | null>(null);
    const initialLoadLimit = 50; // Number of results to load initially
    const loadMoreBatchSize = 50; // Number of additional results to load on each scroll

    // Focus on the search field on mount
    useEffect(() => {
        searchInputRef.current?.focus();
        return () => {
            searchRunIdRef.current++;
            abortRef.current?.abort();
        };
    }, []);

    // Search with debounce
    useEffect(() => {
        // For the MEDIA filter, load all media even without a query
        if (activeFilter === SearchFilter.MEDIA && !query.trim()) {
            performSearch("", activeFilter);
            return;
        }

        if (!query.trim()) {
            setAllResults([]);
            setDisplayedResults([]);
            setLoading(false);
            setStats({ total: 0, displayed: 0, loading: false });
            return;
        }

        const timeoutId = setTimeout(() => {
            performSearch(query.trim(), activeFilter);
        }, settings.store.searchTimeout || 300);

        return () => clearTimeout(timeoutId);
    }, [query, activeFilter]);

    // Helper function to search for a whole word (case-sensitive)
    const matchesWholeWord = useCallback((text: string, searchTerm: string): boolean => {
        if (!text || !searchTerm) return false;
        // Escape special regex characters
        const escapedSearch = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        // Create a regex with word boundaries (\b) to search for whole words
        // Case-sensitive
        const regex = new RegExp(`\\b${escapedSearch}\\b`);
        return regex.test(text);
    }, []);

    // Keyboard navigation optimized with useCallback
    const navigateToMessage = useCallback((result: SearchResult) => {
        const { message, channel } = result;
        const messageId = message.id || (message as any).message_id;
        const channelId = message.channel_id || channel.id;
        const guildId = channel.guild_id || "@me";
        const url = `/channels/${guildId}/${channelId}/${messageId}`;
        NavigationRouter.transitionTo(url);
        modalProps.onClose();
    }, [modalProps]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelectedIndex(prev =>
                    prev < displayedResults.length - 1 ? prev + 1 : prev
                );
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelectedIndex(prev => prev > 0 ? prev - 1 : -1);
            } else if (e.key === "Enter" && selectedIndex >= 0 && displayedResults[selectedIndex]) {
                e.preventDefault();
                navigateToMessage(displayedResults[selectedIndex]);
            } else if (e.key === "Escape") {
                e.preventDefault();
                modalProps.onClose();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [displayedResults, selectedIndex, navigateToMessage, modalProps]);

    // Scroll to selected element (only if user navigates with keyboard) - DISABLED for MEDIA
    useEffect(() => {
        // Never auto-scroll for the MEDIA filter
        if (activeFilter === SearchFilter.MEDIA) return;

        if (selectedIndex >= 0 && resultsRef.current) {
            const element = resultsRef.current.children[selectedIndex] as HTMLElement;
            if (element) {
                element.scrollIntoView({ block: "nearest" });
            }
        }
    }, [selectedIndex, activeFilter]);

    // Infinite scroll to load more messages (all filters except MEDIA)
    useEffect(() => {
        if (activeFilter === SearchFilter.MEDIA) return; // Infinite scroll for media is handled separately
        if (displayedResults.length >= allResults.length) return; // Already loaded everything

        const container = resultsRef.current;
        if (!container) return;

        const handleScroll = () => {
            const { scrollTop, scrollHeight, clientHeight } = container;
            const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

            // Load more when 200px from bottom
            if (distanceFromBottom < 200 && !loadingMore && displayedResults.length < allResults.length) {
                setLoadingMore(true);

                // Load the next batch
                const nextBatch = allResults.slice(
                    displayedResults.length,
                    displayedResults.length + loadMoreBatchSize
                );

                setDisplayedResults(prev => [...prev, ...nextBatch]);
                setStats(prev => ({
                    ...prev,
                    displayed: Math.min(prev.displayed + nextBatch.length, allResults.length)
                }));

                // Short delay to avoid loading too quickly
                setTimeout(() => setLoadingMore(false), 100);
            }
        };

        container.addEventListener("scroll", handleScroll, { passive: true });
        return () => container.removeEventListener("scroll", handleScroll);
    }, [activeFilter, displayedResults, allResults, loadingMore, loadMoreBatchSize]);

    // Infinite scroll to load more media
    useEffect(() => {
        if (activeFilter !== SearchFilter.MEDIA) return;
        if (displayedResults.length >= allResults.length) return; // Already loaded everything

        const container = mediaGridContainerRef.current;
        if (!container) return;

        const handleScroll = () => {
            const { scrollTop, scrollHeight, clientHeight } = container;
            const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

            // Load more when 200px from bottom
            if (distanceFromBottom < 200 && !loadingMore && displayedResults.length < allResults.length) {
                setLoadingMore(true);

                // Load the next batch
                const nextBatch = allResults.slice(
                    displayedResults.length,
                    displayedResults.length + loadMoreBatchSize
                );

                setDisplayedResults(prev => [...prev, ...nextBatch]);
                setStats(prev => ({
                    ...prev,
                    displayed: Math.min(prev.displayed + nextBatch.length, allResults.length)
                }));

                // Short delay to avoid loading too quickly
                setTimeout(() => setLoadingMore(false), 100);
            }
        };

        container.addEventListener("scroll", handleScroll, { passive: true });
        return () => container.removeEventListener("scroll", handleScroll);
    }, [activeFilter, displayedResults, allResults, loadingMore, loadMoreBatchSize]);

    async function performSearch(searchQuery: string, filter: SearchFilter) {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        const searchRunId = ++searchRunIdRef.current;
        const isStale = () => searchRunIdRef.current !== searchRunId || controller.signal.aborted;

        // For the MEDIA filter, allow an empty search to load all media
        if (filter !== SearchFilter.MEDIA && !searchQuery.trim()) {
            setAllResults([]);
            setDisplayedResults([]);
            setLoading(false);
            setStats({ total: 0, displayed: 0, loading: false });
            return;
        }

        setLoading(true);
        setStats({ total: 0, displayed: 0, loading: true });
        console.log(`[Ultra Advanced Search] Search: "${searchQuery}", Filter: ${filter}`);

        try {
            const searchResults: SearchResult[] = [];

            // Get all accessible channels
            const channelIds: string[] = [];

            // Add private channels (DMs and groups)
            try {
                const privateChannelIds = PrivateChannelSortStore.getPrivateChannelIds();
                channelIds.push(...privateChannelIds);
                console.log(`[Ultra Advanced Search] ${channelIds.length} private channels found`);
            } catch (error) {
                console.error("Error retrieving private channels:", error);
            }

            // Only private channels (DMs and groups), not servers
            const limitedChannelIds = channelIds;

            // Check cache for search results (except for MEDIA which has its own cache)
            if (filter !== SearchFilter.MEDIA && searchQuery.trim()) {
                const cacheKey = `ultra-search-results-${filter}-${searchQuery.toLowerCase()}`;
                try {
                    const cached = await DataStore.get(cacheKey) as SearchResultsCache | null | undefined;
                    if (cached && cached.results && cached.results.length > 0) {
                        // Check that channels are still the same
                        const cachedChannelIds = new Set(cached.channelIds);
                        const currentChannelIds = new Set(limitedChannelIds);
                        const channelsMatch = cachedChannelIds.size === currentChannelIds.size &&
                            Array.from(cachedChannelIds).every(id => currentChannelIds.has(id));

                        if (channelsMatch) {
                            const cachedFinalResults = cached.results.slice(0, settings.store.maxResults || 100);
                            console.log(`[Ultra Advanced Search] Using cache for search: "${searchQuery}" (${cachedFinalResults.length} results)`);
                            if (isStale()) return;
                            setAllResults(cachedFinalResults);
                            setDisplayedResults(cachedFinalResults);
                            setStats({ total: cachedFinalResults.length, displayed: cachedFinalResults.length, loading: false });
                            setLoading(false);
                            return;
                        }
                    }
                } catch (error) {
                    console.error("[Ultra Advanced Search] Error loading search cache:", error);
                }
            }

            // For the MEDIA filter, process channels sequentially to avoid rate limits
            if (filter === SearchFilter.MEDIA) {
                // First, load media items from the dedicated cache for immediate display
                const cachedMediaItems: Array<{
                    url: string;
                    thumbnailUrl?: string;
                    type: "image" | "video" | "embed" | "sticker";
                    message: Message | any;
                    channel: Channel;
                    user: User | null;
                }> = [];

                for (const channelId of limitedChannelIds) {
                    try {
                        const channel = ChannelStore.getChannel(channelId);
                        if (!channel) continue;

                        const mediaItemsCacheKey = `ultra-search-media-items-${channelId}`;
                        const cachedMedia = await DataStore.get(mediaItemsCacheKey) as MediaItemsCache | null | undefined;

                        if (cachedMedia && cachedMedia.items && cachedMedia.items.length > 0) {
                            console.log(`[Ultra Advanced Search] Media items cache found for ${channelId}: ${cachedMedia.items.length} items`);

                            for (const item of cachedMedia.items) {
                                // Filter by query if necessary
                                if (!searchQuery.trim() || searchQuery.trim() === "") {
                                    const message = MessageStore.getMessage(item.channelId, item.messageId) || {
                                        id: item.messageId,
                                        channel_id: item.channelId,
                                        author: item.userId ? { id: item.userId } : null,
                                        timestamp: new Date(item.timestamp)
                                    };
                                    const user = item.userId ? UserStore.getUser(item.userId) : null;
                                    cachedMediaItems.push({
                                        url: item.url,
                                        thumbnailUrl: item.thumbnailUrl,
                                        type: item.type,
                                        message: message as any,
                                        channel,
                                        user
                                    });
                                }
                            }
                        }
                    } catch (error) {
                        console.error(`[Ultra Advanced Search] Error loading media items cache for ${channelId}:`, error);
                    }
                }

                // Sort by timestamp (most recent first)
                cachedMediaItems.sort((a, b) => {
                    const timeA = a.message.timestamp?.valueOf() || (a.message as any).timestamp || 0;
                    const timeB = b.message.timestamp?.valueOf() || (b.message as any).timestamp || 0;
                    return timeB - timeA;
                });

                // Helper function to convert cachedMediaItems to SearchResult (avoid duplication)
                const convertCachedItemsToResults = (items: typeof cachedMediaItems): SearchResult[] => {
                    return items.map(item => ({
                        message: item.message,
                        channel: item.channel,
                        user: item.user || undefined,
                        matchType: "attachment" as const,
                        mediaInfo: {
                            url: item.url,
                            thumbnailUrl: item.thumbnailUrl,
                            type: item.type
                        }
                    }));
                };

                // Display media from cache immediately
                if (cachedMediaItems.length > 0 && !isStale()) {
                    console.log(`[Ultra Advanced Search] ${cachedMediaItems.length} media loaded from items cache`);
                    const cachedResults = convertCachedItemsToResults(cachedMediaItems);
                    setAllResults(cachedResults);
                    setDisplayedResults(cachedResults.slice(0, initialLoadLimit));
                    setStats({ total: cachedResults.length, displayed: Math.min(initialLoadLimit, cachedResults.length), loading: false });
                    setLoading(false);
                }

                // Then, load results from the message cache to supplement
                for (const channelId of limitedChannelIds) {
                    try {
                        const channel = ChannelStore.getChannel(channelId);
                        if (!channel) continue;

                        if (isStale()) return;
                        const cachedResults = await searchMediaMessages(channelId, searchQuery, true, settings.store.apiRequestDelay || 200, controller.signal); // true = cache only
                        searchResults.push(...cachedResults);
                    } catch (error) {
                        console.error(`[Ultra Advanced Search] Error searching cache for ${channelId}:`, error);
                    }
                }

                // Update results with new ones (avoid duplicates)
                if (searchResults.length > 0 && !isStale()) {
                    searchResults.sort((a, b) => {
                        const timeA = a.message.timestamp?.valueOf() || (a.message as any).timestamp || 0;
                        const timeB = b.message.timestamp?.valueOf() || (b.message as any).timestamp || 0;
                        return timeB - timeA;
                    });

                    // Merge with cache items results (avoid duplicates)
                    const existingIds = new Set(cachedMediaItems.map(item => item.message.id || item.message.message_id));
                    const newResults = searchResults.filter(r => {
                        const msgId = r.message.id || (r.message as any).message_id;
                        return !existingIds.has(msgId);
                    });

                    if (cachedMediaItems.length > 0) {
                        const cachedResults = convertCachedItemsToResults(cachedMediaItems);
                        const merged = [...cachedResults, ...newResults];
                        setAllResults(merged);
                        setDisplayedResults(merged.slice(0, initialLoadLimit));
                        setStats({ total: merged.length, displayed: Math.min(initialLoadLimit, merged.length), loading: false });
                    } else {
                        setAllResults(searchResults);
                        setDisplayedResults(searchResults.slice(0, initialLoadLimit));
                        setStats({ total: searchResults.length, displayed: Math.min(initialLoadLimit, searchResults.length), loading: false });
                    }
                }

                // Load new media in background (in batches of 2 channels)
                const batchSize = 2;
                const delayBetweenBatches = 500; // 500ms between each batch

                for (let i = 0; i < limitedChannelIds.length; i += batchSize) {
                    const batch = limitedChannelIds.slice(i, i + batchSize);

                    // Short delay between batches
                    if (i > 0) {
                        await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
                    }
                    if (isStale()) return;

                    const batchPromises = batch.map(async channelId => {
                        try {
                            const channel = ChannelStore.getChannel(channelId);
                            if (!channel) return [];
                            return await searchMediaMessages(channelId, searchQuery, false, settings.store.apiRequestDelay || 200, controller.signal); // false = load from API too
                        } catch (error) {
                            console.error(`Error searching channel ${channelId}:`, error);
                            return [];
                        }
                    });

                    const batchResults = await Promise.all(batchPromises);
                    if (isStale()) return;
                    const newResults: SearchResult[] = [];
                    for (const results of batchResults) {
                        newResults.push(...results);
                    }

                    // Add new results (avoid duplicates)
                    const existingIds = new Set(searchResults.map(r => r.message.id || (r.message as any).message_id));
                    for (const result of newResults) {
                        const msgId = result.message.id || (result.message as any).message_id;
                        if (!existingIds.has(msgId)) {
                            searchResults.push(result);
                            existingIds.add(msgId);
                        }
                    }

                    // Update display progressively (add new results)
                    searchResults.sort((a, b) => {
                        const timeA = a.message.timestamp?.valueOf() || (a.message as any).timestamp || 0;
                        const timeB = b.message.timestamp?.valueOf() || (b.message as any).timestamp || 0;
                        return timeB - timeA;
                    });

                    // Update all results
                    setAllResults(prev => {
                        const existingIds = new Set(prev.map(r => r.message.id || (r.message as any).message_id));
                        const newResults = searchResults.filter(r => {
                            const msgId = r.message.id || (r.message as any).message_id;
                            return !existingIds.has(msgId);
                        });
                        return [...prev, ...newResults];
                    });

                    // Add new results to displayed results only if we haven't reached the initial limit yet
                    setDisplayedResults(prev => {
                        if (prev.length >= initialLoadLimit) return prev;

                        const existingIds = new Set(prev.map(r => r.message.id || (r.message as any).message_id));
                        const newResultsToDisplay = searchResults
                            .filter(r => {
                                const msgId = r.message.id || (r.message as any).message_id;
                                return !existingIds.has(msgId);
                            })
                            .slice(0, initialLoadLimit - prev.length);

                        return [...prev, ...newResultsToDisplay];
                    });
                }
            } else {
                // For other filters, normal processing
                const searchPromises = limitedChannelIds.map(async (channelId, index) => {
                    // Small delay to avoid blocking the UI (in batches of 5 channels)
                    if (index > 0 && index % 5 === 0) {
                        await new Promise(resolve => setTimeout(resolve, 10));
                    }

                    try {
                        const channel = ChannelStore.getChannel(channelId);
                        if (!channel) return [];

                        // Search according to filter
                        if (filter === SearchFilter.PINNED) {
                            return searchPinnedMessages(channelId, searchQuery);
                        } else if (filter === SearchFilter.MESSAGES) {
                            return searchGeneral(channelId, searchQuery);
                        } else {
                            return searchGeneral(channelId, searchQuery);
                        }
                    } catch (error) {
                        console.error(`Error searching channel ${channelId}:`, error);
                        return [];
                    }
                });

                // Wait for all searches in parallel
                const allResults = await Promise.all(searchPromises);
                if (isStale()) return;

                // Flatten and add all results
                for (const channelResults of allResults) {
                    searchResults.push(...channelResults);
                }

                console.log(`[Ultra Advanced Search] ${searchResults.length} results found`);
            }

            // Sort by date (most recent first)
            searchResults.sort((a, b) => {
                const timeA = a.message.timestamp?.valueOf() || (a.message as any).timestamp || 0;
                const timeB = b.message.timestamp?.valueOf() || (b.message as any).timestamp || 0;
                return timeB - timeA;
            });

            // If we don't have enough results, search with the API
            const minResults = settings.store.minResultsForAPI ?? 5;
            if (searchResults.length < minResults && limitedChannelIds.length > 0 && filter !== SearchFilter.MEDIA) {
                console.log(`[Ultra Advanced Search] Local cache: ${searchResults.length} results, searching API...`);
                const apiResults = await searchWithAPI(searchQuery, filter, limitedChannelIds, searchResults.length, controller.signal);
                if (isStale()) return;

                // Add API results (avoiding duplicates)
                const existingIds = new Set(searchResults.map(r => r.message.id || (r.message as any).message_id));
                for (const result of apiResults) {
                    const msgId = result.message.id || (result.message as any).message_id;
                    if (!existingIds.has(msgId)) {
                        searchResults.push(result);
                    }
                }

                // Re-sort after adding API results
                searchResults.sort((a, b) => {
                    const timeA = a.message.timestamp?.valueOf() || (a.message as any).timestamp || 0;
                    const timeB = b.message.timestamp?.valueOf() || (b.message as any).timestamp || 0;
                    return timeB - timeA;
                });
            }

            // For the MEDIA filter, use pagination (50 initially)
            if (isStale()) return;
            if (filter === SearchFilter.MEDIA) {
                setAllResults(searchResults);
                setDisplayedResults(searchResults.slice(0, initialLoadLimit));
                setStats({ total: searchResults.length, displayed: Math.min(initialLoadLimit, searchResults.length), loading: false });
                console.log(`[Ultra Advanced Search] ${searchResults.length} total results, ${Math.min(initialLoadLimit, searchResults.length)} displayed initially`);
            } else {
                // For other filters, display all results (limited by maxResults)
                const finalResults = searchResults.slice(0, settings.store.maxResults || 100);
                setAllResults(finalResults);
                setDisplayedResults(finalResults);
                setStats({ total: finalResults.length, displayed: finalResults.length, loading: false });
                console.log(`[Ultra Advanced Search] ${finalResults.length} results displayed`);

                // Cache search results (infinite cache)
                if (searchQuery.trim() && finalResults.length > 0) {
                    const cacheKey = `ultra-search-results-${filter}-${searchQuery.toLowerCase()}`;
                    try {
                        await DataStore.set(cacheKey, {
                            query: searchQuery,
                            filter,
                            channelIds: limitedChannelIds,
                            results: finalResults,
                            lastUpdated: Date.now()
                        } as SearchResultsCache);
                        await recordSearchCacheKey(cacheKey);
                        console.log(`[Ultra Advanced Search] Search cache saved for "${searchQuery}" (${finalResults.length} results)`);
                    } catch (error) {
                        console.error("[Ultra Advanced Search] Error saving search cache:", error);
                    }
                }
            }
        } catch (error) {
            console.error("Error during search:", error);
            if (!isStale()) setStats({ total: 0, displayed: 0, loading: false });
        } finally {
            if (!isStale()) {
                setLoading(false);
                setStats(prev => ({ ...prev, loading: false }));
            }
        }
    }

    // Function to search with the Discord API if local cache doesn't give enough results
    async function searchWithAPI(
        searchQuery: string,
        filter: SearchFilter,
        channelIds: string[],
        currentResultCount: number,
        signal?: AbortSignal
    ): Promise<SearchResult[]> {
        const apiResults: SearchResult[] = [];
        const maxApiChannels = Math.min(10, channelIds.length); // Limit to 10 channels to avoid rate limit
        const delayBetweenRequests = settings.store.apiRequestDelay || 200; // Configurable delay between requests

        for (let i = 0; i < maxApiChannels; i++) {
            if (signal?.aborted) break;
            const channelId = channelIds[i];
            try {
                const channel = ChannelStore.getChannel(channelId);
                if (!channel) continue;

                // Delay between requests to avoid rate limit
                if (i > 0) {
                    await new Promise(resolve => setTimeout(resolve, delayBetweenRequests));
                }

                // Load messages from the API (limit of 100 messages per request)
                let response: any = null;
                try {
                    response = await TestcordRequestCoordinator.request({
                        key: `discord:messages:${channelId}:before::limit:100`,
                        ttlMs: 30_000,
                        run: () => RestAPI.get({
                            url: `/channels/${channelId}/messages`,
                            query: {
                                limit: 100
                            },
                            retries: 1
                        }),
                    });
                } catch (error: any) {
                    // Handle rate limit (429)
                    if (error?.status === 429) {
                        const retryAfter = parseFloat(error.response?.headers?.["retry-after"] || error.response?.headers?.["Retry-After"] || "1");
                        console.log(`[Ultra Advanced Search] Rate limit reached, waiting ${retryAfter}s...`);
                        // Wait the specified delay before continuing
                        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
                        // Retry once after waiting
                        try {
                            response = await TestcordRequestCoordinator.request({
                                key: `discord:messages:${channelId}:before::limit:100`,
                                ttlMs: 30_000,
                                run: () => RestAPI.get({
                                    url: `/channels/${channelId}/messages`,
                                    query: {
                                        limit: 100
                                    },
                                    retries: 0
                                }),
                            });
                        } catch (retryError) {
                            // If still rate limited, skip to next channel
                            continue;
                        }
                    } else {
                        // Other error, continue
                        continue;
                    }
                }

                if (!response?.body || !Array.isArray(response.body)) {
                    continue;
                }

                // Search in loaded messages (case-sensitive search)
                for (const msg of response.body) {
                    // Convert raw message to Message object if necessary
                    const message: any = msg;

                    // Check according to filter
                    let matches = false;

                    if (filter === SearchFilter.PINNED) {
                        matches = message.pinned &&
                            (!searchQuery || (message.content && matchesWholeWord(message.content, searchQuery)));
                    } else if (filter === SearchFilter.MEDIA) {
                        const hasMedia = message.attachments?.length > 0 ||
                            message.embeds?.length > 0 ||
                            message.sticker_items?.length > 0;
                        matches = hasMedia &&
                            (!searchQuery || (message.content && matchesWholeWord(message.content, searchQuery)));
                    } else {
                        // General search (whole word search, case-sensitive)
                        matches = message.content && matchesWholeWord(message.content, searchQuery);
                    }

                    if (matches) {
                        apiResults.push({
                            message: message as Message,
                            channel,
                            user: UserStore.getUser(message.author?.id),
                            matchType: filter === SearchFilter.MEDIA ? "attachment" : "content",
                            highlight: searchQuery
                        });
                    }
                }

                // If we have enough results, stop
                if (apiResults.length >= settings.store.maxResults) {
                    break;
                }
            } catch (error: any) {
                // Ignore errors silently (already handled in the inner try-catch)
                if (error?.status !== 429) {
                    console.error(`[Ultra Advanced Search] Erreur API pour canal ${channelId}:`, error);
                }
                continue;
            }
        }

        return apiResults;
    }

    function searchGeneral(channelId: string, query: string): SearchResult[] {
        const results: SearchResult[] = [];
        const channel = ChannelStore.getChannel(channelId);
        if (!channel) return results;

        // Use only the local message cache
        const messages = MessageStore.getMessages(channelId);
        if (messages && messages.size > 0) {
            // Convert the Map to an array
            let messageArray: Message[] = [];
            try {
                if (messages instanceof Map) {
                    messageArray = Array.from(messages.values());
                } else if (typeof messages.forEach === "function") {
                    messages.forEach((msg: Message) => messageArray.push(msg));
                }
            } catch (error) {
                console.error("Error converting messages:", error);
                return results;
            }

            // Whole word search (case-sensitive)
            // IMPORTANT: Exclude messages with only media (no text content)
            for (const message of messageArray) {
                // Check that the message has text content (not just media)
                const hasTextContent = message.content && message.content.trim().length > 0;

                // If the message has text content and matches the search (whole word)
                if (hasTextContent && message.content && matchesWholeWord(message.content, query)) {
                    results.push({
                        message,
                        channel,
                        matchType: "content",
                        highlight: query
                    });
                }
            }
        }

        return results;
    }

    function searchPinnedMessages(channelId: string, query: string): SearchResult[] {
        const results: SearchResult[] = [];
        const channel = ChannelStore.getChannel(channelId);
        if (!channel) return results;

        // Use only the local cache - search for messages with pinned = true
        const messages = MessageStore.getMessages(channelId);
        if (messages && messages.size > 0) {
            // Convert the Map to an array
            let messageArray: Message[] = [];
            try {
                if (messages instanceof Map) {
                    messageArray = Array.from(messages.values());
                } else if (typeof messages.forEach === "function") {
                    messages.forEach((msg: Message) => messageArray.push(msg));
                }
            } catch (error) {
                return results;
            }

            // Whole word search (case-sensitive)
            for (const message of messageArray) {
                // Check if the message is pinned (pinned property)
                if (message.pinned && (!query || (message.content && matchesWholeWord(message.content, query)))) {
                    results.push({
                        message,
                        channel,
                        matchType: "content"
                    });
                }
            }
        }

        return results;
    }

    // Optimize highlightText with useMemo
    const highlightText = useCallback((text: string, highlight: string): React.ReactNode => {
        if (!highlight || !text) return text;
        // Escape special characters in the regex
        const escapedHighlight = highlight.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const parts = text.split(new RegExp(`(${escapedHighlight})`, "gi"));
        return parts.map((part, i) =>
            part.toLowerCase() === highlight.toLowerCase() ? (
                <mark key={i}>
                    {part}
                </mark>
            ) : part
        );
    }, []);

    const formatMessagePreview = useCallback((message: Message): string => {
        if (message.content) {
            return message.content.length > 150
                ? message.content.substring(0, 150) + "..."
                : message.content;
        }
        if (message.attachments?.length > 0) {
            return `📎 ${message.attachments.length} attachment${message.attachments.length === 1 ? "" : "s"}`;
        }
        if (message.embeds?.length > 0) {
            return `📄 ${message.embeds.length} embed${message.embeds.length === 1 ? "" : "s"}`;
        }
        return "Message has no text content";
    }, []);

    const formatTimestamp = useCallback((timestamp: any): string => {
        if (!timestamp) return "";
        try {
            let date: Date;

            // Handle different timestamp formats
            if (timestamp instanceof Date) {
                date = timestamp;
            } else if (typeof timestamp === "number") {
                date = new Date(timestamp);
            } else if (timestamp && typeof timestamp === "object") {
                // Handle moment.js or similar objects
                if (timestamp.valueOf) {
                    date = new Date(timestamp.valueOf());
                } else if (timestamp.toDate) {
                    date = timestamp.toDate();
                } else if (timestamp.toISOString) {
                    date = new Date(timestamp.toISOString());
                } else {
                    return "";
                }
            } else if (typeof timestamp === "string") {
                date = new Date(timestamp);
            } else {
                return "";
            }

            if (isNaN(date.getTime())) return "";

            const now = new Date();
            const diffMs = now.getTime() - date.getTime();
            const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

            if (diffDays === 0) {
                return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
            } else if (diffDays === 1) {
                return "Yesterday";
            } else if (diffDays < 7) {
                return date.toLocaleDateString(undefined, { weekday: "short" });
            } else if (diffDays < 365) {
                return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
            } else {
                return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
            }
        } catch {
            return "";
        }
    }, []);

    const getAvatarURL = useCallback((user: User | null, channel: Channel): string | null => {
        if (!user) return null;
        try {
            return user.getAvatarURL?.(channel.guild_id, 128) ||
                (user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.webp?size=128` : null);
        } catch {
            return user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.webp?size=128` : null;
        }
    }, []);

    // Component to display the message list
    function MessagesList({ results, onNavigate, onSelect, selectedIndex, searchQuery }: {
        results: SearchResult[];
        onNavigate: (result: SearchResult) => void;
        onSelect: (index: number) => void;
        selectedIndex: number;
        searchQuery: string;
    }) {
        if (results.length === 0) {
            return (
                <div className={cl("no-results")}>
                    <span>No messages found</span>
                </div>
            );
        }

        return (
            <div ref={resultsRef} className={cl("results", "message-results")}>
                {results.map((result, index) => {
                    const isSelected = index === selectedIndex;
                    const user = result.user || UserStore.getUser(result.message.author.id);
                    const { channel } = result;

                    return (
                        <div
                            key={`${result.message.channel_id}-${result.message.id}-${index}`}
                            className={cl("result-item", { selected: isSelected })}
                            onClick={() => onNavigate(result)}
                            onMouseEnter={() => onSelect(index)}
                            style={{
                                padding: "14px 16px",
                                cursor: "pointer",
                                border: "1px solid var(--background-modifier-accent)",
                                borderRadius: "16px",
                                background: "var(--background-secondary)",
                                marginBottom: "10px"
                            }}
                        >
                            <div className={cl("result-content-wrapper")} style={{ display: "flex", flexDirection: "row", gap: 14, alignItems: "flex-start" }}>
                                <div className={cl("result-avatar")} style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", width: 40 }}>
                                    {React.createElement(Avatar as any, {
                                        src: getAvatarURL(user, channel) || undefined,
                                        size: "SIZE_40",
                                        className: cl("avatar"),
                                        style: { borderRadius: "50%", width: 40, height: 40 }
                                    })}
                                </div>
                                <div className={cl("result-main")} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                                    <div className={cl("result-header")} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                                        <div className={cl("result-author")} style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0, flexWrap: "wrap" }}>
                                            <span className={cl("result-author-name")} style={{ color: "var(--white-500) !important", fontSize: 15, fontWeight: 600, lineHeight: 1.4 }}>
                                                {user?.globalName || user?.username || "Unknown user"}
                                            </span>
                                            <span className={cl("result-channel")} style={{ color: "lightgray !important", fontSize: 13, fontWeight: 500, background: "var(--background-modifier-selected)", padding: "4px 9px", borderRadius: 999, whiteSpace: "nowrap" }}>
                                                {channel.name || "DM"}
                                            </span>
                                            {result.message.pinned && (
                                                <span className={cl("result-pinned")} title="Pinned message" style={{ fontSize: 14, opacity: 0.8 }}>
                                                    📌
                                                </span>
                                            )}
                                        </div>
                                        <span className={cl("result-time")} style={{ color: "var(--text-muted) !important", fontSize: 12, fontWeight: 500, flexShrink: 0, whiteSpace: "nowrap", alignSelf: "flex-start", marginLeft: "auto" }}>
                                            {formatTimestamp(result.message.timestamp)}
                                        </span>
                                    </div>
                                    <div className={cl("result-content")} style={{ color: "var(--white-500) !important", fontSize: 14, lineHeight: 1.6, wordWrap: "break-word", overflowWrap: "anywhere" }}>
                                        {highlightText(formatMessagePreview(result.message), searchQuery)}
                                    </div>
                                    {(result.message.attachments?.length > 0 || result.message.embeds?.length > 0) && (
                                        <div className={cl("result-metadata")} style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 2 }}>
                                            {result.message.attachments?.length > 0 && (
                                                <div className={cl("result-attachments")} style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--interactive-normal) !important", fontSize: 12, fontWeight: 500, background: "var(--background-modifier-selected)", padding: "4px 9px", borderRadius: 999 }}>
                                                    <span className={cl("result-icon")} style={{ fontSize: 16, opacity: 0.9 }}>📎</span>
                                                    <span>{result.message.attachments.length} attachment{result.message.attachments.length === 1 ? "" : "s"}</span>
                                                </div>
                                            )}
                                            {result.message.embeds?.length > 0 && (
                                                <div className={cl("result-embeds")} style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--interactive-normal) !important", fontSize: 12, fontWeight: 500, background: "var(--background-modifier-selected)", padding: "4px 9px", borderRadius: 999 }}>
                                                    <span className={cl("result-icon")} style={{ fontSize: 16, opacity: 0.9 }}>📄</span>
                                                    <span>{result.message.embeds.length} embed{result.message.embeds.length === 1 ? "" : "s"}</span>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    }

    // Wrapper component for the media grid
    function MediaGridWrapper({ results, allResults, onNavigate, onSelect, selectedIndex, loadingMore, remainingCount }: {
        results: SearchResult[];
        allResults: SearchResult[];
        onNavigate: (result: SearchResult) => void;
        onSelect: (index: number) => void;
        selectedIndex: number;
        loadingMore: boolean;
        remainingCount: number;
    }) {
        return (
            <div ref={mediaGridContainerRef} className={cl("results", "media-grid-container")}>
                {results.length === 0 && !loading ? (
                    <div className={cl("empty")}>
                        <span>Loading media...</span>
                    </div>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", width: "100%", minWidth: 0, maxWidth: "100%" }}>
                        <MediaGrid
                            displayedResults={results}
                            allResults={allResults}
                            navigateToMessage={onNavigate}
                            setSelectedIndex={onSelect}
                            selectedIndex={selectedIndex}
                        />
                        {loadingMore && (
                            <div className={cl("loading-more")}>
                                <span>Loading...</span>
                            </div>
                        )}
                        {results.length < allResults.length && !loadingMore && (
                            <div className={cl("loading-more")}>
                                <span>Scroll to load more ({remainingCount} remaining)</span>
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    }

    return (
        <ModalRoot {...modalProps} size={ModalSize.LARGE} className={cl("root")}>
            <ModalHeader className={cl("header")}>
                <div className={cl("toolbar")}>
                    <div className={cl("search-row")}>
                        <TextInput
                            ref={searchInputRef}
                            value={query}
                            onChange={setQuery}
                            placeholder="Search messages, media, and DMs"
                            className={cl("search-input")}
                            autoFocus
                        />
                        <ModalCloseButton onClick={modalProps.onClose} />
                    </div>

                    <TabBar
                        type="top"
                        look="brand"
                        selectedItem={activeFilter}
                        onItemSelect={setActiveFilter as any}
                        className={cl("filter-bar")}
                    >
                        <TabBar.Item id={SearchFilter.RECENT}>
                            Recent
                        </TabBar.Item>
                        <TabBar.Item id={SearchFilter.MESSAGES}>
                            Messages
                        </TabBar.Item>
                        <TabBar.Item id={SearchFilter.MEDIA}>
                            Media
                        </TabBar.Item>
                        <TabBar.Item id={SearchFilter.PINNED}>
                            Pinned
                        </TabBar.Item>
                    </TabBar>
                    {stats.total > 0 && (
                        <div className={cl("results-stats")}>
                            {stats.displayed} / {stats.total} results
                        </div>
                    )}
                </div>
            </ModalHeader>

            <ModalContent className={cl("content")}>
                {loading ? (
                    <div className={cl("loading")}>
                        <div className={cl("spinner")} />
                        <span>Searching...</span>
                    </div>
                ) : activeFilter === SearchFilter.MEDIA ? (
                    <MediaGridWrapper
                        results={displayedResults}
                        allResults={allResults}
                        onNavigate={navigateToMessage}
                        onSelect={setSelectedIndex}
                        selectedIndex={selectedIndex}
                        loadingMore={loadingMore}
                        remainingCount={allResults.length - displayedResults.length}
                    />
                ) : displayedResults.length === 0 && query ? (
                    <div className={cl("no-results")}>
                        <span>No results found for "{query}"</span>
                    </div>
                ) : displayedResults.length === 0 ? (
                    <div className={cl("empty")}>
                        <span>Start typing to search your message history</span>
                    </div>
                ) : (
                    <>
                        <MessagesList
                            results={displayedResults}
                            onNavigate={navigateToMessage}
                            onSelect={setSelectedIndex}
                            selectedIndex={selectedIndex}
                            searchQuery={query}
                        />
                        {loadingMore && (
                            <div className={cl("loading-more")} style={{ padding: "12px", textAlign: "center" }}>
                                <span>Loading...</span>
                            </div>
                        )}
                        {displayedResults.length < allResults.length && !loadingMore && (
                            <div className={cl("loading-more")} style={{ padding: "12px", textAlign: "center" }}>
                                <span>Scroll to load more ({allResults.length - displayedResults.length} remaining)</span>
                            </div>
                        )}
                    </>
                )}
            </ModalContent>
        </ModalRoot>
    );
}
