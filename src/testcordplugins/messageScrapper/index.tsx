/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton } from "@api/ChatButtons";
import { addChannelToolbarButton, addHeaderBarButton, ChannelToolbarButton, HeaderBarButton, removeChannelToolbarButton, removeHeaderBarButton } from "@api/HeaderBar";
import { TestcordRequestCoordinator } from "@api/index";
import { definePluginSettings } from "@api/Settings";
import { Card } from "@components/Card";
import { TestcordDevs } from "@utils/constants";
import { sleep as wait } from "@utils/misc";
import { closeModal, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalProps, ModalRoot, ModalSize, openModal } from "@utils/modal";
import { showItemInFolder } from "@utils/native";
import definePlugin, { OptionType } from "@utils/types";
import { Message } from "@vencord/discord-types";
import { Button, ChannelStore, Constants, ContextMenuApi, GuildStore, Menu, React, RelationshipStore, RestAPI, Toasts, UserStore } from "@webpack/common";

type DeletedLogItem = {
    channelId: string;
    guildId?: string | null;
    dmRecipientId?: string | null;
    isGuild: boolean;
    messageId: string;
    timestamp: string;
    content: string;
    attachments?: Array<{ filename?: string; url: string; content_type?: string; }>;
};

type WhitelistMode = "dm" | "server" | null;

// Global state to track the modal and process
let currentModalKey: string | null = null;
let isProcessRunning = false;
let shouldStopProcess = false;
let currentProgressRef: { current: any; } | null = null;

const settings = definePluginSettings({
    location: {
        type: OptionType.SELECT,
        description: "Where to show the button",
        options: [
            { label: "Chat bar", value: "chatbar", default: true },
            { label: "Header bar", value: "headerbar" },
            { label: "Channel toolbar", value: "channeltoolbar" },
            { label: "Disabled", value: "disabled" },
        ],
        restartNeeded: true,
    },
    whitelist: {
        type: OptionType.STRING,
        description: "Comma-separated user IDs to keep (whitelist)",
        default: ""
    },
    whitelistMode: {
        type: OptionType.STRING,
        description: "Whitelist mode: 'dm' or 'server'",
        default: ""
    },
    selectedGuilds: {
        type: OptionType.STRING,
        description: "Comma-separated guild IDs to process (when mode is server)",
        default: ""
    },
    lastLogFilePath: {
        type: OptionType.STRING,
        description: "Path of last deletion log (desktop only)",
        default: ""
    },
    logActions: {
        type: OptionType.COMPONENT,
        component: function LogActions() {
            const { lastLogFilePath } = settings.use(["lastLogFilePath"]);
            return (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <Button
                        disabled={!lastLogFilePath}
                        onClick={() => lastLogFilePath && showItemInFolder(lastLogFilePath)}
                    >Open last log location</Button>
                    {!lastLogFilePath && <span style={{ opacity: .7 }}>No log saved yet</span>}
                </div>
            );
        }
    }
});

function parseCsv(csv: string): string[] {
    return csv
        .split(/[\s,]+/)
        .map(s => s.trim())
        .filter(Boolean);
}

function uniq(arr: string[]): string[] {
    return Array.from(new Set(arr));
}

function getWhitelist(): string[] {
    return uniq(parseCsv(settings.store.whitelist));
}

function setWhitelist(ids: string[]) {
    settings.store.whitelist = ids.join(",");
}

async function fetchAllMessages(channelId: string, throttleMs = 250, onProgress?: (count: number) => void): Promise<Message[]> {
    const result: Message[] = [] as any;
    let before: string | undefined = undefined;

    while (true) {
        const batch = await TestcordRequestCoordinator.request<Message[]>({
            key: `discord:messages:${channelId}:before:${before ?? ""}:limit:100`,
            ttlMs: 30_000,
            run: async () => {
                const res = await RestAPI.get({
                    url: Constants.Endpoints.MESSAGES(channelId),
                    query: { limit: 100, ...(before ? { before } : {}) },
                    retries: 2
                }).catch(() => null as any);

                return res?.body ?? [];
            },
            cacheable: Array.isArray,
        });

        if (!batch.length) break;
        result.push(...batch);
        before = batch[batch.length - 1].id;
        if (onProgress) onProgress(result.length);
        if (batch.length < 100) break;
        await wait(throttleMs);
    }

    return result.reverse();
}

function FriendTag({ id, onRemove }: { id: string; onRemove: (id: string) => void; }) {
    const user = UserStore.getUser(id);
    if (!user) return null as any;
    return (
        <div style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 10px",
            background: "var(--background-modifier-hover)",
            borderRadius: 8,
            marginRight: 8,
            marginBottom: 8,
            border: "1px solid var(--background-modifier-accent)",
            transition: "all 0.2s ease"
        }}>
            <img src={user.getAvatarURL?.(undefined, 20, false)} width={20} height={20} style={{ borderRadius: "50%" }} />
            <span style={{ color: "var(--text-normal)", fontWeight: 500 }}>{(user as any).globalName || user.username}</span>
            <button
                aria-label="remove"
                onClick={() => onRemove(id)}
                style={{
                    background: "transparent",
                    border: 0,
                    cursor: "pointer",
                    color: "var(--interactive-normal)",
                    fontSize: "16px",
                    fontWeight: "bold",
                    padding: "2px 4px",
                    borderRadius: "4px",
                    transition: "all 0.2s ease"
                }}
                onMouseEnter={e => {
                    e.currentTarget.style.background = "var(--background-modifier-accent)";
                    e.currentTarget.style.color = "var(--text-danger)";
                }}
                onMouseLeave={e => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = "var(--interactive-normal)";
                }}
            >×</button>
        </div>
    );
}

function formatTime(seconds: number): string {
    if (seconds < 60) return `${Math.floor(seconds)}s`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}m ${secs}s`;
}

function ProgressModal({ modalProps, onClose, progressRef, onStop }: { modalProps: ModalProps; onClose: () => void; progressRef: { current: any; }; onStop: () => void; }) {
    const [totalMessages, setTotalMessages] = React.useState(0);
    const [processedMessages, setProcessedMessages] = React.useState(0);
    const [deletedCount, setDeletedCount] = React.useState(0);
    const [failedCount, setFailedCount] = React.useState(0);
    const [logs, setLogs] = React.useState<Array<{ time: string; message: string; type: "success" | "error" | "info" | "timeout"; }>>([]);
    const [isRunning, setIsRunning] = React.useState(true);
    const [estimatedTime, setEstimatedTime] = React.useState(0);
    const [timeoutCount, setTimeoutCount] = React.useState(0);
    const [lastTimeoutTime, setLastTimeoutTime] = React.useState<number | null>(null);
    const startTimeRef = React.useRef<number>(Date.now());
    const deletedTimesRef = React.useRef<number[]>([]); // Track deletion times for better averaging
    const lastUpdateTimeRef = React.useRef<number>(Date.now());

    const addLog = (message: string, type: "success" | "error" | "info" | "timeout" = "info") => {
        const time = new Date().toLocaleTimeString();
        setLogs(prev => [...prev.slice(-99), { time, message, type }]);
    };

    const scrollToBottom = () => {
        const logContainer = document.getElementById("message-scrapper-logs");
        if (logContainer) {
            logContainer.scrollTop = logContainer.scrollHeight;
        }
    };

    React.useEffect(() => {
        scrollToBottom();
    }, [logs]);

    const calculateEstimatedTime = React.useCallback(() => {
        const remaining = totalMessages - processedMessages;
        if (remaining <= 0) {
            setEstimatedTime(0);
            return;
        }

        // Calculate average deletions per second from recent history (last 30 deletions)
        const now = Date.now();
        const recentTimes = deletedTimesRef.current.filter(t => now - t < 30000); // Last 30 seconds
        if (recentTimes.length >= 2) {
            const timeSpan = (recentTimes[recentTimes.length - 1] - recentTimes[0]) / 1000; // in seconds
            const deletions = recentTimes.length;
            if (timeSpan > 0) {
                const deletionsPerSecond = deletions / timeSpan;
                const estimated = remaining / deletionsPerSecond;
                setEstimatedTime(estimated);
                return;
            }
        }

        // Fallback: use overall rate if we have enough data
        const totalElapsed = (now - startTimeRef.current) / 1000;
        if (totalElapsed > 0 && deletedCount > 0) {
            const overallRate = deletedCount / totalElapsed;
            if (overallRate > 0) {
                setEstimatedTime(remaining / overallRate);
            }
        }
    }, [totalMessages, processedMessages, deletedCount]);

    React.useEffect(() => {
        calculateEstimatedTime();
    }, [processedMessages, calculateEstimatedTime]);

    // Expose functions to parent via ref
    React.useImperativeHandle(progressRef as any, () => ({
        setTotalMessages,
        incrementProcessed: () => setProcessedMessages(p => p + 1),
        incrementDeleted: () => {
            setDeletedCount(d => d + 1);
            const now = Date.now();
            deletedTimesRef.current.push(now);
            // Keep only last 100 deletion times to avoid memory issues
            if (deletedTimesRef.current.length > 100) {
                deletedTimesRef.current = deletedTimesRef.current.slice(-100);
            }
            lastUpdateTimeRef.current = now;
        },
        incrementFailed: () => setFailedCount(f => f + 1),
        addLog,
        handleTimeout: () => {
            setTimeoutCount(c => c + 1);
            setLastTimeoutTime(Date.now());
            addLog("⚠️ Rate limit timeout detected. Increasing delay...", "timeout");
        },
        finish: () => {
            setIsRunning(false);
            addLog("✅ Process completed!", "success");
        }
    }));

    const progressPercent = totalMessages > 0 ? (processedMessages / totalMessages) * 100 : 0;

    return (
        <ModalRoot {...modalProps} size={ModalSize.LARGE}>
            <ModalHeader>
                <div style={{ display: "flex", alignItems: "center", width: "100%", gap: 16 }}>
                    <h2 style={{ margin: 0, flex: 1 }}>Messages Scrapper - Progress</h2>
                    {!isRunning && <ModalCloseButton onClick={onClose} />}
                </div>
            </ModalHeader>
            <ModalContent style={{ padding: "20px", minHeight: "500px", display: "flex", flexDirection: "column", gap: 16 }}>
                {/* Stats Cards */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
                    <Card style={{ padding: "16px", background: "var(--background-secondary)" }}>
                        <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: 4 }}>Total Messages</div>
                        <div style={{ fontSize: "24px", fontWeight: "bold", color: "var(--text-normal)" }}>{totalMessages}</div>
                    </Card>
                    <Card style={{ padding: "16px", background: "var(--background-secondary)" }}>
                        <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: 4 }}>Deleted</div>
                        <div style={{ fontSize: "24px", fontWeight: "bold", color: "var(--green-360)" }}>{deletedCount}</div>
                    </Card>
                    <Card style={{ padding: "16px", background: "var(--background-secondary)" }}>
                        <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: 4 }}>Failed</div>
                        <div style={{ fontSize: "24px", fontWeight: "bold", color: "var(--status-danger)" }}>{failedCount}</div>
                    </Card>
                    <Card style={{ padding: "16px", background: "var(--background-secondary)" }}>
                        <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: 4 }}>Progress</div>
                        <div style={{ fontSize: "24px", fontWeight: "bold", color: "var(--text-normal)" }}>{Math.round(progressPercent)}%</div>
                    </Card>
                </div>

                {/* Progress Bar */}
                <div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                        <span style={{ color: "var(--text-normal)", fontWeight: 500 }}>Progress</span>
                        <span style={{ color: "var(--text-muted)", fontSize: "14px" }}>
                            {processedMessages} / {totalMessages}
                        </span>
                    </div>
                    <div style={{
                        width: "100%",
                        height: "24px",
                        background: "var(--background-modifier-accent)",
                        borderRadius: "12px",
                        overflow: "hidden"
                    }}>
                        <div style={{
                            width: `${progressPercent}%`,
                            height: "100%",
                            background: "var(--brand-experiment)",
                            transition: "width 0.3s ease",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "var(--white-500)",
                            fontSize: "12px",
                            fontWeight: "bold"
                        }}>
                            {progressPercent > 5 && `${Math.round(progressPercent)}%`}
                        </div>
                    </div>
                </div>

                {/* Time Info */}
                <div style={{ display: "flex", gap: 24, fontSize: "14px" }}>
                    <div>
                        <span style={{ color: "var(--text-muted)" }}>Estimated Time: </span>
                        <span style={{ color: "var(--text-normal)", fontWeight: 500 }}>
                            {estimatedTime > 0 ? formatTime(estimatedTime) : "Calculating..."}
                        </span>
                    </div>
                    {timeoutCount > 0 && (
                        <div>
                            <span style={{ color: "var(--text-muted)" }}>Timeouts: </span>
                            <span style={{ color: "var(--status-warning)", fontWeight: 500 }}>{timeoutCount}</span>
                            {lastTimeoutTime && (
                                <span style={{ color: "var(--text-muted)", marginLeft: 8, fontSize: "12px" }}>
                                    (Last: {formatTime((Date.now() - lastTimeoutTime) / 1000)} ago)
                                </span>
                            )}
                        </div>
                    )}
                </div>

                {/* Logs */}
                <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: "200px" }}>
                    <div style={{ marginBottom: 8, color: "var(--text-normal)", fontWeight: 500 }}>Logs</div>
                    <div
                        id="message-scrapper-logs"
                        style={{
                            flex: 1,
                            background: "var(--background-secondary)",
                            borderRadius: "8px",
                            padding: "12px",
                            overflow: "auto",
                            fontFamily: "monospace",
                            fontSize: "12px",
                            maxHeight: "300px"
                        }}
                    >
                        {logs.length === 0 && (
                            <div style={{ color: "var(--text-muted)", fontStyle: "italic" }}>Waiting for logs...</div>
                        )}
                        {logs.map((log, idx) => (
                            <div
                                key={idx}
                                style={{
                                    marginBottom: "4px",
                                    color: log.type === "error" ? "var(--status-danger)" :
                                        log.type === "success" ? "var(--green-360)" :
                                            log.type === "timeout" ? "var(--status-warning)" :
                                                "var(--text-normal)",
                                    wordBreak: "break-word"
                                }}
                            >
                                <span style={{ color: "var(--text-muted)", marginRight: 8 }}>[{log.time}]</span>
                                {log.message}
                            </div>
                        ))}
                    </div>
                </div>
            </ModalContent>
            <ModalFooter>
                <div style={{ display: "flex", gap: 12, width: "100%", justifyContent: "space-between" }}>
                    <Button
                        onClick={onStop}
                        disabled={!isRunning}
                        color={Button.Colors.RED}
                        style={{
                            background: isRunning ? "var(--button-danger-background)" : "var(--background-modifier-hover)",
                            color: isRunning ? "var(--white-500)" : "var(--text-muted)"
                        }}
                    >
                        Stop
                    </Button>
                    <Button
                        onClick={onClose}
                        disabled={isRunning}
                        style={{
                            background: isRunning ? "var(--background-modifier-hover)" : "var(--brand-experiment)",
                            color: isRunning ? "var(--text-muted)" : "var(--white-500)"
                        }}
                    >
                        {isRunning ? "Processing..." : "Close"}
                    </Button>
                </div>
            </ModalFooter>
        </ModalRoot>
    );
}

function WhitelistModal({ modalProps }: { modalProps: ModalProps; }) {
    const [query, setQuery] = React.useState("");
    const [wl, setWl] = React.useState<string[]>([]);
    const [mode, setMode] = React.useState<WhitelistMode>(null);
    const [selectedGuilds, setSelectedGuilds] = React.useState<string[]>([]);
    const progressRef = React.useRef<any>(null);
    const [isRunning, setIsRunning] = React.useState(false);

    const friendIds = RelationshipStore.getFriendIDs?.() ?? [];
    const dms = ChannelStore.getSortedPrivateChannels().filter(c => c.isDM?.());
    const candidateIds: string[] = React.useMemo(() => {
        const lower = query.toLowerCase();
        const base = (friendIds.length ? friendIds : dms.map(c => c.recipients?.[0]).filter(Boolean)) as string[];
        return base
            .filter(id => !wl.includes(id))
            .filter(id => {
                const u: any = UserStore.getUser(id);
                const name = (u?.globalName || u?.username || "").toLowerCase();
                return name.includes(lower);
            })
            .slice(0, 25);
    }, [query, wl, friendIds, dms]);

    const guilds = Object.values(GuildStore.getGuilds?.() || {} as Record<string, any>);

    const stopProcess = React.useCallback(() => {
        shouldStopProcess = true;
        if (currentProgressRef?.current) {
            currentProgressRef.current.addLog("⏹️ Stopping process...", "info");
        }
    }, []);

    function save() {
        setWhitelist(wl);
        settings.store.whitelistMode = mode || "";
        settings.store.selectedGuilds = selectedGuilds.join(",");
        modalProps.onClose();
    }

    async function start() {
        if (isProcessRunning) {
            Toasts.show({ id: Toasts.genId(), type: Toasts.Type.FAILURE, message: "Process is already running" });
            return;
        }

        setWhitelist(wl);
        settings.store.whitelistMode = mode || "";
        settings.store.selectedGuilds = selectedGuilds.join(",");

        if (!mode) {
            Toasts.show({ id: Toasts.genId(), type: Toasts.Type.FAILURE, message: "Please select a mode (DM or Server)" });
            return;
        }

        const whitelistSet = new Set(wl);
        const myId = UserStore.getCurrentUser()?.id;
        if (!myId) {
            Toasts.show({ id: Toasts.genId(), type: Toasts.Type.FAILURE, message: "Could not determine current user." });
            return;
        }

        // Reset stop flag
        shouldStopProcess = false;
        isProcessRunning = true;
        setIsRunning(true);
        currentProgressRef = progressRef;

        // Open progress modal
        const progressModalKey = openModal((props: any) => (
            <ProgressModal
                modalProps={props}
                progressRef={progressRef}
                onStop={stopProcess}
                onClose={() => {
                    if (!isProcessRunning) {
                        if (progressModalKey) closeModal(progressModalKey);
                        setIsRunning(false);
                        props.onClose();
                    }
                }}
            />
        ));

        const progress = progressRef.current;
        if (!progress) return;

        // Build target channel list
        const targets: any[] = [];

        if (mode === "dm") {
            const dmChannels = ChannelStore.getSortedPrivateChannels()
                .filter(c => typeof c.isDM === "function" ? c.isDM() : c.type === 1)
                .filter(c => {
                    const recipientId = c.recipients?.[0];
                    return recipientId && !whitelistSet.has(recipientId);
                });
            targets.push(...dmChannels);
        } else if (mode === "server") {
            if (selectedGuilds.length === 0) {
                progress.addLog("⚠️ No servers selected!", "error");
                progress.finish();
                return;
            }

            const { GuildChannelStore } = await import("@webpack/common");
            for (const guildId of selectedGuilds) {
                const info: any = GuildChannelStore.getChannels?.(guildId);
                const selectable = info?.SELECTABLE || [];
                for (const item of selectable) {
                    const ch = item.channel || item;
                    if ([0, 11, 12].includes(ch?.type)) {
                        targets.push(ch);
                    }
                }
            }
        }

        if (!targets.length) {
            progress.addLog("⚠️ No channels to process.", "error");
            progress.finish();
            return;
        }

        progress.addLog(`📋 Processing ${targets.length} channels...`, "info");

        // Count total messages first
        let totalMsgCount = 0;
        progress.addLog("🔍 Counting messages...", "info");

        for (const ch of targets) {
            try {
                const messages = await fetchAllMessages(ch.id, 250, count => {
                    // Update progress during counting
                });
                const toDelete = messages.filter((m: any) => m?.author?.id === myId);
                totalMsgCount += toDelete.length;
            } catch (e) {
                progress.addLog(`❌ Failed to count messages in channel ${ch.id}: ${e}`, "error");
            }
        }

        progress.setTotalMessages(totalMsgCount);
        progress.addLog(`✅ Found ${totalMsgCount} messages to delete`, "success");

        if (totalMsgCount === 0) {
            progress.finish();
            return;
        }

        const deleted: DeletedLogItem[] = [];
        let processedCount = 0;
        let deletedCount = 0;
        let failedCount = 0;

        // Adaptive delay - starts conservative, increases on timeout
        const baseDelayMs = 1000;
        let currentDelayMs = baseDelayMs;

        for (const ch of targets) {
            if (shouldStopProcess) {
                progress.addLog("⏹️ Process stopped by user", "info");
                break;
            }

            try {
                const messages = await fetchAllMessages(ch.id, 250);
                const toDelete = messages.filter((m: any) => m?.author?.id === myId);

                for (const m of toDelete) {
                    if (shouldStopProcess) {
                        progress.addLog("⏹️ Process stopped by user", "info");
                        break;
                    }

                    try {
                        // Use RestAPI.del for reliable message deletion
                        await RestAPI.del({
                            url: `${Constants.Endpoints.MESSAGES(ch.id)}/${m.id}`
                        });
                        TestcordRequestCoordinator.invalidatePrefix(`discord:messages:${ch.id}:`);
                        deletedCount++;
                        processedCount++;
                        progress.incrementDeleted();
                        progress.incrementProcessed();

                        deleted.push({
                            channelId: ch.id,
                            guildId: ch.guild_id ?? null,
                            dmRecipientId: typeof ch.isDM === "function" && ch.isDM() ? ch.recipients?.[0] : null,
                            isGuild: !!ch.guild_id,
                            messageId: m.id,
                            timestamp: String(m.timestamp),
                            content: String(m.content ?? "").substring(0, 100),
                            attachments: (m.attachments || []).map((a: any) => ({ filename: a.filename, url: a.url, content_type: a.content_type }))
                        });

                        progress.addLog(`✅ Deleted message from ${ch.name || "channel"}`, "success");

                        // Use adaptive delay
                        await wait(currentDelayMs);

                        // Gradually reduce delay if no timeouts
                        if (currentDelayMs > baseDelayMs) {
                            currentDelayMs = Math.max(baseDelayMs, currentDelayMs - 50);
                        }
                    } catch (e: any) {
                        if (shouldStopProcess) break;

                        failedCount++;
                        processedCount++;
                        progress.incrementFailed();
                        progress.incrementProcessed();

                        if (e?.status === 429 || e?.code === 429 || e?.message?.includes("429")) {
                            progress.handleTimeout();
                            // Increase delay significantly on timeout
                            currentDelayMs = Math.min(5000, currentDelayMs * 2);
                            progress.addLog(`⏱️ Rate limit hit. Increasing delay to ${Math.round(currentDelayMs)}ms`, "timeout");
                            await wait(currentDelayMs * 2); // Extra wait on timeout
                        } else {
                            progress.addLog(`❌ Failed to delete message: ${e?.message || "Unknown error"}`, "error");
                            await wait(currentDelayMs);
                        }
                    }
                }

                if (shouldStopProcess) break;
                await wait(500); // Light pause between channels
            } catch (e: any) {
                if (shouldStopProcess) break;
                progress.addLog(`❌ Failed to fetch messages from channel: ${e?.message || "Unknown error"}`, "error");
            }
        }

        // Mark process as stopped
        isProcessRunning = false;
        setIsRunning(false);

        // Save log
        const runId = new Date().toISOString().replace(/[:.]/g, "-");
        const body = {
            runId,
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            userId: myId,
            mode,
            whitelist: wl,
            selectedGuilds: mode === "server" ? selectedGuilds : [],
            stats: { deleted: deletedCount, failed: failedCount, channels: targets.length, total: totalMsgCount },
            deleted
        };

        const filename = `delete-log-${runId}.json`;
        try {
            if ((window as any).IS_DISCORD_DESKTOP) {
                const data = new TextEncoder().encode(JSON.stringify(body, null, 2));
                const savedPath = await (window as any).DiscordNative.fileManager.saveWithDialog(data, filename, "application/json");
                if (savedPath) {
                    settings.store.lastLogFilePath = savedPath;
                    progress.addLog(`💾 Log saved: ${filename}`, "success");
                }
            } else {
                const blob = new Blob([JSON.stringify(body, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = filename;
                a.click();
                URL.revokeObjectURL(url);
                progress.addLog(`💾 Log downloaded: ${filename}`, "success");
            }
        } catch (e) {
            progress.addLog(`❌ Failed to save log: ${e}`, "error");
        }

        if (shouldStopProcess) {
            progress.addLog(`⏹️ Stopped! Deleted: ${deletedCount}, Failed: ${failedCount}`, "info");
        } else {
            progress.addLog(`✅ Completed! Deleted: ${deletedCount}, Failed: ${failedCount}`, "success");
        }
        progress.finish();
        shouldStopProcess = false;
    }

    return (
        <ModalRoot {...modalProps} size={ModalSize.MEDIUM}>
            <ModalHeader>
                <div style={{ display: "flex", alignItems: "center", width: "100%", gap: 12 }}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" style={{ color: "var(--text-normal)" }}>
                        <path fill="currentColor" d="M9 3h6a1 1 0 0 1 1 1v1h4v2H4V5h4V4a1 1 0 0 1 1-1Zm-3 6h12l-1 11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 9Z" />
                    </svg>
                    <h2 style={{ margin: 0 }}>Messages Scrapper</h2>
                    <div style={{ flex: 1 }} />
                    <ModalCloseButton onClick={modalProps.onClose} />
                </div>
            </ModalHeader>
            <ModalContent style={{ padding: "20px" }}>
                {/* Mode Selection */}
                <div style={{ marginBottom: 20 }}>
                    <div style={{ marginBottom: 12, color: "var(--text-normal)", fontWeight: 600, fontSize: "14px" }}>
                        Select Mode
                    </div>
                    <div style={{ display: "flex", gap: 12 }}>
                        <Button
                            onClick={() => setMode("dm")}
                            style={{
                                flex: 1,
                                background: mode === "dm" ? "var(--brand-experiment)" : "var(--background-modifier-hover)",
                                color: mode === "dm" ? "var(--white-500)" : "var(--text-normal)"
                            }}
                        >
                            DM Messages
                        </Button>
                        <Button
                            onClick={() => setMode("server")}
                            style={{
                                flex: 1,
                                background: mode === "server" ? "var(--brand-experiment)" : "var(--background-modifier-hover)",
                                color: mode === "server" ? "var(--white-500)" : "var(--text-normal)"
                            }}
                        >
                            Server Messages
                        </Button>
                    </div>
                    {mode === "server" && (
                        <div style={{ marginTop: 12 }}>
                            <div style={{ marginBottom: 8, color: "var(--text-normal)", fontWeight: 500, fontSize: "13px" }}>
                                Select Servers
                            </div>
                            <div style={{
                                maxHeight: "150px",
                                overflow: "auto",
                                background: "var(--background-secondary)",
                                borderRadius: "8px",
                                border: "1px solid var(--background-modifier-accent)",
                                padding: "8px"
                            }}>
                                {guilds.map((guild: any) => (
                                    <div
                                        key={guild.id}
                                        onClick={() => {
                                            setSelectedGuilds(prev =>
                                                prev.includes(guild.id)
                                                    ? prev.filter(id => id !== guild.id)
                                                    : [...prev, guild.id]
                                            );
                                        }}
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 8,
                                            padding: "8px",
                                            borderRadius: "4px",
                                            cursor: "pointer",
                                            background: selectedGuilds.includes(guild.id)
                                                ? "var(--brand-experiment-20a)"
                                                : "transparent",
                                            marginBottom: "4px"
                                        }}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={selectedGuilds.includes(guild.id)}
                                            onChange={() => { }}
                                            style={{ cursor: "pointer" }}
                                        />
                                        <img
                                            src={guild.getIconURL?.({ size: 24 })}
                                            width={24}
                                            height={24}
                                            style={{ borderRadius: "50%" }}
                                        />
                                        <span style={{ color: "var(--text-normal)", fontSize: "13px" }}>{guild.name}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Whitelist */}
                <div style={{ marginBottom: 20 }}>
                    <div style={{ marginBottom: 12, color: "var(--text-normal)", fontWeight: 600, fontSize: "14px" }}>
                        Whitelist (kept users):
                    </div>
                    <div style={{
                        display: "flex",
                        flexWrap: "wrap",
                        minHeight: "40px",
                        padding: "8px",
                        background: "var(--background-secondary)",
                        borderRadius: "8px",
                        border: "1px solid var(--background-modifier-accent)"
                    }}>
                        {wl.map(id => (
                            <FriendTag key={id} id={id} onRemove={idToRemove => {
                                setWl(wl.filter(x => x !== idToRemove));
                            }} />
                        ))}
                        {wl.length === 0 && (
                            <div style={{ color: "var(--text-muted)", fontStyle: "italic", alignSelf: "center" }}>
                                No users in whitelist
                            </div>
                        )}
                    </div>
                </div>

                {/* Search */}
                <div style={{ marginBottom: 20 }}>
                    <div style={{ marginBottom: 8, color: "var(--text-normal)", fontWeight: 500, fontSize: "13px" }}>
                        Add from your friends/DMs
                    </div>
                    <input
                        placeholder="Search users by name"
                        value={query}
                        onChange={e => setQuery((e.target as HTMLInputElement).value)}
                        style={{
                            width: "100%",
                            padding: "10px 12px",
                            borderRadius: 8,
                            border: "1px solid var(--background-modifier-accent)",
                            background: "var(--input-background)",
                            color: "var(--text-normal)",
                            fontSize: "14px",
                            outline: "none",
                            transition: "border-color 0.2s ease"
                        }}
                        onFocus={e => {
                            e.target.style.borderColor = "var(--brand-experiment)";
                        }}
                        onBlur={e => {
                            e.target.style.borderColor = "var(--background-modifier-accent)";
                        }}
                    />
                    <div style={{
                        marginTop: 8,
                        maxHeight: 150,
                        overflow: "auto",
                        background: "var(--background-secondary)",
                        borderRadius: "8px",
                        border: "1px solid var(--background-modifier-accent)"
                    }}>
                        {candidateIds.map((id: string) => {
                            const u: any = id ? UserStore.getUser(id) : null;
                            const label = (u?.globalName || u?.username || id || "Unknown") as string;
                            const avatar = u?.getAvatarURL?.(undefined, 32, false);
                            return (
                                <div
                                    key={id}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        padding: "10px 12px",
                                        gap: 12,
                                        borderBottom: "1px solid var(--background-modifier-accent)",
                                        cursor: "pointer",
                                        transition: "background-color 0.2s ease"
                                    }}
                                    onMouseEnter={e => {
                                        e.currentTarget.style.background = "var(--background-modifier-hover)";
                                    }}
                                    onMouseLeave={e => {
                                        e.currentTarget.style.background = "transparent";
                                    }}
                                    onClick={() => setWl(uniq([...wl, id]))}
                                >
                                    {avatar && <img src={avatar} width={32} height={32} style={{ borderRadius: "50%" }} />}
                                    <div style={{ flex: 1, color: "var(--text-normal)", fontWeight: 500, fontSize: "14px" }}>
                                        {label}
                                    </div>
                                </div>
                            );
                        })}
                        {candidateIds.length === 0 && query && (
                            <div style={{ padding: "20px", textAlign: "center", color: "var(--text-muted)", fontStyle: "italic" }}>
                                No matches found
                            </div>
                        )}
                    </div>
                </div>
            </ModalContent>
            <ModalFooter>
                <div style={{ display: "flex", justifyContent: "space-between", width: "100%", gap: "12px" }}>
                    <Button
                        onClick={save}
                        style={{
                            background: "var(--background-modifier-hover)",
                            color: "var(--text-normal)",
                            border: "1px solid var(--background-modifier-accent)"
                        }}
                    >
                        Save
                    </Button>
                    <Button
                        color={Button.Colors.RED}
                        onClick={start}
                        disabled={isRunning || !mode || (mode === "server" && selectedGuilds.length === 0)}
                        style={{
                            background: isRunning ? "var(--background-modifier-hover)" : "var(--button-danger-background)",
                            color: isRunning ? "var(--text-muted)" : "var(--white-500)"
                        }}
                    >
                        {isRunning ? "Running..." : "Start"}
                    </Button>
                </div>
            </ModalFooter>
        </ModalRoot>
    );
}

async function openMessageScrapperModal() {
    // If modal is already open, close it first
    if (currentModalKey) {
        closeModal(currentModalKey);
        currentModalKey = null;
    }

    // Reset process state
    isProcessRunning = false;
    shouldStopProcess = false;
    currentProgressRef = null;

    // If desktop, open in separate window instead of modal
    if (IS_DISCORD_DESKTOP) {
        try {
            const { ipcRenderer } = await import("electron");
            await (ipcRenderer as any).invoke("OPEN_MESSAGE_SCRAPPER_WINDOW");
            return; // Don't open modal in main window
        } catch (e) {
            console.error("Failed to open message scrapper window:", e);
            // Fall through to open modal as fallback
        }
    }

    // Open new modal (web or fallback)
    currentModalKey = openModal((props: any) => (
        <WhitelistModal
            modalProps={{
                ...props,
                onClose: () => {
                    // Reset on close
                    if (!isProcessRunning) {
                        isProcessRunning = false;
                        shouldStopProcess = false;
                        currentProgressRef = null;
                        currentModalKey = null;
                    }
                    props.onClose();
                }
            }}
        />
    ));
}

function stopMessageScrapper() {
    if (isProcessRunning) {
        shouldStopProcess = true;
        Toasts.show({ id: Toasts.genId(), type: Toasts.Type.MESSAGE, message: "Stopping Message Scrapper..." });
    } else {
        Toasts.show({ id: Toasts.genId(), type: Toasts.Type.FAILURE, message: "No process running" });
    }
}

const handleOpenMessageScrapper = () => {
    openMessageScrapperModal();
};

export default definePlugin({
    name: "MessagesScrapper",
    description: "Delete your own messages in DMs or servers with a beautiful progress interface. Logs each run to JSON.",
    tags: ["Chat", "Utility"],
    authors: [TestcordDevs.x2b],
    dependencies: ["HeaderBarAPI"],
    settings,
    start() {
        window.addEventListener("vencord:openMessageScrapper", handleOpenMessageScrapper);
        const { location } = settings.store;
        if (location === "headerbar") {
            addHeaderBarButton("MessagesScrapper", () => (
                <HeaderBarButton
                    icon={() => (
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">
                            <path fill="currentColor" d="M9 3h6a1 1 0 0 1 1 1v1h4v2H4V5h4V4a1 1 0 0 1 1-1Zm-3 6h12l-1 11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 9Z" />
                        </svg>
                    )}
                    tooltip="Messages Scrapper"
                    onClick={openMessageScrapperModal}
                />
            ), 5);
        } else if (location === "channeltoolbar") {
            addChannelToolbarButton("MessagesScrapper", () => (
                <ChannelToolbarButton
                    icon={() => (
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">
                            <path fill="currentColor" d="M9 3h6a1 1 0 0 1 1 1v1h4v2H4V5h4V4a1 1 0 0 1 1-1Zm-3 6h12l-1 11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 9Z" />
                        </svg>
                    )}
                    tooltip="Messages Scrapper"
                    onClick={openMessageScrapperModal}
                />
            ), 5);
        }
    },
    stop() {
        window.removeEventListener("vencord:openMessageScrapper", handleOpenMessageScrapper);
        removeHeaderBarButton("MessagesScrapper");
        removeChannelToolbarButton("MessagesScrapper");
    },
    renderChatBarButton: (({ isMainChat }) => {
        if (!isMainChat || settings.store.location !== "chatbar") return null;
        return (
            <ChatBarButton
                tooltip="Messages Scrapper"
                onClick={openMessageScrapperModal}
                onContextMenu={e =>
                    ContextMenuApi.openContextMenu(e, () => (
                        <Menu.Menu navId="pc-messages-scrapper-menu" onClose={ContextMenuApi.closeContextMenu} aria-label="Messages Scrapper">
                            <Menu.MenuItem id="pc-messages-scrapper-open" label="Open Messages Scrapper" action={openMessageScrapperModal} />
                            <Menu.MenuItem
                                id="pc-messages-scrapper-stop"
                                label="Stop"
                                action={stopMessageScrapper}
                                disabled={!isProcessRunning}
                            />
                        </Menu.Menu>
                    ))
                }
            >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="currentColor" d="M9 3h6a1 1 0 0 1 1 1v1h4v2H4V5h4V4a1 1 0 0 1 1-1Zm-3 6h12l-1 11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 9Z" />
                </svg>
            </ChatBarButton>
        );
    }) as any
});
