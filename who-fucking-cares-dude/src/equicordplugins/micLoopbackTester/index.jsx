/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { UserAreaButton } from "@api/UserArea";
import { EquicordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { MediaEngineStore, React, UserStore, VoiceActions, VoiceStateStore } from "@webpack/common";
let loopbackActive = false;
let selfDeafenedByPlugin = false;
function isInVoiceChannel() {
    const id = UserStore.getCurrentUser()?.id;
    if (!id)
        return false;
    const state = VoiceStateStore.getVoiceStateForUser(id);
    return Boolean(state?.channelId);
}
async function enableLoopback() {
    try {
        await VoiceActions.setLoopback("mic_test", true);
        loopbackActive = true;
        if (isInVoiceChannel() && !MediaEngineStore.isSelfDeaf()) {
            await VoiceActions.toggleSelfDeaf();
            selfDeafenedByPlugin = true;
        }
        else {
            selfDeafenedByPlugin = false;
        }
        return true;
    }
    catch (e) {
        return false;
    }
}
async function disableLoopback() {
    try {
        await VoiceActions.setLoopback("mic_test", false);
        loopbackActive = false;
        if (selfDeafenedByPlugin && MediaEngineStore.isSelfDeaf()) {
            await VoiceActions.toggleSelfDeaf();
        }
        selfDeafenedByPlugin = false;
    }
    catch (e) { }
}
function MicLoopbackIcon({ active = false, className = "" }) {
    const lineLength = 30;
    const lineStyle = {
        strokeDasharray: lineLength,
        strokeDashoffset: active ? lineLength : 0,
        transition: "stroke-dashoffset 0.1s ease-in-out",
    };
    return (<svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <mask id="micLoopbackTesterLine">
                <rect width="100%" height="100%" fill="#ffffff"/>
                <line className="blackLine" x1="22" y1="2" x2="2" y2="22" stroke="#000000" strokeWidth="6" strokeLinecap="round" style={lineStyle}/>
            </mask>

            <g mask="url(#micLoopbackTesterLine)">
                <path fill={!active ? "var(--status-danger)" : "currentColor"} fillRule="evenodd" clipRule="evenodd" d="M12 3a1 1 0 0 0-1-1h-.06a1 1 0 0 0-.74.32L5.92 7H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2.92l4.28 4.68a1 1 0 0 0 .74.32H11a1 1 0 0 0 1-1V3ZM15.1 20.75c-.58.14-1.1-.33-1.1-.92v-.03c0-.5.37-.92.85-1.05a7 7 0 0 0 0-13.5A1.11 1.11 0 0 1 14 4.2v-.03c0-.6.52-1.06 1.1-.92a9 9 0 0 1 0 17.5Z"/>
                <path fill={!active ? "var(--status-danger)" : "currentColor"} fillRule="evenodd" clipRule="evenodd" d="M15.16 16.51c-.57.28-1.16-.2-1.16-.83v-.14c0-.43.28-.8.63-1.02a3 3 0 0 0 0-5.04c-.35-.23-.63-.6-.63-1.02v-.14c0-.63.59-1.1 1.16-.83a5 5 0 0 1 0 9.02Z"/>
            </g>

            <line x1="22" y1="2" x2="2" y2="22" stroke="var(--status-danger, currentColor)" strokeWidth="2" strokeLinecap="round" style={lineStyle}/>
        </svg>);
}
function MicLoopbackButton({ iconForeground, hideTooltips, nameplate }) {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);
    const handleToggle = React.useCallback(async () => {
        if (loopbackActive) {
            await disableLoopback();
        }
        else {
            await enableLoopback();
        }
        forceUpdate();
    }, []);
    return (<UserAreaButton className="button__201d5 wrapper__201d5" tooltipText={hideTooltips ? void 0 : "Mic Test Loopback"} icon={<MicLoopbackIcon active={loopbackActive} className={iconForeground}/>} role="switch" aria-checked={!loopbackActive} redGlow={!loopbackActive} plated={nameplate != null} onClick={handleToggle}/>);
}
const MicLoopbackUserAreaButton = props => <MicLoopbackButton {...props}/>;
export default definePlugin({
    name: "MicLoopbackTester",
    description: "Adds mic loopback test icon to the user panel",
    tags: ["Utility", "Voice"],
    authors: [EquicordDevs.benjii],
    dependencies: ["UserSettingsAPI", "UserAreaAPI"],
    userAreaButton: {
        icon: MicLoopbackIcon,
        render: MicLoopbackUserAreaButton
    },
    stop() {
        void disableLoopback();
        loopbackActive = false;
        selfDeafenedByPlugin = false;
    },
});
