/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import ErrorBoundary from "@components/ErrorBoundary";
import { Flex } from "@components/Flex";
import { classNameFactory } from "@utils/css";
import { openUserProfile } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { ModalContent, openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { FluxDispatcher, GuildMemberStore, Menu, Modal, RestAPI, ScrollerThin, Text, useEffect, UserStore, useStateFromStores } from "@webpack/common";

const cl = classNameFactory("bc-");

const logger = new Logger("showBoostCounts");
async function openViewBoosters(guild: string) {
    logger.info("Viewing boosters for guild", guild);
    const boosters = await fetchBoosters(guild);
    logger.info(boosters);
    openModal(props => (
        <ErrorBoundary>
            <Modal {...props} size="lg" title="Boosters">
                <ModalContent>
                    <UserList guildId={guild} boosters={boosters} />
                </ModalContent>
            </Modal>
        </ErrorBoundary>
    ));
}

function MakeContextCallback(): NavContextMenuPatchCallback {
    return (children, props) => {
        const { guild } = props;
        if (!guild) return;

        const lastChild = children.at(-1);
        if (lastChild?.key === "developer-actions") {
            const p = lastChild.props;
            if (!Array.isArray(p.children))
                p.children = [p.children];

            children = p.children;
        }

        children.splice(-1, 0,
            <Menu.MenuItem
                id={"vc-view-boosts"}
                label="View Boosters"
                action={async () => await openViewBoosters(guild.id)}
                icon={BoostIcon}
            />
        );
    };
}

export default definePlugin({
    name: "BoostCounts",
    description: "Shows all the boosters in the server and the number of boosts for each booster.",
    tags: ["Servers", "Utility"],
    dependencies: ["MessagePopoverAPI"],
    authors: [{
        name: "Raf", id: 121253596753952768n
    }],
    contextMenus: {
        "guild-context": MakeContextCallback()
    }
});

async function fetchBoosters(guildId: string) {
    const { body } = await RestAPI.get({ url: `/guilds/${guildId}/premium/subscriptions` });
    const boosts = Array.isArray(body) ? body : body?.subscriptions ?? [];
    const boosters = {};
    for (const boost of boosts) {
        if (boost.user.id in boosters)
            boosters[boost.user.id] += 1;
        else
            boosters[boost.user.id] = 1;
    }
    return boosters;
}

function UserList({ guildId, boosters }: { guildId: string, boosters: any; }) {
    const missing = [] as string[];
    const members = [] as string[];

    for (const id of Object.keys(boosters)) {
        if (GuildMemberStore.isMember(guildId, id))
            members.push(id);
        else
            missing.push(id);
    }

    // Used for side effects (rerender on member request success)
    useStateFromStores(
        [GuildMemberStore],
        () => GuildMemberStore.getMemberIds(guildId),
        null,
        (old, curr) => old?.length === curr?.length
    );

    useEffect(() => {
        if (missing.length > 0) {
            FluxDispatcher.dispatch({
                type: "GUILD_MEMBERS_REQUEST",
                guildIds: [guildId],
                userIds: missing
            });
        }
    }, []);

    return (
        <ScrollerThin fade className={cl("scroller")}>
            {members.map(id => {
                const user = UserStore.getUser(id);
                if (!user) {
                    logger.info("No user");
                    return null;
                }

                // Fallback avatar logic in case getAvatarURL is stubborn
                const avatarUrl = user.getAvatarURL?.()
                    ?? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`;

                return (
                    <Flex key={id} style={{ alignItems: "center", marginBottom: "10px", gap: "12px" }}>
                        {/* Boost Count */}
                        <Text variant="text-md/bold" style={{ minWidth: "24px", textAlign: "center" }}>
                            {boosters[id]}x
                        </Text>

                        {/* Custom User Row */}
                        <Flex
                            style={{ alignItems: "center", cursor: "pointer", gap: "10px" }}
                            onClick={() => openUserProfile(id)}
                        >
                            <img
                                src={avatarUrl}
                                width={32}
                                height={32}
                                style={{ borderRadius: "50%" }}
                                alt={`${user.username}'s avatar`}
                            />
                            <Text variant="text-md/medium">
                                {user.globalName ?? user.username}
                            </Text>
                        </Flex>
                    </Flex>
                );
            })}
        </ScrollerThin>
    );
}

function BoostIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" fill="white" stroke="white" width="18" height="18" viewBox="0 0 24 24" id="level-2-discord-boost">
            <path fill="#000" fillRule="evenodd" d="M11.68 1.616a.5.5 0 0 1 .64 0l6 5A.5.5 0 0 1 18.5 7v10a.5.5 0 0 1-.18.384l-6 5a.5.5 0 0 1-.64 0l-6-5A.5.5 0 0 1 5.5 17V7a.5.5 0 0 1 .18-.384l6-5ZM6.5 7.234v9.532l5.5 4.583 5.5-4.583V7.234L12 2.651 6.5 7.234Z" clipRule="evenodd"></path>
            <path fill="#000" fillRule="evenodd" d="M11.662 5.631a.5.5 0 0 1 .676 0l3 2.75a.5.5 0 0 1 .162.369v6.5a.5.5 0 0 1-.162.369l-3 2.75a.5.5 0 0 1-.676 0l-3-2.75a.5.5 0 0 1-.162-.369v-6.5a.5.5 0 0 1 .162-.369l3-2.75ZM9.5 8.97v6.06l2.5 2.292 2.5-2.292V8.97L12 6.678 9.5 8.97Z" clipRule="evenodd"></path>
            <path fill="#000" fillRule="evenodd" d="M12.5 2.5V6h-1V2.5h1ZM6.224 6.553l3 1.5-.448.894-3-1.5.448-.894Zm12 .894-3 1.5-.448-.894 3-1.5.448.894ZM5.776 16.553l3-1.5.448.894-3 1.5-.448-.894Zm12 .894-3-1.5.448-.894 3 1.5-.448.894ZM11.5 21.5V18h1v3.5h-1Z" clipRule="evenodd"></path>
        </svg>
    );
}
