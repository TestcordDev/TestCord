/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 nin0dev
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { RendererSettings } from "@main/settings";
import { app } from "electron";
app.on("browser-window-created", (_, win) => {
    win.webContents.on("frame-created", (_, { frame }) => {
        frame?.once("dom-ready", () => {
            if (frame.url.startsWith("https://open.spotify.com/embed/")) {
                const settings = RendererSettings.store.plugins?.SpotifyAddToQueue;
                if (!settings?.enabled)
                    return;
                frame.executeJavaScript(`
                    const interval = setInterval(() => {
                        const actions = document.querySelector("[class^='PlayerControlsShort_playerControlsWrapper__']");
                        if(actions) {
                            const addToQueueButton = document.createElement("button");
                            Object.assign(addToQueueButton.style, {
                                position: "relative",
                                top: "11px",
                                left: "0px"
                            });
                            addToQueueButton.classList.add('gIjhme');
                            addToQueueButton.title = "Add to queue";
                            addToQueueButton.addEventListener("click", () => {
                                window.top.postMessage("vc-spotifyaddtoqueue__" + location.href.match(/https:\\/\\/open\\.spotify.com\\/embed\\/track\\/([a-zA-Z0-9]{0,200})\\?/ )[1], "*");
                            });
                            addToQueueButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" height="48px" viewBox="0 -960 960 960" width="32px" fill="#e3e3e3"><path d="M642.94-160q-47.94 0-81.44-33.56t-33.5-81.5q0-47.94 32.67-81.44Q593.33-390 640-390q15.97 0 30.48 3Q685-384 698-377v-343h182v71H758v375q0 47.5-33.56 80.75T642.94-160ZM120-320v-60h306v60H120Zm0-170v-60h473v60H120Zm0-170v-60h473v60H120Z"/></svg>';
                            actions.insertBefore(addToQueueButton, actions.firstChild);
                            clearInterval(interval);
                        }
                    }, 100);
                `);
            }
        });
    });
});
