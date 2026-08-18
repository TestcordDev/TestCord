/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { FormSwitch } from "@components/FormSwitch";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { copyToClipboard } from "@utils/clipboard";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, ModalSize, openModal, type RenderModalProps } from "@utils/modal";
import { React, showToast, TextArea, Toasts } from "@webpack/common";

import { openExportModal } from "./ExportModal";
import { getForceApplyDefault, getPreset, getRestoreDefault, setPresetForceApply, setPresetLiveBackup, setPresetRestore, stringifyPreset, updatePresetRaw } from "./presets";

type LoadedPreset = NonNullable<ReturnType<typeof getPreset>>;

function formatDate(ts: number) {
    if (!ts) return "Unknown";
    return new Intl.DateTimeFormat(navigator.language, { dateStyle: "long", timeStyle: "medium" }).format(ts);
}

function formatBytes(n: number) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function InfoStat({ label, value, copyValue, mono }: { label: string; value: React.ReactNode; copyValue?: string | number; mono?: boolean; }) {
    const copy = () => {
        copyToClipboard(String(copyValue ?? value));
        showToast(`${label} copied.`, Toasts.Type.SUCCESS);
    };

    return (
        <div className="vc-presets-stat" role="button" tabIndex={0} onClick={copy} onKeyDown={e => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            copy();
        }}>
            <span className="vc-presets-stat-label">{label}</span>
            <span className={`vc-presets-stat-value${mono ? " vc-presets-stat-mono" : ""}`}>{value}</span>
        </div>
    );
}

function DevInfo({ preset, globalDefault, globalForce }: { preset: LoadedPreset; globalDefault: boolean; globalForce: boolean; }) {
    const entries = Object.entries(preset.plugins);
    const enabled = entries.filter(([, p]) => p.enabled);
    const disabled = entries.length - enabled.length;
    const overridden = entries.reduce((acc, [, p]) => acc + Object.keys(p).filter(k => k !== "enabled").length, 0);
    const byteSize = new TextEncoder().encode(stringifyPreset(preset)).length;
    const effectiveRestore = preset.restoreSettings ?? globalDefault;
    const effectiveForce = preset.forceApply ?? globalForce;

    return (
        <div className="vc-presets-stats">
            <InfoStat label="Name" value={preset.name} mono />
            <InfoStat label="Created" value={formatDate(preset.createdAt)} copyValue={formatDate(preset.createdAt)} />
            <InfoStat label="Timestamp" value={preset.createdAt || "—"} mono />
            <InfoStat label="Plugins (total)" value={entries.length} />
            <InfoStat label="Enabled" value={enabled.length} />
            <InfoStat label="Disabled" value={disabled} />
            <InfoStat label="Settings overridden" value={overridden} />
            <InfoStat label="Serialized size" value={formatBytes(byteSize)} mono />
            <InfoStat label="Live backup" value={preset.liveBackup ? "On" : "Off"} />
            <InfoStat
                label="Restore on apply"
                value={preset.restoreSettings === undefined
                    ? `Default → ${effectiveRestore ? "On" : "Off"}`
                    : preset.restoreSettings ? "On" : "Off"}
            />
            <InfoStat
                label="Force apply"
                value={preset.forceApply === undefined
                    ? `Default → ${effectiveForce ? "On" : "Off"}`
                    : preset.forceApply ? "On" : "Off"}
            />
        </div>
    );
}

function Summary({ preset }: { preset: LoadedPreset; }) {
    const entries = Object.entries(preset.plugins);
    return (
        <div className="vc-presets-summary">
            {entries.length === 0
                ? <Paragraph className="vc-presets-dim">No plugins captured in this preset.</Paragraph>
                : entries.map(([pluginName, cfg]) => {
                    const settingKeys = Object.keys(cfg).filter(k => k !== "enabled");
                    return (
                        <div key={pluginName} className="vc-presets-summary-plugin">
                            <span className="vc-presets-summary-name">{pluginName}{cfg.enabled ? "" : " (disabled)"}</span>
                            {settingKeys.length > 0 && (
                                <div className="vc-presets-summary-settings">
                                    {settingKeys.map(k => (
                                        <div key={k}><span className="vc-presets-summary-key">{k}</span>: {stringifyPreset(cfg[k])}</div>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
        </div>
    );
}

function InfoModal({ modalProps, name, onChange }: { modalProps: RenderModalProps; name: string; onChange: () => void; }) {
    const [, force] = React.useReducer(x => x + 1, 0);
    const [tab, setTab] = React.useState<"info" | "settings" | "contents" | "json">("info");
    const preset = getPreset(name);
    const [json, setJson] = React.useState(() => preset ? stringifyPreset(preset, 4) : "{}");
    const [jsonDirty, setJsonDirty] = React.useState(false);

    // Refresh the editor from the live preset every time the JSON tab is opened,
    // so live-backup updates aren't clobbered by a stale copy. Unsaved edits win.
    const showTab = (next: "info" | "settings" | "contents" | "json") => {
        if (next === "json" && !jsonDirty && preset) setJson(stringifyPreset(preset, 4));
        setTab(next);
    };

    if (!preset) {
        return (
            <ModalRoot {...modalProps} size={ModalSize.SMALL}>
                <ModalHeader className="vc-presets-modal-header">
                    <h2 className="vc-presets-modal-title">Preset</h2>
                    <ModalCloseButton onClick={modalProps.onClose} />
                </ModalHeader>
                <ModalContent className="vc-presets-modal-content">
                    <Paragraph>Preset not found.</Paragraph>
                </ModalContent>
                <ModalFooter className="vc-presets-modal-footer">
                    <Button variant="secondary" onClick={modalProps.onClose}>Close</Button>
                </ModalFooter>
            </ModalRoot>
        );
    }

    const globalDefault = getRestoreDefault();
    const globalForce = getForceApplyDefault();
    const restoreState = preset.restoreSettings === undefined
        ? `Default (${globalDefault ? "on" : "off"})`
        : preset.restoreSettings ? "On" : "Off";
    const cycleRestore = () => {
        const next = preset.restoreSettings === undefined ? true
            : preset.restoreSettings === true ? false
                : undefined;
        setPresetRestore(name, next);
        force();
        onChange();
    };
    const forceState = preset.forceApply === undefined
        ? `Default (${globalForce ? "on" : "off"})`
        : preset.forceApply ? "On" : "Off";
    const cycleForce = () => {
        const next = preset.forceApply === undefined ? true
            : preset.forceApply === true ? false
                : undefined;
        setPresetForceApply(name, next);
        force();
        onChange();
    };
    const toggleLive = (v: boolean) => {
        setPresetLiveBackup(name, v);
        force();
        onChange();
    };

    const copyJson = () => {
        copyToClipboard(stringifyPreset(preset, 4));
        showToast("Preset JSON copied.", Toasts.Type.SUCCESS);
    };
    const saveJson = () => {
        const stored = updatePresetRaw(name, json);
        if (stored) {
            showToast(`Saved "${stored}".`, Toasts.Type.SUCCESS);
            onChange();
            modalProps.onClose();
        } else {
            showToast("Invalid JSON, or that name is already taken.", Toasts.Type.FAILURE);
        }
    };

    return (
        <ModalRoot {...modalProps} size={ModalSize.MEDIUM}>
            <ModalHeader className="vc-presets-modal-header">
                <h2 className="vc-presets-modal-title">Preset "{name}"</h2>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>
            <ModalContent className="vc-presets-modal-content">
                <div className="vc-presets-tabs">
                    <button className={`vc-presets-tab ${tab === "info" ? "vc-presets-tab-active" : ""}`} onClick={() => showTab("info")}>Info</button>
                    <button className={`vc-presets-tab ${tab === "settings" ? "vc-presets-tab-active" : ""}`} onClick={() => showTab("settings")}>Settings</button>
                    <button className={`vc-presets-tab ${tab === "contents" ? "vc-presets-tab-active" : ""}`} onClick={() => showTab("contents")}>Contents</button>
                    <button className={`vc-presets-tab ${tab === "json" ? "vc-presets-tab-active" : ""}`} onClick={() => showTab("json")}>JSON</button>
                </div>

                {tab === "info" && <DevInfo preset={preset} globalDefault={globalDefault} globalForce={globalForce} />}

                {tab === "settings" && (
                    <div className="vc-presets-settings">
                        <FormSwitch
                            value={!!preset.liveBackup}
                            onChange={toggleLive}
                            title="Live backup"
                            description="Auto-resnapshot this preset's plugins and plugin settings whenever a plugin is toggled or a setting changes. Themes, QuickCSS, and DataStore only update when you save over the preset."
                        />
                        <div className="vc-presets-setting-row">
                            <div className="vc-presets-setting-text">
                                <Heading tag="h5">Restore plugin settings on apply</Heading>
                                <Paragraph className="vc-presets-dim">Override the global default for this preset. Default follows the tab's toggle.</Paragraph>
                            </div>
                            <Button size="small" variant="secondary" onClick={cycleRestore}>{restoreState}</Button>
                        </div>
                        <div className="vc-presets-setting-row">
                            <div className="vc-presets-setting-text">
                                <Heading tag="h5">Force apply (full overwrite)</Heading>
                                <Paragraph className="vc-presets-dim">Override the global default for this preset. When on, applying disables every plugin the preset doesn't include and always overwrites plugin settings.</Paragraph>
                            </div>
                            <Button size="small" variant="secondary" onClick={cycleForce}>{forceState}</Button>
                        </div>
                    </div>
                )}

                {tab === "contents" && <Summary preset={preset} />}

                {tab === "json" && (
                    <div className="vc-presets-json">
                        <div className="vc-presets-modal-actions">
                            <Button size="small" variant="secondary" onClick={copyJson}>Copy JSON</Button>
                            <Button size="small" variant="secondary" onClick={() => openExportModal(name)}>Export…</Button>
                        </div>
                        <TextArea
                            className="vc-presets-modal-textarea"
                            value={json}
                            onChange={v => { setJson(v); setJsonDirty(true); }}
                            placeholder="{ … }"
                        />
                    </div>
                )}
            </ModalContent>
            <ModalFooter className="vc-presets-modal-footer">
                {tab === "json" && <Button onClick={saveJson}>Save edits</Button>}
                <Button variant="secondary" onClick={modalProps.onClose}>Close</Button>
            </ModalFooter>
        </ModalRoot>
    );
}

export function openInfoModal(name: string, onChange: () => void) {
    openModal(modalProps => <InfoModal modalProps={modalProps} name={name} onChange={onChange} />);
}
