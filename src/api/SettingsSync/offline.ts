/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PlainSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import { chooseFile, saveFile } from "@utils/web";
import { moment, Toasts } from "@webpack/common";

import { DataStore } from "..";

type BackupType = "all" | "plugins" | "css" | "datastore";

const toast = (type: string, message: string) =>
    Toasts.show({
        type,
        message,
        id: Toasts.genId()
    });

const toastSuccess = () =>
    toast(Toasts.Type.SUCCESS, "Settings successfully imported. Restart to apply changes!");

const toastFailure = (err: any) =>
    toast(Toasts.Type.FAILURE, `Failed to import settings: ${String(err)}`);

const logger = new Logger("SettingsSync:Offline", "#39b7e0");

function deepMerge<T extends object>(target: T, source: T): T {
    for (const key in source) {
        const sourceVal = source[key];

        if (sourceVal !== null && typeof sourceVal === "object" && !Array.isArray(sourceVal)) {
            if (target[key] === null || target[key] === undefined || typeof target[key] !== "object" || Array.isArray(target[key])) {
                target[key] = {} as any;
            }
            deepMerge(target[key] as object, sourceVal as object);
        } else {
            target[key] = sourceVal;
        }
    }
    return target;
}

function isSafeObject(obj: any) {
    if (obj == null || typeof obj !== "object") return true;

    for (const key in obj) {
        if (["__proto__", "constructor", "prototype"].includes(key)) {
            return false;
        }
        if (!isSafeObject(obj[key])) {
            return false;
        }
    }

    return true;
}

async function setDataStoreBatched(entries: [IDBValidKey, any][]) {
    // Marker rows produced by export describe entries whose value could not be
    // read or serialized. Restoring them would overwrite the real (locally
    // readable) value with a stub, so they are skipped.
    const restorable = entries.filter(([_, value]) =>
        value == null || typeof value !== "object"
        || (!("__unreadable" in value) && !("__unserializable" in value))
    );

    const BATCH_SIZE = 500;
    for (let i = 0; i < restorable.length; i += BATCH_SIZE) {
        await DataStore.setMany(restorable.slice(i, i + BATCH_SIZE));
    }
}

export async function importSettings(data: string | object, type: BackupType = "all", cloud = false) {
    let parsed: any;
    if (typeof data === "string") {
        try {
            parsed = JSON.parse(data);
        } catch (err) {
            throw new Error("Failed to parse JSON: " + String(err));
        }
    } else {
        parsed = data;
    }

    if (!isSafeObject(parsed))
        throw new Error("Unsafe Settings");

    switch (type) {
        case "all": {
            if (!cloud && (!("settings" in parsed)))
                throw new Error("Invalid Settings. Plugin settings is required for this import try a different one.");

            if (parsed.settings) {
                deepMerge(PlainSettings, parsed.settings);
                await VencordNative.settings.set(PlainSettings);
            }
            if (parsed.quickCss) await VencordNative.quickCss.set(parsed.quickCss);
            if (parsed.dataStore) await setDataStoreBatched(parsed.dataStore);
            break;
        }
        case "plugins": {
            if (!parsed.settings) throw new Error("Plugin settings missing");

            deepMerge(PlainSettings, parsed.settings);
            await VencordNative.settings.set(PlainSettings);
            break;
        }
        case "css": {
            if (!parsed.quickCss) throw new Error("CSS missing");

            await VencordNative.quickCss.set(parsed.quickCss);
            break;
        }
        case "datastore": {
            if (!parsed.dataStore) throw new Error("DataStore data missing");

            await setDataStoreBatched(parsed.dataStore);
            break;
        }
    }
}

export async function exportSettings({ syncDataStore = true, type = "all", minify, forceDataStore }: { syncDataStore?: boolean; type?: BackupType; minify?: boolean; forceDataStore?: boolean; }) {
    const settings = VencordNative.settings.get();
    const quickCss = await VencordNative.quickCss.get();

    if (!syncDataStore) {
        switch (type) {
            case "all":
            case "plugins": {
                return JSON.stringify({ settings }, null, minify ? undefined : 4);
            }
            case "css": {
                return JSON.stringify({ quickCss }, null, minify ? undefined : 4);
            }
            case "datastore": {
                return "{}";
            }
        }
    }

    const nl = minify ? "" : "\n";
    const ind = minify ? "" : "  ";
    const col = minify ? ":" : ": ";
    const arrSep = minify ? "," : ", ";
    const [hasSettings, hasCss, hasDs] = [type === "all" || type === "plugins", type === "all" || type === "css", type === "all" || type === "datastore"];

    const parts: string[] = [`{${nl}`];

    if (hasSettings) {
        parts.push(`${ind}"settings"${col}${JSON.stringify(settings)}`);
    }

    if (hasCss) {
        if (hasSettings) parts.push(`,${nl}`);
        parts.push(`${ind}"quickCss"${col}${JSON.stringify(quickCss)}`);
    }

    if (hasDs) {
        if (hasSettings || hasCss) parts.push(`,${nl}`);
        let dsStarted = false;
        try {
            parts.push(`${ind}"dataStore"${col}[${nl}`);
            dsStarted = true;

            // One unserializable value must not kill a guaranteed export; keep the
            // row with a marker so restores know the entry existed.
            const serialize = (value: unknown): string => {
                try {
                    return JSON.stringify(value) ?? "null";
                } catch {
                    return JSON.stringify({ __unserializable: true, preview: String(value).slice(0, 2000) });
                }
            };

            if (forceDataStore) {
                const keys = await DataStore.keys();
                const MAX_CHUNK = 200;
                let chunkSize = MAX_CHUNK;
                let index = 0;
                let rowCount = 0;
                const pushRow = (key: IDBValidKey, valueJson: string) => {
                    if (rowCount++ > 0) parts.push(",");
                    parts.push(nl);
                    parts.push(`${ind}${ind}[${JSON.stringify(key)}${arrSep}${valueJson}]`);
                };
                while (index < keys.length) {
                    const chunk = keys.slice(index, index + chunkSize);
                    let values: unknown[];
                    try {
                        values = await DataStore.getMany(chunk);
                    } catch (chunkErr) {
                        if (chunkSize > 1) {
                            // Huge rows can blow up a big getMany; retry the same range
                            // in smaller pieces before giving up.
                            chunkSize = Math.max(1, Math.floor(chunkSize / 4));
                            continue;
                        }
                        // A single key that still fails is an unreadable record
                        // (Chromium refuses to deserialize oversized values). Emit
                        // an explicit marker and keep going - one poisoned row must
                        // not kill a guaranteed export.
                        const message = chunkErr instanceof Error ? chunkErr.message : String(chunkErr);
                        logger.warn(`DataStore key ${JSON.stringify(chunk[0])} could not be read for export: ${message}`);
                        pushRow(chunk[0], JSON.stringify({ __unreadable: true, error: message }));
                        index += 1;
                        continue;
                    }
                    for (let j = 0; j < chunk.length; j++) {
                        pushRow(chunk[j], serialize(values[j]));
                    }
                    index += chunk.length;
                    if (chunkSize < MAX_CHUNK && index < keys.length) {
                        // Reads work again - crawl back up so the rest of the
                        // store is not fetched one key at a time.
                        chunkSize = Math.min(MAX_CHUNK, Math.max(1, chunkSize * 4));
                    }
                }
            } else {
                // Resilient read: with one unreadable row this still exports
                // everything else instead of dropping the DataStore entirely.
                const entries = await DataStore.entriesSafe(key =>
                    logger.warn(`Skipping unreadable DataStore entry ${JSON.stringify(key)} in backup`)
                );
                for (let i = 0; i < entries.length; i++) {
                    if (i > 0) parts.push(",");
                    parts.push(nl);
                    const [key, value] = entries[i];
                    parts.push(`${ind}${ind}[${JSON.stringify(key)}${arrSep}${serialize(value)}]`);
                }
            }
            parts.push(`${nl}${ind}]`);
        } catch (err) {
            if (dsStarted) parts.push(`${nl}${ind}]`);
            if (type === "datastore" || forceDataStore) {
                // The Large DataStore Export toggle guarantees a complete export;
                // silently omitting the data would produce a corrupt restore, so
                // fail loudly instead.
                throw new Error(`DataStore export failed: ${err instanceof Error ? err.message : String(err)}`);
            }
            logger.warn("Skipping DataStore in backup due to size.");
            toast(Toasts.Type.MESSAGE, "DataStore too large - exported without it.");
        }
    }

    parts.push(`${nl}}`);
    return parts.join("");
}

export async function downloadSettingsBackup(type: BackupType = "all", { minify, forceDataStore }: { minify?: boolean; forceDataStore?: boolean; } = {}) {
    try {
        const filename = `testcord-${type}-backup-${moment().format("YYYY-MM-DD")}.json`;
        const syncDataStore = type === "all" || type === "datastore";

        const backup = await exportSettings({ minify, type, syncDataStore, forceDataStore });
        const data = new TextEncoder().encode(backup);
        if (IS_DISCORD_DESKTOP) {
            DiscordNative.fileManager.saveWithDialog(data, filename);
        } else {
            saveFile(new File([data], filename, { type: "application/json" }));
        }
    } catch (err) {
        logger.error("Failed to export settings:", err);
        toast(Toasts.Type.FAILURE, "Failed to export settings, check console");
        throw err;
    }
}

export async function uploadSettingsBackup(type: BackupType = "all", showToast = true): Promise<void> {
    const file = await chooseFile("application/json,.json");
    if (!file) return;

    try {
        const text = await file.text();
        await importSettings(text, type);
        if (showToast) toastSuccess();
    } catch (err) {
        logger.error(err);
        if (showToast) toastFailure(err);
    }
}
