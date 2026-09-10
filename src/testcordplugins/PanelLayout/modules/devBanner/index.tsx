/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { BaseText } from "@components/BaseText";
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { Flex } from "@components/Flex";
import { Devs, EquicordDevs, TestcordDevs } from "@utils/constants";
import type { RenderModalProps } from "@vencord/discord-types";
import { Modal, React, useState } from "@webpack/common";

import { ColorRow } from "../colorPicker";
import type { UserAreaModule } from "../types";
import { FormatSetting, makeDevBanner, settings } from "./components";

export function DevBannerWidget() {
    const s = settings.use(["format", "color", "backgroundColor", "fontSize", "textAlign"]);
    const content = makeDevBanner();
    if (!content) return null;
    return (
        <div
            className="vc-devbanner-module-widget"
            style={{
                padding: "4px 8px",
                fontSize: s.fontSize ? `${s.fontSize}px` : "11px",
                textAlign: (s.textAlign as React.CSSProperties["textAlign"]) || "center",
                color: s.color || "var(--text-muted)",
                backgroundColor: s.backgroundColor || "transparent",
                lineHeight: "1.4",
                userSelect: "text",
            }}
        >
            {content}
        </div>
    );
}

export function DevBannerSettingsModal({ modalProps, onClose }: { modalProps?: RenderModalProps; onClose?: () => void }) {
    const handleClose = () => (modalProps?.onClose ?? onClose)?.();
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);
    const s = settings.use(["format", "color", "backgroundColor", "fontSize", "textAlign"]);
    const [activeTab, setActiveTab] = useState<"format" | "style">("format");

    return (
        <Modal
            title="Developer Banner Settings"
            size="lg"
            {...modalProps!}
            actionBarInput={
                <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center", flexDirection: "row-reverse" }}>
                    <Button
                        variant="primary"
                        onClick={handleClose}
                    >
                        Done
                    </Button>
                </div>
            }
        >
            <Flex gap={8} style={{ padding: "0 16px", marginTop: "12px", borderBottom: "1px solid var(--background-modifier-accent, var(--border-muted))" }}>
                <div
                    onClick={() => setActiveTab("format")}
                    className={`vc-pl-subtab ${activeTab === "format" ? "active" : ""}`}
                    style={{
                        padding: "8px 14px",
                        cursor: "pointer",
                        fontWeight: activeTab === "format" ? 600 : 400,
                        color: activeTab === "format" ? "var(--interactive-active)" : "var(--interactive-normal)",
                        borderBottom: activeTab === "format" ? "2px solid var(--brand-experiment)" : "2px solid transparent",
                    }}
                >
                    Format & Placeholders
                </div>
                <div
                    onClick={() => setActiveTab("style")}
                    className={`vc-pl-subtab ${activeTab === "style" ? "active" : ""}`}
                    style={{
                        padding: "8px 14px",
                        cursor: "pointer",
                        fontWeight: activeTab === "style" ? 600 : 400,
                        color: activeTab === "style" ? "var(--interactive-active)" : "var(--interactive-normal)",
                        borderBottom: activeTab === "style" ? "2px solid var(--brand-experiment)" : "2px solid transparent",
                    }}
                >
                    Colors & Appearance
                </div>
            </Flex>

            <div className="panellayout-scrollbar deracul-scrollbar" style={{ padding: "16px 8px 16px 16px", maxHeight: "65vh", overflowY: "auto" }}>
                {activeTab === "format" && (
                    <FormatSetting
                        setValue={(newFormat: string) => {
                            settings.store.format = newFormat;
                            forceUpdate();
                        }}
                    />
                )}

                {activeTab === "style" && (
                    <Flex flexDirection="column" gap={16}>
                        <Card variant="primary">
                            <Flex flexDirection="column" gap={12} style={{ padding: "4px" }}>
                                <ColorRow
                                    label="Text Color"
                                    value={s.color || "var(--text-muted)"}
                                    preset="#949ba4"
                                    onChange={newColor => {
                                        settings.store.color = newColor;
                                        forceUpdate();
                                    }}
                                    onReset={() => {
                                        settings.store.color = "var(--text-muted)";
                                        forceUpdate();
                                    }}
                                />

                                <ColorRow
                                    label="Background Color"
                                    value={s.backgroundColor}
                                    preset="#111214"
                                    onChange={newBg => {
                                        settings.store.backgroundColor = newBg;
                                        forceUpdate();
                                    }}
                                    onReset={() => {
                                        settings.store.backgroundColor = "";
                                        forceUpdate();
                                    }}
                                />
                            </Flex>
                        </Card>

                        <Card variant="primary">
                            <Flex flexDirection="column" gap={12} style={{ padding: "4px" }}>
                                <div>
                                    <Flex justifyContent="space-between" alignItems="center" style={{ marginBottom: "6px" }}>
                                        <BaseText size="md" weight="medium" color="text-default">
                                            Font Size ({s.fontSize || 11}px)
                                        </BaseText>
                                        {s.fontSize !== 11 && (
                                            <span
                                                onClick={() => {
                                                    settings.store.fontSize = 11;
                                                    forceUpdate();
                                                }}
                                                style={{ fontSize: "12px", color: "var(--text-muted)", cursor: "pointer", textDecoration: "underline" }}
                                            >
                                                Reset
                                            </span>
                                        )}
                                    </Flex>
                                    <input
                                        type="range"
                                        min={9}
                                        max={18}
                                        step={1}
                                        value={s.fontSize || 11}
                                        onChange={e => {
                                            settings.store.fontSize = parseInt(e.target.value, 10);
                                            forceUpdate();
                                        }}
                                        style={{ width: "100%", accentColor: "var(--brand-experiment)" }}
                                    />
                                </div>

                                <div>
                                    <BaseText size="md" weight="medium" color="text-default" style={{ marginBottom: "6px" }}>
                                        Text Alignment
                                    </BaseText>
                                    <Flex gap={8}>
                                        {(["left", "center", "right"] as const).map(align => (
                                            <button
                                                key={align}
                                                type="button"
                                                onClick={() => {
                                                    settings.store.textAlign = align;
                                                    forceUpdate();
                                                }}
                                                style={{
                                                    flex: 1,
                                                    padding: "6px 12px",
                                                    borderRadius: "6px",
                                                    border: "1px solid var(--background-modifier-accent, var(--border-muted))",
                                                    background: (s.textAlign || "center") === align ? "var(--brand-experiment)" : "var(--background-secondary, rgba(255,255,255,0.05))",
                                                    color: (s.textAlign || "center") === align ? "#fff" : "var(--text-default)",
                                                    fontWeight: (s.textAlign || "center") === align ? 600 : 400,
                                                    cursor: "pointer",
                                                    textTransform: "capitalize",
                                                }}
                                            >
                                                {align}
                                            </button>
                                        ))}
                                    </Flex>
                                </div>
                            </Flex>
                        </Card>

                        <div>
                            <BaseText size="sm" weight="semibold" color="text-muted" style={{ textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>
                                Live Preview
                            </BaseText>
                            <div
                                style={{
                                    padding: "8px 12px",
                                    borderRadius: "8px",
                                    background: "var(--background-secondary-alt, #111214)",
                                    border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))",
                                }}
                            >
                                <DevBannerWidget />
                            </div>
                        </div>
                    </Flex>
                )}
            </div>
        </Modal>
    );
}

export const devBannerPatches: any[] = [];

export const devBannerModule: Omit<UserAreaModule, "order" | "enabled"> = {
    id: "dev-banner",
    name: "Developer Banner",
    description: "Displays Discord & Testcord build number, channel, commit hash, and client information.",
    authors: [EquicordDevs.KrystalSkull, Devs.thororen, TestcordDevs.sirphantom89],
    version: "1.0.0",
    tags: ["Developers", "Appearance"],
    position: "above",
    render: DevBannerWidget,
    settingsComponent: DevBannerSettingsModal,
};

export { makeDevBanner, settings };
export * from "./components";
