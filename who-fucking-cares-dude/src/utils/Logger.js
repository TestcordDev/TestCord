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
export class Logger {
    name;
    color;
    /**
     * Returns the console format args for a title with the specified background colour and black text
     * @param color Background colour
     * @param title Text
     * @returns Array. Destructure this into {@link Logger}.errorCustomFmt or console.log
     *
     * @example logger.errorCustomFmt(...Logger.makeTitleElements("white", "Hello"), "World");
     */
    static makeTitle(color, title) {
        return ["%c %c %s ", "", `background: ${color}; color: black; font-weight: bold; border-radius: 5px;`, title];
    }
    constructor(name, color = "white") {
        this.name = name;
        this.color = color;
    }
    _log(level, levelColor, args, customFmt = "") {
        if (IS_REPORTER && IS_WEB && !IS_VESKTOP && !IS_EQUIBOP) {
            console[level]("[Testcord]", this.name + ":", ...args);
            return;
        }
        console[level](`%c Testcord %c %c ${this.name} ${customFmt}`, `background: ${levelColor}; color: black; font-weight: bold; border-radius: 5px;`, "", `background: ${this.color}; color: black; font-weight: bold; border-radius: 5px;`, ...args);
    }
    log(...args) {
        this._log("log", "#a6d189", args);
    }
    info(...args) {
        this._log("info", "#a6d189", args);
    }
    error(...args) {
        this._log("error", "#e78284", args);
    }
    errorCustomFmt(fmt, ...args) {
        this._log("error", "#e78284", args, fmt);
    }
    warn(...args) {
        this._log("warn", "#e5c890", args);
    }
    debug(...args) {
        this._log("debug", "#eebebe", args);
    }
}
