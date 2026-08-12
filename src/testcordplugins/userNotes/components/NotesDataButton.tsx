/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findComponentByCodeLazy } from "@webpack";

import { NotesDataIcon } from "./Icons";
import { openNotesDataModal } from "./NotesDataModal";

const HeaderBarIcon = findComponentByCodeLazy(".HEADER_BAR_BADGE_TOP:", '"top"===c');

export function OpenNotesDataButton() {
    return (
        <HeaderBarIcon
            className="vc-plugin-icon-button vc-notes-toolbox-button"
            iconClassName="vc-plugin-icon-button"
            onClick={() => openNotesDataModal()}
            tooltip={"Open Notes Data"}
            icon={NotesDataIcon}
        />
    );
}
