/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { Toasts } from "@webpack/common";

import { openBadgeSpooferModal } from "./components/BadgeSpooferModal";
import { badgeSpooferEngine } from "./engine";
import { applyHouse, type HouseId,HOUSES } from "./hypesquad";
import { settings } from "./settings";

export default definePlugin({
    name: "BadgeSpoofer",
    description: "Discord profile badge spoofer: Game Variety (Games Played), Game Time (Playtime), & Streaming (Hours Streamed) via /api/v9/science. Also switch your real HypeSquad house or leave HypeSquad.",
    authors: [TestcordDevs.sirphantom89],
    tags: ["Customisation", "Appearance", "Utility", "Commands"],
    settings,

    toolboxActions: {
        "Open Badge Spoofer": () => openBadgeSpooferModal()
    },

    async start() {
        await badgeSpooferEngine.init();
    },

    stop() {
        badgeSpooferEngine.stopSpoofing();
    },

    commands: [
        {
            name: "badgespoof",
            description: "Start spoofing playtime, streaming hours, and games-played for Discord badges",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "hours",
                    description: "Hours of playtime per game (e.g. 1, 10, 100)",
                    type: ApplicationCommandOptionType.NUMBER,
                    required: false,
                },
                {
                    name: "stream_hours",
                    description: "Hours of streaming per game (e.g. 1, 10, 100)",
                    type: ApplicationCommandOptionType.NUMBER,
                    required: false,
                },
                {
                    name: "games",
                    description: "Number of games to spoof (leave blank for all available)",
                    type: ApplicationCommandOptionType.INTEGER,
                    required: false,
                },
                {
                    name: "fingerprint",
                    description: "Optional custom executable_fingerprint for Games-Played badge",
                    type: ApplicationCommandOptionType.STRING,
                    required: false,
                }
            ],
            execute: async (options, { channel }) => {
                if (badgeSpooferEngine.getIsRunning()) {
                    sendBotMessage(channel.id, {
                        content: "Badge Spoofer is already running. Use `/badgespoof-stop` to cancel."
                    });
                    return;
                }

                const hours = findOption(options, "hours", settings.store.defaultHours || 1);
                const streamHours = findOption(options, "stream_hours", 1);
                const games = findOption(options, "games", undefined);
                const fingerprint = findOption(options, "fingerprint", settings.store.customFingerprint || undefined);

                sendBotMessage(channel.id, {
                    content: `Starting Badge Spoofer: **${hours}h** play, **${streamHours}h** stream per game. Progress shows in toasts, or use \`/badgespoof-dashboard\`.`
                });

                Toasts.show({
                    id: Toasts.genId(),
                    message: `Badge Spoofer launched (${hours}h play, ${streamHours}h stream)...`,
                    type: Toasts.Type.MESSAGE
                });

                badgeSpooferEngine.startSpoofing({
                    hours,
                    streamHours,
                    count: games || 99999,
                    batchSize: settings.store.batchSize || 50,
                    batchDelay: settings.store.batchDelay || 300,
                    fingerprint,
                    onProgress: progress => {
                        if (!progress.isRunning) {
                            Toasts.show({
                                id: Toasts.genId(),
                                message: `Badge Spoofer Finished: ${progress.sent} games claimed!`,
                                type: Toasts.Type.SUCCESS
                            });
                        }
                    }
                });
            }
        },
        {
            name: "hypesquad",
            description: "Switch your real HypeSquad house or remove your badge",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "house",
                    description: "Which HypeSquad house to join",
                    type: ApplicationCommandOptionType.INTEGER,
                    required: true,
                    choices: [
                        { label: "Remove Badge (Leave)", value: "0", name: "Remove Badge (Leave)" },
                        ...HOUSES.map(h => ({ label: `House ${h.name}`, value: String(h.id), name: `House ${h.name}` }))
                    ]
                }
            ],
            execute: async (args, { channel }) => {
                const houseId = parseInt(args[0].value, 10) as HouseId;
                const ok = await applyHouse(houseId);
                if (ok) {
                    sendBotMessage(channel.id, {
                        content: `HypeSquad updated${houseId === 0 ? ", badge removed" : ""}. Reload Discord (Ctrl+R) to see the change.`
                    });
                }
            }
        },
        {
            name: "badgespoof-dashboard",
            description: "Open the interactive Badge Spoofer dashboard modal",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: () => {
                openBadgeSpooferModal();
            }
        },
        {
            name: "badgespoof-status",
            description: "View current Discord Badge Spoofer stats and claimed history",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: async (_, { channel }) => {
                const stats = await badgeSpooferEngine.loadStats();
                const games = await badgeSpooferEngine.loadGames();
                const running = badgeSpooferEngine.getIsRunning();

                sendBotMessage(channel.id, {
                    content: [
                        "**Discord Badge Spoofer Status**",
                        `• Running: ${running ? "Yes (Active)" : "Idle"}`,
                        `• Games: \`${stats.totalGamesClaimed.toLocaleString()}\``,
                        `• Playtime: \`${Math.round(stats.totalHoursClaimed).toLocaleString()} hours\``,
                        `• Streamed: \`${Math.round(stats.totalStreamHoursClaimed || 0).toLocaleString()} hours\``,
                        `• Available in Database: \`${games.length.toLocaleString()} games\``,
                        `• Executable Fingerprint: \`${stats.fingerprint ? "Configured" : "None"}\``,
                        "",
                        "Badges update on Discord's backend within 1-2 days."
                    ].join("\n")
                });
            }
        },
        {
            name: "badgespoof-stop",
            description: "Stop the currently running Badge Spoofer task",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: (_, { channel }) => {
                if (!badgeSpooferEngine.getIsRunning()) {
                    sendBotMessage(channel.id, { content: "Badge Spoofer is not currently running." });
                    return;
                }

                    badgeSpooferEngine.stopSpoofing();
                sendBotMessage(channel.id, { content: "Badge Spoofer stopped." });
            }
        }
    ]
});
