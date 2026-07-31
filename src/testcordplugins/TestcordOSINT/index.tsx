/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { ApplicationCommandInputType, findOption, sendBotMessage } from "@api/Commands";
import { HeaderBarButton } from "@api/HeaderBar";
import { DataStore } from "@api/index";
import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import { sleep } from "@utils/misc";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { Message } from "@vencord/discord-types";
import { Button, ChannelStore, Constants, GuildMemberStore, GuildStore, IconUtils, Menu, PermissionsBits, PermissionStore, Popout, React, RelationshipStore, RestAPI, SelectedChannelStore, TextInput, useCallback, useEffect, useMemo, useRef, UserStore, useState } from "@webpack/common";

import { callAI, CordCatResult, fetchCordCatData } from "./aiManager";
import { AlgorithmResult, analyzeMessages, MessageData } from "./algorithms";

const logger = new Logger("TestcordOSINT");

const DS_HISTORY_KEY = "testcord-osint-history";
const MAX_HISTORY = 5;

// ── Settings ──

const settings = definePluginSettings({
    useAI: {
        type: OptionType.BOOLEAN,
        description: "Use AI for analysis (requires API key)",
        default: false,
    },
    unlimitedMessages: {
        type: OptionType.BOOLEAN,
        description: "Fetch all messages (unlimited) with live-updating results",
        default: false,
    },
    scanMutualServers: {
        type: OptionType.BOOLEAN,
        description: "Scan messages across all mutual servers (slower but comprehensive)",
        default: false,
    },
    scanDMs: {
        type: OptionType.BOOLEAN,
        description: "Also scan DM conversations with the target user",
        default: false,
    },
    messageLimit: {
        type: OptionType.SLIDER,
        description: "Max messages per channel (ignored when unlimited is on)",
        markers: [25, 50, 100, 250, 500],
        default: 100,
        stickToMarkers: false,
    },
    aiProvider: {
        type: OptionType.SELECT,
        description: "AI provider for analysis",
        options: [
            { label: "Groq", value: "groq", default: true },
            { label: "OpenAI", value: "openai" },
            { label: "Anthropic", value: "anthropic" },
            { label: "Together AI", value: "together" },
            { label: "OpenRouter", value: "openrouter" },
            { label: "Localhost (Ollama/LM Studio)", value: "localhost" },
            { label: "Custom Endpoint", value: "custom" },
        ],
    },
    apiKey: {
        type: OptionType.STRING,
        description: "API key for the selected provider",
        default: "",
    },
    customApiUrl: {
        type: OptionType.STRING,
        description: "Custom API URL (for localhost/custom)",
        default: "http://localhost:11434",
    },
    customModel: {
        type: OptionType.STRING,
        description: "Custom model name (empty = provider default)",
        default: "",
    },
    use24hTime: {
        type: OptionType.BOOLEAN,
        description: "Use 24-hour time format in analysis results",
        default: false,
    },
});

// ── History types ──

interface HistoryEntry {
    userId: string;
    username: string;
    globalName?: string;
    avatar?: string;
    messageCount: number;
    scannedAt: number;
    algorithmResult?: AlgorithmResult;
    aiResult?: string;
    mode: string;
}

// ── History management ──

async function loadHistory(): Promise<HistoryEntry[]> {
    return (await DataStore.get(DS_HISTORY_KEY)) as HistoryEntry[] ?? [];
}

async function saveToHistory(entry: HistoryEntry): Promise<void> {
    const history = await loadHistory();
    history.unshift(entry);
    if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
    await DataStore.set(DS_HISTORY_KEY, history);
}

async function removeFromHistory(userId: string): Promise<void> {
    const history = await loadHistory();
    await DataStore.set(DS_HISTORY_KEY, history.filter(h => h.userId !== userId));
}

// ── Mutual guild helpers ──

interface MutualGuildInfo {
    id: string;
    name: string;
    iconUrl: string | null;
}

function getMutualGuildsForUser(userId: string): MutualGuildInfo[] {
    const guilds: MutualGuildInfo[] = [];
    const allGuilds = GuildStore.getGuilds();

    for (const guild of Object.values(allGuilds)) {
        if (!GuildMemberStore.isMember(guild.id, userId)) continue;

        const iconUrl = guild.icon
            ? IconUtils.getGuildIconURL({ id: guild.id, icon: guild.icon, size: 20 }) ?? null
            : null;

        guilds.push({ id: guild.id, name: guild.name, iconUrl });
    }

    return guilds;
}

function canAccessChannel(channelId: string): boolean {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return false;
    if (!channel.guild_id) return true;
    return PermissionStore.can(PermissionsBits.VIEW_CHANNEL, channel)
        && PermissionStore.can(PermissionsBits.READ_MESSAGE_HISTORY, channel);
}

function getDMChannelsWithUser(userId: string): string[] {
    const dmChannelIds: string[] = [];
    const privateChannels = ChannelStore.getMutablePrivateChannels();

    for (const [id, channel] of Object.entries(privateChannels)) {
        if (channel.type !== 1) continue;
        const { recipients } = (channel as any);
        if (Array.isArray(recipients) && recipients.includes(userId)) {
            dmChannelIds.push(id);
        }
    }

    return dmChannelIds;
}

// ── Fetch helpers ──

function toMessageData(msg: Message): MessageData {
    const raw = msg as any;
    return {
        id: msg.id,
        content: msg.content,
        timestamp: String(msg.timestamp),
        author: {
            id: msg.author.id,
            username: msg.author.username,
            globalName: (msg.author as any).globalName,
            discriminator: (msg.author as any).discriminator,
            avatar: msg.author.avatar,
            banner: (msg.author as any).banner,
            accentColor: (msg.author as any).accentColor,
            publicFlags: (msg.author as any).publicFlags,
            bot: msg.author.bot,
        },
        attachments: (msg.attachments ?? []).map(a => ({
            filename: a.filename,
            url: a.url,
            content_type: a.content_type,
            size: a.size,
            width: a.width,
            height: a.height,
        })),
        embeds: msg.embeds ?? [],
        reactions: msg.reactions,
        stickerItems: raw.stickerItems ?? raw.sticker_items,
        message_reference: raw.messageReference ?? raw.message_reference,
        type: msg.type,
        flags: msg.flags,
        tts: raw.tts,
        pinned: msg.pinned,
    } as MessageData;
}

interface FetchState {
    running: boolean;
    aborted: boolean;
    total: number;
}

async function searchMessages(
    userId: string,
    guildId: string | null,
    channelId: string,
    offset: number
): Promise<{ messages: Message[]; total: number; }> {
    const query: Record<string, any> = {
        author_id: userId,
        sort_by: "timestamp",
        sort_order: "desc",
        offset,
        limit: 25,
    };

    const channel = ChannelStore.getChannel(channelId);
    const channelBelongsToGuild = channel?.guild_id && channel.guild_id === guildId;

    if (channelBelongsToGuild) {
        query.channel_id = channelId;
    }

    const url = guildId
        ? Constants.Endpoints.SEARCH_GUILD(guildId)
        : `/channels/${channelId}/messages/search`;

    const res = await RestAPI.get({ url, query, retries: 2 });
    const body = res?.body as any;
    const flat: Message[] = (body?.messages ?? []).flat();
    return { messages: flat, total: body?.total_results ?? 0 };
}

async function buildAIPrompt(messages: MessageData[], algorithmResult: AlgorithmResult): Promise<string> {
    const user = messages[0]?.author;
    const username = user?.globalName || user?.username || "Unknown";
    const messageSummaries = messages.slice(0, 200).map(m => {
        const time = new Date(m.timestamp).toISOString();
        return `[${time}] ${m.content || "(no text)"}`;
    }).join("\n");
    const attachInfo = messages.flatMap(m =>
        m.attachments.map(a => `  - ${a.filename} (${a.content_type}, ${a.size} bytes)`)
    ).join("\n");

    return `You are an OSINT analyst. Analyze the following Discord user based on their message history and provide a comprehensive profile.

User: ${username} (ID: ${user?.id})
Messages analyzed: ${messages.length}

Algorithm Analysis Results:
${algorithmResult.sections.map(s => `${s.title}:\n${s.content}`).join("\n\n")}

Message Samples (first 200):
${messageSummaries}

Attachments:
${attachInfo || "None"}

Provide a detailed OSINT profile including:
1. **Personality Assessment**: Communication style, tone, emotional patterns
2. **Interests & Topics**: What they talk about most, hobbies, topics of expertise
3. **Activity Patterns**: When they're online, consistency, timezone estimate
4. **Social Behavior**: How they interact with others, community involvement
5. **Technical Profile**: Language skills, technical knowledge level, tools mentioned
6. **Notable Observations**: Any unique patterns, recurring themes, notable behavior
7. **Risk Indicators**: Any concerning patterns (if applicable)

Be thorough but factual. Base everything on the data provided.`;
}

// ── Results display component ──

function ResultSections({ algorithmResult, aiResult }: { algorithmResult: AlgorithmResult | null; aiResult: string; }) {
    return (
        <>
            {algorithmResult?.sections.map((section, i) => (
                <div key={i} className="vc-osint-section">
                    <div className="vc-osint-section-title">{section.title}</div>
                    <div className="vc-osint-section-content">{section.content}</div>
                </div>
            ))}
            {aiResult && (
                <div className="vc-osint-section">
                    <div className="vc-osint-section-title">AI Analysis</div>
                    <div className="vc-osint-section-content">{aiResult}</div>
                </div>
            )}
        </>
    );
}

// ── Links Modal ──

function LinksModal({ modalProps, messages }: { modalProps: any; messages: MessageData[]; }) {
    const urlRegex = /https?:\/\/[^\s<>"')\]]+/g;
    const links = new Map<string, { count: number; firstTimestamp: string; }>();

    for (const msg of messages) {
        const matches = msg.content.match(urlRegex);
        if (!matches) continue;
        for (const url of matches) {
            const cleaned = url.replace(/[.,;:!?)}\]]+$/, "");
            const existing = links.get(cleaned);
            if (existing) existing.count++;
            else links.set(cleaned, { count: 1, firstTimestamp: msg.timestamp });
        }
    }

    const sorted = [...links.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .map(([url, info]) => ({ url, ...info }));

    function copyAll() {
        navigator.clipboard.writeText(sorted.map(l => l.url).join("\n"));
    }

    return (
        <ModalRoot {...modalProps} size="large" className="vc-osint-root">
            <ModalHeader>
                <div className="vc-osint-header-left">
                    <div className="vc-osint-header-icon" style={{ background: "linear-gradient(135deg, #3ba55c, #5865f2)" }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z" /></svg>
                    </div>
                    <div>
                        <div className="vc-osint-header-title">Links Found</div>
                        <div className="vc-osint-header-subtitle">{sorted.length} unique URL{sorted.length !== 1 ? "s" : ""}</div>
                    </div>
                </div>
                <div className="vc-osint-header-right">
                    <Button size={Button.Sizes.SMALL} onClick={copyAll}>Copy All</Button>
                    <ModalCloseButton onClick={modalProps.onClose} />
                </div>
            </ModalHeader>
            <ModalContent>
                <div className="vc-osint-body">
                    {sorted.length === 0 && (
                        <div className="vc-osint-empty">
                            <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z" /></svg>
                            <p>No links found in messages</p>
                        </div>
                    )}
                    {sorted.map(({ url, count, firstTimestamp }) => (
                        <div key={url} className="vc-osint-link-entry">
                            <div className="vc-osint-link-url" title={url}>{url}</div>
                            <div className="vc-osint-link-meta">
                                <span>{count}x</span>
                                <span>{new Date(firstTimestamp).toLocaleDateString()}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </ModalContent>
        </ModalRoot>
    );
}

// ── Attachments Modal ──

function AttachmentsModal({ modalProps, messages }: { modalProps: any; messages: MessageData[]; }) {
    const attachments = messages.flatMap(m =>
        m.attachments.map(a => ({
            ...a,
            timestamp: m.timestamp,
            messageId: m.id,
        }))
    );

    const imageExts = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]);
    const videoExts = new Set(["mp4", "webm", "mov", "avi", "mkv"]);
    const audioExts = new Set(["mp3", "ogg", "wav", "flac", "aac"]);

    function getAttachmentType(a: { filename: string; content_type?: string; }) {
        const ext = a.filename.split(".").pop()?.toLowerCase() ?? "";
        if (a.content_type?.startsWith("image/") || imageExts.has(ext)) return "image";
        if (a.content_type?.startsWith("video/") || videoExts.has(ext)) return "video";
        if (a.content_type?.startsWith("audio/") || audioExts.has(ext)) return "audio";
        return "other";
    }

    function formatSize(bytes: number) {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    const images = attachments.filter(a => getAttachmentType(a) === "image");
    const videos = attachments.filter(a => getAttachmentType(a) === "video");
    const audio = attachments.filter(a => getAttachmentType(a) === "audio");
    const other = attachments.filter(a => getAttachmentType(a) === "other");

    function copyAllUrls() {
        navigator.clipboard.writeText(attachments.map(a => a.url).join("\n"));
    }

    return (
        <ModalRoot {...modalProps} size="large" className="vc-osint-root">
            <ModalHeader>
                <div className="vc-osint-header-left">
                    <div className="vc-osint-header-icon" style={{ background: "linear-gradient(135deg, #eb459e, #fee75c)" }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" /></svg>
                    </div>
                    <div>
                        <div className="vc-osint-header-title">Attachments</div>
                        <div className="vc-osint-header-subtitle">{attachments.length} file{attachments.length !== 1 ? "s" : ""}</div>
                    </div>
                </div>
                <div className="vc-osint-header-right">
                    <Button size={Button.Sizes.SMALL} onClick={copyAllUrls}>Copy URLs</Button>
                    <ModalCloseButton onClick={modalProps.onClose} />
                </div>
            </ModalHeader>
            <ModalContent>
                <div className="vc-osint-body">
                    {attachments.length === 0 && (
                        <div className="vc-osint-empty">
                            <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" /></svg>
                            <p>No attachments found</p>
                        </div>
                    )}

                    {images.length > 0 && (
                        <div className="vc-osint-section">
                            <div className="vc-osint-section-title">Images ({images.length})</div>
                            <div className="vc-osint-attachment-grid">
                                {images.map((a, i) => (
                                    <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" className="vc-osint-attachment-thumb">
                                        <img src={a.url} alt={a.filename} loading="lazy" />
                                        <div className="vc-osint-attachment-label">{a.filename}</div>
                                    </a>
                                ))}
                            </div>
                        </div>
                    )}

                    {videos.length > 0 && (
                        <div className="vc-osint-section">
                            <div className="vc-osint-section-title">Videos ({videos.length})</div>
                            {videos.map((a, i) => (
                                <div key={i} className="vc-osint-link-entry">
                                    <div className="vc-osint-link-url" title={a.filename}>{a.filename}</div>
                                    <div className="vc-osint-link-meta">
                                        <span>{formatSize(a.size)}</span>
                                        {a.width && a.height && <span>{a.width}x{a.height}</span>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {audio.length > 0 && (
                        <div className="vc-osint-section">
                            <div className="vc-osint-section-title">Audio ({audio.length})</div>
                            {audio.map((a, i) => (
                                <div key={i} className="vc-osint-link-entry">
                                    <div className="vc-osint-link-url" title={a.filename}>{a.filename}</div>
                                    <div className="vc-osint-link-meta"><span>{formatSize(a.size)}</span></div>
                                </div>
                            ))}
                        </div>
                    )}

                    {other.length > 0 && (
                        <div className="vc-osint-section">
                            <div className="vc-osint-section-title">Other Files ({other.length})</div>
                            {other.map((a, i) => (
                                <div key={i} className="vc-osint-link-entry">
                                    <div className="vc-osint-link-url" title={a.filename}>{a.filename}</div>
                                    <div className="vc-osint-link-meta"><span>{formatSize(a.size)}</span></div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </ModalContent>
        </ModalRoot>
    );
}

// ── Live Scan Panel ──

function OSINTScanPanel({ userId, channelId, modalProps }: { userId: string; channelId: string; modalProps: any; }) {
    const unlimited = settings.store.unlimitedMessages;
    const scanMutual = settings.store.scanMutualServers;
    const { scanDMs } = settings.store;
    const limit = settings.store.messageLimit;

    const [phase, setPhase] = useState<"fetching" | "analyzing" | "done" | "error">("fetching");
    const [progress, setProgress] = useState("Starting scan...");
    const [allMessages, setAllMessages] = useState<MessageData[]>([]);
    const [algorithmResult, setAlgorithmResult] = useState<AlgorithmResult | null>(null);
    const [aiResult, setAiResult] = useState<string>("");
    const [error, setError] = useState("");
    const [mutualGuilds, setMutualGuilds] = useState<MutualGuildInfo[]>([]);
    const [currentGuildName, setCurrentGuildName] = useState("");
    const [guildsScanned, setGuildsScanned] = useState(0);
    const [cordcatResult, setCordcatResult] = useState<CordCatResult | null>(null);
    const [cordcatLoading, setCordcatLoading] = useState(false);

    const fetchStateRef = useRef<FetchState>({ running: false, aborted: false, total: 0 } as FetchState);
    const messagesRef = useRef<MessageData[]>([]);
    const lastMessagesUpdateRef = useRef(0);

    const user = UserStore.getUser(userId);

    const runAnalysis = useCallback((msgs: MessageData[]) => {
        if (msgs.length === 0) return;
        setAlgorithmResult(analyzeMessages(msgs, settings.store.use24hTime));
    }, []);

    useEffect(() => {
        if (!userId) { setError("No user specified"); setPhase("error"); return; }
        if (!user) { setError("User not found"); setPhase("error"); return; }

        let cancelled = false;
        const state = fetchStateRef.current;
        state.running = true;
        state.aborted = false;
        state.total = 0;

        const acc: MessageData[] = [];
        messagesRef.current = acc;

        async function searchGuild(guildId: string | null, guildName: string, chanId?: string): Promise<void> {
            let offset = 0;
            while (state.running && !cancelled) {
                try {
                    const { messages, total } = await searchMessages(userId, guildId, chanId ?? channelId, offset);
                    if (cancelled || messages.length === 0) break;
                    acc.push(...messages.map(toMessageData));
                    state.total = acc.length;
                    const now = Date.now();
                    if (!unlimited || now - lastMessagesUpdateRef.current > 500) {
                        lastMessagesUpdateRef.current = now;
                        setAllMessages([...acc]);
                    }
                    offset += messages.length;
                    if (!unlimited && acc.length >= limit) break;
                    if (offset >= total) break;
                    await sleep(250);
                } catch (e: any) {
                    if (cancelled) break;
                    if (!unlimited) throw e;
                    await sleep(1000);
                }
            }
        }

        async function loop() {
            if (scanMutual) {
                const guilds = getMutualGuildsForUser(userId);
                setMutualGuilds(guilds);
                let scanned = 0;
                for (const guild of guilds) {
                    if (cancelled || !state.running) break;
                    if (!canAccessChannel(channelId) && guild.id !== ChannelStore.getChannel(channelId)?.guild_id) continue;
                    setCurrentGuildName(guild.name);
                    setProgress(`Searching ${guild.name}... (${scanned}/${guilds.length})`);
                    try {
                        await searchGuild(guild.id, guild.name);
                        scanned++;
                        setGuildsScanned(scanned);
                    } catch {}
                    if (acc.length > 0) runAnalysis([...acc]);
                }
                if (cancelled || !state.running) return;
            } else {
                const chan = ChannelStore.getChannel(channelId);
                const guildId = chan?.guild_id;
                if (!canAccessChannel(channelId)) { setError("No access to this channel"); setPhase("error"); return; }
                setCurrentGuildName(chan?.name || channelId);
                setProgress(unlimited ? "Searching current channel..." : `Searching ${chan?.name || "DM"}...`);
                await searchGuild(guildId ?? null, chan?.name || channelId, channelId);
            }

            if (scanDMs && !cancelled && state.running) {
                const dmChannels = getDMChannelsWithUser(userId);
                for (const dmId of dmChannels) {
                    if (cancelled || !state.running) break;
                    const dmChannel = ChannelStore.getChannel(dmId);
                    setCurrentGuildName(`DM: ${dmChannel?.name || dmId}`);
                    setProgress("Searching DMs...");
                    try {
                        await searchGuild(null, "DM", dmId);
                    } catch {}
                    if (acc.length > 0) runAnalysis([...acc]);
                }
            }

            if (!cancelled) {
                setAllMessages([...acc]);
                runAnalysis([...acc]);
                setPhase("analyzing");
                if (settings.store.useAI && acc.length > 0) {
                    try {
                        const prompt = await buildAIPrompt([...acc], analyzeMessages([...acc], settings.store.use24hTime));
                        const result = await callAI({
                            messages: [
                                { role: "system", content: "You are an expert OSINT analyst specializing in Discord user profiling. Be thorough, factual, and base all conclusions on the provided data." },
                                { role: "user", content: prompt },
                            ],
                            provider: settings.store.aiProvider,
                            model: settings.store.customModel || undefined,
                            customUrl: settings.store.customApiUrl,
                        });
                        setAiResult(result);
                    } catch (e: any) { setAiResult(`AI analysis failed: ${e.message}`); }
                }
                const finalResult = analyzeMessages([...acc], settings.store.use24hTime);
                saveToHistory({
                    userId,
                    username: user?.username ?? "",
                    globalName: (user as any)?.globalName,
                    avatar: user?.avatar,
                    messageCount: acc.length,
                    scannedAt: Date.now(),
                    algorithmResult: finalResult,
                    aiResult: aiResult || undefined,
                    mode: unlimited ? "unlimited" : `limited-${limit}`,
                });
                setPhase("done");
                state.running = false;

                setCordcatLoading(true);
                fetchCordCatData(userId).then(r => {
                    if (!cancelled && r) setCordcatResult(r);
                    setCordcatLoading(false);
                }).catch(() => setCordcatLoading(false));
            }
        }

        loop();
        return () => { cancelled = true; state.running = false; state.aborted = true; };
    }, [userId, channelId, unlimited, scanMutual, scanDMs, limit, runAnalysis]);

    function handleStop() {
        fetchStateRef.current.running = false;
        fetchStateRef.current.aborted = true;
        const msgs = messagesRef.current;
        if (msgs.length > 0) runAnalysis([...msgs]);
        setPhase("done");
    }

    function copyResults() {
        const text = [
            `OSINT Report: ${user?.globalName || user?.username} (${user?.username})`,
            `Scanned: ${new Date().toLocaleString()}`,
            `Messages: ${allMessages.length}`,
            `Mode: ${unlimited ? "Unlimited" : `Limited (${limit})`}${scanMutual ? " | Mutual servers" : ""}`,
            "",
            ...(algorithmResult?.sections ?? []).map(s => `[${s.title}]\n${s.content}`),
            "",
            ...(aiResult ? ["[AI Analysis]", aiResult] : []),
        ].filter(Boolean).join("\n\n");
        navigator.clipboard.writeText(text);
    }

    return (
        <ModalRoot {...modalProps} size="large" className="vc-osint-root">
            <ModalHeader>
                <div className="vc-osint-header-left">
                    <div className="vc-osint-header-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
                    </div>
                    <div>
                        <div className="vc-osint-header-title">Testcord OSINT</div>
                        <div className="vc-osint-header-subtitle">
                            {user ? `@${user.username}` : "Loading..."}
                            {scanMutual ? " | Mutual servers" : ""}
                            {unlimited ? " | Live" : ` | Limit: ${limit}`}
                        </div>
                    </div>
                </div>
                <div className="vc-osint-header-right">
                    <ModalCloseButton onClick={modalProps.onClose} />
                </div>
            </ModalHeader>
            <ModalContent>
                {phase === "error" && (
                    <div className="vc-osint-empty">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" /></svg>
                        <p>{error}</p>
                    </div>
                )}
                {(phase === "fetching" || phase === "analyzing") && allMessages.length === 0 && (
                    <div className="vc-osint-progress">
                        <div className="vc-osint-spinner" />
                        <div>{progress}</div>
                        {unlimited && <button className="vc-osint-stop-btn" onClick={handleStop}>Stop & Analyze</button>}
                    </div>
                )}
                {allMessages.length > 0 && (
                    <div className="vc-osint-body">
                        <div className="vc-osint-user-info">
                            <img className="vc-osint-user-avatar" src={user?.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.webp?size=48` : `https://cdn.discordapp.com/embed/avatars/${(BigInt(userId) >> 22n) % 6n}.png`} alt="" />
                            <div className="vc-osint-user-details">
                                <div className="vc-osint-user-name">{user?.globalName || user?.username || "Unknown"}</div>
                                <div className="vc-osint-user-id">@{user?.username} | ID: {userId}</div>
                                {scanMutual && mutualGuilds.length > 0 && (
                                    <div className="vc-osint-guild-list">
                                        {mutualGuilds.map(g => (
                                            <span key={g.id} className="vc-osint-guild-chip">
                                                {g.iconUrl && <img src={g.iconUrl} alt="" />}
                                                {g.name}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div className="vc-osint-user-badges">
                                <span className="vc-osint-tag">{settings.store.useAI ? "AI" : "Algorithm"}</span>
                                {unlimited && phase === "fetching" && <span className="vc-osint-tag vc-osint-tag--live"><span className="vc-osint-live-dot" />LIVE</span>}
                            </div>
                        </div>
                    {phase === "fetching" && (
                        <div className="vc-osint-live-bar">
                            <div className="vc-osint-live-bar-left">
                                <div className="vc-osint-spinner-small" />
                                <span>{allMessages.length} messages</span>
                                {scanMutual && <><span className="vc-osint-separator">|</span><span>{guildsScanned} guilds</span>{currentGuildName && <><span className="vc-osint-separator">|</span><span>{currentGuildName}</span></>}</>}
                                {!scanMutual && currentGuildName && <><span className="vc-osint-separator">|</span><span>{currentGuildName}</span></>}
                            </div>
                            <Button size={Button.Sizes.SMALL} color={Button.Colors.RED} onClick={handleStop}>Stop & Analyze</Button>
                        </div>
                    )}
                        <ResultSections algorithmResult={algorithmResult} aiResult={aiResult} />

                        {/* CordCat Section */}
                        {(cordcatLoading || cordcatResult) && (
                            <div className={`vc-osint-section ${cordcatLoading ? "vc-osint-section--analyzing" : ""}`}>
                                <div className="vc-osint-section-title">
                                    {cordcatLoading && <div className="vc-osint-spinner-small" />}
                                    CordCat Intelligence
                                </div>
                                {!cordcatLoading && cordcatResult && (
                                    <div className="vc-osint-section-content">
                                        {cordcatResult.actions.length === 0 && cordcatResult.breaches.length === 0 && (
                                            <div style={{ opacity: 0.6 }}>No DSA actions or breach records found.</div>
                                        )}

                                        {cordcatResult.actions.length > 0 && (
                                            <div style={{ marginBottom: 12 }}>
                                                <div style={{ fontWeight: 600, marginBottom: 6 }}>DSA Actions ({cordcatResult.actions.length})</div>
                                                {cordcatResult.actions.map((a, i) => (
                                                    <div key={i} className="vc-osint-cordcat-action">
                                                        <div className="vc-osint-cordcat-action-header">
                                                            <span className="vc-osint-tag">{a.category}</span>
                                                            {a.application_date && <span className="vc-osint-cordcat-date">{a.application_date}</span>}
                                                        </div>
                                                        {a.decision_account && <div>Account: {a.decision_account}</div>}
                                                        {a.decision_visibility && <div>Visibility: {Array.isArray(a.decision_visibility) ? a.decision_visibility.join(", ") : a.decision_visibility}</div>}
                                                        {a.decision_provision && <div>Provision: {a.decision_provision}</div>}
                                                        {a.decision_monetary && <div>Monetary: {a.decision_monetary}</div>}
                                                        {a.decision_ground && <div>Ground: {a.decision_ground}</div>}
                                                        {a.incompatible_content_ground && <div>Content Ground: {a.incompatible_content_ground}</div>}
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {cordcatResult.breaches.length > 0 && (
                                            <div>
                                                <div style={{ fontWeight: 600, marginBottom: 6 }}>Breach Records ({cordcatResult.breaches.length})</div>
                                                {cordcatResult.breaches.map((b, i) => (
                                                    <div key={i} className="vc-osint-cordcat-action">
                                                        <div className="vc-osint-cordcat-action-header">
                                                            <span className="vc-osint-tag">{b.source}</span>
                                                            {b.date && <span className="vc-osint-cordcat-date">{b.date}</span>}
                                                        </div>
                                                        {b.categories && b.categories.length > 0 && <div>Categories: {b.categories.join(", ")}</div>}
                                                        {b.ip && <div>IP: {b.ip}</div>}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                        {phase === "analyzing" && (
                            <div className="vc-osint-section vc-osint-section--analyzing">
                                <div className="vc-osint-section-title">
                                    <div className="vc-osint-spinner-small" />
                                    {settings.store.useAI ? "Running AI analysis..." : "Finalizing..."}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </ModalContent>
            {(phase === "done" || phase === "error") && (
                <ModalFooter>
                    {phase === "done" && (
                        <>
                            <Button size={Button.Sizes.SMALL} onClick={() => openModal(p => <LinksModal modalProps={p} messages={allMessages} />)}>
                                View Links
                            </Button>
                            <Button size={Button.Sizes.SMALL} onClick={() => openModal(p => <AttachmentsModal modalProps={p} messages={allMessages} />)}>
                                View Attachments
                            </Button>
                            <Button onClick={copyResults}>Copy Report</Button>
                        </>
                    )}
                    <Button onClick={modalProps.onClose} color={Button.Colors.PRIMARY}>Close</Button>
                </ModalFooter>
            )}
        </ModalRoot>
    );
}

// ── History Panel ──

function OSINTHistoryPanel({ modalProps, onSelect }: { modalProps: any; onSelect: (userId: string) => void; }) {
    const [history, setHistory] = useState<HistoryEntry[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => { loadHistory().then(h => { setHistory(h); setLoading(false); }); }, []);

    async function handleDelete(userId: string) {
        await removeFromHistory(userId);
        setHistory(prev => prev.filter(h => h.userId !== userId));
    }

    return (
        <ModalRoot {...modalProps} size="medium" className="vc-osint-root">
            <ModalHeader>
                <div className="vc-osint-header-left">
                    <div className="vc-osint-header-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z" /></svg>
                    </div>
                    <div>
                        <div className="vc-osint-header-title">Scan History</div>
                        <div className="vc-osint-header-subtitle">Last {MAX_HISTORY} scans</div>
                    </div>
                </div>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>
            <ModalContent>
                <div className="vc-osint-body">
                    {loading && <div className="vc-osint-progress"><div className="vc-osint-spinner" /></div>}
                    {!loading && history.length === 0 && (
                        <div className="vc-osint-empty">
                            <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor"><path d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z" /></svg>
                            <p>No scan history yet</p>
                        </div>
                    )}
                    {history.map(entry => (
                        <div key={entry.userId} className="vc-osint-history-entry" onClick={() => { modalProps.onClose(); onSelect(entry.userId); }}>
                            <img className="vc-osint-history-avatar" src={entry.avatar ? `https://cdn.discordapp.com/avatars/${entry.userId}/${entry.avatar}.webp?size=32` : `https://cdn.discordapp.com/embed/avatars/${(BigInt(entry.userId) >> 22n) % 6n}.png`} alt="" />
                            <div className="vc-osint-history-info">
                                <div className="vc-osint-history-name">{entry.globalName || entry.username}</div>
                                <div className="vc-osint-history-meta">@{entry.username} | {entry.messageCount} msgs | {new Date(entry.scannedAt).toLocaleDateString()}</div>
                            </div>
                            <span className="vc-osint-tag">{entry.mode === "unlimited" ? "Live" : "Limited"}</span>
                            <button className="vc-osint-history-delete" onClick={e => { e.stopPropagation(); handleDelete(entry.userId); }} title="Remove">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
                            </button>
                        </div>
                    ))}
                </div>
            </ModalContent>
        </ModalRoot>
    );
}

// ── Multi-target scan panel ──

function OSINTMultiScan({ modalProps }: { modalProps: any; }) {
    const [userInput, setUserInput] = useState("");
    const [targets, setTargets] = useState<Array<{ userId: string; username: string; status: "pending" | "scanning" | "done" | "error"; result?: AlgorithmResult; aiResult?: string; msgCount: number; }>>([]);
    const [scanning, setScanning] = useState(false);
    const [currentIdx, setCurrentIdx] = useState(-1);
    const abortRef = useRef(false);

    function addTarget() {
        const input = userInput.trim();
        if (!input) return;
        // Try to resolve as mention or ID
        const idMatch = input.match(/^<?@?!?(\d{17,20})>?$/);
        const userId = idMatch ? idMatch[1] : input;
        const user = UserStore.getUser(userId);
        if (!user) return;
        if (targets.some(t => t.userId === userId)) return;
        setTargets(prev => [...prev, { userId, username: user.username, status: "pending", msgCount: 0 }]);
        setUserInput("");
    }

    function removeTarget(userId: string) {
        setTargets(prev => prev.filter(t => t.userId !== userId));
    }

    async function startBatchScan() {
        if (targets.length === 0 || scanning) return;
        setScanning(true);
        abortRef.current = false;
        const channelId = SelectedChannelStore.getChannelId();
        const chan = ChannelStore.getChannel(channelId);
        const guildId = chan?.guild_id;
        const unlimited = settings.store.unlimitedMessages;
        const limit = settings.store.messageLimit;
        const { scanDMs } = settings.store;

        for (let i = 0; i < targets.length; i++) {
            if (abortRef.current) break;
            setCurrentIdx(i);
            setTargets(prev => prev.map((t, idx) => idx === i ? { ...t, status: "scanning" } : t));

            try {
                const acc: MessageData[] = [];
                let offset = 0;
                const running = true;

                if (guildId) {
                    while (running) {
                        const { messages, total } = await searchMessages(targets[i].userId, guildId, channelId, offset);
                        if (messages.length === 0) break;
                        acc.push(...messages.map(toMessageData));
                        offset += messages.length;
                        if (!unlimited && acc.length >= limit) break;
                        if (offset >= total) break;
                        await sleep(250);
                    }
                }

                if (scanDMs) {
                    const dmChannels = getDMChannelsWithUser(targets[i].userId);
                    for (const dmId of dmChannels) {
                        if (abortRef.current) break;
                        let dmOffset = 0;
                        while (running) {
                            const { messages, total } = await searchMessages(targets[i].userId, null, dmId, dmOffset);
                            if (messages.length === 0) break;
                            acc.push(...messages.map(toMessageData));
                            dmOffset += messages.length;
                            if (!unlimited && acc.length >= limit) break;
                            if (dmOffset >= total) break;
                            await sleep(250);
                        }
                    }
                }

                const result = analyzeMessages(acc, settings.store.use24hTime);
                let aiRes = "";
                if (settings.store.useAI && acc.length > 0) {
                    try {
                        const prompt = await buildAIPrompt(acc, result);
                        aiRes = await callAI({
                            messages: [
                                { role: "system", content: "You are an expert OSINT analyst. Be thorough and factual." },
                                { role: "user", content: prompt },
                            ],
                            provider: settings.store.aiProvider,
                            model: settings.store.customModel || undefined,
                            customUrl: settings.store.customApiUrl,
                        });
                    } catch { aiRes = "AI analysis failed"; }
                }

                setTargets(prev => prev.map((t, idx) => idx === i ? { ...t, status: "done", result, aiResult: aiRes, msgCount: acc.length } : t));

                await saveToHistory({
                    userId: targets[i].userId,
                    username: targets[i].username,
                    globalName: UserStore.getUser(targets[i].userId)?.globalName,
                    avatar: UserStore.getUser(targets[i].userId)?.avatar,
                    messageCount: acc.length,
                    scannedAt: Date.now(),
                    algorithmResult: result,
                    aiResult: aiRes || undefined,
                    mode: unlimited ? "unlimited" : `limited-${limit}`,
                });
            } catch {
                setTargets(prev => prev.map((t, idx) => idx === i ? { ...t, status: "error" } : t));
            }
        }

        setScanning(false);
        setCurrentIdx(-1);
    }

    return (
        <ModalRoot {...modalProps} size="large" className="vc-osint-root">
            <ModalHeader>
                <div className="vc-osint-header-left">
                    <div className="vc-osint-header-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" /></svg>
                    </div>
                    <div>
                        <div className="vc-osint-header-title">Multi-Target OSINT</div>
                        <div className="vc-osint-header-subtitle">{targets.length} target{targets.length !== 1 ? "s" : ""} queued</div>
                    </div>
                </div>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>
            <ModalContent>
                <div className="vc-osint-body">
                    {/* Input */}
                    <div className="vc-osint-multi-input">
                        <input
                            className="vc-osint-input"
                            value={userInput}
                            onChange={e => setUserInput(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") addTarget(); }}
                            placeholder="Enter user ID or @mention..."
                            disabled={scanning}
                        />
                        <Button size={Button.Sizes.SMALL} onClick={addTarget} disabled={scanning || !userInput.trim()}>Add</Button>
                    </div>

                    {/* Target list */}
                    {targets.map((t, i) => (
                        <div key={t.userId} className={`vc-osint-target ${t.status === "scanning" ? "vc-osint-target--active" : ""} ${t.status === "done" ? "vc-osint-target--done" : ""}`}>
                            <img className="vc-osint-target-avatar" src={UserStore.getUser(t.userId)?.avatar ? `https://cdn.discordapp.com/avatars/${t.userId}/${UserStore.getUser(t.userId)?.avatar}.webp?size=24` : `https://cdn.discordapp.com/embed/avatars/${(BigInt(t.userId) >> 22n) % 6n}.png`} alt="" />
                            <div className="vc-osint-target-info">
                                <span className="vc-osint-target-name">{t.username}</span>
                                <span className="vc-osint-target-status">
                                    {t.status === "pending" && "Queued"}
                                    {t.status === "scanning" && <><div className="vc-osint-spinner-small" /> Scanning...</>}
                                    {t.status === "done" && `${t.msgCount} msgs`}
                                    {t.status === "error" && "Failed"}
                                </span>
                            </div>
                            {!scanning && <button className="vc-osint-target-remove" onClick={() => removeTarget(t.userId)}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
                            </button>}
                        </div>
                    ))}

                    {/* Results */}
                    {targets.filter(t => t.status === "done").map(t => (
                        <div key={t.userId} className="vc-osint-section" style={{ marginTop: 16 }}>
                            <div className="vc-osint-section-title">@{t.username} — {t.msgCount} messages</div>
                            {t.result?.sections.slice(0, 3).map((s, i) => (
                                <div key={i} className="vc-osint-section-content" style={{ marginBottom: 8 }}>{s.title}: {s.content.split("\n")[0]}</div>
                            ))}
                            {t.aiResult && <div className="vc-osint-section-content" style={{ marginTop: 8 }}>{t.aiResult.slice(0, 300)}...</div>}
                        </div>
                    ))}
                </div>
            </ModalContent>
            <ModalFooter>
                <Button onClick={startBatchScan} disabled={scanning || targets.length === 0}>
                    {scanning ? "Scanning..." : `Scan ${targets.filter(t => t.status === "pending").length} Targets`}
                </Button>
                <Button onClick={modalProps.onClose} color={Button.Colors.PRIMARY}>Close</Button>
            </ModalFooter>
        </ModalRoot>
    );
}

// ── User Picker Modal ──

function UserPickerModal({ modalProps, onSelect }: { modalProps: any; onSelect: (userId: string) => void; }) {
    const [query, setQuery] = useState("");
    const [suggestions, setSuggestions] = useState<Array<{ id: string; username: string; globalName?: string; avatar?: string; }>>([]);

    useEffect(() => {
        const users: Array<{ id: string; username: string; globalName?: string; avatar?: string; }> = [];
        const seen = new Set<string>();
        const friendIds: string[] = RelationshipStore.getFriendIDs?.() ?? [];
        for (const id of friendIds.slice(0, 100)) {
            const user = UserStore.getUser(id);
            if (user && !seen.has(id)) { seen.add(id); users.push({ id, username: user.username, globalName: (user as any).globalName, avatar: user.avatar }); }
        }
        for (const guild of Object.values(GuildStore.getGuilds())) {
            for (const member of GuildMemberStore.getMembers(guild.id).slice(0, 50)) {
                if (seen.has(member.userId)) continue;
                const user = UserStore.getUser(member.userId);
                if (user) { seen.add(member.userId); users.push({ id: member.userId, username: user.username, globalName: (user as any).globalName, avatar: user.avatar }); }
            }
            if (users.length > 300) break;
        }
        setSuggestions(users);
    }, []);

    const filtered = useMemo(() => {
        if (!query.trim()) return suggestions.slice(0, 20);
        const q = query.toLowerCase();
        return suggestions.filter(u => u.username.toLowerCase().includes(q) || u.globalName?.toLowerCase().includes(q) || u.id === query.trim()).slice(0, 20);
    }, [query, suggestions]);

    function select(userId: string) { modalProps.onClose(); onSelect(userId); }

    return (
        <ModalRoot {...modalProps} size="small" className="vc-osint-root">
            <ModalHeader>
                <div className="vc-osint-header-left">
                    <div className="vc-osint-header-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
                    </div>
                    <div>
                        <div className="vc-osint-header-title">Select User</div>
                        <div className="vc-osint-header-subtitle">Search by name or paste a user ID</div>
                    </div>
                </div>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>
            <ModalContent>
                <div className="vc-osint-body">
                    <TextInput
                        autoFocus
                        placeholder="Username, display name, or user ID..."
                        value={query}
                        onChange={setQuery}
                        onKeyDown={(e: any) => {
                            if (e.key === "Enter") {
                                const m = query.trim().match(/^<?@?!?(\d{17,20})>?$/);
                                if (m) { select(m[1]); return; }
                                if (filtered.length > 0) select(filtered[0].id);
                            }
                        }}
                    />
                    <div className="vc-osint-picker-list">
                        {filtered.map(user => (
                            <div key={user.id} className="vc-osint-picker-item" onClick={() => select(user.id)}>
                                <img className="vc-osint-picker-avatar" src={user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.webp?size=32` : `https://cdn.discordapp.com/embed/avatars/${(BigInt(user.id) >> 22n) % 6n}.png`} alt="" />
                                <div className="vc-osint-picker-info">
                                    <span className="vc-osint-picker-name">{user.globalName || user.username}</span>
                                    <span className="vc-osint-picker-tag">@{user.username}</span>
                                </div>
                            </div>
                        ))}
                        {filtered.length === 0 && query.trim() && <div className="vc-osint-empty"><p>No users found. Paste a user ID and press Enter.</p></div>}
                    </div>
                </div>
            </ModalContent>
        </ModalRoot>
    );
}

// ── Open helpers ──

function openScan(userId: string, channelId: string) {
    openModal(props => <OSINTScanPanel userId={userId} channelId={channelId} modalProps={props} />);
}

function openUserPicker(channelId: string) {
    openModal(props => <UserPickerModal modalProps={props} onSelect={userId => openScan(userId, channelId)} />);
}

function openMultiScan() {
    openModal(props => <OSINTMultiScan modalProps={props} />);
}

function openHistory() {
    openModal(props => <OSINTHistoryPanel modalProps={props} onSelect={userId => {
        const channelId = SelectedChannelStore.getChannelId();
        openScan(userId, channelId);
    }} />);
}

// ── Header Bar Button ──

function OSINTButton() {
    const [show, setShow] = useState(false);
    const buttonRef = useRef<HTMLDivElement>(null);

    const SearchIcon = () => (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
    );

    function renderPopout(onClose: () => void) {
        return (
            <Menu.Menu navId="vc-osint-menu" onClose={onClose}>
                <Menu.MenuItem
                    id="vc-osint-scan-user"
                    label="Scan User"
                    action={() => { onClose(); openUserPicker(SelectedChannelStore.getChannelId()); }}
                />
                <Menu.MenuItem
                    id="vc-osint-multi"
                    label="Multi-Target Scan"
                    action={() => { onClose(); openMultiScan(); }}
                />
                <Menu.MenuItem
                    id="vc-osint-history"
                    label="Scan History"
                    action={() => { onClose(); openHistory(); }}
                />
                <Menu.MenuSeparator />
                <Menu.MenuItem
                    id="vc-osint-settings"
                    label="Settings"
                    action={() => { onClose(); }}
                />
            </Menu.Menu>
        );
    }

    return (
        <span ref={buttonRef} style={{ display: "inline-flex", alignItems: "center" }}>
            <Popout
                position="bottom"
                align="center"
                spacing={0}
                animation={Popout.Animation.NONE}
                shouldShow={show}
                onRequestClose={() => setShow(false)}
                targetElementRef={buttonRef}
                renderPopout={() => renderPopout(() => setShow(false))}
            >
                {(_, { isShown }) => (
                    <HeaderBarButton
                        icon={SearchIcon}
                        tooltip={isShown ? null : "OSINT Tools"}
                        selected={isShown}
                        onClick={() => setShow(v => !v)}
                    />
                )}
            </Popout>
        </span>
    );
}

// ── Plugin ──

export default definePlugin({
    name: "TestcordOSINT",
    description: "OSINT scanner for Discord users. Analyzes messages, attachments, and patterns with AI or algorithms. Supports mutual server scanning, multi-target scans, and search history.",
    tags: ["Chat", "Utility"],
    authors: [{ name: "TestcordDev", id: 0n }],
    settings,

    dependencies: ["HeaderBarAPI"],

    headerBarButton: {
        icon: () => (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
        ),
        render: OSINTButton,
        priority: 100,
    },

    commands: [
        {
            name: "osint",
            description: "Run an OSINT scan on a user (use limit:0 for unlimited)",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                { name: "user", description: "The user to scan", type: 6, required: true },
                { name: "limit", description: "Max messages per channel (0 = unlimited)", type: 4, required: false },
                { name: "mutual-servers", description: "Scan across all mutual servers", type: 5, required: false },
            ],
            execute: async (args, ctx) => {
                const userId = findOption(args, "user", "") as string;
                const limitOverride = findOption(args, "limit", 0) as number;
                const mutualOverride = findOption(args, "mutual-servers", false) as boolean;
                if (!userId) { sendBotMessage(ctx.channel.id, { content: "Please specify a user to scan." }); return; }
                if (limitOverride < 0) settings.store.unlimitedMessages = true;
                else if (limitOverride > 0) { settings.store.unlimitedMessages = false; settings.store.messageLimit = limitOverride; }
                if (mutualOverride) settings.store.scanMutualServers = true;
                openScan(userId, ctx.channel.id);
            },
        },
    ],

    contextMenus: {
        "user-context"(children, { id }: { id: string; }) {
            if (!id) return;

            const OSINTIcon = () => (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--interactive-normal)"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
            );

            children.push(
                <Menu.MenuSeparator />,
                <Menu.MenuItem
                    id="vc-osint-scan"
                    label="OSINT Scan"
                    icon={OSINTIcon}
                    action={() => openScan(id, SelectedChannelStore.getChannelId())}
                />
            );
        },
    },

    toolboxActions: {
        "OSINT Scan"() {
            openUserPicker(SelectedChannelStore.getChannelId());
        },
        "Multi-Target Scan"() { openMultiScan(); },
        "Scan History"() { openHistory(); },
    },
});
