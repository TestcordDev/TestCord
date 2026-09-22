/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addProfileBadge, BadgePosition, removeProfileBadge } from "@api/Badges";
import { addMemberListDecorator, removeMemberListDecorator } from "@api/MemberListDecorators";
import { addMessageDecoration, removeMessageDecoration } from "@api/MessageDecorations";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { User } from "@vencord/discord-types";
import { SnowflakeUtils, Tooltip, UserStore } from "@webpack/common";

const checkUser = (user: User, indType: string) => {
    if (!user || user.bot) return null;
    if (!settings.store[indType]) return null;

    const diff = Math.floor((Date.now() - SnowflakeUtils.extractTimestamp(user.id)) / 86400000);
    if (settings.store.days <= diff) return null;

    const tooltip = `Account created ${diff} days ago`;
    return <Tooltip text={tooltip}>
        {(tooltipProps: any) => (
            <span {...tooltipProps} tabIndex={0}>❗</span>
        )}
    </Tooltip>;
};

const badge = {
    component: (u: any) => checkUser(UserStore.getUser(u.userId), "badges"),
    position: BadgePosition.START,
    shouldShow: (_: any) => true,
    key: "newuser-indicator"
} as any;

const settings = definePluginSettings({
    badges: {
        description: "Enable on badges.",
        type: OptionType.BOOLEAN,
        default: true,
    },
    decorators: {
        description: "Enable on member list.",
        type: OptionType.BOOLEAN,
        default: true,
    },
    decorations: {
        description: "Enable on messages.",
        type: OptionType.BOOLEAN,
        default: true,
    },
    days: {
        description: "Amount of days to trigger badge.",
        type: OptionType.NUMBER,
        default: 30,
    },
});

export default definePlugin({
    name: "NewUserIndicator",
    description: "Adds a indicator if users account is created recently",
    tags: ["Friends", "Utility"],
    authors: [TestcordDevs.x2b],
    patches: [],
    settings,
    start() {
        addProfileBadge(badge);
        addMessageDecoration("newuser-indicator", props =>
            <ErrorBoundary noop>
                {checkUser(props.message.author, "decorations")}
            </ErrorBoundary>
        );
        addMemberListDecorator("newuser-indicator", props =>
            <ErrorBoundary noop>
                {checkUser(props.user, "decorators")}
            </ErrorBoundary>
        );

    },
    stop() {
        removeMessageDecoration("newuser-indicator");
        removeMemberListDecorator("newuser-indicator");
        removeProfileBadge(badge);
    },

});
