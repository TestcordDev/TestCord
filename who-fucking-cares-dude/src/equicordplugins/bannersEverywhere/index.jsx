/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as DataStore from "@api/DataStore";
import { isPluginEnabled } from "@api/PluginManager";
import { definePluginSettings } from "@api/Settings";
import usrbg from "@plugins/usrbg";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { UserProfileStore } from "@webpack/common";
import style from "./style.css?managed";
const settings = definePluginSettings({
    animate: {
        description: "Animate banners",
        type: 3 /* OptionType.BOOLEAN */,
        default: false
    },
    preferNameplate: {
        description: "prefer nameplate over banner",
        type: 3 /* OptionType.BOOLEAN */,
        default: false
    },
});
const DATASTORE_KEY = "bannersEverywhere";
export default definePlugin({
    name: "BannersEverywhere",
    description: "Displays banners in the member list ",
    tags: ["Appearance", "Customisation", "MemberList"],
    authors: [Devs.ImLvna, Devs.AutumnVN],
    settings,
    patches: [
        {
            find: "#{intl::GUILD_OWNER}),",
            replacement: [
                {
                    // We add the banner as a property while we can still access the user id
                    match: /user:(\i).{0,150}nameplate:(\i).*?name:null.*?(?=avatar:)/,
                    replace: "$&banner:$self.memberListBannerHook($1, $2),",
                },
                {
                    match: /(?<=\),nameplate:)(\i)/,
                    replace: "$self.nameplate($1)"
                }
            ]
        },
        {
            find: "role:\"listitem\",innerRef",
            replacement: {
                // We cant access the user id here, so we take the banner property we set earlier
                match: /children:\[(?=.{0,100}\.MEMBER_LIST)/,
                replace: "$&arguments[0].banner,"
            }
        }
    ],
    data: {},
    managedStyle: style,
    async start() {
        this.data = await DataStore.get(DATASTORE_KEY) || {};
    },
    stop() {
        DataStore.set(DATASTORE_KEY, this.data);
    },
    nameplate(nameplate) {
        if (settings.store.preferNameplate)
            return nameplate;
    },
    memberListBannerHook(user, nameplate) {
        let url = this.getBanner(user.id);
        if (!url)
            return;
        if (settings.store.preferNameplate && nameplate)
            return;
        if (!settings.store.animate) {
            // Discord Banners
            url = url.replace(".gif", ".png");
            // Usrbg Banners
            this.gifToPng(url)
                .then(pngUrl => {
                const imgElement = document.getElementById(`vc-banners-everywhere-${user.id}`);
                if (imgElement) {
                    imgElement.src = pngUrl;
                }
            })
                .catch();
        }
        return (<img alt="" id={`vc-banners-everywhere-${user.id}`} src={url} className="vc-banners-everywhere-memberlist"></img>);
    },
    async gifToPng(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
                const canvas = document.createElement("canvas");
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext("2d");
                if (ctx) {
                    ctx.drawImage(img, 0, 0);
                    resolve(canvas.toDataURL("image/png"));
                }
                else {
                    reject(new Error("Failed to get canvas context."));
                }
            };
            img.onerror = () => resolve("");
            img.src = url;
        });
    },
    getBanner(userId) {
        if (isPluginEnabled(usrbg.name) && usrbg.userHasBackground(userId)) {
            let banner = usrbg.getImageUrl(userId);
            if (banner === null)
                banner = "";
            return banner;
        }
        const userProfile = UserProfileStore.getUserProfile(userId);
        if (userProfile?.banner) {
            this.data[userId] = `https://cdn.discordapp.com/banners/${userId}/${userProfile.banner}.${userProfile.banner.startsWith("a_") ? "gif" : "png"}`;
            DataStore.set(DATASTORE_KEY, this.data);
        }
        return this.data[userId];
    },
});
