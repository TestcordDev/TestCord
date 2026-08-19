/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Paragraph } from "@components/Paragraph";
import { Modal, React } from "@webpack/common";
export function ConfirmModal({ title, message, confirmText, cancelText, onConfirm, onCancel, ...props }) {
    const closeAfter = (action) => () => {
        action();
        props.onClose();
    };
    return (<Modal {...props} size="sm" title={title} actions={[
            {
                text: confirmText,
                variant: "primary",
                onClick: closeAfter(onConfirm)
            },
            {
                text: cancelText,
                variant: "secondary",
                onClick: closeAfter(onCancel)
            }
        ]}>
            <Paragraph>{message}</Paragraph>
        </Modal>);
}
export function ImportProfilesModal({ title, message, onOverride, onMerge, onCancel, ...props }) {
    const closeAfter = (action) => () => {
        action();
        props.onClose();
    };
    return (<Modal {...props} size="sm" title={title} actions={[
            {
                text: "Override",
                variant: "primary",
                onClick: closeAfter(onOverride)
            },
            {
                text: "Merge",
                variant: "primary",
                onClick: closeAfter(onMerge)
            },
            {
                text: "Cancel",
                variant: "secondary",
                onClick: closeAfter(onCancel)
            }
        ]}>
            <Paragraph>{message}</Paragraph>
        </Modal>);
}
