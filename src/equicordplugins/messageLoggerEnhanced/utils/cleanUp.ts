/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
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

import { User } from "@vencord/discord-types";
import { MessageStore } from "@webpack/common";

import { LoggedMessageJSON, RefrencedMessage } from "../types";
import { getGuildIdByChannel, isGhostPinged } from "./index";

export function stripTransientRenderState(message: any) {
    if (!message || typeof message !== "object") return;
    // These runtime-only fields can contain React elements and must never be persisted.
    delete message.customRenderedContent;
    delete message.__messageloggerDiff;
    delete message.__messageloggerDiffKey;
    delete message.__messageloggerAggregated;
    delete message.__messageloggerLastAppliedKey;
}

export function sanitizeForIDB<T>(obj: T, seen = new WeakSet()): T {
    if (obj === null || obj === undefined) return obj;

    const type = typeof obj;
    if (type === "function" || type === "symbol") return undefined as any;
    if (type !== "object") return obj;

    if (obj instanceof Date) {
        return (isNaN(obj.getTime()) ? new Date().toISOString() : obj.toISOString()) as any;
    }

    if (typeof Blob !== "undefined" && obj instanceof Blob) return obj;
    if (typeof ArrayBuffer !== "undefined" && obj instanceof ArrayBuffer) return obj;

    if (seen.has(obj as any)) return undefined as any;
    seen.add(obj as any);

    if (Array.isArray(obj)) {
        const cleanedArr: any[] = [];
        for (const item of obj) {
            const cleanedItem = sanitizeForIDB(item, seen);
            if (cleanedItem !== undefined) {
                cleanedArr.push(cleanedItem);
            }
        }
        return cleanedArr as any;
    }

    if ((obj as any).$$typeof || (obj as any)._owner || (obj as any)._store) {
        return undefined as any;
    }

    const cleanedObj: Record<string, any> = {};
    for (const key of Object.keys(obj)) {
        if (key.startsWith("__messagelogger") || key === "customRenderedContent") {
            continue;
        }

        try {
            const val = (obj as any)[key];
            const valType = typeof val;

            if (valType === "function" || valType === "symbol") {
                continue;
            }

            const cleanedVal = sanitizeForIDB(val, seen);
            if (cleanedVal !== undefined) {
                cleanedObj[key] = cleanedVal;
            }
        } catch {
            // Ignore unreadable properties
        }
    }

    return cleanedObj as any;
}

export function cleanupMessage(message: any, removeDetails: boolean = true): LoggedMessageJSON {
    const ret: LoggedMessageJSON = typeof message.toJS === "function" ? message.toJS() : { ...message };
    stripTransientRenderState(ret);
    if (removeDetails) {
        ret.author = { ...ret.author, phone: undefined, email: undefined } as User;
    }

    ret.ghostPinged = ret.mentioned ?? isGhostPinged(message);
    ret.guildId = ret.guild_id ?? getGuildIdByChannel(ret.channel_id);
    ret.embeds = (ret.embeds ?? []).map(cleanupEmbed);
    ret.deleted = ret.deleted ?? false;
    ret.deletedTimestamp = ret.deleted ? (new Date()).toISOString() : undefined;
    ret.editHistory = ret.editHistory ?? [];
    if (ret.type === 19) {
        ret.message_reference = message.message_reference || message.messageReference;
        if (ret.message_reference) {
            if (message.referenced_message) {
                ret.referenced_message = cleanupMessage(message.referenced_message) as RefrencedMessage;
            } else if (MessageStore.getMessage(ret.message_reference.channel_id, ret.message_reference.message_id)) {
                ret.referenced_message = cleanupMessage(MessageStore.getMessage(ret.message_reference.channel_id, ret.message_reference.message_id)) as RefrencedMessage;
            }
        }
    }

    return sanitizeForIDB(ret);
}

export function cleanUpCachedMessage(message: any) {
    const ret = cleanupMessage(message, false);
    ret.ourCache = true;
    return ret;
}

// stolen from mlv2
export function cleanupEmbed(embed) {
    /* backported code from MLV2 rewrite */
    if (!embed.id) return embed; /* already cleaned */
    const retEmbed: any = {};
    if (typeof embed.rawTitle === "string") retEmbed.title = embed.rawTitle;
    if (typeof embed.rawDescription === "string") retEmbed.description = embed.rawDescription;
    if (typeof embed.referenceId !== "undefined") retEmbed.reference_id = embed.referenceId;
    // if (typeof embed.color === "string") retEmbed.color = ZeresPluginLibrary.ColorConverter.hex2int(embed.color);
    if (typeof embed.type !== "undefined") retEmbed.type = embed.type;
    if (typeof embed.url !== "undefined") retEmbed.url = embed.url;
    if (typeof embed.provider === "object") retEmbed.provider = { name: embed.provider.name, url: embed.provider.url };
    if (typeof embed.footer === "object") retEmbed.footer = { text: embed.footer.text, icon_url: embed.footer.iconURL, proxy_icon_url: embed.footer.iconProxyURL };
    if (typeof embed.author === "object") retEmbed.author = { name: embed.author.name, url: embed.author.url, icon_url: embed.author.iconURL, proxy_icon_url: embed.author.iconProxyURL };
    if (typeof embed.timestamp === "object" && embed.timestamp._isAMomentObject) retEmbed.timestamp = embed.timestamp.milliseconds();
    if (typeof embed.thumbnail === "object") {
        if (typeof embed.thumbnail.proxyURL === "string" || (typeof embed.thumbnail.url === "string" && !embed.thumbnail.url.endsWith("?format=jpeg"))) {
            retEmbed.thumbnail = {
                url: embed.thumbnail.url,
                proxy_url: typeof embed.thumbnail.proxyURL === "string" ? embed.thumbnail.proxyURL.split("?format")[0] : undefined,
                width: embed.thumbnail.width,
                height: embed.thumbnail.height
            };
        }
    }
    if (typeof embed.image === "object") {
        retEmbed.image = {
            url: embed.image.url,
            proxy_url: embed.image.proxyURL,
            width: embed.image.width,
            height: embed.image.height
        };
    }
    if (typeof embed.video === "object") {
        retEmbed.video = {
            url: embed.video.url,
            proxy_url: embed.video.proxyURL,
            width: embed.video.width,
            height: embed.video.height
        };
    }
    if (Array.isArray(embed.fields) && embed.fields.length) {
        retEmbed.fields = embed.fields.map(e => ({ name: e.rawName, value: e.rawValue, inline: e.inline }));
    }
    return retEmbed;
}

// stolen from mlv2
export function cleanupUserObject(user: User) {
    /* backported from MLV2 rewrite */
    return {
        discriminator: user.discriminator,
        username: user.username,
        avatar: user.avatar,
        id: user.id,
        bot: user.bot,
        public_flags: typeof user.publicFlags !== "undefined" ? user.publicFlags : (user as any).public_flags
    };
}
