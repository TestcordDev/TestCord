/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { BaseText } from "@components/BaseText";
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import ErrorBoundary from "@components/ErrorBoundary";
import { React, useEffect, UserStore,useState } from "@webpack/common";

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
import type { CustomModuleData, ModulePosition, StoredModuleState, UserAreaModule } from "./types";

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

const notify = notifyModulesChanged;
let initialized = false;

export async function initModuleManager(): Promise<void> {
    if (initialized) return;
    initialized = true;

    const savedStates = (await DataStore.get<Record<string, StoredModuleState>>(MODULE_STATES_KEY)) ?? {};

    const builtinList = getBuiltinModules();
    builtinList.forEach((mod, idx) => {
        if (!mod) return;
        const saved = savedStates[mod.id];
        const isEnabled = saved?.enabled ?? (mod.id === "music-controls" || mod.id === "dev-banner" || mod.id === "activity-banner");
        const moduleInstance: UserAreaModule = {
            ...mod,
            enabled: isEnabled,
            order: saved?.order ?? idx,
            position: saved?.position ?? mod.position ?? "above",
        };
        registeredModules.set(mod.id, moduleInstance);
        if (isEnabled) {
            try {
                void mod.onEnable?.();
            } catch (e) {
                console.error(`[PanelLayout] Error enabling module ${mod.id}:`, e);
            }
        }
    });

    const customList = (await DataStore.get<CustomModuleData[]>(CUSTOM_MODULES_KEY)) ?? [];
    for (const data of customList) {
        if (!data.id) continue;
        const saved = savedStates[data.id];
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

async function persistModuleStates(): Promise<void> {
    const states: Record<string, StoredModuleState> = {};
    for (const [id, mod] of registeredModules.entries()) {
        states[id] = {
            enabled: mod.enabled,
            order: mod.order,
            position: mod.position,
        };
    }
    await DataStore.set(MODULE_STATES_KEY, states);
}

export async function setModuleEnabled(id: string, enabled: boolean): Promise<void> {
    const mod = registeredModules.get(id);
    if (!mod) return;
    if (mod.enabled === enabled) return;
    mod.enabled = enabled;

    try {
        if (enabled) {
            void mod.onEnable?.();
        } else {
            mod.onDisable?.();
        }
    } catch (e) {
        console.error(`[PanelLayout] Error toggling module ${id} lifecycle:`, e);
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
    const samePositionModules = getSortedModules().filter(m => (m.position ?? "above") === pos);
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

export function registerModule(module: Omit<UserAreaModule, "order" | "enabled"> & { order?: number; enabled?: boolean }): void {
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

function CustomModuleComponent({ data }: { data: CustomModuleData }) {
    const [renderedContent, setRenderedContent] = useState<React.ReactNode>(null);

    useEffect(() => {
        if (data.customType === "html") {
            const currentUser = UserStore.getCurrentUser();
            const username = currentUser?.username || "User";
            const now = new Date();
            const timeStr = now.toLocaleTimeString();
            const dateStr = now.toLocaleDateString();

            const parsed = data.customCode
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

    const customList = (await DataStore.get<CustomModuleData[]>(CUSTOM_MODULES_KEY)) ?? [];
    customList.push(customData);
    await DataStore.set(CUSTOM_MODULES_KEY, customList);

    const mod = createCustomModule(customData);
    registeredModules.set(mod.id, mod);
    await persistModuleStates();
    notify();

    return mod;
}

export async function updateCustomModule(id: string, input: Partial<CustomModuleData>): Promise<UserAreaModule | null> {
    const customList = (await DataStore.get<CustomModuleData[]>(CUSTOM_MODULES_KEY)) ?? [];
    const index = customList.findIndex(m => m.id === id);
    if (index === -1) return null;

    customList[index] = { ...customList[index], ...input };
    await DataStore.set(CUSTOM_MODULES_KEY, customList);

    const savedStates = (await DataStore.get<Record<string, StoredModuleState>>(MODULE_STATES_KEY)) ?? {};
    const mod = createCustomModule(customList[index], savedStates[id]);
    registeredModules.set(id, mod);
    await persistModuleStates();
    notify();

    return mod;
}

export async function uninstallCustomModule(id: string): Promise<void> {
    const customList = (await DataStore.get<CustomModuleData[]>(CUSTOM_MODULES_KEY)) ?? [];
    const updated = customList.filter(m => m.id !== id);
    await DataStore.set(CUSTOM_MODULES_KEY, updated);

    const states = (await DataStore.get<Record<string, StoredModuleState>>(MODULE_STATES_KEY)) ?? {};
    delete states[id];
    await DataStore.set(MODULE_STATES_KEY, states);

    registeredModules.delete(id);
    notify();
}

export async function getCustomModulesData(): Promise<CustomModuleData[]> {
    return (await DataStore.get<CustomModuleData[]>(CUSTOM_MODULES_KEY)) ?? [];
}
