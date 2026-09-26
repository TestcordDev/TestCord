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

export const ASAR_FILE = IS_VESKTOP ? "vesktop.asar" : IS_EQUIBOP ? "equibop.asar" : "desktop.asar";

/**
 * outcome of an update attempt.
 *
 * - `updated`: working tree now matches the remote, and the client must be
 *   rebuilt before the new code takes effect.
 * - `upToDate`: already on the remote commit, nothing to pull.
 * - `diverged`: the local copy has commits the remote doesn't (or the working
 *   tree is dirty in a way that blocks switching branches). updating would
 *   destroy local work, so the caller must ask the user first.
 */
export type UpdateOutcome = "updated" | "upToDate" | "diverged";

/** a single commit, as shown in the updater's changelog list */
export interface UpdateCommit {
    hash: string;
    author: string;
    message: string;
}

/**
 * result of an update check.
 *
 * `diverged` means the local copy has commits or uncommitted changes the
 * remote doesn't, so a plain update would destroy them.
 */
export interface UpdateCheckResult {
    changes: UpdateCommit[];
    diverged: boolean;
}

export function serializeErrors(func: (...args: any[]) => any) {
    return async function () {
        try {
            return {
                ok: true,
                value: await func(...arguments)
            };
        } catch (e: any) {
            return {
                ok: false,
                error: e instanceof Error ? {
                    // prototypes get lost, so turn error into plain object
                    ...e,
                    message: e.message,
                    name: e.name,
                    stack: e.stack
                } : e
            };
        }
    };
}
