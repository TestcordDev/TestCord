/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BaseText } from "@components/BaseText";
import { TooltipContainer } from "@components/TooltipContainer";
import { settings } from "@testcordplugins/PanelLayout/modules/musicControls/settings";
import { ContextMenuApi, openModalLazy, React, useStateFromStores } from "@webpack/common";

import { StrawberryStore } from "../../StrawberryStore";
import { LyricsContextMenu } from "./ctxMenu";
import { LyricsModal } from "./modal";
import { cl, NoteSvg, useLyrics } from "./util";

export function StrawberryLyrics({ scroll = true }: { scroll?: boolean; }) {
    const { showMusicNoteOnNoLyrics } = settings.use(["showMusicNoteOnNoLyrics"]);
    const { lyrics, lyricRefs, currLrcIndex } = useLyrics({ scroll });
    const currentLyrics = lyrics || null;
    const NoteElement = NoteSvg(cl("music-note"));
    const track = useStateFromStores([StrawberryStore], () => StrawberryStore.track);

    if (!track) return null;

    const makeClassName = (index: number) => {
        if (currLrcIndex === null) return "";
        const diff = index - currLrcIndex;
        return cl(diff === 0 ? "current" : diff > 0 ? "next" : "prev");
    };

    if (!currentLyrics) {
        return showMusicNoteOnNoLyrics ? (
            <div
                className="eq-strawberry-lyrics"
                onContextMenu={e => ContextMenuApi.openContextMenu(e, () => <LyricsContextMenu />)}
            >
                <TooltipContainer text="No lyrics found">
                    {NoteElement}
                </TooltipContainer>
            </div>
        ) : null;
    }

    return (
        <div
            className="eq-strawberry-lyrics"
            onClick={() => openModalLazy(async () => props => <LyricsModal rootProps={props} />)}
            onContextMenu={e => ContextMenuApi.openContextMenu(e, () => <LyricsContextMenu />)}
        >
            {currentLyrics.map((line, i) => (
                <div ref={lyricRefs[i]} key={i}>
                    <BaseText size={currLrcIndex === i ? "sm" : "xs"} className={makeClassName(i)}>
                        {line.text || NoteElement}
                    </BaseText>
                </div>
            ))}
        </div>
    );
}
