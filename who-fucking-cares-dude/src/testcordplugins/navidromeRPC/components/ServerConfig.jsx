/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { relaunch } from "@utils/native";
import { Alerts, Button, Toasts } from "@webpack/common";
import { settings } from "..";
import { checkCSP, cl, navidromePassword } from "../utils/constants";
import { Input } from "./Input";
import { SettingsRow, SettingsSection } from "./SettingsSection";
export function ServerConfig() {
    const reactiveSettings = settings.use(["isLoggedIn"]);
    return <SettingsSection title="Login to Navidrome" className={cl("server-config-container")}>
        <SettingsRow>
            <Input placeholder="Host (http[s]://host:port)" initialValue={settings.store.serverURL} onChange={async (v) => {
            settings.store.serverURL = v;
        }} className={cl("text-field")} disabled={reactiveSettings.isLoggedIn}/>
        </SettingsRow>
        <SettingsRow>
            <Input placeholder="Username" initialValue={settings.store.username} onChange={async (v) => {
            settings.store.username = v;
        }} className={cl("text-field")} disabled={reactiveSettings.isLoggedIn}/>
            <Input placeholder="Password" initialValue={navidromePassword.get()} onChange={async (v) => {
            navidromePassword.set(v);
        }} className={cl("text-field")} password={true} disabled={reactiveSettings.isLoggedIn}/>
        </SettingsRow>
        <Button onClick={async () => {
            if (settings.store.isLoggedIn) {
                return settings.store.isLoggedIn = false;
            }
            let valid = true;
            if (!settings.store.serverURL || !settings.store.username || !navidromePassword.get())
                valid = false;
            if (settings.store.serverURL)
                try {
                    new URL(settings.store.serverURL);
                }
                catch {
                    valid = false;
                }
            if (!valid)
                return void Toasts.show(Toasts.create("Make sure that all fields are properly filled!", Toasts.Type.FAILURE));
            if (settings.store.serverURL && await checkCSP(settings.store.serverURL)) {
                settings.store.isLoggedIn = true;
            }
            else {
                Alerts.show({
                    title: "Whitelist Navidrome hostname",
                    body: `Vencord's security policy blocks external resources for safety reasons, including your Navidrome server. Once you close this alert
                    you will see a system dialog prompting you to allow access to your server and your client will restart.`.replaceAll("\n", ""),
                    async onCloseCallback() {
                        const overrideRequest = await VencordNative.csp.requestAddOverride(settings.store.serverURL, ["connect-src"], "NavidromeRPC");
                        if (overrideRequest === "ok") {
                            settings.store.isLoggedIn = true;
                            relaunch();
                        }
                    }
                });
            }
        }} color={reactiveSettings.isLoggedIn ? Button.Colors.RED : Button.Colors.BRAND}>Sign {reactiveSettings.isLoggedIn ? "out" : "in"}</Button>
    </SettingsSection>;
}
