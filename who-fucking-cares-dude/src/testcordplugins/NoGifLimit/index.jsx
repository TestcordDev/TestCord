/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { ChatBarButton } from "@api/ChatButtons";
import { findGroupChildrenByChildId } from "@api/ContextMenu";
import { DataStore } from "@api/index";
import { definePluginSettings } from "@api/Settings";
import { PencilIcon } from "@components/Icons";
import { TestcordDevs } from "@utils/constants";
import { getCurrentChannel, sendMessage } from "@utils/discord";
import { ModalContent, ModalFooter, ModalHeader, ModalRoot, openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { ChannelStore, Menu, React, showToast, Toasts, useState } from "@webpack/common";
import GifCaptionerModal from "../gifCaptioner/ui/modal";
import { showError as showCaptionError } from "../gifCaptioner/ui/statusCard";
import { fetchMedia } from "../gifCaptioner/utils/fetchMedia";
import { inspectMedia } from "../gifCaptioner/utils/media";
const DATA_KEY = "heartGifs-data";
const FOLDERS_KEY = "heartGifs-folders";
const MAX_STORED_ITEMS = 1000;
const MAX_CACHED_MEDIA_BYTES = 32 * 1024 * 1024;
const MAX_CACHED_ITEM_BYTES = 8 * 1024 * 1024;
var MediaType;
(function (MediaType) {
    MediaType["GIF"] = "gif";
    MediaType["IMAGE"] = "image";
    MediaType["VIDEO"] = "video";
    MediaType["AUDIO"] = "audio";
    MediaType["FILE"] = "file";
})(MediaType || (MediaType = {}));
function generateId() {
    return "nogl-" + Date.now() + "-" + Math.random().toString(36).substr(2, 9);
}
function getCurrentDiscordFavoriteUrls() {
    try {
        const wreq = window.Vencord?.Webpack?.wreq;
        if (!wreq?.c)
            return new Set();
        for (const key of Object.keys(wreq.c)) {
            try {
                const m = wreq.c[key].exports;
                if (m?.bW && typeof m.bW === "object" && typeof m.bW.getCurrentValue === "function") {
                    const gifs = m.bW.getCurrentValue()?.favoriteGifs?.gifs ?? {};
                    return new Set(Object.keys(gifs));
                }
            }
            catch { }
        }
    }
    catch { }
    return new Set();
}
const settings = definePluginSettings({
    showNotifications: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show notifications when adding items",
        default: true,
    },
    allowTenor: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Allow saving Tenor GIFs",
        default: true,
    },
    enableGifs: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Allow saving GIFs",
        default: true,
    },
    enableImages: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Allow saving images",
        default: true,
    },
    enableVideos: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Allow saving videos",
        default: true,
    },
    enableAudio: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Allow saving audio files",
        default: true,
    },
    enableFiles: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Allow saving other files",
        default: true,
    },
    gridSize: {
        type: 4 /* OptionType.SELECT */,
        description: "Grid size for items",
        options: [
            { label: "Small (150px)", value: "150", default: false },
            { label: "Medium (200px)", value: "200", default: true },
            { label: "Large (250px)", value: "250", default: false },
            { label: "Extra Large (300px)", value: "300", default: false }
        ]
    }
});
function isTenorUrl(url) {
    var lowerUrl = url.toLowerCase();
    return lowerUrl.indexOf("tenor.com") !== -1 ||
        lowerUrl.indexOf("media.tenor") !== -1 ||
        lowerUrl.indexOf("c.tenor.com") !== -1;
}
function isGiphyUrl(url) {
    var lowerUrl = url.toLowerCase();
    return lowerUrl.indexOf("giphy.com") !== -1 ||
        lowerUrl.indexOf("media.giphy") !== -1;
}
async function getStoredItems() {
    try {
        var data = await DataStore.get(DATA_KEY);
        return Array.isArray(data) ? data : [];
    }
    catch {
        return [];
    }
}
async function saveItems(items) {
    pruneItems(items);
    await DataStore.set(DATA_KEY, items);
}
function pruneItems(items) {
    if (items.length > MAX_STORED_ITEMS)
        items.length = MAX_STORED_ITEMS;
    let cachedBytes = 0;
    for (const item of items)
        cachedBytes += item.cachedUrl?.length ?? 0;
    for (var i = items.length - 1; i >= 0 && cachedBytes > MAX_CACHED_MEDIA_BYTES; i--) {
        const { cachedUrl } = items[i];
        if (!cachedUrl)
            continue;
        cachedBytes -= cachedUrl.length;
        items[i].cachedUrl = undefined;
    }
}
async function getStoredFolders() {
    try {
        var data = await DataStore.get(FOLDERS_KEY);
        return Array.isArray(data) ? data : [];
    }
    catch {
        return [];
    }
}
async function saveFolders(folders) {
    await DataStore.set(FOLDERS_KEY, folders);
}
function getMediaType(url) {
    var lowerUrl = url.toLowerCase();
    if (/\.gif(\?.*)?$/i.test(lowerUrl))
        return MediaType.GIF;
    if (/\.(jpg|jpeg|png|webp|avif|svg)(\?.*)?$/i.test(lowerUrl))
        return MediaType.IMAGE;
    if (/\.(mp4|webm|mov|avi|mkv)(\?.*)?$/i.test(lowerUrl))
        return MediaType.VIDEO;
    if (/\.(mp3|wav|ogg|flac|aac|m4a)(\?.*)?$/i.test(lowerUrl))
        return MediaType.AUDIO;
    if (isTenorUrl(url) || isGiphyUrl(url)) {
        return MediaType.GIF;
    }
    if (lowerUrl.indexOf("media.discordapp.net") !== -1 || lowerUrl.indexOf("cdn.discordapp.com") !== -1) {
        if (/\/attachments\//i.test(lowerUrl)) {
            if (/\.gif(\?.*)?$/i.test(lowerUrl))
                return MediaType.GIF;
            if (/\.(mp4|webm|mov|avi|mkv)(\?.*)?$/i.test(lowerUrl))
                return MediaType.VIDEO;
            if (/\.(jpg|jpeg|png|webp|avif|svg)(\?.*)?$/i.test(lowerUrl))
                return MediaType.IMAGE;
            return MediaType.IMAGE;
        }
    }
    return MediaType.FILE;
}
function isTypeEnabled(type) {
    switch (type) {
        case MediaType.GIF: return settings.store.enableGifs;
        case MediaType.IMAGE: return settings.store.enableImages;
        case MediaType.VIDEO: return settings.store.enableVideos;
        case MediaType.AUDIO: return settings.store.enableAudio;
        case MediaType.FILE: return settings.store.enableFiles;
        default: return false;
    }
}
async function addToLocal(item) {
    var items = await getStoredItems();
    if (items.some(function (g) { return g.url === item.url; })) {
        return false;
    }
    // Skip if already in Discord favorites
    const discordFavs = getCurrentDiscordFavoriteUrls();
    if (discordFavs.has(item.url)) {
        return false;
    }
    var newItem = {
        id: generateId(),
        url: item.url,
        src: item.src || item.url,
        width: item.width || 498,
        height: item.height || 280,
        type: item.type,
        filename: item.filename,
        addedAt: Date.now(),
        folderId: item.folderId
    };
    items.unshift(newItem);
    await saveItems(items);
    if (newItem.type === MediaType.GIF || newItem.type === MediaType.IMAGE) {
        cacheItemMedia(newItem.id, newItem.src).catch(function () { });
    }
    return true;
}
async function removeFromLocal(id) {
    var items = await getStoredItems();
    var index = items.findIndex(function (g) { return g.id === id; });
    if (index === -1)
        return false;
    items.splice(index, 1);
    await saveItems(items);
    return true;
}
async function cacheItemMedia(id, url) {
    try {
        var response = await fetch(url);
        if (!response.ok)
            return;
        var length = Number(response.headers.get("content-length"));
        if (length > MAX_CACHED_ITEM_BYTES)
            return;
        var blob = await response.blob();
        if (blob.size > MAX_CACHED_ITEM_BYTES)
            return;
        var dataUrl = await new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () { resolve(reader.result); };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
        var items = await getStoredItems();
        var item = items.find(function (i) { return i.id === id; });
        if (item && !item.cachedUrl) {
            item.cachedUrl = dataUrl;
            await saveItems(items);
        }
    }
    catch {
        // Caching is best-effort
    }
}
async function moveToFolder(itemId, folderId) {
    var items = await getStoredItems();
    var item = items.find(function (g) { return g.id === itemId; });
    if (!item)
        return false;
    item.folderId = folderId || undefined;
    await saveItems(items);
    return true;
}
async function createFolder(name, icon = "[F]") {
    var folders = await getStoredFolders();
    var newFolder = {
        id: generateId(),
        name: name,
        icon: icon,
        itemIds: [],
        createdAt: Date.now()
    };
    folders.push(newFolder);
    await saveFolders(folders);
    return newFolder;
}
async function deleteFolder(folderId) {
    var folders = await getStoredFolders();
    var index = folders.findIndex(function (f) { return f.id === folderId; });
    if (index === -1)
        return false;
    var items = await getStoredItems();
    for (var i = 0; i < items.length; i++) {
        if (items[i].folderId === folderId) {
            items[i].folderId = undefined;
        }
    }
    await saveItems(items);
    folders.splice(index, 1);
    await saveFolders(folders);
    return true;
}
function notify(body, type = "info") {
    if (!settings.store.showNotifications)
        return;
    var toastType = Toasts.Type.MESSAGE;
    if (type === "success")
        toastType = Toasts.Type.SUCCESS;
    else if (type === "error")
        toastType = Toasts.Type.FAILURE;
    showToast(body, toastType);
}
function HeartIcon() {
    return React.createElement("svg", { width: 24, height: 24, viewBox: "0 0 24 24", fill: "currentColor", xmlns: "http://www.w3.org/2000/svg" }, React.createElement("path", { d: "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" }));
}
function HeartGifPopoverIcon() {
    return React.createElement("svg", { width: "1em", height: "1em", viewBox: "0 0 24 24", fill: "currentColor", style: { fontSize: "18px" } }, React.createElement("path", { d: "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" }));
}
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    }
    catch {
        return false;
    }
}
async function sendToChat(item) {
    var channel = getCurrentChannel();
    if (!channel) {
        notify("No channel selected", "error");
        return false;
    }
    try {
        await sendMessage(channel.id, { content: item.url });
        notify("Sent to chat!", "success");
        return true;
    }
    catch {
        notify("Failed to send to chat", "error");
        return false;
    }
}
async function exportToGifTransfer() {
    var items = await getStoredItems();
    if (items.length === 0) {
        notify("No items to export", "error");
        return;
    }
    var gifs = items.map(function (item, index) {
        return {
            url: item.url,
            src: item.src || item.url,
            width: item.width || 498,
            height: item.height || 280,
            format: 2,
            order: items.length - index
        };
    });
    var exportData = {
        version: 2,
        exportedAt: new Date().toISOString(),
        totalGifs: gifs.length,
        gifs: gifs
    };
    var blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "heartgifs-" + Date.now() + ".json";
    a.click();
    notify("Exported " + gifs.length + " items!", "success");
}
async function importFromGifTransfer(file) {
    try {
        var text = await file.text();
        var data = JSON.parse(text);
        if (!data.gifs || !Array.isArray(data.gifs)) {
            notify("Invalid file format", "error");
            return;
        }
        var currentItems = await getStoredItems();
        var currentUrls = new Set(currentItems.map(function (i) { return i.url; }));
        var discordFavs = getCurrentDiscordFavoriteUrls();
        var importedItems = [];
        var added = 0;
        var skipped = 0;
        for (var i = 0; i < data.gifs.length; i++) {
            var gif = data.gifs[i];
            if (currentUrls.has(gif.url)) {
                skipped++;
                continue;
            }
            if (!settings.store.allowTenor && (isTenorUrl(gif.url) || isGiphyUrl(gif.url))) {
                skipped++;
                continue;
            }
            var mediaType = getMediaType(gif.url);
            if (!isTypeEnabled(mediaType)) {
                skipped++;
                continue;
            }
            if (discordFavs.has(gif.url)) {
                skipped++;
                continue;
            }
            importedItems.push({
                id: generateId(),
                url: gif.url,
                src: gif.src || gif.url,
                width: Number(gif.width) || 498,
                height: Number(gif.height) || 280,
                type: mediaType,
                addedAt: Date.now()
            });
            currentUrls.add(gif.url);
            added++;
        }
        if (importedItems.length) {
            currentItems.unshift(...importedItems.reverse());
            await saveItems(currentItems);
        }
        notify("Imported " + added + " items! (" + skipped + " skipped)", "success");
    }
    catch {
        notify("Failed to import", "error");
    }
}
function openImportPicker() {
    var input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = function (e) {
        var file = e.target.files?.[0];
        if (file) {
            importFromGifTransfer(file);
        }
    };
    input.click();
}
async function deleteAllItems() {
    await saveItems([]);
    await saveFolders([]);
}
function getMediaIcon(type) {
    switch (type) {
        case MediaType.GIF: return React.createElement("span", null, "🎞️");
        case MediaType.IMAGE: return React.createElement("span", null, "🖼️");
        case MediaType.VIDEO: return React.createElement("span", null, "🎥");
        case MediaType.AUDIO: return React.createElement("span", null, "🔊");
        case MediaType.FILE: return React.createElement("span", null, "📁");
        default: return React.createElement("span", null, "❓");
    }
}
function getTypeLabel(type) {
    switch (type) {
        case MediaType.GIF: return "GIF";
        case MediaType.IMAGE: return "Image";
        case MediaType.VIDEO: return "Video";
        case MediaType.AUDIO: return "Audio";
        case MediaType.FILE: return "File";
        default: return "Unknown";
    }
}
function NoGifLimitModal({ modalProps }) {
    var itemsState = useState([]);
    var setItems = itemsState[1];
    var items = itemsState[0];
    var foldersState = useState([]);
    var setFolders = foldersState[1];
    var folders = foldersState[0];
    var searchQueryState = useState("");
    var searchQuery = searchQueryState[0];
    var setSearchQuery = searchQueryState[1];
    var showAddInputState = useState(false);
    var showAddInput = showAddInputState[0];
    var setShowAddInput = showAddInputState[1];
    var newUrlState = useState("");
    var newUrl = newUrlState[0];
    var setNewUrl = newUrlState[1];
    var selectedItemsState = useState(new Set());
    var selectedItems = selectedItemsState[0];
    var setSelectedItems = selectedItemsState[1];
    var activeFolderState = useState(null);
    var activeFolder = activeFolderState[0];
    var setActiveFolder = activeFolderState[1];
    var showFolderModalState = useState(false);
    var showFolderModal = showFolderModalState[0];
    var setShowFolderModal = showFolderModalState[1];
    var newFolderNameState = useState("");
    var newFolderName = newFolderNameState[0];
    var setNewFolderName = newFolderNameState[1];
    var newFolderIconState = useState("[F]");
    var newFolderIcon = newFolderIconState[0];
    var setNewFolderIcon = newFolderIconState[1];
    var isDraggingState = useState(false);
    var isDragging = isDraggingState[0];
    var setIsDragging = isDraggingState[1];
    var imageErrorsState = useState({});
    var imageErrors = imageErrorsState[0];
    var setImageErrors = imageErrorsState[1];
    var overrideSrcState = useState({});
    var overrideSrc = overrideSrcState[0];
    var setOverrideSrc = overrideSrcState[1];
    var scrollContainerRef = React.useRef(null);
    var tenorFallbackRef = React.useRef(new Set());
    var searchInputRef = React.useRef(null);
    var folderInputRef = React.useRef(null);
    var handleImageError = function (id) {
        if (!tenorFallbackRef.current.has(id)) {
            var item = items.find(function (i) { return i.id === id; });
            if (item) {
                var mediaUrl = item.src || item.url;
                if (mediaUrl.indexOf("tenor.com") !== -1 && /\.mp4(\?.*)?$/i.test(mediaUrl)) {
                    var gifUrl = mediaUrl.replace(/\.mp4(\?.*)?$/i, ".gif");
                    setOverrideSrc(function (prev) { var o = {}; for (var k in prev)
                        o[k] = prev[k]; o[id] = gifUrl; return o; });
                    return;
                }
                if (mediaUrl.indexOf("giphy.com") !== -1) {
                    var giphyIdMatch = mediaUrl.match(/giphy\.com\/gifs\/([^/?]+)/);
                    if (giphyIdMatch && giphyIdMatch[1]) {
                        var giphyId = giphyIdMatch[1];
                        setOverrideSrc(function (prev) { var o = {}; for (var k in prev)
                            o[k] = prev[k]; o[id] = "https://media.giphy.com/media/" + giphyId + "/200.gif"; return o; });
                        return;
                    }
                }
            }
        }
        setImageErrors(function (prev) { var o = {}; for (var k in prev)
            o[k] = prev[k]; o[id] = true; return o; });
    };
    var handleImageLoad = function (id) {
        setImageErrors(function (prev) {
            if (!prev[id])
                return prev;
            var newErrors = {};
            for (var k in prev)
                if (k !== id)
                    newErrors[k] = prev[k];
            return newErrors;
        });
    };
    React.useEffect(function () {
        getStoredItems().then(setItems);
        getStoredFolders().then(setFolders);
    }, []);
    var filteredItems = items.filter(function (item) {
        var searchLower = searchQuery.toLowerCase();
        var matchesSearch = item.url.toLowerCase().indexOf(searchLower) !== -1 ||
            (item.filename || "").toLowerCase().indexOf(searchLower) !== -1;
        if (!matchesSearch && item.folderId) {
            var folder = folders.find(function (f) { return f.id === item.folderId; });
            if (folder) {
                matchesSearch = folder.name.toLowerCase().indexOf(searchLower) !== -1;
            }
        }
        var matchesFolder = activeFolder === null ? true : item.folderId === activeFolder;
        return matchesSearch && matchesFolder;
    });
    var getFolderItems = function (folderId) { return items.filter(function (item) { return item.folderId === folderId; }); };
    var handleItemClick = async function (item, e) {
        if (e && (e.ctrlKey || e.metaKey)) {
            setSelectedItems(function (prev) {
                var newSet = new Set(prev);
                if (newSet.has(item.id)) {
                    newSet.delete(item.id);
                }
                else {
                    newSet.add(item.id);
                }
                return newSet;
            });
            return;
        }
        if (selectedItems.size > 0) {
            setSelectedItems(new Set());
        }
        var success = await sendToChat(item);
        if (success) {
            if (!item.cachedUrl && (item.type === MediaType.GIF || item.type === MediaType.IMAGE)) {
                var mediaUrl = item.src || item.url;
                if (mediaUrl.indexOf("data:") !== 0) {
                    cacheItemMedia(item.id, mediaUrl).catch(function () { });
                }
            }
            modalProps.onClose();
        }
    };
    var handleAddItem = async function () {
        if (!newUrl)
            return;
        try {
            new URL(newUrl);
        }
        catch {
            notify("Invalid URL", "error");
            return;
        }
        if (!settings.store.allowTenor && (isTenorUrl(newUrl) || isGiphyUrl(newUrl))) {
            notify("Tenor/Giphy is disabled in settings", "error");
            return;
        }
        var mediaType = getMediaType(newUrl);
        if (!isTypeEnabled(mediaType)) {
            notify("Saving " + mediaType + " type is disabled in settings", "error");
            return;
        }
        var success = await addToLocal({ url: newUrl, src: newUrl, width: 498, height: 280, type: mediaType, folderId: activeFolder || undefined });
        if (success) {
            var updatedItems = await getStoredItems();
            setItems(updatedItems);
            setNewUrl("");
            setShowAddInput(false);
            notify("Item added!", "success");
        }
        else {
            notify("Item already exists", "info");
        }
    };
    var handleRemoveItem = async function (id) {
        await removeFromLocal(id);
        var updatedItems = await getStoredItems();
        setItems(updatedItems);
        notify("Item removed", "info");
    };
    var handleDragOver = function (e) {
        e.preventDefault();
        setIsDragging(true);
    };
    var handleDragLeave = function (e) {
        e.preventDefault();
        setIsDragging(false);
    };
    var handleDrop = function (e) {
        e.preventDefault();
        setIsDragging(false);
        var files = Array.from(e.dataTransfer.files);
        var jsonFile = files.find(function (f) { return f.name.endsWith(".json"); });
        if (jsonFile) {
            importFromGifTransfer(jsonFile);
            return;
        }
        var url = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
        if (url) {
            if (!settings.store.allowTenor && (isTenorUrl(url) || isGiphyUrl(url))) {
                notify("Tenor/Giphy is disabled in settings", "error");
                return;
            }
            var mediaType = getMediaType(url);
            if (isTypeEnabled(mediaType)) {
                addToLocal({ url: url, src: url, width: 498, height: 280, type: mediaType, folderId: activeFolder || undefined }).then(function (success) {
                    if (success) {
                        getStoredItems().then(setItems);
                        notify("Item added!", "success");
                    }
                    else {
                        notify("Item already exists", "info");
                    }
                });
            }
        }
    };
    var handleCreateFolder = async function () {
        if (!newFolderName.trim())
            return;
        await createFolder(newFolderName.trim(), newFolderIcon);
        var updatedFolders = await getStoredFolders();
        setFolders(updatedFolders);
        setNewFolderName("");
        setNewFolderIcon("[F]");
        setShowFolderModal(false);
        notify("Folder created!", "success");
    };
    var handleDeleteFolder = async function (folderId) {
        await deleteFolder(folderId);
        var updatedFolders = await getStoredFolders();
        setFolders(updatedFolders);
        if (activeFolder === folderId) {
            setActiveFolder(null);
        }
        notify("Folder deleted", "info");
    };
    var handleBulkDelete = async function () {
        var ids = Array.from(selectedItems);
        var idsSet = new Set(ids);
        var updatedItems = (await getStoredItems()).filter(function (item) { return !idsSet.has(item.id); });
        await saveItems(updatedItems);
        setItems(updatedItems);
        setSelectedItems(new Set());
        notify("Deleted " + selectedItems.size + " items", "info");
    };
    var handleBulkMove = async function (folderId) {
        var ids = Array.from(selectedItems);
        var idsSet = new Set(ids);
        var updatedItems = await getStoredItems();
        for (var i = 0; i < updatedItems.length; i++) {
            if (idsSet.has(updatedItems[i].id))
                updatedItems[i].folderId = folderId || undefined;
        }
        await saveItems(updatedItems);
        setItems(updatedItems);
        setSelectedItems(new Set());
        notify("Moved " + selectedItems.size + " items", "success");
    };
    var handleContextMenu = function (item, e) {
        e.preventDefault();
        copyToClipboard(item.url).then(function (success) {
            if (success) {
                notify("URL copied to clipboard!", "success");
            }
        });
    };
    var textColor = "var(--text-normal, #dbdee1)";
    var headerColor = "var(--header-primary, #f2f3f5)";
    var mutedColor = "var(--text-muted, #b9bbbe)";
    var bgPrimary = "var(--background-primary, #313338)";
    var bgSecondary = "var(--background-secondary, #2b2d31)";
    var bgTertiary = "var(--background-tertiary, #1e1f22)";
    var inputBg = "var(--input-background, #1e1f22)";
    var inputBorder = "var(--input-border, #3f4147)";
    var greenColor = "var(--green-500, #23a559)";
    var buttonBg = "var(--primary-button-background, #5865F2)";
    var buttonText = "var(--primary-button-text, #ffffff)";
    var orangeColor = "var(--orange-500, #f0b429)";
    var dangerColor = "var(--danger-500, #f84141)";
    var hoverColor = "var(--hover-color, #35373c)";
    var pinkColor = "#ed4245";
    var gridSize = parseInt(settings.store.gridSize) || 200;
    var visibleItems = filteredItems;
    var FolderSidebar = function () {
        return React.createElement("div", { style: { width: "200px", background: bgSecondary, borderRadius: "8px 0 0 8px", padding: "12px", borderRight: "1px solid " + inputBorder } }, React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" } }, React.createElement("span", { style: { color: headerColor, fontWeight: "600", fontSize: "14px" } }, "Folders"), React.createElement("button", {
            onClick: function () { setShowFolderModal(true); setTimeout(function () { if (folderInputRef.current)
                folderInputRef.current.focus(); }, 50); },
            style: { background: pinkColor, color: "white", border: "none", borderRadius: "4px", width: "24px", height: "24px", cursor: "pointer", fontSize: "14px", display: "flex", alignItems: "center", justifyContent: "center" }
        }, "+")), React.createElement("div", {
            onClick: function () { setActiveFolder(null); },
            style: { padding: "8px 12px", borderRadius: "4px", cursor: "pointer", background: activeFolder === null ? pinkColor : "transparent", color: activeFolder === null ? "white" : textColor, marginBottom: "4px", display: "flex", alignItems: "center", gap: "8px", fontSize: "14px" }
        }, React.createElement("span", null, "[All]"), React.createElement("span", { style: { marginLeft: "auto", opacity: 0.7, fontSize: "12px" } }, items.length)), React.createElement("div", { style: { marginTop: "8px", borderTop: "1px solid " + inputBorder, paddingTop: "8px" } }, folders.map(function (folder) {
            return React.createElement("div", {
                key: folder.id,
                style: { display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px", borderRadius: "4px", cursor: "pointer", background: activeFolder === folder.id ? pinkColor : "transparent", color: activeFolder === folder.id ? "white" : textColor, marginBottom: "4px", fontSize: "14px" }
            }, React.createElement("div", {
                onClick: function (e) { e.stopPropagation(); setActiveFolder(folder.id); },
                style: { flex: 1, display: "flex", alignItems: "center", gap: "8px" }
            }, React.createElement("span", null, folder.icon), React.createElement("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, folder.name), React.createElement("span", { style: { marginLeft: "auto", opacity: 0.7, fontSize: "12px" } }, getFolderItems(folder.id).length)), React.createElement("button", {
                onClick: function (e) { e.stopPropagation(); handleDeleteFolder(folder.id); },
                style: { background: "transparent", border: "none", color: "inherit", cursor: "pointer", opacity: 0.5, padding: "2px" }
            }, "X"));
        })));
    };
    var folderModal = null;
    if (showFolderModal) {
        folderModal = React.createElement(React.Fragment, null, React.createElement("div", {
            onClick: function () { setShowFolderModal(false); },
            style: { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", zIndex: 999 }
        }), React.createElement("div", {
            style: { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", background: bgPrimary, padding: "24px", borderRadius: "8px", zIndex: 1000, width: "300px", boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }
        }, React.createElement("h3", { style: { color: headerColor, marginBottom: "16px", marginTop: 0 } }, "Create Folder"), React.createElement("input", {
            ref: folderInputRef,
            autoFocus: true,
            type: "text",
            placeholder: "Folder name...",
            value: newFolderName,
            onChange: function (e) { setNewFolderName(e.target.value); },
            onKeyDown: function (e) { if (e.key === "Enter")
                handleCreateFolder(); },
            style: { width: "100%", background: inputBg, border: "1px solid " + inputBorder, borderRadius: "4px", padding: "12px", color: textColor, fontSize: "14px", marginBottom: "12px", boxSizing: "border-box" }
        }), React.createElement("div", { style: { marginBottom: "16px" } }, React.createElement("span", { style: { color: mutedColor, fontSize: "12px", display: "block", marginBottom: "8px" } }, "Icon:"), React.createElement("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } }, ["[F]", "[G]", "[P]", "[V]", "[S]", "[D]", "[*]", "[H]", "[!]"].map(function (icon) {
            return React.createElement("button", {
                key: icon,
                onClick: function () { setNewFolderIcon(icon); },
                style: { background: newFolderIcon === icon ? pinkColor : bgTertiary, border: "none", borderRadius: "4px", padding: "8px 12px", fontSize: "14px", cursor: "pointer", color: textColor }
            }, icon);
        }))), React.createElement("div", { style: { display: "flex", gap: "8px", justifyContent: "flex-end" } }, React.createElement("button", {
            onClick: function () { setShowFolderModal(false); },
            style: { background: bgTertiary, color: textColor, border: "none", padding: "10px 16px", borderRadius: "4px", cursor: "pointer" }
        }, "Cancel"), React.createElement("button", {
            onClick: handleCreateFolder,
            style: { background: greenColor, color: "white", border: "none", padding: "10px 16px", borderRadius: "4px", cursor: "pointer" }
        }, "Create"))));
    }
    var handleMouseEnter = function (itemId, e) {
        if (!selectedItems.has(itemId)) {
            e.currentTarget.style.borderColor = hoverColor;
        }
    };
    var handleMouseLeave = function (itemId, e) {
        if (!selectedItems.has(itemId)) {
            e.currentTarget.style.borderColor = "transparent";
        }
    };
    return React.createElement(ModalRoot, { ...modalProps, size: "large" }, React.createElement("div", { style: { width: "1400px", maxWidth: "95vw", background: bgPrimary, borderRadius: "8px", display: "flex", flexDirection: "column", maxHeight: "90vh", margin: "auto" } }, React.createElement(ModalHeader, null, React.createElement("div", { style: { display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center", padding: "16px", boxSizing: "border-box" } }, React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "16px" } }, React.createElement("span", { style: { color: headerColor, fontSize: "20px", fontWeight: "600" } }, "[H] HeartGifs (", items.length, ")"), selectedItems.size > 0 && React.createElement("div", { style: { display: "flex", gap: "8px", alignItems: "center" } }, React.createElement("span", { style: { color: mutedColor, fontSize: "12px" } }, selectedItems.size + " selected"), React.createElement("button", { onClick: handleBulkDelete, style: { background: dangerColor, color: "white", border: "none", padding: "6px 12px", borderRadius: "4px", cursor: "pointer", fontSize: "12px" } }, "Delete"), React.createElement("button", { onClick: function () { setSelectedItems(new Set()); }, style: { background: bgTertiary, color: textColor, border: "none", padding: "6px 12px", borderRadius: "4px", cursor: "pointer", fontSize: "12px" } }, "Clear"))), React.createElement("div", { style: { display: "flex", gap: "8px", alignItems: "center" } }, React.createElement("button", { onClick: openImportPicker, style: { background: orangeColor, color: "white", border: "none", padding: "10px 16px", borderRadius: "4px", cursor: "pointer", fontWeight: "500", fontSize: "14px" } }, "Import"), React.createElement("button", { onClick: exportToGifTransfer, style: { background: pinkColor, color: "white", border: "none", padding: "10px 16px", borderRadius: "4px", cursor: "pointer", fontWeight: "500", fontSize: "14px" } }, "Export"), React.createElement("button", {
        onClick: async function () {
            if (!confirm("Delete all " + items.length + " saved items? This cannot be undone."))
                return;
            await deleteAllItems();
            setItems([]);
            notify("All items deleted", "success");
        },
        style: { background: dangerColor, color: "white", border: "none", padding: "10px 16px", borderRadius: "4px", cursor: "pointer", fontWeight: "500", fontSize: "14px" }
    }, "Delete All"), React.createElement("button", { onClick: function () { setShowAddInput(!showAddInput); }, style: { background: greenColor, color: "white", border: "none", padding: "10px 20px", borderRadius: "4px", cursor: "pointer", fontWeight: "500", fontSize: "14px" } }, "+ Add New")))), React.createElement(ModalContent, null, React.createElement("div", { style: { padding: "16px", overflow: "hidden", display: "flex", flexDirection: "column" }, onDragOver: handleDragOver, onDragLeave: handleDragLeave, onDrop: handleDrop }, isDragging && React.createElement("div", { style: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(237, 66, 69, 0.2)", border: "3px dashed " + pinkColor, borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, margin: "16px" } }, React.createElement("span", { style: { color: pinkColor, fontSize: "24px", fontWeight: "600" } }, "Drop files or URLs to import")), React.createElement("div", { style: { padding: "0" } }, showAddInput && React.createElement("div", { style: { display: "flex", gap: "8px", marginBottom: "16px" } }, React.createElement("input", {
        type: "text",
        placeholder: "Enter URL...",
        value: newUrl,
        onChange: function (e) { setNewUrl(e.target.value); },
        onKeyDown: function (e) { if (e.key === "Enter")
            handleAddItem(); },
        style: { flex: 1, background: inputBg, border: "1px solid " + inputBorder, borderRadius: "4px", padding: "12px", color: textColor, fontSize: "14px" }
    }), React.createElement("button", { onClick: handleAddItem, style: { background: greenColor, color: "white", border: "none", padding: "12px 24px", borderRadius: "4px", cursor: "pointer", fontWeight: "500" } }, "Add")), React.createElement("input", {
        ref: searchInputRef,
        type: "text",
        placeholder: "Search...",
        value: searchQuery,
        onChange: function (e) { setSearchQuery(e.target.value); },
        style: { width: "100%", background: inputBg, border: "1px solid " + inputBorder, borderRadius: "4px", padding: "12px", color: textColor, fontSize: "14px", marginBottom: "16px", boxSizing: "border-box" }
    })), React.createElement("div", { ref: scrollContainerRef, style: { flex: 1, overflowY: "auto", paddingBottom: "16px" } }, filteredItems.length === 0 ? (React.createElement("div", { style: { textAlign: "center", padding: "60px", color: mutedColor, fontSize: "16px" } }, items.length === 0 ? "No items saved yet! Drop some files or URLs here to get started." : "No items match your search")) : (React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(" + gridSize + "px, 1fr))", gap: "12px", paddingBottom: "16px" } }, visibleItems.map(function (item) {
        return React.createElement("div", {
            key: item.id,
            style: { position: "relative", background: bgTertiary, borderRadius: "8px", overflow: "hidden", minHeight: "180px", border: selectedItems.has(item.id) ? "2px solid " + pinkColor : "2px solid transparent", transition: "all 0.2s ease" },
            onMouseEnter: function (e) { handleMouseEnter(item.id, e); },
            onMouseLeave: function (e) { handleMouseLeave(item.id, e); },
            onContextMenu: function (e) { handleContextMenu(item, e); }
        }, item.type === MediaType.AUDIO ? (React.createElement("div", {
            style: { padding: "50px 10px", textAlign: "center", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "180px" },
            onClick: function (e) { handleItemClick(item, e); }
        }, React.createElement("div", { style: { fontSize: "32px" } }, "[Audio]"), React.createElement("div", { style: { fontSize: "12px", marginTop: "8px", color: mutedColor, wordBreak: "break-all", padding: "0 8px" } }, item.filename || "Audio"), React.createElement("div", { style: { fontSize: "11px", marginTop: "4px", color: pinkColor } }, "Click to send to chat"))) : item.type === MediaType.VIDEO ? (React.createElement("div", {
            style: { padding: "50px 10px", textAlign: "center", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "180px" },
            onClick: function (e) { handleItemClick(item, e); }
        }, React.createElement("div", { style: { fontSize: "32px" } }, "[Video]"), React.createElement("div", { style: { fontSize: "12px", marginTop: "8px", color: mutedColor } }, "Video"), React.createElement("div", { style: { fontSize: "11px", marginTop: "4px", color: pinkColor } }, "Click to send to chat"))) : (React.createElement("div", {
            style: { cursor: "pointer", height: "180px", display: "flex", alignItems: "center", justifyContent: "center", background: "#1e1f22" },
            onClick: function (e) { handleItemClick(item, e); }
        }, imageErrors[item.id] ? ((item.url.indexOf("tenor.com") !== -1 || item.url.indexOf("giphy.com") !== -1) ? (React.createElement("a", { href: item.url, target: "_blank", rel: "noopener noreferrer", style: { color: "#5865F2", fontSize: "11px", textDecoration: "underline", padding: "8px" } }, "Open in new tab")) : (React.createElement("div", { style: { textAlign: "center", color: mutedColor, padding: "12px", fontSize: "12px", display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", width: "100%" } }, React.createElement("div", { style: { fontSize: "20px", opacity: 0.5 } }, "[Error]"), React.createElement("div", { style: { fontSize: "11px" } }, "Failed to load")))) : (function () {
            var mediaUrl = item.src || item.url;
            var fallback = overrideSrc[item.id];
            var src = fallback || item.cachedUrl || mediaUrl;
            var isVideo = !fallback && (/\.(mp4|webm|mov)(\?.*)?$/i.test(mediaUrl) || mediaUrl.indexOf("format=mp4") !== -1 || mediaUrl.indexOf("format=webm") !== -1 || (mediaUrl.indexOf("tenor.com") !== -1 && /\.gifv(\?.*)?$/i.test(mediaUrl)) || mediaUrl.indexOf(".gifv") !== -1);
            if (isVideo) {
                return React.createElement("video", {
                    src: src,
                    autoPlay: true,
                    loop: true,
                    muted: true,
                    playsInline: true,
                    style: { maxWidth: "100%", maxHeight: "180px", objectFit: "contain" },
                    onError: function () { handleImageError(item.id); },
                    onLoadedData: function () { handleImageLoad(item.id); }
                });
            }
            return React.createElement("img", {
                src: src,
                alt: item.type,
                style: { maxWidth: "100%", maxHeight: "180px", objectFit: "contain" },
                onError: function () { handleImageError(item.id); },
                onLoad: function () { handleImageLoad(item.id); }
            });
        })())), React.createElement("div", { style: { position: "absolute", bottom: "8px", left: "8px", background: "rgba(0,0,0,0.8)", padding: "4px 8px", borderRadius: "4px", fontSize: "11px", color: "white", fontWeight: "500", display: "flex", alignItems: "center", gap: "4px" } }, getMediaIcon(item.type), getTypeLabel(item.type)), (item.type === MediaType.GIF || item.type === MediaType.VIDEO || item.type === MediaType.IMAGE) && React.createElement(CaptionGifButton, { item: item }), selectedItems.has(item.id) && React.createElement("div", { style: { position: "absolute", top: "8px", left: "8px", width: "24px", height: "24px", background: pinkColor, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: "14px" } }, "OK"), React.createElement("button", {
            onClick: function (e) { e.stopPropagation(); handleRemoveItem(item.id); },
            style: { position: "absolute", top: "8px", right: "8px", background: "rgba(0,0,0,0.7)", color: "white", border: "none", borderRadius: "4px", width: "28px", height: "28px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px" }
        }, "X"));
    }))))))), React.createElement(ModalFooter, null, React.createElement("div", { style: { padding: "16px", display: "flex", justifyContent: "space-between", width: "100%" } }, React.createElement("div", { style: { color: mutedColor, fontSize: "12px" } }, "Tip: Ctrl+Click to select multiple, Right-click for options"), React.createElement("button", { onClick: modalProps.onClose, style: { background: buttonBg, color: buttonText, border: "none", padding: "12px 24px", borderRadius: "4px", cursor: "pointer", fontWeight: "500", fontSize: "14px" } }, "Close"))));
}
var HeartGifsButton = function () {
    return (<ChatBarButton onClick={() => openModal((props) => <NoGifLimitModal modalProps={props}/>)} tooltip="HeartGifs">
            <HeartIcon />
        </ChatBarButton>);
};
function CaptionGifButton({ item }) {
    var [loading, setLoading] = useState(false);
    var handleClick = async (e) => {
        e.stopPropagation();
        if (loading)
            return;
        setLoading(true);
        var mediaUrl = item.src || item.url;
        try {
            var result = await fetchMedia(mediaUrl);
            if (!result) {
                showCaptionError("Failed to load media for captioning.");
                setLoading(false);
                return;
            }
            var blob = new Blob([result.buffer], { type: result.contentType });
            var metadata = await inspectMedia(result.buffer, result.contentType, blob);
            if (!metadata) {
                showCaptionError("Could not inspect media.");
                setLoading(false);
                return;
            }
            var previewUrl = URL.createObjectURL(blob);
            var released = false;
            var captionMedia = {
                buffer: result.buffer,
                contentType: result.contentType,
                height: metadata.height,
                isVideo: metadata.isVideo,
                release: () => {
                    if (released)
                        return;
                    released = true;
                    URL.revokeObjectURL(previewUrl);
                },
                url: previewUrl,
                width: metadata.width
            };
            openModal((modalProps) => (<GifCaptionerModal {...modalProps} media={captionMedia} onCancel={() => {
                    captionMedia.release();
                    setLoading(false);
                }} onSubmit={() => { }} onConfirm={() => {
                    captionMedia.release();
                    setLoading(false);
                }}/>));
        }
        catch (err) {
            showCaptionError("Error: " + err);
            setLoading(false);
        }
    };
    return React.createElement("button", {
        type: "button",
        onClick: handleClick,
        disabled: loading,
        title: "Caption this GIF",
        style: {
            position: "absolute",
            bottom: "8px",
            right: "40px",
            background: "rgba(0,0,0,0.7)",
            color: loading ? "gray" : "white",
            border: "none",
            borderRadius: "4px",
            width: "28px",
            height: "28px",
            cursor: loading ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "14px",
            zIndex: 10
        }
    }, loading ? "..." : React.createElement(PencilIcon, { width: 16, height: 16 }));
}
var addFavContextMenuPatch = function (children, props) {
    if (!props)
        return;
    var { itemSrc } = props;
    var { itemHref } = props;
    var { message } = props;
    var itemUrl = "";
    if (itemSrc)
        itemUrl = itemSrc;
    else if (itemHref)
        itemUrl = itemHref;
    else if (message) {
        if (message.content) {
            var urlMatch = message.content.match(/(https?:\/\/[^\s]+\.(gif|webp|mp4|jpg|jpeg|png|mp3|wav|ogg))/i);
            if (!urlMatch) {
                var contentUrl = message.content.match(/(https?:\/\/[^\s]+)/i);
                if (contentUrl && (contentUrl[1].includes("tenor.com") || contentUrl[1].includes("giphy.com") || contentUrl[1].includes("media.tenor") || contentUrl[1].includes("media.giphy"))) {
                    urlMatch = contentUrl;
                }
            }
            if (urlMatch)
                itemUrl = urlMatch[1];
        }
        if (!itemUrl && message.embeds) {
            for (var embed of message.embeds) {
                if (embed.video && embed.video.url && (embed.video.url.includes("tenor.com") || embed.video.url.includes("giphy.com") || embed.video.url.includes("media.tenor") || embed.video.url.includes("media.giphy"))) {
                    itemUrl = embed.video.url;
                    break;
                }
                if (embed.thumbnail && embed.thumbnail.url && (embed.thumbnail.url.includes("tenor.com") || embed.thumbnail.url.includes("giphy.com") || embed.thumbnail.url.includes("media.tenor") || embed.thumbnail.url.includes("media.giphy"))) {
                    itemUrl = embed.thumbnail.url;
                    break;
                }
                if (embed.image && embed.image.url && (embed.image.url.includes("tenor.com") || embed.image.url.includes("giphy.com") || embed.image.url.includes("media.tenor") || embed.image.url.includes("media.giphy"))) {
                    itemUrl = embed.image.url;
                    break;
                }
                if (embed.url && (embed.url.includes("tenor.com") || embed.url.includes("giphy.com"))) {
                    itemUrl = embed.url;
                    break;
                }
            }
        }
    }
    if (!itemUrl)
        return;
    if (!settings.store.allowTenor && (isTenorUrl(itemUrl) || isGiphyUrl(itemUrl)))
        return;
    var mediaType = getMediaType(itemUrl);
    if (!isTypeEnabled(mediaType))
        return;
    var group = findGroupChildrenByChildId("open-native-link", children) || findGroupChildrenByChildId("copy-link", children);
    if (group && !group.some(function (child) { return child && child.props && child.props.id === "add-to-heartgifs"; })) {
        group.push(React.createElement(Menu.MenuItem, {
            label: "Save to HeartGifs",
            key: "add-to-heartgifs",
            id: "add-to-heartgifs",
            action: async function () {
                var success = await addToLocal({
                    url: itemUrl,
                    src: itemUrl,
                    width: 498,
                    height: 280,
                    type: mediaType
                });
                if (success) {
                    notify("Saved to HeartGifs!", "success");
                }
                else {
                    notify("Already in HeartGifs", "info");
                }
            }
        }));
    }
};
export default definePlugin({
    name: "HeartGifs",
    description: "Unlimited gif/image/video saving with heart icon, folders, and more!",
    tags: ["Media", "Utility"],
    authors: [TestcordDevs.x2b],
    settings: settings,
    chatBarButton: {
        icon: HeartIcon,
        render: HeartGifsButton
    },
    messagePopoverButton: {
        icon: HeartGifPopoverIcon,
        render(msg) {
            // Try to extract media URL from message
            var content = msg.content || "";
            var urlMatch = content.match(/(https?:\/\/[^\s]+\.(gif|webp|mp4|jpg|jpeg|png|mp3|wav|ogg))/i);
            if (!urlMatch && content.match(/(tenor\.com|giphy\.com|media\.tenor|media\.giphy)/i)) {
                urlMatch = content.match(/(https?:\/\/[^\s]+)/i);
            }
            if (!urlMatch) {
                if (msg.embeds) {
                    for (var embed of msg.embeds) {
                        if (embed.url && (embed.url.includes("tenor.com") || embed.url.includes("giphy.com"))) {
                            urlMatch = [embed.url, embed.url];
                            break;
                        }
                        if (embed.video && embed.video.url) {
                            urlMatch = [embed.video.url, embed.video.url];
                            break;
                        }
                    }
                }
            }
            if (!urlMatch) {
                // Check attachments
                if (msg.attachments && msg.attachments.length > 0) {
                    var attachment = msg.attachments[0];
                    if (attachment && attachment.url) {
                        urlMatch = [attachment.url, attachment.url];
                    }
                }
            }
            if (!urlMatch)
                return null;
            var itemUrl = urlMatch[1];
            if (!itemUrl)
                return null;
            // Check if it's a supported type
            if (!settings.store.allowTenor && (isTenorUrl(itemUrl) || isGiphyUrl(itemUrl)))
                return null;
            var mediaType = getMediaType(itemUrl);
            if (!isTypeEnabled(mediaType))
                return null;
            return {
                label: "Save to HeartGifs",
                icon: HeartGifPopoverIcon,
                message: msg,
                channel: ChannelStore.getChannel(msg.channel_id),
                onClick: async function () {
                    var success = await addToLocal({
                        url: itemUrl,
                        src: itemUrl,
                        width: 498,
                        height: 280,
                        type: mediaType
                    });
                    if (success) {
                        notify("Saved to HeartGifs!", "success");
                    }
                    else {
                        notify("Already in HeartGifs", "info");
                    }
                }
            };
        }
    },
    contextMenus: {
        "message": addFavContextMenuPatch
    },
    commands: [
        {
            name: "hgcount",
            description: "Show the number of saved items",
            execute: async function () {
                var items = await getStoredItems();
                notify("You have " + items.length + " saved items", "info");
                return { content: "You have " + items.length + " saved items." };
            }
        },
        {
            name: "addhg",
            description: "Add an item to your local collection",
            options: [
                {
                    name: "url",
                    description: "The URL of the item to add",
                    type: 3,
                    required: true
                }
            ],
            execute: async function (args) {
                var url = args[0] && args[0].value;
                if (!url) {
                    notify("Please provide a URL", "error");
                    return { content: "Please provide a URL." };
                }
                try {
                    new URL(url);
                }
                catch {
                    notify("Invalid URL provided", "error");
                    return { content: "Invalid URL provided." };
                }
                if (!settings.store.allowTenor && (isTenorUrl(url) || isGiphyUrl(url))) {
                    notify("Tenor/Giphy is disabled in settings", "error");
                    return { content: "Tenor/Giphy is disabled in settings." };
                }
                var mediaType = getMediaType(url);
                if (!isTypeEnabled(mediaType)) {
                    notify("Saving " + mediaType + " type is disabled in settings", "error");
                    return { content: "Saving " + mediaType + " type is disabled in settings." };
                }
                var success = await addToLocal({ url: url, src: url, width: 498, height: 280, type: mediaType });
                if (success) {
                    var items = await getStoredItems();
                    notify("Added! You now have " + items.length + " items", "success");
                    return { content: "Added! You now have " + items.length + " saved items." };
                }
                else {
                    notify("This item is already in your collection!", "info");
                    return { content: "This item is already in your collection!" };
                }
            }
        },
        {
            name: "listhg",
            description: "List all your saved items (outputs to console)",
            execute: async function () {
                var items = await getStoredItems();
                if (items.length === 0) {
                    notify("No items saved", "info");
                    return { content: "No items saved." };
                }
                console.log("[HeartGifs] Your saved items:");
                items.forEach(function (item, i) { console.log((i + 1) + ". [" + item.type + "] " + item.url); });
                notify(items.length + " items logged to console", "info");
                return { content: items.length + " items logged to console (open DevTools to view)." };
            }
        },
        {
            name: "exporthg",
            description: "Export favorites to JSON file",
            execute: async function () {
                await exportToGifTransfer();
                return { content: "Exporting..." };
            }
        },
        {
            name: "importhg",
            description: "Import favorites from JSON file",
            execute: async function () {
                openImportPicker();
                return { content: "Opening file picker..." };
            }
        }
    ],
    settingsAboutComponent: function () {
        var countState = useState(0);
        var setCount = countState[1];
        var count = countState[0];
        React.useEffect(function () {
            getStoredItems().then(function (items) { setCount(items.length); });
        }, []);
        var textColor = "var(--text-normal, #dbdee1)";
        var headerColor = "var(--header-primary, #f2f3f5)";
        var mutedColor = "var(--text-muted, #b9bbbe)";
        var bgTertiary = "var(--background-tertiary, #2b2d31)";
        var pinkColor = "#ed4245";
        return React.createElement("div", { style: { fontSize: "14px", lineHeight: "1.6", color: textColor } }, React.createElement("p", { style: { marginBottom: "8px", color: headerColor } }, React.createElement("b", null, "[H] HeartGifs"), " saves unlimited favorites locally with heart icon."), React.createElement("div", { style: { background: bgTertiary, padding: "12px", borderRadius: "8px" } }, React.createElement("div", { style: { color: headerColor, fontWeight: "bold" } }, "Saved Items: ", count), React.createElement("div", { style: { fontSize: "12px", color: mutedColor, marginTop: "8px" } }, "Grid Size: ", settings.store.gridSize, "px"), React.createElement("div", { style: { fontSize: "12px", color: mutedColor, marginTop: "4px" } }, "Tenor/Giphy: ", settings.store.allowTenor ? "Enabled" : "Disabled")));
    }
});
