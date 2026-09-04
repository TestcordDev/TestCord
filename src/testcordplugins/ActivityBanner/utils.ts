/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Activity, Application } from "@vencord/discord-types";
import { findByPropsLazy } from "@webpack";
import { ApplicationStore } from "@webpack/common";

import { ResolvedActivityAsset, ResolvedActivityData } from "./types";

const { fetchApplication }: {
    fetchApplication: (id: string) => Promise<Application | null>;
} = findByPropsLazy("fetchApplication");

const fetchedApplications = new Map<string, Application | null>();

export function getApplicationMeta(applicationId?: string): Application | undefined {
    if (!applicationId) return undefined;
    let app: Application | undefined = ApplicationStore.getApplication(applicationId);
    if (!app && fetchedApplications.has(applicationId)) {
        app = fetchedApplications.get(applicationId) ?? undefined;
    } else if (!app && !fetchedApplications.has(applicationId)) {
        fetchedApplications.set(applicationId, null);
        void fetchApplication(applicationId).then(fetched => {
            fetchedApplications.set(applicationId, fetched);
        }).catch(() => void 0);
    }
    return app;
}

export function resolveAssetUrl(
    imageKey?: string,
    applicationId?: string,
    app?: Application
): string | undefined {
    if (!imageKey) {
        if (app?.icon && applicationId) {
            return `https://cdn.discordapp.com/app-icons/${applicationId}/${app.icon}.png`;
        }
        return undefined;
    }

    if (imageKey.startsWith("mp:")) {
        return `https://media.discordapp.net/${imageKey.slice(3)}`;
    }
    if (imageKey.startsWith("spotify:")) {
        return `https://i.scdn.co/image/${imageKey.slice(8)}`;
    }
    if (imageKey.startsWith("http://") || imageKey.startsWith("https://")) {
        return imageKey;
    }
    if (applicationId) {
        return `https://cdn.discordapp.com/app-assets/${applicationId}/${imageKey}.png`;
    }
    return undefined;
}

export function getActivityTypeLabel(type: number): string {
    switch (type) {
        case 0:
            return "Playing";
        case 1:
            return "Streaming";
        case 2:
            return "Listening to";
        case 3:
            return "Watching";
        case 5:
            return "Competing in";
        default:
            return "Playing";
    }
}

function pad(num: number): string {
    return num.toString().padStart(2, "0");
}

export function formatDuration(start?: number, end?: number): string | undefined {
    const now = Date.now();

    if (end && end > now) {
        const totalSeconds = Math.max(0, Math.floor((end - now) / 1000));
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        const timeStr = hours > 0
            ? `${hours}:${pad(minutes)}:${pad(seconds)}`
            : `${pad(minutes)}:${pad(seconds)}`;
        return `${timeStr} remaining`;
    }

    if (start && start <= now) {
        const totalSeconds = Math.max(0, Math.floor((now - start) / 1000));
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        const timeStr = hours > 0
            ? `${hours}:${pad(minutes)}:${pad(seconds)}`
            : `${pad(minutes)}:${pad(seconds)}`;
        return `${timeStr} elapsed`;
    }

    return undefined;
}

export function resolveActivityData(activity: Activity): ResolvedActivityData {
    const app = getApplicationMeta(activity.application_id);
    const largeImageKey = activity.assets?.large_image;
    const smallImageKey = activity.assets?.small_image;

    const largeUrl = resolveAssetUrl(largeImageKey, activity.application_id, app);
    const smallUrl = resolveAssetUrl(smallImageKey, activity.application_id, app);

    const largeImage: ResolvedActivityAsset | undefined = largeUrl ? {
        src: largeUrl,
        alt: activity.assets?.large_text ?? activity.name,
        tooltip: activity.assets?.large_text
    } : undefined;

    const smallImage: ResolvedActivityAsset | undefined = smallUrl ? {
        src: smallUrl,
        alt: activity.assets?.small_text ?? "Icon",
        tooltip: activity.assets?.small_text
    } : undefined;

    let partyInfo: string | undefined;
    if (activity.party?.size && activity.party.size.length === 2) {
        const [current, max] = activity.party.size;
        partyInfo = `(${current} of ${max})`;
    }

    return {
        activity,
        application: app,
        name: activity.name,
        details: activity.details,
        state: activity.state,
        typeLabel: getActivityTypeLabel(activity.type),
        timestamps: activity.timestamps,
        largeImage,
        smallImage,
        partyInfo,
        buttons: activity.buttons
    };
}
