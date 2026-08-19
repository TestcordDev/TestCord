/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import "./styles.css";
import { get, set } from "@api/DataStore";
import { BaseText } from "@components/BaseText";
import ErrorBoundary from "@components/ErrorBoundary";
import { TOTALS_MAX } from "@utils/cacheLimits";
import { EquicordDevs } from "@utils/constants";
import { useTimer } from "@utils/react";
import definePlugin from "@utils/types";
import { findComponentByCodeLazy, findCssClassesLazy } from "@webpack";
import { SelectedChannelStore, UserStore, VoiceStateStore } from "@webpack/common";
const wrapperClasses = findCssClassesLazy("memberSinceWrapper");
const containerClasses = findCssClassesLazy("memberSince");
const Section = findComponentByCodeLazy("headingVariant:", '"section"', "headingIcon:");
const storageKey = "VoiceStats_totals";
const saveIntervalMs = 30_000;
const sessionStarts = new Map();
const totalsByUser = new Map();
let trackedChannelId = null;
let saveIntervalId = null;
function trimTotals() {
    if (totalsByUser.size <= TOTALS_MAX)
        return;
    const sorted = [...totalsByUser.entries()].sort((a, b) => a[1] - b[1]);
    const toDelete = sorted.slice(0, totalsByUser.size - TOTALS_MAX);
    for (const [userId] of toDelete)
        totalsByUser.delete(userId);
}
async function loadStoredTotals() {
    const saved = await get(storageKey);
    if (!saved)
        return;
    for (const [userId, value] of Object.entries(saved))
        totalsByUser.set(userId, value);
    trimTotals();
}
async function persistTotals() {
    const obj = {};
    let i = 0;
    for (const [userId, value] of totalsByUser) {
        obj[userId] = value;
        if (++i >= TOTALS_MAX)
            break;
    }
    await set(storageKey, obj);
}
function flushActiveSessions() {
    const now = Date.now();
    for (const [userId, startedAt] of sessionStarts) {
        const accrued = Math.floor((now - startedAt) / 1000);
        totalsByUser.set(userId, (totalsByUser.get(userId) ?? 0) + accrued);
        sessionStarts.set(userId, now);
    }
    trimTotals();
}
function startTrackingChannel(channelId, myId) {
    trackedChannelId = channelId;
    const states = VoiceStateStore.getVoiceStatesForChannel(channelId) ?? {};
    const now = Date.now();
    for (const state of Object.values(states)) {
        if (state.userId !== myId)
            sessionStarts.set(state.userId, now);
    }
    saveIntervalId = setInterval(() => {
        flushActiveSessions();
        persistTotals();
    }, saveIntervalMs);
}
function stopTrackingChannel() {
    if (saveIntervalId) {
        clearInterval(saveIntervalId);
        saveIntervalId = null;
    }
    if (!trackedChannelId)
        return;
    flushActiveSessions();
    sessionStarts.clear();
    trackedChannelId = null;
    persistTotals();
}
function getLiveSeconds(userId) {
    const stored = totalsByUser.get(userId) ?? 0;
    const startedAt = sessionStarts.get(userId);
    return startedAt ? stored + Math.floor((Date.now() - startedAt) / 1000) : stored;
}
function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0)
        return `${h}h ${m}m ${s}s`;
    if (m > 0)
        return `${m}m ${s}s`;
    return `${s}s`;
}
const VoiceStatsSection = ErrorBoundary.wrap(({ userId, isSideBar }) => {
    const isLive = sessionStarts.has(userId);
    useTimer({ interval: isLive ? 1000 : 0 });
    const seconds = getLiveSeconds(userId);
    if (seconds <= 0)
        return null;
    const text = formatDuration(seconds);
    if (isSideBar) {
        return (<Section heading="Voice Time" headingVariant="text-xs/semibold" headingColor="text-strong">
                <BaseText size="sm">{text}</BaseText>
            </Section>);
    }
    return (<Section heading="Voice Time" headingVariant="text-xs/medium" headingColor="text-default" className="vc-voicestats-profile-section">
            <div className={wrapperClasses.memberSinceWrapper}>
                <div className={containerClasses.memberSince}>
                    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="var(--interactive-icon-default)">
                        <path d="M12 1a4 4 0 0 0-4 4v6a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4Z"/>
                        <path d="M19 11a1 1 0 0 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V21a1 1 0 1 0 2 0v-3.08A7 7 0 0 0 19 11Z"/>
                    </svg>
                    <BaseText size="sm">{text}</BaseText>
                </div>
            </div>
        </Section>);
}, { noop: true });
export default definePlugin({
    name: "VoiceStats",
    description: "Shows how long you've spent in voice with each user in their profile",
    tags: ["Voice", "Friends"],
    authors: [EquicordDevs.Moowi],
    dependencies: ["ProfileSectionsAPI"],
    renderProfileSection: {
        render: VoiceStatsSection,
        priority: 0,
    },
    flux: {
        VOICE_STATE_UPDATES({ voiceStates }) {
            const myId = UserStore.getCurrentUser()?.id;
            if (!myId)
                return;
            for (const state of voiceStates) {
                const { userId, channelId, oldChannelId } = state;
                if (userId === myId) {
                    if (!oldChannelId && channelId)
                        startTrackingChannel(channelId, myId);
                    else if (oldChannelId && !channelId)
                        stopTrackingChannel();
                    else if (channelId && channelId !== oldChannelId) {
                        stopTrackingChannel();
                        startTrackingChannel(channelId, myId);
                    }
                    continue;
                }
                const joinedMyChannel = trackedChannelId !== null && channelId === trackedChannelId && oldChannelId !== trackedChannelId;
                const leftMyChannel = trackedChannelId !== null && oldChannelId === trackedChannelId && channelId !== trackedChannelId;
                if (joinedMyChannel) {
                    sessionStarts.set(userId, Date.now());
                }
                else if (leftMyChannel && sessionStarts.has(userId)) {
                    const startedAt = sessionStarts.get(userId);
                    const accrued = Math.floor((Date.now() - startedAt) / 1000);
                    totalsByUser.set(userId, (totalsByUser.get(userId) ?? 0) + accrued);
                    trimTotals();
                    sessionStarts.delete(userId);
                    persistTotals();
                }
            }
        }
    },
    async start() {
        await loadStoredTotals();
        const myId = UserStore.getCurrentUser()?.id;
        if (!myId)
            return;
        const channelId = SelectedChannelStore.getVoiceChannelId?.();
        if (channelId)
            startTrackingChannel(channelId, myId);
    },
    stop() {
        stopTrackingChannel();
    }
});
