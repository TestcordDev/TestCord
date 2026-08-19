/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { findGroupChildrenByChildId } from "@api/ContextMenu";
import { definePluginSettings, migratePluginSettings } from "@api/Settings";
import { Flex } from "@components/Flex";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { Menu } from "@webpack/common";
const DefaultEngines = {
    Google: "https://www.google.com/search?q=",
    DuckDuckGo: "https://duckduckgo.com/?q=",
    Brave: "https://search.brave.com/search?q=",
    Bing: "https://www.bing.com/search?q=",
    Yahoo: "https://search.yahoo.com/search?p=",
    Yandex: "https://yandex.com/search/?text=",
    GitHub: "https://github.com/search?q=",
    Reddit: "https://www.reddit.com/search?q=",
    Wikipedia: "https://wikipedia.org/w/index.php?search=",
    Startpage: "https://www.startpage.com/sp/search?query=",
    Kagi: "https://kagi.com/search?q="
};
const settings = definePluginSettings({
    customEngineName: {
        description: "Name of the custom search engine",
        type: 0 /* OptionType.STRING */,
        placeholder: "Google"
    },
    customEngineURL: {
        displayName: "Custom Engine URL",
        description: "The URL of your Engine",
        type: 0 /* OptionType.STRING */,
        placeholder: "https://google.com/search?q="
    },
    replacementEngine: {
        description: "Replace with a specific search engine instead of adding a menu",
        type: 4 /* OptionType.SELECT */,
        options: [
            { label: "Off", value: "off" /* ReplacementEngineValue.OFF */, default: true },
            { label: "Custom Engine", value: "custom" /* ReplacementEngineValue.CUSTOM */ },
            ...Object.keys(DefaultEngines).map(engine => ({ label: engine, value: engine }))
        ]
    }
});
function search(src, engine) {
    open(engine + encodeURIComponent(src.trim()), "_blank");
}
function makeSearchItem(src) {
    const { customEngineName, customEngineURL, replacementEngine } = settings.store;
    const hasCustomEngine = Boolean(customEngineName && customEngineURL);
    const hasValidReplacementEngine = replacementEngine !== "off" /* ReplacementEngineValue.OFF */ && !(replacementEngine === "custom" /* ReplacementEngineValue.CUSTOM */ && !hasCustomEngine);
    const Engines = { ...DefaultEngines };
    if (hasCustomEngine) {
        Engines[customEngineName] = customEngineURL;
    }
    if (hasValidReplacementEngine) {
        const name = replacementEngine === "custom" /* ReplacementEngineValue.CUSTOM */ && hasCustomEngine
            ? customEngineName
            : replacementEngine;
        return (<Menu.MenuItem label={`Search with ${name}`} key="search-custom-engine" id="vc-search-custom-engine" action={() => search(src, Engines[name])}/>);
    }
    return (<Menu.MenuItem label="Search Text" key="search-text" id="vc-search-text">
            {Object.keys(Engines).map(engine => {
            const key = "vc-search-content-" + engine;
            return (<Menu.MenuItem key={key} id={key} label={<Flex gap="0.5em" alignItems="center">
                                <img style={{
                        borderRadius: "50%"
                    }} aria-hidden="true" height={16} width={16} src={`https://icons.duckduckgo.com/ip3/${new URL(Engines[engine]).hostname}.ico`}/>
                                {engine}
                            </Flex>} action={() => search(src, Engines[engine])}/>);
        })}
        </Menu.MenuItem>);
}
const messageContextMenuPatch = (children, _props) => {
    const selection = document.getSelection()?.toString();
    if (!selection)
        return;
    const group = findGroupChildrenByChildId("search-google", children);
    if (group) {
        const idx = group.findIndex(c => c?.props?.id === "search-google");
        if (idx !== -1)
            group[idx] = makeSearchItem(selection);
    }
};
migratePluginSettings("ReplaceGoogleSearch", "Search");
export default definePlugin({
    name: "ReplaceGoogleSearch",
    description: "Replaces the Google search with different Engine(s)",
    tags: ["Utility", "Customisation"],
    authors: [Devs.Moxxie, Devs.Ethan],
    settings,
    contextMenus: {
        "message": messageContextMenuPatch
    }
});
