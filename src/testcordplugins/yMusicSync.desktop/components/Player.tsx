/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { plugins } from "@api/PluginManager";
import { BaseText } from "@components/BaseText";
import { CogWheel, ScreenshareIcon } from "@components/Icons";
import { openPluginModal } from "@components/settings/tabs/plugins/PluginModal";
import { ContextMenuApi, Menu, useStateFromStores } from "@webpack/common";

import { ICONS, TEXT } from "../constants";
import { cl } from "../css";
import { settings } from "../settings";
import { YMusicSyncStore } from "../store";
import type { PlayerDevice } from "../types";
import { IconButton, PanelButton, ProgressSlider, VolumeSlider } from "./Controls";
import { TrackCover } from "./TrackCover";

const SETTING_KEYS = ["showPanel", "showVolume", "showSettingsButton"] satisfies Array<keyof typeof settings.store>;
const NO_DEVICES: PlayerDevice[] = [];

function openSettings(): void {
    const plugin = plugins.YMusicSync;
    if (plugin) openPluginModal(plugin);
}

function DeviceMenu() {
    const snapshot = useStateFromStores([YMusicSyncStore], () => YMusicSyncStore.snapshot);
    const devices = snapshot?.devices ?? NO_DEVICES;
    const activeId = snapshot?.activeDeviceId ?? "";

    return (
        <Menu.Menu navId="vc-ymsync-devices" onClose={ContextMenuApi.closeContextMenu} aria-label={TEXT.devices}>
            <Menu.MenuGroup label={TEXT.devices}>
                {devices.length === 0
                    ? <Menu.MenuItem id="vc-ymsync-no-devices" label={TEXT.noDevices} disabled />
                    : devices.map(device => (
                        <Menu.MenuRadioItem
                            key={device.id}
                            id={`vc-ymsync-device-${device.id}`}
                            group="vc-ymsync-device"
                            label={device.title || TEXT.unknownDevice}
                            checked={device.id === activeId}
                            disabled={!device.canBePlayer}
                            action={() => YMusicSyncStore.setActiveDevice(device.id)}
                        />
                    ))}
            </Menu.MenuGroup>
        </Menu.Menu>
    );
}

export function YMusicSyncPlayer() {
    const { showPanel, showVolume, showSettingsButton } = settings.use(SETTING_KEYS);
    const { snapshot, hidden, hasPlayed } = useStateFromStores(
        [YMusicSyncStore],
        () => ({
            snapshot: YMusicSyncStore.snapshot,
            hidden: YMusicSyncStore.hiddenByPause,
            hasPlayed: YMusicSyncStore.hasPlayed
        }),
        undefined,
        (a, b) => a.snapshot === b.snapshot && a.hidden === b.hidden && a.hasPlayed === b.hasPlayed
    );

    if (!showPanel || !snapshot?.trackId || !hasPlayed || hidden) return null;

    const target = snapshot.devices.find(device => device.id === snapshot.activeDeviceId);
    const idle = !snapshot.activeDeviceId || (target !== undefined && !target.canBePlayer);

    return (
        <section className={cl("root")} aria-label={TEXT.playerLabel}>
            <div className={cl("head")}>
                <TrackCover coverUrl={snapshot.coverUrl} title={snapshot.title} />
                <div className={cl("meta")}>
                    <BaseText size="sm" weight="semibold" color="text-strong" className={cl("line")}>
                        {snapshot.title}
                    </BaseText>
                    <BaseText size="xs" color="text-subtle" className={cl("line")}>
                        {idle ? TEXT.noActiveDevice : snapshot.artists || snapshot.album || snapshot.activeDeviceName}
                    </BaseText>
                </div>
                <PanelButton
                    label={snapshot.activeDeviceName || TEXT.unknownDevice}
                    onClick={event => ContextMenuApi.openContextMenu(event, () => <DeviceMenu />)}
                >
                    <ScreenshareIcon className={cl("icon")} />
                </PanelButton>
                {showSettingsButton && (
                    <PanelButton label={TEXT.settings} onClick={openSettings}>
                        <CogWheel className={cl("icon")} />
                    </PanelButton>
                )}
            </div>

            <ProgressSlider snapshot={snapshot} disabled={idle} />

            <div className={cl("controls")}>
                <IconButton
                    label={TEXT.shuffle}
                    path={ICONS.shuffle}
                    active={snapshot.shuffle}
                    onClick={() => YMusicSyncStore.toggleShuffle()}
                    disabled={idle}
                />
                <IconButton
                    label={TEXT.previousTrack}
                    path={ICONS.previous}
                    onClick={() => YMusicSyncStore.previous()}
                    disabled={idle}
                />
                <IconButton
                    label={snapshot.isPlaying ? TEXT.pause : TEXT.play}
                    path={snapshot.isPlaying ? ICONS.pause : ICONS.play}
                    primary
                    onClick={() => YMusicSyncStore.playPause()}
                    disabled={idle}
                />
                <IconButton
                    label={TEXT.nextTrack}
                    path={ICONS.next}
                    onClick={() => YMusicSyncStore.next()}
                    disabled={idle}
                />
                <IconButton
                    label={`${TEXT.repeat}: ${TEXT.repeatModes[snapshot.repeat]}`}
                    path={snapshot.repeat === "one" ? ICONS.repeatOne : ICONS.repeat}
                    active={snapshot.repeat !== "off"}
                    onClick={() => YMusicSyncStore.cycleRepeat()}
                    disabled={idle}
                />
            </div>

            {showVolume && <VolumeSlider snapshot={snapshot} disabled={idle} />}
        </section>
    );
}
