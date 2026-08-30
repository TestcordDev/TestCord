/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./UpdateAvailableModal.css";

import { Button } from "@components/Button";
import { ModalFooter, openModal, type RenderModalProps } from "@utils/modal";
import { Modal } from "@webpack/common";

import { Flex } from "./Flex";

const UPDATE_ICON = "https://cdn.discordapp.com/icons/1434211283317690502/f560c2b05d0def74e4e631eaffd65c2f.webp?size=1024";

interface UpdateCommit {
    hash: string;
    author: string;
    message: string;
}

interface UpdateAvailableModalProps {
    commits: UpdateCommit[];
    modalProps: RenderModalProps;
    onConfirm: () => void;
    onUpdate?: () => void;
    title: string;
    confirmText: string;
    updateText?: string;
}

function UpdateAvailableModal({ commits, modalProps, onConfirm, onUpdate, title, confirmText, updateText = "Update" }: UpdateAvailableModalProps) {
    return (
        <div className="vc-update-modal-root">
            <Modal {...modalProps} title={<>
                <Flex gap={8}>
                    <img className="vc-update-modal-icon" src={UPDATE_ICON} alt="" />
                    <div className="vc-update-modal-heading">
                        <h2 className="vc-update-modal-title">{title}</h2>
                    </div>
                </Flex>
            </>} size="md">
                <p className="vc-update-modal-commits-title">New commits</p>
                {commits.length > 0 ? (
                    <ul className="vc-update-modal-commits">
                        {commits.map(commit => (
                            <li className="vc-update-modal-commit" key={commit.hash}>
                                <span className="vc-update-modal-commit-hash">{commit.hash.slice(0, 7)}</span>
                                <div className="vc-update-modal-commit-body">
                                    <p className="vc-update-modal-commit-message">{commit.message}</p>
                                    <div className="vc-update-modal-commit-meta">{commit.author}</div>
                                </div>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="vc-update-modal-empty">No commit details were returned for this update.</p>
                )}
                <ModalFooter className="vc-update-modal-footer">
                    {onUpdate && (
                        <Button
                            onClick={() => {
                                modalProps.onClose();
                                onUpdate();
                            }}
                        >
                            {updateText}
                        </Button>
                    )}
                    <Button
                        variant="secondary"
                        onClick={() => {
                            modalProps.onClose();
                            onConfirm();
                        }}
                    >
                        {confirmText}
                    </Button>
                </ModalFooter>
            </Modal>
        </div>
    );
}

export function openUpdateAvailableModal(options: Omit<UpdateAvailableModalProps, "modalProps">) {
    openModal(modalProps => <UpdateAvailableModal {...options} modalProps={modalProps} />);
}
