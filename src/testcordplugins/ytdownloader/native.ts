/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChildProcessWithoutNullStreams, execFile, spawn } from "child_process";
import { IpcMainInvokeEvent } from "electron";
import * as fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

type Format = "video" | "audio";
type DownloadOptions = {
    url: string;
    format: Format;
    quality?: string;
    maxFileSize?: number;
};

type RunContext = {
    stdout: string;
    logs: string;
};

let workdir: string | null = null;

let ytdlpAvailable = false;
let denoAvailable = false;
let ffmpegAvailable = false;

let ytdlpProcess: ChildProcessWithoutNullStreams | null = null;
let ffmpegProcess: ChildProcessWithoutNullStreams | null = null;

let lastStdout = "";

const MAX_DOWNLOAD_DURATION_SECONDS = 30 * 60;
const MAX_RETURN_BYTES = 500 * 1024 * 1024;

const getdir = () => workdir ?? process.cwd();
const p = (file: string) => path.join(getdir(), file);
const cleanVideoFiles = () => {
    if (!workdir) return;
    fs.readdirSync(workdir)
        .filter(f => f !== "." && f !== "..")
        .forEach(f => fs.unlinkSync(p(f)));
};
const appendOut = (ctx: RunContext, data: string) => {
    ctx.stdout += data;
    ctx.stdout = ctx.stdout.replace(/^.*\r([^\n])/gm, "$1");
    lastStdout = ctx.stdout;
};
const log = (ctx: RunContext, ...data: string[]) => {
    console.log(`[Plugin:YTdownloader] ${data.join(" ")}`);
    ctx.logs += `[Plugin:YTdownloader] ${data.join(" ")}\n`;
};
const error = (...data: string[]) => console.error(`[Plugin:YTdownloader] [ERROR] ${data.join(" ")}`);

function killActiveProcesses() {
    ytdlpProcess?.kill();
    ffmpegProcess?.kill();
}

function ytdlp(ctx: RunContext, args: string[]): Promise<string> {
    log(ctx, `Executing yt-dlp with args: ["${args.map(a => a.replace('"', '\\"')).join('", "')}"]`);
    let errorMsg = "";

    return new Promise<string>((resolve, reject) => {
        ytdlpProcess = spawn("yt-dlp", args, {
            cwd: getdir(),
        });

        ytdlpProcess.stdout.on("data", data => appendOut(ctx, data));
        ytdlpProcess.stderr.on("data", data => {
            appendOut(ctx, data);
            error(`yt-dlp encountered an error: ${data}`);
            errorMsg += data;
        });
        ytdlpProcess.on("error", err => {
            ytdlpProcess = null;
            reject(err instanceof Error ? err : new Error(String(err)));
        });
        ytdlpProcess.on("exit", code => {
            ytdlpProcess = null;
            code === 0 ? resolve(ctx.stdout) : reject(new Error(errorMsg || `yt-dlp exited with code ${code}`));
        });
    });
}

function ffmpeg(ctx: RunContext, args: string[]): Promise<string> {
    log(ctx, `Executing ffmpeg with args: ["${args.map(a => a.replace('"', '\\"')).join('", "')}"]`);
    let errorMsg = "";

    return new Promise<string>((resolve, reject) => {
        ffmpegProcess = spawn("ffmpeg", args, {
            cwd: getdir(),
        });

        ffmpegProcess.stdout.on("data", data => appendOut(ctx, data));
        ffmpegProcess.stderr.on("data", data => {
            appendOut(ctx, data);
            error(`ffmpeg encountered an error: ${data}`);
            errorMsg += data;
        });
        ffmpegProcess.on("error", err => {
            ffmpegProcess = null;
            reject(err instanceof Error ? err : new Error(String(err)));
        });
        ffmpegProcess.on("exit", code => {
            ffmpegProcess = null;
            code === 0 ? resolve(ctx.stdout) : reject(new Error(errorMsg || `ffmpeg exited with code ${code}`));
        });
    });
}

export async function start(_: IpcMainInvokeEvent) {
    // Always a fresh dir under tmpdir: this path is rmSync'd in stop(),
    // so it must never be renderer- or user-controllable
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "vencord_YTdownloader_"));
    console.log(`[Plugin:YTdownloader] Using workdir: ${workdir}`);
    return workdir;
}

export async function stop(_: IpcMainInvokeEvent) {
    killActiveProcesses();
    if (workdir) {
        console.log("[Plugin:YTdownloader] Cleaning up workdir");
        fs.rmSync(workdir, { recursive: true });
        workdir = null;
    }
}

async function metadata(ctx: RunContext, options: DownloadOptions) {
    ctx.stdout = "";
    const output = await ytdlp(ctx, ["-J", options.url, "--no-warnings"]);
    const metadata = JSON.parse(output);

    if (metadata.is_live) throw new Error("Live streams are not supported.");
    if (typeof metadata.duration === "number" && metadata.duration > MAX_DOWNLOAD_DURATION_SECONDS) {
        throw new Error("Media is too long to download safely.");
    }

    ctx.stdout = "";
    return { videoTitle: metadata.title || "video" };
}

function genFormat(ctx: RunContext, { videoTitle }: { videoTitle: string; }, { format, quality }: DownloadOptions) {
    let format_string = "";

    // Default qualities
    const videoHeight = quality && !isNaN(parseInt(quality)) ? parseInt(quality) : 1080;
    const audioBitrate = quality && !isNaN(parseInt(quality)) ? parseInt(quality) : 320;

    if (format === "audio") {
        // Audio format string: prefer higher bitrate audio
        format_string = "bestaudio[abr>=320]/bestaudio[abr>=256]/bestaudio[abr>=192]/bestaudio[abr>=128]/bestaudio/best";
        log(ctx, `Audio format selected. Target bitrate: ${audioBitrate}k`);
    } else {
        // Video format string: best video up to height + best audio
        // If ffmpeg is available, we can merge video+audio, otherwise we prefer single file
        if (ffmpegAvailable) {
            format_string = `bestvideo[height<=${videoHeight}]+bestaudio/best[height<=${videoHeight}]`;
        } else {
            format_string = `best[height<=${videoHeight}][ext=mp4]/best[height<=${videoHeight}]`;
        }
        log(ctx, `Video format selected. Max height: ${videoHeight}p`);
    }

    log(ctx, "Format string calculated as ", format_string);
    return { format: format_string, videoTitle, audioBitrate, videoHeight };
}

async function download(ctx: RunContext, { format, videoTitle }: { format: string; videoTitle: string; }, { url, format: usrFormat, audioBitrate }: DownloadOptions & { audioBitrate?: number; }) {
    cleanVideoFiles();
    const baseArgs = ["-f", format, "-o", "download.%(ext)s", "--force-overwrites", "-I", "1"];

    const customArgs: string[] = [];

    if (usrFormat === "audio") {
        // Extract to mp3. If ffmpeg is missing, this might fail or download original format
        if (ffmpegAvailable) {
            customArgs.push("--extract-audio", "--audio-format", "mp3", "--audio-quality", `${audioBitrate}K`);
        } else {
            log(ctx, "FFmpeg not available, downloading original audio format.");
        }
    }

    try {
        await ytdlp(ctx, [url, ...baseArgs, ...customArgs]);
    } catch (err) {
        console.error("Error during yt-dlp execution:", err);
        throw err;
    }

    const file = fs.readdirSync(getdir()).find(f => f.startsWith("download."));
    if (!file) throw new Error("No video file was found!");
    return { file, videoTitle };
}

async function remux(ctx: RunContext, { file, videoTitle }: { file: string; videoTitle: string; }, { format, maxFileSize }: DownloadOptions) {
    const sourceExtension = file.split(".").pop();
    if (!ffmpegAvailable) return log(ctx, "Skipping remux, ffmpeg is unavailable."), { file, videoTitle, extension: sourceExtension };

    // Discord likes mp4 and webm
    const acceptableFormats = ["mp4", "webm", "mp3"];
    const fileSize = fs.statSync(p(file)).size;

    const isFormatAcceptable = acceptableFormats.includes(sourceExtension ?? "");
    const isFileSizeAcceptable = (!maxFileSize || fileSize <= maxFileSize);

    // If audio, we already converted it in the download step via yt-dlp if possible
    // If video, we ensure it's mp4
    if (isFormatAcceptable && isFileSizeAcceptable && format === "audio") {
        return { file, videoTitle, extension: sourceExtension };
    }

    if (format === "video" && (!isFormatAcceptable || !isFileSizeAcceptable)) {
        const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", p(file)]);
        const duration = parseFloat(stdout.toString());
        if (isNaN(duration)) throw new Error("Failed to get video duration.");

        // Target size calculation (reduce slightly to be safe)
        const targetBits = maxFileSize ? (maxFileSize * 0.9) : 50000000;
        const kilobits = ~~(targetBits / duration);

        // Re-encode to mp4 if not acceptable
        const ext = "mp4";
        const baseArgs = ["-i", p(file), "-c:v", "libx264", "-c:a", "aac", "-b:a", "192k", "-b:v", `${kilobits}k`, "-maxrate", `${kilobits}k`, "-bufsize", "1M", "-movflags", "+faststart", "-y", `remux.${ext}`];

        await ffmpeg(ctx, baseArgs);
        return { file: `remux.${ext}`, videoTitle, extension: ext };
    }

    return { file, videoTitle, extension: sourceExtension };
}

function upload({ file, videoTitle, extension }: { file: string; videoTitle: string; extension: string | undefined; }, maxFileSize?: number) {
    if (!extension) throw new Error("Invalid extension.");
    const fileSize = fs.statSync(p(file)).size;
    const sizeLimit = maxFileSize ?? MAX_RETURN_BYTES;
    if (fileSize > sizeLimit) throw new Error("Downloaded file is too large to return safely.");

    const buffer = fs.readFileSync(p(file));
    return { buffer, title: `${videoTitle}.${extension}` };
}

export async function execute(
    _: IpcMainInvokeEvent,
    opt: DownloadOptions
): Promise<{
    buffer: Buffer;
    title: string;
    logs: string;
} | {
    error: string;
    logs: string;
}> {
    const ctx: RunContext = { stdout: "", logs: "" };
    try {
        const videoMetadata = await metadata(ctx, opt);
        const videoFormat = genFormat(ctx, videoMetadata, opt);
        const videoDownload = await download(ctx, videoFormat, opt);
        const videoRemux = await remux(ctx, videoDownload, opt);
        const videoUpload = upload(videoRemux, opt.maxFileSize);
        return { logs: ctx.logs, ...videoUpload };
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return { error: message, logs: ctx.logs };
    }
}

export async function checkffmpeg(_?: IpcMainInvokeEvent) {
    try {
        await execFileAsync("ffmpeg", ["-version"]);
        await execFileAsync("ffprobe", ["-version"]);
        ffmpegAvailable = true;
        return true;
    } catch {
        ffmpegAvailable = false;
        return false;
    }
}

export async function checkytdlp(_?: IpcMainInvokeEvent) {
    try {
        await execFileAsync("yt-dlp", ["--version"]);
        ytdlpAvailable = true;
        return true;
    } catch {
        ytdlpAvailable = false;
        return false;
    }
}

export async function checkdeno(_?: IpcMainInvokeEvent) {
    try {
        await execFileAsync("deno", ["--version"]);
        denoAvailable = true;
        return true;
    } catch {
        denoAvailable = false;
        return false;
    }
}

export async function interrupt(_: IpcMainInvokeEvent) {
    console.log("[Plugin:YTdownloader] Interrupting...");
    killActiveProcesses();
    cleanVideoFiles();
}

export const getStdout = () => lastStdout;
export const isYtdlpAvailable = () => ytdlpAvailable;
export const isFfmpegAvailable = () => ffmpegAvailable;
export const isDenoAvailable = () => denoAvailable;
