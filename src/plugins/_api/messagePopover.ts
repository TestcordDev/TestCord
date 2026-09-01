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

import { disableStyle, enableStyle, setStyleClassNames } from "@api/Styles";
import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { findCssClassesLazy } from "@webpack";

import style from "./messagePopover.css?managed";

const messageClasses = findCssClassesLazy("messageListItem", "message");

export default definePlugin({
    name: "MessagePopoverAPI",
    description: "API to add buttons to message popovers.",
    authors: [Devs.KingFish, Devs.Ven, Devs.Nuckyz],

    start() {
        try {
            const mli = (messageClasses as any)?.messageListItem;
            const msg = (messageClasses as any)?.message;
            if (mli || msg) {
                setStyleClassNames(style, {
                    messageListItem: mli ?? "messageListItem",
                    message: msg ?? "message"
                });
            } else {
                new Logger("MessagePopoverAPI").warn("messageListItem/message classes not found, skipping style injection");
            }
        } catch (e) {
            new Logger("MessagePopoverAPI").warn("Failed to resolve message classes:", e);
        }
        enableStyle(style);
    },

    stop() {
        disableStyle(style);
    },

    patches: [
        {
            find: "#{intl::MESSAGE_UTILITIES_A11Y_LABEL}",
            replacement: [
                // Primary: New Discord Canary - togglePopout and message are in the same
                // nE component call, followed by a np toolbar button with {label:
                {
                    match: /\{togglePopout:\i,.+?message:(\i)\}\)\]\}\):null,.*?\(?\(0,\i\.jsx\)\((\i),\{label:/,
                    replace: (_, message, buttonComponent) => {
                        const i = _.indexOf("):null,") + 7;
                        return _.slice(0, i) + `Vencord.Api.MessagePopover._buildPopoverElements(Vencord.Api.MessagePopover._captureToolbarButton(${buttonComponent}),${message}),` + _.slice(i);
                    }
                },
                // Fallback: New Discord Canary - match togglePopout component, inject without button capture
                {
                    noWarn: true,
                    match: /\{togglePopout:\i,.+?message:(\i)\}\)\]\}\):null,(?!Vencord\.Api\.MessagePopover)/,
                    replace: "$&Vencord.Api.MessagePopover._buildPopoverElements(null,$1),"
                },
                // Fallback 1: PTB/Stable - simpler react button with togglePopout (no Fragment)
                {
                    noWarn: true,
                    match: /(\i&&\(0,\i\.jsxs?\)\(\i,\{message:(\i),togglePopout:\i\}\))/,
                    replace: (_, reactBtn, message) =>
                        `Vencord.Api.MessagePopover._buildPopoverElements(null,${message}),${reactBtn}`
                },
                // Fallback 2: PTB/Stable - react button with jsxs (multiple children, e.g. tooltip wrapper)
                {
                    noWarn: true,
                    match: /(\i\?\(0,\i\.jsxs?\)\(\i,\{message:(\i),togglePopout:\i\}\))/,
                    replace: (_, reactBtn, message) =>
                        `Vencord.Api.MessagePopover._buildPopoverElements(null,${message}),${reactBtn}`
                },
                // Fallback 3: Most basic - just find togglePopout in any conditional render
                {
                    noWarn: true,
                    match: /,(\i&&\(0,\i\.jsxs?\)\(\i,\{message:(\i),togglePopout:\i\}\))/,
                    replace: ",Vencord.Api.MessagePopover._buildPopoverElements(null,$2),$1"
                },
                // Fallback 4: Stable/older Discord - direct function call (React.createElement), no (0,fn) wrapper
                {
                    noWarn: true,
                    match: /(\i&&\i\(\i,\{message:(\i),togglePopout:\i\}\))/,
                    replace: (_, reactBtn, message) =>
                        `Vencord.Api.MessagePopover._buildPopoverElements(null,${message}),${reactBtn}`
                },
                // Fallback 5: Stable/older Discord - ternary with direct function call
                {
                    noWarn: true,
                    match: /(\i\?\i\(\i,\{message:(\i),togglePopout:\i\}\))/,
                    replace: (_, reactBtn, message) =>
                        `Vencord.Api.MessagePopover._buildPopoverElements(null,${message}),${reactBtn}`
                },
                // Fallback 6: Stable - comma-prefixed direct call
                {
                    noWarn: true,
                    match: /,(\i&&\i\(\i,\{message:(\i),togglePopout:\i\}\))/,
                    replace: ",Vencord.Api.MessagePopover._buildPopoverElements(null,$2),$1"
                },
                // Fallback 7: Any togglePopout pattern with optional tooltip wrapper (message up to 200 chars before togglePopout)
                {
                    noWarn: true,
                    match: /(\i[?&]\i\(.{0,30}\i,\{message:(\i).{0,200}togglePopout:\i\}\))/,
                    replace: (_, reactBtn, message) =>
                        `Vencord.Api.MessagePopover._buildPopoverElements(null,${message}),${reactBtn}`
                },
                // Fallback 8: Widest net - comma-prefixed version of the above
                {
                    noWarn: true,
                    match: /,(\i[?&]\i\(.{0,30}\i,\{message:(\i).{0,200}togglePopout:\i\}\))/,
                    replace: ",Vencord.Api.MessagePopover._buildPopoverElements(null,$2),$1"
                }
            ]
        }
    ]
});
