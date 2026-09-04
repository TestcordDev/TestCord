/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
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

import "./styles.css";

import * as DataStore from "@api/DataStore";
import { PluginHealth } from "@api/PluginHealth";
import { isPluginEnabled, stopPlugin } from "@api/PluginManager";
import { useSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { Divider } from "@components/Divider";
import ErrorBoundary from "@components/ErrorBoundary";
import { HeadingTertiary } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { SettingsTab } from "@components/settings";
import { ChangeList } from "@utils/ChangeList";
import { Devs, EquicordDevs, TestcordDevs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { isTruthy } from "@utils/guards";
import { Logger } from "@utils/Logger";
import { Margins } from "@utils/margins";
import { classes } from "@utils/misc";
import { PluginTarget } from "@utils/pluginTargets";
import { useAwaiter, useCleanupEffect, useIntersection } from "@utils/react";
import { PluginTag, PluginTags } from "@utils/types";
import { Alerts, ConfirmModal, openModal, Parser, React, SearchableSelect, Select, TextInput, Toasts, Tooltip, useCallback, useMemo, useRef, useState } from "@webpack/common";
import { JSX } from "react";

import Plugins, { ExcludedPlugins, PluginMeta } from "~plugins";

import { PluginCard } from "./PluginCard";
import { openWarningModal } from "./PluginModal";
import { StockPluginsCard, UserPluginsCard } from "./PluginStatCards";
import { UIElementsButton } from "./UIElements";

export const cl = classNameFactory("vc-plugins-");
export const logger = new Logger("PluginSettings", "#a6d189");

const PluginSearchPrefixes = [
    { prefix: "tcp:", folder: "src/testcordplugins/" },
    { prefix: "testcordplugin:", folder: "src/testcordplugins/" },
    { prefix: "vcp:", folder: "src/plugins/" },
    { prefix: "vencordplugin:", folder: "src/plugins/" },
    { prefix: "eqp:", folder: "src/equicordplugins/" },
    { prefix: "equicordplugin:", folder: "src/equicordplugins/" }
];
const PluginLoadBatchSize = 36;

function showErrorToast(message: string) {
    Toasts.show({
        message,
        type: Toasts.Type.FAILURE,
        id: Toasts.genId(),
        options: {
            position: Toasts.Position.BOTTOM
        }
    });
}

function ReloadRequiredCard({ required, enabledPlugins, openWarningModal, resetCheckAndDo }) {
    return (
        <Card className={classes(cl("info-card"), required && "vc-warning-card")}>
            <div className={cl("info-card-content")}>
                {required ? (
                    <>
                        <HeadingTertiary>Restart required</HeadingTertiary>
                        <Paragraph className={cl("dep-text")}>
                            Restart now to apply plugin and setting changes.
                        </Paragraph>
                    </>
                ) : (
                    <>
                        <HeadingTertiary>Plugin Management</HeadingTertiary>
                        <Paragraph>Search, filter, enable, and configure plugins from one place.</Paragraph>
                        <Paragraph>Use the info button to view details, or the cog button to edit settings.</Paragraph>
                    </>
                )}
            </div>
            <div className={cl("info-card-actions")}>
                {required ? (
                    <Button variant="primary" className={cl("restart-button")} onClick={() => location.reload()}>
                        Restart
                    </Button>
                ) : enabledPlugins.length > 0 && (
                    <Button
                        variant="secondary"
                        size="small"
                        className={"vc-plugins-disable-warning vc-modal-align-reset"}
                        onClick={() => openWarningModal(null, undefined, false, enabledPlugins.length, resetCheckAndDo)}
                    >
                        Disable All Plugins
                    </Button>
                )}
            </div>
        </Card>
    );
}

const SearchStatus = {
    ALL: 0,
    FAVORITES: 1,
    ENABLED: 2,
    DISABLED: 3,
    EQUICORD: 4,
    TESTCORD: 5,
    VENCORD: 6,
    NEW: 7,
    USER_PLUGINS: 8,
    API_PLUGINS: 9,
    BETTERDISCORD: 10,
} as const;

type SearchStatus = typeof SearchStatus[keyof typeof SearchStatus];

export const ExcludedReasons: Record<PluginTarget, string> = {
    desktop: "Discord Desktop app or Vesktop/Equibop",
    discordDesktop: "Discord Desktop app",
    vesktop: "Vesktop/Equibop apps",
    equibop: "Vesktop/Equibop apps",
    web: "Vesktop/Equibop apps & Discord web",
    dev: "Developer version of Equicord",
    browser: "Web Browser version of Equicord"
};

function ExcludedPluginsList({ search }: { search: string; }) {
    const matchingExcludedPlugins = search
        ? Object.entries(ExcludedPlugins)
            .filter(([name]) => name.toLowerCase().includes(search))
        : [];

    return (
        <Paragraph className={Margins.top16}>
            {matchingExcludedPlugins.length
                ? <>
                    <Paragraph>Are you looking for:</Paragraph>
                    <ul>
                        {matchingExcludedPlugins.map(([name, reason]) => (
                            <li key={name}>
                                <b>{name}</b>: Only available on the {ExcludedReasons[reason]}
                            </li>
                        ))}
                    </ul>
                </>
                : "No plugins meet the search criteria."
            }
        </Paragraph>
    );
}

export default function PluginSettings() {
    const settings = useSettings();
    const changeRef = useRef<ChangeList<string>>(null);
    const changes = changeRef.current ??= new ChangeList<string>();

    useCleanupEffect(() => {
        return () => {
            if (!changes.hasChanges) return;

            const allChanges = [...changes.getChanges()];
            const pluginNames = [...new Set(allChanges.map(s => s.split(":")[0]))];
            const maxDisplay = 15;
            const displayed = pluginNames.slice(0, maxDisplay);
            const remainingCount = pluginNames.length - displayed.length;

            openModal(props => (
                <ConfirmModal
                    {...props}
                    title="Restart required"
                    confirmText="Restart now"
                    cancelText="Later!"
                    variant="primary"
                    onConfirm={() => location.reload()}
                >
                    <>
                        <p>The following plugins require a restart:</p>
                        <div>
                            {displayed.map((s, i) => (
                                <React.Fragment key={i}>
                                    {i > 0 && ", "}
                                    {Parser.parse("`" + s + "`")}
                                </React.Fragment>
                            ))}
                            {remainingCount > 0 && <span> and {remainingCount} more</span>}
                        </div>
                    </>
                </ConfirmModal>
            ));
        };
    }, []);

    const depMap = useMemo(() => {
        const o = {} as Record<string, string[]>;
        for (const plugin in Plugins) {
            const deps = Plugins[plugin].dependencies;
            if (deps) {
                for (const dep of deps) {
                    o[dep] ??= [];
                    o[dep].push(plugin);
                }
            }
        }
        return o;
    }, []);

const sortedPlugins = useMemo(() =>
    Object.values(Plugins)
        .filter(p => p.name)
        .sort((a, b) => a.name.localeCompare(b.name))
        .toSorted((a, b) => Number(settings.plugins[b.name]?.isFavorite ?? false) - Number(settings.plugins[a.name]?.isFavorite ?? false)),
    []
);

    const hasUserPlugins = useMemo(() => !IS_STANDALONE && Object.values(PluginMeta).some(m => m.userPlugin), []);

    const [searchValue, setSearchValue] = useState<{ value: string; tags: PluginTag[]; status: number; author: string; }>({ value: "", tags: [] as PluginTag[], status: SearchStatus.ALL, author: "" });

    const search = searchValue.value.toLowerCase();
    const searchPrefixMatch = useMemo(() => {
        const trimmedSearch = search.trimStart();

        for (const entry of PluginSearchPrefixes) {
            if (trimmedSearch.startsWith(entry.prefix)) {
                return {
                    folder: entry.folder,
                    query: trimmedSearch.slice(entry.prefix.length).trim()
                };
            }
        }

        return null;
    }, [search]);
    const onSearch = (query: string) => setSearchValue(prev => ({ ...prev, value: query }));

    const githubMap = useMemo(() => {
        const map: Record<string, string> = {};
        const allDevs = { ...TestcordDevs, ...EquicordDevs, ...Devs };
        for (const dev of Object.values(allDevs)) {
            if ((dev as any).github) map[(dev as any).name] = (dev as any).github;
        }
        return map;
    }, []);
    const authorOptions = useMemo(() => {
        const authors = new Map<string, { category: string; github: any; }>();
        for (const plugin of sortedPlugins) {
            const meta = PluginMeta[plugin.name];
            const folder = meta ? meta.folderName : "";
            const category = folder.startsWith("src/testcordplugins/") ? "Testcord" : folder.startsWith("src/equicordplugins/") ? "Equicord" : folder.startsWith("src/plugins/") ? "Vencord" : "Other";
            for (const author of (plugin.authors || [])) {
                if (!author || !author.name) continue;
                if (!authors.has(author.name)) authors.set(author.name, { category, github: (author as any).github });
            }
        }
        const grouped: Record<string, string[]> = { Testcord: [], Equicord: [], Vencord: [], Other: [] };
        for (const [name, info] of authors.entries()) grouped[info.category].push(name);
        const result: Array<{ label: string; value: string; github: string; }> = [];
        for (const [cat, names] of Object.entries(grouped)) {
            for (const name of names.sort()) { const info = authors.get(name)!; result.push({ label: name + " (" + cat + ")", value: name, github: info.github || githubMap[name] }); }
        }
        return result;
    }, [sortedPlugins]);

    const pluginFilter = useCallback((plugin: typeof Plugins[keyof typeof Plugins], newPluginsSet: Set<string> | null) => {
        const { status, tags } = searchValue;

        switch (status) {
            case SearchStatus.FAVORITES:
                if (!settings.plugins[plugin.name]?.isFavorite) return false;
                break;
            case SearchStatus.DISABLED:
                if (isPluginEnabled(plugin.name)) return false;
                break;
            case SearchStatus.ENABLED:
                if (!isPluginEnabled(plugin.name)) return false;
                break;
            case SearchStatus.EQUICORD:
                if (!PluginMeta[plugin.name].folderName.startsWith("src/equicordplugins/")) return false;
                break;
            case SearchStatus.TESTCORD:
                if (!PluginMeta[plugin.name].folderName.startsWith("src/testcordplugins/")) return false;
                break;
            case SearchStatus.VENCORD:
                if (!PluginMeta[plugin.name].folderName.startsWith("src/plugins/")) return false;
                break;
            case SearchStatus.NEW:
                if (!newPluginsSet?.has(plugin.name)) return false;
                break;
            case SearchStatus.USER_PLUGINS:
                if (!PluginMeta[plugin.name]?.userPlugin) return false;
                break;
            case SearchStatus.API_PLUGINS:
                if (!plugin.name.endsWith("API")) return false;
                break;
            case SearchStatus.BETTERDISCORD:
                // Check if plugin is a BD plugin by looking at folderName or tags
                const pluginMetaInfo = PluginMeta[plugin.name];
                if (!pluginMetaInfo) return false;
                return pluginMetaInfo.folderName?.startsWith("src/Betterdiscordplugins/") ||
                    plugin.tags?.includes("betterdiscord");
        }

        if (tags.length && tags.some(t => !plugin.tags?.includes(t))) return false;

        if (searchValue.author && !plugin.authors?.some(a => a?.name === searchValue.author)) return false;

        if (searchPrefixMatch) {
            const folder = PluginMeta[plugin.name]?.folderName || "";
            if (!folder.startsWith(searchPrefixMatch.folder)) return false;
        }

        const pluginSearchValue = searchPrefixMatch ? searchPrefixMatch.query : search;

        if (!pluginSearchValue.length) return true;

        return (
            plugin.name.toLowerCase().includes(pluginSearchValue.replace(/\s+/g, "")) ||
            plugin.name.match(/[A-Z]/g)?.join("").toLowerCase().includes(pluginSearchValue) || // acronyms like BF for BetterFolders
            plugin.description.toLowerCase().includes(pluginSearchValue) ||
            plugin.searchTerms?.some(t => t.toLowerCase().includes(pluginSearchValue))
        );
    }, [searchValue, search, searchPrefixMatch]);

    const [newPluginsSet] = useAwaiter(() => DataStore.get("Vencord_existingPlugins").then((cachedPlugins: Record<string, number> | undefined) => {
        const now = Date.now() / 1000;
        const existingTimestamps: Record<string, number> = {};

        // Genuine first run: no baseline exists, so nothing is "new" yet.
        // Establish the baseline and return null instead of marking everything new.
        if (!cachedPlugins) {
            for (const { name: p } of sortedPlugins) existingTimestamps[p] = now;
            DataStore.set("Vencord_existingPlugins", existingTimestamps);
            return null;
        }

        const newPlugins: string[] = [];
        for (const { name: p } of sortedPlugins) {
            const cached = cachedPlugins[p];
            if (cached == null) {
                // Plugin was added since the previous launch
                existingTimestamps[p] = now;
                newPlugins.push(p);
            } else {
                existingTimestamps[p] = cached;
            }
        }
        DataStore.set("Vencord_existingPlugins", existingTimestamps);

        return newPlugins.length ? new Set(newPlugins) : null;
    }));

    const handleRestartNeeded = useCallback((name: string, key: string) => changes.handleChange(`${name}:${key}`), [changes]);

    const { plugins, requiredPlugins } = useMemo(() => {
        const plugins = [] as JSX.Element[];
        const requiredPlugins = [] as JSX.Element[];

        const showApi = searchValue.status === SearchStatus.API_PLUGINS;
        for (const p of sortedPlugins) {
            if (p.hidden || (!p.settings?.def && p.name.endsWith("API") && !showApi))
                continue;

            if (!pluginFilter(p, newPluginsSet)) continue;

            const isRequired = p.required || p.isDependency || depMap[p.name]?.some(d => settings.plugins[d].enabled);

            if (isRequired) {
                const tooltipText = p.required || !depMap[p.name]
                    ? "This plugin is required for Testcord to function."
                    : <PluginDependencyList deps={depMap[p.name]?.filter(d => settings.plugins[d].enabled)} />;

                requiredPlugins.push(
                    <Tooltip text={tooltipText} key={p.name}>
                        {({ onMouseLeave, onMouseEnter }) => (
                            <PluginCard
                                onMouseLeave={onMouseLeave}
                                onMouseEnter={onMouseEnter}
                                onRestartNeeded={handleRestartNeeded}
                                disabled={true}
                                plugin={p}
                            />
                        )}
                    </Tooltip>
                );
            } else {
                plugins.push(
                    <PluginCard
                        onRestartNeeded={handleRestartNeeded}
                        disabled={false}
                        plugin={p}
                        isNew={newPluginsSet?.has(p.name)}
                        key={p.name}
                    />
                );
            }
        }
        return { plugins, requiredPlugins };
    }, [sortedPlugins, searchValue, newPluginsSet, depMap, settings.plugins, pluginFilter, handleRestartNeeded]);

    function resetCheckAndDo() {
        let restartNeeded = false;

        for (const plugin of enabledPlugins) {
            const pluginSettings = settings.plugins[plugin];

            if (Plugins[plugin].patches?.length) {
                pluginSettings.enabled = false;
                void PluginHealth.recordPluginChange(plugin, false);
                changes.handleChange(plugin);
                restartNeeded = true;
                continue;
            }

            const result = stopPlugin(Plugins[plugin]);

            if (!result) {
                logger.error(`Error while stopping plugin ${plugin}`);
                showErrorToast(`Error while stopping plugin ${plugin}`);
                continue;
            }

            pluginSettings.enabled = false;
            void PluginHealth.recordPluginChange(plugin, false);
        }

        if (restartNeeded) {
            Alerts.show({
                title: "Restart Required",
                body: (
                    <>
                        <p style={{ textAlign: "center" }}>Some plugins require a restart to fully disable.</p>
                        <p style={{ textAlign: "center" }}>Would you like to restart now?</p>
                    </>
                ),
                confirmText: "Restart Now",
                cancelText: "Later",
                onConfirm: () => location.reload()
            });
        }
    }

    // Code directly taken from supportHelper.tsx
    const { totalStockPlugins, totalUserPlugins, enabledStockPlugins, enabledUserPlugins, enabledPlugins } = useMemo(() => {
        const isApiPlugin = (plugin: string) => plugin.endsWith("API") || Plugins[plugin].required;

        const totalPlugins = Object.keys(Plugins).filter(p => !isApiPlugin(p));
        const enabledPlugins = Object.keys(Plugins).filter(p => isPluginEnabled(p) && !isApiPlugin(p));

        const totalStockPlugins = totalPlugins.filter(p => !PluginMeta[p].userPlugin && !Plugins[p].hidden).length;
        const totalUserPlugins = totalPlugins.filter(p => PluginMeta[p].userPlugin).length;
        const enabledStockPlugins = enabledPlugins.filter(p => !PluginMeta[p].userPlugin).length;
        const enabledUserPlugins = enabledPlugins.filter(p => PluginMeta[p].userPlugin).length;
        return { totalStockPlugins, totalUserPlugins, enabledStockPlugins, enabledUserPlugins, enabledPlugins };
    }, [settings.plugins]);
    const pluginsToLoad = Math.min(PluginLoadBatchSize, plugins.length);
    const [visibleCount, setVisibleCount] = React.useState(pluginsToLoad);
    const loadMore = React.useCallback(() => {
        setVisibleCount(v => Math.min(v + pluginsToLoad, plugins.length));
    }, [plugins.length]);

    const [sentinelRef, isSentinelVisible] = useIntersection();
    React.useEffect(() => {
        if (isSentinelVisible && visibleCount < plugins.length) {
            loadMore();
        }
    }, [isSentinelVisible, visibleCount, plugins.length, loadMore]);

    const visiblePlugins = plugins.slice(0, visibleCount);
    const rawAuthorGithub = searchValue.author ? (authorOptions.find(a => a.value === searchValue.author)?.github || searchValue.author) : "";
    const authorGithub = rawAuthorGithub ? (rawAuthorGithub.startsWith("http") ? rawAuthorGithub : "https://github.com/" + rawAuthorGithub) : "";

    return (
        <SettingsTab>
            <ReloadRequiredCard required={changes.hasChanges} enabledPlugins={enabledPlugins} openWarningModal={openWarningModal} resetCheckAndDo={resetCheckAndDo} />

            <div className={cl("stats-container")}>
                <StockPluginsCard
                    totalStockPlugins={totalStockPlugins}
                    enabledStockPlugins={enabledStockPlugins}
                />
                <UserPluginsCard
                    totalUserPlugins={totalUserPlugins}
                    enabledUserPlugins={enabledUserPlugins}
                />
            </div>

            <div className={cl("ui-elements")}>
                <UIElementsButton />
            </div>

            <HeadingTertiary className={classes(Margins.top20, Margins.bottom8)}>
                Filters
            </HeadingTertiary>

            <ErrorBoundary noop>
                <TextInput
                    inputClassName={cl("filter-control")}
                    placeholder="Search for a plugin..."
                    value={searchValue.value}
                    onChange={onSearch}
                    autoFocus
                />
            </ErrorBoundary>

            <ErrorBoundary noop>
                <div className={classes(Margins.bottom8, Margins.top8, cl("filter-controls"))}>
                    <Select
                        options={[
                            { label: "Show All", value: SearchStatus.ALL, default: true },
                            { label: "Show Favorites", value: SearchStatus.FAVORITES },
                            { label: "Show Enabled", value: SearchStatus.ENABLED },
                            { label: "Show Disabled", value: SearchStatus.DISABLED },
                            { label: "Show Equicord", value: SearchStatus.EQUICORD },
                            { label: "Show Testcord", value: SearchStatus.TESTCORD },
                            { label: "Show Vencord", value: SearchStatus.VENCORD },
                            { label: "Show New", value: SearchStatus.NEW },
                            hasUserPlugins && { label: "Show UserPlugins", value: SearchStatus.USER_PLUGINS },
                            { label: "Show API Plugins", value: SearchStatus.API_PLUGINS },
                            { label: "Show BetterDiscord", value: SearchStatus.BETTERDISCORD },
                        ].filter(isTruthy)}
                        serialize={String}
                        select={status => setSearchValue(prev => ({ ...prev, status }))}
                        isSelected={v => v === searchValue.status}
                        closeOnSelect={true}
                        placeholder="Filter by Type"
                    />
                    <SearchableSelect
                        options={PluginTags.map(tag => ({ label: tag, value: tag }))}
                        value={searchValue.tags}
                        onChange={tags => setSearchValue(prev => ({ ...prev, tags }))}
                        closeOnSelect={false}
                        placeholder="Filter by Tags"
                        multi
                    />
                    <SearchableSelect
                        options={[{ label: "All Authors", value: "" }, ...authorOptions]}
                        value={searchValue.author}
                        onChange={v => setSearchValue(prev => ({ ...prev, author: v ?? "" }))}
                        closeOnSelect={true}
                        placeholder="Filter by Author"
                    />
                    {searchValue.author && (
                        <a
                            href={authorGithub}
                            target="_blank"
                            rel="noreferrer"
                            style={{ display: "flex", alignItems: "center", gap: "4px", color: "var(--text-link)", fontSize: "14px", textDecoration: "none", whiteSpace: "nowrap" }}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
                            {(authorOptions.find(a => a.value === searchValue.author)?.github || searchValue.author).replace(/^https?:\/\/github\.com\//, "")}
                        </a>
                    )}
                </div>
            </ErrorBoundary>

            <HeadingTertiary className={classes(Margins.top20, Margins.bottom8, cl("section-heading"))}>Plugins</HeadingTertiary>

            {plugins.length || requiredPlugins.length
                ? (
                    <>
                        <div className={cl("grid")}>
                            {visiblePlugins.length
                                ? visiblePlugins
                                : <Paragraph>No plugins meet the search criteria.</Paragraph>
                            }
                        </div>
                        {visibleCount < plugins.length && (
                            <div ref={sentinelRef} style={{ height: 32 }} />
                        )}
                    </>
                )
                : <ExcludedPluginsList search={search} />
            }

            <Divider className={Margins.top20} />

            <HeadingTertiary className={classes(Margins.top20, Margins.bottom8)}>
                Required Plugins
            </HeadingTertiary>

            <div className={cl("grid")}>
                {requiredPlugins.length
                    ? requiredPlugins
                    : <Paragraph>No plugins meet the search criteria.</Paragraph>
                }
            </div>
        </SettingsTab >
    );
}

export function PluginDependencyList({ deps }: { deps: string[]; }) {
    return (
        <>
            <Paragraph>This plugin is required by:</Paragraph>
            {deps.map((dep: string) => <Paragraph key={dep} className={cl("dep-text")}>{dep}</Paragraph>)}
        </>
    );
}
