/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { sendMessage } from "@utils/discord";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, GuildMemberStore,UserStore } from "@webpack/common";

const logger = new Logger("GreedCmds");

const settings = definePluginSettings({
    enableProtectReadd: {
        type: OptionType.BOOLEAN,
        description: "Automatically re-add uwulock protect when someone removes it from you or protected users. Triggers on ,uwulock protect remove and sends ,uwulock protect add instantly.",
        default: true
    },
    enableUwulockRemove: {
        type: OptionType.BOOLEAN,
        description: "Automatically remove uwulock and restore protect when someone applies uwulock to you or protected users. Triggers on prefix, slash, and Greed confirmations; sends ,uwulock remove plus ,uwulock protect add.",
        default: true
    },
    enableCounterTo: {
        type: OptionType.BOOLEAN,
        description: "Counter attacks that target you or protected users with timeout. When someone uses ,uwulock, ,to, ,kick, ,ban or ,mute on you, automatically send ,to <@attacker> 60s.",
        default: false
    },
    counterDuration: {
        type: OptionType.NUMBER,
        description: "Duration in seconds for the counter ,to command.",
        default: 60
    },
    protectedUserIds: {
        type: OptionType.STRING,
        description: "Additional user IDs to protect (comma separated). Example: 123456789012345678, 987654321098765432",
        default: ""
    },
    allowedGuildIds: {
        type: OptionType.STRING,
        description: "Only run in these servers (comma separated guild IDs). Leave empty to run in all servers.",
        default: ""
    },
    enableCounterLock: {
        type: OptionType.BOOLEAN,
        description: "Counter lock attackers. When someone tries to remove your protection or uwulock you, instantly strip their protection and uwulock them back with two fast messages.",
        default: false
    },
    enableAutoUwulock: {
        type: OptionType.BOOLEAN,
        description: "Keep watched users uwulocked. When someone removes their uwulock or sneaks a protect add on them (which strips uwulock) via prefix or slash command, instantly strip protect and send ,uwulock add to re-lock them. If Greed refuses to lock them, their protect is stripped first. Manage the list with /autouwulock.",
        default: true
    },
    enableAutoSpread: {
        type: OptionType.BOOLEAN,
        description: "Spread autouwulock to attackers. When someone removes uwulock from a watched user via prefix or slash command, add the attacker to autouwulock and lock them too.",
        default: false
    },
    enableLockFailsafe: {
        type: OptionType.BOOLEAN,
        description: "Failsafe for watched users. Greed deletes locked users messages, so if a watched user's message survives 8 seconds they are probably unlocked and ,uwulock add is sent again (at most once per minute per user).",
        default: true
    },
    autoUwulockUserIds: {
        type: OptionType.STRING,
        description: "User IDs to keep uwulocked (comma separated). Managed by /autouwulock, you can also edit manually.",
        default: ""
    }
});

function parseIdList(value: string): Set<string> {
    const ids = new Set<string>();
    if (!value) return ids;
    for (const part of value.split(/[,\s]+/)) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        if (/^\d{5,22}$/.test(trimmed)) ids.add(trimmed);
    }
    return ids;
}

function getProtectedIds(): Set<string> {
    const ids = new Set<string>();
    const current = UserStore.getCurrentUser?.()?.id;
    if (current) ids.add(current);
    const extra = parseIdList(settings.store.protectedUserIds);
    for (const id of extra) ids.add(id);
    return ids;
}

function getAutoUwulockIds(): Set<string> {
    return parseIdList(settings.store.autoUwulockUserIds);
}

function getAllowedGuildIds(): Set<string> | null {
    const raw = settings.store.allowedGuildIds?.trim();
    if (!raw) return null;
    const set = parseIdList(raw);
    if (set.size === 0) return null;
    return set;
}

function getComponentsText(components: any): string[] {
    const out: string[] = [];
    if (!Array.isArray(components)) return out;
    const stack: any[] = [...components];
    while (stack.length > 0) {
        const c = stack.pop();
        if (!c || typeof c !== "object") continue;
        if (typeof c.content === "string" && c.content) out.push(c.content);
        if (Array.isArray(c.components)) stack.push(...c.components);
    }
    return out;
}

function getSearchableText(message: any): string {
    const parts: string[] = [];
    if (typeof message?.content === "string" && message.content) parts.push(message.content);
    const embeds = message?.embeds;
    if (Array.isArray(embeds)) {
        for (const e of embeds) {
            if (!e || typeof e !== "object") continue;
            if (typeof e.title === "string") parts.push(e.title);
            if (typeof e.description === "string") parts.push(e.description);
            if (Array.isArray(e.fields)) {
                for (const f of e.fields) {
                    if (typeof f?.name === "string") parts.push(f.name);
                    if (typeof f?.value === "string") parts.push(f.value);
                }
            }
            if (typeof e.footer?.text === "string") parts.push(e.footer.text);
            if (typeof e.author?.name === "string") parts.push(e.author.name);
        }
    }
    for (const t of getComponentsText(message?.components)) parts.push(t);
    return parts.join("\n");
}

function getUserDisplayNames(userId: string, guildId: string | undefined): string[] {
    const names: string[] = [];
    const user = UserStore.getUser?.(userId) as any;
    if (typeof user?.username === "string" && user.username) names.push(user.username);
    if (typeof user?.globalName === "string" && user.globalName) names.push(user.globalName);
    if (guildId) {
        const nick = (GuildMemberStore.getMember?.(guildId, userId) as any)?.nick;
        if (typeof nick === "string" && nick) names.push(nick);
    }
    return names;
}

function isTargeted(message: any, targetId: string, guildId: string | undefined): boolean {
    if (Array.isArray(message?.mentions) && message.mentions.some((m: any) => m?.id === targetId)) return true;
    const text = getSearchableText(message);
    if (!text) return false;
    if (text.includes(`<@${targetId}>`) || text.includes(`<@!${targetId}>`)) return true;
    if (text.includes(targetId) && new RegExp(`\\b${targetId}\\b`).test(text)) return true;
    // Greed slash confirmations name the user without mentioning them, so match display names too.
    const lower = text.toLowerCase();
    for (const name of getUserDisplayNames(targetId, guildId)) {
        if (name.length >= 3 && lower.includes(name.toLowerCase())) return true;
    }
    return false;
}

function getTargetedIds(message: any, protectedIds: Set<string>, guildId: string | undefined): string[] {
    const out: string[] = [];
    for (const id of protectedIds) {
        if (isTargeted(message, id, guildId)) out.push(id);
    }
    return out;
}

function isGuildAllowed(guildId: string | undefined, allowed: Set<string> | null): boolean {
    if (!allowed) return true;
    if (!guildId) return false;
    return allowed.has(guildId);
}

function sendBotCommand(channelId: string, content: string) {
    if (!channelId || !content) return;
    try {
        logger.info(`Sending: ${content} in ${channelId}`);
        sendMessage(channelId, { content });
    } catch (e) {
        logger.error("Failed to send bot command", e);
    }
}

const PROTECT_REMOVE_RE = /^\s*,uwulock\s+protect\s+remove\b/i;
const PROTECT_ADD_RE = /^\s*,uwulock\s+protect\s+add\b/i;
const UWULOCK_REMOVE_RE = /^\s*,uwulock\s+remove\b/i;
const ATTACK_PREFIXES = [
    /^\s*,uwulock\b/i,
    /^\s*,to\b/i,
    /^\s*,kick\b/i,
    /^\s*,ban\b/i,
    /^\s*,mute\b/i,
];

function isPlainUwulock(content: string): boolean {
    if (!/^\s*,uwulock\b/i.test(content)) return false;
    if (/protect/i.test(content)) return false;
    if (UWULOCK_REMOVE_RE.test(content)) return false;
    return true;
}

const SLASH_UNLOCK_RE = /\/uwulock\b.{0,80}\bremov/i;
const SLASH_PROTECT_ADD_RE = /\/uwulock\b.{0,80}\bprotect\b.{0,80}\badd/i;
const SLASH_LOCK_RE = /\/uwulock\b.{0,80}\badd/i;
const BOT_UNLOCK_SIGNAL_RE = /remov|unlock|un[\s-]*uwu/i;
const BOT_PROTECT_ADD_SIGNAL_RE = /protect.{0,40}(add|enabled|on)|now protected|has been protected|successfully protected/i;
const BOT_LOCK_SIGNAL_RE = /added\b.{0,80}\buwulock|now (uwulocked|locked)|has been (uwulocked|locked)|successfully (uwulocked|locked)/i;
const FAILSAFE_WINDOW_MS = 8_000;
const FAILSAFE_RETRY_COOLDOWN_MS = 60_000;
const UWULOCK_FAIL_RE = /can['’]?t|cannot|couldn['’]?t|fail|unable|error|already protected|is protected|remove.{0,40}protect/i;
const UWULOCK_LOCK_SUCCESS_RE = /successfully|now (uwulocked|locked|protected)|has been (uwulocked|locked)|protect (added|enabled)/i;

function getInteractionName(message: any): string {
    const name = message?.interaction?.name ?? message?.interactionMetadata?.name ?? message?.interaction_metadata?.name ?? message?.interaction?.commandName;
    return typeof name === "string" ? name : "";
}

function getInteractionUserId(message: any): string | undefined {
    const ids = [
        message?.interaction?.user?.id,
        message?.interaction?.member?.user?.id,
        message?.interactionMetadata?.user?.id,
        message?.interaction_metadata?.user?.id
    ];
    for (const id of ids) {
        if (typeof id === "string" && /^\d{5,22}$/.test(id)) return id;
    }
    return undefined;
}

function getUnlockAttackerId(message: any, content: string, isBot: boolean): string | undefined {
    if (!isBot && content && (UWULOCK_REMOVE_RE.test(content) || SLASH_UNLOCK_RE.test(content))) {
        const id = message?.author?.id;
        if (typeof id === "string" && /^\d{5,22}$/.test(id)) return id;
    }
    return getInteractionUserId(message);
}

function getProtectAddAttackerId(message: any, content: string, isBot: boolean): string | undefined {
    if (!isBot && content && (PROTECT_ADD_RE.test(content) || SLASH_PROTECT_ADD_RE.test(content))) {
        const id = message?.author?.id;
        if (typeof id === "string" && /^\d{5,22}$/.test(id)) return id;
    }
    return getInteractionUserId(message);
}

function isUwulockAddFailure(message: any): boolean {
    if (message?.author?.bot !== true) return false;
    const text = getSearchableText(message);
    if (!text || !/uwulock/i.test(text)) return false;
    if (UWULOCK_LOCK_SUCCESS_RE.test(text)) return false;
    return UWULOCK_FAIL_RE.test(text);
}

const failsafePending = new Map<string, { userId: string; channelId: string; timeout: ReturnType<typeof setTimeout>; }>();
const failsafeLastRetry = new Map<string, number>();

function armLockFailsafe(message: any, watched: Set<string>) {
    const userId = message?.author?.id;
    if (typeof userId !== "string" || !watched.has(userId)) return;
    if (message?.author?.bot === true) return;
    if (message?.webhook_id || message?.webhookId) return;
    const type = message?.type;
    if (type !== 0 && type !== 19) return;
    const channelId = message?.channel_id;
    if (typeof channelId !== "string" || !channelId) return;
    if (typeof message?.id !== "string" || failsafePending.has(message.id)) return;
    if (failsafePending.size > 200) return;
    const timeout = setTimeout(() => {
        failsafePending.delete(message.id);
        const now = Date.now();
        if (now - (failsafeLastRetry.get(userId) ?? 0) < FAILSAFE_RETRY_COOLDOWN_MS) return;
        failsafeLastRetry.set(userId, now);
        sendBotCommand(channelId, `,uwulock add <@${userId}>`);
    }, FAILSAFE_WINDOW_MS);
    failsafePending.set(message.id, { userId, channelId, timeout });
}

function handleDelete(data: any) {
    const id = data?.id;
    if (typeof id !== "string") return;
    const pending = failsafePending.get(id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    failsafePending.delete(id);
}

function isUnlockEvent(message: any): boolean {
    const text = getSearchableText(message);
    if (text && UWULOCK_REMOVE_RE.test(text)) return true;
    if (text && SLASH_UNLOCK_RE.test(text)) return true;
    const interactionName = getInteractionName(message);
    if (/uwulock/i.test(interactionName)) {
        if (/remov|unlock/i.test(interactionName) || (text && /remov|unlock/i.test(text))) return true;
        const raw = JSON.stringify(message.interaction ?? message.interactionMetadata ?? message.interaction_metadata ?? {}).slice(0, 1000);
        if (/remov/i.test(raw)) return true;
    }
    if (message?.author?.bot && text && /uwulock/i.test(text) && BOT_UNLOCK_SIGNAL_RE.test(text)) return true;
    return false;
}

function isProtectAddEvent(message: any): boolean {
    const text = getSearchableText(message);
    if (text && PROTECT_ADD_RE.test(text)) return true;
    if (text && SLASH_PROTECT_ADD_RE.test(text)) return true;
    const interactionName = getInteractionName(message);
    if (/uwulock/i.test(interactionName)) {
        if (/protect/i.test(interactionName) && /add/i.test(interactionName)) return true;
        if (text && /uwulock/i.test(text) && /protect/i.test(text) && /add/i.test(text)) return true;
        const raw = JSON.stringify(message.interaction ?? message.interactionMetadata ?? message.interaction_metadata ?? {}).slice(0, 1000);
        if (/protect/i.test(raw) && /add/i.test(raw)) return true;
    }
    if (message?.author?.bot && text && /protect/i.test(text) && BOT_PROTECT_ADD_SIGNAL_RE.test(text)) return true;
    return false;
}

function isLockEvent(message: any): boolean {
    const text = getSearchableText(message);
    if (!text) return false;
    // Prefix invocations are handled by the prefix self-defense block; only catch slash/interaction/bot here.
    if (PROTECT_ADD_RE.test(text) || SLASH_PROTECT_ADD_RE.test(text)) return false;
    if (SLASH_LOCK_RE.test(text)) return true;
    const interactionName = getInteractionName(message);
    if (/uwulock/i.test(interactionName)) {
        if (/protect/i.test(interactionName)) return false;
        if (/\badd\b/i.test(interactionName)) return true;
        const raw = JSON.stringify(message.interaction ?? message.interactionMetadata ?? message.interaction_metadata ?? {}).slice(0, 1000);
        if (/\badd\b/i.test(raw)) return true;
    }
    // Greed bot confirmation, e.g. ":approve: @attacker: Added <name> to uwulock."
    if (message?.author?.bot && /uwulock/i.test(text) && BOT_LOCK_SIGNAL_RE.test(text) && !UWULOCK_FAIL_RE.test(text)) return true;
    return false;
}

function extractLockVictimText(text: string): string | null {
    const added = text.match(/added\s+(.+?)\s+to\s+uwulock/i);
    if (added?.[1]) return added[1].trim();
    const now = text.match(/(.+?)\s+(?:is\s+)?now\s+(?:uwu)?locked/i);
    if (now?.[1]) {
        const tail = now[1].split(/[:\n]/).pop()?.trim();
        if (tail) return tail.slice(-160);
    }
    const hasBeen = text.match(/(.+?)\s+has been\s+(?:uwu)?locked/i);
    if (hasBeen?.[1]) {
        const tail = hasBeen[1].split(/[:\n]/).pop()?.trim();
        if (tail) return tail.slice(-160);
    }
    return null;
}

function getLockVictimIds(message: any, protectedIds: Set<string>, guildId: string | undefined): string[] {
    const text = getSearchableText(message);
    if (!text) return [];
    const victimText = extractLockVictimText(text);
    const out: string[] = [];
    for (const id of protectedIds) {
        let isVictim = false;
        if (victimText !== null) {
            if (victimText.includes(`<@${id}>`) || victimText.includes(`<@!${id}>`)) isVictim = true;
            else if (victimText.includes(id) && new RegExp(`\\b${id}\\b`).test(victimText)) isVictim = true;
            else {
                const lowerVictim = victimText.toLowerCase();
                for (const name of getUserDisplayNames(id, guildId)) {
                    if (name.length >= 3 && lowerVictim.includes(name.toLowerCase())) { isVictim = true; break; }
                }
            }
        } else {
            // Fallback: no victim pattern — search after "added" to avoid matching the attacker name before it
            const lower = text.toLowerCase();
            const addedIdx = lower.indexOf("added");
            const searchText = addedIdx !== -1 ? text.slice(addedIdx) : text;
            const pseudo = { content: searchText, mentions: message.mentions, embeds: message.embeds, components: message.components };
            // isTargeted on the sliced text (reuses display-name + mention logic)
            if (isTargeted(pseudo as any, id, guildId)) isVictim = true;
            else if (addedIdx === -1 && isTargeted(message, id, guildId)) isVictim = true;
        }
        if (isVictim) out.push(id);
    }
    return out;
}

function handleMessage(message: any) {
    if (!message?.author?.id) return;
    if (!message.channel_id) return;

    const currentUserId = UserStore.getCurrentUser?.()?.id;
    if (!currentUserId) return;
    if (message.author.id === currentUserId) return;

    const allowed = getAllowedGuildIds();
    if (!isGuildAllowed(message.guild_id, allowed)) return;

    const content = typeof message.content === "string" ? message.content : "";
    const isBot = message.author.bot === true;
    const guildId: string | undefined = message.guild_id ?? ChannelStore.getChannel?.(message.channel_id)?.guild_id;

    // Resolved once per message: the checks below used to rebuild this set
    // (getCurrentUser + settings split) up to four times per message.
    const protectedIds = getProtectedIds();

    // Existing defenses watch attacker prefix commands only.
    if (!isBot && content) {
        const targeted = getTargetedIds(message, protectedIds, guildId);

        if (targeted.length > 0) {
            const attackerId = message.author.id;
            const attackerMention = `<@${attackerId}>`;

            // 1. Protect re-add: ,uwulock protect remove <@target> -> ,uwulock protect add <@target>
            if (settings.store.enableProtectReadd && PROTECT_REMOVE_RE.test(content)) {
                for (const tid of targeted) {
                    sendBotCommand(message.channel_id, `,uwulock protect add <@${tid}>`);
                }
            }

            // 2. Uwulock remove: ,uwulock <@target> -> remove the lock and restore protect
            if (settings.store.enableUwulockRemove && isPlainUwulock(content)) {
                for (const tid of targeted) {
                    sendBotCommand(message.channel_id, `,uwulock remove <@${tid}>`);
                    sendBotCommand(message.channel_id, `,uwulock protect add <@${tid}>`);
                }
            }

            // 3. Counter timeout: ,uwulock/,to/,kick/,ban/,mute on protected -> ,to <@attacker> 60s
            if (settings.store.enableCounterTo) {
                const isAttack = ATTACK_PREFIXES.some(re => re.test(content));
                if (isAttack) {
                    const duration = Math.max(1, Number(settings.store.counterDuration) || 60);
                    // avoid sending multiple counters for same message
                    sendBotCommand(message.channel_id, `,to ${attackerMention} ${duration}s`);
                }
            }

            // 4. Counter lock: remove attacker protection then uwulock them
            if (settings.store.enableCounterLock && (PROTECT_REMOVE_RE.test(content) || isPlainUwulock(content))) {
                sendBotCommand(message.channel_id, `,uwulock protect remove ${attackerMention}`);
                sendBotCommand(message.channel_id, `,uwulock add ${attackerMention}`);
            }
        }
    }

    // 2b. Uwulock remove self-defense for slash/bot confirmations: Greed confirms
    // e.g. ":approve: @attacker: Added <name> to uwulock." Strip it and re-protect.
    // Victim extraction avoids matching your own name as the attacker (":approve: @you: Added HIM...")
    if (settings.store.enableUwulockRemove && isLockEvent(message)) {
        const targeted = getLockVictimIds(message, protectedIds, guildId);
        if (targeted.length > 0) {
            for (const tid of targeted) {
                sendBotCommand(message.channel_id, `,uwulock remove <@${tid}>`);
                sendBotCommand(message.channel_id, `,uwulock protect add <@${tid}>`);
            }
        }
    }

    // 5. Auto uwulock: re-lock watched users when someone unlocks them or sneaks a
    // protect-add on them (which strips uwulock) via prefix, slash, or bot confirmation.
    if (settings.store.enableAutoUwulock) {
        const watched = getAutoUwulockIds();
        if (watched.size > 0) {
            // 5a. Greed refused to lock a watched user (usually protected) -> strip protect so the lock can land.
            if (isBot && isUwulockAddFailure(message)) {
                const failed = getTargetedIds(message, watched, guildId);
                for (const tid of failed) {
                    sendBotCommand(message.channel_id, `,uwulock protect remove <@${tid}>`);
                    sendBotCommand(message.channel_id, `,uwulock add <@${tid}>`);
                }
            } else if (isUnlockEvent(message)) {
                const targeted = getTargetedIds(message, watched, guildId);
                if (targeted.length > 0) {
                    for (const tid of targeted) {
                        sendBotCommand(message.channel_id, `,uwulock add <@${tid}>`);
                    }
                    // 6. Auto spread: punish the admin who unlocked a watched user.
                    if (settings.store.enableAutoSpread) {
                        const attackerId = getUnlockAttackerId(message, content, isBot);
                        if (attackerId && !targeted.includes(attackerId) && !protectedIds.has(attackerId)) {
                            if (!watched.has(attackerId)) {
                                watched.add(attackerId);
                                settings.store.autoUwulockUserIds = [...watched].join(", ");
                            }
                            sendBotCommand(message.channel_id, `,uwulock protect remove <@${attackerId}>`);
                            sendBotCommand(message.channel_id, `,uwulock add <@${attackerId}>`);
                        }
                    }
                }
            } else if (isProtectAddEvent(message)) {
                // 5b. Protect-add bypass: protecting a watched user strips their uwulock,
                // so strip the protection and re-lock them instantly.
                const targeted = getTargetedIds(message, watched, guildId);
                if (targeted.length > 0) {
                    for (const tid of targeted) {
                        sendBotCommand(message.channel_id, `,uwulock protect remove <@${tid}>`);
                        sendBotCommand(message.channel_id, `,uwulock add <@${tid}>`);
                    }
                    // 6. Auto spread: punish the admin who protected a watched user.
                    if (settings.store.enableAutoSpread) {
                        const attackerId = getProtectAddAttackerId(message, content, isBot);
                        if (attackerId && !targeted.includes(attackerId) && !protectedIds.has(attackerId)) {
                            if (!watched.has(attackerId)) {
                                watched.add(attackerId);
                                settings.store.autoUwulockUserIds = [...watched].join(", ");
                            }
                            sendBotCommand(message.channel_id, `,uwulock protect remove <@${attackerId}>`);
                            sendBotCommand(message.channel_id, `,uwulock add <@${attackerId}>`);
                        }
                    }
                }
            }
        }
    }

    // 7. Lock failsafe: a watched user's message surviving 8 seconds means Greed isn't deleting it, so lock again.
    if (settings.store.enableAutoUwulock && settings.store.enableLockFailsafe && guildId) {
        armLockFailsafe(message, getAutoUwulockIds());
    }
}

export default definePlugin({
    name: "GreedCmds",
    description: "Greed bot auto defense. Re-adds uwulock protect, removes uwulock, counters kick/ban/mute/to attacks, keeps /autouwulock users locked, spreads the lock to admins who unlock them, strips protect when Greed refuses a lock, and re-locks watched users whose messages stop being deleted. Supports protected users and allowed servers filtering.",
    authors: [TestcordDevs.x2b],
    settings,

    commands: [
        {
            name: "autouwulock",
            description: "Keep a user uwulocked. Toggles watch; re-sends ,uwulock add when they get unlocked.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "user",
                    description: "User to keep uwulocked. Leave empty to list watched users.",
                    type: ApplicationCommandOptionType.USER,
                    required: false
                }
            ],
            execute(args, ctx) {
                const userId = findOption<string>(args, "user", "");
                const watched = getAutoUwulockIds();
                if (!userId) {
                    if (watched.size === 0) {
                        sendBotMessage(ctx.channel.id, { content: "Autouwulock list is empty. Use `/autouwulock @user` to watch someone." });
                    } else {
                        const list = [...watched].map(id => `<@${id}>`).join(", ");
                        sendBotMessage(ctx.channel.id, { content: `Autouwulock watching (${watched.size}): ${list}` });
                    }
                    return;
                }
                if (!/^\d{5,22}$/.test(userId)) {
                    sendBotMessage(ctx.channel.id, { content: "Invalid user. Pick someone with `/autouwulock @user`." });
                    return;
                }
                if (watched.has(userId)) {
                    watched.delete(userId);
                    settings.store.autoUwulockUserIds = [...watched].join(", ");
                    sendBotMessage(ctx.channel.id, { content: `Removed <@${userId}> from autouwulock. Watching ${watched.size}.` });
                } else {
                    watched.add(userId);
                    settings.store.autoUwulockUserIds = [...watched].join(", ");
                    sendBotMessage(ctx.channel.id, { content: `Added <@${userId}> to autouwulock. They will be re-locked with \`,uwulock add\` when unlocked.` });
                }
            }
        }
    ],

    flux: {
        MESSAGE_CREATE(data: any) {
            const message = data?.message ?? data;
            if (message) handleMessage(message);
        },
        MESSAGE_DELETE(data: any) {
            if (data) handleDelete(data);
        }
    },

    stop() {
        for (const pending of failsafePending.values()) clearTimeout(pending.timeout);
        failsafePending.clear();
        failsafeLastRetry.clear();
    }
});
