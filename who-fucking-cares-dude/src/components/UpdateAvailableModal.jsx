/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import "./UpdateAvailableModal.css";
import { Button } from "@components/Button";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, openModal } from "@utils/modal";
const UPDATE_ICON = "https://cdn.discordapp.com/icons/1434211283317690502/f560c2b05d0def74e4e631eaffd65c2f.webp?size=1024";
function UpdateAvailableModal({ commits, modalProps, onConfirm, onUpdate, title, confirmText, updateText = "Update" }) {
    return (<ModalRoot {...modalProps} className="vc-update-modal-root" size={"medium" /* ModalSize.MEDIUM */}>
            <ModalHeader className="vc-update-modal-header" separator={false}>
                <img className="vc-update-modal-icon" src={UPDATE_ICON} alt=""/>
                <div className="vc-update-modal-heading">
                    <h2 className="vc-update-modal-title">{title}</h2>
                </div>
                <ModalCloseButton className="vc-update-modal-close" onClick={modalProps.onClose}/>
            </ModalHeader>
            <ModalContent className="vc-update-modal-content">
                <p className="vc-update-modal-commits-title">New commits</p>
                {commits.length > 0 ? (<ul className="vc-update-modal-commits">
                        {commits.map(commit => (<li className="vc-update-modal-commit" key={commit.hash}>
                                <span className="vc-update-modal-commit-hash">{commit.hash.slice(0, 7)}</span>
                                <div className="vc-update-modal-commit-body">
                                    <p className="vc-update-modal-commit-message">{commit.message}</p>
                                    <div className="vc-update-modal-commit-meta">{commit.author}</div>
                                </div>
                            </li>))}
                    </ul>) : (<p className="vc-update-modal-empty">No commit details were returned for this update.</p>)}
            </ModalContent>
            <ModalFooter className="vc-update-modal-footer">
                {onUpdate && (<Button onClick={() => {
                modalProps.onClose();
                onUpdate();
            }}>
                        {updateText}
                    </Button>)}
                <Button variant="secondary" onClick={() => {
            modalProps.onClose();
            onConfirm();
        }}>
                    {confirmText}
                </Button>
            </ModalFooter>
        </ModalRoot>);
}
export function openUpdateAvailableModal(options) {
    openModal(modalProps => <UpdateAvailableModal {...options} modalProps={modalProps}/>);
}
