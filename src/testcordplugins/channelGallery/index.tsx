/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChannelToolbarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { disableStyle, enableStyle } from "@api/Styles";
import { EquicordDevs, TestcordDevs } from "@utils/constants";
import { closeModal, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { ChannelStore, PermissionsBits, PermissionStore, React, SelectedChannelStore, useStateFromStores } from "@webpack/common";

import { GalleryModal } from "./components/GalleryModal";
import styles from "./style.css?managed";

const ChannelTypes = findByPropsLazy("DM", "GUILD_TEXT", "PUBLIC_THREAD", "UNKNOWN");
const ChannelTypesSets = findByPropsLazy("THREADS", "GUILD_TEXTUAL", "ALL_DMS");

export const settings = definePluginSettings({
    includeGifs: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Include GIFs in the gallery",
    },
    includeEmbeds: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Include embed images (thumbnails/images) in the gallery",
    },
    showCaptions: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Show filename captions on thumbnails",
    },
    pageSize: {
        type: OptionType.NUMBER,
        default: 100,
        description: "Messages fetched per page (max 100 allowed by Discord API)",
        isValid: (v: any) => Number.isFinite(v) && v >= 10 && v <= 100,
    },
    preloadPages: {
        type: OptionType.NUMBER,
        default: 2,
        description: "Pages to preload when opening (1–5 recommended)",
        isValid: (v: any) => Number.isFinite(v) && v >= 1 && v <= 5,
    }
});

function GalleryIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 24 24" width={20} height={20} fill="currentColor" aria-hidden="true" {...props}>
            <path d="M4 5a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V5Zm3-1a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1H7Z" />
            <path d="M8 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm11 12H7a5 5 0 0 1-5-5V8h2v7a3 3 0 0 0 3 3h12v2Z" />
            <path d="M8 14.5L10.25 12a1 1 0 0 1 1.5 0L14 14.5l1.25-1.25a1 1 0 0 1 1.5 0L18 14.5V15a1 1 0 0 1-1 1 H7 a1 1 0 0 1-1-1 v-.5 l2-2Z" />
        </svg>
    );
}

let modalKey: string | null = null;
let modalChannelId: string | null = null;

function isSupportedChannel(channel: any): boolean {
    if (!channel) return false;

    // Exclude DMs/group DMs explicitly.
    if (typeof channel.isDM === "function" && channel.isDM()) return false;
    if (typeof channel.isGroupDM === "function" && channel.isGroupDM()) return false;
    if (typeof channel.isMultiUserDM === "function" && channel.isMultiUserDM()) return false;

    const { type } = channel;
    if (ChannelTypes?.DM != null && type === ChannelTypes.DM) return false;
    if (ChannelTypes?.GROUP_DM != null && type === ChannelTypes.GROUP_DM) return false;
    if (ChannelTypesSets?.ALL_DMS?.has?.(type)) return false;

    if (typeof channel.isGuildTextual === "function" && channel.isGuildTextual()) return true;
    if (typeof channel.isThread === "function" && channel.isThread()) return true;

    if (ChannelTypesSets?.GUILD_TEXTUAL?.has?.(type) || ChannelTypesSets?.THREADS?.has?.(type)) return true;

    // Fallback for numeric channel types: 0 (GUILD_TEXT), 2 (GUILD_VOICE), 5 (ANNOUNCEMENT), 10, 11, 12 (THREADS), 15 (FORUM), 16 (MEDIA)
    if (typeof type === "number" && [0, 2, 5, 10, 11, 12, 15, 16].includes(type)) return true;

    return false;
}

function canUseGallery(channel: any): boolean {
    if (!isSupportedChannel(channel)) return false;
    if (channel?.guild_id && PermissionStore?.can && PermissionsBits?.VIEW_CHANNEL) {
        try {
            if (!PermissionStore.can(PermissionsBits.VIEW_CHANNEL, channel)) return false;
        } catch {}
    }
    return true;
}

function toggleGallery(channelId: string) {
    if (modalKey) {
        closeModal(modalKey);
        modalKey = null;
        modalChannelId = null;
        return;
    }

    modalChannelId = channelId;
    modalKey = openModal(((modalProps: any) => (
            <GalleryModal
                {...modalProps}
                channelId={channelId}
                settings={settings.store}
            />
        )) as any,
        {
            onCloseCallback: () => {
                modalKey = null;
                modalChannelId = null;
            }
        }
    );
}

function GalleryToolbarButton() {
    const channelId = useStateFromStores([SelectedChannelStore], () => SelectedChannelStore.getChannelId());
    const channel = useStateFromStores([ChannelStore], () => ChannelStore.getChannel(channelId));

    const supported = canUseGallery(channel);
    const selected = Boolean(modalKey && modalChannelId === channelId);

    // Close the modal when switching channels to avoid stale content.
    React.useEffect(() => {
        if (!modalKey) return;
        if (modalChannelId && modalChannelId !== channelId) {
            closeModal(modalKey);
        }
    }, [channelId]);

    return (
        <ChannelToolbarButton
            icon={GalleryIcon}
            tooltip="Gallery"
            disabled={!supported}
            selected={selected}
            onClick={() => supported && channelId && toggleGallery(channelId)}
        />
    );
}

export default definePlugin({
    name: "ChannelGallery",
    description: "Adds a Gallery view for images in the current channel",
    tags: ["Media", "Utility"],
    authors: [EquicordDevs.Benjii, TestcordDevs.x2b],
    dependencies: ["HeaderBarAPI"],

    settings,

    // Patch the built-in media viewer so clicking left/right halves navigates.
    // This complements the existing arrow-key navigation in Discord's viewer.
    patches: [],

    handleMediaViewerClick(e: any) {
        if (!e || e.button !== 0) return;
        try { e.stopPropagation?.(); } catch { }

        const el = e.currentTarget as HTMLElement | null;
        if (!el?.getBoundingClientRect) return;

        const rect = el.getBoundingClientRect();
        const x = (e.clientX ?? 0) - rect.left;
        const key = x < rect.width / 2 ? "ArrowLeft" : "ArrowRight";

        // Discord's media viewer already listens for arrow keys; synthesize the same event on click.
        try {
            window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
        } catch { }
    },

    // Injects a button into the channel header toolbar via HeaderBarAPI.
    headerBarButton: {
        location: "channeltoolbar",
        icon: GalleryIcon,
        render: GalleryToolbarButton,
        priority: 250
    },

    start() {
        enableStyle(styles);
    },
    stop() {
        disableStyle(styles);
    }
});
