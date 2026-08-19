/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { corsFetch } from "./utils";
/**
 * Get ID of sticker pack from a URL
 *
 * @param url The URL to get the ID from.
 * @returns {string} The ID.
 * @throws {Error} If the URL is invalid.
 */
export function getIdFromUrl(url) {
    const re = /^https:\/\/store\.line\.me\/emojishop\/product\/([a-z0-9]+)\/.*$/;
    const match = re.exec(url);
    if (match === null) {
        throw new Error("Invalid URL");
    }
    return match[1];
}
/**
 * Convert LineEmojiPack id to StickerPack id
 *
 * @param id The id to convert.
 * @returns {string} The converted id.
 */
function toStickerPackId(id) {
    return "MoreStickers:Line:Emoji-Pack:" + id;
}
/**
 * Convert LineEmoji id to Sticker id
 *
 * @param stickerId The id to convert.
 * @param lineEmojiPackId The id of the LineEmojiPack.
 * @returns {string} The converted id.
 */
function toStickerId(stickerId, lineEmojiPackId) {
    return "MoreStickers:Line-Emoji:" + lineEmojiPackId + ":" + stickerId;
}
/**
  * Convert LineEmoji to Sticker
  *
  * @param {LineEmoji} s The LineEmoji to convert.
  * @return {Sticker} The sticker.
  */
export function convertSticker(s) {
    return {
        id: toStickerId(s.id, s.stickerPackId),
        image: s.animationUrl || s.staticUrl,
        title: s.id,
        stickerPackId: toStickerPackId(s.stickerPackId),
        isAnimated: !!s.animationUrl
    };
}
/**
  * Convert LineEmojiPack to StickerPack
  *
  * @param {LineEmojiPack} sp The LineEmojiPack to convert.
  * @return {StickerPack} The sticker pack.
  */
export function convert(sp) {
    return {
        id: toStickerPackId(sp.id),
        title: sp.title,
        author: sp.author,
        logo: convertSticker(sp.mainImage),
        stickers: sp.stickers.map(convertSticker)
    };
}
/**
  * Get stickers from given HTML
  *
  * @param {string} html The HTML.
  * @return {Promise<LineEmojiPack>} The sticker pack.
  */
export function parseHtml(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const mainImage = JSON.parse(doc.querySelector("[ref=mainImage]")?.dataset?.preview ?? "null");
    const { id } = mainImage;
    const stickers = [...doc.querySelectorAll(".FnStickerPreviewItem")]
        .map(x => JSON.parse(x.dataset.preview ?? "null"))
        .filter(x => x !== null)
        .map(x => ({ ...x, stickerPackId: id }));
    const stickerPack = {
        title: doc.querySelector("[data-test=emoji-name-title]")?.textContent ?? "null",
        author: {
            name: doc.querySelector("[data-test=emoji-author]")?.textContent ?? "null",
            url: "https://store.line.me/" + (doc.querySelector("[data-test=emoji-author]")?.getAttribute("href") ?? "null")
        },
        id,
        mainImage,
        stickers
    };
    return stickerPack;
}
export function isLineEmojiPackHtml(html) {
    return html.includes("data-test=\"emoji-name-title\"");
}
/**
  * Get stickers from LINE
  *
  * @param {string} id The id of the sticker pack.
  * @return {Promise<LineEmojiPack>} The sticker pack.
  */
export async function getStickerPackById(id, region = "en") {
    const res = await corsFetch(`https://store.line.me/emojishop/product/${id}/${region}`);
    const html = await res.text();
    return parseHtml(html);
}
