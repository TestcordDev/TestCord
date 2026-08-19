/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { useForceUpdater } from "@utils/react";
import { ChannelRTCStore, ContextMenuApi, FluxDispatcher, useCallback, useEffect, useLayoutEffect, useRef, UserStore, useState, useStateFromStores } from "@webpack/common";

import { PlusIcon } from "../util/icons";
import { MIN_TAB_WIDTH, settings } from "../util/settings";
import { activateTabByIndex, closeTab, createTabAfter, cycleTab, getActiveTab, getActiveTabId, getTabs, initTabs, moveTab, subscribe } from "../util/store";
import { TabTarget } from "../util/types";
import { ChromeTab } from "./ChromeTab";
import { StripContextMenu } from "./ContextMenus";

const cl = classNameFactory("tc-chrometabs-");

/** Width reserved for the "+" button so tabs never overlap it */
const NEW_TAB_BUTTON_WIDTH = 34;

function matchesKeybind(e: KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return null;

    const key = e.key.toLowerCase();

    if (key === "t" && !e.shiftKey) return "new" as const;
    if (key === "w" && !e.shiftKey) return "close" as const;
    if (key === "tab") return e.shiftKey ? "prev" as const : "next" as const;

    const digit = Number.parseInt(e.key, 10);
    if (!e.shiftKey && digit >= 1 && digit <= 9) return { jump: digit - 1 };

    return null;
}

export function ChromeTabsStrip(props: TabTarget) {
    const forceUpdate = useForceUpdater();
    const [userId, setUserId] = useState("");

    const { maxTabWidth, enableKeybinds } = settings.use(["maxTabWidth", "enableKeybinds"]);

    const stripRef = useRef<HTMLDivElement>(null);
    const [tabWidth, setTabWidth] = useState(maxTabWidth);

    // drag-reorder state; indices refer to positions in the tab array
    const [dragIndex, setDragIndex] = useState<number | null>(null);

    // hide the strip in fullscreen video calls, where Discord takes the whole window
    const isFullscreen = useStateFromStores([ChannelRTCStore], () => ChannelRTCStore.isFullscreenInContext() ?? false);

    // keep the newest navigation target around without re-running effects on every change
    const targetRef = useRef(props);
    targetRef.current = props;

    // re-render whenever the tab store changes
    useEffect(() => subscribe(forceUpdate), [forceUpdate]);

    // build the strip once the user is known, and again if the account changes
    useEffect(() => {
        const onReady = () => {
            const user = UserStore.getCurrentUser();
            if (!user) return;

            void initTabs(user.id, targetRef.current).then(() => setUserId(user.id));
        };

        onReady();
        FluxDispatcher.subscribe("CONNECTION_OPEN_SUPPLEMENTAL", onReady);
        return () => FluxDispatcher.unsubscribe("CONNECTION_OPEN_SUPPLEMENTAL", onReady);
    }, []);

    const tabs = getTabs();
    const activeId = getActiveTabId();
    const tabCount = tabs.length;

    /**
     * Chrome divides the strip evenly between tabs, capping at a comfortable width
     * and refusing to shrink past a floor (after which the strip scrolls instead).
     */
    const recalculateTabWidth = useCallback(() => {
        const strip = stripRef.current;
        if (!strip || tabCount === 0) return;

        const available = strip.clientWidth - NEW_TAB_BUTTON_WIDTH;
        if (available <= 0) return;

        // tabs overlap by 1px so their curves meet, matching Chrome
        const ideal = Math.floor(available / tabCount);
        setTabWidth(Math.max(MIN_TAB_WIDTH, Math.min(maxTabWidth, ideal)));
    }, [tabCount, maxTabWidth]);

    useLayoutEffect(recalculateTabWidth, [recalculateTabWidth]);

    useEffect(() => {
        const strip = stripRef.current;
        if (!strip) return;

        const observer = new ResizeObserver(recalculateTabWidth);
        observer.observe(strip);
        return () => observer.disconnect();
    }, [recalculateTabWidth]);

    const openNewTab = useCallback(() => {
        const active = getActiveTab();
        const target = targetRef.current;

        if (active) createTabAfter(active.id, target, true);
    }, []);

    // keyboard shortcuts, captured before Discord's own handlers see them
    useEffect(() => {
        if (!enableKeybinds) return;

        const onKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) return;

            const action = matchesKeybind(e);
            if (!action) return;

            if (typeof action === "object") {
                if (getTabs()[action.jump]) {
                    e.preventDefault();
                    activateTabByIndex(action.jump);
                }
                return;
            }

            switch (action) {
                case "new":
                    e.preventDefault();
                    e.stopPropagation(); // otherwise Discord opens the quick switcher
                    openNewTab();
                    break;
                case "close": {
                    const active = getActiveTab();
                    if (active && getTabs().length > 1) {
                        e.preventDefault();
                        closeTab(active.id);
                    }
                    break;
                }
                case "next":
                case "prev":
                    e.preventDefault();
                    e.stopPropagation(); // Discord uses Ctrl+Tab for guild switching
                    cycleTab(action === "next" ? 1 : -1);
                    break;
            }
        };

        document.addEventListener("keydown", onKeyDown, true);
        return () => document.removeEventListener("keydown", onKeyDown, true);
    }, [enableKeybinds, openNewTab]);

    const handleDragStart = useCallback((index: number) => setDragIndex(index), []);

    const handleDragEnter = useCallback((index: number) => {
        setDragIndex(current => {
            if (current == null || current === index) return current;
            moveTab(current, index);
            return index;
        });
    }, []);

    const handleDragEnd = useCallback(() => setDragIndex(null), []);

    if (!userId || isFullscreen || tabCount === 0) return null;

    return (
        <div
            className={cl("container")}
            onContextMenu={e => ContextMenuApi.openContextMenu(e, () => (
                <StripContextMenu onNewTab={openNewTab} />
            ))}
        >
            <div
                className={cl("strip")}
                ref={stripRef}
                role="tablist"
                style={{ "--tc-tab-width": `${tabWidth}px` } as React.CSSProperties}
            >
                {tabs.map((tab, index) => (
                    <ChromeTab
                        key={tab.id}
                        tab={tab}
                        index={index}
                        isActive={tab.id === activeId}
                        canClose={tabCount > 1}
                        isDragging={dragIndex === index}
                        onDragStart={handleDragStart}
                        onDragEnter={handleDragEnter}
                        onDragEnd={handleDragEnd}
                    />
                ))}

                <button
                    className={classes(cl("new-tab"))}
                    onClick={openNewTab}
                    aria-label="New tab"
                >
                    <PlusIcon size={16} />
                </button>
            </div>
        </div>
    );
}
