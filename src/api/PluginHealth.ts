/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2026 Vendicated and contributors
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

/**
 * Lightweight, always-on tracker for plugin runtime health.
 *
 * Populated from the webpack patcher (`patchWebpack.ts`) and from any code
 * path that wants to report a plugin failure. Consumed by the Plugin Health
 * settings tab and the "Report Issue" flow.
 *
 * Kept intentionally small and dependency-free — this module runs early
 * during boot, before most of the codebase is initialised.
 */

export type PatchFailureKind = "noModule" | "noEffect" | "errored" | "undoingGroup";

export interface PatchFailure {
    kind: PatchFailureKind;
    /** The stringified regex or string that the patch was looking for */
    find: string;
    /** The stringified match that failed (only for noEffect / errored / undoingGroup) */
    match?: string;
    /** Serialized module id (for noEffect / errored / undoingGroup) */
    moduleId?: string;
    /** Truncated error message when kind === "errored" */
    error?: string;
    /** ms since epoch when the failure was recorded */
    at: number;
}

export interface RuntimeError {
    /** Where the error came from (e.g. "start", "stop", "flux:MESSAGE_CREATE") */
    source: string;
    /** Truncated error message */
    error: string;
    at: number;
}

interface PluginHealthEntry {
    patchFailures: PatchFailure[];
    runtimeErrors: RuntimeError[];
}

export type { PluginHealthEntry };

const MAX_ENTRIES_PER_PLUGIN = 50;
const MAX_ERROR_STRING_LENGTH = 2000;

const registry = new Map<string, PluginHealthEntry>();
const listeners = new Set<() => void>();

function truncate(value: string): string {
    if (value.length <= MAX_ERROR_STRING_LENGTH) return value;
    return value.slice(0, MAX_ERROR_STRING_LENGTH) + "\n… (truncated)";
}

function ensureEntry(plugin: string): PluginHealthEntry {
    let entry = registry.get(plugin);
    if (!entry) {
        entry = { patchFailures: [], runtimeErrors: [] };
        registry.set(plugin, entry);
    }
    return entry;
}

function push<T>(list: T[], value: T) {
    list.push(value);
    if (list.length > MAX_ENTRIES_PER_PLUGIN) list.shift();
}

function notify() {
    for (const listener of listeners) {
        try {
            listener();
        } catch {
            // Ignore listener errors; a broken UI subscriber must not break the tracker.
        }
    }
}

export const PluginHealth = {
    /**
     * Record a webpack patch failure for a plugin.
     *
     * Called from `patchWebpack.ts`. Safe to call as often as needed — entries
     * are capped per plugin and duplicates are collapsed by `find`+`match`+`kind`.
     */
    recordPatchFailure(plugin: string, failure: Omit<PatchFailure, "at">) {
        if (!plugin) return;
        const entry = ensureEntry(plugin);

        // Collapse duplicate failures: patches can fail across many modules and
        // we do not want to blow up the ring buffer with the same message.
        const duplicate = entry.patchFailures.find(f =>
            f.kind === failure.kind
            && f.find === failure.find
            && f.match === failure.match
        );
        if (duplicate) {
            duplicate.at = Date.now();
            if (failure.moduleId && duplicate.moduleId !== failure.moduleId) {
                // Track the most recent module id we saw the failure on.
                duplicate.moduleId = failure.moduleId;
            }
            notify();
            return;
        }

        push(entry.patchFailures, {
            ...failure,
            error: failure.error ? truncate(failure.error) : undefined,
            at: Date.now()
        });
        notify();
    },

    /**
     * Record a runtime error thrown from a plugin's lifecycle or event handlers.
     */
    recordRuntimeError(plugin: string, source: string, error: unknown) {
        if (!plugin) return;
        const entry = ensureEntry(plugin);
        const message = error instanceof Error
            ? `${error.name}: ${error.message}\n${error.stack ?? ""}`
            : String(error);
        push(entry.runtimeErrors, {
            source,
            error: truncate(message),
            at: Date.now()
        });
        notify();
    },

    /** Get a snapshot of a plugin's health entry, or `undefined` if the plugin is healthy. */
    get(plugin: string): PluginHealthEntry | undefined {
        const entry = registry.get(plugin);
        if (!entry) return undefined;
        if (!entry.patchFailures.length && !entry.runtimeErrors.length) return undefined;
        return {
            patchFailures: [...entry.patchFailures],
            runtimeErrors: [...entry.runtimeErrors]
        };
    },

    /** Get a snapshot of every plugin that has recorded a failure. */
    getAll(): ReadonlyMap<string, PluginHealthEntry> {
        const snapshot = new Map<string, PluginHealthEntry>();
        for (const [name, entry] of registry) {
            if (entry.patchFailures.length || entry.runtimeErrors.length) {
                snapshot.set(name, {
                    patchFailures: [...entry.patchFailures],
                    runtimeErrors: [...entry.runtimeErrors]
                });
            }
        }
        return snapshot;
    },

    /** Whether the given plugin has any recorded issues. */
    hasIssues(plugin: string): boolean {
        const entry = registry.get(plugin);
        return !!entry && (entry.patchFailures.length > 0 || entry.runtimeErrors.length > 0);
    },

    /** Total number of plugins with recorded issues. */
    totalUnhealthyPlugins(): number {
        let count = 0;
        for (const entry of registry.values()) {
            if (entry.patchFailures.length || entry.runtimeErrors.length) count++;
        }
        return count;
    },

    /** Clear all recorded failures for a plugin. Useful after a restart / re-patch. */
    clear(plugin: string) {
        if (registry.delete(plugin)) notify();
    },

    /** Clear everything. */
    clearAll() {
        if (registry.size === 0) return;
        registry.clear();
        notify();
    },

    /** Subscribe to changes. Returns an unsubscribe function. */
    subscribe(listener: () => void): () => void {
        listeners.add(listener);
        return () => listeners.delete(listener);
    }
};

// Expose on the global Vencord object so it can be inspected from the console
// and consumed by external tools like the reporter without a static import cycle.
if (typeof globalThis !== "undefined") {
    (globalThis as any).__pluginHealth = PluginHealth;
}
