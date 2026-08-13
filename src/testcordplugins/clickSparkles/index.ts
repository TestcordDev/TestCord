/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { disableStyle, enableStyle } from "@api/Styles";
import definePlugin from "@utils/types";

import style from "./style.css?managed";

const COLORS = ["#ff71ce", "#01cdfe", "#b967ff", "#05ffa1"];

function burst(e: MouseEvent) {
    for (let i = 0; i < 6; i++) {
        const s = document.createElement("span");
        s.className = "mc-sparkle";
        s.textContent = "✦";
        s.style.left = e.clientX + "px";
        s.style.top = e.clientY + "px";
        s.style.color = COLORS[Math.floor(Math.random() * COLORS.length)];
        s.style.setProperty("--dx", (Math.random() * 40 - 20) + "px");
        s.style.setProperty("--dy", (-Math.random() * 40 - 10) + "px");
        document.body.appendChild(s);
        s.addEventListener("animationend", () => s.remove());
    }
}

export default definePlugin({
    name: "ClickSparkles",
    description: "Sprinkles little neon sparkles wherever you click.",
    authors: [{ name: "Sharp", id: 0n }],
    tags: ["Fun", "Appearance"],
    start() {
        enableStyle(style);
        document.addEventListener("click", burst);
    },
    stop() {
        document.removeEventListener("click", burst);
        disableStyle(style);
    }
});
