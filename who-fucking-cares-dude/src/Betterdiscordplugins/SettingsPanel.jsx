/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Card } from "@components/Card";
import { Switch } from "@components/Switch";
import { Button, Forms, React } from "@webpack/common";
import { BDPluginManager } from "./PluginManager";
export function BDPluginsSettingsPanel() {
    const [plugins, setPlugins] = React.useState(BDPluginManager.getAllPlugins());
    const [refreshTrigger, setRefreshTrigger] = React.useState(0);
    const refreshPlugins = () => {
        setPlugins(BDPluginManager.getAllPlugins());
        setRefreshTrigger(p => p + 1);
    };
    const togglePlugin = (id) => {
        BDPluginManager.togglePlugin(id);
        refreshPlugins();
    };
    const reloadAll = () => {
        BDPluginManager.loadAllPlugins();
        refreshPlugins();
    };
    return (<div style={{ padding: "20px" }}>
            <Forms.FormTitle>BetterDiscord Plugins</Forms.FormTitle>
            <Forms.FormText>
                Manage your BetterDiscord .plugin.js files. Place plugin files in the Betterdiscordplugins folder.
            </Forms.FormText>

            <Card style={{ padding: "16px", marginTop: "16px" }}>
                <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
                    <Button onClick={reloadAll}>
                        Reload All Plugins
                    </Button>
                    <Button onClick={() => window.open("https://betterdiscord.app/plugins", "_blank")}>
                        Get More Plugins
                    </Button>
                </div>

                <Forms.FormTitle>Loaded Plugins ({plugins.length})</Forms.FormTitle>

                {plugins.length === 0 ? (<Forms.FormText style={{ color: "var(--text-muted)" }}>
                        No BetterDiscord plugins found. Place .plugin.js files in the Betterdiscordplugins folder.
                    </Forms.FormText>) : (<div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        {plugins.map(plugin => (<Card key={plugin.id} style={{
                    padding: "12px",
                    background: plugin.enabled
                        ? "var(--background-modifier-selected)"
                        : "var(--background-secondary)"
                }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                            <Forms.FormTitle style={{ margin: 0 }}>
                                                {plugin.meta.name}
                                            </Forms.FormTitle>
                                            <Forms.FormText style={{ color: "var(--text-muted)", fontSize: "12px" }}>
                                                v{plugin.meta.version}
                                            </Forms.FormText>
                                        </div>
                                        <Forms.FormText style={{ color: "var(--text-muted)" }}>
                                            by {plugin.meta.author}
                                        </Forms.FormText>
                                        <Forms.FormText style={{ marginTop: "4px" }}>
                                            {plugin.meta.description}
                                        </Forms.FormText>

                                        {plugin.meta.source && (<a href={plugin.meta.source} target="_blank" rel="noopener noreferrer" style={{ fontSize: "12px", color: "var(--text-link)" }}>
                                                Source
                                            </a>)}
                                    </div>

                                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                                        <Switch checked={plugin.enabled} onChange={() => togglePlugin(plugin.id)}/>
                                    </div>
                                </div>
                            </Card>))}
                    </div>)}
            </Card>

            <Card style={{ padding: "16px", marginTop: "16px", background: "var(--background-floating)" }}>
                <Forms.FormTitle>How to Add Plugins</Forms.FormTitle>
                <Forms.FormText>
                    1. Download BetterDiscord plugins (.plugin.js files)
                </Forms.FormText>
                <Forms.FormText>
                    2. Place them in the Betterdiscordplugins folder in your Testcord data directory
                </Forms.FormText>
                <Forms.FormText>
                    3. Reload plugins or restart Discord
                </Forms.FormText>
                <Forms.FormText>
                    4. Enable plugins from this settings page
                </Forms.FormText>
            </Card>
        </div>);
}
