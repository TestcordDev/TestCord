/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import type { PluginNative } from "@utils/types";

export const webhookLogger = new Logger("QuestRegions/Webhook");

const WEBHOOK_NAME = "QuestRegions";
const BRAND_COLOR = 0x5865f2;

interface WebhookField {
    name: string;
    value: string;
    inline?: boolean;
}

interface WebhookEmbed {
    title: string;
    color: number;
    description?: string;
    fields?: WebhookField[];
    timestamp: string;
    footer?: { text: string; };
}

interface WebhookPayload {
    username: string;
    embeds: WebhookEmbed[];
    allowed_mentions: { parse: string[]; };
}

function getNative() {
    const native = (globalThis as any).VencordNative?.pluginHelpers?.QuestRegions as
        | PluginNative<typeof import("./native")>
        | undefined;
    if (!native) throw new Error("Webhook sending requires desktop native support.");
    return native;
}

function parseWebhookUrl(webhookUrl: string): URL | null {
    const trimmed = webhookUrl.trim();
    if (!trimmed) return null;
    try {
        return new URL(trimmed);
    } catch {
        throw new Error("Webhook URL is invalid.");
    }
}

function createPayload(embeds: WebhookEmbed[]): WebhookPayload {
    return {
        username: WEBHOOK_NAME,
        embeds,
        allowed_mentions: { parse: [] },
    };
}

async function postWebhook(url: URL, payload: WebhookPayload): Promise<void> {
    const { status, data } = await getNative().sendWebhook(url.toString(), JSON.stringify(payload));

    if (status < 200 || status >= 300) {
        let detail = "";
        try {
            const body = JSON.parse(data) as { message?: string; };
            detail = body.message ?? "";
        } catch { /* noop */ }

        throw new Error(
            detail
                ? `Webhook request failed with status ${status}: ${detail}`
                : `Webhook request failed with status ${status}.`
        );
    }
}

export interface QuestRegionWebhookEntry {
    questId: string;
    regions: Array<{ code: string; name: string; emoji: string; }>;
    embedLinks: boolean;
}

function formatQuestLink(questId: string, embedLinks: boolean): string {
    const url = `https://discord.com/quests/${questId}`;
    return embedLinks ? url : `<${url}>`;
}

function buildQuestEmbed(entry: QuestRegionWebhookEntry): WebhookEmbed {
    return {
        title: "Region-Restricted Quest",
        color: BRAND_COLOR,
        description: formatQuestLink(entry.questId, entry.embedLinks),
        fields: [
            {
                name: "Available in",
                value: entry.regions.map(r => `${r.emoji} ${r.name}`).join(", ") || "Unknown",
                inline: false,
            },
        ],
        timestamp: new Date().toISOString(),
        footer: { text: WEBHOOK_NAME },
    };
}

function buildNewQuestEmbed(entry: QuestRegionWebhookEntry): WebhookEmbed {
    return {
        title: "🆕 New Region Quest Available",
        color: 0x43b581,
        description: formatQuestLink(entry.questId, entry.embedLinks),
        fields: [
            {
                name: "Available in",
                value: entry.regions.map(r => `${r.emoji} ${r.name}`).join(", ") || "Unknown",
                inline: false,
            },
        ],
        timestamp: new Date().toISOString(),
        footer: { text: WEBHOOK_NAME },
    };
}

/** Send one or many quest entries to a webhook. Discord allows max 10 embeds per message. */
export async function sendQuestRegionsWebhook(
    webhookUrl: string,
    entries: QuestRegionWebhookEntry[],
): Promise<void> {
    const url = parseWebhookUrl(webhookUrl);
    if (!url) return;

    const chunkSize = 10;
    for (let i = 0; i < entries.length; i += chunkSize) {
        const chunk = entries.slice(i, i + chunkSize);
        await postWebhook(url, createPayload(chunk.map(buildQuestEmbed)));
    }
}

/** Send a "new quest" notification embed. */
export async function sendNewQuestWebhook(
    webhookUrl: string,
    entry: QuestRegionWebhookEntry,
): Promise<void> {
    const url = parseWebhookUrl(webhookUrl);
    if (!url) return;
    await postWebhook(url, createPayload([buildNewQuestEmbed(entry)]));
}

/** Send a test embed to verify the webhook URL works. */
export async function sendTestWebhook(webhookUrl: string): Promise<void> {
    const url = parseWebhookUrl(webhookUrl);
    if (!url) throw new Error("Webhook URL is empty.");

    await postWebhook(url, createPayload([
        {
            title: "QuestRegions Webhook Test",
            color: BRAND_COLOR,
            description: "Your QuestRegions webhook is configured correctly.",
            timestamp: new Date().toISOString(),
            footer: { text: WEBHOOK_NAME },
        },
    ]));
}
