/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { cl } from "@equicordplugins/songSpotlight.desktop/lib/utils";
import { AppleMusicIcon, SoundcloudIcon, SpotifyIcon, TidalIcon } from "@equicordplugins/songSpotlight.desktop/ui/common";
import { getServiceLabel } from "@song-spotlight/api/util";
import { Tooltip, useMemo } from "@webpack/common";
const serviceIcons = {
    applemusic: AppleMusicIcon,
    soundcloud: SoundcloudIcon,
    spotify: SpotifyIcon,
    tidal: TidalIcon,
};
export default function ServiceIcon({ service, width, height, ...props }) {
    const Icon = useMemo(() => serviceIcons[service], [service]);
    const label = useMemo(() => getServiceLabel(service), [service]);
    return Icon && label && (<Tooltip text={label}>
            {tooltipProps => (<Icon {...tooltipProps} {...props} className={cl("icon")} width={width ?? 20} height={height ?? 20}/>)}
        </Tooltip>);
}
