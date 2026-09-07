/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BaseText } from "@components/BaseText";
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { Flex } from "@components/Flex";
import { Paragraph } from "@components/Paragraph";
import type { PluginNative } from "@utils/types";
import { React, useEffect, useState } from "@webpack/common";

import {
    CodeIcon,
    PencilIcon,
    TrashIcon,
} from "../icons";
import {
    getCustomModulesData,
    setModuleEnabled,
    uninstallCustomModule,
    useModules,
} from "../registry";
import type { CustomModuleData } from "../types";
import { openCustomModuleModal } from "./CustomModuleModal";
import { MarketplaceTab } from "./MarketplaceTab";
import { UserAreaReorderTab } from "./UserAreaReorderTab";

const Native = (VencordNative?.pluginHelpers?.PanelLayout || {}) as PluginNative<
    typeof import("../../native")
>;

const MODAL_BODY_HEIGHT = 370;

export type ModulesSubTab = "userarea" | "marketplace" | "usermodules";

function SubTabUserAreaIcon({ size = 14, style }: { size?: number; style?: React.CSSProperties; }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={style}>
            <path d="M3 6h18M3 12h18M3 18h18" />
        </svg>
    );
}

function SubTabMarketplaceIcon({ size = 14, style }: { size?: number; style?: React.CSSProperties; }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}>
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
        </svg>
    );
}

export interface ModulesTabProps {
    pluginSettings?: any;
    onOpenButtonCustomizer?: () => void;
    onOpenCallBarSettings?: () => void;
    initialSubTab?: ModulesSubTab;
}

export function ModulesTab({
    pluginSettings,
    onOpenButtonCustomizer,
    onOpenCallBarSettings,
    initialSubTab = "userarea",
}: ModulesTabProps = {}) {
    const [subTab, setSubTab] = useState<ModulesSubTab>(initialSubTab);
    const modules = useModules();
    const [customModules, setCustomModules] = useState<CustomModuleData[]>([]);

    useEffect(() => {
        void getCustomModulesData().then(setCustomModules);
    }, [modules]);

    const SUB_TABS = [
        { id: "userarea", label: "User Area", icon: SubTabUserAreaIcon },
        { id: "marketplace", label: "Marketplace", icon: SubTabMarketplaceIcon },
        { id: "usermodules", label: "User Modules", icon: CodeIcon },
    ] as const;

const TAB_CSS = `
    .vc-pl-subtab {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 14px;
        margin-bottom: -1px;
        cursor: pointer;
        border-radius: 6px 6px 0 0;
        border-bottom: 2px solid transparent;
        background-color: transparent !important;
        transition: background-color 0.15s ease, border-color 0.15s ease;
        user-select: none;
    }

    .vc-pl-subtab:hover {
        background-color: var(--background-modifier-hover, var(--background-mod-subtle)) !important;
    }

    .vc-pl-subtab.active,
    .vc-pl-subtab.active:hover {
        border-bottom: 2px solid var(--brand-experiment, var(--background-brand)) !important;
        background-color: transparent !important;
    }
`;

    return (
        <Flex flexDirection="column" gap={16}>
            <style>{TAB_CSS}</style>
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    borderBottom: "1px solid var(--background-modifier-accent, var(--border-muted))",
                    width: "100%",
                    marginBottom: "4px",
                }}
            >
                {SUB_TABS.map(tab => {
                    const active = subTab === tab.id;
                    const Icon = tab.icon;
                    return (
                        <div
                            key={tab.id}
                            onClick={() => setSubTab(tab.id)}
                            className={`vc-pl-subtab ${active ? "active" : ""}`}
                        >
                            <span
                                style={{
                                    display: "flex",
                                    color: active
                                        ? "var(--brand-experiment, var(--background-brand))"
                                        : "var(--text-muted)",
                                    transition: "color 0.15s ease",
                                }}
                            >
                                <Icon size={14} />
                            </span>
                            <BaseText
                                size="md"
                                weight={active ? "semibold" : "medium"}
                                color={active ? "text-strong" : "text-muted"}
                            >
                                {tab.label}
                            </BaseText>
                        </div>
                    );
                })}
            </div>

            <div className="panellayout-scrollbar" style={{ height: `${MODAL_BODY_HEIGHT}px`, overflowY: "auto", paddingRight: "4px", boxSizing: "border-box" }}>
                <Flex flexDirection="column" gap={16}>
                    {subTab === "userarea" && (
                        <UserAreaReorderTab
                            pluginSettings={pluginSettings}
                            onOpenButtonCustomizer={onOpenButtonCustomizer}
                            onOpenCallBarSettings={onOpenCallBarSettings}
                        />
                    )}

                    {subTab === "marketplace" && (
                        <MarketplaceTab />
                    )}

                    {subTab === "usermodules" && (
                        <UserModulesSubfolder
                            customModules={customModules}
                            onRefresh={() => void getCustomModulesData().then(setCustomModules)}
                        />
                    )}
            </Flex>
            </div>
        </Flex>
    );
}

function UserModulesSubfolder({
    customModules,
    onRefresh,
}: {
    customModules: CustomModuleData[];
    onRefresh: () => void;
}) {
    return (
        <Flex flexDirection="column" gap={14}>
            <Card
                variant="primary"
                style={{
                    padding: "16px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    background: "linear-gradient(135deg, rgba(88, 101, 242, 0.12), rgba(0, 0, 0, 0.2))",
                    border: "1px solid rgba(88, 101, 242, 0.25)",
                }}
            >
                <div>
                    <BaseText size="md" weight="semibold" color="text-strong">
                        Custom User Modules
                    </BaseText>
                    <Paragraph style={{ color: "var(--text-muted)", fontSize: "12px", margin: "3px 0 0" }}>
                        Create interactive HTML/CSS widgets or React components directly in your user area.
                    </Paragraph>
                </div>
                <Flex gap={8} alignItems="center" style={{ flexShrink: 0 }}>
                    <Button
                        size="small"
                        variant="secondary"
                        onClick={() => void Native?.openUserModulesFolder?.()}
                        style={{ padding: "6px 12px" }}
                        title="Open usermodules folder on disk"
                    >
                        Open Folder
                    </Button>
                    <Button
                        size="small"
                        variant="primary"
                        onClick={() => {
                            openCustomModuleModal(undefined, false);
                            setTimeout(onRefresh, 300);
                        }}
                        style={{ padding: "6px 14px" }}
                    >
                        + Add User Module
                    </Button>
                </Flex>
            </Card>

            {customModules.length === 0 ? (
                <Card variant="primary" style={{ padding: "28px 16px", textAlign: "center" }}>
                    <div style={{ display: "flex", justifyContent: "center", marginBottom: "8px", opacity: 0.6 }}>
                        <CodeIcon size={32} />
                    </div>
                    <BaseText size="md" weight="medium" color="text-strong">
                        No Custom Modules Yet
                    </BaseText>
                    <Paragraph style={{ color: "var(--text-muted)", fontSize: "12px", marginTop: "4px" }}>
                        Click "+ Add User Module" above to create your first customized widget.
                    </Paragraph>
                </Card>
            ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "10px" }}>
                    {customModules.map(mod => (
                        <Card
                            key={mod.id}
                            variant="primary"
                            style={{
                                padding: "14px",
                                display: "flex",
                                flexDirection: "column",
                                justifyContent: "space-between",
                                gap: "12px",
                            }}
                        >
                            <div>
                                <Flex justifyContent="space-between" alignItems="flex-start">
                                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                        <div
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                width: "28px",
                                                height: "28px",
                                                borderRadius: "6px",
                                                backgroundColor: "rgba(88, 101, 242, 0.15)",
                                                color: "var(--brand-experiment)",
                                            }}
                                        >
                                            <CodeIcon size={16} />
                                        </div>
                                        <div>
                                            <BaseText size="md" weight="medium" color="text-strong">
                                                {mod.name}
                                            </BaseText>
                                            <BaseText size="xs" color="text-muted">
                                                {mod.customType?.toUpperCase() || "HTML"} Widget
                                            </BaseText>
                                        </div>
                                    </div>
                                    <span
                                        style={{
                                            fontSize: "10px",
                                            fontWeight: 600,
                                            padding: "2px 6px",
                                            borderRadius: "4px",
                                            backgroundColor: mod.enabled ? "rgba(35, 165, 90, 0.15)" : "var(--background-tertiary)",
                                            color: mod.enabled ? "var(--status-positive, #23a55a)" : "var(--text-muted)",
                                        }}
                                    >
                                        {mod.enabled ? "Active" : "Disabled"}
                                    </span>
                                </Flex>

                                {mod.description && (
                                    <Paragraph style={{ fontSize: "12px", color: "var(--text-muted)", margin: "8px 0 0", lineHeight: "1.3" }}>
                                        {mod.description}
                                    </Paragraph>
                                )}
                            </div>

                            <Flex justifyContent="space-between" alignItems="center" style={{ borderTop: "1px solid var(--background-modifier-accent, rgba(255, 255, 255, 0.06))", paddingTop: "8px" }}>
                                <Flex gap={6}>
                                    <Button
                                        size="small"
                                        variant="secondary"
                                        title="Edit Code"
                                        onClick={() => {
                                            openCustomModuleModal(mod, true);
                                            setTimeout(onRefresh, 300);
                                        }}
                                        style={{ padding: "4px 8px" }}
                                    >
                                        <PencilIcon size={14} />
                                    </Button>
                                    <Button
                                        size="small"
                                        variant="dangerPrimary"
                                        title="Delete Module"
                                        onClick={() => {
                                            if (mod.id) {
                                                void uninstallCustomModule(mod.id).then(onRefresh);
                                            }
                                        }}
                                        style={{ padding: "4px 8px" }}
                                    >
                                        <TrashIcon size={14} />
                                    </Button>
                                </Flex>

                                <Flex alignItems="center" gap={6}>
                                    <Button
                                        size="small"
                                        variant={mod.enabled ? "secondary" : "primary"}
                                        onClick={() => {
                                            if (mod.id) {
                                                void setModuleEnabled(mod.id, !mod.enabled).then(onRefresh);
                                            }
                                        }}
                                        style={{ fontSize: "11px", padding: "4px 10px" }}
                                    >
                                        {mod.enabled ? "Disable" : "Enable"}
                                    </Button>
                                </Flex>
                            </Flex>
                        </Card>
                    ))}
                </div>
            )}
        </Flex>
    );
}
