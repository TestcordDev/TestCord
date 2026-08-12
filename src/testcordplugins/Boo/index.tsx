/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";

import Boo from "./components/Boo";
import { BooProps } from "./types";

export default definePlugin({
    name: "Boo",
    description: "A cute ghost will appear if you don't answer their DMs",
    tags: ["Fun", "Utility"],
    authors: [TestcordDevs.x2b],
    patches: [
        {
            find: "interactiveSelected]",
            replacement: {
                match: /interactiveSelected.{0,50}children:\[/,
                replace: "$&$self.renderBoo(arguments[0]),"
            }
        }
    ],

    renderBoo: (props: BooProps) => {
        return (
            <ErrorBoundary noop>
                <Boo {...props} />
            </ErrorBoundary>
        );
    }
});
