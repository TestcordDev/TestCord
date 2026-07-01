/*
 * Equicord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { ModalContent, ModalFooter, ModalHeader, ModalProps, ModalRoot, ModalSize, ModalCloseButton, openModal } from "@utils/modal";
import { findByPropsLazy, waitFor } from "@webpack";
import { Button, Forms, React, RestAPI, Toasts, TextInput } from "@webpack/common";

const UserStore         = findByPropsLazy("getCurrentUser", "getUser");
const GuildStore        = findByPropsLazy("getGuilds", "getGuildCount");
const GuildFolderStore  = findByPropsLazy("getGuildsTree", "getFlattenedGuildIds");
const ChannelStore      = findByPropsLazy("getSortedPrivateChannels", "getMutablePrivateChannels");
const RelationshipStore = findByPropsLazy("getRelationshipType", "getFriendCount");
const AuthStore         = findByPropsLazy("getId", "getToken");
const TabBar            = findByPropsLazy("Header", "Item", "Separator", "Panel");

let UserClass: any = null;

let _GuildsTreeClass: any = null;
function getGuildsTreeClass() {
    if (!_GuildsTreeClass) {
        try {
            _GuildsTreeClass = GuildFolderStore.getGuildsTree().constructor;
        } catch {
            return null;
        }
    }
    return _GuildsTreeClass;
}

waitFor(
    (m: any) => m?.prototype?.getAvatarURL && m?.prototype?.hasAvatarForGuild,
    (m: any) => { UserClass = m; }
);

const settings = definePluginSettings({
    fakeAccounts: {
        description: "Stored fake accounts (do not edit manually)",
        type: OptionType.STRING,
        default: "[]",
    }
});

interface FakeAccount {
    id: string;
    username: string;
    discriminator: string;
    avatar: string | null;
    globalName: string | null;
}

function parseFakeAccounts(): FakeAccount[] {
    try { return JSON.parse(settings.store.fakeAccounts); }
    catch { return []; }
}

function saveFakeAccounts(accounts: FakeAccount[]) {
    settings.store.fakeAccounts = JSON.stringify(accounts);
}

function parseAvatar(input: string): string | null {
    if (!input) return null;
    const match = input.match(/avatars\/\d+\/([a-f0-9_]+)(?:\.webp|\.png|\.gif)?/i);
    if (match) return match[1];
    if (/^[a-f0-9_]{32,}$/i.test(input)) return input;
    return null;
}

const _originals: Record<string, any> = {};
let _fakeSessionActive = false;
let _fakeSessionUser: FakeAccount | null = null;

function buildUserObject(acc: FakeAccount): any {
    if (!UserClass) {
        console.warn("[FakeAccount] UserClass not available");
        return null;
    }
    return new UserClass({
        id: acc.id,
        username: acc.username,
        discriminator: acc.discriminator ?? "0",
        avatar: acc.avatar ?? null,
        global_name: acc.globalName ?? acc.username,
        verified: true,
        email: "fake@fake.com",
        has_bounced_email: false,
        bot: false,
        system: false,
        mfa_enabled: false,
        mobile: false,
        desktop: true,
        premium_type: null,
        flags: 0,
        public_flags: 0,
        purchased_flags: 0,
        premium_usage_flags: 0,
        phone: null,
        nsfw_allowed: true,
        personal_connection_id: null,
        primary_guild: null,
    });
}

export function activateFakeSession(acc: FakeAccount) {
    if (_fakeSessionActive) deactivateFakeSession();

    const fakeUser = buildUserObject(acc);
    if (!fakeUser) {
        Toasts.show({
            message: "Failed to build user object, try again.",
            id: "fakeaccount-notready",
            type: Toasts.Type.FAILURE,
            options: { position: Toasts.Position.BOTTOM }
        });
        return;
    }

    _fakeSessionActive = true;
    _fakeSessionUser = acc;

    const GuildsTreeClass = getGuildsTreeClass();

    _originals.getCurrentUser = UserStore.getCurrentUser.bind(UserStore);
    UserStore.getCurrentUser = () => fakeUser;

    _originals.getId = AuthStore.getId.bind(AuthStore);
    AuthStore.getId = () => acc.id;

    _originals.getGuildsTree = GuildFolderStore.getGuildsTree.bind(GuildFolderStore);
    if (GuildsTreeClass) {
        GuildFolderStore.getGuildsTree = () => new GuildsTreeClass();
    }

    _originals.getFlattenedGuildIds = GuildFolderStore.getFlattenedGuildIds.bind(GuildFolderStore);
    GuildFolderStore.getFlattenedGuildIds = () => [];

    _originals.getFlattenedGuildFolderList = GuildFolderStore.getFlattenedGuildFolderList.bind(GuildFolderStore);
    GuildFolderStore.getFlattenedGuildFolderList = () => [];

    _originals.getGuildFolders = GuildFolderStore.getGuildFolders.bind(GuildFolderStore);
    GuildFolderStore.getGuildFolders = () => [];

    _originals.getGuildCount = GuildStore.getGuildCount.bind(GuildStore);
    GuildStore.getGuildCount = () => 0;

    _originals.getSortedPrivateChannels = ChannelStore.getSortedPrivateChannels.bind(ChannelStore);
    ChannelStore.getSortedPrivateChannels = () => [];

    _originals.getMutablePrivateChannels = ChannelStore.getMutablePrivateChannels.bind(ChannelStore);
    ChannelStore.getMutablePrivateChannels = () => ({});

    _originals.getFriendCount = RelationshipStore.getFriendCount.bind(RelationshipStore);
    RelationshipStore.getFriendCount = () => 0;

    _originals.getFriendIDs = RelationshipStore.getFriendIDs.bind(RelationshipStore);
    RelationshipStore.getFriendIDs = () => [];

    _originals.getMutableRelationships = RelationshipStore.getMutableRelationships.bind(RelationshipStore);
    RelationshipStore.getMutableRelationships = () => new Map();

    _originals.getRelationshipType = RelationshipStore.getRelationshipType.bind(RelationshipStore);
    RelationshipStore.getRelationshipType = () => 0;

    Toasts.show({
        message: `Switched to ${acc.username}`,
        id: "fakeaccount-switch",
        type: Toasts.Type.SUCCESS,
        options: { position: Toasts.Position.BOTTOM }
    });
}

export function deactivateFakeSession() {
    if (!_fakeSessionActive) return;

    const restoreOn = (store: any, key: string) => {
        if (_originals[key]) store[key] = _originals[key];
    };

    restoreOn(UserStore, "getCurrentUser");
    restoreOn(AuthStore, "getId");
    restoreOn(GuildFolderStore, "getGuildsTree");
    restoreOn(GuildFolderStore, "getFlattenedGuildIds");
    restoreOn(GuildFolderStore, "getFlattenedGuildFolderList");
    restoreOn(GuildFolderStore, "getGuildFolders");
    restoreOn(GuildStore, "getGuildCount");
    restoreOn(ChannelStore, "getSortedPrivateChannels");
    restoreOn(ChannelStore, "getMutablePrivateChannels");
    restoreOn(RelationshipStore, "getFriendCount");
    restoreOn(RelationshipStore, "getFriendIDs");
    restoreOn(RelationshipStore, "getMutableRelationships");
    restoreOn(RelationshipStore, "getRelationshipType");

    Object.keys(_originals).forEach(k => delete _originals[k]);
    _fakeSessionActive = false;
    _fakeSessionUser = null;

    Toasts.show({
        message: "Switched back to real account",
        id: "fakeaccount-restore",
        type: Toasts.Type.SUCCESS,
        options: { position: Toasts.Position.BOTTOM }
    });
}

function FakeAccountModal({ modalProps }: { modalProps: ModalProps; }) {
    const [accounts, setAccounts] = React.useState<FakeAccount[]>(parseFakeAccounts());
    const [userId, setUserId] = React.useState("");
    const [manualUsername, setManualUsername] = React.useState("");
    const [manualAvatar, setManualAvatar] = React.useState("");
    const [loading, setLoading] = React.useState(false);
    const [tab, setTab] = React.useState<"id" | "manual">("id");
    const [activeId, setActiveId] = React.useState<string | null>(_fakeSessionUser?.id ?? null);

    const updateAccounts = (newAccounts: FakeAccount[]) => {
        setAccounts(newAccounts);
        saveFakeAccounts(newAccounts);
    };

    const fetchAndAdd = async () => {
        if (!userId.trim()) return;
        if (accounts.some(a => a.id === userId.trim())) {
            Toasts.show({ message: "Already added!", id: "fa-dupe", type: Toasts.Type.FAILURE, options: { position: Toasts.Position.BOTTOM } });
            return;
        }
        setLoading(true);
        try {
            const res = await RestAPI.get({ url: `/users/${userId.trim()}` });
            const u = res.body;
            updateAccounts([...accounts, {
                id: u.id,
                username: u.username,
                discriminator: u.discriminator ?? "0",
                avatar: u.avatar ?? null,
                globalName: u.global_name ?? u.username,
            }]);
            setUserId("");
            Toasts.show({ message: `Added ${u.username}!`, id: "fa-add", type: Toasts.Type.SUCCESS, options: { position: Toasts.Position.BOTTOM } });
        } catch {
            Toasts.show({ message: "Failed to fetch user. Check the ID.", id: "fa-fail", type: Toasts.Type.FAILURE, options: { position: Toasts.Position.BOTTOM } });
        }
        setLoading(false);
    };

    const addManual = () => {
        if (!manualUsername.trim()) return;
        const id = (BigInt(Date.now()) - 1420070400000n).toString().slice(0, 18);
        updateAccounts([...accounts, {
            id,
            username: manualUsername.trim(),
            discriminator: "0",
            avatar: parseAvatar(manualAvatar),
            globalName: manualUsername.trim(),
        }]);
        setManualUsername("");
        setManualAvatar("");
    };

    return (
        <ModalRoot {...modalProps} size={ModalSize.MEDIUM}>

            {/* ── Header ── */}
<ModalHeader separator>
    <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="currentColor"
        style={{ marginRight: "8px", flexShrink: 0, color: "var(--interactive-normal)" }}
    >
        <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-5.33 0-8 2.67-8 4v1h16v-1c0-1.33-2.67-4-8-4z"/>
    </svg>
    <Forms.FormTitle tag="h4" style={{ margin: 0, flex: 1 }}>
        Fake Accounts
        {_fakeSessionActive && (
            <span style={{ color: "var(--status-danger)", fontSize: "12px", marginLeft: "8px" }}>
                ● Active as {_fakeSessionUser?.username}
            </span>
        )}
    </Forms.FormTitle>
    <ModalCloseButton onClick={modalProps.onClose} />
</ModalHeader>
            {/* ── Body ── */}
            <ModalContent>
                <div style={{ padding: "16px" }}>

                    {/* Tab bar row */}
                    <div style={{ display: "flex", alignItems: "center", marginBottom: "16px" }}>
                        <TabBar
                            type="top"
                            look="brand"
                            selectedItem={tab}
                            onItemSelect={(id: "id" | "manual") => setTab(id)}
                            style={{ flex: 1 }}
                        >
                            <TabBar.Item id="id">Fetch by User ID</TabBar.Item>
                            <TabBar.Item id="manual">Manual</TabBar.Item>
                        </TabBar>

                        {_fakeSessionActive && (
                            <Button
                                size={Button.Sizes.SMALL}
                                color={Button.Colors.RED}
                                style={{ marginLeft: "12px", flexShrink: 0 }}
                                onClick={() => { deactivateFakeSession(); setActiveId(null); }}
                            >
                                ✕ Exit Fake Session
                            </Button>
                        )}
                    </div>

                    {/* Fetch-by-ID input row */}
                    {tab === "id" && (
                        <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "16px" }}>
                            <div style={{ flex: 1 }}>
                                <TextInput
                                    value={userId}
                                    placeholder="User ID (e.g. 1460553978973655155)"
                                    onChange={(v: string) => setUserId(v)}
                                />
                            </div>
                            <Button
                                size={Button.Sizes.MEDIUM}
                                color={Button.Colors.GREEN}
                                disabled={loading || !userId.trim()}
                                onClick={fetchAndAdd}
                            >
                                {loading ? "Fetching…" : "Add"}
                            </Button>
                        </div>
                    )}

                    {/* Manual input row */}
                    {tab === "manual" && (
                        <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "16px" }}>
                            <div style={{ flex: 1 }}>
                                <TextInput
                                    value={manualUsername}
                                    placeholder="Username"
                                    onChange={(v: string) => setManualUsername(v)}
                                />
                            </div>
                            <div style={{ flex: 2 }}>
                                <TextInput
                                    value={manualAvatar}
                                    placeholder="Avatar URL or hash (optional)"
                                    onChange={(v: string) => setManualAvatar(v)}
                                />
                            </div>
                            <Button
                                size={Button.Sizes.MEDIUM}
                                color={Button.Colors.GREEN}
                                disabled={!manualUsername.trim()}
                                onClick={addManual}
                            >
                                Add
                            </Button>
                        </div>
                    )}

                    {/* Account list */}
                    <Forms.FormTitle tag="h5">Fake Accounts ({accounts.length})</Forms.FormTitle>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "300px", overflowY: "auto" }}>
                        {accounts.length === 0 && (
                            <Forms.FormText style={{ padding: "8px 0" }}>
                                No fake accounts added yet.
                            </Forms.FormText>
                        )}
                        {accounts.map(acc => {
                            const isActive = activeId === acc.id;
                            return (
                                <div
                                    key={acc.id}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        padding: "10px 14px",
                                        backgroundColor: isActive
                                            ? "var(--background-modifier-selected)"
                                            : "var(--background-secondary)",
                                        borderRadius: "8px",
                                        border: `1px solid ${isActive
                                            ? "var(--brand-500)"
                                            : "var(--background-modifier-accent)"}`,
                                        gap: "12px",
                                    }}
                                >
                                    <img
                                        src={acc.avatar
                                            ? `https://cdn.discordapp.com/avatars/${acc.id}/${acc.avatar}.webp?size=40`
                                            : `https://cdn.discordapp.com/embed/avatars/${parseInt(acc.id) % 6}.png`
                                        }
                                        style={{ width: 36, height: 36, borderRadius: "50%", flexShrink: 0 }}
                                        onError={(e: any) => { e.target.src = "https://cdn.discordapp.com/embed/avatars/0.png"; }}
                                    />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontWeight: 600, fontSize: "14px", color: "var(--header-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                            {acc.globalName || acc.username}
                                        </div>
                                        <div style={{ fontSize: "12px", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                            @{acc.username} · {acc.id}
                                        </div>
                                    </div>
                                    <Button
                                        size={Button.Sizes.SMALL}
                                        color={isActive ? Button.Colors.RED : Button.Colors.BRAND}
                                        onClick={() => {
                                            if (isActive) {
                                                deactivateFakeSession();
                                                setActiveId(null);
                                            } else {
                                                activateFakeSession(acc);
                                                setActiveId(acc.id);
                                            }
                                        }}
                                    >
                                        {isActive ? "Exit" : "Switch"}
                                    </Button>
                                    <Button
                                        size={Button.Sizes.SMALL}
                                        color={Button.Colors.RED}
                                        onClick={() => {
                                            if (isActive) { deactivateFakeSession(); setActiveId(null); }
                                            updateAccounts(accounts.filter(a => a.id !== acc.id));
                                        }}
                                    >
                                        Remove
                                    </Button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </ModalContent>

            {/* ── Footer ── */}
            <ModalFooter>
                <Button
                    color={Button.Colors.TRANSPARENT}
                    look={Button.Looks.FILLED}
                    onClick={modalProps.onClose}
                >
                    Close
                </Button>
            </ModalFooter>
        </ModalRoot>
    );
}

function handleKeyDown(e: KeyboardEvent) {
    if (e.altKey && e.key.toLowerCase() === "c") {
        openModal(modalProps => <FakeAccountModal modalProps={modalProps} />);
    }
}

export default definePlugin({
    name: "Fake Accounts",
    description: "Fake accounts to larp",
    authors: [{ name: "deracul", id: 1454853467783954444n}],
    settings,

    patches: [
        {
            find: "getIsValidatingUsers",
            replacement: {
                match: /getUsers\(\)\{return (\i)\}/,
                replace: "getUsers(){return $self.injectFakes($1)}"
            }
        },
        {
            find: "multiAccountUsers",
            replacement: {
                match: /(\w+)\.default\.track\((\w+)\.HAw\.MULTI_ACCOUNT_SWITCH_ATTEMPT[^)]+\),(\w+)\.Mx\((\w+)\)/,
                replace: "$1.default.track($2.HAw.MULTI_ACCOUNT_SWITCH_ATTEMPT,{location:{section:$2.JJy.USER_PROFILE}}),$self.handleSwitch($3.Mx.bind($3),$4)"
            }
        }
    ],

    start() {
        document.addEventListener("keydown", handleKeyDown);
    },

    stop() {
        document.removeEventListener("keydown", handleKeyDown);
        if (_fakeSessionActive) deactivateFakeSession();
    },

    injectFakes(realUsers: any[]): any[] {
        const fakes = parseFakeAccounts();
        if (!fakes.length || !UserClass) return realUsers ?? [];
        return [...(realUsers ?? []), ...fakes.map(f => {
            const u = buildUserObject(f);
            if (!u) return null;
            u.tokenStatus = 2;
            u.pushSyncToken = null;
            return u;
        }).filter(Boolean)];
    },

    handleSwitch(originalFn: (id: string) => void, userId: string) {
        const acc = parseFakeAccounts().find(a => a.id === userId);
        if (acc) {
            activateFakeSession(acc);
        } else {
            if (_fakeSessionActive) deactivateFakeSession();
            originalFn(userId);
        }
    }
});
