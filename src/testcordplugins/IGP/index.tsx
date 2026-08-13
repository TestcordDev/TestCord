/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { addChannelToolbarButton, addHeaderBarButton, ChannelToolbarButton, HeaderBarButton, removeChannelToolbarButton, removeHeaderBarButton } from "@api/HeaderBar";
import { DataStore } from "@api/index";
import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, React, SelectedChannelStore, showToast, Toasts, UserStore } from "@webpack/common";

import { buildDecryptModal } from "./decryptModal";
import { buildModal } from "./modal";

const IGPIcon = () => (
    <svg version="1.1" width="20" height="20" viewBox="0 0 47 47">
        <g>
            <path fill="currentColor" d="M23.5,0C10.522,0,0,10.522,0,23.5C0,36.479,10.522,47,23.5,47C36.479,47,47,36.479,47,23.5C47,10.522,36.479,0,23.5,0z
            M30.07,34.686L30.07,34.686c0,2.53-2.941,4.58-6.573,4.58c-3.631,0-6.577-2.05-6.577-4.58c0-0.494,3.648-14.979,3.648-14.979
            c-2.024-1.06-3.418-3.161-3.418-5.609c0-3.515,2.838-6.362,6.361-6.362c3.514,0,6.35,2.848,6.35,6.362
            c0,2.448-1.391,4.55-3.416,5.609c0,0,3.598,14.455,3.611,14.88l0.022,0.099H30.07z" />
        </g>
    </svg>
);

const ChatBarIcon: ChatBarButtonFactory = ({ isMainChat, channel }) => {
    if (!isMainChat || settings.store.location !== "chatbar") return null;

    if (!channel || (channel.type !== 1 && channel.type !== 3)) {
        return null; // not a DM or Group DM → don't render
    }

    return (
        <ChatBarButton
            tooltip="PGP/GPG Encrypt"
            onClick={() => buildModal()}

            buttonProps={{
                "aria-haspopup": "dialog",
            }}

        >
            <svg version="1.1"
                id="Capa_1"
                width="20"
                height="20"
                viewBox="0 0 47 47"
            >
                <g>
                    <path fill="currentColor" d="M23.5,0C10.522,0,0,10.522,0,23.5C0,36.479,10.522,47,23.5,47C36.479,47,47,36.479,47,23.5C47,10.522,36.479,0,23.5,0z
                    M30.07,34.686L30.07,34.686c0,2.53-2.941,4.58-6.573,4.58c-3.631,0-6.577-2.05-6.577-4.58c0-0.494,3.648-14.979,3.648-14.979
                    c-2.024-1.06-3.418-3.161-3.418-5.609c0-3.515,2.838-6.362,6.361-6.362c3.514,0,6.35,2.848,6.35,6.362
                    c0,2.448-1.391,4.55-3.416,5.609c0,0,3.598,14.455,3.611,14.88l0.022,0.099H30.07z" />
                </g>
            </svg>

        </ChatBarButton>
    );
};

function DecryptMessageIcon() {
    return (
        <svg
            fill="currentColor"
            width={20} height={20}
            viewBox={"0 0 16 16"}
        >
            <path d="M10.5 9C12.9853 9 15 6.98528 15 4.5C15 2.01472 12.9853 0 10.5 0C8.01475 0 6.00003 2.01472 6.00003 4.5C6.00003 5.38054 6.25294 6.20201 6.69008 6.89574L0.585815 13L3.58292 15.9971L4.99714 14.5829L3.41424 13L5.00003 11.4142L6.58292 12.9971L7.99714 11.5829L6.41424 10L8.10429 8.30995C8.79801 8.74709 9.61949 9 10.5 9ZM10.5 7C11.8807 7 13 5.88071 13 4.5C13 3.11929 11.8807 2 10.5 2C9.11932 2 8.00003 3.11929 8.00003 4.5C8.00003 5.88071 9.11932 7 10.5 7Z" />
        </svg>
    );
}

function formatKey(key: string): string {
    const start: string = key.match(/-----.*?-----/g)?.at(0)?.toString()!;
    const end: string = key.match(/-----.*?-----/g)?.pop()?.toString()!;

    return start + key.replace(start, "").replace(end, "").replaceAll(" ", "\n") + end;
}

function normalizeSingleLineKey(key: string): string {
    // Remove extra whitespace and normalize the key
    const normalized = key.trim();

    // If the key appears to be in single-line format, try to reformat it
    if (!normalized.includes("\n") && normalized.includes("-----BEGIN PGP") && normalized.includes("-----END PGP")) {
        // Extract the header
        const headerMatch = normalized.match(/(-----BEGIN PGP [^-----]+-----)/);
        const header = headerMatch ? headerMatch[1] : "";

        // Extract the footer
        const footerMatch = normalized.match(/(-----END PGP [^-----]+-----)/);
        const footer = footerMatch ? footerMatch[1] : "";

        // Extract the content between header and footer
        let content = normalized;
        if (header) content = content.replace(header, "");
        if (footer) content = content.replace(footer, "");

        // Clean up extra spaces and split into reasonable chunks
        content = content.trim().replace(/\s+/g, " ");

        // Try to identify base64-like segments and put them on separate lines
        // This is a heuristic approach that looks for base64-like patterns
        const segments = content.split(" ");
        const formattedSegments: string[] = [];

        let currentLine = "";
        for (const segment of segments) {
            if (segment.trim() === "") continue;

            // If segment is very long (likely base64), put it on its own line
            if (segment.length > 64 && segment.match(/^[A-Za-z0-9+/=]+$/)) {
                if (currentLine) {
                    formattedSegments.push(currentLine.trim());
                    currentLine = "";
                }
                formattedSegments.push(segment);
            } else {
                // Otherwise, add to current line if it won't be too long
                if ((currentLine + " " + segment).length <= 76) {
                    currentLine = currentLine ? currentLine + " " + segment : segment;
                } else {
                    if (currentLine) formattedSegments.push(currentLine.trim());
                    currentLine = segment;
                }
            }
        }

        if (currentLine) formattedSegments.push(currentLine.trim());

        // Combine everything with proper formatting
        let result = header + "\n";
        if (formattedSegments.length > 0) {
            result += "\n"; // Add blank line after header as per PGP standard
            result += formattedSegments.join("\n");
            result += "\n";
        }
        result += footer;

        return result;
    }

    // If it's already formatted, return as is
    return normalized;
}

let openpgp: any = null;
let openpgpLoaded = false;
let openpgpLoadPromise: Promise<void> | null = null;
const injectedScripts: HTMLScriptElement[] = [];
const logger = new Logger("VGP");

async function loadOpenPGP(): Promise<void> {
    if (openpgpLoaded) return;
    if (openpgpLoadPromise) return openpgpLoadPromise;

    openpgpLoadPromise = new Promise((resolve, reject) => {
        // First try to load from unpkg
        const script = document.createElement("script");
        script.src = "https://unpkg.com/openpgp@5.11.3/dist/openpgp.min.js";
        script.onload = () => {
            const loadedOpenpgp = (window as any).openpgp;
            if (!loadedOpenpgp) {
                reject(new Error("OpenPGP.js loaded but global object not available"));
                return;
            }
            openpgp = loadedOpenpgp;
            openpgpLoaded = true;
            logger.info("OpenPGP.js loaded from CDN");
            resolve();
        };
        script.onerror = async () => {
            logger.warn("Failed to load from unpkg, trying jsDelivr...");
            // Fallback to jsDelivr CDN
            const script2 = document.createElement("script");
            script2.src = "https://cdn.jsdelivr.net/npm/openpgp@5.11.3/dist/openpgp.min.js";
            script2.onload = () => {
                const loadedOpenpgp = (window as any).openpgp;
                if (!loadedOpenpgp) {
                    reject(new Error("OpenPGP.js loaded but global object not available"));
                    return;
                }
                openpgp = loadedOpenpgp;
                openpgpLoaded = true;
                logger.info("OpenPGP.js loaded from jsDelivr CDN");
                resolve();
            };
            script2.onerror = () => {
                reject(new Error("Failed to load OpenPGP.js from both CDNs"));
            };
            injectedScripts.push(script2);
            document.head.appendChild(script2);
        };
        injectedScripts.push(script);
        document.head.appendChild(script);
    });

    return openpgpLoadPromise;
}

function requireOpenPGP() {
    if (!openpgpLoaded || !openpgp) {
        throw new Error("OpenPGP.js not loaded yet. Please wait a moment and try again.");
    }
    return openpgp;
}

async function ensureOpenPGP() {
    if (!openpgpLoaded) {
        await loadOpenPGP();
    }
}

// Normalize keys before processing to handle single-line inputs
export function preprocessKey(key: string): string {
    return normalizeSingleLineKey(key);
}

// Key Generation Functionality
async function generateKeyPair(name: string, email: string, passphrase: string, type: "ecc" | "rsa" = "ecc"): Promise<{ publicKey: string; privateKey: string; }> {
    await ensureOpenPGP();
    const pgp = requireOpenPGP();

    const keyOptions: any = {
        type,
        userIDs: [{ name, email }],
        passphrase,
        format: "armored",
    };

    if (type === "ecc") {
        keyOptions.curve = "curve25519";
    } else {
        keyOptions.rsaBits = 4096;
    }

    const { privateKey, publicKey } = await pgp.generateKey(keyOptions);
    settings.store.pgpPrivateKey = privateKey;
    settings.store.pgpPublicKey = publicKey;
    settings.store.passphrase = passphrase;
    return { publicKey, privateKey };
}

export async function encrypt(message: string, public_key_recipient: string): Promise<string> {
    await ensureOpenPGP();
    const pgp = requireOpenPGP();

    let private_key, public_key;

    try {
        const privateKeyObj = await pgp.readPrivateKey({ armoredKey: formatKey(settings.store.pgpPrivateKey) });
        // Decrypt private key if it requires a passphrase
        if (!privateKeyObj.isDecrypted()) {
            const { passphrase } = settings.store;
            if (!passphrase) {
                throw new Error("Passphrase required for private key but not provided");
            }
            private_key = await pgp.decryptKey({ privateKey: privateKeyObj, passphrase });
        } else {
            private_key = privateKeyObj;
        }
        public_key = await pgp.readKey({ armoredKey: formatKey(settings.store.pgpPublicKey) });
    } catch (e) {
        showToast("Cannot read your private or public key, try setting them again in the plugin settings", Toasts.Type.FAILURE);
        throw e;
    }

    // Preprocess the recipient's key to handle single-line format
    const processedKey = preprocessKey(public_key_recipient);
    let pubKey_r;
    try {
        pubKey_r = await pgp.readKey({ armoredKey: processedKey });
    } catch (e) {
        showToast("The recipient's public key is not valid!", Toasts.Type.FAILURE);
        throw e;
    }

    try {
        const encrypted = await pgp.encrypt({
            message: await pgp.createMessage({ text: message }),
            encryptionKeys: [pubKey_r, public_key],
            signingKeys: [private_key]
        });

        return encrypted;
    } catch (e) {
        if (e instanceof Error) {
            showToast("Error during encryption.\n" + (e as Error).message, Toasts.Type.FAILURE);
        }
        throw e;
    }
}

interface StoredKey {
    publicKey: string;
    fingerprint: string;
    userIDs: string[];
    addedAt: number;
    verified: boolean;
}

class KeyManager {
    private keyCache: Map<string, StoredKey> = new Map();
    private initialized = false;

    constructor() {
    }

    private loadKeys(): void {
        if (this.initialized) return;
        try {
            const stored = JSON.parse(settings.store?.knownPublicKeys || "{}");
            this.keyCache = new Map(Object.entries(stored || {}));
            this.initialized = true;
            logger.info(`Loaded ${this.keyCache.size} known public keys`);
        } catch (err) {
            logger.error("Failed to load keys:", err);
            this.keyCache = new Map();
            this.initialized = true;
        }
    }

    private ensureInitialized() {
        if (!this.initialized) {
            this.loadKeys();
        }
    }

    private saveKeys(): void {
        this.ensureInitialized();
        const obj = Object.fromEntries(this.keyCache);
        settings.store.knownPublicKeys = JSON.stringify(obj);
    }

    getVerifiedKeyForUser(userId: string): StoredKey | null {
        this.ensureInitialized();
        return this.keyCache.get(userId) || null;
    }

    async importPublicKeyForUser(userId: string, armoredKey: string): Promise<StoredKey> {
        this.ensureInitialized();
        await ensureOpenPGP();
        const pgp = requireOpenPGP();
        // Preprocess the key to handle single-line format
        const processedKey = preprocessKey(armoredKey);
        const key = await pgp.readKey({ armoredKey: processedKey });
        const storedKey: StoredKey = {
            publicKey: processedKey, // Store the processed key
            fingerprint: key.getFingerprint().toUpperCase(),
            userIDs: key.getUserIDs(),
            addedAt: Date.now(),
            verified: false,
        };
        this.keyCache.set(userId, storedKey);
        this.saveKeys();
        logger.info(`Imported public key for user ${userId}`);
        return storedKey;
    }

    getPublicKeyForUser(userId: string): string | null {
        this.ensureInitialized();
        return this.keyCache.get(userId)?.publicKey || null;
    }

    getAllKeysWithUsers(): Array<{ userId: string; key: StoredKey; }> {
        this.ensureInitialized();
        return Array.from(this.keyCache.entries()).map(([userId, key]) => ({ userId, key }));
    }

    removeKeyForUser(userId: string): boolean {
        this.ensureInitialized();
        const had = this.keyCache.delete(userId);
        if (had) this.saveKeys();
        return had;
    }

    verifyKey(userId: string): boolean {
        const stored = this.keyCache.get(userId);
        if (!stored) return false;
        stored.verified = true;
        this.saveKeys();
        return true;
    }
}

const keyManager = new KeyManager();

export const KEYSERVERS = {
    OPENPGP: "https://keys.openpgp.org",
    UBUNTU: "https://keyserver.ubuntu.com",
    MIT: "https://pgp.mit.edu",
} as const;

export type KeyserverName = keyof typeof KEYSERVERS;

async function searchKeyserver(query: string, keyserver: KeyserverName = "OPENPGP"): Promise<{ found: boolean; keys: string[]; }> {
    const serverUrl = KEYSERVERS[keyserver];
    try {
        const searchParam = query.includes("@") ? query : (query.startsWith("0x") ? query : `0x${query}`);
        const response = await fetch(`${serverUrl}/pks/lookup?op=get&options=mr&search=${encodeURIComponent(searchParam)}`);
        if (response.ok) {
            const text = await response.text();
            const keys = text.match(/-----BEGIN PGP PUBLIC KEY BLOCK-----[\s\S]*?-----END PGP PUBLIC KEY BLOCK-----/g) || [];
            return { found: keys.length > 0, keys };
        }
        return { found: false, keys: [] };
    } catch {
        return { found: false, keys: [] };
    }
}

async function decryptMessage(message: string, authorId: string): Promise<any> {
    await ensureOpenPGP();
    const pgp = requireOpenPGP();

    // Check if the message is a signed message that contains an encrypted message inside
    if (message.includes("-----BEGIN PGP SIGNED MESSAGE-----")) {
        // This is a signed message, not an encrypted one
        // We need to extract the content and handle it appropriately
        try {
            // Parse the signed message to extract the content
            const signedMsg = await pgp.readCleartextMessage({ cleartextMessage: message });
            const content = signedMsg.getText();

            // Check if the content itself contains an encrypted message
            if (content.includes("-----BEGIN PGP MESSAGE-----") && content.includes("-----END PGP MESSAGE-----")) {
                // Extract the encrypted message and try to decrypt it separately
                const encryptedPart = content.match(/-----BEGIN PGP MESSAGE-----[\s\S]*?-----END PGP MESSAGE-----/g);
                if (encryptedPart && encryptedPart.length > 0) {
                    // Recursively call decrypt on the extracted encrypted part
                    return await decryptMessage(encryptedPart[0], authorId);
                }
            }

            // If we get here, it's a signed message without an encrypted part inside
            // So we should verify it instead of trying to decrypt it
            const verificationResult = await verifyMessage(message);
            return { data: verificationResult.text, verified: verificationResult.valid };
        } catch (e: any) {
            showToast("Cannot process signed message: " + e.message, Toasts.Type.FAILURE);
            throw e;
        }
    }

    let private_key;
    try {
        const privateKeyObj = await pgp.readPrivateKey({ armoredKey: formatKey(settings.store.pgpPrivateKey) });
        // Decrypt private key if it requires a passphrase
        if (!privateKeyObj.isDecrypted()) {
            const { passphrase } = settings.store;
            if (!passphrase) {
                throw new Error("Passphrase required for private key but not provided");
            }
            private_key = await pgp.decryptKey({ privateKey: privateKeyObj, passphrase });
        } else {
            private_key = privateKeyObj;
        }
    } catch (e) {
        showToast("Cannot read personal private key", Toasts.Type.FAILURE);
        throw e;
    }

    let verificationKeyArmored: string = "";

    // If the author is the current user, use the user's public key for verification
    if (authorId === UserStore.getCurrentUser().id) {
        verificationKeyArmored = formatKey(settings.store.pgpPublicKey);
    } else {
        // First check our key manager for the sender's key
        const senderId = ChannelStore.getChannel(SelectedChannelStore.getChannelId()).recipients[0];
        const keyFromManager = keyManager.getPublicKeyForUser(senderId);
        if (keyFromManager) {
            verificationKeyArmored = keyFromManager;
        } else {
            // Fall back to the legacy DataStore approach
            try {
                const dataStorageKeys = await DataStore.get("gpgPublicKeys");
                if (dataStorageKeys) {
                    const publicKeys = JSON.parse(dataStorageKeys);
                    if (publicKeys[senderId]) {
                        verificationKeyArmored = publicKeys[senderId];
                    }
                }
            } catch (e) {
                showToast("Cannot find the senders signature", Toasts.Type.FAILURE);
                throw e;
            }
        }
    }

    const verificationKey = await pgp.readKey({ armoredKey: verificationKeyArmored });

    let decrypted;
    try {
        decrypted = await pgp.decrypt({
            message: await pgp.readMessage({ armoredMessage: message }),
            decryptionKeys: [private_key],
            // Set to false to see the message anyways, but will show the key not verified warning
            expectSigned: false,
            verificationKeys: [verificationKey]
        });
    } catch (e) {
        showToast("Cannot decrypt message: check your private key", Toasts.Type.FAILURE);
        throw e;
    }

    // Verify signature
    const { signatures } = decrypted;
    let verified = false;
    if (signatures && signatures.length > 0) {
        try {
            const verificationResult = await signatures[0].verified;
            // If verification completes without error, signature is valid
            verified = true;
        } catch (verificationError) {
            console.error("Signature verification failed:", verificationError);
            verified = false;
        }
    }

    return { ...decrypted, verified };
}

// Message signing and verification functions
async function signMessage(text: string): Promise<string> {
    await ensureOpenPGP();
    const pgp = requireOpenPGP();

    // Check if we have a private key set up
    if (!settings.store.pgpPrivateKey) {
        throw new Error("No private key configured. Please set up your PGP keys in plugin settings.");
    }

    let privateKey;
    try {
        const privateKeyObj = await pgp.readPrivateKey({ armoredKey: formatKey(settings.store.pgpPrivateKey) });
        // Decrypt private key if it requires a passphrase
        if (!privateKeyObj.isDecrypted()) {
            const { passphrase } = settings.store;
            if (!passphrase) {
                throw new Error("Passphrase required for private key but not provided");
            }
            privateKey = await pgp.decryptKey({ privateKey: privateKeyObj, passphrase });
        } else {
            privateKey = privateKeyObj;
        }
    } catch (e) {
        showToast("Cannot read your private key", Toasts.Type.FAILURE);
        throw e;
    }

    const message = await pgp.createCleartextMessage({ text });
    return await pgp.sign({ message, signingKeys: privateKey, format: "armored" });
}

async function verifyMessage(signedMessage: string): Promise<{ valid: boolean; text: string; signedBy?: string; }> {
    await ensureOpenPGP();
    const pgp = requireOpenPGP();

    try {
        let message;
        let text;
        let signatures;

        // Determine the type of message and handle accordingly
        if (signedMessage.includes("-----BEGIN PGP SIGNED MESSAGE-----")) {
            // This is a cleartext signed message
            message = await pgp.readCleartextMessage({ cleartextMessage: signedMessage });

            // Prepare verification keys - include our own public key and known contact keys
            const verificationKeys: any[] = [];
            if (settings.store.pgpPublicKey) {
                verificationKeys.push(await pgp.readKey({ armoredKey: formatKey(settings.store.pgpPublicKey) }));
            }

            // Add all known public keys from key manager
            for (const { key } of keyManager.getAllKeysWithUsers()) {
                try {
                    verificationKeys.push(await pgp.readKey({ armoredKey: key.publicKey }));
                } catch { /* skip invalid keys */ }
            }

            if (verificationKeys.length === 0) {
                return { valid: false, text: message.getText() };
            }

            const result = await pgp.verify({ message, verificationKeys });
            text = result.data;
            signatures = result.signatures;
        } else {
            // This might be a signed and encrypted message
            // We need to parse the message to determine the correct verification approach
            const parsedMessage = await pgp.readMessage({ armoredMessage: signedMessage });

            // Prepare verification keys - include our own public key and known contact keys
            const verificationKeys: any[] = [];
            if (settings.store.pgpPublicKey) {
                verificationKeys.push(await pgp.readKey({ armoredKey: formatKey(settings.store.pgpPublicKey) }));
            }

            // Add all known public keys from key manager
            for (const { key } of keyManager.getAllKeysWithUsers()) {
                try {
                    verificationKeys.push(await pgp.readKey({ armoredKey: key.publicKey }));
                } catch { /* skip invalid keys */ }
            }

            if (verificationKeys.length === 0) {
                return { valid: false, text: "No verification keys available" };
            }

            // Attempt to verify the message
            const result = await pgp.verify({ message: parsedMessage, verificationKeys });
            text = result.data;
            signatures = result.signatures;
        }

        // Process signatures
        // Check if there are any signatures to verify
        if (!signatures || signatures.length === 0) {
            console.log("No signatures found in the message");
            return { valid: false, text: text };
        }

        for (const sig of signatures) {
            try {
                // Verify the signature
                const verificationResult = await sig.verified;
                // If verification doesn't throw, the signature is valid
                return { valid: true, text, signedBy: sig.keyID.toHex() };
            } catch (verificationError) {
                console.error("Signature verification failed:", verificationError);
                // Continue to try next signature
            }
        }

        return { valid: false, text };
    } catch (err) {
        return { valid: false, text: "", signedBy: `Error: ${err}` };
    }
}

function formatFingerprint(fp: string): string {
    return fp.match(/.{1,4}/g)?.join(" ") || fp;
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
    pgpPrivateKey: {
        type: OptionType.STRING,
        description: "Your PGP private key (armored format)",
        tags: ["Utility"],
        default: "",
        hidden: false,
    },
    pgpPublicKey: {
        type: OptionType.STRING,
        description: "Your PGP public key (armored format)",
        default: "",
        hidden: false,
    },
    passphrase: {
        type: OptionType.STRING,
        description: "Passphrase for your private key",
        default: "",
        hidden: false,
    },
    knownPublicKeys: {
        type: OptionType.STRING,
        description: "JSON map of user IDs to their public keys",
        default: "{}",
        hidden: false,
    },
    signMessages: {
        type: OptionType.BOOLEAN,
        description: "Sign encrypted messages with your private key",
        default: true,
    },
    encryptionIndicator: {
        type: OptionType.STRING,
        description: "Prefix for encrypted messages (visual indicator)",
        default: "🔒",
    },
});

export default definePlugin({
    name: "IGP",
    description: "Illegalcord PGP encryption",
    authors: [{ name: "irritably", id: 928787166916640838n }],
    tags: ["Privacy"],
    dependencies: ["HeaderBarAPI"],
    settings,

    chatBarButton: {
        icon: IGPIcon as any,
        render: ChatBarIcon,
    },
    decryptMessageIcon: () => <DecryptMessageIcon />,

    start() {
        const { location } = settings.store;
        if (location === "headerbar") {
            addHeaderBarButton("IGP", () => (
                <HeaderBarButton
                    icon={IGPIcon}
                    tooltip="PGP/GPG Encrypt"
                    onClick={() => buildModal()}
                />
            ), 5);
        } else if (location === "channeltoolbar") {
            addChannelToolbarButton("IGP", () => (
                <ChannelToolbarButton
                    icon={IGPIcon}
                    tooltip="PGP/GPG Encrypt"
                    onClick={() => buildModal()}
                />
            ), 5);
        }
    },

    stop() {
        removeHeaderBarButton("IGP");
        removeChannelToolbarButton("IGP");
        for (const script of injectedScripts) {
            try { script.remove(); } catch { }
        }
        injectedScripts.length = 0;
        openpgp = null;
        openpgpLoaded = false;
        openpgpLoadPromise = null;
        try { delete (window as any).openpgp; } catch { }
    },

    GPG_REGEX: /-----BEGIN PGP MESSAGE-----[A-Za-z0-9+/=\r\n]+?-----END PGP MESSAGE-----/g,
    renderMessagePopoverButton(message) {
        return this.GPG_REGEX.test(message?.content) ?
            {
                label: "Decrypt Message",
                icon: this.decryptMessageIcon,
                message: message,
                channel: ChannelStore.getChannel(message.channel_id),
                onClick: async () => {
                    const decrypted = await decryptMessage(message.content, message.author.id);
                    buildDecryptModal(decrypted.data, decrypted.verified);
                }
            }
            : null;
    },

    commands: [
        {
            name: "pgp",
            description: "PGP encryption commands",
            options: [
                {
                    name: "encrypt", description: "Encrypt a message", type: 1, options: [
                        { name: "message", description: "Message to encrypt", type: 3, required: true },
                        { name: "user", description: "Recipient", type: 6, required: true }
                    ]
                },
                {
                    name: "decrypt", description: "Decrypt a message", type: 1, options: [
                        { name: "message", description: "PGP message to decrypt", type: 3, required: true }
                    ]
                },
                {
                    name: "sign", description: "Sign a message", type: 1, options: [
                        { name: "message", description: "Message to sign", type: 3, required: true }
                    ]
                },
                {
                    name: "verify", description: "Verify a signed message", type: 1, options: [
                        { name: "message", description: "Signed message to verify", type: 3, required: true }
                    ]
                },
                { name: "sharekey", description: "Share your public key", type: 1 },
                { name: "fingerprint", description: "Show your key fingerprint", type: 1 },
                {
                    name: "generate", description: "Generate a new PGP key pair", type: 1, options: [
                        { name: "name", description: "Your name", type: 3, required: true },
                        { name: "email", description: "Your email", type: 3, required: true },
                        { name: "passphrase", description: "Passphrase for private key", type: 3, required: true },
                        {
                            name: "type", description: "Key type", type: 3, choices: [
                                { name: "ECC (recommended)", label: "ECC (recommended)", value: "ecc" as any },
                                { name: "RSA 4096", label: "RSA 4096", value: "rsa" as any }
                            ]
                        }
                    ]
                },
                {
                    name: "import", description: "Import a contact's public key", type: 1, options: [
                        { name: "key", description: "Public key", type: 3, required: true },
                        { name: "user", description: "User ID", type: 6, required: true }
                    ]
                },
                {
                    name: "search", description: "Search for a public key", type: 1, options: [
                        { name: "query", description: "Email or key ID to search for", type: 3, required: true }
                    ]
                }
            ],
            async execute(args, ctx) {
                const sub = args[0];
                const getOpt = (n: string) => sub.options?.find((o: any) => o.name === n)?.value;

                try {
                    await ensureOpenPGP();

                    switch (sub.name) {
                        case "encrypt": {
                            const userOpt = getOpt("user");
                            const messageOpt = getOpt("message");

                            if (!userOpt || !messageOpt) {
                                return { content: "❌ Missing required options for encrypt" };
                            }

                            const userId = (userOpt as any).id;
                            const publicKey = keyManager.getPublicKeyForUser(userId);
                            if (!publicKey) return { content: "❌ No public key for this user. Use `/pgp import` to add their key." };

                            const encrypted = await encrypt(messageOpt, publicKey);
                            return { content: `${settings.store.encryptionIndicator}\n${encrypted}` };
                        }

                        case "decrypt": {
                            const messageOpt = getOpt("message");

                            if (!messageOpt) {
                                return { content: "❌ Message parameter is required for decrypt" };
                            }

                            const result = await decryptMessage(messageOpt, UserStore.getCurrentUser().id);
                            return { content: `🔓${result.verified ? " ✅" : ""}\n${result.data}` };
                        }

                        case "sign": {
                            if (!settings.store.pgpPrivateKey) return { content: "❌ No private key configured. Use `/pgp generate` to create keys or set them in plugin settings." };

                            const messageOpt = getOpt("message");

                            if (!messageOpt) {
                                return { content: "❌ Message parameter is required for sign" };
                            }

                            const signed = await signMessage(messageOpt);
                            return { content: `✍️\n\`\`\`\n${signed}\n\`\`\`` };
                        }

                        case "verify": {
                            const messageOpt = getOpt("message");

                            if (!messageOpt) {
                                return { content: "❌ Message parameter is required for verify" };
                            }

                            const result = await verifyMessage(messageOpt);
                            return result.valid ?
                                { content: `✅ Valid signature from ${result.signedBy}\n\n${result.text}` } :
                                { content: `❌ Invalid signature\n\n${result.text}` };
                        }

                        case "sharekey": {
                            const key = settings.store.pgpPublicKey;
                            return key ? { content: `📤\n\`\`\`\n${key}\n\`\`\`` } : { content: "❌ No public key configured" };
                        }

                        case "fingerprint": {
                            if (!settings.store.pgpPublicKey) return { content: "❌ No public key configured" };

                            await ensureOpenPGP();
                            const pgp = requireOpenPGP();
                            const key = await pgp.readKey({ armoredKey: formatKey(settings.store.pgpPublicKey) });
                            const fingerprint = key.getFingerprint().toUpperCase();
                            return { content: `🔑 \`${formatFingerprint(fingerprint)}\`` };
                        }

                        case "generate": {
                            const name = getOpt("name");
                            const email = getOpt("email");
                            const passphrase = getOpt("passphrase");

                            if (!name || !email || !passphrase) {
                                return { content: "❌ Name, email, and passphrase are required for key generation" };
                            }

                            const type = getOpt("type") || "ecc";

                            try {
                                await generateKeyPair(name, email, passphrase, type as "ecc" | "rsa");
                                return { content: `✅ Generated ${type.toUpperCase()} key pair. Your keys are now saved in plugin settings.` };
                            } catch (e) {
                                return { content: `❌ Error generating keys: ${e}` };
                            }
                        }

                        case "import": {
                            const userValue = getOpt("user");
                            const keyValue = getOpt("key");

                            if (!userValue || !keyValue) {
                                return { content: "❌ Missing required options for import" };
                            }

                            // Type assertion since we know user options have an id property
                            const userId = (userValue as any).id;
                            const key = preprocessKey(keyValue);

                            try {
                                await keyManager.importPublicKeyForUser(userId, key);
                                return { content: `✅ Imported public key for <@${userId}>` };
                            } catch (e) {
                                return { content: `❌ Error importing key: ${e}` };
                            }
                        }

                        case "search": {
                            const query = getOpt("query");

                            if (!query) {
                                return { content: "❌ Query parameter is required" };
                            }

                            try {
                                const result = await searchKeyserver(query);
                                if (result.found) {
                                    return { content: `🌐 Found ${result.keys.length} key(s) for "${query}". Use \`/pgp import\` to add them to your contacts.` };
                                } else {
                                    return { content: `🌐 No keys found for "${query}"` };
                                }
                            } catch (e) {
                                return { content: `❌ Error searching keyserver: ${e}` };
                            }
                        }
                    }
                } catch (e) {
                    return { content: `❌ Error: ${e}` };
                }
            }
        }
    ],
});
