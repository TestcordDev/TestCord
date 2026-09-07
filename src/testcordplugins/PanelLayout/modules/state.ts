/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useState } from "@webpack/common";

import type { ModulePosition, UserAreaModule } from "./types";

export const registeredModules = new Map<string, UserAreaModule>();
const listeners = new Set<() => void>();

export function notifyModulesChanged(): void {
    listeners.forEach(l => {
        try {
            l();
        } catch (e) {
            console.error("[PanelLayout] Error in module listener:", e);
        }
    });
}

export function subscribeModules(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function getSortedModules(): UserAreaModule[] {
    return Array.from(registeredModules.values()).sort((a, b) => a.order - b.order);
}

export function getModulesByPosition(position: ModulePosition = "above"): UserAreaModule[] {
    return getSortedModules().filter(m => (m.position ?? "above") === position);
}

export function isModuleEnabled(id: string): boolean {
    return registeredModules.get(id)?.enabled ?? false;
}

export function useModules(): UserAreaModule[] {
    const [, setTick] = useState(0);

    useEffect(() => {
        const unsubscribe = subscribeModules(() => setTick(t => t + 1));
        return unsubscribe;
    }, []);

    return getSortedModules();
}
