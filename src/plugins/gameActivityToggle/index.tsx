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

import { isPluginEnabled } from "@api/PluginManager";
import { definePluginSettings } from "@api/Settings";
import { UserAreaRenderProps } from "@api/UserArea";
import { getUserSettingLazy } from "@api/UserSettings";
import testcordToolbox from "@testcordplugins/testcordToolbox";
import { Devs, TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy, findComponentByCodeLazy } from "@webpack";
import { ConnectedAccountsStore, Menu, Popout, useRef, useState, useStateFromStores } from "@webpack/common";

const Button = findComponentByCodeLazy(".GREEN,positionKeyStemOverride:");
const ConnectedAccountActions = findByPropsLazy("setShowActivity");

const ShowCurrentGame = getUserSettingLazy<boolean>("status", "showCurrentGame")!;

const settings = definePluginSettings({
    oldIcon: {
        type: OptionType.BOOLEAN,
        description: "Use the old icon style before Discord icon redesign",
        default: false
    },
    oldLogic: {
        type: OptionType.BOOLEAN,
        description: "Use the old state styling (red glow and red icon when game activity is off)",
        default: false
    },
    location: {
        type: OptionType.SELECT,
        description: "Where to show the game activity toggle button",
        options: [
            { label: "Next to Mute/Deafen", value: "PANEL", default: true },
            { label: "Equicord Toolbox", value: "TOOLBOX" }
        ],
        get hidden() {
            return !isPluginEnabled(testcordToolbox.name);
        }
    }
});

function Icon({ className }: { className?: string; }) {
    const { oldIcon } = settings.use(["oldIcon"]);
    const showCurrentGame = ShowCurrentGame.useSetting();
    const lineLength = 30;
    const lineStyle: React.CSSProperties = {
        strokeDasharray: lineLength,
        strokeDashoffset: showCurrentGame ? lineLength : 0,
        transition: "stroke-dashoffset 0.1s ease-in-out",
    };

    return (
        <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <mask id="gameActivityLine">
                <rect width="100%" height="100%" fill="#ffffff" />
                <line
                    className="blackLine"
                    x1="22"
                    y1="2"
                    x2="2"
                    y2="22"
                    stroke="#000000"
                    strokeWidth="6"
                    strokeLinecap="round"
                    style={lineStyle}
                />
            </mask>

            <path
                fill={!showCurrentGame && !oldIcon ? "var(--status-danger)" : "currentColor"}
                mask="url(#gameActivityLine)"
                d="M3.06 20.4q-1.53 0-2.37-1.065T.06 16.74l1.26-9q.27-1.8 1.605-2.97T6.06 3.6h11.88q1.8 0 3.135 1.17t1.605 2.97l1.26 9q.21 1.53-.63 2.595T20.94 20.4q-.63 0-1.17-.225T18.78 19.5l-2.7-2.7H7.92l-2.7 2.7q-.45.45-.99.675t-1.17.225Zm14.94-7.2q.51 0 .855-.345T19.2 12q0-.51-.345-.855T18 10.8q-.51 0-.855.345T16.8 12q0 .51.345 .855T18 13.2Zm-2.4-3.6q.51 0 .855-.345T16.8 8.4q0-.51-.345-.855T15.6 7.2q-.51 0-.855.345T14.4 8.4q0 .51.345 .855T15.6 9.6ZM6.9 13.2h1.8v-2.1h2.1v-1.8h-2.1v-2.1h-1.8v2.1h-2.1v1.8h2.1v2.1Z"
            />

            <line
                x1="22"
                y1="2"
                x2="2"
                y2="22"
                stroke="var(--status-danger, currentColor)"
                strokeWidth="2"
                strokeLinecap="round"
                style={lineStyle}
            />
        </svg>
    );
}

function GameActivityToggleButton({ iconForeground, hideTooltips, nameplate }: UserAreaRenderProps) {
    const { location } = settings.use(["location"]);
    const showCurrentGame = ShowCurrentGame.useSetting();

const connectedAccounts = useStateFromStores([ConnectedAccountsStore], () => ConnectedAccountsStore.getAccounts());
    const spotifyAccounts = connectedAccounts.filter(account => account.type === "spotify" && !account.revoked);
    // The update is an API request which takes a bit to update the store, so keep local overrides to reflect changes immediately
    const [spotifyActivityOverrides, setSpotifyActivityOverrides] = useState<Record<string, boolean>>({});

    const buttonRef = useRef<HTMLButtonElement | null>(null);

    if (location !== "PANEL" && isPluginEnabled(testcordToolbox.name)) return null;

    const buttonProps = {
        tooltipText: hideTooltips ? void 0 : showCurrentGame ? "Disable Game Activity" : "Enable Game Activity",
        icon: Icon,
        role: "switch",
        ariaChecked: !showCurrentGame,
        redGlow: !showCurrentGame,
        plated: nameplate != null,
        onClick: () => ShowCurrentGame.updateSetting(old => !old)
    };

    if (spotifyAccounts.length === 0)
        return <Button {...buttonProps} />;

    return (
        <Popout
            position="top"
            align="left"
            targetElementRef={buttonRef}
            renderPopout={({ closePopout }) => (
                <Menu.Menu navId="vc-gameActivityToggle-menu" onClose={closePopout}>
                    {spotifyAccounts.map(account => {
                        const checked = spotifyActivityOverrides[account.id] ?? account.showActivity;

                        return (
                            <Menu.MenuCheckboxItem
                                key={account.id}
                                id={`vc-toggle-spotify-${account.id}`}
                                label={spotifyAccounts.length === 1 ? "Share Spotify Activity" : `Share Spotify Activity (${account.name})`}
                                checked={checked}
                                action={() => {
                                    ConnectedAccountActions.setShowActivity(account.type, account.id, !checked);
                                    setSpotifyActivityOverrides(current => ({ ...current, [account.id]: !checked }));
                                }}
                            />
                        );
                    })}
                </Menu.Menu>
            )}
        >
            {popoutProps => (
                <Button
                    ref={buttonRef}
                    onContextMenu={popoutProps.onClick}
                    {...buttonProps}
                />
            )}
        </Popout>
    );
}

export default definePlugin({
    name: "GameActivityToggle",
    description: "Adds a button next to the mic and deafen button to toggle game activity.",
    tags: ["Activity", "Shortcuts"],
    authors: [Devs.Nuckyz, Devs.RuukuLada, TestcordDevs.sirphantom89],
    dependencies: ["UserSettingsAPI", "UserAreaAPI"],
    settings,

    userAreaButton: {
        icon: Icon,
        render: GameActivityToggleButton
    },

    toolboxActions() {
        const { location } = settings.store;
        const showCurrentGame = ShowCurrentGame.getSetting();

        if (location !== "TOOLBOX") return null;

        return (
            <Menu.MenuCheckboxItem
                id="game-activity-toggle-toolbox"
                label="Enable Game Activity"
                checked={showCurrentGame}
                action={() => ShowCurrentGame.updateSetting(old => !old)}
            />
        );
    },
});
