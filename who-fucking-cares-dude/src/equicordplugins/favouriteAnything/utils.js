/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { classNameFactory } from "@utils/css";
import { sendMessage } from "@utils/discord";
import { proxyLazy } from "@utils/lazy";
import { Queue } from "@utils/Queue";
import { useForceUpdater } from "@utils/react";
import { findByCodeLazy, findByPropsLazy } from "@webpack";
import { Constants, DraftType, FluxDispatcher, MessageActions, PendingReplyStore, PermissionStore, RestAPI, Toasts, UploadAttachmentStore, UploadHandler, UploadManager, useCallback, useEffect, useRef, UserSettingsActionCreators, UserSettingsProtoStore, useStateFromStores } from "@webpack/common";
import { deflateSync, inflateSync } from "fflate";
import { base64ToUint8Array, uint8ArrayToBase64 } from "./polyfills";
import { CustomItemFormat, FavouriteItemFormat } from "./types";
const Native = VencordNative.pluginHelpers.FavouriteAnything;
export const cl = classNameFactory("vc-favouriteAnything-");
export const useResizeObserver = findByCodeLazy("borderBoxSize", "blockSize", "inlineSize");
export const ImageUtils = findByPropsLazy("isAnimated", "getFormatQuality");
export const transformAttachment = findByCodeLazy("return{uniqueId", ".IS_ANIMATED");
const encoder = new TextEncoder(), decoder = new TextDecoder();
const defineItem = (item) => item;
function defineItems(def) {
    return {
        encode: (format, data) => {
            try {
                const obj = [format, def[format].encode(data)];
                const buf = deflateSync(encoder.encode(JSON.stringify(obj)));
                return uint8ArrayToBase64(buf);
            }
            catch {
                return null;
            }
        },
        decode: (raw) => {
            try {
                if (!raw)
                    return null;
                const buf = inflateSync(base64ToUint8Array(raw));
                const parsed = JSON.parse(decoder.decode(buf));
                if (!Array.isArray(parsed))
                    return null;
                const [format, data] = parsed;
                if (!(format in def))
                    return null;
                return { format, data: def[format].decode(data) };
            }
            catch {
                return null;
            }
        },
        stringify: (format, item) => def[format].stringify(item)
    };
}
// Encode/Decode definitions for custom favourite items.
// The encode callback must return a json compatible object, preferably as compact as possible.
// Decode must recreate the original object based on the encoded value.
// Stringify returns a simple string representation used for thumbnail text and expression picker search.
export const defs = defineItems({
    [CustomItemFormat.ATTACHMENT]: defineItem({
        encode: ({ id, filename, size, url, content_type = "", title, description }) => [
            id,
            filename,
            size,
            new URL(url).pathname,
            content_type,
            title ?? null,
            description ?? null
        ],
        decode: ([id, filename, size, path, content_type, title, description]) => ({
            id: id ?? "0",
            filename: filename ?? "UNKNOWN",
            size: +size || 0,
            url: `${new URL(path, `https://${window.GLOBAL_ENV.CDN_HOST}`)}`,
            proxy_url: `${new URL(path, `https://${window.GLOBAL_ENV.MEDIA_PROXY_ENDPOINT}`)}`,
            content_type: content_type ?? "application/octet-stream",
            spoiler: filename?.startsWith("SPOILER_") ?? false,
            title: title ?? undefined,
            description: description ?? undefined
        }),
        stringify: ({ title, filename }) => title?.trim() || filename
    })
    // This could be expanded in the future with other item types (e.g. voice messages)
});
// TODO: make thumbnails prettier
const fallbackThumbnail = new URL("https://images-ext-1.discordapp.net/external/pGTJg3YdSHpyGTltH4vZUKEyQoNzf5mtqbSJs7I4ebc/https/equicord.org/assets/plugins/favoriteAnything/invalid.png");
export async function getThumbnailUrl(data, width, height) {
    try {
        const decoded = defs.decode(data);
        if (!decoded || !width || !height)
            return null;
        const text = defs.stringify(decoded.format, decoded.data);
        const url = new URL(`https://placehold.jp/42/444/fff/${width}x${height}.png`);
        url.searchParams.append("text", text);
        return await RestAPI.post({
            url: Constants.Endpoints.UNFURL_EMBED_URLS,
            body: { urls: [url] },
            retries: 3
        }).then(({ body }) => {
            const [{ thumbnail } = {}] = body.embeds;
            return thumbnail?.proxy_url ? new URL(thumbnail.proxy_url) : fallbackThumbnail;
        });
    }
    catch {
        return fallbackThumbnail;
    }
}
export const isAllowedHost = proxyLazy(() => {
    // GLOBAL_ENV is not initialized immediately
    const allowedHosts = new Set([
        window.GLOBAL_ENV.CDN_HOST,
        ...[window.GLOBAL_ENV.IMAGE_PROXY_ENDPOINTS, window.GLOBAL_ENV.MEDIA_PROXY_ENDPOINT]
            .flatMap(endpoint => endpoint.split(","))
            .map(endpoint => URL.parse(`https://${endpoint}`)?.hostname)
            .filter(Boolean)
    ]);
    return (value) => allowedHosts.has(value);
});
async function fetchAttachment(attachment) {
    if (!IS_WEB)
        return Native.fetchAttachment(attachment).then(({ data, filename, type }) => new File([data], filename, { type }));
    const { content_type, filename } = attachment;
    const url = URL.parse(attachment.url);
    if (!url || !isAllowedHost(url.hostname))
        throw new Error("Invalid URL");
    const res = await fetch(url, { headers: { Accept: "*/*" } });
    if (!res.ok)
        throw new Error("Server error");
    const blob = await res.blob();
    const type = blob.type || content_type || "application/octet-stream";
    const data = await blob.arrayBuffer();
    return new File([data], filename, { type });
}
export async function sendAttachment(attachment, channel) {
    const { filename, title, description } = attachment;
    const file = await fetchAttachment(attachment).catch(() => Toasts.show({ message: `Couldn't fetch ${filename}`, id: Toasts.genId(), type: Toasts.Type.FAILURE }));
    if (!file)
        return;
    // Using promptToUpload instead of addFiles directly since it has file size checks with error popups
    await UploadHandler.promptToUpload([file], channel, DraftType.ChannelMessage).catch(() => Toasts.show({ message: `Couldn't upload ${filename}`, id: Toasts.genId(), type: Toasts.Type.FAILURE }));
    const uploads = [...UploadAttachmentStore.getUploads(channel.id, DraftType.ChannelMessage)];
    const uploadIdx = uploads.findIndex(({ item }) => item.file === file);
    if (uploadIdx === -1)
        return;
    const reply = PendingReplyStore.getPendingReply(channel.id);
    const [upload] = uploads.splice(uploadIdx);
    UploadManager.setUploads({ uploads, channelId: channel.id, draftType: DraftType.ChannelMessage });
    // Empty titles and descriptions are allowed
    if (title != null)
        upload.filename = title;
    if (description != null)
        upload.description = description;
    FluxDispatcher.dispatch({ type: "DELETE_PENDING_REPLY", channelId: channel.id });
    void sendMessage(channel.id, {}, false, {
        ...MessageActions.getSendMessageOptionsForReply(reply),
        attachmentsToUpload: [upload]
    });
}
export function hasPermission(permission, channel) {
    return !!channel && (PermissionStore.can(permission, channel) || channel.isPrivate());
}
const diacriticsRegex = /[\u0300-\u036f]/g;
function normalize(str) {
    return str.normalize("NFD").replace(diacriticsRegex, "").normalize("NFKC").toLowerCase().trim();
}
// Stolen from favGifSearch
function fuzzySearch(searchQuery, searchString) {
    let searchIndex = 0;
    let score = 0;
    for (let i = 0; i < searchString.length; i++) {
        if (searchString[i] === searchQuery[searchIndex]) {
            score++;
            searchIndex++;
        }
        else {
            score--;
        }
        if (searchIndex === searchQuery.length) {
            return score;
        }
    }
    return null;
}
export function useFavourites(itemFormat, searchQuery) {
    useEffect(() => void UserSettingsActionCreators.FrecencyUserSettingsActionCreators.loadIfNecessary(), []);
    const items = useStateFromStores([UserSettingsProtoStore], () => {
        const gifs = UserSettingsProtoStore.frecencyWithoutFetchingLatest.favoriteGifs?.gifs;
        if (!gifs)
            return null;
        return Object.entries(gifs)
            .filter(([, { format }]) => format === FavouriteItemFormat.NONE)
            .map(([url, { src, ...rest }]) => ({
            ...rest,
            ...defs.decode(URL.parse(src)?.hash.replace("#", "") ?? ""),
            url
        }))
            .filter(({ format, data }) => data && format === itemFormat);
    }, [itemFormat]);
    const { state } = useStateFromStores([UserSettingsProtoStore], () => {
        const query = searchQuery && normalize(searchQuery);
        if (!items)
            return { query, state: null };
        if (!query)
            return { query, state: items.toSorted((a, b) => b.order - a.order) };
        const state = items
            .map(item => ({
            item,
            score: fuzzySearch(query, normalize(defs.stringify(item.format, item.data)))
        }))
            .filter(({ score }) => score !== null)
            .sort((a, b) => b.score - a.score)
            .map(({ item }) => item);
        return { query, state };
    }, [items, searchQuery], 
    // Do not rerender components using this hook unless the query has changed or the items were loaded for the first time
    // This matches the behavior of the gif picker, where unfavouriting an item doesn't immediately hide it
    (prev, next) => !!prev.state === !!next.state && prev.query === next.query);
    return state;
}
// Helper hook for the ListScroller component, similar utility is used in the forum channel list view
// for keeping track of the individual row heights
export function useListScroller() {
    const rowHeights = useRef(new Map());
    const update = useForceUpdater();
    const handleResize = useCallback((key, height) => {
        if (height === rowHeights.current.get(key))
            return;
        rowHeights.current.set(key, height);
        update();
    }, []);
    return [rowHeights.current, handleResize];
}
// Wrapper class for Queue which allows batching multiple requests into one.
// A request is fired immediately if at least `maxCount` items are in this queue,
// or if enough time (`timeout`) has passed since the last item was added.
// Subsequent requests are fired in sequence.
export class BatchedRequestQueue {
    cb;
    options;
    items = [];
    timer = null;
    queue = new Queue();
    constructor(cb, options) {
        this.cb = cb;
        this.options = options;
    }
    add(item) {
        if (this.items.indexOf(item) !== -1)
            return;
        this.items.push(item);
        if (this.items.length >= this.options.maxCount) {
            this.flush();
        }
        else {
            if (this.timer)
                clearTimeout(this.timer);
            this.timer = setTimeout(() => this.flush(), this.options.timeout);
        }
    }
    flush() {
        if (this.timer)
            clearTimeout(this.timer);
        this.timer = null;
        if (this.items.length === 0)
            return;
        const batch = this.items.splice(0, 50);
        this.queue.push(() => this.cb(batch).catch(() => this.items.push(...batch)));
    }
}
