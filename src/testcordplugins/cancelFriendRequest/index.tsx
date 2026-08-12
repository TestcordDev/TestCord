/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { RelationshipStore, Toasts } from "@webpack/common";

const RelationshipActions = findByPropsLazy("removeFriend", "sendFriendRequest");

// RelationshipType 4 = OUTGOING_REQUEST
const OUTGOING_REQUEST = 4;

// Module-scoped so stop() can clear a pending debounce timer the observer scheduled
let scanTimer: ReturnType<typeof setTimeout> | null = null;

function cancelRequest(userId: string) {
    try {
        RelationshipActions.removeFriend(userId);
        Toasts.show({
            message: "Friend request cancelled ✓",
            type: Toasts.Type.SUCCESS,
            id: Toasts.genId(),
        });
    } catch (e) {
        console.error("[CancelFriendRequest] Error:", e);
    }
}

function hasOutgoingRequests(): boolean {
    try {
        const rels = (RelationshipStore as any).getRelationships?.() ?? {};
        for (const type of Object.values(rels)) {
            if (type === OUTGOING_REQUEST) return true;
        }
    } catch {}
    return false;
}

function getUserIdFromOutgoingRelationships(): string | null {
    try {
        const rels = (RelationshipStore as any).getRelationships?.() ?? {};
        for (const [uid, type] of Object.entries(rels)) {
            if (type === OUTGOING_REQUEST) return uid;
        }
    } catch {}
    return null;
}

let observer: ReturnType<typeof setInterval> | null = null;
const patchedButtons = new Set<HTMLElement>();

function patchBtn(btn: HTMLElement, userId: string) {
    if (btn.dataset.cfp) return;
    btn.dataset.cfp = "1";
    const handler = (e: MouseEvent) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        cancelRequest(userId);
    };
    (btn as any)._cfpHandler = handler;
    btn.addEventListener("click", handler, true);
    patchedButtons.add(btn);
    // Remove disabled if present so the click is possible
    btn.removeAttribute("disabled");
    btn.style.cursor = "pointer";
    btn.style.opacity = "1";
}

function scan(root: Document | Element = document) {
    // Nothing to patch when there are no outgoing requests; skip the document sweeps.
    if (!hasOutgoingRequests()) return;

    // ── Case 1: profile popup ─────────────────────────────────────────────────
    // aria-label="Outgoing Friend Request" — invariant regardless of UI language
    root.querySelectorAll<HTMLElement>('button[aria-label="Outgoing Friend Request"]').forEach(btn => {
        // Find the userId via the profile container
        const profileContainer = btn.closest("[class*='profileButtons']")
            ?? btn.closest("[class*='profileHeader']")
            ?? btn.closest("[class*='inner']");
        if (!profileContainer) return;

        // Look for an avatar with Discord CDN that contains the userId
        const wholeModal = btn.closest("[class*='modal'], [class*='userPopout'], [class*='profileBody']")
            ?? document;
        const avatarImg = wholeModal?.querySelector?.("img[src*='cdn.discordapp.com/avatars/']");
        if (avatarImg) {
            const m = avatarImg.getAttribute("src")?.match(/avatars\/(\d+)\//);
            if (m) { patchBtn(btn, m[1]); return; }
        }
        // Fallback: look via pending relationships (if only 1 outgoing request)
        const uid = getUserIdFromOutgoingRelationships();
        if (uid) patchBtn(btn, uid);
    });

    // ── Case 2: DM header ────────────────────────────────────────────────────
    // The "Friend Request Sent" button is disabled + secondary in the DM header
    // Structure: div.container_b50d96 > div.inline_b50d96 > button[disabled].secondary
    root.querySelectorAll<HTMLElement>('button[disabled][class*="secondary"]').forEach(btn => {
        // Check that we're in a DM header (not elsewhere)
        const container = btn.closest("[class*='container_b50d96'], [class*='dmWelcome'], [class*='privateChannelEmptyMessage']");
        if (!container) return;

        // Get the userId via the avatar in this header
        const avatarImg = container.querySelector("img[src*='cdn.discordapp.com/avatars/']");
        if (avatarImg) {
            const m = avatarImg.getAttribute("src")?.match(/avatars\/(\d+)\//);
            if (m) {
                const relType = (RelationshipStore as any).getRelationshipType(m[1]);
                if (relType === OUTGOING_REQUEST) { patchBtn(btn, m[1]); return; }
            }
        }

        // Fallback: via outgoing relationships
        const uid = getUserIdFromOutgoingRelationships();
        if (uid) {
            const relType = (RelationshipStore as any).getRelationshipType(uid);
            if (relType === OUTGOING_REQUEST) patchBtn(btn, uid);
        }
    });
}

export default definePlugin({
    name: "CancelFriendRequestNC",
    description: "Cancels a pending friend request by clicking the button again.",
    tags: ["Friends", "Nightcord"],
    authors: [{ name: "Nightcord", id: 0n }],

    start() {
        this.observer = new MutationObserver(() => {
            if (scanTimer) return;
            if (!hasOutgoingRequests()) return;
            scanTimer = setTimeout(() => {
                scanTimer = null;
                scan(document);
            }, 300);
        });
        if (document.body) {
            this.observer.observe(document.body, { childList: true, subtree: true });
        }
        observer = setInterval(() => {
            if (!hasOutgoingRequests()) return;
            scan(document);
        }, 5000);
        scan(document);
    },

    stop() {
        if (this.observer) { this.observer.disconnect(); this.observer = null; }
        if (scanTimer) {
            clearTimeout(scanTimer);
            scanTimer = null;
        }
        if (observer) { clearInterval(observer); observer = null; }
        for (const btn of patchedButtons) {
            const handler = (btn as any)._cfpHandler;
            if (handler) {
                btn.removeEventListener("click", handler, true);
                delete (btn as any)._cfpHandler;
            }
            delete btn.dataset.cfp;
        }
        patchedButtons.clear();
        // Catch any markers left on buttons no longer tracked
        document.querySelectorAll<HTMLElement>("[data-cfp]").forEach(el => {
            delete el.dataset.cfp;
        });
        console.log("[CancelFriendRequest] Stopped.");
    },
});
