/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { DataStore } from "@api/index";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { Button, Forms, MessageStore, Parser, Toasts, useEffect, UserStore, useState } from "@webpack/common";
const DATA_STORE_KEY = "huskchart";
const MAX_HUSKS = 5000;
function normalizeStoredHusks(value) {
    const husks = Array.isArray(value)
        ? value.filter((husk) => typeof husk?.userId === "string" && typeof husk.channelId === "string" && typeof husk.messageId === "string")
        : value && typeof value === "object" && Array.isArray(value.husks)
            ? value.husks.filter((husk) => typeof husk?.userId === "string" && typeof husk.channelId === "string" && typeof husk.messageId === "string")
            : [];
    const data = { version: 1, husks: husks.slice(-MAX_HUSKS), userCounts: {}, channelCounts: {} };
    for (const husk of data.husks) {
        data.userCounts[husk.userId] = (data.userCounts[husk.userId] ?? 0) + 1;
        data.channelCounts[husk.channelId] = (data.channelCounts[husk.channelId] ?? 0) + 1;
    }
    return data;
}
function sortedCounts(counts) {
    return Object.entries(counts)
        .map(([id, count]) => ({ id, count }))
        .sort((a, b) => b.count - a.count);
}
function decrementCount(counts, id) {
    const next = (counts[id] ?? 0) - 1;
    if (next > 0)
        counts[id] = next;
    else
        delete counts[id];
}
function getMessage(channelId, messageId) {
    return MessageStore.getMessage(channelId, messageId);
}
const UserData = () => {
    const [data, setData] = useState([]);
    const [collapsed, collapse] = useState(true);
    useEffect(() => {
        const fetchData = async () => {
            const stored = normalizeStoredHusks(await DataStore.get(DATA_STORE_KEY));
            setData(sortedCounts(stored.userCounts));
        };
        fetchData();
    }, []);
    return (<>
            <Forms.FormText style={{ fontSize: "1.07rem", fontWeight: "500" }}>User stats {data.length > 6 && <a onClick={() => { collapsed ? collapse(false) : collapse(true); }}>[{collapsed ? "View all" : "Collapse"}]</a>}</Forms.FormText>
            <div style={{ display: "grid", gridTemplateColumns: "auto auto" }}>
                {data.length === 0 && <Forms.FormText style={{ marginTop: "7px" }}>Nothing to see here.</Forms.FormText>}
                {data.map((user, index) => <>
                        {collapsed && <>
                                {index < 6 &&
                    <div style={{ marginTop: index < 2 ? "0" : "7px" }}>
                                        {Parser.parse(`<@${user.id}>`)} <Forms.FormText style={{ marginTop: "4px" }}>with {user.count} {user.count > 1 ? "husks" : "husk"}</Forms.FormText>
                                    </div>}
                            </>}
                        {!collapsed && <>
                                {<div style={{ marginTop: index < 2 ? "0" : "7px" }}>
                                        {Parser.parse(`<@${user.id}>`)} <Forms.FormText style={{ marginTop: "4px" }}>with {user.count} {user.count > 1 ? "husks" : "husk"}</Forms.FormText>
                                    </div>}
                            </>}
                    </>)}
            </div>
        </>);
};
const ChannelData = () => {
    const [data, setData] = useState([]);
    const [collapsed, collapse] = useState(true);
    useEffect(() => {
        const fetchData = async () => {
            const stored = normalizeStoredHusks(await DataStore.get(DATA_STORE_KEY));
            setData(sortedCounts(stored.channelCounts));
        };
        fetchData();
    }, []);
    return (<>
            <Forms.FormText style={{ fontSize: "1.07rem", fontWeight: "500" }}>Channel stats {data.length > 6 && <a onClick={() => { collapsed ? collapse(false) : collapse(true); }}>[{collapsed ? "View all" : "Collapse"}]</a>}</Forms.FormText>
            <div style={{ display: "grid", gridTemplateColumns: "auto auto" }}>
                {data.length === 0 && <Forms.FormText style={{ marginTop: "7px" }}>Nothing to see here.</Forms.FormText>}
                {data.map((channel, index) => <>
                        {collapsed && <>
                                {index < 6 &&
                    <div style={{ marginTop: index < 2 ? "0" : "7px" }}>
                                        {Parser.parse(`<#${channel.id}>`)} <Forms.FormText style={{ marginTop: "4px" }}>with {channel.count} {channel.count > 1 ? "husks" : "husk"}</Forms.FormText>
                                    </div>}
                            </>}
                        {!collapsed && <>
                                {<div style={{ marginTop: index < 2 ? "0" : "7px" }}>
                                        {Parser.parse(`<#${channel.id}>`)} <Forms.FormText style={{ marginTop: "4px" }}>with {channel.count} {channel.count > 1 ? "husks" : "husk"}</Forms.FormText>
                                    </div>}
                            </>}
                    </>)}
            </div>
        </>);
};
const settings = definePluginSettings({
    emojiToTrack: {
        type: 0 /* OptionType.STRING */,
        description: "The emoji to track (type its name, any emoji containing that name will be tracked)",
        default: "husk",
        placeholder: "emojiname (no :)"
    },
    buttons: {
        type: 6 /* OptionType.COMPONENT */,
        description: "stats",
        component: () => (<>
                <UserData />
                <ChannelData />
            </>)
    },
    clearAll: {
        type: 6 /* OptionType.COMPONENT */,
        description: "clear",
        component: () => (<Button color={Button.Colors.RED} onClick={() => {
                DataStore.set(DATA_STORE_KEY, { version: 1, husks: [], userCounts: {}, channelCounts: {} });
                Toasts.show({
                    id: Toasts.genId(),
                    message: "Cleared all data, reopen settings to see changes",
                    type: Toasts.Type.SUCCESS,
                    options: {
                        position: Toasts.Position.BOTTOM, // NOBODY LIKES TOASTS AT THE TOP
                    },
                });
            }}>
                Clear all data
            </Button>)
    }
});
export default definePlugin({
    name: "ReactionTracker",
    description: "See how much you've been reacted with a specific emoji, and by who",
    tags: ["Reactions", "Utility"],
    authors: [TestcordDevs.x2b],
    flux: {
        async MESSAGE_REACTION_ADD(event) {
            const msg = getMessage(event.channelId, event.messageId);
            if (!msg)
                return;
            if (msg.author.id !== UserStore.getCurrentUser().id)
                return;
            if (!event.emoji.name.includes(settings.store.emojiToTrack))
                return;
            await DataStore.update(DATA_STORE_KEY, value => {
                const data = normalizeStoredHusks(value);
                const husk = {
                    userId: event.userId,
                    channelId: event.channelId,
                    messageId: event.messageId
                };
                data.husks.push(husk);
                data.userCounts[husk.userId] = (data.userCounts[husk.userId] ?? 0) + 1;
                data.channelCounts[husk.channelId] = (data.channelCounts[husk.channelId] ?? 0) + 1;
                while (data.husks.length > MAX_HUSKS) {
                    const removed = data.husks.shift();
                    if (!removed)
                        break;
                    decrementCount(data.userCounts, removed.userId);
                    decrementCount(data.channelCounts, removed.channelId);
                }
                return data;
            });
        }
    },
    settings,
});
