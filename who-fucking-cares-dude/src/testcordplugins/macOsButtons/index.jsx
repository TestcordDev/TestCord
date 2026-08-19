/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import definePlugin from "@utils/types";
const Native = VencordNative.pluginHelpers.MacOsButtons;
const CSS = `
#macos-window-controls {
    position: fixed;
    top: 0;
    right: 0;
    height: 32px;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 16px;
    -webkit-app-region: no-drag !important;
    pointer-events: all !important;
}

.macos-btn {
    width: 13px;
    height: 13px;
    border-radius: 50%;
    border: none;
    cursor: pointer !important;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    outline: none;
    padding: 0;
    position: relative;
    -webkit-app-region: no-drag;
    pointer-events: all;
}

.macos-btn-icon {
    opacity: 0;
    transition: opacity 0.1s ease;
    position: absolute;
    pointer-events: none;
    display: flex;
    align-items: center;
    justify-content: center;
}

#macos-window-controls:hover .macos-btn-icon {
    opacity: 1;
}

.macos-btn-close  { background: #ff5f57; box-shadow: 0 0 0 0.5px rgba(0,0,0,0.2); }
.macos-btn-min    { background: #febc2e; box-shadow: 0 0 0 0.5px rgba(0,0,0,0.2); }
.macos-btn-max    { background: #28c840; box-shadow: 0 0 0 0.5px rgba(0,0,0,0.2); }

.macos-btn:hover  { filter: brightness(0.88); }
.macos-btn:active { filter: brightness(0.70); }

.macos-unfocused .macos-btn-close,
.macos-unfocused .macos-btn-min,
.macos-unfocused .macos-btn-max {
    background: #cccccc;
}

.macos-sep {
    width: 1px;
    height: 16px;
    background: rgba(255,255,255,0.15);
    flex-shrink: 0;
    margin-right: 4px;
}

/* Hide native Windows buttons */
[class*="winButtons"],
[class*="winButton"] {
    display: none !important;
}
`;
let focusHandler = null;
let blurHandler = null;
let btnHandlers = null;
function injectMacOsButtons() {
    if (document.getElementById("macos-window-controls"))
        return;
    const style = document.createElement("style");
    style.id = "macos-buttons-style";
    style.textContent = CSS;
    document.head.appendChild(style);
    const container = document.createElement("div");
    container.id = "macos-window-controls";
    document.body.appendChild(container);
    container.style.zIndex = "2147483647";
    container.style.pointerEvents = "all";
    container.style.webkitAppRegion = "no-drag";
    const sep = document.createElement("div");
    sep.className = "macos-sep";
    // Red — Close
    const btnClose = document.createElement("button");
    btnClose.className = "macos-btn macos-btn-close";
    btnClose.title = "Close";
    btnClose.innerHTML = "<span class=\"macos-btn-icon\"><svg width=\"6\" height=\"6\" viewBox=\"0 0 6 6\" fill=\"none\"><path d=\"M1 1L5 5M5 1L1 5\" stroke=\"#4d0000\" stroke-width=\"1.3\" stroke-linecap=\"round\"/></svg></span>";
    const handlers = btnHandlers ??= {};
    handlers.close = e => { e.stopPropagation(); Native.closeWindow(); };
    btnClose.addEventListener("click", handlers.close);
    // Yellow — Minimize
    const btnMin = document.createElement("button");
    btnMin.className = "macos-btn macos-btn-min";
    btnMin.title = "Minimize";
    btnMin.innerHTML = "<span class=\"macos-btn-icon\"><svg width=\"7\" height=\"2\" viewBox=\"0 0 7 2\" fill=\"none\"><path d=\"M0.5 1H6.5\" stroke=\"#6d4c00\" stroke-width=\"1.3\" stroke-linecap=\"round\"/></svg></span>";
    handlers.min = e => { e.stopPropagation(); Native.minimizeWindow(); };
    btnMin.addEventListener("click", handlers.min);
    // Green — Maximize
    const btnMax = document.createElement("button");
    btnMax.className = "macos-btn macos-btn-max";
    btnMax.title = "Maximize / Restore";
    btnMax.innerHTML = "<span class=\"macos-btn-icon\"><svg width=\"7\" height=\"7\" viewBox=\"0 0 7 7\" fill=\"none\"><path d=\"M1 6L6 1M1 3.5V1H3.5M3.5 6H6V3.5\" stroke=\"#0a3a00\" stroke-width=\"1.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg></span>";
    handlers.max = e => { e.stopPropagation(); Native.maximizeWindow(); };
    btnMax.addEventListener("click", handlers.max);
    container.appendChild(btnClose);
    container.appendChild(btnMin);
    container.appendChild(btnMax);
    // Push Discord icons to the left to avoid overlap
    // Look for the real trailing container and add padding-right to it
    pushToolbarLeft();
    // Focus / unfocus
    focusHandler = () => container.classList.remove("macos-unfocused");
    blurHandler = () => container.classList.add("macos-unfocused");
    window.addEventListener("focus", focusHandler);
    window.addEventListener("blur", blurHandler);
    if (!document.hasFocus())
        container.classList.add("macos-unfocused");
}
function pushToolbarLeft() {
    // Width occupied by our buttons: sep(1) + gap(8) + 3×btn(13) + gaps(16) + padding(24) ≈ 90px
    const W = 90;
    // Look for all titlebar containers that are at the top right
    // and add padding-right to avoid overlapping with our buttons
    const styleId = "macos-toolbar-push";
    if (document.getElementById(styleId))
        return;
    const style = document.createElement("style");
    style.id = styleId;
    // Inject a CSS rule that pushes the trailing via padding
    // The trailing in Discord always has an aria or a class "trailing"
    style.textContent = `
        [class*="trailing"] {
            padding-right: ${W}px !important;
            margin-top: 4px !important;
        }
    `;
    document.head.appendChild(style);
}
function removeMacOsButtons() {
    const container = document.getElementById("macos-window-controls");
    if (container && btnHandlers) {
        const handlers = btnHandlers;
        const btns = container.querySelectorAll("button");
        btns.forEach(btn => {
            if (handlers.close)
                btn.removeEventListener("click", handlers.close);
            if (handlers.min)
                btn.removeEventListener("click", handlers.min);
            if (handlers.max)
                btn.removeEventListener("click", handlers.max);
        });
    }
    btnHandlers = null;
    document.getElementById("macos-window-controls")?.remove();
    document.getElementById("macos-buttons-style")?.remove();
    document.getElementById("macos-toolbar-push")?.remove();
    if (focusHandler) {
        window.removeEventListener("focus", focusHandler);
        focusHandler = null;
    }
    if (blurHandler) {
        window.removeEventListener("blur", blurHandler);
        blurHandler = null;
    }
}
export default definePlugin({
    name: "MacOsButtons",
    description: "Replaces Windows buttons with macOS-style buttons — red, yellow, green.",
    tags: ["Appearance", "Nightcord"],
    authors: [{ name: "Nightcord", id: 0n }],
    required: false,
    patches: [],
    start() {
        injectMacOsButtons();
        // Coalesce mutation bursts into a single rAF-scoped check instead of
        // running getElementById + a reparent check on every DOM mutation.
        this._scanQueued = false;
        this._scanFrame = null;
        this._obs = new MutationObserver(() => {
            if (this._scanQueued)
                return;
            this._scanQueued = true;
            this._scanFrame = requestAnimationFrame(() => {
                this._scanFrame = null;
                this._scanQueued = false;
                if (!this._obs)
                    return;
                const controls = document.getElementById("macos-window-controls");
                if (!controls) {
                    injectMacOsButtons();
                }
                else if (controls.parentElement !== document.body) {
                    // If it was moved by a layer change, put it back at the top
                    document.body.appendChild(controls);
                }
            });
        });
        this._obs.observe(document.body, { childList: true });
    },
    stop() {
        removeMacOsButtons();
        this._scanQueued = false;
        if (this._scanFrame !== null) {
            cancelAnimationFrame(this._scanFrame);
            this._scanFrame = null;
        }
        this._obs?.disconnect();
        this._obs = null;
    },
});
