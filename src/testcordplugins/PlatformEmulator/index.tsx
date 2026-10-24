/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { sendBotMessage } from "@api/Commands/commandHelpers";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { Notice } from "@components/Notice";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { filters, findByProps, mapMangledModuleLazy } from "@webpack";
import { AuthenticationStore, SessionsStore, Tooltip, useStateFromStores } from "@webpack/common";

const { useStatusFillColor } = mapMangledModuleLazy([".5625*", "translate"], {
    useStatusFillColor: filters.byCode(".hex")
});

const infos: Record<string, { os: string; browser: string; }> = {
    windows: { os: "Windows", browser: "Discord Client" },
    linux: { os: "Linux", browser: "Discord Client" },
    macos: { os: "Mac OS X", browser: "Discord Client" },
    android: { os: "Android", browser: "Discord Android" },
    mobile: { os: "iOS", browser: "Discord iOS" },
    xbox: { os: "Xbox", browser: "Discord Embedded" },
    playstation: { os: "PlayStation", browser: "Discord Embedded" },
    vr: { os: "VR", browser: "Discord VR" },
    web: { os: "Web", browser: "Discord Web" },
};

// Desktop OS profiles used for aggressive (deep) IDENTIFY spoofing.
const desktopProfiles: Record<string, { os: string; osVersion: string; userAgent: string; }> = {
    windows: {
        os: "Windows",
        osVersion: "10.0.22631",
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    },
    macos: {
        os: "Mac OS X",
        osVersion: "13.6.1",
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    },
    linux: {
        os: "Linux",
        osVersion: "6.6.0",
        userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
};

// Maps the selected platform onto a coherent desktop profile for deep spoofing.
// Non-desktop platforms fall back to Linux since desktop UA strings only make
// sense for desktop operating systems.
function resolveDesktopProfile(platform: string) {
    switch (platform) {
        case "windows":
            return desktopProfiles.windows;
        case "macos":
            return desktopProfiles.macos;
        case "linux":
            return desktopProfiles.linux;
        default:
            return desktopProfiles.linux;
    }
}

const settings = definePluginSettings({
    plateforme: {
        type: OptionType.SELECT,
        description: "The platform to spoof",
        restartNeeded: true,
        default: "windows",
        options: [
            { label: "Windows", value: "windows", default: true },
            { label: "Linux", value: "linux" },
            { label: "macOS", value: "macos" },
            { label: "Android", value: "android" },
            { label: "iOS (iPhone)", value: "mobile" },
            { label: "Xbox", value: "xbox" },
            { label: "PlayStation", value: "playstation" },
            { label: "VR Headset", value: "vr" },
            { label: "Web", value: "web" }
        ],
    },
    showOwnSpoofed: {
        type: OptionType.BOOLEAN,
        description: "Show your own spoofed platform in voice channel rows and call tiles, the way others see it.",
        restartNeeded: false,
        default: false,
    },
    aggressiveSpoofing: {
        type: OptionType.BOOLEAN,
        description: "Enable aggressive OS spoofing (injects extra IDENTIFY / client metadata). Choose the depth with the level selector below.",
        restartNeeded: true,
        default: false
    },
    aggressiveLevel: {
        type: OptionType.SELECT,
        description: "How much extra metadata to spoof when aggressive spoofing is enabled",
        restartNeeded: true,
        default: "medium",
        options: [
            { label: "Low (device + locale)", value: "low" },
            { label: "Medium (+ versions + release channel)", value: "medium", default: true },
            { label: "High (+ user agent + client build)", value: "high" }
        ]
    }
});

// Platform status icons rendered from the plugin's own state. Read-only:
// nothing here writes to stores, dispatches actions, or touches IDENTIFY.
function Icon(path: string, opts?: IconOptions) {
    return ({ color, tooltip, small, style }: { color: string; tooltip: string; small: boolean; style?: React.CSSProperties; }) => (
        <Tooltip text={tooltip}>
            {tooltipProps => (
                <svg
                    {...tooltipProps}
                    style={style}
                    height={(opts?.height ?? 20) - (small ? 4 : 0)}
                    width={(opts?.width ?? 20) - (small ? 4 : 0)}
                    viewBox={opts?.viewBox ?? "0 0 24 24"}
                    fill={color}
                >
                    <path d={path} fillRule={opts?.fillRule} />
                </svg>
            )}
        </Tooltip>
    );
}

interface IconOptions {
    viewBox?: string;
    width?: number;
    height?: number;
    fillRule?: "evenodd" | "nonzero";
}

const Icons: Record<string, ReturnType<typeof Icon>> = {
    desktop: Icon("M4 2.5c-1.103 0-2 .897-2 2v11c0 1.104.897 2 2 2h7v2H7v2h10v-2h-4v-2h7c1.103 0 2-.896 2-2v-11c0-1.103-.897-2-2-2H4Zm16 2v9H4v-9h16Z"),
    web: Icon("M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2Zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93Zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39Z"),
    mobile: Icon("M 187 0 L 813 0 C 916.277 0 1000 83.723 1000 187 L 1000 1313 C 1000 1416.277 916.277 1500 813 1500 L 187 1500 C 83.723 1500 0 1416.277 0 1313 L 0 187 C 0 83.723 83.723 0 187 0 Z M 125 1000 L 875 1000 L 875 250 L 125 250 Z M 500 1125 C 430.964 1125 375 1180.964 375 1250 C 375 1319.036 430.964 1375 500 1375 C 569.036 1375 625 1319.036 625 1250 C 625 1180.964 569.036 1125 500 1125 Z", { viewBox: "0 0 1000 1500", height: 17, width: 17 }),
    // Brand console icons taken from Discord's own voice row icon components
    // (module 266080 $.A xbox, module 790381 W.A playstation), including their
    // native viewBoxes and fill rules, so the self view renders exactly what
    // other users see for these platforms.
    xbox: Icon("M8.95185131,8.62650012 L8.92775494,8.65059649 C3.20486729,14.2891468 -0.0119979765,21.9758886 5.02080018e-05,29.9999795 C-0.0119979765,36.56624 2.14462705,42.9517778 6.13257613,48.1686417 C6.16872068,48.2168345 6.24100979,48.252979 6.28920253,48.2168345 C6.33739527,48.1806899 6.34944345,48.120449 6.32534708,48.0602081 C4.03619202,40.9879237 15.722931,23.8433572 21.7711196,16.6626392 C21.795216,16.6385428 21.8193124,16.6144465 21.8193124,16.5783019 C21.8193124,16.5421573 21.795216,16.5060128 21.7590715,16.4819164 C11.6024519,6.37348961 8.8795622,8.68674104 8.92775494,8.65059649 M51.048208,8.62650012 L51.0723044,8.65059649 C56.795192,14.2770987 60.0000091,21.9758886 59.9879609,29.9999795 C60.0000091,36.56624 57.8433841,42.9517778 53.855435,48.1686417 C53.8192905,48.2168345 53.7470014,48.252979 53.6988086,48.2168345 C53.6506159,48.1806899 53.6506159,48.120449 53.6626641,48.0602081 C55.9518191,40.9879237 44.2650801,23.831309 38.2289397,16.650591 C38.2048433,16.6264946 38.180747,16.6023983 38.180747,16.5662537 C38.180747,16.518061 38.2048433,16.4939646 38.2409879,16.4698682 C48.4096556,6.36144143 51.0964008,8.68674104 51.0602562,8.65059649 M30.0000297,0 C36.0482183,0 41.0361667,1.66264946 45.626525,4.38553917 C45.6867659,4.40963554 45.6988141,4.48192464 45.6747177,4.53011738 C45.6506214,4.57831012 45.5903804,4.5903583 45.5301395,4.57831012 C39.7229146,3.32529893 30.8915953,8.33734369 30.0602706,8.84336744 C30.0361742,8.85541562 30.024126,8.86746381 30.0000297,8.86746381 C29.9759333,8.86746381 29.9518369,8.85541562 29.9397887,8.84336744 C27.7229228,7.56625988 19.5663019,3.28915437 14.4217271,4.61445467 C14.3614862,4.62650286 14.3012452,4.61445467 14.2771489,4.56626193 C14.2530525,4.50602101 14.2771489,4.44578009 14.3253416,4.42168372 C18.9156999,1.66264946 23.9638892,0 30.0000297,0 M30.0000297,24.0602245 C30.0361742,24.0602245 30.0723188,24.0843209 30.0964151,24.1084172 C39.0723126,30.9397379 54.4337479,47.8071962 49.7470041,52.5782773 L49.7590523,52.5662291 L49.7590523,52.5782773 L49.7470041,52.5782773 C44.2771283,57.3734547 37.2650849,60.0120071 30.0000297,59.9999589 C22.7349744,60.0120071 15.7108828,57.3734547 10.2530552,52.5782773 L10.2410071,52.5662291 L10.2530552,52.5782773 C5.56631146,47.8071962 20.9277467,30.9276897 29.9036442,24.1084172 C29.9156924,24.0843209 29.9638851,24.0602245 30.0000297,24.0602245", { viewBox: "0 0 60 60", width: 16, height: 16, fillRule: "evenodd" }),
    playstation: Icon("M17.7516 12.8667C17.4035 13.3058 16.5507 13.6191 16.5507 13.6191L10.2065 15.8979V14.2173L14.8754 12.5538C15.4052 12.364 15.4866 12.0956 15.0559 11.9547C14.6261 11.8135 13.8477 11.854 13.3175 12.0446L10.2065 13.1403V11.3962L10.3858 11.3355C10.3858 11.3355 11.2848 11.0173 12.5488 10.8773C13.8129 10.738 15.3607 10.8963 16.5758 11.3569C17.9451 11.7896 18.0993 12.4275 17.7516 12.8667ZM10.8104 10.005V5.70728C10.8104 5.20255 10.7173 4.73788 10.2437 4.60633C9.88107 4.49017 9.65602 4.82693 9.65602 5.33126V16.0938L6.75349 15.1726V2.34009C7.9876 2.56918 9.78554 3.11075 10.7521 3.43658C13.2102 4.2805 14.0436 5.33085 14.0436 7.69748C14.0436 10.0042 12.6197 10.8785 10.8104 10.005ZM1.42767 14.0417C0.0219393 13.6458 -0.212012 12.8209 0.428722 12.3457C1.02089 11.907 2.02793 11.5767 2.02793 11.5767L6.18966 10.0969V11.7839L3.19485 12.8557C2.66583 13.0456 2.58447 13.3143 3.01432 13.4552C3.44458 13.596 4.22334 13.556 4.75317 13.3657L6.18966 12.8444V14.3537C6.09859 14.3699 5.997 14.3861 5.90309 14.4019C4.4662 14.6367 2.9358 14.5387 1.42767 14.0417Z", { viewBox: "0 0 18 18", width: 18, height: 18, fillRule: "evenodd" }),
    vr: Icon("M8.46 8.64a1 1 0 0 1 1 1c0 .44-.3.8-.72.92l-.11.07c-.08.06-.2.19-.2.41a.99.99 0 0 1-.98.86h-.06a1 1 0 0 1-.94-1.05l.02-.32c.05-1.06.92-1.9 1.99-1.9ZM15.55 5a5.5 5.5 0 0 1 5.15 3.67h.3a2 2 0 0 1 2 2v3.18a2 2 0 0 1-2 1.99h-.2A4.54 4.54 0 0 1 16.55 19a4.45 4.45 0 0 1-3.6-1.83 1.2 1.2 0 0 0-1.9 0 4.44 4.44 0 0 1-3.9 1.82 4.54 4.54 0 0 1-3.94-3.15H3a2 2 0 0 1-2-2v-3.18c0-1.1.9-1.99 2-1.99h.3A5.5 5.5 0 0 1 8.46 5h7.09Zm-7.1 2C6.6 7 5.06 8.5 4.97 10.41l-.02.66v3.18c0 1.43 1.05 2.66 2.34 2.74.85.06 1.63-.32 2.14-1.01a3.2 3.2 0 0 1 2.57-1.3c1 0 1.97.48 2.57 1.3.5.69 1.3 1.08 2.14 1.01 1.3-.08 2.34-1.31 2.34-2.74l-.02-3.84a3.54 3.54 0 0 0-3.49-3.43H8.45Z", { viewBox: "0 4 24 16", height: 20, width: 20 }),
};

// Spoof-target -> icon key. Android renders the same mobile icon Discord uses
// for it; consoles render their Discord brand icons instead of falling back to
// the desktop monitor.
const platformIcons: Record<string, string> = {
    windows: "desktop",
    linux: "desktop",
    macos: "desktop",
    android: "mobile",
    mobile: "mobile",
    web: "web",
    xbox: "xbox",
    playstation: "playstation",
    vr: "vr"
};

const platformMap: Record<string, string> = {
    windows: "Windows",
    linux: "Linux",
    macos: "MacOS",
    android: "Android",
    mobile: "iOS",
    web: "Web",
    xbox: "Xbox",
    playstation: "PlayStation",
    vr: "VR"
};

function PlatformIcon({ platform, status, small }: { platform: string; status: string; small: boolean; }) {
    const tooltip = platformMap[platform] ?? platform.charAt(0).toUpperCase() + platform.slice(1);
    const IconComponent = Icons[platformIcons[platform] ?? "desktop"];
    return <IconComponent color={useStatusFillColor(status)} tooltip={tooltip} small={small} />;
}

// Self-view indicator. All hooks run unconditionally at the top; the early
// return happens after them. Renders the plugin's own spoof target for the
// local user only; other users and the toggle-off case render nothing.
const VoiceIndicator = ErrorBoundary.wrap(({ userId }: { userId: string; }) => {
    settings.use(["showOwnSpoofed", "plateforme"]);
    const status = useStateFromStores([SessionsStore], () => SessionsStore.getSession()?.status ?? "online");
    if (userId !== AuthenticationStore.getId() || !settings.store.showOwnSpoofed) return null;
    const platform = settings.store.plateforme ?? "windows";
    return (
        <span className="vc-platform-indicator" style={{ display: "inline-flex", alignItems: "center", marginLeft: 4, verticalAlign: "middle" }}>
            <PlatformIcon platform={platform} status={status} small />
        </span>
    );
}, { noop: true });

export default definePlugin({
    id: "PlatformEmulator",
    name: "PlatformEmulator",
    description: "PlatformEmulator allows you to spoof your Discord platform (Windows, Linux, Android, iOS, etc.), with optional aggressive OS/client metadata spoofing. (dx maintains it, dont ask x2b for support with this)",
    tags: ["Privacy", "Utility"],
    authors: [TestcordDevs.sirphantom89, TestcordDevs.x2b, TestcordDevs.DavidHiFi],
    settings,
    settingsAboutComponent: () => (
        <Notice.Warning>
            Aggressive spoofing modifies IDENTIFY and client metadata. Risk is non-zero and may get you warned or banned.
        </Notice.Warning>
    ),
    patches: [
        {
            find: "_doIdentify(){",
            replacement: [
                {
                    match: /window._ws=null,null!=\i/,
                    replace: "false"
                },
                {
                    match: /(?<="GatewaySocket"\)\}\),properties:)(\i)/,
                    replace: "{...$1,...$self.getData()}"
                },
                {
                    match: /(\[IDENTIFY\].*?let.{0,5}=\{)/,
                    replace: "$1...$self.getIdentifyOverrides(),"
                },
            ]
        },
        {
            // Voice row right-side icon strip. Pushes a keyed self-indicator
            // element into the icons array just before the activity/game icon
            // group is pushed, so it sits immediately left of the activity
            // status icon. The push is a plain array operation with no hook
            // calls; visibility is decided inside the VoiceIndicator component.
            find: '"VoiceUserIcons"',
            replacement: {
                match: /(userId:(\i)\.id\}\)\},`\$\{\2\.id\}-game`\):null;return\()((\i)&&null!=(\i)&&(\i)\.push\(\5\),)/,
                replace: "$1$self.pushVoiceRowIndicator($6,$2.id),$3"
            }
        },
        {
            // Call tile name plate (main voice view). One replacement, so it
            // can never reference a variable that a failed first replacement
            // failed to introduce - the earlier destructure-alias form would
            // crash the whole module if the destructure line changed shape
            // while the push line still matched. The participant user id is
            // captured from the plate's own destructuring and threaded to the
            // appender; the bounded lazy gap keeps the anchor inside one
            // function scope.
            find: ',"title-text"))',
            replacement: {
                match: /participantUserId:(\i),channel:\i,platform:\i,[\s\S]{0,2600}?(\i)\.push\(\(0,\i\.jsx\)\("span",\{className:\i\(\)\(\i\.\i,\i\),children:\i\},"title-text"\)\)/,
                replace: "$&,$self.tileIndicatorPush($2,$1)"
            }
        },
    ],
    getData() {
        const selected = settings.store.plateforme ?? "windows";
        const info = infos[selected] ?? infos.windows;

        return {
            os: info.os,
            browser: info.browser
        };
    },
    getIdentifyOverrides() {
        // No-op unless aggressive spoofing is explicitly enabled.
        if (!settings.store.aggressiveSpoofing) return {};

        const platform = settings.store.plateforme ?? "windows";
        const level = settings.store.aggressiveLevel ?? "medium";
        const profile = resolveDesktopProfile(platform);

        // Low: minimal extra fields.
        const overrides: Record<string, any> = {
            properties: {
                os: profile.os,
                browser: "Chrome",
                device: "",
                system_locale: "en-US"
            },
            device: "",
            system_locale: "en-US"
        };

        if (level === "medium" || level === "high") {
            overrides.os_version = profile.osVersion;
            overrides.browser_version = "120.0.0.0";
            overrides.release_channel = "stable";
            overrides.referrer = "";
            overrides.referring_domain = "";
        }

        if (level === "high") {
            overrides.browser = "Chrome";
            overrides.browser_user_agent = profile.userAgent;
            overrides.client_version = "1.0.9000";
            overrides.client_build_number = 999999;
        }

        return overrides;
    },
    pushVoiceRowIndicator(arr: unknown[], userId: string) {
        // Appends a keyed indicator element to the voice row's right-side
        // icon array so it renders in the slot where Discord itself shows
        // other members' platform icons (left of the game icon the caller
        // pushes next). Plain array operation; the component decides
        // visibility.
        arr.push(<VoiceIndicator key="pe-self-view" userId={userId} />);
    },
    tileIndicatorPush(arr: unknown[], userId: string) {
        // Appends the keyed indicator to the call tile name plate's child
        // array right after the display name. Plain array operation.
        arr.push(<VoiceIndicator key="pe-self-view" userId={userId} />);
    },
    commands: [
        {
            name: "verify-platform",
            description: "Verify the spoofed platform by triggering a reconnect and displaying the current spoof.",
            execute: (args, ctx) => {
                const platform = settings.store.plateforme ?? "windows";
                const info = infos[platform] ?? infos.windows;
                const aggressive = settings.store.aggressiveSpoofing
                    ? ` | Aggressive: ${settings.store.aggressiveLevel ?? "medium"}`
                    : "";
                sendBotMessage(ctx.channel.id, {
                    content: `Current spoofed platform: ${info.os} (${info.browser})${aggressive}. Triggering reconnect to send IDENTIFY payload.`,
                    author: {
                        username: "PlatformEmulator"
                    }
                });
                // Trigger reconnect
                const gateway = findByProps("connect", "destroy");
                if (gateway) {
                    gateway.destroy();
                    setTimeout(() => gateway.connect(), 1000);
                }
            }
        }
    ]
});
