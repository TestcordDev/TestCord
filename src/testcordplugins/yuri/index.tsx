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
        name: "PurrBot",
        endpoint: CORS_PROXY + encodeURIComponent("https://api.purrbot.site/v2/img/nsfw/yuri/gif"),
        parse: data => (data && data.error === false && typeof data.link === "string") ? data.link : null
    },
    {
        name: "Danbooru",
        endpoint: CORS_PROXY + encodeURIComponent("https://danbooru.donmai.us/posts.json?tags=yuri+solo+rating%3Ageneral&limit=20"),
        parse: data => {
            if (!Array.isArray(data) || data.length === 0) return null;
            const post = data[Math.floor(Math.random() * data.length)];
            return post?.file_url ?? post?.large_file_url ?? null;
        }
    },
    {
        name: "Safebooru",
        endpoint: CORS_PROXY + encodeURIComponent("https://safebooru.org/index.php?page=dapi&s=post&q=index&json=1&limit=20&tags=yuri+solo"),
        parse: data => {
            if (!Array.isArray(data) || data.length === 0) return null;
            const post = data[Math.floor(Math.random() * data.length)];
            return post?.file_url ?? post?.sample_url ?? null;
        }
    },
    {
        name: "XBooru",
        endpoint: CORS_PROXY + encodeURIComponent("https://xbooru.com/index.php?page=dapi&s=post&q=index&tags=yuri+solo&limit=20&json=1"),
        parse: data => {
            if (!Array.isArray(data) || data.length === 0) return null;
            const post = data[Math.floor(Math.random() * data.length)];
            return post?.file_url ?? post?.sample_url ?? null;
        }
    },
    {
        name: "TBIB",
        endpoint: CORS_PROXY + encodeURIComponent("https://tbib.org/index.php?page=dapi&s=post&q=index&tags=yuri+solo&limit=20&json=1"),
        parse: data => {
            if (!Array.isArray(data) || data.length === 0) return null;
            const post = data[Math.floor(Math.random() * data.length)];
            return post?.file_url ?? post?.sample_url ?? null;
        }
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

async function fetchYuri(): Promise<{ url: string; source: string; } | null> {
    for (const api of shuffle(API_LIST)) {
        try {
            const res = await fetch(api.endpoint, {
                headers: { Accept: "application/json" }
            });
            if (!res.ok) {
                console.warn(`[Yuri] ${api.name} returned HTTP ${res.status}`);
                continue;
            }
            const data = await res.json();
            const url = api.parse(data);
            if (url) return { url, source: api.name };
            console.warn(`[Yuri] ${api.name} returned no usable URL`);
        } catch (e) {
            console.error(`[Yuri] ${api.name} failed:`, e);
        }
    }
    return null;
}

export default definePlugin({
    name: "Yuri",
    description: "Sends a random yuri picture via /yuri. Uses 5 APIs with random order and automatic fallback. (NSFW)",
    authors: [TestcordDevs.x2b],
    tags: ["Commands"],
    commands: [
        {
            name: "yuri",
            description: "Send a random yuri picture in chat",
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

                const result = await fetchYuri();
                if (!result) {
                    sendBotMessage(ctx.channel.id, {
                        content: "❌ Couldn't fetch a yuri picture — all APIs failed. Try again in a moment."
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
                    console.error("[Yuri] Failed to send message:", e);
                    sendBotMessage(ctx.channel.id, {
                        content: `⚠️ Couldn't post to chat, here's the link (from ${result.source}):\n${result.url}`
                    });
                }
            }
        }
    ]
});
