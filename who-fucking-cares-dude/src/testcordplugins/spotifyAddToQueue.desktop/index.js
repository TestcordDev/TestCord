/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 nin0dev
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Toasts } from "@webpack/common";
const SpotifySocket = findByPropsLazy("getActiveSocketAndDevice");
const SpotifyAPI = findByPropsLazy("vcSpotifyMarker");
function queueSong(id) {
    const { socket } = SpotifySocket.getActiveSocketAndDevice();
    if (!socket)
        return Toasts.show({
            type: Toasts.Type.FAILURE,
            message: "Make sure that Spotify is running before queuing a song",
            id: Toasts.genId()
        });
    try {
        SpotifyAPI.post(socket.accountId, socket.accessToken, {
            url: "https://api.spotify.com/v1/me/player/queue",
            query: {
                uri: `spotify:track:${id}`
            }
        });
        Toasts.show({
            type: Toasts.Type.SUCCESS,
            message: "Song queued",
            id: Toasts.genId()
        });
    }
    catch (e) {
        console.error(e);
        Toasts.show({
            type: Toasts.Type.FAILURE,
            message: "An error occurred, check console",
            id: Toasts.genId()
        });
    }
}
export default definePlugin({
    name: "SpotifyAddToQueue",
    description: "Adds a button in Spotify embeds to add the song to the queue",
    tags: ["Media", "Utility"],
    authors: [Devs.nin0dev],
    iframeMessageListener: e => {
        try {
            const songIDMatch = e.data.match(/vc-spotifyaddtoqueue__([a-zA-Z0-9]{0,200})/);
            if (!songIDMatch)
                return;
            const songID = songIDMatch[1];
            queueSong(songID);
        }
        catch {
            return;
        }
    },
    start() {
        window.addEventListener("message", this.iframeMessageListener);
    },
    stop() {
        window.removeEventListener("message", this.iframeMessageListener);
    }
});
