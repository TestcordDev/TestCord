/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import test from "node:test";

import { buildCaptchaHeaders, parseCaptchaChallenge } from "../src/testcordplugins/autoRedeem/captcha.ts";

const SITEKEY = "site-key";
const TOKEN = "captcha-token";
const RQDATA = "rqdata";
const RQTOKEN = "rqtoken";
const SESSION_ID = "session-id";

test("recognizes any 400 response containing a captcha key", () => {
    const challenge = parseCaptchaChallenge({
        captcha_key: ["response-already-used-error"],
        captcha_service: "hcaptcha",
        captcha_sitekey: SITEKEY,
    }, 400);
    assert.equal(challenge?.sitekey, SITEKEY);
    assert.equal(parseCaptchaChallenge({ captcha_key: ["captcha-required"] }, 200), null);
    assert.equal(parseCaptchaChallenge({ message: "ordinary error" }, 400), null);
});

test("extracts the challenge fields without confusing rqdata and rqtoken", () => {
    const challenge = parseCaptchaChallenge({
        captcha_key: ["captcha-required"],
        captcha_service: "hcaptcha",
        captcha_sitekey: SITEKEY,
        captcha_rqdata: RQDATA,
        captcha_rqtoken: RQTOKEN,
        captcha_session_id: SESSION_ID,
    }, 400);
    assert.deepEqual(challenge, {
        service: "hcaptcha",
        sitekey: SITEKEY,
        rqdata: RQDATA,
        rqtoken: RQTOKEN,
        sessionId: SESSION_ID,
    });
});

test("builds current Discord CAPTCHA headers", () => {
    const challenge = parseCaptchaChallenge({
        captcha_key: ["captcha-required"],
        captcha_sitekey: SITEKEY,
        captcha_rqdata: RQDATA,
        captcha_rqtoken: RQTOKEN,
        captcha_session_id: SESSION_ID,
    }, 400);
    assert.notEqual(challenge, null);
    if (!challenge) return;
    assert.deepEqual(buildCaptchaHeaders(TOKEN, challenge), {
        "X-Captcha-Key": TOKEN,
        "X-Captcha-Session-Id": SESSION_ID,
        "X-Captcha-Rqtoken": RQTOKEN,
    });
});

test("rejects header values containing newlines", () => {
    const challenge = parseCaptchaChallenge({ captcha_key: ["captcha-required"] }, 400);
    assert.notEqual(challenge, null);
    if (!challenge) return;
    assert.throws(() => buildCaptchaHeaders(`${TOKEN}\r\nInjected: yes`, challenge));
});
