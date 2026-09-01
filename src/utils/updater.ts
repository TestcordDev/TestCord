/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Settings } from "@api/Settings";

import { Logger } from "./Logger";
import { relaunch } from "./native";
import { IpcRes } from "./types";

export const UpdateLogger = /* #__PURE__*/ new Logger("Updater", "white");
export let isOutdated = false;
export let isNewer = false;
export let updateError: any;
export let changes: Record<"hash" | "author" | "message", string>[];

async function Unwrap<T>(p: Promise<IpcRes<T>>) {
    const res = await p;

    if (res.ok) return res.value;

    updateError = res.error;
    throw res.error;
}

export async function checkForUpdates(branch?: string) {
    const targetBranch = branch ?? Settings.updaterBranch;
    changes = await Unwrap(VencordNative.updater.getUpdates(targetBranch));
    isNewer = false;
    return (isOutdated = (changes?.length ?? 0) > 0);
}

export async function update(branch?: string) {
    if (!isOutdated) return true;

    const targetBranch = branch ?? Settings.updaterBranch;
    const res = await Unwrap(VencordNative.updater.update(targetBranch));

    if (res) {
        isOutdated = false;
        if (!await Unwrap(VencordNative.updater.rebuild()))
            throw new Error("The Build failed. Please try manually building the new update");
    }

    return res;
}

export async function forceUpdate(branch?: string) {
    const targetBranch = branch ?? Settings.updaterBranch;
    const res = await Unwrap(VencordNative.updater.forceUpdate(targetBranch));

    if (res) {
        isOutdated = false;
        if (!await Unwrap(VencordNative.updater.rebuild()))
            throw new Error("The Build failed. Please try manually building the new update");
    }

    return res;
}

export const getRepo = () => Unwrap(VencordNative.updater.getRepo());

export async function maybePromptToUpdate(confirmMessage: string, checkForDev = false) {
    if (IS_WEB || IS_UPDATER_DISABLED) return;
    if (checkForDev && IS_DEV) return;

    try {
        const isOutdated = await checkForUpdates();
        if (isOutdated) {
            const wantsUpdate = confirm(confirmMessage);
            if (wantsUpdate && isNewer) return alert("Your local copy has more recent commits. Please stash or reset them.");
            if (wantsUpdate) {
                await update();
                relaunch();
            }
        }
    } catch (err) {
        UpdateLogger.error(err);
        alert("That also failed :( Try updating or re-installing with the installer!");
    }
}
