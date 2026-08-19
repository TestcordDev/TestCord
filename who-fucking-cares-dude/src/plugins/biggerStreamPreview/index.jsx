/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/
import { ScreenshareIcon } from "@components/Icons";
import { Devs } from "@utils/constants";
import { openImageModal } from "@utils/discord";
import definePlugin from "@utils/types";
import { ApplicationStreamingStore, ApplicationStreamPreviewStore, Menu } from "@webpack/common";
export const handleViewPreview = async ({ guildId, channelId, ownerId }) => {
    const previewUrl = await ApplicationStreamPreviewStore.getPreviewURL(guildId, channelId, ownerId);
    if (!previewUrl)
        return;
    openImageModal({
        url: previewUrl,
        height: 720,
        width: 1280
    });
};
export const addViewStreamContext = (children, { userId }) => {
    const stream = ApplicationStreamingStore.getAnyStreamForUser(userId);
    if (!stream)
        return;
    const streamPreviewItem = (<Menu.MenuItem label="View Stream Preview" id="view-stream-preview" icon={ScreenshareIcon} action={() => stream && handleViewPreview(stream)} disabled={!stream}/>);
    children.push(<Menu.MenuSeparator />, streamPreviewItem);
};
export const streamContextPatch = (children, { stream }) => {
    return addViewStreamContext(children, { userId: stream.ownerId });
};
export const userContextPatch = (children, { user }) => {
    if (user)
        return addViewStreamContext(children, { userId: user.id });
};
export default definePlugin({
    name: "BiggerStreamPreview",
    description: "This plugin allows you to enlarge stream previews",
    tags: ["Media", "Appearance"],
    authors: [Devs.phil],
    contextMenus: {
        "user-context": userContextPatch,
        "stream-context": streamContextPatch
    }
});
