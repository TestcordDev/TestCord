/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { Logger } from "@utils/Logger";
import type * as t from "@vencord/discord-types";
import { _resolveReady, filters, findByCodeLazy, findByProps, findByPropsLazy, findLazy, mapMangledModule, mapMangledModuleLazy, proxyLazyWebpack, waitFor } from "@webpack";
import type * as TSPattern from "ts-pattern";

const logger = new Logger("WebpackCommon");

export let FluxDispatcher: t.FluxDispatcher;
waitFor(["dispatch", "subscribe"], m => {
    FluxDispatcher = m;
    // Non import access to avoid circular dependency.
    // Deferred because the Vencord global may not be assigned yet when
    // this waitFor fires during webpack patching (before the IIFE returns).
    queueMicrotask(() => Vencord?.Plugins?.subscribeAllPluginsFluxEvents?.(m));

    const cb = () => {
        m.unsubscribe("CONNECTION_OPEN", cb);
        _resolveReady();
    };
    m.subscribe("CONNECTION_OPEN", cb);
});

export let ComponentDispatch: any;
waitFor(["dispatchToLastSubscribed"], m => ComponentDispatch = m);

export const Constants: t.Constants = mapMangledModuleLazy('ME:"/users/@me"', {
    Endpoints: filters.byProps("USER", "ME"),
    UserFlags: filters.byProps("STAFF", "SPAMMER"),
    FriendsSections: m => m.PENDING === "PENDING" && m.ADD_FRIEND
});

export const RestAPI: t.RestAPI = findLazy(m => typeof m === "object" && m.del && m.put);
export const moment: typeof import("moment") = findByPropsLazy("parseTwoDigitYear");

export const useDrag = findByCodeLazy("useDrag::spec.begin was deprecated");
// you cant make a better finder i love that they remove display names sm
export const useDrop = findByCodeLazy(".disconnectDropTarget()", ".dropTargetOptions=");

export const { match, P }: { match: typeof TSPattern["match"], P: typeof TSPattern["P"]; } = mapMangledModuleLazy("@ts-pattern/matcher", {
    match: filters.byCode("return new"),
    P: filters.byProps("when")
});

export const lodash: typeof import("lodash") = findByPropsLazy("debounce", "cloneDeep");

export const i18n = mapMangledModuleLazy(['defaultLocale:"en-US"', /initialLocale:\i/], {
    t: m => m?.[Symbol.toStringTag] === "IntlMessagesProxy",
    intl: m => m != null && Object.getPrototypeOf(m)?.withFormatters != null
}, true);

export let SnowflakeUtils: t.SnowflakeUtils;
waitFor(["fromTimestamp", "extractTimestamp"], m => SnowflakeUtils = m);

export let Parser: t.Parser;
waitFor("parseTopic", m => Parser = m);
export let Alerts: t.Alerts;
waitFor(["show", "close"], m => Alerts = m);

// `as const` keeps `Toasts.Type.SUCCESS` a literal type, so it stays assignable to the
// `ToastType` union that `showToast` takes. Without it these widen to `string` and every
// call site errors.
const ToastType = {
    MESSAGE: "message",
    SUCCESS: "success",
    FAILURE: "failure",
    CUSTOM: "custom",
    CLIP: "clip",
    LINK: "link",
    FORWARD: "forward",
    BOOKMARK: "bookmark",
    CLOCK: "clock"
} as const;

type ToastTypeValue = (typeof ToastType)[keyof typeof ToastType];

const ToastPosition = {
    TOP: 0,
    BOTTOM: 1
} as const;

export interface ToastData {
    message: string,
    id?: string,
    /**
     * Toasts.Type
     */
    type?: string,
    options?: ToastOptions;
}

export interface ToastOptions {
    /**
     * Toasts.Position
     */
    position?: number;
    component?: React.ReactNode,
    duration?: number;
}

interface ToastsExports {
    showToast: (data: any) => void;
    popToast(context?: string): void;
    createToast?: (...args: any[]) => any;
}

let cachedToasts: ToastsExports | undefined;
let cachedCreateToast: ((...args: any[]) => any) | undefined;
let probedCreateToast = false;
let cachedCreateToastPositional = false;
let lastToastLookupFailed = 0;
// tracks the last id passed to show(), so progress toasts that re-show their id
// replace the visible toast instead of queueing behind it (the new store has no
// per-id update and queues every repeat)
let lastShownToastId: string | undefined;

function hasShowToast(mod: any): mod is ToastsExports {
    return typeof mod?.showToast === "function";
}

// the pair is only exported together by Discord's own toast module
function isToastsModule(mod: any): mod is ToastsExports {
    return hasShowToast(mod) && typeof mod.popToast === "function";
}

// Discord's legacy normaliser. It shipped inside the toast module on some builds and
// in a module of its own on others; current builds export no createToast at all, so
// this is only a fallback for older branches. The code anchor resolves to a lazy
// proxy that looks callable even when the find fails, so it gets probed instead of
// trusted.
function resolveCreateToast(mod: ToastsExports): ((...args: any[]) => any) | undefined {
    if (typeof mod.createToast === "function") return mod.createToast;
    if (probedCreateToast) return cachedCreateToast;

    probedCreateToast = true;
    try {
        const byCode = findByCodeLazy('variant:"default",icon:', ".duration");
        // builds taking (message, type, options) answer the object probe with a
        // non-string text, older ones answer the positional probe with junk, so
        // try both before rejecting the normaliser
        let probe: { text?: unknown } | undefined;
        try { probe = byCode("", "message"); } catch { /* wrong shape */ }
        if (typeof probe?.text === "string") {
            cachedCreateToast = byCode;
            cachedCreateToastPositional = true;
        } else {
            try { probe = byCode({ message: "", type: "message" }); } catch { /* wrong shape */ }
            if (typeof probe?.text === "string") cachedCreateToast = byCode;
        }
    } catch {
        // no normaliser in this build, the legacy payload is all there is
    }
    return cachedCreateToast;
}

// Current builds have no createToast at all, so the legacy payload would reach the
// store unchanged and the new renderer (variant/text/icon layout) would draw an
// empty pill. Map the legacy surface onto the store entry ourselves, mirroring
// what Discord's own callers pass: {text, variant: "success"|"critical",
// duration, position: "top"|"bottom"}.
function toModernEntry(data: ToastData): Record<string, unknown> {
    const entry: Record<string, unknown> = {
        text: data.message,
        position: data.options?.position === ToastPosition.BOTTOM ? "bottom" : "top"
    };
    if (typeof data.options?.duration === "number") entry.duration = data.options.duration;
    if (data.type === "success") entry.variant = "success";
    else if (data.type === "failure") entry.variant = "critical";
    // MESSAGE and the other custom types keep the default (icon-less) pill;
    // "failure" maps to "critical" so it gets Discord's red styling and icon
    const component = data.options?.component;
    if (component != null) entry.__dangerouslyRenderContent = () => component;
    return entry;
}

// builds that ship createToast want a normalised entry and ignore message/type/id
function normalizeToast(data: ToastData, mod: ToastsExports): any {
    // already a normalised entry (no legacy message) — pass through
    if (data.message == null && typeof (data as { text?: unknown }).text === "string") return data;

    const create = resolveCreateToast(mod);
    if (create) {
        // the probe records which shape answers with a string text. create.length
        // is not read: property reads on the lazy proxy throw in some builds.
        const shapes = cachedCreateToastPositional ? ["positional", "object"] : ["object", "positional"];
        for (const shape of shapes) {
            try {
                const normalized = shape === "positional"
                    ? create(data.message, data.type, data.options)
                    : create(data);
                if (normalized != null && typeof normalized === "object" && typeof normalized.text === "string") {
                    // progress toasts re-show the same id to update in place
                    if (data.id) normalized.id = data.id;
                    return normalized;
                }
            } catch {
                // wrong shape, try the other one
            }
        }
    }

    // no normaliser in this build: map the legacy payload to the store entry
    // instead of passing it through
    return toModernEntry(data);
}

// a miss is never cached, since the module may simply not be loaded yet
function resolveToasts(): ToastsExports | undefined {
    if (cachedToasts) return cachedToasts;

    // resolving walks the whole module cache, so don't retry on every call
    const now = Date.now();
    if (now - lastToastLookupFailed < 250) return undefined;
    lastToastLookupFailed = now;

    try {
        const byProps = findByProps("showToast", "popToast");
        if (hasShowToast(byProps)) return (cachedToasts = byProps);

        const byCode = mapMangledModule(".currentToastMap.has(", {
            showToast: filters.byCode(".currentToastMap.has("),
            popToast: filters.byCode(".delete(")
        });
        if (hasShowToast(byCode)) return (cachedToasts = byCode);
    } catch {
        // dev builds throw out of findModuleId when an anchor is missing
    }

    logger.warn("Failed to find Discord's toast module. This toast cannot be shown.");
    return undefined;
}

// resolves the moment the module loads, so startup toasts aren't dropped
waitFor(isToastsModule, mod => {
    cachedToasts = mod;
});

export function createToast(message: string, type: string, options?: ToastOptions): ToastData {
    return {
        message,
        id: Toasts.genId(),
        type,
        options
    };
}

/**
 * Testcord keeps the legacy `{message, type, options}` toast surface on top of Discord's
 * normalised entry point. Upstream replaced this with the newer store shape, but
 * `Toasts.genId()` is used pervasively across the plugin and settings code and has no
 * equivalent there, so both shapes stay exported.
 */
export const Toasts = {
    Type: ToastType,
    Position: ToastPosition,
    genId: () => (Math.random() || Math.random()).toString(36).slice(2),

    show(data: ToastData) {
        const toasts = resolveToasts();
        if (!toasts) return;
        // a repeat of the same id replaces the visible toast (progress toasts);
        // the new store queues every show, so pop the previous one first
        if (data.id && data.id === lastShownToastId) toasts.popToast?.();
        lastShownToastId = data.id;
        toasts.showToast(normalizeToast(data, toasts));
    },
    pop() {
        resolveToasts()?.popToast?.();
    },
    create: createToast
};

/**
 * Show a simple toast. If you need more options, use Toasts.show manually
 */
export function showToast(data: t.ToastData): void;
export function showToast(message: string, type?: ToastTypeValue, options?: ToastOptions): void;
export function showToast(messageOrData: string | t.ToastData, type: ToastTypeValue = "message", options?: ToastOptions) {
    // Normalisation lives in Toasts.show: Discord's createToast when the build
    // ships one, our own legacy-to-store mapping otherwise. See resolveToasts /
    // normalizeToast above. No try/catch needed here.
    // Callers also pass a ready store entry ({text, variant, position}); that has to
    // reach Toasts.show as-is, wrapping it as a message renders the object as a
    // React child and soft-crashes the renderer (React error #31).
    if (typeof messageOrData === "string") Toasts.show(Toasts.create(messageOrData, type, options));
    else Toasts.show(messageOrData as unknown as ToastData);
}

export const UserUtils = {
    getUser: findByCodeLazy(".USER(")
};

export const UploadManager = findByPropsLazy("clearAll", "addFile");
export const UploadHandler = {
    promptToUpload: findByCodeLazy("Unexpected mismatch between files and file metadata") as (files: File[], channel: t.Channel, draftType: Number) => Promise<void>
};

export const ApplicationAssetUtils = mapMangledModuleLazy("getAssetImage: size must === [", {
    fetchAssetIds: filters.byCode('.startsWith("http:")', ".dispatch({"),
    getAssetFromImageURL: filters.byCode("].serialize(", ":null"),
    getAssetImage: filters.byCode("getAssetImage: size must === ["),
    getAssets: filters.byCode(".assets")
});

export const NavigationRouter: t.NavigationRouter = mapMangledModuleLazy("transitionTo - Transitioning to", {
    transitionTo: filters.byCode("transitionTo -"),
    transitionToGuild: filters.byCode("transitionToGuild -"),
    back: filters.byCode("goBack()"),
    forward: filters.byCode("goForward()"),
});
export const ChannelRouter: t.ChannelRouter = mapMangledModuleLazy('"Thread must have a parent ID."', {
    transitionToChannel: filters.byCode(".openTextInVoiceIfVoiceChannel"),
    transitionToThread: filters.byCode('"Thread must have a parent ID."')
});

export const SettingsRouter: t.SettingsRouter = mapMangledModuleLazy('type:"USER_SETTINGS_MODAL_OPEN"', {
    openUserSettings: filters.byCode('type:"USER_SETTINGS_MODAL_OPEN"')
});

export const PermissionsBits: t.PermissionsBits = findLazy(m => typeof m.ADMINISTRATOR === "bigint");

export const { zustandCreate } = mapMangledModuleLazy(["useSyncExternalStoreWithSelector:", "Object.assign"], {
    zustandCreate: filters.byCode(/=>(\i)\?\i\(\1/)
});

export const { zustandPersist } = mapMangledModuleLazy(".onRehydrateStorage)?", {
    zustandPersist: filters.byCode(/(\(\i,\i\))=>.+?\i\1/)
});

export const MessageActions = findByPropsLazy("editMessage", "sendMessage");
export const MessageCache = findByPropsLazy("clearCache", "_channelMessages");
export const openUserProfileModal: t.OpenUserProfileModal = findByCodeLazy('type:"USER_PROFILE_MODAL_OPEN"');
// Testcord keeps the mangled-module form alongside the byCode lookup above, because
// plugins reach for `UserProfileActions.openUserProfileModal`.
export const UserProfileActions: { openUserProfileModal: t.OpenUserProfileModal } = mapMangledModuleLazy(".log(`Failed to fetch profile for $", {
    openUserProfileModal: filters.byCode('type:"USER_PROFILE_MODAL_OPEN"')
});
export const InviteActions = findByPropsLazy("resolveInvite");
export const ChannelActionCreators = findByPropsLazy("openPrivateChannel");

export const VoiceActions = findByPropsLazy("toggleSelfMute");
export const GuildActions = findByPropsLazy("setServerMute", "setServerDeaf");
export const ChannelActions = findByPropsLazy("selectChannel", "selectVoiceChannel");
export const DraftActions = findByPropsLazy("saveDraft", "changeDraft");
export const PinActions: { pinMessage: (...args: any[]) => any; unpinMessage: (...args: any[]) => any; } = proxyLazyWebpack(() => {
    try {
        return findLazy(m => m?.pinMessage && m?.unpinMessage) as any;
    } catch {
        return { pinMessage() { }, unpinMessage() { } } as any;
    }
});

export const IconUtils: t.IconUtils = findByPropsLazy("getGuildBannerURL", "getUserAvatarURL");

export const ColorUtils = mapMangledModuleLazy("Invalid hex color format", {
    rgbToHex: filters.byCode(".toString(16).slice(1)"),
    hexToRgba: filters.byCode("`rgba(${"),
    hexToRgb: filters.byCode(".rgb();return"),
    rgbToHsl: filters.byCode("saturation:", "lightness:"),
    mixColors: filters.byCode(".substring(1,3),16)"),
    hexWithAlpha: filters.byCode("Invalid hex color format"),
    getDominantColor: filters.byCode("hex:", "hsv:"),
    generatePalette: filters.byCode("360/("),
});

export const ImageUtils = mapMangledModuleLazy("Input data is not a valid image.", {
    extractColors: filters.byCode('"number"==typeof'),
    fileToDataURL: filters.byCode("Result must be a string"),
    dataURLToBlob: filters.byCode("new Uint8Array("),
    dataURLToFile: filters.byCode("new File(["),
    fitDimensions: filters.byCode("minWidth:", "minHeight:"),
    loadImage: filters.byCode('addEventListener("load"'),
    isAnimatedPNG: filters.byCode("File is not a PNG"),
    base64Size: filters.byCode("Input data is not a valid image."),
});

export const ReadStateUtils = mapMangledModuleLazy('type:"ENABLE_AUTOMATIC_ACK",', {
    ackChannel: filters.byCode(".isForumLikeChannel(")
});

export const ExpressionPickerStore: t.ExpressionPickerStore = mapMangledModuleLazy("expression-picker-last-active-view", {
    openExpressionPicker: filters.byCode(/setState\({activeView:(?:(?!null)\i),activeViewType:/),
    closeExpressionPicker: filters.byCode("setState({activeView:null"),
    toggleMultiExpressionPicker: filters.byCode(".EMOJI,"),
    toggleExpressionPicker: filters.byCode(/\i\.activeView===\i&&\i\.activeViewType===\i&&/),
    setExpressionPickerView: filters.byCode(/setState\({activeView:\i,lastActiveView:/),
    setSearchQuery: filters.byCode("searchQuery:"),
    useExpressionPickerStore: filters.byCode(/\(\i,\i=\i\)=>/)
});

export const PopoutActions: t.PopoutActions = mapMangledModuleLazy('type:"POPOUT_WINDOW_OPEN"', {
    open: filters.byCode('type:"POPOUT_WINDOW_OPEN"'),
    close: filters.byCode('type:"POPOUT_WINDOW_CLOSE"'),
    setAlwaysOnTop: filters.byCode('type:"POPOUT_WINDOW_SET_ALWAYS_ON_TOP"'),
});

export const UsernameUtils: t.UsernameUtils = findByPropsLazy("useName", "getGlobalName");
export const DisplayProfileUtils: t.DisplayProfileUtils = mapMangledModuleLazy(/=\i\.getUserProfile\(\i\),\i=\i\.getGuildMemberProfile\(/, {
    getDisplayProfile: filters.byCode(".getGuildMemberProfile("),
    useDisplayProfile: filters.byCode(/\[\i\.\i,\i\.\i],\(\)=>/)
});

export const DateUtils: t.DateUtils = mapMangledModuleLazy("millisecondsInUnit:", {
    calendarFormat: filters.byCode('<-1?"sameElse":'),
    dateFormat: filters.byCode('<2?"nextDay":"sameElse";'),
    isSameDay: filters.byCode(/Math\.abs\(\i-\i\)/),
    diffAsUnits: filters.byCode("days:0", "millisecondsInUnit")
});

export const MessageTypeSets: t.MessageTypeSets = findByPropsLazy("REPLYABLE", "FORWARDABLE");

export const fetchApplicationsRPC = findByCodeLazy('"Invalid Origin"', ".application");

export const CloudUploader = findLazy(m => m.prototype?.trackUploadFinished) as typeof t.CloudUpload;

export const URLUtils: t.URLUtils = findByPropsLazy("URL_REGEX", "makeUrl", "isDiscordUrl");
export const Humanize: t.Humanize = findByPropsLazy("filesize", "relativeTime", "ordinal");
export const EmojiUtils: t.EmojiUtils = findByPropsLazy("getEmojiColors", "getURL");
