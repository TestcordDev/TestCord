/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { FormSwitch } from "@components/FormSwitch";
import { MainSettingsIcon } from "@components/Icons";
import { Paragraph } from "@components/Paragraph";
import { SettingsTab, wrapTab } from "@components/settings/tabs/BaseTab";
import { Switch } from "@components/Switch";
import { Margins } from "@utils/margins";
import { saveFile } from "@utils/web";
import { Alerts, React, showToast, Toasts, useDrag, useDrop } from "@webpack/common";

import { openImportModal } from "./ImportModal";
import { openInfoModal } from "./InfoModal";
import { openMergeModal } from "./MergeModal";
import { openNameModal } from "./NameModal";
import {
    ANIM_KEYS, ANIM_LABELS, applyPreset, deletePreset, duplicatePreset, exportAllPresets,
    getAnim, getAnimMaster, getHideDuplicate, getRestoreDefault, hasPreset, listPresets, loadPresets,
    Preset, renamePreset, reorderPresets, savePreset, setAnim, setAnimMaster, setHideDuplicate, setRestoreDefault
} from "./presets";
import { openSaveModal } from "./SaveModal";

type DropIntent = "before" | "merge" | "after";
const PRESET_DND_TYPE = "VC_PRESET";

interface PresetDragItem {
    name: string;
}

interface DragPreviewPoint {
    x: number;
    y: number;
}

interface DragPreviewOffset {
    x: number;
    y: number;
}

// Sync animation prefs to <body> classes so both the tab and the modal portals
// (which render outside this subtree) can key off them. master off => all off.
function syncAnimClasses() {
    const master = getAnimMaster();
    document.body.classList.toggle("vc-presets-noanim-all", !master);
    for (const key of ANIM_KEYS) {
        document.body.classList.toggle(`vc-presets-noanim-${key}`, !getAnim(key));
    }
}

function promptReload() {
    Alerts.show({
        title: "Reload to apply",
        body: "Enabling or disabling plugins requires a reload to take effect. Reload now?",
        confirmText: "Reload",
        cancelText: "Later",
        onConfirm: () => location.reload(),
    });
}

const saveJson = (data: string, filename: string) =>
    saveFile(new File([data], filename, { type: "application/json" }));

function formatDate(ts: number) {
    if (!ts) return "";
    return new Intl.DateTimeFormat(navigator.language, { dateStyle: "medium", timeStyle: "short" }).format(ts);
}

function PresetDragPreview({ preset, point, offset }: { preset: Preset | undefined; point: DragPreviewPoint | null; offset: DragPreviewOffset; }) {
    if (!preset || !point) return null;

    const count = Object.values(preset.plugins).filter(p => p.enabled).length;

    return (
        <div
            className="vc-presets-row vc-presets-drag-preview"
            style={{ transform: `translate3d(${point.x - offset.x}px, ${point.y - offset.y}px, 0)` }}
        >
            <button className="vc-presets-row-gear" aria-label="Preset settings" tabIndex={-1}>
                <MainSettingsIcon />
            </button>

            <div className="vc-presets-row-info">
                <span className="vc-presets-row-name">{preset.name}</span>
                <span className="vc-presets-row-meta">
                    {count} enabled · {formatDate(preset.createdAt)}
                    {preset.liveBackup && <span className="vc-presets-row-badge">● live</span>}
                </span>
            </div>

            <div className="vc-presets-row-actions">
                <Button size="small">Apply</Button>
                <Button size="small" variant="secondary">Rename</Button>
                <Button size="small" variant="secondary">Duplicate</Button>
                <Button size="small" variant="dangerPrimary">Delete</Button>
            </div>
        </div>
    );
}

function PresetRow({ preset, globalDefault, hideDuplicate, draggingName, dragOverName, dropIntent, setDraggingName, setDragOverName, setDropIntent, setDragPreviewPoint, setDragPreviewOffset, onChange }: { preset: Preset; globalDefault: boolean; hideDuplicate: boolean; draggingName: string | null; dragOverName: string | null; dropIntent: DropIntent | null; setDraggingName: (name: string | null) => void; setDragOverName: (name: string | null) => void; setDropIntent: (intent: DropIntent | null) => void; setDragPreviewPoint: (point: DragPreviewPoint | null) => void; setDragPreviewOffset: (offset: DragPreviewOffset) => void; onChange: () => void; }) {
    const rowRef = React.useRef<HTMLDivElement>(null);
    const effectiveRestore = preset.restoreSettings ?? globalDefault;

    const apply = () => {
        Alerts.show({
            title: `Apply "${preset.name}"`,
            body: effectiveRestore
                ? "This will set which plugins are enabled AND overwrite each plugin's settings with the preset's saved values."
                : "This will set which plugins are enabled. Plugin settings are left as-is.",
            confirmText: "Apply",
            cancelText: "Cancel",
            onConfirm: async () => {
                const { changed, missingThemes } = await applyPreset(preset.name, effectiveRestore);
                if (missingThemes.length) {
                    showToast(`Skipped ${missingThemes.length} missing theme(s): ${missingThemes.join(", ")}`, Toasts.Type.FAILURE);
                }
                if (changed) promptReload();
            },
        });
    };

    const onDelete = () => Alerts.show({
        title: `Delete "${preset.name}"`,
        body: "This can't be undone.",
        confirmText: "Delete",
        confirmColor: "danger",
        cancelText: "Cancel",
        onConfirm: () => { deletePreset(preset.name); onChange(); },
    });

    const onRename = () => openNameModal("Rename preset", preset.name, to => {
        if (hasPreset(to) && to !== preset.name) return showToast(`A preset named "${to}" already exists.`, Toasts.Type.FAILURE);
        renamePreset(preset.name, to);
        onChange();
    });

    const onDuplicate = () => {
        let copy = `${preset.name} (copy)`;
        let i = 2;
        while (hasPreset(copy)) copy = `${preset.name} (copy ${i++})`;
        duplicatePreset(preset.name, copy, Date.now());
        onChange();
    };

    const onInfo = () => openInfoModal(preset.name, onChange);
    const clearDragTarget = () => {
        setDragOverName(null);
        setDropIntent(null);
    };
    const getDropIntent = (clientY: number): DropIntent | null => {
        if (!rowRef.current) return null;
        const rect = rowRef.current.getBoundingClientRect();
        const y = clientY - rect.top;
        if (y < rect.height * 0.28) return "before";
        if (y > rect.height * 0.72) return "after";
        return "merge";
    };

    const [{ isDragging }, drag] = useDrag({
        type: PRESET_DND_TYPE,
        item: () => {
            const rect = rowRef.current?.getBoundingClientRect();
            const event = window.event instanceof DragEvent ? window.event : null;
            if (rect && event) {
                setDragPreviewOffset({ x: event.clientX - rect.left, y: event.clientY - rect.top });
            } else {
                setDragPreviewOffset({ x: 16, y: 16 });
            }

            setDraggingName(preset.name);
            setDragPreviewPoint(null);
            return { name: preset.name };
        },
        end: () => {
            setDraggingName(null);
            setDragPreviewPoint(null);
            clearDragTarget();
        },
        collect: monitor => ({ isDragging: monitor.isDragging() }),
    });

    const [{ isOver }, drop] = useDrop({
        accept: PRESET_DND_TYPE,
        collect: monitor => ({ isOver: monitor.isOver({ shallow: true }) }),
        hover: (item: PresetDragItem, monitor) => {
            if (!rowRef.current || item.name === preset.name) return;
            const clientOffset = monitor.getClientOffset();
            if (!clientOffset) return;
            setDragPreviewPoint(clientOffset);

            const intent = getDropIntent(clientOffset.y);
            if (!intent) return;

            if (intent !== "merge" && reorderPresets(item.name, preset.name, intent)) {
                clearDragTarget();
                onChange();
                return;
            }

            if (intent !== "merge") {
                clearDragTarget();
                return;
            }

            setDragOverName(preset.name);
            setDropIntent(intent);
        },
        drop: (item: PresetDragItem, monitor) => {
            if (monitor.didDrop() || item.name === preset.name) return;
            const clientOffset = monitor.getClientOffset();
            if (clientOffset) setDragPreviewPoint(clientOffset);
            const intent = clientOffset ? getDropIntent(clientOffset.y) : dropIntent;
            clearDragTarget();

            if (intent === "merge") openMergeModal(item.name, preset.name, onChange);
        },
    });

    React.useEffect(() => {
        if (!isOver && dragOverName === preset.name) clearDragTarget();
    }, [isOver, dragOverName, preset.name]);

    drag(drop(rowRef));

    const count = Object.values(preset.plugins).filter(p => p.enabled).length;

    return (
        <Card
            ref={rowRef}
            className={`vc-presets-row${(draggingName === preset.name || isDragging) ? " vc-presets-row-dragging" : ""}${dragOverName === preset.name ? ` vc-presets-row-drop-target vc-presets-row-drop-${dropIntent}` : ""}`}
        >
            <button className="vc-presets-row-gear" onClick={onInfo} aria-label="Preset settings">
                <MainSettingsIcon />
            </button>

            <div className="vc-presets-row-info">
                <span className="vc-presets-row-name">{preset.name}</span>
                <span className="vc-presets-row-meta">
                    {count} enabled · {formatDate(preset.createdAt)}
                    {preset.liveBackup && <span className="vc-presets-row-badge">● live</span>}
                </span>
            </div>

            <div className="vc-presets-row-actions">
                <Button size="small" onClick={apply}>Apply</Button>
                <Button size="small" variant="secondary" onClick={onRename}>Rename</Button>
                <span className={`vc-presets-dup-wrap${hideDuplicate ? " vc-presets-dup-hidden" : ""}`}>
                    <Button size="small" variant="secondary" onClick={onDuplicate}>Duplicate</Button>
                </span>
                <Button size="small" variant="dangerPrimary" onClick={onDelete}>Delete</Button>
            </div>
        </Card>
    );
}

function PresetsTab() {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);
    const [ready, setReady] = React.useState(false);
    const [animOpen, setAnimOpen] = React.useState(false);
    const [draggingName, setDraggingName] = React.useState<string | null>(null);
    const [dragOverName, setDragOverName] = React.useState<string | null>(null);
    const [dropIntent, setDropIntent] = React.useState<DropIntent | null>(null);
    const [dragPreviewPoint, setDragPreviewPoint] = React.useState<DragPreviewPoint | null>(null);
    const [dragPreviewOffset, setDragPreviewOffset] = React.useState<DragPreviewOffset>({ x: 16, y: 16 });

    // Hydrate the cache from the shared native file once on mount, then render.
    React.useEffect(() => { loadPresets().then(() => setReady(true)); }, []);

    // Keep <body> animation classes in sync on every render (cheap, idempotent).
    React.useEffect(syncAnimClasses);

    React.useEffect(() => {
        if (!draggingName) return;

        const updatePreview = (event: DragEvent) => {
            setDragPreviewPoint({ x: event.clientX, y: event.clientY });
        };

        document.addEventListener("dragover", updatePreview);
        return () => document.removeEventListener("dragover", updatePreview);
    }, [draggingName]);

    const globalDefault = getRestoreDefault();
    const hideDuplicate = getHideDuplicate();
    const animMaster = getAnimMaster();

    const presets = listPresets();
    const dragPreviewPreset = draggingName ? presets.find(preset => preset.name === draggingName) : undefined;

    const onSave = () => openSaveModal("", (name, scope) => {
        const exists = hasPreset(name);
        const write = async () => {
            await savePreset(name, Date.now(), scope);
            forceUpdate();
            showToast(`Saved preset "${name}".`, Toasts.Type.SUCCESS);
        };
        if (exists) {
            Alerts.show({
                title: "Overwrite preset",
                body: `A preset named "${name}" already exists. Overwrite it?`,
                confirmText: "Overwrite",
                confirmColor: "danger",
                cancelText: "Cancel",
                onConfirm: () => void write(),
            });
        } else {
            void write();
        }
    });

    const onImport = () => openImportModal(forceUpdate);
    const onExportAll = () => saveJson(exportAllPresets(), "testcord-presets.json");

    return (
        <SettingsTab>
            <Paragraph className={Margins.bottom16}>
                Presets are named snapshots of your plugin loadout — which plugins are
                enabled, plus each plugin's own settings. Save your current setup, then
                apply it later or share a single preset with others.
            </Paragraph>

            <div className="vc-presets-toolbar">
                <Button onClick={onSave}>Save current as preset</Button>
                <Button variant="secondary" onClick={onImport}>Import preset…</Button>
                <Button variant="secondary" onClick={onExportAll} disabled={presets.length === 0}>Export all</Button>
            </div>

            <FormSwitch
                value={globalDefault}
                onChange={v => { setRestoreDefault(v); forceUpdate(); }}
                title="Default: restore plugin settings on apply (overwrites current)"
                description="The default for presets set to 'Restore: Default'. When on, applying such a preset also overwrites each plugin's settings with its saved values. Per-preset 'Restore: On/Off' overrides this."
            />

            <FormSwitch
                value={hideDuplicate}
                onChange={v => { setHideDuplicate(v); forceUpdate(); }}
                title="Hide the Duplicate button on preset rows"
                description="Removes the per-preset Duplicate button from the list. You can still duplicate by exporting and re-importing."
            />

            <div className="vc-presets-anim-section">
                <div className="vc-form-switch-container">
                    <div className="vc-form-switch vc-presets-anim-master-row">
                        <button
                            type="button"
                            className="vc-form-switch-text vc-presets-anim-master-button"
                            aria-expanded={animOpen}
                            onClick={() => setAnimOpen(o => !o)}
                        >
                            <span className="vc-presets-anim-master-title">
                                <span>Animations</span>
                                <span className={`vc-presets-anim-chevron${animOpen ? " vc-presets-anim-chevron-open" : ""}`}>▾</span>
                            </span>
                            <span className="vc-presets-anim-master-description">Master switch for all preset-tab animations. Click here to toggle individual animation options.</span>
                        </button>
                        <div className="vc-form-switch-control">
                            <Switch
                                checked={animMaster}
                                onChange={v => { setAnimMaster(v); syncAnimClasses(); forceUpdate(); }}
                            />
                        </div>
                    </div>
                </div>
                <div className={`vc-presets-anim-list${animOpen ? " vc-presets-anim-list-open" : ""}${animMaster ? "" : " vc-presets-anim-list-disabled"}`}>
                    {ANIM_KEYS.map(key => (
                        <FormSwitch
                            key={key}
                            value={getAnim(key)}
                            disabled={!animMaster}
                            onChange={v => { setAnim(key, v); syncAnimClasses(); forceUpdate(); }}
                            title={ANIM_LABELS[key].title}
                            description={ANIM_LABELS[key].description}
                        />
                    ))}
                </div>
            </div>

            {!ready
                ? <Paragraph className={Margins.top16} style={{ opacity: 0.6 }}>Loading presets…</Paragraph>
                : presets.length === 0
                    ? <Paragraph className={Margins.top16} style={{ opacity: 0.6 }}>No presets yet. Save your current loadout to create one.</Paragraph>
                    : (
                        <div className={`vc-presets-list ${Margins.top16}`}>
                            {presets.map(p => <PresetRow key={p.name} preset={p} globalDefault={globalDefault} hideDuplicate={hideDuplicate} draggingName={draggingName} dragOverName={dragOverName} dropIntent={dropIntent} setDraggingName={setDraggingName} setDragOverName={setDragOverName} setDropIntent={setDropIntent} setDragPreviewPoint={setDragPreviewPoint} setDragPreviewOffset={setDragPreviewOffset} onChange={forceUpdate} />)}
                            <PresetDragPreview preset={dragPreviewPreset} point={dragPreviewPoint} offset={dragPreviewOffset} />
                        </div>
                    )}
        </SettingsTab>
    );
}

export default wrapTab(PresetsTab, "Presets");
