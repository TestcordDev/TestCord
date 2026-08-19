/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
export function FloodIcon({ width = 20, height = 20, className, color }) {
    return (<svg aria-hidden="true" role="img" xmlns="http://www.w3.org/2000/svg" width={width} height={height} className={className} fill="none" viewBox="0 0 24 24">
            <path fill={color ?? "currentColor"} fillRule="evenodd" d="M22 4v1.51a6 6 0 0 1-1.76 4.25l-4.1 4.1a.5.5 0 0 0-.14.35v3.74a3 3 0 0 1-.66 1.87l-1.79 2.24a.5.5 0 0 1-.86-.14l-1.86-5.02a.5.5 0 0 0-.11-.18l-3.46-3.46a.5.5 0 0 0-.17-.11l-4.8-1.85a.5.5 0 0 1-.15-.85l2.02-1.73A3 3 0 0 1 6.1 8h3.68a.5.5 0 0 0 .36-.15l4.1-4.1A6 6 0 0 1 18.48 2H20a2 2 0 0 1 2 2Z" clipRule="evenodd"/>
            <path fill={color ?? "currentColor"} d="M17 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/>
            <path fill={color ?? "currentColor"} d="M9 19a1 1 0 0 0-1-1H7a1 1 0 0 1-1-1v-1a1 1 0 0 0-1-1 3 3 0 0 0-3 3v3a1 1 0 0 0 1 1h3a3 3 0 0 0 3-3Z"/>
        </svg>);
}
