/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { sendMessage } from "@utils/discord";
import { ChannelStore, CloudUploader, FluxDispatcher, SelectedChannelStore, SelectedGuildStore, UserStore } from "@webpack/common";
import { showError, showSent, showUploading } from "../ui/statusCard";
function resolveThreadId(parentId, candidateId) {
    if (!candidateId)
        return null;
    const candidate = ChannelStore.getChannel(candidateId);
    if (!candidate || candidate.parent_id !== parentId)
        return null;
    return candidate.isThread() || candidate.isForumPost() ? candidate.id : null;
}
function resolveUploadChannelId(selectedChannelId) {
    if (!selectedChannelId)
        return null;
    const channel = ChannelStore.getChannel(selectedChannelId);
    if (!channel || !channel.isForumChannel())
        return selectedChannelId;
    const guildId = SelectedGuildStore.getGuildId();
    const threadMatch = window.location.pathname.match(/\/threads\/(\d+)/);
    const pathMatch = window.location.pathname.match(/\/channels\/[^/]+\/([^/]+)/);
    const urlId = threadMatch?.[1] ?? pathMatch?.[1] ?? null;
    const candidates = [
        urlId,
        guildId ? SelectedChannelStore.getCurrentlySelectedChannelId(guildId) : null,
        guildId ? SelectedChannelStore.getMostRecentSelectedTextChannelId(guildId) : null,
        guildId ? SelectedChannelStore.getLastSelectedChannelId(guildId) : null,
    ];
    for (const candidateId of candidates) {
        const threadId = resolveThreadId(selectedChannelId, candidateId);
        if (threadId)
            return threadId;
    }
    return null;
}
function hasMatchingAttachment(message, file) {
    return Array.isArray(message.attachments) && message.attachments.some(attachment => (attachment?.filename === file.name || attachment?.size === file.size));
}
export function uploadFile(file) {
    const selectedChannelId = SelectedChannelStore.getChannelId();
    const channelId = resolveUploadChannelId(selectedChannelId);
    if (!channelId) {
        const baseChannel = selectedChannelId
            ? ChannelStore.getChannel(selectedChannelId)
            : null;
        showError(baseChannel?.isForumChannel()
            ? "Open a forum post to send a message."
            : "No channel selected.");
        return;
    }
    const upload = new CloudUploader({
        file,
        isThumbnail: false,
        platform: 1 /* CloudUploadPlatform.WEB */,
    }, channelId);
    upload.on("complete", () => {
        let timeoutId = null;
        const currentUserId = UserStore.getCurrentUser()?.id ?? null;
        const cleanup = (handler) => {
            if (timeoutId)
                clearTimeout(timeoutId);
            FluxDispatcher.unsubscribe("MESSAGE_CREATE", handler);
        };
        const handleMessageCreate = (data) => {
            const { message } = data;
            if (!message || message.channel_id !== channelId)
                return;
            if (currentUserId && message.author?.id !== currentUserId)
                return;
            if (!hasMatchingAttachment(message, file))
                return;
            showSent();
            cleanup(handleMessageCreate);
        };
        FluxDispatcher.subscribe("MESSAGE_CREATE", handleMessageCreate);
        timeoutId = setTimeout(() => cleanup(handleMessageCreate), 15000);
        const result = sendMessage(channelId, {
            content: ""
        }, undefined, {
            attachmentsToUpload: [upload]
        });
        if (result && typeof result.then === "function") {
            void result.catch(() => showError("Failed to send message."));
        }
    });
    upload.on("error", () => showError("Failed to upload GIF."));
    showUploading();
    upload.upload();
}
