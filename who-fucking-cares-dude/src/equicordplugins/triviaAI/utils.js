/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { sendBotMessage } from "@api/Commands";
import { insertTextIntoChatInputBox, sendMessage } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { MessageStore, showToast, Toasts, UserStore } from "@webpack/common";
import { settings } from "./settings";
const logger = new Logger("TriviaAI");
export async function getPayload(message) {
    const prevMessages = getPreviousMessages(message, settings.store.context);
    const allMessages = [...prevMessages, message];
    const currentUserId = UserStore.getCurrentUser().id;
    const payload = [];
    for (const msg of allMessages) {
        const parsed = parseMessageContent(msg);
        if (!parsed)
            continue;
        const isOwn = msg.author?.id === currentUserId;
        const isTargetMessage = msg.id === message.id;
        const role = (isOwn && !isTargetMessage && settings.store.treatSelfAsAssistant) ? "assistant" : "user";
        let content = parsed;
        if (!isOwn && settings.store.passMessageAuthorName) {
            const username = msg.author?.username ?? "Unknown";
            const prefix = `${username}: `;
            if (typeof parsed === "string") {
                content = prefix + parsed;
            }
            else if (Array.isArray(parsed)) {
                content = [...parsed];
                const firstTextIdx = content.findIndex(p => p.type === "text");
                if (firstTextIdx !== -1) {
                    content[firstTextIdx] = {
                        type: "text",
                        text: prefix + content[firstTextIdx].text
                    };
                }
                else {
                    content.unshift({
                        type: "text",
                        text: prefix
                    });
                }
            }
        }
        payload.push({ role, content });
    }
    if (payload.length === 0)
        return null;
    if (!settings.store.sendImagesAsBase64)
        return payload;
    return Promise.all(payload.map(async (msg) => {
        if (typeof msg.content === "string")
            return msg;
        const content = await Promise.all(msg.content.map(part => part.type === "image_url" ? toBase64Image(part) : part));
        return { ...msg, content: content.filter(part => part !== null) };
    }));
}
export function getPreviousMessages(message, count) {
    const allMessages = MessageStore.getMessages(message.channel_id)._array;
    const idx = allMessages.findIndex(m => m.id === message.id);
    if (idx <= 0 || count === 0)
        return [];
    return allMessages.slice(Math.max(0, idx - count), idx);
}
export function parseMessageContent(message) {
    const textParts = [];
    if (message.content && message.content.trim().length > 0) {
        textParts.push(message.content);
    }
    message.embeds.forEach(embed => {
        const embedBuffer = [];
        const parts = [
            embed.provider?.name ? `> ${embed.provider.name}` : null,
            embed.author?.name ? `**${embed.author.name}**` : null,
            embed.rawTitle ? `## ${embed.rawTitle}` : null,
            embed.rawDescription ?? null,
            ...(embed.fields?.map(f => (f.rawName && f.rawValue) ? `**${f.rawName}**: ${f.rawValue}` : null) ?? []),
            embed.footer?.text ? `_${embed.footer.text}_` : null,
        ];
        parts.forEach(p => {
            if (p)
                embedBuffer.push(p);
        });
        if (embedBuffer.length > 0)
            textParts.push(embedBuffer.join("\n"));
    });
    const combinedText = textParts.join("\n\n");
    if (!settings.store.supportImages) {
        return combinedText || null;
    }
    const imageUrls = new Set();
    message.attachments
        .filter(att => att.content_type?.startsWith("image/"))
        .forEach(att => imageUrls.add(att.proxy_url ?? att.url));
    message.embeds.forEach(embed => {
        const potentialUrls = [
            embed.image?.url,
            embed.thumbnail?.url,
            ...(embed.images?.map(img => img.url) ?? [])
        ];
        potentialUrls.forEach(url => {
            if (url)
                imageUrls.add(url);
        });
    });
    if (imageUrls.size === 0) {
        return combinedText || null;
    }
    const payload = [];
    if (combinedText.length > 0) {
        payload.push({
            type: "text",
            text: combinedText
        });
    }
    imageUrls.forEach(url => {
        payload.push({
            type: "image_url",
            image_url: { url }
        });
    });
    return payload;
}
async function toBase64Image(part) {
    try {
        const req = await fetch(part.image_url.url);
        if (!req.ok)
            return null;
        let binary = "";
        const bytes = new Uint8Array(await req.arrayBuffer());
        for (let i = 0; i < bytes.length; i += 0x8000) {
            binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        return {
            type: "image_url",
            image_url: { url: `data:${req.headers.get("content-type") ?? "image/png"};base64,${btoa(binary)}` }
        };
    }
    catch (e) {
        logger.warn("failed to convert image to base64", e);
        return null;
    }
}
export async function handleResponse(message, response) {
    switch (settings.store.mode) {
        case "autoreply":
            sendMessage(message.channel_id, { content: response }, true, { messageReference: { channel_id: message.channel_id, message_id: message.id } });
            break;
        case "chatbar":
            insertTextIntoChatInputBox(response);
            break;
        case "bot":
            sendBotMessage(message.channel_id, { content: response });
            break;
    }
    return response;
}
function getSystemPrompt() {
    const currentUser = UserStore.getCurrentUser();
    const currentTime = new Date().toString();
    return settings.store.systemPrompt
        .replace(/{current_user}/g, currentUser?.username ?? "Unknown User")
        .replace(/{current_time}/g, currentTime);
}
export async function getResponse(payload) {
    if (!settings.store.apiKey || !settings.store.endpoint || !settings.store.model) {
        showToast("TriviaAI: API settings are incomplete.", Toasts.Type.FAILURE);
        return "";
    }
    try {
        const req = await fetch(settings.store.endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${settings.store.apiKey}`
            },
            body: JSON.stringify({
                model: settings.store.model,
                messages: [
                    {
                        role: "system",
                        content: getSystemPrompt()
                    },
                    ...payload
                ],
                max_tokens: settings.store.maxTokens,
            })
        });
        const rawBody = await req.text();
        const data = (() => {
            try {
                return JSON.parse(rawBody);
            }
            catch {
                return {};
            }
        })();
        if (!req.ok || data.error) {
            const errorMsg = data.error?.message ?? rawBody ?? `Status ${req.status}`;
            logger.error(`API Error: ${errorMsg}`);
            showToast(errorMsg, Toasts.Type.FAILURE);
            return "";
        }
        const response = data.choices?.[0]?.message?.content;
        if (!response?.trim()) {
            logger.warn("no response from AI model");
            return "";
        }
        return response;
    }
    catch (e) {
        logger.error("Error getting response from AI model", e);
        showToast("Error getting response from AI model", Toasts.Type.FAILURE);
        return "";
    }
}
