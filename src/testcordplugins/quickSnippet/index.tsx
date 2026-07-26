/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Button, MessageStore, useState } from "@webpack/common";

const MarkdownRules = findByPropsLazy("RULES", "PROFILE_BIO_RULES");

const settings = definePluginSettings({
    whitelistChannels: {
        type: OptionType.STRING,
        description: "list of channel IDs to whitelist",
        default: "1032200195582197831, 1028106818368589824"
    },
    descriptions: {
        type: OptionType.BOOLEAN,
        description: "whether to add descriptions to code snippets in the quick css",
        default: true
    }
});

interface CodeBlock {
    lang: string;
    content: string;
}
interface Context {
    channelId: string | undefined;
    messageId: string | undefined;
}

function trimCodeBlocks(str: string) {
    let index = 0;
    let output = "";
    while (index < str.length) {
        const char = str[index];
        if (MarkdownRules.RULES.codeBlock.requiredFirstCharacters.includes(char)) {
            const match = MarkdownRules.RULES.codeBlock.match(str.slice(index));
            if (match) {
                index += (match[0].length - 1);
            }
        } else {
            output += char;
        }
        index++;
    }
    return output.trim();
}

const AppendButton = ErrorBoundary.wrap(function AppendButton(props: { code: CodeBlock; context: Context; }) {
    const { code, context } = props;
    const [appended, setAppended] = useState(false);
    if (code.lang.toLowerCase() !== "css" || !settings.store.whitelistChannels.includes(context.channelId || "undefined") && !settings.store.whitelistChannels.includes("all")) return null;

    return <Button
        look={Button.Looks.FILLED}
        onClick={() => {
            let trimedMessage = "";
            if (context.channelId && context.messageId) {
                const message = MessageStore.getMessage(context.channelId, context.messageId);
                if (message) trimedMessage = trimCodeBlocks(message.content);
            }
            const description = trimedMessage && settings.store.descriptions ? `/* \n${trimedMessage}\n*/\n\n` : "";
            VencordNative.quickCss.get().then(r => VencordNative.quickCss.set(r + "\n\n" + description + code.content));
            setAppended(true);
        }}
        className="qs-quickcss-append-button"
        size="">{appended ? <svg aria-hidden="true" role="img" width="16" height="16" fill="none" viewBox="0 0 24 24"><path fill="currentColor" d="M21.7 5.3a1 1 0 0 1 0 1.4l-12 12a1 1 0 0 1-1.4 0l-6-6a1 1 0 1 1 1.4-1.4L9 16.58l11.3-11.3a1 1 0 0 1 1.4 0Z"></path></svg> : <svg aria-hidden="true" role="img" width="16" height="16" fill="green" viewBox="0 0 24 24"><path fill="currentColor" d="M3 16a1 1 0 0 1-1-1v-5a8 8 0 0 1 8-8h5a1 1 0 0 1 1 1v.5a.5.5 0 0 1-.5.5H10a6 6 0 0 0-6 6v5.5a.5.5 0 0 1-.5.5H3Z"></path><path fill="currentColor" d="M6 18a4 4 0 0 0 4 4h8a4 4 0 0 0 4-4v-4h-3a5 5 0 0 1-5-5V6h-4a4 4 0 0 0-4 4v8Z"></path><path fill="currentColor" d="M21.73 12a3 3 0 0 0-.6-.88l-4.25-4.24a3 3 0 0 0-.88-.61V9a3 3 0 0 0 3 3h2.73Z"></path></svg>}</Button>;
}, { noop: true });

export default definePlugin({
    name: "QuickSnippet",
    description: "append css snippets quickly to quickCss with one click!",
    tags: ["Chat", "Shortcuts"],
    authors: [TestcordDevs.x2b],
    settings: settings,
    patches: [
        {
            find: "codeBlock:{react(",
            replacement: {
                match: /(codeBlock:\{react\((\i),(\i),(\i)\)\{.+?),children:(\(0,(\i)\.jsx\)\((\i),\{text:(\i)\.content\}\))/,
                replace: "$1,children:[$5, $self.AppendButton($2, $4)]"
            }
        }
    ],
    AppendButton: (code: CodeBlock, context: Context) => <AppendButton code={code} context={context} />
});
