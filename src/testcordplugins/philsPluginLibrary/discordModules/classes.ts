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

import { findByPropsLazy } from "@webpack";

import * as types from "../../philsPluginLibrary/types";

/**
 * Discord reshuffled this module. As of build 621499 `buttonContents` and `buttonColor` no
 * longer exist at all, so `findByPropsLazy("button", "buttonContents", "buttonColor")` no
 * longer matches. The nasty part is that a failed lazy lookup does not return `undefined`:
 * it returns a proxy that *throws* on first property access. Every `panelClasses.x` read
 * therefore threw and the plugin's settings panel failed to render.
 *
 * So: try shapes that are actually present, prove the proxy matched by touching it, and
 * always hand back a plain object. Consumers only feed these into `classes()` or
 * `className`, both of which tolerate `undefined`.
 */
const PANEL_CLASS_SHAPES: string[][] = [
    ["button", "buttonContents", "buttonColor"],
    ["container", "button"]
];

let resolved: Partial<types.PanelClasses> | null = null;

function resolvePanelClasses(): Partial<types.PanelClasses> {
    if (resolved) return resolved;

    for (const shape of PANEL_CLASS_SHAPES) {
        try {
            const candidate = findByPropsLazy(...shape);
            // Reading a property is what throws when the lookup matched nothing.
            void candidate.button;
            resolved = { ...candidate } as Partial<types.PanelClasses>;
            return resolved;
        } catch { /* this shape is absent in the current build */ }
    }

    resolved = {};
    return resolved;
}

/**
 * Safe, lazily-resolved view of Discord's panel classes. Resolution is deferred to first
 * use so it happens after webpack is ready, and an unresolved build yields `undefined`
 * rather than a thrown proxy.
 */
export const panelClasses = new Proxy({} as Partial<types.PanelClasses>, {
    get: (_target, prop: string) => {
        if (typeof prop !== "string") return undefined;
        return resolvePanelClasses()[prop as keyof types.PanelClasses];
    }
});
