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
import { runtimeHashMessageKey } from "./intlHash";
export function canonicalizeMatch(match) {
    let partialCanon = typeof match === "string" ? match : match.source;
    partialCanon = partialCanon.replaceAll(/#{intl::([\w$+/]*)(?:::(\w+))?}/g, (_, key, modifier) => {
        const isString = typeof match === "string";
        const hashed = modifier === "raw" ? key : runtimeHashMessageKey(key);
        if (modifier === "hash")
            return isString ? hashed : String.raw `(?:${hashed})`.replaceAll("+", "\\+");
        const hasSpecialChars = !Number.isNaN(Number(hashed[0])) || hashed.includes("+") || hashed.includes("/");
        if (hasSpecialChars) {
            return isString
                ? `["${hashed}"]`
                : String.raw `(?:\["${hashed}"\])`.replaceAll("+", "\\+");
        }
        return isString ? `.${hashed}` : String.raw `(?:\.${hashed})`;
    });
    if (typeof match === "string") {
        return partialCanon;
    }
    const canonSource = partialCanon.replaceAll(/(\\*)\\i/g, (match, leadingEscapes) => leadingEscapes.length % 2 === 0
        ? `${leadingEscapes}${String.raw `(?:[A-Za-z_$][\w$]*)`}`
        : match.slice(1));
    const canonRegex = new RegExp(canonSource, match.flags);
    canonRegex.toString = match.toString.bind(match);
    return canonRegex;
}
export function canonicalizeReplace(replace, pluginPath) {
    if (typeof replace !== "function")
        return replace.replaceAll("$self", pluginPath);
    return ((...args) => replace(...args).replaceAll("$self", pluginPath));
}
export function canonicalizeDescriptor(descriptor, canonicalize) {
    if (descriptor.get) {
        const original = descriptor.get;
        descriptor.get = function () {
            return canonicalize(original.call(this));
        };
    }
    else if (descriptor.value) {
        descriptor.value = canonicalize(descriptor.value);
    }
    return descriptor;
}
export function canonicalizeReplacement(replacement, pluginPath) {
    const descriptors = Object.getOwnPropertyDescriptors(replacement);
    descriptors.match = canonicalizeDescriptor(descriptors.match, canonicalizeMatch);
    descriptors.replace = canonicalizeDescriptor(descriptors.replace, replace => canonicalizeReplace(replace, pluginPath));
    Object.defineProperties(replacement, descriptors);
}
export function canonicalizeFind(patch) {
    const descriptors = Object.getOwnPropertyDescriptors(patch);
    descriptors.find = canonicalizeDescriptor(descriptors.find, canonicalizeMatch);
    Object.defineProperties(patch, descriptors);
}
