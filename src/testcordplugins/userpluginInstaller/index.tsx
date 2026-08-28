/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 nin0
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./misc/style.css";

import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { PluginsIcon } from "@components/Icons";
import SettingsPlugin from "@plugins/_core/settings";
import { Devs, TestcordDevs } from "@utils/constants";
import { removeFromArray } from "@utils/misc";
import definePlugin, { OptionType, PluginNative, StartAt } from "@utils/types";
import { findByPropsLazy } from "@webpack";

import SettingsTab from "./components/SettingsTab";
import UserpluginInstallButton from "./components/UserpluginInstallButton";
import { CLONE_LINK_REGEX } from "./misc/constants";
import { VariableWithCallbacks } from "./VariableWithCallbacks";

// @ts-ignore
export const Native: PluginNative<typeof import("./native")> = new Proxy({} as any, {
    get: (_, prop: string) => (VencordNative.pluginHelpers as any)?.UserpluginInstaller?.[prop]
});
export const OpenSettingsModule = findByPropsLazy("openUserSettings");

export const settings = definePluginSettings({
    allowlistedChannels: {
        type: OptionType.STRING,
        description: "Comma separated list of channels where the Install Plugin button should be displayed"
    },
    notifyIfUpdate: {
        type: OptionType.BOOLEAN,
        description: "Show a Vencord notification if UserPlugins need to be updated",
        default: true
    },
    neverNotifyForPlugins: {
        type: OptionType.STRING,
        description: "Never show update notifications for these plugins (comma separated)",
        default: ""
    },
    setGitPath: {
        type: OptionType.COMPONENT,
        component: () => <Button onClick={() => {
            Native?.openGitPathModal?.();
        }} variant="secondary">
            Set Git path
        </Button>
    }
});

export default definePlugin({
    name: "UserpluginInstaller",
    description: "Install userplugins with a simple button click",
    tags: ["Utility", "Developers"],
    authors: [Devs.nin0dev, TestcordDevs.sirphantom89],
    dependencies: ["Settings"],
    startAt: StartAt.WebpackReady,
    settings,

    plugins: new VariableWithCallbacks<{
        name: string;
        description: string;
        usesPreSend: boolean;
        usesNative: boolean;
        directory: string;
        remote: string;
    }[]>([]),

    pluginsWithUpdates: new VariableWithCallbacks<{
        finished: boolean;
        plugins: string[];
    }>({
        finished: false,
        plugins: []
    }),

    async checkPluginUpdates() {
        for (const p of this.plugins.value()) {
            try {
                if (await Native?.isUpdateAvailableForPlugin?.(p.directory!)) {
                    const t = this.pluginsWithUpdates.value().plugins;
                    if (!t.includes(p.directory!)) {
                        t.push(p.directory!);
                        this.pluginsWithUpdates.value({
                            finished: false,
                            plugins: t
                        });
                    }
                }
            } catch { }
        }
        const t = this.pluginsWithUpdates.value().plugins;
        this.pluginsWithUpdates.value({
            finished: true,
            plugins: t
        });
    },

    start() {
        if (!SettingsPlugin.customEntries.some(e => e.key === "vencord_userplugins")) {
            SettingsPlugin.customEntries.push({
                key: "vencord_userplugins",
                title: "UserPlugins",
                Component: SettingsTab,
                Icon: PluginsIcon
            });
        }

        this.initBackground();
    },

    stop() {
        removeFromArray(SettingsPlugin.customEntries, e => e.key === "vencord_userplugins");
    },

    async initBackground() {
        try {
            await Native?.ensurePluginsDirectory?.();
        } catch { }

        this.pluginsWithUpdates.registerCallback((value, id) => {
            if (!value?.plugins || value.plugins.length === 0) return;
            const neverList = (settings.store.neverNotifyForPlugins || "").split(",").map(t => t.trim().toLowerCase());
            if (neverList.includes(value.plugins[value.plugins.length - 1]?.toLowerCase()))
                return;
            this.pluginsWithUpdates.deregisterCallback(id);
            if (settings.store.notifyIfUpdate)
                showNotification({
                    title: "Some UserPlugins are out of date!",
                    body: "Click to open the UserPlugin Updater",
                    noPersist: true,
                    permanent: true,
                    onClick() {
                        OpenSettingsModule.openUserSettings("vencord_userplugins_panel");
                    },
                });
        });

        try {
            const pls = await Native?.getUserplugins?.();
            if (pls && Array.isArray(pls)) {
                // @ts-ignore :trolley:
                this.plugins.value(pls);
                await this.checkPluginUpdates();
            }
        } catch { }
    },

    renderMessageAccessory: props => {
        if (!props?.message?.content) return null;
        if (!CLONE_LINK_REGEX.test(props.message.content)) return null;
        return <UserpluginInstallButton props={props} />;
    }
});
