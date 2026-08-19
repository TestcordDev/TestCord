/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import "./style.css";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { FluxDispatcher as Flux, Forms } from "@webpack/common";
const options = {
    type: "EXPERIMENT_OVERRIDE_BUCKET",
    experimentId: "2023-10_social_proofing_message_nitro_badge",
};
const settings = definePluginSettings({
    experimentTreatment: {
        description: "Which treatment to enable the experiment with",
        type: 4 /* OptionType.SELECT */,
        restartNeeded: true,
        options: [
            { label: "Treatment 1: Prefer BOTH nitro badge AND role icon(s)", value: "1", default: true },
            { label: "Treatment 2: Prefer role icon(s) over nitro badge if both are present", value: "2" },
        ]
    }
});
export default definePlugin({
    name: "MessageNitroBadge",
    description: "Enables the Social Proofing Message Nitro Badge experiment",
    tags: ["Chat", "Customisation"],
    authors: [TestcordDevs.x2b],
    settings,
    dependencies: ["Experiments"],
    settingsAboutComponent: () => <>
        <Forms.FormText className="vc-plugin-messageNitroBadge-notice">
            Only shows Nitro Badge in servers <br />
            Doesnt show Nitro Badge for other people - ONLY YOURSELF
        </Forms.FormText>
    </>,
    start: () => Flux.dispatch({ ...options, experimentBucket: Number(settings.store.experimentTreatment) }),
    stop: () => Flux.dispatch({ ...options, experimentBucket: null }),
});
