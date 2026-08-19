/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { showNotification } from "@api/Notifications";
import { Logger } from "@utils/Logger";
import { NavigationRouter } from "@webpack/common/utils";
import { normalizeQuestName } from "./filtering";
import { QUEST_PAGE } from "./ui";
const LOG = new Logger("Questify");
export function getFormattedNow() {
    return new Date().toLocaleString(undefined, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
    }).replace(",", "");
}
function getQuestifyLogPrefix(source) {
    return `[${getFormattedNow()}] [${source}]\n`;
}
function emitQuestifyLog(level, source, ...args) {
    const prefix = args.length ? getQuestifyLogPrefix(source) : getQuestifyLogPrefix(source).trim();
    switch (level) {
        case "debug":
            LOG.debug(prefix, ...args);
            return;
        case "error":
            LOG.error(prefix, ...args);
            return;
        case "info":
            LOG.info(prefix, ...args);
            return;
        case "warn":
            LOG.warn(prefix, ...args);
            return;
        default:
            LOG.log(prefix, ...args);
            return;
    }
}
export const QL = {
    log(source, ...args) { emitQuestifyLog("log", source, ...args); },
    info(source, ...args) { emitQuestifyLog("info", source, ...args); },
    warn(source, ...args) { emitQuestifyLog("warn", source, ...args); },
    error(source, ...args) { emitQuestifyLog("error", source, ...args); },
    debug(source, ...args) { emitQuestifyLog("debug", source, ...args); },
};
export function notifyQuestCompletion(quest) {
    if (!quest)
        return;
    showNotification({
        title: "Quest Completed!",
        body: `The ${normalizeQuestName(quest)} Quest has completed.`,
        dismissOnClick: true,
        onClick: () => NavigationRouter.transitionTo(`${QUEST_PAGE}#${quest.id}`)
    });
    QL.log("NOTIFY_QUEST_COMPLETION", { quest });
}
