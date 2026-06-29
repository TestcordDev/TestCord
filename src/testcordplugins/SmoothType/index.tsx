/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { Forms } from "@webpack/common";

const STYLE_ID = "vc-smoothtype";

const settings = definePluginSettings({
    transitionDelay: {
        type: OptionType.NUMBER,
        description: "Transition Delay (ms)",
        default: 75,
        onChange: () => applyCSS(),
    },
    animationType: {
        type: OptionType.SELECT,
        description: "Animation Type",
        options: [
            { label: "Ease", value: "ease", default: true },
            { label: "Linear", value: "linear" },
            { label: "Ease-in", value: "ease-in" },
            { label: "Ease-out", value: "ease-out" },
            { label: "Ease-in-out", value: "ease-in-out" },
        ],
        onChange: () => applyCSS(),
    },
    caretColor: {
        type: OptionType.COMPONENT,
        description: "Caret color",
        default: 0xffffff,
        component: () => {
            const hex = "#" + ((settings.store.caretColor ?? 0xffffff).toString(16).padStart(6, "0"));
            return (
                <div>
                    <Forms.FormTitle tag="h3">Caret Color</Forms.FormTitle>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <input
                            type="color"
                            value={hex}
                            onChange={e => {
                                const n = parseInt(e.target.value.replace("#", ""), 16);
                                if (!isNaN(n)) { settings.store.caretColor = n; applyCSS(); }
                            }}
                            style={{ width: 40, height: 32, padding: 2, border: "none", borderRadius: 4, cursor: "pointer", background: "none" }}
                        />
                        <input
                            type="text"
                            value={hex}
                            onChange={e => {
                                const h = e.target.value.replace("#", "");
                                const n = parseInt(h, 16);
                                if (!isNaN(n) && h.length === 6) { settings.store.caretColor = n; applyCSS(); }
                            }}
                            style={{ width: 90, padding: "4px 8px", borderRadius: 4, border: "1px solid var(--background-modifier-accent)", background: "var(--background-secondary)", color: "var(--text-normal)", fontSize: 13 }}
                        />
                    </div>
                </div>
            );
        },
    },
});

function toHex(n: number) {
    return `#${n.toString(16).padStart(6, "0")}`;
}

function buildCSS(): string {
    const color = toHex(settings.store.caretColor ?? 0xffffff);
    const ms = settings.store.transitionDelay ?? 60;
    const easing = settings.store.animationType ?? "ease";
    return `
@keyframes vc-blink {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0; }
}
#vc-smoothtype-caret.is-blinking {
    animation: vc-blink 1s ease-in-out infinite;
}
#vc-smoothtype-caret {
    position: fixed;
    top: 0; left: 0;
    transform: translate3d(0, 0, 0);
    width: 2px;
    border-radius: 2px;
    background: ${color};
    pointer-events: none;
    z-index: 99999;
    display: none;
    will-change: transform, height;
    transition: transform ${ms}ms ${easing}, height ${ms}ms ${easing};
}
[data-slate-editor] { caret-color: transparent !important; }
`;
}

function getCaret(): HTMLDivElement {
    let el = document.getElementById("vc-smoothtype-caret") as HTMLDivElement | null;
    if (!el) {
        el = document.createElement("div");
        el.id = "vc-smoothtype-caret";
        document.body.appendChild(el);
    }
    return el;
}

let blinkTimer: ReturnType<typeof setTimeout> | null = null;

function startBlink() { getCaret().classList.add("is-blinking"); }

function stopBlink() {
    getCaret().classList.remove("is-blinking");
    if (blinkTimer) clearTimeout(blinkTimer);
    blinkTimer = setTimeout(startBlink, 1000);
}

function applyCaretPosition() {
    const el = getCaret();
    if (!document.activeElement?.closest("[data-slate-editor]")) {
        el.style.display = "none"; return;
    }
    const sel = window.getSelection();
    if (!sel?.rangeCount) { el.style.display = "none"; return; }
    const range = sel.getRangeAt(0).cloneRange();
    range.collapse(false);
    const rects = range.getClientRects();
    let rect: DOMRect | null = rects.length > 0 ? rects[rects.length - 1] : null;
    if (!rect || rect.height === 0) {
        const node = range.startContainer;
        const parent = (node.nodeType === Node.TEXT_NODE ? node.parentElement : node) as HTMLElement | null;
        if (parent) rect = parent.getBoundingClientRect();
    }
    if (!rect || rect.height === 0) { el.style.display = "none"; return; }
    const newTransform = `translate3d(${rect.right}px, ${rect.top}px, 0)`;
    if (el.style.transform !== newTransform) {
        if (el.style.display !== "none") stopBlink();
    }
    el.style.display = "block";
    el.style.transform = newTransform;
    el.style.height = rect.height + "px";
}

let observer: MutationObserver | null = null;
let scanQueued = false;
let scanFrame: number | null = null;
let caretQueued = false;
let caretFrame: number | null = null;

let observedEditor: Element | null = null;

function hideCaret() {
    const el = document.getElementById("vc-smoothtype-caret") as HTMLDivElement | null;
    if (el) el.style.display = "none";
}

function scheduleApplyCaretPosition() {
    if (!document.activeElement?.closest("[data-slate-editor]")) {
        hideCaret();
        return;
    }
    if (caretQueued) return;

    caretQueued = true;
    caretFrame = requestAnimationFrame(() => {
        caretFrame = null;
        caretQueued = false;
        applyCaretPosition();
    });
}

// The caret moves on selection changes (typing, arrows, clicks), which the direct
// listeners already handle synchronously. The observer only needs to catch the rarer
// case where the editor reflows without a selection change (line wrap, input growth).
// Observing the focused editor element instead of document.body means Discord's constant
// body-subtree churn (typing indicators, message list, popouts) never wakes it, which is
// what caused the typing lag spikes.
function observeEditor() {
    const editor = document.activeElement?.closest("[data-slate-editor]") ?? null;
    if (editor === observedEditor) return;
    observer?.disconnect();
    observedEditor = editor;
    if (editor) observer?.observe(editor, { childList: true, subtree: true, characterData: true });
}

function startObserver() {
    observer = new MutationObserver(() => {
        if (scanQueued) return;
        scanQueued = true;
        scanFrame = requestAnimationFrame(() => {
            scanFrame = null;
            scanQueued = false;
            if (observer) applyCaretPosition();
        });
    });
}

function stopObserver() {
    observer?.disconnect();
    observer = null;
    observedEditor = null;
    if (scanFrame !== null) {
        cancelAnimationFrame(scanFrame);
        scanFrame = null;
    }
    if (caretFrame !== null) {
        cancelAnimationFrame(caretFrame);
        caretFrame = null;
    }
    scanQueued = false;
    caretQueued = false;
}

const handlers = {
    sel:   () => scheduleApplyCaretPosition(),
    focus: () => { observeEditor(); scheduleApplyCaretPosition(); },
    blur:  () => { observeEditor(); hideCaret(); },
    key:   () => scheduleApplyCaretPosition(),
    click: (e: MouseEvent) => {
        if (!(e.target instanceof Element) || !e.target.closest("[data-slate-editor]")) {
            hideCaret();
            return;
        }
        observeEditor();
        scheduleApplyCaretPosition();
    },
};

function startListeners() {
    document.addEventListener("selectionchange", handlers.sel);
    document.addEventListener("focusin", handlers.focus);
    document.addEventListener("focusout", handlers.blur);
    document.addEventListener("keyup", handlers.key, true);
    document.addEventListener("click", handlers.click, true);
}

function stopListeners() {
    document.removeEventListener("selectionchange", handlers.sel);
    document.removeEventListener("focusin", handlers.focus);
    document.removeEventListener("focusout", handlers.blur);
    document.removeEventListener("keyup", handlers.key, true);
    document.removeEventListener("click", handlers.click, true);
}

function applyCSS() {
    document.getElementById(STYLE_ID)?.remove();
    const s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = buildCSS();
    document.head.appendChild(s);
}

function removeCSS() {
    document.getElementById(STYLE_ID)?.remove();
}

export default definePlugin({
    name: "SmoothType",
    description: "The plugin allows you to fully customize the cursor caret's visual settings, including adjustable transition delays and custom CSS animation effects.",
    authors: [{ name: "coll", id: 0n }, { name: "viciouscal", id: 0n }],
    settings,

    start() {
        applyCSS();
        getCaret();
        startObserver();
        startListeners();
    },

    stop() {
        stopObserver();
        stopListeners();
        removeCSS();
        if (blinkTimer) clearTimeout(blinkTimer);
        document.getElementById("vc-smoothtype-caret")?.remove();
    },
});
