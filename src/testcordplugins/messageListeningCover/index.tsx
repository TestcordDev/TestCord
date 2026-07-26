/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 nin0
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { ActivityType } from "@vencord/discord-types/enums";
import { findComponentByCodeLazy } from "@webpack";
import { Popout, PresenceStore, useRef, UserStore, useStateFromStores } from "@webpack/common";

import type { MessageDecorationProps } from "../../api/MessageDecorations";

const ActivityCard = findComponentByCodeLazy(".USER_PROFILE_LIVE_ACTIVITY_CARD),{themeType:");

function ListeningCover({ message }: MessageDecorationProps) {
    const ref = useRef<HTMLDivElement>(null);
    // find, not filter: getActivities keeps the same objects until that user's presence
    // changes, so this stays reference-stable and the default identity check holds. A fresh
    // array never compared equal, so every row re-rendered on every presence emit.
    const activity = useStateFromStores([PresenceStore], () =>
        PresenceStore.getActivities(message.author.id)
            .find(a => a.type === ActivityType.LISTENING && a.assets?.large_image) ?? null,
        [message.author.id]
    );

    if (!activity) return null;

    const largeImage = activity.assets!.large_image!;
    const url = largeImage.startsWith("spotify:")
        ? largeImage.replace("spotify:", "https://i.scdn.co/image/")
        : largeImage.replace("mp:", "https://media.discordapp.net/");

    return <Popout
        position="top"
        renderPopout={() => <div style={{ width: 267, height: 110 }}>
            <ActivityCard activity={activity} currentUser={UserStore.getCurrentUser()} user={message.author} />
        </div>}
        targetElementRef={ref}
    >
        {popoutProps => <div ref={ref} style={{ width: 20, height: 20 }} {...popoutProps}>
            <img src={url} style={{ width: 20, height: 20, borderRadius: 3 }} />
        </div>}
    </Popout>;
}

export default definePlugin({
    name: "MessageListeningCover",
    description: "Shows listened-to album covers next to messages",
    tags: ["Chat", "Privacy"],
    authors: [Devs.nin0dev],
    renderMessageDecoration: props => {
        const me = UserStore.getCurrentUser()?.id;
        // Only show for other users' messages (not our own)
        if (!me || props.message.author.id === me) return null;
        return <ListeningCover {...props} />;
    }
});
