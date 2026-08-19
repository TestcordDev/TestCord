/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { sid } from "@song-spotlight/api/util";
import { useEffect, useState } from "@webpack/common";
export function useRender(song) {
    const [failed, setFailed] = useState(false);
    const [render, setRender] = useState(null);
    useEffect(() => {
        setFailed(false);
        setRender(null);
        Native.renderSong(song)
            .catch(() => null)
            .then(info => info ? setRender(info) : setFailed(true));
    }, [sid(song)]);
    return { failed, render };
}
export const Native = VencordNative.pluginHelpers.SongSpotlight;
