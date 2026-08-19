/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
// src/userplugins/gpuBinder/native.ts
import { exec as childExec } from "child_process";
import { promisify } from "util";
const exec = promisify(childExec);
/**
 * Manages Windows Graphics Settings (DirectX) for Discord.
 * Automatically binds the current Discord executable to the preferred GPU
 * and cleans up stale registry entries from previous versions.
 */
export async function applyGpuPreference(_event, preference) {
    // Only Windows supports this registry-based GPU binding
    if (process.platform !== "win32")
        return false;
    // Current Discord executable path (changes with every update)
    const discordPath = process.execPath;
    const regPath = "HKCU:\\Software\\Microsoft\\DirectX\\UserGpuPreferences";
    const gpuValue = `GpuPreference=${preference};`;
    // Escape single quotes for PowerShell
    const nameEsc = discordPath.replace(/'/g, "''");
    const valEsc = gpuValue.replace(/'/g, "''");
    const regPathEsc = regPath.replace(/'/g, "''");
    try {
        // 1. Check if the current executable already has the correct preference set
        const checkCmd = `powershell -NoProfile -Command "$p = '${regPathEsc}'; $n = '${nameEsc}'; if (Test-Path $p) { (Get-ItemProperty -Path $p -ErrorAction SilentlyContinue).$n } else { '' }"`;
        const { stdout } = await exec(checkCmd);
        const currentValue = (stdout || "").trim();
        let changed = false;
        // 2. Apply or update settings if they don't match the desired preference
        if (currentValue !== gpuValue) {
            const setCmd = `powershell -NoProfile -Command "$p = '${regPathEsc}'; if (-not (Test-Path $p)) { New-Item -Path $p -Force | Out-Null }; Set-ItemProperty -Path $p -Name '${nameEsc}' -Value '${valEsc}' -Type String -Force"`;
            await exec(setCmd);
            console.log("[GpuBinder Native] Applied GPU preference to current Discord path.");
            changed = true;
        }
        // 3. Stale Entries Cleanup
        // This removes old registry properties containing 'Discord.exe' that point to
        // non-existent previous version folders (e.g., app-1.0.9001), keeping the registry clean.
        const cleanupCmd = `powershell -NoProfile -Command "$p = '${regPathEsc}'; if (Test-Path $p) { $props = Get-ItemProperty -Path $p; $props.PSObject.Properties | Where-Object { $_.Name -like '*Discord.exe*' -and $_.Name -ne '${nameEsc}' } | ForEach-Object { Remove-ItemProperty -Path $p -Name $_.Name -ErrorAction SilentlyContinue } }"`;
        await exec(cleanupCmd);
        return changed;
    }
    catch (error) {
        console.error("[GpuBinder Native] Registry operation failed:", error);
        throw error;
    }
}
