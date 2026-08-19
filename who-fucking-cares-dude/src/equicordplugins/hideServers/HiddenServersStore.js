/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as DataStore from "@api/DataStore";
import { proxyLazyWebpack } from "@webpack";
import { Flux, FluxDispatcher, GuildStore, SortedGuildStore } from "@webpack/common";
export const HiddenServersStore = proxyLazyWebpack(() => {
    const { Store } = Flux;
    const DB_KEY = "HideServers_servers";
    class HiddenServersStore extends Store {
        _hiddenGuilds = new Set();
        get hiddenGuilds() { return this._hiddenGuilds; }
        async load() {
            const data = await DataStore.get(DB_KEY);
            if (data && data instanceof Set) {
                this._hiddenGuilds = data;
            }
        }
        unload() {
            this._hiddenGuilds.clear();
        }
        save() {
            DataStore.set(DB_KEY, this._hiddenGuilds);
        }
        addHiddenGuild(id) {
            this._hiddenGuilds.add(id);
            this.save();
            this.emitChange();
        }
        removeHiddenGuild(id) {
            this._hiddenGuilds.delete(id);
            this.save();
            this.emitChange();
        }
        addHiddenFolder(id, guildIds) {
            this._hiddenGuilds.add(`folder-${id}`);
            guildIds.forEach(gid => this._hiddenGuilds.add(gid));
            this.save();
            this.emitChange();
        }
        removeHiddenFolder(id, guildIds) {
            this._hiddenGuilds.delete(`folder-${id}`);
            guildIds.forEach(gid => this._hiddenGuilds.delete(gid));
            this.save();
            this.emitChange();
        }
        clearHidden() {
            this._hiddenGuilds.clear();
            DataStore.del(DB_KEY);
            this.emitChange();
        }
        hiddenGuildsDetail() {
            const sortedGuildIds = SortedGuildStore.getFlattenedGuildIds();
            // otherwise the list is in order of increasing id number which is confusing
            return sortedGuildIds.filter(id => this._hiddenGuilds.has(id)).map(id => GuildStore.getGuild(id));
        }
    }
    return new HiddenServersStore(FluxDispatcher);
});
