/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { HeaderBarButton } from "@api/HeaderBar";
import { useSettings } from "@api/Settings";
import { getUserSetting } from "@api/UserSettings";
import { TestcordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import { t } from "@utils/testcordI18n";
import definePlugin from "@utils/types";
import { wreq } from "@webpack";
import { Toasts } from "@webpack/common";
// قيم ProfileVisibilityType (محقَّقة من توثيق بروتو إعدادات المستخدم):
//   0 UNSET (= 3) · 1 FRIENDS_ONLY · 2 FRIENDS_AND_SMALL_GUILDS · 3 FRIENDS_AND_ALL_GUILDS
const PRIVATE = 1; // الأصدقاء فقط — أقصى خصوصية (يُخفي الملف عن كل الخوادم)
const OPEN = 3; // الأصدقاء + كل الخوادم (الافتراضي)
const logger = new Logger("ProfileVisibility");
// نحلّ مُحدِّد الإعداد ("privacy","profileVisibility") = نفس ما يفعله سكربت الكونسول.
// المسار السريع: واجهة UserSettingsAPI (وحدة الإعدادات الموحّدة). فإن لم تجده هناك
// (قد تكون مجموعة privacy في وحدة أخرى) نمسح وحدات الـwebpack يدوياً تماماً كالسكربت —
// يُحلّ مرّة واحدة ويُخزَّن. هكذا يعمل بصرف النظر عن كيفية تجميع ديسكورد للوحدات.
let resolved;
let tried = false;
function scanWebpack() {
    const modules = wreq?.m;
    if (modules == null)
        return undefined;
    for (const id in modules) {
        let src;
        try {
            src = modules[id].toString();
        }
        catch {
            continue;
        }
        if (!src.includes("profileVisibility"))
            continue;
        const v = src.match(/(?:^|[;,])\s*(?:let|const|var)?\s*([A-Za-z_$][\w$]*)\s*=\s*[A-Za-z_$][\w$]*\(\s*["']privacy["']\s*,\s*["']profileVisibility["']/)?.[1];
        const e = v && src.match(new RegExp(`([A-Za-z_$][\\w$]*)\\s*:\\s*\\(\\)\\s*=>\\s*${v}\\b`))?.[1];
        if (!e)
            continue;
        try {
            const exp = wreq(id)?.[e];
            if (exp?.updateSetting)
                return exp;
        }
        catch { /* واصل المسح */ }
    }
    return undefined;
}
function setting() {
    if (tried)
        return resolved;
    tried = true;
    try {
        const api = getUserSetting("privacy", "profileVisibility");
        if (api?.updateSetting)
            resolved = api;
    }
    catch (e) {
        logger.warn("UserSettingsAPI lookup failed, falling back to webpack scan", e);
    }
    resolved ??= scanWebpack();
    if (resolved == null)
        logger.error("profileVisibility setting not found.");
    return resolved;
}
// قفل مُغلَق = خاص (أخضر «محميّ» ليظهر بوضوح أن الوضع الخاص مُفعَّل)
function LockClosedIcon({ width = 18, height = 18 }) {
    return (<svg width={width} height={height} viewBox="0 0 24 24" fill="none" stroke="var(--text-positive, #3ba55c)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="11" width="14" height="10" rx="2"/>
            <path d="M8 11V7a4 4 0 0 1 8 0v4"/>
        </svg>);
}
// قفل مفتوح = ظاهر
function LockOpenIcon({ width = 18, height = 18, color = "currentColor" }) {
    return (<svg width={width} height={height} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="11" width="14" height="10" rx="2"/>
            <path d="M8 11V6.5a4 4 0 0 1 7.6-1.7"/>
        </svg>);
}
async function toggle(s, currentlyPrivate) {
    const next = currentlyPrivate ? OPEN : PRIVATE;
    try {
        await s.updateSetting(next);
        Toasts.show({
            type: Toasts.Type.SUCCESS,
            message: next === PRIVATE
                ? t("ملفك الآن خاص — تفاصيلك للأصدقاء فقط", "Profile is now private — your details are Friends-Only")
                : t("ملفك الآن ظاهر لخوادمك وأصدقائك", "Your profile is now visible to your servers and friends"),
            id: Toasts.genId()
        });
    }
    catch (e) {
        logger.error("Failed to update profileVisibility", e);
        Toasts.show({
            type: Toasts.Type.FAILURE,
            message: t("تعذّر تغيير ظهور الملف", "Couldn't change profile visibility"),
            id: Toasts.genId()
        });
    }
}
function ProfileVisibilityButton() {
    // إعادة الرسم عند تبديل لغة الواجهة حتى يتحدّث التلميح فوراً.
    useSettings(["plugins.Settings.arabicMode"]);
    const s = setting();
    if (s == null)
        return null;
    const isPrivate = s.useSetting() === PRIVATE;
    return (<HeaderBarButton icon={isPrivate ? LockClosedIcon : LockOpenIcon} tooltip={isPrivate
            ? t("ملفك خاص — التفاصيل للأصدقاء فقط · اضغط للإظهار", "Profile private — details Friends-Only · click to show")
            : t("ملفك ظاهر لخوادمك · اضغط لجعله خاصاً", "Profile visible to your servers · click to make private")} aria-label={t("ظهور الملف الشخصي", "Profile visibility")} selected={isPrivate} onClick={() => toggle(s, isPrivate)}/>);
}
export default definePlugin({
    name: "ProfileVisibility",
    description: "Toggle your Discord profile visibility (private — Friends Only — vs visible to all servers) with a button in the top bar.",
    authors: [TestcordDevs.LOSTSTR],
    tags: ["Privacy", "Shortcuts"],
    dependencies: ["UserSettingsAPI", "HeaderBarAPI"],
    headerBarButton: {
        icon: LockClosedIcon,
        render: ProfileVisibilityButton,
    },
});
