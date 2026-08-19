/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import "./style.css";
import { addContextMenuPatch, removeContextMenuPatch } from "@api/ContextMenu";
import { DataStore } from "@api/index";
import { definePluginSettings } from "@api/Settings";
import { EquicordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { chooseFile, saveFile } from "@utils/web";
import { Alerts, Button, EmojiStore, GuildStore, IconUtils, Menu, Toasts, useEffect, useState } from "@webpack/common";
const DATA_COLLECTION_NAME = "whitelisted-emojis";
let cache_allowedList = [];
const cacheListeners = new Set();
let writeChain = Promise.resolve();
const getAllowedList = async () => (await DataStore.get(DATA_COLLECTION_NAME)) ?? [];
function notifyCacheChange() {
    for (const listener of cacheListeners)
        listener();
}
function withWriteLock(fn) {
    const next = writeChain.catch(() => undefined).then(fn);
    writeChain = next;
    return next;
}
async function setAllowedList(newList) {
    await DataStore.set(DATA_COLLECTION_NAME, newList);
    cache_allowedList = newList;
    notifyCacheChange();
}
function isItemAllowed(item) {
    if ("uniqueName" in item) {
        return cache_allowedList.some(emoji => emoji.name === item.uniqueName);
    }
    return cache_allowedList.some(emoji => emoji.name === item.name);
}
function itemAlreadyInList(item) {
    return cache_allowedList.some(emoji => emoji.name === item.name);
}
function buildSaveData(item) {
    const saveData = {
        type: "emoji",
        id: item.id,
        name: item.name,
        surrogates: item.surrogates,
    };
    if (!item.surrogates) {
        const emojiData = EmojiStore.getCustomEmojiById(item.id);
        if (emojiData?.guildId) {
            saveData.url = IconUtils.getEmojiURL({ id: emojiData.id, animated: !!emojiData.animated, size: 64 });
            saveData.guildId = emojiData.guildId;
            saveData.animated = emojiData.animated;
        }
    }
    return saveData;
}
function showToast(message, type = Toasts.Type.SUCCESS) {
    if (settings.store.disableToasts)
        return;
    Toasts.show({
        message,
        type,
        id: Toasts.genId(),
        options: { duration: 3000, position: Toasts.Position.BOTTOM }
    });
}
function addBulkToAllowedList(items) {
    return withWriteLock(async () => {
        const validItemsToAdd = items.filter(item => !itemAlreadyInList(item)).map(buildSaveData);
        await setAllowedList([...cache_allowedList, ...validItemsToAdd]);
        showToast(`Added ${validItemsToAdd.length} emojis to the list, ${items.length - validItemsToAdd.length} already in the list`);
    });
}
function removeBulkFromAllowedList(items) {
    return withWriteLock(async () => {
        const itemsToRemove = items.filter(item => itemAlreadyInList(item));
        await setAllowedList(cache_allowedList.filter(emoji => !itemsToRemove.some(item => item.name === emoji.name)));
        showToast(`Removed ${itemsToRemove.length} emojis from the list`);
    });
}
function addToAllowedList(item) {
    return withWriteLock(async () => {
        if (itemAlreadyInList(item)) {
            showToast(`"${item.name}" is already in the list`, Toasts.Type.FAILURE);
            return;
        }
        await setAllowedList([...cache_allowedList, buildSaveData(item)]);
        showToast(`Added "${item.name}" to the list`);
    });
}
function removeFromAllowedList(item) {
    return withWriteLock(async () => {
        if (!itemAlreadyInList(item)) {
            showToast(`"${item.name}" is not in the list`, Toasts.Type.FAILURE);
            return;
        }
        await setAllowedList(cache_allowedList.filter(emoji => emoji.name !== item.name));
        showToast(`Removed "${item.name}" from the list`);
    });
}
const expressionPickerPatch = (children, { target }) => {
    const { dataset } = target;
    if (!dataset)
        return;
    if (dataset.type !== "emoji")
        return;
    const emoji = dataset;
    if ("name" in emoji) {
        children.push(buildMenuItems(emoji));
    }
};
const guildContextPatch = (children, { guild }) => {
    children.push(buildGuildContextPatch(guild));
};
const buildGuildContextPatch = (guild) => {
    return (<Menu.MenuGroup>
            <Menu.MenuItem id="add-white-list-guild-emojis" key="add-white-list-guild-emojis" label="Add All Guild Emojis" action={() => {
            const emojis = EmojiStore.getGuildEmoji(guild.id);
            addBulkToAllowedList(emojis.map(emoji => ({
                type: "emoji",
                id: emoji.id,
                name: emoji.name
            })));
        }}/>
            <Menu.MenuItem id="remove-white-list-guild-emojis" key="remove-white-list-guild-emojis" label="Remove All Guild Emojis" action={() => {
            const emojis = EmojiStore.getGuildEmoji(guild.id);
            removeBulkFromAllowedList(emojis.map(emoji => ({
                type: "emoji",
                id: emoji.id,
                name: emoji.name
            })));
        }}/>
        </Menu.MenuGroup>);
};
function buildMenuItems(emoji) {
    const isInList = itemAlreadyInList(emoji);
    return (<>
            <Menu.MenuSeparator />
            <Menu.MenuItem id="white-list-emoji" key="white-list-emoji" label={isInList ? "Remove from Whitelist" : "Add to Whitelist"} action={() => isInList ? removeFromAllowedList(emoji) : addToAllowedList(emoji)}/>
        </>);
}
function useWhitelistedEmojis() {
    const [, forceUpdate] = useState(0);
    useEffect(() => {
        const listener = () => forceUpdate(v => v + 1);
        cacheListeners.add(listener);
        return () => void cacheListeners.delete(listener);
    }, []);
    return cache_allowedList;
}
const WhiteListedEmojisComponent = () => {
    const whitelistedEmojis = useWhitelistedEmojis();
    const [collapsedGroups, setCollapsedGroups] = useState({});
    const handleRemoveEmoji = (emoji) => removeFromAllowedList(emoji);
    const handleRemoveAllEmojis = (guildId) => {
        const emojisToRemove = whitelistedEmojis.filter(emoji => emoji.guildId === guildId || (guildId === "default" && !emoji.guildId));
        return removeBulkFromAllowedList(emojisToRemove);
    };
    const toggleGroupCollapse = (guildId) => {
        setCollapsedGroups(prev => ({
            ...prev,
            [guildId]: !prev[guildId]
        }));
    };
    const groupedEmojis = whitelistedEmojis.reduce((groups, emoji) => {
        const groupKey = emoji.guildId || "default";
        if (!groups[groupKey]) {
            groups[groupKey] = [];
        }
        groups[groupKey].push(emoji);
        return groups;
    }, {});
    return (<div className="emoji-container">
            {Object.entries(groupedEmojis).map(([guildId, emojis]) => (<div key={guildId} className="guild-section">
                    <div className="guild-header">
                        <h3 className="guild-name" onClick={() => toggleGroupCollapse(guildId)}>
                            {guildId === "default" ? "Default Emojis" : `${GuildStore.getGuild(guildId)?.name || `Guild ${guildId}`} Emojis`}
                        </h3>
                        <Button className="remove-all-button" size="small" look="outlined" color="red" onClick={() => handleRemoveAllEmojis(guildId)}>
                            Remove All
                        </Button>
                    </div>
                    {!collapsedGroups[guildId] && (<div className="guild-emojis">
                            {emojis.map(emoji => (<div key={emoji.id || emoji.name} className="emoji-item">
                                    <span className="emoji-name">{emoji.name}</span>
                                    {emoji.surrogates ? (<span className="emoji-surrogate">{emoji.surrogates}</span>) : (<img className="emoji-image" src={IconUtils.getEmojiURL({ id: emoji.id, animated: !!emoji.animated, size: 64 })} alt={emoji.name}/>)}
                                    <Button className="remove-button" size="small" look="outlined" color="red" onClick={() => handleRemoveEmoji(emoji)}>
                                        Remove
                                    </Button>
                                </div>))}
                        </div>)}
                </div>))}
            {whitelistedEmojis.length === 0 && (<span className="no-emoji-message">No emojis in the whitelist.</span>)}
        </div>);
};
const exportEmojis = async () => {
    const fileName = "whitelisted-emojis.json";
    const emojis = await getAllowedList();
    const json = JSON.stringify({ emojis }, null, 4);
    if (IS_WEB || IS_EQUIBOP || IS_VESKTOP) {
        saveFile(new File([json], fileName, { type: "application/json" }));
    }
    else {
        DiscordNative.fileManager.saveWithDialog(new TextEncoder().encode(json), fileName);
    }
    showToast("Successfully exported emojis");
};
const uploadEmojis = async () => {
    let data;
    if (IS_WEB || IS_EQUIBOP || IS_VESKTOP) {
        const file = await chooseFile("application/json");
        if (!file)
            return;
        data = await file.text();
    }
    else {
        const [file] = await DiscordNative.fileManager.openFiles({
            filters: [
                { name: "Whitelisted Emojis", extensions: ["json"] },
                { name: "all", extensions: ["*"] }
            ]
        });
        if (!file)
            return;
        data = new TextDecoder().decode(file.data);
    }
    await importEmojis(data);
};
const importEmojis = (data) => withWriteLock(async () => {
    try {
        const parsed = JSON.parse(data);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.emojis)) {
            await setAllowedList(parsed.emojis);
            showToast("Successfully imported emojis");
        }
        else {
            showToast("Invalid JSON data", Toasts.Type.FAILURE);
        }
    }
    catch (err) {
        showToast(`Failed to import emojis: ${err}`, Toasts.Type.FAILURE);
    }
});
const resetEmojis = () => withWriteLock(async () => {
    await setAllowedList([]);
    showToast("Reset emojis");
});
const settings = definePluginSettings({
    defaultEmojis: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Hide default Unicode emojis from the autocomplete unless whitelisted.",
        default: true
    },
    serverEmojis: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Hide custom server emojis from the autocomplete unless whitelisted.",
        default: true
    },
    disableToasts: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Don't show toasts when adding or removing emojis.",
        default: false
    },
    whiteListedEmojis: {
        type: 6 /* OptionType.COMPONENT */,
        description: "Whitelisted Emojis",
        component: WhiteListedEmojisComponent
    },
    exportEmojis: {
        type: 6 /* OptionType.COMPONENT */,
        description: "Export Emojis",
        component: () => (<Button onClick={exportEmojis}>Export Emojis</Button>)
    },
    importEmojis: {
        type: 6 /* OptionType.COMPONENT */,
        description: "Import Emojis",
        component: () => (<Button onClick={() => Alerts.show({
                title: "Are you sure?",
                body: "This will overwrite your current whitelist.",
                confirmText: "Import",
                confirmColor: Button.Colors.RED,
                cancelText: "Cancel",
                onConfirm: uploadEmojis
            })}>
                Import Emojis
            </Button>)
    },
    resetEmojis: {
        type: 6 /* OptionType.COMPONENT */,
        description: "Reset Emojis",
        component: () => (<Button onClick={() => Alerts.show({
                title: "Are you sure?",
                body: "This will remove all emojis from your whitelist.",
                confirmText: "Reset",
                confirmColor: Button.Colors.RED,
                cancelText: "Cancel",
                onConfirm: resetEmojis
            })}>
                Reset Emojis
            </Button>)
    }
});
export default definePlugin({
    name: "WhitelistedEmojis",
    description: "Adds the ability to disable all message emojis except for a whitelisted set.",
    tags: ["Chat", "Emotes"],
    authors: [EquicordDevs.creations],
    dependencies: ["ContextMenuAPI"],
    patches: [
        {
            find: "queryEmojiResults({query:",
            replacement: {
                match: /\{emojis:\{unlocked:(\i)\}\}=\i\.\i\.queryEmojiResults\(\{.{0,200}\}\);/,
                replace: "$&$1=$self.filterEmojis($1);"
            }
        }
    ],
    settings: settings,
    async start() {
        cache_allowedList = await getAllowedList();
        notifyCacheChange();
        addContextMenuPatch("expression-picker", expressionPickerPatch);
        addContextMenuPatch("guild-context", guildContextPatch);
    },
    stop() {
        removeContextMenuPatch("expression-picker", expressionPickerPatch);
        removeContextMenuPatch("guild-context", guildContextPatch);
    },
    filterEmojis(emojis) {
        let result = emojis;
        if (settings.store.defaultEmojis) {
            result = result.filter(e => !("uniqueName" in e) || isItemAllowed(e));
        }
        if (settings.store.serverEmojis) {
            result = result.filter(e => "uniqueName" in e || isItemAllowed(e));
        }
        return result;
    }
});
