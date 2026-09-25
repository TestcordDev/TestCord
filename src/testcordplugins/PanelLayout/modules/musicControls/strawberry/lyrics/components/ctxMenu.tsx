/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { CopyIcon } from "@components/Icons";
import { copyWithToast } from "@utils/discord";
import { ContextMenuApi, Menu, React, useStateFromStores } from "@webpack/common";

import { StrawberryLrcStore } from "../providers/store";

export function LyricsContextMenu() {
    const lyrics = useStateFromStores([StrawberryLrcStore], () => StrawberryLrcStore.lyrics);

    const fullLyricsText = lyrics?.map(l => l.text).filter(Boolean).join("\n") ?? "";

    return (
        <Menu.Menu
            navId="eq-strawberry-lyrics-menu"
            onClose={ContextMenuApi.closeContextMenu}
            aria-label="Strawberry Lyrics Menu"
        >
            <Menu.MenuItem
                id="eq-strawberry-copy-lyrics"
                label="Copy Full Lyrics"
                action={() => copyWithToast(fullLyricsText)}
                disabled={!fullLyricsText}
                icon={CopyIcon}
            />
        </Menu.Menu>
    );
}
