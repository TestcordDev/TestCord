/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BaseText } from "@components/BaseText";
import { Button } from "@components/Button";
import { Flex } from "@components/Flex";
import { FormSwitch } from "@components/FormSwitch";
import { openModalLazy, React, useEffect, useReducer, useRef, UserStore, useState } from "@webpack/common";

import {
    ActivityPulseIcon,
    ClockIcon,
    CodeIcon,
    GamepadIcon,
    getModuleIcon,
    MusicNoteIcon,
    SettingsGearIcon,
    TerminalIcon,
} from "../icons";
import {
    getUserAreaOrder,
    registeredModules,
    setUserAreaItemEnabled,
    setUserAreaOrder,
    useModules,
} from "../registry";
import type { UserAreaReorderItem } from "../types";

export function UserAreaReorderTab({
    pluginSettings,
    onOpenModuleSettings,
    onOpenButtonCustomizer,
}: {
    pluginSettings?: any;
    onOpenModuleSettings?: (moduleId: string) => void;
    onOpenButtonCustomizer?: () => void;
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

    const commitDrop = (targetIndex: number) => {
        const fromIndex = dragFromIndex.current;
        if (fromIndex !== null && fromIndex !== targetIndex) {
            const next = [...visibleItems];
            const [moved] = next.splice(fromIndex, 1);
            next.splice(targetIndex, 0, moved);
            const updatedVisible = next.map((it, idx) => ({ ...it, order: idx }));
            const updatedAll = items.map(it => {
                const found = updatedVisible.find(v => v.id === it.id);
                if (found) return found;
                if (it.id === "native-activity-banner") {
                    const act = updatedVisible.find(v => v.id === "activity-banner");
                    if (act) return { ...it, order: act.order };
                }
                return it;
            });
            setItems(updatedAll);
            void setUserAreaOrder(updatedAll);
            forceUpdate();
        }
        dragFromIndex.current = null;
        setActiveDragIndex(null);
        setDragOverIndex(null);
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
        }
    };

    return (
        <Flex gap={16} style={{ width: "100%", height: "100%", minHeight: "380px" }}>
            {/* ─── LEFT SIDE: LIVE PREVIEW ────────────────────────────────────────── */}
            <div
                style={{
                    width: "250px",
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

                <div
                    style={{
                        backgroundColor: "var(--background-secondary-alt, #1e1f22)",
                        border: "1px solid var(--background-modifier-accent, rgba(255, 255, 255, 0.08))",
                        borderRadius: "12px",
                        padding: "8px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                        boxShadow: "0 4px 16px rgba(0, 0, 0, 0.25)",
                        overflowY: "auto",
                        maxHeight: "370px",
                    }}
                >
                    {items.filter(i => i.enabled).map(item => (
                        <LivePreviewBlock
                            key={item.id}
                            item={item}
                            pluginSettings={pluginSettings}
                        />
                    ))}

                    {items.filter(i => i.enabled).length === 0 && (
                        <div style={{ padding: "24px 12px", textAlign: "center", color: "var(--text-muted)", fontSize: "12px" }}>
                            All components are disabled. Toggle items on the right to preview them here.
                        </div>
                    )}
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
                        User Area Reorder & Visibility ({items.length} items)
                    </BaseText>
                </Flex>

                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                        overflowY: "auto",
                        maxHeight: "370px",
                        paddingRight: "4px",
                    }}
                >
                    {items.map((item, index) => {
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
                                        ? "rgba(88, 101, 242, 0.15)"
                                        : "var(--background-secondary, rgba(255, 255, 255, 0.04))",
                                    border: isOver
                                        ? "1px solid var(--brand-experiment, #5865f2)"
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

                                <Flex alignItems="center" gap={8} style={{ flexShrink: 0, marginLeft: "10px" }}>
                                    {item.hasSettings && (
                                        <Button
                                            size="small"
                                            variant="secondary"
                                            title="Settings"
                                            onClick={e => {
                                                e.stopPropagation();
                                                handleSettingsClick(item);
                                            }}
                                            style={{ padding: "4px 8px", display: "flex", alignItems: "center", justifyContent: "center" }}
                                        >
                                            <SettingsGearIcon size={13} />
                                        </Button>
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

// ─── LIVE PREVIEW BLOCKS ───────────────────────────────────────────────────────

function LivePreviewBlock({ item, pluginSettings }: { item: UserAreaReorderItem; pluginSettings?: any; }) {
    switch (item.type) {
        case "voice-connected":
            return <VoiceConnectedPreview />;
        case "native-activity-banner":
            return <NativeActivityPreview />;
        case "account-panel":
            return <AccountProfilePreview pluginSettings={pluginSettings} />;
        case "module":
            return <ModulePreview moduleId={item.moduleId || item.id} name={item.name} />;
        default:
            return null;
    }
}

function VoiceConnectedPreview() {
    return (
        <div
            style={{
                backgroundColor: "var(--background-tertiary, #111214)",
                borderRadius: "8px",
                padding: "8px 10px",
                border: "1px solid rgba(35, 165, 90, 0.3)",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
            }}
        >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ color: "var(--status-positive, #23a55a)", display: "flex" }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M5 12.55a11 11 0 0 1 14.08 0" />
                            <path d="M1.42 9a16 16 0 0 1 21.16 0" />
                            <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
                            <line x1="12" y1="20" x2="12.01" y2="20" strokeWidth="3" />
                        </svg>
                    </span>
                    <div>
                        <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--status-positive, #23a55a)", lineHeight: 1 }}>
                            Voice Connected
                        </div>
                        <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "2px" }}>
                            General / Lounge
                        </div>
                    </div>
                </div>

                <div
                    style={{
                        fontSize: "9px",
                        fontWeight: 600,
                        color: "var(--status-positive, #23a55a)",
                        backgroundColor: "rgba(35, 165, 90, 0.15)",
                        padding: "1px 5px",
                        borderRadius: "4px",
                    }}
                >
                    18ms
                </div>
            </div>

            <div style={{ display: "flex", gap: "4px", marginTop: "2px" }}>
                <div style={{ flex: 1, backgroundColor: "var(--background-secondary, rgba(255,255,255,0.06))", borderRadius: "4px", height: "22px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", color: "var(--interactive-normal)" }}>
                    📹 Video
                </div>
                <div style={{ flex: 1, backgroundColor: "var(--background-secondary, rgba(255,255,255,0.06))", borderRadius: "4px", height: "22px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", color: "var(--interactive-normal)" }}>
                    🖥️ Share
                </div>
                <div style={{ width: "26px", height: "22px", backgroundColor: "rgba(237, 66, 69, 0.2)", borderRadius: "4px", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--status-danger, #ed4245)", fontSize: "10px" }}>
                    📞
                </div>
            </div>
        </div>
    );
}

function NativeActivityPreview() {
    return (
        <div
            style={{
                backgroundColor: "var(--background-tertiary, #111214)",
                borderRadius: "8px",
                padding: "8px 10px",
                border: "1px solid var(--background-modifier-accent, rgba(255, 255, 255, 0.05))",
                display: "flex",
                alignItems: "center",
                gap: "8px",
            }}
        >
            <div
                style={{
                    width: "28px",
                    height: "28px",
                    borderRadius: "6px",
                    backgroundColor: "rgba(88, 101, 242, 0.2)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--brand-experiment, #5865f2)",
                    flexShrink: 0,
                }}
            >
                <GamepadIcon size={16} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "10px", fontWeight: 700, color: "var(--header-primary, #fff)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    Playing Visual Studio Code
                </div>
                <div style={{ fontSize: "9px", color: "var(--text-muted)", marginTop: "1px" }}>
                    Developing TestCord • 01:24:12
                </div>
            </div>
        </div>
    );
}

function AccountProfilePreview({ pluginSettings }: { pluginSettings?: any; }) {
    const user = UserStore?.getCurrentUser?.();
    const username = user?.username || "User";
    const displayName = user?.globalName || username;
    const avatarUrl = user?.getAvatarURL?.(null, 40) || "";

    const btnStyle = pluginSettings?.buttonStyle || "default";
    const gap = pluginSettings?.buttonGap ?? 4;
    const size = Math.min(26, pluginSettings?.buttonContainerSize ?? 24);

    const getBtnShapeStyle = (): React.CSSProperties => {
        switch (btnStyle) {
            case "filled":
                return { backgroundColor: "var(--background-modifier-accent, rgba(255, 255, 255, 0.08))", borderRadius: "6px" };
            case "outlined":
                return { border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.15))", borderRadius: "6px" };
            case "pill":
                return { backgroundColor: "var(--background-modifier-accent, rgba(255, 255, 255, 0.08))", borderRadius: "12px" };
            case "square":
                return { backgroundColor: "var(--background-modifier-accent, rgba(255, 255, 255, 0.08))", borderRadius: "2px" };
            default:
                return {};
        }
    };

    return (
        <div
            style={{
                backgroundColor: "var(--background-tertiary, #111214)",
                borderRadius: "8px",
                padding: "8px",
                border: "1px solid var(--background-modifier-accent, rgba(255, 255, 255, 0.08))",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "8px",
            }}
        >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
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
                    <div style={{ position: "absolute", bottom: "-1px", right: "-1px", width: "9px", height: "9px", borderRadius: "50%", backgroundColor: "var(--status-positive, #23a55a)", border: "2px solid var(--background-secondary-alt, #1e1f22)" }} />
                </div>

                <div style={{ minWidth: 0, overflow: "hidden" }}>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--header-primary, #fff)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.2 }}>
                        {displayName}
                    </div>
                    <div style={{ fontSize: "9px", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        Online
                    </div>
                </div>
            </div>

            {/* Buttons Row */}
            <div style={{ display: "flex", alignItems: "center", gap: `${gap}px`, flexShrink: 0 }}>
                {["🎤", "🎧", "⚙️"].map((icon, i) => (
                    <div
                        key={i}
                        style={{
                            width: `${size}px`,
                            height: `${size}px`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "11px",
                            cursor: "pointer",
                            userSelect: "none",
                            ...getBtnShapeStyle(),
                        }}
                    >
                        {icon}
                    </div>
                ))}
            </div>
        </div>
    );
}

function ModulePreview({ moduleId, name }: { moduleId: string; name: string; }) {
    if (moduleId === "music-controls") {
        return (
            <div
                style={{
                    backgroundColor: "var(--background-tertiary, #111214)",
                    borderRadius: "8px",
                    padding: "8px",
                    border: "1px solid rgba(29, 185, 84, 0.25)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div style={{ width: "30px", height: "30px", borderRadius: "4px", backgroundColor: "#1db954", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", flexShrink: 0 }}>
                        <MusicNoteIcon size={16} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "10px", fontWeight: 700, color: "var(--header-primary, #fff)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            Starboy
                        </div>
                        <div style={{ fontSize: "9px", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            The Weeknd • Daft Punk
                        </div>
                    </div>
                </div>

                <div style={{ width: "100%", height: "3px", backgroundColor: "rgba(255,255,255,0.1)", borderRadius: "2px", overflow: "hidden" }}>
                    <div style={{ width: "45%", height: "100%", backgroundColor: "#1db954" }} />
                </div>
            </div>
        );
    }

    if (moduleId === "clock-widget") {
        return (
            <div
                style={{
                    backgroundColor: "var(--background-tertiary, #111214)",
                    borderRadius: "8px",
                    padding: "6px 10px",
                    border: "1px solid var(--background-modifier-accent, rgba(255, 255, 255, 0.06))",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <ClockIcon size={14} style={{ color: "var(--brand-experiment, #5865f2)" }} />
                    <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--header-primary, #fff)", fontFamily: "monospace" }}>
                        16:52:09
                    </span>
                </div>
                <span style={{ fontSize: "9px", color: "var(--text-muted)", backgroundColor: "var(--background-secondary, rgba(255,255,255,0.06))", padding: "1px 5px", borderRadius: "3px" }}>
                    Monday, Sep 7
                </span>
            </div>
        );
    }

    if (moduleId === "system-monitor") {
        return (
            <div
                style={{
                    backgroundColor: "var(--background-tertiary, #111214)",
                    borderRadius: "8px",
                    padding: "6px 10px",
                    border: "1px solid var(--background-modifier-accent, rgba(255, 255, 255, 0.06))",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <ActivityPulseIcon size={14} style={{ color: "var(--status-positive, #23a55a)" }} />
                    <span style={{ fontSize: "10px", fontWeight: 600, color: "var(--header-primary, #fff)" }}>
                        Ping: 24ms
                    </span>
                </div>
                <span style={{ fontSize: "9px", color: "var(--text-muted)" }}>
                    RAM: 142 MB
                </span>
            </div>
        );
    }

    if (moduleId === "dev-banner") {
        return (
            <div
                style={{
                    backgroundColor: "var(--background-tertiary, #111214)",
                    borderRadius: "8px",
                    padding: "6px 10px",
                    border: "1px solid rgba(88, 101, 242, 0.2)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <TerminalIcon size={14} style={{ color: "var(--brand-experiment, #5865f2)" }} />
                    <span style={{ fontSize: "10px", fontWeight: 600, color: "var(--header-primary, #fff)" }}>
                        TestCord Dev
                    </span>
                </div>
                <span style={{ fontSize: "9px", color: "var(--brand-experiment, #5865f2)", fontFamily: "monospace" }}>
                    #34281 (Release)
                </span>
            </div>
        );
    }

    return (
        <div
            style={{
                backgroundColor: "var(--background-tertiary, #111214)",
                borderRadius: "8px",
                padding: "6px 10px",
                border: "1px solid var(--background-modifier-accent, rgba(255, 255, 255, 0.06))",
                display: "flex",
                alignItems: "center",
                gap: "6px",
            }}
        >
            <CodeIcon size={14} style={{ color: "var(--brand-experiment, #5865f2)" }} />
            <span style={{ fontSize: "10px", fontWeight: 600, color: "var(--header-primary, #fff)" }}>
                {name}
            </span>
        </div>
    );
}
