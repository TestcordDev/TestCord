/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const HINT_CONTAINER_ID = "vc-vimium-hints";
const HINT_CLASS = "vc-vimium-hint";
const MAX_HINTS = 200;
const FALLBACK_CHARS = "sadfjklewcmpgh";

const CANDIDATE_SELECTOR =
    "a[href], button:not([disabled]), [role='button'], [role='tab'], [role='menuitem'], [role='switch']";

interface HintTarget {
    el: HTMLElement;
    label: string;
}

let container: HTMLDivElement | null = null;
let targets: HintTarget[] = [];
let typed = "";
let mode: "click" | "hover" = "click";
let chars = FALLBACK_CHARS;

export function activateHints(options: { chars?: string; mode?: string }) {
    deactivateHints();

    chars = options.chars && options.chars.length > 0 ? options.chars : FALLBACK_CHARS;
    mode = options.mode === "hover" ? "hover" : "click";

    const candidates = findCandidates().slice(0, MAX_HINTS);
    if (candidates.length === 0) return;

    const labels = generateLabels(candidates.length, chars);
    targets = candidates.map((el, i) => ({ el, label: labels[i] }));

    container = document.createElement("div");
    container.id = HINT_CONTAINER_ID;
    document.body.appendChild(container);

    typed = "";
    renderBadges();
}

export function deactivateHints() {
    container?.remove();
    container = null;
    targets = [];
    typed = "";
}

export function handleHintKey(e: KeyboardEvent): boolean {
    if (!container) return false;

    if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        deactivateHints();
        (document.activeElement as HTMLElement)?.blur?.();
        return true;
    }

    if (e.key === "Backspace") {
        e.preventDefault();
        e.stopPropagation();
        typed = typed.slice(0, -1);
        renderBadges();
        return true;
    }

    if (e.key.length !== 1) return true;

    const ch = e.key.toLowerCase();
    if (!chars.includes(ch)) return true;

    e.preventDefault();
    e.stopPropagation();
    typed += ch;

    const matches = targets.filter(t => t.label.startsWith(typed));
    if (matches.length === 0) {
        deactivateHints();
    } else if (matches.length === 1 && matches[0].label === typed) {
        const { el } = matches[0];
        deactivateHints();
        activate(el);
    } else {
        renderBadges();
    }
    return true;
}

export function scrollChat(amount: number, direction: 1 | -1) {
    const scroller = findScroller();
    scroller?.scrollBy({ top: amount * direction, behavior: "smooth" });
}

export function scrollChannelHistory(direction: 1 | -1) {
    if (direction < 0) window.history.back();
    else window.history.forward();
}

function generateLabels(count: number, hintChars: string): string[] {
    const unique = [...new Set([...hintChars])].filter(c => c.trim().length > 0);
    if (unique.length === 0) unique.push(...FALLBACK_CHARS);

    let depth = 1;
    while (Math.pow(unique.length, depth) < count) depth++;

    const labels: string[] = [];
    const build = (prefix: string, remaining: number) => {
        if (labels.length >= count) return;
        if (remaining === 0) {
            labels.push(prefix);
            return;
        }
        for (const c of unique) build(prefix + c, remaining - 1);
    };
    build("", depth);

    return labels.slice(0, count);
}

function findCandidates(): HTMLElement[] {
    const all = [...document.querySelectorAll<HTMLElement>(CANDIDATE_SELECTOR)]
        .filter(isVisibleClickable)
        .filter(el => !el.parentElement?.closest(CANDIDATE_SELECTOR));

    all.sort((a, b) => {
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        const rowDiff = Math.round((ra.top - rb.top) / 20);
        return rowDiff !== 0 ? rowDiff : ra.left - rb.left;
    });

    return all;
}

function isVisibleClickable(el: HTMLElement): boolean {
    if (el.closest("[aria-hidden='true']")) return false;

    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return false;
    if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= window.innerHeight || rect.left >= window.innerWidth) return false;

    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") return false;
    if (parseFloat(style.opacity) < 0.1) return false;

    return true;
}

function renderBadges() {
    if (!container) return;
    container.textContent = "";

    for (const target of targets) {
        if (!target.label.startsWith(typed)) continue;

        const rect = target.el.getBoundingClientRect();
        const badge = document.createElement("div");
        badge.className = HINT_CLASS;
        badge.style.left = `${Math.max(0, rect.left)}px`;
        badge.style.top = `${Math.max(0, rect.top)}px`;

        if (typed) {
            const matched = document.createElement("span");
            matched.className = `${HINT_CLASS}-matched`;
            matched.textContent = typed;
            badge.appendChild(matched);
            badge.appendChild(document.createTextNode(target.label.slice(typed.length)));
        } else {
            badge.textContent = target.label;
        }

        container.appendChild(badge);
    }
}

function activate(el: HTMLElement) {
    if (mode === "hover") {
        const init: MouseEventInit = { bubbles: true, cancelable: true, view: window };
        el.dispatchEvent(new MouseEvent("mouseover", init));
        el.dispatchEvent(new MouseEvent("mousemove", init));
        setTimeout(() => {
            el.dispatchEvent(new MouseEvent("mouseout", init));
        }, 150);
        return;
    }

    el.focus?.();
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
}

function findScroller(): HTMLElement | null {
    const anchor = document.querySelector<HTMLElement>("[class*='chatContent']");
    let node: HTMLElement | null = anchor?.parentElement ?? null;
    while (node) {
        const style = getComputedStyle(node);
        if ((style.overflowY === "auto" || style.overflowY === "scroll") && node.scrollHeight > node.clientHeight + 10) {
            return node;
        }
        node = node.parentElement;
    }
    return null;
}
