/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type KamidereRuntimeTaskStatus = "running" | "completed" | "cancelled" | "failed";

export interface KamidereRuntimeTask {
    id: string;
    toolId: string;
    name: string;
    status: KamidereRuntimeTaskStatus;
    subtitle?: string;
    detail?: string;
    progressCurrent?: number;
    progressTotal?: number | null;
    startedAt: number;
    updatedAt: number;
}

const taskMap = new Map<string, KamidereRuntimeTask>();

export function mountKamidereRuntimeActivity() {
    return taskMap.size;
}

export function unmountKamidereRuntimeActivity() {
    return taskMap.size;
}

export function upsertKamidereRuntimeTask(task: Omit<KamidereRuntimeTask, "updatedAt"> & { updatedAt?: number; }) {
    taskMap.set(task.id, {
        ...task,
        updatedAt: task.updatedAt ?? Date.now(),
    });
}

export function removeKamidereRuntimeTask(taskId: string) {
    taskMap.delete(taskId);
}
