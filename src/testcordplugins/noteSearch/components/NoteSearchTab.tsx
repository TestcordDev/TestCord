/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createStore, del, entries, set } from "@api/DataStore";
import { copyWithToast, openUserProfile } from "@utils/discord";
import { findByPropsLazy } from "@webpack";
import {
    Avatar, Button, React, RelationshipStore, RestAPI, TextInput, Toasts, UserProfileStore, UserStore, UserUtils,
    useCallback, useEffect, useMemo, useRef, useState
} from "@webpack/common";

import { deleteUserNotes as deletePluginNote, saveUserNotes as savePluginNote, usersNotes as userNotesPluginMap } from "../../userNotes/data";

const NotesStore = createStore("UserNotesData", "UserNotesStore");
const DiscordNoteStore = findByPropsLazy("getNote", "notes") ?? findByPropsLazy("getNote");

export type FilterStatus = "ALL" | "FRIENDS" | "BLOCKED";

interface UserProfileCache {
    username: string;
    globalName?: string | null;
    avatarUrl?: string;
}

export function NoteSearchTab() {
    const [notes, setNotes] = useState<Map<string, string>>(new Map());
    const [query, setQuery] = useState("");
    const [filterStatus, setFilterStatus] = useState<FilterStatus>("ALL");
    const [editedNotes, setEditedNotes] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [userCache, setUserCache] = useState<Map<string, UserProfileCache>>(new Map());

    const filtersContainerRef = useRef<HTMLDivElement>(null);
    const [pillStyle, setPillStyle] = useState<React.CSSProperties>({ opacity: 0 });

    const updatePillPosition = useCallback(() => {
        if (!filtersContainerRef.current) return;
        const activeBtn = filtersContainerRef.current.querySelector<HTMLButtonElement>('.vc-note-search-filter-btn.active');
        if (activeBtn) {
            setPillStyle({
                left: `${activeBtn.offsetLeft}px`,
                width: `${activeBtn.offsetWidth}px`,
                height: `${activeBtn.offsetHeight}px`,
                opacity: 1,
            });
        }
    }, []);

    useEffect(() => {
        updatePillPosition();
        const timeout = setTimeout(updatePillPosition, 50);
        return () => clearTimeout(timeout);
    }, [filterStatus, notes.size, updatePillPosition]);

    const loadNotes = useCallback(async () => {
        setLoading(true);
        const aggregated = new Map<string, string>();

        // 0. Load from Discord REST API endpoint (/users/@me/notes)
        try {
            const res = await RestAPI.get({ url: "/users/@me/notes" });
            const data = res?.body?.notes ?? res?.body;
            if (data) {
                const entriesArr = Array.isArray(data)
                    ? data.map(item => [item?.user_id ?? item?.id, item?.note ?? item?.text])
                    : Object.entries(data);

                for (const [id, val] of entriesArr) {
                    const text = typeof val === "string" ? val : (val && typeof (val as any).note === "string" ? (val as any).note : "");
                    if (id && typeof id === "string" && text && text.trim() !== "") {
                        aggregated.set(id, text.trim());
                    }
                }
            }
        } catch (e) {}

        // 1. Load from UserNotes plugin in-memory map
        try {
            if (userNotesPluginMap && userNotesPluginMap.size > 0) {
                for (const [id, note] of userNotesPluginMap.entries()) {
                    if (typeof note === "string" && note.trim() !== "") {
                        aggregated.set(id, note.trim());
                    }
                }
            }
        } catch (e) {}

        // 2. Load from UserNotesData DataStore (IndexedDB)
        try {
            const dbEntries = await entries(NotesStore);
            if (Array.isArray(dbEntries)) {
                for (const [id, userNote] of dbEntries) {
                    if (typeof id === "string" && typeof userNote === "string" && userNote.trim() !== "") {
                        if (!aggregated.has(id)) {
                            aggregated.set(id, userNote.trim());
                        }
                    }
                }
            }
        } catch (e) {}

        // 3. Load from Discord native NoteStore / UserProfileStore
        try {
            const store = DiscordNoteStore as any;
            if (store) {
                const nativeNotes = store.notes ?? (typeof store.getNotes === "function" ? store.getNotes() : null);
                if (nativeNotes) {
                    const entriesArr = nativeNotes instanceof Map
                        ? Array.from(nativeNotes.entries())
                        : Object.entries(nativeNotes);

                    for (const [id, val] of entriesArr) {
                        const text = typeof val === "string" ? val : (val && typeof (val as any).note === "string" ? (val as any).note : "");
                        if (typeof id === "string" && text && text.trim() !== "") {
                            if (!aggregated.has(id)) {
                                aggregated.set(id, text.trim());
                            }
                        }
                    }
                }

                // Check known friends/relationships for native notes
                if (typeof store.getNote === "function") {
                    const rels = (RelationshipStore as any).getRelationships?.() ?? (RelationshipStore as any).getFriendIDs?.() ?? {};
                    const usersObj = (UserStore as any)._users ?? {};
                    const candidateIds = new Set<string>([
                        ...(Array.isArray(rels) ? rels : Object.keys(rels)),
                        ...Object.keys(usersObj)
                    ]);

                    for (const id of candidateIds) {
                        if (!aggregated.has(id)) {
                            const res = store.getNote(id);
                            const text = typeof res === "string" ? res : (res?.note ?? "");
                            if (text && text.trim() !== "") {
                                aggregated.set(id, text.trim());
                            }
                        }
                    }
                }
            }
        } catch (e) {}

        // 4. Check cached UserProfileStore entries
        try {
            const usersObj = (UserStore as any)._users ?? {};
            for (const id of Object.keys(usersObj)) {
                if (!aggregated.has(id)) {
                    const prof = UserProfileStore?.getUserProfile?.(id) as any;
                    if (prof?.note && typeof prof.note === "string" && prof.note.trim() !== "") {
                        aggregated.set(id, prof.note.trim());
                    }
                }
            }
        } catch (e) {}

        setNotes(aggregated);
        setLoading(false);
    }, []);

    useEffect(() => {
        loadNotes();
    }, [loadNotes]);

    // Populate missing profile cache
    useEffect(() => {
        let isMounted = true;
        const fetchProfiles = async () => {
            const newCache = new Map(userCache);
            let updated = false;

            for (const userId of notes.keys()) {
                if (newCache.has(userId)) continue;

                const storeUser = UserStore.getUser(userId);
                if (storeUser) {
                    newCache.set(userId, {
                        username: storeUser.username,
                        globalName: (storeUser as any).globalName,
                    });
                    updated = true;
                } else {
                    try {
                        const fetched = await UserUtils.getUser(userId);
                        if (fetched) {
                            newCache.set(userId, {
                                username: fetched.username,
                                globalName: (fetched as any).globalName,
                            });
                            updated = true;
                        }
                    } catch {}
                }
            }

            if (isMounted && updated) {
                setUserCache(newCache);
            }
        };

        if (notes.size > 0) {
            fetchProfiles();
        }

        return () => {
            isMounted = false;
        };
    }, [notes]);

    const handleSaveNote = async (userId: string) => {
        const text = editedNotes[userId] ?? notes.get(userId) ?? "";
        const trimmed = text.trim();

        // Send REST request to update Discord native note
        try {
            await RestAPI.put({
                url: `/users/${userId}/note`,
                body: { note: trimmed }
            });
        } catch (e) {}

        if (trimmed === "") {
            await deletePluginNote(userId);
            await del(userId, NotesStore);
            setNotes(prev => {
                const next = new Map(prev);
                next.delete(userId);
                return next;
            });
            setEditedNotes(prev => {
                const next = { ...prev };
                delete next[userId];
                return next;
            });
            Toasts.show({ message: "Note removed", id: Toasts.genId(), type: Toasts.Type.SUCCESS });
        } else {
            await savePluginNote(userId, trimmed);
            await set(userId, trimmed, NotesStore);
            setNotes(prev => new Map(prev).set(userId, trimmed));
            setEditedNotes(prev => {
                const next = { ...prev };
                delete next[userId];
                return next;
            });
            Toasts.show({ message: "Note saved successfully", id: Toasts.genId(), type: Toasts.Type.SUCCESS });
        }
    };

    const handleDeleteNote = async (userId: string) => {
        // Send REST request to clear Discord native note
        try {
            await RestAPI.put({
                url: `/users/${userId}/note`,
                body: { note: "" }
            });
        } catch (e) {}

        await deletePluginNote(userId);
        await del(userId, NotesStore);
        setNotes(prev => {
            const next = new Map(prev);
            next.delete(userId);
            return next;
        });
        setEditedNotes(prev => {
            const next = { ...prev };
            delete next[userId];
            return next;
        });
        Toasts.show({ message: "Note deleted", id: Toasts.genId(), type: Toasts.Type.SUCCESS });
    };

    const filteredNotesList = useMemo(() => {
        const result: Array<{ userId: string; note: string; user?: any; cachedProfile?: UserProfileCache }> = [];
        const q = query.toLowerCase().trim();

        for (const [userId, note] of notes.entries()) {
            const isFriend = RelationshipStore.isFriend(userId);
            const isBlocked = RelationshipStore.isBlocked(userId);

            if (filterStatus === "FRIENDS" && !isFriend) continue;
            if (filterStatus === "BLOCKED" && !isBlocked) continue;

            const user = UserStore.getUser(userId);
            const cached = userCache.get(userId);

            const username = user?.username ?? cached?.username ?? "";
            const globalName = (user as any)?.globalName ?? cached?.globalName ?? "";

            const matchesQuery =
                !q ||
                userId.includes(q) ||
                note.toLowerCase().includes(q) ||
                username.toLowerCase().includes(q) ||
                globalName.toLowerCase().includes(q);

            if (matchesQuery) {
                result.push({ userId, note, user, cachedProfile: cached });
            }
        }

        return result;
    }, [notes, query, filterStatus, userCache]);

    return (
        <div className="vc-note-search-tab">
            <div className="vc-note-search-header">
                <div className="vc-note-search-title-row">
                    <div className="vc-note-search-title-group">
                        <h2>Note Search</h2>
                        <span className="vc-note-search-count-badge">
                            {filteredNotesList.length} / {notes.size} notes
                        </span>
                    </div>
                    <Button
                        className="vc-note-btn"
                        size={Button.Sizes.SMALL}
                        color={Button.Colors.PRIMARY}
                        onClick={loadNotes}
                    >
                        Refresh Notes
                    </Button>
                </div>

                <div className="vc-note-search-controls">
                    <div className="vc-note-search-input-wrapper">
                        <TextInput
                            value={query}
                            onChange={setQuery}
                            placeholder="Search by note content, username, global name, or user ID..."
                        />
                    </div>
                    <div className="vc-note-search-filters" ref={filtersContainerRef}>
                        <div className="vc-note-search-slider-pill" style={pillStyle} />
                        <button
                            type="button"
                            className={`vc-note-search-filter-btn ${filterStatus === "ALL" ? "active" : ""}`}
                            onClick={() => setFilterStatus("ALL")}
                        >
                            All ({notes.size})
                        </button>
                        <button
                            type="button"
                            className={`vc-note-search-filter-btn ${filterStatus === "FRIENDS" ? "active" : ""}`}
                            onClick={() => setFilterStatus("FRIENDS")}
                        >
                            Friends
                        </button>
                        <button
                            type="button"
                            className={`vc-note-search-filter-btn ${filterStatus === "BLOCKED" ? "active" : ""}`}
                            onClick={() => setFilterStatus("BLOCKED")}
                        >
                            Blocked
                        </button>
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="vc-note-empty-state">
                    <h3>Loading user notes...</h3>
                </div>
            ) : filteredNotesList.length === 0 ? (
                <div className="vc-note-empty-state">
                    <h3>No notes found</h3>
                    <span>{query ? "Try matching a different keyword or user ID." : "You haven't saved any user notes yet."}</span>
                </div>
            ) : (
                <div className="vc-note-grid">
                    {filteredNotesList.map(({ userId, note, user, cachedProfile }) => {
                        const currentText = editedNotes[userId] ?? note;
                        const isDirty = editedNotes[userId] !== undefined && editedNotes[userId] !== note;
                        const displayName = user ? ((user as any).globalName || user.username) : (cachedProfile?.globalName || cachedProfile?.username || "Unknown User");
                        const handleName = user ? `@${user.username}` : (cachedProfile?.username ? `@${cachedProfile.username}` : userId);

                        return (
                            <div key={userId} className="vc-note-card">
                                <div className="vc-note-card-header">
                                    <div className="vc-note-card-user-info">
                                        <Avatar
                                            src={user && typeof user.getAvatarURL === "function" ? user.getAvatarURL(null, 40) : undefined}
                                            size="SIZE_40"
                                        />
                                        <div className="vc-note-card-names">
                                            <span className="vc-note-card-display-name">{displayName}</span>
                                            <span className="vc-note-card-username">{handleName}</span>
                                            <span className="vc-note-card-id-tag">{userId}</span>
                                        </div>
                                    </div>
                                    <div className="vc-note-card-actions">
                                        {isDirty && (
                                            <Button
                                                className="vc-note-btn"
                                                size={Button.Sizes.SMALL}
                                                color={Button.Colors.GREEN}
                                                onClick={() => handleSaveNote(userId)}
                                            >
                                                Save
                                            </Button>
                                        )}
                                        <Button
                                            className="vc-note-btn"
                                            size={Button.Sizes.SMALL}
                                            color={Button.Colors.PRIMARY}
                                            onClick={() => openUserProfile(userId)}
                                        >
                                            Profile
                                        </Button>
                                        <Button
                                            className="vc-note-btn"
                                            size={Button.Sizes.SMALL}
                                            color={Button.Colors.PRIMARY}
                                            onClick={() => copyWithToast(currentText, "Note text copied to clipboard")}
                                        >
                                            Copy
                                        </Button>
                                        <Button
                                            className="vc-note-btn"
                                            size={Button.Sizes.SMALL}
                                            color={Button.Colors.RED}
                                            onClick={() => handleDeleteNote(userId)}
                                        >
                                            Delete
                                        </Button>
                                    </div>
                                </div>
                                <div className="vc-note-card-body">
                                    <textarea
                                        className="vc-note-textarea"
                                        value={currentText}
                                        onChange={e => setEditedNotes({ ...editedNotes, [userId]: e.target.value })}
                                        placeholder="Write a note..."
                                    />
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
