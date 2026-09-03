/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { TestCordIcon } from "@components/TestCordLogo";
import { Logger } from "@utils/Logger";
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
    const isBD = folder.startsWith("src/Betterdiscordplugins/") || plugins[pluginName]?.tags?.includes("betterdiscord");

    if (folder.startsWith("src/testcordplugins/")) {
        return {
            provider: "Testcord",
            iconUrl: "https://raw.githubusercontent.com/TestcordDev/TestCord/refs/heads/main/browser/icon.png"
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
        iconUrl: "https://raw.githubusercontent.com/TestcordDev/TestCord/refs/heads/main/browser/icon.png"
    };
}

let CachedPluginRow: any = null;

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

function filterPlugins(query: string): Plugin[] {
    const all = Object.values(plugins).filter(p => p && p.name && !p.name.endsWith("API"));

    if (!query) {
        return all.sort((a, b) => {
            const aMeta = PluginMeta[a.name]?.folderName?.startsWith("src/testcordplugins/") ? 0 : 1;
            const bMeta = PluginMeta[b.name]?.folderName?.startsWith("src/testcordplugins/") ? 0 : 1;
            if (aMeta !== bMeta) return aMeta - bMeta;
            return a.name.localeCompare(b.name);
        }).slice(0, 50);
    }

    const q = query.toLowerCase();
    const scored: Array<{ plugin: Plugin; score: number; }> = [];

    for (const p of all) {
        const nameLower = p.name.toLowerCase();
        const descLower = (p.description || "").toLowerCase();
        const acronym = (p.name.match(/[A-Z]/g)?.join("") || "").toLowerCase();

        if (nameLower === q) {
            scored.push({ plugin: p, score: 100 });
        } else if (nameLower.startsWith(q)) {
            scored.push({ plugin: p, score: 80 });
        } else if (acronym === q) {
            scored.push({ plugin: p, score: 70 });
        } else if (nameLower.includes(q)) {
            scored.push({ plugin: p, score: 60 });
        } else if (acronym.includes(q)) {
            scored.push({ plugin: p, score: 50 });
        } else if (p.searchTerms?.some(t => t.toLowerCase().includes(q))) {
            scored.push({ plugin: p, score: 40 });
        } else if (descLower.includes(q)) {
            scored.push({ plugin: p, score: 30 });
        }
    }

    return scored
        .sort((a, b) => b.score - a.score || a.plugin.name.localeCompare(b.plugin.name))
        .map(r => r.plugin)
        .slice(0, 50);
}

function hookModule(mod: any) {
    if (!mod || mod._tcpAutocompleteHooked) return;
    hookedModule = mod;

    const original = mod.findMatchingAutocompleteType;
    origFindMatching = original;

    Object.defineProperty(mod, "findMatchingAutocompleteType", {
        value: function (args: any) {
            const currentWord = args?.currentWord;
            if (currentWord && /^(?:tcp|testcordplugin):/i.test(currentWord)) {
                const isTcp = currentWord.toLowerCase().startsWith("tcp:");
                const prefix = isTcp ? "tcp:" : "testcordplugin:";
                const query = currentWord.slice(prefix.length);

                return {
                    type: "TESTCORD_PLUGINS",
                    typeInfo: {
                        sentinel: prefix,
                        matches: () => true,
                        queryResults: () => ({
                            results: {
                                plugins: filterPlugins(query)
                            }
                        }),
                        renderResults: ({ results, selectedIndex, onHover, onClick }: any) => {
                            const list: Plugin[] = results?.plugins ?? [];
                            if (list.length === 0) return null;

                            const RowComponent = getPluginRowClass();

                            return [
                                React.createElement(Autocomplete.Title, {
                                    key: "testcord-plugins-title",
                                    title: "TESTCORD PLUGINS"
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
    logger.info("Hooked Discord native autocomplete for tcp:");
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
        logger.info("Unhooked Discord native autocomplete for tcp:");
    }
}
