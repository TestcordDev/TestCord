/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BaseText } from "@components/BaseText";
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { Flex } from "@components/Flex";
import { FormSwitch } from "@components/FormSwitch";
import { openModal } from "@utils/modal";
import { React } from "@webpack/common";

import {
    ChevronDownIcon,
    ChevronUpIcon,
    getModuleIcon,
    PencilIcon,
    SectionHeading,
    SettingsGearIcon,
    TrashIcon,
} from "../icons";
import {
    moveModule,
    setModuleEnabled,
    setModulePosition,
    uninstallCustomModule,
    useModules,
} from "../registry";
import type { CustomModuleData, UserAreaModule } from "../types";
import { openCustomModuleModal } from "./CustomModuleModal";

export function ModulesTab() {
    const modules = useModules();
    const aboveModules = modules.filter(m => (m.position ?? "above") === "above");
    const belowModules = modules.filter(m => (m.position ?? "above") === "below");

    return (
        <Flex flexDirection="column" gap={16}>
            <Flex justifyContent="space-between" alignItems="center">
                <SectionHeading>Modules Above Profile ({aboveModules.filter(m => m.enabled).length})</SectionHeading>
                <Button
                    size="small"
                    variant="primary"
                    onClick={() => openCustomModuleModal()}
                >
                    Add Custom Module
                </Button>
            </Flex>

            {aboveModules.length === 0 ? (
                <Card variant="primary" style={{ padding: "14px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>
                    No modules positioned above profile.
                </Card>
            ) : (
                <Card variant="primary" style={{ padding: 0, overflow: "hidden" }}>
                    {aboveModules.map((mod, index) => (
                        <ModuleRow
                            key={mod.id}
                            mod={mod}
                            isFirst={index === 0}
                            isLast={index === aboveModules.length - 1}
                            isLastInCard={index === aboveModules.length - 1}
                        />
                    ))}
                </Card>
            )}

            <SectionHeading>Modules Below Profile ({belowModules.filter(m => m.enabled).length})</SectionHeading>

            {belowModules.length === 0 ? (
                <Card variant="primary" style={{ padding: "14px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>
                    No modules positioned below profile.
                </Card>
            ) : (
                <Card variant="primary" style={{ padding: 0, overflow: "hidden" }}>
                    {belowModules.map((mod, index) => (
                        <ModuleRow
                            key={mod.id}
                            mod={mod}
                            isFirst={index === 0}
                            isLast={index === belowModules.length - 1}
                            isLastInCard={index === belowModules.length - 1}
                        />
                    ))}
                </Card>
            )}
        </Flex>
    );
}

function ModuleRow({
    mod,
    isFirst,
    isLast,
    isLastInCard,
}: {
    mod: UserAreaModule;
    isFirst: boolean;
    isLast: boolean;
    isLastInCard: boolean;
}) {
    const authorNames = Array.isArray(mod.authors)
        ? mod.authors.map(a => (typeof a === "string" ? a : a.name)).join(", ")
        : "Testcord";

    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 14px",
                borderBottom: isLastInCard ? "none" : "1px solid var(--background-modifier-accent, rgba(255, 255, 255, 0.06))",
                opacity: mod.enabled ? 1 : 0.65,
                transition: "opacity 0.15s ease",
            }}
        >
            <Flex alignItems="center" gap={12} style={{ flex: 1, minWidth: 0 }}>
                <Flex flexDirection="column" gap={2} style={{ flexShrink: 0 }}>
                    <button
                        onClick={() => moveModule(mod.id, "up")}
                        disabled={isFirst}
                        title="Move Up"
                        style={{
                            background: "none",
                            border: "none",
                            cursor: isFirst ? "default" : "pointer",
                            color: isFirst ? "var(--text-muted)" : "var(--interactive-normal)",
                            opacity: isFirst ? 0.3 : 0.8,
                            padding: "2px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                        }}
                    >
                        <ChevronUpIcon size={12} />
                    </button>
                    <button
                        onClick={() => moveModule(mod.id, "down")}
                        disabled={isLast}
                        title="Move Down"
                        style={{
                            background: "none",
                            border: "none",
                            cursor: isLast ? "default" : "pointer",
                            color: isLast ? "var(--text-muted)" : "var(--interactive-normal)",
                            opacity: isLast ? 0.3 : 0.8,
                            padding: "2px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                        }}
                    >
                        <ChevronDownIcon size={12} />
                    </button>
                </Flex>

                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: "30px",
                        height: "30px",
                        borderRadius: "6px",
                        backgroundColor: "var(--background-modifier-accent, rgba(255, 255, 255, 0.08))",
                        color: "var(--interactive-normal)",
                        flexShrink: 0,
                    }}
                >
                    {getModuleIcon(mod.id, 16)}
                </div>

                <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                    <Flex alignItems="center" gap={6}>
                        <BaseText size="md" weight="medium" color="text-strong">
                            {mod.name}
                        </BaseText>
                        {mod.version && (
                            <span style={{ fontSize: "10px", color: "var(--text-muted)", backgroundColor: "var(--background-tertiary)", padding: "1px 5px", borderRadius: "4px" }}>
                                v{mod.version}
                            </span>
                        )}
                        {mod.isCustom && (
                            <span style={{ fontSize: "10px", color: "var(--brand-experiment)", backgroundColor: "rgba(88, 101, 242, 0.15)", padding: "1px 5px", borderRadius: "4px", fontWeight: 600 }}>
                                Custom
                            </span>
                        )}
                    </Flex>
                    <BaseText size="xs" color="text-muted" style={{ marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {mod.description || `By ${authorNames}`}
                    </BaseText>
                </div>
            </Flex>

            <Flex alignItems="center" gap={8} style={{ flexShrink: 0, marginLeft: "12px" }}>
                <div
                    style={{
                        display: "flex",
                        backgroundColor: "var(--background-secondary, rgba(0, 0, 0, 0.2))",
                        borderRadius: "6px",
                        padding: "2px",
                        border: "1px solid var(--background-modifier-accent, rgba(255, 255, 255, 0.08))",
                    }}
                >
                    <button
                        type="button"
                        onClick={() => setModulePosition(mod.id, "above")}
                        style={{
                            background: (mod.position ?? "above") === "above" ? "var(--brand-experiment, #5865f2)" : "transparent",
                            color: (mod.position ?? "above") === "above" ? "#ffffff" : "var(--text-muted)",
                            border: "none",
                            borderRadius: "4px",
                            padding: "3px 8px",
                            fontSize: "11px",
                            fontWeight: 500,
                            cursor: "pointer",
                            transition: "background 0.15s ease, color 0.15s ease",
                        }}
                    >
                        Above
                    </button>
                    <button
                        type="button"
                        onClick={() => setModulePosition(mod.id, "below")}
                        style={{
                            background: (mod.position ?? "above") === "below" ? "var(--brand-experiment, #5865f2)" : "transparent",
                            color: (mod.position ?? "above") === "below" ? "#ffffff" : "var(--text-muted)",
                            border: "none",
                            borderRadius: "4px",
                            padding: "3px 8px",
                            fontSize: "11px",
                            fontWeight: 500,
                            cursor: "pointer",
                            transition: "background 0.15s ease, color 0.15s ease",
                        }}
                    >
                        Below
                    </button>
                </div>

                {mod.isCustom && (
                    <>
                        <Button
                            size="small"
                            variant="secondary"
                            title="Edit code"
                            onClick={() => {
                                const customData: CustomModuleData = {
                                    id: mod.id,
                                    name: mod.name,
                                    description: mod.description,
                                    author: authorNames,
                                    customType: mod.customType ?? "html",
                                    customCode: mod.customCode ?? "",
                                    customCss: mod.customCss,
                                    position: mod.position,
                                    enabled: mod.enabled,
                                    order: mod.order,
                                };
                                openCustomModuleModal(customData, true);
                            }}
                            style={{ padding: "4px 8px", display: "flex", alignItems: "center", justifyContent: "center" }}
                        >
                            <PencilIcon size={14} />
                        </Button>
                        <Button
                            size="small"
                            variant="dangerPrimary"
                            title="Uninstall"
                            onClick={() => uninstallCustomModule(mod.id)}
                            style={{ padding: "4px 8px", display: "flex", alignItems: "center", justifyContent: "center" }}
                        >
                            <TrashIcon size={14} />
                        </Button>
                    </>
                )}

                {mod.settingsComponent && (
                    <Button
                        size="small"
                        variant="secondary"
                        title="Settings"
                        onClick={() => {
                            const SettingsComponent = mod.settingsComponent!;
                            openModal(modalProps => (
                                <SettingsComponent onClose={modalProps.onClose} modalProps={modalProps} />
                            ));
                        }}
                        style={{ padding: "4px 8px", display: "flex", alignItems: "center", justifyContent: "center" }}
                    >
                        <SettingsGearIcon size={14} />
                    </Button>
                )}

                <FormSwitch
                    title=""
                    value={mod.enabled}
                    onChange={v => setModuleEnabled(mod.id, v)}
                    hideBorder
                />
            </Flex>
        </div>
    );
}
