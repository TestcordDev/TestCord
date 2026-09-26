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

import { sendBotMessage } from "@api/Commands";
import { isPluginEnabled } from "@api/PluginManager";
import { definePluginSettings } from "@api/Settings";
import { getUserSettingLazy } from "@api/UserSettings";
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import ErrorBoundary from "@components/ErrorBoundary";
import { Flex } from "@components/Flex";
import { Link } from "@components/Link";
import { Paragraph } from "@components/Paragraph";
import { openSettingsTabModal, UpdaterTab } from "@components/settings";
import { platformName } from "@equicordplugins/equicordHelper/utils";
import customIdle from "@plugins/customIdle";
import { gitHash, gitHashShort } from "@shared/vencordUserAgent";
import { CONTRIB_ROLE_ID, Devs, DONOR_ROLE_ID, EQUICORD_GUILD_ID, EQUICORD_TEAM, SUPPORT_CHANNEL_ID, SUPPORT_CHANNEL_IDS, VC_CONTRIB_ROLE_ID, VC_DONOR_ROLE_ID, VC_GUILD_ID, VC_REGULAR_ROLE_ID, VENCORD_CONTRIB_ROLE_ID } from "@utils/constants";
import { sendMessage } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { Margins } from "@utils/margins";
import { isAnyPluginDev, isEquicordGuild, isEquicordSupport, isKnownIssuesCategory, isSupportChannel, isTestCordGuild, tryOrElse } from "@utils/misc";
import { relaunch } from "@utils/native";
import { onlyOnce } from "@utils/onlyOnce";
import { makeCodeblock } from "@utils/text";
import definePlugin from "@utils/types";
import { checkForUpdates, isOutdated, update } from "@utils/updater";
import { RenderModalProps } from "@vencord/discord-types";
import { CloudUploadPlatform } from "@vencord/discord-types/enums";
import { ChannelStore, CloudUploader, ConfirmModal, Constants, GuildMemberStore, openModal, Parser, PermissionsBits, PermissionStore, RelationshipStore, RestAPI, SelectedChannelStore, showToast, SnowflakeUtils, Text, Toasts, UserStore } from "@webpack/common";
import { JSX } from "react";

import plugins, { PluginMeta } from "~plugins";

import SettingsPlugin from "./settings";

const CodeBlockRe = /```snippet\n(.+?)```/s;

const TrustedRolesIds = [
    VC_CONTRIB_ROLE_ID, // Vencord Contributor
    VC_REGULAR_ROLE_ID, // Vencord Regular
    VC_DONOR_ROLE_ID, // Vencord Donor
    EQUICORD_TEAM, // Equicord Team
    DONOR_ROLE_ID, // Equicord Donor
    CONTRIB_ROLE_ID, // Equicord Contributor
    VENCORD_CONTRIB_ROLE_ID, // Vencord Contributor
];

const AsyncFunction = async function () { }.constructor;

const ShowCurrentGame = getUserSettingLazy<boolean>("status", "showCurrentGame")!;
const ShowEmbeds = getUserSettingLazy<boolean>("textAndImages", "renderEmbeds")!;

interface clientData {
    name: string;
    version?: string | null | undefined;
    info?: string | boolean | null | undefined;
    spoofed?: string | null | undefined;
    shortHash?: string | null | undefined;
    hash?: string | null | undefined;
    dev?: boolean | null | undefined;
}

async function forceUpdate() {
    const outdated = await checkForUpdates();
    if (outdated) {
        await update();
        relaunch();
    }

    return outdated;
}

export function detectClient(): clientData {
    if (IS_DISCORD_DESKTOP) {
        return {
            name: "Discord Desktop",
            version: DiscordNative.app.getVersion(),
        };
    }
    if (IS_VESKTOP) return {
        name: "Vesktop",
        version: VesktopNative.app.getVersion(),
    };

    if (IS_EQUIBOP) {
        const equibopGitHash = tryOrElse(() => VesktopNative.app.getGitHash?.(), null);
        const spoofInfo = tryOrElse(() => VesktopNative.app.getPlatformSpoofInfo?.(), null);
        const isDevBuild = tryOrElse(() => VesktopNative.app.isDevBuild?.(), false);
        const shortHash = equibopGitHash?.slice(0, 7);
        return {
            name: "Equibop",
            version: VesktopNative.app.getVersion(),
            spoofed: spoofInfo?.spoofed ? `${platformName()} (spoofed from ${spoofInfo.originalPlatform})` : null,
            dev: isDevBuild,
            shortHash: shortHash,
            hash: equibopGitHash,
        };
    }

    if ("legcord" in window) return {
        name: "LegCord",
        version: window.legcord.version,
    };

    if ("goofcord" in window) return {
        name: "GoofCord",
        version: window.goofcord.version,
    };

    const name = typeof unsafeWindow !== "undefined" ? "UserScript" : "Web";
    return {
        name: name,
        info: navigator.userAgent
    };
}

async function generateDebugInfoMessage() {
    const { RELEASE_CHANNEL } = window.GLOBAL_ENV;

    const clientInfo = detectClient();
    let clientString = `${clientInfo.name}`;
    clientString += `${clientInfo.version ? ` v${clientInfo.version}` : ""}`;
    clientString += `${clientInfo.info ? ` • ${clientInfo.info}` : ""}`;
    clientString += `${clientInfo.shortHash ? ` • [${clientInfo.shortHash}](<https://github.com/Equicord/Equibop/commit/${clientInfo.hash}>)` : ""}`;

    const spoofInfo = IS_EQUIBOP ? tryOrElse(() => VesktopNative.app.getPlatformSpoofInfo?.(), null) : null;
    const platformDisplay = spoofInfo?.spoofed
        ? `${platformName()} (spoofed from ${spoofInfo.originalPlatform})`
        : platformName();

    const info = {
        Testcord:
            `v${VERSION} • [${gitHashShort}](<https://github.com/TestcordDev/Testcord/commit/${gitHash}>)` +
            `${IS_EQUIBOP ? "" : SettingsPlugin.getVersionInfo()} - ${Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(BUILD_TIMESTAMP)}`,
        Client: `${RELEASE_CHANNEL} ~ ${clientString}`,
        Platform: platformDisplay
    };

    const potentiallyProblematicPlugins = ([
        "NoRPC", "NoProfileThemes", "NoMosaic", "NoRoleHeaders", "Ingtoninator", "NeverPausePreviews",
        "IdleAutoRestart",
    ].filter(isPluginEnabled) ?? []).sort();

    if (isPluginEnabled(customIdle.name) && customIdle.settings.store.idleTimeout === 0) {
        potentiallyProblematicPlugins.push(customIdle.name);
    }

    const potentiallyProblematicPluginsNote = "-# note, those plugins are just common issues and might not be the problem";

    const commonIssues = {
        "Activity Sharing Disabled": tryOrElse(() => !ShowCurrentGame.getSetting(), false),
        "Link Embeds Disabled": tryOrElse(() => !ShowEmbeds.getSetting(), false),
        "TestCord DevBuild": !IS_STANDALONE,
        "Equibop DevBuild": IS_EQUIBOP && tryOrElse(() => VesktopNative.app.isDevBuild?.(), false),
        "Platform Spoofed": spoofInfo?.spoofed ?? false,
        ">2 Weeks Outdated": BUILD_TIMESTAMP < Date.now() - 12096e5,
        [`Potentially Problematic Plugins: ${potentiallyProblematicPlugins.join(", ")}\n${potentiallyProblematicPluginsNote}`]: potentiallyProblematicPlugins.length
    };

    let content = `>>> ${Object.entries(info).map(([k, v]) => `**${k}**: ${v}`).join("\n")}`;
    content += "\n" + Object.entries(commonIssues)
        .filter(([, v]) => v).map(([k]) => `⚠️ ${k}`)
        .join("\n");

    return content.trim();
}

// Discord's REST layer rejects with a plain object (`{ code, message }`), not an
// Error. Forwarding that verbatim produces a useless "[object Object]" in crash
// reports and defeats PluginHealth's ignore-list, so normalize it at the source.
function toError(value: unknown, context: string): Error {
    if (value instanceof Error) return value;

    const details: string[] = [];
    if (value && typeof value === "object") {
        const obj = value as { message?: unknown; code?: unknown; status?: unknown; body?: unknown; };
        if (typeof obj.message === "string" && obj.message) details.push(obj.message);
        if (typeof obj.code === "number") details.push(`code ${obj.code}`);
        if (typeof obj.status === "number") details.push(`status ${obj.status}`);
        if (obj.body != null) {
            try {
                const body = typeof obj.body === "string" ? obj.body : JSON.stringify(obj.body);
                if (body) details.push(body);
            } catch { /* body was not serializable; the fields above still apply */ }
        }
    } else if (typeof value === "string" && value) {
        details.push(value);
    }

    return new Error(details.length ? `${context}: ${details.join(" ")}` : context);
}

async function uploadPluginListFile(channelId: string, fileContent: string, filename: string, pluginCount: number) {
    // CloudUploader needs a real target; without one it either throws inside the
    // promise executor or silently never settles, leaving the command hanging.
    if (!channelId) throw new Error("Cannot upload the plugin list: no channel selected.");

    // Everything that can throw synchronously lives outside the promise, so a
    // failure here becomes a normal rejection the caller can handle.
    const file = new File([fileContent], filename, { type: "text/plain" });
    const upload = new CloudUploader({ file, platform: CloudUploadPlatform.WEB }, channelId);

    return new Promise<void>((resolve, reject) => {
        // Whichever settles first wins; neither path may settle twice.
        let settled = false;
        const finish = (error?: unknown) => {
            if (settled) return;
            settled = true;
            if (error === undefined) resolve();
            else reject(toError(error, "Failed to send the plugin list attachment"));
        };

        try {
            upload.on("complete", () => {
                RestAPI.post({
                    url: Constants.Endpoints.MESSAGES(channelId),
                    body: {
                        flags: 0,
                        channel_id: channelId,
                        content: `⚠️ Plugin list attached as file due to high plugin count (${pluginCount} plugins enabled)`,
                        nonce: SnowflakeUtils.fromTimestamp(Date.now()),
                        sticker_ids: [],
                        type: 0,
                        attachments: [{
                            id: "0",
                            filename: upload.filename,
                            uploaded_filename: upload.uploadedFilename,
                        }],
                    }
                }).then(() => finish()).catch(e => finish(e));
            });

            upload.on("error", () => finish(new Error("Failed to upload file")));

            upload.upload();
        } catch (e) {
            finish(e);
        }
    });
}

function getEnabledPlugins() {
    const isApiPlugin = (plugin: string) => plugin.endsWith("API") || plugins[plugin]?.required;

    const allEnabledPlugins = Object.keys(PluginMeta).filter(p => isPluginEnabled(p) && !isApiPlugin(p));

    const stock = allEnabledPlugins.filter(p => !PluginMeta[p].userPlugin).sort();
    const user = allEnabledPlugins.filter(p => PluginMeta[p].userPlugin).sort();

    return { stock, user };
}

function generatePluginList() {
    const { stock, user } = getEnabledPlugins();

    let content = `**Enabled Plugins (${stock.length}):\n${makeCodeblock(stock.join(", "))}`;

    if (user.length) {
        content += `\n\n**Enabled UserPlugins (${user.length}):\n${makeCodeblock(user.join(", "))}`;
    }

    return content;
}

/**
 * Sends the enabled plugin list to `channelId`, as inline messages or as a file
 * when the count is high. Shared by the /testcord-plugins command and the
 * matching support-channel button so the two cannot drift apart.
 */
async function sendPluginList(channelId: string): Promise<boolean> {
    const { stock, user } = getEnabledPlugins();
    const totalCount = stock.length + user.length;

    if (totalCount === 0) return false;

    if (totalCount > 80) {
        const fileContent = [...stock, ...user].join("\n");
        await uploadPluginListFile(channelId, fileContent, "enabled-plugins.txt", totalCount);
        return true;
    }

    const pluginList = generatePluginList();

    // Split if too long
    if (pluginList.length <= 2000) {
        await sendMessage(channelId, { content: pluginList });
        return true;
    }

    // Split the plugins list into chunks where each message is under 2000 chars
    const lines = pluginList.split("\n");
    const baseHeader = lines[0]; // **Plugins enabled (count):**
    const codeblock = lines.slice(1).join("\n"); // ```plugins```
    const pluginsStr = codeblock.slice(3, -3); // remove ```
    const plugins = pluginsStr.split(", ");

    const parts: string[][] = [];
    let currentPart: string[] = [];
    let currentLength = `${baseHeader} [Part 1/X]:**\n\`\`\`\n`.length + "\n```".length; // estimate header length

    for (const plugin of plugins) {
        const pluginWithComma = plugin + ", ";
        if (currentLength + pluginWithComma.length > 1950) { // leave buffer for safety
            parts.push(currentPart);
            currentPart = [plugin];
            currentLength = `${baseHeader} [Part ${parts.length + 2}/X]:**\n\`\`\`\n`.length + "\n```".length + plugin.length;
        } else {
            currentPart.push(plugin);
            currentLength += pluginWithComma.length;
        }
    }
    if (currentPart.length > 0) {
        parts.push(currentPart);
    }

    const totalParts = parts.length;
    for (let i = 0; i < totalParts; i++) {
        const partPlugins = parts[i];
        const partContent = `${baseHeader} [Part ${i + 1}/${totalParts}]:**\n${makeCodeblock(partPlugins.join(", "))}`;
        await sendMessage(channelId, { content: partContent });
        if (i < totalParts - 1) await new Promise(resolve => setTimeout(resolve, 100));
    }

    return true;
}

const checkForUpdatesOnce = onlyOnce(checkForUpdates);

const settings = definePluginSettings({}).withPrivateSettings<{
    dismissedDevBuildWarning?: boolean;
}>();

function DevBuildConfirmModal(props: RenderModalProps) {
    const s = settings.use(["dismissedDevBuildWarning"]);

    return (
        <ConfirmModal
            {...props}
            title="Hold on!"
            confirmText="Understood"
            variant="primary"
            checkboxProps={{
                checked: s.dismissedDevBuildWarning === true,
                onChange: checked => s.dismissedDevBuildWarning = checked
            }}
        >
            <div>
                <Paragraph>You are using a custom build of Equicord, which we do not provide support for!</Paragraph>

                <Paragraph className={Margins.top8}>
                    We only provide support for <Link href="https://equicord.org/download">official builds</Link>.
                    Either <Link href="https://equicord.org/download">switch to an official build</Link> or figure your issue out yourself.
                </Paragraph>

                <Text variant="text-md/bold" className={Margins.top8}>You will be banned from receiving support if you ignore this rule.</Text>
            </div>
        </ConfirmModal>
    );
}

export default definePlugin({
    name: "SupportHelper",
    required: true,
    description: "Helps us provide support to you",
    authors: [Devs.Ven],
    dependencies: ["UserSettingsAPI", "CommandsAPI", "MessageAccessoriesAPI"],
    tags: ["Utility"],

    settings,

    patches: [{
        find: "#{intl::BEGINNING_DM}",
        replacement: {
            match: /#{intl::BEGINNING_DM},{.+?}\),(?=.{0,300}(\i)\.isMultiUserDM)/,
            replace: "$& $self.renderContributorDmWarningCard({ channel: $1 }),"
        }
    }],

    commands: [
        {
            name: "testcord-debug",
            description: "Send Testcord debug info",
            execute: async () => ({ content: await generateDebugInfoMessage() })
        },
        {
            name: "testcord-plugins",
            description: "Send Testcord plugin list",
            execute: async () => {
                const channelId = SelectedChannelStore.getChannelId();

                try {
                    const sent = await sendPluginList(channelId);
                    if (!sent) return { content: "No plugins enabled." };
                } catch (e) {
                    // Surface the failure instead of letting it become an
                    // unhandled rejection with no user-visible cause.
                    new Logger("SupportHelper").error("Failed to send the plugin list\n", e);
                    showToast(`Failed to send the plugin list: ${toError(e, "unknown error").message}`, Toasts.Type.FAILURE);
                    return { content: "\u200B" };
                }

                return { content: "\u200B" }; // Send zero-width space to avoid sending command text
            }
        }
    ],

    flux: {
        async CHANNEL_SELECT({ channelId }) {
            const isSupportChannel = SUPPORT_CHANNEL_IDS.includes(channelId);
            if (!isSupportChannel) return;

            const selfId = UserStore.getCurrentUser()?.id;
            if (!selfId || isAnyPluginDev(selfId)) return;

            if (!IS_UPDATER_DISABLED) {
                await checkForUpdatesOnce().catch(() => { });

                if (isOutdated) {
                    openModal(props => (
                        <ConfirmModal
                            {...props}
                            variant="primary"
                            title="Hold on!"
                            confirmText="Update & Restart Now"
                            cancelText="View Updates"
                            onConfirm={forceUpdate}
                            onCancel={() => openSettingsTabModal(UpdaterTab!)}
                        >
                            <div>
                                <Paragraph>You are using an outdated version of Testcord! Chances are, your issue is already fixed.</Paragraph>
                                <Paragraph className={Margins.top8}>
                                    Please first update before asking for support!
                                </Paragraph>
                                <Paragraph className={Margins.top8}>
                                    If you know what you're doing or cannot update, you can dismiss this prompt.
                                </Paragraph>
                            </div>
                        </ConfirmModal>
                    ));
                    return;
                }
            }

            const roles = GuildMemberStore.getSelfMember(VC_GUILD_ID)?.roles || GuildMemberStore.getSelfMember(EQUICORD_GUILD_ID)?.roles;
            if (!roles || TrustedRolesIds.some(id => roles.includes(id))) return;

            if (!IS_WEB && IS_UPDATER_DISABLED) {
                openModal(props => (
                    <ConfirmModal
                        {...props}
                        title="Hold on!"
                        confirmText="OK"
                        variant="primary"
                    >
                        <div>
                            <Paragraph>You are using an externally updated Testcord version, which we may provide less support for!</Paragraph>
                            <Paragraph className={Margins.top8}>
                                Please either switch to an <Link href="https://discord.gg/KTNXyDTXGb">officially supported version of Equicord</Link>, or
                                contact your package maintainer for support instead.
                            </Paragraph>
                        </div>
                    </ConfirmModal>
                ));
                return;
            }

            if (!IS_STANDALONE && !settings.store.dismissedDevBuildWarning) {
                openModal(props => <DevBuildConfirmModal {...props} />);
                return;
            }
        }
    },

    renderMessageAccessory(props) {
        if (props.message.vencordEmbeddedBy) return null;

        const buttons = [] as JSX.Element[];

        const testCordSupport = isTestCordGuild(props.channel.id);
        const equicordSupport = isEquicordGuild(props.message.channel_id) && isEquicordSupport(props.message.author.id);
        const isSupportHelper = testCordSupport || equicordSupport;

        const shouldAddUpdateButton =
            !IS_UPDATER_DISABLED
            && ((isSupportChannel(props.channel.id) && isSupportHelper))
            && props.message.content?.toLowerCase().includes("update");

        if (shouldAddUpdateButton) {
            buttons.push(
                <Button
                    key="vc-update"
                    variant="positive"
                    onClick={async () => {
                        try {
                            if (await forceUpdate())
                                showToast("Success! Restarting...", Toasts.Type.SUCCESS);
                            else
                                showToast("Already up to date!", Toasts.Type.MESSAGE);
                        } catch (e) {
                            new Logger(this.name).error("Error while updating:", e);
                            showToast("Failed to update :(", Toasts.Type.FAILURE);
                        }
                    }}
                >
                    Update Now
                </Button>
            );
        }

        if (isSupportHelper && isSupportChannel(props.channel.id) && PermissionStore.can(PermissionsBits.SEND_MESSAGES, props.channel)) {
            if (props.message.content.includes("/testcord-debug") || props.message.content.includes("/testcord-plugins") || props.message.content.includes("/equicord-debug") || props.message.content.includes("/equicord-plugins")) {
                buttons.push(
                    <Button
                        key="vc-dbg"
                        variant="secondary"
                        onClick={async () => sendMessage(props.channel.id, { content: await generateDebugInfoMessage() })}
                    >
                        Run /testcord-debug
                    </Button>,
                    <Button
                        key="vc-plg-list"
                        variant="secondary"
                        onClick={async () => {
                            // If the message is exactly "/testcord-plugins", delete it to avoid showing the command text
                            if (props.message.content.trim() === "/testcord-plugins") {
                                try {
                                    await DiscordNative.http.delete(`${DiscordNative.http.getAPIBaseURL()}/channels/${props.channel.id}/messages/${props.message.id}`);
                                } catch (e) {
                                    // Ignore if delete fails
                                }
                            }

                            try {
                                await sendPluginList(props.channel.id);
                            } catch (e) {
                                new Logger(this.name).error("Error while sending the plugin list:", e);
                                showToast(`Failed to send the plugin list: ${toError(e, "unknown error").message}`, Toasts.Type.FAILURE);
                            }
                        }}
                    >
                        Run /testcord-plugins
                    </Button>
                );
            }
        }
        if (isSupportHelper || isSupportChannel(props?.channel?.id, true) || isKnownIssuesCategory(props?.channel?.parent_id, true)) {
            const match = CodeBlockRe.exec(props.message.content || props.message.embeds[0]?.rawDescription || "");
            if (match) {
                buttons.push(
                    <Button
                        key="vc-run-snippet"
                        onClick={async () => {
                            try {
                                const result = await AsyncFunction(match[1])();
                                const stringed = String(result);
                                if (stringed) {
                                    await sendBotMessage(SelectedChannelStore.getChannelId(), {
                                        content: stringed
                                    });
                                }

                                showToast("Success!", Toasts.Type.SUCCESS);
                            } catch (e) {
                                new Logger(this.name).error("Error while running snippet:", e);
                                showToast("Failed to run snippet :(", Toasts.Type.FAILURE);
                            }
                        }}
                    >
                        Run Snippet
                    </Button>
                );
            }
        }

return buttons.length
    ? <Flex>{buttons}</Flex>
    : null;
    },

renderContributorDmWarningCard: ErrorBoundary.wrap(({ channel }) => {
    const userId = channel.getRecipientId();
    if (!isAnyPluginDev(userId)) return null;
    if (RelationshipStore.isFriend(userId) || isAnyPluginDev(UserStore.getCurrentUser()?.id)) return null;

    return (
        <Card variant="warning" className={Margins.top8} defaultPadding>
            Please do not private message Testcord / Equicord / Vencord Developers / Plugin Devs for support!
            <br />
            Instead, use the support channel: {Parser.parse("https://discord.com/channels/1434211283317690502/1434228141123047434")}
            {!ChannelStore.getChannel(SUPPORT_CHANNEL_ID) && " (Click the link to join)"}
        </Card>
    );
}, { noop: true }),
});
