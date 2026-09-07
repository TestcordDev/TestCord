/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { TestcordDevs } from "@utils/constants";
import { React, useEffect, useState } from "@webpack/common";

import type { UserAreaModule } from "../types";

function ClockComponent() {
    const [time, setTime] = useState(() => new Date());

    useEffect(() => {
        const timer = setInterval(() => setTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    const hours = time.getHours().toString().padStart(2, "0");
    const minutes = time.getMinutes().toString().padStart(2, "0");
    const seconds = time.getSeconds().toString().padStart(2, "0");
    const dateStr = time.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
    });

    return (
        <div
            className="vc-panel-clock-module"
            style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 12px",
                margin: "4px 8px",
                borderRadius: "8px",
                background: "var(--background-secondary-alt, rgba(0, 0, 0, 0.2))",
                border: "1px solid var(--background-modifier-accent, rgba(255, 255, 255, 0.05))",
                userSelect: "none"
            }}
        >
            <div style={{ display: "flex", alignItems: "baseline", gap: "2px" }}>
                <span style={{ fontSize: "15px", fontWeight: 700, fontFamily: "monospace", color: "var(--header-primary, #fff)" }}>
                    {hours}:{minutes}
                </span>
                <span style={{ fontSize: "11px", fontWeight: 500, fontFamily: "monospace", color: "var(--text-muted, #aaa)", marginLeft: "2px" }}>
                    :{seconds}
                </span>
            </div>
            <div style={{ fontSize: "11px", fontWeight: 500, color: "var(--text-muted)" }}>
                {dateStr}
            </div>
        </div>
    );
}

export const clockModule: Omit<UserAreaModule, "order" | "enabled"> = {
    id: "clock-widget",
    name: "Digital Clock & Date",
    description: "Displays a sleek live digital clock and calendar date directly in the user area.",
    authors: [TestcordDevs.x2b],
    version: "1.0.0",
    tags: ["Utility", "Time", "Clock"],
    position: "above",
    render: ClockComponent,
};
