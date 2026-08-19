/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import { findComponentByCodeLazy } from "@webpack";
import { loadBadges } from "./utils";
const ManaSelect = findComponentByCodeLazy('"data-mana-component":"select"');
const badgeOptions = [
    { label: "BadgeVault", value: "showCustom" },
    { label: "Nekocord", value: "showNekocord" },
    { label: "ReviewDB", value: "showReviewDB" },
    { label: "Aero", value: "showAero" },
    { label: "Aliucord", value: "showAliucord" },
    { label: "Raincord", value: "showRaincord" },
    { label: "Velocity", value: "showVelocity" },
    { label: "Enmity", value: "showEnmity" },
    { label: "Paicord", value: "showPaicord" },
    { label: "Bunny", value: "showBunny" },
    { label: "GooseMod", value: "showGooseMod" },
    { label: "Replugged", value: "showReplugged" },
    { label: "BetterDiscord", value: "showBetterDiscord" },
    { label: "Vendroid Enhanced", value: "showVendroidEnhanced" },
    { label: "Revenge", value: "showRevenge" },
    { label: "ReCord", value: "showReCord" }
];
const badgeManaOptions = badgeOptions.map(opt => ({ ...opt, id: opt.value }));
function ShowXSettings() {
    const currentSettings = settings.use(badgeOptions.map(o => o.value));
    const selectedValues = badgeOptions.filter(o => currentSettings[o.value]).map(o => o.value);
    async function updateSelection(value) {
        const selectedKeys = new Set(Array.isArray(value) ? value : value ? [value] : []);
        for (const o of badgeOptions) {
            settings.store[o.value] = selectedKeys.has(o.value);
        }
        await loadBadges();
    }
    return (<ManaSelect label="Specific Client Mods" options={badgeManaOptions} value={selectedValues} closeOnSelect={false} maxOptionsVisible={7} selectionMode="multiple" wrapTags={true} onSelectionChange={updateSelection}/>);
}
export const settings = definePluginSettings({
    showModStyle: {
        type: 4 /* OptionType.SELECT */,
        description: "Mod Style",
        default: "none",
        options: [
            { label: "Don't Show Mod", value: "none" },
            { label: "Show Mod as Prefix", value: "prefix" },
            { label: "Show Mod as Suffix", value: "suffix" },
        ]
    },
    apiUrl: {
        type: 0 /* OptionType.STRING */,
        description: "API to use",
        default: "https://badges.equicord.org/",
        restartNeeded: false,
        isValid: (value => {
            if (!value)
                return false;
            return true;
        })
    },
    showClientMods: {
        type: 6 /* OptionType.COMPONENT */,
        component: ShowXSettings,
    },
    showCustom: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show Custom Badges",
        default: true,
        restartNeeded: false,
        hidden: true
    },
    showNekocord: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show Nekocord Badges",
        default: true,
        restartNeeded: false,
        hidden: true
    },
    showReviewDB: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show ReviewDB Badges",
        default: true,
        restartNeeded: false,
        hidden: true
    },
    showAero: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show Aero Badges",
        default: true,
        restartNeeded: false,
        hidden: true
    },
    showAliucord: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show Aliucord Badges",
        default: true,
        restartNeeded: false,
        hidden: true
    },
    showRaincord: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show Raincord Badges",
        default: true,
        restartNeeded: false,
        hidden: true
    },
    showVelocity: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show Velocity Badges",
        default: true,
        restartNeeded: false,
        hidden: true
    },
    showEnmity: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show Enmity Badges",
        default: true,
        restartNeeded: false,
        hidden: true
    },
    showPaicord: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show Paicord Badges",
        default: true,
        restartNeeded: false,
        hidden: true
    },
    showBunny: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show Bunny Badges",
        default: true,
        restartNeeded: false,
        hidden: true
    },
    showGooseMod: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show GooseMod Badges",
        default: true,
        restartNeeded: false,
        hidden: true
    },
    showReplugged: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show Replugged Badges",
        default: true,
        restartNeeded: false,
        hidden: true
    },
    showBetterDiscord: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show BetterDiscord Badges",
        default: true,
        restartNeeded: false,
        hidden: true
    },
    showVendroidEnhanced: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show Vendroid Enhanced Badges",
        default: true,
        restartNeeded: false,
        hidden: true
    },
    showRevenge: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show Revenge Badges",
        default: true,
        restartNeeded: false,
        hidden: true
    },
    showReCord: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show ReCord Badges",
        default: true,
        restartNeeded: false,
        hidden: true
    }
});
