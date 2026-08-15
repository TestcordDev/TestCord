/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import "./checkNodeVersion.js";

import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { Readable } from "stream";
import { finished } from "stream/promises";
import { fileURLToPath } from "url";

const BASE_URL = "https://github.com/TestcordDev/TestCord/releases/latest/download/";
const RELEASE_API = "https://api.github.com/repos/TestcordDev/TestCord/releases/tags/latest";
const USER_AGENT = "TestCord (https://github.com/TestcordDev/TestCord)";

const BASE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE_DIR = join(BASE_DIR, "dist", "Installer");
const ETAG_FILE = join(FILE_DIR, "etag.txt");

function getFilename() {
    switch (process.platform) {
        case "win32":
            return "Windows_Testcord_installer-rel_cli.exe";
        case "linux":
            return "Linux_Testcord_installer-rel_cli";
        default:
            throw new Error(
                `No TestCord installer exists for ${process.platform}. ` +
                "Use the GoofCord method (see GoofCordGuide.md) or build the installer from https://github.com/TestcordDev/Testcordinstaller"
            );
    }
}

async function fetchAssetDigest(filename) {
    const res = await fetch(RELEASE_API, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) throw new Error(`Failed to fetch release metadata: ${res.status} ${res.statusText}`);

    const assets = (await res.json()).assets ?? [];
    const digest = assets.find(asset => asset.name === filename)?.digest;
    if (typeof digest !== "string" || !digest.startsWith("sha256:"))
        throw new Error(`Release has no sha256 digest for ${filename}, refusing to run an unverifiable binary`);

    return digest.slice("sha256:".length);
}

async function ensureBinary() {
    const filename = getFilename();
    console.log("Downloading " + filename);

    mkdirSync(FILE_DIR, { recursive: true });
    const outputFile = join(FILE_DIR, filename);

    const etag = existsSync(outputFile) && existsSync(ETAG_FILE)
        ? readFileSync(ETAG_FILE, "utf-8")
        : null;

    const res = await fetch(BASE_URL + filename, {
        headers: {
            "User-Agent": USER_AGENT,
            "If-None-Match": etag
        }
    });

    if (res.status === 304) {
        console.log("Up to date, not redownloading!");
        return outputFile;
    }
    if (!res.ok)
        throw new Error(`Failed to download installer: ${res.status} ${res.statusText}`);

    // WHY DOES NODE FETCH RETURN A WEB STREAM OH MY GOD
    const body = Readable.fromWeb(res.body);
    await finished(body.pipe(createWriteStream(outputFile, {
        mode: 0o755,
        autoClose: true
    })));

    console.log("Verifying checksum...");
    const expected = await fetchAssetDigest(filename);
    const actual = createHash("sha256").update(readFileSync(outputFile)).digest("hex");
    if (actual !== expected) {
        rmSync(outputFile);
        throw new Error(`Checksum mismatch for ${filename} (expected ${expected}, got ${actual}). Not running it - try again.`);
    }

    // Only cache the etag once the file has actually been verified
    writeFileSync(ETAG_FILE, res.headers.get("etag"));

    console.log("Finished downloading!");

    return outputFile;
}

const installerBin = await ensureBinary();

console.log("Now running Installer...");

const argStart = process.argv.indexOf("--");
const args = argStart === -1 ? [] : process.argv.slice(argStart + 1);

try {
    execFileSync(installerBin, args, {
        stdio: "inherit",
        env: {
            ...process.env,
            EQUICORD_USER_DATA_DIR: BASE_DIR,
            EQUICORD_DIRECTORY: join(BASE_DIR, "dist/desktop"),
            EQUICORD_DEV_INSTALL: "1"
        }
    });
} catch {
    console.error("Something went wrong. Please check the logs above.");
}
