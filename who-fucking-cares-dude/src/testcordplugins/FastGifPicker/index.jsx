/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Hisako
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import { BaseText } from "@components/BaseText";
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { Flex } from "@components/Flex";
import definePlugin from "@utils/types";
import { React, useEffect, useMemo, useRef, useState } from "@webpack/common";
const PREVIEW_CACHE_LIMIT = 500;
const PREVIEW_LISTENER_LIMIT = 500;
const BACKGROUND_QUEUE_LIMIT = 1000;
const LOAD_QUEUE_LIMIT = 1000;
const SEEN_PREVIEW_LIMIT = 1000;
const DEFAULT_CONCURRENT_LOADS = 6;
const DEFAULT_BACKGROUND_PRELOADS = 3;
const DEFAULT_BACKGROUND_PRELOAD_LIMIT = 250;
const DEFAULT_RETRY_COUNT = 2;
const LOAD_SLOT_TIMEOUT_MS = 12000;
const RETRY_DELAY_MS = 650;
const STATS_REFRESH_MS = 1000;
const TRANSPARENT_IMAGE_SRC = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
const RETRY_PARAM = "fast_gif_retry";
const GIF_EXTENSION_RE = /\.gif(?:$|[?#])/i;
const previewUrlCache = new Map();
const loadedPreviewUrls = new Set();
const previewLoadListeners = new Map();
const backgroundPreloadQueued = new Set();
const backgroundPreloadQueue = [];
const backgroundPreloadImages = new Set();
const loadQueue = [];
const seenOriginalSrcs = new Set();
const stats = {
    backgroundFailed: 0,
    backgroundLoaded: 0,
    backgroundQueued: 0,
    cacheHits: 0,
    hoverLoads: 0,
    loadedPreviews: 0,
    originalFallbacks: 0,
    preloadLimitSkips: 0,
    retryAttempts: 0,
    seenPreviews: 0
};
const statItems = [
    { label: "Seen previews", value: "seenPreviews" },
    { label: "Loaded previews", value: "loadedPreviews" },
    { label: "Retries", value: "retryAttempts" },
    { label: "Original fallbacks", value: "originalFallbacks" },
    { label: "Cache hits", value: "cacheHits" },
    { label: "Hover loads", value: "hoverLoads" },
    { label: "Background queued", value: "backgroundQueued" },
    { label: "Background loaded", value: "backgroundLoaded" },
    { label: "Background failed", value: "backgroundFailed" },
    { label: "Preload limit skips", value: "preloadLimitSkips" },
    { label: "Ready cache", value: "readyCacheSize" },
    { label: "Active visible", value: "activeVisibleLoads" },
    { label: "Queued visible", value: "queuedVisibleLoads" },
    { label: "Active preload", value: "activeBackgroundPreloads" },
    { label: "Queued preload", value: "queuedBackgroundPreloads" }
];
let activeLoads = 0;
let activeBackgroundPreloads = 0;
let discordMediaHosts;
function clearCaches() {
    previewUrlCache.clear();
    loadedPreviewUrls.clear();
    backgroundPreloadQueued.clear();
    backgroundPreloadQueue.length = 0;
}
function bumpStat(stat, by = 1) {
    stats[stat] += by;
}
function recordSeenPreview(src) {
    if (!src || seenOriginalSrcs.has(src))
        return;
    seenOriginalSrcs.add(src);
    if (seenOriginalSrcs.size > SEEN_PREVIEW_LIMIT) {
        const oldest = seenOriginalSrcs.values().next().value;
        if (oldest)
            seenOriginalSrcs.delete(oldest);
    }
    bumpStat("seenPreviews");
}
function resetStats() {
    for (const stat of Object.keys(stats)) {
        stats[stat] = 0;
    }
    seenOriginalSrcs.clear();
}
function getStatsSnapshot() {
    return {
        ...stats,
        activeBackgroundPreloads,
        activeVisibleLoads: activeLoads,
        queuedBackgroundPreloads: backgroundPreloadQueue.length,
        queuedVisibleLoads: loadQueue.length,
        readyCacheSize: loadedPreviewUrls.size
    };
}
const settings = definePluginSettings({
    previewMode: {
        type: 4 /* OptionType.SELECT */,
        description: "Use lighter preview URLs in the GIF picker.",
        options: [
            { label: "Animated WebP", value: "webp", default: true },
            { label: "Still preview", value: "static" },
            { label: "Still until hover", value: "hover" },
            { label: "Original URL", value: "original" }
        ],
        onChange: clearCaches
    },
    maxConcurrentLoads: {
        type: 5 /* OptionType.SLIDER */,
        description: "How many GIF previews may load at the same time.",
        markers: [2, 4, 6, 8, 10, 12],
        default: DEFAULT_CONCURRENT_LOADS,
        stickToMarkers: true
    },
    retryCount: {
        type: 5 /* OptionType.SLIDER */,
        description: "How many times a failed preview should be retried.",
        markers: [0, 1, 2, 3],
        default: DEFAULT_RETRY_COUNT,
        stickToMarkers: true
    },
    preloadAllInBackground: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Preload every GIF preview the picker knows about in the background.",
        default: false
    },
    backgroundPreloadConcurrency: {
        type: 5 /* OptionType.SLIDER */,
        description: "How many background GIF previews may preload at the same time.",
        markers: [1, 2, 3, 4, 6, 8, 10, 12],
        default: DEFAULT_BACKGROUND_PRELOADS,
        stickToMarkers: true
    },
    backgroundPreloadLimit: {
        type: 5 /* OptionType.SLIDER */,
        description: "Maximum GIF previews to preload from each picker update. Set to 0 for no limit.",
        markers: [0, 50, 100, 250, 500, 1000],
        default: DEFAULT_BACKGROUND_PRELOAD_LIMIT,
        stickToMarkers: true
    },
    rememberLoadedPreviews: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Skip the load queue for previews that already loaded once.",
        default: true
    },
    statsPanel: {
        type: 6 /* OptionType.COMPONENT */,
        component: StatsPanel
    }
});
export default definePlugin({
    name: "FastGifPicker",
    description: "Makes the GIF picker load lighter previews, retry failures, and avoid starting too many GIFs at once.",
    tags: ["Media", "Utility"],
    authors: [{ name: "irritably", id: 928787166916640838n }],
    settings,
    patches: [
        {
            find: "#{intl::NO_GIF_FAVORITES_HOW_TO_FAVORITE}",
            replacement: [
                {
                    match: /this\.renderGIF\(\)/,
                    replace: "$self.renderOptimizedGif(this,()=>this.renderGIF())"
                },
                {
                    match: /(,suggestions:)(\i)(,favorites:)(\i),/,
                    replace: "$1$self.preloadGifList($2)$3$self.preloadGifList($4),",
                    noWarn: true
                }
            ]
        }
    ],
    stop() {
        activeLoads = 0;
        activeBackgroundPreloads = 0;
        clearCaches();
        previewLoadListeners.clear();
        for (const entry of loadQueue) {
            entry.cancelled = true;
        }
        loadQueue.length = 0;
        backgroundPreloadImages.clear();
    },
    renderOptimizedGif(_instance, renderGif) {
        return optimizeNode(renderGif());
    },
    preloadGifList(gifs) {
        if (!settings.store.preloadAllInBackground || !Array.isArray(gifs))
            return gifs;
        let preloaded = 0;
        const limit = getBackgroundPreloadLimit();
        for (const gif of gifs) {
            const src = getGifSrc(gif);
            if (!src)
                continue;
            if (limit > 0 && preloaded >= limit) {
                bumpStat("preloadLimitSkips");
                continue;
            }
            queueBackgroundPreload(getPreloadSrc(src));
            preloaded++;
        }
        return gifs;
    }
});
function StatsPanel() {
    const [open, setOpen] = useState(false);
    const [snapshot, setSnapshot] = useState(getStatsSnapshot);
    useEffect(() => {
        if (!open)
            return;
        const interval = setInterval(() => setSnapshot(getStatsSnapshot()), STATS_REFRESH_MS);
        return () => clearInterval(interval);
    }, [open]);
    return (<Card variant="primary">
            <Flex flexDirection="column" gap="12px">
                <Flex justifyContent="space-between" alignItems="center" gap="12px">
                    <BaseText size="md" weight="semibold">FastGifPicker stats</BaseText>
                    <Flex gap="8px" alignItems="center">
                        {open && (<Button size="small" variant="secondary" onClick={() => {
                resetStats();
                setSnapshot(getStatsSnapshot());
            }}>
                                Reset stats
                            </Button>)}
                        <Button size="small" variant="secondary" onClick={() => {
            setSnapshot(getStatsSnapshot());
            setOpen(value => !value);
        }}>
                            {open ? "Hide stats" : "Show stats"}
                        </Button>
                    </Flex>
                </Flex>
                {open && (<Flex flexWrap="wrap" gap="8px">
                        {statItems.map(({ label, value }) => (<div key={value} style={{
                    background: "var(--background-secondary)",
                    borderRadius: 8,
                    minWidth: 132,
                    padding: "8px 10px"
                }}>
                                <BaseText size="xs" color="text-muted">{label}</BaseText>
                                <BaseText size="lg" weight="semibold" tabularNumbers>{snapshot[value]}</BaseText>
                            </div>))}
                    </Flex>)}
            </Flex>
        </Card>);
}
function optimizeNode(node) {
    if (!isReactElement(node))
        return node;
    const props = node.props;
    const { children, src } = props;
    if (typeof src === "string" && shouldOptimizeSrc(src)) {
        return <OptimizedGifImage key={node.key ?? undefined} element={node}/>;
    }
    if (children == null)
        return node;
    if (Array.isArray(children)) {
        let changed = false;
        const nextChildren = children.map(child => {
            const nextChild = optimizeNode(child);
            changed ||= nextChild !== child;
            return nextChild;
        });
        if (!changed)
            return node;
        return createElement(node, Object.assign({}, props, { children: nextChildren }));
    }
    const nextChild = optimizeNode(children);
    if (nextChild === children)
        return node;
    return createElement(node, Object.assign({}, props, { children: nextChild }));
}
function OptimizedGifImage({ element }) {
    const props = element.props;
    const { onError, onLoad, onMouseEnter, onMouseLeave, src } = props;
    const originalSrc = typeof src === "string" ? src : "";
    const previewMode = getPreviewMode();
    const hoverMode = previewMode === "hover";
    const [canLoad, setCanLoad] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const [hovered, setHovered] = useState(false);
    const [useOriginal, setUseOriginal] = useState(false);
    const releaseRef = useRef(undefined);
    const retryTimerRef = useRef(undefined);
    const effectivePreviewMode = hoverMode && !hovered ? "static" : hoverMode ? "webp" : previewMode;
    const baseSrc = useMemo(() => useOriginal ? originalSrc : getPreviewSrc(originalSrc, effectivePreviewMode), [originalSrc, useOriginal, effectivePreviewMode]);
    const imageSrc = canLoad ? getRetrySrc(baseSrc, attempt) : TRANSPARENT_IMAGE_SRC;
    useEffect(() => {
        recordSeenPreview(originalSrc);
        setAttempt(0);
        setUseOriginal(false);
    }, [originalSrc]);
    useEffect(() => {
        setCanLoad(false);
        if (settings.store.rememberLoadedPreviews && loadedPreviewUrls.has(baseSrc)) {
            bumpStat("cacheHits");
            setCanLoad(true);
            return () => releaseRef.current?.();
        }
        let timeout;
        releaseRef.current = acquireLoadSlot(() => {
            setCanLoad(true);
            timeout = setTimeout(() => releaseLoadSlot(releaseRef), LOAD_SLOT_TIMEOUT_MS);
        });
        return () => {
            if (timeout)
                clearTimeout(timeout);
            releaseLoadSlot(releaseRef);
        };
    }, [baseSrc, attempt]);
    useEffect(() => {
        if (!settings.store.preloadAllInBackground)
            return;
        const unsubscribe = subscribePreviewLoad(baseSrc, () => {
            releaseLoadSlot(releaseRef);
            setCanLoad(true);
        });
        queueBackgroundPreload(baseSrc);
        return unsubscribe;
    }, [baseSrc]);
    useEffect(() => () => {
        if (retryTimerRef.current)
            clearTimeout(retryTimerRef.current);
    }, []);
    const nextProps = Object.assign({}, props, {
        decoding: props.decoding ?? "async",
        loading: props.loading ?? "lazy",
        onError: (event) => {
            if (imageSrc === TRANSPARENT_IMAGE_SRC)
                return;
            releaseLoadSlot(releaseRef);
            if (!useOriginal && baseSrc !== originalSrc) {
                bumpStat("originalFallbacks");
                setUseOriginal(true);
                setAttempt(0);
                return;
            }
            if (attempt >= getRetryCount()) {
                onError?.(event);
                return;
            }
            bumpStat("retryAttempts");
            retryTimerRef.current = setTimeout(() => {
                setAttempt(value => value + 1);
            }, RETRY_DELAY_MS);
        },
        onLoad: (event) => {
            if (imageSrc === TRANSPARENT_IMAGE_SRC)
                return;
            bumpStat("loadedPreviews");
            rememberLoadedUrl(baseSrc);
            releaseLoadSlot(releaseRef);
            onLoad?.(event);
        },
        onMouseEnter: (event) => {
            if (hoverMode && !hovered) {
                bumpStat("hoverLoads");
                setHovered(true);
            }
            onMouseEnter?.(event);
        },
        onMouseLeave: (event) => {
            if (hoverMode)
                setHovered(false);
            onMouseLeave?.(event);
        },
        src: imageSrc
    });
    return createElement(element, nextProps);
}
function createElement(element, props) {
    const nextProps = Object.assign({}, props);
    if (element.key != null) {
        nextProps.key = element.key;
    }
    if (element.ref != null) {
        nextProps.ref = element.ref;
    }
    return React.createElement(element.type, nextProps);
}
function isReactElement(node) {
    return node != null && typeof node === "object" && "props" in node && "type" in node;
}
function acquireLoadSlot(onReady) {
    const entry = {
        active: false,
        cancelled: false,
        start: () => {
            if (entry.cancelled) {
                pumpLoadQueue();
                return;
            }
            entry.active = true;
            activeLoads++;
            onReady();
        }
    };
    if (activeLoads < getMaxConcurrentLoads()) {
        entry.start();
    }
    else {
        if (loadQueue.length >= LOAD_QUEUE_LIMIT) {
            const dropped = loadQueue.shift();
            if (dropped)
                dropped.cancelled = true;
        }
        loadQueue.push(entry);
    }
    return () => releaseQueueEntry(entry);
}
function releaseQueueEntry(entry) {
    if (entry.cancelled)
        return;
    entry.cancelled = true;
    if (!entry.active) {
        const index = loadQueue.indexOf(entry);
        if (index !== -1)
            loadQueue.splice(index, 1);
        return;
    }
    entry.active = false;
    activeLoads = Math.max(0, activeLoads - 1);
    pumpLoadQueue();
}
function releaseLoadSlot(releaseRef) {
    releaseRef.current?.();
    releaseRef.current = undefined;
}
function pumpLoadQueue() {
    while (activeLoads < getMaxConcurrentLoads()) {
        const entry = loadQueue.shift();
        if (!entry)
            return;
        if (!entry.cancelled)
            entry.start();
    }
}
function getMaxConcurrentLoads() {
    return settings.store.maxConcurrentLoads ?? DEFAULT_CONCURRENT_LOADS;
}
function getMaxBackgroundPreloads() {
    return settings.store.backgroundPreloadConcurrency ?? DEFAULT_BACKGROUND_PRELOADS;
}
function getBackgroundPreloadLimit() {
    return settings.store.backgroundPreloadLimit ?? DEFAULT_BACKGROUND_PRELOAD_LIMIT;
}
function getRetryCount() {
    return settings.store.retryCount ?? DEFAULT_RETRY_COUNT;
}
function rememberLoadedUrl(src) {
    if (!settings.store.rememberLoadedPreviews && !settings.store.preloadAllInBackground)
        return;
    loadedPreviewUrls.add(src);
    const listeners = previewLoadListeners.get(src);
    if (listeners) {
        previewLoadListeners.delete(src);
        for (const listener of listeners)
            listener();
    }
    if (loadedPreviewUrls.size <= PREVIEW_CACHE_LIMIT)
        return;
    const oldest = loadedPreviewUrls.values().next().value;
    if (oldest)
        loadedPreviewUrls.delete(oldest);
}
function subscribePreviewLoad(src, listener) {
    if (loadedPreviewUrls.has(src)) {
        listener();
        return () => { };
    }
    const listeners = previewLoadListeners.get(src) ?? new Set();
    listeners.add(listener);
    previewLoadListeners.set(src, listeners);
    while (previewLoadListeners.size > PREVIEW_LISTENER_LIMIT) {
        const oldest = previewLoadListeners.keys().next().value;
        if (!oldest)
            break;
        previewLoadListeners.delete(oldest);
    }
    return () => {
        listeners.delete(listener);
        if (!listeners.size)
            previewLoadListeners.delete(src);
    };
}
function queueBackgroundPreload(src) {
    if (!settings.store.preloadAllInBackground || loadedPreviewUrls.has(src) || backgroundPreloadQueued.has(src))
        return;
    bumpStat("backgroundQueued");
    backgroundPreloadQueued.add(src);
    if (backgroundPreloadQueued.size > BACKGROUND_QUEUE_LIMIT) {
        const oldest = backgroundPreloadQueued.values().next().value;
        if (oldest)
            backgroundPreloadQueued.delete(oldest);
    }
    if (backgroundPreloadQueue.length >= BACKGROUND_QUEUE_LIMIT)
        backgroundPreloadQueue.shift();
    backgroundPreloadQueue.push(src);
    pumpBackgroundPreloads();
}
function pumpBackgroundPreloads() {
    while (activeBackgroundPreloads < getMaxBackgroundPreloads()) {
        const src = backgroundPreloadQueue.shift();
        if (!src)
            return;
        preloadImage(src);
    }
}
function preloadImage(src) {
    activeBackgroundPreloads++;
    const image = new Image();
    const finish = (loaded) => {
        backgroundPreloadImages.delete(image);
        activeBackgroundPreloads = Math.max(0, activeBackgroundPreloads - 1);
        if (loaded) {
            bumpStat("backgroundLoaded");
            rememberLoadedUrl(src);
        }
        else {
            bumpStat("backgroundFailed");
        }
        pumpBackgroundPreloads();
    };
    image.decoding = "async";
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    backgroundPreloadImages.add(image);
    image.src = src;
}
function getGifSrc(gif) {
    const src = typeof gif.src === "string" ? gif.src : typeof gif.url === "string" ? gif.url : undefined;
    return src && shouldOptimizeSrc(src) ? src : undefined;
}
function getPreloadSrc(src) {
    const mode = getPreviewMode();
    return getPreviewSrc(src, mode === "hover" ? "static" : mode);
}
function getPreviewSrc(src, mode = getPreviewMode()) {
    const cacheKey = `${mode}:${src}`;
    const cached = previewUrlCache.get(cacheKey);
    if (cached)
        return cached;
    const previewSrc = makePreviewSrc(src, mode);
    previewUrlCache.set(cacheKey, previewSrc);
    if (previewUrlCache.size > PREVIEW_CACHE_LIMIT) {
        const oldest = previewUrlCache.keys().next().value;
        if (oldest)
            previewUrlCache.delete(oldest);
    }
    return previewSrc;
}
function getPreviewMode() {
    return settings.store.previewMode ?? "webp";
}
function makePreviewSrc(src, mode) {
    if (mode === "original")
        return src;
    try {
        const url = new URL(src);
        const still = mode === "static" || mode === "hover";
        const format = still ? "png" : "webp";
        if (isTenorHost(url.hostname) && url.pathname.toLowerCase().endsWith(".gif")) {
            url.pathname = url.pathname.replace(/\.gif$/i, `.${format}`);
            return url.toString();
        }
        if (!isDiscordMediaHost(url.hostname))
            return src;
        url.searchParams.set("format", "webp");
        url.searchParams.set("animated", String(!still));
        return url.toString();
    }
    catch {
        return src;
    }
}
function getRetrySrc(src, attempt) {
    if (!attempt)
        return src;
    try {
        const url = new URL(src);
        url.searchParams.set(RETRY_PARAM, attempt.toString());
        return url.toString();
    }
    catch {
        return `${src}${src.includes("?") ? "&" : "?"}${RETRY_PARAM}=${attempt}`;
    }
}
function shouldOptimizeSrc(src) {
    if (src.startsWith("data:") || src.startsWith("blob:"))
        return false;
    try {
        const url = new URL(src);
        return url.pathname.toLowerCase().endsWith(".gif");
    }
    catch {
        return GIF_EXTENSION_RE.test(src);
    }
}
function isTenorHost(hostname) {
    return hostname === "tenor.com" || hostname.endsWith(".tenor.com");
}
function isDiscordMediaHost(hostname) {
    return getDiscordMediaHosts().has(hostname);
}
function getDiscordMediaHosts() {
    if (discordMediaHosts)
        return discordMediaHosts;
    const { CDN_HOST, IMAGE_PROXY_ENDPOINTS, MEDIA_PROXY_ENDPOINT } = window.GLOBAL_ENV;
    discordMediaHosts = new Set();
    addEndpointHost(discordMediaHosts, CDN_HOST);
    for (const endpoint of (IMAGE_PROXY_ENDPOINTS ?? "").split(",")) {
        addEndpointHost(discordMediaHosts, endpoint);
    }
    addEndpointHost(discordMediaHosts, MEDIA_PROXY_ENDPOINT);
    return discordMediaHosts;
}
function addEndpointHost(hosts, endpoint) {
    if (!endpoint)
        return;
    try {
        const url = new URL(endpoint.includes("://") ? endpoint : `https://${endpoint.replace(/^\/\//, "")}`);
        hosts.add(url.hostname);
    }
    catch {
        return;
    }
}
