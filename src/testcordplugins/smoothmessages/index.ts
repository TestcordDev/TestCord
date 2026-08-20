/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { disableStyle, enableStyle, setStyleClassNames } from "@api/Styles";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { findCssClassesLazy } from "@webpack";
import { SelectedChannelStore } from "@webpack/common";

import fadeStyle from "./fade.css?managed";
import slideStyle from "./slide.css?managed";

const messageClasses = findCssClassesLazy("messageListItem");

class BoundedSet<T> {
    private set = new Set<T>();
    constructor(private maxSize: number = 200) { }

    add(item: T) {
        if (this.set.size >= this.maxSize) {
            const first = this.set.values().next().value;
            if (first !== undefined) this.set.delete(first);
        }
        this.set.add(item);
    }

    has(item: T): boolean {
        return this.set.has(item);
    }

    clear() {
        this.set.clear();
    }
}

const pendingMessageIds = new Set<string>();
const animatedNonces = new BoundedSet<string>(200);
const alreadyAnimatedIds = new BoundedSet<string>(200);

let observer: MutationObserver | null = null;

function applyStyle() {
    disableStyle(fadeStyle);
    disableStyle(slideStyle);
    enableStyle(settings.store.includeFade ? fadeStyle : slideStyle);
}

function animateElement(el: Element) {
    el.classList.add("vc-smoothmessages-animating");
    const onEnd = () => {
        el.classList.remove("vc-smoothmessages-animating");
        el.removeEventListener("animationend", onEnd);
    };
    el.addEventListener("animationend", onEnd, { once: true });
    setTimeout(onEnd, 300);
}

function matchesPending(el: Element): string | null {
    const dataId = el.getAttribute("data-list-item-id") ?? "";
    const domId = el.id ?? "";
    for (const pendingId of pendingMessageIds) {
        if ((domId && domId.includes(pendingId)) || (dataId && dataId.includes(pendingId))) {
            return pendingId;
        }
    }
    return null;
}

function tryAnimateImmediate(id: string, channelId: string) {
    const el = document.getElementById(`chat-messages-${channelId}-${id}`)
        ?? document.getElementById(`chat-messages-${id}`)
        ?? document.querySelector(`[data-list-item-id*="${id}"]`)
        ?? document.querySelector(`li[id*="${id}"]`);

    if (el) {
        pendingMessageIds.delete(id);
        const item = (messageClasses.messageListItem ? el.closest(`.${messageClasses.messageListItem}`) : null) ?? el;
        animateElement(item);
        return true;
    }
    return false;
}

function handleMutations(mutations: MutationRecord[]) {
    if (pendingMessageIds.size === 0) return;

    for (const mutation of mutations) {
        for (let i = 0; i < mutation.addedNodes.length; i++) {
            const node = mutation.addedNodes[i];
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            const el = node as HTMLElement;

            const matched = matchesPending(el);
            if (matched) {
                pendingMessageIds.delete(matched);
                const item = (messageClasses.messageListItem ? el.closest(`.${messageClasses.messageListItem}`) : null) ?? el;
                animateElement(item);
                if (pendingMessageIds.size === 0) return;
                continue;
            }

            if (el.childElementCount > 0) {
                for (const pendingId of Array.from(pendingMessageIds)) {
                    const child = el.querySelector?.(`[data-list-item-id*="${pendingId}"], [id*="${pendingId}"]`);
                    if (child) {
                        pendingMessageIds.delete(pendingId);
                        const item = (messageClasses.messageListItem ? child.closest(`.${messageClasses.messageListItem}`) : null) ?? child;
                        animateElement(item);
                        if (pendingMessageIds.size === 0) return;
                    }
                }
            }
        }
    }
}

const settings = definePluginSettings({
    includeFade: {
        type: OptionType.BOOLEAN,
        description: "Fade messages in while they slide.",
        default: true,
        onChange: applyStyle
    }
});

export default definePlugin({
    name: "SmoothMessages",
    description: "Makes new messages slide in smoothly from the left instead of appearing sharply.",
    authors: [TestcordDevs.x2b],
    tags: ["Appearance"],
    settings,

    start() {
        setStyleClassNames(fadeStyle, { messageListItem: messageClasses.messageListItem });
        setStyleClassNames(slideStyle, { messageListItem: messageClasses.messageListItem });
        applyStyle();

        const chatContainer = document.querySelector('[class*="scrollerInner"]') || document.querySelector('[data-list-id="chat-messages"]') || document.body;
        observer = new MutationObserver(handleMutations);
        observer.observe(chatContainer, { childList: true, subtree: true });
    },

    stop() {
        disableStyle(fadeStyle);
        disableStyle(slideStyle);

        observer?.disconnect();
        observer = null;
        pendingMessageIds.clear();
        animatedNonces.clear();
        alreadyAnimatedIds.clear();
    },

    flux: {
        CHANNEL_SELECT() {
            pendingMessageIds.clear();
        },

        MESSAGE_CREATE({ optimistic, type, message, channelId }: {
            optimistic?: boolean;
            type: string;
            message: any;
            channelId: string;
        }) {
            if (!message || !message.id) return;
            if (channelId !== SelectedChannelStore.getChannelId()) return;

            const msgId = String(message.id);
            const nonce = message.nonce ? String(message.nonce) : null;

            // If this message was already animated during optimistic sending, don't animate the confirmed ACK
            if (nonce && animatedNonces.has(nonce)) {
                alreadyAnimatedIds.add(msgId);
                return;
            }

            if (alreadyAnimatedIds.has(msgId)) {
                return;
            }

            if (nonce) {
                animatedNonces.add(nonce);
                pendingMessageIds.add(nonce);
                setTimeout(() => pendingMessageIds.delete(nonce), 5000);
            }

            alreadyAnimatedIds.add(msgId);
            pendingMessageIds.add(msgId);
            setTimeout(() => pendingMessageIds.delete(msgId), 5000);

            // Attempt immediate animation if element already exists in DOM
            tryAnimateImmediate(msgId, channelId);
            if (nonce) tryAnimateImmediate(nonce, channelId);
        }
    }
});
