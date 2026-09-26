/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { debounce } from "@shared/debounce";
import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { ColorPicker, ContextMenuApi, Menu, Tooltip, useEffect, useRef, useStateFromStores } from "@webpack/common";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactElement } from "react";

import { shouldShowViewerResizeSlider } from "../settings";
import * as streamState from "../state";
import type { StreamFitMode, StreamParticipant } from "../types";

const cl = classNameFactory("vc-stream-enhancer-");

function SettingsArrowIcon({ className, height = 16, width = 16 }: { className?: string; height?: number; width?: number; }) {
    return (
        <svg className={className} height={height} width={width} viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M12 2.5 7.5 7h3v5h3V7h3L12 2.5Zm-7 11h14v2H5v-2Zm0 4h14v2H5v-2Z" />
        </svg>
    );
}

const runViewerAction = (event: ReactKeyboardEvent<HTMLDivElement>, action: () => void) => {
    if (event.key !== "Enter" && event.key !== " ") return;

    event.preventDefault();
    action();
};

const renderViewerActionButton = (
    content: string | ReactElement,
    text: string,
    action: () => void,
    disabled?: boolean
) => (
    <Tooltip text={text}>
        {tooltipProps => (
            <div
                {...tooltipProps}
                aria-label={text}
                aria-disabled={disabled}
                className={classes(cl("viewer-action-button"), (content === "+" || content === "-") && cl("viewer-action-button-symbol"), disabled && cl("viewer-action-button-disabled"))}
                role="button"
                tabIndex={disabled ? -1 : 0}
                onClick={disabled ? undefined : action}
                onKeyDown={disabled ? undefined : event => runViewerAction(event, action)}
            >
                {content}
            </div>
        )}
    </Tooltip>
);

const streamFitOptions = [
    ["contain", "Contain"],
    ["cover", "Cover"],
    ["stretch", "Stretch"]
] as const satisfies ReadonlyArray<readonly [StreamFitMode, string]>;

const menuSliderDebounceMs = 75;

function StreamFitMenu({ participant }: { participant: StreamParticipant; }) {
    const participantRef = useRef(participant);
    const debouncedWidthChangeRef = useRef<((value: number) => void) | undefined>(undefined);
    const debouncedHeightChangeRef = useRef<((value: number) => void) | undefined>(undefined);
    const selectedFit = useStateFromStores([streamState.renderedStreamScaleStore], () => streamState.getRenderedStreamFitMode(participant.id), [participant.id]);
    const hideChannelList = useStateFromStores([streamState.renderedStreamScaleStore], streamState.shouldHideChannelList);
    const hideBottomParticipants = useStateFromStores([streamState.renderedStreamScaleStore], streamState.shouldHideBottomStreamParticipants);
    const bottomRowOpacity = useStateFromStores([streamState.renderedStreamScaleStore], streamState.getBottomRowOpacity);
    const hideControlsUntilHover = useStateFromStores([streamState.renderedStreamScaleStore], streamState.shouldHideControlsUntilHover);
    const autoWatchAllStreamsOnJoin = useStateFromStores([streamState.renderedStreamScaleStore], streamState.isAutoWatchAllStreamsOnJoinEnabled);
    const scalePercent = useStateFromStores([streamState.renderedStreamScaleStore], () => streamState.getRenderedStreamScalePercent(participant.id), [participant.id]);
    const videoWidthPercent = useStateFromStores([streamState.renderedStreamScaleStore], () => streamState.getRenderedVideoWidthPercent(participant.id), [participant.id]);
    const videoHeightPercent = useStateFromStores([streamState.renderedStreamScaleStore], () => streamState.getRenderedVideoHeightPercent(participant.id), [participant.id]);
    const videoTintEnabled = useStateFromStores([streamState.renderedStreamScaleStore], () => streamState.isRenderedVideoTintEnabled(participant.id), [participant.id]);
    const videoTintColor = useStateFromStores([streamState.renderedStreamScaleStore], () => streamState.getRenderedVideoTintColor(participant.id), [participant.id]);
    const brightness = useStateFromStores([streamState.renderedStreamScaleStore], () => streamState.getRenderedStreamBrightnessPercent(participant.id), [participant.id]);
    const contrast = useStateFromStores([streamState.renderedStreamScaleStore], () => streamState.getRenderedStreamContrastPercent(participant.id), [participant.id]);
    const saturation = useStateFromStores([streamState.renderedStreamScaleStore], () => streamState.getRenderedStreamSaturationPercent(participant.id), [participant.id]);
    const hue = useStateFromStores([streamState.renderedStreamScaleStore], () => streamState.getRenderedStreamHueDegrees(participant.id), [participant.id]);
    const enhanceImage = useStateFromStores([streamState.renderedStreamScaleStore], () => streamState.isRenderedStreamEnhanceImageEnabled(participant.id), [participant.id]);
    const showResizeSlider = shouldShowViewerResizeSlider();

    if (debouncedWidthChangeRef.current == null) debouncedWidthChangeRef.current = debounce((value: number) => streamState.setRenderedVideoWidth(participantRef.current, value), menuSliderDebounceMs);
    if (debouncedHeightChangeRef.current == null) debouncedHeightChangeRef.current = debounce((value: number) => streamState.setRenderedVideoHeight(participantRef.current, value), menuSliderDebounceMs);

    useEffect(() => {
        participantRef.current = participant;
    }, [participant]);

    return (
        <Menu.Menu navId="stream-enhancer-fit-mode" onClose={ContextMenuApi.closeContextMenu} aria-label="Stream fit mode">
            {streamFitOptions.map(([value, label]) => (
                <Menu.MenuRadioItem
                    key={value}
                    id={`stream-enhancer-fit-${value}`}
                    group="stream-enhancer-fit-mode"
                    label={label}
                    checked={selectedFit === value}
                    action={() => streamState.setRenderedStreamFit(participant, value)}
                />
            ))}
            <Menu.MenuSeparator />
            <Menu.MenuItem id="stream-enhancer-video-settings" label="Video Settings" action={() => { }}>
                <>
                    <Menu.MenuCheckboxItem
                        id="stream-enhancer-video-enhance-image"
                        label="Enhance image"
                        checked={enhanceImage}
                        action={() => streamState.setRenderedStreamEnhanceImage(participant, !enhanceImage)}
                    />
                    <Menu.MenuCheckboxItem
                        id="stream-enhancer-video-tint-enabled"
                        label="Color tint"
                        checked={videoTintEnabled}
                        action={() => streamState.setRenderedVideoTintEnabled(participant, !videoTintEnabled)}
                    />
                    {videoTintEnabled && (
                        <Menu.MenuControlItem
                            id="stream-enhancer-video-tint-color"
                            label="Tint color"
                            control={() => (
                                <div className={cl("menu-color-picker")}>
                                    <ColorPicker
                                        color={videoTintColor}
                                        onChange={(value: number) => streamState.setRenderedVideoTintColor(participant, value)}
                                        showEyeDropper={false}
                                    />
                                </div>
                            )}
                        />
                    )}
                    <Menu.MenuControlItem
                        id="stream-enhancer-video-brightness"
                        label="Brightness"
                        control={(props, ref) => (
                            <Menu.MenuSliderControl
                                ref={ref}
                                {...props}
                                minValue={25}
                                maxValue={200}
                                value={brightness}
                                onChange={(value: number) => streamState.setRenderedStreamBrightness(participant, value)}
                                renderValue={(value: number) => `${value.toFixed(0)}%`}
                            />
                        )}
                    />
                    <Menu.MenuControlItem
                        id="stream-enhancer-video-contrast"
                        label="Contrast"
                        control={(props, ref) => (
                            <Menu.MenuSliderControl
                                ref={ref}
                                {...props}
                                minValue={25}
                                maxValue={200}
                                value={contrast}
                                onChange={(value: number) => streamState.setRenderedStreamContrast(participant, value)}
                                renderValue={(value: number) => `${value.toFixed(0)}%`}
                            />
                        )}
                    />
                    <Menu.MenuControlItem
                        id="stream-enhancer-video-saturation"
                        label="Saturation"
                        control={(props, ref) => (
                            <Menu.MenuSliderControl
                                ref={ref}
                                {...props}
                                minValue={0}
                                maxValue={200}
                                value={saturation}
                                onChange={(value: number) => streamState.setRenderedStreamSaturation(participant, value)}
                                renderValue={(value: number) => `${value.toFixed(0)}%`}
                            />
                        )}
                    />
                    <Menu.MenuControlItem
                        id="stream-enhancer-video-hue"
                        label="Hue"
                        control={(props, ref) => (
                            <Menu.MenuSliderControl
                                ref={ref}
                                {...props}
                                minValue={-180}
                                maxValue={180}
                                value={hue}
                                onChange={(value: number) => streamState.setRenderedStreamHue(participant, value)}
                                renderValue={(value: number) => `${value.toFixed(0)}deg`}
                            />
                        )}
                    />
                </>
            </Menu.MenuItem>
            <Menu.MenuCheckboxItem
                id="stream-enhancer-hide-channel-list"
                label="Hide channel list"
                checked={hideChannelList}
                action={() => streamState.setHideChannelList(!hideChannelList)}
            />
            <Menu.MenuCheckboxItem
                id="stream-enhancer-hide-bottom-row"
                label="Hide bottom row"
                checked={hideBottomParticipants}
                action={() => streamState.setHideBottomStreamParticipants(!hideBottomParticipants)}
            />
            <Menu.MenuControlItem
                id="stream-enhancer-bottom-row-opacity"
                label="Bottom row transparency"
                control={(props, ref) => (
                    <Menu.MenuSliderControl
                        ref={ref}
                        {...props}
                        minValue={streamState.minBottomRowOpacityPercent}
                        maxValue={streamState.maxBottomRowOpacityPercent}
                        value={bottomRowOpacity}
                        onChange={streamState.setBottomRowOpacity}
                        renderValue={(value: number) => `${value.toFixed(0)}%`}
                    />
                )}
            />
            <Menu.MenuCheckboxItem
                id="stream-enhancer-hide-controls-until-hover"
                label="Hide controls until hover"
                checked={hideControlsUntilHover}
                action={() => streamState.setHideControlsUntilHover(!hideControlsUntilHover)}
            />
            <Menu.MenuCheckboxItem
                id="stream-enhancer-auto-watch-all-streams-on-join"
                label="Auto watch streams on join"
                checked={autoWatchAllStreamsOnJoin}
                action={() => streamState.setAutoWatchAllStreamsOnJoinEnabled(!autoWatchAllStreamsOnJoin)}
            />
            {showResizeSlider && (
                <Menu.MenuControlItem
                    id="stream-enhancer-video-size"
                    label="Video size"
                    control={(props, ref) => (
                        <Menu.MenuSliderControl
                            ref={ref}
                            {...props}
                            minValue={streamState.minRenderedStreamScalePercent}
                            maxValue={streamState.maxRenderedStreamScalePercent}
                            value={scalePercent}
                            onChange={(value: number) => streamState.setRenderedStreamScale(participant, value / 100)}
                            renderValue={(value: number) => `${value.toFixed(0)}%`}
                        />
                        )}
                />
            )}
            <Menu.MenuControlItem
                id="stream-enhancer-video-width"
                label="Video width"
                control={(props, ref) => (
                    <Menu.MenuSliderControl
                        ref={ref}
                        {...props}
                        minValue={streamState.minRenderedVideoSizePercent}
                        maxValue={streamState.maxRenderedVideoSizePercent}
                        value={videoWidthPercent}
                        onChange={debouncedWidthChangeRef.current}
                        renderValue={(value: number) => `${value.toFixed(0)}%`}
                    />
                )}
            />
            <Menu.MenuControlItem
                id="stream-enhancer-video-height"
                label="Video height"
                control={(props, ref) => (
                    <Menu.MenuSliderControl
                        ref={ref}
                        {...props}
                        minValue={streamState.minRenderedVideoSizePercent}
                        maxValue={streamState.maxRenderedVideoSizePercent}
                        value={videoHeightPercent}
                        onChange={debouncedHeightChangeRef.current}
                        renderValue={(value: number) => `${value.toFixed(0)}%`}
                    />
                )}
            />
            <Menu.MenuSeparator />
            <Menu.MenuItem
                id="stream-enhancer-reset"
                className={cl("menu-reset")}
                label="Reset"
                action={() => streamState.resetRenderedStreamMenuState(participant)}
            />
        </Menu.Menu>
    );
}

const openRenderedStreamFitMenu = (event: ReactMouseEvent<HTMLDivElement>, participant: StreamParticipant) => {
    ContextMenuApi.openContextMenu(event, () => <StreamFitMenu participant={participant} />);
};

export function ViewerControls({ participant, className }: { participant: StreamParticipant; className?: string; }) {
    const canPopout = streamState.isStreamParticipant(participant);
    const mediaLabel = streamState.getParticipantMediaLabel(participant);
    const fitMode = useStateFromStores([streamState.renderedStreamScaleStore], () => streamState.getRenderedStreamFitMode(participant.id), [participant.id]);
    const scalePercent = useStateFromStores([streamState.renderedStreamScaleStore], () => streamState.getRenderedStreamScalePercent(participant.id), [participant.id]);
    const fitButtonRef = useRef<HTMLDivElement>(null);
    // The +/- buttons used to be hard-disabled in "contain" mode, which is the default,
    // so they appeared completely dead. They now work in every fit mode.
    // Each direction gets its own limit check: a single shared flag meant that reaching
    // either bound (e.g. 200%) disabled *both* buttons and left the user stuck.
    const minScalePercent = streamState.minRenderedStreamScalePercent;
    const maxScalePercent = streamState.maxRenderedStreamScalePercent;
    const decreaseDisabled = scalePercent <= minScalePercent;
    const increaseDisabled = scalePercent >= maxScalePercent;
    const decreaseTooltip = decreaseDisabled ? `Minimum size reached (${minScalePercent}%)` : null;
    const increaseTooltip = increaseDisabled ? `Maximum size reached (${maxScalePercent}%)` : null;

    useEffect(() => () => {
        if (streamState.shouldHideChannelList()) streamState.setHideChannelList(false);
    }, [participant.id]);

    // Anchor the direct-DOM fit/scale handling to this button and re-apply the current
    // values whenever they change, so contain/cover/stretch and +/- always take effect.
    useEffect(() => {
        streamState.setStreamFitAnchor(participant.id, fitButtonRef.current);
        streamState.applyStreamFitToDom(participant.id);
        streamState.applyStreamScaleToDom(participant.id);

        return () => streamState.setStreamFitAnchor(participant.id, null);
    }, [participant.id, fitMode, scalePercent]);

    return (
        <div className={cl("viewer-actions")}>
            {renderViewerActionButton("-", decreaseTooltip ?? `Make ${mediaLabel} smaller`, () => streamState.resizeRenderedStream(participant, -streamState.renderedStreamScaleStep), decreaseDisabled)}
            {renderViewerActionButton("+", increaseTooltip ?? `Make ${mediaLabel} larger`, () => streamState.resizeRenderedStream(participant, streamState.renderedStreamScaleStep), increaseDisabled)}
            <Tooltip text={`${mediaLabel === "stream" ? "Stream" : "Camera"} fit`}>
                {tooltipProps => (
                    <div
                        {...tooltipProps}
                        ref={fitButtonRef}
                        aria-label={`${mediaLabel === "stream" ? "Stream" : "Camera"} fit`}
                        className={classes(cl("viewer-action-button"), cl("viewer-action-button-icon"), className)}
                        role="button"
                        tabIndex={0}
                        onClick={event => openRenderedStreamFitMenu(event, participant)}
                    >
                        <SettingsArrowIcon className={cl("viewer-action-icon")} height={16} width={16} />
                    </div>
                )}
            </Tooltip>
            {canPopout && renderViewerActionButton("[]", "Popout stream", () => void streamState.openFullscreenParticipant(participant))}
        </div>
    );
}
