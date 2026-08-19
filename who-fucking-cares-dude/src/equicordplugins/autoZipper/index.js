/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import { EquicordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { ChannelStore, DraftType, SelectedChannelStore, UploadHandler } from "@webpack/common";
import { zipSync } from "fflate";
const logger = new Logger("AutoZipper");
const settings = definePluginSettings({
    extensions: {
        type: 0 /* OptionType.STRING */,
        description: "Comma-separated list of file extensions to auto-zip (e.g., .psd,.blend,.exe,.dmg)",
        default: ".psd,.blend,.exe,.dmg,.app,.apk,.iso",
        onChange: () => {
            extensionsToZip.clear();
            parseExtensions();
        }
    }
});
const extensionsToZip = new Set();
function parseExtensions() {
    extensionsToZip.clear();
    const exts = settings.store.extensions.split(",").map(ext => ext.trim().toLowerCase());
    exts.forEach(ext => {
        if (ext && !ext.startsWith(".")) {
            extensionsToZip.add("." + ext);
        }
        else if (ext) {
            extensionsToZip.add(ext);
        }
    });
}
function shouldZipFile(file) {
    const ext = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();
    return ext !== "" && extensionsToZip.has(ext);
}
async function zipFile(file) {
    const arrayBuffer = await file.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);
    const zipData = zipSync({
        [file.name]: data
    });
    const baseName = file.name.substring(0, file.name.lastIndexOf(".")) || file.name;
    return new File([zipData], `${baseName}.zip`, { type: "application/zip" });
}
async function zipFolder(folderName, fileEntries) {
    const zipData = zipSync(fileEntries);
    return new File([zipData], `${folderName}.zip`, { type: "application/zip" });
}
async function readFileEntry(entry) {
    return new Promise((resolve, reject) => {
        entry.file(resolve, reject);
    });
}
async function readDirectoryEntry(entry) {
    const files = {};
    async function readEntries(dirEntry, path = "") {
        const reader = dirEntry.createReader();
        const readBatch = async () => {
            return new Promise((resolve, reject) => {
                reader.readEntries(async (entries) => {
                    if (entries.length === 0) {
                        resolve();
                        return;
                    }
                    for (const entry of entries) {
                        const entryPath = path ? `${path}/${entry.name}` : entry.name;
                        if (entry.isFile) {
                            const file = await readFileEntry(entry);
                            const arrayBuffer = await file.arrayBuffer();
                            files[entryPath] = new Uint8Array(arrayBuffer);
                        }
                        else if (entry.isDirectory) {
                            await readEntries(entry, entryPath);
                        }
                    }
                    await readBatch();
                    resolve();
                }, reject);
            });
        };
        await readBatch();
    }
    await readEntries(entry);
    return files;
}
async function processFiles(files) {
    const processedFiles = [];
    for (const file of files) {
        if (shouldZipFile(file)) {
            logger.info(`Auto-zipping file: ${file.name}`);
            try {
                const zippedFile = await zipFile(file);
                processedFiles.push(zippedFile);
            }
            catch (error) {
                logger.error(`Failed to zip file ${file.name}:`, error);
                processedFiles.push(file);
            }
        }
        else {
            processedFiles.push(file);
        }
    }
    return processedFiles;
}
let interceptingEvents = false;
function handleDrop(event) {
    if (!event.dataTransfer)
        return;
    const items = Array.from(event.dataTransfer.items);
    if (items.length === 0)
        return;
    const hasTargetedItem = items.some(item => {
        const entry = item.webkitGetAsEntry();
        return entry?.isDirectory || (item.kind === "file" && item.getAsFile() && shouldZipFile(item.getAsFile()));
    });
    if (!hasTargetedItem)
        return;
    event.preventDefault();
    event.stopPropagation();
    const processPromises = [];
    for (const item of items) {
        const entry = item.webkitGetAsEntry();
        if (entry?.isDirectory) {
            logger.info(`Zipping folder: ${entry.name}`);
            const folderPromise = readDirectoryEntry(entry)
                .then(fileEntries => zipFolder(entry.name, fileEntries))
                .catch(error => {
                logger.error(`Failed to zip folder ${entry.name}:`, error);
                return null;
            });
            processPromises.push(folderPromise);
        }
        else if (entry?.isFile) {
            const file = item.getAsFile();
            if (file) {
                if (shouldZipFile(file)) {
                    logger.info(`Auto-zipping file: ${file.name}`);
                    processPromises.push(zipFile(file).catch(error => {
                        logger.error(`Failed to zip file ${file.name}:`, error);
                        return file;
                    }));
                }
                else {
                    processPromises.push(Promise.resolve(file));
                }
            }
        }
    }
    Promise.all(processPromises).then(processedFiles => {
        const validFiles = processedFiles.filter(f => f !== null);
        const channelId = SelectedChannelStore.getChannelId();
        const channel = ChannelStore.getChannel(channelId);
        if (channel && validFiles.length > 0) {
            setTimeout(() => UploadHandler.promptToUpload(validFiles, channel, DraftType.ChannelMessage), 10);
        }
    });
}
function handlePaste(event) {
    const files = Array.from(event.clipboardData?.files || []);
    if (files.length === 0)
        return;
    const hasTargetedFile = files.some(shouldZipFile);
    if (!hasTargetedFile)
        return;
    event.preventDefault();
    event.stopPropagation();
    processFiles(files).then(processedFiles => {
        const channelId = SelectedChannelStore.getChannelId();
        const channel = ChannelStore.getChannel(channelId);
        if (channel && processedFiles.length > 0) {
            setTimeout(() => UploadHandler.promptToUpload(processedFiles, channel, DraftType.ChannelMessage), 10);
        }
    });
}
export default definePlugin({
    name: "AutoZipper",
    description: "Automatically zips specified file types and folders before uploading to Discord",
    tags: ["Organisation", "Utility"],
    authors: [EquicordDevs.SSnowly],
    settings,
    start() {
        if (interceptingEvents)
            return;
        interceptingEvents = true;
        parseExtensions();
        document.addEventListener("drop", handleDrop, true);
        document.addEventListener("paste", handlePaste, true);
    },
    stop() {
        document.removeEventListener("drop", handleDrop, true);
        document.removeEventListener("paste", handlePaste, true);
        interceptingEvents = false;
    }
});
