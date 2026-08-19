/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Button } from "@components/Button";
import { Heading } from "@components/Heading";
import { copyWithToast } from "@utils/discord";
import { findCssClassesLazy } from "@webpack";
import { Toasts } from "@webpack/common";
import { settings } from "../settings";
const Native = VencordNative.pluginHelpers.ApiSniper;
const inputClasses = findCssClassesLazy("input", "inputWrapper", "editable");
function getDirName(path) {
    if (!path)
        return "Choose Folder";
    const parts = path.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || path;
}
function createDirSelector(settingKey, successMessage) {
    return function DirSelector({ option }) {
        if (IS_WEB)
            return null;
        return (<section>
                <Heading tag="h5">{option.description}</Heading>
                <SelectFolderInput settingsKey={settingKey} successMessage={successMessage}/>
            </section>);
    };
}
export const SniperDir = createDirSelector("sniperDir", "Successfully updated Sniper Directory");
export function SelectFolderInput({ settingsKey, successMessage }) {
    const path = settings.store[settingsKey];
    async function onFolderSelect() {
        try {
            const res = await Native.chooseDir(settingsKey);
            settings.store[settingsKey] = res;
            return Toasts.show({
                id: Toasts.genId(),
                type: Toasts.Type.SUCCESS,
                message: successMessage,
            });
        }
        catch (err) {
            return Toasts.show({
                id: Toasts.genId(),
                type: Toasts.Type.FAILURE,
                message: "Failed to update directory",
            });
        }
    }
    return (<div className="vc-api-sniper-folder-upload-container">
            <div onClick={() => path && copyWithToast(path)} className="vc-api-sniper-folder-upload-input">
                {path == null ? "Choose Folder" : getDirName(path)}
            </div>
            <Button className="vc-api-sniper-folder-upload-button" size="small" onClick={onFolderSelect}>
                Browse
            </Button>
        </div>);
}
