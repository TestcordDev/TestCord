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
import { activateTabByIndex, closeTab, createTabAfter, cycleTab, getActiveTab, getActiveTabId, getTabs, initTabs, moveTab, reopenClosedTab, subscribe } from "../util/store";
import { TabTarget } from "../util/types";
import { ChromeTab } from "./ChromeTab";
import { cancelChromeTabSwitcher, cycleChromeTabSwitcher, handleSwitcherKeyDown, handleSwitcherKeyUp, isChromeTabSwitcherOpen } from "./ChromeTabSwitcher";
import { StripContextMenu } from "./ContextMenus";

const cl = classNameFactory("tc-chrometabs-");

const NEW_TAB_BUTTON_WIDTH = 34;
export const NARROW_TAB_WIDTH = 88;
export const TINY_TAB_WIDTH = 66;

function matchesKeybind(e: KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return null;

    const key = e.key.toLowerCase();

    if (key === "t" && !e.shiftKey) return "new" as const;
    if (key === "t" && e.shiftKey) return "reopen" as const;
    if (key === "w" && !e.shiftKey) return "close" as const;
    if (key === "tab") return e.shiftKey ? "prev" as const : "next" as const;

    const digit = Number.parseInt(e.key, 10);
    if (!e.shiftKey && digit >= 1 && digit <= 9) return { jump: digit };

    return null;
}

export interface ChromeTabsStripProps extends TabTarget {
    titleBar?: boolean;
}

export function ChromeTabsStrip({ guildId, channelId, titleBar }: ChromeTabsStripProps) {
    const forceUpdate = useForceUpdater();
    const [userId, setUserId] = useState("");

    const { maxTabWidth, enableKeybinds } = settings.use(["maxTabWidth", "enableKeybinds"]);

    const stripRef = useRef<HTMLDivElement>(null);
    const [tabWidth, setTabWidth] = useState(maxTabWidth);

    const [dragIndex, setDragIndex] = useState<number | null>(null);

    const isFullscreen = useStateFromStores([ChannelRTCStore], () => ChannelRTCStore.isFullscreenInContext() ?? false);

    const targetRef = useRef({ guildId, channelId });
    targetRef.current = { guildId, channelId };

    useEffect(() => subscribe(forceUpdate), [forceUpdate]);

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

    const recalculateTabWidth = useCallback(() => {
        const strip = stripRef.current;
        if (!strip || tabCount === 0) return;

        const available = strip.clientWidth - NEW_TAB_BUTTON_WIDTH;
        if (available <= 0) return;

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
        const target = active
            ? { guildId: active.guildId, channelId: active.channelId }
            : targetRef.current;

        if (active) createTabAfter(active.id, target, true);
    }, []);

    useEffect(() => {
        if (!enableKeybinds) return;

        const onKeyDown = (e: KeyboardEvent) => {
            if (isChromeTabSwitcherOpen()) {
                if (handleSwitcherKeyDown(e)) return;
            }

            const action = matchesKeybind(e);
            if (!action) return;

            if (typeof action === "object") {
                const index = action.jump === 9 ? getTabs().length - 1 : action.jump - 1;
                if (getTabs()[index]) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    activateTabByIndex(index);
                }
                return;
            }

            switch (action) {
                case "new":
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    openNewTab();
                    break;
                case "reopen":
                    if (settings.store.reopenTabKeybind) {
                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation();
                        reopenClosedTab();
                    }
                    break;
                case "close": {
                    const active = getActiveTab();
                    if (active && getTabs().length > 1) {
                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation();
                        closeTab(active.id);
                    }
                    break;
                }
                case "next":
                case "prev":
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    if (settings.store.ctrlTabSwitcher && getTabs().length > 1) {
                        cycleChromeTabSwitcher(action === "next" ? 1 : -1);
                    } else {
                        cycleTab(action === "next" ? 1 : -1);
                    }
                    break;
            }
        };

        const onKeyUp = (e: KeyboardEvent) => {
            if (isChromeTabSwitcherOpen()) {
                handleSwitcherKeyUp(e);
            }
        };

        const onBlur = () => {
            if (isChromeTabSwitcherOpen()) {
                cancelChromeTabSwitcher();
            }
        };

        window.addEventListener("keydown", onKeyDown, true);
        window.addEventListener("keyup", onKeyUp, true);
        window.addEventListener("blur", onBlur);
        return () => {
            window.removeEventListener("keydown", onKeyDown, true);
            window.removeEventListener("keyup", onKeyUp, true);
            window.removeEventListener("blur", onBlur);
            cancelChromeTabSwitcher();
        };
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
            className={classes(cl("container"), titleBar && cl("container-titlebar"))}
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
                        isBeforeActive={tabs[index + 1]?.id === activeId}
                        narrow={tabWidth < NARROW_TAB_WIDTH}
                        tiny={tabWidth < TINY_TAB_WIDTH}
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
