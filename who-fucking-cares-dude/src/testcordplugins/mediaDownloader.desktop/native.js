/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { execFileSync, spawn } from "child_process";
import * as fs from "fs";
import os from "os";
import path from "path";
let workdir = null;
let stdout_global = "";
let logs_global = "";
let ytdlpAvailable = false;
let ffmpegAvailable = false;
let ytdlpProcess = null;
let ffmpegProcess = null;
const MAX_DOWNLOAD_DURATION_SECONDS = 30 * 60;
const MAX_GIF_DURATION_SECONDS = 30;
const MAX_RETURN_BYTES = 500 * 1024 * 1024;
// Custom renderer-supplied args must never reach exec-capable or
// path-capable flags of yt-dlp/ffmpeg
const BLOCKED_YTDLP_ARGS = [
    /^--exec/,
    /^-o$/,
    /^--output/,
    /^-P/,
    /^--paths/,
    /^--postprocessor-args/,
    /^--ppa/,
    /^--downloader-args/,
    /^--external-downloader/,
    /^-a$/,
    /^--batch-file/,
    /^--config/,
    /^--plugin-director/
];
const looksLikePath = (arg) => arg.includes("/") || arg.includes("\\") || arg.startsWith("..") || /^[A-Za-z]:[\\/]/.test(arg);
function validateCustomArgs(tool, args) {
    for (const arg of args ?? []) {
        if (tool === "yt-dlp" && BLOCKED_YTDLP_ARGS.some(re => re.test(arg)))
            throw new Error(`"${arg}" is not allowed in custom yt-dlp arguments`);
        if (looksLikePath(arg))
            throw new Error(`"${arg}" is not allowed in custom ${tool} arguments`);
    }
}
const getdir = () => workdir ?? process.cwd();
const p = (file) => path.join(getdir(), file);
const cleanVideoFiles = () => {
    if (!workdir)
        return;
    fs.readdirSync(workdir)
        .filter(f => f.startsWith("download.") || f.startsWith("remux."))
        .forEach(f => fs.unlinkSync(p(f)));
};
const appendOut = (data) => ( // Makes carriage return (\r) work
(stdout_global += data), (stdout_global = stdout_global.replace(/^.*\r([^\n])/gm, "$1")));
const log = (...data) => (console.log(`[Plugin:MediaDownloader] ${data.join(" ")}`), logs_global += `[Plugin:MediaDownloader] ${data.join(" ")}\n`);
const error = (...data) => console.error(`[Plugin:MediaDownloader] [ERROR] ${data.join(" ")}`);
function killActiveProcesses() {
    ytdlpProcess?.kill();
    ffmpegProcess?.kill();
}
function ytdlp(args) {
    log(`Executing yt-dlp with args: ["${args.map(a => a.replace('"', '\\"')).join('", "')}"]`);
    let errorMsg = "";
    return new Promise((resolve, reject) => {
        ytdlpProcess = spawn("yt-dlp", args, {
            cwd: getdir(),
        });
        ytdlpProcess.stdout.on("data", data => appendOut(data));
        ytdlpProcess.stderr.on("data", data => {
            appendOut(data);
            error(`yt-dlp encountered an error: ${data}`);
            errorMsg += data;
        });
        ytdlpProcess.on("exit", code => {
            ytdlpProcess = null;
            code === 0 ? resolve(stdout_global) : reject(new Error(errorMsg || `yt-dlp exited with code ${code}`));
        });
    });
}
function ffmpeg(args) {
    log(`Executing ffmpeg with args: ["${args.map(a => a.replace('"', '\\"')).join('", "')}"]`);
    let errorMsg = "";
    return new Promise((resolve, reject) => {
        ffmpegProcess = spawn("ffmpeg", args, {
            cwd: getdir(),
        });
        ffmpegProcess.stdout.on("data", data => appendOut(data));
        ffmpegProcess.stderr.on("data", data => {
            appendOut(data);
            error(`ffmpeg encountered an error: ${data}`);
            errorMsg += data;
        });
        ffmpegProcess.on("exit", code => {
            ffmpegProcess = null;
            code === 0 ? resolve(stdout_global) : reject(new Error(errorMsg || `ffmpeg exited with code ${code}`));
        });
    });
}
export async function start(_) {
    // Always a fresh dir under tmpdir: this path is rmSync'd in stop(),
    // so it must never be renderer- or user-controllable
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "vencord_mediaDownloader_"));
    log("Using workdir: ", workdir);
    return workdir;
}
export async function stop(_) {
    killActiveProcesses();
    if (workdir) {
        log("Cleaning up workdir");
        fs.rmSync(workdir, { recursive: true });
        workdir = null;
    }
}
async function metadata(options) {
    try {
        stdout_global = "";
        const output = await ytdlp(["-J", options.url, "--no-warnings"]);
        const metadata = JSON.parse(output);
        if (metadata.is_live)
            throw new Error("Live streams are not supported.");
        if (typeof metadata.duration === "number" && metadata.duration > MAX_DOWNLOAD_DURATION_SECONDS) {
            throw new Error("Media is too long to download safely.");
        }
        stdout_global = "";
        return { videoTitle: `${metadata.title || "video"} (${metadata.id})` };
    }
    catch (err) {
        throw err;
    }
}
function genFormat({ videoTitle }, { maxFileSize, format }) {
    const HAS_LIMIT = !!maxFileSize;
    const MAX_VIDEO_SIZE = HAS_LIMIT ? maxFileSize * 0.8 : 0;
    const MAX_AUDIO_SIZE = HAS_LIMIT ? maxFileSize * 0.2 : 0;
    const audio = {
        noFfmpeg: "ba[ext=mp3]{TOT_SIZE}/wa[ext=mp3]{TOT_SIZE}",
        ffmpeg: "ba*{TOT_SIZE}/ba{TOT_SIZE}/wa*{TOT_SIZE}/ba*"
    };
    const video = {
        noFfmpeg: "b{TOT_SIZE}{HEIGHT}[ext=webm]/b{TOT_SIZE}{HEIGHT}[ext=mp4]/w{HEIGHT}{TOT_SIZE}",
        ffmpeg: "b*{VID_SIZE}{HEIGHT}+ba{AUD_SIZE}/b{TOT_SIZE}{HEIGHT}/b*{HEIGHT}+ba",
    };
    const gif = {
        ffmpeg: "bv{TOT_SIZE}/wv{TOT_SIZE}"
    };
    let format_group;
    switch (format) {
        case "audio":
            format_group = audio;
            break;
        case "gif":
            format_group = gif;
            break;
        case "video":
        default:
            format_group = video;
            break;
    }
    const format_string = (ffmpegAvailable ? format_group.ffmpeg : format_group.noFfmpeg)
        ?.replaceAll("{TOT_SIZE}", HAS_LIMIT ? `[filesize<${maxFileSize}]` : "")
        .replaceAll("{VID_SIZE}", HAS_LIMIT ? `[filesize<${MAX_VIDEO_SIZE}]` : "")
        .replaceAll("{AUD_SIZE}", HAS_LIMIT ? `[filesize<${MAX_AUDIO_SIZE}]` : "")
        .replaceAll("{HEIGHT}", "[height<=1080]");
    if (!format_string)
        throw "Gif format is only supported with ffmpeg.";
    log("Video formated calculated as ", format_string);
    log(`Based on: format=${format}, maxFileSize=${maxFileSize}, ffmpegAvailable=${ffmpegAvailable}`);
    return { format: format_string, videoTitle };
}
async function download({ format, videoTitle }, { ytdlpArgs, url, format: usrFormat }) {
    cleanVideoFiles();
    validateCustomArgs("yt-dlp", ytdlpArgs);
    const baseArgs = ["-f", format, "-o", "download.%(ext)s", "--force-overwrites", "-I", "1"];
    const remuxArgs = ffmpegAvailable
        ? usrFormat === "video"
            ? ["--remux-video", "webm>webm/mp4"]
            : usrFormat === "audio"
                ? ["--extract-audio", "--audio-format", "mp3"]
                : []
        : [];
    const customArgs = ytdlpArgs?.filter(Boolean) || [];
    try {
        await ytdlp([url, ...baseArgs, ...remuxArgs, ...customArgs]);
    }
    catch (err) {
        console.error("Error during yt-dlp execution:", err);
    }
    const file = fs.readdirSync(getdir()).find(f => f.startsWith("download."));
    if (!file)
        throw "No video file was found!";
    return { file, videoTitle };
}
async function remux({ file, videoTitle }, { ffmpegArgs, format, maxFileSize, gifQuality }) {
    const sourceExtension = file.split(".").pop();
    if (!ffmpegAvailable)
        return log("Skipping remux, ffmpeg is unavailable."), { file, videoTitle, extension: sourceExtension };
    // We only really need to remux if
    // 1. The file is too big
    // 2. The file is in a format not supported by discord
    // 3. The user provided custom ffmpeg arguments
    // 4. The target format is gif
    const acceptableFormats = ["mp3", "mp4", "webm"];
    const fileSize = fs.statSync(p(file)).size;
    const customArgs = ffmpegArgs?.filter(Boolean) || [];
    validateCustomArgs("ffmpeg", customArgs);
    const isFormatAcceptable = acceptableFormats.includes(sourceExtension ?? "");
    const isFileSizeAcceptable = (!maxFileSize || fileSize <= maxFileSize);
    const hasCustomArgs = customArgs.length > 0;
    const isGif = format === "gif";
    const isAudio = format === "audio";
    if (isFormatAcceptable && isFileSizeAcceptable && !hasCustomArgs && !isGif && !isAudio)
        return log("Skipping remux, file type and size are good, and no ffmpeg arguments were specified."), { file, videoTitle, extension: sourceExtension };
    const duration = parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", p(file)]).toString());
    if (isNaN(duration))
        throw "Failed to get video duration.";
    if (format === "gif" && duration > MAX_GIF_DURATION_SECONDS)
        throw "Media is too long to convert to GIF safely.";
    // ffmpeg tends to go above the target size, so I'm setting it to 7/8
    const targetBits = maxFileSize ? (maxFileSize * 7) / duration : 9999999;
    const kilobits = ~~(targetBits / 1024);
    let baseArgs;
    let ext;
    switch (format) {
        case "audio":
            const audioKilobits = Math.max(kilobits, 320);
            baseArgs = ["-i", p(file), "-b:a", `${audioKilobits}k`, "-maxrate", `${audioKilobits}k`, "-bufsize", "1M", "-y"];
            ext = "mp3";
            break;
        case "video":
        default:
            // Default to 1080p
            const height = 1080;
            baseArgs = ["-i", p(file), "-b:v", `${~~(kilobits * 0.8)}k`, "-b:a", `${~~(kilobits * 0.2)}k`, "-maxrate", `${kilobits}k`, "-bufsize", "1M", "-y", "-filter:v", `scale=-1:${height}`];
            ext = "mp4";
            break;
        case "gif":
            let fps, width, colors, bayer_scale;
            // WARNING: these parameters have been arbitrarily chosen, optimization is welcome!
            switch (gifQuality) {
                case 1:
                    fps = 5, width = 360, colors = 24, bayer_scale = 5;
                    break;
                case 2:
                    fps = 10, width = 420, colors = 32, bayer_scale = 5;
                    break;
                default:
                case 3:
                    fps = 15, width = 480, colors = 64, bayer_scale = 4;
                    break;
                case 4:
                    fps = 20, width = 540, colors = 64, bayer_scale = 3;
                    break;
                case 5:
                    fps = 30, width = 720, colors = 128, bayer_scale = 1;
                    break;
            }
            baseArgs = ["-i", p(file), "-vf", `fps=${fps},scale=w=${width}:h=-1:flags=lanczos,mpdecimate,split[s0][s1];[s0]palettegen=max_colors=${colors}[p];[s1][p]paletteuse=dither=bayer:bayer_scale=${bayer_scale}`, "-loop", "0", "-bufsize", "1M", "-y"];
            ext = "gif";
            break;
    }
    await ffmpeg([...baseArgs, ...customArgs, `remux.${ext}`]);
    return { file: `remux.${ext}`, videoTitle, extension: ext };
}
function upload({ file, videoTitle, extension }, maxFileSize) {
    if (!extension)
        throw "Invalid extension.";
    const fileSize = fs.statSync(p(file)).size;
    const sizeLimit = maxFileSize ?? MAX_RETURN_BYTES;
    if (fileSize > sizeLimit)
        throw "Downloaded file is too large to return safely.";
    const buffer = fs.readFileSync(p(file));
    return { buffer, title: `${videoTitle}.${extension}` };
}
export async function execute(_, opt) {
    logs_global = "";
    try {
        const videoMetadata = await metadata(opt);
        const videoFormat = genFormat(videoMetadata, opt);
        const videoDownload = await download(videoFormat, opt);
        const videoRemux = await remux(videoDownload, opt);
        const videoUpload = upload(videoRemux, opt.maxFileSize);
        return { logs: logs_global, ...videoUpload };
    }
    catch (e) {
        return { error: e.toString(), logs: logs_global };
    }
}
export function checkffmpeg(_) {
    try {
        execFileSync("ffmpeg", ["-version"]);
        execFileSync("ffprobe", ["-version"]);
        ffmpegAvailable = true;
        return true;
    }
    catch (e) {
        ffmpegAvailable = false;
        return false;
    }
}
export async function checkytdlp(_) {
    try {
        execFileSync("yt-dlp", ["--version"]);
        ytdlpAvailable = true;
        return true;
    }
    catch (e) {
        ytdlpAvailable = false;
        return false;
    }
}
export async function interrupt(_) {
    log("Interrupting...");
    killActiveProcesses();
    cleanVideoFiles();
}
export const getStdout = () => stdout_global;
export const isYtdlpAvailable = () => ytdlpAvailable;
export const isFfmpegAvailable = () => ffmpegAvailable;
