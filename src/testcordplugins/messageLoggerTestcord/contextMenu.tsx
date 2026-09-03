/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addContextMenuPatch, type NavContextMenuPatchCallback,removeContextMenuPatch } from "@api/ContextMenu";
import { isPluginEnabled } from "@api/PluginManager";
import { FluxDispatcher, Menu, MessageActions, React, SortedGuildStore, Toasts, UserStore } from "@webpack/common";

import { silentDeleteMessage } from "./antilog";
import { clearEditHistoryCache, invalidateLoggedCaches, localRemoveLoggedMessage } from "./engine";
import { addToOppositeAndList, isInList, type ListType,removeFromList } from "./lists";
import { openLogs } from "./LogsModal";
import { osintScanLoggedMessages } from "./osintBridge";
import { settings } from "./settings";

interface MenuProps {
    navId?: string;
    message?: any;
    channel?: any;
    user?: any;
    guild?: any;
    folderId?: number;
}

const idFunctions: Record<string, (props: MenuProps) => string | string[] | null | undefined> = {
    Folder: props =>
        props?.folderId != null
            ? SortedGuildStore.getGuildFolders?.().find(f => f?.folderId === props.folderId)?.guildIds ?? null
            : null,
    Server: props => props?.guild?.id,
    User: props => props?.message?.author?.id || props?.user?.id,
    Channel: props => props?.message?.channel_id || props?.channel?.id
};

function renderOpenLogs(idType: string, props: MenuProps) {
    const id = idFunctions[idType]?.(props);
    if (!id || Array.isArray(id)) return null;

    return (
        <Menu.MenuItem
            key={`open-logs-${idType}`}
            id={`testcord-ml-open-logs-${idType.toLowerCase()}`}
            label={`Open Logs For ${idType}`}
            action={() => openLogs(`${idType === "Server" ? "guild" : idType.toLowerCase()}:${id}`)}
        />
    );
}

function renderListOption(listType: ListType, idType: string, props: MenuProps) {
    const rawId = idFunctions[idType]?.(props);
    if (!rawId || (Array.isArray(rawId) && rawId.length === 0)) return null;

    const ids = Array.isArray(rawId) ? rawId : [rawId];
    const isBlocked = ids.every(id => isInList(listType, id));
    const opposite: ListType = listType === "blacklistedIds" ? "whitelistedIds" : "blacklistedIds";
    const isOppositeBlocked = ids.some(id => isInList(opposite, id));
    const listLabel = listType === "blacklistedIds" ? "Blacklist" : "Whitelist";

    return (
        <Menu.MenuItem
            key={`${listType}-${idType}`}
            id={`testcord-ml-${listType}-${idType.toLowerCase()}`}
            label={
                isOppositeBlocked
                    ? `Move ${idType} to ${listLabel}`
                    : isBlocked ? `Remove ${idType} From ${listLabel}` : `${listLabel} ${idType}`
            }
            action={() => {
                if (isBlocked) ids.forEach(id => removeFromList(listType, id));
                else ids.forEach(id => addToOppositeAndList(listType, id));
                Toasts.show({
                    message: `${isBlocked ? "Removed from" : "Added to"} ${listLabel.toLowerCase()}.`,
                    type: Toasts.Type.SUCCESS,
                    id: `testcord-ml-list-${Date.now()}`
                });
            }}
        />
    );
}

function buildLoggedMessageItems(props: MenuProps) {
    const { message } = props;
    if (props.navId !== "message" || !message) return null;
    if (!message.deleted && !(message.editHistory?.length > 0)) return null;

    // Show removal options for any logged deleted/edited message.
    // getCachedLoggedMessage is best-effort: after restart, older logs may be primed,
    // but we still allow removal via DB even if not in memory cache.

    return [
        <Menu.MenuSeparator key="sep-remove" />,
        message.deleted && (
            <Menu.MenuItem
                key="remove-message-temporary"
                id="testcord-ml-remove-message"
                label="Delete Message (Temporary)"
                color="danger"
                action={async () => {
                    invalidateLoggedCaches(message.id);
                    await localRemoveLoggedMessage(message.id, false, message.channel_id);
                    Toasts.show({
                        message: "Hidden from chat. It stays in your logs.",
                        type: Toasts.Type.SUCCESS,
                        id: Toasts.genId()
                    });
                }}
            />
        ),
        message.deleted && (
            <Menu.MenuItem
                key="remove-message-permanent"
                id="testcord-ml-remove-message-permanent"
                label="Delete Message (Forever)"
                color="danger"
                action={async () => {
                    invalidateLoggedCaches(message.id);
                    await localRemoveLoggedMessage(message.id, true, message.channel_id);
                    Toasts.show({
                        message: "Message deleted from your logs forever.",
                        type: Toasts.Type.SUCCESS,
                        id: Toasts.genId()
                    });
                }}
            />
        ),
        !message.deleted && (
            <Menu.MenuItem
                key="remove-history-temporary"
                id="testcord-ml-remove-history-temporary"
                label="Delete Message History (Temporary)"
                color="danger"
                action={async () => {
                    clearEditHistoryCache(message.id);
                    (message as any).editHistory = [];
                    FluxDispatcher.dispatch({
                        type: "MESSAGE_UPDATE",
                        message: { id: message.id, channel_id: message.channel_id }
                    });
                    Toasts.show({
                        message: "Hidden from chat. History stays in your logs.",
                        type: Toasts.Type.SUCCESS,
                        id: Toasts.genId()
                    });
                }}
            />
        ),
        !message.deleted && (
            <Menu.MenuItem
                key="remove-history-permanent"
                id="testcord-ml-remove-history-permanent"
                label="Delete Message History (Forever)"
                color="danger"
                action={async () => {
                    invalidateLoggedCaches(message.id);
                    await localRemoveLoggedMessage(message.id, true, message.channel_id);
                    (message as any).editHistory = [];
                    FluxDispatcher.dispatch({
                        type: "MESSAGE_UPDATE",
                        message: { id: message.id, channel_id: message.channel_id }
                    });
                    Toasts.show({
                        message: "Edit history deleted from your logs forever.",
                        type: Toasts.Type.SUCCESS,
                        id: Toasts.genId()
                    });
                }}
            />
        )
    ].filter(Boolean);
}

function buildHideFromLoggersItem(props: MenuProps) {
    const { message } = props;
    if (!settings.store.hideFromOtherLoggers) return null;
    if (props.navId !== "message" || !message || message.deleted) return null;
    if (message.author?.id !== UserStore.getCurrentUser()?.id) return null;

    return (
        <Menu.MenuItem
            key="hide-from-message-loggers"
            id="testcord-ml-hide-from-loggers"
            label="Delete Message (Hide From Message Loggers)"
            color="danger"
            action={async () => {
                try {
                    await MessageActions.deleteMessage(message.channel_id, message.id);
                    // Nonce replacement: loggers that dedupe by nonce overwrite the
                    // captured deleted content with the placeholder text.
                    await MessageActions._sendMessage(
                        message.channel_id,
                        {
                            content: settings.store.hideFromLoggersPlaceholder || "message deleted",
                            tts: false,
                            invalidEmojis: [],
                            validNonShortcutEmojis: []
                        },
                        { nonce: message.id }
                    );
                    invalidateLoggedCaches(message.id);
                    await localRemoveLoggedMessage(message.id, true, message.channel_id);
                    Toasts.show({
                        message: "Message deleted and hidden from other loggers.",
                        type: Toasts.Type.SUCCESS,
                        id: Toasts.genId()
                    });
                } catch {
                    Toasts.show({
                        message: "Failed to hide the message from other loggers.",
                        type: Toasts.Type.FAILURE,
                        id: Toasts.genId()
                    });
                }
            }}
        />
    );
}

const contextMenuPatch: NavContextMenuPatchCallback = (children, props: MenuProps) => {
    if (!props || children.some(child => child?.props?.id === "testcord-ml-menu")) return;

    const isMessageMenu = props.navId === "message";
    const { message } = props;

    const showSilentDelete = isMessageMenu
        && settings.store.enableSilentDelete
        && message
        && !message.deleted
        && message.author?.id === UserStore.getCurrentUser()?.id
        && !isPluginEnabled("AntilogPremium");

    // Heavily used actions live at the top level for quick access
    const loggedItems = buildLoggedMessageItems(props);
    const hideFromLoggersItem = buildHideFromLoggersItem(props);

    children.push(
        loggedItems ? <React.Fragment key="testcord-ml-top">{loggedItems}</React.Fragment> : null,
        hideFromLoggersItem,
        <Menu.MenuSeparator key="testcord-ml-sep" />,
        <Menu.MenuItem
            key="testcord-ml-menu"
            id="testcord-ml-menu"
            label="Message Logger"
        >
            <Menu.MenuItem
                id="testcord-ml-open-logs"
                label="Open Logs"
                action={() => openLogs()}
            />
            {Object.keys(idFunctions).map(IdType => renderOpenLogs(IdType, props))}
            {isMessageMenu && message && (
                <Menu.MenuItem
                    id="testcord-ml-open-logs-author"
                    label="Open Logs For Author"
                    action={() => openLogs(`from:${message.author.id}`)}
                />
            )}

            <Menu.MenuSeparator />
            {Object.keys(idFunctions).map(IdType => renderListOption("blacklistedIds", IdType, props))}
            {Object.keys(idFunctions).map(IdType => renderListOption("whitelistedIds", IdType, props))}

            {isMessageMenu && message && (
                <>
                    <Menu.MenuSeparator />
                    <Menu.MenuItem
                        id="testcord-ml-osint-logged"
                        label="OSINT Analyze Logged Messages"
                        action={() => void osintScanLoggedMessages(message.author.id)}
                    />
                    <Menu.MenuItem
                        id="testcord-ml-osint-full"
                        label="Full OSINT Scan Of Author"
                        action={() => {
                            void import("../TestcordOSINT/index").then(({ openOsintScanFor }) =>
                                openOsintScanFor(message.author.id, message.channel_id)
                            );
                        }}
                    />
                </>
            )}

            {showSilentDelete && (
                <>
                    <Menu.MenuSeparator />
                    <Menu.MenuItem
                        id="testcord-ml-silent-delete"
                        label={<span style={{ color: "var(--status-danger)" }}>Silent Delete</span>}
                        color="danger"
                        action={() => {
                            void silentDeleteMessage(message.channel_id, message.id).then(ok =>
                                Toasts.show({
                                    message: ok ? "Message silently deleted." : "Silent delete failed.",
                                    type: ok ? Toasts.Type.SUCCESS : Toasts.Type.FAILURE,
                                    id: Toasts.genId()
                                })
                            );
                        }}
                    />
                </>
            )}
        </Menu.MenuItem>
    );
};

const PATCHED_MENUS = ["message", "channel-context", "user-context", "guild-context", "gdm-context"] as const;

export function setupLoggerContextMenus() {
    for (const menu of PATCHED_MENUS) addContextMenuPatch(menu, contextMenuPatch);
}

export function removeLoggerContextMenus() {
    for (const menu of PATCHED_MENUS) removeContextMenuPatch(menu, contextMenuPatch);
}
