/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton } from "@api/ChatButtons";
import { addChannelToolbarButton, addHeaderBarButton, ChannelToolbarButton, HeaderBarButton, removeChannelToolbarButton, removeHeaderBarButton } from "@api/HeaderBar";
import { DataStore } from "@api/index";
import { definePluginSettings } from "@api/Settings";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { TestcordDevs } from "@utils/constants";
import { getCurrentChannel, sendMessage } from "@utils/discord";
import { sleep as wait } from "@utils/misc";
import { useForceUpdater } from "@utils/react";
import definePlugin, { OptionType } from "@utils/types";
import { Button, React, TextInput } from "@webpack/common";

type MessageEntry = {
    id: string;
    message: string;
    delay: string;
};

let messageEntries: MessageEntry[] = [];
const MESSAGE_ENTRIES_KEY = "AutoMessageRepeater_messageEntries";

let isRepeating = false;
let activeTimers: NodeJS.Timeout[] = []; // Track all active timers for cleanup
const repeatListeners = new Set<() => void>();

// Logic for random sentence injection
let commandsSinceLastRandom = 0;
let targetCommandsForRandom = 0; // Will be set to a random number 1-5

function generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

// Expanded word list for more natural looking sentences
const DEFAULT_WORD_LIST = "the and or but if while at by for with from into during including until against among throughout despite towards upon concerning of to in for on with at by from into during including until against among throughout despite towards upon concerning also however therefore moreover besides meanwhile otherwise nevertheless thus hence accordingly regardless although though even though because since unless until while where whereas wherever whether if provided that assuming that in order to so as to about above across after against along among around at before behind below beneath beside between beyond by down during except for from in inside into like near of off on onto out over past since through throughout to toward under underneath until up upon with within without agree allow announce appear argue arrange ask assert assume attend avoid believe bind blow break build buy call care carry catch cause change check claim clean clear climb close collect come compare complain confirm connect consider consist contain continue contribute control cook count cover create cross cry cut damage dance decide declare define deliver describe desire destroy determine develop die disagree discover discuss distinguish do draw drink drive eat enjoy enter establish estimate evaluate exist expect explain express fall feed feel fight fill find finish fly fold forget forgive freeze get give go grow guess hang happen have hear help hide hit hold hope hunt hurry identify imagine imply include indicate inform injure insist intend interrupt introduce invest invite join jump keep kick kill know lack laugh lead learn leave lend let lie like listen live look lose love make manage mark match mean meet miss move name need notice offer open order own pass pay pick place plan play point prefer prepare present press produce promise protect prove pull push put raise reach read receive recognize record refer refuse relax release remain remember remove repair repeat replace reply report represent request require respect respond rest return reveal ring rise roll run rush save say see sell send separate serve shake share shine shoot show shut sing sit sleep slide smile speak stand start stay step stop study succeed suffer suggest supply support suppose survive suspect take talk teach tell think throw touch trade train travel treat trust try turn understand use visit wait walk want warn wash watch wear win wish wonder work worry write write";

// Parse delay string to milliseconds
function parseDelay(delayStr: string): number {
    const match = delayStr.match(/^(\d+)(ms|s|m|h)$/);
    if (!match) return 1000; // default 1s

    const value = parseInt(match[1]);
    const unit = match[2];

    switch (unit) {
        case "ms": return value;
        case "s": return value * 1000;
        case "m": return value * 60000;
        case "h": return value * 3600000;
        default: return 1000;
    }
}

// Generate random sentence from word list
function generateRandomSentence(wordList: string): string {
    const words = wordList.split(/\s+/).filter(w => w.length > 0);
    if (words.length === 0) return "Hello world";

    const sentenceLength = Math.floor(Math.random() * 5) + 4; // 4-8 words for better variety
    const sentence: string[] = [];

    for (let i = 0; i < sentenceLength; i++) {
        const randomWord = words[Math.floor(Math.random() * words.length)];
        sentence.push(randomWord);
    }

    // Capitalize first letter
    const text = sentence.join(" ");
    return text.charAt(0).toUpperCase() + text.slice(1) + ".";
}

const emitRepeaterChange = () => repeatListeners.forEach(listener => listener());

async function sendMessageEntry(entry: MessageEntry) {
    if (!isRepeating) return;

    const currentChannel = getCurrentChannel();
    if (!currentChannel) return;

    // 1. Send the main message
    try {
        await sendMessage(currentChannel.id, { content: entry.message });
    } catch (err) {
        console.error("AutoMessageRepeater: Failed to send message", err);
        return; // Don't proceed if main message failed
    }

    // 2. Handle Random Sentence Injection
    const { randomWordsEnabled, wordList } = settings.store;
    if (randomWordsEnabled) {
        commandsSinceLastRandom++;

        if (commandsSinceLastRandom >= targetCommandsForRandom) {
            // Wait 500ms as requested
            await wait(500);

            try {
                const randomSentence = generateRandomSentence(wordList || DEFAULT_WORD_LIST);
                await sendMessage(currentChannel.id, { content: randomSentence });
            } catch (err) {
                console.error("AutoMessageRepeater: Failed to send random sentence", err);
            }

            // Reset counter and pick a new random target (1-5)
            commandsSinceLastRandom = 0;
            targetCommandsForRandom = Math.floor(Math.random() * 5) + 1;
        }
    }
}

function scheduleNextMessage(entry: MessageEntry) {
    if (!isRepeating) return;

    // Calculate the specific delay for THIS entry
    let delay = parseDelay(entry.delay);

    // Apply variable delay if enabled
    const { variableDelayEnabled } = settings.store;
    if (variableDelayEnabled) {
        const variation = Math.floor(Math.random() * 51) - 25; // -25 to +25 ms
        delay += variation;
        delay = Math.max(100, delay); // minimum 100ms
    }

    const timerId = setTimeout(async () => {
        // Drop this fired handle so activeTimers only holds still-pending timers, not every timer ever created
        activeTimers = activeTimers.filter(timer => timer !== timerId);
        await sendMessageEntry(entry);
        // Recursively schedule the next message for this specific entry
        scheduleNextMessage(entry);
    }, delay);

    activeTimers.push(timerId);
}

async function startRepeating() {
    if (isRepeating) return; // Already running
    if (messageEntries.length === 0) return;

    const currentChannel = getCurrentChannel();
    if (!currentChannel) return;

    isRepeating = true;
    emitRepeaterChange();
    activeTimers = [];
    commandsSinceLastRandom = 0;
    targetCommandsForRandom = Math.floor(Math.random() * 5) + 1; // Initial random target

    // 1. Initial Burst: Send all messages immediately, staggered by 100ms
    messageEntries.forEach((entry, index) => {
        const initialDelay = index * 100; // 0ms, 100ms, 200ms...

        const timerId = setTimeout(async () => {
            activeTimers = activeTimers.filter(timer => timer !== timerId);
            await sendMessageEntry(entry);
            // 2. After the initial send, start the individual timer loop for this entry
            scheduleNextMessage(entry);
        }, initialDelay);

        activeTimers.push(timerId);
    });
}

function stopRepeating() {
    isRepeating = false;
    emitRepeaterChange();
    // Clear all running timers
    activeTimers.forEach(timer => clearTimeout(timer));
    activeTimers = [];
    commandsSinceLastRandom = 0;
}

async function addMessageEntry(forceUpdate: () => void) {
    try {
        messageEntries.push({
            id: generateId(),
            message: "Hello!",
            delay: "1s"
        });
        await DataStore.set(MESSAGE_ENTRIES_KEY, messageEntries);
        forceUpdate();
    } catch (error) {
        console.error("AutoMessageRepeater: Failed to add message entry:", error);
    }
}

async function removeMessageEntry(id: string, forceUpdate: () => void) {
    try {
        const index = messageEntries.findIndex(entry => entry.id === id);
        if (index !== -1) {
            messageEntries.splice(index, 1);
            await DataStore.set(MESSAGE_ENTRIES_KEY, messageEntries);
            forceUpdate();
        }
    } catch (error) {
        console.error("AutoMessageRepeater: Failed to remove message entry:", error);
    }
}

async function resetAllMessages(forceUpdate: () => void) {
    try {
        messageEntries.length = 0;
        await DataStore.set(MESSAGE_ENTRIES_KEY, []);
        forceUpdate();
    } catch (error) {
        console.error("AutoMessageRepeater: Failed to reset messages:", error);
    }
}

function MessageEntries() {
    const update = useForceUpdater();

    React.useEffect(() => {
        const loadEntries = async () => {
            try {
                const storedEntries = await DataStore.get(MESSAGE_ENTRIES_KEY) ?? [];
                messageEntries = storedEntries;
                update();
            } catch (error) {
                console.error("AutoMessageRepeater: Failed to load entries:", error);
            }
        };
        loadEntries();
    }, []);

    function setMessage(id: string, value: string) {
        const index = messageEntries.findIndex(entry => entry.id === id);
        if (index !== -1) {
            messageEntries[index].message = value;
            update();
        }
    }

    function setDelay(id: string, value: string) {
        const index = messageEntries.findIndex(entry => entry.id === id);
        if (index !== -1) {
            messageEntries[index].delay = value;
            update();
        }
    }

    async function saveEntries() {
        try {
            await DataStore.set(MESSAGE_ENTRIES_KEY, messageEntries);
        } catch (error) {
            console.error("AutoMessageRepeater: Failed to save messages:", error);
        }
    }

    const elements = messageEntries.map((entry, i) => {
        return (
            <div key={entry.id} style={{ marginBottom: "16px", padding: "12px", border: "1px solid var(--background-modifier-accent)", borderRadius: "4px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                    <Heading>Message {i + 1}</Heading>
                    <Button
                        onClick={() => removeMessageEntry(entry.id, update)}
                        look={Button.Looks.FILLED}
                        color={Button.Colors.RED}
                        size={Button.Sizes.SMALL}
                    >
                        Delete
                    </Button>
                </div>

                <div style={{ marginBottom: "8px" }}>
                    <Paragraph>Message to Send</Paragraph>
                    <TextInput
                        placeholder="Enter message or command"
                        value={entry.message}
                        onChange={e => setMessage(entry.id, e)}
                        onBlur={saveEntries}
                    />
                </div>

                <div>
                    <Paragraph>Delay (e.g., 1ms, 1s, 1m, 1h)</Paragraph>
                    <TextInput
                        placeholder="1s"
                        value={entry.delay}
                        onChange={e => setDelay(entry.id, e)}
                        onBlur={saveEntries}
                    />
                </div>
            </div>
        );
    });

    return (
        <>
            {elements}
            <div style={{ display: "flex", gap: "8px", marginTop: "16px" }}>
                <Button onClick={() => addMessageEntry(update)}>Add Message</Button>
                <Button
                    onClick={() => resetAllMessages(update)}
                    look={Button.Looks.FILLED}
                    color={Button.Colors.RED}
                >
                    Reset All
                </Button>
            </div>
        </>
    );
}

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
    messages: {
        type: OptionType.COMPONENT,
        description: "Manage your auto-repeat messages",
        component: () => <MessageEntries />
    },
    variableDelayEnabled: {
        type: OptionType.BOOLEAN,
        description: "Add random delay variation (±25ms) to avoid detection",
        default: true
    },
    randomWordsEnabled: {
        type: OptionType.BOOLEAN,
        description: "Insert random sentences as separate messages every 1-5 commands",
        default: false
    },
    wordList: {
        type: OptionType.STRING,
        description: "Space-separated list of words for random sentences",
        default: DEFAULT_WORD_LIST,
        placeholder: "Enter words separated by spaces"
    }
});

// Icons for the chat bar button
const StartRepeaterIcon: React.FC<{ className?: string; }> = ({ className }) => (
    <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        className={className}
    >
        <path
            fill="currentColor"
            d="M8 5v14l11-7z"
        />
    </svg>
);

const StopRepeaterIcon: React.FC<{ className?: string; }> = ({ className }) => (
    <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        className={className}
    >
        <path
            fill="currentColor"
            d="M6 6h12v12H6z"
        />
    </svg>
);

export default definePlugin({
    name: "AutoMessageRepeater",
    description: "Automatically repeat messages/commands with customizable delays and anti-detection features",
    tags: ["Chat", "Utility"],
    authors: [TestcordDevs.x2b],
    dependencies: ["HeaderBarAPI"],
    settings,

    chatBarButton: {
        icon: StartRepeaterIcon as any,
        render: (({ isMainChat }) => {
        const [isRunning, setIsRunning] = React.useState(isRepeating);

        React.useEffect(() => {
            const listener = () => setIsRunning(isRepeating);
            repeatListeners.add(listener);
            return () => void repeatListeners.delete(listener);
        }, []);

        if (!isMainChat || settings.store.location !== "chatbar") return null;
        return (
            <ChatBarButton
                tooltip={isRunning ? "Stop Auto Repeating" : "Start Auto Repeating"}
                onClick={() => {
                    if (isRunning) {
                        stopRepeating();
                    } else {
                        startRepeating();
                    }
                }}
            >
                {isRunning ? <StopRepeaterIcon /> : <StartRepeaterIcon />}
            </ChatBarButton>
        );
    }) as any,
    },

    async start() {
        const storedEntries = await DataStore.get(MESSAGE_ENTRIES_KEY) ?? [];
        messageEntries = storedEntries;
        const { location } = settings.store;
        if (location === "headerbar") {
            addHeaderBarButton("AutoMessageRepeater", () => (
                <HeaderBarButton
                    icon={StartRepeaterIcon}
                    tooltip="Auto Message Repeater"
                    onClick={() => { isRepeating ? stopRepeating() : startRepeating(); }}
                />
            ), 5);
        } else if (location === "channeltoolbar") {
            addChannelToolbarButton("AutoMessageRepeater", () => (
                <ChannelToolbarButton
                    icon={StartRepeaterIcon}
                    tooltip="Auto Message Repeater"
                    onClick={() => { isRepeating ? stopRepeating() : startRepeating(); }}
                />
            ), 5);
        }
    },

    stop() {
        stopRepeating();
        repeatListeners.clear();
        removeHeaderBarButton("AutoMessageRepeater");
        removeChannelToolbarButton("AutoMessageRepeater");
    }
});
