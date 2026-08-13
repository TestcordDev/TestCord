/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { PluginNative } from "@utils/types";

export const Native = VencordNative.pluginHelpers.YMusicSync as PluginNative<typeof import("./native/index")> | undefined;
