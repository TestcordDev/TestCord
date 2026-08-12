/*
 * ConsoleWatcher — أداة مطوّر لمراقبة أحداث الكونسول وجمعها للصيانة
 * Copyright (c) 2026 LOSTSTR
 *
 * مبنية على Equicord المرخّصة GPL-3.0-or-later وتخضع لنفس الرخصة.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { t } from "@utils/testcordI18n";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    includeLog: {
        type: OptionType.BOOLEAN,
        description: t(
            "تضمين console.log (مُعطَّل افتراضياً لأنها كثيرة جداً)",
            "Include console.log (off by default — very noisy)"
        ),
        default: false
    },
    includeTrace: {
        type: OptionType.BOOLEAN,
        description: t(
            "تضمين console.trace (مُعطَّل افتراضياً)",
            "Include console.trace (off by default)"
        ),
        default: false
    },
    maxEvents: {
        type: OptionType.NUMBER,
        description: t(
            "الحد الأقصى لعدد الأحداث المحفوظة (يُقيَّد بين 50 و5000)",
            "Maximum stored events (clamped between 50 and 5000)"
        ),
        default: 500
    }
});
