/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { BaseText } from "@components/BaseText";
import { makeLazy } from "@utils/lazy";
import { formatDurationMs } from "@utils/text";
import { Button, React, Slider, Tooltip, useEffect, useRef, useState } from "@webpack/common";
import { ICONS, TEXT } from "../constants";
import { cl } from "../css";
import { YMusicSyncStore } from "../store";
export function Icon({ path }) {
    return (<svg className={cl("icon")} viewBox="0 0 24 24" aria-hidden focusable={false}>
            <path d={path} fill="currentColor"/>
        </svg>);
}
const blankLook = makeLazy(() => {
    const looks = Button.Looks;
    return looks.BLANK ?? looks.LINK;
});
export function PanelButton({ label, onClick, children, active = false, primary = false, disabled = false }) {
    return (<Tooltip text={label}>
            {tooltipProps => (<Button {...tooltipProps} aria-label={label} size={Button.Sizes.NONE} look={blankLook()} color={Button.Colors.TRANSPARENT} className={cl("btn", { "btn-primary": primary, "btn-active": active })} disabled={disabled} onClick={(event) => {
                tooltipProps.onClick?.();
                onClick(event);
            }}>
                    {children}
                </Button>)}
        </Tooltip>);
}
export function IconButton({ path, ...props }) {
    return (<PanelButton {...props}>
            <Icon path={path}/>
        </PanelButton>);
}
export function ProgressSlider({ snapshot, disabled }) {
    const [, setTick] = useState(0);
    const [dragging, setDragging] = useState(false);
    const duration = Math.max(1, snapshot.durationMs);
    const dragPositionRef = useRef(YMusicSyncStore.positionMs);
    if (!dragging)
        dragPositionRef.current = YMusicSyncStore.positionMs;
    const position = dragPositionRef.current;
    const endDrag = () => {
        window.setTimeout(() => setDragging(false), 0);
    };
    const keySecondRef = useRef(0);
    if (!dragging)
        keySecondRef.current = Math.floor(position / 1000);
    const key = `${snapshot.trackId}-${snapshot.isPlaying}-${keySecondRef.current}`;
    useEffect(() => {
        if (!snapshot.isPlaying || dragging)
            return;
        let frame;
        let lastSecond = -1;
        const step = () => {
            if (!document.hidden) {
                const second = Math.floor(YMusicSyncStore.positionMs / 1000);
                if (second !== lastSecond) {
                    lastSecond = second;
                    setTick(current => current + 1);
                }
            }
            frame = requestAnimationFrame(step);
        };
        frame = requestAnimationFrame(step);
        return () => cancelAnimationFrame(frame);
    }, [snapshot.isPlaying, dragging]);
    return (<div className={cl("progress")}>
            <div className={cl("progress-track")} onPointerDownCapture={() => setDragging(true)} onPointerUpCapture={endDrag} onPointerCancelCapture={endDrag}>
                <Slider key={key} aria-label={TEXT.trackPosition} disabled={disabled} mini hideBubble initialValue={Math.min(position, duration)} minValue={0} maxValue={duration} keyboardStep={5000} onValueRender={(value) => formatDurationMs(value)} onValueChange={(value) => {
            dragPositionRef.current = value;
            YMusicSyncStore.seek(value);
        }}/>
            </div>
            <div className={cl("progress-times")}>
                <BaseText size="xs" color="text-muted" className={cl("time")}>
                    {formatDurationMs(position)}
                </BaseText>
                <BaseText size="xs" color="text-muted" className={cl("time")}>
                    {snapshot.durationMs > 0 ? formatDurationMs(snapshot.durationMs) : "--:--"}
                </BaseText>
            </div>
        </div>);
}
function volumeIcon(volume) {
    if (volume <= 0)
        return ICONS.volumeMuted;
    return volume < 50 ? ICONS.volumeLow : ICONS.volumeHigh;
}
export function VolumeSlider({ snapshot, disabled }) {
    const [dragging, setDragging] = useState(false);
    const dragVolumeRef = useRef(snapshot.volume);
    if (!dragging)
        dragVolumeRef.current = snapshot.volume;
    const keyVolumeRef = useRef(snapshot.volume);
    if (!dragging)
        keyVolumeRef.current = snapshot.volume;
    return (<div className={cl("volume")} onPointerDownCapture={() => setDragging(true)} onPointerUpCapture={() => setDragging(false)} onPointerCancelCapture={() => setDragging(false)}>
            <IconButton label={snapshot.volume <= 0 ? TEXT.unmute : TEXT.mute} path={volumeIcon(snapshot.volume)} onClick={() => YMusicSyncStore.toggleMute()} disabled={disabled}/>
            <div className={cl("volume-track")}>
                <Slider key={keyVolumeRef.current} aria-label={TEXT.volume} disabled={disabled} mini initialValue={dragVolumeRef.current} minValue={0} maxValue={100} onValueRender={(value) => `${Math.round(value)}%`} onValueChange={(value) => {
            dragVolumeRef.current = value;
            YMusicSyncStore.setVolume(value);
        }}/>
            </div>
        </div>);
}
