/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import "./style.css";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { Heading } from "@components/Heading";
import { DeleteIcon, HeadphonesIcon, NoEntrySignIcon, WarningIcon } from "@components/Icons";
import { Paragraph } from "@components/Paragraph";
import SettingsPlugin from "@plugins/_core/settings";
import { classes, removeFromArray } from "@utils/misc";
import definePlugin from "@utils/types";
import { Alerts, Button, React, Select, SettingsRouter, showToast, TextInput, Toasts } from "@webpack/common";
const Native = VencordNative.pluginHelpers.StereoInstaller;
const SETTINGS_ENTRY_KEY = "illegalcord_stereo_installer";
const DISCORD_AUDIO_COLLECTIVE_SOURCE_URL = "https://github.com/ProdHallow/Discord-Stereo-Windows-MacOS-Linux";
const VOICE_PLAYGROUND_SOURCE_URL = "https://codeberg.org/UnpackedX/Discord-Experimental-Subsystem";
const VOICE_PLAYGROUND_TUTORIAL_URL = "https://www.youtube.com/watch?v=zSIIganbZxg";
const METHOD_LABELS = {
    method1: "Discord Audio Collective Method",
    method2: "Voice Playground Method"
};
const METHOD_LAST_PATCH_KEYS = {
    method1: "discordAudioCollective",
    method2: "voicePlayground"
};
const METHOD_OPTIONS = [
    { label: METHOD_LABELS.method1, value: "method1" },
    { label: METHOD_LABELS.method2, value: "method2" }
];
const METHOD_2_QUALITY_OPTIONS = [
    { label: "128", value: "128" },
    { label: "384", value: "384" },
    { label: "512", value: "512" }
];
let lastRepatchNotificationKey = "";
let nextLogId = 0;
function appendLogs(existingLogs, newLogs) {
    return [...existingLogs, ...(newLogs ?? []).map(line => ({ id: nextLogId++, line }))];
}
function notifyRepatchIfNeeded(info) {
    if (!info.repatchWarning)
        return;
    const key = `${info.discordRoot}:${info.clientLabel}:${info.repatchWarning}`;
    if (lastRepatchNotificationKey === key)
        return;
    lastRepatchNotificationKey = key;
    showNotification({
        title: "StereoInstaller",
        body: info.repatchWarning,
        permanent: true,
        onClick: () => SettingsRouter.openUserSettings(`${SETTINGS_ENTRY_KEY}_panel`)
    });
}
function StereoWarning() {
    return (<div className="vc-stereo-installer-warning">
            <Heading tag="h3">StereoInstaller warning</Heading>
            <Paragraph>
                This plugin replaces local Discord voice files to enable higher audio quality. It keeps a backup so you can restore the original files when needed.
            </Paragraph>
            <Paragraph>
                Keep one method installed at a time. Revert to the saved backup before switching methods or after a Discord update if voice stops working.
            </Paragraph>
        </div>);
}
function InfoLine({ label, value }) {
    return (<div className="vc-stereo-installer-info-line">
            <span>{label}</span>
            <code>{value || "--"}</code>
        </div>);
}
function InstallationStatus({ info }) {
    const method = info.installedMethod ? METHOD_LABELS[info.installedMethod === "discordAudioCollective" ? "method1" : "method2"] : "StereoInstaller";
    if (info.installStatus === "installed") {
        return (<div className={classes("vc-stereo-installer-install-status", "vc-stereo-installer-install-status-installed")}>
                <HeadphonesIcon width={28} height={28}/>
                <div>
                    <Heading tag="h3">Stereo is installed</Heading>
                    <Paragraph>{method} is active for {info.clientLabel}.</Paragraph>
                </div>
            </div>);
    }
    if (info.installStatus === "needsReinstall") {
        return (<div className={classes("vc-stereo-installer-install-status", "vc-stereo-installer-install-status-needs-reinstall")}>
                <WarningIcon width={28} height={28}/>
                <div>
                    <Heading tag="h3">Stereo must be installed again</Heading>
                    <Paragraph>Discord was updated after {method} was installed. Patch Discord voice again.</Paragraph>
                </div>
            </div>);
    }
    return (<div className={classes("vc-stereo-installer-install-status", "vc-stereo-installer-install-status-not-installed")}>
            <NoEntrySignIcon width={28} height={28}/>
            <div>
                <Heading tag="h3">Stereo is not installed</Heading>
                <Paragraph>Choose a method and patch Discord voice to enable stereo audio.</Paragraph>
            </div>
        </div>);
}
function LogLine({ entry }) {
    const match = /^\[([^\]]+)]\s*(.*)$/.exec(entry.line);
    const timestamp = match?.[1] || "";
    const rawMessage = match?.[2] || entry.line;
    const level = /^(?:FAIL|ERROR):/i.test(rawMessage)
        ? "error"
        : /^WARN:/i.test(rawMessage)
            ? "warning"
            : /^OK:/i.test(rawMessage)
                ? "success"
                : "info";
    const message = rawMessage.replace(/^(?:FAIL|ERROR|WARN|OK):\s*/i, "");
    return (<div className={classes("vc-stereo-installer-log-line", `vc-stereo-installer-log-line-${level}`)}>
            <span className="vc-stereo-installer-log-time">{timestamp || "--"}</span>
            <span className="vc-stereo-installer-log-level">{level}</span>
            <span className="vc-stereo-installer-log-message">{message}</span>
        </div>);
}
function StereoInstallerPanel() {
    const [root, setRoot] = React.useState("");
    const [info, setInfo] = React.useState(null);
    const [status, setStatus] = React.useState("Ready.");
    const [logs, setLogs] = React.useState([]);
    const [busy, setBusy] = React.useState(false);
    const [installerMethod, setInstallerMethod] = React.useState("method1");
    const [method2Quality, setMethod2Quality] = React.useState("128");
    const voicePlaygroundUnavailable = !!info && info.platformKey !== "windows";
    const selectedLastPatch = info?.lastPatchLabels[METHOD_LAST_PATCH_KEYS[installerMethod]] ?? "--";
    async function runNative(action) {
        setBusy(true);
        try {
            const result = await action();
            setLogs(currentLogs => appendLogs(currentLogs, result.logs));
            if (!result.success) {
                setStatus(result.error);
                showToast(result.error, Toasts.Type.FAILURE);
                return null;
            }
            return result.data;
        }
        finally {
            setBusy(false);
        }
    }
    async function autoDetect() {
        const detected = await runNative(() => Native.autoDetect());
        if (!detected)
            return;
        setInfo(detected);
        setRoot(detected.discordRoot);
        setStatus(detected.repatchWarning || "Discord install detected.");
        notifyRepatchIfNeeded(detected);
    }
    async function loadLogs() {
        const result = await Native.readLogs();
        if (result.success)
            setLogs(appendLogs([], result.data));
    }
    async function clearLogs() {
        const cleared = await runNative(() => Native.clearLogs());
        if (!cleared)
            return;
        setLogs([]);
        setStatus("Logs cleared.");
        showToast("StereoInstaller logs cleared.", Toasts.Type.SUCCESS);
    }
    async function browse() {
        const selected = await runNative(() => Native.chooseDiscordRoot());
        if (!selected)
            return;
        setInfo(selected);
        setRoot(selected.discordRoot);
        setStatus(selected.repatchWarning || "Discord install selected.");
        notifyRepatchIfNeeded(selected);
    }
    async function runAction(kind) {
        if (!root.trim()) {
            setStatus("Choose a Discord install folder first.");
            showToast("Choose a Discord install folder first.", Toasts.Type.FAILURE);
            return;
        }
        const result = await runNative(() => {
            if (kind === "revert")
                return Native.revert(root);
            if (kind === "method2Index")
                return Native.patchMethod2Index(root);
            if (installerMethod === "method2")
                return Native.patchMethod2(root, method2Quality);
            return Native.patch(root);
        });
        if (!result)
            return;
        setInfo(result);
        setStatus("Discord will close now. Check the StereoInstaller log if it does not reopen.");
        showToast("Discord will close now to finish StereoInstaller.", Toasts.Type.SUCCESS);
    }
    function confirmPatch() {
        const isMethod2 = installerMethod === "method2";
        Alerts.show({
            title: isMethod2 ? "Use Voice Playground Method?" : "Use Discord Audio Collective Method?",
            body: (<div>
                    {isMethod2 ? (<>
                            <Paragraph>
                                This will download the Voice Playground Method file ({method2Quality} kbps) from the upstream source, rename it to discord_voice.node, and copy it into <code>{"modules\\discord_voice-1\\discord_voice"}</code>.
                            </Paragraph>
                            <Paragraph>
                                Voice Playground Method replaces the local voice module to enable higher audio quality. Use only one method on the same Discord install.
                            </Paragraph>
                        </>) : (<>
                            <Paragraph>
                                This will download the Discord Audio Collective Method files for your platform, save a backup, and replace the local Discord voice module to enable higher audio quality.
                            </Paragraph>
                            <Paragraph>
                                Use Revert to restore the saved backup before switching methods or after a Discord update if voice stops working.
                            </Paragraph>
                        </>)}
                </div>),
            confirmText: "Patch Discord voice",
            cancelText: "Cancel",
            confirmColor: Button.Colors.RED,
            onConfirm: () => void runAction("patch")
        });
    }
    function confirmMethod2IndexPatch() {
        Alerts.show({
            title: "Replace Voice Playground index.js?",
            body: (<div>
                    <Paragraph>
                        This will download index.js from the Voice Playground source into <code>{"modules\\discord_voice-1\\discord_voice"}</code>.
                    </Paragraph>
                    <Paragraph>
                        Discord will close while the file is replaced. Use this only if you are fixing Voice Playground Method files or know you need that index.js.
                    </Paragraph>
                </div>),
            confirmText: "Replace index.js",
            cancelText: "Cancel",
            confirmColor: Button.Colors.RED,
            onConfirm: () => void runAction("method2Index")
        });
    }
    function selectInstallerMethod(value) {
        if (value === "method2" && voicePlaygroundUnavailable) {
            setStatus("Voice Playground Method is only available on Windows. Linux support is handled by Discord Audio Collective Method.");
            showToast("Voice Playground Method is only available on Windows.", Toasts.Type.FAILURE);
            return;
        }
        setInstallerMethod(value);
    }
    function openDiscordAudioCollectiveSource() {
        VencordNative.native.openExternal(DISCORD_AUDIO_COLLECTIVE_SOURCE_URL);
    }
    function openVoicePlaygroundSource() {
        VencordNative.native.openExternal(VOICE_PLAYGROUND_SOURCE_URL);
    }
    function openMethod2Tutorial() {
        VencordNative.native.openExternal(VOICE_PLAYGROUND_TUTORIAL_URL);
    }
    React.useEffect(() => {
        void loadLogs().then(autoDetect);
    }, []);
    React.useEffect(() => {
        if (!voicePlaygroundUnavailable || installerMethod !== "method2")
            return;
        setInstallerMethod("method1");
        setStatus("Voice Playground Method is only available on Windows. Linux support is handled by Discord Audio Collective Method.");
    }, [installerMethod, voicePlaygroundUnavailable]);
    return (<div className="vc-stereo-installer-root">
            <div className="vc-stereo-installer-controls">
                <div className="vc-stereo-installer-select-grid">
                    <div className="vc-stereo-installer-select-row">
                        <div>
                            <span>Installer method</span>
                            <Paragraph>{voicePlaygroundUnavailable ? "Voice Playground Method is Windows-only." : "Use only one method at a time."}</Paragraph>
                        </div>
                        <Select options={METHOD_OPTIONS} select={selectInstallerMethod} isSelected={(value) => value === installerMethod} serialize={(value) => value}/>
                    </div>

                    {installerMethod === "method2" && (<div className="vc-stereo-installer-select-row">
                            <div>
                                <span>Voice Playground quality</span>
                                <Paragraph>The selected quality will be downloaded and installed as discord_voice.node.</Paragraph>
                            </div>
                            <Select options={METHOD_2_QUALITY_OPTIONS} select={(value) => setMethod2Quality(value)} isSelected={(value) => value === method2Quality} serialize={(value) => value}/>
                        </div>)}

                    <div className="vc-stereo-installer-select-row">
                        <div>
                            <span>Source code</span>
                            <Paragraph>Each method has its own upstream source.</Paragraph>
                        </div>
                        <div className="vc-stereo-installer-warning-actions">
                            <Button color={Button.Colors.PRIMARY} size={Button.Sizes.SMALL} onClick={openDiscordAudioCollectiveSource}>
                                Discord Audio Collective
                            </Button>
                            <Button color={Button.Colors.PRIMARY} size={Button.Sizes.SMALL} onClick={openVoicePlaygroundSource}>
                                Voice Playground
                            </Button>
                        </div>
                    </div>
                </div>

                {installerMethod === "method2" && (<div className="vc-stereo-installer-method2-note">
                        <Paragraph>
                            Voice Playground Method downloads Windows payloads from the upstream source for higher audio quality. Do not install both methods on the same client. If Discord voice files stop working, use the bundled index.js repair and check the tutorial.
                        </Paragraph>
                        <div className="vc-stereo-installer-warning-actions">
                            <Button color={Button.Colors.PRIMARY} size={Button.Sizes.SMALL} onClick={openVoicePlaygroundSource}>
                                Voice Playground source
                            </Button>
                            <Button color={Button.Colors.PRIMARY} size={Button.Sizes.SMALL} onClick={openMethod2Tutorial}>
                                Corruption fix tutorial
                            </Button>
                            <Button color={Button.Colors.RED} size={Button.Sizes.SMALL} disabled={busy} onClick={confirmMethod2IndexPatch}>
                                Replace index.js
                            </Button>
                        </div>
                    </div>)}

                <TextInput value={root} placeholder="Discord install folder" onChange={(value) => setRoot(value)} disabled={busy}/>
                <div className="vc-stereo-installer-buttons">
                    <Button color={Button.Colors.PRIMARY} size={Button.Sizes.SMALL} disabled={busy} onClick={() => void autoDetect()}>
                        Auto-detect
                    </Button>
                    <Button color={Button.Colors.PRIMARY} size={Button.Sizes.SMALL} disabled={busy} onClick={() => void browse()}>
                        Browse
                    </Button>
                    <Button color={Button.Colors.GREEN} size={Button.Sizes.SMALL} disabled={busy} onClick={confirmPatch}>
                        Patch Discord voice
                    </Button>
                    <Button color={Button.Colors.RED} size={Button.Sizes.SMALL} disabled={busy} onClick={() => void runAction("revert")}>
                        Revert to backup
                    </Button>
                </div>
            </div>

            {info && <InstallationStatus info={info}/>}

            {info && (<div className="vc-stereo-installer-info">
                    <InfoLine label="Client" value={info.clientLabel}/>
                    <InfoLine label="Platform" value={`${info.platformLabel} ${info.readableOs}`}/>
                    <InfoLine label="Voice module" value={info.voiceDir}/>
                    {"logPath" in info && <InfoLine label="Log file" value={info.logPath}/>}
                    <InfoLine label={`${METHOD_LABELS[installerMethod]} last patch`} value={selectedLastPatch}/>
                </div>)}

            <Paragraph className="vc-stereo-installer-status">{busy ? "Working..." : status}</Paragraph>

            <div className="vc-stereo-installer-log-panel">
                <div className="vc-stereo-installer-log-header">
                    <div>
                        <Heading tag="h3">Installer logs</Heading>
                        <Paragraph>{logs.length ? `${logs.length} log entries.` : "No log entries yet."}</Paragraph>
                    </div>
                    <Button color={Button.Colors.RED} size={Button.Sizes.SMALL} disabled={busy || !logs.length} onClick={() => void clearLogs()}>
                        <DeleteIcon width={16} height={16}/>
                        Clear logs
                    </Button>
                </div>
                <div className="vc-stereo-installer-log" role="log" aria-live="polite">
                    {logs.length
            ? logs.slice(-200).map(entry => <LogLine key={entry.id} entry={entry}/>)
            : <div className="vc-stereo-installer-log-empty">StereoInstaller activity will appear here.</div>}
                </div>
            </div>
        </div>);
}
function StereoInstallerPage() {
    return (<>
            <StereoWarning />
            <StereoInstallerPanel />
        </>);
}
const settings = definePluginSettings({
    installer: {
        type: 6 /* OptionType.COMPONENT */,
        component: ErrorBoundary.wrap(StereoInstallerPanel, { noop: true }),
    }
});
export default definePlugin({
    name: "StereoInstaller",
    description: "Installs and reverts the Discord stereo voice module from selected method sources.",
    tags: ["Utility"],
    authors: [{ name: "irritably", id: 928787166916640838n }],
    reporterTestable: 2 /* ReporterTestable.None */,
    settings,
    settingsAboutComponent: ErrorBoundary.wrap(StereoWarning, { noop: true }),
    toolboxActions: {
        "Open StereoInstaller": () => SettingsRouter.openUserSettings(`${SETTINGS_ENTRY_KEY}_panel`),
    },
    start() {
        if (!SettingsPlugin.customEntries.some(entry => entry.key === SETTINGS_ENTRY_KEY)) {
            SettingsPlugin.customEntries.push({
                key: SETTINGS_ENTRY_KEY,
                title: "StereoInstaller",
                Component: ErrorBoundary.wrap(StereoInstallerPage, { noop: true }),
                Icon: HeadphonesIcon,
            });
        }
        void Native.autoDetect().then(result => {
            if (result.success)
                notifyRepatchIfNeeded(result.data);
        }, () => void 0);
    },
    stop() {
        removeFromArray(SettingsPlugin.customEntries, entry => entry.key === SETTINGS_ENTRY_KEY);
    }
});
