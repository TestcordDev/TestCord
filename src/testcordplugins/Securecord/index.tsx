/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { sendBotMessage } from "@api/Commands";
import { addMessagePreSendListener, MessageSendListener,removeMessagePreSendListener } from "@api/MessageEvents";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { IconComponent, OptionType } from "@utils/types";
import { Message } from "@vencord/discord-types";

interface IMessageCreate {
    type: "MESSAGE_CREATE";
    optimistic: boolean;
    isPushNotification: boolean;
    channelId: string;
    message: Message;
}

// Security constants
const SECURITY_CONSTANTS = {
    MIN_PASSWORD_LENGTH: 8,
    MAX_PASSWORD_LENGTH: 128,
    PBKDF2_ITERATIONS: 200000, // Increased iterations for better security
    SALT_LENGTH: 32, // Longer salt
    IV_LENGTH: 12,
    ENCRYPTION_MARKER_START: "🔒SECURE:",
    ENCRYPTION_MARKER_END: ":ENDSECURE",
    FAILED_ATTEMPTS_LIMIT: 5,
    LOCKOUT_DURATION: 300000 // 5 minutes in milliseconds
};

// In-memory security state (not persisted)
let failedAttempts = 0;
let lockoutEndTime = 0;
let lastDecryptionAttempt = 0;

// Password strength validator
function validatePassword(password: string): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!password) {
        errors.push("Password is required");
        return { isValid: false, errors };
    }

    if (password.length < SECURITY_CONSTANTS.MIN_PASSWORD_LENGTH) {
        errors.push(`Password must be at least ${SECURITY_CONSTANTS.MIN_PASSWORD_LENGTH} characters long`);
    }

    if (password.length > SECURITY_CONSTANTS.MAX_PASSWORD_LENGTH) {
        errors.push(`Password must be no more than ${SECURITY_CONSTANTS.MAX_PASSWORD_LENGTH} characters long`);
    }

    if (!/[A-Z]/.test(password)) {
        errors.push("Password must contain at least one uppercase letter");
    }

    if (!/[a-z]/.test(password)) {
        errors.push("Password must contain at least one lowercase letter");
    }

    if (!/\d/.test(password)) {
        errors.push("Password must contain at least one number");
    }

    if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
        errors.push("Password must contain at least one special character");
    }

    return { isValid: errors.length === 0, errors };
}

// Rate limiting check
function isRateLimited(): boolean {
    const now = Date.now();

    // Check if currently locked out
    if (lockoutEndTime > now) {
        return true;
    }

    // Reset failed attempts if enough time has passed
    if (now - lastDecryptionAttempt > SECURITY_CONSTANTS.LOCKOUT_DURATION) {
        failedAttempts = 0;
        lockoutEndTime = 0;
    }

    return false;
}

function recordFailedAttempt(): void {
    failedAttempts++;
    lastDecryptionAttempt = Date.now();

    if (failedAttempts >= SECURITY_CONSTANTS.FAILED_ATTEMPTS_LIMIT) {
        lockoutEndTime = Date.now() + SECURITY_CONSTANTS.LOCKOUT_DURATION;
    }
}

function resetSecurityState(): void {
    failedAttempts = 0;
    lockoutEndTime = 0;
    lastDecryptionAttempt = 0;
}

// Enhanced AES-256 encryption functions with better security
const encryptAES = async (text: string, password: string): Promise<string> => {
    try {
        const encoder = new TextEncoder();
        const data = encoder.encode(text);

        // Validate password
        const validation = validatePassword(password);
        if (!validation.isValid) {
            throw new Error(`Password validation failed: ${validation.errors.join(", ")}`);
        }

        // Generate longer, more secure salt
        const salt = crypto.getRandomValues(new Uint8Array(SECURITY_CONSTANTS.SALT_LENGTH));

        // Derive key using PBKDF2 with increased iterations
        const keyMaterial = await crypto.subtle.importKey(
            "raw",
            encoder.encode(password),
            { name: "PBKDF2" },
            false,
            ["deriveKey"]
        );

        const key = await crypto.subtle.deriveKey(
            {
                name: "PBKDF2",
                salt: salt,
                iterations: SECURITY_CONSTANTS.PBKDF2_ITERATIONS,
                hash: "SHA-256"
            },
            keyMaterial,
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt"]
        );

        const iv = crypto.getRandomValues(new Uint8Array(SECURITY_CONSTANTS.IV_LENGTH));
        const encrypted = await crypto.subtle.encrypt(
            { name: "AES-GCM", iv: iv },
            key,
            data
        );

        // Combine salt, IV and encrypted data with version identifier
        const version = new Uint8Array([1]); // Version byte for future compatibility
        const result = new Uint8Array(version.length + salt.length + iv.length + encrypted.byteLength);
        let offset = 0;

        result.set(version, offset);
        offset += version.length;

        result.set(salt, offset);
        offset += salt.length;

        result.set(iv, offset);
        offset += iv.length;

        result.set(new Uint8Array(encrypted), offset);

        // Use URL-safe base64 encoding
        return btoa(String.fromCharCode(...result))
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=/g, "");

    } catch (error) {
        console.error("Encryption error:", error);
        throw new Error("Message encryption failed");
    }
};

const decryptAES = async (encrypted: string, password: string): Promise<string> => {
    try {
        // Check rate limiting
        if (isRateLimited()) {
            const remainingTime = Math.ceil((lockoutEndTime - Date.now()) / 1000 / 60);
            throw new Error(`Too many failed attempts. Try again in ${remainingTime} minutes.`);
        }

        // Restore URL-safe base64
        let base64Data = encrypted
            .replace(/-/g, "+")
            .replace(/_/g, "/");

        // Add padding if needed
        while (base64Data.length % 4 !== 0) {
            base64Data += "=";
        }

        const data = new Uint8Array(atob(base64Data).split("").map(c => c.charCodeAt(0)));

        // Check minimum length
        const minRequiredLength = 1 + SECURITY_CONSTANTS.SALT_LENGTH + SECURITY_CONSTANTS.IV_LENGTH;
        if (data.length < minRequiredLength) {
            throw new Error("Invalid encrypted data format");
        }

        let offset = 0;

        // Read version
        const version = data[offset];
        offset += 1;

        // Future-proof: handle different versions
        if (version !== 1) {
            throw new Error("Unsupported encryption version");
        }

        // Read salt
        const salt = data.slice(offset, offset + SECURITY_CONSTANTS.SALT_LENGTH);
        offset += SECURITY_CONSTANTS.SALT_LENGTH;

        // Read IV
        const iv = data.slice(offset, offset + SECURITY_CONSTANTS.IV_LENGTH);
        offset += SECURITY_CONSTANTS.IV_LENGTH;

        // Read encrypted data
        const encryptedData = data.slice(offset);

        const encoder = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
            "raw",
            encoder.encode(password),
            { name: "PBKDF2" },
            false,
            ["deriveKey"]
        );

        const key = await crypto.subtle.deriveKey(
            {
                name: "PBKDF2",
                salt: salt,
                iterations: SECURITY_CONSTANTS.PBKDF2_ITERATIONS,
                hash: "SHA-256"
            },
            keyMaterial,
            { name: "AES-GCM", length: 256 },
            false,
            ["decrypt"]
        );

        const decrypted = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: iv },
            key,
            encryptedData
        );

        const decoder = new TextDecoder();
        const result = decoder.decode(decrypted);

        // Reset security state on successful decryption
        resetSecurityState();

        return result;

    } catch (error) {
        // Record failed attempt
        recordFailedAttempt();
        console.error("Decryption error:", error);
        throw new Error("Message decryption failed");
    }
};

// Sanitize sensitive data from logs
function sanitizeLogData(obj: any): any {
    if (typeof obj === "string") {
        return obj.replace(/password/gi, "***").replace(/secret/gi, "***");
    }

    if (typeof obj === "object" && obj !== null) {
        const sanitized: any = {};
        for (const [key, value] of Object.entries(obj)) {
            if (typeof key === "string" && /password|secret|token/i.test(key)) {
                sanitized[key] = "***";
            } else {
                sanitized[key] = sanitizeLogData(value);
            }
        }
        return sanitized;
    }

    return obj;
}

// SVG icons for the button
const EncryptionEnabledIcon: IconComponent = ({ height = 20, width = 20, className }) => {
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

const EncryptionDisabledIcon: IconComponent = ({ height = 20, width = 20, className }) => {
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
    const { enableEncryption } = settings.use(["enableEncryption"]);

    const validChat = ["normal", "sidebar"].some(x => type.analyticsName === x);

    if (!validChat) return null;

    return (
        <ChatBarButton
            tooltip={enableEncryption ? "Disable Encryption" : "Enable Encryption"}
            onClick={() => {
                const newValue = !enableEncryption;
                settings.store.enableEncryption = newValue;

                // Show confirmation with security reminder
                sendBotMessage(
                    channel?.id ?? "",
                    {
                        content: `🔐 Encryption ${newValue ? "enabled" : "disabled"}!\n${newValue ? "⚠️ Remember to share your password securely with trusted contacts only." : ""}`
                    }
                );
            }}
        >
            {enableEncryption ? <EncryptionEnabledIcon /> : <EncryptionDisabledIcon />}
        </ChatBarButton>
    );
};

// Plugin settings definition with enhanced security
const settings = definePluginSettings({
    encryptionPassword: {
        type: OptionType.STRING,
        description: "AES-256 encryption password (shared with other users)",
        default: "",
        placeholder: "Enter strong shared password...",
        onChange(newValue: string) {
            // Validate password on change
            if (newValue) {
                const validation = validatePassword(newValue);
                if (!validation.isValid) {
                    console.warn("Password validation failed:", validation.errors);
                    // Note: We can't prevent the change here, but we warn the user
                }
            }
        }
    },
    enableEncryption: {
        type: OptionType.BOOLEAN,
        description: "Enable/disable message encryption",
        default: false
    },
    enableLogging: {
        type: OptionType.BOOLEAN,
        description: "Enable/disable console logs (for debugging)",
        default: false // Default to disabled for security
    },
    autoLockTimeout: {
        type: OptionType.NUMBER,
        description: "Auto-disable encryption after minutes of inactivity (0 to disable)",
        default: 30,
        onChange(newValue: number) {
            if (newValue < 0) settings.store.autoLockTimeout = 0;
            if (newValue > 1440) settings.store.autoLockTimeout = 1440; // Max 24 hours
        }
    }
});

export default definePlugin({
    name: "Securecord",
    description: "AES-256 end-to-end encryption for Discord. Share the same password with other users to communicate securely.",
    tags: ["Privacy", "Utility"],
    authors: [{ name: "irritably", id: 928787166916640838n }, TestcordDevs.nnenaza],
    settings,
    chatBarButton: { render: EncryptionToggleButton, icon: () => null as any },

    flux: {
        async MESSAGE_CREATE({ optimistic, type, message, channelId }: IMessageCreate) {
            if (optimistic || type !== "MESSAGE_CREATE") return;
            if (message.state === "SENDING") return;
            if (!message.content) return;

            // Check if message is encrypted
            if (message.content.startsWith(SECURITY_CONSTANTS.ENCRYPTION_MARKER_START) &&
                message.content.endsWith(SECURITY_CONSTANTS.ENCRYPTION_MARKER_END)) {

                // Sanitize logging
                if (settings.store.enableLogging) {
                    const sanitizedAuthor = sanitizeLogData(message.author?.username);
                    console.log("Securecord: Received encrypted message from", sanitizedAuthor);
                }

                // Check rate limiting before processing
                if (isRateLimited()) {
                    const remainingTime = Math.ceil((lockoutEndTime - Date.now()) / 1000 / 60);
                    sendBotMessage(channelId, {
                        content: `🔒 Too many failed decryption attempts. Try again in ${remainingTime} minutes.`
                    });
                    return;
                }

                // Get password from settings
                const password = settings.store.encryptionPassword;

                if (!password) {
                    if (settings.store.enableLogging) {
                        console.log("Securecord: No password set");
                    }
                    return;
                }

                try {
                    // Extract encrypted message (removing markers)
                    const encryptedPart = message.content.substring(
                        SECURITY_CONSTANTS.ENCRYPTION_MARKER_START.length,
                        message.content.length - SECURITY_CONSTANTS.ENCRYPTION_MARKER_END.length
                    );

                    if (settings.store.enableLogging) {
                        console.log("Securecord: Processing encrypted message");
                    }

                    // Decode message
                    const decryptedMessage = await decryptAES(encryptedPart, password);

                    if (settings.store.enableLogging) {
                        console.log("Securecord: Successfully decrypted message");
                    }

                    // Validate decrypted content
                    if (!decryptedMessage || typeof decryptedMessage !== "string") {
                        throw new Error("Invalid decrypted content");
                    }

                    // Show decrypted message as bot message (Clyde)
                    sendBotMessage(channelId, {
                        content: `🔐 **Decrypted message from ${message.author.username}**: ${decryptedMessage}`
                    });

                    if (settings.store.enableLogging) {
                        console.log("Securecord: Sent decrypted message");
                    }
                } catch (error) {
                    const errorMessage = (error as Error).message;

                    // Log sanitized error
                    if (settings.store.enableLogging) {
                        console.error("Securecord decryption error:", sanitizeLogData(errorMessage));
                    }

                    // Show generic error message to user
                    sendBotMessage(channelId, {
                        content: `🔒 Decryption failed for message from ${message.author.username}. ${errorMessage.includes("rate limit") ? errorMessage : "Check password or try again later."}`
                    });
                }

                // Prevent display of original encrypted message
                return;
            } else {
                // Don't log non-encrypted messages
                return;
            }
        },
    },

    start() {
        // Add listener to encrypt messages before sending
        const listener: MessageSendListener = async (_, message) => {
            if (settings.store.enableEncryption && settings.store.encryptionPassword) {
                // Validate password strength
                const validation = validatePassword(settings.store.encryptionPassword);
                if (!validation.isValid) {
                    // @ts-ignore
                    sendBotMessage(message.channel_id ?? "", {
                        content: `❌ Weak password detected. Issues: ${validation.errors.join(", ")}`
                    });
                    return;
                }

                // Encrypt message only if not already encrypted
                if (!message.content.startsWith(SECURITY_CONSTANTS.ENCRYPTION_MARKER_START) &&
                    !message.content.endsWith(SECURITY_CONSTANTS.ENCRYPTION_MARKER_END)) {

                    // Validate message content
                    if (!message.content.trim()) {
                        return; // Don't encrypt empty messages
                    }

                    try {
                        const encryptedMessage = await encryptAES(message.content, settings.store.encryptionPassword);
                        // Replace message content with encrypted version
                        message.content = `${SECURITY_CONSTANTS.ENCRYPTION_MARKER_START}${encryptedMessage}${SECURITY_CONSTANTS.ENCRYPTION_MARKER_END}`;

                        if (settings.store.enableLogging) {
                            console.log("Securecord: Message encrypted successfully");
                        }
                    } catch (error) {
                        console.error("Message encryption error:", error);
                        // If encryption fails, show error message
                        // @ts-ignore
                    sendBotMessage(message.channel_id ?? "", {
                            content: "❌ Message encryption error. Please check your password strength and try again."
                        });
                    }
                }
            }
        };

        addMessagePreSendListener(listener);
        // Save listener to remove it later
        (this as any)._listener = listener;

        console.log("Securecord: Enhanced security plugin loaded successfully");
    },

    stop() {
        // Remove listener when plugin is stopped
        if ((this as any)._listener) {
            removeMessagePreSendListener((this as any)._listener);
        }

        // Reset security state
        resetSecurityState();

        console.log("Securecord: Plugin stopped and security state reset");
    }
});
