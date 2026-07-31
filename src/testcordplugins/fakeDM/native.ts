/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app, IpcMainInvokeEvent } from "electron";
import { existsSync, mkdirSync,readFileSync, writeFileSync } from "fs";
import { join } from "path";

const FAKE_DM_FILE = join(
    app.getPath("userData"),
    "..",
    "TestCord",
    "fakeDM.json"
);

function ensureDir() {
    const dir = join(FAKE_DM_FILE, "..");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function loadFakes(_: IpcMainInvokeEvent): string {
    try {
        if (!existsSync(FAKE_DM_FILE)) return "[]";
        return readFileSync(FAKE_DM_FILE, "utf-8");
    } catch {
        return "[]";
    }
}

export function saveFakes(_: IpcMainInvokeEvent, data: string): boolean {
    try {
        ensureDir();
        writeFileSync(FAKE_DM_FILE, data, "utf-8");
        return true;
    } catch {
        return false;
    }
}
