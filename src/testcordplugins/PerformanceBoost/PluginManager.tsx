/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Esharq — تعطيل الإضافات مربوطٌ بتفعيل وضع الأداء (gameMode): عند تفعيله يُعطَّل كل غير
 * الأساسيّة عدا استثناءاتك ويُطلَب إعادة تشغيل ليُطبَّق كل شيء؛ وعند إطفائه تُستعاد الحالة
 * كاملةً. زرّ «الاستثناءات» يفتح نافذةً بتصميم Discord تعرض الإضافات المُفعّلة فقط. لا تُلمَس
 * إعدادات أيّ إضافة — يُبدَّل علم `enabled` فقط.
 */

import { Button, TextButton } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import { Switch } from "@components/Switch";
import { Margins } from "@utils/margins";
import { relaunch } from "@utils/native";
import { t } from "@utils/testcordI18n";
import { RenderModalProps } from "@vencord/discord-types";
import { Alerts, Modal, openModal, TextInput, useMemo, useState } from "@webpack/common";

import { enabledTogglablePlugins, enterPerformanceMode, exitPerformanceMode, parseKeep } from "./pluginToggle";
import { settings } from "./settings";

function promptRestart() {
    Alerts.show({
        title: t("إعادة تشغيل مطلوبة", "Restart Required"),
        body: <Paragraph>{t("يجب إعادة تشغيل Discord لتطبيق تغيير الإضافات.", "Discord must restart to apply the plugin changes.")}</Paragraph>,
        confirmText: t("أعد التشغيل الآن", "Restart Now"),
        cancelText: t("لاحقاً", "Later"),
        onConfirm: () => relaunch(),
    });
}

/**
 * مُستمِع تغيّر مفتاح وضع الأداء (gameMode) — يُسجَّل تلقائياً عبر onChange في تعريف الإعداد،
 * فيعمل سواء من مفتاح الإعدادات أو زرّ الشريط العلوي (كلاهما يغيّر gameMode). أمّا الكشف
 * التلقائي عن الألعاب فلا يغيّر gameMode ⇒ لا يُعطّل الإضافات ولا يطلب إعادة تشغيل.
 */
export function handleGameModeChange(value: boolean) {
    if (value) {
        // دخول: نحفظ لقطة ما كان مُفعّلاً ونعطّل غير المُستثنى. الحارس يمنع الدخول المزدوج.
        if (!settings.store.pluginSaved) {
            settings.store.pluginSaved = JSON.stringify(enterPerformanceMode(parseKeep(settings.store.pluginKeep)));
            promptRestart();
        }
    } else if (settings.store.pluginSaved) {
        // خروج: نستعيد كل ما كان مُفعّلاً كما كان بالضبط.
        let saved: string[] = [];
        try { saved = JSON.parse(settings.store.pluginSaved || "[]"); } catch { /* تجاهل */ }
        exitPerformanceMode(saved);
        settings.store.pluginSaved = "";
        promptRestart();
    }
}

/** قائمة الإضافات المُفعّلة فعلاً لدى المستخدم — حتى وإن كان الوضع مُفعّلاً (نضمّ اللقطة المحفوظة). */
function userEnabledPlugins(): string[] {
    const set = new Set(enabledTogglablePlugins());
    if (settings.store.pluginSaved) {
        try { for (const n of JSON.parse(settings.store.pluginSaved || "[]")) set.add(n); } catch { /* تجاهل */ }
    }
    return [...set].sort((a, b) => a.localeCompare(b));
}

function ExceptionsModal({ modalProps }: { modalProps: RenderModalProps; }) {
    const [query, setQuery] = useState("");
    const [keep, setKeep] = useState<Set<string>>(() => new Set(parseKeep(settings.store.pluginKeep)));

    const enabled = useMemo(userEnabledPlugins, []);

    const persist = (next: Set<string>) => {
        setKeep(new Set(next));
        settings.store.pluginKeep = [...next].join(",");
    };
    const toggle = (name: string) => {
        const next = new Set(keep);
        if (next.has(name)) next.delete(name); else next.add(name);
        persist(next);
    };
    const keepAll = () => persist(new Set(enabled));
    const clearAll = () => persist(new Set());

    const q = query.toLowerCase();
    const shown = enabled.filter(n => n.toLowerCase().includes(q));

    // ملخّص: كم يبقى مُفعّلاً وكم سيُعطَّل من إضافات المستخدم المُفعّلة.
    const keptCount = enabled.filter(n => keep.has(n)).length;
    const disableCount = enabled.length - keptCount;

    return (
        <Modal
            {...modalProps}
            title={t("استثناءات وضع الأداء", "Performance Mode Exceptions")}
            subtitle={t("الإضافات المُفعّلة لديك. أبقِ ما تريده مُفعّلاً؛ البقيّة تُعطَّل مؤقّتاً وتُستعاد لاحقاً.", "Your enabled plugins. Keep the ones you want on; the rest are turned off temporarily and restored later.")}
            actions={[{ text: t("تمّ", "Done"), variant: "primary", onClick: modalProps.onClose }]}
        >
            {enabled.length === 0 ? (
                <Paragraph style={{ padding: "24px 12px", textAlign: "center" }}>
                    {t("لا توجد إضافات اختياريّة مُفعّلة.", "No optional plugins are enabled.")}
                </Paragraph>
            ) : (
                <>
                    <TextInput
                        className={Margins.bottom8}
                        placeholder={t("ابحث عن إضافة…", "Search a plugin…")}
                        value={query}
                        onChange={setQuery}
                    />
                    <div className="vc-perfboost-pm-toolbar">
                        <span className="vc-perfboost-pm-summary">
                            <span><b>{keptCount}</b> {t("تبقى", "kept")}</span>
                            <span><b>{disableCount}</b> {t("تُعطَّل", "off")}</span>
                        </span>
                        <span className="vc-perfboost-pm-actions">
                            <TextButton variant="primary" onClick={keepAll}>{t("إبقاء الكل", "Keep all")}</TextButton>
                            <TextButton variant="secondary" onClick={clearAll}>{t("مسح", "Clear")}</TextButton>
                        </span>
                    </div>
                    <div className="vc-perfboost-pm-list">
                        {shown.map(name => (
                            <div key={name} className="vc-perfboost-pm-row">
                                <span className="vc-perfboost-pm-name" onClick={() => toggle(name)}>{name}</span>
                                <Switch checked={keep.has(name)} onChange={() => toggle(name)} />
                            </div>
                        ))}
                        {shown.length === 0 && (
                            <Paragraph style={{ padding: 12, textAlign: "center" }}>{t("لا نتائج", "No results")}</Paragraph>
                        )}
                    </div>
                </>
            )}
        </Modal>
    );
}

/** قسم الإعدادات: شرح الربط بوضع الأداء + زرّ الاستثناءات. يظهر ضمن إعدادات PerformanceBoost. */
export function PluginManagerControls() {
    const { pluginKeep } = settings.use(["pluginKeep"]);
    const keepCount = parseKeep(pluginKeep).length;

    return (
        <div className="vc-perfboost-pm-controls">
            <Paragraph className="vc-perfboost-pm-hint">
                {t(
                    "عند تفعيل وضع الأداء أعلاه، تُعطَّل بقيّة الإضافات (عدا الأساسيّة واستثناءاتك) مؤقّتاً مع طلب إعادة تشغيل، وتُستعاد كما كانت عند الإطفاء.",
                    "When performance mode is enabled above, other plugins (except essentials and your exceptions) are temporarily disabled with a restart prompt, and restored when it's turned off."
                )}
            </Paragraph>
            <Button
                variant="secondary"
                size="small"
                onClick={() => openModal(modalProps => <ExceptionsModal modalProps={modalProps} />)}
            >
                {t(`الاستثناءات (${keepCount})`, `Exceptions (${keepCount})`)}
            </Button>
        </div>
    );
}
