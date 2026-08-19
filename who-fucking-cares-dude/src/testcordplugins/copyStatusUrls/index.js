/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { copyToClipboard } from "@utils/clipboard";
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { findByCodeLazy } from "@webpack";
import { Toasts } from "@webpack/common";
// This is an API call if the result is not cached
// i looked for an hour and did not find a better way to do this
const getMetadataFromApi = findByCodeLazy("null/undefined");
export default definePlugin({
    name: "CopyStatusUrls",
    description: "Copy the users status url when you right-click it",
    tags: ["Activity", "Utility"],
    authors: [TestcordDevs.x2b],
    patches: [
        {
            find: '?"PRESS_WATCH_ON_CRUNCHYROLL_BUTTON"',
            replacement: {
                match: /(?=onClick)(?=.*index:(\i))/,
                replace: "onContextMenu: $self.makeContextMenu(arguments[0], $1),"
            }
        }
    ],
    makeContextMenu(props, index) {
        return async () => {
            try {
                const { button_urls } = await getMetadataFromApi(props.activity, props.user.id);
                if (!button_urls[index]) {
                    throw new Error("button_urls does not contain index");
                }
                await copyToClipboard(button_urls[index]);
                Toasts.show({
                    id: Toasts.genId(),
                    message: "Copied URL",
                    type: Toasts.Type.SUCCESS,
                    options: {
                        position: Toasts.Position.TOP
                    }
                });
            }
            catch (e) {
                console.error(e);
                Toasts.show({
                    id: Toasts.genId(),
                    message: "Error copying URL, check console for more info",
                    type: Toasts.Type.FAILURE,
                    options: {
                        position: Toasts.Position.TOP
                    }
                });
            }
        };
    }
});
