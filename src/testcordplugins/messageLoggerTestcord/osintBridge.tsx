/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ModalContent, ModalHeader, ModalRoot, ModalSize, openModal } from "@utils/modal";
import { ChannelStore, GuildStore } from "@webpack/common";

import { analyzeMessages, MessageData, ResultSection } from "../TestcordOSINT/algorithms";
import { getAllLogs, getDatabase } from "./db";
import { LogRecord, LogStatus } from "./types";

export function logRecordToMessageData(record: LogRecord): MessageData {
    const { message } = record;
    const channel = ChannelStore.getChannel(message.channel_id);
    const guildId = message.guild_id ?? message.guildId ?? channel?.guild_id;

    return {
        id: message.id,
        content: message.content ?? "",
        timestamp: String(message.timestamp),
        author: {
            id: String(message.author.id ?? "unknown"),
            username: String(message.author.username ?? "Unknown User"),
            globalName: message.author.global_name ?? message.author.globalName,
            discriminator: (message.author as any).discriminator,
            avatar: (message.author as any).avatar,
            banner: (message.author as any).banner,
            accentColor: (message.author as any).accentColor,
            publicFlags: (message.author as any).publicFlags,
            bot: (message.author as any).bot,
        },
        attachments: (message.attachments ?? []).map(att => ({
            filename: String(att.filename ?? "attachment"),
            url: String(att.url ?? ""),
            content_type: typeof att.content_type === "string" ? att.content_type : undefined,
            size: typeof att.size === "number" ? att.size : 0,
        })),
        embeds: message.embeds ?? [],
        reactions: undefined,
        stickerItems: undefined,
        message_reference: undefined,
        type: 0,
        flags: 0,
        tts: false,
        pinned: false,
        editedTimestamp: null,
        mentionsList: [],
        referencedAuthor: undefined,
        channelId: message.channel_id,
        channelName: channel?.name,
        guildId,
        guildName: guildId ? GuildStore.getGuild(guildId)?.name : undefined,
    };
}

export async function collectLoggedMessagesFor(userId: string, statuses?: LogStatus[]): Promise<MessageData[]> {
    await getDatabase();
    const records = await getAllLogs();
    return records
        .filter(record => record.message.author.id === userId)
        .filter(record => !statuses || statuses.includes(record.status))
        .map(logRecordToMessageData);
}

function OsintLogsResultModal({ modalProps, username, messages }: {
    modalProps: any;
    username: string;
    messages: MessageData[];
}) {
    const result = messages.length > 0 ? analyzeMessages(messages) : null;

    return (
        <ModalRoot {...modalProps} size={ModalSize.LARGE}>
            <ModalHeader>
                <span style={{ fontWeight: 600 }}>OSINT analysis of logged messages — {username}</span>
            </ModalHeader>
            <ModalContent>
                {!result && <p style={{ opacity: 0.7 }}>No logged messages found for this user.</p>}
                {result && (
                    <>
                        <div className="vc-osint-section" style={{ marginBottom: 12 }}>
                            <div className="vc-osint-section-title">Summary</div>
                            <div className="vc-osint-section-content">{result.summary}</div>
                        </div>
                        {result.sections.map((section: ResultSection, i: number) => (
                            <div key={i} className="vc-osint-section" style={{ marginBottom: 12 }}>
                                <div className="vc-osint-section-title">{section.title}</div>
                                <div className="vc-osint-section-content" style={{ whiteSpace: "pre-wrap" }}>{section.content}</div>
                            </div>
                        ))}
                    </>
                )}
                {messages.length > 0 && (
                    <p style={{ opacity: 0.5, fontSize: 12 }}>
                        Analyzed {messages.length} logged deleted/edited message{messages.length === 1 ? "" : "s"}.
                    </p>
                )}
            </ModalContent>
        </ModalRoot>
    );
}

export async function osintScanLoggedMessages(userId: string, statuses?: LogStatus[]) {
    await getDatabase();
    const messages = await collectLoggedMessagesFor(userId, statuses);
    const user = messages[0]?.author;
    const username = user ? `${user.globalName || user.username} (${user.username})` : userId;

    openModal(modalProps => (
        <OsintLogsResultModal modalProps={modalProps} username={username} messages={messages} />
    ));
}
