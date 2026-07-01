/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { disableCacheLimits, resetCacheLimits } from "@utils/cacheLimits";
import { TestcordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { findAll } from "@webpack";
import { FluxDispatcher, MessageStore, SelectedChannelStore } from "@webpack/common";

const logger = new Logger("OptimizerPremium");

const THROTTLED_CLASS_TOKENS = ["activity", "subText", "botText", "clanTag"] as const;

const settings = definePluginSettings({
    domThrottle: {
        type: OptionType.BOOLEAN,
        description: "Defer non-critical visual updates (activity, subText, botText, clan tags) via MutationObserver. Safe — does not patch appendChild.",
        default: true
    },
    domThrottleDelay: {
        type: OptionType.SLIDER,
        description: "Delay in ms applied to throttled DOM updates. Higher delays free more CPU but make those UI bits update slower.",
        markers: [25, 50, 100, 150, 250, 500],
        default: 100,
        stickToMarkers: false,
        restartNeeded: true
    },
    disableSpringAnimations: {
        type: OptionType.BOOLEAN,
        description: "Skip all react-spring animations across the client. Major responsiveness boost on low-end machines.",
        default: false
    },
    animationFrameReduction: {
        type: OptionType.SLIDER,
        description: "Drop frames from requestAnimationFrame. 0 disables, higher values skip more frames.",
        markers: [0, 25, 50, 75, 100],
        default: 0,
        restartNeeded: true
    },
    networkCache: {
        type: OptionType.BOOLEAN,
        description: "Cache static image responses (png, jpg, webp) in memory to cut redundant fetches. Bounded by entry count and TTL.",
        default: true
    },
    networkCacheMinutes: {
        type: OptionType.SLIDER,
        description: "How long, in minutes, the network cache keeps entries before evicting them.",
        markers: [1, 5, 10, 15, 30, 60],
        default: 5,
        stickToMarkers: false,
        restartNeeded: true
    },
    networkCacheMaxEntries: {
        type: OptionType.SLIDER,
        description: "Hard cap on cached image entries. Oldest entries are evicted first when exceeded.",
        markers: [50, 100, 200, 500, 1000],
        default: 200,
        stickToMarkers: false,
        restartNeeded: true
    },
    forceLowImageQuality: {
        type: OptionType.BOOLEAN,
        description: "Rewrite Discord CDN image URLs to request smaller sizes. Saves bandwidth and decode cost.",
        default: false
    },
    pauseOffscreenMedia: {
        type: OptionType.BOOLEAN,
        description: "Auto-pause videos and animated content that scroll out of view.",
        default: true
    },
    memoryManagement: {
        type: OptionType.BOOLEAN,
        description: "Periodically check JS heap pressure and trim caches when usage is high. Requires Chromium performance.memory.",
        default: true
    },
    memoryCheckSeconds: {
        type: OptionType.SLIDER,
        description: "Seconds between memory pressure checks.",
        markers: [10, 30, 60, 120, 300],
        default: 30,
        stickToMarkers: false,
        restartNeeded: true
    },
    optimizeTooltips: {
        type: OptionType.BOOLEAN,
        description: "Skip the unnecessary flushSync inside Discord's tooltip module. Smoother tooltip transitions.",
        default: true,
        restartNeeded: true
    },
    optimizeEmojiCache: {
        type: OptionType.BOOLEAN,
        description: "Cache repeat emoji-pack getter calls to avoid re-walking emoji lists on every render.",
        default: true,
        restartNeeded: true
    },
    killLoadingSpinner: {
        type: OptionType.BOOLEAN,
        description: "Strip the app loading spinner. It's pretty but it has measurable cost.",
        default: true,
        restartNeeded: true
    },
    killConfettiCanvas: {
        type: OptionType.BOOLEAN,
        description: "Remove the SpriteCanvas used for confetti, particles and similar visual effects.",
        default: true,
        restartNeeded: true
    },
    killGatewayAnalytics: {
        type: OptionType.BOOLEAN,
        description: "Drop the analytics flush block that JSON.stringifies the gateway READY payload.",
        default: true,
        restartNeeded: true
    },
    virtualizeMessages: {
        type: OptionType.BOOLEAN,
        description: "Apply CSS containment to messages so the browser skips work on offscreen rows.",
        default: true
    },
    optimizeTextRendering: {
        type: OptionType.BOOLEAN,
        description: "Apply optimizeSpeed text-rendering on message content. Faster text layout on large channels.",
        default: true
    },
    killBackdropBlur: {
        type: OptionType.BOOLEAN,
        description: "Strip backdrop-filter blur effects (popouts, modals, overlays). Massive GPU win on integrated graphics.",
        default: false
    },
    forcePassiveListeners: {
        type: OptionType.BOOLEAN,
        description: "Force wheel, touchstart, touchmove and mousewheel listeners to passive mode. Reduces scroll input lag.",
        default: false
    },
    suppressConsoleSpam: {
        type: OptionType.BOOLEAN,
        description: "Suppress Discord's noisy console.log/debug output. Console.error and console.warn still pass through.",
        default: true
    },
    freezeGifsUntilHover: {
        type: OptionType.BOOLEAN,
        description: "Freeze animated GIFs using canvas capture (shows first frame, plays on hover). More precise but uses per-image canvas overhead.",
        default: false
    },
    gifFreezeMethod: {
        type: OptionType.SELECT,
        description: "GIF freeze method. Canvas captures first frame, CSS hides until hover (more efficient but shows blank space before hover).",
        options: [
            { label: "Canvas (first frame preview)", value: "canvas", default: true },
            { label: "CSS content-visibility (more efficient)", value: "css" },
        ],
        disabled: () => !settings.store.freezeGifsUntilHover,
    },
    throttleResizeObservers: {
        type: OptionType.BOOLEAN,
        description: "Coalesce ResizeObserver callbacks via requestAnimationFrame. Prevents layout thrash during window resize and dynamic UI changes.",
        default: true,
        restartNeeded: true
    },
    reduceMotion: {
        type: OptionType.BOOLEAN,
        description: "Apply prefers-reduced-motion globally. Disables transitions and CSS animations.",
        default: false
    },
    killWillChange: {
        type: OptionType.BOOLEAN,
        description: "Strip will-change hints Discord scatters around. Reduces GPU memory and layer explosions.",
        default: true
    },
    lazyEmbedImages: {
        type: OptionType.BOOLEAN,
        description: "Force loading=lazy and decoding=async on every embed/attachment image.",
        default: true
    },
    disableTypingIndicator: {
        type: OptionType.BOOLEAN,
        description: "Hide the 'X is typing...' indicator. The animated dots cause continuous repaints.",
        default: false
    },
    verboseLogging: {
        type: OptionType.BOOLEAN,
        description: "Log optimization activity to the console. Disable for production.",
        default: false
    },
    cacheLimitsEnabled: {
        type: OptionType.BOOLEAN,
        description: "Cap internal plugin caches (diffs, translations, ZIP previews, logged messages, voice stats) to prevent unbounded memory growth. Disable if you have RAM to spare and want maximum cache hit rate.",
        default: true
    },
    lazyIframes: {
        type: OptionType.BOOLEAN,
        description: "Defer iframe loading until they scroll into view. Reduces initial page load cost. hcaptcha iframes are excluded to prevent breaking verification.",
        default: true
    },
    disableAnimatedHeaders: {
        type: OptionType.BOOLEAN,
        description: "Remove animated gradient effects in header areas. Pure cosmetic, big GPU savings.",
        default: false
    },
    optimizeImageDecoding: {
        type: OptionType.BOOLEAN,
        description: "Force images to decode asynchronously and preload critical images. Smoother first paint.",
        default: true
    },
    throttleMutationObservers: {
        type: OptionType.BOOLEAN,
        description: "Consolidate multiple MutationObservers into a single shared observer with priority dispatch.",
        default: true,
        restartNeeded: true
    },
    suppressReactionAnimations: {
        type: OptionType.BOOLEAN,
        description: "Strip entrance/exit animations from reaction buttons. Those pop/glow transitions cause layout on every reaction add.",
        default: true,
        restartNeeded: true
    },
    messageContentVisibility: {
        type: OptionType.BOOLEAN,
        description: "Apply content-visibility: auto on message list items so the browser skips layout/paint for offscreen messages entirely. Stronger than contain.",
        default: false
    },
    suppressEmbedPreviews: {
        type: OptionType.BOOLEAN,
        description: "Hide rich embed previews in chat. Reduces DOM, image decode and paint cost in embed-heavy channels.",
        default: false,
        restartNeeded: true
    },
    disableAnimatedEmoji: {
        type: OptionType.BOOLEAN,
        description: "Force all emoji to render as static. Cuts continuous re-decode of animated emoji in active channels.",
        default: false
    },
    limitConcurrentRequests: {
        type: OptionType.SLIDER,
        description: "Cap concurrent network requests. 0 = unlimited. Prevents browser connection throttling from saturating the limit.",
        markers: [0, 6, 12, 24, 50],
        default: 0,
        stickToMarkers: false,
        restartNeeded: true
    },
    suppressGifAutoplay: {
        type: OptionType.BOOLEAN,
        description: "Prevent GIFs in embeds from autoplaying. Only plays when you hover the embed. Cuts decode CPU dramatically.",
        default: false
    },
    // --- Advanced CSS optimizations ---

    containMemberList: {
        type: OptionType.BOOLEAN,
        description: "Apply content-visibility and layout containment to the member list. Offscreen members skip layout and paint entirely. Best in large servers.",
        default: false
    },
    containServerList: {
        type: OptionType.BOOLEAN,
        description: "Apply layout containment to the server/guild list. Reduces layout cost from avatar position changes.",
        default: false
    },
    hideVoicePanel: {
        type: OptionType.BOOLEAN,
        description: "Hide the voice channel status/activity panel in the channel list. Saves DOM update cost from voice state changes.",
        default: false
    },
    hideActivityPanel: {
        type: OptionType.BOOLEAN,
        description: "Hide the 'Now Playing' game activity panel at the bottom of the channel list. Stops constant game-status repaints.",
        default: false
    },
    hideServerBanner: {
        type: OptionType.BOOLEAN,
        description: "Hide the server banner image at the top of the channel list. Saves image decode and paint cost.",
        default: false
    },
    hideAvatarDecorations: {
        type: OptionType.BOOLEAN,
        description: "Hide avatar decorations (nitro profile customisation). Saves image decode for each decorated avatar in view.",
        default: false
    },
    suppressProfileEffects: {
        type: OptionType.BOOLEAN,
        description: "Hide animated profile effects. Cuts GPU compositing cost from profile backgrounds.",
        default: false
    },
    hideServerBoosting: {
        type: OptionType.BOOLEAN,
        description: "Hide the server boost progress bar above the channel list.",
        default: false
    },
    hideNitroUpsell: {
        type: OptionType.BOOLEAN,
        description: "Hide nitro upsell elements and promotional buttons.",
        default: false
    },
    hideServerGuide: {
        type: OptionType.BOOLEAN,
        description: "Hide server guide and home channel prompts.",
        default: false
    },
    hideServerOnboarding: {
        type: OptionType.BOOLEAN,
        description: "Hide server onboarding prompts and resource channels.",
        default: false
    },
    hideSoundboardButton: {
        type: OptionType.BOOLEAN,
        description: "Hide the soundboard button from the chat bar.",
        default: false
    },
    hideGiftButton: {
        type: OptionType.BOOLEAN,
        description: "Hide the gift button from the chat bar.",
        default: false
    },
    suppressChannelAnimations: {
        type: OptionType.BOOLEAN,
        description: "Remove channel list entry, exit, and hover animation effects.",
        default: false
    },
    suppressUnreadBadgeAnimations: {
        type: OptionType.BOOLEAN,
        description: "Remove the pulsing animation on unread message badges.",
        default: false
    },
    suppressMentionBadgeAnimations: {
        type: OptionType.BOOLEAN,
        description: "Remove the bouncing animation on mention badges.",
        default: false
    },
    suppressStickerAnimation: {
        type: OptionType.BOOLEAN,
        description: "Force all stickers to render as static images. Cuts decode cost for animated stickers in busy channels.",
        default: false
    },
    suppressEmbedAutoLoad: {
        type: OptionType.BOOLEAN,
        description: "Delay loading images inside link embeds. Saves network and decode cost for image-heavy embed chains. Images lazy-load as you scroll.",
        default: false
    },
    containForumPosts: {
        type: OptionType.BOOLEAN,
        description: "Apply content-visibility to forum channel post previews. Offscreen posts skip layout and paint.",
        default: false
    },
    suppressEmojiPickerAnimations: {
        type: OptionType.BOOLEAN,
        description: "Disable emoji picker entrance and hover animations.",
        default: false
    },
    hideStickerButton: {
        type: OptionType.BOOLEAN,
        description: "Hide the sticker picker button from the chat bar.",
        default: false
    },
    killMessageEffects: {
        type: OptionType.BOOLEAN,
        description: "Hide per-message effect animations (fireworks, sparkles, etc). CSS-based, does not use webpack patches.",
        default: false
    },

    // --- New performance features ---

    limitMessageCache: {
        type: OptionType.BOOLEAN,
        description: "Periodically trim Discord's MessageStore for channels not viewed recently. Frees memory from inactive channels.",
        default: false
    },
    limitMessageCacheMinutes: {
        type: OptionType.SLIDER,
        description: "Minutes of inactivity before a channel's message cache is trimmed.",
        markers: [5, 10, 15, 30, 60],
        default: 15,
        stickToMarkers: false,
        restartNeeded: true
    },
    freezeAnimatedAvatars: {
        type: OptionType.BOOLEAN,
        description: "Show first frame of animated avatars, playing animation on hover. Reduces continuous decode cost.",
        default: false
    },
    reduceAvatarQuality: {
        type: OptionType.BOOLEAN,
        description: "Request smaller avatar images from Discord CDN. Reduces image decode time and memory. May appear slightly blurry on high-DPI screens.",
        default: false
    },
    containDmList: {
        type: OptionType.BOOLEAN,
        description: "Apply CSS containment to DM list rows. Reduces layout cost when presence/status changes.",
        default: false
    },
    containEmbeds: {
        type: OptionType.BOOLEAN,
        description: "Apply CSS containment to embed elements so the browser can skip painting offscreen embeds.",
        default: false
    },
    optimizeToasts: {
        type: OptionType.BOOLEAN,
        description: "Remove animations and apply containment to notification toasts. Smoother toast appearance.",
        default: false
    },
    simplifySpoilers: {
        type: OptionType.BOOLEAN,
        description: "Replace blur overlay on spoiler content with simpler solid color. Reduces GPU compositing cost.",
        default: false
    },
    suppressSkeletonAnimation: {
        type: OptionType.BOOLEAN,
        description: "Stop shimmer/skeleton loading animations. Pure cosmetic, reduces repaint during channel loading.",
        default: false
    },

    // --- Very high performance features ---

    killSentry: {
        type: OptionType.BOOLEAN,
        description: "Block Discord's Sentry error reporting entirely. Eliminates heavy error serialization, WebSocket uploads, and stack trace walking. Major CPU and network savings.",
        default: false,
        restartNeeded: true
    },
    killPerformanceMetrics: {
        type: OptionType.BOOLEAN,
        description: "Neutralize Discord's internal performance.mark and performance.measure calls. Reduces GC pressure from constant metric recording.",
        default: true
    },
    suppressConsoleTimers: {
        type: OptionType.BOOLEAN,
        description: "Block console.time and console.timeEnd calls. These create internal timer objects even when console output is suppressed.",
        default: true
    },
    killHoverTransitions: {
        type: OptionType.BOOLEAN,
        description: "Remove hover, focus, and active state transitions across the entire client. Eliminates per-mouse-move repaints.",
        default: false
    },
    preconnectDiscordCdn: {
        type: OptionType.BOOLEAN,
        description: "Insert preconnect hints to Discord's CDN on startup. Warms DNS+TLS so the first image load is faster.",
        default: true,
        restartNeeded: true
    },
    forceCompositingLayers: {
        type: OptionType.BOOLEAN,
        description: "Add contain:content on major scroll containers to force GPU compositing layers. Reduces CPU-side paint work on scroll.",
        default: false,
        restartNeeded: true
    },
    suppressIdleCallback: {
        type: OptionType.BOOLEAN,
        description: "Replace requestIdleCallback with a faster MessageChannel-based scheduler. Reduces idle callback latency for deferred work.",
        default: false,
        restartNeeded: true
    },

    // --- Extended console suppression ---

    suppressConsoleWarn: {
        type: OptionType.BOOLEAN,
        description: "Suppress console.warn output. Saves string formatting and console backend work.",
        default: false
    },
    suppressConsoleGroup: {
        type: OptionType.BOOLEAN,
        description: "Suppress console.group/groupEnd/groupCollapsed calls. Stops unnecessary grouping overhead in logs.",
        default: false
    },
    suppressConsoleCount: {
        type: OptionType.BOOLEAN,
        description: "Suppress console.count and console.countReset. These allocate counter maps internally.",
        default: false
    },
    suppressConsoleAssert: {
        type: OptionType.BOOLEAN,
        description: "Suppress console.assert. Avoids evaluating assertion expressions.",
        default: false
    },
    suppressConsoleDir: {
        type: OptionType.BOOLEAN,
        description: "Suppress console.dir and console.dirxml. Avoids serialization of complex objects.",
        default: false
    },

    // --- CSS rendering optimizations ---

    forceScrollBehavior: {
        type: OptionType.BOOLEAN,
        description: "Force scroll-behavior: auto globally. Smooth scrolling causes continuous repaints during programmatic scroll.",
        default: false
    },
    overscrollContain: {
        type: OptionType.BOOLEAN,
        description: "Add overscroll-behavior: contain to main content areas. Reduces GPU compositing on scroll boundary.",
        default: false
    },
    disableCSSFilters: {
        type: OptionType.BOOLEAN,
        description: "Strip all CSS filter() effects (blur, brightness, contrast, etc). Filters trigger GPU compositing on every paint.",
        default: false
    },
    disableBoxShadows: {
        type: OptionType.BOOLEAN,
        description: "Strip box-shadow from all elements. Box shadows significantly increase paint complexity.",
        default: false
    },
    disableTextShadows: {
        type: OptionType.BOOLEAN,
        description: "Strip text-shadow from all elements. Reduces text painting cost in large message lists.",
        default: false
    },
    disableSpellcheck: {
        type: OptionType.BOOLEAN,
        description: "Disable spellcheck in text input areas. Spellcheck causes synchronous layout during typing.",
        default: false
    },

    // --- Additional CSS containment ---

    containChannelList: {
        type: OptionType.BOOLEAN,
        description: "Apply content-visibility to channel list items. Offscreen channel rows skip paint entirely.",
        default: false
    },
    containSearchResults: {
        type: OptionType.BOOLEAN,
        description: "Apply content-visibility to search result items.",
        default: false
    },

    // --- Animation suppression extensions ---

    suppressModalAnimations: {
        type: OptionType.BOOLEAN,
        description: "Remove modal open/close slide+fade animations. Cuts paint cost on every modal interaction.",
        default: false
    },
    suppressScrollbarAnimations: {
        type: OptionType.BOOLEAN,
        description: "Remove custom scrollbar thumb animations. Stops repaints during scroll deceleration.",
        default: false
    },
    suppressDiscoveryAnimations: {
        type: OptionType.BOOLEAN,
        description: "Remove server discovery page entrance animations. Helps if the discovery tab is pinned.",
        default: false
    },

    // --- Layout optimizations ---

    disableDragAndDrop: {
        type: OptionType.BOOLEAN,
        description: "Suppress drag-and-drop event handling overhead. Reduces mousemove processing cost.",
        default: false
    },
    containGuildList: {
        type: OptionType.BOOLEAN,
        description: "Force content-visibility on guild/sever list items. Stronger than containServerList layout containment.",
        default: false
    },
    suppressContextMenuAnimations: {
        type: OptionType.BOOLEAN,
        description: "Remove context menu fade/scale entrance animations.",
        default: false
    },
    disableCanvasEffects: {
        type: OptionType.BOOLEAN,
        description: "Hide non-essential canvas elements (particles, confetti, backgrounds). Saves GPU composite and canvas redraw.",
        default: false
    },

    // --- Extreme performance (empty-page smoothness) ---

    killVoiceVideo: {
        type: OptionType.BOOLEAN,
        description: "Override RTCPeerConnection to neuter all voice/video WebRTC connections. Massive resource savings from audio/video encode/decode pipelines.",
        default: false,
        restartNeeded: true
    },
    throttleFluxDispatches: {
        type: OptionType.BOOLEAN,
        description: "Debounce typing flux dispatches. Prevents small React re-render storms without dropping presence or voice updates.",
        default: false
    },
    killReactionRendering: {
        type: OptionType.BOOLEAN,
        description: "Strip reaction button DOM to bare text counts. Removes animated emoji, hover effects, and reaction button chrome for drastic DOM simplification.",
        default: false
    },
    disableUnreadBadges: {
        type: OptionType.BOOLEAN,
        description: "Hide all unread message and mention badges everywhere. Stops continuous badge DOM updates that trigger layout on every message.",
        default: false
    },
    suppressAllCanvas: {
        type: OptionType.BOOLEAN,
        description: "Hide decorative canvas elements not covered by disableCanvasEffects. Adds broader canvas suppression for remaining effect canvases.",
        default: false
    },
    disableChannelTopic: {
        type: OptionType.BOOLEAN,
        description: "Hide the channel topic/description area above the message list. Removes one more layout/paint pass per channel view.",
        default: false
    },
    preventWebSocketFlood: {
        type: OptionType.BOOLEAN,
        description: "Drop only byte-identical gateway frames sent back to back within 50ms. Never blocks reconnect, resume, or heartbeat traffic, so it cannot wedge the connection when tabbed out.",
        default: false,
        restartNeeded: true
    },
    disableFolderAnimations: {
        type: OptionType.BOOLEAN,
        description: "Remove server folder expand/collapse transition animations. Stops layout recalculations during folder interactions.",
        default: false
    },
    disableInvitePreviews: {
        type: OptionType.BOOLEAN,
        description: "Hide server invite preview cards in chat. Stops image fetch, decode, and rich rendering of invite embeds.",
        default: false
    },
    unifiedMemberListGradient: {
        type: OptionType.BOOLEAN,
        description: "Replace per-member hover/select gradients with a single gradient behind the entire member list. Dramatically reduces paint layers on scroll and hover.",
        default: false
    },
    freezeMemberList: {
        type: OptionType.BOOLEAN,
        description: "Freeze member list DOM with paint/layout containment so presence changes, voice states, and status updates don't trigger repaints. Unfreezes briefly every 3 minutes to batch-refresh. Massive smoothness gain in large servers.",
        default: false
    },
    freezeWhenUnfocused: {
        type: OptionType.BOOLEAN,
        description: "Pause all CSS animations and transitions while the window is hidden/backgrounded. Stops the client burning CPU+GPU on offscreen animation; everything resumes on refocus.",
        default: false
    },

    // --- Typing and attachment optimizations ---

    optimizeChatInput: {
        type: OptionType.BOOLEAN,
        description: "Isolate the chat input with layout/paint containment, strip its transitions, and debounce per-keystroke draft saves so storage writes happen after you stop typing. Kills typing lag spikes.",
        default: true
    },
    optimizeLargeAttachments: {
        type: OptionType.BOOLEAN,
        description: "Apply content-visibility and containment to text/code file previews so a large txt attachment doesn't repaint the entire message list. Big win when a long file is posted in chat.",
        default: true
    },
    containAttachmentImages: {
        type: OptionType.BOOLEAN,
        description: "Apply content-visibility, containment and async decode to attachment image grids. Offscreen images in image-heavy messages skip decode and paint until scrolled into view.",
        default: true
    },
});

interface CacheEntry {
    response: Response;
    timestamp: number;
    bytes: number;
}

interface SpringMod {
    Globals?: { assign?: (opts: Record<string, unknown>) => void; };
    Springs?: unknown;
}

type WebkitWindow = Window & typeof globalThis & {
    webkitRTCPeerConnection?: typeof RTCPeerConnection;
};

export default definePlugin({
    name: "optimizerPremium",
    description: "All-in-one performance suite: webpack patches (tooltip, emoji, spinner, confetti, analytics, reactions, Sentry), bounded image cache, react-spring skip, offscreen media pause, MutationObserver DOM throttle, CSS containment (messages, members, DMs, embeds, servers, channels, forum, guild list, search), backdrop-blur/sticker/effect/upsell/spoiler/box-shadow/text-shadow/filter/backdrop suppression, lazy images/iframes, rAF reduction, passive listeners, console suppression (log/debug/info/warn/group/count/assert/dir/timers), ResizeObserver throttle, memory manager, GIF freeze (canvas/css), concurrency limit, message cache trimmer, animated avatar freeze, avatar quality reducer, cache limits, idle callback optimizer, drag-and-drop suppression, spellcheck opt-out, overscroll contain, link preview suppress, canvas effects hide, chat input containment (typing lag), large text attachment containment, attachment image grid containment.",
    tags: ["Utility", "Developers"],
    authors: [TestcordDevs.x2b, TestcordDevs.SirPhantom89],
    settings,

    patches: [
        {
            find: "this.state.shouldShowTooltip!==",
            predicate: () => settings.store.optimizeTooltips,
            replacement: [
                {
                    match: /\i\.flushSync\(\(\)=>\{this\.setState\(\{shouldShowTooltip:(\i)\}\)\}\)/,
                    replace: (_m, p) => `this.__open=${p},this.setState({shouldShowTooltip:${p}})`
                },
                {
                    match: /if\(this\.state\.shouldShowTooltip!==(\i)\)/,
                    replace: "if(this.__open!==$1)"
                }
            ]
        },
        {
            find: "this.rebuildFavoriteEmojisWithoutFetchingLatest()",
            predicate: () => settings.store.optimizeEmojiCache,
            replacement: [
                {
                    match: /(\i)=>\{let \i=(\i)\[null==\i\?(\i)\.kod:\i\];null!=\i&&\((\i)\(\)\.each\(\i\.usableEmojis,(\i)\),\i\(\)\.each\(\i\.emoticons,(\i)\)\)\};/,
                    replace: (_m, e, q, k, a, n, r) =>
                        `${e}=>{` +
                        `const t=${q}[null==${e}?${k}.kod:${e}];` +
                        "const usableEmojis=t?.usableEmojis;" +
                        "const emoticons=t?.emoticons;" +
                        `null!=t&&(${a}().each(usableEmojis,${n}),${a}().each(emoticons,${r}))` +
                        "};"
                }
            ]
        },
        {
            find: /\i\.\i\.getAppSpinnerSources\(\)/,
            predicate: () => settings.store.killLoadingSpinner,
            replacement: {
                match: /let \i=\i\.\i\.getAppSpinnerSources\(\).+?;(\i\.\i).+?\)\}/,
                replace: "$1=()=>null;"
            }
        },
        {
            find: "\"SpriteCanvas-module_spriteCanvasHidden",
            predicate: () => settings.store.killConfettiCanvas,
            replacement: {
                match: /,\i\.createElement\("canvas",\{.+?\)\}\)/,
                replace: ""
            }
        },
        {
            find: "getDispatchHandler needs to be passed in first!",
            predicate: () => settings.store.killGatewayAnalytics,
            replacement: {
                match: /let \i=Date\.now\(\),(\i=\i\.Z\.flush\(\i,\i\));\i\.\i\.showPerformanceTelemetry\?.+?Telemetry\(.+?,\i\)/,
                replace: "$1"
            }
        },
        {
            find: /reactionAnimations/,
            predicate: () => settings.store.suppressReactionAnimations,
            replacement: {
                match: /reactionAnimations:\i,/,
                replace: "reactionAnimations:{reactionPop:{},reactionBurst:{}},",
            }
        },
        {
            // Kill Sentry init — patch the DSN to empty so the SDK never boots
            find: "Sentry.init",
            predicate: () => settings.store.killSentry,
            replacement: {
                match: /Sentry\.init\(\{([^}]*?)dsn:[^,}]*/,
                replace: 'Sentry.init({$1dsn:""'
            },
            noWarn: true
        },
    ],

    originals: {} as {
        fetch?: typeof window.fetch;
        console?: { log: typeof console.log; debug: typeof console.debug; info: typeof console.info; };
        _perfMark?: typeof performance.mark;
        _perfMeasure?: typeof performance.measure;
        _consoleTime?: typeof console.time;
        _consoleTimeEnd?: typeof console.timeEnd;
        _consoleTimeLog?: typeof console.timeLog;
    },
    springs: [] as SpringMod[],
    networkCache: new Map<string, CacheEntry>(),
    networkCacheOrder: [] as string[],
    pendingRafReduction: new Map<number, { raf?: number; timeout?: ReturnType<typeof setTimeout>; }>(),
    nextRafReductionId: 1,
    cacheCleanupTimer: null as ReturnType<typeof setInterval> | null,
    memoryTimer: null as ReturnType<typeof setInterval> | null,
    intersectionObserver: null as IntersectionObserver | null,
    lazyIframeObserver: null as IntersectionObserver | null,
    lazyIframeMutationObserver: null as MutationObserver | null,
    mediaMutationObserver: null as MutationObserver | null,
    pausedMedia: new Set<HTMLMediaElement>(),
    optimizerStyleEl: null as HTMLStyleElement | null,
    extraStyleEl: null as HTMLStyleElement | null,
    domThrottleStyleEl: null as HTMLStyleElement | null,
    domThrottleObserver: null as MutationObserver | null,
    domThrottleTimers: new Map<Element, ReturnType<typeof setTimeout>>(),
    gifMutationObserver: null as MutationObserver | null,
    gifManagedImages: new WeakSet<HTMLImageElement>(),
    gifBlobUrls: new Set<string>(),
    lazyImageObserver: null as MutationObserver | null,
    consolidatedObserver: null as MutationObserver | null,
    observerCallbacks: new Map<string, (records: MutationRecord[]) => void>(),
    animatedEmojiObserver: null as MutationObserver | null,
    imageDecodingObserver: null as MutationObserver | null,
    gifAutoplayObserver: null as MutationObserver | null,
    gifAutoplayCleanups: new WeakMap<HTMLVideoElement, () => void>(),
    avatarObserver: null as MutationObserver | null,
    avatarQualityObserver: null as MutationObserver | null,
    preconnectLink: null as HTMLLinkElement | null,
    preconnectLink2: null as HTMLLinkElement | null,
    hoverTransitionStyleEl: null as HTMLStyleElement | null,
    compositingStyleEl: null as HTMLStyleElement | null,
    cacheTrimTimer: null as ReturnType<typeof setInterval> | null,
    originalRaf: null as ((cb: FrameRequestCallback) => number) | null,
    originalCancelRaf: null as typeof cancelAnimationFrame | null,
    originalPassiveListener: null as typeof EventTarget.prototype.addEventListener | null,
    originalIdleCallback: null as typeof requestIdleCallback | null,
    originalCancelIdleCallback: null as typeof cancelIdleCallback | null,
    originalResizeObserver: null as typeof ResizeObserver | null,
    originalConsoleWarn: null as typeof console.warn | null,
    originalConsoleGroup: null as typeof console.group | null,
    originalConsoleGroupEnd: null as typeof console.groupEnd | null,
    originalConsoleGroupCollapsed: null as typeof console.groupCollapsed | null,
    originalConsoleCount: null as typeof console.count | null,
    originalConsoleCountReset: null as typeof console.countReset | null,
    originalConsoleAssert: null as typeof console.assert | null,
    originalConsoleDir: null as typeof console.dir | null,
    originalConsoleDirxml: null as typeof console.dirxml | null,
    fetchQueue: [] as Array<{ target: RequestInfo | URL; init?: RequestInit; resolve: (v: Response) => void; reject: (v: unknown) => void }>,
    originalScrollTo: null as typeof window.scrollTo | null,
    rICMessagePort: null as MessagePort | null,
    rICMessagePort1: null as MessagePort | null,
    rICCallbacks: null as Map<number, { cb: IdleRequestCallback; options?: IdleRequestOptions }> | null,
    cacheTrimActivityHandler: null as (() => void) | null,
    suppressConsoleWarnEl: null as HTMLStyleElement | null,
    reactionStyleEl: null as HTMLStyleElement | null,
    canvasSuppressEl: null as HTMLStyleElement | null,
    unreadBadgeEl: null as HTMLStyleElement | null,
    channelTopicEl: null as HTMLStyleElement | null,
    folderAnimEl: null as HTMLStyleElement | null,
    invitePreviewEl: null as HTMLStyleElement | null,
    memberListGradientEl: null as HTMLStyleElement | null,
    memberFreezeEl: null as HTMLStyleElement | null,
    memberFreezeTimer: null as ReturnType<typeof setInterval> | null,
    memberFreezeRefreshTimer: null as ReturnType<typeof setTimeout> | null,
    websocketPatchEl: null as HTMLStyleElement | null,
    spellcheckObserver: null as MutationObserver | null,
    unfocusedFreezeStyleEl: null as HTMLStyleElement | null,
    unfocusedVisibilityHandler: null as (() => void) | null,
    fluxThrottleState: null as {
        origDispatch: typeof FluxDispatcher.dispatch;
        wrappedDispatch: typeof FluxDispatcher.dispatch;
        timers: Map<string, ReturnType<typeof setTimeout>>;
    } | null,

    start() {
        if (settings.store.verboseLogging) logger.info("Starting optimizer suite");

        try { if (settings.store.throttleMutationObservers) this.installConsolidatedObserver(); } catch (e) { logger.warn("installConsolidatedObserver failed", e); }
        try { if (settings.store.domThrottle) this.installDomThrottle(); } catch (e) { logger.warn("installDomThrottle failed", e); }
        try { if (settings.store.networkCache || settings.store.forceLowImageQuality) this.installNetworkLayer(); } catch (e) { logger.warn("installNetworkLayer failed", e); }
        try { if (settings.store.disableSpringAnimations) this.installSpringSkip(); } catch (e) { logger.warn("installSpringSkip failed", e); }
        try { if (settings.store.memoryManagement) this.installMemoryManager(); } catch (e) { logger.warn("installMemoryManager failed", e); }
        try { if (settings.store.pauseOffscreenMedia) this.installOffscreenMediaPause(); } catch (e) { logger.warn("installOffscreenMediaPause failed", e); }
        try { if (settings.store.virtualizeMessages || settings.store.optimizeTextRendering) this.installCSSOptimizations(); } catch (e) { logger.warn("installCSSOptimizations failed", e); }
        try { if (settings.store.suppressConsoleSpam) this.installConsoleSuppression(); } catch (e) { logger.warn("installConsoleSuppression failed", e); }
        try { if (settings.store.freezeGifsUntilHover && settings.store.gifFreezeMethod !== "css") this.installGifFreezer(); } catch (e) { logger.warn("installGifFreezer failed", e); }
        try { if (settings.store.lazyEmbedImages) this.installLazyImages(); } catch (e) { logger.warn("installLazyImages failed", e); }
        try { if (settings.store.lazyIframes) this.installLazyIframes(); } catch (e) { logger.warn("installLazyIframes failed", e); }
        try { if (settings.store.optimizeImageDecoding) this.installImageDecodingOptimization(); } catch (e) { logger.warn("installImageDecodingOptimization failed", e); }
        try { if (settings.store.disableAnimatedEmoji) this.installDisableAnimatedEmoji(); } catch (e) { logger.warn("installDisableAnimatedEmoji failed", e); }
        try { if (settings.store.suppressGifAutoplay) this.installSuppressGifAutoplay(); } catch (e) { logger.warn("installSuppressGifAutoplay failed", e); }
        try { if (settings.store.killPerformanceMetrics) this.installPerfMetricsBlocker(); } catch (e) { logger.warn("installPerfMetricsBlocker failed", e); }
        try { if (settings.store.suppressConsoleTimers) this.installConsoleTimerBlocker(); } catch (e) { logger.warn("installConsoleTimerBlocker failed", e); }
        try { if (settings.store.killHoverTransitions) this.installHoverTransitionKiller(); } catch (e) { logger.warn("installHoverTransitionKiller failed", e); }
        try { if (settings.store.preconnectDiscordCdn) this.installPreconnect(); } catch (e) { logger.warn("installPreconnect failed", e); }
        try { if (settings.store.forceCompositingLayers) this.installCompositingLayers(); } catch (e) { logger.warn("installCompositingLayers failed", e); }
        try { if (settings.store.freezeAnimatedAvatars) this.installAnimatedAvatarOptimizer(); } catch (e) { logger.warn("installAnimatedAvatarOptimizer failed", e); }
        try { if (settings.store.reduceAvatarQuality) this.installAvatarQualityReducer(); } catch (e) { logger.warn("installAvatarQualityReducer failed", e); }
        try { if (settings.store.animationFrameReduction) this.installRafReduction(); } catch (e) { logger.warn("installRafReduction failed", e); }
        try { if (settings.store.forcePassiveListeners) this.installPassiveListeners(); } catch (e) { logger.warn("installPassiveListeners failed", e); }
        try { if (settings.store.throttleResizeObservers) this.installResizeObserverThrottle(); } catch (e) { logger.warn("installResizeObserverThrottle failed", e); }
        try { if (settings.store.limitMessageCache) this.installMessageCacheTrimmer(); } catch (e) { logger.warn("installMessageCacheTrimmer failed", e); }
        try { if (settings.store.limitConcurrentRequests) this.installConcurrentRequestLimiter(); } catch (e) { logger.warn("installConcurrentRequestLimiter failed", e); }
        try { if (settings.store.suppressConsoleWarn) this.installConsoleWarnSuppression(); } catch (e) { logger.warn("installConsoleWarnSuppression failed", e); }
        try { if (settings.store.suppressConsoleGroup) this.installConsoleGroupSuppression(); } catch (e) { logger.warn("installConsoleGroupSuppression failed", e); }
        try { if (settings.store.suppressConsoleCount) this.installConsoleCountSuppression(); } catch (e) { logger.warn("installConsoleCountSuppression failed", e); }
        try { if (settings.store.suppressConsoleAssert) this.installConsoleAssertSuppression(); } catch (e) { logger.warn("installConsoleAssertSuppression failed", e); }
        try { if (settings.store.suppressConsoleDir) this.installConsoleDirSuppression(); } catch (e) { logger.warn("installConsoleDirSuppression failed", e); }
        try { if (settings.store.suppressIdleCallback) this.installIdleCallbackOptimizer(); } catch (e) { logger.warn("installIdleCallbackOptimizer failed", e); }
        try { if (settings.store.disableDragAndDrop) this.installDragAndDropSuppression(); } catch (e) { logger.warn("installDragAndDropSuppression failed", e); }
        try { if (settings.store.disableSpellcheck) this.installSpellcheckOpt(); } catch (e) { logger.warn("installSpellcheckOpt failed", e); }
        try { if (settings.store.throttleFluxDispatches) this.installFluxThrottle(); } catch (e) { logger.warn("installFluxThrottle failed", e); }
        try { if (settings.store.killReactionRendering) this.installReactionSimplifier(); } catch (e) { logger.warn("installReactionSimplifier failed", e); }
        try { if (settings.store.disableUnreadBadges) this.installUnreadBadgeKiller(); } catch (e) { logger.warn("installUnreadBadgeKiller failed", e); }
        try { if (settings.store.suppressAllCanvas) this.installCanvasSuppressor(); } catch (e) { logger.warn("installCanvasSuppressor failed", e); }
        try { if (settings.store.disableChannelTopic) this.installChannelTopicKiller(); } catch (e) { logger.warn("installChannelTopicKiller failed", e); }
        try { if (settings.store.disableFolderAnimations) this.installFolderAnimationKiller(); } catch (e) { logger.warn("installFolderAnimationKiller failed", e); }
        try { if (settings.store.disableInvitePreviews) this.installInvitePreviewKiller(); } catch (e) { logger.warn("installInvitePreviewKiller failed", e); }
        try { if (settings.store.unifiedMemberListGradient) this.installMemberListGradient(); } catch (e) { logger.warn("installMemberListGradient failed", e); }
        try { if (settings.store.freezeMemberList) this.installMemberFreezer(); } catch (e) { logger.warn("installMemberFreezer failed", e); }
        try { if (settings.store.freezeWhenUnfocused) this.installUnfocusedFreezer(); } catch (e) { logger.warn("installUnfocusedFreezer failed", e); }
        try { if (settings.store.killVoiceVideo) this.installVoiceVideoKiller(); } catch (e) { logger.warn("installVoiceVideoKiller failed", e); }
        try { if (settings.store.preventWebSocketFlood) this.installWebSocketFloodPreventer(); } catch (e) { logger.warn("installWebSocketFloodPreventer failed", e); }
        try { this.installExtraCSS(); } catch (e) { logger.warn("installExtraCSS failed", e); }

        if (settings.store.cacheLimitsEnabled) {
            resetCacheLimits();
            if (settings.store.verboseLogging) logger.info("Plugin cache limits active");
        } else {
            disableCacheLimits();
            if (settings.store.verboseLogging) logger.info("Plugin cache limits disabled");
        }

        if (settings.store.verboseLogging) logger.info("Started");
    },

    stop() {
        if (settings.store.verboseLogging) logger.info("Stopping, restoring originals");

        this.teardownConsolidatedObserver();
        this.teardownDomThrottle();
        this.restoreSpringSkip();
        this.teardownMemoryManager();
        this.teardownOffscreenMediaPause();
        this.teardownCSSOptimizations();
        this.restoreConsoleSuppression();
        this.teardownGifFreezer();
        this.teardownLazyImages();
        this.teardownLazyIframes();
        this.teardownImageDecodingOptimization();
        this.teardownExtraCSS();
        this.teardownDisableAnimatedEmoji();
        this.teardownSuppressGifAutoplay();
        this.teardownPerfMetricsBlocker();
        this.teardownConsoleTimerBlocker();
        this.teardownHoverTransitionKiller();
        this.teardownPreconnect();
        this.teardownCompositingLayers();
        this.teardownAnimatedAvatarOptimizer();
        this.teardownAvatarQualityReducer();
        this.restoreRafReduction();
        this.restorePassiveListeners();
        this.restoreResizeObserverThrottle();
        this.teardownMessageCacheTrimmer();
        this.teardownConcurrentRequestLimiter();
        this.restoreNetworkLayer();
        this.teardownIdleCallbackOptimizer();
        this.restoreConsoleWarnSuppression();
        this.restoreConsoleGroupSuppression();
        this.restoreConsoleCountSuppression();
        this.restoreConsoleAssertSuppression();
        this.restoreConsoleDirSuppression();
        this.teardownDragAndDrop();
        this.teardownSpellcheckOpt();
        this.teardownReactionSimplifier();
        this.teardownUnreadBadgeKiller();
        this.teardownCanvasSuppressor();
        this.teardownChannelTopicKiller();
        this.teardownFolderAnimationKiller();
        this.teardownFluxThrottle();
        this.teardownInvitePreviewKiller();
        this.teardownMemberListGradient();
        this.teardownMemberFreezer();
        this.teardownUnfocusedFreezer();
        this.teardownVoiceVideoKiller();
        this.teardownWebSocketFloodPreventer();

        this.networkCache.clear();
        this.networkCacheOrder.length = 0;

        resetCacheLimits();
    },

    installConsolidatedObserver() {
        if (typeof MutationObserver === "undefined") return;

        const callbacks = this.observerCallbacks;
        let queued: MutationRecord[] = [];
        let frame = 0;
        const flush = () => {
            frame = 0;
            const records = queued;
            queued = [];
            for (const cb of callbacks.values()) {
                try {
                    cb(records);
                } catch (err) {
                    if (settings.store.verboseLogging) logger.warn("Consolidated observer callback error", err);
                }
            }
        };

        try {
            this.consolidatedObserver = new MutationObserver(records => {
                queued.push(...records);
                if (!frame) frame = requestAnimationFrame(flush);
            });
            this.consolidatedObserver.observe(document.body, { childList: true, subtree: true });
            if (settings.store.verboseLogging) logger.info("Installed consolidated MutationObserver");
        } catch (err) {
            if (settings.store.verboseLogging) logger.warn("Failed to install consolidated observer", err);
            this.consolidatedObserver = null;
        }
    },

    teardownConsolidatedObserver() {
        if (this.consolidatedObserver) {
            this.consolidatedObserver.disconnect();
            this.consolidatedObserver = null;
            this.observerCallbacks.clear();
        }
    },

    installDomThrottle() {
        const delay = settings.store.domThrottleDelay;
        const matches = (el: Element): boolean => {
            const cn = typeof (el as HTMLElement).className === "string" ? (el as HTMLElement).className : "";
            if (!cn) return false;
            for (const tok of THROTTLED_CLASS_TOKENS) if (cn.indexOf(tok) !== -1) return true;
            return false;
        };

        this.domThrottleStyleEl = document.createElement("style");
        this.domThrottleStyleEl.id = "op-dom-throttle";
        this.domThrottleStyleEl.textContent = "[data-op-throttled]{visibility:hidden!important}";
        document.head.appendChild(this.domThrottleStyleEl);

        const timers = this.domThrottleTimers;

        const apply = (el: HTMLElement) => {
            const existing = timers.get(el);
            if (existing !== undefined) {
                clearTimeout(existing);
            }
            el.setAttribute("data-op-throttled", "1");
            const t = setTimeout(() => {
                el.removeAttribute("data-op-throttled");
                timers.delete(el);
            }, delay);
            timers.set(el, t);
        };

        const callback = (records: MutationRecord[]) => {
            for (const r of records) {
                for (const node of r.addedNodes) {
                    if (!(node instanceof HTMLElement)) continue;
                    if (node instanceof HTMLIFrameElement) continue;
                    if (node.querySelector?.("iframe")) continue;
                    if (matches(node)) apply(node);
                }
            }
        };

        if (this.consolidatedObserver) {
            this.observerCallbacks.set("domThrottle", callback);
        } else {
            this.domThrottleObserver = new MutationObserver(callback);
            this.domThrottleObserver.observe(document.body, { childList: true, subtree: true });
        }
    },

    teardownDomThrottle() {
        this.observerCallbacks.delete("domThrottle");
        if (this.domThrottleObserver) {
            this.domThrottleObserver.disconnect();
            this.domThrottleObserver = null;
        }
        for (const t of this.domThrottleTimers.values()) clearTimeout(t);
        this.domThrottleTimers.clear();
        document.querySelectorAll("[data-op-throttled]").forEach(el => el.removeAttribute("data-op-throttled"));
        if (this.domThrottleStyleEl) {
            this.domThrottleStyleEl.remove();
            this.domThrottleStyleEl = null;
        }
    },

    installRafReduction() {
        const skip = settings.store.animationFrameReduction;
        if (skip <= 0) return;
        this.originalRaf = window.requestAnimationFrame.bind(window);
        this.originalCancelRaf = window.cancelAnimationFrame.bind(window);
        const minInterval = 1000 / (60 * (1 - Math.min(skip, 95) / 100));
        let lastFrame = 0;
        window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
            const { originalRaf } = this;
            if (!originalRaf) return 0;
            if (document.activeElement?.closest("[data-slate-editor]")) return originalRaf(cb);
            const id = this.nextRafReductionId++;
            const pending: { raf?: number; timeout?: ReturnType<typeof setTimeout>; } = {};
            this.pendingRafReduction.set(id, pending);
            pending.raf = originalRaf(time => {
                const remaining = minInterval - (time - lastFrame);
                if (remaining <= 0) {
                    this.pendingRafReduction.delete(id);
                    lastFrame = time;
                    cb(time);
                    return;
                }
                pending.timeout = setTimeout(() => {
                    const { originalRaf: raf } = this;
                    if (!raf || !this.pendingRafReduction.has(id)) return;
                    pending.raf = raf(nextTime => {
                        this.pendingRafReduction.delete(id);
                        lastFrame = nextTime;
                        cb(nextTime);
                    });
                }, remaining);
            });
            return id;
        }) as typeof requestAnimationFrame;
        window.cancelAnimationFrame = ((id: number) => {
            const pending = this.pendingRafReduction.get(id);
            if (!pending) return this.originalCancelRaf?.(id);
            if (pending.raf !== undefined) this.originalCancelRaf?.(pending.raf);
            if (pending.timeout !== undefined) clearTimeout(pending.timeout);
            this.pendingRafReduction.delete(id);
        }) as typeof cancelAnimationFrame;
        if (settings.store.verboseLogging) logger.info(`rAF reduction active: target ${Math.round(1000 / minInterval)}fps`);
    },

    restoreRafReduction() {
        for (const pending of this.pendingRafReduction.values()) {
            if (pending.raf !== undefined) this.originalCancelRaf?.(pending.raf);
            if (pending.timeout !== undefined) clearTimeout(pending.timeout);
        }
        this.pendingRafReduction.clear();
        if (this.originalRaf) {
            window.requestAnimationFrame = this.originalRaf;
            this.originalRaf = null;
        }
        if (this.originalCancelRaf) {
            window.cancelAnimationFrame = this.originalCancelRaf;
            this.originalCancelRaf = null;
        }
    },

    installNetworkLayer() {
        const originalFetch = window.fetch.bind(window);
        this.originals.fetch = window.fetch;

        const cacheEnabled = settings.store.networkCache;
        const cacheMs = settings.store.networkCacheMinutes * 60 * 1000;
        const maxEntries = Math.max(10, settings.store.networkCacheMaxEntries | 0);
        const maxBytes = maxEntries * 512 * 1024;
        let cacheBytes = 0;
        const lowQuality = settings.store.forceLowImageQuality;
        const cache = this.networkCache;
        const order = this.networkCacheOrder;
        const isImage = (url: string) => /\.(png|jpe?g|webp)(?:$|[?#])/i.test(url);
        const isDiscordCdn = (url: string) => /(?:cdn|media)\.discord(?:app)?\.(?:com|net)/.test(url);

        const stripCacheBusting = (u: URL) => {
            u.searchParams.delete("v");
            u.searchParams.delete("expires");
            u.searchParams.delete("sig");
        };

        const normalizeCacheKey = (url: string): string => {
            try {
                const u = new URL(url, window.location.origin);
                stripCacheBusting(u);
                return u.toString();
            } catch {
                return url;
            }
        };

        const rewriteSize = (url: string): string => {
            if (!lowQuality || !isDiscordCdn(url)) return url;
            try {
                const u = new URL(url, window.location.origin);
                const size = u.searchParams.get("size");
                if (size && Number(size) > 96) u.searchParams.set("size", "96");
                if (!size && /avatars|emojis|icons|banners/.test(u.pathname)) u.searchParams.set("size", "96");
                return u.toString();
            } catch {
                return url;
            }
        };

        const touch = (key: string) => {
            const idx = order.indexOf(key);
            if (idx !== -1) order.splice(idx, 1);
            order.push(key);
        };
        const evict = () => {
            while (order.length > maxEntries || cacheBytes > maxBytes) {
                const k = order.shift();
                if (!k) return;
                cacheBytes -= cache.get(k)?.bytes ?? 0;
                cache.delete(k);
            }
        };

        window.fetch = function patched(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
            const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
            const finalUrl = rewriteSize(rawUrl);
            const method = init?.method?.toUpperCase() ?? (input instanceof Request ? input.method.toUpperCase() : "GET");
            const useCache = cacheEnabled && isImage(finalUrl) && method === "GET";

            if (useCache) {
                const cacheKey = normalizeCacheKey(finalUrl);
                const hit = cache.get(cacheKey);
                if (hit && Date.now() - hit.timestamp < cacheMs) {
                    touch(cacheKey);
                    return Promise.resolve(hit.response.clone());
                }
                if (hit) {
                    cacheBytes -= hit.bytes;
                    cache.delete(cacheKey);
                    const idx = order.indexOf(cacheKey);
                    if (idx !== -1) order.splice(idx, 1);
                }
            }

            const target: RequestInfo | URL = finalUrl !== rawUrl
                ? (typeof input === "string" ? finalUrl : new Request(finalUrl, input instanceof Request ? input : undefined))
                : input;

            return originalFetch(target, init).then(res => {
                if (useCache && res.ok) {
                    const bytes = Number(res.headers.get("content-length")) || 0;
                    if (bytes > 0 && bytes <= maxBytes) {
                        const cacheKey = normalizeCacheKey(finalUrl);
                        const old = cache.get(cacheKey);
                        if (old) cacheBytes -= old.bytes;
                        cache.set(cacheKey, { response: res.clone(), timestamp: Date.now(), bytes });
                        cacheBytes += bytes;
                        touch(cacheKey);
                        evict();
                    }
                }
                return res;
            });
        };

        if (cacheEnabled) {
            this.cacheCleanupTimer = setInterval(() => {
                const now = Date.now();
                for (const [k, v] of cache) {
                    if (now - v.timestamp > cacheMs) {
                        cacheBytes -= v.bytes;
                        cache.delete(k);
                        const idx = order.indexOf(k);
                        if (idx !== -1) order.splice(idx, 1);
                    }
                }
            }, Math.max(60_000, cacheMs / 2));
        }
    },

    restoreNetworkLayer() {
        if (this.originals.fetch) {
            window.fetch = this.originals.fetch;
            this.originals.fetch = undefined;
        }
        if (this.cacheCleanupTimer !== null) {
            clearInterval(this.cacheCleanupTimer);
            this.cacheCleanupTimer = null;
        }
    },

    installSpringSkip() {
        if (this.springs.length === 0) {
            const mods = findAll(mod => {
                const m = mod as SpringMod;
                return typeof m?.Globals === "object" && typeof m?.Springs === "object";
            }) as SpringMod[];
            this.springs = mods;
        }
        for (const spring of this.springs) {
            spring.Globals?.assign?.({ skipAnimation: true });
        }
    },

    restoreSpringSkip() {
        for (const spring of this.springs) {
            spring.Globals?.assign?.({ skipAnimation: false });
        }
        this.springs = [];
    },

    installMemoryManager() {
        const intervalMs = settings.store.memoryCheckSeconds * 1000;
        const perf = performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number; }; };
        if (!perf.memory) {
            if (settings.store.verboseLogging) logger.info("performance.memory unavailable; memory manager idle");
            return;
        }

        this.memoryTimer = setInterval(() => {
            try {
                const m = perf.memory;
                if (!m) return;
                const ratio = m.usedJSHeapSize / m.jsHeapSizeLimit;
                if (ratio > 0.75) {
                    if (this.networkCache.size > 50) {
                        const half = Math.floor(this.networkCacheOrder.length / 2);
                        for (let i = 0; i < half; i++) {
                            const k = this.networkCacheOrder.shift();
                            if (k) this.networkCache.delete(k);
                        }
                    }
                    if (settings.store.verboseLogging) {
                        logger.info(`Heap ratio ${(ratio * 100).toFixed(1)}% — trimmed caches`);
                    }
                }
            } catch (err) {
                if (settings.store.verboseLogging) logger.warn("Memory pressure check failed", err);
            }
        }, intervalMs);
    },

    teardownMemoryManager() {
        if (this.memoryTimer !== null) {
            clearInterval(this.memoryTimer);
            this.memoryTimer = null;
        }
    },

    installOffscreenMediaPause() {
        if (typeof IntersectionObserver === "undefined") return;
        const paused = this.pausedMedia;

        this.intersectionObserver = new IntersectionObserver(entries => {
            for (const entry of entries) {
                const { target } = entry;
                if (!(target instanceof HTMLMediaElement)) continue;
                if (entry.isIntersecting) {
                    if (paused.has(target)) {
                        paused.delete(target);
                        target.play().catch(() => undefined);
                    }
                } else if (!target.paused) {
                    paused.add(target);
                    target.pause();
                }
            }
        }, { threshold: 0.05 });

        const watch = (root: ParentNode) => {
            const media = root.querySelectorAll("video, audio");
            for (const el of media) this.intersectionObserver?.observe(el);
        };

        watch(document.body);

        const callback = (records: MutationRecord[]) => {
            for (const r of records) {
                for (const node of r.addedNodes) {
                    if (node instanceof HTMLMediaElement) {
                        this.intersectionObserver?.observe(node);
                    } else if (node instanceof Element) {
                        watch(node);
                    }
                }
            }
        };

        if (this.consolidatedObserver) {
            this.observerCallbacks.set("offscreenMedia", callback);
        } else {
            this.mediaMutationObserver = new MutationObserver(callback);
            this.mediaMutationObserver.observe(document.body, { childList: true, subtree: true });
        }
    },

    teardownOffscreenMediaPause() {
        this.observerCallbacks.delete("offscreenMedia");
        if (this.intersectionObserver) {
            this.intersectionObserver.disconnect();
            this.intersectionObserver = null;
        }
        if (this.mediaMutationObserver) {
            this.mediaMutationObserver.disconnect();
            this.mediaMutationObserver = null;
        }
        for (const media of this.pausedMedia) {
            if (media.isConnected) media.play().catch(() => undefined);
        }
        this.pausedMedia.clear();
    },

    installCSSOptimizations() {
        const rules: string[] = [];
        if (settings.store.virtualizeMessages) {
            rules.push("[class*=\"messageListItem_\"] { contain: layout style; }");
        }
        if (settings.store.optimizeTextRendering) {
            rules.push(
                "[class*=\"messageContent_\"], [class*=\"markup_\"] { text-rendering: optimizeSpeed; }",
                "[class*=\"chatContent_\"] { contain: style layout; }"
            );
        }
        if (rules.length) {
            this.optimizerStyleEl = document.createElement("style");
            this.optimizerStyleEl.id = "op-css-optimizations";
            this.optimizerStyleEl.textContent = rules.join("\n");
            document.head.appendChild(this.optimizerStyleEl);
        }
    },

    teardownCSSOptimizations() {
        if (this.optimizerStyleEl) {
            this.optimizerStyleEl.remove();
            this.optimizerStyleEl = null;
        }
    },

    installPassiveListeners() {
        const PASSIVE_EVENTS = ["wheel", "mousewheel", "touchstart", "touchmove", "touchend"];
        const orig = EventTarget.prototype.addEventListener;
        this.originalPassiveListener = orig;
        EventTarget.prototype.addEventListener = function (
            this: EventTarget,
            type: string,
            listener: EventListenerOrEventListenerObject | null,
            options?: boolean | AddEventListenerOptions
        ): void {
            if (PASSIVE_EVENTS.includes(type) && listener != null) {
                if (typeof options === "boolean" || options === undefined) {
                    options = { capture: !!options, passive: true };
                } else if (options.passive === undefined) {
                    options = { ...options, passive: true };
                }
            }
            return orig.call(this, type, listener, options);
        } as typeof EventTarget.prototype.addEventListener;
    },

    restorePassiveListeners() {
        if (this.originalPassiveListener) {
            EventTarget.prototype.addEventListener = this.originalPassiveListener;
            this.originalPassiveListener = null;
        }
    },

    installConsoleSuppression() {
        this.originals.console = {
            log: console.log,
            debug: console.debug,
            info: console.info
        };
        const noop = () => undefined;
        console.log = noop;
        console.debug = noop;
        console.info = noop;
    },

    restoreConsoleSuppression() {
        if (this.originals.console) {
            console.log = this.originals.console.log;
            console.debug = this.originals.console.debug;
            console.info = this.originals.console.info;
            this.originals.console = undefined;
        }
    },

    installResizeObserverThrottle() {
        if (typeof ResizeObserver === "undefined") return;
        const NativeResizeObserver = ResizeObserver;
        const frames = new WeakMap<ResizeObserver, number>();
        const pendingEntries = new WeakMap<ResizeObserver, ResizeObserverEntry[]>();
        this.originalResizeObserver = NativeResizeObserver;

        window.ResizeObserver = class extends NativeResizeObserver {
            constructor(callback: ResizeObserverCallback) {
                super((entries, currentObserver) => {
                    pendingEntries.set(currentObserver, entries);
                    if (frames.has(currentObserver)) return;
                    const frame = requestAnimationFrame(() => {
                        frames.delete(currentObserver);
                        const pending = pendingEntries.get(currentObserver) ?? [];
                        pendingEntries.delete(currentObserver);
                        callback(pending, currentObserver);
                    });
                    frames.set(currentObserver, frame);
                });
            }

            disconnect() {
                const frame = frames.get(this);
                if (frame) {
                    cancelAnimationFrame(frame);
                    frames.delete(this);
                }
                pendingEntries.delete(this);
                super.disconnect();
            }
        };
    },

    restoreResizeObserverThrottle() {
        if (this.originalResizeObserver) {
            window.ResizeObserver = this.originalResizeObserver;
            this.originalResizeObserver = null;
        }
    },

    installGifFreezer() {
        const sharedCanvas = document.createElement("canvas");
        const ctx = sharedCanvas.getContext("2d");
        const blobUrls = this.gifBlobUrls;

        const isAnimated = (img: HTMLImageElement) => /\.gif(?:$|[?#])/i.test(img.src);

        const freeze = (img: HTMLImageElement) => {
            if (!ctx) return;
            if (!isAnimated(img)) return;
            if (this.gifManagedImages.has(img)) return;
            this.gifManagedImages.add(img);

            const originalSrc = img.currentSrc || img.src;
            let frozenUrl: string | null = null;

            const onLoad = () => buildFrozen();
            const onEnter = () => {
                img.dataset.opGifState = "playing";
                img.src = originalSrc;
            };
            const onLeave = () => {
                img.dataset.opGifState = "frozen";
                if (frozenUrl) img.src = frozenUrl;
            };

            const cleanup = () => {
                img.removeEventListener("mouseenter", onEnter);
                img.removeEventListener("mouseleave", onLeave);
                img.removeEventListener("load", onLoad);
                if (frozenUrl) { URL.revokeObjectURL(frozenUrl); blobUrls.delete(frozenUrl); }
                frozenUrl = null;
                this.gifManagedImages.delete(img);
                delete img.dataset.opGifState;
                delete (img as any).__opCleanup;
            };

            // ponytail: Discord CDN gifs are cross-origin without crossorigin set, so toBlob taints and throws — untrack rather than leak listeners on an image we can't freeze
            const buildFrozen = () => {
                if (frozenUrl) return frozenUrl;
                if (!img.naturalWidth || !img.naturalHeight) return null;
                try {
                    sharedCanvas.width = img.naturalWidth;
                    sharedCanvas.height = img.naturalHeight;
                    ctx.clearRect(0, 0, sharedCanvas.width, sharedCanvas.height);
                    ctx.drawImage(img, 0, 0);
                    sharedCanvas.toBlob(b => {
                        if (!b) return;
                        if (frozenUrl) { URL.revokeObjectURL(frozenUrl); blobUrls.delete(frozenUrl); }
                        frozenUrl = URL.createObjectURL(b);
                        blobUrls.add(frozenUrl);
                        if (img.dataset.opGifState !== "playing") img.src = frozenUrl;
                    }, "image/png");
                    return null;
                } catch {
                    cleanup();
                    return null;
                }
            };

            img.dataset.opGifState = "frozen";
            img.addEventListener("mouseenter", onEnter);
            img.addEventListener("mouseleave", onLeave);
            (img as any).__opCleanup = cleanup;

            if (img.complete) buildFrozen(); else img.addEventListener("load", onLoad, { once: true });
        };

        document.querySelectorAll<HTMLImageElement>("img").forEach(freeze);

        const callback = (records: MutationRecord[]) => {
            for (const r of records) {
                for (const node of r.addedNodes) {
                    if (node instanceof HTMLImageElement) freeze(node);
                    else if (node instanceof Element) node.querySelectorAll<HTMLImageElement>("img").forEach(freeze);
                }
            }
        };

        if (this.consolidatedObserver) {
            this.observerCallbacks.set("gifFreezer", callback);
        } else {
            this.gifMutationObserver = new MutationObserver(callback);
            this.gifMutationObserver.observe(document.body, { childList: true, subtree: true });
        }
    },

    teardownGifFreezer() {
        this.observerCallbacks.delete("gifFreezer");
        if (this.gifMutationObserver) {
            this.gifMutationObserver.disconnect();
            this.gifMutationObserver = null;
        }
        document.querySelectorAll<HTMLImageElement>("img").forEach(img => {
            const cleanup = (img as any).__opCleanup;
            if (typeof cleanup === "function") {
                cleanup();
                delete (img as any).__opCleanup;
            }
            delete img.dataset.opGifState;
        });
        for (const url of this.gifBlobUrls) URL.revokeObjectURL(url);
        this.gifBlobUrls.clear();
    },

    installLazyImages() {
        const apply = (img: HTMLImageElement) => {
            if (img.dataset.opLazy === "1") return;
            img.dataset.opLazy = "1";
            if (!img.hasAttribute("loading")) img.loading = "lazy";
            if (!img.hasAttribute("decoding")) img.decoding = "async";
        };
        document.querySelectorAll<HTMLImageElement>("img").forEach(apply);

        const callback = (records: MutationRecord[]) => {
            for (const r of records) {
                for (const node of r.addedNodes) {
                    if (node instanceof HTMLImageElement) apply(node);
                    else if (node instanceof Element) node.querySelectorAll<HTMLImageElement>("img").forEach(apply);
                }
            }
        };

        if (this.consolidatedObserver) {
            this.observerCallbacks.set("lazyImages", callback);
        } else {
            this.lazyImageObserver = new MutationObserver(callback);
            this.lazyImageObserver.observe(document.body, { childList: true, subtree: true });
        }
    },

    teardownLazyImages() {
        this.observerCallbacks.delete("lazyImages");
        if (this.lazyImageObserver) {
            this.lazyImageObserver.disconnect();
            this.lazyImageObserver = null;
        }
    },

    installLazyIframes() {
        if (typeof IntersectionObserver === "undefined") return;

        this.lazyIframeObserver = new IntersectionObserver(entries => {
            for (const entry of entries) {
                const { target } = entry;
                if (!(target instanceof HTMLIFrameElement)) continue;
                if (entry.isIntersecting && target.dataset.opLazyLoad !== "loaded") {
                    target.dataset.opLazyLoad = "loaded";
                    if (target.dataset.src) {
                        target.src = target.dataset.src;
                    }
                }
            }
        }, { threshold: 0 });

        const observeIframe = (iframe: HTMLIFrameElement) => {
            if (iframe.dataset.opLazyLoad) return;
            const src = iframe.src || "";
            if (/\.hcaptcha\.com/i.test(src)) return;
            if (/discord\.com|\.youtube\.com|\.youtu\.be|\.spotify\.com/i.test(src)) return;
            iframe.dataset.opLazyLoad = "pending";
            if (src && !iframe.dataset.src) {
                iframe.dataset.src = src;
                iframe.src = "about:blank";
            }
            this.lazyIframeObserver?.observe(iframe);
        };

        document.querySelectorAll<HTMLIFrameElement>("iframe").forEach(observeIframe);

        const callback = (records: MutationRecord[]) => {
            for (const r of records) {
                for (const node of r.addedNodes) {
                    if (node instanceof HTMLIFrameElement) observeIframe(node);
                    else if (node instanceof Element) node.querySelectorAll<HTMLIFrameElement>("iframe").forEach(observeIframe);
                }
            }
        };

        if (this.consolidatedObserver) {
            this.observerCallbacks.set("lazyIframes", callback);
        } else {
            this.lazyIframeMutationObserver = new MutationObserver(callback);
            this.lazyIframeMutationObserver.observe(document.body, { childList: true, subtree: true });
        }
    },

    teardownLazyIframes() {
        this.observerCallbacks.delete("lazyIframes");
        if (this.lazyIframeObserver) {
            this.lazyIframeObserver.disconnect();
            this.lazyIframeObserver = null;
        }
        if (this.lazyIframeMutationObserver) {
            this.lazyIframeMutationObserver.disconnect();
            this.lazyIframeMutationObserver = null;
        }
        document.querySelectorAll<HTMLIFrameElement>("iframe[data-src]").forEach(iframe => {
            const orig = iframe.dataset.src;
            if (orig) {
                iframe.src = orig;
                delete iframe.dataset.src;
            }
            delete iframe.dataset.opLazyLoad;
        });
    },

    installImageDecodingOptimization() {
        const apply = (img: HTMLImageElement) => {
            if (img.dataset.opDecoding === "1") return;
            img.dataset.opDecoding = "1";
            if (!img.hasAttribute("decoding")) img.decoding = "async";
        };

        document.querySelectorAll<HTMLImageElement>("img").forEach(apply);

        const callback = (records: MutationRecord[]) => {
            for (const r of records) {
                for (const node of r.addedNodes) {
                    if (node instanceof HTMLImageElement) apply(node);
                    else if (node instanceof Element) node.querySelectorAll<HTMLImageElement>("img").forEach(apply);
                }
            }
        };

        if (this.consolidatedObserver) {
            this.observerCallbacks.set("imageDecoding", callback);
        } else {
            this.imageDecodingObserver = new MutationObserver(callback);
            this.imageDecodingObserver.observe(document.body, { childList: true, subtree: true });
        }
    },

    teardownImageDecodingOptimization() {
        this.observerCallbacks.delete("imageDecoding");
        if (this.imageDecodingObserver) {
            this.imageDecodingObserver.disconnect();
            this.imageDecodingObserver = null;
        }
    },

    installExtraCSS() {
        const rules: string[] = [];

        if (settings.store.killBackdropBlur) {
            rules.push(
                "[class*=\"backdrop_\"], [class*=\"layer_\"], [class*=\"popout_\"], [class*=\"modal_\"] { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }"
            );
        }
        if (settings.store.reduceMotion) {
            rules.push(
                "*:not(#vc-smoothtype-caret), *:not(#vc-smoothtype-caret)::before, *:not(#vc-smoothtype-caret)::after { animation-duration: 0.001ms !important; animation-delay: 0ms !important; transition-duration: 0.001ms !important; transition-delay: 0ms !important; }"
            );
        }
        if (settings.store.killWillChange) {
            rules.push(
                "[style*=\"will-change\"], [class*=\"scroller_\"], [class*=\"messageListItem_\"] { will-change: auto !important; }"
            );
        }
        if (settings.store.disableTypingIndicator) {
            rules.push("[class*=\"typing_\"], [class*=\"typingDots_\"] { display: none !important; }");
        }
        if (settings.store.disableAnimatedHeaders) {
            rules.push(
                "[class*=\"header_\"], [class*=\"banner_\"] { animation: none !important; transition: none !important; }"
            );
        }
        if (settings.store.messageContentVisibility) {
            rules.push(
                "[class*=\"messageListItem_\"] { content-visibility: auto; contain-intrinsic-size: 90px; }",
                "[class*=\"scrollerInner_\"] > [class*=\"divider\"] { contain-intrinsic-size: 0; }"
            );
        }
        if (settings.store.suppressEmbedPreviews) {
            rules.push(
                "article[class*=\"embed_\"], [class*=\"embedWrapper_\"], [class*=\"embedFull_\"], [class*=\"embedInner_\"] { display: none !important; }"
            );
        }

        // --- Advanced CSS optimizations ---
        if (settings.store.freezeGifsUntilHover && settings.store.gifFreezeMethod === "css") {
            rules.push(
                "img[src*=\".gif\"]:not([class*=\"emoji\"]):not([data-op-gif-suppressed=\"1\"]) { content-visibility: hidden; }",
                "img[src*=\".gif\"]:not([class*=\"emoji\"]):hover { content-visibility: visible; }"
            );
        }
        if (settings.store.containMemberList) {
            rules.push(
                "[class*=\"members_\"] > [class*=\"member_\"] { content-visibility: auto; contain-intrinsic-size: 48px; }",
                "[class*=\"members_\"] > [class*=\"membersGroup_\"] { content-visibility: auto; contain-intrinsic-size: 32px; }"
            );
        }
        if (settings.store.containServerList) {
            rules.push(
                "[class*=\"guilds_\"] > [class*=\"listItem_\"] { content-visibility: auto; contain-intrinsic-size: 48px; }"
            );
        }
        if (settings.store.hideVoicePanel) {
            rules.push(
                "[class*=\"voicePanel_\"], [class*=\"voiceCall_\"] { display: none !important; }",
                "[class*=\"chatToasts_\"] { display: none !important; }"
            );
        }
        if (settings.store.hideActivityPanel) {
            rules.push(
                "[class*=\"activityPanel_\"], [class*=\"nowPlaying_\"][class*=\"panel_\"], [class*=\"whatsNew_\"][class*=\"panel_\"] { display: none !important; }"
            );
        }
        if (settings.store.hideServerBanner) {
            rules.push(
                "[class*=\"bannerImage_\"], [class*=\"bannerImg_\"] { display: none !important; }",
                "[class*=\"animatedBanner_\"] { display: none !important; }"
            );
        }
        if (settings.store.hideAvatarDecorations) {
            rules.push(
                "[class*=\"avatarDecoration_\"], img[class*=\"decoration_\"], [class*=\"profileEffect_\"], video[src*=\"decorations\"] { display: none !important; }"
            );
        }
        if (settings.store.suppressProfileEffects) {
            rules.push(
                "[class*=\"profileEffects_\"], [class*=\"effect_\"][class*=\"profile_\"], video[class*=\"effect_\"] { display: none !important; }"
            );
        }
        if (settings.store.hideServerBoosting) {
            rules.push(
                "[class*=\"boostBar_\"] { display: none !important; }",
                "[class*=\"boostedGuild_\"] { display: none !important; }"
            );
        }
        if (settings.store.hideNitroUpsell) {
            rules.push(
                "[class*=\"upsell_\"] { display: none !important; }",
                "[class*=\"premiumUpsell_\"], [class*=\"premiumPromo_\"] { display: none !important; }",
                "[href*=\"/shop\"] { display: none !important; }",
                "[data-testid*=\"upsell\"] { display: none !important; }"
            );
        }
        if (settings.store.hideServerGuide) {
            rules.push("[class*=\"homeBanner_\"], [class*=\"serverGuide_\"] { display: none !important; }");
        }
        if (settings.store.hideServerOnboarding) {
            rules.push(
                "[class*=\"onboarding_\"] { display: none !important; }",
                "[class*=\"onboardingStep_\"] { display: none !important; }"
            );
        }
        if (settings.store.hideSoundboardButton) {
            rules.push(
                "[class*=\"soundButton_\"], [class*=\"soundboardButton_\"], button[aria-label*=\"Soundboard\"] { display: none !important; }"
            );
        }
        if (settings.store.hideGiftButton) {
            rules.push(
                "button[aria-label*=\"Send a gift\"], button[aria-label*=\"Gift\"], [class*=\"giftButton_\"], [class*=\"trinketsDecoration_\"] { display: none !important; }"
            );
        }
        if (settings.store.hideStickerButton) {
            rules.push(
                "button[aria-label*=\"Sticker\"], [class*=\"stickerButton_\"], button[class*=\"stickerButton\"] { display: none !important; }"
            );
        }
        if (settings.store.suppressChannelAnimations) {
            rules.push(
                "[class*=\"channel_\"] { animation-duration: 0.001ms !important; transition-duration: 0.001ms !important; }",
                "[class*=\"sidebar_\"] { animation: none !important; transition: none !important; }"
            );
        }
        if (settings.store.suppressUnreadBadgeAnimations) {
            rules.push(
                "[class*=\"unread_\"] { animation: none !important; }",
                "[class*=\"badge_\"]:not([class*=\"mention_\"]) { animation: none !important; transition: none !important; }"
            );
        }
        if (settings.store.suppressMentionBadgeAnimations) {
            rules.push(
                "[class*=\"mention_\"] { animation: none !important; }",
                "[class*=\"badgePulse_\"] { animation: none !important; }"
            );
        }
        if (settings.store.suppressStickerAnimation) {
            rules.push(
                "[class*=\"sticker_\"][class*=\"asset_\"] video { display: none !important; }",
                "[class*=\"sticker_\"][class*=\"asset_\"] img[src*=\"gif\"] { content-visibility: hidden !important; }",
                "[class*=\"stickerResults_\"] video { display: none !important; }"
            );
        }
        if (settings.store.suppressEmbedAutoLoad) {
            rules.push(
                "article[class*=\"embed_\"] img:not([class*=\"emoji\"]) { content-visibility: hidden; }"
            );
        }
        if (settings.store.containForumPosts) {
            rules.push(
                "[class*=\"mainCard_\"] { content-visibility: auto; contain-intrinsic-size: 200px; }"
            );
        }
        if (settings.store.suppressEmojiPickerAnimations) {
            rules.push(
                "[class*=\"emojiPicker_\"] { animation-duration: 0.001ms !important; animation-delay: 0ms !important; transition-duration: 0.001ms !important; transition-delay: 0ms !important; }"
            );
        }
        if (settings.store.killMessageEffects) {
            rules.push(
                "[class*=\"effectsWrapper_\"], [class*=\"effects_\"], [class*=\"messageEffects_\"] { display: none !important; }",
                "canvas[class*=\"effectsCanvas_\"] { display: none !important; }"
            );
        }

        if (settings.store.containDmList) {
            rules.push(
                "[class*=\"privateChannels_\"] [class*=\"channel_\"] { content-visibility: auto; contain-intrinsic-size: 48px; }"
            );
        }
        if (settings.store.containEmbeds) {
            rules.push(
                "article[class*=\"embed_\"] { contain: layout style; }"
            );
        }
        if (settings.store.optimizeToasts) {
            rules.push(
                "[class*=\"toast_\"] { animation: none !important; transition: none !important; }"
            );
        }
        if (settings.store.simplifySpoilers) {
            rules.push(
                "[class*=\"spoilerContent_\"] { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; background: var(--background-primary) !important; }"
            );
        }
        if (settings.store.suppressSkeletonAnimation) {
            rules.push(
                "[class*=\"skeleton_\"], [class*=\"skeletonWave_\"], [class*=\"skeletonContainer_\"] { animation: none !important; }"
            );
        }
        if (settings.store.forceScrollBehavior) {
            rules.push(
                "[class*=\"scroller_\"], [class*=\"scrollingContainer_\"] { scroll-behavior: auto !important; overflow-anchor: none; }"
            );
        }
        if (settings.store.overscrollContain) {
            rules.push(
                "[class*=\"chat_\"], [class*=\"chatContent_\"], [class*=\"scroller_\"], [class*=\"membersWrap_\"], [class*=\"sidebar_\"] { overscroll-behavior: contain; }"
            );
        }
        if (settings.store.disableCSSFilters) {
            rules.push(
                "[class*=\"effects_\"], [class*=\"filter_\"] { filter: none !important; -webkit-filter: none !important; }",
                "[class*=\"backdrop_\"] { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }"
            );
        }
        if (settings.store.disableBoxShadows) {
            rules.push(
                "[class*=\"card_\"], [class*=\"popout_\"], [class*=\"menu_\"] { box-shadow: none !important; }"
            );
        }
        if (settings.store.disableTextShadows) {
            rules.push(
                "[class*=\"text_\"] { text-shadow: none !important; }"
            );
        }
        if (settings.store.containChannelList) {
            rules.push(
                "[class*=\"containerDefault_\"] { content-visibility: auto; contain-intrinsic-size: 40px; }"
            );
        }
        if (settings.store.containSearchResults) {
            rules.push(
                "[class*=\"searchResult_\"] { content-visibility: auto; contain-intrinsic-size: 60px; }"
            );
        }
        if (settings.store.suppressModalAnimations) {
            rules.push(
                "[class*=\"modal_\"] { animation: none !important; transition: none !important; }",
                "[class*=\"layer_\"][class*=\"animating_\"] { animation: none !important; transition: none !important; }"
            );
        }
        if (settings.store.suppressScrollbarAnimations) {
            rules.push(
                "[class*=\"scroller_\"]::-webkit-scrollbar-thumb { transition: none !important; animation: none !important; }"
            );
        }
        if (settings.store.suppressDiscoveryAnimations) {
            rules.push(
                "[class*=\"discovery_\"] { animation-duration: 0.001ms !important; animation-delay: 0ms !important; transition-duration: 0.001ms !important; transition-delay: 0ms !important; }"
            );
        }
        if (settings.store.containGuildList) {
            rules.push(
                "[class*=\"guilds_\"] [class*=\"guild_\"] { content-visibility: auto; contain-intrinsic-size: 48px; }"
            );
        }
        if (settings.store.suppressContextMenuAnimations) {
            rules.push(
                "[class*=\"menu_\"] { animation: none !important; transition: none !important; }",
                "[class*=\"contextMenu_\"] { animation: none !important; }"
            );
        }
        if (settings.store.disableCanvasEffects) {
            rules.push(
                "canvas[class*=\"effects_\"], canvas[class*=\"particles_\"], canvas[class*=\"confetti_\"], canvas[class*=\"sparkle_\"], canvas[class*=\"spriteCanvas_\"] { display: none !important; }"
            );
        }

        if (settings.store.optimizeChatInput) {
            rules.push(
                "[class*=\"channelTextArea_\"], [class*=\"scrollableContainer_\"][class*=\"channelTextArea_\"] { contain: layout style; }",
                "[class*=\"channelTextArea_\"] [class*=\"slateContainer_\"], [class*=\"channelTextArea_\"] [class*=\"textArea_\"] { contain: style; }",
                "[class*=\"channelTextArea_\"] *, [class*=\"channelTextArea_\"] *::before, [class*=\"channelTextArea_\"] *::after { transition: none !important; animation: none !important; }",
                "[data-slate-editor] { contain: style; }",
                "[class*=\"autocomplete_\"], [class*=\"autocompleteInner_\"], [class*=\"autocompleteRow_\"], [class*=\"applicationCommand_\"], [role=\"listbox\"] { contain: none !important; content-visibility: visible !important; }"
            );
        }
        if (settings.store.optimizeLargeAttachments) {
            rules.push(
                "[class*=\"messageAttachment_\"], [class*=\"nonMediaAttachment_\"], [class*=\"fileNameLink_\"] { contain: content; }",
                "[class*=\"messageListItem_\"] pre, [class*=\"messageListItem_\"] [class*=\"codeContainer_\"], [class*=\"messageListItem_\"] [class*=\"hljs\"] { content-visibility: auto; contain-intrinsic-size: auto 400px; contain: content; }",
                "[class*=\"textPreview_\"], [class*=\"codeActionsCodeBlock_\"] { content-visibility: auto; contain-intrinsic-size: auto 300px; }"
            );
        }
        if (settings.store.containAttachmentImages) {
            rules.push(
                "[class*=\"imageContainer_\"], [class*=\"mosaicItem_\"], [class*=\"clickableWrapper_\"][class*=\"imageZoom_\"] { content-visibility: auto; contain-intrinsic-size: auto 300px; contain: content; }",
                "[class*=\"mosaic_\"], [class*=\"gridContainer_\"][class*=\"attachment_\"] { contain: layout style; }"
            );
        }

        if (!rules.length) return;
        this.extraStyleEl = document.createElement("style");
        this.extraStyleEl.id = "op-extra-optimizations";
        this.extraStyleEl.textContent = rules.join("\n");
        document.head.appendChild(this.extraStyleEl);
    },

    teardownExtraCSS() {
        if (this.extraStyleEl) {
            this.extraStyleEl.remove();
            this.extraStyleEl = null;
        }
    },

    installDisableAnimatedEmoji() {
        const isDiscordEmoji = (url: string) => /(?:cdn|media)\.discord(?:app)?\.(?:com|net)\/emojis\//.test(url);
        const rewrite = (img: HTMLImageElement) => {
            const src = img.src || img.currentSrc;
            if (!src) return;
            if (!/\/(?:a_|[0-9]+\.gif)/.test(src)) return;
            if (!isDiscordEmoji(src)) return;
            if (img.dataset.opEmojiStatic === "1") return;
            img.dataset.opEmojiStatic = "1";
            const staticSrc = src.replace(/\.gif(?:\?.*)?$/, ".webp").replace(/(\?.*)?$/, "?size=48&quality=lossless");
            if (staticSrc !== src) img.src = staticSrc;
        };

        document.querySelectorAll<HTMLImageElement>("img[class*=\"emoji\"], img[src*=\"emojis\"]").forEach(rewrite);

        const callback = (records: MutationRecord[]) => {
            for (const r of records) {
                for (const node of r.addedNodes) {
                    if (!(node instanceof Element)) continue;
                    if (node instanceof HTMLImageElement) {
                        if (node.classList.contains("emoji") || node.src.includes("emojis")) rewrite(node);
                    } else {
                        node.querySelectorAll<HTMLImageElement>("img[class*=\"emoji\"], img[src*=\"emojis\"]").forEach(rewrite);
                    }
                }
            }
        };

        if (this.consolidatedObserver) {
            this.observerCallbacks.set("disableAnimatedEmoji", callback);
        } else {
            this.animatedEmojiObserver = new MutationObserver(callback);
            this.animatedEmojiObserver.observe(document.body, { childList: true, subtree: true });
        }
    },

    teardownDisableAnimatedEmoji() {
        this.observerCallbacks.delete("disableAnimatedEmoji");
        if (this.animatedEmojiObserver) {
            this.animatedEmojiObserver.disconnect();
            this.animatedEmojiObserver = null;
        }
    },

    installSuppressGifAutoplay() {
        const cleanups = this.gifAutoplayCleanups;

        const pause = (el: HTMLVideoElement | HTMLImageElement) => {
            if (el.dataset.opGifSuppressed === "1") return;
            const src = el.src || el.currentSrc;
            if (!/\.gif|giphy|tenor|media\.discord/i.test(src) && !(el instanceof HTMLVideoElement)) return;
            el.dataset.opGifSuppressed = "1";

            if (el instanceof HTMLVideoElement && !el.paused) {
                el.pause();
                const onEnter = () => el.play().catch(() => undefined);
                const onLeave = () => el.pause();
                el.addEventListener("mouseenter", onEnter);
                el.addEventListener("mouseleave", onLeave);
                cleanups.set(el, () => {
                    el.removeEventListener("mouseenter", onEnter);
                    el.removeEventListener("mouseleave", onLeave);
                });
            }
        };

        document.querySelectorAll<HTMLVideoElement>("video[src*=\"gif\"], video[src*=\"media.discord\"]").forEach(pause);

        const callback = (records: MutationRecord[]) => {
            for (const r of records) {
                for (const node of r.addedNodes) {
                    if (!(node instanceof Element)) continue;
                    if (node instanceof HTMLVideoElement && /gif|media\.discord/i.test(node.src)) pause(node);
                    else node.querySelectorAll<HTMLVideoElement>("video[src*=\"gif\"], video[src*=\"media.discord\"]").forEach(pause);
                }
            }
        };

        if (this.consolidatedObserver) {
            this.observerCallbacks.set("suppressGifAutoplay", callback);
        } else {
            this.gifAutoplayObserver = new MutationObserver(callback);
            this.gifAutoplayObserver.observe(document.body, { childList: true, subtree: true });
        }
    },

    teardownSuppressGifAutoplay() {
        this.observerCallbacks.delete("suppressGifAutoplay");
        if (this.gifAutoplayObserver) {
            this.gifAutoplayObserver.disconnect();
            this.gifAutoplayObserver = null;
        }
        document.querySelectorAll<HTMLVideoElement>("video[data-op-gif-suppressed]").forEach(video => {
            const cleanup = this.gifAutoplayCleanups.get(video);
            if (cleanup) cleanup();
            delete video.dataset.opGifSuppressed;
        });
        this.gifAutoplayCleanups = new WeakMap();
    },

    installPerfMetricsBlocker() {
        this.originals._perfMark = performance.mark.bind(performance);
        this.originals._perfMeasure = performance.measure.bind(performance);
        performance.mark = markName => ({
            detail: null,
            duration: 0,
            entryType: "mark",
            name: markName,
            startTime: performance.now(),
            toJSON() { return this; }
        });
        performance.measure = measureName => ({
            detail: null,
            duration: 0,
            entryType: "measure",
            name: measureName,
            startTime: performance.now(),
            toJSON() { return this; }
        });
    },

    teardownPerfMetricsBlocker() {
        if (this.originals._perfMark) {
            performance.mark = this.originals._perfMark;
            this.originals._perfMark = undefined;
        }
        if (this.originals._perfMeasure) {
            performance.measure = this.originals._perfMeasure;
            this.originals._perfMeasure = undefined;
        }
    },

    installConsoleTimerBlocker() {
        this.originals._consoleTime = console.time.bind(console);
        this.originals._consoleTimeEnd = console.timeEnd.bind(console);
        this.originals._consoleTimeLog = console.timeLog.bind(console);
        console.time = () => undefined;
        console.timeEnd = () => undefined;
        console.timeLog = () => undefined;
    },

    teardownConsoleTimerBlocker() {
        if (this.originals._consoleTime) {
            console.time = this.originals._consoleTime;
            this.originals._consoleTime = undefined;
        }
        if (this.originals._consoleTimeEnd) {
            console.timeEnd = this.originals._consoleTimeEnd;
            this.originals._consoleTimeEnd = undefined;
        }
        if (this.originals._consoleTimeLog) {
            console.timeLog = this.originals._consoleTimeLog;
            this.originals._consoleTimeLog = undefined;
        }
    },

    installHoverTransitionKiller() {
        const css = "*:not(#vc-smoothtype-caret),*:not(#vc-smoothtype-caret)::before,*:not(#vc-smoothtype-caret)::after{transition-duration:0s!important;transition-delay:0s!important}";
        this.hoverTransitionStyleEl = document.createElement("style");
        this.hoverTransitionStyleEl.id = "op-kill-hover";
        this.hoverTransitionStyleEl.textContent = css;
        document.head.appendChild(this.hoverTransitionStyleEl);
    },

    teardownHoverTransitionKiller() {
        if (this.hoverTransitionStyleEl) {
            this.hoverTransitionStyleEl.remove();
            this.hoverTransitionStyleEl = null;
        }
    },

    installPreconnect() {
        const link = document.createElement("link");
        link.rel = "preconnect";
        link.href = "https://cdn.discordapp.com";
        link.crossOrigin = "anonymous";
        document.head.appendChild(link);
        this.preconnectLink = link;

        const link2 = document.createElement("link");
        link2.rel = "dns-prefetch";
        link2.href = "https://media.discordapp.net";
        document.head.appendChild(link2);
        this.preconnectLink2 = link2;
    },

    teardownPreconnect() {
        if (this.preconnectLink) {
            this.preconnectLink.remove();
            this.preconnectLink = null;
        }
        if (this.preconnectLink2) {
            this.preconnectLink2.remove();
            this.preconnectLink2 = null;
        }
    },

    installCompositingLayers() {
        const css = "[class*=\"scroller_\"][class*=\"content_\"]{contain:content}[class*=\"guilds\"]{contain:layout}[class*=\"membersWrap_\"]{contain:layout}";
        this.compositingStyleEl = document.createElement("style");
        this.compositingStyleEl.id = "op-compositing";
        this.compositingStyleEl.textContent = css;
        document.head.appendChild(this.compositingStyleEl);
    },

    teardownCompositingLayers() {
        if (this.compositingStyleEl) {
            this.compositingStyleEl.remove();
            this.compositingStyleEl = null;
        }
    },

    installIdleCallbackOptimizer() {
        if (typeof MessageChannel === "undefined") {
            if (settings.store.verboseLogging) logger.info("MessageChannel unavailable, skipping idle callback optimizer");
            return;
        }
        this.originalIdleCallback = window.requestIdleCallback.bind(window);
        this.originalCancelIdleCallback = window.cancelIdleCallback.bind(window);
        const channel = new MessageChannel();
        this.rICMessagePort1 = channel.port1;
        this.rICMessagePort = channel.port2;
        const callbacks = new Map<number, { cb: IdleRequestCallback; options?: IdleRequestOptions }>();
        this.rICCallbacks = callbacks;
        let nextId = 1;
        channel.port1.onmessage = () => {
            const now = performance.now();
            const snapshot = Array.from(callbacks.entries());
            callbacks.clear();
            for (const [, entry] of snapshot) {
                try {
                    entry.cb({ didTimeout: true, timeRemaining: () => Math.max(0, 50 - (performance.now() - now)) });
                } catch (err) {
                    if (settings.store.verboseLogging) logger.warn("Idle callback error", err);
                }
            }
        };
        window.requestIdleCallback = ((cb: IdleRequestCallback, options?: IdleRequestOptions) => {
            const id = nextId++;
            callbacks.set(id, { cb, options });
            channel.port2.postMessage(null);
            return id;
        }) as typeof requestIdleCallback;
        window.cancelIdleCallback = ((id: number) => {
            callbacks.delete(id);
        }) as typeof cancelIdleCallback;
    },

    teardownIdleCallbackOptimizer() {
        if (this.originalIdleCallback) {
            window.requestIdleCallback = this.originalIdleCallback;
            this.originalIdleCallback = null;
        }
        if (this.originalCancelIdleCallback) {
            window.cancelIdleCallback = this.originalCancelIdleCallback;
            this.originalCancelIdleCallback = null;
        }
        if (this.rICMessagePort) {
            this.rICMessagePort.close();
            this.rICMessagePort = null;
        }
        if (this.rICMessagePort1) {
            this.rICMessagePort1.onmessage = null;
            this.rICMessagePort1.close();
            this.rICMessagePort1 = null;
        }
        this.rICCallbacks?.clear();
        this.rICCallbacks = null;
    },

    installMessageCacheTrimmer() {
        const minutes = settings.store.limitMessageCacheMinutes || 15;
        const intervalMs = Math.max(60_000, minutes * 60_000);
        const lastActivity = new Map<string, number>();

        const trackActivity = () => {
            const id = SelectedChannelStore?.getChannelId();
            if (id) lastActivity.set(id, Date.now());
        };
        trackActivity();
        FluxDispatcher.subscribe("CHANNEL_SELECT", trackActivity);
        this.cacheTrimActivityHandler = trackActivity;

        this.cacheTrimTimer = setInterval(() => {
            try {
                const cutoff = Date.now() - minutes * 60_000;
                const channels = MessageStore?.getMessages;
                if (!channels || typeof channels !== "function") return;
                const store = (MessageStore as any);
                const allChannels = store._messagesByChannel || (store as any).getMutableAllMessages?.() || {};
                const keys = Object.keys(allChannels);
                let trimmed = 0;
                for (const chId of keys) {
                    const last = lastActivity.get(chId);
                    if (last && last > cutoff) continue;
                    const msgs = allChannels[chId];
                    if (!msgs || typeof msgs.size !== "number" || msgs.size <= 50) continue;
                    // ponytail: pokes MessageStore internals (_messagesByChannel/.slice); will no-op if Discord renames them
                    if (typeof msgs.slice !== "function") continue;
                    const targetSize = Math.max(50, Math.floor(msgs.size * 0.5));
                    if (store._messagesByChannel) {
                        store._messagesByChannel[chId] = msgs.slice(0, targetSize);
                    }
                    trimmed++;
                }
                for (const [chId, last] of lastActivity) {
                    if (last <= cutoff && !allChannels[chId]) lastActivity.delete(chId);
                }
                if (trimmed && settings.store.verboseLogging) {
                    logger.info(`Trimmed ${trimmed} channel message caches`);
                }
            } catch (err) {
                if (settings.store.verboseLogging) logger.warn("Message cache trim failed", err);
            }
        }, intervalMs);
    },

    teardownMessageCacheTrimmer() {
        if (this.cacheTrimTimer !== null) {
            clearInterval(this.cacheTrimTimer);
            this.cacheTrimTimer = null;
        }
        if (this.cacheTrimActivityHandler) {
            FluxDispatcher.unsubscribe("CHANNEL_SELECT", this.cacheTrimActivityHandler);
            this.cacheTrimActivityHandler = null;
        }
    },

    installConcurrentRequestLimiter() {
        const maxConcurrent = settings.store.limitConcurrentRequests;
        if (maxConcurrent <= 0) return;
        const origFetch = window.fetch;
        const queue = this.fetchQueue;
        let active = 0;

        const processQueue = () => {
            while (active < maxConcurrent && queue.length) {
                const item = queue.shift();
                if (!item) break;
                active++;
                origFetch.call(window, item.target, item.init)
                    .then(r => item.resolve(r))
                    .catch(e => item.reject(e))
                    .finally(() => {
                        active--;
                        processQueue();
                    });
            }
        };

        window.fetch = function limitedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
            if (active >= maxConcurrent) {
                return new Promise<Response>((resolve, reject) => {
                    queue.push({ target: input, init, resolve, reject });
                });
            }
            active++;
            return origFetch.call(window, input, init).finally(() => {
                active--;
                processQueue();
            });
        };
        (this as any).__origFetchLimited = origFetch;
        if (settings.store.verboseLogging) logger.info(`Concurrent request limit: ${maxConcurrent}`);
    },

    teardownConcurrentRequestLimiter() {
        const orig = (this as any).__origFetchLimited;
        if (orig) {
            window.fetch = orig;
            (this as any).__origFetchLimited = undefined;
        }
        for (const item of this.fetchQueue) item.reject(new Error("optimizerPremium stopped"));
        this.fetchQueue = [];
    },

    installConsoleWarnSuppression() {
        this.originalConsoleWarn = console.warn.bind(console);
        console.warn = () => undefined;
    },

    restoreConsoleWarnSuppression() {
        if (this.originalConsoleWarn) {
            console.warn = this.originalConsoleWarn;
            this.originalConsoleWarn = null;
        }
    },

    installConsoleGroupSuppression() {
        this.originalConsoleGroup = console.group.bind(console);
        this.originalConsoleGroupEnd = console.groupEnd.bind(console);
        this.originalConsoleGroupCollapsed = console.groupCollapsed.bind(console);
        console.group = () => undefined;
        console.groupEnd = () => undefined;
        console.groupCollapsed = () => undefined;
    },

    restoreConsoleGroupSuppression() {
        if (this.originalConsoleGroup) {
            console.group = this.originalConsoleGroup;
            this.originalConsoleGroup = null;
        }
        if (this.originalConsoleGroupEnd) {
            console.groupEnd = this.originalConsoleGroupEnd;
            this.originalConsoleGroupEnd = null;
        }
        if (this.originalConsoleGroupCollapsed) {
            console.groupCollapsed = this.originalConsoleGroupCollapsed;
            this.originalConsoleGroupCollapsed = null;
        }
    },

    installConsoleCountSuppression() {
        this.originalConsoleCount = console.count.bind(console);
        this.originalConsoleCountReset = console.countReset.bind(console);
        console.count = () => undefined;
        console.countReset = () => undefined;
    },

    restoreConsoleCountSuppression() {
        if (this.originalConsoleCount) {
            console.count = this.originalConsoleCount;
            this.originalConsoleCount = null;
        }
        if (this.originalConsoleCountReset) {
            console.countReset = this.originalConsoleCountReset;
            this.originalConsoleCountReset = null;
        }
    },

    installConsoleAssertSuppression() {
        this.originalConsoleAssert = console.assert.bind(console);
        console.assert = () => undefined;
    },

    restoreConsoleAssertSuppression() {
        if (this.originalConsoleAssert) {
            console.assert = this.originalConsoleAssert;
            this.originalConsoleAssert = null;
        }
    },

    installConsoleDirSuppression() {
        this.originalConsoleDir = console.dir.bind(console);
        this.originalConsoleDirxml = console.dirxml.bind(console);
        console.dir = () => undefined;
        console.dirxml = () => undefined;
    },

    restoreConsoleDirSuppression() {
        if (this.originalConsoleDir) {
            console.dir = this.originalConsoleDir;
            this.originalConsoleDir = null;
        }
        if (this.originalConsoleDirxml) {
            console.dirxml = this.originalConsoleDirxml;
            this.originalConsoleDirxml = null;
        }
    },

    installAnimatedAvatarOptimizer() {
        const isAvatar = (img: HTMLImageElement) => img.matches("img[class*=\"avatar\"]") || img.closest("[class*=\"avatar\"]") !== null;
        const freeze = (img: HTMLImageElement) => {
            if (img.dataset.opAvFrozen === "1") return;
            const src = img.src || img.currentSrc;
            if (!src || !/\/(?:a_|[0-9]+\.gif)/.test(src)) return;
            if (!isAvatar(img)) return;
            img.dataset.opAvFrozen = "1";
            const staticSrc = src.replace(/\.gif(?:\?.*)?$/, ".png").replace(/\?size=\d+/, "?size=80");
            const originalSrc = src;
            img.src = staticSrc;
            const onEnter = () => { img.src = originalSrc; };
            const onLeave = () => { img.src = staticSrc; };
            img.addEventListener("mouseenter", onEnter);
            img.addEventListener("mouseleave", onLeave);
            (img as any).__opAvCleanup = () => {
                img.removeEventListener("mouseenter", onEnter);
                img.removeEventListener("mouseleave", onLeave);
            };
        };

        document.querySelectorAll<HTMLImageElement>("img[class*=\"avatar\"]").forEach(freeze);

        const callback = (records: MutationRecord[]) => {
            for (const r of records) {
                for (const node of r.addedNodes) {
                    if (!(node instanceof Element)) continue;
                    if (node instanceof HTMLImageElement && isAvatar(node)) freeze(node);
                    else node.querySelectorAll<HTMLImageElement>("img[class*=\"avatar\"]").forEach(freeze);
                }
            }
        };

        if (this.consolidatedObserver) {
            this.observerCallbacks.set("freezeAnimatedAvatars", callback);
        } else {
            this.avatarObserver = new MutationObserver(callback);
            this.avatarObserver.observe(document.body, { childList: true, subtree: true });
        }
    },

    teardownAnimatedAvatarOptimizer() {
        this.observerCallbacks.delete("freezeAnimatedAvatars");
        if (this.avatarObserver) {
            this.avatarObserver.disconnect();
            this.avatarObserver = null;
        }
        document.querySelectorAll<HTMLImageElement>("img[data-op-av-frozen]").forEach(img => {
            const cleanup = (img as any).__opAvCleanup;
            if (typeof cleanup === "function") {
                cleanup();
                delete (img as any).__opAvCleanup;
            }
            delete img.dataset.opAvFrozen;
        });
    },

    installAvatarQualityReducer() {
        const isAvatar = (img: HTMLImageElement) => img.matches("img[class*=\"avatar\"]") || img.closest("[class*=\"avatar\"], [class*=\"member\"]") !== null;
        const rewrite = (img: HTMLImageElement) => {
            if (img.dataset.opAvQuality === "1") return;
            const src = img.src || img.currentSrc;
            if (!src.includes("cdn.discord") && !src.includes("media.discord")) return;
            if (!isAvatar(img)) return;
            img.dataset.opAvQuality = "1";
            try {
                const url = new URL(src, window.location.origin);
                const size = url.searchParams.get("size");
                if (!size || Number(size) > 64) url.searchParams.set("size", "64");
                if (url.toString() !== src) img.src = url.toString();
            } catch { /* ignore */ }
        };

        document.querySelectorAll<HTMLImageElement>("img[class*=\"avatar\"], [class*=\"member\"] img").forEach(rewrite);

        const callback = (records: MutationRecord[]) => {
            for (const r of records) {
                for (const node of r.addedNodes) {
                    if (!(node instanceof Element)) continue;
                    if (node instanceof HTMLImageElement && isAvatar(node)) rewrite(node);
                    else node.querySelectorAll<HTMLImageElement>("img[class*=\"avatar\"], [class*=\"member\"] img").forEach(rewrite);
                }
            }
        };

        if (this.consolidatedObserver) {
            this.observerCallbacks.set("avatarQualityReducer", callback);
        } else {
            this.avatarQualityObserver = new MutationObserver(callback);
            this.avatarQualityObserver.observe(document.body, { childList: true, subtree: true });
        }
    },

    teardownAvatarQualityReducer() {
        this.observerCallbacks.delete("avatarQualityReducer");
        if (this.avatarQualityObserver) {
            this.avatarQualityObserver.disconnect();
            this.avatarQualityObserver = null;
        }
    },

    installDragAndDropSuppression() {
        const handler = (e: Event) => {
            e.stopPropagation();
            e.preventDefault();
        };
        document.addEventListener("dragenter", handler, true);
        document.addEventListener("dragover", handler, true);
        document.addEventListener("dragleave", handler, true);
        document.addEventListener("drop", handler, true);
        (this as any).__dndHandler = handler;
        if (settings.store.verboseLogging) logger.info("Drag-and-drop events suppressed");
    },

    teardownDragAndDrop() {
        const handler = (this as any).__dndHandler as EventListener | undefined;
        if (handler) {
            document.removeEventListener("dragenter", handler, true);
            document.removeEventListener("dragover", handler, true);
            document.removeEventListener("dragleave", handler, true);
            document.removeEventListener("drop", handler, true);
            (this as any).__dndHandler = undefined;
        }
    },

    installSpellcheckOpt() {
        const set = (el: Element) => {
            if (el.getAttribute("data-op-nospell") === "1") return;
            if (el.matches("textarea, input, [contenteditable]")) {
                el.setAttribute("spellcheck", "false");
            }
            el.querySelectorAll("textarea, input, [contenteditable]").forEach(child => {
                child.setAttribute("spellcheck", "false");
            });
            el.setAttribute("data-op-nospell", "1");
        };
        document.querySelectorAll("textarea, input, [contenteditable]").forEach(el => el.setAttribute("spellcheck", "false"));
        document.querySelectorAll("body").forEach(set);

        const callback = (records: MutationRecord[]) => {
            for (const r of records) {
                for (const node of r.addedNodes) {
                    if (!(node instanceof Element)) continue;
                    set(node);
                }
            }
        };

        if (this.consolidatedObserver) {
            this.observerCallbacks.set("spellcheckOpt", callback);
        } else {
            this.spellcheckObserver = new MutationObserver(callback);
            this.spellcheckObserver.observe(document.body, { childList: true, subtree: true });
        }
    },

    teardownSpellcheckOpt() {
        this.observerCallbacks.delete("spellcheckOpt");
        if (this.spellcheckObserver) {
            this.spellcheckObserver.disconnect();
            this.spellcheckObserver = null;
        }
        document.querySelectorAll<HTMLElement>("[data-op-nospell]").forEach(el => {
            el.removeAttribute("data-op-nospell");
            el.removeAttribute("spellcheck");
        });
    },

    // --- Extreme performance methods ---

    installVoiceVideoKiller() {
        if (typeof window.RTCPeerConnection === "undefined") return;
        const noop: any = function () { return noopProto; };
        const noopProto = {
            close: () => {},
            createOffer: () => Promise.reject(new Error("Voice disabled")),
            createAnswer: () => Promise.reject(new Error("Voice disabled")),
            setLocalDescription: () => Promise.resolve(),
            setRemoteDescription: () => Promise.resolve(),
            addIceCandidate: () => Promise.resolve(),
            addTrack: () => {},
            removeTrack: () => {},
            getTransceivers: () => [],
            getSenders: () => [],
            getReceivers: () => [],
            connectionState: "closed",
            iceConnectionState: "closed",
            signalingState: "closed",
        };
        const webkitWindow = window as WebkitWindow;
        (window as any).__op_origRtc = window.RTCPeerConnection;
        (window as any).__op_origWebkitRtc = webkitWindow.webkitRTCPeerConnection;
        window.RTCPeerConnection = noop;
        webkitWindow.webkitRTCPeerConnection = noop;
        if (settings.store.verboseLogging) logger.info("Voice/video WebRTC neutered");
    },

    teardownVoiceVideoKiller() {
        const orig = (window as any).__op_origRtc;
        if (orig) {
            window.RTCPeerConnection = orig;
            delete (window as any).__op_origRtc;
        }
        const webkitWindow = window as WebkitWindow;
        const webkitOrig = (window as any).__op_origWebkitRtc;
        if (webkitOrig) {
            webkitWindow.webkitRTCPeerConnection = webkitOrig;
        } else {
            delete webkitWindow.webkitRTCPeerConnection;
        }
        delete (window as any).__op_origWebkitRtc;
    },

    installWebSocketFloodPreventer() {
        const origSend = WebSocket.prototype.send;
        (window as any).__op_origWsSend = origSend;
        const DEDUPE_WINDOW_MS = 50;
        const lastSend = new WeakMap<WebSocket, { data: string; at: number; }>();
        WebSocket.prototype.send = function (data: any) {
            if (typeof data === "string") {
                const now = Date.now();
                const prev = lastSend.get(this);
                if (prev && prev.data === data && now - prev.at < DEDUPE_WINDOW_MS) return;
                lastSend.set(this, { data, at: now });
            }
            return origSend.call(this, data);
        };
        if (settings.store.verboseLogging) logger.info("WebSocket duplicate-frame dedupe active");
    },

    teardownWebSocketFloodPreventer() {
        const orig = (window as any).__op_origWsSend;
        if (orig) {
            WebSocket.prototype.send = orig;
            delete (window as any).__op_origWsSend;
        }
    },

    installFluxThrottle() {
        if (this.fluxThrottleState) return;

        const origDispatch = FluxDispatcher.dispatch.bind(FluxDispatcher);
        const THROTTLED = new Set(["TYPING_START", "TYPING_STOP"]);
        const timers = new Map<string, ReturnType<typeof setTimeout>>();
        const DEBOUNCE_MS = 120;

        const wrappedDispatch = function (payload: { type: string }) {
            if (THROTTLED.has(payload.type)) {
                const existing = timers.get(payload.type);
                if (existing) clearTimeout(existing);
                timers.set(payload.type, setTimeout(() => {
                    timers.delete(payload.type);
                    return origDispatch(payload);
                }, DEBOUNCE_MS));
                return undefined;
            }
            return origDispatch(payload);
        } as typeof FluxDispatcher.dispatch;

        this.fluxThrottleState = { origDispatch, wrappedDispatch, timers };
        FluxDispatcher.dispatch = wrappedDispatch;
    },

    teardownFluxThrottle() {
        const state = this.fluxThrottleState;
        if (state) {
            for (const t of state.timers.values()) clearTimeout(t);
            state.timers.clear();

            if (FluxDispatcher.dispatch === state.wrappedDispatch) {
                FluxDispatcher.dispatch = state.origDispatch;
            }

            this.fluxThrottleState = null;
        }
    },

    installReactionSimplifier() {
        const css = `
[class*="message_"] [class*="reaction_"][class*="reactionBtn_"]{background:none!important;border:none!important;padding:2px 4px!important;min-width:unset!important}
[class*="message_"] [class*="reaction_"][class*="reactionBtn_"]:hover{background:none!important}
[class*="message_"] [class*="reactionCount_"]{font-size:11px!important;font-weight:400!important}
[class*="message_"] [class*="reaction_"][class*="reactionBtn_"] img,[class*="message_"] [class*="reaction_"][class*="reactionBtn_"] [class*="emoji"]{width:14px!important;height:14px!important}
[class*="message_"] [class*="reaction_"][class*="reactionBtn_"]:not(:hover){opacity:.6}
`;
        this.reactionStyleEl = document.createElement("style");
        this.reactionStyleEl.id = "op-simplify-reactions";
        this.reactionStyleEl.textContent = css;
        document.head.appendChild(this.reactionStyleEl);
    },

    teardownReactionSimplifier() {
        if (this.reactionStyleEl) {
            this.reactionStyleEl.remove();
            this.reactionStyleEl = null;
        }
    },

    installUnreadBadgeKiller() {
        const css = `
[class*="sidebar_"] [class*="unread_"]{display:none!important}
[class*="chat_"] [class*="unread_"]{display:none!important}
[class*="sidebar_"] [class*="badge_"][class*="number_"]{display:none!important}
[class*="sidebar_"] [class*="mention_"][class*="badge_"]{display:none!important}
[class*="badgePulse_"]{display:none!important}
[class*="sidebar_"] [class*="unreadPill_"]{display:none!important}
[class*="sidebar_"] [class*="unreadBar_"]{display:none!important}
`;
        this.unreadBadgeEl = document.createElement("style");
        this.unreadBadgeEl.id = "op-kill-badges";
        this.unreadBadgeEl.textContent = css;
        document.head.appendChild(this.unreadBadgeEl);
    },

    teardownUnreadBadgeKiller() {
        if (this.unreadBadgeEl) {
            this.unreadBadgeEl.remove();
            this.unreadBadgeEl = null;
        }
    },

    installCanvasSuppressor() {
        const css = "canvas[class*=\"spriteCanvas_\"],canvas[class*=\"effects_\"],canvas[id*=\"confetti\"]{display:none!important}";
        this.canvasSuppressEl = document.createElement("style");
        this.canvasSuppressEl.id = "op-kill-canvas";
        this.canvasSuppressEl.textContent = css;
        document.head.appendChild(this.canvasSuppressEl);
    },

    teardownCanvasSuppressor() {
        if (this.canvasSuppressEl) {
            this.canvasSuppressEl.remove();
            this.canvasSuppressEl = null;
        }
    },

    installChannelTopicKiller() {
        const css = `
[class*="chatContent_"]>[class*="topic_"]{display:none!important}
[class*="chat_"]>[class*="title_"]>[class*="topic_"]{display:none!important}
[class*="chat_"] [class*="channelTopic_"]{display:none!important}
`;
        this.channelTopicEl = document.createElement("style");
        this.channelTopicEl.id = "op-kill-topic";
        this.channelTopicEl.textContent = css;
        document.head.appendChild(this.channelTopicEl);
    },

    teardownChannelTopicKiller() {
        if (this.channelTopicEl) {
            this.channelTopicEl.remove();
            this.channelTopicEl = null;
        }
    },

    installFolderAnimationKiller() {
        const css = `
[class*="folder_"][class*="expandedFolder_"]{animation:none!important;transition:none!important}
[class*="folderIcon_"]{animation:none!important;transition:none!important}
`;
        this.folderAnimEl = document.createElement("style");
        this.folderAnimEl.id = "op-kill-folder-anim";
        this.folderAnimEl.textContent = css;
        document.head.appendChild(this.folderAnimEl);
    },

    teardownFolderAnimationKiller() {
        if (this.folderAnimEl) {
            this.folderAnimEl.remove();
            this.folderAnimEl = null;
        }
    },

    installInvitePreviewKiller() {
        const css = `
[class*="chat_"] [class*="invite_"]{display:none!important}
[class*="chat_"] [class*="inviteCard_"]{display:none!important}
[class*="chat_"] [class*="wrapper_"][class*="invite_"]{display:none!important}
`;
        this.invitePreviewEl = document.createElement("style");
        this.invitePreviewEl.id = "op-kill-invites";
        this.invitePreviewEl.textContent = css;
        document.head.appendChild(this.invitePreviewEl);
    },

    teardownInvitePreviewKiller() {
        if (this.invitePreviewEl) {
            this.invitePreviewEl.remove();
            this.invitePreviewEl = null;
        }
    },

    installMemberListGradient() {
        const css = `
[class*="members_"]>[class*="member_"]{background:none!important}
[class*="members_"]>[class*="member_"]:hover{background:none!important}
[class*="members_"]>[class*="member_"][class*="selected_"]{background:none!important}
[class*="members_"]>[class*="member_"][class*="focused_"]{background:none!important}
[class*="membersWrap_"]{background:linear-gradient(180deg,var(--background-primary),var(--background-secondary-alt),var(--background-primary))!important;position:relative}
[class*="membersWrap_"]::before{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent 0%,var(--background-modifier-hover) 50%,transparent 100%);pointer-events:none;z-index:0}
[class*="members_"]{position:relative;z-index:1}
`;
        this.memberListGradientEl = document.createElement("style");
        this.memberListGradientEl.id = "op-member-gradient";
        this.memberListGradientEl.textContent = css;
        document.head.appendChild(this.memberListGradientEl);
    },

    teardownMemberListGradient() {
        if (this.memberListGradientEl) {
            this.memberListGradientEl.remove();
            this.memberListGradientEl = null;
        }
    },

    installMemberFreezer() {
        const css = `
[class*="members_"]>[class*="member_"]{contain:paint layout style}
[class*="members_"]>[class*="member_"] *{animation:none!important;transition:none!important}
[class*="members_"]>[class*="membersGroup_"]{contain:paint layout style}
`;
        this.memberFreezeEl = document.createElement("style");
        this.memberFreezeEl.id = "op-freeze-members";
        this.memberFreezeEl.textContent = css;
        document.head.appendChild(this.memberFreezeEl);

        const REFRESH_MS = 3 * 60 * 1000;
        this.memberFreezeTimer = setInterval(() => {
            const el = this.memberFreezeEl;
            if (el && el.parentNode) {
                el.remove();
                this.memberFreezeRefreshTimer = setTimeout(() => {
                    this.memberFreezeRefreshTimer = null;
                    if (this.memberFreezeEl && !this.memberFreezeEl.parentNode) {
                        document.head.appendChild(this.memberFreezeEl);
                    }
                }, 300);
            }
        }, REFRESH_MS);
    },

    teardownMemberFreezer() {
        if (this.memberFreezeTimer !== null) {
            clearInterval(this.memberFreezeTimer);
            this.memberFreezeTimer = null;
        }
        if (this.memberFreezeRefreshTimer !== null) {
            clearTimeout(this.memberFreezeRefreshTimer);
            this.memberFreezeRefreshTimer = null;
        }
        if (this.memberFreezeEl) {
            this.memberFreezeEl.remove();
            this.memberFreezeEl = null;
        }
    },

    installUnfocusedFreezer() {
        const apply = () => {
            if (document.hidden) {
                if (!this.unfocusedFreezeStyleEl) {
                    const el = document.createElement("style");
                    el.id = "op-unfocused-freeze";
                    // play-state:paused freezes running animations in place; they resume (not restart) on refocus
                    el.textContent = "*,*::before,*::after{animation-play-state:paused!important;transition:none!important}";
                    document.head.appendChild(el);
                    this.unfocusedFreezeStyleEl = el;
                }
            } else if (this.unfocusedFreezeStyleEl) {
                this.unfocusedFreezeStyleEl.remove();
                this.unfocusedFreezeStyleEl = null;
            }
        };
        this.unfocusedVisibilityHandler = apply;
        document.addEventListener("visibilitychange", apply);
        apply();
    },

    teardownUnfocusedFreezer() {
        if (this.unfocusedVisibilityHandler) {
            document.removeEventListener("visibilitychange", this.unfocusedVisibilityHandler);
            this.unfocusedVisibilityHandler = null;
        }
        if (this.unfocusedFreezeStyleEl) {
            this.unfocusedFreezeStyleEl.remove();
            this.unfocusedFreezeStyleEl = null;
        }
    },
});
