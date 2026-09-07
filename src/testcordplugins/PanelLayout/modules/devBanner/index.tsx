/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { Button } from "@components/Button";
import { Heading } from "@components/Heading";
import { Devs, EquicordDevs, TestcordDevs } from "@utils/constants";
import { openModal, RenderModalProps } from "@utils/modal";
import { Modal, React } from "@webpack/common";

import { isModuleEnabled } from "../state";
import type { UserAreaModule } from "../types";
import { FormatSetting, makeDevBanner, settings } from "./components";

export function DevBannerWidget() {
    const content = makeDevBanner();
    return (
        <div
            className="vc-devbanner-module-widget"
            style={{
                padding: "4px 8px",
                fontSize: "11px",
                textAlign: "center",
                color: "var(--text-muted)",
                lineHeight: "1.4",
                userSelect: "text",
            }}
        >
            {content}
        </div>
    );
}

export function DevBannerSettingsModal({ modalProps, onClose }: { modalProps?: RenderModalProps; onClose?: () => void }) {
    const handleClose = () => (modalProps?.onClose ?? onClose)?.();

    return (
        <Modal title="Developer Banner Settings" {...modalProps!}>
            <div style={{ padding: "16px" }}>
                <FormatSetting
                    setValue={(newFormat: string) => {
                        settings.store.format = newFormat;
                    }}
                />
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "16px" }}>
                    <Button variant="primary" onClick={handleClose}>
                        Done
                    </Button>
                </div>
            </div>
        </Modal>
    );
}

export const devBannerPatches = [
    {
        find: '"isHideDevBanner"',
        predicate: () => isModuleEnabled("dev-banner"),
        replacement: [
            {
                match: '"staging"===window.GLOBAL_ENV.RELEASE_CHANNEL',
                replace: "true"
            },
            {
                match: /children:\[.{0,60}(?:#{intl::BUILD_OVERRIDE}|#{intl::uyrfYF::raw}).{0,40}\{\}\)\]/g,
                replace: "children:$self.makeDevBanner()"
            }
        ]
    }
];

export const devBannerModule: Omit<UserAreaModule, "order" | "enabled"> = {
    id: "dev-banner",
    name: "Developer Banner",
    description: "Displays Discord & Testcord build number, channel, commit hash, and client information.",
    authors: [EquicordDevs.KrystalSkull, Devs.thororen, TestcordDevs.sirphantom89],
    version: "1.0.0",
    tags: ["Developers", "Appearance"],
    icon: "🏷️",
    position: "above",
    render: DevBannerWidget,
    settingsComponent: DevBannerSettingsModal,
};

export { makeDevBanner, settings };
export * from "./components";
