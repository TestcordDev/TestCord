/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
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

import "./styles.css";

import { HeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings, migratePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { Popout, useRef, useState } from "@webpack/common";

import { renderPopout } from "./menu";

export const settings = definePluginSettings({
    showPluginMenu: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Show the plugins menu in the toolbox",
    }
});

function Icon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 24 24" width={20} height={20} {...props}>
            <path fill="currentColor" d="M20 7h-4V4c0-1.1-.9-2-2-2h-4c-1.1 0-2 .9-2 2v3H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2zM10 4h4v3h-4V4zm10 16H4V9h16v11z"/>
            <path fill="currentColor" d="M11 12h2v2h-2zm-4 0h2v2H7zm8 0h2v2h-2zm-4 4h2v2h-2zm-4 0h2v2H7zm8 0h2v2h-2z"/>
        </svg>
    );
}

function VencordPopoutButton() {
    const buttonRef = useRef<HTMLSpanElement | null>(null);
    const [show, setShow] = useState(false);

    return (
        <span ref={buttonRef} style={{ display: "inline-flex", alignItems: "center" }}>
            <Popout
                position="bottom"
                align="center"
                spacing={0}
                animation={Popout.Animation.NONE}
                shouldShow={show}
                onRequestClose={() => setShow(false)}
                targetElementRef={buttonRef}
                renderPopout={() => renderPopout(() => setShow(false))}
            >
                {(_, { isShown }) => (
                    <HeaderBarButton
                        className="vc-toolbox-btn"
                        onClick={e => {
                            e.stopPropagation();
                            setShow(prev => !prev);
                        }}
                        tooltip="Testcord Toolbox"
                        icon={Icon}
                        selected={isShown}
                    />
                )}
            </Popout>
        </span>
    );
}

migratePluginSettings("TestcordToolbox", "EquicordToolbox");
export default definePlugin({
    name: "TestcordToolbox",
    description: "Adds a button next to the inbox button in the channel header that houses Testcord quick actions",
    tags: ["Voice", "Accessibility"],
    authors: [Devs.Ven, Devs.AutumnVN],
    dependencies: ["HeaderBarAPI"],
    settings,
    headerBarButton: {
        icon: Icon,
        render: VencordPopoutButton,
        priority: 1337
    }
});
