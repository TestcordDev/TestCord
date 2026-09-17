/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";

export const cl = classNameFactory("vc-testcord-ml-");

export function mediaSrc(media: any): string | undefined {
    return media?.url ?? media?.proxyURL ?? media?.proxy_url ?? media?.proxyUrl;
}

export function collectEmbedText(embed: any): string {
    if (!embed || typeof embed !== "object") return "";
    const parts: string[] = [];
    if (typeof embed.author?.name === "string") parts.push(embed.author.name);
    if (typeof embed.title === "string") parts.push(embed.title);
    if (typeof embed.rawTitle === "string") parts.push(embed.rawTitle);
    if (typeof embed.description === "string") parts.push(embed.description);
    if (typeof embed.rawDescription === "string") parts.push(embed.rawDescription);
    if (Array.isArray(embed.fields)) {
        for (const f of embed.fields) {
            if (typeof f?.name === "string") parts.push(f.name);
            if (typeof f?.value === "string") parts.push(f.value);
            if (typeof f?.rawName === "string") parts.push(f.rawName);
            if (typeof f?.rawValue === "string") parts.push(f.rawValue);
        }
    }
    if (typeof embed.footer?.text === "string") parts.push(embed.footer.text);
    if (typeof embed.provider?.name === "string") parts.push(embed.provider.name);
    if (typeof embed.url === "string") parts.push(embed.url);
    return parts.join("\n");
}

export function collectComponentText(component: any): string {
    if (!component || typeof component !== "object") return "";
    const parts: string[] = [];
    if (typeof component.content === "string") parts.push(component.content);
    if (typeof component.label === "string") parts.push(component.label);
    if (typeof component.placeholder === "string") parts.push(component.placeholder);
    if (typeof component.value === "string") parts.push(component.value);
    if (Array.isArray(component.components)) {
        for (const child of component.components) {
            const text = collectComponentText(child);
            if (text) parts.push(text);
        }
    }
    if (component.accessory) {
        const text = collectComponentText(component.accessory);
        if (text) parts.push(text);
    }
    if (Array.isArray(component.media)) {
        for (const item of component.media) {
            if (typeof item?.description === "string") parts.push(item.description);
            if (typeof item?.alt === "string") parts.push(item.alt);
        }
    }
    if (Array.isArray(component.items)) {
        for (const item of component.items) {
            const text = collectComponentText(item);
            if (text) parts.push(text);
        }
    }
    return parts.join("\n");
}

export function collectLoggedMessageText(message: any): string {
    if (!message || typeof message !== "object") return "";
    const parts: string[] = [];
    if (typeof message.content === "string" && message.content) parts.push(message.content);
    if (Array.isArray(message.embeds)) {
        for (const embed of message.embeds) {
            const text = collectEmbedText(embed);
            if (text) parts.push(text);
        }
    }
    const components = message.components ?? message.messageSnapshots?.flatMap?.((s: any) => s?.message?.components ?? []);
    if (Array.isArray(components)) {
        for (const component of components) {
            const text = collectComponentText(component);
            if (text) parts.push(text);
        }
    }
    if (Array.isArray(message.stickerItems)) {
        for (const sticker of message.stickerItems) {
            if (typeof sticker?.name === "string") parts.push(sticker.name);
        }
    }
    if (Array.isArray(message.stickers)) {
        for (const sticker of message.stickers) {
            if (typeof sticker?.name === "string") parts.push(sticker.name);
        }
    }
    if (typeof message.poll?.question?.text === "string") parts.push(message.poll.question.text);
    return parts.join("\n");
}
