/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import "./styles.css";
import { HeaderBarButton } from "@api/HeaderBar";
import definePlugin from "@utils/types";
import { React } from "@webpack/common";
import { toggleWordBombOverlay } from "./components/WordBombOverlay";
const TrophyIcon = (props) => (<svg width={props.width || 24} height={props.height || 24} viewBox="0 0 24 24" fill={props.color || "currentColor"} {...props}>
        <path d="M19 4H18V2.5C18 2.22386 17.7761 2 17.5 2H6.5C6.22386 2 6 2.22386 6 2.5V4H5C3.89543 4 3 4.89543 3 6V8.33333C3 10.158 4.32623 11.6661 6.0825 11.8845C6.44988 14.2372 8.51945 16 11 16H11.5V18.5H9C8.44772 18.5 8 18.9477 8 19.5V21C8 21.5523 8.44772 22 9 22H15C15.5523 22 16 21.5523 16 21V19.5C16 18.9477 15.5523 18.5 15 18.5H12.5V16H13C15.4805 16 17.5501 14.2372 17.9175 11.8845C19.6738 11.6661 21 10.158 21 8.33333V6C21 4.89543 20.1046 4 19 4ZM5 8.33333V6H6V10.1197C5.41908 9.94827 5 9.17646 5 8.33333ZM19 8.33333C19 9.17646 18.5809 9.94827 18 10.1197V6H19V8.33333Z"/>
    </svg>);
export default definePlugin({
    name: "WordBomb",
    description: "BombParty/WordBomb assistant with persistent overlay, integrated AI, and alphabet tracking.",
    tags: ["Fun", "Nightcord"],
    authors: [{ name: "Nightcord", id: 0n }],
    headerBarButton: {
        icon: TrophyIcon,
        render: () => (<HeaderBarButton icon={TrophyIcon} tooltip="WordBomb" onClick={() => toggleWordBombOverlay()}/>)
    },
    stop() {
        const container = document.getElementById("wordbomb-overlay-container");
        if (container) {
            toggleWordBombOverlay();
        }
    }
});
