/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/
import { filters, findComponentByCodeLazy, mapMangledModuleLazy } from "@webpack";
import { closeAllModals, closeModal, openMediaModal, openModal, openModalLazy } from "@webpack/common";
import { LazyComponent } from "./react";
/** @deprecated Migrate to new Modals */
export const Modals = mapMangledModuleLazy(".MODAL_ROOT_LEGACY,", {
    ModalRoot: filters.componentByCode('.MODAL,"aria-labelledby":'),
    ModalHeader: filters.componentByCode(",id:"),
    ModalContent: filters.componentByCode("scrollbarType:"),
    ModalFooter: filters.componentByCode(".HORIZONTAL_REVERSE,"),
    ModalCloseButton: filters.componentByCode(".withCircleBackground")
});
/** @deprecated Migrate to new Modals */
export const ModalRoot = LazyComponent(() => Modals.ModalRoot);
/** @deprecated Migrate to new Modals */
export const ModalHeader = LazyComponent(() => Modals.ModalHeader);
/** @deprecated Migrate to new Modals */
export const ModalContent = LazyComponent(() => Modals.ModalContent);
/** @deprecated Migrate to new Modals */
export const ModalFooter = LazyComponent(() => Modals.ModalFooter);
/** @deprecated Migrate to new Modals */
export const ModalCloseButton = LazyComponent(() => Modals.ModalCloseButton);
export const CloseButton = findComponentByCodeLazy("CLOSE_BUTTON_LABEL");
/** @deprecated Migrate to new Modals */
export const ModalAPI = {
    openModal,
    openModalLazy,
    closeModal,
    closeAllModals
};
export { 
/** @deprecated Migrate to new Modals */
closeAllModals, 
/** @deprecated Migrate to new Modals */
closeModal, 
/** @deprecated Migrate to new Modals */
openMediaModal, 
/** @deprecated Migrate to new Modals */
openModal, 
/** @deprecated Migrate to new Modals */
openModalLazy };
