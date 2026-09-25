/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { settings } from "@testcordplugins/PanelLayout/modules/musicControls/settings";
import { classes } from "@utils/misc";
import { React, useEffect, useMemo, useStateFromStores } from "@webpack/common";

import { StrawberryStore } from "../../StrawberryStore";
import { StrawberryLrcStore } from "../providers/store";

export const cl = (className: string) => `eq-strawberry-lyrics-${className}`;

export function NoteSvg(className?: string) {
    return (
        <svg
            className={classes(cl("note-icon"), className)}
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="currentColor"
        >
            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
        </svg>
    );
}

export function useLyrics({ scroll = true }: { scroll?: boolean }) {
    const rawLyrics = useStateFromStores([StrawberryLrcStore], () => StrawberryLrcStore.lyrics);
    const { lyricDelay } = settings.use(["lyricDelay"]);

    const lyrics = useMemo(() => {
        if (!rawLyrics) return null;
        return rawLyrics.map(line => ({
            ...line,
            time: line.time + (lyricDelay || 0) / 1000
        }));
    }, [rawLyrics, lyricDelay]);

    const lyricRefs = useMemo(() => {
        if (!lyrics) return [];
        return Array.from({ length: lyrics.length }, () => React.createRef<HTMLDivElement>());
    }, [lyrics]);

    const position = useStateFromStores([StrawberryStore], () => StrawberryStore.mPosition / 1000);

    const currLrcIndex = lyrics
        ? lyrics.findIndex((line, i) => {
            const nextLineTime = lyrics[i + 1]?.time ?? Infinity;
            return position >= line.time && position < nextLineTime;
        })
        : null;

    useEffect(() => {
        if (!scroll || currLrcIndex === null || currLrcIndex < 0 || !lyricRefs[currLrcIndex]?.current) return;
        lyricRefs[currLrcIndex].current?.scrollIntoView({
            behavior: "smooth",
            block: "center"
        });
    }, [currLrcIndex, scroll, lyricRefs]);

    return { lyrics, lyricRefs, currLrcIndex };
}
