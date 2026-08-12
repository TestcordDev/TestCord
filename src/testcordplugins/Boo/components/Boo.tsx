/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { Message } from "@vencord/discord-types";
import { findByPropsLazy } from "@webpack";
import { MessageStore, React, useEffect, UserStore, useState,useStateFromStores } from "@webpack/common";

import { BooProps } from "../types";
import IconGhost from "./IconGhost";
import IconGhostOrange from "./IconGhost-Orange";

const ChannelWrapperStyles = findByPropsLazy("muted", "wrapper");

export default function Boo({ channel }: BooProps) {
    const { id } = channel;

    const currentUserId = useStateFromStores([UserStore], () => UserStore.getCurrentUser()?.id);
    const lastMessage: Message = useStateFromStores([MessageStore], () => MessageStore.getMessages(id)?.last());

    const [state, setState] = useState({
        isCurrentUser: null as boolean | null,
        containsQuestionMark: false,
        isDataProcessed: false,
    });

    useEffect(() => {
        if (!lastMessage || !currentUserId) return;

        const lastIsCurrentUser = lastMessage.author.id === currentUserId;
        const containsQuestionMark = !lastIsCurrentUser && lastMessage.content.includes("?");

        setState({
            isCurrentUser: lastIsCurrentUser,
            containsQuestionMark: containsQuestionMark,
            isDataProcessed: true,
        });
    }, [lastMessage, currentUserId]);

    if (!state.isDataProcessed || !currentUserId || !lastMessage) return null;

    return (
        !state.isCurrentUser && (
            <div className={ChannelWrapperStyles.wrapper}>
                {state.containsQuestionMark ? <IconGhostOrange /> : <IconGhost />}
            </div>
        )
    );
}
