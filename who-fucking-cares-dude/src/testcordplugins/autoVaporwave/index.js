/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { addMessagePreSendListener, removeMessagePreSendListener } from "@api/MessageEvents";
import definePlugin from "@utils/types";
function toFullwidth(text) {
    return text.replace(/[ -~]/g, c => c === " " ? "　" : String.fromCharCode(c.charCodeAt(0) + 0xFEE0));
}
export default definePlugin({
    name: "AutoVaporwave",
    description: "Turn every message you send into ｆｕｌｌｗｉｄｔｈ text automatically.",
    authors: [{ name: "Sharp", id: 0n }],
    start() {
        this.pre = addMessagePreSendListener((_, msg) => {
            if (msg.content)
                msg.content = toFullwidth(msg.content);
        });
    },
    stop() {
        removeMessagePreSendListener(this.pre);
    }
});
