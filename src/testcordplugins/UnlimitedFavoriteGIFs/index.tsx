/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DataStore } from "@api/index";
import { definePluginSettings } from "@api/Settings";
import { Link } from "@components/Link";
import definePlugin, { OptionType } from "@utils/types";
import { showToast, Toasts } from "@webpack/common";

const LOCAL_FAVS_KEY = "UnlimitedFavoriteGIFs_localFavs";

function log(...args: any[]) { console.log("[UnlimitedFavoriteGIFs]", ...args); }
function warn(...args: any[]) { console.warn("[UnlimitedFavoriteGIFs]", ...args); }

async function getLocalFavs(): Promise<any[]> {
    return (await DataStore.get(LOCAL_FAVS_KEY)) ?? [];
}

async function saveLocalFavs(list: any[]): Promise<void> {
    await DataStore.set(LOCAL_FAVS_KEY, list);
}

function gifKey(gif: any): string {
    if (typeof gif === "string") return gif;
    return gif?.url ?? gif?.src ?? JSON.stringify(gif);
}

const settings = definePluginSettings({
    exportFavs: {
        type: OptionType.COMPONENT,
        description: "Export local favorites to clipboard as JSON",
        component: () => {
            const { Button } = require("@webpack/common");
            return (
                <Button onClick={async () => {
                    const favs = await getLocalFavs();
                    if (!favs.length) {
                        showToast("No local favorites to export.", Toasts.Type.FAILURE);
                        return;
                    }
                    navigator.clipboard.writeText(JSON.stringify(favs, null, 2));
                    showToast(`Copied ${favs.length} favorites to clipboard.`, Toasts.Type.SUCCESS);
                }}>
                    Export Local Favorites (JSON)
                </Button>
            );
        }
    },
    clearLocalFavs: {
        type: OptionType.COMPONENT,
        description: "Clear all locally saved favorites",
        component: () => {
            const { Button } = require("@webpack/common");
            return (
                <Button color={Button.Colors.RED} onClick={async () => {
                    await saveLocalFavs([]);
                    showToast("Local favorites cleared.", Toasts.Type.SUCCESS);
                }}>
                    Clear Local Favorites
                </Button>
            );
        }
    }
});

// Patch the addFavoriteGif function directly at runtime
function applyRuntimePatch() {
    try {
        const wreq = (window as any).Vencord?.Webpack?.wreq;
        if (!wreq?.m) return false;

        for (const key of Object.keys(wreq.m)) {
            const src = wreq.m[key].toString();
            if (!src.includes("+XYXtZ") || !src.includes("762880")) continue;

            const patched = src.replace(/\.toBinary\(t\)\.length>\d+/, ".toBinary(t).length>Number.MAX_SAFE_INTEGER");
            if (patched === src) continue;

            const newFn = new Function("e", "t", "n", patched.slice(patched.indexOf("{") + 1, -1));
            wreq.m[key] = newFn;

            delete wreq.c[key];
            wreq(key);

            log("Runtime patch applied to module", key);
            return true;
        }
        log("Module not found for runtime patch, relying on webpack patch");
        return false;
    } catch (e) {
        warn("Runtime patch failed:", e);
        return false;
    }
}

export default definePlugin({
    name: "UnlimitedFavoriteGIFs",
    description: "Bypasses the native GIF favorites size limit, allowing you to save unlimited GIFs.",
    tags: ["Media", "Utility"],
    authors: [{ name: "www.miau.com", id: 1485706082080002140n }],
    settings,

    settingsAboutComponent() {
        return (
            <div style={{ fontSize: "14px", lineHeight: "1.8" }}>
                <p style={{ marginBottom: "12px", color: "var(--header-secondary, #b9bbbe)" }}>
                    Patches Discord's internal <b style={{ color: "var(--header-primary, #fff)" }}>FrecencyUserSettings</b> to
                    remove the GIF favorites size limit, allowing you to save as many GIFs as you want.
                </p>
                <p style={{ marginBottom: "16px", color: "var(--header-secondary, #b9bbbe)" }}>
                    Works seamlessly with <b style={{ color: "var(--header-primary, #fff)" }}>GifTransfer</b> —
                    import hundreds of GIFs without hitting Discord's limit.
                </p>
                <Link href="https://github.com/Mixiruri" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <img
                        src="https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png"
                        alt="GitHub"
                        style={{ width: 20, height: 20, borderRadius: "50%", verticalAlign: "middle" }}
                    />
                    <span>Mixiruri on GitHub</span>
                </Link>
            </div>
        );
    },

    patches: [
        {
            find: '"+XYXtZ"',
            all: true,
            noWarn: true,
            replacement: {
                match: /\.toBinary\(t\)\.length>\d+/,
                replace: ".toBinary(t).length>Number.MAX_SAFE_INTEGER",
            }
        },
    ],

    async start() {
        log("Plugin started.");
        log(`Local favs in DataStore: ${(await getLocalFavs()).length}`);
        applyRuntimePatch();
    },

    stop() {
        log("Plugin stopped.");
    }
});
