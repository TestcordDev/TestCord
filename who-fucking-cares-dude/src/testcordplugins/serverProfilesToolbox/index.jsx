/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import "./styles.css";
import { copyToClipboard } from "@utils/clipboard";
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { findComponentByCodeLazy } from "@webpack";
import { Button, FluxDispatcher, GuildMemberStore, Text, Toasts, UserProfileStore, UserStore } from "@webpack/common";
const SummaryItem = findComponentByCodeLazy("borderType", "showBorder", "hideDivider");
const savedProfile = {
    nick: null,
    pronouns: null,
    bio: null,
    themeColors: undefined,
    banner: undefined,
    avatar: undefined,
    profileEffectId: undefined,
    avatarDecoration: undefined,
};
const IdentityActions = {
    setPendingAvatar(avatar) {
        FluxDispatcher.dispatch({
            type: "GUILD_IDENTITY_SETTINGS_SET_PENDING_AVATAR",
            avatar,
        });
    },
    setPendingBanner(banner) {
        FluxDispatcher.dispatch({
            type: "GUILD_IDENTITY_SETTINGS_SET_PENDING_BANNER",
            banner,
        });
    },
    setPendingBio(bio) {
        FluxDispatcher.dispatch({
            type: "GUILD_IDENTITY_SETTINGS_SET_PENDING_BIO",
            bio,
        });
    },
    setPendingNickname(nickname) {
        FluxDispatcher.dispatch({
            type: "GUILD_IDENTITY_SETTINGS_SET_PENDING_NICKNAME",
            nickname,
        });
    },
    setPendingPronouns(pronouns) {
        FluxDispatcher.dispatch({
            type: "GUILD_IDENTITY_SETTINGS_SET_PENDING_PRONOUNS",
            pronouns,
        });
    },
    setPendingThemeColors(themeColors) {
        FluxDispatcher.dispatch({
            type: "GUILD_IDENTITY_SETTINGS_SET_PENDING_THEME_COLORS",
            themeColors,
        });
    },
    setPendingProfileEffectId(profileEffectId) {
        FluxDispatcher.dispatch({
            type: "GUILD_IDENTITY_SETTINGS_SET_PENDING_PROFILE_EFFECT_ID",
            profileEffectId,
        });
    },
    setPendingAvatarDecoration(avatarDecoration) {
        FluxDispatcher.dispatch({
            type: "GUILD_IDENTITY_SETTINGS_SET_PENDING_AVATAR_DECORATION",
            avatarDecoration,
        });
    },
};
export default definePlugin({
    name: "ServerProfilesToolbox",
    authors: [TestcordDevs.x2b, TestcordDevs.nnenaza],
    description: "Adds a copy/paste/reset button to the server profiles editor",
    tags: ["Utility", "Servers"],
    patchServerProfiles(guild) {
        const guildId = guild.id;
        const currentUser = UserStore.getCurrentUser();
        const premiumType = currentUser.premiumType ?? 0;
        const copy = () => {
            const profile = UserProfileStore.getGuildMemberProfile(currentUser.id, guildId);
            const nick = GuildMemberStore.getNick(guildId, currentUser.id);
            const selfMember = GuildMemberStore.getMember(guildId, currentUser.id);
            savedProfile.nick = nick ?? "";
            savedProfile.pronouns = profile?.pronouns ?? null;
            savedProfile.bio = profile?.bio ?? null;
            savedProfile.themeColors = profile?.themeColors;
            savedProfile.banner = profile?.banner === null ? undefined : profile?.banner;
            savedProfile.avatar = selfMember.avatar ?? undefined;
            savedProfile.profileEffectId = profile?.profileEffectId;
            savedProfile.avatarDecoration = selfMember.avatarDecoration ?? undefined;
        };
        const paste = () => {
            IdentityActions.setPendingNickname(savedProfile.nick);
            IdentityActions.setPendingPronouns(savedProfile.pronouns);
            if (premiumType === 2) {
                IdentityActions.setPendingBio(savedProfile.bio);
                IdentityActions.setPendingThemeColors(savedProfile.themeColors);
                IdentityActions.setPendingBanner(savedProfile.banner);
                IdentityActions.setPendingAvatar(savedProfile.avatar);
                IdentityActions.setPendingProfileEffectId(savedProfile.profileEffectId);
                IdentityActions.setPendingAvatarDecoration(savedProfile.avatarDecoration);
            }
        };
        const reset = () => {
            IdentityActions.setPendingNickname(null);
            IdentityActions.setPendingPronouns("");
            if (premiumType === 2) {
                IdentityActions.setPendingBio(null);
                IdentityActions.setPendingThemeColors([]);
                IdentityActions.setPendingBanner(undefined);
                IdentityActions.setPendingAvatar(undefined);
                IdentityActions.setPendingProfileEffectId(undefined);
                IdentityActions.setPendingAvatarDecoration(undefined);
            }
        };
        const copyClipboard = () => {
            copy();
            copyToClipboard(JSON.stringify(savedProfile));
        };
        const pasteFromClipboard = async () => {
            try {
                const clip = await navigator.clipboard.readText();
                if (!clip) {
                    Toasts.show({
                        message: "Clipboard is empty",
                        type: Toasts.Type.FAILURE,
                        id: Toasts.genId(),
                    });
                    return;
                }
                const clipboardProfile = JSON.parse(clip);
                if (!("nick" in clipboardProfile)) {
                    Toasts.show({
                        message: "Data is not in correct format",
                        type: Toasts.Type.FAILURE,
                        id: Toasts.genId(),
                    });
                    return;
                }
                Object.assign(savedProfile, JSON.parse(clip));
                paste();
            }
            catch (e) {
                Toasts.show({
                    message: `Failed to read clipboard data: ${e}`,
                    type: Toasts.Type.FAILURE,
                    id: Toasts.genId(),
                });
            }
        };
        return <SummaryItem title="Server Profiles Toolbox" hideDivider={false} forcedDivider className="vc-server-profiles-toolbox">
            <div style={{ display: "flex", alignItems: "center", flexDirection: "column", gap: "5px" }}>
                <Text variant="text-md/normal">
                    Use the following buttons to mange the currently selected server
                </Text>
                <div style={{ display: "flex", gap: "5px" }}>
                    <Button onClick={copy}>
                        Copy profile
                    </Button>
                    <Button onClick={paste}>
                        Paste profile
                    </Button>
                    <Button onClick={reset}>
                        Reset profile
                    </Button>
                </div>
                <div style={{ display: "flex", gap: "5px" }}>
                    <Button onClick={copyClipboard}>
                        Copy to clipboard
                    </Button>
                    <Button onClick={pasteFromClipboard}>
                        Paste from clipboard
                    </Button>
                </div>
            </div>
        </SummaryItem>;
    },
    patches: [
        {
            find: "PROFILE_CUSTOMIZATION_GUILD_HINT.format",
            replacement: {
                match: /\(0,\i\.jsx\)\(\i\.\i,\{guildId:(\i)\.id,/,
                replace: "$self.patchServerProfiles($1),$&"
            }
        }
    ],
});
