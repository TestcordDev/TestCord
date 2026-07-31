/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createCipheriv, randomBytes } from "crypto";
import type { IpcMainInvokeEvent } from "electron";

type UploadDropResult = { success: true; url: string; } | { success: false; error: string; };

const API_BASE = "https://anon.li/api/v1";
const SHARE_BASE = "https://anon.li/d";
const FILENAME_IV_INDEX = 0xFFFFFFFF;

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function getRecord(record: Record<string, unknown>, key: string) {
    const value = record[key];

    return isRecord(value) ? value : undefined;
}

function getString(record: Record<string, unknown> | undefined, key: string) {
    const value = record?.[key];

    return typeof value === "string" ? value : undefined;
}

function getNumber(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toBuffer(value: unknown) {
    if (value instanceof ArrayBuffer) return Buffer.from(value);
    if (value instanceof Uint8Array) return Buffer.from(value);
    if (ArrayBuffer.isView(value)) return Buffer.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));

    return undefined;
}

function deriveChunkIv(baseIv: Buffer, chunkIndex: number) {
    const iv = Buffer.alloc(12);

    baseIv.copy(iv, 0, 0, 8);
    iv.writeUInt32BE(chunkIndex, 8);

    return iv;
}

function encryptBuffer(key: Buffer, iv: Buffer, data: Buffer) {
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);

    return Buffer.concat([encrypted, cipher.getAuthTag()]);
}

function encryptText(key: Buffer, iv: Buffer, text: string) {
    return encryptBuffer(key, iv, Buffer.from(text, "utf8")).toString("base64url");
}

function getDropId(response: unknown) {
    if (!isRecord(response)) return undefined;

    const data = getRecord(response, "data") ?? response;

    return getString(data, "drop_id") ?? getString(data, "dropId") ?? getString(data, "id");
}

function getFileId(response: unknown) {
    if (!isRecord(response)) return undefined;

    const data = getRecord(response, "data") ?? response;

    return getString(data, "fileId") ?? getString(data, "id");
}

function getUploadUrl(response: unknown) {
    if (!isRecord(response)) return undefined;

    const data = getRecord(response, "data") ?? response;
    const uploadUrls = getRecord(data, "uploadUrls");

    return getString(uploadUrls, "1");
}

function getApiError(response: unknown) {
    if (!isRecord(response)) return undefined;

    const error = getString(response, "error") ?? getString(response, "message");
    const data = getRecord(response, "data");

    return error ?? getString(data, "error") ?? getString(data, "message");
}

async function readJson(response: Response) {
    const text = await response.text();
    if (!text) return {};

    try {
        return JSON.parse(text) as unknown;
    } catch {
        throw new Error("Anon.li returned an invalid response.");
    }
}

async function requestJson(url: string, apiKey: string, body: Record<string, unknown>, method = "POST") {
    const response = await fetch(url, {
        method,
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });
    const json = await readJson(response);

    if (!response.ok) {
        throw new Error(getApiError(json) ?? `Anon.li request failed with HTTP ${response.status}.`);
    }

    return json;
}

function getUploadBody(encryptedData: Buffer, encryptedName: string, fileIv: Buffer, mimeType: string) {
    return {
        size: encryptedData.length,
        encryptedName,
        iv: fileIv.toString("base64url"),
        mimeType,
        chunkCount: 1,
        chunkSize: encryptedData.length
    };
}

export async function uploadDrop(
    _event: IpcMainInvokeEvent,
    apiKey: string,
    fileName: string,
    mimeType: string,
    data: ArrayBuffer,
    expiryDays: number,
    maxDownloads: number
): Promise<UploadDropResult> {
    const fileBuffer = toBuffer(data);
    const normalizedApiKey = typeof apiKey === "string" ? apiKey.trim() : "";
    const normalizedFileName = typeof fileName === "string" ? fileName.trim() : "";
    const normalizedMimeType = typeof mimeType === "string" && mimeType.trim() ? mimeType.trim() : "application/octet-stream";
    const normalizedExpiry = clamp(Math.round(getNumber(expiryDays) ?? 3), 1, 30);
    const normalizedMaxDownloads = Math.max(0, Math.round(getNumber(maxDownloads) ?? 0));

    if (!normalizedApiKey) return { success: false, error: "Anon.li API key is missing." };
    if (!normalizedFileName) return { success: false, error: "File name is invalid." };
    if (!fileBuffer || fileBuffer.length === 0) return { success: false, error: "File is empty or unreadable." };

    try {
        const key = randomBytes(32);
        const dropIv = randomBytes(12);
        const fileIv = randomBytes(12);
        const encryptedData = encryptBuffer(key, deriveChunkIv(fileIv, 0), fileBuffer);
        const encryptedName = encryptText(key, deriveChunkIv(fileIv, FILENAME_IV_INDEX), normalizedFileName);
        const createBody: Record<string, unknown> = {
            iv: dropIv.toString("base64url"),
            encryptedTitle: encryptText(key, deriveChunkIv(dropIv, FILENAME_IV_INDEX), normalizedFileName),
            fileCount: 1,
            expiry: normalizedExpiry
        };

        if (normalizedMaxDownloads > 0) createBody.maxDownloads = normalizedMaxDownloads;

        const drop = await requestJson(`${API_BASE}/drop`, normalizedApiKey, createBody);
        const dropId = getDropId(drop);
        if (!dropId) return { success: false, error: "Anon.li did not return a drop id." };

        const file = await requestJson(
            `${API_BASE}/drop/${encodeURIComponent(dropId)}/file`,
            normalizedApiKey,
            getUploadBody(encryptedData, encryptedName, fileIv, normalizedMimeType)
        );
        const fileId = getFileId(file);
        const uploadUrl = getUploadUrl(file);
        if (!fileId || !uploadUrl) return { success: false, error: "Anon.li did not return an upload URL." };

        const uploadResponse = await fetch(uploadUrl, {
            method: "PUT",
            body: encryptedData
        });
        const etag = uploadResponse.headers.get("ETag");

        if (!uploadResponse.ok) return { success: false, error: `Storage upload failed with HTTP ${uploadResponse.status}.` };
        if (!etag) return { success: false, error: "Storage upload did not return an ETag." };

        await requestJson(
            `${API_BASE}/drop/${encodeURIComponent(dropId)}?action=finish`,
            normalizedApiKey,
            {
                files: [{
                    fileId,
                    chunks: [{ chunkIndex: 0, etag }]
                }]
            },
            "PATCH"
        );

        return { success: true, url: `${SHARE_BASE}/${dropId}#${key.toString("base64url")}` };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : "Anon.li upload failed." };
    }
}
