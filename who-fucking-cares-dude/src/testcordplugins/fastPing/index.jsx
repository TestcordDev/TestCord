/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import "./styles.css";
import { definePluginSettings } from "@api/Settings";
import { insertTextIntoChatInputBox } from "@utils/discord";
import { t } from "@utils/testcordI18n";
import definePlugin from "@utils/types";
const SNOWFLAKE_RE = /^\d{15,21}$/;
const settings = definePluginSettings({
    trailingSpace: {
        type: 3 /* OptionType.BOOLEAN */,
        description: t("أضف مسافة بعد الإشارة عند إدراجها", "Add a space after the mention once inserted"),
        default: true,
    },
});
// ── Popover state (plain DOM, no React needed for a single floating button) ──
let popoverEl = null;
let repositionTarget = null;
function removePopover() {
    popoverEl?.remove();
    popoverEl = null;
    repositionTarget = null;
}
function positionPopover(el, range) {
    const rect = range.getBoundingClientRect();
    const top = rect.top - 40;
    const left = rect.left + rect.width / 2;
    el.style.top = `${Math.max(8, top)}px`;
    el.style.left = `${left}px`;
}
function showPopover(id, range) {
    removePopover();
    const el = document.createElement("div");
    el.className = "fastping-popover";
    const btn = document.createElement("button");
    btn.className = "fastping-popover-btn";
    btn.type = "button";
    btn.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        <span>${t("إشارة", "Ping")} ${id}</span>
    `;
    btn.addEventListener("mousedown", e => {
        // prevent the chat input from losing its remembered selection before we read it
        e.preventDefault();
    });
    btn.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        const suffix = settings.store.trailingSpace ? " " : "";
        insertTextIntoChatInputBox(`<@${id}>${suffix}`);
        removePopover();
    });
    el.appendChild(btn);
    document.body.appendChild(el);
    positionPopover(el, range);
    popoverEl = el;
    repositionTarget = range;
}
function isInsideChatInput(node) {
    if (!node)
        return false;
    const el = node instanceof Element ? node : node.parentElement;
    return !!el?.closest('[data-slate-editor="true"]');
}
function onDblClick(e) {
    if (popoverEl?.contains(e.target))
        return;
    // let the browser resolve its native double-click word selection first
    requestAnimationFrame(() => {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
            removePopover();
            return;
        }
        const text = selection.toString().trim();
        if (!isInsideChatInput(selection.anchorNode) || !SNOWFLAKE_RE.test(text)) {
            removePopover();
            return;
        }
        showPopover(text, selection.getRangeAt(0).cloneRange());
    });
}
function onScrollOrResize() {
    if (popoverEl && repositionTarget) {
        positionPopover(popoverEl, repositionTarget);
    }
}
// @ts-ignore
function onDocMouseDown(e) {
    if (popoverEl && !popoverEl.contains(e.target)) {
        removePopover();
    }
}
function onKeyDown(e) {
    if (e.key === "Escape")
        removePopover();
}
export default definePlugin({
    name: "FastPing",
    description: "Double-click a user ID you just typed in the chat box to instantly turn it into a <@mention>.",
    authors: [{ name: "Unknown", id: 0n }],
    settings,
    start() {
        document.addEventListener("dblclick", onDblClick, true);
        document.addEventListener("mousedown", onDocMouseDown, true);
        document.addEventListener("keydown", onKeyDown, true);
        window.addEventListener("scroll", onScrollOrResize, true);
        window.addEventListener("resize", onScrollOrResize);
    },
    stop() {
        document.removeEventListener("dblclick", onDblClick, true);
        document.removeEventListener("mousedown", onDocMouseDown, true);
        document.removeEventListener("keydown", onKeyDown, true);
        window.removeEventListener("scroll", onScrollOrResize, true);
        window.removeEventListener("resize", onScrollOrResize);
        removePopover();
    },
});
