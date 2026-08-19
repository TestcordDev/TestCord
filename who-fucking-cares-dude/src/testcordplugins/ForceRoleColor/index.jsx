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
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { Text, UserStore } from "@webpack/common";
const settings = definePluginSettings({
    hint: {
        type: 6 /* OptionType.COMPONENT */,
        component: function () {
            return <Text>
                <b>Colors must be in hex (in the format of #XXXXXX) i.e. #ff0000, #123456, etc.</b><br /><br />
                Primary: Controls base color<br />
                Secondary & Tertiary: Set for gradient
                <br /><b>Switch channels for the color to update</b>
                <div style={{
                    margin: "2em 0",
                    padding: "1em",
                    backgroundColor: "#e7828430",
                    border: "1px solid #e78284",
                    borderRadius: "5px",
                    color: "var(--text-normal, white)"
                }} className="markup__75297">
                    Gradient role colors require the experiment <code className="inline" style={{ whiteSpace: "nowrap" }}>2025-03_enhanced_role_colors</code> to be enabled!
                </div>
            </Text>;
        }
    },
    primaryColor: {
        type: 0 /* OptionType.STRING */,
        description: "",
        default: undefined,
        placeholder: "#000000"
    },
    secondaryColor: {
        type: 0 /* OptionType.STRING */,
        description: "",
        default: undefined,
        placeholder: "#000000"
    },
    tertiaryColor: {
        type: 0 /* OptionType.STRING */,
        description: "",
        default: undefined,
        placeholder: "#000000"
    },
    dmsOnly: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Applies your color only in DMs",
        default: false,
    }
});
export default definePlugin({
    name: "ForceRoleColor",
    description: "Forces a specific role color on yourself globally",
    tags: ["Customisation", "Roles"],
    authors: [TestcordDevs.x2b],
    settings,
    patches: [
        {
            find: ".tertiaryColor,roleStyle:\"username\",includeConvenienceGlow:!0",
            replacement: [
                // Override message author role color
                {
                    match: /(?<=let{author:\i,message:)(\i)(.*?)(?<=colorStrings:\i,colorRoleName:\i}=)(\i)/,
                    replace: "$1$2$self.getColorsForMessages($1,$3)"
                },
                // Always enable gradient roles
                {
                    match: /\(0,\i\.\i\)\(null!=\i\?\i:\i,"BaseUsername"\)/,
                    replace: "true"
                }
            ]
        },
        {
            find: ".name,roleColors:",
            replacement: [
                // Override member list role color
                {
                    match: /(?<=let{colorRoleName.*?colorString:(\i).*?roleColorStrings:(\i).*?user:(\i).*?}=\i;)/,
                    replace: "let{colorString:_$1,roleColorStrings:_$2}=$self.getColorsForMemberList($3,$1,$2);$1=_$1;$2=_$2;"
                }
            ]
        },
        // @TODO: find a better `find` here ??? not sure how stable this is lmao
        {
            find: ".showThreadPromptOnReply&&",
            replacement: [
                // Override reply role color, uses getColorsForMessage since the keys are the same
                {
                    match: /(?<=message:(\i).*?colorString:(\i).*?,(\i)=\(0,\i\.\i\)\(\i,\i\)),/,
                    replace: ";let{colorString:_$2,colorStrings:_$3}=$self.getColorsForMessages($1,{colorString:$2,colorStrings:$3});$2=_$2;$3=_$3;let "
                }
            ]
        },
        {
            find: "memberNameText}),(0,",
            replacement: [
                // Override color in guild member search
                {
                    match: /(?<=let{member:(\i),user:(\i).*(\i)=\(0,.*?colorStrings\);)/,
                    replace: "$1=$self.getColorsForMemberSearch($2,$1);$3=$1.colorStrings;"
                }
            ]
        }
    ],
    getColorsForMessages(message, old) {
        if (message.author.id !== UserStore.getCurrentUser().id
            || (settings.store.dmsOnly && old.guildId)) {
            return old;
        }
        return {
            ...old,
            colorString: settings.store.primaryColor || old?.colorString,
            colorStrings: {
                primaryColor: settings.store.primaryColor || old?.colorStrings?.primaryColor,
                secondaryColor: settings.store.secondaryColor || old?.colorStrings?.secondaryColor,
                tertiaryColor: settings.store.tertiaryColor || old?.colorStrings?.tertiaryColor,
            }
        };
    },
    getColorsForMemberList(user, colorString, old) {
        if (user.id !== UserStore.getCurrentUser().id || settings.store.dmsOnly) {
            return {
                colorString,
                roleColorStrings: old
            };
        }
        return {
            colorString: settings.store.primaryColor || colorString,
            roleColorStrings: {
                primaryColor: settings.store.primaryColor || old?.primaryColor,
                secondaryColor: settings.store.secondaryColor || old?.secondaryColor,
                tertiaryColor: settings.store.tertiaryColor || old?.tertiaryColor,
            }
        };
    },
    getColorsForMemberSearch(user, old) {
        // can just call getColorsForMessages since keys are the same
        return this.getColorsForMessages({ author: user }, old);
    }
});
