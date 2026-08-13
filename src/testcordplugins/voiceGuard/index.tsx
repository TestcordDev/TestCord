/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { DataStore } from "@api/index";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import { isArabicMode, t } from "@utils/testcordI18n";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelActions, ChannelStore, Menu, RestAPI, SelectedChannelStore, Toasts, UserStore } from "@webpack/common";

const logger = new Logger("VoiceGuard");
const PIN_KEY = "VoiceGuard_pinnedChannel";

// A single voice-state entry as it arrives on the VOICE_STATE_UPDATES flux event.
// On a disconnect Discord still sends OUR entry, with channelId nulled and the
// channel we were thrown out of in oldChannelId.
interface VoiceState {
    userId: string;
    channelId?: string | null;
    oldChannelId?: string | null;
    guildId?: string;
    deaf: boolean;
    mute: boolean;
}

let pinnedChannelId: string | null = null;
let lastChannelId: string | null = null;
/** Set when YOU hit disconnect, so leaving on purpose is never undone. */
let leftOnPurpose = false;
let busy = false;
let lastActionAt = 0;
const DEBOUNCE = 1500;

function PinNotice() {
    return (
        <div className="vc-voiceguard-note" dir={isArabicMode() ? "rtl" : "ltr"}>
            {t(
                "⚠️ خيار «العودة للقناة المثبّتة إن تم نقلك» لا يعمل إلا بعد تثبيت القناة الصوتية: انقر عليها بالزرّ الأيمن ثم اختر «تثبيت القناة».",
                "⚠️ \"Jump back to the pinned channel if you get moved\" only works once you pin the voice channel: right-click it and choose \"Pin channel\"."
            )}
        </div>
    );
}

const settings = definePluginSettings({
    notice: {
        type: OptionType.COMPONENT,
        description: "",
        component: PinNotice
    },
    autoReconnect: {
        type: OptionType.BOOLEAN,
        description: "Brings you back if somebody disconnects you. No pin required: it returns you to the very channel you were thrown out of, or to your pinned channel if you have set one. Leaving on your own is left alone.",
        default: true
    },
    autoUndeafen: {
        type: OptionType.BOOLEAN,
        description: "Automatically undo a server deafen.",
        default: true
    },
    autoUnmute: {
        type: OptionType.BOOLEAN,
        description: "Automatically undo a server mute.",
        default: true
    },
    stayInChannel: {
        type: OptionType.BOOLEAN,
        description: "Jump back to the pinned channel if you get moved. Requires pinning a voice channel first: right-click it → Pin channel.",
        default: true
    },
    cooldown: {
        type: OptionType.SLIDER,
        description: "Cooldown between actions (seconds), to avoid fighting the server in a loop.",
        default: 1,
        markers: [0.5, 1, 1.5, 2, 3]
    }
});

function toast(message: string, ok = true) {
    Toasts.show({ id: Toasts.genId(), message, type: ok ? Toasts.Type.SUCCESS : Toasts.Type.FAILURE });
}

function startCooldown() {
    busy = true;
    setTimeout(() => { busy = false; }, settings.store.cooldown * 1000);
}

function undoServerState(guildId: string, myId: string, key: "deaf" | "mute") {
    RestAPI.patch({ url: `/guilds/${guildId}/members/${myId}`, body: { [key]: false } });
}

/** Join a channel, guarding against a channel that no longer exists. */
function rejoin(channelId: string, message: string) {
    if (!ChannelStore.getChannel(channelId)) {
        logger.warn(`channel ${channelId} is gone — not rejoining`);
        return;
    }

    lastActionAt = Date.now();
    startCooldown();

    try {
        ChannelActions.selectVoiceChannel(channelId);
        toast(message);
    } catch (e) {
        logger.error("failed to join the channel", e);
    }
}

function handleVoiceStateUpdate(voiceStates: VoiceState[]) {
    const myId = UserStore.getCurrentUser()?.id;
    if (!myId) return;

    const mine = voiceStates.find(s => s.userId === myId);
    if (!mine) return; // the event is about other people

    // Remember where we are the moment we see it, so a later disconnect always
    // has somewhere to return to.
    if (mine.channelId) lastChannelId = mine.channelId;

    if (busy || Date.now() - lastActionAt < DEBOUNCE) return;

    // Disconnected: our state still arrives, with channelId nulled — this is NOT
    // a missing entry, which is why testing for one never fired.
    if (mine.channelId == null) {
        // You pressed disconnect yourself — dragging you back in would be wrong.
        if (leftOnPurpose) return;

        const target = pinnedChannelId ?? mine.oldChannelId ?? lastChannelId;
        if (settings.store.autoReconnect && target) {
            rejoin(target, t("أُعيد الاتصال بالقناة الصوتية.", "Reconnected to the voice channel."));
        }
        return;
    }

    // Moved out of the pinned channel → go back.
    if (settings.store.stayInChannel && pinnedChannelId && mine.channelId !== pinnedChannelId) {
        rejoin(pinnedChannelId, t("عُدتَ إلى القناة المثبّتة.", "Moved back to the pinned channel."));
        return;
    }

    if (settings.store.autoUndeafen && mine.deaf && mine.guildId) {
        undoServerState(mine.guildId, myId, "deaf");
        toast(t("أُلغِي كتم السماع تلقائياً.", "Automatically undeafened."));
        lastActionAt = Date.now();
        startCooldown();
        return;
    }

    if (settings.store.autoUnmute && mine.mute && mine.guildId) {
        undoServerState(mine.guildId, myId, "mute");
        toast(t("أُلغِي الكتم تلقائياً.", "Automatically unmuted."));
        lastActionAt = Date.now();
        startCooldown();
    }
}

function pinChannelContextMenu(children: any, { channel }: { channel: { id: string; name: string; type: number; }; }) {
    // 2 = guild voice, 13 = stage
    if (!channel || (channel.type !== 2 && channel.type !== 13)) return;

    const pinned = pinnedChannelId === channel.id;
    children.push(
        <Menu.MenuItem
            id="voiceguard-pin"
            label={pinned ? t("إلغاء تثبيت القناة", "Unpin channel") : t("تثبيت القناة", "Pin channel")}
            action={() => {
                pinnedChannelId = pinned ? null : channel.id;
                void DataStore.set(PIN_KEY, pinnedChannelId);
                toast(pinnedChannelId ? t(`تم تثبيت: ${channel.name}`, `Pinned: ${channel.name}`) : t("أُلغي التثبيت", "Channel unpinned"));
            }}
        />
    );
}

export default definePlugin({
    name: "VoiceGuard",
    description: "Resist server voice moderation: auto-rejoin, auto-unmute/undeafen, and stay in a pinned channel if moved. ⚠️ May violate Discord ToS. Use at your own risk — Esharq disclaims all liability.",
    authors: [TestcordDevs.LOSTSTR],
    settings,

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[]; }) {
            handleVoiceStateUpdate(voiceStates);
        },

        // Fired only when THIS client picks a voice channel, or leaves with a null
        // one — the difference between quitting and being thrown out.
        VOICE_CHANNEL_SELECT({ channelId }: { channelId: string | null; }) {
            leftOnPurpose = channelId == null;
        }
    },

    contextMenus: {
        "channel-context": pinChannelContextMenu
    },

    async start() {
        lastChannelId = SelectedChannelStore.getVoiceChannelId() ?? null;

        // The pin used to live only in memory, so it silently vanished on every
        // restart and left auto-rejoin with no target.
        try {
            const saved = await DataStore.get(PIN_KEY);
            if (typeof saved === "string") pinnedChannelId = saved;
        } catch (e) {
            logger.error("failed to load the pinned channel", e);
        }
    },

    stop() {
        // Keep the pin on disk; only clear the in-memory session state.
        pinnedChannelId = null;
        lastChannelId = null;
        busy = false;
        lastActionAt = 0;
    }
});
