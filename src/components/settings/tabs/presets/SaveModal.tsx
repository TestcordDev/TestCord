/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { FormSwitch } from "@components/FormSwitch";
import { Paragraph } from "@components/Paragraph";
import { ModalContent, ModalFooter, openModal, type RenderModalProps } from "@utils/modal";
import { Modal, React, TextInput } from "@webpack/common";

import type { ScopeKey } from "./presets";

const SCOPES: { key: ScopeKey; label: string; description: string; warn?: boolean; }[] = [
    { key: "plugins", label: "Plugins", description: "Which plugins are enabled, plus each plugin's own settings. Plugins that keep their settings in the DataStore also need the DataStore scope below." },
    { key: "themes", label: "Enabled themes", description: "The list of enabled theme names. On apply, themes you don't have are skipped." },
    { key: "quickCss", label: "QuickCSS", description: "Your QuickCSS stylesheet text." },
    { key: "dataStore", label: "DataStore", description: "Plugin databases and stored data, including settings of plugins that don't use the standard settings store. May be large or contain sensitive info.", warn: true },
];

function SaveModal({ modalProps, initialName, onSave }: { modalProps: RenderModalProps; initialName: string; onSave: (name: string, scope: ScopeKey[]) => void | Promise<void>; }) {
    const [name, setName] = React.useState(initialName);
    const [scope, setScope] = React.useState<Record<ScopeKey, boolean>>({
        plugins: true, themes: true, quickCss: false, dataStore: false,
    });

    const toggle = (key: ScopeKey, v: boolean) => setScope(s => ({ ...s, [key]: v }));
    const selected = SCOPES.filter(s => scope[s.key]).map(s => s.key);
    const canSave = name.trim().length > 0 && selected.length > 0;

    const submit = () => {
        if (!canSave) return;
        onSave(name.trim(), selected);
        modalProps.onClose();
    };

    return (
        <Modal title={<h2 className="vc-presets-modal-title">Save current as preset</h2>} {...modalProps} size="lg">
            <ModalContent className="vc-presets-modal-content">
                <TextInput value={name} onChange={setName} placeholder="Preset name" autoFocus />
                <Paragraph className="vc-presets-dim">Choose what this preset captures:</Paragraph>
                {SCOPES.map((s, index) => (
                    <FormSwitch
                        key={s.key}
                        value={scope[s.key]}
                        onChange={v => toggle(s.key, v)}
                        title={s.label}
                        description={s.warn && scope[s.key] ? `⚠ ${s.description}` : s.description}
                        hideBorder={index === SCOPES.length - 1}
                    />
                ))}
                {selected.length === 0 && <Paragraph className="vc-presets-modal-invalid">Pick at least one thing to save.</Paragraph>}
            </ModalContent>
            <ModalFooter className="vc-presets-modal-footer">
                <Button onClick={submit} disabled={!canSave}>Save</Button>
            </ModalFooter>
        </Modal>
    );
}

export function openSaveModal(initialName: string, onSave: (name: string, scope: ScopeKey[]) => void | Promise<void>) {
    openModal(modalProps => <SaveModal modalProps={modalProps} initialName={initialName} onSave={onSave} />);
}
