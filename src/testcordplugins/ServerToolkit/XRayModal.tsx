/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ModalContent, openModal } from "@utils/modal";
import { Guild, RenderModalProps } from "@vencord/discord-types";
import { findByPropsLazy } from "@webpack";
import { Forms, GuildStore, Modal, React, TabBar, Text, useState } from "@webpack/common";

import { ChannelsTab } from "./tabs/ChannelsTab";
import { EmojisTab } from "./tabs/EmojisTab";
import { MembersTab } from "./tabs/MembersTab";
import { OverviewTab } from "./tabs/OverviewTab";
import { PermissionsTab } from "./tabs/PermissionsTab";
import { RolesTab } from "./tabs/RolesTab";
import { WebhooksTab } from "./tabs/WebhooksTab";

const IconUtils = findByPropsLazy("getGuildIconURL", "getGuildBannerURL");

enum Tab {
    Overview = "overview",
    Roles = "roles",
    Channels = "channels",
    Members = "members",
    Emojis = "emojis",
    Permissions = "permissions",
    Webhooks = "webhooks",
}

export function openXRayModal(guild: Guild) {
    openModal(props => <XRayModal {...props} guild={guild} />);
}

function XRayModal({ guild: bareGuild, ...props }: RenderModalProps & { guild: Guild; }) {
    const guild = GuildStore.getGuild(bareGuild.id) ?? bareGuild;
    const [tab, setTab] = useState<Tab>(Tab.Overview);

    const iconUrl = IconUtils?.getGuildIconURL?.({
        id: guild.id,
        icon: guild.icon,
        canAnimate: true,
        size: 64,
    });

    return (
        <Modal
            {...props}
            size="lg"
            className="guild-toolkit-modal"
            title={
                <div className="guild-toolkit-header-content">
                    {iconUrl && <img src={iconUrl} alt="" className="guild-toolkit-icon" />}
                    <div>
                        <Forms.FormTitle tag="h2" style={{ marginBottom: 0 }}>{guild.name}</Forms.FormTitle>
                        <Text variant="text-xs/normal" style={{ color: "var(--text-muted)" }}>
                            {guild.id}
                        </Text>
                    </div>
                </div>
            }
        >

            <TabBar
                type="top"
                look="brand"
                selectedItem={tab}
                onItemSelect={(t: Tab) => setTab(t)}
                className="guild-toolkit-tabbar"
            >
                <TabBar.Item id={Tab.Overview} className="guild-toolkit-tab">Overview</TabBar.Item>
                <TabBar.Item id={Tab.Roles} className="guild-toolkit-tab">Roles</TabBar.Item>
                <TabBar.Item id={Tab.Channels} className="guild-toolkit-tab">Channels</TabBar.Item>
                <TabBar.Item id={Tab.Members} className="guild-toolkit-tab">Members</TabBar.Item>
                <TabBar.Item id={Tab.Emojis} className="guild-toolkit-tab">Emojis / Stickers</TabBar.Item>
                <TabBar.Item id={Tab.Permissions} className="guild-toolkit-tab">Your Permissions</TabBar.Item>
                <TabBar.Item id={Tab.Webhooks} className="guild-toolkit-tab">Webhooks</TabBar.Item>
            </TabBar>

            <ModalContent className="guild-toolkit-content" scrollbarType="auto">
                {tab === Tab.Overview && <OverviewTab guild={guild} />}
                {tab === Tab.Roles && <RolesTab guild={guild} />}
                {tab === Tab.Channels && <ChannelsTab guild={guild} />}
                {tab === Tab.Members && <MembersTab guild={guild} />}
                {tab === Tab.Emojis && <EmojisTab guild={guild} />}
                {tab === Tab.Permissions && <PermissionsTab guild={guild} />}
                {tab === Tab.Webhooks && <WebhooksTab guild={guild} />}
            </ModalContent>
        </Modal>
    );
}
