/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PluginNative } from "@utils/types";
import { ChannelType } from "@vencord/discord-types/enums";
import { ChannelStore, GuildStore, RelationshipStore, UserStore } from "@webpack/common";

import { settings } from "../settings";
import { defaultRulesTemplate } from "./rulesTemplate";
import {
    AutoLayoutRule,
    HyprTilesChannelKind,
    HyprTilesLayout,
    HyprTilesRule,
    HyprTilesRuleActions,
    HyprTilesRuleContext,
    HyprTilesRuleMatch,
    HyprTilesRulesConfig,
    OpenedBy,
    RegexMatcher,
    StringMatcher,
    TileOpenPlan,
    TileTarget,
    WorkspaceIndex,
} from "../types";

const Native = IS_DISCORD_DESKTOP
    ? VencordNative.pluginHelpers.HyprTiles as PluginNative<typeof import("../native")>
    : null;

const DEFAULT_AUTO_LAYOUTS: AutoLayoutRule[] = [
    { minTiles: 1, layout: "single" },
    { minTiles: 2, layout: "columns" },
    { minTiles: 3, layout: "dwindle" },
    { minTiles: 6, layout: "grid" },
];

const DEFAULT_BACKGROUND_MINUTES = 5;

const defaultConfig = (): HyprTilesRulesConfig => ({
    autoLayouts: [...DEFAULT_AUTO_LAYOUTS],
    backgroundThrottleMinutes: DEFAULT_BACKGROUND_MINUTES,
    rules: []
});

let rulesConfig = defaultConfig();
let rulesFilePath = "";
let rulesLoadError: string | null = null;

const getPluginDefaultLayout = (): HyprTilesLayout => {
    switch (settings.store.defaultLayout) {
        case "master":
        case "grid":
        case "columns":
        case "dwindle":
            return settings.store.defaultLayout;
        default:
            return "dwindle";
    }
};

export function areRulesEnabled() {
    return settings.store.enableRulesFile;
}

const safeRegex = (matcher: RegexMatcher) => {
    try {
        return new RegExp(matcher.regex, matcher.flags);
    } catch {
        return null;
    }
};

const cleanJson5 = (input: string) => input
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,\s*([}\]])/g, "$1");

const parseRulesFile = (input: string) => {
    const cleaned = cleanJson5(input);
    return JSON.parse(cleaned) as unknown;
};

const normalizeWorkspace = (value: unknown): WorkspaceIndex | undefined => {
    const num = Number(value);
    return Number.isInteger(num) && num >= 1 && num <= 9 ? num as WorkspaceIndex : void 0;
};

const normalizeLayout = (value: unknown): HyprTilesLayout | undefined => {
    switch (value) {
        case "single":
        case "dwindle":
        case "master":
        case "grid":
        case "columns":
            return value;
        default:
            return void 0;
    }
};

const normalizeOpenedBy = (value: unknown): OpenedBy | undefined => {
    switch (value) {
        case "user":
        case "rule":
        case "dragDrop":
        case "restore":
        case "contextMenu":
            return value;
        default:
            return void 0;
    }
};

const normalizeStringMatcher = (value: unknown): StringMatcher | undefined => {
    if (typeof value === "string" && value) return value;
    if (!value || typeof value !== "object") return void 0;

    const { regex } = (value as RegexMatcher);
    if (typeof regex !== "string" || !regex) return void 0;

    return {
        regex,
        flags: typeof (value as RegexMatcher).flags === "string" ? (value as RegexMatcher).flags : void 0
    };
};

const normalizeMatch = (value: unknown): HyprTilesRuleMatch => {
    if (!value || typeof value !== "object") return {};

    const openedBy = Array.isArray((value as HyprTilesRuleMatch).openedBy)
        ? ((value as HyprTilesRuleMatch).openedBy as unknown[])
            .map(normalizeOpenedBy)
            .filter(Boolean) as OpenedBy[]
        : normalizeOpenedBy((value as HyprTilesRuleMatch).openedBy);

    const type = Array.isArray((value as HyprTilesRuleMatch).type)
        ? ((value as HyprTilesRuleMatch).type as unknown[])
            .filter((entry): entry is HyprTilesChannelKind => typeof entry === "string")
        : typeof (value as HyprTilesRuleMatch).type === "string"
            ? (value as HyprTilesRuleMatch).type
            : void 0;

    return {
        guildId: normalizeStringMatcher((value as HyprTilesRuleMatch).guildId),
        channelId: normalizeStringMatcher((value as HyprTilesRuleMatch).channelId),
        parentId: normalizeStringMatcher((value as HyprTilesRuleMatch).parentId),
        type,
        channelName: normalizeStringMatcher((value as HyprTilesRuleMatch).channelName),
        guildName: normalizeStringMatcher((value as HyprTilesRuleMatch).guildName),
        isThread: typeof (value as HyprTilesRuleMatch).isThread === "boolean" ? (value as HyprTilesRuleMatch).isThread : void 0,
        isNSFW: typeof (value as HyprTilesRuleMatch).isNSFW === "boolean" ? (value as HyprTilesRuleMatch).isNSFW : void 0,
        isPrivate: typeof (value as HyprTilesRuleMatch).isPrivate === "boolean" ? (value as HyprTilesRuleMatch).isPrivate : void 0,
        openedBy,
    };
};

const normalizeActions = (value: unknown): HyprTilesRuleActions => {
    if (!value || typeof value !== "object") return {};

    const { split } = (value as HyprTilesRuleActions);

    return {
        workspace: normalizeWorkspace((value as HyprTilesRuleActions).workspace),
        split: split === "left" || split === "right" || split === "up" || split === "down" ? split : void 0,
        replace: typeof (value as HyprTilesRuleActions).replace === "boolean" ? (value as HyprTilesRuleActions).replace : void 0,
        float: typeof (value as HyprTilesRuleActions).float === "boolean" ? (value as HyprTilesRuleActions).float : void 0,
        tabGroup: typeof (value as HyprTilesRuleActions).tabGroup === "string" && (value as HyprTilesRuleActions).tabGroup
            ? (value as HyprTilesRuleActions).tabGroup
            : void 0,
        scratchpadId: typeof (value as HyprTilesRuleActions).scratchpadId === "string" && (value as HyprTilesRuleActions).scratchpadId
            ? (value as HyprTilesRuleActions).scratchpadId
            : void 0,
        focus: typeof (value as HyprTilesRuleActions).focus === "boolean" ? (value as HyprTilesRuleActions).focus : void 0,
        layoutHint: normalizeLayout((value as HyprTilesRuleActions).layoutHint)
    };
};

const normalizeRule = (value: unknown): HyprTilesRule | null => {
    if (!value || typeof value !== "object") return null;

    return {
        name: typeof (value as HyprTilesRule).name === "string" ? (value as HyprTilesRule).name : void 0,
        priority: typeof (value as HyprTilesRule).priority === "number" ? (value as HyprTilesRule).priority : void 0,
        match: normalizeMatch((value as HyprTilesRule).match),
        actions: normalizeActions((value as HyprTilesRule).actions)
    };
};

const normalizeAutoLayouts = (value: unknown): AutoLayoutRule[] => {
    if (!Array.isArray(value)) return [...DEFAULT_AUTO_LAYOUTS];

    const normalized = value
        .map(entry => {
            if (!entry || typeof entry !== "object") return null;

            const minTiles = Number((entry as AutoLayoutRule).minTiles);
            const layout = normalizeLayout((entry as AutoLayoutRule).layout);
            if (!Number.isInteger(minTiles) || minTiles < 1 || !layout) return null;

            return { minTiles, layout };
        })
        .filter(Boolean) as AutoLayoutRule[];

    return normalized.length
        ? normalized.sort((a, b) => a.minTiles - b.minTiles)
        : [...DEFAULT_AUTO_LAYOUTS];
};

const normalizeConfig = (value: unknown): HyprTilesRulesConfig => {
    if (Array.isArray(value)) {
        return {
            autoLayouts: [...DEFAULT_AUTO_LAYOUTS],
            backgroundThrottleMinutes: DEFAULT_BACKGROUND_MINUTES,
            rules: value.map(normalizeRule).filter(Boolean) as HyprTilesRule[]
        };
    }

    if (!value || typeof value !== "object") return defaultConfig();

    return {
        autoLayouts: normalizeAutoLayouts((value as HyprTilesRulesConfig).autoLayouts),
        backgroundThrottleMinutes: typeof (value as HyprTilesRulesConfig).backgroundThrottleMinutes === "number"
            ? Math.max(1, Number((value as HyprTilesRulesConfig).backgroundThrottleMinutes))
            : DEFAULT_BACKGROUND_MINUTES,
        rules: Array.isArray((value as HyprTilesRulesConfig).rules)
            ? ((value as HyprTilesRulesConfig).rules as unknown[]).map(normalizeRule).filter(Boolean) as HyprTilesRule[]
            : []
    };
};

const matchString = (value: string | null, matcher: StringMatcher | undefined) => {
    if (!matcher) return true;
    if (value == null) return false;

    if (typeof matcher === "string") return value === matcher;

    const regex = safeRegex(matcher);
    return regex ? regex.test(value) : false;
};

const matchBool = (value: boolean, matcher: boolean | undefined) => matcher == null || value === matcher;

const matchRule = (context: HyprTilesRuleContext, rule: HyprTilesRule) => {
    const match = rule.match ?? {};

    if (!matchString(context.guildId, match.guildId)) return false;
    if (!matchString(context.channelId, match.channelId)) return false;
    if (!matchString(context.parentId, match.parentId)) return false;
    if (!matchString(context.channelName, match.channelName)) return false;
    if (!matchString(context.guildName, match.guildName)) return false;
    if (!matchBool(context.isThread, match.isThread)) return false;
    if (!matchBool(context.isNSFW, match.isNSFW)) return false;
    if (!matchBool(context.isPrivate, match.isPrivate)) return false;

    if (match.type) {
        const types = Array.isArray(match.type) ? match.type : [match.type];
        if (!types.includes(context.type)) return false;
    }

    if (match.openedBy) {
        const openedBy = Array.isArray(match.openedBy) ? match.openedBy : [match.openedBy];
        if (!openedBy.includes(context.openedBy)) return false;
    }

    return true;
};

const resolveChannelName = (channelId: string) => {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return null;

    if (channel.isDM?.()) {
        const recipientId = channel.getRecipientId?.();
        if (!recipientId) return channel.name ?? null;
        const user = UserStore.getUser(recipientId);
        return RelationshipStore.getNickname(recipientId) || user?.globalName || user?.username || channel.name || null;
    }

    return channel.name ?? null;
};

const resolveChannelKind = (channelId: string): HyprTilesChannelKind => {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return "unknown";

    if (channel.isThread?.()) return "thread";
    if (channel.type === ChannelType.DM) return "dm";
    if (channel.type === ChannelType.GROUP_DM) return "groupDm";
    if (channel.type === ChannelType.GUILD_VOICE) return "voice";
    if (channel.type === ChannelType.GUILD_STAGE_VOICE) return "stage";
    if (channel.type === ChannelType.GUILD_ANNOUNCEMENT || channel.type === ChannelType.ANNOUNCEMENT_THREAD) return "announcement";
    if (channel.type === ChannelType.GUILD_FORUM || channel.type === ChannelType.GUILD_MEDIA) return "forumPost";
    if (channel.type === ChannelType.GUILD_TEXT) return "guildText";
    return "unknown";
};

export function buildRuleContext(target: TileTarget, openedBy: OpenedBy): HyprTilesRuleContext {
    const channel = ChannelStore.getChannel(target.channelId);
    const guild = target.guildId ? GuildStore.getGuild(target.guildId) : null;

    return {
        ...target,
        parentId: channel?.parent_id ?? null,
        type: resolveChannelKind(target.channelId),
        channelName: resolveChannelName(target.channelId),
        guildName: guild?.name ?? null,
        isThread: !!channel?.isThread?.(),
        isNSFW: !!(channel?.isNSFW?.() || channel?.nsfw),
        isPrivate: !!channel?.isPrivate?.(),
        openedBy,
    };
}

export function evaluateRules(context: HyprTilesRuleContext): TileOpenPlan {
    if (!areRulesEnabled()) return { focus: true };

    const matched = rulesConfig.rules
        .map((rule, index) => ({ rule, index }))
        .filter(entry => matchRule(context, entry.rule))
        .sort((a, b) => {
            const priorityA = a.rule.priority ?? 0;
            const priorityB = b.rule.priority ?? 0;
            return priorityA - priorityB || a.index - b.index;
        });

    const merged: Partial<TileOpenPlan> = {};
    for (const { rule } of matched) {
        Object.assign(merged, rule.actions);
    }

    return {
        ...merged,
        focus: merged.focus ?? true
    };
}

export function getRulesConfig() {
    return rulesConfig;
}

export function getRulesFilePath() {
    return rulesFilePath;
}

export function getRulesLoadError() {
    return rulesLoadError;
}

export function getBackgroundThrottleMinutes() {
    return areRulesEnabled() ? rulesConfig.backgroundThrottleMinutes : DEFAULT_BACKGROUND_MINUTES;
}

export function getAutoLayoutForTileCount(tileCount: number) {
    let layout = getPluginDefaultLayout();
    if (!areRulesEnabled()) return layout;

    for (const rule of rulesConfig.autoLayouts) {
        if (tileCount >= rule.minTiles) layout = rule.layout;
    }
    return layout;
}

export async function reloadRulesConfig() {
    if (!Native) {
        rulesConfig = defaultConfig();
        rulesLoadError = null;
        rulesFilePath = "";
        return { ok: true, filePath: "", error: null };
    }

    try {
        const { filePath, contents } = await Native.readRulesFile(defaultRulesTemplate);
        rulesConfig = normalizeConfig(parseRulesFile(contents));
        rulesFilePath = filePath;
        rulesLoadError = null;
        return { ok: true, filePath, error: null };
    } catch (error: any) {
        rulesLoadError = error?.message || String(error);
        return { ok: false, filePath: rulesFilePath, error: rulesLoadError };
    }
}
