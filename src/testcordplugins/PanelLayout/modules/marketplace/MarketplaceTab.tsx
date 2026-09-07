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
import { React, TextInput, useMemo, useState } from "@webpack/common";

import { MARKETPLACE_CATALOG } from "../builtin";
import { registerModule, setModuleEnabled, unregisterModule, useModules } from "../registry";
import type { MarketplaceCatalogItem } from "../types";
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
            {/* Header & Search */}
            <Flex justifyContent="space-between" alignItems="center">
                <div>
                    <BaseText size="md" weight="semibold">
                        Module Marketplace
                    </BaseText>
                    <BaseText size="xs" color="text-muted" style={{ marginTop: "2px" }}>
                        Discover and enable modules to extend and customize your user area.
                    </BaseText>
                </div>
                <Button
                    size="small"
                    variant="primary"
                    onClick={() => openCustomModuleModal()}
                >
                    + Install Custom Module
                </Button>
            </Flex>

            {/* Search Input */}
            <TextInput
                value={searchQuery}
                placeholder="Search modules by name, description, or tag..."
                onChange={(val: string) => setSearchQuery(val)}
            />

            {/* Category Pills */}
            <Flex gap={8} style={{ overflowX: "auto", paddingBottom: "4px" }}>
                {CATEGORIES.map(cat => {
                    const active = selectedCategory === cat.id;
                    return (
                        <div
                            key={cat.id}
                            onClick={() => setSelectedCategory(cat.id)}
                            style={{
                                padding: "5px 12px",
                                borderRadius: "16px",
                                cursor: "pointer",
                                fontSize: "12px",
                                fontWeight: active ? 600 : 500,
                                backgroundColor: active
                                    ? "var(--brand-experiment, #5865f2)"
                                    : "var(--background-secondary, #2b2d31)",
                                color: active ? "#ffffff" : "var(--text-muted)",
                                border: "1px solid var(--background-modifier-accent, rgba(255, 255, 255, 0.08))",
                                transition: "all 0.15s ease",
                                whiteSpace: "nowrap",
                            }}
                        >
                            {cat.label}
                        </div>
                    );
                })}
            </Flex>

            {/* Catalog Grid */}
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
                                backgroundColor: "var(--background-secondary, #2b2d31)",
                                borderRadius: "8px",
                                border: "1px solid var(--background-modifier-accent, rgba(255, 255, 255, 0.06))",
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
                                                width: "36px",
                                                height: "36px",
                                                borderRadius: "8px",
                                                backgroundColor: "var(--background-tertiary, #1e1f22)",
                                                fontSize: "18px",
                                            }}
                                        >
                                            {item.icon || "📦"}
                                        </div>
                                        <div>
                                            <BaseText size="md" weight="semibold" style={{ color: "var(--header-primary)" }}>
                                                {item.name}
                                            </BaseText>
                                            <BaseText size="xs" color="text-muted">
                                                by {authorNames} • v{item.version}
                                            </BaseText>
                                        </div>
                                    </div>
                                    {isInstalled && (
                                        <span
                                            style={{
                                                fontSize: "10px",
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

                                <Paragraph style={{ fontSize: "12px", color: "var(--text-normal)", lineHeight: "1.4", margin: "8px 0" }}>
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
                                            #{tag}
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
                                        Install Module
                                    </Button>
                                )}
                            </Flex>
                        </Card>
                    );
                })}
            </div>

            {/* Custom Installed Modules Section in Marketplace if category is all or custom */}
            {(selectedCategory === "all" || selectedCategory === "custom") && customInstalled.length > 0 && (
                <div style={{ marginTop: "16px" }}>
                    <BaseText size="xs" weight="bold" color="text-muted" style={{ textTransform: "uppercase", marginBottom: "8px", letterSpacing: "0.5px" }}>
                        Installed Custom Modules ({customInstalled.length})
                    </BaseText>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "12px" }}>
                        {customInstalled.map(mod => (
                            <Card
                                key={mod.id}
                                variant="primary"
                                style={{
                                    padding: "12px",
                                    backgroundColor: "var(--background-secondary, #2b2d31)",
                                    borderRadius: "8px",
                                }}
                            >
                                <Flex justifyContent="space-between" alignItems="center">
                                    <Flex alignItems="center" gap={8}>
                                        <span style={{ fontSize: "18px" }}>✨</span>
                                        <div>
                                            <BaseText size="md" weight="semibold">{mod.name}</BaseText>
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

function Paragraph({ children, style }: { children: React.ReactNode; style?: React.CSSProperties; }) {
    return <p style={{ margin: 0, ...style }}>{children}</p>;
}
