/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { DataStore } from "@api/index";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { sleep } from "@utils/misc";
import { ModalContent, ModalFooter, ModalHeader, ModalRoot, ModalSize,openModal } from "@utils/modal";
import { useForceUpdater } from "@utils/react";
import definePlugin, { OptionType } from "@utils/types";
import { Button, Forms, Menu, React, Text,TextInput, Toasts } from "@webpack/common";
import { CSSProperties } from "react";

const DISCORD_GATEWAY = "wss://gateway.discord.gg/?v=9&encoding=json";
const STORAGE_KEY = "vc-toucher";
let webSockets: WebSocket[] = [];
let storedTokens: string[] = [];
let currentTokens: string[] = [];
let shouldStop: boolean = false;

function getConnectionCount() {
    return webSockets.length;
}

async function saveTokensToStorage() {
    const existingData = await DataStore.get(STORAGE_KEY);
    if (JSON.stringify(storedTokens) !== existingData) {
        await DataStore.set(STORAGE_KEY, JSON.stringify(storedTokens));
    }
    currentTokens = [...storedTokens];
    return true;
}

async function loadTokensFromStorage() {
    const savedData = await DataStore.get(STORAGE_KEY);
    if (!savedData) {
        storedTokens = [];
        await DataStore.set(STORAGE_KEY, JSON.stringify([]));
    } else {
        storedTokens = JSON.parse(savedData);
    }
    currentTokens = [...storedTokens];
}

function TokenDisplay({ token, onRemove }) {
    const visiblePart = token.slice(0, 8);
    const hiddenPart = "*".repeat(Math.max(0, token.length - 8));
    return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 8px", border: "1px solid var(--background-modifier-accent)", borderRadius: "6px", marginBottom: "6px" }}>
            <Text variant={"text-md/normal"}>{visiblePart + hiddenPart}</Text>
            <Button size="small" style={{ marginLeft: "8px" }} color={Button.Colors.RED} onClick={onRemove}>Remove</Button>
        </div>
    );
}

function TokenManager() {
    const [currentInput, setCurrentInput] = React.useState("");
    const [tokenEntries, setTokenEntries] = React.useState<string[]>([]);
    const forceUpdate = useForceUpdater();

    React.useEffect(() => {
        loadTokensFromStorage().then(() => {
            setTokenEntries([...storedTokens]);
            forceUpdate();
        });
    }, []);

    const addToken = async () => {
        const trimmedToken = currentInput.trim();
        if (trimmedToken.length === 0 || tokenEntries.includes(trimmedToken)) return;
        const updatedTokens = [...tokenEntries, trimmedToken];
        storedTokens = updatedTokens;
        await saveTokensToStorage();
        setTokenEntries(updatedTokens);
        setCurrentInput("");
        forceUpdate();
    };

    const removeToken = async tokenToRemove => {
        const updatedTokens = tokenEntries.filter(token => token !== tokenToRemove);
        storedTokens = updatedTokens;
        await saveTokensToStorage();
        setTokenEntries(updatedTokens);
        forceUpdate();
    };

    return (
        <>
            <Forms.FormDivider as any />
            <Forms.FormTitle tag="h4">VC Raper - Connected Slaves: {getConnectionCount()}</Forms.FormTitle>
            <Text variant={"heading-md/normal"}>Enter Token</Text>
            <TextInput value={currentInput} onChange={setCurrentInput} placeholder="Paste a token here" />
            <Button onClick={addToken} style={{ marginTop: "8px" }}>Add</Button>
            <Forms.FormDivider as any />
            <Text variant={"heading-md/normal"}>Slave list</Text>
            <ul style={{ paddingLeft: "0", listStyleType: "none", marginTop: "8px" }}>
                {tokenEntries.map(token => (
                    <li key={token}>
                        <TokenDisplay token={token} onRemove={() => removeToken(token)} />
                    </li>
                ))}
            </ul>
        </>
    );
}

const settings = definePluginSettings(
    {
        tagConfiguration: {
            type: OptionType.COMPONENT,
            description: "The tag configuration component",
            component: () => {
                return (
                    <TokenManager />
                );
            }
        }
    });

export default definePlugin({
    name: "vcGrape",
    description: "R any loser in a vc with this trolling bot, originally created by atticus. Updated and fixed by dot",
    tags: ["Utility"],
    authors: [TestcordDevs.dot],
    contextMenus: {
        "channel-context": createContextMenuPatch(),
    },
    settings,
    stop: closeWebSockets,
});

async function executeVoiceChannelAction(guildId: string, channelId: string, duration: number, rejoin: number, delay: number, randomDelay: number, amount: number) {
    if (randomDelay <= 1) {
        if (shouldStop) return;
        console.log("executing method 1");
        for (const socket of webSockets) {
            const joinPayload = {
                op: 4,
                d: {
                    guild_id: guildId,
                    channel_id: channelId,
                    self_mute: false,
                    self_deaf: false,
                },
            };
            if (shouldStop) return;
            socket.send(JSON.stringify(joinPayload));
            console.log(guildId, channelId, duration, rejoin);
        }
        await sleep(duration + 50);
        for (const socket of webSockets) {
            const leavePayload = {
                op: 4,
                d: {
                    guild_id: guildId,
                    channel_id: null,
                    self_mute: false,
                    self_deaf: false
                }
            };
            await sleep(50);
            socket.send(JSON.stringify(leavePayload));
        }
    } else {
        console.log("executing method 2");
        for (const socket of webSockets) {
            if (shouldStop) return;

            const joinPayload = {
                op: 4,
                d: {
                    guild_id: guildId,
                    channel_id: channelId,
                    self_mute: false,
                    self_deaf: false
                }
            };

            socket.send(JSON.stringify(joinPayload));
            console.log(guildId, channelId, duration, rejoin);
            await sleep(duration + 50);

            const leavePayload = {
                op: 4,
                d: {
                    guild_id: guildId,
                    channel_id: null,
                    self_mute: false,
                    self_deaf: false
                }
            };

            socket.send(JSON.stringify(leavePayload));
            await sleep(randomDelay);
        }

        if (shouldStop) return;

        await sleep(delay);
        if (rejoin > 0) scheduleRejoin(guildId, channelId, duration, rejoin - 1, delay, randomDelay, amount);
    }
}

async function scheduleRejoin(guildId, channelId, duration, rejoin, delay, randomDelay, amount) {
    if (shouldStop) return;
    setTimeout(() => {
        if (rejoin > 0) {
            if (shouldStop) return;
            executeVoiceChannelAction(guildId, channelId, duration, rejoin, delay, randomDelay, amount);
        }
    }, 400);
}

function initializeWebSockets() {
    if (typeof webSockets === "undefined") {
        webSockets = [];
    }
    currentTokens.forEach((token, index) => {
        const existingSocket = webSockets[index];
        if (existingSocket && existingSocket.readyState === WebSocket.OPEN) {
            return;
        }
        const socket = new WebSocket(DISCORD_GATEWAY);
        const heartbeatInterval = { id: null as null | NodeJS.Timeout };
        const sequenceNumber = { seq: null as null | number };

        socket.onmessage = event => {
            const message = JSON.parse(event.data);
            const { op, d, s } = message;
            if (s !== undefined && s !== null) {
                sequenceNumber.seq = s;
            }
            if (op === 10) {
                const heartbeatTime = d.heartbeat_interval;
                heartbeatInterval.id = setInterval(() => {
                    const heartbeatPayload = { op: 1, d: sequenceNumber.seq === null ? null : sequenceNumber.seq };
                    if (socket.readyState === WebSocket.OPEN) {
                        socket.send(JSON.stringify(heartbeatPayload));
                    }
                }, heartbeatTime);
                const identifyPayload = {
                    op: 2,
                    d: {
                        token: token,
                        properties: {
                            $os: "windows",
                            $browser: "Discord",
                            $device: "desktop"
                        },
                        capabilities: 16381,
                        presence: {
                            activities: [],
                            status: "unknown",
                            since: 0,
                            afk: false
                        },
                        client_state: {
                            api_code_version: 0,
                            guild_versions: {}
                        }
                    }
                };
                if (shouldStop) return;
                socket.send(JSON.stringify(identifyPayload));
            }
            if (op === 11) {
                if (shouldStop) return;
                console.log("heartbeat acknowledged");
            }
        };
        socket.onclose = () => {
            if (heartbeatInterval.id !== null) {
                clearInterval(heartbeatInterval.id);
            }
        };
        webSockets[index] = socket;
    });
}

function closeWebSockets() {
    shouldStop = true;
    for (const socket of webSockets) {
        socket.close();
    }
    webSockets = [];
}

let selectedGuildId = "";
let selectedChannelId = "";

function stopExecution() {
    shouldStop = true;
    Toasts.show({
        message: "Stopping VC Raper successfully.",
        id: "stop",
        type: Toasts.Type.FAILURE,
        options: {
            position: Toasts.Position.BOTTOM
        }
    });
    console.log("stopped vc raper");
}

function VCRaperModal(props) {
    const [duration, setDuration] = React.useState(50);
    const [rejoin, setRejoin] = React.useState(5);
    const [delay, setDelay] = React.useState(5000);
    const [randomDelay, setRandomDelay] = React.useState(100);
    const [amount, setAmount] = React.useState(0);

    const connectWebSockets = () => { initializeWebSockets(); };
    const forceStop = () => { stopExecution(); };

    React.useEffect(() => {
        connectWebSockets();
        loadTokensFromStorage();
        shouldStop = false;
        return closeWebSockets;
    }, []);

    return (
        <ModalRoot {...props} size={ModalSize.DYNAMIC}>
            <ModalHeader>
                <div style={{ display: "flex", alignItems: "center", padding: "0 5px" }}>
                    <Forms.FormTitle tag="h4" style={{ color: "#ffffff", fontSize: "20px", fontWeight: "600", margin: 0 }}>
                        VC Raper Control Panel
                    </Forms.FormTitle>
                    <div style={{ backgroundColor: "#059669", padding: "6px 16px", borderRadius: "20px", fontSize: "14px", marginLeft: "auto" }}>
                        <span style={{ color: "#ffffff", fontWeight: "500" }}>Connected: {getConnectionCount()}</span>
                    </div>
                </div>
            </ModalHeader>
            <ModalContent>
                {/* Control Panel */}
                <div style={{
                    backgroundColor: "transparent",
                    padding: "20px",
                    borderRadius: "12px",
                    marginBottom: "20px",
                    border: "1px solid #334155"
                }}>
                    <div style={{
                        color: "#94a3b8",
                        fontSize: "14px",
                        fontWeight: "600",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        marginBottom: "16px",
                        paddingBottom: "8px",
                        borderBottom: "1px solid #334155"
                    }}>
                        System Controls
                    </div>
                    <div style={{ display: "flex", gap: "12px" }}>
                        <Button onClick={connectWebSockets} style={modalStyles.devButton}>
                            🔌 CONNECT WEBSOCKET (DEBUG)
                        </Button>
                        <Button onClick={forceStop} style={modalStyles.stop}>
                            🛑 FORCE STOP
                        </Button>
                    </div>
                </div>

                {/* Configuration Grid */}
                <div style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "20px",
                    marginBottom: "20px"
                }}>
                    <div style={{
                        backgroundColor: "transparent",
                        padding: "20px",
                        borderRadius: "12px",
                        border: "1px solid #334155"
                    }}>
                        <div style={{
                            color: "#94a3b8",
                            fontSize: "14px",
                            fontWeight: "600",
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                            marginBottom: "16px",
                            paddingBottom: "8px",
                            borderBottom: "1px solid #334155"
                        }}>
                            Timing Configuration
                        </div>

                        <div style={{ marginBottom: "16px" }}>
                            <label style={{
                                display: "block",
                                color: "#e2e8f0",
                                fontSize: "13px",
                                fontWeight: "500",
                                marginBottom: "6px"
                            }}>
                                Duration (ms)
                            </label>
                            <TextInput
                                style={{
                                    width: "100%",
                                    backgroundColor: "#0f172a",
                                    border: "1px solid #475569",
                                    borderRadius: "6px",
                                    color: "#ffffff",
                                    fontSize: "14px"
                                }}
                                value={duration.toString()}
                                placeholder="How long to stay in VC"
                                onChange={value => setDuration(Number(value))}
                            />
                            <span style={{
                                display: "block",
                                color: "#64748b",
                                fontSize: "11px",
                                marginTop: "4px",
                                fontStyle: "italic"
                            }}>
                                Time spent in voice channel
                            </span>
                        </div>

                        <div style={{ marginBottom: "16px" }}>
                            <label style={{
                                display: "block",
                                color: "#e2e8f0",
                                fontSize: "13px",
                                fontWeight: "500",
                                marginBottom: "6px"
                            }}>
                                Delay (ms)
                            </label>
                            <TextInput
                                style={{
                                    width: "100%",
                                    backgroundColor: "#0f172a",
                                    border: "1px solid #475569",
                                    borderRadius: "6px",
                                    color: "#ffffff",
                                    fontSize: "14px"
                                }}
                                value={delay.toString()}
                                placeholder="Initial delay before action"
                                onChange={value => setDelay(Number(value))}
                            />
                            <span style={{
                                display: "block",
                                color: "#64748b",
                                fontSize: "11px",
                                marginTop: "4px",
                                fontStyle: "italic"
                            }}>
                                Wait time before joining
                            </span>
                        </div>
                    </div>

                    <div style={{
                        backgroundColor: "transparent",
                        padding: "20px",
                        borderRadius: "12px",
                        border: "1px solid #334155"
                    }}>
                        <div style={{
                            color: "#94a3b8",
                            fontSize: "14px",
                            fontWeight: "600",
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                            marginBottom: "16px",
                            paddingBottom: "8px",
                            borderBottom: "1px solid #334155"
                        }}>
                            Behavior Settings
                        </div>

                        <div style={{ marginBottom: "16px" }}>
                            <label style={{
                                display: "block",
                                color: "#e2e8f0",
                                fontSize: "13px",
                                fontWeight: "500",
                                marginBottom: "6px"
                            }}>
                                Rejoin Count
                            </label>
                            <TextInput
                                style={{
                                    width: "100%",
                                    backgroundColor: "#0f172a",
                                    border: "1px solid #475569",
                                    borderRadius: "6px",
                                    color: "#ffffff",
                                    fontSize: "14px"
                                }}
                                value={rejoin.toString()}
                                placeholder="Number of rejoins"
                                onChange={value => setRejoin(Number(value))}
                            />
                            <span style={{
                                display: "block",
                                color: "#64748b",
                                fontSize: "11px",
                                marginTop: "4px",
                                fontStyle: "italic"
                            }}>
                                How many times to rejoin
                            </span>
                        </div>

                        <div style={{ marginBottom: "16px" }}>
                            <label style={{
                                display: "block",
                                color: "#e2e8f0",
                                fontSize: "13px",
                                fontWeight: "500",
                                marginBottom: "6px"
                            }}>
                                Random Delay (ms)
                            </label>
                            <TextInput
                                style={{
                                    width: "100%",
                                    backgroundColor: "#0f172a",
                                    border: "1px solid #475569",
                                    borderRadius: "6px",
                                    color: "#ffffff",
                                    fontSize: "14px"
                                }}
                                value={randomDelay.toString()}
                                placeholder="Randomization factor"
                                onChange={value => setRandomDelay(Number(value))}
                            />
                            <span style={{
                                display: "block",
                                color: "#64748b",
                                fontSize: "11px",
                                marginTop: "4px",
                                fontStyle: "italic"
                            }}>
                                Random variation in timing
                            </span>
                        </div>
                    </div>
                </div>

                {/* Bot Count Section */}
                <div style={{
                    backgroundColor: "transparent",
                    padding: "20px",
                    borderRadius: "12px",
                    border: "1px solid #334155"
                }}>
                    <div style={{
                        color: "#94a3b8",
                        fontSize: "14px",
                        fontWeight: "600",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        marginBottom: "16px",
                        paddingBottom: "8px",
                        borderBottom: "1px solid #334155"
                    }}>
                        Deployment
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                        <label style={{
                            color: "#e2e8f0",
                            fontSize: "13px",
                            fontWeight: "500"
                        }}>
                            Bot Count
                        </label>
                        <TextInput
                            style={{
                                width: "120px",
                                backgroundColor: "#0f172a",
                                border: "1px solid #475569",
                                borderRadius: "6px",
                                color: "#ffffff",
                                fontSize: "14px",
                                textAlign: "center"
                            }}
                            value={amount.toString()}
                            placeholder="Number of bots"
                            onChange={value => setAmount(Number(value))}
                        />
                        <div style={{
                            backgroundColor: "#0f172a",
                            padding: "8px 16px",
                            borderRadius: "6px",
                            border: "1px solid #475569"
                        }}>
                            <span style={{
                                color: "#059669",
                                fontSize: "13px",
                                fontWeight: "500"
                            }}>
                                {amount} bots ready
                            </span>
                        </div>
                    </div>
                </div>
            </ModalContent>
            <ModalFooter>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                    <Button
                        onClick={() => {
                            closeWebSockets();
                            props.onClose();
                        }}
                        style={{
                            backgroundColor: "#dc2626",
                            color: "#ffffff",
                            padding: "12px 28px",
                            fontSize: "16px",
                            fontWeight: "600",
                            borderRadius: "6px",
                            border: "none",
                            boxShadow: "0 4px 12px rgba(150, 5, 5, 0.25)"
                        }}
                    >
                        CANCEL
                    </Button>
                    <Button
                        style={{
                            ...modalStyles.confirmbutton,
                            padding: "12px 28px",
                            fontSize: "16px",
                            fontWeight: "600",
                            boxShadow: "0 4px 12px rgba(5, 150, 105, 0.25)"
                        }}
                        onClick={() => {
                            executeVoiceChannelAction(selectedGuildId, selectedChannelId, duration, rejoin, delay, randomDelay, amount);
                        }}
                    >
                        RAPE VC
                    </Button>

                </div>
            </ModalFooter>
        </ModalRoot>
    );
}

const modalStyles: {
    button: CSSProperties;
    devButton: CSSProperties;
    stop: CSSProperties;
    confirmbutton: CSSProperties;
} = {
    button: {
        fontSize: "18px",
        padding: "15px 25px",
        backgroundColor: "#0ea5e9",
        marginBottom: "10px",
        color: "white",
        border: "none",
        borderRadius: "10px",
        boxShadow: "0 4px 6px rgba(0, 0, 0, 0.2)",
        transition: "transform 0.2s, background-color 0.2s",
        width: "400px",
        textAlign: "center"
    },
    devButton: {
        fontSize: "18px",
        padding: "15px 25px",
        backgroundColor: "#b43d39ff",
        marginBottom: "10px",
        color: "white",
        border: "none",
        borderRadius: "10px",
        boxShadow: "0 4px 6px rgba(0, 0, 0, 0.2)",
        transition: "transform 0.2s, background-color 0.2s",
        width: "400px",
        textAlign: "center"
    },
    stop: {
        fontSize: "18px",
        padding: "15px 25px",
        backgroundColor: "#dc2626",
        marginBottom: "10px",
        color: "white",
        border: "none",
        borderRadius: "10px",
        boxShadow: "0 4px 6px rgba(0, 0, 0, 0.2)",
        transition: "transform 0.2s, background-color 0.2s",
        width: "250px",
        textAlign: "center"
    },
    confirmbutton: {
        backgroundColor: "#059669",
        color: "white",
        border: "none",
        borderRadius: "10px",
        boxShadow: "0 4px 6px rgba(0, 0, 0, 0.2)",
        transition: "transform 0.2s, background-color 0.2s",
        textAlign: "center"
    }
};

function createVCMenuItem(guildId: string, id?: string) {
    return (
        <Menu.MenuItem
            id="VC-RAPER"
            label="RAPE VC"
            color="danger"
            action={() => {
                selectedGuildId = guildId;
                if (typeof id === "string") {
                    selectedChannelId = id;
                } else {
                    Toasts.show({
                        message: "Failed - channel not found",
                        id: "channel-fail",
                        type: Toasts.Type.FAILURE,
                        options: {
                            position: Toasts.Position.BOTTOM
                        }
                    });
                    selectedChannelId = "";
                }
                openModal(props => <VCRaperModal {...props} guildId={guildId} userId={id} />);
            }}
        />
    );
}

function createContextMenuPatch(): NavContextMenuPatchCallback {
    return (children, props) => {
        if (!props) return;
        const menuGroup = findGroupChildrenByChildId(["mark-channel-read"], children);
        const menuItem = createVCMenuItem(props.guild.id, props.channel.id);
        if (!menuItem) return;
        if (menuGroup) menuGroup.push(menuItem);
    };
}
