/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Settings } from "@api/Settings";
import type { UpdateCommit } from "@main/updater/common";

import { Logger } from "./Logger";
import { relaunch } from "./native";
import { IpcRes } from "./types";

export const UpdateLogger = /* #__PURE__*/ new Logger("Updater", "white");
export let isOutdated = false;
export let isNewer = false;
export let updateError: any;
export let changes: UpdateCommit[];

async function Unwrap<T>(p: Promise<IpcRes<T>>) {
    const res = await p;

    if (res.ok) {
        // only a fresh failure should surface. updateError used to be
        // write-only, so a single transient failure (offline, a git lock) left
        // the error card on screen for the rest of the session.
        updateError = undefined;
        return res.value;
    }

    updateError = res.error;
    throw res.error;
}

export async function checkForUpdates(branch?: string) {
    const targetBranch = branch ?? Settings.updaterBranch;
    const result = await Unwrap(VencordNative.updater.getUpdates(targetBranch));

    changes = result.changes;
    isNewer = result.diverged;
    return (isOutdated = (changes?.length ?? 0) > 0);
}

/** true when a plain update would destroy local commits or uncommitted work. */
export function hasDiverged() {
    return isNewer;
}

async function finishUpdate() {
    // only clear isOutdated once the new code has actually been built. the
    // old order cleared it *before* rebuilding, so any build failure left the
    // working tree on the new commit with stale dist output and the updater
    // reporting "you're on the latest version" forever.
    if (!await Unwrap(VencordNative.updater.rebuild()))
        throw new Error("The Build failed. Please try manually building the new update");

    isOutdated = false;
    isNewer = false;
    return true;
}

export async function update(branch?: string) {
    if (!isOutdated) return true;

    const targetBranch = branch ?? Settings.updaterBranch;
    const outcome = await Unwrap(VencordNative.updater.update(targetBranch));

    if (outcome === "diverged") {
        // local commits or uncommitted changes. the main process deliberately
        // did not touch the working tree, so route the user through the
        // explicit discard flow instead of silently resetting.
        isNewer = true;
        return false;
    }

    return finishUpdate();
}

export async function forceUpdate(branch?: string) {
    const targetBranch = branch ?? Settings.updaterBranch;
    await Unwrap(VencordNative.updater.forceUpdate(targetBranch));

    return finishUpdate();
}

export const getRepo = () => Unwrap(VencordNative.updater.getRepo());

export async function maybePromptToUpdate(confirmMessage: string, checkForDev = false) {
    if (IS_WEB || IS_UPDATER_DISABLED) return;
    if (checkForDev && IS_DEV) return;

    try {
        if (!await checkForUpdates()) return;

        if (!confirm(confirmMessage)) return;

        if (isNewer) {
            alert("Your local copy has changes that aren't on the remote. Stash or reset them before updating, or use the Discard Local Changes button in the updater settings.");
            return;
        }

        // don't relaunch when the update bailed out (diverged or build failed)
        if (await update()) relaunch();
    } catch (err) {
        UpdateLogger.error(err);
        alert("That also failed :( Try updating or re-installing with the installer!");
    }
}
