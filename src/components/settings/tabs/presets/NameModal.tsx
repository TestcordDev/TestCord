/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { ModalContent, ModalFooter, openModal, type RenderModalProps } from "@utils/modal";
import { Modal, React, TextInput } from "@webpack/common";

function NameModal({ modalProps, title, initial, onSubmit }: { modalProps: RenderModalProps; title: string; initial: string; onSubmit: (name: string) => void; }) {
    const [value, setValue] = React.useState(initial);
    const submit = () => {
        const name = value.trim();
        if (!name) return;
        onSubmit(name);
        modalProps.onClose();
    };

    return (
        <Modal title={<h2 className="vc-presets-modal-title">{title}</h2>} {...modalProps} size="md">
            <ModalContent className="vc-presets-modal-content">
                <TextInput
                    value={value}
                    onChange={setValue}
                    placeholder="Preset name"
                    autoFocus
                />
            </ModalContent>
            <ModalFooter className="vc-presets-modal-footer">
                <Button onClick={submit} disabled={!value.trim()}>OK</Button>
                <Button variant="secondary" onClick={modalProps.onClose}>Cancel</Button>
            </ModalFooter>
        </Modal>
    );
}

export function openNameModal(title: string, initial: string, onSubmit: (name: string) => void) {
    openModal(modalProps => <NameModal modalProps={modalProps} title={title} initial={initial} onSubmit={onSubmit} />);
}
