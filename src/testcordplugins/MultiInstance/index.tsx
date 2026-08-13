/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// TODO: token signing in doesnt work
import "./style.css";

import { HeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { classes } from "@utils/misc";
import { useTimer } from "@utils/react";
import definePlugin, { OptionType, type PluginNative } from "@utils/types";
import type { RenderModalProps } from "@vencord/discord-types";
import { Avatar, ContextMenuApi, Menu, Modal, openModal, React, showToast, TextInput, Toasts, UserStore, useStateFromStores } from "@webpack/common";
import type { MouseEvent as ReactMouseEvent, SVGProps } from "react";

import type { InstanceMode, InstanceStatus, InstanceUser } from "./native";

const Native = VencordNative?.pluginHelpers?.MultiInstance as PluginNative<typeof import("./native")> | undefined;

const ICON_SETTING_KEYS: Array<"showIcon"> = ["showIcon"];
const SESSION_SETTING_KEYS: Array<"blockExternalTokenAccess" | "performanceMode"> = ["blockExternalTokenAccess", "performanceMode"];
const DOMAINS = ["discord.com", "ptb.discord.com", "canary.discord.com"] as const;
const DOMAIN_LABELS: Record<DiscordDomain, string> = {
    "discord.com": "Discord",
    "ptb.discord.com": "PTB",
    "canary.discord.com": "Canary"
};
const DEFAULT_DOMAIN: DiscordDomain = "discord.com";
const DEFAULT_PROFILES: InstanceProfile[] = [{ id: "secondary", name: "Secondary Discord", domain: DEFAULT_DOMAIN }];
const ALL_INSTANCES_BUSY_ID = "__all__";

type DiscordDomain = typeof DOMAINS[number];

interface InstanceProfile {
    id: string;
    name: string;
    saveSession?: boolean;
    domain?: DiscordDomain;
    mode?: InstanceMode;
    user?: InstanceUser;
    token?: string;
}

interface PrivateSettings {
    instances?: InstanceProfile[];
}

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

function isDomain(value: unknown): value is DiscordDomain {
    return typeof value === "string" && DOMAINS.includes(value as DiscordDomain);
}

function getDomain(profile: InstanceProfile) {
    return profile.domain ?? DEFAULT_DOMAIN;
}

function isInstanceUser(value: unknown): value is InstanceUser {
    return typeof value === "object" &&
        value !== null &&
        "id" in value &&
        "username" in value &&
        "avatarUrl" in value &&
        typeof value.id === "string" &&
        typeof value.username === "string" &&
        typeof value.avatarUrl === "string" &&
        (!("globalName" in value) || typeof value.globalName === "string" || value.globalName == null);
}

function isProfile(value: unknown): value is InstanceProfile {
    return typeof value === "object" &&
        value !== null &&
        "id" in value &&
        "name" in value &&
        typeof value.id === "string" &&
        typeof value.name === "string" &&
        (!("saveSession" in value) || typeof value.saveSession === "boolean") &&
        (!("domain" in value) || isDomain(value.domain)) &&
        (!("mode" in value) || value.mode === "detached" || value.mode === "grouped") &&
        (!("user" in value) || isInstanceUser(value.user)) &&
        (!("token" in value) || typeof value.token === "string" || value.token == null) &&
        /^[a-z0-9_-]{1,32}$/i.test(value.id) &&
        value.name.trim().length > 0;
}

function getProfiles(value: unknown) {
    if (!Array.isArray(value)) return DEFAULT_PROFILES;

    const seen = new Set<string>();
    const profiles = value
        .filter(isProfile)
        .map(profile => ({
            id: profile.id.toLowerCase(),
            name: profile.name.trim(),
            saveSession: profile.saveSession,
            domain: getDomain(profile),
            mode: profile.mode ?? "detached",
            user: profile.user,
            token: profile.token?.trim() || undefined
        }))
        .filter(profile => {
            if (seen.has(profile.id)) return false;
            seen.add(profile.id);
            return true;
        });

    return profiles.length ? profiles : DEFAULT_PROFILES;
}

function shouldSaveSession(profile: InstanceProfile) {
    if (settings.store.blockExternalTokenAccess) return false;

    return profile.saveSession ?? settings.store.saveSessionsByDefault;
}

function makeProfileId(name: string, profiles: InstanceProfile[]) {
    const base = name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 18) || "instance";

    const used = new Set(profiles.map(profile => profile.id));
    const randomTag = Math.random().toString(36).slice(2, 6);
    let id = `${base}-${randomTag}`;
    let suffix = 2;

    while (used.has(id)) {
        id = `${base}-${randomTag}-${suffix}`;
        suffix++;
    }

    return id;
}

export function MultiInstanceIcon({ width = 20, height = 20, className }: SVGProps<SVGSVGElement> & { size?: string; }) {
    return (
        <svg className={className} width={width} height={height} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M4 5a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v1h-2V5a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h1v2H7a3 3 0 0 1-3-3V5Z" />
            <path d="M10 11a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-4a3 3 0 0 1-3-3v-6Zm3-1a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1h-4Z" />
            <path d="M7 18h2v2H7a5 5 0 0 1-5-5v-2h2v2a3 3 0 0 0 3 3ZM20 6h2v2h-2V6Zm0-2V2h-2v2h2Zm-4 0V2h-2v2h2Z" />
        </svg>
    );
}

function InstanceAvatar({ status }: { status?: InstanceStatus; }) {
    if (status?.user) {
        return <Avatar src={status.user.avatarUrl} size="SIZE_48" aria-label={`${status.user.username} avatar`} />;
    }

    return (
        <div className="vc-multi-instance-avatar-placeholder">
            <MultiInstanceIcon width={24} height={24} />
        </div>
    );
}

async function reportCurrentInstanceUser() {
    if (!Native) return;

    const user = UserStore.getCurrentUser();
    await Native.reportInstanceUser(user ? {
        id: user.id,
        username: user.username,
        globalName: user.globalName,
        avatarUrl: user.getAvatarURL(null, 128, false)
    } : null);
}

function saveProfiles(profiles: InstanceProfile[]) {
    settings.store.instances = profiles;
}

function MultiInstanceSettingsButton() {
    return (
        <Button size="small" variant="secondary" onClick={openMultiInstanceModal}>
            Open Multi Instance
        </Button>
    );
}

const settings = definePluginSettings({
    showIcon: {
        type: OptionType.BOOLEAN,
        description: "Show the Multi Instance icon in the header bar.",
        default: true
    },
    saveSessionsByDefault: {
        type: OptionType.BOOLEAN,
        description: "Save sessions for new instances by default.",
        default: true
    },
    blockExternalTokenAccess: {
        type: OptionType.BOOLEAN,
        description: "Use protected temporary sessions and clear saved login data before opening an instance.",
        default: false
    },
    performanceMode: {
        type: OptionType.BOOLEAN,
        description: "Throttle background instances to reduce CPU usage.",
        default: false
    },
    openManager: {
        type: OptionType.COMPONENT,
        component: MultiInstanceSettingsButton,
        default: null
    }
}).withPrivateSettings<PrivateSettings>();

function TokenModal({
    profile,
    onSave,
    rootProps
}: {
    profile: InstanceProfile;
    onSave: (token: string | undefined) => void;
    rootProps: RenderModalProps;
}) {
    const [tokenVal, setTokenVal] = React.useState(profile.token ?? "");

    return (
        <Modal {...rootProps} title={`Account Token — ${profile.name}`} size="small">
            <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ color: "var(--text-normal)", fontSize: "13px", lineHeight: "18px" }}>
                    Enter a Discord account token to log into <strong>{profile.name}</strong> automatically when launching.
                </div>
                <TextInput
                    value={tokenVal}
                    placeholder="Discord User Token (e.g. OT...)"
                    onChange={setTokenVal}
                />
                <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "8px" }}>
                    {profile.token && (
                        <Button
                            size="small"
                            variant="secondary"
                            color="danger"
                            onClick={() => {
                                onSave(undefined);
                                rootProps.onClose();
                                showToast(`Token removed from ${profile.name}.`, Toasts.Type.SUCCESS);
                            }}
                        >
                            Remove Token
                        </Button>
                    )}
                    <Button
                        size="small"
                        variant="secondary"
                        onClick={rootProps.onClose}
                    >
                        Cancel
                    </Button>
                    <Button
                        size="small"
                        variant="positive"
                        onClick={() => {
                            const trimmed = tokenVal.trim();
                            onSave(trimmed || undefined);
                            rootProps.onClose();
                            showToast(`Token saved for ${profile.name}.`, Toasts.Type.SUCCESS);
                        }}
                    >
                        Save Token
                    </Button>
                </div>
            </div>
        </Modal>
    );
}

function MultiInstanceModal({ rootProps }: { rootProps: RenderModalProps; }) {
    const currentUser = useStateFromStores([UserStore], () => UserStore.getCurrentUser());
    const { blockExternalTokenAccess, performanceMode } = settings.use(SESSION_SETTING_KEYS);
    const [profiles, setProfiles] = React.useState(() => getProfiles(settings.plain.instances));
    const profilesRef = React.useRef(profiles);
    const [instances, setInstances] = React.useState<InstanceStatus[]>([]);
    const [busyId, setBusyId] = React.useState<string | null>(null);
    const [newName, setNewName] = React.useState("");
    const [editingId, setEditingId] = React.useState<string | null>(null);
    const [editingName, setEditingName] = React.useState("");
    const refreshTick = useTimer({ interval: 1000 });

    const refreshInstances = React.useCallback(async () => {
        if (!Native) {
            setInstances([]);
            return;
        }

        const openInstances = await Native.getOpenInstances().catch((): InstanceStatus[] => []);
        setInstances(openInstances);

        let changed = false;
        const nextProfiles = profilesRef.current.map(profile => {
            const user = openInstances.find(instance => instance.id === profile.id)?.user;
            if (
                !user ||
                profile.user?.id === user.id &&
                profile.user.username === user.username &&
                profile.user.globalName === user.globalName &&
                profile.user.avatarUrl === user.avatarUrl
            ) return profile;

            changed = true;
            return { ...profile, user };
        });

        if (changed) {
            profilesRef.current = nextProfiles;
            setProfiles(nextProfiles);
            saveProfiles(nextProfiles);
        }
    }, []);

    React.useEffect(() => {
        void refreshInstances();
    }, [refreshInstances, refreshTick]);

    function changeProfiles(change: (profiles: InstanceProfile[]) => InstanceProfile[]) {
        const nextProfiles = change(profilesRef.current);
        profilesRef.current = nextProfiles;
        setProfiles(nextProfiles);
        saveProfiles(nextProfiles);
    }

    function updateProfile(profileId: string, patch: Partial<Pick<InstanceProfile, "name" | "saveSession" | "domain" | "mode" | "user" | "token">>) {
        changeProfiles(profiles => profiles.map(profile => profile.id === profileId ? { ...profile, ...patch } : profile));
    }

    async function openInstance(profile: InstanceProfile, mode: InstanceMode = profile.mode ?? "detached") {
        if (!Native) {
            showToast("Multi Instance native helper is not available in this build.", Toasts.Type.FAILURE);
            return;
        }

        setBusyId(profile.id);
        updateProfile(profile.id, { mode });

        const saveSession = shouldSaveSession(profile);
        const result = await Native.openInstance(profile.id, profile.name, saveSession, getDomain(profile), blockExternalTokenAccess, performanceMode, mode, profile.token)
            .catch(error => ({ ok: false, error: getErrorMessage(error) }));

        if (result.ok) {
            showToast(`${profile.name} opened as a ${mode} instance.`, Toasts.Type.SUCCESS);
        } else {
            showToast(result.error ?? `Could not open ${profile.name}.`, Toasts.Type.FAILURE);
        }

        await refreshInstances();
        setBusyId(null);
    }

    async function closeInstance(profile: InstanceProfile) {
        if (!Native) {
            showToast("Multi Instance native helper is not available in this build.", Toasts.Type.FAILURE);
            return;
        }

        setBusyId(profile.id);

        const result = await Native.closeInstance(profile.id)
            .catch(error => ({ ok: false, error: getErrorMessage(error) }));

        if (result.ok) {
            showToast(`${profile.name} closed.`, Toasts.Type.SUCCESS);
        } else {
            showToast(result.error ?? `Could not close ${profile.name}.`, Toasts.Type.FAILURE);
        }

        await refreshInstances();
        setBusyId(null);
    }

    async function closeAllInstances() {
        if (!Native) {
            showToast("Multi Instance native helper is not available in this build.", Toasts.Type.FAILURE);
            return;
        }

        setBusyId(ALL_INSTANCES_BUSY_ID);

        const result = await Native.closeAllInstances()
            .catch(error => ({ ok: false, error: getErrorMessage(error) }));

        if (result.ok) {
            showToast("All Multi Instance windows closed.", Toasts.Type.SUCCESS);
        } else {
            showToast(result.error ?? "Could not close all Multi Instance windows.", Toasts.Type.FAILURE);
        }

        await refreshInstances();
        setBusyId(null);
    }

    async function clearSavedSession(profile: InstanceProfile) {
        if (!Native) {
            showToast("Multi Instance native helper is not available in this build.", Toasts.Type.FAILURE);
            return;
        }

        if (instances.some(instance => instance.id === profile.id)) {
            showToast("Close this instance before clearing its saved session.", Toasts.Type.FAILURE);
            return;
        }

        setBusyId(profile.id);

        const result = await Native.clearSavedSession(profile.id)
            .catch(error => ({ ok: false, error: getErrorMessage(error) }));

        if (result.ok) {
            updateProfile(profile.id, { user: undefined });
            showToast(`${profile.name} saved session cleared.`, Toasts.Type.SUCCESS);
        } else {
            showToast(result.error ?? `Could not clear ${profile.name}.`, Toasts.Type.FAILURE);
        }

        setBusyId(null);
    }

    function addInstance() {
        const requestedName = newName.trim();

        changeProfiles(profiles => {
            const name = requestedName || `Discord Instance ${profiles.length + 1}`;
            const id = makeProfileId(name, profiles);

            return [...profiles, { id, name, saveSession: settings.store.saveSessionsByDefault, domain: DEFAULT_DOMAIN, mode: "detached" }];
        });
        setNewName("");
        showToast("Added new instance profile.", Toasts.Type.SUCCESS);
    }

    function toggleSessionSaving(profile: InstanceProfile) {
        updateProfile(profile.id, { saveSession: !shouldSaveSession(profile) });
    }

    function cycleDomain(profile: InstanceProfile) {
        const currentIndex = DOMAINS.indexOf(getDomain(profile));
        const domain = DOMAINS[(currentIndex + 1) % DOMAINS.length];
        updateProfile(profile.id, { domain });
    }

    function startRename(profile: InstanceProfile) {
        setEditingId(profile.id);
        setEditingName(profile.name);
    }

    function saveRename(profile: InstanceProfile) {
        const name = editingName.trim();

        if (!name) {
            showToast("Enter an instance name.", Toasts.Type.FAILURE);
            return;
        }

        updateProfile(profile.id, { name });
        setEditingId(null);
        setEditingName("");
        showToast("Renamed instance profile.", Toasts.Type.SUCCESS);
    }

    async function removeInstance(profile: InstanceProfile) {
        if (instances.some(instance => instance.id === profile.id)) await closeInstance(profile);

        changeProfiles(profiles => {
            const filtered = profiles.filter(({ id }) => id !== profile.id);
            return filtered.length ? filtered : DEFAULT_PROFILES;
        });
        showToast(`Removed profile ${profile.name}.`, Toasts.Type.SUCCESS);
    }

    function openInstanceMenu(event: ReactMouseEvent, profile: InstanceProfile, status?: InstanceStatus) {
        event.preventDefault();
        const isBusy = busyId === profile.id || busyId === ALL_INSTANCES_BUSY_ID;

        ContextMenuApi.openContextMenu(event, () => (
            <Menu.Menu
                navId="multi-instance-profile-menu"
                onClose={ContextMenuApi.closeContextMenu}
                aria-label={`${profile.name} options`}
            >
                <Menu.MenuItem
                    id="multi-instance-open-grouped"
                    label="Open grouped with Discord"
                    disabled={!!status || isBusy}
                    action={() => void openInstance(profile, "grouped")}
                />
                <Menu.MenuItem
                    id="multi-instance-open-detached"
                    label="Open separate Testcord window"
                    disabled={!!status || isBusy}
                    action={() => void openInstance(profile, "detached")}
                />
                {status && (
                    <>
                        <Menu.MenuItem
                            id="multi-instance-focus"
                            label="Focus instance"
                            disabled={isBusy}
                            action={() => void openInstance(profile, status.mode)}
                        />
                        <Menu.MenuItem
                            id="multi-instance-close"
                            label="Close instance"
                            disabled={isBusy}
                            action={() => void closeInstance(profile)}
                        />
                    </>
                )}
                <Menu.MenuSeparator />
                <Menu.MenuItem
                    id="multi-instance-rename"
                    label="Rename profile"
                    disabled={isBusy}
                    action={() => startRename(profile)}
                />
                <Menu.MenuItem
                    id="multi-instance-token"
                    label={profile.token ? "Edit saved token" : "Set account token"}
                    disabled={isBusy}
                    action={() => openModal(props => <TokenModal profile={profile} onSave={t => updateProfile(profile.id, { token: t })} rootProps={props} />)}
                />
                <Menu.MenuItem
                    id="multi-instance-session"
                    label={shouldSaveSession(profile) ? "Use a temporary session" : "Save this session"}
                    disabled={isBusy || !!status || blockExternalTokenAccess}
                    action={() => toggleSessionSaving(profile)}
                />
                <Menu.MenuItem
                    id="multi-instance-domain"
                    label={`Switch to ${DOMAIN_LABELS[DOMAINS[(DOMAINS.indexOf(getDomain(profile)) + 1) % DOMAINS.length]]}`}
                    disabled={isBusy || !!status}
                    action={() => cycleDomain(profile)}
                />
                <Menu.MenuItem
                    id="multi-instance-clear"
                    label="Clear saved session"
                    disabled={isBusy || !!status}
                    action={() => void clearSavedSession(profile)}
                />
                <Menu.MenuItem
                    id="multi-instance-remove"
                    label="Remove profile"
                    color="danger"
                    disabled={isBusy}
                    action={() => void removeInstance(profile)}
                />
            </Menu.Menu>
        ));
    }

    return (
        <Modal
            {...rootProps}
            size="xl"
            title="Multi Instance Studio"
            subtitle="Left click Open to launch or focus. Right click a profile for grouped, separate and advanced options."
        >
            <div className="vc-multi-instance-body">
                {!Native && (
                    <div className="vc-multi-instance-warning">
                        Multi Instance can be configured here, but opening windows requires the native helper.
                    </div>
                )}

                <div className="vc-multi-instance-hero">
                    <div className="vc-multi-instance-current">
                        {currentUser
                            ? <Avatar src={currentUser.getAvatarURL(null, 128, false)} size="SIZE_48" aria-label={`${currentUser.username} avatar`} />
                            : <InstanceAvatar />}
                        <div>
                            <span className="vc-multi-instance-kicker">Active account</span>
                            <strong>{currentUser?.globalName ?? currentUser?.username ?? "Connecting..."}</strong>
                            <span className="vc-multi-instance-current-handle">{currentUser ? `@${currentUser.username}` : "Waiting for Discord account"}</span>
                        </div>
                        <span className="vc-multi-instance-active-badge">Active</span>
                    </div>
                    <div className="vc-multi-instance-stats">
                        <div><strong>{profiles.length}</strong><span>Profiles</span></div>
                        <div><strong>{instances.length}</strong><span>Running</span></div>
                    </div>
                </div>

                <div className="vc-multi-instance-modes">
                    <div className="vc-multi-instance-mode-card">
                        <div className="vc-multi-instance-mode-icon"><MultiInstanceIcon /></div>
                        <div className="vc-multi-instance-mode-copy">
                            <strong>Grouped instance</strong>
                            <span>Uses the Discord client taskbar group while keeping a separate login session.</span>
                        </div>
                    </div>
                    <div className="vc-multi-instance-mode-card">
                        <div className="vc-multi-instance-mode-icon"><MultiInstanceIcon /></div>
                        <div className="vc-multi-instance-mode-copy">
                            <strong>Separate Testcord instance</strong>
                            <span>Gets its own taskbar identity and the Testcord app icon.</span>
                        </div>
                    </div>
                </div>

                {blockExternalTokenAccess && (
                    <div className="vc-multi-instance-warning">
                        Token protection is enabled. Every alt will use a protected temporary session.
                    </div>
                )}

                <div className="vc-multi-instance-toolbar">
                    <div className="vc-multi-instance-toolbar-copy">
                        <strong>Other accounts</strong>
                        <span>Left click Open for quick switch. Right click any profile for the options menu.</span>
                    </div>
                    <div className="vc-multi-instance-toolbar-actions">
                        <Button size="small" variant="secondary" onClick={() => void refreshInstances()}>
                            Refresh
                        </Button>
                        <Button
                            size="small"
                            variant="secondary"
                            disabled={!instances.length || busyId === ALL_INSTANCES_BUSY_ID}
                            onClick={() => void closeAllInstances()}
                        >
                            Close all
                        </Button>
                    </div>
                </div>

                <div className="vc-multi-instance-list">
                    {profiles.map(profile => {
                        const status = instances.find(instance => instance.id === profile.id);
                        const isOpen = !!status;
                        const isBusy = busyId === profile.id || busyId === ALL_INSTANCES_BUSY_ID;
                        const saveSession = shouldSaveSession(profile);
                        const domain = getDomain(profile);
                        const isEditing = editingId === profile.id;
                        const sessionLabel = blockExternalTokenAccess ? "Protected temporary session" : saveSession ? "Saved session" : "Temporary session";
                        const mode = status?.mode ?? profile.mode ?? "detached";
                        const user = status?.user ?? profile.user;

                        return (
                            <div
                                className={classes("vc-multi-instance-row", isOpen && "vc-multi-instance-row-open")}
                                key={profile.id}
                                onContextMenu={event => openInstanceMenu(event, profile, status)}
                            >
                                <div className="vc-multi-instance-row-info">
                                    <div className="vc-multi-instance-avatar">
                                        <InstanceAvatar status={status} />
                                        <span className={classes("vc-multi-instance-dot", isOpen && "vc-multi-instance-dot-open")} />
                                    </div>
                                    <div className="vc-multi-instance-profile">
                                        {isEditing ? (
                                            <div className="vc-multi-instance-rename">
                                                <div className="vc-multi-instance-rename-input">
                                                    <TextInput
                                                        value={editingName}
                                                        placeholder="Instance name"
                                                        onChange={setEditingName}
                                                    />
                                                </div>
                                                <Button size="small" variant="positive" disabled={isBusy} onClick={() => saveRename(profile)}>
                                                    Save
                                                </Button>
                                                <Button size="small" variant="secondary" disabled={isBusy} onClick={() => setEditingId(null)}>
                                                    Cancel
                                                </Button>
                                            </div>
                                        ) : (
                                            <>
                                                <span className="vc-multi-instance-kicker">{profile.name}</span>
                                                <div className="vc-multi-instance-name">{user?.globalName ?? user?.username ?? "Ready for login"}</div>
                                            </>
                                        )}
                                        <div className="vc-multi-instance-id">
                                            {user ? `@${user.username}` : `Profile ${profile.id}`}
                                        </div>
                                        <div className="vc-multi-instance-tags">
                                            <span>{DOMAIN_LABELS[domain]}</span>
                                            <span>{sessionLabel}</span>
                                            <span>{mode === "grouped" ? "Grouped" : "Separate"}</span>
                                            {profile.token && <span>🔑 Token Set</span>}
                                        </div>
                                    </div>
                                </div>
                                <div className="vc-multi-instance-actions" style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                                    <Button size="small" variant="positive" disabled={isBusy || isEditing} onClick={() => void openInstance(profile, mode)}>
                                        {isOpen ? "Focus" : "Open"}
                                    </Button>
                                    <Button size="small" variant="secondary" disabled={isBusy || isEditing} onClick={() => startRename(profile)}>
                                        Rename
                                    </Button>
                                    <Button size="small" variant="secondary" color="danger" disabled={isBusy} onClick={() => void removeInstance(profile)}>
                                        Remove
                                    </Button>
                                    <Button size="small" variant="secondary" disabled={isBusy} onClick={event => openInstanceMenu(event, profile, status)}>
                                        Options
                                    </Button>
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="vc-multi-instance-add">
                    <div>
                        <strong>Create an alt profile</strong>
                        <span>Its login data remains isolated from every other profile.</span>
                    </div>
                    <div className="vc-multi-instance-add-controls">
                        <div className="vc-multi-instance-add-input">
                            <TextInput
                                value={newName}
                                placeholder="Profile name"
                                onChange={setNewName}
                            />
                        </div>
                        <Button size="small" variant="positive" onClick={addInstance}>
                            Add profile
                        </Button>
                    </div>
                </div>
            </div>
        </Modal>
    );
}

export function openMultiInstanceModal() {
    openModal(props => <MultiInstanceModal rootProps={props} />);
}

function MultiInstanceButton() {
    const { showIcon } = settings.use(ICON_SETTING_KEYS);
    if (!showIcon) return null;

    return (
        <HeaderBarButton
            icon={MultiInstanceIcon}
            tooltip="Multi Instance"
            onClick={openMultiInstanceModal}
        />
    );
}

const MultiInstanceButtonWithBoundary = ErrorBoundary.wrap(MultiInstanceButton, { noop: true });

export default definePlugin({
    name: "MultiInstance",
    description: "Opens extra Testcord windows with separate Discord sessions.",
    authors: [{ name: "irritably", id: 928787166916640838n }],
    tags: ["Utility"],
    dependencies: ["HeaderBarAPI"],
    enabledByDefault: true,
    settings,
    headerBarButton: {
        icon: MultiInstanceIcon,
        render: () => <MultiInstanceButtonWithBoundary />,
        priority: 9
    },
    start() {
        void reportCurrentInstanceUser().catch(() => undefined);
    },
    flux: {
        async CONNECTION_OPEN() {
            await reportCurrentInstanceUser();
        },
        async CURRENT_USER_UPDATE() {
            await reportCurrentInstanceUser();
        }
    },
    toolboxActions: {
        "Open Multi Instance"() { openMultiInstanceModal(); }
    }
});
