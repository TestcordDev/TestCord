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
import { closeModal,ModalContent, ModalFooter, ModalHeader, ModalRoot, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { Forms, Modal, moment, React, ScrollerThin, TextArea, TextInput, Tooltip, useEffect, useRef, useState } from "@webpack/common";

const cl = classNameFactory("vc-cal-");
const STORE_KEY = "Calendar_notes_v2";
const STORE_KEY_LEGACY = "Calendar_notes";

interface CalendarNote {
    id: string;
    text: string;
    timestamp: number;
    format: string;
    color: string;
    category: string;
    recurring: "none" | "daily" | "weekly" | "monthly" | "yearly";
    reminderMinutes?: number;
}

type NotesMap = Record<string, CalendarNote[]>;

const CATEGORY_DEFS: Record<string, { label: string; color: string; emoji: string; }> = {
    personal: { label: "Personal", color: "#5865f2", emoji: "👤" },
    work: { label: "Work", color: "#23a55a", emoji: "💼" },
    event: { label: "Event", color: "#f59e0b", emoji: "🎉" },
    reminder: { label: "Reminder", color: "#ef4444", emoji: "⏰" },
    birthday: { label: "Birthday", color: "#a855f7", emoji: "🎂" },
    other: { label: "Other", color: "#6b7280", emoji: "📌" },
};

const COLORS = ["#5865f2", "#23a55a", "#f59e0b", "#ef4444", "#a855f7", "#06b6d4", "#ec4899", "#6b7280"] as const;

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
        options: Object.entries(CATEGORY_DEFS).map(([v, d]) => ({ label: `${d.emoji} ${d.label}`, value: v, default: v === "personal" })),
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
async function saveNotes(notes: NotesMap): Promise<void> { await DataStore.set(STORE_KEY, notes); }

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

function formatDiscordTimestamp(ts: number, discordTag: string): string { return `<t:${Math.floor(ts / 1000)}:${discordTag}>`; }
function dateKeyOf(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function getWeekNumber(d: Date) {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil((((date as any) - (yearStart as any)) / 86400000 + 1) / 7);
}
function exportIcs(notesMap: NotesMap): string {
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Testcord//Calendar//EN", "CALSCALE:GREGORIAN"];
    for (const [key, arr] of Object.entries(notesMap)) {
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

function CalendarIcon(props: React.SVGProps<SVGSVGElement>) {
    return <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM9 10H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2z" /></svg>;
}
function ChevronLeft(p: React.SVGProps<SVGSVGElement>) { return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" /></svg>; }
function ChevronRight(p: React.SVGProps<SVGSVGElement>) { return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" /></svg>; }
function PlusIcon(p: React.SVGProps<SVGSVGElement>) { return <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" /></svg>; }
function TrashIcon(p: React.SVGProps<SVGSVGElement>) { return <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" /></svg>; }
function CopyIcon(p: React.SVGProps<SVGSVGElement>) { return <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" /></svg>; }
function EditIcon(p: React.SVGProps<SVGSVGElement>) { return <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" /></svg>; }

function CalendarGrid({ year, month, selectedDay, notesMap, onDayClick, onDayDouble }: {
    year: number; month: number; selectedDay: number | null; notesMap: NotesMap; onDayClick: (d: number) => void; onDayDouble?: (d: number) => void;
}) {
    const weekStartMonday = (() => { try { return settings.store.weekStartsOnMonday ?? false; } catch { return false; } })();
    const showWn = (() => { try { return settings.store.showWeekNumbers ?? false; } catch { return false; } })();
    const firstDayRaw = new Date(year, month, 1).getDay();
    const firstDay = weekStartMonday ? (firstDayRaw === 0 ? 6 : firstDayRaw - 1) : firstDayRaw;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();

    const cells: React.ReactNode[] = [];
    for (let i = 0; i < firstDay; i++) cells.push(<div key={`empty-${i}`} className={cl("day-cell", "empty")} />);

    for (let d = 1; d <= daysInMonth; d++) {
        const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const notes = notesMap[key] ?? [];
        const hasNotes = notes.length > 0;
        const isToday = d === today.getDate() && month === today.getMonth() && year === today.getFullYear();
        const isSelected = d === selectedDay;
        const catColor = hasNotes ? (CATEGORY_DEFS[notes[0].category]?.color ?? notes[0].color) : undefined;
        cells.push(
            <div
                key={d}
                className={cl("day-cell", { today: isToday, selected: isSelected, "has-notes": hasNotes })}
                onClick={() => onDayClick(d)}
                onDoubleClick={() => onDayDouble?.(d)}
                title={hasNotes ? `${notes.length} note${notes.length > 1 ? "s" : ""}: ${notes.map(n => n.text.slice(0, 24)).join(", ")}` : undefined}
            >
                <span>{d}</span>
                {hasNotes && <div className={cl("note-dot")} style={catColor ? { background: catColor } : undefined} />}
                {hasNotes && notes.length > 1 && <span className={cl("note-count")}>{notes.length}</span>}
            </div>
        );
    }
    // pad trailing
    const total = cells.length;
    const remainder = total % 7;
    if (remainder !== 0) for (let i = 0; i < 7 - remainder; i++) cells.push(<div key={`pad-${i}`} className={cl("day-cell", "empty")} />);

    if (showWn) {
        const rows: React.ReactNode[][] = [];
        for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
        return (
            <div className={cl("grid-with-wn")}>
                <div className={cl("wn-col")}>
                    {rows.map((_, idx) => {
                        const rowStart = idx * 7 - firstDay + 1;
                        const sampleDay = Math.max(1, Math.min(daysInMonth, rowStart + 3));
                        const d = new Date(year, month, sampleDay);
                        return <div key={idx} className={cl("wn-cell")}>{getWeekNumber(d)}</div>;
                    })}
                </div>
                <div className={cl("grid")}>{cells}</div>
            </div>
        );
    }
    return <div className={cl("grid")}>{cells}</div>;
}

function NoteCard({ note, onDelete, onEdit, onDuplicate }: { note: CalendarNote; onDelete: (id: string) => void; onEdit: (n: CalendarNote) => void; onDuplicate: (n: CalendarNote) => void; }) {
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

    return (
        <div className={cl("note-card")} style={{ borderLeftColor: note.color ?? cat.color }}>
            <div className={cl("note-header")}>
                <span className={cl("note-cat")} style={{ background: cat.color }}>{cat.emoji} {cat.label}</span>
                <span className={cl("note-time")}>{displayTime}</span>
                <div className={cl("note-actions")}>
                    <Tooltip text="Copy Discord timestamp">{(p: any) => <button {...p} className={cl("note-action-btn")} onClick={() => copyWithToast(formatDiscordTimestamp(note.timestamp, note.format))}><CopyIcon /></button>}</Tooltip>
                    <Tooltip text="Duplicate">{(p: any) => <button {...p} className={cl("note-action-btn")} onClick={() => onDuplicate(note)}><CopyIcon /></button>}</Tooltip>
                    <Tooltip text="Edit">{(p: any) => <button {...p} className={cl("note-action-btn")} onClick={() => onEdit(note)}><EditIcon /></button>}</Tooltip>
                    <button className={cl("note-action-btn", "delete")} onClick={() => onDelete(note.id)} title="Delete"><TrashIcon /></button>
                </div>
            </div>
            {note.text && <div className={cl("note-text")}>{note.text}</div>}
            <div className={cl("note-meta")}>
                <span className={cl("note-discord-ts")}>{formatDiscordTimestamp(note.timestamp, note.format)}</span>
                {note.recurring !== "none" && <span className={cl("recurring-badge")}>↻ {note.recurring}</span>}
                {note.reminderMinutes ? <span className={cl("reminder-badge")}>⏰ {note.reminderMinutes}m</span> : null}
            </div>
        </div>
    );
}

function AddNoteForm({ onAdd, defaultDate }: { onAdd: (data: Omit<CalendarNote, "id">) => void; defaultDate: Date; }) {
    const [text, setText] = useState("");
    const [format, setFormat] = useState("f");
    const [category, setCategory] = useState<string>(() => { try { return settings.store.defaultCategory ?? "personal"; } catch { return "personal"; } });
    const [color, setColor] = useState<string>(() => CATEGORY_DEFS[(() => { try { return settings.store.defaultCategory ?? "personal"; } catch { return "personal"; } })()]?.color ?? "#5865f2");
    const [hour, setHour] = useState<string>(() => String(defaultDate.getHours()).padStart(2, "0"));
    const [minute, setMinute] = useState<string>(() => String(defaultDate.getMinutes()).padStart(2, "0"));
    const [recurring, setRecurring] = useState<CalendarNote["recurring"]>("none");
    const [remind, setRemind] = useState<string>(() => { try { return settings.store.defaultRemind ?? "0"; } catch { return "0"; } });
    const inputRef = useRef<HTMLTextAreaElement>(null);
    useEffect(() => { inputRef.current?.focus(); }, []);

    useEffect(() => { const c = CATEGORY_DEFS[category]; if (c) setColor(c.color); }, [category]);

    const handleSubmit = () => {
        if (!text.trim()) return;
        const h = Math.min(23, Math.max(0, parseInt(hour) || 0));
        const m = Math.min(59, Math.max(0, parseInt(minute) || 0));
        const ts = new Date(defaultDate); ts.setHours(h, m, 0, 0);
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
    };

    const previewTs = (() => {
        const h = parseInt(hour) || 0; const m = parseInt(minute) || 0;
        const d = new Date(defaultDate); d.setHours(h, m, 0, 0); return d.getTime();
    })();
    const selFmt = TIMESTAMP_FORMATS.find(f => f.discord === format);
    const preview = selFmt ? (format === "R" ? moment(previewTs).fromNow() : format === "U" ? String(Math.floor(previewTs / 1000)) : moment(previewTs).format(selFmt.moment)) : "";

    return (
        <div className={cl("add-form")}>
            <TextArea
                ref={inputRef as any}
                placeholder="Add a note… (Shift+Enter for newline)"
                value={text}
                onChange={v => setText(v)}
                rows={2}
            />
            <div className={cl("add-row")}>
                <select className={cl("format-select")} value={category} onChange={e => setCategory(e.target.value)}>
                    {Object.entries(CATEGORY_DEFS).map(([k, v]) => <option key={k} value={k}>{v.emoji} {v.label}</option>)}
                </select>
                <div className={cl("color-dots")}>
                    {COLORS.map(c => (
                        <button key={c} className={cl("color-dot", { active: color === c })} style={{ background: c }} onClick={() => setColor(c)} />
                    ))}
                </div>
            </div>
            <div className={cl("add-row")}>
                <input className={cl("time-input")} type="number" min={0} max={23} value={hour} onChange={e => setHour(e.target.value)} />
                <span>:</span>
                <input className={cl("time-input")} type="number" min={0} max={59} value={minute} onChange={e => setMinute(e.target.value)} />
                <select className={cl("format-select")} value={format} onChange={e => setFormat(e.target.value)}>
                    {TIMESTAMP_FORMATS.map(f => <option key={f.discord} value={f.discord}>{f.label}</option>)}
                </select>
            </div>
            <div className={cl("add-row")}>
                <select className={cl("format-select")} value={recurring} onChange={e => setRecurring(e.target.value as any)}>
                    <option value="none">No repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option>
                </select>
                <select className={cl("format-select")} value={remind} onChange={e => setRemind(e.target.value)}>
                    <option value="0">No reminder</option><option value="5">5m before</option><option value="15">15m before</option><option value="60">1h before</option><option value="1440">1d before</option>
                </select>
                <Button size="small" variant="primary" onClick={handleSubmit} disabled={!text.trim()}><PlusIcon /> Add</Button>
            </div>
            {selFmt && <div className={cl("preview")}>Preview: <code>{preview}</code> <code>{formatDiscordTimestamp(previewTs, format)}</code></div>}
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

    return (
        <ModalRoot size="small">
            <ModalHeader>
                <Forms.FormTitle tag="h2">Edit note</Forms.FormTitle>
                <Button variant="secondary" size="small" onClick={onClose}>Close</Button>
            </ModalHeader>
            <ModalContent className={cl("edit-modal")}>
                <Forms.FormTitle>Text</Forms.FormTitle>
                <TextArea value={text} onChange={setText} rows={3} />
                <div className={cl("edit-row")}>
                    <Forms.FormTitle>Category</Forms.FormTitle>
                    <select className={cl("format-select")} value={cat} onChange={e => { setCat(e.target.value); const c = CATEGORY_DEFS[e.target.value]; if (c) setColor(c.color); }}>
                        {Object.entries(CATEGORY_DEFS).map(([k, v]) => <option key={k} value={k}>{v.emoji} {v.label}</option>)}
                    </select>
                </div>
                <div className={cl("color-dots")}>{COLORS.map(c => <button key={c} className={cl("color-dot", { active: color === c })} style={{ background: c }} onClick={() => setColor(c)} />)}</div>
                <div className={cl("add-row")}>
                    <input className={cl("time-input")} value={h} onChange={e => setH(e.target.value)} type="number" min={0} max={23} />
                    <span>:</span>
                    <input className={cl("time-input")} value={mi} onChange={e => setMi(e.target.value)} type="number" min={0} max={59} />
                    <select className={cl("format-select")} value={fmt} onChange={e => setFmt(e.target.value)}>{TIMESTAMP_FORMATS.map(f => <option key={f.discord} value={f.discord}>{f.label}</option>)}</select>
                </div>
                <select className={cl("format-select")} value={rec} onChange={e => setRec(e.target.value as any)}>
                    <option value="none">No repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option>
                </select>
            </ModalContent>
            <ModalFooter>
                <Button variant="secondary" onClick={onClose}>Cancel</Button>
                <Button variant="primary" onClick={() => {
                    const nd = new Date(note.timestamp); nd.setHours(parseInt(h) || 0, parseInt(mi) || 0, 0, 0);
                    onSave({ ...note, text, category: cat, color, format: fmt, recurring: rec, timestamp: nd.getTime() });
                    onClose();
                }}>Save</Button>
            </ModalFooter>
        </ModalRoot>
    );
}

function NotesPanel({ dateKey, notesMap, onUpdate }: { dateKey: string; notesMap: NotesMap; onUpdate: (n: NotesMap) => void; }) {
    const notes = notesMap[dateKey] ?? [];
    const [search, setSearch] = useState("");
    const [edit, setEdit] = useState<CalendarNote | null>(null);
    const [year, month, day] = dateKey.split("-").map(Number);
    const dateObj = new Date(year, month - 1, day);
    const dayName = dateObj.toLocaleDateString("en-US", { weekday: "long" });
    const monthName = dateObj.toLocaleDateString("en-US", { month: "long" });

    const filtered = notes.filter(n => !search.trim() || n.text.toLowerCase().includes(search.toLowerCase()) || CATEGORY_DEFS[n.category]?.label.toLowerCase().includes(search.toLowerCase()));

    const handleAdd = async (data: Omit<CalendarNote, "id">) => {
        const newNote: CalendarNote = { id: crypto.randomUUID(), ...data };
        const updated = { ...notesMap, [dateKey]: [...notes, newNote] };
        await saveNotes(updated); onUpdate(updated);
    };
    const handleDelete = async (id: string) => {
        const updated = { ...notesMap, [dateKey]: notes.filter(n => n.id !== id) };
        if (updated[dateKey].length === 0) delete updated[dateKey];
        await saveNotes(updated); onUpdate(updated);
    };
    const handleEditSave = async (updatedNote: CalendarNote) => {
        const updated = { ...notesMap, [dateKey]: notes.map(n => n.id === updatedNote.id ? updatedNote : n) };
        await saveNotes(updated); onUpdate(updated);
    };
    const handleDuplicate = async (n: CalendarNote) => {
        const dup: CalendarNote = { ...n, id: crypto.randomUUID(), text: n.text + " (copy)" };
        const updated = { ...notesMap, [dateKey]: [...notes, dup] };
        await saveNotes(updated); onUpdate(updated);
    };
    const clearDay = async () => {
        if (!confirm(`Delete all ${notes.length} notes for this day?`)) return;
        const updated = { ...notesMap }; delete updated[dateKey];
        await saveNotes(updated); onUpdate(updated);
    };

    return (
        <div className={cl("notes-panel")}>
            <div className={cl("notes-header")}>
                <div className={cl("notes-date")}>
                    <span className={cl("notes-day-name")}>{dayName}</span>
                    <span className={cl("notes-date-full")}>{monthName} {day}, {year}</span>
                    <span className={cl("notes-count")}>{notes.length} note{notes.length !== 1 ? "s" : ""}</span>
                </div>
                {notes.length > 0 && <Button size="xs" variant="secondary" onClick={clearDay}>Clear day</Button>}
            </div>
            <TextInput value={search} onChange={setSearch} placeholder="Search notes…" />
            <AddNoteForm onAdd={handleAdd} defaultDate={dateObj} />
            {filtered.length > 0 ? (
                <ScrollerThin className={cl("notes-list")}>
                    {filtered.map(note => <NoteCard key={note.id} note={note} onDelete={handleDelete} onEdit={n => setEdit(n)} onDuplicate={handleDuplicate} />)}
                </ScrollerThin>
            ) : notes.length ? (
                <div className={cl("notes-empty")}>No results for “{search}”</div>
            ) : (
                <div className={cl("notes-empty")}>No notes for this day. Add one above.</div>
            )}
            {edit && <EditModal note={edit} onSave={handleEditSave} onClose={() => setEdit(null)} />}
        </div>
    );
}

function AgendaView({ notesMap }: { notesMap: NotesMap; }) {
    const items = Object.entries(notesMap).flatMap(([k, arr]) => arr.map(n => ({ key: k, note: n })))
        .filter(x => x.note.timestamp >= Date.now() - 1000 * 60 * 60 * 24)
        .sort((a, b) => a.note.timestamp - b.note.timestamp)
        .slice(0, 12);
    if (!items.length) return <div className={cl("agenda-empty")}>No upcoming events.</div>;
    return (
        <div className={cl("agenda-list")}>
            {items.map(({ note }) => {
                const cat = CATEGORY_DEFS[note.category] ?? CATEGORY_DEFS.other;
                return (
                    <div key={note.id} className={cl("agenda-item")} style={{ borderLeftColor: note.color ?? cat.color }}>
                        <div className={cl("agenda-date")}>{new Date(note.timestamp).toLocaleDateString()} {new Date(note.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                        <div className={cl("agenda-text")}>{note.text}</div>
                        <div className={cl("agenda-cat")}>{cat.emoji} {cat.label}</div>
                    </div>
                );
            })}
        </div>
    );
}

function CalendarModal(props: any) {
    const now = new Date();
    const [year, setYear] = useState(now.getFullYear());
    const [month, setMonth] = useState(now.getMonth());
    const [selectedDay, setSelectedDay] = useState<number | null>(now.getDate());
    const [notesMap, setNotesMap] = useState<NotesMap>({});
    const [loaded, setLoaded] = useState(false);
    const [globalSearch, setGlobalSearch] = useState("");
    const [agendaOpen, setAgendaOpen] = useState(false);
    const [showYearPicker, setShowYearPicker] = useState(false);

    useEffect(() => { loadNotes().then(n => { setNotesMap(n); setLoaded(true); }); }, []);

    // reminders check every minute
    useEffect(() => {
        const id = setInterval(() => {
            const nowMs = Date.now();
            for (const arr of Object.values(notesMap)) {
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
    }, [notesMap]);

    const monthName = new Date(year, month).toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const weekStartMonday = (() => { try { return settings.store.weekStartsOnMonday; } catch { return false; } })();
    const weekdays = weekStartMonday ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    const prevMonth = () => { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); setSelectedDay(null); };
    const nextMonth = () => { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); setSelectedDay(null); };
    const goToday = () => { const t = new Date(); setYear(t.getFullYear()); setMonth(t.getMonth()); setSelectedDay(t.getDate()); };

    const dateKey = selectedDay != null ? `${year}-${String(month + 1).padStart(2, "0")}-${String(selectedDay).padStart(2, "0")}` : null;

    const handleExportJson = () => {
        const blob = new Blob([JSON.stringify(notesMap, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `calendar-${Date.now()}.json`; a.click(); URL.revokeObjectURL(url);
    };
    const handleExportIcs = () => {
        const ics = exportIcs(notesMap);
        const blob = new Blob([ics], { type: "text/calendar" });
        const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `calendar-${Date.now()}.ics`; a.click(); URL.revokeObjectURL(url);
    };
    const handleImportJson = () => {
        const input = document.createElement("input"); input.type = "file"; input.accept = ".json";
        input.onchange = async () => {
            const file = input.files?.[0]; if (!file) return;
            try {
                const text = await file.text(); const parsed = JSON.parse(text);
                await saveNotes(parsed); setNotesMap(parsed);
                copyWithToast("Imported calendar data");
            } catch { copyWithToast("Import failed"); }
        };
        input.click();
    };
    const clearAll = async () => {
        if (!confirm("Delete ALL calendar notes? This cannot be undone.")) return;
        await DataStore.del(STORE_KEY); setNotesMap({});
    };

    const globalResults = (() => {
        if (!globalSearch.trim()) return [];
        const q = globalSearch.toLowerCase();
        return Object.entries(notesMap).flatMap(([k, arr]) => arr.filter(n => n.text.toLowerCase().includes(q) || k.includes(q)).map(n => ({ key: k, note: n }))).slice(0, 20);
    })();

    return (
        <Modal {...props} size="lg" title="Calendar — Testcord" className={cl("modal-root")}>
            <ModalContent className={cl("modal-content")}>
                <div className={cl("toolbar")}>
                    <TextInput value={globalSearch} onChange={setGlobalSearch} placeholder="Search all notes…" className={cl("global-search")} />
                    <div className={cl("toolbar-actions")}>
                        <Tooltip text="Agenda (upcoming)">{(p: any) => <Button {...p} size="small" variant={agendaOpen ? "primary" : "secondary"} onClick={() => setAgendaOpen(v => !v)}>Agenda</Button>}</Tooltip>
                        <Button size="small" variant="secondary" onClick={handleExportJson}>Export JSON</Button>
                        <Button size="small" variant="secondary" onClick={handleExportIcs}>Export ICS</Button>
                        <Button size="small" variant="secondary" onClick={handleImportJson}>Import</Button>
                        <Button size="small" variant="dangerPrimary" onClick={clearAll}>Clear all</Button>
                    </div>
                </div>
                {globalSearch.trim() && (
                    <div className={cl("global-results")}>
                        {globalResults.length ? globalResults.map(({ key, note }) => (
                            <div key={note.id} className={cl("global-result")} onClick={() => {
                                const [y, m, d] = key.split("-").map(Number);
                                setYear(y); setMonth(m - 1); setSelectedDay(d); setGlobalSearch("");
                            }}>
                                <span className={cl("global-date")}>{key}</span>
                                <span className={cl("global-text")}>{note.text.slice(0, 80)}</span>
                                <span className={cl("global-cat")} style={{ background: note.color }}>{CATEGORY_DEFS[note.category]?.emoji}</span>
                            </div>
                        )) : <div className={cl("notes-empty")}>No matches.</div>}
                    </div>
                )}
                <div className={cl("layout")}>
                    <div className={cl("calendar-side")}>
                        <div className={cl("calendar-nav")}>
                            <Button size="small" variant="secondary" onClick={prevMonth}><ChevronLeft /></Button>
                            <button className={cl("month-label")} onClick={() => setShowYearPicker(v => !v)}>{monthName}</button>
                            <Button size="small" variant="secondary" onClick={nextMonth}><ChevronRight /></Button>
                            <Button size="small" variant="secondary" onClick={goToday}>Today</Button>
                        </div>
                        {showYearPicker && (
                            <div className={cl("year-picker")}>
                                <select value={month} onChange={e => setMonth(parseInt(e.target.value))} className={cl("format-select")}>
                                    {Array.from({ length: 12 }, (_, i) => <option key={i} value={i}>{new Date(2026, i).toLocaleDateString("en-US", { month: "long" })}</option>)}
                                </select>
                                <input type="number" value={year} onChange={e => setYear(parseInt(e.target.value) || year)} className={cl("time-input")} />
                            </div>
                        )}
                        <div className={cl("weekday-row")}>
                            {settings.store.showWeekNumbers && <div className={cl("weekday", "wn")} >Wk</div>}
                            {weekdays.map(d => <div key={d} className={cl("weekday")}>{d}</div>)}
                        </div>
                        {loaded && <CalendarGrid year={year} month={month} selectedDay={selectedDay} notesMap={notesMap} onDayClick={setSelectedDay} onDayDouble={d => setSelectedDay(d)} />}
                        {agendaOpen && <div className={cl("agenda-panel")}><div className={cl("agenda-title")}>Upcoming</div><AgendaView notesMap={notesMap} /></div>}
                        <div className={cl("calendar-footer")}>
                            <span className={cl("legend")}>{Object.values(CATEGORY_DEFS).map(c => <span key={c.label} className={cl("legend-item")}><span className={cl("legend-dot")} style={{ background: c.color }} />{c.label}</span>)}</span>
                            <span className={cl("hint")}>Double-click a day to add • Click to select</span>
                        </div>
                    </div>
                    <div className={cl("notes-side")}>
                        {dateKey ? <NotesPanel dateKey={dateKey} notesMap={notesMap} onUpdate={setNotesMap} /> : <div className={cl("notes-placeholder")}>Select a day to view or add notes.</div>}
                    </div>
                </div>
            </ModalContent>
        </Modal>
    );
}

let modalKey: string | null = null;
function toggleCalendar() {
    if (modalKey) { closeModal(modalKey); modalKey = null; return; }
    modalKey = openModal((props: any) => <CalendarModal {...props} />, { onCloseCallback: () => { modalKey = null; } });
}
function CalendarButton() {
    return <HeaderBarButton icon={CalendarIcon} tooltip="Calendar" selected={modalKey != null} onClick={toggleCalendar} />;
}

export default definePlugin({
    id: "calendar",
    name: "Calendar",
    description: "Full-featured calendar with notes, categories, colors, recurring events, reminders, search, agenda, import/export and Discord timestamps.",
    tags: ["Utility"],
    authors: [{ name: "x2b", id: 996137713432530976n }],
    dependencies: ["HeaderBarAPI"],
    settings,
    headerBarButton: { icon: CalendarIcon, render: CalendarButton, priority: 1000 },
    start() {},
    stop() { if (modalKey) modalKey = null; },
});
