/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { sendBotMessage } from "@api/Commands";
import { DataStore } from "@api/index";
import { getUserSettingLazy } from "@api/UserSettings";
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { findStoreLazy } from "@webpack";
// Webpack module lookups
const UserStore = findStoreLazy("UserStore");
const StatusSettings = getUserSettingLazy("status", "status");
const revertTimers = new Set();
const parseDuration = (str) => {
    let ms = 0;
    // Remove spaces to handle inputs like "1h 30m" -> "1h30m"
    const cleanStr = str.replace(/\s+/g, "");
    // Regex to find numbers followed by s, m, h, or d
    const regex = /(\d+)([smhd])/gi;
    let match;
    let found = false;
    while ((match = regex.exec(cleanStr)) !== null) {
        found = true;
        const value = parseInt(match[1], 10);
        const unit = match[2].toLowerCase();
        switch (unit) {
            case "s":
                ms += value * 1000;
                break;
            case "m":
                ms += value * 60 * 1000;
                break;
            case "h":
                ms += value * 60 * 60 * 1000;
                break;
            case "d":
                ms += value * 24 * 60 * 60 * 1000;
                break;
        }
    }
    return found ? ms : null;
};
async function saveRevertData(revertAt, originalStatus) {
    const data = { revertAt, originalStatus };
    await DataStore.set("statuscommand-revert", data);
}
async function loadRevertData() {
    return await DataStore.get("statuscommand-revert");
}
async function deleteRevertData() {
    await DataStore.del("statuscommand-revert");
}
export default definePlugin({
    name: "StatusCommand",
    description: "Set a temporary status that reverts after a set duration (e.g. /status dnd 1h)",
    tags: ["Activity", "Commands"],
    authors: [TestcordDevs.x2b, TestcordDevs.nnenaza],
    dependencies: ["UserSettingsAPI"],
    async start() {
        // Check for pending revert on plugin load
        const revertData = await loadRevertData();
        if (revertData) {
            const now = Date.now();
            if (now >= revertData.revertAt) {
                // Time has already passed, revert immediately
                StatusSettings.updateSetting(revertData.originalStatus);
                await deleteRevertData();
                // Note: No message sent here as it's on startup
            }
            else {
                // Time hasn't passed yet, set timeout for remaining time
                const remainingMs = revertData.revertAt - now;
                const timer = setTimeout(async () => {
                    revertTimers.delete(timer);
                    StatusSettings.updateSetting(revertData.originalStatus);
                    await deleteRevertData();
                    // Note: No message sent here as it's on startup
                }, remainingMs);
                revertTimers.add(timer);
            }
        }
    },
    commands: [{
            name: "status",
            description: "Set your status for a specific duration",
            inputType: 0 /* ApplicationCommandInputType.BUILT_IN */,
            options: [
                {
                    name: "presence",
                    description: "The status to set",
                    type: 3 /* ApplicationCommandOptionType.STRING */,
                    required: true,
                    choices: [
                        { name: "Online", value: "online", label: "Online" },
                        { name: "Idle", value: "idle", label: "Idle" },
                        { name: "Do Not Disturb", value: "dnd", label: "Do Not Disturb" },
                        { name: "Invisible (Offline)", value: "invisible", label: "Invisible (Offline)" }
                    ]
                },
                {
                    name: "duration",
                    description: "Duration (e.g. 1h, 30m, 1h 30m, 900s, 2d)",
                    type: 3 /* ApplicationCommandOptionType.STRING */,
                    required: true
                }
            ],
            execute: async (args, ctx) => {
                const newStatusStr = args[0].value.toLowerCase();
                const durationStr = args[1].value;
                // 1. Validate and Parse Duration
                const durationMs = parseDuration(durationStr);
                if (durationMs === null) {
                    sendBotMessage(ctx.channel.id, {
                        content: `Invalid duration format: "${durationStr}".\nTry formats like: 10m, 1h, 30s, 1h 30m.`
                    });
                    return;
                }
                // 2. Get Current Status
                const oldStatus = StatusSettings.getSetting() || "online";
                // 3. Validate status string
                const validStatuses = ["online", "idle", "dnd", "invisible"];
                if (!validStatuses.includes(newStatusStr)) {
                    sendBotMessage(ctx.channel.id, { content: "Invalid status selected." });
                    return;
                }
                // 4. Apply New Status
                StatusSettings.updateSetting(newStatusStr);
                // 5. Save revert data to file
                const revertAt = Date.now() + durationMs;
                await saveRevertData(revertAt, oldStatus);
                // 6. Feedback
                sendBotMessage(ctx.channel.id, {
                    content: `✅ Status set to **${newStatusStr.toUpperCase()}** for **${durationStr}**. I will revert you to **${oldStatus.toUpperCase()}** afterwards.`
                });
                // 7. Set Timeout to Revert
                const timer = setTimeout(async () => {
                    revertTimers.delete(timer);
                    StatusSettings.updateSetting(oldStatus);
                    await deleteRevertData(); // Clean up the file
                    sendBotMessage(ctx.channel.id, {
                        content: `Time's up! Status reverted to **${oldStatus.toUpperCase()}**.`
                    });
                }, durationMs);
                revertTimers.add(timer);
            }
        }],
    stop() {
        for (const timer of revertTimers)
            clearTimeout(timer);
        revertTimers.clear();
    }
});
