/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { reapplyThemes } from "@api/Themes";
import { Button } from "@components/Button";
import { Link } from "@components/Link";
import { Paragraph } from "@components/Paragraph";
import { Margins } from "@utils/margins";
import { Modal, openModal, React, showToast, TextInput, Toasts, useState } from "@webpack/common";

import { CodeViewerModal } from "./CodeViewerModal";
import { slugifyMarketplaceName } from "./MarketplaceData";
import { deleteOverride, getOverride, setOverride } from "./MarketplaceOverrides";

export function openOverrideEditorModal({ id, name, baseCss, onDone }: {
    id: number;
    name: string;
    baseCss: string;
    onDone?: () => void;
}) {
    void getOverride(id).then(existing => {
        openModal(modalProps => (
            <CodeViewerModal
                modalProps={modalProps}
                title={`${name} - Custom version`}
                code={existing ?? baseCss}
                editable
                onSave={async newCode => {
                    if (!newCode.trim()) await deleteOverride(id);
                    else await setOverride(id, newCode);
                    reapplyThemes();
                    onDone?.();
                }}
            />
        ));
    });
}

function starterTemplate(kind: "theme" | "snippet", name: string): string {
    return `/**\n * @name ${name}\n * @description My custom ${kind}.\n */\n\n/* Write your CSS below. It loads like any other ${kind}. */\n`;
}

function CustomUploadNameModal({ modalProps, kind, onSaved }: {
    modalProps: any;
    kind: "theme" | "snippet";
    onSaved?: () => void;
}) {
    const [name, setName] = useState("");

    function cont() {
        const trimmed = name.trim();
        if (!trimmed) {
            showToast(`Give your ${kind} a name first.`, Toasts.Type.FAILURE);
            return;
        }
        modalProps.onClose();
        const fileName = `${slugifyMarketplaceName(trimmed)}.${kind}.css`;
        openModal(codeProps => (
            <CodeViewerModal
                modalProps={codeProps}
                title={`${trimmed} - Code`}
                code={starterTemplate(kind, trimmed)}
                editable
                onSave={async css => {
                    await VencordNative.themes.uploadTheme(fileName, css);
                    onSaved?.();
                }}
            />
        ));
    }

    return (
        <Modal {...modalProps} size="sm" title={`New custom ${kind}`}>
            <div className={Margins.bottom16}>
                <TextInput
                    placeholder={`My awesome ${kind}`}
                    value={name}
                    onChange={setName}
                />
            </div>
            <Paragraph color="text-muted" className={Margins.bottom16}>
                This saves a local {kind} file, so only you will see it. To share it with everyone, submit it on{" "}
                <Link href="https://themes.equicord.org">themes.equicord.org</Link> (login required).
            </Paragraph>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <Button variant="secondary" onClick={() => modalProps.onClose()}>Cancel</Button>
                <Button variant="primary" onClick={cont}>Continue</Button>
            </div>
        </Modal>
    );
}

export function openCustomUploadModal({ kind, onSaved }: {
    kind: "theme" | "snippet";
    onSaved?: () => void;
}) {
    openModal(modalProps => (
        <CustomUploadNameModal modalProps={modalProps} kind={kind} onSaved={onSaved} />
    ));
}
