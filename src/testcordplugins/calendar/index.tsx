/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { HeaderBarButton } from "@api/HeaderBar";
import { DataStore } from "@api/index";
import { classNameFactory } from "@utils/css";
import { copyWithToast } from "@utils/discord";
import { closeModal, ModalContent, openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { Modal, moment, React, useEffect, useRef, useState } from "@webpack/common";

const cl = classNameFactory("vc-cal-");

const STORE_KEY = "Calendar_notes";

interface CalendarNote {
    id: string;
    text: string;
    timestamp: number;
    format: string;
}

type NotesMap = Record<string, CalendarNote[]>;

async function loadNotes(): Promise<NotesMap> {
    return (await DataStore.get(STORE_KEY)) ?? {};
}

async function saveNotes(notes: NotesMap): Promise<void> {
    await DataStore.set(STORE_KEY, notes);
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

function formatDiscordTimestamp(ts: number, discordTag: string): string {
    return `<t:${Math.floor(ts / 1000)}:${discordTag}>`;
}

function CalendarIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" {...props}>
            <path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM9 10H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2z" />
        </svg>
    );
}

function ChevronLeft(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" {...props}>
            <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
        </svg>
    );
}

function ChevronRight(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" {...props}>
            <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
        </svg>
    );
}

function PlusIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" {...props}>
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
        </svg>
    );
}

function TrashIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" {...props}>
            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
        </svg>
    );
}

function CopyIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" {...props}>
            <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
        </svg>
    );
}

function CalendarGrid({ year, month, selectedDay, notesMap, onDayClick }: {
    year: number;
    month: number;
    selectedDay: number | null;
    notesMap: NotesMap;
    onDayClick: (day: number) => void;
}) {
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();

    const cells: React.ReactNode[] = [];
    for (let i = 0; i < firstDay; i++) {
        cells.push(<div key={`empty-${i}`} className={cl("day-cell", "empty")} />);
    }

    for (let d = 1; d <= daysInMonth; d++) {
        const dateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const hasNotes = (notesMap[dateKey]?.length ?? 0) > 0;
        const isToday = d === today.getDate() && month === today.getMonth() && year === today.getFullYear();
        const isSelected = d === selectedDay;

        cells.push(
            <div
                key={d}
                className={cl("day-cell", {
                    today: isToday,
                    selected: isSelected,
                    "has-notes": hasNotes,
                })}
                onClick={() => onDayClick(d)}
            >
                <span>{d}</span>
                {hasNotes && <div className={cl("note-dot")} />}
            </div>
        );
    }

    return <div className={cl("grid")}>{cells}</div>;
}

function NoteCard({ note, onDelete }: { note: CalendarNote; onDelete: (id: string) => void; }) {
    const mmt = moment(note.timestamp);
    const fmt = TIMESTAMP_FORMATS.find(f => f.discord === note.format);
    const displayTime = fmt
        ? (fmt.discord === "R"
            ? mmt.fromNow()
            : fmt.discord === "U"
                ? mmt.format("MM/DD/YYYY h:mm A")
                : mmt.format(fmt.moment))
        : mmt.format("MM/DD/YYYY h:mm A");

    return (
        <div className={cl("note-card")}>
            <div className={cl("note-header")}>
                <span className={cl("note-time")}>{displayTime}</span>
                <div className={cl("note-actions")}>
                    <button
                        className={cl("note-action-btn")}
                        onClick={() => copyWithToast(formatDiscordTimestamp(note.timestamp, note.format))}
                        title="Copy Discord timestamp"
                    >
                        <CopyIcon />
                    </button>
                    <button
                        className={cl("note-action-btn", "delete")}
                        onClick={() => onDelete(note.id)}
                        title="Delete note"
                    >
                        <TrashIcon />
                    </button>
                </div>
            </div>
            {note.text && <div className={cl("note-text")}>{note.text}</div>}
            <div className={cl("note-discord-ts")}>
                {displayTime}
            </div>
        </div>
    );
}

function AddNoteForm({ onAdd, defaultTimestamp }: {
    onAdd: (text: string, format: string) => void;
    defaultTimestamp: number;
}) {
    const [text, setText] = useState("");
    const [format, setFormat] = useState("f");
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => { inputRef.current?.focus(); }, []);

    const handleSubmit = () => {
        if (!text.trim()) return;
        onAdd(text.trim(), format);
        setText("");
    };

    const selectedFmt = TIMESTAMP_FORMATS.find(f => f.discord === format);
    const previewText = selectedFmt
        ? (format === "R"
            ? moment(defaultTimestamp).fromNow()
            : format === "U"
                ? String(Math.floor(defaultTimestamp / 1000))
                : moment(defaultTimestamp).format(selectedFmt.moment))
        : "";

    return (
        <div className={cl("add-form")}>
            <input
                ref={inputRef}
                className={cl("add-input")}
                placeholder="Add a note..."
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSubmit()}
            />
            <div className={cl("add-row")}>
                <select
                    className={cl("format-select")}
                    value={format}
                    onChange={e => setFormat(e.target.value)}
                >
                    {TIMESTAMP_FORMATS.map(f => (
                        <option key={f.discord} value={f.discord}>{f.label}</option>
                    ))}
                </select>
                <button
                    className={cl("add-btn")}
                    onClick={handleSubmit}
                    disabled={!text.trim()}
                >
                    <PlusIcon /> Add
                </button>
            </div>
            {selectedFmt && (
                <div className={cl("preview")}>
                    Preview: <code>{previewText}</code>
                </div>
            )}
        </div>
    );
}

function NotesPanel({ dateKey, notesMap, onUpdate }: {
    dateKey: string;
    notesMap: NotesMap;
    onUpdate: (notes: NotesMap) => void;
}) {
    const notes = notesMap[dateKey] ?? [];
    const [year, month, day] = dateKey.split("-").map(Number);
    const dateObj = new Date(year, month - 1, day);
    const dayName = dateObj.toLocaleDateString("en-US", { weekday: "long" });
    const monthName = dateObj.toLocaleDateString("en-US", { month: "long" });

    const handleAdd = async (text: string, format: string) => {
        const newNote: CalendarNote = {
            id: crypto.randomUUID(),
            text,
            timestamp: dateObj.getTime(),
            format,
        };
        const updated = { ...notesMap, [dateKey]: [...notes, newNote] };
        await saveNotes(updated);
        onUpdate(updated);
    };

    const handleDelete = async (id: string) => {
        const updated = { ...notesMap, [dateKey]: notes.filter(n => n.id !== id) };
        if (updated[dateKey].length === 0) delete updated[dateKey];
        await saveNotes(updated);
        onUpdate(updated);
    };

    return (
        <div className={cl("notes-panel")}>
            <div className={cl("notes-header")}>
                <div className={cl("notes-date")}>
                    <span className={cl("notes-day-name")}>{dayName}</span>
                    <span className={cl("notes-date-full")}>{monthName} {day}, {year}</span>
                </div>
            </div>
            <AddNoteForm onAdd={handleAdd} defaultTimestamp={dateObj.getTime()} />
            {notes.length > 0 ? (
                <div className={cl("notes-list")}>
                    {notes.map(note => (
                        <NoteCard key={note.id} note={note} onDelete={handleDelete} />
                    ))}
                </div>
            ) : (
                <div className={cl("notes-empty")}>No notes for this day.</div>
            )}
        </div>
    );
}

function CalendarModal(props: any) {
    const now = new Date();
    const [year, setYear] = useState(now.getFullYear());
    const [month, setMonth] = useState(now.getMonth());
    const [selectedDay, setSelectedDay] = useState<number | null>(null);
    const [notesMap, setNotesMap] = useState<NotesMap>({});
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        loadNotes().then(n => { setNotesMap(n); setLoaded(true); });
    }, []);

    const monthName = new Date(year, month).toLocaleDateString("en-US", { month: "long", year: "numeric" });

    const prevMonth = () => {
        if (month === 0) { setMonth(11); setYear(y => y - 1); }
        else setMonth(m => m - 1);
        setSelectedDay(null);
    };

    const nextMonth = () => {
        if (month === 11) { setMonth(0); setYear(y => y + 1); }
        else setMonth(m => m + 1);
        setSelectedDay(null);
    };

    const goToday = () => {
        const t = new Date();
        setYear(t.getFullYear());
        setMonth(t.getMonth());
        setSelectedDay(t.getDate());
    };

    const dateKey = selectedDay != null
        ? `${year}-${String(month + 1).padStart(2, "0")}-${String(selectedDay).padStart(2, "0")}`
        : null;

    return (
        <Modal {...props} size="lg" title="Calendar" className={cl("modal-root")}>
            <ModalContent className={cl("modal-content")}>
                <div className={cl("layout")}>
                    <div className={cl("calendar-side")}>
                        <div className={cl("calendar-nav")}>
                            <button className={cl("nav-btn")} onClick={prevMonth}>
                                <ChevronLeft />
                            </button>
                            <button className={cl("month-label")} onClick={goToday}>
                                {monthName}
                            </button>
                            <button className={cl("nav-btn")} onClick={nextMonth}>
                                <ChevronRight />
                            </button>
                        </div>
                        <div className={cl("weekday-row")}>
                            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => (
                                <div key={d} className={cl("weekday")}>{d}</div>
                            ))}
                        </div>
                        {loaded && (
                            <CalendarGrid
                                year={year}
                                month={month}
                                selectedDay={selectedDay}
                                notesMap={notesMap}
                                onDayClick={setSelectedDay}
                            />
                        )}
                    </div>
                    <div className={cl("notes-side")}>
                        {dateKey ? (
                            <NotesPanel
                                dateKey={dateKey}
                                notesMap={notesMap}
                                onUpdate={setNotesMap}
                            />
                        ) : (
                            <div className={cl("notes-placeholder")}>
                                Select a day to view or add notes.
                            </div>
                        )}
                    </div>
                </div>
            </ModalContent>
        </Modal>
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
        (props: any) => <CalendarModal {...props} />,
        { onCloseCallback: () => { modalKey = null; } }
    );
}

function CalendarButton() {
    return (
        <HeaderBarButton
            icon={CalendarIcon}
            tooltip="Calendar"
            selected={modalKey != null}
            onClick={toggleCalendar}
        />
    );
}

export default definePlugin({
    name: "Calendar",
    description: "Calendar with notes and Discord timestamp management",
    tags: ["Utility"],
    authors: [{ name: "x2b", id: 996137713432530976n }],
    dependencies: ["HeaderBarAPI"],

    headerBarButton: {
        icon: CalendarIcon,
        render: CalendarButton,
        priority: 1000,
    },

    start() {},
    stop() {
        if (modalKey) { modalKey = null; }
    },
});
