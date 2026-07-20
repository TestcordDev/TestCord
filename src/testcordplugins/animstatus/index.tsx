/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 shxdes69
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./index.css";

import { HeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { getUserSettingLazy } from "@api/UserSettings";
import ErrorBoundary from "@components/ErrorBoundary";
import { Switch } from "@components/Switch";
import { classNameFactory } from "@utils/css";
import { ModalCloseButton, ModalContent, ModalHeader, ModalRoot, ModalSize, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { Button, Forms, TabBar, Text, TextInput, Toasts, useEffect, useMemo, useRef, UserStore, useState } from "@webpack/common";

const cl = classNameFactory("vc-as-");
const MIN_INTERVAL = 5, MAX_INTERVAL = 300, DEFAULT_INTERVAL = 10, START_DELAY = 3000;
const EMOJI_REGEX = /<a?:([^:]+):(\d+)>/;
const STATUS_OPTIONS = [
    { value: "online", label: "Online", color: "#23a55a" },
    { value: "idle", label: "Idle", color: "#f0b232" },
    { value: "dnd", label: "Do Not Disturb", color: "#f23f43" },
    { value: "invisible", label: "Invisible", color: "#80848e" }
] as const;
type StatusType = typeof STATUS_OPTIONS[number]["value"];
enum Tab { STATUSES = "statuses", PRESETS = "presets", SETTINGS = "settings", INFO = "info" }
interface StatusStep { text: string; emojiName?: string; emojiId?: string; animated?: boolean; preset?: string; status?: StatusType; }
interface Preset { id: string; name: string; emojiName?: string; emojiId?: string; animated?: boolean; }

const I = {
    Clock: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75 1.23-4.25-2.58V7z" /></svg>,
    Play: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>,
    Stop: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h12v12H6z" /></svg>,
    Plus: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" /></svg>,
    Edit: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" /></svg>,
    Trash: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" /></svg>,
    Info: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" /></svg>,
    List: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z" /></svg>,
    Settings: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L3.16 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" /></svg>,
    Check: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" /></svg>,
    Folder: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 20c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-1 14H4v-8h16v8z" /></svg>
};

const parseEmoji = (input: string): Omit<StatusStep, "preset" | "status"> => {
    const match = input.replace(/^\\/, "").match(EMOJI_REGEX);
    return match ? { text: input.replace(EMOJI_REGEX, "").trim(), emojiName: match[1], emojiId: match[2], animated: input.includes("<a:") } : { text: input };
};
const safeParse = <T,>(json: string, fallback: T): T => { try { return JSON.parse(json) || fallback; } catch { return fallback; } };
const getPresets = (items: StatusStep[]) => [...new Set(items.map(x => x.preset).filter(Boolean) as string[])];
const getEmojiUrl = (id: string, animated: boolean) => `https://cdn.discordapp.com/emojis/${id}.${animated ? "gif" : "png"}`;
const getAvatarUrl = (userId: string, avatar: string | null): string => avatar ? `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png?size=64` : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(userId) >> 22n) % 6}.png`;
const formatInterval = (seconds: number): string => seconds < 60 ? `${seconds}s` : seconds % 60 === 0 ? `${Math.floor(seconds / 60)}m` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
const parseInterval = (input: string): number => {
    const lowerInput = input.toLowerCase().trim(), match = lowerInput.match(/(\d+)\s*(m|min|minute|minutes?)/);
    let total = match ? parseInt(match[1]) * 60 : 0;
    const secMatch = lowerInput.match(/(\d+)\s*(s|sec|second|seconds?)/);
    if (secMatch) total += parseInt(secMatch[1]);
    const numMatch = total === 0 ? lowerInput.match(/^(\d+)$/) : null;
    return Math.max(MIN_INTERVAL, Math.min(MAX_INTERVAL, total !== 0 ? total : numMatch ? parseInt(numMatch[1]) : DEFAULT_INTERVAL));
};
const IconButton = ({ onClick, children, className = "" }: { onClick: () => void; children: React.ReactNode; className?: string; }) => <div onClick={onClick} className={cl("icon-btn", className)}>{children}</div>;
const StatusIndicator = ({ type }: { type: StatusType; }) => <span className={cl("status-indicator", type)} />;

const CustomStatus = getUserSettingLazy<{ text: string; emojiId: string; emojiName: string; }>("status", "customStatus")!;
const StatusSetting = getUserSettingLazy<string>("status", "status")!;
const settings = definePluginSettings({
    interval: { type: OptionType.NUMBER, description: "Interval between status changes (seconds)", default: DEFAULT_INTERVAL, minimum: MIN_INTERVAL, maximum: MAX_INTERVAL },
    statuses: { type: OptionType.STRING, description: "JSON array of statuses", default: JSON.stringify([{ text: "Hey there!" }]) },
    presets: { type: OptionType.STRING, description: "JSON array of presets", default: "[]" },
    randomize: { type: OptionType.BOOLEAN, description: "Shuffle status order", default: false },
    autoStart: { type: OptionType.BOOLEAN, description: "Start automatically when Discord loads", default: false }
});

let _statusesCache: StatusStep[] | null = null;
let _statusesRaw: string | null = null;
function getParsedStatuses(): StatusStep[] {
    const raw = settings.store.statuses;
    if (raw === _statusesRaw && _statusesCache) return _statusesCache;
    try {
        const parsed = JSON.parse(raw);
        _statusesCache = Array.isArray(parsed) ? parsed : [];
    } catch {
        _statusesCache = [];
    }
    _statusesRaw = raw;
    return _statusesCache;
}

const state = { currentIndex: 0, interval: null as NodeJS.Timeout | null, isRunning: false, _started: false };

function AnimatedStatusIcon({ color = "currentColor" }: { color?: string; }) {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill={color}>
            <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75 1.23-4.25-2.58V7z" />
        </svg>
    );
}

function AnimatedStatusButton() {
    const { isRunning } = state;

    return (
        <HeaderBarButton
            icon={AnimatedStatusIcon}
            tooltip={isRunning ? "Animated Status: Running" : "Animated Status: Stopped"}
            aria-label="Toggle Animated Status"
            selected={isRunning}
            onClick={() => openModal(modalProps => <SettingsModal {...modalProps} />)}
        />
    );
}

export default definePlugin({
    name: "AnimatedStatus", description: "Cycle through status messages automatically",
    tags: ["Activity", "Customisation"], authors: [{ id: 705545572299571220n, name: "shxdes69" }], settings,
    dependencies: ["HeaderBarAPI"],
    headerBarButton: {
        icon: AnimatedStatusIcon,
        render: AnimatedStatusButton,
        priority: 1337
    },
    _lastSignal: 0,
    async setStatus(step: StatusStep): Promise<boolean> {
        if (!CustomStatus) return false;
        try {
            await (CustomStatus.updateSetting as any)({ text: step.text ?? "", emojiName: step.emojiName ?? "", emojiId: step.emojiId ?? "0", createdAtMs: Date.now().toString(), expiresAtMs: "0" });
            if (step.status && StatusSetting) await StatusSetting.updateSetting(step.status);
            return true;
        } catch { return false; }
    },
    async begin(preset?: string) {
        const all = getParsedStatuses();
        if (!all.length) return Toasts.show({ message: "Add some statuses first!", type: Toasts.Type.FAILURE, id: Toasts.genId() });
        const items = preset ? all.filter(s => s.preset === preset) : all;
        if (!items.length) return Toasts.show({ message: `No "${preset}" statuses found`, type: Toasts.Type.FAILURE, id: Toasts.genId() });
        if (state.interval) clearInterval(state.interval);
        state.currentIndex = 0;
        await this.setStatus(items[0]);
        state.interval = setInterval(() => this.next(preset).catch(() => { if (state.interval) { clearInterval(state.interval); state.interval = null; } state.isRunning = false; this.forceUpdate(); }), Math.max(settings.store.interval * 1000, MIN_INTERVAL * 1000));
        state.isRunning = true; this.forceUpdate();
        Toasts.show({ message: "Animated status started!", type: Toasts.Type.SUCCESS, id: Toasts.genId() });
    },
    async next(preset?: string) {
        const all = getParsedStatuses();
        const items = preset ? all.filter(s => s.preset === preset) : all;
        if (!items.length) return this.stop();
        state.currentIndex = settings.store.randomize ? Math.floor(Math.random() * items.length) : (state.currentIndex + 1) % items.length;
        await this.setStatus(items[state.currentIndex]);
    },
    updateInterval(newInterval: number) {
        if (!state.interval) return;
        clearInterval(state.interval);
        state.interval = setInterval(() => this.next().catch(() => { }), Math.max(newInterval * 1000, MIN_INTERVAL * 1000));
    },
    forceUpdate() { this.buttonUpdateSignal = Date.now(); },
    buttonUpdateSignal: 0,
    _autoStartTimer: null as ReturnType<typeof setTimeout> | null,
    start() {
        state._started = false;
        if (settings.store.autoStart) {
            this._autoStartTimer = setTimeout(() => {
                this._autoStartTimer = null;
                this.begin().catch(() => { });
            }, START_DELAY);
        }
    },
    stop() {
        if (this._autoStartTimer) { clearTimeout(this._autoStartTimer); this._autoStartTimer = null; }
        if (state.interval) clearInterval(state.interval);
        state.currentIndex = 0; state.isRunning = false; state._started = true; this.forceUpdate();
    },
    getIsRunning: () => state.isRunning,
});

function StatusPreview({ emojiId, emojiName, animated, text, statusType }: { emojiId?: string; emojiName?: string; animated?: boolean; text: string; statusType: StatusType; }) {
    const currentUser = UserStore.getCurrentUser();
    return (
        <div className={cl("preview")}>
            <Text className={cl("preview-label")}>LIVE PREVIEW</Text>
            <div className={cl("preview-card")}>
                <div className={cl("preview-avatar-wrapper")}>
                    <img src={currentUser ? getAvatarUrl(currentUser.id, currentUser.avatar) : undefined} alt="" className={cl("preview-avatar-img")} />
                    <span className={cl("preview-status-indicator", statusType)} />
                </div>
                <div className={cl("preview-info")}>
                    <Text className={cl("preview-name")} variant="text-sm/semibold">{currentUser?.username ?? "User"}</Text>
                    <div className={cl("preview-status")}>
                        {emojiId ? <img src={getEmojiUrl(emojiId, animated!)} alt="" className={cl("preview-emoji")} /> : emojiName ? <span className={cl("preview-emoji-text")}>{emojiName}</span> : null}
                        <Text className={cl("preview-text")} variant="text-sm/normal">{text || <span className={cl("preview-placeholder")}>Set a status...</span>}</Text>
                    </div>
                </div>
            </div>
        </div>
    );
}

function SettingsModal({ onClose, transitionState }: { onClose: () => void; transitionState: any; }) {
    const scrollerRef = useRef<HTMLDivElement>(null);
    const [currentTab, setCurrentTab] = useState(Tab.STATUSES);
    const [statuses, setStatuses] = useState<StatusStep[]>(() => safeParse(settings.store.statuses, []));
    const [inputText, setInputText] = useState("");
    const [preset, setPreset] = useState("");
    const [selectedStatus, setSelectedStatus] = useState<StatusType>("online");
    const [filterPreset, setFilterPreset] = useState<string | null>(null);
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [running, setRunning] = useState(state.isRunning);
    const [runningPreset, setRunningPreset] = useState<string | null>(null);
    const [presetListTrigger, setPresetListTrigger] = useState(0);
    const plugin = window.Vencord?.Plugins?.plugins?.AnimatedStatus as any;
    const presets = useMemo(() => safeParse<Preset[]>(settings.store.presets, []), [settings.store.presets, presetListTrigger]);
    const presetNames = useMemo(() => presets.map(p => p.name), [presets]);
    const filteredStatuses = useMemo(() => filterPreset ? statuses.filter(s => s.preset === filterPreset) : statuses, [statuses, filterPreset]);
    const previewData = useMemo(() => editingIndex !== null && statuses[editingIndex] ? { ...statuses[editingIndex], status: statuses[editingIndex].status || "online" } : { ...parseEmoji(inputText), status: selectedStatus }, [inputText, selectedStatus, editingIndex, statuses]);
    useEffect(() => { const check = () => setRunning(state.isRunning); const id = setInterval(check, 500); return () => clearInterval(id); }, []);
    const addStatus = () => {
        if (!inputText.trim()) return;
        const parsed = parseEmoji(inputText);
        if (!parsed.text.trim().length && !(parsed.emojiId || parsed.emojiName)) return Toasts.show({ message: "Please enter some text or an emoji!", type: Toasts.Type.FAILURE, id: Toasts.genId() });
        const newStatus: StatusStep = { ...parsed, preset: preset.trim() || undefined, status: selectedStatus };
        const updated = [...statuses, newStatus];
        setStatuses(updated);
        settings.store.statuses = JSON.stringify(updated);
        setInputText("");
        setPreset("");
        Toasts.show({ message: "Status added!", type: Toasts.Type.SUCCESS, id: Toasts.genId() });
    };
    const deleteStatus = (index: number) => {
        const updated = statuses.filter((_, i) => i !== index);
        setStatuses(updated);
        settings.store.statuses = JSON.stringify(updated);
        if (editingIndex === index) setEditingIndex(null);
        Toasts.show({ message: "Status deleted", type: Toasts.Type.SUCCESS, id: Toasts.genId() });
    };
    const saveEdit = (index: number) => {
        const card = document.querySelector(`[data-status-index="${index}"]`);
        if (!card) return;
        const textInput = card.querySelector("[data-edit-input=\"text\"]") as HTMLInputElement;
        const presetSelect = card.querySelector("[data-edit-input=\"preset\"]") as HTMLSelectElement;
        const statusBtn = card.querySelector("[data-edit-input=\"status\"][data-selected=\"true\"]") as HTMLElement;
        if (!textInput) return;
        const parsed = parseEmoji(textInput.value);
        if (!parsed.text.trim().length && !(parsed.emojiId || parsed.emojiName)) return Toasts.show({ message: "Please enter some text or an emoji!", type: Toasts.Type.FAILURE, id: Toasts.genId() });
        const updated = [...statuses];
        updated[index] = { ...parsed, preset: presetSelect?.value?.trim() || undefined, status: (statusBtn?.dataset?.value as StatusType) || "online" };
        setStatuses(updated);
        settings.store.statuses = JSON.stringify(updated);
        setEditingIndex(null);
        Toasts.show({ message: "Status saved!", type: Toasts.Type.SUCCESS, id: Toasts.genId() });
    };
    const cancelEdit = () => setEditingIndex(null);
    const startAnimation = (preset: string | null) => {
        setFilterPreset(preset);
        setRunningPreset(preset);
        plugin?.stop();
        setTimeout(() => plugin?.begin(preset ?? undefined), 100);
        setRunning(true);
    };
    const stopAnimation = () => {
        plugin?.stop();
        setRunning(false);
        setRunningPreset(null);
    };
    return (
        <ErrorBoundary>
            <ModalRoot {...{ transitionState, onClose }} size={ModalSize.LARGE} className={cl("modal-root")}>
                <ModalHeader className={cl("modal-header")}>
                    <div className={cl("header-title")}><I.Clock /><Text variant="heading-lg/semibold">Animated Status</Text></div>
                    <ModalCloseButton onClick={onClose} />
                </ModalHeader>
                <TabBar className={cl("tab-bar")} type="top" selectedItem={currentTab} onItemSelect={tab => { setEditingIndex(null); setCurrentTab(tab); }}>
                    <TabBar.Item className={cl("tab-item")} id={Tab.STATUSES}><span className={cl("tab-icon")}><I.List /></span><span>Statuses</span></TabBar.Item>
                    <TabBar.Item className={cl("tab-item")} id={Tab.PRESETS}><span className={cl("tab-icon")}><I.Folder /></span><span>Presets</span></TabBar.Item>
                    <TabBar.Item className={cl("tab-item")} id={Tab.SETTINGS}><span className={cl("tab-icon")}><I.Settings /></span><span>Settings</span></TabBar.Item>
                    <TabBar.Item className={cl("tab-item")} id={Tab.INFO}><span className={cl("tab-icon")}><I.Info /></span><span>Info</span></TabBar.Item>
                </TabBar>
                <ModalContent scrollerRef={scrollerRef} className={cl("modal-content")}>
                    {currentTab === Tab.STATUSES && (
                        <StatusesTab statuses={statuses} filteredStatuses={filteredStatuses} presetNames={presetNames} presets={presets} filterPreset={filterPreset} inputText={inputText} setInputText={setInputText} preset={preset} setPreset={setPreset} selectedStatus={selectedStatus} setSelectedStatus={setSelectedStatus} running={running} editingIndex={editingIndex} previewData={previewData} onAddStatus={addStatus} onDeleteStatus={deleteStatus} onEditStart={setEditingIndex} onEditSave={saveEdit} onEditCancel={cancelEdit} onStart={startAnimation} onStop={stopAnimation} onFilterChange={setFilterPreset} />
                    )}
                    {currentTab === Tab.PRESETS && (
                        <PresetsTab statuses={statuses} setStatuses={setStatuses} presetNames={presetNames} running={running} runningPreset={runningPreset} onStart={startAnimation} onStop={stopAnimation} onPresetChange={() => setPresetListTrigger(t => t + 1)} />
                    )}
                    {currentTab === Tab.SETTINGS && (
                        <SettingsTab statuses={statuses} interval={settings.store.interval} randomize={settings.store.randomize} autoStart={settings.store.autoStart} onIntervalChange={val => { settings.store.interval = val; plugin?.updateInterval(val); }} onRandomizeChange={v => settings.store.randomize = v} onAutoStartChange={v => settings.store.autoStart = v} onClearAll={() => { settings.store.statuses = "[]"; setStatuses([]); Toasts.show({ message: "All statuses cleared", type: Toasts.Type.SUCCESS, id: Toasts.genId() }); }} />
                    )}
                    {currentTab === Tab.INFO && <InfoTab />}
                </ModalContent>
            </ModalRoot>
        </ErrorBoundary>
    );
}

interface StatusesTabProps {
    statuses: StatusStep[]; filteredStatuses: StatusStep[]; presetNames: string[]; presets: Preset[];
    filterPreset: string | null; inputText: string; setInputText: (v: string) => void; preset: string; setPreset: (v: string) => void;
    selectedStatus: StatusType; setSelectedStatus: (v: StatusType) => void; running: boolean; editingIndex: number | null;
    previewData: Omit<StatusStep, "preset"> & { status: StatusType; }; onAddStatus: () => void; onDeleteStatus: (index: number) => void;
    onEditStart: (index: number) => void; onEditSave: (index: number) => void; onEditCancel: () => void;
    onStart: (preset: string | null) => void; onStop: () => void; onFilterChange: (preset: string | null) => void;
}
function StatusesTab({ statuses, filteredStatuses, presetNames, presets, filterPreset, inputText, setInputText, preset, setPreset, selectedStatus, setSelectedStatus, running, editingIndex, previewData, onAddStatus, onDeleteStatus, onEditStart, onEditSave, onEditCancel, onStart, onStop, onFilterChange }: StatusesTabProps) {
    return (
        <div className={cl("tab-content")}>
            <StatusPreview emojiId={previewData.emojiId} emojiName={previewData.emojiName} animated={previewData.animated} text={previewData.text} statusType={previewData.status || "online"} />
            {/* @ts-ignore */}
            <Forms.FormDivider />
            {/* @ts-ignore */}
            <Forms.FormSection className={cl("section")}>
                <Text className={cl("section-title")} variant="heading-md/bold">Add New Status</Text>
                <Text className={cl("section-desc")} variant="text-md/normal">Enter your status text or paste a Discord emoji (e.g., &lt;:emoji:123456789&gt;)</Text>
                <div className={cl("input-group")}><TextInput value={inputText} onChange={setInputText} placeholder="Enter status text or paste emoji..." autoFocus className={cl("input")} /></div>
                <div className={cl("row", "gap-sm")}>
                    <div className={cl("col", "flex-1")}>
                        <Text className={cl("label")} variant="text-sm/semibold">Preset (optional)</Text>
                        <select value={preset || ""} onChange={e => setPreset(e.target.value)} className={cl("native-select")}><option value="">None</option>{presets.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}</select>
                    </div>
                </div>
                <div>
                    <Text className={cl("label")} variant="text-sm/semibold">Discord Status Type</Text>
                    <div className={cl("status-selector")}>{STATUS_OPTIONS.map(status => (
                        <button key={status.value} className={cl("status-btn", { active: selectedStatus === status.value })} onClick={() => setSelectedStatus(status.value)}>
                            <span className={cl("status-dot")} style={{ background: status.color }} />{status.label}
                        </button>
                    ))}</div>
                </div>
                <div className={cl("actions")}>
                    <Button onClick={onAddStatus} disabled={!inputText.trim()} color={Button.Colors.BRAND} size={Button.Sizes.MEDIUM}><I.Plus />Add Status</Button>
                </div>
            </Forms.FormSection>
            <Forms.FormDivider />
            {filterPreset && (
                <div className={cl("filter-indicator")}>
                    <Text variant="text-sm/normal">Filtered by preset: <strong>{filterPreset}</strong></Text>
                    <Button onClick={() => { onFilterChange(null); if (running) onStop(); }} size={Button.Sizes.SMALL} color={(Button.Colors as any).SECONDARY} look={(Button.Looks as any).OUTLINED}>Clear Filter</Button>
                </div>
            )}
            <Forms.FormSection className={cl("section")}>
                <div className={cl("list-header")}>
                    <Text variant="heading-md/bold">Your Statuses <span className={cl("count-small")}>({filteredStatuses.length})</span></Text>
                    <Button onClick={() => running ? onStop() : onStart(filterPreset)} color={running ? Button.Colors.RED : Button.Colors.GREEN} size={Button.Sizes.SMALL}>{running ? <><I.Stop /> Stop</> : <><I.Play /> Start</>}</Button>
                </div>
                {filteredStatuses.length === 0 ? (
                    <div className={cl("empty-state")}>
                        <div className={cl("empty-icon")}><I.List /></div>
                        <Text className={cl("empty-title")} variant="heading-md/semibold">No statuses yet</Text>
                        <Text className={cl("empty-desc")} variant="text-sm/normal">Add your first status above to get started!</Text>
                    </div>
                ) : (
                    <div className={cl("status-list")}>
                        {filteredStatuses.map(status => {
                            const actualIndex = statuses.indexOf(status);
                            const isEditing = editingIndex === actualIndex;
                            return (
                                <div key={actualIndex} className={cl("status-card", { editing: isEditing })} data-status-index={actualIndex}>
                                    {isEditing ? (
                                        <div className={cl("edit-mode")}>
                                            <div className={cl("edit-inputs")}>
                                                <TextInput data-edit-input="text" defaultValue={status.text} placeholder="Status text..." className={cl("edit-input")} />
                                                <select data-edit-input="preset" defaultValue={status.preset || ""} className={cl("native-select", "edit-input")}><option value="">None</option>{presetNames.map(c => <option key={c} value={c}>{c}</option>)}</select>
                                                <div className={cl("status-selector")}>{STATUS_OPTIONS.map(s => (
                                                    <button key={s.value} data-edit-input="status" data-value={s.value} data-selected={s.value === status.status} className={cl("status-btn", { active: s.value === status.status })} onClick={e => { const btn = e.currentTarget; btn.parentElement?.querySelectorAll('[data-edit-input="status"]').forEach(b => (b as HTMLElement).dataset.selected = "false"); btn.dataset.selected = "true"; }}>
                                                        <span className={cl("status-dot")} style={{ background: s.color }} />{s.label}
                                                    </button>
                                                ))}</div>
                                            </div>
                                            <div className={cl("edit-actions")}>
                                                <Button onClick={() => onEditSave(actualIndex)} color={Button.Colors.GREEN} size={Button.Sizes.SMALL}><I.Check />Save</Button>
                                                <Button onClick={onEditCancel} color={(Button.Colors as any).SECONDARY} size={Button.Sizes.SMALL}>Cancel</Button>
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <div className={cl("status-avatar-wrapper")}>
                                                <img src={getAvatarUrl(UserStore.getCurrentUser()?.id ?? "", UserStore.getCurrentUser()?.avatar ?? null)} alt="" className={cl("status-avatar-img")} />
                                                <StatusIndicator type={status.status || "online"} />
                                            </div>
                                            <div className={cl("status-info")}>
                                                <div className={cl("status-preview-row")}>
                                                    {status.emojiId ? <img src={getEmojiUrl(status.emojiId, status.animated!)} alt="" className={cl("status-emoji-sm")} /> : status.emojiName ? <span className={cl("status-emoji-text-sm")}>{status.emojiName}</span> : null}
                                                    <Text className={cl("status-text")} variant="text-md/medium" {...{ lineClamp: 1 } as any}>{status.text || <em>No text</em>}</Text>
                                                </div>
                                                {status.preset && (
                                                    <div className={cl("status-meta")}><span className={cl("meta-tag")}>{status.preset}</span></div>
                                                )}
                                            </div>
                                            <div className={cl("status-actions")}>
                                                <IconButton onClick={() => onEditStart(actualIndex)}><I.Edit /></IconButton>
                                                <IconButton onClick={() => onDeleteStatus(actualIndex)} className="danger"><I.Trash /></IconButton>
                                            </div>
                                        </>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </Forms.FormSection>
        </div>
    );
}

interface PresetsTabProps {
    statuses: StatusStep[]; setStatuses: (s: StatusStep[]) => void; presetNames: string[];
    running: boolean; runningPreset: string | null; onStart: (preset: string | null) => void; onStop: () => void; onPresetChange: () => void;
}
function PresetsTab({ statuses, setStatuses, presetNames, running, runningPreset, onStart, onStop, onPresetChange }: PresetsTabProps) {
    const [newPresetName, setNewPresetName] = useState("");
    const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
    const [editingPresetName, setEditingPresetName] = useState("");
    const [expandedPresets, setExpandedPresets] = useState<Set<string>>(new Set());
    const presets = useMemo(() => safeParse<Preset[]>(settings.store.presets, []), [settings.store.presets]);
    const toggleExpanded = (presetId: string) => {
        setExpandedPresets(prev => {
            const next = new Set(prev);
            if (next.has(presetId)) next.delete(presetId); else next.add(presetId);
            return next;
        });
    };
    const getStatusesForPreset = (presetId: string) => {
        const preset = presets.find(p => p.id === presetId);
        return preset ? statuses.filter(s => s.preset === preset.name) : [];
    };
    const createPreset = () => {
        const name = newPresetName.trim();
        if (!name) return Toasts.show({ message: "Please enter a preset name", type: Toasts.Type.FAILURE, id: Toasts.genId() });
        if (presets.some(p => p.name.toLowerCase() === name.toLowerCase())) return Toasts.show({ message: "A preset with this name already exists", type: Toasts.Type.FAILURE, id: Toasts.genId() });
        const newPreset: Preset = { id: Date.now().toString(), name };
        settings.store.presets = JSON.stringify([...presets, newPreset]);
        setNewPresetName("");
        onPresetChange();
        Toasts.show({ message: `Preset "${name}" created! Add statuses to it in the Statuses tab.`, type: Toasts.Type.SUCCESS, id: Toasts.genId() });
    };
    const deletePreset = (preset: Preset) => {
        const statusCount = statuses.filter(s => s.preset === preset.name).length;
        settings.store.presets = JSON.stringify(presets.filter(p => p.id !== preset.id));
        const updatedStatuses = statuses.map(s => s.preset === preset.name ? { ...s, preset: undefined } : s);
        setStatuses(updatedStatuses);
        settings.store.statuses = JSON.stringify(updatedStatuses);
        if (runningPreset === preset.name) onStop();
        onPresetChange();
        Toasts.show({ message: `Preset "${preset.name}" deleted${statusCount > 0 ? ` (${statusCount} statuses unassigned)` : ""}`, type: Toasts.Type.SUCCESS, id: Toasts.genId() });
    };
    const startEditingPreset = (preset: Preset) => { setEditingPresetId(preset.id); setEditingPresetName(preset.name); };
    const savePresetEdit = (presetId: string) => {
        const newName = editingPresetName.trim();
        if (!newName) return setEditingPresetId(null);
        if (presets.find(p => p.id !== presetId && p.name.toLowerCase() === newName.toLowerCase())) return Toasts.show({ message: "A preset with this name already exists", type: Toasts.Type.FAILURE, id: Toasts.genId() });
        const preset = presets.find(p => p.id === presetId);
        if (!preset) return;
        const oldName = preset.name;
        settings.store.presets = JSON.stringify(presets.map(p => p.id === presetId ? { ...p, name: newName } : p));
        const updatedStatuses = statuses.map(s => s.preset === oldName ? { ...s, preset: newName } : s);
        setStatuses(updatedStatuses);
        settings.store.statuses = JSON.stringify(updatedStatuses);
        setEditingPresetId(null);
        onPresetChange();
        Toasts.show({ message: `Preset renamed to "${newName}"`, type: Toasts.Type.SUCCESS, id: Toasts.genId() });
    };
    const cancelPresetEdit = () => setEditingPresetId(null);
    const runPreset = (preset: Preset) => {
        const presetStatuses = statuses.filter(s => s.preset === preset.name);
        if (presetStatuses.length === 0) return Toasts.show({ message: `No statuses in "${preset.name}". Add some in the Statuses tab!`, type: Toasts.Type.FAILURE, id: Toasts.genId() });
        onStart(preset.name);
    };
    return (
        <div className={cl("tab-content")}>
            <Forms.FormSection className={cl("section")}>
                <Text className={cl("section-title")} variant="heading-md/bold">Presets</Text>
                <Text className={cl("section-desc")} variant="text-md/normal">Create presets to organize your statuses. Add statuses to presets through the optional Preset field when adding/editing statuses in the Statuses tab. Click Run to cycle through all statuses in a preset.</Text>
                <div className={cl("row")} style={{ marginBottom: "16px" }}>
                    <TextInput value={newPresetName} onChange={setNewPresetName} placeholder="New preset name..." className={cl("col", "flex-1")} />
                    <Button onClick={createPreset} color={Button.Colors.BRAND} disabled={!newPresetName.trim()}><I.Plus />Create</Button>
                </div>
                {presets.length === 0 ? (
                    <div className={cl("empty-state")}><div className={cl("empty-icon")}><I.List /></div><Text className={cl("empty-title")} variant="heading-md/semibold">No presets yet</Text><Text className={cl("empty-desc")} variant="text-sm/normal">Create a preset above, then add statuses to it in the Statuses tab</Text></div>
                ) : (
                    <div className={cl("preset-list")}>
                        {presets.map(preset => {
                            const presetStatuses = getStatusesForPreset(preset.id);
                            const isRunningThisPreset = running && runningPreset === preset.name;
                            const isEditing = editingPresetId === preset.id;
                            const isExpanded = expandedPresets.has(preset.id);
                            return (
                                <div key={preset.id} className={cl("preset-item-wrapper")}>
                                    <div className={cl("preset-item", { running: isRunningThisPreset })}>
                                        <div className={cl("preset-expandable")} onClick={() => !isEditing && toggleExpanded(preset.id)}>
                                            <div className={cl("preset-emoji-wrapper")}>
                                                <button className={cl("preset-expand-btn", { expanded: isExpanded })} onClick={e => { e.stopPropagation(); toggleExpanded(preset.id); }}>
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z" /></svg>
                                                </button>
                                                {preset.emojiId ? <img src={getEmojiUrl(preset.emojiId, preset.animated!)} alt="" className={cl("preset-emoji-img")} /> : preset.emojiName ? <span className={cl("preset-emoji-text")}>{preset.emojiName}</span> : <div className={cl("preset-emoji")}><I.List /></div>}
                                                {isRunningThisPreset && <span className={cl("status-indicator", "online")} style={{ position: "absolute", bottom: "-3px", right: "-3px", width: "14px", height: "14px", borderRadius: "50%", border: "2px solid var(--background-secondary)", backgroundColor: "#23a55a" }} />}
                                            </div>
                                            <div className={cl("preset-info")}>
                                                {isEditing ? (
                                                    <TextInput value={editingPresetName} onChange={setEditingPresetName} placeholder="Preset name..." autoFocus className={cl("edit-input")} style={{ marginBottom: "4px" }} />
                                                ) : (
                                                    <>
                                                        <Text className={cl("preset-text")} variant="text-md/medium">{preset.name}{isRunningThisPreset && <span style={{ color: "var(--text-positive)", marginLeft: "8px", fontSize: "12px" }}> • Running</span>}</Text>
                                                        <div className={cl("preset-meta")}><span className={cl("preset-tag")}>{presetStatuses.length} {presetStatuses.length === 1 ? "status" : "statuses"}</span></div>
                                                    </>
                                                )}
                                            </div>
                                            <div className={cl("preset-actions")}>
                                                {isEditing ? (
                                                    <>
                                                        <Button onClick={() => savePresetEdit(preset.id)} size={Button.Sizes.SMALL} color={Button.Colors.GREEN}><I.Check /></Button>
                                                        <Button onClick={cancelPresetEdit} size={Button.Sizes.SMALL} color={(Button.Colors as any).SECONDARY}>Cancel</Button>
                                                    </>
                                                ) : (
                                                    <>
                                                        {isRunningThisPreset ? <Button onClick={() => onStop()} size={Button.Sizes.SMALL} color={Button.Colors.RED}><I.Stop />Stop</Button> : <Button onClick={() => runPreset(preset)} size={Button.Sizes.SMALL} color={Button.Colors.GREEN} disabled={presetStatuses.length === 0}><I.Play />Run</Button>}
                                                        <IconButton onClick={() => startEditingPreset(preset)}><I.Edit /></IconButton>
                                                        <IconButton onClick={() => deletePreset(preset)} className="danger"><I.Trash /></IconButton>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    {isExpanded && presetStatuses.length > 0 && (
                                        <div className={cl("preset-statuses")}>
                                            {presetStatuses.map(status => {
                                                const actualIndex = statuses.indexOf(status);
                                                return (
                                                    <div key={actualIndex} className={cl("preset-status-item")}>
                                                        <div className={cl("preset-status-emoji")}>
                                                            {status.emojiId ? <img src={getEmojiUrl(status.emojiId, status.animated!)} alt="" className={cl("emoji-img")} /> : status.emojiName ? <span className={cl("emoji-text")}>{status.emojiName}</span> : <img src={getAvatarUrl(UserStore.getCurrentUser()?.id ?? "", UserStore.getCurrentUser()?.avatar ?? null)} alt="" className={cl("emoji-img")} />}
                                                            <StatusIndicator type={status.status || "online"} />
                                                        </div>
                                                        <Text className={cl("preset-status-text")} variant="text-sm/normal" {...{ lineClamp: 1 } as any}>{status.text || <em>No text</em>}</Text>
                                                        <IconButton onClick={() => { const updated = statuses.filter((_, i) => i !== actualIndex); setStatuses(updated); settings.store.statuses = JSON.stringify(updated); }} className="danger"><I.Trash /></IconButton>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </Forms.FormSection>
        </div>
    );
}

interface SettingsTabProps {
    statuses: StatusStep[]; interval: number; randomize: boolean; autoStart: boolean;
    onIntervalChange: (v: number) => void; onRandomizeChange: (v: boolean) => void; onAutoStartChange: (v: boolean) => void; onClearAll: () => void;
}
function SettingsTab({ statuses, interval, randomize, autoStart, onIntervalChange, onRandomizeChange, onAutoStartChange, onClearAll }: SettingsTabProps) {
    const [intervalText, setIntervalText] = useState(formatInterval(interval));
    const [localRandomize, setLocalRandomize] = useState(randomize);
    const [localAutoStart, setLocalAutoStart] = useState(autoStart);

    const handleRandomizeChange = (value: boolean) => {
        setLocalRandomize(value);
        onRandomizeChange(value);
    };

    const handleAutoStartChange = (value: boolean) => {
        setLocalAutoStart(value);
        onAutoStartChange(value);
    };
    return (
        <div className={cl("tab-content")}>
            <Forms.FormSection className={cl("section")}>
                <Text className={cl("section-title")} variant="heading-md/bold">Animation Settings</Text>
                <div className={cl("setting-row")}>
                    <div className={cl("setting-info")}>
                        <Text className={cl("setting-label")} variant="text-sm/semibold">Cycle Interval</Text>
                        <Text className={cl("setting-desc")} variant="text-sm/normal">How long to wait before changing to the next status (5s - 5min, default 10s)</Text>
                    </div>
                    <div className={cl("interval-input-wrapper")}>
                        <TextInput value={intervalText} onChange={v => { setIntervalText(v); if (!v || /[sm]/i.test(v)) onIntervalChange(parseInterval(v)); }} onBlur={() => { const current = parseInterval(intervalText); if (current < MIN_INTERVAL) { setIntervalText(formatInterval(MIN_INTERVAL)); onIntervalChange(MIN_INTERVAL); } }} placeholder="10s or 1m 30s" className={cl("interval-input")} />
                    </div>
                </div>
                {interval < 10 && (
                    <div style={{ marginTop: "12px", padding: "12px", background: "rgba(237, 66, 69, 0.1)", border: "1px solid var(--text-danger)", borderRadius: "8px" }}>
                        <Text variant="text-sm/normal" style={{ color: "#fff" }}>Warning: Intervals below 10 seconds may not display correctly on all clients and could trigger rate limits.</Text>
                    </div>
                )}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "8px 0" }}>
                    <div>
                        <Text variant="text-sm/semibold">Shuffle Statuses</Text>
                        <Text variant="text-sm/normal" style={{ color: "var(--text-muted)" }}>Randomize the order in which statuses appear</Text>
                    </div>
                    <Switch checked={localRandomize} onChange={handleRandomizeChange} />
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "8px 0" }}>
                    <div>
                        <Text variant="text-sm/semibold">Auto-start on Discord Load</Text>
                        <Text variant="text-sm/normal" style={{ color: "var(--text-muted)" }}>Automatically start cycling when Discord launches</Text>
                    </div>
                    <Switch checked={localAutoStart} onChange={handleAutoStartChange} />
                </div>
            </Forms.FormSection>
            {statuses.length > 0 && (
                <>
                    <Forms.FormSection className={cl("section", "danger")}>
                        <Text className={cl("section-title", "danger")} variant="heading-md/bold">Danger Zone</Text>
                        <Text className={cl("section-desc")} variant="text-md/normal">This will permanently delete all {statuses.length} configured {statuses.length === 1 ? "status" : "statuses"}.</Text>
                        <Button color={Button.Colors.RED} onClick={onClearAll}><I.Trash />Clear All Statuses</Button>
                    </Forms.FormSection>
                </>
            )}
        </div>
    );
}

function InfoTab() {
    return (
        <div className={cl("tab-content")}>
            <Forms.FormSection className={cl("section")}>
                <Text className={cl("section-title")} variant="heading-md/bold">About Animated Status</Text>
                <Text className={cl("section-desc")} variant="text-md/normal">Animated Status automatically cycles through custom status messages at a set interval. You can add emojis, organize statuses into presets, and even set your Discord status type (Online, Idle, DND, Invisible) for each status.</Text>
                <Forms.FormDivider />
                <Text className={cl("section-title")} variant="heading-md/bold">How to add Discord emojis</Text>
                <Text className={cl("section-desc")} variant="text-md/normal"><strong>Emoji Slots:</strong> The emoji slot (first field) supports Nitro/custom Discord emojis - paste the full code like <code>&lt;:emoji:123&gt;</code>. The text field only supports standard Unicode emojis.</Text>
                <div className={cl("example-box")}>
                    <Text className={cl("example-title")} variant="text-sm/semibold">Examples:</Text>
                    <Text className={cl("example-code")} variant="text-sm/normal">&lt;:thonk:802706903324743690&gt; My status text</Text>
                    <Text className={cl("example-code")} variant="text-sm/normal">&lt;a:pepe_spin:805406289152989204&gt; Animated emoji</Text>
                </div>
                <Forms.FormDivider />
                <Text className={cl("section-title")} variant="heading-md/bold">Cycle Interval</Text>
                <Text className={cl("section-desc")} variant="text-md/normal">Set how often statuses change (5s minimum, 5min maximum). Default is 10 seconds.</Text>
                <div className={cl("section", "danger")} style={{ marginTop: "12px", background: "rgba(237, 66, 69, 0.1)", border: "1px solid var(--text-danger)", padding: "16px", borderRadius: "8px" }}>
                    <Text className={cl("section-title", "danger")} variant="heading-md/bold">Warning: Short Intervals</Text>
                    <Text className={cl("section-desc")} variant="text-md/normal">Intervals below 10 seconds are <strong>not recommended</strong>. Rapid status changes may not display correctly on all Discord clients and could trigger rate limits.</Text>
                </div>
                <Forms.FormDivider />
                <Text className={cl("section-title")} variant="heading-md/bold">Presets</Text>
                <Text className={cl("section-desc")} variant="text-md/normal">Create presets to organize your statuses. Add statuses to presets through the optional Preset field when adding/editing statuses in the Statuses tab. Click Run on a preset to cycle through all its statuses.</Text>
                <Forms.FormDivider />
                <Text className={cl("info-footer")} variant="text-xs/normal">Made by <a href="https://github.com/shxdes69" target="_blank" rel="noopener noreferrer" className={cl("highlight")}>shxdes69</a> • Ver 2.1</Text>
            </Forms.FormSection>
        </div>
    );
}
