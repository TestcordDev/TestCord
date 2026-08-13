/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { RepeatMode } from "../types";

export const CLIENT_NAME = "YMusicSync";
export const CLIENT_VERSION = "1.0.0";

export const REDIRECTOR_URL = "wss://ynison.music.yandex.ru/redirector.YnisonRedirectService/GetRedirectToYnison";
export const HUB_PATH = "/ynison_state.YnisonStateService/PutYnisonState";
export const REDIRECTOR_TIMEOUT_MS = 15_000;
export const RECONNECT_BASE_MS = 2_000;
export const RECONNECT_MAX_MS = 30_000;

export const DEVICE_SELECT_RETRY_MS = 10_000;

export const MAX_EVENTS = 500;
export const MAX_ARTIST_CACHE_ENTRIES = 200;

export const TRACKS_URL = "https://api.music.yandex.net/tracks";
export const TRACKS_FETCH_TIMEOUT_MS = 10_000;

export const TOKEN_PATTERN = /^[\w.\-~+/=]{1,512}$/;

export const COVER_HOSTS = new Set([
    "avatars.yandex.net",
    "avatars.mds.yandex.net"
]);
export const COVER_FETCH_TIMEOUT_MS = 10_000;
export const MAX_COVER_BYTES = 1024 * 1024;
export const MAX_COVER_REDIRECTS = 3;
export const MAX_COVER_CACHE_BYTES = 8 * 1024 * 1024;
export const COVER_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export const DEVICE_TYPE_CODE = 1;

export const REPEAT_TO_YNISON: Record<RepeatMode, string> = {
    off: "NONE",
    context: "CONTEXT",
    one: "ONE"
};
export const REPEAT_CYCLE: RepeatMode[] = ["off", "context", "one"];
