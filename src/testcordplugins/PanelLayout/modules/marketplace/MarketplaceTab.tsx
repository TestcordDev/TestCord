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
import { Paragraph } from "@components/Paragraph";
import { React, TextInput, useMemo, useState } from "@webpack/common";

import { MARKETPLACE_CATALOG } from "../builtin";
import { getModuleIcon, SectionHeading } from "../icons";
import { registerModule, setModuleEnabled, useModules } from "../registry";
import { openCustomModuleModal } from "./CustomModuleModal";

const CATEGORIES = [
    { id: "all", label: "All Modules" },
    { id: "audio", label: "Media & Audio" },
    { id: "developer", label: "Developer" },
    { id: "utility", label: "Utilities" },
    { id: "appearance", label: "Appearance" },
    { id: "custom", label: "Custom" },
] as const;

export function MarketplaceTab() {
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedCategory, setSelectedCategory] = useState<string>("all");

    const installedModules = useModules();
    const installedMap = useMemo(() => {
        const map = new Map<string, boolean>();
        installedModules.forEach(m => map.set(m.id, m.enabled));
        return map;
    }, [installedModules]);

    const filteredCatalog = useMemo(() => {
        const q = searchQuery.toLowerCase().trim();
        return MARKETPLACE_CATALOG.filter(item => {
            if (selectedCategory !== "all" && item.category !== selectedCategory) {
                return false;
            }
            if (!q) return true;
            return (
                item.name.toLowerCase().includes(q) ||
                item.description.toLowerCase().includes(q) ||
                item.tags.some(t => t.toLowerCase().includes(q))
            );
        });
    }, [searchQuery, selectedCategory]);

    const customInstalled = useMemo(() => {
        return installedModules.filter(m => m.isCustom);
    }, [installedModules]);

    return (
        <Flex flexDirection="column" gap={16}>
            <Flex justifyContent="space-between" alignItems="center">
                <SectionHeading>Module Marketplace</SectionHeading>
                <Button
                    size="small"
                    variant="primary"
                    onClick={() => openCustomModuleModal()}
                >
                    Add Custom Module
                </Button>
            </Flex>

            <TextInput
                value={searchQuery}
                placeholder="Search modules..."
                onChange={(val: string) => setSearchQuery(val)}
            />

            <Flex gap={8} style={{ overflowX: "auto", paddingBottom: "2px" }}>
                {CATEGORIES.map(cat => {
                    const active = selectedCategory === cat.id;
                    return (
                        <div
                            key={cat.id}
                            onClick={() => setSelectedCategory(cat.id)}
                            style={{
                                padding: "6px 14px",
                                borderRadius: "16px",
                                cursor: "pointer",
                                fontSize: "12px",
                                fontWeight: active ? 600 : 500,
                                backgroundColor: active
                                    ? "var(--brand-experiment, var(--background-brand))"
                                    : "var(--background-secondary, rgba(255, 255, 255, 0.05))",
                                color: active ? "#ffffff" : "var(--text-muted)",
                                border: "1px solid var(--background-modifier-accent, rgba(255, 255, 255, 0.08))",
                                transition: "background-color 0.15s ease, color 0.15s ease",
                                whiteSpace: "nowrap",
                            }}
                        >
                            {cat.label}
                        </div>
                    );
                })}
            </Flex>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "12px" }}>
                {filteredCatalog.map(item => {
                    const isInstalled = installedMap.has(item.id);
                    const isEnabled = installedMap.get(item.id) ?? false;

                    const authorNames = Array.isArray(item.authors)
                        ? item.authors.map(a => (typeof a === "string" ? a : a.name)).join(", ")
                        : "Testcord";

                    return (
                        <Card
                            key={item.id}
                            variant="primary"
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                justifyContent: "space-between",
                                padding: "14px",
                            }}
                        >
                            <div>
                                <Flex justifyContent="space-between" alignItems="flex-start" style={{ marginBottom: "8px" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                        <div
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                width: "32px",
                                                height: "32px",
                                                borderRadius: "6px",
                                                backgroundColor: "var(--background-modifier-accent, rgba(255, 255, 255, 0.08))",
                                                color: "var(--interactive-normal)",
                                                flexShrink: 0,
                                            }}
                                        >
                                            {getModuleIcon(item.id, 18)}
                                        </div>
                                        <div>
                                            <BaseText size="md" weight="medium" color="text-strong">
                                                {item.name}
                                            </BaseText>
                                            <BaseText size="xs" color="text-muted">
                                                by {authorNames}
                                            </BaseText>
                                        </div>
                                    </div>
                                    {isInstalled && (
                                        <span
                                            style={{
                                                fontSize: "11px",
                                                fontWeight: 600,
                                                color: isEnabled ? "var(--status-positive, #23a55a)" : "var(--text-muted)",
                                                backgroundColor: isEnabled ? "rgba(35, 165, 90, 0.15)" : "var(--background-tertiary)",
                                                padding: "2px 6px",
                                                borderRadius: "4px",
                                            }}
                                        >
                                            {isEnabled ? "Active" : "Disabled"}
                                        </span>
                                    )}
                                </Flex>

                                <Paragraph style={{ fontSize: "12px", color: "var(--text-muted)", lineHeight: "1.4", margin: "8px 0" }}>
                                    {item.description}
                                </Paragraph>

                                <Flex gap={4} style={{ flexWrap: "wrap", marginBottom: "12px" }}>
                                    {item.tags.map(tag => (
                                        <span
                                            key={tag}
                                            style={{
                                                fontSize: "10px",
                                                color: "var(--text-muted)",
                                                backgroundColor: "var(--background-tertiary, #1e1f22)",
                                                padding: "2px 6px",
                                                borderRadius: "4px",
                                            }}
                                        >
                                            {tag}
                                        </span>
                                    ))}
                                </Flex>
                            </div>

                            <Flex justifyContent="space-between" alignItems="center" style={{ borderTop: "1px solid var(--background-modifier-accent)", paddingTop: "10px" }}>
                                {isInstalled ? (
                                    <Flex alignItems="center" gap={8} style={{ width: "100%", justifyContent: "space-between" }}>
                                        <BaseText size="xs" color="text-muted">
                                            {isEnabled ? "Enabled in user area" : "Disabled"}
                                        </BaseText>
                                        <FormSwitch
                                            title=""
                                            value={isEnabled}
                                            onChange={v => setModuleEnabled(item.id, v)}
                                            hideBorder
                                        />
                                    </Flex>
                                ) : (
                                    <Button
                                        size="small"
                                        variant="primary"
                                        style={{ width: "100%" }}
                                        onClick={() => {
                                            const mod = item.factory();
                                            registerModule({ ...mod, enabled: true });
                                        }}
                                    >
                                        Enable Module
                                    </Button>
                                )}
                            </Flex>
                        </Card>
                    );
                })}
            </div>

            {(selectedCategory === "all" || selectedCategory === "custom") && customInstalled.length > 0 && (
                <div style={{ marginTop: "8px" }}>
                    <SectionHeading>Installed Custom Modules ({customInstalled.length})</SectionHeading>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "12px", marginTop: "10px" }}>
                        {customInstalled.map(mod => (
                            <Card
                                key={mod.id}
                                variant="primary"
                                style={{ padding: "12px" }}
                            >
                                <Flex justifyContent="space-between" alignItems="center">
                                    <Flex alignItems="center" gap={8}>
                                        <div
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                width: "28px",
                                                height: "28px",
                                                borderRadius: "6px",
                                                backgroundColor: "var(--background-modifier-accent, rgba(255, 255, 255, 0.08))",
                                                color: "var(--interactive-normal)",
                                            }}
                                        >
                                            {getModuleIcon(mod.id, 16)}
                                        </div>
                                        <div>
                                            <BaseText size="md" weight="medium" color="text-strong">{mod.name}</BaseText>
                                            <BaseText size="xs" color="text-muted">{mod.description || "Custom module"}</BaseText>
                                        </div>
                                    </Flex>
                                    <FormSwitch
                                        title=""
                                        value={mod.enabled}
                                        onChange={v => setModuleEnabled(mod.id, v)}
                                        hideBorder
                                    />
                                </Flex>
                            </Card>
                        ))}
                    </div>
                </div>
            )}
        </Flex>
    );
}
