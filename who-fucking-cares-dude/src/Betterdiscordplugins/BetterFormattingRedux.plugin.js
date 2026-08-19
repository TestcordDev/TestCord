"use strict";
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
/* eslint-disable eqeqeq, no-prototype-builtins, no-unsafe-optional-chaining */
/**
 * @name BetterFormattingRedux
 * @description Enables different types of formatting in standard Discord chat.
 * @version 2.3.15
 * @author Zerebos
 * @authorId 249746236008169473
 * @website https://github.com/zerebos/BetterDiscordAddons/tree/master/Plugins/BetterFormattingRedux
 * @source https://raw.githubusercontent.com/zerebos/BetterDiscordAddons/master/Plugins/BetterFormattingRedux/BetterFormattingRedux.plugin.js
 */
/* @cc_on
@if (@_jscript)

    // Offer to self-install for clueless users that try to run this directly.
    var shell = WScript.CreateObject("WScript.Shell");
    var fs = new ActiveXObject("Scripting.FileSystemObject");
    var pathPlugins = shell.ExpandEnvironmentStrings("%APPDATA%\\BetterDiscord\\plugins");
    var pathSelf = WScript.ScriptFullName;
    // Put the user at ease by addressing them in the first person
    shell.Popup("It looks like you've mistakenly tried to run me directly. \n(Don't do that!)", 0, "I'm a plugin for BetterDiscord", 0x30);
    if (fs.GetParentFolderName(pathSelf) === fs.GetAbsolutePathName(pathPlugins)) {
        shell.Popup("I'm in the correct folder already.", 0, "I'm already installed", 0x40);
    } else if (!fs.FolderExists(pathPlugins)) {
        shell.Popup("I can't find the BetterDiscord plugins folder.\nAre you sure it's even installed?", 0, "Can't install myself", 0x10);
    } else if (shell.Popup("Should I copy myself to BetterDiscord's plugins folder for you?", 0, "Do you need some help?", 0x34) === 6) {
        fs.CopyFile(pathSelf, fs.BuildPath(pathPlugins, fs.GetFileName(pathSelf)), true);
        // Show the user where to put plugins in the future
        shell.Exec("explorer " + pathPlugins);
        shell.Popup("I'm installed!", 0, "Successfully installed", 0x40);
    }
    WScript.Quit();

@else@*/
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
    for (var name in all)
        __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
        for (const key of __getOwnPropNames(from))
            if (!__hasOwnProp.call(to, key) && key !== except)
                __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
};
var __toCommonJS = mod => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
// src/plugins/BetterFormattingRedux/index.ts
var index_exports = {};
__export(index_exports, {
    default: () => BetterFormattingRedux
});
module.exports = __toCommonJS(index_exports);
// src/common/plugin.ts
var Plugin = class {
    meta;
    manifest;
    settings;
    defaultSettings;
    LocaleManager;
    get strings() {
        if (!this.manifest.strings)
            return {};
        const locale = this.LocaleManager?.locale.split("-")[0] ?? "en";
        if (this.manifest.strings.hasOwnProperty(locale))
            return this.manifest.strings[locale];
        if (this.manifest.strings.hasOwnProperty("en"))
            return this.manifest.strings.en;
        return this.manifest.strings;
    }
    constructor(meta, zplConfig) {
        this.meta = meta;
        this.manifest = zplConfig;
        if (typeof this.manifest.config !== "undefined") {
            this.defaultSettings = {};
            for (let s = 0; s < this.manifest.config.length; s++) {
                const current = this.manifest.config[s];
                if (current.type != "category") {
                    this.defaultSettings[current.id] = current.value;
                }
                else {
                    for (let si = 0; si < current.settings.length; si++) {
                        const subCurrent = current.settings[si];
                        this.defaultSettings[subCurrent.id] = subCurrent.value;
                    }
                }
            }
            this.settings = BdApi.Utils.extend({}, this.defaultSettings);
        }
        const currentVersionInfo = BdApi.Data.load(this.meta.name, "version");
        if (currentVersionInfo !== this.meta.version) {
            this.#showChangelog();
            BdApi.Data.save(this.meta.name, "version", this.meta.version);
        }
        if (this.manifest.strings)
            this.LocaleManager = BdApi.Webpack.getByKeys("locale", "initialize");
        if (this.manifest.config && !this.getSettingsPanel) {
            this.getSettingsPanel = () => {
                this.#updateConfig();
                return BdApi.UI.buildSettingsPanel({
                    onChange: (_, id, value) => {
                        this.settings[id] = value;
                        this.saveSettings();
                    },
                    settings: this.manifest.config
                });
            };
        }
    }
    async start() {
        BdApi.Logger.info(this.meta.name, `version ${this.meta.version} has started.`);
        if (this.defaultSettings)
            this.settings = this.loadSettings();
        if (typeof this.onStart === "function")
            this.onStart();
    }
    stop() {
        BdApi.Logger.info(this.meta.name, `version ${this.meta.version} has stopped.`);
        if (typeof this.onStop === "function")
            this.onStop();
    }
    #showChangelog() {
        if (typeof this.manifest.changelog === "undefined")
            return;
        const changelog = {
            title: this.meta.name + " Changelog",
            subtitle: `v${this.meta.version}`,
            changes: []
        };
        if (!Array.isArray(this.manifest.changelog))
            Object.assign(changelog, this.manifest.changelog);
        else
            changelog.changes = this.manifest.changelog;
        BdApi.UI.showChangelogModal(changelog);
    }
    saveSettings() {
        BdApi.Data.save(this.meta.name, "settings", this.settings);
    }
    loadSettings() {
        return BdApi.Utils.extend({}, this.defaultSettings ?? {}, BdApi.Data.load(this.meta.name, "settings"));
    }
    #updateConfig() {
        if (!this.manifest.config)
            return;
        for (const setting of this.manifest.config) {
            if (setting.type !== "category") {
                setting.value = this.settings[setting.id] ?? setting.value;
            }
            else {
                for (const subsetting of setting.settings) {
                    subsetting.value = this.settings[subsetting.id] ?? subsetting.value;
                }
            }
        }
    }
    buildSettingsPanel(onChange) {
        this.#updateConfig();
        return BdApi.UI.buildSettingsPanel({
            onChange: (groupId, id, value) => {
                this.settings[id] = value;
                onChange?.(groupId, id, value);
                this.saveSettings();
            },
            settings: this.manifest.config
        });
    }
};
// src/plugins/BetterFormattingRedux/config.ts
var manifest = {
    info: {
        name: "BetterFormattingRedux",
        authors: [{
                name: "Zerebos",
                discord_id: "249746236008169473",
                github_username: "zerebos",
                twitter_username: "IAmZerebos"
            }],
        version: "2.3.15",
        description: "Enables different types of formatting in standard Discord chat.",
        github: "https://github.com/zerebos/BetterDiscordAddons/tree/master/Plugins/BetterFormattingRedux",
        github_raw: "https://raw.githubusercontent.com/zerebos/BetterDiscordAddons/master/Plugins/BetterFormattingRedux/BetterFormattingRedux.plugin.js"
    },
    changelog: [
        {
            title: "GUI Works Again",
            type: "fixed",
            items: [
                "All basic formatting buttons are now working again.",
                "Settings appear and work as expected.",
                "Formatting should happen for messages with images."
            ]
        }
    ],
    main: "index.ts",
    config: [
        {
            type: "category",
            id: "toolbar",
            name: "Toolbar Buttons",
            collapsible: true,
            shown: false,
            settings: [
                { type: "switch", id: "boldButton", name: "Bold", value: true },
                { type: "switch", id: "italicButton", name: "Italic", value: true },
                { type: "switch", id: "underlineButton", name: "Underline", value: true },
                { type: "switch", id: "strikethroughButton", name: "Strikethrough", value: true },
                { type: "switch", id: "spoilerButton", name: "Spoiler", value: true },
                { type: "switch", id: "codeButton", name: "Code", value: true },
                { type: "switch", id: "codeblockButton", name: "Codeblock", value: true },
                { type: "switch", id: "superscriptButton", name: "Superscript", value: true },
                { type: "switch", id: "smallcapsButton", name: "Smallcaps", value: true },
                { type: "switch", id: "fullwidthButton", name: "Full Width", value: true },
                { type: "switch", id: "upsidedownButton", name: "Upsidedown", value: true },
                { type: "switch", id: "variedButton", name: "Varied Caps", value: true },
                { type: "switch", id: "leetButton", name: "Leet (1337)", value: false },
                { type: "switch", id: "thiccButton", name: "Extra Thicc", value: false },
                { type: "switch", id: "firstcapsButton", name: "First Caps", value: false },
                { type: "switch", id: "uppercaseButton", name: "Uppercase", value: false },
                { type: "switch", id: "lowercaseButton", name: "Lowercase", value: false }
            ]
        },
        {
            type: "category",
            id: "formats",
            name: "Active Formats",
            collapsible: true,
            shown: false,
            settings: [
                { type: "switch", id: "superscriptFormat", name: "Superscript", value: true },
                { type: "switch", id: "smallcapsFormat", name: "Smallcaps", value: true },
                { type: "switch", id: "fullwidthFormat", name: "Full Width", value: true },
                { type: "switch", id: "upsidedownFormat", name: "Upsidedown", value: true },
                { type: "switch", id: "variedFormat", name: "Varied Caps", value: true },
                { type: "switch", id: "leetFormat", name: "Leet (1337)", value: false },
                { type: "switch", id: "thiccFormat", name: "Extra Thicc", value: false },
                { type: "switch", id: "firstcapsFormat", name: "First Caps", value: false },
                { type: "switch", id: "uppercaseFormat", name: "Uppercase", value: false },
                { type: "switch", id: "lowercaseFormat", name: "Lowercase", value: false }
            ]
        },
        {
            type: "category",
            id: "wrappers",
            name: "Wrapper Options",
            collapsible: true,
            shown: false,
            settings: [
                { type: "text", id: "superscriptWrapper", name: "Superscript", note: "The wrapper for superscripted text", value: "^^" },
                { type: "text", id: "smallcapsWrapper", name: "Smallcaps", note: "The wrapper to make Smallcaps.", value: "%%" },
                { type: "text", id: "fullwidthWrapper", name: "Full Width", note: "The wrapper for E X P A N D E D  T E X T.", value: "##" },
                { type: "text", id: "upsidedownWrapper", name: "Upsidedown", note: "The wrapper to flip the text upsidedown.", value: "&&" },
                { type: "text", id: "variedWrapper", name: "Varied Caps", note: "The wrapper to VaRy the capitalization.", value: "==" },
                { type: "text", id: "leetWrapper", name: "Leet (1337)", note: "The wrapper to talk in 13375p34k.", value: "++" },
                { type: "text", id: "thiccWrapper", name: "Extra Thicc", note: "The wrapper to get \u4E47\u4E42\u4E0B\u5C3A\u5342 \u4E0B\u5344\u5DE5\u531A\u531A.", value: "$$" },
                { type: "text", id: "firstcapsWrapper", name: "First Caps", note: "The wrapper to capitalize the first letter.", value: "--" },
                { type: "text", id: "uppercaseWrapper", name: "Uppercase", note: "The wrapper to convert to uppercase.", value: ">>" },
                { type: "text", id: "lowercaseWrapper", name: "Lowercase", note: "The wrapper to convert to lowercase.", value: "<<" }
            ]
        },
        {
            type: "category",
            id: "formatting",
            name: "Formatting Options",
            collapsible: true,
            shown: false,
            settings: [
                {
                    type: "dropdown",
                    id: "fullWidthMap",
                    name: "Fullwidth Style",
                    note: "Which style of fullwidth formatting should be used.",
                    value: true,
                    options: [
                        { label: "T H I S", value: false },
                        { label: "\uFF54\uFF48\uFF49\uFF53", value: true }
                    ]
                },
                { type: "switch", id: "reorderUpsidedown", name: "Reorder Upsidedown Text", note: "Having this enabled reorders the upside down text to make it in-order.", value: true },
                { type: "switch", id: "startCaps", name: "Start VaRiEd Caps With Capital", note: "Enabling this starts a varied text string with a capital.", value: true }
            ]
        },
        {
            type: "category",
            id: "plugin",
            name: "Functional Options",
            collapsible: true,
            shown: false,
            settings: [
                {
                    type: "dropdown",
                    id: "hoverOpen",
                    name: "Opening Toolbar",
                    note: "Determines when to show the toolbar.",
                    value: true,
                    options: [
                        { label: "Click", value: false },
                        { label: "Hover", value: true }
                    ]
                },
                {
                    type: "dropdown",
                    id: "chainFormats",
                    name: "Format Chaining",
                    note: "Swaps priority of wrappers between inner first and outer first. Check the GitHub for more info.",
                    value: true,
                    options: [
                        { label: "Inner", value: false },
                        { label: "Outer", value: true }
                    ]
                },
                { type: "switch", id: "closeOnSend", name: "Close On Send", note: "This option will close the toolbar when a message is sent.", value: true }
            ]
        },
        {
            type: "category",
            id: "style",
            name: "Style Options",
            collapsible: true,
            shown: false,
            settings: [
                {
                    type: "dropdown",
                    id: "useIcons",
                    name: "Toolbar Style",
                    note: "Switches between icons and text as the toolbar buttons.",
                    value: true,
                    options: [
                        { label: "Text", value: false },
                        { label: "Icons", value: true }
                    ]
                },
                {
                    type: "dropdown",
                    id: "rightSide",
                    name: "Toolbar Location",
                    note: "This option enables swapping toolbar location.",
                    value: true,
                    options: [
                        { label: "Left", value: false },
                        { label: "Right", value: true }
                    ]
                },
                {
                    type: "slider",
                    id: "toolbarOpacity",
                    name: "Opacity",
                    note: "This allows the toolbar to be partially seethrough.",
                    value: 1,
                    min: 0,
                    max: 1
                },
                {
                    type: "slider",
                    id: "fontSize",
                    name: "Font Size",
                    note: "Adjusts the font size between 0 and 100%.",
                    value: 85,
                    min: 0,
                    max: 100
                }
            ]
        }
    ]
};
var config_default = manifest;
// src/plugins/BetterFormattingRedux/toolbar.ts
var toolbar_default = {
    bold: {
        type: "native-format",
        name: "Bold",
        displayName: "<b>Bold</b>",
        icon: "<img src='data:image/svg+xml;utf8,<svg fill=\"white\" height=\"24\" viewBox=\"0 0 24 24\" width=\"24\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M15.6 10.79c.97-.67 1.65-1.77 1.65-2.79 0-2.26-1.75-4-4-4H7v14h7.04c2.09 0 3.71-1.7 3.71-3.79 0-1.52-.86-2.82-2.15-3.42zM10 6.5h3c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-3v-3zm3.5 9H10v-3h3.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5z\"/><path d=\"M0 0h24v24H0z\" fill=\"none\"/></svg>'>"
    },
    italic: {
        type: "native-format",
        name: "Italic",
        displayName: "<i>Italic</i>",
        icon: "<img src='data:image/svg+xml;utf8,<svg fill=\"white\" height=\"24\" viewBox=\"0 0 24 24\" width=\"24\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M0 0h24v24H0z\" fill=\"none\"/><path d=\"M10 4v3h2.21l-3.42 8H6v3h8v-3h-2.21l3.42-8H18V4z\"/></svg>'>"
    },
    underline: {
        type: "native-format",
        name: "Underline",
        displayName: "<u>Underline</u>",
        icon: "<img src='data:image/svg+xml;utf8,<svg fill=\"white\" height=\"24\" viewBox=\"0 0 24 24\" width=\"24\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M0 0h24v24H0z\" fill=\"none\"/><path d=\"M12 17c3.31 0 6-2.69 6-6V3h-2.5v8c0 1.93-1.57 3.5-3.5 3.5S8.5 12.93 8.5 11V3H6v8c0 3.31 2.69 6 6 6zm-7 2v2h14v-2H5z\"/></svg>'>"
    },
    strikethrough: {
        type: "native-format",
        name: "Strikethrough",
        displayName: "<s>Strikethrough</s>",
        icon: "<img src='data:image/svg+xml;utf8,<svg fill=\"white\" height=\"24\" viewBox=\"0 0 24 24\" width=\"24\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M0 0h24v24H0z\" fill=\"none\"/><path d=\"M10 19h4v-3h-4v3zM5 4v3h5v3h4V7h5V4H5zM3 14h18v-2H3v2z\"/></svg>'>"
    },
    spoiler: {
        type: "native-format",
        name: "Spoiler",
        displayName: "Spoiler",
        icon: "<img src='data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" fill=\"white\" viewBox=\"0 0 24 24\"><path d=\"M0 0h24v24H0z\" fill=\"none\"/><path d=\"M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z\"/></svg>'>"
    },
    code: {
        type: "native-format",
        name: "Code",
        displayName: "<span style='font-family:monospace;'>Code</span>",
        icon: "<img src='data:image/svg+xml;utf8,<svg fill=\"white\" height=\"24\" viewBox=\"0 0 24 24\" width=\"24\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M0 0h24v24H0V0z\" fill=\"none\"/><path d=\"M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z\"/></svg>'>"
    },
    codeblock: {
        type: "native-format",
        name: "Codeblock",
        displayName: "<span style='font-family:monospace;text-decoration: underline overline;'>|Codeblock|</span>",
        icon: "<img src='data:image/svg+xml;utf8,<svg fill=\"white\" height=\"24\" viewBox=\"0 0 24 24\" width=\"24\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M0 0h24v24H0z\" fill=\"none\"/><path d=\"M7.77 6.76L6.23 5.48.82 12l5.41 6.52 1.54-1.28L3.42 12l4.35-5.24zM7 13h2v-2H7v2zm10-2h-2v2h2v-2zm-6 2h2v-2h-2v2zm6.77-7.52l-1.54 1.28L20.58 12l-4.35 5.24 1.54 1.28L23.18 12l-5.41-6.52z\"/></svg>'>"
    },
    superscript: {
        type: "bfr-format",
        name: "Superscript",
        displayName: "\u02E2\u1D58\u1D56\u1D49\u02B3\u02E2\u1D9C\u02B3\u1DA6\u1D56\u1D57",
        icon: "<img src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAC9UlEQVR4nO2av08UQRTH+WFhDDFXUFhcYcKBFMRYWtgLgdLS4go7IHAJBYl2FJb8UOsrLC0sjJyGPwMTf5xWJFhYUFBcYfRjsUOczL1d9sfczuwyn+Sa2/fefWdu33ffwI2NBQKBQIUBFoBdoA+cA7+Ad8AO0HStb2QAN4Bt4JR4PgEd4KZrvVYBrgNvExZu8tq1ZqsATzMs/oIt17qtADSJel2nDzxS16aBJ0ReoDMAFlzrLwzwXFh8Q4hrAj+N2F0Xmq0C9IxFPU6IbRuxn8vUOhKAL8ai7iTE3jViT8vU6hzgvrEBZ641lQZwCzgxNuDIta5SIJoOzcUDrLjWNnKU8ZmPSYCdvAW7QrG2XdmiYwN0M+TfJjoDSLwBruUVNgUcGwXPsThUqFvW/NaOgakUuQ2i2WAgLPw3sO1UYIrauTaY6DywBZzFfOsnwIOi+vQPLHSLJtTtCnXbCfEN4BnDU55OD5guqq2w2BT1Mm8q8q2emrxaLz68BRwaNb8BizlqLapcnUOgdUleIfKv/r+AJaIDiM57YCZDjZbK0ekDSyly3W6AErEu1N7PkL8v5K+nzHW/AUrIgVH7L7CWIm9NxeocWBNWFsh+8JUEPwAeqhidS/veW8jgB8AMOfvea5D9YE+I2xPiUvW99zDsB3+AVe36qnpPp3p9HwcJ4ywjHKO9ImGhIz1IeUWMH9Sz7+MQ/KCefR8H8nwAVX7eZyFswFVugSttgsiPwT7Do3L9HoPIg9AAuKde5l9x6jUIxfR9R7veEa7Xww+Q+/4VMKnFTKr3TKrtB8jH4Y/AvBA7r67pVPc4jPy8/0HC/9+AFRWjU835ALnvN1PkbQp51fID5L5/CUykyJ1QsSbV8APkvv8AzGWoMadydPz3A+S+/w4s56i1rHJ1/PYD5L7fKFBvQ6jnpx8g9/0LYLxAzXFVw8QvP0Du+x4wa6H2LMM/ffPHD5D73qrAmA32ww+Q+976LRrTYn76QSAQCAQCgUAgEKg8/wD8huCrKK8/kQAAAABJRU5ErkJggg=='>"
    },
    smallcaps: {
        type: "bfr-format",
        name: "Smallcaps",
        displayName: "S\u1D0D\u1D00\u029F\u029FC\u1D00\u1D18s",
        icon: "<svg fill=\"white\" height=\"24\" viewBox=\"0 0 24 24\" width=\"24\" xmlns=\"http://www.w3.org/2000/svg\"><defs><path d=\"M24 24H0V0h24v24z\" id=\"a\"/></defs><clipPath id=\"b\"><use overflow=\"visible\" href=\"#a\"/></clipPath><path clip-path=\"url(#b)\" d=\"M2.5 4v3h5v12h3V7h5V4h-13zm19 5h-9v3h3v7h3v-7h3V9z\"/></svg>"
    },
    fullwidth: {
        type: "bfr-format",
        name: "Fullwidth",
        displayName: "\uFF26\uFF55\uFF4C\uFF4C\uFF57\uFF49\uFF44\uFF54\uFF48",
        icon: "<img src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAA80lEQVR4nO3XzQ2CMBxAcQ4MwcFFHIRBWIQF2MBBZBAGeV5ogkSj1JQife9s0n9/Uj6qyszMzMzMLCIyl3v/AghQOkBsp9lIbAIIIIAAAggggAACCCCAAAIIIIAAuefZPQEEEEAAAQQQQIDTAAA1MGz4fRQAMAB13JSJAhpg3OOfnL1GoEm91lcBLXDf61JeXDR3oE293qdhOmDa8yyvTs4EdKnXfDXEBejX5zgDQKgHLqnXDgNcgdubQXJ2A66pN/903g9Y2vsCpQPMCOUegQVCuTfB1TBlPgZXA5X7IhSi5FfhEBs/hn5Y53gfQ2ZmZv/ZAxEIe1ZZ+BlyAAAAAElFTkSuQmCC'>"
    },
    upsidedown: {
        type: "bfr-format",
        name: "Upsidedown",
        displayName: "u\u028Dop\u01DDp\u1D09sd\u2229",
        icon: "<img src='data:image/svg+xml;utf8,<svg fill=\"white\" height=\"24\" viewBox=\"0 0 24 24\" width=\"24\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M16 17.01V10h-2v7.01h-3L15 21l4-3.99h-3zM9 3L5 6.99h3V14h2V6.99h3L9 3z\"/><path d=\"M0 0h24v24H0z\" fill=\"none\"/></svg>'>"
    },
    varied: {
        type: "bfr-format",
        name: "Varied",
        displayName: "VaRiEd CaPs",
        icon: "<img src='data:image/svg+xml;utf8,<svg fill=\"white\" height=\"24\" viewBox=\"0 0 24 24\" width=\"24\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M18 4l-4 4h3v7c0 1.1-.9 2-2 2s-2-.9-2-2V8c0-2.21-1.79-4-4-4S5 5.79 5 8v7H2l4 4 4-4H7V8c0-1.1.9-2 2-2s2 .9 2 2v7c0 2.21 1.79 4 4 4s4-1.79 4-4V8h3l-4-4z\"/><path d=\"M0 0h24v24H0z\" fill=\"none\"/></svg>'>"
    },
    leet: {
        type: "bfr-format",
        name: "Leet",
        displayName: "1337",
        icon: "<img src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAABnklEQVRoge2YL1MCQRiHCRf8EATCBZwhEPwARILR4DeQaDDeDIFgMPAhDAQDgaDdYDAQcMYZMThDNBgIBsJj2GXmXFdub937g/M+kfe3w+/ZeQ8YGg1BEITaAbSAa2BF9ayACRDnKb+utrOVNS4SqJuvK1MXgUXVLXfw4iLwDae9K5DcfUQgMCKQev3OnBXIrAiB81KqK86KEDgE3kooPweawQX0zPYl1wNGwDJnyQQ4sswuXfv4CPQsb9hJzbs7ZLal41S+Y2Q2pG4/uICePxuRgSXTtAg0LbmBkZnk7eMj0DciCyAyMolFYGhkIuAxNf8EWoUL6MzUiN0AMermE9QqmGyAoc7E+kyaxLePj0BL31gWc9we7iVwUJqAztnWZMsGONW5CBhnCPT/2sdHIOLnGmzLn1jyV7+UH4fo43VAS4xQq/IB3ALdHflj4F5nH4CLkH38DhSMCJTQMWyf/yDwZB6qEa8uAraPxrowcxGIqe8fW23XvWujfu+8V9sZUB1muJYX9p2sfai6XyZ7IxDi6axUTAREQBAEoQ58Aaheq+k8olaNAAAAAElFTkSuQmCC'>"
    },
    thicc: {
        type: "bfr-format",
        name: "Extra Thicc",
        displayName: "\u4E47\u4E42\u4E0B\u5C3A\u5342 \u4E0B\u5344\u5DE5\u531A\u531A",
        icon: "<img src='data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0idXRmLTgiPz4NCjwhLS0gR2VuZXJhdG9yOiBBZG9iZSBJbGx1c3RyYXRvciAxNi4wLjAsIFNWRyBFeHBvcnQgUGx1Zy1JbiAuIFNWRyBWZXJzaW9uOiA2LjAwIEJ1aWxkIDApICAtLT4NCjwhRE9DVFlQRSBzdmcgUFVCTElDICItLy9XM0MvL0RURCBTVkcgMS4xLy9FTiIgImh0dHA6Ly93d3cudzMub3JnL0dyYXBoaWNzL1NWRy8xLjEvRFREL3N2ZzExLmR0ZCI+DQo8c3ZnIHZlcnNpb249IjEuMSIgaWQ9IkxheWVyXzEiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiIHg9IjBweCIgeT0iMHB4Ig0KCSB3aWR0aD0iMjRweCIgaGVpZ2h0PSIyNHB4IiB2aWV3Qm94PSIwIDAgMjQgMjQiIGVuYWJsZS1iYWNrZ3JvdW5kPSJuZXcgMCAwIDI0IDI0IiB4bWw6c3BhY2U9InByZXNlcnZlIj4NCjxwYXRoIGRpc3BsYXk9Im5vbmUiIGZpbGw9IiNGRkZGRkYiIGQ9Ik0xNS42LDEwLjc5YzAuOTcxLTAuNjcsMS42NS0xLjc3LDEuNjUtMi43OWMwLTIuMjYtMS43NS00LTQtNEg3djE0aDcuMDQNCgljMi4wOSwwLDMuNzEtMS43LDMuNzEtMy43OUMxNy43NSwxMi42ODksMTYuODkxLDExLjM5LDE1LjYsMTAuNzl6IE0xMCw2LjVoM2MwLjgzLDAsMS41LDAuNjcsMS41LDEuNVMxMy44Myw5LjUsMTMsOS41aC0zVjYuNXoNCgkgTTEzLjUsMTUuNUgxMHYtM2gzLjVjMC44MywwLDEuNSwwLjY3LDEuNSwxLjVTMTQuMzMsMTUuNSwxMy41LDE1LjV6Ii8+DQo8cGF0aCBmaWxsPSJub25lIiBkPSJNMCwwaDI0djI0SDBWMHoiLz4NCjx0ZXh0IHRyYW5zZm9ybT0ibWF0cml4KDEgMCAwIDEgNS45MzU1IDE0Ljk5NzEpIiBmaWxsPSIjRkZGRkZGIiBzdHJva2U9IiNGRkZGRkYiIHN0cm9rZS1taXRlcmxpbWl0PSIxMCIgZm9udC1mYW1pbHk9IidLb3pHb1ByNk4tUmVndWxhci04M3B2LVJLU0otSCciIGZvbnQtc2l6ZT0iMTIuNTY0Ij7kuYc8L3RleHQ+DQo8L3N2Zz4NCg=='>"
    },
    firstcaps: {
        type: "bfr-format",
        name: "First Caps",
        displayName: "First Caps",
        icon: "<img src='data:image/svg+xml;utf8,<svg fill=\"white\" height=\"24\" viewBox=\"0 0 24 24\" width=\"24\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M15 10 A4 4 0 1 0 15 14 h2 A6 6 0 1 1 17 10 h-2 z\"/><path d=\"M0 0h24v24H0z\" fill=\"none\"/></svg>'>"
    },
    uppercase: {
        type: "bfr-format",
        name: "Uppercase",
        displayName: "UPPERCASE",
        icon: "<img src='data:image/svg+xml;utf8,<svg fill=\"white\" height=\"24\" viewBox=\"0 0 24 24\" width=\"24\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M2 8 v3h1.5v8h3v-3h-1.5v-5h1.5v-3h-1.5v-3h-1.5v3h-1.5z M8.5 10.5 v3h3v3L14.5 12L11.5 7.5v3h-3z M15.5 4 v3h2.5v12h3V7h2.5v-3h-8z\"/><path d=\"M0 0h24v24H0z\" fill=\"none\"/></svg>'>"
    },
    lowercase: {
        type: "bfr-format",
        name: "Lowercase",
        displayName: "lowercase",
        icon: "<img src='data:image/svg+xml;utf8,<svg fill=\"white\" height=\"24\" viewBox=\"0 0 24 24\" width=\"24\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M2 4 v3h2.5v12h3V7h2.5v-3h-8z M9.5 10.5 v3h3v3L15.5 12L12.5 7.5v3h-3z M16.5 8 v3h1.5v8h3v-3h-1.5v-5h1.5v-3h-1.5v-3h-1.5v3h-1.5z\"/><path d=\"M0 0h24v24H0z\" fill=\"none\"/></svg>'>"
    }
};
// src/plugins/BetterFormattingRedux/languages.ts
var languages_default = {
    A: { ada: "Ada", awk: "Awk" },
    B: { bash: "Bash" },
    C: { c: "c", clj: "Clojure", coffeescript: "CoffeeScript", cpp: "C++", crystal: "Crystal", csharp: "C#", css: "CSS" },
    D: { d: "D", dart: "Dart", delphi: "Delphi", dockerfile: "Dockerfile" },
    E: { elixir: "Elixir", elm: "Elm", erl: "Erlang" },
    F: { fs: "F#" },
    G: { go: "Go", graphql: "GraphQL", groovy: "Groovy" },
    H: { hs: "Haskell", html: "HTML/XML" },
    J: { java: "Java", js: "JavaScript", json: "JSON", julia: "Julia" },
    K: { kt: "Kotlin" },
    L: { latex: "LaTeX", less: "Less", lisp: "Lisp", lua: "Lua" },
    O: { ml: "OCaml" },
    M: { markdown: "Markdown", matlab: "Matlab", mk: "Makefile" },
    N: { nginx: "Nginx", nim: "Nim" },
    P: { perl: "Perl", php: "PHP", powershell: "Powershell", prolog: "Prolog", py: "Python" },
    R: { pl: "Raku", r: "R", rs: "Rust", ruby: "Ruby" },
    S: { sas: "SAS", scala: "Scala", scheme: "Scheme", scss: "SCSS", sql: "SQL", switf: "Swift" },
    T: { tcl: "Tcl", ts: "TypeScript" },
    V: { vbnet: "VB.NET", vhdl: "VHDL" },
    Z: { zsh: "ZSH" }
};
// src/plugins/BetterFormattingRedux/styles.css
var styles_default = `.bf-toolbar {
	user-select: none;
	white-space: nowrap;
	font-size:85%;
	display:block;
	position: absolute;
	color: rgba(255, 255, 255, .5);
	width:auto!important;
	right:0;
	bottom:auto;
	border-radius:3px;
	height:27px!important;
	top:0px;
	transform:translate(0,-100%);
	opacity:1;
	overflow: hidden!important;
	pointer-events: none;
	padding:10px 30px 15px 5px;
	margin: 0 5px 0 0;
}

.bf-toolbar.bf-visible,
.bf-toolbar.bf-hover:hover{
	pointer-events: initial;
}

.bf-toolbar::before {
	content:"";
	display: block;
	width:100%;
	height:calc(100% - 15px);
	position: absolute;
	z-index: -1;
	background:#424549;
	pointer-events: initial;
	left:0px;
	top:5px;
	border-radius:3px;
	transform:translate(0,55px);
	transition:all 200ms ease;
}

.theme-light .bf-toolbar::before {
	background: #97A0AA;
}

.bf-toolbar.bf-visible:before,
.bf-toolbar.bf-hover:hover:before {
	transform:translate(0,0px);
	transition:all 200ms cubic-bezier(0,0,0,1);
}

.bf-toolbar .format {
	display: inline;
	padding: 7px 5px;
	cursor: pointer;
	display : inline-flex;
	align-items : center;
	transform:translate(0,55px);
	transition:all 50ms,transform 200ms ease;
	position:relative;
	pointer-events: initial;
	border-radius:2px;
	max-height: 27px;
	box-sizing: border-box;
	vertical-align: middle;
}

.bf-toolbar .format > img,
.bf-toolbar .format > svg {
	opacity: 0.6;
	vertical-align: middle;
	max-height: inherit;
}

.bf-toolbar .format .format-border {
	border: 1px solid rgba(255, 255, 255, .5);
	border-radius: inherit;
}

.bf-toolbar .format:hover{
	background:rgba(255,255,255,.1);
	color:rgba(255,255,255,.9);
}

.bf-toolbar .format:active{
	background:rgba(0,0,0,.1)!important;
	transition:all 0ms,transform 200ms ease;
}

.bf-toolbar.bf-visible .format,
.bf-toolbar.bf-hover:hover .format{
	transform:translate(0,0);
	transition:all 50ms,transform 200ms cubic-bezier(0,0,0,1);
}

.bf-toolbar .format.disabled {
	display: none;
}

.bf-toolbar .format.ghost {
	color: transparent;
	background: rgba(0,0,0,.1);
}

.bf-toolbar .format.ghost > img,
.bf-toolbar .format.ghost > svg {
	opacity: 0;
}

.theme-light .bf-toolbar:hover .bf-arrow,
.bf-toolbar .bf-arrow {
	content:"";
	display:block;
	background: url('data:image/svg+xml;utf8,<svg fill="white" height="24" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/><path d="M0 0h24v24H0z" fill="none"/></svg>');
	height:30px;
	width:30px;
	right:5px;
	position: absolute;
	pointer-events: initial;
	bottom:0;
	background-repeat: no-repeat;
	background-position: 50%;
	transition:all 200ms ease;
	opacity: .3;
	cursor:pointer;
}
.theme-light .bf-toolbar .bf-arrow {
	background: url('data:image/svg+xml;utf8,<svg fill="rgb(127,129,134)" height="24" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/><path d="M0 0h24v24H0z" fill="none"/></svg>');
}
.bf-toolbar.bf-visible .bf-arrow,
.bf-toolbar.bf-hover:hover .bf-arrow {
	transform:translate(0,-14px)rotate(-90deg);
	transition:all 200ms cubic-bezier(0,0,0,1);
	opacity: .9;
}

.message-group .bf-toolbar{
	padding: 10px 5px 15px 5px;
	animation:slide-up 300ms cubic-bezier(0,0,0,1), opacity 300ms ease
}
.upload-modal .bf-toolbar {
	position: relative;
	transform: none;
	padding: 5px 0;
	margin-right: 0;
	border-radius: 2px;
	text-align: center;
	background: #424549;
}
.upload-modal .bf-toolbar::before {
	display: none;
}
.upload-modal .bf-toolbar .format:hover{
	background:rgba(255,255,255,.1);
}
.upload-modal .bf-toolbar .format:active{
	background:rgba(0,0,0,.1);
}
.upload-modal .bf-toolbar .format,
.upload-modal .bf-toolbar:before,
.message-group .bf-toolbar .format,
.message-group .bf-toolbar:before{
	transform:translate(0,0);
}
.upload-modal .bf-toolbar .bf-arrow,
.message-group .bf-toolbar .bf-arrow{
	display: none;
}

.bf-toolbar.bf-left {
	left: 0!important;
	right: auto!important;
	margin-right: 0!important;
	margin-left: 5px!important;
	padding: 10px 10px 15px 30px!important;
}

.bf-toolbar.bf-left .bf-arrow {
	left: 5px!important;
	right: auto!important;
}

.bf-toolbar.bf-left.bf-hover:hover .bf-arrow,.bf-toolbar.bf-left.bf-visible .bf-arrow {
	-webkit-transform: translate(0,-14px) rotate(90deg)!important;
	-ms-transform: translate(0,-14px) rotate(90deg)!important;
	transform: translate(0,-14px) rotate(90deg)!important;
}
.bf-languages {
	display: block;
	position: fixed !important;
	transform: scale(1,0);
	transform-origin: 100% 100%!important;
	background: #424549;
	border-radius: 3px;
	color: rgba(255,255,255,.5);
	padding: 3px;
}
.bf-languages.bf-visible {
	height: auto;
	transition: 200ms cubic-bezier(.2,0,0,1);
	transform: scale(1,1);
	transform-origin: 100% 100%!important;
}

.bf-languages div {
	display: block;
	cursor: pointer;
	padding: 5px 7px;
	border-radius: 2px;
}

.bf-languages div:hover {
	background: rgba(255,255,255,.1);
	color: rgba(255,255,255,.9);
}`;
// src/plugins/BetterFormattingRedux/toolbar.html
var toolbar_default2 = '<div id="bfredux" class="bf-toolbar"><div class="bf-arrow"></div></div>';
// src/plugins/BetterFormattingRedux/index.ts
var { ContextMenu, DOM, Patcher, UI, ReactUtils, Webpack, Logger } = BdApi;
var MessageActions = Webpack.getByKeys("jumpToMessage", "_sendMessage");
var TextareaClasses = Webpack.getByKeys("channelTextArea", "textArea") ?? { textArea: "textArea_bdf0de" };
var BetterFormattingRedux = class extends Plugin {
    customWrappers;
    buttonOrder;
    discordWrappers = { bold: "**", italic: "*", underline: "__", strikethrough: "~~", code: "`", codeblock: "```", spoiler: "||" };
    isOpen = false;
    replaceList = " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}";
    smallCapsList = " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`\u1D00\u0299\u1D04\u1D05\u1D07\uA730\u0262\u029C\u026A\u1D0A\u1D0B\u029F\u1D0D\u0274\u1D0F\u1D18\u01EB\u0280\uA731\u1D1B\u1D1C\u1D20\u1D21x\u028F\u1D22{|}";
    superscriptList = " !\"#$%&'\u207D\u207E*\u207A,\u207B./\u2070\xB9\xB2\xB3\u2074\u2075\u2076\u2077\u2078\u2079:;<\u207C>?@\u1D2C\u1D2E\u1D9C\u1D30\u1D31\u1DA0\u1D33\u1D34\u1D35\u1D36\u1D37\u1D38\u1D39\u1D3A\u1D3C\u1D3EQ\u1D3F\u02E2\u1D40\u1D41\u03BD\u1D42\u02E3\u02B8\u1DBB[\\]^_`\u1D43\u1D47\u1D9C\u1D48\u1D49\u1DA0\u1D4D\u02B0\u1DA6\u02B2\u1D4F\u02E1\u1D50\u207F\u1D52\u1D56\u146B\u02B3\u02E2\u1D57\u1D58\u1D5B\u02B7\u02E3\u02B8\u1DBB{|}";
    upsideDownList = " \xA1\"#$%\u2118,)(*+'-\u02D9/0\u0196\u218A\u0190\u07C8\u03DB9\u312586:;>=<\xBF@\u2200\u15FA\u0186\u15E1\u018E\u2132\uA4E8HI\u0550\uA4D8\uA4F6WNO\u0500\uA779\uA4E4S\uA4D5\uA4F5\u039BMX\u2144Z]\\[^\u203E,\u0250q\u0254p\u01DD\u025F\u1D77\u0265\u1D09\u027E\u029E\uA781\u026Fuodb\u0279s\u0287n\u028C\u028Dx\u028Ez}|{";
    fullwidthList = "\u3000\uFF01\uFF02\uFF03\uFF04\uFF05\uFF06\uFF07\uFF08\uFF09\uFF0A\uFF0B\uFF0C\uFF0D\uFF0E\uFF0F\uFF10\uFF11\uFF12\uFF13\uFF14\uFF15\uFF16\uFF17\uFF18\uFF19\uFF1A\uFF1B\uFF1C\uFF1D\uFF1E\uFF1F\uFF20\uFF21\uFF22\uFF23\uFF24\uFF25\uFF26\uFF27\uFF28\uFF29\uFF2A\uFF2B\uFF2C\uFF2D\uFF2E\uFF2F\uFF30\uFF31\uFF32\uFF33\uFF34\uFF35\uFF36\uFF37\uFF38\uFF39\uFF3A\uFF3B\uFF3C\uFF3D\uFF3E\uFF3F\uFF40\uFF41\uFF42\uFF43\uFF44\uFF45\uFF46\uFF47\uFF48\uFF49\uFF4A\uFF4B\uFF4C\uFF4D\uFF4E\uFF4F\uFF50\uFF51\uFF52\uFF53\uFF54\uFF55\uFF56\uFF57\uFF58\uFF59\uFF5A\uFF5B\uFF5C\uFF5D";
    leetList = " !\"#$%&'()*+,-./0123456789:;<=>?@48CD3FG#IJK1MN0PQ\u042F57UVWXY2[\\]^_`48cd3fg#ijk1mn0pq\u042F57uvwxy2{|}";
    thiccList = "\u3000!\"#$%&'()*+,-./0123456789:;<=>?@\u5342\u4E43\u531A\u5200\u4E47\u4E0B\u53B6\u5344\u5DE5\u4E01\u957F\u4E5A\u4ECE\u3093\u53E3\u5C38\u353F\u5C3A\u4E02\u4E05\u51F5\u30EA\u5C71\u4E42\u4E2B\u4E59[\\]^_`\u5342\u4E43\u531A\u5200\u4E47\u4E0B\u53B6\u5344\u5DE5\u4E01\u957F\u4E5A\u4ECE\u3093\u53E3\u5C38\u353F\u5C3A\u4E02\u4E05\u51F5\u30EA\u5C71\u4E42\u4E2B\u4E59{|}";
    constructor(meta) {
        super(meta, config_default);
        this.customWrappers = (this.manifest.config?.find(g => g.id === "wrappers")).settings.map(s => s.id);
        this.buttonOrder = (this.manifest.config?.find(g => g.id === "toolbar")).settings.map(s => s.id);
    }
    async onStart() {
        DOM.addStyle(this.meta.name + "-style", styles_default);
        this.setupToolbar();
        if (!MessageActions)
            return Logger.error(this.meta.name, "Could not find MessageActions module!");
        Patcher.before(this.meta.name, MessageActions, "sendMessage", (_, [, msg]) => {
            msg.content = this.format(msg.content);
        });
    }
    onStop() {
        Patcher.unpatchAll(this.meta.name);
        document.querySelector(".bf-toolbar")?.remove();
        DOM.removeStyle(this.meta.name + "-style");
    }
    observer(e) {
        if (!e.addedNodes.length || !(e.addedNodes[0] instanceof Element))
            return;
        const elem = e.addedNodes[0];
        const textarea = elem.matches(`.${TextareaClasses.textArea}`) ? elem : elem.querySelector(`.${TextareaClasses.textArea}`);
        if (textarea)
            this.addToolbar(textarea);
    }
    updateStyle() {
        this.updateSide();
        this.updateOpacity();
        this.updateFontSize();
    }
    updateSide() {
        const toolbar = document.querySelector(".bf-toolbar");
        if (!toolbar)
            return;
        if (this.settings.rightSide)
            toolbar.classList.remove("bf-left");
        else
            toolbar.classList.add("bf-left");
    }
    updateOpacity() {
        const toolbar = document.querySelector(".bf-toolbar");
        if (!toolbar)
            return;
        toolbar.style.opacity = this.settings.toolbarOpacity;
    }
    updateFontSize() {
        const toolbar = document.querySelector(".bf-toolbar");
        if (!toolbar)
            return;
        toolbar.style.fontSize = this.settings.fontSize + "%";
    }
    openClose() {
        this.isOpen = !this.isOpen;
        const toolbar = document.querySelector(".bf-toolbar");
        if (!toolbar)
            return;
        toolbar.classList.toggle("bf-visible");
    }
    escape(s) {
        return s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    }
    doFormat(text, wrapper, offset) {
        if (text.substring(offset, offset + wrapper.length) != wrapper)
            return text;
        let returnText = text;
        const len = text.length;
        const begin = text.indexOf(wrapper, offset);
        if (text[begin - 1] == "\\")
            return text;
        let end = text.indexOf(wrapper, begin + wrapper.length);
        if (end != -1)
            end += wrapper.length - 1;
        if (this.settings.chainFormats) {
            for (let w = 0; w < this.customWrappers.length; w++) {
                const newText = this.doFormat(returnText, this.settings[this.customWrappers[w]], begin + wrapper.length);
                if (returnText != newText) {
                    returnText = newText;
                    end -= this.settings[this.customWrappers[w]].length * 2;
                }
            }
        }
        returnText = returnText.replace(new RegExp(`([^]{${begin}})${this.escape(wrapper)}([^]*)${this.escape(wrapper)}([^]{${len - end - 1}})`), (match, before, middle, after) => {
            let letterNum = 0;
            middle = middle.replace(/./g, letter => {
                const index = this.replaceList.indexOf(letter);
                letterNum += 1;
                if (wrapper == this.settings.fullwidthWrapper) {
                    if (this.settings.fullWidthMap)
                        return index != -1 ? this.fullwidthList[index] : letter;
                    return index != -1 ? letterNum == middle.length ? letter.toUpperCase() : letter.toUpperCase() + " " : letter;
                }
                else if (wrapper == this.settings.superscriptWrapper) {
                    return index != -1 ? this.superscriptList[index] : letter;
                }
                else if (wrapper == this.settings.smallcapsWrapper) {
                    return index != -1 ? this.smallCapsList[index] : letter;
                }
                else if (wrapper == this.settings.upsidedownWrapper) {
                    return index != -1 ? this.upsideDownList[index] : letter;
                }
                else if (wrapper == this.settings.leetWrapper) {
                    return index != -1 ? this.leetList[index] : letter;
                }
                else if (wrapper == this.settings.thiccWrapper) {
                    return index != -1 ? this.thiccList[index] : letter;
                }
                else if (wrapper == this.settings.variedWrapper) {
                    const compare = this.settings.startCaps ? 1 : 0;
                    if (letter.toLowerCase() == letter.toUpperCase())
                        letterNum -= 1;
                    return index != -1 ? letterNum % 2 == compare ? letter.toUpperCase() : letter.toLowerCase() : letter;
                }
                else if (wrapper == this.settings.firstcapsWrapper) {
                    if (letterNum == 1 || middle[letterNum - 2] === " ")
                        return letter.toUpperCase();
                }
                else if (wrapper == this.settings.uppercaseWrapper) {
                    return letter.toUpperCase();
                }
                else if (wrapper == this.settings.lowercaseWrapper) {
                    return letter.toLowerCase();
                }
                return letter;
            });
            if (wrapper == this.settings.upsidedownWrapper && this.settings.reorderUpsidedown)
                return before + middle.split("").reverse().join("") + after;
            return before + middle + after;
        });
        return returnText;
    }
    format(string) {
        let text = string;
        for (let i = 0; i < text.length; i++) {
            if (text[i] == "`") {
                const next = text.indexOf("`", i + 1);
                if (next != -1)
                    i = next;
            }
            else if (text[i] == "@") {
                const match = /@.*#[0-9]*/.exec(text.substring(i));
                if (match && match.index == 0)
                    i += match[0].length - 1;
            }
            else {
                for (let w = 0; w < this.customWrappers.length; w++) {
                    if (!this.settings[this.customWrappers[w].replace("Wrapper", "Format")])
                        continue;
                    const newText = this.doFormat(text, this.settings[this.customWrappers[w]], i);
                    if (text != newText) {
                        text = newText;
                        i -= this.settings[this.customWrappers[w]].length * 2;
                    }
                }
            }
        }
        if (this.settings.closeOnSend)
            document.querySelector(".bf-toolbar")?.classList.remove("bf-visible");
        return text;
    }
    async wrapSelection(leftWrapper, rightWrapper) {
        if (!rightWrapper)
            rightWrapper = leftWrapper;
        if (leftWrapper.startsWith("```"))
            leftWrapper += "\n";
        if (rightWrapper.startsWith("```"))
            rightWrapper = "\n" + rightWrapper;
        const textarea = document.querySelector(`.${TextareaClasses.textArea}`);
        if (!textarea)
            return;
        if (textarea.tagName === "TEXTAREA")
            return this.oldWrapSelection(textarea, leftWrapper, rightWrapper);
        const slateNode = ReactUtils.getOwnerInstance(textarea);
        const slate = slateNode?.ref?.current?.getSlateEditor();
        if (!slate)
            return;
        let offset;
        if (slate.selection.anchor.offset <= slate.selection.focus.offset) {
            offset = slate.selection.focus.offset + leftWrapper.length;
            slate.apply({ type: "insert_text", text: leftWrapper, path: slate.selection.anchor.path, offset: slate.selection.anchor.offset });
            slate.apply({ type: "insert_text", text: rightWrapper, path: slate.selection.focus.path, offset: slate.selection.focus.offset });
        }
        else {
            offset = slate.selection.anchor.offset + leftWrapper.length;
            slate.apply({ type: "insert_text", text: rightWrapper, path: slate.selection.anchor.path, offset: slate.selection.anchor.offset });
            slate.apply({ type: "insert_text", text: leftWrapper, path: slate.selection.focus.path, offset: slate.selection.focus.offset });
        }
        const newSelection = {
            anchor: { path: slate.selection.anchor.path, offset },
            focus: { path: slate.selection.focus.path, offset }
        };
        slate.selection = newSelection;
        slate.apply({ type: "insert_text", text: "", path: slate.selection.anchor.path, offset });
        slateNode.focus();
    }
    oldWrapSelection(textarea, leftWrapper, rightWrapper) {
        let text = textarea.value;
        const start = textarea.selectionStart;
        const len = text.substring(textarea.selectionStart, textarea.selectionEnd).length;
        text = leftWrapper + text.substring(textarea.selectionStart, textarea.selectionEnd) + rightWrapper;
        textarea.focus();
        document.execCommand("insertText", false, text);
        textarea.selectionStart = start + leftWrapper.length;
        textarea.selectionEnd = textarea.selectionStart + len;
    }
    getContextMenu() {
        return ContextMenu.buildMenu(Object.keys(languages_default).map(letter => {
            return {
                type: "submenu",
                label: letter,
                items: Object.keys(languages_default[letter]).map(language => {
                    return {
                        label: languages_default[letter][language],
                        action: () => {
                            this.wrapSelection("```" + language, "```");
                        }
                    };
                })
            };
        }));
    }
    buildToolbar() {
        const toolbar = DOM.parseHTML(toolbar_default2);
        const sorted = this.buttonOrder;
        for (let i = 0; i < sorted.length; i++) {
            const key = sorted[i].replace("Button", "");
            const button = DOM.parseHTML("<div class='format'>");
            if (!toolbar_default[key])
                continue;
            button.classList.add(toolbar_default[key].type);
            UI.createTooltip(button, toolbar_default[key].name);
            if (!this.settings[key + "Button"])
                button.classList.add("disabled");
            if (key === "codeblock") {
                const contextMenu = this.getContextMenu();
                button.addEventListener("contextmenu", e => {
                    ContextMenu.open(e, contextMenu, { align: "bottom" });
                });
            }
            button.dataset.name = sorted[i].replace("Button", "");
            if (this.settings.useIcons)
                button.innerHTML = toolbar_default[key].icon;
            else
                button.innerHTML = toolbar_default[key].displayName;
            toolbar.append(button);
        }
        if (!this.settings.useIcons) {
            toolbar.addEventListener("mousemove", e => {
                const target = e.currentTarget;
                const pos = e.pageX - (target.parentElement?.getBoundingClientRect()?.left ?? 0);
                const width = parseInt(getComputedStyle(target).width);
                let diff = -1 * width;
                Array.from(target.children).forEach(elem => {
                    diff += elem.offsetWidth;
                });
                target.scrollLeft = pos / width * diff;
            });
        }
        return toolbar;
    }
    setupToolbar() {
        document.querySelector(".bf-toolbar")?.remove();
        document.querySelectorAll(`.${TextareaClasses.textArea}`).forEach(elem => {
            this.addToolbar(elem.children[0]);
        });
    }
    addToolbar(textarea) {
        const toolbarElement = this.buildToolbar();
        if (this.settings.hoverOpen == true)
            toolbarElement.classList.add("bf-hover");
        if (this.isOpen)
            toolbarElement.classList.add("bf-visible");
        const inner = textarea.parentElement?.parentElement;
        if (!inner)
            return;
        inner.parentElement?.insertBefore(toolbarElement, inner.nextSibling);
        toolbarElement.addEventListener("click", e => {
            e.preventDefault();
            e.stopPropagation();
            const button = e.target.closest("div");
            if (!button)
                return;
            if (button.classList.contains("bf-arrow")) {
                if (!this.settings.hoverOpen)
                    this.openClose();
            }
            else if (button.classList.contains("format")) {
                if (!button.dataset.name)
                    return;
                let wrapper = "";
                if (button.classList.contains("native-format"))
                    wrapper = this.discordWrappers[button.dataset.name];
                else
                    wrapper = this.settings[button.dataset.name + "Wrapper"];
                this.wrapSelection(wrapper);
            }
        });
        this.updateStyle();
    }
    getSettingsPanel() {
        return this.buildSettingsPanel(this.updateSettings.bind(this));
    }
    updateSettings(group, id, value) {
        if (group == "toolbar")
            this.setupToolbar();
        if (group == "plugin" && id == "hoverOpen") {
            const toolbar = document.querySelector(".bf-toolbar");
            if (value) {
                toolbar?.classList.remove("bf-visible");
                toolbar?.classList.add("bf-hover");
            }
            else {
                toolbar?.classList.remove("bf-hover");
            }
        }
        if (group == "style") {
            if (id == "icons")
                this.setupToolbar();
            if (id == "rightSide")
                this.updateSide();
            if (id == "toolbarOpacity")
                this.updateOpacity();
            if (id == "fontSize")
                this.updateFontSize();
        }
    }
};
/* @end@*/
