/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BaseText } from "@components/BaseText";
import { Flex } from "@components/Flex";
import { Heading } from "@components/Heading";
import { copyWithToast } from "@utils/discord";
import type { RenderModalProps } from "@vencord/discord-types";
import { Modal, React, useStateFromStores } from "@webpack/common";

import { StrawberryStore } from "../../StrawberryStore";
import { NoteSvg, useLyrics } from "./util";

export function LyricsModal({ rootProps }: { rootProps: RenderModalProps; }) {
    const track = useStateFromStores([StrawberryStore], () => StrawberryStore.track);
    const { lyrics, lyricRefs, currLrcIndex } = useLyrics({ scroll: true });
    const NoteElement = NoteSvg();

    return (
        <Modal
            size="md"
            title={
                <Flex flexDirection="column" gap={4}>
                    <Heading tag="h2" style={{ margin: 0 }}>
                        {track?.name || "Strawberry Lyrics"}
                    </Heading>
                    {track?.artist && (
                        <BaseText size="xs" color="text-muted">
                            {track.artist} {track.album ? `• ${track.album}` : ""}
                        </BaseText>
                    )}
                </Flex>
            }
            {...rootProps}
        >
            <div
                style={{
                    maxHeight: "65vh",
                    overflowY: "auto",
                    padding: "16px",
                    textAlign: "center",
                    lineHeight: "2.2em"
                }}
            >
                {!lyrics || lyrics.length === 0 ? (
                    <div style={{ color: "var(--text-muted)", padding: "32px" }}>
                        {NoteElement}
                        <div style={{ marginTop: "12px" }}>No synchronized lyrics available for this track.</div>
                    </div>
                ) : (
                    lyrics.map((line, i) => {
                        const isCurrent = currLrcIndex === i;
                        return (
                            <div
                                key={i}
                                ref={lyricRefs[i]}
                                style={{
                                    transition: "all 0.2s ease",
                                    transform: isCurrent ? "scale(1.05)" : "scale(1)",
                                    opacity: isCurrent ? 1 : 0.65,
                                    fontWeight: isCurrent ? 700 : 400,
                                    color: isCurrent ? "var(--text-strong, #fff)" : "var(--text-muted)",
                                    cursor: "pointer",
                                    padding: "4px 8px",
                                    borderRadius: "6px"
                                }}
                                onClick={() => {
                                    if (typeof line.time === "number") {
                                        StrawberryStore.seek(line.time * 1000);
                                    }
                                }}
                                onContextMenu={() => copyWithToast(line.text)}
                            >
                                <BaseText size={isCurrent ? "md" : "sm"}>
                                    {line.text || NoteElement}
                                </BaseText>
                            </div>
                        );
                    })
                )}
            </div>
        </Modal>
    );
}
