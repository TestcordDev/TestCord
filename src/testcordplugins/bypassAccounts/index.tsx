/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { ModalContent, ModalFooter, ModalHeader, ModalRoot, ModalSize, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { Button, Forms, React, showToast, TextInput, Toasts, UserStore } from "@webpack/common";

const Flex = ({ children, style, ...props }: React.PropsWithChildren<{ style?: React.CSSProperties; }>) => (
    <div style={{ display: "flex", ...style }} {...props}>{children}</div>
);

interface PasswordGeneratorConfig {
    length: number;
    upperCase: boolean;
    lowerCase: boolean;
    digits: boolean;
    specialChars: boolean;
    unicodeChars: boolean;
    minSpecialChars: number;
    excludeSimilar: boolean;
    excludeAmbiguous: boolean;
}

const DEFAULT_PASSWORD_CONFIG: PasswordGeneratorConfig = {
    length: 20,
    upperCase: true,
    lowerCase: true,
    digits: true,
    specialChars: true,
    unicodeChars: false,
    minSpecialChars: 2,
    excludeSimilar: false,
    excludeAmbiguous: false
};

class PasswordGenerator {
    private static buildCharset(config: PasswordGeneratorConfig): string {
        let charset = "";
        if (config.upperCase) charset += "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        if (config.lowerCase) charset += "abcdefghijklmnopqrstuvwxyz";
        if (config.digits) charset += "0123456789";
        if (config.specialChars) charset += "!@#$%^&*()_+-=[]{}|;:,.<>?";

        if (config.unicodeChars) {
            charset += "ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞß";
            charset += "àáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ";
            charset += "€£¥©®™§¶†‡•…‰";
        }

        if (config.excludeSimilar) {
            charset = charset.replace(/[il1Lo0O]/g, "");
        }

        if (config.excludeAmbiguous) {
            charset = charset.replace(/[{}[\]()/\\'"~,;<>.]/g, "");
        }

        return charset;
    }

    static generatePassword(config: PasswordGeneratorConfig): string {
        const charset = this.buildCharset(config);
        if (!charset) return ""; // Return empty string when no charset selected

        let password = "";
        const specialChars = "!@#$%^&*()_+-=[]{}|;:,.<>?";
        let specialCount = 0;

        for (let i = 0; i < config.length; i++) {
            const char = charset[Math.floor(Math.random() * charset.length)];
            password += char;
            if (specialChars.includes(char)) specialCount++;
        }

        // Ensure minimum special characters
        while (config.specialChars && specialCount < config.minSpecialChars && password.length > 0) {
            const randomIndex = Math.floor(Math.random() * password.length);
            const randomSpecial = specialChars[Math.floor(Math.random() * specialChars.length)];

            if (!specialChars.includes(password[randomIndex])) {
                password = password.substring(0, randomIndex) + randomSpecial + password.substring(randomIndex + 1);
                specialCount++;
            }
        }

        return password;
    }
}

function PasswordConfigModal(modalProps: any & { onGenerate: (password: string) => void; }) {
    const [config, setConfig] = React.useState<PasswordGeneratorConfig>({ ...DEFAULT_PASSWORD_CONFIG });
    const [generatedPassword, setGeneratedPassword] = React.useState("");
    const [isGenerating, setIsGenerating] = React.useState(false);

    React.useEffect(() => {
        generatePassword(); // Generate initial password with default settings
    }, []);

    const updateConfig = (key: keyof PasswordGeneratorConfig, value: any) => {
        const newConfig = { ...config, [key]: value };
        setConfig(newConfig);

        // Generate new password whenever config changes
        try {
            const password = PasswordGenerator.generatePassword(newConfig);
            setGeneratedPassword(password);
        } catch (error) {
            setGeneratedPassword("");
        }
    };

    const generatePassword = () => {
        setIsGenerating(true);
        try {
            const password = PasswordGenerator.generatePassword(config);
            setGeneratedPassword(password);
        } catch (error) {
            showToast("Failed to generate password", Toasts.Type.FAILURE);
        } finally {
            setIsGenerating(false);
        }
    };

    const copyToClipboard = () => {
        navigator.clipboard.writeText(generatedPassword);
        showToast("Password copied to clipboard!", Toasts.Type.SUCCESS);
    };

    const usePassword = () => {
        if (generatedPassword) {
            modalProps.onGenerate(generatedPassword);
            modalProps.onClose();
        }
    };

    return (
        <ModalRoot {...modalProps} size={ModalSize.MEDIUM}>
            <ModalHeader>
                <Forms.FormTitle tag="h4">Password Generator</Forms.FormTitle>
            </ModalHeader>
            <ModalContent>
                <Flex style={{ gap: "15px", flexDirection: "column" }}>
                    <div style={{ padding: "12px", backgroundColor: "var(--background-secondary)", borderRadius: "8px" }}>
                        <Forms.FormTitle tag="h6">Generated Password</Forms.FormTitle>
                        <Flex style={{ gap: "8px", alignItems: "center" }}>
                            <TextInput value={generatedPassword} readOnly style={{ fontFamily: "monospace", flex: 1 }} />
                            <Button size={Button.Sizes.SMALL} color={Button.Colors.GREEN} onClick={copyToClipboard}>📋</Button>
                            <Button size={Button.Sizes.SMALL} color={Button.Colors.PRIMARY} onClick={generatePassword} disabled={isGenerating}>🔄</Button>
                        </Flex>
                    </div>

                    <Flex style={{ gap: "15px" }}>
                        <div style={{ flex: 1 }}>
                            <Forms.FormTitle tag="h6">Length: {config.length}</Forms.FormTitle>
                            <input type="range" min="8" max="64" value={config.length} onChange={e => updateConfig("length", parseInt(e.target.value))} style={{ width: "100%" }} />
                        </div>
                        {config.specialChars && (
                            <div style={{ flex: 1 }}>
                                <Forms.FormTitle tag="h6">Min Special: {config.minSpecialChars}</Forms.FormTitle>
                                <input type="range" min="0" max="10" value={config.minSpecialChars} onChange={e => updateConfig("minSpecialChars", parseInt(e.target.value))} style={{ width: "100%" }} />
                            </div>
                        )}
                    </Flex>

                    <Flex style={{ gap: "20px" }}>
                        <Flex style={{ gap: "10px", flexDirection: "column", flex: 1 }}>
                            <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <input type="checkbox" checked={config.upperCase} onChange={e => updateConfig("upperCase", e.target.checked)} />
                                <Forms.FormText>Uppercase (A-Z)</Forms.FormText>
                            </label>
                            <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <input type="checkbox" checked={config.lowerCase} onChange={e => updateConfig("lowerCase", e.target.checked)} />
                                <Forms.FormText>Lowercase (a-z)</Forms.FormText>
                            </label>
                            <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <input type="checkbox" checked={config.unicodeChars} onChange={e => updateConfig("unicodeChars", e.target.checked)} />
                                <Forms.FormText>Unicode (À,ñ,€,™...)</Forms.FormText>
                            </label>
                        </Flex>
                        <Flex style={{ gap: "10px", flexDirection: "column", flex: 1 }}>
                            <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <input type="checkbox" checked={config.digits} onChange={e => updateConfig("digits", e.target.checked)} />
                                <Forms.FormText>Digits (0-9)</Forms.FormText>
                            </label>
                            <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <input type="checkbox" checked={config.specialChars} onChange={e => updateConfig("specialChars", e.target.checked)} />
                                <Forms.FormText>Special (!@#$...)</Forms.FormText>
                            </label>
                            <div style={{ height: "24px" }}></div> {/* Spacer for alignment */}
                        </Flex>
                    </Flex>

                    <Flex style={{ gap: "20px" }}>
                        <label style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1 }}>
                            <input type="checkbox" checked={config.excludeSimilar} onChange={e => updateConfig("excludeSimilar", e.target.checked)} />
                            <Forms.FormText>Exclude similar (i,l,1,L,o,0,O)</Forms.FormText>
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1 }}>
                            <input type="checkbox" checked={config.excludeAmbiguous} onChange={e => updateConfig("excludeAmbiguous", e.target.checked)} />
                            <Forms.FormText>Exclude ambiguous</Forms.FormText>
                        </label>
                    </Flex>
                </Flex>
            </ModalContent>
            <ModalFooter>
                <Button color={Button.Colors.BRAND} onClick={usePassword} disabled={!generatedPassword}>Use Password</Button>
                <Button color={Button.Colors.GREEN} onClick={generatePassword} disabled={isGenerating}>Generate New</Button>
                <Button color={Button.Colors.PRIMARY} onClick={modalProps.onClose}>Cancel</Button>
            </ModalFooter>
        </ModalRoot>
    );
}

class FileTokenEncryption {
    private static readonly ALGORITHM = "AES-GCM";
    private static readonly KEY_LENGTH = 256;
    private static readonly IV_LENGTH = 12;
    private static readonly SALT_LENGTH = 16;

    private static async deriveKeyFromPassphrase(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
        const encoder = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
            "raw",
            encoder.encode(passphrase) as any,
            { name: "PBKDF2" },
            false,
            ["deriveKey"]
        );

        return crypto.subtle.deriveKey(
            {
                name: "PBKDF2",
                salt: salt as any,
                iterations: 100000,
                hash: "SHA-256"
            } as any,
            keyMaterial,
            { name: this.ALGORITHM, length: this.KEY_LENGTH } as any,
            false,
            ["encrypt", "decrypt"] as any
        );
    }

    static async encryptAccountData(accountData: any, passphrase: string): Promise<string> {
        const encoder = new TextEncoder();
        const salt = crypto.getRandomValues(new Uint8Array(this.SALT_LENGTH));
        const iv = crypto.getRandomValues(new Uint8Array(this.IV_LENGTH));
        const key = await this.deriveKeyFromPassphrase(passphrase, salt);

        const dataString = JSON.stringify(accountData);
        const encrypted = await crypto.subtle.encrypt(
            { name: this.ALGORITHM, iv },
            key,
            encoder.encode(dataString)
        );

        const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
        combined.set(salt);
        combined.set(iv, salt.length);
        combined.set(new Uint8Array(encrypted), salt.length + iv.length);

        return btoa(String.fromCharCode(...combined));
    }

    static async decryptAccountData(encryptedData: string, passphrase: string): Promise<any> {
        const decoder = new TextDecoder();

        const combined = new Uint8Array(
            atob(encryptedData).split("").map(char => char.charCodeAt(0))
        );

        const salt = combined.slice(0, this.SALT_LENGTH);
        const iv = combined.slice(this.SALT_LENGTH, this.SALT_LENGTH + this.IV_LENGTH);
        const encrypted = combined.slice(this.SALT_LENGTH + this.IV_LENGTH);

        const key = await this.deriveKeyFromPassphrase(passphrase, salt);

        const decrypted = await crypto.subtle.decrypt(
            { name: this.ALGORITHM, iv },
            key,
            encrypted
        );

        const dataString = decoder.decode(decrypted);
        return JSON.parse(dataString);
    }
}

class FileAccountManager {
    private static accounts = new Map<string, { username: string; token: string; }>();
    private static currentFilePath: string | null = null;
    private static currentPassphrase: string | null = null;

    static async loadAccountsFromFile(file: File, passphrase: string): Promise<void> {
        try {
            const fileContent = await file.text();
            const decryptedData = await FileTokenEncryption.decryptAccountData(fileContent, passphrase);

            if (!decryptedData.accounts || !Array.isArray(decryptedData.accounts)) {
                throw new Error("Invalid file format");
            }

            this.accounts.clear();
            for (const account of decryptedData.accounts) {
                if (account.id && account.username && account.token) {
                    this.accounts.set(account.id, {
                        username: account.username,
                        token: account.token
                    });
                }
            }

            this.currentFilePath = file.name;
            this.currentPassphrase = passphrase;
        } catch (error) {
            console.error("Failed to load accounts:", error);
            throw new Error("Failed to decrypt file. Check your passphrase.");
        }
    }

    static async saveAccountsToFile(): Promise<void> {
        if (!this.currentPassphrase) {
            throw new Error("No passphrase set");
        }

        const accountData = {
            version: "1.0",
            createdAt: new Date().toISOString(),
            accounts: Array.from(this.accounts.entries()).map(([id, data]) => ({
                id,
                username: data.username,
                token: data.token
            }))
        };

        const encryptedData = await FileTokenEncryption.encryptAccountData(accountData, this.currentPassphrase);

        const blob = new Blob([encryptedData], { type: "text/plain" });
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = this.currentFilePath || `discord_accounts_${Date.now()}.dct`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    static addAccount(id: string, username: string, token: string): void {
        this.accounts.set(id, { username, token });
    }

    static removeAccount(id: string): boolean {
        return this.accounts.delete(id);
    }

    static getAccounts(): Array<{ id: string; username: string; token: string; }> {
        return Array.from(this.accounts.entries()).map(([id, data]) => ({
            id,
            username: data.username,
            token: data.token
        }));
    }

    static hasAccountsLoaded(): boolean {
        return this.currentPassphrase !== null && this.currentFilePath !== null;
    }

    static getCurrentFilePath(): string | null {
        return this.currentFilePath;
    }

    static setPassphrase(passphrase: string): void {
        this.currentPassphrase = passphrase;
    }
}

function loginWithToken(token: string) {
    const loginInterval = setInterval(() => {
        const iframe = document.createElement("iframe");
        document.body.appendChild(iframe);
        if (iframe.contentWindow) {
            try {
                iframe.contentWindow.localStorage.token = `"${token}"`;
            } catch (error) {
                console.warn("iframe localStorage access failed:", error);
            }
        }
        document.body.removeChild(iframe);
    }, 50);

    setTimeout(() => {
        clearInterval(loginInterval);
        location.reload();
    }, 2500);
}

function LoadAccountsModal(modalProps: any & { onAccountsLoaded: () => void; }) {
    const [passphrase, setPassphrase] = React.useState("");
    const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
    const [isLoading, setIsLoading] = React.useState(false);
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            if (!file.name.endsWith(".dct")) {
                showToast("Please select a .dct file", Toasts.Type.FAILURE);
                return;
            }
            setSelectedFile(file);
        }
    };

    const copyPassphrase = () => {
        navigator.clipboard.writeText(passphrase);
        showToast("Passphrase copied to clipboard!", Toasts.Type.SUCCESS);
    };

    const handleLoadAccounts = async () => {
        if (!selectedFile || !passphrase.trim()) {
            showToast("Please select a file and enter passphrase", Toasts.Type.FAILURE);
            return;
        }

        setIsLoading(true);
        try {
            await FileAccountManager.loadAccountsFromFile(selectedFile, passphrase);
            showToast("Accounts loaded successfully!", Toasts.Type.SUCCESS);
            modalProps.onAccountsLoaded();
            modalProps.onClose();
        } catch (error) {
            showToast(error instanceof Error ? error.message : "Failed to load accounts", Toasts.Type.FAILURE);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <ModalRoot {...modalProps} size={ModalSize.MEDIUM}>
            <ModalHeader>
                <Forms.FormTitle tag="h4">Load Accounts File</Forms.FormTitle>
            </ModalHeader>
            <ModalContent>
                <Flex style={{ gap: "15px", flexDirection: "column" }}>
                    <div>
                        <Forms.FormTitle tag="h6">Select File</Forms.FormTitle>
                        <input ref={fileInputRef} type="file" accept=".dct" onChange={handleFileSelect} style={{ display: "none" }} />
                        <Flex style={{ gap: "10px", alignItems: "center" }}>
                            <Button size={Button.Sizes.SMALL} color={Button.Colors.PRIMARY} onClick={() => fileInputRef.current?.click()}>
                                Choose File
                            </Button>
                            <Forms.FormText>{selectedFile ? selectedFile.name : "No file selected"}</Forms.FormText>
                        </Flex>
                    </div>

                    <div>
                        <Forms.FormTitle tag="h6">Passphrase</Forms.FormTitle>
                        <Flex style={{ gap: "8px" }}>
                            <TextInput placeholder="Enter passphrase..." value={passphrase} onChange={setPassphrase} type="password" style={{ flex: 1 }} />
                            <Button size={Button.Sizes.SMALL} color={Button.Colors.GREEN} onClick={copyPassphrase} disabled={!passphrase}>📋</Button>
                        </Flex>
                    </div>
                </Flex>
            </ModalContent>
            <ModalFooter>
                <Button color={Button.Colors.BRAND} onClick={handleLoadAccounts} disabled={isLoading || !selectedFile || !passphrase.trim()}>
                    {isLoading ? "Loading..." : "Load Accounts"}
                </Button>
                <Button color={Button.Colors.PRIMARY} onClick={modalProps.onClose}>Cancel</Button>
            </ModalFooter>
        </ModalRoot>
    );
}

function AddAccountModal(modalProps: any & { onAccountAdded: () => void; }) {
    const [username, setUsername] = React.useState("");
    const [token, setToken] = React.useState("");

    const handleAddAccount = async () => {
        if (!username.trim() || !token.trim()) {
            showToast("Please enter both username and token", Toasts.Type.FAILURE);
            return;
        }

        const accountId = `account_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        FileAccountManager.addAccount(accountId, username.trim(), token.trim());

        showToast("Account added successfully!", Toasts.Type.SUCCESS);
        modalProps.onAccountAdded();
        modalProps.onClose();
    };

    return (
        <ModalRoot {...modalProps} size={ModalSize.MEDIUM}>
            <ModalHeader>
                <Forms.FormTitle tag="h4">Add New Account</Forms.FormTitle>
            </ModalHeader>
            <ModalContent>
                <Flex style={{ gap: "15px", flexDirection: "column" }}>
                    <div>
                        <Forms.FormTitle tag="h6">Username</Forms.FormTitle>
                        <TextInput placeholder="Enter username..." value={username} onChange={setUsername} />
                    </div>
                    <div>
                        <Forms.FormTitle tag="h6">Discord Token</Forms.FormTitle>
                        <TextInput placeholder="Enter token..." value={token} onChange={setToken} type="password" />
                    </div>
                    <Forms.FormText {...{ type: (Forms.FormText as any).Types?.WARNING } as any}>⚠️ Save your file after adding tokens!</Forms.FormText>
                </Flex>
            </ModalContent>
            <ModalFooter>
                <Button color={Button.Colors.BRAND} onClick={handleAddAccount} disabled={!username.trim() || !token.trim()}>Add Account</Button>
                <Button color={Button.Colors.PRIMARY} onClick={modalProps.onClose}>Cancel</Button>
            </ModalFooter>
        </ModalRoot>
    );
}

function CreateAccountsFileModal(modalProps: any & { onFileCreated: () => void; }) {
    const [passphrase, setPassphrase] = React.useState("");
    const [confirmPassphrase, setConfirmPassphrase] = React.useState("");
    const [fileName, setFileName] = React.useState(`discord_accounts_${Date.now()}.dct`);
    const [isCreating, setIsCreating] = React.useState(false);

    const openPasswordGenerator = () => {
        openModal(props => (
            <PasswordConfigModal {...props} onGenerate={password => {
                setPassphrase(password);
                setConfirmPassphrase(password);
            }} />
        ));
    };

    const copyPassphrase = () => {
        navigator.clipboard.writeText(passphrase);
        showToast("Passphrase copied to clipboard!", Toasts.Type.SUCCESS);
    };

    const handleCreateFile = async () => {
        if (!passphrase.trim()) {
            showToast("Please enter a passphrase", Toasts.Type.FAILURE);
            return;
        }

        if (passphrase !== confirmPassphrase) {
            showToast("Passphrases do not match", Toasts.Type.FAILURE);
            return;
        }

        setIsCreating(true);
        try {
            FileAccountManager.setPassphrase(passphrase);

            const emptyData = {
                version: "1.0",
                createdAt: new Date().toISOString(),
                accounts: []
            };

            const encryptedData = await FileTokenEncryption.encryptAccountData(emptyData, passphrase);

            const blob = new Blob([encryptedData], { type: "text/plain" });
            const url = URL.createObjectURL(blob);

            const a = document.createElement("a");
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            showToast("Accounts file created!", Toasts.Type.SUCCESS);
            modalProps.onFileCreated();
            modalProps.onClose();
        } catch (error) {
            showToast("Failed to create accounts file", Toasts.Type.FAILURE);
        } finally {
            setIsCreating(false);
        }
    };

    return (
        <ModalRoot {...modalProps} size={ModalSize.MEDIUM}>
            <ModalHeader>
                <Forms.FormTitle tag="h4">Create New Accounts File</Forms.FormTitle>
            </ModalHeader>
            <ModalContent>
                <Flex style={{ gap: "15px", flexDirection: "column" }}>
                    <div>
                        <Forms.FormTitle tag="h6">File Name</Forms.FormTitle>
                        <TextInput value={fileName} onChange={setFileName} />
                    </div>

                    <div>
                        <Forms.FormTitle tag="h6">Passphrase</Forms.FormTitle>
                        <Flex style={{ gap: "8px" }}>
                            <TextInput placeholder="Enter passphrase..." value={passphrase} onChange={setPassphrase} type="password" style={{ flex: 1 }} />
                            <Button size={Button.Sizes.SMALL} color={Button.Colors.GREEN} onClick={copyPassphrase} disabled={!passphrase}>📋</Button>
                            <Button size={Button.Sizes.SMALL} color={Button.Colors.PRIMARY} onClick={openPasswordGenerator}>🎲</Button>
                        </Flex>
                    </div>

                    <div>
                        <Forms.FormTitle tag="h6">Confirm Passphrase</Forms.FormTitle>
                        <TextInput placeholder="Re-enter passphrase..." value={confirmPassphrase} onChange={setConfirmPassphrase} type="password" />
                    </div>

                    <Forms.FormText {...{ type: (Forms.FormText as any).Types?.WARNING } as any}>🔒 Remember this passphrase!</Forms.FormText>
                </Flex>
            </ModalContent>
            <ModalFooter>
                <Button color={Button.Colors.BRAND} onClick={handleCreateFile} disabled={isCreating || !passphrase.trim() || passphrase !== confirmPassphrase}>
                    {isCreating ? "Creating..." : "Create File"}
                </Button>
                <Button color={Button.Colors.PRIMARY} onClick={modalProps.onClose}>Cancel</Button>
            </ModalFooter>
        </ModalRoot>
    );
}

function AccountSwitcherModal(modalProps: any) {
    const [accounts, setAccounts] = React.useState<Array<{ id: string; username: string; token: string; isActive: boolean; }>>([]);
    const [isLoading, setIsLoading] = React.useState(false);
    const currentUser = UserStore.getCurrentUser();

    React.useEffect(() => {
        loadAccounts();
    }, []);

    const loadAccounts = () => {
        const fileAccounts = FileAccountManager.getAccounts();
        const accountsWithStatus = fileAccounts.map(account => ({
            ...account,
            isActive: false
        }));

        if (currentUser) {
            accountsWithStatus.unshift({
                id: currentUser.id,
                username: currentUser.username,
                token: "current",
                isActive: true
            });
        }

        setAccounts(accountsWithStatus);
    };

    const switchToAccount = (account: { id: string; username: string; token: string; }) => {
        if (account.token === "current") {
            showToast("Already using this account", Toasts.Type.MESSAGE);
            return;
        }

        setIsLoading(true);
        showToast(`Switching to ${account.username}...`, Toasts.Type.SUCCESS);
        loginWithToken(account.token);
        modalProps.onClose();
    };

    const removeAccount = (accountId: string) => {
        const success = FileAccountManager.removeAccount(accountId);
        if (success) {
            loadAccounts();
            showToast("Account removed", Toasts.Type.SUCCESS);
        }
    };

    const openLoadModal = () => {
        modalProps.onClose();
        openModal(props => (
            <LoadAccountsModal {...props} onAccountsLoaded={() => {
                setTimeout(() => openModal(newProps => <AccountSwitcherModal {...newProps} />), 100);
            }} />
        ));
    };

    const openAddModal = () => {
        modalProps.onClose();
        openModal(props => (
            <AddAccountModal {...props} onAccountAdded={() => {
                setTimeout(() => openModal(newProps => <AccountSwitcherModal {...newProps} />), 100);
            }} />
        ));
    };

    const openCreateModal = () => {
        modalProps.onClose();
        openModal(props => (
            <CreateAccountsFileModal {...props} onFileCreated={() => {
                setTimeout(() => openModal(newProps => <AccountSwitcherModal {...newProps} />), 100);
            }} />
        ));
    };

    const saveAccountsFile = async () => {
        try {
            await FileAccountManager.saveAccountsToFile();
            showToast("Accounts saved to file!", Toasts.Type.SUCCESS);
        } catch (error) {
            showToast("Failed to save accounts file", Toasts.Type.FAILURE);
        }
    };

    return (
        <ModalRoot {...modalProps} size={ModalSize.LARGE}>
            <ModalHeader>
                <Forms.FormTitle tag="h4">Account Switcher</Forms.FormTitle>
                <Forms.FormText {...{ type: (Forms.FormText as any).Types?.DESCRIPTION } as any}>
                    {FileAccountManager.hasAccountsLoaded()
                        ? `Loaded: ${FileAccountManager.getCurrentFilePath() || "accounts file"} (${FileAccountManager.getAccounts().length} accounts)`
                        : "No accounts file loaded"
                    }
                </Forms.FormText>
            </ModalHeader>
            <ModalContent>
                <Flex style={{ gap: "15px", flexDirection: "column" }}>
                    {!FileAccountManager.hasAccountsLoaded() ? (
                        <Flex style={{ justifyContent: "center", padding: "20px", flexDirection: "column", alignItems: "center" }}>
                            <Forms.FormText>No accounts loaded</Forms.FormText>
                            <Forms.FormText {...{ type: (Forms.FormText as any).Types?.DESCRIPTION } as any}>
                                Load an existing file or create a new one to get started
                            </Forms.FormText>
                        </Flex>
                    ) : (
                        <Flex style={{ flexDirection: "column", gap: "8px" }}>
                            {accounts.map(account => (
                                <Flex
                                    key={account.id}
                                    style={{
                                        gap: "12px",
                                        padding: "10px",
                                        backgroundColor: account.isActive ? "var(--background-modifier-accent)" : "var(--background-secondary)",
                                        borderRadius: "6px",
                                        border: account.isActive ? "2px solid var(--brand-experiment)" : "1px solid var(--background-tertiary)",
                                        alignItems: "center"
                                    }}
                                >
                                    <div style={{
                                        width: "32px",
                                        height: "32px",
                                        borderRadius: "50%",
                                        backgroundColor: "var(--brand-experiment)",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center"
                                    }}>
                                        <Forms.FormText style={{ color: "white", fontWeight: "bold" }}>
                                            {account.username.charAt(0).toUpperCase()}
                                        </Forms.FormText>
                                    </div>

                                    <Flex style={{ flexDirection: "column", flex: 1 }}>
                                        <Forms.FormTitle tag="h6" style={{ margin: 0 }}>
                                            {account.username}
                                        </Forms.FormTitle>
                                        <Forms.FormText {...{ type: account.isActive ? (Forms.FormText as any).Types?.SUCCESS : (Forms.FormText as any).Types?.DESCRIPTION } as any}>
                                            {account.isActive ? "Active Account" : "Ready to switch"}
                                        </Forms.FormText>
                                    </Flex>

                                    <Flex style={{ gap: "6px" }}>
                                        {!account.isActive && (
                                            <>
                                                <Button size={Button.Sizes.SMALL} color={Button.Colors.BRAND} onClick={() => switchToAccount(account)} disabled={isLoading}>
                                                    Switch
                                                </Button>
                                                {account.token !== "current" && (
                                                    <Button size={Button.Sizes.SMALL} color={Button.Colors.RED} onClick={() => removeAccount(account.id)} disabled={isLoading}>
                                                        Remove
                                                    </Button>
                                                )}
                                            </>
                                        )}
                                    </Flex>
                                </Flex>
                            ))}
                        </Flex>
                    )}
                </Flex>
            </ModalContent>
            <ModalFooter>
                <Button color={Button.Colors.BRAND} onClick={openLoadModal}>Load File</Button>
                <Button color={Button.Colors.PRIMARY} onClick={openCreateModal}>Create New</Button>
                <Button color={Button.Colors.PRIMARY} onClick={openAddModal} disabled={!FileAccountManager.hasAccountsLoaded()}>Add Account</Button>
                <Button color={Button.Colors.GREEN} onClick={saveAccountsFile} disabled={!FileAccountManager.hasAccountsLoaded()}>Save File</Button>
                <Button color={Button.Colors.PRIMARY} onClick={modalProps.onClose}>Close</Button>
            </ModalFooter>
        </ModalRoot>
    );
}

const settings = definePluginSettings({
    enableQuickSwitch: {
        description: "Enable Alt+G hotkey to quickly open account switcher",
        default: true,
        type: OptionType.BOOLEAN,
    }
});

export default definePlugin({
    name: "bypassAccounts",
    description: "Discord account switcher with file-based encrypted token storage.",
    tags: ["Utility", "Privacy"],
    authors: [TestcordDevs.dot],
    settings,

    async start() {
        if (settings.store.enableQuickSwitch) {
            document.addEventListener("keydown", this.handleQuickSwitch);
        }
    },

    stop() {
        document.removeEventListener("keydown", this.handleQuickSwitch);
    },

    handleQuickSwitch(event: KeyboardEvent) {
        if (event.altKey && event.key === "g") {
            event.preventDefault();

            openModal(modalProps => (
                <AccountSwitcherModal {...modalProps} />
            ));
        }
    }
});
