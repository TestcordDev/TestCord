/* eslint-disable simple-header/header -- This standalone user plugin is MIT licensed. */
/*
 * ClickToUnmute, a Vencord/Equicord user plugin
 * Copyright (c) 2026 Kurtzon (Kurtzon Audio)
 * Copyright (c) 2026 DavidHiFi
 * SPDX-License-Identifier: MIT
 */

import definePlugin from "@utils/types";
import { User } from "@vencord/discord-types";
import { MediaEngineStore, React, showToast, Toasts, VoiceActions } from "@webpack/common";

export default definePlugin({
    name: "ClickToUnmute",
    description: "Click the mute icon next to a locally muted voice member to unmute them instantly, instead of right-click > Unmute.",
    authors: [{ name: "DavidHiFi", id: 1553713171938938891n }, { name: "Kurtzon Audio", id: 1552878708732469258n }],
    enabledByDefault: false,
    patches: [
        {
            find: ".VOICE_PANEL}}",
            replacement: [
                {
                    // Local edit: capture the row's user and localMute by name instead of
                    // hardcoding minified variables, which point elsewhere in this build.
                    match: /(?<=user:(\i),disconnected:.{0,900}?localMute:(\i).{0,500}?)children:(\i)(?=\},"mute"\)\))/,
                    replace: "children:$2?$self.renderClickable($1,$3):$3"
                }
            ]
        }
    ],
    renderClickable(user: User, icon: React.ReactNode) {
        return (
            <span style={{ cursor: "pointer" }} onClick={e => { e.stopPropagation(); this.unmuteLocally(user); }}>
                {icon}
            </span>
        );
    },
    unmuteLocally(user: User) {
        try {
            const id = user?.id;
            if (!id || !MediaEngineStore.isLocalMute(id)) return;

            VoiceActions.toggleLocalMute(id);
            showToast(`Unmuted ${user.globalName ?? user.username ?? "user"} locally.`, Toasts.Type.SUCCESS, {
                position: Toasts.Position.BOTTOM
            });
        } catch (e) {
            console.error("[ClickToUnmute] failed to unmute:", e);
        }
    }
});
