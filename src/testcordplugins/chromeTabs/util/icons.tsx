/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findComponentByCodeLazy } from "@webpack";
import { JSX } from "react";

/** Discord's own icon components, so tabs match the rest of the client */
export const QuestIcon = findComponentByCodeLazy("10.47a.76.76");
export const ShopIcon = findComponentByCodeLazy("M2.63 4.19A3");
export const EnvelopeIcon = findComponentByCodeLazy("M1.16 5.02c-.1.28");
export const DiscoveryIcon = findComponentByCodeLazy("M7.74 9.3A2 2 0 0 1 9.3 7.75l7.22");
export const NitroIcon = findComponentByCodeLazy("M16.23 12c0 1.29-.95 2.25");
export const FriendsIcon = findComponentByCodeLazy("12h1a8");
export const ICYMIIcon = findComponentByCodeLazy("0-.66-1.75h-4.81a");
export const ActivityIcon = findComponentByCodeLazy("17.3 9 16.8 9 15.92V8.1Z");
export const CircleQuestionIcon = findComponentByCodeLazy("10.58l-3.3-3.3a1");

/** Renders the `#`/voice/forum glyph for a channel */
export const ChannelTypeIcon = findComponentByCodeLazy('"ChannelItemIcon")');

export function LibraryIcon(props: { height?: number; width?: number; }): JSX.Element {
    const { height = 16, width = 16 } = props;

    return (
        <svg viewBox="0 0 24 24" height={height} width={width} fill="none" aria-hidden="true">
            <path
                fill="currentColor"
                d="M3 3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3zm2 1v16h10V4H5zm13-1h2a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-2V3zm0 2v12h1V5h-1z"
            />
        </svg>
    );
}

export function CloseIcon({ size = 14 }: { size?: number; }): JSX.Element {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
            <path
                fill="currentColor"
                d="M17.3 18.7a1 1 0 0 0 1.4-1.4L13.42 12l5.3-5.3a1 1 0 0 0-1.42-1.4L12 10.58l-5.3-5.3a1 1 0 0 0-1.4 1.42L10.58 12l-5.3 5.3a1 1 0 1 0 1.42 1.4L12 13.42l5.3 5.3Z"
            />
        </svg>
    );
}

export function PlusIcon({ size = 16 }: { size?: number; }): JSX.Element {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
            <path
                fill="currentColor"
                d="M13 4a1 1 0 1 0-2 0v7H4a1 1 0 1 0 0 2h7v7a1 1 0 1 0 2 0v-7h7a1 1 0 1 0 0-2h-7V4Z"
            />
        </svg>
    );
}

export function ChevronDownIcon({ size = 16 }: { size?: number; }): JSX.Element {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
            <path
                fill="currentColor"
                d="M5.3 8.3a1 1 0 0 1 1.4 0L12 13.58l5.3-5.3a1 1 0 1 1 1.4 1.42l-6 6a1 1 0 0 1-1.4 0l-6-6a1 1 0 0 1 0-1.42Z"
            />
        </svg>
    );
}
