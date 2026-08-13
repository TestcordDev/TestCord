/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings, migratePluginSettings } from "@api/Settings";
import { resetCacheLimits } from "@utils/cacheLimits";
import { TestcordDevs } from "@utils/constants";
import { classNameToSelector } from "@utils/css";
import { Logger } from "@utils/Logger";
import { escapeRegExp } from "@utils/text";
import definePlugin, { OptionType } from "@utils/types";
import { filters, find, findAll, findByPropsLazy, proxyLazyWebpack } from "@webpack";
import { FluxDispatcher, MessageStore, SelectedChannelStore, showToast, Toasts, useEffect, useRef, useState } from "@webpack/common";

const logger = new Logger("TestcordOptimizer");

// Resolve each class token independently. Discord splits CSS modules across
// builds (e.g. messageListItem in one module, messageContent in another), so a
// single-module lookup silently fails for groups whose tokens stopped sharing a module.
function findCssClassesLazy<S extends string>(...classes: S[]): Record<S, string | undefined> {
    return proxyLazyWebpack(() => {
        const res = {} as Record<S, string | undefined>;
        for (const cls of classes) {
            const mod = find(filters.byClassNames(cls), { isIndirect: true, topLevelOnly: true });
            if (!mod) continue;
            const re = new RegExp(`(?<=^|\\s)${escapeRegExp(cls)}(?:_\\S*)?(?=$|\\s)`);
            const val = Object.values(mod).find(v => typeof v === "string" && re.test(v));
            if (typeof val === "string") res[cls] = val;
        }
        return res;
    }) as Record<S, string | undefined>;
}

const THROTTLED_CLASS_TOKENS = ["activity", "subText", "botText", "clanTag"] as const;

const ChatClasses = findCssClassesLazy("chat", "chatContent");
const TopicClasses = findCssClassesLazy("topic", "title", "channelTopic");
const ScrollerClasses = findCssClassesLazy("scroller", "scrollerInner");
const ScrollingContainerClasses = findCssClassesLazy("scrollingContainer", "content");
const MessageClasses = findCssClassesLazy("messageListItem", "messageContent", "markup");
const AttachmentClasses = findCssClassesLazy("messageAttachment", "nonMediaAttachment", "fileNameLink", "textPreview", "codeActionsCodeBlock");
const CodeClasses = findCssClassesLazy("codeContainer", "hljs");
const EmbedClasses = findCssClassesLazy("embed", "embedFull", "embedInner", "embedWrapper");
const MemberClasses = findCssClassesLazy("members", "membersWrap", "member", "membersGroup");
const SelectedClasses = findCssClassesLazy("selected");
const FocusedClasses = findCssClassesLazy("focused");
const ChannelClasses = findCssClassesLazy("containerDefault", "sidebar");
const GuildClasses = findCssClassesLazy("guilds", "listItem");
const GuildItemClasses = findCssClassesLazy("guild");
const DmClasses = findCssClassesLazy("privateChannels");
const DmChannelClasses = findCssClassesLazy("channel", "interactive", "subtext");
const ChannelTextAreaClasses = findCssClassesLazy("channelTextArea", "scrollableContainer", "slateContainer", "textArea");
const AutocompleteClasses = findCssClassesLazy("autocomplete", "autocompleteInner", "autocompleteRow", "applicationCommand");
const AvatarClasses = findCssClassesLazy("avatar", "avatarDecoration");
const DecorationClasses = findCssClassesLazy("decoration");
const TypingClasses = findCssClassesLazy("typing", "typingDots");
const HeaderClasses = findCssClassesLazy("header", "banner");
const BannerClasses = findCssClassesLazy("bannerImage", "bannerImg", "animatedBanner");
const BadgeClasses = findCssClassesLazy("badge", "number");
const MentionClasses = findCssClassesLazy("mention", "badgePulse");
const UnreadClasses = findCssClassesLazy("unread", "unreadPill", "unreadBar");
const PanelClasses = findCssClassesLazy("activityPanel", "nowPlaying", "panel", "whatsNew");
const VoicePanelClasses = findCssClassesLazy("voicePanel", "voiceCall", "chatToasts");
const BoostClasses = findCssClassesLazy("boostBar", "boostedGuild");
const NitroClasses = findCssClassesLazy("upsell", "premiumUpsell", "premiumPromo");
const ServerGuideClasses = findCssClassesLazy("homeBanner", "serverGuide");
const OnboardingClasses = findCssClassesLazy("onboarding", "onboardingStep");
const SoundboardClasses = findCssClassesLazy("soundButton", "soundboardButton");
const GiftClasses = findCssClassesLazy("giftButton", "trinketsDecoration");
const StickerClasses = findCssClassesLazy("sticker", "stickerButton", "stickerResults");
const StickerAssetClasses = findCssClassesLazy("asset");
const EmojiPickerClasses = findCssClassesLazy("emojiPicker");
const EffectsClasses = findCssClassesLazy("effects", "effectsWrapper", "messageEffects");
const EffectClasses = findCssClassesLazy("effect");
const EffectsCanvasClasses = findCssClassesLazy("effectsCanvas");
const ProfileEffectClasses = findCssClassesLazy("profileEffects", "profileEffect");
const ProfileClasses = findCssClassesLazy("profile");
const ForumClasses = findCssClassesLazy("mainCard");
const SearchClasses = findCssClassesLazy("searchResult");
const LayerClasses = findCssClassesLazy("layer", "animating");
const ModalClasses = findCssClassesLazy("modal", "backdrop", "popout");
const MenuClasses = findCssClassesLazy("menu", "contextMenu");
const ToastClasses = findCssClassesLazy("toast");
const SpoilerClasses = findCssClassesLazy("spoilerContent");
const SkeletonClasses = findCssClassesLazy("skeleton", "skeletonWave", "skeletonContainer");
const DiscoveryClasses = findCssClassesLazy("discovery");
const FolderClasses = findCssClassesLazy("folder", "expandedFolder", "folderIcon");
const InviteClasses = findCssClassesLazy("invite", "inviteCard");
const WrapperClasses = findCssClassesLazy("wrapper");
const ReactionClasses = findCssClassesLazy("reaction", "reactionBtn", "reactionCount");
const MessageAncestorClasses = findCssClassesLazy("message");
const CanvasEffectClasses = findCssClassesLazy("spriteCanvas", "particles", "confetti", "sparkle");
const AttachmentImageClasses = findCssClassesLazy("imageContainer", "mosaic", "mosaicItem", "imageZoom", "clickableWrapper", "gridContainer");
const AttachmentWrapClasses = findCssClassesLazy("attachment");
const FilterClasses = findCssClassesLazy("filter");
const CardClasses = findCssClassesLazy("card");
const TextClasses = findCssClassesLazy("text");

const MemberListStore = findByPropsLazy("getMemberListSections", "getMemberListVersion");

function sel(cls: string | undefined): string {
    if (!cls) return "";
    try {
        return classNameToSelector(cls);
    } catch {
        return "";
    }
}

function orSel(...clses: Array<string | undefined>): string {
    const out: string[] = [];
    for (const c of clses) {
        if (!c) continue;
        try { const s = classNameToSelector(c); if (s) out.push(s); } catch { }
    }
    return out.join(", ");
}

function joinSel(...selectors: Array<string | undefined>): string {
    return selectors.filter((c): c is string => !!c).join(", ");
}

function ruleFor(selectors: string, body: string): string | null {
    const valid = selectors.split(",").map(s => s.trim()).filter(Boolean);
    if (!valid.length) return null;
    return `${valid.join(", ")} { ${body} }`;
}

function hasElementDescendants(node: Element): boolean {
    let child = node.firstElementChild;
    while (child) {
        if (child.childElementCount > 0) return true;
        child = child.nextElementSibling;
    }
    return false;
}

function chatImageSelector(): string {
    return orSel(ScrollerClasses.scrollerInner, MessageClasses.messageListItem);
}

function avatarImgSelector(): string {
    return joinSel(`img${sel(AvatarClasses.avatar)}`, `${sel(MemberClasses.member)} img`);
}

function avatarClosestSelector(): string {
    return orSel(AvatarClasses.avatar, MemberClasses.member);
}

const settings = definePluginSettings({
    domThrottle: {
        type: OptionType.BOOLEAN,
        description: "Defer non-critical visual updates (activity, subText, botText, clan tags) via MutationObserver. The delayed visibility toggle can cause layout shifts with Discord's latest scroller, so off by default.",
        default: false
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
    fastNetwork: {
        type: OptionType.BOOLEAN,
        description: "Block analytics, science and tracing requests at the fetch level to free up connection slots for real Discord API calls. Also deduplicates simultaneous identical requests and preconnects to Discord CDN.",
        default: true,
        restartNeeded: true
    },
    networkCache: {
        type: OptionType.BOOLEAN,
        description: "Cache static image responses (png, jpg, webp) in memory to cut redundant fetches. Bounded by entry count and TTL.",
        default: false
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
        default: false
    },
    memoryManagement: {
        type: OptionType.BOOLEAN,
        description: "Periodically check JS heap pressure and trim caches when usage is high. Requires Chromium performance.memory.",
        default: false
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
        default: false,
        restartNeeded: true
    },
    optimizeEmojiCache: {
        type: OptionType.BOOLEAN,
        description: "Cache repeat emoji-pack getter calls to avoid re-walking emoji lists on every render.",
        default: false,
        restartNeeded: true
    },
    killLoadingSpinner: {
        type: OptionType.BOOLEAN,
        description: "Strip the app loading spinner. It's pretty but it has measurable cost.",
        default: false
    },
    killConfettiCanvas: {
        type: OptionType.BOOLEAN,
        description: "Remove the SpriteCanvas used for confetti, particles and similar visual effects.",
        default: false
    },
    killGatewayAnalytics: {
        type: OptionType.BOOLEAN,
        description: "Drop the analytics flush block that JSON.stringifies the gateway READY payload.",
        default: false
    },
    virtualizeMessages: {
        type: OptionType.BOOLEAN,
        description: "Apply light paint containment to messages. Off by default because Discord's virtualized chat can mis-measure contained rows after updates.",
        default: false
    },
    optimizeTextRendering: {
        type: OptionType.BOOLEAN,
        description: "Apply optimizeSpeed text-rendering on message content. Disabling kerning/ligatures changes line breaks, which changes message heights and can trigger scroll re-anchoring — off by default.",
        default: false
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
        default: false
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
        description: "Coalesce ResizeObserver callbacks via requestAnimationFrame. Can interfere with Discord's virtualized chat measurement after client updates, so it is off by default.",
        default: false,
        restartNeeded: true
    },
    reduceMotion: {
        type: OptionType.BOOLEAN,
        description: "Apply prefers-reduced-motion globally. Disables transitions and CSS animations.",
        default: false
    },
    killWillChange: {
        type: OptionType.BOOLEAN,
        description: "Strip will-change hints Discord scatters around. Reduces GPU memory, but may hurt scroll smoothness on newer Discord builds.",
        default: false
    },
    lazyEmbedImages: {
        type: OptionType.BOOLEAN,
        description: "Use async image decoding and only lazy-load non-chat images so virtualized message rows do not resize late while scrolling.",
        default: false
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
        default: false
    },
    lazyIframes: {
        type: OptionType.BOOLEAN,
        description: "Defer iframe loading until they scroll into view. Reduces initial page load cost. hcaptcha iframes are excluded to prevent breaking verification.",
        default: false
    },
    disableAnimatedHeaders: {
        type: OptionType.BOOLEAN,
        description: "Remove animated gradient effects in header areas. Pure cosmetic, big GPU savings.",
        default: false
    },
    optimizeImageDecoding: {
        type: OptionType.BOOLEAN,
        description: "Force images to decode asynchronously and preload critical images. Chat images are excluded to prevent late-resize scroll jumps.",
        default: false
    },
    throttleMutationObservers: {
        type: OptionType.BOOLEAN,
        description: "Consolidate multiple MutationObservers into a single shared observer with priority dispatch. Batching all mutations at rAF can cause late layout that Discord's scroller doesn't expect — off by default.",
        default: false,
        restartNeeded: true
    },
    suppressReactionAnimations: {
        type: OptionType.BOOLEAN,
        description: "Strip entrance/exit animations from reaction buttons. Those pop/glow transitions cause layout on every reaction add.",
        default: false,
        restartNeeded: true
    },
    messageContentVisibility: {
        type: OptionType.BOOLEAN,
        description: "Apply extra paint containment to message list items without changing virtualized row sizing.",
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
        description: "Apply CSS containment to DM list rows. Off by default — Discord's virtualized DM list uses row-height math in scrollToChannel, and paint containment mis-measures rows so clicking a DM scrolls to the wrong offset. Same root cause as the chat scroller fixes.",
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
        description: "Neutralize Discord's internal performance.mark and performance.measure calls. Reduces GC pressure from constant metric recording. Wrapped safely to not break scroll calculations.",
        default: false
    },
    suppressConsoleTimers: {
        type: OptionType.BOOLEAN,
        description: "Block console.time and console.timeEnd calls. These create internal timer objects even when console output is suppressed.",
        default: false
    },
    killHoverTransitions: {
        type: OptionType.BOOLEAN,
        description: "Remove hover, focus, and active state transitions across the entire client. Eliminates per-mouse-move repaints.",
        default: false
    },
    preconnectDiscordCdn: {
        type: OptionType.BOOLEAN,
        description: "Insert preconnect hints to Discord's CDN on startup. Warms DNS+TLS so the first image load is faster.",
        default: false,
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
    throttleMemberList: {
        type: OptionType.BOOLEAN,
        description: "Batch member list updates. Discord re-renders the whole member list for every presence change in the server; this coalesces those re-renders. Biggest win in large servers.",
        default: true,
        restartNeeded: true
    },
    memberListThrottleMs: {
        type: OptionType.SLIDER,
        description: "Max delay in ms before member list changes appear. Higher values smooth out presence churn more but delay status changes slightly.",
        markers: [50, 100, 150, 250, 500],
        default: 150,
        stickToMarkers: false
    },
    preventAudioResetReload: {
        type: OptionType.BOOLEAN,
        description: "Stop Discord from reloading the whole app when the audio engine resets itself (Krisp errors, audio device failures). Audio may need a voice channel rejoin, but the client no longer reloads mid-session.",
        default: true,
        restartNeeded: true
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
        default: false
    },
    optimizeLargeAttachments: {
        type: OptionType.BOOLEAN,
        description: "Apply containment to text/code file previews so a large txt attachment doesn't repaint the entire message list.",
        default: false
    },
    containAttachmentImages: {
        type: OptionType.BOOLEAN,
        description: "Apply light containment and async decode to attachment image grids. Off by default to avoid virtualized chat height jumps.",
        default: false
    },
    reduceFpsBackground: {
        type: OptionType.BOOLEAN,
        description: "Limit app rendering to a few FPS when the window is in the background.",
        default: false,
    },
    throttlePresence: {
        type: OptionType.BOOLEAN,
        description: "Reduce how often presence/activity updates are sent to the server, saving network requests.",
        default: false,
    },
    limitMsgCache: {
        type: OptionType.BOOLEAN,
        description: "Periodically call the native GC to free message memory.",
        default: false,
    },
    noSoundboardPreview: {
        type: OptionType.BOOLEAN,
        description: "Disable soundboard audio preview on hover.",
        default: false,
        restartNeeded: true
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

/* -------------------------------------------------------------------------- */
/*                       Background RAF throttle (FPS)                        */
/* -------------------------------------------------------------------------- */

let origRAF: typeof requestAnimationFrame | null = null;
let origCancelRAF: typeof cancelAnimationFrame | null = null;
let bgFpsActive = false;
const rafMap = new Map<number, ReturnType<typeof setTimeout>>();
let rafSeq = 0;

function bgFrameIntervalMs(): number {
    return 200;
}

function onVisibilityChange() {
    if (document.hidden) {
        installRafThrottle();
    } else if (document.hasFocus()) {
        uninstallRafThrottle();
    }
}

function onWindowBlur() {
    installRafThrottle();
}

function onWindowFocus() {
    if (!document.hidden) uninstallRafThrottle();
}

function applyBgFpsPatch(enable: boolean) {
    if (enable && !bgFpsActive) {
        bgFpsActive = true;
        document.addEventListener("visibilitychange", onVisibilityChange);
        window.addEventListener("blur", onWindowBlur);
        window.addEventListener("focus", onWindowFocus);
        if (document.hidden || !document.hasFocus()) installRafThrottle();
    } else if (!enable && bgFpsActive) {
        bgFpsActive = false;
        document.removeEventListener("visibilitychange", onVisibilityChange);
        window.removeEventListener("blur", onWindowBlur);
        window.removeEventListener("focus", onWindowFocus);
        uninstallRafThrottle();
    }
}

function installRafThrottle() {
    if (origRAF || !bgFpsActive) return;
    origRAF = window.requestAnimationFrame;
    origCancelRAF = window.cancelAnimationFrame;
    let lastT = 0;

    (window as any).requestAnimationFrame = function (cb: FrameRequestCallback) {
        const id = ++rafSeq;
        const now = performance.now();
        const delay = Math.max(0, bgFrameIntervalMs() - (now - lastT));
        const tId = setTimeout(() => {
            rafMap.delete(id);
            lastT = performance.now();
            cb(performance.now());
        }, delay);
        rafMap.set(id, tId);
        return id;
    };

    window.cancelAnimationFrame = function (id: number) {
        const tId = rafMap.get(id);
        if (tId !== undefined) {
            clearTimeout(tId);
            rafMap.delete(id);
        } else if (origCancelRAF) {
            origCancelRAF(id);
        }
    };
}

function uninstallRafThrottle() {
    if (!origRAF) return;
    window.requestAnimationFrame = origRAF;
    if (origCancelRAF) window.cancelAnimationFrame = origCancelRAF;
    origRAF = null;
    origCancelRAF = null;
    for (const tId of rafMap.values()) clearTimeout(tId);
    rafMap.clear();
}

/* -------------------------------------------------------------------------- */
/*                       Presence update throttle                             */
/* -------------------------------------------------------------------------- */

const PRESENCE_DISPATCH_TYPES = new Set([
    "LOCAL_ACTIVITY_UPDATE",
    "RUNNING_GAMES_CHANGE",
]);

let origFluxDispatch: ((event: any) => unknown) | null = null;
const pendingPresenceDispatch = new Map<string, { event: any; timer: ReturnType<typeof setTimeout>; }>();

function flushPresenceDispatch(type: string) {
    const pending = pendingPresenceDispatch.get(type);
    if (!pending) return;
    pendingPresenceDispatch.delete(type);
    try {
        origFluxDispatch?.call(FluxDispatcher, pending.event);
    } catch (err) {
        logger.warn("flush presence dispatch failed", err);
    }
}

function patchedDispatch(event: any) {
    if (!settings.store.throttlePresence || !event || !PRESENCE_DISPATCH_TYPES.has(event.type)) {
        return origFluxDispatch?.call(FluxDispatcher, event);
    }

    const existing = pendingPresenceDispatch.get(event.type);
    if (existing) clearTimeout(existing.timer);

    const timer = setTimeout(() => flushPresenceDispatch(event.type), 8000);
    pendingPresenceDispatch.set(event.type, { event, timer });
}

function applyPresenceThrottle(enable: boolean) {
    if (enable && !origFluxDispatch) {
        origFluxDispatch = FluxDispatcher.dispatch.bind(FluxDispatcher);
        (FluxDispatcher as any).dispatch = patchedDispatch;
    } else if (!enable && origFluxDispatch) {
        for (const type of Array.from(pendingPresenceDispatch.keys())) {
            const pending = pendingPresenceDispatch.get(type)!;
            clearTimeout(pending.timer);
            try { origFluxDispatch.call(FluxDispatcher, pending.event); } catch { /* ignore */ }
        }
        pendingPresenceDispatch.clear();
        (FluxDispatcher as any).dispatch = origFluxDispatch;
        origFluxDispatch = null;
    }
}

/* -------------------------------------------------------------------------- */
/*                          Cache cleaner (GC)                                */
/* -------------------------------------------------------------------------- */

let cacheCleanerInterval: ReturnType<typeof setInterval> | null = null;

function startCacheCleaner() {
    stopCacheCleaner();
    cacheCleanerInterval = setInterval(() => {
        try {
            if (typeof (window as any).gc === "function") {
                (window as any).gc();
            }
        } catch { /* ignore */ }
    }, 5 * 60 * 1000);
}

function stopCacheCleaner() {
    if (cacheCleanerInterval !== null) {
        clearInterval(cacheCleanerInterval);
        cacheCleanerInterval = null;
    }
}

migratePluginSettings("TestcordOptimizer", "optimizerPremium");

export default definePlugin({
    name: "TestcordOptimizer",
    description: "All-in-one performance suite: webpack patches (tooltip, emoji, spinner, confetti, analytics, reactions, Sentry, member list throttle, audio reset reload prevention), bounded image cache, react-spring skip, offscreen media pause, MutationObserver DOM throttle, CSS containment (messages, members, DMs, embeds, servers, channels, forum, guild list, search), backdrop-blur/sticker/effect/upsell/spoiler/box-shadow/text-shadow/filter/backdrop suppression, lazy images/iframes, rAF reduction, passive listeners, console suppression (log/debug/info/warn/group/count/assert/dir/timers), ResizeObserver throttle, memory manager, GIF freeze (canvas/css), concurrency limit, message cache trimmer, animated avatar freeze, avatar quality reducer, cache limits, idle callback optimizer, drag-and-drop suppression, spellcheck opt-out, overscroll contain, link preview suppress, canvas effects hide, chat input containment (typing lag), large text attachment containment, attachment image grid containment.",
    tags: ["Utility", "Developers", "Performance"],
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
                    match: /this\.state\.shouldShowTooltip!==(\i)/,
                    replace: "this.__open!==$1"
                }
            ]
        },
        {
            find: /\i\.\i\.getAppSpinnerSources\(\)/,
            predicate: () => settings.store.killLoadingSpinner,
            replacement: {
                match: /(\i)=\i\.\i\.getAppSpinnerSources\(\)/,
                replace: "$1=null"
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
            find: "popAnimation=()=>{let{opacity",
            predicate: () => settings.store.suppressReactionAnimations,
            replacement: {
                match: /popAnimation=\(\)=>\{let\{opacity/,
                replace: "popAnimation=()=>{return;let{opacity"
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
        {
            find: "getMemberListVersion(e),members:",
            predicate: () => settings.store.throttleMemberList,
            replacement: {
                match: /\(0,\i\.\i\)\(\[\i\.\i\],\(\)=>\(\{version:\i\.\i\.getMemberListVersion\((\i)\),members:\i\.\i\.getMemberListSections\(\1\)\}\)\)/,
                replace: "$self.useThrottledMemberList($1)"
            }
        },
        {
            find: "AUDIO_RESET:function(){",
            predicate: () => settings.store.preventAudioResetReload,
            replacement: {
                match: /(?<=AUDIO_RESET:function\(\).{0,300}?)location\.reload\(\)/,
                replace: "$self.onAudioReset()"
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
    consolidatedFlushReset: null as (() => void) | null,
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
    fetchQueue: [] as Array<{ target: RequestInfo | URL; init?: RequestInit; resolve: (v: Response) => void; reject: (v: unknown) => void; }>,
    rICMessagePort: null as MessagePort | null,
    rICMessagePort1: null as MessagePort | null,
    rICCallbacks: null as Map<number, { cb: IdleRequestCallback; options?: IdleRequestOptions; }> | null,
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
    deferCssTimer: null as any,
    fluxThrottleState: null as {
        origDispatch: typeof FluxDispatcher.dispatch;
        wrappedDispatch: typeof FluxDispatcher.dispatch;
        timers: Map<string, ReturnType<typeof setTimeout>>;
    } | null,

    start() {
        if (settings.store.verboseLogging) logger.info("Starting optimizer suite");

        if (
            settings.store.domThrottle
            || settings.store.pauseOffscreenMedia
            || settings.store.freezeGifsUntilHover && settings.store.gifFreezeMethod !== "css"
            || settings.store.lazyEmbedImages
            || settings.store.lazyIframes
            || settings.store.optimizeImageDecoding
            || settings.store.disableAnimatedEmoji
            || settings.store.suppressGifAutoplay
            || settings.store.freezeAnimatedAvatars
            || settings.store.reduceAvatarQuality
            || settings.store.disableSpellcheck
        ) {
            try { this.installConsolidatedObserver(); } catch (e) { logger.warn("installConsolidatedObserver failed", e); }
        }
        try { if (settings.store.domThrottle) this.installDomThrottle(); } catch (e) { logger.warn("installDomThrottle failed", e); }
        try { if (settings.store.fastNetwork || settings.store.networkCache || settings.store.forceLowImageQuality) this.installNetworkLayer(); } catch (e) { logger.warn("installNetworkLayer failed", e); }
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
        this.deferCssTimer = (typeof requestIdleCallback === "function"
            ? requestIdleCallback(() => { try { this.installExtraCSS(); } catch (e) { logger.warn("installExtraCSS failed", e); } }, { timeout: 3000 })
            : setTimeout(() => { try { this.installExtraCSS(); } catch (e) { logger.warn("installExtraCSS failed", e); } }, 100));

        if (settings.store.cacheLimitsEnabled) {
            resetCacheLimits();
            if (settings.store.verboseLogging) logger.info("Plugin cache limits active");
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
        if (this.deferCssTimer !== null) {
            if (typeof cancelIdleCallback === "function") cancelIdleCallback(this.deferCssTimer);
            else clearTimeout(this.deferCssTimer);
            this.deferCssTimer = null;
        }
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
        applyBgFpsPatch(false);
        applyPresenceThrottle(false);
        stopCacheCleaner();
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
        const throttle = settings.store.throttleMutationObservers;
        // A MutationRecord holds strong refs to target/addedNodes/removedNodes.
        // requestAnimationFrame is starved while the window is hidden or occluded,
        // so an unbounded queue pins every mutated node - including detached
        // subtrees - for as long as the client stays backgrounded.
        const MAX_QUEUED_RECORDS = 5000;
        let queued: MutationRecord[] = [];
        let frame = 0;
        let flushTimer: ReturnType<typeof setTimeout> | null = null;
        const flush = () => {
            if (frame) { cancelAnimationFrame(frame); frame = 0; }
            if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
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
        this.consolidatedFlushReset = () => {
            if (frame) { cancelAnimationFrame(frame); frame = 0; }
            if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
            queued = [];
        };

        try {
            this.consolidatedObserver = new MutationObserver(records => {
                if (callbacks.size === 0) return;
                if (throttle) {
                    // Spread-push blows the call stack on large record batches.
                    for (const rec of records) queued.push(rec);
                    if (queued.length > MAX_QUEUED_RECORDS) queued.splice(0, queued.length - MAX_QUEUED_RECORDS);
                    if (!frame) frame = requestAnimationFrame(flush);
                    // Fallback drain for when rAF never fires (backgrounded window).
                    if (!flushTimer) flushTimer = setTimeout(flush, 1000);
                } else {
                    for (const cb of callbacks.values()) {
                        try {
                            cb(records);
                        } catch (err) {
                            if (settings.store.verboseLogging) logger.warn("Consolidated observer callback error", err);
                        }
                    }
                }
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
        if (this.consolidatedFlushReset) {
            this.consolidatedFlushReset();
            this.consolidatedFlushReset = null;
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

        const release = (el: Element) => {
            const t = timers.get(el);
            if (t !== undefined) {
                clearTimeout(t);
                timers.delete(el);
            }
        };

        const callback = (records: MutationRecord[]) => {
            for (const r of records) {
                for (const node of r.addedNodes) {
                    if (!(node instanceof HTMLElement)) continue;
                    if (node instanceof HTMLIFrameElement) continue;
                    if (node.querySelector?.("iframe")) continue;
                    if (matches(node)) apply(node);
                }
                for (const node of r.removedNodes) {
                    if (!(node instanceof Element)) continue;
                    release(node);
                    if (timers.size) node.querySelectorAll?.("[data-op-throttled]").forEach(release);
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
        // closest() walks up the whole ancestor chain, and this runs on every single
        // requestAnimationFrame registration — hundreds per frame under React. The answer
        // only changes when focus changes, so cache it against the active element.
        let lastActive: Element | null = null;
        let lastActiveIsEditor = false;
        const isEditorFocused = () => {
            const active = document.activeElement;
            if (active !== lastActive) {
                lastActive = active;
                lastActiveIsEditor = !!active?.closest("[data-slate-editor]");
            }
            return lastActiveIsEditor;
        };
        window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
            const { originalRaf } = this;
            if (!originalRaf) return 0;
            if (isEditorFocused()) return originalRaf(cb);
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

        const { fastNetwork } = settings.store;
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

        const blockedPaths = [
            /\/api\/v\d+\/science\b/,
            /\/api\/v\d+\/tracing\b/,
            /\/api\/v\d+\/logging\b/,
            /\/api\/v\d+\/metrics\b/,
            /\/api\/v\d+\/track\b/,
        ];

        const isBlocked = (url: string): boolean => {
            if (!fastNetwork) return false;
            try {
                const u = new URL(url, window.location.origin);
                return blockedPaths.some(re => re.test(u.pathname));
            } catch {
                return false;
            }
        };

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

        const inflight = new Map<string, Promise<Response>>();

        window.fetch = function patched(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
            const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

            if (isBlocked(rawUrl)) {
                return Promise.resolve(new Response("", { status: 204, headers: { "content-type": "application/json" } }));
            }

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

            if (fastNetwork && method === "GET") {
                const dedupeKey = normalizeCacheKey(finalUrl);
                const existing = inflight.get(dedupeKey);
                if (existing) return existing.then(r => r.clone());
            }

            const target: RequestInfo | URL = finalUrl !== rawUrl
                ? (typeof input === "string" ? finalUrl : new Request(finalUrl, input instanceof Request ? input : undefined))
                : input;

            const promise = originalFetch(target, init).then(res => {
                if (fastNetwork && method === "GET") {
                    inflight.delete(normalizeCacheKey(finalUrl));
                }
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

            if (fastNetwork && method === "GET") {
                inflight.set(normalizeCacheKey(finalUrl), promise);
            }

            return promise;
        };

        if (fastNetwork) {
            for (const href of ["https://cdn.discordapp.com", "https://media.discordapp.net"]) {
                const existing = document.querySelector(`link[rel="preconnect"][href="${href}"]`);
                if (!existing) {
                    const link = document.createElement("link");
                    link.rel = "preconnect";
                    link.href = href;
                    link.crossOrigin = "anonymous";
                    document.head.appendChild(link);
                }
            }
        }

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

        // A media element that scrolls out of the virtualised message list is added to
        // `paused` and only ever removed when it scrolls back in. React then unmounts the
        // row, so it never intersects again and the Set pins the element plus its whole
        // detached ancestor subtree for the rest of the session.
        const release = (el: HTMLMediaElement) => {
            this.intersectionObserver?.unobserve(el);
            paused.delete(el);
        };

        const callback = (records: MutationRecord[]) => {
            for (const r of records) {
                for (const node of r.addedNodes) {
                    if (node instanceof HTMLMediaElement) {
                        this.intersectionObserver?.observe(node);
                    } else if (node instanceof Element && node.querySelector("video, audio")) {
                        watch(node);
                    }
                }
                for (const node of r.removedNodes) {
                    if (node instanceof HTMLMediaElement) release(node);
                    else if (node instanceof Element) node.querySelectorAll<HTMLMediaElement>("video, audio").forEach(release);
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
            const r = ruleFor(sel(MessageClasses.messageListItem), "contain: style");
            if (r) rules.push(r);
        }
        if (settings.store.optimizeTextRendering) {
            const r = ruleFor(orSel(MessageClasses.messageContent, MessageClasses.markup), "text-rendering: optimizeSpeed");
            if (r) rules.push(r);
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

        const release = (img: HTMLImageElement) => {
            const cleanup = (img as any).__opCleanup;
            if (typeof cleanup === "function") cleanup();
        };

        const callback = (records: MutationRecord[]) => {
            for (const r of records) {
                for (const node of r.addedNodes) {
                    if (node instanceof HTMLImageElement) freeze(node);
                    else if (node instanceof Element && node.querySelector("img")) node.querySelectorAll<HTMLImageElement>("img").forEach(freeze);
                }
                for (const node of r.removedNodes) {
                    if (node instanceof HTMLImageElement) release(node);
                    else if (node instanceof Element && node.querySelector?.("img")) node.querySelectorAll<HTMLImageElement>("img").forEach(release);
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
        const chatSel = chatImageSelector();
        const isChatImage = (img: HTMLImageElement) => chatSel ? img.closest(chatSel) !== null : false;
        const apply = (img: HTMLImageElement) => {
            if (img.dataset.opLazy === "1") return;
            img.dataset.opLazy = "1";
            if (!isChatImage(img) && !img.hasAttribute("loading")) img.loading = "lazy";
            if (!isChatImage(img) && !img.hasAttribute("decoding")) img.decoding = "async";
        };
        document.querySelectorAll<HTMLImageElement>("img").forEach(apply);

        const callback = (records: MutationRecord[]) => {
            for (const r of records) {
                for (const node of r.addedNodes) {
                    if (node instanceof HTMLImageElement) apply(node);
                    else if (node instanceof Element && node.querySelector("img")) node.querySelectorAll<HTMLImageElement>("img").forEach(apply);
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
                    else if (node instanceof Element && node.querySelector("iframe")) node.querySelectorAll<HTMLIFrameElement>("iframe").forEach(observeIframe);
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
        const chatSel = chatImageSelector();
        const isChatImage = (img: HTMLImageElement) => chatSel ? img.closest(chatSel) !== null : false;
        const apply = (img: HTMLImageElement) => {
            if (img.dataset.opDecoding === "1") return;
            img.dataset.opDecoding = "1";
            if (!isChatImage(img) && !img.hasAttribute("decoding")) img.decoding = "async";
        };

        document.querySelectorAll<HTMLImageElement>("img").forEach(apply);

        const callback = (records: MutationRecord[]) => {
            for (const r of records) {
                for (const node of r.addedNodes) {
                    if (node instanceof HTMLImageElement) apply(node);
                    else if (node instanceof Element && node.querySelector("img")) node.querySelectorAll<HTMLImageElement>("img").forEach(apply);
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
        const push = (r: string | null) => { if (r) rules.push(r); };

        if (settings.store.killBackdropBlur) {
            push(ruleFor(orSel(ModalClasses.backdrop, LayerClasses.layer, ModalClasses.popout, ModalClasses.modal), "backdrop-filter: none !important; -webkit-backdrop-filter: none !important"));
        }
        if (settings.store.reduceMotion) {
            rules.push(
                "*:not(#vc-smoothtype-caret), *:not(#vc-smoothtype-caret)::before, *:not(#vc-smoothtype-caret)::after { animation-duration: 0.001ms !important; animation-delay: 0ms !important; transition-duration: 0.001ms !important; transition-delay: 0ms !important; }"
            );
        }
        if (settings.store.killWillChange) {
            push(ruleFor(orSel(ScrollerClasses.scroller, MessageClasses.messageListItem), "will-change: auto !important"));
        }
        if (settings.store.disableTypingIndicator) {
            push(ruleFor(orSel(TypingClasses.typing, TypingClasses.typingDots), "display: none !important"));
        }
        if (settings.store.disableAnimatedHeaders) {
            push(ruleFor(orSel(HeaderClasses.header, HeaderClasses.banner), "animation: none !important; transition: none !important"));
        }
        if (settings.store.messageContentVisibility) {
            push(ruleFor(sel(MessageClasses.messageListItem), "contain: style"));
        }
        if (settings.store.suppressEmbedPreviews) {
            const embedSel = sel(EmbedClasses.embed);
            if (embedSel) push(ruleFor(`article${embedSel}`, "display: none !important"));
            push(ruleFor(orSel(EmbedClasses.embedWrapper, EmbedClasses.embedFull, EmbedClasses.embedInner), "display: none !important"));
        }

        // --- Advanced CSS optimizations ---
        if (settings.store.freezeGifsUntilHover && settings.store.gifFreezeMethod === "css") {
            rules.push(
                "img[src*=\".gif\"]:not(.emoji):not([data-op-gif-suppressed=\"1\"]) { content-visibility: hidden; }",
                "img[src*=\".gif\"]:not(.emoji):hover { content-visibility: visible; }"
            );
        }
        if (settings.store.containMemberList) {
            push(ruleFor(`${sel(MemberClasses.members)} > ${sel(MemberClasses.member)}`, "content-visibility: auto; contain-intrinsic-size: 48px"));
            push(ruleFor(`${sel(MemberClasses.members)} > ${sel(MemberClasses.membersGroup)}`, "content-visibility: auto; contain-intrinsic-size: 32px"));
        }
        if (settings.store.containServerList) {
            push(ruleFor(`${sel(GuildClasses.guilds)} > ${sel(GuildClasses.listItem)}`, "content-visibility: auto; contain-intrinsic-size: 48px"));
        }
        if (settings.store.hideVoicePanel) {
            push(ruleFor(orSel(VoicePanelClasses.voicePanel, VoicePanelClasses.voiceCall), "display: none !important"));
            push(ruleFor(sel(VoicePanelClasses.chatToasts), "display: none !important"));
        }
        if (settings.store.hideActivityPanel) {
            push(ruleFor(`${sel(PanelClasses.activityPanel)}, ${sel(PanelClasses.nowPlaying)}${sel(PanelClasses.panel)}, ${sel(PanelClasses.whatsNew)}${sel(PanelClasses.panel)}`, "display: none !important"));
        }
        if (settings.store.hideServerBanner) {
            push(ruleFor(orSel(BannerClasses.bannerImage, BannerClasses.bannerImg), "display: none !important"));
            push(ruleFor(sel(BannerClasses.animatedBanner), "display: none !important"));
        }
        if (settings.store.hideAvatarDecorations) {
            push(ruleFor(`${orSel(AvatarClasses.avatarDecoration, ProfileEffectClasses.profileEffect)}, img${sel(DecorationClasses.decoration)}, video[src*="decorations"]`, "display: none !important"));
        }
        if (settings.store.suppressProfileEffects) {
            push(ruleFor(`${orSel(ProfileEffectClasses.profileEffects, ProfileClasses.profile)}, ${sel(ProfileEffectClasses.profileEffect)}${sel(ProfileClasses.profile)}, video${sel(EffectClasses.effect)}`, "display: none !important"));
        }
        if (settings.store.hideServerBoosting) {
            push(ruleFor(orSel(BoostClasses.boostBar, BoostClasses.boostedGuild), "display: none !important"));
        }
        if (settings.store.hideNitroUpsell) {
            push(ruleFor(sel(NitroClasses.upsell), "display: none !important"));
            push(ruleFor(orSel(NitroClasses.premiumUpsell, NitroClasses.premiumPromo), "display: none !important"));
            rules.push("[href*=\"/shop\"] { display: none !important; }", "[data-testid*=\"upsell\"] { display: none !important; }");
        }
        if (settings.store.hideServerGuide) {
            push(ruleFor(orSel(ServerGuideClasses.homeBanner, ServerGuideClasses.serverGuide), "display: none !important"));
        }
        if (settings.store.hideServerOnboarding) {
            push(ruleFor(orSel(OnboardingClasses.onboarding, OnboardingClasses.onboardingStep), "display: none !important"));
        }
        if (settings.store.hideSoundboardButton) {
            push(ruleFor(`${orSel(SoundboardClasses.soundButton, SoundboardClasses.soundboardButton)}, button[aria-label*="Soundboard"]`, "display: none !important"));
        }
        if (settings.store.hideGiftButton) {
            push(ruleFor(`button[aria-label*="Send a gift"], button[aria-label*="Gift"], ${orSel(GiftClasses.giftButton, GiftClasses.trinketsDecoration)}`, "display: none !important"));
        }
        if (settings.store.hideStickerButton) {
            push(ruleFor(`button[aria-label*="Sticker"], ${sel(StickerClasses.stickerButton)}`, "display: none !important"));
        }
        if (settings.store.suppressChannelAnimations) {
            push(ruleFor(sel(DmChannelClasses.channel), "animation-duration: 0.001ms !important; transition-duration: 0.001ms !important"));
            push(ruleFor(sel(ChannelClasses.sidebar), "animation: none !important; transition: none !important"));
        }
        if (settings.store.suppressUnreadBadgeAnimations) {
            push(ruleFor(sel(UnreadClasses.unread), "animation: none !important"));
            push(ruleFor(`${sel(BadgeClasses.badge)}:not(${sel(MentionClasses.mention)})`, "animation: none !important; transition: none !important"));
        }
        if (settings.store.suppressMentionBadgeAnimations) {
            push(ruleFor(orSel(MentionClasses.mention, MentionClasses.badgePulse), "animation: none !important"));
        }
        if (settings.store.suppressStickerAnimation) {
            push(ruleFor(`${sel(StickerClasses.sticker)}${sel(StickerAssetClasses.asset)} video`, "display: none !important"));
            push(ruleFor(`${sel(StickerClasses.sticker)}${sel(StickerAssetClasses.asset)} img[src*="gif"]`, "content-visibility: hidden !important"));
            push(ruleFor(`${sel(StickerClasses.stickerResults)} video`, "display: none !important"));
        }
        if (settings.store.suppressEmbedAutoLoad) {
            push(ruleFor(`article${sel(EmbedClasses.embed)} img:not(.emoji)`, "content-visibility: hidden"));
        }
        if (settings.store.containForumPosts) {
            push(ruleFor(sel(ForumClasses.mainCard), "content-visibility: auto; contain-intrinsic-size: 200px"));
        }
        if (settings.store.suppressEmojiPickerAnimations) {
            push(ruleFor(sel(EmojiPickerClasses.emojiPicker), "animation-duration: 0.001ms !important; animation-delay: 0ms !important; transition-duration: 0.001ms !important; transition-delay: 0ms !important"));
        }
        if (settings.store.killMessageEffects) {
            push(ruleFor(orSel(EffectsClasses.effectsWrapper, EffectsClasses.effects, EffectsClasses.messageEffects), "display: none !important"));
            push(ruleFor(`canvas${sel(EffectsCanvasClasses.effectsCanvas)}`, "display: none !important"));
        }

        if (settings.store.containDmList) {
            push(ruleFor(`${sel(DmClasses.privateChannels)} ${sel(DmChannelClasses.channel)}`, "contain: style paint"));
        }
        if (settings.store.containEmbeds) {
            push(ruleFor(`article${sel(EmbedClasses.embed)}`, "contain: style paint"));
        }
        if (settings.store.optimizeToasts) {
            push(ruleFor(sel(ToastClasses.toast), "animation: none !important; transition: none !important"));
        }
        if (settings.store.simplifySpoilers) {
            push(ruleFor(sel(SpoilerClasses.spoilerContent), "backdrop-filter: none !important; -webkit-backdrop-filter: none !important; background: var(--background-primary) !important"));
        }
        if (settings.store.suppressSkeletonAnimation) {
            push(ruleFor(orSel(SkeletonClasses.skeleton, SkeletonClasses.skeletonWave, SkeletonClasses.skeletonContainer), "animation: none !important"));
        }
        if (settings.store.forceScrollBehavior) {
            push(ruleFor(orSel(ScrollerClasses.scroller, ScrollingContainerClasses.scrollingContainer), "scroll-behavior: auto !important"));
        }
        if (settings.store.overscrollContain) {
            push(ruleFor(orSel(ChatClasses.chat, ChatClasses.chatContent, ScrollerClasses.scroller, MemberClasses.membersWrap, ChannelClasses.sidebar), "overscroll-behavior: contain"));
        }
        if (settings.store.disableCSSFilters) {
            push(ruleFor(orSel(EffectsClasses.effects, FilterClasses.filter), "filter: none !important; -webkit-filter: none !important"));
            push(ruleFor(sel(ModalClasses.backdrop), "backdrop-filter: none !important; -webkit-backdrop-filter: none !important"));
        }
        if (settings.store.disableBoxShadows) {
            push(ruleFor(orSel(CardClasses.card, ModalClasses.popout, MenuClasses.menu), "box-shadow: none !important"));
        }
        if (settings.store.disableTextShadows) {
            push(ruleFor(sel(TextClasses.text), "text-shadow: none !important"));
        }
        if (settings.store.containChannelList) {
            push(ruleFor(sel(ChannelClasses.containerDefault), "contain: style paint"));
        }
        if (settings.store.containSearchResults) {
            push(ruleFor(sel(SearchClasses.searchResult), "content-visibility: auto; contain-intrinsic-size: 60px"));
        }
        if (settings.store.suppressModalAnimations) {
            push(ruleFor(sel(ModalClasses.modal), "animation: none !important; transition: none !important"));
            push(ruleFor(`${sel(LayerClasses.layer)}${sel(LayerClasses.animating)}`, "animation: none !important; transition: none !important"));
        }
        if (settings.store.suppressScrollbarAnimations) {
            push(ruleFor(`${sel(ScrollerClasses.scroller)}::-webkit-scrollbar-thumb`, "transition: none !important; animation: none !important"));
        }
        if (settings.store.suppressDiscoveryAnimations) {
            push(ruleFor(sel(DiscoveryClasses.discovery), "animation-duration: 0.001ms !important; animation-delay: 0ms !important; transition-duration: 0.001ms !important; transition-delay: 0ms !important"));
        }
        if (settings.store.containGuildList) {
            push(ruleFor(`${sel(GuildClasses.guilds)} ${sel(GuildItemClasses.guild)}`, "content-visibility: auto; contain-intrinsic-size: 48px"));
        }
        if (settings.store.suppressContextMenuAnimations) {
            push(ruleFor(sel(MenuClasses.menu), "animation: none !important; transition: none !important"));
            push(ruleFor(sel(MenuClasses.contextMenu), "animation: none !important"));
        }
        if (settings.store.disableCanvasEffects) {
            push(ruleFor(joinSel(`canvas${sel(EffectsClasses.effects)}`, `canvas${sel(CanvasEffectClasses.particles)}`, `canvas${sel(CanvasEffectClasses.confetti)}`, `canvas${sel(CanvasEffectClasses.sparkle)}`, `canvas${sel(CanvasEffectClasses.spriteCanvas)}`), "display: none !important"));
        }

        if (settings.store.optimizeChatInput) {
            const cta = sel(ChannelTextAreaClasses.channelTextArea);
            if (cta) {
                const sc = sel(ChannelTextAreaClasses.scrollableContainer);
                push(ruleFor(`${cta}, ${sc}${cta}`, "contain: style"));
                push(ruleFor(`${cta} ${sel(ChannelTextAreaClasses.slateContainer)}, ${cta} ${sel(ChannelTextAreaClasses.textArea)}`, "contain: style"));
                push(ruleFor(`${cta} *, ${cta} *::before, ${cta} *::after`, "transition: none !important; animation: none !important"));
            }
            rules.push("[data-slate-editor] { contain: style; }");
            push(ruleFor(orSel(AutocompleteClasses.autocomplete, AutocompleteClasses.autocompleteInner, AutocompleteClasses.autocompleteRow, AutocompleteClasses.applicationCommand) + ", [role=\"listbox\"]", "contain: none !important; content-visibility: visible !important"));
        }
        if (settings.store.optimizeLargeAttachments) {
            push(ruleFor(orSel(AttachmentClasses.messageAttachment, AttachmentClasses.nonMediaAttachment, AttachmentClasses.fileNameLink), "contain: style"));
            const mli = sel(MessageClasses.messageListItem);
            if (mli) {
                push(ruleFor(`${mli} pre, ${mli} ${sel(CodeClasses.codeContainer)}, ${mli} ${sel(CodeClasses.hljs)}`, "contain: style"));
            }
            push(ruleFor(orSel(AttachmentClasses.textPreview, AttachmentClasses.codeActionsCodeBlock), "contain: style"));
        }
        if (settings.store.containAttachmentImages) {
            push(ruleFor(joinSel(sel(AttachmentImageClasses.imageContainer), sel(AttachmentImageClasses.mosaicItem), `${sel(AttachmentImageClasses.clickableWrapper)}${sel(AttachmentImageClasses.imageZoom)}`), "contain: style"));
            push(ruleFor(joinSel(sel(AttachmentImageClasses.mosaic), `${sel(AttachmentImageClasses.gridContainer)}${sel(AttachmentWrapClasses.attachment)}`), "contain: style"));
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

        document.querySelectorAll<HTMLImageElement>("img.emoji, img[src*=\"emojis\"]").forEach(rewrite);

        const callback = (records: MutationRecord[]) => {
            for (const r of records) {
                for (const node of r.addedNodes) {
                    if (!(node instanceof Element)) continue;
                    if (node instanceof HTMLImageElement) {
                        if (node.classList.contains("emoji") || node.src.includes("emojis")) rewrite(node);
                    } else if (node.querySelector("img.emoji, img")) {
                        node.querySelectorAll<HTMLImageElement>("img.emoji, img[src*=\"emojis\"]").forEach(rewrite);
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
                    else if (node.querySelector("video")) node.querySelectorAll<HTMLVideoElement>("video[src*=\"gif\"], video[src*=\"media.discord\"]").forEach(pause);
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
        const rules: string[] = [];
        const sc = `${sel(ScrollerClasses.scroller)}${sel(ScrollingContainerClasses.content)}`;
        if (sc) rules.push(`${sc}{contain:content}`);
        if (GuildClasses.guilds) rules.push(`${sel(GuildClasses.guilds)}{contain:layout}`);
        if (MemberClasses.membersWrap) rules.push(`${sel(MemberClasses.membersWrap)}{contain:layout}`);
        if (!rules.length) return;
        this.compositingStyleEl = document.createElement("style");
        this.compositingStyleEl.id = "op-compositing";
        this.compositingStyleEl.textContent = rules.join("");
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
        const callbacks = new Map<number, { cb: IdleRequestCallback; options?: IdleRequestOptions; }>();
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
        for (const item of this.fetchQueue) item.reject(new Error("TestcordOptimizer stopped"));
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
        const avatarSel = avatarImgSelector();
        const closestSel = avatarClosestSelector();
        const isAvatar = (img: HTMLImageElement) => (avatarSel ? img.matches(avatarSel) : false) || (closestSel ? img.closest(closestSel) !== null : false);
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

        if (avatarSel) document.querySelectorAll<HTMLImageElement>(avatarSel).forEach(freeze);

        const callback = (records: MutationRecord[]) => {
            for (const r of records) {
                for (const node of r.addedNodes) {
                    if (!(node instanceof Element)) continue;
                    if (node instanceof HTMLImageElement && isAvatar(node)) freeze(node);
                    else if (avatarSel && node.querySelector("img")) node.querySelectorAll<HTMLImageElement>(avatarSel).forEach(freeze);
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
        const avatarSel = avatarImgSelector();
        const closestSel = avatarClosestSelector();
        const isAvatar = (img: HTMLImageElement) => (avatarSel ? img.matches(avatarSel) : false) || (closestSel ? img.closest(closestSel) !== null : false);
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

        if (avatarSel) document.querySelectorAll<HTMLImageElement>(avatarSel).forEach(rewrite);

        const callback = (records: MutationRecord[]) => {
            for (const r of records) {
                for (const node of r.addedNodes) {
                    if (!(node instanceof Element)) continue;
                    if (node instanceof HTMLImageElement && isAvatar(node)) rewrite(node);
                    else if (avatarSel && node.querySelector("img")) node.querySelectorAll<HTMLImageElement>(avatarSel).forEach(rewrite);
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
        set(document.body);

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
            close: () => { },
            createOffer: () => Promise.reject(new Error("Voice disabled")),
            createAnswer: () => Promise.reject(new Error("Voice disabled")),
            setLocalDescription: () => Promise.resolve(),
            setRemoteDescription: () => Promise.resolve(),
            addIceCandidate: () => Promise.resolve(),
            addTrack: () => { },
            removeTrack: () => { },
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
        const GATEWAY_CONTROL = /^\{"op":(?:1|2|6|7|11)/;
        WebSocket.prototype.send = function (data: any) {
            if (typeof data === "string" && !GATEWAY_CONTROL.test(data)) {
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
        if (!FluxDispatcher?.dispatch) return;

        const origDispatch = FluxDispatcher.dispatch.bind(FluxDispatcher);
        const THROTTLED = new Set(["TYPING_START", "TYPING_STOP"]);
        const timers = new Map<string, ReturnType<typeof setTimeout>>();
        const DEBOUNCE_MS = 120;

        // TypingStore is keyed by channel and then user, so two people typing in the same
        // channel are not redundant events. Debouncing on the action type alone threw away
        // everyone but the last typer in each window.
        const wrappedDispatch = function (payload: { type: string; channelId?: string; userId?: string; }) {
            if (THROTTLED.has(payload.type)) {
                const key = `${payload.type}\0${payload.channelId ?? ""}\0${payload.userId ?? ""}`;
                const existing = timers.get(key);
                if (existing) clearTimeout(existing);
                timers.set(key, setTimeout(() => {
                    timers.delete(key);
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
        const msg = sel(MessageAncestorClasses.message);
        const reaction = sel(ReactionClasses.reaction);
        const reactionBtn = sel(ReactionClasses.reactionBtn);
        const reactionCount = sel(ReactionClasses.reactionCount);
        if (!msg || !reaction || !reactionBtn) return;
        const base = `${msg} ${reaction}${reactionBtn}`;
        const css = `
${base}{background:none!important;border:none!important;padding:2px 4px!important;min-width:unset!important}
${base}:hover{background:none!important}
${msg} ${reactionCount}{font-size:11px!important;font-weight:400!important}
${base} img,${base} .emoji{width:14px!important;height:14px!important}
${base}:not(:hover){opacity:.6}
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
        const sidebar = sel(ChannelClasses.sidebar);
        const chat = sel(ChatClasses.chat);
        const unread = sel(UnreadClasses.unread);
        const badge = sel(BadgeClasses.badge);
        const number = sel(BadgeClasses.number);
        const mention = sel(MentionClasses.mention);
        const badgePulse = sel(MentionClasses.badgePulse);
        const unreadPill = sel(UnreadClasses.unreadPill);
        const unreadBar = sel(UnreadClasses.unreadBar);
        const rules: string[] = [];
        if (sidebar && unread) rules.push(`${sidebar} ${unread}{display:none!important}`);
        if (chat && unread) rules.push(`${chat} ${unread}{display:none!important}`);
        if (sidebar && badge && number) rules.push(`${sidebar} ${badge}${number}{display:none!important}`);
        if (sidebar && mention && badge) rules.push(`${sidebar} ${mention}${badge}{display:none!important}`);
        if (badgePulse) rules.push(`${badgePulse}{display:none!important}`);
        if (sidebar && unreadPill) rules.push(`${sidebar} ${unreadPill}{display:none!important}`);
        if (sidebar && unreadBar) rules.push(`${sidebar} ${unreadBar}{display:none!important}`);
        if (!rules.length) return;
        this.unreadBadgeEl = document.createElement("style");
        this.unreadBadgeEl.id = "op-kill-badges";
        this.unreadBadgeEl.textContent = rules.join("\n");
        document.head.appendChild(this.unreadBadgeEl);
    },

    teardownUnreadBadgeKiller() {
        if (this.unreadBadgeEl) {
            this.unreadBadgeEl.remove();
            this.unreadBadgeEl = null;
        }
    },

    installCanvasSuppressor() {
        const rules: string[] = [];
        if (CanvasEffectClasses.spriteCanvas) rules.push(`canvas${sel(CanvasEffectClasses.spriteCanvas)}{display:none!important}`);
        if (EffectsClasses.effects) rules.push(`canvas${sel(EffectsClasses.effects)}{display:none!important}`);
        rules.push("canvas[id*=\"confetti\"]{display:none!important}");
        this.canvasSuppressEl = document.createElement("style");
        this.canvasSuppressEl.id = "op-kill-canvas";
        this.canvasSuppressEl.textContent = rules.join("");
        document.head.appendChild(this.canvasSuppressEl);
    },

    teardownCanvasSuppressor() {
        if (this.canvasSuppressEl) {
            this.canvasSuppressEl.remove();
            this.canvasSuppressEl = null;
        }
    },

    installChannelTopicKiller() {
        const chatContent = sel(ChatClasses.chatContent);
        const chat = sel(ChatClasses.chat);
        const title = sel(TopicClasses.title);
        const topic = sel(TopicClasses.topic);
        const channelTopic = sel(TopicClasses.channelTopic);
        const rules: string[] = [];
        if (chatContent && topic) rules.push(`${chatContent}>${topic}{display:none!important}`);
        if (chat && title && topic) rules.push(`${chat}>${title}>${topic}{display:none!important}`);
        if (chat && channelTopic) rules.push(`${chat} ${channelTopic}{display:none!important}`);
        if (!rules.length) return;
        this.channelTopicEl = document.createElement("style");
        this.channelTopicEl.id = "op-kill-topic";
        this.channelTopicEl.textContent = rules.join("\n");
        document.head.appendChild(this.channelTopicEl);
    },

    teardownChannelTopicKiller() {
        if (this.channelTopicEl) {
            this.channelTopicEl.remove();
            this.channelTopicEl = null;
        }
    },

    installFolderAnimationKiller() {
        const folder = sel(FolderClasses.folder);
        const expandedFolder = sel(FolderClasses.expandedFolder);
        const folderIcon = sel(FolderClasses.folderIcon);
        const rules: string[] = [];
        if (folder && expandedFolder) rules.push(`${folder}${expandedFolder}{animation:none!important;transition:none!important}`);
        if (folderIcon) rules.push(`${folderIcon}{animation:none!important;transition:none!important}`);
        if (!rules.length) return;
        this.folderAnimEl = document.createElement("style");
        this.folderAnimEl.id = "op-kill-folder-anim";
        this.folderAnimEl.textContent = rules.join("\n");
        document.head.appendChild(this.folderAnimEl);
    },

    teardownFolderAnimationKiller() {
        if (this.folderAnimEl) {
            this.folderAnimEl.remove();
            this.folderAnimEl = null;
        }
    },

    installInvitePreviewKiller() {
        const chat = sel(ChatClasses.chat);
        const invite = sel(InviteClasses.invite);
        const inviteCard = sel(InviteClasses.inviteCard);
        const wrapper = sel(WrapperClasses.wrapper);
        if (!chat) return;
        const rules: string[] = [];
        if (invite) rules.push(`${chat} ${invite}{display:none!important}`);
        if (inviteCard) rules.push(`${chat} ${inviteCard}{display:none!important}`);
        if (wrapper && invite) rules.push(`${chat} ${wrapper}${invite}{display:none!important}`);
        if (!rules.length) return;
        this.invitePreviewEl = document.createElement("style");
        this.invitePreviewEl.id = "op-kill-invites";
        this.invitePreviewEl.textContent = rules.join("\n");
        document.head.appendChild(this.invitePreviewEl);
    },

    teardownInvitePreviewKiller() {
        if (this.invitePreviewEl) {
            this.invitePreviewEl.remove();
            this.invitePreviewEl = null;
        }
    },

    installMemberListGradient() {
        const members = sel(MemberClasses.members);
        const member = sel(MemberClasses.member);
        const membersWrap = sel(MemberClasses.membersWrap);
        const selected = sel(SelectedClasses.selected);
        const focused = sel(FocusedClasses.focused);
        if (!members || !member || !membersWrap) return;
        const rules: string[] = [
            `${members}>${member}{background:none!important}`,
            `${members}>${member}:hover{background:none!important}`,
        ];
        if (selected) rules.push(`${members}>${member}${selected}{background:none!important}`);
        if (focused) rules.push(`${members}>${member}${focused}{background:none!important}`);
        rules.push(
            `${membersWrap}{background:linear-gradient(180deg,var(--background-primary),var(--background-secondary-alt),var(--background-primary))!important;position:relative}`,
            `${membersWrap}::before{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent 0%,var(--background-modifier-hover) 50%,transparent 100%);pointer-events:none;z-index:0}`,
            `${members}{position:relative;z-index:1}`
        );
        this.memberListGradientEl = document.createElement("style");
        this.memberListGradientEl.id = "op-member-gradient";
        this.memberListGradientEl.textContent = rules.join("\n");
        document.head.appendChild(this.memberListGradientEl);
    },

    teardownMemberListGradient() {
        if (this.memberListGradientEl) {
            this.memberListGradientEl.remove();
            this.memberListGradientEl = null;
        }
    },

    installMemberFreezer() {
        const members = sel(MemberClasses.members);
        const member = sel(MemberClasses.member);
        const membersGroup = sel(MemberClasses.membersGroup);
        if (!members || !member) return;
        const rules: string[] = [
            `${members}>${member}{contain:paint layout style}`,
            `${members}>${member} *{animation:none!important;transition:none!important}`,
        ];
        if (membersGroup) rules.push(`${members}>${membersGroup}{contain:paint layout style}`);
        this.memberFreezeEl = document.createElement("style");
        this.memberFreezeEl.id = "op-freeze-members";
        this.memberFreezeEl.textContent = rules.join("\n");
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

    useThrottledMemberList(guildId: string) {
        const [state, setState] = useState(() => ({
            version: MemberListStore.getMemberListVersion(guildId),
            members: MemberListStore.getMemberListSections(guildId)
        }));
        const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
        useEffect(() => {
            const read = () => setState({
                version: MemberListStore.getMemberListVersion(guildId),
                members: MemberListStore.getMemberListSections(guildId)
            });
            const onChange = () => {
                if (timer.current !== undefined) clearTimeout(timer.current);
                timer.current = setTimeout(read, settings.store.memberListThrottleMs);
            };
            MemberListStore.addChangeListener(onChange);
            return () => {
                if (timer.current !== undefined) clearTimeout(timer.current);
                timer.current = undefined;
                MemberListStore.removeChangeListener(onChange);
            };
        }, [guildId]);
        return state;
    },

    onAudioReset() {
        logger.warn("Audio engine reset, skipped Discord's auto reload");
        showToast("Audio engine reset, skipped reload", Toasts.Type.MESSAGE);
    }
});
