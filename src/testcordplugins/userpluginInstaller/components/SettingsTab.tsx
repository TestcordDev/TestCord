/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 nin0
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BaseText } from "@components/BaseText";
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { CheckedTextInput } from "@components/CheckedTextInput";
import { HeadingTertiary } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { SettingsTab as STab, wrapTab } from "@components/settings/tabs/BaseTab";
import { PluginCard } from "@components/settings/tabs/plugins/PluginCard";
import { classes, isObjectEmpty } from "@utils/misc";
import { relaunch } from "@utils/native";
import { Alerts, Toasts, useEffect, useState } from "@webpack/common";

import userpluginInstaller, { Native } from "..";
import { cl, CLONE_LINK_REGEX, showInstallFinishedAlert } from "../misc/constants";

function UserPluginsTab() {
    const [pluginsLoaded, loadPlugins] = useState(false);
    const [plugins, setPlugins] = useState<{
        name: string;
        description: string;
        usesPreSend: boolean;
        usesNative: boolean;
        directory?: string;
        remote: string;
    }[]>([]);
    const [url, setUrl] = useState("");
    const [valid, setValid] = useState(false);
    const [pluginsWithUpdates, setPluginsWithUpdates] = useState<Record<string, string>>({});
    const [updatesLoaded, loadUpdates] = useState(false);

    useEffect(() => {
        const { plugins: plgobj, pluginsWithUpdates: pwug } = userpluginInstaller;
        setPlugins(plgobj.value());
        loadPlugins(true);
        const cid2 = plgobj.registerCallback(value => setPlugins(value));

        const setPWU = (value: { finished: boolean; plugins: string[] }) => {
            const pwu = (value?.plugins || []).map(pg => ({
                [pg]: plgobj.value().find(pfjh => pfjh.directory === pg)?.name
            }));
            setPluginsWithUpdates(Object.assign({}, ...pwu));
            loadUpdates(Boolean(value?.finished));
        };
        const cid = pwug.registerCallback(value => {
            setPWU(value);
        });
        setPWU(pwug.value());

        return () => {
            pwug.deregisterCallback(cid);
            plgobj.deregisterCallback(cid2);
        };
    }, []);

    const enabledCount = plugins.filter(p => Boolean((Vencord as any)?.Settings?.plugins?.[p.name]?.enabled)).length;

    return (
        <STab {...{ title: `UserPlugins${pluginsLoaded ? ` (${plugins.length}, ${enabledCount} enabled)` : ""}` } as any as React.PropsWithChildren<{ title: string }>}>
            <div className={cl("update-check-container")}>
                {
                    isObjectEmpty(pluginsWithUpdates) ? (!updatesLoaded && <BaseText>Checking for updates...</BaseText>) : <Card className={classes(cl("info-card"), "vc-warning-card")}>
                        <HeadingTertiary className={cl("install-title")}>Plugin Updates Available</HeadingTertiary>
                        <Paragraph className={cl("install-desc")}>
                            The following plugins are out-of-date:
                            <ul className={cl("outdated-list")}>
                                {
                                    Object.values(pluginsWithUpdates).toSorted().map(pl => <li key={pl}>{pl}</li>)
                                }
                            </ul>
                            {
                                !updatesLoaded && "and possibly more, as update checking is not finished. "
                            }
                            You can update plugins below.
                        </Paragraph>
                    </Card>
                }
            </div>
            <Card className={cl("info-card")}>
                <HeadingTertiary className={cl("install-title")}>Install Plugin</HeadingTertiary>
                <Paragraph className={cl("install-desc")}>You can install a plugin from GitHub, GitLab, Codeberg, git.nin0.dev, or plugins.nin0.dev by pasting its clone URL here.</Paragraph>
                <div className={cl("install-field")}>
                    <CheckedTextInput {...{
                        onChange: (t: string) => setUrl(t),
                        validate: (t: string) => {
                            const match = t.match(CLONE_LINK_REGEX);
                            if (match) {
                                const idpl = match.includes("plugins.nin0.dev") ? 1 : 0;
                                const installed = plugins.map(p => p.directory).includes(match[[3, 6][idpl]]);
                                if (installed) {
                                    setValid(false);
                                    return "Plugin already installed, update below";
                                }
                                setValid(true);
                                return true;
                            }
                            else {
                                setValid(false);
                                return "Invalid URL, read the notice above";
                            }
                        },
                        value: url
                    } as any} />
                </div>
                <div className={cl("button-container")}>
                    <Button disabled={!valid} className={cl("install-button")} onClick={async () => {
                        const gitLink = url.match(CLONE_LINK_REGEX);
                        if (!gitLink) return;
                        const idpl = gitLink.includes("plugins.nin0.dev") ? 1 : 0;
                        try {
                            const res = await Native.initPluginInstall(gitLink[0], gitLink[[1, 4][idpl]], gitLink[[2, 5][idpl]], gitLink[[3, 6][idpl]]);
                            const { name, native } = JSON.parse(res);
                            showInstallFinishedAlert(name, native);
                        }
                        catch (e: any) {
                            if (e?.message?.includes?.("silentStop") || String(e).includes("silentStop")) return;
                            Alerts.show({
                                title: "Install error",
                                body: e?.message || String(e)
                            });
                        }
                    }}>
                        Install
                    </Button>
                </div>
            </Card>
            <div className={cl("plugins-container")}>
                {
                    pluginsLoaded ? <div className={cl("plugins-grid")}>
                        {
                            plugins.toSorted((a, b) => a.name.localeCompare(b.name, "en", {
                                sensitivity: "base"
                            })).toSorted((a, b) => {
                                const updatePendingNames = Object.keys(pluginsWithUpdates);
                                const [aa, bb] = [updatePendingNames.includes(a.directory!) ? 1000 : 0, updatePendingNames.includes(b.directory!) ? 1000 : 0];
                                return bb - aa;
                            }).map(plugin => {
                                const pl = Vencord.Plugins.plugins[plugin.name] || {
                                    name: plugin.name,
                                    description: plugin.description || "User plugin",
                                    authors: [],
                                    tags: ["UserPlugin"]
                                } as any;

                                const footer = (
                                    <div className={cl("plugin-footer")}>
                                        {
                                            Object.keys(pluginsWithUpdates).includes(plugin.directory!) && <Button size="small" onClick={async () => {
                                                try {
                                                    await Native.updatePlugin(plugin.directory!);
                                                    const oldPWU = userpluginInstaller.pluginsWithUpdates.value().plugins;
                                                    oldPWU.splice(oldPWU.indexOf(plugin.directory!), 1);
                                                    userpluginInstaller.pluginsWithUpdates.value({
                                                        finished: true,
                                                        plugins: oldPWU
                                                    });
                                                    Alerts.show({
                                                        title: "Done!",
                                                        body: `${plugin.name} has been updated. A ${plugin.usesNative ? "restart" : "refresh"} is needed to apply the update.`,
                                                        confirmText: plugin.usesNative ? "Restart" : "Refresh",
                                                        cancelText: "Later",
                                                        onConfirm() {
                                                            plugin.usesNative ? relaunch() : window.location.reload();
                                                        }
                                                    });
                                                }
                                                catch (e: any) {
                                                    if (e?.message?.includes?.("silentStop") || String(e).includes("silentStop")) return;
                                                    Alerts.show({
                                                        title: "Update error",
                                                        body: e?.message || String(e)
                                                    });
                                                }
                                            }}>
                                                Update
                                            </Button>
                                        }
                                        <Button variant="secondary" size="small" disabled={!plugin.remote} onClick={() => VencordNative.native.openExternal(plugin.remote)}>
                                            Source
                                        </Button>
                                        <Button variant="dangerSecondary" size="small" onClick={async () => {
                                            try {
                                                await Native.rmPlugin(plugin.directory!);
                                                Alerts.show({
                                                    title: "Done!",
                                                    body: `${plugin.name} has been uninstalled. A ${plugin.usesNative ? "restart" : "refresh"} is needed to fully remove the plugin.`,
                                                    confirmText: plugin.usesNative ? "Restart" : "Refresh",
                                                    cancelText: "Later",
                                                    onConfirm() {
                                                        plugin.usesNative ? relaunch() : window.location.reload();
                                                    }
                                                });
                                            } catch (e: any) {
                                                Alerts.show({
                                                    title: "Uninstall error",
                                                    body: e?.message || String(e)
                                                });
                                            }
                                        }}>
                                            Uninstall
                                        </Button>
                                    </div>
                                );

                                try {
                                    const ReworkedAddonCard = PluginCard({
                                        plugin: pl,
                                        disabled: false,
                                        onRestartNeeded() {
                                            Toasts.show({
                                                id: Toasts.genId(),
                                                type: Toasts.Type.MESSAGE,
                                                message: "Restart to apply changes!"
                                            });
                                        }
                                    });
                                    if (ReworkedAddonCard && ReworkedAddonCard.props) {
                                        ReworkedAddonCard.props.footer = footer;
                                    }
                                    return ReworkedAddonCard;
                                } catch {
                                    return (
                                        <Card key={plugin.name} className={cl("info-card")}>
                                            <HeadingTertiary>{plugin.name}</HeadingTertiary>
                                            <Paragraph>{plugin.description}</Paragraph>
                                            {footer}
                                        </Card>
                                    );
                                }
                            })
                        }
                    </div> : <BaseText>Loading plugins...</BaseText>
                }
            </div>
        </STab>
    );
}

export default wrapTab(UserPluginsTab, "UserPlugins");
