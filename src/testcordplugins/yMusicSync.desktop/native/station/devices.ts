/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { PlayerDevice } from "../../types";
import { state } from "../state";
import { STATION_PREFIX } from "./constants";

export function stationDevices(): PlayerDevice[] {
    return state.stations.map(station => ({
        id: `${STATION_PREFIX}${station.deviceId}`,
        title: station.name || station.deviceId,
        canBePlayer: true
    }));
}
