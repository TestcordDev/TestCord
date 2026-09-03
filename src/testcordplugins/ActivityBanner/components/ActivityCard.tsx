/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Activity } from "@vencord/discord-types";
import { React, UserStore, useStateFromStores } from "@webpack/common";

import { LocalActivityStore, PresenceStore, RunningGameStore, SelfPresenceStore } from "../index";
import { ActivityIconProps, ActivityInfoProps } from "../types";
import { formatDuration, resolveActivityData } from "../utils";

let activeCarouselIndex = 0;
const carouselListeners = new Set<() => void>();

function setCarouselIndex(newIndex: number) {
    activeCarouselIndex = newIndex;
    carouselListeners.forEach(fn => fn());
}

function useCarouselIndex(maxCount: number): [number, (dir: number) => void] {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);

    React.useEffect(() => {
        carouselListeners.add(forceUpdate);
        return () => void carouselListeners.delete(forceUpdate);
    }, []);

    const safeIndex = maxCount > 0 ? ((activeCarouselIndex % maxCount) + maxCount) % maxCount : 0;

    const step = (dir: number) => {
        if (maxCount <= 1) return;
        setCarouselIndex(((safeIndex + dir) % maxCount + maxCount) % maxCount);
    };

    return [safeIndex, step];
}

function useTimerTick(hasTimer: boolean): void {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);

    React.useEffect(() => {
        if (!hasTimer) return;
        const interval = setInterval(() => forceUpdate(), 1000);
        return () => clearInterval(interval);
    }, [hasTimer]);
}

export function getUserActivities(): Activity[] {
    const currentUser = UserStore.getCurrentUser();
    const selfPres: Activity[] = SelfPresenceStore?.getActivities?.(currentUser?.id) ?? [];
    const localActs: Activity[] = LocalActivityStore?.getActivities?.() ?? [];
    const presenceActs: Activity[] = currentUser ? (PresenceStore?.getActivities?.(currentUser.id) ?? []) : [];

    const combined = [...selfPres, ...localActs, ...presenceActs];
    const seen = new Set<string>();
    const unique: Activity[] = [];

    for (const act of combined) {
        if (!act || act.type === 4) continue;
        const key = `${act.application_id ?? ""}:${act.name}`;
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(act);
        }
    }

    return unique;
}

export function ActivityIcon({
    name,
    application,
    game,
    defaultIcon
}: ActivityIconProps) {
    const activities = useStateFromStores([LocalActivityStore, SelfPresenceStore, PresenceStore], getUserActivities);
    const [carouselIndex] = useCarouselIndex(activities.length);

    if (activities.length === 0) {
        return <>{defaultIcon}</>;
    }

    const appId = application?.id ?? game?.id;
    const currentActivity = activities.find(a => a.application_id === appId || a.name.toLowerCase() === name?.toLowerCase())
        ?? activities[carouselIndex]
        ?? activities[0];

    const data = resolveActivityData(currentActivity);

    if (!data.largeImage?.src) {
        return <>{defaultIcon}</>;
    }

    return (
        <div
            className="vc-actbanner-icon-slot"
            title={data.largeImage.tooltip ?? data.name}
            style={{ position: "relative", width: 40, height: 40, minWidth: 40, minHeight: 40, maxWidth: 40, maxHeight: 40, flexShrink: 0 }}
        >
            <img
                className="vc-actbanner-large-cover"
                src={data.largeImage.src}
                alt={data.largeImage.alt ?? data.name}
                style={{ width: 40, height: 40, borderRadius: 8, objectFit: "cover", display: "block" }}
                onError={e => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
            />
            {data.smallImage?.src && (
                <img
                    className="vc-actbanner-small-badge"
                    src={data.smallImage.src}
                    alt={data.smallImage.alt ?? ""}
                    title={data.smallImage.tooltip}
                    style={{
                        position: "absolute",
                        bottom: -2,
                        right: -2,
                        width: 16,
                        height: 16,
                        borderRadius: "50%",
                        border: "2px solid var(--background-secondary-alt, #232428)",
                        objectFit: "cover"
                    }}
                    onError={e => {
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                    }}
                />
            )}
        </div>
    );
}

export function ActivityInfo({
    name,
    application,
    defaultTitle,
    defaultStatus
}: ActivityInfoProps) {
    const activities = useStateFromStores([LocalActivityStore, SelfPresenceStore, PresenceStore], getUserActivities);
    const visibleGame = useStateFromStores([RunningGameStore], () => RunningGameStore?.getVisibleGame?.());
    const [carouselIndex, stepCarousel] = useCarouselIndex(activities.length);

    const appId = application?.id;
    const currentActivity = activities.find(a => a.application_id === appId || a.name.toLowerCase() === name?.toLowerCase())
        ?? activities[carouselIndex]
        ?? activities[0];

    const data = currentActivity ? resolveActivityData(currentActivity) : undefined;
    const hasTimestamps = Boolean(data?.timestamps?.start || data?.timestamps?.end || visibleGame?.start);
    useTimerTick(hasTimestamps);

    if (!data) {
        const gameElapsed = visibleGame?.start ? formatDuration(visibleGame.start) : undefined;
        return (
            <>
                <div className="vc-actbanner-header-row">
                    <div className="vc-actbanner-title-wrapper">
                        {defaultTitle}
                    </div>
                </div>
                {gameElapsed && (
                    <div className="vc-actbanner-line vc-actbanner-timer">
                        {gameElapsed}
                    </div>
                )}
                {defaultStatus}
            </>
        );
    }

    const formattedTime = (data.timestamps?.start || data.timestamps?.end)
        ? formatDuration(data.timestamps.start, data.timestamps.end)
        : (visibleGame?.start ? formatDuration(visibleGame.start) : undefined);

    return (
        <>
            <div className="vc-actbanner-header-row">
                <div className="vc-actbanner-title-wrapper">
                    {defaultTitle}
                </div>
                {activities.length > 1 && (
                    <div
                        className="vc-actbanner-carousel"
                        onClick={e => e.stopPropagation()}
                        role="toolbar"
                        aria-label="Activity switcher"
                    >
                        <button
                            type="button"
                            className="vc-actbanner-carousel-btn"
                            onClick={() => stepCarousel(-1)}
                            aria-label="Previous activity"
                            title="Previous activity"
                        >
                            ◀
                        </button>
                        <span className="vc-actbanner-carousel-count">
                            {carouselIndex + 1}/{activities.length}
                        </span>
                        <button
                            type="button"
                            className="vc-actbanner-carousel-btn"
                            onClick={() => stepCarousel(1)}
                            aria-label="Next activity"
                            title="Next activity"
                        >
                            ▶
                        </button>
                    </div>
                )}
            </div>

            {data.details && (
                <div className="vc-actbanner-line vc-actbanner-details" title={data.details}>
                    {data.details}
                </div>
            )}

            {data.state && (
                <div className="vc-actbanner-line vc-actbanner-state" title={data.state}>
                    {data.state}
                </div>
            )}

            {formattedTime && (
                <div className="vc-actbanner-line vc-actbanner-timer">
                    {formattedTime}
                </div>
            )}

            {defaultStatus}
        </>
    );
}
