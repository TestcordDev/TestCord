/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React } from "@webpack/common";

export interface IconProps extends React.SVGProps<SVGSVGElement> {
    size?: number;
    className?: string;
}

export function ArrowLeftIcon({ size = 20, ...props }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
            <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
    );
}

export function ChevronLeftIcon({ size = 20, ...props }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
            <path d="M15 18l-6-6 6-6" />
        </svg>
    );
}

export function ChevronRightIcon({ size = 20, ...props }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
            <path d="M9 18l6-6-6-6" />
        </svg>
    );
}

export function DownloadIcon({ size = 20, ...props }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
    );
}

export function JumpMessageIcon({ size = 18, ...props }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            <line x1="8" y1="10" x2="16" y2="10" />
            <polyline points="13 7 16 10 13 13" />
        </svg>
    );
}

export function CheckboxEmptyIcon({ size = 18, ...props }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
            <rect x="4" y="4" width="16" height="16" rx="4" />
        </svg>
    );
}

export function CheckboxCheckedIcon({ size = 18, ...props }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
            <rect x="4" y="4" width="16" height="16" rx="4" fill="var(--brand-500)" stroke="var(--brand-500)" />
            <path d="M8 12l3 3 5-6" stroke="#fff" strokeWidth="2.2" />
        </svg>
    );
}

export function CheckAllIcon({ size = 18, ...props }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
            <polyline points="9 11 12 14 22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
    );
}

export function ClearSelectionIcon({ size = 18, ...props }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
    );
}

export function SpinnerIcon({ size = 18, ...props }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true" className="vc-channel-gallery-spin" {...props}>
            <path d="M12 2a10 10 0 0 1 10 10" strokeDasharray="31.4" strokeDashoffset="10" />
        </svg>
    );
}
