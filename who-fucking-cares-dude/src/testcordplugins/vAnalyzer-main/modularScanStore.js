/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as DataStore from "@api/DataStore";
const STORE_KEY = "vAnalyzer_modularScanModules";
function generateId() {
    return Math.random().toString(36).slice(2, 10);
}
let cache = [];
export function getModulesSync() {
    return cache;
}
export async function getModules() {
    const modules = (await DataStore.get(STORE_KEY)) ?? [];
    cache = modules;
    return modules;
}
export async function saveModules(modules) {
    cache = modules;
    await DataStore.set(STORE_KEY, modules);
}
export async function addModule(m) {
    const module = { ...m, id: generateId() };
    const all = await getModules();
    all.push(module);
    await saveModules(all);
    return module;
}
export async function updateModule(updated) {
    const all = await getModules();
    const idx = all.findIndex(m => m.id === updated.id);
    if (idx !== -1)
        all[idx] = updated;
    await saveModules(all);
}
export async function deleteModule(id) {
    const all = await getModules();
    const next = all.filter(m => m.id !== id);
    await saveModules(next);
}
getModules();
