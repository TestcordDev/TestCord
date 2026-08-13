/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { MessageStore, RestAPI, SelectedChannelStore, showToast, Toasts, UserStore } from "@webpack/common";

const settings = definePluginSettings({
    keybind: {
        type: OptionType.SELECT,
        description: "Keyboard shortcut to delete your last message in the current channel.",
        options: [
            { label: "Alt + Delete", value: "altDelete", default: true },
            { label: "Ctrl + Shift + Delete", value: "ctrlShiftDelete" },
        ],
    },
    showConfirmToast: {
        type: OptionType.BOOLEAN,
        description: "Show a toast after deleting.",
        default: true,
    },
});

function matches(e: KeyboardEvent): boolean {
    const bind = settings.store.keybind;
    if (bind === "altDelete") return e.altKey && e.key === "Delete" && !e.ctrlKey && !e.shiftKey;
    if (bind === "ctrlShiftDelete") return e.ctrlKey && e.shiftKey && e.key === "Delete" && !e.altKey;
    return false;
}

async function onKeyDown(e: KeyboardEvent) {
    if (!matches(e)) return;

    const channelId = SelectedChannelStore.getChannelId();
    if (!channelId) return;

    const me = UserStore.getCurrentUser()?.id;
    if (!me) return;

    const messages = MessageStore.getMessages(channelId);
    if (!messages) return;

    const all = (messages as any).toArray?.() as any[] | undefined ?? [];
    const lastMine = [...all].reverse().find((m: any) => m.author?.id === me && !m.deleted);
    if (!lastMine) return;

    e.preventDefault();
    try {
        await RestAPI.del({ url: `/channels/${channelId}/messages/${lastMine.id}` });
        if (settings.store.showConfirmToast)
            showToast("Last message deleted.", Toasts.Type.SUCCESS);
    } catch {
        showToast("Failed to delete message.", Toasts.Type.FAILURE);
    }
}

export default definePlugin({
    name: "QuickDelete",
    description: "Delete your last message in the current channel with a keyboard shortcut.",
    tags: ["Chat", "Utility"],
    authors: [TestcordDevs.Sharp],
    settings,

    start() {
        document.addEventListener("keydown", onKeyDown);
    },

    stop() {
        document.removeEventListener("keydown", onKeyDown);
    },
});
