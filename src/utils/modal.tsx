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

import type { ModalProps, RenderModalProps } from "@vencord/discord-types";
import { filters, findComponentByCodeLazy, mapMangledModuleLazy } from "@webpack";
import { closeAllModals, closeModal, openMediaModal, openModal, openModalLazy } from "@webpack/common";

import { LazyComponent } from "./react";

/** @deprecated Migrate to new Modals */
export const enum ModalSize {
    SMALL = "small",
    MEDIUM = "medium",
    LARGE = "large",
    DYNAMIC = "dynamic",
}

/** @deprecated Migrate to new Modals */
export const Modals = mapMangledModuleLazy(".MODAL_ROOT_LEGACY,", {
    ModalRoot: filters.componentByCode('.MODAL,"aria-labelledby":'),
    ModalHeader: filters.componentByCode(",id:"),
    ModalContent: filters.componentByCode("scrollbarType:"),
    ModalFooter: filters.componentByCode(".HORIZONTAL_REVERSE,"),
    ModalCloseButton: filters.componentByCode(".withCircleBackground")
}) as never;

/** @deprecated Migrate to new Modals */
export const ModalRoot = LazyComponent(() => (Modals as any).ModalRoot) as any;
/** @deprecated Migrate to new Modals */
export const ModalHeader = LazyComponent(() => (Modals as any).ModalHeader) as any;
/** @deprecated Migrate to new Modals */
export const ModalContent = LazyComponent(() => (Modals as any).ModalContent) as any;
/** @deprecated Migrate to new Modals */
export const ModalFooter = LazyComponent(() => (Modals as any).ModalFooter) as any;
const DiscordCloseButton = findComponentByCodeLazy("CLOSE_BUTTON_LABEL");

export function CloseButton(props: { onClick?: () => void; className?: string; style?: any; [key: string]: any; }) {
    const Component = DiscordCloseButton as any;
    if (Component && typeof Component === "function") {
        try {
            const res = Component(props);
            if (res) return res;
        } catch {}
    }
    const { onClick, className, style, ...rest } = props;
    return (
        <button
            type="button"
            aria-label="Close"
            className={className}
            onClick={onClick}
            style={style}
            {...rest}
        >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" role="img">
                <path
                    fill="currentColor"
                    d="M17.3 18.7a1 1 0 0 0 1.4-1.4L13.42 12l5.3-5.3a1 1 0 0 0-1.42-1.4L12 10.58l-5.3-5.3a1 1 0 0 0-1.4 1.42L10.58 12l-5.3 5.3a1 1 0 1 0 1.42 1.4L12 13.42l5.3 5.3Z"
                />
            </svg>
        </button>
    );
}

/** @deprecated Migrate to new Modals */
export const ModalCloseButton = CloseButton;

/** @deprecated Migrate to new Modals */
export const ModalAPI = {
    openModal,
    openModalLazy,
    closeModal,
    closeAllModals
} as any;

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
    openModalLazy
};

export type { ModalProps, RenderModalProps };
