/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { TestcordDevs } from "@utils/constants";
import { findStoreLazy } from "@webpack";
import { React, useEffect, useState } from "@webpack/common";

import type { UserAreaModule } from "../types";

const GatewayConnectionStore = findStoreLazy("GatewayConnectionStore");

function SystemMonitorComponent() {
    const [stats, setStats] = useState({ ping: 0, memoryMb: 0, uptimeSec: 0 });

    useEffect(() => {
        const startTime = Date.now();

        const update = () => {
            let ping = 0;
            try {
                ping = GatewayConnectionStore?.getPing?.() ?? 0;
            } catch {}

            let memMb = 0;
            if (typeof performance !== "undefined" && (performance as any).memory) {
                memMb = Math.round(((performance as any).memory.usedJSHeapSize || 0) / (1024 * 1024));
            }

            const uptime = Math.floor((Date.now() - startTime) / 1000);
            setStats({ ping, memoryMb: memMb, uptimeSec: uptime });
        };

        update();
        const timer = setInterval(update, 2000);
        return () => clearInterval(timer);
    }, []);

    const pingColor = stats.ping < 100 ? "var(--text-positive, #3ba55c)" : stats.ping < 200 ? "var(--text-warning, #faa61a)" : "var(--text-danger, #ed4245)";

    return (
        <div
            className="vc-panel-sysmonitor-module"
            style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-around",
                padding: "6px 8px",
                margin: "4px 8px",
                borderRadius: "8px",
                background: "var(--background-secondary-alt, rgba(0, 0, 0, 0.2))",
                border: "1px solid var(--background-modifier-accent, rgba(255, 255, 255, 0.05))",
                fontSize: "11px",
                color: "var(--text-muted)",
                userSelect: "none"
            }}
        >
            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <span style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: pingColor }} />
                <span>{stats.ping}ms</span>
            </div>
            {stats.memoryMb > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    <span>RAM:</span>
                    <span style={{ color: "var(--text-normal)" }}>{stats.memoryMb}MB</span>
                </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <span>Uptime:</span>
                <span style={{ color: "var(--text-normal)" }}>
                    {Math.floor(stats.uptimeSec / 60)}m {stats.uptimeSec % 60}s
                </span>
            </div>
        </div>
    );
}

export const systemMonitorModule: Omit<UserAreaModule, "order" | "enabled"> = {
    id: "system-monitor",
    name: "System & Ping Monitor",
    description: "Monitors Discord gateway latency (ping), JavaScript memory usage, and session uptime.",
    authors: [TestcordDevs.sirphantom89],
    version: "1.0.0",
    tags: ["Utility", "Monitor", "Performance"],
    position: "above",
    render: SystemMonitorComponent,
};
