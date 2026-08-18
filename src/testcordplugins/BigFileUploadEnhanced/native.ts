/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { assertSafeUrl } from "@main/utils/safeFetch";
import { net } from "electron";

type GofileServersResponse = {
    status?: string;
    data?: {
        servers?: Array<{ name?: string; }>;
    };
};

const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;

function formatFetchError(err: unknown) {
    if (err instanceof Error) {
        const { cause } = (err as any);
        const causeStr = cause
            ? (cause instanceof Error ? cause.message : String(cause))
            : "";
        return `${err.name}: ${err.message}${causeStr ? ` (cause: ${causeStr})` : ""}`;
    }
    return String(err);
}

async function safeFetch(url: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
    const requestInit = { ...init, signal: controller.signal };
    try {
        // Prefer Electron's network stack (proxy / cert store etc.)
        return await net.fetch(url, requestInit);
    } catch (errNet) {
        try {
            // Fallback to Node's fetch if net.fetch fails for some reason.
            return await fetch(url, requestInit);
        } catch (errNode) {
            throw new Error(`fetch failed for ${url}: ${formatFetchError(errNet)} | ${formatFetchError(errNode)}`);
        }
    } finally {
        clearTimeout(timeout);
    }
}

function isHttpUrl(input: string) {
    try {
        const url = new URL(input);
        return url.protocol === "http:" || url.protocol === "https:";
    } catch {
        return false;
    }
}

async function pickGofileServer(): Promise<string> {
    try {
        const res = await safeFetch("https://api.gofile.io/servers");
        const json = (await res.json()) as GofileServersResponse;

        const servers = json?.data?.servers?.map(s => s?.name).filter(Boolean) as string[] | undefined;
        if (servers && servers.length > 0) {
            return servers[Math.floor(Math.random() * servers.length)];
        }
    } catch (e) {
        console.warn("[BigFileUpload] GoFile server fetch failed, using fallback.");
    }

    // Fallback to a reliable default server if API fails or returns empty
    return "store1";
}

function buildFileFormData(fileBuffer: ArrayBuffer, fileName: string, fileType: string) {
    const formData = new FormData();
    formData.append("file", new File([fileBuffer], fileName, { type: fileType || "application/octet-stream" }));
    return formData;
}

export async function uploadFileToGofileNative(_, fileBuffer: ArrayBuffer, fileName: string, fileType: string, token?: string): Promise<string> {
    const server = await pickGofileServer();
    const url = `https://${server}.gofile.io/uploadFile`;

    const formData = buildFileFormData(fileBuffer, fileName, fileType);
    if (token) formData.append("token", token);

    const response = await safeFetch(url, { method: "POST", body: formData });
    const result = await response.json().catch(() => null) as any;
    if (!response.ok) {
        const msg = result?.message ? ` (${String(result.message)})` : "";
        throw new Error(`GoFile: HTTP ${response.status}${msg}`);
    }

    // Try JSON response first
    const downloadPage = result?.data?.downloadPage;
    if (result?.status === "ok" && typeof downloadPage === "string" && isHttpUrl(downloadPage)) {
        return downloadPage;
    }

    // Fallback: try response as text URL
    const text = await response.text();
    const trimmed = text.trim();
    if (isHttpUrl(trimmed)) {
        return trimmed;
    }

    throw new Error("GoFile: unexpected response shape");
}

export async function uploadFileToCatboxNative(_, fileBuffer: ArrayBuffer, fileName: string, fileType: string, userHash?: string): Promise<string> {
    const url = "https://catbox.moe/user/api.php";

    const formData = new FormData();
    formData.append("reqtype", "fileupload");
    formData.append("fileToUpload", new File([fileBuffer], fileName, { type: fileType || "application/octet-stream" }));
    if (userHash) formData.append("userhash", userHash);

    const response = await safeFetch(url, { method: "POST", body: formData });
    const result = await response.text();
    const trimmed = result.trim();
    if (!response.ok) throw new Error(`Catbox: HTTP ${response.status}`);
    if (!isHttpUrl(trimmed)) throw new Error("Catbox: unexpected response (not a URL)");
    return trimmed;
}

export async function uploadFileToLitterboxNative(_, fileBuffer: ArrayBuffer, fileName: string, fileType: string, time: string): Promise<string> {
    const url = "https://litterbox.catbox.moe/resources/internals/api.php";

    const formData = new FormData();
    formData.append("reqtype", "fileupload");
    formData.append("fileToUpload", new File([fileBuffer], fileName, { type: fileType || "application/octet-stream" }));
    formData.append("time", time);

    const response = await safeFetch(url, { method: "POST", body: formData });
    const result = await response.text();
    const trimmed = result.trim();
    if (!response.ok) throw new Error(`Litterbox: HTTP ${response.status}`);
    if (!isHttpUrl(trimmed)) throw new Error("Litterbox: unexpected response (not a URL)");
    return trimmed;
}

export async function uploadFileToFilefastNative(_, fileBuffer: ArrayBuffer, fileName: string, fileType: string, token?: string): Promise<string> {
    const url = "https://file.fast/api/v1/upload";

    const formData = new FormData();
    formData.append("files[]", new File([fileBuffer], fileName, { type: fileType || "application/octet-stream" }));
    if (token) formData.append("token", token);

    const response = await safeFetch(url, { method: "POST", body: formData });
    const result = await response.json().catch(() => null) as any;

    if (!response.ok || result?.success !== true) {
        throw new Error(`FileFast: HTTP ${response.status} or upload failed`);
    }

    const files = result?.files;
    if (!Array.isArray(files) || files.length === 0) {
        throw new Error("FileFast: unexpected response shape (no files)");
    }

    const uploadedFile = files[0];
    const finalUrl = uploadedFile?.url;

    if (typeof finalUrl !== "string" || !isHttpUrl(finalUrl))
        throw new Error("FileFast: unexpected response (no valid URL)");

    return finalUrl;
}

export async function uploadFileCustomNative(
    _,
    url: string,
    fileBuffer: ArrayBuffer,
    fileName: string,
    fileType: string,
    fileFormName: string,
    customArgs: Record<string, string>,
    customHeaders: Record<string, string>,
    responseType: string,
    urlPath: string[]
): Promise<string> {
    await assertSafeUrl(url).catch(() => {
        throw new Error("Custom: invalid request URL (https public hosts only)");
    });
    if (!fileFormName?.trim()) throw new Error("Custom: invalid file form name");

    const formData = new FormData();
    formData.append(fileFormName, new File([fileBuffer], fileName, { type: fileType || "application/octet-stream" }));

    for (const [key, value] of Object.entries(customArgs ?? {})) {
        if (!key) continue;
        formData.append(key, String(value));
    }

    const headersObj: Record<string, string> = {};
    for (const [k, v] of Object.entries(customHeaders ?? {})) {
        if (!k) continue;
        if (k.toLowerCase() === "content-type") continue;
        headersObj[k] = String(v);
    }

    const uploadResponse = await safeFetch(url, {
        method: "POST",
        body: formData,
        headers: new Headers(headersObj),
    });

    if (!uploadResponse.ok)
        throw new Error(`Custom: HTTP ${uploadResponse.status} (${uploadResponse.statusText})`);

    if (responseType === "JSON") {
        const json = await uploadResponse.json().catch(() => null) as any;
        let current: any = json;
        for (const key of urlPath ?? []) {
            if (!key) continue;
            current = current?.[key];
        }
        if (typeof current !== "string" || !isHttpUrl(current))
            throw new Error("Custom: JSON response did not contain a valid URL at the configured path");
        return current;
    }

    const text = (await uploadResponse.text()).trim();
    if (!isHttpUrl(text))
        throw new Error("Custom: text response was not a valid URL");
    return text;
}
