/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
export default definePlugin({
    name: "NewlinesInCommands",
    description: "Allows shift+enter to create new lines in command inputs.",
    tags: ["Chat", "Commands"],
    authors: [TestcordDevs.x2b],
    patches: [
        {
            find: '"italics"),!0;',
            replacement: [
                {
                    match: /case (\i\.\i)\.TAB:if\(null!=(\i).selection&&\i\((\i)(?=.{0,300}(\i\.\i\.insertText))/,
                    replace: (orig, keys, editor, event, insertText) => {
                        return `case ${keys}.ENTER:
                                    if(${event}.shiftKey){
                                        ${event}.preventDefault();
                                        ${event}.stopPropagation();
                                        ${insertText}(${editor},'\\n');
                                        return true;
                                    }
                                    break;
                                ${orig}`;
                    }
                }
            ]
        },
    ],
});
