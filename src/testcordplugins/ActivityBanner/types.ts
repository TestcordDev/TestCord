/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Activity, Application } from "@vencord/discord-types";
import type React from "react";

export interface ResolvedActivityAsset {
    src: string;
    alt?: string;
    tooltip?: string;
}

export interface ResolvedActivityData {
    activity: Activity;
    application?: Application;
    name: string;
    details?: string;
    state?: string;
    typeLabel: string;
    timestamps?: {
        start?: number;
        end?: number;
    };
    largeImage?: ResolvedActivityAsset;
    smallImage?: ResolvedActivityAsset;
    partyInfo?: string;
    buttons?: string[];
}

export interface ActivityInfoProps {
    name?: string;
    application?: Application;
    isCurrentlyRunningGame: boolean;
    onClickNotSharing?: () => void;
    TitleComponent?: React.ComponentType<{ name?: string; applicationId?: string; }>;
    defaultTitle: React.ReactNode;
    defaultStatus: React.ReactNode;
}

export interface ActivityIconProps {
    name?: string;
    application?: Application;
    game?: any;
    isStreaming: boolean;
    ref?: any;
    IconComponent?: React.ComponentType<{
        name?: string;
        application?: Application;
        game?: any;
        isStreaming?: boolean;
        ref?: any;
    }>;
    defaultIcon: React.ReactNode;
}

export type HijackedInfoProps = ActivityInfoProps;
export type HijackedIconProps = ActivityIconProps;
