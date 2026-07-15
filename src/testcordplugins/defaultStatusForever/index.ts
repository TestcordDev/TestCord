/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";

interface Choice {
    key: number;
    value: any;
    label: string;
}

export default definePlugin({
    name: "DefaultStatusForever",
    description: "Make statuses default to last forever",
    tags: ["Activity", "Utility"],
    authors: [TestcordDevs.x2b],

    patches: [],

    patchChoices(choices: Choice[]) {
        const nullChoice = choices.find(choice => choice.value === null);
        if (nullChoice) {
            choices.splice(choices.indexOf(nullChoice), 1);
            choices.unshift(nullChoice);
        }
        return choices;
    }
});
