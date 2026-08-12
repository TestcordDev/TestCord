/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";

const settings = definePluginSettings({
    spoilerFilenames: {
        description: "Strings in filenames that should be spoilered. Comma separated.",
        type: OptionType.STRING,
        default: "",
    },
    spoilerLinks: {
        description: "Strings in link attachments that should be spoilered. Comma separated.",
        type: OptionType.STRING,
        default: ""
    },
    gifSpoilersOnly: {
        description: "Should the links only be gifs?",
        type: OptionType.BOOLEAN,
        default: true

    },
});

export default definePlugin({
    name: "TriggerWarning",
    authors: [TestcordDevs.x2b],
    description: "Spoiler attachments based on filenames and links.",
    tags: ["Notifications", "Utility"],
    patches: [
        {
            find: "SimpleMessageAccessories:",
            replacement: [
                {
                    match: /function \i\((\i),\i\){return/,
                    replace: "$& $self.shouldSpoiler($1.originalItem.filename) || "
                },
                {
                    match: /(\i)=\(0,\i\.getOb.{27,35}\);(?=if\((\i).type)/,
                    replace: "$&$1=$self.spoilerLink($1,$2.url,$2.type);"
                }
            ]
        }
    ],
    settings,
    _spoilerFilenames: [] as string[],
    _spoilerFilenamesRaw: undefined as string | undefined,
    _spoilerLinks: [] as string[],
    _spoilerLinksRaw: undefined as string | undefined,
    _getSpoilerFilenames(): string[] {
        const raw = settings.store.spoilerFilenames;
        if (raw === this._spoilerFilenamesRaw) return this._spoilerFilenames;
        this._spoilerFilenamesRaw = raw;
        this._spoilerFilenames = (raw || "").split(",").map(s => s.trim()).filter(Boolean);
        return this._spoilerFilenames;
    },
    _getSpoilerLinks(): string[] {
        const raw = settings.store.spoilerLinks;
        if (raw === this._spoilerLinksRaw) return this._spoilerLinks;
        this._spoilerLinksRaw = raw;
        this._spoilerLinks = (raw || "").split(",").map(s => s.trim()).filter(Boolean);
        return this._spoilerLinks;
    },
    shouldSpoiler(filename: string): string | null {
        if (!filename) return null;
        const strings = this._getSpoilerFilenames();
        if (!strings.length) return null;
        return strings.some(s => filename.includes(s)) ? "spoiler" : null;
    },
    spoilerLink(alreadySpoilered: string, link: string, type: string): string | null {
        if (alreadySpoilered) return alreadySpoilered;
        if (!link) return null;
        const strings = this._getSpoilerLinks();
        if (!strings.length) return alreadySpoilered;
        const isLinkSpoiler = strings.some(s => link.includes(s));

        if (settings.store.gifSpoilersOnly) {
            return type === "gifv" && isLinkSpoiler ? "spoiler" : null;
        } else {
            return isLinkSpoiler ? "spoiler" : null;
        }
    }
});
