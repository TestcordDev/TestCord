/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { showNotification } from "@api/Notifications/Notifications";
import { TestcordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { PluginNative } from "@utils/types";
import { UserStore } from "@webpack/common";

import { settings } from "./settings";
import { DEFAULT_SNIPER_DIR } from "./utils/constants";

export const Native = VencordNative.pluginHelpers.ApiSniper as PluginNative<typeof import("./native")>;
export const Flogger = new Logger("ApiSniper", "#ff4444");

// Cache to avoid re-processing the same message within 10 minutes
const processedMessages = new Map<string, number>();
const CACHE_TTL = 10 * 60 * 1000;

// Rate limiting: max 5 snipes per second
let lastSnipeTime = 0;
const SNIPE_RATE_LIMIT_MS = 200;

// Patterns that indicate something is probably NOT a credential
function isLikelyFalsePositive(match: string, fullContent: string): boolean {
    // Discord emoji format: <:name:id> or <a:name:id>
    if (/<a?:\w+:\d+>/.test(fullContent) && fullContent.trim().match(/^<a?:\w+:\d+>$/)) return true;

    // Tenor/gif URLs
    if (/tenor\.com/i.test(fullContent)) return true;
    if (/discord(app)?\.com/i.test(fullContent) && /https?:\/\//i.test(fullContent)) return true;
    if (/cdn\.discordapp\.com/i.test(fullContent)) return true;
    if (/reddit\.com/i.test(fullContent)) return true;

    // Message content that's clearly not a credential
    if (/\btimed out\b/i.test(fullContent)) return true;
    if (/\bgif\b/i.test(match) && /https?:\/\//i.test(fullContent)) return true;
    if (/\bimage\d*\.\w+\b/i.test(fullContent)) return true;

    // Tenor slug format: word-word-number
    if (/^[a-z]+-[a-z]+-[a-z]+-\d+$/i.test(match)) return true;

    // Domain-like patterns (example.com, site.org, etc.)
    if (/\b[a-z]+\.(?:com|org|net|io|dev|app|co|gg|me)\b/i.test(match)) return true;

    // Natural language with common short words separated by dots
    // Real base64 tokens don't have lowercase dictionary words
    if (/^[a-z]{2,10}\.[a-z]{2,10}\.[a-z]{2,10}$/i.test(match)) return true;

    // JWT-like strings that contain common English words
    const parts = match.split(".");
    if (parts.length === 3) {
        const commonWords = /^(the|and|for|are|but|not|you|all|can|her|was|one|our|out|day|get|has|him|his|how|its|may|new|now|old|see|way|who|did|let|say|she|too|use)$/i;
        if (parts.some(p => commonWords.test(p))) return true;
    }

    return false;
}

// Regex patterns to detect various API keys, tokens, and credentials
const PATTERNS: Record<string, RegExp> = {
    discordTokenGeneric: /^[A-Za-z\d_-]{20,}\.[A-Za-z\d_-]{6,}\.[A-Za-z\d_-]{27,}$/,
    discordBotToken: /^Bot [A-Za-z\d_-]{20,}\.[A-Za-z\d_-]{6,}\.[A-Za-z\d_-]{27,}$/i,
    discordWebhook: /https:\/\/(?:canary|ptb)?\.?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/i,
    discordLabeled: /(?:discord[_-]?)?(?:token|bot[_-]?token)["'\s]*[:=]["'\s]*["']?([A-Za-z\d_-]{20,}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{27,})/i,

    awsAccessKey: /\b(?:AKIA|ABIA|ACCA|ASIA)[A-Z0-9]{16}\b/,
    awsSecretKey: /(?:aws_secret_access_key|aws_secret_key)["'\s]*[:=]["'\s]*["']?([A-Za-z0-9/+=]{40})/i,
    githubToken: /\bgh[opsu]_[A-Za-z0-9_]{36}\b/,
    githubPat: /\bgithub_pat_[A-Za-z0-9_]{82}\b/,
    googleApiKey: /\bAIza[0-9A-Za-z_-]{35}\b/,
    googleOAuthSecret: /\bGOCSPX-[A-Za-z0-9_-]{28}\b/,
    slackToken: /\bxox[baprs]-[0-9a-zA-Z-]+\b/,
    slackWebhook: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/i,
    telegramBotToken: /^\d+:[A-Za-z0-9_-]{35}$/,
    stripeKey: /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{24,}\b/,
    twilioKey: /\bSK[a-f0-9]{32}\b/,
    sendGridKey: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/,
    digitalOceanToken: /\bdop_v1_[a-f0-9]{64}\b/,
    gitlabToken: /\bglpat-[A-Za-z0-9_-]{20,}\b/,
    bitbucketToken: /\bATBB[A-Za-z0-9]{8,}\b/,
    npmToken: /\bnpm_[A-Za-z0-9]{36}\b/,
    pypiToken: /\bpypi-[A-Za-z0-9_-]+\b/,
    figmaToken: /\bfigd_[A-Za-z0-9_-]+\b/,
    shopifyKey: /\bsh(?:pat|pca|ppa)_[a-fA-F0-9]{32}\b/,
    squarespaceKey: /\bsq0[a-z]{3}-[A-Za-z0-9_-]{20,}\b/,
    mailgunKey: /\bkey-[a-f0-9]{32}\b/,

    openaiKey: /\bsk-[A-Za-z0-9_-]{20,}\b/,
    openaiProjectKey: /\bsk-proj-[A-Za-z0-9_-]{20,}\b/,
    anthropicKey: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/,
    anthropicSessionKey: /\bsk-ant-sess-[A-Za-z0-9_-]{20,}\b/,
    groqKey: /\bgsk_[A-Za-z0-9]{52}\b/,
    deepseekKey: /\bsk-[A-Za-z0-9_-]{32,}\b/,
    googleAIKey: /\bAIza[0-9A-Za-z_-]{35}\b/,
    huggingfaceKey: /\bhf_[A-Za-z0-9_-]{20,}\b/,
    perplexityKey: /\bpplx-[A-Za-z0-9_-]{20,}\b/,
    openrouterKey: /\bsk-or-v1-[A-Za-z0-9_-]{20,}\b/,
    fireworksKey: /\bfw_[A-Za-z0-9_-]{20,}\b/,
    replicateKey: /\br8_[A-Za-z0-9_-]{20,}\b/,
    anyscaleKey: /\besecret_[A-Za-z0-9_-]{20,}\b/,
    stabilityKey: /\bstability-[A-Za-z0-9_-]{20,}\b/,
    aiServiceKey: /(?:openai|anthropic|claude|gemini|chatgpt|gpt-?4|llama|ai)["'\s]*[:=]["'\s]*["']?[A-Za-z0-9_-]{16,}/i,

    apiKey: /(?:api[_-]?key|apikey|api[_-]?token)["'\s]*[:=]["'\s]*["']?([A-Za-z0-9_-]{16,})["']/i,
    authToken: /(?:auth[_-]?token|authtoken|access[_-]?token)["'\s]*[:=]["'\s]*["']?([A-Za-z0-9_-]{16,})["']/i,
    secretKey: /(?:secret[_-]?key|secretkey|private[_-]?key)["'\s]*[:=]["'\s]*["']?([A-Za-z0-9_-]{16,})["']/i,

    jwt: /^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    oauthToken: /\bya29\.[A-Za-z0-9_-]+\b/,
    bearerToken: /(?:bearer|authorization)[\s]+[A-Za-z0-9_.-]{20,}/i,
    emailPassword: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}:[^\s]{6,}/,
    password: /(?:password|passwd|pwd|pass)["'\s]*[:=]["'\s]*["']?[^\s"']{6,}["']/i,
    privateKey: /-----BEGIN\s+(?:RSA\s+|EC\s+|DSA\s+|OPENSSH\s+)?PRIVATE\s+KEY-----/,
    sshKey: /\bssh-(?:rsa|dss|ed25519)\s+[A-Za-z0-9+/]+={0,3}/,
    apiKeyInUrl: /[?&](?:api[_-]?key|apikey|token|auth|access_token)=([A-Za-z0-9_-]{16,})/i,

    mongodbUri: /\bmongodb(?:\+srv)?:\/\/[^\s]+:[^\s]+@[^\s]+\b/i,
    postgresUri: /\bpostgres(?:ql)?:\/\/[^\s]+:[^\s]+@[^\s]+\b/i,
    mysqlUri: /\bmysql?:\/\/[^\s]+:[^\s]+@[^\s]+\b/i,
    redisUri: /\bredis(?:s)?:\/\/[^\s]+:[^\s]+@[^\s]+\b/i,
};

const PATTERN_ENTRIES = Object.entries(PATTERNS);

interface SnipedCredential {
    username: string;
    userId: string;
    channelId: string;
    messageId: string;
    credentialType: string;
    credentialValue: string;
    timestamp: string;
    content: string;
}

function checkForCredentials(content: string): Array<{ type: string; value: string; }> {
    if (!couldContainCredential(content)) return [];
    const findings: Array<{ type: string; value: string; }> = [];

    for (const [type, pattern] of PATTERN_ENTRIES) {
        pattern.lastIndex = 0;
        const match = pattern.exec(content);
        if (match) {
            const matchedValue = match[1] || match[0];
            if (isLikelyFalsePositive(matchedValue, content)) continue;
            findings.push({ type, value: matchedValue });
        }
    }

    return findings;
}

const KEY_MARKERS = /\b(?:sk-|gh[opsu]_|github_pat_|AIza|GOCSPX-|AKIA|ABIA|ACCA|ASIA|xox[baprs]-|\d+:[A-Za-z0-9_-]{35}|(?:sk|pk|rk)_(?:live|test)_|SK[a-f0-9]{32}|SG\.|dop_v1_|glpat-|ATBB|npm_|pypi-|figd_|sh(?:pat|pca|ppa)_|sq0|key-[a-f0-9]{32}|gsk_|hf_|pplx-|fw_|r8_|esecret_|stability-|eyJ[A-Za-z0-9_-]+\.eyJ|ya29\.|ssh-(?:rsa|dss|ed25519)|-----BEGIN|\b(?:mongodb|postgres|mysql|redis)s?:\/\/|webhooks\/)/i;
const KEYWORD_MARKERS = /(?:api[_-]?key|apikey|api[_-]?token|bot[_-]?token|secret[_-]?key|private[_-]?key|auth[_-]?token|authtoken|access[_-]?token|bearer|authorization|password|passwd|pwd)[=:\s]/i;
const DISCORD_TOKEN_LIKE = /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{27,}/;

function couldContainCredential(content: string): boolean {
    if (content.length < 20) return false;
    return KEY_MARKERS.test(content) || KEYWORD_MARKERS.test(content) || DISCORD_TOKEN_LIKE.test(content);
}

async function handleSnipedCredential(credential: SnipedCredential) {
    const now = Date.now();
    if (now - lastSnipeTime < SNIPE_RATE_LIMIT_MS) {
        Flogger.warn("Rate limit hit, skipping save");
        return;
    }
    lastSnipeTime = now;

    const fileName = `snipe_${Date.now()}_${Math.random().toString(36).substring(7)}.txt`;
    const fileContent = [
        "=== API SNIPER REPORT ===",
        "",
        `Username: ${credential.username}`,
        `User ID: ${credential.userId}`,
        `Channel ID: ${credential.channelId}`,
        `Message ID: ${credential.messageId}`,
        "",
        `Credential Type: ${credential.credentialType}`,
        `Credential Value: ${credential.credentialValue}`,
        "",
        `Timestamp: ${credential.timestamp}`,
        "",
        "Original Message Content:",
        "---",
        credential.content,
        "---",
        "",
        "Reported by: TestcordDevs.x2b",
    ].join("\n");

    try {
        await Native.saveSnipe(fileName, fileContent);
        Flogger.info(`Sniped ${credential.credentialType} from ${credential.username}`);

        showNotification({
            title: "🎯 API Sniper Alert",
            body: `Caught ${credential.credentialType} from ${credential.username}`,
            color: "#ff4444",
            onClick: () => { },
        });
    } catch (error) {
        Flogger.error("Failed to save sniped credential:", error);
    }
}

function shouldIgnoreMessage(msg: any): boolean {
    if (!msg?.content || !msg?.author) return true;

    // Ignore own messages unless snipeOwnMessages is true
    if (msg.author.id === UserStore.getCurrentUser()?.id && !settings.store.snipeOwnMessages) return true;

    if (getBlacklistSet().has(msg.author.id)) return true;

    return false;
}

let blacklistCacheKey: string | undefined;
let blacklistCache = new Set<string>();

function getBlacklistSet(): Set<string> {
    const raw = settings.store.userBlacklist;
    if (raw !== blacklistCacheKey) {
        blacklistCacheKey = raw;
        blacklistCache = new Set(
            raw
                .split(",")
                .map(id => id.trim())
                .filter(id => id.length > 0)
        );
    }
    return blacklistCache;
}

const MAX_CACHE_ENTRIES = 1000;
const PRUNE_INTERVAL_MS = 60 * 1000;
let lastPruneTime = 0;

function pruneProcessedMessages(now: number) {
    for (const [id, seen] of processedMessages) {
        if (now - seen >= CACHE_TTL) processedMessages.delete(id);
    }
    // Hard cap as a fallback in case TTL pruning isn't enough
    if (processedMessages.size > MAX_CACHE_ENTRIES) {
        const excess = processedMessages.size - MAX_CACHE_ENTRIES;
        let i = 0;
        for (const id of processedMessages.keys()) {
            if (i++ >= excess) break;
            processedMessages.delete(id);
        }
    }
}

function processMessage(msg: any, channelId: string) {
    if (shouldIgnoreMessage(msg)) return;
    if (!couldContainCredential(msg.content)) return;

    const msgId = msg.id;
    const now = Date.now();
    const lastSeen = processedMessages.get(msgId);
    if (lastSeen && now - lastSeen < CACHE_TTL) return;
    if (now - lastPruneTime > PRUNE_INTERVAL_MS) {
        lastPruneTime = now;
        pruneProcessedMessages(now);
    }
    processedMessages.set(msgId, now);

    const findings = checkForCredentials(msg.content);
    if (findings.length === 0) return;

    const timestamp = new Date().toLocaleString();
    for (const cred of findings) {
        handleSnipedCredential({
            username: msg.author.username || "Unknown",
            userId: msg.author.id || "Unknown",
            channelId: channelId,
            messageId: msgId,
            credentialType: cred.type,
            credentialValue: cred.value,
            timestamp,
            content: msg.content,
        });
    }
}

function messageCreateHandler(payload: any) {
    const msg = payload.message;
    if (!msg) return;
    processMessage(msg, msg.channel_id ?? payload.channelId);
}

function messageUpdateHandler(payload: any) {
    const msg = payload.message;
    if (!msg) return;
    // Only act on actual content changes (avoid duplicate on embed updates)
    if (!payload.oldContent || payload.oldContent !== msg.content) {
        processMessage(msg, msg.channel_id ?? payload.channelId);
    }
}

export default definePlugin({
    name: "ApiSniper",
    description: "Detects and logs API keys, tokens, and credentials from chat messages",
    tags: ["Utility", "Developers"],
    authors: [TestcordDevs.x2b],

    settings,

    flux: {
        MESSAGE_CREATE: messageCreateHandler,
        MESSAGE_UPDATE: messageUpdateHandler,
    },

    async start() {
        const { sniperDir } = await Native.getSettings();
        settings.store.sniperDir = sniperDir || DEFAULT_SNIPER_DIR;
    },

    stop() {
        processedMessages.clear();
        lastPruneTime = 0;
    },
});
