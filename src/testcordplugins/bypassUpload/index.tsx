/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { OpenExternalIcon } from "@components/Icons";
import { TestcordDevs } from "@utils/constants";
import { insertTextIntoChatInputBox } from "@utils/discord";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { Menu, PermissionsBits, PermissionStore, SelectedChannelStore, showToast, Toasts } from "@webpack/common";

const Native = VencordNative.pluginHelpers.BigFileUpload as PluginNative<typeof import("./native")>;

const settings = definePluginSettings({
    fileUploader: {
        type: OptionType.SELECT,
        options: [
            { label: "Catbox", value: "Catbox", default: true },
            { label: "Litterbox", value: "Litterbox" },
            { label: "GoFile", value: "GoFile" },
        ],
        description: "Select the file uploader service",
        hidden: false
    },
    autoSend: {
        type: OptionType.SELECT,
        options: [
            { label: "Yes", value: "Yes" },
            { label: "No", value: "No", default: true },
        ],
        description: "Auto-Send",
        hidden: false
    },
    catboxUserHash: {
        type: OptionType.STRING,
        default: "",
        description: "User hash for Catbox uploader (optional)",
        hidden: false
    },
    litterboxTime: {
        type: OptionType.SELECT,
        options: [
            { label: "1 hour", value: "1h", default: true },
            { label: "12 hours", value: "12h" },
            { label: "24 hours", value: "24h" },
            { label: "72 hours", value: "72h" },
        ],
        description: "Duration for files on Litterbox before they are deleted",
        hidden: false
    },
});

async function uploadFile(file: File, channelId: string) {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const fileName = file.name;
        const fileSizeMB = file.size / (1024 * 1024);

        // Note: This logic always uploads to Catbox based on your native function usage below.
        // If you want to use the other services, you need to pass the selection from settings here.
        const uploadResult = await Native.uploadFileToCatboxNative("https://catbox.moe/user/api.php", arrayBuffer, fileName, file.type, "");

        if (uploadResult.startsWith("https://") || uploadResult.startsWith("http://")) {
            const videoExtensions = [".mp4", ".mkv", ".webm", ".avi", ".mov", ".flv", ".wmv", ".m4v", ".mpg", ".mpeg", ".3gp", ".ogv"];
            let finalUrl = uploadResult;

            if (fileSizeMB >= 150 && videoExtensions.some(ext => finalUrl.endsWith(ext))) {
                finalUrl = `https://embeds.video/${finalUrl}`;
            }

            insertTextIntoChatInputBox(`${finalUrl} `);
            showToast("File uploaded!", Toasts.Type.SUCCESS);
        } else {
            console.error("Error uploading file:", uploadResult);
            showToast("Error uploading file. Check console for more info.", Toasts.Type.FAILURE);
        }
    } catch (error) {
        console.error("Error uploading file:", error);
        showToast("Error uploading file. Check console for more info.", Toasts.Type.FAILURE);
    }
}

function triggerFileUpload() {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.style.display = "none";

    fileInput.onchange = async event => {
        const target = event.target as HTMLInputElement;
        if (target && target.files && target.files.length > 0) {
            const file = target.files[0];
            if (file) {
                const channelId = SelectedChannelStore.getChannelId();
                await uploadFile(file, channelId);
            } else {
                showToast("No file selected");
            }
        }
    };

    document.body.appendChild(fileInput);
    fileInput.click();
    document.body.removeChild(fileInput);
}

const ctxMenuPatch: NavContextMenuPatchCallback = (children, props) => {
    if (props.channel.guild_id && !PermissionStore.can(PermissionsBits.SEND_MESSAGES, props.channel)) return;

    children.splice(1, 0,
        <Menu.MenuItem
            id="vc-big-file-upload"
            label={
                <div>
                    <OpenExternalIcon height={24} width={24} />
                    <div>Upload a Big File</div>
                </div>
            }
            action={triggerFileUpload}
        />
    );
};

export default definePlugin({
    name: "BigFileUpload",
    description: "Bypass Discord's upload limit by uploading files using the 'Upload a Big File' button and they'll get uploaded as links into chat via file uploaders.",
    tags: ["Utility", "Chat"],
    authors: [TestcordDevs.x2b],
    settings,

    contextMenus: {
        "channel-attach": ctxMenuPatch,
    },
});
