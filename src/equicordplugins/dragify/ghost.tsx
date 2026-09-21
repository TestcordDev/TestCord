/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { VoiceStateStore } from "@webpack/common";

export type GhostState = {
    visible: boolean;
    x: number;
    y: number;
    kind: "user" | "channel" | "guild";
    title: string;
    subtitle?: string;
    iconUrl?: string;
    symbol?: string;
    badge?: string;
    entityId?: string;
    exiting: boolean;
};

let ghostMountNode: HTMLDivElement | null = null;
let ghostEl: HTMLDivElement | null = null;
let ghostRaf: number | null = null;
let ghostPendingPos: { x: number; y: number; } | null = null;
let ghostHideTimer: number | null = null;
let ghostVisible = false;

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, char => {
        switch (char) {
            case "&": return "&amp;";
            case "<": return "&lt;";
            case ">": return "&gt;";
            case "\"": return "&quot;";
            default: return "&#39;";
        }
    });
}

const VOICE_ICON = "<svg class=\"vc-dragify-voice-icon\" xmlns=\"http://www.w3.org/2000/svg\" width=\"14\" height=\"14\" fill=\"none\" viewBox=\"0 0 24 24\"><path fill=\"currentColor\" d=\"M7 2a1 1 0 0 0-1 1v18a1 1 0 1 0 2 0V3a1 1 0 0 0-1-1ZM11 6a1 1 0 1 1 2 0v12a1 1 0 1 1-2 0V6ZM1 8a1 1 0 0 1 2 0v8a1 1 0 1 1-2 0V8ZM16 5a1 1 0 1 1 2 0v14a1 1 0 1 1-2 0V5ZM22 8a1 1 0 0 0-1 1v6a1 1 0 1 0 2 0V9a1 1 0 0 0-1-1Z\"/></svg>";
const VOICE_MUTED_ICON = "<svg class=\"vc-dragify-voice-icon vc-dragify-voice-icon-muted\" xmlns=\"http://www.w3.org/2000/svg\" width=\"14\" height=\"14\" fill=\"none\" viewBox=\"0 0 24 24\"><path fill=\"currentColor\" d=\"M22.7 2.7a1 1 0 0 0-1.4-1.4l-20 20a1 1 0 1 0 1.4 1.4l20-20ZM6.85 13.15a.5.5 0 0 1-.85-.36V3a1 1 0 0 1 2 0v8.8a.5.5 0 0 1-.15.35l-1 1ZM11 17.2v.8a1 1 0 1 0 2 0v-1.8a.5.5 0 0 0-.85-.35l-1 1a.5.5 0 0 0-.15.36ZM11 7.8V6a1 1 0 1 1 2 0v.8a.5.5 0 0 1-.15.35l-1 1a.5.5 0 0 1-.85-.36ZM17.15 10.85a.5.5 0 0 1 .85.36V19a1 1 0 1 1-2 0v-6.8a.5.5 0 0 1 .15-.35l1-1ZM2 7a1 1 0 0 0-1 1v8a1 1 0 1 0 2 0V8a1 1 0 0 0-1-1ZM21 9a1 1 0 1 1 2 0v6a1 1 0 1 1-2 0V9Z\"/></svg>";
const STREAM_ICON = "<svg class=\"vc-dragify-voice-icon vc-dragify-voice-icon-stream\" xmlns=\"http://www.w3.org/2000/svg\" width=\"14\" height=\"14\" fill=\"none\" viewBox=\"0 0 24 24\"><path fill=\"currentColor\" d=\"M4 5a3 3 0 0 0-3 3v7a3 3 0 0 0 3 3h4.59l-1.3 2.3a1 1 0 1 0 1.74.98L10.84 18h2.32l1.81 3.28a1 1 0 1 0 1.74-.98L15.41 18H20a3 3 0 0 0 3-3V8a3 3 0 0 0-3-3H4Zm0 2h16a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Zm6 2.57c0-.8.89-1.27 1.54-.82l3.22 2.23a1 1 0 0 1 0 1.64l-3.22 2.23A1 1 0 0 1 10 14.03V9.57Z\"/></svg>";

function renderGhostContent(state: Omit<GhostState, "visible" | "x" | "y">): string {
    const icon = state.iconUrl
        ? `<img class="vc-dragify-icon-image" src="${escapeHtml(state.iconUrl)}" alt=""/>`
        : `<span class="vc-dragify-icon-text">${escapeHtml(state.symbol ?? "#")}</span>`;

    let status = "";
    if (state.kind === "user" && state.entityId) {
        const voiceState = VoiceStateStore.getVoiceStateForUser(state.entityId) as {
            channelId?: string | null;
            selfMute?: boolean; mute?: boolean; selfDeaf?: boolean; deaf?: boolean;
            selfStream?: boolean;
        } | null | undefined;
        if (voiceState?.channelId) {
            const muted = voiceState.selfMute || voiceState.mute || voiceState.selfDeaf || voiceState.deaf;
            status += muted ? VOICE_MUTED_ICON : VOICE_ICON;
            if (voiceState.selfStream) status += STREAM_ICON;
        }
    }

    const subtitle = state.subtitle
        ? `<div class="vc-dragify-subtitle">${escapeHtml(state.subtitle)}</div>`
        : "";

    return `<div class="vc-dragify-card"><div class="vc-dragify-icon">${icon}</div>`
        + "<div class=\"vc-dragify-body\"><div class=\"vc-dragify-title-row\">"
        + `<div class="vc-dragify-title">${escapeHtml(state.title)}</div>${status}</div>${subtitle}</div>`
        + `<div class="vc-dragify-badge">${escapeHtml(state.badge ?? state.kind)}</div></div>`;
}

function applyGhostPosition(x: number, y: number) {
    ghostEl?.style.setProperty("transform", `translate3d(${x}px, ${y}px, 0)`);
}

export function isGhostVisible(): boolean {
    return ghostVisible;
}

export function scheduleGhostPosition(x: number, y: number) {
    ghostPendingPos = { x, y };
    if (ghostRaf !== null) return;
    applyGhostPosition(x, y);
    ghostRaf = requestAnimationFrame(() => {
        if (ghostPendingPos) applyGhostPosition(ghostPendingPos.x, ghostPendingPos.y);
        ghostPendingPos = null;
        ghostRaf = null;
    });
}

export function hideGhost() {
    if (!ghostVisible || !ghostEl) return;
    if (ghostHideTimer !== null) {
        clearTimeout(ghostHideTimer);
        ghostHideTimer = null;
    }
    ghostEl.classList.add("vc-dragify-ghost-exit");
    ghostHideTimer = window.setTimeout(() => {
        ghostHideTimer = null;
        ghostVisible = false;
        ghostEl?.classList.remove("vc-dragify-ghost-exit");
        if (ghostEl) ghostEl.style.display = "none";
    }, 200);
}

export function showGhost(next: Omit<GhostState, "visible" | "x" | "y">, position?: { x: number; y: number; }) {
    if (!ghostEl) return;
    if (ghostHideTimer !== null) {
        clearTimeout(ghostHideTimer);
        ghostHideTimer = null;
    }
    ghostEl.classList.remove("vc-dragify-ghost-exit");
    ghostEl.innerHTML = renderGhostContent(next);
    ghostEl.style.display = "block";
    ghostVisible = true;
    if (position) {
        applyGhostPosition(position.x, position.y);
        ghostPendingPos = null;
    }
}

export function mountGhost() {
    if (typeof document === "undefined") return;
    const { body } = document;
    if (!body) return;

    if (ghostMountNode && !ghostMountNode.isConnected) body.appendChild(ghostMountNode);
    if (ghostEl) return;

    if (!ghostMountNode) {
        ghostMountNode = document.createElement("div");
        ghostMountNode.className = "vc-dragify-ghost-container";
    }
    if (!ghostMountNode.isConnected) body.appendChild(ghostMountNode);

    ghostEl = document.createElement("div");
    ghostEl.className = "vc-dragify-ghost";
    ghostEl.style.display = "none";
    ghostMountNode.appendChild(ghostEl);
}

export function unmountGhost() {
    if (ghostRaf !== null) {
        cancelAnimationFrame(ghostRaf);
        ghostRaf = null;
    }
    ghostPendingPos = null;

    if (ghostHideTimer !== null) {
        clearTimeout(ghostHideTimer);
        ghostHideTimer = null;
    }

    ghostEl?.remove();
    ghostEl = null;
    ghostMountNode?.remove();
    ghostMountNode = null;
    ghostVisible = false;
}
