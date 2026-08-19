/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { execSync } from "child_process";
import { app } from "electron";
import * as fs from "fs";
import * as path from "path";
// Folder where cursors are copied so Windows can read them
const CURSOR_DIR = path.join(app.getPath("userData"), "NightcordCursors");
// Mapping : registry key → .cur/.ani file
const CURSOR_MAP = {
    Arrow: "Normal.cur",
    Help: "Help.cur",
    AppStarting: "Working.ani",
    Wait: "Busy.ani",
    Crosshair: "Precision.cur",
    IBeam: "Text.cur",
    NWPen: "Handwriting.cur",
    No: "Unavailable.cur",
    SizeNS: "Vertical Resize.cur",
    SizeWE: "Horizontal Resize.cur",
    SizeNWSE: "Diagonal Resize 1.cur",
    SizeNESW: "Diagonal Resize 2.cur",
    SizeAll: "Move.cur",
    UpArrow: "Alternate.cur",
    Hand: "Link.cur",
};
// Mapping : style+size → relative path in mac/mac/
const STYLE_PATHS = {
    "modern_shadow_normal": "1. Sierra and newer/2. With Shadow/1. Normal",
    "modern_shadow_large": "1. Sierra and newer/2. With Shadow/2. Large",
    "modern_shadow_xl": "1. Sierra and newer/2. With Shadow/3. XtraLarge",
    "modern_no_shadow_normal": "1. Sierra and newer/1. No Shadow/1. Normal",
    "modern_no_shadow_large": "1. Sierra and newer/1. No Shadow/2. Large",
    "modern_no_shadow_xl": "1. Sierra and newer/1. No Shadow/3. XtraLarge",
    "classic_shadow_normal": "2. El Capitan and before/2. With Shadow/1. Normal",
    "classic_shadow_large": "2. El Capitan and before/2. With Shadow/2. Large",
    "classic_shadow_xl": "2. El Capitan and before/2. With Shadow/3. XtraLarge",
    "classic_no_shadow_normal": "2. El Capitan and before/1. No Shadow/1. Normal",
    "classic_no_shadow_large": "2. El Capitan and before/1. No Shadow/2. Large",
    "classic_no_shadow_xl": "2. El Capitan and before/1. No Shadow/3. XtraLarge",
};
function findMacDir() {
    // Look for mac/ directory next to executable or in resources
    const candidates = [
        path.join(path.dirname(process.execPath), "mac", "mac"),
        path.join(process.resourcesPath, "mac", "mac"),
        path.join(process.resourcesPath, "..", "mac", "mac"),
        // Dev mode
        path.join(__dirname, "..", "..", "..", "..", "mac", "mac"),
        path.join(__dirname, "..", "..", "..", "mac", "mac"),
    ];
    for (const c of candidates) {
        if (fs.existsSync(c))
            return c;
    }
    return null;
}
// Save current cursors before modifying them
let savedCursors = null;
function backupCurrentCursors() {
    if (savedCursors)
        return; // Already saved
    savedCursors = {};
    try {
        for (const regKey of Object.keys(CURSOR_MAP)) {
            try {
                const result = execSync(`reg query "HKCU\\Control Panel\\Cursors" /v ${regKey}`, {
                    encoding: "utf-8",
                    windowsHide: true,
                    stdio: ["ignore", "pipe", "ignore"]
                });
                // Parse output : "    Arrow   REG_EXPAND_SZ    C:\...\aero_arrow.cur"
                const match = result.match(/REG_(?:EXPAND_)?SZ\s+(.+)/);
                if (match) {
                    savedCursors[regKey] = match[1].trim();
                }
                else {
                    savedCursors[regKey] = "";
                }
            }
            catch {
                savedCursors[regKey] = "";
            }
        }
        // Save to disk in case the process crashes
        const backupPath = path.join(CURSOR_DIR, "backup.json");
        fs.mkdirSync(CURSOR_DIR, { recursive: true });
        fs.writeFileSync(backupPath, JSON.stringify(savedCursors, null, 2));
    }
    catch (e) {
        console.error("[CursorMacOS] Error backup:", e);
    }
}
function loadBackup() {
    try {
        const backupPath = path.join(CURSOR_DIR, "backup.json");
        if (fs.existsSync(backupPath)) {
            return JSON.parse(fs.readFileSync(backupPath, "utf-8"));
        }
    }
    catch { }
    return null;
}
function refreshSystemCursors() {
    // Call SystemParametersInfo via PowerShell to force Windows to reload cursors
    try {
        const psCode = `
$Code = @'
using System;
using System.Runtime.InteropServices;
public class CursorHelper {
    [DllImport("user32.dll")]
    public static extern bool SystemParametersInfo(uint uiAction, uint uiParam, IntPtr pvParam, uint fWinIni);
}
'@
Add-Type -TypeDefinition $Code
[CursorHelper]::SystemParametersInfo(0x0057, 0, [IntPtr]::Zero, 3)
`;
        const b64 = Buffer.from(psCode, "utf16le").toString("base64");
        execSync(`powershell -NoProfile -EncodedCommand ${b64}`, {
            encoding: "utf-8",
            windowsHide: true
        });
    }
    catch (e) {
        console.error("[CursorMacOS] Error refresh cursors:", e);
    }
}
export async function applyCursors(_, style, size) {
    try {
        const macDir = findMacDir();
        console.log("[CursorMacOS] macDir found:", macDir);
        if (!macDir) {
            return { ok: false, error: "mac/ directory not found. Place it next to the Nightcord executable." };
        }
        const key = `${style}_${size}`;
        const relativePath = STYLE_PATHS[key];
        if (!relativePath) {
            return { ok: false, error: `Unknown style/size: ${key}` };
        }
        const sourceDir = path.join(macDir, relativePath);
        if (!fs.existsSync(sourceDir)) {
            return { ok: false, error: `Source directory not found: ${sourceDir}` };
        }
        // 1. Current cursors backup
        backupCurrentCursors();
        // 2. Create destination folder and copy files
        fs.mkdirSync(CURSOR_DIR, { recursive: true });
        for (const [regKey, fileName] of Object.entries(CURSOR_MAP)) {
            const src = path.join(sourceDir, fileName);
            const dst = path.join(CURSOR_DIR, fileName);
            if (fs.existsSync(src)) {
                fs.copyFileSync(src, dst);
                // 3. Modify registry
                try {
                    execSync(`reg add "HKCU\\Control Panel\\Cursors" /v ${regKey} /t REG_EXPAND_SZ /d "${dst}" /f`, {
                        encoding: "utf-8",
                        windowsHide: true,
                        stdio: "ignore"
                    });
                }
                catch (e) {
                    console.error(`[CursorMacOS] Error reg for ${regKey}:`, e);
                }
            }
        }
        // 4. Set scheme name
        try {
            execSync("reg add \"HKCU\\Control Panel\\Cursors\" /ve /t REG_SZ /d \"Nightcord macOS\" /f", {
                encoding: "utf-8",
                windowsHide: true,
                stdio: "ignore"
            });
        }
        catch { }
        // 5. Refresh system cursors
        refreshSystemCursors();
        console.log(`[CursorMacOS] Cursors applied: ${style}/${size}`);
        return { ok: true };
    }
    catch (e) {
        console.error("[CursorMacOS] Error applyCursors:", e);
        return { ok: false, error: e?.message ?? String(e) };
    }
}
export async function restoreCursors(_) {
    try {
        // Load backup (either from memory or from disk)
        const backup = savedCursors || loadBackup();
        if (backup) {
            for (const [regKey, value] of Object.entries(backup)) {
                try {
                    if (value) {
                        execSync(`reg add "HKCU\\Control Panel\\Cursors" /v ${regKey} /t REG_EXPAND_SZ /d "${value}" /f`, {
                            encoding: "utf-8",
                            windowsHide: true,
                            stdio: "ignore"
                        });
                    }
                    else {
                        // Empty value = delete entry (return to Windows default)
                        execSync(`reg add "HKCU\\Control Panel\\Cursors" /v ${regKey} /t REG_EXPAND_SZ /d "" /f`, {
                            encoding: "utf-8",
                            windowsHide: true,
                            stdio: "ignore"
                        });
                    }
                }
                catch { }
            }
            // Set default scheme name back
            try {
                execSync("reg add \"HKCU\\Control Panel\\Cursors\" /ve /t REG_SZ /d \"Windows Default\" /f", { encoding: "utf-8", windowsHide: true, stdio: "ignore" });
            }
            catch { }
        }
        else {
            // No backup — we set everything to empty (Windows default cursors)
            for (const regKey of Object.keys(CURSOR_MAP)) {
                try {
                    execSync(`reg add "HKCU\\Control Panel\\Cursors" /v ${regKey} /t REG_EXPAND_SZ /d "" /f`, {
                        encoding: "utf-8",
                        windowsHide: true,
                        stdio: "ignore"
                    });
                }
                catch { }
            }
            try {
                execSync("reg add \"HKCU\\Control Panel\\Cursors\" /ve /t REG_SZ /d \"Windows Default\" /f", {
                    encoding: "utf-8",
                    windowsHide: true,
                    stdio: "ignore"
                });
            }
            catch { }
        }
        // Refresh
        refreshSystemCursors();
        // Clear backup
        savedCursors = null;
        try {
            const backupPath = path.join(CURSOR_DIR, "backup.json");
            if (fs.existsSync(backupPath))
                fs.unlinkSync(backupPath);
        }
        catch { }
        console.log("[CursorMacOS] Default Windows cursors restored");
        return { ok: true };
    }
    catch (e) {
        console.error("[CursorMacOS] Error restoreCursors:", e);
        return { ok: false, error: e?.message ?? String(e) };
    }
}
