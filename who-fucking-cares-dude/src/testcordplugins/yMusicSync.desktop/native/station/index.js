/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { randomUUID } from "node:crypto";
import { emitSnapshot, enqueue } from "../events";
import { absoluteCoverUrl, playerDevices } from "../mapping";
import { errorMessage, log, state } from "../state";
import { YnisonSocket } from "../ynisonSocket";
import { isLocalAddress } from "./address";
import { DISCOVERY_INTERVAL_MS, STATION_PING_MS, STATION_PREFIX, STATION_RECONNECT_MS } from "./constants";
import { discoverStations } from "./mdns";
import { fetchConversationToken, fetchStationNames } from "./quasar";
const sessions = new Map();
let discoveryTimer = null;
let refreshing = false;
export function isStationSelected() {
    return state.activeStationId.length > 0;
}
function activeSession() {
    return sessions.get(state.activeStationId) ?? null;
}
function send(session, payload) {
    if (!session.socket?.isOpen)
        return false;
    return session.socket.send(JSON.stringify({
        conversationToken: session.entry.token,
        id: randomUUID(),
        sentTime: Date.now(),
        payload
    }));
}
function repeatFromGlagol(value) {
    switch (String(value ?? "None").toLowerCase()) {
        case "one": return "one";
        case "all": return "context";
        default: return "off";
    }
}
export function stationSnapshot() {
    const session = activeSession();
    if (!session)
        return null;
    const current = session.player?.playerState;
    const activeDeviceId = `${STATION_PREFIX}${session.entry.deviceId}`;
    return {
        trackId: String(current?.id ?? ""),
        title: String(current?.title ?? ""),
        artists: String(current?.subtitle ?? ""),
        artistUrl: "",
        artistsResolved: true,
        album: "",
        coverUrl: absoluteCoverUrl(current?.extra?.coverURI),
        positionMs: Math.max(0, Math.round(Number(current?.progress ?? 0) * 1000)),
        durationMs: Math.max(0, Math.round(Number(current?.duration ?? 0) * 1000)),
        isPlaying: Boolean(session.player?.playing),
        shuffle: false,
        repeat: repeatFromGlagol(current?.entityInfo?.repeatMode),
        volume: Math.min(1, Math.max(0, Number(session.player?.volume ?? 0))),
        devices: playerDevices(activeDeviceId),
        activeDeviceId,
        activeDeviceName: session.entry.name
    };
}
function emitStationSnapshot() {
    const snapshot = stationSnapshot();
    if (snapshot)
        emitSnapshot(snapshot);
}
function handleState(session, incoming) {
    const startedPlaying = Boolean(incoming.playing) && !session.player?.playing;
    const busy = activeSession();
    session.player = incoming;
    if (startedPlaying && (busy === null || busy === session || !busy.player?.playing)) {
        state.activeStationId = session.entry.deviceId;
        log(`Following playback on ${session.entry.name}`);
    }
    if (state.activeStationId === session.entry.deviceId)
        emitStationSnapshot();
}
function stopSession(session) {
    session.generation++;
    if (session.pingTimer)
        clearInterval(session.pingTimer);
    if (session.reconnectTimer)
        clearTimeout(session.reconnectTimer);
    session.pingTimer = null;
    session.reconnectTimer = null;
    session.socket?.close("Station released");
    session.socket = null;
    session.player = null;
}
function scheduleReconnect(session) {
    if (session.reconnectTimer || !sessions.has(session.entry.deviceId))
        return;
    session.reconnectTimer = setTimeout(() => {
        session.reconnectTimer = null;
        void openSession(session);
    }, STATION_RECONNECT_MS);
    session.reconnectTimer.unref();
}
async function openSession(session) {
    const { entry } = session;
    const current = ++session.generation;
    if (session.pingTimer)
        clearInterval(session.pingTimer);
    session.pingTimer = null;
    try {
        const connection = await YnisonSocket.connect(new URL(`wss://${entry.host}:${entry.port}`), [], {
            onMessage(data) {
                if (current !== session.generation)
                    return;
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.state)
                        handleState(session, parsed.state);
                }
                catch (error) {
                    log(`Malformed message from ${entry.name}: ${errorMessage(error)}`);
                }
            },
            onClose(reason) {
                if (current !== session.generation)
                    return;
                log(`${entry.name} disconnected: ${reason}`);
                session.socket = null;
                scheduleReconnect(session);
            }
        }, { rejectUnauthorized: false });
        if (current !== session.generation) {
            connection.close("Superseded");
            return;
        }
        session.socket = connection;
        log(`Connected to ${entry.name} at ${entry.host}:${entry.port}`);
        send(session, { command: "ping" });
        session.pingTimer = setInterval(() => send(session, { command: "ping" }), STATION_PING_MS);
        session.pingTimer.unref();
    }
    catch (error) {
        log(`Could not reach ${entry.name}: ${errorMessage(error)}`);
        scheduleReconnect(session);
    }
}
function syncSessions() {
    const wanted = new Map(state.stations.filter(entry => entry.token).map(entry => [entry.deviceId, entry]));
    for (const [deviceId, session] of sessions) {
        const entry = wanted.get(deviceId);
        if (entry && entry.host === session.entry.host && entry.port === session.entry.port) {
            session.entry = entry;
            continue;
        }
        stopSession(session);
        sessions.delete(deviceId);
        if (state.activeStationId === deviceId)
            state.activeStationId = "";
    }
    for (const [deviceId, entry] of wanted) {
        if (sessions.has(deviceId))
            continue;
        const session = {
            entry,
            socket: null,
            player: null,
            pingTimer: null,
            reconnectTimer: null,
            generation: 0,
            mutedVolume: 0
        };
        sessions.set(deviceId, session);
        void openSession(session);
    }
}
export function selectStation(deviceId) {
    const session = sessions.get(deviceId);
    if (!session) {
        const known = state.stations.some(entry => entry.deviceId === deviceId);
        if (known) {
            enqueue({
                type: "error",
                message: "The station is not reachable yet, try rescanning from the toolbox",
                at: Date.now()
            });
        }
        return false;
    }
    state.activeStationId = deviceId;
    emitStationSnapshot();
    return true;
}
export function releaseStation() {
    state.activeStationId = "";
}
export function runStationCommand(name, payload) {
    const session = activeSession();
    if (!session)
        return false;
    switch (name) {
        case "playPause":
            return send(session, { command: session.player?.playing ? "stop" : "play" });
        case "next":
            return send(session, { command: "next" });
        case "previous":
            return send(session, { command: "prev" });
        case "seek":
            return send(session, { command: "rewind", position: Math.max(0, Math.round((payload.value ?? 0) / 1000)) });
        case "setVolume":
            session.mutedVolume = 0;
            return send(session, { command: "setVolume", volume: Math.min(1, Math.max(0, payload.value ?? 0)) });
        case "toggleMute": {
            const current = Number(session.player?.volume ?? 0);
            if (current > 0) {
                session.mutedVolume = current;
                return send(session, { command: "setVolume", volume: 0 });
            }
            const restored = session.mutedVolume > 0 ? session.mutedVolume : 0.5;
            session.mutedVolume = 0;
            return send(session, { command: "setVolume", volume: restored });
        }
        default:
            return false;
    }
}
async function authorize(entries) {
    const musicToken = state.stationToken;
    if (!musicToken) {
        log("No Yandex Music token yet, stations are listed but cannot be controlled");
        return;
    }
    let names = new Map();
    try {
        names = await fetchStationNames(musicToken);
    }
    catch (error) {
        log(`Station names unavailable: ${errorMessage(error)}`);
    }
    await Promise.all(entries.map(async (entry) => {
        const name = names.get(entry.deviceId);
        if (name)
            entry.name = name;
        if (entry.token)
            return;
        try {
            entry.token = await fetchConversationToken(musicToken, entry.deviceId, entry.platform);
        }
        catch (error) {
            enqueue({ type: "error", message: `Yandex Station auth failed: ${errorMessage(error)}`, at: Date.now() });
            log(`Station token failed for ${entry.name}: ${errorMessage(error)}`);
        }
    }));
}
export async function refreshStations() {
    if (refreshing)
        return;
    refreshing = true;
    try {
        const discovered = await discoverStations();
        log(`mDNS found ${discovered.length} speaker(s)`);
        const entries = [];
        for (const found of discovered) {
            if (!found.platform || !isLocalAddress(found.host)) {
                log(`Skipping ${found.name}: platform "${found.platform}", address ${found.host}`);
                continue;
            }
            const previous = state.stations.find(entry => entry.deviceId === found.deviceId);
            entries.push({
                deviceId: found.deviceId,
                name: found.name,
                platform: found.platform,
                host: found.host,
                port: found.port,
                token: previous?.token ?? ""
            });
        }
        await authorize(entries);
        state.stations = entries;
        syncSessions();
        log(`Ready to control ${entries.filter(entry => entry.token).length} of ${entries.length} station(s)`);
    }
    catch (error) {
        log(`Station lookup failed: ${errorMessage(error)}`);
    }
    finally {
        refreshing = false;
    }
}
export function startStations(token) {
    const changed = token !== state.stationToken;
    state.stationToken = token;
    if (changed) {
        for (const [deviceId, session] of sessions) {
            stopSession(session);
            sessions.delete(deviceId);
        }
        state.activeStationId = "";
        for (const entry of state.stations)
            entry.token = "";
    }
    if (!discoveryTimer) {
        discoveryTimer = setInterval(() => void refreshStations(), DISCOVERY_INTERVAL_MS);
        discoveryTimer.unref();
    }
    return refreshStations();
}
export function stopStations() {
    for (const [deviceId, session] of sessions) {
        stopSession(session);
        sessions.delete(deviceId);
    }
    if (discoveryTimer)
        clearInterval(discoveryTimer);
    discoveryTimer = null;
    state.activeStationId = "";
    state.stations = [];
    state.stationToken = "";
}
