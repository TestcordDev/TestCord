/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { classes } from "@utils/misc";
import { openModal } from "@utils/modal";
import { IconComponent } from "@utils/types";
import { Tooltip, useEffect, useState } from "@webpack/common";

import { settings } from "./settings";
import { TranslateModal } from "./TranslateModal";
import { cl } from "./utils";

export const TranslateIcon: IconComponent = ({ height = 20, width = 20, className }) => (
    <svg
        viewBox="0 96 960 960"
        height={height}
        width={width}
        className={classes(cl("icon"), className)}
    >
        <path fill="currentColor" d="m475 976 181-480h82l186 480h-87l-41-126H604l-47 126h-82Zm151-196h142l-70-194h-2l-70 194Zm-466 76-55-55 204-204q-38-44-67.5-88.5T190 416h87q17 33 37.5 62.5T361 539q45-47 75-97.5T487 336H40v-80h280v-80h80v80h280v80H567q-22 69-58.5 135.5T419 598l98 99-30 81-127-122-200 200Z" />
    </svg>
);

export let setShouldShowTranslateEnabledTooltip: undefined | ((show: boolean) => void);

const AUTO_TRANSLATE_KEYS = ["autoTranslate"];

export const TranslateChatBarIcon: ChatBarButtonFactory = ({ isMainChat }) => {
    const { autoTranslate } = settings.use(AUTO_TRANSLATE_KEYS);
    const [shouldShowTooltip, setter] = useState(false);

    useEffect(() => {
        setShouldShowTranslateEnabledTooltip = setter;
        return () => setShouldShowTranslateEnabledTooltip = undefined;
    }, []);

    if (!isMainChat) return null;

    const toggle = () => {
        settings.store.autoTranslate = !autoTranslate;
    };

    const button = (
        <ChatBarButton
            tooltip="Open NativeTranslate Modal"
            onClick={e => {
                if (e.shiftKey) return toggle();
                openModal((props: any) => <TranslateModal rootProps={props} />);
            }}
            onContextMenu={toggle}
            buttonProps={{ "aria-haspopup": "dialog" }}
        >
            <TranslateIcon className={cl({ "auto-translate": autoTranslate, "chat-button": true })} />
        </ChatBarButton>
    );

    if (shouldShowTooltip && settings.store.showAutoTranslateTooltip)
        return <Tooltip text="Auto Translate Enabled" forceOpen>{() => button}</Tooltip>;

    return button;
};
