/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
const { spawn } = require("child_process");
export async function getUname() {
    return new Promise((resolve, reject) => {
        const proc = spawn("uname", ["-a"]);
        let output = "";
        proc.stdout.on("data", data => {
            output += data.toString();
        });
        proc.stderr.on("data", data => {
            reject(data.toString());
        });
        proc.on("close", code => {
            if (code !== 0) {
                reject("it didnt work lol");
            }
            else {
                resolve(output.trim());
            }
        });
    });
}
