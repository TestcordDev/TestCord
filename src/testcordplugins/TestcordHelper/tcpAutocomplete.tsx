/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { TestCordIcon } from "@components/TestCordLogo";
import { Logger } from "@utils/Logger";
import { getTestcordModifiedDetails, isTestcordModified, TestcordPluginIconUrl } from "@utils/testcordIcons";
import { Plugin } from "@utils/types";
import { filters, findByProps, findByPropsLazy, findCssClassesLazy, waitFor } from "@webpack";
import { React } from "@webpack/common";

import plugins, { PluginMeta } from "~plugins";

const logger = new Logger("TcpAutocomplete");

const Autocomplete = findByPropsLazy("Generic", "Command", "Title");
const AutocompleteClasses = findCssClassesLazy(
    "autocomplete",
    "autocompleteInner",
    "autocompleteRow",
    "autocompleteRowContent",
    "autocompleteRowContentPrimary",
    "autocompleteRowContentSecondary",
    "autocompleteRowIcon",
    "autocompleteRowHeading",
    "autocompleteRowSubheading",
    "clickable",
    "base"
);

export type ProviderType = "Testcord" | "Equicord" | "Vencord" | "BetterDiscord" | "User";

export interface ProviderInfo {
    provider: ProviderType;
    iconUrl: string;
}

export function getPluginProvider(pluginName: string): ProviderInfo {
    const meta = PluginMeta[pluginName] || { folderName: "", userPlugin: false };
    const folder = meta.folderName || "";
    const plugin = plugins[pluginName];
    const isBD = folder.startsWith("src/Betterdiscordplugins/") || plugin?.tags?.includes("betterdiscord");

    if (isTestcordModified(plugin, folder)) {
        const details = getTestcordModifiedDetails(plugin, folder);
        return {
            provider: "Testcord",
            iconUrl: details.src
        };
    }

    if (folder.startsWith("src/testcordplugins/")) {
        return {
            provider: "Testcord",
            iconUrl: TestcordPluginIconUrl
        };
    }
    if (folder.startsWith("src/equicordplugins/")) {
        return {
            provider: "Equicord",
            iconUrl: "https://equicord.org/assets/favicon.png"
        };
    }
    if (folder.startsWith("src/plugins/")) {
        return {
            provider: "Vencord",
            iconUrl: "https://equicord.org/assets/icons/vencord/icon-light.png"
        };
    }
    if (isBD) {
        return {
            provider: "BetterDiscord",
            iconUrl: "https://camo.githubusercontent.com/fba98dccf4323b86a2e7599a71e6826f62db4e0bb7d5b637fac9d959111ebfcd/68747470733a2f2f626574746572646973636f72642e6170702f7265736f75726365732f6272616e64696e672f6c6f676f5f736f6c69642e706e67"
        };
    }
    if (meta.userPlugin) {
        return {
            provider: "User",
            iconUrl: "https://equicord.org/assets/icons/misc/userplugin.png"
        };
    }
    return {
        provider: "Testcord",
        iconUrl: TestcordPluginIconUrl
    };
}

let CachedPluginRow: any = null;

interface PluginFilterEntry {
    plugin: Plugin;
    lower: string;
    acronym: string;
    searchTerms?: string[];
    description: string;
    folder: string;
}

let filterIndex: PluginFilterEntry[] | null = null;
let filterIndexSize = 0;

function getFilterIndex(): PluginFilterEntry[] {
    // Built once per plugin set, not once per keystroke. Previously every
    // keystroke re-filtered Object.values(plugins) and re-lowercased every
    // name, description and acronym.
    const size = Object.keys(plugins).length;
    if (!filterIndex || filterIndexSize !== size) {
        filterIndexSize = size;
        filterIndex = [];
        for (const plugin of Object.values(plugins)) {
            if (!plugin || !plugin.name || plugin.name.endsWith("API")) continue;
            filterIndex.push({
                plugin,
                lower: plugin.name.toLowerCase(),
                acronym: (plugin.name.match(/[A-Z]/g)?.join("") || "").toLowerCase(),
                searchTerms: plugin.searchTerms,
                description: (plugin.description || "").toLowerCase(),
                folder: PluginMeta[plugin.name]?.folderName || ""
            });
        }
    }
    return filterIndex;
}

function getPluginRowClass(): any {
    if (CachedPluginRow) return CachedPluginRow;

    const BaseRow: any = Autocomplete?.Generic ? Object.getPrototypeOf(Autocomplete.Generic) : React.Component;

    class PluginRow extends BaseRow {
        renderContent() {
            const { plugin, provider, iconUrl } = this.props;

            return (
                <div className={AutocompleteClasses.autocompleteRowContent}>
                    <div
                        className={AutocompleteClasses.autocompleteRowIcon}
                        style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24 }}
                    >
                        {provider === "Testcord" ? (
                            <TestCordIcon size={18} />
                        ) : (
                            <img
                                src={iconUrl}
                                width={18}
                                height={18}
                                style={{ objectFit: "contain", borderRadius: 4 }}
                                alt={provider}
                            />
                        )}
                    </div>
                    <div className={AutocompleteClasses.autocompleteRowContentPrimary}>
                        <div className={AutocompleteClasses.autocompleteRowHeading}>
                            {plugin.name}
                        </div>
                    </div>
                    {plugin.description && (
                        <div className={AutocompleteClasses.autocompleteRowContentSecondary}>
                            {plugin.description}
                        </div>
                    )}
                </div>
            );
        }
    }

    CachedPluginRow = PluginRow;
    return CachedPluginRow;
}

let origFindMatching: ((...args: any[]) => any) | null = null;
let hookedModule: any = null;
let isInitialized = false;

function filterPlugins(query: string, targetCategory?: "Testcord" | "Vencord" | "Equicord" | "All"): Plugin[] {
    const matchesCategory = (folder: string) => {
        if (targetCategory === "Testcord") return folder.startsWith("src/testcordplugins/");
        if (targetCategory === "Vencord") return folder.startsWith("src/plugins/");
        if (targetCategory === "Equicord") return folder.startsWith("src/equicordplugins/");
        if (targetCategory === "All") {
            return (
                folder.startsWith("src/testcordplugins/") ||
                folder.startsWith("src/equicordplugins/") ||
                folder.startsWith("src/plugins/")
            );
        }
        return true;
    };

    const all = getFilterIndex().filter(e => matchesCategory(e.folder));

    if (!query) {
        return all.map(e => e.plugin).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 50);
    }

    const q = query.toLowerCase();
    const scored: Array<{ plugin: Plugin; score: number; }> = [];

    for (const { plugin, lower, acronym, searchTerms, description } of all) {
        if (lower === q) {
            scored.push({ plugin, score: 100 });
        } else if (lower.startsWith(q)) {
            scored.push({ plugin, score: 80 });
        } else if (acronym === q) {
            scored.push({ plugin, score: 70 });
        } else if (lower.includes(q)) {
            scored.push({ plugin, score: 60 });
        } else if (acronym.includes(q)) {
            scored.push({ plugin, score: 50 });
        } else if (searchTerms?.some(t => t.toLowerCase().includes(q))) {
            scored.push({ plugin, score: 40 });
        } else if (description.includes(q)) {
            scored.push({ plugin, score: 30 });
        }
    }

    return scored
        .sort((a, b) => b.score - a.score || a.plugin.name.localeCompare(b.plugin.name))
        .map(r => r.plugin)
        .slice(0, 50);
}

function hookModule(mod: any) {
    if (!isInitialized || !mod || mod._tcpAutocompleteHooked) return;
    hookedModule = mod;

    const original = mod.findMatchingAutocompleteType;
    origFindMatching = original;

    Object.defineProperty(mod, "findMatchingAutocompleteType", {
        value: function (args: any) {
            const currentWord = args?.currentWord;
            const match = currentWord?.match(/^(?:(tcp|testcordplugin)|(vcp|vencordplugin)|(eqp|equicordplugin)|(plg|plugin|plugins)):/i);
            if (match) {
                const rawPrefix = match[0];
                const prefixKeyword = (match[1] || match[2] || match[3] || match[4]).toLowerCase();
                const prefix = `${prefixKeyword}:`;
                const query = currentWord.slice(rawPrefix.length);

                let category: "Testcord" | "Vencord" | "Equicord" | "All" = "Testcord";
                let title = "TESTCORD PLUGINS";
                let type = "TESTCORD_PLUGINS";

                if (match[2]) {
                    category = "Vencord";
                    title = "VENCORD PLUGINS";
                    type = "VENCORD_PLUGINS";
                } else if (match[3]) {
                    category = "Equicord";
                    title = "EQUICORD PLUGINS";
                    type = "EQUICORD_PLUGINS";
                } else if (match[4]) {
                    category = "All";
                    title = "PLUGINS";
                    type = "PLUGINS";
                }

                return {
                    type,
                    typeInfo: {
                        sentinel: rawPrefix,
                        matches: () => true,
                        queryResults: () => ({
                            results: {
                                plugins: filterPlugins(query, category)
                            }
                        }),
                        renderResults: ({ results, selectedIndex, onHover, onClick }: any) => {
                            const list: Plugin[] = results?.plugins ?? [];
                            if (list.length === 0) return null;

                            const RowComponent = getPluginRowClass();

                            return [
                                React.createElement(Autocomplete.Title, {
                                    key: `${category.toLowerCase()}-plugins-title`,
                                    title
                                }),
                                ...list.map((plugin, idx) => {
                                    const { provider, iconUrl } = getPluginProvider(plugin.name);

                                    return React.createElement(RowComponent, {
                                        key: plugin.name,
                                        index: idx,
                                        selected: selectedIndex === idx,
                                        onClick,
                                        onHover,
                                        plugin,
                                        provider,
                                        iconUrl
                                    });
                                })
                            ];
                        },
                        onSelect: ({ results, index, options }: any) => {
                            const list: Plugin[] = results?.plugins ?? [];
                            const chosen = list[index];
                            if (chosen && options?.insertText) {
                                options.insertText(`${prefix}${chosen.name} `);
                            }
                        }
                    },
                    query: query.toLowerCase()
                };
            }

            return original.apply(this, arguments);
        },
        writable: true,
        configurable: true
    });

    mod._tcpAutocompleteHooked = true;
    logger.info("Hooked Discord native autocomplete for tcp:, vcp:, eqp:, plg:");
}

export function initTcpAutocomplete(): void {
    if (isInitialized) return;
    isInitialized = true;

    const mod = findByProps("findMatchingAutocompleteType");
    if (mod) {
        hookModule(mod);
    } else {
        waitFor(filters.byProps("findMatchingAutocompleteType"), hookModule);
    }
}

export function cleanupTcpAutocomplete(): void {
    if (!isInitialized) return;
    isInitialized = false;

    if (hookedModule && origFindMatching) {
        Object.defineProperty(hookedModule, "findMatchingAutocompleteType", {
            value: origFindMatching,
            writable: true,
            configurable: true
        });
        delete hookedModule._tcpAutocompleteHooked;
        origFindMatching = null;
        hookedModule = null;
        logger.info("Unhooked Discord native autocomplete for tcp:, vcp:, eqp:, plg:");
    }
}
