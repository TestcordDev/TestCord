/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

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
        <svg
            className={className}
            aria-hidden="true"
            role="img"
            xmlns="http://www.w3.org/2000/svg"
            width={width}
            height={height}
            fill="none"
            viewBox="0 0 24 24"
        >
            <rect
                x="2"
                y="6"
                width="14"
                height="14"
                rx="2.5"
                stroke="currentColor"
                strokeWidth="2"
            />
            <path
                d="M2 11h14"
                stroke="currentColor"
                strokeWidth="2"
            />
            <path
                d="M7 3h11a2.5 2.5 0 0 1 2.5 2.5v11.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
            />
        </svg>
    );
}

function KeyIcon({ width = 12, height = 12, className }: SVGProps<SVGSVGElement>) {
    return (
        <svg
            className={className}
            aria-hidden="true"
            role="img"
            xmlns="http://www.w3.org/2000/svg"
            width={width}
            height={height}
            fill="none"
            viewBox="0 0 24 24"
        >
            <path
                fill="currentColor"
                fillRule="evenodd"
                d="M21.41 5.41A2 2 0 1 0 18.6 2.6l-7.75 7.74a.53.53 0 0 1-.58.11 6 6 0 1 0 3.3 3.28.51.51 0 0 1 .1-.55c.19-.19.5-.19.68 0l1.25 1.24a2 2 0 1 0 2.82-2.82l-1.23-1.24a.5.5 0 0 1 0-.7l.47-.47c.2-.2.5-.2.7 0l1.24 1.23A2 2 0 1 0 22.4 7.6l-1.23-1.24a.5.5 0 0 1 0-.7l.23-.24ZM10 16a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z"
                clipRule="evenodd"
            />
        </svg>
    );
}

function MoreDotsIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="5" cy="12" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="19" cy="12" r="2" />
        </svg>
    );
}

function RefreshIcon() {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.5 2v6h-6M2.5 22v-6h6" />
            <path d="M2.5 11.5a10 10 0 0 1 17.4-4.5l1.6 1M21.5 12.5a10 10 0 0 1-17.4 4.5l-1.6-1" />
        </svg>
    );
}

function OpenWindowIcon({ width = 14, height = 14, className }: SVGProps<SVGSVGElement>) {
    return (
        <svg
            className={className}
            aria-hidden="true"
            role="img"
            xmlns="http://www.w3.org/2000/svg"
            width={width}
            height={height}
            fill="none"
            viewBox="0 0 24 24"
        >
            <path
                fill="currentColor"
                d="M15 2a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0V4.41l-4.3 4.3a1 1 0 1 1-1.4-1.42L19.58 3H16a1 1 0 0 1-1-1Z"
            />
            <path
                fill="currentColor"
                d="M5 2a3 3 0 0 0-3 3v14a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3v-6a1 1 0 1 0-2 0v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h6a1 1 0 1 0 0-2H5Z"
            />
        </svg>
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

function RenameModal({
    profile,
    onSave,
    rootProps
}: {
    profile: InstanceProfile;
    onSave: (name: string) => void;
    rootProps: RenderModalProps;
}) {
    const [nameVal, setNameVal] = React.useState(profile.name);

    return (
        <Modal {...rootProps} title={`Rename - ${profile.name}`} size="sm" className="vc-multi-instance-dialog">
            <div className="vc-multi-instance-dialog-content">
                <TextInput
                    value={nameVal}
                    placeholder="Instance name"
                    onChange={setNameVal}
                    autoFocus
                />
                <div className="vc-multi-instance-dialog-actions">
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
                            const trimmed = nameVal.trim();
                            if (!trimmed) {
                                showToast("Enter an instance name.", Toasts.Type.FAILURE);
                                return;
                            }
                            onSave(trimmed);
                            rootProps.onClose();
                            showToast("Renamed instance profile.", Toasts.Type.SUCCESS);
                        }}
                    >
                        Save
                    </Button>
                </div>
            </div>
        </Modal>
    );
}

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
        <Modal {...rootProps} title={`Account Token - ${profile.name}`} size="sm" className="vc-multi-instance-dialog">
            <div className="vc-multi-instance-dialog-content">
                <div className="vc-multi-instance-dialog-hint">
                    Enter a Discord account token to log into <strong>{profile.name}</strong> automatically when launching.
                </div>
                <TextInput
                    value={tokenVal}
                    placeholder="Discord user token"
                    onChange={setTokenVal}
                    autoFocus
                />
                <div className="vc-multi-instance-dialog-actions">
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
                            Remove
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
                        Save
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
        event.stopPropagation();
        const isBusy = busyId === profile.id || busyId === ALL_INSTANCES_BUSY_ID;

        ContextMenuApi.openContextMenu(event, () => (
            <Menu.Menu
                navId="multi-instance-profile-menu"
                onClose={ContextMenuApi.closeContextMenu}
                aria-label={`${profile.name} options`}
            >
                <Menu.MenuItem
                    id="multi-instance-open-separate"
                    label="Open separate window"
                    disabled={!!status || isBusy}
                    action={() => void openInstance(profile, "detached")}
                />
                <Menu.MenuItem
                    id="multi-instance-open-grouped"
                    label="Open grouped with Discord"
                    disabled={!!status || isBusy}
                    action={() => void openInstance(profile, "grouped")}
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
                    action={() => openModal(props => (
                        <RenameModal
                            profile={profile}
                            onSave={name => updateProfile(profile.id, { name })}
                            rootProps={props}
                        />
                    ))}
                />
                <Menu.MenuItem
                    id="multi-instance-token"
                    label={profile.token ? "Edit account token" : "Set account token"}
                    disabled={isBusy}
                    action={() => openModal(props => (
                        <TokenModal
                            profile={profile}
                            onSave={t => updateProfile(profile.id, { token: t })}
                            rootProps={props}
                        />
                    ))}
                />
                <Menu.MenuItem
                    id="multi-instance-session"
                    label={shouldSaveSession(profile) ? "Use temporary session" : "Save this session"}
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
            size="sm"
            className="vc-multi-instance-modal"
            title={
                <div className="vc-multi-instance-header-title">
                    <MultiInstanceIcon width={20} height={20} />
                    <span>Multi-instance</span>
                </div>
            }
        >
            <div className="vc-multi-instance-modal-content">
                <p className="vc-multi-instance-subtitle">
                    <strong>Left click</strong> to open · <strong>Right click</strong> for options menu
                </p>

                {!Native && (
                    <div className="vc-multi-instance-warning">
                        Multi Instance can be configured here, but opening windows requires the native helper.
                    </div>
                )}

                {blockExternalTokenAccess && (
                    <div className="vc-multi-instance-warning">
                        Token protection is enabled. Every instance will use a protected temporary session.
                    </div>
                )}

                {currentUser && (
                    <div className="vc-multi-instance-section">
                        <div className="vc-multi-instance-section-label">Active Account</div>
                        <div className="vc-multi-instance-row vc-multi-instance-row-current">
                            <div className="vc-multi-instance-avatar-wrap">
                                <Avatar
                                    src={currentUser.getAvatarURL(null, 128, false)}
                                    size="SIZE_32"
                                    aria-label={`${currentUser.username} avatar`}
                                />
                            </div>
                            <div className="vc-multi-instance-info">
                                <span className="vc-multi-instance-name">
                                    {currentUser.globalName || currentUser.username}
                                </span>
                                <span className="vc-multi-instance-tag">@{currentUser.username}</span>
                            </div>
                            <span className="vc-multi-instance-badge-current">Active</span>
                        </div>
                    </div>
                )}

                <div className="vc-multi-instance-section">
                    <div className="vc-multi-instance-section-header">
                        <span className="vc-multi-instance-section-label">
                            {profiles.length} {profiles.length === 1 ? "Other Account" : "Other Accounts"}
                        </span>
                        <div className="vc-multi-instance-section-actions">
                            <button
                                type="button"
                                className="vc-multi-instance-icon-btn"
                                title="Refresh instances"
                                onClick={() => void refreshInstances()}
                            >
                                <RefreshIcon />
                            </button>
                            {instances.length > 0 && (
                                <button
                                    type="button"
                                    className="vc-multi-instance-text-btn vc-multi-instance-text-btn-danger"
                                    disabled={busyId === ALL_INSTANCES_BUSY_ID}
                                    onClick={() => void closeAllInstances()}
                                >
                                    Close all ({instances.length})
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="vc-multi-instance-list">
                        {profiles.length === 0 ? (
                            <div className="vc-multi-instance-empty">
                                No instance profiles yet. Add one below to get started.
                            </div>
                        ) : profiles.map(profile => {
                            const status = instances.find(instance => instance.id === profile.id);
                            const isOpen = !!status;
                            const isBusy = busyId === profile.id || busyId === ALL_INSTANCES_BUSY_ID;
                            const domain = getDomain(profile);
                            const saveSession = shouldSaveSession(profile);
                            const mode = status?.mode ?? profile.mode ?? "detached";
                            const user = status?.user ?? profile.user;

                            return (
                                <div
                                    key={profile.id}
                                    className={classes(
                                        "vc-multi-instance-row",
                                        isOpen && "vc-multi-instance-row-open"
                                    )}
                                    onClick={() => void openInstance(profile, mode)}
                                    onContextMenu={event => openInstanceMenu(event, profile, status)}
                                >
                                    <div className="vc-multi-instance-avatar-wrap">
                                        {user ? (
                                            <Avatar
                                                src={user.avatarUrl}
                                                size="SIZE_32"
                                                aria-label={`${user.username} avatar`}
                                            />
                                        ) : (
                                            <div className="vc-multi-instance-avatar-ph">
                                                {profile.name[0]?.toUpperCase() ?? "D"}
                                            </div>
                                        )}
                                        {isOpen && <span className="vc-multi-instance-dot-active" />}
                                    </div>

                                    <div className="vc-multi-instance-info">
                                        <div className="vc-multi-instance-title-row">
                                            <span className="vc-multi-instance-name">
                                                {profile.name}
                                            </span>
                                            {user && user.globalName && user.globalName !== profile.name && (
                                                <span className="vc-multi-instance-user-name">
                                                    ({user.globalName})
                                                </span>
                                            )}
                                        </div>
                                        <div className="vc-multi-instance-tag">
                                            {user ? `@${user.username}` : `ID: ${profile.id}`}
                                        </div>
                                        <div className="vc-multi-instance-meta-tags">
                                            {profile.token && (
                                                <span className="vc-multi-instance-meta-pill" title="Saved token">
                                                    <KeyIcon /> Token
                                                </span>
                                            )}
                                            <span className="vc-multi-instance-meta-pill">
                                                {mode === "grouped" ? "Grouped" : "Separate"}
                                            </span>
                                            {domain !== "discord.com" && (
                                                <span className="vc-multi-instance-meta-pill">
                                                    {DOMAIN_LABELS[domain]}
                                                </span>
                                            )}
                                            {!saveSession && (
                                                <span className="vc-multi-instance-meta-pill">
                                                    Temp
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="vc-multi-instance-row-right">
                                        {isOpen ? (
                                            <span className="vc-multi-instance-badge-open">Open</span>
                                        ) : (
                                            <button
                                                type="button"
                                                className="vc-multi-instance-open-btn"
                                                title="Open window"
                                                disabled={isBusy}
                                                onClick={e => {
                                                    e.stopPropagation();
                                                    void openInstance(profile, mode);
                                                }}
                                            >
                                                <OpenWindowIcon />
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            className="vc-multi-instance-more-btn"
                                            title="Options"
                                            disabled={isBusy}
                                            onClick={e => {
                                                e.stopPropagation();
                                                openInstanceMenu(e, profile, status);
                                            }}
                                        >
                                            <MoreDotsIcon />
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="vc-multi-instance-add-bar">
                    <TextInput
                        value={newName}
                        placeholder="New profile name..."
                        onChange={setNewName}
                        onKeyDown={e => {
                            if (e.key === "Enter") addInstance();
                        }}
                    />
                    <Button
                        size="small"
                        variant="positive"
                        onClick={addInstance}
                    >
                        Add
                    </Button>
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
            tooltip="Multi-instance"
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
