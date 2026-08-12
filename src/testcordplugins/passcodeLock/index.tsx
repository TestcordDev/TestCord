/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import * as DataStore from "@api/DataStore";
import { HeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
export function t(arabic: string, english = arabic) { return english; }
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import {
    createRoot,
    IconUtils,
    MediaEngineStore,
    React,
    showToast,
    Toasts,
    useEffect,
    useRef,
    UserStore,
    useState,
    VoiceActions } from "@webpack/common";

function getUserAssets() {
    const user = UserStore.getCurrentUser();
    if (!user) return { avatarUrl: "", username: "User" };
    const avatarUrl = IconUtils.getUserAvatarURL(user, false, 128);
    return { avatarUrl, username: user.globalName || user.username || "User" };
}

/**
 * Make a URL safe to interpolate into a CSS `url('…')`. HTML escaping was used here before and
 * was both wrong and ineffective: entities stay literal inside a CSS string, while the characters
 * that can actually break out — quotes, backslashes, newlines and parentheses — passed straight
 * through. encodeURI leaves a working URL and removes all of them.
 */
function cssUrl(url: string) {
    return encodeURI(url).replace(/['"()\\]/g, "");
}

const DS_KEY = "PasscodeLock_data";
const MAX_CODE_LENGTH = 15;

const NotificationModule = findByPropsLazy("showNotification", "hasPermission");

const LOCK_ICON_PATH = "M19,10h-1V7.69c0-3.16-2.57-5.72-5.72-5.72H11.8C8.66,1.97,6,4.62,6,7.77V10H5c-0.55,0-1,0.45-1,1v8c0,1.65,1.35,3,3,3h10c1.65,0,3-1.35,3-3v-8C20,10.45,19.55,10,19,10z M8,7.77c0-2.06,1.74-3.8,3.8-3.8h0.48c2.05,0,3.72,1.67,3.72,3.72V10H8V7.77z M13.06,16.06c-0.02,0.02-0.04,0.04-0.06,0.05V18c0,0.55-0.45,1-1,1s-1-0.45-1-1v-1.89c-0.02-0.01-0.04-0.03-0.06-0.05C10.66,15.78,10.5,15.4,10.5,15c0-0.1,0.01-0.2,0.03-0.29c0.02-0.1,0.05-0.19,0.08-0.28c0.04-0.09,0.09-0.18,0.14-0.26c0.06-0.09,0.12-0.16,0.19-0.23c0.35-0.35,0.86-0.51,1.35-0.41c0.1,0.02,0.19,0.05,0.28,0.08c0.09,0.04,0.18,0.09,0.26,0.14c0.08,0.06,0.16,0.12,0.23,0.19s0.13,0.14,0.19,0.23c0.05,0.08,0.1,0.17,0.13,0.26c0.04,0.09,0.07,0.18,0.09,0.28C13.49,14.8,13.5,14.9,13.5,15C13.5,15.4,13.34,15.77,13.06,16.06z";

// The same lock glyph as a data URI, so the lock screen and the masked notification can use
// an <img> without any network request.
const LOCK_ICON_DATA_URI = "data:image/svg+xml;utf8," + encodeURIComponent(
    "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" width=\"64\" height=\"64\">" +
    `<path fill="#ffffff" d="${LOCK_ICON_PATH}"/></svg>`
);

type IconVariant = "intro" | "shake" | "rotate";

/** Restart an icon animation by swapping the variant class. The reflow read is required:
 *  re-adding a class the element already has does NOT replay a CSS animation. */
function setIconVariant(img: HTMLImageElement, variant: IconVariant) {
    img.classList.remove("pcl-lockicon-intro", "pcl-lockicon-shake", "pcl-lockicon-rotate");
    void img.offsetWidth;
    img.classList.add(`pcl-lockicon-${variant}`);
}

function LockIcon(props: any) {
    const size = props.width ?? props.height ?? props.size ?? 20;
    return (
        <svg className={props.className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" height={size} width={size}>
            <path fill={props.color ?? "currentColor"} d={LOCK_ICON_PATH} />
        </svg>
    );
}

// ─── Crypto helpers (ported verbatim, pure Web Crypto, no BD dependency) ───

const str2binb = (s: string) => new TextEncoder().encode(s);
const buf2hex = (buf: ArrayBuffer) => Array.prototype.map.call(new Uint8Array(buf), (x: number) => ("00" + x.toString(16)).slice(-2)).join("");
const hex2binb = (hex: string) => Uint8Array.from(hex.match(/.{1,2}/g) ?? [], byte => parseInt(byte, 16));

// Marks which KDF produced a stored hash. Without it, changing the KDF would leave an existing
// user permanently unable to unlock — their old hash could never match. On a mismatch the data
// is treated as "no passcode set" so they are asked to choose a new one instead of being locked
// out. (Nothing shipped with the old scheme in Testcord, but a silent lockout is not a risk worth
// leaving in place.)
const KDF_VERSION = 2;
const KDF_ITERATIONS = 600_000;

// Upstream generated the salt as HEX but decoded it with atob() as BASE64 — a real mismatch.
// It happened to "work" (hex characters are all valid base64 symbols and the length divides by
// four) and the salt stayed unique, but it silently derived from the wrong bytes. Hex in, hex
// out. SHA-1 is also replaced by SHA-256, and the iteration count raised from 4,000 to OWASP's
// current PBKDF2-HMAC-SHA256 guidance — a short numeric passcode is brute-forceable offline
// otherwise, and people reuse passcodes elsewhere.
async function pbkdf2(str: string, salt: string, iterations: number) {
    const key = await crypto.subtle.importKey("raw", str2binb(str), { name: "PBKDF2" }, false, ["deriveKey"]);
    const derived = await crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: hex2binb(salt), iterations, hash: { name: "SHA-256" } },
        key,
        { name: "HMAC", hash: "SHA-256", length: 256 },
        true,
        ["sign", "verify"],
    );
    return buf2hex(await crypto.subtle.exportKey("raw", derived));
}

async function hashCode(code: string) {
    const salt = buf2hex(crypto.getRandomValues(new Uint8Array(32)).buffer);
    const hash = await pbkdf2(code, salt, KDF_ITERATIONS);
    return { hash, salt, iterations: KDF_ITERATIONS, kdf: KDF_VERSION };
}

async function hashCheck(code: string, salt: string, iterations: number, expected: string) {
    return (await pbkdf2(code, salt, iterations)) === expected;
}

/**
 * Is there a passcode this build can actually verify?
 *
 * A hash produced by a different KDF can never match, so treating it as "set" would lock the
 * user out permanently with no way back in through the UI. Treating it as "not set" instead
 * degrades to the unconfigured state — the setup screen — which is recoverable. Deliberate
 * trade-off: fail open on an unverifiable hash rather than brick the client.
 */
function hasPasscode(d: PLData): boolean {
    return Boolean(d.hash) && d.kdf === KDF_VERSION;
}

// ─── Persisted data (separate from settings, stored in IndexedDB) ───

interface PLData {
    hash?: string;
    salt?: string | null;
    iterations?: number | null;
    /** Which KDF produced `hash`. Absent or stale means the hash can never verify. */
    kdf?: number | null;
    attempts?: number;
    delayUntil?: number | null;
    locked?: boolean;
}

// ─── Settings ───

const settings = definePluginSettings({
    codeType: {
        type: OptionType.SELECT,
        description: "Type of code",
        options: [
            { label: "4-Digit Numeric Code", value: "4-digit", default: true },
            { label: "6-Digit Numeric Code", value: "6-digit" },
            { label: "Custom Numeric Code", value: "custom-numeric" },
        ],
    },
    autolockSeconds: {
        type: OptionType.SELECT,
        description: "Auto-lock after being away for",
        options: [
            { label: "Disabled", value: 0, default: true },
            { label: "1 minute", value: 60 },
            { label: "5 minutes", value: 300 },
            { label: "1 hour", value: 3600 },
            { label: "5 hours", value: 18000 },
        ],
    },
    lockOnStartup: {
        type: OptionType.BOOLEAN,
        description: "Always lock on startup",
        default: true,
    },
    highlightButtons: {
        type: OptionType.BOOLEAN,
        description: "Highlight number buttons when typing the passcode from the keyboard",
        default: false,
    },
    hideNotifications: {
        type: OptionType.BOOLEAN,
        description: "Hide notification content while locked",
        default: true,
    },
    keybind: {
        type: OptionType.STRING,
        description: "Keybind to lock Discord (e.g. control+l)",
        default: "control+l",
    },
}).withPrivateSettings<PLData>();

const data = new Proxy({} as PLData, {
    get(_, prop: keyof PLData) {
        return (settings.store as any)[prop];
    },
    set(_, prop: keyof PLData, value: any) {
        (settings.store as any)[prop] = value;
        return true;
    }
});

async function loadData() {
    const oldData = await DataStore.get<PLData>(DS_KEY);
    if (oldData && oldData.hash) {
        data.hash = oldData.hash;
        data.salt = oldData.salt;
        data.iterations = oldData.iterations;
        data.attempts = oldData.attempts;
        data.delayUntil = oldData.delayUntil;
        data.locked = oldData.locked;
        await DataStore.del(DS_KEY);
    }
}
function saveData() {
    // Auto-saved by Vencord settings proxy
}

function codeLength() {
    switch (settings.store.codeType) {
        case "4-digit": return 4;
        case "6-digit": return 6;
        default: return -1; // custom, ends with Enter
    }
}

// ─── Lock screen overlay component ───

type LockType = "default" | "settings" | "editor";

function buildAnimatedIcon(container: HTMLElement, variant: IconVariant) {
    const img = document.createElement("img");
    img.alt = "";
    img.width = 64;
    img.height = 64;
    img.className = `pcl-lockicon pcl-lockicon-${variant}`;
    img.style.opacity = "0";
    container.appendChild(img);
    setTimeout(() => {
        img.style.transition = ".3s opacity";
        img.style.opacity = "1";
        img.src = LOCK_ICON_DATA_URI;
    }, 0);
    return img;
}

function PasscodeBtn({ number, dec, click, code, children }: any) {
    return (
        <div
            className="pcl-btn pcl-animate"
            id={`PCLBtn-${code ?? number}`}
            onClick={() => click?.(number)}
        >
            {!children ? (
                <>
                    <div className="pcl-btn-number">{number}</div>
                    <div className="pcl-btn-dec">{dec}</div>
                </>
            ) : children}
        </div>
    );
}

function BackspaceIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" height="22" width="22">
            <path fill="currentColor" d="M22 3H7c-.69 0-1.23.35-1.59.88L.37 11.45c-.22.34-.22.77 0 1.11l5.04 7.56c.36.52.9.88 1.59.88h15c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-3.7 13.3c-.39.39-1.02.39-1.41 0L14 13.41l-2.89 2.89c-.39.39-1.02.39-1.41 0-.39-.39-.39-1.02 0-1.41L12.59 12 9.7 9.11c-.39-.39-.39-1.02 0-1.41.39-.39 1.02-.39 1.41 0L14 10.59l2.89-2.89c.39-.39 1.02-.39 1.41 0 .39.39.39 1.02 0 1.41L15.41 12l2.89 2.89c.38.38.38 1.02 0 1.41z" />
        </svg>
    );
}
function CancelIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" height="30" width="30">
            <path fill="currentColor" d="M19 11H7.83l4.88-4.88c.39-.39.39-1.03 0-1.42-.39-.39-1.02-.39-1.41 0l-6.59 6.59c-.39.39-.39 1.02 0 1.41l6.59 6.59c.39.39 1.02.39 1.41 0 .39-.39.39-1.02 0-1.41L7.83 13H19c.55 0 1-.45 1-1s-.45-1-1-1z" />
        </svg>
    );
}
function EnterIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" height="34" width="34">
            <path fill="currentColor" d="M21.05 28.55 16.15 23.65Q15.7 23.2 15.05 23.2Q14.4 23.2 13.9 23.7Q13.4 24.2 13.4 24.85Q13.4 25.5 13.9 25.95L20 32.05Q20.45 32.5 21.05 32.5Q21.65 32.5 22.1 32.05L34.1 20.05Q34.55 19.6 34.525 18.95Q34.5 18.3 34.05 17.85Q33.6 17.35 32.925 17.35Q32.25 17.35 31.75 17.85ZM24 44Q19.75 44 16.1 42.475Q12.45 40.95 9.75 38.25Q7.05 35.55 5.525 31.9Q4 28.25 4 24Q4 19.8 5.525 16.15Q7.05 12.5 9.75 9.8Q12.45 7.1 16.1 5.55Q19.75 4 24 4Q28.2 4 31.85 5.55Q35.5 7.1 38.2 9.8Q40.9 12.5 42.45 16.15Q44 19.8 44 24Q44 28.25 42.45 31.9Q40.9 35.55 38.2 38.25Q35.5 40.95 31.85 42.475Q28.2 44 24 44ZM24 41Q31.25 41 36.125 36.125Q41 31.25 41 24Q41 16.75 36.125 11.875Q31.25 7 24 7Q16.75 7 11.875 11.875Q7 16.75 7 24Q7 31.25 11.875 36.125Q16.75 41 24 41Z" />
        </svg>
    );
}

interface LockerProps {
    type: LockType;
    button?: HTMLElement | null;
    onDone: (success: boolean, newCode?: string) => void;
}

function PasscodeLocker({ type, button, onDone }: LockerProps) {
    const rootRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const [confirmStage, setConfirmStage] = useState(false);
    const [newCode, setNewCode] = useState("");
    const [delay, setDelay] = useState(false);
    const [delayLeft, setDelayLeft] = useState(0);
    // Our React types require an initial value; the upstream copy relied on a looser signature.
    const iconRef = useRef<HTMLImageElement | null>(null);
    const len = codeLength();

    const getBg = () => rootRef.current?.querySelector(".pcl-layout-bg") as HTMLElement | null;

    const bgCircle = (smooth = true) => {
        try {
            const bg = getBg();
            if (!bg || !button) return;
            const buttonPos = document.body.contains(button) ? button.getBoundingClientRect() : { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight };
            const containerPos = document.body.getBoundingClientRect();
            const top = buttonPos.top + buttonPos.height / 2 - containerPos.top;
            const left = buttonPos.left + buttonPos.width / 2 - containerPos.left;
            const radius = Math.hypot(Math.max(top, containerPos.height - top), Math.max(left, containerPos.width - left));
            if (!smooth) bg.style.transition = "none";
            bg.style.top = `${top}px`;
            bg.style.left = `${left}px`;
            bg.style.width = `${radius * 2}px`;
            bg.style.height = `${radius * 2}px`;
            bg.style.transform = "translate(-50%, -50%) scale(1)";
            bg.style.borderRadius = "50%";
        } catch (e) {
            console.error("[PasscodeLock] bgCircle error", e);
        }
    };

    const bgFill = () => {
        try {
            const bg = getBg();
            if (!bg) return;
            bg.style.transition = "none";
            bg.style.top = "0";
            bg.style.left = "0";
            bg.style.width = "100%";
            bg.style.height = "100%";
            bg.style.borderRadius = "0";
            bg.style.transform = "scale(1)";
        } catch (e) {
            console.error("[PasscodeLock] bgFill error", e);
        }
    };

    // close() is GUARANTEED to call onDone, no matter what happens with styling/animation.
    // Any failure inside the animation steps is caught and logged, but never blocks
    // the unmount — this is what previously could leave the full-screen overlay
    // stuck forever, eating all clicks/keystrokes.
    const close = (success: boolean) => {
        try {
            const controls = rootRef.current?.querySelector(".pcl-controls") as HTMLElement | null;
            if (controls) controls.style.opacity = "0";
            bgCircle(false);
        } catch (e) {
            console.error("[PasscodeLock] close() pre-animation error", e);
        }
        setTimeout(() => {
            try {
                const bg = getBg();
                if (bg) bg.style.transform = "";
            } catch (e) {
                console.error("[PasscodeLock] close() animation error", e);
            }
            setTimeout(() => {
                try {
                    onDone(success, type === "editor" ? newCode : undefined);
                } catch (e) {
                    console.error("[PasscodeLock] onDone threw", e);
                }
            }, 400);
        }, 100);
    };

    const fail = () => {
        if (inputRef.current) {
            inputRef.current.value = "";
            inputRef.current.classList.add("vcl-err");
            setTimeout(() => {
                if (inputRef.current) inputRef.current.classList.remove("vcl-err");
            }, 2800);
        }
        if (iconRef.current) {
            setIconVariant(iconRef.current, type === "default" ? "shake" : "rotate");
        }
        if (type !== "default") return;
        data.attempts = (data.attempts ?? 0) + 1;
        if (data.attempts >= 3) {
            data.delayUntil = Date.now() + Math.min(30000, 5000 * (data.attempts - 2));
        }
        saveData();
        checkDelay();
    };

    const checkDelay = () => {
        if (data.delayUntil && Date.now() < data.delayUntil) {
            setDelay(true);
            setDelayLeft(Math.ceil((data.delayUntil - Date.now()) / 1000));
            if (inputRef.current) inputRef.current.value = "";
        } else {
            setDelay(false);
        }
    };

    // `accept` takes an optional explicit code to validate. This matters because
    // `append()` below calls accept() synchronously (via setTimeout) right after
    // computing the new full code string — if accept() fell back to reading the
    // `code` state closed over from the same render, it would see the code as it
    // was *before* the digit that was just typed, i.e. one character short. That
    // was a real, silent bug: the very last digit typed was never actually checked,
    // both when unlocking AND when the passcode was first set up in the editor
    // (so the stored hash itself could end up one character shorter than intended).
    const accept = async (submittedCode: string = inputRef.current?.value || "") => {
        try {
            if (submittedCode === "") return;
            if (type === "editor") {
                if (!confirmStage) {
                    setNewCode(submittedCode);
                    if (inputRef.current) inputRef.current.value = "";
                    setConfirmStage(true);
                    if (iconRef.current) setIconVariant(iconRef.current, "rotate");
                } else if (submittedCode !== newCode) {
                    fail();
                } else {
                    close(true);
                }
                return;
            }
            let ok = false;
            if (hasPasscode(data)) {
                ok = await hashCheck(submittedCode, data.salt!, data.iterations!, data.hash!);
            } else {
                ok = (submittedCode === "0000" || submittedCode === "000000");
            }
            if (ok) close(true);
            else fail();
        } catch (e) {
            console.error("[PasscodeLock] accept() error", e);
            // Never leave the overlay in limbo because a crypto/state error was thrown.
            fail();
        }
    };

    const append = (num: number) => {
        if (!inputRef.current) return;
        const current = inputRef.current.value;
        if (current.length >= MAX_CODE_LENGTH) return;
        const next = current + num.toString();
        inputRef.current.value = next;
        setTimeout(() => {
            if (len !== -1 && len <= next.length) accept(next);
        });
    };

    useEffect(() => {
        const interval = setInterval(checkDelay, 1000);
        checkDelay();

        // entrance animation — wrapped defensively so a styling/layout error never
        // leaves the overlay stuck mid-animation (which would block all clicks/keys).
        let tick: ReturnType<typeof setInterval> | undefined;
        let finished = false;
        let onTransEnd: (() => void) | undefined;
        let bgRef: HTMLElement | null = null;

        const finishEntrance = () => {
            if (finished) return;
            finished = true;
            try {
                if (onTransEnd) bgRef?.removeEventListener("transitionend", onTransEnd);
                if (tick) clearInterval(tick);
                rootRef.current?.querySelectorAll(".pcl-animate").forEach(e => e.classList.remove("pcl-animate", "pcl-animated"));
                bgFill();
            } catch (e) {
                console.error("[PasscodeLock] finishEntrance error", e);
            }
        };

        const focusGuard = (e: FocusEvent) => {
            if (!rootRef.current || rootRef.current.contains(e.target as Node)) return;
            e.stopImmediatePropagation();
            if (inputRef.current) inputRef.current.focus();
        };
        document.addEventListener("focusin", focusGuard, true);

        const entranceTimeout = setTimeout(() => {
            try {
                bgCircle();
                const animEls = () => Array.from(rootRef.current?.querySelectorAll(".pcl-animate:not(.pcl-animated)") ?? []);
                tick = setInterval(() => {
                    try {
                        const bg = getBg();
                        if (!bg) return;
                        const pos = bg.getBoundingClientRect();
                        const cTop = pos.top + pos.height / 2;
                        const cLeft = pos.left + pos.width / 2;
                        const radius = pos.width / 2;
                        animEls().forEach(el => {
                            const p = el.getBoundingClientRect();
                            const eTop = p.top + p.height / 2;
                            const eLeft = p.left + p.width / 2;
                            if (Math.hypot(Math.abs(eTop - cTop), Math.abs(eLeft - cLeft)) <= radius) {
                                if (el.classList.contains("pcl-icon") && !iconRef.current) {
                                    iconRef.current = buildAnimatedIcon(el as HTMLElement, "intro");
                                    el.classList.remove("pcl-animate");
                                } else {
                                    el.classList.add("pcl-animated");
                                }
                            }
                        });
                    } catch (e) {
                        console.error("[PasscodeLock] entrance tick error", e);
                    }
                }, 10);

                bgRef = getBg();
                onTransEnd = finishEntrance;
                bgRef?.addEventListener("transitionend", onTransEnd);
                // Failsafe: if transitionend never fires for any reason, force-finish
                // the entrance animation after 700ms so the screen never gets stuck
                // mid-transition with weird pointer/visual state.
                setTimeout(finishEntrance, 700);
            } catch (e) {
                console.error("[PasscodeLock] entrance animation error", e);
                finishEntrance();
            }
        }, 100);

        return () => {
            clearInterval(interval);
            clearTimeout(entranceTimeout);
            if (tick) clearInterval(tick);
            document.removeEventListener("focusin", focusGuard, true);
        };
            }, []);

    // Keyboard handling lives in its own effect, re-bound whenever the values it
    // reads change, so the listeners never close over stale `code`/`delay`/etc.
    // Previously this was inside the mount-only effect above: since that effect
    // only ran once, onKeyUp always saw `code` exactly as it was on the very first
    // render, so append() kept computing `next` from an empty string and only the
    // first digit typed on the keyboard ever registered. Mouse clicks worked fine
    // because each click used a freshly rendered `append` closure from that render.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape" && type !== "default") close(false);
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
            }, [type]);

    const title = type === "editor" ? (confirmStage ? t("أعد إدخال رمزك", "Re-enter your passcode") : t("أدخل رمزك الجديد", "Enter your new passcode")) : t("أدخل رمز ديسكورد", "Enter your Discord passcode");
    const { avatarUrl, username } = getUserAssets();

    return (
        <div className="pcl-layout" ref={rootRef}>
            <div className="pcl-layout-bg" />
            <div className="pcl-controls">
                <div id="vcl-avatar" style={{ backgroundImage: `url('${cssUrl(avatarUrl)}')` }} className="pcl-animate" />
                <p id="vcl-username" className="pcl-animate">{username}</p>
                <p id="vcl-sub" className="pcl-animate">{title}</p>

                <div id="vcl-input-wrap" className="pcl-animate">
                    <LockIcon className="vcl-icon-lock" size={14} />
                    <input
                        id="vcl-input"
                        ref={inputRef}
                        type="password"
                        placeholder={t("كلمة المرور", "Password")}
                        autoComplete="off"
                        spellCheck={false}
                        autoFocus
                        defaultValue=""
                        onChange={e => {
                            const val = e.target.value;
                            if (len !== -1 && val.length >= len) {
                                accept(val);
                            }
                        }}
                        onKeyDown={e => {
                            e.stopPropagation();
                            if (e.key === "Enter") accept(e.currentTarget.value);
                        }}
                        onKeyUp={e => e.stopPropagation()}
                        onKeyPress={e => e.stopPropagation()}
                        className={delay ? "vcl-err" : ""}
                        disabled={delay}
                    />
                    <button id="vcl-submit" onClick={() => accept()}>
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44" height={16} width={16}>
                            <path fill="currentColor" d="M21.05 28.55 16.15 23.65Q15.7 23.2 15.05 23.2Q14.4 23.2 13.9 23.7Q13.4 24.2 13.4 24.85Q13.4 25.5 13.9 25.95L20 32.05Q20.45 32.5 21.05 32.5Q21.65 32.5 22.1 32.05L34.1 20.05Q34.55 19.6 34.525 18.95Q34.5 18.3 34.05 17.85Q33.6 17.35 32.925 17.35Q32.25 17.35 31.75 17.85ZM24 44Q19.75 44 16.1 42.475Q12.45 40.95 9.75 38.25Q7.05 35.55 5.525 31.9Q4 28.25 4 24Q4 19.8 5.525 16.15Q7.05 12.5 9.75 9.8Q12.45 7.1 16.1 5.55Q19.75 4 24 4Q28.2 4 31.85 5.55Q35.5 7.1 38.2 9.8Q40.9 12.5 42.45 16.15Q44 19.8 44 24Q44 28.25 42.45 31.9Q40.9 35.55 38.2 38.25Q35.5 40.95 31.85 42.475Q28.2 44 24 44ZM24 41Q31.25 41 36.125 36.125Q41 31.25 41 24Q41 16.75 36.125 11.875Q31.25 7 24 7Q16.75 7 11.875 11.875Q7 16.75 7 24Q7 31.25 11.875 36.125Q16.75 41 24 41Z" />
                        </svg>
                    </button>
                </div>

                <div className={`pcl-delay ${delay ? "pcl-delay-visible" : ""}`}>
                    <svg style={{ marginRight: 6 }} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" height={16} width={16}><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
                    {`${t("محاولات كثيرة.\nحاول مجدّداً بعد", "Too many tries.\nPlease try again in")} ${delayLeft} ${delayLeft > 1 ? t("ثوانٍ", "seconds") : t("ثانية", "second")}.`}
                </div>
            </div>
        </div>
    );
}

// ─── Plugin-level lock orchestration ───

let isLocked = false;
let root: ReturnType<typeof createRoot> | null = null;
let container: HTMLDivElement | null = null;
let originalShowNotification: any = null;
let autolockTimeout: ReturnType<typeof setTimeout> | undefined;
let watchdogTimeout: ReturnType<typeof setTimeout> | undefined;

// Last-resort cleanup. Always safe to call, idempotent. Exposed on window so it
// can be triggered manually from devtools console if something ever still slips
// through the cracks: window.__testcordPasscodeReset()
function forceReset(reason?: string) {
    if (reason) console.warn(`[PasscodeLock] Force reset triggered: ${reason}`);
    try { root?.unmount(); } catch (e) { console.error(e); }
    try { container?.remove(); } catch (e) { console.error(e); }
    // Belt-and-suspenders: nuke any orphaned overlay nodes left in the DOM,
    // in case `container` itself got out of sync somehow.
    try {
        document.querySelectorAll(".pcl-layout").forEach(el => el.remove());
    } catch (e) { console.error(e); }
    root = null;
    container = null;
    isLocked = false;
    clearTimeout(watchdogTimeout);
}

function openLocker(type: LockType, button: HTMLElement | null, onSuccess?: (newCode?: string) => void) {
    if (root) return;

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    // Watchdog: an overlay should never realistically stay open for 45s without
    // the user interacting successfully or cancelling. If it does, something broke
    // (e.g. an uncaught error prevented onDone from firing) — auto-recover instead
    // of leaving the user permanently locked out of every button/shortcut.
    clearTimeout(watchdogTimeout);
    if (type !== "default") {
        watchdogTimeout = setTimeout(() => {
            forceReset("overlay stayed open longer than 45s, auto-clearing to prevent a permanent soft-lock");
        }, 45000);
    }

    let deafened = false;
    try {
        deafened = type === "default" && !MediaEngineStore.isSelfDeaf();
        if (deafened) VoiceActions.toggleSelfDeaf?.();
    } catch (e) {
        console.error("[PasscodeLock] deafen check failed (module not ready yet?)", e);
        deafened = false;
    }

    root.render(
        <PasscodeLocker
            type={type}
            button={button}
            onDone={(success, newCode) => {
                clearTimeout(watchdogTimeout);
                try {
                    root?.unmount();
                } catch (e) {
                    console.error("[PasscodeLock] unmount error", e);
                }
                try {
                    container?.remove();
                } catch (e) {
                    console.error("[PasscodeLock] container remove error", e);
                }
                root = null;
                container = null;

                if (type === "default") {
                    isLocked = false;
                    data.locked = false;
                    data.attempts = 0;
                    data.delayUntil = null;
                    saveData();
                    if (deafened) {
                        try { VoiceActions.toggleSelfDeaf?.(); } catch (e) { console.error("[PasscodeLock] re-deafen failed", e); }
                    }
                }

                if (success && type === "editor" && newCode) {
                    hashCode(newCode).then(({ hash, salt, iterations, kdf }) => {
                        data.hash = hash;
                        data.salt = salt;
                        data.iterations = iterations;
                        // MUST be stored: hasPasscode() refuses a hash whose KDF it cannot verify,
                        // so omitting this makes a freshly set passcode look like no passcode at all.
                        data.kdf = kdf;
                        saveData();
                        showToast(t("تم تحديث الرمز!", "Passcode has been updated!"), Toasts.Type.SUCCESS);
                    }).catch(e => {
                        console.error("[PasscodeLock] hashCode failed", e);
                        showToast(t("تعذّر حفظ الرمز، حاول مجدداً.", "Failed to save passcode, please try again."), Toasts.Type.FAILURE);
                    });
                }
                if (success) onSuccess?.(newCode);
            }}
        />,
    );
}

function lock(button: HTMLElement | null = document.body) {
    if (isLocked) return;
    try {
        openLocker("default", button);
        // Only commit the locked state once the overlay actually rendered
        // without throwing. Setting this *before* the attempt is what could
        // previously leave isLocked stuck at true forever if openLocker failed
        // (e.g. a webpack module not ready yet at startup) — silently disabling
        // every lock entry point (header button, settings button, keybind) for
        // the rest of the session.
        isLocked = true;
        data.locked = true;
        saveData();
    } catch (e) {
        console.error("[PasscodeLock] lock() failed to open the overlay", e);
        isLocked = false;
        forceReset("lock() threw while opening the overlay");
        showToast(t("تعذّر فتح قفل الرمز — راجع الطرفية للتفاصيل.", "PasscodeLock failed to open — check the console for details."), Toasts.Type.FAILURE);
    }
}

function resetAutolock() {
    clearTimeout(autolockTimeout);
    if (!settings.store.autolockSeconds) return;
    autolockTimeout = setTimeout(() => lock(document.body), settings.store.autolockSeconds * 1000);
}

function parseKeybind(str: string) {
    return (str || "control+l").toLowerCase().split("+").map(k => k.trim());
}

export default definePlugin({
    name: "PasscodeLock",
    description: "Protect Discord with a passcode.",
    authors: [{ name: "arg0NNY", id: 0n }],
    settings,

    headerBarButton: {
        icon: LockIcon,
        render: () => {
            const ref = useRef<HTMLDivElement>(null);
            return (
                <HeaderBarButton
                    ref={ref as any}
                    icon={LockIcon}
                    iconSize={20}
                    tooltip="Lock Discord"
                    onClick={() => {
                        // If a previous overlay somehow got stuck (root still set but
                        // nothing visible / unresponsive), this button doubles as a
                        // manual recovery: clicking it when nothing should be open
                        // but root is non-null force-clears it first.
                        if (root && !document.querySelector(".pcl-layout")) {
                            forceReset("header button clicked while root was set but no overlay was actually in the DOM");
                        }
                        lock(ref.current ?? document.body);
                    }}
                />
            );
        },
    } as any,

    settingsAboutComponent: () => {
        const [, force] = useState(0);
        return (
            <div style={{ display: "flex", gap: "10px", marginBottom: "10px" }}>
                <button
                    style={{ padding: "8px 14px", borderRadius: "4px", background: "var(--brand-experiment, #5865F2)", color: "#fff", border: "none", cursor: "pointer" }}
                    onClick={() => {
                        if (root && !document.querySelector(".pcl-layout")) {
                            forceReset("settings button clicked while root was set but no overlay was actually in the DOM");
                        }
                        openLocker("editor", document.body, () => force(n => n + 1));
                    }}
                >
                    {hasPasscode(data) ? t("تغيير الرمز", "Change Passcode") : t("إعداد الرمز", "Set Up Passcode")}
                </button>
                <button
                    style={{ padding: "8px 14px", borderRadius: "4px", background: "transparent", color: "var(--text-normal, #fff)", border: "1px solid var(--background-modifier-accent, #555)", cursor: "pointer" }}
                    onClick={() => {
                        if (root && !document.querySelector(".pcl-layout")) {
                            forceReset("settings button clicked while root was set but no overlay was actually in the DOM");
                        }
                        lock(document.body);
                    }}>
                    {t("اقفل ديسكورد الآن", "Lock Discord Now")}
                </button>
            </div>
        );
    },

    async start() {
        await loadData();

        // Manual recovery hatch, always available from devtools console.
        (window as any).__esharqPasscodeReset = () => forceReset("manually triggered via window.__testcordPasscodeReset()");

        if (settings.store.hideNotifications && NotificationModule) {
            originalShowNotification = NotificationModule.showNotification;
            NotificationModule.showNotification = function (...args: any[]) {
                args[0] = LOCK_ICON_DATA_URI;
                args[1] = "New notification";
                args[2] = "You have 1 new notification!";
                if (args[4]?.onClick) args[4].onClick = () => {};
                return originalShowNotification.apply(this, args);
            };
        }

        const onKeyDown = (e: KeyboardEvent) => {
            const combo = parseKeybind(settings.store.keybind);
            const pressed: string[] = [];
            if (e.ctrlKey) pressed.push("control");
            if (e.shiftKey) pressed.push("shift");
            if (e.altKey) pressed.push("alt");
            const key = e.key.toLowerCase();
            if (!["control", "shift", "alt"].includes(key)) pressed.push(key);
            if (combo.sort().join("|") === pressed.sort().join("|")) {
                if (root && !document.querySelector(".pcl-layout")) {
                    forceReset("keybind pressed while root was set but no overlay was actually in the DOM");
                }
                lock(document.body);
            }
        };
        (this as any)._onKeyDown = onKeyDown;
        window.addEventListener("keydown", onKeyDown);

        (this as any)._activityListener = () => {
            if (!isLocked) resetAutolock();
        };
        window.addEventListener("mousemove", (this as any)._activityListener);
        window.addEventListener("keydown", (this as any)._activityListener);
        window.addEventListener("mousedown", (this as any)._activityListener);

        resetAutolock();

        // Only auto-lock on startup if a passcode has actually been configured.
        // Without this check, enabling the plugin for the very first time (before
        // ever setting a passcode) would immediately lock Discord because
        // lockOnStartup defaults to true — trapping the user behind a lock screen
        // with no passcode they ever chose.
        if (hasPasscode(data) && (settings.store.lockOnStartup || data.locked)) {
            setTimeout(() => {
                lock(document.body);
                // If the first attempt failed (isLocked still false, meaning
                // openLocker threw), retry once after modules have had more
                // time to initialize.
                setTimeout(() => {
                    if (!isLocked) lock(document.body);
                }, 2000);
            }, 300);
        }
    },

    stop() {
        if (originalShowNotification && NotificationModule) {
            NotificationModule.showNotification = originalShowNotification;
            originalShowNotification = null;
        }
        window.removeEventListener("keydown", (this as any)._onKeyDown);
        window.removeEventListener("mousemove", (this as any)._activityListener);
        window.removeEventListener("keydown", (this as any)._activityListener);
        window.removeEventListener("mousedown", (this as any)._activityListener);
        clearTimeout(autolockTimeout);
        clearTimeout(watchdogTimeout);
        delete (window as any).__esharqPasscodeReset;

        root?.unmount();
        container?.remove();
        root = null;
        container = null;
        isLocked = false;
    },
});
