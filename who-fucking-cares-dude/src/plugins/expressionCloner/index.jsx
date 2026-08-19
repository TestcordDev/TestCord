/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/
import { findGroupChildrenByChildId } from "@api/ContextMenu";
import { migratePluginSettings } from "@api/Settings";
import { BaseText } from "@components/BaseText";
import { CheckedTextInput } from "@components/CheckedTextInput";
import { Flex } from "@components/Flex";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { Devs } from "@utils/constants";
import { getGuildAcronym, hasGuildFeature } from "@utils/discord";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { findByCodeLazy } from "@webpack";
import { Constants, EmojiStore, FluxDispatcher, GuildStore, IconUtils, Menu, Modal, openModalLazy, PermissionsBits, PermissionStore, React, RestAPI, StickersStore, Toasts, Tooltip, UserStore } from "@webpack/common";
const uploadEmoji = findByCodeLazy(".GUILD_EMOJIS(", "EMOJI_UPLOAD_START");
const StickerExtMap = {
    [1 /* StickerFormatType.PNG */]: "png",
    [2 /* StickerFormatType.APNG */]: "png",
    [3 /* StickerFormatType.LOTTIE */]: "json",
    [4 /* StickerFormatType.GIF */]: "gif"
};
const PremiumTierStickerLimitMap = {
    0: 5,
    1: 15,
    2: 30,
    3: 60
};
const MAX_EMOJI_SIZE_BYTES = 256 * 1024;
const MAX_STICKER_SIZE_BYTES = 512 * 1024;
function getGuildMaxStickerSlots(guild) {
    if (guild.features.has("MORE_STICKERS") && guild.premiumTier === 3)
        return 120;
    return PremiumTierStickerLimitMap[guild.premiumTier] ?? PremiumTierStickerLimitMap[0];
}
function getGuildMaxEmojiSlots(guild) {
    return Math.max(hasGuildFeature(guild, "MORE_EMOJI") ? 200 : 50, 50 + (guild.premiumFeatures?.additionalEmojiSlots ?? 0));
}
function getUrl(data, size) {
    if (data.t === "Emoji")
        return `${location.protocol}//${window.GLOBAL_ENV.CDN_HOST}/emojis/${data.id}.webp?size=${size}&lossless=true&animated=true`;
    return `${window.GLOBAL_ENV.MEDIA_PROXY_ENDPOINT}/stickers/${data.id}.${StickerExtMap[data.format_type]}?size=${size}&lossless=true&animated=true`;
}
async function fetchSticker(id) {
    const cached = StickersStore.getStickerById(id);
    if (cached)
        return cached;
    const { body } = await RestAPI.get({
        url: Constants.Endpoints.STICKER(id)
    });
    FluxDispatcher.dispatch({
        type: "STICKER_FETCH_SUCCESS",
        sticker: body
    });
    return body;
}
async function cloneSticker(guildId, sticker) {
    const data = new FormData();
    data.append("name", sticker.name);
    data.append("tags", sticker.tags);
    data.append("description", sticker.description);
    data.append("file", await fetchBlob(sticker));
    const { body } = await RestAPI.post({
        url: Constants.Endpoints.GUILD_STICKER_PACKS(guildId),
        body: data,
    });
    FluxDispatcher.dispatch({
        type: "GUILD_STICKERS_CREATE_SUCCESS",
        guildId,
        sticker: {
            ...body,
            user: UserStore.getCurrentUser()
        }
    });
}
async function cloneEmoji(guildId, emoji) {
    const data = await fetchBlob(emoji);
    const dataUrl = await new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(data);
    });
    return uploadEmoji({
        guildId,
        name: emoji.name.split("~")[0],
        image: dataUrl
    });
}
function getGuildCandidates(data) {
    const meId = UserStore.getCurrentUser().id;
    return Object.values(GuildStore.getGuilds()).filter(g => {
        const canCreate = g.ownerId === meId ||
            PermissionStore.can(PermissionsBits.CREATE_GUILD_EXPRESSIONS, g) ||
            PermissionStore.can(PermissionsBits.MANAGE_GUILD_EXPRESSIONS, g);
        if (!canCreate)
            return false;
        if (data.t === "Sticker") {
            const stickerSlots = getGuildMaxStickerSlots(g);
            const stickers = StickersStore.getStickersByGuildId(g.id);
            return !stickers || stickers.length < stickerSlots;
        }
        const { isAnimated } = data;
        const emojiSlots = getGuildMaxEmojiSlots(g);
        const emojis = EmojiStore.getGuildEmoji(g.id);
        let count = 0;
        if (emojis) {
            for (const emoji of emojis) {
                if (emoji.animated === isAnimated && !emoji.managed) {
                    count++;
                }
            }
        }
        return count < emojiSlots;
    }).sort((a, b) => a.name.localeCompare(b.name));
}
async function fetchBlob(data) {
    const MAX_SIZE = data.t === "Sticker"
        ? MAX_STICKER_SIZE_BYTES
        : MAX_EMOJI_SIZE_BYTES;
    for (let size = 4096; size >= 16; size /= 2) {
        const url = getUrl(data, size);
        const res = await fetch(url);
        if (!res.ok)
            throw new Error(`Failed to fetch ${url} - ${res.status}`);
        const blob = await res.blob();
        if (blob.size <= MAX_SIZE)
            return blob;
    }
    throw new Error(`Failed to fetch ${data.t} within size limit of ${MAX_SIZE / 1000}kB`);
}
async function doClone(guildId, data) {
    try {
        if (data.t === "Sticker")
            await cloneSticker(guildId, data);
        else
            await cloneEmoji(guildId, data);
        Toasts.show({
            message: `Successfully cloned ${data.name} to ${GuildStore.getGuild(guildId)?.name ?? "your server"}!`,
            type: Toasts.Type.SUCCESS,
            id: Toasts.genId()
        });
    }
    catch (e) {
        let message = "Something went wrong (check console!)";
        try {
            message = JSON.parse(e.text).message;
        }
        catch { }
        new Logger("ExpressionCloner").error("Failed to clone", data.name, "to", guildId, e);
        Toasts.show({
            message: "Failed to clone: " + message,
            type: Toasts.Type.FAILURE,
            id: Toasts.genId()
        });
    }
}
const getFontSize = (s) => {
    // [18, 18, 16, 16, 14, 12, 10]
    const sizes = [20, 20, 18, 18, 16, 14, 12];
    return sizes[s.length] ?? 4;
};
const nameValidator = /^\w+$/i;
function CloneModal({ data }) {
    const [isCloning, setIsCloning] = React.useState(false);
    const [name, setName] = React.useState(data.name);
    const [x, invalidateMemo] = React.useReducer(x => x + 1, 0);
    const guilds = React.useMemo(() => getGuildCandidates(data), [data.id, x]);
    return (<>
            <Heading tag="h5">Custom Name</Heading>
            <CheckedTextInput initialValue={name} onChange={v => {
            data.name = v;
            setName(v);
        }} validate={v => (data.t === "Emoji" && v.length > 2 && v.length < 32 && nameValidator.test(v))
            || (data.t === "Sticker" && v.length > 2 && v.length < 30)
            || "Name must be between 2 and 32 characters and only contain alphanumeric characters"}/>
            <div style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "1em",
            padding: "1em 0.5em",
            justifyContent: "center",
            alignItems: "center"
        }}>
                {guilds.map(g => (<Tooltip key={g.id} text={g.name}>
                        {({ onMouseLeave, onMouseEnter }) => (<div onMouseLeave={onMouseLeave} onMouseEnter={onMouseEnter} role="button" aria-label={"Clone to " + g.name} aria-disabled={isCloning} style={{
                    borderRadius: "50%",
                    backgroundColor: "var(--background-base-lower)",
                    display: "inline-flex",
                    justifyContent: "center",
                    alignItems: "center",
                    width: "4em",
                    height: "4em",
                    cursor: isCloning ? "not-allowed" : "pointer",
                    filter: isCloning ? "brightness(50%)" : "none"
                }} onClick={isCloning ? void 0 : async () => {
                    setIsCloning(true);
                    doClone(g.id, data).finally(() => {
                        invalidateMemo();
                        setIsCloning(false);
                    });
                }}>
                                {g.icon ? (<img aria-hidden style={{
                        borderRadius: "50%",
                        width: "100%",
                        height: "100%",
                    }} src={IconUtils.getGuildIconURL({
                        id: g.id,
                        icon: g.icon,
                        canAnimate: true,
                        size: 512
                    })} alt={g.name}/>) : (<Paragraph style={{
                        fontSize: getFontSize(getGuildAcronym(g)),
                        width: "100%",
                        overflow: "hidden",
                        whiteSpace: "nowrap",
                        textAlign: "center",
                        cursor: isCloning ? "not-allowed" : "pointer",
                    }}>
                                        {getGuildAcronym(g)}
                                    </Paragraph>)}
                            </div>)}
                    </Tooltip>))}
            </div>
        </>);
}
function buildMenuItem(type, fetchData) {
    return (<Menu.MenuItem id="emote-cloner" key="emote-cloner" label={`Clone ${type}`} action={() => openModalLazy(async () => {
            const res = await fetchData();
            const data = { t: type, ...res };
            const url = getUrl(data, 128);
            return modalProps => (<Modal {...modalProps} title={<Flex gap="0.5em" alignItems="center">
                                    <img role="presentation" aria-hidden src={url} alt="" height={24} width={24}/>
                                    <BaseText tag="h3" size="md" weight="medium">Clone {data.name}</BaseText>
                                </Flex>}>
                            <CloneModal data={data}/>
                        </Modal>);
        })}/>);
}
function isGifUrl(url) {
    const u = new URL(url);
    return u.pathname.endsWith(".gif") || u.searchParams.get("animated") === "true";
}
const messageContextMenuPatch = (children, props) => {
    const { favoriteableId, itemHref, itemSrc, favoriteableType } = props ?? {};
    if (!favoriteableId)
        return;
    const menuItem = (() => {
        switch (favoriteableType) {
            case "emoji":
                const content = props.message?.content ?? "";
                const match = content.match(RegExp(`<a?:(\\w+)(?:~\\d+)?:${favoriteableId}>|https://cdn\\.discordapp\\.com/emojis/${favoriteableId}\\.`));
                const reaction = props.message?.reactions?.find?.((reaction) => reaction.emoji?.id === favoriteableId);
                let name = (match && match[1]) ?? reaction?.emoji?.name;
                if (!name && props.message?.embeds) {
                    for (const embed of props.message.embeds) {
                        const embedStr = JSON.stringify(embed);
                        const embedMatch = embedStr.match(RegExp(`<a?:(\\w+)(?:~\\d+)?:${favoriteableId}>`));
                        if (embedMatch) {
                            name = embedMatch[1];
                            break;
                        }
                    }
                }
                name ??= "FakeNitroEmoji";
                return buildMenuItem("Emoji", () => ({
                    id: favoriteableId,
                    name: name,
                    isAnimated: isGifUrl(itemHref ?? itemSrc)
                }));
            case "sticker":
                const sticker = props.message?.stickerItems?.find?.((s) => s.id === favoriteableId);
                if (sticker?.format_type === 3 /* LOTTIE */)
                    return;
                return buildMenuItem("Sticker", () => fetchSticker(favoriteableId));
        }
    })();
    if (menuItem)
        findGroupChildrenByChildId("copy-link", children)?.push(menuItem);
};
const expressionPickerPatch = (children, props) => {
    const { id, name, type } = props?.target?.dataset ?? {};
    if (!id)
        return;
    if (type === "emoji") {
        const emojiName = name || props.target?.alt?.replace(/^:|:$/g, "") || "FakeNitroEmoji";
        const firstChild = props.target.firstChild;
        children.push(buildMenuItem("Emoji", () => ({
            id,
            name: emojiName,
            isAnimated: firstChild && isGifUrl(firstChild.src)
        })));
    }
    else if (type === "sticker" && !props.target.className?.includes("lottieCanvas")) {
        children.push(buildMenuItem("Sticker", () => fetchSticker(id)));
    }
};
migratePluginSettings("ExpressionCloner", "EmoteCloner");
export default definePlugin({
    name: "ExpressionCloner",
    description: "Allows you to clone Emotes & Stickers to your own server (right click them)",
    tags: ["Emotes", "Servers"],
    searchTerms: ["StickerCloner", "EmoteCloner", "EmojiCloner"],
    authors: [Devs.Ven, Devs.Nuckyz],
    contextMenus: {
        "message": messageContextMenuPatch,
        "expression-picker": expressionPickerPatch
    }
});
