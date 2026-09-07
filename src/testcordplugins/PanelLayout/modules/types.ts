/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { ComponentType } from "react";

export type ModulePosition = "above" | "below";

export type CustomModuleType = "html" | "react" | "remote";

export interface UserAreaModule {
    id: string;
    name: string;
    description: string;
    authors?: Array<{ name: string; id?: bigint }> | string[];
    version?: string;
    tags?: string[];
    icon?: ComponentType<{ className?: string; style?: React.CSSProperties }> | string;
    enabled: boolean;
    order: number;
    position?: ModulePosition;
    render: ComponentType<{ module: UserAreaModule }>;
    settingsComponent?: ComponentType<{ onClose?: () => void; modalProps?: any }>;
    onEnable?: () => void | Promise<void>;
    onDisable?: () => void;
    isCustom?: boolean;
    customType?: CustomModuleType;
    customCode?: string;
    customCss?: string;
    sourceUrl?: string;
}

export interface StoredModuleState {
    enabled?: boolean;
    order?: number;
    position?: ModulePosition;
}

export interface CustomModuleData {
    id?: string;
    name: string;
    description: string;
    author?: string;
    version?: string;
    tags?: string[];
    customType: CustomModuleType;
    customCode: string;
    customCss?: string;
    sourceUrl?: string;
    position?: ModulePosition;
    enabled?: boolean;
    order?: number;
}

export interface MarketplaceCatalogItem {
    id: string;
    name: string;
    description: string;
    authors?: Array<{ name: string; id?: bigint }> | string[];
    version: string;
    tags: string[];
    icon?: string;
    category: "audio" | "developer" | "utility" | "custom" | "appearance";
    isBuiltin?: boolean;
    previewComponent?: ComponentType;
    factory: () => Omit<UserAreaModule, "order" | "enabled">;
}

export type UserAreaItemType = "voice-connected" | "native-activity-banner" | "account-panel" | "module";

export interface UserAreaReorderItem {
    id: string;
    type: UserAreaItemType;
    name: string;
    description: string;
    order: number;
    enabled: boolean;
    moduleId?: string;
    hasSettings?: boolean;
}
