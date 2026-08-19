/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
// Note: Auto-translated
import { Button, TextButton } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import { Switch } from "@components/Switch";
import { Margins } from "@utils/margins";
import { relaunch } from "@utils/native";
import { t } from "@utils/testcordI18n";
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
 * Handler for gameMode setting changes — triggered automatically via onChange in setting definition.
 */
export function handleGameModeChange(value) {
    if (value) {
        // Entering performance mode: save snapshot of enabled plugins and disable non-excepted plugins.
        if (!settings.store.pluginSaved) {
            settings.store.pluginSaved = JSON.stringify(enterPerformanceMode(parseKeep(settings.store.pluginKeep)));
            promptRestart();
        }
    }
    else if (settings.store.pluginSaved) {
        // Exiting performance mode: restore previously enabled plugins.
        let saved = [];
        try {
            saved = JSON.parse(settings.store.pluginSaved || "[]");
        }
        catch { /* ignore */ }
        exitPerformanceMode(saved);
        settings.store.pluginSaved = "";
        promptRestart();
    }
}
/** List of currently enabled plugins for the user, including saved snapshot if active. */
function userEnabledPlugins() {
    const set = new Set(enabledTogglablePlugins());
    if (settings.store.pluginSaved) {
        try {
            for (const n of JSON.parse(settings.store.pluginSaved || "[]"))
                set.add(n);
        }
        catch { /* ignore */ }
    }
    return [...set].sort((a, b) => a.localeCompare(b));
}
function ExceptionsModal({ modalProps }) {
    const [query, setQuery] = useState("");
    const [keep, setKeep] = useState(() => new Set(parseKeep(settings.store.pluginKeep)));
    const enabled = useMemo(userEnabledPlugins, []);
    const persist = (next) => {
        setKeep(new Set(next));
        settings.store.pluginKeep = [...next].join(",");
    };
    const toggle = (name) => {
        const next = new Set(keep);
        if (next.has(name))
            next.delete(name);
        else
            next.add(name);
        persist(next);
    };
    const keepAll = () => persist(new Set(enabled));
    const clearAll = () => persist(new Set());
    const q = query.toLowerCase();
    const shown = enabled.filter(n => n.toLowerCase().includes(q));
    // Summary: count kept vs disabled plugins.
    const keptCount = enabled.filter(n => keep.has(n)).length;
    const disableCount = enabled.length - keptCount;
    return (<Modal {...modalProps} title={t("استثناءات وضع الأداء", "Performance Mode Exceptions")} subtitle={t("الإضافات المُفعّلة لديك. أبقِ ما تريده مُفعّلاً؛ البقيّة تُعطَّل مؤقّتاً وتُستعاد لاحقاً.", "Your enabled plugins. Keep the ones you want on; the rest are turned off temporarily and restored later.")} actions={[{ text: t("تمّ", "Done"), variant: "primary", onClick: modalProps.onClose }]}>
            {enabled.length === 0 ? (<Paragraph style={{ padding: "24px 12px", textAlign: "center" }}>
                    {t("لا توجد إضافات اختياريّة مُفعّلة.", "No optional plugins are enabled.")}
                </Paragraph>) : (<>
                    <TextInput className={Margins.bottom8} placeholder={t("ابحث عن إضافة…", "Search a plugin…")} value={query} onChange={setQuery}/>
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
                        {shown.map(name => (<div key={name} className="vc-perfboost-pm-row">
                                <span className="vc-perfboost-pm-name" onClick={() => toggle(name)}>{name}</span>
                                <Switch checked={keep.has(name)} onChange={() => toggle(name)}/>
                            </div>))}
                        {shown.length === 0 && (<Paragraph style={{ padding: 12, textAlign: "center" }}>{t("لا نتائج", "No results")}</Paragraph>)}
                    </div>
                </>)}
        </Modal>);
}
/** Settings component: explanation and exceptions modal button. */
export function PluginManagerControls() {
    const { pluginKeep } = settings.use(["pluginKeep"]);
    const keepCount = parseKeep(pluginKeep).length;
    return (<div className="vc-perfboost-pm-controls">
            <Paragraph className="vc-perfboost-pm-hint">
                {t("عند تفعيل وضع الأداء أعلاه، تُعطَّل بقيّة الإضافات (عدا الأساسيّة واستثناءاتك) مؤقّتاً مع طلب إعادة تشغيل، وتُستعاد كما كانت عند الإطفاء.", "When performance mode is enabled above, other plugins (except essentials and your exceptions) are temporarily disabled with a restart prompt, and restored when it's turned off.")}
            </Paragraph>
            <Button variant="secondary" size="small" onClick={() => openModal(modalProps => <ExceptionsModal modalProps={modalProps}/>)}>
                {t(`الاستثناءات (${keepCount})`, `Exceptions (${keepCount})`)}
            </Button>
        </div>);
}
