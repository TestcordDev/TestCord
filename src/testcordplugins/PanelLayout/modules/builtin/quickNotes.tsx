/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { TestcordDevs } from "@utils/constants";
import { React, useEffect, useState } from "@webpack/common";

import type { UserAreaModule } from "../types";

const QUICK_NOTES_KEY = "panel-layout-quick-notes";

function QuickNotesComponent() {
    const [note, setNote] = useState("");
    const [collapsed, setCollapsed] = useState(true);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        DataStore.get<string>(QUICK_NOTES_KEY).then(saved => {
            if (saved != null) setNote(saved);
            setLoaded(true);
        });
    }, []);

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const val = e.target.value;
        setNote(val);
        DataStore.set(QUICK_NOTES_KEY, val);
    };

    return (
        <div
            className="vc-panel-quick-notes-module"
            style={{
                margin: "4px 8px",
                borderRadius: "8px",
                background: "var(--background-secondary-alt, rgba(0, 0, 0, 0.2))",
                border: "1px solid var(--background-modifier-accent, rgba(255, 255, 255, 0.05))",
                overflow: "hidden"
            }}
        >
            <div
                onClick={() => setCollapsed(!collapsed)}
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "6px 10px",
                    cursor: "pointer",
                    userSelect: "none",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "var(--header-primary, #fff)"
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span>📝</span>
                    <span>Quick Notes</span>
                </div>
                <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                    {collapsed ? "▼" : "▲"}
                </span>
            </div>

            {!collapsed && loaded && (
                <div style={{ padding: "0 8px 8px 8px" }}>
                    <textarea
                        value={note}
                        onChange={handleChange}
                        placeholder="Type quick notes or reminders here..."
                        style={{
                            width: "100%",
                            height: "60px",
                            backgroundColor: "var(--background-tertiary, rgba(0, 0, 0, 0.3))",
                            color: "var(--text-normal, #ddd)",
                            border: "1px solid var(--background-modifier-accent, rgba(255, 255, 255, 0.1))",
                            borderRadius: "4px",
                            padding: "6px",
                            fontSize: "11px",
                            resize: "vertical",
                            boxSizing: "border-box"
                        }}
                    />
                </div>
            )}
        </div>
    );
}

export const quickNotesModule: Omit<UserAreaModule, "order" | "enabled"> = {
    id: "quick-notes",
    name: "Quick Notes",
    description: "A convenient scratchpad for notes and reminders saved right in your user area.",
    authors: [TestcordDevs.Aviv],
    version: "1.0.0",
    tags: ["Utility", "Productivity", "Notes"],
    icon: "📝",
    position: "above",
    render: QuickNotesComponent,
};
