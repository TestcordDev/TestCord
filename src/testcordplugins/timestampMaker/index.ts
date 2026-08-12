/*
 * MallCord, a vaporwave-inspired Discord client mod
 * Copyright (c) 2026 Dann
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandOptionType, findOption } from "@api/Commands";
import { MallCordDevs } from "@utils/constants";
import definePlugin from "@utils/types";

const UNITS: Record<string, number> = {
    minutes: 60_000,
    hours: 3_600_000,
    days: 86_400_000
};

export default definePlugin({
    name: "TimestampMaker",
    description: "/timestamp builds a Discord <t:> timestamp that shows in everyone's local time.",
    authors: [MallCordDevs.Dann],
    dependencies: ["CommandsAPI"],
    commands: [
        {
            name: "timestamp",
            description: "Make a Discord timestamp relative to now",
            options: [
                {
                    name: "amount",
                    description: "How far from now (0 = right now)",
                    type: ApplicationCommandOptionType.INTEGER,
                    required: true
                },
                {
                    name: "unit",
                    description: "Unit of time",
                    type: ApplicationCommandOptionType.STRING,
                    required: true,
                    choices: [
                        { name: "minutes", value: "minutes", label: "minutes" },
                        { name: "hours", value: "hours", label: "hours" },
                        { name: "days", value: "days", label: "days" }
                    ]
                },
                {
                    name: "style",
                    description: "How it's displayed",
                    type: ApplicationCommandOptionType.STRING,
                    required: false,
                    choices: [
                        { name: "relative (in 2 hours)", value: "R", label: "relative" },
                        { name: "short time", value: "t", label: "short time" },
                        { name: "long date + time", value: "F", label: "long" },
                        { name: "short date", value: "d", label: "short date" }
                    ]
                }
            ],
            execute: opts => {
                const amount = findOption(opts, "amount", 0);
                const unit = findOption(opts, "unit", "minutes");
                const style = findOption(opts, "style", "R");
                const unix = Math.floor((Date.now() + amount * (UNITS[unit] ?? 60_000)) / 1000);
                return { content: `<t:${unix}:${style}>` };
            }
        }
    ]
});
