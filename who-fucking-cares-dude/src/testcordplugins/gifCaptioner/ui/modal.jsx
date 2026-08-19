/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { BaseText } from "@components/BaseText";
import { Button } from "@components/Button";
import { classNameFactory } from "@utils/css";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot } from "@utils/modal";
import { useState } from "@webpack/common";
import Captioner from "./captioner";
import { clearStatus, showCreating } from "./statusCard";
const cl = classNameFactory("vc-gif-captioner-");
export default function Modal({ media, onCancel, onConfirm, onSubmit, ...modalProps }) {
    const [submitCallback, setSubmitCallback] = useState(null);
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
    return (<ModalRoot {...modalProps} size={"medium" /* ModalSize.MEDIUM */}>
            <ModalHeader separator={false} className={cl("modal-header")}>
                <BaseText size="lg" weight="semibold" color="text-strong" tag="h1" className={cl("modal-title")}>
                    Edit GIF
                </BaseText>
                <ModalCloseButton onClick={handleClose}/>
            </ModalHeader>
            <ModalContent className={cl("modal-content")}>
                <Captioner media={media} onSubmit={callback => {
            setSubmitCallback(() => callback);
            onSubmit(callback);
        }}/>
            </ModalContent>
            <ModalFooter>
                <Button variant="secondary" onClick={handleClose}>Cancel</Button>
                <Button onClick={handleApply}>Apply</Button>
            </ModalFooter>
        </ModalRoot>);
}
