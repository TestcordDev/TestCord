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
import ErrorBoundary from "@components/ErrorBoundary";
const componentsIn = new Map();
const componentsAbove = new Map();
const componentsBelow = new Map();
function getRenderMap(position) {
    switch (position) {
        case 0 /* ServerListRenderPosition.Above */:
            return componentsAbove;
        case 1 /* ServerListRenderPosition.In */:
            return componentsIn;
        case 2 /* ServerListRenderPosition.Below */:
            return componentsBelow;
    }
}
export function addServerListElement(position, renderFunction, priority = 0) {
    getRenderMap(position).set(renderFunction, priority);
}
export function removeServerListElement(position, renderFunction) {
    getRenderMap(position).delete(renderFunction);
}
export const renderAll = (position) => {
    return Array.from(getRenderMap(position).entries())
        .sort((a, b) => b[1] - a[1])
        .map(([Component], i) => (<ErrorBoundary noop key={i}>
                <Component />
            </ErrorBoundary>));
};
