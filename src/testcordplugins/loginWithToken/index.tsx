/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { EquicordDevs } from "@utils/constants";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { findByProps } from "@webpack";
import { Forms, React, useState } from "@webpack/common";

// Identical to TokenImporter — same login logic
function switchToAccount(token: string) {
    try { window.localStorage.setItem("token", `"${token}"`); location.reload(); } catch {
        const iframe = document.createElement("iframe"); iframe.style.display = "none"; document.body.appendChild(iframe);
        try { (iframe as any).contentWindow.localStorage.token = `"${token}"`; } catch { }
        document.body.removeChild(iframe); location.reload();
    }
}

function doLoginWithToken(token: string) {
    try {
        const auth = findByProps("loginToken");
        if (auth?.loginToken) { auth.loginToken({ token }); return; }
    } catch { }
    switchToAccount(token);
}

function LoginWithTokenModal({ rootProps }: { rootProps: any; }) {
    const [token, setToken] = useState("");
    const [err, setErr] = useState("");
    const [loading, setLoading] = useState(false);

    function submit() {
        const t = token.trim();
        if (!t) { setErr("Enter a valid token."); return; }
        setLoading(true);
        setErr("");
        try {
            doLoginWithToken(t);
        } catch {
            setErr("Error during login.");
            setLoading(false);
        }
    }

    return (
        <ModalRoot {...rootProps} size="small">
            <ModalHeader separator={false}>
                <Forms.FormTitle tag="h4" style={{ margin: 0, color: "#ffffff" }}>
                    Login with token
                </Forms.FormTitle>
                <ModalCloseButton onClick={rootProps.onClose} />
            </ModalHeader>
            <ModalContent style={{ padding: "16px" }}>
                <Forms.FormTitle tag="h5" style={{ marginBottom: 8, color: "rgba(255,255,255,0.6)", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>
                    Discord Token
                </Forms.FormTitle>
                <input
                    type="password"
                    autoFocus
                    value={token}
                    onChange={e => setToken(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && submit()}
                    placeholder="Paste your token here..."
                    style={{
                        background: "var(--input-background, #1e1f22)",
                        border: "1px solid var(--input-border, #40444b)",
                        borderRadius: "var(--radius-sm, 4px)",
                        color: "var(--text-normal, #dcddde)",
                        fontSize: 16,
                        padding: "10px 12px",
                        outline: "none",
                        width: "100%",
                        boxSizing: "border-box" as const,
                        marginBottom: err ? 4 : 0,
                    }}
                />
                {err && <div style={{ color: "var(--text-danger, #ed4245)", fontSize: 12, marginTop: 4 }}>{err}</div>}
                <div style={{ fontSize: 11, color: "var(--text-muted, #72767d)", marginTop: 12 }}>
                    ⚠️ Never share your token — it gives full access to your account.
                </div>
            </ModalContent>
            <ModalFooter>
                <button
                    onClick={rootProps.onClose}
                    style={{
                        background: "var(--button-secondary-background, #4f545c)",
                        border: "none", borderRadius: "var(--radius-sm, 4px)",
                        color: "#fff", cursor: "pointer", fontSize: 14,
                        padding: "10px 20px", marginRight: 8,
                    }}
                >Cancel</button>
                <button
                    onClick={submit}
                    disabled={loading}
                    style={{
                        background: loading ? "var(--button-secondary-background, #4f545c)" : "var(--button-positive-background, #248046)",
                        border: "none", borderRadius: "var(--radius-sm, 4px)",
                        color: "#fff", cursor: loading ? "not-allowed" : "pointer",
                        fontSize: 14, fontWeight: 700, padding: "10px 24px",
                    }}
                >{loading ? "Connecting..." : "Login"}</button>
            </ModalFooter>
        </ModalRoot>
    );
}

let observer: MutationObserver | null = null;
const MOUNT_ID = "lwt-mount";

function openLoginModal() {
    openModal(props => <LoginWithTokenModal rootProps={props} />);
}

function onLoginButtonClick(e: MouseEvent) {
    e.preventDefault();
    openLoginModal();
}

function tryInject() {
    if (document.getElementById(MOUNT_ID)) return;

    const emailInput = document.querySelector(
        "input[name='email'], input[type='email'], input[autocomplete='username']"
    ) as HTMLElement | null;
    if (!emailInput) return;

    // Find the "Forgot password" link to inject just below
    let container: HTMLElement | null = emailInput.closest("form");
    for (let i = 0; i < 15 && container; i++) {
        const forgotLink = container.querySelector("a[href*='forgot'], button[class*='forgot'], [class*='forgotPassword']");
        if (forgotLink) {
            // Insert after the forgot password link
            const mount = document.createElement("div");
            mount.id = MOUNT_ID;
            mount.style.cssText = "margin-top:8px;text-align:center";

            const btn = document.createElement("button");
            btn.textContent = "Login with token";
            btn.style.cssText = [
                "background:none",
                "border:none",
                "color:var(--text-link,#00b0f4)",
                "cursor:pointer",
                "font-size:14px",
                "font-ffriendly:inherit",
                "padding:0",
                "text-decoration:underline",
            ].join(";");
            btn.addEventListener("click", onLoginButtonClick);

            mount.appendChild(btn);
            forgotLink.parentElement?.insertBefore(mount, forgotLink.nextSibling);
            return;
        }
        container = container?.parentElement ?? null;
    }

    // Fallback: append at the end of the form
    const form = emailInput.closest("form") as HTMLElement | null;
    if (!form) return;
    const mount = document.createElement("div");
    mount.id = MOUNT_ID;
    mount.style.cssText = "margin-top:8px;text-align:center";
    const btn = document.createElement("button");
    btn.textContent = "Login with token";
    btn.style.cssText = "background:none;border:none;color:var(--text-link,#00b0f4);cursor:pointer;font-size:14px;font-ffriendly:inherit;padding:0;text-decoration:underline";
    btn.addEventListener("click", onLoginButtonClick);
    mount.appendChild(btn);
    form.appendChild(mount);
}

function isOnLoginPage() {
    return location.pathname.startsWith("/login") || location.pathname.startsWith("/register");
}

function startObserver() {
    stopObserver();
    // On a logged-in client the login form never appears, so the body-subtree observer
    // below would wake on every DOM mutation for the whole session and re-run tryInject's
    // querySelector each time. Only watch while we are actually on the login route.
    if (!isOnLoginPage()) return;
    tryInject();
    if (document.getElementById(MOUNT_ID)) return;

    let queued = false;
    observer = new MutationObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
            queued = false;
            if (!observer || document.getElementById(MOUNT_ID)) return;
            tryInject();
            if (document.getElementById(MOUNT_ID)) {
                observer.disconnect();
                observer = null;
            }
        });
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

function stopObserver() {
    observer?.disconnect();
    observer = null;
    const mount = document.getElementById(MOUNT_ID);
    if (mount) {
        mount.querySelectorAll("button").forEach(btn => btn.removeEventListener("click", onLoginButtonClick));
        mount.remove();
    }
}

export default definePlugin({
    name: "LoginWithToken",
    description: "Adds a 'Login with Token' button on the Discord login page.",
    authors: [EquicordDevs.thororen],
    tags: ["Privacy", "Shortcuts"],
    start() { startObserver(); },
    stop() { stopObserver(); },
});
