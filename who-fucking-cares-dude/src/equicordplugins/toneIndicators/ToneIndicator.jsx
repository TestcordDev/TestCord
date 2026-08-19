/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Tooltip } from "@webpack/common";
export default function ToneIndicator({ prefix, indicator, desc, }) {
    return (<Tooltip text={desc}>
            {tooltipProps => (<span {...tooltipProps} style={{
                color: "var(--text-default)",
                userSelect: "text",
            }}>
                    {prefix}{indicator}
                </span>)}
        </Tooltip>);
}
