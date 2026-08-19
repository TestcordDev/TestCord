/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Parser, useEffect, useState } from "@webpack/common";
import { TranslateIcon } from "./TranslateIcon";
import { cl } from "./utils";
const TranslationSetters = new Map();
export function handleTranslate(messageId, data) {
    TranslationSetters.get(messageId)(data);
}
function Dismiss({ onDismiss }) {
    return (<button onClick={onDismiss} className={cl("dismiss")}>
            Dismiss
        </button>);
}
export function TranslationAccessory({ message }) {
    const [translation, setTranslation] = useState();
    useEffect(() => {
        if (message.vencordEmbeddedBy)
            return;
        TranslationSetters.set(message.id, setTranslation);
        return () => void TranslationSetters.delete(message.id);
    }, []);
    if (!translation)
        return null;
    return (<span className={cl("accessory")}>
            <TranslateIcon width={16} height={16} className={cl("accessory-icon")}/>
            {Parser.parse(translation.text)}
            <br />
            (translated from {translation.sourceLanguage} - <Dismiss onDismiss={() => setTranslation(undefined)}/>)
        </span>);
}
