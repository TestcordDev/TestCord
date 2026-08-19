/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { createHash } from "crypto";
function getUSADate() {
    const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    });
    const parts = formatter.formatToParts(new Date());
    const getValue = (type) => parts.find(p => p.type === type).value;
    return {
        year: getValue("year"),
        month: getValue("month"),
        day: getValue("day")
    };
}
function generateHoneypotToken() {
    const { day, year, month } = getUSADate();
    return `${day}${Buffer.from(`WhereGoes honeypot ${year}-${month}`).toString("base64")}=`;
}
function generateHumanCookie() {
    const { year, month } = getUSADate();
    const ym = `${year}${month}`;
    return createHash("sha1").update(`wg-${ym}`).digest("hex");
}
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";
export async function traceUrl(_, url) {
    try {
        const body = new URLSearchParams({
            url,
            ua: "Wheregoes.com Redirect Checker/1.0",
            phn: "",
            php: generateHoneypotToken()
        });
        const res = await fetch("https://wheregoes.com/trace/", {
            method: "POST",
            headers: {
                "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
                "accept-language": "en-US,en;q=0.9",
                "cache-control": "max-age=0",
                "content-type": "application/x-www-form-urlencoded",
                "cookie": `human=${generateHumanCookie()}`,
                "origin": "https://wheregoes.com",
                "referer": "https://wheregoes.com/",
                "sec-fetch-dest": "document",
                "sec-fetch-mode": "navigate",
                "sec-fetch-site": "same-origin",
                "sec-fetch-user": "?1",
                "upgrade-insecure-requests": "1",
                "user-agent": UA
            },
            body: body.toString(),
            redirect: "follow"
        });
        const html = await res.text();
        const debug = {
            cookie: generateHumanCookie(),
            honeypot: generateHoneypotToken(),
            body: body.toString(),
            responseStatus: res.status,
            responseHeaders: Object.fromEntries(res.headers.entries()),
            responseBodyPreview: html.slice(0, 500)
        };
        if (!res.ok) {
            return { status: res.status, html: null, error: `HTTP ${res.status}`, debug };
        }
        return { status: 200, html, debug };
    }
    catch (e) {
        return { status: -1, html: null, error: String(e) };
    }
}
