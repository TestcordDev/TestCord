/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Flex } from "@components/Flex";
import { Margins } from "@components/margins";
import { Notice } from "@components/Notice";
import { copyWithToast, getCurrentChannel, insertTextIntoChatInputBox, sendMessage } from "@utils/discord";
import definePlugin, { OptionType, type PluginNative } from "@utils/types";
import { chooseFile } from "@utils/web";
import { Menu, showToast, Toasts } from "@webpack/common";

const Native = VencordNative?.pluginHelpers?.AnonLi as PluginNative<typeof import("./native")> | undefined;
const ANON_LI_URL = "https://anon.li/";
const SOURCE_URL = "https://codeberg.org/anonli/anon.li";
const WARRANT_CANARY_URL = "https://anon.li/warrant-canary";

interface IconProps {
    className?: string;
    height?: number | string;
    width?: number | string;
}

const settings = definePluginSettings({
    apiKey: {
        type: OptionType.STRING,
        description: "Anon.li API key used for Drop uploads.",
        default: ""
    },
    expiryDays: {
        type: OptionType.SELECT,
        description: "Days before uploaded drops expire.",
        options: [
            { label: "1 day", value: 1, default: true },
            { label: "3 days", value: 3 },
            { label: "7 days", value: 7 },
            { label: "30 days", value: 30 }
        ] as const
    },
    maxDownloads: {
        type: OptionType.NUMBER,
        description: "Maximum downloads for a drop. Use 0 for no custom limit.",
        default: 0
    },
    sendAfterUpload: {
        type: OptionType.BOOLEAN,
        description: "Send the Anon.li link immediately after upload.",
        default: false
    },
    copyAfterUpload: {
        type: OptionType.BOOLEAN,
        description: "Copy the Anon.li link to clipboard after upload.",
        default: true
    }
});

function AnonLiIcon({ className, height = 20, width = 20 }: IconProps) {
    return (
        <svg aria-hidden="true" className={className} fill="currentColor" height={height} viewBox="0 0 74.4482 80.1979" width={width}>
            <path d="M35.7493 80.0307c-11.8-4.1933-24.826-17.7872-30.599-31.9333-1.4649-3.5892-1.4868-3.8341-.2161-2.4151 1.491 1.6651 2.7252 2.7875 3.9088 3.5544.7994.518 1.3515 1.2376 2.2164 2.8886 5.089 9.7142 13.0484 17.6656 23.1522 23.1285 3.0907 1.6711 3.1433 1.6692 6.5703-.2365 10.2187-5.6827 18.0893-13.657 22.9154-23.2176.571-1.1312 1.1923-1.8855 2.1047-2.5552.712-.5227 2.1423-1.8427 3.1784-2.9334 3.8482-4.0513-2.0974 8.5941-7.2876 15.4995-7.4726 9.9421-21.5054 19.7973-25.9435 18.2201zm-20.4374-30.926C5.8412 46.5475.4083 36.3923.0452 20.5681-.2105 9.427.1017 9.1148 15.4513 5.1608a28388.79 28388.79 0 0 0 16.0671-4.1436c5.7483-1.4856 5.7483-1.4856 15.2135.9505 5.206 1.3399 12.2632 3.1506 15.683 4.024C73.8979 8.9238 74.4567 9.573 74.448 19.9694c-.0157 19.0525-7.6385 30.0487-20.4999 29.5722-16.6233-.6158-18.3918-24.4894-2.0617-27.8319 5.4395-1.1133 12.1037.5125 11.8897 2.9007-.7265 8.1069-9.4624 13.4982-17.4348 10.7598-4.7851-1.6437-1.5047 7.2862 3.5416 9.6408 10.7055 4.9953 19.8165-4.7554 21.02-22.4957.722-10.6436.9781-10.3791-13.6475-14.0872-5.5298-1.402-12.3-3.1316-15.045-3.8436-4.991-1.2947-4.991-1.2947-6.8792-.7722-1.0386.2873-7.3056 1.904-13.9268 3.5928-15.9272 4.0621-15.3558 3.884-16.4933 5.143-3.1219 3.4555-1.0734 19.9929 3.3182 26.7875 6.1488 9.5133 19.1903 8.8993 21.7753-1.0252.8928-3.4276.6746-3.7862-1.7872-2.9374-7.6683 2.6438-15.3542-1.748-17.2453-9.8544-.9618-4.1227 8.8938-5.7768 15.403-2.5851 15.559 7.6291 5.7964 30.7234-11.0633 26.1711zm12.1309-17.2585c5.9332-1.97-4.7-8.1755-11.297-6.593-1.5902.3816-1.5297.2062-.6678 1.935 2.3447 4.7031 6.7102 6.4026 11.9648 4.658zm26.955.0335c2.2498-.9952 4.5867-3.5591 5.2228-5.7301.4371-1.4922-6.1598-1.5769-9.275-.1192-2.6823 1.2553-5.1286 3.5616-5.1286 4.8353 0 1.35 6.7386 2.0943 9.1808 1.014z" />
        </svg>
    );
}

function openExternal(url: string) {
    VencordNative.native.openExternal(url);
}

function AnonLiSettingsAbout() {
    return (
        <>
            <Notice.Warning className={Margins.bottom8}>
                <p>To use Anon.li Drop, create an account on Anon.li and paste your API key below.</p>
                <p>To create an API key, open https://anon.li/dashboard/settings, scroll down to Developer Access, then click Create New Key.</p>
                <p>Right click the + upload button in chat, then choose Anon.li Drop to upload files with Anon.li.</p>
                <p>The free plan keeps uploads available for up to 3 days, allows up to 500 API requests, and has a 5 GB service storage limit, so you can publish up to 5 GB of files.</p>
            </Notice.Warning>
            <Flex gap="8px" flexWrap="wrap" className={Margins.bottom16}>
                <Button size="small" onClick={() => openExternal(ANON_LI_URL)}>
                    Anon.li
                </Button>
                <Button size="small" variant="secondary" onClick={() => openExternal(SOURCE_URL)}>
                    Source Code
                </Button>
                <Button size="small" variant="secondary" onClick={() => openExternal(WARRANT_CANARY_URL)}>
                    Warrant Canary
                </Button>
            </Flex>
        </>
    );
}

const SafeAnonLiSettingsAbout = ErrorBoundary.wrap(AnonLiSettingsAbout, { noop: true });

async function uploadAnonLiDrop() {
    const apiKey = settings.store.apiKey.trim();
    if (!apiKey) {
        showToast("Set your Anon.li API key in plugin settings first.", Toasts.Type.FAILURE);
        return;
    }

    if (!Native) {
        showToast("AnonLi native helper is not available. Restart Discord.", Toasts.Type.FAILURE);
        return;
    }

    const channel = getCurrentChannel();
    if (!channel) {
        showToast("Open a channel before uploading with Anon.li Drop.", Toasts.Type.FAILURE);
        return;
    }

    const file = await chooseFile("*/*");
    if (!file) return;

    showToast(`Uploading ${file.name} to Anon.li.`, Toasts.Type.MESSAGE);

    const result = await Native.uploadDrop(
        apiKey,
        file.name,
        file.type || "application/octet-stream",
        await file.arrayBuffer(),
        settings.store.expiryDays ?? 3,
        settings.store.maxDownloads ?? 0
    );

    if (!result.success) {
        showToast(result.error, Toasts.Type.FAILURE);
        return;
    }

    if (settings.store.copyAfterUpload) await copyWithToast(result.url, "Anon.li link copied.");

    if (settings.store.sendAfterUpload) {
        await sendMessage(channel.id, { content: result.url });
        return;
    }

    insertTextIntoChatInputBox(result.url);
}

const channelAttachContextMenuPatch: NavContextMenuPatchCallback = children => {
    if (children.find(child => child?.props?.id === "vc-anonli-drop")) return;

    children.push(
        <Menu.MenuItem
            id="vc-anonli-drop"
            label={(
                <Flex alignItems="center" gap="8px">
                    <AnonLiIcon height={18} width={18} />
                    <span>Anon.li Drop</span>
                </Flex>
            )}
            action={() => void uploadAnonLiDrop()}
        />
    );
};

export default definePlugin({
    name: "AnonLi",
    description: "Uploads encrypted files to Anon.li Drop from the upload button context menu.",
    authors: [{ name: "irritably", id: 928787166916640838n }],
    dependencies: ["ContextMenuAPI"],
    tags: ["Chat", "Utility"],
    settings,
    settingsAboutComponent: SafeAnonLiSettingsAbout,

    contextMenus: {
        "channel-attach": channelAttachContextMenuPatch
    }
});
