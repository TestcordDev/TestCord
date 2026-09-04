/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { classNameFactory } from "@utils/css";
import {
    ModalContent,
    ModalFooter,
    ModalProps as VencordModalProps
} from "@utils/modal";
import { Modal as DiscordModal, useState } from "@webpack/common";

import type { CaptionMedia, GifTransform, OnSubmit } from "../types";
import Captioner from "./captioner";
import { clearStatus, showCreating } from "./statusCard";

const cl = classNameFactory("vc-gif-captioner-");

interface ModalProps extends VencordModalProps {
    media: CaptionMedia;
    onCancel?: () => void;
    onConfirm?: (transform: GifTransform) => Promise<void> | void;
    onSubmit: OnSubmit;
}

export default function Modal({ media, onCancel, onConfirm, onSubmit, ...modalProps }: ModalProps) {
    const [submitCallback, setSubmitCallback] = useState<(() => GifTransform) | null>(null);

    const handleClose = () => {
        onCancel?.();
        modalProps.onClose();
    };

    const handleApply = () => {
        const result = submitCallback?.();
        if (!result) {
            clearStatus();
            handleClose();
            return;
        }

        showCreating();
        void onConfirm?.(result);
        modalProps.onClose();
    };

    return (
        <DiscordModal {...modalProps} onClose={handleClose} size="md" title="Edit GIF">
            <ModalContent className={cl("modal-content")}>
                <Captioner
                    media={media}
                    onSubmit={callback => {
                        setSubmitCallback(() => callback);
                        onSubmit(callback);
                    }}
                />
            </ModalContent>
            <ModalFooter>
                <Button variant="secondary" onClick={handleClose}>Cancel</Button>
                <Button onClick={handleApply}>Apply</Button>
            </ModalFooter>
        </DiscordModal>
    );
}
