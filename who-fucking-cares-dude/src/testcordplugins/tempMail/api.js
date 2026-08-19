/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
const BASE = "https://api.mail.tm";
// ── Domain helpers ────────────────────────────────────────────────────────────
export async function getDomains() {
    const r = await fetch(`${BASE}/domains?page=1`);
    const data = await r.json();
    return data["hydra:member"] ?? [];
}
// ── Account ───────────────────────────────────────────────────────────────────
export async function createAccount(address, password) {
    const r = await fetch(`${BASE}/accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, password }),
    });
    if (!r.ok)
        throw new Error(`Failed to create account: ${r.status}`);
    return r.json();
}
export async function getToken(address, password) {
    const r = await fetch(`${BASE}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, password }),
    });
    if (!r.ok)
        throw new Error(`Failed to get token: ${r.status}`);
    const data = await r.json();
    return data.token;
}
export async function deleteAccount(id, token) {
    await fetch(`${BASE}/accounts/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
    });
}
// ── Messages ──────────────────────────────────────────────────────────────────
export async function getMessages(token, page = 1) {
    const r = await fetch(`${BASE}/messages?page=${page}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok)
        throw new Error(`Failed to fetch messages: ${r.status}`);
    const data = await r.json();
    return data["hydra:member"] ?? [];
}
export async function getMessage(id, token) {
    const r = await fetch(`${BASE}/messages/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok)
        throw new Error(`Failed to fetch message: ${r.status}`);
    return r.json();
}
export async function deleteMessage(id, token) {
    await fetch(`${BASE}/messages/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
    });
}
// ── Utility ───────────────────────────────────────────────────────────────────
export function randomString(len = 10) {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}
