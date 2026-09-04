/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type JumpListener = (pluginName: string) => void;

const jumpListeners = new Set<JumpListener>();
let pendingJumpQuery: string | null = null;
let pluginsTabOpener: (() => void) | null = null;

export function registerJumpListener(listener: JumpListener) {
    jumpListeners.add(listener);
    if (pendingJumpQuery) {
        const query = pendingJumpQuery;
        pendingJumpQuery = null;
        listener(query);
    }
    return () => {
        jumpListeners.delete(listener);
    };
}

export function setPluginsTabOpener(opener: () => void) {
    pluginsTabOpener = opener;
}

export function jumpToPlugin(pluginName: string) {
    if (jumpListeners.size > 0) {
        jumpListeners.forEach(listener => listener(pluginName));
    } else {
        pendingJumpQuery = pluginName;
        pluginsTabOpener?.();
    }
}
