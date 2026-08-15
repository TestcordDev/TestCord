/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { HeaderBarButton } from "@api/HeaderBar";
import { DataStore } from "@api/index";
import { isPluginEnabled } from "@api/PluginManager";
import { definePluginSettings, migratePluginSettings } from "@api/Settings";
import { FormSwitch } from "@components/FormSwitch";
import TokenLoginPlugin from "@testcordplugins/tokenLogin";
import { TestcordDevs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { copyWithToast } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { identity, sleep } from "@utils/misc";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, openModal, type RenderModalProps } from "@utils/modal";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { findByProps } from "@webpack";
import { Button, FluxDispatcher, Forms, IconUtils, React, Select, showToast, TextArea, Toasts, useEffect, useMemo, useRef, useState } from "@webpack/common";

import { type CheckTokenUser,isEncryptedPayload, TOKEN_REGEX_SOURCE } from "./common";

const cl = classNameFactory("vc-dxtokenimporter-");
const logger = new Logger("DXTokenImporter");
const Native = VencordNative.pluginHelpers.DXTokenImporter as PluginNative<typeof import("./native")>;
const STORE_KEY = "DXTokenImporter_accounts";
const ACK_KEY = "DXTokenImporter_ackedDangerousSettings";
const LEGACY_STORE_KEY = "TokenImporter_accounts";
const LEGACY_ACK_KEY = "TokenImporter_ackedDangerousSettings";

// Carries over saved accounts, danger acks and settings from the pre-rename
// TokenImporter plugin the first time DXTokenImporter runs.
migratePluginSettings("DXTokenImporter", "TokenImporter");

let legacyMigrated = false;
async function migrateLegacyData(): Promise<void> {
    if (legacyMigrated) return;
    legacyMigrated = true;
    try {
        if ((await DataStore.get(STORE_KEY)) === undefined) {
            const legacy = await DataStore.get<SavedAccount[]>(LEGACY_STORE_KEY);
            if (legacy) await DataStore.set(STORE_KEY, legacy);
        }
        if ((await DataStore.get(ACK_KEY)) === undefined) {
            const legacyAcks = await DataStore.get<DangerousSetting[]>(LEGACY_ACK_KEY);
            if (legacyAcks) await DataStore.set(ACK_KEY, legacyAcks);
        }
    } catch (e) {
        logger.warn("legacy data migration failed", e);
    }
}

const TOKEN_REGEX = new RegExp(TOKEN_REGEX_SOURCE, "g");
const TOKEN_SHAPE = new RegExp(`^${TOKEN_REGEX_SOURCE}$`);
const SNOWFLAKE_REGEX = /^\d{17,20}$/;

type ImportDestination = "both" | "importer" | "loginManager";

// Dangerous toggles are driven exclusively by settingsAboutComponent, which
// gates first enable behind a confirmation modal. Keeping them hidden here
// means the plain settings list can never flip them without that ack.
const settings = definePluginSettings({
    importDestination: {
        type: OptionType.SELECT,
        description: "Where bulk-imported tokens are saved. DXTokenImporter is this plugin's own encrypted store; Login Manager is the TokenLoginManager vault.",
        options: [
            { label: "Both", value: "both", default: true },
            { label: "DXTokenImporter only", value: "importer" },
            { label: "Login Manager only", value: "loginManager" },
        ],
    },
    encryptStoredTokens: {
        type: OptionType.BOOLEAN,
        description: "Encrypt saved tokens at rest using Electron safeStorage (OS keychain / DPAPI). When off, tokens are stored in plaintext in IndexedDB.",
        default: true,
        hidden: () => true,
    },
    enableQuickSwitch: {
        type: OptionType.BOOLEAN,
        description: "Enable an Alt+G hotkey to quickly open the account switcher.",
        default: false,
        hidden: () => true,
        restartNeeded: true,
    },
    enableLocalScan: {
        type: OptionType.BOOLEAN,
        description: "Allow the \"Scan local Discords\" button and the underlying local token-scraping code path. When off, the button is hidden and the auto-scan setting has no effect.",
        default: false,
        hidden: () => true,
    },
    autoScanOnStartup: {
        type: OptionType.BOOLEAN,
        description: "Automatically scan local Discord installs for tokens when the plugin starts (Windows only). Reads other Discord profiles' encrypted token blobs and decrypts them.",
        default: false,
        hidden: () => true,
        restartNeeded: true,
    },
    patchTokenStore: {
        type: OptionType.BOOLEAN,
        description: "Monkey-patch Discord's internal encryptAndStoreTokens so saved accounts are injected into Discord's own token storage. Required for saved accounts to appear in Discord's native account switcher.",
        default: false,
        hidden: () => true,
        restartNeeded: true,
    },
    injectIntoMultiAccountStore: {
        type: OptionType.BOOLEAN,
        description: "Dispatch fake MULTI_ACCOUNT_VALIDATE_TOKEN_SUCCESS Flux events on startup to register saved accounts with Discord's multi-account store.",
        default: false,
        hidden: () => true,
        restartNeeded: true,
    },
    useLocalStorageBypass: {
        type: OptionType.BOOLEAN,
        description: "When switching accounts, also write the token to localStorage. This bypasses Discord's localStorage scrubbing. When off, switching uses only the Webpack token-store API + reload.",
        default: false,
        hidden: () => true,
    },
});

// Routes parsed tokens into the TokenLoginManager vault, mirroring the original
// ImportMultiTokens behavior so that import path is preserved losslessly. Guarded
// so a missing or disabled TokenLoginManager plugin fails softly.
function routeToLoginManager(accounts: Array<{ username: string; token: string; }>): { ok: boolean; reason?: string; } {
    if (!isPluginEnabled("TokenLoginManager")) return { ok: false, reason: "TokenLoginManager is disabled" };
    const manager = TokenLoginPlugin.tokenLoginManager;
    if (!manager) return { ok: false, reason: "TokenLoginManager not initialized" };
    for (const { username, token } of accounts) manager.addAccount({ username, token });
    return { ok: true };
}

// Dangerous settings that surface a one-time confirmation the first time they're enabled.
const DANGEROUS_SETTINGS = [
    "autoScanOnStartup",
    "enableLocalScan",
    "patchTokenStore",
    "injectIntoMultiAccountStore",
    "useLocalStorageBypass",
] as const;
type DangerousSetting = typeof DANGEROUS_SETTINGS[number];

async function getAckedDangerous(): Promise<Set<DangerousSetting>> {
    await migrateLegacyData();
    const list = (await DataStore.get<DangerousSetting[]>(ACK_KEY)) ?? [];
    return new Set(list);
}

async function markAckedDangerous(key: DangerousSetting): Promise<void> {
    const list = (await DataStore.get<DangerousSetting[]>(ACK_KEY)) ?? [];
    if (!list.includes(key)) {
        list.push(key);
        await DataStore.set(ACK_KEY, list);
    }
}

interface SavedAccount {
    id: string;
    token: string;
    username: string;
    discriminator: string;
    /** avatar hash, resolved to a URL at render time via IconUtils */
    avatar: string | null;
    /** token blob could not be decrypted (e.g. profile moved to another OS user) */
    undecryptable?: boolean;
}

function accountFromUser(u: CheckTokenUser, token: string): SavedAccount {
    return {
        id: u.id,
        token,
        username: u.global_name || u.username,
        discriminator: u.discriminator ?? "0",
        avatar: u.avatar ?? null,
    };
}

// Older versions stored full CDN URLs; recover the hash so it can be re-resolved.
function normalizeAvatarHash(avatar: string | null | undefined): string | null {
    if (!avatar) return null;
    if (avatar.startsWith("http")) {
        const m = avatar.match(/\/avatars\/\d+\/(\w+)\./);
        return m?.[1] ?? null;
    }
    return avatar;
}

function avatarUrl(id: string, avatar: string | null | undefined): string {
    if (avatar) {
        // IconUtils wants a full User but only reads id and avatar
        // @ts-expect-error partial user object is enough at runtime
        return IconUtils.getUserAvatarURL({ id, avatar }, false, 64);
    }
    return IconUtils.getDefaultAvatarURL(id);
}

let accountsCache: SavedAccount[] | null = null;
let loadPromise: Promise<SavedAccount[]> | null = null;
let saveQueue: Promise<void> = Promise.resolve();

// On-disk shape may have token stored as plaintext or as an opaque encrypted
// string (safeStorage or built-in AES envelope). getAccounts transparently
// decrypts on read; native dispatches on the envelope prefix.
async function decryptIfNeeded(tok: string): Promise<string> {
    if (!isEncryptedPayload(tok)) return tok;
    try {
        return await Native.decryptStoredToken(tok) ?? tok;
    } catch (e) {
        logger.debug("decryptStoredToken failed", e);
        return tok;
    }
}

async function encryptIfEnabled(tok: string): Promise<string> {
    if (!settings.store.encryptStoredTokens || isEncryptedPayload(tok)) return tok;
    try {
        return await Native.encryptToken(tok) ?? tok;
    } catch (e) {
        logger.debug("encryptToken failed", e);
        return tok;
    }
}

function getAccounts(): Promise<SavedAccount[]> {
    if (accountsCache !== null) return Promise.resolve(accountsCache);
    if (!loadPromise) {
        loadPromise = migrateLegacyData().then(() => DataStore.get<SavedAccount[]>(STORE_KEY)).then(async raw => {
            const accounts: SavedAccount[] = [];
            for (const a of raw ?? []) {
                const token = await decryptIfNeeded(a.token);
                accounts.push({
                    ...a,
                    token,
                    avatar: normalizeAvatarHash(a.avatar),
                    undecryptable: isEncryptedPayload(token),
                });
            }
            accountsCache = accounts;
            loadPromise = null;
            return accounts;
        });
    }
    return loadPromise;
}

// Serialized so two open modals can't interleave reads and writes.
function saveAccounts(accounts: SavedAccount[]): Promise<void> {
    const task = saveQueue.then(() => persistAccounts(accounts));
    saveQueue = task.catch(() => { });
    return task;
}

async function persistAccounts(accounts: SavedAccount[]): Promise<void> {
    const unique = new Map<string, SavedAccount>();
    for (const a of accounts) {
        unique.set(a.id, a); // Always overwrite so an updated token for an existing account is kept
    }
    const deduplicated = Array.from(unique.values());
    accountsCache = deduplicated;
    const onDisk: SavedAccount[] = [];
    let encryptionFailed = false;
    for (const a of deduplicated) {
        const encrypted = await encryptIfEnabled(a.token);
        // Blobs that are already encrypted (e.g. locked accounts) pass through
        // unchanged by design; only a plaintext round-trip means real failure.
        if (settings.store.encryptStoredTokens && !isEncryptedPayload(a.token) && encrypted === a.token) encryptionFailed = true;
        onDisk.push({ ...a, token: encrypted });
    }
    await DataStore.set(STORE_KEY, onDisk);
    if (encryptionFailed)
        showToast("Both encryption backends failed, tokens were saved in plain text", Toasts.Type.FAILURE);
}

let tokenModulePatched = false;
let originalEncryptAndStoreTokens: ((tokens: Record<string, string>) => unknown) | null = null;

async function patchTokenStore() {
    if (tokenModulePatched) return;
    if (!settings.store.patchTokenStore) return;
    try {
        const tokenMod = findByProps("getToken", "encryptAndStoreTokens");
        if (!tokenMod?.encryptAndStoreTokens) return;
        originalEncryptAndStoreTokens = tokenMod.encryptAndStoreTokens;
        const orig = tokenMod.encryptAndStoreTokens.bind(tokenMod);
        Object.defineProperty(tokenMod, "encryptAndStoreTokens", {
            value: async function (tokens: Record<string, string>) {
                try {
                    const saved = await getAccounts();
                    for (const acc of saved) {
                        if (!acc.undecryptable && !tokens[acc.id]) tokens[acc.id] = acc.token;
                    }
                } catch (e) {
                    logger.debug("injecting saved accounts into token store failed", e);
                }
                return orig(tokens);
            },
            writable: true,
            configurable: true
        });
        tokenModulePatched = true;
    } catch (e) {
        logger.warn("patchTokenStore failed", e);
    }
}

function switchToAccount(token: string, userId?: string) {
    try {
        const isMultiInstance = window.location.href.includes("multi-instance=true")
            || (window as { IS_MULTI_INSTANCE?: boolean; }).IS_MULTI_INSTANCE;
        if (isMultiInstance && userId) {
            const multiInstance = VencordNative?.pluginHelpers?.MultiInstance as { openInstanceWindow?: (token: string, userId: string, focus: boolean) => void; } | undefined;
            if (typeof multiInstance?.openInstanceWindow === "function") {
                multiInstance.openInstanceWindow(token, userId, true);
                window.close();
                return;
            }
        }

        const TokenStore = findByProps("getToken", "setToken");
        if (typeof TokenStore?.setToken === "function") TokenStore.setToken(token);

        if (settings.store.useLocalStorageBypass) {
            window.localStorage.setItem("token", `"${token}"`);
        }

        setTimeout(() => location.reload(), 350);
    } catch (err) {
        logger.error("Switch failed:", err);
        location.reload();
    }
}

function extractTokens(raw: string): string[] {
    const found = new Set<string>();
    TOKEN_REGEX.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TOKEN_REGEX.exec(raw)) !== null) found.add(m[0]);
    return Array.from(found);
}

// Bulk parser folded from ImportMultiTokens: supports three paste formats
// (3-line userId/blank/token, comma-separated, one-per-line), dedups, and
// strips wrapping quotes. Falls back to a plain regex scan so any token
// embedded in arbitrary text is still recovered. Returns deduped tokens.
function parseBulkTokens(input: string): string[] {
    const cleaned = input.trim();
    if (!cleaned) return [];

    const stripQuotes = (s: string) => s.trim().replace(/^["']|["']$/g, "");
    const lines = cleaned.split("\n");

    // 3-line format first (userId, blank, token), repeating every 3 lines. The
    // snowflake userId and blank middle line are required so pasting plain
    // tokens one per line is never misread as this format.
    if (lines.length >= 3) {
        const seen = new Set<string>();
        for (let i = 0; i + 2 < lines.length; i += 3) {
            const userId = lines[i].trim();
            const separator = lines[i + 1].trim();
            const token = stripQuotes(lines[i + 2]);
            if (SNOWFLAKE_REGEX.test(userId) && separator === "" && token && TOKEN_SHAPE.test(token)) seen.add(token);
        }
        if (seen.size > 0) return Array.from(seen);
    }

    const parts = cleaned.includes(",") ? cleaned.split(",") : lines;
    const candidates = parts.map(stripQuotes).filter(Boolean);
    if (candidates.length > 0 && candidates.every(t => TOKEN_SHAPE.test(t))) {
        return Array.from(new Set(candidates));
    }

    // Fallback: recover any token embedded in free-form text.
    return extractTokens(cleaned);
}

// Verifies each locally found token and merges it into `accounts` keyed by
// Discord user id: unknown ids are added, known ids get their token (and
// profile) refreshed when the found token differs. Returns null when
// `shouldStop` aborted.
async function importLocalTokens(accounts: SavedAccount[], shouldStop: () => boolean): Promise<{ added: number; updated: number; } | null> {
    const tokens = await Native.findLocalTokens();
    if (shouldStop()) return null;
    let added = 0;
    let updated = 0;
    for (const tok of tokens) {
        // Same token already saved under some account — nothing to do.
        if (accounts.find(a => a.token === tok)) continue;
        let verified: Awaited<ReturnType<typeof Native.checkToken>>;
        try {
            verified = await Native.checkToken(tok);
        } catch {
            continue;
        }
        if (shouldStop()) return null;
        if (verified.valid && verified.user) {
            const u = verified.user;
            const idx = accounts.findIndex(a => a.id === u.id);
            if (idx === -1) {
                accounts.push(accountFromUser(u, tok));
                added++;
            } else if (accounts[idx].token !== tok) {
                accounts[idx] = accountFromUser(u, tok);
                updated++;
            }
        }
        await sleep(200);
    }
    return shouldStop() ? null : { added, updated };
}

function FolderIcon({ width = 20, height = 20, style }: { width?: number; height?: number; style?: React.CSSProperties; }) {
    return <svg width={width} height={height} viewBox="0 0 24 24" fill="currentColor" style={style}><path d="M2 5a3 3 0 0 1 3-3h3.93a2 2 0 0 1 1.66.9L12 5h7a3 3 0 0 1 3 3v11a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V5Z" /></svg>;
}

function TrashIcon() {
    return <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor"><path d="M7 4a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2h4a1 1 0 1 1 0 2h-1.1l-.9 12.1A3 3 0 0 1 17 23H7a3 3 0 0 1-3-2.9L3.1 8H2a1 1 0 0 1 0-2h4V4Zm2 0v2h6V4H9ZM5.1 8l.9 11.9a1 1 0 0 0 1 .1h6a1 1 0 0 0 1-.1L14.9 8H5.1Z" /></svg>;
}

function CopyIcon() {
    return <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1Zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2Zm0 16H8V7h11v14Z" /></svg>;
}

function CheckIcon() {
    return <svg width={12} height={12} viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" /></svg>;
}

function CrossIcon() {
    return <svg width={12} height={12} viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 17.59 13.41 12 19 6.41z" /></svg>;
}

function AccountAvatar({ id, avatar }: { id: string; avatar: string | null | undefined; }) {
    return (
        <img
            src={avatarUrl(id, avatar)}
            className={cl("avatar")}
            alt=""
            onError={e => {
                const fallback = IconUtils.getDefaultAvatarURL(id);
                if (e.currentTarget.src !== fallback) e.currentTarget.src = fallback;
            }}
        />
    );
}

interface TokenResult { token: string; status: "pending" | "checking" | "valid" | "invalid" | "error" | "rate_limited"; username?: string; avatar?: string | null; id?: string; }

function RemoveInvalidModal({ rootProps, invalidAccounts, onConfirm }: {
    rootProps: RenderModalProps;
    invalidAccounts: SavedAccount[];
    onConfirm: () => void;
}) {
    return (
        <ModalRoot {...rootProps} size="small">
            <ModalHeader separator={false}>
                <Forms.FormTitle tag="h4" style={{ margin: 0, flex: 1 }}>Remove invalid tokens?</Forms.FormTitle>
                <ModalCloseButton onClick={rootProps.onClose} />
            </ModalHeader>
            <ModalContent>
                <Forms.FormText style={{ marginBottom: 12 }}>
                    {invalidAccounts.length} account{invalidAccounts.length !== 1 ? "s" : ""} had invalid or revoked tokens:
                </Forms.FormText>
                <div className={cl("list")} style={{ maxHeight: 120, marginBottom: 12 }}>
                    {invalidAccounts.map(a => (
                        <div key={a.id} className={cl("row", "row-invalid")}>
                            <AccountAvatar id={a.id} avatar={a.avatar} />
                            <span className={cl("username")}>{a.username}</span>
                        </div>
                    ))}
                </div>
            </ModalContent>
            <ModalFooter className={cl("footer")}>
                <Button onClick={() => rootProps.onClose()} color={Button.Colors.TRANSPARENT}>Keep them</Button>
                <Button onClick={() => { onConfirm(); rootProps.onClose(); }} color={Button.Colors.RED}>Remove invalid</Button>
            </ModalFooter>
        </ModalRoot>
    );
}

function TokenModal({ rootProps }: { rootProps: RenderModalProps; }) {
    const [accounts, setAccounts] = useState<SavedAccount[]>(() => accountsCache ?? []);
    const [loaded, setLoaded] = useState(() => accountsCache !== null);
    const [verifying, setVerifying] = useState(false);
    const [scanning, setScanning] = useState(false);
    const [statuses, setStatuses] = useState<Record<string, string>>({});
    const [tab, setTab] = useState<"saved" | "add" | "settings">("saved");
    const [pasteValue, setPaste] = useState("");
    const [detectedCount, setDetectedCount] = useState(0);
    const [results, setResults] = useState<TokenResult[]>([]);
    const [checking, setChecking] = useState(false);
    const [done, setDone] = useState(false);
    const [copied, setCopied] = useState(false);
    const [accountSearch, setAccountSearch] = useState("");
    const fileRef = useRef<HTMLInputElement>(null);
    const mountedRef = useRef(true);
    const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const detectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const filteredAccounts = useMemo(() => {
        if (!accountSearch.trim()) return accounts;
        const lowSearch = accountSearch.toLowerCase();
        return accounts.filter(a => a.username.toLowerCase().includes(lowSearch) || a.id.includes(lowSearch));
    }, [accounts, accountSearch]);

    useEffect(() => {
        modalOpen = true;
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        let cancelled = false;
        if (accountsCache !== null) {
            setAccounts(accountsCache);
            setLoaded(true);
        } else {
            getAccounts().then(v => {
                if (!cancelled) { setAccounts(v); setLoaded(true); }
            });
        }
        return () => {
            cancelled = true;
            modalOpen = false;
            mountedRef.current = false;
            if (detectTimer.current) clearTimeout(detectTimer.current);
            if (copiedTimer.current) clearTimeout(copiedTimer.current);
        };
    }, []);

    async function removeAccount(id: string) {
        const updated = accounts.filter(a => a.id !== id);
        setAccounts(updated);
        await saveAccounts(updated);
    }

    async function verifyAll() {
        if (verifying) return;
        setVerifying(true);
        try {
            const ns: Record<string, string> = {};
            for (const acc of accounts) {
                ns[acc.id] = "checking";
                if (!mountedRef.current) return;
                setStatuses({ ...ns });
                try {
                    const r = await Native.checkToken(acc.token);
                    // A 429 means Discord throttled the check, NOT that the token
                    // is dead. Counting it as invalid wrongly flags working accounts.
                    ns[acc.id] = r.valid
                        ? "valid"
                        : r.error === "rate_limited"
                            ? "rate_limited"
                            : r.error && r.error !== "unauthorized"
                                ? "error"
                                : "invalid";
                    if (r.error === "rate_limited") await sleep(2500);
                } catch {
                    ns[acc.id] = "error";
                }
                if (!mountedRef.current) return;
                setStatuses({ ...ns });
                await sleep(400);
            }
            if (!mountedRef.current) return;
            const invalidAccs = accounts.filter(a => ns[a.id] === "invalid");
            if (invalidAccs.length > 0) {
                openModal(props => (
                    <RemoveInvalidModal
                        rootProps={props}
                        invalidAccounts={invalidAccs}
                        onConfirm={async () => {
                            const toKeep = accounts.filter(a => ns[a.id] !== "invalid");
                            setAccounts(toKeep);
                            await saveAccounts(toKeep);
                        }}
                    />
                ));
            }
        } finally {
            if (mountedRef.current) setVerifying(false);
        }
    }

    async function scanLocalDiscords() {
        if (scanning) return;
        setScanning(true);
        try {
            const existing = [...await getAccounts()];
            if (!mountedRef.current) return;
            const result = await importLocalTokens(existing, () => !mountedRef.current);
            if (result === null || !mountedRef.current) return;
            if (result.added > 0 || result.updated > 0) {
                await saveAccounts(existing);
                await patchTokenStore();
                if (!mountedRef.current) return;
                setAccounts([...existing]);
                const parts: string[] = [];
                if (result.added > 0) parts.push(`${result.added} new account${result.added !== 1 ? "s" : ""} imported`);
                if (result.updated > 0) parts.push(`${result.updated} token${result.updated !== 1 ? "s" : ""} refreshed`);
                showToast(parts.join(", "), Toasts.Type.SUCCESS);
            } else {
                showToast("No new accounts found", Toasts.Type.MESSAGE);
            }
        } catch (err) {
            logger.error("Scan failed:", err);
            showToast("Local scan failed", Toasts.Type.FAILURE);
        } finally {
            if (mountedRef.current) setScanning(false);
        }
    }

    async function processTokens(raw: string, destOverride?: ImportDestination) {
        const tokens = parseBulkTokens(raw);
        if (!tokens.length) {
            showToast("No tokens found in the input", Toasts.Type.FAILURE);
            return;
        }
        const dest = destOverride ?? settings.store.importDestination;
        const saveLocally = dest !== "loginManager";
        const initial: TokenResult[] = tokens.map(t => ({ token: t, status: "pending" as const }));
        setResults(initial);
        setChecking(true);
        setDone(false);
        try {
            const updated = [...initial];
            const existing = [...await getAccounts()];
            if (!mountedRef.current) return;
            const validForRouting: Array<{ username: string; token: string; }> = [];
            let dirty = false;
            for (let i = 0; i < tokens.length; i++) {
                if (!mountedRef.current) return;
                updated[i] = { ...updated[i], status: "checking" };
                setResults([...updated]);
                try {
                    const result = await Native.checkToken(tokens[i]);
                    if (!mountedRef.current) return;
                    if (result.valid && result.user) {
                        const account = accountFromUser(result.user, tokens[i]);
                        if (saveLocally) {
                            const idx = existing.findIndex(a => a.id === account.id);
                            if (idx === -1) {
                                existing.push(account);
                                dirty = true;
                            } else if (existing[idx].token !== account.token) {
                                existing[idx] = account;
                                dirty = true;
                            }
                        }
                        validForRouting.push({ username: account.username, token: tokens[i] });
                        updated[i] = { ...updated[i], status: "valid", username: account.username, id: account.id, avatar: account.avatar };
                    } else if (result.error === "rate_limited") {
                        updated[i] = { ...updated[i], status: "rate_limited" };
                    } else if (result.error && result.error !== "unauthorized") {
                        updated[i] = { ...updated[i], status: "error" };
                    } else {
                        updated[i] = { ...updated[i], status: "invalid" };
                    }
                } catch {
                    updated[i] = { ...updated[i], status: "error" };
                }
                if (!mountedRef.current) return;
                setResults([...updated]);
                await sleep(200);
            }
            if (dirty) {
                await saveAccounts(existing);
                await patchTokenStore();
                if (!mountedRef.current) return;
                setAccounts([...existing]);
            }
            if (dest !== "importer" && validForRouting.length) {
                const routed = routeToLoginManager(validForRouting);
                if (!routed.ok) showToast(`Login Manager import skipped: ${routed.reason}`, Toasts.Type.FAILURE);
                else showToast(`Sent ${validForRouting.length} account${validForRouting.length !== 1 ? "s" : ""} to Login Manager`, Toasts.Type.SUCCESS);
            }
            setDone(true);
        } finally {
            if (mountedRef.current) setChecking(false);
        }
    }

    function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => processTokens(ev.target?.result as string ?? "");
        reader.readAsText(file);
        e.target.value = "";
    }

    function handlePasteChange(val: string) {
        setPaste(val);
        if (detectTimer.current) clearTimeout(detectTimer.current);
        detectTimer.current = setTimeout(() => {
            detectTimer.current = null;
            if (!mountedRef.current) return;
            setDetectedCount(parseBulkTokens(val).length);
        }, 150);
    }

    function copyMyToken() {
        try {
            const token = findByProps("getToken")?.getToken?.();
            if (token) copyWithToast(token, "Token copied!");
            else showToast("No token found", Toasts.Type.FAILURE);
        } catch (e) {
            logger.debug("copyMyToken failed", e);
        }
    }

    const validCount = results.filter(r => r.status === "valid").length;
    const invalidCount = results.filter(r => r.status === "invalid").length;

    return (
        <ModalRoot {...rootProps} size="medium">
            <ModalHeader separator={false}>
                <Forms.FormTitle tag="h4" style={{ margin: 0, display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
                    <FolderIcon width={16} height={16} /> DX Token Importer
                </Forms.FormTitle>
                <ModalCloseButton onClick={rootProps.onClose} />
            </ModalHeader>
            <ModalContent className={cl("content")}>
                <div className={cl("tabs")}>
                    <button className={cl("tab", tab === "saved" && "tab-active")} onClick={() => setTab("saved")}>
                        Saved accounts
                        {accounts.length > 0 && <span className={cl("tab-count")}>{accounts.length}</span>}
                    </button>
                    <button className={cl("tab", tab === "add" && "tab-active")} onClick={() => setTab("add")}>
                        Paste tokens
                    </button>
                    <button className={cl("tab", tab === "settings" && "tab-active")} onClick={() => setTab("settings")}>
                        Settings
                    </button>
                </div>

                {tab === "saved" && (
                    <>
                        <div className={cl("bar")}>
                            <div className={cl("search")}>
                                <input
                                    className={cl("search-input")}
                                    placeholder="Search accounts..."
                                    value={accountSearch}
                                    onChange={e => setAccountSearch(e.target.value)}
                                />
                            </div>
                            {settings.store.enableLocalScan && (
                                <Button size={Button.Sizes.MIN} color={Button.Colors.PRIMARY} onClick={scanLocalDiscords} disabled={scanning}>
                                    <FolderIcon width={12} height={12} style={{ marginRight: 4 }} />
                                    {scanning ? "Scanning..." : "Scan local Discords"}
                                </Button>
                            )}
                            <Button size={Button.Sizes.MIN} color={Button.Colors.PRIMARY} onClick={() => {
                                copyMyToken();
                                setCopied(true);
                                if (copiedTimer.current) clearTimeout(copiedTimer.current);
                                copiedTimer.current = setTimeout(() => {
                                    copiedTimer.current = null;
                                    if (mountedRef.current) setCopied(false);
                                }, 1500);
                            }}>
                                {copied ? "Copied ✓" : "My Token"}
                            </Button>
                            <Button size={Button.Sizes.MIN} color={Button.Colors.BRAND} onClick={verifyAll} disabled={verifying || !loaded}>
                                {verifying ? "Verifying..." : "Verify all"}
                            </Button>
                        </div>
                        {!loaded ? <div className={cl("empty")} style={{ opacity: 0.5 }}>Loading accounts...</div>
                            : accounts.length === 0 ? <div className={cl("empty")}>No accounts — add tokens via the tab above.</div>
                                : filteredAccounts.length === 0 ? <div className={cl("empty")}>No accounts match your search.</div>
                                    : <div className={cl("list")}>
                                        {filteredAccounts.map(a => {
                                            const st = statuses[a.id] ?? "idle";
                                            const rowClass = st === "invalid" ? "row-invalid"
                                                : st === "error" || st === "rate_limited" ? "row-warn"
                                                    : st === "valid" ? "row-valid" : null;
                                            return (
                                                <div key={a.id} className={cl("row", rowClass)}>
                                                    {a.avatar
                                                        ? <AccountAvatar id={a.id} avatar={a.avatar} />
                                                        : <div className={cl("avatar-ph")}>{a.username?.[0]?.toUpperCase() ?? "?"}</div>}
                                                    <div className={cl("row-info")}>
                                                        <span className={cl("username")}>
                                                            {a.username}{a.discriminator && a.discriminator !== "0" ? `#${a.discriminator}` : ""}
                                                            {st === "valid" && <span className={cl("st", "st-ok")}><CheckIcon /></span>}
                                                            {st === "invalid" && <span className={cl("st", "st-bad")}><CrossIcon /></span>}
                                                            {(st === "rate_limited" || st === "error") && (
                                                                <span
                                                                    className={cl("st", "st-warn")}
                                                                    title={st === "rate_limited" ? "Discord rate limited the check, this is not an invalid token. Verify again later." : "The check request failed."}
                                                                >!</span>
                                                            )}
                                                            {st === "checking" && <span className={cl("st", "st-loading")}>...</span>}
                                                        </span>
                                                        {a.undecryptable
                                                            ? <span className={cl("token-hidden", "token-locked")} title="Token can't be decrypted on this machine">Locked</span>
                                                            : <span
                                                                className={cl("token-hidden", "token-copyable")}
                                                                onClick={() => copyWithToast(a.token, "Token copied!")}
                                                                title="Copy token"
                                                            >••••••••••••••••••••••••</span>}
                                                    </div>
                                                    <div className={cl("row-actions")}>
                                                        <Button size={Button.Sizes.MIN} color={Button.Colors.BRAND} disabled={a.undecryptable} onClick={() => switchToAccount(a.token, a.id)}>Switch</Button>
                                                        <Button size={Button.Sizes.MIN} color={Button.Colors.TRANSPARENT} aria-label="Copy token" disabled={a.undecryptable} onClick={() => copyWithToast(a.token, "Token copied!")}>
                                                            <CopyIcon />
                                                        </Button>
                                                        <Button size={Button.Sizes.MIN} color={Button.Colors.RED} aria-label="Delete account" onClick={() => removeAccount(a.id)}>
                                                            <TrashIcon />
                                                        </Button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                        }
                    </>
                )}

                {tab === "add" && (
                    <div className={cl("add-body")}>
                        <TextArea
                            className={cl("textarea")}
                            placeholder="Paste your Discord tokens here... (one per line, comma-separated, or 3-line userId/blank/token format)"
                            value={pasteValue}
                            onChange={handlePasteChange}
                        />
                        <div className={cl("add-footer")}>
                            <span className={cl("detected")}>{detectedCount} token{detectedCount !== 1 ? "s" : ""} detected</span>
                            <Button size={Button.Sizes.MIN} color={Button.Colors.TRANSPARENT} onClick={() => fileRef.current?.click()}>File .txt</Button>
                            <Button size={Button.Sizes.MIN} color={Button.Colors.BRAND} disabled={checking || detectedCount === 0} onClick={() => processTokens(pasteValue, "importer")}>
                                {checking ? "Checking..." : "→ Importer"}
                            </Button>
                            <Button size={Button.Sizes.MIN} color={Button.Colors.BRAND} disabled={checking || detectedCount === 0} onClick={() => processTokens(pasteValue, "loginManager")}>
                                {checking ? "Checking..." : "→ Login Manager"}
                            </Button>
                            <Button size={Button.Sizes.MIN} color={Button.Colors.BRAND} disabled={checking || detectedCount === 0} onClick={() => processTokens(pasteValue)}>
                                {checking ? "Checking..." : "→ Both"}
                            </Button>
                        </div>
                        <input ref={fileRef} type="file" accept=".txt,text/plain" style={{ display: "none" }} onChange={handleFile} />
                        {results.length > 0 && (
                            <div className={cl("results")}>
                                {done && (
                                    <div className={cl("results-summary")}>
                                        <span className={cl("st", "st-ok")}><CheckIcon /> {validCount} valid{validCount !== 1 ? "s" : ""}</span>
                                        <span className={cl("st", "st-bad")}><CrossIcon /> {invalidCount} invalid{invalidCount !== 1 ? "s" : ""}</span>
                                    </div>
                                )}
                                <div className={cl("list")}>
                                    {results.map(r => (
                                        <div key={r.token} className={cl("row", r.status === "valid" ? "row-valid" : r.status === "checking" ? null : "row-invalid")}>
                                            {r.status === "valid"
                                                ? <AccountAvatar id={r.id ?? r.token} avatar={r.avatar} />
                                                : <div className={cl("avatar-ph")}>{r.status === "checking" ? "..." : "?"}</div>}
                                            <div className={cl("row-info")}>
                                                {r.status === "valid"
                                                    ? <span className={cl("username")}>{r.username}</span>
                                                    : <span
                                                        className={cl("token-hidden", r.status === "checking" ? null : "token-copyable")}
                                                        onClick={r.status === "checking" ? undefined : () => copyWithToast(r.token, "Token copied!")}
                                                        title="Copy token"
                                                    >{r.status === "checking" ? "Checking..." : "••••••••••••••••••••••••"}</span>}
                                            </div>
                                            <span className={cl("badge", r.status === "rate_limited" || r.status === "error" ? "badge-warn" : r.status === "valid" ? "badge-valid" : "badge-invalid")}>
                                                {r.status === "valid" ? <CheckIcon /> : r.status === "checking" ? "..." : r.status === "rate_limited" ? "Slow" : r.status === "error" ? "!" : <CrossIcon />}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {tab === "settings" && (
                    <div className={cl("settings-body")}>
                        <DXTokenImporterSettingsPanel />
                    </div>
                )}
            </ModalContent>
        </ModalRoot>
    );
}

const DANGEROUS_SETTING_BLURBS: Record<DangerousSetting, string> = {
    autoScanOnStartup: "On startup, the plugin will read every Discord install on this machine, decrypt their stored tokens using DPAPI, and add any it finds to the saved-accounts list. Tokens belong to whoever is logged in to those installs.",
    enableLocalScan: "Enables the local token-scraping code path and shows the 'Scan local Discords' button. Without this, the plugin cannot pull tokens from disk — only manual paste / file import work.",
    patchTokenStore: "Replaces Discord's internal encryptAndStoreTokens at runtime. Saved tokens get persisted into Discord's own encrypted token storage on disk and may survive even after this plugin is removed.",
    injectIntoMultiAccountStore: "On startup, dispatches fake MULTI_ACCOUNT_VALIDATE_TOKEN_SUCCESS events so saved accounts appear in Discord's native account switcher as if they were normal logins.",
    useLocalStorageBypass: "When switching accounts, writes the token to localStorage to bypass Discord's localStorage scrubbing. Defeats one of Discord's anti-token-theft mitigations.",
};

function DangerousAckModal({ rootProps, settingKey, onConfirm }: { rootProps: RenderModalProps; settingKey: DangerousSetting; onConfirm: () => void; }) {
    return (
        <ModalRoot {...rootProps} size="small">
            <ModalHeader separator={false}>
                <Forms.FormTitle tag="h4" style={{ margin: 0, flex: 1 }}>Enable "{settingKey}"?</Forms.FormTitle>
                <ModalCloseButton onClick={rootProps.onClose} />
            </ModalHeader>
            <ModalContent>
                <Forms.FormText style={{ marginBottom: 12 }}>
                    {DANGEROUS_SETTING_BLURBS[settingKey]}
                </Forms.FormText>
                <Forms.FormText style={{ marginBottom: 12, opacity: 0.75 }}>
                    Enabling this almost certainly violates Discord's Terms of Service. Using it on tokens that do not belong to you may be illegal in your jurisdiction. Only continue if you understand and accept the risk.
                </Forms.FormText>
            </ModalContent>
            <ModalFooter className={cl("footer")}>
                <Button onClick={() => rootProps.onClose()} color={Button.Colors.TRANSPARENT}>Cancel</Button>
                <Button onClick={() => { onConfirm(); rootProps.onClose(); }} color={Button.Colors.RED}>I understand, enable it</Button>
            </ModalFooter>
        </ModalRoot>
    );
}

const ABOUT_KEYS: (keyof typeof settings.store)[] = [
    "importDestination",
    "encryptStoredTokens",
    "enableQuickSwitch",
    "enableLocalScan",
    "autoScanOnStartup",
    "patchTokenStore",
    "injectIntoMultiAccountStore",
    "useLocalStorageBypass",
];

interface EncryptionReport {
    safeStorageAvailable: boolean;
    safeStorageRoundTrip: boolean;
    builtinRoundTrip: boolean;
    total: number;
    encrypted: number;
}

function EncryptionCheckSection() {
    const [report, setReport] = useState<EncryptionReport | null>(null);
    const [busy, setBusy] = useState(false);

    async function runCheck(): Promise<EncryptionReport | null> {
        try {
            const native = await Native.verifyEncryption();
            const raw = (await DataStore.get<SavedAccount[]>(STORE_KEY)) ?? [];
            const next: EncryptionReport = {
                ...native,
                total: raw.length,
                encrypted: raw.filter(a => isEncryptedPayload(a.token)).length,
            };
            setReport(next);
            return next;
        } catch (e) {
            logger.error("Encryption check failed:", e);
            showToast("Encryption check failed", Toasts.Type.FAILURE);
            return null;
        }
    }

    async function encryptStoredNow() {
        if (busy) return;
        setBusy(true);
        try {
            await saveAccounts(await getAccounts());
            const next = await runCheck();
            if (next) showToast("Stored tokens re-encrypted", Toasts.Type.SUCCESS);
        } finally {
            setBusy(false);
        }
    }

    const backendOk = report?.safeStorageAvailable
        ? report.safeStorageRoundTrip
        : report?.builtinRoundTrip;

    return (
        <>
            <Forms.FormTitle tag="h5" style={{ marginTop: 12 }}>Encryption health</Forms.FormTitle>
            <div className={cl("enc-actions")}>
                <Button size={Button.Sizes.SMALL} color={Button.Colors.PRIMARY} disabled={busy} onClick={async () => {
                    setBusy(true);
                    try { await runCheck(); } finally { setBusy(false); }
                }}>
                    {busy ? "Checking..." : "Verify encryption"}
                </Button>
                {report !== null && settings.store.encryptStoredTokens && report.encrypted < report.total && (
                    <Button size={Button.Sizes.SMALL} color={Button.Colors.GREEN} disabled={busy} onClick={encryptStoredNow}>
                        Encrypt stored tokens now
                    </Button>
                )}
            </div>
            {report !== null && (
                <div className={cl("enc-report")}>
                    <div className={cl("enc-line")}>
                        <span className={cl("st", backendOk ? "st-ok" : "st-bad")}>{backendOk ? <CheckIcon /> : <CrossIcon />}</span>
                        Backend: {report.safeStorageAvailable ? "OS keychain (safeStorage)" : "Built-in AES-256-GCM (HKDF-SHA512)"}
                        {backendOk ? " — round-trip passed" : " — round-trip FAILED"}
                    </div>
                    <div className={cl("enc-line")}>
                        <span className={cl("st", report.encrypted === report.total ? "st-ok" : "st-bad")}>
                            {report.encrypted === report.total ? <CheckIcon /> : <CrossIcon />}
                        </span>
                        At rest: {report.encrypted}/{report.total} tokens encrypted
                        {report.encrypted < report.total ? " — some tokens are stored in plain text" : ""}
                    </div>
                </div>
            )}
        </>
    );
}

// Rendered both as the plugin's settingsAboutComponent and as the modal's
// Settings tab, so the two surfaces can never drift apart.
function DXTokenImporterSettingsPanel() {
    const store = settings.use(ABOUT_KEYS);
    const [acked, setAcked] = useState<Set<DangerousSetting>>(new Set());

    useEffect(() => {
        let cancelled = false;
        getAckedDangerous().then(v => {
            if (!cancelled) setAcked(v);
        });
        return () => { cancelled = true; };
    }, []);

    // Turning a dangerous toggle ON the first time pops a confirmation; turning OFF is unconditional.
    function setDangerous(key: DangerousSetting, next: boolean) {
        if (!next || acked.has(key)) {
            settings.store[key] = next;
            return;
        }
        openModal(props => (
            <DangerousAckModal
                rootProps={props}
                settingKey={key}
                onConfirm={async () => {
                    await markAckedDangerous(key);
                    setAcked(prev => new Set(prev).add(key));
                    settings.store[key] = true;
                }}
            />
        ));
    }

    async function setEncrypt(next: boolean) {
        if (next && !(await Native.encryptionAvailable())) {
            showToast("Encryption is not available on this system, tokens would stay in plain text", Toasts.Type.FAILURE);
            return;
        }
        settings.store.encryptStoredTokens = next;
    }

    return (
        <>
            <Forms.FormTitle tag="h3">DXTokenImporter — capability toggles</Forms.FormTitle>
            <Forms.FormText style={{ marginBottom: 12 }}>
                All advanced behaviors below are <strong>off by default</strong>. With everything off, the plugin only lets you manually paste or upload tokens, verify them, store them locally (optionally encrypted), and switch between them via a standard token-store + reload — no disk scraping, no Discord-internal patching, no anti-protection bypasses.
            </Forms.FormText>
            <Forms.FormTitle tag="h5">Import destination</Forms.FormTitle>
            <Select
                options={[
                    { label: "Both", value: "both" },
                    { label: "DXTokenImporter only", value: "importer" },
                    { label: "Login Manager only", value: "loginManager" },
                ]}
                serialize={identity}
                isSelected={(v: string) => v === store.importDestination}
                select={(v: string) => {
                    settings.store.importDestination = v as ImportDestination;
                }}
            />
            <div style={{ height: 12 }} />
            <FormSwitch
                title="Encrypt stored tokens at rest"
                description="Uses Electron safeStorage (OS keychain / DPAPI) with an AES-256-GCM built-in fallback. Strongly recommended."
                value={store.encryptStoredTokens}
                onChange={setEncrypt}
            />
            <EncryptionCheckSection />
            <FormSwitch
                title="Alt+G quick switch hotkey"
                description="Opens the account switcher modal from anywhere. Takes effect after a reload."
                value={store.enableQuickSwitch}
                onChange={v => settings.store.enableQuickSwitch = v}
            />
            <FormSwitch
                title="Enable local Discord scan (advanced)"
                description={DANGEROUS_SETTING_BLURBS.enableLocalScan}
                value={store.enableLocalScan}
                onChange={v => setDangerous("enableLocalScan", v)}
            />
            <FormSwitch
                title="Auto-scan on startup (advanced)"
                description={DANGEROUS_SETTING_BLURBS.autoScanOnStartup}
                value={store.autoScanOnStartup}
                onChange={v => setDangerous("autoScanOnStartup", v)}
            />
            <FormSwitch
                title="Patch Discord's token store (advanced)"
                description={DANGEROUS_SETTING_BLURBS.patchTokenStore}
                value={store.patchTokenStore}
                onChange={v => setDangerous("patchTokenStore", v)}
            />
            <FormSwitch
                title="Inject into multi-account store (advanced)"
                description={DANGEROUS_SETTING_BLURBS.injectIntoMultiAccountStore}
                value={store.injectIntoMultiAccountStore}
                onChange={v => setDangerous("injectIntoMultiAccountStore", v)}
            />
            <FormSwitch
                title="localStorage bypass during switch (advanced)"
                description={DANGEROUS_SETTING_BLURBS.useLocalStorageBypass}
                value={store.useLocalStorageBypass}
                onChange={v => setDangerous("useLocalStorageBypass", v)}
            />
        </>
    );
}

// modalOpen is driven by TokenModal's mount/unmount, NOT by onClose: Discord
// closes modals through paths that never invoke onClose (closeAllModals on
// navigation, layer pops), which used to leave the guard stuck and the header
// button dead until reload.
let modalOpen = false;
let lastOpenAttempt = 0;

function openTokenModal() {
    if (modalOpen) return;
    const now = Date.now();
    // Debounce double clicks / Alt+G key repeat during the open transition.
    if (now - lastOpenAttempt < 300) return;
    lastOpenAttempt = now;
    openModal(props => <TokenModal rootProps={props} />);
}

function TokenImporterButton() {
    return <HeaderBarButton icon={FolderIcon} tooltip="DX Token Importer" onClick={() => openTokenModal()} />;
}

export default definePlugin({
    name: "DXTokenImporter",
    description: "Import and verify Discord tokens.",
    tags: ["Utility", "Nightcord"],
    authors: [TestcordDevs.Nightcord, TestcordDevs.x2b, TestcordDevs.sirphantom89],
    settings,
    settingsAboutComponent: DXTokenImporterSettingsPanel,
    headerBarButton: {
        render: () => <TokenImporterButton />,
        icon: FolderIcon,
        priority: 10,
    },
    _injectTimer: null as ReturnType<typeof setTimeout> | null,
    _started: false,
    handleQuickSwitch(event: KeyboardEvent) {
        if (!event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
        if (event.key.toLowerCase() !== "g") return;
        event.preventDefault();
        openTokenModal();
    },
    async start() {
        this._started = true;
        if (settings.store.enableQuickSwitch) {
            document.addEventListener("keydown", this.handleQuickSwitch);
        }
        try {
            const existing = [...await getAccounts()];
            if (!this._started) return;
            // Auto-scan requires BOTH the local-scan capability and the auto-on-startup toggle.
            if (
                settings.store.enableLocalScan
                && settings.store.autoScanOnStartup
                && window.DiscordNative?.process?.platform === "win32"
            ) {
                const result = await importLocalTokens(existing, () => !this._started);
                if (result === null || !this._started) return;
                if (result.added > 0 || result.updated > 0) {
                    await saveAccounts(existing);
                    if (!this._started) return;
                    await patchTokenStore();
                }
            }
            if (settings.store.injectIntoMultiAccountStore) {
                this._injectTimer = setTimeout(() => {
                    this._injectTimer = null;
                    this._injectAccounts();
                }, 5000);
            }
        } catch (e) {
            logger.error("Startup failed:", e);
        }
        if (settings.store.patchTokenStore) {
            // Eagerly patch so future native saves include our accounts.
            patchTokenStore();
        }
    },
    async _injectAccounts() {
        if (!this._started) return;
        if (!settings.store.injectIntoMultiAccountStore) return;
        try {
            const saved = await getAccounts();
            if (!this._started) return;
            if (!saved.length) return;
            if (!FluxDispatcher?.dispatch) return;
            const existing = new Set((findByProps("getAccounts")?.getAccounts?.() ?? []).map((u: { id: string; }) => u.id));
            const toInject = saved.filter(a => !a.undecryptable && !existing.has(a.id));
            for (const acc of toInject) {
                if (!this._started) return;
                await sleep(0);
                try {
                    FluxDispatcher.dispatch({
                        type: "MULTI_ACCOUNT_VALIDATE_TOKEN_SUCCESS",
                        userId: acc.id,
                        token: acc.token,
                        user: { id: acc.id, username: acc.username, discriminator: acc.discriminator, avatar: null }
                    });
                } catch (e) {
                    logger.debug("multi-account inject dispatch failed", e);
                }
                await sleep(300);
            }
        } catch (e) {
            logger.error("inject:", e);
        }
    },
    stop() {
        this._started = false;
        if (this._injectTimer) {
            clearTimeout(this._injectTimer);
            this._injectTimer = null;
        }
        document.removeEventListener("keydown", this.handleQuickSwitch);
        modalOpen = false;
        if (tokenModulePatched) {
            try {
                const tokenMod = findByProps("getToken", "encryptAndStoreTokens");
                if (tokenMod && originalEncryptAndStoreTokens) {
                    Object.defineProperty(tokenMod, "encryptAndStoreTokens", {
                        value: originalEncryptAndStoreTokens,
                        writable: true,
                        configurable: true
                    });
                }
            } catch (e) {
                logger.warn("unpatchTokenStore failed", e);
            }
            tokenModulePatched = false;
            originalEncryptAndStoreTokens = null;
        }
        accountsCache = null;
        loadPromise = null;
    },
});
