/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { VENCORD_USER_AGENT } from "@shared/vencordUserAgent";
import { spawn } from "child_process";
import { app, dialog } from "electron";
import { appendFileSync, constants, existsSync, mkdirSync } from "fs";
import { access, chmod, cp, mkdir, readdir, readFile, rm, stat, writeFile } from "fs/promises";
import { arch, homedir, platform as osPlatform, release } from "os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "path";
const APP_NAME = "StereoInstaller";
const DATA_DIR_NAME = "DiscordStereoHubSimple";
const MAX_DOWNLOAD_BYTES = 160 * 1024 * 1024;
const MAX_VISIBLE_LOG_LINES = 500;
const PATCHED_WINDOWS_GITHUB_CONTENTS_API = "https://api.github.com/repos/ProdHallow/Discord-Stereo-Windows-MacOS-Linux/contents/Updates%2FNodes%2FPatched%20Nodes%20%28for%20Installer%29%2FWindows";
const PATCHED_LINUX_GITHUB_CONTENTS_API = "https://api.github.com/repos/ProdHallow/Discord-Stereo-Windows-MacOS-Linux/contents/Updates%2FNodes%2FPatched%20Nodes%20%28for%20Installer%29%2FLinux";
const VOICE_PLAYGROUND_RAW_BASE = "https://codeberg.org/UnpackedX/Discord-Experimental-Subsystem/raw/branch/main/StereoMethods/Discord-Voice";
const PATCH_METHOD_LABELS = {
    discordAudioCollective: "Discord Audio Collective Method",
    voicePlayground: "Voice Playground Method"
};
const PATCH_METHODS = ["discordAudioCollective", "voicePlayground"];
const allowedDiscordRoots = new Set();
class ActionLog {
    lines = [];
    info(message) {
        this.write(message);
    }
    ok(message) {
        this.write(`OK: ${message}`);
    }
    warn(message) {
        this.write(`WARN: ${message}`);
    }
    fail(message) {
        this.write(`FAIL: ${message}`);
    }
    write(message) {
        const line = `[${new Date().toLocaleString()}] ${message}`;
        this.lines.push(line);
        appendLogLine(line);
    }
}
export async function autoDetect(_) {
    const log = new ActionLog();
    try {
        const target = await resolveTarget();
        if (!target)
            throw new Error("Could not find discord_voice.node. Open Discord once, join a voice channel once, then try again.");
        rememberAllowedRoot(target.discordRoot);
        log.ok(`Auto-detected voice module: ${target.voiceDir}`);
        return ok(await installInfoFromTarget(target), log.lines);
    }
    catch (error) {
        log.fail(errorMessage(error));
        return fail(errorMessage(error), log.lines);
    }
}
export async function chooseDiscordRoot(_) {
    const log = new ActionLog();
    try {
        const result = await dialog.showOpenDialog({
            title: "Select your Discord install folder",
            properties: ["openDirectory"]
        });
        if (result.canceled || !result.filePaths[0])
            return ok(null, log.lines);
        const selectedRoot = normalizeInputPath(result.filePaths[0]);
        rememberAllowedRoot(selectedRoot);
        log.info(`Selected Discord root: ${selectedRoot}`);
        const target = await resolveTarget(selectedRoot);
        if (!target)
            throw new Error("Could not find discord_voice.node in that Discord install folder.");
        rememberAllowedRoot(target.discordRoot);
        log.ok(`Found voice module: ${target.voiceDir}`);
        return ok(await installInfoFromTarget(target), log.lines);
    }
    catch (error) {
        log.fail(errorMessage(error));
        return fail(errorMessage(error), log.lines);
    }
}
export async function readLogs(_) {
    for (const pathValue of logPaths()) {
        if (!await isFile(pathValue))
            continue;
        try {
            return ok((await readFile(pathValue, "utf8")).split(/\r?\n/).filter(Boolean).slice(-MAX_VISIBLE_LOG_LINES), []);
        }
        catch { }
    }
    return ok([], []);
}
export async function clearLogs(_) {
    try {
        for (const pathValue of logPaths()) {
            await mkdir(dirname(pathValue), { recursive: true });
            await writeFile(pathValue, "", "utf8");
        }
        return ok(true, []);
    }
    catch (error) {
        return fail(`Could not clear StereoInstaller logs. ${errorMessage(error)}`, []);
    }
}
export async function patch(_, rootPath) {
    const log = new ActionLog();
    try {
        const target = await targetFromRendererRoot(rootPath);
        log.info("=== Patch ===");
        log.info(`Discord root: ${target.discordRoot}`);
        log.info(`Voice dir: ${target.voiceDir}`);
        await ensurePermanentUnpatchedBackup(target, log);
        const patchedVoiceDir = await downloadPatchedPayload(log);
        await scheduleWorker("Patch", patchedVoiceDir, target, "discordAudioCollective", log);
        log.ok("Patch scheduled. Discord will close, install Discord Audio Collective Method, then reopen.");
        return ok({ ...await installInfoFromTarget(target), logPath: logPath() }, log.lines);
    }
    catch (error) {
        log.fail(errorMessage(error));
        return fail(errorMessage(error), log.lines);
    }
}
export async function patchMethod2(_, rootPath, quality) {
    const log = new ActionLog();
    try {
        const target = await targetFromRendererRoot(rootPath);
        const methodTarget = await method2Target(target);
        assertVoicePlaygroundSupported();
        log.info("=== Patch Voice Playground Method ===");
        log.info(`Discord root: ${methodTarget.discordRoot}`);
        log.info(`Voice dir: ${methodTarget.voiceDir}`);
        log.info(`Stereo quality: ${quality}`);
        if (!await looksLikeDiscordVoiceDir(methodTarget.voiceDir)) {
            throw new Error(`Voice Playground Method target folder was not found or is incomplete: ${methodTarget.voiceDir}`);
        }
        await ensurePermanentUnpatchedBackup(methodTarget, log);
        const patchedVoiceDir = await prepareMethod2Payload(quality, log);
        await scheduleWorker("Patch", patchedVoiceDir, methodTarget, "voicePlayground", log, "singleFile");
        log.ok("Patch scheduled. Discord will close, install Voice Playground Method, then reopen.");
        return ok({ ...await installInfoFromTarget(methodTarget), logPath: logPath() }, log.lines);
    }
    catch (error) {
        log.fail(errorMessage(error));
        return fail(errorMessage(error), log.lines);
    }
}
export async function patchMethod2Index(_, rootPath) {
    const log = new ActionLog();
    try {
        const target = await targetFromRendererRoot(rootPath);
        const methodTarget = await method2Target(target);
        assertVoicePlaygroundSupported();
        log.info("=== Patch Voice Playground index.js ===");
        log.info(`Discord root: ${methodTarget.discordRoot}`);
        log.info(`Voice dir: ${methodTarget.voiceDir}`);
        if (!await looksLikeDiscordVoiceDir(methodTarget.voiceDir)) {
            throw new Error(`Voice Playground Method target folder was not found or is incomplete: ${methodTarget.voiceDir}`);
        }
        await ensurePermanentUnpatchedBackup(methodTarget, log);
        const patchedIndexDir = await prepareMethod2IndexPayload(log);
        await scheduleWorker("Patch", patchedIndexDir, methodTarget, undefined, log, "singleFile", "index.js");
        log.ok("Patch scheduled. Discord will close, install index.js, then reopen.");
        return ok({ ...await installInfoFromTarget(methodTarget), logPath: logPath() }, log.lines);
    }
    catch (error) {
        log.fail(errorMessage(error));
        return fail(errorMessage(error), log.lines);
    }
}
export async function revert(_, rootPath) {
    const log = new ActionLog();
    try {
        const target = await targetFromRendererRoot(rootPath);
        const backupDir = permanentBackupDir(target);
        log.info("=== Revert ===");
        log.info(`Discord root: ${target.discordRoot}`);
        log.info(`Voice dir: ${target.voiceDir}`);
        if (!await looksLikeDiscordVoiceDir(backupDir)) {
            throw new Error(`No permanent UNPATCHED backup found at: ${backupDir}. Run Patch once first to create the baseline.`);
        }
        await scheduleWorker("Revert", backupDir, target, undefined, log);
        log.ok("Revert scheduled. Discord will close, restore the backup, then reopen.");
        return ok({ ...await installInfoFromTarget(target), logPath: logPath() }, log.lines);
    }
    catch (error) {
        log.fail(errorMessage(error));
        return fail(errorMessage(error), log.lines);
    }
}
function ok(data, logs) {
    return { success: true, data, logs };
}
function fail(error, logs) {
    return { success: false, error, logs };
}
function errorMessage(error) {
    return error instanceof Error ? error.message : "Unknown error.";
}
function platformKey() {
    const key = process.platform;
    if (key === "win32")
        return "windows";
    if (key === "darwin")
        return "macos";
    if (key === "linux")
        return "linux";
    return key || "unknown";
}
function platformLabel(key) {
    if (key === "windows")
        return "Windows";
    if (key === "macos")
        return "macOS";
    if (key === "linux")
        return "Linux";
    return key ? key[0].toUpperCase() + key.slice(1) : "Unknown";
}
function assertVoicePlaygroundSupported() {
    if (platformKey() !== "windows") {
        throw new Error("Voice Playground Method is only available on Windows. Use Discord Audio Collective Method on Linux.");
    }
}
function readableOs() {
    return `${osPlatform()} ${release()} (${arch()})`;
}
function hubDataDir() {
    const key = platformKey();
    if (key === "windows") {
        return join(process.env.LOCALAPPDATA || process.env.APPDATA || homedir(), DATA_DIR_NAME);
    }
    if (key === "macos") {
        return join(homedir(), "Library", "Application Support", DATA_DIR_NAME);
    }
    const xdgDataHome = (process.env.XDG_DATA_HOME || "").trim();
    return join(xdgDataHome || join(homedir(), ".local", "share"), DATA_DIR_NAME);
}
function logPath() {
    return join(discordVoiceLoggingDir(), "StereoInstaller.log");
}
function fallbackLogPath() {
    return join(hubDataDir(), "discord_stereo_hub.log");
}
function logPaths() {
    return Array.from(new Set([logPath(), fallbackLogPath()].map((pathValue) => resolve(pathValue))));
}
function appendLogLine(line) {
    for (const pathValue of logPaths()) {
        try {
            mkdirSync(dirname(pathValue), { recursive: true });
            appendFileSync(pathValue, `${line}\n`, "utf8");
        }
        catch { }
    }
}
function discordVoiceLoggingDir() {
    return join(hubDataDir(), "StereoMethods", "Discord-Voice", "Logging");
}
function normalizeInputPath(pathValue) {
    if (typeof pathValue !== "string" || !pathValue.trim() || pathValue.length > 4096) {
        throw new Error("Discord install folder is invalid.");
    }
    return resolve(pathValue);
}
function canonicalPath(pathValue) {
    const resolved = resolve(pathValue);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}
function samePath(a, b) {
    return canonicalPath(a) === canonicalPath(b);
}
function isPathInside(parentPath, childPath) {
    const rel = relative(canonicalPath(parentPath), canonicalPath(childPath));
    return rel === "" || (!!rel && !rel.startsWith("..") && !isAbsolute(rel));
}
function assertPathInside(parentPath, childPath) {
    if (!isPathInside(parentPath, childPath)) {
        throw new Error("Resolved path is outside the allowed folder.");
    }
}
function rememberAllowedRoot(root) {
    allowedDiscordRoots.add(canonicalPath(root));
}
function defaultDiscordRoots() {
    const key = platformKey();
    const home = homedir();
    if (key === "windows") {
        const localAppData = process.env.LOCALAPPDATA || "";
        return [
            "Discord",
            "DiscordCanary",
            "DiscordPTB",
            "DiscordDevelopment",
            "Lightcord",
            "Vencord",
            "Equicord",
            "BetterVencord"
        ].map((name) => join(localAppData, name)).filter((pathValue) => !!pathValue);
    }
    if (key === "macos") {
        return [
            join(home, "Library", "Application Support", "discord"),
            join(home, "Library", "Application Support", "discordcanary"),
            join(home, "Library", "Application Support", "discordptb")
        ];
    }
    return [
        join(home, ".config", "discord"),
        join(home, ".config", "discordcanary"),
        join(home, ".config", "discordptb"),
        join(home, ".config", "discorddevelopment"),
        join(home, ".var", "app", "com.discordapp.Discord", "config", "discord"),
        join(home, "snap", "discord", "current", ".config", "discord")
    ];
}
function runningDiscordRoots() {
    const roots = [];
    const executableDirs = [app.getPath("exe"), process.execPath].map((pathValue) => dirname(pathValue));
    for (const executableDir of executableDirs) {
        if (isDiscordAppDirName(basename(executableDir)))
            roots.push(dirname(executableDir));
        let current = executableDir;
        for (let depth = 0; depth < 6; depth++) {
            if (basename(current).toLowerCase().endsWith(".app")) {
                roots.push(current);
                break;
            }
            const parent = dirname(current);
            if (parent === current)
                break;
            current = parent;
        }
    }
    roots.push(app.getPath("userData"));
    return roots;
}
async function discoveredDiscordRoots() {
    const key = platformKey();
    const parent = key === "windows"
        ? process.env.LOCALAPPDATA || ""
        : key === "macos"
            ? join(homedir(), "Library", "Application Support")
            : join(homedir(), ".config");
    if (!parent)
        return [];
    let entries;
    try {
        entries = await readdir(parent, { withFileTypes: true });
    }
    catch {
        return [];
    }
    return entries
        .filter((entry) => entry.isDirectory() && /(discord|cord|vencord|equicord)/i.test(entry.name))
        .map((entry) => join(parent, entry.name));
}
async function candidateDiscordRoots(preferredRoot) {
    const roots = preferredRoot ? [normalizeInputPath(preferredRoot)] : [];
    for (const root of [...runningDiscordRoots(), ...defaultDiscordRoots(), ...await discoveredDiscordRoots()]) {
        if (!roots.some((knownRoot) => samePath(knownRoot, root)))
            roots.push(root);
    }
    return roots;
}
function validateRendererDiscordRoot(rootPath) {
    const root = normalizeInputPath(rootPath);
    const canonical = canonicalPath(root);
    const defaultRoots = defaultDiscordRoots().map((pathValue) => canonicalPath(pathValue));
    if (allowedDiscordRoots.has(canonical) || defaultRoots.includes(canonical))
        return root;
    throw new Error("Use Auto-detect or Browse before running this action.");
}
async function targetFromRendererRoot(rootPath) {
    const root = validateRendererDiscordRoot(rootPath);
    const target = await resolveTarget(root);
    if (!target)
        throw new Error("Could not find discord_voice.node. Open Discord once, join a voice channel once, then try again.");
    rememberAllowedRoot(target.discordRoot);
    assertPathInside(target.discordRoot, target.voiceDir);
    return target;
}
async function pathExists(pathValue) {
    try {
        await access(pathValue, constants.F_OK);
        return true;
    }
    catch {
        return false;
    }
}
async function isDirectory(pathValue) {
    try {
        return (await stat(pathValue)).isDirectory();
    }
    catch {
        return false;
    }
}
async function isFile(pathValue) {
    try {
        return (await stat(pathValue)).isFile();
    }
    catch {
        return false;
    }
}
async function looksLikeDiscordVoiceDir(pathValue) {
    return await isDirectory(pathValue) && await isFile(join(pathValue, "discord_voice.node"));
}
function parseAppVersionFromDirName(name) {
    const match = /^(?:app-)?([\d.]+)$/i.exec(name);
    if (!match)
        return [0, 0, 0, 0];
    const parts = match[1].split(".").map((part) => Number.parseInt(part, 10));
    if (parts.some((part) => Number.isNaN(part)))
        return [0, 0, 0, 0];
    while (parts.length < 4)
        parts.push(0);
    return parts.slice(0, 4);
}
function isDiscordAppDirName(name) {
    return /^(?:app-)?\d+(?:\.\d+)*$/i.test(name);
}
function compareVersionsDescending(a, b) {
    const left = parseAppVersionFromDirName(a);
    const right = parseAppVersionFromDirName(b);
    for (let i = 0; i < 4; i++) {
        if (left[i] !== right[i])
            return right[i] - left[i];
    }
    return b.localeCompare(a);
}
async function findDiscordAppDir(discordRoot) {
    let entries;
    try {
        entries = await readdir(discordRoot, { withFileTypes: true });
    }
    catch {
        return undefined;
    }
    const apps = entries
        .filter((entry) => entry.isDirectory() && isDiscordAppDirName(entry.name))
        .map((entry) => join(discordRoot, entry.name));
    apps.sort((a, b) => compareVersionsDescending(basename(a), basename(b)));
    return apps[0];
}
async function findVoiceDirFromAppDir(appDir) {
    const modulesDir = join(appDir, "modules");
    if (!await isDirectory(modulesDir))
        return undefined;
    let entries;
    try {
        entries = await readdir(modulesDir, { withFileTypes: true });
    }
    catch {
        return undefined;
    }
    const candidates = entries
        .filter((entry) => entry.isDirectory() && entry.name.toLowerCase().startsWith("discord_voice"))
        .map((entry) => join(modulesDir, entry.name))
        .sort((a, b) => a.localeCompare(b));
    for (const candidate of candidates) {
        const nested = join(candidate, "discord_voice");
        if (await looksLikeDiscordVoiceDir(nested))
            return nested;
        if (await looksLikeDiscordVoiceDir(candidate))
            return candidate;
    }
    return undefined;
}
async function findDiscordVoiceDirUnder(root) {
    const appDir = await findDiscordAppDir(root);
    if (appDir) {
        const direct = await findVoiceDirFromAppDir(appDir);
        if (direct)
            return direct;
    }
    const stack = [root];
    let checked = 0;
    while (stack.length && checked < 5000) {
        const current = stack.pop();
        if (!current)
            break;
        checked++;
        let entries;
        try {
            entries = await readdir(current, { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const entry of entries) {
            const child = join(current, entry.name);
            if (entry.isFile() && entry.name === "discord_voice.node")
                return dirname(child);
            if (entry.isDirectory())
                stack.push(child);
        }
    }
    return undefined;
}
async function findVoiceDirWithDiagnostics(discordRoot) {
    if (!await isDirectory(discordRoot))
        return { diagnostics: "Discord root folder not found." };
    const appDir = await findDiscordAppDir(discordRoot);
    if (!appDir)
        return { diagnostics: "No app folders found. Discord may not be fully installed." };
    const modulesDir = join(appDir, "modules");
    if (!await isDirectory(modulesDir))
        return { appDir, diagnostics: `No modules folder found in ${basename(appDir)}.` };
    const voiceDir = await findVoiceDirFromAppDir(appDir);
    if (!voiceDir)
        return { appDir, diagnostics: "discord_voice module found, but discord_voice.node was not found inside it." };
    return { voiceDir, appDir, diagnostics: "" };
}
async function resolveTarget(preferredRoot) {
    for (const root of await candidateDiscordRoots(preferredRoot)) {
        const found = await findVoiceDirWithDiagnostics(root);
        if (found.voiceDir) {
            return {
                discordRoot: root,
                voiceDir: found.voiceDir,
                appDir: found.appDir,
                exeName: clientExeForRoot(root)
            };
        }
        const fallbackVoiceDir = await findDiscordVoiceDirUnder(root);
        if (fallbackVoiceDir) {
            return {
                discordRoot: root,
                voiceDir: fallbackVoiceDir,
                appDir: found.appDir || await findDiscordAppDir(root),
                exeName: clientExeForRoot(root)
            };
        }
    }
    return undefined;
}
function clientExeForRoot(root) {
    const key = platformKey();
    if (key === "windows")
        return windowsClientExeForRoot(root);
    if (key === "linux")
        return linuxClientExeForRoot(root);
    return undefined;
}
function windowsClientExeForRoot(root) {
    const leaf = basename(root).toLowerCase();
    if (leaf === "lightcord")
        return "Lightcord.exe";
    if (leaf.includes("discordcanary"))
        return "DiscordCanary.exe";
    if (leaf.includes("discordptb"))
        return "DiscordPTB.exe";
    if (leaf.includes("discorddevelopment"))
        return "DiscordDevelopment.exe";
    return "Discord.exe";
}
function linuxClientExeForRoot(root) {
    const normalized = root.toLowerCase();
    if (normalized.includes("discordcanary"))
        return "discord-canary";
    if (normalized.includes("discordptb"))
        return "discord-ptb";
    if (normalized.includes("discorddevelopment"))
        return "discord-development";
    return "discord";
}
function releaseChannelFromRoot(root) {
    const leaf = basename(root).toLowerCase();
    if (leaf === "discorddevelopment")
        return "Development";
    if (leaf === "discordcanary")
        return "Canary";
    if (leaf === "discordptb")
        return "PTB";
    if (leaf === "discord")
        return "Stable";
    return undefined;
}
function clientPrefixForRoot(root) {
    const leaf = basename(root).toLowerCase();
    if (["discord", "vencord", "equicord", "bettervencord"].includes(leaf))
        return "Stable";
    const channel = releaseChannelFromRoot(root);
    if (channel)
        return channel;
    if (leaf === "lightcord" || leaf === "lightchord")
        return "Lightcord";
    return basename(root).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function buildLabelFromAppDir(appDir) {
    if (!appDir)
        return "";
    const match = /^(?:app-)?([\d.]+)$/i.exec(basename(appDir));
    if (!match)
        return "";
    const parts = match[1].split(".").filter((part) => /^\d+$/.test(part));
    return parts.at(-1) || match[1];
}
function clientLabelForRoot(root, buildLabel) {
    const clientPrefix = clientPrefixForRoot(root);
    return clientPrefix && buildLabel ? `${clientPrefix} ${buildLabel}` : clientPrefix || buildLabel || "--";
}
async function installInfoFromTarget(target) {
    const buildLabel = buildLabelFromAppDir(target.appDir || await findDiscordAppDir(target.discordRoot));
    const clientLabel = clientLabelForRoot(target.discordRoot, buildLabel);
    const installation = await installationState(target, buildLabel);
    const lastPatchLabels = {
        discordAudioCollective: await lastPatchCaption(target.discordRoot, "discordAudioCollective"),
        voicePlayground: await lastPatchCaption(target.discordRoot, "voicePlayground")
    };
    return {
        platformKey: platformKey(),
        platformLabel: platformLabel(platformKey()),
        readableOs: readableOs(),
        discordRoot: target.discordRoot,
        voiceDir: target.voiceDir,
        appDir: target.appDir,
        clientLabel,
        buildLabel,
        lastPatchLabel: lastPatchLabels.discordAudioCollective,
        lastPatchLabels,
        installStatus: installation.status,
        installedMethod: installation.method,
        repatchWarning: repatchWarning(installation.status)
    };
}
function sanitizedRootKey(root) {
    return root.replace(/[\\/:]/g, "_");
}
function permanentBackupDir(target) {
    return join(hubDataDir(), "backups", sanitizedRootKey(target.discordRoot), "UNPATCHED");
}
function metaPathForRoot(discordRoot, method) {
    const fileName = method === "discordAudioCollective"
        ? "quick_hub_meta_discord_audio_collective.json"
        : "quick_hub_meta_voice_playground.json";
    return join(hubDataDir(), "backups", sanitizedRootKey(discordRoot), fileName);
}
function statePathForRoot(discordRoot) {
    return join(hubDataDir(), "backups", sanitizedRootKey(discordRoot), "installation_state.json");
}
async function readPatchMeta(discordRoot, method) {
    const metaPath = metaPathForRoot(discordRoot, method);
    if (!await isFile(metaPath))
        return undefined;
    try {
        const parsed = JSON.parse((await readFile(metaPath, "utf8")).trimStart());
        return isRecord(parsed) ? parsed : undefined;
    }
    catch {
        return undefined;
    }
}
function metaString(meta, key) {
    const value = meta[key];
    return typeof value === "string" ? value : "";
}
function isPatchMethod(value) {
    return value === "discordAudioCollective" || value === "voicePlayground";
}
async function latestPatchMeta(discordRoot) {
    let latest;
    for (const method of PATCH_METHODS) {
        const meta = await readPatchMeta(discordRoot, method);
        if (!meta || !metaString(meta, "last_patch_utc"))
            continue;
        const date = new Date(metaString(meta, "last_patch_utc"));
        const patchTime = Number.isNaN(date.getTime()) ? 0 : date.getTime();
        if (latest && patchTime < latest.time)
            continue;
        latest = { method, buildLabel: metaString(meta, "build_label"), time: patchTime };
    }
    return latest;
}
async function filesEqual(left, right) {
    if (!await isFile(left) || !await isFile(right))
        return false;
    if ((await stat(left)).size !== (await stat(right)).size)
        return false;
    return (await readFile(left)).equals(await readFile(right));
}
async function installationState(target, currentBuildLabel) {
    const backupNode = join(permanentBackupDir(target), "discord_voice.node");
    const installedNode = join(target.voiceDir, "discord_voice.node");
    if (!await isFile(backupNode) || await filesEqual(backupNode, installedNode)) {
        return { status: "notInstalled", method: null };
    }
    const statePath = statePathForRoot(target.discordRoot);
    if (await isFile(statePath)) {
        try {
            const state = JSON.parse((await readFile(statePath, "utf8")).trimStart());
            if (isRecord(state) && state.status === "notInstalled")
                return { status: "notInstalled", method: null };
            if (isRecord(state) && state.status === "installed" && isPatchMethod(state.active_method)) {
                const method = state.active_method;
                const buildLabel = metaString(state, "build_label");
                return !currentBuildLabel || !buildLabel || buildLabel !== currentBuildLabel
                    ? { status: "needsReinstall", method }
                    : { status: "installed", method };
            }
        }
        catch {
            return { status: "notInstalled", method: null };
        }
    }
    const latestPatch = await latestPatchMeta(target.discordRoot);
    if (!latestPatch)
        return { status: "notInstalled", method: null };
    if (!currentBuildLabel || !latestPatch.buildLabel || latestPatch.buildLabel !== currentBuildLabel) {
        return { status: "needsReinstall", method: latestPatch.method };
    }
    return { status: "installed", method: latestPatch.method };
}
function repatchWarning(status) {
    if (status === "needsReinstall")
        return "Discord updated since StereoInstaller last patched audio. Patch Discord voice again with StereoInstaller.";
    return "";
}
async function lastPatchCaption(discordRoot, method) {
    const metaPath = metaPathForRoot(discordRoot, method);
    if (!await isFile(metaPath))
        return "Never";
    try {
        const parsed = JSON.parse((await readFile(metaPath, "utf8")).trimStart());
        if (!isRecord(parsed))
            return `${PATCH_METHOD_LABELS[method]} saved data could not be read.`;
        const iso = typeof parsed.last_patch_utc === "string" ? parsed.last_patch_utc : "";
        if (!iso)
            return "Never";
        const date = new Date(iso);
        if (Number.isNaN(date.getTime()))
            return iso;
        return date.toLocaleString();
    }
    catch {
        return `${PATCH_METHOD_LABELS[method]} saved data could not be read.`;
    }
}
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
async function ensurePermanentUnpatchedBackup(target, log) {
    const backupDir = permanentBackupDir(target);
    if (await looksLikeDiscordVoiceDir(backupDir)) {
        log.info(`Permanent UNPATCHED backup already exists: ${backupDir}`);
        return backupDir;
    }
    assertPathInside(target.discordRoot, target.voiceDir);
    assertPathInside(hubDataDir(), backupDir);
    log.info("Creating permanent UNPATCHED backup for the first time.");
    await mkdir(dirname(backupDir), { recursive: true });
    await rm(backupDir, { recursive: true, force: true });
    await cp(target.voiceDir, backupDir, { recursive: true });
    log.ok(`Saved permanent UNPATCHED backup: ${backupDir}`);
    return backupDir;
}
async function clearDirContents(pathValue, allowedParent) {
    assertPathInside(allowedParent, pathValue);
    if (!await pathExists(pathValue)) {
        await mkdir(pathValue, { recursive: true });
        return;
    }
    if (!await isDirectory(pathValue))
        throw new Error(`Expected a folder, got: ${pathValue}`);
    const entries = await readdir(pathValue, { withFileTypes: true });
    for (const entry of entries) {
        const child = join(pathValue, entry.name);
        assertPathInside(pathValue, child);
        await rm(child, { recursive: true, force: true });
    }
}
async function downloadBytes(url, timeoutMs, accept) {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "https:")
        throw new Error("Download URL must use HTTPS.");
    if (!["api.github.com", "raw.githubusercontent.com", "codeberg.org"].includes(parsedUrl.hostname)) {
        throw new Error(`Download host is not allowed: ${parsedUrl.hostname}`);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const headers = {
        "User-Agent": VENCORD_USER_AGENT || APP_NAME,
        "Cache-Control": "no-cache",
        "Pragma": "no-cache"
    };
    if (accept)
        headers.Accept = accept;
    const token = (process.env.DISCORD_STEREO_GITHUB_TOKEN || process.env.GITHUB_TOKEN || "").trim();
    if (token)
        headers.Authorization = token.startsWith("github_pat_") ? `Bearer ${token}` : `token ${token}`;
    try {
        const response = await fetch(parsedUrl, {
            headers,
            signal: controller.signal
        });
        if (!response.ok)
            throw new Error(`Download failed: ${response.status} ${response.statusText}`);
        const contentLength = Number(response.headers.get("content-length"));
        if (Number.isFinite(contentLength) && contentLength > MAX_DOWNLOAD_BYTES) {
            throw new Error("Download is too large.");
        }
        const data = Buffer.from(await response.arrayBuffer());
        if (data.byteLength > MAX_DOWNLOAD_BYTES)
            throw new Error("Download is too large.");
        return data;
    }
    finally {
        clearTimeout(timeout);
    }
}
function validateDownloadPayload(name, data) {
    if (!data.byteLength)
        throw new Error(`${name}: empty download.`);
    const head = data.subarray(0, 256).toString("utf8").trimStart().toLowerCase();
    if (head.startsWith("<!doctype html") || head.startsWith("<html") || head.includes("<title>")) {
        throw new Error(`${name}: download looks like an HTML error page.`);
    }
    const low = name.toLowerCase();
    if ([".node", ".dll", ".exe", ".tflite", ".so", ".dylib"].some((ext) => low.endsWith(ext)) && data.byteLength < 1024) {
        throw new Error(`${name}: binary download is too small.`);
    }
}
function patchedGithubApiForPlatform() {
    const key = platformKey();
    if (key === "windows")
        return PATCHED_WINDOWS_GITHUB_CONTENTS_API;
    if (key === "linux")
        return PATCHED_LINUX_GITHUB_CONTENTS_API;
    throw new Error("Discord Audio Collective Method supports Windows and Linux patched payloads.");
}
async function method2Target(target) {
    const appDir = target.appDir || await findDiscordAppDir(target.discordRoot);
    if (!appDir)
        throw new Error("Could not find the Discord app folder for Voice Playground Method.");
    const voiceDir = join(appDir, "modules", "discord_voice-1", "discord_voice");
    assertPathInside(target.discordRoot, voiceDir);
    return {
        ...target,
        appDir,
        voiceDir
    };
}
async function method2Payload(quality, log) {
    const fileName = `(${quality}) discord_voice.node`;
    const url = `${VOICE_PLAYGROUND_RAW_BASE}/${encodeURIComponent(fileName)}`;
    log.info(`Downloading Voice Playground Method payload: ${quality}`);
    const data = await downloadBytes(url, 120_000);
    validateDownloadPayload(fileName, data);
    return data;
}
async function prepareMethod2Payload(quality, log) {
    const staging = join(hubDataDir(), "staging", "method2_payload");
    const targetFile = join(staging, "discord_voice.node");
    assertPathInside(hubDataDir(), staging);
    assertPathInside(staging, targetFile);
    await mkdir(staging, { recursive: true });
    await clearDirContents(staging, hubDataDir());
    await writeFile(targetFile, await method2Payload(quality, log));
    validateDownloadPayload("discord_voice.node", await readFile(targetFile));
    log.ok(`Prepared Voice Playground Method payload: ${quality}.`);
    return staging;
}
async function prepareMethod2IndexPayload(log) {
    const staging = join(hubDataDir(), "staging", "method2_index_payload");
    const targetFile = join(staging, "index.js");
    assertPathInside(hubDataDir(), staging);
    assertPathInside(staging, targetFile);
    await mkdir(staging, { recursive: true });
    await clearDirContents(staging, hubDataDir());
    log.info("Downloading Voice Playground Method index.js");
    const data = await downloadBytes(`${VOICE_PLAYGROUND_RAW_BASE}/index.js`, 120_000);
    validateDownloadPayload("index.js", data);
    await writeFile(targetFile, data);
    log.ok("Prepared Voice Playground Method index.js payload.");
    return staging;
}
function isGithubContentFile(value) {
    return isRecord(value)
        && value.type === "file"
        && typeof value.name === "string"
        && typeof value.download_url === "string"
        && value.download_url.length > 0;
}
function assertSafeRemoteFileName(name) {
    if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) {
        throw new Error(`Unsafe remote file name: ${name || "unknown"}`);
    }
}
async function downloadGithubFolderToDir(apiUrl, dest, log) {
    const raw = await downloadBytes(apiUrl, 60_000, "application/vnd.github.v3+json");
    const parsed = JSON.parse(raw.toString("utf8"));
    if (!Array.isArray(parsed))
        throw new Error("GitHub contents API returned unexpected JSON.");
    await mkdir(dest, { recursive: true });
    await clearDirContents(dest, hubDataDir());
    let downloaded = 0;
    let failed = 0;
    for (const entry of parsed) {
        if (!isGithubContentFile(entry))
            continue;
        try {
            assertSafeRemoteFileName(entry.name);
            const targetPath = join(dest, entry.name);
            assertPathInside(dest, targetPath);
            log.info(`Downloading: ${entry.name}`);
            const data = await downloadBytes(entry.download_url, 120_000);
            validateDownloadPayload(entry.name, data);
            await writeFile(targetPath, data);
            if (platformKey() === "linux" && ["discord_voice.node", "gpu_encoder_helper", "libmediapipe.so"].includes(entry.name)) {
                await chmod(targetPath, 0o755);
            }
            downloaded++;
        }
        catch (error) {
            failed++;
            log.warn(`Failed: ${isRecord(entry) && typeof entry.name === "string" ? entry.name : "unknown"} (${errorMessage(error)})`);
        }
    }
    if (!downloaded)
        throw new Error("No files were downloaded from the GitHub folder.");
    if (failed)
        log.warn(`Downloaded ${downloaded} file(s), ${failed} failed.`);
    else
        log.ok(`Downloaded ${downloaded} file(s).`);
}
async function findVoiceDirInPayloadDir(payloadRoot) {
    if (await looksLikeDiscordVoiceDir(payloadRoot))
        return payloadRoot;
    const nested = join(payloadRoot, "discord_voice");
    if (await looksLikeDiscordVoiceDir(nested))
        return nested;
    const found = await findDiscordVoiceDirUnder(payloadRoot);
    return found && isPathInside(payloadRoot, found) ? found : undefined;
}
async function downloadPatchedPayload(log) {
    const staging = join(hubDataDir(), "staging", "patched_payload");
    assertPathInside(hubDataDir(), staging);
    const label = platformLabel(platformKey());
    log.info(`Fetching the latest Discord Audio Collective Method module for ${label} from GitHub.`);
    await downloadGithubFolderToDir(patchedGithubApiForPlatform(), staging, log);
    const payloadVoice = await findVoiceDirInPayloadDir(staging);
    if (!payloadVoice || !await looksLikeDiscordVoiceDir(payloadVoice)) {
        throw new Error("Downloaded payload does not contain a valid discord_voice module.");
    }
    return payloadVoice;
}
async function scheduleWorker(actionName, sourceDir, target, metaMethod, log, copyMode = "directory", fileName = "discord_voice.node") {
    assertPathInside(hubDataDir(), sourceDir);
    assertPathInside(target.discordRoot, target.voiceDir);
    const patchBuildLabel = buildLabelFromAppDir(target.appDir || await findDiscordAppDir(target.discordRoot));
    const workerDir = join(hubDataDir(), "worker");
    const usePowershellWorker = platformKey() === "windows";
    const workerExecutable = usePowershellWorker ? powershellPath() : process.execPath;
    const workerScript = join(workerDir, usePowershellWorker ? "stereo-installer-worker.ps1" : "stereo-installer-worker.cjs");
    const launcherScript = join(workerDir, "stereo-installer-launcher.cmd");
    const configPath = join(workerDir, `stereo-installer-${Date.now()}.json`);
    const taskName = usePowershellWorker ? `StereoInstaller-${process.pid}-${Date.now()}` : undefined;
    const config = {
        actionName,
        parentPid: process.pid,
        sourceDir,
        targetDir: target.voiceDir,
        copyMode,
        fileName: copyMode === "singleFile" ? fileName : undefined,
        metaPath: metaMethod ? metaPathForRoot(target.discordRoot, metaMethod) : undefined,
        statePath: statePathForRoot(target.discordRoot),
        activeMethod: metaMethod,
        patchClientLabel: clientLabelForRoot(target.discordRoot, patchBuildLabel),
        patchBuildLabel,
        logPath: logPath(),
        logPaths: logPaths(),
        taskName,
        relaunch: {
            platformKey: platformKey(),
            discordRoot: target.discordRoot,
            appDir: target.appDir,
            exeName: target.exeName
        }
    };
    await mkdir(workerDir, { recursive: true });
    await writeFile(workerScript, usePowershellWorker ? POWERSHELL_WORKER_SOURCE : WORKER_SOURCE, "utf8");
    await writeFile(configPath, JSON.stringify(config), "utf8");
    if (usePowershellWorker) {
        await writeFile(launcherScript, windowsLauncherSource(workerExecutable, workerScript, configPath, logPath()), "utf8");
    }
    log.info(`Logging actions to: ${logPath()}`);
    log.info(`Worker executable: ${workerExecutable}`);
    log.info(`Worker config: ${configPath}`);
    if (usePowershellWorker) {
        await startWindowsWorker(launcherScript, taskName || "StereoInstaller", log);
    }
    else {
        const child = spawn(workerExecutable, [workerScript, configPath], {
            detached: true,
            stdio: "ignore",
            windowsHide: true,
            env: {
                ...process.env,
                ELECTRON_RUN_AS_NODE: "1"
            }
        });
        child.once("error", (error) => log.fail(`Worker failed to start: ${errorMessage(error)}`));
        child.unref();
    }
    log.info(`Worker started from ${workerScript}.`);
    log.info(`Worker log: ${logPath()}`);
    log.info("Discord exit scheduled so the worker can replace the voice files.");
    setTimeout(() => app.exit(0), 700).unref();
}
async function startWindowsWorker(launcherScript, taskName, log) {
    const scheduledTime = windowsTaskTime();
    const taskCommand = `${commandProcessorPath()} /d /s /c ""${launcherScript}""`;
    const createTask = await runProcess(schtasksPath(), ["/Create", "/TN", taskName, "/SC", "ONCE", "/ST", scheduledTime, "/TR", taskCommand, "/F", "/RL", "LIMITED"]);
    if (createTask.code === 0) {
        const runTask = await runProcess(schtasksPath(), ["/Run", "/TN", taskName]);
        if (runTask.code === 0) {
            log.info(`Windows Task Scheduler started worker task: ${taskName}`);
            return;
        }
        log.warn(`Task Scheduler run failed: ${runTask.output || `exit ${runTask.code}`}`);
    }
    else {
        log.warn(`Task Scheduler create failed: ${createTask.output || `exit ${createTask.code}`}`);
    }
    const child = spawn(commandProcessorPath(), ["/d", "/s", "/c", "start", "\"\"", "/min", launcherScript], {
        detached: true,
        stdio: "ignore",
        windowsHide: true
    });
    child.once("error", (error) => log.fail(`Windows launcher failed to start: ${errorMessage(error)}`));
    child.unref();
    log.warn("Falling back to cmd start for the worker launcher.");
}
function runProcess(file, args) {
    return new Promise(resolveProcess => {
        let output = "";
        let settled = false;
        const child = spawn(file, args, { windowsHide: true });
        function finish(code, text) {
            if (settled)
                return;
            settled = true;
            resolveProcess({ code, output: (text || output).trim() });
        }
        child.stdout?.on("data", (chunk) => {
            output += chunk.toString("utf8");
        });
        child.stderr?.on("data", (chunk) => {
            output += chunk.toString("utf8");
        });
        child.once("error", (error) => finish(-1, errorMessage(error)));
        child.once("close", (code) => finish(code ?? -1));
    });
}
function windowsTaskTime() {
    const date = new Date(Date.now() + 60_000);
    const hours = date.getHours().toString().padStart(2, "0");
    const minutes = date.getMinutes().toString().padStart(2, "0");
    return `${hours}:${minutes}`;
}
function commandProcessorPath() {
    const candidate = join(process.env.SystemRoot || "C:\\Windows", "System32", "cmd.exe");
    return existsSync(candidate) ? candidate : "cmd.exe";
}
function schtasksPath() {
    const candidate = join(process.env.SystemRoot || "C:\\Windows", "System32", "schtasks.exe");
    return existsSync(candidate) ? candidate : "schtasks.exe";
}
function powershellPath() {
    const candidate = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    return existsSync(candidate) ? candidate : "powershell.exe";
}
function windowsLauncherSource(powershellExecutable, workerScript, configPath, logPathValue) {
    return `@echo off
setlocal
set "POWERSHELL=${powershellExecutable}"
set "SCRIPT=${workerScript}"
set "CONFIG=${configPath}"
set "LOG=${logPathValue}"
set "BOOTLOG=${logPathValue}.launcher.log"
for %%I in ("%LOG%") do if not exist "%%~dpI" mkdir "%%~dpI" >nul 2>nul
echo [%date% %time%] Launcher started.>> "%LOG%"
"%POWERSHELL%" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%SCRIPT%" "%CONFIG%" >> "%BOOTLOG%" 2>>&1
set "EXIT_CODE=%ERRORLEVEL%"
echo [%date% %time%] PowerShell exited with %EXIT_CODE%.>> "%LOG%"
exit /b %EXIT_CODE%
`;
}
const POWERSHELL_WORKER_SOURCE = `
$ErrorActionPreference = "Stop"

function Write-InstallerLog {
    param([string] $Line)

    $paths = @()
    if ($config.logPaths) {
        foreach ($path in $config.logPaths) {
            if ($path) { $paths += [string] $path }
        }
    }
    if ($paths.Count -eq 0 -and $config.logPath) {
        $paths += [string] $config.logPath
    }

    $fullLine = "[{0}] {1}" -f (Get-Date), $Line
    foreach ($path in $paths) {
        try {
            $parent = [System.IO.Path]::GetDirectoryName($path)
            if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
            Add-Content -LiteralPath $path -Value $fullLine -Encoding UTF8
        } catch {}
    }
}

function Wait-ParentProcess {
    for ($i = 0; $i -lt 80; $i++) {
        try {
            $parent = Get-Process -Id ([int] $config.parentPid) -ErrorAction Stop
            if ($null -eq $parent) { return }
            Start-Sleep -Milliseconds 250
        } catch {
            return
        }
    }

    try {
        Stop-Process -Id ([int] $config.parentPid) -Force -ErrorAction SilentlyContinue
    } catch {}
    Start-Sleep -Milliseconds 1200
}

function Stop-DiscordUnderRoot {
    $root = [System.IO.Path]::GetFullPath([string] $config.relaunch.discordRoot).TrimEnd([char[]] @([char] 92, [char] 47))
    $rootPrefix = $root + [System.IO.Path]::DirectorySeparatorChar
    $names = @("Discord.exe", "DiscordCanary.exe", "DiscordPTB.exe", "DiscordDevelopment.exe", "Lightcord.exe", "Vencord.exe", "Equicord.exe", "BetterVencord.exe", "Update.exe")

    try {
        $processes = Get-CimInstance Win32_Process | Where-Object {
            $exePath = $_.ExecutablePath
            if (-not $exePath) { return $false }
            if ($names -notcontains $_.Name) { return $false }

            try {
                $fullExe = [System.IO.Path]::GetFullPath($exePath)
                return $fullExe.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)
            } catch {
                return $false
            }
        }

        foreach ($process in $processes) {
            try {
                Write-InstallerLog ("Stopping process " + $process.Name + " pid=" + $process.ProcessId)
                Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
            } catch {}
        }
    } catch {
        Write-InstallerLog ("WARN: Could not enumerate Discord processes: " + $_.Exception.Message)
    }

    Start-Sleep -Milliseconds 900
}

function Clear-DirContents {
    param([string] $PathValue)

    if (-not $PathValue) { throw "Missing target directory." }
    New-Item -ItemType Directory -Force -Path $PathValue | Out-Null
    Get-ChildItem -LiteralPath $PathValue -Force | ForEach-Object {
        Remove-Item -LiteralPath $_.FullName -Recurse -Force
    }
}

function Copy-DirContents {
    param([string] $SourceDir, [string] $TargetDir)

    if (-not $SourceDir -or -not $TargetDir) { throw "Missing source or target directory." }
    New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
    Get-ChildItem -LiteralPath $SourceDir -Force | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $TargetDir -Recurse -Force
    }
}

function Copy-SingleFile {
    param([string] $SourceDir, [string] $TargetDir, [string] $FileName)

    if (-not $SourceDir -or -not $TargetDir) { throw "Missing source or target directory." }
    if (-not $FileName) { $FileName = "discord_voice.node" }
    if ($FileName -ne "discord_voice.node" -and $FileName -ne "index.js") {
        throw ("Unsupported file name: " + $FileName)
    }

    New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null

    $src = Join-Path $SourceDir $FileName
    $dst = Join-Path $TargetDir $FileName
    if (-not (Test-Path -LiteralPath $src -PathType Leaf)) {
        throw ("Source " + $FileName + " was not found: " + $src)
    }

    $beforeSize = 0
    if (Test-Path -LiteralPath $dst -PathType Leaf) {
        $beforeSize = (Get-Item -LiteralPath $dst).Length
    }

    Copy-Item -LiteralPath $src -Destination $dst -Force
    $afterSize = (Get-Item -LiteralPath $dst).Length
    Write-InstallerLog ("Copied " + $src + " -> " + $dst + " (before " + $beforeSize + " bytes, after " + $afterSize + " bytes).")
}

function Start-DiscordAgain {
    $root = [string] $config.relaunch.discordRoot
    $exe = [string] $config.relaunch.exeName
    if (-not $exe) { $exe = "Discord.exe" }

    $updateExe = Join-Path $root "Update.exe"
    if (Test-Path -LiteralPath $updateExe -PathType Leaf) {
        Start-Process -FilePath $updateExe -ArgumentList @("--processStart", $exe) -WorkingDirectory $root -WindowStyle Hidden
        Write-InstallerLog ("Relaunched Discord via Update.exe (" + $exe + ").")
        return
    }

    $appDir = [string] $config.relaunch.appDir
    if ($appDir) {
        $exePath = Join-Path $appDir $exe
        if (Test-Path -LiteralPath $exePath -PathType Leaf) {
            Start-Process -FilePath $exePath -WorkingDirectory $appDir -WindowStyle Hidden
            Write-InstallerLog ("Relaunched Discord directly (" + $exe + ").")
            return
        }
    }

    Write-InstallerLog "WARN: Could not relaunch Discord automatically. Please start it manually."
}

$configPath = $args[0]
try {
    $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    Write-InstallerLog ("PowerShell worker started. pid=" + $PID)
    Write-InstallerLog ("Config path: " + $configPath)
    Write-InstallerLog ("Source dir: " + $config.sourceDir)
    Write-InstallerLog ("Target dir: " + $config.targetDir)
    Write-InstallerLog ("Copy mode: " + $config.copyMode)
    if ($config.fileName) { Write-InstallerLog ("File name: " + $config.fileName) }
    Write-InstallerLog ($config.actionName + ": waiting for Discord to close.")
    Wait-ParentProcess
    Write-InstallerLog ($config.actionName + ": wait finished.")
    Stop-DiscordUnderRoot
    Write-InstallerLog ($config.actionName + ": installing files.")

    if ($config.copyMode -eq "singleFile") {
        Copy-SingleFile -SourceDir ([string] $config.sourceDir) -TargetDir ([string] $config.targetDir) -FileName ([string] $config.fileName)
    } else {
        Clear-DirContents -PathValue ([string] $config.targetDir)
        Write-InstallerLog "Cleared target directory."
        Copy-DirContents -SourceDir ([string] $config.sourceDir) -TargetDir ([string] $config.targetDir)
        Write-InstallerLog "Copied directory contents."
    }

    if ($config.metaPath) {
        $metaParent = [System.IO.Path]::GetDirectoryName([string] $config.metaPath)
        if ($metaParent) { New-Item -ItemType Directory -Force -Path $metaParent | Out-Null }
        $meta = [ordered]@{ last_patch_utc = (Get-Date).ToUniversalTime().ToString("o") }
        if ($config.patchClientLabel) { $meta.client_label = [string] $config.patchClientLabel }
        if ($config.patchBuildLabel) { $meta.build_label = [string] $config.patchBuildLabel }
        $meta | ConvertTo-Json | Set-Content -LiteralPath ([string] $config.metaPath) -Encoding UTF8
        Write-InstallerLog ("Wrote metadata: " + $config.metaPath)
    }

    if ($config.statePath -and ($config.actionName -eq "Revert" -or $config.activeMethod)) {
        $stateParent = [System.IO.Path]::GetDirectoryName([string] $config.statePath)
        if ($stateParent) { New-Item -ItemType Directory -Force -Path $stateParent | Out-Null }
        $stateStatus = if ($config.actionName -eq "Revert") { "notInstalled" } else { "installed" }
        $state = [ordered]@{ status = $stateStatus; build_label = [string] $config.patchBuildLabel; updated_utc = (Get-Date).ToUniversalTime().ToString("o") }
        if ($config.activeMethod) { $state["active_method"] = [string] $config.activeMethod }
        $state | ConvertTo-Json | Set-Content -LiteralPath ([string] $config.statePath) -Encoding UTF8
        Write-InstallerLog ("Wrote installation state: " + $config.statePath)
    }

    Write-InstallerLog ("OK: " + $config.actionName + " complete.")
    Start-DiscordAgain
} catch {
    Write-InstallerLog ("FAIL: " + $_.Exception.Message)
    Write-InstallerLog ([string] $_.ScriptStackTrace)
} finally {
    if ($config.taskName) {
        try {
            schtasks.exe /Delete /TN ([string] $config.taskName) /F | Out-Null
            Write-InstallerLog ("Deleted scheduled task: " + $config.taskName)
        } catch {
            Write-InstallerLog ("WARN: Could not delete scheduled task: " + $_.Exception.Message)
        }
    }

    try {
        Remove-Item -LiteralPath $configPath -Force -ErrorAction SilentlyContinue
    } catch {}
}
`;
const WORKER_SOURCE = `
"use strict";
const fs = require("fs/promises");
const { existsSync } = require("fs");
const { spawn } = require("child_process");
const { dirname, join } = require("path");
const { setTimeout: sleep } = require("timers/promises");

async function appendLog(config, line) {
    const paths = Array.isArray(config.logPaths) && config.logPaths.length ? config.logPaths : [config.logPath];
    const fullLine = "[" + new Date().toLocaleString() + "] " + line + "\\n";
    for (const pathValue of paths) {
        try {
            await fs.mkdir(dirname(pathValue), { recursive: true });
            await fs.appendFile(pathValue, fullLine, "utf8");
        } catch {}
    }
}

async function waitForParent(config) {
    for (let i = 0; i < 80; i++) {
        try {
            process.kill(config.parentPid, 0);
            await sleep(250);
        } catch {
            return;
        }
    }

    try {
        process.kill(config.parentPid);
    } catch {}

    await sleep(1200);
}

async function clearDirContents(pathValue) {
    if (!pathValue) throw new Error("Missing target directory.");
    await fs.mkdir(pathValue, { recursive: true });
    const entries = await fs.readdir(pathValue, { withFileTypes: true });
    for (const entry of entries) {
        await fs.rm(join(pathValue, entry.name), { recursive: true, force: true });
    }
}

async function copyDirContents(srcDir, dstDir) {
    if (!srcDir || !dstDir) throw new Error("Missing source or target directory.");
    await fs.mkdir(dstDir, { recursive: true });
    const entries = await fs.readdir(srcDir, { withFileTypes: true });
    for (const entry of entries) {
        const src = join(srcDir, entry.name);
        const dst = join(dstDir, entry.name);
        if (entry.isDirectory()) await fs.cp(src, dst, { recursive: true });
        else await fs.copyFile(src, dst);
    }
}

function singleFileName(config) {
    const fileName = config.fileName || "discord_voice.node";
    if (fileName !== "discord_voice.node" && fileName !== "index.js") throw new Error("Unsupported file name: " + fileName);

    return fileName;
}

async function copySingleFile(srcDir, dstDir, fileName) {
    if (!srcDir || !dstDir) throw new Error("Missing source or target directory.");
    await fs.mkdir(dstDir, { recursive: true });
    const src = join(srcDir, fileName);
    const dst = join(dstDir, fileName);
    const before = existsSync(dst) ? await fs.stat(dst) : null;
    await fs.copyFile(src, dst);
    const after = await fs.stat(dst);
    return {
        src,
        dst,
        beforeSize: before ? before.size : 0,
        afterSize: after.size
    };
}

function spawnDetached(file, args, cwd) {
    const child = spawn(file, args, {
        cwd,
        detached: true,
        stdio: "ignore",
        windowsHide: true
    });
    child.once("error", error => {
        void error;
    });
    child.unref();
}

function linuxRelaunchCommands(relaunchConfig) {
    const root = String(relaunchConfig.discordRoot || "").toLowerCase();
    const commands = [];

    if (root.includes(".var/app/com.discordapp.discord")) commands.push(["flatpak", "run", "com.discordapp.Discord"]);
    if (root.includes("/snap/discord/")) commands.push(["snap", "run", "discord"]);
    if (relaunchConfig.exeName) commands.push([relaunchConfig.exeName]);
    if (root.includes("discordcanary")) commands.push(["discord-canary"], ["DiscordCanary"]);
    if (root.includes("discordptb")) commands.push(["discord-ptb"], ["DiscordPTB"]);
    if (root.includes("discorddevelopment")) commands.push(["discord-development"], ["DiscordDevelopment"]);

    commands.push(["discord"], ["Discord"], ["flatpak", "run", "com.discordapp.Discord"], ["snap", "run", "discord"]);
    return commands;
}

function relaunch(config) {
    const relaunchConfig = config.relaunch;
    if (relaunchConfig.platformKey === "windows") {
        const exe = relaunchConfig.exeName || "Discord.exe";
        const updater = join(relaunchConfig.discordRoot, "Update.exe");
        if (existsSync(updater)) {
            spawnDetached(updater, ["--processStart", exe], relaunchConfig.discordRoot);
            return "Relaunched Discord via Update.exe.";
        }

        if (relaunchConfig.appDir) {
            const exePath = join(relaunchConfig.appDir, exe);
            if (existsSync(exePath)) {
                spawnDetached(exePath, [], relaunchConfig.appDir);
                return "Relaunched Discord directly.";
            }
        }

        return "Could not relaunch Discord automatically. Please start it manually.";
    }

    if (relaunchConfig.platformKey === "macos") {
        spawnDetached("open", ["-a", "Discord"]);
        return "Relaunched Discord with open.";
    }

    if (relaunchConfig.platformKey === "linux") {
        for (const cmd of linuxRelaunchCommands(relaunchConfig)) {
            try {
                spawnDetached(cmd[0], cmd.slice(1));
                return "Relaunched Discord.";
            } catch {}
        }
    }

    return "Could not relaunch Discord automatically. Please start it manually.";
}

async function main() {
    const configPath = process.argv[2];
    const config = JSON.parse(await fs.readFile(configPath, "utf8"));

    try {
        await appendLog(config, "Worker started. pid=" + process.pid + " execPath=" + process.execPath);
        await appendLog(config, "Config path: " + configPath);
        await appendLog(config, "Source dir: " + config.sourceDir);
        await appendLog(config, "Target dir: " + config.targetDir);
        await appendLog(config, "Copy mode: " + config.copyMode);
        if (config.fileName) await appendLog(config, "File name: " + config.fileName);
        await appendLog(config, config.actionName + ": waiting for Discord to close.");
        await waitForParent(config);
        await appendLog(config, config.actionName + ": wait finished.");
        await appendLog(config, config.actionName + ": installing files.");
        if (config.copyMode === "singleFile") {
            const result = await copySingleFile(config.sourceDir, config.targetDir, singleFileName(config));
            await appendLog(config, "Copied " + result.src + " -> " + result.dst + " (before " + result.beforeSize + " bytes, after " + result.afterSize + " bytes).");
        } else {
            await clearDirContents(config.targetDir);
            await appendLog(config, "Cleared target directory.");
            await copyDirContents(config.sourceDir, config.targetDir);
            await appendLog(config, "Copied directory contents.");
        }

        if (config.metaPath) {
            await fs.mkdir(dirname(config.metaPath), { recursive: true });
            const meta = { last_patch_utc: new Date().toISOString() };
            if (config.patchClientLabel) meta.client_label = config.patchClientLabel;
            if (config.patchBuildLabel) meta.build_label = config.patchBuildLabel;
            await fs.writeFile(config.metaPath, JSON.stringify(meta, null, 2), "utf8");
            await appendLog(config, "Wrote metadata: " + config.metaPath);
        }

        if (config.statePath && (config.actionName === "Revert" || config.activeMethod)) {
            await fs.mkdir(dirname(config.statePath), { recursive: true });
            const state = {
                status: config.actionName === "Revert" ? "notInstalled" : "installed",
                build_label: config.patchBuildLabel,
                updated_utc: new Date().toISOString()
            };
            if (config.activeMethod) state.active_method = config.activeMethod;
            await fs.writeFile(config.statePath, JSON.stringify(state, null, 2), "utf8");
            await appendLog(config, "Wrote installation state: " + config.statePath);
        }

        await appendLog(config, "OK: " + config.actionName + " complete.");
        await appendLog(config, relaunch(config));
    } catch (error) {
        await appendLog(config, "FAIL: " + (error && error.message ? error.message : String(error)));
        if (error && error.stack) await appendLog(config, String(error.stack));
    } finally {
        try {
            await fs.rm(configPath, { force: true });
        } catch {}
    }
}

main();
`;
