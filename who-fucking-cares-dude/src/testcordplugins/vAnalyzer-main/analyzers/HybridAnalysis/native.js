/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { createHash } from "crypto";
const BASE_URL = "https://hybrid-analysis.com/api/v2";
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
export async function hybridAnalysisSearchHash(_, apiKey, hash) {
    try {
        const res = await fetch(`${BASE_URL}/search/hash?hash=${encodeURIComponent(hash)}`, {
            headers: {
                "api-key": apiKey,
                "accept": "application/json"
            },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
        });
        if (!res.ok) {
            const body = await readCappedText(res).catch(() => "");
            return { status: res.status, data: { reports: [] }, error: `HTTP ${res.status}: ${body}` };
        }
        const data = await readCappedJson(res);
        const reports = Array.isArray(data.reports) ? data.reports : [];
        return { status: 200, data: { reports } };
    }
    catch (e) {
        return { status: -1, data: { reports: [] }, error: String(e) };
    }
}
export async function hybridAnalysisHashFile(_, fileUrl) {
    try {
        assertAllowedFileUrl(fileUrl);
        const fileResponse = await fetch(fileUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!fileResponse.ok)
            throw new Error(`Failed to fetch file: ${fileUrl}`);
        const buffer = await readCappedBuffer(fileResponse, MAX_FILE_BYTES);
        const sha256 = createHash("sha256").update(buffer).digest("hex");
        return { sha256 };
    }
    catch (e) {
        return { sha256: null, error: String(e) };
    }
}
export async function hybridAnalysisQuickScanUrl(_, apiKey, url) {
    try {
        const formData = new FormData();
        formData.append("scan_type", "all");
        formData.append("url", url);
        const res = await fetch(`${BASE_URL}/quick-scan/url`, {
            method: "POST",
            headers: {
                "api-key": apiKey,
                "accept": "application/json"
            },
            body: formData,
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
        });
        if (!res.ok) {
            const body = await readCappedText(res).catch(() => "");
            return { status: res.status, data: null, error: `HTTP ${res.status}: ${body}` };
        }
        const data = await readCappedJson(res);
        return { status: 200, data };
    }
    catch (e) {
        return { status: -1, data: null, error: String(e) };
    }
}
export async function hybridAnalysisGetScan(_, apiKey, scanId) {
    try {
        const res = await fetch(`${BASE_URL}/quick-scan/${encodeURIComponent(scanId)}`, {
            headers: {
                "api-key": apiKey,
                "accept": "application/json"
            },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
        });
        if (!res.ok) {
            const body = await readCappedText(res).catch(() => "");
            return { status: res.status, data: null, error: `HTTP ${res.status}: ${body}` };
        }
        const data = await readCappedJson(res);
        return { status: 200, data };
    }
    catch (e) {
        return { status: -1, data: null, error: String(e) };
    }
}
export async function hybridAnalysisQuickScanFile(_, apiKey, fileUrl, fileName) {
    try {
        assertAllowedFileUrl(fileUrl);
        const fileResponse = await fetch(fileUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!fileResponse.ok)
            throw new Error(`Failed to fetch file: ${fileUrl}`);
        const fileBuffer = await readCappedBuffer(fileResponse, MAX_FILE_BYTES);
        const fileBlob = new Blob([fileBuffer]);
        const file = new File([fileBlob], fileName || "uploaded-file", { type: fileBlob.type });
        const formData = new FormData();
        formData.append("scan_type", "all");
        formData.append("file", file);
        const res = await fetch(`${BASE_URL}/quick-scan/file`, {
            method: "POST",
            headers: {
                "api-key": apiKey,
                "accept": "application/json"
            },
            body: formData,
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
        });
        if (!res.ok) {
            const body = await readCappedText(res).catch(() => "");
            return { status: res.status, data: null, error: `HTTP ${res.status}: ${body}` };
        }
        const data = await readCappedJson(res);
        return { status: 200, data };
    }
    catch (e) {
        return { status: -1, data: null, error: String(e) };
    }
}
