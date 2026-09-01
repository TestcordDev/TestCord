/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { EquicordDevs } from "@utils/constants";
import { classes } from "@utils/misc";
import definePlugin from "@utils/types";
import { findCssClassesLazy } from "@webpack";
import { ExpressionPickerStore } from "@webpack/common";
import { ComponentType, PropsWithChildren, ReactNode } from "react";

import { PinterestPicker, PinterestProfilePanel } from "./components";
import { settings } from "./shared";
import managedStyle from "./style.css?managed";

const tabCss = findCssClassesLazy("navButton", "navItem", "navButtonActive");

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
                    match: /children:\[(\i),(\i),(\i),/,
                    replace: "children:[$1,$2,$3,$self.renderPinterestTabSimple(),"
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
    renderPinterestTabSimple() {
        const activeView = ExpressionPickerStore.useExpressionPickerStore(s => s.activeView);
        const isActive = activeView === PINTEREST_VIEW;
        return (
            <div
                role="tab"
                id="pinterest-picker-tab"
                aria-controls="pinterest-picker-tab-panel"
                aria-selected={isActive}
                className={classes(tabCss.navButton, tabCss.navItem, isActive && tabCss.navButtonActive)}
                onClick={() => ExpressionPickerStore.setExpressionPickerView(PINTEREST_VIEW)}
                data-view-type={PINTEREST_VIEW}
            >
                Pinterest
            </div>
        );
    },
    renderPinterestPickerComponent({ onSelectGIF }: { onSelectGIF: (item: { url: string; }) => void; }) {
        return <WrappedPinterestPicker onSelectItem={onSelectGIF} />;
    },
    renderEditProfileButton({ guildId }: { guildId?: string; }) {
        return <WrappedPinterestProfilePanel guildId={guildId} />;
    }
});
