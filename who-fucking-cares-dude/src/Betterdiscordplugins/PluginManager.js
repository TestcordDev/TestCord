/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Settings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import { createBdApi } from "./BdApi";
const logger = new Logger("BDPluginManager", "#ff7373");
// Strip BOM from file content
function stripBOM(content) {
    if (content.charCodeAt(0) === 0xFEFF) {
        return content.slice(1);
    }
    return content;
}
// Normalize exports for BD plugins
function normalizeExports(pluginName) {
    return `
if (module.exports.default) {
    module.exports = module.exports.default;
}
if (typeof module.exports !== "function" && typeof module.exports !== "object") {
    try {
        module.exports = eval(${JSON.stringify(pluginName)});
    } catch(e) {
        // Plugin might not export anything substantial
    }
}`;
}
// Parse BetterDiscord plugin metadata from comment block (Enhanced)
export function parsePluginMeta(content, fileName) {
    const meta = {
        name: fileName.replace(/\.plugin\.js$/i, ""),
        author: "Unknown",
        version: "1.0.0",
        description: "No description provided"
    };
    // Try to find the JSDoc comment block first
    const jsdocMatch = content.match(/\/\*\*([\s\S]*?)\*\//);
    if (jsdocMatch) {
        const block = jsdocMatch[1];
        const splitRegex = /[^\S\r\n]*?\r?(?:\r\n|\n)[^\S\r\n]*?\*[^\S\r\n]?/;
        const escapedAtRegex = /^\\@/;
        const out = {};
        let field = "";
        let accum = "";
        for (const line of block.split(splitRegex)) {
            if (line.length === 0)
                continue;
            if (line.startsWith("@") && !line.startsWith("@ ")) {
                if (out[field]) {
                    if (!Array.isArray(out[field]))
                        out[field] = [out[field]];
                    out[field].push(accum.trim());
                }
                else {
                    out[field] = accum.trim();
                }
                const l = line.indexOf(" ");
                field = line.substring(1, l);
                accum = line.substring(l + 1);
            }
            else {
                accum += " " + line.replace(/\\n/g, "\n").replace(escapedAtRegex, "@");
            }
        }
        // Save the last accumulated field
        if (out[field]) {
            if (!Array.isArray(out[field]))
                out[field] = [out[field]];
            out[field].push(accum.trim());
        }
        else {
            out[field] = accum.trim();
        }
        delete out[""];
        // Map to meta
        if (out.name)
            meta.name = Array.isArray(out.name) ? out.name[0] : out.name;
        if (out.version)
            meta.version = Array.isArray(out.version) ? out.version[0] : out.version;
        if (out.description)
            meta.description = Array.isArray(out.description) ? out.description[0] : out.description;
        if (out.author)
            meta.author = Array.isArray(out.author) ? out.author : out.author;
        if (out.authorId)
            meta.authorId = Array.isArray(out.authorId) ? out.authorId : out.authorId;
        if (out.source)
            meta.source = Array.isArray(out.source) ? out.source[0] : out.source;
        if (out.website)
            meta.website = Array.isArray(out.website) ? out.website[0] : out.website;
        if (out.invite)
            meta.invite = Array.isArray(out.invite) ? out.invite[0] : out.invite;
        if (out.authorLink)
            meta.authorLink = Array.isArray(out.authorLink) ? out.authorLink[0] : out.authorLink;
        if (out.updateUrl)
            meta.updateUrl = Array.isArray(out.updateUrl) ? out.updateUrl[0] : out.updateUrl;
        if (out.donationUrl)
            meta.donationUrl = Array.isArray(out.donationUrl) ? out.donationUrl[0] : out.donationUrl;
        if (out.patreon)
            meta.patreon = Array.isArray(out.patreon) ? out.patreon[0] : out.patreon;
    }
    // Also try // style comments for legacy plugins
    if (!meta.name || meta.name === fileName.replace(/\.plugin\.js$/i, "")) {
        const nameMatch = content.match(/\/\/\s*@name\s+(.+)/i);
        if (nameMatch)
            meta.name = nameMatch[1].trim();
        const authorMatch = content.match(/\/\/\s*@author\s+(.+)/i);
        if (authorMatch)
            meta.author = authorMatch[1].trim();
        const versionMatch = content.match(/\/\/\s*@version\s+(.+)/i);
        if (versionMatch)
            meta.version = versionMatch[1].trim();
        const descMatch = content.match(/\/\/\s*@description\s+(.+)/i);
        if (descMatch)
            meta.description = descMatch[1].trim();
    }
    // Try legacy META format: //META{"name":"PluginName","version":"1.0.0"}*//
    if (!meta.name || meta.name === fileName.replace(/\.plugin\.js$/i, "")) {
        const metaMatch = content.match(/\/\/META\{(.+?)\}\*\//);
        if (metaMatch) {
            try {
                const parsed = JSON.parse(`{${metaMatch[1]}}`);
                if (parsed.name)
                    meta.name = parsed.name;
                if (parsed.version)
                    meta.version = parsed.version;
                if (parsed.description)
                    meta.description = parsed.description;
                if (parsed.author)
                    meta.author = parsed.author;
            }
            catch (e) {
                logger.warn("Failed to parse legacy META format");
            }
        }
    }
    return meta;
}
// Wrap plugin code with proper scope and globals
function wrapPluginCode(sourceCode, fileName, pluginName) {
    sourceCode = stripBOM(sourceCode);
    const scopeVars = [
        "const exports = module.exports;",
        "const global = window;",
        "const process = { env: {}, platform: 'browser' };",
        "const __filename = '" + fileName.replace(/'/g, "\\'") + "';",
        "const __dirname = '';",
        "const DiscordNative = window.DiscordNative || {};",
        // Clipboard shim
        "if (!DiscordNative.clipboard) {",
        "  Object.defineProperty(DiscordNative, 'clipboard', {",
        "    configurable: true,",
        "    get: () => ({ copy: () => {}, supported: false })",
        "  });",
        "}"
    ].join("\n");
    return scopeVars + "\n" + sourceCode + "\n" + normalizeExports(pluginName) +
        `\n//# sourceURL=betterdiscord://plugins/${fileName}`;
}
// Plugin Manager Class
export class BDPluginManager {
    static plugins = new Map();
    static bdApis = new Map();
    static pluginStates = new Map();
    /**
     * Load a BetterDiscord plugin from source code (Enhanced)
     */
    static loadPlugin(fileName, sourceCode) {
        try {
            const meta = parsePluginMeta(sourceCode, fileName);
            const pluginId = meta.name.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "");
            // Skip loading problematic BD plugins
            const disabledPlugins = ["BetterFormattingRedux", "Embed_More_Images", "SimpleAnimations", "Uncompressed_Images"];
            if (disabledPlugins.includes(pluginId) || disabledPlugins.includes(meta.name)) {
                logger.info(`Skipping loading of broken BD plugin: ${meta.name}`);
                return null;
            }
            // Create BdApi instance for this plugin
            const bdApi = createBdApi(meta.name);
            this.bdApis.set(pluginId, bdApi);
            // Create the plugin module context
            const moduleObj = { exports: {}, filename: fileName };
            let pluginInstance = null;
            // Create wrapped plugin code
            const wrappedCode = wrapPluginCode(sourceCode, fileName, meta.name);
            // Try to execute the plugin code with proper context
            try {
                const pluginFn = new Function("require", "module", "exports", "__filename", "__dirname", "BdApi", "global", "process", "DiscordNative", wrappedCode);
                pluginFn.call({}, 
                // Mock require
                (name) => {
                    if (name === "fs" || name === "path" || name === "electron") {
                        logger.warn(`Plugin ${meta.name} tried to require("${name}") - returning stub`);
                        return {
                            readFile: () => { },
                            writeFile: () => { },
                            readFileSync: () => null,
                            writeFileSync: () => { },
                            existsSync: () => false,
                            join: (...args) => args.join("/"),
                            basename: (p) => p.split(/[/\\]/).pop() || p,
                            dirname: (p) => p.split(/[/\\]/).slice(0, -1).join("/"),
                            ipcRenderer: { invoke: () => Promise.resolve(null), send: () => { } },
                            remote: {}
                        };
                    }
                    if (name === "events") {
                        return {
                            EventEmitter: class {
                                on() { }
                                off() { }
                                emit() { }
                            }
                        };
                    }
                    return {};
                }, moduleObj, moduleObj.exports, fileName, "", bdApi, typeof window !== "undefined" ? window : {}, { env: {}, platform: "browser" }, typeof window.DiscordNative !== "undefined" ? window.DiscordNative : {});
                pluginInstance = moduleObj.exports;
            }
            catch (execError) {
                logger.error(`Failed to execute plugin ${meta.name}:`, execError);
                // Try alternative eval-based loading for self-executing plugins
                try {
                    const evalCode = `(function(module, exports, BdApi) {
                        try {
                            ${sourceCode}
                        } catch(e) {
                            console.error('BD Plugin error:', e);
                        }
                        return module.exports || exports.default;
                    })(moduleObj, moduleObj.exports, bdApi)`;
                    pluginInstance = eval(evalCode);
                }
                catch (e) {
                    logger.error(`Alternative loading also failed for ${meta.name}:`, e);
                }
            }
            // Handle different export patterns
            if (pluginInstance && typeof pluginInstance === "object") {
                // If it's an object with the plugin name as a key, use that
                if (pluginInstance[meta.name]) {
                    pluginInstance = pluginInstance[meta.name];
                }
                else if (pluginInstance.default) {
                    pluginInstance = pluginInstance.default;
                }
            }
            // Create the plugin object
            const plugin = {
                id: pluginId,
                file: fileName,
                meta,
                enabled: false,
                started: false,
                ...(pluginInstance || {}),
                ...moduleObj.exports
            };
            // Add deprecated getter helpers for compatibility
            if (!plugin.getName && plugin.name) {
                plugin.getName = () => plugin.meta.name || plugin.name;
            }
            if (!plugin.getVersion && plugin.version) {
                plugin.getVersion = () => plugin.meta.version || plugin.version;
            }
            if (!plugin.getDescription && plugin.description) {
                plugin.getDescription = () => plugin.meta.description || plugin.description;
            }
            // Store the plugin
            this.plugins.set(pluginId, plugin);
            this.pluginStates.set(pluginId, { enabled: false, started: false });
            window.TestcordBDPlugins = Object.fromEntries(this.plugins);
            logger.info(`Loaded BD plugin: ${meta.name} v${meta.version} by ${meta.author}`);
            // Restore enabled state
            if (this.isPluginEnabled(pluginId)) {
                plugin.enabled = true;
            }
            return plugin;
        }
        catch (error) {
            logger.error(`Failed to load plugin ${fileName}:`, error);
            return null;
        }
    }
    /**
     * Start a loaded plugin (Enhanced with proper lifecycle)
     */
    static startPlugin(pluginId) {
        const plugin = this.plugins.get(pluginId);
        const state = this.pluginStates.get(pluginId);
        if (!plugin) {
            logger.error(`Cannot start plugin ${pluginId}: not found`);
            return false;
        }
        // Don't start if already started
        if (state?.started) {
            logger.debug(`Plugin ${pluginId} is already started`);
            return true;
        }
        try {
            // Call the appropriate start method
            if (typeof plugin.start === "function") {
                plugin.start();
            }
            else if (typeof plugin.onStart === "function") {
                plugin.onStart();
            }
            else if (typeof plugin.load === "function") {
                plugin.load();
            }
            if (state)
                state.started = true;
            plugin.enabled = true;
            this.saveEnabledState(pluginId, true);
            logger.info(`Started BD plugin: ${plugin.meta.name}`);
            return true;
        }
        catch (error) {
            logger.error(`Failed to start plugin ${plugin.meta.name}:`, error);
            return false;
        }
    }
    /**
     * Stop a running plugin (Enhanced with cleanup)
     */
    static stopPlugin(pluginId) {
        const plugin = this.plugins.get(pluginId);
        const state = this.pluginStates.get(pluginId);
        if (!plugin) {
            logger.error(`Cannot stop plugin ${pluginId}: not found`);
            return false;
        }
        // Don't stop if not started
        if (!state?.started && !plugin.enabled) {
            logger.debug(`Plugin ${pluginId} is not started`);
            return true;
        }
        try {
            // Call the appropriate stop method
            if (typeof plugin.stop === "function") {
                plugin.stop();
            }
            else if (typeof plugin.onStop === "function") {
                plugin.onStop();
            }
            else if (typeof plugin.unload === "function") {
                plugin.unload();
            }
            // Clean up patches and styles
            const bdApi = this.bdApis.get(pluginId);
            if (bdApi) {
                bdApi.Patcher.unpatchAll(pluginId);
                bdApi.DOM.removeStyle(pluginId);
            }
            if (state)
                state.started = false;
            plugin.enabled = false;
            this.saveEnabledState(pluginId, false);
            logger.info(`Stopped BD plugin: ${plugin.meta.name}`);
            return true;
        }
        catch (error) {
            logger.error(`Failed to stop plugin ${plugin.meta.name}:`, error);
            return false;
        }
    }
    /**
     * Toggle a plugin's state
     */
    static togglePlugin(pluginId) {
        const plugin = this.plugins.get(pluginId);
        if (!plugin)
            return false;
        if (plugin.enabled) {
            return this.stopPlugin(pluginId);
        }
        else {
            return this.startPlugin(pluginId);
        }
    }
    /**
     * Get a plugin by ID
     */
    static getPlugin(pluginId) {
        return this.plugins.get(pluginId);
    }
    /**
     * Get all loaded plugins
     */
    static getAllPlugins() {
        return Array.from(this.plugins.values());
    }
    /**
     * Check if a plugin is enabled
     */
    static isPluginEnabled(pluginId) {
        // Disable problematic BD plugins by default due to compatibility issues
        const disabledPlugins = ["BetterFormattingRedux", "Embed_More_Images", "SimpleAnimations", "Uncompressed_Images"];
        if (disabledPlugins.includes(pluginId)) {
            return false;
        }
        // First check Settings system, then fall back to localStorage
        if (Settings.plugins[pluginId]) {
            return Settings.plugins[pluginId].enabled ?? false;
        }
        const enabled = localStorage.getItem("Testcord_BDPlugins_enabled");
        if (!enabled)
            return false;
        const enabledList = JSON.parse(enabled);
        return enabledList.includes(pluginId);
    }
    /**
     * Save plugin enabled state
     */
    static saveEnabledState(pluginId, enabled) {
        // First try to use Settings system
        if (Settings.plugins[pluginId]) {
            Settings.plugins[pluginId].enabled = enabled;
            return;
        }
        // Fall back to localStorage
        let enabledList = [];
        const stored = localStorage.getItem("Testcord_BDPlugins_enabled");
        if (stored) {
            enabledList = JSON.parse(stored);
        }
        const index = enabledList.indexOf(pluginId);
        if (enabled && index === -1) {
            enabledList.push(pluginId);
        }
        else if (!enabled && index > -1) {
            enabledList.splice(index, 1);
        }
        localStorage.setItem("Testcord_BDPlugins_enabled", JSON.stringify(enabledList));
    }
    /**
     * Get the BdApi instance for a plugin
     */
    static getBdApi(pluginId) {
        return this.bdApis.get(pluginId);
    }
    /**
     * Unload a plugin completely
     */
    static unloadPlugin(pluginId) {
        const plugin = this.plugins.get(pluginId);
        if (!plugin)
            return;
        // Stop if running
        if (plugin.enabled) {
            this.stopPlugin(pluginId);
        }
        // Remove patches
        const bdApi = this.bdApis.get(pluginId);
        if (bdApi) {
            bdApi.Patcher.unpatchAll(pluginId);
        }
        // Remove from registry
        this.plugins.delete(pluginId);
        this.bdApis.delete(pluginId);
        window.TestcordBDPlugins = Object.fromEntries(this.plugins);
        logger.info(`Unloaded BD plugin: ${plugin.meta.name}`);
    }
    /**
     * Reload a plugin
     */
    static reloadPlugin(pluginId) {
        const plugin = this.plugins.get(pluginId);
        if (!plugin)
            return false;
        const wasEnabled = plugin.enabled;
        this.unloadPlugin(pluginId);
        // Note: This would need the source code to be reloaded
        // For now, just restart if it was enabled
        if (wasEnabled) {
            // Would need to reload from file system
            logger.warn(`Plugin ${pluginId} needs manual reload`);
        }
        return true;
    }
    /**
     * Load all plugins from the Betterdiscordplugins folder
     * This is called by the main plugin system
     */
    static async loadAllPlugins() {
        try {
            logger.info("Loading all BetterDiscord plugins...");
            const plugins = this.getAllPlugins();
            let loadedCount = 0;
            const pending = plugins.filter(p => this.isPluginEnabled(p.id));
            for (let i = 0; i < pending.length; i++) {
                if (this.startPlugin(pending[i].id)) {
                    loadedCount++;
                }
                if (i % 5 === 4) {
                    await new Promise(r => setTimeout(r, 0));
                }
            }
            logger.info(`Loaded ${loadedCount}/${plugins.length} BetterDiscord plugins`);
        }
        catch (error) {
            logger.error("Failed to load BetterDiscord plugins:", error);
        }
    }
    /**
     * Register a plugin that was loaded via the build system
     */
    static registerPlugin(pluginData) {
        if (!pluginData.id) {
            pluginData.id = pluginData.meta?.name?.replace(/\s+/g, "_") || `unknown_${Date.now()}`;
        }
        // Create BdApi instance
        const bdApi = createBdApi(pluginData.meta?.name || pluginData.id);
        this.bdApis.set(pluginData.id, bdApi);
        // Store the plugin
        this.plugins.set(pluginData.id, pluginData);
        window.TestcordBDPlugins = Object.fromEntries(this.plugins);
        logger.info(`Registered BD plugin: ${pluginData.meta?.name || pluginData.id}`);
        // Auto-start if enabled
        if (this.isPluginEnabled(pluginData.id)) {
            this.startPlugin(pluginData.id);
        }
    }
}
// Initialize global plugin registry
if (typeof window !== "undefined") {
    window.TestcordBDPlugins = {};
    window.TestcordBDPluginManager = BDPluginManager;
}
