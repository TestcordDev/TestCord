/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption } from "@api/Commands";
import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { addHeaderBarButton, removeHeaderBarButton } from "@api/HeaderBar";
import { EquicordDevs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import definePlugin from "@utils/types";
import { Channel, Guild, User } from "@vencord/discord-types";
import { Menu, React } from "@webpack/common";

import { HotkeyReferenceButton } from "./components/HotkeyReferenceButton";
import { WorkspaceHost } from "./components/WorkspaceHost";
import { WorkspaceSwitcherButton } from "./components/WorkspaceSwitcherButton";
import {
    attachKeyListener,
    buildRouteTargetFromRouteProps,
    detachKeyListener,
    isHyprTilesRunning,
    makeTargetFromChannel,
    makeTargetFromGuild,
    makeTargetFromUser,
    openTargetAsTile,
    reloadHyprTilesRules,
    sendFocusedToNamedGroup,
    setHyprTilesRunning,
    toggleAutoLayoutMode,
    toggleScratchpadById,
} from "./controller";
import { settings } from "./settings";
import { HyprTilesStore, initializeHyprTilesStore } from "./store";
import managedStyle from "./styles.css?managed";
import { RouteRenderPropsLike } from "./types";

type ContextMenuChildren = Array<React.ReactElement<object> | null | undefined>;
const cl = classNameFactory("vc-hyprtiles-");

function insertItem(children: ContextMenuChildren, item: React.ReactElement<object>, fallbackAtEnd = true) {
    const ids = [
        "channel-copy-link",
        "thread-copy-link",
        "gdm-invite-people",
        "user-profile",
        "mark-folder-read",
        "privacy",
    ];

    for (const id of ids) {
        const group = findGroupChildrenByChildId(id, children, true);
        if (group) {
            group.push(item);
            return;
        }
    }

    if (fallbackAtEnd) {
        children.push(<Menu.MenuGroup key={cl("group")}>{item}</Menu.MenuGroup>);
    }
}

const channelContextPatch: NavContextMenuPatchCallback = (children, props: { channel?: Channel; }) => {
    const target = makeTargetFromChannel(props.channel);
    if (!target) return;
    if (props.channel?.type === 4) return;

    insertItem(children, (
        <Menu.MenuItem
            id="vc-hyprtiles-open-channel"
            label="Open as Tile"
            action={() => void openTargetAsTile(target, "contextMenu")}
        />
    ));
};

const userContextPatch: NavContextMenuPatchCallback = (children, props: { user?: User; }) => {
    if (!props.user) return;

    insertItem(children, (
        <Menu.MenuItem
            id="vc-hyprtiles-open-user"
            label="Open DM as Tile"
            action={() => {
                void makeTargetFromUser(props.user).then(target => {
                    if (target) openTargetAsTile(target, "contextMenu");
                });
            }}
        />
    ));
};

const guildContextPatch: NavContextMenuPatchCallback = (children, props: { guild?: Guild; }) => {
    const target = makeTargetFromGuild(props.guild);
    if (!target) return;

    insertItem(children, (
        <Menu.MenuItem
            id="vc-hyprtiles-open-guild"
            label="Open Server as Tile"
            action={() => void openTargetAsTile(target, "contextMenu")}
        />
    ));
};

type RouteRenderer = (props: RouteRenderPropsLike) => React.ReactNode;

export default definePlugin({
    name: "HyprTiles",
    description: "Hyprland-style tiled workspaces for Discord channels, DMs, and threads.",
    authors: [EquicordDevs.benjii],
    dependencies: ["ContextMenuAPI", "HeaderBarAPI"],
    tags: ["Customisation", "Appearance"],

    managedStyle,
    settings,

    commands: [
        {
            name: "hyprtiles reload rules",
            description: "Reload the HyprTiles rules file.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: async () => ({
                content: (await reloadHyprTilesRules(false)).ok
                    ? "HyprTiles rules reloaded."
                    : "HyprTiles rules reload failed."
            })
        },
        {
            name: "hyprtiles toggle scratchpad",
            description: "Toggle a named HyprTiles scratchpad.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "id",
                    description: "Scratchpad id",
                    type: ApplicationCommandOptionType.STRING,
                    required: true,
                }
            ],
            execute: opts => ({
                content: toggleScratchpadById(findOption(opts, "id", "")) ? "Scratchpad toggled." : "Scratchpad not available."
            })
        },
        {
            name: "hyprtiles send to group",
            description: "Send the focused tile into an existing named tab group.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "name",
                    description: "Tab group name",
                    type: ApplicationCommandOptionType.STRING,
                    required: true,
                }
            ],
            execute: opts => ({
                content: sendFocusedToNamedGroup(findOption(opts, "name", "")) ? "Focused tile sent to tab group." : "Named tab group not found."
            })
        },
        {
            name: "hyprtiles toggle auto layout",
            description: "Toggle auto layout for the active workspace.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: () => ({
                content: toggleAutoLayoutMode() ? "HyprTiles auto layout toggled." : "Unable to toggle auto layout."
            })
        }
    ],

    contextMenus: {
        "channel-context": channelContextPatch,
        "thread-context": channelContextPatch,
        "gdm-context": channelContextPatch,
        "channel-mention-context": channelContextPatch,
        "user-context": userContextPatch,
        "guild-context": guildContextPatch,
    },

    patches: [
        {
            find: "\"AppView\"",
            replacement: {
                match: /render:(\i),impressionName:(\i)\.ImpressionNames\.GUILD_CHANNEL/,
                replace: "render:$self.wrapChannelRoute($1),impressionName:$2.ImpressionNames.GUILD_CHANNEL"
            }
        },
        {
            find: '"BACK_FORWARD_NAVIGATION"',
            replacement: {
                match: /(\i&&\(0,\i\.jsx\)\(\i\.\i,\{firstElementFocusJumpSectionProps:"BACK_FORWARD_NAVIGATION"===\i\?\i:void 0\}\))/,
                replace: "$1,$self.renderWorkspaceSwitcher()"
            }
        },
        {
            // Search autocomplete popout: enable autoInvert so the popout flips
            // above the search bar when the tile is near the viewport bottom,
            // preventing it from covering the bar in small bottom-corner tiles.
            find: "searchPopout",
            replacement: {
                match: /shouldShow:(\i),autoInvert:!1/,
                replace: "shouldShow:$1,autoInvert:!0"
            }
        },
        {
            // Prevent the Video PIP from auto-opening when switching tile focus.
            // Discord opens the PIP whenever the voice channel ≠ selected channel
            // and an active stream/video exists. In HyprTiles, the voice channel
            // tile is still visible even when it loses primary focus, so we
            // suppress PIP for any voice channel currently shown in a tile.
            find: "getVideoVoiceStatesForChannel(e)).some",
            replacement: {
                match: /(!\(\i&&\i\.\i\.getLayers\(\)\.includes\(\i\.\i\.RTC_DEBUG\)\)&&\(!!\i\|\|(\i)===\i\))/,
                replace: "($1)||$self.isVoiceChannelInTiles($2)"
            }
        },
    ],

    wrappedChannelRenderers: new WeakMap<RouteRenderer, RouteRenderer>(),

    isVoiceChannelInTiles(voiceChannelId: string | null): boolean {
        if (!isHyprTilesRunning() || !voiceChannelId) return false;
        const workspace = HyprTilesStore.getActiveWorkspace();
        return Object.values(workspace.nodesById).some(node =>
            node.kind === "leaf" && node.tileIds.some(id => HyprTilesStore.getTile(id)?.channelId === voiceChannelId)
        );
    },

    renderWorkspaceSwitcher() {
        return <WorkspaceSwitcherButton />;
    },

    wrapChannelRoute(originalRender: RouteRenderer): RouteRenderer {
        const cached = this.wrappedChannelRenderers.get(originalRender);
        if (cached) return cached;

        const wrapped: RouteRenderer = routeProps => {
            const routeElement = originalRender(routeProps);
            if (!isHyprTilesRunning()) return routeElement;
            const routeTarget = buildRouteTargetFromRouteProps(routeProps);

            return (
                <WorkspaceHost
                    routeTarget={routeTarget}
                    routeElement={routeElement}
                />
            );
        };

        this.wrappedChannelRenderers.set(originalRender, wrapped);
        return wrapped;
    },

    _borderScanQueued: false,
    _borderObserver: null as ReturnType<typeof setInterval> | null,
    _applyBordersKey: null as string | null,
    _startupTimer: null as ReturnType<typeof setTimeout> | null,

    start() {
        initializeHyprTilesStore();
        setHyprTilesRunning(true);
        attachKeyListener();
        addHeaderBarButton("HyprTiles-hotkeys", () => <HotkeyReferenceButton />, 6);

        this._startupTimer = setTimeout(() => {
            this._startupTimer = null;
            this.applyBorders();
        }, 1000);

        const observer = setInterval(() => {
            if (this._borderScanQueued) return;
            this._borderScanQueued = true;
            requestAnimationFrame(() => {
                this._borderScanQueued = false;
                this.applyBorders();
            });
        }, 1000);
        this._borderObserver = observer;
    },

    stop() {
        detachKeyListener();
        setHyprTilesRunning(false);
        removeHeaderBarButton("HyprTiles-hotkeys");
        this.removeBorders();

        if (this._startupTimer !== null) {
            clearTimeout(this._startupTimer);
            this._startupTimer = null;
        }
        this._borderScanQueued = false;
        if (this._borderObserver) {
            clearInterval(this._borderObserver);
            this._borderObserver = null;
        }
    },

    applyBorders() {
        const s = settings.store;
        const key = [
            s.enableBorders, s.borderWidth, s.borderColor, s.borderColorEnd,
            s.animationSpeed, s.enableGradients, s.animatedBorder, s.showChannelName
        ].join(",");
        if (key === this._applyBordersKey) return;
        this._applyBordersKey = key;

        const root = document.documentElement;
        if (!s.enableBorders) { this.removeBorders(); return; }

        root.style.setProperty("--hyprtiles-border-width", `${s.borderWidth}px`);
        root.style.setProperty("--hyprtiles-border-color", s.borderColor);
        root.style.setProperty("--hyprtiles-border-color-end", s.borderColorEnd);
        root.style.setProperty("--hyprtiles-animation-speed", `${11 - s.animationSpeed}s`);

        const body = document.body.classList;
        body.add("vc-hyprtiles-premium-borders");
        body.toggle("vc-hyprtiles-premium-gradient", s.enableGradients);
        body.toggle("vc-hyprtiles-premium-animated", s.enableGradients && s.animatedBorder);
        body.toggle("vc-hyprtiles-premium-hide-channel-name", !s.showChannelName);
    },

    removeBorders() {
        const body = document.body.classList;
        body.remove(
            "vc-hyprtiles-premium-borders",
            "vc-hyprtiles-premium-gradient",
            "vc-hyprtiles-premium-animated",
            "vc-hyprtiles-premium-hide-channel-name"
        );
    }
});
