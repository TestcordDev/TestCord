/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as handlers from "@song-spotlight/api/handlers";
import { setFetchHandler } from "@song-spotlight/api/util";
import { net } from "electron";
setFetchHandler(net.fetch);
export async function parseLink(_, link) {
    return handlers.parseLink(link);
}
export async function renderSong(_, song) {
    return handlers.renderSong(song);
}
export async function validateSong(_, song) {
    return handlers.validateSong(song);
}
