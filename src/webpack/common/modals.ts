/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as t from "@vencord/discord-types";
import { filters, findByCodeLazy, findComponentByCodeLazy, mapMangledModuleLazy } from "@webpack";

/**
 * Discord no longer exports these two under those names. As of build 621784 no module
 * exports `Modal` or `ConfirmModal` at all, so `findExportedComponentLazy` handed back a
 * proxy that resolved to nothing and every modal rendered as a bare backdrop - a dimmed
 * screen with no dialog, and no error anywhere to explain it.
 *
 * Both components are still there, so find them by code instead. These are the shapes we
 * depend on, verified against the live build:
 *
 * - `Modal` is the layout wrapper around the base modal: it takes `size` and renders
 *   `title`/`subtitle` through a header of its own, which is why it (and not the inner
 *   base modal) is the right target for a `title` prop.
 * - `ConfirmModal` is built on that same layout and is the only thing combining
 *   `checkboxProps` with `onCloseCallback`, which is what distinguishes it from the
 *   unrelated confirm-shaped components that share the `critical-primary` variant string.
 *
 * `data-mana-component":"layer-modal"` is deliberately *not* used here: that is the
 * user-settings layer, which has no `title` prop at all.
 */
export const Modal: t.Modal = findComponentByCodeLazy("actionBarInputLayout");
export const ConfirmModal: t.ConfirmModal = findComponentByCodeLazy(/checkboxProps[\s\S]{0,300}onCloseCallback/);

// Modal key: "Media Viewer Modal"
export const openMediaModal: (props: t.MediaModalProps) => void = findByCodeLazy("hasMediaOptions", "shouldHideMediaOptions");

const ModalAPI: t.ModalAPI = mapMangledModuleLazy(".modalKey?", {
    openModalLazy: filters.byCode(".modalKey?"),
    openModal: filters.byCode(",instant:"),
    closeModal: filters.byCode(".onCloseCallback()"),
    closeAllModals: filters.byCode(".getState();for")
});

export const { openModalLazy, openModal, closeModal, closeAllModals } = ModalAPI;
