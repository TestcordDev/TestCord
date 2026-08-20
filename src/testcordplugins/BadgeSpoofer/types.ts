/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface Game {
    id: string;
    name: string;
    exe: string;
}

export interface SessionInfo {
    heartbeatSession: string;
    launchSignature: string;
    superProps: string;
}

export interface SpoofLog {
    id: string;
    timestamp: number;
    type: "info" | "success" | "warn" | "error";
    message: string;
}

export interface SpoofProgress {
    total: number;
    sent: number;
    hours: number;
    streamHours?: number;
    currentBatch: number;
    totalBatches: number;
    isRunning: boolean;
    status: string;
}

export interface SpoofOptions {
    count: number;
    hours: number;
    streamHours?: number;
    includeStreaming?: boolean;
    batchSize?: number;
    batchDelay?: number;
    fingerprint?: string;
    onProgress?: (progress: SpoofProgress) => void;
    onLog?: (log: SpoofLog) => void;
}

export interface SpooferStats {
    totalGamesClaimed: number;
    totalHoursClaimed: number;
    totalStreamHoursClaimed: number;
    usedGames: string[];
    fingerprint: string;
}
