/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher } from "@webpack/common";

const settings = definePluginSettings({
    volume: {
        type: OptionType.SLIDER,
        description: "Volume of the animalese sound",
        default: 0.5,
        markers: [0, 0.25, 0.5, 0.75, 1],
    },
    speed: {
        type: OptionType.SLIDER,
        description: "Speed of the animalese sound",
        default: 1,
        markers: [0.5, 0.75, 1, 1.25, 1.5],
    },
});

let audioContext: AudioContext | null = null;
let currentChannelId: string | null = null;
const activeSources = new Set<AudioBufferSourceNode>();
const MAX_SOUND_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 10000;

// better than my old hardcoded garbage
const highSounds = Array.from(
    { length: 30 },
    (_, i) => `sound${String(i + 1).padStart(2, "0")}.wav`
);
const soundBuffers: Record<string, AudioBuffer> = {};

// todo implement other pitch sounds but theoretically plugging this in from said repo should work, right?
const BASE_URL_HIGH =
    "https://raw.githubusercontent.com/ryawaa/vencord-animalese/main/sounds/high";

async function initSoundBuffers() {
    if (!audioContext) audioContext = new AudioContext();
    for (const file of highSounds) {
        const nameWithoutExt = file.replace(".wav", "");
        soundBuffers[nameWithoutExt] = await loadSound(
            `${BASE_URL_HIGH}/${file}`
        );
    }
}

async function loadSound(url: string): Promise<AudioBuffer> {
    if (!audioContext) audioContext = new AudioContext();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error("Network response was not OK");
        const length = Number(response.headers.get("content-length"));
        if (length > MAX_SOUND_BYTES) throw new Error("Sound exceeds size limit");
        const arrayBuffer = await response.arrayBuffer();
        if (arrayBuffer.byteLength > MAX_SOUND_BYTES) throw new Error("Sound exceeds size limit");
        return audioContext.decodeAudioData(arrayBuffer);
    } finally {
        clearTimeout(timeout);
    }
}

async function generateAnimalese(text: string): Promise<AudioBuffer> {
    if (!audioContext) audioContext = new AudioContext();

    const soundIndices: string[] = [];
    const text_lower = text.toLowerCase();

    for (let i = 0; i < text_lower.length; i++) {
        const char = text_lower[i];
        if (char === "s" && text_lower[i + 1] === "h") {
            soundIndices.push("sound27");
            i++;
        } else if (char === "t" && text_lower[i + 1] === "h") {
            soundIndices.push("sound28");
            i++;
        } else if (
            char === "h" &&
            (text_lower[i - 1] === "s" || text_lower[i - 1] === "t")
        ) {
            continue;
        } else if (char === "," || char === "?") {
            soundIndices.push("sound30");
        } else if (char === text_lower[i - 1]) {
            continue;
        } else if (char.match(/[a-z]/)) {
            const index = char.charCodeAt(0) - 96;
            soundIndices.push(`sound${String(index).padStart(2, "0")}`);
        }
    }

    const totalDuration = soundIndices.length * 0.1;
    const outputBuffer = audioContext.createBuffer(
        1,
        audioContext.sampleRate * totalDuration,
        audioContext.sampleRate
    );
    const outputData = outputBuffer.getChannelData(0);

    let offset = 0;
    for (let i = 0; i < soundIndices.length; i++) {
        const soundIndex = soundIndices[i];
        const buffer = soundBuffers[soundIndex];
        if (!buffer) continue;

        const variation = 0.15;
        let pitchShift = 2.8 + Math.random() * variation;

        const isQuestion = text_lower.endsWith("?");
        if (isQuestion && i >= soundIndices.length * 0.8) {
            const progress =
                (i - soundIndices.length * 0.8) / (soundIndices.length * 0.2);
            pitchShift += progress * 0.1 + 0.1;
        }

        const inputData = buffer.getChannelData(0);
        const inputLength = inputData.length;
        const outputLength = Math.floor(inputLength / pitchShift);

        for (let j = 0; j < outputLength; j++) {
            const inputIndex = Math.floor(j * pitchShift);
            if (inputIndex < inputLength && offset + j < outputData.length) {
                outputData[offset + j] = inputData[inputIndex];
            }
        }
        offset += outputLength;
    }

    return outputBuffer;
}

async function playSound(buffer: AudioBuffer, volume: number) {
    if (!audioContext) audioContext = new AudioContext();
    const source = audioContext.createBufferSource();
    const gainNode = audioContext.createGain();

    source.buffer = buffer;
    gainNode.gain.value = volume;

    source.connect(gainNode);
    gainNode.connect(audioContext.destination);

    activeSources.add(source);
    source.onended = () => activeSources.delete(source);
    source.start();
}

export default definePlugin({
    name: "Animalese",
    description: "Plays animalese (they yap a lot) on message sent",
    tags: ["Fun"],
    authors: [TestcordDevs.x2b],
    settings,

    start() {
        // Only subscribe once!
        this._clickInit = async () => {
            if (!audioContext) {
                audioContext = new AudioContext();
                await initSoundBuffers();
            }
            document.removeEventListener("click", this._clickInit);
        };
        document.addEventListener("click", this._clickInit);

        this.channelSelectListener = ({ channelId }) => {
            currentChannelId = channelId;
        };
        FluxDispatcher.subscribe("CHANNEL_SELECT", this.channelSelectListener);

        this.messageCreateListener = async ({ optimistic, type, message }) => {
            // DO NOT REMOVE THIS OR EELSE IT WILL BE YAP CENTRAL
            if (optimistic || type !== "MESSAGE_CREATE") return;

            if (
                !message?.content ||
                message.author?.bot ||
                message.channel_id !== currentChannelId
            ) {
                return;
            }

            try {
                const buffer = await generateAnimalese(message.content.slice(0, 200));
                await playSound(buffer, settings.store.volume);
            } catch (err) {
                console.error("[Animalese]", err);
            }
        };
        FluxDispatcher.subscribe("MESSAGE_CREATE", this.messageCreateListener);
    },

    stop() {
        document.removeEventListener("click", this._clickInit);
        delete this._clickInit;
        FluxDispatcher.unsubscribe(
            "CHANNEL_SELECT",
            this.channelSelectListener
        );
        FluxDispatcher.unsubscribe(
            "MESSAGE_CREATE",
            this.messageCreateListener
        );
        if (audioContext) {
            for (const source of activeSources) {
                try {
                    source.stop();
                } catch {
                    continue;
                }
            }
            activeSources.clear();
            audioContext.close();
            audioContext = null;
        }
        for (const key of Object.keys(soundBuffers)) delete soundBuffers[key];
        currentChannelId = null;
    },
});
