/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./OptimizerTab.css";

import { isSettingHidden } from "@api/PluginManager";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { HeadingPrimary, HeadingSecondary } from "@components/Heading";
import { Notice } from "@components/Notice";
import { Paragraph } from "@components/Paragraph";
import { SettingsTab } from "@components/settings";
import { OptionComponentMap } from "@components/settings/tabs/plugins/components";
import { classNameFactory } from "@utils/css";
import { relaunch } from "@utils/native";
import { OptionType, PluginSettingDef, PluginSettingDefCommon } from "@utils/types";
import { findComponentByCodeLazy } from "@webpack";
import { openModal, React, TextInput, Toasts, useState } from "@webpack/common";

import { settings } from ".";

const cl = classNameFactory("vc-optimizer-");

const ConfirmModal = findComponentByCodeLazy('parentComponent:"ConfirmModal"');

interface Category {
    title: string;
    keys: string[];
}

const CATEGORIES: Category[] = [
    {
        title: "Core & Scheduling",
        keys: [
            "domThrottle",
            "domThrottleDelay",
            "animationFrameReduction",
            "throttleMutationObservers",
            "throttleResizeObservers",
            "forcePassiveListeners",
            "suppressIdleCallback",
            "freezeWhenUnfocused",
            "reduceFpsBackground"
        ]
    },
    {
        title: "Network & Caching",
        keys: [
            "fastNetwork",
            "networkCache",
            "networkCacheMinutes",
            "networkCacheMaxEntries",
            "limitConcurrentRequests",
            "preconnectDiscordCdn",
            "preventWebSocketFlood",
            "cacheLimitsEnabled",
            "throttlePresence"
        ]
    },
    {
        title: "Memory Management",
        keys: [
            "memoryManagement",
            "memoryCheckSeconds",
            "limitMessageCache",
            "limitMessageCacheMinutes",
            "limitMsgCache"
        ]
    },
    {
        title: "Images & Media",
        keys: [
            "forceLowImageQuality",
            "pauseOffscreenMedia",
            "lazyEmbedImages",
            "lazyIframes",
            "optimizeImageDecoding",
            "containAttachmentImages",
            "optimizeLargeAttachments",
            "freezeGifsUntilHover",
            "gifFreezeMethod",
            "suppressGifAutoplay",
            "freezeAnimatedAvatars",
            "reduceAvatarQuality"
        ]
    },
    {
        title: "Animations & Visual Effects",
        keys: [
            "disableSpringAnimations",
            "reduceMotion",
            "killWillChange",
            "killBackdropBlur",
            "killHoverTransitions",
            "killLoadingSpinner",
            "killConfettiCanvas",
            "disableAnimatedHeaders",
            "suppressChannelAnimations",
            "suppressUnreadBadgeAnimations",
            "suppressMentionBadgeAnimations",
            "suppressModalAnimations",
            "suppressScrollbarAnimations",
            "suppressDiscoveryAnimations",
            "suppressContextMenuAnimations",
            "suppressEmojiPickerAnimations",
            "disableFolderAnimations",
            "suppressReactionAnimations",
            "suppressSkeletonAnimation",
            "simplifySpoilers",
            "optimizeToasts",
            "forceScrollBehavior",
            "overscrollContain",
            "disableCSSFilters",
            "disableBoxShadows",
            "disableTextShadows"
        ]
    },
    {
        title: "Chat & Messages",
        keys: [
            "virtualizeMessages",
            "messageContentVisibility",
            "optimizeTextRendering",
            "optimizeChatInput",
            "disableTypingIndicator",
            "disableSpellcheck",
            "throttleFluxDispatches",
            "killReactionRendering",
            "killMessageEffects",
            "disableInvitePreviews",
            "suppressEmbedPreviews",
            "suppressEmbedAutoLoad",
            "containEmbeds",
            "disableAnimatedEmoji",
            "suppressStickerAnimation",
            "optimizeTooltips",
            "optimizeEmojiCache"
        ]
    },
    {
        title: "Lists & Layout Containment",
        keys: [
            "throttleMemberList",
            "memberListThrottleMs",
            "freezeMemberList",
            "unifiedMemberListGradient",
            "containMemberList",
            "containServerList",
            "containGuildList",
            "containDmList",
            "containChannelList",
            "containForumPosts",
            "containSearchResults",
            "forceCompositingLayers"
        ]
    },
    {
        title: "Hide UI Elements",
        keys: [
            "hideVoicePanel",
            "hideActivityPanel",
            "hideServerBanner",
            "hideAvatarDecorations",
            "suppressProfileEffects",
            "hideServerBoosting",
            "hideNitroUpsell",
            "hideServerGuide",
            "hideServerOnboarding",
            "hideSoundboardButton",
            "hideGiftButton",
            "hideStickerButton",
            "disableChannelTopic",
            "disableUnreadBadges",
            "disableDragAndDrop",
            "disableCanvasEffects",
            "suppressAllCanvas",
            "killVoiceVideo"
        ]
    },
    {
        title: "Console & Telemetry",
        keys: [
            "suppressConsoleSpam",
            "suppressConsoleWarn",
            "suppressConsoleGroup",
            "suppressConsoleCount",
            "suppressConsoleAssert",
            "suppressConsoleDir",
            "suppressConsoleTimers",
            "killGatewayAnalytics",
            "killSentry",
            "killPerformanceMetrics"
        ]
    }
];

type RestartableDef = PluginSettingDef & { restartNeeded?: boolean; hidden?: boolean; };

function settingLabel(id: string): string {
    return id.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, c => c.toUpperCase());
}

function matchesQuery(id: string, def: PluginSettingDef, category: string, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
        id.toLowerCase().includes(q)
        || settingLabel(id).toLowerCase().includes(q)
        || (def as PluginSettingDefCommon).description?.toLowerCase().includes(q)
        || category.toLowerCase().includes(q)
    );
}

function SettingRow({ id, pluginSettings, onChange }: {
    id: string;
    pluginSettings: Record<string, any>;
    onChange: (v: any) => void;
}) {
    const def = settings.def[id] as RestartableDef | undefined;
    if (!def || def.type === OptionType.CUSTOM || isSettingHidden(settings as any, def)) return null;

    const Component = OptionComponentMap[def.type] as React.ComponentType<any>;

    return (
        <Component
            id={id}
            setting={def}
            pluginSettings={pluginSettings}
            definedSettings={settings}
            closePluginSettings={() => { }}
            onChange={onChange}
        />
    );
}

export default function OptimizerTab() {
    const pluginSettings = settings.use();
    const [query, setQuery] = useState("");
    const [restartKeys, setRestartKeys] = useState<string[]>([]);

    const sections: Category[] = React.useMemo(() => {
        const covered = new Set(CATEGORIES.flatMap(c => c.keys));
        const otherKeys = (Object.entries(settings.def) as [string, RestartableDef][])
            .filter(([key, def]) => !covered.has(key) && def.type !== OptionType.CUSTOM && !def.hidden)
            .map(([key]) => key);
        const all = otherKeys.length ? [...CATEGORIES, { title: "Other", keys: otherKeys }] : [...CATEGORIES];

        if (!query.trim()) return all;

        return all
            .map(category => ({
                ...category,
                keys: category.keys.filter(key => {
                    const def = settings.def[key] as RestartableDef | undefined;
                    if (!def) return false;
                    return matchesQuery(key, def, category.title, query);
                })
            }))
            .filter(category => category.keys.length > 0);
    }, [query]);

    function handleChange(key: string, newValue: any) {
        const option = settings.def[key] as RestartableDef | undefined;
        if (!option || option.type === OptionType.CUSTOM) return;

        pluginSettings[key] = newValue;

        if (option.restartNeeded && !restartKeys.includes(key)) {
            setRestartKeys(prev => [...prev, key]);
        }
    }

    function resetAll() {
        let needsRestart = false;
        for (const [key, def] of Object.entries(settings.def) as [string, RestartableDef][]) {
            if (key === "enabled") continue;
            if ("default" in def && def.default !== undefined) {
                settings.store[key] = def.default;
            }
            if (def.restartNeeded) needsRestart = true;
        }
        setRestartKeys(needsRestart ? Object.keys(settings.def) : []);
        Toasts.show({
            id: Toasts.genId(),
            message: "TestcordOptimizer settings have been reset.",
            type: Toasts.Type.SUCCESS,
            options: { position: Toasts.Position.TOP }
        });
    }

    function openResetConfirm() {
        openModal(modalProps => (
            <ConfirmModal
                {...modalProps}
                header="Reset Optimizer Settings"
                confirmText="Reset"
                cancelText="Cancel"
                onConfirm={() => {
                    resetAll();
                    modalProps.onClose();
                }}
                onCancel={modalProps.onClose}
            >
                <Paragraph>
                    Are you sure you want to reset all TestcordOptimizer settings to their default values?
                </Paragraph>
            </ConfirmModal>
        ));
    }

    return (
        <SettingsTab>
            <div className={cl("header")}>
                <HeadingPrimary>Optimizer</HeadingPrimary>
                <div className={cl("header-actions")}>
                    <Button variant="secondary" size="small" onClick={openResetConfirm}>
                        Reset All
                    </Button>
                </div>
            </div>

            <Paragraph>All-in-one performance suite, grouped by area. Use the search box to filter.</Paragraph>

            {restartKeys.length > 0 && (
                <Notice
                    variant="warning"
                    className={cl("restart-notice")}
                    action={
                        <Button size="small" variant="primary" onClick={relaunch}>
                            Restart Now
                        </Button>
                    }
                >
                    Some changed settings require a restart to take effect.
                </Notice>
            )}

            <div className={cl("search")}>
                <TextInput
                    inputClassName={cl("search-input")}
                    placeholder="Search optimizer settings..."
                    value={query}
                    onChange={setQuery}
                />
            </div>

            {sections.map(category => (
                <section key={category.title} className={cl("category")}>
                    <HeadingSecondary>{category.title}</HeadingSecondary>
                    <div className="vc-plugins-settings vc-optimizer-category-settings">
                        {category.keys.map(key => (
                            <ErrorBoundary noop key={key}>
                                <SettingRow
                                    id={key}
                                    pluginSettings={pluginSettings}
                                    onChange={value => handleChange(key, value)}
                                />
                            </ErrorBoundary>
                        ))}
                    </div>
                </section>
            ))}

            {sections.length === 0 && (
                <Paragraph className={cl("no-results")}>No settings match your search.</Paragraph>
            )}
        </SettingsTab>
    );
}
