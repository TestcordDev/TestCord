/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import "./styles.css";
import { addGlobalContextMenuPatch, findGroupChildrenByChildId, removeGlobalContextMenuPatch } from "@api/ContextMenu";
import { DataStore } from "@api/index";
import { definePluginSettings } from "@api/Settings";
import { BaseText } from "@components/BaseText";
import { Button } from "@components/Button";
import { PencilIcon } from "@components/Icons";
import { Paragraph } from "@components/Paragraph";
import { Devs, EquicordDevs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { EmojiStore, Menu, openModal, TextInput, Toasts, useEffect, useState } from "@webpack/common";
import { ClearAliasesConfirmModal } from "./components/modals/ClearAliasesConfirmModal";
import { SetAliasModal } from "./components/modals/SetAliasModal";
const DATA_KEY = "emoji-aliases";
const logger = new Logger("EmojiAlias");
const EmojiQueryService = findByPropsLazy("queryEmojiResults");
const cl = classNameFactory("vc-emoji-alias-");
let aliasMap = {};
const aliasListeners = new Set();
let globalContextPatch = null;
const NON_EMOJI_NAV_IDS = new Set(["user-context", "guild-context", "channel-context", "gdm-context", "thread-context", "dev-context", "account-context"]);
const unicodeSurrogateCache = new Map();
const aliasResultCache = new Map();
const settings = definePluginSettings({
    aliases: {
        type: 6 /* OptionType.COMPONENT */,
        description: "Manage your emoji aliases.",
        component: AliasListSetting
    },
    clearAll: {
        type: 6 /* OptionType.COMPONENT */,
        description: "Delete all aliases.",
        component: ClearAllAliasesSetting
    }
});
function subscribeAliases(listener) {
    aliasListeners.add(listener);
    return () => {
        aliasListeners.delete(listener);
    };
}
function notifyAliasesChanged() {
    for (const listener of aliasListeners) {
        listener();
    }
}
function normalizeAlias(input) {
    if (typeof input !== "string")
        return "";
    return input.trim().replace(/^:+|:+$/g, "").toLowerCase();
}
function normalizeEmojiName(input) {
    return input.trim().replace(/^:+|:+$/g, "");
}
function normalizeEmojiNameForCompare(input) {
    return normalizeEmojiName(input ?? "").toLowerCase();
}
function getAliasValidationError(input) {
    const normalized = normalizeAlias(input);
    if (!normalized.length)
        return "Alias is required.";
    if (!/^[a-z0-9_]{2,32}$/.test(normalized))
        return "Alias must be 2-32 characters and only use lowercase letters, numbers, or underscores.";
    return null;
}
function isStoredEmojiRef(value) {
    if (!value || typeof value !== "object")
        return false;
    const candidate = value;
    if (candidate.kind !== "custom" && candidate.kind !== "unicode")
        return false;
    if (typeof candidate.name !== "string" || candidate.name.length === 0)
        return false;
    if (candidate.kind === "custom" && (!candidate.id || typeof candidate.id !== "string"))
        return false;
    if (candidate.id != null && typeof candidate.id !== "string")
        return false;
    if (candidate.surrogates != null && typeof candidate.surrogates !== "string")
        return false;
    if (candidate.animated != null && typeof candidate.animated !== "boolean")
        return false;
    return true;
}
function parseAliasMap(value) {
    if (value == null)
        return {};
    if (typeof value !== "object" || Array.isArray(value)) {
        logger.warn("Alias store was invalid and has been reset.");
        return {};
    }
    const parsed = {};
    for (const [alias, ref] of Object.entries(value)) {
        if (!/^[a-z0-9_]{2,32}$/.test(alias) || !isStoredEmojiRef(ref)) {
            logger.warn(`Ignoring invalid alias entry: ${alias}`);
            continue;
        }
        if (ref.kind === "unicode") {
            const surrogate = getUnicodeSurrogate(ref) ?? resolveUnicodeSurrogateByName(ref.name);
            parsed[alias] = {
                ...ref,
                name: normalizeEmojiName(ref.name),
                surrogates: surrogate
            };
            continue;
        }
        parsed[alias] = ref;
    }
    return parsed;
}
async function loadAliases() {
    try {
        aliasMap = parseAliasMap(await DataStore.get(DATA_KEY));
    }
    catch (error) {
        aliasMap = {};
        logger.error("Failed to load emoji aliases.", error);
    }
    unicodeSurrogateCache.clear();
    aliasResultCache.clear();
    notifyAliasesChanged();
}
async function persistAliases(nextMap) {
    aliasMap = nextMap;
    await DataStore.set(DATA_KEY, aliasMap);
    aliasResultCache.clear();
    notifyAliasesChanged();
}
function emojiIdentityFromRef(ref) {
    if (ref.kind === "custom" && ref.id)
        return `custom:${ref.id}`;
    const surrogate = getUnicodeSurrogate(ref)?.trim();
    if (surrogate)
        return `unicode:${surrogate}`;
    return `unicode-name:${ref.name.toLowerCase()}`;
}
function emojiIdentityFromResult(emoji) {
    const customId = emoji.id ?? emoji.emojiObject?.id;
    if (customId)
        return `custom:${customId}`;
    const surrogate = (emoji.surrogates ?? emoji.emojiObject?.surrogates)?.trim();
    if (surrogate)
        return `unicode:${surrogate}`;
    const normalizedName = (emoji.uniqueName ?? emoji.name ?? emoji.emojiObject?.name ?? "").toLowerCase();
    return `unicode-name:${normalizedName}`;
}
function isSameEmoji(left, right) {
    return emojiIdentityFromRef(left) === emojiIdentityFromRef(right);
}
function getEmojiDisplayName(ref) {
    return ref.kind === "custom"
        ? `:${ref.name}:`
        : getUnicodeSurrogate(ref) ?? resolveUnicodeSurrogateByName(ref.name) ?? `:${normalizeEmojiName(ref.name)}:`;
}
function isGifUrl(url) {
    try {
        const parsed = new URL(url);
        return parsed.pathname.endsWith(".gif") || parsed.searchParams.get("animated") === "true";
    }
    catch {
        return false;
    }
}
function extractUnicodeEmoji(text) {
    if (!text)
        return null;
    const match = text.match(/\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*/u);
    return match?.[0] ?? null;
}
function getUnicodeSurrogate(ref) {
    return ref.surrogates ?? extractUnicodeEmoji(ref.name) ?? undefined;
}
function resolveUnicodeSurrogateByName(name) {
    const normalizedName = normalizeEmojiName(name);
    if (!normalizedName.length)
        return undefined;
    const cached = unicodeSurrogateCache.get(normalizedName);
    if (cached !== undefined)
        return cached ?? undefined;
    const queryCandidates = [normalizedName, `:${normalizedName}:`];
    for (const query of queryCandidates) {
        const queried = EmojiQueryService.queryEmojiResults({
            query,
            channel: undefined,
            intention: undefined,
            maxCount: 100
        });
        const unlocked = queried?.emojis?.unlocked;
        if (!unlocked?.length)
            continue;
        for (const result of unlocked) {
            const surrogate = result.surrogates ?? result.emojiObject?.surrogates;
            if (!surrogate)
                continue;
            const resultName = normalizeEmojiNameForCompare(result.uniqueName ?? result.name ?? result.originalName ?? "");
            if (resultName === normalizedName.toLowerCase()) {
                unicodeSurrogateCache.set(normalizedName, surrogate);
                return surrogate;
            }
        }
    }
    unicodeSurrogateCache.set(normalizedName, null);
    return undefined;
}
function getUnicodePreviewUrl(ref) {
    const surrogate = getUnicodeSurrogate(ref) ?? resolveUnicodeSurrogateByName(ref.name);
    if (!surrogate)
        return null;
    const codepoints = Array.from(surrogate)
        .map(char => char.codePointAt(0)?.toString(16))
        .filter((value) => !!value)
        .join("-");
    if (!codepoints.length)
        return null;
    return `https://twemoji.maxcdn.com/v/latest/72x72/${codepoints}.png`;
}
function isDirectUnicodeTarget(target) {
    const text = target.textContent?.trim();
    if (!text)
        return null;
    const unicode = extractUnicodeEmoji(text);
    if (!unicode)
        return null;
    const nonEmoji = text.replace(unicode, "").trim();
    if (nonEmoji.length)
        return null;
    return unicode;
}
function getUnicodeFromNodeTarget(target) {
    if (!target)
        return null;
    if (target.nodeType === Node.TEXT_NODE) {
        const text = target.textContent?.trim();
        if (!text)
            return null;
        const unicode = extractUnicodeEmoji(text);
        if (!unicode)
            return null;
        const nonEmoji = text.replace(unicode, "").trim();
        return nonEmoji.length ? null : unicode;
    }
    if (!(target instanceof HTMLElement))
        return null;
    const roleImg = target.closest("[role='img']");
    const roleText = roleImg?.getAttribute("aria-label") ?? roleImg?.textContent;
    const roleUnicode = extractUnicodeEmoji(roleText);
    if (roleUnicode)
        return roleUnicode;
    return isDirectUnicodeTarget(target);
}
function toEmojiRefFromExpressionTarget(target) {
    const dataset = target?.dataset;
    if (!dataset || dataset.type !== "emoji" || !dataset.name)
        return null;
    const baseName = dataset.name.replace(/~\d+$/, "");
    if (dataset.id) {
        return {
            kind: "custom",
            id: dataset.id,
            name: baseName,
            animated: !!target.firstChild?.src && isGifUrl(target.firstChild.src)
        };
    }
    return {
        kind: "unicode",
        name: baseName,
        surrogates: dataset.surrogates
    };
}
function toEmojiRefFromElementTarget(target) {
    const htmlTarget = target instanceof HTMLElement
        ? target
        : target instanceof Node
            ? target.parentElement
            : null;
    if (!htmlTarget)
        return null;
    const emojiElement = htmlTarget.closest("[data-type='emoji']");
    if (emojiElement) {
        const datasetTarget = {
            dataset: {
                id: emojiElement.dataset.id,
                name: emojiElement.dataset.name,
                surrogates: emojiElement.dataset.surrogates,
                type: emojiElement.dataset.type
            },
            firstChild: emojiElement.firstChild
        };
        const fromDataset = toEmojiRefFromExpressionTarget(datasetTarget);
        if (fromDataset)
            return fromDataset;
    }
    const imageElement = htmlTarget.closest("img");
    const imageSource = imageElement?.src;
    if (!imageSource) {
        const unicode = getUnicodeFromNodeTarget(htmlTarget) ?? extractUnicodeEmoji(imageElement?.alt);
        if (!unicode)
            return null;
        return {
            kind: "unicode",
            name: unicode,
            surrogates: unicode
        };
    }
    const idMatch = imageSource.match(/\/emojis\/(\d+)\.(?:png|gif|webp|jpe?g)/);
    if (!idMatch)
        return null;
    const id = idMatch[1];
    const fromStore = EmojiStore.getCustomEmojiById(id);
    const resolvedName = fromStore?.name
        ?? imageElement.alt?.replace(/^:|:$/g, "")
        ?? "emoji";
    return {
        kind: "custom",
        id,
        name: resolvedName,
        animated: !!fromStore?.animated || isGifUrl(imageSource)
    };
}
function toEmojiRefFromHrefContext(args) {
    const source = args.itemHref ?? args.itemSrc;
    if (!source) {
        const unicode = extractUnicodeEmoji(args.itemTextContent);
        if (!unicode)
            return null;
        return {
            kind: "unicode",
            name: unicode,
            surrogates: unicode
        };
    }
    const match = source.match(/\/emojis\/(\d+)\.(?:png|gif|webp|jpe?g)/);
    if (!match)
        return null;
    const id = match[1];
    const fromStore = EmojiStore.getCustomEmojiById(id);
    if (fromStore) {
        return {
            kind: "custom",
            id,
            name: fromStore.name,
            animated: !!fromStore.animated || isGifUrl(source)
        };
    }
    const contentName = args.favoriteableName
        ?? args.itemTextContent?.match(/:([a-zA-Z0-9_]+):/)?.[1]
        ?? args.message?.content.match(RegExp(`<a?:(\\w+)(?:~\\d+)?:${id}>`))?.[1]
        ?? "emoji";
    return {
        kind: "custom",
        id,
        name: contentName,
        animated: isGifUrl(source)
    };
}
function toEmojiRefFromFavoriteableContext(args) {
    if (args.favoriteableType !== "emoji")
        return null;
    if (!args.favoriteableId) {
        const unicode = getUnicodeFromNodeTarget(args.rawTarget)
            ?? getUnicodeFromNodeTarget(args.target instanceof Node ? args.target : null)
            ?? extractUnicodeEmoji(args.itemTextContent);
        if (unicode) {
            return {
                kind: "unicode",
                name: normalizeEmojiName(args.favoriteableName ?? unicode),
                surrogates: unicode
            };
        }
        if (!args.favoriteableName)
            return null;
        return {
            kind: "unicode",
            name: normalizeEmojiName(args.favoriteableName)
        };
    }
    const id = args.favoriteableId;
    const fromStore = EmojiStore.getCustomEmojiById(id);
    if (fromStore) {
        return {
            kind: "custom",
            id,
            name: fromStore.name,
            animated: !!fromStore.animated || isGifUrl(args.itemHref ?? args.itemSrc ?? "")
        };
    }
    const contentName = args.favoriteableName
        ?? args.itemTextContent?.match(/:([a-zA-Z0-9_]+):/)?.[1]
        ?? args.message?.content.match(RegExp(`<a?:(\\w+)(?:~\\d+)?:${id}>`))?.[1]
        ?? "emoji";
    return {
        kind: "custom",
        id,
        name: contentName,
        animated: isGifUrl(args.itemHref ?? args.itemSrc ?? "")
    };
}
function toEmojiRefFromStrictTarget(args) {
    if (!(args.target instanceof HTMLElement))
        return null;
    const elementTargetEmojiRef = toEmojiRefFromElementTarget(args.target);
    if (elementTargetEmojiRef)
        return elementTargetEmojiRef;
    return toEmojiRefFromHrefContext(args);
}
function toEmojiRefFromMessageContext(args) {
    const favoriteableEmojiRef = toEmojiRefFromFavoriteableContext(args);
    if (favoriteableEmojiRef)
        return favoriteableEmojiRef;
    return toEmojiRefFromStrictTarget(args);
}
function hasExplicitEmojiContext(args) {
    if (args.favoriteableType === "emoji")
        return true;
    if (args.favoriteableId)
        return true;
    const source = args.itemHref ?? args.itemSrc;
    if (source?.includes("/emojis/"))
        return true;
    const target = args.target instanceof HTMLElement
        ? args.target
        : args.target instanceof Node
            ? args.target.parentElement
            : null;
    if (!target)
        return false;
    if (target.closest("[data-type='emoji']"))
        return true;
    const roleImg = target.closest("[role='img']");
    if (roleImg) {
        const roleText = roleImg.getAttribute("aria-label") ?? roleImg.textContent;
        if (extractUnicodeEmoji(roleText))
            return true;
    }
    const img = target.closest("img");
    if (img?.src?.includes("/emojis/"))
        return true;
    if (extractUnicodeEmoji(img?.alt))
        return true;
    return false;
}
function normalizeContextKey(value) {
    if (value == null)
        return "";
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
        return String(value);
    if (typeof value !== "object")
        return typeof value;
    const record = value;
    const priorityValues = [record.id, record.channelId, record.guildId, record.type, record.emojiIntention, record.name]
        .filter((candidate) => typeof candidate === "string" || typeof candidate === "number");
    if (priorityValues.length)
        return priorityValues.map(String).join(":");
    const entries = Object.keys(record)
        .sort()
        .slice(0, 6)
        .map(key => {
        const candidate = record[key];
        if (typeof candidate === "string" || typeof candidate === "number" || typeof candidate === "boolean") {
            return `${key}:${String(candidate)}`;
        }
        return `${key}:${typeof candidate}`;
    });
    return entries.join("|");
}
function resolveTargetFromArgs(args) {
    for (const arg of args) {
        if (arg instanceof HTMLElement)
            return arg;
        if (arg instanceof Node)
            return arg.parentElement;
        if (!arg || typeof arg !== "object")
            continue;
        const maybeTarget = arg.target;
        if (maybeTarget instanceof HTMLElement)
            return maybeTarget;
        if (maybeTarget instanceof Node)
            return maybeTarget.parentElement;
        const nativeTarget = arg.nativeEvent?.target;
        if (nativeTarget instanceof HTMLElement)
            return nativeTarget;
        if (nativeTarget instanceof Node)
            return nativeTarget.parentElement;
    }
    return null;
}
function resolveRawTargetFromArgs(args) {
    for (const arg of args) {
        if (arg instanceof Node)
            return arg;
        if (!arg || typeof arg !== "object")
            continue;
        const maybeTarget = arg.target;
        if (maybeTarget instanceof Node)
            return maybeTarget;
        const nativeTarget = arg.nativeEvent?.target;
        if (nativeTarget instanceof Node)
            return nativeTarget;
    }
    return null;
}
function resolveContextPropsFromArgs(args) {
    const merged = {};
    for (const arg of args) {
        if (!arg || typeof arg !== "object")
            continue;
        const candidate = arg;
        const nestedProps = candidate.props;
        if (candidate.favoriteableId)
            merged.favoriteableId = candidate.favoriteableId;
        if (candidate.favoriteableName)
            merged.favoriteableName = candidate.favoriteableName;
        if (candidate.favoriteableType)
            merged.favoriteableType = candidate.favoriteableType;
        if (candidate.itemHref)
            merged.itemHref = candidate.itemHref;
        if (candidate.itemSrc)
            merged.itemSrc = candidate.itemSrc;
        if (candidate.itemTextContent)
            merged.itemTextContent = candidate.itemTextContent;
        if (candidate.message)
            merged.message = candidate.message;
        if (candidate.target instanceof HTMLElement)
            merged.target = candidate.target;
        if (nestedProps) {
            if (nestedProps.favoriteableId)
                merged.favoriteableId = nestedProps.favoriteableId;
            if (nestedProps.favoriteableName)
                merged.favoriteableName = nestedProps.favoriteableName;
            if (nestedProps.favoriteableType)
                merged.favoriteableType = nestedProps.favoriteableType;
            if (nestedProps.itemHref)
                merged.itemHref = nestedProps.itemHref;
            if (nestedProps.itemSrc)
                merged.itemSrc = nestedProps.itemSrc;
            if (nestedProps.itemTextContent)
                merged.itemTextContent = nestedProps.itemTextContent;
            if (nestedProps.message)
                merged.message = nestedProps.message;
            if (nestedProps.target instanceof HTMLElement)
                merged.target = nestedProps.target;
        }
    }
    const strictTarget = resolveTargetFromArgs(args);
    if (strictTarget)
        merged.target = strictTarget;
    const rawTarget = resolveRawTargetFromArgs(args);
    if (rawTarget)
        merged.rawTarget = rawTarget;
    if (!merged.target && !merged.favoriteableId && !merged.itemHref && !merged.itemSrc) {
        return null;
    }
    return merged;
}
function getAliasMapEntries() {
    return Object.entries(aliasMap).sort(([left], [right]) => left.localeCompare(right));
}
function getExistingAliasForEmoji(ref) {
    for (const [alias, current] of Object.entries(aliasMap)) {
        if (isSameEmoji(current, ref))
            return alias;
    }
    return "";
}
async function saveAlias(aliasInput, ref) {
    const validationError = getAliasValidationError(aliasInput);
    if (validationError)
        return { ok: false, error: validationError };
    const alias = normalizeAlias(aliasInput);
    const existing = aliasMap[alias];
    if (existing && !isSameEmoji(existing, ref)) {
        return { ok: false, error: "Duplicate alias" };
    }
    const normalizedRef = ref.kind === "unicode"
        ? {
            ...ref,
            name: normalizeEmojiName(ref.name),
            surrogates: getUnicodeSurrogate(ref) ?? resolveUnicodeSurrogateByName(ref.name)
        }
        : ref;
    const nextMap = { ...aliasMap };
    for (const [existingAlias, existingRef] of Object.entries(nextMap)) {
        if (existingAlias === alias)
            continue;
        if (!isSameEmoji(existingRef, normalizedRef))
            continue;
        delete nextMap[existingAlias];
    }
    nextMap[alias] = normalizedRef;
    try {
        await persistAliases(nextMap);
        return { ok: true };
    }
    catch (error) {
        logger.error("Failed to save emoji alias.", error);
        return { ok: false, error: "Failed to save alias." };
    }
}
function getAliasMenuLabel(ref) {
    return getExistingAliasForEmoji(ref) ? "Edit alias" : "Set alias";
}
async function removeAlias(alias) {
    if (!(alias in aliasMap))
        return;
    const nextMap = { ...aliasMap };
    delete nextMap[alias];
    try {
        await persistAliases(nextMap);
        Toasts.show({
            id: Toasts.genId(),
            message: `Removed alias :${alias}:`,
            type: Toasts.Type.SUCCESS
        });
    }
    catch (error) {
        logger.error("Failed to remove emoji alias.", error);
        Toasts.show({
            id: Toasts.genId(),
            message: "Failed to remove alias.",
            type: Toasts.Type.FAILURE
        });
    }
}
async function clearAliases() {
    if (!Object.keys(aliasMap).length)
        return;
    try {
        await persistAliases({});
        Toasts.show({
            id: Toasts.genId(),
            message: "Deleted all emoji aliases.",
            type: Toasts.Type.SUCCESS
        });
    }
    catch (error) {
        logger.error("Failed to clear emoji aliases.", error);
        Toasts.show({
            id: Toasts.genId(),
            message: "Failed to delete aliases.",
            type: Toasts.Type.FAILURE
        });
    }
}
function openSetAliasModal(ref) {
    openModal(props => (<SetAliasModal modalProps={props} emojiDisplayName={getEmojiDisplayName(ref)} initialAlias={getExistingAliasForEmoji(ref)} getValidationError={getAliasValidationError} isDuplicateAlias={input => {
            const normalized = normalizeAlias(input);
            const existing = normalized ? aliasMap[normalized] : null;
            return !!existing && !isSameEmoji(existing, ref);
        }} onSave={async (input) => {
            const result = await saveAlias(input, ref);
            if (!result.ok)
                return result;
            Toasts.show({
                id: Toasts.genId(),
                message: `Alias set for ${getEmojiDisplayName(ref)}.`,
                type: Toasts.Type.SUCCESS
            });
            return result;
        }}/>));
}
function queryAliasEmojiResult(aliasEmoji, channel, intention) {
    const cacheKey = [
        aliasEmoji.kind,
        aliasEmoji.id ?? "",
        normalizeEmojiName(aliasEmoji.name),
        getUnicodeSurrogate(aliasEmoji) ?? "",
        normalizeContextKey(channel),
        normalizeContextKey(intention)
    ].join("|");
    const cached = aliasResultCache.get(cacheKey);
    if (cached !== undefined)
        return cached;
    const baseQuery = getUnicodeSurrogate(aliasEmoji) ?? resolveUnicodeSurrogateByName(aliasEmoji.name) ?? aliasEmoji.name;
    if (!baseQuery.length) {
        aliasResultCache.set(cacheKey, null);
        return null;
    }
    const queryCandidates = aliasEmoji.kind === "custom"
        ? [aliasEmoji.name, `:${aliasEmoji.name}:`, baseQuery]
        : [
            getUnicodeSurrogate(aliasEmoji),
            normalizeEmojiName(aliasEmoji.name),
            `:${normalizeEmojiName(aliasEmoji.name)}:`,
            baseQuery
        ].filter((value) => !!value && value.length > 0);
    for (const query of queryCandidates) {
        const queried = EmojiQueryService.queryEmojiResults({
            query,
            channel,
            intention,
            maxCount: 100
        });
        const unlocked = queried?.emojis?.unlocked;
        if (!unlocked?.length)
            continue;
        const resolved = unlocked.find(result => {
            if (aliasEmoji.kind === "custom") {
                return emojiIdentityFromResult(result) === emojiIdentityFromRef(aliasEmoji);
            }
            const refSurrogate = getUnicodeSurrogate(aliasEmoji) ?? resolveUnicodeSurrogateByName(aliasEmoji.name);
            const resultSurrogate = (result.surrogates ?? result.emojiObject?.surrogates)?.trim();
            if (refSurrogate && resultSurrogate)
                return refSurrogate === resultSurrogate;
            const resultCustomId = result.id ?? result.emojiObject?.id;
            if (resultCustomId)
                return false;
            const refName = normalizeEmojiNameForCompare(aliasEmoji.name);
            const resultName = normalizeEmojiNameForCompare(result.uniqueName ?? result.name ?? result.originalName ?? "");
            return !!refName && refName === resultName;
        }) ?? null;
        if (resolved) {
            aliasResultCache.set(cacheKey, resolved);
            return resolved;
        }
    }
    aliasResultCache.set(cacheKey, null);
    return null;
}
function fallbackAliasEmojiResult(aliasEmoji, template) {
    if (aliasEmoji.kind === "unicode") {
        return null;
    }
    if (!aliasEmoji.id)
        return null;
    const storeEmoji = EmojiStore.getUsableCustomEmojiById(aliasEmoji.id) ?? EmojiStore.getCustomEmojiById(aliasEmoji.id);
    if (!storeEmoji)
        return null;
    const hasWrapperShape = !!template?.emojiObject || "emojiObject" in (template ?? {});
    if (!hasWrapperShape) {
        return {
            id: storeEmoji.id,
            name: storeEmoji.name,
            uniqueName: storeEmoji.name
        };
    }
    return {
        emojiObject: {
            id: storeEmoji.id,
            name: storeEmoji.name,
            guildId: storeEmoji.guildId,
            animated: !!storeEmoji.animated
        },
        id: storeEmoji.id,
        name: storeEmoji.name,
        uniqueName: storeEmoji.name,
        originalName: storeEmoji.name,
        guildId: storeEmoji.guildId,
        surrogates: template?.surrogates,
        type: template?.type ?? "EMOJI",
        index: typeof template?.index === "number" ? template.index : 0,
        useSpriteSheet: template?.useSpriteSheet ?? false,
        names: [storeEmoji.name]
    };
}
function injectAliasResults(emojis, queryText, channel, intention) {
    const query = normalizeAlias(queryText);
    if (!query)
        return emojis;
    const template = emojis[0];
    const seen = new Set(emojis.map(emojiIdentityFromResult));
    const exactMatches = [];
    const prefixMatches = [];
    for (const [alias, ref] of Object.entries(aliasMap)) {
        if (!alias.startsWith(query))
            continue;
        const identity = emojiIdentityFromRef(ref);
        if (seen.has(identity))
            continue;
        const fromQuery = queryAliasEmojiResult(ref, channel, intention);
        const resolved = ref.kind === "unicode"
            ? fromQuery
            : fromQuery ?? fallbackAliasEmojiResult(ref, template);
        if (!resolved)
            continue;
        if (alias === query) {
            exactMatches.push(resolved);
        }
        else {
            prefixMatches.push(resolved);
        }
        seen.add(identity);
    }
    if (!exactMatches.length && !prefixMatches.length)
        return emojis;
    return [...exactMatches, ...prefixMatches, ...emojis];
}
function getAutocompleteQuery(query) {
    if (!query)
        return "";
    if (typeof query.queryText === "string")
        return query.queryText;
    if (typeof query.query === "string")
        return query.query;
    if (typeof query.text === "string")
        return query.text;
    return "";
}
function insertSetAliasMenuItem(children, emojiRef) {
    const alreadyAdded = children.some(child => child?.props?.id === "vc-emoji-alias-set");
    if (alreadyAdded)
        return;
    const menuItem = (<Menu.MenuItem id="vc-emoji-alias-set" label={getAliasMenuLabel(emojiRef)} action={() => openSetAliasModal(emojiRef)}/>);
    const group = findGroupChildrenByChildId([
        "favorite-emoji", "favourite-emoji", "unfavorite-emoji", "unfavourite-emoji",
        "copy-link", "copy-text", "copy-message-link"
    ], children, true);
    if (group) {
        group.push(menuItem);
        return;
    }
    children.push(menuItem);
}
function openClearAliasesConfirmModal() {
    openModal(props => <ClearAliasesConfirmModal modalProps={props} onConfirm={clearAliases}/>);
}
function EmojiPreview({ emojiRef }) {
    if (emojiRef.kind === "custom" && emojiRef.id) {
        return <img src={`https://${window.GLOBAL_ENV.CDN_HOST}/emojis/${emojiRef.id}.${emojiRef.animated ? "gif" : "png"}?size=32`} width="20" height="20" alt={emojiRef.name}/>;
    }
    const previewUrl = getUnicodePreviewUrl(emojiRef);
    if (previewUrl) {
        return <img src={previewUrl} width="20" height="20" alt={getEmojiDisplayName(emojiRef)}/>;
    }
    return <BaseText>{getEmojiDisplayName(emojiRef)}</BaseText>;
}
function AliasRow({ alias, emojiRef }) {
    const [isEditing, setIsEditing] = useState(false);
    const [draftAlias, setDraftAlias] = useState(alias);
    const [error, setError] = useState(null);
    useEffect(() => {
        setDraftAlias(alias);
    }, [alias]);
    const saveEdit = async () => {
        const result = await saveAlias(draftAlias, emojiRef);
        if (!result.ok) {
            setError(result.error);
            return;
        }
        setError(null);
        setIsEditing(false);
    };
    return (<div className={cl("row")}>
            <div className={cl("row-editing")}>
                {isEditing ? (<TextInput className={cl("row-editing-text-input")} value={draftAlias} autoFocus onChange={value => {
                setDraftAlias(value);
                setError(null);
            }} onKeyDown={async (event) => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    await saveEdit();
                }
                if (event.key === "Escape") {
                    event.preventDefault();
                    setDraftAlias(alias);
                    setError(null);
                    setIsEditing(false);
                }
            }}/>) : (<BaseText weight="semibold">:{alias}:</BaseText>)}
                <BaseText className={cl("row-arrow")}>→</BaseText>
                <EmojiPreview emojiRef={emojiRef}/>
                <BaseText>{`:${normalizeEmojiName(emojiRef.name)}:`}</BaseText>
                {error && <BaseText className={cl("row-error")}>{error}</BaseText>}
            </div>
            <div className={cl("row-button")}>
                <Button variant="secondary" size="iconOnly" onClick={() => {
            setDraftAlias(alias);
            setError(null);
            setIsEditing(true);
        }}>
                    <PencilIcon width={14} height={14}/>
                </Button>
                <Button variant="dangerSecondary" size="small" onClick={() => removeAlias(alias)}>Remove</Button>
            </div>
        </div>);
}
function AliasListSetting() {
    const [, setVersion] = useState(0);
    useEffect(() => subscribeAliases(() => setVersion(version => version + 1)), []);
    const entries = getAliasMapEntries();
    if (!entries.length) {
        return <Paragraph>No aliases set yet.</Paragraph>;
    }
    return (<div className={cl("settings")}>
            {entries.map(([alias, ref]) => (<AliasRow key={alias} alias={alias} emojiRef={ref}/>))}
        </div>);
}
function ClearAllAliasesSetting() {
    const [, setVersion] = useState(0);
    useEffect(() => subscribeAliases(() => setVersion(version => version + 1)), []);
    const disabled = !Object.keys(aliasMap).length;
    return (<Button variant="dangerPrimary" size="small" disabled={disabled} onClick={openClearAliasesConfirmModal}>
            Delete all aliases
        </Button>);
}
const expressionPickerPatch = (children, { target }) => {
    const emojiRef = toEmojiRefFromExpressionTarget(target);
    if (!emojiRef)
        return;
    children.push(<Menu.MenuItem id="vc-emoji-alias-set" label={getAliasMenuLabel(emojiRef)} action={() => openSetAliasModal(emojiRef)}/>);
};
const messageContextMenuPatch = (children, ...args) => {
    const props = resolveContextPropsFromArgs(args);
    if (!props)
        return;
    if (!hasExplicitEmojiContext(props))
        return;
    const emojiRef = toEmojiRefFromMessageContext(props);
    if (!emojiRef)
        return;
    insertSetAliasMenuItem(children, emojiRef);
};
const messageSendListener = (_channelId, messageObj) => {
    if (!messageObj.content || !Object.keys(aliasMap).length)
        return;
    messageObj.content = messageObj.content.replace(/:([a-z0-9_]{2,32}):/gi, (match, aliasName) => {
        const ref = aliasMap[aliasName.toLowerCase()];
        if (!ref)
            return match;
        if (ref.kind === "custom" && ref.id) {
            return `<${ref.animated ? "a" : ""}:${ref.name}:${ref.id}>`;
        }
        return getUnicodeSurrogate(ref) ?? resolveUnicodeSurrogateByName(ref.name) ?? match;
    });
};
export default definePlugin({
    name: "FavoriteEmojiFirst",
    authors: [Devs.Aria, Devs.Ven, EquicordDevs.justjxke],
    tags: ["Emotes", "Customisation"],
    description: "Puts your favorite emoji first in the emoji autocomplete and also has emoji alias.",
    dependencies: ["MessagePopoverAPI"],
    settings,
    contextMenus: {
        "expression-picker": expressionPickerPatch,
        "message": messageContextMenuPatch,
        "message-actions": messageContextMenuPatch,
        "textarea-context": messageContextMenuPatch
    },
    isModified: true,
    onBeforeMessageSend: messageSendListener,
    patches: [
        {
            find: "renderResults({results:",
            replacement: [
                {
                    // https://regex101.com/r/N7kpLM/1
                    match: /let \i=.{1,100}renderResults\({results:(\i)\.query\.results,/,
                    replace: "$self.sortEmojis($1);$&"
                },
            ],
        },
        {
            find: "renderResults({results:",
            replacement: {
                match: /let \i=.{1,100}renderResults\({results:(\i)\.query\.results,/,
                replace: "$self.sortEmojis($1);$&"
            },
        },
        {
            find: "numEmojiResults:",
            replacement: [
                {
                    match: /\{emojis:\{unlocked:(\i)\}\}=.{0,25}\(\{query:(\i),channel:(\i),intention:(\i).{0,30}\}\);/,
                    replace: "$&$1=$self.injectAliasResults($1,$2,$3,$4.emojiIntention);"
                },
                {
                    match: /(intention:\i\.emojiIntention,maxCount:)\i/,
                    replace: "$1Infinity"
                },
                {
                    match: /(\i)\.slice\(0,(Math\.max\(\d+?,\i(?:-\i\.length){2}\))\)/,
                    replace: "($1.sliceTo = $2, $1)"
                }
            ]
        }
    ],
    injectAliasResults,
    async start() {
        await loadAliases();
        globalContextPatch = (_navId, children, ...args) => {
            if (_navId === "expression-picker" || _navId === "message" || _navId === "message-actions" || _navId === "textarea-context") {
                return;
            }
            if (NON_EMOJI_NAV_IDS.has(_navId))
                return;
            const alreadyAdded = children.some(child => child?.props?.id === "vc-emoji-alias-set");
            if (alreadyAdded)
                return;
            const props = resolveContextPropsFromArgs(args);
            if (!props)
                return;
            if (!hasExplicitEmojiContext(props))
                return;
            const emojiRef = toEmojiRefFromMessageContext(props);
            if (!emojiRef)
                return;
            insertSetAliasMenuItem(children, emojiRef);
        };
        addGlobalContextMenuPatch(globalContextPatch);
    },
    stop() {
        if (!globalContextPatch)
            return;
        removeGlobalContextMenuPatch(globalContextPatch);
        globalContextPatch = null;
        unicodeSurrogateCache.clear();
        aliasResultCache.clear();
    },
    sortEmojis(state) {
        if (!state.query?.results?.emojis?.length)
            return;
        const query = normalizeAlias(getAutocompleteQuery(state.query));
        if (!query)
            return;
        const { channel, intention } = state.query;
        const injectedResults = injectAliasResults(state.query.results.emojis, query, channel, intention);
        const emojiContext = EmojiStore.getDisambiguatedEmojiContext();
        const priorities = new Map();
        const refsByIdentity = new Map();
        for (const [alias, ref] of Object.entries(aliasMap)) {
            if (!alias.startsWith(query))
                continue;
            const priority = alias === query ? 2 : 1;
            const identity = emojiIdentityFromRef(ref);
            const existingPriority = priorities.get(identity) ?? 0;
            if (priority > existingPriority) {
                priorities.set(identity, priority);
                refsByIdentity.set(identity, ref);
            }
        }
        const exact = [];
        const prefix = [];
        const rest = [];
        const seen = new Set();
        const template = injectedResults[0];
        const allResults = [...injectedResults];
        for (const emoji of allResults) {
            const identity = emojiIdentityFromResult(emoji);
            if (seen.has(identity))
                continue;
            seen.add(identity);
            const priority = priorities.get(identity) ?? 0;
            const isFavorite = emojiContext.isFavoriteEmojiWithoutFetchingLatest(emoji);
            if (priority === 2) {
                exact.push(emoji);
            }
            else if (priority === 1) {
                prefix.push(emoji);
            }
            else if (isFavorite) {
                exact.push(emoji);
            }
            else {
                rest.push(emoji);
            }
        }
        for (const [identity, priority] of priorities.entries()) {
            if (seen.has(identity))
                continue;
            const ref = refsByIdentity.get(identity);
            if (!ref || ref.kind === "unicode")
                continue;
            const fallback = fallbackAliasEmojiResult(ref, template);
            if (!fallback)
                continue;
            seen.add(identity);
            if (priority === 2) {
                exact.push(fallback);
            }
            else {
                prefix.push(fallback);
            }
        }
        state.query.results.emojis = [...exact, ...prefix, ...rest].slice(0, state.query.results.emojis.sliceTo ?? Infinity);
    }
});
