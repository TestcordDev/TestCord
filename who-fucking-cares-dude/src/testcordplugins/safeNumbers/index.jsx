/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { HeaderBarButton } from "@api/HeaderBar";
import { addMessagePreEditListener, addMessagePreSendListener, removeMessagePreEditListener, removeMessagePreSendListener } from "@api/MessageEvents";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
const DIGIT_MAP = {
    "0": "𝟶",
    "1": "𝟷",
    "2": "𝟸",
    "3": "𝟹",
    "4": "𝟺",
    "5": "𝟻",
    "6": "𝟼",
    "7": "𝟽",
    "8": "𝟾",
    "9": "𝟿",
};
function replaceDigits(content) {
    const parts = [];
    let lastIndex = 0;
    const combinedRegex = /<[^>]+>|https?:\/\/[^\s<>"{}|\\^`[\]]+/g;
    let match;
    while ((match = combinedRegex.exec(content)) !== null) {
        if (match.index > lastIndex) {
            parts.push(content.slice(lastIndex, match.index).replace(/\d/g, d => DIGIT_MAP[d] ?? d));
        }
        parts.push(match[0]);
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < content.length) {
        parts.push(content.slice(lastIndex).replace(/\d/g, d => DIGIT_MAP[d] ?? d));
    }
    return parts.join("");
}
const settings = definePluginSettings({
    isActive: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Toggle safe numbers replacement on or off.",
        default: true,
        hidden: true
    }
});
const preSend = (_, msg) => {
    if (settings.store.isActive) {
        msg.content = replaceDigits(msg.content);
    }
};
const preEdit = (_, __, msg) => {
    if (settings.store.isActive) {
        msg.content = replaceDigits(msg.content);
    }
};
function SafeNumbersIcon({ height = 20, width = 20, className, color = "currentColor" }) {
    return (<svg viewBox="0 0 24 24" width={width} height={height} className={className} aria-hidden="true">
            <path fill={color} d="M4 4h4v16H4V4zm6 0h4v16h-4V4zm6 0h4v16h-4V4z"/>
        </svg>);
}
function SafeNumbersButton() {
    const { isActive } = settings.use(["isActive"]);
    return (<HeaderBarButton icon={SafeNumbersIcon} tooltip={isActive ? "SafeNumbers: ON" : "SafeNumbers: OFF"} aria-label="Toggle SafeNumbers" selected={isActive} onClick={() => {
            settings.store.isActive = !settings.store.isActive;
        }}/>);
}
export default definePlugin({
    name: "SafeNumbers",
    description: "replace numbers in ur messages with a similiar math char shi so discord cant touch yo ass and ban for under. hope yall enjoy",
    tags: ["Privacy", "Chat"],
    authors: [TestcordDevs.x2b],
    dependencies: ["MessageEventsAPI", "HeaderBarAPI"],
    settings,
    headerBarButton: {
        icon: SafeNumbersIcon,
        render: SafeNumbersButton,
        priority: 1337
    },
    start() {
        addMessagePreSendListener(preSend);
        addMessagePreEditListener(preEdit);
    },
    stop() {
        removeMessagePreSendListener(preSend);
        removeMessagePreEditListener(preEdit);
    },
});
