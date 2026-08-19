/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { BaseOBSWebSocket } from "./base.js";
export { OBSWebSocketError } from "./base.js";
export * from "./types.js";
export class OBSWebSocket extends BaseOBSWebSocket {
    protocol = "obswebsocket.json";
    async encodeMessage(data) {
        return JSON.stringify(data);
    }
    async decodeMessage(data) {
        return JSON.parse(data);
    }
}
export default OBSWebSocket;
