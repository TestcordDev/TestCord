/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app, IpcMainInvokeEvent } from "electron";
import { rm } from "fs/promises";
import { constants as osConstants, setPriority as setOsPriority } from "os";
import { join } from "path";

// كل عمليات Discord (الرئيسية + العرض + GPU) عبر Electron app.getAppMetrics() —
// لا PowerShell (تجنّباً لإطلاق عملية خارجية مريبة أمنياً/AV) ولا C++.
// عند الفشل نرجع للعملية الرئيسية فقط (process.pid).
function getAllDiscordPids(): number[] {
    try {
        const pids = app.getAppMetrics()
            .map(m => m.pid)
            .filter((p): p is number => typeof p === "number" && p > 0);
        return pids.length ? Array.from(new Set(pids)) : [process.pid];
    } catch {
        return [process.pid];
    }
}

// ✅ إجمالي استهلاك المعالج لكل عمليات Discord (نسبة من نواة واحدة؛ قد تتجاوز 100).
// عبر Electron app.getAppMetrics() نفسه — لا PowerShell ولا أي عملية خارجية.
// percentCPUUsage تُحتسب منذ النداء السابق، فالنداء الأول يُرجِع 0 — غير ضارّ لأن مراقب
// الحمل يشترط عيّنتين متتاليتين فوق الحدّ قبل أي تصرّف.
export function getTotalCpu(_e: IpcMainInvokeEvent): number {
    try {
        let total = 0;
        for (const m of app.getAppMetrics()) total += m.cpu?.percentCPUUsage ?? 0;
        return total;
    } catch {
        return 0;
    }
}

// ✅ خفض أولوية كل عمليات Discord عبر os.setPriority المدمج (Windows فقط).
// خفض الأولوية لعملياتك لا يتطلب صلاحيات مدير؛ بعض العمليات قد ترفض فنتجاهلها.
export async function setProcessPriority(_e: IpcMainInvokeEvent, level: "belowNormal" | "normal"): Promise<{ ok: boolean; reason: string; changed: number; }> {
    if (process.platform !== "win32") {
        return { ok: false, reason: "Windows only", changed: 0 };
    }
    const priority = level === "belowNormal"
        ? osConstants.priority.PRIORITY_BELOW_NORMAL
        : osConstants.priority.PRIORITY_NORMAL;

    let changed = 0;
    for (const pid of getAllDiscordPids()) {
        try {
            setOsPriority(pid, priority);
            changed++;
        } catch {
            // عملية محميّة/مرفوضة — نتجاهل بأمان لكل PID على حدة
        }
    }
    return changed > 0
        ? { ok: true, reason: "", changed }
        : { ok: false, reason: "no processes updated", changed: 0 };
}

// ✅ إعادة تشغيل موثوقة عبر Electron مباشرةً (نفس نمط src/main/utils/constants.ts):
// app.relaunch() يجدول إعادة التشغيل عند الخروج، و app.exit(0) يخرج فوراً.
// أكثر موثوقية من جسور العارض (DiscordNative/VesktopNative) التي قد تصمت أحياناً.
export function relaunchApp(_e: IpcMainInvokeEvent): void {
    app.relaunch();
    app.exit(0);
}

// يحدد مجلد بيانات نسخة Discord الحالية (stable/ptb/canary/development) من مسار التنفيذ.
// عند أي فشل في الاكتشاف يرجع للمجلد الافتراضي "discord" (خطة احتياطية).
function getDiscordAppDataPath(appData: string): string {
    try {
        const exe = process.execPath.toLowerCase();
        // الأكثر تحديداً أولاً — "discord" جزء من جميع الأسماء.
        if (exe.includes("discorddevelopment")) return join(appData, "discorddevelopment");
        if (exe.includes("discordcanary")) return join(appData, "discordcanary");
        if (exe.includes("discordptb")) return join(appData, "discordptb");
    } catch {
        // تجاهل — نستخدم الافتراضي أدناه
    }
    return join(appData, "discord");
}

// ✅ حقيقي: حذف مجلدات كاش Discord عبر fs. الملفات قيد الاستخدام تفشل بأمان (try/catch).
export async function cleanCache(_e: IpcMainInvokeEvent): Promise<{ ok: boolean; cleared: number; }> {
    const appData = process.env.APPDATA; // %AppData% (Windows)
    if (!appData) return { ok: false, cleared: 0 };

    const base = getDiscordAppDataPath(appData);
    const targets = [
        join(base, "Cache"),
        join(base, "Code Cache"),
        join(base, "GPUCache"),
    ];

    let cleared = 0;
    for (const dir of targets) {
        try {
            await rm(dir, { recursive: true, force: true });
            cleared++;
        } catch {
            // مقفول/قيد الاستخدام — نتجاهل بأمان
        }
    }
    return { ok: cleared > 0, cleared };
}
