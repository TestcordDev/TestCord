/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { createStore, del, entries, get, set } from "@api/DataStore";
import { ChannelToolbarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { TestcordDevs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import definePlugin, { OptionType, type PluginSettingComponentProps } from "@utils/types";
import { ChannelStore, Clickable, GuildStore, ReactDOM, SelectedChannelStore, SelectedGuildStore, ThemeStore, useEffect, useRef, useState, useStateFromStores } from "@webpack/common";
import type { CSSProperties, PointerEvent as ReactPointerEvent, SVGProps } from "react";

const NotesStore = createStore("FloatingNotes", "notes");
const notesCache = new Map<string, string>();
const cl = classNameFactory("vc-floatingnotes-");

export const settings = definePluginSettings({
    guildNotesPerServer: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Use one shared note per server instead of a separate note per channel. DMs always keep one note per conversation.",
    },
    windowWidth: {
        type: OptionType.SLIDER,
        markers: [200, 260, 320, 400],
        stickToMarkers: false,
        default: 260,
        description: "Note window width.",
    },
    windowHeight: {
        type: OptionType.SLIDER,
        markers: [200, 260, 320, 400],
        stickToMarkers: false,
        default: 260,
        description: "Note window height.",
    },
    appearance: {
        type: OptionType.SELECT,
        description: "Background style of the floating window.",
        options: [
            { label: "Solid", value: "solid", default: true },
            { label: "Liquid Glass", value: "glass" },
            { label: "Blur", value: "blur" },
            { label: "Neon", value: "neon" },
            { label: "Custom Color", value: "custom" },
        ],
    },
    customColor: {
        type: OptionType.COMPONENT,
        description: "Custom background color. Only used when appearance is Custom Color.",
        default: "#2b2d31",
        hidden: () => settings.store.appearance !== "custom",
        component: CustomColorEditor,
    },
    neonColor: {
        type: OptionType.COMPONENT,
        description: "Neon glow color. Only used when appearance is Neon.",
        default: "#ff6a00",
        hidden: () => settings.store.appearance !== "neon",
        component: NeonColorEditor,
    },
    resizable: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Show a resize handle in the bottom right corner to resize the window with the mouse. The size is saved.",
    },
    barPosition: {
        type: OptionType.SELECT,
        description: "Which side of the window the drag bar sits on.",
        options: [
            { label: "Left", value: "left", default: true },
            { label: "Top", value: "top" },
            { label: "Right", value: "right" },
            { label: "Bottom", value: "bottom" },
        ],
    },
    resetPosition: {
        type: OptionType.COMPONENT,
        description: "Reset the floating window position and size back to the defaults.",
        component: () => (
            <Button
                onClick={() => {
                    settings.store.posX = null;
                    settings.store.posY = null;
                    settings.store.sizeW = null;
                    settings.store.sizeH = null;
                }}
            >
                Reset window position and size
            </Button>
        ),
    },
}).withPrivateSettings<{
    posX: number | null;
    posY: number | null;
    sizeW: number | null;
    sizeH: number | null;
    open: boolean;
    collapsed: boolean;
}>();

const PUBLIC_KEYS = ["guildNotesPerServer", "windowWidth", "windowHeight", "appearance", "customColor", "neonColor", "resizable", "barPosition"] satisfies Array<keyof typeof settings.store>;
const PRIVATE_KEYS = ["open", "collapsed", "posX", "posY", "sizeW", "sizeH"] satisfies Array<keyof typeof settings.store>;

function isHexColor(value: unknown): value is string {
    return typeof value === "string" && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);
}

function hexLuminance(hex: string): number {
    const v = hex.slice(1);
    const full = v.length === 3 ? v.split("").map(c => c + c).join("") : v;
    const r = parseInt(full.slice(0, 2), 16) / 255;
    const g = parseInt(full.slice(2, 4), 16) / 255;
    const b = parseInt(full.slice(4, 6), 16) / 255;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function expandHex(hex: string): string {
    const v = hex.slice(1);
    return "#" + (v.length === 3 ? v.split("").map(c => c + c).join("") : v);
}

function ColorField({ initial, onCommit }: { initial: string; onCommit: (value: string) => void; }) {
    const [text, setText] = useState(initial);
    return (
        <div className={cl("color-row")}>
            <input
                type="color"
                className={cl("color-swatch")}
                aria-label="Pick a color"
                value={isHexColor(text) ? expandHex(text) : expandHex(initial)}
                onChange={e => {
                    setText(e.target.value);
                    onCommit(e.target.value);
                }}
            />
            <input
                className={cl("color-hex")}
                value={text}
                spellCheck={false}
                placeholder="#2b2d31"
                onChange={e => setText(e.target.value)}
                onBlur={() => {
                    if (isHexColor(text)) onCommit(text);
                    else setText(initial);
                }}
            />
        </div>
    );
}

function CustomColorEditor({ setValue }: PluginSettingComponentProps) {
    const initial = isHexColor(settings.store.customColor) ? settings.store.customColor : "#2b2d31";
    return <ColorField initial={initial} onCommit={setValue} />;
}

function NeonColorEditor({ setValue }: PluginSettingComponentProps) {
    const initial = isHexColor(settings.store.neonColor) ? settings.store.neonColor : "#ff6a00";
    return <ColorField initial={initial} onCommit={setValue} />;
}

interface FloatingNotesStyle extends CSSProperties {
    "--vc-floatingnotes-neon"?: string;
}

function clamp(value: number, min: number, max: number): number {
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

function noteKey(channelId: string, guildId: string | null, perServer: boolean): string {
    if (perServer && guildId) return "guild:" + guildId;
    return "channel:" + channelId;
}

function NotesIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 24 24" width={20} height={20} fill="currentColor" aria-hidden="true" {...props}>
            <path d="M6 2h8l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm7 1.41V7h3.59L13 3.41ZM7.5 11h6v1.6h-6V11Zm0 3.4h6v1.6h-6v-1.6Z" />
        </svg>
    );
}

function MinusIcon() {
    return (
        <svg viewBox="0 0 24 24" width={14} height={14} fill="currentColor" aria-hidden="true">
            <path d="M5 11h14v2H5v-2Z" />
        </svg>
    );
}

function PlusIcon() {
    return (
        <svg viewBox="0 0 24 24" width={14} height={14} fill="currentColor" aria-hidden="true">
            <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z" />
        </svg>
    );
}

function GripIcon() {
    return (
        <svg viewBox="0 0 24 24" width={12} height={24} fill="currentColor" aria-hidden="true">
            <circle cx="9" cy="6" r="1.6" />
            <circle cx="15" cy="6" r="1.6" />
            <circle cx="9" cy="12" r="1.6" />
            <circle cx="15" cy="12" r="1.6" />
            <circle cx="9" cy="18" r="1.6" />
            <circle cx="15" cy="18" r="1.6" />
        </svg>
    );
}

function LiquidGlassFilter() {
    return (
        <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
            <defs>
                <filter id="vc-floatingnotes-liquid" x="-20%" y="-20%" width="140%" height="140%">
                    <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="2" seed="4" result="noise" />
                    <feDisplacementMap in="SourceGraphic" in2="noise" scale="16" xChannelSelector="R" yChannelSelector="G" />
                </filter>
            </defs>
        </svg>
    );
}

function FloatingNotesWindow() {
    const channelId = useStateFromStores([SelectedChannelStore], () => SelectedChannelStore.getChannelId());
    const rawGuildId = useStateFromStores([SelectedGuildStore], () => SelectedGuildStore.getGuildId());
    const theme = useStateFromStores([ThemeStore], () => ThemeStore.theme);
    const { guildNotesPerServer, windowWidth, windowHeight, appearance, customColor, neonColor, resizable, barPosition } = settings.use(PUBLIC_KEYS);
    const { open, collapsed, posX, posY, sizeW, sizeH } = settings.use(PRIVATE_KEYS);

    const guildId = rawGuildId || null;
    const key = channelId ? noteKey(channelId, guildId, guildNotesPerServer) : null;

    const channel = useStateFromStores([ChannelStore], () => (channelId ? ChannelStore.getChannel(channelId) : undefined), [channelId]);
    const guild = useStateFromStores([GuildStore], () => (guildId ? GuildStore.getGuild(guildId) : undefined), [guildId]);

    const [text, setText] = useState("");
    const [dirty, setDirty] = useState(false);
    const [dragPos, setDragPos] = useState<{ x: number; y: number; } | null>(null);
    const [resizeSize, setResizeSize] = useState<{ w: number; h: number; } | null>(null);
    const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number; pointerId: number; } | null>(null);
    const resizeState = useRef<{ startX: number; startY: number; origW: number; origH: number; pointerId: number; } | null>(null);
    const saveTimer = useRef<number | undefined>(undefined);

    useEffect(() => {
        return () => {
            if (saveTimer.current !== undefined) window.clearTimeout(saveTimer.current);
        };
    }, []);

    useEffect(() => {
        if (!key) return;
        let cancelled = false;
        const cached = notesCache.get(key);
        if (cached !== undefined) {
            setText(cached);
            setDirty(false);
        } else {
            setText("");
            setDirty(false);
            get<string>(key, NotesStore).then(value => {
                if (cancelled) return;
                const next = typeof value === "string" ? value : "";
                notesCache.set(key, next);
                setText(next);
            }).catch(() => undefined);
        }
        return () => {
            cancelled = true;
        };
    }, [key]);

    if (!open || !channelId || !key) return null;

    const perServer = guildNotesPerServer && guildId !== null;
    const shownTitle = guildId
        ? perServer
            ? guild ? guild.name : "Server"
            : channel ? "# " + channel.name : "Channel"
        : "DM Notes";
    const scope = guildId ? (perServer ? "Server" : "Channel") : "DM";

    const baseX = posX ?? Math.max(8, window.innerWidth - windowWidth - 16);
    const baseY = posY ?? 80;
    const left = dragPos ? dragPos.x : baseX;
    const top = dragPos ? dragPos.y : baseY;
    const effW = resizeSize ? resizeSize.w : (sizeW ?? windowWidth);
    const effH = resizeSize ? resizeSize.h : (sizeH ?? windowHeight);
    const activeKey: string = key;

    function persist(value: string, target: string) {
        notesCache.set(target, value);
        if (value.trim() === "") del(target, NotesStore).catch(() => undefined);
        else set(target, value, NotesStore).catch(() => undefined);
        setDirty(false);
    }

    function handleChange(value: string) {
        setText(value);
        setDirty(true);
        notesCache.set(activeKey, value);
        if (saveTimer.current !== undefined) window.clearTimeout(saveTimer.current);
        const target = activeKey;
        const snapshot = value;
        saveTimer.current = window.setTimeout(() => persist(snapshot, target), 400);
    }

    function handleBlur() {
        if (saveTimer.current !== undefined) {
            window.clearTimeout(saveTimer.current);
            saveTimer.current = undefined;
        }
        if (dirty) persist(text, activeKey);
    }

    function handleBarPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
        if (e.button !== 0) return;
        const target = e.target as HTMLElement | null;
        if (target && typeof target.closest === "function" && target.closest("." + cl("collapse"))) return;
        dragState.current = { startX: e.clientX, startY: e.clientY, origX: left, origY: top, pointerId: e.pointerId };
        e.currentTarget.setPointerCapture(e.pointerId);
    }

    function moveDrag(e: ReactPointerEvent<HTMLDivElement>) {
        const s = dragState.current;
        if (!s || s.pointerId !== e.pointerId) return null;
        return {
            x: clamp(s.origX + e.clientX - s.startX, -(effW - 80), window.innerWidth - 80),
            y: clamp(s.origY + e.clientY - s.startY, 0, Math.max(0, window.innerHeight - 60))
        };
    }

    function handleBarPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
        const next = moveDrag(e);
        if (next) setDragPos(next);
    }

    function handleBarPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
        const next = moveDrag(e);
        if (!next) return;
        dragState.current = null;
        setDragPos(null);
        settings.store.posX = Math.round(next.x);
        settings.store.posY = Math.round(next.y);
    }

    function handleResizePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
        if (e.button !== 0) return;
        e.stopPropagation();
        resizeState.current = { startX: e.clientX, startY: e.clientY, origW: effW, origH: effH, pointerId: e.pointerId };
        e.currentTarget.setPointerCapture(e.pointerId);
    }

    function moveResize(e: ReactPointerEvent<HTMLDivElement>) {
        const s = resizeState.current;
        if (!s || s.pointerId !== e.pointerId) return null;
        return {
            w: Math.max(60, s.origW + e.clientX - s.startX),
            h: Math.max(60, s.origH + e.clientY - s.startY)
        };
    }

    function handleResizePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
        const next = moveResize(e);
        if (next) setResizeSize(next);
    }

    function handleResizePointerUp(e: ReactPointerEvent<HTMLDivElement>) {
        const next = moveResize(e);
        if (!next) return;
        resizeState.current = null;
        setResizeSize(null);
        settings.store.sizeW = Math.round(next.w);
        settings.store.sizeH = Math.round(next.h);
    }

    const useCustomColor = appearance === "custom" && isHexColor(customColor);
    const horizontalBar = barPosition === "top" || barPosition === "bottom";
    const style: FloatingNotesStyle = {
        left: left,
        top: top,
        width: collapsed ? (horizontalBar ? effW : 30) : effW,
        height: collapsed ? (horizontalBar ? 30 : effH) : effH,
        transform: collapsed
            ? barPosition === "right"
                ? "translateX(" + (effW - 30) + "px)"
                : barPosition === "bottom"
                    ? "translateY(" + (effH - 30) + "px)"
                    : undefined
            : undefined,
        backgroundColor: useCustomColor ? customColor : undefined,
        "--vc-floatingnotes-neon": appearance === "neon" && isHexColor(neonColor) ? neonColor : undefined
    };

    return ReactDOM.createPortal(
        <div className={classes(cl("root", { collapsed: collapsed, dragging: dragPos !== null || resizeSize !== null, "custom-light": appearance === "custom" && isHexColor(customColor) && hexLuminance(customColor) > 0.55 }, "theme-" + appearance, "bar-" + barPosition), "theme-" + (theme || "dark"), theme === "light" && "vc-floatingnotes-light")} style={style}>
            {appearance === "glass" && <LiquidGlassFilter />}
            <div
                className={cl("bar")}
                title="Drag to move"
                onPointerDown={handleBarPointerDown}
                onPointerMove={handleBarPointerMove}
                onPointerUp={handleBarPointerUp}
                onPointerCancel={handleBarPointerUp}
            >
                <Clickable
                    className={cl("collapse")}
                    aria-label={collapsed ? "Expand notes" : "Collapse notes"}
                    onClick={() => {
                        settings.store.collapsed = !settings.store.collapsed;
                    }}
                >
                    {collapsed ? <PlusIcon /> : <MinusIcon />}
                </Clickable>
                <span className={cl("grip")} aria-hidden="true"><GripIcon /></span>
            </div>
            <div className={cl("body")} aria-hidden={collapsed}>
                <div className={cl("head")}>
                    <span className={cl("title")}>{shownTitle}</span>
                    <span className={cl("scope")}>{scope}</span>
                </div>
                <textarea
                    className={cl("input")}
                    aria-label={"Floating note for " + shownTitle}
                    placeholder="Type here..."
                    value={text}
                    onChange={e => handleChange(e.target.value)}
                    onBlur={handleBlur}
                    rows={8}
                    spellCheck={true}
                    tabIndex={collapsed ? -1 : undefined}
                />
                <div className={cl("foot")}>
                    <span className={cl("count")}>{text.length}</span>
                </div>
            </div>
            {resizable && !collapsed && (
                <div
                    className={cl("resize")}
                    title="Drag to resize"
                    aria-hidden="true"
                    onPointerDown={handleResizePointerDown}
                    onPointerMove={handleResizePointerMove}
                    onPointerUp={handleResizePointerUp}
                    onPointerCancel={handleResizePointerUp}
                />
            )}
        </div>,
        document.body
    );
}

function FloatingNotesToolbar() {
    const { open } = settings.use(PRIVATE_KEYS);

    return (
        <>
            <ChannelToolbarButton
                icon={NotesIcon}
                tooltip={open ? "Hide Floating Notes" : "Show Floating Notes"}
                selected={open}
                onClick={() => {
                    settings.store.open = !settings.store.open;
                }}
            />
            <FloatingNotesWindow />
        </>
    );
}

export default definePlugin({
    name: "FloatingNotes",
    description: "Adds a draggable floating notepad to chats with per DM, per channel, or per server notes.",
    authors: [TestcordDevs.x2b],
    tags: ["Utility", "Organisation"],
    dependencies: ["HeaderBarAPI"],
    settings,

    headerBarButton: {
        location: "channeltoolbar",
        icon: NotesIcon,
        render: FloatingNotesToolbar,
        priority: 250
    },

    start() {
        if (typeof settings.store.open !== "boolean") settings.store.open = true;
        if (typeof settings.store.collapsed !== "boolean") settings.store.collapsed = false;
        entries<string>(NotesStore).then(rows => {
            rows.forEach(([k, v]) => {
                if (typeof k === "string" && typeof v === "string") notesCache.set(k, v);
            });
        }).catch(() => undefined);
    },

    stop() {
        notesCache.clear();
    }
});
