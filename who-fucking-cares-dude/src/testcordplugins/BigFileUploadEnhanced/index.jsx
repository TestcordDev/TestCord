/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import { Divider } from "@components/Divider";
import { FormSwitch } from "@components/FormSwitch";
import { OpenExternalIcon } from "@components/Icons";
import { EquicordDevs, TestcordDevs } from "@utils/constants";
import { copyWithToast, insertTextIntoChatInputBox, openImageModal, sendMessage } from "@utils/discord";
import { Margins } from "@utils/margins";
import definePlugin from "@utils/types";
import { chooseFile } from "@utils/web";
import { Alerts, Button, DraftType, Forms, Menu, PermissionsBits, PermissionStore, React, Select, showToast, TextArea, TextInput, Toasts, UploadManager, useMemo } from "@webpack/common";
const Native = IS_DISCORD_DESKTOP
    ? VencordNative.pluginHelpers.BigFileUpload
    : null;
const VIDEO_EXTENSIONS = [
    ".mp4", ".mkv", ".webm", ".avi", ".mov", ".flv", ".wmv", ".m4v", ".mpg", ".mpeg", ".3gp", ".ogv"
];
const MIME_TO_EXT = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/x-matroska": "mkv",
    "audio/mpeg": "mp3",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "application/pdf": "pdf",
    "application/zip": "zip",
    "application/json": "json",
    "text/plain": "txt",
};
const EXT_TO_MIME = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    mp4: "video/mp4",
    webm: "video/webm",
    mkv: "video/x-matroska",
    mp3: "audio/mpeg",
    ogg: "audio/ogg",
    wav: "audio/wav",
    pdf: "application/pdf",
    zip: "application/zip",
    json: "application/json",
    txt: "text/plain",
};
const settings = definePluginSettings({
    uploader: {
        type: 4 /* OptionType.SELECT */,
        description: "Uploader service",
        hidden: true,
        options: [
            { label: "Catbox (max 200mb)", value: "Catbox", default: true },
            { label: "Litterbox (Catbox but temporary upload, 1GB)", value: "Litterbox" },
            { label: "GoFile", value: "GoFile" },
            { label: "FileFast (Fast)", value: "FileFast" }, // Added FileFast
            { label: "Custom (ShareX-compatible)", value: "Custom" },
        ]
    },
    autoSend: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Auto-send the resulting link (otherwise copy + insert into the chat box)",
        hidden: true,
        default: false
    },
    confirmBeforeUpload: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Ask for confirmation before uploading",
        hidden: true,
        default: true
    },
    showDestinationPreview: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show destination host + URL in the confirmation dialog",
        hidden: true,
        default: true
    },
    wrapVideoEmbeds: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Opt-in: wrap large video links with embeds.video for better playback (adds a 3rd-party redirect)",
        hidden: true,
        default: false
    },
    renderImagePreviews: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Render inline image previews for Catbox/Litter/GoFile links even if Discord doesn't embed them",
        hidden: true,
        default: true
    },
    litterboxTime: {
        type: 4 /* OptionType.SELECT */,
        description: "Litterbox retention",
        hidden: true,
        options: [
            { label: "1 hour", value: "1h", default: true },
            { label: "12 hours", value: "12h" },
            { label: "24 hours", value: "24h" },
            { label: "72 hours", value: "72h" },
        ]
    },
    customName: {
        type: 0 /* OptionType.STRING */,
        description: "Custom uploader name (for display only)",
        hidden: true,
        default: ""
    },
    customRequestUrl: {
        type: 0 /* OptionType.STRING */,
        description: "Custom uploader request URL (ShareX: RequestURL)",
        hidden: true,
        default: ""
    },
    customFileFormName: {
        type: 0 /* OptionType.STRING */,
        description: "Custom uploader file form name (ShareX: FileFormName)",
        hidden: true,
        default: "file"
    },
    customResponseType: {
        type: 4 /* OptionType.SELECT */,
        description: "Custom uploader response type (ShareX: ResponseType)",
        hidden: true,
        options: [
            { label: "Text", value: "Text", default: true },
            { label: "JSON", value: "JSON" },
        ]
    },
    customUrlPath: {
        type: 0 /* OptionType.STRING */,
        description: "Custom uploader URL path (ShareX: URL). For JSON, use dot-path like data.url; for Text, ignored.",
        hidden: true,
        default: ""
    },
    config: {
        type: 6 /* OptionType.COMPONENT */,
        description: "Uploader settings",
        component: SettingsComponent
    }
}).withPrivateSettings();
const CATBOX_IMAGE_HOSTS = [
    "files.catbox.moe",
    "litter.catbox.moe",
    "gofile.io", // Added for preview
    "File.fast" // Added for preview
];
const PREVIEW_IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp"];
const MAX_BROWSER_PICKED_FILE_BYTES = 1024 * 1024 * 1024;
function isHttpUrl(input) {
    try {
        const url = new URL(input);
        return url.protocol === "http:" || url.protocol === "https:";
    }
    catch {
        return false;
    }
}
function safeJsonParseObject(label, input) {
    if (!input?.trim())
        return { ok: true, value: {} };
    try {
        const parsed = JSON.parse(input);
        if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed))
            return { ok: false, error: `${label} must be a JSON object` };
        const out = {};
        for (const [k, v] of Object.entries(parsed)) {
            if (["__proto__", "constructor", "prototype"].includes(k))
                return { ok: false, error: `${label} contains an unsafe key (${k})` };
            if (v == null)
                continue;
            out[String(k)] = String(v);
        }
        return { ok: true, value: out };
    }
    catch (err) {
        return { ok: false, error: `Failed to parse ${label}: ${String(err)}` };
    }
}
function getUploaderDisplayName(uploader) {
    if (uploader === "Custom")
        return settings.store.customName?.trim() ? `Custom (${settings.store.customName.trim()})` : "Custom";
    return uploader;
}
function getDestination(uploader) {
    switch (uploader) {
        case "Catbox":
            return { host: "catbox.moe", url: "https://catbox.moe/user/api.php" };
        case "Litterbox":
            return { host: "litterbox.catbox.moe", url: "https://litterbox.catbox.moe/resources/internals/api.php" };
        case "GoFile":
            return { host: "gofile.io", url: "https://upload.gofile.io/uploadFile", note: "Server is selected automatically by GoFile." };
        case "FileFast":
            return { host: "file.fast", url: "https://file.fast/api/v1/upload", note: "Fast uploads." };
        case "Custom": {
            const url = settings.store.customRequestUrl?.trim() ?? "";
            let host = "";
            try {
                host = url ? new URL(url).host : "";
            }
            catch { }
            return { host: host || "(invalid URL)", url: url || "(not set)" };
        }
    }
}
function fileBaseName(input) {
    if (typeof input !== "string")
        return null;
    const trimmed = input.trim();
    if (!trimmed)
        return null;
    const parts = trimmed.split(/[\\/]/);
    return parts[parts.length - 1] || null;
}
function inferExtFromBytes(bytes) {
    if (bytes.length < 12)
        return null;
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47
        && bytes[4] === 0x0D && bytes[5] === 0x0A && bytes[6] === 0x1A && bytes[7] === 0x0A)
        return "png";
    // JPEG: FF D8 FF
    if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF)
        return "jpg";
    // GIF: GIF8
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38)
        return "gif";
    // PDF: %PDF
    if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)
        return "pdf";
    // ZIP: PK\x03\x04
    if (bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04)
        return "zip";
    // RIFF....WEBP
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
        && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50)
        return "webp";
    // OGG: OggS
    if (bytes[0] === 0x4F && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53)
        return "ogg";
    // MP4: ....ftyp
    if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70)
        return "mp4";
    // WebM/Matroska: 1A 45 DF A3
    if (bytes[0] === 0x1A && bytes[1] === 0x45 && bytes[2] === 0xDF && bytes[3] === 0xA3)
        return "webm";
    // MP3: ID3
    if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33)
        return "mp3";
    return null;
}
function normalizePickedFileName(baseName, mimeType, bytes) {
    const name = (baseName?.trim() || "upload").replaceAll("\u0000", "");
    const lastDot = name.lastIndexOf(".");
    const ext = lastDot > 0 ? name.slice(lastDot + 1).toLowerCase() : "";
    const inferredExt = MIME_TO_EXT[mimeType.toLowerCase()]
        ?? inferExtFromBytes(bytes);
    if (ext && ext !== "bin")
        return name;
    if (!inferredExt)
        return name;
    if (ext === "bin")
        return name.slice(0, Math.max(0, lastDot)) + "." + inferredExt;
    return name + "." + inferredExt;
}
function normalizePickedMimeType(mimeType, fileName) {
    const lower = (mimeType || "").toLowerCase();
    if (lower && lower !== "application/octet-stream")
        return lower;
    const dot = fileName.lastIndexOf(".");
    const ext = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : "";
    return EXT_TO_MIME[ext] ?? "application/octet-stream";
}
async function pickFile() {
    if (IS_DISCORD_DESKTOP) {
        const [file] = await DiscordNative.fileManager.openFiles({
            filters: [{ name: "all", extensions: ["*"] }]
        });
        if (!file)
            return null;
        const anyFile = file;
        const baseName = fileBaseName(anyFile.path)
            ?? fileBaseName(anyFile.filePath)
            ?? fileBaseName(anyFile.fullPath)
            ?? fileBaseName(anyFile.name)
            ?? fileBaseName(anyFile.fileName)
            ?? fileBaseName(anyFile.filename);
        const rawMime = String(anyFile.mimeType ?? anyFile.type ?? "application/octet-stream");
        const name = normalizePickedFileName(baseName, rawMime, file.data);
        const mimeType = normalizePickedMimeType(rawMime, name);
        return {
            name,
            bytes: file.data,
            mimeType,
        };
    }
    const file = await chooseFile("*/*");
    if (!file)
        return null;
    if (file.size > MAX_BROWSER_PICKED_FILE_BYTES)
        throw new Error("Selected file is too large to read in the browser path.");
    const name = normalizePickedFileName(file.name, file.type || "application/octet-stream", new Uint8Array(await file.slice(0, 64).arrayBuffer()));
    const mimeType = normalizePickedMimeType(file.type || "application/octet-stream", name);
    return {
        name,
        bytes: new Uint8Array(await file.arrayBuffer()),
        mimeType
    };
}
function buildUploadPayload(file) {
    const { bytes } = file;
    const ab = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? bytes.buffer
        : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return {
        fileBuffer: ab,
        fileName: file.name,
        fileType: file.mimeType || "application/octet-stream",
        fileSizeBytes: bytes.byteLength,
    };
}
function maybeWrapVideo(url, fileName, fileSizeBytes) {
    if (!settings.store.wrapVideoEmbeds)
        return url;
    const lower = fileName.toLowerCase();
    const isVideo = VIDEO_EXTENSIONS.some(ext => lower.endsWith(ext));
    const isLarge = fileSizeBytes >= 150 * 1024 * 1024;
    return isVideo && isLarge ? `https://embeds.video/${url}` : url;
}
function humanError(err) {
    if (err instanceof Error)
        return err.message || String(err);
    return String(err);
}
function isRetryableNetworkError(err) {
    const msg = humanError(err);
    return (msg.includes("ECONNRESET")
        || msg.includes("ETIMEDOUT")
        || msg.includes("ERR_CONNECTION_TIMED_OUT")
        || msg.includes("ERR_NETWORK_CHANGED")
        || msg.includes("socket hang up")
        || msg.includes("network timeout"));
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function createProgressToast() {
    const id = Toasts.genId();
    return {
        show(message, type = Toasts.Type.MESSAGE, duration = 3500) {
            Toasts.show({
                id,
                message,
                type,
                options: {
                    duration,
                    position: Toasts.Position.BOTTOM
                }
            });
        }
    };
}
async function confirmUploadIfNeeded(uploader, payload) {
    if (!settings.store.confirmBeforeUpload) {
        if (settings.store.showDestinationPreview) {
            const dest = getDestination(uploader);
            showToast(`Uploading to ${dest.host} (${dest.url})…`, Toasts.Type.MESSAGE);
        }
        return true;
    }
    const dest = getDestination(uploader);
    const body = (<div>
            <Forms.FormText className={Margins.bottom8}>
                You are about to upload <b>{payload.fileName}</b> ({(payload.fileSizeBytes / (1024 * 1024)).toFixed(2)} MiB) to <b>{getUploaderDisplayName(uploader)}</b>.
            </Forms.FormText>
            {settings.store.showDestinationPreview && (<div className={Margins.top8}>
                    <Forms.FormText><b>Destination host:</b> {dest.host}</Forms.FormText>
                    <Forms.FormText><b>Destination URL:</b> {dest.url}</Forms.FormText>
                    {dest.note && <Forms.FormText>{dest.note}</Forms.FormText>}
                    {uploader === "Custom" && (<Forms.FormText className={Margins.top8}>
                            For custom uploaders, make sure you trust the endpoint and configured headers.
                        </Forms.FormText>)}
                </div>)}
        </div>);
    return await new Promise(resolve => {
        Alerts.show({
            title: "Confirm upload",
            body,
            confirmText: "Upload",
            cancelText: "Cancel",
            onConfirm: () => resolve(true),
            onCancel: () => resolve(false)
        });
    });
}
function validateCustomSettings() {
    const requestUrl = settings.store.customRequestUrl?.trim() ?? "";
    if (!requestUrl)
        return { ok: false, error: "Custom uploader: Request URL is required." };
    if (!isHttpUrl(requestUrl))
        return { ok: false, error: "Custom uploader: Request URL must be a valid http(s) URL." };
    const fileFormName = settings.store.customFileFormName?.trim() ?? "";
    if (!fileFormName)
        return { ok: false, error: "Custom uploader: File form name is required." };
    const responseType = settings.store.customResponseType;
    if (responseType !== "Text" && responseType !== "JSON")
        return { ok: false, error: "Custom uploader: Response type must be Text or JSON." };
    const urlPathRaw = settings.store.customUrlPath?.trim() ?? "";
    const urlPath = responseType === "JSON"
        ? urlPathRaw.split(".").map(s => s.trim()).filter(Boolean)
        : [];
    if (responseType === "JSON" && urlPath.length === 0)
        return { ok: false, error: "Custom uploader: URL path is required for JSON responses (e.g. data.url)." };
    const argsParsed = safeJsonParseObject("custom arguments", settings.store.customArgsJson);
    if (!argsParsed.ok)
        return { ok: false, error: argsParsed.error };
    const headersParsed = safeJsonParseObject("custom headers", settings.store.customHeadersJson);
    if (!headersParsed.ok)
        return { ok: false, error: headersParsed.error };
    return { ok: true, args: argsParsed.value, headers: headersParsed.value, urlPath };
}
async function uploadToService(uploader, payload) {
    if (!Native)
        throw new Error("This plugin currently requires Discord Desktop.");
    switch (uploader) {
        case "GoFile": {
            return await Native.uploadFileToGofileNative(payload.fileBuffer, payload.fileName, payload.fileType, settings.store.gofileToken?.trim() || undefined);
        }
        case "Catbox": {
            return await Native.uploadFileToCatboxNative(payload.fileBuffer, payload.fileName, payload.fileType, settings.store.catboxUserHash?.trim() || undefined);
        }
        case "Litterbox": {
            return await Native.uploadFileToLitterboxNative(payload.fileBuffer, payload.fileName, payload.fileType, settings.store.litterboxTime);
        }
        case "FileFast": {
            return await Native.uploadFileToFilefastNative(payload.fileBuffer, payload.fileName, payload.fileType, settings.store.filefastToken?.trim() || undefined);
        }
        case "Custom": {
            const validated = validateCustomSettings();
            if (!validated.ok)
                throw new Error(validated.error);
            return await Native.uploadFileCustomNative(settings.store.customRequestUrl.trim(), payload.fileBuffer, payload.fileName, payload.fileType, settings.store.customFileFormName.trim(), validated.args, validated.headers, settings.store.customResponseType, validated.urlPath);
        }
    }
}
async function sendOrInsert(channelId, url) {
    if (settings.store.autoSend) {
        // Sending the URL without extra surrounding text makes Discord more likely to generate embeds.
        await sendMessage(channelId, { content: url });
        showToast("Upload link sent!", Toasts.Type.SUCCESS);
    }
    else {
        insertTextIntoChatInputBox(`${url} `);
        await copyWithToast(url, "Upload link copied!");
    }
}
function tryGetPreviewableCatboxUrl(messageContent) {
    const match = messageContent.match(/https?:\/\/[^\s<>]+/g);
    if (!match?.length)
        return null;
    for (const raw of match) {
        let url;
        try {
            url = new URL(raw);
        }
        catch {
            continue;
        }
        if (!CATBOX_IMAGE_HOSTS.includes(url.hostname))
            continue;
        const path = url.pathname;
        const dot = path.lastIndexOf(".");
        if (dot <= 0)
            continue;
        const ext = path.slice(dot + 1).toLowerCase();
        if (!PREVIEW_IMAGE_EXTS.includes(ext))
            continue;
        return url.toString();
    }
    return null;
}
let uploadInFlight = false;
async function runUploadFlow(channelId) {
    if (uploadInFlight)
        return;
    uploadInFlight = true;
    try {
        if (!Native)
            throw new Error("This plugin currently requires Discord Desktop.");
        const uploader = settings.store.uploader;
        const picked = await pickFile();
        if (!picked)
            return;
        const payload = buildUploadPayload(picked);
        const ok = await confirmUploadIfNeeded(uploader, payload);
        if (!ok)
            return;
        const toast = createProgressToast();
        toast.show(`Starting upload via ${getUploaderDisplayName(uploader)}…`);
        const maxAttempts = 3;
        let url = null;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                if (attempt > 1)
                    toast.show(`Retrying upload (${attempt}/${maxAttempts})…`);
                url = await uploadToService(uploader, payload);
                break;
            }
            catch (err) {
                if (attempt >= maxAttempts || !isRetryableNetworkError(err))
                    throw err;
                toast.show(`Network error; retrying (${attempt + 1}/${maxAttempts})…`, Toasts.Type.MESSAGE, 4000);
                await sleep(900 * attempt);
            }
        }
        if (typeof url !== "string" || !(url.startsWith("http://") || url.startsWith("https://")))
            throw new Error("Upload succeeded but returned an invalid URL.");
        const finalUrl = maybeWrapVideo(url, payload.fileName, payload.fileSizeBytes);
        await sendOrInsert(channelId, finalUrl);
        toast.show("Upload complete.", Toasts.Type.SUCCESS);
    }
    catch (err) {
        showToast(`Upload failed: ${humanError(err)}`, Toasts.Type.FAILURE);
    }
    finally {
        UploadManager.clearAll(channelId, DraftType.ChannelMessage);
        uploadInFlight = false;
    }
}
const ctxMenuPatch = (children, props) => {
    if (children.find(c => c?.props?.id === "vc-big-file-upload"))
        return;
    if (props.channel.guild_id && !PermissionStore.can(PermissionsBits.SEND_MESSAGES, props.channel))
        return;
    children.splice(1, 0, <Menu.MenuItem id="vc-big-file-upload" label={<div>
                    <OpenExternalIcon height={24} width={24}/>
                    <div>Upload Big File (Enhanced)</div>
                </div>} action={() => runUploadFlow(props.channel.id)}/>);
};
function SettingsComponent() {
    const uploader = settings.store.uploader;
    const dest = useMemo(() => getDestination(uploader), [uploader, settings.store.customRequestUrl]);
    const importShareXConfig = async () => {
        const sxcuText = IS_DISCORD_DESKTOP
            ? (await (async () => {
                const [f] = await DiscordNative.fileManager.openFiles({ filters: [{ name: "ShareX Uploader", extensions: ["sxcu"] }] });
                return f ? new TextDecoder().decode(f.data) : null;
            })())
            : (await (async () => {
                const f = await chooseFile(".sxcu");
                return f ? await f.text() : null;
            })());
        if (!sxcuText)
            return;
        let parsed;
        try {
            parsed = JSON.parse(sxcuText);
        }
        catch (err) {
            showToast(`Failed to parse .sxcu JSON: ${humanError(err)}`, Toasts.Type.FAILURE);
            return;
        }
        settings.store.uploader = "Custom";
        settings.store.customName = String(parsed?.Name ?? "");
        settings.store.customRequestUrl = String(parsed?.RequestURL ?? "");
        settings.store.customFileFormName = String(parsed?.FileFormName ?? "file");
        settings.store.customResponseType = (parsed?.ResponseType === "JSON" ? "JSON" : "Text");
        settings.store.customUrlPath = String(parsed?.URL ?? "");
        settings.store.customHeadersJson = JSON.stringify(parsed?.Headers ?? {}, null, 2);
        settings.store.customArgsJson = JSON.stringify(parsed?.Arguments ?? {}, null, 2);
        showToast("Imported ShareX uploader config.", Toasts.Type.SUCCESS);
    };
    return (<div>
            <Forms.FormTitle>Safety</Forms.FormTitle>
            <Forms.FormText className={Margins.bottom8}>
                This uploads files to a third-party host and then shares the resulting link in chat.
            </Forms.FormText>

            <Forms.FormText className={Margins.bottom8}>
                Current destination: <b>{dest.host}</b> ({dest.url})
            </Forms.FormText>

            <Divider className={Margins.bottom16}/>

            <Forms.FormTitle>General</Forms.FormTitle>
            <div className={Margins.bottom16}>
                <Select options={[
            { label: "Catbox", value: "Catbox" },
            { label: "Litterbox (Catbox)", value: "Litterbox" },
            { label: "GoFile", value: "GoFile" },
            { label: "FileFast", value: "FileFast" },
            { label: "Custom (ShareX-compatible)", value: "Custom" },
        ]} serialize={v => v} select={(v) => settings.store.uploader = v} isSelected={(v) => v === uploader}/>
            </div>

            <FormSwitch title="Confirm before upload" description="Ask for confirmation before uploading" value={settings.store.confirmBeforeUpload} onChange={v => settings.store.confirmBeforeUpload = v}/>

            <FormSwitch title="Show destination preview" description="Show destination host + URL in the confirmation dialog" value={settings.store.showDestinationPreview} onChange={v => settings.store.showDestinationPreview = v}/>

            <FormSwitch title="Auto-send link" description="If disabled, the link is copied and inserted into the chat box" value={settings.store.autoSend} onChange={v => settings.store.autoSend = v}/>

            <FormSwitch title="Opt-in: embeds.video wrapping" description="Wraps large video links with embeds.video (adds a 3rd-party redirect)" value={settings.store.wrapVideoEmbeds} onChange={v => settings.store.wrapVideoEmbeds = v}/>

            {uploader === "GoFile" && (<>
                    <Divider className={Margins.bottom16}/>
                    <Forms.FormTitle>GoFile</Forms.FormTitle>
                    <TextInput label="Token (optional, stored privately)" type="password" value={settings.store.gofileToken ?? ""} placeholder="GoFile token" onChange={v => settings.store.gofileToken = v}/>
                </>)}

            {uploader === "Catbox" && (<>
                    <Divider className={Margins.bottom16}/>
                    <Forms.FormTitle>Catbox</Forms.FormTitle>
                    <TextInput label="User hash (optional, stored privately)" type="password" value={settings.store.catboxUserHash ?? ""} placeholder="Catbox user hash" onChange={v => settings.store.catboxUserHash = v}/>
                </>)}

            {uploader === "FileFast" && (<>
                    <Divider className={Margins.bottom16}/>
                    <Forms.FormTitle>FileFast</Forms.FormTitle>
                    <Forms.FormText className={Margins.bottom8}>
                        Fast file uploads. Files do not expire.
                    </Forms.FormText>
                    <TextInput label="Token (optional, stored privately)" type="password" value={settings.store.filefastToken ?? ""} placeholder="FileFast token" onChange={v => settings.store.filefastToken = v}/>
                </>)}

            {uploader === "Litterbox" && (<>
                    <Divider className={Margins.bottom16}/>
                    <Forms.FormTitle>Litterbox</Forms.FormTitle>
                    <div className={Margins.bottom16}>
                        <Select options={[
                { label: "1 hour", value: "1h" },
                { label: "12 hours", value: "12h" },
                { label: "24 hours", value: "24h" },
                { label: "72 hours", value: "72h" },
            ]} serialize={v => v} select={(v) => settings.store.litterboxTime = v} isSelected={(v) => v === settings.store.litterboxTime}/>
                    </div>
                </>)}

            {uploader === "Custom" && (<>
                    <Divider className={Margins.bottom16}/>
                    <Forms.FormTitle>Custom (ShareX)</Forms.FormTitle>
                    <div className={Margins.bottom16}>
                        <Button onClick={importShareXConfig}>Import ShareX config</Button>
                    </div>

                    <TextInput label="Name (display only)" value={settings.store.customName} onChange={v => settings.store.customName = v} placeholder="My uploader"/>

                    <TextInput label="Request URL" value={settings.store.customRequestUrl} onChange={v => settings.store.customRequestUrl = v} placeholder="https://example.com/upload"/>

                    <TextInput label="File form name" value={settings.store.customFileFormName} onChange={v => settings.store.customFileFormName = v} placeholder="file"/>

                    <div className={Margins.bottom16}>
                        <Select options={[
                { label: "Text", value: "Text" },
                { label: "JSON", value: "JSON" },
            ]} serialize={v => v} select={(v) => settings.store.customResponseType = v} isSelected={(v) => v === settings.store.customResponseType}/>
                    </div>

                    <TextInput label="URL path (JSON dot-path, or ignored for Text)" value={settings.store.customUrlPath} onChange={v => settings.store.customUrlPath = v} placeholder="data.url"/>

                    <div className={Margins.bottom16}>
                        <Forms.FormText>Arguments JSON (stored privately)</Forms.FormText>
                        <TextArea value={settings.store.customArgsJson ?? ""} onChange={v => settings.store.customArgsJson = v} placeholder='{"key":"value"}' rows={3}/>
                    </div>

                    <div className={Margins.bottom16}>
                        <Forms.FormText>Headers JSON (stored privately)</Forms.FormText>
                        <TextArea value={settings.store.customHeadersJson ?? ""} onChange={v => settings.store.customHeadersJson = v} placeholder='{"Authorization":"Bearer ..."}' rows={3}/>
                    </div>

                    <Button onClick={() => {
                const result = validateCustomSettings();
                if (result.ok)
                    showToast("Custom uploader settings look OK.", Toasts.Type.SUCCESS);
                else
                    showToast(result.error, Toasts.Type.FAILURE);
            }}>
                        Validate custom settings
                    </Button>
                </>)}
        </div>);
}
export default definePlugin({
    name: "BigFileUploadEnhanced",
    description: "Bypass Discord's upload limit by uploading files to a third-party host and sending the link in chat, this version offers (soon more options) and not using dom manipulation (faster)",
    tags: ["Utility", "Chat"],
    authors: [EquicordDevs.Benjii, TestcordDevs.x2b],
    settings,
    contextMenus: {
        "channel-attach": ctxMenuPatch,
    },
    renderMessageAccessory(props) {
        if (!settings.store.renderImagePreviews)
            return;
        const message = props?.message;
        const content = message?.content;
        if (typeof content !== "string" || !content)
            return;
        // If Discord already embedded something, don't duplicate.
        if (Array.isArray(message?.embeds) && message.embeds.length)
            return;
        if (Array.isArray(message?.attachments) && message.attachments.length)
            return;
        const url = tryGetPreviewableCatboxUrl(content);
        if (!url)
            return;
        return (<div className={Margins.top8} style={{ maxWidth: 550 }}>
                <img src={url} style={{
                maxWidth: "100%",
                borderRadius: 8,
                cursor: "pointer",
                display: "block",
            }} onClick={() => openImageModal({ url, width: 1200 })}/>
            </div>);
    }
});
