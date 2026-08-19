/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
export let initialQuestDataFetched = false;
let settingsModalOpen = false;
export function setInitialQuestDataFetched(fetched) {
    initialQuestDataFetched = fetched;
}
export function setSettingsModalOpen(open) {
    settingsModalOpen = open;
}
export function getSettingsModalOpen() {
    return settingsModalOpen;
}
