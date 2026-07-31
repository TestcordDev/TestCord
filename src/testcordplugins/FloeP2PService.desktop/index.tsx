/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import type { NavContextMenuPatchCallback } from "@api/ContextMenu";
import ErrorBoundary from "@components/ErrorBoundary";
import { Flex } from "@components/Flex";
import { HeadingSecondary } from "@components/Heading";
import { CloudDownloadIcon, CloudIcon, CloudUploadIcon, FolderIcon, UpdaterIcon } from "@components/Icons";
import { Paragraph } from "@components/Paragraph";
import { insertTextIntoChatInputBox } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { Margins } from "@utils/margins";
import definePlugin, { type PluginNative, ReporterTestable } from "@utils/types";
import type { CommandArgument, CommandContext, RenderModalProps } from "@vencord/discord-types";
import { Button, MaskedLink, Menu, Modal, openModal, showToast, TextInput, Toasts, useState } from "@webpack/common";

import type { FloeCommandResult, FloeSession, NativeResult } from "./native";

const Native = VencordNative?.pluginHelpers?.FloeP2PService as PluginNative<typeof import("./native")> | undefined;
const logger = new Logger("FloeP2PService");

type FloeNative = NonNullable<typeof Native>;
type FloeAction<T> = (native: FloeNative) => Promise<NativeResult<T>>;

function FloeP2PSettingsAbout() {
    return (
        <>
            <HeadingSecondary>About Floe P2P Service</HeadingSecondary>
            <Paragraph>
                Floe was created by <MaskedLink href="https://github.com/jannskiee">https://github.com/jannskiee</MaskedLink>.
            </Paragraph>
            <Paragraph className={Margins.top8}>
                This Illegalcord plugin was created by the creator of Illegalcord.
            </Paragraph>
            <Paragraph className={Margins.top8}>
                The plugin also includes the /floe command. Before sending or receiving files, use Install Floe CLI once. To open the Floe menu from chat, right-click the + button.
            </Paragraph>
        </>
    );
}

const SafeFloeP2PSettingsAbout = ErrorBoundary.wrap(FloeP2PSettingsAbout, { noop: true });

async function runNativeAction<T>(action: FloeAction<T>, fallbackError: string): Promise<T | null> {
    const native = Native;
    if (!native) {
        showToast("Floe native helper is not available. Restart Discord.", Toasts.Type.FAILURE);
        return null;
    }

    try {
        const result = await action(native);
        if (result.cancelled) {
            logger.info(formatNativeActionLog("Floe native action cancelled.", fallbackError, result));
            return null;
        }

        if (!result.success || !result.data) {
            logger.warn(formatNativeActionLog("Floe native action failed.", fallbackError, result));
            showToast(result.error ?? fallbackError, Toasts.Type.FAILURE);
            return null;
        }

        logger.info(formatNativeActionLog("Floe native action succeeded.", fallbackError, result));
        return result.data;
    } catch (error) {
        logger.error(fallbackError, error);
        showToast(fallbackError, Toasts.Type.FAILURE);
        return null;
    }
}

function formatNativeActionLog<T>(message: string, fallbackError: string, result: NativeResult<T>): string {
    return `${message}\n${stringifyLog({ fallbackError, result })}`;
}

function stringifyLog(value: unknown): string {
    try {
        return JSON.stringify(value, null, 2) ?? String(value);
    } catch (error) {
        return error instanceof Error ? error.message : String(value);
    }
}

function getShareText(session: FloeSession): string | null {
    if (session.link && session.code) return `Floe P2P transfer: ${session.link}\nCode: ${session.code}`;
    if (session.link) return `Floe P2P transfer: ${session.link}`;
    if (session.code) return `Floe P2P code: ${session.code}`;

    return null;
}

function publishSendSession(session: FloeSession): void {
    const shareText = getShareText(session);
    if (shareText) {
        insertTextIntoChatInputBox(shareText + " ");
        showToast("Floe link inserted in chat.", Toasts.Type.SUCCESS);
        return;
    }

    showToast("Floe started, but no code or link was printed yet.", Toasts.Type.MESSAGE);
}

async function sendFiles(): Promise<void> {
    const session = await runNativeAction(native => native.startSendFiles(), "Could not start Floe send.");
    if (session) publishSendSession(session);
}

async function sendFolder(): Promise<void> {
    const session = await runNativeAction(native => native.startSendFolder(), "Could not start Floe send.");
    if (session) publishSendSession(session);
}

async function installFloe(): Promise<void> {
    const result = await runNativeAction(native => native.installFloe(), "Could not install Floe.");
    if (!result) return;

    showToast("Floe install finished.", Toasts.Type.SUCCESS);
}

async function updateFloe(): Promise<void> {
    const result = await runNativeAction(native => native.updateFloe(), "Could not update Floe.");
    if (!result) return;

    showToast("Floe update finished.", Toasts.Type.SUCCESS);
}

async function cancelLatestSession(): Promise<void> {
    const session = await runNativeAction(native => native.cancelLatestSession(), "Could not cancel the Floe session.");
    if (!session) return;

    showToast("Floe session cancelled.", Toasts.Type.SUCCESS);
}

function formatSession(session: FloeSession): string {
    const output = session.output.trim();
    const lines = [
        `Floe ${session.kind} session is ${session.status}.`,
        session.link ? `Link: ${session.link}` : "",
        session.code ? `Code: ${session.code}` : "",
        session.outputDir ? `Saved to: ${session.outputDir}` : "",
        session.error ? `Error: ${session.error}` : "",
        output ? `Output:\n\`\`\`\n${output.slice(-1500)}\n\`\`\`` : ""
    ].filter(Boolean);

    return lines.join("\n");
}

function formatCommandResult(title: string, result: NativeResult<FloeCommandResult>): string {
    const output = result.data?.output.trim();
    if (result.success) return [`**${title}**`, output || "Done."].join("\n");

    return [`**${title}**`, result.error ?? "Command failed.", output ? `\`\`\`\n${output.slice(-1500)}\n\`\`\`` : ""].filter(Boolean).join("\n");
}

async function sendReceiveStartedMessage(ctx: CommandContext, locator: string): Promise<void> {
    const session = await runNativeAction(native => native.startReceive(locator, ""), "Could not start Floe receive.");
    if (!session) return;

    sendBotMessage(ctx.channel.id, { content: formatSession(session) });
}

function getSubCommand(args: CommandArgument[]): CommandArgument | null {
    return args[0] ?? null;
}

function getSubOption(subCommand: CommandArgument, name: string): string {
    return findOption<string>(subCommand.options, name, "");
}

function ReceiveModal({ modalProps }: { modalProps: RenderModalProps; }) {
    const [locator, setLocator] = useState("");
    const [outputDir, setOutputDir] = useState("");
    const [busy, setBusy] = useState(false);

    async function chooseFolder(): Promise<void> {
        const selected = await runNativeAction(native => native.chooseReceiveDirectory(), "Could not choose the download folder.");
        if (selected) setOutputDir(selected);
    }

    async function receive(): Promise<void> {
        if (!locator.trim()) {
            showToast("Enter a Floe code or link.", Toasts.Type.FAILURE);
            return;
        }

        setBusy(true);
        try {
            const session = await runNativeAction(native => native.startReceive(locator, outputDir), "Could not start Floe receive.");
            if (!session) return;

            showToast("Floe receive session started.", Toasts.Type.SUCCESS);
            modalProps.onClose();
        } finally {
            setBusy(false);
        }
    }

    return (
        <Modal
            {...modalProps}
            title="Floe Receive"
            actions={[
                {
                    text: "Cancel",
                    variant: "secondary",
                    onClick: modalProps.onClose
                },
                {
                    text: "Receive",
                    variant: "primary",
                    disabled: busy || !locator.trim(),
                    onClick: () => void receive()
                }
            ]}
        >
            <section className={Margins.bottom16}>
                <HeadingSecondary>Code or link</HeadingSecondary>
                <TextInput
                    value={locator}
                    onChange={setLocator}
                    placeholder="olive-tiger-castle or https://floe.one?room=..."
                />
            </section>

            <section className={Margins.bottom16}>
                <HeadingSecondary>Download folder</HeadingSecondary>
                <Paragraph>{outputDir || "Downloads will be used."}</Paragraph>
                <Button color={Button.Colors.PRIMARY} onClick={() => void chooseFolder()} disabled={busy}>
                    Choose folder
                </Button>
            </section>
        </Modal>
    );
}

const SafeReceiveModal = ErrorBoundary.wrap(ReceiveModal, { noop: true });

function openReceiveModal(): void {
    openModal(modalProps => <SafeReceiveModal modalProps={modalProps} />);
}

const channelAttachMenuPatch: NavContextMenuPatchCallback = children => {
    if (children.some(child => child?.props?.id === "floe-p2p-service")) return;

    children.splice(1, 0,
        <Menu.MenuItem
            id="floe-p2p-service"
            key="floe-p2p-service"
            label={(
                <Flex alignItems="center" gap="8px">
                    <CloudIcon height={18} width={18} />
                    <span>Floe P2P Service</span>
                </Flex>
            )}
        >
            <Menu.MenuItem
                id="floe-p2p-send-files"
                key="floe-p2p-send-files"
                label="Send files"
                icon={CloudUploadIcon}
                action={() => void sendFiles()}
            />
            <Menu.MenuItem
                id="floe-p2p-send-folder"
                key="floe-p2p-send-folder"
                label="Send folder"
                icon={FolderIcon}
                action={() => void sendFolder()}
            />
            <Menu.MenuItem
                id="floe-p2p-receive"
                key="floe-p2p-receive"
                label="Receive files"
                icon={CloudDownloadIcon}
                action={openReceiveModal}
            />
            <Menu.MenuSeparator />
            <Menu.MenuItem
                id="floe-p2p-cancel"
                key="floe-p2p-cancel"
                label="Cancel current session"
                color="danger"
                action={() => void cancelLatestSession()}
            />
            <Menu.MenuSeparator />
            <Menu.MenuItem
                id="floe-p2p-install"
                key="floe-p2p-install"
                label="Install Floe CLI"
                icon={CloudDownloadIcon}
                action={() => void installFloe()}
            />
            <Menu.MenuItem
                id="floe-p2p-update"
                key="floe-p2p-update"
                label="Update Floe CLI"
                icon={UpdaterIcon}
                action={() => void updateFloe()}
            />
        </Menu.MenuItem>
    );
};

export default definePlugin({
    name: "FloeP2PService",
    description: "Shares files and folders through Floe P2P CLI sessions.",
    tags: ["Chat", "Utility", "Privacy", "Commands"],
    authors: [{ name: "irritably", id: 928787166916640838n }],
    dependencies: ["CommandsAPI"],
    reporterTestable: ReporterTestable.None,
    settingsAboutComponent: SafeFloeP2PSettingsAbout,
    contextMenus: {
        "channel-attach": channelAttachMenuPatch
    },
    commands: [
        {
            name: "floe",
            description: "Manage Floe P2P file transfer sessions.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "receive",
                    description: "Receive files with a Floe code or link.",
                    type: ApplicationCommandOptionType.SUB_COMMAND,
                    options: [
                        {
                            name: "code",
                            description: "Floe code or browser link.",
                            type: ApplicationCommandOptionType.STRING,
                            required: true
                        }
                    ]
                },
                {
                    name: "status",
                    description: "Show the latest Floe session status.",
                    type: ApplicationCommandOptionType.SUB_COMMAND
                },
                {
                    name: "cancel",
                    description: "Cancel the latest Floe session.",
                    type: ApplicationCommandOptionType.SUB_COMMAND
                },
                {
                    name: "install",
                    description: "Install the Floe CLI.",
                    type: ApplicationCommandOptionType.SUB_COMMAND
                },
                {
                    name: "update",
                    description: "Update the Floe CLI.",
                    type: ApplicationCommandOptionType.SUB_COMMAND
                },
                {
                    name: "check",
                    description: "Check for Floe CLI updates.",
                    type: ApplicationCommandOptionType.SUB_COMMAND
                },
                {
                    name: "version",
                    description: "Show the installed Floe CLI version.",
                    type: ApplicationCommandOptionType.SUB_COMMAND
                }
            ],
            async execute(args, ctx) {
                if (!Native) {
                    sendBotMessage(ctx.channel.id, { content: "Floe native helper is not available. Restart Discord." });
                    return;
                }

                const subCommand = getSubCommand(args);
                if (!subCommand) {
                    sendBotMessage(ctx.channel.id, { content: "Choose a Floe command." });
                    return;
                }

                switch (subCommand.name) {
                    case "receive": {
                        const locator = getSubOption(subCommand, "code");
                        await sendReceiveStartedMessage(ctx, locator);
                        break;
                    }
                    case "status": {
                        const result = await Native.getLatestSession();
                        sendBotMessage(ctx.channel.id, { content: result.success && result.data ? formatSession(result.data) : result.error ?? "No Floe session has been started." });
                        break;
                    }
                    case "cancel": {
                        const result = await Native.cancelLatestSession();
                        sendBotMessage(ctx.channel.id, { content: result.success && result.data ? "Floe session cancelled." : result.error ?? "No Floe session is running." });
                        break;
                    }
                    case "install": {
                        const result = await Native.installFloe();
                        sendBotMessage(ctx.channel.id, { content: formatCommandResult("Floe install", result) });
                        break;
                    }
                    case "update": {
                        const result = await Native.updateFloe();
                        sendBotMessage(ctx.channel.id, { content: formatCommandResult("Floe update", result) });
                        break;
                    }
                    case "check": {
                        const result = await Native.checkFloeUpdate();
                        sendBotMessage(ctx.channel.id, { content: formatCommandResult("Floe update check", result) });
                        break;
                    }
                    case "version": {
                        const result = await Native.getFloeVersion();
                        sendBotMessage(ctx.channel.id, { content: formatCommandResult("Floe version", result) });
                        break;
                    }
                }
            }
        }
    ],
    stop() {
        void Native?.cancelAllSessions();
    }
});
