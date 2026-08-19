/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { BaseText } from "@components/BaseText";
import { PlusIcon } from "@components/Icons";
import { getIntlMessage } from "@utils/discord";
import { DecorationGridItem } from ".";
export default function DecorationGridCreate(props) {
    return <DecorationGridItem {...props} isSelected={false}>
        <PlusIcon />
        <BaseText size="xs" color="text-strong">
            {getIntlMessage("CREATE")}
        </BaseText>
    </DecorationGridItem>;
}
