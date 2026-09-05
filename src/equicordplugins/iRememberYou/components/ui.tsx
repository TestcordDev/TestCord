/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { SettingsTab, wrapTab } from "@components/settings";
import { classNameFactory } from "@utils/css";
import { copyWithToast, openUserProfile } from "@utils/discord";
import { Avatar, Button, React, TextInput, Tooltip, useCallback, useEffect, useMemo, useRef, useState } from "@webpack/common";

import { Data, IStorageUser } from "./data";

const cl = classNameFactory("vc-i-remember-you-");

type GroupFilter = "ALL" | "SERVERS" | "DMS";

function formatUpdatedAt(updatedAt?: number) {
    if (!updatedAt) return "unknown";
    try {
        return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(updatedAt);
    } catch {
        return new Date(updatedAt).toLocaleString();
    }
}

function UserCard({ user, sourceName }: { user: IStorageUser; sourceName?: string; }) {
    const displayName = user.username || user.tag;
    const handle = user.tag && user.tag !== user.username ? `@${user.tag}` : `@${user.username ?? user.id}`;

    return (
        <div className={cl("user-card")}>
            <div className={cl("user-info")}>
                <span className={cl("user-avatar")}>
                    <Avatar src={user.iconURL} size="SIZE_40" />
                </span>
                <div className={cl("user-names")}>
                    <Tooltip text={`${displayName}, updated ${formatUpdatedAt(user.extra?.updatedAt)}`}>
                        {props => (
                            <span {...props} className={cl("user-display")}>
                                <span className={cl("user-display-text")}>{displayName}</span>
                                {user.extra?.isOwner && <span className={cl("owner-badge")}>owner</span>}
                            </span>
                        )}
                    </Tooltip>
                    <span className={cl("user-handle")}>{handle}</span>
                    <ClickableId id={user.id} />
                    {sourceName && <span className={cl("user-source")}>{sourceName}</span>}
                </div>
            </div>
            <div className={cl("user-actions")}>
                <Button
                    className={cl("btn")}
                    size={Button.Sizes.SMALL}
                    color={Button.Colors.PRIMARY}
                    onClick={() => openUserProfile(user.id)}
                >
                    Profile
                </Button>
                <Button
                    className={cl("btn")}
                    size={Button.Sizes.SMALL}
                    color={Button.Colors.PRIMARY}
                    onClick={() => copyWithToast(user.id, "User ID copied to clipboard")}
                >
                    Copy ID
                </Button>
            </div>
        </div>
    );
}

function ClickableId({ id }: { id: string; }) {
    return (
        <button
            type="button"
            title="Click to copy"
            className={cl("id-tag")}
            onClick={() => copyWithToast(id, "Copied to clipboard")}
        >
            {id}
        </button>
    );
}

function GroupSection({ groupKey, name, id, users }: { groupKey: string; name: string; id: string; users: IStorageUser[]; }) {
    const isGuild = groupKey !== "dm" && id !== "dm";
    const [collapsed, setCollapsed] = useState(false);

    return (
        <div className={cl("group-card")}>
            <div className={cl("group-header")}>
                <button type="button" className={cl("group-title")} onClick={() => setCollapsed(v => !v)} aria-expanded={!collapsed}>
                    <span className={cl("group-caret", { collapsed })}>▾</span>
                    <span className={cl("group-name")}>{name}</span>
                    <span className={cl("group-count")}>{users.length}</span>
                </button>
                <div className={cl("group-actions")}>
                    {isGuild && (
                        <Button
                            className={cl("btn")}
                            size={Button.Sizes.SMALL}
                            color={Button.Colors.PRIMARY}
                            onClick={() => copyWithToast(id, "Server ID copied to clipboard")}
                        >
                            Copy Server ID
                        </Button>
                    )}
                </div>
            </div>
            <div className={cl("user-grid-wrapper", { collapsed })} aria-hidden={collapsed}>
                <div className={cl("user-grid-inner")}>
                    <div className={cl("user-grid")}>
                        {users.map(u => <UserCard key={u.id} user={u} />)}
                    </div>
                </div>
            </div>
        </div>
    );
}

export function DataUI({ usersCollection }: { usersCollection: Data["usersCollection"]; }) {
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState<GroupFilter>("ALL");

    const filtersRef = useRef<HTMLDivElement>(null);
    const [pillStyle, setPillStyle] = useState<React.CSSProperties>({ opacity: 0 });

    const updatePill = useCallback(() => {
        const el = filtersRef.current?.querySelector<HTMLButtonElement>(`.${cl("filter-btn", { active: true }).split(" ").join(".")}`);
        if (el) {
            setPillStyle({
                left: `${el.offsetLeft}px`,
                width: `${el.offsetWidth}px`,
                height: `${el.offsetHeight}px`,
                opacity: 1
            });
        }
    }, []);

    useEffect(() => {
        updatePill();
        const t = setTimeout(updatePill, 50);
        return () => clearTimeout(t);
    }, [filter, updatePill]);

    const groups = useMemo(() => {
        const cols = usersCollection ?? {};
        return Object.entries(cols)
            .map(([key, { users, name, id }]) => ({
                key,
                id: id || key,
                name: name || (key === "dm" ? "Direct Messages" : key),
                users: Object.values(users ?? {})
            }))
            .filter(g => {
                if (filter === "DMS") return g.key === "dm" || g.id === "dm";
                if (filter === "SERVERS") return g.key !== "dm" && g.id !== "dm";
                return true;
            })
            .sort((a, b) => b.users.length - a.users.length);
    }, [usersCollection, filter]);

    const totalUsers = useMemo(() => {
        const seen = new Set<string>();
        for (const g of Object.values(usersCollection ?? {})) {
            for (const u of Object.values(g?.users ?? {})) {
                if (u?.id) seen.add(u.id);
            }
        }
        return seen.size;
    }, [usersCollection]);

    const totalGroups = Object.keys(usersCollection ?? {}).length;

    const searchResults = useMemo(() => {
        const q = query.toLowerCase().trim();
        if (!q) return null;
        const map = new Map<string, { user: IStorageUser; sourceName: string; }>();
        for (const g of Object.values(usersCollection ?? {})) {
            for (const user of Object.values(g?.users ?? {})) {
                if (!user?.id || map.has(user.id)) continue;
                const matches =
                    (user.tag?.toLowerCase().includes(q)) ||
                    (user.username?.toLowerCase().includes(q)) ||
                    user.id.includes(q);
                if (matches) map.set(user.id, { user, sourceName: g?.name ?? "" });
            }
        }
        return Array.from(map.values());
    }, [usersCollection, query]);

    const shownCount = searchResults ? searchResults.length : groups.reduce((n, g) => n + g.users.length, 0);

    return (
        <SettingsTab>
            <div className={cl("tab")}>
                <div className={cl("header")}>
                    <div className={cl("title-row")}>
                        <div className={cl("title-group")}>
                            <h2>I Remember You</h2>
                            <span className={cl("count-badge")}>
                                {shownCount} / {totalUsers} users · {totalGroups} servers
                            </span>
                        </div>
                    </div>
                    <p className={cl("description")}>
                        Everyone you've mentioned or replied to, plus server owners (owner) and members of servers you own.
                    </p>
                    <div className={cl("controls")}>
                        <div className={cl("input-wrapper")}>
                            <TextInput
                                value={query}
                                onChange={setQuery}
                                placeholder="Search by tag, username, or user ID..."
                            />
                        </div>
                        <div className={cl("filters")} ref={filtersRef}>
                            <div className={cl("slider-pill")} style={pillStyle} />
                            {(["ALL", "SERVERS", "DMS"] as GroupFilter[]).map(f => (
                                <button
                                    key={f}
                                    type="button"
                                    className={cl("filter-btn", { active: filter === f })}
                                    onClick={() => setFilter(f)}
                                >
                                    {f === "ALL" ? `All (${totalGroups})` : f === "SERVERS" ? "Servers" : "DMs"}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {searchResults ? (
                    searchResults.length === 0 ? (
                        <div className={cl("empty-state")}>
                            <h3>No users found</h3>
                            <span>Try matching a different keyword or user ID.</span>
                        </div>
                    ) : (
                        <div className={cl("group-card")}>
                            <div className={cl("group-header")}>
                                <span className={cl("group-title")}>
                                    <span className={cl("group-name")}>Search results</span>
                                    <span className={cl("group-count")}>{searchResults.length}</span>
                                </span>
                            </div>
                            <div className={cl("user-grid")}>
                                {searchResults.map(({ user, sourceName }) => (
                                    <UserCard key={user.id} user={user} sourceName={sourceName} />
                                ))}
                            </div>
                        </div>
                    )
                ) : groups.length === 0 ? (
                    <div className={cl("empty-state")}>
                        <h3>It's empty right now</h3>
                        <span>Mention or reply to someone and they'll show up here.</span>
                    </div>
                ) : (
                    <div className={cl("groups")}>
                        {groups.map(g => (
                            <GroupSection key={g.key} groupKey={g.key} name={g.name} id={g.id} users={g.users} />
                        ))}
                    </div>
                )}
            </div>
        </SettingsTab>
    );
}

export default wrapTab(DataUI, "IRememberYouTab");
