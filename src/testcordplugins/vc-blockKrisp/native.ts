/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { RendererSettings } from "@main/settings";
import { app, session } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const PRELOAD_FILENAME = "vc-blockKrisp-preload.js";

function isEnabled() {
    return RendererSettings.store.plugins?.BlockKrisp?.enabled === true;
}

function getPreloadPath() {
    const preloadDir = join(app.getPath("userData"), "Testcord");
    if (!existsSync(preloadDir)) mkdirSync(preloadDir, { recursive: true });
    return join(preloadDir, PRELOAD_FILENAME);
}

function sync() {
    try {
        const { defaultSession } = session;
        if (!defaultSession) return;

        const preloadPath = getPreloadPath();
        // setPreloads replaces the whole list, so preserve anything else already
        // registered instead of wiping other preloads off the session.
        const others = defaultSession.getPreloads().filter(p => !p.endsWith(PRELOAD_FILENAME));

        if (!isEnabled()) {
            defaultSession.setPreloads(others);
            return;
        }

        const preloadSrc = [
            "try{",
            "var od=process.dlopen;",
            "if(od){",
            "process.dlopen=function(t,f){",
            "if(f&&(f.includes('discord_krisp')||f.includes('krisp')))return;",
            "return od.apply(this,arguments)",
            "}",
            "}",
            "}catch(e){}"
        ].join("");

        if (!existsSync(preloadPath) || readFileSync(preloadPath, "utf-8") !== preloadSrc) {
            writeFileSync(preloadPath, preloadSrc, "utf-8");
        }

        defaultSession.setPreloads([...others, preloadPath]);
    } catch (e) {
        console.error("[vc-blockKrisp] Failed to sync Krisp-blocking preload:", e);
    }
}

app.on("browser-window-created", sync);
RendererSettings.addChangeListener("plugins.BlockKrisp.enabled" as any, sync);
sync();
