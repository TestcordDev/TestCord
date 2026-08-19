/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import "./styles.css";
import { DataStore } from "@api/index";
import { Flex } from "@components/Flex";
import SettingsPlugin from "@plugins/_core/settings";
import { TestcordDevs } from "@utils/constants";
import * as Modal from "@utils/modal";
import definePlugin from "@utils/types";
import { Button, React, Text, TextInput } from "@webpack/common";
function LockIcon({ height = 20, width = 20, className }) {
    return (<svg className={className} aria-hidden="true" role="img" xmlns="http://www.w3.org/2000/svg" width={width} height={height} fill="none" viewBox="0 0 24 24">
            <path fill="currentColor" fillRule="evenodd" d="M6 9h1V6a5 5 0 0 1 10 0v3h1a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-8a3 3 0 0 1 3-3Zm9-3v3H9V6a3 3 0 1 1 6 0Zm-1 8a2 2 0 0 1-1 1.73V18a1 1 0 1 1-2 0v-2.27A2 2 0 1 1 14 14Z" clipRule="evenodd"/>
        </svg>);
}
class PasswordManager {
    passwords = {};
    encryptionKey = null;
    _masterHash = null;
    get masterHash() {
        return this._masterHash;
    }
    async init() {
        const storedHash = await DataStore.get("passwordManager.masterHash");
        this._masterHash = storedHash || null;
        const stored = await DataStore.get("passwordManager.data");
        if (stored && this._masterHash) {
            this.encryptionKey = await this.generateEncryptionKey(this._masterHash);
            this.passwords = await this.decrypt(stored);
        }
    }
    async setMasterPassword(password) {
        const encoder = new TextEncoder();
        const passwordBuffer = encoder.encode(password);
        const hashBuffer = await crypto.subtle.digest("SHA-256", passwordBuffer);
        this._masterHash = Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, "0"))
            .join("");
        await DataStore.set("passwordManager.masterHash", this._masterHash);
        this.encryptionKey = await this.generateEncryptionKey(this._masterHash);
    }
    async verifyMasterPassword(password) {
        const encoder = new TextEncoder();
        const passwordBuffer = encoder.encode(password);
        const hashBuffer = await crypto.subtle.digest("SHA-256", passwordBuffer);
        const hash = Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, "0"))
            .join("");
        return hash === this._masterHash;
    }
    async generateEncryptionKey(hash) {
        const hashBuffer = new Uint8Array(hash.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
        return await crypto.subtle.importKey("raw", hashBuffer, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    }
    async encrypt(data) {
        if (!this.encryptionKey)
            throw new Error("Encryption key not set");
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encoder = new TextEncoder();
        const dataBuffer = encoder.encode(JSON.stringify(data));
        const encryptedBuffer = await crypto.subtle.encrypt({
            name: "AES-GCM",
            iv
        }, this.encryptionKey, dataBuffer);
        const encryptedArray = new Uint8Array(encryptedBuffer);
        const combined = new Uint8Array(iv.length + encryptedArray.length);
        combined.set(iv);
        combined.set(encryptedArray, iv.length);
        return btoa(String.fromCharCode(...combined));
    }
    async decrypt(encryptedData) {
        if (!this.encryptionKey)
            throw new Error("Encryption key not set");
        const combined = new Uint8Array(atob(encryptedData).split("").map(c => c.charCodeAt(0)));
        const iv = combined.slice(0, 12);
        const encryptedArray = combined.slice(12);
        const decryptedBuffer = await crypto.subtle.decrypt({
            name: "AES-GCM",
            iv
        }, this.encryptionKey, encryptedArray);
        const decoder = new TextDecoder();
        return JSON.parse(decoder.decode(decryptedBuffer));
    }
    async save() {
        await DataStore.set("passwordManager.data", await this.encrypt(this.passwords));
    }
    addPassword(entry) {
        const id = crypto.randomUUID();
        const now = Date.now();
        this.passwords[id] = {
            ...entry,
            id,
            createdAt: now,
            updatedAt: now
        };
        this.save();
    }
    async deletePassword(id, masterPassword) {
        if (!await this.verifyMasterPassword(masterPassword)) {
            return false;
        }
        delete this.passwords[id];
        await this.save();
        return true;
    }
    async generateTOTPCode(secret) {
        const epoch = Math.floor(Date.now() / 30000);
        const time = new ArrayBuffer(8);
        const view = new DataView(time);
        view.setUint32(4, epoch, false);
        return await this.generateHOTP(secret, time);
    }
    async generateHOTP(secret, counter) {
        try {
            const decodedSecret = atob(secret);
            const secretBytes = new TextEncoder().encode(decodedSecret);
            const key = await crypto.subtle.importKey("raw", secretBytes, {
                name: "HMAC",
                hash: { name: "SHA-1" }
            }, false, ["sign"]);
            const signature = await crypto.subtle.sign("HMAC", key, counter);
            const hmac = new Uint8Array(signature);
            const offset = hmac[hmac.length - 1] & 0xf;
            const code = ((hmac[offset] & 0x7f) << 24) |
                ((hmac[offset + 1] & 0xff) << 16) |
                ((hmac[offset + 2] & 0xff) << 8) |
                (hmac[offset + 3] & 0xff);
            return (code % 1000000).toString().padStart(6, "0");
        }
        catch (err) {
            console.error("Failed to generate HOTP:", err);
            return "000000";
        }
    }
}
const AddPasswordModal = ({ manager, onClose, ...props }) => {
    const [title, setTitle] = React.useState("");
    const [username, setUsername] = React.useState("");
    const [password, setPassword] = React.useState("");
    const [twoFactorSecret, setTwoFactorSecret] = React.useState("");
    return (<Modal.ModalRoot {...props}>
            <Modal.ModalHeader separator={false}>
                <Text variant="heading-lg/semibold">Add Password</Text>
            </Modal.ModalHeader>
            <Modal.ModalContent className="password-modal-content">
                <div className="password-modal-section">
                    <Text variant="heading-sm/medium" style={{ marginBottom: "8px" }}>Title</Text>
                    <TextInput placeholder="e.g., Discord Account" value={title} onChange={e => setTitle(e)}/>
                </div>
                <div className="password-modal-separator"/>
                <div className="password-modal-section">
                    <Text variant="heading-sm/medium" style={{ marginBottom: "8px" }}>Login Details</Text>
                    <Flex direction={Flex.Direction.VERTICAL} gap={10} {...{}}>
                        <TextInput placeholder="Username or Email" value={username} onChange={e => setUsername(e)}/>
                        <TextInput placeholder="Password" value={password} onChange={e => setPassword(e)} type="password"/>
                    </Flex>
                </div>
                <div className="password-modal-separator"/>
                <div className="password-modal-section">
                    <Text variant="heading-sm/medium" style={{ marginBottom: "8px" }}>Two-Factor Authentication (Optional)</Text>
                    <TextInput placeholder="2FA Secret Key" value={twoFactorSecret} onChange={e => setTwoFactorSecret(e)}/>
                </div>
            </Modal.ModalContent>
            <Modal.ModalFooter className="password-modal-footer">
                <Flex justify={Flex.Justify.END} gap={10} {...{}}>
                    <Button color={Button.Colors.BRAND} disabled={!title || !username || !password} onClick={() => {
            manager.addPassword({
                title,
                username,
                password,
                twoFactorSecret: twoFactorSecret || undefined,
                twoFactorType: twoFactorSecret ? "2fa_totp" : undefined
            });
            onClose();
        }}>
                        Save
                    </Button>
                    <Button color={Button.Colors.TRANSPARENT} onClick={onClose}>
                        Cancel
                    </Button>
                </Flex>
            </Modal.ModalFooter>
        </Modal.ModalRoot>);
};
const SetMasterPasswordModal = ({ manager, onSuccess, ...props }) => {
    const [password, setPassword] = React.useState("");
    const [confirmPassword, setConfirmPassword] = React.useState("");
    const [error, setError] = React.useState("");
    const mountedRef = React.useRef(true);
    React.useEffect(() => () => { mountedRef.current = false; }, []);
    return (<Modal.ModalRoot {...props}>
            <Modal.ModalHeader separator={false}>
                <Text variant="heading-lg/semibold">Set Master Password</Text>
            </Modal.ModalHeader>
            <Modal.ModalContent className="password-modal-content">
                <div className="password-modal-section">
                    <Flex direction={Flex.Direction.VERTICAL} gap={10} {...{}}>
                        <TextInput placeholder="Master Password" value={password} onChange={e => setPassword(e)} type="password"/>
                        <TextInput placeholder="Confirm Master Password" value={confirmPassword} onChange={e => setConfirmPassword(e)} type="password"/>
                        {error && <Text color="danger">{error}</Text>}
                    </Flex>
                </div>
            </Modal.ModalContent>
            <Modal.ModalFooter className="password-modal-footer">
                <Flex justify={Flex.Justify.END} gap={10} {...{}}>
                    <Button color={Button.Colors.BRAND} disabled={!password || !confirmPassword} onClick={async () => {
            if (password !== confirmPassword) {
                setError("Passwords don't match!");
                return;
            }
            await manager.setMasterPassword(password);
            if (!mountedRef.current)
                return;
            onSuccess?.();
            props.onClose();
        }}>
                        Save
                    </Button>
                    <Button color={Button.Colors.TRANSPARENT} onClick={props.onClose}>
                        Cancel
                    </Button>
                </Flex>
            </Modal.ModalFooter>
        </Modal.ModalRoot>);
};
const DeletePasswordModal = ({ manager, passwordId, passwordTitle, onSuccess, ...props }) => {
    const [masterPassword, setMasterPassword] = React.useState("");
    const [error, setError] = React.useState("");
    const mountedRef = React.useRef(true);
    React.useEffect(() => () => { mountedRef.current = false; }, []);
    return (<Modal.ModalRoot {...props}>
            <Modal.ModalHeader separator={false}>
                <Text variant="heading-lg/semibold">Delete Password</Text>
            </Modal.ModalHeader>
            <Modal.ModalContent className="password-modal-content">
                <div className="password-modal-section">
                    <Text>Are you sure you want to delete "{passwordTitle}"?</Text>
                    <Text>Enter your master password to confirm:</Text>
                    <TextInput placeholder="Master Password" value={masterPassword} onChange={e => setMasterPassword(e)} type="password"/>
                    {error && <Text color="danger">{error}</Text>}
                </div>
            </Modal.ModalContent>
            <Modal.ModalFooter className="password-modal-footer">
                <Flex justify={Flex.Justify.END} gap={10} {...{}}>
                    <Button color={Button.Colors.RED} disabled={!masterPassword} onClick={async () => {
            const success = await manager.deletePassword(passwordId, masterPassword);
            if (!mountedRef.current)
                return;
            if (success) {
                onSuccess();
                props.onClose();
            }
            else {
                setError("Incorrect master password");
            }
        }}>
                        Delete
                    </Button>
                    <Button color={Button.Colors.TRANSPARENT} onClick={props.onClose}>
                        Cancel
                    </Button>
                </Flex>
            </Modal.ModalFooter>
        </Modal.ModalRoot>);
};
const ViewPasswordModal = ({ manager, entry, ...props }) => {
    const [masterPassword, setMasterPassword] = React.useState("");
    const [showPassword, setShowPassword] = React.useState(false);
    const [error, setError] = React.useState("");
    const mountedRef = React.useRef(true);
    React.useEffect(() => () => { mountedRef.current = false; }, []);
    const verifyAndShow = async () => {
        const isValid = await manager.verifyMasterPassword(masterPassword);
        if (!mountedRef.current)
            return;
        if (isValid) {
            setShowPassword(true);
        }
        else {
            setError("Incorrect master password");
        }
    };
    return (<Modal.ModalRoot {...props}>
            <Modal.ModalHeader separator={false}>
                <Text variant="heading-lg/semibold">View Password for {entry.title}</Text>
            </Modal.ModalHeader>
            <Modal.ModalContent className="password-modal-content">
                <div className="password-modal-section">
                    {!showPassword ? (<>
                            <Text>Enter your master password to view:</Text>
                            <TextInput placeholder="Master Password" value={masterPassword} onChange={e => setMasterPassword(e)} type="password"/>
                            {error && <Text color="danger">{error}</Text>}
                        </>) : (<Flex direction={Flex.Direction.VERTICAL} gap={10} {...{}}>
                            <div className="password-view-section">
                                <Text variant="heading-sm/medium">Username</Text>
                                <Text>{entry.username}</Text>
                            </div>
                            <div className="password-view-section">
                                <Text variant="heading-sm/medium">Password</Text>
                                <Text>{entry.password}</Text>
                            </div>
                            {entry.twoFactorSecret && (<div className="password-view-section">
                                    <Text variant="heading-sm/medium">2FA Secret</Text>
                                    <Text>{entry.twoFactorSecret}</Text>
                                </div>)}
                        </Flex>)}
                </div>
            </Modal.ModalContent>
            <Modal.ModalFooter className="password-modal-footer">
                <Flex justify={Flex.Justify.END} gap={10} {...{}}>
                    {!showPassword ? (<Button color={Button.Colors.BRAND} disabled={!masterPassword} onClick={verifyAndShow}>
                            View
                        </Button>) : (<Button color={Button.Colors.BRAND} onClick={props.onClose}>
                            Close
                        </Button>)}
                    <Button color={Button.Colors.TRANSPARENT} onClick={props.onClose}>
                        Cancel
                    </Button>
                </Flex>
            </Modal.ModalFooter>
        </Modal.ModalRoot>);
};
const PasswordEntryComponent = ({ entry, manager, onDelete }) => {
    const [totpCode, setTotpCode] = React.useState("");
    React.useEffect(() => {
        if (entry.twoFactorSecret && entry.twoFactorType === "2fa_totp") {
            let cancelled = false;
            const updateCode = async () => {
                const code = await manager.generateTOTPCode(entry.twoFactorSecret);
                if (cancelled)
                    return;
                setTotpCode(code);
            };
            updateCode();
            const interval = setInterval(updateCode, 1000);
            return () => { cancelled = true; clearInterval(interval); };
        }
    }, [entry.twoFactorSecret, entry.twoFactorType, manager]);
    const copyToClipboard = async (text) => {
        try {
            await navigator.clipboard.writeText(text);
        }
        catch {
            const textarea = document.createElement("textarea");
            textarea.value = text;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand("copy");
            document.body.removeChild(textarea);
        }
    };
    return (<div className="password-entry" key={entry.id}>
            <div>
                <Text variant="heading-sm/medium">{entry.title}</Text>
                <Text>{entry.username}</Text>
            </div>
            <div className="password-actions">
                <Button size={Button.Sizes.SMALL} color={Button.Colors.BRAND} onClick={() => {
            Modal.openModal((props) => (<ViewPasswordModal {...props} manager={manager} entry={entry}/>));
        }}>
                    View
                </Button>
                <Button size={Button.Sizes.SMALL} onClick={() => copyToClipboard(entry.password)}>
                    Copy Password
                </Button>
                {totpCode && (<Button size={Button.Sizes.SMALL} onClick={() => copyToClipboard(totpCode)}>
                        2FA: {totpCode}
                    </Button>)}
                <Button size={Button.Sizes.SMALL} color={Button.Colors.RED} onClick={() => {
            Modal.openModal((props) => (<DeletePasswordModal {...props} manager={manager} passwordId={entry.id} passwordTitle={entry.title} onSuccess={onDelete}/>));
        }}>
                    Delete
                </Button>
            </div>
        </div>);
};
class PasswordManagerUI {
    manager;
    hasMasterPassword;
    forceUpdate;
    constructor(manager) {
        this.manager = manager;
        this.hasMasterPassword = Boolean(manager.masterHash);
        this.forceUpdate = () => { };
    }
    render = () => {
        const [, setUpdateKey] = React.useState({});
        this.forceUpdate = () => setUpdateKey({});
        if (!this.hasMasterPassword) {
            return (<div className="password-manager-container">
                    <Flex direction={Flex.Direction.VERTICAL} gap={10} {...{}}>
                        <Text variant="heading-lg/semibold">Password Manager Setup</Text>
                        <Text>Please set a master password to start using the password manager.</Text>
                        <Button onClick={() => {
                    Modal.openModal((props) => (<SetMasterPasswordModal {...props} manager={this.manager} onSuccess={() => {
                            this.hasMasterPassword = Boolean(this.manager.masterHash);
                            this.forceUpdate();
                        }}/>));
                }}>
                            Set Master Password
                        </Button>
                    </Flex>
                </div>);
        }
        return (<div className="password-manager-container">
                <Flex {...{ justify: Flex.Justify.BETWEEN, align: Flex.Align.CENTER }}>
                    <Text variant="heading-lg/semibold">Password Manager</Text>
                    <Button onClick={() => {
                Modal.openModal((props) => (<AddPasswordModal {...props} manager={this.manager} onClose={() => {
                        props.onClose();
                        this.forceUpdate();
                    }}/>));
            }}>
                        Add Password
                    </Button>
                </Flex>
                {Object.values(this.manager.passwords).map(entry => (<PasswordEntryComponent key={entry.id} entry={entry} manager={this.manager} onDelete={this.forceUpdate}/>))}
            </div>);
    };
}
export default definePlugin({
    name: "PasswordManager",
    description: "Securely store and manage your passwords",
    tags: ["Privacy", "Utility"],
    authors: [TestcordDevs.x2b],
    passwordManager: null,
    ui: null,
    async start() {
        this.passwordManager = new PasswordManager();
        await this.passwordManager.init();
        this.ui = new PasswordManagerUI(this.passwordManager);
        const settingsPlugin = Vencord.Plugins.plugins.Settings;
        if (settingsPlugin && settingsPlugin.customEntries) {
            settingsPlugin.customEntries.push({
                key: "passwordManager",
                title: "Password Manager",
                Component: () => this.ui.render(),
                Icon: LockIcon
            });
        }
    },
    stop() {
        const { customEntries } = SettingsPlugin;
        const entry = customEntries.findIndex(entry => entry.key === "passwordManager");
        if (entry !== -1)
            customEntries.splice(entry, 1);
        this.passwordManager = null;
        this.ui = null;
    }
});
