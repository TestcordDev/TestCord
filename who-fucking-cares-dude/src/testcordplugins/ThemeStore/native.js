/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { safeFetch } from "@main/utils/safeFetch";
/**
 * Fetches the EquiThemes index from the main process, bypassing renderer CORS
 * restrictions. The host is locked to the themes API repo.
 */
export async function fetchUrl(_event, url) {
    const response = await safeFetch(url, {
        allowedHosts: ["raw.githubusercontent.com"],
        headers: {
            Accept: "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
            "Cache-Control": "no-cache",
            Pragma: "no-cache"
        }
    });
    if (!response.ok)
        throw new Error(`HTTP ${response.status} from ${url}`);
    return response.text();
}
