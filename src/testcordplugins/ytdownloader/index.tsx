/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import * as DataStore from "@api/DataStore";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { TestcordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import { openModal } from "@utils/modal";
import definePlugin, { OptionType, PluginNative, ReporterTestable } from "@utils/types";
import { Channel } from "@vencord/discord-types";
import { DraftType, FluxDispatcher, UploadHandler, UploadManager, UserStore } from "@webpack/common";

import { DependencyModal } from "./DependencyModal";

type ButtonComponent = {
    customId?: string;
    disabled?: boolean;
    emoji?: {
        animated?: boolean | string;
        id?: string;
        name?: string;
        src?: string;
    };
    id: string;
    label?: string;
    style: number;
    type: number;
    url?: string;
};

const Native = VencordNative.pluginHelpers.YTdownloader as PluginNative<typeof import("./native")>;
const logger = new Logger("YTdownloader", "#ff0000");

const maxFileSize = () => {
    const premiumType = (UserStore.getCurrentUser().premiumType ?? 0);
    if (premiumType === 2) return 500000000; // Nitro 500MB
    if (premiumType === 1 || premiumType === 3) return 50000000; // Classic || Basic 50MB
    return 25000000; // Base 25MB
};

/** Takes a string and splits it into an array of arguments. */
const argParse = (args: string): string[] => args.match(
    /(?:[^\s"']+|"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|([^\s]+))/g
) ?? [];

function mimetype(extension: "mp4" | "webm" | "mp3" | string) {
    switch (extension) {
        case "mp4":
            return "video/mp4";
        case "webm":
            return "video/webm";
        case "mp3":
            return "audio/mp3";
        default:
            return "application/octet-stream";
    }
}

const CancelButton = [{
    components: [{
        customId: "yt-downloader-stop-download",
        emoji: {
            name: "⚪",
            animated: "yt-downloader-stop-download",
            id: undefined
        },
        label: "Cancel download",
        id: "0,0",
        style: 4,
        type: 2,
    }], id: "0", type: 1
}] as any;

async function sendProgress(channelId: string, promise: Promise<{
    buffer: Buffer;
    title: string;
    logs: string;
} | {
    error: string;
    logs: string;
}>) {
    if (!settings.store.showProgress) {
        sendBotMessage(channelId, {
            components: CancelButton
        });
        return await promise;
    }
    const clydeMessage = sendBotMessage(channelId, {
        content: "Downloading...",
        components: CancelButton
    });

    const updateMessage = (stdout: string, append?: string) => {
        const text = stdout.toString();
        FluxDispatcher.dispatch({
            type: "MESSAGE_UPDATE",
            message: {
                ...clydeMessage,
                content: `Downloading...\n\`\`\`\n${text}\n\`\`\`${append || ""}`,
                components: append ? [] : clydeMessage.components
            }
        });
    };

    const id = setInterval(async () => {
        const stdout = await Native.getStdout();
        updateMessage(stdout);
    }, 500);

    try {
        const data = await promise;
        const stdout = await Native.getStdout();
        updateMessage(stdout, "error" in data ? "Error!" : "Done!");
        return data;
    } finally {
        clearInterval(id);
    }
}

function sendFfmpegWarning(channelId: string) {
    sendBotMessage(channelId, {
        content: "FFmpeg not detected. You may experience lower download quality or inability to convert formats."
    });
}

async function openDependencyModal() {
    const key = openModal((props: any) => (
        <ErrorBoundary>
            <DependencyModal props={props as any} options={{
                key,
                checkytdlp: Native.checkytdlp,
                checkdeno: Native.checkdeno,
            }} />
        </ErrorBoundary>
    ));
}

const settings = definePluginSettings({
    showProgress: {
        type: OptionType.BOOLEAN,
        description: "Send a Clyde message with the download progress.",
        default: true,
    },
    showFfmpegWarning: {
        type: OptionType.BOOLEAN,
        description: "Show a warning message if ffmpeg is not installed.",
        default: true,
    },
    downloadFolder: {
        type: OptionType.STRING,
        description: "Custom download folder path. Leave empty for temp directory.",
        default: "",
    },
    forceYtdlp: {
        type: OptionType.BOOLEAN,
        description: "Force mark yt-dlp as installed (skip detection).",
        default: false,
    },
    forceDeno: {
        type: OptionType.BOOLEAN,
        description: "Force mark Deno as installed (skip detection).",
        default: false,
    }
});

export default definePlugin({
    name: "YTdownloader",
    description: "Download music (320kbps) or video (1080p) from YouTube using yt-dlp and Deno. (plugin based on MediaDownloader)",
    tags: ["Media", "Utility"],
    authors: [TestcordDevs.x2b],
    reporterTestable: ReporterTestable.Patches,
    settings,
    commands: [{
        inputType: ApplicationCommandInputType.BUILT_IN,
        name: "ytd",
        description: "Download video or audio from YouTube.",
        options: [
            {
                name: "link",
                description: "The URL of the YouTube video.",
                required: true,
                type: ApplicationCommandOptionType.STRING
            },
            {
                name: "format",
                description: "Download type: Video or Audio.",
                type: ApplicationCommandOptionType.STRING,
                choices: [
                    { name: "Video", value: "video", label: "Video" },
                    { name: "Audio", value: "audio", label: "Audio" },
                ],
                required: true,
            },
            {
                name: "quality",
                type: ApplicationCommandOptionType.STRING,
                description: "Custom quality (e.g. 720 for video, 128 for audio). Defaults to 1080p / 320kbps.",
                required: false,
            }
        ],
        execute: async (args, ctx) => {
            // Check for yt-dlp AND Deno as requested
            if (!settings.store.forceYtdlp && !await Native.isYtdlpAvailable()) return openDependencyModal();
            if (!settings.store.forceDeno && !await Native.isDenoAvailable()) return openDependencyModal();
            if (!await Native.isFfmpegAvailable() && settings.store.showFfmpegWarning) sendFfmpegWarning(ctx.channel.id);

            const link = findOption<string>(args, "link", "");
            const format = findOption<"video" | "audio">(args, "format", "video");
            const quality = findOption<string>(args, "quality", "");

            return await download(ctx.channel, {
                url: link,
                format,
                quality
            });
        }
    }],
    patches: [
        {
            find: "missing validator for this component",
            replacement: {
                match: /(\i)(\.type\)\s*\{\s*case \i\.\i\.BUTTON\s*:)\s*return null;/,
                replace: "$1$2return ($self.handleButtonClick($1),null);"
            }
        }
    ],
    handleButtonClick: (buttonComponent: ButtonComponent) => {
        if (!(buttonComponent.emoji?.animated === "yt-downloader-stop-download")) return;
        Native.interrupt();
    },
    start: async () => {
        await Native.checkytdlp();
        await Native.checkdeno();
        await Native.checkffmpeg();

        const downloadFolder = settings.store.downloadFolder || undefined;
        const newVideoDir = await Native.start(downloadFolder);
        await DataStore.set("yt-downloader-video-dir", newVideoDir);
    },
    stop: async () => {
        await Native.stop();
        await DataStore.del("yt-downloader-video-dir");
    }
});

async function download(channel: Channel, {
    url, format, quality
}: {
    url: string;
    format: "video" | "audio";
    quality: string;
}) {
    const promise = Native.execute({
        url,
        format,
        quality,
        maxFileSize: maxFileSize()
    });

    const data = await sendProgress(channel.id, promise);

    for (const log of data.logs.trim().split("\n")) logger.info(log);

    if ("error" in data) {
        if (data.error.includes("--list-formats") && !(await Native.isFfmpegAvailable())) {
            sendBotMessage(channel.id, { content: "No good streams found. Consider installing ffmpeg." });
            openDependencyModal();
            return;
        }

        return sendBotMessage(channel.id, {
            content: `Failed to download: ${data.error.includes("\n") ? "\n```" + data.error + "\n```" : `\`${data.error}\``}`
        });
    }

    const { buffer, title } = data;
    (UploadManager as any).clearAll(channel.id, DraftType.SlashCommand);
    const file = new File([(buffer as any).buffer], title, { type: mimetype(title.split(".")[1]) }) as any;
    setTimeout(() => UploadHandler.promptToUpload([file], channel, DraftType.ChannelMessage), 10);
}
