/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { PlainSettings, SettingsStore } from "@api/Settings";
import { BaseText } from "@components/BaseText";
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import ErrorBoundary from "@components/ErrorBoundary";
import { Flex } from "@components/Flex";
import type { PluginNative } from "@utils/types";
import { React, useEffect, UserStore, useState } from "@webpack/common";

import { getBuiltinModules } from "./builtin";
import {
    getModulesByPosition,
    getSortedModules,
    isModuleEnabled,
    notifyModulesChanged,
    registeredModules,
    subscribeModules,
    useModules,
} from "./state";
import type {
    CustomModuleData,
    ModulePosition,
    StoredModuleState,
    UserAreaModule,
    UserAreaReorderItem,
} from "./types";

export {
    getModulesByPosition,
    getSortedModules,
    isModuleEnabled,
    notifyModulesChanged,
    registeredModules,
    subscribeModules,
    useModules,
};

const MODULE_STATES_KEY = "panel-layout-module-states";
const CUSTOM_MODULES_KEY = "panel-layout-custom-modules";
const USER_AREA_ORDER_KEY = "panel-layout-user-area-order";

const notify = notifyModulesChanged;
let initialized = false;

const Native = (VencordNative?.pluginHelpers?.PanelLayout || {}) as PluginNative<
    typeof import("../native")
>;

export function getPanelLayoutPlainSettings(): any {
    (PlainSettings.plugins as any).PanelLayout ??= {};
    return (PlainSettings.plugins as any).PanelLayout;
}

export const DEFAULT_USER_AREA_ORDER: UserAreaReorderItem[] = [
    {
        id: "music-controls",
        type: "module",
        name: "Music Controls",
        description: "Control Spotify & Tidal playback in the user area",
        order: 0,
        enabled: true,
        moduleId: "music-controls",
        hasSettings: true,
    },
    {
        id: "activity-banner",
        type: "module",
        name: "Activity Banner",
        description: "Displays rich presence details and activity cards",
        order: 1,
        enabled: true,
        moduleId: "activity-banner",
    },
    {
        id: "dev-banner",
        type: "module",
        name: "Developer Banner",
        description: "Discord & Testcord client information banner",
        order: 2,
        enabled: true,
        moduleId: "dev-banner",
        hasSettings: true,
    },
    {
        id: "voice-connected",
        type: "voice-connected",
        name: "Voice Connected Area",
        description: "Discord native voice connection status and call controls",
        order: 3,
        enabled: true,
        hasSettings: true,
    },
    {
        id: "native-activity-banner",
        type: "native-activity-banner",
        name: "Discord Native Activity",
        description: "Discord native game / stream banner",
        order: 4,
        enabled: true,
    },
    {
        id: "account-panel",
        type: "account-panel",
        name: "User Account & Buttons",
        description: "Avatar, username, mute, deafen, settings and panel buttons",
        order: 5,
        enabled: true,
        hasSettings: true,
    },
    {
        id: "clock-widget",
        type: "module",
        name: "Digital Clock & Date",
        description: "Digital clock and calendar widget",
        order: 6,
        enabled: false,
        moduleId: "clock-widget",
    },
    {
        id: "system-monitor",
        type: "module",
        name: "System & Ping Monitor",
        description: "Live Discord gateway ping and memory monitor",
        order: 7,
        enabled: false,
        moduleId: "system-monitor",
    },
];

let currentUserAreaOrder: UserAreaReorderItem[] = [...DEFAULT_USER_AREA_ORDER];

export function getUserAreaOrder(): UserAreaReorderItem[] {
    const modules = getSortedModules();
    const activeModuleIds = new Set(modules.map(m => m.id));

    const initialLen = currentUserAreaOrder.length;
    currentUserAreaOrder = currentUserAreaOrder.filter(item => {
        if (item.type !== "module") return true;
        const targetId = item.moduleId || item.id;
        return activeModuleIds.has(targetId);
    });
    let changed = currentUserAreaOrder.length !== initialLen;

    let maxOrder = currentUserAreaOrder.reduce((acc, curr) => Math.max(acc, curr.order), 0);

    for (const mod of modules) {
        const existing = currentUserAreaOrder.find(i => i.id === mod.id || i.moduleId === mod.id);
        if (!existing) {
            maxOrder++;
            currentUserAreaOrder.push({
                id: mod.id,
                type: "module",
                name: mod.name,
                description: mod.description,
                order: maxOrder,
                enabled: mod.enabled,
                moduleId: mod.id,
                hasSettings: !!mod.settingsComponent,
            });
            changed = true;
        } else {
            if (existing.name !== mod.name || existing.description !== mod.description || !!existing.hasSettings !== !!mod.settingsComponent) {
                existing.name = mod.name;
                existing.description = mod.description;
                existing.hasSettings = !!mod.settingsComponent;
                changed = true;
            }
            if (existing.enabled !== mod.enabled) {
                existing.enabled = mod.enabled;
                changed = true;
            }
        }
    }

    if (changed) {
        saveUserAreaOrderToStorage(currentUserAreaOrder);
    }

    return [...currentUserAreaOrder].sort((a, b) => a.order - b.order);
}

function saveUserAreaOrderToStorage(items: UserAreaReorderItem[]): void {
    currentUserAreaOrder = items;
    try {
        const plain = getPanelLayoutPlainSettings();
        plain.userAreaOrder = items;
        SettingsStore.markAsChanged();
    } catch (e) {
        console.error("[PanelLayout] Error saving user area order to plain settings:", e);
    }
    try {
        void DataStore.set(USER_AREA_ORDER_KEY, items).catch(e => {
            console.error("[PanelLayout] Error setting user area order in DataStore:", e);
        });
    } catch (e) {
        console.error("[PanelLayout] Error initiating DataStore set for user area order:", e);
    }
}

export async function setUserAreaOrder(items: UserAreaReorderItem[]): Promise<void> {
    saveUserAreaOrderToStorage(items);

    for (const item of items) {
        if (item.type === "module" && item.moduleId) {
            const mod = registeredModules.get(item.moduleId);
            if (mod) {
                mod.order = item.order;
                if (mod.enabled !== item.enabled) {
                    mod.enabled = item.enabled;
                    try {
                        if (item.enabled) void mod.onEnable?.();
                        else mod.onDisable?.();
                    } catch (e) {
                        console.error(`[PanelLayout] Error syncing module ${mod.id}:`, e);
                    }
                }
            }
        }
    }

    await persistModuleStates();
    notify();
}

export async function setUserAreaItemEnabled(id: string, enabled: boolean): Promise<void> {
    const items = getUserAreaOrder();
    const target = items.find(i => i.id === id);
    if (!target) return;
    target.enabled = enabled;

    if (target.type === "module" && target.moduleId) {
        await setModuleEnabled(target.moduleId, enabled);
    } else {
        await setUserAreaOrder(items);
    }
}

export async function initModuleManager(): Promise<void> {
    if (initialized) return;
    initialized = true;

    const plain = getPanelLayoutPlainSettings();
    const synchronousSavedStates = plain.moduleStates as Record<string, StoredModuleState> | undefined;
    const synchronousCustomList = plain.customModules as CustomModuleData[] | undefined;
    if (Array.isArray(plain.userAreaOrder) && plain.userAreaOrder.length > 0) {
        currentUserAreaOrder = plain.userAreaOrder;
    }

    let asyncSavedStates: Record<string, StoredModuleState> | undefined;
    let asyncCustomList: CustomModuleData[] | undefined;
    let asyncUserAreaOrder: UserAreaReorderItem[] | undefined;

    try {
        [asyncSavedStates, asyncCustomList, asyncUserAreaOrder] = await Promise.all([
            DataStore.get<Record<string, StoredModuleState>>(MODULE_STATES_KEY),
            DataStore.get<CustomModuleData[]>(CUSTOM_MODULES_KEY),
            DataStore.get<UserAreaReorderItem[]>(USER_AREA_ORDER_KEY),
        ]);
    } catch (e) {
        console.warn("[PanelLayout] Failed to read from DataStore, using plain settings fallback:", e);
    }

    const savedStates: Record<string, StoredModuleState> = {
        ...(asyncSavedStates ?? {}),
        ...(synchronousSavedStates ?? {}),
    };

    if (Array.isArray(asyncUserAreaOrder) && asyncUserAreaOrder.length > 0 && (!plain.userAreaOrder || plain.userAreaOrder.length === 0)) {
        currentUserAreaOrder = asyncUserAreaOrder;
    }

    const builtinList = getBuiltinModules();
    builtinList.forEach((mod, idx) => {
        if (!mod) return;
        const saved = savedStates[mod.id];
        const orderItem = currentUserAreaOrder.find(i => i.id === mod.id || i.moduleId === mod.id);
        const isEnabled = saved?.enabled ?? orderItem?.enabled ?? (mod.id === "music-controls" || mod.id === "dev-banner" || mod.id === "activity-banner");
        const order = saved?.order ?? orderItem?.order ?? idx;
        const position = saved?.position ?? mod.position ?? "above";

        const moduleInstance: UserAreaModule = {
            ...mod,
            enabled: isEnabled,
            order,
            position,
        };
        registeredModules.set(mod.id, moduleInstance);

        if (orderItem) {
            orderItem.enabled = isEnabled;
            orderItem.order = order;
        }

        if (isEnabled) {
            try {
                void mod.onEnable?.();
            } catch (e) {
                console.error(`[PanelLayout] Error enabling module ${mod.id}:`, e);
            }
        }
    });

    let diskCustomModules: CustomModuleData[] = [];
    try {
        const res = await Native?.loadUserModules?.();
        if (res?.success && Array.isArray(res.modules)) {
            diskCustomModules = res.modules;
        }
    } catch (e) {
        console.warn("[PanelLayout] Error loading modules from native disk:", e);
    }

    const customModuleMap = new Map<string, CustomModuleData>();
    for (const m of diskCustomModules) {
        if (m?.id) customModuleMap.set(m.id, m);
    }
    const storedCustom = synchronousCustomList ?? asyncCustomList ?? [];
    for (const m of storedCustom) {
        if (m?.id && !customModuleMap.has(m.id)) {
            customModuleMap.set(m.id, m);
            void Native?.saveUserModule?.(m);
        }
    }
    const customList = Array.from(customModuleMap.values());
    for (const data of customList) {
        if (!data.id) continue;
        const saved = savedStates[data.id];
        const orderItem = currentUserAreaOrder.find(i => i.id === data.id || i.moduleId === data.id);
        if (orderItem && saved?.enabled !== undefined) {
            orderItem.enabled = saved.enabled;
        }
        const customMod = createCustomModule(data, saved);
        registeredModules.set(customMod.id, customMod);
        if (customMod.enabled) {
            try {
                void customMod.onEnable?.();
            } catch (e) {
                console.error(`[PanelLayout] Error enabling custom module ${customMod.id}:`, e);
            }
        }
    }

    getUserAreaOrder();

    plain.moduleStates = savedStates;
    plain.customModules = customList;
    plain.userAreaOrder = currentUserAreaOrder;
    SettingsStore.markAsChanged();

    notify();
}

export function stopModuleManager(): void {
    registeredModules.forEach(mod => {
        if (mod.enabled) {
            try {
                mod.onDisable?.();
            } catch (e) {
                console.error(`[PanelLayout] Error disabling module ${mod.id}:`, e);
            }
        }
    });
    initialized = false;
}

export async function persistModuleStates(): Promise<void> {
    const states: Record<string, StoredModuleState> = {};
    for (const [id, mod] of registeredModules.entries()) {
        states[id] = {
            enabled: mod.enabled,
            order: mod.order,
            position: mod.position,
        };
    }
    try {
        const plain = getPanelLayoutPlainSettings();
        plain.moduleStates = states;
        SettingsStore.markAsChanged();
    } catch (e) {
        console.error("[PanelLayout] Error saving module states to plain settings:", e);
    }

    try {
        await DataStore.set(MODULE_STATES_KEY, states);
    } catch (e) {
        console.error("[PanelLayout] Error setting module states in DataStore:", e);
    }
}

export async function setModuleEnabled(id: string, enabled: boolean): Promise<void> {
    const mod = registeredModules.get(id);
    if (mod) {
        const prevEnabled = mod.enabled;
        mod.enabled = enabled;
        if (prevEnabled !== enabled) {
            try {
                if (enabled) {
                    void mod.onEnable?.();
                } else {
                    mod.onDisable?.();
                }
            } catch (e) {
                console.error(`[PanelLayout] Error toggling module ${id} lifecycle:`, e);
            }
        }
    }

    const orderItems = getUserAreaOrder();
    const item = orderItems.find(i => i.id === id || i.moduleId === id);
    if (item) {
        item.enabled = enabled;
        saveUserAreaOrderToStorage(orderItems);
    }

    await persistModuleStates();
    notify();
}

export async function setModulePosition(id: string, position: ModulePosition): Promise<void> {
    const mod = registeredModules.get(id);
    if (!mod) return;
    mod.position = position;
    await persistModuleStates();
    notify();
}

export async function moveModule(id: string, direction: "up" | "down"): Promise<void> {
    const mod = registeredModules.get(id);
    if (!mod) return;

    const pos = mod.position ?? "above";
    const samePositionModules = getSortedModules().filter(m => (m.position ?? "above") === pos && m.enabled);
    const index = samePositionModules.findIndex(m => m.id === id);
    if (index === -1) return;

    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= samePositionModules.length) return;

    const targetMod = samePositionModules[targetIndex];
    const tempOrder = mod.order;
    mod.order = targetMod.order;
    targetMod.order = tempOrder;

    if (mod.order === targetMod.order) {
        samePositionModules.forEach((m, i) => {
            m.order = i;
        });
    }

    await persistModuleStates();
    notify();
}

export async function reorderModules(orderedIds: string[]): Promise<void> {
    orderedIds.forEach((id, idx) => {
        const mod = registeredModules.get(id);
        if (mod) mod.order = idx;
    });
    await persistModuleStates();
    notify();
}

export function registerModule(module: Omit<UserAreaModule, "order" | "enabled"> & { order?: number; enabled?: boolean; }): void {
    const existing = registeredModules.get(module.id);
    const order = module.order ?? existing?.order ?? registeredModules.size;
    const enabled = module.enabled ?? existing?.enabled ?? true;

    const mod: UserAreaModule = {
        ...module,
        order,
        enabled,
        position: module.position ?? existing?.position ?? "above",
    };

    registeredModules.set(module.id, mod);

    if (enabled) {
        try {
            void mod.onEnable?.();
        } catch (e) {
            console.error(`[PanelLayout] Error enabling registered module ${mod.id}:`, e);
        }
    }

    void persistModuleStates();
    notify();
}

export function unregisterModule(id: string): void {
    const mod = registeredModules.get(id);
    if (mod) {
        if (mod.enabled) {
            try {
                mod.onDisable?.();
            } catch (e) {
                console.error(`[PanelLayout] Error disabling unregistered module ${id}:`, e);
            }
        }
        registeredModules.delete(id);
        void persistModuleStates();
        notify();
    }
}

function createCustomModule(data: CustomModuleData, savedState?: StoredModuleState): UserAreaModule {
    const id = data.id || `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const position = savedState?.position ?? data.position ?? "above";
    const enabled = savedState?.enabled ?? data.enabled ?? true;
    const order = savedState?.order ?? data.order ?? registeredModules.size;

    return {
        id,
        name: data.name,
        description: data.description,
        authors: data.author ? [data.author] : ["Custom"],
        version: data.version || "1.0.0",
        tags: ["Custom", ...(data.tags || [])],
        isCustom: true,
        customType: data.customType,
        customCode: data.customCode,
        customCss: data.customCss,
        sourceUrl: data.sourceUrl,
        position,
        enabled,
        order,
        render: function CustomRenderer() {
            return (
                <ErrorBoundary
                    fallback={() => (
                        <div style={{ padding: "8px", fontSize: "11px", color: "var(--text-danger)" }}>
                            Error in custom module "{data.name}"
                        </div>
                    )}
                >
                    <CustomModuleComponent data={data} />
                </ErrorBoundary>
            );
        },
    };
}

function CustomModuleComponent({ data }: { data: CustomModuleData; }) {
    const [renderedContent, setRenderedContent] = useState<React.ReactNode>(null);

    useEffect(() => {
        if (data.customType === "html") {
            const currentUser = UserStore.getCurrentUser();
            const username = currentUser?.username || "User";
            const now = new Date();
            const timeStr = now.toLocaleTimeString();
            const dateStr = now.toLocaleDateString();

            const parsed = (data.customCode || "")
                .replace(/{username}/g, username)
                .replace(/{time}/g, timeStr)
                .replace(/{date}/g, dateStr);

            setRenderedContent(
                <div
                    className={`vc-custom-module-${data.id}`}
                    dangerouslySetInnerHTML={{ __html: parsed }}
                />
            );
        } else if (data.customType === "react") {
            try {
                const scope = {
                    React,
                    Button,
                    BaseText,
                    Card,
                    Flex,
                    UserStore,
                    useState,
                    useEffect,
                    DataStore,
                };
                const fn = new Function(
                    ...Object.keys(scope),
                    `"use strict";\n${data.customCode}\nreturn typeof render === "function" ? render() : (typeof Component === "function" ? React.createElement(Component) : null);`
                );
                const res = fn(...Object.values(scope));
                setRenderedContent(res);
            } catch (err: any) {
                setRenderedContent(
                    <div style={{ padding: "6px", fontSize: "11px", color: "var(--text-danger)" }}>
                        Module eval error: {err.message || String(err)}
                    </div>
                );
            }
        }
    }, [data.customCode, data.customType]);

    return (
        <div style={{ margin: "4px 8px" }}>
            {data.customCss && <style>{data.customCss}</style>}
            {renderedContent}
        </div>
    );
}

export async function installCustomModule(input: CustomModuleData): Promise<UserAreaModule> {
    const id = input.id || `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const customData: CustomModuleData = { ...input, id };

    const customList = await getCustomModulesData();
    const existingIndex = customList.findIndex(m => m.id === id);
    if (existingIndex >= 0) {
        customList[existingIndex] = customData;
    } else {
        customList.push(customData);
    }

    try {
        await Native?.saveUserModule?.(customData);
    } catch (e) {
        console.error("[PanelLayout] Error saving custom module to disk:", e);
    }

    try {
        const plain = getPanelLayoutPlainSettings();
        plain.customModules = customList;
        SettingsStore.markAsChanged();
    } catch (e) {
        console.error("[PanelLayout] Error saving custom modules to plain settings:", e);
    }
    try {
        await DataStore.set(CUSTOM_MODULES_KEY, customList);
    } catch (e) {
        console.error("[PanelLayout] Error saving custom modules to DataStore:", e);
    }

    const mod = createCustomModule(customData);
    registeredModules.set(mod.id, mod);

    const existsInOrder = currentUserAreaOrder.some(i => i.id === mod.id || i.moduleId === mod.id);
    if (!existsInOrder) {
        const maxOrder = currentUserAreaOrder.reduce((acc, curr) => Math.max(acc, curr.order), 0);
        currentUserAreaOrder.push({
            id: mod.id,
            type: "module",
            name: mod.name,
            description: mod.description,
            order: maxOrder + 1,
            enabled: mod.enabled,
            moduleId: mod.id,
            hasSettings: false,
        });
        saveUserAreaOrderToStorage(currentUserAreaOrder);
    }

    await persistModuleStates();
    notify();

    return mod;
}

export async function updateCustomModule(id: string, input: Partial<CustomModuleData>): Promise<UserAreaModule | null> {
    const customList = await getCustomModulesData();
    const index = customList.findIndex(m => m.id === id);
    if (index === -1) return null;

    customList[index] = { ...customList[index], ...input };

    try {
        await Native?.saveUserModule?.(customList[index]);
    } catch (e) {
        console.error("[PanelLayout] Error updating custom module on disk:", e);
    }

    try {
        const plain = getPanelLayoutPlainSettings();
        plain.customModules = customList;
        SettingsStore.markAsChanged();
    } catch (e) {
        console.error("[PanelLayout] Error updating custom modules in plain settings:", e);
    }
    try {
        await DataStore.set(CUSTOM_MODULES_KEY, customList);
    } catch (e) {
        console.error("[PanelLayout] Error updating custom modules in DataStore:", e);
    }

    const plain = getPanelLayoutPlainSettings();
    let asyncStates: Record<string, StoredModuleState> | undefined;
    try {
        asyncStates = await DataStore.get<Record<string, StoredModuleState>>(MODULE_STATES_KEY);
    } catch { }
    const savedStates = plain.moduleStates ?? asyncStates ?? {};
    const mod = createCustomModule(customList[index], savedStates[id]);
    registeredModules.set(id, mod);

    const orderItem = currentUserAreaOrder.find(i => i.id === id || i.moduleId === id);
    if (orderItem) {
        orderItem.name = mod.name;
        orderItem.description = mod.description;
        saveUserAreaOrderToStorage(currentUserAreaOrder);
    }

    await persistModuleStates();
    notify();

    return mod;
}

export async function uninstallCustomModule(id: string): Promise<void> {
    try {
        await Native?.deleteUserModule?.(id);
    } catch (e) {
        console.error("[PanelLayout] Error deleting custom module from disk:", e);
    }

    const customList = await getCustomModulesData();
    const updated = customList.filter(m => m.id !== id);

    try {
        const plain = getPanelLayoutPlainSettings();
        plain.customModules = updated;
        if (plain.moduleStates) delete plain.moduleStates[id];
        SettingsStore.markAsChanged();
    } catch (e) {
        console.error("[PanelLayout] Error removing custom module from plain settings:", e);
    }

    try {
        await DataStore.set(CUSTOM_MODULES_KEY, updated);
        const states = (await DataStore.get<Record<string, StoredModuleState>>(MODULE_STATES_KEY)) ?? {};
        delete states[id];
        await DataStore.set(MODULE_STATES_KEY, states);
    } catch (e) {
        console.error("[PanelLayout] Error removing custom module from DataStore:", e);
    }

    currentUserAreaOrder = currentUserAreaOrder.filter(i => i.id !== id && i.moduleId !== id);
    saveUserAreaOrderToStorage(currentUserAreaOrder);

    registeredModules.delete(id);
    notify();
}

export async function getCustomModulesData(): Promise<CustomModuleData[]> {
    try {
        const res = await Native?.loadUserModules?.();
        if (res?.success && Array.isArray(res.modules) && res.modules.length > 0) {
            return res.modules;
        }
    } catch { }

    const plain = getPanelLayoutPlainSettings();
    if (Array.isArray(plain.customModules)) return plain.customModules;
    try {
        return (await DataStore.get<CustomModuleData[]>(CUSTOM_MODULES_KEY)) ?? [];
    } catch {
        return [];
    }
}
