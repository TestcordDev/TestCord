/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 nin0
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { definePluginSettings } from "@api/Settings";
import { Flex } from "@components/Flex";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { Alerts, Button, ChannelStore, GuildMemberStore, GuildStore, SelectedGuildStore, useEffect, UserStore, useState } from "@webpack/common";
import ace from "file://ace/ace.js?minify";
import highlighter from "file://ace/highlighter.js?minify";
import theme from "file://ace/theme.js?minify";

import { Challenge } from "./components/Challenge";
import { RuleList } from "./components/RuleList";
import { makeEmptyRule, makeEmptyRuleArray } from "./utils";

const callbacks: any[] = [];

export const settings = definePluginSettings({
    hasDoneChallenge: {
        description: "",
        type: OptionType.BOOLEAN,
        hidden: true,
        default: false
    },
    rules: {
        type: OptionType.CUSTOM as any,
        default: makeEmptyRuleArray()
    } as any,
    rc: {
        type: OptionType.COMPONENT,
        component: () => {
            const reactiveSettings = settings.use(["hasDoneChallenge"]);
            const [t, setT] = useState(Date.now());
            useEffect(() => {
                callbacks.push(() => setT(Date.now()));
            }, []);
            return <>
                <Flex flexDirection="row" style={{ gap: "0.5em" }}>
                    <Button style={{ flex: "1" }} disabled={!reactiveSettings.hasDoneChallenge} onClick={() => {
                        settings.store.rules.push(makeEmptyRule());
                    }}>Create new rule</Button>
                    <Button style={{ flex: "1" }} color={Button.Colors.WHITE} onClick={() => {
                        Alerts.show({
                            title: "_ contents",
                            body: <>
                                _.member: Current server member
                                <br />
                                _.guild: Current guild
                                <br />
                                _.channel: Current channel
                                <br />
                                <br />
                                _.match: The match
                                <br />
                                _.fullMessage: Full message content
                                <br />
                                _.captureGroups[]: Capture groups
                            </>
                        });
                    }}>View _ contents</Button>
                </Flex>
                {
                    reactiveSettings.hasDoneChallenge && <RuleList key={t} />
                }
            </>;
        }
    }
});

export function rmRule(index: number) {
    settings.store.rules.splice(index, 1);
    callbacks.forEach(c => c());
}

// taken from TextReplace (AutumnVN)
function stringToRegex(str: string) {
    const match = str.match(/^(\/)?(.+?)(?:\/([gimsuyv]*))?$/); // Regex to match regex
    return match
        ? new RegExp(
            match[2], // Pattern
            match[3]
                ?.split("") // Remove duplicate flags
                .filter((char, pos, flagArr) => flagArr.indexOf(char) === pos)
                .join("")
            ?? "g"
        )
        : new RegExp(str); // Not a regex, return string
}

// vibe coded
async function asyncReplace(str, regex, asyncFn) {
    const matches = [];
    str.replace(regex, (...args) => {
        // @ts-ignore
        matches.push(asyncFn(...args));
    });

    const results = await Promise.all(matches);
    let i = 0;
    return str.replace(regex, () => results[i++]);
}

async function applyRules(channelID: string, content: string) {
    let workingContent = content;

    for (const rule of settings.store.rules) {
        if (!rule.find || !rule.replace) continue;

        const fn = new Function("_", `return (async () => { ${rule.replace} })();`);

        workingContent = await asyncReplace(
            workingContent,
            stringToRegex(rule.find),
            async (match: string, ...args: string[]) => {
                const captureGroups = args.slice(0, -2);

                const fnResult = await fn({
                    member: SelectedGuildStore.getGuildId()
                        ? GuildMemberStore.getMember(SelectedGuildStore.getGuildId()!, UserStore.getCurrentUser().id)
                        : UserStore.getCurrentUser(),
                    guild: SelectedGuildStore.getGuildId()
                        ? GuildStore.getGuild(SelectedGuildStore.getGuildId()!)
                        : undefined,
                    channel: ChannelStore.getChannel(channelID),
                    match,
                    fullMessage: content,
                    captureGroups,
                });

                return fnResult?.toString() || "";
            }
        );
    }

    return workingContent;
}

export default definePlugin({
    name: "JSTextReplace",
    description: "TextReplace, with JavaScript replacements",
    tags: ["Chat", "Utility"],
    authors: [Devs.nin0dev],
    settingsAboutComponent: () => <Challenge />,
    settings,
    start() {
        (0, eval)(ace);
        (0, eval)(theme);
        (0, eval)(highlighter);
    },

    stop() {},
    async onBeforeMessageSend(channelID, message) {
        message.content = await applyRules(channelID, message.content);
    }
});
