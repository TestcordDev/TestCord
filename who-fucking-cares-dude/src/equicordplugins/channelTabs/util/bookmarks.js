/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { DataStore } from "@api/index";
import { useAwaiter } from "@utils/react";
import { ChannelStore, useCallback, UserStore, useState } from "@webpack/common";
import { bookmarkFolderColors, logger } from "./constants";
export function isBookmarkFolder(bookmark) {
    return "bookmarks" in bookmark;
}
export function bookmarkPlaceholderName(bookmark) {
    if (isBookmarkFolder(bookmark))
        return "Folder";
    const { channelId } = bookmark;
    // handle special synthetic pages
    if (channelId?.startsWith("__")) {
        const specialPagesMap = {
            "__quests__": "Quests",
            "__message-requests__": "Message Requests",
            "__friends__": "Friends",
            "__shop__": "Shop",
            "__library__": "Library",
            "__discovery__": "Discovery",
            "__nitro__": "Nitro",
            "__icymi__": "ICYMI",
            "__activity__": "Activity",
        };
        return specialPagesMap[channelId] || "Special Page";
    }
    const channel = ChannelStore.getChannel(channelId);
    if (!channel)
        return "Bookmark";
    if (channel.name)
        return `#${channel.name}`;
    if (channel.recipients)
        return UserStore.getUser(channel.recipients?.[0])?.username
            ?? "Unknown User";
    return "Bookmark";
}
export function useBookmarks(userId) {
    const [bookmarks, _setBookmarks] = useState({});
    const setBookmarks = useCallback((bookmarks) => {
        _setBookmarks(bookmarks);
        DataStore.update("ChannelTabs_bookmarks", old => ({
            ...old,
            [userId]: bookmarks[userId]
        }));
    }, [userId]);
    useAwaiter(() => DataStore.get("ChannelTabs_bookmarks"), {
        fallbackValue: undefined,
        onSuccess(bookmarks) {
            if (!bookmarks) {
                bookmarks = { [userId]: [] };
                DataStore.set("ChannelTabs_bookmarks", { [userId]: [] });
            }
            if (!bookmarks[userId])
                bookmarks[userId] = [];
            setBookmarks(bookmarks);
        },
    });
    const methods = {
        addBookmark: (bookmark, folderIndex) => {
            if (!bookmarks)
                return;
            if (typeof folderIndex === "number" && !(isBookmarkFolder(bookmarks[userId][folderIndex])))
                return logger.error("Attempted to add bookmark to non-folder " + folderIndex, bookmarks);
            const name = bookmark.name ?? bookmarkPlaceholderName(bookmark);
            if (typeof folderIndex === "number")
                bookmarks[userId][folderIndex].bookmarks.push({ ...bookmark, name });
            else
                bookmarks[userId].push({ ...bookmark, name });
            setBookmarks({
                ...bookmarks
            });
        },
        addFolder(name, iconColor, iconName) {
            if (!bookmarks)
                return;
            const length = bookmarks[userId].push({
                name: name?.trim() || "Folder",
                iconColor: iconColor ?? bookmarkFolderColors.Black,
                iconName,
                bookmarks: []
            });
            setBookmarks({
                ...bookmarks
            });
            return length - 1;
        },
        editBookmark(index, newBookmark) {
            if (!bookmarks)
                return;
            Object.entries(newBookmark).forEach(([k, v]) => {
                bookmarks[userId][index][k] = v;
            });
            setBookmarks({
                ...bookmarks
            });
        },
        deleteBookmark(index, folderIndex) {
            if (!bookmarks)
                return;
            if (typeof folderIndex === "number") {
                const folder = bookmarks[userId][folderIndex];
                if (!isBookmarkFolder(folder))
                    return logger.error("Attempted to delete bookmark from non-folder " + folderIndex, bookmarks);
                if (index < 0 || index > (folder.bookmarks.length - 1))
                    return logger.error("Attempted to delete bookmark at index " + index, bookmarks);
                folder.bookmarks.splice(index, 1);
            }
            else {
                if (index < 0 || index > (bookmarks[userId].length - 1))
                    return logger.error("Attempted to delete bookmark at index " + index, bookmarks);
                bookmarks[userId].splice(index, 1);
            }
            setBookmarks({
                ...bookmarks
            });
        },
        moveDraggedBookmarks(index1, index2) {
            if (index1 < 0 || index2 > bookmarks[userId].length)
                return logger.error(`Out of bounds drag (swap between indexes ${index1} and ${index2})`, bookmarks);
            const firstItem = bookmarks[userId].splice(index1, 1)[0];
            bookmarks[userId].splice(index2, 0, firstItem);
            setBookmarks({
                ...bookmarks
            });
        }
    };
    return [bookmarks[userId], methods];
}
