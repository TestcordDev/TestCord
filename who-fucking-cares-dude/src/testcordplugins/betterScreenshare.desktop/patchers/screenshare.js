/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
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
import { UserStore } from "@webpack/common";
import { PluginInfo } from "../../betterScreenshare.desktop/constants";
import { logger } from "../../betterScreenshare.desktop/logger";
import { screenshareStore } from "../../betterScreenshare.desktop/stores";
import { Emitter, MediaEngineStore, Patcher } from "../../philsPluginLibrary";
import { patchConnectionVideoSetDesktopSourceWithOptions, patchConnectionVideoTransportOptions } from "../../philsPluginLibrary/patches/video";
export class ScreensharePatcher extends Patcher {
    mediaEngineStore;
    mediaEngine;
    connection;
    oldSetDesktopSourceWithOptions;
    oldSetTransportOptions;
    forceUpdateTransportationOptions;
    forceUpdateDesktopSourceOptions;
    constructor() {
        super();
        this.mediaEngineStore = MediaEngineStore;
        this.mediaEngine = this.mediaEngineStore.getMediaEngine();
        this.forceUpdateTransportationOptions = () => void 0;
        this.forceUpdateDesktopSourceOptions = () => void 0;
        this.oldSetDesktopSourceWithOptions = () => void 0;
        this.oldSetTransportOptions = () => void 0;
    }
    patch() {
        this.unpatch();
        const { get } = screenshareStore;
        const connectionEventFunction = (connection) => {
            if (!(connection.context === "stream" && connection.streamUserId === UserStore.getCurrentUser().id))
                return;
            this.connection = connection;
            const { oldSetDesktopSourceWithOptions, oldSetTransportOptions, forceUpdateDesktopSourceOptions, forceUpdateTransportationOptions } = {
                ...patchConnectionVideoTransportOptions(connection, get, logger),
                ...patchConnectionVideoSetDesktopSourceWithOptions(connection, get, logger)
            };
            this.oldSetDesktopSourceWithOptions = oldSetDesktopSourceWithOptions;
            this.oldSetTransportOptions = oldSetTransportOptions;
            this.forceUpdateDesktopSourceOptions = forceUpdateDesktopSourceOptions;
            this.forceUpdateTransportationOptions = forceUpdateTransportationOptions;
            Emitter.addListener(connection.emitter, "on", "connected", () => {
                this.forceUpdateTransportationOptions();
                this.forceUpdateDesktopSourceOptions();
            });
            Emitter.addListener(connection.emitter, "on", "destroy", () => {
                this.forceUpdateTransportationOptions = () => void 0;
                this.forceUpdateDesktopSourceOptions = () => void 0;
                this.oldSetTransportOptions = () => void 0;
                this.oldSetDesktopSourceWithOptions = () => void 0;
            });
        };
        Emitter.addListener(this.mediaEngine.emitter, "on", "connection", connectionEventFunction, PluginInfo.PLUGIN_NAME);
        return this;
    }
    unpatch() {
        return this._unpatch();
    }
}
