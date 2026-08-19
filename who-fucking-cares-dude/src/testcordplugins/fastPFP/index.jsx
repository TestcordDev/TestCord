/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { findGroupChildrenByChildId } from "@api/ContextMenu";
import { t } from "@utils/testcordI18n";
import definePlugin from "@utils/types";
import { Menu, RestAPI, Toasts } from "@webpack/common";
import { getMediaUrl } from "./getMediaUrl";
const uploadImageToProfile = async (url, type) => {
    try {
        const response = await fetch(url);
        const blob = await response.blob();
        // Convert Blob to Base64
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = async () => {
            const base64data = reader.result;
            try {
                await RestAPI.patch({
                    url: "/users/@me",
                    body: {
                        [type]: base64data
                    }
                });
                Toasts.show(Toasts.create(t(`تم تحديث ${type} بنجاح!`, `Successfully updated your ${type}!`), Toasts.Type.SUCCESS));
            }
            catch (error) {
                Toasts.show(Toasts.create(t(`فشل تحديث ${type}.`, `Failed to update ${type}.`), Toasts.Type.FAILURE));
                console.error("FastPFP Error:", error);
            }
        };
    }
    catch (err) {
        Toasts.show(Toasts.create(t("فشل تنزيل الصورة.", "Failed to download image."), Toasts.Type.FAILURE));
        console.error("FastPFP Error:", err);
    }
};
const messageContextMenuPatch = (children, props) => {
    if (!props)
        return;
    const { itemSrc, itemHref, target } = props;
    const url = getMediaUrl({ src: itemSrc, href: itemHref, target });
    if (!url)
        return;
    const group = findGroupChildrenByChildId("open-native-link", children)
        ?? findGroupChildrenByChildId("copy-link", children);
    if (group && !group.some(child => child?.props?.id === "fastpfp-avatar")) {
        group.push(<Menu.MenuItem label={t("إضافة إلى الصورة الشخصية", "Add To PFP")} key="fastpfp-avatar" id="fastpfp-avatar" action={() => uploadImageToProfile(url, "avatar")}/>);
        group.push(<Menu.MenuItem label={t("إضافة إلى البانر", "Add To Banner")} key="fastpfp-banner" id="fastpfp-banner" action={() => uploadImageToProfile(url, "banner")}/>);
    }
};
const imageContextMenuPatch = (children, props) => {
    if (!props)
        return;
    if ("href" in props && !props.src)
        return;
    const url = getMediaUrl(props);
    if (!url)
        return;
    if (children.some(child => child?.props?.id === "fastpfp-group"))
        return;
    children.push(<Menu.MenuGroup id="fastpfp-group">
            <Menu.MenuItem label={t("إضافة إلى الصورة الشخصية", "Add To PFP")} key="fastpfp-avatar" id="fastpfp-avatar" action={() => uploadImageToProfile(url, "avatar")}/>
            <Menu.MenuItem label={t("إضافة إلى البانر", "Add To Banner")} key="fastpfp-banner" id="fastpfp-banner" action={() => uploadImageToProfile(url, "banner")}/>
        </Menu.MenuGroup>);
};
export default definePlugin({
    name: "FastPFP",
    description: "Allows you to quickly set any image as your profile picture or banner from the context menu.",
    authors: [{ name: "Unknown", id: 0n }],
    contextMenus: {
        "message": messageContextMenuPatch,
        "image-context": imageContextMenuPatch
    }
});
