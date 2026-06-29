/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { FormSwitch } from "@components/FormSwitch";
import { Paragraph } from "@components/Paragraph";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, ModalSize, openModal, type RenderModalProps } from "@utils/modal";
import { React, showToast, TextInput, Toasts } from "@webpack/common";

import { getMergePlan, hasPreset, mergePresets, type MergeConflict } from "./presets";

function uniqueMergeName(sourceName: string, targetName: string) {
    const base = `${targetName} + ${sourceName}`;
    if (!hasPreset(base)) return base;
    let index = 2;
    while (hasPreset(`${base} (${index})`)) index++;
    return `${base} (${index})`;
}

function MergeActionDropdown({ conflict, value, onChange }: { conflict: MergeConflict; value: string; onChange: (value: string) => void; }) {
    const [open, setOpen] = React.useState(false);
    const selected = conflict.options.find(option => option.value === value) ?? conflict.options[0];

    return (
        <div className={`vc-presets-merge-dropdown${open ? " vc-presets-merge-dropdown-open" : ""}`} onBlur={e => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
        }}>
            <button
                type="button"
                className="vc-presets-merge-dropdown-button"
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={() => setOpen(o => !o)}
            >
                <span>{selected.label}</span>
                <span className="vc-presets-merge-dropdown-chevron">▾</span>
            </button>
            {open && (
                <div className="vc-presets-merge-dropdown-menu" role="listbox">
                    {conflict.options.map(option => (
                        <button
                            key={option.value}
                            type="button"
                            role="option"
                            aria-selected={option.value === value}
                            className={`vc-presets-merge-dropdown-option${option.value === value ? " vc-presets-merge-dropdown-option-selected" : ""}`}
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => {
                                onChange(option.value);
                                setOpen(false);
                            }}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

function MergeConflictRow({ conflict, value, onChange }: { conflict: MergeConflict; value: string; onChange: (value: string) => void; }) {
    return (
        <div className="vc-presets-merge-conflict">
            <div className="vc-presets-merge-conflict-text">
                <span className="vc-presets-merge-kind">{conflict.kind}</span>
                <strong>{conflict.label}</strong>
                <Paragraph className="vc-presets-dim">{conflict.description}</Paragraph>
            </div>
            <MergeActionDropdown conflict={conflict} value={value} onChange={onChange} />
        </div>
    );
}

function MergeModal({ modalProps, sourceName, targetName, onMerged }: { modalProps: RenderModalProps; sourceName: string; targetName: string; onMerged: () => void; }) {
    const plan = React.useMemo(() => getMergePlan(sourceName, targetName), [sourceName, targetName]);
    const [outputName, setOutputName] = React.useState(() => uniqueMergeName(sourceName, targetName));
    const [deleteSource, setDeleteSource] = React.useState(false);
    const [deleteTarget, setDeleteTarget] = React.useState(false);
    const [themeCodeMatches, setThemeCodeMatches] = React.useState<string[]>([]);
    const [decisions, setDecisions] = React.useState<Record<string, string>>(() => Object.fromEntries(
        plan?.conflicts.map(conflict => [conflict.id, conflict.defaultAction]) ?? []
    ));

    React.useEffect(() => {
        if (!plan?.source.themes?.length || !plan.target.themes?.length) return;

        const sourceEnabledThemes = new Set(plan.source.themes ?? []);
        const targetEnabledThemes = new Set(plan.target.themes ?? []);
        const sourceThemeFiles = Object.entries(plan.source.themeFiles ?? {}).filter(([fileName]) => sourceEnabledThemes.has(fileName));
        const targetThemeFiles = Object.entries(plan.target.themeFiles ?? {}).filter(([fileName]) => targetEnabledThemes.has(fileName));
        const storedMatches: string[] = [];
        for (const [sourceTheme, sourceContent] of sourceThemeFiles) {
            for (const [targetTheme, targetContent] of targetThemeFiles) {
                if (sourceTheme !== targetTheme && sourceContent === targetContent) storedMatches.push(`${sourceTheme} matches ${targetTheme}`);
            }
        }
        if (storedMatches.length) {
            setThemeCodeMatches(storedMatches);
            return;
        }

        let cancelled = false;
        void VencordNative.themes.getThemesList().then(themes => {
            if (cancelled) return;

            const contentByName = new Map(themes.map(theme => [theme.fileName, theme.content]));
            const matches: string[] = [];
            for (const sourceTheme of plan.source.themes ?? []) {
                const sourceContent = contentByName.get(sourceTheme);
                if (!sourceContent) continue;

                for (const targetTheme of plan.target.themes ?? []) {
                    if (sourceTheme === targetTheme) continue;
                    const targetContent = contentByName.get(targetTheme);
                    if (targetContent && sourceContent === targetContent) matches.push(`${sourceTheme} matches ${targetTheme}`);
                }
            }
            setThemeCodeMatches(matches);
        }).catch(() => setThemeCodeMatches([]));

        return () => { cancelled = true; };
    }, [plan]);

    if (!plan) {
        return (
            <ModalRoot {...modalProps} size={ModalSize.SMALL}>
                <ModalHeader className="vc-presets-modal-header">
                    <h2 className="vc-presets-modal-title">Merge presets</h2>
                    <ModalCloseButton onClick={modalProps.onClose} />
                </ModalHeader>
                <ModalContent className="vc-presets-modal-content">
                    <Paragraph>One of these presets no longer exists.</Paragraph>
                </ModalContent>
                <ModalFooter className="vc-presets-modal-footer">
                    <Button variant="secondary" onClick={modalProps.onClose}>Close</Button>
                </ModalFooter>
            </ModalRoot>
        );
    }

    const cleanOutputName = outputName.trim();
    const nameTaken = cleanOutputName.length > 0 && hasPreset(cleanOutputName);
    const canMerge = cleanOutputName.length > 0 && !nameTaken;

    const merge = () => {
        if (!canMerge) return;

        const mergedName = mergePresets(sourceName, targetName, decisions, {
            outputName: cleanOutputName,
            deleteSource,
            deleteTarget,
        });

        if (!mergedName) {
            showToast("Preset merge failed. Pick a new preset name.", Toasts.Type.FAILURE);
            return;
        }
        showToast(`Created merged preset "${mergedName}".`, Toasts.Type.SUCCESS);
        onMerged();
        modalProps.onClose();
    };

    return (
        <ModalRoot {...modalProps} size={ModalSize.MEDIUM}>
            <ModalHeader className="vc-presets-modal-header">
                <h2 className="vc-presets-modal-title">Merge into "{targetName}"</h2>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>
            <ModalContent className="vc-presets-modal-content">
                <Paragraph>
                    Drag merge source: <strong>{sourceName}</strong>. Drop target: <strong>{targetName}</strong>. A new merged preset will be created.
                </Paragraph>

                {plan.identical && (
                    <div className="vc-presets-merge-section vc-presets-merge-warning">
                        <strong>These presets are identical</strong>
                        <Paragraph className="vc-presets-dim">Their captured plugins, themes, QuickCSS, DataStore, scope, and restore behavior match. Creating a merged preset will make a duplicate unless you delete one of the originals.</Paragraph>
                    </div>
                )}

                {themeCodeMatches.length > 0 && (
                    <div className="vc-presets-merge-section vc-presets-merge-warning">
                        <strong>Theme code matches found</strong>
                        <Paragraph className="vc-presets-dim">These theme files have identical saved or currently installed CSS:</Paragraph>
                        <div className="vc-presets-merge-list">
                            {themeCodeMatches.map(match => <span key={match} className="vc-presets-merge-chip">{match}</span>)}
                        </div>
                    </div>
                )}

                <div className="vc-presets-merge-section vc-presets-merge-output">
                    <strong>Merged preset</strong>
                    <TextInput value={outputName} onChange={setOutputName} placeholder="Merged preset name" />
                    {nameTaken && <Paragraph className="vc-presets-modal-invalid">That preset name already exists. Pick a new name.</Paragraph>}
                </div>

                <div className="vc-presets-merge-section vc-presets-merge-options">
                    <strong>After merge</strong>
                    <FormSwitch
                        value={deleteSource}
                        onChange={setDeleteSource}
                        title={`Delete source preset (${sourceName})`}
                        description="Removes the preset you dragged after the merged preset is created."
                    />
                    <FormSwitch
                        value={deleteTarget}
                        onChange={setDeleteTarget}
                        title={`Delete target preset (${targetName})`}
                        description="Removes the preset you dropped onto after the merged preset is created."
                    />
                </div>

                {plan.additions.length > 0 && (
                    <div className="vc-presets-merge-section vc-presets-merge-additions">
                        <strong>Additions</strong>
                        <Paragraph className="vc-presets-dim">These do not overlap and will be added automatically.</Paragraph>
                        <div className="vc-presets-merge-list">
                            {plan.additions.map(item => <span key={item} className="vc-presets-merge-chip">{item}</span>)}
                        </div>
                    </div>
                )}

                {plan.overlaps.length > 0 && (
                    <div className="vc-presets-merge-section">
                        <strong>Already matching</strong>
                        <Paragraph className="vc-presets-dim">These are already present or identical.</Paragraph>
                        <div className="vc-presets-merge-list">
                            {plan.overlaps.map(item => <span key={item} className="vc-presets-merge-chip">{item}</span>)}
                        </div>
                    </div>
                )}

                {plan.conflicts.length > 0 ? (
                    <div className="vc-presets-merge-section vc-presets-merge-conflicts">
                        <strong>Resolve overlaps</strong>
                        <Paragraph className="vc-presets-dim">Change each row here before merging if you want to use source settings, disable a plugin, or delete overlapping data.</Paragraph>
                        {plan.conflicts.map(conflict => (
                            <MergeConflictRow
                                key={conflict.id}
                                conflict={conflict}
                                value={decisions[conflict.id] ?? conflict.defaultAction}
                                onChange={value => setDecisions(current => ({ ...current, [conflict.id]: value }))}
                            />
                        ))}
                    </div>
                ) : (
                    <Paragraph className="vc-presets-merge-clean">No conflicts found. This merge is only additions and identical overlaps.</Paragraph>
                )}
            </ModalContent>
            <ModalFooter className="vc-presets-modal-footer vc-presets-merge-footer">
                <div className="vc-presets-merge-footer-inner">
                    <Button onClick={merge} disabled={!canMerge}>Create merged preset</Button>
                    <Button variant="secondary" onClick={modalProps.onClose}>Cancel</Button>
                </div>
            </ModalFooter>
        </ModalRoot>
    );
}

export function openMergeModal(sourceName: string, targetName: string, onMerged: () => void) {
    openModal(modalProps => <MergeModal modalProps={modalProps} sourceName={sourceName} targetName={targetName} onMerged={onMerged} />);
}
