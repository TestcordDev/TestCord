/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { settings } from "@testcordplugins/PanelLayout/modules/musicControls/settings";
import { proxyLazyWebpack } from "@webpack";
import { Flux, FluxDispatcher } from "@webpack/common";

import { StrawberryStore } from "../../StrawberryStore";
import { getLyrics } from "../api";
import { EnhancedLyric } from "../types";

function showNotif(title: string, body: string) {
    if (settings.store.showFailedToasts) {
        showNotification({
            color: "#e63946",
            title,
            body,
            noPersist: true
        });
    }
}

let strawberryStoreChangeListener: (() => void) | undefined;

export const StrawberryLrcStore = proxyLazyWebpack(() => {
    let lyrics: EnhancedLyric[] | null = null;
    let lastTrackId: string | null = null;

    class StrawberryLrcStoreClass extends Flux.Store {
        init() { }
        get lyrics() {
            return lyrics;
        }
    }

    const store = new StrawberryLrcStoreClass(FluxDispatcher);
    function handleStrawberryStoreChange() {
        const { track } = StrawberryStore;
        if (!track?.id || lastTrackId === track.id) return;
        lastTrackId = track.id;
        getLyrics(track)
            .then(l => {
                lyrics = l;
                store.emitChange();
            })
            .catch(() => {
                lyrics = null;
                showNotif("Strawberry Lyrics", "Failed to fetch lyrics");
                store.emitChange();
            });
    }

    StrawberryStore.addChangeListener(handleStrawberryStoreChange);
    strawberryStoreChangeListener = handleStrawberryStoreChange;

    return store;
});

export function stopStrawberryLrcStore() {
    if (strawberryStoreChangeListener) {
        StrawberryStore.removeChangeListener(strawberryStoreChangeListener);
        strawberryStoreChangeListener = undefined;
    }
}
