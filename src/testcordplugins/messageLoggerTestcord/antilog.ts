/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { sleep } from "@utils/misc";
import { Constants, FluxDispatcher, RestAPI } from "@webpack/common";

import { deleteLog } from "./engine";
import { settings } from "./settings";

const log = new Logger("MessageLoggerTestcord");

/**
 * Remove a message from this plugin's local logs so it never shows as deleted.
 */
export async function purgeLocalMessage(channelId: string, messageId: string) {
    try {
        FluxDispatcher.dispatch({ type: "MESSAGE_DELETE", channelId, id: messageId });
    } catch { /* ignore */ }
    await deleteLog(messageId);
}

/**
 * AntilogPremium-style deletion: hide the message from other people's loggers
 * (ghost edit or nonce replacement) before removing it from the server.
 */
export async function silentDeleteMessage(channelId: string, messageId: string): Promise<boolean> {
    const mode = settings.store.silentDeleteMode;
    const replacement = settings.store.silentDeletePlaceholder || "message deleted";
    const delay = Math.max(0, Math.min(2000, settings.store.silentDeleteDelay));

    try {
        if (mode === "ghostEdit") {
            await RestAPI.patch({
                url: Constants.Endpoints.MESSAGE(channelId, messageId),
                body: { content: replacement }
            }).catch(() => { });

            await sleep(delay);
            await RestAPI.del({ url: Constants.Endpoints.MESSAGE(channelId, messageId) });
        } else if (mode === "nonce") {
            const response = await RestAPI.post({
                url: Constants.Endpoints.MESSAGES(channelId),
                body: {
                    content: replacement,
                    nonce: messageId,
                    flags: 4096,
                    tts: false,
                    mobile_network_type: "unknown"
                }
            });

            await sleep(delay);
            await RestAPI.del({ url: Constants.Endpoints.MESSAGE(channelId, messageId) });

            if (response?.body?.id) {
                await sleep(delay);
                await RestAPI.del({
                    url: Constants.Endpoints.MESSAGE(channelId, response.body.id)
                }).catch(() => { });
            }
        } else {
            await RestAPI.del({ url: Constants.Endpoints.MESSAGE(channelId, messageId) });
        }

        if (settings.store.purgeLocalOnSilentDelete) await purgeLocalMessage(channelId, messageId);
        return true;
    } catch (error: any) {
        log.error("Silent delete failed:", error);
        return false;
    }
}
