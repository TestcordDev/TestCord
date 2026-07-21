/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { addContextMenuPatch, findGroupChildrenByChildId, type NavContextMenuPatchCallback, removeContextMenuPatch } from "@api/ContextMenu";
import { TestcordRequestCoordinator } from "@api/index";
import { addServerListElement, removeServerListElement, ServerListRenderPosition } from "@api/ServerList";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { Flex } from "@components/Flex";
import { OpenExternalIcon } from "@components/Icons";
import { TestcordDevs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { getCurrentChannel, getCurrentGuild, getIntlMessage, getUniqueUsername } from "@utils/discord";
import { classes } from "@utils/misc";
import { ModalCloseButton, ModalContent, ModalHeader, ModalProps, ModalRoot, ModalSize, openModal } from "@utils/modal";
import { NoopComponent } from "@utils/react";
import definePlugin, { OptionType } from "@utils/types";
import type { Channel, Embed, Message, User } from "@vencord/discord-types";
import { filters, findByCodeLazy, findComponentByCodeLazy, waitFor } from "@webpack";
import { Avatar, ChannelStore, Constants, ContextMenuApi, FluxDispatcher, Menu, MessageStore, NavigationRouter, PermissionsBits, PermissionStore, React, RestAPI, useCallback, useEffect, useRef, UserSettingsActionCreators, UserStore, useState } from "@webpack/common";

import { SearchModal } from "./SearchModal";
import styles from "./styles.css?managed";

const cl = classNameFactory("vc-search-utility-");

type SearchEngineKey =
    | "google"
    | "duckduckgo"
    | "brave"
    | "bing"
    | "yahoo"
    | "yandex"
    | "github"
    | "reddit"
    | "wikipedia"
    | "startpage"
    | "searx"
    | "custom";

type SelectedTextReplacementEngine = "off" | SearchEngineKey;
type QuickSearchQueryKey = "author_id" | "channel_id" | "content" | "mentions";

interface SearchEngine {
    key: SearchEngineKey;
    label: string;
    template: string;
}

interface QueryOptions {
    offset?: number;
    channel_id?: [string];
    author_id?: [string];
    mentions?: string[];
    max_id?: string;
    min_id?: string;
    pinned?: boolean[];
    include_nsfw?: boolean;
    content?: string;
    sort_order?: "asc" | "desc";
}

interface QuickSearchItem {
    label: string;
    name: string;
    present: boolean;
    queryKey: QuickSearchQueryKey;
    value: string | string[];
}

interface UserContextProps {
    guildId?: string;
    user?: User;
}

interface FullSearchMessageMenuProps {
    navId: string;
    ariaLabel: string;
    message: Message;
    channel: Channel;
    canReport: boolean;
    onHeightUpdate?: () => void;
    onClose: () => void;
    textSelection: string;
    favoriteableType: null;
    favoriteableId: null;
    favoriteableName: null;
    itemHref: undefined;
    itemSrc: undefined;
    itemSafeSrc: undefined;
    itemTextContent: undefined;
    isFullSearchContextMenu: true;
}

interface MessageActionsProps {
    message?: Message;
    isFullSearchContextMenu?: boolean;
}

interface CopyIdMenuItemProps {
    id: string;
    label: string;
}

interface FavoriteGif {
    format: number;
    src: string;
    width: number;
    height: number;
    order: number;
    url: string;
}

interface FavoriteGifPickerInstance {
    dead?: boolean;
    props: {
        favCopy: FavoriteGif[];
        favorites: FavoriteGif[];
    };
    forceUpdate: () => void;
}

interface FavoriteGifSearchBarComponentProps {
    ref?: React.Ref<HTMLElement>;
    autoFocus: boolean;
    size: string;
    onChange: (query: string) => void;
    onClear: () => void;
    query: string;
    placeholder: string;
    className?: string;
}

type FavoriteGifSearchBarComponent = React.FC<FavoriteGifSearchBarComponentProps>;

interface QuickSwitcherResult {
    type: string;
    score: number;
    comparator?: string;
    sortable?: string;
    record?: {
        id?: string;
        name?: string;
        guild_id?: string;
    };
}

interface ReverseImageMessageContextProps {
    reverseImageSearchType?: string;
    itemHref?: string;
    itemSrc?: string;
}

interface ReverseImageContextProps {
    src?: string;
}

interface UrbanDictionaryDefinition {
    author: string;
    definition: string;
    example: string;
    permalink: string;
    thumbs_up: number;
    thumbs_down: number;
    word: string;
    written_on: string;
}

interface QuickSearchModalOptions {
    query: QueryOptions;
    queryString: string;
    guildId?: string;
    channelId?: string;
    title?: string;
}

interface QuickSearchModalProps extends QuickSearchModalOptions {
    modalProps: ModalProps;
}

interface SearchApiResponseBody {
    messages?: Message[][];
    total_results?: number;
}

interface SearchQueryRequest {
    author_id?: string;
    channel_id?: string;
    content?: string;
    include_nsfw?: boolean;
    mentions?: string;
    offset: number;
    sort_by: "timestamp";
    sort_order: "desc";
}

interface MessageCollectionLike {
    forEach: (callback: (message: Message) => void) => void;
}

const webSearchEngines: SearchEngine[] = [
    { key: "google", label: "Google", template: "https://google.com/search?q={query}" },
    { key: "duckduckgo", label: "DuckDuckGo", template: "https://duckduckgo.com/?q={query}" },
    { key: "brave", label: "Brave", template: "https://search.brave.com/search?q={query}" },
    { key: "bing", label: "Bing", template: "https://www.bing.com/search?q={query}" },
    { key: "yahoo", label: "Yahoo", template: "https://search.yahoo.com/search?p={query}" },
    { key: "yandex", label: "Yandex", template: "https://yandex.com/search/?text={query}" },
    { key: "github", label: "GitHub", template: "https://github.com/search?q={query}" },
    { key: "reddit", label: "Reddit", template: "https://www.reddit.com/search?q={query}" },
    { key: "wikipedia", label: "Wikipedia", template: "https://wikipedia.org/w/index.php?search={query}" },
    { key: "startpage", label: "Startpage", template: "https://www.startpage.com/sp/search?query={query}" },
    { key: "searx", label: "searX", template: "https://searx.thegpm.org/search?q={query}" },
    { key: "custom", label: "Custom", template: "custom" }
];

const reverseImageSearchEngines = {
    Google: "https://lens.google.com/uploadbyurl?url=",
    Yandex: "https://yandex.com/images/search?rpt=imageview&url=",
    SauceNAO: "https://saucenao.com/search.php?url=",
    IQDB: "https://iqdb.org/?url=",
    Bing: "https://www.bing.com/images/search?view=detailv2&iss=sbi&q=imgurl:",
    TinEye: "https://www.tineye.com/search?url=",
    ImgOps: "https://imgops.com/start?url="
} as const;

const defaultSearchEngine: SearchEngineKey = "google";
const defaultCustomSearchEngine = "https://google.com/search?q={query}";
const useMessageMenu = findByCodeLazy(".MESSAGE,commandTargetId:") as (props: FullSearchMessageMenuProps) => React.ReactElement | null;
const GuildlessServerListItemComponent = findComponentByCodeLazy("tooltip:", "lowerBadgeSize:");
const GuildedServerListItemPillComponent = findComponentByCodeLazy("overlay:d=!1", "unread:r=!1");

let CopyIdMenuItem: (props: CopyIdMenuItemProps) => React.ReactElement | null = NoopComponent;
let favoriteGifPickerInstance: FavoriteGifPickerInstance | null = null;
let isServerSearchButtonRegistered = false;

waitFor(filters.componentByCode('"cannot copy null text"'), component => CopyIdMenuItem = component);

function renderServerSearchButton() {
    return <SearchServerButton />;
}

function syncServerSearchButton(enabled: boolean) {
    if (enabled) {
        if (isServerSearchButtonRegistered) return;
        addServerListElement(ServerListRenderPosition.Above, renderServerSearchButton);
        isServerSearchButtonRegistered = true;
        return;
    }

    if (!isServerSearchButtonRegistered) return;
    removeServerListElement(ServerListRenderPosition.Above, renderServerSearchButton);
    isServerSearchButtonRegistered = false;
}

export const settings = definePluginSettings({
    maxResults: {
        type: OptionType.NUMBER,
        description: "Maximum number of results to display.",
        default: 100,
    },
    searchTimeout: {
        type: OptionType.NUMBER,
        description: "Delay before search in milliseconds.",
        default: 300,
    },
    minResultsForAPI: {
        type: OptionType.NUMBER,
        description: "Minimum number of results before using the API. Set to 0 to always use it.",
        default: 5,
    },
    apiRequestDelay: {
        type: OptionType.NUMBER,
        description: "Delay between API requests to avoid rate limits.",
        default: 200,
    },
    defaultSearchEngine: {
        type: OptionType.SELECT,
        description: "Default web search engine for slash searches.",
        options: webSearchEngines.map(engine => ({
            label: engine.label,
            value: engine.key,
            default: engine.key === defaultSearchEngine
        }))
    },
    customSearchEngine: {
        type: OptionType.STRING,
        description: "Custom search URL. Use {query} to control where the query is inserted.",
        default: defaultCustomSearchEngine,
        placeholder: defaultCustomSearchEngine,
    },
    selectedTextCustomEngineName: {
        type: OptionType.STRING,
        description: "Name of the custom search engine used for selected text.",
        placeholder: "Custom Engine"
    },
    selectedTextCustomEngineURL: {
        type: OptionType.STRING,
        description: "Custom search URL used for selected text. Use {query} to control where the query is inserted.",
        placeholder: defaultCustomSearchEngine
    },
    selectedTextReplacementEngine: {
        type: OptionType.SELECT,
        description: "Replace Discord's selected text search with one engine instead of a submenu.",
        options: [
            { label: "Off", value: "off", default: true },
            { label: "Custom Engine", value: "custom" },
            ...webSearchEngines
                .filter(engine => engine.key !== "custom")
                .map(engine => ({ label: engine.label, value: engine.key }))
        ]
    },
    searchCurrentChannel: {
        type: OptionType.BOOLEAN,
        description: "Search messages from the current channel by default. Hold Ctrl or Cmd to search the whole server instead.",
        default: false
    },
    urbanResultsAmount: {
        type: OptionType.NUMBER,
        description: "Amount of Urban Dictionary results to fetch before picking the best one.",
        default: 10
    },
    favoriteGifSearchOption: {
        type: OptionType.SELECT,
        description: "Part of the GIF URL used when searching favorite GIFs.",
        options: [
            { label: "Entire URL", value: "url" },
            { label: "Path Only", value: "path" },
            { label: "Host and Path", value: "hostandpath", default: true }
        ]
    },
    showServerSearchButton: {
        type: OptionType.BOOLEAN,
        description: "Show the search button above the server list.",
        default: true,
        onChange: value => syncServerSearchButton(Boolean(value))
    },
    quickSwitcherFrequentEnabled: {
        type: OptionType.BOOLEAN,
        description: "Prioritize your most-used channels in the quick switcher.",
        default: true
    },
    quickSwitcherFrequentMaxResults: {
        type: OptionType.NUMBER,
        description: "Maximum number of frequent channels to inject into quick switcher results.",
        default: 20
    },
    quickSwitcherCurrentGuildFirst: {
        type: OptionType.BOOLEAN,
        description: "Boost quick switcher results from the current server.",
        default: true
    },
    disableGifPickerSearch: {
        type: OptionType.BOOLEAN,
        description: "Disable the GIF picker search bar and suggestions popup.",
        default: false
    },
    disableDmSearchBar: {
        type: OptionType.BOOLEAN,
        description: "Disable the 'Find or start a conversation' search bar in DMs.",
        default: false
    },
    disableCustomSearchPopup: {
        type: OptionType.BOOLEAN,
        description: "Disable the custom search popup and use Discord's native search instead.",
        default: false
    }
});

function getSearchTemplate(engineKey: SearchEngineKey): string {
    if (engineKey === "custom") return settings.store.customSearchEngine || defaultCustomSearchEngine;

    return webSearchEngines.find(engine => engine.key === engineKey)?.template
        ?? webSearchEngines[0].template;
}

function buildSearchUrl(template: string, query: string): string {
    const trimmedTemplate = template.trim() || defaultCustomSearchEngine;
    const encodedQuery = encodeURIComponent(query.trim());
    const normalizedTemplate = /^https?:\/\//i.test(trimmedTemplate)
        ? trimmedTemplate
        : `https://${trimmedTemplate}`;

    if (normalizedTemplate.includes("{query}")) {
        return normalizedTemplate.replaceAll("{query}", encodedQuery);
    }

    if (normalizedTemplate.includes("%s")) {
        return normalizedTemplate.replaceAll("%s", encodedQuery);
    }

    try {
        const url = new URL(normalizedTemplate);

        if (!url.pathname || url.pathname === "/") {
            url.pathname = "/search";
        }

        if (url.searchParams.has("text")) {
            url.searchParams.set("text", query);
            return url.toString();
        }

        if (url.searchParams.has("p")) {
            url.searchParams.set("p", query);
            return url.toString();
        }

        url.searchParams.set("q", query);
        return url.toString();
    } catch {
        return defaultCustomSearchEngine.replace("{query}", encodedQuery);
    }
}

function getSelectedTextSearchEngines(): SearchEngine[] {
    const customLabel = settings.store.selectedTextCustomEngineName?.trim();
    const customTemplate = settings.store.selectedTextCustomEngineURL?.trim();

    if (!customLabel || !customTemplate) {
        return webSearchEngines.filter(engine => engine.key !== "custom");
    }

    return [
        ...webSearchEngines.filter(engine => engine.key !== "custom"),
        { key: "custom", label: customLabel, template: customTemplate }
    ];
}

function getEngineIconUrl(template: string) {
    const normalizedTemplate = template.trim();
    if (!normalizedTemplate) return null;

    try {
        const url = new URL(/^https?:\/\//i.test(normalizedTemplate) ? normalizedTemplate : `https://${normalizedTemplate}`);
        return `https://icons.duckduckgo.com/ip3/${url.hostname}.ico`;
    } catch {
        return null;
    }
}

function makeEngineLabel(label: string, template: string) {
    const iconUrl = getEngineIconUrl(template);

    if (!iconUrl) return label;

    return (
        <Flex gap="0.5em" alignItems="center">
            <img
                aria-hidden="true"
                height={16}
                width={16}
                src={iconUrl}
                style={{ borderRadius: "50%" }}
            />
            {label}
        </Flex>
    );
}

function openExternalSearch(url: string) {
    window.open(url, "_blank");
}

function openSearchModal() {
    openModal(modalProps => React.createElement(SearchModal, { modalProps: modalProps as any }));
}

function isAdvancedSearchButton(button: HTMLButtonElement) {
    const searchableText = `${button.textContent ?? ""} ${button.ariaLabel ?? ""}`.toLowerCase();

    return searchableText.includes("rechercher")
        || searchableText.includes("lancer une conversation")
        || searchableText.includes("search")
        || searchableText.includes("start a conversation");
}

function onDocumentClick(event: Event) {
    if (settings.store.disableCustomSearchPopup) return;

    const { target } = event;
    if (!(target instanceof Element)) return;

    const button = target.closest("button");
    if (!(button instanceof HTMLButtonElement)) return;
    if (!isAdvancedSearchButton(button)) return;

    event.preventDefault();
    event.stopPropagation();
    openSearchModal();
}

function getCorrectUsername(userId: string) {
    const user = UserStore.getUser(userId);
    return user ? getUniqueUsername(user) : userId;
}

function getChannelName(channelId: string) {
    return ChannelStore.getChannel(channelId)?.name ?? "";
}

function getQueryString(query: QueryOptions) {
    return (!query.author_id?.length ? "" : `from: ${getCorrectUsername(query.author_id[0])} `)
        + (!query.channel_id?.length ? "" : `in:#${getChannelName(query.channel_id[0])} `)
        + (!query.mentions?.length ? "" : `mentions: ${getCorrectUsername(query.mentions[0])} `)
        + (!query.content ? "" : query.content.replace(/\n/g, ""));
}

function buildSearchQueryRequest(query: QueryOptions, offset: number): SearchQueryRequest {
    return {
        author_id: query.author_id?.[0],
        channel_id: query.channel_id?.[0],
        content: query.content?.trim() || void 0,
        include_nsfw: query.include_nsfw,
        mentions: query.mentions?.[0],
        offset,
        sort_by: "timestamp",
        sort_order: "desc"
    };
}

function messageMatchesQuery(message: Message, query: QueryOptions) {
    if (query.author_id?.length && message.author?.id !== query.author_id[0]) return false;
    if (query.channel_id?.length && message.channel_id !== query.channel_id[0]) return false;

    if (query.mentions?.length) {
        const mentions = (message.mentions ?? []) as Array<string | { id?: string; }>;
        const mentionIds = new Set(mentions
            .map(mention => typeof mention === "string" ? mention : mention.id)
            .filter((mentionId): mentionId is string => Boolean(mentionId)));
        if (!query.mentions.every(mentionId => mentionIds.has(mentionId))) return false;
    }

    if (query.content?.trim()) {
        const messageContent = message.content?.toLowerCase() ?? "";
        if (!messageContent.includes(query.content.trim().toLowerCase())) return false;
    }

    return true;
}

function getTimestampValue(timestamp: unknown) {
    if (!timestamp) return 0;
    if (timestamp instanceof Date) return timestamp.getTime();

    if (typeof timestamp === "string" || typeof timestamp === "number") {
        return new Date(timestamp).getTime() || 0;
    }

    if (typeof timestamp === "object" && timestamp != null) {
        const objectWithValueOf = timestamp as { valueOf: () => number | string; };
        const value = objectWithValueOf.valueOf();
        if (typeof value === "number") return value;
        if (typeof value === "string") return new Date(value).getTime() || 0;
    }

    return 0;
}

function sortMessages(messages: Message[]) {
    return messages.sort((left, right) => getTimestampValue(right.timestamp) - getTimestampValue(left.timestamp));
}

function collectStoredMessages(channelId: string) {
    const collection = MessageStore.getMessages(channelId) as Map<string, Message> | MessageCollectionLike | null;
    if (!collection) return [] as Message[];

    if (collection instanceof Map) {
        return Array.from(collection.values());
    }

    const messages: Message[] = [];
    collection.forEach(message => messages.push(message));
    return messages;
}

async function searchGuildMessages(guildId: string, query: QueryOptions) {
    const maxResults = settings.store.maxResults ?? 100;
    const collected = new Map<string, Message>();

    for (let offset = 0; offset < maxResults; offset += 25) {
        const requestQuery = buildSearchQueryRequest(query, offset);
        const response = await TestcordRequestCoordinator.request<{ body?: SearchApiResponseBody; }>({
            key: `discord:guild-search:${guildId}:${JSON.stringify(requestQuery)}`,
            ttlMs: 30_000,
            run: () => RestAPI.get({
                url: Constants.Endpoints.SEARCH_GUILD(guildId),
                query: requestQuery
            }) as Promise<{ body?: SearchApiResponseBody; }>,
        });

        const messageGroups = response.body?.messages ?? [];
        if (!messageGroups.length) break;

        for (const message of messageGroups.flat()) {
            if (!message.id || collected.has(message.id) || !messageMatchesQuery(message, query)) continue;
            collected.set(message.id, message);
            if (collected.size >= maxResults) return sortMessages(Array.from(collected.values()));
        }

        const totalResults = response.body?.total_results ?? 0;
        if (offset + 25 >= totalResults) break;
    }

    return sortMessages(Array.from(collected.values()));
}

async function searchChannelMessages(channelId: string, query: QueryOptions) {
    const maxResults = settings.store.maxResults ?? 100;
    const targetChannelId = query.channel_id?.[0] ?? channelId;
    const collected = new Map<string, Message>();

    for (const message of collectStoredMessages(targetChannelId)) {
        if (!message.id || collected.has(message.id) || !messageMatchesQuery(message, query)) continue;
        collected.set(message.id, message);
        if (collected.size >= maxResults) return sortMessages(Array.from(collected.values()));
    }

    let before: string | undefined;

    while (collected.size < maxResults) {
        const messages = await TestcordRequestCoordinator.request<Message[]>({
            key: `discord:messages:${targetChannelId}:before:${before ?? ""}:limit:100`,
            ttlMs: 30_000,
            run: async () => {
                const response = await RestAPI.get({
                    url: `/channels/${targetChannelId}/messages`,
                    query: {
                        before,
                        limit: 100
                    },
                    retries: 1
                }) as { body?: Message[]; };

                return Array.isArray(response.body) ? response.body : [];
            },
            cacheable: Array.isArray,
        });
        if (!messages.length) break;

        for (const message of messages) {
            if (!message.id || collected.has(message.id) || !messageMatchesQuery(message, query)) continue;
            collected.set(message.id, message);
            if (collected.size >= maxResults) return sortMessages(Array.from(collected.values()));
        }

        before = messages.at(-1)?.id;
        if (!before || messages.length < 100) break;
    }

    return sortMessages(Array.from(collected.values()));
}

const QuickSearchResultsModal = ErrorBoundary.wrap(({
    modalProps,
    query,
    queryString,
    guildId,
    channelId,
    title
}: QuickSearchModalProps) => {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [results, setResults] = useState<Message[]>([]);
    const searchKey = JSON.stringify({
        channelId,
        guildId,
        query
    });

    useEffect(() => {
        let cancelled = false;

        void (async () => {
            try {
                const nextResults = guildId
                    ? await searchGuildMessages(guildId, query)
                    : channelId
                        ? await searchChannelMessages(channelId, query)
                        : [];

                if (cancelled) return;
                setResults(nextResults);
                setError(null);
            } catch {
                if (cancelled) return;
                setError("Failed to search messages.");
                setResults([]);
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [searchKey]);

    const navigateToMessage = (message: Message) => {
        const targetGuildId = ChannelStore.getChannel(message.channel_id)?.guild_id ?? guildId ?? "@me";
        NavigationRouter.transitionTo(`/channels/${targetGuildId}/${message.channel_id}/${message.id}`);
        modalProps.onClose();
    };

    const formatTimestamp = (timestamp: Message["timestamp"]) => {
        const date = new Date(getTimestampValue(timestamp));
        if (isNaN(date.getTime())) return "";

        return date.toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short"
        });
    };

    const formatPreview = (message: Message) => {
        if (message.content?.trim()) {
            return message.content.length > 180 ? `${message.content.slice(0, 180)}...` : message.content;
        }

        if (message.attachments?.length) {
            return `${message.attachments.length} attachment${message.attachments.length === 1 ? "" : "s"}`;
        }

        if (message.embeds?.length) {
            return `${message.embeds.length} embed${message.embeds.length === 1 ? "" : "s"}`;
        }

        return "Message has no text content";
    };

    const highlightPreview = (preview: string) => {
        const searchTerm = query.content?.trim();
        if (!searchTerm) return preview;

        const lowerPreview = preview.toLowerCase();
        const lowerSearchTerm = searchTerm.toLowerCase();
        const matchIndex = lowerPreview.indexOf(lowerSearchTerm);
        if (matchIndex === -1) return preview;

        return (
            <>
                {preview.slice(0, matchIndex)}
                <mark>{preview.slice(matchIndex, matchIndex + searchTerm.length)}</mark>
                {preview.slice(matchIndex + searchTerm.length)}
            </>
        );
    };

    return (
        <ModalRoot {...modalProps} size={ModalSize.LARGE} className={cl("root")}>
            <ModalHeader className={cl("header")}>
                <div className={cl("toolbar")}>
                    <div className={cl("search-row")}>
                        <div style={{ minWidth: 0 }}>
                            <div style={{ color: "var(--white-500)", fontSize: 18, fontWeight: 700 }}>
                                {title ?? "Quick Search Results"}
                            </div>
                            <div
                                className={cl("results-stats")}
                                style={{ color: "var(--text-muted)" }}
                            >
                                {(queryString || "Matching messages").trim()}
                                {!loading && !error && ` • ${results.length} result${results.length === 1 ? "" : "s"}`}
                            </div>
                        </div>
                        <ModalCloseButton onClick={modalProps.onClose} />
                    </div>
                </div>
            </ModalHeader>

            <ModalContent className={cl("content")}>
                {loading ? (
                    <div className={cl("loading")}>
                        <div className={cl("spinner")} />
                        <span>Searching...</span>
                    </div>
                ) : error ? (
                    <div className={cl("no-results")}>
                        <span>{error}</span>
                    </div>
                ) : results.length === 0 ? (
                    <div className={cl("no-results")}>
                        <span>No results found.</span>
                    </div>
                ) : (
                    <div className={classes(cl("results", "message-results"), cl("quick-search-results"))}>
                        {results.map(message => {
                            const channel = ChannelStore.getChannel(message.channel_id);
                            const user = UserStore.getUser(message.author.id) ?? message.author;

                            return (
                                <div
                                    key={`${message.channel_id}-${message.id}`}
                                    className={cl("result-item")}
                                    onClick={() => navigateToMessage(message)}
                                    style={{
                                        display: "block",
                                        background: "var(--background-secondary)",
                                        borderColor: "var(--background-modifier-accent)",
                                        color: "var(--text-normal)"
                                    }}
                                >
                                    <div
                                        className={classes(cl("result-content-wrapper"), cl("quick-search-row"))}
                                        style={{
                                            display: "flex",
                                            alignItems: "flex-start",
                                            gap: 14,
                                            width: "100%"
                                        }}
                                    >
                                        <div
                                            className={classes(cl("result-avatar"), cl("quick-search-avatar"))}
                                            style={{
                                                width: 40,
                                                minWidth: 40,
                                                display: "flex",
                                                alignItems: "flex-start",
                                                justifyContent: "center"
                                            }}
                                        >
                                            <Avatar
                                                src={user.getAvatarURL?.(channel?.guild_id, 128) || undefined}
                                                size="SIZE_40"
                                                className={cl("avatar")}
                                            />
                                        </div>
                                        <div
                                            className={classes(cl("result-main"), cl("quick-search-body"))}
                                            style={{
                                                minWidth: 0,
                                                flex: 1,
                                                display: "flex",
                                                flexDirection: "column",
                                                gap: 6,
                                                overflow: "hidden"
                                            }}
                                        >
                                            <div
                                                className={cl("result-header")}
                                                style={{
                                                    display: "flex",
                                                    justifyContent: "space-between",
                                                    alignItems: "center",
                                                    gap: 8,
                                                    minWidth: 0,
                                                    flexWrap: "wrap"
                                                }}
                                            >
                                                <div
                                                    className={classes(cl("result-author"), cl("quick-search-meta"))}
                                                    style={{
                                                        display: "flex",
                                                        alignItems: "center",
                                                        minWidth: 0,
                                                        gap: 8,
                                                        flex: 1,
                                                        flexWrap: "wrap"
                                                    }}
                                                >
                                                    <span
                                                        className={classes(cl("result-author-name"), cl("quick-search-author"))}
                                                        style={{
                                                            color: "var(--white-500)",
                                                            fontSize: 16,
                                                            fontWeight: 600,
                                                            lineHeight: 1.2
                                                        }}
                                                    >
                                                        {user.globalName || user.username || "Unknown user"}
                                                    </span>
                                                    <span
                                                        className={cl("result-channel")}
                                                        style={{
                                                            display: "inline-flex",
                                                            alignItems: "center",
                                                            maxWidth: "100%",
                                                            padding: "2px 8px",
                                                            borderRadius: 999,
                                                            background: "var(--background-modifier-selected)",
                                                            color: "var(--white-500)",
                                                            fontSize: 12,
                                                            fontWeight: 600,
                                                            lineHeight: 1.2,
                                                            whiteSpace: "nowrap"
                                                        }}
                                                    >
                                                        {channel?.name || "Direct Message"}
                                                    </span>
                                                </div>
                                                <span
                                                    className={cl("result-time")}
                                                    style={{
                                                        color: "var(--text-muted)",
                                                        fontSize: 12,
                                                        lineHeight: 1.3,
                                                        flexShrink: 0
                                                    }}
                                                >
                                                    {formatTimestamp(message.timestamp)}
                                                </span>
                                            </div>
                                            <div
                                                className={classes(cl("result-content"), cl("quick-search-preview"))}
                                                style={{
                                                    color: "var(--white-500)",
                                                    fontSize: 15,
                                                    lineHeight: 1.45,
                                                    marginTop: 0,
                                                    wordBreak: "break-word",
                                                    overflowWrap: "anywhere",
                                                    whiteSpace: "pre-wrap"
                                                }}
                                            >
                                                {highlightPreview(formatPreview(message))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </ModalContent>
        </ModalRoot>
    );
}, { noop: true });

function openQuickSearchResults(options: QuickSearchModalOptions) {
    openModal(modalProps => React.createElement(QuickSearchResultsModal, {
        ...options,
        modalProps: modalProps as any
    }));
}

const quickSearchState = { keys: {} as Record<string, boolean> };

const quickSearchContextMenuPatch: NavContextMenuPatchCallback = (children, props) => {
    if (!props) return;
    if (props.channel && !PermissionStore.can(PermissionsBits.VIEW_CHANNEL, props.channel)) return;

    const channelId = props.message?.channel_id || props.channel?.id;
    const guildId = props.guild?.id || getCurrentChannel()?.guild_id || void 0;
    if (!guildId && !channelId) return;

    const userId = props.message?.author?.id || props.user?.id;
    const content = props.message?.content;

    if (children.some(child => child?.props?.id === "quick-search")) return;

    quickSearchState.keys = {};

    const quickSearchItems: QuickSearchItem[] = [
        {
            name: "quick-search-channel",
            label: "Search within channel",
            present: Boolean(channelId),
            value: channelId ?? "",
            queryKey: "channel_id",
        },
        {
            name: "quick-search-author",
            label: "Search from user",
            present: Boolean(userId),
            value: userId ?? "",
            queryKey: "author_id",
        },
        {
            name: "quick-search-mentions",
            label: "Search mentioning user",
            present: Boolean(userId),
            value: userId ? [userId] : [],
            queryKey: "mentions",
        },
        {
            name: "quick-search-content",
            label: "Search message content",
            present: Boolean(content),
            value: content ?? "",
            queryKey: "content",
        }
    ];

    const searchAction = () => {
        const query: QueryOptions = { include_nsfw: true };
        quickSearchItems.forEach(item => {
            if (!quickSearchState.keys[item.name]) return;

            if (item.queryKey === "mentions") {
                query.mentions = Array.isArray(item.value) ? item.value : [item.value];
                return;
            }

            if (item.queryKey === "author_id" || item.queryKey === "channel_id") {
                if (typeof item.value === "string" && item.value) {
                    query[item.queryKey] = [item.value];
                }
                return;
            }

            if (item.queryKey === "content" && typeof item.value === "string") {
                query.content = item.value;
            }
        });

        openQuickSearchResults({
            channelId,
            guildId,
            query,
            queryString: getQueryString(query),
            title: "Quick Search Results"
        });
    };

    children.push(
        <Menu.MenuSeparator />,
        <Menu.MenuItem id="quick-search" label="Quick Search">
            {quickSearchItems.map(item => {
                if (!item.present) return null;
                return (
                    <Menu.MenuCheckboxItem
                        key={item.name}
                        id={item.name}
                        label={item.label}
                        checked={false}
                        action={() => {
                            quickSearchState.keys[item.name] = !(quickSearchState.keys[item.name] ?? false);
                        }}
                    />
                );
            })}
            <Menu.MenuItem
                id="quick-search-start"
                label="Search"
                action={searchAction}
            />
        </Menu.MenuItem>
    );
};

function runUserMessageSearch(user: User, guildId: string, modifierPressed: boolean, isDm: boolean) {
    const searchCurrentChannel = (settings.store.searchCurrentChannel ? !modifierPressed : modifierPressed) && !isDm;
    const query: QueryOptions = { author_id: [user.id] };
    const channel = getCurrentChannel();

    if (searchCurrentChannel && channel) {
        query.channel_id = [channel.id];
    }

    openQuickSearchResults({
        channelId: query.channel_id?.[0],
        guildId,
        query,
        queryString: getQueryString(query),
        title: `Messages from ${getUniqueUsername(user)}`
    });
}

const userMessageSearchContextMenuPatch: NavContextMenuPatchCallback = (children, { guildId, user }: UserContextProps) => {
    if (!guildId || !user) return;

    const group = findGroupChildrenByChildId("user-profile", children);
    if (!group) return;

    group.push(
        <Menu.MenuItem
            id="vc-user-context-search-messages"
            label="Search Messages"
            action={event => runUserMessageSearch(user, guildId, event.ctrlKey || event.metaKey, false)}
        />
    );
};

function makeSelectedTextSearchItem(selection: string) {
    const trimmedSelection = selection.trim();
    if (!trimmedSelection) return null;

    const engines = getSelectedTextSearchEngines();
    const replacementEngine = settings.store.selectedTextReplacementEngine as SelectedTextReplacementEngine;
    const directEngine = replacementEngine === "off"
        ? null
        : engines.find(engine => engine.key === replacementEngine);

    if (directEngine) {
        return (
            <Menu.MenuItem
                id="vc-search-selected-text"
                key="vc-search-selected-text"
                label={`Search with ${directEngine.label}`}
                action={() => openExternalSearch(buildSearchUrl(directEngine.template, trimmedSelection))}
            />
        );
    }

    return (
        <Menu.MenuItem
            id="vc-search-selected-text"
            key="vc-search-selected-text"
            label="Search Text"
        >
            {engines.map(engine => (
                <Menu.MenuItem
                    key={`vc-search-selected-text-${engine.key}`}
                    id={`vc-search-selected-text-${engine.key}`}
                    label={makeEngineLabel(engine.label, engine.template)}
                    action={() => openExternalSearch(buildSearchUrl(engine.template, trimmedSelection))}
                />
            ))}
        </Menu.MenuItem>
    );
}

const selectedTextSearchContextMenuPatch: NavContextMenuPatchCallback = children => {
    const selection = document.getSelection()?.toString().trim();
    if (!selection) return;

    const group = findGroupChildrenByChildId("search-google", children);
    if (!group) return;

    const index = group.findIndex(child => child?.props?.id === "search-google");
    if (index === -1) return;

    const replacement = makeSelectedTextSearchItem(selection);
    if (replacement) {
        group[index] = replacement;
    }
};

function makeReverseImageSearchItem(src: string) {
    return (
        <Menu.MenuItem
            id="vc-search-image"
            key="vc-search-image"
            label="Search Image"
        >
            {Object.entries(reverseImageSearchEngines).map(([engine, template]) => (
                <Menu.MenuItem
                    key={`vc-search-image-${engine}`}
                    id={`vc-search-image-${engine}`}
                    label={makeEngineLabel(engine, template)}
                    action={() => openExternalSearch(template + encodeURIComponent(src))}
                />
            ))}
            <Menu.MenuItem
                id="vc-search-image-all"
                key="vc-search-image-all"
                label={
                    <Flex alignItems="center" gap="0.5em">
                        <OpenExternalIcon height={16} width={16} />
                        All
                    </Flex>
                }
                action={() => Object.values(reverseImageSearchEngines).forEach(template => openExternalSearch(template + encodeURIComponent(src)))}
            />
        </Menu.MenuItem>
    );
}

const reverseImageMessageContextMenuPatch: NavContextMenuPatchCallback = (children, props: ReverseImageMessageContextProps) => {
    if (props.reverseImageSearchType !== "img") return;

    const src = props.itemHref ?? props.itemSrc;
    if (!src) return;

    const group = findGroupChildrenByChildId("copy-link", children);
    group?.push(makeReverseImageSearchItem(src));
};

const reverseImageContextMenuPatch: NavContextMenuPatchCallback = (children, props: ReverseImageContextProps) => {
    if (!props.src) return;

    const group = findGroupChildrenByChildId("copy-native-link", children) ?? children;
    group.push(makeReverseImageSearchItem(props.src));
};

function MessageMenu({ channel, message, onHeightUpdate }: { channel: Channel; message: Message; onHeightUpdate?: () => void; }) {
    const currentUserId = UserStore.getCurrentUser()?.id;
    const canReport = Boolean(message.author && !(message.author.id === currentUserId || message.author.system));

    return useMessageMenu({
        navId: "message-actions",
        ariaLabel: getIntlMessage("MESSAGE_UTILITIES_A11Y_LABEL"),
        message,
        channel,
        canReport,
        onHeightUpdate,
        onClose: () => ContextMenuApi.closeContextMenu(),
        textSelection: "",
        favoriteableType: null,
        favoriteableId: null,
        favoriteableName: null,
        itemHref: void 0,
        itemSrc: void 0,
        itemSafeSrc: void 0,
        itemTextContent: void 0,
        isFullSearchContextMenu: true
    });
}

const fullSearchResultContextMenuPatch: NavContextMenuPatchCallback = (children, props: MessageActionsProps) => {
    if (props.isFullSearchContextMenu == null || !props.message?.author) return;

    const group = findGroupChildrenByChildId("devmode-copy-id", children, true);
    group?.push(
        CopyIdMenuItem({ id: props.message.author.id, label: getIntlMessage("COPY_ID_AUTHOR") })
    );
};

function boostCurrentGuildResults(results: QuickSwitcherResult[]) {
    if (!settings.store.quickSwitcherCurrentGuildFirst) return results;

    const currentGuild = getCurrentGuild();
    if (!currentGuild || !results.length) return results;

    const maxScore = Math.max(...results.map(result => result.score));
    for (const result of results) {
        if (result.record?.guild_id === currentGuild.id) {
            result.score += maxScore;
        }
    }

    return results.sort((a, b) => b.score - a.score);
}

function modifyQuickSwitcherResults(query: string, originalResults: QuickSwitcherResult[]) {
    const baseResults = boostCurrentGuildResults([...originalResults]);
    if (!settings.store.quickSwitcherFrequentEnabled) return baseResults;

    const frequentChannels = UserSettingsActionCreators.FrecencyUserSettingsActionCreators
        .getCurrentValue()
        .guildAndChannelFrecency
        .guildAndChannels;

    const normalizedQuery = query.toLowerCase();
    const frequentResults: QuickSwitcherResult[] = Object.entries(frequentChannels)
        .map(([id]) => id)
        .filter(id => ChannelStore.getChannel(id) != null)
        .filter(id => {
            const channel = ChannelStore.getChannel(id);
            return !query || Boolean(channel?.name?.toLowerCase().includes(normalizedQuery));
        })
        .sort((left, right) => frequentChannels[right].totalUses - frequentChannels[left].totalUses)
        .slice(0, settings.store.quickSwitcherFrequentMaxResults)
        .map(channelId => {
            const channel = ChannelStore.getChannel(channelId)!;
            return {
                type: "TEXT_CHANNEL",
                record: channel,
                score: 20,
                comparator: query,
                sortable: query
            };
        });

    const frequentIds = new Set(frequentResults.map(result => result.record?.id).filter((id): id is string => Boolean(id)));
    return boostCurrentGuildResults(frequentResults.concat(baseResults.filter(result => {
        const recordId = result.record?.id;
        return !recordId || !frequentIds.has(recordId);
    })));
}

function adjustSearchOffset(query: QueryOptions) {
    if ((query.offset ?? 0) <= 5000) return;

    query.sort_order = query.sort_order === "asc" ? "desc" : "asc";
    query.offset = query.offset! > 5000 ? 0 : query.offset;
}

function getFavoriteGifTargetString(urlString: string) {
    let url: URL;
    try {
        url = new URL(urlString);
    } catch {
        return urlString;
    }

    switch (settings.store.favoriteGifSearchOption) {
        case "url":
            return url.href;
        case "path":
            if (url.host === "media.discordapp.net" || url.host === "tenor.com") {
                return url.pathname.split("/").at(-1) ?? url.pathname;
            }

            return url.pathname;
        case "hostandpath":
            if (url.host === "media.discordapp.net" || url.host === "tenor.com") {
                return `${url.host} ${url.pathname.split("/").at(-1) ?? url.pathname}`;
            }

            return `${url.host} ${url.pathname}`;
        default:
            return urlString;
    }
}

function fuzzySearch(searchQuery: string, searchString: string) {
    let searchIndex = 0;
    let score = 0;

    for (let i = 0; i < searchString.length; i++) {
        if (searchString[i] === searchQuery[searchIndex]) {
            score++;
            searchIndex++;
        } else {
            score--;
        }

        if (searchIndex === searchQuery.length) {
            return score;
        }
    }

    return null;
}

function FavoriteGifSearchBar({ SearchBarComponent, instance }: { SearchBarComponent: FavoriteGifSearchBarComponent; instance: FavoriteGifPickerInstance; }) {
    const [query, setQuery] = useState("");
    const ref = useRef<HTMLElement>(null);

    const onChange = useCallback((searchQuery: string) => {
        setQuery(searchQuery);

        if (!searchQuery) {
            instance.props.favorites = instance.props.favCopy;
            instance.forceUpdate();
            return;
        }

        const filteredFavorites = instance.props.favCopy
            .map(gif => ({
                score: fuzzySearch(
                    searchQuery.toLowerCase(),
                    getFavoriteGifTargetString(gif.url ?? gif.src).replace(/(%20|[_-])/g, " ").toLowerCase()
                ),
                gif
            }))
            .filter((result): result is { score: number; gif: FavoriteGif; } => result.score != null)
            .sort((left, right) => right.score - left.score)
            .map(result => result.gif);

        instance.props.favorites = filteredFavorites;
        instance.forceUpdate();
    }, [instance]);

    useEffect(() => () => {
        instance.dead = true;
    }, [instance]);

    return (
        <SearchBarComponent
            ref={ref}
            autoFocus={true}
            size="md"
            className=""
            onChange={onChange}
            onClear={() => {
                setQuery("");
                instance.props.favorites = instance.props.favCopy;
                instance.forceUpdate();
            }}
            query={query}
            placeholder="Search Favorite Gifs"
        />
    );
}

function SearchServerButton() {
    const [hovered, setHovered] = useState(false);

    return (
        <ErrorBoundary noop>
            <div className={cl("server-list-item-container")}>
                <div className={cl("server-list-pill-container")}>
                    <GuildedServerListItemPillComponent
                        unread={false}
                        selected={false}
                        hovered={hovered}
                        className={hovered ? `${cl("server-list-pill")} hovered` : cl("server-list-pill")}
                    />
                </div>
                <div className={cl("server-list-button-container")}>
                    <GuildlessServerListItemComponent
                        showPill={false}
                        tooltip="Search"
                        className={cl("server-list-button")}
                        onMouseEnter={() => setHovered(true)}
                        onMouseLeave={() => setHovered(false)}
                        onClick={() => FluxDispatcher.dispatch({
                            type: "QUICKSWITCHER_SHOW",
                            query: "",
                            queryMode: null
                        })}
                        icon={() => (
                            <div className={cl("server-list-icon-container")}>
                                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="none" viewBox="0 0 24 24" className={cl("server-search-button-icon")}>
                                    <path
                                        fill="currentColor"
                                        fillRule="evenodd"
                                        d="M15.62 17.03a9 9 0 1 1 1.41-1.41l4.68 4.67a1 1 0 0 1-1.421.42l-4.67-4.68ZM17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z"
                                        clipRule="evenodd"
                                    />
                                </svg>
                            </div>
                        )}
                    />
                </div>
            </div>
        </ErrorBoundary>
    );
}

export default definePlugin({
    name: "SearchUtility",
    description: "Combines the web, message, media, quick switcher, and advanced search plugins into one utility.",
    tags: ["Utility", "Servers"],
    authors: [TestcordDevs.x2b],
    dependencies: ["CommandsAPI"],
    settings,
    styles,
    patches: [
        {
            find: "onClick:this.handleMessageClick,",
            noWarn: true,
            replacement: {
                match: /this(?=\.handleContextMenu\(\i,\i\))/,
                replace: "$self"
            }
        },
        {
            find: "#{intl::MESSAGE_ACTIONS_MENU_LABEL}),shouldHideMediaOptions:",
            noWarn: true,
            replacement: {
                match: /favoriteableType:\i,(?<=(\i)\.getAttribute\("data-type"\).+?)/,
                replace: (match, target) => `${match}reverseImageSearchType:${target}.getAttribute("data-role"),`
            }
        },
        {
            find: "renderHeaderContent()",
            predicate: () => settings.store.disableGifPickerSearch,
            noWarn: true,
            replacement: {
                match: /(,suggestions:)\i,/,
                replace: "$1null,"
            }
        },
        {
            find: 'tutorialId:"direct-messages",',
            predicate: () => settings.store.disableDmSearchBar,
            noWarn: true,
            replacement: {
                match: /\(0,\i\.jsx\)\(\i\.\i,{.{0,50}?tutorialId:"direct-messages",.{0,600}?\}\)\}\)\}\),/,
                replace: ""
            }
        },
        {
            find: "\"SearchQueryStore\";",
            noWarn: true,
            replacement: {
                match: /\i\.searchResultsQuery=(\i)/,
                replace: "$&,$self.adjustSearchOffset($1)"
            }
        },
        {
            find: "#{intl::QUICKSWITCHER_PLACEHOLDER}",
            noWarn: true,
            replacement: {
                match: /renderInput\(\)\{return/,
                replace: "renderInput(){try{this.props.results=Vencord.Plugins.plugins['SearchUtility'].modifyQuickSwitcherResults(this.state.query,this.props.results)}catch(e){}return"
            }
        }
    ],
    commands: [
        {
            inputType: ApplicationCommandInputType.BUILT_IN,
            name: "search",
            description: "Search the web with your preferred engine.",
            options: [
                {
                    type: ApplicationCommandOptionType.STRING,
                    name: "query",
                    description: "What you want to search for.",
                    required: true
                },
                {
                    type: ApplicationCommandOptionType.STRING,
                    name: "engine",
                    description: "Which search engine to use.",
                    required: false,
                    choices: webSearchEngines.map(choice => ({
                        name: choice.label,
                        label: choice.label,
                        value: choice.key
                    }))
                }
            ],
            execute(args) {
                const query = findOption<string>(args, "query", "").trim();
                const engineKey = findOption<SearchEngineKey>(args, "engine", settings.store.defaultSearchEngine || defaultSearchEngine);

                if (!query) {
                    return { content: "Please provide a search query." };
                }

                return { content: buildSearchUrl(getSearchTemplate(engineKey), query) };
            }
        },
        {
            inputType: ApplicationCommandInputType.BUILT_IN,
            name: "urban",
            description: "Return the best Urban Dictionary definition for a word.",
            options: [
                {
                    type: ApplicationCommandOptionType.STRING,
                    name: "word",
                    description: "The word to search for on Urban Dictionary.",
                    required: true
                }
            ],
            async execute(args, ctx) {
                const word = findOption<string>(args, "word", "").trim();
                if (!word) {
                    return { content: "Please provide a word to search for." };
                }

                try {
                    const query = encodeURIComponent(word);
                    const { list } = await TestcordRequestCoordinator.request<{ list: UrbanDictionaryDefinition[]; }>({
                        key: `external:urban:${word.toLowerCase()}:${settings.store.urbanResultsAmount}`,
                        ttlMs: 30 * 60_000,
                        run: async () => {
                            const response = await fetch(`https://api.urbandictionary.com/v0/define?term=${query}&per_page=${settings.store.urbanResultsAmount}`);
                            return await response.json() as { list: UrbanDictionaryDefinition[]; };
                        },
                    });

                    if (!list.length) {
                        sendBotMessage(ctx.channel.id, { content: "No results found." });
                        return;
                    }

                    const definition = list.reduce((best, current) => best.thumbs_up > current.thumbs_up ? best : current);
                    const linkify = (text: string) => text
                        .replaceAll("\r\n", "\n")
                        .replace(/([*>_`~\\])/gsi, "\\$1")
                        .replace(/\[(.+?)\]/g, (_, entry) => `[${entry}](https://www.urbandictionary.com/define.php?term=${encodeURIComponent(entry)} "Define '${entry}' on Urban Dictionary")`)
                        .trim();

                    const embed: Embed = {
                        id: "",
                        url: definition.permalink,
                        type: "rich",
                        rawTitle: definition.word,
                        rawDescription: linkify(definition.definition),
                        referenceId: void 0,
                        flags: void 0,
                        contentScanVersion: 0,
                        author: {
                            name: `Uploaded by "${definition.author}"`,
                            url: `https://www.urbandictionary.com/author.php?author=${encodeURIComponent(definition.author)}`,
                            iconURL: void 0,
                            iconProxyURL: void 0
                        },
                        footer: {
                            text: `👍 ${definition.thumbs_up.toString()} | 👎 ${definition.thumbs_down.toString()}`,
                            iconURL: "https://www.urbandictionary.com/favicon.ico",
                            iconProxyURL: void 0
                        },
                        timestamp: new Date(definition.written_on),
                        color: "#FF9900",
                        fields: [
                            {
                                rawName: "Example",
                                rawValue: linkify(definition.example) || "No example provided.",
                                inline: false
                            },
                            {
                                rawName: "Want more definitions?",
                                rawValue: `Check out [more definitions](https://www.urbandictionary.com/define.php?term=${query}) on Urban Dictionary.`,
                                inline: false
                            }
                        ]
                    };

                    sendBotMessage(ctx.channel.id, { embeds: [embed] });
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    sendBotMessage(ctx.channel.id, { content: `Something went wrong: \`${message}\`.` });
                }
            }
        }
    ],
    openSearchModal,
    handleContextMenu(event: React.MouseEvent, message: Message) {
        const channel = ChannelStore.getChannel(message.channel_id);
        if (!channel) return;

        event.stopPropagation();

        ContextMenuApi.openContextMenu(event, contextMenuProps => (
            <MessageMenu
                message={message}
                channel={channel}
                onHeightUpdate={contextMenuProps.onHeightUpdate}
            />
        ));
    },
    modifyQuickSwitcherResults(query: string, originalResults: QuickSwitcherResult[]) {
        return modifyQuickSwitcherResults(query, originalResults);
    },
    adjustSearchOffset(query: QueryOptions) {
        adjustSearchOffset(query);
    },
    renderFavoriteGifSearchBar(instance: FavoriteGifPickerInstance, SearchBarComponent: FavoriteGifSearchBarComponent) {
        favoriteGifPickerInstance = instance;

        return (
            <ErrorBoundary noop>
                <FavoriteGifSearchBar instance={instance} SearchBarComponent={SearchBarComponent} />
            </ErrorBoundary>
        );
    },
    getFavoriteGifs(favorites: FavoriteGif[]) {
        if (!favoriteGifPickerInstance || favoriteGifPickerInstance.dead) return favorites;

        const filteredFavorites = favoriteGifPickerInstance.props.favorites;
        return filteredFavorites.length !== favorites.length ? filteredFavorites : favorites;
    },
    start() {
        addContextMenuPatch(["message", "channel-context", "user-context"], quickSearchContextMenuPatch);
        addContextMenuPatch("user-context", userMessageSearchContextMenuPatch);
        addContextMenuPatch("message", selectedTextSearchContextMenuPatch);
        addContextMenuPatch("message", reverseImageMessageContextMenuPatch);
        addContextMenuPatch("image-context", reverseImageContextMenuPatch);
        addContextMenuPatch("message-actions", fullSearchResultContextMenuPatch);
        syncServerSearchButton(settings.store.showServerSearchButton);
        document.addEventListener("click", onDocumentClick, true);
    },
    stop() {
        removeContextMenuPatch(["message", "channel-context", "user-context"], quickSearchContextMenuPatch);
        removeContextMenuPatch("user-context", userMessageSearchContextMenuPatch);
        removeContextMenuPatch("message", selectedTextSearchContextMenuPatch);
        removeContextMenuPatch("message", reverseImageMessageContextMenuPatch);
        removeContextMenuPatch("image-context", reverseImageContextMenuPatch);
        removeContextMenuPatch("message-actions", fullSearchResultContextMenuPatch);
        syncServerSearchButton(false);
        favoriteGifPickerInstance = null;
        document.removeEventListener("click", onDocumentClick, true);
    }
});
