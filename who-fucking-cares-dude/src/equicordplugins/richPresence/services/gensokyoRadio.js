/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Logger } from "@utils/Logger";
import { ApplicationAssetUtils, FluxDispatcher } from "@webpack/common";
import { settings } from "../settings";
const Native = VencordNative.pluginHelpers.RichPresence;
const logger = new Logger("RichPresence:GensokyoRadio");
const APPLICATION_ID = "1253772057926303804";
const SOCKET_ID = "RichPresence_GR";
let updateInterval;
function setActivity(activity) {
    FluxDispatcher.dispatch({ type: "LOCAL_ACTIVITY_UPDATE", activity, socketId: SOCKET_ID });
}
async function getAsset(key) {
    return (await ApplicationAssetUtils.fetchAssetIds(APPLICATION_ID, [key]))[0];
}
async function getActivity() {
    const trackData = await Native.fetchTrackData();
    if (!trackData)
        return null;
    return {
        application_id: APPLICATION_ID,
        name: "Gensokyo Radio",
        details: trackData.title,
        state: trackData.artist,
        timestamps: {
            start: trackData.position * 1000,
            end: trackData.duration * 1000,
        },
        assets: {
            large_image: await getAsset(trackData.artwork),
            large_text: trackData.album,
            small_image: await getAsset("logo"),
            small_text: "Gensokyo Radio",
        },
        type: 2 /* ActivityType.LISTENING */,
        flags: 1 /* ActivityFlags.INSTANCE */,
    };
}
async function updatePresence() {
    try {
        setActivity(await getActivity());
    }
    catch (e) {
        logger.error("Failed to update presence", e);
        setActivity(null);
    }
}
export function start() {
    updatePresence();
    updateInterval = setInterval(updatePresence, (settings.store.gr_refreshInterval ?? 15) * 1000);
}
export function stop() {
    clearInterval(updateInterval);
    updateInterval = undefined;
    setActivity(null);
}
