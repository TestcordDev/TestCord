/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { makeContextItem } from "./components";
import settings from "./settings";
import { int2rgba } from "./util";
export default definePlugin({
    settings,
    name: "CustomFolderIcons",
    description: "Customize folder icons with any png",
    tags: ["Customisation", "Appearance"],
    authors: [TestcordDevs.x2b],
    patches: [
        {
            find: ".expandedFolderIconWrapper",
            replacement: {
                match: /(return.{0,80}expandedFolderIconWrapper.*,)(\(0,..jsxs\)\(.*]}\))/,
                replace: "$1$self.shouldReplace(arguments[0])?$self.replace(arguments[0]):$2"
            }
        }
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
                    <img src={data.url} width={`${data.size ?? 100}%`} height={`${data.size ?? 100}%`}/>
                </div>);
        }
    }
});
