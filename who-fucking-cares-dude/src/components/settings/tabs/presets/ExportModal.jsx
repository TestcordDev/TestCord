/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Button } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import { copyToClipboard } from "@utils/clipboard";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, openModal } from "@utils/modal";
import { saveFile } from "@utils/web";
import { showToast, Toasts } from "@webpack/common";
import { exportPreset } from "./presets";
function ExportModal({ modalProps, name }) {
    const str = exportPreset(name) ?? "";
    const copy = () => {
        copyToClipboard(str);
        showToast("Preset copied to clipboard.", Toasts.Type.SUCCESS);
        modalProps.onClose();
    };
    const save = () => {
        saveFile(new File([str], `${name}.json`, { type: "application/json" }));
        modalProps.onClose();
    };
    return (<ModalRoot {...modalProps} size={"small" /* ModalSize.SMALL */}>
            <ModalHeader className="vc-presets-modal-header">
                <h2 className="vc-presets-modal-title">Export "{name}"</h2>
                <ModalCloseButton onClick={modalProps.onClose}/>
            </ModalHeader>
            <ModalContent className="vc-presets-modal-content">
                <Paragraph>How do you want to export this preset?</Paragraph>
                <div className="vc-presets-modal-actions">
                    <Button onClick={copy}>Copy to clipboard</Button>
                    <Button variant="secondary" onClick={save}>Save to file</Button>
                </div>
            </ModalContent>
            <ModalFooter className="vc-presets-modal-footer">
                <Button variant="secondary" onClick={modalProps.onClose}>Cancel</Button>
            </ModalFooter>
        </ModalRoot>);
}
export function openExportModal(name) {
    openModal(modalProps => <ExportModal modalProps={modalProps} name={name}/>);
}
