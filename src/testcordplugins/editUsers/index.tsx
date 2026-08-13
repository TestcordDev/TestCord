/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { User } from "@vencord/discord-types";
import { Menu } from "@webpack/common";

import { getUserOverride, hasFlag, OverrideFlags, settings } from "./data";
import { openUserEditModal } from "./modal";

export default definePlugin({
    name: "EditUsers",
    description: "Edit users",
    tags: ["Utility", "Customisation"],
    authors: [TestcordDevs.x2b],

    settings,

    contextMenus: {
        "user-context"(children, { user }: { user?: User; }) {
            if (!user) return;

            children.push(
                <Menu.MenuItem
                    id="vc-edit-user"
                    label="Edit User"
                    action={() => openUserEditModal(user)}
                />
            );
        }
    },

    patches: [
        {
            find: ",getUserTag:",
            replacement: {
                match: /function \i\((\i)\)\{return(?=c\(\1\.global_name\))/,
                replace: "function $1($2){const vcEuName=$self.getUsername($2);if(vcEuName)return vcEuName;return"
            }
        },
        {
            find: "=this.guildMemberAvatars[",
            replacement: [
                {
                    match: /null!=(\i)\?this\.guildMemberAvatars\[\1\]:void 0;return null!=\i&&null!=\1/,
                    replace: "$& && !$self.shouldIgnoreGuildAvatar(this)"
                },
                {
                    match: /:(\i\.\i\.getUserAvatarURL\(this)/,
                    replace: ":$self.getAvatarUrl(this)||$1"
                }
            ]
        },
        {
            find: "this.isUsingGuildMemberBanner()",
            replacement: [
                {
                    match: /this\._guildMemberProfile\?\.banner!=null/,
                    replace: "$& && !$self.shouldIgnoreGuildBanner(this.userId)"
                },
                {
                    match: /(?<=:\s*)\i\.\i\(\{id:this\.userId,banner:this\.banner/,
                    replace: "$self.getBannerUrl(this.userId)||$&"
                },
                {
                    match: /isUsingGuildMemberPronouns\(\)\{/,
                    replace:
                        "set pronouns(v){this._vcPronouns=v}" +
                        "get pronouns(){return $self.getPronouns(this.userId)||this._vcPronouns}" +
                        "isUsingGuildMemberPronouns(){"
                }
            ]
        },
        {
            find: '"GuildMemberStore"',
            replacement: {
                match: /getNick\(\i,(\i)\)\{/,
                replace: "$& if ($self.shouldIgnoreNick($1)) return null;"
            }
        }
    ],

    getUsername: (user: User) => getUserOverride(user.id).username,
    getAvatarUrl: (user: User) => getUserOverride(user.id).avatarUrl,
    getBannerUrl: (userId: string) => getUserOverride(userId).bannerUrl,
    getPronouns: (userId: string) => getUserOverride(userId).pronouns,

    shouldIgnoreGuildAvatar(user: User) {
        const { avatarUrl, flags } = getUserOverride(user.id);

        if (avatarUrl && !hasFlag(flags, OverrideFlags.KeepServerAvatar))
            return true;

        return hasFlag(flags, OverrideFlags.DisableServerAvatars);
    },

    shouldIgnoreGuildBanner(userId: string) {
        const { bannerUrl, flags } = getUserOverride(userId);

        if (bannerUrl && !hasFlag(flags, OverrideFlags.KeepServerBanner))
            return true;

        return hasFlag(flags, OverrideFlags.DisableServerBanners);
    },

    shouldIgnoreNick(userId?: string) {
        if (!userId) return false;

        const { username, flags } = getUserOverride(userId);

        if (username && !hasFlag(flags, OverrideFlags.PreferServerNicks))
            return true;

        return hasFlag(flags, OverrideFlags.DisableNicks);
    }
});
