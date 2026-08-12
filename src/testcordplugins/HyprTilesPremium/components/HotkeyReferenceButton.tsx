/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { HeaderBarButton } from "@api/HeaderBar";
import { useSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { classNameFactory } from "@utils/css";
import { Popout, React, useState } from "@webpack/common";

import { settings } from "../settings";
import { actionLabels, getKeybindSettingKey, hotkeySections, HyprTilesAction } from "../utils/keybinds";

const cl = classNameFactory("vc-hyprtiles-");

function KeyboardIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" {...props}>
            <path d="M20 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zM8 11H6V9h2v2zm0 4H6v-2h2v2zm4-4h-2V9h2v2zm0 4h-2v-2h2v2zm4-4h-2V9h2v2zm4 4h-6v-2h6v2zm0-4h-2V9h2v2z" />
        </svg>
    );
}

function getKeybindForAction(action: HyprTilesAction): string {
    const settingKey = getKeybindSettingKey(action);
    return settings.store[settingKey] ?? "";
}

function HotkeyPopoutContent() {
    return (
        <div className={cl("hotkey-popout")}>
            <div className={cl("hotkey-popout-scroller")}>
                {hotkeySections.map(section => (
                    <div key={section.label} className={cl("hotkey-section")}>
                        <div className={cl("hotkey-section-label")}>{section.label}</div>
                        {section.actions.map(action => {
                            const bind = getKeybindForAction(action);
                            if (!bind) return null;
                            return (
                                <div key={action} className={cl("hotkey-row")}>
                                    <span className={cl("hotkey-kbd")}>{bind}</span>
                                    <span className={cl("hotkey-name")}>{actionLabels[action]}</span>
                                </div>
                            );
                        })}
                    </div>
                ))}
            </div>
        </div>
    );
}

function HotkeyReferenceButtonInner() {
    const hyprTilesSettings = useSettings(["plugins.HyprTiles.showHotkeyButton"]).plugins.HyprTiles;
    const { showHotkeyButton } = hyprTilesSettings;
    const [isOpen, setIsOpen] = useState(false);
    const buttonRef = React.useRef<HTMLDivElement>(null);

    if (!showHotkeyButton) return null;

    return (
        <Popout
            position="bottom"
            align="right"
            spacing={8}
            animation={Popout.Animation.NONE}
            shouldShow={isOpen}
            onRequestClose={() => setIsOpen(false)}
            targetElementRef={buttonRef}
            renderPopout={() => (
                <ErrorBoundary noop>
                    <HotkeyPopoutContent />
                </ErrorBoundary>
            )}
        >
            {(_, { isShown }) => (
                <HeaderBarButton
                    ref={buttonRef}
                    icon={KeyboardIcon}
                    tooltip={isShown ? null : "HyprTiles Keybinds"}
                    selected={isShown}
                    onClick={() => setIsOpen(v => !v)}
                />
            )}
        </Popout>
    );
}

export const HotkeyReferenceButton = ErrorBoundary.wrap(HotkeyReferenceButtonInner, { noop: true });
