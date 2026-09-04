/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ModalContent, ModalFooter, openModal } from "@utils/modal";
import type { RenderModalProps } from "@vencord/discord-types";
import { Button, Forms, Modal, React, Text, TextInput, Toasts, useEffect, useRef, useState } from "@webpack/common";

import { badgeSpooferEngine } from "../engine";
import { HypeSquadPicker } from "../hypesquad";
import type { SpoofLog, SpoofProgress } from "../types";

export function BadgeSpooferModal({ modalProps }: { modalProps: RenderModalProps }) {
    const [hours, setHours] = useState("1");
    const [streamHours, setStreamHours] = useState("1");
    const [gameCount, setGameCount] = useState("");
    const [fingerprint, setFingerprint] = useState("");
    const [stats, setStats] = useState(() => badgeSpooferEngine.getStats());
    const [totalAvailableGames, setTotalAvailableGames] = useState(0);
    const [isRunning, setIsRunning] = useState(badgeSpooferEngine.getIsRunning());
    const [progress, setProgress] = useState<SpoofProgress | null>(null);
    const [logs, setLogs] = useState<SpoofLog[]>([
        {
            id: "init",
            timestamp: Date.now(),
            type: "info",
            message: "Badge Spoofer ready. Spoofs games played, playtime, and streamed hours."
        }
    ]);

    const logsEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        (async () => {
            const currentStats = await badgeSpooferEngine.loadStats();
            setStats(currentStats);
            setFingerprint(currentStats.fingerprint || "");

            const games = await badgeSpooferEngine.loadGames();
            setTotalAvailableGames(games.length);
        })();
    }, []);

    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [logs]);

    const handleStart = async () => {
        const parsedCount = !gameCount.trim() || gameCount.toLowerCase() === "all"
            ? totalAvailableGames
            : Math.min(Number(gameCount) || totalAvailableGames, totalAvailableGames);
        const parsedHours = Math.max(0, Number(hours) || 0);
        const parsedStreamHours = Math.max(0, Number(streamHours) || 0);

        setIsRunning(true);
        badgeSpooferEngine.setFingerprint(fingerprint);

        await badgeSpooferEngine.startSpoofing({
            count: parsedCount,
            hours: parsedHours,
            streamHours: parsedStreamHours,
            fingerprint: fingerprint.trim() || undefined,
            onProgress: p => {
                setProgress(p);
                setIsRunning(p.isRunning);
                setStats(badgeSpooferEngine.getStats());
            },
            onLog: log => {
                setLogs(prev => [...prev.slice(-150), log]);
            }
        });

        setIsRunning(false);
        setStats(badgeSpooferEngine.getStats());
    };

    const handleStop = () => {
        badgeSpooferEngine.stopSpoofing();
        setIsRunning(false);
        Toasts.show({
            id: Toasts.genId(),
            message: "Spoofing stopped.",
            type: Toasts.Type.MESSAGE
        });
    };

    const handleRefreshGames = async () => {
        const games = await badgeSpooferEngine.loadGames(true);
        setTotalAvailableGames(games.length);
        Toasts.show({
            id: Toasts.genId(),
            message: `Reloaded ${games.length} games from Discord CDN`,
            type: Toasts.Type.SUCCESS
        });
    };

    const handleClearStats = () => {
        badgeSpooferEngine.clearHistory();
        setStats(badgeSpooferEngine.getStats());
        Toasts.show({
            id: Toasts.genId(),
            message: "Claimed stats reset.",
            type: Toasts.Type.SUCCESS
        });
    };

    const percent = progress && progress.total > 0
        ? Math.min(100, Math.round((progress.sent / progress.total) * 100))
        : 0;

    return (
        <Modal
            {...modalProps}
            size="md"
            title="Discord Badge Spoofer"
            subtitle="Spoof Game Variety (Games Played), Game Time (Playtime), & Streaming (Hours Streamed)"
        >
            <ModalContent scrollbarType="none" style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "14px" }}>
                <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(4, 1fr)",
                    gap: "10px",
                    background: "var(--background-secondary)",
                    padding: "12px 14px",
                    borderRadius: "8px",
                    border: "1px solid var(--background-modifier-accent)"
                }}>
                    <div>
                        <Forms.FormTitle tag="h5" style={{ margin: 0, marginBottom: "4px", fontSize: "11px" }}>GAMES SPOOFED</Forms.FormTitle>
                        <Text variant="heading-md/bold" color="header-primary">{stats.totalGamesClaimed.toLocaleString()}</Text>
                    </div>
                    <div>
                        <Forms.FormTitle tag="h5" style={{ margin: 0, marginBottom: "4px", fontSize: "11px" }}>HOURS PLAYED</Forms.FormTitle>
                        <Text variant="heading-md/bold" color="header-primary">{Math.round(stats.totalHoursClaimed).toLocaleString()}h</Text>
                    </div>
                    <div>
                        <Forms.FormTitle tag="h5" style={{ margin: 0, marginBottom: "4px", fontSize: "11px" }}>HOURS STREAMED</Forms.FormTitle>
                        <Text variant="heading-md/bold" color="header-primary">{Math.round(stats.totalStreamHoursClaimed || 0).toLocaleString()}h</Text>
                    </div>
                    <div>
                        <Forms.FormTitle tag="h5" style={{ margin: 0, marginBottom: "4px", fontSize: "11px" }}>DB GAMES</Forms.FormTitle>
                        <Text variant="heading-md/bold" color="header-primary">{totalAvailableGames.toLocaleString()}</Text>
                    </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
                        <div>
                            <Forms.FormTitle tag="h5">PLAY HOURS</Forms.FormTitle>
                            <TextInput
                                type="number"
                                disabled={isRunning}
                                value={hours}
                                onChange={setHours}
                                placeholder="1"
                            />
                            <Forms.FormText style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "4px" }}>
                                Playtime per game
                            </Forms.FormText>
                        </div>

                        <div>
                            <Forms.FormTitle tag="h5">STREAM HOURS</Forms.FormTitle>
                            <TextInput
                                type="number"
                                disabled={isRunning}
                                value={streamHours}
                                onChange={setStreamHours}
                                placeholder="1"
                            />
                            <Forms.FormText style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "4px" }}>
                                Streamed per game
                            </Forms.FormText>
                        </div>

                        <div>
                            <Forms.FormTitle tag="h5">GAME COUNT</Forms.FormTitle>
                            <TextInput
                                disabled={isRunning}
                                value={gameCount}
                                onChange={setGameCount}
                                placeholder={`All (${totalAvailableGames})`}
                            />
                            <Forms.FormText style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "4px" }}>
                                Number or blank
                            </Forms.FormText>
                        </div>
                    </div>

                    <div>
                        <Forms.FormTitle tag="h5">EXECUTABLE FINGERPRINT (OPTIONAL)</Forms.FormTitle>
                        <TextInput
                            disabled={isRunning}
                            value={fingerprint}
                            onChange={setFingerprint}
                            placeholder="Optional base64 executable_fingerprint for games-played count"
                        />
                        <Forms.FormText style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "4px" }}>
                            Used by Discord to verify the executable. Leave blank to use defaults.
                        </Forms.FormText>
                    </div>
                </div>

                <div style={{
                    background: "var(--background-secondary)",
                    padding: "12px 14px",
                    borderRadius: "8px",
                    border: "1px solid var(--background-modifier-accent)"
                }}>
                    <HypeSquadPicker />
                </div>

                {(isRunning || progress) && (
                    <div style={{
                        background: "var(--background-secondary)",
                        padding: "10px 14px",
                        borderRadius: "8px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px"
                    }}>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <Text variant="text-xs/medium" color="text-normal">
                                {progress?.status || (isRunning ? "Spoofing in progress..." : "Ready")}
                            </Text>
                            <Text variant="text-xs/bold" color="header-primary">{percent}%</Text>
                        </div>
                        <div style={{
                            width: "100%",
                            height: "6px",
                            background: "var(--background-secondary-alt)",
                            borderRadius: "3px",
                            overflow: "hidden"
                        }}>
                            <div style={{
                                width: `${percent}%`,
                                height: "100%",
                                background: "var(--brand-500)",
                                transition: "width 0.2s ease"
                            }} />
                        </div>
                    </div>
                )}

                <div>
                    <Forms.FormTitle tag="h5">LIVE OUTPUT LOGS</Forms.FormTitle>
                    <div className="tc-badge-spoofer-logs">
                        {logs.map(log => (
                            <div key={log.id} className="tc-badge-spoofer-log-line">
                                <span className="tc-badge-spoofer-log-time">
                                    [{new Date(log.timestamp).toLocaleTimeString()}]
                                </span>
                                <span className={`tc-badge-spoofer-log-msg ${log.type}`}>
                                    {log.message}
                                </span>
                            </div>
                        ))}
                        <div ref={logsEndRef} />
                    </div>
                </div>

                <div style={{
                    padding: "10px 14px",
                    background: "var(--background-secondary)",
                    borderRadius: "6px",
                    borderLeft: "4px solid var(--brand-500)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "2px"
                }}>
                    <Text variant="text-xs/medium" color="header-primary" style={{ fontWeight: 600 }}>
                        Note
                    </Text>
                    <Text variant="text-xs/normal" color="text-muted" style={{ lineHeight: 1.4 }}>
                        Discord accepts these events with status <code style={{ background: "rgba(0,0,0,0.3)", padding: "1px 4px", borderRadius: "3px", color: "var(--text-positive)" }}>204 OK</code>. Badge tiers refresh on their backend within 24-48 hours.
                    </Text>
                </div>
            </ModalContent>

            <ModalFooter>
                <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center" }}>
                    <div style={{ display: "flex", gap: "8px" }}>
                        <Button
                            size={Button.Sizes.SMALL}
                            color={Button.Colors.PRIMARY}
                            look={Button.Looks.FILLED}
                            disabled={isRunning}
                            onClick={handleRefreshGames}
                        >
                            Reload Database
                        </Button>
                        <Button
                            size={Button.Sizes.SMALL}
                            color={Button.Colors.PRIMARY}
                            look={Button.Looks.FILLED}
                            disabled={isRunning}
                            onClick={handleClearStats}
                        >
                            Reset Stats
                        </Button>
                    </div>

                    <div style={{ display: "flex", gap: "8px" }}>
                        {isRunning ? (
                            <Button
                                color={Button.Colors.RED}
                                onClick={handleStop}
                            >
                                Stop Spoofing
                            </Button>
                        ) : (
                            <Button
                                color={Button.Colors.BRAND}
                                onClick={handleStart}
                            >
                                Start Spoofing
                            </Button>
                        )}
                    </div>
                </div>
            </ModalFooter>
        </Modal>
    );
}

export function openBadgeSpooferModal() {
    openModal(props => <BadgeSpooferModal modalProps={props} />);
}
