/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Divider, Heading, Notice } from "@components/index";
import { Margins } from "@utils/margins";
import { OptionType } from "@utils/types";
import { MaskedLink } from "@webpack/common";

import { updateActivity } from "./richPresence";
import { YMusicSyncStore } from "./store";

function isValidToken(value: string): true | string {
    const token = value.trim();
    if (token.length > 0 && token.length < 20) return "Token looks too short";
    return true;
}

function RichPresenceSection() {
    return (
        <div className={Margins.top16}>
            <Divider />
            <Heading tag="h3" className={Margins.top16}>Discord RPC</Heading>
        </div>
    );
}

function WarningSection() {
    return (
        <Notice.Warning className={Margins.bottom16}>
            This plugin requires Ynison player control to be enabled in Yandex Music PC client. Recommend using{" "}
            <MaskedLink href="https://pulsesync.dev/">PulseSync</MaskedLink> to enable it
        </Notice.Warning>
    );
}

export const settings = definePluginSettings({
    warningSection: {
        type: OptionType.COMPONENT,
        component: WarningSection
    },
    showPanel: {
        type: OptionType.BOOLEAN,
        displayName: "Show player panel",
        description: "Show the player panel above the account panel",
        default: true
    },
    oauthToken: {
        type: OptionType.STRING,
        displayName: "Yandex Music OAuth token",
        description: "Token used to join Ynison",
        default: "",
        placeholder: "y0_Ag…",
        target: "DESKTOP",
        isValid: isValidToken,
        componentProps: {
            type: "password"
        }
    },
    hideAfterPauseSeconds: {
        type: OptionType.NUMBER,
        displayName: "Hide after pause",
        description: "Hide the panel after the track has been paused for this many seconds, 0 keeps it always visible",
        default: 300,
        isValid: value => Number(value) >= 0 || "Enter a number of seconds, zero or more",
        onChange: () => YMusicSyncStore.refreshPauseHide()
    },
    showVolume: {
        type: OptionType.BOOLEAN,
        displayName: "Show volume slider",
        description: "Show the volume slider under the playback controls",
        default: true
    },
    showSettingsButton: {
        type: OptionType.BOOLEAN,
        displayName: "Show settings button",
        description: "Show the gear button that opens the plugin settings from the panel",
        default: true
    },
    richPresenceSection: {
        type: OptionType.COMPONENT,
        component: RichPresenceSection
    },
    showActivity: {
        type: OptionType.BOOLEAN,
        displayName: "Show Discord activity",
        description: "Share the current track as a listening activity",
        default: true,
        onChange: () => void updateActivity()
    },
    showTrackButton: {
        type: OptionType.BOOLEAN,
        displayName: "Show track button",
        description: "Add an Open in Yandex Music button to the activity",
        default: true,
        onChange: () => void updateActivity()
    },
    activityName: {
        type: OptionType.STRING,
        displayName: "Activity name",
        description: "Name shown above the track in your profile",
        default: "Yandex Music",
        onChange: () => void updateActivity()
    }
});
