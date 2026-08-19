/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
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
export const ConnectionEvent = {
    SPEAKING: "speaking",
    MUTE: "mute",
    NEW_LISTENER: "newListener",
    DESTORY: "destroy",
    CONNECTED: "connected",
    SILENCE: "silence",
    DESKTOP_SOURCE_END: "desktopsourceend",
    SOUNDSHARE_ATTACHED: "soundshareattached",
    SOUNDSHARE_FAILED: "soundsharefailed",
    SOUNDSHARE_SPEAKING: "soundsharespeaking",
    SOUNDSHARE_TRACE: "soundsharetrace",
    INTERACTION_REQUIRED: "interactionrequired",
    VIDEOHOOK_INITIALIZED: "videohook-initialize",
    SCREENSHARE_FAILED: "screenshare-finish",
    NOISE_CANCELLER_ERROR: "noisecancellererror",
    VOICE_ACTIVITY_DETECTOR_ERROR: "voiceactivitydetectorerror",
    VIDEO_STATE: "video-state",
    VIDEO: "video",
    FIRST_FRAME: "first-frame",
    ERROR: "error",
    CONNECTION_STATE_CHANGE: "connectionstatechange",
    PING: "ping",
    PING_TIMEOUT: "pingtimeout",
    OUTBOUND_LOSSRATE: "outboundlossrate",
    LOCAL_VIDEO_DISABLED: "local-video-disabled",
    STATS: "stats",
};
export const HdrCaptureMode = {
    NEVER: "never",
    ALWAYS: "always",
    PERMITTED_DEVICES_ONLY: "permittedDevicesOnly",
};
