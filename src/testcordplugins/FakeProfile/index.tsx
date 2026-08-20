/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { enableStyle } from "@api/Styles";
import { getUserSettingLazy } from "@api/UserSettings";
import { ErrorBoundary } from "@components/index";
import { copyWithToast } from "@utils/discord";
import { Margins } from "@utils/margins";
import definePlugin from "@utils/types";
import { ProfileEffect, User } from "@vencord/discord-types";
import { Button, Toasts, UserStore } from "@webpack/common";
import virtualMerge from "virtual-merge";

import style from "./index.css?managed";
import { Decoration } from "./lib/api";
import { BASE_URL, SKU_ID } from "./lib/constants";
import { useUserAvatarDecoration, useUsersProfileStore } from "./lib/stores/UsersProfileStore";
import { Nameplate, UserProfile } from "./lib/types";
import { decode, encode } from "./lib/utils/profile";
import { settings } from "./settings";
import { fakeProfileSection } from "./ui/fakeProfileSection";

let customStatusGetter: (() => any) | null = null;
let customStatusHook: (() => any) | null = null;
const FAKE_STATUS_KEYS = ["fakeStatusEnabled", "fakeStatusText", "fakeStatusEmojiName", "fakeStatusEmojiId", "fakeStatusEmojiAnimated"] as const;

export default definePlugin({
    name: "fakeProfile",
    description: "Unlock Discord profile effects, themes, avatar decorations, and custom badges without the need for Nitro.",
    tags: ["Privacy", "Customisation"],
    authors: [{
        name: "Sampath",
        id: 984015688807100419n,
    }],
    dependencies: ["MessageDecorationsAPI", "BadgeAPI"],
    start: async () => {
        enableStyle(style);
        useUsersProfileStore.getState().fetchBadges();
        useUsersProfileStore.getState().fetchProfileEffects();
        useUsersProfileStore.getState().fetchDecorations();
        useUsersProfileStore.getState().fetch(UserStore.getCurrentUser().id, true);

        const CustomStatus = getUserSettingLazy<{ text: string; emojiId: string; emojiName: string; }>("status", "customStatus");
        if (CustomStatus) {
            customStatusGetter = CustomStatus.getSetting.bind(CustomStatus);
            customStatusHook = CustomStatus.useSetting.bind(CustomStatus);

            CustomStatus.getSetting = () => {
                const { fakeStatusEnabled, fakeStatusText, fakeStatusEmojiName, fakeStatusEmojiId } = settings.store;
                if (!fakeStatusEnabled) return customStatusGetter!();
                const text = fakeStatusText || "";
                const emojiName = fakeStatusEmojiName || "";
                const emojiId = fakeStatusEmojiId || "0";
                if (!text && !emojiName) {
                    const user = UserStore.getCurrentUser();
                    if (user) return { text: user.username, emojiName: "", emojiId: "0", createdAtMs: Date.now().toString(), expiresAtMs: "0" };
                }
                return { text, emojiName, emojiId, createdAtMs: Date.now().toString(), expiresAtMs: "0" };
            };

            CustomStatus.useSetting = (() => {
                const orig = customStatusHook!;
                return function () {
                    const { fakeStatusEnabled, fakeStatusText, fakeStatusEmojiName, fakeStatusEmojiId } = settings.use(FAKE_STATUS_KEYS as any);
                    const realStatus = orig();
                    if (!fakeStatusEnabled) return realStatus;
                    const text = fakeStatusText || "";
                    const emojiName = fakeStatusEmojiName || "";
                    const emojiId = fakeStatusEmojiId || "0";
                    if (!text && !emojiName) {
                        const user = UserStore.getCurrentUser();
                        if (user) return { text: user.username, emojiName: "", emojiId: "0", createdAtMs: Date.now().toString(), expiresAtMs: "0" };
                    }
                    return { text, emojiName, emojiId, createdAtMs: Date.now().toString(), expiresAtMs: "0" };
                };
            })();
        }
    },
    stop() {
        const CustomStatus = getUserSettingLazy("status", "customStatus");
        if (CustomStatus) {
            if (customStatusGetter) CustomStatus.getSetting = customStatusGetter;
            if (customStatusHook) CustomStatus.useSetting = customStatusHook;
            customStatusGetter = null;
            customStatusHook = null;
        }
    },
    flux: {
        USER_PROFILE_MODAL_OPEN: data => {
            useUsersProfileStore.getState().fetch(data.userId, true);
        },
    },
    settings,
    patches: [
        {
            find: "UserProfileStore",
            replacement: {
                match: /(?<=getUserProfile\(\i\){return )(.+?)(?=})/,
                replace: "$self.profileDecodeHook($1)"
            }
        },
        {
            find: "getAvatarDecorationURL:",
            replacement: {
                match: /(?<=function \i\(\i\){)(?=let{avatarDecoration)/,
                replace: "const vcDecoration=$self.getAvatarDecorationURL(arguments[0]);if(vcDecoration)return vcDecoration;"
            }
        },
        {
            find: "#{intl::USER_SETTINGS_RESET_PROFILE_THEME}",
            noWarn: true,
            replacement: {
                match: /#{intl::USER_SETTINGS_RESET_PROFILE_THEME}.+?}\)(?=\])(?=\])(?<=color:(\i),.{0,500}?color:(\i),.{0,500}?)/,
                replace: "$&,$self.addCopy3y3Button({primary:$1,accent:$2})"
            }
        },
        {
            find: "DefaultCustomizationSections",
            noWarn: true,
            replacement: {
                match: /(?<=#{intl::USER_SETTINGS_AVATAR_DECORATION}\)},"decoration"\),)/,
                replace: "$self.fakeProfileSection(),"
            }
        },
        {
            find: "=!1,canUsePremiumCustomization:",
            replacement: {
                match: /(\i)\.premiumType/,
                replace: "$self.premiumHook($1)||$&"
            }
        },
        {
            find: ".banner)==null",
            replacement: {
                match: /(?<=void 0:)\i.getPreviewBanner\(\i,\i,\i\)/,
                replace: "$self.useBannerHook(arguments[0])||$&"

            }
        },
        {
            find: "\"data-selenium-video-tile\":",
            predicate: () => settings.store.voiceBackground,
            replacement: [
                {
                    match: /(?<=function\((\i),\i\)\{)(?=let.{20,40},style:)/,
                    replace: "$1.style=$self.getVoiceBackgroundStyles($1);"
                }
            ]
        },
        {
            find: "getUserAvatarURL:",
            replacement: [
                {
                    match: /(getUserAvatarURL:)(\i),/,
                    replace: "$1$self.getAvatarHook($2),"
                }
            ]
        },

        {
            find: "isAvatarDecorationAnimating:",
            group: true,
            replacement: [
                {
                    match: /(?<=\.avatarDecoration,guildId:\i\}\)\),)(?<=user:(\i).+?)/,
                    replace: "vcAvatarDecoration=$self.useUserAvatarDecoration($1),"
                },
                {
                    match: /(?<={avatarDecoration:).{1,20}?(?=,)(?<=avatarDecorationOverride:(\i).+?)/,
                    replace: "$1??vcAvatarDecoration??($&)"
                },
                {
                    match: /(?<=size:\i}\),\[)/,
                    replace: "vcAvatarDecoration,"
                }
            ]
        },
        // {
        //     find: "\"ProfileEffectStore\"",
        //     replacement: {
        //         match: /getProfileEffectById\((\i)\){return null!=\i\?(\i)\[\i\]:void 0/,
        //         replace: "getProfileEffectById($1){return $self.getProfileEffectById($1, $2)"
        //     }
        // },
        {
            find: "#{intl::ACCOUNT_SPEAKING_WHILE_MUTED}",
            replacement: [
                // Use Decor avatar decoration hook
                {
                    match: /(?<=\i\)\({avatarDecoration:)\i(?=,)(?<=currentUser:(\i).+?)/,
                    replace: "$self.useUserAvatarDecoration($1)??$&"
                }
            ]
        },
        ...[
            '"Message Username"', // Messages
            ".nameplatePreview,{", // Nameplate preview
            "#{intl::ayozFl::raw}", // Avatar preview
        ].map(find => ({
            find,
            replacement: [
                {
                    match: /(?<=userValue.{0,25}void 0:)((\i)\.avatarDecoration)/,
                    replace: "$self.useUserAvatarDecoration($2)??$1"
                }
            ]
        })),
        {
            find: "#{intl::GUILD_OWNER}),",
            replacement: [
                {
                    match: /user:(\i).{0,150}nameplate:(\i).*?name:null.*?(?=avatar:)/,
                    replace: "$&banner:$self.customnameplate($1, $2),",
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
                match: /focusProps.\i\}=(\i).*?children:\[/,
                replace: "$&$1.banner,"
            }
        }
    ],
    profileDecodeHook(user: UserProfile) {
        if (user) {
            if (settings.store.enableProfileEffects || settings.store.enableProfileThemes) {
                let mergeData: Partial<UserProfile> = {};
                const userData = useUsersProfileStore.getState().get(user.userId);
                const colors = decode((user as any).bio);
                const profileEffect = userData?.profileEffectId
                    ? useUsersProfileStore.getState().profileEffects.get(userData.profileEffectId)
                    : null;
                const effects = profileEffect?.config.effects.filter(effect => typeof effect?.src === "string");
                if (settings.store.enableProfileEffects && profileEffect && effects?.length) {
                    mergeData = {
                        ...mergeData,
                        profileEffect: {
                            skuId: profileEffect.skuId,
                            title: profileEffect.config.title,
                            description: profileEffect.config.description,
                            accessibilityLabel: profileEffect.config.accessibilityLabel,
                            reducedMotionSrc: typeof profileEffect.config.reducedMotionSrc === "string"
                                ? profileEffect.config.reducedMotionSrc
                                : undefined,
                            thumbnailPreviewSrc: typeof profileEffect.config.thumbnailPreviewSrc === "string"
                                ? profileEffect.config.thumbnailPreviewSrc
                                : undefined,
                            effects,
                            animationType: profileEffect.config.animationType,
                            type: profileEffect.config.type
                        } satisfies ProfileEffect
                    };
                }
                if (settings.store.enableProfileThemes && colors) {
                    mergeData = {
                        ...mergeData,
                        premiumType: 2,
                        themeColors: colors
                    };
                }
                return virtualMerge(user, mergeData as UserProfile);
            }
            return user;
        }

        return user;
    },
    useUserAvatarDecoration,
    premiumHook({ userId }: any) {
        const user = useUsersProfileStore.getState().get(userId);
        if (user)
            return 2;
    },
    getAvatarHook: (original: any) => (user: User, animated: boolean, size: number) => {
        if (!user) return original(user, animated, size);
        if (settings.store.nitroFirst && user.avatar && typeof user.avatar === "string" && user.avatar.startsWith("a_")) return original(user, animated, size);
        const userData = useUsersProfileStore.getState().get(user.id);
        if (animated) {
            return userData?.avatar ?? original(user, animated, size);
        } else {
            const avatarUrl = userData?.avatar;
            if (avatarUrl && typeof avatarUrl === "string") {
                try {
                    const parsedUrl = new URL(avatarUrl);
                    const image_name = parsedUrl.pathname.split("/").pop()?.replace(/\.(gif|webp)$/i, ".png");
                    if (image_name) {
                        return BASE_URL + "/image/" + image_name;
                    }
                } catch (e) {
                    console.error("Failed to parse avatar URL", e);
                }
            }
            return original(user, animated, size);
        }
    },
    getAvatarDecorationURL({ avatarDecoration, canAnimate }: { avatarDecoration: Decoration | null; canAnimate?: boolean; }) {
        if (!avatarDecoration || !avatarDecoration.asset || !settings.store.enableAvatarDecorations) return;
        const isCustom = String(avatarDecoration.skuId) === SKU_ID;
        try {
            if (canAnimate && avatarDecoration.animated) {
                if (isCustom) {
                    const url = new URL(`${BASE_URL}/avatar-decoration-presets/a_${avatarDecoration.asset}.png`);
                    return url.toString();
                } else {
                    const url = new URL(`https://cdn.discordapp.com/avatar-decoration-presets/${avatarDecoration.asset}.png`);
                    return url.toString();
                }
            } else {
                if (isCustom) {
                    const assetName = typeof avatarDecoration.asset === "string" ? avatarDecoration.asset.replace("a_", "") : avatarDecoration.asset;
                    const url = new URL(`${BASE_URL}/avatar-decoration-presets/${assetName}.png`);
                    return url.toString();
                } else {
                    const url = new URL(`https://cdn.discordapp.com/avatar-decoration-presets/${avatarDecoration.asset}.png?passthrough=false`);
                    return url.toString();
                }
            }
        } catch (e) {
            console.error("Failed to construct avatar decoration URL", e);
            return undefined;
        }
    },
    nameplate(nameplate: Nameplate | undefined) {
        return nameplate;
    },
    customnameplate(user: User, nameplate: Nameplate | undefined) {
        const userId = user?.id;
        const userData = useUsersProfileStore.getState().get(userId);
        if (userData && userData?.nameplate && settings.store.enableNameplate) {
            const url = userData.nameplate;
            const urlStr = typeof url === "object" ? JSON.stringify(url) : url;
            return (<img id={`custom-nameplate-${user.id}`} src={urlStr} className="custom-nameplate" />);
        }
        return null;
    },
    useBannerHook({ displayProfile }: any) {
        if (displayProfile?.banner && settings.store.nitroFirst) return;
        const UsersData = useUsersProfileStore.getState().get(displayProfile?.userId);
        if (UsersData && UsersData.banner) return UsersData.banner;
    },
    getProfileEffectById(skuId: string, effects: Record<string, any>) {
        const { profileEffects } = useUsersProfileStore.getState();
        const effect = profileEffects.get(skuId);
        return effect || (effects && effects[skuId]) || null;
    },
    getVoiceBackgroundStyles({ className, participantUserId }: any) {
        if (className.includes("tile_")) {
            const userData = useUsersProfileStore.getState().get(participantUserId);
            if (userData && userData.banner) {
                return {
                    backgroundImage: `url(${userData.banner})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    backgroundRepeat: "no-repeat"
                };
            }
        }
    },
    fakeProfileSection: ErrorBoundary.wrap(fakeProfileSection),
    toolboxActions: {
        async "Refetch fakeProfile"() {
            useUsersProfileStore.getState().fetch(UserStore.getCurrentUser().id, true);
            useUsersProfileStore.getState().fetchDecorations();
            useUsersProfileStore.getState().fetchProfileEffects();
            useUsersProfileStore.getState().fetchBadges();
            Toasts.show({
                message: "Successfully refetched fakeProfile!",
                id: Toasts.genId(),
                type: Toasts.Type.SUCCESS
            });
        }
    },
    addCopy3y3Button: ErrorBoundary.wrap(function ({ primary, accent }: { primary: number; accent: number; }) {
        return <Button
            onClick={() => {
                const colorString = encode(primary, accent);
                copyWithToast(colorString);
            }}
            color={Button.Colors.PRIMARY}
            size={Button.Sizes.XLARGE}
            className={Margins.left16}
        >Copy 3y3
        </Button >;
    }, { noop: true }),
});
