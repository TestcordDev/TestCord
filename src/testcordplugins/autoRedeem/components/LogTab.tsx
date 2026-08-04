/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { SettingsTab, wrapTab } from "@components/settings";
import { ChannelStore, NavigationRouter, React, Select, useEffect, useState } from "@webpack/common";

import { clearLogs, getLogs, loadLogs, type RedeemLog, type RedeemStatus, type RedeemType, subscribe } from "../store";

type StatusFilter = "all" | RedeemStatus;
type TypeFilter = "all" | RedeemType;

const statusOptions = [
    { label: "All", value: "all" },
    { label: "Succeeded", value: "success" },
    { label: "Failed", value: "failed" },
];

const typeOptions = [
    { label: "All", value: "all" },
    { label: "Nitro", value: "nitro" },
    { label: "Decorations", value: "decoration" },
    { label: "Other", value: "other" },
];

function AutoRedeemTab() {
    const [logs, setLogs] = useState<RedeemLog[]>(getLogs());
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
    const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

    useEffect(() => {
        void loadLogs();
        return subscribe(() => setLogs([...getLogs()]));
    }, []);

    const filtered = logs.filter(l =>
        (statusFilter === "all" || l.status === statusFilter) &&
        (typeFilter === "all" || l.type === typeFilter)
    );

    return (
        <SettingsTab>
            <div style={{ display: "flex", gap: "12px", marginBottom: "16px", alignItems: "center" }}>
                <div style={{ width: "160px" }}>
                    <Select
                        options={statusOptions}
                        isSelected={v => v === statusFilter}
                        select={v => setStatusFilter(v)}
                        serialize={v => v}
                        placeholder="Status"
                    />
                </div>
                <div style={{ width: "160px" }}>
                    <Select
                        options={typeOptions}
                        isSelected={v => v === typeFilter}
                        select={v => setTypeFilter(v)}
                        serialize={v => v}
                        placeholder="Type"
                    />
                </div>
                <button
                    className="vc-settings-theme-links-reset"
                    style={{ marginLeft: "auto" }}
                    onClick={() => { if (confirm("Clear all logs?")) void clearLogs(); }}
                >
                    Clear Logs
                </button>
            </div>

            {filtered.length === 0 ? (
                <div style={{ textAlign: "center", color: "var(--text-muted)", padding: "32px" }}>
                    No logs yet.
                </div>
            ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    {filtered.map(log => (
                        <div key={log.id} style={{
                            display: "flex", alignItems: "center", gap: "10px",
                            padding: "8px 12px", borderRadius: "6px",
                            background: "var(--background-secondary)",
                        }}>
                            <span style={{
                                padding: "2px 8px", borderRadius: "4px", fontSize: "12px", fontWeight: 600,
                                background: log.status === "success" ? "var(--status-positive-background)" : "var(--status-danger-background)",
                                color: log.status === "success" ? "var(--status-positive-text)" : "var(--status-danger-text)",
                            }}>
                                {log.status === "success" ? "OK" : "FAIL"}
                            </span>
                            <span style={{
                                padding: "2px 8px", borderRadius: "4px", fontSize: "12px",
                                background: "var(--background-tertiary)",
                            }}>
                                {log.type}
                            </span>
                            <code
                                style={{
                                    flex: 1,
                                    ...(log.channelId && log.messageId ? { cursor: "pointer", textDecoration: "underline", color: "var(--text-link)" } : {})
                                }}
                                onClick={() => {
                                    if (!log.channelId || !log.messageId) return;
                                    const channel = ChannelStore.getChannel(log.channelId);
                                    const guildId = channel?.guild_id ?? "@me";
                                    NavigationRouter.transitionTo(`/channels/${guildId}/${log.channelId}/${log.messageId}`);
                                }}
                            >{log.code}</code>
                            {log.error && <span style={{ color: "var(--text-danger)", fontSize: "12px" }}>{log.error}</span>}
                            <span style={{ color: "var(--text-muted)", fontSize: "12px" }}>
                                {new Date(log.timestamp).toLocaleString()}
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </SettingsTab>
    );
}

export default wrapTab(AutoRedeemTab, "AutoRedeem Logs");
