/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { dialog } from "electron";

export async function evalCode(_, code: string) {
    const d = await dialog.showMessageBox({
        title: "Confirm code eval",
        message: "IF YOU DID NOT INITIATE THIS, PRESS NO. The following code will be ran in the NodeJS context, meaning it will have FULL access to your computer. Do you still want to continue?\n\n" + code,
        buttons: ["Yes", "No"],
        defaultId: 1,
        cancelId: 1
    });

    if (d.response === 1) throw "Cancelled by user";

    // lines 12 to 36 shamelessly stolen from codeberg.org/vee/bot
    const console: any = {
        _lines: [] as string[],
        _log(...things: string[]) {
            this._lines.push(
                ...things
                    .join(" ")
                    .split("\n")
            );
        }
    };
    console.log = console.error = console.warn = console.info = console._log.bind(console);

    const fs = require("fs");
    const http = require("http");
    const https = require("https");
    const crypto = require("crypto");
    const net = require("net");
    const path = require("path");
    const util = require("util");
    const assert = require("assert");
    const os = require("os");

    let script = code.replace(/(^`{3}(js|javascript)?|`{3}$)/g, "");
    if (script.includes("await")) script = `(async () => { ${script} })()`;

    try {
        var result = await (0, eval)(script);
    } catch (e: any) {
        var result = e;
    }

    return `${result}\n\n${console._lines.join("\n")}`;
}
