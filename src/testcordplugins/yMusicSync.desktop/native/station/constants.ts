/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const DEVICE_LIST_URL = "https://quasar.yandex.net/glagol/device_list";
export const GLAGOL_TOKEN_URL = "https://quasar.yandex.net/glagol/token";

export const STATION_PREFIX = "station:";

export const MDNS_SERVICE = "_yandexio._tcp.local";
export const MDNS_ADDRESS = "224.0.0.251";
export const MDNS_PORT = 5353;
export const MDNS_QUERY_DELAYS = [0, 500, 1_500, 3_000, 6_000, 10_000, 13_000];
export const DISCOVERY_TIMEOUT_MS = 15_000;
export const DISCOVERY_INTERVAL_MS = 120_000;

export const STATION_PING_MS = 10_000;
export const STATION_RECONNECT_MS = 5_000;
