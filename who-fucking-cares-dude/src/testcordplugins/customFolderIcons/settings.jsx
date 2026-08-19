/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
const settings = definePluginSettings({
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
export default settings;
