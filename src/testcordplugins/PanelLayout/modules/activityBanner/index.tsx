/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { isPluginEnabled } from "@api/PluginManager";
import ErrorBoundary from "@components/ErrorBoundary";
import { TestcordDevs } from "@utils/constants";
import { findStoreLazy } from "@webpack";
import { React } from "@webpack/common";

import { isModuleEnabled } from "../state";
import type { UserAreaModule } from "../types";
import { ActivityBannerWidget, ActivityIcon, ActivityInfo, getUserActivities } from "./components/ActivityCard";
import { ActivityIconProps, ActivityInfoProps } from "./types";

interface SyntheticGame {
    id: string;
    name: string;
    origGameName: string;
    processName: string;
    isRpc: boolean;
}

export const LocalActivityStore = findStoreLazy("LocalActivityStore");
export const SelfPresenceStore = findStoreLazy("SelfPresenceStore");
export const PresenceStore = findStoreLazy("PresenceStore");
export const RunningGameStore = findStoreLazy("RunningGameStore");

let cardRenderer: ((app: unknown, game: unknown, opts: { isGameRunning: boolean }) => React.ReactNode) | null = null;
let wasRenderedInEI = false;

export function saveRenderer(fn: (app: unknown, game: unknown, opts: { isGameRunning: boolean }) => React.ReactNode) {
    cardRenderer = fn;
    wasRenderedInEI = false;
}

export function markRenderedInEI() {
    wasRenderedInEI = true;
}

export function renderStreamingGame(app: unknown, game: unknown) {
    if (wasRenderedInEI) return null;
    return cardRenderer?.(app, game, { isGameRunning: true });
}

export function getVisibleGameOrRpc(game: unknown): unknown {
    const musicControlsOn = isPluginEnabled("MusicControls") || isModuleEnabled("music-controls");
    if (musicControlsOn && game && (game as { name?: string; }).name?.toLowerCase() === "spotify") {
        game = null;
    }
    if (game) return game;
    const activities = getUserActivities();
    if (activities.length === 0) return null;
    const first = activities[0];
    const synthetic: SyntheticGame = {
        id: first.application_id ?? "0",
        name: first.name,
        origGameName: first.name,
        processName: first.name,
        isRpc: true
    };
    return synthetic;
}

export const renderActivityInfo = ErrorBoundary.wrap((props: ActivityInfoProps) => {
    return <ActivityInfo {...props} />;
}, {
    fallback: ({ wrappedProps }: { wrappedProps: ActivityInfoProps; }) => (
        <>
            {wrappedProps.defaultTitle}
            {wrappedProps.defaultStatus}
        </>
    )
});

export const renderActivityIcon = ErrorBoundary.wrap((props: ActivityIconProps) => {
    return <ActivityIcon {...props} />;
}, {
    fallback: ({ wrappedProps }: { wrappedProps: ActivityIconProps; }) => <>{wrappedProps.defaultIcon}</>
});

export const activityBannerPatches = [
    {
        find: "isForceShowSharingPopout",
        predicate: () => isModuleEnabled("activity-banner"),
        replacement: [
            {
                match: /children:\[null!=(\i)\?\(0,(\i)\.jsx\)\((\i),{name:\1,applicationId:(\i)\?\.id}\):null,\(0,\2\.jsx\)\((\i),{isCurrentlyRunningGame:(\i),onClickNotSharing:(\i)}\)\]/,
                replace: "children:$self.renderActivityInfo({name:$1,application:$4,isCurrentlyRunningGame:$6,onClickNotSharing:$7,TitleComponent:$3,defaultTitle:null!=$1?(0,$2.jsx)($3,{name:$1,applicationId:$4?.id}):null,defaultStatus:(0,$2.jsx)($5,{isCurrentlyRunningGame:$6,onClickNotSharing:$7})})"
            },
            {
                match: /getId\(\)\),(\i)=\(0,(\i\.\i)\)\(\[(\i\.\i),(\i\.\i)\],\(\)=>(\(0,\i\.\i\)\([^)]+\))\)/,
                replace: "getId()),$1=(0,$2)([$3,$4,$self.LocalActivityStore,$self.SelfPresenceStore,$self.PresenceStore],()=>$self.getVisibleGameOrRpc($5))"
            },
            {
                match: /\(0,(\i)\.jsx\)\((\i),{name:(\i),application:(\i),game:(\i),isStreaming:(\i),ref:(\i)}\)/,
                replace: "$self.renderActivityIcon({name:$3,application:$4,game:$5,isStreaming:$6,ref:$7,IconComponent:$2,defaultIcon:(0,$1.jsx)($2,{name:$3,application:$4,game:$5,isStreaming:$6,ref:$7})})"
            },
            {
                match: /(\i)\?(\i)\((\i),(\i),{isGameRunning:!0}\)/,
                replace: "($self.saveRenderer($2),$1)?($self.markRenderedInEI(),$2($3,$4,{isGameRunning:!0}))"
            },
            {
                match: /children:\[(\i),\(0,(\i)\.jsx\)\((\i),{stream:(\i),canGoLive:(\i),guildId:(\i),isStreaming:(\i),channel:(\i),canStream:(\i),runningGame:(\i),activity:(\i),application:(\i),/,
                replace: "children:[$1,($7&&null!=$10?$self.renderStreamingGame($12,$10):null),(0,$2.jsx)($3,{stream:$4,canGoLive:$5,guildId:$6,isStreaming:$7,channel:$8,canStream:$9,runningGame:$10,activity:$11,application:$12,"
            }
        ]
    }
];

export const activityBannerModule: Omit<UserAreaModule, "order" | "enabled"> = {
    id: "activity-banner",
    name: "Activity Banner",
    description: "Displays rich presence details, custom game icons, elapsed timer, and carousel switcher.",
    authors: [TestcordDevs.sirphantom89],
    version: "1.0.0",
    tags: ["Utility", "Activity", "Rich Presence"],
    icon: "🎮",
    position: "above",
    render: ActivityBannerWidget,
};

export { ActivityBannerWidget };
export * from "./components/ActivityCard";
export * from "./types";
export * from "./utils";
