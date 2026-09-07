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
    moveModule,
    setModuleEnabled,
    setModulePosition,
    uninstallCustomModule,
    useModules,
} from "../registry";
import type { CustomModuleData, ModulePosition, UserAreaModule } from "../types";
import { openCustomModuleModal } from "./CustomModuleModal";

export function ModulesTab() {
    const modules = useModules();
    const aboveModules = modules.filter(m => (m.position ?? "above") === "above");
    const belowModules = modules.filter(m => (m.position ?? "above") === "below");

    return (
        <Flex flexDirection="column" gap={16}>
            <Flex justifyContent="space-between" alignItems="center">
                <div>
                    <BaseText size="md" weight="semibold">
                        User Area Modules
                    </BaseText>
                    <BaseText size="xs" color="text-muted" style={{ marginTop: "2px" }}>
                        Modules appear in your user area. Reorder or toggle them on and off below.
                    </BaseText>
                </div>
                <Button
                    size="small"
                    variant="primary"
                    onClick={() => openCustomModuleModal()}
                >
                    + Add Custom Module
                </Button>
            </Flex>

            <div>
                <BaseText size="xs" weight="bold" color="text-muted" style={{ textTransform: "uppercase", marginBottom: "8px", letterSpacing: "0.5px" }}>
                    Above Profile ({aboveModules.filter(m => m.enabled).length} active)
                </BaseText>
                <ModuleList position="above" modules={aboveModules} />
            </div>

            {belowModules.length > 0 && (
                <div>
                    <BaseText size="xs" weight="bold" color="text-muted" style={{ textTransform: "uppercase", marginBottom: "8px", letterSpacing: "0.5px" }}>
                        Below Profile ({belowModules.filter(m => m.enabled).length} active)
                    </BaseText>
                    <ModuleList position="below" modules={belowModules} />
                </div>
            )}
        </Flex>
    );
}

function ModuleList({ position, modules }: { position: ModulePosition; modules: UserAreaModule[]; }) {
    if (modules.length === 0) {
        return (
            <Card variant="primary" style={{ padding: "12px", textAlign: "center", color: "var(--text-muted)", fontSize: "12px" }}>
                No modules positioned {position} profile.
            </Card>
        );
    }

    return (
        <Flex flexDirection="column" gap={8}>
            {modules.map((mod, index) => {
                const isFirst = index === 0;
                const isLast = index === modules.length - 1;

                const authorNames = Array.isArray(mod.authors)
                    ? mod.authors.map(a => (typeof a === "string" ? a : a.name)).join(", ")
                    : "Unknown";

                return (
                    <Card
                        key={mod.id}
                        variant="primary"
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "10px 14px",
                            backgroundColor: "var(--background-secondary, #2b2d31)",
                            borderRadius: "8px",
                            opacity: mod.enabled ? 1 : 0.65,
                            transition: "opacity 0.15s ease",
                        }}
                    >
                        <Flex alignItems="center" gap={12} style={{ flex: 1, minWidth: 0 }}>
                            {/* Reorder buttons */}
                            <Flex flexDirection="column" gap={2} style={{ flexShrink: 0 }}>
                                <button
                                    onClick={() => moveModule(mod.id, "up")}
                                    disabled={isFirst}
                                    title="Move Up"
                                    style={{
                                        background: "none",
                                        border: "none",
                                        cursor: isFirst ? "default" : "pointer",
                                        color: isFirst ? "var(--text-muted)" : "var(--header-primary)",
                                        opacity: isFirst ? 0.3 : 0.8,
                                        fontSize: "10px",
                                        padding: "2px",
                                        lineHeight: 1,
                                    }}
                                >
                                    ▲
                                </button>
                                <button
                                    onClick={() => moveModule(mod.id, "down")}
                                    disabled={isLast}
                                    title="Move Down"
                                    style={{
                                        background: "none",
                                        border: "none",
                                        cursor: isLast ? "default" : "pointer",
                                        color: isLast ? "var(--text-muted)" : "var(--header-primary)",
                                        opacity: isLast ? 0.3 : 0.8,
                                        fontSize: "10px",
                                        padding: "2px",
                                        lineHeight: 1,
                                    }}
                                >
                                    ▼
                                </button>
                            </Flex>

                            {/* Icon */}
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    width: "32px",
                                    height: "32px",
                                    borderRadius: "8px",
                                    backgroundColor: "var(--background-tertiary, #1e1f22)",
                                    fontSize: "16px",
                                    flexShrink: 0,
                                }}
                            >
                                {typeof mod.icon === "string" ? mod.icon : mod.icon ? <mod.icon /> : "📦"}
                            </div>

                            {/* Info */}
                            <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                                <Flex alignItems="center" gap={6}>
                                    <BaseText size="md" weight="semibold" style={{ color: "var(--header-primary)" }}>
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

                        {/* Controls */}
                        <Flex alignItems="center" gap={8} style={{ flexShrink: 0, marginLeft: "12px" }}>
                            <select
                                value={mod.position ?? "above"}
                                onChange={e => setModulePosition(mod.id, e.target.value as ModulePosition)}
                                style={{
                                    fontSize: "11px",
                                    padding: "4px 8px",
                                    borderRadius: "4px",
                                    backgroundColor: "var(--background-tertiary, #1e1f22)",
                                    color: "var(--text-normal, #dbdee1)",
                                    border: "1px solid var(--background-modifier-accent, #3f4147)",
                                    cursor: "pointer",
                                }}
                            >
                                <option value="above">Above</option>
                                <option value="below">Below</option>
                            </select>

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
                                        style={{ padding: "4px 8px" }}
                                    >
                                        ✏️
                                    </Button>
                                    <Button
                                        size="small"
                                        variant="dangerPrimary"
                                        title="Uninstall"
                                        onClick={() => uninstallCustomModule(mod.id)}
                                        style={{ padding: "4px 8px" }}
                                    >
                                        🗑️
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
                                    style={{ padding: "4px 8px" }}
                                >
                                    ⚙️
                                </Button>
                            )}

                            <FormSwitch
                                title=""
                                value={mod.enabled}
                                onChange={v => setModuleEnabled(mod.id, v)}
                                hideBorder
                            />
                        </Flex>
                    </Card>
                );
            })}
        </Flex>
    );
}
