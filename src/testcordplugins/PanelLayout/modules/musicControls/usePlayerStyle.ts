/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { disableStyle, enableStyle } from "@api/Styles";
import { useEffect } from "@webpack/common";

const mounts = new Map<string, number>();

/**
 * Player stylesheets are imported as `?managed` so they stay out of the always-loaded
 * core stylesheet, which is unconditional and is what makes a stylesheet cost anything
 * at all. The music player stylesheets are the densest source of un-indexable rules in
 * the tree: 20 rules keyed on `[class*=slider]` and `[class*=grabber]`, which every
 * engine has to test against candidate elements on each recalc.
 *
 * Refcounted because a player can be mounted twice, the main one and a preview, and the
 * first to unmount must not pull the styles out from under the other.
 */
export function usePlayerStyle(style: string) {
    useEffect(() => {
        mounts.set(style, (mounts.get(style) ?? 0) + 1);
        enableStyle(style);
        return () => {
            const remaining = (mounts.get(style) ?? 1) - 1;
            if (remaining > 0) {
                mounts.set(style, remaining);
                return;
            }
            mounts.delete(style);
            disableStyle(style);
        };
    }, [style]);
}
