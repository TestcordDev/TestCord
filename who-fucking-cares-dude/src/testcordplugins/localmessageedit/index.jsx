/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { findGroupChildrenByChildId } from "@api/ContextMenu";
import { Devs } from "@utils/constants";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Button, FluxDispatcher, Forms, Menu, TextArea, useState } from "@webpack/common";
const MessageStore = findByPropsLazy("getMessage", "getMessages");
const MessageActions = findByPropsLazy("deleteMessage");
const PermissionStore = findByPropsLazy("can", "getGuildPermissions");
const localEdits = new Map();
const localDeletes = new Set();
let originalDeleteMessage;
let originalCan;
function getLocalEdit(channelId, messageId) {
    const key = `${channelId}-${messageId}`;
    return localEdits.get(key);
}
function isLocallyDeleted(channelId, messageId) {
    const key = `${channelId}-${messageId}`;
    return localDeletes.has(key);
}
function EditModal({ message, modalProps }) {
    const key = `${message.channel_id}-${message.id}`;
    const [content, setContent] = useState(localEdits.get(key) || message.content);
    return (<ModalRoot {...modalProps}>
            <ModalHeader>
                <Forms.FormTitle tag="h2">Edit Message (Local Demo)</Forms.FormTitle>
                <ModalCloseButton onClick={modalProps.onClose}/>
            </ModalHeader>
            <ModalContent>
                <Forms.FormText style={{ marginBottom: "8px" }}>
                    This will only change the message locally on your client. Perfect for demonstrating security vulnerabilities.
                </Forms.FormText>
                <TextArea value={content} onChange={setContent} placeholder="Enter new message content..." rows={5}/>
            </ModalContent>
            <ModalFooter>
                <Button onClick={() => {
            console.log(`[LocalMessageEditor] Editing message ${message.id} to: "${content}"`);
            localEdits.set(key, content);
            // Direct DOM manipulation - find and update the message element
            const selectors = [
                `#chat-messages-${message.id}`,
                `[id*="${message.id}"]`,
                `li[id*="${message.id}"]`,
                `div[id*="${message.id}"]`
            ];
            let found = false;
            for (const selector of selectors) {
                const messageElements = document.querySelectorAll(selector);
                if (messageElements.length > 0) {
                    messageElements.forEach(element => {
                        const textContent = element.querySelector('[class*="messageContent"]') ||
                            element.querySelector('[class*="message-content"]') ||
                            element.querySelector('[class*="markup"]') ||
                            element.querySelector('div[class*="content"] > div');
                        if (textContent) {
                            textContent.textContent = content;
                            found = true;
                            console.log(`[LocalMessageEditor] ✅ Message ${message.id} edited in DOM`);
                        }
                    });
                    if (found)
                        break;
                }
            }
            if (!found) {
                console.warn(`[LocalMessageEditor] Could not find message ${message.id} in DOM, stored for later`);
            }
            console.log("[LocalMessageEditor] Message edited locally");
            modalProps.onClose();
        }}>
                    Save Local Edit
                </Button>
                <Button color={Button.Colors.TRANSPARENT} onClick={modalProps.onClose}>
                    Cancel
                </Button>
            </ModalFooter>
        </ModalRoot>);
}
const messageCtxPatch = (children, { message }) => {
    if (!message)
        return;
    const group = findGroupChildrenByChildId("copy-text", children);
    if (!group)
        return;
    const key = `${message.channel_id}-${message.id}`;
    const hasLocalEdit = localEdits.has(key);
    const hasLocalDelete = localDeletes.has(key);
    const insertIndex = group.findIndex(c => c?.props?.id === "copy-text") + 1;
    group.splice(insertIndex, 0, <Menu.MenuItem id="vc-local-edit" label={hasLocalEdit ? "Edit Again (Local Demo)" : "Edit Message (Local Demo)"} action={() => {
            openModal(props => <EditModal message={message} modalProps={props}/>);
        }}/>);
    if (hasLocalEdit || hasLocalDelete) {
        group.splice(insertIndex + 1, 0, <Menu.MenuItem id="vc-local-restore" label="Restore Original Message" action={() => {
                console.log(`[LocalMessageEditor] Restoring message ${message.id}`);
                localEdits.delete(key);
                localDeletes.delete(key);
                FluxDispatcher.dispatch({
                    type: "MESSAGE_UPDATE",
                    message: {
                        id: message.id,
                        channel_id: message.channel_id
                    }
                });
                console.log("[LocalMessageEditor] Message restored");
            }}/>);
    }
};
export default definePlugin({
    name: "LocalMessageEditor",
    description: "Edit and delete any message locally to demonstrate Discord security vulnerabilities",
    tags: ["Chat", "Utility"],
    authors: [Devs.nobody],
    patches: [
        {
            find: ".Messages.MESSAGE_EDITED",
            replacement: {
                match: /(function \w+\(\w+\){let{message:(\w+))/,
                replace: "$1;if($self.checkDeleted($2))return null;"
            }
        },
        {
            find: "messageContent:",
            replacement: {
                match: /(\.messageContent,children:)(\w+)\.content/,
                replace: "$1$self.getContent($2)"
            }
        }
    ],
    checkDeleted(message) {
        if (!message)
            return false;
        return isLocallyDeleted(message.channel_id, message.id);
    },
    getContent(message) {
        if (!message)
            return message?.content;
        const edited = getLocalEdit(message.channel_id, message.id);
        return edited !== undefined ? edited : message.content;
    },
    contextMenus: {
        "message": messageCtxPatch
    },
    start() {
        console.log("[LocalMessageEditor] Starting plugin...");
        if (PermissionStore?.can) {
            originalCan = PermissionStore.can;
            PermissionStore.can = function () {
                return true;
            };
            console.log("[LocalMessageEditor] Permissions overridden");
        }
        if (MessageActions?.deleteMessage) {
            originalDeleteMessage = MessageActions.deleteMessage;
            MessageActions.deleteMessage = function (channelId, messageId) {
                const key = `${channelId}-${messageId}`;
                console.log(`[LocalMessageEditor] Deleting message ${messageId}`);
                localDeletes.add(key);
                FluxDispatcher.dispatch({
                    type: "MESSAGE_DELETE",
                    id: messageId,
                    channelId: channelId
                });
                console.log("[LocalMessageEditor] Delete saved locally");
                return Promise.resolve();
            };
            console.log("[LocalMessageEditor] Delete intercepted");
        }
        console.log("[LocalMessageEditor] Plugin started!");
    },
    stop() {
        console.log("[LocalMessageEditor] Stopping...");
        if (originalCan && PermissionStore) {
            PermissionStore.can = originalCan;
        }
        if (originalDeleteMessage && MessageActions) {
            MessageActions.deleteMessage = originalDeleteMessage;
        }
        localEdits.clear();
        localDeletes.clear();
        console.log("[LocalMessageEditor] Stopped");
    }
});
