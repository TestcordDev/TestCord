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

import { serializeErrors, UpdateOutcome } from "./common";

const ROOT_DIR = existsSync(join(__dirname, "../../scripts/build/build.mjs"))
    ? join(__dirname, "../../")
    : existsSync(join(__dirname, "../scripts/build/build.mjs"))
        ? join(__dirname, "..")
        : __dirname;

const execFileRaw = promisify(cpExecFile);

const isFlatpak = process.platform === "linux" && !!process.env.FLATPAK_ID;

if (process.platform === "darwin") process.env.PATH = `/usr/local/bin:${process.env.PATH}`;

/**
 * git output can be arbitrarily large (a long `git log`, or a `fetch` printing
 * progress), and the default 1MB cap makes execFile reject with ENOBUFS
 * *after* the command already succeeded. that turns a working update into a
 * spurious failure, so give it plenty of headroom.
 */
const EXEC_OPTS = { cwd: ROOT_DIR, maxBuffer: 32 * 1024 * 1024 };

function execFile(file: string, args: string[], opts: Record<string, unknown> = {}) {
    return execFileRaw(file, args, { ...EXEC_OPTS, ...opts });
}

function git(...args: string[]) {
    if (isFlatpak) return execFile("flatpak-spawn", ["--host", "git", ...args]);
    else return execFile("git", args);
}

/**
 * serialise every git/build operation.
 *
 * these all mutate the same working tree and the same `dist/` output, and they
 * are triggered from five independent places (startup check, a 30 minute
 * interval, the updater tab, the tray menu, and the crash handler). running
 * them concurrently produces `index.lock` contention, and worse, a `git reset`
 * landing in the middle of an esbuild run so the client compiles a
 * half-updated tree straight into the asar it is running from.
 */
let queue: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const result = queue.then(fn, fn);
    // keep the chain alive regardless of this operation's outcome
    queue = result.then(
        () => undefined,
        () => undefined
    );
    return result;
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

/**
 * unit separator, so an author name or commit subject containing the old `/`
 * delimiter can no longer shift the parsed fields.
 */
const FIELD_SEP = "\x1f";

const COMMIT_FORMAT = `--pretty=format:%an${FIELD_SEP}%h${FIELD_SEP}%s`;

function parseCommits(stdout: string, decorate?: (message: string, i: number) => string) {
    const trimmed = stdout.trim();
    if (!trimmed) return [];

    return trimmed.split("\n").map((line, i) => {
        const [author, hash, ...rest] = line.split(FIELD_SEP);
        const message = rest.join(FIELD_SEP);
        return { hash, author, message: decorate?.(message, i) ?? message };
    });
}

/** true when the working tree has uncommitted changes. */
async function isDirty() {
    try {
        const res = await git("status", "--porcelain");
        return res.stdout.trim().length > 0;
    } catch {
        return false;
    }
}

/**
 * fetch the target branch. throws when the remote is unreachable, so callers
 * can tell "couldn't check" apart from "you're up to date" — conflating those
 * two is what made a failed check silently report a current version.
 */
async function fetchBranch(branch: string) {
    try {
        await git("fetch", "origin", branch, "--prune");
        return;
    } catch (originErr: any) {
        try {
            await git("fetch", "--all", "--prune");
            return;
        } catch {
            const reason =
                originErr?.stderr?.toString().trim() ||
                originErr?.message ||
                "network error";
            throw new Error(`Could not reach the remote to check for updates: ${reason}`);
        }
    }
}

async function remoteRefExists(branch: string) {
    try {
        await git("rev-parse", "--verify", `origin/${branch}`);
        return true;
    } catch {
        return false;
    }
}

/**
 * is HEAD an ancestor of the remote ref? when true the local copy is a strict
 * ancestor, so a fast-forward is safe. when false the local copy has commits
 * the remote doesn't, and updating means throwing that work away.
 */
async function canFastForward(branch: string) {
    try {
        await git("merge-base", "--is-ancestor", "HEAD", `origin/${branch}`);
        return true;
    } catch {
        return false;
    }
}

async function calculateGitChanges(branchOrEvent?: any, maybeBranch?: string) {
    const branch = extractBranch(branchOrEvent, maybeBranch);

    await withLock(() => fetchBranch(branch));

    if (!await remoteRefExists(branch))
        throw new Error(`The branch "${branch}" does not exist on the remote. Pick a different branch in the updater settings.`);

    const currentBranch = await getCurrentBranch();
    const headCommit = (await git("rev-parse", "HEAD")).stdout.trim();
    const remoteCommit = (await git("rev-parse", `origin/${branch}`)).stdout.trim();

    const upToDate = currentBranch === branch && headCommit === remoteCommit;
    if (upToDate) return { changes: [], diverged: false };

    // local commits the remote doesn't have, or uncommitted changes: a plain
    // update would destroy them, so flag it and let the caller ask first.
    const diverged = !(await canFastForward(branch)) || (await isDirty());

    let changes: ReturnType<typeof parseCommits> = [];
    try {
        const res = await git("log", `HEAD..origin/${branch}`, COMMIT_FORMAT);
        changes = parseCommits(res.stdout);
    } catch {
        changes = [];
    }

    // switching branches, or local-only commits: show the tip of the target
    // branch so the user can see what they would be moving to.
    if (!changes.length) {
        try {
            const res = await git("log", "-n", "5", `origin/${branch}`, COMMIT_FORMAT);
            changes = parseCommits(res.stdout, (message, i) =>
                currentBranch !== branch && i === 0
                    ? `Switch to ${branch} branch (current: ${currentBranch}): ${message}`
                    : message
            );
        } catch {
        }
    }

    return { changes, diverged };
}

async function pull(branchOrEvent?: any, maybeBranch?: string): Promise<UpdateOutcome> {
    const branch = extractBranch(branchOrEvent, maybeBranch);

    return withLock(async () => {
        await fetchBranch(branch);

        if (!await remoteRefExists(branch))
            throw new Error(`The branch "${branch}" does not exist on the remote. Pick a different branch in the updater settings.`);

        const currentBranch = await getCurrentBranch();

        // never silently discard local work. both of these paths used to
        // `reset --hard` / `checkout -f`, destroying commits the user never
        // agreed to lose, and then reported success.
        if (await isDirty() || !await canFastForward(branch)) return "diverged" as const;

        if (currentBranch !== branch) {
            // no -f: the tree is already known to be clean and fast-forwardable
            await git("checkout", "-B", branch, `origin/${branch}`);
            return "updated" as const;
        }

        const headBefore = (await git("rev-parse", "HEAD")).stdout.trim();

        // execFile already rejects on a non-zero exit, so success just means
        // "it didn't throw". the old code string-matched git's stdout
        // ("Fast-forward" / "Already up to date"), which returned false on any
        // non-English git and silently skipped the rebuild.
        await git("merge", "--ff-only", `origin/${branch}`);

        const headAfter = (await git("rev-parse", "HEAD")).stdout.trim();
        return headBefore === headAfter ? "upToDate" : "updated";
    });
}

async function forcePull(branchOrEvent?: any, maybeBranch?: string) {
    const branch = extractBranch(branchOrEvent, maybeBranch);

    return withLock(async () => {
        await fetchBranch(branch);

        if (!await remoteRefExists(branch))
            throw new Error(`The branch "${branch}" does not exist on the remote. Pick a different branch in the updater settings.`);

        await git("checkout", "-f", "-B", branch, `origin/${branch}`);
        await git("reset", "--hard", `origin/${branch}`);
        await git("clean", "-fd");
        return true;
    });
}

async function build() {
    return withLock(async () => {
        const command = isFlatpak ? "flatpak-spawn" : "node";
        const args = isFlatpak ? ["--host", "node", "scripts/build/build.mjs"] : ["scripts/build/build.mjs"];

        if (IS_DEV) args.push("--dev");

        // let this reject on a non-zero exit. the old code inspected stderr for
        // a "Build failed" string that no build script emits, so it always
        // reported success and a broken build looked like a good one.
        await execFile(command, args, { maxBuffer: 64 * 1024 * 1024 });

        return true;
    });
}

ipcMain.handle(IpcEvents.GET_REPO, serializeErrors(getRepo));
ipcMain.handle(IpcEvents.GET_UPDATES, serializeErrors(calculateGitChanges));
ipcMain.handle(IpcEvents.UPDATE, serializeErrors(pull));
ipcMain.handle(IpcEvents.FORCE_UPDATE, serializeErrors(forcePull));
ipcMain.handle(IpcEvents.BUILD, serializeErrors(build));
