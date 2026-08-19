/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { BaseText } from "@components/BaseText";
import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { wordsFromCamel, wordsToTitle } from "@utils/text";
export const cl = classNameFactory("vc-plugins-setting-");
export function resolveError(isValidResult) {
    if (typeof isValidResult === "string")
        return isValidResult;
    return isValidResult ? null : "Invalid input provided";
}
export function SettingsSection({ tag: Tag = "div", name, id, description, error, inlineSetting, children }) {
    return (<Tag className={cl("section")}>
            <div className={classes(cl("content"), inlineSetting && cl("inline"))}>
                <div className={cl("label")}>
                    <BaseText className={cl("title")} size="md" weight="medium">{name ?? wordsToTitle(wordsFromCamel(id))}</BaseText>
                    {description && <BaseText className={cl("description")} size="sm">{description}</BaseText>}
                </div>
                {children}
            </div>
            {error && <BaseText className={cl("error")} size="sm">{error}</BaseText>}
        </Tag>);
}
