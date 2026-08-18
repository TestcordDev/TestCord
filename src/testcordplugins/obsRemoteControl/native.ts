/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { exec, spawn } from "node:child_process";
import { dirname } from "node:path";
import { promisify } from "node:util";

import { RendererSettings } from "@main/settings";
import { IpcMainInvokeEvent } from "electron";

export async function getProcesses(_: IpcMainInvokeEvent): Promise<string | Error> {
    try {
        let cmd = "";
        switch (process.platform) {
            case "win32":
                cmd = "tasklist";
                break;
            case "linux":
                cmd = "ps -A";
                break;
            case "darwin":
                cmd = "ps -ax";
                break;
            default:
                return new Error("Unsupported platform");
        }

        const execAsync = promisify(exec);
        const { stdout, stderr } = await execAsync(cmd);
        if (stderr) {
            return new Error(stderr);
        }
        return stdout.trim();
    } catch (e) {
        if (e instanceof Error) {
            return e;
        }
        return new Error(JSON.stringify(e));
    }
}

export async function startProcess(_: IpcMainInvokeEvent): Promise<undefined | any> {
    // Path and args come from the plugin's own settings, never from the
    // renderer call — this IPC handler is reachable by any renderer script,
    // and the user-configured OBS launch is the only thing it may do.
    const settings = RendererSettings.store.plugins?.ObsRemoteControl;
    const path = settings?.appPath;
    const argString = settings?.arguments;
    if (typeof path !== "string" || !path || typeof argString !== "string") {
        return new Error("No OBS application path configured");
    }

    const args = argString
        .split(/(--[^\s]+="[^"]+")|"([^"]+)"|'([^']+)'|([^\s]+)/)
        .filter((e: string) => typeof e === "string" && e.trim());

    return new Promise(resolve => {
        try {
            const child = spawn(path, args, {
                cwd: dirname(path),
                detached: true
            });

            child.stderr?.on("data", data => {
                resolve(new Error(data));
                child.unref();
            });
            child.stdout?.on("data", () => {
                resolve(undefined);
                child.unref();
            });

            setTimeout(() => {
                resolve(new Error("Process took too long to start"));
            }, 10000);
        } catch (e) {
            resolve(e);
        }
    });
}
