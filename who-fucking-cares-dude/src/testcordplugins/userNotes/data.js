/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { clear, createStore, del, entries, set, setMany, } from "@api/DataStore";
import { Settings } from "@api/Settings";
import { sleep } from "@utils/misc";
import { UserUtils } from "@webpack/common";
const NotesStore = createStore("UserNotesData", "UserNotesStore");
export const usersNotes = new Map();
const cacheUsersNotes = async () => {
    entries(NotesStore).then(usersNotesDB => {
        usersNotesDB.forEach(([userId, userNotes]) => {
            usersNotes.set(userId, userNotes);
        });
    });
};
// Settings is initialized before the plugins bundle evaluates; the plugin
// registry itself is not, so read the enabled state from Settings directly.
if (Settings.plugins.UserNotes?.enabled !== false)
    cacheUsersNotes();
export const getUserNotes = (userId) => {
    return usersNotes.get(userId);
};
export const saveUserNotes = async (userId, userNotes) => {
    if (userNotes.trim() === "") {
        usersNotes.delete(userId);
        await del(userId, NotesStore);
    }
    else {
        usersNotes.set(userId, userNotes);
        await set(userId, userNotes, NotesStore);
    }
};
export const deleteUserNotes = async (userId) => {
    if (!usersNotes.get(userId))
        return;
    usersNotes.delete(userId);
    await del(userId, NotesStore);
};
export const clearUserNotes = async () => {
    usersNotes.clear();
    await clear(NotesStore);
};
export const transferUserNotes = async (regularUsersNotes) => {
    await setMany(Object.keys(regularUsersNotes).reduce((usersNotesDB, userId) => {
        const userNotes = regularUsersNotes[userId];
        usersNotesDB.push([userId, userNotes]);
        usersNotes.set(userId, userNotes);
        return usersNotesDB;
    }, []), NotesStore);
};
export const usersCache = new Map();
const fetchUser = async (userId) => {
    for (let _ = 0; _ < 10; _++) {
        try {
            return await UserUtils.getUser(userId);
        }
        catch (error) {
            const wait = error?.body?.retry_after;
            if (!wait)
                break;
            await sleep(wait * 1000 + 50);
        }
    }
};
const states = {};
export const setupStates = ({ setRunning, setCacheStatus, }) => {
    states.setRunning = setRunning;
    states.setCacheStatus = setCacheStatus;
};
let isRunning = false;
export const getRunning = () => {
    return isRunning;
};
let cacheProcessNeedStop = false;
export const stopCacheProcess = () => {
    cacheProcessNeedStop = true;
};
export const cacheUsers = async (onlyMissing = false) => {
    isRunning = true;
    states.setRunning?.(true);
    onlyMissing || usersCache.clear();
    for (const userId of usersNotes.keys()) {
        if (cacheProcessNeedStop) {
            cacheProcessNeedStop = false;
            break;
        }
        if (onlyMissing && usersCache.get(userId))
            continue;
        const user = await fetchUser(userId);
        if (user) {
            usersCache.set(user.id, {
                globalName: user.globalName,
                username: user.username,
            });
            states.setCacheStatus?.(usersCache.size);
        }
    }
    isRunning = false;
    states.setRunning?.(false);
};
