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
import { Modal, openModalLazy, React, Select, Tooltip, useEffect, useState } from "@webpack/common";

import { defineModuleSettings } from "../moduleSettings";
import type { UserAreaModule } from "../types";

export const clockSettings = defineModuleSettings("panelClockWidget", {
    timeFormat: {
        type: OptionType.SELECT,
        description: "Time format",
        options: [
            { label: "12-Hour (e.g. 3:45 PM)", value: "12", default: true },
            { label: "24-Hour (e.g. 15:45)", value: "24" },
        ],
    },
    showSeconds: {
        type: OptionType.BOOLEAN,
        description: "Display seconds",
        default: true,
    },
    showDate: {
        type: OptionType.BOOLEAN,
        description: "Display calendar date",
        default: true,
    },
});

function ClockIcon({ size = 14, style }: { size?: number; style?: React.CSSProperties }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={style}>
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 14 16 14" />
        </svg>
    );
}

function CalendarIcon({ size = 12, style }: { size?: number; style?: React.CSSProperties }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={style}>
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
    );
}

export function ClockSettingsModal({ modalProps, onClose }: { modalProps?: RenderModalProps; onClose?: () => void }) {
    const handleClose = () => (modalProps?.onClose ?? onClose)?.();
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);
    const s = clockSettings.use(["timeFormat", "showSeconds", "showDate"]);

    return (
        <Modal
            title="Digital Clock Settings"
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
                        Time Format
                    </BaseText>
                    <Select
                        options={[
                            { label: "12-Hour (with AM / PM)", value: "12" },
                            { label: "24-Hour", value: "24" },
                        ]}
                        serialize={(val: string) => val}
                        isSelected={(val: string) => val === (s.timeFormat || "12")}
                        select={(val: string) => {
                            clockSettings.store.timeFormat = val;
                            forceUpdate();
                        }}
                    />
                </Card>

                <Card variant="primary" style={{ padding: "14px", display: "flex", flexDirection: "column", gap: "12px" }}>
                    <BaseText size="sm" weight="semibold" style={{ color: "var(--header-primary)", marginBottom: "4px" }}>
                        Display Options
                    </BaseText>

                    <Flex justifyContent="space-between" alignItems="center">
                        <div>
                            <BaseText size="sm" style={{ color: "var(--header-primary)" }}>Show Seconds</BaseText>
                            <BaseText size="xs" color="text-muted">Display seconds beside minutes</BaseText>
                        </div>
                        <FormSwitch
                            title=""
                            value={s.showSeconds ?? true}
                            onChange={v => {
                                clockSettings.store.showSeconds = v;
                                forceUpdate();
                            }}
                            hideBorder
                        />
                    </Flex>

                    <Flex justifyContent="space-between" alignItems="center">
                        <div>
                            <BaseText size="sm" style={{ color: "var(--header-primary)" }}>Show Calendar Date</BaseText>
                            <BaseText size="xs" color="text-muted">Display current day and month</BaseText>
                        </div>
                        <FormSwitch
                            title=""
                            value={s.showDate ?? true}
                            onChange={v => {
                                clockSettings.store.showDate = v;
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

function ClockComponent() {
    const [time, setTime] = useState(() => new Date());
    const s = clockSettings.use(["timeFormat", "showSeconds", "showDate"]);

    useEffect(() => {
        const timer = setInterval(() => setTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    const is12h = (s.timeFormat ?? "12") === "12";
    const rawHours = time.getHours();
    const hoursNum = is12h ? (rawHours % 12 || 12) : rawHours;
    const hours = is12h ? String(hoursNum) : String(hoursNum).padStart(2, "0");
    const minutes = time.getMinutes().toString().padStart(2, "0");
    const seconds = time.getSeconds().toString().padStart(2, "0");
    const ampm = rawHours >= 12 ? "PM" : "AM";

    const formattedDate = time.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
    });

    const fullDateLong = time.toLocaleDateString(undefined, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
    });

    const handleClick = () => {
        openModalLazy(async () => modalProps => (
            <ClockSettingsModal onClose={modalProps.onClose} modalProps={modalProps} />
        ));
    };

    return (
        <Tooltip text={`${fullDateLong} • Click to configure`} position="top">
            {tooltipProps => (
                <div
                    {...tooltipProps}
                    className="vc-panel-clock-widget"
                    onClick={handleClick}
                    role="button"
                    tabIndex={0}
                >
                    <div className="vc-clock-time-group">
                        <div className="vc-clock-icon-slot">
                            <ClockIcon size={14} />
                        </div>
                        <div className="vc-clock-digits">
                            <span>{hours}</span>
                            <span>:</span>
                            <span>{minutes}</span>
                            {(s.showSeconds ?? true) && (
                                <span className="vc-clock-seconds">:{seconds}</span>
                            )}
                        </div>
                        {is12h && (
                            <span className="vc-clock-ampm">{ampm}</span>
                        )}
                    </div>

                    {(s.showDate ?? true) && (
                        <div className="vc-clock-date-group">
                            <CalendarIcon size={12} style={{ color: "var(--interactive-normal)", opacity: 0.8 }} />
                            <span className="vc-clock-date-str">{formattedDate}</span>
                        </div>
                    )}
                </div>
            )}
        </Tooltip>
    );
}

export const clockModule: Omit<UserAreaModule, "order" | "enabled"> = {
    id: "clock-widget",
    name: "Digital Clock & Date",
    description: "Displays a clean digital clock and calendar date directly in the user area.",
    authors: [TestcordDevs.x2b],
    version: "1.1.0",
    tags: ["Utility", "Time", "Clock"],
    position: "above",
    settingsComponent: ClockSettingsModal,
    render: ClockComponent,
};
