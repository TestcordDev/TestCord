/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { FluxDispatcher, UserStore } from "@webpack/common";

const PresenceStore = findByPropsLazy("getStatus", "isMobileOnline", "getActivities");

const settings = definePluginSettings({
    freezeList: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Freeze the member list — stop it from jumping around when people change status.",
        onChange(val: boolean) {
            if (val) startFreeze();
            else stopFreeze();
        }
    },
    fakeAllOnline: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Make everyone appear as Online (green) in the member list.",
        onChange(val: boolean) {
            if (val) applyFakeOnline();
            else removeFakeOnline();
        }
    }
});

// ─── Fake online logic ────────────────────────────────────────────────────────

let _fakeOnlineActive = false;

const _suppressedTypes = new Set(["PRESENCES_REPLACE", "PASSIVE_UPDATE_V1"]);

function fakeOnlineInterceptor(payload: any) {
    if (_suppressedTypes.has(payload.type)) {
        return false;
    }
}

function applyFakeOnline() {
    if (_fakeOnlineActive) return;
    FluxDispatcher.addInterceptor(fakeOnlineInterceptor);
    _fakeOnlineActive = true;
    // Force re-render without sending a PRESENCES_REPLACE (which corrupts displayNameStyles)
    FluxDispatcher.dispatch({ type: "PRESENCE_UPDATES", updates: [] });
}

function removeFakeOnline() {
    if (!_fakeOnlineActive) return;
    (FluxDispatcher as any).removeInterceptor(fakeOnlineInterceptor);
    _fakeOnlineActive = false;
    FluxDispatcher.dispatch({ type: "PRESENCE_UPDATES", updates: [] });
}

// ─── Freeze logic — patch shouldComponentUpdate on the member list component ──

let _freezeActive = false;

function startFreeze() {
    _freezeActive = true;
}

function stopFreeze() {
    _freezeActive = false;
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export default definePlugin({
    name: "FreezePresence",
    description: "Stops the member list from jumping around when people change status, and optionally makes everyone appear online.",
    tags: ["Utility", "MemberList"],
    authors: [TestcordDevs.nnenaza],
    settings,

    patches: [
        {
            // Patch shouldComponentUpdate on the member list component
            find: "e.channel.id!==this.props.channel.id||e.version!==this.props.version",
            replacement: {
                match: /shouldComponentUpdate\((\i)\)\{return \i\.channel\.id!==this\.props\.channel\.id\|\|\i\.version!==this\.props\.version\|\|\i\.groups\.length!==this\.props\.groups\.length\}/,
                replace: "shouldComponentUpdate($1){if($self.isFrozen())return $1.channel.id!==this.props.channel.id||$1.rows!==this.props.rows;return $1.channel.id!==this.props.channel.id||$1.version!==this.props.version||$1.groups.length!==this.props.groups.length}"
            }
        },
        {
            // Patch getStatus to return "online" for everyone when fakeAllOnline is on
            // This covers offline users not in the presence store
            find: "isMobileOnline",
            replacement: {
                match: /return (E\[(\i)\])\?\?(\i);/,
                replace: "return $self.fakeOnlineStatus($2) ?? $1 ?? $3;"
            }
        },
        {
            // Patch getClientStatus too so the dot color matches
            find: "isMobileOnline",
            replacement: {
                match: /getClientStatus\((\i)\)\{return (\i)\[(\i)\]\}/,
                replace: 'getClientStatus($1){if($self.fakeOnlineStatus($1))return{desktop:"online"};return $2[$3]}'
            }
        }
    ],

    isFrozen(): boolean {
        return _freezeActive;
    },

    isFakeOnline(): boolean {
        return _fakeOnlineActive;
    },

    fakeOnlineStatus(userId: string): string | null {
        if (!_fakeOnlineActive) return null;
        if (userId === UserStore.getCurrentUser()?.id) return null;
        return "online";
    },

    start() {
        if (settings.store.freezeList) startFreeze();
        if (settings.store.fakeAllOnline) applyFakeOnline();
    },

    stop() {
        stopFreeze();
        removeFakeOnline();
    }
});
