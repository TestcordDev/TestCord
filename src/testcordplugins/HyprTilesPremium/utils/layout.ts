/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Direction, LayoutLeafNode, LayoutRects, LayoutSplitNode, Rect, ResizeEdge, WorkspaceNode, WorkspaceState } from "../types";

const EMPTY_LAYOUT: LayoutRects = {
    orderedIds: [],
    rects: {},
    leafRects: {},
    nodeRects: {},
    tileToLeafId: {}
};

const centerOf = (rect: Rect) => ({
    x: rect.x + rect.w / 2,
    y: rect.y + rect.h / 2
});

const isLeaf = (node: WorkspaceNode | null | undefined): node is LayoutLeafNode => node?.kind === "leaf";
const isSplit = (node: WorkspaceNode | null | undefined): node is LayoutSplitNode => node?.kind === "split";

function walkLeafIds(workspace: WorkspaceState, nodeId: string | null, leaves: string[]) {
    if (!nodeId) return;
    const node = workspace.nodesById[nodeId];
    if (!node) return;

    if (isLeaf(node)) {
        leaves.push(node.id);
        return;
    }

    walkLeafIds(workspace, node.firstId, leaves);
    walkLeafIds(workspace, node.secondId, leaves);
}

function buildRects(workspace: WorkspaceState, nodeId: string | null, rect: Rect, out: LayoutRects) {
    if (!nodeId) return;
    const node = workspace.nodesById[nodeId];
    if (!node) return;

    out.nodeRects[node.id] = rect;

    if (isLeaf(node)) {
        out.leafRects[node.id] = rect;
        out.tileToLeafId[node.activeTileId] = node.id;
        out.orderedIds.push(node.activeTileId);
        out.rects[node.activeTileId] = rect;
        return;
    }

    if (node.axis === "x") {
        const firstWidth = rect.w * node.ratio;
        buildRects(workspace, node.firstId, { x: rect.x, y: rect.y, w: firstWidth, h: rect.h }, out);
        buildRects(workspace, node.secondId, { x: rect.x + firstWidth, y: rect.y, w: rect.w - firstWidth, h: rect.h }, out);
        return;
    }

    const firstHeight = rect.h * node.ratio;
    buildRects(workspace, node.firstId, { x: rect.x, y: rect.y, w: rect.w, h: firstHeight }, out);
    buildRects(workspace, node.secondId, { x: rect.x, y: rect.y + firstHeight, w: rect.w, h: rect.h - firstHeight }, out);
}

interface PathEntry {
    splitId: string;
    side: "firstId" | "secondId";
}

function findPathToTile(workspace: WorkspaceState, nodeId: string | null, tileId: string, path: PathEntry[]): PathEntry[] | null {
    if (!nodeId) return null;
    const node = workspace.nodesById[nodeId];
    if (!node) return null;

    if (isLeaf(node))
        return node.tileIds.includes(tileId) ? path : null;

    const first = findPathToTile(workspace, node.firstId, tileId, [...path, { splitId: node.id, side: "firstId" }]);
    if (first) return first;

    return findPathToTile(workspace, node.secondId, tileId, [...path, { splitId: node.id, side: "secondId" }]);
}

export function getLeafIds(workspace: WorkspaceState) {
    const leaves: string[] = [];
    walkLeafIds(workspace, workspace.rootNodeId, leaves);
    return leaves;
}

export function findLeafByTileId(workspace: WorkspaceState, tileId: string) {
    for (const leafId of getLeafIds(workspace)) {
        const leaf = workspace.nodesById[leafId];
        if (isLeaf(leaf) && leaf.tileIds.includes(tileId)) return leaf;
    }

    return null;
}

export function computeLayoutRects(workspace: WorkspaceState): LayoutRects {
    if (!workspace.rootNodeId) return EMPTY_LAYOUT;

    const out: LayoutRects = {
        orderedIds: [],
        rects: {},
        leafRects: {},
        nodeRects: {},
        tileToLeafId: {}
    };

    buildRects(workspace, workspace.rootNodeId, { x: 0, y: 0, w: 1, h: 1 }, out);
    return out;
}

export function findDirectionalCandidate(workspace: WorkspaceState, fromTileId: string, direction: Direction, wrap: boolean): string | null {
    const { orderedIds, rects } = computeLayoutRects(workspace);
    const fromRect = rects[fromTileId];
    if (!fromRect) return null;

    const from = centerOf(fromRect);
    let bestId: string | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const id of orderedIds) {
        if (id === fromTileId) continue;

        const rect = rects[id];
        if (!rect) continue;

        const to = centerOf(rect);
        const dx = to.x - from.x;
        const dy = to.y - from.y;

        let mainAxis = 0;
        let orthAxis = 0;
        let isValid = false;

        switch (direction) {
            case "left":
                isValid = dx < -0.0001;
                mainAxis = -dx;
                orthAxis = Math.abs(dy);
                break;
            case "right":
                isValid = dx > 0.0001;
                mainAxis = dx;
                orthAxis = Math.abs(dy);
                break;
            case "up":
                isValid = dy < -0.0001;
                mainAxis = -dy;
                orthAxis = Math.abs(dx);
                break;
            case "down":
                isValid = dy > 0.0001;
                mainAxis = dy;
                orthAxis = Math.abs(dx);
                break;
        }

        if (!isValid) continue;

        const overlapX = Math.max(0, Math.min(fromRect.x + fromRect.w, rect.x + rect.w) - Math.max(fromRect.x, rect.x));
        const overlapY = Math.max(0, Math.min(fromRect.y + fromRect.h, rect.y + rect.h) - Math.max(fromRect.y, rect.y));
        const overlapBonus = direction === "left" || direction === "right" ? overlapY : overlapX;

        const score = mainAxis * 10 + orthAxis * 3 - overlapBonus;
        if (score < bestScore) {
            bestScore = score;
            bestId = id;
        }
    }

    if (bestId || !wrap) return bestId;

    const reverseDirection: Direction = direction === "left"
        ? "right"
        : direction === "right"
            ? "left"
            : direction === "up"
                ? "down"
                : "up";

    let wrappedId: string | null = null;
    let wrappedScore = Number.NEGATIVE_INFINITY;

    for (const id of orderedIds) {
        if (id === fromTileId) continue;
        const rect = rects[id];
        if (!rect) continue;

        const to = centerOf(rect);
        const dx = to.x - from.x;
        const dy = to.y - from.y;

        let mainAxis = 0;
        let orthAxis = 0;
        let isValid = false;

        switch (reverseDirection) {
            case "left":
                isValid = dx < -0.0001;
                mainAxis = -dx;
                orthAxis = Math.abs(dy);
                break;
            case "right":
                isValid = dx > 0.0001;
                mainAxis = dx;
                orthAxis = Math.abs(dy);
                break;
            case "up":
                isValid = dy < -0.0001;
                mainAxis = -dy;
                orthAxis = Math.abs(dx);
                break;
            case "down":
                isValid = dy > 0.0001;
                mainAxis = dy;
                orthAxis = Math.abs(dx);
                break;
        }

        if (!isValid) continue;

        const score = mainAxis * 10 - orthAxis;
        if (score > wrappedScore) {
            wrappedScore = score;
            wrappedId = id;
        }
    }

    return wrappedId;
}

export function findResizableSplit(workspace: WorkspaceState, tileId: string, edge: ResizeEdge) {
    const path = findPathToTile(workspace, workspace.rootNodeId, tileId, []);
    if (!path) return null;

    for (let i = path.length - 1; i >= 0; i--) {
        const entry = path[i];
        const split = workspace.nodesById[entry.splitId];
        if (!isSplit(split)) continue;

        if (edge === "left" && split.axis === "x" && entry.side === "secondId") return split.id;
        if (edge === "right" && split.axis === "x" && entry.side === "firstId") return split.id;
        if (edge === "up" && split.axis === "y" && entry.side === "secondId") return split.id;
        if (edge === "down" && split.axis === "y" && entry.side === "firstId") return split.id;
    }

    return null;
}
