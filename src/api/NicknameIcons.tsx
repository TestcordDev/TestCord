/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { Logger } from "@utils/Logger";
import { ReactNode } from "react";

export interface NicknameIconProps {
    userId: string;
}

export type NicknameIconFactory = (props: NicknameIconProps) => ReactNode | Promise<ReactNode>;

export interface NicknameIcon {
    priority: number;
    factory: NicknameIconFactory;
}

const nicknameIcons = new Map<string, NicknameIcon>();
const logger = new Logger("NicknameIcons");

/**
 * `_renderIcons` runs for every member list row and every message author, and it used to
 * copy the whole registry and re-sort it on each of those. The registry only changes when
 * an icon is added or removed, so the ordering is cached until then. `Array#sort` is
 * stable, so re-sorting after a change gives the same order a fresh sort would.
 */
let sortedIcons: Array<[string, NicknameIcon]> | null = null;

function getSortedIcons() {
    sortedIcons ??= Array.from(nicknameIcons).sort((a, b) => b[1].priority - a[1].priority);
    return sortedIcons;
}

export function addNicknameIcon(id: string, factory: NicknameIconFactory, priority = 0) {
    sortedIcons = null;
    return nicknameIcons.set(id, {
        priority,
        factory: ErrorBoundary.wrap(factory, { noop: true, onError: error => logger.error(`Failed to render ${id}`, error) })
    });
}

export function removeNicknameIcon(id: string) {
    sortedIcons = null;
    return nicknameIcons.delete(id);
}

export function _renderIcons(props: NicknameIconProps) {
    return getSortedIcons()
        .map(([id, { factory: NicknameIcon }]) => <NicknameIcon key={id} {...props} />);
}
