/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { addHeaderBarButton, HeaderBarButton, removeHeaderBarButton } from "@api/HeaderBar";
import { TestcordRequestCoordinator } from "@api/index";
import { ModalCloseButton,ModalContent, ModalHeader, ModalRoot, openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { findStoreLazy } from "@webpack";
import { React, useEffect,useState } from "@webpack/common";
import { Forms } from "@webpack/common";

import { t } from "../autoTranslateNightcord";

const ChannelStore = findStoreLazy("ChannelStore");
const UserStore = findStoreLazy("UserStore");
const MessageStore = findStoreLazy("MessageStore");

function ExportIcon({ width = 20, height = 20 }: { width?: number; height?: number; }) {
    return (
        <svg aria-hidden="true" role="img" xmlns="http://www.w3.org/2000/svg" width={width} height={height} fill="none" viewBox="0 0 24 24">
            <path fill="currentColor" d="M13 16V5.41l3.3 3.3a1 1 0 1 0 1.4-1.42l-5-5a1 1 0 0 0-1.4 0l-5 5a1 1 0 0 0 1.4 1.42L11 5.4V16a1 1 0 1 0 2 0Z" />
            <path fill="currentColor" d="M4 15a1 1 0 0 1 1-1h2a1 1 0 1 0 0-2H5a3 3 0 0 0-3 3v4a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3v-4a3 3 0 0 0-3-3h-2a1 1 0 1 0 0 2h2a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4Z" />
        </svg>
    );
}

type ExportFormat = "txt" | "json" | "html" | "csv" | "md";

interface RichMessage {
    id: string;
    timestamp: string;
    editedAt?: string;
    authorId: string;
    authorName: string;
    authorAvatar: string | null;
    content: string;
    attachments: Array<{ url: string; filename: string; size: number; contentType: string; }>;
    embeds: Array<{ title?: string; description?: string; url?: string; image?: string; type: string; }>;
    stickers: Array<{ name: string; id: string; }>;
    reactions: Array<{ emoji: string; count: number; }>;
    referencedMessage?: { id: string; authorName: string; content: string; };
    pinned: boolean;
    type: number;
    components: any[];
    deleted?: boolean;
}

function getToken(): string {
    try {
        const mod = (window as any).Vencord?.Webpack?.findByProps?.("getToken");
        return mod?.getToken?.() ?? "";
    } catch { return ""; }
}

async function getDeletedMessagesFromIDB(channelId: string): Promise<any[]> {
    try {
        const dbReq: IDBOpenDBRequest = indexedDB.open("MessageLoggerIDB", 1);
        const idb = await new Promise<IDBDatabase>((resolve, reject) => {
            dbReq.onsuccess = () => resolve(dbReq.result);
            dbReq.onerror = () => reject(dbReq.error);
            dbReq.onupgradeneeded = () => {
                dbReq.result.close();
                reject(new Error("DB not initialized"));
            };
        });

        const tx = idb.transaction("messages", "readonly");
        const store = tx.objectStore("messages");
        const index = store.index("by_channel_id");
        const req = index.getAll(channelId);

        const records: any[] = await new Promise((resolve, reject) => {
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });

        idb.close();
        return records.filter(r => r.status === "DELETED" || r.status === "GHOST_PINGED");
    } catch {
        return [];
    }
}

async function fetchAllMessages(channelId: string, token: string, onProgress: (n: number) => void): Promise<RichMessage[]> {
    const messageMap = new Map<string, RichMessage>();
    let beforeId: string | null = null;
    let count = 0;

    while (true) {
        const batch = await TestcordRequestCoordinator.request<unknown[]>({
            key: `discord:messages:${channelId}:before:${beforeId ?? ""}:limit:100`,
            ttlMs: 30_000,
            run: async () => {
                const url = `https://discord.com/api/v9/channels/${channelId}/messages?limit=100${beforeId ? `&before=${beforeId}` : ""}`;
                const res = await fetch(url, { headers: { Authorization: token } });
                if (!res.ok) return [];
                const body = await res.json() as unknown;
                return Array.isArray(body) ? body : [];
            },
            cacheable: Array.isArray,
        });
        if (!batch.length) break;

        for (const m of batch) {
            messageMap.set(m.id, {
                id: m.id,
                timestamp: m.timestamp,
                editedAt: m.edited_timestamp ?? undefined,
                authorId: m.author.id,
                authorName: m.author.global_name ?? m.author.username,
                authorAvatar: m.author.avatar ?? null,
                content: m.content ?? "",
                attachments: (m.attachments ?? []).map((a: any) => ({
                    url: a.url, filename: a.filename, size: a.size,
                    contentType: a.content_type ?? "application/octet-stream",
                })),
                embeds: (m.embeds ?? []).map((e: any) => ({
                    title: e.title, description: e.description, url: e.url,
                    image: e.image?.url ?? e.thumbnail?.url, type: e.type ?? "rich",
                })),
                stickers: (m.sticker_items ?? []).map((s: any) => ({ name: s.name, id: s.id })),
                reactions: (m.reactions ?? []).map((r: any) => ({ emoji: r.emoji.name ?? r.emoji.id, count: r.count })),
                referencedMessage: m.referenced_message ? {
                    id: m.referenced_message.id,
                    authorName: m.referenced_message.author?.username ?? "Unknown",
                    content: m.referenced_message.content?.slice(0, 100) ?? "",
                } : undefined,
                pinned: m.pinned ?? false,
                type: m.type ?? 0,
                components: m.components ?? [],
                deleted: false
            });
        }

        count += batch.length;
        onProgress(count);
        if (batch.length < 100) break;
        beforeId = batch[batch.length - 1].id;
        await new Promise(r => setTimeout(r, 250));
    }

    // Source 1: MessageStore cache (basic MessageLogger — in-memory only)
    try {
        const cached = MessageStore.getMessages?.(channelId);
        if (cached) {
            const raw = Array.isArray(cached) ? cached : (cached._array ?? (typeof cached.toArray === "function" ? cached.toArray() : Object.values(cached)));
            for (const m of raw) {
                if (m && (m.deleted || m.state === "DELETED" || m.mlDeleted)) {
                    messageMap.set(m.id, {
                        id: m.id,
                        timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : (m.timestamp || new Date().toISOString()),
                        editedAt: m.editedTimestamp instanceof Date ? m.editedTimestamp.toISOString() : (m.editedTimestamp || m.edited_timestamp),
                        authorId: m.author?.id,
                        authorName: m.author?.globalName ?? m.author?.username ?? "Unknown",
                        authorAvatar: m.author?.avatar ?? null,
                        content: m.content ?? "",
                        attachments: (m.attachments ?? []).map((a: any) => ({
                            url: a.url, filename: a.filename, size: a.size,
                            contentType: a.content_type ?? "application/octet-stream",
                        })),
                        embeds: (m.embeds ?? []).map((e: any) => ({
                            title: e.title, description: e.description, url: e.url,
                            image: e.image?.url ?? e.thumbnail?.url, type: e.type ?? "rich",
                        })),
                        stickers: (m.sticker_items ?? m.stickers ?? []).map((s: any) => ({ name: s.name, id: s.id })),
                        reactions: (m.reactions ?? []).map((r: any) => ({ emoji: r.emoji?.name ?? r.emoji?.id, count: r.count })),
                        referencedMessage: m.messageReference ? {
                            id: m.messageReference.message_id || m.messageReference.id || "0",
                            authorName: "Unknown",
                            content: ""
                        } : undefined,
                        pinned: m.pinned ?? false,
                        type: m.type ?? 0,
                        components: m.components ?? [],
                        deleted: true
                    });
                }
            }
        }
    } catch (e) {
        console.error("[ExportDM] Error fetching cached messages:", e);
    }

    // Source 2: MessageLoggerEnhanced IndexedDB (persistent — works without being in the conversation)
    try {
        const idbRecords = await getDeletedMessagesFromIDB(channelId);
        for (const record of idbRecords) {
            const m = record.message;
            if (!m || messageMap.has(record.message_id)) continue;

            messageMap.set(record.message_id, {
                id: record.message_id,
                timestamp: m.timestamp ?? new Date().toISOString(),
                editedAt: m.edited_timestamp ?? undefined,
                authorId: m.author?.id ?? "0",
                authorName: m.author?.global_name ?? m.author?.globalName ?? m.author?.username ?? "Unknown",
                authorAvatar: m.author?.avatar ?? null,
                content: m.content ?? "",
                attachments: (m.attachments ?? []).map((a: any) => ({
                    url: a.url ?? a.oldUrl ?? "", filename: a.filename ?? "file", size: a.size ?? 0,
                    contentType: a.content_type ?? "application/octet-stream",
                })),
                embeds: (m.embeds ?? []).map((e: any) => ({
                    title: e.title, description: e.description, url: e.url,
                    image: e.image?.url ?? e.thumbnail?.url, type: e.type ?? "rich",
                })),
                stickers: (m.sticker_items ?? m.stickerItems ?? []).map((s: any) => ({ name: s.name, id: s.id })),
                reactions: (m.reactions ?? []).map((r: any) => ({ emoji: r.emoji?.name ?? r.emoji?.id, count: r.count })),
                referencedMessage: m.referenced_message ? {
                    id: m.referenced_message.id ?? m.referenced_message.message_id ?? "0",
                    authorName: m.referenced_message.author?.username ?? "Unknown",
                    content: (m.referenced_message.content ?? "").slice(0, 100),
                } : undefined,
                pinned: m.pinned ?? false,
                type: m.type ?? 0,
                components: m.components ?? [],
                deleted: true
            });
        }
    } catch (e) {
        console.error("[ExportDM] Error fetching deleted messages from IDB:", e);
    }

    return Array.from(messageMap.values()).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

function getMediaType(url: string, ct: string): "image" | "video" | "audio" | "file" {
    if (ct.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|avif|svg)(\?|$)/i.test(url)) return "image";
    if (ct.startsWith("video/") || /\.(mp4|webm|mov|avi|mkv)(\?|$)/i.test(url)) return "video";
    if (ct.startsWith("audio/") || /\.(mp3|ogg|wav|flac|m4a)(\?|$)/i.test(url)) return "audio";
    return "file";
}

function formatSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function buildTxt(messages: RichMessage[], channelName: string): string {
    const lines = [`=== ${t("Export DMs")} — ${channelName} ===`, `${t("Exported on")} ${new Date().toLocaleString()}`, `${t("Total:")} ${messages.length} ${t("messages")}`, ""];
    for (const m of messages) {
        const d = new Date(m.timestamp).toLocaleString();
        if (m.referencedMessage) lines.push(`  > [${m.referencedMessage.authorName}]: ${m.referencedMessage.content}`);
        lines.push(`[${d}]${m.editedAt ? ` ${t("(edited)")}` : ""} ${m.authorName}: ${m.content}`);
        for (const a of m.attachments) lines.push(`  [${getMediaType(a.url, a.contentType).toUpperCase()}] ${a.filename} (${formatSize(a.size)}) — ${a.url}`);
        for (const e of m.embeds) { if (e.url) lines.push(`  [LIEN] ${e.title ?? "Embed"}: ${e.url}`); }
        for (const s of m.stickers) lines.push(`  [STICKER] ${s.name}`);
        if (m.reactions.length) lines.push(`  ${m.reactions.map(r => `${r.emoji} x${r.count}`).join(" ")}`);
    }
    return lines.join("\n");
}

function buildJson(messages: RichMessage[], channelName: string): string {
    return JSON.stringify({ channel: channelName, exported: new Date().toISOString(), count: messages.length, messages }, null, 2);
}

function buildCsv(messages: RichMessage[]): string {
    const esc = (s: string) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const rows = [["ID", "Timestamp", "EditedAt", "AuthorID", "AuthorName", "Content", "Attachments", "Embeds", "Stickers", "Reactions", "ReplyTo", "Pinned"]];
    for (const m of messages) {
        rows.push([m.id, m.timestamp, m.editedAt ?? "", m.authorId, m.authorName, m.content,
        m.attachments.map(a => a.url).join("|"), m.embeds.map(e => e.url ?? e.title ?? "").join("|"),
        m.stickers.map(s => s.name).join("|"), m.reactions.map(r => `${r.emoji}:${r.count}`).join("|"),
        m.referencedMessage?.id ?? "", m.pinned ? "yes" : "no"]);
    }
    return rows.map(r => r.map(esc).join(",")).join("\n");
}

function buildMd(messages: RichMessage[], channelName: string): string {
    const lines = [`# ${t("Export DMs")} — ${channelName}`, `> ${t("Exported on")} ${new Date().toLocaleString()} · **${messages.length} ${t("messages")}**`, ""];
    for (const m of messages) {
        const d = new Date(m.timestamp).toLocaleString();
        if (m.referencedMessage) lines.push(`> **${m.referencedMessage.authorName}**: ${m.referencedMessage.content}`);
        lines.push(`**${m.authorName}** — *${d}*${m.editedAt ? ` ${t("(edited)")}` : ""}${m.pinned ? ` ${t("[pinned]")}` : ""}`);
        if (m.content) lines.push(m.content);
        for (const a of m.attachments) lines.push(`[${a.filename}](${a.url}) *(${formatSize(a.size)})*`);
        for (const e of m.embeds) { if (e.url) lines.push(`[${e.title ?? "Lien"}](${e.url})`); }
        for (const s of m.stickers) lines.push(`*Sticker: ${s.name}*`);
        if (m.reactions.length) lines.push(m.reactions.map(r => `${r.emoji} \`${r.count}\``).join(" "));
        lines.push("");
    }
    return lines.join("\n");
}

function buildHtml(messages: RichMessage[], channelName: string): string {
    const rows = messages.map(m => {
        const d = new Date(m.timestamp).toLocaleString();
        const edited = m.editedAt ? `<span class="edited">${t("(edited)")}</span>` : "";
        const pinned = m.pinned ? `<span class="pin">${t("[pinned]")}</span>` : "";
        const avatarUrl = m.authorAvatar
            ? `https://cdn.discordapp.com/avatars/${m.authorId}/${m.authorAvatar}.webp?size=32`
            : `https://cdn.discordapp.com/embed/avatars/${Math.abs(parseInt(m.authorId.slice(-4), 16)) % 5}.png`;
        const replyHtml = m.referencedMessage
            ? `<div class="reply"><b>${m.referencedMessage.authorName}</b>: ${m.referencedMessage.content.replace(/</g, "&lt;")}</div>`
            : "";
        const mediaHtml = m.attachments.map(a => {
            const t_type = getMediaType(a.url, a.contentType);
            if (t_type === "image") return `<div class="media"><img src="${a.url}" alt="${a.filename}" loading="lazy"><div class="media-name">${a.filename} (${formatSize(a.size)})</div></div>`;
            if (t_type === "video") return `<div class="media"><video src="${a.url}" controls preload="none"></video><div class="media-name">${a.filename}</div></div>`;
            if (t_type === "audio") return `<div class="media"><audio src="${a.url}" controls></audio><div class="media-name">${a.filename}</div></div>`;
            return `<div class="attachment"><a href="${a.url}" target="_blank">${a.filename}</a> <span class="size">${formatSize(a.size)}</span></div>`;
        }).join("");
        const embedHtml = m.embeds.map(e => {
            let html = "<div class=\"embed\">";
            if (e.title) html += `<div class="embed-title">${e.title.replace(/</g, "&lt;")}</div>`;
            if (e.description) html += `<div class="embed-desc">${e.description.slice(0, 300).replace(/</g, "&lt;")}</div>`;
            if (e.image) html += `<img src="${e.image}" class="embed-img" loading="lazy">`;
            if (e.url) html += `<a href="${e.url}" target="_blank" class="embed-url">${e.url}</a>`;
            return html + "</div>";
        }).join("");
        const stickerHtml = m.stickers.map(s => `<span class="sticker">${s.name}</span>`).join("");
        const reactHtml = m.reactions.length
            ? `<div class="reactions">${m.reactions.map(r => `<span class="reaction">${r.emoji} ${r.count}</span>`).join("")}</div>` : "";
        const content = m.content ? `<div class="content">${m.content.replace(/</g, "&lt;").replace(/\n/g, "<br>")}</div>` : "";
        const msgClass = m.deleted ? "msg deleted" : "msg";
        return `<div class="${msgClass}">${replyHtml}<div class="msg-header"><img src="${avatarUrl}" class="avatar"><span class="author">${m.authorName}</span><span class="ts">${d}</span>${edited}${pinned}</div>${content}${mediaHtml}${embedHtml}${stickerHtml}${reactHtml}</div>`;
    }).join("");

    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${t("Export DMs")} — ${channelName}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{background:#1e1f22;color:#dbdee1;font-ffriendly:system-ui,sans-serif;padding:20px;max-width:900px;margin:0 auto}h1{color:#5865f2;margin-bottom:4px}.meta{color:#949ba4;font-size:13px;margin-bottom:24px}.msg.deleted{background-color:rgba(240,71,71,0.1);border-left:2px solid #f04747}.msg{padding:10px 12px;border-radius:4px;margin-bottom:2px}.msg:hover{background:rgba(255,255,255,0.04)}.msg-header{display:flex;align-items:center;gap:8px;margin-bottom:4px}.avatar{width:32px;height:32px;border-radius:50%}.author{font-weight:700;color:#f2f3f5;font-size:14px}.ts{font-size:11px;color:#949ba4;margin-left:4px}.edited,.pin{font-size:10px;color:#949ba4;margin-left:4px}.reply{font-size:12px;color:#949ba4;padding:4px 8px;border-left:3px solid #4f545c;margin-bottom:6px;background:rgba(255,255,255,0.03)}.content{font-size:14px;line-height:1.5;color:#dbdee1;white-space:pre-wrap;word-break:break-word;margin-bottom:4px}.media{margin:6px 0}.media img,.media video{max-width:400px;max-height:300px;border-radius:8px;display:block}.media-name{font-size:11px;color:#949ba4;margin-top:2px}.attachment{padding:6px 10px;background:rgba(0,0,0,0.2);border-radius:4px;margin:4px 0;display:inline-block}.attachment a{color:#00aff4;text-decoration:none}.embed{border-left:4px solid #5865f2;background:rgba(255,255,255,0.04);border-radius:0 4px 4px 0;padding:8px 12px;margin:6px 0}.embed-title{font-weight:700;color:#00aff4;margin-bottom:4px}.embed-desc{font-size:13px;color:#dbdee1}.embed-img{max-width:300px;border-radius:4px;margin-top:6px}.embed-url{font-size:12px;color:#00aff4;display:block;margin-top:4px;text-decoration:none}.sticker{font-size:12px;color:#b5bac1;background:rgba(255,255,255,0.06);border-radius:4px;padding:2px 6px;margin:2px}.reactions{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}.reaction{background:rgba(255,255,255,0.08);border-radius:8px;padding:2px 8px;font-size:12px}audio{width:300px;margin-top:4px}</style>
</head><body><h1>${channelName}</h1><p class="meta">${t("Exported on")} ${new Date().toLocaleString()} · ${messages.length} ${t("messages")}</p>${rows}</body></html>`;
}

function downloadFile(content: string, filename: string, mime: string) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
}

// ── SVG icon for search ───────────────────────────────────────────────
function SearchIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.5, flexShrink: 0 }}>
            <path d="M21.71 20.29l-5.01-5.01A7.94 7.94 0 0 0 18 10a8 8 0 1 0-8 8 7.94 7.94 0 0 0 5.28-1.3l5.01 5.01a1 1 0 0 0 1.42-1.42ZM4 10a6 6 0 1 1 6 6 6 6 0 0 1-6-6Z" />
        </svg>
    );
}

// ── Modal ─────────────────────────────────────────────────────────────────
function ExportDMModal({ rootProps }: { rootProps: any; }) {
    const [channels, setChannels] = useState<any[]>([]);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [format, setFormat] = useState<ExportFormat>("html");
    const [status, setStatus] = useState<"idle" | "fetching" | "done" | "error">("idle");
    const [progress, setProgress] = useState("");
    const [includeMedia, setIncludeMedia] = useState(true);
    const [includeEmbeds, setIncludeEmbeds] = useState(true);
    const [includeReactions, setIncludeReactions] = useState(true);
    const [search, setSearch] = useState("");

    useEffect(() => {
        try {
            const raw = ChannelStore.getSortedPrivateChannels?.() ?? {};
            const list = (Array.isArray(raw) ? raw : Object.values(raw))
                .filter((c: any) => c.type === 1 || c.type === 3)
                .map((c: any) => {
                    let name = c.name ?? "";
                    let avatar: string | null = null;
                    let userId: string | undefined;
                    if (!name && c.type === 1 && c.recipients?.length) {
                        const user = UserStore.getUser?.(c.recipients[0]);
                        name = user?.globalName ?? user?.username ?? c.recipients[0];
                        avatar = user?.avatar ?? null;
                        userId = c.recipients[0];
                    }
                    return { id: c.id, type: c.type, name, icon: c.icon ?? null, recipientId: userId, avatar };
                });
            setChannels(list);
        } catch (e) { console.error("[ExportDM]", e); }
    }, []);

    async function doExport() {
        if (selected.size === 0) return;
        const token = getToken();
        if (!token) { setStatus("error"); setProgress(t("Token not found")); return; }

        setStatus("fetching");
        const selectedChannels = channels.filter(c => selected.has(c.id));

        for (let i = 0; i < selectedChannels.length; i++) {
            const ch = selectedChannels[i];
            const channelPrefix = `[${i + 1}/${selected.size}] ${ch.name}: `;

            let msgs = await fetchAllMessages(ch.id, token, n => setProgress(`${channelPrefix}${t("Fetching:")} ${n} ${t("messages")}...`));
            if (!includeMedia) msgs = msgs.map(m => ({ ...m, attachments: [] }));
            if (!includeEmbeds) msgs = msgs.map(m => ({ ...m, embeds: [] }));
            if (!includeReactions) msgs = msgs.map(m => ({ ...m, reactions: [] }));

            setProgress(`${channelPrefix}${msgs.length} ${t("messages")} — ${t("generating file...")}`);
            const safeName = ch.name.replace(/[^a-z0-9_-]/gi, "_").slice(0, 40) || "DM";
            const date = new Date().toISOString().slice(0, 10);

            let content: string; let ext: string; let mime: string;
            switch (format) {
                case "json": content = buildJson(msgs, ch.name); ext = "json"; mime = "application/json"; break;
                case "csv": content = buildCsv(msgs); ext = "csv"; mime = "text/csv"; break;
                case "md": content = buildMd(msgs, ch.name); ext = "md"; mime = "text/markdown"; break;
                case "txt": content = buildTxt(msgs, ch.name); ext = "txt"; mime = "text/plain"; break;
                default: content = buildHtml(msgs, ch.name); ext = "html"; mime = "text/html"; break;
            }

            downloadFile(content, `DM_${safeName}_${date}.${ext}`, mime);
        }

        setStatus("done");
        setProgress(`${selected.size} ${t("conversations exported")}`);
    }

    const toggleSelected = (id: string) => {
        const next = new Set(selected);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelected(next);
    };

    const FORMATS: Array<{ key: ExportFormat; label: string; desc: string; }> = [
        { key: "html", label: t("HTML"), desc: t("Web page with images/videos") },
        { key: "txt", label: t("TXT"), desc: t("Plain text") },
        { key: "md", label: t("MD"), desc: t("Markdown") },
        { key: "json", label: t("JSON"), desc: t("Full structured") },
        { key: "csv", label: t("CSV"), desc: t("Spreadsheet") },
    ];

    function getChAvatar(c: any) {
        if (c.type === 1 && c.recipientId && c.avatar)
            return `https://cdn.discordapp.com/avatars/${c.recipientId}/${c.avatar}.webp?size=32`;
        return null;
    }

    // Filter the list based on search
    const filtered = search.trim()
        ? channels.filter(c => c.name.toLowerCase().includes(search.toLowerCase()))
        : channels;

    return (
        <ModalRoot {...rootProps} size="medium">
            <ModalHeader separator={false}>
                <Forms.FormTitle tag="h4" style={{ margin: 0, display: "flex", alignItems: "center", gap: 8, color: "#fff" }}>
                    <ExportIcon width={16} height={16} /> {t("Export DMs")}
                </Forms.FormTitle>
                <ModalCloseButton onClick={rootProps.onClose} />
            </ModalHeader>
            <ModalContent className="edm-content">

                {/* Search bar */}
                <div className="edm-search-bar">
                    <SearchIcon />
                    <input
                        className="edm-search-input"
                        type="text"
                        placeholder={t("Search for a friend or a DM...")}
                        value={search}
                        onChange={e => setSearch(e.currentTarget.value)}
                        autoFocus
                    />
                    {search && (
                        <button className="edm-search-clear" onClick={() => setSearch("")}>✕</button>
                    )}
                </div>

                {/* Conversation list */}
                <Forms.FormTitle tag="h5" className="edm-label">{t("CHOOSE A CONVERSATION")}</Forms.FormTitle>
                <div className="edm-channel-list">
                    {filtered.length === 0 && (
                        <div className="edm-empty">
                            {search ? `${t("No results for")} "${search}"` : t("No DMs found")}
                        </div>
                    )}
                    {filtered.map(c => {
                        const av = getChAvatar(c);
                        const isSel = selected.has(c.id);
                        return (
                            <div key={c.id}
                                className={`edm-channel-row ${isSel ? "edm-channel-row--selected" : ""}`}
                                onClick={() => toggleSelected(c.id)}>
                                {av
                                    ? <img src={av} className="edm-avatar" alt="" />
                                    : <div className="edm-avatar-placeholder">{c.type === 3 ? "G" : (c.name?.[0] ?? "?")}</div>
                                }
                                <span className="edm-channel-name">{c.name || `DM ${c.id.slice(-4)}`}</span>
                                {isSel && <span className="edm-check">✓</span>}
                            </div>
                        );
                    })}
                </div>

                {/* Options — without Google emojis, with text labels */}
                <div className="edm-options-row">
                    <label className="edm-option">
                        <input type="checkbox" checked={includeMedia} onChange={e => setIncludeMedia(e.target.checked)} />
                        <span>{t("Images / Videos / Audio")}</span>
                    </label>
                    <label className="edm-option">
                        <input type="checkbox" checked={includeEmbeds} onChange={e => setIncludeEmbeds(e.target.checked)} />
                        <span>{t("Links / Embeds")}</span>
                    </label>
                    <label className="edm-option">
                        <input type="checkbox" checked={includeReactions} onChange={e => setIncludeReactions(e.target.checked)} />
                        <span>{t("Reactions")}</span>
                    </label>
                </div>

                {/* Format */}
                <Forms.FormTitle tag="h5" className="edm-label">{t("EXPORT FORMAT")}</Forms.FormTitle>
                <div className="edm-format-row">
                    {FORMATS.map(f => (
                        <button key={f.key}
                            className={`edm-format-btn ${format === f.key ? "edm-format-btn--active" : ""}`}
                            onClick={() => setFormat(f.key)}
                            title={f.desc}>
                            <span className="edm-fmt-key">{f.label}</span>
                            <span className="edm-fmt-desc">{f.desc}</span>
                        </button>
                    ))}
                </div>

                {status !== "idle" && (
                    <div className={`edm-status edm-status--${status}`}>{progress}</div>
                )}

                <button className="edm-export-btn"
                    onClick={doExport}
                    disabled={selected.size === 0 || status === "fetching"}>
                    {status === "fetching" ? t("Exporting...") : t("Export")}
                </button>
            </ModalContent>
        </ModalRoot>
    );
}

function ExportButton() {
    return (
        <HeaderBarButton
            icon={ExportIcon}
            tooltip={t("Export DMs")}
            onClick={() => openModal(props => <ExportDMModal rootProps={props} />)}
        />
    );
}

export default definePlugin({
    name: "ExportDM",
    description: "Exports your DMs with messages, images, videos, audio, links, embeds, stickers, reactions in TXT/JSON/CSV/MD/HTML.",
    tags: ["Media", "Utility", "Nightcord"],
    authors: [{ name: "Nightcord", id: 0n }],
    dependencies: ["HeaderBarAPI"],

    start() { addHeaderBarButton("nightcord-export-dm", () => <ExportButton />, 4); },
    stop() { removeHeaderBarButton("nightcord-export-dm"); },
});
