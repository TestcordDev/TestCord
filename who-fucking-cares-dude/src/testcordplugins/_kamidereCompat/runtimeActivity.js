/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
const taskMap = new Map();
export function mountKamidereRuntimeActivity() {
    return taskMap.size;
}
export function unmountKamidereRuntimeActivity() {
    return taskMap.size;
}
export function upsertKamidereRuntimeTask(task) {
    taskMap.set(task.id, {
        ...task,
        updatedAt: task.updatedAt ?? Date.now(),
    });
}
export function removeKamidereRuntimeTask(taskId) {
    taskMap.delete(taskId);
}
