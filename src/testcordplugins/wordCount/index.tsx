/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addMessageAccessory, removeMessageAccessory } from "@api/MessageAccessories";
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { Text, useMemo } from "@webpack/common";

function WordCount({ messageContent }: { messageContent: string; }) {
    const words = useMemo(
        () => messageContent.split(/\s+/).filter((word: string) => word.length > 0).length,
        [messageContent]
    );

    if (words <= 5) return null;
    const characters = messageContent.length;

    return (
        <div>
            <Text
                variant="text-xs/normal"
                style={{ color: "var(--text-muted)" }}
            >
                {words} words, {characters} characters
            </Text>
        </div>
    );
}

export default definePlugin({
    name: "WordCount",
    description: "Shows the word count of a message below it",
    tags: ["Chat", "Utility"],
    authors: [TestcordDevs.x2b],
    dependencies: ["MessageAccessoriesAPI"],
    async start() {
        addMessageAccessory("word-count", (props: Record<string, any>) => (
            <WordCount messageContent={props.message.content} />
        ), 2);
    },
    stop() {
        removeMessageAccessory("word-count");
    }
});
