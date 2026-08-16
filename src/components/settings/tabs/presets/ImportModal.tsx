/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, ModalSize, openModal, type RenderModalProps } from "@utils/modal";
import { chooseFile } from "@utils/web";
import { Alerts, React, showToast, TextArea, TextInput, Toasts } from "@webpack/common";

import { hasPreset, importPresetObject, Preset, validatePreset } from "./presets";

function parsePreview(text: string): Preset | null {
    if (!text.trim()) return null;
    try {
        return validatePreset(JSON.parse(text));
    } catch {
        return null;
    }
}

function ImportModal({ modalProps, onImported }: { modalProps: RenderModalProps; onImported: () => void; }) {
    const [text, setText] = React.useState("");
    const [rename, setRename] = React.useState("");
    const preview = parsePreview(text);

    // Keep the rename field defaulted to the parsed name until the user edits it.
    const [renameTouched, setRenameTouched] = React.useState(false);
    const effectiveName = renameTouched ? rename : (preview?.name ?? "");

    const openFile = async () => {
        const file = await chooseFile("application/json");
        if (!file) return;
        const content = await file.text();
        setText(content);
        setRenameTouched(false);
    };

    const doImport = () => {
        if (!preview) return;
        const run = () => {
            const stored = importPresetObject(preview, effectiveName.trim() || undefined);
            if (stored) {
                showToast(`Imported preset "${stored}".`, Toasts.Type.SUCCESS);
                onImported();
                modalProps.onClose();
            } else {
                showToast("Could not import that preset.", Toasts.Type.FAILURE);
            }
        };
        // A hand-typed name overwrites a clash outright; without one, collisions
        // get the " (imported)" suffix instead, so only the typed path needs asking.
        if (renameTouched && hasPreset(effectiveName.trim())) {
            Alerts.show({
                title: "Overwrite preset",
                body: `A preset named "${effectiveName.trim()}" already exists. Overwrite it?`,
                confirmText: "Overwrite",
                confirmColor: "danger",
                cancelText: "Cancel",
                onConfirm: run,
            });
            return;
        }
        run();
    };

    const enabledCount = preview ? Object.values(preview.plugins).filter(p => p.enabled).length : 0;

    return (
        <ModalRoot {...modalProps} size={ModalSize.MEDIUM}>
            <ModalHeader className="vc-presets-modal-header">
                <h2 className="vc-presets-modal-title">Import preset</h2>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>
            <ModalContent className="vc-presets-modal-content">
                <Paragraph>Paste a preset string, or open a <code>.json</code> file.</Paragraph>
                <TextArea
                    className="vc-presets-modal-textarea"
                    value={text}
                    onChange={(v: string) => { setText(v); setRenameTouched(false); }}
                    placeholder='{ "name": "…", "plugins": { … } }'
                />
                <Button size="small" variant="secondary" onClick={openFile} className="vc-presets-modal-row">
                    Open JSON file…
                </Button>

                {text.trim() && (
                    preview
                        ? (
                            <div className="vc-presets-preview">
                                <Paragraph><strong>Preview</strong></Paragraph>
                                <Paragraph>Name: {preview.name}</Paragraph>
                                <Paragraph>{enabledCount} plugin(s) enabled{preview.liveBackup ? " · live backup" : ""}{preview.restoreSettings !== undefined ? ` · restore ${preview.restoreSettings ? "on" : "off"}` : ""}</Paragraph>
                                <Paragraph className="vc-presets-modal-row">Import as:</Paragraph>
                                <TextInput
                                    value={effectiveName}
                                    onChange={(v: string) => { setRename(v); setRenameTouched(true); }}
                                    placeholder="Preset name"
                                />
                            </div>
                        )
                        : <Paragraph className="vc-presets-modal-invalid">That doesn't look like a valid preset.</Paragraph>
                )}
            </ModalContent>
            <ModalFooter className="vc-presets-modal-footer">
                <Button onClick={doImport} disabled={!preview || !effectiveName.trim()}>Import</Button>
                <Button variant="secondary" onClick={modalProps.onClose}>Cancel</Button>
            </ModalFooter>
        </ModalRoot>
    );
}

export function openImportModal(onImported: () => void) {
    openModal(modalProps => <ImportModal modalProps={modalProps} onImported={onImported} />);
}
