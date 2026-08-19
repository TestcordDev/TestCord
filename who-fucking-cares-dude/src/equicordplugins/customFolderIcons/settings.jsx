/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 sadan
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
export const settings = definePluginSettings({
    solidIcon: {
        type: 3 /* OptionType.BOOLEAN */,
        default: false,
        description: "Use a solid background on the background of the image"
    },
    folderIcons: {
        type: 6 /* OptionType.COMPONENT */,
        hidden: true,
        description: "folder icon settings",
        component: () => <></>
    }
});
