/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { createSocket } from "dgram";
let xsoSocket = null;
export function sendToOverlay(_, data) {
    data.messageType = data.type;
    const json = JSON.stringify(data);
    xsoSocket ??= createSocket("udp4");
    xsoSocket.send(json, 42069, "127.0.0.1");
}
export function closeSocket() {
    xsoSocket?.close();
    xsoSocket = null;
}
