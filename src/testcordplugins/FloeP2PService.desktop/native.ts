/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { get } from "node:https";
import { tmpdir } from "node:os";
import { basename, join, normalize, sep } from "node:path";

import { Logger } from "@utils/Logger";
import { app, dialog, type IpcMainInvokeEvent } from "electron";
import { gunzipSync, unzipSync } from "fflate";

const MAX_OUTPUT_LENGTH = 64 * 1024;
const MAX_TEXT_DOWNLOAD_LENGTH = 1024 * 1024;
const PROCESS_TIMEOUT_MS = 10 * 60_000;
const READY_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 3;
const GITHUB_API_LATEST_RELEASE_URL = "https://api.github.com/repos/jannskiee/floe/releases/latest";
const FLOE_REPO_DOWNLOAD_URL = "https://github.com/jannskiee/floe/releases/download";
const REQUEST_HEADERS = { "User-Agent": "Illegalcord-FloeP2PService" };
const WINDOWS_SCRIPT_INSTALL_COMMAND = "irm https://floe.one/install.ps1 | iex";
const logger = new Logger("FloeP2PServiceNative");

export interface NativeResult<T> {
    success: boolean;
    data?: T;
    error?: string;
    cancelled?: boolean;
}

export interface FloeCommandResult {
    output: string;
}

export type FloeSessionKind = "send" | "receive";
export type FloeSessionStatus = "starting" | "waiting" | "running" | "completed" | "failed" | "cancelled";

export interface FloeSession {
    id: string;
    kind: FloeSessionKind;
    status: FloeSessionStatus;
    paths: string[];
    outputDir?: string;
    code?: string;
    link?: string;
    output: string;
    error?: string;
    exitCode?: number | null;
    startedAt: number;
    updatedAt: number;
}

interface InternalSession extends FloeSession {
    child: ChildProcess;
}

interface ProcessResult {
    code: number | null;
    output: string;
}

interface GitHubRelease {
    tag_name?: unknown;
}

interface InstallTarget {
    os: "windows" | "linux" | "darwin";
    arch: "amd64" | "arm64";
    archiveExt: ".zip" | ".tar.gz";
    binaryName: "floe.exe" | "floe";
    installDir: string;
}

const sessions = new Map<string, InternalSession>();
const allowedReceiveDirs = new Set<string>();
let latestSessionId: string | null = null;
let nextSessionId = 0;

export async function startSendFiles(_: IpcMainInvokeEvent): Promise<NativeResult<FloeSession>> {
    try {
        return await chooseAndStartSend("files");
    } catch {
        return fail("Could not start Floe send.");
    }
}

export async function startSendFolder(_: IpcMainInvokeEvent): Promise<NativeResult<FloeSession>> {
    try {
        return await chooseAndStartSend("folder");
    } catch {
        return fail("Could not start Floe send.");
    }
}

export async function chooseReceiveDirectory(_: IpcMainInvokeEvent): Promise<NativeResult<string>> {
    try {
        const selected = await dialog.showOpenDialog({
            title: "Choose Floe download folder",
            defaultPath: app.getPath("downloads"),
            properties: ["openDirectory", "createDirectory"]
        });
        const outputDir = selected.filePaths[0];

        if (selected.canceled || !outputDir) return { success: false, cancelled: true };

        const normalizedDir = normalize(outputDir);
        allowedReceiveDirs.add(normalizedDir);

        return { success: true, data: normalizedDir };
    } catch {
        return fail("Could not choose the download folder.");
    }
}

export async function startReceive(_: IpcMainInvokeEvent, locator: unknown, outputDir: unknown): Promise<NativeResult<FloeSession>> {
    try {
        const cleanLocator = validateLocator(locator);
        if (!cleanLocator) return { success: false, error: "Enter a valid Floe code or link." };

        const targetDirResult = await resolveReceiveDir(outputDir);
        if (!targetDirResult.success || !targetDirResult.data) {
            return { success: false, error: targetDirResult.error, cancelled: targetDirResult.cancelled };
        }

        const session = startFloeSession("receive", ["receive", cleanLocator, "-y", "-o", targetDirResult.data], [], targetDirResult.data);
        await waitForSessionReady(session);

        return { success: true, data: toPublicSession(session) };
    } catch {
        return fail("Could not start Floe receive.");
    }
}

export async function getLatestSession(_: IpcMainInvokeEvent): Promise<NativeResult<FloeSession>> {
    if (!latestSessionId) return { success: false, error: "No Floe session has been started." };

    const session = sessions.get(latestSessionId);
    if (!session) return { success: false, error: "The last Floe session is no longer available." };

    return { success: true, data: toPublicSession(session) };
}

export async function cancelLatestSession(_: IpcMainInvokeEvent): Promise<NativeResult<FloeSession>> {
    if (!latestSessionId) return { success: false, error: "No Floe session is running." };

    const session = sessions.get(latestSessionId);
    if (!session) return { success: false, error: "No Floe session is running." };

    cancelSession(session);
    return { success: true, data: toPublicSession(session) };
}

export async function cancelAllSessions(_: IpcMainInvokeEvent): Promise<NativeResult<FloeSession[]>> {
    const runningSessions = Array.from(sessions.values()).filter(isSessionAlive);
    for (const session of runningSessions) cancelSession(session);

    return { success: true, data: runningSessions.map(toPublicSession) };
}

export async function installFloe(_: IpcMainInvokeEvent): Promise<NativeResult<FloeCommandResult>> {
    try {
        const result = await installFloeWithFallbacks("install");

        return resultToNativeResult(result, "Could not install Floe.");
    } catch {
        return fail("Could not install Floe.");
    }
}

export async function updateFloe(_: IpcMainInvokeEvent): Promise<NativeResult<FloeCommandResult>> {
    try {
        const result = await installFloeWithFallbacks("update");

        return resultToNativeResult(result, "Could not update Floe.");
    } catch {
        return fail("Could not update Floe.");
    }
}

export async function checkFloeUpdate(_: IpcMainInvokeEvent): Promise<NativeResult<FloeCommandResult>> {
    try {
        const result = await runProcess(getFloeCommand(), ["update", "--check"]);

        return resultToNativeResult(result, "Could not check Floe updates.");
    } catch {
        return fail("Could not check Floe updates.");
    }
}

export async function getFloeVersion(_: IpcMainInvokeEvent): Promise<NativeResult<FloeCommandResult>> {
    try {
        const result = await runProcess(getFloeCommand(), ["version"]);

        return resultToNativeResult(result, "Could not read the Floe version.");
    } catch {
        return fail("Could not read the Floe version.");
    }
}

async function chooseAndStartSend(kind: "files" | "folder"): Promise<NativeResult<FloeSession>> {
    const selected = await dialog.showOpenDialog({
        title: kind === "files" ? "Choose files to send with Floe" : "Choose folder to send with Floe",
        properties: kind === "files" ? ["openFile", "multiSelections"] : ["openDirectory"]
    });

    const paths = selected.filePaths.map(path => normalize(path));
    logger.info("Floe send picker closed.", { kind, cancelled: selected.canceled, paths });
    if (selected.canceled || paths.length === 0) return { success: false, cancelled: true };

    const session = startFloeSession("send", ["send", ...paths], paths);
    await waitForSessionReady(session);

    if (session.status === "failed") {
        return { success: false, error: session.error ?? "Could not start Floe send.", data: toPublicSession(session) };
    }

    return { success: true, data: toPublicSession(session) };
}

function startFloeSession(kind: FloeSessionKind, args: string[], paths: string[], outputDir?: string): InternalSession {
    const id = `${Date.now().toString(36)}-${nextSessionId++}`;
    const command = getFloeCommand();
    logger.info("Starting Floe session.", { id, kind, command, args, paths, outputDir, path: process.env.PATH ?? process.env.Path ?? "" });

    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const session: InternalSession = {
        id,
        kind,
        status: "starting",
        paths,
        outputDir,
        output: "",
        child,
        startedAt: Date.now(),
        updatedAt: Date.now()
    };

    sessions.set(id, session);
    latestSessionId = id;

    child.stdout?.on("data", chunk => appendOutput(session, "stdout", chunk));
    child.stderr?.on("data", chunk => appendOutput(session, "stderr", chunk));
    child.on("error", error => {
        const formattedError = formatSpawnError(error.message);
        logger.error("Floe process spawn error.", { id, kind, error: formattedError, rawError: error.message });
        setSessionStatus(session, "failed", formattedError);
        session.error = formattedError;
        session.updatedAt = Date.now();
    });
    child.on("close", code => {
        logger.info("Floe process closed.", { id, kind, code, status: session.status, output: session.output });
        session.exitCode = code;
        session.updatedAt = Date.now();

        if (session.status === "cancelled") return;
        if (session.status === "failed" && session.error) return;
        if (code === 0) {
            setSessionStatus(session, "completed", "Process exited with code 0.");
            return;
        }

        session.error = getFloeError(session.output, code);
        setSessionStatus(session, "failed", session.error);
        logger.warn("Floe session failed.", { id, kind, code, error: session.error, output: session.output });
    });

    return session;
}

function waitForSessionReady(session: InternalSession): Promise<void> {
    return new Promise(resolve => {
        const interval = setInterval(() => {
            if (session.code || session.link || session.status === "waiting" || session.status === "running" || !isSessionAlive(session)) {
                clearInterval(interval);
                clearTimeout(timeout);
                resolve();
            }
        }, 200);

        const timeout = setTimeout(() => {
            clearInterval(interval);
            resolve();
        }, READY_TIMEOUT_MS);
    });
}

function appendOutput(session: InternalSession, stream: "stdout" | "stderr", chunk: Buffer | string): void {
    const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
    logger.info(`Floe ${stream}.`, { id: session.id, kind: session.kind, text });

    session.output = (session.output + text).slice(-MAX_OUTPUT_LENGTH);
    session.updatedAt = Date.now();

    const code = session.output.match(/(?:^|\n)\s*Code\s+([^\s]+)/);
    const link = session.output.match(/(?:^|\n)\s*Link\s+(https:\/\/floe\.one[^\s]+)/);
    if (code) session.code = code[1];
    if (link) session.link = link[1];

    if (/Waiting for peer/i.test(session.output)) setSessionStatus(session, "waiting", "Floe is waiting for a peer.");
    if (/Connected/i.test(session.output)) setSessionStatus(session, "running", "Floe connected to a peer.");
    if (/(?:^|\n)\s*Sent\s+/i.test(session.output) || /(?:^|\n)\s*Received\s+/i.test(session.output)) setSessionStatus(session, "completed", "Floe reported transfer completion.");
}

function cancelSession(session: InternalSession): void {
    if (!isSessionAlive(session)) return;

    logger.info("Cancelling Floe session.", { id: session.id, kind: session.kind });
    setSessionStatus(session, "cancelled", "Session cancelled by plugin.");
    session.updatedAt = Date.now();
    session.child.kill();
}

function setSessionStatus(session: InternalSession, status: FloeSessionStatus, detail: string): void {
    if (session.status === status) return;

    logger.info("Floe session status changed.", { id: session.id, kind: session.kind, from: session.status, to: status, detail });
    session.status = status;
}

function isSessionAlive(session: InternalSession): boolean {
    return session.child.exitCode === null && session.child.signalCode === null && session.status !== "failed" && session.status !== "completed" && session.status !== "cancelled";
}

function toPublicSession(session: InternalSession): FloeSession {
    return {
        id: session.id,
        kind: session.kind,
        status: session.status,
        paths: session.paths,
        outputDir: session.outputDir,
        code: session.code,
        link: session.link,
        output: session.output,
        error: session.error,
        exitCode: session.exitCode,
        startedAt: session.startedAt,
        updatedAt: session.updatedAt
    };
}

function validateLocator(value: unknown): string | null {
    if (typeof value !== "string") return null;

    const locator = value.trim();
    if (!locator || locator.length > 2048 || /[\x00\r\n]/.test(locator)) return null;

    return locator;
}

async function resolveReceiveDir(outputDir: unknown): Promise<NativeResult<string>> {
    if (typeof outputDir !== "string" || outputDir.trim().length === 0) {
        return { success: true, data: app.getPath("downloads") };
    }

    const normalizedDir = normalize(outputDir);
    if (!allowedReceiveDirs.has(normalizedDir)) return { success: false, error: "Choose the download folder again." };

    try {
        const info = await stat(normalizedDir);
        if (!info.isDirectory()) return { success: false, error: "Choose a valid download folder." };
    } catch {
        return { success: false, error: "Choose a valid download folder." };
    }

    return { success: true, data: normalizedDir };
}

async function installFromGitHubRelease(): Promise<ProcessResult> {
    const target = getInstallTarget();
    if (!target) return { code: null, output: "Unsupported platform or architecture." };

    const version = await getLatestVersion();
    const cleanVersion = version.replace(/^v/, "");
    const archive = `floe_${cleanVersion}_${target.os}_${target.arch}${target.archiveExt}`;
    const releaseUrl = `${FLOE_REPO_DOWNLOAD_URL}/${version}`;
    const archiveUrl = `${releaseUrl}/${archive}`;
    const checksumsUrl = `${releaseUrl}/checksums.txt`;
    const dir = await mkdtemp(join(tmpdir(), "floe-install-"));
    const archivePath = join(dir, archive);
    const extractedBinaryPath = join(dir, target.binaryName);
    const installPath = join(target.installDir, target.binaryName);

    if (!isInside(dir, archivePath) || !isInside(dir, extractedBinaryPath)) {
        return { code: null, output: "Invalid temporary path." };
    }

    try {
        await downloadFile(archiveUrl, archivePath);
        await verifyChecksum(archivePath, archive, checksumsUrl);
        await extractBinary(archivePath, target.archiveExt, target.binaryName, extractedBinaryPath);
        await mkdir(target.installDir, { recursive: true });
        await copyFile(extractedBinaryPath, installPath);
        await chmod(installPath, 0o755).catch(() => undefined);
        const pathOutput = await ensureInstallDirInPath(target);

        return {
            code: 0,
            output: [
                `Installed floe ${version} to ${installPath}.`,
                pathOutput
            ].filter(Boolean).join("\n")
        };
    } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
}

async function installFloeWithFallbacks(operation: "install" | "update"): Promise<ProcessResult> {
    const failures: string[] = [];
    const githubResult = await runInstallerStep("GitHub Releases", installFromGitHubRelease);
    if (githubResult.code === 0) return githubResult;

    failures.push(formatInstallerFailure("GitHub Releases", githubResult));
    if (process.platform !== "win32") return { code: githubResult.code, output: failures.join("\n\n") };

    const wingetCommand = operation === "install" ? "install" : "upgrade";
    const wingetResult = await runInstallerStep("Winget", () => runProcess("winget", [wingetCommand, "jannskiee.floe", "--accept-package-agreements", "--accept-source-agreements"]));
    if (wingetResult.code === 0) return mergeInstallerOutput(failures, "Winget", wingetResult);

    failures.push(formatInstallerFailure("Winget", wingetResult));
    const scriptResult = await runInstallerStep("Floe install script", () => runProcess("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", WINDOWS_SCRIPT_INSTALL_COMMAND]));
    if (scriptResult.code === 0) return mergeInstallerOutput(failures, "Floe install script", scriptResult);

    failures.push(formatInstallerFailure("Floe install script", scriptResult));

    return { code: scriptResult.code, output: failures.join("\n\n").slice(-MAX_OUTPUT_LENGTH) };
}

async function runInstallerStep(label: string, action: () => Promise<ProcessResult>): Promise<ProcessResult> {
    try {
        return await action();
    } catch (error) {
        return { code: null, output: error instanceof Error ? error.message : `${label} failed.` };
    }
}

function mergeInstallerOutput(failures: string[], label: string, result: ProcessResult): ProcessResult {
    return {
        code: 0,
        output: [
            ...failures,
            `${label} succeeded.`,
            result.output
        ].filter(Boolean).join("\n\n").slice(-MAX_OUTPUT_LENGTH)
    };
}

function formatInstallerFailure(label: string, result: ProcessResult): string {
    return [
        `${label} failed.`,
        result.output
    ].filter(Boolean).join("\n");
}

function downloadText(url: string, redirects: number): Promise<string> {
    return new Promise((resolve, reject) => {
        const req = get(url, { headers: REQUEST_HEADERS }, res => {
            const { location } = res.headers;
            if (location && res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && redirects < MAX_REDIRECTS) {
                res.resume();
                resolve(downloadText(new URL(location, url).toString(), redirects + 1));
                return;
            }

            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error(`Installer download failed with status ${res.statusCode ?? "unknown"}.`));
                return;
            }

            let body = "";
            res.setEncoding("utf8");
            res.on("data", chunk => {
                body += chunk;
                if (body.length > MAX_TEXT_DOWNLOAD_LENGTH) req.destroy(new Error("Download response is too large."));
            });
            res.on("end", () => resolve(body));
        });

        req.on("error", reject);
        req.end();
    });
}

function downloadFile(url: string, filePath: string, redirects = 0): Promise<void> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let length = 0;
        const req = get(url, { headers: REQUEST_HEADERS }, res => {
            const { location } = res.headers;
            if (location && res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && redirects < MAX_REDIRECTS) {
                res.resume();
                downloadFile(new URL(location, url).toString(), filePath, redirects + 1).then(resolve, reject);
                return;
            }

            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error(`Download failed with status ${res.statusCode ?? "unknown"}.`));
                return;
            }

            res.on("data", (chunk: Buffer) => {
                chunks.push(chunk);
                length += chunk.byteLength;
            });
            res.on("end", () => writeFile(filePath, Buffer.concat(chunks, length)).then(resolve, reject));
        });

        req.on("error", reject);
        req.end();
    });
}

function runProcess(command: string, args: string[], cwd?: string): Promise<ProcessResult> {
    return new Promise(resolve => {
        logger.info("Starting process.", { command, args, cwd });
        const child = spawn(command, args, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
        let output = "";
        let settled = false;

        const finish = (code: number | null, extraOutput = "") => {
            if (settled) return;

            settled = true;
            clearTimeout(timeout);
            output = [output, extraOutput].filter(Boolean).join("\n").slice(-MAX_OUTPUT_LENGTH);
            logger.info("Process finished.", { command, args, code, output });
            resolve({ code, output: output.trim() });
        };

        const timeout = setTimeout(() => {
            logger.warn("Process timed out.", { command, args, timeoutMs: PROCESS_TIMEOUT_MS });
            child.kill();
            finish(null, "Command timed out.");
        }, PROCESS_TIMEOUT_MS);

        child.stdout?.on("data", chunk => {
            logger.info("Process stdout.", { command, args, text: chunk.toString("utf8") });
            output = appendProcessOutput(output, chunk);
        });
        child.stderr?.on("data", chunk => {
            logger.warn("Process stderr.", { command, args, text: chunk.toString("utf8") });
            output = appendProcessOutput(output, chunk);
        });
        child.on("error", error => {
            logger.error("Process spawn error.", { command, args, error: formatSpawnError(error.message), rawError: error.message });
            finish(null, formatSpawnError(error.message));
        });
        child.on("close", code => finish(code));
    });
}

function appendProcessOutput(output: string, chunk: Buffer | string): string {
    const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
    return (output + text).slice(-MAX_OUTPUT_LENGTH);
}

function resultToNativeResult(result: ProcessResult, fallbackError: string): NativeResult<FloeCommandResult> {
    if (result.code === 0) return { success: true, data: { output: result.output || "Done." } };

    return {
        success: false,
        error: getLastOutputLine(result.output) || fallbackError,
        data: { output: result.output }
    };
}

function fail<T>(error: string): NativeResult<T> {
    return { success: false, error };
}

function getLastOutputLine(output: string): string {
    return output.split(/\r?\n/).map(line => line.trim()).filter(Boolean).at(-1) ?? "";
}

function getFloeError(output: string, code: number | null): string {
    const errorLine = output.split(/\r?\n/).map(line => line.trim()).find(line => line.startsWith("Error:"));
    if (errorLine) return errorLine;

    return getLastOutputLine(output) || `Floe exited before the transfer completed. Exit code: ${code ?? "unknown"}.`;
}

function formatSpawnError(message: string): string {
    if (/spawn floe ENOENT/i.test(message)) return "Floe was not found. Install Floe first.";
    if (/spawn .*floe\.exe ENOENT/i.test(message)) return "Floe was not found. Install Floe first.";
    if (/spawn winget ENOENT/i.test(message)) return "Winget was not found on this Windows install.";
    if (/spawn powershell\.exe ENOENT/i.test(message)) return "PowerShell was not found on this Windows install.";
    if (/spawn sh ENOENT/i.test(message)) return "The sh shell was not found.";

    return message || "Could not start the command.";
}

async function getLatestVersion(): Promise<string> {
    const release = JSON.parse(await downloadText(GITHUB_API_LATEST_RELEASE_URL, 0)) as GitHubRelease;
    if (typeof release.tag_name !== "string" || !/^v?\d+\.\d+\.\d+/.test(release.tag_name)) {
        throw new Error("Could not determine latest version.");
    }

    return release.tag_name.startsWith("v") ? release.tag_name : `v${release.tag_name}`;
}

function getFloeCommand(): string {
    const target = getInstallTarget();
    if (!target) return "floe";

    const installPath = join(target.installDir, target.binaryName);
    return existsSync(installPath) ? installPath : "floe";
}

function getInstallTarget(): InstallTarget | null {
    const arch = getReleaseArch();
    if (!arch) return null;

    if (process.platform === "win32") {
        const localAppData = process.env.LOCALAPPDATA;
        if (!localAppData) return null;

        return {
            os: "windows",
            arch,
            archiveExt: ".zip",
            binaryName: "floe.exe",
            installDir: join(localAppData, "Programs", "floe")
        };
    }

    const home = process.env.HOME;
    if (!home) return null;

    if (process.platform === "linux") {
        return {
            os: "linux",
            arch,
            archiveExt: ".tar.gz",
            binaryName: "floe",
            installDir: join(home, ".local", "bin")
        };
    }

    if (process.platform === "darwin") {
        return {
            os: "darwin",
            arch,
            archiveExt: ".tar.gz",
            binaryName: "floe",
            installDir: join(home, ".local", "bin")
        };
    }

    return null;
}

function getReleaseArch(): InstallTarget["arch"] | null {
    if (process.arch === "x64") return "amd64";
    if (process.arch === "arm64") return "arm64";

    return null;
}

async function verifyChecksum(archivePath: string, archiveName: string, checksumsUrl: string): Promise<void> {
    const checksums = await downloadText(checksumsUrl, 0);
    const line = checksums.split(/\r?\n/).find(line => line.trim().endsWith(archiveName));
    if (!line) return;

    const expectedHash = line.trim().split(/\s+/)[0]?.toLowerCase();
    if (!expectedHash) return;

    const archiveData = await readFile(archivePath);
    const actualHash = createHash("sha256").update(archiveData).digest("hex").toLowerCase();
    if (actualHash !== expectedHash) {
        throw new Error(`Checksum verification failed. Expected ${expectedHash}, got ${actualHash}.`);
    }
}

async function extractBinary(archivePath: string, archiveExt: InstallTarget["archiveExt"], binaryName: string, outputPath: string): Promise<void> {
    const archiveData = await readFile(archivePath);
    const binaryData = archiveExt === ".zip"
        ? extractFromZip(archiveData, binaryName)
        : extractFromTarGz(archiveData, binaryName);

    await writeFile(outputPath, binaryData, { mode: 0o755 });
}

function extractFromZip(archiveData: Buffer, binaryName: string): Buffer {
    const entries = unzipSync(new Uint8Array(archiveData));
    const entry = Object.entries(entries).find(([path]) => basename(path) === binaryName);
    if (!entry) throw new Error(`${binaryName} not found in archive.`);

    return Buffer.from(entry[1]);
}

function extractFromTarGz(archiveData: Buffer, binaryName: string): Buffer {
    const tarData = Buffer.from(gunzipSync(new Uint8Array(archiveData)));

    for (let offset = 0; offset + 512 <= tarData.length;) {
        const name = tarData.toString("utf8", offset, offset + 100).replace(/\0.*$/, "");
        if (!name) break;

        const sizeRaw = tarData.toString("utf8", offset + 124, offset + 136).replace(/\0.*$/, "").trim();
        const size = parseInt(sizeRaw || "0", 8);
        const contentStart = offset + 512;
        const contentEnd = contentStart + size;

        if (basename(name) === binaryName) return tarData.subarray(contentStart, contentEnd);

        offset = contentStart + Math.ceil(size / 512) * 512;
    }

    throw new Error(`${binaryName} not found in archive.`);
}

async function ensureInstallDirInPath(target: InstallTarget): Promise<string> {
    if (target.os === "windows") return ensureWindowsPath(target.installDir);

    return `${target.installDir} must be in PATH.`;
}

async function ensureWindowsPath(installDir: string): Promise<string> {
    const escapedDir = installDir.replaceAll("'", "''");
    const result = await runProcess("powershell.exe", [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `$InstallDir='${escapedDir}';$CurrentPath=[Environment]::GetEnvironmentVariable('Path','User');if($CurrentPath -notlike "*$InstallDir*"){$NewPath=($CurrentPath.TrimEnd(';')+';'+$InstallDir).TrimStart(';');[Environment]::SetEnvironmentVariable('Path',$NewPath,'User');Write-Output "Added $InstallDir to your PATH."}`
    ]);

    return result.output;
}

function isInside(root: string, target: string): boolean {
    const normalizedRoot = normalize(root + sep);
    return normalize(target).startsWith(normalizedRoot);
}
