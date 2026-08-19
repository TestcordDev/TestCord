/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { NativeSettings } from "@main/settings";
import { dialog, ipcMain } from "electron";
import { CspPolicies, ImageAndCssSrc } from ".";
export function registerCspIpcHandlers() {
    ipcMain.handle("VencordCspRemoveOverride" /* IpcEvents.CSP_REMOVE_OVERRIDE */, removeCspRule);
    ipcMain.handle("VencordCspRequestAddOverride" /* IpcEvents.CSP_REQUEST_ADD_OVERRIDE */, addCspRule);
    ipcMain.handle("VencordCspIsDomainAllowed" /* IpcEvents.CSP_IS_DOMAIN_ALLOWED */, isDomainAllowed);
}
function validate(url, directives) {
    try {
        const { host } = new URL(url);
        if (/[;'"\\]/.test(host))
            return false;
    }
    catch {
        return false;
    }
    if (directives.length === 0)
        return false;
    if (directives.some(d => !ImageAndCssSrc.includes(d)))
        return false;
    return true;
}
function getMessage(url, directives, callerName) {
    const domain = new URL(url).host;
    const message = `${callerName} wants to allow connections to ${domain}`;
    let detail = `Unless you recognise and fully trust ${domain}, you should cancel this request!\n\n` +
        `You will have to fully close and restart ${IS_DISCORD_DESKTOP ? "Discord" : "Vesktop"} for the changes to take effect.`;
    if (directives.length === 1 && directives[0] === "connect-src") {
        return { message, detail };
    }
    const contentTypes = directives
        .filter(type => type !== "connect-src")
        .map(type => {
        switch (type) {
            case "img-src":
                return "Images";
            case "style-src":
                return "CSS & Themes";
            case "font-src":
                return "Fonts";
            default:
                throw new Error(`Illegal CSP directive: ${type}`);
        }
    })
        .sort()
        .join(", ");
    detail = `The following types of content will be allowed to load from ${domain}:\n${contentTypes}\n\n${detail}`;
    return { message, detail };
}
async function addCspRule(_, url, directives, callerName) {
    if (!validate(url, directives)) {
        return "invalid";
    }
    const domain = new URL(url).host;
    if (domain in NativeSettings.store.customCspRules) {
        return "conflict";
    }
    const { checkboxChecked, response } = await dialog.showMessageBox({
        ...getMessage(url, directives, callerName),
        type: callerName ? "info" : "warning",
        title: "Testcord Host Permissions",
        buttons: ["Cancel", "Allow"],
        defaultId: 0,
        cancelId: 0,
        checkboxLabel: `I fully trust ${domain} and understand the risks of allowing connections to it.`,
        checkboxChecked: false,
    });
    if (response !== 1) {
        return "cancelled";
    }
    if (!checkboxChecked) {
        return "unchecked";
    }
    NativeSettings.store.customCspRules[domain] = directives;
    return "ok";
}
function removeCspRule(_, domain) {
    if (domain in NativeSettings.store.customCspRules) {
        delete NativeSettings.store.customCspRules[domain];
        return true;
    }
    return false;
}
function isDomainAllowed(_, url, directives) {
    try {
        const domain = new URL(url).host;
        const ruleForDomain = CspPolicies[domain] ?? NativeSettings.store.customCspRules[domain];
        if (!ruleForDomain)
            return false;
        return directives.every(d => ruleForDomain.includes(d));
    }
    catch (e) {
        return false;
    }
}
