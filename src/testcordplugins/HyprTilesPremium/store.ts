/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { SettingsStore } from "@api/Settings";
import { proxyLazy } from "@utils/lazy";
import { FluxStore } from "@vencord/discord-types";
import { Flux as FluxWP, FluxDispatcher } from "@webpack/common";

import { computeLayoutRects, findDirectionalCandidate, findLeafByTileId, getLeafIds } from "./utils/layout";
import { buildRuleContext, evaluateRules, getAutoLayoutForTileCount } from "./utils/rules";
import { settings } from "./settings";
import {
    Direction,
    DropZone,
    FloatBounds,
    HyprTilesLayout,
    HyprTilesPersistedState,
    LayoutLeafNode,
    LayoutSplitNode,
    ManualHyprTilesLayout,
    OpenedBy,
    ScratchpadState,
    TileEntity,
    TileOpenOptions,
    TileOpenResult,
    TileRestoreState,
    TileTarget,
    WorkspaceIndex,
    WorkspaceNode,
    WorkspaceState,
} from "./types";

interface IFlux {
    PersistedStore: typeof FluxStore;
}

const { PersistedStore } = (FluxWP as typeof FluxWP & IFlux);

const WORKSPACE_IDS: WorkspaceIndex[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const MANUAL_LAYOUTS: ManualHyprTilesLayout[] = ["dwindle", "master", "grid", "columns"];
const STATE_VERSION = 2 as const;
const DEFAULT_MASTER_RATIO = 0.6;
const DEFAULT_FLOAT_BOUNDS: FloatBounds = { x: 0.16, y: 0.1, w: 0.68, h: 0.78 };
const DEFAULT_SCRATCHPAD_BOUNDS: FloatBounds = { x: 0.14, y: 0.08, w: 0.72, h: 0.82 };
const MIN_SPLIT_RATIO = 0.12;
const PINNED_TILE_MAX = 6;

let state: HyprTilesPersistedState;
let revision = 0;
let overviewVisible = false;
let newGroupCount = 0;
let appliedLayoutSettingsKey = "";

const isLeaf = (node: WorkspaceNode | null | undefined): node is LayoutLeafNode => node?.kind === "leaf";
const isSplit = (node: WorkspaceNode | null | undefined): node is LayoutSplitNode => node?.kind === "split";
const cloneBounds = (bounds: FloatBounds) => ({ ...bounds });
const clampMasterRatio = (value: number) => Math.max(0.3, Math.min(0.75, value));
const clampSplitRatio = (value: number) => Math.max(MIN_SPLIT_RATIO, Math.min(1 - MIN_SPLIT_RATIO, value));
const defaultLayout = (): ManualHyprTilesLayout => {
    const layout = settings.store.defaultLayout;
    return MANUAL_LAYOUTS.includes(layout as ManualHyprTilesLayout) ? layout as ManualHyprTilesLayout : "dwindle";
};
const createId = (prefix: string) => `hypr-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createWorkspace = (id: WorkspaceIndex): WorkspaceState => ({
    id,
    rootNodeId: null,
    nodesById: {},
    focusedTileId: null,
    primaryTileId: null,
    lastFocusedTileId: null,
    floatingTileIds: [],
    layout: defaultLayout(),
    masterRatio: DEFAULT_MASTER_RATIO,
    autoLayout: false
});

const createDefaultState = (): HyprTilesPersistedState => ({
    version: STATE_VERSION,
    activeWorkspace: 1,
    workspaces: Object.fromEntries(WORKSPACE_IDS.map(id => [String(id), createWorkspace(id)])),
    tilesById: {},
    pinnedTileIds: [],
    scratchpadsById: {}
});

const getLayoutSettingsKey = () => `${settings.store.defaultLayout}:${settings.store.enableRulesFile ? 1 : 0}`;
const getLayoutFromSettingsKey = (value: string) => {
    const [layout] = value.split(":");
    return MANUAL_LAYOUTS.includes(layout as ManualHyprTilesLayout) ? layout as ManualHyprTilesLayout : null;
};

function normalizeWorkspaceId(value: unknown): WorkspaceIndex | null {
    const workspaceId = Number(value);
    return WORKSPACE_IDS.includes(workspaceId as WorkspaceIndex) ? workspaceId as WorkspaceIndex : null;
}

function normalizeOpenedBy(value: unknown): OpenedBy | null {
    switch (value) {
        case "user":
        case "rule":
        case "dragDrop":
        case "restore":
        case "contextMenu":
            return value;
        default:
            return null;
    }
}

function normalizeRestoreState(value: unknown): TileRestoreState | null {
    if (!value || typeof value !== "object") return null;

    const workspaceId = normalizeWorkspaceId((value as TileRestoreState).workspaceId);
    if (!workspaceId) return null;

    return {
        workspaceId,
        anchorNodeId: typeof (value as TileRestoreState).anchorNodeId === "string" ? (value as TileRestoreState).anchorNodeId : null,
        direction: (value as TileRestoreState).direction === "left"
            || (value as TileRestoreState).direction === "right"
            || (value as TileRestoreState).direction === "up"
            || (value as TileRestoreState).direction === "down"
            ? (value as TileRestoreState).direction
            : null,
        leafId: typeof (value as TileRestoreState).leafId === "string" ? (value as TileRestoreState).leafId : null,
        tabIndex: Number.isInteger((value as TileRestoreState).tabIndex) ? (value as TileRestoreState).tabIndex : 0,
        tabGroupName: typeof (value as TileRestoreState).tabGroupName === "string" ? (value as TileRestoreState).tabGroupName : null,
    };
}

function normalizeBounds(value: unknown, fallback: FloatBounds) {
    if (!value || typeof value !== "object") return cloneBounds(fallback);

    const x = Number((value as FloatBounds).x);
    const y = Number((value as FloatBounds).y);
    const w = Number((value as FloatBounds).w);
    const h = Number((value as FloatBounds).h);

    return {
        x: Number.isFinite(x) ? Math.max(0, Math.min(0.9, x)) : fallback.x,
        y: Number.isFinite(y) ? Math.max(0, Math.min(0.9, y)) : fallback.y,
        w: Number.isFinite(w) ? Math.max(0.2, Math.min(1, w)) : fallback.w,
        h: Number.isFinite(h) ? Math.max(0.2, Math.min(1, h)) : fallback.h,
    };
}

function getWorkspace(id: WorkspaceIndex = state.activeWorkspace) {
    return state.workspaces[String(id)];
}

function emitChange() {
    revision++;
    HyprTilesStore.emitChange();
}

function createTile(target: TileTarget, workspaceId: WorkspaceIndex, openedBy: OpenedBy): TileEntity {
    return {
        id: createId("tile"),
        channelId: target.channelId,
        guildId: target.guildId ?? null,
        createdAt: Date.now(),
        workspaceId,
        openedBy,
        floating: false,
        pinned: false,
        scratchpadId: null,
        floatBounds: null,
        restoreState: null,
    };
}

function createLeaf(tileId: string, tabGroupName: string | null = null): LayoutLeafNode {
    return {
        id: createId("leaf"),
        kind: "leaf",
        tileIds: [tileId],
        activeTileId: tileId,
        tabGroupName
    };
}

function createScratchpad(id: string): ScratchpadState {
    return {
        id,
        tileId: null,
        workspaceId: null,
        visible: false,
        bounds: cloneBounds(DEFAULT_SCRATCHPAD_BOUNDS)
    };
}

function setNode(workspace: WorkspaceState, node: WorkspaceNode) {
    workspace.nodesById[node.id] = node;
    return node;
}

function findParentInfo(workspace: WorkspaceState, targetId: string, nodeId: string | null = workspace.rootNodeId): { parent: LayoutSplitNode | null; side: "firstId" | "secondId" | null; } {
    if (!nodeId) return { parent: null, side: null };
    const node = workspace.nodesById[nodeId];
    if (!isSplit(node)) return { parent: null, side: null };

    if (node.firstId === targetId) return { parent: node, side: "firstId" };
    if (node.secondId === targetId) return { parent: node, side: "secondId" };

    const first = findParentInfo(workspace, targetId, node.firstId);
    return first.parent ? first : findParentInfo(workspace, targetId, node.secondId);
}

function replaceNodeReference(workspace: WorkspaceState, oldId: string, nextId: string | null) {
    const { parent, side } = findParentInfo(workspace, oldId);
    if (!parent || !side) {
        workspace.rootNodeId = nextId;
        return;
    }

    parent[side] = nextId ?? "";
}

function removeNode(workspace: WorkspaceState, nodeId: string) {
    delete workspace.nodesById[nodeId];
}

function keepOnlyLeafNodes(workspace: WorkspaceState, leafIds: string[]) {
    workspace.nodesById = Object.fromEntries(leafIds
        .map(leafId => workspace.nodesById[leafId])
        .filter(isLeaf)
        .map(leaf => [leaf.id, leaf]));
}

function buildColumnsTree(workspace: WorkspaceState, nodeIds: string[]): string | null {
    if (!nodeIds.length) return null;
    if (nodeIds.length === 1) return nodeIds[0];

    const [firstId, ...rest] = nodeIds;
    const secondId = buildColumnsTree(workspace, rest);
    if (!secondId) return firstId;

    return setNode(workspace, {
        id: createId("split"),
        kind: "split",
        axis: "x",
        ratio: 1 / nodeIds.length,
        firstId,
        secondId
    }).id;
}

function buildRowsTree(workspace: WorkspaceState, nodeIds: string[]): string | null {
    if (!nodeIds.length) return null;
    if (nodeIds.length === 1) return nodeIds[0];

    const [firstId, ...rest] = nodeIds;
    const secondId = buildRowsTree(workspace, rest);
    if (!secondId) return firstId;

    return setNode(workspace, {
        id: createId("split"),
        kind: "split",
        axis: "y",
        ratio: 1 / nodeIds.length,
        firstId,
        secondId
    }).id;
}

function buildDwindleTree(workspace: WorkspaceState, nodeIds: string[], axis: "x" | "y" = "x"): string | null {
    if (!nodeIds.length) return null;
    if (nodeIds.length === 1) return nodeIds[0];

    const [firstId, ...rest] = nodeIds;
    const secondId = buildDwindleTree(workspace, rest, axis === "x" ? "y" : "x");
    if (!secondId) return firstId;

    return setNode(workspace, {
        id: createId("split"),
        kind: "split",
        axis,
        ratio: 0.5,
        firstId,
        secondId
    }).id;
}

function buildGridTree(workspace: WorkspaceState, nodeIds: string[]): string | null {
    if (!nodeIds.length) return null;
    if (nodeIds.length === 1) return nodeIds[0];

    const cols = Math.ceil(Math.sqrt(nodeIds.length));
    const rowRoots: string[] = [];

    for (let index = 0; index < nodeIds.length; index += cols) {
        const rowRoot = buildColumnsTree(workspace, nodeIds.slice(index, index + cols));
        if (rowRoot) rowRoots.push(rowRoot);
    }

    return buildRowsTree(workspace, rowRoots);
}

function buildMasterTree(workspace: WorkspaceState, nodeIds: string[]): string | null {
    if (!nodeIds.length) return null;
    if (nodeIds.length === 1) return nodeIds[0];

    const [masterId, ...stackIds] = nodeIds;
    const stackRoot = buildRowsTree(workspace, stackIds);
    if (!stackRoot) return masterId;

    return setNode(workspace, {
        id: createId("split"),
        kind: "split",
        axis: "x",
        ratio: workspace.masterRatio,
        firstId: masterId,
        secondId: stackRoot
    }).id;
}

function rebuildWorkspaceTree(workspace: WorkspaceState, layout: HyprTilesLayout = workspace.layout) {
    const leafIds = getLeafIds(workspace);
    keepOnlyLeafNodes(workspace, leafIds);

    switch (layout) {
        case "single":
            workspace.rootNodeId = leafIds[0] ?? null;
            break;
        case "columns":
            workspace.rootNodeId = buildColumnsTree(workspace, leafIds);
            break;
        case "grid":
            workspace.rootNodeId = buildGridTree(workspace, leafIds);
            break;
        case "master":
            workspace.rootNodeId = buildMasterTree(workspace, leafIds);
            break;
        case "dwindle":
        default:
            workspace.rootNodeId = buildDwindleTree(workspace, leafIds);
            break;
    }
}

function getWorkspaceScratchpadTileIds(workspaceId: WorkspaceIndex, currentState: HyprTilesPersistedState = state) {
    return Object.values(currentState.scratchpadsById)
        .filter(scratchpad => scratchpad.visible && scratchpad.workspaceId === workspaceId && scratchpad.tileId)
        .map(scratchpad => scratchpad.tileId!)
        .filter(tileId => !!currentState.tilesById[tileId]);
}

function getWorkspaceFocusableTileIds(workspace: WorkspaceState, currentState: HyprTilesPersistedState = state) {
    const tiledIds = getLeafIds(workspace)
        .map(leafId => workspace.nodesById[leafId])
        .filter(isLeaf)
        .map(leaf => leaf.activeTileId)
        .filter(tileId => !!currentState.tilesById[tileId]);

    return [
        ...tiledIds,
        ...workspace.floatingTileIds.filter(tileId => !!currentState.tilesById[tileId]),
        ...getWorkspaceScratchpadTileIds(workspace.id, currentState),
        ...currentState.pinnedTileIds.filter(tileId => !!currentState.tilesById[tileId])
    ];
}

function normalizeLeaf(leaf: LayoutLeafNode, currentState: HyprTilesPersistedState = state) {
    const uniqueIds = [...new Set(leaf.tileIds.filter(tileId => !!currentState.tilesById[tileId]))];
    leaf.tileIds = uniqueIds;
    leaf.activeTileId = uniqueIds.includes(leaf.activeTileId) ? leaf.activeTileId : uniqueIds[0] ?? "";
}

function normalizeWorkspaceRefs(workspace: WorkspaceState, currentState: HyprTilesPersistedState = state) {
    for (const leafId of getLeafIds(workspace)) {
        const leaf = workspace.nodesById[leafId];
        if (!isLeaf(leaf)) continue;
        normalizeLeaf(leaf, currentState);
        if (!leaf.tileIds.length) removeNode(workspace, leaf.id);
    }

    workspace.layout = workspace.layout === "single" || MANUAL_LAYOUTS.includes(workspace.layout as ManualHyprTilesLayout)
        ? workspace.layout
        : defaultLayout();
    workspace.masterRatio = clampMasterRatio(workspace.masterRatio);
    workspace.floatingTileIds = [...new Set(workspace.floatingTileIds.filter(tileId => !!currentState.tilesById[tileId]))];

    const focusable = getWorkspaceFocusableTileIds(workspace, currentState);
    if (!focusable.length) {
        workspace.focusedTileId = null;
        workspace.primaryTileId = null;
        workspace.lastFocusedTileId = null;
        return;
    }

    if (!workspace.focusedTileId || !focusable.includes(workspace.focusedTileId))
        workspace.focusedTileId = focusable[0];

    if (!workspace.primaryTileId || !focusable.includes(workspace.primaryTileId))
        workspace.primaryTileId = workspace.focusedTileId;

    if (workspace.lastFocusedTileId && !focusable.includes(workspace.lastFocusedTileId))
        workspace.lastFocusedTileId = focusable.find(tileId => tileId !== workspace.focusedTileId) ?? null;
}

function syncWorkspaceLayoutsToSettings(currentState: HyprTilesPersistedState = state) {
    let changed = false;
    const fallbackLayout = defaultLayout();
    const previousFallbackLayout = getLayoutFromSettingsKey(appliedLayoutSettingsKey);

    for (const workspaceId of WORKSPACE_IDS) {
        const workspace = currentState.workspaces[String(workspaceId)];
        const tiledLeafCount = getLeafIds(workspace).length;
        const hasOverlayTiles = workspace.floatingTileIds.length > 0 || getWorkspaceScratchpadTileIds(workspace.id, currentState).length > 0;

        if (workspace.autoLayout) {
            const nextLayout = getAutoLayoutForTileCount(Math.max(1, tiledLeafCount));
            if (workspace.layout !== nextLayout) {
                workspace.layout = nextLayout;
                rebuildWorkspaceTree(workspace, nextLayout);
                changed = true;
            }
            continue;
        }

        if (previousFallbackLayout && workspace.layout === previousFallbackLayout && workspace.layout !== fallbackLayout) {
            workspace.layout = fallbackLayout;
            if (tiledLeafCount) rebuildWorkspaceTree(workspace, fallbackLayout);
            changed = true;
            continue;
        }

        if (!tiledLeafCount && !hasOverlayTiles && workspace.layout !== fallbackLayout) {
            workspace.layout = fallbackLayout;
            changed = true;
        }
    }

    if (changed) {
        for (const workspaceId of WORKSPACE_IDS) {
            normalizeWorkspaceRefs(currentState.workspaces[String(workspaceId)], currentState);
        }
    }

    appliedLayoutSettingsKey = getLayoutSettingsKey();
    return changed;
}

function insertNodeRelative(workspace: WorkspaceState, targetNodeId: string | null, newNodeId: string, direction: Direction) {
    if (!workspace.rootNodeId || !targetNodeId || !workspace.nodesById[targetNodeId]) {
        workspace.rootNodeId = workspace.rootNodeId ?? newNodeId;
        if (workspace.rootNodeId !== newNodeId && workspace.rootNodeId)
            insertNodeRelative(workspace, workspace.rootNodeId, newNodeId, direction);
        return;
    }

    const axis = direction === "left" || direction === "right" ? "x" : "y";
    const split = setNode(workspace, {
        id: createId("split"),
        kind: "split",
        axis,
        ratio: 0.5,
        firstId: direction === "left" || direction === "up" ? newNodeId : targetNodeId,
        secondId: direction === "left" || direction === "up" ? targetNodeId : newNodeId
    });

    const { parent, side } = findParentInfo(workspace, targetNodeId);
    if (!parent || !side) {
        workspace.rootNodeId = split.id;
        return;
    }

    parent[side] = split.id;
}

function appendLeaf(workspace: WorkspaceState, leaf: LayoutLeafNode, direction: Direction = "right") {
    setNode(workspace, leaf);

    if (!workspace.rootNodeId) {
        workspace.rootNodeId = leaf.id;
        return;
    }

    const targetTileId = workspace.focusedTileId ?? workspace.primaryTileId;
    const targetLeaf = targetTileId ? findLeafByTileId(workspace, targetTileId) : null;
    insertNodeRelative(workspace, targetLeaf?.id ?? workspace.rootNodeId, leaf.id, direction);
}

function detachLeafFromTree(workspace: WorkspaceState, leafId: string) {
    const { parent, side } = findParentInfo(workspace, leafId);
    if (!parent || !side) {
        workspace.rootNodeId = null;
        removeNode(workspace, leafId);
        return { anchorNodeId: null, direction: null };
    }

    const siblingId = side === "firstId" ? parent.secondId : parent.firstId;
    const direction = parent.axis === "x"
        ? side === "firstId" ? "left" as const : "right" as const
        : side === "firstId" ? "up" as const : "down" as const;

    replaceNodeReference(workspace, parent.id, siblingId);
    removeNode(workspace, leafId);
    removeNode(workspace, parent.id);
    return { anchorNodeId: siblingId ?? null, direction };
}

function detachTileFromWorkspace(workspace: WorkspaceState, tileId: string): TileRestoreState | null {
    const leaf = findLeafByTileId(workspace, tileId);
    if (!leaf) return null;

    const tabIndex = leaf.tileIds.indexOf(tileId);
    if (tabIndex === -1) return null;

    if (leaf.tileIds.length > 1) {
        leaf.tileIds.splice(tabIndex, 1);
        if (leaf.activeTileId === tileId)
            leaf.activeTileId = leaf.tileIds[Math.min(tabIndex, leaf.tileIds.length - 1)] ?? leaf.tileIds[0];

        return {
            workspaceId: workspace.id,
            anchorNodeId: null,
            direction: null,
            leafId: leaf.id,
            tabIndex,
            tabGroupName: leaf.tabGroupName
        };
    }

    const { anchorNodeId, direction } = detachLeafFromTree(workspace, leaf.id);
    return {
        workspaceId: workspace.id,
        anchorNodeId,
        direction,
        leafId: null,
        tabIndex: 0,
        tabGroupName: leaf.tabGroupName
    };
}

function removeTileFromOverlayLists(tileId: string) {
    for (const workspaceId of WORKSPACE_IDS) {
        const workspace = getWorkspace(workspaceId);
        workspace.floatingTileIds = workspace.floatingTileIds.filter(id => id !== tileId);
    }

    state.pinnedTileIds = state.pinnedTileIds.filter(id => id !== tileId);

    for (const scratchpad of Object.values(state.scratchpadsById)) {
        if (scratchpad.tileId === tileId)
            scratchpad.visible = false;
    }
}

function placeTileInLeaf(workspace: WorkspaceState, tileId: string, leafId: string, tabIndex?: number) {
    const leaf = workspace.nodesById[leafId];
    if (!isLeaf(leaf) || leaf.tileIds.includes(tileId)) return false;

    const index = typeof tabIndex === "number"
        ? Math.max(0, Math.min(leaf.tileIds.length, tabIndex))
        : leaf.tileIds.length;

    leaf.tileIds.splice(index, 0, tileId);
    leaf.activeTileId = tileId;
    return true;
}

function restoreTileToWorkspace(tileId: string) {
    const tile = state.tilesById[tileId];
    if (!tile?.restoreState) return false;

    const restore = tile.restoreState;
    const workspace = getWorkspace(restore.workspaceId);

    removeTileFromOverlayLists(tileId);
    tile.floating = false;
    tile.pinned = false;
    tile.scratchpadId = null;

    if (restore.leafId && placeTileInLeaf(workspace, tileId, restore.leafId, restore.tabIndex)) {
        tile.workspaceId = workspace.id;
        normalizeWorkspaceRefs(workspace);
        return true;
    }

    const leaf = createLeaf(tileId, restore.tabGroupName);
    setNode(workspace, leaf);

    if (!workspace.rootNodeId) {
        workspace.rootNodeId = leaf.id;
    } else if (restore.anchorNodeId && workspace.nodesById[restore.anchorNodeId]) {
        insertNodeRelative(workspace, restore.anchorNodeId, leaf.id, restore.direction ?? "right");
    } else {
        appendLeaf(workspace, leaf);
    }

    tile.workspaceId = workspace.id;
    normalizeWorkspaceRefs(workspace);
    return true;
}

function focusLeafTile(workspace: WorkspaceState, tileId: string) {
    const leaf = findLeafByTileId(workspace, tileId);
    if (leaf) leaf.activeTileId = tileId;
}

function getNamedGroupLeaf(workspace: WorkspaceState, groupName: string) {
    for (const leafId of getLeafIds(workspace)) {
        const leaf = workspace.nodesById[leafId];
        if (isLeaf(leaf) && leaf.tabGroupName === groupName) return leaf;
    }

    return null;
}

function applyAutoLayout(workspace: WorkspaceState, layoutHint?: HyprTilesLayout) {
    if (!workspace.autoLayout) return;
    workspace.layout = layoutHint ?? getAutoLayoutForTileCount(Math.max(1, getLeafIds(workspace).length));
    rebuildWorkspaceTree(workspace, workspace.layout);
}

function addTileToNamedGroup(workspace: WorkspaceState, tileId: string, groupName: string, fallbackDirection: Direction | null = null) {
    const existing = getNamedGroupLeaf(workspace, groupName);
    if (existing) {
        placeTileInLeaf(workspace, tileId, existing.id);
        return existing.id;
    }

    const leaf = createLeaf(tileId, groupName);
    setNode(workspace, leaf);

    if (!workspace.rootNodeId) {
        workspace.rootNodeId = leaf.id;
        return leaf.id;
    }

    const focusedLeaf = workspace.focusedTileId ? findLeafByTileId(workspace, workspace.focusedTileId) : null;
    insertNodeRelative(workspace, focusedLeaf?.id ?? workspace.rootNodeId, leaf.id, fallbackDirection ?? "right");
    return leaf.id;
}

function findExistingTileByTarget(target: TileTarget, workspaceId: WorkspaceIndex) {
    for (const tile of Object.values(state.tilesById)) {
        if (!sameTarget(tile, target)) continue;
        if (tile.workspaceId === workspaceId || tile.pinned || tile.scratchpadId) return tile.id;
    }

    return null;
}

function sanitizeLegacyWorkspace(workspaceId: WorkspaceIndex, source: any, next: HyprTilesPersistedState) {
    const workspace = createWorkspace(workspaceId);
    workspace.layout = source?.layout === "master" || source?.layout === "grid" || source?.layout === "columns"
        ? source.layout
        : defaultLayout();
    workspace.masterRatio = typeof source?.masterRatio === "number" ? clampMasterRatio(source.masterRatio) : DEFAULT_MASTER_RATIO;

    const tileIds = Array.isArray(source?.tileIds)
        ? source.tileIds.filter((tileId: unknown): tileId is string => typeof tileId === "string" && !!next.tilesById[tileId])
        : [];

    for (const tileId of tileIds) {
        next.tilesById[tileId].workspaceId = workspaceId;
        setNode(workspace, createLeaf(tileId));
    }

    rebuildWorkspaceTree(workspace, workspace.layout);
    workspace.focusedTileId = typeof source?.focusedTileId === "string" && tileIds.includes(source.focusedTileId) ? source.focusedTileId : tileIds[0] ?? null;
    workspace.primaryTileId = typeof source?.primaryTileId === "string" && tileIds.includes(source.primaryTileId) ? source.primaryTileId : workspace.focusedTileId;
    next.workspaces[String(workspaceId)] = workspace;
}

function sanitizeWorkspace(workspaceId: WorkspaceIndex, source: any, next: HyprTilesPersistedState) {
    if (!source || typeof source !== "object") {
        next.workspaces[String(workspaceId)] = createWorkspace(workspaceId);
        return;
    }

    if (Array.isArray(source.tileIds)) {
        sanitizeLegacyWorkspace(workspaceId, source, next);
        return;
    }

    const workspace = createWorkspace(workspaceId);
    workspace.layout = source.layout === "single" || MANUAL_LAYOUTS.includes(source.layout as ManualHyprTilesLayout)
        ? source.layout
        : defaultLayout();
    workspace.masterRatio = typeof source.masterRatio === "number" ? clampMasterRatio(source.masterRatio) : DEFAULT_MASTER_RATIO;
    workspace.autoLayout = !!source.autoLayout;

    const sourceNodes = source.nodesById && typeof source.nodesById === "object" ? source.nodesById : {};

    const sanitizeNode = (nodeId: string | null): string | null => {
        if (!nodeId || typeof nodeId !== "string") return null;
        const node = sourceNodes[nodeId];
        if (!node || typeof node !== "object") return null;

        if (node.kind === "leaf") {
            const tileIds: string[] = Array.isArray(node.tileIds)
                ? [...new Set((node.tileIds as unknown[]).filter((tileId): tileId is string => typeof tileId === "string" && !!next.tilesById[tileId]))]
                : [];
            if (!tileIds.length) return null;

            for (const tileId of tileIds) next.tilesById[tileId].workspaceId = workspaceId;

            workspace.nodesById[nodeId] = {
                id: nodeId,
                kind: "leaf",
                tileIds,
                activeTileId: typeof node.activeTileId === "string" && tileIds.includes(node.activeTileId) ? node.activeTileId : tileIds[0],
                tabGroupName: typeof node.tabGroupName === "string" ? node.tabGroupName : null
            };

            return nodeId;
        }

        if (node.kind !== "split") return null;

        const firstId = sanitizeNode(typeof node.firstId === "string" ? node.firstId : null);
        const secondId = sanitizeNode(typeof node.secondId === "string" ? node.secondId : null);
        if (!firstId && !secondId) return null;
        if (!firstId) return secondId;
        if (!secondId) return firstId;

        workspace.nodesById[nodeId] = {
            id: nodeId,
            kind: "split",
            axis: node.axis === "y" ? "y" : "x",
            ratio: clampSplitRatio(typeof node.ratio === "number" ? node.ratio : 0.5),
            firstId,
            secondId
        };

        return nodeId;
    };

    workspace.rootNodeId = sanitizeNode(typeof source.rootNodeId === "string" ? source.rootNodeId : null);
    workspace.floatingTileIds = Array.isArray(source.floatingTileIds)
        ? [...new Set((source.floatingTileIds as unknown[]).filter((tileId): tileId is string => typeof tileId === "string" && !!next.tilesById[tileId]))]
        : [];

    for (const tileId of workspace.floatingTileIds) {
        next.tilesById[tileId].workspaceId = workspaceId;
        next.tilesById[tileId].floating = true;
        next.tilesById[tileId].floatBounds = normalizeBounds(next.tilesById[tileId].floatBounds, DEFAULT_FLOAT_BOUNDS);
    }

    workspace.focusedTileId = typeof source.focusedTileId === "string" ? source.focusedTileId : null;
    workspace.primaryTileId = typeof source.primaryTileId === "string" ? source.primaryTileId : null;
    workspace.lastFocusedTileId = typeof source.lastFocusedTileId === "string" ? source.lastFocusedTileId : null;
    next.workspaces[String(workspaceId)] = workspace;
}

const sanitizeState = (previous?: Partial<HyprTilesPersistedState> & Record<string, any>): HyprTilesPersistedState => {
    const next = createDefaultState();

    const rawTiles = previous?.tilesById ?? {};
    for (const [id, rawTile] of Object.entries(rawTiles)) {
        if (!rawTile || typeof rawTile !== "object") continue;
        if (typeof (rawTile as TileEntity).channelId !== "string" || !(rawTile as TileEntity).channelId) continue;

        next.tilesById[id] = {
            id,
            channelId: (rawTile as TileEntity).channelId,
            guildId: typeof (rawTile as TileEntity).guildId === "string" ? (rawTile as TileEntity).guildId : null,
            createdAt: typeof (rawTile as TileEntity).createdAt === "number" ? (rawTile as TileEntity).createdAt : Date.now(),
            workspaceId: normalizeWorkspaceId((rawTile as TileEntity).workspaceId) ?? 1,
            openedBy: normalizeOpenedBy((rawTile as TileEntity).openedBy) ?? "restore",
            floating: !!(rawTile as TileEntity).floating,
            pinned: !!(rawTile as TileEntity).pinned,
            scratchpadId: typeof (rawTile as TileEntity).scratchpadId === "string" ? (rawTile as TileEntity).scratchpadId : null,
            floatBounds: normalizeBounds((rawTile as TileEntity).floatBounds, DEFAULT_FLOAT_BOUNDS),
            restoreState: normalizeRestoreState((rawTile as TileEntity).restoreState),
        };
    }

    for (const workspaceId of WORKSPACE_IDS) {
        sanitizeWorkspace(workspaceId, previous?.workspaces?.[String(workspaceId)], next);
    }

    next.pinnedTileIds = Array.isArray(previous?.pinnedTileIds)
        ? [...new Set((previous.pinnedTileIds as unknown[]).filter((tileId): tileId is string => typeof tileId === "string" && !!next.tilesById[tileId]))].slice(0, PINNED_TILE_MAX)
        : [];

    for (const tileId of next.pinnedTileIds) {
        next.tilesById[tileId].pinned = true;
        next.tilesById[tileId].floating = true;
    }

    if (previous?.scratchpadsById && typeof previous.scratchpadsById === "object") {
        for (const [scratchpadId, rawScratchpad] of Object.entries(previous.scratchpadsById)) {
            if (!rawScratchpad || typeof rawScratchpad !== "object") continue;

            const scratchpadTileId = (rawScratchpad as ScratchpadState).tileId;
            const tileId = typeof scratchpadTileId === "string" && next.tilesById[scratchpadTileId]
                ? scratchpadTileId
                : null;

            next.scratchpadsById[scratchpadId] = {
                id: scratchpadId,
                tileId,
                workspaceId: normalizeWorkspaceId((rawScratchpad as ScratchpadState).workspaceId),
                visible: !!(rawScratchpad as ScratchpadState).visible,
                bounds: normalizeBounds((rawScratchpad as ScratchpadState).bounds, DEFAULT_SCRATCHPAD_BOUNDS)
            };

            if (tileId) {
                next.tilesById[tileId].scratchpadId = scratchpadId;
                next.tilesById[tileId].floating = true;
                next.tilesById[tileId].floatBounds = normalizeBounds(next.tilesById[tileId].floatBounds, next.scratchpadsById[scratchpadId].bounds);
            }
        }
    }

    next.activeWorkspace = normalizeWorkspaceId(previous?.activeWorkspace) ?? 1;

    for (const workspaceId of WORKSPACE_IDS) {
        normalizeWorkspaceRefs(next.workspaces[String(workspaceId)], next);
    }

    syncWorkspaceLayoutsToSettings(next);

    const referencedTiles = new Set<string>();
    for (const workspaceId of WORKSPACE_IDS) {
        const workspace = next.workspaces[String(workspaceId)];
        for (const leafId of getLeafIds(workspace)) {
            const leaf = workspace.nodesById[leafId];
            if (isLeaf(leaf)) for (const tileId of leaf.tileIds) referencedTiles.add(tileId);
        }
        for (const tileId of workspace.floatingTileIds) referencedTiles.add(tileId);
    }
    for (const tileId of next.pinnedTileIds) referencedTiles.add(tileId);
    for (const scratchpad of Object.values(next.scratchpadsById)) {
        if (scratchpad.tileId) referencedTiles.add(scratchpad.tileId);
    }

    for (const tileId of Object.keys(next.tilesById)) {
        if (!referencedTiles.has(tileId)) delete next.tilesById[tileId];
    }

    next.version = STATE_VERSION;
    return next;
};

export const HyprTilesStore = proxyLazy(() => {
    class HyprTilesStoreImpl extends PersistedStore {
        static persistKey = "HyprTilesStore";

        initialize(previous?: HyprTilesPersistedState) {
            state = sanitizeState(previous);
            revision = 0;
            overviewVisible = false;
            appliedLayoutSettingsKey = getLayoutSettingsKey();
        }

        getState() {
            return state;
        }

        getRevision() {
            return revision;
        }

        getActiveWorkspace() {
            return getWorkspace();
        }

        getWorkspaceById(id: WorkspaceIndex) {
            return getWorkspace(id);
        }

        getTile(tileId: string) {
            return state.tilesById[tileId] ?? null;
        }

        getFocusedTile() {
            const workspace = getWorkspace();
            return workspace.focusedTileId ? state.tilesById[workspace.focusedTileId] ?? null : null;
        }

        getPrimaryTile() {
            const workspace = getWorkspace();
            return workspace.primaryTileId ? state.tilesById[workspace.primaryTileId] ?? null : null;
        }

        isOverviewVisible() {
            return overviewVisible;
        }
    }

    return new HyprTilesStoreImpl(FluxDispatcher, {});
});

export function initializeHyprTilesStore() {
    return HyprTilesStore.getState();
}

export function resyncWorkspaceLayoutsToSettings(force = false) {
    if (!state) {
        appliedLayoutSettingsKey = getLayoutSettingsKey();
        return false;
    }

    const settingsKey = getLayoutSettingsKey();
    if (!force && settingsKey === appliedLayoutSettingsKey) return false;

    const changed = syncWorkspaceLayoutsToSettings();
    if (changed) emitChange();
    return changed;
}

SettingsStore.addGlobalChangeListener((_, path) => {
    if (path !== "plugins.HyprTiles.defaultLayout" && path !== "plugins.HyprTiles.enableRulesFile")
        return;

    resyncWorkspaceLayoutsToSettings();
});

export function sameTarget(a: TileTarget | null | undefined, b: TileTarget | null | undefined): boolean {
    if (!a || !b) return false;
    return a.channelId === b.channelId && (a.guildId ?? null) === (b.guildId ?? null);
}

export function getTileById(tileId: string) {
    return state.tilesById[tileId] ?? null;
}

export function getPinnedTiles() {
    return state.pinnedTileIds.map(tileId => state.tilesById[tileId]).filter(Boolean) as TileEntity[];
}

export function getVisibleScratchpads(workspaceId: WorkspaceIndex = state.activeWorkspace) {
    return Object.values(state.scratchpadsById)
        .filter(scratchpad => scratchpad.visible && scratchpad.workspaceId === workspaceId && scratchpad.tileId)
        .map(scratchpad => ({ scratchpad, tile: state.tilesById[scratchpad.tileId!] }))
        .filter((entry): entry is { scratchpad: ScratchpadState; tile: TileEntity; } => !!entry.tile);
}

export function isWorkspaceOverviewOpen() {
    return overviewVisible;
}

export function toggleWorkspaceOverview() {
    overviewVisible = !overviewVisible;
    emitChange();
    return overviewVisible;
}

export function setActiveWorkspace(id: WorkspaceIndex) {
    if (state.activeWorkspace === id) return false;
    state.activeWorkspace = id;
    normalizeWorkspaceRefs(getWorkspace(id));
    emitChange();
    return true;
}

function focusTileInternal(workspace: WorkspaceState, tileId: string, promotePrimary = true) {
    const focusable = getWorkspaceFocusableTileIds(workspace);
    if (!focusable.includes(tileId)) return false;

    if (workspace.focusedTileId && workspace.focusedTileId !== tileId)
        workspace.lastFocusedTileId = workspace.focusedTileId;

    workspace.focusedTileId = tileId;
    focusLeafTile(workspace, tileId);
    if (promotePrimary) workspace.primaryTileId = tileId;
    return true;
}

export function focusTile(tileId: string, promotePrimary = true) {
    const workspace = getWorkspace();
    if (!focusTileInternal(workspace, tileId, promotePrimary)) return false;
    normalizeWorkspaceRefs(workspace);
    emitChange();
    return true;
}

export function focusPreviousTile() {
    const workspace = getWorkspace();
    if (!workspace.lastFocusedTileId) return null;
    if (!focusTileInternal(workspace, workspace.lastFocusedTileId, false)) return null;
    normalizeWorkspaceRefs(workspace);
    emitChange();
    return workspace.focusedTileId;
}

export function promoteTileToPrimary(tileId: string) {
    return focusTile(tileId, true);
}

export function openTile(target: TileTarget, options: TileOpenOptions): TileOpenResult {
    const rulePlan = evaluateRules(buildRuleContext(target, options.openedBy));
    const plan = {
        ...rulePlan,
        ...options.forcePlan,
        focus: options.forcePlan?.focus ?? rulePlan.focus
    };

    const workspaceId = plan.workspace ?? state.activeWorkspace;
    const workspace = getWorkspace(workspaceId);
    const allowDuplicates = options.allowDuplicates ?? settings.store.allowDuplicateTargets;

    if (!allowDuplicates) {
        const existingId = findExistingTileByTarget(target, workspaceId);
        if (existingId) {
            const scratchpad = Object.values(state.scratchpadsById).find(entry => entry.tileId === existingId);
            if (scratchpad && plan.focus) {
                scratchpad.visible = true;
                scratchpad.workspaceId = state.activeWorkspace;
            }

            if (plan.focus) {
                if (state.activeWorkspace !== workspaceId && !scratchpad && !state.pinnedTileIds.includes(existingId))
                    state.activeWorkspace = workspaceId;
                focusTileInternal(getWorkspace(), existingId, true);
                emitChange();
            }

            return { tileId: existingId, workspaceId, focused: !!plan.focus };
        }
    }

    if (plan.replace && !plan.float && !plan.scratchpadId && !plan.tabGroup && workspace.focusedTileId) {
        updateTileTarget(workspace.focusedTileId, target);
        if (plan.focus && state.activeWorkspace !== workspaceId)
            state.activeWorkspace = workspaceId;
        focusTileInternal(workspace, workspace.focusedTileId, true);
        emitChange();
        return { tileId: workspace.focusedTileId, workspaceId, focused: !!plan.focus };
    }

    const tile = createTile(target, workspaceId, options.openedBy);
    state.tilesById[tile.id] = tile;

    if (plan.scratchpadId) {
        const scratchpad = state.scratchpadsById[plan.scratchpadId] ?? createScratchpad(plan.scratchpadId);
        scratchpad.tileId = tile.id;
        scratchpad.visible = !!plan.focus;
        scratchpad.workspaceId = scratchpad.visible ? state.activeWorkspace : workspaceId;
        state.scratchpadsById[plan.scratchpadId] = scratchpad;

        tile.scratchpadId = scratchpad.id;
        tile.floating = true;
        tile.floatBounds = cloneBounds(scratchpad.bounds);

        if (plan.focus) {
            focusTileInternal(getWorkspace(scratchpad.workspaceId ?? workspaceId), tile.id, true);
            normalizeWorkspaceRefs(getWorkspace(scratchpad.workspaceId ?? workspaceId));
            emitChange();
        }

        return { tileId: tile.id, workspaceId, focused: !!plan.focus };
    }

    if (plan.float) {
        tile.floating = true;
        tile.floatBounds = cloneBounds(DEFAULT_FLOAT_BOUNDS);
        workspace.floatingTileIds.push(tile.id);
        if (plan.focus) {
            if (state.activeWorkspace !== workspaceId) state.activeWorkspace = workspaceId;
            focusTileInternal(getWorkspace(workspaceId), tile.id, true);
        }
        normalizeWorkspaceRefs(workspace);
        emitChange();
        return { tileId: tile.id, workspaceId, focused: !!plan.focus };
    }

    if (plan.tabGroup) {
        addTileToNamedGroup(workspace, tile.id, plan.tabGroup, plan.split ?? null);
    } else {
        const leaf = createLeaf(tile.id);
        if (plan.split) {
            setNode(workspace, leaf);
            const focusedLeaf = workspace.focusedTileId ? findLeafByTileId(workspace, workspace.focusedTileId) : null;
            insertNodeRelative(workspace, focusedLeaf?.id ?? workspace.rootNodeId, leaf.id, plan.split);
        } else {
            appendLeaf(workspace, leaf);
        }
    }

    if (workspace.autoLayout) applyAutoLayout(workspace, plan.layoutHint);

    if (plan.focus) {
        if (state.activeWorkspace !== workspaceId) state.activeWorkspace = workspaceId;
        focusTileInternal(workspace, tile.id, true);
    }

    normalizeWorkspaceRefs(workspace);
    emitChange();
    return { tileId: tile.id, workspaceId, focused: !!plan.focus };
}

export function ensurePrimaryForRoute(target: TileTarget) {
    const workspace = getWorkspace();
    const primary = workspace.primaryTileId ? state.tilesById[workspace.primaryTileId] : null;

    if (!primary) {
        return openTile(target, {
            openedBy: "restore",
            allowDuplicates: true,
            forcePlan: { workspace: workspace.id, focus: true }
        }).tileId;
    }

    if (sameTarget(primary, target)) return primary.id;

    primary.channelId = target.channelId;
    primary.guildId = target.guildId ?? null;
    workspace.focusedTileId = primary.id;
    workspace.primaryTileId = primary.id;
    normalizeWorkspaceRefs(workspace);
    emitChange();
    return primary.id;
}

export function updatePrimaryTileTarget(target: TileTarget) {
    return ensurePrimaryForRoute(target);
}

export function updateTileTarget(tileId: string, target: TileTarget) {
    const tile = state.tilesById[tileId];
    if (!tile || sameTarget(tile, target)) return false;
    tile.channelId = target.channelId;
    tile.guildId = target.guildId ?? null;
    emitChange();
    return true;
}

export function setLayout(layout: ManualHyprTilesLayout) {
    const workspace = getWorkspace();
    workspace.autoLayout = false;
    workspace.layout = layout;
    rebuildWorkspaceTree(workspace, layout);
    normalizeWorkspaceRefs(workspace);
    emitChange();
    return true;
}

export function cycleLayout() {
    const workspace = getWorkspace();
    const current = workspace.layout === "single" ? defaultLayout() : workspace.layout;
    const index = MANUAL_LAYOUTS.indexOf(current as ManualHyprTilesLayout);
    const next = MANUAL_LAYOUTS[(index + 1) % MANUAL_LAYOUTS.length];
    setLayout(next);
    return next;
}

export function toggleWorkspaceAutoLayout() {
    const workspace = getWorkspace();
    workspace.autoLayout = !workspace.autoLayout;
    if (workspace.autoLayout) applyAutoLayout(workspace);
    normalizeWorkspaceRefs(workspace);
    emitChange();
    return workspace.autoLayout;
}

export function updateSplitRatio(splitId: string, ratio: number) {
    const workspace = getWorkspace();
    const split = workspace.nodesById[splitId];
    if (!isSplit(split)) return false;
    split.ratio = clampSplitRatio(ratio);
    emitChange();
    return true;
}

export function adjustActiveWorkspaceMasterRatio(delta: number) {
    const workspace = getWorkspace();
    const next = clampMasterRatio(workspace.masterRatio + delta);
    if (next === workspace.masterRatio) return false;
    workspace.masterRatio = next;
    if (workspace.layout === "master") rebuildWorkspaceTree(workspace, "master");
    normalizeWorkspaceRefs(workspace);
    emitChange();
    return true;
}

export function focusMasterTile(promotePrimary = true) {
    const workspace = getWorkspace();
    const leaf = getLeafIds(workspace).map(leafId => workspace.nodesById[leafId]).find(isLeaf);
    if (!leaf) return null;
    focusTileInternal(workspace, leaf.activeTileId, promotePrimary);
    normalizeWorkspaceRefs(workspace);
    emitChange();
    return leaf.activeTileId;
}

export function swapTilesByIds(fromId: string, toId: string) {
    const workspace = getWorkspace();
    const fromLeaf = findLeafByTileId(workspace, fromId);
    const toLeaf = findLeafByTileId(workspace, toId);
    if (!fromLeaf || !toLeaf) return false;

    const fromIndex = fromLeaf.tileIds.indexOf(fromId);
    const toIndex = toLeaf.tileIds.indexOf(toId);
    if (fromIndex === -1 || toIndex === -1) return false;

    fromLeaf.tileIds[fromIndex] = toId;
    toLeaf.tileIds[toIndex] = fromId;

    if (fromLeaf.activeTileId === fromId) fromLeaf.activeTileId = toId;
    if (toLeaf.activeTileId === toId) toLeaf.activeTileId = fromId;
    if (workspace.focusedTileId === fromId) workspace.focusedTileId = toId;
    else if (workspace.focusedTileId === toId) workspace.focusedTileId = fromId;
    if (workspace.primaryTileId === fromId) workspace.primaryTileId = toId;
    else if (workspace.primaryTileId === toId) workspace.primaryTileId = fromId;

    normalizeWorkspaceRefs(workspace);
    emitChange();
    return true;
}

export function swapFocusedWithMaster() {
    const workspace = getWorkspace();
    if (!workspace.focusedTileId) return false;
    const masterLeaf = getLeafIds(workspace).map(leafId => workspace.nodesById[leafId]).find(isLeaf);
    if (!masterLeaf) return false;
    return swapTilesByIds(workspace.focusedTileId, masterLeaf.activeTileId);
}

export function moveFocusDirection(direction: Direction, wrap = false, promotePrimary = true) {
    const workspace = getWorkspace();
    if (!workspace.focusedTileId) return null;

    const nextId = findDirectionalCandidate(workspace, workspace.focusedTileId, direction, wrap);
    if (!nextId) return null;

    focusTileInternal(workspace, nextId, promotePrimary);
    normalizeWorkspaceRefs(workspace);
    emitChange();
    return nextId;
}

export function swapDirection(direction: Direction, wrap = false) {
    const workspace = getWorkspace();
    if (!workspace.focusedTileId) return null;

    const candidateId = findDirectionalCandidate(workspace, workspace.focusedTileId, direction, wrap);
    if (!candidateId) return null;

    return swapTilesByIds(workspace.focusedTileId, candidateId) ? candidateId : null;
}

function getVisibleTileCount(workspace: WorkspaceState) {
    return getWorkspaceFocusableTileIds(workspace).length;
}

function removeTileEverywhere(tileId: string) {
    const tile = state.tilesById[tileId];
    if (!tile) return false;

    for (const workspaceId of WORKSPACE_IDS) {
        const workspace = getWorkspace(workspaceId);
        if (findLeafByTileId(workspace, tileId)) {
            detachTileFromWorkspace(workspace, tileId);
            normalizeWorkspaceRefs(workspace);
        }
        workspace.floatingTileIds = workspace.floatingTileIds.filter(id => id !== tileId);
    }

    state.pinnedTileIds = state.pinnedTileIds.filter(id => id !== tileId);

    for (const scratchpad of Object.values(state.scratchpadsById)) {
        if (scratchpad.tileId === tileId) {
            scratchpad.tileId = null;
            scratchpad.visible = false;
        }
    }

    delete state.tilesById[tileId];
    return true;
}

export function closeTileById(tileId: string) {
    const workspace = getWorkspace();
    if (workspace.focusedTileId === tileId && getVisibleTileCount(workspace) <= 1) return false;
    if (!removeTileEverywhere(tileId)) return false;
    normalizeWorkspaceRefs(workspace);
    emitChange();
    return true;
}

export function closeFocusedTile() {
    const workspace = getWorkspace();
    return workspace.focusedTileId ? closeTileById(workspace.focusedTileId) : false;
}

export function moveFocusedTileToWorkspace(destinationId: WorkspaceIndex) {
    const source = getWorkspace();
    const focusedId = source.focusedTileId;
    if (!focusedId || destinationId === source.id) return null;

    const tile = state.tilesById[focusedId];
    if (!tile || tile.pinned || tile.scratchpadId) return null;

    const restore = tile.floating ? tile.restoreState : detachTileFromWorkspace(source, focusedId);

    source.floatingTileIds = source.floatingTileIds.filter(id => id !== focusedId);
    tile.workspaceId = destinationId;
    tile.restoreState = restore ? { ...restore, workspaceId: destinationId } : tile.restoreState;

    const destination = getWorkspace(destinationId);
    if (tile.floating) destination.floatingTileIds.push(focusedId);
    else appendLeaf(destination, createLeaf(focusedId));

    normalizeWorkspaceRefs(source);
    normalizeWorkspaceRefs(destination);
    emitChange();
    return focusedId;
}

export function getPrimaryTileForWorkspace(id: WorkspaceIndex = state.activeWorkspace) {
    const workspace = getWorkspace(id);
    return workspace.primaryTileId ? state.tilesById[workspace.primaryTileId] ?? null : null;
}

export function getWorkspaceSnapshot(id: WorkspaceIndex = state.activeWorkspace) {
    return getWorkspace(id);
}

export function getActiveWorkspaceIndex() {
    return state.activeWorkspace;
}

export function seedWorkspaceFromTarget(workspaceId: WorkspaceIndex, target: TileTarget) {
    const workspace = getWorkspace(workspaceId);
    if (workspace.rootNodeId || workspace.floatingTileIds.length) return workspace.primaryTileId;

    const tile = createTile(target, workspaceId, "restore");
    state.tilesById[tile.id] = tile;
    appendLeaf(workspace, createLeaf(tile.id));
    focusTileInternal(workspace, tile.id, true);
    normalizeWorkspaceRefs(workspace);
    emitChange();
    return tile.id;
}

export function cycleFocusedLeafTab(step: 1 | -1) {
    const workspace = getWorkspace();
    if (!workspace.focusedTileId) return null;

    const leaf = findLeafByTileId(workspace, workspace.focusedTileId);
    if (!leaf || leaf.tileIds.length <= 1) return null;

    const currentIndex = leaf.tileIds.indexOf(leaf.activeTileId);
    const nextIndex = (currentIndex + step + leaf.tileIds.length) % leaf.tileIds.length;
    const nextTileId = leaf.tileIds[nextIndex];

    leaf.activeTileId = nextTileId;
    focusTileInternal(workspace, nextTileId, true);
    normalizeWorkspaceRefs(workspace);
    emitChange();
    return nextTileId;
}

export function moveFocusedTileIntoNewGroup() {
    const workspace = getWorkspace();
    const tileId = workspace.focusedTileId;
    if (!tileId) return null;

    const leaf = findLeafByTileId(workspace, tileId);
    if (!leaf) return null;

    const groupName = `group-${++newGroupCount}`;

    if (leaf.tileIds.length === 1) {
        leaf.tabGroupName = groupName;
        emitChange();
        return groupName;
    }

    const restore = detachTileFromWorkspace(workspace, tileId);
    const newLeaf = createLeaf(tileId, groupName);
    setNode(workspace, newLeaf);

    if (restore?.anchorNodeId && restore.direction) insertNodeRelative(workspace, restore.anchorNodeId, newLeaf.id, restore.direction);
    else appendLeaf(workspace, newLeaf);

    focusTileInternal(workspace, tileId, true);
    normalizeWorkspaceRefs(workspace);
    emitChange();
    return groupName;
}

export function sendFocusedTileToNamedGroup(groupName: string) {
    const workspace = getWorkspace();
    const tileId = workspace.focusedTileId;
    if (!tileId || !groupName) return null;

    const targetLeaf = getNamedGroupLeaf(workspace, groupName);
    if (!targetLeaf) return null;

    const tile = state.tilesById[tileId];
    if (!tile) return null;

    if (tile.floating) {
        workspace.floatingTileIds = workspace.floatingTileIds.filter(id => id !== tileId);
        tile.floating = false;
    } else {
        detachTileFromWorkspace(workspace, tileId);
    }

    placeTileInLeaf(workspace, tileId, targetLeaf.id);
    focusTileInternal(workspace, tileId, true);
    normalizeWorkspaceRefs(workspace);
    emitChange();
    return tileId;
}

export function updateTileFloatBounds(tileId: string, bounds: FloatBounds) {
    const tile = state.tilesById[tileId];
    if (!tile) return false;

    tile.floatBounds = normalizeBounds(bounds, tile.floatBounds ?? DEFAULT_FLOAT_BOUNDS);
    if (tile.scratchpadId) {
        const scratchpad = state.scratchpadsById[tile.scratchpadId];
        if (scratchpad) scratchpad.bounds = tile.floatBounds;
    }

    emitChange();
    return true;
}

function toggleFloating(tileId: string) {
    const workspace = getWorkspace();
    const tile = state.tilesById[tileId];
    if (!tile || tile.pinned || tile.scratchpadId) return false;

    if (tile.floating) {
        const restored = restoreTileToWorkspace(tileId);
        emitChange();
        return restored;
    }

    tile.restoreState = detachTileFromWorkspace(workspace, tileId);
    tile.floating = true;
    tile.floatBounds = tile.floatBounds ?? cloneBounds(DEFAULT_FLOAT_BOUNDS);
    workspace.floatingTileIds.push(tileId);
    focusTileInternal(workspace, tileId, true);
    normalizeWorkspaceRefs(workspace);
    emitChange();
    return true;
}

export function toggleFocusedTileFloating() {
    const workspace = getWorkspace();
    return workspace.focusedTileId ? toggleFloating(workspace.focusedTileId) : false;
}

export function toggleFocusedTilePinned() {
    const workspace = getWorkspace();
    const tileId = workspace.focusedTileId;
    if (!tileId) return false;

    const tile = state.tilesById[tileId];
    if (!tile || tile.scratchpadId) return false;

    if (tile.pinned) {
        tile.pinned = false;
        state.pinnedTileIds = state.pinnedTileIds.filter(id => id !== tileId);
        const restored = restoreTileToWorkspace(tileId);
        emitChange();
        return restored;
    }

    if (!tile.floating) tile.restoreState = detachTileFromWorkspace(workspace, tileId);
    else workspace.floatingTileIds = workspace.floatingTileIds.filter(id => id !== tileId);

    tile.pinned = true;
    tile.floating = true;
    tile.floatBounds = tile.floatBounds ?? cloneBounds(DEFAULT_FLOAT_BOUNDS);
    state.pinnedTileIds = [...state.pinnedTileIds.filter(id => id !== tileId), tileId].slice(0, PINNED_TILE_MAX);
    focusTileInternal(workspace, tileId, true);
    normalizeWorkspaceRefs(workspace);
    emitChange();
    return true;
}

export function cyclePinnedTileFocus() {
    if (!state.pinnedTileIds.length) return null;
    const workspace = getWorkspace();
    const currentIndex = workspace.focusedTileId ? state.pinnedTileIds.indexOf(workspace.focusedTileId) : -1;
    const nextId = state.pinnedTileIds[(currentIndex + 1 + state.pinnedTileIds.length) % state.pinnedTileIds.length];
    focusTileInternal(workspace, nextId, true);
    normalizeWorkspaceRefs(workspace);
    emitChange();
    return nextId;
}

export function toggleScratchpad(id: string) {
    if (!id) return null;

    const scratchpad = state.scratchpadsById[id] ?? createScratchpad(id);
    state.scratchpadsById[id] = scratchpad;

    if (!scratchpad.tileId) {
        const workspace = getWorkspace();
        const tileId = workspace.focusedTileId;
        if (!tileId) return null;

        const tile = state.tilesById[tileId];
        if (!tile || tile.pinned) return null;

        if (tile.floating) workspace.floatingTileIds = workspace.floatingTileIds.filter(entry => entry !== tileId);
        else tile.restoreState = detachTileFromWorkspace(workspace, tileId);

        tile.floating = true;
        tile.scratchpadId = id;
        tile.floatBounds = tile.floatBounds ?? cloneBounds(scratchpad.bounds);
        scratchpad.tileId = tileId;
        scratchpad.visible = true;
        scratchpad.workspaceId = state.activeWorkspace;
        focusTileInternal(workspace, tileId, true);
        normalizeWorkspaceRefs(workspace);
        emitChange();
        return tileId;
    }

    const tile = state.tilesById[scratchpad.tileId];
    if (!tile) return null;

    scratchpad.visible = !scratchpad.visible;
    scratchpad.workspaceId = scratchpad.visible ? state.activeWorkspace : scratchpad.workspaceId;
    tile.scratchpadId = id;
    tile.floating = true;
    tile.floatBounds = tile.floatBounds ?? cloneBounds(scratchpad.bounds);

    const workspace = getWorkspace();
    if (scratchpad.visible) focusTileInternal(workspace, tile.id, true);
    else if (workspace.focusedTileId === tile.id) focusPreviousTile();

    normalizeWorkspaceRefs(workspace);
    emitChange();
    return tile.id;
}

export function moveTileByDrop(tileId: string, targetTileId: string, zone: DropZone, groupOnCenter = false) {
    if (tileId === targetTileId) return false;

    const workspace = getWorkspace();
    const tile = state.tilesById[tileId];
    const targetTile = state.tilesById[targetTileId];
    if (!tile || !targetTile) return false;

    const targetLeaf = findLeafByTileId(workspace, targetTileId);
    if (!targetLeaf) return false;

    if (zone === "center" || groupOnCenter) {
        if (tile.floating) {
            workspace.floatingTileIds = workspace.floatingTileIds.filter(id => id !== tileId);
            tile.floating = false;
        } else {
            detachTileFromWorkspace(workspace, tileId);
        }

        placeTileInLeaf(workspace, tileId, targetLeaf.id);
        focusTileInternal(workspace, tileId, true);
        normalizeWorkspaceRefs(workspace);
        emitChange();
        return true;
    }

    const restore = tile.floating ? tile.restoreState : detachTileFromWorkspace(workspace, tileId);
    workspace.floatingTileIds = workspace.floatingTileIds.filter(id => id !== tileId);
    tile.floating = false;
    tile.restoreState = restore ?? tile.restoreState;

    const newLeaf = createLeaf(tileId);
    setNode(workspace, newLeaf);
    insertNodeRelative(workspace, targetLeaf.id, newLeaf.id, zone);
    focusTileInternal(workspace, tileId, true);
    normalizeWorkspaceRefs(workspace);
    emitChange();
    return true;
}

export function getWorkspaceLayoutRects(id: WorkspaceIndex = state.activeWorkspace) {
    return computeLayoutRects(getWorkspace(id));
}
