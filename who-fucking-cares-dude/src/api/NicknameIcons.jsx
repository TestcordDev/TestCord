/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import ErrorBoundary from "@components/ErrorBoundary";
import { Logger } from "@utils/Logger";
const nicknameIcons = new Map();
const logger = new Logger("NicknameIcons");
export function addNicknameIcon(id, factory, priority = 0) {
    return nicknameIcons.set(id, {
        priority,
        factory: ErrorBoundary.wrap(factory, { noop: true, onError: error => logger.error(`Failed to render ${id}`, error) })
    });
}
export function removeNicknameIcon(id) {
    return nicknameIcons.delete(id);
}
export function _renderIcons(props) {
    return Array.from(nicknameIcons)
        .sort((a, b) => b[1].priority - a[1].priority)
        .map(([id, { factory: NicknameIcon }]) => <NicknameIcon key={id} {...props}/>);
}
