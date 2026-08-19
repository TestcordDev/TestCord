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
import { execFile as cpExecFile } from "child_process";
import { ipcMain } from "electron";
import { join } from "path";
import { promisify } from "util";
import { serializeErrors } from "./common";
const VENCORD_SRC_DIR = join(__dirname, "..");
const EQUICORD_DIR = join(__dirname, "../../");
const execFile = promisify(cpExecFile);
const isFlatpak = process.platform === "linux" && !!process.env.FLATPAK_ID;
if (process.platform === "darwin")
    process.env.PATH = `/usr/local/bin:${process.env.PATH}`;
function git(...args) {
    const opts = { cwd: VENCORD_SRC_DIR };
    if (isFlatpak)
        return execFile("flatpak-spawn", ["--host", "git", ...args], opts);
    else
        return execFile("git", args, opts);
}
async function getCurrentBranch() {
    const res = await git("rev-parse", "--abbrev-ref", "HEAD");
    return res.stdout.trim();
}
async function getRepo() {
    const res = await git("remote", "get-url", "origin");
    return res.stdout.trim()
        .replace(/git@(.+):/, "https://$1/")
        .replace(/\.git$/, "");
}
async function calculateGitChanges() {
    await git("fetch");
    const branch = RendererSettings.store.updaterBranch ?? "main";
    // Only report updates when HEAD is on the configured branch. If the user
    // switched branches locally, the updater must not list (or apply) updates
    // from another branch.
    if (await getCurrentBranch() !== branch)
        return [];
    const existsOnOrigin = (await git("ls-remote", "origin", branch)).stdout.length > 0;
    if (!existsOnOrigin)
        return [];
    const res = await git("log", `HEAD...origin/${branch}`, "--pretty=format:%an/%h/%s");
    const commits = res.stdout.trim();
    return commits ? commits.split("\n").map(line => {
        const [author, hash, ...rest] = line.split("/");
        return {
            hash, author,
            message: rest.join("/").split("\n")[0]
        };
    }) : [];
}
async function pull() {
    const branch = RendererSettings.store.updaterBranch ?? "main";
    if (await getCurrentBranch() !== branch)
        return false;
    await git("checkout", branch);
    const res = await git("pull");
    return res.stdout.includes("Fast-forward");
}
async function forcePull() {
    const branch = RendererSettings.store.updaterBranch ?? "main";
    // Never switch branches or reset/clean the worktree unless HEAD is already
    // on the configured branch, or local work on another branch gets destroyed.
    if (await getCurrentBranch() !== branch)
        return false;
    await git("fetch", "origin", branch);
    await git("checkout", branch);
    await git("reset", "--hard", `origin/${branch}`);
    await git("clean", "-fd");
    return true;
}
async function build() {
    const opts = { cwd: EQUICORD_DIR };
    const command = isFlatpak ? "flatpak-spawn" : "node";
    const args = isFlatpak ? ["--host", "node", "scripts/build/build.mjs"] : ["scripts/build/build.mjs"];
    if (IS_DEV)
        args.push("--dev");
    const res = await execFile(command, args, opts);
    return !res.stderr.includes("Build failed");
}
ipcMain.handle("VencordGetRepo" /* IpcEvents.GET_REPO */, serializeErrors(getRepo));
ipcMain.handle("VencordGetUpdates" /* IpcEvents.GET_UPDATES */, serializeErrors(calculateGitChanges));
ipcMain.handle("VencordUpdate" /* IpcEvents.UPDATE */, serializeErrors(pull));
ipcMain.handle("VencordForceUpdate" /* IpcEvents.FORCE_UPDATE */, serializeErrors(forcePull));
ipcMain.handle("VencordBuild" /* IpcEvents.BUILD */, serializeErrors(build));
