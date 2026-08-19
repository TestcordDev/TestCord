/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { createHash } from "crypto";
const FETCH_TIMEOUT_MS = 30_000;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const ALLOWED_FILE_HOSTS = new Set([
    "cdn.discordapp.com",
    "media.discordapp.net",
    "cdn.discord.com",
    "media.discord.com"
]);
function assertAllowedFileUrl(fileUrl) {
    const url = new URL(fileUrl);
    if (url.protocol !== "https:" || !ALLOWED_FILE_HOSTS.has(url.hostname) || !url.pathname.startsWith("/attachments/")) {
        throw new Error("File URL is not allowed.");
    }
}
async function readCappedBuffer(response, maxBytes) {
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > maxBytes)
        throw new Error("Response was too large.");
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes)
        throw new Error("Response was too large.");
    return buffer;
}
async function readCappedText(response) {
    return (await readCappedBuffer(response, MAX_RESPONSE_BYTES)).toString("utf8");
}
async function readCappedJson(response) {
    return JSON.parse(await readCappedText(response));
}
function generateAntiAbuseHeader() {
    const inner = Buffer.from("dont be evil").toString("base64");
    const timestamp = Date.now() / 1000;
    return Buffer.from(`15520747703-${inner}-${timestamp}`).toString("base64");
}
export async function lookupVirusTotalFile(_, fileUrl) {
    try {
        assertAllowedFileUrl(fileUrl);
        const fileResponse = await fetch(fileUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!fileResponse.ok)
            throw new Error(`Failed to fetch file: ${fileUrl}`);
        const buffer = await readCappedBuffer(fileResponse, MAX_FILE_BYTES);
        const sha256 = createHash("sha256").update(buffer).digest("hex");
        const vtUrl = `https://www.virustotal.com/ui/files/${sha256}`;
        const res = await fetch(vtUrl, {
            headers: {
                "accept": "application/json",
                "accept-ianguage": "en-US,en;q=0.9",
                "accept-language": "en-US,en;q=0.9",
                "content-type": "application/json",
                "x-tool": "vt-ui-main",
                "x-app-version": "v1x554x2",
                "x-vt-anti-abuse-header": generateAntiAbuseHeader(),
                "referer": "https://www.virustotal.com/",
                "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"
            },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
        });
        if (!res.ok) {
            const errorBody = await readCappedText(res);
            return { status: res.status, data: null, sha256, errorBody };
        }
        const data = await readCappedJson(res);
        return { status: 200, data, sha256 };
    }
    catch (e) {
        return { status: -1, data: null, sha256: null, error: String(e) };
    }
}
export async function makeVirusTotalRequest(_, apiKey, fileUrl) {
    try {
        assertAllowedFileUrl(fileUrl);
        const fileResponse = await fetch(fileUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!fileResponse.ok)
            throw new Error(`Failed to fetch file: ${fileUrl}`);
        const fileBuffer = await readCappedBuffer(fileResponse, MAX_FILE_BYTES);
        const fileBlob = new Blob([fileBuffer]);
        const file = new File([fileBlob], "uploaded-file", { type: fileBlob.type });
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("https://www.virustotal.com/api/v3/files", {
            method: "POST",
            headers: { "x-apikey": apiKey },
            body: formData,
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
        });
        const data = await readCappedJson(res);
        return { status: res.status, data, analysisId: data?.data?.id };
    }
    catch (e) {
        return { status: -1, data: {}, error: String(e) };
    }
}
export async function getVirusTotalFileReport(_, apiKey, fileId) {
    try {
        const decodedString = Buffer.from(fileId, "base64").toString("utf-8");
        const md5 = decodedString.split(":")[0];
        const res = await fetch(`https://www.virustotal.com/api/v3/files/${encodeURIComponent(md5)}`, {
            headers: { "x-apikey": apiKey },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
        });
        if (!res.ok)
            throw new Error(`Failed to fetch file report: ${res.statusText}`);
        const data = await readCappedJson(res);
        return { status: res.status, data };
    }
    catch (e) {
        return { status: -1, data: {}, error: String(e) };
    }
}
