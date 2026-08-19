/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
export const workspaceIndices = [1, 2, 3, 4, 5, 6, 7, 8, 9];
export const workspaceActions = workspaceIndices.map(index => `workspace${index}`);
export const moveToWorkspaceActions = workspaceIndices.map(index => `moveToWorkspace${index}`);
const codeAliases = {
    SPACE: ["Space"],
    ENTER: ["Enter", "NumpadEnter"],
    TAB: ["Tab"],
    ESC: ["Escape"],
    ESCAPE: ["Escape"],
    LEFT: ["ArrowLeft"],
    RIGHT: ["ArrowRight"],
    UP: ["ArrowUp"],
    DOWN: ["ArrowDown"],
    "[": ["BracketLeft"],
    "]": ["BracketRight"],
    ";": ["Semicolon"],
    "'": ["Quote"],
    ",": ["Comma"],
    ".": ["Period"],
    "/": ["Slash"],
    "\\": ["Backslash"],
    "-": ["Minus", "NumpadSubtract"],
    "=": ["Equal", "NumpadAdd"],
    "`": ["Backquote"],
};
const normalizeKey = (key) => key === " " ? "SPACE" : key.toUpperCase();
function getCodeAliasesForToken(token) {
    const aliases = [...(codeAliases[token] ?? [])];
    if (/^[A-Z]$/.test(token))
        aliases.push(`Key${token}`);
    if (/^\d$/.test(token)) {
        aliases.push(`Digit${token}`);
        aliases.push(`Numpad${token}`);
    }
    return aliases;
}
function matchesKeyToken(event, token) {
    if (normalizeKey(event.key) === token)
        return true;
    const aliases = getCodeAliasesForToken(token);
    return aliases.includes(event.code);
}
export function parseKeybind(input) {
    if (!input)
        return null;
    const parts = input.split("+").map(part => part.trim().toUpperCase()).filter(Boolean);
    if (!parts.length)
        return null;
    const parsed = {
        ctrl: false,
        alt: false,
        shift: false,
        meta: false,
        key: ""
    };
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (part === "CTRL" || part === "CONTROL") {
            parsed.ctrl = true;
            continue;
        }
        if (part === "ALT") {
            parsed.alt = true;
            continue;
        }
        if (part === "SHIFT") {
            parsed.shift = true;
            continue;
        }
        if (part === "META" || part === "CMD" || part === "SUPER" || part === "WIN") {
            parsed.meta = true;
            continue;
        }
        parsed.key = part === "RETURN" ? "ENTER" : part;
    }
    return parsed.key ? parsed : null;
}
export function matchesKeybind(event, input) {
    const parsed = parseKeybind(input);
    if (!parsed)
        return false;
    return parsed.ctrl === event.ctrlKey
        && parsed.alt === event.altKey
        && parsed.shift === event.shiftKey
        && parsed.meta === event.metaKey
        && matchesKeyToken(event, parsed.key);
}
const baseDefaultKeybinds = {
    openCurrent: "ALT+SHIFT+T",
    closeFocused: "ALT+SHIFT+Q",
    layoutDwindle: "ALT+SHIFT+M",
    layoutGrid: "ALT+SHIFT+G",
    layoutColumns: "ALT+SHIFT+C",
    layoutMaster: "ALT+SHIFT+V",
    cycleLayout: "ALT+SHIFT+SPACE",
    focusLeft: "ALT+SHIFT+H",
    focusRight: "ALT+SHIFT+L",
    focusUp: "ALT+SHIFT+K",
    focusDown: "ALT+SHIFT+J",
    focusPrevious: "ALT+SHIFT+P",
    swapLeft: "ALT+SHIFT+CTRL+H",
    swapRight: "ALT+SHIFT+CTRL+L",
    swapUp: "ALT+SHIFT+CTRL+K",
    swapDown: "ALT+SHIFT+CTRL+J",
    focusMaster: "ALT+SHIFT+RETURN",
    swapWithMaster: "ALT+SHIFT+CTRL+RETURN",
    masterRatioDown: "ALT+SHIFT+[",
    masterRatioUp: "ALT+SHIFT+]",
    nextTab: "ALT+SHIFT+.",
    prevTab: "ALT+SHIFT+,",
    newTabGroup: "ALT+SHIFT+N",
    toggleOverview: "ALT+SHIFT+O",
    toggleAutoLayout: "ALT+SHIFT+A",
    toggleFloat: "ALT+SHIFT+F",
    togglePin: "ALT+SHIFT+Y",
    jumpPinned: "ALT+SHIFT+CTRL+Y",
    reloadRules: "ALT+SHIFT+R",
};
const workspaceDefaultKeybinds = Object.fromEntries(workspaceIndices.map(index => [`workspace${index}`, `ALT+SHIFT+${index}`]));
const moveToWorkspaceDefaultKeybinds = Object.fromEntries(workspaceIndices.map(index => [`moveToWorkspace${index}`, `ALT+SHIFT+CTRL+${index}`]));
export const defaultKeybinds = {
    ...baseDefaultKeybinds,
    ...workspaceDefaultKeybinds,
    ...moveToWorkspaceDefaultKeybinds,
};
const baseActionLabels = {
    openCurrent: "Open Current as Tile",
    closeFocused: "Close Focused Tile",
    layoutDwindle: "Switch to Dwindle Layout",
    layoutGrid: "Switch to Grid Layout",
    layoutColumns: "Switch to Columns Layout",
    layoutMaster: "Switch to Master Layout",
    cycleLayout: "Cycle Layout",
    focusLeft: "Focus Left",
    focusRight: "Focus Right",
    focusUp: "Focus Up",
    focusDown: "Focus Down",
    focusPrevious: "Focus Previous Tile",
    swapLeft: "Swap Left",
    swapRight: "Swap Right",
    swapUp: "Swap Up",
    swapDown: "Swap Down",
    focusMaster: "Focus Master Tile",
    swapWithMaster: "Swap with Master",
    masterRatioDown: "Decrease Master Ratio",
    masterRatioUp: "Increase Master Ratio",
    nextTab: "Next Tab in Group",
    prevTab: "Previous Tab in Group",
    newTabGroup: "Move Focused Tile into a New Group",
    toggleOverview: "Toggle Workspace Overview",
    toggleAutoLayout: "Toggle Auto Layout",
    toggleFloat: "Toggle Floating",
    togglePin: "Toggle Pin",
    jumpPinned: "Jump Between Pinned Tiles",
    reloadRules: "Reload Rules",
};
const workspaceActionLabels = Object.fromEntries(workspaceIndices.map(index => [`workspace${index}`, `Switch to Workspace ${index}`]));
const moveToWorkspaceActionLabels = Object.fromEntries(workspaceIndices.map(index => [`moveToWorkspace${index}`, `Move Tile to Workspace ${index}`]));
export const actionLabels = {
    ...baseActionLabels,
    ...workspaceActionLabels,
    ...moveToWorkspaceActionLabels,
};
export const hotkeySections = [
    {
        label: "Tiles",
        actions: ["openCurrent", "closeFocused", "toggleFloat", "togglePin", "jumpPinned"]
    },
    {
        label: "Focus",
        actions: ["focusLeft", "focusRight", "focusUp", "focusDown", "focusPrevious", "focusMaster"]
    },
    {
        label: "Swap",
        actions: ["swapLeft", "swapRight", "swapUp", "swapDown", "swapWithMaster"]
    },
    {
        label: "Tabs",
        actions: ["nextTab", "prevTab", "newTabGroup"]
    },
    {
        label: "Layout",
        actions: ["layoutDwindle", "layoutGrid", "layoutColumns", "layoutMaster", "cycleLayout", "toggleAutoLayout", "masterRatioDown", "masterRatioUp"]
    },
    {
        label: "Workspace",
        actions: ["toggleOverview", "reloadRules", ...workspaceActions, ...moveToWorkspaceActions]
    }
];
export const allActions = Object.keys(defaultKeybinds);
export function getKeybindSettingKey(action) {
    return `${action}Keybind`;
}
export function isEditableTarget(target) {
    if (!(target instanceof HTMLElement))
        return false;
    if (target.isContentEditable)
        return true;
    const tag = target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
