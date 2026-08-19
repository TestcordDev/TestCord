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
import { UserStore } from "@webpack/common";
export const createDummyUser = (props) => new (UserStore.getCurrentUser().constructor)(props);
export const openURL = (url) => VencordNative.native.openExternal(url);
export const validateNumberInput = (value) => parseInt(value) ? parseInt(value) : undefined;
export const validateTextInputNumber = (value) => /^[0-9\b]+$/.test(value) || value === "";
export const replaceObjectValuesIfExist = (target, replace) => Object.entries(target).forEach(([key, value]) => replace[key] && (target[key] = replace[key]));
