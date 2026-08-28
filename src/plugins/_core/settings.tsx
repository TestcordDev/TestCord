/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings, useSettings } from "@api/Settings";
import { BackupRestoreIcon, BookmarkIcon, CloudIcon, InfoIcon, LogIcon, PaintbrushIcon, PatchHelperIcon, PluginsIcon, SafetyIcon, TestCordIcon, UpdaterIcon } from "@components/Icons";
import {
    BackupAndRestoreTab,
    ChangelogTab,
    CloudTab,
    HealthTab,
    PatchHelperTab,
    PluginsTab,
    PresetsTab,
    PrivacySecurityPanel,
    StatsTab,
    ThemesTab,
    UpdaterTab,
    VencordTab,
} from "@components/settings";
import { gitHashShort } from "@shared/vencordUserAgent";
import { Devs } from "@utils/constants";
import { isTruthy } from "@utils/guards";
import definePlugin, { IconProps, OptionType } from "@utils/types";
import { waitFor } from "@webpack";
import { React, Toasts, useState } from "@webpack/common";
import type { ComponentType, PropsWithChildren, ReactNode } from "react";

const enum LayoutType {
    ROOT = 0,
    SECTION = 1,
    SIDEBAR_ITEM = 2,
    PANEL = 3,
    SPLIT = 4,
    CATEGORY = 5,
    ACCORDION = 6,
    LIST = 7,
    RELATED = 8,
    FIELD_SET = 9,
    TAB_ITEM = 10,
    STATIC = 11,
    BUTTON = 12,
    TOGGLE = 13,
    SLIDER = 14,
    SELECT = 15,
    RADIO = 16,
    NAVIGATOR = 17,
    CUSTOM = 18
}

let LayoutTypes = {
    SECTION: 1,
    SIDEBAR_ITEM: 2,
    PANEL: 3,
    CATEGORY: 5,
    CUSTOM: 19,
};
waitFor(["SECTION", "SIDEBAR_ITEM", "PANEL", "CUSTOM"], v => LayoutTypes = v);

const enum SectionType {
    HEADER = "HEADER",
    DIVIDER = "DIVIDER",
    CUSTOM = "CUSTOM"
}

type SettingsLocation =
    | "top"
    | "aboveNitro"
    | "belowNitro"
    | "aboveActivity"
    | "belowActivity"
    | "bottom";

interface SettingsLayoutNode {
    type: LayoutType;
    key?: string;
    legacySearchKey?: string;
    getLegacySearchKey?(): string;
    useLabel?(): string;
    useTitle?(): string;
    buildLayout?(): SettingsLayoutNode[];
    icon?(): ReactNode;
    render?(): ReactNode;
    StronglyDiscouragedCustomComponent?(): ReactNode;
}

interface EntryOptions {
    key: string;
    title: string;
    panelTitle?: string;
    Component: ComponentType<{}>;
    Icon: ComponentType<IconProps>;
}

interface TestcordTabDescriptor {
    key: string;
    title: string;
    Icon?: ComponentType<IconProps>;
    locked?: boolean;
}

interface SettingsLayoutBuilder {
    key?: string;
    buildLayout(): SettingsLayoutNode[];
}

const TESTCORD_MAIN_ENTRY_KEY = "equicord_main";

// PURE: no writes. Must return the same result no matter which caller (editor
// or sidebar sync) runs first, otherwise the editor row and the live sidebar
// disagree about a tab's visibility. "Newness" is recorded only at save time
// (see markKnownTestcordTabs in saveVisibleTabs), never here.
function readVisibleTestcordTabs(validKeys: string[]) {
    const stored = settings.store.visibleSettingsTabs;

    // No customization yet -> everything visible.
    if (!Array.isArray(stored) || stored.length === 0) return validKeys;

    const validKeySet = new Set(validKeys);
    const visible = stored.filter((key): key is string => typeof key === "string" && validKeySet.has(key));

    // A valid key absent from the allowlist is either explicitly hidden (it's
    // in the "known" set) or brand-new (never seen -> default visible).
    const known = readKnownTestcordTabs();
    const newKeys = validKeys.filter(key => !known.has(key) && !visible.includes(key));

    const withNew = [...visible, ...newKeys];

    return withNew.includes(TESTCORD_MAIN_ENTRY_KEY)
        ? withNew
        : [TESTCORD_MAIN_ENTRY_KEY, ...withNew];
}

function writeVisibleTestcordTabs(keys: string[]) {
    settings.store.visibleSettingsTabs = keys;
}

function readKnownTestcordTabs() {
    const stored = settings.store.knownSettingsTabs;
    return new Set(Array.isArray(stored)
        ? stored.filter((key): key is string => typeof key === "string")
        : []);
}

function writeKnownTestcordTabs(keys: string[]) {
    settings.store.knownSettingsTabs = keys;
}

// Merge the given keys into the persisted "known" set (union, order-preserving).
function markKnownTestcordTabs(keys: string[]) {
    const known = readKnownTestcordTabs();
    const additions = keys.filter(key => !known.has(key));
    if (additions.length > 0) {
        writeKnownTestcordTabs([...known, ...additions]);
    }
}

function readTestcordTabOrder(validKeys: string[]) {
    const stored = settings.store.settingsTabOrder;
    const validKeySet = new Set(validKeys);
    const ordered = Array.isArray(stored)
        ? stored.filter((key): key is string => typeof key === "string" && validKeySet.has(key))
        : [];

    return [...ordered, ...validKeys.filter(key => !ordered.includes(key))];
}

function writeTestcordTabOrder(keys: string[]) {
    settings.store.settingsTabOrder = keys;
}

function readPinnedTestcordTabs(validKeys: string[]) {
    const validKeySet = new Set(validKeys.filter(key => key !== TESTCORD_MAIN_ENTRY_KEY));
    const stored = settings.store.pinnedSettingsTabs;

    return Array.isArray(stored)
        ? stored.filter((key): key is string => typeof key === "string" && validKeySet.has(key))
        : [];
}

function writePinnedTestcordTabs(keys: string[]) {
    settings.store.pinnedSettingsTabs = keys;
}

function orderTestcordTabs<T extends { key?: string; }>(tabs: T[], orderedKeys: string[], pinnedKeys: string[]) {
    const orderIndex = new Map(orderedKeys.map((key, index) => [key, index]));
    const pinnedKeySet = new Set(pinnedKeys);

    return [...tabs].sort((a, b) => {
        if (a.key === TESTCORD_MAIN_ENTRY_KEY) return -1;
        if (b.key === TESTCORD_MAIN_ENTRY_KEY) return 1;

        const pinnedDiff = Number(pinnedKeySet.has(b.key!)) - Number(pinnedKeySet.has(a.key!));
        if (pinnedDiff !== 0) return pinnedDiff;

        return (orderIndex.get(a.key!) ?? Number.MAX_SAFE_INTEGER) - (orderIndex.get(b.key!) ?? Number.MAX_SAFE_INTEGER);
    });
}

function showTestcordUndoToast(message: string, undo: () => void) {
    Toasts.show({
        message,
        id: Toasts.genId(),
        type: Toasts.Type.MESSAGE,
        options: {
            duration: 5000,
            position: Toasts.Position.BOTTOM,
            component: (
                <div className="vc-testcord-tab-editor-toast">
                    <span>{message}</span>
                    <button
                        type="button"
                        onClick={() => {
                            undo();
                            Toasts.pop();
                        }}
                    >
                        Undo
                    </button>
                </div>
            )
        }
    });
}

function getTestcordTabDescriptors(entries: SettingsLayoutNode[]): TestcordTabDescriptor[] {
    return entries.map(entry => ({
        key: entry.key!,
        title: entry.useTitle!(),
        Icon: entry.icon ? ((props: any) => {
            try {
                return entry.icon!() as any;
            } catch {
                return null;
            }
        }) as ComponentType<IconProps> : undefined,
        locked: entry.key === TESTCORD_MAIN_ENTRY_KEY
    }));
}

function syncVisibleTestcordSidebarTabs(tabs: TestcordTabDescriptor[], visibleKeys: string[], orderedKeys = readTestcordTabOrder(tabs.map(tab => tab.key)), pinnedKeys = readPinnedTestcordTabs(tabs.map(tab => tab.key))) {
    const tabByTitle = new Map(tabs.map(tab => [tab.title, tab]));
    const visibleKeySet = new Set(visibleKeys);
    const orderIndex = new Map(orderTestcordTabs(tabs, orderedKeys, pinnedKeys).map((tab, index) => [tab.key, index]));
    let attempts = 0;

    function sync() {
        const candidates = Array.from(document.querySelectorAll<HTMLElement>('[role="button"], [role="tab"], [class*="item"]'));
        let matched = 0;

        for (const candidate of candidates) {
            if (candidate.closest(".vc-testcord-tab-editor")) continue;

            const title = candidate.textContent?.replace(/\s+/g, " ").trim();
            if (!title) continue;

            const tab = tabByTitle.get(title);
            if (!tab) continue;

            matched++;
            candidate.classList.add("vc-testcord-managed-settings-tab");
            candidate.classList.toggle("vc-testcord-hidden-settings-tab", !visibleKeySet.has(tab.key));
            candidate.style.order = String(orderIndex.get(tab.key) ?? 0);
        }

        if (matched < tabs.length && attempts++ < 10) requestAnimationFrame(sync);
    }

    requestAnimationFrame(sync);
}

function TestcordTabsEditor({ tabs }: { tabs: TestcordTabDescriptor[]; }) {
    const validKeys = tabs.map(tab => tab.key);
    const [isEditing, setIsEditing] = useState(false);
    const [visibleKeys, setVisibleKeys] = useState(() => readVisibleTestcordTabs(validKeys));
    const [orderedKeys, setOrderedKeys] = useState(() => readTestcordTabOrder(validKeys));
    const [pinnedKeys, setPinnedKeys] = useState(() => readPinnedTestcordTabs(validKeys));
    const [draggingKey, setDraggingKey] = useState<string | null>(null);
    const [dragOverKey, setDragOverKey] = useState<string | null>(null);
    const [suppressNextClick, setSuppressNextClick] = useState(false);

    const visibleKeySet = new Set(visibleKeys);
    const pinnedKeySet = new Set(pinnedKeys);
    const editableKeys = tabs.filter(tab => !tab.locked).map(tab => tab.key);
    const areAllEditableTabsVisible = editableKeys.every(key => visibleKeySet.has(key));
    const hiddenCount = tabs.length - visibleKeySet.size;
    const orderedTabs = orderTestcordTabs(tabs, orderedKeys, pinnedKeys);
    const previewTabs = orderedTabs.filter(tab => visibleKeySet.has(tab.key));

    function sync(nextVisibleKeys = visibleKeys, nextOrderedKeys = orderedKeys, nextPinnedKeys = pinnedKeys) {
        syncVisibleTestcordSidebarTabs(tabs, nextVisibleKeys, nextOrderedKeys, nextPinnedKeys);
    }

    function saveVisibleTabs(nextKeys: string[], undoMessage?: string) {
        const previousKeys = visibleKeys;
        const nextVisibleKeys = nextKeys.includes(TESTCORD_MAIN_ENTRY_KEY)
            ? nextKeys
            : [TESTCORD_MAIN_ENTRY_KEY, ...nextKeys];

        // Every tab currently valid has now been presented to the user and had a
        // chance to be toggled, so mark them all known. This is what keeps a
        // just-hidden tab hidden on the next (pure) read, while any tab
        // registered AFTER this save is still "new" and defaults to visible.
        markKnownTestcordTabs(validKeys);

        setVisibleKeys(nextVisibleKeys);
        writeVisibleTestcordTabs(nextVisibleKeys);
        sync(nextVisibleKeys);

        if (undoMessage) {
            showTestcordUndoToast(undoMessage, () => {
                setVisibleKeys(previousKeys);
                writeVisibleTestcordTabs(previousKeys);
                sync(previousKeys);
            });
        }
    }

    function saveOrder(nextOrderedKeys: string[]) {
        setOrderedKeys(nextOrderedKeys);
        writeTestcordTabOrder(nextOrderedKeys);
        sync(visibleKeys, nextOrderedKeys);
    }

    function savePinnedTabs(nextPinnedKeys: string[]) {
        setPinnedKeys(nextPinnedKeys);
        writePinnedTestcordTabs(nextPinnedKeys);
        sync(visibleKeys, orderedKeys, nextPinnedKeys);
    }

    function toggleEditorMode() {
        if (!isEditing) {
            setVisibleKeys(readVisibleTestcordTabs(validKeys));
            setOrderedKeys(readTestcordTabOrder(validKeys));
            setPinnedKeys(readPinnedTestcordTabs(validKeys));
        }

        setIsEditing(!isEditing);
    }

    function toggleTab(key: string, title: string) {
        const nextKeys = visibleKeySet.has(key)
            ? visibleKeys.filter(visibleKey => visibleKey !== key)
            : [...visibleKeys, key];

        saveVisibleTabs(nextKeys, visibleKeySet.has(key) ? `${title} hidden` : undefined);
    }

    function toggleAllTabs() {
        saveVisibleTabs(
            areAllEditableTabsVisible ? [TESTCORD_MAIN_ENTRY_KEY] : validKeys,
            areAllEditableTabsVisible ? "All editable tabs hidden" : undefined
        );
    }

    function togglePinnedTab(key: string) {
        savePinnedTabs(pinnedKeySet.has(key)
            ? pinnedKeys.filter(pinnedKey => pinnedKey !== key)
            : [...pinnedKeys, key]
        );
    }

    function reorderTab(targetKey: string) {
        if (!draggingKey || draggingKey === targetKey) return;

        const nextOrderedKeys = orderedKeys.filter(key => key !== draggingKey);
        const targetIndex = nextOrderedKeys.indexOf(targetKey);
        nextOrderedKeys.splice(targetIndex === -1 ? nextOrderedKeys.length : targetIndex, 0, draggingKey);
        saveOrder(nextOrderedKeys);
    }

    function markDropTarget(event: React.DragEvent<HTMLElement>, key: string, locked?: boolean) {
        if (locked || !draggingKey) return;

        event.preventDefault();
        event.stopPropagation();
        setDragOverKey(key);
    }

    function dropOnTab(event: React.DragEvent<HTMLElement>, key: string) {
        event.preventDefault();
        event.stopPropagation();
        reorderTab(key);
        setDraggingKey(null);
        setDragOverKey(null);
    }

    function restoreOriginalLayout() {
        setVisibleKeys(validKeys);
        setOrderedKeys(validKeys);
        setPinnedKeys([]);
        writeVisibleTestcordTabs(validKeys);
        writeTestcordTabOrder(validKeys);
        writePinnedTestcordTabs([]);
        sync(validKeys, validKeys, []);
    }

    function setDragImage(event: React.DragEvent<HTMLElement>) {
        const chip = event.currentTarget.closest(".vc-testcord-tab-editor-chip") as HTMLElement | null;
        if (!chip) return;

        const chipStyles = getComputedStyle(chip);
        const clone = chip.cloneNode(true) as HTMLElement;
        clone.classList.add("vc-testcord-tab-editor-drag-image");
        clone.style.color = "#fff";
        clone.style.background = chipStyles.backgroundColor;
        clone.querySelectorAll<HTMLElement>("*").forEach(element => {
            element.style.color = "#fff";
        });
        clone.querySelectorAll<HTMLElement>(".vc-testcord-tab-editor-chip-state, .vc-testcord-tab-editor-pin").forEach(element => {
            element.style.color = "#fff";
            element.style.background = getComputedStyle(element).backgroundColor;
        });
        clone.querySelectorAll<SVGElement>("svg").forEach(svg => {
            svg.style.color = "#fff";
            svg.style.fill = "currentcolor";
        });
        document.body.append(clone);
        clone.getBoundingClientRect();
        event.dataTransfer.setDragImage(clone, clone.offsetWidth / 2, clone.offsetHeight / 2);
        setTimeout(() => clone.remove(), 100);
    }

    return (
        <div className={`vc-testcord-tab-editor ${isEditing ? "vc-testcord-tab-editor-open" : ""} ${draggingKey ? "vc-testcord-tab-editor-is-dragging" : ""}`}>
            <div className="vc-testcord-tab-editor-title-row">
                <div>
                    <div className="vc-testcord-tab-editor-kicker">Settings tabs</div>
                    <h2 className="vc-testcord-tab-editor-title">Testcord</h2>
                </div>
                <button
                    type="button"
                    className={`vc-testcord-tab-editor-toggle ${isEditing ? "vc-testcord-tab-editor-toggle-on" : ""}`}
                    onClick={toggleEditorMode}
                >
                    <span className="vc-testcord-tab-editor-toggle-dot" />
                    {isEditing ? "Done" : "Editor Mode"}
                </button>
            </div>
            <div className="vc-testcord-tab-editor-panel" aria-hidden={!isEditing}>
                <div className="vc-testcord-tab-editor-panel-inner">
                    <div className="vc-testcord-tab-editor-copy">
                        Choose which tabs stay under Testcord. Hidden tabs are saved and can be added back here anytime.
                        Changes apply instantly.
                        {hiddenCount > 0 && ` ${hiddenCount} hidden.`}
                    </div>
                    <div className="vc-testcord-tab-editor-preview">
                        <div className="vc-testcord-tab-editor-preview-title">Sidebar Preview</div>
                        <div className="vc-testcord-tab-editor-preview-list">
                            {previewTabs.map(({ key, title, Icon }) => (
                                <span key={key} className="vc-testcord-tab-editor-preview-item">
                                    {Icon && <Icon width={14} height={14} />}
                                    {pinnedKeySet.has(key) && <span className="vc-testcord-tab-editor-preview-pin">Pinned</span>}
                                    {title}
                                </span>
                            ))}
                        </div>
                    </div>
                    <div className="vc-testcord-tab-editor-grid">
                        {orderedTabs.map(({ key, title, Icon, locked }) => {
                            const enabled = visibleKeySet.has(key);
                            const pinned = pinnedKeySet.has(key);

                            return (
                                <div
                                    key={key}
                                    role="button"
                                    tabIndex={locked ? -1 : 0}
                                    draggable={!locked}
                                    className={`vc-testcord-tab-editor-chip ${enabled ? "vc-testcord-tab-editor-chip-on" : ""} ${draggingKey === key ? "vc-testcord-tab-editor-chip-dragging" : ""} ${dragOverKey === key && draggingKey !== key ? "vc-testcord-tab-editor-chip-drop-target" : ""}`}
                                    aria-disabled={locked}
                                    onClick={() => {
                                        if (suppressNextClick) {
                                            setSuppressNextClick(false);
                                            return;
                                        }

                                        if (!locked) toggleTab(key, title);
                                    }}
                                    onDragStart={event => {
                                        if (locked) return;

                                        setSuppressNextClick(true);
                                        setDraggingKey(key);
                                        setDragImage(event);
                                        event.dataTransfer.effectAllowed = "move";
                                        event.dataTransfer.setData("text/plain", key);
                                    }}
                                    onDragOver={event => {
                                        markDropTarget(event, key, locked);
                                    }}
                                    onDragEnter={event => {
                                        markDropTarget(event, key, locked);
                                    }}
                                    onDragLeave={() => dragOverKey === key && setDragOverKey(null)}
                                    onDrop={event => dropOnTab(event, key)}
                                    onDragEnd={() => {
                                        setDraggingKey(null);
                                        setDragOverKey(null);
                                    }}
                                >
                                    <span
                                        className="vc-testcord-tab-editor-drag-handle"
                                        aria-hidden
                                        onClick={event => event.stopPropagation()}
                                        onDragOver={event => markDropTarget(event, key, locked)}
                                        onDragEnter={event => markDropTarget(event, key, locked)}
                                        onDrop={event => dropOnTab(event, key)}
                                    >
                                        ::
                                    </span>
                                    {Icon && <Icon width={18} height={18} />}
                                    <span className="vc-testcord-tab-editor-chip-title">{title}</span>
                                    {!locked && (
                                        <button
                                            type="button"
                                            className={`vc-testcord-tab-editor-pin ${pinned ? "vc-testcord-tab-editor-pin-on" : ""}`}
                                            onClick={event => {
                                                event.stopPropagation();
                                                togglePinnedTab(key);
                                            }}
                                            onDragOver={event => markDropTarget(event, key, locked)}
                                            onDragEnter={event => markDropTarget(event, key, locked)}
                                            onDrop={event => dropOnTab(event, key)}
                                        >
                                            {pinned ? "Pinned" : "Pin"}
                                        </button>
                                    )}
                                    <span
                                        className="vc-testcord-tab-editor-chip-state"
                                        onDragOver={event => markDropTarget(event, key, locked)}
                                        onDragEnter={event => markDropTarget(event, key, locked)}
                                        onDrop={event => dropOnTab(event, key)}
                                    >
                                        {locked ? "Locked" : enabled ? "On" : "Off"}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                    <button
                        type="button"
                        className="vc-testcord-tab-editor-show-all"
                        onClick={toggleAllTabs}
                    >
                        {areAllEditableTabsVisible ? "Toggle all off" : "Add all tabs back"}
                    </button>
                    <button
                        type="button"
                        className="vc-testcord-tab-editor-restore"
                        onClick={restoreOriginalLayout}
                    >
                        Restore original layout
                    </button>
                </div>
            </div>
        </div>
    );
}

const settings = definePluginSettings({
    settingsLocation: {
        type: OptionType.SELECT,
        description: "Where to put the Testcord settings section",
        options: [
            { label: "At the very top", value: "top" },
            { label: "Above Billing section", value: "aboveNitro", default: true },
            { label: "Below Billing section", value: "belowNitro" },
            { label: "Above Games & Apps Settings", value: "aboveActivity" },
            { label: "Below Games & Apps Settings", value: "belowActivity" },
            { label: "At the very bottom", value: "bottom" },
        ] as { label: string; value: SettingsLocation; default?: boolean; }[]
    },
    includeVencordInfoWhenCopying: {
        type: OptionType.BOOLEAN,
        description: "Also copy Equicord info (Equicord, Electron, Chromium) when clicking the version info in the bottom left area of the Settings page",
        default: true
    },
    visibleSettingsTabs: {
        type: OptionType.CUSTOM,
        description: "Visible Testcord settings tabs",
        hidden: true,
        default: [] as string[]
    },
    knownSettingsTabs: {
        type: OptionType.CUSTOM,
        description: "Testcord settings tabs the editor has already seen",
        hidden: true,
        default: [] as string[]
    },
    settingsTabOrder: {
        type: OptionType.CUSTOM,
        description: "Testcord settings tab order",
        hidden: true,
        default: [] as string[]
    },
    pinnedSettingsTabs: {
        type: OptionType.CUSTOM,
        description: "Pinned Testcord settings tabs",
        hidden: true,
        default: [] as string[]
    },
    experimentalDataStoreExport: {
        type: OptionType.BOOLEAN,
        description: "Force export and import of DataStore even when it's too large. Uses chunked processing to avoid memory issues.",
        default: false
    }
});

function TestCordDiscordIcon({ original }: { original: any; }) {
    const { useTestcordIcon } = useSettings(["useTestcordIcon"]);
    return useTestcordIcon ? <TestCordIcon size={35} /> : original;
}

export default definePlugin({
    name: "Settings",
    description: "Adds Settings UI and debug info",
    authors: [Devs.Ven, Devs.Megu],
    tags: ["Utility"],
    required: true,

    settings,

    patches: [
        {
            find: "#{intl::COPY_VERSION}",
            noWarn: true,
            replacement: [
                {
                    match: /\.RELEASE_CHANNEL/,
                    replace: "$&.replace(/^./, c => c.toUpperCase())"
                },
                {
                    match: /"text-xxs\/normal".{0,300}?(?=null!=(\i)&&(.{0,20}\i\.\i.{0,200}?,children:).{0,15}?("span"),{className:(\i\.\i),children:\["Build Override: ",\1\.id,\i\]\}\)\}\))/,
                    replace: (m, _buildOverride, makeRow, component, className) => {
                        return `${m},$self.makeInfoElements(${component},${className}).map(e=>${makeRow}e})),`;
                    }
                },
                {
                    match: /copyValue:\i\.join\(" "\)/g,
                    replace: "$& + $self.getInfoString()"
                }
            ]
        },
        {
            find: ".buildLayout().map",
            noWarn: true,
            replacement: {
                match: /(\i)\.buildLayout\(\)(?=\.map)/,
                replace: "$self.buildLayout($1)"
            }
        },
        {
            find: "#{intl::DISCODO_DISABLED}",
            noWarn: true,
            replacement: {
                match: /(?<=BUTTON_HOME.{0,10}children:)(\(0,\i.jsxs?\)\(\i,{}\))/,
                replace: "$self.renderDiscordIcon($1)"
            }
        }
    ],

    buildEntry(options: EntryOptions): SettingsLayoutNode {
        const { key, title, panelTitle = title, Component, Icon } = options;

        const panel: SettingsLayoutNode = {
            key: key + "_panel",
            type: LayoutTypes.PANEL,
            useTitle: () => panelTitle,
            buildLayout: () => [{
                type: LayoutTypes.CATEGORY,
                key: key + "_category",
                buildLayout: () => [{
                    type: LayoutTypes.CUSTOM,
                    key: key + "_custom",
                    Component: Component,
                    useSearchTerms: () => [title]
                }]
            }]
        };

        return ({
            key,
            type: LayoutTypes.SIDEBAR_ITEM,
            useTitle: () => title,
            icon: Icon ? () => <Icon width={20} height={20} /> : undefined,
            buildLayout: () => [panel]
        });
    },

    buildLayout(originalLayoutBuilder: SettingsLayoutBuilder) {
        const layout = originalLayoutBuilder.buildLayout();
        if (originalLayoutBuilder.key !== "$Root") return layout;
        if (!Array.isArray(layout)) return layout;
        if (layout.some(s => s?.key === "equicord_section")) return layout;

        const { buildEntry } = this;

        const equicordEntries: SettingsLayoutNode[] = [
            buildEntry({
                key: TESTCORD_MAIN_ENTRY_KEY,
                title: "Testcord",
                panelTitle: "Testcord Settings",
                Component: () => <>
                    <TestcordTabsEditor
                        tabs={getTestcordTabDescriptors(equicordEntries)}
                    />
                    <VencordTab />
                </>,
                Icon: TestCordIcon as any
            }),
            buildEntry({
                key: "testcord_privacy_security",
                title: "Privacy & Security",
                panelTitle: "Privacy & Security Command Center",
                Component: PrivacySecurityPanel,
                Icon: SafetyIcon
            }),
            buildEntry({
                key: "equicord_plugins",
                title: "Plugins",
                Component: PluginsTab,
                Icon: PluginsIcon
            }),
            buildEntry({
                key: "equicord_themes",
                title: "Themes",
                Component: ThemesTab,
                Icon: PaintbrushIcon
            }),
            !IS_UPDATER_DISABLED && UpdaterTab && buildEntry({
                key: "equicord_updater",
                title: "Updater",
                panelTitle: "TestCord Updater",
                Component: UpdaterTab,
                Icon: UpdaterIcon
            }),
            buildEntry({
                key: "equicord_changelog",
                title: "Changelog",
                Component: ChangelogTab,
                Icon: LogIcon,
            }),
            buildEntry({
                key: "testcord_stats",
                title: "Stats",
                panelTitle: "TestCord Stats",
                Component: StatsTab,
                Icon: InfoIcon,
            }),
            buildEntry({
                key: "testcord_health",
                title: "Plugin Health",
                panelTitle: "Plugin Health",
                Component: HealthTab,
                Icon: SafetyIcon,
            }),
            buildEntry({
                key: "testcord_presets",
                title: "Presets",
                panelTitle: "TestCord Presets",
                Component: PresetsTab,
                Icon: BookmarkIcon,
            }),
            buildEntry({
                key: "equicord_cloud",
                title: "Cloud",
                panelTitle: "Equicord Cloud",
                Component: CloudTab,
                Icon: CloudIcon
            }),
            buildEntry({
                key: "equicord_backup_restore",
                title: "Backup & Restore",
                Component: BackupAndRestoreTab,
                Icon: BackupRestoreIcon
            }),
            !IS_STANDALONE && PatchHelperTab && buildEntry({
                key: "equicord_patch_helper",
                title: "Patch Helper",
                Component: PatchHelperTab,
                Icon: PatchHelperIcon
            }),
            ...this.customEntries.map(buildEntry)
        ].filter(isTruthy);

        const orderedEquicordEntries = orderTestcordTabs(
            equicordEntries,
            readTestcordTabOrder(equicordEntries.map(entry => entry.key!)),
            readPinnedTestcordTabs(equicordEntries.map(entry => entry.key!))
        );

        syncVisibleTestcordSidebarTabs(
            getTestcordTabDescriptors(equicordEntries),
            readVisibleTestcordTabs(equicordEntries.map(entry => entry.key!))
        );

        const equicordSection: SettingsLayoutNode = {
            key: "equicord_section",
            type: LayoutTypes.SECTION,
            useTitle: () => "TestCord Settings",
            buildLayout: () => orderedEquicordEntries
        };

        const { settingsLocation } = settings.store;

        const places: Record<SettingsLocation, string> = {
            top: "user_section",
            aboveNitro: "billing_section",
            belowNitro: "billing_section",
            aboveActivity: "games_and_apps_section",
            belowActivity: "games_and_apps_section",
            bottom: "utility_section"
        };

        const key = places[settingsLocation] ?? places.top;
        let idx = layout.findIndex(s => typeof s?.key === "string" && s.key === key);

        if (idx === -1) {
            idx = 2;
        } else if (settingsLocation.startsWith("below")) {
            idx += 1;
        }

        layout.splice(idx, 0, equicordSection);

        return layout;
    },

    customSections: [] as ((SectionTypes: Record<string, string>) => { section: string; element: ComponentType; label: string; id?: string; })[],
    customEntries: [] as EntryOptions[],

    get electronVersion() {
        return VencordNative.native.getVersions().electron ?? window.legcord?.electron ?? null;
    },

    get chromiumVersion() {
        try {
            return (
                VencordNative.native.getVersions().chrome ??
                // @ts-expect-error userAgentData types
                navigator.userAgentData?.brands?.find(
                    (b: { brand: string; }) => b.brand === "Chromium" || b.brand === "Google Chrome",
                )?.version ??
                null
            );
        } catch {
            return null;
        }
    },

    getVersionInfo(support = true) {
        let version = "";

        if (IS_DEV) version = "Dev Build";
        if (IS_WEB) version = "Web";
        if (IS_VESKTOP) version = `Vesktop v${VesktopNative.app.getVersion()}`;
        if (IS_EQUIBOP) version = `Equibop v${VesktopNative.app.getVersion()}`;
        if (IS_STANDALONE) version = "Standalone";

        return support && version ? ` (${version})` : version;
    },

    getInfoRows() {
        const { electronVersion, chromiumVersion, getVersionInfo } = this;

        const rows = [`TestCord ${gitHashShort}${getVersionInfo()}`];

        if (electronVersion) rows.push(`Electron ${electronVersion}`);
        if (chromiumVersion) rows.push(`Chromium ${chromiumVersion}`);

        return rows;
    },

    getInfoString() {
        if (!settings.store.includeVencordInfoWhenCopying) return "";
        return "\n" + this.getInfoRows().join("\n");
    },

    makeInfoElements(Component: ComponentType<PropsWithChildren<{ className?: string; }>>, className: string) {
        return this.getInfoRows().map((text, i) =>
            <Component key={i} className={className}>{text}</Component>
        );
    },

    renderDiscordIcon(originalIcon: any) {
        return <TestCordDiscordIcon original={originalIcon} />;
    },
});
