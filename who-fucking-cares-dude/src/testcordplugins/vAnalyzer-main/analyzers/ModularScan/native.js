/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
const FETCH_TIMEOUT_MS = 30_000;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
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
function assertAllowedTargetUrl(targetUrl) {
    const url = new URL(targetUrl);
    if (url.protocol === "https:")
        return;
    if (url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname))
        return;
    throw new Error("Target URL is not allowed.");
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
function replacePlaceholders(template, vars) {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
        result = result.replaceAll(`{{${key}}}`, value);
    }
    return result;
}
export async function executeModularScan(_, module, fileUrl, fileName) {
    try {
        const vars = {
            fileUrl,
            fileName,
            url: fileUrl,
        };
        const targetUrl = replacePlaceholders(module.url, vars);
        assertAllowedTargetUrl(targetUrl);
        const method = module.method.toUpperCase();
        if (!ALLOWED_METHODS.has(method))
            throw new Error("HTTP method is not allowed.");
        const headers = {};
        for (const [k, v] of Object.entries(module.headers)) {
            headers[replacePlaceholders(k, vars)] = replacePlaceholders(v, vars);
        }
        let body;
        if (module.bodyType === "multipart") {
            const formData = new FormData();
            if (module.type === "file" && module.fileField) {
                assertAllowedFileUrl(fileUrl);
                const fileResponse = await fetch(fileUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
                if (!fileResponse.ok)
                    throw new Error(`Failed to fetch file: ${fileUrl}`);
                const fileBuffer = await readCappedBuffer(fileResponse, MAX_FILE_BYTES);
                const fileBlob = new Blob([fileBuffer]);
                const file = new File([fileBlob], fileName || "file", { type: fileBlob.type });
                formData.append(module.fileField, file);
            }
            for (const [k, v] of Object.entries(module.extraFields)) {
                formData.append(replacePlaceholders(k, vars), replacePlaceholders(v, vars));
            }
            body = formData;
        }
        else if (module.bodyType === "json") {
            body = replacePlaceholders(module.jsonTemplate, vars);
            if (!headers["content-type"] && !headers["Content-Type"]) {
                headers["content-type"] = "application/json";
            }
        }
        const res = await fetch(targetUrl, {
            method,
            headers: module.bodyType === "multipart"
                ? Object.fromEntries(Object.entries(headers).filter(([k]) => k.toLowerCase() !== "content-type"))
                : headers,
            body,
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
        });
        const responseText = await readCappedText(res);
        let responseJson = null;
        try {
            responseJson = JSON.parse(responseText);
        }
        catch { }
        return {
            status: res.status,
            ok: res.ok,
            body: responseText,
            json: responseJson
        };
    }
    catch (e) {
        return { status: -1, ok: false, body: String(e), json: null };
    }
}
