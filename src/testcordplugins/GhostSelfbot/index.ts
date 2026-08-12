/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import type { CommandArgument, CommandContext } from "@vencord/discord-types";
import { findByPropsLazy } from "@webpack";

const logger = new Logger("GhostSelfbot");

const Native = VencordNative.pluginHelpers.GhostSelfbot as PluginNative<typeof import("./native")>;

const TokenStore = findByPropsLazy("getToken");

export function getCurrentDiscordToken(): string | null {
    try {
        return TokenStore?.getToken?.() ?? null;
    } catch (error) {
        logger.error("Failed to extract Discord token:", error);
        return null;
    }
}

const settings = definePluginSettings({
    autoLaunch: {
        type: OptionType.BOOLEAN,
        description: "Automatically launch Ghost.exe when Discord starts",
        default: false
    },
    launchOnEnable: {
        type: OptionType.BOOLEAN,
        description: "Launch Ghost immediately when the plugin is enabled",
        default: false
    },
    launchMode: {
        type: OptionType.SELECT,
        description: "Choose whether to launch Ghost.exe or the source code",
        default: "exe",
        options: [
            { label: "Ghost.exe (Compiled)", value: "exe", default: true },
            { label: "Source Code (Python)", value: "source" }
        ]
    },
    autoInstallRequirements: {
        type: OptionType.BOOLEAN,
        description: "Automatically install Python requirements after downloading the source code",
        default: true
    },
    autoFillToken: {
        type: OptionType.BOOLEAN,
        description: "Automatically fill your current Discord token into Ghost config",
        default: false
    },
    showTokenWarning: {
        type: OptionType.BOOLEAN,
        description: "Show a warning about token security before launching",
        default: true
    },
    pythonPath: {
        type: OptionType.STRING,
        description: "Path to Python executable (required for source code mode)",
        default: "python",
        placeholder: "python or C:\\Python311\\python.exe"
    },
    nitroWebhookUrl: {
        type: OptionType.STRING,
        description: "Discord webhook URL for Nitro sniper notifications",
        default: "",
        placeholder: "https://discord.com/api/webhooks/..."
    },
    privnoteWebhookUrl: {
        type: OptionType.STRING,
        description: "Discord webhook URL for Privnote sniper notifications",
        default: "",
        placeholder: "https://discord.com/api/webhooks/..."
    },
    autoSetupWebhooks: {
        type: OptionType.BOOLEAN,
        description: "Tell Ghost to automatically create webhook channels on first launch",
        default: false
    }
});

function getErrorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
}

async function ensureGhostInstalled(): Promise<boolean> {
    const result = await Native.installGhostPayloads(false);

    if (result.success) return true;

    showNotification({
        title: "Ghost Selfbot",
        body: result.error || "Failed to download Ghost from GitHub releases.",
        color: "#ED4245"
    });

    return false;
}

async function launchGhostExe(): Promise<void> {
    try {
        if (!await ensureGhostInstalled()) return;

        const token = settings.store.autoFillToken ? getCurrentDiscordToken() : null;
        await Native.launchGhostExe(
            settings.store.autoFillToken,
            token,
            settings.store.nitroWebhookUrl || "",
            settings.store.privnoteWebhookUrl || "",
            settings.store.autoSetupWebhooks
        );

        showNotification({
            title: "Ghost Selfbot",
            body: "Ghost.exe launched successfully",
            color: "#5865F2"
        });
    } catch (error: unknown) {
        logger.error("Failed to launch Ghost.exe:", error);
        showNotification({
            title: "Ghost Selfbot",
            body: getErrorMessage(error, "Failed to launch Ghost.exe"),
            color: "#ED4245"
        });
    }
}

async function launchGhostSource(): Promise<void> {
    const pythonPath = settings.store.pythonPath || "python";

    try {
        if (!await ensureGhostInstalled()) return;

        const token = settings.store.autoFillToken ? getCurrentDiscordToken() : null;
        await Native.launchGhostSource(
            settings.store.autoFillToken,
            settings.store.autoInstallRequirements,
            pythonPath,
            token,
            settings.store.nitroWebhookUrl || "",
            settings.store.privnoteWebhookUrl || "",
            settings.store.autoSetupWebhooks
        );

        showNotification({
            title: "Ghost Selfbot",
            body: "Ghost source code launched successfully",
            color: "#5865F2"
        });
    } catch (error: unknown) {
        logger.error("Failed to launch Ghost source:", error);
        showNotification({
            title: "Ghost Selfbot",
            body: getErrorMessage(error, "Failed to launch Ghost source. Check Python path."),
            color: "#ED4245"
        });
    }
}

export default definePlugin({
    name: "GhostSelfbot",
    description: "Launch Ghost Selfbot (exe or source code) with optional auto-token fill from your current Discord session",
    authors: [{ name: "irritably", id: 928787166916640838n }],
    tags: ["Utility", "Customisation"],
    enabledByDefault: false,
    settings,

    commands: [
        {
            name: "ghost",
            description: "Launch Ghost Selfbot",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: async (_args: CommandArgument[], ctx: CommandContext) => {
                if (settings.store.showTokenWarning) {
                    const token = getCurrentDiscordToken();
                    if (token && settings.store.autoFillToken) {
                        sendBotMessage(ctx.channel.id, {
                            content: "⚠️ **Warning:** Your Discord token will be written to Ghost config files. Never share these files with anyone!\n\n👻 Launching Ghost Selfbot..."
                        });
                    }
                }

                if (settings.store.launchMode === "exe") {
                    await launchGhostExe();
                } else {
                    await launchGhostSource();
                }
            }
        },
        {
            name: "ghost-download",
            description: "Download Ghost from the latest GitHub release",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: async (_args: CommandArgument[], ctx: CommandContext) => {
                sendBotMessage(ctx.channel.id, {
                    content: "📦 Downloading Ghost from GitHub releases..."
                });

                const result = await Native.installGhostPayloads(false);

                sendBotMessage(ctx.channel.id, {
                    content: result.success
                        ? result.downloaded
                            ? `✅ **Ghost ${result.version ?? "latest"} downloaded successfully.**`
                            : "✅ **Ghost is already installed.**"
                        : `❌ **Failed to download Ghost.** ${result.error ?? "Check the console for details."}`
                });
            }
        },
        {
            name: "ghost-install",
            description: "Install Ghost Selfbot Python requirements manually",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: async (_args: CommandArgument[], ctx: CommandContext) => {
                const pythonPath = settings.store.pythonPath || "python";

                sendBotMessage(ctx.channel.id, {
                    content: "📦 Installing Ghost Python requirements... This may take a moment."
                });

                const installResult = await Native.installGhostPayloads(false);
                if (!installResult.success) {
                    sendBotMessage(ctx.channel.id, {
                        content: `❌ **Failed to download Ghost.** ${installResult.error ?? "Check the console for details."}`
                    });
                    return;
                }

                if (await Native.installRequirements(pythonPath)) {
                    sendBotMessage(ctx.channel.id, {
                        content: "✅ **Requirements installed successfully!** You can now launch Ghost from source code."
                    });
                } else {
                    sendBotMessage(ctx.channel.id, {
                        content: "❌ **Failed to install requirements.** Check the console for error details."
                    });
                }
            }
        },
        {
            name: "ghost-check",
            description: "Check Ghost Selfbot setup (Python, requirements, files)",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: async (_args: CommandArgument[], ctx: CommandContext) => {
                const pythonPath = settings.store.pythonPath || "python";
                const status = await Native.checkGhostSetup(pythonPath);

                let statusMessage = "🔍 **Ghost Selfbot Setup Check:**\n\n";

                statusMessage += status.ghostExeFound
                    ? "✅ **Ghost.exe:** Found\n"
                    : "❌ **Ghost.exe:** Not found\n";

                statusMessage += status.ghostSourceFound
                    ? "✅ **Source Code:** Found\n"
                    : "❌ **Source Code:** Not found\n";

                statusMessage += status.pythonFound
                    ? `✅ **Python:** Found (${pythonPath})\n`
                    : `❌ **Python:** Not found at \`${pythonPath}\`\n`;

                statusMessage += status.requirementsFound
                    ? "✅ **requirements.txt:** Found\n"
                    : "❌ **requirements.txt:** Not found\n";

                if (!status.ghostExeFound || !status.ghostSourceFound)
                    statusMessage += "\nRun `/ghost-download` to download Ghost from the latest GitHub release.\n";

                sendBotMessage(ctx.channel.id, { content: statusMessage });
            }
        }
    ],

    start() {
        logger.log("Ghost Selfbot plugin loaded.");
        logger.log("Commands available: /ghost, /ghost-download, /ghost-install, /ghost-check");

        if (settings.store.launchOnEnable) {
            logger.log("Launching Ghost Selfbot immediately...");
            if (settings.store.launchMode === "exe") {
                void launchGhostExe();
            } else {
                void launchGhostSource();
            }
        }

        if (settings.store.autoLaunch) {
            setTimeout(() => {
                logger.log("Auto-launching Ghost Selfbot on startup...");
                if (settings.store.launchMode === "exe") {
                    void launchGhostExe();
                } else {
                    void launchGhostSource();
                }
            }, 5000);
        }
    },

    stop() {
        logger.log("Ghost Selfbot plugin stopped.");
    }
});
