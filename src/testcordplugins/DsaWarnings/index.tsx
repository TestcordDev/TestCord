/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { BaseText } from "@components/BaseText";
import ErrorBoundary from "@components/ErrorBoundary";
import { EquicordDevs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { useAwaiter } from "@utils/react";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import type { User } from "@vencord/discord-types";
import { findCssClassesLazy } from "@webpack";
import { Clickable, useState } from "@webpack/common";

import { fetchActiveWarnings, getActionTags, getActiveRestrictionLabels, invalidateWarnings } from "./api";
import managedStyle from "./style.css?managed";
import type { BreachRecord, CordCatUserInfo, DsaAction } from "./types";

function ApiKeyNotice() {
    const hasKey = settings.store.cordCatApiKey.trim().length > 0;

    return (
        <div className={cl("settings-notice")}>
            <BaseText size="sm" weight="medium" defaultColor={false}>
                {hasKey
                    ? "API key is set. Lookups should work."
                    : "A CordCat API key is required for DSA lookups. Create a free account at https://api.cord.cat to get one, then paste it below."}
            </BaseText>
        </div>
    );
}

const settings = definePluginSettings({
    cordCatApiKey: {
        type: OptionType.STRING,
        description: "CordCat API key (required). Get one at https://api.cord.cat",
        default: "",
    },
    cordCatApiBaseUrl: {
        type: OptionType.STRING,
        description: "Base URL for the CordCat intelligence query API.",
        default: "https://api.cord.cat",
    },
    dsaBrowseBaseUrl: {
        type: OptionType.STRING,
        description: "Base URL for the DSA lookup browse UI.",
        default: "https://dsa.discord.food",
    },
});

const cl = classNameFactory("vc-dsa-warnings-");
const DMSideBarClasses = findCssClassesLazy("widgetPreviews");
const MAX_VISIBLE_CARDS = 4;
const Native = VencordNative.pluginHelpers.DsaWarnings as PluginNative<typeof import("./native")>;
function getColorBrightness(color: number) {
    const red = (color >> 16) & 0xff;
    const green = (color >> 8) & 0xff;
    const blue = color & 0xff;

    return (red * 299 + green * 587 + blue * 114) / 1000;
}

function hasLightProfileTheme(displayProfile: { themeColors?: number[] | null; accentColor?: number | null; } | undefined) {
    const colors = displayProfile?.themeColors?.filter(color => Number.isFinite(color)) ?? [];
    if (colors.length > 0) {
        const average = colors.reduce((total, color) => total + getColorBrightness(color), 0) / colors.length;
        return average >= 160;
    }

    if (displayProfile?.accentColor != null) {
        return getColorBrightness(displayProfile.accentColor) >= 160;
    }

    return false;
}

function formatLabel(value: string) {
    return value
        .replace(/^STATEMENT_CATEGORY_/, "")
        .replace(/^KEYWORD_/, "")
        .replace(/^DECISION_(ACCOUNT|VISIBILITY|PROVISION|MONETARY)_/, "")
        .replace(/^CONTENT_TYPE_/, "")
        .replace(/_/g, " ")
        .toLowerCase()
        .replace(/\b\w/g, character => character.toUpperCase());
}

function formatDate(value: string) {
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) return value;

    return new Date(parsed).toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric"
    });
}

function buildDsaBrowseUrl(parsedId: string) {
    const url = new URL(`${settings.store.dsaBrowseBaseUrl}/browse`);
    url.searchParams.set("parsedId", parsedId);
    url.searchParams.set("sort", "applicationDate");
    url.searchParams.set("order", "desc");
    return url.toString();
}

function buildCordCatUrl(parsedId: string) {
    return new URL(`${settings.store.cordCatApiBaseUrl}/${parsedId}`).toString();
}

function getCardTags(action: DsaAction) {
    return getActionTags(action).slice(0, 3);
}

function getBreachTags(breach: BreachRecord) {
    return (breach.categories ?? []).filter(Boolean).slice(0, 3);
}

function getBreachName(breach: BreachRecord) {
    return breach.username || breach.discordname || "Unknown account";
}

function getBreachSummary(breach: BreachRecord) {
    const parts = [
        breach.ip && breach.ip !== "None" ? `IP ${breach.ip}` : null,
        breach.discriminator || breach.tag ? `Tag #${breach.discriminator || breach.tag}` : null,
        breach.id || breach.no ? `Record ${breach.id || breach.no}` : null
    ].filter(Boolean);

    return parts.length > 0 ? parts.join(" \u2022 ") : "Listed in a known breach dataset";
}

function formatIllegality(value: string | boolean | null) {
    if (value === true || value === "Yes") return "Yes";
    if (value === false || value === "No") return "No";
    if (typeof value === "string" && value.length > 0) return value;
    return null;
}

function StatusCard({
    title,
    message,
    onClick
}: {
    title: string;
    message: string;
    onClick?: () => void | Promise<void>;
}) {
    const content = (
        <div className={cl("card-top")}>
            <div className={cl("card-left")}>
                <div className={cl("glyph")}>!</div>
                <div className={cl("card-content")}>
                    <div className={cl("chip-row")}>
                        <span className={cl("chip", "chip-user")}>DSA Lookup</span>
                    </div>
                    <BaseText className={cl("category")} size="xl" weight="extrabold" defaultColor={false}>{title}</BaseText>
                    <BaseText className={cl("facts")} size="sm" weight="medium" defaultColor={false}>{message}</BaseText>
                </div>
            </div>
        </div>
    );

    if (!onClick) return <div className={cl("card")}>{content}</div>;

    return (
        <Clickable className={cl("card")} onClick={onClick} aria-label={title}>
            {content}
        </Clickable>
    );
}

function UserInfoSection({ userInfo }: { userInfo: CordCatUserInfo; }) {
    const handle = userInfo.discriminator && userInfo.discriminator !== "0"
        ? `${userInfo.username}#${userInfo.discriminator}`
        : userInfo.username ? `@${userInfo.username}` : null;

    const guild = userInfo.clan ?? userInfo.primary_guild;

    return (
        <div className={cl("user-info")}>
            {userInfo.avatar && (
                <img
                    className={cl("user-avatar")}
                    src={`https://cdn.discordapp.com/avatars/${userInfo.id}/${userInfo.avatar}.${userInfo.avatar.startsWith("a_") ? "gif" : "png"}?size=64`}
                    alt=""
                />
            )}
            <div className={cl("user-details")}>
                {userInfo.global_name && (
                    <BaseText className={cl("user-display")} size="lg" weight="bold" defaultColor={false}>
                        {userInfo.global_name}
                    </BaseText>
                )}
                {handle && (
                    <BaseText className={cl("user-handle")} size="sm" weight="medium" defaultColor={false}>
                        {handle}
                    </BaseText>
                )}
                <BaseText className={cl("user-id")} size="xs" weight="medium" defaultColor={false}>
                    {userInfo.id}
                </BaseText>
                {userInfo.public_flags != null && userInfo.public_flags !== 0 && (
                    <BaseText className={cl("user-flags")} size="xs" weight="medium" defaultColor={false}>
                        Flags: {userInfo.public_flags}
                    </BaseText>
                )}
                {guild && (
                    <BaseText className={cl("user-clan")} size="xs" weight="medium" defaultColor={false}>
                        Clan: [{guild.tag}]
                    </BaseText>
                )}
            </div>
        </div>
    );
}

function ActionDetailRow({ label, value }: { label: string; value: string; }) {
    return (
        <div className={cl("detail-row")}>
            <BaseText className={cl("detail-label")} size="xs" weight="bold" defaultColor={false}>{label}</BaseText>
            <BaseText className={cl("detail-value")} size="xs" weight="medium" defaultColor={false}>{value}</BaseText>
        </div>
    );
}

const DsaWarningsCollection = ErrorBoundary.wrap(function DsaWarningsCollection({
    user,
    displayProfile,
    isSideBar = false
}: {
    user: User;
    displayProfile?: { themeColors?: number[] | null; accentColor?: number | null; };
    isSideBar?: boolean;
}) {
    const [refreshKey, setRefreshKey] = useState(0);
    const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
    const [result] = useAwaiter(() => {
        return fetchActiveWarnings(user.id).catch(() => null);
    }, {
        deps: [user.id, refreshKey],
        fallbackValue: null
    });

    const isExpanded = expandedUserId === user.id;
    const isLightTheme = hasLightProfileTheme(displayProfile);
    const isReady = result?.kind === "ready";
    const isUnavailable = result?.kind === "unavailable";
    const isError = result?.kind === "error";
    const actions = isReady ? result.actions : [];
    const breaches = isReady ? result.breaches : [];
    const breachStatus = isReady ? result.breachStatus : "unavailable";
    const breachError = isReady ? result.breachError : null;
    const breachCount = isReady ? result.breachCount : 0;
    const userInfo = isReady ? result.userInfo : null;
    const subtitle = result == null
        ? "Loading DSA lookup..."
        : isReady
        ? breachStatus === "ready"
            ? `${actions.length} warnings \u2022 ${breachCount} breaches`
            : breachStatus === "error"
            ? `${actions.length} warnings \u2022 breach lookup failed`
            : `${actions.length} warnings \u2022 breach lookup unavailable`
        : isError
        ? result.error ?? "Lookup failed"
        : isUnavailable
        ? result.error ?? "Service unavailable"
        : "Direct API lookup is currently unavailable";
    const retryFetch = () => {
        invalidateWarnings(user.id);
        setRefreshKey(current => current + 1);
    };
    const openCaptchaWindow = async () => {
        if (Native.openCaptchaWindow) {
            await Native.openCaptchaWindow(user.id);
            retryFetch();
            return;
        }

        VencordNative.native.openExternal(buildDsaBrowseUrl(user.id));
        retryFetch();
    };
    const visibleActions = isReady && isExpanded ? actions : isReady ? actions.slice(0, MAX_VISIBLE_CARDS) : [];
    const visibleBreaches = isExpanded ? breaches : breaches.slice(0, MAX_VISIBLE_CARDS);

    const content = (
        <section className={classes(cl("section"), isLightTheme && cl("light"))}>
            <div className={cl("header")}>
                <div className={cl("header-main")}>
                    <BaseText className={cl("title")} size="md" weight="bold" defaultColor={false}>Active DSA Warnings</BaseText>
                    <BaseText className={cl("count")} size="xs" weight="semibold" defaultColor={false}>{subtitle}</BaseText>
                </div>
                <Clickable className={cl("open")} onClick={() => VencordNative.native.openExternal(buildDsaBrowseUrl(user.id))} aria-label="Open DSA lookup">
                    <BaseText tag="span" size="xs" weight="bold" defaultColor={false}>Open DSA Lookup</BaseText>
                </Clickable>
            </div>

            {isReady && userInfo && (
                <UserInfoSection userInfo={userInfo} />
            )}

            <div className={cl("list")}>
                {result == null && (
                    <StatusCard
                        title="Loading Warnings"
                        message="Fetching active DSA warnings for this profile."
                    />
                )}
                {isReady && visibleActions.length > 0 && visibleActions.map(action => {
                    const restrictionLabels = getActiveRestrictionLabels(action).slice(0, 2);
                    const tags = getCardTags(action);
                    const illegality = formatIllegality(action.incompatibleContentIllegal);

                    return (
                        <Clickable
                            className={cl("card")}
                            key={action.uuid}
                            onClick={() => VencordNative.native.openExternal(buildDsaBrowseUrl(action.parsedId))}
                            aria-label={`Open DSA warning ${formatLabel(action.category)}`}
                        >
                            <div className={cl("card-top")}>
                                <div className={cl("card-left")}>
                                    <div className={cl("glyph")}>!</div>
                                    <div className={cl("card-content")}>
                                        <div className={cl("chip-row")}>
                                            <span className={cl("chip", "chip-user")}>User Action</span>
                                            {restrictionLabels.map(label => (
                                                <span className={cl("chip", "chip-restriction")} key={label}>
                                                    {formatLabel(label)}
                                                </span>
                                            ))}
                                            {illegality === "Yes" && (
                                                <span className={cl("chip", "chip-illegal")}>Illegal</span>
                                            )}
                                        </div>
                                        <BaseText className={cl("category")} size="xl" weight="extrabold" defaultColor={false}>
                                            {formatLabel(action.category)}
                                        </BaseText>
                                        <BaseText className={cl("facts")} size="sm" weight="medium" defaultColor={false}>
                                            {action.decisionFacts}
                                        </BaseText>
                                        <div className={cl("details")}>
                                            {action.incompatibleContentExplanation && (
                                                <ActionDetailRow label="Explanation" value={action.incompatibleContentExplanation} />
                                            )}
                                            {action.incompatibleContentGround && (
                                                <ActionDetailRow label="Ground" value={formatLabel(action.incompatibleContentGround)} />
                                            )}
                                            {action.decisionGround && action.decisionGround !== action.incompatibleContentGround && (
                                                <ActionDetailRow label="Decision ground" value={formatLabel(action.decisionGround)} />
                                            )}
                                            {action.categorySpecificationOther && (
                                                <ActionDetailRow label="Sub-category" value={action.categorySpecificationOther} />
                                            )}
                                            {action.sourceType && (
                                                <ActionDetailRow label="Source" value={formatLabel(action.sourceType)} />
                                            )}
                                            {action.automatedDetection && action.automatedDetection !== "" && (
                                                <ActionDetailRow label="Automated" value={String(action.automatedDetection)} />
                                            )}
                                            {illegality != null && (
                                                <ActionDetailRow label="Illegal content" value={illegality} />
                                            )}
                                        </div>
                                        {!!tags.length && (
                                            <div className={cl("chip-row")}>
                                                {tags.map(tag => (
                                                    <span className={cl("chip", "chip-tag")} key={tag}>
                                                        {formatLabel(tag)}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className={cl("card-meta")}>
                                <BaseText className={cl("date")} size="xs" weight="bold" defaultColor={false}>
                                    {formatDate(action.applicationDate)}
                                </BaseText>
                                {action.createdAt && action.createdAt !== action.applicationDate && (
                                    <BaseText className={cl("date")} size="xs" weight="medium" defaultColor={false}>
                                        Created {formatDate(action.createdAt)}
                                    </BaseText>
                                )}
                            </div>
                        </Clickable>
                    );
                })}
                {isReady && visibleBreaches.map((breach, index) => {
                    const tags = getBreachTags(breach);

                    return (
                        <Clickable
                            className={classes(cl("card"), cl("card-breach"))}
                            key={`${breach.source}-${breach.id || breach.no || index}`}
                            onClick={() => VencordNative.native.openExternal(buildCordCatUrl(user.id))}
                            aria-label={`Open breach result ${getBreachName(breach)}`}
                        >
                            <div className={cl("card-top")}>
                                <div className={cl("card-left")}>
                                    <div className={classes(cl("glyph"), cl("glyph-breach"))}>!</div>
                                    <div className={cl("card-content")}>
                                        <div className={cl("chip-row")}>
                                            <span className={cl("chip", "chip-breach")}>Data Breach</span>
                                            <span className={cl("chip", "chip-tag")}>{breach.source}</span>
                                        </div>
                                        <BaseText className={cl("category")} size="xl" weight="extrabold" defaultColor={false}>
                                            {getBreachName(breach)}
                                        </BaseText>
                                        <BaseText className={cl("facts")} size="sm" weight="medium" defaultColor={false}>
                                            {getBreachSummary(breach)}
                                        </BaseText>
                                        <div className={cl("details")}>
                                            {breach.ip && breach.ip !== "None" && (
                                                <ActionDetailRow label="IP" value={breach.ip} />
                                            )}
                                            {breach.discordid && (
                                                <ActionDetailRow label="Discord ID" value={breach.discordid} />
                                            )}
                                            {(breach.discriminator || breach.tag) && (
                                                <ActionDetailRow label="Tag" value={`#${breach.discriminator || breach.tag}`} />
                                            )}
                                        </div>
                                        {!!tags.length && (
                                            <div className={cl("chip-row")}>
                                                {tags.map(tag => (
                                                    <span className={cl("chip", "chip-breach-tag")} key={tag}>
                                                        {formatLabel(tag)}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className={cl("card-meta")}>
                                <BaseText className={cl("date")} size="xs" weight="bold" defaultColor={false}>
                                    {breach.date ? formatDate(breach.date) : "Unknown date"}
                                </BaseText>
                            </div>
                        </Clickable>
                    );
                })}
                {isReady && actions.length === 0 && breaches.length === 0 && (
                    <StatusCard
                        title="No Intelligence Results"
                        message="No active warnings or breach results were returned for this profile."
                        onClick={() => VencordNative.native.openExternal(buildDsaBrowseUrl(user.id))}
                    />
                )}
                {isReady && breachStatus === "error" && (
                    <StatusCard
                        title="Breach Lookup Error"
                        message={breachError ?? "The upstream breach provider returned an error for this lookup."}
                        onClick={() => VencordNative.native.openExternal(buildCordCatUrl(user.id))}
                    />
                )}
                {isReady && breachStatus === "unavailable" && breaches.length === 0 && (
                    <StatusCard
                        title="Breach Lookup Unavailable"
                        message="CordCat returned the user intelligence report, but the upstream breach provider was blocked or unavailable for this lookup."
                        onClick={() => VencordNative.native.openExternal(buildCordCatUrl(user.id))}
                    />
                )}
                {isUnavailable && (
                    <StatusCard
                        title="Lookup Unavailable"
                        message={result.error ?? "The DSA service is temporarily unavailable. Click to retry in the public lookup page."}
                        onClick={() => VencordNative.native.openExternal(buildDsaBrowseUrl(user.id))}
                    />
                )}
                {isError && (
                    <StatusCard
                        title="Lookup Failed"
                        message={result.error ?? "The DSA lookup request failed. Click to retry with a local lookup window."}
                        onClick={openCaptchaWindow}
                    />
                )}
            </div>
            {isReady && (actions.length > MAX_VISIBLE_CARDS || breaches.length > MAX_VISIBLE_CARDS || actions.length + breaches.length > MAX_VISIBLE_CARDS) && (
                <Clickable
                    className={cl("toggle")}
                    onClick={() => setExpandedUserId(current => current === user.id ? null : user.id)}
                    aria-label={isExpanded ? "Show fewer DSA results" : "Show all DSA results"}
                >
                    <BaseText className={cl("toggle-text")} tag="span" size="xs" weight="bold" defaultColor={false}>
                        {isExpanded ? "Show Less" : `Show All ${actions.length + breaches.length} Results`}
                    </BaseText>
                </Clickable>
            )}
        </section>
    );

    return isSideBar
        ? <div className={classes(DMSideBarClasses.widgetPreviews, cl("sidebar"))}>{content}</div>
        : content;
}, { noop: true });

export default definePlugin({
    name: "DsaWarnings",
    description: "Shows active DSA standing warnings on user profiles.",
    tags: ["Privacy", "Utility"],
    authors: [EquicordDevs.omaw],
    settings,
    settingsAboutComponent: ApiKeyNotice,
    managedStyle,
    renderProfileCollection: {
        priority: 0,
        render: (props: { user: User; isSideBar?: boolean; displayProfile?: { themeColors?: number[] | null; accentColor?: number | null; }; }) => <DsaWarningsCollection {...props} />,
    },
});
