/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { proxyLazy } from "@utils/lazy";
import { Activity } from "@vencord/discord-types";
import { ActivityFlags, ActivityStatusDisplayType, ActivityType } from "@vencord/discord-types/enums";
import { ApplicationAssetUtils, FluxDispatcher, lodash } from "@webpack/common";

import { COVER_SIZE, COVER_SIZE_PLACEHOLDER, lruSet } from "./constants";
import { settings } from "./settings";
import { YMusicSyncStore } from "./store";

const APP_ID = "1256145977056821248";
const DEFAULT_NAME = "Yandex Music";
const NO_FLAGS = 0 as ActivityFlags;

const UPDATE_DELAY = 2000;
const MAX_ASSET_CACHE_ENTRIES = 64;

let generation = 0;
let lastKey: string | null = null;
let lastStart = 0;

const assetCache = new Map<string, string | undefined>();

function trackLink(trackId: string): string {
    return trackId && !trackId.includes("-") ? `https://music.yandex.ru/track/${trackId}` : "";
}

async function coverAsset(coverUrl: string): Promise<string | undefined> {
    const url = coverUrl.replace(COVER_SIZE_PLACEHOLDER, COVER_SIZE);
    if (assetCache.has(url)) return assetCache.get(url);

    const [asset] = await ApplicationAssetUtils.fetchAssetIds(APP_ID, [url]);
    if (asset) lruSet(assetCache, url, asset, MAX_ASSET_CACHE_ENTRIES);
    return asset;
}

async function buildActivity(): Promise<Activity | null> {
    const { snapshot } = YMusicSyncStore;
    if (!settings.store.showActivity || !snapshot || !snapshot.isPlaying) return null;

    const name = settings.store.activityName.trim() || DEFAULT_NAME;
    const trackUrl = trackLink(snapshot.trackId);

    const activity: Activity = {
        application_id: APP_ID,
        name,
        type: ActivityType.LISTENING,
        details: snapshot.title,
        state: snapshot.artists || undefined,
        state_url: snapshot.artistUrl || undefined,
        status_display_type: ActivityStatusDisplayType.STATE,
        flags: NO_FLAGS
    };

    if (snapshot.durationMs > 0) {
        const start = Date.now() - YMusicSyncStore.positionMs;
        activity.timestamps = { start, end: start + snapshot.durationMs };
    }

    if (snapshot.coverUrl) {
        activity.assets = { large_image: await coverAsset(snapshot.coverUrl) };
    }

    if (trackUrl) {
        activity.details_url = trackUrl;

        if (settings.store.showTrackButton) {
            activity.buttons = ["Open in Yandex Music"];
            activity.metadata = { button_urls: [trackUrl] };
        }
    }

    return activity;
}

async function dispatchActivity(): Promise<void> {
    const { snapshot } = YMusicSyncStore;
    if (snapshot?.isPlaying && !snapshot.artistsResolved) return;

    const current = ++generation;
    const activity = await buildActivity();
    if (current !== generation) return;

    const key = activity && JSON.stringify(lodash.omit(activity, "timestamps"));
    const start = activity?.timestamps?.start ?? 0;
    if (key === lastKey && Math.abs(start - lastStart) <= 1000) return;
    lastKey = key;
    lastStart = start;

    FluxDispatcher.dispatch({
        type: "LOCAL_ACTIVITY_UPDATE",
        activity,
        socketId: "YMusicSync"
    });
}

export const updateActivity = proxyLazy(() => lodash.throttle(dispatchActivity, UPDATE_DELAY));

export function startRichPresence(): void {
    YMusicSyncStore.addChangeListener(updateActivity);
    void dispatchActivity();
}

export function stopRichPresence(): void {
    YMusicSyncStore.removeChangeListener(updateActivity);
    updateActivity.cancel();
    generation++;
    lastKey = null;
    lastStart = 0;
    assetCache.clear();
    FluxDispatcher.dispatch({
        type: "LOCAL_ACTIVITY_UPDATE",
        activity: null,
        socketId: "YMusicSync"
    });
}
