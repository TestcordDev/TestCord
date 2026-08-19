/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { addProfileBadge, removeProfileBadge } from "@api/Badges";
import { addMessageDecoration, removeMessageDecoration } from "@api/MessageDecorations";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { getBadges, RelationshipIndicator } from "./utils";
const indicatorLocations = {
    list: {
        description: "In the member list",
        onEnable: () => addMessageDecoration("friend-indicator-list", props => <ErrorBoundary noop>
                <RelationshipIndicator user={props.user}/>
            </ErrorBoundary>),
        onDisable: () => removeMessageDecoration("friend-indicator-list")
    },
    badges: {
        description: "In user profiles, as badges",
        onEnable: () => addProfileBadge(badge),
        onDisable: () => removeProfileBadge(badge)
    },
    messages: {
        description: "Inside messages",
        onEnable: () => addMessageDecoration("friend-indicator-messages", props => <ErrorBoundary noop>
                <RelationshipIndicator user={props.message?.author} wantTopMargin={true}/>
            </ErrorBoundary>),
        onDisable: () => removeMessageDecoration("friend-indicator-messages")
    }
};
const badge = {
    getBadges,
    position: 0 /* BadgePosition.START */
};
const settings = definePluginSettings({
    ...Object.fromEntries(Object.entries(indicatorLocations).map(([key, value]) => {
        return [key, {
                type: 3 /* OptionType.BOOLEAN */,
                description: `Show indicators ${value.description.toLowerCase()}`,
                // onChange doesn't give any way to know which setting was changed, so restart required
                restartNeeded: true,
                default: true
            }];
    })),
});
export default definePlugin({
    name: "RelationshipIndicators",
    authors: [TestcordDevs.x2b],
    settings,
    description: "Adds icons to indicate relationships with users.",
    tags: ["Friends", "Utility"],
    start() {
        Object.entries(indicatorLocations).forEach(([key, value]) => {
            if (settings.store[key])
                value.onEnable();
        });
    },
    stop() {
        Object.entries(indicatorLocations).forEach(([key, value]) => {
            if (settings.store[key])
                value.onDisable();
        });
    },
});
