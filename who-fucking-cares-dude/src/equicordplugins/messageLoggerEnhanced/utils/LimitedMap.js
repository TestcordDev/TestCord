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
import { settings } from "../index";
export class LimitedMap {
    map = new Map();
    constructor() { }
    set(key, value) {
        if (settings.store.cacheLimit > 0 && this.map.size >= settings.store.cacheLimit) {
            // delete the first entry
            this.map.delete(this.map.keys().next().value);
        }
        this.map.set(key, value);
    }
    get(key) {
        return this.map.get(key);
    }
    delete(key) {
        return this.map.delete(key);
    }
    clear() {
        this.map.clear();
    }
}
