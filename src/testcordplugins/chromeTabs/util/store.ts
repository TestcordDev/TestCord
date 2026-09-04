/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DataStore } from "@api/index";
import { NavigationRouter, SelectedChannelStore, SelectedGuildStore } from "@webpack/common";

import { getSyntheticPage, isSyntheticChannelId } from "./pages";
import { logger, settings } from "./settings";
import { PersistedTabs, Tab, TabTarget } from "./types";

const DATASTORE_KEY = "ChromeTabs_tabs_v1";

/** How long to ignore incoming CHANNEL_SELECT events after we navigate ourselves */
const SELF_NAVIGATION_GRACE_MS = 1000;

let tabs: Tab[] = [];
let activeId = -1;
/** most-recently-used order, so closing a tab returns you somewhere sensible */
let activationHistory: number[] = [];

/** Chrome keeps around 25 closed tabs; past that the oldest falls off */
const MAX_CLOSED_TABS = 25;

/** closed tabs, newest last, with their position so Reopen puts them back where they were */
interface ClosedTabEntry {
    tab: Tab;
    index: number;
}
const closedTabs: ClosedTabEntry[] = [];

let nextId = 0;
let currentUserId: string | undefined;

let isSelfNavigating = false;
let selfNavigationTimeout: ReturnType<typeof setTimeout> | undefined;

const listeners = new Set<() => void>();

export function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/**
 * Notifications are coalesced into one microtask: bursts of mutations
 * (drag-reorder swaps, activate + follow-up navigation) collapse into a
 * single listener pass instead of one synchronous re-render each.
 */
let emitScheduled = false;

function emit(persist = true) {
    if (persist) scheduleSave();
    if (emitScheduled) return;
    emitScheduled = true;

    queueMicrotask(() => {
        emitScheduled = false;
        for (const listener of listeners) {
            try {
                listener();
            } catch (error) {
                logger.error("Listener threw", error);
            }
        }
    });
}

/**
 * Persistence is debounced: bursts of mutations (drag-reorder, rapid closes)
 * collapse into a single DataStore write instead of one per change.
 */
let saveTimeout: ReturnType<typeof setTimeout> | undefined;

function scheduleSave() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => void saveTabs(), 400);
}

export function getTabs(): readonly Tab[] {
    return tabs;
}

export function getActiveTabId(): number {
    return activeId;
}

export function getActiveTab(): Tab | undefined {
    return tabs.find(tab => tab.id === activeId);
}

export function getActivationHistory(): readonly number[] {
    return activationHistory;
}

export function getMRUTabs(order: "mru" | "strip" = "mru"): Tab[] {
    if (order === "strip") {
        return [...tabs];
    }

    const currentTabs = tabs;
    const tabMap = new Map<number, Tab>(currentTabs.map(t => [t.id, t]));
    const result: Tab[] = [];
    const seen = new Set<number>();

    // Traverse activationHistory in reverse (newest to oldest)
    for (let i = activationHistory.length - 1; i >= 0; i--) {
        const id = activationHistory[i];
        const tab = tabMap.get(id);
        if (tab && !seen.has(id)) {
            result.push(tab);
            seen.add(id);
        }
    }

    // Any tabs that have not been activated in this session
    for (const tab of currentTabs) {
        if (!seen.has(tab.id)) {
            result.push(tab);
            seen.add(tab.id);
        }
    }

    return result;
}

export function hasClosedTabs(): boolean {
    return closedTabs.length > 0;
}

function recordClosedTab(tab: Tab, index: number) {
    closedTabs.push({ tab, index });
    if (closedTabs.length > MAX_CLOSED_TABS) closedTabs.shift();
}

function normalizeGuildId(guildId: string | null | undefined): string {
    return guildId || "@me";
}

function isSameTarget(tab: TabTarget, target: TabTarget): boolean {
    return tab.channelId === target.channelId
        && normalizeGuildId(tab.guildId) === normalizeGuildId(target.guildId);
}

// #region navigation guard

/**
 * True while a tab click is driving navigation. Flux events that arrive during
 * this window are ours and must not mutate tab state again.
 */
export function isSelfNavigation(): boolean {
    return isSelfNavigating;
}

function beginSelfNavigation() {
    clearTimeout(selfNavigationTimeout);
    isSelfNavigating = true;
    selfNavigationTimeout = setTimeout(() => {
        isSelfNavigating = false;
    }, SELF_NAVIGATION_GRACE_MS);
}

export function endSelfNavigation() {
    clearTimeout(selfNavigationTimeout);
    isSelfNavigating = false;
}

// #endregion

// #region mutations

/**
 * Single insertion point for new tabs, so every path (create, create-after,
 * reopen) emits and persists exactly once.
 */
function insertTabAt(index: number, target: TabTarget, activate = true, messageId?: string): Tab {
    const tab: Tab = {
        id: nextId++,
        guildId: normalizeGuildId(target.guildId),
        channelId: target.channelId,
        messageId
    };

    const next = [...tabs];
    next.splice(Math.max(0, Math.min(index, tabs.length)), 0, tab);
    tabs = next;

    if (activate) activateTab(tab.id);
    else emit();

    return tab;
}

export function createTab(target: TabTarget, activate = true, messageId?: string): Tab {
    return insertTabAt(tabs.length, target, activate, messageId);
}

/** Inserts a tab directly after `afterId`, the way Chrome opens child tabs */
export function createTabAfter(afterId: number, target: TabTarget, activate = true, messageId?: string): Tab {
    return insertTabAt(tabs.findIndex(tab => tab.id === afterId) + 1, target, activate, messageId);
}

export function closeTab(id: number) {
    const index = tabs.findIndex(tab => tab.id === id);
    if (index === -1) return;

    // never leave the strip empty, there would be nothing to render Discord into
    if (tabs.length === 1) return;

    const [closed] = tabs.splice(index, 1);
    tabs = [...tabs];
    recordClosedTab(closed, index);
    activationHistory = activationHistory.filter(historyId => historyId !== id);

    if (id !== activeId) {
        emit();
        return;
    }

    // Chrome falls back to the tab on the right; prefer the most recent tab if we have one
    const previous = activationHistory.at(-1);
    const fallback = (previous != null && tabs.some(tab => tab.id === previous))
        ? previous
        : tabs[Math.min(index, tabs.length - 1)].id;

    activateTab(fallback);
}

export function closeOtherTabs(id: number) {
    const keep = tabs.find(tab => tab.id === id);
    if (!keep) return;

    tabs.forEach((tab, index) => {
        if (tab.id !== id) recordClosedTab(tab, index);
    });
    tabs = [keep];
    activationHistory = [id];

    if (activeId === id) emit();
    else activateTab(id);
}

export function closeTabsToTheRight(id: number) {
    const index = tabs.findIndex(tab => tab.id === id);
    if (index === -1 || index === tabs.length - 1) return;

    const removed = tabs.slice(index + 1);
    removed.forEach((tab, i) => recordClosedTab(tab, index + 1 + i));
    tabs = tabs.slice(0, index + 1);

    const removedIds = new Set(removed.map(tab => tab.id));
    activationHistory = activationHistory.filter(historyId => !removedIds.has(historyId));

    if (removedIds.has(activeId)) activateTab(id);
    else emit();
}

export function closeTabsToTheLeft(id: number) {
    const index = tabs.findIndex(tab => tab.id === id);
    if (index <= 0) return;

    const removed = tabs.slice(0, index);
    removed.forEach((tab, i) => recordClosedTab(tab, i));
    tabs = tabs.slice(index);

    const removedIds = new Set(removed.map(tab => tab.id));
    activationHistory = activationHistory.filter(historyId => !removedIds.has(historyId));

    if (removedIds.has(activeId)) activateTab(id);
    else emit();
}

export function reopenClosedTab() {
    const entry = closedTabs.pop();
    if (!entry) return;

    // put the tab back where it was closed, clamped to the current strip size
    insertTabAt(entry.index, entry.tab, true, entry.tab.messageId);
}

export function moveTab(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= tabs.length) return;
    if (toIndex < 0 || toIndex >= tabs.length) return;

    const next = [...tabs];
    next.splice(toIndex, 0, next.splice(fromIndex, 1)[0]);
    tabs = next;
    emit();
}

/** Points an existing tab at a different channel, e.g. plain navigation */
export function retargetTab(id: number, target: TabTarget, messageId?: string) {
    const index = tabs.findIndex(tab => tab.id === id);
    if (index === -1) return;

    tabs = tabs.map((tab, i) => i === index
        ? { ...tab, guildId: normalizeGuildId(target.guildId), channelId: target.channelId, messageId }
        : tab);

    emit();
}

// #endregion

// #region activation

export function activateTab(id: number) {
    const tab = tabs.find(tab => tab.id === id);
    if (!tab) return logger.error(`No tab with id ${id}`);

    activeId = id;
    activationHistory = [...activationHistory.filter(historyId => historyId !== id), id];

    beginSelfNavigation();
    emit();

    const page = getSyntheticPage(tab.channelId);
    if (page) {
        NavigationRouter.transitionTo(page.route);
        return;
    }

    if (tab.messageId) {
        const { messageId } = tab;
        // consume the jump target so going back to this tab later lands at the bottom
        tabs = tabs.map(t => t.id === id ? { ...t, messageId: undefined } : t);
        NavigationRouter.transitionTo(`/channels/${tab.guildId}/${tab.channelId}/${messageId}`);
        return;
    }

    const alreadyThere = tab.channelId === SelectedChannelStore.getChannelId()
        && normalizeGuildId(tab.guildId) === normalizeGuildId(SelectedGuildStore.getGuildId());

    if (alreadyThere) {
        endSelfNavigation();
        return;
    }

    NavigationRouter.transitionToGuild(tab.guildId, tab.channelId);
}

export function activateTabByIndex(index: number) {
    const tab = tabs[index];
    if (tab) activateTab(tab.id);
}

export function cycleTab(direction: 1 | -1) {
    if (tabs.length < 2) return;

    const index = tabs.findIndex(tab => tab.id === activeId);
    if (index === -1) return;

    activateTab(tabs[(index + direction + tabs.length) % tabs.length].id);
}

// #endregion

/**
 * Reconciles the strip with wherever Discord just navigated. Called from Flux,
 * so it must be cheap and must not navigate again.
 */
export function handleNavigation(target: TabTarget) {
    if (!target.channelId) return;

    const existing = tabs.find(tab => isSameTarget(tab, target));

    if (existing) {
        // already open: just follow it, no matter which setting is on
        if (existing.id !== activeId) {
            activeId = existing.id;
            activationHistory = [...activationHistory.filter(id => id !== existing.id), existing.id];
            emit();
        }
        return;
    }

    if (settings.store.openInNewTab) {
        const active = getActiveTab();
        if (active) createTabAfter(active.id, target, true);
        else createTab(target, true);
        return;
    }

    const active = getActiveTab();
    if (!active) {
        createTab(target, true);
        return;
    }

    if (!isSameTarget(active, target)) retargetTab(active.id, target);
}

/** Handles a click on an already-open tab's target arriving from elsewhere */
export function openTarget(target: TabTarget, activate: boolean, messageId?: string) {
    const existing = tabs.find(tab => isSameTarget(tab, target));
    if (existing && settings.store.switchToExistingTab) {
        if (activate) activateTab(existing.id);
        return;
    }

    const active = getActiveTab();
    if (active) createTabAfter(active.id, target, activate, messageId);
    else createTab(target, activate, messageId);
}

// #region persistence

let saveChain: Promise<unknown> = Promise.resolve();

function saveTabs(): Promise<unknown> {
    if (!currentUserId) return Promise.resolve();
    if (settings.store.onStartup !== "remember") return Promise.resolve();

    const userId = currentUserId;
    const snapshot = {
        tabs: tabs.map(tab => ({ ...tab })),
        activeIndex: Math.max(0, tabs.findIndex(tab => tab.id === activeId))
    };

    saveChain = saveChain
        .catch(() => void 0)
        .then(() => DataStore.update<PersistedTabs>(DATASTORE_KEY, old => ({
            ...(old ?? {}),
            [userId]: snapshot
        })))
        .catch(error => logger.error("Failed to persist tabs", error));

    return saveChain;
}

/**
 * Builds the initial strip for `userId`. Safe to call again on reconnect; it
 * only rebuilds when the account actually changed.
 */
export async function initTabs(userId: string, fallback: TabTarget): Promise<void> {
    if (currentUserId === userId && tabs.length) {
        emit(false);
        return;
    }

    currentUserId = userId;
    tabs = [];
    activationHistory = [];
    closedTabs.length = 0;
    nextId = 0;

    if (settings.store.onStartup === "remember") {
        try {
            const persisted = await DataStore.get<PersistedTabs>(DATASTORE_KEY);
            const saved = persisted?.[userId];

            if (saved?.tabs.length) {
                tabs = saved.tabs.map(tab => ({
                    id: nextId++,
                    guildId: normalizeGuildId(tab.guildId),
                    channelId: tab.channelId
                }));
                activeId = tabs[saved.activeIndex]?.id ?? tabs[0].id;
            }
        } catch (error) {
            logger.error("Failed to restore tabs", error);
        }
    }

    if (!tabs.length) {
        const channelId = fallback.channelId || "__friends__";
        tabs = [{ id: nextId++, guildId: normalizeGuildId(fallback.guildId), channelId }];
        activeId = tabs[0].id;
    }

    activationHistory = [activeId];
    emit(false);

    // put Discord on the restored tab, but don't fight a synthetic page we're already on
    const active = getActiveTab();
    if (active && !isSameTarget(active, {
        guildId: normalizeGuildId(fallback.guildId),
        channelId: fallback.channelId
    })) {
        activateTab(active.id);
    }
}

// #endregion

/** Exposed for the plugin's `util` field, mostly useful when debugging in console */
export const debug = {
    get tabs() {
        return tabs;
    },
    get activeId() {
        return activeId;
    },
    get closedTabs() {
        return closedTabs;
    },
    isSyntheticChannelId
};
