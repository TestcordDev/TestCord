/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { BaseText } from "@components/BaseText";
import { NoEntrySignIcon } from "@components/Icons";
import { getIntlMessage } from "@utils/discord";
import { DecorationGridItem } from ".";
export default function DecorationGridNone(props) {
    return <DecorationGridItem {...props}>
        <NoEntrySignIcon />
        <BaseText size="xs" color="text-strong">
            {getIntlMessage("NONE")}
        </BaseText>
    </DecorationGridItem>;
}
