/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import ErrorBoundary from "@components/ErrorBoundary";
import SettingsPlugin from "@plugins/_core/settings";
import { getTestcordIconColor } from "@testcordplugins/TestcordHelper/iconColors";
import { TestcordDevs } from "@utils/constants";
import { removeFromArray } from "@utils/misc";
import definePlugin, { IconProps } from "@utils/types";
import { User } from "@vencord/discord-types";
import { findComponentByCodeLazy } from "@webpack";
import { Menu, TextArea, UserStore, useState } from "@webpack/common";

const HeaderBarIcon = findComponentByCodeLazy("iconClassName", "badge", '"aria-haspopup":');

import { PopupIcon } from "./components/Icons";
import { OpenNotesDataButton } from "./components/NotesDataButton";
import { openNotesDataModal } from "./components/NotesDataModal";
import { NoteSearchTab } from "./components/NoteSearchTab";
import { openUserNotesModal } from "./components/UserNotesModal";
import { cacheUsers, getUserNotes, saveUserNotes } from "./data";
import settings from "./settings";

const ENTRY_KEY = "testcord_note_search";

function NoteSearchIcon(props: IconProps & { color?: string; }) {
    return (
        <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke={props.color || "currentColor"}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            <circle cx="11" cy="10" r="3" />
            <path d="m16 15-2.5-2.5" />
        </svg>
    );
}

const patchUserContext: NavContextMenuPatchCallback = (children, { user }: {
    user: User;
}) => {
    if (!user) return;

    const contextGroup = findGroupChildrenByChildId("note", children);

    if (!contextGroup) return;

    const regularButtonIndex = contextGroup.findIndex(element => element?.props.id === "note");

    if (regularButtonIndex === -1) return;

    const newUserNotesButton = <Menu.MenuItem
        id="vc-open-user-notes"
        label="Open User Notes"
        action={() => {
            openUserNotesModal(user);
        }}
    />;

    if (settings.store.removeRegularButton) {
        contextGroup.splice(regularButtonIndex, 1, newUserNotesButton);
    } else {
        contextGroup.splice(regularButtonIndex + 1, 0, newUserNotesButton);
    }
};

function ProfileContainer({ user }: { user: User; }) {
    const [userNotes, setUserNotes] = useState(getUserNotes(user.id) ?? "");

    const iconColor = getTestcordIconColor("userAreaButtonIconColor") ?? "var(--interactive-normal)";

    return (
        <div className={"vc-user-notes-profile-container"}>
            <TextArea
                className={"vc-user-notes-profile-text-area"}
                placeholder="Click to add a note"
                value={userNotes}
                onChange={setUserNotes}
                onBlur={() => saveUserNotes(user.id, userNotes)}
            />
            <div style={{ "--vc-plugin-icon-color": iconColor } as React.CSSProperties}>
                <HeaderBarIcon
                    className="vc-plugin-icon-button vc-user-notes-profile-button"
                    iconClassName="vc-plugin-icon-button"
                    icon={PopupIcon}
                    onClick={() => openUserNotesModal(user)}
                    tooltip={"Open User Notes"}
                />
            </div>
        </div>
    );
}

export default definePlugin({
    name: "UserNotes",
    description: "Allows you to write unlimited notes for users, unlike Discord, which restricts saved notes to a maximum of 500 users and removes older notes when this limit is exceeded. Also adds a dedicated Note Search tab inside Settings to search, filter, edit, and manage all your saved user notes.",
    tags: ["Utility", "Organisation"],
    authors: [TestcordDevs.x2b],
    settings,
    patches: [
        {
            find: "toolbar:function",
            predicate: () => settings.store.addNotesDataToolBar,
            noWarn: true,
            replacement: {
                match: /(function \i\(\i\){)(.{1,200}toolbar.{1,100}mobileToolbar)/,
                replace: "$1$self.addToolBarButton(arguments[0]);$2"
            }
        },
    ],

    sectionFunc: null as (() => any) | null,

    notesSectionRender: (userId: string) => {
        const user = UserStore.getUser(userId);

        return <ProfileContainer
            user={user}
        />;
    },
    addToolBarButton: (children: { toolbar: React.ReactNode[] | React.ReactNode; }) => {
        if (Array.isArray(children.toolbar))
            return children.toolbar.push(
                <ErrorBoundary key="user-notes-data" noop={true}>
                    <OpenNotesDataButton />
                </ErrorBoundary>
            );

        children.toolbar = [
            <ErrorBoundary key="user-notes-data" noop={true}>
                <OpenNotesDataButton />
            </ErrorBoundary>,
            children.toolbar,
        ];
    },

    contextMenus: {
        "user-context": patchUserContext,
    },

    toolboxActions: {
        "Open Notes Data": openNotesDataModal,
    },

    start() {
        if (!SettingsPlugin.customEntries.some(entry => entry.key === ENTRY_KEY)) {
            SettingsPlugin.customEntries.push({
                key: ENTRY_KEY,
                title: "Note Search",
                Component: NoteSearchTab,
                Icon: NoteSearchIcon,
            });
        }

        const { customSections } = SettingsPlugin;
        this.sectionFunc = () => ({
            section: "TestcordNoteSearch",
            label: "Note Search",
            element: NoteSearchTab,
            id: "TestcordNoteSearch",
        });
        if (!customSections.includes(this.sectionFunc)) {
            customSections.push(this.sectionFunc);
        }

        if (settings.store.startupCache) {
            cacheUsers();
        }
    },

    stop() {
        removeFromArray(SettingsPlugin.customEntries, entry => entry.key === ENTRY_KEY);
        if (this.sectionFunc) {
            removeFromArray(SettingsPlugin.customSections, fn => fn === this.sectionFunc);
            this.sectionFunc = null;
        }
    }
});
