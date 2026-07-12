/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
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

import { Logger } from "@utils/Logger";
import { Menu, React } from "@webpack/common";
import type { ReactElement } from "react";

/**
 * @param children The rendered context menu elements
 * @param args Any arguments passed into making the context menu, like the guild, channel, user or message for example
 */
export type NavContextMenuPatchCallback = (children: Array<ReactElement<any> | null>, ...args: Array<any>) => void;
/**
 * @param navId The navId of the context menu being patched
 * @param children The rendered context menu elements
 * @param args Any arguments passed into making the context menu, like the guild, channel, user or message for example
 */
export type GlobalContextMenuPatchCallback = (navId: string, children: Array<ReactElement<any> | null>, ...args: Array<any>) => void;

const ContextMenuLogger = new Logger("ContextMenu");

export const navPatches = new Map<string, Set<NavContextMenuPatchCallback>>();
export const globalPatches = new Set<GlobalContextMenuPatchCallback>();

interface MenuCacheEntry {
    children: Array<ReactElement<any> | null>;
    timestamp: number;
}

const menuCache = new Map<string, MenuCacheEntry>();
/** How long a patched menu stays reusable for the same target. */
const CACHE_TTL = 8_000;
/** Cap shared cache entries so right-clicking many different targets still helps. */
const CACHE_MAX = 64;
/** Log individual patches slower than this (ms). Only when IS_DEV. */
const SLOW_PATCH_MS = 2;
/** Log total patch pass slower than this (ms). Only when IS_DEV. */
const SLOW_TOTAL_MS = 8;

interface ArgsSignature {
    /** Cache key segment for this menu open. */
    key: string;
    /** False when args lack stable ids — skip shared menuCache (mount memo still applies). */
    cacheable: boolean;
}

function extractStableId(a: any): string | null {
    if (a == null) return null;
    if (typeof a !== "object") return String(a);

    const id =
        a.id ??
        a.user?.id ??
        a.userId ??
        a.message?.id ??
        a.messageId ??
        a.channel?.id ??
        a.channelId ??
        a.guild?.id ??
        a.guildId ??
        a.role?.id ??
        a.roleId ??
        a.emoji?.id ??
        a.sticker?.id ??
        a.target?.id ??
        a.item?.id ??
        a.attachment?.id ??
        a.sound?.soundId ??
        a.soundId;

    return id != null ? String(id) : null;
}

function getArgsSignature(args: Array<any>): ArgsSignature {
    const parts: string[] = [];
    let cacheable = true;

    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a == null) {
            parts.push("n");
            continue;
        }
        if (typeof a !== "object") {
            parts.push(String(a));
            continue;
        }

        const id = extractStableId(a);
        if (id != null) {
            parts.push(id);
            continue;
        }

        // No stable id: don't poison the shared cache with random keys.
        // Mount-level memoization still avoids re-patching on re-renders.
        cacheable = false;
        const keys = Object.keys(a).slice(0, 6).join(".");
        parts.push(`o${i}:${a.constructor?.name ?? "Object"}:${keys}`);
    }

    return { key: parts.join(","), cacheable };
}

function readMenuCache(fullKey: string): Array<ReactElement<any> | null> | null {
    const entry = menuCache.get(fullKey);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > CACHE_TTL) {
        menuCache.delete(fullKey);
        return null;
    }
    return entry.children;
}

function writeMenuCache(fullKey: string, children: Array<ReactElement<any> | null>) {
    if (menuCache.size >= CACHE_MAX) {
        let oldestKey: string | null = null;
        let oldestTime = Infinity;
        for (const [k, v] of menuCache) {
            if (v.timestamp < oldestTime) {
                oldestTime = v.timestamp;
                oldestKey = k;
            }
        }
        if (oldestKey) menuCache.delete(oldestKey);
    }
    menuCache.set(fullKey, { children, timestamp: Date.now() });
}
/**
 * Add a context menu patch
 * @param navId The navId(s) for the context menu(s) to patch
 * @param patch The patch to be applied
 */
export function addContextMenuPatch(navId: string | Array<string>, patch: NavContextMenuPatchCallback) {
    if (!Array.isArray(navId)) navId = [navId];
    for (const id of navId) {
        let contextMenuPatches = navPatches.get(id);
        if (!contextMenuPatches) {
            contextMenuPatches = new Set();
            navPatches.set(id, contextMenuPatches);
        }

        contextMenuPatches.add(patch);
    }
}

/**
 * Add a global context menu patch that fires the patch for all context menus
 * @param patch The patch to be applied
 */
export function addGlobalContextMenuPatch(patch: GlobalContextMenuPatchCallback) {
    globalPatches.add(patch);
}

/**
 * Remove a context menu patch
 * @param navId The navId(s) for the context menu(s) to remove the patch
 * @param patch The patch to be removed
 * @returns Whether the patch was successfully removed from the context menu(s)
 */
export function removeContextMenuPatch<T extends string | Array<string>>(navId: T, patch: NavContextMenuPatchCallback): T extends string ? boolean : Array<boolean> {
    const navIds: string[] = Array.isArray(navId) ? navId : [navId];

    const results = navIds.map(id => navPatches.get(id)?.delete(patch) ?? false);

    return (Array.isArray(navId) ? results : results[0]) as T extends string ? boolean : Array<boolean>;
}

/**
 * Remove a global context menu patch
 * @param patch The patch to be removed
 * @returns Whether the patch was successfully removed
 */
export function removeGlobalContextMenuPatch(patch: GlobalContextMenuPatchCallback): boolean {
    return globalPatches.delete(patch);
}

let findCacheChildren: Array<ReactElement<any> | null> | null = null;
let findCache: Map<string, Array<ReactElement<any> | null | undefined> | null> | null = null;

/**
 * A helper function for finding the children array of a group nested inside a context menu based on the id(s) of its children
 * @param id The id of the child. If an array is specified, all ids will be tried
 * @param children The context menu children
 * @param matchSubstring Whether to check if the id is a substring of the child id
 */
export function findGroupChildrenByChildId(id: string | string[], children: Array<ReactElement<any> | null | undefined>, matchSubstring = false): Array<ReactElement<any> | null | undefined> | null {
    if (findCache && children === findCacheChildren) {
        const key = `${matchSubstring ? "substring" : "exact"}\0${Array.isArray(id) ? id.join("\0") : id}`;
        if (findCache.has(key)) {
            return findCache.get(key) ?? null;
        }
        const result = findGroupChildrenByChildIdImpl(id, children, matchSubstring);
        findCache.set(key, result);
        return result;
    }
    return findGroupChildrenByChildIdImpl(id, children, matchSubstring);
}

function findGroupChildrenByChildIdImpl(id: string | string[], children: Array<ReactElement<any> | null | undefined>, matchSubstring = false): Array<ReactElement<any> | null | undefined> | null {
    for (const child of children) {
        if (child == null) continue;

        if (Array.isArray(child)) {
            const found = findGroupChildrenByChildIdImpl(id, child, matchSubstring);
            if (found !== null) return found;
        }

        if (
            (Array.isArray(id) && id.some(id => matchSubstring ? child.props?.id?.includes(id) : child.props?.id === id))
            || (matchSubstring ? child.props?.id?.includes(id) : child.props?.id === id)
        ) return children;

        let nextChildren = child.props?.children;
        if (nextChildren) {
            if (!Array.isArray(nextChildren)) {
                nextChildren = [nextChildren];
                child.props.children = nextChildren;
            }

            const found = findGroupChildrenByChildIdImpl(id, nextChildren, matchSubstring);
            if (found !== null) return found;
        }
    }

    return null;
}

interface ContextMenuProps {
    contextMenuAPIArguments?: Array<any>;
    navId: string;
    children: Array<ReactElement<any> | null>;
    "aria-label": string;
    onSelect: (() => void) | undefined;
    onClose: (callback: (...args: Array<any>) => any) => void;
}

interface MountPatchState {
    fullKey: string;
    patchedChildren: Array<ReactElement<any> | null> | null;
    /** True once deferred work for fullKey has been scheduled or completed. */
    scheduled: boolean;
}

function normalizeChildren(children: ContextMenuProps["children"]): Array<ReactElement<any> | null> {
    return Array.isArray(children) ? children : [children];
}

function applyAllPatches(
    navId: string,
    sourceChildren: ContextMenuProps["children"],
    args: Array<any>
): Array<ReactElement<any> | null> {
    const contextMenuPatches = navPatches.get(navId);
    const hasPatches = (contextMenuPatches?.size ?? 0) > 0 || globalPatches.size > 0;

    let children = hasPatches
        ? cloneMenuChildren(sourceChildren)
        : sourceChildren;

    if (!Array.isArray(children)) children = [children];

    if (!hasPatches) return children;

    const timed = typeof IS_DEV !== "undefined" && IS_DEV;
    const totalStart = timed ? performance.now() : 0;
    const slowPatches: string[] = [];

    findCacheChildren = children;
    findCache = new Map();
    try {
        if (contextMenuPatches?.size) {
            let i = 0;
            for (const patch of contextMenuPatches) {
                const t0 = timed ? performance.now() : 0;
                try {
                    patch(children, ...args);
                } catch (err) {
                    ContextMenuLogger.error(`Patch for ${navId} errored,`, err);
                }
                if (timed) {
                    const dt = performance.now() - t0;
                    if (dt >= SLOW_PATCH_MS) slowPatches.push(`nav#${i}=${dt.toFixed(1)}ms`);
                }
                i++;
            }
        }

        if (globalPatches.size) {
            let i = 0;
            for (const patch of globalPatches) {
                const t0 = timed ? performance.now() : 0;
                try {
                    patch(navId, children, ...args);
                } catch (err) {
                    ContextMenuLogger.error("Global patch errored,", err);
                }
                if (timed) {
                    const dt = performance.now() - t0;
                    if (dt >= SLOW_PATCH_MS) slowPatches.push(`global#${i}=${dt.toFixed(1)}ms`);
                }
                i++;
            }
        }
    } finally {
        findCache = null;
        findCacheChildren = null;
    }

    if (timed) {
        const total = performance.now() - totalStart;
        if (total >= SLOW_TOTAL_MS || slowPatches.length) {
            ContextMenuLogger.debug(
                `Patched ${navId} in ${total.toFixed(1)}ms` +
                (slowPatches.length ? ` [${slowPatches.join(", ")}]` : "") +
                ` (nav=${contextMenuPatches?.size ?? 0}, global=${globalPatches.size})`
            );
        }
    }

    return children;
}

/**
 * Patches context menu children for plugin items.
 *
 * Fast path: shared cache hit or already-computed mount result → return immediately.
 * Slow path: paint Discord's stock menu first, then apply plugin patches after paint
 * (useEffect) so right-click feels instant even with dozens of enabled menu plugins.
 */
export function _usePatchContextMenu(props: ContextMenuProps) {
    // Hooks must run unconditionally (before any early return).
    const mountRef = React.useRef<MountPatchState>({
        fullKey: "",
        patchedChildren: null,
        scheduled: false,
    });
    const [, forceRender] = React.useReducer((n: number) => n + 1, 0);

    props.contextMenuAPIArguments ??= [];
    const args = props.contextMenuAPIArguments;
    const { key: argsKey, cacheable } = getArgsSignature(args);
    const fullKey = props.navId + ":" + argsKey;

    const contextMenuPatches = navPatches.get(props.navId);
    const hasPatches = (contextMenuPatches?.size ?? 0) > 0 || globalPatches.size > 0;

    // Reset mount memo when Discord opens a different menu target in the same component instance.
    if (mountRef.current.fullKey !== fullKey) {
        mountRef.current = { fullKey, patchedChildren: null, scheduled: false };
    }

    // Defer plugin patches until after first paint when work is needed.
    // useEffect runs after paint, so the stock Discord menu appears immediately.
    React.useEffect(() => {
        if (!Menu.MenuItem) return;
        if (!hasPatches) return;
        if (mountRef.current.fullKey === fullKey && mountRef.current.patchedChildren) return;
        if (mountRef.current.fullKey === fullKey && mountRef.current.scheduled) return;

        mountRef.current.scheduled = true;
        let cancelled = false;

        try {
            const patched = applyAllPatches(props.navId, props.children, args);
            if (cancelled) {
                // Effect was cleaned up (Strict Mode / unmount); allow a later effect to retry.
                if (mountRef.current.fullKey === fullKey) {
                    mountRef.current.scheduled = false;
                }
                return;
            }

            mountRef.current = {
                fullKey,
                patchedChildren: patched,
                scheduled: true,
            };

            if (cacheable) writeMenuCache(fullKey, patched);
            forceRender();
        } catch (err) {
            if (mountRef.current.fullKey === fullKey) {
                mountRef.current.scheduled = false;
            }
            ContextMenuLogger.error(`Deferred patch for ${props.navId} failed,`, err);
        }

        return () => {
            cancelled = true;
        };
        // fullKey captures navId + stable args identity. Children/args come from this open's render.
        // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: re-run only when menu identity changes
    }, [fullKey, hasPatches]);

    if (!Menu.MenuItem) return props; // Prevent crashes if menu items failed to resolve

    // Already patched on this mount (after deferred pass or sync path).
    if (mountRef.current.patchedChildren && mountRef.current.fullKey === fullKey) {
        return { ...props, children: mountRef.current.patchedChildren };
    }

    // Shared cache hit — show full plugin menu immediately, no flash.
    if (hasPatches && cacheable) {
        const cached = readMenuCache(fullKey);
        if (cached) {
            mountRef.current = { fullKey, patchedChildren: cached, scheduled: true };
            return { ...props, children: cached };
        }
    }

    // No plugin patches: normalize and return.
    if (!hasPatches) {
        const children = normalizeChildren(props.children);
        mountRef.current = { fullKey, patchedChildren: children, scheduled: true };
        return { ...props, children };
    }

    // First paint: stock Discord menu only. Plugin rows appear on the next frame.
    return { ...props, children: normalizeChildren(props.children) };
}

function cloneMenuChildren(obj: ReactElement<any> | Array<ReactElement<any> | null> | null) {
    if (Array.isArray(obj)) {
        return obj.map(cloneMenuChildren);
    }

    if (React.isValidElement(obj)) {
        obj = React.cloneElement(obj);

        if (
            obj?.props?.children &&
            (obj.type !== Menu.MenuControlItem || obj.type === Menu.MenuControlItem && obj.props.control != null)
        ) {
            obj.props.children = cloneMenuChildren(obj.props.children);
        }
    }

    return obj;
}
