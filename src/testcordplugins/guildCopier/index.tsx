/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { sleep } from "@utils/misc";
import { ModalCloseButton, ModalContent, ModalHeader, ModalProps, ModalRoot, ModalSize, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { findByCodeLazy } from "@webpack";
import {
    Button,
    ChannelStore,
    EmojiStore,
    GuildMemberStore,
    GuildRoleStore,
    GuildStore,
    Menu,
    PermissionsBits,
    PermissionStore,
    React,
    RestAPI,
    showToast,
    StickersStore,
    Text,
    TextInput,
    Toasts,
    UserStore,
} from "@webpack/common";

const cl = classNameFactory("vc-guildcopier-");

type Guild = NonNullable<ReturnType<typeof GuildStore.getGuild>>;

const LOG = (...args: any[]) => console.log("[GuildCopier]", ...args);
const ERR = (...args: any[]) => console.error("[GuildCopier]", ...args);

interface BackupRole {
    name: string;
    color: number;
    hoist: boolean;
    permissions: string;
    mentionable: boolean;
    position: number;
    id: string;
}

interface GuildRole {
    id: string;
    name: string;
    managed?: boolean;
    position?: number;
}

interface BackupChannel {
    name: string;
    type: number;
    topic?: string;
    nsfw: boolean;
    parent_id?: string;
    position: number;
    permission_overwrites: any[];
    id: string;
    rate_limit_per_user?: number;
    bitrate?: number;
    user_limit?: number;
    default_auto_archive_duration?: number;
    rtc_region?: string | null;
    video_quality_mode?: number;
    default_thread_rate_limit_per_user?: number;
}

interface BackupEmote {
    name: string;
    id: string;
    animated: boolean;
    url: string;
}

interface BackupSticker {
    name: string;
    id: string;
    format_type: number;
    url: string;
    tags: string;
    description: string;
}

const uploadEmoji = findByCodeLazy(".GUILD_EMOJIS(", "EMOJI_UPLOAD_START");

const StickerExtMap = {
    1: "png",
    2: "png",
    3: "json",
    4: "gif"
} as const;

const MAX_EMOJI_SIZE_BYTES = 256 * 1024;
const MAX_STICKER_SIZE_BYTES = 512 * 1024;

function hasAllPermissions(permissions: bigint, required: bigint) {
    return (permissions & required) === required;
}

function getRequiredTransferPermissions() {
    let required = 0n;

    if (settings.store.copyRoles) required |= PermissionsBits.MANAGE_ROLES;
    if (settings.store.copyChannels || settings.store.copyBots) required |= PermissionsBits.MANAGE_CHANNELS;
    if (settings.store.copyEmojis || settings.store.copyStickers) required |= PermissionsBits.MANAGE_GUILD_EXPRESSIONS;

    return required;
}

function canTransferToGuild(guild: Guild, sourceGuildId: string) {
    if (guild.id === sourceGuildId) return false;
    if (guild.ownerId === UserStore.getCurrentUser().id) return true;

    const permissions = PermissionStore.getGuildPermissions(guild);
    return hasAllPermissions(permissions, PermissionsBits.ADMINISTRATOR)
        || hasAllPermissions(permissions, getRequiredTransferPermissions());
}

function getTransferGuilds(sourceGuildId: string) {
    return Object.values(GuildStore.getGuilds())
        .filter(guild => canTransferToGuild(guild, sourceGuildId))
        .sort((a, b) => a.name.localeCompare(b.name));
}

const settings = definePluginSettings({
    copyRoles: {
        type: OptionType.BOOLEAN,
        description: "Copy roles from the original guild",
        default: true,
    },
    copyChannels: {
        type: OptionType.BOOLEAN,
        description: "Copy channels and categories from the original guild",
        default: true,
    },
    copyEmojis: {
        type: OptionType.BOOLEAN,
        description: "Copy emojis from the original guild",
        default: true,
    },
    copyStickers: {
        type: OptionType.BOOLEAN,
        description: "Copy stickers from the original guild",
        default: true,
    },
    copyBots: {
        type: OptionType.BOOLEAN,
        description: "Create a #bots-list channel with invite links for all bots in the original guild",
        default: true,
    },
    emojiCount: {
        type: OptionType.NUMBER,
        description: "Maximum number of emojis to copy (per type: PNG and GIF)",
        default: 50,
    },
    stickerCount: {
        type: OptionType.NUMBER,
        description: "Maximum number of stickers to copy",
        default: 5,
    },
});

async function fetchBlob(url: string, maxSize: number) {
    for (let size = 4096; size >= 16; size /= 2) {
        const res = await fetch(`${url}?size=${size}&lossless=true&animated=true`);
        if (!res.ok)
            throw new Error(`Failed to fetch ${url} - ${res.status}`);

        const blob = await res.blob();
        if (blob.size <= maxSize)
            return blob;
    }

    throw new Error(`Failed to fetch within size limit of ${maxSize / 1000}kB`);
}

async function cloneSticker(guildId: string, sticker: BackupSticker) {
    const data = new FormData();
    data.append("name", sticker.name);
    data.append("tags", sticker.tags);
    data.append("description", sticker.description);
    data.append("file", await fetchBlob(sticker.url, MAX_STICKER_SIZE_BYTES));

    await RestAPI.post({
        url: `/guilds/${guildId}/stickers`,
        body: data,
    });
}

async function cloneEmoji(guildId: string, emoji: BackupEmote) {
    const data = await fetchBlob(emoji.url, MAX_EMOJI_SIZE_BYTES);

    const dataUrl = await new Promise<string>(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(data);
    });

    return uploadEmoji({
        guildId,
        name: emoji.name,
        image: dataUrl
    });
}

async function createBotsChannel(guildId: string, newGuildId: string) {
    LOG("Creating bots channel...");

    const members = Object.values(GuildMemberStore.getMembers(guildId)) as any[];
    LOG(`Total members loaded in cache: ${members.length}`);

    const bots = members
        .filter(m => (UserStore as any).getUser(m.userId)?.bot)
        .map(m => {
            const user = (UserStore as any).getUser(m.userId);
            return {
                id: m.userId,
                username: user?.username || m.userId,
            };
        });

    LOG(`Bots found: ${bots.length}`, bots.map(b => b.username));

    if (bots.length === 0) {
        LOG("No bots found in cache");
        showToast("No bots found in cache — try scrolling through the member list first", Toasts.Type.MESSAGE);
        return;
    }

    try {
        LOG(`Creating #bots-list channel in guild ${newGuildId}`);
        const { body: channel } = await RestAPI.post({
            url: `/guilds/${newGuildId}/channels`,
            body: {
                name: "bots-list",
                type: 0,
            },
        });
        LOG(`Channel created: ${channel.id}`);
        await sleep(800);

        for (const bot of bots) {
            const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${bot.id}&scope=bot&permissions=0`;
            try {
                await RestAPI.post({
                    url: `/channels/${channel.id}/messages`,
                    body: {
                        content: `**${bot.username}**\n${inviteUrl}`,
                    },
                });
                LOG(`Sent invite for ${bot.username}`);
                await sleep(600);
            } catch (e) {
                ERR(`Failed to send message for bot ${bot.username}:`, e);
            }
        }

        showToast(`Created #bots-list with ${bots.length} bots!`, Toasts.Type.SUCCESS);
    } catch (e) {
        ERR("Failed to create bots channel:", e);
        showToast("Failed to create #bots-list channel", Toasts.Type.FAILURE);
    }
}

async function deleteGuildChannels(guildId: string) {
    const { body: channels } = await RestAPI.get({ url: `/guilds/${guildId}/channels` });
    const nonCategories = channels.filter((c: any) => c.type !== 4);
    const categories = channels.filter((c: any) => c.type === 4);
    for (const channel of [...nonCategories, ...categories]) {
        await RestAPI.del({ url: `/channels/${channel.id}` });
        await sleep(500);
    }
}

async function deleteGuildRoles(guildId: string) {
    const { body } = await RestAPI.get({ url: `/guilds/${guildId}/roles` });
    const roles = (body as GuildRole[])
        .filter(role => role.id !== guildId)
        .sort((a, b) => (b.position ?? 0) - (a.position ?? 0));

    for (const role of roles) {
        try {
            await RestAPI.del({ url: `/guilds/${guildId}/roles/${role.id}` });
            await sleep(500);
        } catch (e) {
            ERR(`Error deleting role ${role.name}:`, e);
        }
    }
}

async function copyGuild(guildId: string, targetGuildId?: string): Promise<void> {
    try {
        const guild = GuildStore.getGuild(guildId);
        if (!guild) throw new Error("Guild not found");

        LOG(`Starting copy of guild: ${guild.name} (${guildId})`);
        showToast(targetGuildId ? "Starting guild transfer process..." : "Starting guild copy process...", Toasts.Type.SUCCESS);

        // --- Roles ---
        const roles = GuildRoleStore.getSortedRoles(guildId);
        const backupRoles: BackupRole[] = roles
            .filter((role: any) => role.name !== "@everyone")
            .map((role: any) => ({
                name: role.name,
                color: role.color,
                hoist: role.hoist,
                permissions: role.permissions,
                mentionable: role.mentionable,
                position: role.position,
                id: role.id,
            }));
        LOG(`Roles to copy: ${backupRoles.length}`);

        // --- Channels ---
        const allChannels = ChannelStore.getMutableGuildChannelsForGuild(guildId);
        const backupChannels: BackupChannel[] = [];
        for (const [, channelData] of Object.entries(allChannels)) {
            if (channelData && (channelData as any).guild_id === guildId) {
                const permOverwrites = (channelData as any).permissionOverwrites
                    ? Object.values((channelData as any).permissionOverwrites)
                    : [];
                backupChannels.push({
                    name: (channelData as any).name,
                    type: (channelData as any).type === 5 ? 0 : (channelData as any).type,
                    topic: (channelData as any).topic,
                    nsfw: (channelData as any).nsfw,
                    parent_id: (channelData as any).parent_id,
                    position: (channelData as any).position,
                    permission_overwrites: permOverwrites,
                    id: (channelData as any).id,
                    rate_limit_per_user: (channelData as any).rateLimitPerUser,
                    bitrate: (channelData as any).bitrate,
                    user_limit: (channelData as any).userLimit,
                    default_auto_archive_duration: (channelData as any).defaultAutoArchiveDuration,
                    rtc_region: (channelData as any).rtcRegion,
                    video_quality_mode: (channelData as any).videoQualityMode,
                    default_thread_rate_limit_per_user: (channelData as any).defaultThreadRateLimitPerUser,
                });
            }
        }
        backupChannels.sort((a, b) => a.position - b.position);
        LOG(`Channels to copy: ${backupChannels.length}`);

        // --- Emojis ---
        const emojiCount = settings.store.emojiCount || 50;
        const allEmotes = EmojiStore.getGuildEmoji(guildId) || [];
        const staticEmotes = allEmotes.filter((e: any) => !e.animated).slice(0, emojiCount);
        const animatedEmotes = allEmotes.filter((e: any) => e.animated).slice(0, emojiCount);
        const backupEmotes: BackupEmote[] = [...staticEmotes, ...animatedEmotes].map((e: any) => ({
            name: e.name,
            id: e.id,
            animated: e.animated,
            url: `https://cdn.discordapp.com/emojis/${e.id}.${e.animated ? "gif" : "png"}`,
        }));
        LOG(`Emojis to copy: ${backupEmotes.length}`);

        // --- Stickers ---
        const stickerCount = settings.store.stickerCount || 5;
        const allStickers = StickersStore.getStickersByGuildId(guildId) || [];
        const selectedStickers = allStickers.sort(() => 0.5 - Math.random()).slice(0, stickerCount);
        const backupStickers: BackupSticker[] = selectedStickers.map((sticker: any) => ({
            name: sticker.name,
            id: sticker.id,
            format_type: sticker.format_type,
            url: `https://media.discordapp.net/stickers/${sticker.id}.${StickerExtMap[sticker.format_type]}`,
            tags: sticker.tags,
            description: sticker.description,
        }));
        LOG(`Stickers to copy: ${backupStickers.length}`);

        let newGuildId = targetGuildId;
        if (newGuildId) {
            const targetGuild = GuildStore.getGuild(newGuildId);
            if (!targetGuild) throw new Error("Target guild not found");

            LOG(`Transferring into guild: ${targetGuild.name} (${newGuildId})`);
            showToast(`Transferring into ${targetGuild.name}`, Toasts.Type.SUCCESS);
            if (settings.store.copyRoles) {
                await deleteGuildRoles(newGuildId);
                LOG("Target roles deleted");
            }
            if (settings.store.copyChannels) {
                try {
                    await deleteGuildChannels(newGuildId);
                    LOG("Target channels deleted");
                } catch (e) {
                    ERR("Error deleting target channels:", e);
                }
            }
        } else {
            // --- Create new guild ---
            LOG("Creating new guild...");
            const { body: newGuild } = await RestAPI.post({
                url: "/guilds",
                body: {
                    name: `${guild.name} (Copy)`,
                    icon: guild.icon,
                    description: guild.description,
                },
            });
            newGuildId = newGuild.id;
            LOG(`New guild created: ${newGuild.name} (${newGuildId})`);
            showToast(`Created new guild: ${newGuild.name}`, Toasts.Type.SUCCESS);
            if (!newGuildId) throw new Error("Target guild not found");

            // --- Delete default channels ---
            try {
                await deleteGuildChannels(newGuildId);
                LOG("Default channels deleted");
            } catch (e) {
                ERR("Error deleting default channels:", e);
            }
        }
        if (!newGuildId) throw new Error("Target guild not found");
        const destinationGuildId = newGuildId;

        // --- Copy roles ---
        const roleMapping: Record<string, string> = {};
        roleMapping[guild.id] = destinationGuildId;
        if (settings.store.copyRoles) {
            LOG("Copying roles...");
            for (const role of backupRoles) {
                try {
                    const { body } = await RestAPI.post({
                        url: `/guilds/${destinationGuildId}/roles`,
                        body: {
                            name: role.name,
                            permissions: role.permissions,
                            color: role.color,
                            hoist: role.hoist,
                            mentionable: role.mentionable,
                        },
                    });
                    roleMapping[role.id] = body.id;
                    await sleep(500);
                } catch (e) {
                    ERR(`Error creating role ${role.name}:`, e);
                }
            }
            const rolePositions = backupRoles
                .map(role => ({ id: roleMapping[role.id], position: role.position }))
                .filter((role): role is { id: string; position: number; } => Boolean(role.id));
            if (rolePositions.length) {
                try {
                    await RestAPI.patch({ url: `/guilds/${destinationGuildId}/roles`, body: rolePositions });
                } catch (e) {
                    ERR("Error ordering roles:", e);
                }
            }
            LOG("Roles done");
        }

        // --- Copy channels ---
        const channelMapping: Record<string, string> = {};
        if (settings.store.copyChannels) {
            LOG("Copying channels...");
            const categories = backupChannels.filter(c => c.type === 4);
            const otherChannels = backupChannels.filter(c => c.type !== 4);

            for (const channel of categories) {
                try {
                    const permissionOverwrites = channel.permission_overwrites.map((o: any) => ({
                        ...o, id: roleMapping[o.id] || o.id,
                    }));
                    const { body } = await RestAPI.post({
                        url: `/guilds/${destinationGuildId}/channels`,
                        body: { name: channel.name, type: channel.type, permission_overwrites: permissionOverwrites },
                    });
                    channelMapping[channel.id] = body.id;
                    await sleep(500);
                } catch (e) {
                    ERR(`Error creating category ${channel.name}:`, e);
                }
            }

            const channelsByParent: Record<string, BackupChannel[]> = {};
            for (const channel of otherChannels) {
                const parentKey = channel.parent_id || "none";
                if (!channelsByParent[parentKey]) channelsByParent[parentKey] = [];
                channelsByParent[parentKey].push(channel);
            }

            for (const parentKey of Object.keys(channelsByParent)) {
                const groupChannels = channelsByParent[parentKey];
                const nonForums = groupChannels.filter(c => c.type !== 15).sort((a, b) => a.position - b.position);
                const forums = groupChannels.filter(c => c.type === 15).sort((a, b) => a.position - b.position);
                for (const channel of [...nonForums, ...forums]) {
                    try {
                        const permissionOverwrites = channel.permission_overwrites.map((o: any) => ({
                            ...o, id: roleMapping[o.id] || o.id,
                        }));
                        const channelBody: any = {
                            name: channel.name,
                            type: channel.type,
                            permission_overwrites: permissionOverwrites,
                            parent_id: channelMapping[channel.parent_id!] || null,
                        };
                        if (channel.topic) channelBody.topic = channel.topic;
                        if (channel.nsfw !== undefined) channelBody.nsfw = channel.nsfw;
                        if (channel.rate_limit_per_user) channelBody.rate_limit_per_user = channel.rate_limit_per_user;
                        if (channel.bitrate) channelBody.bitrate = channel.bitrate;
                        else if (channel.type === 2) channelBody.bitrate = 96000;
                        if (channel.user_limit) channelBody.user_limit = channel.user_limit;
                        if (channel.default_auto_archive_duration) channelBody.default_auto_archive_duration = channel.default_auto_archive_duration;
                        else if (channel.type === 5) channelBody.default_auto_archive_duration = 1440;
                        if (channel.rtc_region && channel.rtc_region !== null) channelBody.rtc_region = channel.rtc_region;
                        if (channel.video_quality_mode) channelBody.video_quality_mode = channel.video_quality_mode;
                        if (channel.default_thread_rate_limit_per_user) channelBody.default_thread_rate_limit_per_user = channel.default_thread_rate_limit_per_user;

                        const { body } = await RestAPI.post({ url: `/guilds/${destinationGuildId}/channels`, body: channelBody });
                        channelMapping[channel.id] = body.id;
                        await sleep(500);
                    } catch (e) {
                        ERR(`Error creating channel ${channel.name}:`, e);
                    }
                }
            }
            LOG("Channels done");
        }

        // --- Create bots channel ---
        if (settings.store.copyBots) {
            await createBotsChannel(guildId, destinationGuildId);
        }

        // --- Copy emojis ---
        if (settings.store.copyEmojis) {
            LOG("Copying emojis...");
            for (const emote of backupEmotes) {
                try {
                    await cloneEmoji(destinationGuildId, emote);
                    LOG(`Emoji copied: ${emote.name}`);
                    await sleep(2500);
                } catch (e: any) {
                    ERR(`Error creating emote ${emote.name}:`, e);
                    if (e?.status === 429) {
                        const retryAfter = e?.body?.retry_after ?? e?.text?.match(/"retry_after":([\d.]+)/)?.[1];
                        const waitMs = retryAfter ? Math.min(parseFloat(retryAfter) * 1000, 15000) : 10000;
                        LOG(`Rate limited on emojis, waiting ${waitMs / 1000}s then retrying once...`);
                        await sleep(waitMs);
                        try {
                            await cloneEmoji(destinationGuildId, emote);
                            LOG(`Emoji copied on retry: ${emote.name}`);
                            await sleep(2500);
                        } catch (e2) {
                            ERR(`Skipping emoji ${emote.name} after retry failed:`, e2);
                        }
                    }
                }
            }
            LOG("Emojis done");
        }

        // --- Copy stickers ---
        if (settings.store.copyStickers) {
            LOG("Copying stickers...");
            for (const sticker of backupStickers) {
                try {
                    await cloneSticker(destinationGuildId, sticker);
                    LOG(`Sticker copied: ${sticker.name}`);
                    await sleep(1000);
                } catch (e) {
                    ERR(`Error creating sticker ${sticker.name}:`, e);
                }
            }
            LOG("Stickers done");
        }

        LOG("Guild copy completed!");
        showToast(targetGuildId ? "Guild transfer completed successfully!" : "Guild copy completed successfully!", Toasts.Type.SUCCESS);

    } catch (error) {
        ERR("Error during guild copy:", error);
        const errorMessage = error instanceof Error ? error.message : "An error occurred";
        showToast(`Error ${targetGuildId ? "transferring" : "copying"} guild: ${errorMessage}`, Toasts.Type.FAILURE);
    }
}

function TransferGuildModal({ modalProps, sourceGuildId }: { modalProps: ModalProps; sourceGuildId: string; }) {
    const [query, setQuery] = React.useState("");
    const [transferringTo, setTransferringTo] = React.useState<string | null>(null);
    const normalizedQuery = query.trim().toLowerCase();
    const guilds = getTransferGuilds(sourceGuildId)
        .filter(guild => !normalizedQuery || guild.name.toLowerCase().includes(normalizedQuery));

    return (
        <ModalRoot {...modalProps} size={ModalSize.MEDIUM}>
            <ModalHeader>
                <Text variant="heading-lg/semibold" tag="h1">Transfer Guild To</Text>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>
            <ModalContent>
                <TextInput
                    value={query}
                    onChange={setQuery}
                    placeholder="Search servers"
                    autoFocus
                />
                <div className={cl("guild-list")}>
                    {guilds.length ? guilds.map(guild => (
                        <div className={cl("guild-row")} key={guild.id}>
                            <Text variant="text-md/semibold" className={cl("guild-name")}>{guild.name}</Text>
                            <Button
                                size={Button.Sizes.SMALL}
                                disabled={transferringTo !== null}
                                onClick={() => {
                                    setTransferringTo(guild.id);
                                    modalProps.onClose();
                                    void copyGuild(sourceGuildId, guild.id);
                                }}
                            >
                                {transferringTo === guild.id ? "Transferring" : "Transfer"}
                            </Button>
                        </div>
                    )) : (
                        <Text variant="text-sm/normal" color="text-muted" className={cl("empty")}>No servers found where you have the needed permissions.</Text>
                    )}
                </div>
            </ModalContent>
        </ModalRoot>
    );
}

const ctxMenuPatch: NavContextMenuPatchCallback = (children, props) => {
    if (!props.guild) return;

    children.splice(1, 0,
        <Menu.MenuItem
            id="vc-guild-copy"
            label="Copy Guild"
            action={() => copyGuild(props.guild.id)}
        />,
        <Menu.MenuItem
            id="vc-guild-transfer-to"
            label="Transfer To"
            action={() => openModal(modalProps => <TransferGuildModal modalProps={modalProps as ModalProps} sourceGuildId={props.guild.id} />)}
        />
    );
};

export default definePlugin({
    name: "GuildCopier",
    description: "Copy an entire guild including channels, roles, permissions, emotes, stickers, and categories to create a new identical guild.",
    tags: ["Servers", "Utility"],
    authors: [TestcordDevs.x2b, TestcordDevs.nnenaza],
    dependencies: [],

    settings,

    contextMenus: {
        "guild-context": ctxMenuPatch,
    },
});
