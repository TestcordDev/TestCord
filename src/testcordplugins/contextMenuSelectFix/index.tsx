/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";

const classes = findByPropsLazy("menu", "submenu");

let lastRightPressTime = 0;

export default definePlugin({
    name: "ContextMenuSelectFix",
    description: "Releasing right click when hovering over a context menu entry selects it, bringing the behaviour in line with other apps",
    tags: ["Utility"],
    authors: [TestcordDevs.x2b],
    pointerDownEventHandler(e: PointerEvent) {
        if (e.button !== 2) return;
        lastRightPressTime = Date.now();
    },
    pointerUpEventHandler(e: PointerEvent) {
        let target = e.target as HTMLElement | null;
        if (!target || e.button !== 2) return;
        if (Date.now() - lastRightPressTime < 120) return;
        let parent = target.parentElement;
        try {
            while (parent && !parent?.classList.contains(classes.menu)) {
                parent = parent.parentElement;
            }
        } catch (err) { return console.error(err); }
        if (parent) {
            while (target && !target?.click) {
                target = target?.parentElement;
            }
            target?.click();
        }
    },
    start() {
        document.body.addEventListener("pointerdown", this.pointerDownEventHandler);
        document.body.addEventListener("pointerup", this.pointerUpEventHandler);
    },
    stop() {
        document.body.removeEventListener("pointerdown", this.pointerDownEventHandler);
        document.body.removeEventListener("pointerup", this.pointerUpEventHandler);
    }
});
