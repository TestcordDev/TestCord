/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addHeaderBarButton, HeaderBarButton, removeHeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher, React, RestAPI, Toasts, UserStore } from "@webpack/common";

const log = new Logger("DMAway");

const settings = definePluginSettings({
    message: {
        type: OptionType.STRING,
        description: "Auto-reply message sent to DMs while you're away",
        default: "I'm away right now, I'll get back to you soon.",
    },
    idleMinutes: {
        type: OptionType.NUMBER,
        description: "Minutes of inactivity before auto-reply triggers (0 = manual toggle only)",
        default: 0,
    },
    cooldownMinutes: {
        type: OptionType.NUMBER,
        description: "Don't reply to the same person more than once per N minutes",
        default: 30,
    },
});

let afkEnabled = false;
const replied = new Map<string, number>();
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let _setEnabled: ((v: boolean) => void) | null = null;

function resetIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    if (settings.store.idleMinutes > 0) {
        idleTimer = setTimeout(() => {
            afkEnabled = true;
            _setEnabled?.(true);
            Toasts.show({
                message: "Away — auto-replying to DMs",
                type: Toasts.Type.SUCCESS,
                id: Toasts.genId(),
            });
        }, settings.store.idleMinutes * 60 * 1000);
    }
}

async function onMessage({ message, channelId }: any) {
    if (!afkEnabled || !message?.author?.id) return;

    const me = UserStore.getCurrentUser();
    if (!me || message.author.id === me.id) return;

    const isDM = !message.guild_id;
    if (!isDM) return;

    const now = Date.now();
    const lastReplied = replied.get(message.author.id);
    if (lastReplied && now - lastReplied < settings.store.cooldownMinutes * 60 * 1000) return;

    replied.set(message.author.id, now);

    try {
        await RestAPI.post({
            url: `/channels/${channelId}/messages`,
            body: { content: settings.store.message },
        });
    } catch (e) {
        log.error("Failed to send auto-reply:", e);
    }
}

function MoonIcon({ active }: { active: boolean; }) {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill={active ? "var(--brand-500)" : "currentColor"}>
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
    );
}

function AfkButton() {
    const [enabled, setEnabled] = React.useState(afkEnabled);
    _setEnabled = setEnabled;

    function toggle() {
        afkEnabled = !afkEnabled;
        setEnabled(afkEnabled);
        replied.clear();
        if (!afkEnabled && idleTimer) clearTimeout(idleTimer);
        Toasts.show({
            message: afkEnabled ? "Away — auto-replying to DMs" : "Away OFF",
            type: afkEnabled ? Toasts.Type.SUCCESS : Toasts.Type.MESSAGE,
            id: Toasts.genId(),
        });
    }

    return (
        <HeaderBarButton
            icon={() => <MoonIcon active={enabled} />}
            tooltip={enabled ? "Away: ON (click to disable)" : "Away: OFF (click to enable)"}
            onClick={toggle}
        />
    );
}

export default definePlugin({
    name: "DMAway",
    description: "Auto-replies to DMs when idle or manually toggled. Click the moon icon in the header to toggle.",
    authors: [{ name: "Sharp", id: 0n }],
    tags: ["Utility", "Notifications"],
    dependencies: ["HeaderBarAPI"],
    settings,

    start() {
        addHeaderBarButton("dmaway-btn", () => <AfkButton />, 8);
        FluxDispatcher.subscribe("MESSAGE_CREATE", onMessage);
        resetIdle();
    },

    stop() {
        removeHeaderBarButton("dmaway-btn");
        FluxDispatcher.unsubscribe("MESSAGE_CREATE", onMessage);
        if (idleTimer) clearTimeout(idleTimer);
        afkEnabled = false;
        replied.clear();
        _setEnabled = null;
    },
});
