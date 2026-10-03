/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { plugins } from "@api/PluginManager";
import { UserAreaButton, type UserAreaRenderProps } from "@api/UserArea";
import { ScreenshareIcon } from "@components/Icons";
import { openPluginModal } from "@components/settings";
import { EquicordDevs, TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";

import {
    getGoLiveStreamEnhanceSourceOption,
    getGoLiveStreamEnhanceSourceType,
    openGoLiveButtonContextMenu,
    renderGoLiveStreamEnhancePanel,
    syncGoLiveModalState,
} from "./components/GoLiveSettingsModal";
import { ViewerControls } from "./components/ViewerControls";
import { streamContextPatch, userContextPatch } from "./contextMenus";
import {
    installMicrophoneInterceptor,
    prepareMicrophoneConstraints,
    releaseMicrophoneStream,
    uninstallMicrophoneInterceptor,
    wrapMicrophoneStream
} from "./microphone";
import { streamEnhancerPatches } from "./patches";
import { streamEnhancerRuntime, streamEnhancerSettings } from "./settings";
import * as streamState from "./state";
import managedStyle from "./styles.css?managed";
import type { StreamParticipant } from "./types";
import { installOutgoingVideoFilterInterceptor, uninstallOutgoingVideoFilterInterceptor } from "./videoFilters";

export function StreamEnhancerButton({ iconForeground, hideTooltips, nameplate }: UserAreaRenderProps) {
    const { showPanelButton } = streamEnhancerSettings.use(["showPanelButton"]);
    if (!showPanelButton) return null;
    return <UserAreaButton
        icon={<ScreenshareIcon className={iconForeground} />}
        tooltipText={hideTooltips ? undefined : "Stream Enhancer"}
        aria-label="Stream Enhancer"
        plated={nameplate != null}
        onClick={() => openPluginModal(plugins.StreamEnhancer)}
    />;
}

const streamEnhancer = definePlugin({
    name: "StreamEnhancer",
    description: "Stream tuning, native camera previews, viewer controls, and optional spoofed stream badges. DavidHiFi fork.",
    authors: [EquicordDevs.omaw, TestcordDevs.DavidHiFi],
    requiresRestart: true,
    managedStyle,
    settings: streamEnhancerSettings,
    userAreaButton: { icon: ScreenshareIcon, render: StreamEnhancerButton },
    contextMenus: {
        "stream-context": streamContextPatch,
        "user-context": userContextPatch
    },
    patches: streamEnhancerPatches,
    start() {
        installMicrophoneInterceptor();
        installOutgoingVideoFilterInterceptor();
        streamState.startAutoWatch();
    },
    stop() {
        uninstallOutgoingVideoFilterInterceptor();
        uninstallMicrophoneInterceptor();
        streamState.stopStreamEnhancerState();
    },
    isMediaParticipant: streamState.isMediaParticipant,
    isStreamParticipant: streamState.isStreamParticipant,
    getGoLiveStreamEnhanceSourceOption,
    getGoLiveStreamEnhanceSourceType,
    openGoLiveButtonContextMenu,
    renderGoLiveStreamEnhancePanel,
    syncGoLiveModalState,
    renderViewerControls(participant: StreamParticipant, className?: string) {
        return <ViewerControls participant={participant} className={className} />;
    },
    renderZoomableCameraVideo: streamState.renderZoomableCameraVideo,
    getRenderedStreamTileStyle: streamState.getRenderedStreamTileStyle,
    getRenderedStreamFit: streamState.getRenderedStreamFit,
    getRenderedMediaWrapperClassName: streamState.getRenderedMediaWrapperClassName,
    getRenderedMediaWrapperStyle: streamState.getRenderedMediaWrapperStyle,
    getRenderedStreamVideoClassName: streamState.getRenderedStreamVideoClassName,
    mergeRenderedStreamVideoClassName: streamState.mergeRenderedStreamVideoClassName,
    getRenderedFrameStyle: streamState.getRenderedFrameStyle,
    getRenderedStreamVideoStyle: streamState.getRenderedStreamVideoStyle,
    getVideoFrameStyle: streamState.getVideoFrameStyle,
    getSelectedRootClassName: streamState.getSelectedRootClassName,
    useSelectedRootClassName: streamState.useSelectedRootClassName,
    getActionRowClassName: streamState.getActionRowClassName,
    getParticipantsWrapperClassName: streamState.getParticipantsWrapperClassName,
    getParticipantsWrapperStyle: streamState.getParticipantsWrapperStyle,
    getParticipantsListClassName: streamState.getParticipantsListClassName,
    getParticipantsTileClassName: streamState.getParticipantsTileClassName,
    getParticipantsItemClassName: streamState.getParticipantsItemClassName,
    getSelectedStreamContainerStyle: streamState.getSelectedStreamContainerStyle,
    getSelectedStreamItemStyle: streamState.getSelectedStreamItemStyle,
    getSelectedStreamWidth: streamState.getSelectedStreamWidth,
    getShowStreamParticipants: streamState.getShowStreamParticipants,
    useShowStreamParticipants: streamState.useShowStreamParticipants,
    getVideoGridTileStyle: streamState.getVideoGridTileStyle,
    setRenderedStreamBrightness: streamState.setRenderedStreamBrightness,
    setRenderedStreamScale: streamState.setRenderedStreamScale,
    getRenderedStreamScalePercent: streamState.getRenderedStreamScalePercent,
    minRenderedStreamScalePercent: streamState.minRenderedStreamScalePercent,
    maxRenderedStreamScalePercent: streamState.maxRenderedStreamScalePercent,
    applyStreamFitToDom: streamState.applyStreamFitToDom,
    applyStreamScaleToDom: streamState.applyStreamScaleToDom,
    setStreamFitAnchor: streamState.setStreamFitAnchor,
    setHideChannelList: streamState.setHideChannelList,
    shouldHideChannelList: streamState.shouldHideChannelList,
    useRenderedStreamVideoState: streamState.useRenderedStreamVideoState,
    useRenderedStreamScaleVersion: streamState.useRenderedStreamScaleVersion,
    useRenderedStreamWidth: streamState.useRenderedStreamWidth,
    useRenderedWidthFromProps: streamState.useRenderedWidthFromProps,
    prepareMicrophoneConstraints,
    wrapMicrophoneStream,
    releaseMicrophoneStream,
    ...streamEnhancerRuntime
});

export default streamEnhancer;

// Exposed for debugging from the Discord console: __vcStreamEnhancerFitDebug()
(globalThis as Record<string, unknown>).__vcStreamEnhancerFitDebug = streamState.debugStreamFitChain;
