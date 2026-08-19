/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { normalizeCorsProxyUrl, toProxiedUrl } from "@equicordplugins/fileUpload/constants";
import { settings } from "@equicordplugins/fileUpload/settings";
import { fallbackServiceOrder, serviceLabels, ServiceType } from "@equicordplugins/fileUpload/types";
import { copyToClipboard } from "@utils/clipboard";
import { insertTextIntoChatInputBox } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { chooseFile } from "@utils/web";
import { showToast, Toasts } from "@webpack/common";
import { convertApngToGif } from "./apngToGif";
import { getExtensionFromBytes, getExtensionFromMime, getMimeFromExtension, getUrlExtension } from "./getMediaUrl";
import { isS3Configured, uploadToS3 } from "./s3";
import { parseShareXConfig, resolveShareXTemplate } from "./sharex";
const Native = IS_DISCORD_DESKTOP
    ? VencordNative.pluginHelpers.FileUpload
    : null;
export const logger = new Logger("FileUpload", "#7cb7ff");
function toProxyUrl(url) {
    const corsProxyUrl = normalizeCorsProxyUrl(settings.store.corsProxyUrl);
    if (url.startsWith(`${corsProxyUrl}?url=`)) {
        return url;
    }
    return toProxiedUrl(url, corsProxyUrl);
}
let isUploading = false;
const defaultUploadState = {
    phase: "idle",
    fileName: "",
    currentService: null,
    currentServiceLabel: "",
    attempt: 0,
    totalAttempts: 0,
    percent: 0,
    transferredBytes: 0,
    totalBytes: 0,
    status: "",
    canCancel: false
};
let uploadState = { ...defaultUploadState };
const uploadStateListeners = new Set();
let activeAbortController = null;
let activeXhr = null;
let cancelRequested = false;
function isUploadCancelledError(error) {
    if (cancelRequested)
        return true;
    if (!(error instanceof Error))
        return false;
    const message = error.message.toLowerCase();
    return message.includes("cancelled") || message.includes("canceled") || message.includes("aborted") || message.includes("aborterror");
}
function getFallbackServices() {
    const configuredOrder = settings.store.fallbackOrder || fallbackServiceOrder.join(",");
    const services = configuredOrder
        .split(/[\n,]/)
        .map(service => service.trim())
        .filter((service) => Object.values(ServiceType).includes(service));
    return services.length === fallbackServiceOrder.length && new Set(services).size === fallbackServiceOrder.length
        ? services
        : fallbackServiceOrder;
}
function emitUploadState() {
    for (const listener of uploadStateListeners) {
        listener();
    }
}
function setUploadState(patch) {
    uploadState = { ...uploadState, ...patch };
    emitUploadState();
}
function resetUploadState() {
    uploadState = { ...defaultUploadState };
    emitUploadState();
}
export function subscribeUploadState(listener) {
    uploadStateListeners.add(listener);
    return () => uploadStateListeners.delete(listener);
}
export function getUploadState() {
    return uploadState;
}
export function cancelCurrentUpload() {
    if (!isUploading) {
        return;
    }
    cancelRequested = true;
    activeAbortController?.abort();
    activeXhr?.abort();
    setUploadState({
        phase: "cancelled",
        status: "Upload cancelled.",
        canCancel: false,
        percent: 0
    });
}
function getUploadTimeoutMs() {
    const value = settings.store.uploadTimeoutMs;
    if (!Number.isFinite(value) || !value) {
        return 300000;
    }
    return Math.max(5000, value);
}
async function fetchWithTimeout(url, options) {
    const controller = new AbortController();
    activeAbortController = controller;
    const timeout = setTimeout(() => controller.abort(), getUploadTimeoutMs());
    const requestUrl = toProxyUrl(url);
    try {
        return await fetch(requestUrl, {
            ...options,
            signal: controller.signal
        });
    }
    catch (error) {
        if (cancelRequested || controller.signal.aborted) {
            throw new Error(cancelRequested ? "Upload cancelled by user" : "Upload timed out");
        }
        throw error;
    }
    finally {
        clearTimeout(timeout);
        if (activeAbortController === controller) {
            activeAbortController = null;
        }
    }
}
function getHeaderEntries(headers) {
    if (!headers)
        return [];
    if (headers instanceof Headers)
        return Array.from(headers.entries());
    if (Array.isArray(headers))
        return headers.map(([key, value]) => [key, value]);
    return Object.entries(headers);
}
class XhrResponse {
    xhr;
    ok;
    headers;
    status;
    statusText;
    url;
    constructor(xhr) {
        this.xhr = xhr;
        this.status = xhr.status;
        this.statusText = xhr.statusText;
        this.url = xhr.responseURL;
        this.ok = this.status >= 200 && this.status < 300;
        this.headers = new Headers();
        const rawHeaders = xhr.getAllResponseHeaders();
        for (const line of rawHeaders.trim().split(/[\r\n]+/)) {
            if (!line)
                continue;
            const separatorIndex = line.indexOf(":");
            if (separatorIndex < 0)
                continue;
            this.headers.append(line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1).trim());
        }
    }
    async text() {
        return typeof this.xhr.response === "string"
            ? this.xhr.response
            : this.xhr.responseText;
    }
    async json() {
        return JSON.parse(await this.text());
    }
}
function setXhrUploadProgress(event) {
    if (!event.lengthComputable || event.total <= 0) {
        setUploadState({
            status: uploadState.currentServiceLabel
                ? `Uploading via ${uploadState.currentServiceLabel}...`
                : "Uploading..."
        });
        return;
    }
    const percent = Math.round(Math.max(0, Math.min(100, event.loaded / event.total * 100)));
    setUploadState({
        phase: "uploading",
        percent,
        transferredBytes: event.loaded,
        totalBytes: event.total,
        status: uploadState.currentServiceLabel
            ? `Uploading via ${uploadState.currentServiceLabel}...`
            : "Uploading..."
    });
}
async function uploadRequestWithTimeout(url, options) {
    const requestUrl = toProxyUrl(url);
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        activeXhr = xhr;
        const timeout = setTimeout(() => xhr.abort(), getUploadTimeoutMs());
        xhr.open(options.method || "GET", requestUrl);
        for (const [key, value] of getHeaderEntries(options.headers)) {
            xhr.setRequestHeader(key, value);
        }
        xhr.upload.onprogress = setXhrUploadProgress;
        xhr.onload = () => resolve(new XhrResponse(xhr));
        xhr.onerror = () => reject(new Error("Upload failed"));
        xhr.onabort = () => reject(new Error(cancelRequested ? "Upload cancelled by user" : "Upload timed out"));
        xhr.onloadend = () => {
            clearTimeout(timeout);
            xhr.upload.onprogress = null;
            if (activeXhr === xhr) {
                activeXhr = null;
            }
        };
        const { body } = options;
        xhr.send(body instanceof ReadableStream ? null : body);
    });
}
function resolveShareXRequestValue(value, filename) {
    return String(value)
        .replace(/\$filename\$/g, filename)
        .replace(/\{filename\}/g, filename);
}
function parseShareXConfigFromSettings() {
    const configText = settings.store.sharexConfig || "";
    if (!configText.trim()) {
        throw new Error("ShareX config is required");
    }
    return parseShareXConfig(configText);
}
async function uploadToShareX(fileBlob, filename) {
    const config = parseShareXConfigFromSettings();
    const method = (config.RequestMethod || "POST").toUpperCase();
    const requestUrl = config.RequestURL.trim();
    const bodyType = (config.Body || "MultipartFormData").toLowerCase();
    const headers = new Headers();
    for (const [key, value] of Object.entries(config.Headers || {})) {
        headers.set(key, resolveShareXRequestValue(value, filename));
    }
    const buildArguments = () => {
        const args = {};
        for (const [key, value] of Object.entries(config.Arguments || {})) {
            args[key] = resolveShareXRequestValue(value, filename);
        }
        return args;
    };
    let body;
    if (bodyType === "multipartformdata" || bodyType === "formdata") {
        headers.delete("content-type");
        const formData = new FormData();
        const fileField = config.FileFormName || "file";
        formData.append(fileField, fileBlob, filename);
        const args = buildArguments();
        for (const [key, value] of Object.entries(args)) {
            formData.append(key, value);
        }
        body = formData;
    }
    else if (bodyType === "binary") {
        body = fileBlob;
    }
    else if (bodyType === "json") {
        if (!headers.has("content-type")) {
            headers.set("content-type", "application/json");
        }
        const payload = buildArguments();
        body = JSON.stringify(payload);
    }
    else {
        throw new Error(`Unsupported ShareX Body type: ${config.Body || "unknown"}`);
    }
    const response = await uploadRequestWithTimeout(requestUrl, { method, headers, body });
    const responseText = await response.text();
    let responseJson = null;
    try {
        responseJson = responseText ? JSON.parse(responseText) : null;
    }
    catch {
        responseJson = null;
    }
    if (!response.ok) {
        const configuredError = resolveShareXTemplate(config.ErrorMessage, responseText, responseJson);
        throw new Error(configuredError || `Upload failed: ${response.status} ${response.statusText}`);
    }
    const configuredUrl = resolveShareXTemplate(config.URL, responseText, responseJson)?.trim();
    const fallbackUrl = typeof responseJson === "object" && responseJson && "url" in responseJson
        ? String(responseJson.url || "")
        : responseText.trim();
    const resultUrl = configuredUrl || fallbackUrl;
    if (!resultUrl) {
        throw new Error("No URL returned from ShareX uploader");
    }
    return resultUrl;
}
async function uploadToZipline(fileBlob, filename) {
    const { serviceUrl, ziplineToken, folderId } = settings.store;
    if (!serviceUrl || !ziplineToken) {
        throw new Error("Service URL and auth token are required");
    }
    const baseUrl = serviceUrl.replace(/\/+$/, "");
    const formData = new FormData();
    formData.append("file", fileBlob, filename);
    const headers = {
        "Authorization": ziplineToken
    };
    if (folderId) {
        headers["x-zipline-folder"] = folderId;
    }
    const response = await uploadRequestWithTimeout(`${baseUrl}/api/upload`, {
        method: "POST",
        headers,
        body: formData
    });
    const responseContentType = response.headers.get("content-type") || "";
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Upload failed: ${response.status} ${errorText}`);
    }
    if (!responseContentType.includes("application/json")) {
        throw new Error("Server returned invalid response (not JSON)");
    }
    const data = await response.json();
    if (data.files && data.files.length > 0 && data.files[0].url) {
        return data.files[0].url;
    }
    throw new Error("No URL returned from upload");
}
async function uploadToNest(fileBlob, filename) {
    const { nestToken } = settings.store;
    if (!nestToken) {
        throw new Error("Auth token is required");
    }
    if (Native) {
        const arrayBuffer = await fileBlob.arrayBuffer();
        const result = await Native.uploadToNest(arrayBuffer, filename, nestToken);
        if (!result.success) {
            throw new Error(result.error || "Upload failed");
        }
        if (!result.url) {
            throw new Error("No URL returned from upload");
        }
        return result.url;
    }
    const formData = new FormData();
    formData.append("file", fileBlob, filename);
    const response = await uploadRequestWithTimeout("https://nest.rip/api/files/upload", {
        method: "POST",
        headers: {
            "Authorization": nestToken
        },
        body: formData
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Upload failed: ${response.status} ${errorText}`);
    }
    const data = await response.json();
    if (data.fileURL) {
        return data.fileURL;
    }
    throw new Error("No URL returned from upload");
}
function parseEncryptingHostDomains(raw) {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        throw new Error("Encrypting.host domains must be a JSON array of non-empty strings");
    }
    if (!Array.isArray(parsed) || parsed.some(domain => typeof domain !== "string" || !domain.trim())) {
        throw new Error("Encrypting.host domains must be a JSON array of non-empty strings");
    }
    return parsed.map(domain => domain.trim());
}
function getEncryptingHostConfig() {
    const { encryptingHostKey, encryptingHostUrlStyle, encryptingHostDomains, encryptingHostTitle, encryptingHostColor, encryptingHostFakelink } = settings.store;
    const key = encryptingHostKey?.trim() || "";
    if (!key) {
        throw new Error("Encrypting.host API key is required");
    }
    const style = encryptingHostUrlStyle || "query";
    if (style !== "query" && style !== "param" && style !== "fakelink" && style !== "embed") {
        throw new Error("Invalid Encrypting.host URL style");
    }
    const domainsRaw = encryptingHostDomains?.trim() || "[\"offensive\"]";
    return {
        key,
        urlStyle: style,
        domains: parseEncryptingHostDomains(domainsRaw),
        title: encryptingHostTitle?.trim() || "",
        color: encryptingHostColor?.trim() || "",
        fakelink: encryptingHostFakelink?.trim() || ""
    };
}
async function uploadToEncryptingHost(fileBlob, filename) {
    const config = getEncryptingHostConfig();
    const formData = new FormData();
    formData.append("password", makeRandomHex(16));
    formData.append("userKey", config.key);
    formData.append("urlStyle", config.urlStyle);
    formData.append("domains", JSON.stringify(config.domains));
    if (config.title) {
        formData.append("title", config.title);
    }
    if (config.color) {
        formData.append("color", config.color);
    }
    if (config.fakelink) {
        formData.append("fakelink", config.fakelink);
    }
    formData.append("file", fileBlob, filename);
    const response = await uploadRequestWithTimeout("https://encrypting.host/upload", {
        method: "POST",
        body: formData
    });
    const text = await response.text();
    let data = null;
    try {
        data = text ? JSON.parse(text) : null;
    }
    catch {
        data = null;
    }
    if (!response.ok) {
        throw new Error(`Upload failed: ${response.status} ${text}`);
    }
    const parsedUrl = data?.url?.trim() || "";
    const fallbackUrl = text.trim().startsWith("http") ? text.trim() : "";
    const url = parsedUrl || fallbackUrl;
    if (!url) {
        throw new Error("No URL returned from upload");
    }
    return url;
}
export function isConfigured() {
    const { serviceType, serviceUrl, ziplineToken, nestToken } = settings.store;
    switch (serviceType) {
        case ServiceType.NEST:
            return Boolean(nestToken);
        case ServiceType.EZHOST:
            return Boolean(settings.store.ezHostKey);
        case ServiceType.ENCRYPTINGHOST:
            return Boolean(settings.store.encryptingHostKey);
        case ServiceType.S3:
            return isS3Configured();
        case ServiceType.CATBOX:
            return true;
        case ServiceType.ZEROX0:
            return Boolean(Native);
        case ServiceType.LITTERBOX:
        case ServiceType.GOFILE:
        case ServiceType.TMPFILES:
        case ServiceType.BUZZHEAVIER:
        case ServiceType.TEMPSH:
        case ServiceType.FILEBIN:
        case ServiceType.PIXELDRAIN:
            return true;
        case ServiceType.PIXELVAULT:
            return Boolean(settings.store.pixelVaultKey);
        case ServiceType.WEBDAV:
            return Boolean(settings.store.webdavUrl);
        case ServiceType.SHAREX:
            try {
                parseShareXConfigFromSettings();
                return true;
            }
            catch {
                return false;
            }
        case ServiceType.ZIPLINE:
        default:
            return Boolean(serviceUrl && ziplineToken);
    }
}
async function uploadToEzHost(fileBlob, filename) {
    const { ezHostKey } = settings.store;
    if (!ezHostKey)
        throw new Error("E-Z Host API key is required");
    if (Native) {
        const arrayBuffer = await fileBlob.arrayBuffer();
        const result = await Native.uploadToEzHost(arrayBuffer, filename, ezHostKey);
        if (!result.success) {
            throw new Error(result.error || "Upload failed");
        }
        if (!result.url) {
            throw new Error("No URL returned from upload");
        }
        return result.url;
    }
    const formData = new FormData();
    formData.append("file", fileBlob, filename);
    const headers = { key: ezHostKey };
    const response = await uploadRequestWithTimeout("https://api.e-z.host/files", {
        method: "POST",
        headers,
        body: formData
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Upload failed: ${response.status} ${text}`);
    }
    const data = await response.json();
    if (!data || !data.success) {
        throw new Error(data?.error || "Upload failed");
    }
    const url = data.imageUrl || data.rawUrl;
    if (!url)
        throw new Error("No URL returned from upload");
    return url;
}
async function uploadToCatbox(fileBlob, filename) {
    const { catboxUserhash } = settings.store;
    if (Native) {
        const result = await Native.uploadToCatbox(await fileBlob.arrayBuffer(), filename, catboxUserhash || undefined);
        if (!result.success || !result.url)
            throw new Error(result.error || "No URL returned from upload");
        return result.url;
    }
    const formData = new FormData();
    formData.append("reqtype", "fileupload");
    if (catboxUserhash)
        formData.append("userhash", catboxUserhash);
    formData.append("fileToUpload", fileBlob, filename);
    const response = await uploadRequestWithTimeout("https://catbox.moe/user/api.php", {
        method: "POST",
        body: formData
    });
    if (!response.ok)
        throw new Error(`Upload failed: ${response.status} ${await response.text()}`);
    const text = (await response.text()).trim();
    if (!text)
        throw new Error("No URL returned from upload");
    return text;
}
async function uploadTo0x0(fileBlob, filename) {
    if (!Native) {
        throw new Error("0x0.st uploads are only supported on the desktop client");
    }
    const arrayBuffer = await fileBlob.arrayBuffer();
    const result = await Native.uploadTo0x0(arrayBuffer, filename);
    if (!result.success) {
        throw new Error(result.error || "Upload failed");
    }
    if (!result.url) {
        throw new Error("No URL returned from upload");
    }
    return result.url;
}
async function uploadToLitterbox(fileBlob, filename) {
    const expiry = settings.store.litterboxExpiry || "24h";
    if (Native) {
        const result = await Native.uploadToLitterbox(await fileBlob.arrayBuffer(), filename, expiry);
        if (!result.success || !result.url)
            throw new Error(result.error || "No URL returned from upload");
        return result.url;
    }
    const formData = new FormData();
    formData.append("reqtype", "fileupload");
    formData.append("time", expiry);
    formData.append("fileToUpload", fileBlob, filename);
    const response = await uploadRequestWithTimeout("https://litterbox.catbox.moe/resources/internals/api.php", {
        method: "POST",
        body: formData
    });
    if (!response.ok)
        throw new Error(`Upload failed: ${response.status} ${await response.text()}`);
    const text = (await response.text()).trim();
    if (!text)
        throw new Error("No URL returned from upload");
    return text;
}
async function uploadToGofile(fileBlob, filename) {
    const { gofileToken } = settings.store;
    if (Native) {
        const result = await Native.uploadToGofile(await fileBlob.arrayBuffer(), filename, gofileToken || undefined);
        if (!result.success || !result.url)
            throw new Error(result.error || "No URL returned from upload");
        return result.url;
    }
    const formData = new FormData();
    if (gofileToken?.trim()) {
        formData.append("token", gofileToken.trim());
    }
    formData.append("file", fileBlob, filename);
    const uploadUrl = "https://upload.gofile.io/uploadfile";
    const response = await uploadRequestWithTimeout(uploadUrl, {
        method: "POST",
        body: formData
    });
    if (!response.ok) {
        throw new Error(`Upload failed: ${response.status} ${await response.text()}`);
    }
    const data = await response.json();
    if (data.status !== "ok") {
        throw new Error(data.error || "Upload failed");
    }
    const url = data.data?.downloadPage || (data.data?.code ? `https://gofile.io/d/${data.data.code}` : "");
    if (!url)
        throw new Error("No URL returned from upload");
    return url;
}
async function uploadToTmpfiles(fileBlob, filename) {
    if (Native) {
        const result = await Native.uploadToTmpfiles(await fileBlob.arrayBuffer(), filename);
        if (!result.success || !result.url)
            throw new Error(result.error || "No URL returned from upload");
        return result.url;
    }
    const formData = new FormData();
    formData.append("file", fileBlob, filename);
    const uploadUrl = "https://tmpfiles.org/api/v1/upload";
    const response = await uploadRequestWithTimeout(uploadUrl, {
        method: "POST",
        body: formData
    });
    if (!response.ok) {
        throw new Error(`Upload failed: ${response.status} ${await response.text()}`);
    }
    const data = await response.json();
    const url = data.data?.url;
    if (!url || data.status !== "success") {
        throw new Error("No URL returned from upload");
    }
    return url.includes("tmpfiles.org/") && !url.includes("/dl/")
        ? url.replace(/tmpfiles\.org\/(\d+)/, "tmpfiles.org/dl/$1")
        : url;
}
async function uploadToBuzzheavier(fileBlob, filename) {
    if (Native) {
        const result = await Native.uploadToBuzzheavier(await fileBlob.arrayBuffer(), filename);
        if (!result.success || !result.url)
            throw new Error(result.error || "No URL returned from upload");
        return result.url;
    }
    const uploadUrl = `https://w.buzzheavier.com/${encodeURIComponent(filename)}`;
    const response = await uploadRequestWithTimeout(uploadUrl, {
        method: "PUT",
        body: fileBlob
    });
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`Upload failed: ${response.status} ${text}`);
    }
    try {
        const data = JSON.parse(text);
        const id = data.data?.id;
        if (data.code === 201 && id) {
            return `https://buzzheavier.com/${id}`;
        }
    }
    catch {
    }
    const fallback = text.trim();
    if (!fallback)
        throw new Error("No URL returned from upload");
    return fallback;
}
async function uploadToTempSh(fileBlob, filename) {
    if (Native) {
        const result = await Native.uploadToTempSh(await fileBlob.arrayBuffer(), filename);
        if (!result.success || !result.url)
            throw new Error(result.error || "No URL returned from upload");
        return result.url;
    }
    const formData = new FormData();
    formData.append("file", fileBlob, filename);
    const uploadUrl = "https://temp.sh/upload";
    const response = await uploadRequestWithTimeout(uploadUrl, {
        method: "POST",
        body: formData
    });
    if (!response.ok) {
        throw new Error(`Upload failed: ${response.status} ${await response.text()}`);
    }
    const text = (await response.text()).trim();
    if (!text)
        throw new Error("No URL returned from upload");
    return text;
}
function makeRandomHex(length = 12) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}
async function uploadToFilebin(fileBlob, filename) {
    if (Native) {
        const result = await Native.uploadToFilebin(await fileBlob.arrayBuffer(), filename);
        if (!result.success || !result.url)
            throw new Error(result.error || "No URL returned from upload");
        return result.url;
    }
    const binId = makeRandomHex(6);
    const uploadUrl = `https://filebin.net/${binId}/${encodeURIComponent(filename)}`;
    const formData = new FormData();
    formData.append("file", fileBlob, filename);
    const response = await uploadRequestWithTimeout(uploadUrl, {
        method: "POST",
        body: formData
    });
    if (!response.ok) {
        throw new Error(`Upload failed: ${response.status} ${await response.text()}`);
    }
    return `https://filebin.net/${binId}/${encodeURIComponent(filename)}`;
}
async function uploadToPixelVault(fileBlob, filename) {
    const { pixelVaultKey } = settings.store;
    if (!pixelVaultKey?.trim()) {
        throw new Error("PixelVault upload key is required");
    }
    if (Native) {
        const result = await Native.uploadToPixelVault(await fileBlob.arrayBuffer(), filename, pixelVaultKey.trim());
        if (!result.success) {
            throw new Error(result.error || "Upload failed");
        }
        if (!result.url) {
            throw new Error("No URL returned from upload");
        }
        return result.url;
    }
    const formData = new FormData();
    formData.append("file", fileBlob, filename);
    const response = await uploadRequestWithTimeout("https://pixelvault.co/", {
        method: "POST",
        headers: {
            Authorization: pixelVaultKey.trim()
        },
        body: formData
    });
    const text = await response.text();
    let data = null;
    try {
        data = text ? JSON.parse(text) : null;
    }
    catch {
        data = null;
    }
    if (!response.ok) {
        throw new Error(`Upload failed: ${response.status} ${text}`);
    }
    const url = data?.resource || data?.url || text.trim();
    if (!url) {
        throw new Error("No URL returned from upload");
    }
    return url;
}
async function uploadToPixelDrain(fileBlob, filename) {
    const { pixelDrainKey } = settings.store;
    if (Native) {
        const result = await Native.uploadToPixelDrain(await fileBlob.arrayBuffer(), filename, pixelDrainKey?.trim() || undefined);
        if (!result.success || !result.url)
            throw new Error(result.error || "No URL returned from upload");
        return result.url;
    }
    const headers = {};
    if (pixelDrainKey?.trim()) {
        headers.Authorization = `Basic ${btoa(`:${pixelDrainKey.trim()}`)}`;
    }
    const response = await uploadRequestWithTimeout(`https://pixeldrain.com/api/file/${encodeURIComponent(filename)}`, {
        method: "PUT",
        headers,
        body: fileBlob
    });
    const text = await response.text();
    let data = null;
    try {
        data = text ? JSON.parse(text) : null;
    }
    catch {
        data = null;
    }
    if (!response.ok) {
        throw new Error(data?.message || `Upload failed: ${response.status} ${text}`);
    }
    if (!data?.id) {
        throw new Error(data?.message || "No URL returned from upload");
    }
    return `https://pixeldrain.com/u/${data.id}`;
}
function buildWebdavAuthHeader() {
    const { webdavUsername, webdavPassword } = settings.store;
    if (webdavUsername?.trim() && webdavPassword?.trim()) {
        return `Basic ${btoa(`${webdavUsername.trim()}:${webdavPassword.trim()}`)}`;
    }
    return null;
}
async function createWebdavShare(relativePath, serverOrigin, filename) {
    const { webdavServerType, webdavShareType } = settings.store;
    const ocsVersion = webdavServerType === "owncloud" ? "v1" : "v2";
    const ocsUrl = `${serverOrigin}/ocs/${ocsVersion}.php/apps/files_sharing/api/v1/shares?format=json`;
    const authHeader = buildWebdavAuthHeader();
    const ocsHeaders = {
        "OCS-APIRequest": "true",
        "Content-Type": "application/x-www-form-urlencoded"
    };
    if (authHeader) {
        ocsHeaders.Authorization = authHeader;
    }
    const body = new URLSearchParams({
        path: `/${relativePath}`,
        shareType: "3",
        permissions: "1"
    }).toString();
    let shareToken;
    let shareUrl;
    if (Native) {
        const result = await Native.createWebdavShare(ocsUrl, ocsHeaders, body);
        if (!result.success) {
            throw new Error(result.error || "Failed to create public share");
        }
        shareToken = result.url || "";
        if (!shareToken) {
            throw new Error("No share token returned from server");
        }
    }
    else {
        const response = await uploadRequestWithTimeout(ocsUrl, {
            method: "POST",
            headers: ocsHeaders,
            body
        });
        const responseText = await response.text();
        if (!response.ok) {
            throw new Error(`Failed to create public share: ${response.status} ${responseText}`);
        }
        let shareData;
        try {
            shareData = JSON.parse(responseText);
        }
        catch {
            throw new Error(`Failed to parse share response: ${responseText.slice(0, 200)}`);
        }
        shareToken = shareData?.ocs?.data?.token ?? "";
        if (!shareToken) {
            const meta = shareData?.ocs?.meta;
            const description = meta ? `${meta.status || "unknown"} (${meta.statuscode || "?"})` : "no token in response";
            throw new Error(`Failed to create public share: ${description}`);
        }
        shareUrl = shareData.ocs?.data?.url;
    }
    const shareType = webdavShareType || "share-page";
    const sharePageUrl = shareUrl || `${serverOrigin}/s/${shareToken}`;
    const directDownloadUrl = webdavServerType === "owncloud"
        ? `${serverOrigin}/remote.php/dav/public-files/${shareToken}`
        : `${serverOrigin}/public.php/dav/files/${shareToken}`;
    if (shareType === "direct-download") {
        return directDownloadUrl;
    }
    if (shareType === "markdown") {
        return `[${filename}](${directDownloadUrl})`;
    }
    return sharePageUrl;
}
async function uploadToWebdav(fileBlob, filename) {
    const { webdavUrl, webdavServerType, webdavDirectory } = settings.store;
    if (!webdavUrl) {
        throw new Error("WebDAV server URL is required");
    }
    const authHeader = buildWebdavAuthHeader();
    const baseUrl = webdavUrl.replace(/\/+$/, "");
    const dir = (webdavDirectory || "").replace(/^\/+|\/+$/g, "");
    const relativePath = dir ? `${dir}/${filename}` : filename;
    const encodedDir = dir ? dir.split("/").map(encodeURIComponent).join("/") + "/" : "";
    const uploadUrl = `${baseUrl}/${encodedDir}${encodeURIComponent(filename)}`;
    const serverType = webdavServerType || "nextcloud";
    const requestHeaders = {
        "Content-Type": fileBlob.type || "application/octet-stream"
    };
    if (authHeader) {
        requestHeaders.Authorization = authHeader;
    }
    if (Native) {
        const arrayBuffer = await fileBlob.arrayBuffer();
        const result = await Native.uploadToWebdav(arrayBuffer, uploadUrl, requestHeaders);
        if (!result.success) {
            throw new Error(result.error || "Upload failed");
        }
    }
    else {
        const response = await uploadRequestWithTimeout(uploadUrl, {
            method: "PUT",
            headers: requestHeaders,
            body: fileBlob
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Upload failed: ${response.status} ${errorText}`);
        }
    }
    if (serverType === "generic") {
        return uploadUrl;
    }
    let serverOrigin;
    try {
        serverOrigin = new URL(webdavUrl).origin;
    }
    catch {
        throw new Error("Invalid WebDAV server URL");
    }
    return await createWebdavShare(relativePath, serverOrigin, filename);
}
async function uploadToService(serviceType, fileBlob, filename) {
    switch (serviceType) {
        case ServiceType.ZIPLINE:
            return uploadToZipline(fileBlob, filename);
        case ServiceType.NEST:
            return uploadToNest(fileBlob, filename);
        case ServiceType.EZHOST:
            return uploadToEzHost(fileBlob, filename);
        case ServiceType.ENCRYPTINGHOST:
            return uploadToEncryptingHost(fileBlob, filename);
        case ServiceType.S3:
            return uploadToS3(fileBlob, filename, Native, uploadRequestWithTimeout);
        case ServiceType.CATBOX:
            return uploadToCatbox(fileBlob, filename);
        case ServiceType.ZEROX0:
            return uploadTo0x0(fileBlob, filename);
        case ServiceType.LITTERBOX:
            return uploadToLitterbox(fileBlob, filename);
        case ServiceType.SHAREX:
            return uploadToShareX(fileBlob, filename);
        case ServiceType.GOFILE:
            return uploadToGofile(fileBlob, filename);
        case ServiceType.TMPFILES:
            return uploadToTmpfiles(fileBlob, filename);
        case ServiceType.BUZZHEAVIER:
            return uploadToBuzzheavier(fileBlob, filename);
        case ServiceType.TEMPSH:
            return uploadToTempSh(fileBlob, filename);
        case ServiceType.FILEBIN:
            return uploadToFilebin(fileBlob, filename);
        case ServiceType.PIXELVAULT:
            return uploadToPixelVault(fileBlob, filename);
        case ServiceType.PIXELDRAIN:
            return uploadToPixelDrain(fileBlob, filename);
        case ServiceType.WEBDAV:
            return uploadToWebdav(fileBlob, filename);
        default:
            throw new Error("Unknown service type");
    }
}
const EXE_BLOCKED_SERVICES = new Set([
    ServiceType.CATBOX,
    ServiceType.LITTERBOX,
    ServiceType.ZEROX0
]);
function getEmbedProxyService() {
    const service = settings.store.embedProxyService;
    return service === "nfp" ? service : "cors";
}
function shouldProxyEmbedUrl(url) {
    const ext = getUrlExtension(url)?.toLowerCase();
    if (!ext) {
        return false;
    }
    return getMimeFromExtension(ext).startsWith("video/");
}
function applyEmbedProxy(url) {
    if (!settings.store.embedProxyEnabled) {
        return url;
    }
    const service = getEmbedProxyService();
    if (!shouldProxyEmbedUrl(url)) {
        return url;
    }
    switch (service) {
        case "cors":
            return toProxyUrl(url);
        case "nfp":
            return `https://discord.nfp.is/?v=${encodeURIComponent(url)}`;
        default:
            return toProxyUrl(url);
    }
}
function isExeFileName(fileName) {
    return fileName.toLowerCase().endsWith(".exe");
}
function canServiceHandleFile(service, fileName) {
    if (service === ServiceType.ZEROX0 && !Native) {
        return false;
    }
    if (isExeFileName(fileName) && EXE_BLOCKED_SERVICES.has(service)) {
        return false;
    }
    return true;
}
function normalizePrimaryService(primary, fileName) {
    if (canServiceHandleFile(primary, fileName)) {
        return primary;
    }
    if (isExeFileName(fileName)) {
        return ServiceType.GOFILE;
    }
    if (!Native && primary === ServiceType.ZEROX0) {
        return ServiceType.CATBOX;
    }
    return primary;
}
function buildUploadOrder(primary, fileName) {
    const disableFallbacks = Boolean(settings.store.disableFallbacks);
    const effectivePrimary = normalizePrimaryService(primary, fileName);
    const order = [effectivePrimary];
    if (disableFallbacks) {
        return order;
    }
    for (const fallback of getFallbackServices()) {
        if (fallback !== effectivePrimary && canServiceHandleFile(fallback, fileName)) {
            order.push(fallback);
        }
    }
    return order;
}
function finalizeUploadedUrl(url) {
    if (!settings.store.stripQueryParams) {
        return url;
    }
    try {
        const parsed = new URL(url);
        parsed.search = "";
        return parsed.href;
    }
    catch {
        return url;
    }
}
function getAllowedExtensions() {
    const raw = settings.store.uploadAllowedFileTypes?.trim();
    if (!raw)
        return null;
    const exts = raw.split(/[\s,;]+/).map(e => e.trim().toLowerCase()).filter(Boolean);
    return exts.length > 0 ? new Set(exts) : null;
}
export function isFileTypeAllowed(file) {
    const allowed = getAllowedExtensions();
    if (!allowed)
        return true;
    const dotIndex = file.name.lastIndexOf(".");
    if (dotIndex < 1 || dotIndex === file.name.length - 1)
        return false;
    const ext = file.name.slice(dotIndex + 1).toLowerCase();
    return allowed.has(ext);
}
function getFilenameExtension(filename) {
    const dotIndex = filename.lastIndexOf(".");
    if (dotIndex < 1 || dotIndex === filename.length - 1)
        return undefined;
    const ext = filename.slice(dotIndex + 1).toLowerCase();
    return ext.length <= 10 ? ext : undefined;
}
async function notifyUploadSuccess(finalUrl, forceSend) {
    if (settings.store.autoCopy) {
        if (!finalUrl || !finalUrl.trim()) {
            showToast("Upload successful, but no URL was available to copy", Toasts.Type.MESSAGE);
            return;
        }
        try {
            await copyToClipboard(finalUrl);
            showToast("Upload successful, URL copied to clipboard", Toasts.Type.SUCCESS);
        }
        catch (error) {
            logger.warn("Upload succeeded but clipboard copy failed", error);
            showToast("Upload successful, but failed to copy URL", Toasts.Type.MESSAGE);
        }
    }
    else {
        showToast("Upload successful", Toasts.Type.SUCCESS);
    }
    const autoSend = forceSend || Boolean(settings.store.autoSend);
    const autoFormat = Boolean(settings.store.autoFormat);
    if (autoSend) {
        insertTextIntoChatInputBox(autoFormat ? `<${finalUrl}>` : finalUrl);
    }
}
async function uploadWithFallbacks(fileBlob, filename, primary) {
    const uploadOrder = buildUploadOrder(primary, filename);
    const attempted = [];
    let lastError = "Unknown error";
    setUploadState({
        phase: "uploading",
        fileName: filename,
        totalAttempts: uploadOrder.length,
        attempt: 1,
        percent: 5,
        transferredBytes: 0,
        totalBytes: fileBlob.size,
        status: `Starting upload via ${serviceLabels[uploadOrder[0]]}...`,
        currentService: uploadOrder[0],
        currentServiceLabel: serviceLabels[uploadOrder[0]],
        canCancel: true
    });
    for (const service of uploadOrder) {
        if (cancelRequested)
            throw new Error("Upload cancelled by user");
        const attempt = attempted.length + 1;
        setUploadState({
            phase: attempt === 1 ? "uploading" : "retrying",
            attempt,
            currentService: service,
            currentServiceLabel: serviceLabels[service],
            transferredBytes: 0,
            totalBytes: fileBlob.size,
            percent: 0,
            status: attempt === 1
                ? `Uploading via ${serviceLabels[service]}...`
                : `Retrying with ${serviceLabels[service]} (${attempt}/${uploadOrder.length})...`
        });
        try {
            const uploadedUrl = await uploadToService(service, fileBlob, filename);
            if (attempted.length) {
                showToast(`Upload succeeded with ${serviceLabels[service]} after fallback`, Toasts.Type.SUCCESS);
            }
            setUploadState({
                phase: "success",
                percent: 100,
                attempt,
                currentService: service,
                currentServiceLabel: serviceLabels[service],
                status: `Uploaded successfully via ${serviceLabels[service]}.`,
                canCancel: false
            });
            return uploadedUrl;
        }
        catch (error) {
            if (isUploadCancelledError(error)) {
                throw error;
            }
            const message = error instanceof Error ? error.message : "Unknown error";
            attempted.push(serviceLabels[service]);
            lastError = message;
            logger.warn(`Upload failed for ${serviceLabels[service]}: ${message}`);
            setUploadState({
                phase: "retrying",
                attempt,
                currentService: service,
                currentServiceLabel: serviceLabels[service],
                status: `${serviceLabels[service]} failed: ${message}`,
                percent: Math.min(95, 10 + Math.round((attempt / uploadOrder.length) * 80))
            });
        }
    }
    setUploadState({
        phase: "failed",
        status: `All upload services failed. Last error: ${lastError}`,
        canCancel: false,
        percent: 0
    });
    throw new Error(`All upload services failed. Last error: ${lastError}. Tried: ${attempted.join(", ")}`);
}
async function normalizeUploadBlob(blob, sourceUrl) {
    let sourceFileName = "";
    if (blob instanceof File && blob.name) {
        sourceFileName = blob.name;
    }
    else if (sourceUrl && URL.canParse(sourceUrl)) {
        const segment = new URL(sourceUrl).pathname.split("/").pop();
        if (segment)
            sourceFileName = decodeURIComponent(segment);
    }
    const extGuessFromSource = sourceUrl ? getUrlExtension(sourceUrl) : undefined;
    let ext = await getExtensionFromBytes(blob)
        || getExtensionFromMime(blob.type)
        || getFilenameExtension(sourceFileName)
        || extGuessFromSource
        || "bin";
    if (ext === "apng" && settings.store.apngToGif) {
        const gifBlob = await convertApngToGif(blob);
        if (gifBlob) {
            blob = gifBlob;
            ext = "gif";
        }
        else {
            showToast("APNG to GIF conversion failed, uploading as APNG", Toasts.Type.FAILURE);
        }
    }
    const mimeType = getMimeFromExtension(ext);
    const { preserveOriginalFilename } = settings.store;
    let filename = `upload.${ext}`;
    if (preserveOriginalFilename && sourceFileName) {
        const dotIndex = sourceFileName.lastIndexOf(".");
        filename = `${sourceFileName.slice(0, dotIndex < 0 ? undefined : dotIndex)}.${ext}`;
    }
    return {
        blob: new Blob([blob], { type: mimeType }),
        filename
    };
}
async function uploadPreparedBlob(blob, sourceUrl, forceSend) {
    const primary = settings.store.serviceType;
    const { blob: normalizedBlob, filename } = await normalizeUploadBlob(blob, sourceUrl);
    setUploadState({ fileName: filename, status: "File ready, starting upload...", percent: 4 });
    const uploadedUrl = await uploadWithFallbacks(normalizedBlob, filename, primary);
    const finalUrl = applyEmbedProxy(finalizeUploadedUrl(uploadedUrl));
    await notifyUploadSuccess(finalUrl, forceSend);
    return finalUrl;
}
export async function uploadFile(url) {
    if (isUploading) {
        showToast("Upload already in progress", Toasts.Type.MESSAGE);
        return;
    }
    if (!isConfigured()) {
        showToast("Please configure FileUpload settings first", Toasts.Type.FAILURE);
        return;
    }
    isUploading = true;
    cancelRequested = false;
    setUploadState({
        phase: "preparing",
        fileName: "",
        currentService: null,
        currentServiceLabel: "",
        attempt: 0,
        totalAttempts: 0,
        percent: 1,
        status: "Preparing upload...",
        canCancel: true
    });
    try {
        let fetchUrl = url;
        if (url.includes("/stickers/") && url.includes("passthrough=false")) {
            fetchUrl = url.replace("passthrough=false", "passthrough=true");
        }
        let blob;
        let contentType = "";
        if (Native) {
            const res = await Native.fetchFile(fetchUrl);
            if (res.success && res.data) {
                contentType = res.contentType || "";
                blob = new Blob([res.data], { type: contentType });
            }
            else {
                const response = await fetch(fetchUrl);
                if (!response.ok) {
                    throw new Error(`Failed to fetch file: ${response.status}`);
                }
                contentType = response.headers.get("content-type") || "";
                blob = await response.blob();
            }
        }
        else {
            const response = await fetchWithTimeout(fetchUrl, {
                method: "GET"
            });
            if (!response.ok) {
                throw new Error(`Failed to fetch file: ${response.status}`);
            }
            contentType = response.headers.get("content-type") || "";
            blob = await response.blob();
        }
        if (contentType && !blob.type) {
            blob = new Blob([blob], { type: contentType });
        }
        await uploadPreparedBlob(blob, url);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        if (isUploadCancelledError(error)) {
            showToast("Upload cancelled", Toasts.Type.MESSAGE);
            setUploadState({ phase: "cancelled", status: "Upload cancelled.", canCancel: false, percent: 0 });
        }
        else {
            showToast(`Upload failed: ${message}`, Toasts.Type.FAILURE);
            logger.error("Upload error", error);
            setUploadState({ phase: "failed", status: `Upload failed: ${message}`, canCancel: false, percent: 0 });
        }
    }
    finally {
        isUploading = false;
        activeAbortController = null;
        activeXhr = null;
        setTimeout(() => resetUploadState(), 1800);
    }
}
export async function uploadPickedFile() {
    const file = await chooseFile("*/*");
    if (!file)
        return;
    if (!isFileTypeAllowed(file)) {
        showToast("File type not allowed by current filter", Toasts.Type.FAILURE);
        return;
    }
    await uploadProvidedFiles([file]);
}
export async function uploadProvidedFiles(files, forceSend) {
    if (isUploading) {
        showToast("Upload already in progress", Toasts.Type.MESSAGE);
        return;
    }
    if (!isConfigured()) {
        showToast("Please configure FileUpload settings first", Toasts.Type.FAILURE);
        return;
    }
    if (!files.length)
        return;
    const uploadFiles = files.filter(file => Boolean(file) && isFileTypeAllowed(file));
    if (!uploadFiles.length)
        return;
    isUploading = true;
    cancelRequested = false;
    try {
        for (let i = 0; i < uploadFiles.length; i++) {
            const file = uploadFiles[i];
            const current = i + 1;
            const suffix = uploadFiles.length > 1 ? ` (${current}/${uploadFiles.length})` : "";
            setUploadState({
                phase: "preparing",
                fileName: file.name,
                currentService: null,
                currentServiceLabel: "",
                attempt: 0,
                totalAttempts: 0,
                percent: 2,
                status: `Preparing ${file.name}${suffix}...`,
                canCancel: true
            });
            await uploadPreparedBlob(file, undefined, forceSend);
        }
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        if (isUploadCancelledError(error)) {
            showToast("Upload cancelled", Toasts.Type.MESSAGE);
            setUploadState({ phase: "cancelled", status: "Upload cancelled.", canCancel: false, percent: 0 });
        }
        else {
            showToast(`Upload failed: ${message}`, Toasts.Type.FAILURE);
            logger.error("Manual upload error", error);
            setUploadState({ phase: "failed", status: `Upload failed: ${message}`, canCancel: false, percent: 0 });
        }
    }
    finally {
        isUploading = false;
        activeAbortController = null;
        activeXhr = null;
        setTimeout(() => resetUploadState(), 1800);
    }
}
