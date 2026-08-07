/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { HeaderBarButton } from "@api/HeaderBar";
import { ErrorBoundary } from "@components/index";
import { TestcordDevs } from "@utils/constants";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { findComponentByCodeLazy } from "@webpack";
import { Button, Forms, NavigationRouter, React, RestAPI, TextInput } from "@webpack/common";
const FormText = Forms.FormText as any;

const UserIcon = (props: any) => (
    <svg
        x="0"
        y="0"
        className={props.className}
        aria-hidden="true"
        width={props.width ?? 24}
        height={props.height ?? 24}
        viewBox="0 0 24 24"
        fill="currentColor"
    >
        <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2zm-8 4a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zm0 6c-2.2 0-4.5.9-4.5 2.2v0.8h9v-0.8c0-1.3-2.3-2.2-4.5-2.2z"
        />
    </svg>
);
const HeaderBarIcon = findComponentByCodeLazy(".HEADER_BAR_BADGE_TOP:", '"top"===c');

function getErrorMessage(err: any): string {
    const code = err?.body?.code;

    switch (code) {
        case 50007:
            return "Cannot send messages to this user. They may have blocked you or are a bot/system/webhook account.";
        case 50033:
            return "Invalid recipient. This user cannot receive DMs (system account, deleted user, or invalid ID).";
        case 50035:
            return "Invalid User ID format. Please enter a valid Discord User ID (numeric, 17-19 digits).";
        default:
            return err?.body?.message || err?.message || "Failed to open DM";
    }
}

function DirectMessageModal(props: any) {
    const [userId, setUserId] = React.useState("");
    const [error, setError] = React.useState("");
    const [loading, setLoading] = React.useState(false);

    const openDM = async () => {
        if (!userId || userId.trim() === "") {
            setError("Please enter a user ID");
            return;
        }

        setLoading(true);
        setError("");

        try {
            const response = await RestAPI.post({
                url: "/users/@me/channels",
                body: {
                    recipients: [userId.trim()]
                }
            });

            if (response?.body?.id) {
                const channelId = response.body.id;
                NavigationRouter.transitionTo(`/channels/@me/${channelId}`);
                props.onClose();
            } else {
                setError("Failed to open DM - User might not exist or have DMs disabled");
            }
        } catch (err: any) {
            console.error("[DirectMessageOpener] Error opening DM:", err);
            setError(getErrorMessage(err));
        } finally {
            setLoading(false);
        }
    };

    return (
        <ModalRoot {...props} title="">
            <ModalHeader>
                <Forms.FormTitle tag="h4">Open Direct Message</Forms.FormTitle>
                <ModalCloseButton onClick={props.onClose} />
            </ModalHeader>

            <ModalContent>
                <Forms.FormTitle tag="h5" style={{ marginTop: "10px" }}>
                    User ID
                </Forms.FormTitle>
                <FormText type={"description" as any} style={{ marginBottom: "10px" }}>
                    Enter the Discord User ID of the person you want to message
                </FormText>
                <TextInput
                    placeholder="123456789012345678"
                    value={userId}
                    onChange={setUserId}
                    disabled={loading}
                />
                {error && (
                    <FormText type={"description" as any} style={{ color: "var(--text-danger)", marginTop: "10px" }}>
                        {error}
                    </FormText>
                )}
            </ModalContent>

            <ModalFooter style={{ display: "flex", flexDirection: "row-reverse", gap: "16px", alignItems: "center" }}>
                <Button
                    color={Button.Colors.BRAND}
                    disabled={loading || !userId.trim()}
                    onClick={openDM}
                >
                    {loading ? "Opening..." : "Open DM"}
                </Button>
                <Button
                    color={Button.Colors.TRANSPARENT}
                    look={Button.Looks.LINK}
                    onClick={props.onClose}
                    style={{ marginRight: "8px" }}
                >
                    Cancel
                </Button>
            </ModalFooter>
        </ModalRoot>
    );
}

function openDirectMessageModal() {
    openModal(props => <DirectMessageModal {...props} />);
}

function ToolBarHeader() {
    return (
        <ErrorBoundary noop={true}>
            <HeaderBarIcon
                tooltip="Open DM by User ID"
                position="bottom"
                className="vc-plugin-icon-button vc-dm-opener"
                iconClassName="vc-plugin-icon-button"
                icon={UserIcon}
                onClick={openDirectMessageModal}
            />
        </ErrorBoundary>
    );
}

export default definePlugin({
    name: "DirectMessageOpener",
    description: "Open a DM with any user by entering their User ID via a toolbar button",
    tags: ["Chat", "Utility"],
    authors: [TestcordDevs.SirPhantom89,],

    patches: [
        {
            find: '"BACK_FORWARD_NAVIGATION"',
            replacement: {
                match: /(?<=trailing:.{0,70}\(\i\.Fragment,{children:\[)/,
                replace: "$self.renderDMButton(),"
            }
        }
    ],

    renderDMButton() {
        return (
            <HeaderBarButton
                icon={UserIcon}
                tooltip="Open DM by User ID"
                className="vc-dm-opener-icon"
                onClick={openDirectMessageModal}
            />
        );
    },

    commands: [
        {
            name: "opendm",
            description: "Open a DM with a user by their ID",
            options: [
                {
                    name: "userid",
                    description: "The User ID to open a DM with",
                    type: 3,
                    required: true
                }
            ],
            execute: async args => {
                const userId = args[0]?.value?.trim();

                if (!userId) {
                    return {
                        content: "Please provide a valid User ID"
                    };
                }

                try {
                    const response = await RestAPI.post({
                        url: "/users/@me/channels",
                        body: {
                            recipients: [userId]
                        }
                    });

                    if (response?.body?.id) {
                        NavigationRouter.transitionTo(`/channels/@me/${response.body.id}`);
                        return {
                            content: `Opening DM with user ${userId}...`
                        };
                    } else {
                        return {
                            content: "Failed to open DM - User might not exist or have DMs disabled"
                        };
                    }
                } catch (err: any) {
                    console.error("[DirectMessageOpener] Error:", err);
                    return {
                        content: getErrorMessage(err)
                    };
                }
            }
        }
    ],

    start() {
        console.log("[DirectMessageOpener] Plugin started");
    },

    stop() {
        console.log("[DirectMessageOpener] Plugin stopped");
    }
});
