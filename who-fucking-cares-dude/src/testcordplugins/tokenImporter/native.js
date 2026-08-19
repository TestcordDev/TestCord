/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { execFileSync } from "child_process";
import * as crypto from "crypto";
import { dialog, safeStorage } from "electron";
import { existsSync, readdirSync, readFileSync } from "fs";
import { request } from "https";
import { join } from "path";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9175 Chrome/128.0.6613.186 Electron/32.2.7 Safari/537.36";
const X_SUPER_PROPERTIES = "eyJvcyI6IldpbmRvd3MiLCJicm93c2VyIjoiRGlzY29yZCBDbGllbnQiLCJyZWxlYXNlX2NoYW5uZWwiOiJzdGFibGUiLCJjbGllbnRfdmVyc2lvbiI6IjEuMC45MTc1IiwiaGFzX2NsaWVudF9tb2RzIjpmYWxzZX0=";
// Verification token
export async function checkToken(_, token) {
    return new Promise(resolve => {
        const req = request({
            hostname: "discord.com",
            path: "/api/v9/users/@me",
            method: "GET",
            headers: {
                "Authorization": token,
                "User-Agent": USER_AGENT,
                "Content-Type": "application/json",
                "X-Super-Properties": X_SUPER_PROPERTIES,
                "X-Discord-Locale": "en-US",
                "X-Debug-Options": "bugReporterEnabled",
                "Accept": "*/*",
                "Accept-Language": "en-US,en;q=0.9",
                "Connection": "keep-alive",
            }
        }, res => {
            let data = "";
            res.on("data", (chunk) => { data += chunk.toString(); });
            res.on("end", () => {
                if (res.statusCode === 200) {
                    try {
                        resolve({ valid: true, user: JSON.parse(data) });
                    }
                    catch {
                        resolve({ valid: false, error: "parse_error" });
                    }
                }
                else if (res.statusCode === 401 || res.statusCode === 403) {
                    // Token truly invalid/revoked
                    resolve({ valid: false, error: "unauthorized" });
                }
                else if (res.statusCode === 429) {
                    // Rate limited — not invalid, just throttled
                    resolve({ valid: false, error: "rate_limited" });
                }
                else {
                    resolve({ valid: false, error: `http_${res.statusCode}` });
                }
            });
        });
        req.on("error", (e) => {
            console.error("[TokenImporter] req error:", e?.message);
            resolve({ valid: false, error: "network_error" });
        });
        req.setTimeout(15000, () => {
            req.destroy();
            console.warn("[TokenImporter] timeout for token", token.slice(0, 15));
            resolve({ valid: false, error: "timeout" });
        });
        req.end();
    });
}
// Encryption du token (appele depuis le renderer)
export async function encryptToken(_, token) {
    try {
        if (!safeStorage.isEncryptionAvailable())
            return null;
        const encrypted = safeStorage.encryptString(token);
        return "dQw4w9WgXcQ:" + encrypted.toString("base64");
    }
    catch {
        return null;
    }
}
// Decryption companion for encryptToken — used when encryptStoredTokens setting is enabled.
export async function decryptStoredToken(_, payload) {
    try {
        if (!safeStorage.isEncryptionAvailable())
            return null;
        if (!payload.startsWith("dQw4w9WgXcQ:"))
            return null;
        const b64 = payload.slice("dQw4w9WgXcQ:".length);
        const buf = Buffer.from(b64, "base64");
        return safeStorage.decryptString(buf);
    }
    catch {
        return null;
    }
}
function decryptDPAPI(encryptedKeyBase64) {
    const buf = Buffer.from(encryptedKeyBase64, "base64").slice(5);
    const hexStr = buf.toString("hex");
    const script = `
        Add-Type -AssemblyName System.Security
        $bytes = [object[]]::new(${buf.length})
        $hex = "${hexStr}"
        for ($i = 0; $i -lt $hex.Length; $i += 2) {
            $bytes[$i / 2] = [Convert]::ToByte($hex.Substring($i, 2), 16)
        }
        $unprotected = [System.Security.Cryptography.ProtectedData]::Unprotect([byte[]]$bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
        [BitConverter]::ToString($unprotected) -replace '-'
    `;
    try {
        const res = execFileSync("powershell", ["-NoProfile", "-Command", script], {
            encoding: "utf8",
            windowsHide: true // Fix brief terminal window appearance
        });
        return Buffer.from(res.trim(), "hex");
    }
    catch (e) {
        throw e;
    }
}
function decryptToken(encryptedBase64, masterKey) {
    const buf = Buffer.from(encryptedBase64, "base64");
    const iv = buf.subarray(3, 15);
    const payload = buf.subarray(15);
    const authTag = payload.subarray(payload.length - 16);
    const ciphertext = payload.subarray(0, payload.length - 16);
    const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(ciphertext, undefined, "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
}
export async function findLocalTokens() {
    // Exposed over IPC, so any renderer script can call it — make the user confirm.
    const confirm = await dialog.showMessageBox({
        title: "Import local Discord tokens",
        message: "TestCord is about to read the session tokens of every Discord installation on this computer and hand them to the requesting plugin. Continue?",
        detail: "Only continue if you initiated this. A token grants full access to the matching Discord account.",
        type: "warning",
        buttons: ["Cancel", "Import tokens"],
        defaultId: 0,
        cancelId: 0
    });
    if (confirm.response !== 1)
        return [];
    const tokens = new Set();
    const apps = ["discord", "discordcanary", "discordptb", "discorddevelopment", "lightcord"];
    if (process.platform !== "win32")
        return [];
    for (const app of apps) {
        try {
            const appPath = join(process.env.APPDATA || "", app);
            // Folders to scan for this application
            const scanDirs = [
                join(appPath, "Local Storage", "leveldb"),
                join(appPath, "Session Storage")
            ];
            const localStatePath = join(appPath, "Local State");
            if (!existsSync(localStatePath))
                continue;
            const localState = JSON.parse(readFileSync(localStatePath, "utf8"));
            const encryptedKey = localState.os_crypt?.encrypted_key;
            if (!encryptedKey)
                continue;
            const masterKey = decryptDPAPI(encryptedKey);
            for (const dir of scanDirs) {
                if (!existsSync(dir))
                    continue;
                const files = readdirSync(dir);
                for (const file of files) {
                    try {
                        const content = readFileSync(join(dir, file), "latin1");
                        const matches = content.match(/dQw4w9WgXcQ:[A-Za-z0-9+/=]+/g);
                        if (matches) {
                            for (const match of matches) {
                                try {
                                    const enc = match.split("dQw4w9WgXcQ:")[1].split('"')[0].split("\\")[0];
                                    const token = decryptToken(enc, masterKey);
                                    if (token && /(?:mfa\.[\w-]{84}|[\w-]{24,26}\.[\w-]{4,7}\.[\w-]{27,40})/.test(token)) {
                                        tokens.add(token);
                                    }
                                }
                                catch { }
                            }
                        }
                    }
                    catch (e) { }
                }
            }
        }
        catch (e) {
            console.warn("[TokenImporter] Failed to scan app:", app, e?.message ?? e);
        }
    }
    return Array.from(tokens);
}
