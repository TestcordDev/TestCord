/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { ChannelStore, GuildStore, RelationshipStore, UserStore } from "@webpack/common";
import { settings } from "../settings";
import { defaultRulesTemplate } from "./rulesTemplate";
const Native = IS_DISCORD_DESKTOP
    ? VencordNative.pluginHelpers.HyprTiles
    : null;
const DEFAULT_AUTO_LAYOUTS = [
    { minTiles: 1, layout: "single" },
    { minTiles: 2, layout: "columns" },
    { minTiles: 3, layout: "dwindle" },
    { minTiles: 6, layout: "grid" },
];
const DEFAULT_BACKGROUND_MINUTES = 5;
const defaultConfig = () => ({
    autoLayouts: [...DEFAULT_AUTO_LAYOUTS],
    backgroundThrottleMinutes: DEFAULT_BACKGROUND_MINUTES,
    rules: []
});
let rulesConfig = defaultConfig();
let rulesFilePath = "";
let rulesLoadError = null;
const getPluginDefaultLayout = () => {
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
const safeRegex = (matcher) => {
    try {
        return new RegExp(matcher.regex, matcher.flags);
    }
    catch {
        return null;
    }
};
const cleanJson5 = (input) => input
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,\s*([}\]])/g, "$1");
const parseRulesFile = (input) => {
    const cleaned = cleanJson5(input);
    return JSON.parse(cleaned);
};
const normalizeWorkspace = (value) => {
    const num = Number(value);
    return Number.isInteger(num) && num >= 1 && num <= 9 ? num : void 0;
};
const normalizeLayout = (value) => {
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
const normalizeOpenedBy = (value) => {
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
const normalizeStringMatcher = (value) => {
    if (typeof value === "string" && value)
        return value;
    if (!value || typeof value !== "object")
        return void 0;
    const { regex } = value;
    if (typeof regex !== "string" || !regex)
        return void 0;
    return {
        regex,
        flags: typeof value.flags === "string" ? value.flags : void 0
    };
};
const normalizeMatch = (value) => {
    if (!value || typeof value !== "object")
        return {};
    const openedBy = Array.isArray(value.openedBy)
        ? value.openedBy
            .map(normalizeOpenedBy)
            .filter(Boolean)
        : normalizeOpenedBy(value.openedBy);
    const type = Array.isArray(value.type)
        ? value.type
            .filter((entry) => typeof entry === "string")
        : typeof value.type === "string"
            ? value.type
            : void 0;
    return {
        guildId: normalizeStringMatcher(value.guildId),
        channelId: normalizeStringMatcher(value.channelId),
        parentId: normalizeStringMatcher(value.parentId),
        type,
        channelName: normalizeStringMatcher(value.channelName),
        guildName: normalizeStringMatcher(value.guildName),
        isThread: typeof value.isThread === "boolean" ? value.isThread : void 0,
        isNSFW: typeof value.isNSFW === "boolean" ? value.isNSFW : void 0,
        isPrivate: typeof value.isPrivate === "boolean" ? value.isPrivate : void 0,
        openedBy,
    };
};
const normalizeActions = (value) => {
    if (!value || typeof value !== "object")
        return {};
    const { split } = value;
    return {
        workspace: normalizeWorkspace(value.workspace),
        split: split === "left" || split === "right" || split === "up" || split === "down" ? split : void 0,
        replace: typeof value.replace === "boolean" ? value.replace : void 0,
        float: typeof value.float === "boolean" ? value.float : void 0,
        tabGroup: typeof value.tabGroup === "string" && value.tabGroup
            ? value.tabGroup
            : void 0,
        scratchpadId: typeof value.scratchpadId === "string" && value.scratchpadId
            ? value.scratchpadId
            : void 0,
        focus: typeof value.focus === "boolean" ? value.focus : void 0,
        layoutHint: normalizeLayout(value.layoutHint)
    };
};
const normalizeRule = (value) => {
    if (!value || typeof value !== "object")
        return null;
    return {
        name: typeof value.name === "string" ? value.name : void 0,
        priority: typeof value.priority === "number" ? value.priority : void 0,
        match: normalizeMatch(value.match),
        actions: normalizeActions(value.actions)
    };
};
const normalizeAutoLayouts = (value) => {
    if (!Array.isArray(value))
        return [...DEFAULT_AUTO_LAYOUTS];
    const normalized = value
        .map(entry => {
        if (!entry || typeof entry !== "object")
            return null;
        const minTiles = Number(entry.minTiles);
        const layout = normalizeLayout(entry.layout);
        if (!Number.isInteger(minTiles) || minTiles < 1 || !layout)
            return null;
        return { minTiles, layout };
    })
        .filter(Boolean);
    return normalized.length
        ? normalized.sort((a, b) => a.minTiles - b.minTiles)
        : [...DEFAULT_AUTO_LAYOUTS];
};
const normalizeConfig = (value) => {
    if (Array.isArray(value)) {
        return {
            autoLayouts: [...DEFAULT_AUTO_LAYOUTS],
            backgroundThrottleMinutes: DEFAULT_BACKGROUND_MINUTES,
            rules: value.map(normalizeRule).filter(Boolean)
        };
    }
    if (!value || typeof value !== "object")
        return defaultConfig();
    return {
        autoLayouts: normalizeAutoLayouts(value.autoLayouts),
        backgroundThrottleMinutes: typeof value.backgroundThrottleMinutes === "number"
            ? Math.max(1, Number(value.backgroundThrottleMinutes))
            : DEFAULT_BACKGROUND_MINUTES,
        rules: Array.isArray(value.rules)
            ? value.rules.map(normalizeRule).filter(Boolean)
            : []
    };
};
const matchString = (value, matcher) => {
    if (!matcher)
        return true;
    if (value == null)
        return false;
    if (typeof matcher === "string")
        return value === matcher;
    const regex = safeRegex(matcher);
    return regex ? regex.test(value) : false;
};
const matchBool = (value, matcher) => matcher == null || value === matcher;
const matchRule = (context, rule) => {
    const match = rule.match ?? {};
    if (!matchString(context.guildId, match.guildId))
        return false;
    if (!matchString(context.channelId, match.channelId))
        return false;
    if (!matchString(context.parentId, match.parentId))
        return false;
    if (!matchString(context.channelName, match.channelName))
        return false;
    if (!matchString(context.guildName, match.guildName))
        return false;
    if (!matchBool(context.isThread, match.isThread))
        return false;
    if (!matchBool(context.isNSFW, match.isNSFW))
        return false;
    if (!matchBool(context.isPrivate, match.isPrivate))
        return false;
    if (match.type) {
        const types = Array.isArray(match.type) ? match.type : [match.type];
        if (!types.includes(context.type))
            return false;
    }
    if (match.openedBy) {
        const openedBy = Array.isArray(match.openedBy) ? match.openedBy : [match.openedBy];
        if (!openedBy.includes(context.openedBy))
            return false;
    }
    return true;
};
const resolveChannelName = (channelId) => {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel)
        return null;
    if (channel.isDM?.()) {
        const recipientId = channel.getRecipientId?.();
        if (!recipientId)
            return channel.name ?? null;
        const user = UserStore.getUser(recipientId);
        return RelationshipStore.getNickname(recipientId) || user?.globalName || user?.username || channel.name || null;
    }
    return channel.name ?? null;
};
const resolveChannelKind = (channelId) => {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel)
        return "unknown";
    if (channel.isThread?.())
        return "thread";
    if (channel.type === 1 /* ChannelType.DM */)
        return "dm";
    if (channel.type === 3 /* ChannelType.GROUP_DM */)
        return "groupDm";
    if (channel.type === 2 /* ChannelType.GUILD_VOICE */)
        return "voice";
    if (channel.type === 13 /* ChannelType.GUILD_STAGE_VOICE */)
        return "stage";
    if (channel.type === 5 /* ChannelType.GUILD_ANNOUNCEMENT */ || channel.type === 10 /* ChannelType.ANNOUNCEMENT_THREAD */)
        return "announcement";
    if (channel.type === 15 /* ChannelType.GUILD_FORUM */ || channel.type === 16 /* ChannelType.GUILD_MEDIA */)
        return "forumPost";
    if (channel.type === 0 /* ChannelType.GUILD_TEXT */)
        return "guildText";
    return "unknown";
};
export function buildRuleContext(target, openedBy) {
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
export function evaluateRules(context) {
    if (!areRulesEnabled())
        return { focus: true };
    const matched = rulesConfig.rules
        .map((rule, index) => ({ rule, index }))
        .filter(entry => matchRule(context, entry.rule))
        .sort((a, b) => {
        const priorityA = a.rule.priority ?? 0;
        const priorityB = b.rule.priority ?? 0;
        return priorityA - priorityB || a.index - b.index;
    });
    const merged = {};
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
export function getAutoLayoutForTileCount(tileCount) {
    let layout = getPluginDefaultLayout();
    if (!areRulesEnabled())
        return layout;
    for (const rule of rulesConfig.autoLayouts) {
        if (tileCount >= rule.minTiles)
            layout = rule.layout;
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
    }
    catch (error) {
        rulesLoadError = error?.message || String(error);
        return { ok: false, filePath: rulesFilePath, error: rulesLoadError };
    }
}
