/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import definePlugin, { Plugin } from "@utils/types";
import { FluxDispatcher } from "@webpack/common";

const STORAGE_KEY = "PluginStars_starred";
export const STAR_UPDATED_EVENT = "PLUGIN_STARS_UPDATED";

export default definePlugin({
    name: "PluginStars",
    description: "Star your favourite plugins to pin them to the top of the plugin list.",
    authors: [{ name: "nightwielder23", id: 0n }],
    tags: ["Utility"],
    searchTerms: ["pin", "favorite", "favourite", "star", "sort", "plugins"],

    starred: [] as string[],

    async loadStarred(): Promise<void> {
        const stored = await DataStore.get(STORAGE_KEY) as string[] | undefined;
        this.starred = Array.isArray(stored) ? [...stored] : [];
    },

    async start(): Promise<void> {
        await this.loadStarred();
    },

    sortWithStarred(plugins: Plugin[]): Plugin[] {
        const { starred } = this;
        return [
            ...plugins.filter(p => starred.includes(p.name)),
            ...plugins.filter(p => !starred.includes(p.name)).sort((a, b) => a.name.localeCompare(b.name))
        ];
    },

    isStarred(name: string): boolean {
        return this.starred.includes(name);
    },

    toggleStar(name: string): void {
        const idx = this.starred.indexOf(name);
        if (idx === -1) this.starred.push(name);
        else this.starred.splice(idx, 1);
        void DataStore.set(STORAGE_KEY, [...this.starred]);
        FluxDispatcher.dispatch({ type: STAR_UPDATED_EVENT });
    }
});
