/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useSettings } from "@api/Settings";
import { classNameFactory } from "@api/Styles";
import { ChangeList } from "@utils/ChangeList";
import { TestcordDevs } from "@utils/constants";
import { ModalContent, ModalFooter, ModalHeader, ModalRoot, openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { Alerts, Button, Forms, Parser, React, Switch, Text, TextInput, Tooltip, useMemo } from "@webpack/common";
import Plugins from "~plugins";
const cl = classNameFactory("atticus-plugins-");
// Custom PluginCard component
function PluginCard({ plugin, disabled, onRestartNeeded, onMouseEnter, onMouseLeave }) {
    const settings = useSettings();
    const pluginSettings = settings.plugins[plugin.name];
    const isEnabled = pluginSettings?.enabled ?? false;
    const togglePlugin = React.useCallback(() => {
        const wasEnabled = pluginSettings?.enabled ?? false;
        settings.plugins[plugin.name] = {
            ...pluginSettings,
            enabled: !wasEnabled
        };
        if (onRestartNeeded) {
            onRestartNeeded(plugin.name);
        }
    }, [plugin.name, pluginSettings, onRestartNeeded]);
    return (<div className={cl("plugin-card")} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} style={{
            padding: "16px",
            border: "1px solid var(--background-modifier-accent)",
            borderRadius: "8px",
            marginBottom: "8px",
            opacity: disabled ? 0.6 : 1,
            backgroundColor: isEnabled ? "var(--background-secondary-alt)" : "var(--background-secondary)"
        }}>
            <div style={{ display: "flex", flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ flex: 1 }}>
                    <Text variant="heading-md/semibold">{plugin.name}</Text>
                    {plugin.description && (<Text variant="text-sm/normal" color="text-muted" style={{ marginTop: "4px" }}>
                            {plugin.description}
                        </Text>)}
                    {plugin.authors && (<Text variant="text-xs/normal" color="text-muted" style={{ marginTop: "2px" }}>
                            by {plugin.authors.map(a => a.name).join(", ")}
                        </Text>)}
                </div>
                {React.createElement(Switch, {
            value: isEnabled,
            onChange: togglePlugin,
            disabled
        })}
            </div>
        </div>);
}
export function PluginListModal({ modalProps }) {
    const settings = useSettings();
    const changes = React.useMemo(() => new ChangeList(), []);
    const [searchQuery, setSearchQuery] = React.useState("");
    const [showEnabledOnly, setShowEnabledOnly] = React.useState(false);
    React.useEffect(() => {
        return () => void (changes.hasChanges && Alerts.show({
            title: "Restart required",
            body: (<>
                    <p>The following plugins require a restart:</p>
                    <div>{changes.map((s, i) => (<>
                            {i > 0 && ", "}
                            {Parser.parse("`" + s + "`")}
                        </>))}</div>
                </>),
            confirmText: "Restart now",
            cancelText: "Later!",
            onConfirm: () => location.reload()
        }));
    }, []);
    const depMap = React.useMemo(() => {
        const o = {};
        for (const plugin in Plugins) {
            const deps = Plugins[plugin].dependencies;
            if (deps) {
                for (const dep of deps) {
                    o[dep] ??= [];
                    o[dep].push(plugin);
                }
            }
        }
        return o;
    }, []);
    const allPlugins = useMemo(() => {
        return Object.values(Plugins)
            .filter(plugin => {
            if (!plugin?.name)
                return false;
            // Only show plugins authored by "dot" or "dot"
            const allowedAuthors = ["dot", "dot"];
            const hasAllowedAuthor = plugin.authors?.some(author => allowedAuthors.some(allowedAuthor => author.name.toLowerCase() === allowedAuthor.toLowerCase()));
            return hasAllowedAuthor;
        })
            .sort((a, b) => a.name.localeCompare(b.name));
    }, []);
    const filteredPlugins = useMemo(() => {
        let plugins = allPlugins;
        // Filter by search query
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            plugins = plugins.filter(plugin => plugin.name.toLowerCase().includes(query) ||
                plugin.description?.toLowerCase().includes(query) ||
                plugin.authors?.some(author => author.name.toLowerCase().includes(query)));
        }
        // Filter by enabled status if requested
        if (showEnabledOnly) {
            plugins = plugins.filter(plugin => settings.plugins[plugin.name]?.enabled ?? false);
        }
        return plugins;
    }, [allPlugins, searchQuery, showEnabledOnly, settings.plugins]);
    const enabledCount = useMemo(() => {
        return allPlugins.filter(plugin => settings.plugins[plugin.name]?.enabled ?? false).length;
    }, [allPlugins, settings.plugins]);
    const handleSearchChange = e => {
        setSearchQuery(e);
    };
    const handleEnableAll = () => {
        filteredPlugins.forEach(plugin => {
            if (!plugin.required && !depMap[plugin.name]?.some(d => settings.plugins[d].enabled)) {
                settings.plugins[plugin.name] = {
                    ...settings.plugins[plugin.name],
                    enabled: true
                };
                changes.handleChange(plugin.name);
            }
        });
    };
    const handleDisableAll = () => {
        filteredPlugins.forEach(plugin => {
            if (!plugin.required && !depMap[plugin.name]?.some(d => settings.plugins[d].enabled)) {
                settings.plugins[plugin.name] = {
                    ...settings.plugins[plugin.name],
                    enabled: false
                };
                changes.handleChange(plugin.name);
            }
        });
    };
    return <ModalRoot {...modalProps} size={"medium" /* ModalSize.MEDIUM */}>
        <ModalHeader>
            <div style={{ display: "flex", flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text variant="heading-lg/semibold">
                    Plugin Manager ({filteredPlugins.length} shown, {enabledCount} enabled)
                </Text>
            </div>
        </ModalHeader>
        <ModalContent>
            <div style={{ marginBottom: "16px" }}>
                <TextInput placeholder="Search plugins by name, description, or author..." value={searchQuery} onChange={handleSearchChange} autoFocus={true} type="text" style={{ marginBottom: "12px" }}/>
                <div style={{ display: "flex", flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: "8px" }}>
                        {React.createElement(Switch, {
            value: showEnabledOnly,
            onChange: setShowEnabledOnly
        })}
                        <Text>Show enabled only</Text>
                    </div>
                    <div style={{ display: "flex", flexDirection: "row", gap: "8px" }}>
                        <Button size={Button.Sizes.SMALL} color={Button.Colors.BRAND} onClick={handleEnableAll}>
                            Enable All
                        </Button>
                        <Button size={Button.Sizes.SMALL} color={Button.Colors.SECONDARY} onClick={handleDisableAll}>
                            Disable All
                        </Button>
                    </div>
                </div>
            </div>
            <div className={cl("grid")} style={{ maxHeight: "400px", overflowY: "auto" }}>
                {filteredPlugins.length > 0 ? (filteredPlugins.map(plugin => {
            const isRequired = plugin.required || depMap[plugin.name]?.some(d => settings.plugins[d]?.enabled);
            if (isRequired) {
                const tooltipText = plugin.required
                    ? "This plugin is required for the client to function."
                    : makeDependencyList(depMap[plugin.name]?.filter(d => settings.plugins[d]?.enabled));
                return (<Tooltip text={tooltipText} key={plugin.name}>
                                    {({ onMouseLeave, onMouseEnter }) => (<PluginCard onMouseLeave={onMouseLeave} onMouseEnter={onMouseEnter} onRestartNeeded={name => changes.handleChange(name)} disabled={true} plugin={plugin}/>)}
                                </Tooltip>);
            }
            else {
                return React.createElement(PluginCard, {
                    key: plugin.name,
                    onRestartNeeded: (name) => changes.handleChange(name),
                    disabled: false,
                    plugin
                });
            }
        })) : (<Text style={{ textAlign: "center", padding: "20px" }}>
                        {searchQuery ? `No plugins found matching "${searchQuery}"` : "No plugins available"}
                    </Text>)}
            </div>
        </ModalContent>
        <ModalFooter>
            <div style={{ display: "flex", flexDirection: "row-reverse" }}>
                <Button color={Button.Colors.RED} onClick={modalProps.onClose}>Close</Button>
            </div>
        </ModalFooter>
    </ModalRoot>;
}
function makeDependencyList(deps) {
    return (<React.Fragment>
            <Forms.FormText>This plugin is required by:</Forms.FormText>
            {deps.map((dep) => <Forms.FormText key={dep} className={cl("dep-text")}>{dep}</Forms.FormText>)}
        </React.Fragment>);
}
export function openPluginList() {
    openModal(modalProps => React.createElement(PluginListModal, { modalProps: modalProps }));
}
function keybind(e) {
    if (e.altKey && e.key.toLowerCase() === "x") {
        openPluginList();
    }
}
export default definePlugin({
    name: "pluginManager",
    description: "Manage custom plugins",
    tags: ["Utility", "Developers"],
    authors: [TestcordDevs.dot],
    start() {
        document.addEventListener("keydown", keybind);
    },
    stop() {
        document.removeEventListener("keydown", keybind);
    }
});
