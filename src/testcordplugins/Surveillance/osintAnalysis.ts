/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { SurveillanceEvent } from "./types";

export interface OsintSection {
    title: string;
    content: string;
}

export interface OsintAnalysisResult {
    summary: string;
    sections: OsintSection[];
}

function formatHour(h: number, use24h: boolean): string {
    if (use24h) return `${String(h).padStart(2, "0")}:00`;
    const ampm = h < 12 ? "am" : "pm";
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}${ampm}`;
}

function topN<T>(map: Map<T, number>, n: number): Array<[T, number]> {
    return [...map.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, n);
}

function estimateTimezone(hourCounts: Map<number, number>): { offset: number; label: string; confidence: string; } {
    const totalMsgs = [...hourCounts.values()].reduce((s, c) => s + c, 0);
    if (totalMsgs === 0) return { offset: 0, label: "UTC+0", confidence: "N/A" };

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
    if (activeHours.length >= 8) confidence = "medium";
    if (activeHours.length >= 12) confidence = "high";

    const sign = adjustedOffset >= 0 ? "+" : "-";
    return { offset: adjustedOffset, label: `UTC${sign}${Math.abs(adjustedOffset)}`, confidence };
}

function estimateSleepSchedule(hourCounts: Map<number, number>): { start: string; end: string; hours: number; } {
    const total = [...hourCounts.values()].reduce((s, c) => s + c, 0);
    if (total === 0) return { start: "N/A", end: "N/A", hours: 0 };

    const threshold = total * 0.01;
    const quietHours: number[] = [];
    for (let h = 0; h < 24; h++) {
        if ((hourCounts.get(h) ?? 0) < threshold) quietHours.push(h);
    }
    if (quietHours.length === 0) return { start: "N/A", end: "N/A", hours: 0 };

    let bestStart = quietHours[0], bestLen = 1, curStart = quietHours[0], curLen = 1;
    for (let i = 1; i < quietHours.length; i++) {
        if (quietHours[i] === quietHours[i - 1] + 1) {
            curLen++;
        } else {
            if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }
            curStart = quietHours[i]; curLen = 1;
        }
    }
    if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }

    const sleepEnd = (bestStart + bestLen) % 24;
    return { start: `${String(bestStart).padStart(2, "0")}:00`, end: `${String(sleepEnd).padStart(2, "0")}:00`, hours: bestLen };
}

function formatDurationShort(ms: number): string {
    if (ms <= 0) return "0s";
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}

export function analyzeSurveillanceEvents(events: SurveillanceEvent[], use24h = false): OsintAnalysisResult {
    if (events.length === 0) {
        return { summary: "No surveillance events recorded for this user.", sections: [] };
    }

    const sections: OsintSection[] = [];
    const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
    const username = sorted[sorted.length - 1]?.username ?? "Unknown";

    const hourCounts = new Map<number, number>();
    const dayCounts = new Map<number, number>();
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    for (const event of sorted) {
        const date = new Date(event.timestamp);
        const hour = date.getUTCHours();
        const day = date.getUTCDay();
        hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
        dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
    }

    const totalEvents = sorted.length;
    const firstSeen = sorted[0].timestamp;
    const lastSeen = sorted[sorted.length - 1].timestamp;
    const observationSpanMs = lastSeen - firstSeen;
    const observationDays = Math.max(1, Math.round(observationSpanMs / 86400000));
    const uniqueDays = new Set(sorted.map(e => new Date(e.timestamp).toDateString())).size;

    sections.push({
        title: "Observation Overview",
        content: [
            `Total events recorded: ${totalEvents}`,
            `Observation period: ${new Date(firstSeen).toLocaleDateString()} to ${new Date(lastSeen).toLocaleDateString()} (${observationDays} days)`,
            `Active on ${uniqueDays} unique days`,
            `Avg events per active day: ${(totalEvents / Math.max(uniqueDays, 1)).toFixed(1)}`,
        ].join("\n"),
    });

    const peakHours = topN(hourCounts, 3).map(([h, c]) => `${formatHour(h, use24h)} (${c})`).join(", ");
    const peakDays = topN(dayCounts, 3).map(([d, c]) => `${dayNames[d]} (${c})`).join(", ");

    const nightEvents = [0, 1, 2, 3, 4, 5].reduce((s, h) => s + (hourCounts.get(h) ?? 0), 0);
    const dayEvents = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17].reduce((s, h) => s + (hourCounts.get(h) ?? 0), 0);

    sections.push({
        title: "Activity Timing",
        content: [
            `Most active hours: ${peakHours || "N/A"}`,
            `Most active days: ${peakDays || "N/A"}`,
            nightEvents > dayEvents ? "Likely a night owl (more activity between 12am-5am UTC)" : "Primarily daytime active (6am-5pm UTC)",
            `Night events (12am-5am): ${nightEvents}`,
            `Day events (6am-5pm): ${dayEvents}`,
        ].join("\n"),
    });

    const tz = estimateTimezone(hourCounts);
    const sleep = estimateSleepSchedule(hourCounts);

    sections.push({
        title: "Timezone & Schedule",
        content: [
            `Estimated timezone: ${tz.label} (confidence: ${tz.confidence})`,
            `Likely sleep hours: ${sleep.start} - ${sleep.end} UTC (~${sleep.hours}h)`,
            `Wake time (estimated): ${sleep.end !== "N/A" ? sleep.end : "unknown"} UTC`,
            `Bedtime (estimated): ${sleep.start !== "N/A" ? sleep.start : "unknown"} UTC`,
        ].join("\n"),
    });

    const messageEvents = sorted.filter(e => e.type === "message");
    const editEvents = sorted.filter(e => e.type === "message_edit");
    const deleteEvents = sorted.filter(e => e.type === "message_delete");
    const typingEvents = sorted.filter(e => e.type === "typing");
    const reactionAddEvents = sorted.filter(e => e.type === "reaction_add");
    const reactionRemoveEvents = sorted.filter(e => e.type === "reaction_remove");

    const totalLinks = sorted.reduce((s, e) => s + (e.links?.length ?? 0), 0);
    const totalAttachments = sorted.reduce((s, e) => s + (e.attachments?.length ?? 0), 0);

    const linkDomains = new Map<string, number>();
    for (const event of sorted) {
        for (const link of event.links ?? []) {
            try {
                const domain = new URL(link).hostname.replace("www.", "");
                linkDomains.set(domain, (linkDomains.get(domain) ?? 0) + 1);
            } catch { /* skip */ }
        }
    }
    const topDomains = topN(linkDomains, 5).map(([d, c]) => `${d} (${c})`).join(", ");

    sections.push({
        title: "Communication Patterns",
        content: [
            `Messages sent: ${messageEvents.length}`,
            `Messages edited: ${editEvents.length}`,
            `Messages deleted: ${deleteEvents.length}`,
            `Typing signals: ${typingEvents.length}`,
            `Reactions added: ${reactionAddEvents.length}`,
            `Reactions removed: ${reactionRemoveEvents.length}`,
            `Links shared: ${totalLinks}`,
            `Attachments sent: ${totalAttachments}`,
            topDomains ? `Top link domains: ${topDomains}` : null,
            editEvents.length > 0 ? `Edit rate: ${(editEvents.length / Math.max(messageEvents.length, 1) * 100).toFixed(1)}% of messages` : null,
            deleteEvents.length > 0 ? `Delete rate: ${(deleteEvents.length / Math.max(messageEvents.length, 1) * 100).toFixed(1)}% of messages` : null,
        ].filter(Boolean).join("\n"),
    });

    const voiceJoins = sorted.filter(e => e.type === "voice_join");
    const voiceLeaves = sorted.filter(e => e.type === "voice_leave");
    const voiceMoves = sorted.filter(e => e.type === "voice_move");
    const voiceUpdates = sorted.filter(e => e.type === "voice_update");

    let totalVoiceMs = 0;
    for (const event of [...voiceLeaves, ...voiceMoves]) {
        const durationMs = event.metadata?.durationMs;
        if (typeof durationMs === "number") totalVoiceMs += durationMs;
    }

    const voiceChannels = new Map<string, number>();
    for (const event of voiceJoins) {
        const name = event.channelName ?? event.channelId ?? "Unknown";
        voiceChannels.set(name, (voiceChannels.get(name) ?? 0) + 1);
    }
    const topVoiceChannels = topN(voiceChannels, 3).map(([name, c]) => `${name} (${c} joins)`).join(", ");

    let streamCount = 0;
    let cameraCount = 0;
    for (const event of [...voiceJoins, ...voiceUpdates]) {
        if (event.metadata?.selfStream === true) streamCount++;
        if (event.metadata?.selfVideo === true) cameraCount++;
    }

    sections.push({
        title: "Voice Activity",
        content: [
            `Voice joins: ${voiceJoins.length}`,
            `Voice leaves: ${voiceLeaves.length}`,
            `Voice moves: ${voiceMoves.length}`,
            `Voice state changes: ${voiceUpdates.length}`,
            `Total voice time: ${formatDurationShort(totalVoiceMs)}`,
            voiceJoins.length > 0 ? `Avg session length: ${formatDurationShort(totalVoiceMs / Math.max(voiceLeaves.length + voiceMoves.length, 1))}` : null,
            topVoiceChannels ? `Top channels: ${topVoiceChannels}` : null,
            streamCount > 0 ? `Streaming events: ${streamCount}` : null,
            cameraCount > 0 ? `Camera events: ${cameraCount}` : null,
        ].filter(Boolean).join("\n"),
    });

    const statusEvents = sorted.filter(e => e.type === "status");
    const statusCounts = new Map<string, number>();
    for (const event of statusEvents) {
        const to = event.metadata?.to;
        if (typeof to === "string") statusCounts.set(to, (statusCounts.get(to) ?? 0) + 1);
    }

    let onlineMs = 0, idleMs = 0, dndMs = 0, offlineMs = 0;
    let prevStatus: string | undefined;
    let prevStatusTime: number | undefined;

    for (const event of statusEvents) {
        if (prevStatus && prevStatusTime != null) {
            const duration = event.timestamp - prevStatusTime;
            if (prevStatus === "online") onlineMs += duration;
            else if (prevStatus === "idle") idleMs += duration;
            else if (prevStatus === "dnd") dndMs += duration;
            else offlineMs += duration;
        }
        prevStatus = typeof event.metadata?.to === "string" ? event.metadata.to : undefined;
        prevStatusTime = event.timestamp;
    }
    if (prevStatus && prevStatusTime != null) {
        const duration = lastSeen - prevStatusTime;
        if (prevStatus === "online") onlineMs += duration;
        else if (prevStatus === "idle") idleMs += duration;
        else if (prevStatus === "dnd") dndMs += duration;
        else offlineMs += duration;
    }

    sections.push({
        title: "Presence Patterns",
        content: [
            `Status transitions: ${statusEvents.length}`,
            `Online time: ${formatDurationShort(onlineMs)}`,
            `Idle time: ${formatDurationShort(idleMs)}`,
            `DND time: ${formatDurationShort(dndMs)}`,
            `Offline time: ${formatDurationShort(offlineMs)}`,
            statusCounts.size > 0 ? `Status distribution: ${[...statusCounts.entries()].map(([s, c]) => `${s} (${c})`).join(", ")}` : null,
        ].filter(Boolean).join("\n"),
    });

    const activityStarts = sorted.filter(e => e.type === "activity_start");
    const activityStops = sorted.filter(e => e.type === "activity_stop");
    const activityUpdates = sorted.filter(e => e.type === "activity_update");

    const activityNames = new Map<string, number>();
    for (const event of [...activityStarts, ...activityUpdates]) {
        const name = (event.metadata?.activity as string) ?? (event.metadata?.to as string) ?? event.details.replace(/^(Started|Changed activity from .+ to) /, "").replace(/\.$/, "");
        if (name) activityNames.set(name, (activityNames.get(name) ?? 0) + 1);
    }
    const topActivities = topN(activityNames, 5).map(([name, c]) => `${name} (${c})`).join(", ");

    let totalActivityMs = 0;
    const activeSessions = new Map<string, number>();
    for (const event of sorted) {
        if (event.type === "activity_start") {
            const name = (event.metadata?.activity as string) ?? event.details.replace(/^Started /, "").replace(/\.$/, "");
            activeSessions.set(name, event.timestamp);
        } else if (event.type === "activity_stop") {
            const name = (event.metadata?.activity as string) ?? event.details.replace(/^Stopped /, "").replace(/\.$/, "");
            const startedAt = activeSessions.get(name);
            if (startedAt != null) {
                totalActivityMs += event.timestamp - startedAt;
                activeSessions.delete(name);
            }
        }
    }
    for (const startedAt of activeSessions.values()) {
        totalActivityMs += lastSeen - startedAt;
    }

    sections.push({
        title: "Activity & Gaming",
        content: [
            `Activity starts: ${activityStarts.length}`,
            `Activity stops: ${activityStops.length}`,
            `Activity updates: ${activityUpdates.length}`,
            `Total activity time: ${formatDurationShort(totalActivityMs)}`,
            topActivities ? `Top activities: ${topActivities}` : "No activities recorded",
        ].join("\n"),
    });

    const profileUpdates = sorted.filter(e => e.type === "profile_update");
    const identityFields = new Map<string, number>();
    for (const event of profileUpdates) {
        for (const entry of event.identityHistory ?? []) {
            identityFields.set(entry.field, (identityFields.get(entry.field) ?? 0) + 1);
        }
    }

    sections.push({
        title: "Profile & Identity",
        content: [
            `Profile updates: ${profileUpdates.length}`,
            identityFields.size > 0 ? `Changed fields: ${[...identityFields.entries()].map(([f, c]) => `${f} (${c})`).join(", ")}` : "No identity changes recorded",
        ].join("\n"),
    });

    const channelCounts = new Map<string, number>();
    const guildCounts = new Map<string, number>();
    for (const event of sorted) {
        if (event.channelName) channelCounts.set(event.channelName, (channelCounts.get(event.channelName) ?? 0) + 1);
        if (event.guildName) guildCounts.set(event.guildName, (guildCounts.get(event.guildName) ?? 0) + 1);
    }
    const topChannels = topN(channelCounts, 5).map(([name, c]) => `${name} (${c})`).join(", ");
    const topGuilds = topN(guildCounts, 3).map(([name, c]) => `${name} (${c})`).join(", ");

    sections.push({
        title: "Location Patterns",
        content: [
            topChannels ? `Top channels: ${topChannels}` : "No channel data",
            topGuilds ? `Top servers: ${topGuilds}` : "No server data",
        ].join("\n"),
    });

    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
        gaps.push(sorted[i].timestamp - sorted[i - 1].timestamp);
    }
    const avgGap = gaps.length > 0 ? gaps.reduce((s, g) => s + g, 0) / gaps.length : 0;

    const longestStreak = (() => {
        const sortedDays = [...new Set(sorted.map(e => new Date(e.timestamp).toDateString()))]
            .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
        let best = 0, cur = 1;
        for (let i = 1; i < sortedDays.length; i++) {
            const diff = (new Date(sortedDays[i]).getTime() - new Date(sortedDays[i - 1]).getTime()) / 86400000;
            if (diff <= 1) cur++;
            else { best = Math.max(best, cur); cur = 1; }
        }
        return Math.max(best, cur);
    })();

    const behaviors: string[] = [];
    if (nightEvents > dayEvents) behaviors.push("Nocturnal activity pattern");
    if (messageEvents.length > totalEvents * 0.4) behaviors.push("Primarily a communicator");
    if (voiceJoins.length > 10) behaviors.push("Frequent voice chat user");
    if (totalVoiceMs > 3600000) behaviors.push("Long voice sessions");
    if (editEvents.length > messageEvents.length * 0.2) behaviors.push("Frequently edits messages");
    if (deleteEvents.length > messageEvents.length * 0.1) behaviors.push("Frequently deletes messages");
    if (totalLinks > messageEvents.length * 0.3) behaviors.push("Frequent link sharer");
    if (totalAttachments > messageEvents.length * 0.2) behaviors.push("Frequent file sender");
    if (statusEvents.length > 20) behaviors.push("Frequently changes status");
    if (activityStarts.length > 10) behaviors.push("Active gamer/media consumer");
    if (streamCount > 5) behaviors.push("Regular streamer");
    if (profileUpdates.length > 3) behaviors.push("Frequently updates profile");
    if (reactionAddEvents.length > messageEvents.length) behaviors.push("Heavy reaction user");
    if (uniqueDays > 30) behaviors.push("Long-term consistent user");
    else if (uniqueDays < 3 && totalEvents > 50) behaviors.push("Burst activity pattern");
    if (longestStreak > 14) behaviors.push(`Highly consistent (${longestStreak} day streak)`);

    sections.push({
        title: "Behavioral Profile",
        content: [
            `Avg time between events: ${formatDurationShort(avgGap)}`,
            `Longest active streak: ${longestStreak} day${longestStreak !== 1 ? "s" : ""}`,
            behaviors.length > 0 ? "Detected behaviors:" : "No strong behavioral patterns detected.",
            ...behaviors.map(b => `  - ${b}`),
        ].join("\n"),
    });

    const summary = [
        `OSINT analysis of ${username} from surveillance data.`,
        `${totalEvents} events over ${observationDays} days.`,
        `Estimated timezone: ${tz.label}.`,
        `Most active ${peakHours || "N/A"} on ${peakDays || "N/A"}.`,
        `Sleep schedule: ~${sleep.start}-${sleep.end} UTC.`,
        behaviors.length > 0 ? `Key traits: ${behaviors.slice(0, 3).join(", ")}.` : "",
    ].filter(Boolean).join(" ");

    return { summary, sections };
}
