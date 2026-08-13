/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { EquicordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { ComponentType, PropsWithChildren, ReactNode } from "react";

import { PinterestPicker, PinterestProfilePanel } from "./components";
import { settings } from "./shared";
import managedStyle from "./style.css?managed";

const PINTEREST_VIEW = "pinterest";
const WrappedPinterestPicker = ErrorBoundary.wrap(PinterestPicker, { noop: true });
const WrappedPinterestProfilePanel = ErrorBoundary.wrap(PinterestProfilePanel, { noop: true });

interface ExpressionPickerTabProps extends PropsWithChildren {
    id?: string;
    "aria-controls"?: string;
    "aria-selected"?: boolean;
    isActive?: boolean;
    viewType: string;
}

export default definePlugin({
    name: "PinterestSearch",
    description: "Adds Pinterest search to the GIF picker for images and GIFs.",
    tags: ["Utility", "Customisation"],
    authors: [EquicordDevs.omaw],
    settings,
    managedStyle,
    patches: [
        {
            find: "#{intl::EXPRESSION_PICKER_CATEGORIES_A11Y_LABEL}",
            replacement: [
                {
                    match: /(\i)=((\i)\?Vencord\.Plugins\.plugins\["FavouriteAnything"\]\.renderTabs\((\i),(\i)\):null),/,
                    replace: "$1=$self.renderTabs($2,$4,$5),"
                },
                {
                    match: /((\i)===\i\.\i\.GIF&&\i\?\(0,\i\.jsx\)\(\i\.\i,\{onSelectGIF:(\i),hideFavorites:\i,persistSearch:!0\}\):null,)/,
                    replace: "$1$2===\"pinterest\"?$self.renderPinterestPickerComponent({onSelectGIF:$3}):null,"
                }
            ]
        },
        {
            find: "DefaultCustomizationSections: user cannot be undefined",
            noWarn: true,
            replacement: {
                match: /className:R\.Q,children:\[/,
                replace: "className:R.Q,children:[$self.renderEditProfileButton({}),",
            }
        },
        {
            find: "USER_SETTINGS_GUILD_PROFILE)",
            noWarn: true,
            replacement: {
                match: /guildId:(\i\.id),onChange:(\i)\}\)(?=.{0,25}profilePreviewTitle:)/,
                replace: "guildId:$1,onChange:$2}),$self.renderEditProfileButton({guildId:$1})"
            }
        }
    ],
    renderTabs(existingTabs: ReactNode, Tab: ComponentType<ExpressionPickerTabProps>, activeView: string) {
        return (
            <>
                {existingTabs}
                <Tab
                    id="pinterest-picker-tab"
                    key="pinterest-picker-tab"
                    aria-controls="pinterest-picker-tab-panel"
                    aria-selected={activeView === PINTEREST_VIEW}
                    isActive={activeView === PINTEREST_VIEW}
                    viewType={PINTEREST_VIEW}
                >
                    Pinterest
                </Tab>
            </>
        );
    },
    renderPinterestPickerComponent({ onSelectGIF }: { onSelectGIF: (item: { url: string; }) => void; }) {
        return <WrappedPinterestPicker onSelectItem={onSelectGIF} />;
    },
    renderEditProfileButton({ guildId }: { guildId?: string; }) {
        return <WrappedPinterestProfilePanel guildId={guildId} />;
    }
});
