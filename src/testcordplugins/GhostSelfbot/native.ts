/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { execFileSync, spawn } from "child_process";
import type { IpcMainInvokeEvent } from "electron";
import { unzipSync } from "fflate";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { get as httpsGet } from "https";
import { dirname, isAbsolute, join, relative, resolve } from "path";

const logger = new Logger("GhostSelfbotNative");
const GITHUB_RELEASE_API_URL = "https://api.github.com/repos/ghostselfbot/ghost/releases/latest";
const GHOST_WINDOWS_ZIP_URL = "https://github.com/ghostselfbot/ghost/releases/latest/download/Ghost-Windows.zip";
const GHOST_WINDOWS_DIR = "Ghost-Windows";
const GHOST_SOURCE_DIR = "Ghost-Source";
const GHOST_WINDOWS_ASSET = "Ghost-Windows.zip";
const MAX_DOWNLOAD_BYTES = 250 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const ALLOWED_DOWNLOAD_HOSTS = new Set([
    "api.github.com",
    "github.com",
    "codeload.github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com"
]);

export interface GhostToken {
    token: string;
    username: string;
    id: string;
}

export interface GhostStatus {
    ghostExeFound: boolean;
    ghostSourceFound: boolean;
    pythonFound: boolean;
    requirementsFound: boolean;
    version?: string;
}

export interface GhostInstallResult extends GhostStatus {
    success: boolean;
    downloaded: boolean;
    error?: string;
}

let ghostPluginPath: string | null = null;

function detectGhostPluginPath(): string {
    if (ghostPluginPath) return ghostPluginPath;

    const candidates = [
        __dirname,
        join(__dirname, "..", "..", "src", "userplugins", "GhostSelfbot"),
        join(__dirname, "..", "src", "userplugins", "GhostSelfbot")
    ];

    for (const candidate of candidates) {
        const pluginDir = resolve(candidate);
        const normalizedPluginDir = pluginDir.replace(/\\/g, "/");
        if (
            existsSync(pluginDir) &&
            (
                normalizedPluginDir.endsWith("/userplugins/GhostSelfbot") ||
                existsSync(join(pluginDir, "index.ts")) ||
                existsSync(join(pluginDir, "native.ts"))
            )
        ) {
            ghostPluginPath = pluginDir;
            return ghostPluginPath;
        }
    }

    ghostPluginPath = resolve(__dirname);
    return ghostPluginPath;
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function getSafePythonPath(pythonPath: string): string {
    const trimmed = pythonPath.trim() || "python";
    if (trimmed.includes("\n") || trimmed.includes("\r")) throw new Error("Invalid Python path");
    return trimmed;
}

function assertInside(basePath: string, targetPath: string): void {
    const relativePath = relative(resolve(basePath), resolve(targetPath));
    if (relativePath.startsWith("..") || isAbsolute(relativePath))
        throw new Error("Unsafe archive path");
}

function recreateDirectory(pluginDir: string, targetPath: string): void {
    assertInside(pluginDir, targetPath);
    rmSync(targetPath, { recursive: true, force: true });
    mkdirSync(targetPath, { recursive: true });
}

function getStringProperty(value: Record<string, unknown>, key: string): string | undefined {
    const property = value[key];
    return typeof property === "string" ? property : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertAllowedDownloadUrl(downloadUrl: string): URL {
    const url = new URL(downloadUrl);
    if (url.protocol !== "https:" || !ALLOWED_DOWNLOAD_HOSTS.has(url.hostname))
        throw new Error("Download URL is not allowed");
    return url;
}

function downloadBuffer(downloadUrl: string, redirects = 0): Promise<Buffer> {
    const url = assertAllowedDownloadUrl(downloadUrl);

    return new Promise((resolvePromise, reject) => {
        const request = httpsGet(url, {
            headers: {
                Accept: "application/octet-stream",
                "User-Agent": "Equicord-GhostSelfbot"
            }
        }, response => {
            const statusCode = response.statusCode ?? 0;

            if ([301, 302, 303, 307, 308].includes(statusCode)) {
                const { location } = response.headers;
                response.resume();

                if (!location) {
                    reject(new Error("Download redirect did not include a location"));
                    return;
                }

                if (redirects >= MAX_REDIRECTS) {
                    reject(new Error("Download redirected too many times"));
                    return;
                }

                const nextUrl = new URL(location, url).toString();
                downloadBuffer(nextUrl, redirects + 1).then(resolvePromise, reject);
                return;
            }

            if (statusCode < 200 || statusCode >= 300) {
                response.resume();
                reject(new Error(`Download failed with HTTP ${statusCode}`));
                return;
            }

            const chunks: Buffer[] = [];
            let totalBytes = 0;

            response.on("data", (chunk: Buffer) => {
                totalBytes += chunk.length;
                if (totalBytes > MAX_DOWNLOAD_BYTES) {
                    request.destroy(new Error("Download is too large"));
                    return;
                }

                chunks.push(chunk);
            });

            response.on("end", () => resolvePromise(Buffer.concat(chunks)));
        });

        request.setTimeout(60_000, () => request.destroy(new Error("Download timed out")));
        request.on("error", reject);
    });
}

async function getLatestRelease(): Promise<{ tagName: string; sourceZipUrl: string; windowsZipUrl: string; }> {
    const data = await downloadBuffer(GITHUB_RELEASE_API_URL);
    const release = JSON.parse(data.toString("utf-8")) as unknown;

    if (!isRecord(release)) throw new Error("GitHub release response is invalid");

    const tagName = getStringProperty(release, "tag_name") ?? "latest";
    const sourceZipUrl = getStringProperty(release, "zipball_url");
    let windowsZipUrl = GHOST_WINDOWS_ZIP_URL;

    const { assets } = release;
    if (Array.isArray(assets)) {
        for (const asset of assets) {
            if (!isRecord(asset)) continue;
            if (getStringProperty(asset, "name") !== GHOST_WINDOWS_ASSET) continue;

            windowsZipUrl = getStringProperty(asset, "browser_download_url") ?? windowsZipUrl;
            break;
        }
    }

    if (!sourceZipUrl) throw new Error("GitHub release source zip was not found");

    return { tagName, sourceZipUrl, windowsZipUrl };
}

function getZipEntries(zipData: Buffer): Record<string, Uint8Array> {
    return unzipSync(new Uint8Array(zipData));
}

function shouldStripRoot(entryNames: string[]): boolean {
    let root: string | undefined;

    for (const entryName of entryNames) {
        const parts = entryName.replace(/\\/g, "/").split("/").filter(Boolean);
        if (parts.length < 2) return false;

        if (root === undefined) {
            root = parts[0];
            continue;
        }

        if (root !== parts[0]) return false;
    }

    return root !== undefined;
}

function extractZip(zipData: Buffer, targetDir: string, stripRoot: boolean): void {
    const entries = getZipEntries(zipData);
    const entryNames = Object.keys(entries).filter(entryName => !entryName.replace(/\\/g, "/").endsWith("/"));
    const shouldStrip = stripRoot || shouldStripRoot(entryNames);

    for (const entryName of entryNames) {
        const parts = entryName.replace(/\\/g, "/").split("/").filter(Boolean);
        const relativeParts = shouldStrip ? parts.slice(1) : parts;
        if (relativeParts.length === 0) continue;

        const outputPath = resolve(targetDir, ...relativeParts);
        assertInside(targetDir, outputPath);
        mkdirSync(dirname(outputPath), { recursive: true });
        writeFileSync(outputPath, entries[entryName]);
    }
}

export function getGhostExePath(): string {
    const pluginDir = detectGhostPluginPath();
    const exePath = join(pluginDir, GHOST_WINDOWS_DIR, "Ghost.exe");
    logger.log("Checking Ghost.exe at:", exePath);
    return exePath;
}

export function getGhostSourcePath(): string {
    const pluginDir = detectGhostPluginPath();
    const sourcePath = join(pluginDir, GHOST_SOURCE_DIR);
    logger.log("Checking Ghost source at:", sourcePath);
    return sourcePath;
}

export function getGhostConfigPath(): string {
    return join(process.env.APPDATA || "", "Ghost/config.json");
}

export function getGhostTokensPath(): string {
    return join(process.env.APPDATA || "", "Ghost/data/sensitive/tokens.json");
}

export function getGhostRequirementsPath(): string {
    const ghostSourcePath = getGhostSourcePath();
    return ghostSourcePath ? join(ghostSourcePath, "requirements.txt") : "";
}

export async function installGhostPayloads(_event: IpcMainInvokeEvent, force = false): Promise<GhostInstallResult> {
    const pluginDir = detectGhostPluginPath();
    const ghostExePath = getGhostExePath();
    const ghostSourcePath = getGhostSourcePath();
    const shouldForce = force === true;
    let version: string | undefined;

    try {
        const needsExe = shouldForce || !existsSync(ghostExePath);
        const needsSource = shouldForce || !existsSync(join(ghostSourcePath, "ghost.py"));

        if (!needsExe && !needsSource) {
            return {
                success: true,
                downloaded: false,
                ghostExeFound: true,
                ghostSourceFound: true,
                pythonFound: false,
                requirementsFound: existsSync(getGhostRequirementsPath())
            };
        }

        const release = await getLatestRelease();
        version = release.tagName;

        if (needsSource) {
            recreateDirectory(pluginDir, ghostSourcePath);
            const sourceZip = await downloadBuffer(release.sourceZipUrl);
            extractZip(sourceZip, ghostSourcePath, true);
            if (!existsSync(join(ghostSourcePath, "ghost.py")))
                throw new Error("Downloaded source code did not include ghost.py");
        }

        if (needsExe) {
            const ghostWindowsPath = join(pluginDir, GHOST_WINDOWS_DIR);
            recreateDirectory(pluginDir, ghostWindowsPath);
            const windowsZip = await downloadBuffer(release.windowsZipUrl);
            extractZip(windowsZip, ghostWindowsPath, false);
            if (!existsSync(ghostExePath))
                throw new Error("Downloaded Windows build did not include Ghost.exe");
        }

        return {
            success: true,
            downloaded: true,
            ghostExeFound: existsSync(ghostExePath),
            ghostSourceFound: existsSync(join(ghostSourcePath, "ghost.py")),
            pythonFound: false,
            requirementsFound: existsSync(getGhostRequirementsPath()),
            version
        };
    } catch (error) {
        const message = getErrorMessage(error);
        logger.error("Failed to install Ghost payloads:", message);

        return {
            success: false,
            downloaded: false,
            ghostExeFound: existsSync(ghostExePath),
            ghostSourceFound: existsSync(join(ghostSourcePath, "ghost.py")),
            pythonFound: false,
            requirementsFound: existsSync(getGhostRequirementsPath()),
            version,
            error: message
        };
    }
}

export function checkPythonInstalled(_event: IpcMainInvokeEvent, pythonPath: string): boolean {
    try {
        execFileSync(getSafePythonPath(pythonPath), ["--version"], { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

export function installRequirements(_event: IpcMainInvokeEvent, pythonPath: string): boolean {
    try {
        const requirementsPath = getGhostRequirementsPath();

        if (!requirementsPath) {
            logger.error("Could not find requirements.txt path");
            return false;
        }

        if (!existsSync(requirementsPath)) {
            logger.error("requirements.txt not found in Ghost source directory");
            return false;
        }

        logger.log("Installing Python requirements...");
        execFileSync(getSafePythonPath(pythonPath), ["-m", "pip", "install", "-r", requirementsPath], {
            stdio: "inherit"
        });

        logger.log("Python requirements installed successfully");
        return true;
    } catch (error) {
        logger.error("Failed to install requirements:", error);
        return false;
    }
}

export function updateGhostConfig(_event: IpcMainInvokeEvent, token: string): boolean {
    try {
        const ghostConfigPath = getGhostConfigPath();
        const ghostTokensPath = getGhostTokensPath();

        if (!existsSync(ghostConfigPath)) {
            logger.error("Ghost config not found. Please run Ghost.exe first to create config.");
            return false;
        }

        const config = JSON.parse(readFileSync(ghostConfigPath, "utf-8"));
        config.token = token;
        writeFileSync(ghostConfigPath, JSON.stringify(config, null, 4));

        if (existsSync(ghostTokensPath)) {
            const tokens: GhostToken[] = JSON.parse(readFileSync(ghostTokensPath, "utf-8"));
            const { UserStore } = require("@webpack/common");
            const currentUser = UserStore.getCurrentUser();
            const existingIndex = tokens.findIndex((t: GhostToken) => t.id === currentUser.id);

            if (existingIndex >= 0) {
                tokens[existingIndex].token = token;
                tokens[existingIndex].username = currentUser.username;
            } else {
                tokens.push({
                    token: token,
                    username: currentUser.username,
                    id: currentUser.id
                });
            }

            writeFileSync(ghostTokensPath, JSON.stringify(tokens, null, 4));
        }

        return true;
    } catch (error) {
        logger.error("Failed to update Ghost config:", error);
        return false;
    }
}

export function launchGhostExe(_event: IpcMainInvokeEvent, autoFillToken: boolean, token: string | null, nitroWebhookUrl: string, privnoteWebhookUrl: string, autoSetupWebhooks: boolean): void {
    const ghostExePath = getGhostExePath();

    if (!ghostExePath || !existsSync(ghostExePath)) {
        throw new Error("Ghost.exe not found");
    }

    if (autoFillToken && token) {
        updateGhostConfig(_event, token);
        logger.log("Token updated in Ghost config");
    }

    if (nitroWebhookUrl || privnoteWebhookUrl) {
        updateGhostWebhooks(_event, nitroWebhookUrl, privnoteWebhookUrl);
    }

    if (autoSetupWebhooks) {
        enableWebhookSetup(_event);
    }

    // Ensure fonts and data are accessible by setting working directory
    const ghostPluginDir = dirname(ghostExePath);
    const options = {
        cwd: ghostPluginDir,
        env: {
            ...process.env,
            GHOST_PLUGIN_DIR: ghostPluginDir
        }
    };

    logger.log("Launching Ghost.exe from directory:", ghostPluginDir);
    const child = spawn(ghostExePath, [], options);

    child.on("error", error => {
        logger.error("Failed to start Ghost.exe:", error.message);
    });

    child.on("exit", code => {
        logger.log("Ghost.exe exited with code:", code);
    });
}

export function launchGhostSource(_event: IpcMainInvokeEvent, autoFillToken: boolean, autoInstallRequirements: boolean, pythonPath: string, token: string | null, nitroWebhookUrl: string, privnoteWebhookUrl: string, autoSetupWebhooks: boolean): void {
    const ghostSourcePath = getGhostSourcePath();

    if (!ghostSourcePath || !existsSync(ghostSourcePath)) {
        throw new Error("Ghost source code not found");
    }

    if (!checkPythonInstalled(_event, pythonPath)) {
        throw new Error(`Python not found at ${pythonPath}`);
    }

    if (autoInstallRequirements) {
        if (!installRequirements(_event, pythonPath)) {
            throw new Error("Failed to install Python requirements");
        }
    }

    if (autoFillToken && token) {
        updateGhostConfig(_event, token);
        logger.log("Token updated in Ghost config");
    }

    if (nitroWebhookUrl || privnoteWebhookUrl) {
        updateGhostWebhooks(_event, nitroWebhookUrl, privnoteWebhookUrl);
    }

    if (autoSetupWebhooks) {
        enableWebhookSetup(_event);
    }

    const ghostPy = join(ghostSourcePath, "ghost.py");

    if (!existsSync(ghostPy)) {
        throw new Error("ghost.py not found in source directory");
    }

    const child = spawn(pythonPath, [ghostPy], {
        cwd: ghostSourcePath,
        detached: true,
        stdio: "ignore"
    });

    child.unref();
}

export function checkGhostSetup(_event: IpcMainInvokeEvent, pythonPath: string): GhostStatus {
    const ghostExePath = getGhostExePath();
    const ghostSourcePath = getGhostSourcePath();
    const requirementsPath = getGhostRequirementsPath();

    return {
        ghostExeFound: !!(ghostExePath && existsSync(ghostExePath)),
        ghostSourceFound: !!(ghostSourcePath && existsSync(ghostSourcePath)),
        pythonFound: checkPythonInstalled(_event, pythonPath),
        requirementsFound: !!(requirementsPath && existsSync(requirementsPath))
    };
}

export function updateGhostWebhooks(_event: IpcMainInvokeEvent, nitroWebhookUrl: string, privnoteWebhookUrl: string): boolean {
    try {
        const ghostConfigPath = getGhostConfigPath();

        if (!existsSync(ghostConfigPath)) {
            logger.error("Ghost config not found. Please run Ghost.exe first to create config.");
            return false;
        }

        const config = JSON.parse(readFileSync(ghostConfigPath, "utf-8"));

        if (nitroWebhookUrl) {
            if (!config.snipers) config.snipers = {};
            if (!config.snipers.nitro) config.snipers.nitro = {};
            config.snipers.nitro.webhook = nitroWebhookUrl;
            logger.log("Nitro sniper webhook updated");
        }

        if (privnoteWebhookUrl) {
            if (!config.snipers) config.snipers = {};
            if (!config.snipers.privnote) config.snipers.privnote = {};
            config.snipers.privnote.webhook = privnoteWebhookUrl;
            logger.log("Privnote sniper webhook updated");
        }

        writeFileSync(ghostConfigPath, JSON.stringify(config, null, 4));
        return true;
    } catch (error) {
        logger.error("Failed to update Ghost webhooks:", error);
        return false;
    }
}

export function enableWebhookSetup(_event: IpcMainInvokeEvent): boolean {
    try {
        const cacheDir = join(process.env.APPDATA || "", "Ghost/data/cache");
        const webhookFlagPath = join(cacheDir, "CREATE_WEBHOOKS");

        if (!existsSync(cacheDir)) {
            require("fs").mkdirSync(cacheDir, { recursive: true });
        }

        writeFileSync(webhookFlagPath, "True");
        logger.log("Webhook auto-setup enabled");
        return true;
    } catch (error) {
        logger.error("Failed to enable webhook setup:", error);
        return false;
    }
}
