/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { DataStore } from "@api/index";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { useForceUpdater } from "@utils/react";
import definePlugin from "@utils/types";
import { React } from "@webpack/common";
import { ReplaceSettings, ReplaceTutorial } from "./ReplaceSettings";
const APP_IDS_KEY = "ReplaceActivityType_appids";
export const makeEmptyAppId = () => ({
    appId: "",
    enabled: true,
    newActivityType: 0 /* ActivityType.PLAYING */,
    newName: "",
    newDetails: "",
    newState: "",
    newLargeImageUrl: "",
    newLargeImageText: "",
    newSmallImageUrl: "",
    newSmallImageText: "",
    newStreamUrl: "",
    disableTimestamps: false,
    disableAssets: false
});
let appIds = [makeEmptyAppId()];
const settings = definePluginSettings({
    replacedAppIds: {
        type: 6 /* OptionType.COMPONENT */,
        description: "",
        component: () => {
            const update = useForceUpdater();
            return (<>
                    <ReplaceSettings appIds={appIds} update={update} save={async () => DataStore.set(APP_IDS_KEY, appIds)}/>
                </>);
        }
    },
});
export default definePlugin({
    name: "RPCEditor",
    description: "Edit the type and content of any Rich Presence",
    tags: ["Customisation"],
    authors: [Devs.Nyako, Devs.nin0dev],
    patches: [
        {
            find: '"LocalActivityStore"',
            replacement: {
                match: /\i\(\i\)\{.{0,25}activity:(\i).*?\}=\i;/,
                replace: "$&$self.patchActivity($1);",
            }
        }
    ],
    settings,
    settingsAboutComponent: () => <ReplaceTutorial />,
    async start() {
        appIds = await DataStore.get(APP_IDS_KEY) ?? [makeEmptyAppId()];
    },
    parseField(text, originalActivity) {
        if (text === "null")
            return "";
        return text
            .replaceAll(":name:", originalActivity.name)
            .replaceAll(":details:", originalActivity.details ?? "")
            .replaceAll(":state:", originalActivity.state ?? "")
            .replaceAll(":large_image:", originalActivity.assets?.large_image ?? "")
            .replaceAll(":large_text:", originalActivity.assets?.large_text ?? "")
            .replaceAll(":small_image:", originalActivity.assets?.small_image ?? "")
            .replaceAll(":small_text:", originalActivity.assets?.small_text ?? "");
    },
    patchActivity(activity) {
        if (!activity)
            return;
        appIds.forEach(app => {
            if (app.enabled && app.appId === activity.application_id) {
                const oldActivity = { ...activity };
                activity.type = app.newActivityType;
                if (app.newName)
                    activity.name = this.parseField(app.newName, oldActivity);
                if (app.newActivityType === 1 /* ActivityType.STREAMING */ && app.newStreamUrl)
                    activity.url = app.newStreamUrl;
                if (app.newDetails)
                    activity.details = this.parseField(app.newDetails, oldActivity);
                if (app.newState)
                    activity.state = this.parseField(app.newState, oldActivity);
                if (!activity.assets)
                    activity.assets = {};
                if (app.newLargeImageText)
                    activity.assets.large_text = this.parseField(app.newLargeImageText, oldActivity);
                if (app.newLargeImageUrl)
                    activity.assets.large_image = this.parseField(app.newLargeImageUrl, oldActivity);
                if (app.newSmallImageText)
                    activity.assets.small_text = this.parseField(app.newSmallImageText, oldActivity);
                if (app.newSmallImageUrl)
                    activity.assets.small_image = this.parseField(app.newSmallImageUrl, oldActivity);
                // @ts-ignore here we are intentionally nulling assets
                if (app.disableAssets)
                    activity.assets = {};
                if (app.disableTimestamps)
                    activity.timestamps = {};
            }
        });
    },
});
