/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as DataStore from "@api/DataStore";
import { removeRecentStickerByPackId } from "./components";
import { corsFetch, Mutex } from "./utils";
const mutex = new Mutex();
const PACKS_KEY = "MoreStickers:Packs";
const DYNAMIC_PACK_SET_METAS_KEY = "MoreStickers:DynamicPackSetMetas";
/**
  * Convert StickerPack to StickerPackMeta
  *
  * @param {StickerPack} sp The StickerPack to convert.
  * @return {StickerPackMeta} The sticker pack metadata.
  */
function stickerPackToMeta(sp) {
    return {
        id: sp.id,
        title: sp.title = sp.title === "null" ? sp.id.match(/\d+/)?.[0] ?? sp.id : sp.title,
        author: sp.author,
        logo: sp.logo,
        dynamic: sp.dynamic,
    };
}
/**
  * Save a sticker pack to the DataStore
  *
  * @param {StickerPack} sp The StickerPack to save.
  * @return {Promise<void>}
  */
export async function saveStickerPack(sp, packsKey = PACKS_KEY) {
    const meta = stickerPackToMeta(sp);
    await Promise.all([
        DataStore.set(`${sp.id}`, sp),
        (async () => {
            const unlock = await mutex.lock();
            try {
                let packs = (await DataStore.get(packsKey) ?? null);
                if (packs?.some(p => p.id === sp.id)) {
                    packs = packs.map(p => p.id === sp.id ? meta : p);
                }
                else {
                    packs = packs === null ? [meta] : [...packs, meta];
                }
                await DataStore.set(packsKey, packs);
            }
            finally {
                unlock();
            }
        })()
    ]);
}
/**
  * Get sticker packs' metadata from the DataStore
  *
  * @return {Promise<StickerPackMeta[]>}
  */
export async function getStickerPackMetas(packsKey = PACKS_KEY) {
    const packs = (await DataStore.get(packsKey)) ?? null;
    return packs ?? [];
}
/**
 * Get a sticker pack from the DataStore
 *
 * @param {string} id The id of the sticker pack.
 * @return {Promise<StickerPack | null>}
 * */
export async function getStickerPack(id) {
    return (await DataStore.get(id)) ?? null;
}
/**
 * Get a sticker pack meta from the DataStore
 *
 * @param {string} id The id of the sticker pack.
 * @return {Promise<StickerPackMeta | null>}
 * */
export async function getStickerPackMeta(id) {
    const sp = await getStickerPack(id);
    return sp ? stickerPackToMeta(sp) : null;
}
/**
 * Delete a sticker pack from the DataStore
 *
 * @param {string} id The id of the sticker pack.
 * @return {Promise<void>}
 * */
export async function deleteStickerPack(id, packsKey = PACKS_KEY) {
    await Promise.all([
        DataStore.del(id),
        removeRecentStickerByPackId(id),
        (async () => {
            const unlock = await mutex.lock();
            try {
                const packs = (await DataStore.get(packsKey) ?? null);
                if (packs === null)
                    return;
                await DataStore.set(packsKey, packs.filter(p => p.id !== id));
            }
            finally {
                unlock();
            }
        })()
    ]);
}
export async function getDynamicStickerPack(dspm) {
    const dsp = await corsFetch(dspm.dynamic.refreshUrl, {
        headers: dspm.dynamic.authHeaders,
    });
    if (!dsp.ok)
        return null;
    return await dsp.json();
}
export async function getDynamicPackSetMetas(dpsmKey = DYNAMIC_PACK_SET_METAS_KEY) {
    return (await DataStore.get(dpsmKey)) ?? null;
}
function hasDynamicPackSetMeta(dpsm, metas) {
    return !!metas?.some(m => m.id === dpsm.id);
}
export async function fetchDynamicPackSetMeta(dpsm) {
    const dpsm_ = await corsFetch(dpsm.refreshUrl, {
        headers: dpsm.authHeaders,
    });
    if (!dpsm_.ok)
        return null;
    const dpsmData = await dpsm_.json();
    return dpsmData;
}
export async function refreshDynamicPackSet(old, _new) {
    const oldPacks = old.packs.map(p => p.id);
    const newPacks = _new.packs.map(p => p.id);
    const toRemove = oldPacks.filter(p => !newPacks.includes(p));
    const toAdd = newPacks.filter(p => !oldPacks.includes(p));
    await Promise.all([
        ...toRemove.map(id => deleteStickerPack(id)),
        ...toAdd.map(id => getDynamicStickerPack(_new.packs.find(p => p.id === id)).then(sp => sp && saveStickerPack(sp)))
    ]);
}
export async function saveDynamicPackSetMeta(dpsm, dpsmKey = DYNAMIC_PACK_SET_METAS_KEY) {
    let metas = (await DataStore.get(dpsmKey) ?? null);
    if (hasDynamicPackSetMeta(dpsm, metas)) {
        await refreshDynamicPackSet(metas.find(m => m.id === dpsm.id), dpsm);
        metas = metas.map(m => m.id === dpsm.id ? dpsm : m);
    }
    const unlock = await mutex.lock();
    try {
        await DataStore.set(dpsmKey, metas === null ? [dpsm] : metas);
    }
    finally {
        unlock();
    }
}
export async function fetchAndRefreshDynamicPackSet(dpsm, dpsmKey = DYNAMIC_PACK_SET_METAS_KEY) {
    const _new = await fetchDynamicPackSetMeta(dpsm);
    if (!_new)
        return;
    await saveDynamicPackSetMeta(_new, dpsmKey);
}
