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
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, Clickable, GuildStore, ReactDOM, SelectedChannelStore, SelectedGuildStore, useEffect, useRef, useState, useStateFromStores } from "@webpack/common";
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
    resetPosition: {
        type: OptionType.COMPONENT,
        description: "Reset the floating window position back to the top right.",
        component: () => (
            <Button
                onClick={() => {
                    settings.store.posX = null;
                    settings.store.posY = null;
                }}
            >
                Reset window position
            </Button>
        ),
    },
}).withPrivateSettings<{
    posX: number | null;
    posY: number | null;
    open: boolean;
    collapsed: boolean;
}>();

const PUBLIC_KEYS = ["guildNotesPerServer", "windowWidth", "windowHeight"] satisfies Array<keyof typeof settings.store>;
const PRIVATE_KEYS = ["open", "collapsed", "posX", "posY"] satisfies Array<keyof typeof settings.store>;

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

function FloatingNotesWindow() {
    const channelId = useStateFromStores([SelectedChannelStore], () => SelectedChannelStore.getChannelId());
    const rawGuildId = useStateFromStores([SelectedGuildStore], () => SelectedGuildStore.getGuildId());
    const { guildNotesPerServer, windowWidth, windowHeight } = settings.use(PUBLIC_KEYS);
    const { open, collapsed, posX, posY } = settings.use(PRIVATE_KEYS);

    const guildId = rawGuildId || null;
    const key = channelId ? noteKey(channelId, guildId, guildNotesPerServer) : null;

    const channel = useStateFromStores([ChannelStore], () => (channelId ? ChannelStore.getChannel(channelId) : undefined), [channelId]);
    const guild = useStateFromStores([GuildStore], () => (guildId ? GuildStore.getGuild(guildId) : undefined), [guildId]);

    const [text, setText] = useState("");
    const [dirty, setDirty] = useState(false);
    const [dragPos, setDragPos] = useState<{ x: number; y: number; } | null>(null);
    const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number; pointerId: number; } | null>(null);
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
            x: clamp(s.origX + e.clientX - s.startX, -(windowWidth - 80), window.innerWidth - 80),
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

    const style: CSSProperties = {
        left: left,
        top: top,
        width: collapsed ? 30 : windowWidth,
        height: windowHeight
    };

    return ReactDOM.createPortal(
        <div className={cl("root", { collapsed: collapsed })} style={style}>
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
                    placeholder="Type your note here. It saves automatically."
                    value={text}
                    onChange={e => handleChange(e.target.value)}
                    onBlur={handleBlur}
                    rows={8}
                    spellCheck={true}
                    tabIndex={collapsed ? -1 : undefined}
                />
                <div className={cl("foot")}>
                    <span className={cl("status")}>{dirty ? "Saving." : "Saved."}</span>
                    <span className={cl("count")}>{text.length}</span>
                </div>
            </div>
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
