/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface CaptchaChallenge {
    service: string;
    sitekey?: string;
    rqdata?: string;
    rqtoken?: string;
    sessionId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function readField(body: Record<string, unknown>, key: string): string | undefined {
    const value = body[key];
    return typeof value === "string" && value.length > 0 && !/[\r\n]/.test(value) ? value : undefined;
}

export function parseCaptchaChallenge(body: unknown, status: number): CaptchaChallenge | null {
    if (!isRecord(body) || (status !== 400 && status !== 0)) return null;
    const hasCaptchaKey = Array.isArray(body.captcha_key);
    const sitekey = readField(body, "captcha_sitekey");
    if (!hasCaptchaKey && !sitekey) return null;
    return {
        service: readField(body, "captcha_service") ?? "hcaptcha",
        sitekey,
        rqdata: readField(body, "captcha_rqdata"),
        rqtoken: readField(body, "captcha_rqtoken"),
        sessionId: readField(body, "captcha_session_id"),
    };
}

export function buildCaptchaHeaders(token: string, challenge: CaptchaChallenge): Record<string, string> {
    if (!token || /[\r\n]/.test(token)) throw new Error("Invalid CAPTCHA token.");
    const headers: Record<string, string> = { "X-Captcha-Key": token };
    if (challenge.sessionId) headers["X-Captcha-Session-Id"] = challenge.sessionId;
    if (challenge.rqtoken) headers["X-Captcha-Rqtoken"] = challenge.rqtoken;
    return headers;
}
