/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { ApplicationCommandOptionType, findOption } from "@api/Commands";
import { FormSwitch } from "@components/FormSwitch";
import { Heading } from "@components/Heading";
import { TestcordDevs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { insertTextIntoChatInputBox } from "@utils/discord";
import { Margins } from "@utils/margins";
import definePlugin, { IconComponent } from "@utils/types";
import { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, Parser, TextInput, useMemo, useState } from "@webpack/common";
import type { KeyboardEvent, ReactNode } from "react";

const INVISIBLES = "\u200B\u200C\u200D\uFEFF\u2060\u2061\u2062\u2063\u2064\u206A\u206B\u206C\u206D\u206E\u206F\uFE00\uFE01\uFE02\uFE03\uFE04\uFE05\uFE06\uFE07\uFE08\uFE09\uFE0A\uFE0B\uFE0C\uFE0D\uFE0E\uFE0F";

function spoof(text: string): string {
    let out = "";
    for (const char of text)
        out += char + INVISIBLES[(Math.random() * INVISIBLES.length) | 0];
    return out;
}

const cl = classNameFactory("vc-fakeurl-");

function FakeUrlModal(props: RenderModalProps) {
    const [fakeLink, setFakeLink] = useState("");
    const [realLink, setRealLink] = useState("");
    const [hideEmbed, setHideEmbed] = useState(false);

    const [formatted, rendered] = useMemo<[string, ReactNode]>(() => {
        const fake = fakeLink.trim();
        const real = realLink.trim().replace(/^<(.+)>$/, "$1");
        if (!fake || !real) return ["", null];

        const target = hideEmbed ? `<${real}>` : real;
        const markdown = `[${spoof(fake)}](${target})`;
        let parsed: ReactNode = null;
        try {
            parsed = Parser.parse(markdown);
        } catch {
            parsed = null;
        }
        return [markdown, parsed];
    }, [fakeLink, realLink, hideEmbed]);

    const canInsert = Boolean(fakeLink.trim() && realLink.trim());

    const handleInsert = () => {
        if (!canInsert) return;
        insertTextIntoChatInputBox(formatted + " ");
        props.onClose();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Enter" && canInsert) {
            e.preventDefault();
            handleInsert();
        }
    };

    return (
        <Modal
            {...props}
            title="Insert Fake URL"
            actions={[
                {
                    text: "Insert",
                    variant: "primary",
                    disabled: !canInsert,
                    onClick: handleInsert
                }
            ]}
        >
            <div className={cl("input-group")}>
                <Heading tag="h5" className={Margins.bottom8}>Display Text / Masked URL</Heading>
                <TextInput
                    autoFocus
                    value={fakeLink}
                    onChange={setFakeLink}
                    onKeyDown={handleKeyDown}
                    placeholder="e.g. https://discord.com or Click Here"
                />
            </div>

            <div className={cl("input-group")}>
                <Heading tag="h5" className={Margins.bottom8}>Destination URL</Heading>
                <TextInput
                    value={realLink}
                    onChange={setRealLink}
                    onKeyDown={handleKeyDown}
                    placeholder="e.g. https://example.com"
                />
            </div>

            <FormSwitch
                value={hideEmbed}
                onChange={setHideEmbed}
                title="Hide Embed"
                className={Margins.bottom16}
            />

            <Heading tag="h5" className={Margins.bottom8}>Preview</Heading>
            <div className={cl("preview-box")}>
                {canInsert ? (
                    <>
                        <div className={cl("preview-rendered")}>
                            {rendered ?? <span>{fakeLink}</span>}
                        </div>
                        <div className={cl("preview-raw")}>
                            {formatted}
                        </div>
                    </>
                ) : (
                    <div className={cl("preview-empty")}>
                        Enter display text and a destination URL above to preview the masked link.
                    </div>
                )}
            </div>
        </Modal>
    );
}

const FakeUrlIcon: IconComponent = ({ height = 20, width = 20, className }) => {
    return (
        <svg
            aria-hidden="true"
            role="img"
            width={width}
            height={height}
            className={className}
            viewBox="0 0 24 24"
        >
            <path
                fill="currentColor"
                d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"
            />
        </svg>
    );
};

const FakeUrlButton: ChatBarButtonFactory = ({ isAnyChat }) => {
    if (!isAnyChat) return null;

    return (
        <ChatBarButton
            tooltip="Insert Fake URL"
            onClick={() => openModal(props => <FakeUrlModal {...props} />)}
            buttonProps={{ "aria-haspopup": "dialog" }}
        >
            <FakeUrlIcon />
        </ChatBarButton>
    );
};

export default definePlugin({
    name: "FakeUrl",
    description: "Sends fake links that links to a different website than shown.",
    authors: [TestcordDevs.x2b, TestcordDevs.SirPhantom89],
    tags: ["Chat", "Fun", "Commands"],
    dependencies: ["ChatInputButtonAPI", "CommandsAPI"],

    chatBarButton: {
        icon: FakeUrlIcon,
        render: FakeUrlButton
    },

    commands: [
        {
            name: "fakeurl",
            description: "Send a masked link that shows one link but opens another.",
            options: [
                {
                    name: "fake-link",
                    description: "Link text shown in chat.",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                },
                {
                    name: "real-link",
                    description: "Link actually opened on click.",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                },
                {
                    name: "hide-embed",
                    description: "Suppress the link embed.",
                    type: ApplicationCommandOptionType.BOOLEAN,
                    required: false
                }
            ],
            execute: opts => {
                const fake = findOption(opts, "fake-link", "").trim();
                const real = findOption(opts, "real-link", "").trim().replace(/^<(.+)>$/, "$1");
                if (!fake || !real) return;
                const target = findOption(opts, "hide-embed", false) ? `<${real}>` : real;
                return { content: `[${spoof(fake)}](${target})` };
            }
        }
    ]
});
