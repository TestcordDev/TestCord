/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { bundledPlugins } from "./bundledPlugins";
import { BDPluginManager } from "./PluginManager";
const logger = new Logger("BetterDiscordPlugins", "#ff7373");
export default definePlugin({
    name: "BetterDiscordPlugins",
    description: "Load BetterDiscord .plugin.js files. Place your plugins in the Betterdiscordplugins folder.",
    authors: [{ name: "Testcord Team", id: 0n }],
    version: "1.0.0",
    required: true,
    tags: ["betterdiscord", "bd", "loader"],
    start: () => {
        logger.info("BetterDiscord Plugin Support started");
        BDPluginManager.loadAllPlugins();
    },
    stop: () => {
        logger.info("BetterDiscord Plugin Support stopped");
        BDPluginManager.getAllPlugins().forEach(p => {
            if (p.enabled)
                BDPluginManager.stopPlugin(p.id);
        });
    }
});
// Global debug API
if (typeof window !== "undefined") {
    window.TestcordBD = {
        loadPlugin: (name, code) => BDPluginManager.loadPlugin(name, code),
        startPlugin: (id) => BDPluginManager.startPlugin(id),
        stopPlugin: (id) => BDPluginManager.stopPlugin(id),
        togglePlugin: (id) => BDPluginManager.togglePlugin(id),
        getPlugin: (id) => BDPluginManager.getPlugin(id),
        getAllPlugins: () => BDPluginManager.getAllPlugins(),
        reloadAll: () => BDPluginManager.loadAllPlugins(),
        manager: BDPluginManager,
        bundledPlugins
    };
}
