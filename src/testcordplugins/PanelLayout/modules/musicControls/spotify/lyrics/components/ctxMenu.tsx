/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { BaseText } from "@components/BaseText";
import { Button } from "@components/Button";
import { Flex } from "@components/Flex";
import { providers } from "@testcordplugins/PanelLayout/modules/musicControls/spotify/lyrics/api";
import { lyricsAlternative } from "@testcordplugins/PanelLayout/modules/musicControls/spotify/lyrics/providers/store";
import { copyWithToast } from "@utils/discord";
import { makeRange } from "@utils/types";
import type { RenderModalProps } from "@vencord/discord-types";
import { findComponentByCodeLazy } from "@webpack";
import { FluxDispatcher, Menu, Modal, openModalLazy, React, Slider } from "@webpack/common";

import { useLyrics } from "./util";

const CopyIcon = findComponentByCodeLazy(" 1-.5.5H10a6");
const PlusIcon = findComponentByCodeLazy("3a1 1 0 1 0-2 0v8H3");
const customSongDelays: Record<string, number> = {};
const DATASTORE_KEY = "vc-spotify-custom-song-delays";

DataStore.get<Record<string, number>>(DATASTORE_KEY).then(saved => {
    if (saved) {
        Object.assign(customSongDelays, saved);
        FluxDispatcher?.dispatch?.({ type: "SPOTIFY_LYRICS_DELAYS_LOADED" });
    }
});

function CustomDelayModal({ modalProps, trackKey, trackName }: { modalProps: RenderModalProps; trackKey: string; trackName: string; }) {
    const [delay, setDelay] = React.useState<number>(customSongDelays[trackKey] ?? 0);

    const handleDelayChange = (val: number) => {
        setDelay(val);
        customSongDelays[trackKey] = val;

        DataStore.set(DATASTORE_KEY, customSongDelays);

        FluxDispatcher.dispatch({
            type: "SPOTIFY_LYRICS_CUSTOM_DELAY_CHANGE",
            trackKey: trackKey,
            delay: val,
        });
    };

    return (
        <div className="customLyricsModal">
            <Modal
                {...modalProps}
                size="sm"
                title={<BaseText size="lg" weight="semibold">Custom Lyric Delay</BaseText>}
                actionBarInput={
                    <div style={{ display: "flex", justifyContent: "flex-end", width: "100%" }}>
                        <Button
                            variant="secondary"
                            style={{ backgroundColor: "#174b71", color: "#fff" }}
                            onClick={() => modalProps.onClose()}
                        >
                            Done
                        </Button>
                    </div>
                }
            >
                <Flex flexDirection="column" style={{ padding: "8px 0" }}>
                    <BaseText size="md">Delay for {trackName}: {delay}ms</BaseText>
                    <Slider
                        minValue={-2500}
                        maxValue={2500}
                        markers={makeRange(-2500, 2500, 250)}
                        stickToMarkers={true}
                        initialValue={delay}
                        onValueChange={handleDelayChange}
                    />
                </Flex>
            </Modal>
        </div>
    );
}

export function LyricsContextMenu() {
    const { track, lyricsInfo, currLrcIndex } = useLyrics({ scroll: false });

    const currLyric = lyricsInfo?.lyricsVersions[lyricsInfo.useLyric]?.[currLrcIndex ?? NaN];
    const hasLyrics = providers.some(provider => lyricsInfo?.lyricsVersions[provider]?.length);
    const trackName = track?.name;
    const trackKey = track?.id || track?.name;

    return (
        <Menu.Menu
            navId="spotify-lyrics-menu"
            onClose={() => FluxDispatcher.dispatch({ type: "CONTEXT_MENU_CLOSE" })}
            aria-label="Spotify Lyrics Menu"
        >

            <Menu.MenuItem
                key="copy-lyric"
                id="copy-lyric"
                label="Copy current lyric"
                disabled={!currLyric?.text}
                action={() => copyWithToast(currLyric!.text!, "Lyric copied!")}
                icon={CopyIcon}
                leadingAccessory={{ type: "icon", icon: CopyIcon }}
            />

            <Menu.MenuItem
                key="spotify-custom-lyric-delay"
                id="spotify-custom-lyric-delay"
                label="Custom delay for current song"
                disabled={!trackKey}
                action={() => {
                    if (!trackKey || !trackName) return;
                    openModalLazy(async () => modalProps => <CustomDelayModal modalProps={modalProps} trackKey={trackKey} trackName={trackName} />);
                }}
                icon={PlusIcon}
            />

            <Menu.MenuItem
                navId="spotify-lyrics-provider"
                id="spotify-lyrics-provider"
                label="Lyrics Provider"
            >
                {[...providers, ...lyricsAlternative].map(provider =>
                    <Menu.MenuRadioItem
                        key={`lyrics-provider-${provider}`}
                        id={`switch-provider-${provider.toLowerCase()}`}
                        group="vc-spotify-lyrics-switch-provider"
                        label={`${provider}${lyricsInfo?.lyricsVersions[provider] ? " (saved)" : ""}`}
                        checked={provider === lyricsInfo?.useLyric}
                        disabled={lyricsAlternative.includes(provider) && !hasLyrics}
                        action={() => {
                            FluxDispatcher.dispatch({
                                type: "SPOTIFY_LYRICS_PROVIDER_CHANGE",
                                provider: provider,
                            });
                        }}
                    />
                )}
            </Menu.MenuItem>
        </Menu.Menu>
    );
}
