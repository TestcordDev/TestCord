/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { addContextMenuPatch, removeContextMenuPatch } from "@api/ContextMenu";
import { addChannelToolbarButton, addHeaderBarButton, ChannelToolbarButton, HeaderBarButton, removeChannelToolbarButton, removeHeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import type { Message } from "@vencord/discord-types";
import { Menu, Parser, React, Toasts, useEffect, useState } from "@webpack/common";

const encryptSettings = definePluginSettings({
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
});

const MARKER = "\u200B\u200C\u200D";

const NOISE_CHARSETS = [
    "§¤¦¶†‡•‰™©®",
    "αβγδεζηθικλμ",
    "╔╗╚╝║═╬╠╣╦╩┼",
    "░▒▓█▄▀▐▌◆◇○●",
    "∀∂∃∅∆∇∈∏∑∞∝√",
    "①②③④⑤⑥⑦⑧⑨⑩⑪",
    "Ⓐ Ⓑ Ⓒ Ⓓ Ⓔ Ⓕ Ⓖ Ⓗ Ⓘ Ⓙ Ⓚ".replace(/ /g, ""),
    "♠♣♦♥♤♧♢♡★☆✦",
    "♈♉♊♋♌♍♎♏♐♑♒♓",
    "☀☁☂☃❿❀❁❂❃❄❅",
    "⚀⚁⚂⚃⚄⚅◐◑◒◓◔",
    "▲△▴▵▶▷▸▹►▻▼▽",
    "⊕⊖⊗⊘⊙⊚⊛⊜⊝⊞⊟",
    "←→↑↓↔↕↖↗↘↙↚↛",
    "⌐¬√∛∜∝∞∟∠∡∢∣",
    "₠₡₢₣₤₥₦₧₨₩₪₫",
    "♩♪♫♬♭♮♯◊♦◈◇",
    "≈≉≊≋≌≍≎≏≐≑≒≓",
    "⊛⊕⊗⊘⊙⊚⊜⊝⊞⊟⟐",
    "✕✖✗✘✙✚✛✜✝✞✟",
    "☰☱☲☳☴☵☶☷⚊⚋⚌",
];

function seededRng(seed: number) {
    return () => {
        seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function makeSBox(rng: () => number): Uint8Array {
    const sbox = new Uint8Array(256);
    for (let i = 0; i < 256; i++) sbox[i] = i;
    for (let i = 255; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [sbox[i], sbox[j]] = [sbox[j], sbox[i]];
    }
    return sbox;
}

function invertSBox(sbox: Uint8Array): Uint8Array {
    const inv = new Uint8Array(256);
    for (let i = 0; i < 256; i++) inv[sbox[i]] = i;
    return inv;
}

function encrypt(plaintext: string, technique: number): string {
    const prefixed = "NC:" + plaintext;
    const raw = new TextEncoder().encode(prefixed);
    const base = (technique + 1) * 7919 + 31337;
    const xorRng = seededRng(base);
    const sbox = makeSBox(seededRng(base + 65537));
    const noiseRng = seededRng(base + 99991);
    const charset = NOISE_CHARSETS[technique % NOISE_CHARSETS.length];

    const xored = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) xored[i] = raw[i] ^ Math.floor(xorRng() * 256);

    const substituted = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) substituted[i] = sbox[xored[i]];

    let hex = "";
    for (let i = 0; i < substituted.length; i++) {
        hex += substituted[i].toString(16).padStart(2, "0");
        if (noiseRng() < 0.35) hex += charset[Math.floor(noiseRng() * charset.length)];
    }

    return MARKER + hex;
}

function decrypt(ciphertext: string, technique: number): string | null {
    if (!ciphertext.startsWith(MARKER)) return null;
    const stripped = ciphertext.slice(3).replace(/[^0-9a-fA-F]/g, "");
    if (stripped.length < 2 || stripped.length % 2 !== 0) return null;

    const bytes = new Uint8Array(stripped.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(stripped.slice(i * 2, i * 2 + 2), 16);

    const base = (technique + 1) * 7919 + 31337;
    const xorRng = seededRng(base);
    const sbox = makeSBox(seededRng(base + 65537));
    const inv = invertSBox(sbox);

    const unsubstituted = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) unsubstituted[i] = inv[bytes[i]];

    const plain = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) plain[i] = unsubstituted[i] ^ Math.floor(xorRng() * 256);

    let text: string;
    try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(plain);
    } catch {
        return null;
    }
    return text.startsWith("NC:") ? text.slice(3) : null;
}

function isEncrypted(text: string): boolean {
    return text.startsWith(MARKER);
}

function autoDecrypt(ciphertext: string): { text: string; technique: number; } | null {
    if (!ciphertext.startsWith(MARKER)) return null;
    for (let t = 0; t < 400; t++) {
        const result = decrypt(ciphertext, t);
        if (result !== null) return { text: result, technique: t };
    }
    return null;
}

let encryptionEnabled = false;

function LockIcon({ enabled, width = 20, height = 20 }: { enabled: boolean; width?: number; height?: number; }) {
    return (
        <svg width={width} height={height} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            {enabled
                ? <path fill="currentColor" d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM12 17c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zM15.1 8H8.9V6c0-1.71 1.39-3.1 3.1-3.1s3.1 1.39 3.1 3.1v2z" />
                : <path fill="currentColor" opacity="0.8" d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h2c0-1.66 1.34-3 3-3s3 1.34 3 3v2h-2V6c0-1.71-1.39-3.1-3.1-3.1S8.9 4.29 8.9 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z" />
            }
        </svg>
    );
}

const EncryptButton: ChatBarButtonFactory = ({ type }) => {
    const [enabled, setEnabled] = React.useState(encryptionEnabled);

    if (!["normal", "sidebar"].some(n => type.analyticsName === n) || encryptSettings.store.location !== "chatbar") return null;

    const tooltip = enabled
        ? "Encryption active — random technique"
        : "Encryption disabled";

    return (
        <ChatBarButton
            tooltip={tooltip}
            onClick={() => {
                encryptionEnabled = !encryptionEnabled;
                setEnabled(encryptionEnabled);
            }}
        >
            <LockIcon enabled={enabled} />
        </ChatBarButton>
    );
};

/* ── Inline decryption accessory (like translate) ── */
const DecryptionSetters = new Map<string, (v: string | undefined) => void>();

function DecryptionAccessory({ message }: { message: Message; }) {
    const [decrypted, setDecrypted] = useState<string>();

    useEffect(() => {
        if ((message as any).vencordEmbeddedBy) return;
        DecryptionSetters.set(message.id, setDecrypted);
        return () => void DecryptionSetters.delete(message.id);
    }, []);

    if (!decrypted) return null;

    return (
        <span style={{ color: "var(--text-muted)", fontStyle: "italic", fontSize: "0.9em", lineHeight: "1.2rem", display: "block", marginTop: 4 }}>
            <LockIcon enabled={true} width={16} height={16} />
            {" "}
            {Parser.parse(decrypted)}
            <br />
            (decrypted —{" "}
            <button
                onClick={() => setDecrypted(undefined)}
                style={{
                    background: "none", border: "none", color: "var(--text-link)",
                    cursor: "pointer", padding: 0, font: "inherit", fontStyle: "italic",
                }}
            >
                Dismiss
            </button>
            {" | "}
            <button
                onClick={() => { navigator.clipboard.writeText(decrypted); Toasts.show({ message: "Copied!", type: Toasts.Type.SUCCESS, id: Toasts.genId() }); }}
                style={{
                    background: "none", border: "none", color: "var(--text-link)",
                    cursor: "pointer", padding: 0, font: "inherit", fontStyle: "italic",
                }}
            >
                Copy
            </button>
            )
        </span>
    );
}

const messageContextPatch = (children: any, { message }: { message: any; }) => {
    if (!children || !Array.isArray(children)) return;
    try {
        if (!message?.content || !isEncrypted(message.content)) return;
        children.splice(-1, 0, (
            <Menu.MenuGroup key="nc-encryption-group">
                <Menu.MenuItem
                    id="nc-decrypt-message"
                    label="🔓 Decrypt message"
                    action={() => {
                        const found = autoDecrypt(message.content);
                        if (found !== null) {
                            const setter = DecryptionSetters.get(message.id);
                            if (setter) {
                                setter(found.text);
                            } else {
                                Toasts.show({ message: `🔓 ${found.text}`, type: Toasts.Type.SUCCESS, id: Toasts.genId() });
                            }
                            Toasts.show({ message: `Technique detected: ${found.technique}`, type: Toasts.Type.MESSAGE, id: Toasts.genId() });
                        } else {
                            Toasts.show({
                                message: "❌ Unable to decrypt — no technique worked",
                                type: Toasts.Type.FAILURE,
                                id: Toasts.genId(),
                            });
                        }
                    }}
                />
            </Menu.MenuGroup>
        ));
    } catch (e) {
        console.error("[EncryptedMessage] Context menu patch error:", e);
    }
};

export default definePlugin({
    name: "EncryptedMessage",
    description: "Encrypts your messages with 400 unique techniques (0–399). A random technique is chosen each time you send a message. Only those who know the key can decrypt.",
    tags: ["Privacy", "Chat", "Nightcord"],
    authors: [{ name: "Nightcord", id: 0n }, TestcordDevs.x2b],
    dependencies: ["ChatInputButtonAPI", "MessageEventsAPI", "MessageAccessoriesAPI", "HeaderBarAPI"],
    settings: encryptSettings,

    chatBarButton: {
        icon: () => <LockIcon enabled={encryptionEnabled} />,
        render: EncryptButton,
    },

    renderMessageAccessory: (props: any) => props?.message ? <DecryptionAccessory message={props.message} /> : null,

    start() {
        addContextMenuPatch("message", messageContextPatch);
        const { location } = encryptSettings.store;
        if (location === "headerbar") {
            addHeaderBarButton("EncryptedMessage", () => (
                <HeaderBarButton
                    icon={() => <LockIcon enabled={encryptionEnabled} />}
                    tooltip="Encryption"
                    onClick={() => { encryptionEnabled = !encryptionEnabled; }}
                />
            ), 5);
        } else if (location === "channeltoolbar") {
            addChannelToolbarButton("EncryptedMessage", () => (
                <ChannelToolbarButton
                    icon={() => <LockIcon enabled={encryptionEnabled} />}
                    tooltip="Encryption"
                    onClick={() => { encryptionEnabled = !encryptionEnabled; }}
                />
            ), 5);
        }
    },

    stop() {
        removeContextMenuPatch("message", messageContextPatch);
        removeHeaderBarButton("EncryptedMessage");
        removeChannelToolbarButton("EncryptedMessage");
        encryptionEnabled = false;
    },

    async onBeforeMessageSend(_channelId: string, messageObj: { content: string; }) {
        if (!encryptionEnabled || !messageObj.content || messageObj.content.trim().length === 0) return;

        const technique = Math.floor(Math.random() * 400);
        const encrypted = encrypt(messageObj.content, technique);
        if (encrypted.length > 2000) {
            Toasts.show({
                message: `❌ Message too long to encrypt (${encrypted.length}/2000)`,
                type: Toasts.Type.FAILURE,
                id: Toasts.genId(),
            });
            return { cancel: true };
        }
        messageObj.content = encrypted;
    },
});
