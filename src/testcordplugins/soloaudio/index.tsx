/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addContextMenuPatch, NavContextMenuPatchCallback, removeContextMenuPatch } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { UserAreaButton, UserAreaRenderProps } from "@api/UserArea";
import { debounce } from "@shared/debounce";
import { ModalContent, ModalFooter, ModalHeader, ModalRoot, ModalSize, openModal,RenderModalProps } from "@utils/modal";
import definePlugin, { makeRange, OptionType } from "@utils/types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { Button,ContextMenuApi, FluxDispatcher, Menu, React, RelationshipStore, Slider, UserStore, VoiceActions, VoiceStateStore } from "@webpack/common";

const MediaEngineStore = findStoreLazy("MediaEngineStore");
const { setLocalVolume } = findByPropsLazy("setLocalVolume");

interface SoloGroup {
    id: string;
    name: string;
    userIds: string[];
    volume?: number; // Master volume for this group (default 100)
}

let soloedUserId: string | null = null;
let soloedGroupId: string | null = null;
let groups: SoloGroup[] = [];
const modifiedUsers = new Set<string>(); // Tracks users we've altered so we can safely restore them even if they leave

const settings = definePluginSettings({
    unmuteOnDeselect: {
        type: OptionType.BOOLEAN,
        description: "Re-clicking the same Solo target unmutes / restores everyone",
        default: true,
    },
    friendsOnly: {
        type: OptionType.BOOLEAN,
        description: "When soloing, also keep friends audible (not just the target)",
        default: false,
    },
    backgroundVolume: {
        type: OptionType.SLIDER,
        description: "Volume % for non-soloed users (0 = full mute, 100 = normal)",
        markers: makeRange(0, 100, 10),
        default: 0,
        stickToMarkers: false,
    },
    groupsJson: {
        type: OptionType.STRING,
        description: "Serialised solo groups (managed via context menu / button menu)",
        default: "[]",
        hidden: true,
    },
});

function loadGroups() {
    try {
        const parsed = JSON.parse(settings.store.groupsJson);
        if (Array.isArray(parsed) && parsed.length > 0) {
            groups = parsed;
            return;
        }
    } catch { }

    // Initialize with 3 default groups if empty or invalid
    groups = [
        { id: `default-${Date.now()}-1`, name: "Group 1", userIds: [], volume: 100 },
        { id: `default-${Date.now()}-2`, name: "Group 2", userIds: [], volume: 100 },
        { id: `default-${Date.now()}-3`, name: "Group 3", userIds: [], volume: 100 }
    ];
    saveGroups();
}

function saveGroups() {
    settings.store.groupsJson = JSON.stringify(groups);
}

function getCurrentUserId() {
    return UserStore.getCurrentUser()?.id ?? null;
}

function getVoiceChannelPeers(): string[] {
    const me = getCurrentUserId();
    if (!me) return [];
    const myState = VoiceStateStore.getVoiceStateForUser(me);
    if (!myState?.channelId) return [];
    const states = VoiceStateStore.getVoiceStatesForChannel(myState.channelId) as Record<string, any>;
    return Object.keys(states).filter(id => id !== me);
}

function isInSameVoiceChannel(userId: string): boolean {
    const me = getCurrentUserId();
    if (!me) return false;
    const a = VoiceStateStore.getVoiceStateForUser(me);
    const b = VoiceStateStore.getVoiceStateForUser(userId);
    return !!(a?.channelId && b?.channelId && a.channelId === b.channelId);
}

function isFriend(userId: string): boolean {
    return RelationshipStore.getFriendIDs().includes(userId);
}

function shouldKeepAudible(userId: string, keepIds: Set<string>): boolean {
    if (keepIds.has(userId)) return true;
    if (settings.store.friendsOnly && isFriend(userId)) return true;
    return false;
}

function applyVolumeOrMute(userId: string, isKept: boolean, targetKeptVolume: number = 100) {
    modifiedUsers.add(userId);
    const bgVol = settings.store.backgroundVolume;

    if (isKept) {
        if (MediaEngineStore.isLocalMute(userId)) VoiceActions.toggleLocalMute(userId);
        setLocalVolume(userId, targetKeptVolume);
    } else {
        if (bgVol === 0) {
            if (!MediaEngineStore.isLocalMute(userId)) VoiceActions.toggleLocalMute(userId);
        } else {
            if (MediaEngineStore.isLocalMute(userId)) VoiceActions.toggleLocalMute(userId);
            setLocalVolume(userId, bgVol);
        }
    }
}

function restoreAll() {
    // Restore everyone we touched, even if they disconnected
    for (const userId of modifiedUsers) {
        if (MediaEngineStore.isLocalMute(userId)) VoiceActions.toggleLocalMute(userId);
        setLocalVolume(userId, 100);
    }
    modifiedUsers.clear();
}

function reapplyCurrentSolo() {
    if (soloedUserId) {
        const keep = new Set<string>([soloedUserId]);
        for (const uid of getVoiceChannelPeers()) {
            applyVolumeOrMute(uid, shouldKeepAudible(uid, keep), 100);
        }
    } else if (soloedGroupId) {
        loadGroups();
        const group = groups.find(g => g.id === soloedGroupId);
        if (!group) return;
        const keep = new Set<string>(group.userIds);
        const vol = group.volume ?? 100;

        for (const uid of getVoiceChannelPeers()) {
            const keptVol = keep.has(uid) ? vol : 100; // If kept due to 'friendsOnly' but not in group, use 100%
            applyVolumeOrMute(uid, shouldKeepAudible(uid, keep), keptVol);
        }
    }
}

// Automatically mutes late joiners if a solo is active
const debouncedReapply = debounce(() => {
    if (soloedUserId || soloedGroupId) {
        reapplyCurrentSolo();
    }
}, 500);

function handleVoiceStateUpdates() {
    debouncedReapply();
}

function applySoloUser(targetUserId: string) {
    loadGroups();
    if (soloedUserId === targetUserId && soloedGroupId === null && settings.store.unmuteOnDeselect) {
        soloedUserId = null;
        restoreAll();
        return;
    }
    soloedUserId = targetUserId;
    soloedGroupId = null;
    reapplyCurrentSolo();
}

function applySoloGroup(groupId: string) {
    loadGroups();
    const group = groups.find(g => g.id === groupId);
    if (!group) return;
    if (soloedGroupId === groupId && settings.store.unmuteOnDeselect) {
        soloedGroupId = null;
        soloedUserId = null;
        restoreAll();
        return;
    }
    soloedGroupId = groupId;
    soloedUserId = null;
    reapplyCurrentSolo();
}

function clearSolo() {
    soloedUserId = null;
    soloedGroupId = null;
    restoreAll();
}

function createGroup(name: string, initialUserId?: string): SoloGroup {
    loadGroups();
    const group: SoloGroup = { id: `${Date.now()}`, name, userIds: initialUserId ? [initialUserId] : [], volume: 100 };
    groups.push(group);
    saveGroups();
    return group;
}

function deleteGroup(groupId: string) {
    loadGroups();
    groups = groups.filter(g => g.id !== groupId);
    saveGroups();
    if (soloedGroupId === groupId) { soloedGroupId = null; restoreAll(); }
}

function addUserToGroup(groupId: string, userId: string) {
    loadGroups();
    const group = groups.find(g => g.id === groupId);
    if (!group || group.userIds.includes(userId)) return;
    group.userIds.push(userId);
    saveGroups();
    if (soloedGroupId === groupId) reapplyCurrentSolo();
}

function removeUserFromGroup(groupId: string, userId: string) {
    loadGroups();
    const group = groups.find(g => g.id === groupId);
    if (!group) return;
    group.userIds = group.userIds.filter(id => id !== userId);
    saveGroups();
    if (soloedGroupId === groupId) reapplyCurrentSolo();
}

const C = {
    text: "#dbdee1",
    textMuted: "#949ba4",
    header: "#f2f3f5",
    cardBg: "#2b2d31",
    brand: "#5865f2",
    green: "#23a559",
    border: "rgba(255,255,255,0.06)"
};

function SectionLabel({ children, style }: { children: string, style?: React.CSSProperties }) {
    return <h3 style={{ color: C.textMuted, fontSize: "12px", fontWeight: 700, textTransform: "uppercase", margin: "0 0 8px 0", letterSpacing: "0.02em", ...style }}>{children}</h3>;
}

function Card({ children }: { children: React.ReactNode; }) {
    return <div style={{ backgroundColor: C.cardBg, borderRadius: "8px", border: `1px solid ${C.border}`, padding: "16px", display: "flex", flexDirection: "column", gap: "16px", marginBottom: "24px" }}>{children}</div>;
}

function SliderRow({ label, value, min, max, step, unit = "px", onChange }: {
    label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number) => void;
}) {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: "15px", fontWeight: 500, color: C.text }}>{label}</span>
                <span style={{ fontSize: "14px", fontWeight: 600, color: C.text }}>{value}{unit}</span>
            </div>
            <Slider
                initialValue={value}
                minValue={min}
                maxValue={max}
                keyboardStep={step}
                onValueChange={onChange}
            />
            <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: "12px", color: C.textMuted, fontWeight: 600 }}>{min}{unit}</span>
                <span style={{ fontSize: "12px", color: C.textMuted, fontWeight: 600 }}>{max}{unit}</span>
            </div>
        </div>
    );
}

function Toggle({ label, desc, value, onChange }: { label: React.ReactNode; desc?: string; value: boolean; onChange: (v: boolean) => void; }) {
    return (
        <div onClick={() => onChange(!value)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", gap: "16px" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "15px", color: C.text, fontWeight: 500 }}>{label}</div>
                {desc && <div style={{ fontSize: "13px", color: C.textMuted, marginTop: "4px", lineHeight: "1.3" }}>{desc}</div>}
            </div>
            <div style={{
                width: "40px", height: "24px", borderRadius: "12px", flexShrink: 0,
                backgroundColor: value ? C.green : "#80848e",
                position: "relative", transition: "background 0.2s ease-in-out"
            }}>
                <div style={{
                    position: "absolute", top: "3px", left: value ? "19px" : "3px", width: "18px", height: "18px",
                    borderRadius: "50%", backgroundColor: "white", transition: "left 0.2s ease-in-out",
                    boxShadow: "0 2px 4px rgba(0,0,0,0.2)"
                }} />
            </div>
        </div>
    );
}

function SoloAudioModal({ modalProps }: { modalProps: RenderModalProps; }) {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);
    const [tab, setTab] = React.useState<"solo" | "groups" | "settings">("solo");

    // Real-time updates when users join/leave voice calls
    React.useEffect(() => {
        const triggerUpdate = () => forceUpdate();
        FluxDispatcher.subscribe("VOICE_STATE_UPDATES", triggerUpdate);
        FluxDispatcher.subscribe("VOICE_CHANNEL_SELECT", triggerUpdate);
        return () => {
            FluxDispatcher.unsubscribe("VOICE_STATE_UPDATES", triggerUpdate);
            FluxDispatcher.unsubscribe("VOICE_CHANNEL_SELECT", triggerUpdate);
        };
    }, []);

    loadGroups();
    const s = settings.store;
    const peers = getVoiceChannelPeers();

    const tabs: { id: typeof tab; label: string; }[] = [
        { id: "solo", label: "Solo Status" },
        { id: "groups", label: "Manage Groups" },
        { id: "settings", label: "Audio Settings" },
    ];

    function set<K extends keyof typeof settings.store>(key: K, val: (typeof settings.store)[K]) {
        settings.store[key] = val;
        reapplyCurrentSolo();
        forceUpdate();
    }

    const currentSoloText = soloedUserId
        ? (UserStore.getUser(soloedUserId)?.globalName ?? UserStore.getUser(soloedUserId)?.username ?? "Unknown User")
        : soloedGroupId
            ? (groups.find(g => g.id === soloedGroupId)?.name ?? "Unknown Group")
            : "None";

    return (
        <ModalRoot {...modalProps} size={ModalSize.SMALL}>
            <ModalHeader separator={false} style={{ flexDirection: "column", padding: "24px 24px 0 24px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%" }}>
                    <SoloAudioIcon style={{ color: C.header }} />
                    <span style={{ fontSize: "20px", fontWeight: 800, color: C.header, lineHeight: 1 }}>Solo Audio Control</span>
                </div>

                <div style={{ display: "flex", gap: "24px", marginTop: "24px", borderBottom: `1px solid ${C.border}`, width: "100%" }}>
                    {tabs.map(t => (
                        <div key={t.id} onClick={() => setTab(t.id)} style={{
                            paddingBottom: "12px", cursor: "pointer", fontSize: "14px", fontWeight: tab === t.id ? 600 : 500,
                            color: tab === t.id ? C.header : C.textMuted,
                            borderBottom: tab === t.id ? `2px solid ${C.brand}` : "2px solid transparent",
                            transition: "all 0.15s ease"
                        }}>
                            {t.label}
                        </div>
                    ))}
                </div>
            </ModalHeader>

            <ModalContent style={{ padding: "24px 24px 0 24px" }}>
                <div style={{ display: "flex", flexDirection: "column" }}>

                    {tab === "solo" && <>
                        <SectionLabel>Active Status</SectionLabel>
                        <Card>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <div style={{ color: C.text, fontSize: "15px" }}>
                                    Targeting: <strong style={{ color: (soloedUserId || soloedGroupId) ? C.green : C.text }}>{currentSoloText}</strong>
                                </div>
                                {(soloedUserId || soloedGroupId) && (
                                    <Button size={Button.Sizes.SMALL} color={Button.Colors.RED} onClick={() => { clearSolo(); forceUpdate(); }}>⏹ Clear</Button>
                                )}
                            </div>
                        </Card>

                        <SectionLabel>Channel Members</SectionLabel>
                        <Card>
                            {peers.length === 0 && <span style={{ color: C.textMuted, fontSize: "14px" }}>Nobody else is in the call.</span>}
                            {peers.map(uid => {
                                const u = UserStore.getUser(uid);
                                const pfp = u?.getAvatarURL?.(null, 24) ?? "https://cdn.discordapp.com/embed/avatars/0.png";
                                const isSolo = soloedUserId === uid;
                                return (
                                    <div key={uid} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                            <img src={pfp} width={24} height={24} style={{ borderRadius: "50%" }} />
                                            <span style={{ color: C.text, fontSize: 15, fontWeight: 500 }}>{u?.globalName ?? u?.username ?? uid}</span>
                                        </div>
                                        <Button size={Button.Sizes.SMALL} color={isSolo ? Button.Colors.GREEN : Button.Colors.BRAND} onClick={() => { applySoloUser(uid); forceUpdate(); }}>
                                            {isSolo ? "✓ Active" : "Solo"}
                                        </Button>
                                    </div>
                                );
                            })}
                        </Card>

                        <SectionLabel>Saved Groups</SectionLabel>
                        <Card>
                            {groups.length === 0 && <span style={{ color: C.textMuted, fontSize: "14px" }}>No groups exist.</span>}
                            {groups.map(g => {
                                const isSolo = soloedGroupId === g.id;
                                return (
                                    <div key={g.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                        <div style={{ display: "flex", flexDirection: "column" }}>
                                            <span style={{ color: C.text, fontSize: 15, fontWeight: 500 }}>{g.name}</span>
                                            <span style={{ color: C.textMuted, fontSize: 12 }}>{g.userIds.length} members ({g.volume ?? 100}%)</span>
                                        </div>
                                        <Button size={Button.Sizes.SMALL} color={isSolo ? Button.Colors.GREEN : Button.Colors.BRAND} onClick={() => { applySoloGroup(g.id); forceUpdate(); }}>
                                            {isSolo ? "✓ Active" : "Solo"}
                                        </Button>
                                    </div>
                                );
                            })}
                        </Card>
                    </>}

                    {tab === "groups" && <>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                            <SectionLabel style={{ margin: 0 }}>Your Squads</SectionLabel>
                            <Button size={Button.Sizes.MIN} color={Button.Colors.BRAND} onClick={() => {
                                const name = prompt("Enter new group name:");
                                if (name?.trim()) { createGroup(name.trim()); forceUpdate(); }
                            }}>+ New Group</Button>
                        </div>

                        {groups.map(group => (
                            <Card key={group.id}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${C.border}`, paddingBottom: "12px", marginBottom: "12px" }}>
                                    <span style={{ color: C.text, fontSize: "16px", fontWeight: "bold" }}>{group.name}</span>
                                    <Button size={Button.Sizes.MIN} color={Button.Colors.RED} onClick={() => { deleteGroup(group.id); forceUpdate(); }}>Delete</Button>
                                </div>

                                <SliderRow
                                    label="Group Volume"
                                    value={group.volume ?? 100}
                                    min={0} max={200} step={5} unit="%"
                                    onChange={v => {
                                        group.volume = v;
                                        saveGroups();
                                        if (soloedGroupId === group.id) reapplyCurrentSolo();
                                        forceUpdate();
                                    }}
                                />

                                <span style={{ color: C.textMuted, fontSize: "12px", fontWeight: 600, textTransform: "uppercase", marginTop: "8px", display: "block", marginBottom: "8px" }}>Quick Add / Remove (Current Call)</span>
                                {peers.length === 0 ? <span style={{ color: C.textMuted, fontSize: "13px" }}>Join a call with others to add them.</span> : null}
                                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                                    {peers.map(uid => {
                                        const user = UserStore.getUser(uid);
                                        const name = user?.globalName ?? user?.username ?? uid;
                                        const pfp = user?.getAvatarURL?.(null, 24) ?? "https://cdn.discordapp.com/embed/avatars/0.png";
                                        const inGroup = group.userIds.includes(uid);
                                        return (
                                            <Toggle
                                                key={uid}
                                                label={
                                                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                                        <img src={pfp} width={24} height={24} style={{ borderRadius: "50%" }} />
                                                        <span style={{ fontSize: 15, fontWeight: 500 }}>{name}</span>
                                                    </div>
                                                }
                                                value={inGroup}
                                                onChange={v => {
                                                    if (v) addUserToGroup(group.id, uid);
                                                    else removeUserFromGroup(group.id, uid);
                                                    forceUpdate();
                                                }}
                                            />
                                        );
                                    })}
                                </div>
                            </Card>
                        ))}
                    </>}

                    {tab === "settings" && <>
                        <SectionLabel>Volume Setup</SectionLabel>
                        <Card>
                            <SliderRow
                                label="Background Users Volume"
                                value={s.backgroundVolume}
                                min={0} max={100} step={5} unit="%"
                                onChange={v => set("backgroundVolume", v)}
                            />
                            <div style={{ color: C.textMuted, fontSize: "12px", marginTop: "-4px" }}>
                                The volume of users who are NOT being soloed. 0% means fully muted.
                            </div>
                        </Card>

                        <SectionLabel>Preferences</SectionLabel>
                        <Card>
                            <Toggle
                                label="Keep Friends Audible"
                                desc="Your friends' volume will not be lowered when you solo someone else."
                                value={s.friendsOnly}
                                onChange={v => set("friendsOnly", v)}
                            />
                            <Toggle
                                label="Toggle Off on Re-click"
                                desc="Clicking an active solo target again will disable soloing and restore all audio."
                                value={s.unmuteOnDeselect}
                                onChange={v => set("unmuteOnDeselect", v)}
                            />
                        </Card>
                    </>}

                </div>
            </ModalContent>

            <ModalFooter style={{ padding: "16px 24px", backgroundColor: "transparent", borderTop: "none" }}>
                <Button color={Button.Colors.BRAND} onClick={() => modalProps.onClose()} style={{ width: "100%" }}>Done</Button>
            </ModalFooter>
        </ModalRoot>
    );
}

function QuickSoloAudioMenu({ onClose }: { onClose(): void; }) {
    const [, rerender] = React.useReducer(v => v + 1, 0);

    // Live updates for context menu too
    React.useEffect(() => {
        const triggerUpdate = () => rerender();
        FluxDispatcher.subscribe("VOICE_STATE_UPDATES", triggerUpdate);
        FluxDispatcher.subscribe("VOICE_CHANNEL_SELECT", triggerUpdate);
        return () => {
            FluxDispatcher.unsubscribe("VOICE_STATE_UPDATES", triggerUpdate);
            FluxDispatcher.unsubscribe("VOICE_CHANNEL_SELECT", triggerUpdate);
        };
    }, []);

    loadGroups();
    const peers = getVoiceChannelPeers();

    return (
            <Menu.Menu navId="solo-audio" onClose={onClose} aria-label="Solo Audio Quick Menu">
            <Menu.MenuItem id="solo-audio-open-modal" label="Open Full Menu" action={() => openModal(props => <SoloAudioModal modalProps={props} />)} />

            <Menu.MenuSeparator />

            {(soloedUserId || soloedGroupId) && (
                <>
                    <Menu.MenuItem id="solo-audio-clear" label="⏹ Clear Active Solo" action={() => { clearSolo(); rerender(); }} />
                    <Menu.MenuSeparator />
                </>
            )}

            {groups.length > 0 && (
                <Menu.MenuItem id="solo-audio-groups" label="Solo Group">
                    {groups.map(g => (
                        <Menu.MenuItem key={g.id} id={`solo-audio-group-${g.id}`} label={soloedGroupId === g.id ? `✓ ${g.name}` : g.name} action={() => { applySoloGroup(g.id); rerender(); }} />
                    ))}
                </Menu.MenuItem>
            )}

            {peers.length > 0 && (
                <Menu.MenuItem id="solo-audio-users" label="Solo User">
                    {peers.map(userId => {
                        const user = UserStore.getUser(userId);
                        const name = user?.globalName ?? user?.username ?? userId;
                        return <Menu.MenuItem key={userId} id={`solo-audio-user-${userId}`} label={soloedUserId === userId ? `✓ ${name}` : name} action={() => { applySoloUser(userId); rerender(); }} />;
                    })}
                </Menu.MenuItem>
            )}
        </Menu.Menu>
    );
}

function SoloAudioIcon({ className, style, active }: { className?: string; style?: React.CSSProperties; active?: boolean }) {
    const lineLength = 30;
    const lineStyle: React.CSSProperties = {
        strokeDasharray: lineLength,
        strokeDashoffset: active ? lineLength : 0,
        transition: "stroke-dashoffset 0.1s ease-in-out",
    };

    return (
        <svg className={className} style={style} width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <mask id="soloaudioLine">
                <rect width="100%" height="100%" fill="#ffffff" />
                <line
                    className="blackLine"
                    x1="22"
                    y1="2"
                    x2="2"
                    y2="22"
                    stroke="#000000"
                    strokeWidth="6"
                    strokeLinecap="round"
                    style={lineStyle}
                />
            </mask>

            <g mask="url(#soloaudioLine)">
                <path fill={!active ? "var(--status-danger)" : "currentColor"} d="M15.16 16.51c-.57.28-1.16-.2-1.16-.83v-.14c0-.43.28-.8.63-1.02a3 3 0 0 0 0-5.04c-.35-.23-.63-.6-.63-1.02v-.14c0-.63.59-1.1 1.16-.83a5 5 0 0 1 0 9.02Z" />
                <path fill={!active ? "var(--status-danger)" : "currentColor"} d="M12 3a1 1 0 0 0-1-1h-.06a1 1 0 0 0-.74.32L5.92 7H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2.92l4.28 4.68a1 1 0 0 0 .74.32H11a1 1 0 0 0 1-1V3ZM15.1 20.75c-.58.14-1.1-.33-1.1-.92v-.03c0-.5.37-.92.85-1.05a7 7 0 0 0 0-13.5A1.11 1.11 0 0 1 14 4.2v-.03c0-.6.52-1.06 1.1-.92a9 9 0 0 1 0 17.5Z" />
            </g>

            <line
                x1="22"
                y1="2"
                x2="2"
                y2="22"
                stroke="var(--status-danger, currentColor)"
                strokeWidth="2"
                strokeLinecap="round"
                style={lineStyle}
            />
        </svg>
    );
}

function SoloAudioButtonFinal(props: UserAreaRenderProps) {
    const isActive = soloedUserId !== null || soloedGroupId !== null;
    return (
        <UserAreaButton
            onClick={() => openModal(modalProps => <SoloAudioModal modalProps={modalProps} />)}
            onContextMenu={event => ContextMenuApi.openContextMenu(event, () => <QuickSoloAudioMenu onClose={ContextMenuApi.closeContextMenu} />)}
            role="switch"
            aria-checked={isActive}
            redGlow={!isActive}
            tooltipText={props.hideTooltips ? void 0 : isActive ? "Solo Active (Right-click for options)" : "Solo Audio"}
            icon={<SoloAudioIcon className={props.iconForeground} active={isActive} />}
            plated={props.nameplate != null}
        />
    );
}

const userContextMenuPatch: NavContextMenuPatchCallback = (children, { user }) => {
    if (!user) return;
    const me = getCurrentUserId();
    if (user.id === me) return;
    if (!isInSameVoiceChannel(user.id)) return;

    loadGroups();

    const isSoloed = soloedUserId === user.id && soloedGroupId === null;
    const notInGroups = groups.filter(g => !g.userIds.includes(user.id));
    const inGroups = groups.filter(g => g.userIds.includes(user.id));

    children.push(
        <Menu.MenuSeparator />,

        <Menu.MenuItem
            id="vc-solo-audio"
            label={isSoloed ? "✓ Solo Audio" : "Solo Audio"}
            action={() => applySoloUser(user.id)}
        />,

        <Menu.MenuItem id="vc-solo-groups" label="Audio Groups">
            {notInGroups.length > 0 && (
                <Menu.MenuItem id="vc-solo-group-add" label="Add to Group">
                    {notInGroups.map(g => (
                        <Menu.MenuItem key={g.id} id={`vc-solo-group-add-${g.id}`} label={g.name} action={() => addUserToGroup(g.id, user.id)} />
                    ))}
                </Menu.MenuItem>
            )}
            {inGroups.length > 0 && (
                <Menu.MenuItem id="vc-solo-group-remove" label="Remove from Group">
                    {inGroups.map(g => (
                        <Menu.MenuItem key={g.id} id={`vc-solo-group-remove-${g.id}`} label={g.name} action={() => removeUserFromGroup(g.id, user.id)} />
                    ))}
                </Menu.MenuItem>
            )}
            <Menu.MenuItem
                id="vc-solo-group-create"
                label="＋ New Group with this User"
                action={() => {
                    const name = prompt("Group name:");
                    if (name?.trim()) createGroup(name.trim(), user.id);
                }}
            />
        </Menu.MenuItem>
    );
};

export default definePlugin({
    name: "SoloAudio",
    description: "A button near mute/deafen to solo users/groups. Left-click opens a full control panel, Right-click opens a quick dropdown.",
    dependencies: ["UserAreaAPI", "UserSettingsAPI", "ContextMenuAPI"],
    tags: ["Voice"],
    authors: [{ name: "you", id: 0n }],
    settings,

    userAreaButton: {
        icon: SoloAudioIcon,
        render: SoloAudioButtonFinal,
    },

    start() {
        loadGroups();
        addContextMenuPatch("user-context", userContextMenuPatch);
        FluxDispatcher.subscribe("VOICE_STATE_UPDATES", handleVoiceStateUpdates);
    },

    stop() {
        removeContextMenuPatch("user-context", userContextMenuPatch);
        FluxDispatcher.unsubscribe("VOICE_STATE_UPDATES", handleVoiceStateUpdates);
        soloedUserId = null;
        soloedGroupId = null;
        restoreAll();
    },
});
