/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2026 Vendicated and contributors
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
/**
 * Utilities for generating a plain-text debug report suitable for pasting
 * into a GitHub issue.
 *
 * Kept separate from `plugins/_core/supportHelper.tsx` so it can be reused
 * without pulling in Discord-only dependencies (message sending, cloud
 * uploaders, etc).
 */
import { PluginHealth } from "@api/PluginHealth";
import { isPluginEnabled } from "@api/PluginManager";
import { platformName } from "@equicordplugins/equicordHelper/utils";
import { gitHash, gitHashShort, gitRemote } from "@shared/vencordUserAgent";
import { tryOrElse } from "@utils/misc";
import Plugins, { PluginMeta } from "~plugins";
function detectClient() {
    if (IS_DISCORD_DESKTOP) {
        return { name: "Discord Desktop", version: DiscordNative.app.getVersion() };
    }
    if (IS_VESKTOP) {
        return { name: "Vesktop", version: VesktopNative.app.getVersion() };
    }
    if (IS_EQUIBOP) {
        const equibopGitHash = tryOrElse(() => VesktopNative.app.getGitHash?.(), null);
        return {
            name: "Equibop",
            version: VesktopNative.app.getVersion(),
            hash: equibopGitHash ?? undefined
        };
    }
    if ("legcord" in window)
        return { name: "LegCord", version: window.legcord?.version };
    if ("goofcord" in window)
        return { name: "GoofCord", version: window.goofcord?.version };
    return { name: typeof globalThis.unsafeWindow !== "undefined" ? "UserScript" : "Web" };
}
function getEnabledPlugins() {
    const isApiPlugin = (plugin) => plugin.endsWith("API") || Plugins[plugin]?.required;
    const allEnabled = Object.keys(PluginMeta).filter(p => isPluginEnabled(p) && !isApiPlugin(p));
    const stock = allEnabled.filter(p => !PluginMeta[p].userPlugin).sort();
    const user = allEnabled.filter(p => PluginMeta[p].userPlugin).sort();
    return { stock, user };
}
function formatDate(ts) {
    return new Date(ts).toISOString();
}
function formatPluginHealth(pluginName, entry, excludeConflicts = false) {
    const lines = [];
    const patchFailures = excludeConflicts
        ? entry.patchFailures.filter(f => f.kind !== "conflict")
        : entry.patchFailures;
    if (patchFailures.length) {
        lines.push("Patch failures:");
        for (const f of patchFailures) {
            const parts = [`- [${f.kind}] find=${f.find}`];
            if (f.match)
                parts.push(`match=${f.match}`);
            if (f.moduleId)
                parts.push(`module=${f.moduleId}`);
            lines.push(parts.join(" "));
            if (f.error) {
                lines.push("  " + f.error.split("\n").join("\n  "));
            }
            if (f.sourceContext) {
                lines.push("  Source context:");
                lines.push("  " + f.sourceContext.split("\n").join("\n  "));
            }
        }
    }
    if (entry.runtimeErrors.length) {
        if (lines.length)
            lines.push("");
        lines.push("Runtime errors:");
        for (const e of entry.runtimeErrors) {
            lines.push(`- [${e.source}] @ ${formatDate(e.at)}`);
            lines.push("  " + e.error.split("\n").join("\n  "));
        }
    }
    return `### ${pluginName}\n\n\`\`\`\n${lines.join("\n")}\n\`\`\``;
}
/**
 * Produce a markdown-formatted debug report intended for a GitHub issue body.
 */
export function generateGitHubIssueBody(options = {}) {
    const client = detectClient();
    const { stock, user } = getEnabledPlugins();
    const lines = [];
    if (options.pluginName) {
        lines.push(`> Auto-generated report for plugin **${options.pluginName}**.`);
        lines.push("> Please describe what you were doing when the issue occurred.");
        lines.push("");
    }
    if (options.extraNotes) {
        lines.push("## Notes");
        lines.push(options.extraNotes);
        lines.push("");
    }
    lines.push("## Environment");
    lines.push("");
    lines.push(`- **TestCord**: v${VERSION} (${gitHashShort}, https://github.com/${gitRemote}/commit/${gitHash})`);
    lines.push(`- **Build date**: ${new Date(BUILD_TIMESTAMP).toISOString()}`);
    lines.push(`- **Client**: ${client.name}${client.version ? ` v${client.version}` : ""}${client.hash ? ` (${client.hash.slice(0, 7)})` : ""}`);
    lines.push(`- **Platform**: ${platformName()}`);
    try {
        const { RELEASE_CHANNEL } = window.GLOBAL_ENV;
        lines.push(`- **Discord channel**: ${RELEASE_CHANNEL}`);
    }
    catch { /* GLOBAL_ENV may not be there in some environments */ }
    lines.push(`- **Standalone build**: ${IS_STANDALONE ? "yes" : "no"}`);
    lines.push(`- **Web**: ${IS_WEB ? "yes" : "no"}`);
    lines.push("");
    if (options.pluginName) {
        const plugin = Plugins[options.pluginName];
        const meta = PluginMeta[options.pluginName];
        if (plugin) {
            lines.push("## Plugin");
            lines.push("");
            lines.push(`- **Name**: ${plugin.name}`);
            lines.push(`- **Description**: ${plugin.description}`);
            lines.push(`- **Enabled**: ${isPluginEnabled(plugin.name) ? "yes" : "no"}`);
            if (meta?.folderName) {
                lines.push(`- **Source**: https://github.com/${gitRemote}/tree/main/${meta.folderName}`);
            }
            lines.push(`- **Authors**: ${plugin.authors.map(a => a.name).join(", ")}`);
            lines.push("");
        }
        const health = PluginHealth.get(plugin?.name ?? options.pluginName);
        if (health) {
            lines.push("## Recorded issues");
            lines.push("");
            lines.push(formatPluginHealth(options.pluginName, health, options.excludeConflicts));
            lines.push("");
        }
    }
    else {
        const allHealth = PluginHealth.getAll();
        if (allHealth.size) {
            lines.push("## Unhealthy plugins");
            lines.push("");
            for (const [name, entry] of allHealth) {
                lines.push(formatPluginHealth(name, entry, options.excludeConflicts));
                lines.push("");
            }
        }
    }
    lines.push("## Enabled plugins");
    lines.push("");
    lines.push(`- **Stock (${stock.length})**: ${stock.join(", ") || "(none)"}`);
    if (user.length) {
        lines.push(`- **UserPlugins (${user.length})**: ${user.join(", ")}`);
    }
    return lines.join("\n");
}
/**
 * Build a full "new issue" URL for the configured repository.
 *
 * @param title A short title for the issue.
 * @param body  The markdown body to prefill.
 * @param labels Optional labels to apply.
 */
export function buildIssueUrl(title, body, labels = []) {
    const params = new URLSearchParams();
    params.set("title", title);
    params.set("body", body);
    if (labels.length)
        params.set("labels", labels.join(","));
    return `https://github.com/${gitRemote}/issues/new?${params.toString()}`;
}
