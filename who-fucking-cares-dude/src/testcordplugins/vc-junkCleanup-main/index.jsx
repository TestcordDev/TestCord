/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import { Link } from "@components/Link";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { Forms } from "@webpack/common";
import Patches from "./patches";
export const ParsedPatches = Object.entries(Patches).map(([patchName, { description, default: defaultValue, patches }]) => {
    return {
        name: patchName,
        setting: {
            type: 3 /* OptionType.BOOLEAN */,
            description,
            default: !!(defaultValue ?? true),
            restartNeeded: true
        },
        patches: (Array.isArray(patches) ? patches : [patches]).map(p => ({
            ...p,
            predicate: () => ((p?.predicate ?? (() => true))() && settings.store[patchName]) || settings.store.enableAllPatches
        })),
    };
});
const settings = definePluginSettings(Object.fromEntries([
    ...ParsedPatches.map(p => [p.name, p.setting]),
    ["enableAllPatches", {
            type: 3 /* OptionType.BOOLEAN */,
            description: "Enable all patches (intended for testing)",
            default: false,
            restartNeeded: true
        }]
]));
export default definePlugin({
    name: "JunkCleanup",
    description: "Another plugin that cleans up common annoyances in Discord",
    authors: [Devs.Sqaaakoi],
    settings,
    patches: ParsedPatches.flatMap(p => p.patches),
    tags: ["Utility", "Developers"],
    settingsAboutComponent: () => {
        return <div>
            <Forms.FormTitle>Total patch count: {ParsedPatches.length}</Forms.FormTitle>
            <Forms.FormTitle style={{ marginBottom: 0 }}><Link href="https://github.com/Sqaaakoi/vc-junkCleanup">View repository on GitHub</Link></Forms.FormTitle>
        </div>;
    }
});
