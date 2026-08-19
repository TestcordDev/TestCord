/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { sendBotMessage } from "@api/Commands";
import { definePluginSettings } from "@api/Settings";
import definePlugin from "@utils/types";
import { RestAPI } from "@webpack/common";
const HOUSES = {
    0: "None",
    1: "Bravery",
    2: "Brilliance",
    3: "Balance"
};
const settings = definePluginSettings({
    currentHouse: {
        type: 4 /* OptionType.SELECT */,
        description: "Your current HypeSquad house",
        options: [
            { label: "Remove Badge", value: 0, default: true },
            { label: "House Bravery", value: 1 },
            { label: "House Brilliance", value: 2 },
            { label: "House Balance", value: 3 }
        ],
        onChange: async (newValue) => {
            await applyHouse(newValue);
        }
    }
});
async function applyHouse(houseId) {
    try {
        if (houseId === 0) {
            await RestAPI.del({ url: "/hypesquad/online" });
            sendBotMessage("1", { content: "✅ HypeSquad badge removed" });
            return;
        }
        if (![1, 2, 3].includes(houseId)) {
            sendBotMessage("1", { content: "❌ Invalid house ID. Use 0 (remove), 1 (Bravery), 2 (Brilliance), or 3 (Balance)" });
            return;
        }
        await RestAPI.post({
            url: "/hypesquad/online",
            body: { house_id: houseId }
        });
        sendBotMessage("1", { content: `✅ HypeSquad set to ${HOUSES[houseId]}` });
    }
    catch (error) {
        sendBotMessage("1", { content: `❌ Request failed: ${error}` });
    }
}
export default definePlugin({
    name: "HypeSquadSwitcher",
    description: "Easily switch between HypeSquad houses or remove your badge",
    authors: [
        {
            name: "Dipraj",
            id: 1407738161471422495n,
        },
        {
            name: "Coder",
            id: 1099039269391171765n,
        }
    ],
    tags: ["Appearance", "Customisation"],
    enabledByDefault: false,
    settings,
    commands: [
        {
            name: "hypesquad",
            description: "Apply or remove your HypeSquad badge",
            inputType: 0 /* ApplicationCommandInputType.BUILT_IN */,
            options: [
                {
                    name: "house",
                    description: "0: Remove | 1: Bravery | 2: Brilliance | 3: Balance",
                    type: 4 /* ApplicationCommandOptionType.INTEGER */,
                    required: true,
                    choices: [
                        { label: "Remove Badge", value: "0", name: "Remove Badge" },
                        { label: "House Bravery", value: "1", name: "House Bravery" },
                        { label: "House Brilliance", value: "2", name: "House Brilliance" },
                        { label: "House Balance", value: "3", name: "House Balance" }
                    ]
                }
            ],
            execute: async (args, ctx) => {
                const houseId = parseInt(args[0].value, 10);
                settings.store.currentHouse = houseId;
                await applyHouse(houseId);
            }
        }
    ]
});
