/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isEquicordPluginDev, isTestcordPluginDev } from "@utils/misc";
import type { Plugin } from "@utils/types";
import equicordTestcordModifiedIconBase64 from "file://../../browser/Equicord_Testcord_Modified_PluginIcon.png?base64";
import equicordVencordTestcordModifiedIconBase64 from "file://../../browser/Equicord_Vencord_Testcord_Modified_PluginIcon.png?base64";
import testcordPluginIconBase64 from "file://../../browser/icon.png?base64";
import vencordTestcordModifiedIconBase64 from "file://../../browser/Vencord_Testcord_Modified_PluginIcon.png?base64";

export const TestcordPluginIconUrl = `data:image/png;base64,${testcordPluginIconBase64}`;
export const EquicordTestcordModifiedIconUrl = `data:image/png;base64,${equicordTestcordModifiedIconBase64}`;
export const VencordTestcordModifiedIconUrl = `data:image/png;base64,${vencordTestcordModifiedIconBase64}`;
export const EquicordVencordTestcordModifiedIconUrl = `data:image/png;base64,${equicordVencordTestcordModifiedIconBase64}`;

const TESTCORD_MODIFIED_EQUICORD_FOLDERS = new Set([
    "altKrispSwitch", "autoZipper", "bannersEverywhere", "baseDecoder", "betterActivities",
    "betterAudioPlayer", "betterBanReasons", "betterForwards", "betterInvites", "betterPlusReacts",
    "blockKeywords", "blockKrisp", "bypassPinPrompt", "channelTabs", "clickableRoles",
    "clientSideBlock", "commandPalette", "cursorBuddy", "customTimestamps", "disableCameras",
    "dragify", "equicordHelper", "favouriteAnything", "findReply", "followVoiceUser",
    "fontLoader", "ghosted", "globalBadges", "hideChatButtons", "hideMessages",
    "homeTyping", "iRememberYou", "iconViewer", "ignoreCalls", "instantScreenshare",
    "invisibleChat.desktop", "keyboardNavigation", "keyboardSounds", "keywordNotify", "limitlessScreenshare",
    "messageLinkTooltip", "messageLoggerEnhanced", "messagePeek", "messageTranslate", "micLoopbackTester",
    "moreStickers", "moreUserTags", "newPluginsManager", "notificationTitle.discordDesktop", "questify",
    "randomVoice", "repeatMessages", "saveFavoriteGIFs", "showBadgesInChat", "showRolesInChat",
    "signature", "songLink.desktop", "songSpotlight.desktop", "spotifyActivityToggle", "streaks",
    "timezones", "toastNotifications", "toggleVideoBind", "translatePlus", "unlimitedAccounts",
    "userpfp", "userpluginInstaller.dev", "voiceChannelLog", "voiceStats", "whitelistedEmojis",
    "zipPreview"
]);

const TESTCORD_MODIFIED_EQUICORD_NAMES = new Set([
    "AltKrispSwitch", "AutoZipper", "BannersEverywhere", "DecodeBase64", "BetterActivities",
    "BetterAudioPlayer", "BetterBanReasons", "BetterForwards", "BetterInvites", "BetterPlusReacts",
    "BlockKeywords", "BlockKrisp", "BypassPinPrompt", "ChannelTabs", "ClickableRoles",
    "ClientSideBlock", "CommandPalette", "CursorBuddy", "CustomTimestamps", "DisableCameras",
    "Dragify", "EquicordHelper", "FavouriteAnything", "FindReply", "FollowVoiceUser",
    "FontLoader", "Ghosted", "GlobalBadges", "HideChatButtons", "HideMessages",
    "HomeTyping", "IRememberYou", "IconViewer", "IgnoreCalls", "InstantScreenshare",
    "InvisibleChat", "KeyboardNavigation", "KeyboardSounds", "KeywordNotify", "LimitlessScreenshare",
    "MessageLinkTooltip", "MessageLoggerEnhanced", "MessagePeek", "MessageTranslate", "MicLoopbackTester",
    "MoreStickers", "MoreUserTags", "NewPluginsManager", "NotificationTitle", "Questify",
    "RandomVoice", "RepeatMessages", "SaveFavoriteGIFs", "ShowBadgesInChat", "ShowRolesInChat",
    "Signature", "SongLink", "SongSpotlight", "SpotifyActivityToggle", "Streaks",
    "Timezones", "ToastNotifications", "ToggleVideoBind", "Translate+", "UnlimitedAccounts",
    "UserPFP", "UserpluginInstaller", "VoiceChannelLog", "VoiceStats", "Whitelisted Emojis",
    "ZipPreview"
]);

const TESTCORD_MODIFIED_VENCORD_FOLDERS = new Set([
    "accountPanelServerProfile", "alwaysAnimate", "alwaysTrust", "betterFolders", "betterRoleContext",
    "betterSessions", "betterSettings", "callTimer", "clearURLs", "consoleJanitor",
    "consoleShortcuts", "crashHandler", "customRPC", "decor", "expressionCloner",
    "favEmojiFirst", "fullSearchContext", "gameActivityToggle", "imageZoom", "implicitRelationships",
    "ircColors", "memberCount", "messageClickActions", "messageLinkEmbeds", "messageLogger",
    "mutualGroupDMs", "noOnboardingDelay", "onePingPerDM", "openInApp", "pinDms",
    "platformIndicators", "revealAllSpoilers", "reviewDB", "roleColorEverywhere", "showConnections",
    "showHiddenChannels", "showHiddenThings", "showMeYourName", "silentTyping", "startupTimings",
    "textReplace", "unlockedAvatarZoom", "validReply", "validUser", "viewIcons",
    "volumeBooster"
]);

const TESTCORD_MODIFIED_VENCORD_NAMES = new Set([
    "AccountPanelServerProfile", "AlwaysAnimate", "AlwaysTrust", "BetterFolders", "BetterRoleContext",
    "BetterSessions", "BetterSettings", "CallTimer", "ClearURLs", "ConsoleJanitor",
    "ConsoleShortcuts", "CrashHandler", "CustomRPC", "Decor", "ExpressionCloner",
    "FavoriteEmojiFirst", "FullSearchContext", "GameActivityToggle", "ImageZoom", "ImplicitRelationships",
    "IrcColors", "MemberCount", "MessageClickActions", "MessageLinkEmbeds", "MessageLogger",
    "MutualGroupDMs", "NoOnboardingDelay", "OnePingPerDM", "OpenInApp", "PinDMs",
    "PlatformIndicators", "RevealAllSpoilers", "ReviewDB", "RoleColorEverywhere", "ShowConnections",
    "ShowHiddenChannels", "ShowHiddenThings", "ShowMeYourName", "SilentTyping", "StartupTimings",
    "TextReplace", "UnlockedAvatarZoom", "ValidReply", "ValidUser", "ViewIcons",
    "VolumeBooster"
]);

function getPluginFolderKey(folderName: string): { category: string; dir: string } | null {
    if (!folderName) return null;
    const parts = folderName.replace(/\\/g, "/").replace(/^src\//, "").split("/");
    if (parts.length >= 2) {
        return { category: parts[0], dir: parts[1] };
    }
    return null;
}

export function isTestcordModified(plugin: Plugin | null | undefined, folderName = ""): boolean {
    if (!plugin) return false;
    if (plugin.testcordModified) return true;
    if (plugin.tags?.some(t => {
        const norm = t.toLowerCase();
        return norm === "testcord modified" || norm === "testcord-modified";
    })) return true;

    const folderKey = getPluginFolderKey(folderName);
    const dir = folderKey?.dir ?? "";
    const category = folderKey?.category ?? "";

    if (category === "equicordplugins" || category === "plugins") {
        if (TESTCORD_MODIFIED_EQUICORD_FOLDERS.has(dir) || TESTCORD_MODIFIED_VENCORD_FOLDERS.has(dir)) {
            return true;
        }
    }

    if (TESTCORD_MODIFIED_EQUICORD_NAMES.has(plugin.name) || TESTCORD_MODIFIED_VENCORD_NAMES.has(plugin.name)) {
        return true;
    }

    const isExternal = folderName.startsWith("src/plugins/") || folderName.startsWith("src/equicordplugins/");
    if (isExternal && plugin.authors?.some(a => a && isTestcordPluginDev(String(a.id)))) {
        return true;
    }

    if (folderName.startsWith("src/testcordplugins/") && plugin.isModified) {
        return true;
    }

    return false;
}

export function getTestcordModifiedDetails(plugin: Plugin, folderName = "") {
    const folderKey = getPluginFolderKey(folderName);
    const category = folderKey?.category ?? "";
    const dir = folderKey?.dir ?? "";

    const isEquicordFolder = category === "equicordplugins" || folderName.startsWith("src/equicordplugins/");
    const isEquicord = isEquicordFolder || TESTCORD_MODIFIED_EQUICORD_FOLDERS.has(dir) || TESTCORD_MODIFIED_EQUICORD_NAMES.has(plugin.name);

    if (isEquicord) {
        return {
            src: EquicordTestcordModifiedIconUrl,
            alt: "Modified",
            title: "Modified Equicord Plugin"
        };
    }

    const isVencordFolder = category === "plugins" || folderName.startsWith("src/plugins/");
    const isVencord = isVencordFolder || TESTCORD_MODIFIED_VENCORD_FOLDERS.has(dir) || TESTCORD_MODIFIED_VENCORD_NAMES.has(plugin.name);

    if (isVencord) {
        const hasEquicordAuthor = plugin.authors?.some(a => a && isEquicordPluginDev(String(a.id)));
        if (plugin.isModified || hasEquicordAuthor) {
            return {
                src: EquicordVencordTestcordModifiedIconUrl,
                alt: "Modified",
                title: "Modified Plugin (Equicord & Vencord)"
            };
        }

        return {
            src: VencordTestcordModifiedIconUrl,
            alt: "Modified",
            title: "Modified Vencord Plugin"
        };
    }

    const hasEquicordAuthor = plugin.authors?.some(a => a && isEquicordPluginDev(String(a.id)));
    if (hasEquicordAuthor) {
        return {
            src: EquicordTestcordModifiedIconUrl,
            alt: "Modified",
            title: "Modified Equicord Plugin"
        };
    }

    return {
        src: VencordTestcordModifiedIconUrl,
        alt: "Modified",
        title: "Modified Vencord Plugin"
    };
}
