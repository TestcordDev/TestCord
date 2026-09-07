/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Settings } from "@api/Settings";
import { BaseText } from "@components/BaseText";
import ErrorBoundary from "@components/ErrorBoundary";
import { Flex } from "@components/Flex";
import { FormSwitch } from "@components/FormSwitch";
import {
    AppsIcon as FallbackAppsIcon,
    ScreenshareIcon as FallbackScreenshareIcon,
    VideoIcon as FallbackVideoIcon,
} from "@components/Icons";
import { iconsModule } from "@equicordplugins/_core/concatenatedModules";
import { filters, find } from "@webpack";
import {
    ChannelStore,
    openModalLazy,
    React,
    RTCConnectionStore,
    useEffect,
    useReducer,
    useRef,
    UserProfileStore,
    UserStore,
    useState,
    useStateFromStores,
} from "@webpack/common";

function PhoneHangUpIconFallback({ width = 16, height = 16, ...props }: any) {
    return (
        <svg width={width} height={height} viewBox="0 0 24 24" fill="currentColor" {...props}>
            <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.996.996 0 0 1 0-1.41C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.39.39.39 1.02 0 1.41l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
        </svg>
    );
}

function SoundboardIconFallback({ width = 16, height = 16, ...props }: any) {
    return (
        <svg width={width} height={height} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
            <path d="M12 3v18M8 7v10M4 10v4M16 7v10M20 10v4" />
        </svg>
    );
}

function getDiscordIcon(names: string[], FallbackComponent?: React.ComponentType<any>): React.ComponentType<any> {
    return (props: any) => {
        // 1. Try Discord's concatenated icons module (where all Discord icons reside)
        if (iconsModule) {
            for (const name of names) {
                const Icon = (iconsModule as any)[name];
                if (Icon && typeof Icon === "function") {
                    return <Icon {...props} />;
                }
            }
        }
        // 2. Try webpack search safely
        for (const name of names) {
            try {
                const found = (find(filters.byProps(name), { isIndirect: true }) as any)?.[name];
                if (found && typeof found === "function") {
                    return React.createElement(found, props);
                }
            } catch { }
        }
        // 3. High-quality SVG fallback
        if (FallbackComponent) {
            const { size, ...rest } = props;
            const sizePx = size === "xxs" ? 12 : size === "xs" ? 16 : size === "sm" ? 18 : size === "md" ? 24 : size === "lg" ? 32 : undefined;
            const width = props.width ?? sizePx ?? 16;
            const height = props.height ?? sizePx ?? 16;
            return <FallbackComponent width={width} height={height} {...rest} />;
        }
        return null;
    };
}

const VideoIcon = getDiscordIcon(["VideoIcon", "CameraIcon"], FallbackVideoIcon);
const ScreenArrowIcon = getDiscordIcon(["ScreenArrowIcon", "ScreenshareIcon", "ScreenIcon"], FallbackScreenshareIcon);
const AppsIcon = getDiscordIcon(["AppsIcon", "ActivitiesIcon"], FallbackAppsIcon);
const SoundboardIcon = getDiscordIcon(["SoundboardIcon"], SoundboardIconFallback);
const PhoneHangUpIcon = getDiscordIcon(["PhoneHangUpIcon", "PhoneIcon", "DisconnectIcon"], PhoneHangUpIconFallback);

import { ActivityIcon, ActivityInfo, PresenceStore } from "../activityBanner";
import { getBtnItems, svgs } from "../buttonDetection";
import {
    ChevronDownIcon,
    CodeIcon,
    GamepadIcon,
    getModuleIcon,
    MusicNoteIcon,
    SettingsGearIcon,
    VsCodeIcon,
} from "../icons";
import { MusicControlsComponent, SpotifyStore } from "../musicControls";
import {
    getPanelLayoutPlainSettings,
    getUserAreaOrder,
    registeredModules,
    setUserAreaItemEnabled,
    setUserAreaOrder,
    useModules,
} from "../registry";
import type { UserAreaReorderItem } from "../types";

const MODAL_BODY_HEIGHT = 344;

export function UserAreaReorderTab({
    pluginSettings,
    onOpenModuleSettings,
    onOpenButtonCustomizer,
    onOpenCallBarSettings,
}: {
    pluginSettings?: any;
    onOpenModuleSettings?: (moduleId: string) => void;
    onOpenButtonCustomizer?: () => void;
    onOpenCallBarSettings?: () => void;
}) {
    const [, forceUpdate] = useReducer(x => x + 1, 0);
    const [items, setItems] = useState<UserAreaReorderItem[]>(() => getUserAreaOrder());
    const modules = useModules();

    // Drag and drop state
    const dragFromIndex = useRef<number | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
    const [activeDragIndex, setActiveDragIndex] = useState<number | null>(null);

    const isActivityBannerActive = modules.some(m => m.id === "activity-banner" && m.enabled);
    const visibleItems = items.filter(it => {
        if (isActivityBannerActive && it.id === "native-activity-banner") return false;
        if (!isActivityBannerActive && (it.id === "activity-banner" || it.moduleId === "activity-banner")) return false;
        return true;
    });

    useEffect(() => {
        setItems(getUserAreaOrder());
    }, [modules]);

    const handleDragStart = (e: React.DragEvent, index: number) => {
        dragFromIndex.current = index;
        setActiveDragIndex(index);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(index));

        const img = new Image();
        img.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
        e.dataTransfer.setDragImage(img, 0, 0);
    };

    const handleDragOver = (e: React.DragEvent, index: number) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (dragOverIndex !== index) setDragOverIndex(index);
    };

    const applyNewVisibleOrder = (newVisible: UserAreaReorderItem[]) => {
        const updatedVisible = newVisible.map((it, idx) => ({ ...it, order: idx }));
        const updatedAll = items.map(it => {
            const found = updatedVisible.find(v => v.id === it.id);
            if (found) return found;
            if (it.id === "native-activity-banner") {
                const act = updatedVisible.find(v => v.id === "activity-banner");
                if (act) return { ...it, order: act.order };
            }
            if (it.id === "activity-banner") {
                const nat = updatedVisible.find(v => v.id === "native-activity-banner");
                if (nat) return { ...it, order: nat.order };
            }
            return it;
        });
        setItems(updatedAll);
        void setUserAreaOrder(updatedAll);
        forceUpdate();
    };

    const commitDrop = (targetIndex: number) => {
        const fromIndex = dragFromIndex.current;
        if (
            fromIndex !== null &&
            fromIndex !== targetIndex &&
            fromIndex >= 0 &&
            fromIndex < visibleItems.length &&
            targetIndex >= 0 &&
            targetIndex < visibleItems.length
        ) {
            const next = [...visibleItems];
            const [moved] = next.splice(fromIndex, 1);
            next.splice(targetIndex, 0, moved);
            applyNewVisibleOrder(next);
        }
        dragFromIndex.current = null;
        setActiveDragIndex(null);
        setDragOverIndex(null);
    };

    const moveItem = (index: number, direction: -1 | 1) => {
        const targetIndex = index + direction;
        if (targetIndex < 0 || targetIndex >= visibleItems.length) return;
        const next = [...visibleItems];
        const [moved] = next.splice(index, 1);
        next.splice(targetIndex, 0, moved);
        applyNewVisibleOrder(next);
    };

    const toggleItem = (id: string, enabled: boolean) => {
        const updated = items.map(it => {
            if (it.id === id) return { ...it, enabled };
            if (id === "activity-banner" && it.id === "native-activity-banner") {
                return { ...it, enabled };
            }
            return it;
        });
        setItems(updated);
        void setUserAreaItemEnabled(id, enabled);
        if (id === "activity-banner") {
            void setUserAreaItemEnabled("native-activity-banner", enabled);
        }
        forceUpdate();
    };

    const handleSettingsClick = (item: UserAreaReorderItem) => {
        if (item.type === "module" && item.moduleId) {
            const mod = registeredModules.get(item.moduleId);
            if (mod?.settingsComponent) {
                const SettingsComponent = mod.settingsComponent;
                openModalLazy(async () => modalProps => (
                    <SettingsComponent onClose={modalProps.onClose} modalProps={modalProps} />
                ));
            } else if (onOpenModuleSettings) {
                onOpenModuleSettings(item.moduleId);
            }
        } else if (item.type === "account-panel" && onOpenButtonCustomizer) {
            onOpenButtonCustomizer();
        } else if ((item.id === "voice-connected" || item.type === "voice-connected") && onOpenCallBarSettings) {
            onOpenCallBarSettings();
        }
    };

    return (
        <Flex gap={16} style={{ width: "100%" }}>
            {/* ─── LEFT SIDE: LIVE PREVIEW ────────────────────────────────────────── */}
            <div
                style={{
                    width: "270px",
                    flexShrink: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                }}
            >
                <div style={{ display: "flex", alignItems: "center", marginBottom: "2px" }}>
                    <BaseText size="xs" weight="semibold" color="text-muted" style={{ textTransform: "uppercase", letterSpacing: "0.5px" }}>
                        User Area Preview
                    </BaseText>
                </div>

                <div className="panellayout-scrollbar" style={{ width: "270px", height: `${MODAL_BODY_HEIGHT}px`, overflowY: "auto", paddingRight: "4px", gap: "6px", display: "flex", flexDirection: "column" }}>
                    <div
                        className="panels__5e434 vc-user-area-preview-panel"
                        style={{
                            width: "270px",
                            backgroundColor: "var(--background-secondary-alt, #111214)",
                            border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))",
                            borderRadius: "8px",
                            display: "flex",
                            flexDirection: "column",
                            boxShadow: "0 4px 16px rgba(0, 0, 0, 0.3)",
                            overflow: "hidden",
                            maxHeight: `${MODAL_BODY_HEIGHT}px`,
                            overflowY: "auto",
                            position: "unset",
                        }}
                    >
                        {visibleItems.filter(i => i.enabled).map((item, idx, arr) => (
                            <LivePreviewBlock
                                key={item.id}
                                item={item}
                                pluginSettings={pluginSettings}
                                isLast={idx === arr.length - 1}
                            />
                        ))}

                        {visibleItems.filter(i => i.enabled).length === 0 && (
                            <div style={{ padding: "24px 12px", textAlign: "center", color: "var(--text-muted)", fontSize: "12px" }}>
                                All components are disabled. Toggle items on the right to preview them here.
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* ─── RIGHT SIDE: DRAG & DROP REORDER & TOGGLING ─────────────────────── */}
            <div
                style={{
                    flex: 1,
                    minWidth: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                }}
            >
                <Flex justifyContent="space-between" alignItems="center" style={{ marginBottom: "2px" }}>
                    <BaseText size="xs" weight="semibold" color="text-muted" style={{ textTransform: "uppercase", letterSpacing: "0.5px" }}>
                        User Area Reorder & Visibility ({visibleItems.length} items)
                    </BaseText>
                </Flex>

                <div className="panellayout-scrollbar" style={{ height: `${MODAL_BODY_HEIGHT}px`, overflowY: "auto", paddingRight: "4px", gap: "6px", display: "flex", flexDirection: "column" }}>
                    {visibleItems.map((item, index) => {
                        const isDragging = activeDragIndex === index;
                        const isOver = dragOverIndex === index && activeDragIndex !== index;

                        return (
                            <div
                                key={item.id}
                                draggable
                                onDragStart={e => handleDragStart(e, index)}
                                onDragOver={e => handleDragOver(e, index)}
                                onDragLeave={() => { if (dragOverIndex === index) setDragOverIndex(null); }}
                                onDrop={e => { e.preventDefault(); commitDrop(index); }}
                                onDragEnd={() => {
                                    dragFromIndex.current = null;
                                    setActiveDragIndex(null);
                                    setDragOverIndex(null);
                                }}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    padding: "8px 12px",
                                    borderRadius: "8px",
                                    backgroundColor: isOver
                                        ? "rgba(88, 101, 242, 0.18)"
                                        : "var(--background-secondary, rgba(255, 255, 255, 0.04))",
                                    border: isOver
                                        ? "2px solid var(--brand-experiment, #5865f2)"
                                        : "1px solid var(--background-modifier-accent, rgba(255, 255, 255, 0.06))",
                                    cursor: isDragging ? "grabbing" : "grab",
                                    opacity: isDragging ? 0.35 : item.enabled ? 1 : 0.6,
                                    transform: isDragging ? "scale(0.98)" : "none",
                                    transition: "all 0.12s ease",
                                }}
                            >
                                <Flex alignItems="center" gap={10} style={{ flex: 1, minWidth: 0 }}>
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            color: "var(--text-muted)",
                                            cursor: "grab",
                                            padding: "0 4px",
                                            opacity: 0.7,
                                        }}
                                        title="Drag to reorder"
                                    >
                                        <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor">
                                            <circle cx="4" cy="3" r="1.5" />
                                            <circle cx="8" cy="3" r="1.5" />
                                            <circle cx="4" cy="8" r="1.5" />
                                            <circle cx="8" cy="8" r="1.5" />
                                            <circle cx="4" cy="13" r="1.5" />
                                            <circle cx="8" cy="13" r="1.5" />
                                        </svg>
                                    </div>

                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            width: "28px",
                                            height: "28px",
                                            borderRadius: "6px",
                                            backgroundColor: item.type.startsWith("voice")
                                                ? "rgba(35, 165, 90, 0.15)"
                                                : item.type === "account-panel"
                                                    ? "rgba(88, 101, 242, 0.15)"
                                                    : "var(--background-modifier-accent, rgba(255, 255, 255, 0.08))",
                                            color: item.type.startsWith("voice")
                                                ? "var(--status-positive, #23a55a)"
                                                : item.type === "account-panel"
                                                    ? "var(--brand-experiment, #5865f2)"
                                                    : "var(--interactive-normal)",
                                            flexShrink: 0,
                                        }}
                                    >
                                        {getItemIcon(item)}
                                    </div>

                                    <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                                        <Flex alignItems="center" gap={6}>
                                            <BaseText size="sm" weight="semibold" color="text-strong">
                                                {item.name}
                                            </BaseText>
                                            {item.type !== "module" && (
                                                <span
                                                    style={{
                                                        fontSize: "9px",
                                                        fontWeight: 700,
                                                        color: "var(--text-muted)",
                                                        backgroundColor: "var(--background-tertiary, rgba(0,0,0,0.3))",
                                                        padding: "1px 5px",
                                                        borderRadius: "4px",
                                                        textTransform: "uppercase",
                                                    }}
                                                >
                                                    Discord Native
                                                </span>
                                            )}
                                        </Flex>
                                        <BaseText size="xs" color="text-muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                            {item.description}
                                        </BaseText>
                                    </div>
                                </Flex>

                                <Flex gap={4} alignItems="center" style={{ flexShrink: 0, marginLeft: "8px" }} onMouseDown={e => e.stopPropagation()}>
                                    <Flex gap={2} alignItems="center">
                                        <button
                                            type="button"
                                            onClick={e => {
                                                e.stopPropagation();
                                                moveItem(index, -1);
                                            }}
                                            disabled={index === 0}
                                            title="Move Up"
                                            style={{
                                                width: "26px",
                                                height: "26px",
                                                borderRadius: "4px",
                                                backgroundColor: "transparent",
                                                color: index === 0 ? "var(--text-muted)" : "var(--interactive-normal)",
                                                border: "none",
                                                cursor: index === 0 ? "default" : "pointer",
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                opacity: index === 0 ? 0.3 : 1,
                                                transition: "all 0.12s ease",
                                                padding: 0,
                                            }}
                                            onMouseEnter={e => {
                                                if (index !== 0) {
                                                    e.currentTarget.style.color = "var(--interactive-active)";
                                                    e.currentTarget.style.backgroundColor = "var(--background-modifier-hover, rgba(255, 255, 255, 0.08))";
                                                }
                                            }}
                                            onMouseLeave={e => {
                                                e.currentTarget.style.color = index === 0 ? "var(--text-muted)" : "var(--interactive-normal)";
                                                e.currentTarget.style.backgroundColor = "transparent";
                                            }}
                                        >
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                <polyline points="18 15 12 9 6 15" />
                                            </svg>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={e => {
                                                e.stopPropagation();
                                                moveItem(index, 1);
                                            }}
                                            disabled={index === visibleItems.length - 1}
                                            title="Move Down"
                                            style={{
                                                width: "26px",
                                                height: "26px",
                                                borderRadius: "4px",
                                                backgroundColor: "transparent",
                                                color: index === visibleItems.length - 1 ? "var(--text-muted)" : "var(--interactive-normal)",
                                                border: "none",
                                                cursor: index === visibleItems.length - 1 ? "default" : "pointer",
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                opacity: index === visibleItems.length - 1 ? 0.3 : 1,
                                                transition: "all 0.12s ease",
                                                padding: 0,
                                            }}
                                            onMouseEnter={e => {
                                                if (index !== visibleItems.length - 1) {
                                                    e.currentTarget.style.color = "var(--interactive-active)";
                                                    e.currentTarget.style.backgroundColor = "var(--background-modifier-hover, rgba(255, 255, 255, 0.08))";
                                                }
                                            }}
                                            onMouseLeave={e => {
                                                e.currentTarget.style.color = index === visibleItems.length - 1 ? "var(--text-muted)" : "var(--interactive-normal)";
                                                e.currentTarget.style.backgroundColor = "transparent";
                                            }}
                                        >
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                <polyline points="6 9 12 15 18 9" />
                                            </svg>
                                        </button>
                                    </Flex>

                                    {item.hasSettings && (
                                        <button
                                            type="button"
                                            onClick={e => {
                                                e.stopPropagation();
                                                handleSettingsClick(item);
                                            }}
                                            title={item.id === "voice-connected" || item.type === "voice-connected" ? "Configure Call Bar" : "Settings"}
                                            style={{
                                                width: "28px",
                                                height: "28px",
                                                borderRadius: "4px",
                                                backgroundColor: "transparent",
                                                color: "var(--interactive-normal)",
                                                border: "none",
                                                cursor: "pointer",
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                transition: "background-color 0.15s ease, color 0.15s ease",
                                            }}
                                            onMouseEnter={e => {
                                                e.currentTarget.style.color = "var(--interactive-active)";
                                                e.currentTarget.style.backgroundColor = "var(--background-modifier-hover, rgba(255, 255, 255, 0.08))";
                                            }}
                                            onMouseLeave={e => {
                                                e.currentTarget.style.color = "var(--interactive-normal)";
                                                e.currentTarget.style.backgroundColor = "transparent";
                                            }}
                                        >
                                            <SettingsGearIcon size={16} />
                                        </button>
                                    )}

                                    <FormSwitch
                                        title=""
                                        value={item.enabled}
                                        onChange={v => toggleItem(item.id, v)}
                                        hideBorder
                                    />
                                </Flex>
                            </div>
                        );
                    })}
                </div>
            </div>
        </Flex>
    );
}

function getItemIcon(item: UserAreaReorderItem) {
    if (item.type === "voice-connected") {
        return (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="22" />
            </svg>
        );
    }
    if (item.type === "native-activity-banner") {
        return <GamepadIcon size={16} />;
    }
    if (item.type === "account-panel") {
        return (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
            </svg>
        );
    }
    return getModuleIcon(item.moduleId || item.id, 16);
}

function PreviewMicrophoneIcon({ size = 18 }: { size?: number; }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
            <path fillRule="evenodd" clipRule="evenodd" d="M12 2a4 4 0 0 0-4 4v4a4 4 0 0 0 8 0V6a4 4 0 0 0-4-4Zm-6 8a1 1 0 0 0-2 0 8 8 0 0 0 7 7.94V20H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.06A8 8 0 0 0 20 10a1 1 0 1 0-2 0 6 6 0 0 1-12 0Z" />
        </svg>
    );
}

function PreviewHeadphonesIcon({ size = 18 }: { size?: number; }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
            <path fillRule="evenodd" clipRule="evenodd" d="M12 3a9 9 0 0 0-8.95 10h1.87a5 5 0 0 1 4.1 2.13l1.37 1.97a3.1 3.1 0 0 1-.17 3.78 2.85 2.85 0 0 1-3.55.74 11 11 0 1 1 10.66 0c-1.27.71-2.73.23-3.55-.74a3.1 3.1 0 0 1-.17-3.78l1.38-1.97a5 5 0 0 1 4.1-2.13h1.86A9 9 0 0 0 12 3Z" />
        </svg>
    );
}

function PreviewGearIcon({ size = 18 }: { size?: number; }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
            <path fillRule="evenodd" clipRule="evenodd" d="M10.56 1.1c-.46.05-.7.53-.64.98.18 1.16-.19 2.2-.98 2.53-.8.33-1.79-.15-2.49-1.1-.27-.36-.78-.52-1.14-.24-.77.59-1.45 1.27-2.04 2.04-.28.36-.12.87.24 1.14.96.7 1.43 1.7 1.1 2.49-.33.8-1.37 1.16-2.53.98-.45-.07-.93.18-.99.64a11.1 11.1 0 0 0 0 2.88c.06.46.54.7.99.64 1.16-.18 2.2.19 2.53.98.33.8-.14 1.79-1.1 2.49-.36.27-.52.78-.24 1.14.59.77 1.27 1.45 2.04 2.04.36.28.87.12 1.14-.24.7-.95 1.7-1.43 2.49-1.1.8.33 1.16 1.37.98 2.53-.07.45.18.93.64.99a11.1 11.1 0 0 0 2.88 0c.46-.06.7-.54.64-.99-.18-1.16.19-2.2.98-2.53.8-.33 1.79.14 2.49 1.1.27.36.78.52 1.14.24.77-.59 1.45-1.27 2.04-2.04.28-.36.12-.87-.24-1.14-.96-.7-1.43-1.7-1.1-2.49.33-.8 1.37-1.16 2.53-.98.45.07.93-.18.99-.64a11.1 11.1 0 0 0 0-2.88c-.06-.46-.54-.7-.99-.64-1.16.18-2.2-.19-2.53-.98-.33-.8.14-1.79 1.1-2.49.36-.27.52-.78.24-1.14a11.07 11.07 0 0 0-2.04-2.04c-.36-.28-.87-.12-1.14.24-.7.96-1.7 1.43-2.49 1.1-.8-.33-1.16-1.37-.98-2.53.07-.45-.18-.93-.64-.99a11.1 11.1 0 0 0 2.88 0ZM16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" />
        </svg>
    );
}

function LivePreviewBlock({
    item,
    pluginSettings,
    isLast,
}: {
    item: UserAreaReorderItem;
    pluginSettings?: any;
    isLast?: boolean;
}) {
    const borderBottom = isLast ? "none" : "1px solid var(--border - subtle, rgba(255, 255, 255, 0.06))";

    let content: React.ReactNode = null;
    switch (item.type) {
        case "voice-connected":
            content = <LiveVoiceConnectedPreview pluginSettings={pluginSettings} />;
            break;
        case "native-activity-banner":
            content = <LiveActivityBannerPreview />;
            break;
        case "account-panel":
            content = <LiveAccountProfilePreview pluginSettings={pluginSettings} />;
            break;
        case "module":
            content = <LiveModuleBlock item={item} />;
            break;
        default:
            return null;
    }

    return (
        <div style={{ borderBottom, width: "100%", boxSizing: "border-box" }}>
            {content}
        </div>
    );
}

function LiveActivityBannerPreview() {
    return (
        <div
            className="activityPanel__37e49 vc-actbanner-preview"
            style={{
                backgroundColor: "var(--background-secondary-alt, #1e1f22)",
                padding: "8px 12px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "10px",
                width: "100%",
                boxSizing: "border-box",
            }}
        >
            <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0, flex: 1 }}>
                <ActivityIcon
                    defaultIcon={
                        <div
                            style={{
                                width: "36px",
                                height: "36px",
                                borderRadius: "8px",
                                backgroundColor: "rgba(0, 122, 204, 0.15)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                flexShrink: 0,
                            }}
                        >
                            <VsCodeIcon size={22} />
                        </div>
                    }
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                    <ActivityInfo
                        defaultTitle={
                            <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--header-primary, #fff)" }}>
                                Visual Studio Code
                            </span>
                        }
                        defaultStatus={
                            <div style={{ fontSize: "12px", color: "var(--text-muted, #949ba4)", marginTop: "2px" }}>
                                01:19 elapsed
                            </div>
                        }
                    />
                </div>
            </div>

            <div
                style={{
                    color: "var(--interactive-normal, #b5bac1)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    flexShrink: 0,
                    width: "28px",
                    height: "28px",
                    borderRadius: "4px",
                }}
                title="Share Your Screen"
            >
                <ScreenArrowIcon width={18} height={18} size="sm" />
            </div>
        </div>
    );
}

function IdleMusicControlsPreview() {
    return (
        <div
            className="vc-panel-layout-music-controls vc-music-controls-idle"
            style={{
                backgroundColor: "var(--background-secondary-alt, #1e1f22)",
                padding: "8px 12px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "8px",
                width: "100%",
                boxSizing: "border-box",
            }}
        >
            <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                <div
                    style={{
                        width: "36px",
                        height: "36px",
                        borderRadius: "6px",
                        backgroundColor: "var(--background-modifier-hover, rgba(255, 255, 255, 0.08))",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--interactive-normal, #b5bac1)",
                        flexShrink: 0,
                    }}
                >
                    <MusicNoteIcon size={18} />
                </div>
                <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--header-primary, #fff)", lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        Music Controls
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--text-muted, #949ba4)", lineHeight: 1.2, marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        No track playing (Spotify / Tidal)
                    </div>
                </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--interactive-normal, #b5bac1)" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z" />
                </svg>
            </div>
        </div>
    );
}

function LiveModuleBlock({ item }: { item: UserAreaReorderItem; }) {
    const moduleId = item.moduleId || item.id;

    if (moduleId === "activity-banner" || moduleId === "native-activity-banner") {
        return <LiveActivityBannerPreview />;
    }

    if (moduleId === "music-controls") {
        const hasTrack = Boolean(SpotifyStore?.track);
        if (hasTrack) {
            return (
                <ErrorBoundary fallback={() => <IdleMusicControlsPreview />}>
                    <MusicControlsComponent />
                </ErrorBoundary>
            );
        }
        return <IdleMusicControlsPreview />;
    }

    const mod = registeredModules.get(moduleId);
    if (mod?.render) {
        const Component = mod.render;
        return (
            <div className="vc-panel-module-item" data-module-id={moduleId} style={{ width: "100%" }}>
                <ErrorBoundary
                    fallback={() => (
                        <div style={{ padding: "8px 12px", fontSize: "11px", color: "var(--text-danger)" }}>
                            Module "{item.name}" failed to render
                        </div>
                    )}
                >
                    <Component module={mod} />
                </ErrorBoundary>
            </div>
        );
    }

    return (
        <div
            className="vc-panel-module-item"
            data-module-id={moduleId}
            style={{
                backgroundColor: "var(--background-secondary-alt, #1e1f22)",
                padding: "8px 12px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
            }}
        >
            <CodeIcon size={14} style={{ color: "var(--brand-experiment, #5865f2)" }} />
            <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--header-primary, #f2f3f5)" }}>
                {item.name}
            </span>
        </div>
    );
}

function ActionButtonsRow({ pluginSettings }: { pluginSettings?: any; }) {
    const btnStyle = pluginSettings?.buttonStyle || "filled";
    const gap = pluginSettings?.buttonGap ?? 4;
    const size = Math.min(32, Math.max(24, pluginSettings?.buttonContainerSize ?? 28));
    const btnConfigs = pluginSettings?.buttonConfigs || getPanelLayoutPlainSettings()?.buttonConfigs || {};
    const userPanelLayout = pluginSettings?.userPanelLayout ?? "split_row";

    if (userPanelLayout === "hidden") return null;

    const getBtnShapeStyle = (cfg?: any): React.CSSProperties => {
        let radius = "6px";
        switch (btnStyle) {
            case "filled":
                radius = cfg?.radiusOff != null ? `${cfg.radiusOff}px` : "6px";
                break;
            case "outlined":
                return {
                    border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.15))",
                    borderRadius: cfg?.radiusOff != null ? `${cfg.radiusOff}px` : "6px",
                };
            case "pill":
                radius = "14px";
                break;
            case "square":
                radius = "2px";
                break;
            default:
                radius = "6px";
                break;
        }

        let bg = "var(--custom-nameplate-neutral, var(--background-modifier-hover, rgba(255, 255, 255, 0.08)))";
        if (cfg?.colorfulInActiveButton && cfg?.colorOff) {
            const alpha = Math.round(((cfg.opacityOff ?? 22) / 100) * 255).toString(16).padStart(2, "0");
            bg = `${cfg.colorOff.slice(0, 7)}${alpha}`;
        }

        return { backgroundColor: bg, borderRadius: radius };
    };

    const isNativeButton = (label: string) =>
        label === "Mute" || label === "Deafen" || label === "User Settings";

    const isAllTop = userPanelLayout === "all_top";

    // Detect actual buttons using the exact same method from the Buttons tab
    const detected = getBtnItems(id => btnConfigs[id]?.order ?? 0);

    const visibleButtons = detected.filter(btn => {
        const cfg = btnConfigs[btn.id] || btnConfigs[btn.label];
        if (cfg?.hidden) return false;

        if (btn.label === "Mute" && pluginSettings?.hideMute) return false;
        if (btn.label === "Deafen" && pluginSettings?.hideDeafen) return false;
        if (btn.label === "User Settings" && pluginSettings?.hideSettings) return false;
        if (btn.label === "Camera" && pluginSettings?.hideCamera) return false;
        if (btn.label === "Screen Share" && pluginSettings?.hideScreenShare) return false;
        if (btn.label === "Activity" && pluginSettings?.hideActivity) return false;

        // In layouts where native buttons remain in the bottom profile bar, exclude them here to prevent duplicate icons
        if (!isAllTop && isNativeButton(btn.label)) {
            return false;
        }

        return true;
    });

    if (visibleButtons.length === 0) return null;

    const isGrid2 = userPanelLayout === "split_grid2" || userPanelLayout === "grid2";
    const isGrid3 = userPanelLayout === "split_grid3" || userPanelLayout === "grid3";
    const isGrid4 = userPanelLayout === "split_grid4";

    let flexItemStyle: React.CSSProperties = { flex: "1 1 0px", minWidth: 0, height: `${size}px` };
    if (isGrid2) flexItemStyle = { flex: `0 0 calc(50% - (${gap}px / 2))`, height: `${size}px` };
    else if (isGrid3) flexItemStyle = { flex: `0 0 calc(33.333% - (${gap}px * 2 / 3))`, height: `${size}px` };
    else if (isGrid4) flexItemStyle = { flex: `0 0 calc(25% - (${gap}px * 3 / 4))`, height: `${size}px` };

    return (
        <div
            style={{
                display: "flex",
                flexWrap: isGrid2 || isGrid3 || isGrid4 ? "wrap" : "nowrap",
                alignItems: "center",
                gap: `${gap}px`,
                padding: "6px 8px 4px 8px",
                width: "100%",
                boxSizing: "border-box",
                overflow: "hidden",
            }}
        >
            {visibleButtons.map(btn => {
                const cfg = btnConfigs[btn.id] || btnConfigs[btn.label];
                const isMute = btn.label === "Mute";
                const isDeafen = btn.label === "Deafen";

                return (
                    <div
                        key={btn.id}
                        title={btn.label}
                        style={{
                            height: `${size}px`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: btn.id === "Game Activity" ? "var(--status-danger, #ed4245)" : "var(--interactive-normal, #b5bac1)",
                            cursor: "pointer",
                            ...flexItemStyle,
                            ...getBtnShapeStyle(cfg),
                        }}
                    >
                        {isMute ? (
                            <span dangerouslySetInnerHTML={{ __html: svgs.muteOff }} style={{ display: "flex", alignItems: "center", justifyContent: "center" }} />
                        ) : isDeafen ? (
                            <span dangerouslySetInnerHTML={{ __html: svgs.deafenOff }} style={{ display: "flex", alignItems: "center", justifyContent: "center" }} />
                        ) : (
                            <span
                                className="panellayout-btn-preview"
                                dangerouslySetInnerHTML={{ __html: btn.iconHTML }}
                                style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
                            />
                        )}
                    </div>
                );
            })}
        </div>
    );
}

function getActiveNameplate(user: any): { src?: string; bg?: string; neutral?: string; neutralHovered?: string; } | null {
    try {

        const realPanels = document.querySelectorAll(
            'section[class*="panels_"]:not(.vc-panels-preview), .panels__5e434:not(.vc-panels-preview), [class*="sidebar_"] [class*="panels_"]'
        );

        for (const p of Array.from(realPanels)) {
            const img = p.querySelector<HTMLImageElement>(
                '.container_df39b2 img, [class*="container_df39b2"] img, [class*="nameplate"] img, img[src*="collectibles"], img[src*="nameplate"]'
            );
            if (img?.src) {
                const parent = img.closest('.container_df39b2, [class*="container_df39b2"], .container__37e49') || img.parentElement;
                const computed = parent ? window.getComputedStyle(parent) : null;
                return {
                    src: img.src,
                    neutral: computed?.getPropertyValue("--custom-nameplate-neutral").trim() || undefined,
                    neutralHovered: computed?.getPropertyValue("--custom-nameplate-neutral-hovered").trim() || undefined,
                };
            }

            const nameplateContainer = p.querySelector<HTMLElement>('.container_df39b2, [class*="container_df39b2"], [class*="nameplate"]');
            if (nameplateContainer) {
                const computed = window.getComputedStyle(nameplateContainer);
                const bg = computed.backgroundImage;
                if (bg && bg !== "none") {
                    return {
                        bg,
                        neutral: computed.getPropertyValue("--custom-nameplate-neutral").trim() || undefined,
                        neutralHovered: computed.getPropertyValue("--custom-nameplate-neutral-hovered").trim() || undefined,
                    };
                }
            }

            const userArea = p.querySelector<HTMLElement>('.container__37e49, [class*="container__37e49"]');
            if (userArea) {
                const computed = window.getComputedStyle(userArea);
                const bg = computed.backgroundImage;
                const neutral = computed.getPropertyValue("--custom-nameplate-neutral").trim();
                if (bg && bg !== "none") {
                    return {
                        bg,
                        neutral: neutral || undefined,
                        neutralHovered: computed.getPropertyValue("--custom-nameplate-neutral-hovered").trim() || undefined,
                    };
                }
            }
        }

        // Also check document-wide for any active user area nameplate img
        const anyNameplateImg = document.querySelector<HTMLImageElement>(
            '.container_df39b2 img, [class*="container_df39b2"] img, .container__37e49 [class*="nameplate"] img'
        );
        if (anyNameplateImg?.src) {
            return { src: anyNameplateImg.src };
        }

        if (user) {
            const userAny = user as any;
            const np = userAny.collectibles?.nameplate || userAny.nameplate;
            const profile = UserProfileStore?.getUserProfile?.(user.id) as any;
            const profNp = profile?.collectibles?.nameplate || profile?.nameplate;
            const targetNp = np || profNp;

            if (targetNp) {
                if (targetNp.asset) {
                    return { src: `https://cdn.discordapp.com/media/v1/collectibles-shop/${targetNp.asset}/static` };
                }
                if (targetNp.src) {
                    return { src: targetNp.src };
                }
                if (typeof targetNp === "string") {
                    return {
                        src: targetNp.startsWith("http")
                            ? targetNp
                            : `https://cdn.discordapp.com/media/v1/collectibles-shop/${targetNp}/static`
                    };
                }
            }
        }

        const plugins = (Settings?.plugins || {}) as any;
        const fup = (plugins.fakeUserProfile || {}) as any;
        if (fup.manualNameplateAsset) {
            return { src: `https://cdn.discordapp.com/media/v1/collectibles-shop/${fup.manualNameplateAsset}/static` };
        }
        const fp = (plugins.FakeProfile || {}) as any;
        if (fp.nameplateAsset) {
            return { src: `https://cdn.discordapp.com/media/v1/collectibles-shop/${fp.nameplateAsset}/static` };
        }
    } catch { }
    return null;
}

function LiveAccountProfilePreview({ pluginSettings }: { pluginSettings?: any; }) {
    const user = useStateFromStores([UserStore], () => UserStore?.getCurrentUser?.());
    const username = user?.username || "User";
    const displayName = user?.globalName || username;
    const avatarUrl = user?.getAvatarURL?.(null, 40) || "";
    const hideChevrons = Boolean(pluginSettings?.hideChevrons);
    const hideLine = Boolean(pluginSettings?.hideLine);
    const isAllTop = pluginSettings?.userPanelLayout === "all_top";

    const [nameplate, setNameplate] = useState(() => getActiveNameplate(user));

    useEffect(() => {
        const update = () => {
            const np = getActiveNameplate(user);
            if (np) setNameplate(np);
        };
        update();
        const t1 = setTimeout(update, 100);
        const t2 = setTimeout(update, 400);
        return () => {
            clearTimeout(t1);
            clearTimeout(t2);
        };
    }, [user]);

    const status = useStateFromStores(
        [PresenceStore].filter(Boolean),
        () => (user ? PresenceStore?.getStatus?.(user.id) : "online")
    ) || "online";

    const statusColors: Record<string, string> = {
        online: "var(--status-positive, #23a55a)",
        idle: "var(--status-warning, #f0b232)",
        dnd: "var(--status-danger, #f23f43)",
        invisible: "var(--status-offline, #80848e)",
        offline: "var(--status-offline, #80848e)",
    };
    const statusDotColor = statusColors[status] || statusColors.online;

    return (
        <div
            className="container__37e49 vc-account-profile-preview"
            style={{
                position: "relative",
                backgroundColor: "var(--background-secondary-alt, #1e1f22)",
                display: "flex",
                flexDirection: "column",
                width: "100%",
                boxSizing: "border-box",
                borderRadius: "8px",
                overflow: "hidden",
                ...(nameplate?.neutral ? { "--custom-nameplate-neutral": nameplate.neutral } as any : {}),
                ...(nameplate?.neutralHovered ? { "--custom-nameplate-neutral-hovered": nameplate.neutralHovered } as any : {}),
            }}
        >
            {nameplate && (
                <div
                    className="container_df39b2 vc-preview-nameplate"
                    style={{
                        position: "absolute",
                        inset: 0,
                        overflow: "hidden",
                        pointerEvents: "none",
                        zIndex: 0,
                    }}
                >
                    {nameplate.src ? (
                        <img
                            src={nameplate.src}
                            alt="Nameplate"
                            style={{
                                width: "100%",
                                height: "100%",
                                objectFit: "cover",
                                objectPosition: "center",
                                display: "block",
                            }}
                        />
                    ) : nameplate.bg ? (
                        <div
                            style={{
                                width: "100%",
                                height: "100%",
                                backgroundImage: nameplate.bg,
                                backgroundSize: "cover",
                                backgroundPosition: "center",
                            }}
                        />
                    ) : null}
                    <div
                        style={{
                            position: "absolute",
                            inset: 0,
                            backgroundColor: "rgba(0, 0, 0, 0.25)",
                        }}
                    />
                </div>
            )}

            <div style={{ position: "relative", zIndex: 1, width: "100%" }}>
                <ActionButtonsRow pluginSettings={pluginSettings} />
            </div>

            {!hideLine && (
                <div
                    style={{
                        position: "relative",
                        zIndex: 1,
                        width: "calc(100% - 16px)",
                        height: "1px",
                        backgroundColor: "var(--border-subtle, rgba(255, 255, 255, 0.06))",
                        margin: "2px 8px",
                    }}
                />
            )}

            <div
                style={{
                    position: "relative",
                    zIndex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "6px 8px",
                    width: "100%",
                    boxSizing: "border-box",
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0, flex: 1 }}>
                    <div style={{ position: "relative", width: "32px", height: "32px", flexShrink: 0 }}>
                        {avatarUrl ? (
                            <img
                                src={avatarUrl}
                                alt="Avatar"
                                style={{ width: "32px", height: "32px", borderRadius: "50%", objectFit: "cover" }}
                            />
                        ) : (
                            <div style={{ width: "32px", height: "32px", borderRadius: "50%", backgroundColor: "var(--brand-experiment, #5865f2)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: "12px" }}>
                                {username.slice(0, 1).toUpperCase()}
                            </div>
                        )}
                        <div
                            style={{
                                position: "absolute",
                                bottom: "-1px",
                                right: "-1px",
                                width: "9px",
                                height: "9px",
                                borderRadius: "50%",
                                backgroundColor: statusDotColor,
                                border: "2px solid var(--background-secondary-alt, #1e1f22)",
                            }}
                        />
                    </div>

                    <div style={{ minWidth: 0, overflow: "hidden" }}>
                        <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--header-primary, #fff)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.2 }}>
                            {displayName}
                        </div>
                        <div style={{ fontSize: "12px", color: "var(--text-muted, #949ba4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textTransform: "capitalize" }}>
                            {status}
                        </div>
                    </div>
                </div>

                {!isAllTop && (
                    <div style={{ display: "flex", alignItems: "center", gap: "2px", flexShrink: 0 }}>
                        {!pluginSettings?.hideMute && (
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    padding: "4px",
                                    borderRadius: "4px",
                                    cursor: "pointer",
                                    color: "var(--interactive-normal, #b5bac1)",
                                }}
                                title="Mute"
                            >
                                <PreviewMicrophoneIcon size={18} />
                                {!hideChevrons && <ChevronDownIcon size={10} style={{ marginLeft: "1px" }} />}
                            </div>
                        )}

                        {!pluginSettings?.hideDeafen && (
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    padding: "4px",
                                    borderRadius: "4px",
                                    cursor: "pointer",
                                    color: "var(--interactive-normal, #b5bac1)",
                                }}
                                title="Deafen"
                            >
                                <PreviewHeadphonesIcon size={18} />
                                {!hideChevrons && <ChevronDownIcon size={10} style={{ marginLeft: "1px" }} />}
                            </div>
                        )}

                        {!pluginSettings?.hideSettings && (
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    padding: "4px",
                                    borderRadius: "4px",
                                    cursor: "pointer",
                                    color: "var(--interactive-normal, #b5bac1)",
                                }}
                                title="User Settings"
                            >
                                <PreviewGearIcon size={18} />
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

function LiveVoiceConnectedPreview({ pluginSettings }: { pluginSettings?: any; }) {
    const isConnected = useStateFromStores(
        [RTCConnectionStore].filter(Boolean),
        () => RTCConnectionStore?.isConnected?.()
    );
    const channelId = useStateFromStores(
        [RTCConnectionStore].filter(Boolean),
        () => RTCConnectionStore?.getChannelId?.()
    );
    const channel = useStateFromStores(
        [ChannelStore].filter(Boolean),
        () => (channelId ? ChannelStore?.getChannel?.(channelId) : null)
    );
    const livePing = useStateFromStores(
        [RTCConnectionStore].filter(Boolean),
        () => RTCConnectionStore?.getLastPing?.() ?? 0
    );

    const hideStatus = Boolean(pluginSettings?.hideVoiceStatus);
    const hidePing = Boolean(pluginSettings?.hidePingIcon);
    const hideDisconnect = Boolean(pluginSettings?.hideDisconnect);
    const compact = Boolean(pluginSettings?.callCompact);
    const callLayout = pluginSettings?.callControlsLayout ?? "default";

    const channelName = isConnected && channel?.name ? channel.name : "General / Lounge";
    const pingText = `${livePing > 0 ? livePing : 18}ms`;

    const isGrid = callLayout === "grid2";
    const isVertical = callLayout === "vertical";

    return (
        <div
            className="container_e131a9 vc-call-bar-preview"
            style={{
                backgroundColor: "var(--background-secondary, #2b2d31)",
                padding: compact ? "6px 8px" : "8px 10px",
                display: "flex",
                flexDirection: "column",
                gap: compact ? "6px" : "8px",
                width: "100%",
                boxSizing: "border-box",
            }}
        >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                {!hideStatus ? (
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                        <span style={{ color: "var(--status-positive, #23a55a)", display: "flex", flexShrink: 0 }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M5 12.55a11 11 0 0 1 14.08 0" />
                                <path d="M1.42 9a16 16 0 0 1 21.16 0" />
                                <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
                                <line x1="12" y1="20" x2="12.01" y2="20" strokeWidth="3" />
                            </svg>
                        </span>
                        <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--status-positive, #23a55a)", lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {isConnected ? "Voice Connected" : "Voice Connected"}
                            </div>
                            <div style={{ fontSize: "11px", color: "var(--text-muted, #949ba4)", lineHeight: 1.2, marginTop: "2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {channelName}
                            </div>
                        </div>
                    </div>
                ) : <div />}

                <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                    {!hidePing && (
                        <div
                            style={{
                                fontSize: "10px",
                                fontWeight: 600,
                                color: "var(--status-positive, #23a55a)",
                                backgroundColor: "rgba(35, 165, 90, 0.12)",
                                padding: "2px 6px",
                                borderRadius: "4px",
                            }}
                        >
                            {pingText}
                        </div>
                    )}
                    {!hideDisconnect && (
                        <div
                            style={{
                                width: "24px",
                                height: "24px",
                                borderRadius: "4px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                color: "var(--status-danger, #f23f43)",
                                backgroundColor: "rgba(242, 63, 67, 0.1)",
                                cursor: "pointer",
                            }}
                            title="Disconnect"
                        >
                            <PhoneHangUpIcon width={16} height={16} size="xs" />
                        </div>
                    )}
                </div>
            </div>

            {callLayout !== "hidden" && (
                <div
                    style={{
                        display: "flex",
                        flexDirection: isVertical ? "column" : "row",
                        flexWrap: isGrid ? "wrap" : "nowrap",
                        gap: "8px",
                    }}
                >
                    {!pluginSettings?.hideCamera && (
                        <div
                            style={{
                                flex: isGrid ? "0 0 calc(50% - 4px)" : 1,
                                backgroundColor: "var(--background-primary, #1e1f22)",
                                border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.06))",
                                borderRadius: "4px",
                                height: compact ? "26px" : "30px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: "6px",
                                fontSize: "12px",
                                fontWeight: 500,
                                color: "var(--interactive-normal, #b5bac1)",
                                cursor: "pointer",
                            }}
                        >
                            <VideoIcon width={16} height={16} size="xs" />
                            <span>Video</span>
                        </div>
                    )}
                    {!pluginSettings?.hideScreenShare && (
                        <div
                            style={{
                                flex: isGrid ? "0 0 calc(50% - 4px)" : 1,
                                backgroundColor: "var(--background-primary, #1e1f22)",
                                border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.06))",
                                borderRadius: "4px",
                                height: compact ? "26px" : "30px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: "6px",
                                fontSize: "12px",
                                fontWeight: 500,
                                color: "var(--interactive-normal, #b5bac1)",
                                cursor: "pointer",
                            }}
                        >
                            <ScreenArrowIcon width={16} height={16} size="xs" />
                            <span>Share</span>
                        </div>
                    )}
                    {isGrid && !pluginSettings?.hideActivity && (
                        <div
                            style={{
                                flex: "0 0 calc(50% - 4px)",
                                backgroundColor: "var(--background-primary, #1e1f22)",
                                border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.06))",
                                borderRadius: "4px",
                                height: compact ? "26px" : "30px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: "6px",
                                fontSize: "12px",
                                fontWeight: 500,
                                color: "var(--interactive-normal, #b5bac1)",
                                cursor: "pointer",
                            }}
                        >
                            <AppsIcon width={16} height={16} size="xs" />
                            <span>Activities</span>
                        </div>
                    )}
                    {isGrid && (
                        <div
                            style={{
                                flex: "0 0 calc(50% - 4px)",
                                backgroundColor: "var(--background-primary, #1e1f22)",
                                border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.06))",
                                borderRadius: "4px",
                                height: compact ? "26px" : "30px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: "6px",
                                fontSize: "12px",
                                fontWeight: 500,
                                color: "var(--interactive-normal, #b5bac1)",
                                cursor: "pointer",
                            }}
                        >
                            <SoundboardIcon width={16} height={16} size="xs" />
                            <span>Soundboard</span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
