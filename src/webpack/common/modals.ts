/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as t from "@vencord/discord-types";
import { filters, findByCodeLazy, mapMangledModuleLazy } from "@webpack";

/**
 * Discord no longer exports these two under those names. As of build 621784 no module
 * exports `Modal` or `ConfirmModal` at all, so `findExportedComponentLazy` handed back a
 * proxy that resolved to nothing and every modal rendered as a bare backdrop - a dimmed
 * screen with no dialog, and no error anywhere to explain it.
 *
 * Both components are still there, so find them by code instead. The anchors are upstream's
 * (Vendicated, 90aea0ddb) and are kept verbatim rather than forked, so they keep getting
 * maintained when Discord drifts again.
 *
 * `data-mana-component":"layer-modal"` is deliberately *not* used here: that is the
 * user-settings layer, which has no `title` prop at all.
 */
export const Modal: t.Modal = findByCodeLazy("leadingLayout:", "actions:", ".message");
export const ConfirmModal: t.ConfirmModal = findByCodeLazy("actionBarInput:", '"critical"', '"secondary');

// Modal key: "Media Viewer Modal"
export const openMediaModal: (props: t.MediaModalProps) => void = findByCodeLazy("hasMediaOptions", "shouldHideMediaOptions");

const ModalAPI: t.ModalAPI = mapMangledModuleLazy(".modalKey?", {
    openModalLazy: filters.byCode(".modalKey?"),
    openModal: filters.byCode(",instant:"),
    closeModal: filters.byCode(".onCloseCallback()"),
    closeAllModals: filters.byCode(".getState();for")
});

export const { openModalLazy, openModal, closeModal, closeAllModals } = ModalAPI;
