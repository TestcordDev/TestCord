/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
export function createAndAppendStyle(id, target) {
    const style = document.createElement("style");
    style.id = id;
    target.append(style);
    return style;
}
export const classNameToSelector = (name, prefix = "") => name.split(" ").map(n => `.${prefix}${n}`).join("");
/**
 * @param prefix The prefix to add to each class, defaults to `""`
 * @returns A classname generator function
 * @example
 * const cl = classNameFactory("plugin-");
 *
 * cl("base", ["item", "editable"], { selected: null, disabled: true })
 * // => "plugin-base plugin-item plugin-editable plugin-disabled"
 */
export const classNameFactory = (prefix = "") => (...args) => {
    const classNames = new Set();
    for (const arg of args) {
        if (arg && typeof arg === "string")
            classNames.add(arg);
        else if (Array.isArray(arg))
            arg.forEach(name => classNames.add(name));
        else if (arg && typeof arg === "object")
            Object.entries(arg).forEach(([name, value]) => value && classNames.add(name));
    }
    return Array.from(classNames, name => prefix + name).join(" ");
};
