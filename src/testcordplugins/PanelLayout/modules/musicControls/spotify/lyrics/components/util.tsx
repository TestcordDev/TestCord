/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { settings } from "@testcordplugins/PanelLayout/modules/musicControls/settings";
import { SpotifyLrcStore } from "@testcordplugins/PanelLayout/modules/musicControls/spotify/lyrics/providers/store";
import { LyricWord, SyncedLyric } from "@testcordplugins/PanelLayout/modules/musicControls/spotify/lyrics/providers/types";
import { SpotifyStore } from "@testcordplugins/PanelLayout/modules/musicControls/spotify/SpotifyStore";
import { classNameFactory } from "@utils/css";
import { findCssClassesLazy } from "@webpack";
import { FluxDispatcher, React, useEffect, useState, useStateFromStores } from "@webpack/common";

export const scrollClasses = findCssClassesLazy("auto", "customTheme");

export const cl = classNameFactory("vc-spotify-lyrics-");

const DATASTORE_KEY = "vc-spotify-custom-song-delays";
const customSongDelays: Record<string, number> = {};
let isLoaded = false;

// Pre-load data globally once
DataStore.get<Record<string, number>>(DATASTORE_KEY).then(saved => {
    if (saved) {
        Object.assign(customSongDelays, saved);
    }
    isLoaded = true;
    // Force trigger update across components if needed
    FluxDispatcher?.dispatch?.({ type: "SPOTIFY_LYRICS_DELAYS_LOADED" });
});

export function NoteSvg() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 480 720" fill="currentColor" className={cl("music-note")}>
            <path d="m160,-240 q -66,0 -113,-47 -47,-47 -47,-113 0,-66 47,-113 47,-47 113,-47 23,0 42.5,5.5 19.5,5.5 37.5,16.5 v -422 h 240 v 160 H 320 v 400 q 0,66 -47,113 -47,47 -113,47 z" />
        </svg>
    );
}

const getIndexes = (lyrics: SyncedLyric[], position: number, delay: number) => {
    const posInSec = (position + delay) / 1000;

    let left = 0, right = lyrics.length - 1;
    let currentIndex: number | null = null;

    while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        const curr = lyrics[mid];
        const next = lyrics[mid + 1];

        if (curr.time <= posInSec && (!next || next.time > posInSec)) {
            currentIndex = mid;
            break;
        }

        if (curr.time > posInSec) {
            right = mid - 1;
        } else {
            left = mid + 1;
        }
    }

    const nextIdx = currentIndex !== null ? currentIndex + 1 : left;
    const nextLyricIdx = nextIdx < lyrics.length ? nextIdx : null;

    if (currentIndex !== null && posInSec - lyrics[currentIndex].time > 8) {
        return [null, nextLyricIdx];
    }

    return [currentIndex, nextLyricIdx];
};

function getActiveWordIndex(words: LyricWord[] | undefined, posInSec: number): number | null {
    if (!words?.length) return null;

    for (let i = 0; i < words.length; i++) {
        if (posInSec >= words[i].startTime && posInSec < words[i].endTime) return i;
    }

    return null;
}

function getSungUpToIndex(words: LyricWord[] | undefined, posInSec: number): number {
    if (!words?.length) return -1;

    let last = -1;
    for (let i = 0; i < words.length; i++) {
        if (words[i].endTime <= posInSec) last = i;
        else break;
    }

    return last;
}

export interface WordSweepSync {
    duration: number;
    elapsed: number;
}

export function useLyrics({ scroll = true }: { scroll?: boolean; } = {}) {
    const [track, storePosition, isPlaying] = useStateFromStores(
        [SpotifyStore], () => [
            SpotifyStore.track,
            SpotifyStore.mPosition,
            SpotifyStore.isPlaying,
        ]);
    const lyricsInfo = useStateFromStores([SpotifyLrcStore], () => SpotifyLrcStore.lyricsInfo);

    const { lyricDelay } = settings.use(["lyricDelay"]);

    const [currLrcIndex, setCurrLrcIndex] = useState<number | null>(null);
    const [nextLyric, setNextLyric] = useState<number | null>(null);
    const [activeWordIndex, setActiveWordIndex] = useState<number | null>(null);
    const [sungWordIndex, setSungWordIndex] = useState(-1);
    const [activeWordSync, setActiveWordSync] = useState<WordSweepSync | null>(null);
    const activeWordKeyRef = React.useRef<string | null>(null);
    const [lyricRefs, setLyricRefs] = useState<React.RefObject<HTMLDivElement | null>[]>([]);
    const [, forceUpdate] = useState({});

    const trackKey = track?.id || track?.name;
    const songCustomDelay = (trackKey && customSongDelays[trackKey]) || 0;
    const totalDelay = lyricDelay + songCustomDelay;

    useEffect(() => {
        const handleDelayUpdate = (action: { type: string; trackKey?: string; delay?: number; }) => {
            if (action.type === "SPOTIFY_LYRICS_CUSTOM_DELAY_CHANGE" && action.trackKey) {
                customSongDelays[action.trackKey] = action.delay!;
            }
            // Trigger a re-render once DataStore finishes loading or delay changes
            forceUpdate({});
        };

        FluxDispatcher.subscribe("SPOTIFY_LYRICS_CUSTOM_DELAY_CHANGE", handleDelayUpdate);
        FluxDispatcher.subscribe("SPOTIFY_LYRICS_DELAYS_LOADED", handleDelayUpdate);

        return () => {
            FluxDispatcher.unsubscribe("SPOTIFY_LYRICS_CUSTOM_DELAY_CHANGE", handleDelayUpdate);
            FluxDispatcher.unsubscribe("SPOTIFY_LYRICS_DELAYS_LOADED", handleDelayUpdate);
        };
    }, []);

    const currentLyrics = lyricsInfo?.lyricsVersions[lyricsInfo.useLyric];

    useEffect(() => {
        if (currentLyrics) {
            setLyricRefs(currentLyrics.map(() => React.createRef()));
        }
    }, [currentLyrics]);

    useEffect(() => {
        let rafId: number | undefined;

        const tick = () => {
            if (currentLyrics) {
                const pos = SpotifyStore.position;
                const [currentIndex, nextLyricIndex] = getIndexes(currentLyrics, pos, totalDelay);

                setCurrLrcIndex(prev => prev === currentIndex ? prev : currentIndex);
                setNextLyric(prev => prev === nextLyricIndex ? prev : nextLyricIndex);

                const posInSec = (pos + totalDelay) / 1000;
                const words = currentIndex != null ? currentLyrics[currentIndex].words : undefined;
                const wordIdx = getActiveWordIndex(words, posInSec);

                setActiveWordIndex(prev => prev === wordIdx ? prev : wordIdx);

                const sungIdx = getSungUpToIndex(words, posInSec);
                setSungWordIndex(prev => prev === sungIdx ? prev : sungIdx);

                const key = wordIdx != null ? `${currentIndex}:${wordIdx}` : null;
                if (key !== activeWordKeyRef.current) {
                    activeWordKeyRef.current = key;

                    if (key != null && words) {
                        const word = words[wordIdx!];
                        const durationMs = Math.max((word.endTime - word.startTime) * 1000, 50);
                        const elapsedMs = Math.min(Math.max((posInSec - word.startTime) * 1000, 0), durationMs);
                        setActiveWordSync({ duration: durationMs, elapsed: elapsedMs });
                    } else {
                        setActiveWordSync(null);
                    }
                }
            } else {
                setCurrLrcIndex(prev => prev === null ? prev : null);
                setNextLyric(prev => prev === null ? prev : null);
                setActiveWordIndex(prev => prev === null ? prev : null);
                setSungWordIndex(prev => prev === -1 ? prev : -1);
                activeWordKeyRef.current = null;
                setActiveWordSync(prev => prev === null ? prev : null);
            }

            if (isPlaying) {
                rafId = requestAnimationFrame(tick);
            }
        };

        tick();

        return () => {
            if (rafId !== undefined) cancelAnimationFrame(rafId);
        };
    }, [currentLyrics, totalDelay, isPlaying, storePosition]);

    useEffect(() => {
        if (scroll && currLrcIndex !== null) {
            if (currLrcIndex >= 0) {
                lyricRefs[currLrcIndex].current?.scrollIntoView({ behavior: "smooth", block: "center" });
            }
            if (currLrcIndex < 0 && nextLyric !== null) {
                lyricRefs[nextLyric]?.current?.scrollIntoView({ behavior: "smooth", block: "center" });
            }
        }
    }, [currLrcIndex, nextLyric, scroll, lyricRefs]);

    return { track, lyricsInfo, lyricRefs, currLrcIndex, nextLyric, activeWordIndex, sungWordIndex, activeWordSync, isPlaying };
}
