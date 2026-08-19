/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
/**
 * The 2 themes that this plugin can toggle between: Light and Dark.
 */
export var ToggledTheme;
(function (ToggledTheme) {
    ToggledTheme[ToggledTheme["Light"] = 0] = "Light";
    ToggledTheme[ToggledTheme["Dark"] = 1] = "Dark";
})(ToggledTheme || (ToggledTheme = {}));
