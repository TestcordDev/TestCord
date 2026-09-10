/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { HeaderBarButton } from "@api/HeaderBar";
import { DataStore } from "@api/index";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { classNameFactory } from "@utils/css";
import { copyWithToast } from "@utils/discord";
import { closeModal, ModalCloseButton, ModalRoot, ModalSize, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { moment, React, ScrollerThin, Tooltip, useEffect, useMemo, useRef, useState } from "@webpack/common";

const cl = classNameFactory("vc-cal-");
const STORE_KEY = "Calendar_notes_v2";
const STORE_KEY_LEGACY = "Calendar_notes";
const STORE_KEY_GOOGLE = "Calendar_google_notes";
const STORE_KEY_LAST_SYNC = "Calendar_google_last_sync";

interface CalendarNote {
    id: string;
    text: string;
    timestamp: number;
    format: string;
    color: string;
    category: string;
    recurring: "none" | "daily" | "weekly" | "monthly" | "yearly";
    reminderMinutes?: number;
    isGoogle?: boolean;
    googleLocation?: string;
}

type NotesMap = Record<string, CalendarNote[]>;

const CATEGORY_DEFS: Record<string, { label: string; color: string; }> = {
    personal: { label: "Personal", color: "#5865f2" },
    work: { label: "Work", color: "#23a55a" },
    event: { label: "Event", color: "#f59e0b" },
    reminder: { label: "Reminder", color: "#f23f43" },
    birthday: { label: "Birthday", color: "#eb459e" },
    google: { label: "Google", color: "#4285f4" },
    other: { label: "Other", color: "#949ba4" },
};

const COLORS = ["#5865f2", "#23a55a", "#f59e0b", "#f23f43", "#eb459e", "#a855f7", "#06b6d4", "#4285f4", "#949ba4"] as const;

export const settings = definePluginSettings({
    weekStartsOnMonday: {
        type: OptionType.BOOLEAN,
        description: "Start week on Monday.",
        default: false,
    },
    showWeekNumbers: {
        type: OptionType.BOOLEAN,
        description: "Show ISO week numbers.",
        default: false,
    },
    defaultCategory: {
        type: OptionType.SELECT,
        description: "Default category for new notes.",
        options: Object.entries(CATEGORY_DEFS).filter(([v]) => v !== "google").map(([v, d]) => ({ label: d.label, value: v, default: v === "personal" })),
    },
    defaultRemind: {
        type: OptionType.SELECT,
        description: "Default reminder offset.",
        options: [
            { label: "No reminder", value: "0", default: true },
            { label: "5 minutes before", value: "5" },
            { label: "15 minutes before", value: "15" },
            { label: "1 hour before", value: "60" },
            { label: "1 day before", value: "1440" },
        ]
    },
    use24h: {
        type: OptionType.BOOLEAN,
        description: "Use 24-hour time in previews.",
        default: false,
    },
    googleCalendarUrl: {
        type: OptionType.STRING,
        description: "Secret Google Calendar iCal (.ics) URL.",
        default: "",
    },
    autoSyncGoogle: {
        type: OptionType.BOOLEAN,
        description: "Automatically sync Google Calendar on open.",
        default: true,
    },
});

async function loadNotes(): Promise<NotesMap> {
    const v2: NotesMap | undefined = await DataStore.get(STORE_KEY);
    if (v2) return v2;
    const legacy = await DataStore.get<Record<string, { id: string; text: string; timestamp: number; format: string; }[]>>(STORE_KEY_LEGACY);
    if (!legacy) return {};
    const migrated: NotesMap = {};
    for (const [k, arr] of Object.entries(legacy)) {
        migrated[k] = arr.map(n => ({
            ...n,
            color: CATEGORY_DEFS.personal.color,
            category: "personal",
            recurring: "none" as const,
        }));
    }
    await DataStore.set(STORE_KEY, migrated);
    return migrated;
}

async function saveNotes(notes: NotesMap): Promise<void> {
    await DataStore.set(STORE_KEY, notes);
}

async function loadGoogleNotes(): Promise<NotesMap> {
    return (await DataStore.get<NotesMap>(STORE_KEY_GOOGLE)) ?? {};
}

async function saveGoogleNotes(notes: NotesMap): Promise<void> {
    await DataStore.set(STORE_KEY_GOOGLE, notes);
}

async function clearGoogleNotes(): Promise<void> {
    await DataStore.del(STORE_KEY_GOOGLE);
    await DataStore.del(STORE_KEY_LAST_SYNC);
}

const TIMESTAMP_FORMATS = [
    { label: "Short Date/Time", discord: "f", moment: "MM/DD/YYYY h:mm A", example: "04/15/2026 3:30 PM" },
    { label: "Long Date/Time", discord: "F", moment: "dddd, MMMM D, YYYY h:mm A", example: "Tuesday, April 15, 2026 3:30 PM" },
    { label: "Short Date", discord: "d", moment: "MM/DD/YYYY", example: "04/15/2026" },
    { label: "Long Date", discord: "D", moment: "MMMM D, YYYY", example: "April 15, 2026" },
    { label: "Time", discord: "t", moment: "h:mm A", example: "3:30 PM" },
    { label: "Long Time", discord: "T", moment: "h:mm:ss A", example: "3:30:00 PM" },
    { label: "Relative", discord: "R", moment: "[relative]", example: "in 3 hours" },
    { label: "Unix Timestamp", discord: "U", moment: "U", example: "1744764600" },
] as const;

interface SelectOption<T extends string = string> {
    value: T;
    label: string;
    color?: string;
}

const FORMAT_OPTIONS: SelectOption<string>[] = TIMESTAMP_FORMATS.map(f => ({
    value: f.discord,
    label: `${f.label} (${f.example})`,
}));

const FORMAT_OPTIONS_SHORT: SelectOption<string>[] = TIMESTAMP_FORMATS.map(f => ({
    value: f.discord,
    label: f.label,
}));

const RECURRING_OPTIONS: SelectOption<CalendarNote["recurring"]>[] = [
    { value: "none", label: "Does not repeat" },
    { value: "daily", label: "Daily" },
    { value: "weekly", label: "Weekly" },
    { value: "monthly", label: "Monthly" },
    { value: "yearly", label: "Yearly" },
];

const REMINDER_OPTIONS: SelectOption<string>[] = [
    { value: "0", label: "No reminder" },
    { value: "5", label: "5 minutes before" },
    { value: "15", label: "15 minutes before" },
    { value: "60", label: "1 hour before" },
    { value: "1440", label: "1 day before" },
];

const CATEGORY_OPTIONS: SelectOption<string>[] = Object.entries(CATEGORY_DEFS)
    .filter(([k]) => k !== "google")
    .map(([k, v]) => ({
        value: k,
        label: v.label,
        color: v.color,
    }));

function formatDiscordTimestamp(ts: number, discordTag: string): string {
    return `<t:${Math.floor(ts / 1000)}:${discordTag}>`;
}

function getWeekNumber(d: Date) {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil((((date as any) - (yearStart as any)) / 86400000 + 1) / 7);
}

function exportIcs(notesMap: NotesMap): string {
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Testcord//Calendar//EN", "CALSCALE:GREGORIAN"];
    for (const [, arr] of Object.entries(notesMap)) {
        for (const n of arr) {
            const dt = new Date(n.timestamp);
            const pad = (v: number) => String(v).padStart(2, "0");
            const dtStr = `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}${pad(dt.getUTCMinutes())}00Z`;
            const esc = (s: string) => s.replace(/[,;\\]/g, "\\$&").replace(/\n/g, "\\n");
            lines.push("BEGIN:VEVENT", `UID:${n.id}@testcord.calendar`, `DTSTAMP:${dtStr}`, `DTSTART:${dtStr}`, `SUMMARY:${esc(n.text || CATEGORY_DEFS[n.category]?.label || "Note")}`, `DESCRIPTION:${esc(n.text)}`, "END:VEVENT");
        }
    }
    lines.push("END:VCALENDAR");
    return lines.join("\r\n");
}

function parseIcsDate(val: string): number | null {
    const clean = val.trim();
    if (!clean) return null;

    const m = clean.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
    if (!m) return null;

    const y = parseInt(m[1]);
    const mo = parseInt(m[2]) - 1;
    const d = parseInt(m[3]);
    const hasTime = m[4] != null;
    const h = hasTime ? parseInt(m[4]) : 9;
    const mi = hasTime ? parseInt(m[5]) : 0;
    const s = hasTime ? parseInt(m[6]) : 0;
    const isUtc = m[7] === "Z";

    if (isUtc) {
        return Date.UTC(y, mo, d, h, mi, s);
    }
    return new Date(y, mo, d, h, mi, s).getTime();
}

function parseIcsFeed(icsText: string): NotesMap {
    const unfolded = icsText.replace(/\r?\n[ \t]/g, "");
    const lines = unfolded.split(/\r?\n/);

    const notesMap: NotesMap = {};
    let inEvent = false;
    let eventObj: {
        summary?: string;
        description?: string;
        location?: string;
        dtstart?: string;
        uid?: string;
    } = {};

    const unescapeIcs = (str: string) =>
        str.replace(/\\([,;\\])/g, "$1").replace(/\\n/gi, "\n");

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (line === "BEGIN:VEVENT") {
            inEvent = true;
            eventObj = {};
            continue;
        }
        if (line === "END:VEVENT") {
            if (inEvent && eventObj.dtstart) {
                const ts = parseIcsDate(eventObj.dtstart);
                if (ts != null) {
                    const d = new Date(ts);
                    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                    const note: CalendarNote = {
                        id: eventObj.uid || `google-${crypto.randomUUID()}`,
                        text: eventObj.summary || "Google Calendar Event",
                        timestamp: ts,
                        format: "f",
                        color: "#4285f4",
                        category: "google",
                        recurring: "none",
                        isGoogle: true,
                        googleLocation: eventObj.location,
                    };
                    if (!notesMap[dateKey]) notesMap[dateKey] = [];
                    notesMap[dateKey].push(note);
                }
            }
            inEvent = false;
            continue;
        }

        if (!inEvent) continue;

        const colonIdx = line.indexOf(":");
        if (colonIdx === -1) continue;

        const propPart = line.slice(0, colonIdx);
        const valPart = line.slice(colonIdx + 1);
        const propName = propPart.split(";")[0].toUpperCase();

        if (propName === "SUMMARY") {
            eventObj.summary = unescapeIcs(valPart);
        } else if (propName === "DESCRIPTION") {
            eventObj.description = unescapeIcs(valPart);
        } else if (propName === "LOCATION") {
            eventObj.location = unescapeIcs(valPart);
        } else if (propName === "UID") {
            eventObj.uid = valPart;
        } else if (propName === "DTSTART") {
            eventObj.dtstart = valPart;
        }
    }

    return notesMap;
}

async function fetchAndParseGoogleCalendar(url: string): Promise<{ success: boolean; count: number; error?: string; notes?: NotesMap; }> {
    const trimmed = url.trim();
    if (!trimmed) {
        return { success: false, count: 0, error: "URL is empty" };
    }
    if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://") && !trimmed.startsWith("webcal://")) {
        return { success: false, count: 0, error: "URL must start with https:// or webcal://" };
    }
    const fetchUrl = trimmed.replace(/^webcal:\/\//i, "https://");
    try {
        const res = await fetch(fetchUrl);
        if (!res.ok) {
            return { success: false, count: 0, error: `HTTP ${res.status}: ${res.statusText}` };
        }
        const text = await res.text();
        if (!text.includes("BEGIN:VCALENDAR")) {
            return { success: false, count: 0, error: "Response is not a valid iCalendar feed" };
        }
        const parsed = parseIcsFeed(text);
        const count = Object.values(parsed).reduce((acc, arr) => acc + arr.length, 0);
        await saveGoogleNotes(parsed);
        await DataStore.set(STORE_KEY_LAST_SYNC, Date.now());
        return { success: true, count, notes: parsed };
    } catch (err: any) {
        return { success: false, count: 0, error: err?.message || "Failed to fetch calendar feed" };
    }
}

function CalendarIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
    );
}

function GoogleIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" {...props}>
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335" />
        </svg>
    );
}

function ChevronLeft(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
            <polyline points="15 18 9 12 15 6" />
        </svg>
    );
}

function ChevronRight(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
            <polyline points="9 18 15 12 9 6" />
        </svg>
    );
}

function ChevronDown(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
            <polyline points="6 9 12 15 18 9" />
        </svg>
    );
}

function CheckIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
            <polyline points="20 6 9 17 4 12" />
        </svg>
    );
}

function CustomSelect<T extends string = string>({
    value,
    options,
    onChange,
    className,
}: {
    value: T;
    options: readonly SelectOption<T>[] | SelectOption<T>[];
    onChange: (val: T) => void;
    className?: string;
}) {
    const [open, setOpen] = useState(false);
    const [openUp, setOpenUp] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [open]);

    const handleToggle = () => {
        if (!open && rootRef.current) {
            const rect = rootRef.current.getBoundingClientRect();
            const spaceBelow = window.innerHeight - rect.bottom;
            if (spaceBelow < 200 && rect.top > 200) {
                setOpenUp(true);
            } else {
                setOpenUp(false);
            }
        }
        setOpen(!open);
    };

    const selectedOption = options.find(o => o.value === value);

    return (
        <div ref={rootRef} className={cl("custom-select-wrapper", { open }, className)}>
            <button
                type="button"
                className={cl("custom-select-trigger", { open })}
                onClick={handleToggle}
                title={selectedOption?.label ?? value}
            >
                <div className={cl("custom-select-value")}>
                    {selectedOption?.color && (
                        <span className={cl("custom-select-dot")} style={{ background: selectedOption.color }} />
                    )}
                    <span className={cl("custom-select-text")}>{selectedOption ? selectedOption.label : value}</span>
                </div>
                <ChevronDown className={cl("custom-select-chevron", { open })} />
            </button>
            {open && (
                <div className={cl("custom-select-menu", { "open-up": openUp })}>
                    {options.map(opt => {
                        const isSelected = opt.value === value;
                        return (
                            <div
                                key={opt.value}
                                className={cl("custom-select-option", { selected: isSelected })}
                                onClick={() => {
                                    onChange(opt.value);
                                    setOpen(false);
                                }}
                                title={opt.label}
                            >
                                <div className={cl("custom-select-option-left")}>
                                    {opt.color && (
                                        <span className={cl("custom-select-dot")} style={{ background: opt.color }} />
                                    )}
                                    <span>{opt.label}</span>
                                </div>
                                {isSelected && <CheckIcon className={cl("custom-select-check")} />}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function SearchIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
    );
}

function CloseIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
    );
}

function PlusIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    );
}

function TrashIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
    );
}

function CopyIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
    );
}

function EditIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
    );
}

function ClockIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
        </svg>
    );
}

function SettingsIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
    );
}

function MoreIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
            <circle cx="12" cy="12" r="1" />
            <circle cx="12" cy="5" r="1" />
            <circle cx="12" cy="19" r="1" />
        </svg>
    );
}

function CalendarGrid({
    year,
    month,
    selectedDay,
    notesMap,
    categoryFilter,
    onDayClick,
    onDayDouble,
    onNavigateMonth,
}: {
    year: number;
    month: number;
    selectedDay: number | null;
    notesMap: NotesMap;
    categoryFilter: string;
    onDayClick: (d: number) => void;
    onDayDouble?: (d: number) => void;
    onNavigateMonth: (targetYear: number, targetMonth: number, selectDay?: number) => void;
}) {
    const weekStartMonday = (() => { try { return settings.store.weekStartsOnMonday ?? false; } catch { return false; } })();
    const showWn = (() => { try { return settings.store.showWeekNumbers ?? false; } catch { return false; } })();

    const firstDayRaw = new Date(year, month, 1).getDay();
    const firstDay = weekStartMonday ? (firstDayRaw === 0 ? 6 : firstDayRaw - 1) : firstDayRaw;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();
    const today = new Date();

    const cells: React.ReactNode[] = [];

    for (let i = firstDay - 1; i >= 0; i--) {
        const d = daysInPrevMonth - i;
        const prevMonthDate = new Date(year, month - 1, d);
        const prevYear = prevMonthDate.getFullYear();
        const prevM = prevMonthDate.getMonth();
        const prevKey = `${prevYear}-${String(prevM + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const prevNotes = notesMap[prevKey] ?? [];
        const hasNotes = prevNotes.length > 0;

        cells.push(
            <div
                key={`prev-${d}`}
                className={cl("day-cell", "outside-month")}
                onClick={() => onNavigateMonth(prevYear, prevM, d)}
            >
                <span className={cl("day-num")}>{d}</span>
                {hasNotes && (
                    <div className={cl("note-dots")}>
                        <div className={cl("note-dot")} style={{ background: prevNotes[0].color || CATEGORY_DEFS[prevNotes[0].category]?.color || "#5865f2" }} />
                    </div>
                )}
            </div>
        );
    }

    for (let d = 1; d <= daysInMonth; d++) {
        const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const allDayNotes = notesMap[key] ?? [];
        const matchingNotes = categoryFilter === "all"
            ? allDayNotes
            : allDayNotes.filter(n => n.category === categoryFilter);

        const hasNotes = matchingNotes.length > 0;
        const isToday = d === today.getDate() && month === today.getMonth() && year === today.getFullYear();
        const isSelected = d === selectedDay;

        const uniqueColors = Array.from(new Set(matchingNotes.map(n => n.color || CATEGORY_DEFS[n.category]?.color || "#5865f2"))).slice(0, 3);
        const moreCount = matchingNotes.length > 3 ? matchingNotes.length - 3 : 0;

        const cellContent = (
            <div
                key={d}
                className={cl("day-cell", { today: isToday, selected: isSelected, "has-notes": hasNotes })}
                onClick={() => onDayClick(d)}
                onDoubleClick={() => onDayDouble?.(d)}
            >
                <span className={cl("day-num")}>{d}</span>
                {hasNotes && (
                    <div className={cl("note-dots")}>
                        {uniqueColors.map((color, idx) => (
                            <div key={idx} className={cl("note-dot")} style={{ background: color }} />
                        ))}
                        {moreCount > 0 && <span className={cl("note-more-count")}>+{moreCount}</span>}
                    </div>
                )}
            </div>
        );

        if (hasNotes) {
            const summary = `${matchingNotes.length} note${matchingNotes.length > 1 ? "s" : ""}: ${matchingNotes.map(n => (n.text.length > 24 ? n.text.slice(0, 24) + "…" : n.text)).join(" • ")}`;
            cells.push(
                <Tooltip key={d} text={summary}>
                    {(props: any) => React.cloneElement(cellContent, props)}
                </Tooltip>
            );
        } else {
            cells.push(cellContent);
        }
    }

    const totalCells = cells.length;
    const targetTotal = totalCells <= 35 ? 35 : 42;
    const remaining = targetTotal - totalCells;

    for (let d = 1; d <= remaining; d++) {
        const nextMonthDate = new Date(year, month + 1, d);
        const nextYear = nextMonthDate.getFullYear();
        const nextM = nextMonthDate.getMonth();
        const nextKey = `${nextYear}-${String(nextM + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const nextNotes = notesMap[nextKey] ?? [];
        const hasNotes = nextNotes.length > 0;

        cells.push(
            <div
                key={`next-${d}`}
                className={cl("day-cell", "outside-month")}
                onClick={() => onNavigateMonth(nextYear, nextM, d)}
            >
                <span className={cl("day-num")}>{d}</span>
                {hasNotes && (
                    <div className={cl("note-dots")}>
                        <div className={cl("note-dot")} style={{ background: nextNotes[0].color || CATEGORY_DEFS[nextNotes[0].category]?.color || "#5865f2" }} />
                    </div>
                )}
            </div>
        );
    }

    if (showWn) {
        const rowCount = cells.length / 7;
        const wnCells: React.ReactNode[] = [];
        for (let row = 0; row < rowCount; row++) {
            const sampleDay = Math.min(daysInMonth, Math.max(1, row * 7 - firstDay + 4));
            const d = new Date(year, month, sampleDay);
            wnCells.push(<div key={row} className={cl("wn-cell")}>{getWeekNumber(d)}</div>);
        }
        return (
            <div className={cl("grid-wrapper")}>
                <div className={cl("wn-column")}>{wnCells}</div>
                <div className={cl("grid")}>{cells}</div>
            </div>
        );
    }

    return (
        <div className={cl("grid-wrapper")}>
            <div className={cl("grid")}>{cells}</div>
        </div>
    );
}

function NoteCard({
    note,
    onDelete,
    onEdit,
    onDuplicate,
}: {
    note: CalendarNote;
    onDelete: (id: string) => void;
    onEdit: (n: CalendarNote) => void;
    onDuplicate: (n: CalendarNote) => void;
}) {
    const mmt = moment(note.timestamp);
    const fmt = TIMESTAMP_FORMATS.find(f => f.discord === note.format);
    const use24 = (() => { try { return settings.store.use24h ?? false; } catch { return false; } })();
    const displayTime = (() => {
        if (!fmt) return mmt.format(use24 ? "YYYY-MM-DD HH:mm" : "MM/DD/YYYY h:mm A");
        if (fmt.discord === "R") return mmt.fromNow();
        if (fmt.discord === "U") return String(Math.floor(note.timestamp / 1000));
        const mFmt = use24 ? fmt.moment.replace(/h:mm A/g, "HH:mm").replace(/h:mm:ss A/g, "HH:mm:ss") : fmt.moment;
        return mmt.format(mFmt);
    })();
    const cat = CATEGORY_DEFS[note.category] ?? CATEGORY_DEFS.other;
    const discordTag = formatDiscordTimestamp(note.timestamp, note.format);

    return (
        <div className={cl("note-card")} style={{ borderLeftColor: note.color || cat.color }}>
            <div className={cl("card-header")}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div className={cl("card-cat-badge")} style={{ background: note.color || cat.color }}>
                        <span>{cat.label}</span>
                    </div>
                    {note.isGoogle && (
                        <div className={cl("google-synced-badge")}>
                            <GoogleIcon style={{ width: 11, height: 11 }} />
                            <span>Synced</span>
                        </div>
                    )}
                </div>
                <span className={cl("card-time")}>{displayTime}</span>
                <div className={cl("card-actions")}>
                    <Tooltip text="Copy Discord timestamp">
                        {(p: any) => (
                            <button {...p} className={cl("card-btn")} onClick={() => copyWithToast(discordTag)}>
                                <CopyIcon />
                            </button>
                        )}
                    </Tooltip>
                    <Tooltip text={note.isGoogle ? "Duplicate as local note" : "Duplicate note"}>
                        {(p: any) => (
                            <button {...p} className={cl("card-btn")} onClick={() => onDuplicate(note)}>
                                <PlusIcon />
                            </button>
                        )}
                    </Tooltip>
                    {!note.isGoogle && (
                        <Tooltip text="Edit note">
                            {(p: any) => (
                                <button {...p} className={cl("card-btn")} onClick={() => onEdit(note)}>
                                    <EditIcon />
                                </button>
                            )}
                        </Tooltip>
                    )}
                    <Tooltip text={note.isGoogle ? "Dismiss event" : "Delete note"}>
                        {(p: any) => (
                            <button {...p} className={cl("card-btn", "delete")} onClick={() => onDelete(note.id)}>
                                <TrashIcon />
                            </button>
                        )}
                    </Tooltip>
                </div>
            </div>

            <div className={cl("card-body")}>{note.text}</div>
            {note.googleLocation && (
                <div className={cl("card-location")}>
                    Location: {note.googleLocation}
                </div>
            )}

            <div className={cl("card-footer")}>
                <Tooltip text="Click to copy Discord timestamp">
                    {(p: any) => (
                        <div {...p} className={cl("discord-tag-pill")} onClick={() => copyWithToast(discordTag)}>
                            <CopyIcon style={{ width: 11, height: 11 }} />
                            <span>{discordTag}</span>
                        </div>
                    )}
                </Tooltip>
                {note.recurring !== "none" && (
                    <span className={cl("meta-badge")}>Repeat: {note.recurring}</span>
                )}
                {note.reminderMinutes ? (
                    <span className={cl("meta-badge")}>Remind: {note.reminderMinutes}m</span>
                ) : null}
            </div>
        </div>
    );
}

function NoteComposer({
    onAdd,
    defaultDate,
}: {
    onAdd: (data: Omit<CalendarNote, "id">) => void;
    defaultDate: Date;
}) {
    const [text, setText] = useState("");
    const [format, setFormat] = useState("f");
    const [category, setCategory] = useState<string>(() => {
        try { return settings.store.defaultCategory ?? "personal"; } catch { return "personal"; }
    });
    const [color, setColor] = useState<string>(() => CATEGORY_DEFS[(() => {
        try { return settings.store.defaultCategory ?? "personal"; } catch { return "personal"; }
    })()]?.color ?? "#5865f2");

    const [hour, setHour] = useState<string>(() => String(defaultDate.getHours()).padStart(2, "0"));
    const [minute, setMinute] = useState<string>(() => String(defaultDate.getMinutes()).padStart(2, "0"));
    const [recurring, setRecurring] = useState<CalendarNote["recurring"]>("none");
    const [remind, setRemind] = useState<string>(() => {
        try { return settings.store.defaultRemind ?? "0"; } catch { return "0"; }
    });

    const [showCatMenu, setShowCatMenu] = useState(false);
    const [showTimeMenu, setShowTimeMenu] = useState(false);
    const [showOptionsMenu, setShowOptionsMenu] = useState(false);

    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        const c = CATEGORY_DEFS[category];
        if (c) setColor(c.color);
    }, [category]);

    const handleSubmit = () => {
        if (!text.trim()) return;
        const h = Math.min(23, Math.max(0, parseInt(hour) || 0));
        const m = Math.min(59, Math.max(0, parseInt(minute) || 0));
        const ts = new Date(defaultDate);
        ts.setHours(h, m, 0, 0);

        onAdd({
            text: text.trim(),
            timestamp: ts.getTime(),
            format,
            color,
            category,
            recurring,
            reminderMinutes: remind !== "0" ? parseInt(remind) : undefined,
        });

        setText("");
        setShowCatMenu(false);
        setShowTimeMenu(false);
        setShowOptionsMenu(false);
    };

    const handleHourBlur = () => {
        const val = Math.min(23, Math.max(0, parseInt(hour) || 0));
        setHour(String(val).padStart(2, "0"));
    };

    const handleMinuteBlur = () => {
        const val = Math.min(59, Math.max(0, parseInt(minute) || 0));
        setMinute(String(val).padStart(2, "0"));
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    };

    const previewTs = (() => {
        const h = parseInt(hour) || 0;
        const m = parseInt(minute) || 0;
        const d = new Date(defaultDate);
        d.setHours(h, m, 0, 0);
        return d.getTime();
    })();

    const activeCat = CATEGORY_DEFS[category] ?? CATEGORY_DEFS.personal;
    const formattedTime = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

    return (
        <div className={cl("composer")}>
            <textarea
                ref={textareaRef}
                className={cl("composer-textarea")}
                placeholder="Add a note… (Shift+Enter for newline, Enter to save)"
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={2}
            />

            <div className={cl("composer-toolbar")}>
                <div className={cl("composer-tools-left")}>
                    <div style={{ position: "relative" }}>
                        <button
                            type="button"
                            className={cl("tool-pill", { active: showCatMenu })}
                            onClick={() => { setShowCatMenu(!showCatMenu); setShowTimeMenu(false); setShowOptionsMenu(false); }}
                        >
                            <span className={cl("filter-dot")} style={{ background: color }} />
                            <span>{activeCat.label}</span>
                            <ChevronDown />
                        </button>
                        {showCatMenu && (
                            <div className={cl("tool-popover", "cat-options")}>
                                {Object.entries(CATEGORY_DEFS).filter(([k]) => k !== "google").map(([k, v]) => (
                                    <button
                                        key={k}
                                        type="button"
                                        className={cl("cat-opt")}
                                        onClick={() => { setCategory(k); setShowCatMenu(false); }}
                                    >
                                        <span className={cl("filter-dot")} style={{ background: v.color }} />
                                        <span>{v.label}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <div style={{ position: "relative" }}>
                        <button
                            type="button"
                            className={cl("tool-pill", { active: showTimeMenu })}
                            onClick={() => { setShowTimeMenu(!showTimeMenu); setShowCatMenu(false); setShowOptionsMenu(false); }}
                        >
                            <ClockIcon />
                            <span>{formattedTime}</span>
                            <ChevronDown />
                        </button>
                        {showTimeMenu && (
                            <div className={cl("tool-popover", "time-popover")}>
                                <div className={cl("options-label")}>Event Time</div>
                                <div className={cl("time-inputs-row")}>
                                    <input
                                        type="number"
                                        min={0}
                                        max={23}
                                        className={cl("num-input")}
                                        value={hour}
                                        onChange={e => setHour(e.target.value)}
                                        onBlur={handleHourBlur}
                                    />
                                    <span>:</span>
                                    <input
                                        type="number"
                                        min={0}
                                        max={59}
                                        className={cl("num-input")}
                                        value={minute}
                                        onChange={e => setMinute(e.target.value)}
                                        onBlur={handleMinuteBlur}
                                    />
                                </div>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginTop: 4 }}>
                                    <button type="button" className={cl("tool-pill")} onClick={() => { setHour("09"); setMinute("00"); setShowTimeMenu(false); }}>09:00 AM</button>
                                    <button type="button" className={cl("tool-pill")} onClick={() => { setHour("12"); setMinute("00"); setShowTimeMenu(false); }}>12:00 PM</button>
                                    <button type="button" className={cl("tool-pill")} onClick={() => { setHour("18"); setMinute("00"); setShowTimeMenu(false); }}>06:00 PM</button>
                                    <button type="button" className={cl("tool-pill")} onClick={() => { setHour("21"); setMinute("00"); setShowTimeMenu(false); }}>09:00 PM</button>
                                </div>
                            </div>
                        )}
                    </div>

                    <div style={{ position: "relative" }}>
                        <button
                            type="button"
                            className={cl("tool-pill", { active: showOptionsMenu })}
                            onClick={() => { setShowOptionsMenu(!showOptionsMenu); setShowCatMenu(false); setShowTimeMenu(false); }}
                        >
                            <SettingsIcon />
                            <span>Options</span>
                            <ChevronDown />
                        </button>
                        {showOptionsMenu && (
                            <div className={cl("tool-popover", "options-popover")}>
                                <div className={cl("options-field")}>
                                    <span className={cl("options-label")}>Timestamp Format</span>
                                    <CustomSelect
                                        value={format}
                                        options={FORMAT_OPTIONS}
                                        onChange={setFormat}
                                    />
                                </div>

                                <div className={cl("options-field")}>
                                    <span className={cl("options-label")}>Repeat</span>
                                    <CustomSelect
                                        value={recurring}
                                        options={RECURRING_OPTIONS}
                                        onChange={v => setRecurring(v as any)}
                                    />
                                </div>

                                <div className={cl("options-field")}>
                                    <span className={cl("options-label")}>Reminder Notification</span>
                                    <CustomSelect
                                        value={remind}
                                        options={REMINDER_OPTIONS}
                                        onChange={setRemind}
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <Button size="small" variant="primary" onClick={handleSubmit} disabled={!text.trim()}>
                    <PlusIcon /> Add Note
                </Button>
            </div>

            <div className={cl("composer-preview")}>
                <span>Preview:</span>
                <span className={cl("ts-code")}>{formatDiscordTimestamp(previewTs, format)}</span>
            </div>
        </div>
    );
}

function EditModal({ note, onSave, onClose }: { note: CalendarNote; onSave: (n: CalendarNote) => void; onClose: () => void; }) {
    const [text, setText] = useState(note.text);
    const [cat, setCat] = useState(note.category);
    const [color, setColor] = useState(note.color);
    const [fmt, setFmt] = useState(note.format);
    const [rec, setRec] = useState(note.recurring);
    const d = new Date(note.timestamp);
    const [h, setH] = useState(String(d.getHours()).padStart(2, "0"));
    const [mi, setMi] = useState(String(d.getMinutes()).padStart(2, "0"));

    const handleHBlur = () => {
        const val = Math.min(23, Math.max(0, parseInt(h) || 0));
        setH(String(val).padStart(2, "0"));
    };

    const handleMiBlur = () => {
        const val = Math.min(59, Math.max(0, parseInt(mi) || 0));
        setMi(String(val).padStart(2, "0"));
    };

    return (
        <div className={cl("overlay-backdrop")} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className={cl("dialog-card")}>
                <div className={cl("dialog-header")}>
                    <span className={cl("dialog-title")}>Edit Note</span>
                    <button type="button" className={cl("dialog-close")} onClick={onClose} title="Close">
                        <CloseIcon />
                    </button>
                </div>
                <div className={cl("dialog-body")}>
                    <div className={cl("edit-field")}>
                        <span className={cl("edit-label")}>Note Text</span>
                        <textarea
                            className={cl("composer-textarea")}
                            style={{ background: "var(--background-tertiary, #1e1f22)", padding: 8, borderRadius: 4, minHeight: 60 }}
                            value={text}
                            onChange={e => setText(e.target.value)}
                            rows={3}
                        />
                    </div>

                    <div className={cl("edit-field")}>
                        <span className={cl("edit-label")}>Category</span>
                        <CustomSelect
                            value={cat}
                            options={CATEGORY_OPTIONS}
                            onChange={v => {
                                setCat(v);
                                const c = CATEGORY_DEFS[v];
                                if (c) setColor(c.color);
                            }}
                        />
                    </div>

                    <div className={cl("color-dots")}>
                        {COLORS.map(c => (
                            <button
                                key={c}
                                type="button"
                                className={cl("color-dot", { active: color === c })}
                                style={{ background: c }}
                                onClick={() => setColor(c)}
                            />
                        ))}
                    </div>

                    <div className={cl("edit-row")}>
                        <div className={cl("edit-field")}>
                            <span className={cl("edit-label")}>Time (HH:MM)</span>
                            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                <input
                                    type="number"
                                    min={0}
                                    max={23}
                                    className={cl("num-input")}
                                    value={h}
                                    onChange={e => setH(e.target.value)}
                                    onBlur={handleHBlur}
                                />
                                <span>:</span>
                                <input
                                    type="number"
                                    min={0}
                                    max={59}
                                    className={cl("num-input")}
                                    value={mi}
                                    onChange={e => setMi(e.target.value)}
                                    onBlur={handleMiBlur}
                                />
                            </div>
                        </div>

                        <div className={cl("edit-field")} style={{ flex: 1 }}>
                            <span className={cl("edit-label")}>Format</span>
                            <CustomSelect
                                value={fmt}
                                options={FORMAT_OPTIONS_SHORT}
                                onChange={setFmt}
                            />
                        </div>
                    </div>

                    <div className={cl("edit-field")}>
                        <span className={cl("edit-label")}>Repeat</span>
                        <CustomSelect
                            value={rec}
                            options={RECURRING_OPTIONS}
                            onChange={v => setRec(v as any)}
                        />
                    </div>
                </div>
                <div className={cl("dialog-footer")}>
                    <Button variant="secondary" onClick={onClose}>Cancel</Button>
                    <Button
                        variant="primary"
                        onClick={() => {
                            const nd = new Date(note.timestamp);
                            nd.setHours(parseInt(h) || 0, parseInt(mi) || 0, 0, 0);
                            onSave({ ...note, text, category: cat, color, format: fmt, recurring: rec, timestamp: nd.getTime() });
                            onClose();
                        }}
                    >
                        Save Changes
                    </Button>
                </div>
            </div>
        </div>
    );
}

function GoogleSyncModal({
    onClose,
    onSyncComplete,
    onClearComplete,
}: {
    onClose: () => void;
    onSyncComplete: (notes: NotesMap) => void;
    onClearComplete: () => void;
}) {
    const [url, setUrl] = useState(() => {
        try { return settings.store.googleCalendarUrl ?? ""; } catch { return ""; }
    });
    const [status, setStatus] = useState<string | null>(null);
    const [isError, setIsError] = useState(false);
    const [loading, setLoading] = useState(false);
    const [lastSync, setLastSync] = useState<number | null>(null);

    useEffect(() => {
        DataStore.get<number>(STORE_KEY_LAST_SYNC).then(ts => {
            if (ts) setLastSync(ts);
        });
    }, []);

    const handleSync = async () => {
        const trimmed = url.trim();
        if (!trimmed) {
            setStatus("Please enter your Google Calendar secret iCal URL.");
            setIsError(true);
            return;
        }

        setLoading(true);
        setStatus("Fetching and parsing Google Calendar feed…");
        setIsError(false);

        settings.store.googleCalendarUrl = trimmed;

        const res = await fetchAndParseGoogleCalendar(trimmed);
        setLoading(false);

        if (res.success && res.notes) {
            setStatus(`Successfully synced ${res.count} event${res.count !== 1 ? "s" : ""}!`);
            setIsError(false);
            setLastSync(Date.now());
            onSyncComplete(res.notes);
        } else {
            setStatus(res.error || "Failed to sync calendar.");
            setIsError(true);
        }
    };

    const handleClear = async () => {
        if (!confirm("Remove all synced Google Calendar events from TestCord?")) return;
        await clearGoogleNotes();
        setLastSync(null);
        setStatus("All synced Google events removed.");
        setIsError(false);
        onClearComplete();
    };

    return (
        <div className={cl("overlay-backdrop")} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className={cl("dialog-card")}>
                <div className={cl("dialog-header")}>
                    <div className={cl("dialog-title")}>
                        <GoogleIcon style={{ width: 15, height: 15 }} />
                        <span>Google Calendar Sync</span>
                    </div>
                    <button type="button" className={cl("dialog-close")} onClick={onClose} title="Close">
                        <CloseIcon />
                    </button>
                </div>

                <div className={cl("dialog-body")}>
                    <div className={cl("sync-help-card")}>
                        <div className={cl("sync-help-title")}>How to get your secret iCal link:</div>
                        <ol className={cl("sync-help-steps")}>
                            <li>Open Google Calendar in your web browser.</li>
                            <li>On the left, find your calendar and click ⋮ → Settings and sharing.</li>
                            <li>Scroll down to the "Secret address in iCal format" section.</li>
                            <li>Copy the URL and paste it into the field below.</li>
                        </ol>
                    </div>

                    <div className={cl("edit-field")}>
                        <span className={cl("edit-label")}>Secret iCal URL</span>
                        <input
                            type="text"
                            className={cl("sync-input")}
                            placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
                            value={url}
                            onChange={e => setUrl(e.target.value)}
                        />
                    </div>

                    {lastSync && (
                        <div className={cl("sync-meta-row")}>
                            <span>Last synced:</span>
                            <span>{new Date(lastSync).toLocaleString()}</span>
                        </div>
                    )}

                    {status && (
                        <div className={cl("sync-status", { error: isError, success: !isError })}>
                            {status}
                        </div>
                    )}
                </div>

                <div className={cl("dialog-footer")}>
                    <Button variant="secondary" onClick={handleClear} disabled={loading}>
                        Clear Events
                    </Button>
                    <Button variant="primary" onClick={handleSync} disabled={loading || !url.trim()}>
                        {loading ? "Syncing…" : "Sync Now"}
                    </Button>
                </div>
            </div>
        </div>
    );
}

function CalendarModal({ transitionState, onClose }: { transitionState: any; onClose: () => void; }) {
    const now = new Date();
    const [year, setYear] = useState(now.getFullYear());
    const [month, setMonth] = useState(now.getMonth());
    const [selectedDay, setSelectedDay] = useState<number | null>(now.getDate());
    const [notesMap, setNotesMap] = useState<NotesMap>({});
    const [googleNotesMap, setGoogleNotesMap] = useState<NotesMap>({});
    const [loaded, setLoaded] = useState(false);

    const [globalSearch, setGlobalSearch] = useState("");
    const [categoryFilter, setCategoryFilter] = useState("all");
    const [showMonthPicker, setShowMonthPicker] = useState(false);
    const [showToolsMenu, setShowToolsMenu] = useState(false);
    const [showGoogleSyncModal, setShowGoogleSyncModal] = useState(false);
    const [editNote, setEditNote] = useState<CalendarNote | null>(null);

    useEffect(() => {
        loadNotes().then(n => {
            setNotesMap(n);
            setLoaded(true);
        });
        loadGoogleNotes().then(gn => {
            setGoogleNotesMap(gn);
        });
        const url = settings.store.googleCalendarUrl?.trim();
        const autoSync = settings.store.autoSyncGoogle ?? true;
        if (url && autoSync) {
            fetchAndParseGoogleCalendar(url).then(res => {
                if (res.success && res.notes) {
                    setGoogleNotesMap(res.notes);
                }
            });
        }
    }, []);

    const mergedNotesMap = useMemo(() => {
        const merged: NotesMap = { ...notesMap };
        for (const [k, arr] of Object.entries(googleNotesMap)) {
            merged[k] = [...(merged[k] ?? []), ...arr];
        }
        return merged;
    }, [notesMap, googleNotesMap]);

    useEffect(() => {
        const id = setInterval(() => {
            const nowMs = Date.now();
            for (const arr of Object.values(mergedNotesMap)) {
                for (const n of arr) {
                    if (!n.reminderMinutes) continue;
                    const remindAt = n.timestamp - n.reminderMinutes * 60_000;
                    const diff = Math.abs(nowMs - remindAt);
                    if (diff < 60_000 && nowMs >= remindAt - 60_000 && nowMs < remindAt + 60_000) {
                        const cat = CATEGORY_DEFS[n.category]?.label ?? "Note";
                        showNotification({ title: `${cat} reminder`, body: n.text.slice(0, 120) });
                    }
                }
            }
        }, 60_000);
        return () => clearInterval(id);
    }, [mergedNotesMap]);

    const monthName = new Date(year, month).toLocaleDateString("en-US", { month: "long" });
    const weekStartMonday = (() => { try { return settings.store.weekStartsOnMonday; } catch { return false; } })();
    const weekdays = weekStartMonday
        ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    const prevMonth = () => {
        if (month === 0) {
            setMonth(11);
            setYear(y => y - 1);
        } else {
            setMonth(m => m - 1);
        }
        setSelectedDay(null);
    };

    const nextMonth = () => {
        if (month === 11) {
            setMonth(0);
            setYear(y => y + 1);
        } else {
            setMonth(m => m + 1);
        }
        setSelectedDay(null);
    };

    const goToday = () => {
        const t = new Date();
        setYear(t.getFullYear());
        setMonth(t.getMonth());
        setSelectedDay(t.getDate());
    };

    const navigateToDate = (targetYear: number, targetMonth: number, day?: number) => {
        setYear(targetYear);
        setMonth(targetMonth);
        if (day != null) setSelectedDay(day);
    };

    const dateKey = selectedDay != null
        ? `${year}-${String(month + 1).padStart(2, "0")}-${String(selectedDay).padStart(2, "0")}`
        : null;

    const selectedDateObj = useMemo(() => {
        if (selectedDay == null) return new Date(year, month, 1);
        return new Date(year, month, selectedDay);
    }, [year, month, selectedDay]);

    const handleAddNote = async (data: Omit<CalendarNote, "id">) => {
        if (!dateKey) return;
        const currentNotes = notesMap[dateKey] ?? [];
        const newNote: CalendarNote = { id: crypto.randomUUID(), ...data };
        const updated = { ...notesMap, [dateKey]: [...currentNotes, newNote] };
        await saveNotes(updated);
        setNotesMap(updated);
    };

    const handleDeleteNote = async (key: string, id: string) => {
        if (googleNotesMap[key]?.some(n => n.id === id)) {
            const currentGoogle = googleNotesMap[key] ?? [];
            const updatedGoogle = currentGoogle.filter(n => n.id !== id);
            const updated = { ...googleNotesMap, [key]: updatedGoogle };
            if (updatedGoogle.length === 0) delete updated[key];
            await saveGoogleNotes(updated);
            setGoogleNotesMap(updated);
            return;
        }
        const currentNotes = notesMap[key] ?? [];
        const updatedNotes = currentNotes.filter(n => n.id !== id);
        const updated = { ...notesMap, [key]: updatedNotes };
        if (updatedNotes.length === 0) delete updated[key];
        await saveNotes(updated);
        setNotesMap(updated);
    };

    const handleEditSave = async (updatedNote: CalendarNote) => {
        if (!dateKey) return;
        const currentNotes = notesMap[dateKey] ?? [];
        const updated = {
            ...notesMap,
            [dateKey]: currentNotes.map(n => n.id === updatedNote.id ? updatedNote : n)
        };
        await saveNotes(updated);
        setNotesMap(updated);
    };

    const handleDuplicateNote = async (key: string, n: CalendarNote) => {
        const currentNotes = notesMap[key] ?? [];
        const dup: CalendarNote = {
            ...n,
            id: crypto.randomUUID(),
            text: n.text + (n.isGoogle ? " (from Google)" : " (copy)"),
            isGoogle: undefined,
            category: n.isGoogle ? "event" : n.category,
            color: n.isGoogle ? CATEGORY_DEFS.event.color : n.color,
        };
        const updated = { ...notesMap, [key]: [...currentNotes, dup] };
        await saveNotes(updated);
        setNotesMap(updated);
    };

    const handleClearDay = async () => {
        if (!dateKey) return;
        const currentNotes = notesMap[dateKey] ?? [];
        if (!currentNotes.length) return;
        if (!confirm(`Delete all ${currentNotes.length} local notes for this day?`)) return;
        const updated = { ...notesMap };
        delete updated[dateKey];
        await saveNotes(updated);
        setNotesMap(updated);
    };

    const handleQuickGoogleSync = async () => {
        setShowToolsMenu(false);
        const url = settings.store.googleCalendarUrl?.trim();
        if (!url) {
            setShowGoogleSyncModal(true);
            return;
        }
        copyWithToast("Syncing Google Calendar…");
        const res = await fetchAndParseGoogleCalendar(url);
        if (res.success && res.notes) {
            setGoogleNotesMap(res.notes);
            copyWithToast(`Synced ${res.count} Google Calendar events`);
        } else {
            copyWithToast(res.error || "Failed to sync Google Calendar");
        }
    };

    const handleExportJson = () => {
        const blob = new Blob([JSON.stringify(notesMap, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `calendar-notes-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        setShowToolsMenu(false);
    };

    const handleExportIcs = () => {
        const ics = exportIcs(notesMap);
        const blob = new Blob([ics], { type: "text/calendar" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `calendar-events-${Date.now()}.ics`;
        a.click();
        URL.revokeObjectURL(url);
        setShowToolsMenu(false);
    };

    const handleImportJson = () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json";
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                const parsed = JSON.parse(text);
                await saveNotes(parsed);
                setNotesMap(parsed);
                copyWithToast("Calendar data imported successfully.");
            } catch {
                copyWithToast("Failed to import calendar data.");
            }
        };
        input.click();
        setShowToolsMenu(false);
    };

    const handleClearAll = async () => {
        if (!confirm("Are you sure you want to delete ALL calendar notes? This action cannot be undone.")) return;
        await DataStore.del(STORE_KEY);
        setNotesMap({});
        setShowToolsMenu(false);
    };

    const searchResults = useMemo(() => {
        if (!globalSearch.trim()) return [];
        const q = globalSearch.toLowerCase();
        return Object.entries(mergedNotesMap).flatMap(([k, arr]) =>
            arr.filter(n => n.text.toLowerCase().includes(q) || k.includes(q) || CATEGORY_DEFS[n.category]?.label.toLowerCase().includes(q))
                .map(n => ({ key: k, note: n }))
        ).slice(0, 15);
    }, [globalSearch, mergedNotesMap]);

    const dayNotes = dateKey ? (mergedNotesMap[dateKey] ?? []) : [];
    const filteredDayNotes = categoryFilter === "all"
        ? dayNotes
        : dayNotes.filter(n => n.category === categoryFilter);

    const relativeDayLabel = useMemo(() => {
        if (!dateKey) return "";
        const todayStr = new Date().toISOString().slice(0, 10);
        if (dateKey === todayStr) return "Today";
        const tomorrowStr = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
        if (dateKey === tomorrowStr) return "Tomorrow";
        const yesterdayStr = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        if (dateKey === yesterdayStr) return "Yesterday";
        return "";
    }, [dateKey]);

    return (
        <ModalRoot size={ModalSize.DYNAMIC} className={cl("modal-root")} transitionState={transitionState}>
            <div className={cl("modal-header")}>
                <div className={cl("header-left")}>
                    <CalendarIcon className={cl("header-icon")} />
                    <span className={cl("header-title")}>Calendar</span>
                </div>

                <div className={cl("header-right")}>
                    <div className={cl("search-wrapper")}>
                        <SearchIcon className={cl("search-icon")} />
                        <input
                            type="text"
                            className={cl("search-input")}
                            placeholder="Search notes…"
                            value={globalSearch}
                            onChange={e => setGlobalSearch(e.target.value)}
                        />
                        {globalSearch && (
                            <button
                                type="button"
                                className={cl("search-clear")}
                                onClick={() => setGlobalSearch("")}
                                title="Clear search"
                            >
                                <CloseIcon />
                            </button>
                        )}

                        {globalSearch.trim() && (
                            <div className={cl("search-dropdown")}>
                                {searchResults.length ? searchResults.map(({ key, note }) => {
                                    const cat = CATEGORY_DEFS[note.category] ?? CATEGORY_DEFS.other;
                                    return (
                                        <div
                                            key={note.id}
                                            className={cl("search-item")}
                                            style={{ borderLeftColor: note.color || cat.color }}
                                            onClick={() => {
                                                const [y, m, d] = key.split("-").map(Number);
                                                setYear(y);
                                                setMonth(m - 1);
                                                setSelectedDay(d);
                                                setGlobalSearch("");
                                            }}
                                        >
                                            <div className={cl("search-item-top")}>
                                                <span className={cl("search-item-date")}>{key}</span>
                                                <span className={cl("search-item-cat")} style={{ background: note.color || cat.color }}>
                                                    {cat.label}
                                                </span>
                                            </div>
                                            <div className={cl("search-item-text")}>{note.text}</div>
                                        </div>
                                    );
                                }) : (
                                    <div style={{ padding: 12, textAlign: "center", fontSize: 12, color: "var(--text-muted)" }}>
                                        No notes found matching "{globalSearch}"
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div style={{ position: "relative" }}>
                        <button
                            type="button"
                            className={cl("header-btn")}
                            onClick={() => setShowToolsMenu(!showToolsMenu)}
                            title="Tools"
                        >
                            <MoreIcon />
                            <span>Tools</span>
                        </button>
                        {showToolsMenu && (
                            <div className={cl("tools-menu")}>
                                <button type="button" className={cl("menu-item")} onClick={handleExportJson}>
                                    Export JSON
                                </button>
                                <button type="button" className={cl("menu-item")} onClick={handleExportIcs}>
                                    Export ICS (iCal)
                                </button>
                                <button type="button" className={cl("menu-item")} onClick={handleImportJson}>
                                    Import JSON
                                </button>
                                <div style={{ height: 1, background: "var(--background-modifier-accent, rgba(255,255,255,0.06))", margin: "4px 0" }} />
                                <button
                                    type="button"
                                    className={cl("menu-item")}
                                    onClick={() => {
                                        setShowToolsMenu(false);
                                        setShowGoogleSyncModal(true);
                                    }}
                                >
                                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                        <GoogleIcon style={{ width: 12, height: 12 }} />
                                        <span>Google Calendar Sync…</span>
                                    </div>
                                </button>
                                {settings.store.googleCalendarUrl && (
                                    <button
                                        type="button"
                                        className={cl("menu-item")}
                                        onClick={handleQuickGoogleSync}
                                    >
                                        Sync Google Now
                                    </button>
                                )}
                                <div style={{ height: 1, background: "var(--background-modifier-accent, rgba(255,255,255,0.06))", margin: "4px 0" }} />
                                <button type="button" className={cl("menu-item", "danger-item")} onClick={handleClearAll}>
                                    Clear all notes
                                </button>
                            </div>
                        )}
                    </div>

                    <ModalCloseButton onClick={onClose} />
                </div>
            </div>

            <div className={cl("body")}>
                <div className={cl("left-pane")}>
                    <div className={cl("nav-bar")}>
                        <button
                            type="button"
                            className={cl("nav-month-btn")}
                            onClick={() => setShowMonthPicker(!showMonthPicker)}
                        >
                            <span>{monthName} {year}</span>
                            <ChevronDown style={{ transform: showMonthPicker ? "rotate(180deg)" : undefined, transition: "transform 0.15s" }} />
                        </button>

                        {showMonthPicker && (
                            <div className={cl("picker-popover")}>
                                <div className={cl("picker-year-row")}>
                                    <button
                                        type="button"
                                        className={cl("picker-year-btn")}
                                        onClick={() => setYear(y => y - 1)}
                                    >
                                        <ChevronLeft />
                                    </button>
                                    <span>{year}</span>
                                    <button
                                        type="button"
                                        className={cl("picker-year-btn")}
                                        onClick={() => setYear(y => y + 1)}
                                    >
                                        <ChevronRight />
                                    </button>
                                </div>
                                <div className={cl("picker-months-grid")}>
                                    {Array.from({ length: 12 }, (_, i) => {
                                        const mLabel = new Date(2026, i).toLocaleDateString("en-US", { month: "short" });
                                        const isSelectedMonth = i === month;
                                        return (
                                            <button
                                                key={i}
                                                type="button"
                                                className={cl("picker-month-cell", { active: isSelectedMonth })}
                                                onClick={() => {
                                                    setMonth(i);
                                                    setShowMonthPicker(false);
                                                }}
                                            >
                                                {mLabel}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        <div className={cl("nav-controls")}>
                            <button type="button" className={cl("nav-arrow-btn")} onClick={prevMonth} title="Previous month">
                                <ChevronLeft />
                            </button>
                            <button type="button" className={cl("nav-today-btn")} onClick={goToday}>
                                Today
                            </button>
                            <button type="button" className={cl("nav-arrow-btn")} onClick={nextMonth} title="Next month">
                                <ChevronRight />
                            </button>
                        </div>
                    </div>

                    <div className={cl("weekday-row", { "with-wn": settings.store.showWeekNumbers })}>
                        {settings.store.showWeekNumbers && <div className={cl("weekday-cell")}>Wk</div>}
                        {weekdays.map(d => (
                            <div key={d} className={cl("weekday-cell")}>{d}</div>
                        ))}
                    </div>

                    {loaded && (
                        <CalendarGrid
                            year={year}
                            month={month}
                            selectedDay={selectedDay}
                            notesMap={mergedNotesMap}
                            categoryFilter={categoryFilter}
                            onDayClick={setSelectedDay}
                            onDayDouble={setSelectedDay}
                            onNavigateMonth={navigateToDate}
                        />
                    )}

                    <div className={cl("filter-bar")}>
                        <button
                            type="button"
                            className={cl("filter-pill", { active: categoryFilter === "all" })}
                            onClick={() => setCategoryFilter("all")}
                        >
                            All
                        </button>
                        {Object.entries(CATEGORY_DEFS).map(([k, v]) => (
                            <button
                                key={k}
                                type="button"
                                className={cl("filter-pill", { active: categoryFilter === k })}
                                onClick={() => setCategoryFilter(k)}
                            >
                                <span className={cl("filter-dot")} style={{ background: v.color }} />
                                <span>{v.label}</span>
                            </button>
                        ))}
                    </div>

                    <div className={cl("bottom-hint")}>
                        Click a day to view notes • Double-click to add a note
                    </div>
                </div>

                <div className={cl("right-pane")}>
                    <div className={cl("day-header")}>
                        <div className={cl("day-title-group")}>
                            <div className={cl("day-title-row")}>
                                <span className={cl("day-weekday")}>
                                    {selectedDateObj.toLocaleDateString("en-US", { weekday: "long" })}
                                </span>
                                {relativeDayLabel && (
                                    <span className={cl("day-badge-relative")}>{relativeDayLabel}</span>
                                )}
                            </div>
                            <span className={cl("day-full-date")}>
                                {selectedDateObj.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                            </span>
                        </div>

                        <div className={cl("day-header-actions")}>
                            <span className={cl("note-count-pill")}>
                                {dayNotes.length} note{dayNotes.length !== 1 ? "s" : ""}
                            </span>
                            {dayNotes.length > 0 && (
                                <Button size="small" variant="secondary" onClick={handleClearDay} title="Clear Day Notes">
                                    <TrashIcon />
                                </Button>
                            )}
                        </div>
                    </div>

                    <NoteComposer onAdd={handleAddNote} defaultDate={selectedDateObj} />

                    <ScrollerThin className={cl("notes-scroller")}>
                        {filteredDayNotes.length > 0 ? (
                            filteredDayNotes.map(note => (
                                <NoteCard
                                    key={note.id}
                                    note={note}
                                    onDelete={id => handleDeleteNote(dateKey!, id)}
                                    onEdit={setEditNote}
                                    onDuplicate={n => handleDuplicateNote(dateKey!, n)}
                                />
                            ))
                        ) : dayNotes.length > 0 ? (
                            <div className={cl("empty-state")}>
                                <div className={cl("empty-title")}>No matching notes</div>
                                <div className={cl("empty-sub")}>No notes in category "{CATEGORY_DEFS[categoryFilter]?.label ?? categoryFilter}" for this date.</div>
                            </div>
                        ) : (
                            <div className={cl("empty-state")}>
                                <CalendarIcon className={cl("empty-icon")} style={{ width: 32, height: 32 }} />
                                <div className={cl("empty-title")}>No notes for this date</div>
                                <div className={cl("empty-sub")}>Add a note above to keep track of reminders and timestamps.</div>
                            </div>
                        )}
                    </ScrollerThin>
                </div>
            </div>

            {editNote && (
                <EditModal
                    note={editNote}
                    onSave={handleEditSave}
                    onClose={() => setEditNote(null)}
                />
            )}

            {showGoogleSyncModal && (
                <GoogleSyncModal
                    onClose={() => setShowGoogleSyncModal(false)}
                    onSyncComplete={gn => {
                        setGoogleNotesMap(gn);
                    }}
                    onClearComplete={() => {
                        setGoogleNotesMap({});
                    }}
                />
            )}
        </ModalRoot>
    );
}

let modalKey: string | null = null;
function toggleCalendar() {
    if (modalKey) {
        closeModal(modalKey);
        modalKey = null;
        return;
    }
    modalKey = openModal(
        (props: any) => (
            <CalendarModal
                {...props}
                onClose={() => {
                    if (modalKey) closeModal(modalKey);
                    modalKey = null;
                }}
            />
        ),
        {
            onCloseCallback: () => {
                modalKey = null;
            }
        }
    );
}

function CalendarButton() {
    return <HeaderBarButton icon={CalendarIcon} tooltip="Calendar" selected={modalKey != null} onClick={toggleCalendar} />;
}

export default definePlugin({
    id: "calendar",
    name: "Calendar",
    description: "Full-featured calendar with notes, categories, colors, recurring events, reminders, search, import/export and Discord timestamps.",
    tags: ["Utility"],
    authors: [{ name: "x2b", id: 996137713432530976n }],
    dependencies: ["HeaderBarAPI"],
    settings,
    headerBarButton: { icon: CalendarIcon, render: CalendarButton, priority: 1000 },
    start() { },
    stop() { if (modalKey) modalKey = null; },
});
