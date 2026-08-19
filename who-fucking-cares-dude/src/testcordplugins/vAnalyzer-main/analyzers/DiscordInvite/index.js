/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Toasts } from "@webpack/common";
import { safeToast } from "../../utils";
const Native = VencordNative.pluginHelpers.vAnalyzer;
const NSFW_KEYWORDS = [
    "sex", "sexcam", "porn", "xxx", "onlyfans", "nude", "nudes",
    "nsfw", "hentai", "leak", "leaks", "leaked",
    "dick", "pussy", "cock", "cum", "fap", "milf", "+18"
];
const SCAM_KEYWORDS = [
    "free nitro", "steam gift", "gift card", "airdrop", "crypto",
    "earn money", "free money", "giveaway", "claim your",
    "limited time", "giftcard", "+18"
];
function extractInviteCode(url) {
    const match = url.match(/(?:discord\.gg|discord(?:app)?\.com\/invite)\/([a-zA-Z0-9-]+)/i);
    return match?.[1] ?? null;
}
function containsKeywords(text, keywords) {
    return keywords.filter(kw => text.includes(kw));
}
export function isDiscordInvite(url) {
    return extractInviteCode(url) !== null;
}
export async function analyzeDiscordInvite(url, silent = false) {
    const inviteCode = extractInviteCode(url);
    if (!inviteCode) {
        if (!silent)
            safeToast("Could not extract invite code from URL", Toasts.Type.FAILURE);
        return null;
    }
    if (!silent)
        safeToast(`Analyzing invite ${inviteCode}...`);
    const result = await Native.queryDiscordInvite(inviteCode);
    if (result.status !== 200 || !result.data) {
        if (!silent)
            safeToast(`Invite lookup failed: ${result.error ?? "invalid or expired invite"}`, Toasts.Type.FAILURE);
        return null;
    }
    const { data } = result;
    const { guild } = data;
    const details = [];
    if (!guild) {
        details.push({ message: "No server info available", type: "suspicious" });
        return { details, timestamp: Date.now() };
    }
    const memberCount = data.approximate_member_count ?? 0;
    const onlineCount = data.approximate_presence_count ?? 0;
    const { name } = guild;
    const description = guild.description ?? "";
    const vanityCode = guild.vanity_url_code ?? "";
    const channelName = data.channel?.name ?? "";
    details.push({
        message: `[Discord] Server ID: ${guild.id}`,
        type: "neutral"
    });
    let memberType;
    if (memberCount > 0) {
        memberType = "safe";
    }
    else {
        memberType = "neutral";
    }
    details.push({
        message: `[Discord] ${name} (${memberCount.toLocaleString()} members)`,
        type: memberType
    });
    const verificationLabels = ["None", "Email", "5 min", "10 min", "Phone"];
    const vLevel = guild.verification_level;
    let verifType;
    if (vLevel >= 2) {
        verifType = "safe";
    }
    else {
        verifType = "suspicious";
    }
    details.push({
        message: `[Discord] Verif: ${verificationLabels[vLevel] ?? vLevel} | Online: ${onlineCount.toLocaleString()}`,
        type: verifType
    });
    // only some server features
    const features = guild.features ?? [];
    const featureLabels = {
        "VERIFIED": "Verified",
        "PARTNERED": "Partnered",
        "COMMUNITY": "Community",
        "DISCOVERABLE": "Discoverable",
        "MEMBER_VERIFICATION_GATE_ENABLED": "Membership Screening",
        "WELCOME_SCREEN_ENABLED": "Welcome Screen",
        "VANITY_URL": "Vanity URL",
        "PREVIEW_ENABLED": "Preview Enabled",
    };
    const displayFeatures = features
        .map(f => featureLabels[f])
        .filter(Boolean);
    if (displayFeatures.length > 0) {
        const isVerified = features.includes("VERIFIED");
        const isPartnered = features.includes("PARTNERED");
        let featureType;
        if (isVerified || isPartnered) {
            featureType = "safe";
        }
        else {
            featureType = "neutral";
        }
        details.push({
            message: `[Discord] Features: ${displayFeatures.join(", ")}`,
            type: featureType
        });
    }
    if (guild.premium_subscription_count > 0) {
        const boostTier = guild.premium_tier;
        let tierLabel = "";
        if (boostTier > 0) {
            tierLabel = ` (Tier ${boostTier})`;
        }
        details.push({
            message: `[Discord] Boosts: ${guild.premium_subscription_count}${tierLabel}`,
            type: "neutral"
        });
    }
    const isNsfwServer = guild.nsfw || guild.nsfw_level > 0;
    const searchString = `${name} ${description} ${vanityCode} ${channelName}`.toLowerCase();
    const nsfwHits = [...new Set(containsKeywords(searchString, NSFW_KEYWORDS))];
    const scamHits = [...new Set(containsKeywords(searchString, SCAM_KEYWORDS))];
    if (nsfwHits.length > 0) {
        if (!isNsfwServer) {
            details.push({
                message: `[Discord] ALERT: Server NOT marked NSFW but contains keywords! (${nsfwHits.join(", ")})`,
                type: "malicious"
            });
        }
        else {
            details.push({
                message: `[Discord] NSFW Keywords detected: ${nsfwHits.join(", ")}`,
                type: "suspicious"
            });
        }
    }
    if (scamHits.length > 0) {
        details.push({
            message: `[Discord] Possible Scam: ${scamHits.join(", ")}`,
            type: "malicious"
        });
    }
    if (isNsfwServer && nsfwHits.length === 0) {
        details.push({
            message: "[Discord] Server marked as NSFW",
            type: "suspicious"
        });
    }
    // if widget is enabled, expose public widget data
    const widgetResult = await Native.queryDiscordGuildWidget(guild.id);
    if (widgetResult.status === 200 && widgetResult.data) {
        const widget = widgetResult.data;
        details.push({
            message: `[Discord] Public member list available | Online: ${widget.presence_count.toLocaleString()} | Listed: ${widget.members.length.toLocaleString()}`,
            type: "neutral"
        });
        if (widget.members.length > 0) {
            details.push({
                message: "[Discord] Connected Members",
                type: "neutral",
                discordConnectedMembers: widget.members.slice(0, 50).map(member => ({
                    id: member.id,
                    username: member.username,
                    status: member.status,
                    avatar_url: member.avatar_url,
                    activityName: member.activity?.name
                })),
                discordPresenceCount: widget.presence_count
            });
        }
    }
    return { details, timestamp: Date.now() };
}
