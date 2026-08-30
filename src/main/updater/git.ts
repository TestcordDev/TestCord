/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { RendererSettings } from "@main/settings";
import { IpcEvents } from "@shared/IpcEvents";
import { execFile as cpExecFile } from "child_process";
import { ipcMain } from "electron";
import { existsSync } from "fs";
import { join } from "path";
import { promisify } from "util";

import { serializeErrors } from "./common";

const ROOT_DIR = existsSync(join(__dirname, "../../scripts/build/build.mjs"))
    ? join(__dirname, "../../")
    : existsSync(join(__dirname, "../scripts/build/build.mjs"))
        ? join(__dirname, "..")
        : __dirname;

const execFile = promisify(cpExecFile);

const isFlatpak = process.platform === "linux" && !!process.env.FLATPAK_ID;

if (process.platform === "darwin") process.env.PATH = `/usr/local/bin:${process.env.PATH}`;

function git(...args: string[]) {
    const opts = { cwd: ROOT_DIR };

    if (isFlatpak) return execFile("flatpak-spawn", ["--host", "git", ...args], opts);
    else return execFile("git", args, opts);
}

async function getCurrentBranch() {
    try {
        const res = await git("rev-parse", "--abbrev-ref", "HEAD");
        return res.stdout.trim();
    } catch {
        return "main";
    }
}

async function getRepo() {
    try {
        const res = await git("remote", "get-url", "origin");
        return res.stdout.trim()
            .replace(/git@(.+):/, "https://$1/")
            .replace(/\.git$/, "");
    } catch {
        return "https://github.com/TestcordDev/Testcord";
    }
}

function extractBranch(branchOrEvent?: any, maybeBranch?: string) {
    if (typeof branchOrEvent === "string" && branchOrEvent) return branchOrEvent;
    if (typeof maybeBranch === "string" && maybeBranch) return maybeBranch;
    return RendererSettings.store.updaterBranch ?? "main";
}

async function calculateGitChanges(branchOrEvent?: any, maybeBranch?: string) {
    const branch = extractBranch(branchOrEvent, maybeBranch);

    try {
        await git("fetch", "origin", branch, "--prune");
    } catch {
        try {
            await git("fetch", "--all", "--prune");
        } catch {
        }
    }

    try {
        await git("rev-parse", "--verify", `origin/${branch}`);
    } catch {
        return [];
    }

    const currentBranch = await getCurrentBranch();
    const headCommit = (await git("rev-parse", "HEAD")).stdout.trim();
    const remoteCommit = (await git("rev-parse", `origin/${branch}`)).stdout.trim();

    if (currentBranch === branch && headCommit === remoteCommit) {
        return [];
    }

    let commitsStr = "";
    try {
        const res = await git("log", `HEAD..origin/${branch}`, "--pretty=format:%an/%h/%s");
        commitsStr = res.stdout.trim();
    } catch {
        commitsStr = "";
    }

    if (commitsStr) {
        return commitsStr.split("\n").map(line => {
            const [author, hash, ...rest] = line.split("/");
            return {
                hash,
                author,
                message: rest.join("/").split("\n")[0]
            };
        });
    }
    if (currentBranch !== branch || headCommit !== remoteCommit) {
        try {
            const res = await git("log", "-n", "5", `origin/${branch}`, "--pretty=format:%an/%h/%s");
            const commits = res.stdout.trim();
            if (commits) {
                return commits.split("\n").map((line, i) => {
                    const [author, hash, ...rest] = line.split("/");
                    return {
                        hash,
                        author,
                        message: currentBranch !== branch && i === 0
                            ? `Switch to ${branch} branch (current: ${currentBranch}): ${rest.join("/").split("\n")[0]}`
                            : rest.join("/").split("\n")[0]
                    };
                });
            }
        } catch {
        }
    }

    return [];
}

async function pull(branchOrEvent?: any, maybeBranch?: string) {
    const branch = extractBranch(branchOrEvent, maybeBranch);
    try {
        await git("fetch", "origin", branch, "--prune");
    } catch {

    }

    const currentBranch = await getCurrentBranch();
    if (currentBranch !== branch) {

        try {
            await git("checkout", "-f", "-B", branch, `origin/${branch}`);
            await git("reset", "--hard", `origin/${branch}`);
        } catch {
            await git("checkout", "-B", branch, `origin/${branch}`);
        }
        return true;
    }

    try {
        const res = await git("pull", "--ff-only", "origin", branch);
        return res.stdout.includes("Fast-forward") || res.stdout.includes("Already up to date") || res.stdout.includes("Updating");
    } catch {

        await git("reset", "--hard", `origin/${branch}`);
        return true;
    }
}

async function forcePull(branchOrEvent?: any, maybeBranch?: string) {
    const branch = extractBranch(branchOrEvent, maybeBranch);
    try {
        await git("fetch", "origin", branch, "--prune");
    } catch {

    }
    await git("checkout", "-f", "-B", branch, `origin/${branch}`);
    await git("reset", "--hard", `origin/${branch}`);
    await git("clean", "-fd");
    return true;
}

async function build() {
    const opts = { cwd: ROOT_DIR };

    const command = isFlatpak ? "flatpak-spawn" : "node";
    const args = isFlatpak ? ["--host", "node", "scripts/build/build.mjs"] : ["scripts/build/build.mjs"];

    if (IS_DEV) args.push("--dev");

    const res = await execFile(command, args, opts);

    return !res.stderr.includes("Build failed");
}

ipcMain.handle(IpcEvents.GET_REPO, serializeErrors(getRepo));
ipcMain.handle(IpcEvents.GET_UPDATES, serializeErrors(calculateGitChanges));
ipcMain.handle(IpcEvents.UPDATE, serializeErrors(pull));
ipcMain.handle(IpcEvents.FORCE_UPDATE, serializeErrors(forcePull));
ipcMain.handle(IpcEvents.BUILD, serializeErrors(build));
