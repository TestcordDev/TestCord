/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher, UserStore } from "@webpack/common";

const settings = definePluginSettings({
    password: {
        type: OptionType.STRING,
        description: "Unlock password",
        default: "1337",
        restartNeeded: false,
    },
    autoLockMinutes: {
        type: OptionType.NUMBER,
        description: "Auto-lock after N minutes of inactivity (0 = disabled)",
        default: 5,
        restartNeeded: false,
    },
    blurAmount: {
        type: OptionType.SLIDER,
        description: "Blur intensity",
        default: 18,
        markers: [4, 8, 12, 16, 20, 24, 28],
        restartNeeded: false,
    },
    hint: {
        type: OptionType.STRING,
        description: "Optional password hint shown on lock screen",
        default: "",
        restartNeeded: false,
    },
    lockedGuilds: {
        type: OptionType.STRING,
        description: "Lock when entering these servers — comma-separated server IDs",
        default: "",
        restartNeeded: false,
    },
    lockedChannels: {
        type: OptionType.STRING,
        description: "Lock when entering these channels — comma-separated channel IDs",
        default: "",
        restartNeeded: false,
    },
    lockedUsers: {
        type: OptionType.STRING,
        description: "Lock when opening DMs with these users — comma-separated user IDs",
        default: "",
        restartNeeded: false,
    },
    lockOncePerGuild: {
        type: OptionType.BOOLEAN,
        description: "Ask for password only once per session when entering a locked server (not on every channel switch)",
        default: true,
        restartNeeded: false,
    },
});

// ─── State ────────────────────────────────────────────────────────────

let overlay: HTMLDivElement | null = null;
let domObserver: MutationObserver | null = null;
let keyGuard: ((e: KeyboardEvent) => void) | null = null;
let focusGuard: ((e: FocusEvent) => void) | null = null;
let inactiveTimer: ReturnType<typeof setTimeout> | null = null;
let inputKeyHandler: ((e: KeyboardEvent) => void) | null = null;
let overlayCtxHandler: ((e: Event) => void) | null = null;
let overlayMouseHandler: ((e: Event) => void) | null = null;

// tracks what's already been unlocked this session
const unlockedGuilds = new Set<string>();
const unlockedChannels = new Set<string>();
const unlockedUsers = new Set<string>();

// what triggered the current lock (so we can mark it unlocked after)
let pendingGuildId: string | null = null;
let pendingChannelId: string | null = null;
let pendingUserId: string | null = null;

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"] as const;

// ─── Activity ─────────────────────────────────────────────────────────

function onActivity() {
    if (inactiveTimer) clearTimeout(inactiveTimer);
    const mins = settings.store.autoLockMinutes;
    if (mins > 0) inactiveTimer = setTimeout(lockFull, mins * 60_000);
}

function bindActivity() {
    ACTIVITY_EVENTS.forEach(ev => document.addEventListener(ev, onActivity, { passive: true }));
    onActivity();
}

function unbindActivity() {
    ACTIVITY_EVENTS.forEach(ev => document.removeEventListener(ev, onActivity));
    if (inactiveTimer) { clearTimeout(inactiveTimer); inactiveTimer = null; }
}

// ─── Lock ─────────────────────────────────────────────────────────────

// full lock — clears session memory (startup / inactivity)
function lockFull() {
    unlockedGuilds.clear();
    unlockedChannels.clear();
    unlockedUsers.clear();
    pendingGuildId = pendingChannelId = pendingUserId = null;
    lock();
}

function lock() {
    unbindActivity();
    if (!document.getElementById("vcl-overlay")) createOverlay();
}

function unlock() {
    domObserver?.disconnect();
    domObserver = null;

    if (keyGuard) { document.removeEventListener("keydown", keyGuard, true); keyGuard = null; }
    if (focusGuard) { document.removeEventListener("focusin", focusGuard, true); focusGuard = null; }

    // mark whatever triggered this lock as unlocked for the session
    if (pendingGuildId) { unlockedGuilds.add(pendingGuildId); pendingGuildId = null; }
    if (pendingChannelId) { unlockedChannels.add(pendingChannelId); pendingChannelId = null; }
    if (pendingUserId) { unlockedUsers.add(pendingUserId); pendingUserId = null; }

    if (overlay) {
        overlay.style.transition = "opacity 0.28s ease";
        overlay.style.opacity = "0";
        setTimeout(() => { overlay?.remove(); overlay = null; }, 300);
    }

    bindActivity();
}

// ─── Helpers ──────────────────────────────────────────────────────────

function parseIds(raw: string): Set<string> {
    return new Set(raw.split(",").map(s => s.trim()).filter(Boolean));
}

// ─── Channel select handler ───────────────────────────────────────────

function onChannelSelect({ guildId, channelId }: { guildId?: string; channelId?: string; }) {
    if (overlay) return;

    const once = settings.store.lockOncePerGuild;

    // channel lock
    if (channelId && parseIds(settings.store.lockedChannels).has(channelId)) {
        if (once && unlockedChannels.has(channelId)) return;
        pendingChannelId = channelId;
        lock();
        return;
    }

    // guild lock
    if (guildId && parseIds(settings.store.lockedGuilds).has(guildId)) {
        if (once && unlockedGuilds.has(guildId)) return;
        pendingGuildId = guildId;
        lock();
        return;
    }

    // DM lock
    if (!guildId && channelId) {
        try {
            const { ChannelStore } = require("@webpack/common") as any;
            const channel = ChannelStore?.getChannel?.(channelId);

            if (channel?.isDM?.() || channel?.isGroupDM?.()) {
                const recipientId = channel.recipients?.[0];
                if (recipientId && parseIds(settings.store.lockedUsers).has(recipientId)) {
                    if (once && unlockedUsers.has(recipientId)) return;
                    pendingUserId = recipientId;
                    lock();
                }
            }
        } catch { /* ChannelStore not ready */ }
    }
}

// ─── User ─────────────────────────────────────────────────────────────

function getUserAssets() {
    const user = UserStore?.getCurrentUser?.() as any;
    if (!user) return { avatarUrl: "", username: "User" };

    const avatarUrl = user.avatar
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.webp?size=128`
        : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(user.id) % 6n)}.png`;

    return { avatarUrl, username: user.globalName || user.username || "User" };
}

// ─── Styles ───────────────────────────────────────────────────────────

function injectStyles(blur: number) {
    document.getElementById("vcl-styles")?.remove();

    const fa = document.createElement("link");
    fa.id = "vcl-fa";
    fa.rel = "stylesheet";
    fa.href = "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css";
    if (!document.getElementById("vcl-fa")) document.head.appendChild(fa);

    const st = document.createElement("style");
    st.id = "vcl-styles";
    st.textContent = `
        #vcl-overlay {
            position:                fixed;
            inset:                   0;
            z-index:                 2147483647;
            display:                 flex;
            flex-direction:          column;
            align-items:             center;
            justify-content:         center;
            backdrop-filter:         blur(${blur}px) brightness(0.38) saturate(0.25);
            -webkit-backdrop-filter: blur(${blur}px) brightness(0.38) saturate(0.25);
            overflow:                hidden;
            cursor:                  default;
        }

        #vcl-avatar {
            width:               72px;
            height:              72px;
            border-radius:       50%;
            background-size:     cover;
            background-position: center;
            background-color:    rgba(255,255,255,0.05);
            border:              1.5px solid rgba(255,255,255,0.15);
            margin-bottom:       18px;
            box-shadow:          0 8px 32px rgba(0,0,0,0.45);
            animation:           vcl-up 0.42s cubic-bezier(0.22,1,0.36,1) both;
        }

        #vcl-username {
            font-family:    'gg sans','Noto Sans',system-ui,sans-serif;
            font-size:      18px;
            font-weight:    600;
            letter-spacing: -0.3px;
            color:          rgba(255,255,255,0.92);
            margin:         0 0 6px;
            animation:      vcl-up 0.42s cubic-bezier(0.22,1,0.36,1) 0.05s both;
        }

        #vcl-sub {
            font-family: 'gg sans','Noto Sans',system-ui,sans-serif;
            font-size:   13px;
            color:       rgba(255,255,255,0.32);
            margin:      0 0 30px;
            animation:   vcl-up 0.42s cubic-bezier(0.22,1,0.36,1) 0.09s both;
        }

        #vcl-input-wrap {
            position:  relative;
            width:     280px;
            animation: vcl-up 0.42s cubic-bezier(0.22,1,0.36,1) 0.13s both;
        }

        #vcl-input-wrap > i.vcl-icon-lock {
            position:       absolute;
            left:           15px;
            top:            50%;
            transform:      translateY(-50%);
            font-size:      11.5px;
            color:          rgba(255,255,255,0.22);
            pointer-events: none;
            transition:     color 0.2s;
        }
        #vcl-input-wrap:focus-within > i.vcl-icon-lock { color: rgba(255,255,255,0.48); }

        #vcl-input {
            width:          100%;
            padding:        13px 44px 13px 40px;
            background:     rgba(255,255,255,0.07);
            border:         1px solid rgba(255,255,255,0.1);
            border-radius:  14px;
            color:          rgba(255,255,255,0.9);
            font-size:      14px;
            font-family:    'gg sans','Noto Sans',system-ui,sans-serif;
            letter-spacing: 1px;
            outline:        none;
            box-sizing:     border-box;
            caret-color:    rgba(255,255,255,0.7);
            transition:     border-color 0.2s, background 0.2s, box-shadow 0.2s;
        }
        #vcl-input::placeholder { color: rgba(255,255,255,0.2); letter-spacing: 0; }
        #vcl-input:focus {
            background:   rgba(255,255,255,0.1);
            border-color: rgba(255,255,255,0.26);
            box-shadow:   0 0 0 3px rgba(255,255,255,0.05), 0 8px 28px rgba(0,0,0,0.3);
        }
        #vcl-input.vcl-err {
            border-color: rgba(255,100,100,0.5);
            box-shadow:   0 0 0 3px rgba(255,80,80,0.08);
            animation:    vcl-shake 0.34s ease;
        }

        #vcl-submit {
            position:      absolute;
            right:         10px;
            top:           50%;
            transform:     translateY(-50%);
            background:    none;
            border:        none;
            color:         rgba(255,255,255,0.25);
            font-size:     12px;
            cursor:        pointer;
            padding:       6px 8px;
            border-radius: 8px;
            transition:    color 0.18s, background 0.18s;
            line-height:   1;
        }
        #vcl-submit:hover { color: rgba(255,255,255,0.7); background: rgba(255,255,255,0.07); }

        #vcl-error {
            display:     none;
            width:       280px;
            margin-top:  10px;
            font-family: 'gg sans','Noto Sans',system-ui,sans-serif;
            font-size:   12.5px;
            color:       rgba(255,120,120,0.9);
            align-items: center;
            gap:         6px;
        }
        #vcl-error.vcl-show { display: flex; }

        #vcl-hint {
            width:       280px;
            margin-top:  13px;
            font-family: 'gg sans','Noto Sans',system-ui,sans-serif;
            font-size:   12px;
            color:       rgba(255,255,255,0.38);
            display:     flex;
            align-items: center;
            gap:         6px;
            animation:   vcl-up 0.42s cubic-bezier(0.22,1,0.36,1) 0.17s both;
        }

        @keyframes vcl-up {
            from { opacity: 0; transform: translateY(12px); }
            to   { opacity: 1; transform: translateY(0);    }
        }
        @keyframes vcl-shake {
            0%,100% { transform: translateX(0);   }
            20%,60% { transform: translateX(-6px); }
            40%,80% { transform: translateX(6px);  }
        }
    `;
    document.head.appendChild(st);
}

// ─── Overlay ──────────────────────────────────────────────────────────

function createOverlay() {
    injectStyles(settings.store.blurAmount ?? 18);

    const { avatarUrl, username } = getUserAssets();
    const hint = settings.store.hint?.trim();

    overlay = document.createElement("div");
    overlay.id = "vcl-overlay";

    overlay.innerHTML = `
        <div id="vcl-avatar" style="background-image:url('${avatarUrl}')"></div>
        <p id="vcl-username">${username}</p>
        <p id="vcl-sub">Enter password to unlock</p>

        <div id="vcl-input-wrap">
            <i class="fa-solid fa-lock vcl-icon-lock"></i>
            <input id="vcl-input" type="password" placeholder="Password" autocomplete="off" spellcheck="false" />
            <button id="vcl-submit"><i class="fa-solid fa-arrow-right"></i></button>
        </div>

        <div id="vcl-error">
            <i class="fa-solid fa-circle-exclamation"></i>
            <span id="vcl-error-msg"></span>
        </div>

        ${hint ? `<p id="vcl-hint"><i class="fa-regular fa-lightbulb"></i> ${hint}</p>` : ""}
    `;

    document.body.appendChild(overlay);

    const input = overlay.querySelector<HTMLInputElement>("#vcl-input")!;
    const submitBtn = overlay.querySelector<HTMLButtonElement>("#vcl-submit")!;
    const errorBox = overlay.querySelector<HTMLDivElement>("#vcl-error")!;
    const errorMsg = overlay.querySelector<HTMLSpanElement>("#vcl-error-msg")!;

    let attempts = 0;
    let lockUntil = 0;

    function showError(msg: string) {
        input.classList.add("vcl-err");
        errorMsg.textContent = msg;
        errorBox.classList.add("vcl-show");
        setTimeout(() => {
            input.classList.remove("vcl-err");
            errorBox.classList.remove("vcl-show");
            input.value = "";
            input.focus();
        }, 2800);
    }

    function tryUnlock() {
        const now = Date.now();
        if (now < lockUntil) {
            showError(`Too many attempts — wait ${Math.ceil((lockUntil - now) / 1000)}s`);
            return;
        }
        if (input.value === settings.store.password) { unlock(); return; }

        attempts++;
        if (attempts >= 5) {
            lockUntil = Date.now() + 15_000;
            attempts = 0;
            showError("Too many attempts — locked for 15s");
        } else {
            showError(`Wrong password  (${attempts} / 5)`);
        }
    }

    submitBtn.addEventListener("click", tryUnlock);
    inputKeyHandler = (e: KeyboardEvent) => {
        if (e.key === "Enter") { e.preventDefault(); tryUnlock(); }
        e.stopPropagation();
    };
    input.addEventListener("keydown", inputKeyHandler);

    keyGuard = (e: KeyboardEvent) => {
        if (e.target === input) return;
        const blocked =
            e.key === "F12" ||
            (e.ctrlKey && e.shiftKey && ["I", "J", "C", "K"].includes(e.key)) ||
            (e.ctrlKey && e.key === "U");
        if (blocked) { e.preventDefault(); e.stopImmediatePropagation(); }
    };
    document.addEventListener("keydown", keyGuard, true);

    focusGuard = (e: FocusEvent) => {
        if (!overlay || e.target === input) return;
        e.stopImmediatePropagation();
        requestAnimationFrame(() => input.focus());
    };
    document.addEventListener("focusin", focusGuard, true);

    overlayCtxHandler = (e: Event) => { if (e.target !== input) e.preventDefault(); };
    overlayMouseHandler = (e: Event) => { if (e.target === overlay) { e.preventDefault(); (input as HTMLInputElement).focus(); } };
    overlay.addEventListener("contextmenu", overlayCtxHandler);
    overlay.addEventListener("mousedown", overlayMouseHandler);

    setTimeout(() => input.focus(), 140);

    domObserver = new MutationObserver(() => {
        if (!document.getElementById("vcl-overlay") && overlay) {
            document.body.appendChild(overlay);
            requestAnimationFrame(() => input.focus());
        }
    });
    domObserver.observe(document.body, { childList: true });
}

// ─── Plugin ───────────────────────────────────────────────────────────

export default definePlugin({
    name: "DiscordLock",
    description: "Locks Discord on startup, on inactivity, and on specified servers/channels/DMs.",
    tags: ["Privacy", "Utility"],
    authors: [{ name: "vejcowski", id: 1375544683908042862n }],
    settings,

    start() {
        FluxDispatcher.subscribe("CHANNEL_SELECT", onChannelSelect);
        if (document.readyState === "complete") lockFull();
        else window.addEventListener("load", lockFull, { once: true });
    },

    stop() {
        FluxDispatcher.unsubscribe("CHANNEL_SELECT", onChannelSelect);
        window.removeEventListener("load", lockFull);
        unbindActivity();

        domObserver?.disconnect();
        domObserver = null;

        if (keyGuard) { document.removeEventListener("keydown", keyGuard, true); keyGuard = null; }
        if (focusGuard) { document.removeEventListener("focusin", focusGuard, true); focusGuard = null; }

        if (overlay) {
            const input = document.getElementById("vcl-input");
            if (input && inputKeyHandler) {
                input.removeEventListener("keydown", inputKeyHandler);
            }
            overlay.removeEventListener("contextmenu", overlayCtxHandler!);
            overlay.removeEventListener("mousedown", overlayMouseHandler!);
            overlay.remove();
        }
        overlay = null;
        inputKeyHandler = null;
        overlayCtxHandler = null;
        overlayMouseHandler = null;

        document.getElementById("vcl-styles")?.remove();
        document.getElementById("vcl-fa")?.remove();
    },
});
