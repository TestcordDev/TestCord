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
import { definePluginSettings, Settings } from "@api/Settings";
import { getCustomColorString } from "@equicordplugins/customUserColors";
import { hash as h64 } from "@intrnl/xxhash64";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { useMemo, UserStore } from "@webpack/common";
const h64Cache = new Map();
function cachedH64(id) {
    let cached = h64Cache.get(id);
    if (cached === undefined) {
        cached = h64(id);
        h64Cache.set(id, cached);
    }
    return cached;
}
// Calculate a CSS color string based on the user ID
function calculateNameColorForUser(id) {
    const { lightness } = settings.use(["lightness"]);
    const idHash = useMemo(() => id ? h64(id) : null, [id]);
    return idHash && `hsl(${idHash % 360n}, 100%, ${lightness}%)`;
}
const settings = definePluginSettings({
    lightness: {
        description: "Lightness, in %. Change if the colors are too light or too dark",
        type: 1 /* OptionType.NUMBER */,
        default: 70,
    },
    memberListColors: {
        description: "Replace role colors in the member list",
        restartNeeded: true,
        type: 3 /* OptionType.BOOLEAN */,
        default: true
    },
    applyColorOnlyToUsersWithoutColor: {
        description: "Apply colors only to users who don't have a predefined color",
        restartNeeded: false,
        type: 3 /* OptionType.BOOLEAN */,
        default: false
    },
    applyColorOnlyInDms: {
        displayName: "Apply Color Only In DMs",
        description: "Apply colors only in direct messages; do not apply colors in servers.",
        restartNeeded: false,
        type: 3 /* OptionType.BOOLEAN */,
        default: false
    }
});
export default definePlugin({
    name: "IrcColors",
    description: "Makes username colors in chat unique, like in IRC clients",
    tags: ["Appearance", "Customisation"],
    authors: [Devs.Grzesiek11, Devs.jamesbt365],
    settings,
    patches: [
        {
            find: '="SYSTEM_TAG"',
            replacement: {
                // Override colorString with our custom color and disable gradients if applying the custom color.
                match: /(?<=colorString:\i,colorStrings:\i,colorRoleName:\i.*?}=)(\i),/,
                replace: "$self.wrapMessageColorProps($1, arguments[0]),"
            }
        },
        {
            find: "#{intl::GUILD_OWNER}),children:",
            replacement: {
                match: /(?<=roleName:\i,)colorString:/,
                replace: "colorString:$self.calculateNameColorForListContext(arguments[0]),originalColor:"
            },
            predicate: () => settings.store.memberListColors
        }
    ],
    wrapMessageColorProps(colorProps, context) {
        try {
            const colorString = this.calculateNameColorForMessageContext(context);
            if (colorString === colorProps.colorString) {
                return colorProps;
            }
            return {
                ...colorProps,
                colorString,
                colorStrings: colorProps.colorStrings && {
                    primaryColor: colorString,
                    secondaryColor: undefined,
                    tertiaryColor: undefined
                }
            };
        }
        catch (e) {
            console.error("Failed to calculate message color strings:", e);
            return colorProps;
        }
    },
    calculateNameColorForMessageContext(context) {
        const userId = context?.message?.author?.id;
        const colorString = context?.author?.colorString;
        const color = calculateNameColorForUser(userId);
        if (Settings.plugins.CustomUserColors.enabled) {
            const customColor = getCustomColorString(userId, true);
            if (customColor)
                return customColor;
        }
        if (context?.message?.channel_id === "1337" && userId === "313337")
            return colorString;
        if (settings.store.applyColorOnlyInDms && !context?.channel?.isPrivate()) {
            return colorString;
        }
        const dmColor = (!settings.store.applyColorOnlyToUsersWithoutColor || !colorString)
            ? color
            : colorString;
        // guarantee minimum difference in dms
        if (context?.channel?.isPrivate?.() && dmColor && userId) {
            const currentUserId = UserStore.getCurrentUser()?.id;
            if (currentUserId && userId !== currentUserId) {
                const currentUserColor = Number(cachedH64(currentUserId) % 360n);
                const otherUserColor = Number(cachedH64(userId) % 360n);
                const colorDiff = Math.min(Math.abs(currentUserColor - otherUserColor), 360 - Math.abs(currentUserColor - otherUserColor));
                if (colorDiff < 70) {
                    const newColor = (otherUserColor + 180) % 360;
                    return `hsl(${newColor}, 100%, ${settings.store.lightness}%)`;
                }
            }
        }
        return dmColor;
    },
    calculateNameColorForListContext(context) {
        try {
            const id = context?.user?.id;
            const colorString = context?.colorString;
            const color = calculateNameColorForUser(id);
            if (Settings.plugins.CustomUserColors.enabled) {
                const customColor = getCustomColorString(id, true);
                if (customColor)
                    return customColor;
            }
            if (settings.store.applyColorOnlyInDms && context?.guildId !== undefined) {
                return colorString;
            }
            return (!settings.store.applyColorOnlyToUsersWithoutColor || !colorString)
                ? color
                : colorString;
        }
        catch (e) {
            console.error("Failed to calculate name color for list context:", e);
        }
    }
});
