/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { TestcordDevs } from "@utils/constants";
import { sleep } from "@utils/index";
import definePlugin from "@utils/types";

import { settings } from "./settings";

let maxwellRunning = false;

export default definePlugin({
    name: "Maxwell :3",
    description: "Silly Silly Silly",
    tags: ["Utility", "Fun"],
    authors: [TestcordDevs.x2b, TestcordDevs.nnenaza],
    dependencies: ["CommandsAPI"],
    settings,
    async start() {
        maxwellRunning = true;
        await sleep(5);
        for (let i = 0; i < settings.store.concurrentMaxwells ; i +=1) {
            addGifToScreen();
        }
    },
    stop() {
        maxwellRunning = false;
        let gifElement = document.querySelector(".moving-gif");
        while (gifElement) {
            if (gifElement) {
                gifElement.remove();
            }
            gifElement = document.querySelector(".moving-gif");
        }
    }

});

export async function addGifToScreen() {
    // Make Maxwell happy spot :3
    const gifElement = document.createElement("img");
    gifElement.src = settings.store.gifLink2; // Start with spinny car
    gifElement.className = "moving-gif";
    gifElement.style.position = "fixed";
    gifElement.style.bottom = "10px";
    gifElement.style.left = "0px";
    gifElement.style.width = settings.store.gifSize + "px";
    gifElement.style.zIndex = "9999";
    gifElement.style.transition = "all ease";
    // Maxwell approves of directly modifying the DOM
    document.body.appendChild(gifElement);

    const getRandTime = (min: number, max: number) => Math.random() * (max - min) + min;

    // Where will Maxwell be silly next?
    const getRandPos = () => {
        const screenW = window.innerWidth;
        const screenH = window.innerHeight;
        const gifW = gifElement.offsetWidth;
        const gifH = gifElement.offsetHeight;

        return {
            x: Math.max(0, Math.random() * (screenW - gifW)),
            y: Math.max(0, Math.random() * (screenH - gifH))
        };
    };

    const timeToGetReallySilly = async () => {
        while (maxwellRunning) {
            // spinny spinny spinny spinny spinny spinny spinny
            gifElement.src = settings.store.gifLink2;
            gifElement.style.transition = "none";
            await sleep(getRandTime(4000, 8000));
            if (!maxwellRunning) break;

            // dancy dancy dancy dancy dancy dancy dancy
            const { x, y } = getRandPos();
            gifElement.src = settings.store.gifLink1;
            gifElement.style.transition = `all ${getRandTime(4, 8)}s ease`;
            gifElement.style.left = `${x}px`;
            gifElement.style.bottom = `${y}px`;

            if (!gifElement.parentNode) break;
            await new Promise<void>(resolve => {
                if (!gifElement.parentNode) return resolve();
                gifElement.addEventListener("transitionend", () => resolve(), { once: true });
            });
        }
    };

    if (maxwellRunning) timeToGetReallySilly();
}
