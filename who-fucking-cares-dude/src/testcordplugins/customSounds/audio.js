/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { get, set } from "@api/DataStore";
import { findByCodeLazy } from "@webpack";
const KEY = "ScattrdCustomSounds";
const AudioPlayerCtor = findByCodeLazy("could not play audio");
export const dataUriCache = new Map();
export function playAudio(audio, opts = {}) {
    const p = new AudioPlayerCtor(opts, audio, null, null, "default");
    p.play();
    return {
        stop: () => p.stop(),
        get volume() { return p._volume * 100; },
        set volume(v) { p.preprocessDataOriginal.volume = Math.max(0, v / 100); p.processAudio(); }
    };
}
async function hashBuffer(buffer) {
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}
async function generateDataURI(buffer, type) {
    const blob = new Blob([new Uint8Array(buffer)], { type: type || "audio/mpeg" });
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onloadend = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(blob);
    });
}
function dataUriToArrayBuffer(dataUri) {
    const i = dataUri.indexOf(",");
    if (i === -1 || !dataUri.slice(0, i).includes(";base64"))
        return null;
    try {
        const bin = atob(dataUri.slice(i + 1));
        const bytes = new Uint8Array(bin.length);
        for (let j = 0; j < bin.length; j++)
            bytes[j] = bin.charCodeAt(j);
        return bytes.buffer;
    }
    catch {
        return null;
    }
}
export async function getAllAudio() {
    return (await get(KEY)) ?? {};
}
export async function getAudioMeta() {
    const meta = {};
    for (const [id, f] of Object.entries(await getAllAudio()))
        meta[id] = f.name;
    return meta;
}
export async function saveAudio(file) {
    const buffer = await file.arrayBuffer();
    const id = await hashBuffer(buffer);
    const dataUri = await generateDataURI(buffer, file.type);
    const all = (await get(KEY)) ?? {};
    all[id] = { id, name: file.name, type: file.type, buffer, dataUri };
    await set(KEY, all);
    return id;
}
export async function deleteAudio(id) {
    const all = await getAllAudio();
    delete all[id];
    await set(KEY, all);
}
export async function ensureDataURICached(fileId) {
    if (dataUriCache.has(fileId))
        return dataUriCache.get(fileId);
    try {
        const e = (await getAllAudio())[fileId];
        if (e?.dataUri) {
            dataUriCache.set(fileId, e.dataUri);
            return e.dataUri;
        }
        if (e?.buffer instanceof ArrayBuffer) {
            const dataUri = await generateDataURI(e.buffer, e.type);
            const cur = await getAllAudio();
            if (cur[fileId]) {
                cur[fileId].dataUri = dataUri;
                await set(KEY, cur);
            }
            dataUriCache.set(fileId, dataUri);
            return dataUri;
        }
    }
    catch (e) {
        console.error("[CustomSounds]", e);
    }
    return null;
}
export async function importAudio(data) {
    const buffer = data.dataUri ? dataUriToArrayBuffer(data.dataUri) : null;
    if (!buffer)
        return null;
    const id = await hashBuffer(buffer);
    const all = (await get(KEY)) ?? {};
    all[id] = { id, name: data.name || "Imported", type: data.type || "audio/mpeg", buffer, dataUri: data.dataUri };
    await set(KEY, all);
    return id;
}
