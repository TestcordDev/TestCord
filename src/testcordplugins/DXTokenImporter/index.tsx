/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
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
import { ModalContent, ModalFooter, openModal, type RenderModalProps } from "@utils/modal";
import { formatDurationMs } from "@utils/text";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { chooseFile, saveFile } from "@utils/web";
import { findByProps } from "@webpack";
import { Button, FluxDispatcher, Forms, IconUtils, Modal, React, Select, showToast, TextArea, Toasts, useEffect, useMemo, useRef, UserStore, useState } from "@webpack/common";

import { type CheckTokenUser, isEncryptedPayload, TOKEN_REGEX_SOURCE } from "./common";

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
    autoVerifyInterval: {
        type: OptionType.SELECT,
        description: "Periodically verify all saved tokens in the background and flag invalid ones. Set to Off to disable.",
        options: [
            { label: "Off", value: 0, default: true },
            { label: "Every 6 hours", value: 6 },
            { label: "Every 12 hours", value: 12 },
            { label: "Every 24 hours", value: 24 },
        ],
        restartNeeded: true,
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

type VerifyStatus = "valid" | "invalid" | "rate_limited" | "error";

interface SavedAccount {
    id: string;
    token: string;
    username: string;
    discriminator: string;
    /** avatar hash, resolved to a URL at render time via IconUtils */
    avatar: string | null;
    /** token blob could not be decrypted (e.g. profile moved to another OS user) */
    undecryptable?: boolean;
    /** epoch ms of the last conclusive check; absent = never verified */
    lastVerifiedAt?: number;
    lastStatus?: VerifyStatus;
    /** manual ordering index; lower = higher in list when sort is "manual" */
    sortOrder?: number;
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

const STALE_MS = 7 * 24 * 60 * 60 * 1000;

function verifiedAgoLabel(a: SavedAccount): string {
    if (!a.lastVerifiedAt) return "never verified";
    return `verified ${formatDurationMs(Date.now() - a.lastVerifiedAt)} ago`;
}

function isStale(a: SavedAccount): boolean {
    return a.lastVerifiedAt !== undefined && Date.now() - a.lastVerifiedAt > STALE_MS;
}

// Single verification pass shared by the modal, headless command, imports and
// the local scan: checks the token, refreshes profile data from the same
// response, and stamps lastVerifiedAt/lastStatus. Rate limited and transient
// errors deliberately keep the previous stamp — the token was NOT re-verified.
async function verifyToken(tok: string): Promise<{ status: VerifyStatus; rateLimited: boolean; account: SavedAccount | null; }> {
    try {
        const r = await Native.checkToken(tok);
        if (r.valid && r.user) {
            return { status: "valid", rateLimited: false, account: { ...accountFromUser(r.user, tok), lastVerifiedAt: Date.now(), lastStatus: "valid" } };
        }
        if (r.error === "rate_limited") return { status: "rate_limited", rateLimited: true, account: null };
        if (r.error && r.error !== "unauthorized") return { status: "error", rateLimited: false, account: null };
        return { status: "invalid", rateLimited: false, account: null };
    } catch {
        return { status: "error", rateLimited: false, account: null };
    }
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
        const { account, rateLimited } = await verifyToken(tok);
        if (shouldStop()) return null;
        if (account) {
            const idx = accounts.findIndex(a => a.id === account.id);
            if (idx === -1) {
                accounts.push(account);
                added++;
            } else if (accounts[idx].token !== account.token) {
                accounts[idx] = account;
                updated++;
            }
        }
        if (rateLimited) await sleep(2500);
        else await sleep(200);
    }
    return shouldStop() ? null : { added, updated };
}

// Headless verify+refresh pass used by the /dxtokens verify command; no UI.
async function verifyAllHeadless(): Promise<{ valid: number; invalid: number; limited: number; refreshed: number; }> {
    const accounts = [...await getAccounts()];
    let valid = 0, invalid = 0, limited = 0, refreshed = 0, dirty = false;
    for (let i = 0; i < accounts.length; i++) {
        const acc = accounts[i];
        const { status, account, rateLimited } = await verifyToken(acc.token);
        if (account) {
            valid++;
            if (account.username !== acc.username || account.avatar !== acc.avatar || account.discriminator !== acc.discriminator) refreshed++;
            accounts[i] = account;
            dirty = true;
        } else if (status === "rate_limited") {
            limited++;
        } else if (status === "invalid") {
            invalid++;
            accounts[i] = { ...acc, lastVerifiedAt: Date.now(), lastStatus: "invalid" };
            dirty = true;
        }
        await sleep(rateLimited ? 2500 : 400);
    }
    if (dirty) await saveAccounts(accounts);
    return { valid, invalid, limited, refreshed };
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

function EyeIcon() {
    return <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5ZM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5Zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3Z" /></svg>;
}

function EyeOffIcon() {
    return <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7ZM2 4.27l2.28 2.28.46.46A11.8 11.8 0 0 0 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27ZM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2Zm4.31-.78 3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01Z" /></svg>;
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
        <Modal {...rootProps} size="sm" title="Remove invalid tokens?">
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
        </Modal>
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
    const [statusFilter, setStatusFilter] = useState<"all" | "valid" | "invalid" | "unverified">("all");
    const [sortMode, setSortMode] = useState<"manual" | "name" | "recent" | "stale">("manual");
    const [revealedId, setRevealedId] = useState<string | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [bulkMode, setBulkMode] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);
    const mountedRef = useRef(true);
    const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const detectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const filteredAccounts = useMemo(() => {
        let list = accounts;
        const q = accountSearch.trim().toLowerCase();
        if (q) list = list.filter(a => a.username.toLowerCase().includes(q) || a.id.includes(q));
        if (statusFilter !== "all") {
            list = list.filter(a => {
                if (statusFilter === "unverified") return a.lastStatus === undefined;
                return (statuses[a.id] ?? a.lastStatus) === statusFilter;
            });
        }
        const sorted = [...list];
        if (sortMode === "manual") sorted.sort((a, b) => (a.sortOrder ?? Infinity) - (b.sortOrder ?? Infinity));
        else if (sortMode === "name") sorted.sort((a, b) => a.username.localeCompare(b.username));
        else if (sortMode === "recent") sorted.sort((a, b) => (b.lastVerifiedAt ?? 0) - (a.lastVerifiedAt ?? 0));
        else sorted.sort((a, b) => (a.lastVerifiedAt ?? Infinity) - (b.lastVerifiedAt ?? Infinity));
        return sorted;
    }, [accounts, accountSearch, statusFilter, sortMode, statuses]);

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
            if (revealTimer.current) clearTimeout(revealTimer.current);
        };
    }, []);

    async function removeAccount(id: string) {
        const updated = accounts.filter(a => a.id !== id);
        setAccounts(updated);
        await saveAccounts(updated);
    }

    function revealToken(id: string) {
        if (revealedId === id) {
            setRevealedId(null);
            if (revealTimer.current) { clearTimeout(revealTimer.current); revealTimer.current = null; }
            return;
        }
        setRevealedId(id);
        if (revealTimer.current) clearTimeout(revealTimer.current);
        revealTimer.current = setTimeout(() => {
            revealTimer.current = null;
            if (mountedRef.current) setRevealedId(null);
        }, 5000);
    }

    function toggleSelect(id: string) {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }

    function selectAll() {
        setSelectedIds(new Set(filteredAccounts.map(a => a.id)));
    }

    function selectNone() {
        setSelectedIds(new Set());
    }

    async function bulkDelete() {
        if (selectedIds.size === 0) return;
        const updated = accounts.filter(a => !selectedIds.has(a.id));
        setAccounts(updated);
        await saveAccounts(updated);
        setSelectedIds(new Set());
        showToast(`Deleted ${selectedIds.size} account${selectedIds.size !== 1 ? "s" : ""}`, Toasts.Type.MESSAGE);
    }

    function bulkCopy() {
        if (selectedIds.size === 0) return;
        const tokens = accounts.filter(a => selectedIds.has(a.id) && !a.undecryptable).map(a => a.token).join("\n");
        copyWithToast(tokens, `${selectedIds.size} token${selectedIds.size !== 1 ? "s" : ""} copied!`);
    }

    function bulkExport() {
        if (selectedIds.size === 0) return;
        const selected = accounts.filter(a => selectedIds.has(a.id) && !a.undecryptable);
        if (!selected.length) {
            showToast("No exportable accounts selected", Toasts.Type.FAILURE);
            return;
        }
        openModal(props => (
            <PassphraseModal
                rootProps={props}
                title="Export selected accounts"
                confirmField
                warnText={`Exporting ${selected.length} account${selected.length !== 1 ? "s" : ""} to an encrypted backup file.`}
                onConfirm={async passphrase => {
                    const json = JSON.stringify({ version: 1, exportedAt: Date.now(), accounts: selected });
                    const res = await Native.exportVault(json, passphrase);
                    if (!res.ok) return "Encryption failed, nothing was written";
                    saveFile(new File([res.payload], "dxtokenimporter-backup.txt", { type: "text/plain" }));
                    showToast(`Exported ${selected.length} account${selected.length !== 1 ? "s" : ""}`, Toasts.Type.SUCCESS);
                    return null;
                }}
            />
        ));
    }

    // Drag-and-drop reordering
    const dragItem = useRef<string | null>(null);
    const [dropIndicator, setDropIndicator] = useState<{ id: string; position: "above" | "below"; } | null>(null);

    function handleDragStart(e: React.DragEvent, id: string) {
        dragItem.current = id;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", id);
        // Make the dragged row slightly transparent
        requestAnimationFrame(() => {
            (e.target as HTMLElement).style.opacity = "0.4";
        });
    }

    function handleDragOver(e: React.DragEvent, id: string) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!dragItem.current || dragItem.current === id) {
            setDropIndicator(null);
            return;
        }
        // Determine if cursor is in the top or bottom half of the row
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const position = e.clientY < midY ? "above" : "below";
        setDropIndicator(prev => {
            if (prev?.id === id && prev?.position === position) return prev;
            return { id, position };
        });
    }

    function handleDragLeave(e: React.DragEvent) {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setDropIndicator(null);
        }
    }

    function handleDragEnd(e: React.DragEvent) {
        (e.target as HTMLElement).style.opacity = "";
        dragItem.current = null;
        setDropIndicator(null);
    }

    async function handleDrop(e: React.DragEvent, targetId: string) {
        e.preventDefault();
        (e.target as HTMLElement).style.opacity = "";
        const sourceId = dragItem.current;
        const indicator = dropIndicator;
        dragItem.current = null;
        setDropIndicator(null);
        if (!sourceId || sourceId === targetId || !indicator) return;

        const reordered = [...accounts];
        const srcIdx = reordered.findIndex(a => a.id === sourceId);
        if (srcIdx === -1) return;

        // Remove the source item
        const [moved] = reordered.splice(srcIdx, 1);

        // Find the target index in the array *after* removal
        let dstIdx = reordered.findIndex(a => a.id === targetId);
        if (dstIdx === -1) return;

        // Insert above or below depending on where the cursor was
        if (indicator.position === "below") dstIdx++;
        reordered.splice(dstIdx, 0, moved);

        // Stamp sortOrder on every account so the manual order persists
        for (let i = 0; i < reordered.length; i++) reordered[i] = { ...reordered[i], sortOrder: i };
        setAccounts(reordered);
        await saveAccounts(reordered);
    }

    async function verifyAll() {
        if (verifying) return;
        setVerifying(true);
        try {
            const ns: Record<string, string> = {};
            const working = [...accounts];
            let refreshed = 0;
            let dirty = false;
            for (let i = 0; i < working.length; i++) {
                const acc = working[i];
                ns[acc.id] = "checking";
                if (!mountedRef.current) return;
                setStatuses({ ...ns });
                const { status, account, rateLimited } = await verifyToken(acc.token);
                // A 429 means Discord throttled the check, NOT that the token
                // is dead. Counting it as invalid wrongly flags working accounts.
                ns[acc.id] = status;
                if (account) {
                    if (account.username !== acc.username || account.avatar !== acc.avatar || account.discriminator !== acc.discriminator) refreshed++;
                    working[i] = account;
                    dirty = true;
                } else if (status === "invalid") {
                    working[i] = { ...acc, lastVerifiedAt: Date.now(), lastStatus: "invalid" };
                    dirty = true;
                }
                if (!mountedRef.current) return;
                setStatuses({ ...ns });
                await sleep(rateLimited ? 2500 : 400);
            }
            if (!mountedRef.current) return;
            if (dirty) {
                setAccounts(working);
                await saveAccounts(working);
            }
            if (refreshed > 0) showToast(`${refreshed} profile${refreshed !== 1 ? "s" : ""} refreshed`, Toasts.Type.MESSAGE);
            const invalidAccs = working.filter(a => ns[a.id] === "invalid");
            if (invalidAccs.length > 0) {
                openModal(props => (
                    <RemoveInvalidModal
                        rootProps={props}
                        invalidAccounts={invalidAccs}
                        onConfirm={async () => {
                            const toKeep = working.filter(a => ns[a.id] !== "invalid");
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
                const { status, account, rateLimited } = await verifyToken(tokens[i]);
                if (!mountedRef.current) return;
                if (account) {
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
                } else {
                    updated[i] = { ...updated[i], status };
                }
                if (!mountedRef.current) return;
                setResults([...updated]);
                await sleep(rateLimited ? 2500 : 200);
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
        <Modal
            {...rootProps}
            size="md"
            title={
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <FolderIcon width={16} height={16} /> DX Token Importer
                </div>
            }
        >
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
                            <div className={cl("filter-select")}>
                                <Select
                                    options={[
                                        { label: "Filter: All", value: "all" },
                                        { label: "Filter: Valid", value: "valid" },
                                        { label: "Filter: Invalid", value: "invalid" },
                                        { label: "Filter: Unverified", value: "unverified" },
                                    ]}
                                    serialize={identity}
                                    isSelected={(v: string) => v === statusFilter}
                                    select={(v: string) => setStatusFilter(v as typeof statusFilter)}
                                />
                            </div>
                            <div className={cl("filter-select")}>
                                <Select
                                    options={[
                                        { label: "Sort: Manual", value: "manual" },
                                        { label: "Sort: Name", value: "name" },
                                        { label: "Sort: Recently verified", value: "recent" },
                                        { label: "Sort: Stale first", value: "stale" },
                                    ]}
                                    serialize={identity}
                                    isSelected={(v: string) => v === sortMode}
                                    select={(v: string) => setSortMode(v as typeof sortMode)}
                                />
                            </div>
                        </div>
                        <div className={cl("actions")}>
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
                        {bulkMode && (
                            <div className={cl("bulk-bar")}>
                                <span className={cl("bulk-count")}>{selectedIds.size} selected</span>
                                <Button size={Button.Sizes.MIN} color={Button.Colors.TRANSPARENT} onClick={selectAll}>All</Button>
                                <Button size={Button.Sizes.MIN} color={Button.Colors.TRANSPARENT} onClick={selectNone}>None</Button>
                                <Button size={Button.Sizes.MIN} color={Button.Colors.PRIMARY} onClick={bulkCopy} disabled={selectedIds.size === 0}>Copy tokens</Button>
                                <Button size={Button.Sizes.MIN} color={Button.Colors.PRIMARY} onClick={bulkExport} disabled={selectedIds.size === 0}>Export</Button>
                                <Button size={Button.Sizes.MIN} color={Button.Colors.RED} onClick={bulkDelete} disabled={selectedIds.size === 0}>Delete</Button>
                                <Button size={Button.Sizes.MIN} color={Button.Colors.TRANSPARENT} onClick={() => { setBulkMode(false); selectNone(); }}>Done</Button>
                            </div>
                        )}
                        {!loaded ? <div className={cl("empty")} style={{ opacity: 0.5 }}>Loading accounts...</div>
                            : accounts.length === 0 ? <div className={cl("empty")}>No accounts — add tokens via the tab above.</div>
                                : filteredAccounts.length === 0 ? <div className={cl("empty")}>No accounts match your search.</div>
                                    : <div className={cl("list")}>
                                        {filteredAccounts.map(a => {
                                            const st = statuses[a.id] ?? "idle";
                                            const rowClass = st === "invalid" ? "row-invalid"
                                                : st === "error" || st === "rate_limited" ? "row-warn"
                                                    : st === "valid" ? "row-valid"
                                                        : isStale(a) ? "row-warn" : null;
                                            const isSelected = selectedIds.has(a.id);
                                            const isDraggable = sortMode === "manual" && !bulkMode;
                                            const showDropAbove = dropIndicator?.id === a.id && dropIndicator.position === "above";
                                            const showDropBelow = dropIndicator?.id === a.id && dropIndicator.position === "below";
                                            return (
                                                <div
                                                    key={a.id}
                                                    className={cl("row", rowClass, isSelected && "row-selected", showDropAbove && "row-drop-above", showDropBelow && "row-drop-below")}
                                                    draggable={isDraggable}
                                                    onDragStart={isDraggable ? e => handleDragStart(e, a.id) : undefined}
                                                    onDragOver={isDraggable ? e => handleDragOver(e, a.id) : undefined}
                                                    onDragLeave={isDraggable ? handleDragLeave : undefined}
                                                    onDragEnd={isDraggable ? handleDragEnd : undefined}
                                                    onDrop={isDraggable ? e => handleDrop(e, a.id) : undefined}
                                                    onDoubleClick={() => {
                                                        if (!bulkMode) {
                                                            setBulkMode(true);
                                                            setSelectedIds(new Set([a.id]));
                                                        } else {
                                                            toggleSelect(a.id);
                                                        }
                                                    }}
                                                >
                                                    {bulkMode && (
                                                        <div
                                                            className={cl("select-indicator", isSelected && "select-indicator-active")}
                                                            onClick={e => { e.stopPropagation(); toggleSelect(a.id); }}
                                                        >
                                                            {isSelected && <CheckIcon />}
                                                        </div>
                                                    )}
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
                                                        <span className={cl("meta", isStale(a) && "meta-stale")} title={a.lastStatus ? `Last result: ${a.lastStatus}` : undefined}>
                                                            {verifiedAgoLabel(a)}
                                                        </span>
                                                        {a.undecryptable
                                                            ? <span className={cl("token-hidden", "token-locked")} title="Token can't be decrypted on this machine">Locked</span>
                                                            : revealedId === a.id
                                                                ? <span className={cl("token-revealed")} onClick={() => copyWithToast(a.token, "Token copied!")} title="Click to copy">{a.token}</span>
                                                                : <span
                                                                    className={cl("token-hidden", "token-copyable")}
                                                                    onClick={() => copyWithToast(a.token, "Token copied!")}
                                                                    title="Copy token"
                                                                >•••••••••••••••••••••••••</span>}
                                                    </div>
                                                    <div className={cl("row-actions")}>
                                                        <Button size={Button.Sizes.MIN} color={Button.Colors.BRAND} disabled={a.undecryptable} onClick={() => switchToAccount(a.token, a.id)}>Switch</Button>
                                                        <Button size={Button.Sizes.MIN} color={Button.Colors.TRANSPARENT} aria-label="Reveal token" disabled={a.undecryptable} onClick={() => revealToken(a.id)}>
                                                            {revealedId === a.id ? <EyeOffIcon /> : <EyeIcon />}
                                                        </Button>
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
        </Modal>
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
        <Modal {...rootProps} size="sm" title={`Enable "${settingKey}"?`}>
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
        </Modal>
    );
}

// ── UI passphrase lock ──
// A UI gate: opening the modal, quick switcher or commands requires an unlock.
// Only a scrypt verifier is stored; comparison happens in the main process.
const LOCK_KEY = "DXTokenImporter_lock";

interface LockRecord { salt: string; verifier: string; }

// The verifier record is stored as an encrypted blob (same cipher as tokens);
// only a scrypt verifier ever exists — the passphrase itself is never stored.
async function getLock(): Promise<LockRecord | null> {
    const stored = await DataStore.get<LockRecord | string>(LOCK_KEY);
    if (!stored) return null;
    if (typeof stored === "string") {
        try {
            const json = await Native.decryptSecret(stored);
            return json ? JSON.parse(json) as LockRecord : null;
        } catch (e) {
            logger.debug("lock record decrypt failed", e);
            return null;
        }
    }
    // Records from before at-rest encryption were plain JSON objects.
    if (typeof stored.salt === "string" && typeof stored.verifier === "string") return stored;
    return null;
}

async function setLock(rec: LockRecord | null): Promise<void> {
    if (!rec) {
        await DataStore.del(LOCK_KEY);
        return;
    }
    const blob = await Native.encryptSecret(JSON.stringify(rec));
    if (!blob) {
        showToast("Could not persist the lock, encryption failed", Toasts.Type.FAILURE);
        return;
    }
    await DataStore.set(LOCK_KEY, blob);
}

let lockUnlocked = false;
let unlockFlowBusy = false;
let pendingAfterUnlock: (() => void) | null = null;

function UnlockModal({ rootProps }: { rootProps: RenderModalProps; }) {
    const [passphrase, setPassphrase] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    async function submit() {
        if (busy) return;
        setBusy(true);
        setError(null);
        try {
            const lock = await getLock();
            if (!lock) return;
            const ok = await Native.verifyLock(passphrase, lock.salt, lock.verifier);
            if (!ok) {
                setError("Wrong passphrase");
                await sleep(750); // light throttle against guessing
                return;
            }
            lockUnlocked = true;
            rootProps.onClose();
            const next = pendingAfterUnlock;
            pendingAfterUnlock = null;
            next?.();
        } finally {
            setBusy(false);
        }
    }

    return (
        <Modal {...rootProps} size="sm" title="DXTokenImporter is locked">
            <ModalContent>
                <input
                    autoFocus
                    type="password"
                    className={cl("search-input")}
                    style={{ width: "100%" }}
                    placeholder="Passphrase"
                    value={passphrase}
                    onChange={e => setPassphrase(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === "Enter") submit();
                    }}
                />
                {error && <Forms.FormText style={{ color: "var(--text-feedback-critical, var(--text-danger, #f23f43))", marginTop: 8 }}>{error}</Forms.FormText>}
            </ModalContent>
            <ModalFooter className={cl("footer")}>
                <Button color={Button.Colors.TRANSPARENT} onClick={rootProps.onClose}>Cancel</Button>
                <Button color={Button.Colors.BRAND} disabled={busy || passphrase.length === 0} onClick={submit}>{busy ? "Checking..." : "Unlock"}</Button>
            </ModalFooter>
        </Modal>
    );
}

// Opens a gated surface, showing the unlock modal first when locked.
async function requestSurface(open: () => void): Promise<void> {
    const lock = await getLock();
    if (!lock || lockUnlocked) {
        open();
        return;
    }
    if (unlockFlowBusy) return;
    unlockFlowBusy = true;
    pendingAfterUnlock = open;
    openModal(props => (
        <UnlockModal rootProps={{
            ...props,
            onClose: () => {
                unlockFlowBusy = false;
                pendingAfterUnlock = null;
                props.onClose();
            },
        }} />
    ));
}

// ── Vault backup (passphrase-protected portable export) ──
function PassphraseModal({ rootProps, title, confirmField = false, warnText, onConfirm }: {
    rootProps: RenderModalProps;
    title: string;
    confirmField?: boolean;
    warnText?: string;
    onConfirm: (passphrase: string) => Promise<string | null>;
}) {
    const [passphrase, setPassphrase] = useState("");
    const [confirm, setConfirm] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    async function submit() {
        if (busy) return;
        if (passphrase.length < 8) {
            setError("Passphrase must be at least 8 characters");
            return;
        }
        if (confirmField && passphrase !== confirm) {
            setError("Passphrases don't match");
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const err = await onConfirm(passphrase);
            if (err) {
                setError(err);
                return;
            }
            rootProps.onClose();
        } finally {
            setBusy(false);
        }
    }

    return (
        <Modal {...rootProps} size="sm" title={title}>
            <ModalContent>
                {warnText && <Forms.FormText style={{ marginBottom: 12 }}>{warnText}</Forms.FormText>}
                <input
                    autoFocus
                    type="password"
                    className={cl("search-input")}
                    style={{ width: "100%" }}
                    placeholder="Passphrase (8+ characters)"
                    value={passphrase}
                    onChange={e => setPassphrase(e.target.value)}
                />
                {confirmField && (
                    <input
                        type="password"
                        className={cl("search-input")}
                        style={{ width: "100%", marginTop: 8 }}
                        placeholder="Confirm passphrase"
                        value={confirm}
                        onChange={e => setConfirm(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === "Enter") submit();
                        }}
                    />
                )}
                {error && <Forms.FormText style={{ color: "var(--text-feedback-critical, var(--text-danger, #f23f43))", marginTop: 8 }}>{error}</Forms.FormText>}
            </ModalContent>
            <ModalFooter className={cl("footer")}>
                <Button color={Button.Colors.TRANSPARENT} onClick={rootProps.onClose}>Cancel</Button>
                <Button color={Button.Colors.BRAND} disabled={busy} onClick={submit}>{busy ? "Working..." : "Continue"}</Button>
            </ModalFooter>
        </Modal>
    );
}

function VaultBackupSection() {
    const [busy, setBusy] = useState(false);
    const [hasLock, setHasLockState] = useState<boolean | null>(null);
    useEffect(() => {
        let cancelled = false;
        getLock().then(l => {
            if (!cancelled) setHasLockState(l !== null);
        });
        return () => { cancelled = true; };
    }, []);

    function exportVault() {
        if (busy) return;
        openModal(props => (
            <PassphraseModal
                rootProps={props}
                title="Export encrypted backup"
                confirmField
                warnText="The backup file contains your tokens (encrypted with this passphrase). Anyone with the file AND the passphrase gets the accounts — store it accordingly."
                onConfirm={async passphrase => {
                    const accounts = (await getAccounts()).filter(a => !a.undecryptable);
                    if (!accounts.length) return "No exportable accounts";
                    const json = JSON.stringify({ version: 1, exportedAt: Date.now(), accounts });
                    const res = await Native.exportVault(json, passphrase);
                    if (!res.ok) return "Encryption failed, nothing was written";
                    saveFile(new File([res.payload], "dxtokenimporter-backup.txt", { type: "text/plain" }));
                    showToast(`Exported ${accounts.length} account${accounts.length !== 1 ? "s" : ""}`, Toasts.Type.SUCCESS);
                    return null;
                }}
            />
        ));
    }

    async function importVault() {
        if (busy) return;
        setBusy(true);
        try {
            const file = await chooseFile(".txt,text/plain");
            if (!file) return;
            const payload = (await file.text()).trim();
            if (!payload) {
                showToast("The selected file is empty", Toasts.Type.FAILURE);
                return;
            }
            openModal(props => (
                <PassphraseModal
                    rootProps={props}
                    title="Import encrypted backup"
                    warnText="Accounts are merged by user id: new accounts are added, existing ones get refreshed tokens."
                    onConfirm={async passphrase => {
                        const res = await Native.importVault(payload, passphrase);
                        if (!res.ok) return res.error === "bad_passphrase_or_corrupt" ? "Wrong passphrase or corrupted file" : "Import failed";
                        let parsed: { accounts?: SavedAccount[]; };
                        try {
                            parsed = JSON.parse(res.json);
                        } catch {
                            return "Backup is valid but not a DXTokenImporter vault";
                        }
                        if (!Array.isArray(parsed.accounts)) return "Backup is valid but not a DXTokenImporter vault";
                        const existing = [...await getAccounts()];
                        let added = 0;
                        let refreshed = 0;
                        for (const imp of parsed.accounts) {
                            if (!imp || typeof imp.id !== "string" || typeof imp.token !== "string" || !imp.token) continue;
                            const idx = existing.findIndex(a => a.id === imp.id);
                            if (idx === -1) {
                                existing.push(imp);
                                added++;
                            } else if (existing[idx].token !== imp.token) {
                                existing[idx] = imp;
                                refreshed++;
                            }
                        }
                        if (added + refreshed > 0) {
                            await saveAccounts(existing);
                            await patchTokenStore();
                        }
                        showToast(`Imported: ${added} added, ${refreshed} refreshed`, added + refreshed > 0 ? Toasts.Type.SUCCESS : Toasts.Type.MESSAGE);
                        return null;
                    }}
                />
            ));
        } finally {
            setBusy(false);
        }
    }

    return (
        <>
            <Forms.FormTitle tag="h5">Vault backup</Forms.FormTitle>
            <div className={cl("enc-actions")}>
                <Button size={Button.Sizes.SMALL} color={Button.Colors.PRIMARY} disabled={busy} onClick={exportVault}>Export encrypted backup</Button>
                <Button size={Button.Sizes.SMALL} color={Button.Colors.PRIMARY} disabled={busy} onClick={importVault}>Import backup</Button>
            </div>
            <Forms.FormText style={{ fontSize: 12, marginTop: 4 }}>
                Backups are AES-256-GCM encrypted with a scrypt key derived from your passphrase and can be restored on any machine.
                {hasLock === false && " Tip: set the UI lock below and reuse that passphrase so you only memorize one."}
            </Forms.FormText>
        </>
    );
}

function LockSection() {
    const [hasLock, setHasLockState] = useState<boolean | null>(null);
    useEffect(() => {
        let cancelled = false;
        getLock().then(l => {
            if (!cancelled) setHasLockState(l !== null);
        });
        return () => { cancelled = true; };
    }, []);

    function setPassphrase() {
        openModal(props => (
            <PassphraseModal
                rootProps={props}
                title="Set UI passphrase"
                confirmField
                warnText="This locks the DXTokenImporter UI (modal, quick switcher and commands) behind a passphrase. It does not re-encrypt stored tokens."
                onConfirm={async passphrase => {
                    const salt = await Native.makeLockSalt();
                    const verifier = await Native.deriveLockVerifier(passphrase, salt);
                    if (!verifier) return "Could not derive verifier";
                    await setLock({ salt, verifier });
                    setHasLockState(true);
                    showToast("UI lock enabled", Toasts.Type.SUCCESS);
                    return null;
                }}
            />
        ));
    }

    function changePassphrase() {
        openModal(props => (
            <PassphraseModal
                rootProps={props}
                title="Change UI passphrase"
                confirmField
                onConfirm={async passphrase => {
                    const lock = await getLock();
                    if (!lock) return "No lock is configured";
                    const verifier = await Native.deriveLockVerifier(passphrase, lock.salt);
                    if (!verifier) return "Could not derive verifier";
                    await setLock({ salt: lock.salt, verifier });
                    showToast("Passphrase updated", Toasts.Type.SUCCESS);
                    return null;
                }}
            />
        ));
    }

    function verifyCurrent(passphrase: string): Promise<boolean> {
        return getLock().then(lock => {
            if (!lock) return Promise.resolve(false);
            return Native.verifyLock(passphrase, lock.salt, lock.verifier);
        });
    }

    function removePassphrase() {
        openModal(props => (
            <PassphraseModal
                rootProps={props}
                title="Remove UI passphrase"
                warnText="Enter the current passphrase to remove the lock."
                onConfirm={async passphrase => {
                    if (!(await verifyCurrent(passphrase))) return "Wrong passphrase";
                    await setLock(null);
                    setHasLockState(false);
                    showToast("UI lock removed", Toasts.Type.MESSAGE);
                    return null;
                }}
            />
        ));
    }

    return (
        <>
            <Forms.FormTitle tag="h5">UI lock</Forms.FormTitle>
            <div className={cl("enc-actions")}>
                {hasLock === null
                    ? <Forms.FormText>Checking lock state...</Forms.FormText>
                    : hasLock
                        ? <>
                            <Button size={Button.Sizes.SMALL} color={Button.Colors.PRIMARY} onClick={changePassphrase}>Change passphrase</Button>
                            <Button size={Button.Sizes.SMALL} color={Button.Colors.RED} onClick={removePassphrase}>Remove lock</Button>
                            <Button size={Button.Sizes.SMALL} color={Button.Colors.TRANSPARENT} onClick={() => {
                                lockUnlocked = false;
                                showToast("Locked", Toasts.Type.MESSAGE);
                            }}>Lock now</Button>
                        </>
                        : <Button size={Button.Sizes.SMALL} color={Button.Colors.GREEN} onClick={setPassphrase}>Set passphrase</Button>}
            </div>
            <Forms.FormText style={{ fontSize: 12, marginTop: 4 }}>
                {hasLock
                    ? "Opening the modal, quick switcher or commands asks for the passphrase once per session. Only a scrypt verifier is stored (encrypted at rest like your tokens), and verification happens in the main process."
                    : "Optional passphrase that gates the plugin's UI. It protects against people at your keyboard, not against disk access."}
            </Forms.FormText>
        </>
    );
}

const ABOUT_KEYS: (keyof typeof settings.store)[] = [
    "importDestination",
    "encryptStoredTokens",
    "enableQuickSwitch",
    "autoVerifyInterval",
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
            <VaultBackupSection />
            <LockSection />
            <FormSwitch
                title="Alt+G quick switch hotkey"
                description="Opens the compact account switcher from anywhere. Takes effect after a reload."
                value={store.enableQuickSwitch}
                onChange={v => settings.store.enableQuickSwitch = v}
            />
            <Forms.FormTitle tag="h5">Background auto-verify</Forms.FormTitle>
            <Select
                options={[
                    { label: "Off", value: 0 },
                    { label: "Every 6 hours", value: 6 },
                    { label: "Every 12 hours", value: 12 },
                    { label: "Every 24 hours", value: 24 },
                ]}
                serialize={String}
                isSelected={(v: number) => v === (store.autoVerifyInterval as number)}
                select={(v: number) => {
                    settings.store.autoVerifyInterval = v;
                }}
            />
            <Forms.FormText style={{ fontSize: 12, marginTop: 4, marginBottom: 12 }}>
                Periodically verifies all saved tokens in the background and toasts if any are invalid. Takes effect after a reload.
            </Forms.FormText>
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

let qsModalOpen = false;
let qsLastOpenAttempt = 0;

// Compact keyboard-driven switcher: type to filter, arrows to move, Enter switches.
function QuickSwitcherModal({ rootProps }: { rootProps: RenderModalProps; }) {
    const [query, setQuery] = useState("");
    const [accounts, setAccounts] = useState<SavedAccount[]>(() => accountsCache ?? []);
    const [loaded, setLoaded] = useState(() => accountsCache !== null);
    const [selected, setSelected] = useState(0);

    useEffect(() => {
        qsModalOpen = true;
        let cancelled = false;
        if (accountsCache === null) {
            getAccounts().then(v => {
                if (!cancelled) { setAccounts(v); setLoaded(true); }
            });
        }
        return () => {
            cancelled = true;
            qsModalOpen = false;
        };
    }, []);

    const results = useMemo(() => {
        const q = query.trim().toLowerCase();
        const list = q
            ? accounts.filter(a => a.username.toLowerCase().includes(q) || a.id.includes(q))
            : accounts;
        return list.slice(0, 12);
    }, [accounts, query]);

    useEffect(() => setSelected(0), [query]);

    function doSwitch(acc: SavedAccount) {
        if (acc.undecryptable) return;
        rootProps.onClose();
        switchToAccount(acc.token, acc.id);
    }

    function onKeyDown(e: React.KeyboardEvent) {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setSelected(s => Math.min(s + 1, results.length - 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setSelected(s => Math.max(s - 1, 0));
        } else if (e.key === "Enter") {
            e.preventDefault();
            const acc = results[selected];
            if (acc) doSwitch(acc);
        }
    }

    return (
        <Modal {...rootProps} size="sm" title="Quick switcher">
            <ModalContent className={cl("qs-content")}>
                <input
                    autoFocus
                    className={cl("search-input")}
                    placeholder="Search accounts...  ↑↓ to move, Enter to switch"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    onKeyDown={onKeyDown}
                />
                <div className={cl("list", "qs-list")}>
                    {results.map((a, i) => (
                        <div
                            key={a.id}
                            className={cl("row", "qs-row", i === selected && "qs-row-selected", a.undecryptable && "row-invalid")}
                            onClick={() => doSwitch(a)}
                            onMouseEnter={() => setSelected(i)}
                        >
                            {a.avatar
                                ? <AccountAvatar id={a.id} avatar={a.avatar} />
                                : <div className={cl("avatar-ph")}>{a.username?.[0]?.toUpperCase() ?? "?"}</div>}
                            <div className={cl("row-info")}>
                                <span className={cl("username")}>
                                    {a.username}{a.discriminator && a.discriminator !== "0" ? `#${a.discriminator}` : ""}
                                    {a.lastStatus === "valid" && <span className={cl("st", "st-ok")}><CheckIcon /></span>}
                                    {a.lastStatus === "invalid" && <span className={cl("st", "st-bad")}><CrossIcon /></span>}
                                    {a.undecryptable && <span className={cl("st", "st-warn")}>!</span>}
                                </span>
                                <span className={cl("meta")}>{a.undecryptable ? "locked" : verifiedAgoLabel(a)}</span>
                            </div>
                        </div>
                    ))}
                    {results.length === 0 && (
                        <div className={cl("empty")}>{loaded ? "No accounts match." : "Loading accounts..."}</div>
                    )}
                </div>
            </ModalContent>
        </Modal>
    );
}

function openQuickSwitcher() {
    if (qsModalOpen) return;
    const now = Date.now();
    if (now - qsLastOpenAttempt < 300) return;
    qsLastOpenAttempt = now;
    openModal(props => <QuickSwitcherModal rootProps={props} />);
}

function DXTokenImporterButton() {
    return <HeaderBarButton icon={FolderIcon} tooltip="DX Token Importer" onClick={() => requestSurface(openTokenModal)} />;
}

// ── /dxtokens command handlers (module-level: command execute is NOT bound
// to the plugin object, so `this` is unusable inside it) ──
type CommandCtx = { channel: { id: string; }; };

async function ensureUnlocked(ctx: CommandCtx): Promise<boolean> {
    const lock = await getLock();
    if (lock && !lockUnlocked) {
        sendBotMessage(ctx.channel.id, { content: "DXTokenImporter is locked. Unlock it once via the plugin modal (header button) or Alt+G." });
        return false;
    }
    return true;
}

async function listAccountsCommand(ctx: CommandCtx): Promise<void> {
    if (!(await ensureUnlocked(ctx))) return;
    const accounts = await getAccounts();
    if (!accounts.length) {
        sendBotMessage(ctx.channel.id, { content: "No saved accounts yet." });
        return;
    }
    const lines = accounts.slice(0, 25).map(a => {
        const state = a.undecryptable ? "locked" : a.lastStatus ?? "unverified";
        return `${a.username} — ${state}${a.lastVerifiedAt ? ` (${verifiedAgoLabel(a)})` : ""}`;
    });
    const more = accounts.length > 25 ? `\n…and ${accounts.length - 25} more` : "";
    sendBotMessage(ctx.channel.id, { content: `**Saved accounts (${accounts.length})**\n${lines.join("\n")}${more}` });
}

async function verifyAllCommand(ctx: CommandCtx): Promise<void> {
    if (!(await ensureUnlocked(ctx))) return;
    sendBotMessage(ctx.channel.id, { content: "Verifying all accounts..." });
    const { valid, invalid, limited, refreshed } = await verifyAllHeadless();
    sendBotMessage(ctx.channel.id, {
        content: `Done. ${valid} valid, ${invalid} invalid${limited ? `, ${limited} rate limited (not re-checked)` : ""}${refreshed ? `, ${refreshed} profile${refreshed !== 1 ? "s" : ""} refreshed` : ""}.`,
    });
}

async function switchCommand(ctx: CommandCtx, query: string): Promise<void> {
    if (!(await ensureUnlocked(ctx))) return;
    const accounts = await getAccounts();
    const matches = accounts.filter(a => a.username.toLowerCase().includes(query) || a.id === query);
    if (matches.length === 0) {
        sendBotMessage(ctx.channel.id, { content: "No saved account matches that name or id." });
        return;
    }
    if (matches.length > 1) {
        sendBotMessage(ctx.channel.id, { content: `Ambiguous match, be more specific:\n${matches.slice(0, 8).map(a => a.username).join("\n")}${matches.length > 8 ? "\n…" : ""}` });
        return;
    }
    const target = matches[0];
    if (target.undecryptable) {
        sendBotMessage(ctx.channel.id, { content: "That account's token is locked and can't be decrypted on this machine." });
        return;
    }
    sendBotMessage(ctx.channel.id, { content: `Switching to ${target.username}...` });
    setTimeout(() => switchToAccount(target.token, target.id), 1000);
}

async function importTokenCommand(ctx: CommandCtx, token: string): Promise<void> {
    if (!(await ensureUnlocked(ctx))) return;
    if (!TOKEN_SHAPE.test(token)) {
        sendBotMessage(ctx.channel.id, { content: "That doesn't look like a valid token format." });
        return;
    }
    sendBotMessage(ctx.channel.id, { content: "Verifying token..." });
    const { status, account } = await verifyToken(token);
    if (!account) {
        sendBotMessage(ctx.channel.id, { content: `Token is ${status === "rate_limited" ? "rate limited (try again later)" : status}.` });
        return;
    }
    const existing = [...await getAccounts()];
    const idx = existing.findIndex(a => a.id === account.id);
    if (idx === -1) {
        existing.push(account);
    } else {
        existing[idx] = account;
    }
    await saveAccounts(existing);
    await patchTokenStore();
    sendBotMessage(ctx.channel.id, { content: `Imported **${account.username}** (${account.id})${idx !== -1 ? " (token updated)" : ""}.` });
}

async function exportVaultCommand(ctx: CommandCtx): Promise<void> {
    if (!(await ensureUnlocked(ctx))) return;
    const accounts = (await getAccounts()).filter(a => !a.undecryptable);
    if (!accounts.length) {
        sendBotMessage(ctx.channel.id, { content: "No exportable accounts in the vault." });
        return;
    }
    openModal(props => (
        <PassphraseModal
            rootProps={props}
            title="Export encrypted backup"
            confirmField
            warnText="The backup file contains your tokens (encrypted with this passphrase). Anyone with the file AND the passphrase gets the accounts — store it accordingly."
            onConfirm={async passphrase => {
                const json = JSON.stringify({ version: 1, exportedAt: Date.now(), accounts });
                const res = await Native.exportVault(json, passphrase);
                if (!res.ok) return "Encryption failed, nothing was written";
                saveFile(new File([res.payload], "dxtokenimporter-backup.txt", { type: "text/plain" }));
                sendBotMessage(ctx.channel.id, { content: `Exported ${accounts.length} account${accounts.length !== 1 ? "s" : ""} to file.` });
                return null;
            }}
        />
    ));
}

async function removeAccountCommand(ctx: CommandCtx, query: string): Promise<void> {
    if (!(await ensureUnlocked(ctx))) return;
    const accounts = await getAccounts();
    const matches = accounts.filter(a => a.username.toLowerCase().includes(query) || a.id === query);
    if (matches.length === 0) {
        sendBotMessage(ctx.channel.id, { content: "No saved account matches that name or id." });
        return;
    }
    if (matches.length > 1) {
        sendBotMessage(ctx.channel.id, { content: `Ambiguous match, be more specific:\n${matches.slice(0, 8).map(a => a.username).join("\n")}${matches.length > 8 ? "\n…" : ""}` });
        return;
    }
    const target = matches[0];
    const updated = accounts.filter(a => a.id !== target.id);
    await saveAccounts(updated);
    sendBotMessage(ctx.channel.id, { content: `Removed **${target.username}** (${target.id}) from saved accounts.` });
}

export default definePlugin({
    name: "DXTokenImporter",
    description: "Import and verify Discord tokens.",
    tags: ["Utility", "Nightcord"],
    authors: [TestcordDevs.x2b, TestcordDevs.sirphantom89],
    settings,
    settingsAboutComponent: DXTokenImporterSettingsPanel,
    headerBarButton: {
        render: () => <DXTokenImporterButton />,
        icon: FolderIcon,
        priority: 10,
    },
    // Built-in commands live only in this client's command index — other users
    // can neither see nor invoke them — and every handler is gated by the UI
    // passphrase lock. Replies are ephemeral (sendBotMessage).
    commands: [
        {
            name: "dxtokens",
            description: "DXTokenImporter: manage saved accounts",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "list",
                    description: "List saved accounts with their last verification state",
                    type: ApplicationCommandOptionType.SUB_COMMAND,
                },
                {
                    name: "verify",
                    description: "Verify and refresh every saved account",
                    type: ApplicationCommandOptionType.SUB_COMMAND,
                },
                {
                    name: "switch",
                    description: "Switch to a saved account (by username or user id)",
                    type: ApplicationCommandOptionType.SUB_COMMAND,
                    options: [
                        {
                            name: "account",
                            description: "Username or user id",
                            type: ApplicationCommandOptionType.STRING,
                            required: true,
                        },
                    ],
                },
                {
                    name: "import",
                    description: "Import a single token directly",
                    type: ApplicationCommandOptionType.SUB_COMMAND,
                    options: [
                        {
                            name: "token",
                            description: "The Discord token to import",
                            type: ApplicationCommandOptionType.STRING,
                            required: true,
                        },
                    ],
                },
                {
                    name: "export",
                    description: "Export the vault as an encrypted backup file",
                    type: ApplicationCommandOptionType.SUB_COMMAND,
                },
                {
                    name: "remove",
                    description: "Remove a saved account (by username or user id)",
                    type: ApplicationCommandOptionType.SUB_COMMAND,
                    options: [
                        {
                            name: "account",
                            description: "Username or user id",
                            type: ApplicationCommandOptionType.STRING,
                            required: true,
                        },
                    ],
                },
                {
                    name: "open",
                    description: "Open the account manager",
                    type: ApplicationCommandOptionType.SUB_COMMAND,
                },
            ],
            execute(args, ctx) {
                const sub = args[0];
                if (!sub) return;

                // Defense in depth: built-in commands are local-only, but never
                // act outside a channel the account owner is in.
                if (!UserStore.getCurrentUser()) return;

                switch (sub.name) {
                    case "open":
                        requestSurface(openTokenModal);
                        break;
                    case "list":
                        listAccountsCommand(ctx);
                        break;
                    case "verify":
                        verifyAllCommand(ctx);
                        break;
                    case "switch": {
                        const query = String(findOption(sub.options, "account", "") ?? "").trim().toLowerCase();
                        if (!query) {
                            sendBotMessage(ctx.channel.id, { content: "Specify an account: `/dxtokens switch account:<username or id>`" });
                            return;
                        }
                        switchCommand(ctx, query);
                        break;
                    }
                    case "import": {
                        const token = String(findOption(sub.options, "token", "") ?? "").trim();
                        if (!token) {
                            sendBotMessage(ctx.channel.id, { content: "Specify a token: `/dxtokens import token:<token>`" });
                            return;
                        }
                        importTokenCommand(ctx, token);
                        break;
                    }
                    case "export":
                        requestSurface(() => exportVaultCommand(ctx));
                        break;
                    case "remove": {
                        const account = String(findOption(sub.options, "account", "") ?? "").trim().toLowerCase();
                        if (!account) {
                            sendBotMessage(ctx.channel.id, { content: "Specify an account: `/dxtokens remove account:<username or id>`" });
                            return;
                        }
                        removeAccountCommand(ctx, account);
                        break;
                    }
                }
            },
        },
    ],
    _injectTimer: null as ReturnType<typeof setTimeout> | null,
    _autoVerifyTimer: null as ReturnType<typeof setInterval> | null,
    _started: false,
    handleQuickSwitch(event: KeyboardEvent) {
        if (!event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
        if (event.key.toLowerCase() !== "g") return;
        event.preventDefault();
        requestSurface(openQuickSwitcher);
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
                && (window.DiscordNative?.process?.platform === "win32"
                    || window.DiscordNative?.process?.platform === "darwin"
                    || window.DiscordNative?.process?.platform === "linux")
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
        // Background auto-verify scheduler
        const intervalHours = settings.store.autoVerifyInterval as number;
        if (intervalHours > 0) {
            const intervalMs = intervalHours * 60 * 60 * 1000;
            this._autoVerifyTimer = setInterval(async () => {
                if (!this._started) return;
                try {
                    const { invalid } = await verifyAllHeadless();
                    if (invalid > 0) showToast(`Auto-verify: ${invalid} token${invalid !== 1 ? "s" : ""} invalid`, Toasts.Type.FAILURE);
                } catch (e) {
                    logger.debug("auto-verify failed", e);
                }
            }, intervalMs);
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
        if (this._autoVerifyTimer) {
            clearInterval(this._autoVerifyTimer);
            this._autoVerifyTimer = null;
        }
        document.removeEventListener("keydown", this.handleQuickSwitch);
        modalOpen = false;
        qsModalOpen = false;
        lockUnlocked = false;
        unlockFlowBusy = false;
        pendingAfterUnlock = null;
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
