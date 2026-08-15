/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { execFileSync } from "child_process";
import * as crypto from "crypto";
import { app, dialog, type IpcMainInvokeEvent, safeStorage } from "electron";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { request } from "https";
import { join } from "path";

import { type CheckTokenUser,ENCRYPTION_PREFIX, FALLBACK_PREFIX, TOKEN_REGEX_SOURCE } from "./common";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9175 Chrome/128.0.6613.186 Electron/32.2.7 Safari/537.36";
const X_SUPER_PROPERTIES = "eyJvcyI6IldpbmRvd3MiLCJicm93c2VyIjoiRGlzY29yZCBDbGllbnQiLCJyZWxlYXNlX2NoYW5uZWwiOiJzdGFibGUiLCJjbGllbnRfdmVyc2lvbiI6IjAuMC45MTc1IiwiaGFzX2NsaWVudF9tb2RzIjpmYWxzZX0=";

const TOKEN_SHAPE = new RegExp(`^${TOKEN_REGEX_SOURCE}$`);
// mfa tokens are 88 chars, user tokens ~70; anything longer is garbage
const MAX_TOKEN_LENGTH = 120;
// /users/@me responses are a few KB; anything bigger means something is wrong
const MAX_RESPONSE_BYTES = 128 * 1024;
const MAX_ENCRYPTED_LENGTH = 1024;

// Every handler argument except the event comes from the renderer and is untrusted.
function validToken(value: unknown): value is string {
    return typeof value === "string" && value.length <= MAX_TOKEN_LENGTH && TOKEN_SHAPE.test(value);
}

export async function encryptionAvailable(): Promise<boolean> {
    try {
        if (safeStorage.isEncryptionAvailable()) return true;
    } catch { /* fall through to the built-in cipher */ }
    try {
        getFallbackKey();
        return true;
    } catch {
        return false;
    }
}

// Health probe for the settings UI: checks both backends with a live
// encrypt/decrypt round-trip and reports which one is actually usable.
export async function verifyEncryption(): Promise<{
    safeStorageAvailable: boolean;
    safeStorageRoundTrip: boolean;
    builtinRoundTrip: boolean;
}> {
    const result = { safeStorageAvailable: false, safeStorageRoundTrip: false, builtinRoundTrip: false };
    const probe = "ti-probe-" + crypto.randomBytes(8).toString("hex");
    try {
        result.safeStorageAvailable = safeStorage.isEncryptionAvailable();
    } catch { /* stays false */ }
    if (result.safeStorageAvailable) {
        try {
            result.safeStorageRoundTrip = safeStorage.decryptString(safeStorage.encryptString(probe)) === probe;
        } catch { /* stays false */ }
    }
    try {
        result.builtinRoundTrip = decryptAes(encryptAes(probe)) === probe;
    } catch { /* stays false */ }
    return result;
}

export async function checkToken(_: IpcMainInvokeEvent, token: string): Promise<{ valid: boolean; user?: CheckTokenUser; error?: string; }> {
    if (!validToken(token)) return { valid: false, error: "invalid_input" };
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
            let oversized = false;
            res.on("data", (chunk: Buffer) => {
                data += chunk.toString();
                if (data.length > MAX_RESPONSE_BYTES && !oversized) {
                    oversized = true;
                    req.destroy();
                    resolve({ valid: false, error: "response_too_large" });
                }
            });
            res.on("error", () => resolve({ valid: false, error: "network_error" }));
            res.on("end", () => {
                if (oversized) return;
                if (res.statusCode === 200) {
                    try {
                        resolve({ valid: true, user: JSON.parse(data) });
                    } catch {
                        resolve({ valid: false, error: "parse_error" });
                    }
                } else if (res.statusCode === 401 || res.statusCode === 403) {
                    resolve({ valid: false, error: "unauthorized" });
                } else if (res.statusCode === 429) {
                    resolve({ valid: false, error: "rate_limited" });
                } else {
                    resolve({ valid: false, error: `http_${res.statusCode}` });
                }
            });
        });
        req.on("error", () => resolve({ valid: false, error: "network_error" }));
        req.setTimeout(15000, () => {
            req.destroy();
            resolve({ valid: false, error: "timeout" });
        });
        req.end();
    });
}

export async function encryptToken(_: IpcMainInvokeEvent, token: string): Promise<string | null> {
    if (!validToken(token)) return null;
    // Primary: OS-keychain-backed safeStorage (DPAPI / Keychain / libsecret).
    try {
        if (safeStorage.isEncryptionAvailable()) {
            return ENCRYPTION_PREFIX + safeStorage.encryptString(token).toString("base64");
        }
    } catch (e) {
        console.warn("[DXTokenImporter] safeStorage encrypt failed, using built-in cipher:", (e as Error).message);
    }
    // Never fall through to plaintext: switch to the built-in AES-256-GCM envelope.
    try {
        return encryptAes(token);
    } catch (e) {
        console.error("[DXTokenImporter] built-in cipher failed:", (e as Error).message);
        return null;
    }
}

export async function decryptStoredToken(_: IpcMainInvokeEvent, payload: string): Promise<string | null> {
    if (typeof payload !== "string" || payload.length > MAX_ENCRYPTED_LENGTH) return null;
    if (payload.startsWith(ENCRYPTION_PREFIX)) {
        try {
            return safeStorage.decryptString(Buffer.from(payload.slice(ENCRYPTION_PREFIX.length), "base64"));
        } catch {
            return null;
        }
    }
    if (payload.startsWith(FALLBACK_PREFIX)) return decryptAes(payload);
    return null;
}

// Built-in cipher for systems where safeStorage is unavailable (e.g. Linux
// without a secret service). AES-256-GCM under a key derived with HKDF-SHA512:
// both primitives keep 256-bit classical strength and remain unbroken by
// Grover-era quantum search (effective ~128-bit for AES-256, SHA-512 stronger).
// The master key is a random 32-byte file in the app's userData directory,
// unreadable from the renderer, so other plugins still cannot recover tokens.
let fallbackKey: Buffer | null = null;

function getFallbackKey(): Buffer {
    if (fallbackKey) return fallbackKey;
    const keyPath = join(app.getPath("userData"), "tokenimporter.key");
    try {
        const existing = readFileSync(keyPath);
        if (existing.length === 32) {
            fallbackKey = existing;
            return fallbackKey;
        }
    } catch { /* no key file yet */ }
    fallbackKey = crypto.randomBytes(32);
    writeFileSync(keyPath, fallbackKey, { mode: 0o600 });
    return fallbackKey;
}

function deriveAesKey(salt: Buffer): Buffer {
    return Buffer.from(crypto.hkdfSync("sha512", getFallbackKey(), salt, "tokenimporter-aesgcm-v1", 32));
}

// Envelope: FALLBACK_PREFIX + base64(salt[16] | iv[12] | gcmTag[16] | ciphertext)
function encryptAes(token: string): string {
    const salt = crypto.randomBytes(16);
    const key = deriveAesKey(salt);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
    return FALLBACK_PREFIX + Buffer.concat([salt, iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

function decryptAes(payload: string): string | null {
    try {
        const buf = Buffer.from(payload.slice(FALLBACK_PREFIX.length), "base64");
        const salt = buf.subarray(0, 16);
        const iv = buf.subarray(16, 28);
        const tag = buf.subarray(28, 44);
        const ciphertext = buf.subarray(44);
        const key = deriveAesKey(salt);
        const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch {
        return null;
    }
}

// All master keys are unwrapped in a single powershell run: one spawn per key
// added seconds to a full scan. Keys travel as hex strings inside a JSON
// document on stdin, so the script itself has no injection surface.
const DPAPI_SCRIPT = `
    Add-Type -AssemblyName System.Security
    $hexKeys = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $out = New-Object System.Collections.Generic.List[string]
    foreach ($hexKey in $hexKeys) {
        $bytes = [object[]]::new($hexKey.Length / 2)
        for ($i = 0; $i -lt $hexKey.Length; $i += 2) {
            $bytes[$i / 2] = [Convert]::ToByte($hexKey.Substring($i, 2), 16)
        }
        try {
            $unprotected = [System.Security.Cryptography.ProtectedData]::Unprotect([byte[]]$bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
            $out.Add([BitConverter]::ToString($unprotected) -replace '-')
        } catch {
            $out.Add('')
        }
    }
    $out -join [Environment]::NewLine
`;

// Returns one hex string per input key, "" for keys that failed to unwrap.
function decryptDPAPIKeys(hexKeys: string[]): string[] {
    const res = execFileSync("powershell", ["-NoProfile", "-Command", DPAPI_SCRIPT], {
        input: JSON.stringify(hexKeys),
        encoding: "utf8",
        windowsHide: true
    });
    const lines = res.trim().split(/\r?\n/);
    return hexKeys.map((_, i) => lines[i] ?? "");
}

function decryptToken(encryptedBase64: string, masterKey: Buffer): string {
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

export async function findLocalTokens(): Promise<string[]> {
    if (process.platform !== "win32") return [];

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
    if (confirm.response !== 1) return [];

    const apps = ["discord", "discordcanary", "discordptb", "discorddevelopment", "lightcord"];
    const scanDirs = [
        ["Local Storage", "leveldb"],
        ["Session Storage"]
    ];

    // First pass: collect every install's DPAPI-protected master key.
    const installs: Array<{ appPath: string; encryptedKey: string; }> = [];
    for (const app of apps) {
        const appPath = join(process.env.APPDATA || "", app);
        const localStatePath = join(appPath, "Local State");
        if (!existsSync(localStatePath)) continue;
        try {
            const localState = JSON.parse(readFileSync(localStatePath, "utf8"));
            const encryptedKey = localState.os_crypt?.encrypted_key;
            if (typeof encryptedKey === "string" && encryptedKey) installs.push({ appPath, encryptedKey });
        } catch (e) {
            console.warn("[DXTokenImporter] Failed to read Local State of", app, (e as Error).message);
        }
    }
    if (installs.length === 0) return [];

    const uniqueKeys = [...new Set(installs.map(i => i.encryptedKey))];
    let decryptedKeys: string[];
    try {
        decryptedKeys = decryptDPAPIKeys(uniqueKeys.map(k => Buffer.from(k, "base64").slice(5).toString("hex")));
    } catch (e) {
        console.warn("[DXTokenImporter] DPAPI unwrap failed:", (e as Error).message);
        return [];
    }
    const keyHexByEncrypted = new Map(uniqueKeys.map((k, i) => [k, decryptedKeys[i]]));

    const tokenShape = new RegExp(TOKEN_REGEX_SOURCE);
    const tokenBlob = new RegExp(`${ENCRYPTION_PREFIX}[A-Za-z0-9+/=]+`, "g");
    const tokens = new Set<string>();
    for (const { appPath, encryptedKey } of installs) {
        const keyHex = keyHexByEncrypted.get(encryptedKey);
        if (!keyHex) continue;
        const masterKey = Buffer.from(keyHex, "hex");

        for (const dir of scanDirs) {
            const dirPath = join(appPath, ...dir);
            if (!existsSync(dirPath)) continue;
            for (const file of readdirSync(dirPath)) {
                try {
                    const blobs = readFileSync(join(dirPath, file), "latin1").match(tokenBlob);
                    if (!blobs) continue;
                    for (const blob of blobs) {
                        try {
                            const enc = blob.slice(ENCRYPTION_PREFIX.length).split('"')[0].split("\\")[0];
                            const token = decryptToken(enc, masterKey);
                            if (tokenShape.test(token)) tokens.add(token);
                        } catch { /* individual blobs from other origins fail to unwrap; skip them */ }
                    }
                } catch { /* unreadable/locked leveldb file; skip */ }
            }
        }
    }
    return Array.from(tokens);
}
