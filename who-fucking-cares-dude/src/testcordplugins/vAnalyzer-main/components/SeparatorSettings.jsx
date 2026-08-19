/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Divider } from "@components/Divider";
import { HeadingSecondary } from "@components/Heading";
import { Margins } from "@components/margins";
import { React } from "@webpack/common";
export default function SeparatorSettings({ label }) {
    return (<div className={Margins.top20}>
            <HeadingSecondary className={Margins.bottom8}>{label}</HeadingSecondary>
            <Divider className={Margins.bottom8}/>
        </div>);
}
