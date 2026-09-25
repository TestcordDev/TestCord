/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./strawberryStyles.css";

import { Settings } from "@api/Settings";
import { BaseText } from "@components/BaseText";
import { Flex } from "@components/Flex";
import { CopyIcon, ImageIcon, OpenExternalIcon } from "@components/Icons";
import { debounce } from "@shared/debounce";
import { SeekBar } from "@testcordplugins/PanelLayout/modules/musicControls/spotify/SeekBar";
import { copyWithToast, openImageModal } from "@utils/discord";
import { classes } from "@utils/misc";
import { ContextMenuApi, FluxDispatcher, Menu, React, useEffect, useState, useStateFromStores } from "@webpack/common";

import { StrawberryStore, type StrawberryTrack } from "./StrawberryStore";

const cl = (className: string) => `eq-strawberry-${className}`;

function msToHuman(ms: number) {
    const minutes = ms / 1000 / 60;
    const m = Math.floor(minutes);
    const s = Math.floor((minutes - m) * 60);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function Svg(path: string, label: string) {
    return () => (
        <svg
            className={classes(cl("button-icon"), cl(label))}
            height="24"
            width="24"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-label={label}
            focusable={false}
        >
            <path d={path} />
        </svg>
    );
}

const PlayButton = Svg("M8 6.82v10.36c0 .79.87 1.27 1.54.84l8.14-5.18c.62-.39.62-1.29 0-1.69L9.54 5.98C8.87 5.55 8 6.03 8 6.82z", "play");
const PauseButton = Svg("M8 19c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2s-2 .9-2 2v10c0 1.1.9 2 2 2zm6-12v10c0 1.1.9 2 2 2s2-.9 2-2V7c0-1.1-.9-2-2-2s-2 .9-2 2z", "pause");
const SkipPrev = Svg("M7 6c.55 0 1 .45 1 1v10c0 .55-.45 1-1 1s-1-.45-1-1V7c0-.55.45-1 1-1zm3.66 6.82l5.77 4.07c.66.47 1.58-.01 1.58-.82V7.93c0-.81-.91-1.28-1.58-.82l-5.77 4.07c-.57.4-.57 1.24 0 1.64z", "previous");
const SkipNext = Svg("M7.58 16.89l5.77-4.07c.56-.4.56-1.24 0-1.63L7.58 7.11C6.91 6.65 6 7.12 6 7.93v8.14c0 .81.91 1.28 1.58.82zM16 7v10c0 .55.45 1 1 1s1-.45 1-1V7c0-.55-.45-1-1-1s-1 .45-1 1z", "next");
const RepeatIcon = Svg("M7 7h10v1.79c0 .45.54.67.85.35l2.79-2.79c.2-.2.2-.51 0-.71l-2.79-2.79c-.31-.31-.85-.09-.85.36V5H6c-.55 0-1 .45-1 1v4c0 .55.45 1 1 1s1-.45 1-1V7zm10 10H7v-1.79c0-.45-.54-.67-.85-.35l-2.79 2.79c-.2.2-.2.51 0 .71l2.79 2.79c.31.31.85.09.85-.36V19h11c.55 0 1-.45 1-1v-4c0-.55-.45-1-1-1s-1 .45-1 1v3z", "repeat");
const ShuffleIcon = Svg("M10.59 9.17L6.12 4.7c-.39-.39-1.02-.39-1.41 0-.39.39-.39 1.02 0 1.41l4.46 4.46 1.42-1.4zm4.76-4.32l1.19 1.19L4.7 17.88c-.39.39-.39 1.02 0 1.41.39.39 1.02.39 1.41 0L17.96 7.46l1.19 1.19c.31.31.85.09.85-.36V4.5c0-.28-.22-.5-.5-.5h-3.79c-.45 0-.67.54-.36.85zm-.52 8.56l-1.41 1.41 3.13 3.13-1.2 1.2c-.31.31-.09.85.36.85h3.79c.28 0 .5-.22.5-.5v-3.79c0-.45-.54-.67-.85-.35l-1.19 1.19-3.13-3.14z", "shuffle");

export function StrawberryIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg
            viewBox="0 0 24 24"
            width={props.width ?? 18}
            height={props.height ?? 18}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            {...props}
        >
            <path d="M12 2c0 2.5-1.5 3.5-1.5 3.5" stroke="#48bb78" />
            <path d="M9 4.5c1.2.8 3 .8 4.2 0" stroke="#48bb78" />
            <path d="M12 5.5c3-1 6 1 6 4 0 5-6 12.5-6 12.5S6 14.5 6 9.5c0-3 3-5 6-4z" fill="#e63946" stroke="#d90429" />
            <circle cx="10" cy="9.5" r="0.6" fill="#fff" opacity="0.85" />
            <circle cx="14" cy="9.5" r="0.6" fill="#fff" opacity="0.85" />
            <circle cx="12" cy="12.5" r="0.6" fill="#fff" opacity="0.85" />
            <circle cx="9.5" cy="14.5" r="0.6" fill="#fff" opacity="0.85" />
            <circle cx="14.5" cy="14.5" r="0.6" fill="#fff" opacity="0.85" />
            <circle cx="12" cy="16.5" r="0.6" fill="#fff" opacity="0.85" />
        </svg>
    );
}

function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
    return (
        <button
            className={cl("button")}
            {...props}
        >
            {props.children}
        </button>
    );
}

function CopyContextMenu({ name, value, path }: { name: string; value: string; path?: string | null; }) {
    return (
        <Menu.Menu
            navId="strawberry-copy-menu"
            onClose={() => FluxDispatcher.dispatch({ type: "CONTEXT_MENU_CLOSE" })}
            aria-label={`Strawberry ${name} Menu`}
        >
            <Menu.MenuItem
                id={`strawberry-copy-${name}`}
                label={`Copy ${name}`}
                action={() => copyWithToast(value)}
                icon={CopyIcon}
            />
            {path && (
                <Menu.MenuItem
                    id="strawberry-open-external"
                    label="Open Link"
                    action={() => StrawberryStore.openExternal(path)}
                    icon={OpenExternalIcon}
                />
            )}
        </Menu.Menu>
    );
}

function Controls() {
    const [isPlaying, shuffle, repeat] = useStateFromStores(
        [StrawberryStore],
        () => [StrawberryStore.isPlaying, StrawberryStore.shuffle, StrawberryStore.repeat]
    );

    const [nextRepeat, repeatClassName] = (() => {
        switch (repeat) {
            case 0: return [1, "repeat-off"] as const;
            case 1: return [2, "repeat-context"] as const;
            case 2: return [0, "repeat-track"] as const;
            default: return [0, "repeat-off"] as const;
        }
    })();

    return (
        <Flex className={cl("button-row")} style={{ gap: 0 }}>
            <Button
                className={classes(cl("button"), cl("shuffle"), cl(shuffle ? "shuffle-on" : "shuffle-off"))}
                onClick={() => StrawberryStore.setShuffle(!shuffle)}
                title={shuffle ? "Shuffle On" : "Shuffle Off"}
            >
                <ShuffleIcon />
            </Button>
            <Button
                onClick={() => {
                    const restartEnabled = Settings.plugins.MusicControls?.previousButtonRestartsTrack;
                    if (restartEnabled && StrawberryStore.position > 3000) {
                        StrawberryStore.seek(0);
                    } else {
                        StrawberryStore.previous();
                    }
                }}
                title="Previous"
            >
                <SkipPrev />
            </Button>
            <Button
                onClick={() => StrawberryStore.setPlaying(!isPlaying)}
                title={isPlaying ? "Pause" : "Play"}
            >
                {isPlaying ? <PauseButton /> : <PlayButton />}
            </Button>
            <Button
                onClick={() => StrawberryStore.next()}
                title="Next"
            >
                <SkipNext />
            </Button>
            <Button
                className={classes(cl("button"), cl(repeatClassName))}
                onClick={() => StrawberryStore.setRepeat(nextRepeat)}
                title="Repeat Mode"
            >
                {repeat === 2 && <span className={cl("repeat-1")}>1</span>}
                <RepeatIcon />
            </Button>
        </Flex>
    );
}

const seek = debounce((v: number) => {
    StrawberryStore.seek(v);
});

function StrawberrySeekBar() {
    const { songDuration, id: videoId } = StrawberryStore.track ?? { songDuration: 0, id: "0" };

    const [storePosition, isPlaying] = useStateFromStores(
        [StrawberryStore],
        () => [StrawberryStore.mPosition, StrawberryStore.isPlaying]
    );

    const [position, setPosition] = useState<number>(storePosition);

    useEffect(() => {
        setPosition(storePosition);
    }, [videoId, songDuration, storePosition]);

    useEffect(() => {
        if (isPlaying) {
            setPosition(StrawberryStore.position);
            const interval = setInterval(() => {
                setPosition(p => p + 1000);
            }, 1000);
            return () => clearInterval(interval);
        }
    }, [storePosition, isPlaying]);

    const onChange = (v: number) => {
        setPosition(v);
        seek(v);
    };

    const maxMs = (songDuration || 0) * 1000;

    return (
        <div id={cl("progress-bar")}>
            <BaseText
                size="xs"
                weight="medium"
                className={`${cl("progress-time")} ${cl("time-left")}`}
                aria-label="Progress"
            >
                {msToHuman(position)}
            </BaseText>
            <SeekBar
                initialValue={position}
                minValue={0}
                maxValue={maxMs > 0 ? maxMs : 1000}
                onValueChange={onChange}
                asValueChanges={onChange}
                onValueRender={msToHuman}
            />
            <BaseText
                size="xs"
                weight="medium"
                className={`${cl("progress-time")} ${cl("time-right")}`}
                aria-label="Total Duration"
            >
                {msToHuman(maxMs)}
            </BaseText>
        </div>
    );
}

function AlbumContextMenu({ track }: { track: StrawberryTrack | null; }) {
    return (
        <Menu.Menu
            navId="strawberry-album-menu"
            onClose={() => FluxDispatcher.dispatch({ type: "CONTEXT_MENU_CLOSE" })}
            aria-label="Strawberry Player Menu"
        >
            {track?.imageSrc && (
                <Menu.MenuItem
                    key="view-cover"
                    id="view-cover"
                    label="View Album Cover"
                    action={() => openImageModal({ url: track.imageSrc! })}
                    icon={ImageIcon}
                />
            )}
            <Menu.MenuControlItem
                id="strawberry-volume"
                key="strawberry-volume"
                label="Volume"
                control={(props, ref) => (
                    <Menu.MenuSliderControl
                        {...props}
                        ref={ref}
                        value={StrawberryStore.volume}
                        minValue={0}
                        maxValue={100}
                        onChange={debounce((v: number) => StrawberryStore.setVolume(v))}
                    />
                )}
            />
        </Menu.Menu>
    );
}

function Info({ track }: { track: StrawberryTrack; }) {
    const img = track?.imageSrc;
    const [coverExpanded, setCoverExpanded] = useState(false);

    const coverElement = img ? (
        <img
            id={cl("album-image")}
            src={img}
            alt="Album Image"
            onClick={() => setCoverExpanded(!coverExpanded)}
            onContextMenu={e => {
                ContextMenuApi.openContextMenu(e, () => <AlbumContextMenu track={track} />);
            }}
        />
    ) : (
        <div
            className={cl("cover-placeholder")}
            title="Strawberry Music Player"
            onContextMenu={e => {
                ContextMenuApi.openContextMenu(e, () => <AlbumContextMenu track={track} />);
            }}
        >
            <StrawberryIcon width={24} height={24} />
        </div>
    );

    if (coverExpanded && img) {
        return (
            <div id={cl("album-expanded-wrapper")}>
                {coverElement}
            </div>
        );
    }

    return (
        <div id={cl("info-wrapper")}>
            {coverElement}
            <div id={cl("titles")}>
                <BaseText
                    size="sm"
                    weight="semibold"
                    id={cl("song-title")}
                    className={cl("ellipoverflow")}
                    title={track?.name}
                    onContextMenu={e => ContextMenuApi.openContextMenu(e, () => <CopyContextMenu name="Title" value={track.name} path={track.url} />)}
                >
                    {track?.name}
                </BaseText>
                {track.artist && (
                    <BaseText size="sm" className={cl("ellipoverflow")}>
                        by&nbsp;
                        <span
                            className={cl("artist")}
                            style={{ fontSize: "inherit" }}
                            title={track.artist}
                            onContextMenu={e => ContextMenuApi.openContextMenu(e, () => <CopyContextMenu name="Artist" value={track.artist} />)}
                        >
                            {track.artist}
                        </span>
                    </BaseText>
                )}
                {track.album && (
                    <BaseText size="sm" className={cl("ellipoverflow")}>
                        on&nbsp;
                        <span
                            id={cl("album-title")}
                            className={cl("album")}
                            style={{ fontSize: "inherit" }}
                            title={track.album}
                            onContextMenu={e => ContextMenuApi.openContextMenu(e, () => <CopyContextMenu name="Album" value={track.album || ""} />)}
                        >
                            {track.album}
                        </span>
                    </BaseText>
                )}
            </div>
        </div>
    );
}

export function StrawberryPlayer() {
    const track = useStateFromStores(
        [StrawberryStore],
        () => StrawberryStore.track
    );

    const isPlaying = useStateFromStores([StrawberryStore], () => StrawberryStore.isPlaying);
    const [shouldHide, setShouldHide] = useState(false);

    useEffect(() => {
        setShouldHide(false);
        if (!isPlaying) {
            const timeout = setTimeout(() => setShouldHide(true), 1000 * 60 * 5);
            return () => clearTimeout(timeout);
        }
    }, [isPlaying]);

    if (!track || shouldHide) return null;

    return (
        <div id={cl("player")}>
            <Info track={track} />
            <StrawberrySeekBar />
            <Controls />
        </div>
    );
}
