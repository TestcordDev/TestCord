/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { SafetyIcon } from "@components/Icons";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { Menu, SelectedGuildStore } from "@webpack/common";
import { showCustomDurationModal, showPrefefinedDurationModal } from "./Modals";
/** ** BEGIN CONFIG  ****/
const GUILD_ID = "1274790619146879108"; // SERVER ID
/** **  END CONFIG  ****/
const UserContext = (children, { user }) => {
    if (!user)
        return;
    children.splice(-3, 0, (<>
                {SelectedGuildStore.getGuildId() === GUILD_ID &&
            <>
                        <Menu.MenuItem id="vc-staff" label="Staff">
                            <Menu.MenuItem id="mute-1h" color="#ff0000" label="Mute for 1 hour" action={() => {
                    showPrefefinedDurationModal("1h", user.id);
                }} icon={SafetyIcon}/>
                            <Menu.MenuItem id="mute-2h" color="#ff0000" label="Mute for 2 hours" action={() => {
                    showPrefefinedDurationModal("2h", user.id);
                }} icon={SafetyIcon}/>
                            <Menu.MenuItem id="mute-custom" color="#ff0000" label="Mute (custom duration)" action={() => {
                    showCustomDurationModal(user.id);
                }} icon={SafetyIcon}/>
                        </Menu.MenuItem>
                    </>}
            </>));
};
export default definePlugin({
    name: "PunishmentCommands",
    description: "Allows you to send a command in chat to punish someone, right from the context menu",
    tags: ["Servers", "Commands"],
    authors: [Devs.nin0dev],
    contextMenus: {
        "user-context": UserContext
    }
});
