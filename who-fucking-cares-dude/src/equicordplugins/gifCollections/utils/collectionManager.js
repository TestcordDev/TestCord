/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { DataStore } from "@api/index";
import { Toasts } from "@webpack/common";
import { settings } from "../settings";
import { getFormat } from "./getFormat";
import { logger } from "./misc";
export const DATA_COLLECTION_NAME = "gif-collections-collections";
export let cache_collections = [];
export const getCollections = async () => (await DataStore.get(DATA_COLLECTION_NAME)) ?? [];
async function saveCollections(collections) {
    cache_collections = collections;
    await DataStore.set(DATA_COLLECTION_NAME, collections);
}
export const refreshCacheCollection = async () => {
    cache_collections = await getCollections();
};
export async function createCollection(name, gifs) {
    const collections = [...cache_collections];
    const fullName = `${settings.store.collectionPrefix}${name}`;
    if (collections.some(c => c.name === fullName)) {
        Toasts.show({ message: "That collection already exists", type: Toasts.Type.FAILURE, id: Toasts.genId(), options: { duration: 3000, position: Toasts.Position.BOTTOM } });
        return;
    }
    const latestGifSrc = gifs[gifs.length - 1]?.src ?? settings.store.defaultEmptyCollectionImage;
    collections.push({
        name: fullName,
        src: latestGifSrc,
        format: getFormat(latestGifSrc),
        type: "Category",
        gifs,
        createdAt: Date.now(),
        lastUpdated: Date.now(),
    });
    await saveCollections(collections);
}
export async function addToCollection(name, gif) {
    const collections = [...cache_collections];
    const collection = collections.find(c => c.name === name);
    if (!collection)
        return void logger.warn("Collection not found");
    if (settings.store.preventDuplicates && collection.gifs.some(g => g.url === gif.url)) {
        Toasts.show({ message: "This GIF is already in the collection", type: Toasts.Type.FAILURE, id: Toasts.genId(), options: { duration: 3000, position: Toasts.Position.BOTTOM } });
        return;
    }
    collection.gifs = [...collection.gifs, { ...gif, addedAt: Date.now() }];
    collection.src = gif.src;
    collection.format = getFormat(gif.src);
    collection.lastUpdated = Date.now();
    await saveCollections(collections);
}
export async function renameCollection(oldName, newName) {
    const collections = [...cache_collections];
    const collection = collections.find(c => c.name === oldName);
    if (!collection)
        return void logger.warn("Collection not found");
    collection.name = `${settings.store.collectionPrefix}${newName}`;
    collection.lastUpdated = Date.now();
    await saveCollections(collections);
}
export async function removeFromCollection(id) {
    const collections = [...cache_collections];
    const collection = collections.find(c => c.gifs.some(g => g.id === id));
    if (!collection)
        return void logger.warn("Collection not found");
    collection.gifs = collection.gifs.filter(g => g.id !== id);
    const latestGifSrc = collection.gifs.length ? collection.gifs[collection.gifs.length - 1].src : settings.store.defaultEmptyCollectionImage;
    collection.src = latestGifSrc;
    collection.format = getFormat(latestGifSrc);
    collection.lastUpdated = Date.now();
    await saveCollections(collections);
}
export async function deleteCollection(name) {
    await saveCollections(cache_collections.filter(c => c.name !== name));
}
export async function moveGifToCollection(gifId, fromName, toName) {
    const collections = [...cache_collections];
    const from = collections.find(c => c.name === fromName);
    const to = collections.find(c => c.name === toName);
    if (!from || !to)
        return void logger.warn("Collection not found");
    const gifIndex = from.gifs.findIndex(g => g.id === gifId);
    if (gifIndex === -1)
        return void logger.warn("Gif not found");
    const gif = { ...from.gifs[gifIndex], addedAt: Date.now() };
    from.gifs = from.gifs.filter((_, i) => i !== gifIndex);
    to.gifs = [...to.gifs, gif];
    const updateCollectionMeta = (col) => {
        const latest = col.gifs.length ? col.gifs[col.gifs.length - 1].src : settings.store.defaultEmptyCollectionImage;
        col.src = latest;
        col.format = getFormat(latest);
        col.lastUpdated = Date.now();
    };
    updateCollectionMeta(from);
    updateCollectionMeta(to);
    await saveCollections(collections);
}
export async function updateGif(gifId, updatedGif) {
    const collections = [...cache_collections];
    const collection = collections.find(c => c.gifs.some(g => g.id === gifId));
    if (!collection)
        return void logger.warn("Collection not found");
    const gifIndex = collection.gifs.findIndex(g => g.id === gifId);
    if (gifIndex === -1)
        return void logger.warn("Gif not found");
    collection.gifs = collection.gifs.map((g, i) => i === gifIndex ? updatedGif : g);
    collection.lastUpdated = Date.now();
    await saveCollections(collections);
}
export function getItemCollectionNameFromId(id) {
    return cache_collections.find(c => c.gifs.some(g => g.id === id))?.name;
}
export function getGifById(id) {
    return cache_collections.flatMap(c => c.gifs).find(g => g.id === id);
}
