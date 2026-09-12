/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { BaseText } from "@components/BaseText";
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { Flex } from "@components/Flex";
import { FormSwitch } from "@components/FormSwitch";
import { TestcordDevs } from "@utils/constants";
import { OptionType } from "@utils/types";
import type { RenderModalProps } from "@vencord/discord-types";
import { findStoreLazy } from "@webpack";
import { Modal, openModalLazy, React, Select, Tooltip, useEffect, useState } from "@webpack/common";

import { defineModuleSettings } from "../moduleSettings";
import type { UserAreaModule } from "../types";

const GatewayConnectionStore = findStoreLazy("GatewayConnectionStore");

export const sysMonitorSettings = defineModuleSettings("panelSystemMonitor", {
    showPing: {
        type: OptionType.BOOLEAN,
        description: "Display gateway ping latency",
        default: true,
    },
    showRam: {
        type: OptionType.BOOLEAN,
        description: "Display memory consumption",
        default: true,
    },
    showUptime: {
        type: OptionType.BOOLEAN,
        description: "Display session uptime",
        default: true,
    },
    refreshInterval: {
        type: OptionType.SELECT,
        description: "Metrics polling interval",
        options: [
            { label: "Fast (1 second)", value: "1000" },
            { label: "Normal (2 seconds)", value: "2000", default: true },
            { label: "Eco (5 seconds)", value: "5000" },
        ],
    },
});

function ChipIcon({ size = 12, style, className }: { size?: number; style?: React.CSSProperties; className?: string }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={style} className={className}>
            <rect x="4" y="4" width="16" height="16" rx="2" />
            <rect x="9" y="9" width="6" height="6" />
            <line x1="9" y1="1" x2="9" y2="4" />
            <line x1="15" y1="1" x2="15" y2="4" />
            <line x1="9" y1="20" x2="9" y2="23" />
            <line x1="15" y1="20" x2="15" y2="23" />
            <line x1="20" y1="9" x2="23" y2="9" />
            <line x1="20" y1="14" x2="23" y2="14" />
            <line x1="1" y1="9" x2="4" y2="9" />
            <line x1="1" y1="14" x2="4" y2="14" />
        </svg>
    );
}

function UptimeIcon({ size = 12, style, className }: { size?: number; style?: React.CSSProperties; className?: string }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={style} className={className}>
            <circle cx="12" cy="12" r="9" />
            <polyline points="12 6 12 12 16 14" />
        </svg>
    );
}

export function SystemMonitorSettingsModal({ modalProps, onClose }: { modalProps?: RenderModalProps; onClose?: () => void }) {
    const handleClose = () => (modalProps?.onClose ?? onClose)?.();
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);
    const s = sysMonitorSettings.use(["showPing", "showRam", "showUptime", "refreshInterval"]);

    return (
        <Modal
            title="System Monitor Settings"
            size="md"
            {...modalProps!}
            actionBarInput={
                <div style={{ display: "flex", justifyContent: "flex-end", width: "100%" }}>
                    <Button variant="primary" onClick={handleClose}>
                        Done
                    </Button>
                </div>
            }
        >
            <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>
                <Card variant="primary" style={{ padding: "14px" }}>
                    <BaseText size="sm" weight="semibold" style={{ color: "var(--header-primary)", marginBottom: "8px" }}>
                        Refresh Rate
                    </BaseText>
                    <Select
                        options={[
                            { label: "Fast (1 second)", value: "1000" },
                            { label: "Normal (2 seconds)", value: "2000" },
                            { label: "Eco (5 seconds)", value: "5000" },
                        ]}
                        serialize={(val: string) => val}
                        isSelected={(val: string) => val === (s.refreshInterval || "2000")}
                        select={(val: string) => {
                            sysMonitorSettings.store.refreshInterval = val;
                            forceUpdate();
                        }}
                    />
                </Card>

                <Card variant="primary" style={{ padding: "14px", display: "flex", flexDirection: "column", gap: "12px" }}>
                    <BaseText size="sm" weight="semibold" style={{ color: "var(--header-primary)", marginBottom: "4px" }}>
                        Visible Metrics
                    </BaseText>

                    <Flex justifyContent="space-between" alignItems="center">
                        <div>
                            <BaseText size="sm" style={{ color: "var(--header-primary)" }}>Gateway Ping</BaseText>
                            <BaseText size="xs" color="text-muted">Display live Discord gateway latency with status indicator</BaseText>
                        </div>
                        <FormSwitch
                            title=""
                            value={s.showPing ?? true}
                            onChange={v => {
                                sysMonitorSettings.store.showPing = v;
                                forceUpdate();
                            }}
                            hideBorder
                        />
                    </Flex>

                    <Flex justifyContent="space-between" alignItems="center">
                        <div>
                            <BaseText size="sm" style={{ color: "var(--header-primary)" }}>Memory Usage (RAM)</BaseText>
                            <BaseText size="xs" color="text-muted">Display JavaScript heap memory consumption</BaseText>
                        </div>
                        <FormSwitch
                            title=""
                            value={s.showRam ?? true}
                            onChange={v => {
                                sysMonitorSettings.store.showRam = v;
                                forceUpdate();
                            }}
                            hideBorder
                        />
                    </Flex>

                    <Flex justifyContent="space-between" alignItems="center">
                        <div>
                            <BaseText size="sm" style={{ color: "var(--header-primary)" }}>Session Uptime</BaseText>
                            <BaseText size="xs" color="text-muted">Display active Discord client uptime</BaseText>
                        </div>
                        <FormSwitch
                            title=""
                            value={s.showUptime ?? true}
                            onChange={v => {
                                sysMonitorSettings.store.showUptime = v;
                                forceUpdate();
                            }}
                            hideBorder
                        />
                    </Flex>
                </Card>
            </div>
        </Modal>
    );
}

function SystemMonitorComponent() {
    const [stats, setStats] = useState({ ping: 0, memoryMb: 0, uptimeSec: 0 });
    const s = sysMonitorSettings.use(["showPing", "showRam", "showUptime", "refreshInterval"]);

    useEffect(() => {
        const startTime = Date.now();

        const update = () => {
            let ping = 0;
            try {
                ping = Math.round(GatewayConnectionStore?.getPing?.() ?? 0);
            } catch { }

            let memMb = 0;
            if (typeof performance !== "undefined" && (performance as any).memory) {
                memMb = Math.round(((performance as any).memory.usedJSHeapSize || 0) / (1024 * 1024));
            }

            const uptime = Math.floor((Date.now() - startTime) / 1000);
            setStats({ ping, memoryMb: memMb, uptimeSec: uptime });
        };

        update();
        const intervalMs = parseInt(s.refreshInterval || "2000", 10) || 2000;
        const timer = setInterval(update, intervalMs);
        return () => clearInterval(timer);
    }, [s.refreshInterval]);

    const { ping, memoryMb, uptimeSec } = stats;
    let pingQualityClass = "optimal";
    let pingQualityText = "Optimal";
    if (ping <= 0) {
        pingQualityClass = "good";
        pingQualityText = "Ready";
    } else if (ping < 80) {
        pingQualityClass = "optimal";
        pingQualityText = "Optimal";
    } else if (ping < 160) {
        pingQualityClass = "good";
        pingQualityText = "Good";
    } else if (ping < 260) {
        pingQualityClass = "fair";
        pingQualityText = "Moderate";
    } else {
        pingQualityClass = "high";
        pingQualityText = "High Latency";
    }

    const formatUptime = (totalSec: number) => {
        if (totalSec >= 3600) {
            const hours = Math.floor(totalSec / 3600);
            const mins = Math.floor((totalSec % 3600) / 60);
            return `${hours}h ${mins}m`;
        }
        const mins = Math.floor(totalSec / 60);
        const secs = totalSec % 60;
        return `${mins}m ${secs}s`;
    };

    const showPing = s.showPing ?? true;
    const showRam = (s.showRam ?? true) && memoryMb > 0;
    const showUptime = s.showUptime ?? true;

    const handleClick = () => {
        openModalLazy(async () => modalProps => (
            <SystemMonitorSettingsModal onClose={modalProps.onClose} modalProps={modalProps} />
        ));
    };

    return (
        <Tooltip text="System & Gateway Status • Click to configure" position="top">
            {tooltipProps => (
                <div
                    {...tooltipProps}
                    className="vc-panel-sysmonitor-widget"
                    onClick={handleClick}
                    role="button"
                    tabIndex={0}
                >
                    {showPing && (
                        <Tooltip text={`Gateway Latency: ${ping}ms (${pingQualityText})`} position="top">
                            {tp => (
                                <div {...tp} className="vc-sysmonitor-item">
                                    <span className={`vc-sysmonitor-ping-dot ${pingQualityClass}`} />
                                    <span className="vc-sysmonitor-value">{ping > 0 ? `${ping}ms` : "-- ms"}</span>
                                </div>
                            )}
                        </Tooltip>
                    )}

                    {showRam && (
                        <Tooltip text={`JavaScript Heap: ${memoryMb} MB`} position="top">
                            {tp => (
                                <div {...tp} className="vc-sysmonitor-item">
                                    <ChipIcon size={12} className="vc-sysmonitor-icon" />
                                    <span className="vc-sysmonitor-value">{memoryMb} MB</span>
                                </div>
                            )}
                        </Tooltip>
                    )}

                    {showUptime && (
                        <Tooltip text={`Discord Session: ${formatUptime(uptimeSec)}`} position="top">
                            {tp => (
                                <div {...tp} className="vc-sysmonitor-item">
                                    <UptimeIcon size={12} className="vc-sysmonitor-icon" />
                                    <span className="vc-sysmonitor-value">{formatUptime(uptimeSec)}</span>
                                </div>
                            )}
                        </Tooltip>
                    )}
                </div>
            )}
        </Tooltip>
    );
}

export const systemMonitorModule: Omit<UserAreaModule, "order" | "enabled"> = {
    id: "system-monitor",
    name: "System & Ping Monitor",
    description: "Live Discord gateway latency (ping), JavaScript memory usage, and session uptime.",
    authors: [TestcordDevs.sirphantom89],
    version: "1.1.0",
    tags: ["Utility", "Monitor", "Performance"],
    position: "above",
    settingsComponent: SystemMonitorSettingsModal,
    render: SystemMonitorComponent,
};
