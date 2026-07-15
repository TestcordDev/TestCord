/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import ErrorBoundary from "@components/ErrorBoundary";
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { User } from "@vencord/discord-types";
import { Button, Menu, TextArea, UserStore, useState } from "@webpack/common";

import { PopupIcon } from "./components/Icons";
import { OpenNotesDataButton } from "./components/NotesDataButton";
import { openNotesDataModal } from "./components/NotesDataModal";
import { openUserNotesModal } from "./components/UserNotesModal";
import { cacheUsers, getUserNotes, saveUserNotes } from "./data";
import settings from "./settings";

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

    return (
        <div className={"vc-user-notes-profile-container"}>
            <TextArea
                className={"vc-user-notes-profile-text-area"}
                placeholder="Click to add a note"
                value={userNotes}
                onChange={setUserNotes}
                onBlur={() => saveUserNotes(user.id, userNotes)}
            />
            <Button
                className={"vc-user-notes-profile-button"}
                color={Button.Colors.PRIMARY}
                size={Button.Sizes.NONE}
                onClick={() => openUserNotesModal(user)}
            >
                <PopupIcon />
            </Button>
        </div>
    );
}

export default definePlugin({
    name: "UserNotes",
    description: "Allows you to write unlimited notes for users, unlike Discord, which restricts saved notes to a maximum of 500 users and removes older notes when this limit is exceeded",
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

    start: () => {
        if (settings.store.startupCache) {
            cacheUsers();
        }
    }
});
