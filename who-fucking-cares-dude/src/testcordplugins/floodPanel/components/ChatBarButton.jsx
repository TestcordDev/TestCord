/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { ChatBarButton } from "@api/ChatButtons";
import { openModal } from "@utils/modal";
import { useState } from "@webpack/common";
import { settings } from "..";
import { FloodModal } from "./FloodModal";
import { FloodIcon } from "./Icons";
export const FloodPanelButton = ({ isMainChat, channel }) => {
    const [isRunning, setIsRunning] = useState(false);
    if (!isMainChat || settings.store.location !== "chatbar")
        return null;
    function handleClick() {
        openModal(props => (<FloodModal channel={channel} rootProps={props} onRunningChange={setIsRunning}/>));
    }
    return (<ChatBarButton tooltip={isRunning ? "Flood en cours..." : "Flood Panel"} onClick={handleClick} buttonProps={{ "aria-haspopup": "dialog" }}>
            <FloodIcon color={isRunning ? "var(--status-danger)" : undefined}/>
        </ChatBarButton>);
};
