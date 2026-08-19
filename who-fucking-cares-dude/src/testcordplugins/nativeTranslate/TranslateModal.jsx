/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Divider } from "@components/Divider";
import { FormSwitch } from "@components/FormSwitch";
import { HeadingPrimary, HeadingSecondary } from "@components/Heading";
import { Margins } from "@utils/margins";
import { ModalCloseButton, ModalContent, ModalHeader, ModalRoot } from "@utils/modal";
import { SearchableSelect, useMemo } from "@webpack/common";
import { settings } from "./settings";
import { cl, getLanguages } from "./utils";
const LanguageSettingKeys = ["receivedInput", "receivedOutput", "sentInput", "sentOutput"];
function LanguageSelect({ settingsKey, includeAuto }) {
    const currentValue = settings.use([settingsKey])[settingsKey];
    const options = useMemo(() => {
        const opts = Object.entries(getLanguages()).map(([value, label]) => ({ value, label }));
        if (!includeAuto)
            opts.shift();
        return opts;
    }, []);
    return (<section className={Margins.bottom16}>
            <HeadingSecondary>{settings.def[settingsKey].description}</HeadingSecondary>
            <SearchableSelect options={options} value={options.find(o => o.value === currentValue)?.value} placeholder="Select a language" maxVisibleItems={5} closeOnSelect={true} onChange={v => settings.store[settingsKey] = v}/>
        </section>);
}
function AutoTranslateToggle() {
    const value = settings.use(["autoTranslate"]).autoTranslate;
    return (<FormSwitch title="Auto Translate" description={settings.def.autoTranslate.description} value={value} onChange={v => settings.store.autoTranslate = v} hideBorder/>);
}
export function TranslateModal({ rootProps }) {
    return (<ModalRoot {...rootProps}>
            <ModalHeader className={cl("modal-header")}>
                <HeadingPrimary className={cl("modal-title")}>NativeTranslate</HeadingPrimary>
                <ModalCloseButton onClick={rootProps.onClose}/>
            </ModalHeader>
            <ModalContent className={cl("modal-content")}>
                {LanguageSettingKeys.map(s => (<LanguageSelect key={s} settingsKey={s} includeAuto={s.endsWith("Input")}/>))}
                <Divider className={Margins.bottom16}/>
                <AutoTranslateToggle />
            </ModalContent>
        </ModalRoot>);
}
