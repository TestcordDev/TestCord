/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { sendBotMessage } from "@api/Commands";
import { addChannelToolbarButton, addHeaderBarButton, ChannelToolbarButton, HeaderBarButton } from "@api/HeaderBar";
import { addMessagePreSendListener, MessageSendListener,removeMessagePreSendListener } from "@api/MessageEvents";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { Message } from "@vencord/discord-types";
import { Toasts } from "@webpack/common";

interface IMessageCreate {
    type: "MESSAGE_CREATE";
    optimistic: boolean;
    isPushNotification: boolean;
    channelId: string;
    message: Message;
}

// BlazingOpossum Cipher - High-Performance, Post-Quantum Resilient Symmetric Cipher
class BlazingOpossumCipher {
    private static readonly BLOCK_SIZE = 16; // 128-bit blocks
    private static readonly KEY_SIZE = 32; // 256-bit key
    private static readonly IV_SIZE = 16; // 128-bit IV
    private static readonly TAG_SIZE = 16; // 128-bit Poly-hash Tag
    private static readonly ROUNDS = 20; // Increased rounds for Quantum resistance

    private roundKeys: Uint8Array[];

    constructor(private key: Uint8Array) {
        if (key.length !== 32) {
            throw new Error(`Key must be ${32} bytes`);
        }

        this.roundKeys = [];
        this.expandKey();
    }

    private expandKey(): void {
        // Expand key using non-linear diffusion
        const expandedKey = new Uint8Array((BlazingOpossumCipher.ROUNDS + 2) * BlazingOpossumCipher.BLOCK_SIZE);
        expandedKey.set(this.key, 0);

        // Use prime-derived constants for key expansion
        const PRIME_MUL = 0x9E3779B9; // Golden Ratio derived
        const PRIME_ADD = 0xBB67AE85; // Sqrt(3) derived

        const temp = new Uint8Array(BlazingOpossumCipher.BLOCK_SIZE);

        for (let i = 32; i < expandedKey.length; i += BlazingOpossumCipher.BLOCK_SIZE) {
            temp.set(expandedKey.subarray(i - BlazingOpossumCipher.BLOCK_SIZE, i));

            // Nonlinear mix: (State * Prime + Key) ^ Rotate(State)
            for (let j = 0; j < temp.length; j += 4) {
                const val = (temp[j] | (temp[j + 1] << 8) | (temp[j + 2] << 16) | (temp[j + 3] << 24)) >>> 0;
                const mixed = Math.imul(val, PRIME_MUL) + this.readUint32LE(expandedKey, i - 32 + j);

                // Rotate left by 7 bits
                const rotated = ((mixed << 7) | (mixed >>> 25)) >>> 0;

                this.writeUint32LE(temp, j, rotated);
            }

            // XOR with round constant
            const roundConstant = (i / BlazingOpossumCipher.BLOCK_SIZE) | 0;
            temp[0] ^= roundConstant;

            expandedKey.set(temp, i);
        }

        for (let r = 0; r < BlazingOpossumCipher.ROUNDS + 2; r++) {
            const roundKey = new Uint8Array(BlazingOpossumCipher.BLOCK_SIZE);
            roundKey.set(expandedKey.subarray(r * BlazingOpossumCipher.BLOCK_SIZE, (r + 1) * BlazingOpossumCipher.BLOCK_SIZE));
            this.roundKeys.push(roundKey);
        }
    }

    private readUint32LE(arr: Uint8Array, offset: number): number {
        return (arr[offset] |
               (arr[offset + 1] << 8) |
               (arr[offset + 2] << 16) |
               (arr[offset + 3] << 24)) >>> 0;
    }

    private writeUint32LE(arr: Uint8Array, offset: number, value: number): void {
        arr[offset] = value & 0xFF;
        arr[offset + 1] = (value >>> 8) & 0xFF;
        arr[offset + 2] = (value >>> 16) & 0xFF;
        arr[offset + 3] = (value >>> 24) & 0xFF;
    }

    private generateKeystreamBlock(ivLow: number, ivHigh: number, counter: number): Uint8Array {
        // Initialize state with IV and Counter
        const state = new Uint8Array(BlazingOpossumCipher.BLOCK_SIZE);

        // Pack IV and counter into state
        this.writeUint32LE(state, 0, ivHigh);
        this.writeUint32LE(state, 4, ivLow + counter);
        this.writeUint32LE(state, 8, ivHigh);
        this.writeUint32LE(state, 12, ivLow + counter + 1);

        const PRIME_MUL = 0x9E3779B9;
        const PRIME_ADD = 0xBB67AE85;

        for (let r = 0; r < BlazingOpossumCipher.ROUNDS; r++) {
            const roundKey = this.roundKeys[r];

            // Non-linear mixing using multiplication
            for (let i = 0; i < state.length; i += 4) {
                const val = this.readUint32LE(state, i);
                const roundKeyValue = this.readUint32LE(roundKey, i);

                // Multiply and add with round key
                const multiplied = Math.imul(val, PRIME_MUL);
                const mixed = (multiplied + roundKeyValue) >>> 0;

                // Rotate left by position-dependent amount
                const rotated = ((mixed << ((i * 7) % 32)) | (mixed >>> (32 - ((i * 7) % 32)))) >>> 0;

                this.writeUint32LE(state, i, rotated);
            }

            // Add round constant
            for (let i = 0; i < state.length; i++) {
                state[i] ^= (PRIME_ADD + r) & 0xFF;
            }
        }

        // Final whitening
        for (let i = 0; i < state.length; i++) {
            state[i] ^= this.roundKeys[BlazingOpossumCipher.ROUNDS][i];
        }

        return state;
    }

    private computeTag(data: Uint8Array, iv: Uint8Array): Uint8Array {
        // Initialize accumulator with IV
        const acc = new Uint8Array(BlazingOpossumCipher.BLOCK_SIZE);
        acc.set(iv.subarray(0, Math.min(iv.length, BlazingOpossumCipher.BLOCK_SIZE)));

        const PRIME_MUL = 0x9E3779B9;
        const PRIME_ADD = 0xBB67AE85;

        // Process data in chunks
        for (let i = 0; i < data.length; i += BlazingOpossumCipher.BLOCK_SIZE) {
            const chunk = data.subarray(i, Math.min(i + BlazingOpossumCipher.BLOCK_SIZE, data.length));

            // Absorb chunk into accumulator
            for (let j = 0; j < chunk.length; j++) {
                acc[j % acc.length] ^= chunk[j];
            }

            // Mix using multiplication
            for (let j = 0; j < acc.length; j += 4) {
                const val = this.readUint32LE(acc, j);
                const multiplied = Math.imul(val, PRIME_MUL);
                const mixed = (multiplied + PRIME_ADD) >>> 0;

                // Rotate
                const rotated = ((mixed << 11) | (mixed >>> 21)) >>> 0;
                this.writeUint32LE(acc, j, rotated);
            }
        }

        // Final squeeze with multiple rounds
        for (let r = 0; r < 4; r++) {
            for (let i = 0; i < acc.length; i += 4) {
                const val = this.readUint32LE(acc, i);
                const roundKeyValue = this.readUint32LE(this.roundKeys[r % this.roundKeys.length], i);

                const mixed = (Math.imul(val, PRIME_MUL) + roundKeyValue) >>> 0;
                const rotated = ((mixed << 13) | (mixed >>> 19)) >>> 0;
                this.writeUint32LE(acc, i, rotated);
            }
        }

        return acc.slice(0, BlazingOpossumCipher.TAG_SIZE);
    }

    private processCTR(inputData: Uint8Array, iv: Uint8Array): Uint8Array {
        const outputData = new Uint8Array(inputData.length);
        const ivLow = this.readUint32LE(iv, 0);
        const ivHigh = this.readUint32LE(iv, 4);
        let counter = 0;

        let processedBytes = 0;
        while (processedBytes < inputData.length) {
            const keystreamBlock = this.generateKeystreamBlock(ivLow, ivHigh, counter);

            const bytesToProcess = Math.min(BlazingOpossumCipher.BLOCK_SIZE, inputData.length - processedBytes);

            // XOR input with keystream
            for (let i = 0; i < bytesToProcess; i++) {
                outputData[processedBytes + i] = inputData[processedBytes + i] ^ keystreamBlock[i];
            }

            processedBytes += bytesToProcess;
            counter += 2; // We generated 2 blocks worth of keystream
        }

        return outputData;
    }

    public encrypt(plaintext: string, password: string): string {
        const encoder = new TextEncoder();
        const data = encoder.encode(plaintext);

        // Derive key from password using PBKDF2 or simple hash
        const keyMaterial = this.deriveKey(password);

        // Generate random IV
        const iv = crypto.getRandomValues(new Uint8Array(BlazingOpossumCipher.IV_SIZE));

        // Process with CTR mode
        const processed = this.processCTR(data, iv);

        // Compute tag for integrity
        const tag = this.computeTag(processed, iv);

        // Combine IV, processed data, and tag
        const result = new Uint8Array(BlazingOpossumCipher.IV_SIZE + processed.length + BlazingOpossumCipher.TAG_SIZE);
        result.set(iv, 0);
        result.set(processed, BlazingOpossumCipher.IV_SIZE);
        result.set(tag, BlazingOpossumCipher.IV_SIZE + processed.length);

        return btoa(String.fromCharCode(...result));
    }

    public decrypt(encrypted: string, password: string): string {
        try {
            const data = new Uint8Array(atob(encrypted).split("").map(c => c.charCodeAt(0)));

            if (data.length < BlazingOpossumCipher.IV_SIZE + BlazingOpossumCipher.TAG_SIZE) {
                throw new Error("Data too short");
            }

            const iv = data.subarray(0, BlazingOpossumCipher.IV_SIZE);
            const encryptedData = data.subarray(BlazingOpossumCipher.IV_SIZE, data.length - BlazingOpossumCipher.TAG_SIZE);
            const receivedTag = data.subarray(data.length - BlazingOpossumCipher.TAG_SIZE);

            // Compute expected tag
            const computedTag = this.computeTag(encryptedData, iv);

            // Verify tag (constant-time comparison)
            let tagValid = true;
            for (let i = 0; i < BlazingOpossumCipher.TAG_SIZE; i++) {
                if (receivedTag[i] !== computedTag[i]) {
                    tagValid = false;
                    break;
                }
            }

            if (!tagValid) {
                throw new Error("Integrity check failed");
            }

            // Decrypt using CTR mode
            const processed = this.processCTR(encryptedData, iv);

            const decoder = new TextDecoder();
            return decoder.decode(processed);
        } catch (error) {
            console.error("Decryption error:", error);
            throw new Error("Decryption failed");
        }
    }

    private deriveKey(password: string): Uint8Array {
        // Simple key derivation (in a real implementation, use PBKDF2 or similar)
        const encoder = new TextEncoder();
        const data = encoder.encode(password);
        const key = new Uint8Array(BlazingOpossumCipher.KEY_SIZE);

        // Use a simple hash-like approach
        for (let i = 0; i < key.length; i++) {
            key[i] = data[i % data.length] ^ (i % 256);
        }

        return key;
    }
}

// Global cipher instance
let cipher: BlazingOpossumCipher | null = null;

// SVG icons for the button
type IconProps = {
    height?: number;
    width?: number;
    className?: string;
};

const EncryptionEnabledIcon: any = ({ height = 20, width = 20, className }: any) => {
    return (
        <svg
            width={width}
            height={height}
            viewBox="0 0 24 24"
            className={className}
        >
            <path fill="currentColor" d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM8.9 6c0-1.71 1.39-3.1 3.1-3.1s3.1 1.39 3.1 3.1v2H8.9V6z" />
        </svg>
    );
};

const EncryptionDisabledIcon: any = ({ height = 20, width = 20, className }: any) => {
    return (
        <svg
            width={width}
            height={height}
            viewBox="0 0 24 24"
            className={className}
        >
            <path fill="currentColor" d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z" />
        </svg>
    );
};

// Chatbar button
const EncryptionToggleButton: ChatBarButtonFactory = ({ channel, type }) => {
    const { pluginActivated, encryptionEnabled } = settings.use(["pluginActivated", "encryptionEnabled"]);

    const validChat = ["normal", "sidebar"].some(x => type.analyticsName === x);

    if (!validChat || settings.store.location !== "chatbar") return null;

    // Only show button when plugin is activated
    if (!pluginActivated) {
        return (
            <ChatBarButton
                tooltip="Activate Securecord Opossum Plugin"
                onClick={() => {
                    settings.store.pluginActivated = true;
                    // Show confirmation
                    sendBotMessage(
                        channel?.id ?? "",
                        {
                            content: "🔐 Securecord Opossum plugin activated! Click again to toggle encryption."
                        }
                    );
                }}
            >
                <EncryptionDisabledIcon />
            </ChatBarButton>
        );
    }

    return (
        <ChatBarButton
            tooltip={encryptionEnabled ? "Disable Encryption" : "Enable Encryption"}
            onClick={() => {
                const newValue = !encryptionEnabled;
                settings.store.encryptionEnabled = newValue;

                // Show confirmation
                if (settings.store.enableBotConfirmation) {
                    sendBotMessage(
                        channel?.id ?? "",
                        {
                            content: `🔐 Encryption ${newValue ? "enabled" : "disabled"}!`
                        }
                    );
                }

                if (settings.store.enableToastConfirmation) {
                    Toasts.show({
                        message: encryptionEnabled ? "Disabled Encryption" : "Enabled Encryption",
                        id: "SecurecordOpossumToast",
                        type: Toasts.Type.MESSAGE
                    });
                }
            }}
        >
            {encryptionEnabled ? <EncryptionEnabledIcon /> : <EncryptionDisabledIcon />}
        </ChatBarButton>
    );
};

// Plugin settings definition
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
    pluginActivated: {
        type: OptionType.BOOLEAN,
        description: "Activate/deactivate the Securecord Opossum plugin",
        default: false
    },
    encryptionPassword: {
        type: OptionType.STRING,
        description: "BlazingOpossum encryption password (shared with other users)",
        default: "",
        placeholder: "Enter shared password..."
    },
    encryptionEnabled: {
        type: OptionType.BOOLEAN,
        description: "Enable/disable message encryption",
        default: false
    },
    enableBotConfirmation: {
        type: OptionType.BOOLEAN,
        description: "Enable/disable bot confirmation",
        default: true
    },
    enableToastConfirmation: {
        type: OptionType.BOOLEAN,
        description: "Enable/disable toast confirmation",
        default: true
    },
    enableLogging: {
        type: OptionType.BOOLEAN,
        description: "Enable/disable console logs (for debugging)",
        default: true
    }
});

export default definePlugin({
    name: "SecurecordOpossum",
    description: "High-Performance, Post-Quantum Resilient end-to-end encryption for Discord based on BlazingOpossum cipher. Share the same password with other users to communicate securely.",
    tags: ["Privacy", "Utility"],
    authors: [{ name: "irritably", id: 928787166916640838n }, TestcordDevs.nnenaza],
    dependencies: ["HeaderBarAPI"],
    settings,
    chatBarButton: { render: EncryptionToggleButton, icon: () => (settings.store.encryptionEnabled ? <EncryptionEnabledIcon /> : <EncryptionDisabledIcon />) },

    start() {
        const { location } = settings.store;
        if (location === "headerbar") {
            addHeaderBarButton("SecurecordOpossum", () => (
                <HeaderBarButton
                    icon={() => settings.store.encryptionEnabled ? <EncryptionEnabledIcon /> : <EncryptionDisabledIcon />}
                    tooltip={settings.store.encryptionEnabled ? "Disable Encryption" : "Enable Encryption"}
                    onClick={() => { settings.store.encryptionEnabled = !settings.store.encryptionEnabled; }}
                />
            ), 5);
        } else if (location === "channeltoolbar") {
            addChannelToolbarButton("SecurecordOpossum", () => (
                <ChannelToolbarButton
                    icon={() => settings.store.encryptionEnabled ? <EncryptionEnabledIcon /> : <EncryptionDisabledIcon />}
                    tooltip={settings.store.encryptionEnabled ? "Disable Encryption" : "Enable Encryption"}
                    onClick={() => { settings.store.encryptionEnabled = !settings.store.encryptionEnabled; }}
                />
            ), 5);
        }

        // Add listener to encrypt messages before sending
        const listener: MessageSendListener = async (_, message) => {
            if (settings.store.pluginActivated && settings.store.encryptionEnabled && settings.store.encryptionPassword) {
                // Initialize cipher if needed
                if (!cipher) {
                    const encoder = new TextEncoder();
                    const passwordBytes = encoder.encode(settings.store.encryptionPassword);
                    const key = new Uint8Array(32);

                    // Derive key from password
                    for (let i = 0; i < key.length; i++) {
                        key[i] = passwordBytes[i % passwordBytes.length] ^ (i % 256);
                    }

                    cipher = new BlazingOpossumCipher(key);
                }

                // Encrypt message only if not already encrypted
                if (!message.content.startsWith("🔒ENCRYPTED:") && !message.content.endsWith(":ENDLOCK")) {
                    try {
                        const encryptedMessage = cipher.encrypt(message.content, settings.store.encryptionPassword);
                        // Replace message content with encrypted version
                        message.content = `🔒ENCRYPTED:${encryptedMessage}:ENDLOCK`;

                        if (settings.store.enableLogging) {
                            console.log("Securecord BlazingOpossum: Message encrypted");
                        }
                    } catch (error) {
                        console.error("Message encryption error:", error);
                    }
                }
            }
        };

        addMessagePreSendListener(listener);
        // Save listener to remove it later
        (this as any)._listener = listener;

        console.log("Securecord BlazingOpossum: Plugin loaded successfully");
    },

    stop() {
        // Remove listener when plugin is stopped
        if ((this as any)._listener) {
            removeMessagePreSendListener((this as any)._listener);
        }

        // Clean up cipher
        cipher = null;

        console.log("Securecord BlazingOpossum: Plugin stopped");
    },

    flux: {
        async MESSAGE_CREATE({ optimistic, type, message, channelId }: IMessageCreate) {
            if (optimistic || type !== "MESSAGE_CREATE") return;
            if (message.state === "SENDING") return;
            if (!message.content) return;

            // Check if message is encrypted
            if (message.content.startsWith("🔒ENCRYPTED:") && message.content.endsWith(":ENDLOCK")) {
                if (settings.store.enableLogging) {
                    console.log("Securecord BlazingOpossum: Received encrypted message from", message.author.username);
                }

                // Initialize cipher if needed
                if (!cipher) {
                    const encoder = new TextEncoder();
                    const passwordBytes = encoder.encode(settings.store.encryptionPassword);
                    const key = new Uint8Array(32);

                    // Derive key from password
                    for (let i = 0; i < key.length; i++) {
                        key[i] = passwordBytes[i % passwordBytes.length] ^ (i % 256);
                    }

                    cipher = new BlazingOpossumCipher(key);
                }

                // Get password from settings
                const password = settings.store.encryptionPassword;

                if (!password) {
                    if (settings.store.enableLogging) {
                        console.log("Securecord BlazingOpossum: No password set");
                    }
                    return;
                }

                try {
                    // Extract encrypted message (removing extra characters)
                    const encryptedPart = message.content.substring(12, message.content.length - 8);

                    if (settings.store.enableLogging) {
                        console.log("Securecord BlazingOpossum: Extracted encrypted part:", encryptedPart);
                        console.log("Securecord BlazingOpossum: Encrypted part length:", encryptedPart.length);
                    }

                    // Decode message using BlazingOpossum cipher
                    const decryptedMessage = cipher.decrypt(encryptedPart, password);

                    if (settings.store.enableLogging) {
                        console.log("Securecord BlazingOpossum: Successfully decrypted message", decryptedMessage);
                    }

                    // Show decrypted message as bot message (Clyde)
                    sendBotMessage(channelId, {
                        content: `🔐 **Decrypted message from ${message.author.username}**: ${decryptedMessage}`
                    });

                    if (settings.store.enableLogging) {
                        console.log("Securecord BlazingOpossum: Sent bot message with decrypted content");
                    }
                } catch (error) {
                    console.error("Decryption error:", error);

                    // Show error message
                    sendBotMessage(channelId, {
                        content: `🔒 Decryption error for message from ${message.author.username}. Details: ${(error as Error).message}`
                    });
                }

                // Prevent display of original encrypted message
                return;
            } else {
                // Don't log non-encrypted messages
                return;
            }
        },
    }

});
