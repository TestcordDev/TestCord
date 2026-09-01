/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { copyWithToast, openImageModal } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { classes } from "@utils/misc";
import { saveFile } from "@utils/web";
import { findComponentByCodeLazy } from "@webpack";
import { ExpressionPickerStore, FluxDispatcher, showToast, Toasts, useEffect, useMemo, useRef, useState } from "@webpack/common";
import { Dispatch, ReactNode, SetStateAction } from "react";

import { cl, ManaSearchBarProps, Native, NativeMediaResult, PinterestImageResult, PinterestPickerProps, PinterestSearchPayload, SearchBucketState, SearchKind, SearchTarget, settings } from "./shared";

const ManaSearchBar = findComponentByCodeLazy<ManaSearchBarProps>("MagnifyingGlassIcon", "clearable");
const logger = new Logger("PinterestSearch");

function createEmptyBucket(): SearchBucketState {
    return {
        data: null,
        activeQuery: "",
        bookmark: null,
        page: 0,
        loadingNextPage: false,
        error: ""
    };
}

function getSearchKinds(target: SearchTarget): SearchKind[] {
    return target === "ALL" ? ["AVATAR", "BANNER"] : [target];
}

function getPrimaryKind(target: SearchTarget): SearchKind {
    if (target === "ALL") return "AVATAR";
    return target;
}

function targetLabel(target: SearchKind) {
    if (target === "IMAGE") return "image";
    return target === "AVATAR" ? "avatar" : "banner";
}

function getResultLabel(result: PinterestImageResult) {
    if (result.title.trim()) return result.title;

    try {
        const { pathname } = new URL(result.url);
        const filename = pathname.split("/").pop()?.trim();
        if (!filename) return "Pinterest image";
        return decodeURIComponent(filename);
    } catch {
        return "Pinterest image";
    }
}

interface PendingImageAsset {
    assetOrigin: "NEW_ASSET";
    imageUri: string;
    description: string;
}

interface PendingProfileActionPayload {
    pendingAvatar?: PendingImageAsset;
    pendingBanner?: string;
}

function setPendingProfileChanges(payload: PendingProfileActionPayload, guildId?: string) {
    FluxDispatcher.dispatch({
        type: "USER_PROFILE_SETTINGS_SET_PENDING_CHANGES",
        ...(guildId ? { guildId } : {}),
        ...payload
    });
}

function getPendingImageAsset(image: string, description: string): PendingImageAsset {
    return {
        assetOrigin: "NEW_ASSET",
        imageUri: image,
        description
    };
}

function applyImageData(image: string, target: SearchKind, filename: string, guildId?: string) {
    const payload: PendingProfileActionPayload = target === "BANNER"
        ? { pendingBanner: image }
        : { pendingAvatar: getPendingImageAsset(image, `pinterest-${filename || "image"}`) };

    setPendingProfileChanges(payload, guildId);
}

async function applyProfileResult(result: PinterestImageResult, target: SearchKind, guildId?: string) {
    try {
        const media = await Native.fetchMedia(result.url) as NativeMediaResult;
        applyImageData(media.dataUrl, target, media.filename, guildId);
    } catch (error) {
        logger.error("Failed to apply Pinterest result", error);
        copyWithToast(result.url, "Media URL copied to clipboard.");
        showToast("Could not apply that media. The URL was copied instead.", Toasts.Type.FAILURE);
    }
}

async function saveResult(result: PinterestImageResult) {
    try {
        const media = await Native.fetchMedia(result.url) as NativeMediaResult;
        saveFile(new File([media.data], media.filename, { type: media.type }));
    } catch (error) {
        logger.error("Failed to save Pinterest result", error);
        showToast("Could not save that media.", Toasts.Type.FAILURE);
    }
}

function PillButton({
    children,
    compact = false,
    onClick,
    disabled = false,
    type = "button"
}: {
    children: ReactNode;
    compact?: boolean;
    onClick?(): void;
    disabled?: boolean;
    type?: "button" | "submit";
}) {
    return (
        <button
            type={type}
            className={classes(cl("button"), compact && cl("button-compact"))}
            onClick={onClick}
            disabled={disabled}
        >
            {children}
        </button>
    );
}

function SelectionDropdown({
    target,
    open,
    onToggle,
    onSelect
}: {
    target: SearchTarget;
    open: boolean;
    onToggle(): void;
    onSelect(target: SearchTarget): void;
}) {
    const options: SearchTarget[] = ["ALL", "AVATAR", "BANNER"];

    return (
        <div className={cl("selection-wrap")}>
            <button type="button" className={cl("selection-button")} onClick={onToggle}>
                <span>{target === "ALL" ? "All" : target === "AVATAR" ? "Avatar" : "Banner"}</span>
                <span className={cl("selection-caret")}>⌄</span>
            </button>
            {open ? (
                <div className={cl("selection-menu")}>
                    {options.map(option => (
                        <button
                            key={option}
                            type="button"
                            className={classes(cl("selection-item"), option === target && cl("selection-item-active"))}
                            onClick={() => onSelect(option)}
                        >
                            {option === "ALL" ? "All" : option === "AVATAR" ? "Avatar" : "Banner"}
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

function ResultMenu({
    result,
    open,
    onToggle
}: {
    result: PinterestImageResult;
    open: boolean;
    onToggle(): void;
}) {
    function closeMenu() {
        onToggle();
    }

    return (
        <div className={cl("menu-wrap")}>
            <button
                type="button"
                className={cl("menu-button")}
                onClick={event => {
                    event.stopPropagation();
                    onToggle();
                }}
            >
                <span className={cl("menu-button-dots")} aria-hidden="true">⋯</span>
            </button>
            {open ? (
                <div className={cl("menu")} onClick={event => event.stopPropagation()}>
                    <div className={cl("menu-info")}>{result.width} x {result.height}</div>
                    <button type="button" className={cl("menu-item")} onClick={() => {
                        copyWithToast(result.url, "Media URL copied to clipboard.");
                        closeMenu();
                    }}>
                        Copy URL
                    </button>
                    <button type="button" className={cl("menu-item")} onClick={() => {
                        openImageModal({ url: result.url, original: result.url, width: result.width, height: result.height });
                        closeMenu();
                    }}>
                        Preview
                    </button>
                    <button type="button" className={cl("menu-item")} onClick={() => {
                        void saveResult(result);
                        closeMenu();
                    }}>
                        Save media
                    </button>
                    {result.pinterestUrl ? (
                        <button type="button" className={cl("menu-item")} onClick={() => {
                            VencordNative.native.openExternal(result.pinterestUrl!);
                            closeMenu();
                        }}>
                            Open pin
                        </button>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

function ResultsSection({
    kind,
    bucket,
    menuId,
    gifsOnly,
    slotCount,
    setMenuId,
    setBuckets,
    onLoadNextPage,
    onSelectResult
}: {
    kind: SearchKind;
    bucket: SearchBucketState;
    menuId: string;
    gifsOnly: boolean;
    slotCount: number;
    setMenuId: Dispatch<SetStateAction<string>>;
    setBuckets: Dispatch<SetStateAction<Record<SearchKind, SearchBucketState>>>;
    onLoadNextPage(kind: SearchKind): void;
    onSelectResult(result: PinterestImageResult, kind: SearchKind): void;
}) {
    const visibleResults = useMemo(() => {
        const results = bucket.data?.results ?? [];
        return gifsOnly ? results.filter(result => result.isGif) : results;
    }, [bucket.data, gifsOnly]);

    const totalPages = Math.max(1, Math.ceil(visibleResults.length / slotCount));
    const pagedResults = visibleResults.slice(bucket.page * slotCount, bucket.page * slotCount + slotCount);
    const pageLabel = bucket.bookmark?.length ? `Page ${bucket.page + 1}` : `Page ${bucket.page + 1} / ${totalPages}`;

    if (!bucket.error && bucket.data == null) return null;

    return (
        <section className={cl("section")}>
            <div className={cl("section-header")}>
                <div className={cl("section-title")}>
                    {kind === "IMAGE" ? "Images" : kind === "AVATAR" ? "Avatars" : "Banners"}
                </div>
                <div className={cl("page-indicator")}>{pageLabel}</div>
            </div>
            {bucket.error ? <div className={cl("state")}>{bucket.error}</div> : null}
            {pagedResults.length ? (
                <div className={cl("section-body")}>
                    <button
                        type="button"
                        className={classes(cl("page-button"), cl("page-button-side"), cl("page-button-left"))}
                        disabled={bucket.page === 0}
                        onClick={() => setBuckets(current => ({
                            ...current,
                            [kind]: {
                                ...current[kind],
                                page: Math.max(0, current[kind].page - 1)
                            }
                        }))}
                    >
                        ⟵
                    </button>
                    <div className={classes(cl("grid"), kind === "BANNER" && cl("grid-banner"))}>
                        {pagedResults.map(result => (
                            <button
                                key={`${kind}-${result.id}`}
                                type="button"
                                className={cl("card")}
                                onClick={() => onSelectResult(result, kind)}
                            >
                                <div className={cl("card-top")}>
                                    <ResultMenu
                                        result={result}
                                        open={menuId === `${kind}:${result.id}`}
                                        onToggle={() => setMenuId(current => current === `${kind}:${result.id}` ? "" : `${kind}:${result.id}`)}
                                    />
                                </div>
                                <div className={classes(cl("art"), kind === "BANNER" && cl("art-banner"))}>
                                    <img src={result.url} alt={result.title || bucket.activeQuery} />
                                </div>
                                <div className={cl("card-bottom")}>
                                    <div className={cl("card-title")}>{getResultLabel(result)}</div>
                                    <div className={cl("card-meta")}>
                                        {result.isGif ? <span>GIF</span> : <span>Image</span>}
                                        <span>{targetLabel(kind)}</span>
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>
                    <button
                        type="button"
                        className={classes(cl("page-button"), cl("page-button-side"), cl("page-button-right"))}
                        disabled={bucket.loadingNextPage || (bucket.page >= totalPages - 1 && !bucket.bookmark?.length)}
                        onClick={() => {
                            if (bucket.page < totalPages - 1) {
                                setBuckets(current => ({
                                    ...current,
                                    [kind]: {
                                        ...current[kind],
                                        page: Math.min(totalPages - 1, current[kind].page + 1)
                                    }
                                }));
                                return;
                            }

                            onLoadNextPage(kind);
                        }}
                    >
                        {bucket.loadingNextPage ? "…" : "⟶"}
                    </button>
                </div>
            ) : null}
        </section>
    );
}

interface PinterestBrowserProps {
    query: string;
    setQuery(query: string): void;
    clearQuery(): void;
    onSelectResult(result: PinterestImageResult, kind: SearchKind): void;
    rootClassName: string;
    initialTarget: SearchTarget;
    showTargetSelector: boolean;
    panelProps?: {
        id?: string;
        role?: "tabpanel";
        "aria-labelledby"?: string;
    };
}

function PinterestBrowser({
    query,
    setQuery,
    clearQuery,
    onSelectResult,
    rootClassName,
    initialTarget,
    showTargetSelector,
    panelProps
}: PinterestBrowserProps) {
    const { avatarSlots, bannerSlots } = settings.use(["avatarSlots", "bannerSlots"]);

    const scrollRef = useRef<HTMLDivElement>(null);
    const [target, setTarget] = useState<SearchTarget>(initialTarget);
    const [gifsOnly, setGifsOnly] = useState(false);
    const [loading, setLoading] = useState(false);
    const [menuId, setMenuId] = useState("");
    const [selectionOpen, setSelectionOpen] = useState(false);
    const [lastSearchQuery, setLastSearchQuery] = useState("");
    const [buckets, setBuckets] = useState<Record<SearchKind, SearchBucketState>>({
        IMAGE: createEmptyBucket(),
        AVATAR: createEmptyBucket(),
        BANNER: createEmptyBucket()
    });

    const resultsPerRequest = Math.max(avatarSlots, bannerSlots) * 10;

    async function runSearch(nextQuery = query) {
        const trimmed = nextQuery.trim();
        if (!trimmed || loading) return;

        const kinds = getSearchKinds(target);

        setLoading(true);
        setBuckets(current => {
            const next = { ...current };
            for (const kind of kinds) {
                next[kind] = { ...next[kind], error: "", page: 0 };
            }
            return next;
        });

        try {
            const responses = await Promise.all(kinds.map(async kind => {
                const response = await Native.search(trimmed, resultsPerRequest, gifsOnly ? "GIFS" : "ALL", [], kind) as PinterestSearchPayload;
                return [kind, response] as const;
            }));

            setBuckets(current => {
                const next = { ...current };
                for (const [kind, response] of responses) {
                    next[kind] = {
                        data: response,
                        activeQuery: response.query,
                        bookmark: response.bookmark,
                        page: 0,
                        loadingNextPage: false,
                        error: ""
                    };
                }
                return next;
            });

            setLastSearchQuery(trimmed);
            setSelectionOpen(false);
            scrollRef.current?.scrollTo({ top: 0 });
        } catch (error) {
            logger.error("Pinterest search failed", error);
            const message = error instanceof Error ? error.message : "Pinterest search failed.";

            setBuckets(current => {
                const next = { ...current };
                for (const kind of kinds) {
                    next[kind] = {
                        ...next[kind],
                        data: null,
                        bookmark: null,
                        loadingNextPage: false,
                        error: message
                    };
                }
                return next;
            });
        } finally {
            setLoading(false);
        }
    }

    async function loadNextPage(kind: SearchKind) {
        const bucket = buckets[kind];
        if (!bucket.data || !bucket.bookmark?.length || bucket.loadingNextPage) return;

        setBuckets(current => ({
            ...current,
            [kind]: {
                ...current[kind],
                loadingNextPage: true
            }
        }));

        try {
            const response = await Native.search(bucket.activeQuery || lastSearchQuery || query, resultsPerRequest, gifsOnly ? "GIFS" : "ALL", bucket.bookmark, kind) as PinterestSearchPayload;
            setBuckets(current => ({
                ...current,
                [kind]: {
                    ...current[kind],
                    data: current[kind].data == null ? response : {
                        query: current[kind].data!.query,
                        guides: current[kind].data!.guides,
                        results: [...current[kind].data!.results, ...response.results],
                        bookmark: response.bookmark
                    },
                    bookmark: response.bookmark,
                    page: current[kind].page + 1,
                    loadingNextPage: false,
                    error: ""
                }
            }));
        } catch (error) {
            logger.error("Pinterest next page failed", error);
            showToast(error instanceof Error ? error.message : "Could not load more Pinterest results.", Toasts.Type.FAILURE);
            setBuckets(current => ({
                ...current,
                [kind]: {
                    ...current[kind],
                    loadingNextPage: false
                }
            }));
        }
    }

    useEffect(() => {
        setMenuId("");
        setSelectionOpen(false);
    }, [target, gifsOnly]);

    useEffect(() => {
        if (!lastSearchQuery || loading) return;
        void runSearch(lastSearchQuery);
    }, [target, gifsOnly]);

    function getGuideSource() {
        const primary = getPrimaryKind(target);
        return buckets[primary].data ?? buckets.IMAGE.data ?? buckets.AVATAR.data ?? buckets.BANNER.data;
    }

    function getPlaceholder() {
        return "Search Pinterest";
    }

    function getSlotCount(kind: SearchKind) {
        if (kind === "IMAGE") return Math.max(avatarSlots, bannerSlots);
        return kind === "AVATAR" ? avatarSlots : bannerSlots;
    }

    const guideSource = getGuideSource();

    return (
        <div {...panelProps} className={rootClassName}>
            <div className={cl("container-header")}>
                <form className={cl("search-shell")} onSubmit={event => {
                    event.preventDefault();
                    void runSearch();
                }}>
                    <div className={cl("search-row")}>
                        <div className={cl("search-field")}>
                            <ManaSearchBar
                                placeholder={getPlaceholder()}
                                query={query}
                                onChange={setQuery}
                                onClear={clearQuery}
                            />
                        </div>
                        <PillButton compact type="submit" disabled={!query.trim() || loading}>
                            {loading ? "..." : "Search"}
                        </PillButton>
                        <button
                            type="button"
                            className={classes(cl("toggle"), gifsOnly && cl("toggle-active"))}
                            onClick={() => setGifsOnly(current => !current)}
                        >
                            <span className={cl("toggle-icon")}>GIF</span>
                        </button>
                        {showTargetSelector ? (
                            <SelectionDropdown
                                target={target}
                                open={selectionOpen}
                                onToggle={() => setSelectionOpen(current => !current)}
                                onSelect={value => {
                                    setTarget(value);
                                    setSelectionOpen(false);
                                }}
                            />
                        ) : null}
                    </div>
                    {guideSource?.guides.length ? (
                        <div className={cl("guides-row")}>
                            {guideSource.guides.slice(0, 6).map(guide => (
                                <button
                                    key={guide.query}
                                    type="button"
                                    className={classes(cl("guide"), guide.query === guideSource.query && cl("guide-active"))}
                                    onClick={() => {
                                        setQuery(guide.query);
                                        void runSearch(guide.query);
                                    }}
                                >
                                    {guide.label}
                                </button>
                            ))}
                        </div>
                    ) : null}
                </form>
            </div>
            <div ref={scrollRef} className={cl("container-body")}>
                {getSearchKinds(target).map(kind => (
                    <ResultsSection
                        key={kind}
                        kind={kind}
                        bucket={buckets[kind]}
                        menuId={menuId}
                        gifsOnly={gifsOnly}
                        slotCount={getSlotCount(kind)}
                        setMenuId={setMenuId}
                        setBuckets={setBuckets}
                        onLoadNextPage={loadNextPage}
                        onSelectResult={onSelectResult}
                    />
                ))}
            </div>
        </div>
    );
}

export function PinterestPicker({ onSelectItem }: PinterestPickerProps) {
    const query = ExpressionPickerStore.useExpressionPickerStore(store => store.searchQuery);

    return (
        <PinterestBrowser
            query={query}
            setQuery={value => ExpressionPickerStore.setSearchQuery(value)}
            clearQuery={() => ExpressionPickerStore.setSearchQuery("")}
            onSelectResult={result => {
                onSelectItem({ url: result.url });
                ExpressionPickerStore.closeExpressionPicker();
            }}
            rootClassName={cl("container")}
            initialTarget="IMAGE"
            showTargetSelector={false}
            panelProps={{
                id: "pinterest-picker-tab-panel",
                role: "tabpanel",
                "aria-labelledby": "pinterest-picker-tab"
            }}
        />
    );
}

export function PinterestProfilePanel({ guildId }: { guildId?: string; }) {
    const [query, setQuery] = useState("");

    return (
        <PinterestBrowser
            query={query}
            setQuery={setQuery}
            clearQuery={() => setQuery("")}
            onSelectResult={(result, kind) => {
                void applyProfileResult(result, kind, guildId);
            }}
            rootClassName={classes(cl("container"), cl("inline-wrap"))}
            initialTarget="ALL"
            showTargetSelector={true}
        />
    );
}
