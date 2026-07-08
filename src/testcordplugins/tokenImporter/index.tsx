/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { addHeaderBarButton, HeaderBarButton, removeHeaderBarButton } from "@api/HeaderBar";
import { DataStore } from "@api/index";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { sleep } from "@utils/misc";
import { ModalCloseButton, ModalContent, ModalHeader, ModalRoot, openModal } from "@utils/modal";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { findByProps } from "@webpack";
import { Forms, React, showToast, Toasts, useCallback, useEffect, useMemo, useRef, useState } from "@webpack/common";

import { t } from "../autoTranslateNightcord";

const Native = VencordNative.pluginHelpers.TokenImporter as PluginNative<typeof import("./native")>;
const STORE_KEY = "TokenImporter_accounts";

const settings = definePluginSettings({
    autoScanOnStartup: {
        type: OptionType.BOOLEAN,
        description: "Automatically scan local Discord installs for tokens when the plugin starts (Windows only). Reads other Discord profiles' encrypted token blobs and decrypts them.",
        default: false,
    },
    enableLocalScan: {
        type: OptionType.BOOLEAN,
        description: "Allow the \"Scan local Discords\" button and the underlying local token-scraping code path. When off, the button is hidden and the auto-scan setting has no effect.",
        default: false,
    },
    patchTokenStore: {
        type: OptionType.BOOLEAN,
        description: "Monkey-patch Discord's internal encryptAndStoreTokens so saved accounts are injected into Discord's own token storage. Required for saved accounts to appear in Discord's native account switcher.",
        default: false,
    },
    injectIntoMultiAccountStore: {
        type: OptionType.BOOLEAN,
        description: "Dispatch fake MULTI_ACCOUNT_VALIDATE_TOKEN_SUCCESS Flux events on startup to register saved accounts with Discord's multi-account store.",
        default: false,
    },
    useLocalStorageBypass: {
        type: OptionType.BOOLEAN,
        description: "When switching accounts, also write the token to localStorage via a hidden iframe. This bypasses Discord's localStorage scrubbing. When off, switching uses only the Webpack token-store API + reload.",
        default: false,
    },
    encryptStoredTokens: {
        type: OptionType.BOOLEAN,
        description: "Encrypt saved tokens at rest using Electron safeStorage (OS keychain / DPAPI). When off, tokens are stored in plaintext in IndexedDB.",
        default: true,
    },
    enableQuickSwitch: {
        type: OptionType.BOOLEAN,
        description: "Enable an Alt+G hotkey to quickly open the account switcher.",
        default: false,
    },
    importDestination: {
        type: OptionType.SELECT,
        description: "Where bulk-imported tokens are saved. TokenImporter is this plugin's own encrypted store; Login Manager is the TokenLoginManager vault.",
        options: [
            { label: "Both", value: "both", default: true },
            { label: "TokenImporter only", value: "importer" },
            { label: "Login Manager only", value: "loginManager" },
        ],
    },
});

// Routes parsed tokens into the TokenLoginManager vault, mirroring the original
// ImportMultiTokens behavior so that import path is preserved losslessly. Guarded
// so a missing or disabled TokenLoginManager plugin fails softly.
function routeToLoginManager(accounts: Array<{ username: string; token: string; }>): { ok: boolean; reason?: string; } {
    const plugin = Vencord.Plugins.plugins.TokenLoginManager as any;
    if (!plugin) return { ok: false, reason: "TokenLoginManager plugin not found" };
    if (!Vencord.Plugins.isPluginEnabled("TokenLoginManager")) return { ok: false, reason: "TokenLoginManager is disabled" };
    const manager = plugin.tokenLoginManager;
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

const ACK_KEY = "TokenImporter_ackedDangerousSettings";

async function getAckedDangerous(): Promise<Set<DangerousSetting>> {
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

interface SavedAccount { id: string; token: string; username: string; discriminator: string; avatar: string; }

let accountsCache: SavedAccount[] | null = null;
let loadPromise: Promise<SavedAccount[]> | null = null;

// On-disk shape may have token stored as plaintext or as an opaque encrypted string
// prefixed with "dQw4w9WgXcQ:". getAccounts transparently decrypts on read.
async function decryptIfNeeded(tok: string): Promise<string> {
    if (!tok.startsWith("dQw4w9WgXcQ:")) return tok;
    try {
        const plain = await Native.decryptStoredToken(tok);
        return plain ?? tok;
    } catch {
        return tok;
    }
}

async function encryptIfEnabled(tok: string): Promise<string> {
    if (!settings.store.encryptStoredTokens) return tok;
    if (tok.startsWith("dQw4w9WgXcQ:")) return tok;
    try {
        const enc = await Native.encryptToken(tok);
        return enc ?? tok;
    } catch {
        return tok;
    }
}

function getAccounts(): Promise<SavedAccount[]> {
    if (accountsCache !== null) return Promise.resolve(accountsCache);
    if (!loadPromise) {
        loadPromise = DataStore.get<SavedAccount[]>(STORE_KEY).then(async v => {
            const raw = v ?? [];
            const decrypted: SavedAccount[] = [];
            for (const a of raw) {
                decrypted.push({ ...a, token: await decryptIfNeeded(a.token) });
            }
            accountsCache = decrypted;
            loadPromise = null;
            return accountsCache;
        });
    }
    return loadPromise;
}

async function saveAccounts(accounts: SavedAccount[]): Promise<void> {
    const unique = new Map<string, SavedAccount>();
    for (const a of accounts) {
        unique.set(a.id, a); // Always overwrite so an updated token for an existing account is kept
    }
    const deduplicated = Array.from(unique.values());
    accountsCache = deduplicated;
    // Persist with optional at-rest encryption per setting.
    const onDisk: SavedAccount[] = [];
    for (const a of deduplicated) {
        onDisk.push({ ...a, token: await encryptIfEnabled(a.token) });
    }
    await DataStore.set(STORE_KEY, onDisk);
}

let tokenModulePatched = false;
let originalEncryptAndStoreTokens: any = null;

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
                try { const saved = await getAccounts(); for (const acc of saved) { if (!tokens[acc.id]) tokens[acc.id] = acc.token; } } catch { }
                return orig(tokens);
            },
            writable: true,
            configurable: true
        });
        tokenModulePatched = true;
    } catch (e) {
        console.warn("[TokenImporter] patchTokenStore failed", e);
    }
}

function switchToAccount(token: string, userId?: string) {
    try {
        const isMultiInstance = window.location.href.includes("multi-instance=true") || (window as any).IS_MULTI_INSTANCE;
        if (isMultiInstance && userId) {
            if (typeof VencordNative?.pluginHelpers?.MultiInstance?.openInstanceWindow === "function") {
                VencordNative.pluginHelpers.MultiInstance.openInstanceWindow(token, userId, true);
                window.close();
                return;
            }
        }

        const TokenStore = findByProps("getToken", "setToken");

        if (TokenStore && typeof (TokenStore as any).setToken === "function") {
            (TokenStore as any).setToken(token);
        }

        if (settings.store.useLocalStorageBypass) {
            window.localStorage.setItem("token", `"${token}"`);
            const iframe = document.createElement("iframe");
            iframe.style.display = "none";
            document.body.appendChild(iframe);
            try {
                (iframe as any).contentWindow.localStorage.token = `"${token}"`;
            } catch { }
            document.body.removeChild(iframe);
        }

        setTimeout(() => {
            location.reload();
        }, 350);
    } catch (err) {
        console.error("[TokenImporter] Switch failed:", err);
        location.reload();
    }
}

function copyMyToken() {
    try {
        const token = findByProps("getToken")?.getToken?.();
        if (token) {
            if (typeof window.DiscordNative?.clipboard?.copy === "function") {
                window.DiscordNative.clipboard.copy(token);
            } else {
                navigator.clipboard.writeText(token);
            }
        }
    } catch { }
}

function FolderIcon({ width = 20, height = 20, style }: { width?: number; height?: number; style?: React.CSSProperties; }) {
    return <svg width={width} height={height} viewBox="0 0 24 24" fill="currentColor" style={style}><path d="M2 5a3 3 0 0 1 3-3h3.93a2 2 0 0 1 1.66.9L12 5h7a3 3 0 0 1 3 3v11a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V5Z" /></svg>;
}

function TrashIcon() {
    return <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2h4a1 1 0 1 1 0 2h-1.1l-.9 12.1A3 3 0 0 1 17 23H7a3 3 0 0 1-3-2.9L3.1 8H2a1 1 0 0 1 0-2h4V4Zm2 0v2h6V4H9ZM5.1 8l.9 11.9a1 1 0 0 0 1 .1h6a1 1 0 0 0 1-.1L14.9 8H5.1Z" /></svg>;
}

function CopyIcon() {
    return <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1Zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2Zm0 16H8V7h11v14Z" /></svg>;
}

function CheckIcon() {
    return <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" /></svg>;
}

function CrossIcon() {
    return <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 17.59 13.41 12 19 6.41z" /></svg>;
}

function getAvatarUrl(userId: string, avatarHash: string | null | undefined): string {
    return avatarHash
        ? `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.webp?size=64`
        : `https://cdn.discordapp.com/embed/avatars/${(BigInt(userId) >> 22n) % 6n}.png`;
}

const TOKEN_REGEX = /(?:mfa\.[\w-]{84}|[\w-]{24,26}\.[\w-]{4,7}\.[\w-]{27,40})/g;

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

    // 3-line format first (userId, blank, token), repeating every 3 lines.
    if (lines.length >= 3) {
        const seen = new Set<string>();
        for (let i = 0; i < lines.length; i += 3) {
            const userId = lines[i]?.trim();
            const token = stripQuotes(lines[i + 2] ?? "");
            if (userId && token) seen.add(token);
        }
        if (seen.size > 0) return Array.from(seen);
    }

    const seen = new Set<string>();
    const parts = cleaned.includes(",") ? cleaned.split(",") : lines;
    for (const part of parts) {
        const token = stripQuotes(part);
        if (token) seen.add(token);
    }
    if (seen.size > 0) return Array.from(seen);

    // Fallback: recover any token embedded in free-form text.
    return extractTokens(cleaned);
}

interface TokenResult { token: string; status: "pending" | "checking" | "valid" | "invalid" | "error" | "rate_limited"; username?: string; avatar?: string; id?: string; }

function RemoveInvalidModal({ rootProps, invalidAccounts, onConfirm }: {
    rootProps: any;
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
                <div className="ti-list" style={{ maxHeight: 120, marginBottom: 12 }}>
                    {invalidAccounts.map(a => (
                        <div key={a.id} className="ti-row ti-row--invalid">
                            {a.avatar
                                ? <img src={a.avatar} className="ti-avatar" alt="" />
                                : <div className="ti-avatar ti-avatar--ph">{a.username?.[0]?.toUpperCase() ?? "?"}</div>}
                            <span className="ti-username">{a.username}</span>
                        </div>
                    ))}
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
                    <button className="ti-verify-btn" onClick={() => rootProps.onClose()}>Keep them</button>
                    <button
                        className="ti-del-btn"
                        style={{ padding: "4px 12px", fontSize: 13 }}
                        onClick={() => { onConfirm(); rootProps.onClose(); }}
                    >
                        Remove invalid
                    </button>
                </div>
            </ModalContent>
        </ModalRoot>
    );
}

function TokenModal({ rootProps }: { rootProps: any; }) {
    const [accounts, setAccounts] = useState<SavedAccount[]>(() => accountsCache ?? []);
    const [loaded, setLoaded] = useState(() => accountsCache !== null);
    const [verifying, setVerifying] = useState(false);
    const [statuses, setStatuses] = useState<Record<string, string>>({});
    const [tab, setTab] = useState<"saved" | "add">("saved");
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

    const filteredAccounts = useMemo(() => {
        if (!accountSearch.trim()) return accounts;
        const lowSearch = accountSearch.toLowerCase();
        return accounts.filter(a => a.username.toLowerCase().includes(lowSearch) || a.id.includes(lowSearch));
    }, [accounts, accountSearch]);

    const detectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (accountsCache !== null) {
            setAccounts(accountsCache);
            setLoaded(true);
            return () => {
                mountedRef.current = false;
                if (detectTimer.current) clearTimeout(detectTimer.current);
                if (copiedTimer.current) clearTimeout(copiedTimer.current);
            };
        }
        let cancelled = false;
        getAccounts().then(v => {
            if (!cancelled) { setAccounts(v); setLoaded(true); }
        });
        return () => {
            cancelled = true;
            mountedRef.current = false;
            if (detectTimer.current) clearTimeout(detectTimer.current);
            if (copiedTimer.current) clearTimeout(copiedTimer.current);
        };
    }, []);

    const handleTabChange = useCallback((newTab: "saved" | "add") => {
        setTab(newTab);
        if (newTab === "saved" && accountsCache !== null) {
            setAccounts(accountsCache);
        }
    }, []);

    async function removeAccount(id: string) {
        const updated = accounts.filter(a => a.id !== id);
        setAccounts(updated);
        await saveAccounts(updated);
    }

    async function verifyAll() {
        if (verifying) return;
        setVerifying(true);
        const ns: Record<string, string> = {};
        for (const acc of accounts) {
            ns[acc.id] = "checking";
            if (!mountedRef.current) return;
            setStatuses({ ...ns });
            try {
                const r = await Native.checkToken(acc.token);
                ns[acc.id] = r.valid ? "valid" : "invalid";
            } catch {
                ns[acc.id] = "error";
            }
            if (!mountedRef.current) return;
            setStatuses({ ...ns });
            await sleep(400);
        }
        if (!mountedRef.current) return;
        setVerifying(false);
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
    }

    async function processTokens(raw: string, destOverride?: "importer" | "loginManager" | "both") {
        const tokens = parseBulkTokens(raw);
        if (!tokens.length) { setResults([{ token: "No tokens found", status: "invalid" }]); return; }
        const initial: TokenResult[] = tokens.map(t => ({ token: t, status: "pending" as const }));
        setResults(initial); setChecking(true); setDone(false);
        const updated = [...initial];
        const existing = await getAccounts();
        if (!mountedRef.current) return;
        const validForRouting: Array<{ username: string; token: string; }> = [];
        for (let i = 0; i < tokens.length; i++) {
            if (!mountedRef.current) return;
            updated[i] = { ...updated[i], status: "checking" }; setResults([...updated]);
            try {
                const result = await Native.checkToken(tokens[i]);
                if (!mountedRef.current) return;
                if (result.valid && result.user) {
                    const u = result.user;
                    const av = getAvatarUrl(u.id, u.avatar);
                    const saveLocally = (destOverride ?? settings.store.importDestination ?? "both") !== "loginManager";
                    if (saveLocally && !existing.find(a => a.id === u.id)) {
                        existing.push({ id: u.id, token: tokens[i], username: u.global_name || u.username, discriminator: u.discriminator ?? "0", avatar: av });
                        await saveAccounts(existing);
                        await patchTokenStore();
                        if (!mountedRef.current) return;
                        setAccounts([...existing]);
                    }
                    validForRouting.push({ username: u.global_name || u.username, token: tokens[i] });
                    updated[i] = { ...updated[i], status: "valid", username: u.global_name || u.username, id: u.id, avatar: av };
                } else {
                    updated[i] = { ...updated[i], status: (result as any).error === "rate_limited" ? "rate_limited" : (result as any).error ? "error" : "invalid" };
                }
            } catch { updated[i] = { ...updated[i], status: "error" }; }
            if (!mountedRef.current) return;
            setResults([...updated]);
            await sleep(200);
        }
        const dest = destOverride ?? settings.store.importDestination ?? "both";
        if (dest !== "importer" && validForRouting.length) {
            const routed = routeToLoginManager(validForRouting);
            if (!routed.ok) showToast(`Login Manager import skipped: ${routed.reason}`, Toasts.Type.FAILURE);
            else showToast(`Sent ${validForRouting.length} account(s) to Login Manager`, Toasts.Type.SUCCESS);
        }
        setChecking(false); setDone(true);
    }

    function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => processTokens(ev.target?.result as string ?? "");
        reader.readAsText(file); e.target.value = "";
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

    return (
        <ModalRoot {...rootProps} size="medium">
            <ModalHeader separator={false}>
                <Forms.FormTitle tag="h4" style={{ margin: 0, display: "flex", alignItems: "center", gap: 8, color: "#ffffff", flex: 1 }}>
                    <FolderIcon width={16} height={16} /> Token Importer
                </Forms.FormTitle>
                <ModalCloseButton onClick={rootProps.onClose} />
            </ModalHeader>
            <ModalContent className="ti-content">
                <div className="ti-tabs">
                    <button className={`ti-tab ${tab === "saved" ? "ti-tab--active" : ""}`} onClick={() => handleTabChange("saved")}>
                        Saved accounts
                        {accounts.length > 0 && <span className="ti-tab-count">{accounts.length}</span>}
                    </button>
                    <button className={`ti-tab ${tab === "add" ? "ti-tab--active" : ""}`} onClick={() => handleTabChange("add")}>
                        Paste tokens
                    </button>
                </div>

                {tab === "saved" && (
                    <>
                        <div className="ti-bar">
                            <div className="ti-search-wrap">
                                <input className="ti-search-input" placeholder={t("Search accounts...")} value={accountSearch} onChange={e => setAccountSearch(e.target.value)} />
                                {accountSearch && <button className="ti-search-clear" onClick={() => setAccountSearch("")}>✕</button>}
                            </div>
                            {settings.store.enableLocalScan && <button className="ti-verify-btn" style={{ marginRight: 6 }} onClick={async () => {
                                if (verifying) return;
                                setVerifying(true);
                                try {
                                    const tokens = await Native.findLocalTokens();
                                    if (!mountedRef.current) return;
                                    const existing = await getAccounts();
                                    if (!mountedRef.current) return;
                                    let addedCount = 0;
                                    for (const tok of tokens) {
                                        if (!existing.find(a => a.token === tok)) {
                                            const verified = await Native.checkToken(tok);
                                            if (!mountedRef.current) return;
                                            if (verified.valid && verified.user) {
                                                const u = verified.user;
                                                const av = getAvatarUrl(u.id, u.avatar);
                                                if (!existing.find(a => a.id === u.id)) {
                                                    existing.push({ id: u.id, token: tok, username: u.global_name || u.username, discriminator: u.discriminator ?? "0", avatar: av });
                                                    addedCount++;
                                                }
                                            }
                                            await sleep(200);
                                        }
                                    }
                                    if (addedCount > 0) {
                                        await saveAccounts(existing);
                                        await patchTokenStore();
                                        if (!mountedRef.current) return;
                                        setAccounts([...existing]);
                                        (window as any).Vencord?.Webpack?.findByProps?.("showToast")?.showToast?.(`${addedCount} new accounts imported!`);
                                    } else {
                                        (window as any).Vencord?.Webpack?.findByProps?.("showToast")?.showToast?.("No new accounts found.");
                                    }
                                } catch (err) {
                                    console.error("[TokenImporter] Scan failed:", err);
                                } finally {
                                    if (mountedRef.current) setVerifying(false);
                                }
                            }}>
                                <FolderIcon width={12} height={12} style={{ marginRight: 4 }} /> Scan local Discords
                            </button>}
                            <button className="ti-verify-btn" style={{ marginRight: 6, opacity: copied ? 0.7 : 1 }} onClick={() => { copyMyToken(); setCopied(true); if (copiedTimer.current) clearTimeout(copiedTimer.current); copiedTimer.current = setTimeout(() => { copiedTimer.current = null; if (mountedRef.current) setCopied(false); }, 1500); }}>
                                {copied ? "Copied ✓" : "My Token"}
                            </button>
                            <button className="ti-verify-btn" onClick={verifyAll} disabled={verifying || !loaded}>
                                {verifying ? "Verifying..." : "Verify all"}
                            </button>
                        </div>
                        {!loaded ? <div className="ti-empty" style={{ opacity: 0.5 }}>Loading accounts...</div>
                            : accounts.length === 0 ? <div className="ti-empty">No accounts — add tokens via the tab above.</div>
                                : filteredAccounts.length === 0 ? <div className="ti-empty">No accounts match your search.</div>
                                    : <div className="ti-list">
                                        {filteredAccounts.map(a => {
                                            const st = statuses[a.id] ?? "idle";
                                            return (
                                                <div key={a.id} className={`ti-row ti-row--${st === "invalid" ? "invalid" : st === "error" ? "warn" : st === "valid" ? "valid" : "idle"}`}>
                                                    {a.avatar ? <img src={a.avatar} className="ti-avatar" alt="" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                                                        : <div className="ti-avatar ti-avatar--ph">{a.username?.[0]?.toUpperCase() ?? "?"}</div>}
                                                    <div className="ti-row-info">
                                                        <span className="ti-username">
                                                            {a.username}{a.discriminator && a.discriminator !== "0" ? `#${a.discriminator}` : ""}
                                                            {st === "valid" && <span className="ti-st ti-st--ok"><CheckIcon /></span>}
                                                            {st === "invalid" && <span className="ti-st ti-st--bad"><CrossIcon /></span>}
                                                            {st === "checking" && <span className="ti-st ti-st--loading">...</span>}
                                                        </span>
                                                        <span className="ti-token-hidden" onClick={() => navigator.clipboard.writeText(a.token)} title="Copy token" style={{ cursor: "pointer" }}>••••••••••••••••••••••••</span>
                                                    </div>
                                                    <div className="ti-row-actions">
                                                        <button className="ti-switch-btn" onClick={() => switchToAccount(a.token, a.id)}>Switch</button>
                                                        <button className="ti-del-btn" style={{ color: "#b9bbbe" }} title="Copy Token" onClick={() => {
                                                            const native = (window as any).DiscordNative?.clipboard?.copy;
                                                            if (typeof native === "function") native(a.token);
                                                            else navigator.clipboard.writeText(a.token);
                                                            const { showToast, Toasts } = (window as any).Vencord.Webpack.common;
                                                            showToast("Token copied!", Toasts.Type.SUCCESS);
                                                        }}><CopyIcon /></button>
                                                        <button className="ti-del-btn" title="Delete" onClick={() => removeAccount(a.id)}><TrashIcon /></button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                        }
                    </>
                )}

                {tab === "add" && (
                    <div className="ti-add-body">
                        <textarea className="ti-textarea ti-textarea-mask" placeholder="Paste your Discord tokens here... (one per line, comma-separated, or 3-line userId/blank/token format)" value={pasteValue} onChange={e => handlePasteChange(e.target.value)} autoFocus />
                        <div className="ti-add-footer">
                            <span className="ti-detected">{detectedCount} token{detectedCount !== 1 ? "s" : ""} detected</span>
                            <button className="ti-file-btn" onClick={() => fileRef.current?.click()}>File .txt</button>
                            <button className="ti-submit-btn" disabled={checking || detectedCount === 0} onClick={() => processTokens(pasteValue, "importer")}>
                                {checking ? "Checking..." : "→ Importer"}
                            </button>
                            <button className="ti-submit-btn" disabled={checking || detectedCount === 0} onClick={() => processTokens(pasteValue, "loginManager")}>
                                {checking ? "Checking..." : "→ Login Manager"}
                            </button>
                            <button className="ti-submit-btn" disabled={checking || detectedCount === 0} onClick={() => processTokens(pasteValue)}>
                                {checking ? "Checking..." : "→ Both"}
                            </button>
                        </div>
                        <input ref={fileRef} type="file" accept=".txt,text/plain" style={{ display: "none" }} onChange={handleFile} />
                        {results.length > 0 && (
                            <div className="ti-results">
                                {done && (
                                    <div className="ti-results-summary">
                                        <span className="ti-st ti-st--ok"><CheckIcon /> {results.filter(r => r.status === "valid").length} valid{results.filter(r => r.status === "valid").length !== 1 ? "s" : ""}</span>
                                        <span className="ti-st ti-st--bad"><CrossIcon /> {results.filter(r => r.status === "invalid").length} invalid{results.filter(r => r.status === "invalid").length !== 1 ? "s" : ""}</span>
                                    </div>
                                )}
                                <div className="ti-list">
                                    {results.map((r, i) => (
                                        <div key={i} className={`ti-row ti-row--${r.status === "valid" ? "valid" : r.status === "checking" ? "idle" : "invalid"}`}>
                                            {r.status === "valid" && r.avatar ? <img src={r.avatar} className="ti-avatar" alt="" />
                                                : <div className="ti-avatar ti-avatar--ph">{r.status === "checking" ? "..." : "?"}</div>}
                                            <div className="ti-row-info">
                                                {r.status === "valid" ? <span className="ti-username">{r.username}</span>
                                                    : <span className="ti-token-hidden" onClick={() => navigator.clipboard.writeText(r.token)} title="Copy token" style={{ cursor: "pointer" }}>{r.status === "checking" ? "Checking..." : "••••••••••••••••••••••••"}</span>}
                                            </div>
                                            <span className={`ti-badge ti-badge--${r.status === "rate_limited" || r.status === "error" ? "warn" : r.status === "valid" ? "valid" : "invalid"}`}>
                                                {r.status === "valid" ? <CheckIcon /> : r.status === "checking" ? "..." : r.status === "rate_limited" ? "Slow" : r.status === "error" ? "!" : <CrossIcon />}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
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
    useLocalStorageBypass: "When switching accounts, writes the token through a hidden iframe to bypass Discord's localStorage scrubbing. Defeats one of Discord's anti-token-theft mitigations.",
};

function DangerousAckModal({ rootProps, settingKey, onConfirm }: { rootProps: any; settingKey: DangerousSetting; onConfirm: () => void; }) {
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
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
                    <button className="ti-verify-btn" onClick={() => rootProps.onClose()}>Cancel</button>
                    <button className="ti-switch-btn" onClick={() => { onConfirm(); rootProps.onClose(); }}>I understand, enable it</button>
                </div>
            </ModalContent>
        </ModalRoot>
    );
}

// Wraps a toggle so that turning it ON the first time pops a confirmation. Turning OFF is unconditional.
function useDangerousToggle(key: DangerousSetting): [boolean, (v: boolean) => void] {
    const current = settings.use([key])[key] as boolean;
    const [acked, setAcked] = useState<Set<DangerousSetting>>(new Set());
    useEffect(() => {
        let cancelled = false;
        getAckedDangerous().then(v => { if (!cancelled) setAcked(v); });
        return () => { cancelled = true; };
    }, []);

    const set = useCallback((next: boolean) => {
        if (!next) {
            (settings.store as any)[key] = false;
            return;
        }
        if (acked.has(key)) {
            (settings.store as any)[key] = true;
            return;
        }
        openModal(props => (
            <DangerousAckModal
                rootProps={props}
                settingKey={key}
                onConfirm={async () => {
                    await markAckedDangerous(key);
                    setAcked(prev => new Set(prev).add(key));
                    (settings.store as any)[key] = true;
                }}
            />
        ));
    }, [acked, key]);

    return [current, set];
}

function TokenImporterAbout() {
    const [autoScan, setAutoScan] = useDangerousToggle("autoScanOnStartup");
    const [localScan, setLocalScan] = useDangerousToggle("enableLocalScan");
    const [patchStore, setPatchStore] = useDangerousToggle("patchTokenStore");
    const [injectMulti, setInjectMulti] = useDangerousToggle("injectIntoMultiAccountStore");
    const [lsBypass, setLsBypass] = useDangerousToggle("useLocalStorageBypass");
    const encrypt = settings.use(["encryptStoredTokens"]).encryptStoredTokens as boolean;

    const row = (label: string, desc: string, checked: boolean, onChange: (v: boolean) => void, dangerous = true) => (
        <div style={{ padding: "10px 0", borderBottom: "1px solid var(--background-modifier-accent)" }}>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer" }}>
                <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} style={{ marginTop: 4 }} />
                <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, color: dangerous && checked ? "var(--text-danger, #ed4245)" : "var(--header-primary)" }}>
                        {label}{dangerous && " (advanced)"}
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>{desc}</div>
                </div>
            </label>
        </div>
    );

    return (
        <Forms.FormSection>
            <Forms.FormTitle tag="h3">TokenImporter — capability toggles</Forms.FormTitle>
            <Forms.FormText style={{ marginBottom: 12 }}>
                All advanced behaviors below are <strong>off by default</strong>. With everything off, the plugin only lets you manually paste or upload tokens, verify them, store them locally (optionally encrypted), and switch between them via a standard token-store + reload — no disk scraping, no Discord-internal patching, no anti-protection bypasses.
            </Forms.FormText>
            {row("Encrypt stored tokens at rest", "Uses Electron safeStorage (OS keychain / DPAPI). Strongly recommended.", encrypt, v => { (settings.store as any).encryptStoredTokens = v; }, false)}
            {row("Enable local Discord scan", DANGEROUS_SETTING_BLURBS.enableLocalScan, localScan, setLocalScan)}
            {row("Auto-scan on startup", DANGEROUS_SETTING_BLURBS.autoScanOnStartup, autoScan, setAutoScan)}
            {row("Patch Discord's token store", DANGEROUS_SETTING_BLURBS.patchTokenStore, patchStore, setPatchStore)}
            {row("Inject into multi-account store", DANGEROUS_SETTING_BLURBS.injectIntoMultiAccountStore, injectMulti, setInjectMulti)}
            {row("localStorage bypass during switch", DANGEROUS_SETTING_BLURBS.useLocalStorageBypass, lsBypass, setLsBypass)}
        </Forms.FormSection>
    );
}

function TokenImporterButton() {
    return <HeaderBarButton icon={FolderIcon} tooltip="Token Importer" onClick={() => openModal(props => <TokenModal rootProps={props} />)} />;
}

export default definePlugin({
    name: "TokenImporter",
    description: "Import and verify Discord tokens.",
    tags: ["Utility", "Nightcord"],
    authors: [{ name: "Nightcord", id: 0n }, TestcordDevs.x2b, TestcordDevs.sirphantom89],
    dependencies: ["HeaderBarAPI"],
    settings,
    settingsAboutComponent: TokenImporterAbout,
    _injectTimer: null as ReturnType<typeof setTimeout> | null,
    _started: false,
    handleQuickSwitch(event: KeyboardEvent) {
        if (event.altKey && event.key === "g") {
            event.preventDefault();
            openModal(props => <TokenModal rootProps={props} />);
        }
    },
    async start() {
        this._started = true;
        addHeaderBarButton("nightcord-token-importer", () => <TokenImporterButton />, 10);
        if (settings.store.enableQuickSwitch) {
            document.addEventListener("keydown", this.handleQuickSwitch);
        }
        try {
            const existing = await getAccounts();
            if (!this._started) return;
            // Auto-scan requires BOTH the local-scan capability and the auto-on-startup toggle.
            if (
                settings.store.enableLocalScan
                && settings.store.autoScanOnStartup
                && window.DiscordNative?.process?.platform === "win32"
            ) {
                const autoFound = await Native.findLocalTokens();
                if (!this._started) return;
                let added = false;
                const current = [...existing];
                for (const tok of autoFound) {
                    if (!current.find(a => a.token === tok)) {
                        const verified = await Native.checkToken(tok);
                        if (!this._started) return;
                        if (verified.valid && verified.user) {
                            const u = verified.user;
                            if (!current.find(a => a.id === u.id)) {
                                current.push({ id: u.id, token: tok, username: u.global_name || u.username, discriminator: u.discriminator ?? "0", avatar: getAvatarUrl(u.id, u.avatar) });
                                added = true;
                            }
                        }
                    }
                }
                if (added) {
                    await saveAccounts(current);
                    if (!this._started) return;
                    await patchTokenStore();
                }
            }
            if (settings.store.injectIntoMultiAccountStore) {
                this._injectTimer = setTimeout(() => { this._injectTimer = null; this._injectAccounts(); }, 5000);
            }
        } catch (e) {
            console.error("[TokenImporter] Startup failed:", e);
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
            const FluxDispatcher = findByProps("dispatch", "subscribe", "register");
            if (!FluxDispatcher?.dispatch) return;
            const existing = new Set((findByProps("getAccounts")?.getAccounts?.() ?? []).map((u: any) => u.id));
            const toInject = saved.filter(a => !existing.has(a.id));
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
                } catch { }
                await sleep(300);
            }
        } catch (e) { console.error("[TokenImporter] inject:", e); }
    },
    stop() {
        this._started = false;
        if (this._injectTimer) { clearTimeout(this._injectTimer); this._injectTimer = null; }
        document.removeEventListener("keydown", this.handleQuickSwitch);
        removeHeaderBarButton("nightcord-token-importer");
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
                console.warn("[TokenImporter] unpatchTokenStore failed", e);
            }
            tokenModulePatched = false;
            originalEncryptAndStoreTokens = null;
        }
        accountsCache = null;
        loadPromise = null;
    },
});
