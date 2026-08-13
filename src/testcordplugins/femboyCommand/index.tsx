/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { MessageActions } from "@webpack/common";

const CORS_PROXY = "https://cors.keiran0.workers.dev?url=";

interface ApiSource {
    name: string;
    endpoint: string;
    parse: (data: any) => string | null;
}

const API_LIST: ApiSource[] = [
    {
        name: "Danbooru",
        endpoint: CORS_PROXY + encodeURIComponent("https://danbooru.donmai.us/posts.json?tags=trap+solo+rating%3Ageneral&limit=20"),
        parse: data => {
            if (!Array.isArray(data) || data.length === 0) return null;
            const post = data[Math.floor(Math.random() * data.length)];
            return post?.file_url ?? post?.large_file_url ?? null;
        }
    },
    {
        name: "Safebooru",
        endpoint: CORS_PROXY + encodeURIComponent("https://safebooru.org/index.php?page=dapi&s=post&q=index&json=1&limit=20&tags=trap+solo"),
        parse: data => {
            if (!Array.isArray(data) || data.length === 0) return null;
            const post = data[Math.floor(Math.random() * data.length)];
            return post?.file_url ?? post?.sample_url ?? null;
        }
    },
    {
        name: "XBooru",
        endpoint: CORS_PROXY + encodeURIComponent("https://xbooru.com/index.php?page=dapi&s=post&q=index&tags=trap+solo&limit=20&json=1"),
        parse: data => {
            if (!Array.isArray(data) || data.length === 0) return null;
            const post = data[Math.floor(Math.random() * data.length)];
            return post?.file_url ?? post?.sample_url ?? null;
        }
    },
    {
        name: "TBIB",
        endpoint: CORS_PROXY + encodeURIComponent("https://tbib.org/index.php?page=dapi&s=post&q=index&tags=trap+solo&limit=20&json=1"),
        parse: data => {
            if (!Array.isArray(data) || data.length === 0) return null;
            const post = data[Math.floor(Math.random() * data.length)];
            return post?.file_url ?? post?.sample_url ?? null;
        }
    },
    {
        name: "Konachan",
        endpoint: CORS_PROXY + encodeURIComponent("https://konachan.com/post.json?tags=trap&limit=20"),
        parse: data => {
            if (!Array.isArray(data) || data.length === 0) return null;
            const post = data[Math.floor(Math.random() * data.length)];
            return post?.file_url ?? post?.sample_url ?? null;
        }
    },
    {
        name: "Yande.re",
        endpoint: CORS_PROXY + encodeURIComponent("https://yande.re/post.json?tags=trap&limit=20"),
        parse: data => {
            if (!Array.isArray(data) || data.length === 0) return null;
            const post = data[Math.floor(Math.random() * data.length)];
            return post?.file_url ?? post?.sample_url ?? null;
        }
    },
    {
        name: "FemboyFinder",
        endpoint: CORS_PROXY + encodeURIComponent("https://femboyfinder.firestreaker2.gq/api/femboy"),
        parse: data => (data && data.error === false && typeof data.url === "string") ? data.url : null
    }
];

function shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

async function fetchFemboy(): Promise<{ url: string; source: string; } | null> {
    for (const api of shuffle(API_LIST)) {
        try {
            const res = await fetch(api.endpoint, {
                headers: { Accept: "application/json" }
            });
            if (!res.ok) {
                console.warn(`[FemboyCommand] ${api.name} returned HTTP ${res.status}`);
                continue;
            }
            const data = await res.json();
            const url = api.parse(data);
            if (url) return { url, source: api.name };
            console.warn(`[FemboyCommand] ${api.name} returned no usable URL`);
        } catch (e) {
            console.error(`[FemboyCommand] ${api.name} failed:`, e);
        }
    }
    return null;
}

export default definePlugin({
    name: "FemboyCommand",
    description: "Sends a random femboy picture via /femboy. Uses 7 APIs with random order and automatic fallback.",
    authors: [TestcordDevs.x2b],
    tags: ["Commands", "Utility"],
    commands: [
        {
            name: "femboy",
            description: "Send a random femboy picture in chat",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "mode",
                    description: "send (posts in chat) or preview (only you see it). Defaults to send.",
                    type: ApplicationCommandOptionType.STRING,
                    required: false,
                    choices: [
                        { name: "send", value: "send", label: "send" },
                        { name: "preview", value: "preview", label: "preview" }
                    ]
                }
            ],
            execute: async (args, ctx) => {
                const mode = (findOption(args, "mode", "send") as string).toLowerCase();

                const result = await fetchFemboy();
                if (!result) {
                    sendBotMessage(ctx.channel.id, {
                        content: "❌ Couldn't fetch a femboy picture — all APIs failed. Try again in a moment."
                    });
                    return;
                }

                if (mode === "preview") {
                    sendBotMessage(ctx.channel.id, {
                        content: `${result.url}\n-# Source: ${result.source}`
                    });
                    return;
                }

                try {
                    await MessageActions.sendMessage(ctx.channel.id, {
                        content: result.url,
                        invalidEmojis: [],
                        validNonShortcutEmojis: []
                    }, undefined, {
                        nonce: (Date.now() * 4194304).toString()
                    });
                } catch (e) {
                    console.error("[FemboyCommand] Failed to send message:", e);
                    sendBotMessage(ctx.channel.id, {
                        content: `⚠️ Couldn't post to chat, here's the link (from ${result.source}):\n${result.url}`
                    });
                }
            }
        }
    ]
});
