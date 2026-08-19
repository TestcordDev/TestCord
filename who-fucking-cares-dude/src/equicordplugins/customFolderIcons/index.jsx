/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 sadan
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { EquicordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { makeContextItem } from "./components";
import { settings } from "./settings";
import { int2rgba } from "./util";
export default definePlugin({
    name: "CustomFolderIcons",
    description: "Customize folder icons with any png",
    tags: ["Appearance", "Customisation", "Organisation"],
    authors: [EquicordDevs.sadan],
    settings,
    patches: [
        {
            find: "#{intl::GUILD_FOLDER_TOOLTIP_A11Y_LABEL}",
            replacement: {
                match: /(\(0,\i\.jsx\)\(\i,\{folderNode:(\i),hovered:\i,sorting:\i\}\))/,
                replace: "($self.shouldReplace({folderNode:$2})?$self.replace({folderNode:$2}):$1)"
            }
        },
    ],
    contextMenus: {
        "guild-context": (menuItems, props) => {
            if (!("folderId" in props))
                return;
            menuItems.push(makeContextItem(props));
        }
    },
    shouldReplace(props) {
        return !!(settings.store.folderIcons?.[props.folderNode.id]?.url);
    },
    replace(props) {
        const folderSettings = settings.store.folderIcons;
        if (folderSettings && folderSettings[props.folderNode.id]) {
            const data = folderSettings[props.folderNode.id];
            return (<div style={{
                    backgroundColor: int2rgba(props.folderNode.color, +settings.store.solidIcon || .4),
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    width: "100%",
                    height: "100%"
                }}>
                    <img alt="" src={data.url} width={`${data.size ?? 100}%`} height={`${data.size ?? 100}%`}/>
                </div>);
        }
    }
});
