/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Logger } from "@utils/Logger";
import { BDPluginManager } from "./PluginManager";
const logger = new Logger("BDPluginLoader", "#ff7373");
// This function is called by the auto-generated plugin loader
export function registerBDPlugin(pluginCode, fileName) {
    try {
        const plugin = BDPluginManager.loadPlugin(fileName, pluginCode);
        if (plugin) {
            logger.info(`Registered: ${plugin.meta.name}`);
        }
    }
    catch (error) {
        logger.error(`Failed to register plugin ${fileName}:`, error);
    }
}
// Export a function to initialize all BD plugins
export function initializeBDPlugins() {
    logger.info("Initializing BetterDiscord plugins...");
    BDPluginManager.loadAllPlugins();
}
