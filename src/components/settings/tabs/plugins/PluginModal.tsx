/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import "./PluginModal.css";

import { generateId } from "@api/Commands";
import { hasAnyVisibleSettings, isSettingHidden } from "@api/PluginManager";
import { useSettings } from "@api/Settings";
import { BaseText } from "@components/BaseText";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Flex } from "@components/Flex";
import { Paragraph } from "@components/Paragraph";
import { gitRemote } from "@shared/vencordUserAgent";
import { classNameFactory } from "@utils/css";
import { buildIssueUrl, generateGitHubIssueBody } from "@utils/debugReport";
import { proxyLazy } from "@utils/lazy";
import { Margins } from "@utils/margins";
import { classes, isObjectEmpty } from "@utils/misc";
import { getPluginWarning } from "@utils/pluginWarnings";
import { OptionType, Plugin, PluginTag } from "@utils/types";
import { RenderModalProps, User } from "@vencord/discord-types";
import { findComponentByCodeLazy, findCssClassesLazy } from "@webpack";
import { Clickable, FluxDispatcher, Modal, openModal, React, Text, Toasts, Tooltip, useEffect, useMemo, UserStore, UserUtils, useState } from "@webpack/common";
import { Constructor } from "type-fest";

import Plugins, { PluginMeta } from "~plugins";

import { OptionComponentMap } from "./components";
import { openContributorModal } from "./ContributorModal";
import { jumpToPlugin } from "./jumpToPlugin";
import { FavoriteButton, GithubButton, WebsiteButton } from "./PluginModalButtons";

const cl = classNameFactory("vc-plugin-modal-");

const AvatarStyles = findCssClassesLazy("moreUsers", "avatar", "clickableAvatar");
const CloseButton = findComponentByCodeLazy("CLOSE_BUTTON_LABEL");
const ConfirmModal = findComponentByCodeLazy('parentComponent:"ConfirmModal"');
const WarningIcon = findComponentByCodeLazy("3.15H3.29c-1.74");
const UserRecord = proxyLazy(() => UserStore.getCurrentUser().constructor) as Constructor<User, [Partial<User>]>;

interface PluginModalProps extends RenderModalProps {
    plugin: Plugin;
    onRestartNeeded(key: string): void;
}

export function findPluginByName(name: string): Plugin | undefined {
    const norm = name.trim().toLowerCase().replace(/[\s\-_]/g, "");
    let match = Object.values(Plugins).find(p => {
        if (!p?.name) return false;
        return p.name.trim().toLowerCase().replace(/[\s\-_]/g, "") === norm;
    });
    if (match) return match;

    match = Plugins[name] ?? Object.entries(Plugins).find(([k]) => k.trim().toLowerCase().replace(/[\s\-_]/g, "") === norm)?.[1];
    if (match) return match;

    return Object.values(Plugins).find(p => {
        if (!p?.name) return false;
        const pNorm = p.name.trim().toLowerCase().replace(/[\s\-_]/g, "");
        return pNorm.startsWith(norm) || norm.startsWith(pNorm);
    });
}

export function makeDummyUser(user: { username: string; id?: string; avatar?: string; }) {
    const newUser = new UserRecord({
        username: user.username,
        id: user.id ?? generateId(),
        avatar: user.avatar,
        /** To stop discord making unwanted requests... */
        bot: true,
    });

    FluxDispatcher.dispatch({
        type: "USER_UPDATE",
        user: newUser,
    });

    return newUser;
}

function PluginTags({ tags }: { tags: PluginTag[]; }) {
    return (
        <div className={cl("tags")}>
            {tags.map(tag => (
                <div key={tag} className={cl("tag")}>{tag}</div>
            ))}
        </div>
    );
}

export default function PluginModal({ plugin, onRestartNeeded, onClose, transitionState }: PluginModalProps) {
    const pluginSettings = useSettings([`plugins.${plugin.name}.*`]).plugins[plugin.name];
    const hasSettings = hasAnyVisibleSettings(plugin);

    // avoid layout shift by showing dummy users while loading users
    const fallbackAuthors = useMemo(() => [makeDummyUser({ username: "Loading...", id: "-1465912127305809920" })], []);
    const [authors, setAuthors] = useState<User[]>([]);

    useEffect(() => {
        let cancelled = false;
        Promise.all(
            (plugin.authors ?? []).filter(Boolean).slice(0, 6).map(user =>
                user?.id
                    ? UserUtils.getUser(String(user.id))
                        .catch(() => makeDummyUser({ username: user?.name ?? "Unknown" }))
                    : Promise.resolve(makeDummyUser({ username: user?.name ?? "Unknown" }))
            )
        ).then(resolved => {
            if (!cancelled) setAuthors(resolved);
        });
        return () => { cancelled = true; };
    }, [plugin.authors]);

    function handleResetClick() {
        openWarningModal(plugin, onRestartNeeded);
    }

    function renderSettings() {
        const { settings } = plugin;
        if (!hasSettings || !settings)
            return <Paragraph>There are no settings for this plugin.</Paragraph>;

        const options = Object.entries(settings.def).map(([key, setting]) => {
            if (setting.type === OptionType.CUSTOM) return null;

            if (isSettingHidden(settings, setting)) return null;

            function onChange(newValue: any) {
                const option = plugin.settings!.def[key];
                if (!option || option.type === OptionType.CUSTOM) return;

                pluginSettings[key] = newValue;

                if (option.restartNeeded) onRestartNeeded(key);
            }

            const Component = OptionComponentMap[setting.type];
            return (
                <ErrorBoundary noop key={key}>
                    <Component
                        id={key}
                        setting={setting}
                        onChange={onChange}
                        pluginSettings={pluginSettings}
                        definedSettings={settings}
                        closePluginSettings={onClose}
                    />
                </ErrorBoundary>
            );
        });

        return (
            <div className="vc-plugins-settings">
                {options}
            </div>
        );
    }

    function renderMoreUsers(_label: string) {
        const remainingAuthors = plugin.authors.slice(6);

        return (
            <Tooltip text={remainingAuthors.map(u => u.name).join(", ")}>
                {({ onMouseEnter, onMouseLeave }) => (
                    <div
                        className={AvatarStyles.moreUsers}
                        onMouseEnter={onMouseEnter}
                        onMouseLeave={onMouseLeave}
                    >
                        +{remainingAuthors.length}
                    </div>
                )}
            </Tooltip>
        );
    }

    const pluginMeta = PluginMeta[plugin.name];
    const isEquicordPlugin = pluginMeta.folderName.startsWith("src/equicordplugins/") ?? false;
    const warning = getPluginWarning(plugin);

    const warningTooltipText = warning
        ? warning.replacementPlugin
            ? `${warning.title}: Replaced by ${warning.replacementPlugin} (Click to jump to it)`
            : `${warning.title}: ${warning.description}`
        : "";

    const handleWarningReplacementClick = () => {
        if (!warning?.replacementPlugin) return;
        onClose();
        jumpToPlugin(warning.replacementPlugin);
    };

    return (
        <Modal
            transitionState={transitionState}
            onClose={onClose}
            size="lg"
            title={
                <div className={cl("header")}>
                    <BaseText tag="h1" weight="semibold" size="lg">{plugin.name.replace(/([a-z])([A-Z])/g, "$1 $2")}</BaseText>
                    {warning && (
                        <Tooltip text={warningTooltipText}>
                            {({ onMouseEnter, onMouseLeave }) => (
                                <span
                                    className={classes(
                                        cl("warning-badge"),
                                        cl(`warning-${warning.type}`),
                                        warning.replacementPlugin && cl("warning-clickable")
                                    )}
                                    onMouseEnter={onMouseEnter}
                                    onMouseLeave={onMouseLeave}
                                    onClick={warning.replacementPlugin ? handleWarningReplacementClick : undefined}
                                    role={warning.replacementPlugin ? "button" : undefined}
                                    tabIndex={warning.replacementPlugin ? 0 : undefined}
                                >
                                    <img
                                        src={warning.icon}
                                        alt={warning.label}
                                        className={cl("warning-icon")}
                                    />
                                    <span>{warning.label}</span>
                                </span>
                            )}
                        </Tooltip>
                    )}
                </div>
            }
            subtitle={
                <div className={cl("info")}>
                    <div>
                        <Paragraph size="md">{plugin.description}</Paragraph>
                        {!!plugin.tags?.length && <PluginTags tags={plugin.tags} />}
                    </div>
                </div>
            }
        >
            {warning && (
                <div className={classes(Margins.top16, cl("warning-banner"), cl(`warning-banner-${warning.type}`))}>
                    <img src={warning.icon} alt={warning.label} className={cl("warning-banner-icon")} />
                    <div className={cl("warning-banner-text")}>
                        <strong className={cl("warning-banner-title")}>{warning.title}</strong>
                        <Paragraph size="sm" className={cl("warning-banner-desc")}>{warning.description}</Paragraph>
                        {warning.replacementPlugin && (
                            <div className={cl("warning-banner-action")}>
                                <Button
                                    size="small"
                                    variant="secondary"
                                    className={cl("replacement-btn")}
                                    onClick={handleWarningReplacementClick}
                                >
                                    Jump to {warning.replacementPlugin}
                                </Button>
                            </div>
                        )}
                    </div>
                </div>
            )}
            {!!plugin.settingsAboutComponent && (
                <div className={classes(Margins.top16, cl("about-box"))}>
                    <section>
                        <ErrorBoundary message="An error occurred while rendering this plugin's custom Info Component">
                            <plugin.settingsAboutComponent />
                        </ErrorBoundary>
                    </section>
                </div>
            )}
            <div className={"vc-settings-modal-content"}>
                <section className={cl("section")}>
                    <Text variant="heading-lg/semibold" className={Margins.bottom8}>Authors</Text>
                    <div className={cl("authors")}>
                        <ErrorBoundary noop>
                            {(authors.length ? authors : fallbackAuthors).map((user, index) => (
                                <Clickable
                                    key={user.id ?? index}
                                    className={cl("author")}
                                    onClick={() => openContributorModal(user)}
                                >
                                    <img
                                        className={cl("author-avatar")}
                                        src={user.getAvatarURL?.(void 0, 80, true)}
                                        alt={user.username}
                                    />
                                    <BaseText size="sm" weight="semibold">{user.username}</BaseText>
                                </Clickable>
                            ))}
                            {plugin.authors.length > 6 && renderMoreUsers("more authors")}
                        </ErrorBoundary>
                    </div>
                </section>

                <section className={cl("section")}>
                    <BaseText size="lg" weight="semibold" color="text-strong" className={Margins.bottom8}>Settings</BaseText>
                    {renderSettings()}
                </section>
            </div>
            <div className={cl("footer")}>
                <Flex flexDirection="column" style={{ width: "100%" }}>
                    <Flex style={{ justifyContent: "space-between", alignItems: "center" }}>
                        {hasSettings ? (
                            <Tooltip text="Reset to default settings" shouldShow={!isObjectEmpty(pluginSettings)}>
                                {({ onMouseEnter, onMouseLeave }) => (
                                    <Button
                                        className={cl("disable-warning")}
                                        size="small"
                                        variant="primary"
                                        onClick={handleResetClick}
                                        onMouseEnter={onMouseEnter}
                                        onMouseLeave={onMouseLeave}
                                    >
                                        Reset
                                    </Button>
                                )}
                            </Tooltip>
                        ) : <div />}
                        <Flex style={{ gap: 8, alignItems: "center" }}>
                            <Tooltip text="Open a pre-filled GitHub issue for this plugin">
                                {({ onMouseEnter, onMouseLeave }) => (
                                    <Button
                                        size="small"
                                        variant="secondary"
                                        onMouseEnter={onMouseEnter}
                                        onMouseLeave={onMouseLeave}
                                        onClick={() => {
                                            try {
                                                const body = generateGitHubIssueBody({ pluginName: plugin.name });
                                                const url = buildIssueUrl(`[${plugin.name}] Bug report`, body, ["bug"]);
                                                VencordNative.native.openExternal(url);
                                            } catch (e) {
                                                console.error("Failed to build issue URL", e);
                                                Toasts.show({
                                                    id: Toasts.genId(),
                                                    message: "Failed to build issue URL",
                                                    type: Toasts.Type.FAILURE,
                                                    options: { position: Toasts.Position.TOP }
                                                });
                                            }
                                        }}
                                    >
                                        Report Issue
                                    </Button>
                                )}
                            </Tooltip>
                            {!pluginMeta.userPlugin && (
                                <div className={cl("links")}>
                                    <FavoriteButton
                                        isFavorite={pluginSettings.isFavorite ?? false}
                                        onClick={() => pluginSettings.isFavorite = !pluginSettings.isFavorite}
                                    />
                                    <WebsiteButton
                                        text="Website"
                                        href={isEquicordPlugin ? `https://equicord.org/plugins/${plugin.name}` : `https://vencord.dev/plugins/${plugin.name}`}
                                    />
                                    <GithubButton
                                        text="Source Code"
                                        href={`https://github.com/${gitRemote}/tree/main/${pluginMeta.folderName}`}
                                    />
                                </div>
                            )}
                        </Flex>
                    </Flex>
                </Flex>
            </div>
        </Modal >
    );
}

export function openPluginModal(plugin: Plugin, onRestartNeeded?: (pluginName: string, key: string) => void) {
    openModal(modalProps => (
        <PluginModal
            {...modalProps}
            plugin={plugin}
            onRestartNeeded={(key: string) => onRestartNeeded?.(plugin.name, key)}
        />
    ));
}

function resetSettings(plugin: Plugin, onRestartNeeded?: (pluginName: string) => void) {
    const defaultSettings = plugin.settings?.def;
    const pluginName = plugin.name;

    if (!defaultSettings) return;

    const newSettings: Record<string, any> = {};
    let restartNeeded = false;

    for (const key in defaultSettings) {
        if (key === "enabled") continue;

        const setting = defaultSettings[key];
        setting.type = setting.type ?? OptionType.STRING;

        if (setting.type === OptionType.STRING) {
            newSettings[key] = setting.default !== undefined && setting.default !== "" ? setting.default : "";
        } else if ("default" in setting && setting.default !== undefined) {
            newSettings[key] = setting.default;
        }

        if (setting?.restartNeeded) {
            restartNeeded = true;
        }
    }

    const currentSettings = plugin.settings?.store;
    if (currentSettings) {
        Object.assign(currentSettings, newSettings);
    }

    if (restartNeeded) {
        onRestartNeeded?.(plugin.name);
    }

    Toasts.show({
        message: `Settings for ${pluginName} have been reset.`,
        id: Toasts.genId(),
        type: Toasts.Type.SUCCESS,
        options: {
            position: Toasts.Position.TOP
        }
    });
}

export function openWarningModal(plugin?: Plugin | null, onRestartNeeded?: (pluginName: string) => void, isPlugin = true, enabledPlugins?: number | null, reset?: () => void) {
    openModal(props => (
        <ConfirmModal
            {...props}
            className={cl("confirm")}
            header={isPlugin ? "Reset Settings" : "Disable Plugins"}
            confirmText={isPlugin ? "Reset" : "Disable All"}
            cancelText="Cancel"
            onConfirm={() => {
                if (isPlugin && plugin) {
                    resetSettings(plugin, onRestartNeeded);
                } else {
                    reset?.();
                }
            }}
            onCancel={props.onClose}
        >
            <Paragraph>
                {isPlugin
                    ? <>Are you sure you want to reset all settings for <strong>{plugin?.name}</strong> to their default values?</>
                    : `Are you sure you want to disable ${enabledPlugins} plugins?`
                }
            </Paragraph>
            <div className={classes(Margins.top16, cl("warning"))}>
                <WarningIcon color="var(--text-feedback-critical)" />
                <span>This action cannot be undone.</span>
            </div>
        </ConfirmModal>
    ));
}
