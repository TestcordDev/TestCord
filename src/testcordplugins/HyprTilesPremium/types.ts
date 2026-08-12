/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type HyprTilesLayout = "single" | "dwindle" | "master" | "grid" | "columns";
export type ManualHyprTilesLayout = Exclude<HyprTilesLayout, "single">;
export type Direction = "left" | "right" | "up" | "down";
export type WorkspaceIndex = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type SplitAxis = "x" | "y";
export type OpenedBy = "user" | "rule" | "dragDrop" | "restore" | "contextMenu";
export type HyprTilesChannelKind = "guildText" | "dm" | "groupDm" | "thread" | "forumPost" | "voice" | "stage" | "announcement" | "unknown";

export interface TileTarget {
    channelId: string;
    guildId: string | null;
}

export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface FloatBounds extends Rect {}

export interface TileRestoreState {
    workspaceId: WorkspaceIndex;
    anchorNodeId: string | null;
    direction: Direction | null;
    leafId: string | null;
    tabIndex: number;
    tabGroupName: string | null;
}

export interface TileEntity extends TileTarget {
    id: string;
    createdAt: number;
    workspaceId: WorkspaceIndex;
    openedBy: OpenedBy;
    floating: boolean;
    pinned: boolean;
    scratchpadId: string | null;
    floatBounds: FloatBounds | null;
    restoreState: TileRestoreState | null;
}

export interface LayoutLeafNode {
    id: string;
    kind: "leaf";
    tileIds: string[];
    activeTileId: string;
    tabGroupName: string | null;
}

export interface LayoutSplitNode {
    id: string;
    kind: "split";
    axis: SplitAxis;
    ratio: number;
    firstId: string;
    secondId: string;
}

export type WorkspaceNode = LayoutLeafNode | LayoutSplitNode;

export interface WorkspaceState {
    id: WorkspaceIndex;
    rootNodeId: string | null;
    nodesById: Record<string, WorkspaceNode>;
    focusedTileId: string | null;
    primaryTileId: string | null;
    lastFocusedTileId: string | null;
    floatingTileIds: string[];
    layout: HyprTilesLayout;
    masterRatio: number;
    autoLayout: boolean;
}

export interface ScratchpadState {
    id: string;
    tileId: string | null;
    workspaceId: WorkspaceIndex | null;
    visible: boolean;
    bounds: FloatBounds;
}

export interface HyprTilesPersistedState {
    version: 2;
    activeWorkspace: WorkspaceIndex;
    workspaces: Record<string, WorkspaceState>;
    tilesById: Record<string, TileEntity>;
    pinnedTileIds: string[];
    scratchpadsById: Record<string, ScratchpadState>;
}

export interface LayoutRects {
    orderedIds: string[];
    rects: Record<string, Rect>;
    leafRects: Record<string, Rect>;
    nodeRects: Record<string, Rect>;
    tileToLeafId: Record<string, string>;
}

export interface RouteParamsLike {
    guildId?: string;
    channelId?: string;
    threadId?: string;
    messageId?: string;
}

export interface RouteRenderPropsLike {
    match?: {
        params?: RouteParamsLike;
    };
}

export interface TileDisplayInfo {
    title: string;
    badge: string;
}

export interface RegexMatcher {
    regex: string;
    flags?: string;
}

export type StringMatcher = string | RegexMatcher;

export interface HyprTilesRuleMatch {
    guildId?: StringMatcher;
    channelId?: StringMatcher;
    parentId?: StringMatcher;
    type?: HyprTilesChannelKind | HyprTilesChannelKind[];
    channelName?: StringMatcher;
    guildName?: StringMatcher;
    isThread?: boolean;
    isNSFW?: boolean;
    isPrivate?: boolean;
    openedBy?: OpenedBy | OpenedBy[];
}

export interface HyprTilesRuleActions {
    workspace?: WorkspaceIndex;
    split?: Direction;
    replace?: boolean;
    float?: boolean;
    tabGroup?: string;
    scratchpadId?: string;
    focus?: boolean;
    layoutHint?: HyprTilesLayout;
}

export interface HyprTilesRule {
    name?: string;
    priority?: number;
    match?: HyprTilesRuleMatch;
    actions?: HyprTilesRuleActions;
}

export interface AutoLayoutRule {
    minTiles: number;
    layout: HyprTilesLayout;
}

export interface HyprTilesRulesConfig {
    autoLayouts: AutoLayoutRule[];
    backgroundThrottleMinutes: number;
    rules: HyprTilesRule[];
}

export interface HyprTilesRuleContext extends TileTarget {
    parentId: string | null;
    type: HyprTilesChannelKind;
    channelName: string | null;
    guildName: string | null;
    isThread: boolean;
    isNSFW: boolean;
    isPrivate: boolean;
    openedBy: OpenedBy;
}

export interface TileOpenPlan extends HyprTilesRuleActions {
    workspace?: WorkspaceIndex;
    focus: boolean;
}

export interface TileOpenOptions {
    openedBy: OpenedBy;
    allowDuplicates?: boolean;
    forcePlan?: Partial<TileOpenPlan>;
}

export interface TileOpenResult {
    tileId: string | null;
    workspaceId: WorkspaceIndex;
    focused: boolean;
}

export type DropZone = Direction | "center";
export type ResizeEdge = "left" | "right" | "up" | "down";
