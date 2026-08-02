/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import SettingsPlugin from "@plugins/_core/settings";
import { TestcordDevs } from "@utils/constants";
import { removeFromArray } from "@utils/misc";
import definePlugin, { IconProps } from "@utils/types";
import { React } from "@webpack/common";

import { NoteSearchTab } from "./components/NoteSearchTab";

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

export default definePlugin({
    name: "NoteSearch",
    description: "Adds a dedicated Note Search tab inside Settings to search, filter, edit, and manage all your saved user notes.",
    tags: ["Utility", "Organisation"],
    authors: [TestcordDevs.x2b],

    sectionFunc: null as (() => any) | null,

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
    },

    stop() {
        removeFromArray(SettingsPlugin.customEntries, entry => entry.key === ENTRY_KEY);
        if (this.sectionFunc) {
            removeFromArray(SettingsPlugin.customSections, fn => fn === this.sectionFunc);
            this.sectionFunc = null;
        }
    }
});
