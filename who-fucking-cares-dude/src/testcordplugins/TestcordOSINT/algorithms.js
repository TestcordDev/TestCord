/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
// eslint-disable-next-line no-misleading-character-class
const EMOJI_REGEX = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{200D}\u{20E3}\u{FE0F}\u{E0020}-\u{E007F}\u{1F000}-\u{1FFFF}]/gu;
const URL_REGEX = /https?:\/\/[^\s<>"')\]]+/gi;
const MENTION_REGEX = /<@!?\d+>/g;
const CHANNEL_REGEX = /<#\d+>/g;
const SPOILER_REGEX = /\|\|[^|]+\|\|/;
const CUSTOM_EMOJI_REGEX = /<a?:\w+:\d+>/g;
const STOP_WORDS = new Set([
    "the", "a", "an", "is", "it", "to", "in", "of", "and", "or", "for",
    "on", "at", "by", "with", "from", "this", "that", "i", "you", "he",
    "she", "we", "they", "me", "him", "her", "us", "them", "my", "your",
    "his", "its", "our", "their", "what", "which", "who", "whom", "how",
    "when", "where", "why", "not", "no", "do", "does", "did", "have",
    "has", "had", "be", "am", "are", "was", "were", "been", "will",
    "would", "could", "should", "may", "might", "shall", "can", "but",
    "if", "then", "so", "than", "too", "very", "just", "about", "up",
    "out", "all", "also", "as", "into", "some", "any", "more", "other",
    "only", "even", "back", "there", "here", "now", "new", "like",
]);
function formatHour(h, use24h) {
    if (use24h)
        return `${String(h).padStart(2, "0")}:00`;
    const ampm = h < 12 ? "am" : "pm";
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}${ampm}`;
}
function getHour(timestamp) {
    try {
        return new Date(timestamp).getUTCHours();
    }
    catch {
        return -1;
    }
}
function getDayOfWeek(timestamp) {
    try {
        return new Date(timestamp).getUTCDay();
    }
    catch {
        return -1;
    }
}
function extractWords(text) {
    return text
        .toLowerCase()
        .replace(EMOJI_REGEX, " ")
        .replace(URL_REGEX, " ")
        .replace(CUSTOM_EMOJI_REGEX, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/[^a-z0-9\s'-]/g, " ")
        .split(/\s+/)
        .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}
function topN(map, n) {
    return [...map.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, n);
}
function estimateTimezone(hourCounts) {
    const totalMsgs = [...hourCounts.values()].reduce((s, c) => s + c, 0);
    if (totalMsgs === 0)
        return { offset: 0, label: "UTC+0", confidence: "N/A" };
    const activeHours = [...hourCounts.entries()]
        .filter(([, c]) => c > totalMsgs * 0.03)
        .map(([h]) => h)
        .sort((a, b) => a - b);
    const centerHour = activeHours.length > 0
        ? Math.round(activeHours.reduce((s, h) => s + h, 0) / activeHours.length)
        : topN(hourCounts, 1)[0]?.[0] ?? 12;
    const typicalActiveCenter = 14;
    const offset = ((centerHour - typicalActiveCenter) + 24) % 24;
    const adjustedOffset = offset > 12 ? offset - 24 : offset;
    let confidence = "low";
    if (activeHours.length >= 8)
        confidence = "medium";
    if (activeHours.length >= 12)
        confidence = "high";
    const sign = adjustedOffset >= 0 ? "+" : "-";
    return { offset: adjustedOffset, label: `UTC${sign}${Math.abs(adjustedOffset)}`, confidence };
}
function estimateSleepSchedule(hourCounts) {
    const totalMsgs = [...hourCounts.values()].reduce((s, c) => s + c, 0);
    if (totalMsgs === 0)
        return { start: "N/A", end: "N/A", hours: 0 };
    const threshold = totalMsgs * 0.01;
    const quietHours = [];
    for (let h = 0; h < 24; h++) {
        if ((hourCounts.get(h) ?? 0) < threshold)
            quietHours.push(h);
    }
    if (quietHours.length === 0)
        return { start: "N/A", end: "N/A", hours: 0 };
    let bestStart = quietHours[0], bestLen = 1, curStart = quietHours[0], curLen = 1;
    for (let i = 1; i < quietHours.length; i++) {
        if (quietHours[i] === quietHours[i - 1] + 1) {
            curLen++;
        }
        else {
            if (curLen > bestLen) {
                bestLen = curLen;
                bestStart = curStart;
            }
            curStart = quietHours[i];
            curLen = 1;
        }
    }
    if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
    }
    const sleepEnd = (bestStart + bestLen) % 24;
    return { start: `${String(bestStart).padStart(2, "0")}:00`, end: `${String(sleepEnd).padStart(2, "0")}:00`, hours: bestLen };
}
function findActiveWindows(hourCounts, use24h) {
    const totalMsgs = [...hourCounts.values()].reduce((s, c) => s + c, 0);
    if (totalMsgs === 0)
        return [];
    const windows = [];
    let inWindow = false, winStart = 0, winMsgs = 0;
    const threshold = totalMsgs * 0.03;
    for (let h = 0; h < 48; h++) {
        const hMod = h % 24;
        const count = hourCounts.get(hMod) ?? 0;
        if (count >= threshold) {
            if (!inWindow) {
                winStart = hMod;
                winMsgs = 0;
                inWindow = true;
            }
            winMsgs += count;
        }
        else if (inWindow) {
            windows.push({ start: winStart, end: hMod, msgs: winMsgs });
            inWindow = false;
        }
    }
    if (inWindow)
        windows.push({ start: winStart, end: (winStart + 24) % 24, msgs: winMsgs });
    windows.sort((a, b) => b.msgs - a.msgs);
    return windows.slice(0, 3).map(w => `${formatHour(w.start, use24h)}-${formatHour(w.end, use24h)}`);
}
function detectLanguagePatterns(messages) {
    const patterns = [];
    const msgTexts = messages.map(m => m.content.toLowerCase());
    const questions = msgTexts.filter(t => t.includes("?")).length;
    if (questions / messages.length > 0.15)
        patterns.push("Asks many questions (inquisitive)");
    const exclamations = msgTexts.filter(t => t.includes("!")).length;
    if (exclamations / messages.length > 0.1)
        patterns.push("Uses exclamation marks frequently (expressive)");
    const allCaps = msgTexts.filter(t => {
        const letters = t.replace(/[^a-zA-Z]/g, "");
        return letters.length > 3 && t === t.toUpperCase();
    }).length;
    if (allCaps / messages.length > 0.02)
        patterns.push("Types in ALL CAPS sometimes (emphatic)");
    const ellipsis = msgTexts.filter(t => t.includes("...")).length;
    if (ellipsis / messages.length > 0.03)
        patterns.push("Uses ellipsis frequently (trailing off)");
    const dashes = msgTexts.filter(t => /\s-\s|—/.test(t)).length;
    if (dashes / messages.length > 0.05)
        patterns.push("Uses dashes/em-dashes (structured)");
    const oneWordReplies = messages.filter(m => extractWords(m.content).length === 1 && m.content.length < 10).length;
    if (oneWordReplies / messages.length > 0.15)
        patterns.push("Frequent one-word replies (terse)");
    return patterns;
}
function estimateAccountAge(messages) {
    if (messages.length < 2)
        return "Unknown";
    const timestamps = messages.map(m => new Date(m.timestamp).getTime()).sort((a, b) => a - b);
    const spanMs = timestamps[timestamps.length - 1] - timestamps[0];
    const spanDays = Math.round(spanMs / 86400000);
    if (spanDays < 1)
        return "Same day";
    if (spanDays < 7)
        return `${spanDays} days`;
    if (spanDays < 30)
        return `${Math.round(spanDays / 7)} weeks`;
    if (spanDays < 365)
        return `${Math.round(spanDays / 30)} months`;
    return `${(spanDays / 365).toFixed(1)} years`;
}
export function analyzeMessages(messages, use24h = false) {
    if (messages.length === 0) {
        return { summary: "No messages found for this user.", sections: [] };
    }
    const sections = [];
    const { author } = messages[0];
    const totalMessages = messages.length;
    const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
    const avgLength = Math.round(totalChars / totalMessages);
    const totalAttachments = messages.reduce((sum, m) => sum + m.attachments.length, 0);
    const totalEmbeds = messages.reduce((sum, m) => sum + m.embeds.length, 0);
    const totalReactions = messages.reduce((sum, m) => sum + (m.reactions?.length ?? 0), 0);
    sections.push({
        title: "Basic Statistics",
        content: [
            `Messages analyzed: ${totalMessages}`,
            `Total characters: ${totalChars.toLocaleString()}`,
            `Average message length: ${avgLength} chars`,
            `Attachments sent: ${totalAttachments}`,
            `Embeds: ${totalEmbeds}`,
            `Reactions: ${totalReactions}`,
        ].join("\n"),
    });
    const hourCounts = new Map();
    const dayCounts = new Map();
    const hourCountsByDay = new Map();
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    for (const msg of messages) {
        const hour = getHour(msg.timestamp);
        if (hour >= 0)
            hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
        const day = getDayOfWeek(msg.timestamp);
        if (day >= 0) {
            dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
            if (!hourCountsByDay.has(day))
                hourCountsByDay.set(day, new Map());
            const dayMap = hourCountsByDay.get(day);
            dayMap.set(hour, (dayMap.get(hour) ?? 0) + 1);
        }
    }
    const peakHours = topN(hourCounts, 3).map(([h, c]) => `${formatHour(h, use24h)} (${c})`).join(", ");
    const peakDays = topN(dayCounts, 3).map(([d, c]) => `${dayNames[d]} (${c})`).join(", ");
    const sortedHours = [...hourCounts.keys()].sort((a, b) => a - b);
    let activeStart = "?", activeEnd = "?";
    if (sortedHours.length > 0) {
        activeStart = formatHour(sortedHours[0], use24h);
        activeEnd = formatHour(sortedHours[sortedHours.length - 1], use24h);
    }
    const nightMsgs = (hourCounts.get(0) ?? 0) + (hourCounts.get(1) ?? 0) + (hourCounts.get(2) ?? 0) + (hourCounts.get(3) ?? 0) + (hourCounts.get(4) ?? 0) + (hourCounts.get(5) ?? 0);
    const dayMsgs = (hourCounts.get(6) ?? 0) + (hourCounts.get(7) ?? 0) + (hourCounts.get(8) ?? 0) + (hourCounts.get(9) ?? 0) + (hourCounts.get(10) ?? 0) + (hourCounts.get(11) ?? 0) + (hourCounts.get(12) ?? 0) + (hourCounts.get(13) ?? 0) + (hourCounts.get(14) ?? 0) + (hourCounts.get(15) ?? 0) + (hourCounts.get(16) ?? 0) + (hourCounts.get(17) ?? 0);
    sections.push({
        title: "Activity Pattern",
        content: [
            `Most active hours: ${peakHours || "N/A"}`,
            `Most active days: ${peakDays || "N/A"}`,
            `Typical active window: ${activeStart} - ${activeEnd} UTC`,
            nightMsgs > dayMsgs ? "Likely a night owl (more messages between 12am-5am)" : null,
        ].filter(Boolean).join("\n"),
    });
    const tz = estimateTimezone(hourCounts);
    const sleep = estimateSleepSchedule(hourCounts);
    const activeWindows = findActiveWindows(hourCounts, use24h);
    sections.push({
        title: "Timezone & Schedule",
        content: [
            `Estimated timezone: ${tz.label} (confidence: ${tz.confidence})`,
            `Most active time: ${activeWindows[0] || "N/A"}`,
            activeWindows.length > 1 ? `Secondary active: ${activeWindows[1]}` : null,
            `Likely sleep hours: ${sleep.start} - ${sleep.end} UTC (~${sleep.hours}h)`,
            `Wake time (estimated): ${formatHour(parseInt(sleep.end) || 8, use24h)} local`,
            `Bedtime (estimated): ${formatHour(parseInt(sleep.start) || 23, use24h)} local`,
        ].filter(Boolean).join("\n"),
    });
    const heatmapLines = [];
    for (let d = 0; d < 7; d++) {
        const dayMap = hourCountsByDay.get(d) ?? new Map();
        const maxForDay = Math.max(...dayMap.values(), 1);
        const bar = Array.from({ length: 24 }, (_, h) => {
            const count = dayMap.get(h) ?? 0;
            if (count === 0)
                return "\u2591";
            const ratio = count / maxForDay;
            if (ratio > 0.75)
                return "\u2588";
            if (ratio > 0.5)
                return "\u2593";
            if (ratio > 0.25)
                return "\u2592";
            return "\u2591";
        }).join("");
        heatmapLines.push(`${dayNames[d].slice(0, 3)} ${bar}`);
    }
    sections.push({
        title: "Weekly Heatmap",
        content: ["Hours: 00                        23", ...heatmapLines].join("\n"),
    });
    const wordCounts = new Map();
    for (const msg of messages) {
        for (const w of extractWords(msg.content)) {
            wordCounts.set(w, (wordCounts.get(w) ?? 0) + 1);
        }
    }
    const topWords = topN(wordCounts, 15).map(([w, c]) => `${w} (${c})`).join(", ");
    const uniqueWords = wordCounts.size;
    sections.push({
        title: "Language & Vocabulary",
        content: [
            `Unique words used: ${uniqueWords}`,
            `Top words: ${topWords || "N/A"}`,
            `Avg words per message: ${Math.round(messages.reduce((s, m) => s + extractWords(m.content).length, 0) / totalMessages)}`,
            `Vocabulary richness: ${(uniqueWords / Math.max(totalChars, 1) * 100).toFixed(2)}%`,
        ].join("\n"),
    });
    const langPatterns = detectLanguagePatterns(messages);
    if (langPatterns.length > 0) {
        sections.push({ title: "Communication Style", content: langPatterns.join("\n") });
    }
    const emojiCounts = new Map();
    let customEmojiCount = 0;
    for (const msg of messages) {
        for (const e of msg.content.match(EMOJI_REGEX) ?? []) {
            emojiCounts.set(e, (emojiCounts.get(e) ?? 0) + 1);
        }
        customEmojiCount += (msg.content.match(CUSTOM_EMOJI_REGEX) ?? []).length;
    }
    const totalEmojis = [...emojiCounts.values()].reduce((s, c) => s + c, 0);
    const topEmojis = topN(emojiCounts, 10).map(([e, c]) => `${e} (${c})`).join(", ");
    sections.push({
        title: "Emoji Usage",
        content: [
            `Total emojis used: ${totalEmojis}`,
            `Custom Discord emojis: ${customEmojiCount}`,
            `Unique native emojis: ${emojiCounts.size}`,
            `Top emojis: ${topEmojis || "None"}`,
            `Emoji density: ${(totalEmojis / totalChars * 100).toFixed(2)}% of characters`,
        ].join("\n"),
    });
    let totalLinks = 0, totalMentions = 0, totalChannels = 0;
    const linkDomains = new Map();
    for (const msg of messages) {
        const links = msg.content.match(URL_REGEX) ?? [];
        totalLinks += links.length;
        for (const link of links) {
            try {
                const domain = new URL(link).hostname.replace("www.", "");
                linkDomains.set(domain, (linkDomains.get(domain) ?? 0) + 1);
            }
            catch { }
        }
        totalMentions += (msg.content.match(MENTION_REGEX) ?? []).length;
        totalChannels += (msg.content.match(CHANNEL_REGEX) ?? []).length;
    }
    const topDomains = topN(linkDomains, 5).map(([d, c]) => `${d} (${c})`).join(", ");
    sections.push({
        title: "Links & Mentions",
        content: [
            `Total links shared: ${totalLinks}`,
            `Top domains: ${topDomains || "None"}`,
            `Mentions sent: ${totalMentions}`,
            `Channel references: ${totalChannels}`,
            `Avg links per message: ${(totalLinks / totalMessages).toFixed(2)}`,
        ].join("\n"),
    });
    const attachTypes = new Map();
    let totalAttachSize = 0;
    for (const msg of messages) {
        for (const att of msg.attachments) {
            const ext = att.filename.split(".").pop()?.toLowerCase() ?? "unknown";
            attachTypes.set(ext, (attachTypes.get(ext) ?? 0) + 1);
            totalAttachSize += att.size;
        }
    }
    const attachBreakdown = topN(attachTypes, 5).map(([t, c]) => `${t} (${c})`).join(", ");
    sections.push({
        title: "Attachments",
        content: [
            `Total attachments: ${totalAttachments}`,
            `Total size: ${(totalAttachSize / 1024 / 1024).toFixed(2)} MB`,
            `Types: ${attachBreakdown || "None"}`,
            `Avg attachment size: ${totalAttachments > 0 ? (totalAttachSize / totalAttachments / 1024).toFixed(1) : 0} KB`,
        ].join("\n"),
    });
    const messagesWithSpoilers = messages.filter(m => SPOILER_REGEX.test(m.content)).length;
    const messagesWithCode = messages.filter(m => m.content.includes("```")).length;
    const messagesWithStickers = messages.filter(m => (m.stickerItems?.length ?? 0) > 0).length;
    const replyCount = messages.filter(m => m.message_reference).length;
    const ttsMessages = messages.filter(m => m.tts).length;
    const pinnedMessages = messages.filter(m => m.pinned).length;
    sections.push({
        title: "Message Patterns",
        content: [
            `Replies: ${replyCount} (${(replyCount / totalMessages * 100).toFixed(1)}%)`,
            `Messages with spoilers: ${messagesWithSpoilers}`,
            `Messages with code blocks: ${messagesWithCode}`,
            `Messages with stickers: ${messagesWithStickers}`,
            `TTS messages: ${ttsMessages}`,
            `Pinned messages: ${pinnedMessages}`,
        ].join("\n"),
    });
    const timestamps = messages.map(m => new Date(m.timestamp).getTime()).sort((a, b) => a - b);
    const firstMsg = new Date(timestamps[0]).toLocaleDateString();
    const lastMsg = new Date(timestamps[timestamps.length - 1]).toLocaleDateString();
    const spanDays = Math.round((timestamps[timestamps.length - 1] - timestamps[0]) / 86400000);
    const uniqueDays = new Set(messages.map(m => new Date(m.timestamp).toDateString())).size;
    const gaps = [];
    for (let i = 1; i < timestamps.length; i++) {
        gaps.push(timestamps[i] - timestamps[i - 1]);
    }
    const avgGap = gaps.length > 0 ? gaps.reduce((s, g) => s + g, 0) / gaps.length : 0;
    const avgGapMinutes = Math.round(avgGap / 60000);
    const longestStreak = (() => {
        let best = 0, cur = 1;
        const sortedDays = [...new Set(messages.map(m => new Date(m.timestamp).toDateString()))].sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
        for (let i = 1; i < sortedDays.length; i++) {
            const diff = (new Date(sortedDays[i]).getTime() - new Date(sortedDays[i - 1]).getTime()) / 86400000;
            if (diff <= 1) {
                cur++;
            }
            else {
                best = Math.max(best, cur);
                cur = 1;
            }
        }
        return Math.max(best, cur);
    })();
    sections.push({
        title: "Account & Activity Insights",
        content: [
            `Observation period: ${firstMsg} to ${lastMsg} (${spanDays} days)`,
            `Active on ${uniqueDays} unique days`,
            `Avg daily messages: ${(totalMessages / Math.max(uniqueDays, 1)).toFixed(1)}`,
            `Avg time between messages: ${avgGapMinutes > 60 ? `${Math.round(avgGapMinutes / 60)}h ${avgGapMinutes % 60}m` : `${avgGapMinutes}m`}`,
            `Longest active streak: ${longestStreak} day${longestStreak !== 1 ? "s" : ""}`,
            `Account age (observed): ${estimateAccountAge(messages)}`,
        ].join("\n"),
    });
    const behaviors = [];
    if (totalLinks / totalMessages > 0.5)
        behaviors.push("Frequent link sharer");
    if (totalEmojis / totalMessages > 3)
        behaviors.push("Heavy emoji user");
    if (avgLength > 200)
        behaviors.push("Long-form communicator");
    if (avgLength < 20)
        behaviors.push("Brief/succinct communicator");
    if (totalAttachments / totalMessages > 0.3)
        behaviors.push("Frequent file sender");
    if (totalMentions / totalMessages > 1)
        behaviors.push("Frequent @mention user");
    if (nightMsgs > dayMsgs)
        behaviors.push("Nocturnal activity pattern");
    if (messagesWithCode > totalMessages * 0.1)
        behaviors.push("Shares code frequently");
    if (replyCount / totalMessages > 0.5)
        behaviors.push("Frequently replies to others");
    if (pinnedMessages > 0)
        behaviors.push("Has pinned messages (selective curator)");
    if (ttsMessages > 0)
        behaviors.push("Uses text-to-speech");
    if (uniqueDays > 30)
        behaviors.push("Long-term active user");
    else if (uniqueDays < 3)
        behaviors.push("Sporadic/short burst user");
    if (totalReactions > totalMessages * 2)
        behaviors.push("Heavy reaction user");
    if (customEmojiCount > totalMessages * 0.5)
        behaviors.push("Uses many custom Discord emojis");
    sections.push({
        title: "Behavioral Profile",
        content: [
            behaviors.length > 0 ? "Detected behaviors:" : "No strong behavioral patterns detected.",
            ...behaviors.map(b => `  - ${b}`),
        ].join("\n"),
    });
    const summary = [
        `OSINT analysis of **${author.globalName || author.username}** (${author.username})`,
        `Analyzed ${totalMessages} messages over ${spanDays} days.`,
        `Estimated timezone: ${tz.label}.`,
        `Primarily active ${peakHours || "N/A"} on ${peakDays || "N/A"}.`,
        `Sleep schedule: ~${sleep.start}-${sleep.end} UTC.`,
        behaviors.length > 0 ? `Key traits: ${behaviors.slice(0, 3).join(", ")}.` : "",
    ].filter(Boolean).join(" ");
    return { summary, sections };
}
