/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { registerCommands } from "../api/registry";
import { loadCustomCommands, registerCustomCommands } from "./custom";
import { discordCommands } from "./discordActions";
import { testcordCommands } from "./testcord";
import { navigationCommands } from "./navigation";
import { pluginCommands } from "./pluginManagement";
import { sendDmCommand } from "./sendDm";
import { themeCommands } from "./themes";

export async function registerBuiltinCommands() {
    registerCommands("CommandPalette.builtin", [
        ...navigationCommands,
        ...discordCommands,
        ...pluginCommands,
        ...testcordCommands,
        ...themeCommands,
        sendDmCommand
    ]);

    await loadCustomCommands();
    registerCustomCommands();
}
