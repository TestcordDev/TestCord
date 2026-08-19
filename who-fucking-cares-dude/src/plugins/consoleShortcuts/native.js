/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
export function initDevtoolsOpenEagerLoad(e) {
    const handleDevtoolsOpened = () => e.sender.executeJavaScript("Vencord.Plugins.plugins.ConsoleShortcuts.eagerLoad(true)");
    if (e.sender.isDevToolsOpened())
        handleDevtoolsOpened();
    else
        e.sender.once("devtools-opened", () => handleDevtoolsOpened());
}
