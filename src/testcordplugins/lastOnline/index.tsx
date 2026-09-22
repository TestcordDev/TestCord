/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import type { User } from "@vencord/discord-types";
import { React } from "@webpack/common";

import { delPresenceBatch, getAllPresence, putPresenceBatch } from "./db";

const log = new Logger("LastOnline");
const LEGACY_DATASTORE_KEY = "LastOnline_onlineList";
const MAX_DISPLAY_AGE = 604800000; // 7 days, matches the display window
const PRUNE_INTERVAL = 60000; // re-check expirations at most once a minute
let lastPrune = 0;

const settings = definePluginSettings({
    showInServers: {
        type: OptionType.BOOLEAN,
        description: "Also show the last online indicator in server member lists",
        default: false,
        restartNeeded: true
    },
    persistAcrossRestarts: {
        type: OptionType.BOOLEAN,
        description: "Save last online times to a local database so they stay accurate across restarts",
        default: true,
        onChange(newValue: boolean) {
            if (newValue) {
                void loadOnlineList();
            } else if (saveTimer !== null) {
                clearTimeout(saveTimer);
                saveTimer = null;
                dirtyEntries.clear();
                pendingDeletes.clear();
            }
        }
    }
});

interface PresenceStatus {
    hasBeenOnline: boolean;
    lastOffline: number | null;
}

const recentlyOnlineList: Map<string, PresenceStatus> = new Map();
const dirtyEntries = new Map<string, PresenceStatus>();
const pendingDeletes = new Set<string>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function pruneOnlineList() {
    // Time-based pruning doesn't need per-flush precision. The map can hold
    // tens of thousands of persisted entries, so a full iteration on every
    // debounced flush showed up as a multi-ms main-thread spike.
    const now = Date.now();
    if (now - lastPrune < PRUNE_INTERVAL) return;
    lastPrune = now;
    for (const [userId, status] of recentlyOnlineList) {
        if (status.lastOffline !== null && now - status.lastOffline > MAX_DISPLAY_AGE) {
            recentlyOnlineList.delete(userId);
            dirtyEntries.delete(userId);
            pendingDeletes.add(userId);
        }
    }
}

// Batch presence writes into a single idb transaction so bursts of updates cost one write
function saveOnlineList() {
    if (!settings.store.persistAcrossRestarts) return;
    if (saveTimer !== null) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        pruneOnlineList();
        flushWrites();
    }, 2000);
}

function flushWrites() {
    if (!settings.store.persistAcrossRestarts) {
        dirtyEntries.clear();
        pendingDeletes.clear();
        return;
    }
    const entries = [...dirtyEntries];
    dirtyEntries.clear();
    const deletes = [...pendingDeletes];
    pendingDeletes.clear();
    if (entries.length) {
        putPresenceBatch(entries).catch(e => log.error("Failed to save presence to idb:", e));
    }
    if (deletes.length) {
        delPresenceBatch(deletes).catch(e => log.error("Failed to delete presence from idb:", e));
    }
}

async function loadOnlineList() {
    if (!settings.store.persistAcrossRestarts) return;
    try {
        const storedData = await getAllPresence();
        for (const [userId, status] of Object.entries(storedData)) {
            recentlyOnlineList.set(userId, status);
        }
    } catch (e) {
        log.error("Failed to load presence from idb:", e);
    }

    // One-time migration from the old DataStore key
    try {
        const legacy = await DataStore.get<Record<string, PresenceStatus>>(LEGACY_DATASTORE_KEY);
        if (legacy && typeof legacy === "object") {
            let migrated = 0;
            for (const [userId, status] of Object.entries(legacy)) {
                if (!recentlyOnlineList.has(userId)) {
                    recentlyOnlineList.set(userId, status);
                    dirtyEntries.set(userId, status);
                    migrated++;
                }
            }
            if (migrated > 0) {
                flushWrites();
                await DataStore.del(LEGACY_DATASTORE_KEY);
                log.info(`Migrated ${migrated} presence records from DataStore to idb`);
            }
        }
    } catch (e) {
        log.error("Failed to migrate legacy presence data:", e);
    }
}

function handlePresenceUpdate(status: string, userId: string) {
    let changed = false;
    if (recentlyOnlineList.has(userId)) {
        const presenceStatus = recentlyOnlineList.get(userId)!;
        if (status !== "offline") {
            if (!presenceStatus.hasBeenOnline || presenceStatus.lastOffline !== null) {
                presenceStatus.hasBeenOnline = true;
                presenceStatus.lastOffline = null;
                changed = true;
            }
        } else if (presenceStatus.hasBeenOnline && presenceStatus.lastOffline == null) {
            presenceStatus.lastOffline = Date.now();
            changed = true;
        }
    } else {
        // Never seen before. If first sighting is offline we don't know when
        // they went offline, so don't record a bogus "just now" timestamp.
        if (status === "offline") return;
        recentlyOnlineList.set(userId, {
            hasBeenOnline: true,
            lastOffline: null
        });
        changed = true;
    }
    // Only schedule a write when something actually changed
    if (changed) {
        dirtyEntries.set(userId, recentlyOnlineList.get(userId)!);
        saveOnlineList();
    }
}

function formatTime(time: number) {
    const diff = Date.now() - time;
    const d = Math.floor(diff / (1000 * 60 * 60 * 24));
    const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (d > 0) return `${d}d`;
    if (h > 0) return `${h}h`;
    if (m > 0) return `${m}m`;
    return "1m";
}

export default definePlugin({
    name: "LastOnline",
    description: "Adds a last online indicator under usernames in your DM list",
    tags: ["Friends", "Utility"],
    authors: [TestcordDevs.x2b],
    settings,
    flux: {
        PRESENCE_UPDATES({ updates }: { updates?: Array<{ user?: { id?: string; }; status?: string; }>; }) {
            if (!Array.isArray(updates)) return;
            // Login/guild-switch bursts can carry thousands of entries. The
            // bookkeeping below is cheap per entry but blocks the dispatch
            // (and every other subscriber) in aggregate, so huge batches are
            // processed just off the dispatch path. Results are identical,
            // only delayed by a tick.
            if (updates.length > 200) {
                const batch = updates;
                setTimeout(() => {
                    for (const update of batch) {
                        if (update?.user?.id) {
                            handlePresenceUpdate(update.status ?? "offline", update.user.id);
                        }
                    }
                }, 0);
                return;
            }
            for (const update of updates) {
                if (update?.user?.id) {
                    handlePresenceUpdate(update.status ?? "offline", update.user.id);
                }
            }
        }
    },

    start() {
        log.info("LastOnline plugin started");

        void loadOnlineList();

        try {
            // Lazy import to avoid early execution
            const { addMemberListDecorator } = require("@api/MemberListDecorators");

            // DM member list is the default surface
            addMemberListDecorator("last-online-indicator", props => {
                if (!props.user) {
                    return null;
                }
                if (this.shouldShowRecentlyOffline(props.user)) {
                    return this.buildRecentlyOffline(props.user);
                }
                return null;
            }, "dms");

            if (settings.store.showInServers) {
                addMemberListDecorator("last-online-indicator-servers", props => {
                    if (!props.user) {
                        return null;
                    }
                    if (this.shouldShowRecentlyOffline(props.user)) {
                        return this.buildRecentlyOffline(props.user);
                    }
                    return null;
                }, "guilds");
            }

            log.info("LastOnline decorators added");
        } catch (e) {
            log.error("Failed to add member list decorator:", e);
        }
    },
    stop() {
        try {
            const { removeMemberListDecorator } = require("@api/MemberListDecorators");
            removeMemberListDecorator("last-online-indicator");
            removeMemberListDecorator("last-online-indicator-servers");
        } catch (e) {
            log.error("Failed to remove member list decorator:", e);
        }
        // Flush any pending debounced write so data isn't lost, and clear the timer
        if (saveTimer !== null) {
            clearTimeout(saveTimer);
            saveTimer = null;
        }
        lastPrune = 0; // force the final prune below despite throttling
        pruneOnlineList();
        flushWrites();
    },
    shouldShowRecentlyOffline(user: User) {
        const presenceStatus = recentlyOnlineList.get(user.id);
        if (!presenceStatus) {
            return false;
        }

        const shouldShow = presenceStatus.hasBeenOnline && presenceStatus.lastOffline !== null;
        if (shouldShow) {
            const timeSinceOffline = Date.now() - (presenceStatus.lastOffline || 0);
            // Only show if offline for less than 7 days (604800000 ms)
            if (timeSinceOffline > MAX_DISPLAY_AGE) {
                return false;
            }
        }

        return shouldShow;
    },
    buildRecentlyOffline(user: User) {
        const presenceStatus = recentlyOnlineList.get(user.id);
        if (!presenceStatus) {
            return null;
        }

        let text: string;
        if (presenceStatus.lastOffline === null) {
            text = "now";
        } else {
            const formattedTime = formatTime(presenceStatus.lastOffline);
            text = `${formattedTime} ago`;
        }

        return (
            <div
                style={{
                    color: "var(--text-muted)",
                    fontSize: "12px",
                    lineHeight: "16px",
                    marginTop: "2px"
                }}
            >
                Last online <strong>{text}</strong>
            </div>
        );
    }
});
