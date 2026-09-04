/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotice } from "@api/Notices";
import { PluginHealth } from "@api/PluginHealth";
import { hasAnyVisibleSettings, isPluginEnabled, pluginRequiresRestart, startDependenciesRecursive, startPlugin, stopPlugin } from "@api/PluginManager";
import { Settings, useSettings } from "@api/Settings";
import { CogWheel, InfoIcon } from "@components/Icons";
import { AddonCard } from "@components/settings/AddonCard";
import { classNameFactory } from "@utils/css";
import { Logger } from "@utils/Logger";
import { getPluginWarning } from "@utils/pluginWarnings";
import { Plugin } from "@utils/types";
import { React, showToast, Toasts, Tooltip } from "@webpack/common";

import { PluginMeta } from "~plugins";

import { openPluginModal } from "./PluginModal";

const logger = new Logger("PluginCard");
const cl = classNameFactory("vc-plugins-");

// Hoisted so each card passes the same array instance across renders.
const PLUGIN_ENABLED_PATHS: Record<string, readonly `plugins.${string}.enabled`[]> = {};
interface PluginCardProps extends React.HTMLProps<HTMLDivElement> {
    plugin: Plugin;
    disabled?: boolean;
    onRestartNeeded(name: string, key: string): void;
    isNew?: boolean;
    onMouseEnter?: React.MouseEventHandler<HTMLDivElement>;
    onMouseLeave?: React.MouseEventHandler<HTMLDivElement>;
}

export function PluginCard({ plugin, disabled, onRestartNeeded, onMouseEnter, onMouseLeave, isNew }: PluginCardProps) {
    // Subscribe to this plugin's own enabled flag. The card reads it through the
    // non-reactive isPluginEnabled, and the parent memoises the card elements against
    // `settings.plugins`, so nothing here re-renders on its own when the value changes.
    useSettings(PLUGIN_ENABLED_PATHS[plugin.name] ??= [`plugins.${plugin.name}.enabled`]);

    const settings = Settings.plugins[plugin.name];
    const pluginMeta = PluginMeta[plugin.name] || { folderName: "", userPlugin: false };
    const isEquicordPlugin = pluginMeta.folderName?.startsWith("src/equicordplugins/") ?? false;
    const isVencordPlugin = pluginMeta.folderName?.startsWith("src/plugins/") ?? false;
    const isTestcordPlugin = pluginMeta.folderName?.startsWith("src/testcordplugins/") ?? false;
    const isUserPlugin = pluginMeta?.userPlugin ?? false;
    const isModifiedPlugin = plugin.isModified ?? false;
    const isBDPlugin = pluginMeta.folderName?.startsWith("src/Betterdiscordplugins/") || plugin.tags?.includes("betterdiscord");

    // Re-render when the stability score for *this* plugin changes (e.g. when
    // history finishes loading from IndexedDB after the Plugins tab opens).
    const [stabilityTick, setStabilityTick] = React.useState(0);
    React.useEffect(() => {
        let lastBadge = PluginHealth.getStability(plugin.name).badge;
        return PluginHealth.subscribe(() => {
            const next = PluginHealth.getStability(plugin.name).badge;
            if (next !== lastBadge) {
                lastBadge = next;
                setStabilityTick(t => t + 1);
            }
        });
    }, [plugin.name]);

    const isEnabled = () => isPluginEnabled(plugin.name);

    function toggleEnabled() {
        const wasEnabled = isEnabled();

        // Initialize settings if they don't exist (for BD plugins)
        if (!settings) {
            Settings.plugins[plugin.name] = { enabled: !wasEnabled };
            void PluginHealth.recordPluginChange(plugin.name, !wasEnabled);
            // For BD plugins, also trigger the start/stop
            if (!wasEnabled) {
                startPlugin(plugin);
            } else {
                stopPlugin(plugin);
            }
            return;
        }

        // If we're enabling a plugin, make sure all deps are enabled recursively.
        if (!wasEnabled) {
            const { restartNeeded, failures } = startDependenciesRecursive(plugin);

            if (failures.length) {
                logger.error(`Failed to start dependencies for ${plugin.name}: ${failures.join(", ")}`);
                showNotice("Failed to start dependencies: " + failures.join(", "), "Close", () => null);
                return;
            }

            if (restartNeeded) {
                // If any dependencies have patches, don't start the plugin yet.
                settings.enabled = true;
                void PluginHealth.recordPluginChange(plugin.name, true);
                onRestartNeeded(plugin.name, "enabled");
                return;
            }
        }

        // if the plugin requires a restart, don't use stopPlugin/startPlugin. Wait for restart to apply changes.
        if (pluginRequiresRestart(plugin)) {
            settings.enabled = !wasEnabled;
            void PluginHealth.recordPluginChange(plugin.name, !wasEnabled);
            onRestartNeeded(plugin.name, "enabled");
            return;
        }

        // If the plugin is enabled, but hasn't been started, then we can just toggle it off.
        if (wasEnabled && !plugin.started) {
            settings.enabled = !wasEnabled;
            void PluginHealth.recordPluginChange(plugin.name, false);
            return;
        }

        const result = wasEnabled ? stopPlugin(plugin) : startPlugin(plugin);

        if (!result) {
            settings.enabled = false;
            void PluginHealth.recordPluginChange(plugin.name, false);

            const msg = `Error while ${wasEnabled ? "stopping" : "starting"} plugin ${plugin.name}`;
            showToast(msg, Toasts.Type.FAILURE, {
                position: Toasts.Position.BOTTOM,
            });

            return;
        }

        settings.enabled = !wasEnabled;
        void PluginHealth.recordPluginChange(plugin.name, !wasEnabled);
    }

    const pluginInfo = [
        {
            condition: isModifiedPlugin,
            src: "https://equicord.org/assets/icons/equicord/modified.png",
            alt: "Modified",
            title: "Modified Vencord Plugin"
        },
        {
            condition: isEquicordPlugin,
            src: "https://equicord.org/assets/favicon.png",
            alt: "Equicord",
            title: "Equicord Plugin"
        },
        {
            condition: isVencordPlugin,
            src: "https://equicord.org/assets/icons/vencord/icon-light.png",
            alt: "Vencord",
            title: "Vencord Plugin"
        },
        {
            condition: isTestcordPlugin,
            src: "https://raw.githubusercontent.com/TestcordDev/TestCord/refs/heads/main/browser/icon.png",
            alt: "TestCord",
            title: "TestCord Plugin"
        },
        {
            condition: isBDPlugin,
            src: "https://camo.githubusercontent.com/fba98dccf4323b86a2e7599a71e6826f62db4e0bb7d5b637fac9d959111ebfcd/68747470733a2f2f626574746572646973636f72642e6170702f7265736f75726365732f6272616e64696e672f6c6f676f5f736f6c69642e706e67",
            alt: "BetterDiscord",
            title: "BetterDiscord Plugin"
        },
        {
            condition: isUserPlugin && !isBDPlugin,
            src: "https://equicord.org/assets/icons/misc/userplugin.png",
            alt: "User",
            title: "User Plugin"
        }
    ];

    const pluginDetails = pluginInfo.find(p => p.condition);

    const tooltip = pluginDetails?.title || "Unknown Plugin";
    // stabilityTick is referenced so the card re-renders when the badge
    // transitions (e.g. from "unknown" to "stable" after history loads).
    const stability = React.useMemo(
        () => PluginHealth.getStability(plugin.name),
        [plugin.name, stabilityTick]
    );
    const showStabilityBadge = stability.badge === "flaky" || stability.badge === "unstable";
    const stabilityTooltip = showStabilityBadge
        ? `Broken in ${stability.sessionsBroken} of the last ${stability.sessionsSeen} sessions (${Math.round(stability.ratio * 100)}%).`
        : undefined;

    const warning = getPluginWarning(plugin);
    const maxVisibleTags = warning ? 1 : 2;
    const tags = plugin.tags;

    const footer = (
        <div className={cl("card-meta")}>
            <span className={cl("card-source")}>
                {pluginDetails && (
                    <img
                        src={pluginDetails.src}
                        alt={pluginDetails.alt}
                        className={cl("source")}
                    />
                )}
                {tooltip}
            </span>
            <div className={cl("card-badges")}>
                {warning && (
                    <Tooltip text={`${warning.title}: ${warning.description}`}>
                        {({ onMouseEnter: onWarningEnter, onMouseLeave: onWarningLeave }) => (
                            <span
                                className={cl("card-warning", warning.badgeClass || "")}
                                onMouseEnter={onWarningEnter}
                                onMouseLeave={onWarningLeave}
                            >
                                <img
                                    src={warning.icon}
                                    alt={warning.label}
                                    className={cl("warning-icon-small")}
                                />
                                {warning.label}
                            </span>
                        )}
                    </Tooltip>
                )}
                {showStabilityBadge && (
                    <span
                        className={cl("card-stability")}
                        data-badge={stability.badge}
                        title={stabilityTooltip}
                    >
                        {stability.badge === "unstable" ? "Unstable" : "Flaky"}
                    </span>
                )}
                {!!tags?.length && (
                    <div className={cl("card-tags")}>
                        {tags.slice(0, maxVisibleTags).map(tag => (
                            <span key={tag} className={cl("card-tag")}>{tag}</span>
                        ))}
                        {tags.length > maxVisibleTags && (
                            <Tooltip text={tags.slice(maxVisibleTags).join(", ")}>
                                {({ onMouseEnter: onTagEnter, onMouseLeave: onTagLeave }) => (
                                    <span
                                        className={cl("card-tag")}
                                        onMouseEnter={onTagEnter}
                                        onMouseLeave={onTagLeave}
                                    >
                                        +{tags.length - maxVisibleTags}
                                    </span>
                                )}
                            </Tooltip>
                        )}
                    </div>
                )}
            </div>
        </div>
    );

    const warningBadge = warning ? (
        <Tooltip text={`${warning.title}: ${warning.description}`}>
            {({ onMouseEnter: onWarningEnter, onMouseLeave: onWarningLeave }) => (
                <div
                    className={cl("warning-badge", warning.badgeClass || "")}
                    onMouseEnter={onWarningEnter}
                    onMouseLeave={onWarningLeave}
                    role="img"
                    aria-label={warning.title}
                >
                    <img
                        src={warning.icon}
                        alt={warning.label}
                        className={cl("warning-icon")}
                    />
                </div>
            )}
        </Tooltip>
    ) : null;

    return (
        <AddonCard
            name={plugin.name}
            tooltip={tooltip}
            description={plugin.description}
            isNew={isNew}
            warningBadge={warningBadge}
            enabled={isEnabled()}
            setEnabled={toggleEnabled}
            disabled={disabled}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            infoButton={
                <button
                    role="switch"
                    onClick={() => openPluginModal(plugin, onRestartNeeded)}
                    className={cl("info-button")}
                >
                    {hasAnyVisibleSettings(plugin)
                        ? <CogWheel className={cl("info-icon")} />
                        : <InfoIcon className={cl("info-icon")} />
                    }
                </button>
            }
            footer={footer}
        />
    );
}
