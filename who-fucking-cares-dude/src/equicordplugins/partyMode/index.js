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
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { FluxDispatcher } from "@webpack/common";
const settings = definePluginSettings({
    superIntensePartyMode: {
        description: "Party intensity",
        type: 4 /* OptionType.SELECT */,
        options: [
            { label: "Normal", value: 0 /* Intensity.Normal */, default: true },
            { label: "Better", value: 1 /* Intensity.Better */ },
            { label: "Project X", value: 2 /* Intensity.ProjectX */ },
        ],
        restartNeeded: false,
        onChange: setSettings
    },
});
export default definePlugin({
    name: "PartyMode",
    description: "Allows you to use party mode cause the party never ends ✨",
    tags: ["Fun"],
    authors: [Devs.UwUDev],
    reporterTestable: 2 /* ReporterTestable.None */,
    settings,
    start() {
        setPoggerState(true);
        setSettings(settings.store.superIntensePartyMode);
    },
    stop() {
        setPoggerState(false);
    },
});
function setPoggerState(state) {
    FluxDispatcher.dispatch({
        type: "POGGERMODE_SETTINGS_UPDATE",
        settings: {
            enabled: state,
            settingsVisible: state
        }
    });
}
function setSettings(intensity) {
    const state = {
        screenshakeEnabledLocations: { 0: true, 1: true, 2: true },
        shakeIntensity: 1,
        confettiSize: 16,
        confettiCount: 5,
        combosRequiredCount: 1
    };
    switch (intensity) {
        case 0 /* Intensity.Normal */: {
            Object.assign(state, {
                screenshakeEnabledLocations: { 0: true, 1: false, 2: false },
                combosRequiredCount: 5
            });
            break;
        }
        case 1 /* Intensity.Better */: {
            Object.assign(state, {
                confettiSize: 12,
                confettiCount: 8,
            });
            break;
        }
        case 2 /* Intensity.ProjectX */: {
            Object.assign(state, {
                shakeIntensity: 20,
                confettiSize: 25,
                confettiCount: 15,
            });
            break;
        }
    }
    FluxDispatcher.dispatch({
        type: "POGGERMODE_SETTINGS_UPDATE",
        settings: state
    });
}
