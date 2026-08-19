/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { BaseText } from "./BaseText";
export function Paragraph({ children, size = "sm", weight = "normal", ...restProps }) {
    return (<BaseText tag="p" size={size} weight={weight} {...restProps}>
            {children}
        </BaseText>);
}
