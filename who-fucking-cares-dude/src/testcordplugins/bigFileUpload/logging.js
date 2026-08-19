/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Logger } from "@utils/Logger";
const levelPriority = {
    errors: 0,
    info: 1,
    debug: 2
};
let levelProvider = () => "errors";
export function setLoggingLevelProvider(provider) {
    levelProvider = provider;
}
const baseLogger = new Logger("BigFileUpload", "#8caaee");
function shouldLog(level) {
    const current = levelProvider();
    return levelPriority[current] >= levelPriority[level];
}
export const pluginLogger = {
    info: (...args) => {
        if (shouldLog("info"))
            baseLogger.info(...args);
    },
    debug: (...args) => {
        if (shouldLog("debug"))
            baseLogger.log("[debug]", ...args);
    },
    warn: (...args) => {
        // Warnings shown at info level or above (not on "errors only" mode)
        if (shouldLog("info"))
            baseLogger.warn(...args);
    },
    error: (...args) => {
        baseLogger.error(...args);
    }
};
