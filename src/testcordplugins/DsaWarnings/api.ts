/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { PluginNative } from "@utils/types";

import type { BreachRecord, CordCatUserInfo, DsaAction, DsaLookupResult } from "./types";

const logger = new Logger("DsaWarnings");
const SUCCESS_CACHE_TTL_MS = 5 * 60 * 1000;
const ERROR_CACHE_TTL_MS = 60 * 1000;
const RESULT_CACHE_MAX = 200;
const Native = VencordNative.pluginHelpers.DsaWarnings as PluginNative<typeof import("./native")>;

const resultCache = new Map<string, { expiresAt: number; result: DsaLookupResult; }>();

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function getString(record: Record<string, unknown>, key: string) {
    return typeof record[key] === "string" ? record[key] : "";
}

function getNullableString(record: Record<string, unknown>, key: string) {
    const v = record[key];
    return v == null || typeof v === "string" ? (v as string | null) : null;
}

function isBreachRecord(value: unknown): value is BreachRecord {
    if (!isRecord(value) || typeof value.source !== "string") return false;
    return value.categories == null || Array.isArray(value.categories) && value.categories.every(item => typeof item === "string");
}

function parseStringArray(value: unknown) {
    if (Array.isArray(value)) {
        return value.filter((item): item is string => typeof item === "string" && item.length > 0);
    }
    if (value == null || typeof value !== "string" || value.length === 0) {
        return [];
    }
    try {
        const parsed: unknown = JSON.parse(value);
        return Array.isArray(parsed)
            ? parsed.filter((item): item is string => typeof item === "string" && item.length > 0)
            : [];
    } catch {
        return [];
    }
}

function asNonEmptyString(value: string | null | undefined) {
    return typeof value === "string" && value.length > 0 ? value : null;
}

function parseUserInfo(payload: Record<string, unknown>): CordCatUserInfo | null {
    const raw = payload.userInfo;
    if (!isRecord(raw)) return null;

    const parseGuildIdentity = (v: unknown) => {
        if (!isRecord(v)) return null;
        if (typeof v.tag !== "string" || typeof v.identity_guild_id !== "string") return null;
        return {
            tag: v.tag,
            identity_guild_id: v.identity_guild_id,
            identity_enabled: v.identity_enabled === true
        };
    };

    return {
        id: getString(raw, "id"),
        username: asNonEmptyString(getString(raw, "username")) ?? undefined,
        global_name: asNonEmptyString(getNullableString(raw, "global_name")) ?? undefined,
        discriminator: asNonEmptyString(getString(raw, "discriminator")) ?? undefined,
        avatar: asNonEmptyString(getNullableString(raw, "avatar")) ?? undefined,
        banner: asNonEmptyString(getNullableString(raw, "banner")) ?? undefined,
        public_flags: typeof raw.public_flags === "number" ? raw.public_flags : undefined,
        accent_color: typeof raw.accent_color === "number" ? raw.accent_color : null,
        clan: parseGuildIdentity(raw.clan),
        primary_guild: parseGuildIdentity(raw.primary_guild),
    };
}

function normalizeCordCatStatement(value: unknown, parsedId: string): DsaAction | null {
    if (!isRecord(value)) return null;

    const category = getString(value, "category");
    const decisionProvision = getNullableString(value, "decision_provision");
    if (!category && !decisionProvision) return null;

    return {
        uuid: getString(value, "uuid") || getString(value, "id") || `${parsedId}-${category}-${getString(value, "application_date")}`,
        parsedId,
        decisionVisibility: getNullableString(value, "decision_visibility"),
        endDateVisibilityRestriction: getNullableString(value, "end_date_visibility_restriction"),
        decisionMonetary: getNullableString(value, "decision_monetary"),
        endDateMonetaryRestriction: getNullableString(value, "end_date_monetary_restriction"),
        decisionProvision,
        endDateServiceRestriction: getNullableString(value, "end_date_service_restriction"),
        decisionAccount: getNullableString(value, "decision_account"),
        endDateAccountRestriction: getNullableString(value, "end_date_account_restriction"),
        decisionGround: getString(value, "decision_ground") || getString(value, "incompatible_content_ground"),
        incompatibleContentGround: getString(value, "incompatible_content_ground"),
        incompatibleContentExplanation: getString(value, "incompatible_content_explanation"),
        incompatibleContentIllegal: value.incompatible_content_illegal as string | boolean | null,
        category,
        categorySpecification: (value.category_specification ?? null) as string | string[] | null,
        categorySpecificationOther: getNullableString(value, "category_specification_other"),
        contentType: (value.content_type ?? value.decision_provision ?? "") as string | string[],
        applicationDate: getString(value, "application_date"),
        decisionFacts: getString(value, "decision_facts"),
        automatedDetection: (value.automated_detection ?? "") as string | boolean,
        sourceType: getString(value, "source_type"),
        createdAt: getString(value, "created_at") || getString(value, "application_date")
    };
}

function isRestrictionActive(endDate: string | null) {
    if (endDate == null || endDate.length === 0) return true;
    const parsed = Date.parse(endDate);
    if (Number.isNaN(parsed)) return true;
    return parsed > Date.now();
}

export function getActiveRestrictionLabels(action: DsaAction) {
    const labels: string[] = [];
    const decisionVisibility: string[] = Array.isArray(action.decisionVisibility)
        ? action.decisionVisibility.filter((v): v is string => typeof v === "string" && v.length > 0)
        : asNonEmptyString(action.decisionVisibility)
            ? [asNonEmptyString(action.decisionVisibility)!]
            : [];

    if (action.decisionAccount && isRestrictionActive(action.endDateAccountRestriction)) {
        labels.push(action.decisionAccount);
    }
    if (action.decisionProvision && isRestrictionActive(action.endDateServiceRestriction)) {
        labels.push(action.decisionProvision);
    }
    if (action.decisionMonetary && isRestrictionActive(action.endDateMonetaryRestriction)) {
        labels.push(action.decisionMonetary);
    }
    if (decisionVisibility.length && isRestrictionActive(action.endDateVisibilityRestriction)) {
        labels.push(...decisionVisibility);
    }

    return Array.from(new Set(labels.filter(Boolean)));
}

export function getActionTags(action: DsaAction) {
    const specs = parseStringArray(action.categorySpecification);
    if (specs.length > 0) return specs;
    const other = parseStringArray(action.categorySpecificationOther);
    return other;
}

function setCache(parsedId: string, result: DsaLookupResult) {
    const ttl = result.kind === "ready" ? SUCCESS_CACHE_TTL_MS : ERROR_CACHE_TTL_MS;
    const now = Date.now();
    for (const [key, entry] of resultCache) {
        if (entry.expiresAt <= now) resultCache.delete(key);
    }
    resultCache.set(parsedId, { expiresAt: Date.now() + ttl, result });
    while (resultCache.size > RESULT_CACHE_MAX) {
        const oldest = resultCache.keys().next().value;
        if (!oldest) break;
        resultCache.delete(oldest);
    }
    return result;
}

export function invalidateWarnings(parsedId?: string) {
    if (parsedId) {
        resultCache.delete(parsedId);
        return;
    }
    resultCache.clear();
}

function parseReadyResponse(parsedId: string, body: string): DsaLookupResult | null {
    const payload: unknown = JSON.parse(body);
    if (!isRecord(payload)) return null;

    const userInfo = parseUserInfo(payload);

    const statements: unknown[] = Array.isArray(payload.statements) ? payload.statements : [];
    const allActions = statements
        .map(s => normalizeCordCatStatement(s, parsedId))
        .filter((a): a is DsaAction => a !== null)
        .sort((a, b) => Date.parse(b.applicationDate) - Date.parse(a.applicationDate));

    const activeActions = allActions.filter(a => getActiveRestrictionLabels(a).length > 0);

    const breachObj = isRecord(payload.breach) ? payload.breach : null;
    const breachSuccess = breachObj?.success === true;
    const breachFailed = breachObj?.success === false;

    let breaches: BreachRecord[] = [];
    let breachError: string | null = null;
    let breachCount = 0;

    if (breachSuccess) {
        const breachData = isRecord(breachObj!.data) ? breachObj!.data : null;
        const results = Array.isArray(breachData?.results) ? breachData!.results : [];
        breaches = results.filter(isBreachRecord);
        breachCount = typeof breachObj!.resultsCount === "number" ? breachObj!.resultsCount : breaches.length;
    } else if (breachFailed && isRecord(breachObj!.error)) {
        const errObj = breachObj!.error as Record<string, unknown>;
        breachError = `${errObj.status ?? "unknown"}: ${errObj.message ?? "unknown error"}`;
    }

    const breachStatus = breachSuccess ? "ready" as const
        : breachFailed ? "error" as const
        : "unavailable" as const;

    return {
        kind: "ready",
        userInfo,
        actions: activeActions,
        breaches,
        breachStatus,
        breachError,
        breachCount
    };
}

export async function fetchActiveWarnings(parsedId: string): Promise<DsaLookupResult> {
    const cached = resultCache.get(parsedId);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.result;
    }

    try {
        const nativeResult = await Native.fetchCordCatQuery?.(parsedId);

        if (!nativeResult?.ok) {
            const msg = (nativeResult as any)?.error ?? "Native fetch returned no result";
            if (!msg.includes("No CordCat API key")) {
                logger.warn("Native call failed:", msg);
            }
            return setCache(parsedId, { kind: "error", error: msg });
        }

        if (nativeResult.status === 503) {
            const msg = `CordCat returned 503: ${(nativeResult.body ?? "").slice(0, 200)}`;
            logger.warn(msg);
            return setCache(parsedId, { kind: "unavailable", error: msg });
        }

        if (nativeResult.status === 401 || nativeResult.status === 403) {
            logger.warn(`CordCat returned ${nativeResult.status}, opening captcha window to authenticate`);
            try {
                await Native.openCaptchaWindow?.(parsedId);
            } catch (e) {
                logger.warn("Failed to open captcha window:", e);
            }
            try {
                const retryResult = await Native.fetchCordCatQuery?.(parsedId);
                if (retryResult?.ok && retryResult.status >= 200 && retryResult.status < 300) {
                    const parsed = parseReadyResponse(parsedId, retryResult.body);
                    if (parsed) return setCache(parsedId, parsed);
                }
                const msg = `CordCat returned ${retryResult?.ok ? retryResult.status : "unknown"} after captcha authentication`;
                logger.warn(msg);
                return setCache(parsedId, { kind: "error", error: msg });
            } catch (e) {
                const msg = `Retry failed after captcha: ${e instanceof Error ? e.message : String(e)}`;
                logger.warn(msg);
                return setCache(parsedId, { kind: "error", error: msg });
            }
        }

        if (nativeResult.status < 200 || nativeResult.status >= 300) {
            const msg = `CordCat returned HTTP ${nativeResult.status}: ${(nativeResult.body ?? "").slice(0, 200)}`;
            logger.warn(msg);
            return setCache(parsedId, { kind: "error", error: msg });
        }

        const parsed = parseReadyResponse(parsedId, nativeResult.body);
        if (parsed) return setCache(parsedId, parsed);

        const msg = "CordCat response is not a valid JSON object";
        logger.warn(msg);
        return setCache(parsedId, { kind: "error", error: msg });
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(`Failed to fetch CordCat data for ${parsedId}`, error);
        return setCache(parsedId, { kind: "error", error: msg });
    }
}
