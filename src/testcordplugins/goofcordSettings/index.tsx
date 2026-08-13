/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { disableStyle, enableStyle, setStyleClassNames } from "@api/Styles";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { findCssClassesLazy } from "@webpack";
import { Forms } from "@webpack/common";

import style from "./style.css?managed";

const classes = findCssClassesLazy("membersWrap", "messagesWrapper");

const settings = definePluginSettings({
    renderingOptimizations: {
        type: OptionType.BOOLEAN,
        description: "Apply paint containment to the message list and member list so they scroll without repainting the full layer on every change.",
        default: true,
    },
    keybinds: {
        type: OptionType.BOOLEAN,
        description: "Trick Discord into treating itself as a desktop client so the built-in custom keybinds (push-to-talk, navigate back and forward) become available in settings and actually fire.",
        default: true,
        restartNeeded: true,
    },
});

export default definePlugin({
    name: "GoofcordSettings",
    description: "Ports GoofCord's renderer-side performance fixes: paint containment on the member/message lists, plus an unlock for Discord's desktop keybinds.",
    authors: [TestcordDevs.x2b],
    tags: ["Performance", "Utility"],

    settings,
    settingsAboutComponent: () => (
        <Forms.FormText>
            GoofCord ships rendering optimizations and keybinds enabled by default, so this plugin mirrors those defaults. GoofCord's other fixes live outside the renderer: Chromium performance flags, GPU/VA-API switches, firewall, encryption and UA spoofing. Those cannot run from an injected plugin and are already ported separately by TestcordOptimizer and GoofcordSecurity.
        </Forms.FormText>
    ),

    patches: [
        {
            find: "keybindActionTypes",
            predicate: () => settings.store.keybinds,
            replacement: [
                { match: /\i\.isPlatformEmbedded\b/g, replace: "true" },
                { match: /\(0,\i\.isDesktop\)\(\)/g, replace: "true" },
                {
                    match: /(CUSTOM_KEYBINDS_SETTING.{0,120}?Component:\s*(?:function\(\)\{|\(\)=>)\s*(?:return\s*)?)\i\.\i(\s*\?)/,
                    replace: "$1true$2",
                },
                {
                    match: /(SYSTEM_CUSTOM_KEYBINDS_CATEGORY.{0,500}?useHeaderDecoration:\s*(?:function\(\)\{|\(\)=>)\s*(?:return\s*)?)\i\.\i(\s*\?)/,
                    replace: "$1true$2",
                },
            ],
        },
    ],

    start() {
        if (settings.store.renderingOptimizations) this.installRenderingCSS();
    },

    stop() {
        disableStyle(style);
    },

    installRenderingCSS() {
        setStyleClassNames(style, {
            membersWrap: classes.membersWrap,
            messagesWrapper: classes.messagesWrapper,
        });
        enableStyle(style);
    },
});
