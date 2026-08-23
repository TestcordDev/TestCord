/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 SirPhantom89
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { UserAreaButton, type UserAreaRenderProps } from "@api/UserArea";
import ErrorBoundary from "@components/ErrorBoundary";
import { Heading } from "@components/Heading";
import { HeadphonesIcon } from "@components/Icons";
import { Paragraph } from "@components/Paragraph";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType, PluginNative, ReporterTestable } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Button, FluxDispatcher, React, Select, showToast, Toasts } from "@webpack/common";

import type { LoaderStatus, StereoSource } from "./native";

const Native = VencordNative.pluginHelpers.StereoLoader as PluginNative<typeof import("./native")>;

const IPC_EVENT = {} as Parameters<typeof import("./native").getStatus>[0];

const SOURCE_LABELS: Record<StereoSource, string> = {
    voicePlayground: "Voice Playground (Windows only)",
    discordAudioCollective: "Discord Audio Collective"
};

// Input profile control. Discord's modern voice stack bundles noise
// suppression, echo cancellation, AGC and Krisp into input profiles:
//   STUDIO          - all processing off, full quality stereo mic
//   VOICE_ISOLATION - normal Discord voice processing (the default)
// Switching the profile is the ONLY reliable way to toggle these; the
// individual AUDIO_SET_* setters are ignored by the store in this build.
const AudioActions = findByPropsLazy("setActiveInputProfile", "setNoiseSuppression");
const VoiceState = findByPropsLazy("getActiveInputProfile", "getNoiseSuppression");

const STEREO_PROFILE = "STUDIO";
const NORMAL_PROFILE = "VOICE_ISOLATION";

let settingsRef: ReturnType<typeof definePluginSettings> | null = null;

function currentInputProfile(): string {
    try {
        return String(VoiceState.getActiveInputProfile() ?? NORMAL_PROFILE);
    } catch {
        // Derived state can throw if a previous profile write was corrupted;
        // fall back to the last saved value.
        return readSavedProfile();
    }
}

function readSavedProfile(): string {
    try {
        const raw = JSON.parse(settingsRef?.store.savedAudioState ?? "") as { inputProfile?: string; };
        return raw?.inputProfile ?? NORMAL_PROFILE;
    } catch {
        return NORMAL_PROFILE;
    }
}

function applyInputProfile(profile: string): void {
    try {
        AudioActions.setActiveInputProfile(profile);
    } catch {
        // The action creator validates via derived state which can itself be
        // corrupted; the raw reducer path repairs it.
        FluxDispatcher.dispatch({ type: "AUDIO_SET_ACTIVE_INPUT_PROFILE", inputProfile: profile });
    }
}

/** Stereo mode on = switch to the STUDIO input profile (all processing off). */
export function setStereoMode(on: boolean): void {
    const settings = settingsRef!;
    if (on) {
        const current = currentInputProfile();
        if (current !== STEREO_PROFILE) {
            settings.store.savedAudioState = JSON.stringify({ inputProfile: current });
        }
        applyInputProfile(STEREO_PROFILE);
    } else {
        applyInputProfile(readSavedProfile());
    }
    settings.store.stereoMode = on;
}

/** Stereo mode on = kill everything that downmixes or crushes the mic signal. */
export function toggleStereoMode(): boolean {
    const on = !settingsRef!.store.stereoMode;
    setStereoMode(on);
    return on;
}

function StereoModeUserAreaButton({ iconForeground, hideTooltips, nameplate }: UserAreaRenderProps) {
    const { stereoMode } = settings.use(["stereoMode"]);

    return (
        <UserAreaButton
            className="button__201d5 wrapper__201d5"
            tooltipText={hideTooltips ? void 0 : stereoMode ? "Disable Stereo Mode" : "Enable Stereo Mode"}
            aria-label="Stereo Mode"
            icon={<HeadphonesIcon className={iconForeground} />}
            role="switch"
            aria-checked={stereoMode}
            redGlow={!stereoMode}
            plated={nameplate != null}
            onClick={() => {
                const on = toggleStereoMode();
                showToast(on
                    ? "Stereo Mode ON - suppression off, stereo mic live"
                    : "Stereo Mode OFF - your normal voice settings are restored", Toasts.Type.SUCCESS);
            }}
        />
    );
}

function InfoLine({ label, value }: { label: string; value: string; }) {
    return (
        <div style={{ display: "flex", gap: 8, fontSize: 14 }}>
            <span style={{ opacity: 0.7, minWidth: 160 }}>{label}</span>
            <code style={{ wordBreak: "break-all" }}>{value || "--"}</code>
        </div>
    );
}

function LoaderPanel() {
    const [status, setStatus] = React.useState<LoaderStatus | null>(null);
    const [logLines, setLogLines] = React.useState<string[]>([]);
    const [source, setSource] = React.useState<StereoSource>(process.platform === "win32" ? "voicePlayground" : "discordAudioCollective");
    const [busy, setBusy] = React.useState(false);
    const [note, setNote] = React.useState("Ready.");

    async function refresh(): Promise<void> {
        try {
            setStatus(await Native.getStatus());
        } catch (error) {
            setNote(String(error));
        }
        try {
            setLogLines(await Native.readLogs());
        } catch { /* keep old lines */ }
    }

    React.useEffect(() => {
        void refresh();
        // Poll while the panel is open so the redirect counters and log
        // update live (e.g. right after you join a voice channel).
        const interval = setInterval(() => {
            void refresh();
        }, 3000);
        return () => clearInterval(interval);
    }, []);

    async function run(action: () => Promise<unknown>, successMessage: string): Promise<void> {
        setBusy(true);
        try {
            await action();
            setNote(successMessage);
            showToast(successMessage, Toasts.Type.SUCCESS);
            await refresh();
        } catch (error) {
            const message = String(error);
            setNote(message);
            showToast(message, Toasts.Type.FAILURE);
        } finally {
            setBusy(false);
        }
    }

    async function download(): Promise<void> {
        await run(
            () => Native.downloadPayload(source),
            "Patched voice module cached. Restart Discord (or rejoin voice after a restart) for it to load."
        );
        settings.store.redirectEnabled = true;
    }

    if (!status) {
        return <Paragraph>Loading StereoLoader status...</Paragraph>;
    }

    const payloadState = !status.payloadNodeExists
        ? "Not downloaded"
        : status.compatible
            ? `Ready (${status.payloadMeta!.source}${status.payloadIndexExists ? " + index.js" : ""})`
            : "Incompatible - redownload required";

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
                <Heading tag="h3">How it works</Heading>
                <Paragraph>
                    This downloads a stereo voice module and makes Discord load it instead of the stock one.
                    Your actual Discord files are never touched, so updates can't undo it and you won't need
                    to repatch. Just enable it and restart Discord.
                </Paragraph>
                {status.lastError && (
                    <Paragraph style={{ color: "#f04747" }}>{status.lastError}</Paragraph>
                )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <InfoLine label="Loader hook" value={status.hookInstalled ? "Installed" : "NOT INSTALLED"} />
                <InfoLine label="Client build" value={status.buildLabel} />
                <InfoLine label="Electron / ABI" value={`${status.electronVersion} / ${status.electronAbi} (${status.arch})`} />
                <InfoLine label="Stock voice module" value={status.stockNodeExists ? status.stockVoiceDir : "not found"} />
                <InfoLine label="Cached payload" value={payloadState} />
                <InfoLine label="Redirect enabled" value={status.enabledFlag ? "Yes" : "No"} />
                <InfoLine label="Redirects this session" value={String(status.redirectCount)} />
                <InfoLine label="Voice engine redirects" value={status.rendererRedirectCount > 0
                    ? `${status.rendererRedirectCount} (last ${new Date(status.rendererRedirectTime).toLocaleTimeString()})`
                    : "0"} />
            </div>

            {!status.stockNodeExists && (
                <Paragraph style={{ color: "#faa61a" }}>
                    Could not find discord_voice.node for this install. Join a voice channel once so Discord extracts
                    its modules, then reopen this page.
                </Paragraph>
            )}

            {status.rendererRedirectCount === 0 && status.redirectCount === 0
                && status.payloadNodeExists && status.compatible && (
                <Paragraph style={{ color: "#faa61a" }}>
                    The payload has not been loaded yet. It applies the next time Discord loads its voice module -
                    fully restart Discord once after downloading.
                </Paragraph>
            )}
            {status.rendererRedirectCount > 0 && (
                <Paragraph style={{ color: "#43b581" }}>
                    The patched voice engine was loaded this session - you are running stereo.
                </Paragraph>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span>Payload source</span>
                <Select
                    options={Object.entries(SOURCE_LABELS).map(([value, label]) => ({ label, value }))}
                    isSelected={(value: string) => value === source}
                    select={(value: StereoSource) => setSource(value)}
                    serialize={(value: string) => value}
                />
            </div>

            <div style={{ display: "flex", gap: 8 }}>
                <Button color={Button.Colors.GREEN} size={Button.Sizes.SMALL} disabled={busy} onClick={() => void download()}>
                    Download & enable
                </Button>
                <Button
                    color={Button.Colors.PRIMARY}
                    size={Button.Sizes.SMALL}
                    disabled={busy || !status.payloadNodeExists}
                    onClick={() => {
                        settings.store.redirectEnabled = !status.enabledFlag;
                    }}
                >
                    {status.enabledFlag ? "Disable redirect" : "Enable redirect"}
                </Button>
                <Button
                    color={Button.Colors.GREEN}
                    size={Button.Sizes.SMALL}
                    disabled={busy}
                    onClick={() => void Native.relaunchApp()}
                >
                    Restart Discord
                </Button>
                <Button
                    color={Button.Colors.RED}
                    size={Button.Sizes.SMALL}
                    disabled={busy || !status.payloadNodeExists}
                    onClick={() => void run(() => Native.clearPayload(), "Payload cache cleared.")}
                >
                    Clear cache
                </Button>
            </div>

            <Paragraph>{busy ? "Working..." : note}</Paragraph>

            <div>
                <Heading tag="h3">Loader log</Heading>
                <LogView lines={logLines} />
            </div>
        </div>
    );
}

function LogView({ lines }: { lines: string[]; }) {
    if (!lines.length) {
        return <Paragraph>No loader activity yet.</Paragraph>;
    }

    return (
        <code style={{
            display: "block",
            fontSize: 12,
            lineHeight: "1.5em",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all"
        }}>
            {lines.slice(-12).join("\n")}
        </code>
    );
}

const settings = definePluginSettings({
    redirectEnabled: {
        type: OptionType.BOOLEAN,
        description: "Use the stereo voice module instead of the stock one. Needs a Discord restart to apply.",
        default: false,
        onChange: (newValue: boolean) => {
            void Native.setEnabled(newValue);
        }
    },
    stereoMode: {
        type: OptionType.BOOLEAN,
        description: "Stereo Mode",
        default: false,
        hidden: true
    },
    savedAudioState: {
        type: OptionType.STRING,
        description: "Your input profile before Stereo Mode was turned on.",
        default: ""
    },
    info: {
        type: OptionType.COMPONENT,
        component: ErrorBoundary.wrap(LoaderPanel, { noop: true })
    }
});

settingsRef = settings;

export default definePlugin({
    name: "StereoLoader",
    description: "Stereo mic input without repatching after every Discord update.",
    tags: ["Utility", "Voice"],
    authors: [TestcordDevs.sirphantom89],
    reporterTestable: ReporterTestable.None,
    settings,

    userAreaButton: {
        icon: (props: { className?: string; }) => <HeadphonesIcon {...props} />,
        render: StereoModeUserAreaButton
    },

    start() {
        // Re-assert the redirect gate so it exactly mirrors this plugin's
        // enabled + user toggle state. Disabling the plugin removes the flag
        // in stop(), so a stale flag can never outlive the plugin.
        void Native.setEnabled(settings.store.redirectEnabled === true).catch(() => void 0);

        // Re-assert Stereo Mode after restarts (Discord may reset voice
        // settings on its own boot sequence).
        if (settings.store.stereoMode) {
            try {
                setStereoMode(true);
            } catch { // webpack modules may not be ready yet; retry shortly
                setTimeout(() => {
                    try {
                        setStereoMode(true);
                    } catch { /* give up silently */ }
                }, 10_000);
            }
        }

        void Native.getStatus().then(status => {
            if (!status.hookInstalled) return;

            if (!status.payloadNodeExists) {
                showNotification({
                    title: "StereoLoader",
                    body: "No stereo payload is cached yet. Open Settings > StereoLoader and click Download & enable.",
                    permanent: true
                });
            } else if (!status.compatible) {
                showNotification({
                    title: "StereoLoader",
                    body: "Your cached stereo payload does not match this Discord/Electron build. Redownload it from Settings > StereoLoader.",
                    permanent: true
                });
            }
        }, () => void 0);
    },

    stop() {
        // Plugin off = redirect off. The preload hook only acts while this
        // flag file exists.
        void Native.setEnabled(false).catch(() => void 0);

        // Don't leave the user with suppression disabled after disabling
        // the plugin mid-stereo.
        if (settings.store.stereoMode) {
            setStereoMode(false);
        }
    }
});
