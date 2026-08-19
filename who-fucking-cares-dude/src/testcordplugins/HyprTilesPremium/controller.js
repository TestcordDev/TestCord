/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { ChannelActionCreators, ChannelRouter, ChannelStore, GuildChannelStore, GuildStore, RelationshipStore, SelectedChannelStore, showToast, Toasts, UserStore, } from "@webpack/common";
import { settings } from "./settings";
import { adjustActiveWorkspaceMasterRatio, closeFocusedTile, closeTileById, cycleFocusedLeafTab, cycleLayout, cyclePinnedTileFocus, focusMasterTile, focusPreviousTile, focusTile, getActiveWorkspaceIndex, getPinnedTiles, getPrimaryTileForWorkspace, getTileById, getVisibleScratchpads, getWorkspaceSnapshot, moveFocusDirection, moveFocusedTileIntoNewGroup, moveFocusedTileToWorkspace, moveTileByDrop, openTile, promoteTileToPrimary, resyncWorkspaceLayoutsToSettings, sameTarget, seedWorkspaceFromTarget, sendFocusedTileToNamedGroup as sendFocusedTileToNamedGroupStore, setActiveWorkspace, setLayout, swapDirection, swapFocusedWithMaster, toggleFocusedTileFloating, toggleFocusedTilePinned, toggleScratchpad, toggleWorkspaceAutoLayout, toggleWorkspaceOverview, updatePrimaryTileTarget, updateTileTarget, } from "./store";
import { allActions, getKeybindSettingKey, isEditableTarget, matchesKeybind, workspaceIndices } from "./utils/keybinds";
import { reloadRulesConfig } from "./utils/rules";
let running = false;
let keyListenerAttached = false;
let pendingRouteSyncTileId = null;
let restoreSyncPending = false;
let focusRouteSyncTimeout = null;
let focusRouteSyncTileId = null;
let textInputFocusActive = false;
let textInputFocusDebounceTimer = null;
const workspaceIndexMap = workspaceIndices;
const FOCUS_ROUTE_SYNC_DELAY_MS = 45;
const isChannelLike = (channelId) => !!channelId && !!ChannelStore.getChannel(channelId);
const headerEmojiRegex = /[\p{Extended_Pictographic}\uFE0F\u200D]/gu;
function sanitizeTileHeaderText(value, fallback) {
    const cleaned = (value ?? "")
        .replace(headerEmojiRegex, "")
        .replace(/\s+/g, " ")
        .replace(/^\s*[|:;,-]+\s*/, "")
        .trim();
    return cleaned || fallback;
}
function isTextInputTarget(target) {
    if (!(target instanceof HTMLElement))
        return false;
    const tag = target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
function hasVoiceRouteTileConflict(target, primaryTileId) {
    const channel = ChannelStore.getChannel(target.channelId);
    if (!channel?.isGuildVoice?.() && !channel?.isGuildStageVoice?.())
        return false;
    const workspace = getWorkspaceSnapshot();
    const tileIds = [
        ...Object.values(workspace.nodesById).flatMap(node => node.kind === "leaf" ? node.tileIds : []),
        ...workspace.floatingTileIds,
        ...getPinnedTiles().map(tile => tile.id),
        ...getVisibleScratchpads(workspace.id).map(({ tile }) => tile.id)
    ];
    return tileIds.some(tileId => {
        if (tileId === primaryTileId)
            return false;
        const tile = getTileById(tileId);
        return sameTarget(tile, target);
    });
}
function onTextInputFocusIn(event) {
    if (!isTextInputTarget(event.target))
        return;
    if (textInputFocusDebounceTimer !== null) {
        clearTimeout(textInputFocusDebounceTimer);
        textInputFocusDebounceTimer = null;
    }
    textInputFocusActive = true;
}
function onTextInputFocusOut(event) {
    if (!isTextInputTarget(event.target))
        return;
    if (textInputFocusDebounceTimer !== null)
        clearTimeout(textInputFocusDebounceTimer);
    textInputFocusDebounceTimer = window.setTimeout(() => {
        textInputFocusDebounceTimer = null;
        textInputFocusActive = false;
    }, 200);
}
export async function reloadHyprTilesRules(showResult = true) {
    const result = await reloadRulesConfig();
    if (result.ok)
        resyncWorkspaceLayoutsToSettings(true);
    if (showResult) {
        showToast(result.ok
            ? "HyprTiles rules reloaded."
            : `HyprTiles rules reload failed: ${result.error}`, result.ok ? Toasts.Type.SUCCESS : Toasts.Type.FAILURE);
    }
    return result;
}
export function setHyprTilesRunning(value) {
    running = value;
    if (!value) {
        cancelScheduledFocusRouteSync();
        pendingRouteSyncTileId = null;
        restoreSyncPending = false;
        textInputFocusActive = false;
        if (textInputFocusDebounceTimer !== null) {
            clearTimeout(textInputFocusDebounceTimer);
            textInputFocusDebounceTimer = null;
        }
        return;
    }
    restoreSyncPending = settings.store.restoreWorkspaceOnReload;
    void reloadHyprTilesRules(false);
}
export function isHyprTilesRunning() {
    return running;
}
export function buildRouteTargetFromRouteProps(routeProps) {
    const params = routeProps?.match?.params;
    if (!params)
        return null;
    const channelId = typeof params.threadId === "string" && isChannelLike(params.threadId)
        ? params.threadId
        : typeof params.channelId === "string" && isChannelLike(params.channelId)
            ? params.channelId
            : null;
    if (!channelId)
        return null;
    const channel = ChannelStore.getChannel(channelId);
    if (!channel)
        return null;
    return {
        channelId: channel.id,
        guildId: channel.guild_id ?? (params.guildId === "@me" ? null : params.guildId ?? null),
    };
}
export function getCurrentSelectedTarget() {
    const channelId = SelectedChannelStore.getChannelId();
    if (!channelId)
        return null;
    const channel = ChannelStore.getChannel(channelId);
    if (!channel)
        return null;
    return {
        channelId: channel.id,
        guildId: channel.guild_id ?? null
    };
}
function routeToTarget(target) {
    if (!target)
        return;
    const channel = ChannelStore.getChannel(target.channelId);
    if (!channel)
        return;
    ChannelRouter.transitionToChannel(channel.id);
}
function routeToTileById(tileId) {
    if (!tileId)
        return;
    const tile = getTileById(tileId);
    if (!tile)
        return;
    pendingRouteSyncTileId = tile.id;
    routeToTarget(tile);
}
export function hasFocusedTextInputTarget() {
    return textInputFocusActive || isTextInputTarget(document.activeElement);
}
function cancelScheduledFocusRouteSync() {
    if (focusRouteSyncTimeout != null) {
        clearTimeout(focusRouteSyncTimeout);
        focusRouteSyncTimeout = null;
    }
    focusRouteSyncTileId = null;
}
function syncPrimaryRouteIfNeeded() {
    cancelScheduledFocusRouteSync();
    const primary = getPrimaryTileForWorkspace();
    if (!primary || sameTarget(getCurrentSelectedTarget(), primary))
        return;
    routeToTileById(primary.id);
}
function scheduleFocusRouteSync(tileId) {
    focusRouteSyncTileId = tileId;
    if (focusRouteSyncTimeout != null)
        clearTimeout(focusRouteSyncTimeout);
    focusRouteSyncTimeout = window.setTimeout(() => {
        const targetTileId = focusRouteSyncTileId;
        focusRouteSyncTimeout = null;
        focusRouteSyncTileId = null;
        if (!running || !targetTileId)
            return;
        if (hasFocusedTextInputTarget())
            return;
        promoteTileToPrimary(targetTileId);
        routeToTileById(targetTileId);
    }, FOCUS_ROUTE_SYNC_DELAY_MS);
}
export function syncRouteTarget(target) {
    if (!running || !target)
        return;
    cancelScheduledFocusRouteSync();
    if (restoreSyncPending) {
        restoreSyncPending = false;
        const persistedPrimary = getPrimaryTileForWorkspace();
        if (persistedPrimary && !sameTarget(persistedPrimary, target)) {
            routeToTileById(persistedPrimary.id);
            return;
        }
    }
    const workspace = getWorkspaceSnapshot();
    if (!workspace.rootNodeId && !workspace.floatingTileIds.length) {
        updatePrimaryTileTarget(target);
        return;
    }
    const primary = getPrimaryTileForWorkspace();
    if (pendingRouteSyncTileId) {
        if (primary?.id === pendingRouteSyncTileId && sameTarget(primary, target)) {
            pendingRouteSyncTileId = null;
            return;
        }
        pendingRouteSyncTileId = null;
    }
    if (primary && !sameTarget(primary, target) && hasVoiceRouteTileConflict(target, primary.id)) {
        pendingRouteSyncTileId = primary.id;
        routeToTarget(primary);
        return;
    }
    const channel = ChannelStore.getChannel(target.channelId);
    if (channel?.parent_id) {
        const primaryId = primary?.id;
        for (const tileId of Object.values(workspace.nodesById).flatMap(node => node.kind === "leaf" ? node.tileIds : [])) {
            if (tileId === primaryId)
                continue;
            const tile = getTileById(tileId);
            if (tile?.channelId === channel.parent_id) {
                updateTileTarget(tileId, target);
                if (primary) {
                    pendingRouteSyncTileId = primary.id;
                    routeToTarget(primary);
                }
                return;
            }
        }
    }
    updatePrimaryTileTarget(target);
}
function focusTileAndNavigate(tileId, immediate = false) {
    if (hasFocusedTextInputTarget())
        return false;
    if (immediate) {
        cancelScheduledFocusRouteSync();
        const tile = getTileById(tileId);
        if (!tile)
            return false;
        if (!focusTile(tileId, true))
            return false;
        if (!sameTarget(getCurrentSelectedTarget(), tile))
            routeToTileById(tileId);
        return true;
    }
    const focused = focusTile(tileId, false);
    const alreadyPrimary = getPrimaryTileForWorkspace()?.id === tileId;
    if (!focused && alreadyPrimary)
        return false;
    scheduleFocusRouteSync(tileId);
    return true;
}
export function openTargetAsTile(target, openedBy = "user") {
    if (!running)
        return null;
    cancelScheduledFocusRouteSync();
    const result = openTile(target, { openedBy });
    if (result.focused && result.tileId)
        routeToTileById(result.tileId);
    return result.tileId;
}
export function openCurrentAsTile() {
    const target = getCurrentSelectedTarget();
    if (!target)
        return null;
    return openTargetAsTile(target);
}
export function focusTileById(tileId) {
    if (!running)
        return false;
    return focusTileAndNavigate(tileId, true);
}
export function focusPreviousTileAndNavigate() {
    if (!running)
        return false;
    const tileId = focusPreviousTile();
    if (!tileId)
        return false;
    scheduleFocusRouteSync(tileId);
    return true;
}
export function closeFocusedTileAndNavigate() {
    if (!running)
        return false;
    cancelScheduledFocusRouteSync();
    const before = getPrimaryTileForWorkspace();
    const success = closeFocusedTile();
    if (!success)
        return false;
    const nextPrimary = getPrimaryTileForWorkspace();
    if (before?.id !== nextPrimary?.id)
        routeToTileById(nextPrimary?.id ?? null);
    return true;
}
export function closeSpecificTileAndNavigate(tileId) {
    if (!running)
        return false;
    cancelScheduledFocusRouteSync();
    const before = getPrimaryTileForWorkspace();
    const success = closeTileById(tileId);
    if (!success)
        return false;
    const nextPrimary = getPrimaryTileForWorkspace();
    if (before?.id !== nextPrimary?.id)
        routeToTileById(nextPrimary?.id ?? null);
    return true;
}
export function moveFocusAndNavigate(direction) {
    if (!running)
        return false;
    const nextId = moveFocusDirection(direction, void 0, false);
    if (!nextId)
        return false;
    scheduleFocusRouteSync(nextId);
    return true;
}
export function swapTiles(direction) {
    if (!running)
        return false;
    if (!swapDirection(direction))
        return false;
    syncPrimaryRouteIfNeeded();
    return true;
}
export function setLayoutMode(layout) {
    if (!running)
        return false;
    return setLayout(layout);
}
export function cycleLayoutMode() {
    if (!running)
        return null;
    return cycleLayout();
}
export function adjustMasterRatio(delta) {
    if (!running)
        return false;
    return adjustActiveWorkspaceMasterRatio(delta);
}
export function focusMasterAndNavigate() {
    if (!running)
        return false;
    const tileId = focusMasterTile(false);
    if (!tileId)
        return false;
    scheduleFocusRouteSync(tileId);
    return true;
}
export function swapWithMaster() {
    if (!running)
        return false;
    if (!swapFocusedWithMaster())
        return false;
    syncPrimaryRouteIfNeeded();
    return true;
}
export function cycleGroupTabs(step) {
    if (!running)
        return false;
    const tileId = cycleFocusedLeafTab(step);
    if (!tileId)
        return false;
    scheduleFocusRouteSync(tileId);
    return true;
}
export function createNewTabGroup() {
    if (!running)
        return false;
    const groupName = moveFocusedTileIntoNewGroup();
    if (!groupName)
        return false;
    showToast(`Created tab group ${groupName}.`, Toasts.Type.SUCCESS);
    return true;
}
export function sendFocusedToNamedGroup(groupName) {
    if (!running)
        return false;
    const tileId = sendFocusedTileToNamedGroupStore(groupName);
    if (!tileId)
        return false;
    scheduleFocusRouteSync(tileId);
    return true;
}
export function toggleOverviewVisibility() {
    if (!running)
        return false;
    toggleWorkspaceOverview();
    return true;
}
export function toggleAutoLayoutMode() {
    if (!running)
        return false;
    toggleWorkspaceAutoLayout();
    return true;
}
export function toggleFloatingFocusedTileAndNavigate() {
    if (!running)
        return false;
    if (!toggleFocusedTileFloating())
        return false;
    const nextPrimary = getPrimaryTileForWorkspace();
    routeToTileById(nextPrimary?.id ?? null);
    return true;
}
export function togglePinnedFocusedTileAndNavigate() {
    if (!running)
        return false;
    if (!toggleFocusedTilePinned())
        return false;
    const nextPrimary = getPrimaryTileForWorkspace();
    routeToTileById(nextPrimary?.id ?? null);
    return true;
}
export function jumpPinnedAndNavigate() {
    if (!running)
        return false;
    const tileId = cyclePinnedTileFocus();
    if (!tileId)
        return false;
    scheduleFocusRouteSync(tileId);
    return true;
}
export function toggleScratchpadById(id) {
    if (!running || !id)
        return false;
    const tileId = toggleScratchpad(id);
    if (!tileId)
        return false;
    routeToTileById(getPrimaryTileForWorkspace()?.id ?? tileId);
    return true;
}
export function moveTileByDropAndNavigate(tileId, targetTileId, zone, groupOnCenter = false) {
    if (!running)
        return false;
    const moved = moveTileByDrop(tileId, targetTileId, zone, groupOnCenter);
    if (!moved)
        return false;
    scheduleFocusRouteSync(tileId);
    return true;
}
export function switchWorkspaceAndNavigate(index) {
    if (!running)
        return false;
    cancelScheduledFocusRouteSync();
    const changed = setActiveWorkspace(index);
    if (!changed)
        return false;
    const targetTile = getPrimaryTileForWorkspace(index);
    if (targetTile) {
        routeToTileById(targetTile.id);
        return true;
    }
    const current = getCurrentSelectedTarget();
    if (current) {
        seedWorkspaceFromTarget(index, current);
        return true;
    }
    return true;
}
export function moveFocusedToWorkspace(index) {
    if (!running)
        return false;
    cancelScheduledFocusRouteSync();
    const sourceWorkspace = getActiveWorkspaceIndex();
    const movedId = moveFocusedTileToWorkspace(index);
    if (!movedId)
        return false;
    const sourcePrimary = getPrimaryTileForWorkspace(sourceWorkspace);
    if (sourcePrimary)
        routeToTileById(sourcePrimary.id);
    return true;
}
export function makeTargetFromChannel(channel) {
    if (!channel?.id)
        return null;
    return {
        channelId: channel.id,
        guildId: channel.guild_id ?? null
    };
}
export async function makeTargetFromUser(user) {
    if (!user?.id)
        return null;
    if (UserStore.getCurrentUser()?.id === user.id)
        return null;
    const channelId = await ChannelActionCreators.getOrEnsurePrivateChannel(user.id);
    const channel = ChannelStore.getChannel(channelId);
    return makeTargetFromChannel(channel);
}
function extractSelectableChannelFromCollection(value) {
    if (!value)
        return null;
    if (Array.isArray(value)) {
        for (const item of value) {
            const maybeChannel = item && typeof item === "object" && "channel" in item
                ? item.channel
                : item;
            if (maybeChannel?.id)
                return maybeChannel;
        }
        return null;
    }
    if (typeof value === "object" && "channel" in value) {
        const { channel } = value;
        return channel?.id ? channel : null;
    }
    return null;
}
export function makeTargetFromGuild(guild) {
    if (!guild?.id)
        return null;
    const selectedChannelId = SelectedChannelStore.getChannelId();
    if (selectedChannelId) {
        const selected = ChannelStore.getChannel(selectedChannelId);
        if (selected?.guild_id === guild.id)
            return makeTargetFromChannel(selected);
    }
    const defaultChannel = GuildChannelStore.getDefaultChannel?.(guild.id);
    if (defaultChannel?.id)
        return makeTargetFromChannel(defaultChannel);
    const selectable = GuildChannelStore.getSelectableChannels?.(guild.id);
    const selectableChannel = extractSelectableChannelFromCollection(selectable);
    if (selectableChannel)
        return makeTargetFromChannel(selectableChannel);
    const all = GuildChannelStore.getChannels?.(guild.id);
    if (all && typeof all === "object") {
        const groups = all;
        for (const key of ["SELECTABLE", "VOCAL"]) {
            const channel = extractSelectableChannelFromCollection(groups[key]);
            if (channel)
                return makeTargetFromChannel(channel);
        }
    }
    return null;
}
export function getTileDisplayInfo(tile) {
    const channel = ChannelStore.getChannel(tile.channelId);
    if (!channel)
        return { title: "Unavailable", badge: "MISSING" };
    const guildName = channel.guild_id ? GuildStore.getGuild(channel.guild_id)?.name ?? null : null;
    if (channel.isThread?.()) {
        return {
            title: sanitizeTileHeaderText(channel.name, "Thread"),
            badge: sanitizeTileHeaderText(guildName, "Thread")
        };
    }
    if (channel.isForumLikeChannel?.()) {
        return {
            title: sanitizeTileHeaderText(channel.name, "Forum"),
            badge: sanitizeTileHeaderText(guildName, "Forum")
        };
    }
    if (channel.isPrivate?.()) {
        if (channel.isDM?.()) {
            const recipientId = channel.getRecipientId?.();
            const user = recipientId ? UserStore.getUser(recipientId) : null;
            const name = recipientId ? RelationshipStore.getNickname(recipientId) || user?.globalName || user?.username : null;
            return {
                title: sanitizeTileHeaderText(name || channel.name, "Direct Message"),
                badge: sanitizeTileHeaderText(name || channel.name, "DM")
            };
        }
        return {
            title: sanitizeTileHeaderText(channel.name, "Group DM"),
            badge: sanitizeTileHeaderText(channel.name, "Group DM")
        };
    }
    return {
        title: sanitizeTileHeaderText(channel.name ? `#${channel.name}` : null, "Channel"),
        badge: sanitizeTileHeaderText(guildName, "Server")
    };
}
function getSettingKeybind(action) {
    return settings.store[getKeybindSettingKey(action)] ?? "";
}
function parseWorkspaceAction(action, prefix) {
    if (!action.startsWith(prefix))
        return null;
    const index = Number(action.slice(prefix.length));
    return workspaceIndexMap.includes(index) ? index : null;
}
function triggerAction(action) {
    switch (action) {
        case "openCurrent": return !!openCurrentAsTile();
        case "closeFocused": return closeFocusedTileAndNavigate();
        case "layoutDwindle": return setLayoutMode("dwindle");
        case "layoutGrid": return setLayoutMode("grid");
        case "layoutColumns": return setLayoutMode("columns");
        case "layoutMaster": return setLayoutMode("master");
        case "cycleLayout": return !!cycleLayoutMode();
        case "focusLeft": return moveFocusAndNavigate("left");
        case "focusRight": return moveFocusAndNavigate("right");
        case "focusUp": return moveFocusAndNavigate("up");
        case "focusDown": return moveFocusAndNavigate("down");
        case "focusPrevious": return focusPreviousTileAndNavigate();
        case "swapLeft": return swapTiles("left");
        case "swapRight": return swapTiles("right");
        case "swapUp": return swapTiles("up");
        case "swapDown": return swapTiles("down");
        case "focusMaster": return focusMasterAndNavigate();
        case "swapWithMaster": return swapWithMaster();
        case "masterRatioDown": return adjustMasterRatio(-0.05);
        case "masterRatioUp": return adjustMasterRatio(0.05);
        case "nextTab": return cycleGroupTabs(1);
        case "prevTab": return cycleGroupTabs(-1);
        case "newTabGroup": return createNewTabGroup();
        case "toggleOverview": return toggleOverviewVisibility();
        case "toggleAutoLayout": return toggleAutoLayoutMode();
        case "toggleFloat": return toggleFloatingFocusedTileAndNavigate();
        case "togglePin": return togglePinnedFocusedTileAndNavigate();
        case "jumpPinned": return jumpPinnedAndNavigate();
        case "reloadRules":
            void reloadHyprTilesRules();
            return true;
    }
    const workspaceIndex = parseWorkspaceAction(action, "workspace");
    if (workspaceIndex)
        return switchWorkspaceAndNavigate(workspaceIndex);
    const moveToWorkspaceIndex = parseWorkspaceAction(action, "moveToWorkspace");
    if (moveToWorkspaceIndex)
        return moveFocusedToWorkspace(moveToWorkspaceIndex);
    return false;
}
function onKeyDown(event) {
    if (!running)
        return;
    if (!event.altKey && !event.ctrlKey && !event.metaKey && isEditableTarget(event.target))
        return;
    for (const action of allActions) {
        const keybind = getSettingKeybind(action);
        if (!keybind || !matchesKeybind(event, keybind))
            continue;
        if (!triggerAction(action))
            continue;
        event.preventDefault();
        event.stopPropagation();
        return;
    }
}
export function attachKeyListener() {
    if (keyListenerAttached)
        return;
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onTextInputFocusIn, true);
    document.addEventListener("focusout", onTextInputFocusOut, true);
    keyListenerAttached = true;
}
export function detachKeyListener() {
    if (!keyListenerAttached)
        return;
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("focusin", onTextInputFocusIn, true);
    document.removeEventListener("focusout", onTextInputFocusOut, true);
    keyListenerAttached = false;
}
