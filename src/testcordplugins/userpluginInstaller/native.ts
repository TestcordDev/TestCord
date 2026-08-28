/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 nin0
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NativeSettings } from "@main/settings";
import { exec, spawn } from "child_process";
import { BrowserWindow, dialog, shell } from "electron";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "fs";
import { mkdir, readdir, readFile, rm } from "fs/promises";
import { basename, join } from "path";

import pluginValidateContent from "./misc/pluginValidate.html";
import setGitPathContent from "./misc/setGitPath.html";
import updateValidateContent from "./misc/updateValidate.html";

const PLUGIN_META_REGEX = /export default definePlugin\((?:\s|\/(?:\/|\*).*)*{\s*(?:\s|\/(?:\/|\*).*)*name:\s*(?:"|'|`)(.*)(?:"|'|`)(?:\s|\/(?:\/|\*).*)*,(?:\s|\/(?:\/|\*).*)*.+(?:\s|\/(?:\/|\*).*)*description:\s*(?:"|'|`)(.*)(?:"|'|`)(?:\s|\/(?:\/|\*).*)*/;
// if edited, also edit in misc/constants.ts!!!
const CLONE_LINK_REGEX = /https:\/\/(?:((?:git(?:hub|lab)\.com|git\.(?:[a-zA-Z0-9]|\.)+|codeberg\.org))\/(?!user-attachments)((?:[a-zA-Z0-9]|-)+)\/((?:[a-zA-Z0-9]|-|\.)+)(?:\.git)?|(plugins\.(nin0)\.dev)\/((?:[a-zA-Z0-9]|-|\.)+))(?:\/)?/;

function getRepoRootDir(): string {
    const candidates = [
        join(__dirname, "../.."),
        join(__dirname, ".."),
        process.cwd()
    ];
    for (const c of candidates) {
        if (existsSync(join(c, "package.json")) && existsSync(join(c, "src"))) {
            return c;
        }
    }
    return ["desktop", "equibop"].includes(basename(__dirname))
        ? join(__dirname, "../..")
        : join(__dirname, "..");
}

function getUserpluginsDir(): string {
    const root = getRepoRootDir();
    const dir = join(root, "src", "userplugins");
    if (!existsSync(dir)) {
        try {
            mkdirSync(dir, { recursive: true });
        } catch { }
    }
    return dir;
}

function getGitExecutable(): string {
    return NativeSettings.store.plugins?.UserpluginInstaller?.gitPath || "git";
}

export async function ensurePluginsDirectory(_?: any) {
    const dir = getUserpluginsDir();
    if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
    }
}

export async function rmPlugin(_: any, name: string): Promise<string> {
    if (basename(name) !== name || name.includes("..")) throw new Error("Invalid plugin name");
    const ups = await getUserplugins();
    const pl = ups.find(p => p.directory === name);
    if (!pl) throw new Error("Plugin not found");

    const deleteReqDialog = await dialog.showMessageBox({
        title: "Uninstall plugin",
        message: `Uninstall ${pl.name}`,
        type: "error",
        detail: `The uninstall of the userplugin ${pl.name} has been requested. Would you like to do so?\n\nIf you did not initiate this, press No.`,
        buttons: ["No", "Yes"]
    });

    if (deleteReqDialog.response !== 1) throw new Error("User rejected");
    const targetDir = join(getUserpluginsDir(), name);
    if (existsSync(targetDir)) {
        await rm(targetDir, { recursive: true, force: true });
    }

    await build();
    return "Done";
}

export async function isUpdateAvailableForPlugin(_: any, name: string): Promise<boolean> {
    if (basename(name) !== name || name.includes("..")) return false;
    const pluginDir = join(getUserpluginsDir(), name);
    if (!existsSync(pluginDir)) return false;

    return new Promise(resolve => {
        const gitExe = getGitExecutable();
        const otherProc = exec(`${gitExe} fetch`, {
            cwd: pluginDir
        });
        otherProc.on("error", () => {
            resolve(false);
        });
        otherProc.once("close", async () => {
            try {
                const headFile = join(pluginDir, ".git", "HEAD");
                if (!existsSync(headFile)) return resolve(false);
                const headMatch = (await readFile(headFile, "utf8")).match(/^ref: (.+)/);
                if (!headMatch) return resolve(false);
                const head = headMatch[1];
                const remoteHeadFile = join(pluginDir, ".git", "refs", "remotes", "origin", "HEAD");
                let remoteHead = "refs/remotes/origin/main";
                if (existsSync(remoteHeadFile)) {
                    const remoteHeadMatch = (await readFile(remoteHeadFile, "utf8")).match(/^ref: (.+)/);
                    if (remoteHeadMatch) remoteHead = remoteHeadMatch[1];
                }
                const localCommitFile = join(pluginDir, ".git", head);
                const remoteCommitFile = join(pluginDir, ".git", remoteHead);
                if (!existsSync(localCommitFile) || !existsSync(remoteCommitFile)) {
                    return resolve(false);
                }
                const localCommit = await readFile(localCommitFile, "utf8");
                const remoteCommit = await readFile(remoteCommitFile, "utf8");

                resolve(localCommit.trim() !== remoteCommit.trim());
            } catch (e) {
                resolve(false);
            }
        });
    });
}

export async function initPluginInstall(_: any, link: string, source: string, owner: string, repo: string): Promise<string> {
    const verifiedRegex = link.match(CLONE_LINK_REGEX);
    if (!verifiedRegex) throw new Error("Invalid link");
    const idpl = source === "plugins.nin0.dev" ? 1 : 0;
    if (![4, 7].includes(verifiedRegex.length) || verifiedRegex[0] !== link || verifiedRegex[[1, 4][idpl]] !== source || verifiedRegex[[2, 5][idpl]] !== owner || verifiedRegex[[3, 6][idpl]] !== repo) {
        throw new Error("Invalid link parameters");
    }

    // Ask for clone
    const cloneDialog = await dialog.showMessageBox({
        title: "Clone userplugin",
        message: `You are about to clone a userplugin from ${source}.`,
        type: "question",
        detail: `The repository name is "${repo}" and it is owned by "${owner}".\nThe repository URL is ${link}\n\n(If you did not request this intentionally, choose Cancel)`,
        buttons: ["Cancel", "Clone repository and continue install", "Open repository in browser"]
    });
    switch (cloneDialog.response) {
        case 0:
            throw new Error("Rejected by user");
        case 1:
            await cloneRepo(link, repo);
            break;
        case 2:
            await shell.openExternal(link);
            throw new Error("silentStop");
    }

    const pluginPath = join(getUserpluginsDir(), repo);
    const meta = await getPluginMeta(pluginPath);

    return new Promise((resolve, reject) => {
        let settled = false;
        const parentWin = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
        const win = new BrowserWindow({
            maximizable: false,
            minimizable: false,
            width: 560,
            height: meta.usesNative || meta.usesPreSend ? 650 : 360,
            resizable: false,
            webPreferences: {
                devTools: true
            },
            title: "Review userplugin",
            modal: !!parentWin,
            parent: parentWin,
            show: false,
            autoHideMenuBar: true
        });

        win.on("closed", () => {
            if (!settled) {
                settled = true;
                reject(new Error("Installation cancelled"));
            }
        });

        win.loadURL(generateReviewPluginContent(meta));
        win.on("page-title-updated", async () => {
            const title = win.webContents.getTitle() as "abortInstall" | "reviewCode" | "install";
            switch (title) {
                case "abortInstall": {
                    settled = true;
                    win.close();
                    try {
                        await rm(pluginPath, {
                            recursive: true,
                            force: true
                        });
                    } catch { }
                    return reject(new Error("Rejected by user"));
                }
                case "install": {
                    settled = true;
                    win.close();
                    try {
                        await build();
                        resolve(JSON.stringify({
                            name: meta.name,
                            native: meta.usesNative
                        }));
                    } catch (e: any) {
                        reject(new Error(e?.message || String(e)));
                    }
                    break;
                }
            }
        });
        win.show();
    });
}

async function build(): Promise<string> {
    const rootDir = getRepoRootDir();
    return new Promise((resolve, reject) => {
        const proc = exec("pnpm build", {
            cwd: rootDir,
            shell: process.env.SHELL || process.env.ComSpec || undefined
        });
        let stderr = "";
        proc.stderr?.on("data", d => {
            stderr += String(d);
        });
        proc.on("error", err => {
            reject(new Error(`Failed to execute build: ${err.message}`));
        });
        proc.once("close", () => {
            if (proc.exitCode !== 0) {
                reject(new Error(`Failed to build TestCord (exit code ${proc.exitCode}): ${stderr || "Try building from terminal with `pnpm build`"}`));
                return;
            }
            resolve("Success");
        });
    });
}

async function getPluginMeta(path: string, extra: object = {}): Promise<{
    name: string;
    description: string;
    usesPreSend: boolean;
    usesNative: boolean;
    directory?: string;
    remote: string;
}> {
    if (!existsSync(path)) throw new Error(`Path does not exist: ${path}`);
    const files = readdirSync(path);
    const mainFile = files.find(f => ["index.ts", "index.tsx", "index.js", "index.jsx"].includes(f));
    if (!mainFile) throw new Error("Invalid plugin: entry file not found");

    const file = readFileSync(join(path, mainFile), "utf8");
    let remoteURL = "";
    try {
        const remoteConfigFile = join(path, ".git", "config");
        if (existsSync(remoteConfigFile)) {
            const remoteC = readFileSync(remoteConfigFile, "utf8");
            const remoteMatch = remoteC.match(/\[remote "origin"]\s+url = (https:\/\/(?:(?:git(?:hub|lab)\.com|git\.(?:[a-zA-Z0-9]|\.)+|codeberg\.org)\/(?!user-attachments)(?:[a-zA-Z0-9]|-)+\/(?:[a-zA-Z0-9]|-|\.)+(?:\.git)?|(plugins\.(nin0)\.dev)\/((?:[a-zA-Z0-9]|-|\.)+))(?:\/)?)\n/);
            if (remoteMatch) remoteURL = remoteMatch[1];
        }
    } catch {
        remoteURL = "";
    }

    const rawMeta = file.match(PLUGIN_META_REGEX);
    const nameMatch = file.match(/name:\s*["'`]?([^"'`,\n\r]+)["'`]?/);
    const descMatch = file.match(/description:\s*["'`]?([^"'`,\n\r]+)["'`]?/);

    const name = rawMeta?.[1] || nameMatch?.[1] || basename(path);
    const description = rawMeta?.[2] || descMatch?.[1] || "No description provided";

    return {
        name,
        description,
        usesPreSend: file.includes("PreSendListener") || file.includes("onBeforeMessage"),
        usesNative: files.includes("native.ts") || files.includes("native.js"),
        remote: remoteURL,
        ...extra
    };
}

async function cloneRepo(link: string, repo: string): Promise<void> {
    const userpluginsDir = getUserpluginsDir();
    const gitExe = getGitExecutable();

    return new Promise((resolve, reject) => {
        const proc = spawn(gitExe, ["clone", link], {
            cwd: userpluginsDir
        });
        let stderr = "";
        proc.stderr?.on("data", d => {
            stderr += String(d);
        });
        proc.on("error", err => {
            reject(new Error(`Failed to run git clone (${gitExe}): ${err.message}. Make sure Git is installed or set the Git path in settings.`));
        });
        proc.once("close", async () => {
            if (proc.exitCode !== 0) {
                const targetPath = join(userpluginsDir, repo);
                if (!existsSync(targetPath))
                    return reject(new Error(`Failed to clone: ${stderr || "Git exited with code " + proc.exitCode}`));
                const deleteReqDialog = await dialog.showMessageBox({
                    title: "Error",
                    message: "Plugin already exists",
                    type: "error",
                    detail: `The plugin that you tried to clone already exists at ${userpluginsDir}.\nWould you like to reclone it? Only do this if you want to reinstall or update the plugin.`,
                    buttons: ["No", "Yes"]
                });
                if (deleteReqDialog.response !== 1) return reject(new Error("User rejected"));
                await rm(targetPath, {
                    recursive: true,
                    force: true
                });
                try {
                    await cloneRepo(link, repo);
                    resolve();
                } catch (err) {
                    reject(err);
                }
                return;
            }
            resolve();
        });
    });
}

function generateReviewPluginContent(meta: {
    name: string;
    description: string;
    usesPreSend: boolean;
    usesNative: boolean;
}): string {
    const template = pluginValidateContent
        .replace("%PLUGINNAME%", escapeHtml(meta.name))
        .replace("%PLUGINDESC%", escapeHtml(meta.description))
        .replace("%WARNINGHIDER%", !meta.usesNative && !meta.usesPreSend ? "[data-useless=\"warning\"] { display: none !important; }" : "")
        .replace("%NATIVETSHIDER%", meta.usesNative ? "" : "#native-ts-warning { display: none !important; }")
        .replace("%PRESENDHIDER%", meta.usesPreSend ? "" : "#pre-send-warning { display: none !important; }");
    const buf = Buffer.from(template).toString("base64");
    return `data:text/html;base64,${buf}`;
}

const escapeHtml = (s: string) => s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

function openExternalLink(url: string) {
    try {
        const { protocol } = new URL(url);
        if (protocol !== "https:" && protocol !== "http:") return;
    } catch {
        return;
    }
    return shell.openExternal(url);
}

function generateUpdatePluginContent(meta: {
    name: string;
    description: string;
    remote: string;
    commit: string;
}): string {
    const template = updateValidateContent
        .replace("%PLUGINNAME%", escapeHtml(meta.name))
        .replace("%PLUGINDESC%", escapeHtml(meta.description))
        .replace("%REMOTE%", escapeHtml(meta.remote))
        .replace("%COMMITMESSAGE%", meta.commit.replaceAll("\n", "<br />"));
    const buf = Buffer.from(template).toString("base64");
    return `data:text/html;base64,${buf}`;
}

export async function getUserplugins() {
    const userpluginsDir = getUserpluginsDir();
    if (!existsSync(userpluginsDir)) return [];

    try {
        const folderContents = await readdir(userpluginsDir, {
            withFileTypes: true
        });
        const plugins = await Promise.allSettled(
            folderContents
                .filter(item => item.isDirectory() && !item.name.startsWith("."))
                .map(item => ({
                    path: join(item.parentPath || userpluginsDir, item.name),
                    directory: item.name
                }))
                .map(({ path, directory }) => getPluginMeta(path, { directory }))
        );

        return plugins
            .filter((p): p is PromiseFulfilledResult<any> => p.status === "fulfilled")
            .map(p => p.value);
    } catch {
        return [];
    }
}

export async function updatePlugin(_: any, directory: string): Promise<string> {
    if (basename(directory) !== directory || directory.includes("..")) throw new Error("Invalid plugin directory");
    const pluginDir = join(getUserpluginsDir(), directory);
    if (!existsSync(pluginDir)) throw new Error(`Plugin directory not found: ${pluginDir}`);
    const pluginMeta = await getPluginMeta(pluginDir);
    const gitExe = getGitExecutable();

    return new Promise((resolve, reject) => {
        let settled = false;
        const parentWin = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
        const win = new BrowserWindow({
            maximizable: false,
            minimizable: false,
            width: 560,
            height: 600,
            resizable: false,
            webPreferences: {
                devTools: true
            },
            title: "Review userplugin",
            modal: !!parentWin,
            parent: parentWin,
            show: false,
            autoHideMenuBar: true
        });

        win.on("closed", () => {
            if (!settled) {
                settled = true;
                reject(new Error("Update cancelled"));
            }
        });

        const commitProc = exec(`${gitExe} log origin/HEAD...HEAD --oneline --pretty=format:%an////////%h////////%H////////%s`, {
            cwd: pluginDir
        });
        let rawOutput = "";
        commitProc.stdout?.on("data", d => {
            rawOutput += String(d);
        });
        commitProc.on("error", err => {
            if (!settled) {
                settled = true;
                win.close();
                reject(new Error(`Git log failed: ${err.message}`));
            }
        });
        commitProc.once("close", () => {
            win.loadURL(generateUpdatePluginContent({
                name: pluginMeta.name,
                description: pluginMeta.description,
                remote: pluginMeta.remote,
                commit: rawOutput ? rawOutput.split("\n").map(line => line.split("////////")).map(([user, shortCommit, longCommit, message]) => `${escapeHtml(user || "")} (<a href="${escapeHtml((pluginMeta.remote || "").replace("plugins.nin0.dev", "git.nin0.dev/userplugins"))}/commit/${encodeURIComponent(longCommit ?? "")}" style="font-family: monospace;">${escapeHtml(shortCommit ?? "")}</a>) ~ ${escapeHtml(message ?? "")}`).join("\n") : "No commit history found"
            }));
            win.on("page-title-updated", async () => {
                const title = win.webContents.getTitle();
                if (title.startsWith("openLink:")) {
                    await openExternalLink(title.replace("openLink:", ""));
                    return;
                }
                switch (title as "abortInstall" | "install") {
                    case "abortInstall": {
                        settled = true;
                        win.close();
                        return reject(new Error("Rejected by user"));
                    }
                    case "install": {
                        settled = true;
                        win.close();
                        try {
                            const otherProc = exec(`${gitExe} rebase origin/HEAD`, {
                                cwd: pluginDir
                            });
                            let errored = "";
                            otherProc.stderr?.on("data", d => { if (String(d).includes("Success")) return; errored += String(d); });
                            otherProc.on("error", err => {
                                reject(new Error(`Git rebase failed: ${err.message}`));
                            });
                            otherProc.once("close", async () => {
                                if (otherProc.exitCode !== 0 && errored && !errored.includes("Success")) {
                                    return reject(new Error(`Failed to apply the update:\n\n${errored}`));
                                }
                                try {
                                    await build();
                                    resolve(JSON.stringify({
                                        name: pluginMeta.name,
                                        native: pluginMeta.usesNative
                                    }));
                                } catch (err: any) {
                                    reject(new Error(err?.message || String(err)));
                                }
                            });
                        } catch (e: any) {
                            reject(new Error(e?.message || String(e)));
                        }
                        break;
                    }
                }
            });
            win.show();
        });
    });
}

export async function openGitPathModal(_?: any) {
    const gitPathSet: string | undefined = NativeSettings.store.plugins?.UserpluginInstaller?.gitPath;
    const parentWin = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    const win = new BrowserWindow({
        maximizable: false,
        minimizable: false,
        width: 560,
        height: 400,
        resizable: false,
        webPreferences: {
            devTools: true
        },
        title: "Set Git path",
        modal: !!parentWin,
        parent: parentWin,
        show: false,
        autoHideMenuBar: true
    });
    win.loadURL(`data:text/html;base64,${Buffer.from(setGitPathContent).toString("base64")}`);
    win.on("page-title-updated", async () => {
        const t = win.webContents.getTitle();
        if (t === "abort") win.close();
        if (t.startsWith("ok")) {
            if (!NativeSettings.store.plugins.UserpluginInstaller) {
                NativeSettings.store.plugins.UserpluginInstaller = {
                    gitPath: undefined
                };
            }
            if (t === "ok-") {
                NativeSettings.store.plugins.UserpluginInstaller.gitPath = undefined;
            } else {
                const gitPath2 = t.split("-").toSpliced(0, 1).join("-");
                NativeSettings.store.plugins.UserpluginInstaller.gitPath = gitPath2;
            }
            win.close();
        }
        if (t.startsWith("check")) {
            try {
                const gitProc = spawn(t === "check-" ? "git" : t.split("-").toSpliced(0, 1).join("-"), ["--version"]);
                let rawOutput = "";
                gitProc.stdout?.on("data", d => {
                    rawOutput += String(d);
                });
                gitProc.on("error", e => {
                    dialog.showMessageBox({
                        title: "Error",
                        message: "Git error",
                        type: "error",
                        detail: `${e}\n\nDouble-check the path you entered.`,
                        buttons: ["OK"]
                    });
                });
                gitProc.once("close", () => {
                    if (gitProc.exitCode === 0) {
                        dialog.showMessageBox({
                            title: "Success",
                            message: "Git works!",
                            type: "info",
                            detail: `Successfully called ${rawOutput.trim()}`,
                            buttons: ["OK"]
                        });
                    }
                });
            } catch (e) {
                dialog.showMessageBox({
                    title: "Error",
                    message: "Git error",
                    type: "error",
                    detail: `${e}\n\nDouble-check the path you entered.`,
                    buttons: ["OK"]
                });
            }
        }
    });
    win.show();
    if (gitPathSet) {
        win.webContents.executeJavaScript(`document.querySelector("input").value = ${JSON.stringify(gitPathSet)};`);
    }
}
