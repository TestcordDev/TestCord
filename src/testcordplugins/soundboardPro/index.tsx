/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { playAudio } from "@api/AudioPlayer";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { BaseText } from "@components/BaseText";
import { Flex } from "@components/Flex";
import { TestcordDevs } from "@utils/constants";
import {
    ModalCloseButton,
    ModalContent,
    ModalFooter,
    ModalHeader,
    ModalProps,
    ModalRoot,
    ModalSize,
    openModal,
} from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { findComponentByCodeLazy } from "@webpack";
import { Button, React, useRef, useState } from "@webpack/common";

// Types for sounds
interface Sound {
    id: string;
    name: string;
    emoji: string;
    frequency: number;
    duration: number;
    type: OscillatorType;
    url?: string; // Optional for custom sounds
    fileData?: ArrayBuffer; // File data for local sounds
    fileType?: string; // MIME type of the file
}

// Predefined sounds with real URLs and synthetic fallback parameters
const DEFAULT_SOUNDS: Sound[] = [
    {
        id: "bruh",
        name: "Bruh",
        emoji: "😤",
        frequency: 150,
        duration: 0.8,
        type: "sawtooth",
        url: "https://www.myinstants.com/media/sounds/bruh-sound-effect.mp3",
    },
    {
        id: "oof",
        name: "Oof",
        emoji: "💀",
        frequency: 200,
        duration: 0.3,
        type: "square",
        url: "https://www.myinstants.com/media/sounds/roblox-death-sound_1.mp3",
    },
    {
        id: "vine_boom",
        name: "Vine Boom",
        emoji: "💥",
        frequency: 60,
        duration: 1.0,
        type: "sine",
        url: "https://www.myinstants.com/media/sounds/vine-boom.mp3",
    },
    {
        id: "discord_notification",
        name: "Discord Notification",
        emoji: "🔔",
        frequency: 800,
        duration: 0.2,
        type: "sine",
        url: "https://discord.com/assets/0a6c6b8b8b8b8b8b8b8b8b8b8b8b8b8b.mp3",
    },
    {
        id: "air_horn",
        name: "Air Horn",
        emoji: "📯",
        frequency: 300,
        duration: 1.5,
        type: "sawtooth",
        url: "https://www.myinstants.com/media/sounds/air-horn.mp3",
    },
    {
        id: "sad_trombone",
        name: "Sad Trombone",
        emoji: "🎺",
        frequency: 200,
        duration: 1.2,
        type: "triangle",
        url: "https://www.myinstants.com/media/sounds/sad-trombone.mp3",
    },
    {
        id: "wilhelm_scream",
        name: "Wilhelm Scream",
        emoji: "😱",
        frequency: 800,
        duration: 2.0,
        type: "sawtooth",
        url: "https://www.myinstants.com/media/sounds/wilhelm-scream.mp3",
    },
    {
        id: "crickets",
        name: "Crickets",
        emoji: "🦗",
        frequency: 4000,
        duration: 0.1,
        type: "square",
        url: "https://www.myinstants.com/media/sounds/crickets.mp3",
    },
    {
        id: "bell",
        name: "Bell",
        emoji: "🔔",
        frequency: 1000,
        duration: 0.5,
        type: "sine",
        url: "https://www.myinstants.com/media/sounds/bell.mp3",
    },
    {
        id: "buzzer",
        name: "Buzzer",
        emoji: "🚨",
        frequency: 500,
        duration: 0.4,
        type: "square",
        url: "https://www.myinstants.com/media/sounds/buzzer.mp3",
    },
    {
        id: "pop",
        name: "Pop",
        emoji: "💨",
        frequency: 2000,
        duration: 0.1,
        type: "sine",
        url: "https://www.myinstants.com/media/sounds/pop.mp3",
    },
    {
        id: "whoosh",
        name: "Whoosh",
        emoji: "💨",
        frequency: 100,
        duration: 0.8,
        type: "sawtooth",
        url: "https://www.myinstants.com/media/sounds/whoosh.mp3",
    },
];

const settings = definePluginSettings({
    enableSoundboard: {
        type: OptionType.BOOLEAN,
        description: "Enable Soundboard Pro",
        default: true,
    },
    volume: {
        type: OptionType.SLIDER,
        description: "Sound volume (0-100%)",
        default: 50,
        markers: [0, 25, 50, 75, 100],
        stickToMarkers: false,
    },
    enableCustomSounds: {
        type: OptionType.BOOLEAN,
        description: "Allow adding custom sounds",
        default: true,
    },
    bypassPermissions: {
        type: OptionType.BOOLEAN,
        description: "Bypass Discord restrictions",
        default: true,
    },
    forceDiscordAPI: {
        type: OptionType.BOOLEAN,
        description:
            "Force Discord API for all sounds (recommended for voice channel)",
        default: true,
    },
    soundMode: {
        type: OptionType.SELECT,
        description: "Sound playback mode",
        options: [
            { label: "Synthetic only", value: "synthetic" },
            { label: "URL + Synthetic (fallback)", value: "hybrid" },
            { label: "URL only (real sounds)", value: "url" },
        ],
        default: "hybrid",
    },
});

// Function to play a synthetic sound
function playSyntheticSound(sound: Sound) {
    try {
        const audioContext = new (window.AudioContext ||
            (window as any).webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.frequency.setValueAtTime(
            sound.frequency,
            audioContext.currentTime
        );
        oscillator.type = sound.type;

        gainNode.gain.setValueAtTime(
            settings.store.volume / 100,
            audioContext.currentTime
        );
        gainNode.gain.exponentialRampToValueAtTime(
            0.01,
            audioContext.currentTime + sound.duration
        );

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + sound.duration);
        oscillator.onended = () => void audioContext.close();

        return true;
    } catch (error) {
        console.error("[SoundboardPro] Synthetic error:", error);
        return false;
    }
}

// Function to play a sound from URL
async function playUrlSound(sound: Sound) {
    let audioContext: AudioContext | undefined;
    try {
        if (!sound.url) return false;

        audioContext = new (window.AudioContext ||
            (window as any).webkitAudioContext)();
        const response = await fetch(sound.url, {
            mode: "cors",
            credentials: "omit",
        });

        if (!response.ok) {
            void audioContext.close();
            return false;
        }

        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        const source = audioContext.createBufferSource();
        const gainNode = audioContext.createGain();

        source.buffer = audioBuffer;
        source.connect(gainNode);
        gainNode.connect(audioContext.destination);

        gainNode.gain.setValueAtTime(
            settings.store.volume / 100,
            audioContext.currentTime
        );

        source.start();
        source.onended = () => void audioContext?.close();

        return true;
    } catch (error) {
        void audioContext?.close();
        console.error("[SoundboardPro] URL error:", error);
        return false;
    }
}

// Function to play a local audio file in Discord
function playLocalAudioFileInDiscord(fileUrl: string, volume: number = 0.5) {
    return new Promise<boolean>(resolve => {
        try {
            // Try first with the Discord API
            try {
                playAudio(fileUrl, {
                    volume: volume,
                    persistent: false,
                });
                console.log("[SoundboardPro] Audio file played via Discord API");
                resolve(true);
            } catch (discordError) {
                console.log(
                    "[SoundboardPro] Discord API failed, attempting with native Audio:",
                    discordError
                );

                // Fallback to native Audio API
                const audio = new Audio(fileUrl);
                audio.volume = volume / 100; // Convert from 0-100 to 0-1
                audio.preload = "auto";

                audio.oncanplaythrough = () => {
                    console.log("[SoundboardPro] Audio file ready to play (native)");
                    audio
                        .play()
                        .then(() => {
                            console.log(
                                "[SoundboardPro] Audio file played successfully (native)"
                            );
                            resolve(true);
                        })
                        .catch(error => {
                            console.error(
                                "[SoundboardPro] Error during file playback (native):",
                                error
                            );
                            resolve(false);
                        });
                };

                audio.onerror = error => {
                    console.error(
                        "[SoundboardPro] Error loading audio file (native):",
                        error
                    );
                    resolve(false);
                };

                // Load the file
                audio.load();
            }
        } catch (error) {
            console.error(
                "[SoundboardPro] Error creating audio:",
                error
            );
            resolve(false);
        }
    });
}

// Main function to play a sound
async function playSound(sound: Sound) {
    let success = false;

    try {
        // Check if it's a local file (blob URL)
        const isLocalFile = sound.url?.startsWith("blob:") || false;

        if (isLocalFile && sound.url && !settings.store.forceDiscordAPI) {
            // For local files, try Discord API first, then native fallback
            console.log("[SoundboardPro] Playing a local file:", sound.name);
            success = await playLocalAudioFileInDiscord(
                sound.url,
                settings.store.volume
            );
        } else {
            // For external URLs or if forceDiscordAPI is enabled
            if (settings.store.forceDiscordAPI && sound.url) {
                // Force Discord API for all sounds
                try {
                    playAudio(sound.url, {
                        volume: settings.store.volume,
                        persistent: false,
                    });
                    success = true;
                    console.log(
                        "[SoundboardPro] Sound played via Discord API (forced):",
                        sound.name
                    );
                } catch (error) {
                    console.error("[SoundboardPro] Discord API error (forced):", error);
                    success = false;
                }
            } else {
                // Normal logic based on mode
                switch (settings.store.soundMode) {
                    case "synthetic":
                        success = playSyntheticSound(sound);
                        break;

                    case "url":
                        if (sound.url) {
                            try {
                                playAudio(sound.url, {
                                    volume: settings.store.volume,
                                    persistent: false,
                                });
                                success = true;
                            } catch (error) {
                                console.error("[SoundboardPro] Discord API error:", error);
                                success = false;
                            }
                        }
                        break;

                    case "hybrid":
                        if (sound.url) {
                            try {
                                playAudio(sound.url, {
                                    volume: settings.store.volume,
                                    persistent: false,
                                });
                                success = true;
                            } catch (error) {
                                console.error(
                                    "[SoundboardPro] Discord API error, synthetic fallback:",
                                    error
                                );
                                success = playSyntheticSound(sound);
                            }
                        } else {
                            success = playSyntheticSound(sound);
                        }
                        break;
                }
            }
        }

        if (success) {
            const isForcedDiscord = settings.store.forceDiscordAPI && sound.url;
            showNotification({
                title: "🔊 Soundboard Pro",
                body: `Sound "${sound.name}" played${isForcedDiscord
                    ? " in voice channel"
                    : isLocalFile
                        ? " (local file)"
                        : " in voice channel"
                    }`,
                color: "var(--green-360)",
            });
        } else {
            showNotification({
                title: "🔊 Soundboard Pro",
                body: `Error playing "${sound.name}"`,
                color: "var(--red-360)",
            });
        }
    } catch (error) {
        console.error("[SoundboardPro] General error:", error);
        showNotification({
            title: "🔊 Soundboard Pro",
            body: `Error playing "${sound.name}"`,
            color: "var(--red-360)",
        });
    }
}

// Component for the soundboard interface
function SoundboardModal({ modalProps }: { modalProps: ModalProps; }) {
    const [sounds, setSounds] = useState<Sound[]>(DEFAULT_SOUNDS);
    const [isPlaying, setIsPlaying] = useState<string | null>(null);
    const [customSoundUrl, setCustomSoundUrl] = useState("");
    const [customSoundName, setCustomSoundName] = useState("");
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handlePlaySound = async (sound: Sound) => {
        setIsPlaying(sound.id);
        await playSound(sound);
        setTimeout(() => setIsPlaying(null), 1000);
    };

    // Function to add a custom sound via URL
    const addCustomSound = () => {
        if (!customSoundUrl.trim() || !customSoundName.trim()) return;

        const newSound: Sound = {
            id: `custom_${Date.now()}`,
            name: customSoundName,
            emoji: "🎵",
            url: customSoundUrl,
            frequency: 440, // Default value
            duration: 1.0,
            type: "sine",
        };

        setSounds([...sounds, newSound]);
        setCustomSoundUrl("");
        setCustomSoundName("");

        showNotification({
            title: "🔊 Soundboard Pro",
            body: "Custom sound added!",
            color: "var(--green-360)",
        });
    };

    // Function to open the file selector
    const openFileSelector = () => {
        console.log("[SoundboardPro] openFileSelector called");
        if (fileInputRef.current) {
            console.log("[SoundboardPro] Clic sur l'input file");
            fileInputRef.current.click();
        } else {
            console.error("[SoundboardPro] fileInputRef.current est null");
        }
    };

    // Function to handle file selection
    const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
        console.log("[SoundboardPro] handleFileSelect called", event.target.files);
        const file = event.target.files?.[0];
        if (!file) {
            console.log("[SoundboardPro] No file selected");
            return;
        }

        console.log(
            "[SoundboardPro] File selected:",
            file.name,
            file.type,
            file.size
        );

        // Check that it's an audio file
        if (!file.type.startsWith("audio/")) {
            console.log("[SoundboardPro] Unsupported file type:", file.type);
            showNotification({
                title: "🔊 Soundboard Pro",
                body: "Please select an audio file (MP3, WAV, OGG, etc.)",
                color: "var(--red-360)",
            });
            return;
        }

        // Extract filename without extension
        const fileName = file.name.replace(/\.[^/.]+$/, "");

        // Convert file to ArrayBuffer for storage
        const reader = new FileReader();
        reader.onload = e => {
            const arrayBuffer = e.target?.result as ArrayBuffer;
            if (arrayBuffer) {
                const newSound: Sound = {
                    id: `file_${Date.now()}`,
                    name: fileName,
                    emoji: "🎵",
                    url: "", // No URL for local files
                    frequency: 440,
                    duration: 1.0,
                    type: "sine",
                    fileData: arrayBuffer, // Store file data
                    fileType: file.type,
                };

                setSounds([...sounds, newSound]);

                showNotification({
                    title: "🔊 Soundboard Pro",
                    body: `File "${fileName}" added to soundboard!`,
                    color: "var(--green-360)",
                });
            }
        };
        reader.readAsArrayBuffer(file);

        // Reset the input
        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }
    };

    return (
        <ModalRoot {...modalProps} size={ModalSize.LARGE}>
            <ModalHeader>
                <BaseText size="lg" weight="semibold" style={{ flexGrow: 1 }}>
                    🔊 Soundboard Pro - Permission Bypass
                </BaseText>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>

            <ModalContent>
                <BaseText
                    size="md"
                    style={{ marginBottom: "16px", color: "var(--text-muted)" }}
                >
                    Advanced soundboard with synthetic sounds and URL support. Bypasses
                    Discord restrictions.
                </BaseText>
                <BaseText
                    size="sm"
                    style={{ color: "var(--text-muted)", marginBottom: "16px" }}
                >
                    📁 = Local file • 🎵 = External URL • 🔊 = Currently playing
                </BaseText>

                {/* Predefined sounds */}
                <div style={{ marginBottom: "24px" }}>
                    <BaseText
                        size="md"
                        weight="semibold"
                        style={{ marginBottom: "12px" }}
                    >
                        🎵 Available Sounds ({sounds.length})
                    </BaseText>
                    <div
                        style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                            gap: "8px",
                        }}
                    >
                        {sounds.map(sound => {
                            const isLocalFile = sound.url?.startsWith("blob:") || false;
                            return (
                                <Button
                                    key={sound.id}
                                    onClick={() => handlePlaySound(sound)}
                                    disabled={isPlaying === sound.id}
                                    color={Button.Colors.PRIMARY}
                                    look={Button.Looks.FILLED}
                                    style={{
                                        height: "70px",
                                        display: "flex",
                                        flexDirection: "column",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        gap: "4px",
                                        border: isLocalFile ? "2px solid var(--green-360)" : "none",
                                    }}
                                >
                                    <span style={{ fontSize: "20px" }}>{sound.emoji}</span>
                                    <span style={{ fontSize: "11px" }}>{sound.name}</span>
                                    {isPlaying === sound.id && (
                                        <span style={{ fontSize: "10px" }}>🔊</span>
                                    )}
                                    {isLocalFile && (
                                        <span
                                            style={{ fontSize: "8px", color: "var(--green-360)" }}
                                        >
                                            📁
                                        </span>
                                    )}
                                    {sound.id.startsWith("custom_") && !isLocalFile && (
                                        <span
                                            style={{ fontSize: "8px", color: "var(--text-muted)" }}
                                        >
                                            🎵
                                        </span>
                                    )}
                                </Button>
                            );
                        })}
                    </div>
                </div>

                {/* Add custom sound */}
                {settings.store.enableCustomSounds && (
                    <div
                        style={{
                            borderTop: "1px solid var(--background-modifier-accent)",
                            paddingTop: "16px",
                        }}
                    >
                        <BaseText
                            size="md"
                            weight="semibold"
                            style={{ marginBottom: "12px" }}
                        >
                            ➕ Add a Custom Sound
                        </BaseText>

                        {/* Hidden file input */}
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="audio/*"
                            onChange={handleFileSelect}
                            style={{ display: "none" }}
                        />

                        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                            <Button
                                onClick={openFileSelector}
                                color={Button.Colors.BRAND}
                                size={Button.Sizes.SMALL}
                                style={{ width: "100%" }}
                            >
                                📁 Select an MP3 file
                            </Button>

                            <BaseText
                                size="sm"
                                style={{ color: "var(--text-muted)", textAlign: "center" }}
                            >
                                or
                            </BaseText>

                            {/* Add via URL */}
                            <input
                                type="text"
                                placeholder="Sound name"
                                value={customSoundName}
                                onChange={e => setCustomSoundName(e.target.value)}
                                style={{
                                    padding: "8px 12px",
                                    borderRadius: "4px",
                                    border: "1px solid var(--background-modifier-accent)",
                                    backgroundColor: "var(--input-background)",
                                    color: "var(--text-normal)",
                                    fontSize: "14px",
                                }}
                            />
                            <input
                                type="url"
                                placeholder="Audio file URL (MP3, WAV, OGG)"
                                value={customSoundUrl}
                                onChange={e => setCustomSoundUrl(e.target.value)}
                                style={{
                                    padding: "8px 12px",
                                    borderRadius: "4px",
                                    border: "1px solid var(--background-modifier-accent)",
                                    backgroundColor: "var(--input-background)",
                                    color: "var(--text-normal)",
                                    fontSize: "14px",
                                }}
                            />
                            <Button
                                onClick={addCustomSound}
                                disabled={!customSoundUrl.trim() || !customSoundName.trim()}
                                color={Button.Colors.GREEN}
                                size={Button.Sizes.SMALL}
                            >
                                Add via URL
                            </Button>
                        </div>
                    </div>
                )}
            </ModalContent>

            <ModalFooter>
                {React.createElement(Flex as any, { flexDirection: "row-reverse" },
                    React.createElement(Button as any, {
                        onClick: modalProps.onClose,
                        color: Button.Colors.PRIMARY,
                        look: Button.Looks.FILLED
                    }, "Close")
                )}
            </ModalFooter>
        </ModalRoot>
    );
}

// Function to open the soundboard modal
export function openSoundboardPro() {
    console.log("🔊 SoundboardPro: openSoundboardPro called");
    try {
        const modalKey = openModal(modalProps => React.createElement(SoundboardModal as any, { modalProps }));
        console.log("🔊 SoundboardPro: Modal opened with key:", modalKey);
    } catch (error) {
        console.error("🔊 SoundboardPro: Error opening modal:", error);
    }
}

// Button component for the voice panel (like fakeDeafen)
const PanelButton = findComponentByCodeLazy(".NONE,disabled:", ".PANEL_BUTTON");

function SoundboardIcon() {
    return (
        <img
            src="./src/bashplugins/soundboardPro/icone.webp"
            alt="Soundboard Pro"
            width="28"
            height="28"
            style={{
                borderRadius: "4px",
                objectFit: "cover",
            }}
        />
    );
}

function SoundboardButton() {
    return (
        <PanelButton
            tooltipText="Soundboard Pro"
            icon={SoundboardIcon}
            onClick={() => {
                openSoundboardPro();
            }}
        />
    );
}

// Settings component
function SettingsComponent() {
    return (
        <div>
            <BaseText size="md" style={{ marginBottom: "16px" }}>
                🔊 <strong>Soundboard Pro</strong>
            </BaseText>
            <BaseText
                size="sm"
                style={{ marginBottom: "16px", color: "var(--text-muted)" }}
            >
                Advanced soundboard with real sounds and synthetic sounds. Plays sounds
                directly in the Discord voice channel.
            </BaseText>

            <div style={{ marginBottom: "16px" }}>
                <Button
                    onClick={openSoundboardPro}
                    color={Button.Colors.BRAND}
                    style={{ width: "100%" }}
                >
                    🎵 Open Soundboard Pro
                </Button>
            </div>

            <BaseText size="sm" style={{ color: "var(--text-muted)" }}>
                <strong>✨ Features:</strong>
                <br />
                • 12 real sounds with actual URLs
                <br />
                • Synthetic sounds as fallback
                <br />
                • 3 playback modes (synthetic, URL, hybrid)
                <br />
                • Button integrated in voice panel
                <br />
                • Sounds played directly in Discord
                <br />
                • Local MP3 file selection
                <br />
                • "Force Discord API" option for voice channel
                <br />• Advanced interface with responsive grid
            </BaseText>
        </div>
    );
}

export default definePlugin({
    name: "SoundboardPro",
    description:
        "Advanced soundboard with real sounds and synthetic sounds. Plays sounds directly in Discord voice channel.",
    tags: ["Voice", "Utility"],
    authors: [TestcordDevs.x2b],
    settings,
    settingsAboutComponent: SettingsComponent,

    patches: [
        {
            find: "#{intl::ACCOUNT_SPEAKING_WHILE_MUTED}",
            replacement: {
                match: /(?:className:\i\.buttons,.{0,50})?children:\[/,
                replace: "$&$self.SoundboardButton(),",
            },
        },
    ],
    SoundboardButton,

    start() {
        console.log(
            "[SoundboardPro] Plugin started - Merged version with patch"
        );
    },

    stop() {
        console.log("[SoundboardPro] Plugin stopped");
    },
});
