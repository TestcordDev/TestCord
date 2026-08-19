/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { FluxDispatcher, React, Tooltip } from "@webpack/common";
const TypingStore = findByPropsLazy("getTypingUsers");
const UserStore = findByPropsLazy("getUser", "getCurrentUser");
let currentChannelId = null;
let setUsersRef = null;
function onTypingStart({ channelId, userId }) {
    if (channelId !== currentChannelId)
        return;
    refresh(channelId);
}
function onTypingStop({ channelId }) {
    if (channelId !== currentChannelId)
        return;
    refresh(channelId);
}
function refresh(channelId) {
    const raw = TypingStore.getTypingUsers(channelId) ?? {};
    const me = UserStore.getCurrentUser();
    const users = Object.keys(raw)
        .filter(id => id !== me?.id)
        .map(id => {
        const u = UserStore.getUser(id);
        return { id, username: u?.username ?? id, globalName: u?.globalName ?? null };
    });
    setUsersRef?.(users);
}
function TypingBadge({ channelId }) {
    const [users, setUsers] = React.useState([]);
    React.useEffect(() => {
        currentChannelId = channelId;
        setUsersRef = setUsers;
        refresh(channelId);
        return () => {
            currentChannelId = null;
            setUsersRef = null;
        };
    }, [channelId]);
    if (!users.length)
        return null;
    const names = users.map(u => u.globalName ?? u.username).join(", ");
    const label = users.length === 1
        ? `${names} is typing…`
        : `${names} are typing…`;
    return (<Tooltip text={label}>
            {({ onMouseEnter, onMouseLeave }) => (<div onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 7px",
                borderRadius: 12,
                background: "var(--background-secondary)",
                fontSize: 12,
                color: "var(--text-muted)",
                cursor: "default",
                userSelect: "none",
            }}>
                    <span style={{ fontWeight: 600, color: "var(--text-normal)" }}>
                        {users.length}
                    </span>
                    typing
                </div>)}
        </Tooltip>);
}
export default definePlugin({
    name: "ShowTypingUsers",
    description: "Shows a badge in the channel header listing who is currently typing.",
    authors: [{ name: "Sharp", id: 0n }],
    tags: ["Chat", "Utility"],
    start() {
        FluxDispatcher.subscribe("TYPING_START", onTypingStart);
        FluxDispatcher.subscribe("TYPING_STOP", onTypingStop);
    },
    stop() {
        FluxDispatcher.unsubscribe("TYPING_START", onTypingStart);
        FluxDispatcher.unsubscribe("TYPING_STOP", onTypingStop);
        setUsersRef = null;
        currentChannelId = null;
    },
});
