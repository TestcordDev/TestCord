/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { RendererSettings } from "@main/settings";
import { randomBytes } from "crypto";
import { app, Notification } from "electron";
import { createServer, Server } from "net";

let server: Server;
const settings = RendererSettings.store.plugins?.Socket;

let port = settings?.port || 3009;
let host = settings?.host || "127.0.0.1";
let allowUnauthedLocalConnections = settings?.allowUnauthedLocalConnections || false;
let password: string = settings?.password || "";

function limitString(str, maxLength = 1999) {
    return str.length > maxLength ? str.slice(0, maxLength) : str;
}

app.on("browser-window-created", (_, win) => {
    server = createServer(socket => {
        new Notification({
            title: "Socket: New client",
            body: `${socket.remoteAddress} connected`,
            silent: true
        }).show();

        let authed = false;
        if (allowUnauthedLocalConnections && ["127.0.0.1", "::1"].includes(socket.remoteAddress!)) authed = true;

        socket.on("data", data => {
            const msg = data.toString("utf-8").trim();

            if (!authed) {
                if (msg === password) {
                    authed = true; socket.write("authed\n"); new Notification({
                        title: "Socket: Client authed",
                        body: `${socket.remoteAddress} is authenticated and can now send messages`,
                        silent: true
                    }).show();
                }
                else socket.destroy();
                return;
            }

            win.webContents.executeJavaScript(`Vencord.Plugins.plugins.Socket.sendMsg(
                ${JSON.stringify(limitString(data.toString("utf-8").trim()))}
            )`);
        });
        socket.on("close", () => {
            new Notification({
                title: "Socket: Disconnected",
                body: `${socket.remoteAddress} disconnected`,
                silent: true
            }).show();
        });
    });

    try {
        if (settings?.enabled) startServer();
    }
    catch (e) {
        console.error(e);
    }
});

export function startServer() {
    const settingss = RendererSettings.store.plugins?.Socket;
    port = settingss?.port || 3009;
    host = settingss?.host || "127.0.0.1";
    allowUnauthedLocalConnections = settingss?.allowUnauthedLocalConnections || false;
    password = settingss?.password || "";

    if (!server.listening) {
        let generated: string | null = null;
        if (!password) {
            generated = password = randomBytes(16).toString("hex");
        }

        try {
            server.listen(port, host, () => {
                new Notification({
                    title: "Socket: Server started",
                    body: generated
                        ? `Listening on ${host}:${port}. No password was set, so this session password was generated: ${generated}`
                        : `Listening on ${host}:${port}`,
                    silent: true
                }).show();
                if (generated) console.log(`[Socket] Generated session password: ${generated}`);
            });
        }
        catch { }
    }
}
export function stopServer() {
    if (server.listening) server.close();
}
