/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import { getUserSettingLazy } from "@api/UserSettings";
import { Divider } from "@components/Divider";
import { ErrorCard } from "@components/ErrorCard";
import { Flex } from "@components/Flex";
import { Heading } from "@components/Heading";
import { Link } from "@components/Link";
import { Paragraph } from "@components/Paragraph";
import { Devs } from "@utils/constants";
import { isTruthy } from "@utils/guards";
import { Logger } from "@utils/Logger";
import { Margins } from "@utils/margins";
import { classes } from "@utils/misc";
import { useAwaiter } from "@utils/react";
import definePlugin from "@utils/types";
import { findByCodeLazy, findComponentByCodeLazy } from "@webpack";
import { ApplicationAssetUtils, Button, FluxDispatcher, React, UserStore } from "@webpack/common";
import { RPCSettings } from "./RpcSettings";
const useProfileThemeStyle = findByCodeLazy("profileThemeStyle:", "--profile-gradient-primary-color");
const ActivityView = findComponentByCodeLazy(".party?(0", "USER_PROFILE_ACTIVITY");
const ShowCurrentGame = getUserSettingLazy("status", "showCurrentGame");
async function getApplicationAsset(key) {
    try {
        return (await ApplicationAssetUtils.fetchAssetIds(settings.store.appID, [key]))[0];
    }
    catch (e) {
        new Logger("CustomRPC").warn("Failed to fetch application asset ID", e);
        return key;
    }
}
export const settings = definePluginSettings({
    config: {
        type: 6 /* OptionType.COMPONENT */,
        component: RPCSettings
    },
}).withPrivateSettings();
async function createActivity() {
    const { appID, appName, details, detailsURL, state, stateURL, type, streamLink, startTime, endTime, imageBig, imageBigURL, imageBigTooltip, imageSmall, imageSmallURL, imageSmallTooltip, buttonOneText, buttonOneURL, buttonTwoText, buttonTwoURL, partyMaxSize, partySize, timestampMode } = settings.store;
    if (!appName)
        return;
    const activity = {
        application_id: appID || "0",
        name: appName,
        state,
        details,
        type: type ?? 0 /* ActivityType.PLAYING */,
        flags: 1 << 0,
    };
    if (type === 1 /* ActivityType.STREAMING */)
        activity.url = streamLink;
    switch (timestampMode) {
        case 1 /* TimestampMode.NOW */:
            activity.timestamps = {
                start: Date.now()
            };
            break;
        case 2 /* TimestampMode.TIME */:
            activity.timestamps = {
                start: Date.now() - (new Date().getHours() * 3600 + new Date().getMinutes() * 60 + new Date().getSeconds()) * 1000
            };
            break;
        case 3 /* TimestampMode.CUSTOM */:
            if (startTime || endTime) {
                activity.timestamps = {};
                if (startTime && endTime && endTime > startTime) {
                    const anchor = getLoopAnchor();
                    activity.timestamps.start = anchor;
                    activity.timestamps.end = anchor + (endTime - startTime);
                }
                else {
                    if (startTime)
                        activity.timestamps.start = startTime;
                    if (endTime)
                        activity.timestamps.end = endTime;
                }
            }
            break;
        case 0 /* TimestampMode.NONE */:
        default:
            break;
    }
    if (detailsURL) {
        activity.details_url = detailsURL;
    }
    if (stateURL) {
        activity.state_url = stateURL;
    }
    if (buttonOneText) {
        activity.buttons = [
            buttonOneText,
            buttonTwoText
        ].filter(isTruthy);
        activity.metadata = {
            button_urls: [
                buttonOneURL,
                buttonTwoURL
            ].filter(isTruthy)
        };
    }
    if (imageBig) {
        activity.assets = {
            large_image: await getApplicationAsset(imageBig),
            large_text: imageBigTooltip || undefined,
            large_url: imageBigURL || undefined
        };
    }
    if (imageSmall) {
        activity.assets = {
            ...activity.assets,
            small_image: await getApplicationAsset(imageSmall),
            small_text: imageSmallTooltip || undefined,
            small_url: imageSmallURL || undefined
        };
    }
    if (partyMaxSize && partySize) {
        activity.party = {
            size: [partySize, partyMaxSize]
        };
    }
    for (const k in activity) {
        if (k === "type")
            continue;
        const v = activity[k];
        if (!v || v.length === 0)
            delete activity[k];
    }
    return activity;
}
export async function setRpc(disable) {
    const activity = await createActivity();
    FluxDispatcher.dispatch({
        type: "LOCAL_ACTIVITY_UPDATE",
        activity: !disable ? activity : null,
        socketId: "CustomRPC",
    });
}
let loopInterval;
let loopAnchor = 0;
function getLoopAnchor() {
    return loopAnchor;
}
function startTimestampLoop() {
    const { timestampMode, startTime, endTime } = settings.store;
    if (timestampMode !== 3 /* TimestampMode.CUSTOM */ || !startTime || !endTime)
        return;
    const duration = endTime - startTime;
    if (duration <= 0)
        return;
    stopTimestampLoop();
    loopAnchor = Date.now();
    loopInterval = setInterval(() => {
        if (Date.now() >= loopAnchor + duration) {
            loopAnchor = Date.now();
            setRpc();
        }
    }, 1000);
}
function stopTimestampLoop() {
    if (loopInterval !== undefined) {
        clearInterval(loopInterval);
        loopInterval = undefined;
    }
    loopAnchor = 0;
}
export default definePlugin({
    name: "CustomRPC",
    description: "Add a fully customisable Rich Presence (Game status) to your Discord profile",
    tags: ["Activity", "Customisation"],
    authors: [Devs.captain, Devs.AutumnVN, Devs.nin0dev],
    dependencies: ["UserSettingsAPI"],
    // This plugin's patch is not important for functionality, so don't require a restart
    requiresRestart: false,
    settings,
    start() {
        startTimestampLoop();
        setRpc();
    },
    stop() {
        setRpc(true);
        stopTimestampLoop();
    },
    // Discord hides buttons on your own Rich Presence for some reason. This patch disables that behaviour
    patches: [
        {
            find: ".USER_PROFILE_ACTIVITY_BUTTONS),",
            replacement: {
                match: /.getId\(\)===\i.id/,
                replace: "$& && false"
            },
        }
    ],
    settingsAboutComponent: () => {
        const [activity] = useAwaiter(createActivity, { fallbackValue: undefined, deps: Object.values(settings.store) });
        const gameActivityEnabled = ShowCurrentGame.useSetting();
        const { profileThemeStyle } = useProfileThemeStyle({});
        return (<>
                {!gameActivityEnabled && (<ErrorCard className={classes(Margins.top16, Margins.bottom16)} style={{ padding: "1em" }}>
                        <Heading>Notice</Heading>
                        <Paragraph>Activity Sharing isn't enabled, people won't be able to see your custom rich presence!</Paragraph>

                        <Button color={Button.Colors.TRANSPARENT} className={Margins.top8} onClick={() => ShowCurrentGame.updateSetting(true)}>
                            Enable
                        </Button>
                    </ErrorCard>)}

                <Flex flexDirection="column" gap=".5em" className={Margins.top16}>
                    <Paragraph>
                        Go to the <Link href="https://discord.com/developers/applications">Discord Developer Portal</Link> to create an application and
                        get the application ID.
                    </Paragraph>
                    <Paragraph>
                        Upload images in the Rich Presence tab to get the image keys.
                    </Paragraph>
                    <Paragraph>
                        If you want to use an image link, download your image and reupload the image to <Link href="https://imgur.com">Imgur</Link> and get the image link by right-clicking the image and selecting "Copy image address".
                    </Paragraph>
                    <Paragraph>
                        You can't see your own buttons on your profile, but everyone else can see it fine.
                    </Paragraph>
                    <Paragraph>
                        Some weird unicode text ("fonts" 𝖑𝖎𝖐𝖊 𝖙𝖍𝖎𝖘) may cause the rich presence to not show up, try using normal letters instead.
                    </Paragraph>
                </Flex>

                <Divider className={Margins.top8}/>

                <div style={{ width: "284px", ...profileThemeStyle, marginTop: 8, borderRadius: 8, background: "var(--background-mod-muted)" }}>
                    {activity && <ActivityView activity={activity} user={UserStore.getCurrentUser()} currentUser={UserStore.getCurrentUser()}/>}
                </div>
            </>);
    }
});
