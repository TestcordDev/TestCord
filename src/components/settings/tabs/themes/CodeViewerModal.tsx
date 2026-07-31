/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./CodeViewerModal.css";

import { Button } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import { copyToClipboard } from "@utils/clipboard";
import { classNameFactory } from "@utils/css";
import { Modal, React, showToast, Toasts, useState } from "@webpack/common";

const cl = classNameFactory("vc-code-viewer-");

export interface CodeViewerModalProps {
    modalProps: any;
    title: string;
    code: string;
    /** If true, the textarea is editable and a Save button is shown */
    editable?: boolean;
    /** Called with the new code when the user clicks Save */
    onSave?: (newCode: string) => Promise<void> | void;
    /** If provided, shows a "Save as Local Theme" button (for remote/marketplace code) */
    onSaveAsLocal?: (code: string) => Promise<void> | void;
}

export function CodeViewerModal({ modalProps, title, code, editable, onSave, onSaveAsLocal }: CodeViewerModalProps) {
    const [value, setValue] = useState(code);
    const [saving, setSaving] = useState(false);
    const dirty = value !== code;

    const handleCopy = () => {
        copyToClipboard(value);
        showToast("Code copied to clipboard!", Toasts.Type.SUCCESS);
    };

    const handleSave = async () => {
        if (!onSave) return;
        setSaving(true);
        try {
            await onSave(value);
            showToast("Saved!", Toasts.Type.SUCCESS);
            modalProps.onClose();
        } catch (e: any) {
            showToast(`Failed to save: ${e?.message ?? "Unknown error"}`, Toasts.Type.FAILURE);
        } finally {
            setSaving(false);
        }
    };

    const handleSaveAsLocal = async () => {
        if (!onSaveAsLocal) return;
        setSaving(true);
        try {
            await onSaveAsLocal(value);
            showToast("Saved as local theme!", Toasts.Type.SUCCESS);
        } catch (e: any) {
            showToast(`Failed to save: ${e?.message ?? "Unknown error"}`, Toasts.Type.FAILURE);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal {...modalProps} size="lg" title={title}>
            <div className={cl("body")}>
                {!editable && (
                    <Paragraph className={cl("hint")}>
                        This is a read-only preview. Use "Save as Local Theme" to keep your own editable copy.
                    </Paragraph>
                )}
                <textarea
                    className={cl("textarea")}
                    value={value}
                    onChange={editable ? e => setValue(e.currentTarget.value) : undefined}
                    readOnly={!editable}
                    spellCheck={false}
                    wrap="off"
                />
                <div className={cl("actions")}>
                    <Button variant="secondary" onClick={handleCopy}>
                        Copy Code
                    </Button>
                    {onSaveAsLocal && (
                        <Button variant="secondary" onClick={handleSaveAsLocal} disabled={saving}>
                            Save as Local Theme
                        </Button>
                    )}
                    {editable && onSave && (
                        <Button variant="primary" onClick={handleSave} disabled={saving || !dirty}>
                            {saving ? "Saving..." : "Save Changes"}
                        </Button>
                    )}
                </div>
            </div>
        </Modal>
    );
}
