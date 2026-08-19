/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { HeaderBarButton } from "@api/HeaderBar";
import { DataStore } from "@api/index";
import { plugins } from "@api/PluginManager";
import { definePluginSettings } from "@api/Settings";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { openPluginModal } from "@components/settings";
import { TestcordDevs } from "@utils/constants";
import { sendMessage } from "@utils/discord";
import { useForceUpdater } from "@utils/react";
import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Button, React, TextInput, UserStore } from "@webpack/common";
const MessageActions = findByPropsLazy("deleteMessage", "startEditMessage");
function StickyIcon(props) {
    const w = props.width ?? 18;
    const h = props.height ?? 18;
    return (<svg width={w} height={h} viewBox="0 0 24 24" fill="none">
            <path fill={props.color ?? "currentColor"} d="M16 3l5 5-3 1-4 4 1 5-2 2-4-4-5 5-1-1 5-5-4-4 2-2 5 1 4-4 1-3z"/>
        </svg>);
}
function StickyHeaderButton() {
    return (<HeaderBarButton tooltip="Sticky Messages" icon={StickyIcon} onClick={() => openPluginModal(plugins.StickyMessages)}/>);
}
const ENTRIES_KEY = "StickyMessages_entries";
let entries = [];
const runtime = new Map();
function getRuntime(entryId) {
    let state = runtime.get(entryId);
    if (!state) {
        state = { stickyMessageId: null, pendingTimer: null, isPosting: false };
        runtime.set(entryId, state);
    }
    return state;
}
function clearPending(state) {
    if (state.pendingTimer) {
        clearTimeout(state.pendingTimer);
        state.pendingTimer = null;
    }
}
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
}
async function persistEntries() {
    try {
        await DataStore.set(ENTRIES_KEY, entries);
    }
    catch (err) {
        console.error("[StickyMessages] Failed to persist entries:", err);
    }
}
async function postSticky(entry) {
    const channelId = entry.channelId.trim();
    if (!channelId || !entry.message)
        return;
    const state = getRuntime(entry.id);
    state.isPosting = true;
    // If a previous sticky is still around, delete it first.
    // Null out the id before deleting so our own MESSAGE_DELETE handler won't reschedule.
    const previousId = state.stickyMessageId;
    state.stickyMessageId = null;
    if (previousId) {
        try {
            MessageActions.deleteMessage(channelId, previousId);
        }
        catch (err) {
            console.error("[StickyMessages] Failed to delete previous sticky:", err);
        }
    }
    try {
        const res = await sendMessage(channelId, { content: entry.message });
        const newId = res?.body?.id ?? res?.id ?? null;
        if (newId)
            state.stickyMessageId = newId;
    }
    catch (err) {
        console.error("[StickyMessages] Failed to send sticky:", err);
    }
    finally {
        // Keep flag a tick longer so the resulting MESSAGE_CREATE doesn't re-trigger us
        setTimeout(() => { state.isPosting = false; }, 250);
    }
}
function scheduleRepost(entry) {
    const state = getRuntime(entry.id);
    clearPending(state);
    const delayMs = Math.max(0, (entry.delaySeconds || 0) * 1000);
    state.pendingTimer = setTimeout(() => {
        state.pendingTimer = null;
        postSticky(entry);
    }, delayMs);
}
function findEntryByChannel(channelId) {
    return entries.find(e => e.channelId.trim() === channelId);
}
async function addEntry(forceUpdate) {
    entries.push({
        id: generateId(),
        channelId: "",
        message: "",
        delaySeconds: 3,
    });
    await persistEntries();
    forceUpdate();
}
async function removeEntry(id, forceUpdate) {
    const idx = entries.findIndex(e => e.id === id);
    if (idx === -1)
        return;
    const state = runtime.get(id);
    if (state)
        clearPending(state);
    runtime.delete(id);
    entries.splice(idx, 1);
    await persistEntries();
    forceUpdate();
}
function StickyEntries() {
    const update = useForceUpdater();
    React.useEffect(() => {
        (async () => {
            try {
                const stored = (await DataStore.get(ENTRIES_KEY)) ?? [];
                entries = stored;
                update();
            }
            catch (err) {
                console.error("[StickyMessages] Failed to load entries:", err);
            }
        })();
    }, []);
    async function setField(id, key, value) {
        const idx = entries.findIndex(e => e.id === id);
        if (idx === -1)
            return;
        entries[idx][key] = value;
        await persistEntries();
        update();
    }
    return (<>
            {entries.map((entry, i) => (<div key={entry.id} style={{
                marginBottom: "16px",
                padding: "12px",
                border: "1px solid var(--background-modifier-accent)",
                borderRadius: "4px",
            }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                        <Heading>Sticky {i + 1}</Heading>
                        <Button onClick={() => removeEntry(entry.id, update)} look={Button.Looks.FILLED} color={Button.Colors.RED} size={Button.Sizes.SMALL}>
                            Delete
                        </Button>
                    </div>

                    <div style={{ marginBottom: "8px" }}>
                        <Paragraph>Channel ID</Paragraph>
                        <TextInput placeholder="123456789012345678" value={entry.channelId} onChange={v => setField(entry.id, "channelId", v)}/>
                    </div>

                    <div style={{ marginBottom: "8px" }}>
                        <Paragraph>Sticky Message</Paragraph>
                        <TextInput placeholder="Message that stays at the bottom" value={entry.message} onChange={v => setField(entry.id, "message", v)}/>
                    </div>

                    <div>
                        <Paragraph>Delay (seconds)</Paragraph>
                        <TextInput placeholder="3" value={String(entry.delaySeconds)} onChange={v => {
                const n = parseInt(v, 10);
                setField(entry.id, "delaySeconds", isNaN(n) ? 0 : Math.max(0, n));
            }}/>
                    </div>
                </div>))}
            <Button onClick={() => addEntry(update)}>Add Sticky Message</Button>
        </>);
}
const settings = definePluginSettings({
    entries: {
        type: 6 /* OptionType.COMPONENT */,
        description: "Manage your sticky messages",
        component: () => <StickyEntries />,
    },
});
export default definePlugin({
    name: "StickyMessages",
    description: "js like sticky messages bot works by keepin da msg at the bottom.",
    tags: ["Chat", "Utility"],
    authors: [TestcordDevs.x2b],
    settings,
    headerBarButton: {
        render: StickyHeaderButton,
        icon: StickyIcon,
    },
    flux: {
        MESSAGE_CREATE({ message, optimistic }) {
            if (optimistic)
                return;
            if (!message)
                return;
            const entry = findEntryByChannel(message.channel_id);
            if (!entry || !entry.message)
                return;
            const state = getRuntime(entry.id);
            const me = UserStore.getCurrentUser();
            const isOwnSticky = me &&
                message.author?.id === me.id &&
                message.content === entry.message;
            if (isOwnSticky) {
                state.stickyMessageId = message.id;
                clearPending(state);
                return;
            }
            if (state.isPosting)
                return;
            scheduleRepost(entry);
        },
        MESSAGE_DELETE({ channelId, id }) {
            const entry = findEntryByChannel(channelId);
            if (!entry)
                return;
            const state = getRuntime(entry.id);
            if (!state.stickyMessageId || id !== state.stickyMessageId)
                return;
            state.stickyMessageId = null;
            scheduleRepost(entry);
        },
    },
    async start() {
        try {
            entries = (await DataStore.get(ENTRIES_KEY)) ?? [];
        }
        catch (err) {
            console.error("[StickyMessages] Failed to load entries on start:", err);
            entries = [];
        }
    },
    stop() {
        for (const state of runtime.values())
            clearPending(state);
        runtime.clear();
    },
});
