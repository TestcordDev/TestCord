/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { filters, findByCodeLazy, findExportedComponentLazy, mapMangledModuleLazy } from "@webpack";
export const Modal = findExportedComponentLazy("Modal");
export const ConfirmModal = findExportedComponentLazy("ConfirmModal");
// Modal key: "Media Viewer Modal"
export const openMediaModal = findByCodeLazy("hasMediaOptions", "shouldHideMediaOptions");
const ModalAPI = mapMangledModuleLazy(".modalKey?", {
    openModalLazy: filters.byCode(".modalKey?"),
    openModal: filters.byCode(",instant:"),
    closeModal: filters.byCode(".onCloseCallback()"),
    closeAllModals: filters.byCode(".getState();for")
});
export const { openModalLazy, openModal, closeModal, closeAllModals } = ModalAPI;
