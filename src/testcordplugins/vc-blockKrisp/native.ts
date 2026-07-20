/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app, session } from "electron";
import { join } from "path";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";

const PRELOAD_FILENAME = "vc-blockKrisp-preload.js";

function inject() {
    try {
        const userData = app.getPath("userData");
        const preloadDir = join(userData, "Testcord");
        if (!existsSync(preloadDir)) mkdirSync(preloadDir, { recursive: true });

        const preloadPath = join(preloadDir, PRELOAD_FILENAME);

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

        if (session?.defaultSession) {
            session.defaultSession.setPreloads([preloadPath]);
        }
    } catch (e) {
        console.error("[vc-blockKrisp] Failed to inject Krisp-blocking preload:", e);
    }
}

app.on("browser-window-created", () => inject());
inject();
