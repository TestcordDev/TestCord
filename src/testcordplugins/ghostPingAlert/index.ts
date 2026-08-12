/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher, Toasts, UserStore } from "@webpack/common";

const logger = new Logger("GhostPingAlert");

const settings = definePluginSettings({
    alertOnEveryone: {
        type: OptionType.BOOLEAN,
        description: "Also alert when @everyone / @here messages are deleted",
        default: true,
    },
});

interface CachedPing {
    authorName: string;
    content: string;
}

const cache = new Map<string, CachedPing>();
const MAX = 500;

function onMessageCreate({ message }: any) {
    if (!message?.id) return;
    try {
        const me = UserStore.getCurrentUser();
        if (!me) return;

        const mentions: any[] = message.mentions ?? [];
        const everyone: boolean = (message.mention_everyone ?? false) && settings.store.alertOnEveryone;
        const pingedMe = everyone || mentions.some((u: any) => u.id === me.id);
        if (!pingedMe) return;

        if (cache.size >= MAX) {
            const first = cache.keys().next().value;
            if (first) cache.delete(first);
        }

        cache.set(message.id, {
            authorName: message.author?.global_name ?? message.author?.username ?? "Unknown",
            content: message.content ?? "",
        });
    } catch (e) {
        logger.error("onMessageCreate error:", e);
    }
}

function onMessageDelete({ id }: any) {
    if (!id) return;
    const hit = cache.get(id);
    if (!hit) return;
    cache.delete(id);

    const preview = hit.content.length > 80
        ? hit.content.slice(0, 80) + "…"
        : hit.content || "(no text)";

    Toasts.show({
        message: `👻 Ghost ping from ${hit.authorName}: "${preview}"`,
        type: Toasts.Type.FAILURE,
        id: Toasts.genId(),
        options: { duration: 6000 },
    });
}

export default definePlugin({
    name: "GhostPingAlert",
    description: "Shows a toast notification when someone deletes a message that pinged you.",
    authors: [{ name: "Sharp", id: 0n }],
    tags: ["Notifications", "Chat"],
    settings,

    start() {
        FluxDispatcher.subscribe("MESSAGE_CREATE", onMessageCreate);
        FluxDispatcher.subscribe("MESSAGE_DELETE", onMessageDelete);
    },

    stop() {
        FluxDispatcher.unsubscribe("MESSAGE_CREATE", onMessageCreate);
        FluxDispatcher.unsubscribe("MESSAGE_DELETE", onMessageDelete);
        cache.clear();
    },
});
