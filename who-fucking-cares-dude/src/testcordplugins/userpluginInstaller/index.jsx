/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 nin0
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import "./misc/style.css";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import plSettings from "@plugins/_core/settings";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { findByPropsLazy, findComponentByCodeLazy } from "@webpack";
import SettingsTab from "./components/SettingsTab";
import UserpluginInstallButton from "./components/UserpluginInstallButton";
import { CLONE_LINK_REGEX } from "./misc/constants";
import { VariableWithCallbacks } from "./VariableWithCallbacks";
// @ts-ignore
export const Native = VencordNative.pluginHelpers.UserpluginInstaller;
export const OpenSettingsModule = findByPropsLazy("openUserSettings");
const AppsIcon = findComponentByCodeLazy("2.95H20a2 2 0");
export const settings = definePluginSettings({
    allowlistedChannels: {
        type: 0 /* OptionType.STRING */,
        description: "Comma separated list of channels where the Install Plugin button should be displayed"
    },
    notifyIfUpdate: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show a Vencord notification if UserPlugins need to be updated",
        default: true
    }
});
export default definePlugin({
    name: "UserpluginInstaller",
    description: "Install userplugins with a simple button click",
    tags: ["Utility", "Developers"],
    async checkPluginUpdates() {
        for (const p of this.plugins.value()) {
            if (await Native.isUpdateAvailableForPlugin(p.directory)) {
                const t = this.pluginsWithUpdates.value().plugins;
                t.push(p.directory);
                this.pluginsWithUpdates.value({
                    finished: false,
                    plugins: t
                });
            }
        }
        const t = this.pluginsWithUpdates.value().plugins;
        this.pluginsWithUpdates.value({
            finished: true,
            plugins: t
        });
    },
    section: {
        key: "vencord_userplugins",
        title: "UserPlugins",
        panelTitle: "UserPlugins",
        Component: SettingsTab,
        Icon: AppsIcon
    },
    async start() {
        plSettings.customEntries.push(this.section);
        this.pluginsWithUpdates.registerCallback((value, id) => {
            if (value.plugins.length === 0)
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
        const pls = await Native.getUserplugins();
        // @ts-ignore :trolley:
        this.plugins.value(pls);
        await this.checkPluginUpdates();
    },
    stop() {
        // @ts-ignore
        plSettings.customEntries.splice(plSettings.customEntries.indexOf(this.section), 1);
    },
    plugins: new VariableWithCallbacks([]),
    pluginsWithUpdates: new VariableWithCallbacks({
        finished: false,
        plugins: []
    }),
    settings,
    authors: [Devs.nin0dev],
    renderMessageAccessory: props => {
        if (!props?.message?.content)
            return null;
        if (!CLONE_LINK_REGEX.test(props.message.content))
            return null;
        return <UserpluginInstallButton props={props}/>;
    }
});
