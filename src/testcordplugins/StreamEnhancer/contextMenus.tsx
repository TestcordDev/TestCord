/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import type { User } from "@vencord/discord-types";
import { Menu } from "@webpack/common";
import type { ReactElement } from "react";

import { applicationStreamingStore } from "./runtime";
import * as streamState from "./state";
import type { StreamDescriptor } from "./types";

const renderStreamContextItems = (ownerId: string | null, stream?: StreamDescriptor | null) => {
    if (ownerId == null && stream == null) return null;

    const items: ReactElement[] = [];

    if (ownerId != null) {
        const autoWatchEnabled = streamState.isAutoWatchEnabledForUser(ownerId);
        const autoFocusEnabled = streamState.isAutoFocusEnabledForUser(ownerId);

        items.push(
            <Menu.MenuCheckboxItem
                id="stream-enhancer-auto-watch"
                key="stream-enhancer-auto-watch"
                label="Auto watch stream"
                checked={autoWatchEnabled}
                action={() => {
                    const nextEnabled = !autoWatchEnabled;
                    streamState.setAutoWatchEnabledForUser(ownerId, nextEnabled);
                }}
            />
        );
        items.push(
            <Menu.MenuCheckboxItem
                id="stream-enhancer-auto-focus"
                key="stream-enhancer-auto-focus"
                label="Auto focus stream"
                checked={autoFocusEnabled}
                action={() => {
                    const nextEnabled = !autoFocusEnabled;
                    streamState.setAutoFocusEnabledForUser(ownerId, nextEnabled);
                    if (nextEnabled) streamState.setAutoWatchEnabledForUser(ownerId, true);
                }}
            />
        );
    }

    return items;
};

export const streamContextPatch: NavContextMenuPatchCallback = (children, { stream }: { stream?: StreamDescriptor; }) => {
    const items = renderStreamContextItems(streamState.normalizeUserId(stream?.ownerId), stream);
    if (items?.length == null || items.length === 0) return;

    children.push(<Menu.MenuSeparator key="stream-enhancer-separator" />, ...items);
};

export const userContextPatch: NavContextMenuPatchCallback = (children, { user }: { user?: User; }) => {
    if (user == null) return;

    const items = renderStreamContextItems(
        streamState.normalizeUserId(user.id),
        applicationStreamingStore?.getAnyStreamForUser?.(user.id)
    );

    if (items?.length == null || items.length === 0) return;

    children.push(<Menu.MenuSeparator key="stream-enhancer-separator" />, ...items);
};
