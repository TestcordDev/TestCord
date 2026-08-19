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
import { LazyComponent } from "@utils/react";
import { filters, lazyWebpackSearchHistory, waitFor } from "@webpack";
const logger = new Logger("Webpack");
export function waitForComponent(name, filter, fallbackValue = null) {
    if (IS_REPORTER)
        lazyWebpackSearchHistory.push(["waitForComponent", Array.isArray(filter) ? filter : [filter]]);
    let myValue = null;
    const lazyComponent = LazyComponent(() => {
        if (myValue)
            return myValue;
        const error = new Error(`Vencord could not find the ${name} Component`);
        logger.error(error);
        if (IS_DEV)
            throw error;
        return fallbackValue;
    });
    waitFor(filter, (v) => {
        myValue = v;
        Object.assign(lazyComponent, v);
    }, { isIndirect: true });
    return lazyComponent;
}
export function waitForStore(name, cb) {
    if (IS_REPORTER)
        lazyWebpackSearchHistory.push(["waitForStore", [name]]);
    waitFor(filters.byStoreName(name), cb, { isIndirect: true });
}
