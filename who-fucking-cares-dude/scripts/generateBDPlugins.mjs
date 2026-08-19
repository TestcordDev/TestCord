#!/usr/bin/env node
/*
 * BetterDiscord Plugin Loader for Testcord
 * Generates actual plugin wrapper files that get loaded like normal plugins
 */
import { readdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
const BD_PLUGINS_DIR = join(process.cwd(), "src", "Betterdiscordplugins");
const GENERATED_DIR = join(BD_PLUGINS_DIR, "generated");
async function loadBDPlugins() {
    if (!existsSync(BD_PLUGINS_DIR)) {
        console.log("BetterDiscord plugins directory does not exist");
        return;
    }
    // Create generated directory
    const fs = await import("fs");
    if (!fs.existsSync(GENERATED_DIR)) {
        fs.mkdirSync(GENERATED_DIR, { recursive: true });
    }
    // Clear old generated files
    const oldFiles = fs.readdirSync(GENERATED_DIR);
    for (const file of oldFiles) {
        if (file.endsWith(".tsx")) {
            fs.unlinkSync(join(GENERATED_DIR, file));
        }
    }
    const files = await readdir(BD_PLUGINS_DIR);
    const pluginFiles = files.filter(f => f.endsWith(".plugin.js"));
    // List of broken BD plugins that can't be loaded - skip them entirely
    const brokenPlugins = [
        "BetterFormattingRedux.plugin.js",
        "EmbedMoreImages.plugin.js",
        "SimpleAnimations.plugin.js",
        "UncompressedImages.plugin.js"
    ];
    for (const file of pluginFiles) {
        // Skip broken plugins
        if (brokenPlugins.includes(file)) {
            console.log(`Skipping broken BD plugin: ${file}`);
            continue;
        }
        try {
            const filePath = join(BD_PLUGINS_DIR, file);
            const content = await readFile(filePath, "utf-8");
            // Extract plugin metadata
            const nameMatch = content.match(/@(?:name|Name)\s+([^\n\r*]+)/);
            const authorMatch = content.match(/@(?:author|Author)\s+([^\n\r*]+)/);
            const versionMatch = content.match(/@(?:version|Version)\s+([^\n\r*]+)/);
            const descMatch = content.match(/@(?:description|Description)\s+(.+)/);
            const pluginName = nameMatch ? nameMatch[1].trim() : file.replace(/\.plugin\.js$/i, "");
            const author = authorMatch ? authorMatch[1].trim() : "Unknown";
            const version = versionMatch ? versionMatch[1].trim() : "1.0.0";
            const description = descMatch ? descMatch[1].trim().split("\n")[0] : "A BetterDiscord plugin";
            const safeName = pluginName.replace(/\s+/g, "_");
            // Escape the plugin code for embedding
            const escapedCode = content
                .replace(/\\/g, "\\\\")
                .replace(/`/g, "\\`")
                .replace(/\$\{/g, "\\${");
            // Generate wrapper file
            const wrapper = `/*
 * Auto-generated BetterDiscord Plugin Wrapper
 * DO NOT EDIT - This file is auto-generated from ${file}
 */

import definePlugin from "@utils/types";
import { Logger } from "@utils/Logger";
import { Settings } from "@api/Settings";
import { BDPluginManager } from "../PluginManager";

const logger = new Logger("BD:${safeName}", "#ff7373");

// Store the plugin code
const pluginCode = \`${escapedCode}\`;

// Load the plugin immediately
BDPluginManager.loadPlugin("${file}", pluginCode);

export default definePlugin({
    name: "${pluginName}",
    description: "[BD] ${description}",
    authors: [{ name: "${author}", id: 0n }],
    version: "${version}",
    tags: ["betterdiscord", "bd", "external"],
    
    start() {
        logger.info("Starting");
        if (!Settings.plugins["${safeName}"]) {
            Settings.plugins["${safeName}"] = { enabled: true };
        }
        BDPluginManager.startPlugin("${safeName}");
    },
    
    stop() {
        logger.info("Stopping");
        BDPluginManager.stopPlugin("${safeName}");
    }
});
`;
            const outputPath = join(GENERATED_DIR, `${safeName}.tsx`);
            await writeFile(outputPath, wrapper);
            console.log(`Generated: ${safeName}.tsx`);
        }
        catch (error) {
            console.error(`Failed to generate wrapper for ${file}:`, error);
        }
    }
    console.log(`\nGenerated ${pluginFiles.length - brokenPlugins.length} BD plugin wrapper(s) (${brokenPlugins.length} skipped)`);
}
loadBDPlugins().catch(console.error);
