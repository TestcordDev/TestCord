/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { RuntimeInteractions } from "@api/RuntimeInterposition";
import ErrorBoundary from "@components/ErrorBoundary";
import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { ChannelStore, GuildStore, React, RelationshipStore, useEffect, useRef, UserStore, useState, useStateFromStores } from "@webpack/common";

import {
    closeSpecificTileAndNavigate,
    focusTileById,
    getTileDisplayInfo,
    isHyprTilesRunning,
    moveTileByDropAndNavigate,
    switchWorkspaceAndNavigate,
    syncRouteTarget,
} from "../controller";
import { settings } from "../settings";
import { getPinnedTiles, getVisibleScratchpads, HyprTilesStore, isWorkspaceOverviewOpen, toggleWorkspaceOverview, updateSplitRatio, updateTileFloatBounds } from "../store";
import { DropZone, FloatBounds, TileEntity, TileTarget } from "../types";
import { computeLayoutRects, findResizableSplit, getLeafIds } from "../utils/layout";
import { TileContent } from "./TileContent";

const cl = classNameFactory("vc-hyprtiles-");
const DROP_CENTER_RATIO = 0.32;
const FLOAT_MIN_SIZE = 0.2;
type ResizeCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
type DragState = { tileId: string; targetTileId: string | null; zone: DropZone | null; groupOnCenter: boolean; };
type FloatDragState = { tileId: string; startX: number; startY: number; startBounds: FloatBounds; };
type ResizeState =
    | { kind: "tiled"; horizontalSplitId: string | null; verticalSplitId: string | null; }
    | { kind: "floating"; tileId: string; corner: ResizeCorner; startX: number; startY: number; startBounds: FloatBounds; };
type PointerSession<T> = T & { pointerId: number; target: HTMLElement; endInteraction: () => void; };
const resizeCorners: ResizeCorner[] = ["top-left", "top-right", "bottom-left", "bottom-right"];

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function CloseIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
            <path fill="currentColor" d="M18.3 5.71 12 12l6.3 6.29-1.41 1.41L10.59 13.4 4.29 19.7 2.88 18.29 9.17 12 2.88 5.71 4.29 4.3l6.3 6.29 6.29-6.3z" />
        </svg>
    );
}

interface WorkspaceHostProps {
    routeTarget: TileTarget | null;
    routeElement: React.ReactNode;
}

function getDropZone(rect: DOMRect, x: number, y: number): DropZone {
    const rx = (x - rect.left) / rect.width;
    const ry = (y - rect.top) / rect.height;

    if (rx >= DROP_CENTER_RATIO && rx <= 1 - DROP_CENTER_RATIO && ry >= DROP_CENTER_RATIO && ry <= 1 - DROP_CENTER_RATIO)
        return "center";

    const leftDist = rx;
    const rightDist = 1 - rx;
    const topDist = ry;
    const bottomDist = 1 - ry;
    const min = Math.min(leftDist, rightDist, topDist, bottomDist);

    if (min === leftDist) return "left";
    if (min === rightDist) return "right";
    if (min === topDist) return "up";
    return "down";
}

function toStyle(bounds: FloatBounds): React.CSSProperties {
    return {
        left: `${bounds.x * 100}%`,
        top: `${bounds.y * 100}%`,
        width: `${bounds.w * 100}%`,
        height: `${bounds.h * 100}%`
    };
}

function toPreviewStyle(bounds: FloatBounds, preview?: FloatBounds): React.CSSProperties {
    if (!preview) return toStyle(bounds);
    return {
        ...toStyle(bounds),
        width: `${preview.w * 100}%`,
        height: `${preview.h * 100}%`,
        transform: `translate(${(preview.x - bounds.x) / preview.w * 100}%, ${(preview.y - bounds.y) / preview.h * 100}%)`
    };
}

function resizeFloatingBounds(startBounds: FloatBounds, corner: ResizeCorner, dx: number, dy: number): FloatBounds {
    const { x: startX, y: startY, w: startWidth, h: startHeight } = startBounds;
    const right = startX + startWidth;
    const bottom = startY + startHeight;

    let x = startX;
    let y = startY;
    let w = startWidth;
    let h = startHeight;

    if (corner.endsWith("left")) {
        x = clamp(startX + dx, 0, right - FLOAT_MIN_SIZE);
        w = right - x;
    } else {
        w = clamp(startWidth + dx, FLOAT_MIN_SIZE, 1 - startX);
    }

    if (corner.startsWith("top")) {
        y = clamp(startY + dy, 0, bottom - FLOAT_MIN_SIZE);
        h = bottom - y;
    } else {
        h = clamp(startHeight + dy, FLOAT_MIN_SIZE, 1 - startY);
    }

    return { x, y, w, h };
}

function WorkspaceHostComponent({ routeTarget, routeElement }: WorkspaceHostProps) {
    const pluginRunning = isHyprTilesRunning();
    const canvasRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!pluginRunning) return;
        syncRouteTarget(routeTarget);
    }, [pluginRunning, routeTarget?.channelId, routeTarget?.guildId]);

    useStateFromStores([HyprTilesStore], () => HyprTilesStore.getRevision(), []);
    const state = HyprTilesStore.getState();
    const { showTileHeaders, enableAnimations, gaps } = settings.store;
    const workspace = state.workspaces[String(state.activeWorkspace)];
    const layoutRects = workspace ? computeLayoutRects(workspace) : { orderedIds: [], rects: {}, leafRects: {}, nodeRects: {}, tileToLeafId: {} };
    const leafIds = workspace ? getLeafIds(workspace) : [];
    const pinnedTiles = getPinnedTiles();
    const scratchpads = getVisibleScratchpads(state.activeWorkspace);
    const overviewOpen = isWorkspaceOverviewOpen();

    const [dragState, setDragState] = useState<DragState | null>(null);
    const [floatDragState, setFloatDragState] = useState<FloatDragState | null>(null);
    const [resizeState, setResizeState] = useState<ResizeState | null>(null);
    const dragSessionRef = useRef<PointerSession<DragState> | null>(null);
    const floatDragSessionRef = useRef<PointerSession<FloatDragState> | null>(null);
    const resizeSessionRef = useRef<PointerSession<ResizeState> | null>(null);
    const dragFrameRef = useRef<number | null>(null);
    const resizeFrameRef = useRef<number | null>(null);
    const [floatPreview, setFloatPreview] = useState<{ tileId: string; bounds: FloatBounds; } | null>(null);
    const floatPreviewRef = useRef<{ tileId: string; bounds: FloatBounds; } | null>(null);
    const floatPreviewFrameRef = useRef<number | null>(null);

    const allLeafTileIds = leafIds.flatMap(leafId => {
        const leaf = workspace?.nodesById[leafId];
        return leaf?.kind === "leaf" ? leaf.tileIds : [];
    });

    const allTileIds = [
        ...allLeafTileIds,
        ...(workspace?.floatingTileIds ?? []),
        ...pinnedTiles.map(tile => tile.id),
        ...Object.values(state.scratchpadsById).map(scratchpad => scratchpad.tileId).filter(Boolean) as string[]
    ];

    const tileDisplayMap = useStateFromStores([ChannelStore, GuildStore, RelationshipStore, UserStore], () => {
        const entries = allTileIds.map(id => {
            const tile = state.tilesById[id];
            return tile ? [id, getTileDisplayInfo(tile)] : null;
        }).filter(Boolean) as Array<[string, ReturnType<typeof getTileDisplayInfo>]>;

        return Object.fromEntries(entries);
    }, [allTileIds.join("|"), state.activeWorkspace]);

    useEffect(() => () => {
        if (floatPreviewFrameRef.current !== null)
            cancelAnimationFrame(floatPreviewFrameRef.current);
    }, []);

    function queueFloatPreview(tileId: string, bounds: FloatBounds) {
        floatPreviewRef.current = { tileId, bounds };
        if (floatPreviewFrameRef.current !== null) return;

        floatPreviewFrameRef.current = window.requestAnimationFrame(() => {
            floatPreviewFrameRef.current = null;
            setFloatPreview(floatPreviewRef.current);
        });
    }

    function consumeFloatPreview(tileId: string, fallback: FloatBounds) {
        const preview = floatPreviewRef.current;

        if (floatPreviewFrameRef.current !== null) {
            cancelAnimationFrame(floatPreviewFrameRef.current);
            floatPreviewFrameRef.current = null;
        }

        floatPreviewRef.current = null;
        setFloatPreview(null);

        return preview?.tileId === tileId ? preview.bounds : fallback;
    }

    function getRenderedFloatBounds(tileId: string, bounds: FloatBounds) {
        return floatPreview?.tileId === tileId ? floatPreview.bounds : bounds;
    }

    useEffect(() => {
        function onPointerMove(event: PointerEvent) {
            const activeDrag = dragSessionRef.current;
            if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
            if (dragFrameRef.current !== null) cancelAnimationFrame(dragFrameRef.current);
            dragFrameRef.current = requestAnimationFrame(() => {
                dragFrameRef.current = null;
            const hovered = (document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-hypr-tile-id]") as HTMLElement | null);
            const targetTileId = hovered?.dataset.hyprTileId ?? null;
            const zone = hovered ? getDropZone(hovered.getBoundingClientRect(), event.clientX, event.clientY) : null;
                const next = { ...activeDrag, targetTileId, zone, groupOnCenter: event.ctrlKey || event.metaKey };
                dragSessionRef.current = next;
                setDragState(next);
            });
        }

        function finishDrag(event?: PointerEvent) {
            const activeDrag = dragSessionRef.current;
            if (!activeDrag || event && event.pointerId !== activeDrag.pointerId) return;
            dragSessionRef.current = null;
            activeDrag.endInteraction();
            if (activeDrag.target.hasPointerCapture(activeDrag.pointerId)) activeDrag.target.releasePointerCapture(activeDrag.pointerId);
            if (dragFrameRef.current !== null) {
                cancelAnimationFrame(dragFrameRef.current);
                dragFrameRef.current = null;
            }
            if (event?.type === "pointerup" && activeDrag.targetTileId && activeDrag.zone)
                moveTileByDropAndNavigate(activeDrag.tileId, activeDrag.targetTileId, activeDrag.zone, activeDrag.groupOnCenter);
            setDragState(null);
        }

        function onKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") finishDrag();
        }

        function onVisibilityChange() {
            if (document.hidden) finishDrag();
        }
        function onBlur() {
            finishDrag();
        }

        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", finishDrag);
        window.addEventListener("pointercancel", finishDrag);
        window.addEventListener("lostpointercapture", finishDrag);
        window.addEventListener("blur", onBlur);
        window.addEventListener("keydown", onKeyDown, true);
        document.addEventListener("visibilitychange", onVisibilityChange);
        return () => {
            finishDrag();
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerup", finishDrag);
            window.removeEventListener("pointercancel", finishDrag);
            window.removeEventListener("lostpointercapture", finishDrag);
            window.removeEventListener("blur", onBlur);
            window.removeEventListener("keydown", onKeyDown, true);
            document.removeEventListener("visibilitychange", onVisibilityChange);
        };
    }, []);

    useEffect(() => {
        function onPointerMove(event: PointerEvent) {
            const activeFloatDrag = floatDragSessionRef.current;
            if (!activeFloatDrag || event.pointerId !== activeFloatDrag.pointerId) return;
            const canvasRect = canvasRef.current?.getBoundingClientRect();
            if (!canvasRect) return;

            const dx = (event.clientX - activeFloatDrag.startX) / canvasRect.width;
            const dy = (event.clientY - activeFloatDrag.startY) / canvasRect.height;

            queueFloatPreview(activeFloatDrag.tileId, {
                x: Math.max(0, Math.min(1 - activeFloatDrag.startBounds.w, activeFloatDrag.startBounds.x + dx)),
                y: Math.max(0, Math.min(1 - activeFloatDrag.startBounds.h, activeFloatDrag.startBounds.y + dy)),
                w: activeFloatDrag.startBounds.w,
                h: activeFloatDrag.startBounds.h,
            });
        }

        function finishFloatDrag(event?: PointerEvent) {
            const activeFloatDrag = floatDragSessionRef.current;
            if (!activeFloatDrag || event && event.pointerId !== activeFloatDrag.pointerId) return;
            floatDragSessionRef.current = null;
            activeFloatDrag.endInteraction();
            if (activeFloatDrag.target.hasPointerCapture(activeFloatDrag.pointerId)) activeFloatDrag.target.releasePointerCapture(activeFloatDrag.pointerId);
            if (event?.type === "pointerup")
                updateTileFloatBounds(activeFloatDrag.tileId, consumeFloatPreview(activeFloatDrag.tileId, activeFloatDrag.startBounds));
            else consumeFloatPreview(activeFloatDrag.tileId, activeFloatDrag.startBounds);
            setFloatDragState(null);
        }

        function onVisibilityChange() {
            if (document.hidden) finishFloatDrag();
        }
        function onBlur() {
            finishFloatDrag();
        }
        function onKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") finishFloatDrag();
        }

        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", finishFloatDrag);
        window.addEventListener("pointercancel", finishFloatDrag);
        window.addEventListener("lostpointercapture", finishFloatDrag);
        window.addEventListener("blur", onBlur);
        window.addEventListener("keydown", onKeyDown, true);
        document.addEventListener("visibilitychange", onVisibilityChange);
        return () => {
            finishFloatDrag();
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerup", finishFloatDrag);
            window.removeEventListener("pointercancel", finishFloatDrag);
            window.removeEventListener("lostpointercapture", finishFloatDrag);
            window.removeEventListener("blur", onBlur);
            window.removeEventListener("keydown", onKeyDown, true);
            document.removeEventListener("visibilitychange", onVisibilityChange);
        };
    }, []);

    useEffect(() => {
        function onPointerMove(event: PointerEvent) {
            const activeResize = resizeSessionRef.current;
            if (!activeResize || event.pointerId !== activeResize.pointerId) return;
            const canvasRect = canvasRef.current?.getBoundingClientRect();
            if (!canvasRect) return;

            if (activeResize.kind === "floating") {
                const dx = (event.clientX - activeResize.startX) / canvasRect.width;
                const dy = (event.clientY - activeResize.startY) / canvasRect.height;

                queueFloatPreview(
                    activeResize.tileId,
                    resizeFloatingBounds(activeResize.startBounds, activeResize.corner, dx, dy)
                );
                return;
            }

            if (!workspace) return;
            if (resizeFrameRef.current !== null) cancelAnimationFrame(resizeFrameRef.current);
            resizeFrameRef.current = requestAnimationFrame(() => {
                resizeFrameRef.current = null;
                for (const splitId of [activeResize.horizontalSplitId, activeResize.verticalSplitId]) {
                    if (!splitId) continue;
                    const splitRect = layoutRects.nodeRects[splitId];
                    const split = workspace.nodesById[splitId];
                    if (!splitRect || !split || split.kind !== "split") continue;
                    const ratio = split.axis === "x"
                        ? (event.clientX - (canvasRect.left + splitRect.x * canvasRect.width)) / (splitRect.w * canvasRect.width)
                        : (event.clientY - (canvasRect.top + splitRect.y * canvasRect.height)) / (splitRect.h * canvasRect.height);
                    updateSplitRatio(splitId, ratio);
                }
            });
        }

        function finishResize(event?: PointerEvent) {
            const activeResize = resizeSessionRef.current;
            if (!activeResize || event && event.pointerId !== activeResize.pointerId) return;
            resizeSessionRef.current = null;
            activeResize.endInteraction();
            if (activeResize.target.hasPointerCapture(activeResize.pointerId)) activeResize.target.releasePointerCapture(activeResize.pointerId);
            if (resizeFrameRef.current !== null) {
                cancelAnimationFrame(resizeFrameRef.current);
                resizeFrameRef.current = null;
            }
            if (activeResize.kind === "floating") {
                const bounds = consumeFloatPreview(activeResize.tileId, activeResize.startBounds);
                if (event?.type === "pointerup") updateTileFloatBounds(activeResize.tileId, bounds);
            }
            setResizeState(null);
        }

        function onVisibilityChange() {
            if (document.hidden) finishResize();
        }
        function onBlur() {
            finishResize();
        }
        function onKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") finishResize();
        }

        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", finishResize);
        window.addEventListener("pointercancel", finishResize);
        window.addEventListener("lostpointercapture", finishResize);
        window.addEventListener("blur", onBlur);
        window.addEventListener("keydown", onKeyDown, true);
        document.addEventListener("visibilitychange", onVisibilityChange);
        return () => {
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerup", finishResize);
            window.removeEventListener("pointercancel", finishResize);
            window.removeEventListener("lostpointercapture", finishResize);
            window.removeEventListener("blur", onBlur);
            window.removeEventListener("keydown", onKeyDown, true);
            document.removeEventListener("visibilitychange", onVisibilityChange);
        };
    }, [layoutRects.nodeRects, workspace]);

    useEffect(() => () => {
        const activeResize = resizeSessionRef.current;
        if (activeResize) {
            resizeSessionRef.current = null;
            activeResize.endInteraction();
            if (activeResize.target.hasPointerCapture(activeResize.pointerId))
                activeResize.target.releasePointerCapture(activeResize.pointerId);
        }
        if (resizeFrameRef.current !== null) cancelAnimationFrame(resizeFrameRef.current);
    }, []);

    if (!pluginRunning || !routeTarget || !workspace) return <>{routeElement}</>;

    const renderTileShell = (
        tile: TileEntity,
        contentStyle: React.CSSProperties,
        options: {
            focused: boolean;
            floating?: boolean;
            header?: React.ReactNode;
            body?: React.ReactNode;
            onHeaderMouseDown?: React.PointerEventHandler<HTMLElement>;
            onResizeStart?: (corner: ResizeCorner, event: React.PointerEvent<HTMLButtonElement>) => void;
        }
    ) => {
        const info = tileDisplayMap[tile.id] ?? { title: "Tile", badge: "CHAN" };
        const isPrimary = workspace.primaryTileId === tile.id;
        const liveBoundsTileId = floatPreview?.tileId
            ?? floatDragState?.tileId
            ?? (resizeState?.kind === "floating" ? resizeState.tileId : null);

        return (
            <section
                key={tile.id}
                className={classes(
                    cl("tile"),
                    options.floating && cl("tile-floating"),
                    options.focused && cl("tile-focused"),
                    !options.focused && cl("tile-unfocused"),
                    dragState?.tileId === tile.id && cl("tile-dragging"),
                    liveBoundsTileId === tile.id && cl("tile-live-bounds")
                )}
                style={contentStyle}
                data-hypr-tile-id={tile.id}
            >
                {showTileHeaders && (
                    <header className={cl("tile-header")} onPointerDown={options.onHeaderMouseDown}>
                        {options.header ?? (
                            <>
                                <button
                                    type="button"
                                    className={cl("tile-title-button")}
                                    onClick={() => {
                                        if (!options.focused) void focusTileById(tile.id);
                                    }}
                                >
                                    <span className={cl("tile-badge")}>{info.badge}</span>
                                    {info.title !== info.badge && <span className={cl("tile-title")}>{info.title}</span>}
                                </button>
                                <button
                                    type="button"
                                    className={cl("tile-close")}
                                    onClick={event => {
                                        event.stopPropagation();
                                        void closeSpecificTileAndNavigate(tile.id);
                                    }}
                                    aria-label="Close tile"
                                >
                                    <CloseIcon width={14} height={14} />
                                </button>
                            </>
                        )}
                    </header>
                )}

                <div className={cl("tile-body")}>
                    {options.body ?? (
                        isPrimary
                            ? routeElement
                            : <TileContent tile={tile} active={options.focused} />
                    )}
                </div>

                {!options.focused && (
                    <button
                        type="button"
                        className={cl("tile-overlay")}
                        aria-label={`Focus ${info.title}`}
                        onClick={() => void focusTileById(tile.id)}
                    />
                )}

                {options.onResizeStart && resizeCorners.map(corner => (
                    <button
                        key={`${tile.id}-${corner}`}
                        type="button"
                        className={classes(cl("resize-handle"), cl(`resize-${corner}`))}
                        aria-label={`Resize ${info.title}`}
                        onPointerDown={event => options.onResizeStart?.(corner, event)}
                    />
                ))}
            </section>
        );
    };

    return (
        <div className={classes(cl("root"), enableAnimations && cl("animated"))}>
            <div ref={canvasRef} className={cl("workspace-canvas")} data-layout={workspace.layout}>
                {leafIds.map(leafId => {
                    const leaf = workspace.nodesById[leafId];
                    if (leaf?.kind !== "leaf") return null;

                    const rect = layoutRects.leafRects[leafId];
                    if (!rect) return null;

                    const focused = workspace.focusedTileId === leaf.activeTileId;
                    const style = {
                        left: `calc(${rect.x * 100}% + ${gaps / 2}px)`,
                        top: `calc(${rect.y * 100}% + ${gaps / 2}px)`,
                        width: `calc(${rect.w * 100}% - ${gaps}px)`,
                        height: `calc(${rect.h * 100}% - ${gaps}px)`
                    };

                    const header = leaf.tileIds.length > 1 && (
                        <div className={cl("tab-strip")}>
                            {leaf.tileIds.map(tileId => {
                                const tileInfo = tileDisplayMap[tileId] ?? { title: "Tile", badge: "CHAN" };
                                return (
                                    <button
                                        key={tileId}
                                        type="button"
                                        className={classes(cl("tab"), leaf.activeTileId === tileId && cl("tab-active"))}
                                        onClick={() => void focusTileById(tileId)}
                                    >
                                        {tileInfo.title}
                                    </button>
                                );
                            })}
                        </div>
                    );

                    const body = (
                        <div className={cl("leaf-body")}>
                            {leaf.tileIds.map(tileId => {
                                const tile = state.tilesById[tileId];
                                if (!tile) return null;
                                const active = leaf.activeTileId === tileId;
                                const primary = workspace.primaryTileId === tileId;

                                return (
                                    <div key={tileId} className={classes(cl("tab-panel"), !active && cl("tab-panel-hidden"))}>
                                        {primary && active
                                            ? routeElement
                                            : <TileContent tile={tile} active={focused && active} />}
                                    </div>
                                );
                            })}
                        </div>
                    );

                    const activeTile = state.tilesById[leaf.activeTileId];
                    if (!activeTile) return null;

                    return (
                        <React.Fragment key={leafId}>
                            {renderTileShell(activeTile, style, {
                                focused,
                                header: (
                                    <>
                                        <button
                                            type="button"
                                            className={cl("tile-title-button")}
                                            onClick={() => {
                                                if (!focused) void focusTileById(leaf.activeTileId);
                                            }}
                                        >
                                            <span className={cl("tile-badge")}>{leaf.tabGroupName ?? (tileDisplayMap[leaf.activeTileId]?.badge ?? "CHAN")}</span>
                                            <span className={cl("tile-title")}>{tileDisplayMap[leaf.activeTileId]?.title ?? "Tile"}</span>
                                        </button>
                                        {header}
                                        <button
                                            type="button"
                                            className={cl("tile-close")}
                                            onClick={event => {
                                                event.stopPropagation();
                                                void closeSpecificTileAndNavigate(leaf.activeTileId);
                                            }}
                                            aria-label="Close tile"
                                        >
                                            <CloseIcon width={14} height={14} />
                                        </button>
                                    </>
                                ),
                                body,
                                onHeaderMouseDown: event => {
                                    if (event.button !== 0) return;
                                    if (event.altKey && event.shiftKey) {
                                        event.preventDefault();
                                        const drag = { tileId: leaf.activeTileId, targetTileId: null, zone: null, groupOnCenter: false };
                                        event.currentTarget.setPointerCapture(event.pointerId);
                                        dragSessionRef.current = { ...drag, pointerId: event.pointerId, target: event.currentTarget, endInteraction: RuntimeInteractions.begin() };
                                        setDragState(drag);
                                        return;
                                    }
                                },
                                onResizeStart: (corner, event) => {
                                    const horizontalSplitId = corner.endsWith("left")
                                        ? findResizableSplit(workspace, leaf.activeTileId, "left") ?? findResizableSplit(workspace, leaf.activeTileId, "right")
                                        : findResizableSplit(workspace, leaf.activeTileId, "right") ?? findResizableSplit(workspace, leaf.activeTileId, "left");
                                    const verticalSplitId = corner.startsWith("top")
                                        ? findResizableSplit(workspace, leaf.activeTileId, "up") ?? findResizableSplit(workspace, leaf.activeTileId, "down")
                                        : findResizableSplit(workspace, leaf.activeTileId, "down") ?? findResizableSplit(workspace, leaf.activeTileId, "up");
                                    if (!horizontalSplitId && !verticalSplitId) return;
                                    event.preventDefault();
                                    event.stopPropagation();
                                    const resize = { kind: "tiled", horizontalSplitId, verticalSplitId } as const;
                                    event.currentTarget.setPointerCapture(event.pointerId);
                                    resizeSessionRef.current = { ...resize, pointerId: event.pointerId, target: event.currentTarget, endInteraction: RuntimeInteractions.begin() };
                                    setResizeState(resize);
                                }
                            })}
                        </React.Fragment>
                    );
                })}

                {workspace.floatingTileIds.map(tileId => {
                    const tile = state.tilesById[tileId];
                    if (!tile?.floatBounds) return null;
                    const renderedBounds = getRenderedFloatBounds(tile.id, tile.floatBounds);

                    return renderTileShell(tile, toPreviewStyle(tile.floatBounds, floatPreview?.tileId === tile.id ? renderedBounds : undefined), {
                        focused: workspace.focusedTileId === tile.id,
                        floating: true,
                        onHeaderMouseDown: event => {
                            if (event.button !== 0) return;
                            event.preventDefault();
                            const drag = { tileId: tile.id, startX: event.clientX, startY: event.clientY, startBounds: renderedBounds };
                            event.currentTarget.setPointerCapture(event.pointerId);
                            floatDragSessionRef.current = { ...drag, pointerId: event.pointerId, target: event.currentTarget, endInteraction: RuntimeInteractions.begin() };
                            setFloatDragState(drag);
                        },
                        onResizeStart: (corner, event) => {
                            if (event.button !== 0) return;
                            event.preventDefault();
                            event.stopPropagation();
                            const resize = {
                                kind: "floating",
                                tileId: tile.id,
                                corner,
                                startX: event.clientX,
                                startY: event.clientY,
                                startBounds: renderedBounds
                            } as const;
                            event.currentTarget.setPointerCapture(event.pointerId);
                            resizeSessionRef.current = { ...resize, pointerId: event.pointerId, target: event.currentTarget, endInteraction: RuntimeInteractions.begin() };
                            setResizeState(resize);
                        }
                    });
                })}

                {scratchpads.map(({ scratchpad, tile }) =>
                    renderTileShell(tile, toPreviewStyle(
                        tile.floatBounds ?? scratchpad.bounds,
                        floatPreview?.tileId === tile.id ? floatPreview.bounds : undefined
                    ), {
                        focused: workspace.focusedTileId === tile.id,
                        floating: true,
                        onHeaderMouseDown: event => {
                            if (event.button !== 0) return;
                            event.preventDefault();
                            const drag = {
                                tileId: tile.id,
                                startX: event.clientX,
                                startY: event.clientY,
                                startBounds: getRenderedFloatBounds(tile.id, tile.floatBounds ?? scratchpad.bounds)
                            };
                            event.currentTarget.setPointerCapture(event.pointerId);
                            floatDragSessionRef.current = { ...drag, pointerId: event.pointerId, target: event.currentTarget, endInteraction: RuntimeInteractions.begin() };
                            setFloatDragState(drag);
                        },
                        onResizeStart: (corner, event) => {
                            const bounds = getRenderedFloatBounds(tile.id, tile.floatBounds ?? scratchpad.bounds);
                            if (event.button !== 0) return;
                            event.preventDefault();
                            event.stopPropagation();
                            const resize = {
                                kind: "floating",
                                tileId: tile.id,
                                corner,
                                startX: event.clientX,
                                startY: event.clientY,
                                startBounds: bounds
                            } as const;
                            event.currentTarget.setPointerCapture(event.pointerId);
                            resizeSessionRef.current = { ...resize, pointerId: event.pointerId, target: event.currentTarget, endInteraction: RuntimeInteractions.begin() };
                            setResizeState(resize);
                        }
                    })
                )}

                {pinnedTiles.map((tile, index) => {
                    const width = 0.28;
                    const height = 0.24;
                    const left = 1 - width - 0.02;
                    const top = 0.02 + index * 0.05;

                    return renderTileShell(tile, {
                        left: `${left * 100}%`,
                        top: `${top * 100}%`,
                        width: `${width * 100}%`,
                        height: `${height * 100}%`,
                        zIndex: 40 + index,
                    }, {
                        focused: workspace.focusedTileId === tile.id,
                        floating: true,
                    });
                })}

                {dragState?.targetTileId && dragState.zone && (
                    <div
                        className={classes(cl("drop-overlay"), cl(`drop-${dragState.zone}`), dragState.groupOnCenter && cl("drop-group"))}
                        style={layoutRects.rects[dragState.targetTileId] ? {
                            left: `${layoutRects.rects[dragState.targetTileId].x * 100}%`,
                            top: `${layoutRects.rects[dragState.targetTileId].y * 100}%`,
                            width: `${layoutRects.rects[dragState.targetTileId].w * 100}%`,
                            height: `${layoutRects.rects[dragState.targetTileId].h * 100}%`,
                        } : void 0}
                    />
                )}

                {overviewOpen && (
                    <div className={cl("overview")}>
                        <div className={cl("overview-header")}>
                            <span>Workspaces</span>
                            <button type="button" className={cl("overview-close")} onClick={() => toggleWorkspaceOverview()}>Close</button>
                        </div>
                        <div className={cl("overview-grid")}>
                            {Object.entries(state.workspaces).map(([workspaceId, ws]) => {
                                const miniRects = computeLayoutRects(ws);
                                return (
                                    <button
                                        key={workspaceId}
                                        type="button"
                                        className={classes(cl("overview-card"), Number(workspaceId) === state.activeWorkspace && cl("overview-card-active"))}
                                        onClick={() => {
                                            switchWorkspaceAndNavigate(Number(workspaceId) as typeof state.activeWorkspace);
                                            toggleWorkspaceOverview();
                                        }}
                                    >
                                        <span className={cl("overview-card-title")}>Workspace {workspaceId}</span>
                                        <span className={cl("overview-mini")}>
                                            {miniRects.orderedIds.map(tileId => (
                                                <span
                                                    key={tileId}
                                                    className={cl("overview-mini-tile")}
                                                    style={{
                                                        left: `${miniRects.rects[tileId].x * 100}%`,
                                                        top: `${miniRects.rects[tileId].y * 100}%`,
                                                        width: `${miniRects.rects[tileId].w * 100}%`,
                                                        height: `${miniRects.rects[tileId].h * 100}%`,
                                                    }}
                                                >
                                                    {tileDisplayMap[tileId]?.title ?? "Tile"}
                                                </span>
                                            ))}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export const WorkspaceHost = ErrorBoundary.wrap(WorkspaceHostComponent, { noop: true });
