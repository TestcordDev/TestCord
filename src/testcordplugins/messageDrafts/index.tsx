/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { get as dsGet, set as dsSet, del as dsDel } from "@api/DataStore";
import { addChatBarButton, removeChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { MallCordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import { closeModal, openModal, ModalContent, ModalHeader, ModalRoot } from "@utils/modal";
import definePlugin from "@utils/types";
import { FluxDispatcher, React, SelectedChannelStore, ChannelStore } from "@webpack/common";

const log = new Logger("MessageDrafts");
const DS_KEY = "MessageDrafts_v1";

type DraftMap = Record<string, { text: string; timestamp: number }>;

let drafts: DraftMap = {};
let patchedInput: ((v: string) => void) | null = null;

async function load() {
    const stored = await dsGet<DraftMap>(DS_KEY);
    if (stored) drafts = stored;
}

async function save() {
    await dsSet(DS_KEY, drafts);
}

async function saveDraft(channelId: string, text: string) {
    if (!text.trim()) {
        delete drafts[channelId];
    } else {
        drafts[channelId] = { text, timestamp: Date.now() };
    }
    await save();
}

async function deleteDraft(channelId: string) {
    delete drafts[channelId];
    await save();
}

function setInputValue(text: string) {
    patchedInput?.(text);
}

function DraftsModal({ modalKey, onClose }: { modalKey: string; onClose: () => void; }) {
    const [draftList, setDraftList] = React.useState<[string, { text: string; timestamp: number }][]>([]);

    React.useEffect(() => {
        const entries = Object.entries(drafts).sort((a, b) => b[1].timestamp - a[1].timestamp);
        setDraftList(entries);
    }, []);

    if (draftList.length === 0) {
        return (
            <ModalRoot modalKey={modalKey}>
                <ModalHeader>
                    <span style={{ fontWeight: 600 }}>Saved Drafts</span>
                </ModalHeader>
                <ModalContent>
                    <p style={{ color: "var(--text-muted)", padding: "16px 0" }}>No saved drafts.</p>
                </ModalContent>
            </ModalRoot>
        );
    }

    return (
        <ModalRoot modalKey={modalKey}>
            <ModalHeader>
                <span style={{ fontWeight: 600 }}>Saved Drafts</span>
            </ModalHeader>
            <ModalContent>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 0 16px" }}>
                    {draftList.map(([channelId, draft]) => {
                        const channel = ChannelStore.getChannel(channelId);
                        const name = channel ? `#${channel.name ?? channelId}` : channelId;
                        return (
                            <div key={channelId} style={{
                                background: "var(--background-secondary)",
                                borderRadius: 6,
                                padding: "10px 12px",
                                display: "flex",
                                flexDirection: "column",
                                gap: 6,
                            }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--header-secondary)" }}>{name}</span>
                                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                                        {new Date(draft.timestamp).toLocaleString()}
                                    </span>
                                </div>
                                <p style={{ margin: 0, color: "var(--text-normal)", fontSize: 14, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                                    {draft.text}
                                </p>
                                <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
                                    <button
                                        style={{ padding: "4px 10px", borderRadius: 4, border: "none", cursor: "pointer", background: "var(--brand-500)", color: "#fff", fontSize: 12 }}
                                        onClick={() => {
                                            setInputValue(draft.text);
                                            onClose();
                                        }}
                                    >
                                        Load
                                    </button>
                                    <button
                                        style={{ padding: "4px 10px", borderRadius: 4, border: "none", cursor: "pointer", background: "var(--background-tertiary)", color: "var(--text-normal)", fontSize: 12 }}
                                        onClick={async () => {
                                            await deleteDraft(channelId);
                                            setDraftList(prev => prev.filter(([id]) => id !== channelId));
                                        }}
                                    >
                                        Delete
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </ModalContent>
        </ModalRoot>
    );
}

const DraftsButton: ChatBarButtonFactory = () => {
    const hasDrafts = Object.keys(drafts).length > 0;

    return (
        <button
            aria-label="View drafts"
            title="Drafts"
            style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "0 4px",
                color: hasDrafts ? "var(--brand-500)" : "var(--interactive-normal)",
                display: "flex",
                alignItems: "center",
            }}
            onClick={() => {
                openModal(key => <DraftsModal modalKey={key} onClose={() => closeModal(key)} />);
            }}
        >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm17.71-10.21a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
            </svg>
        </button>
    );
};

function onChannelSwitch({ channelId }: { channelId: string | null; }) {
    if (!channelId) return;
    const draft = drafts[channelId];
    if (draft) setInputValue(draft.text);
}

export default definePlugin({
    name: "MessageDrafts",
    description: "Saves your unsent messages per channel and restores them when you come back.",
    authors: [MallCordDevs.Sharp],
    dependencies: ["ChatInputButtonAPI", "MessageEventsAPI"],
    tags: ["drafts", "messages", "productivity"],

    patches: [
        {
            find: "TEXTAREA_KEYBOARD_SUBMIT_DISABLED",
            replacement: {
                match: /onChange:(\i),/,
                replace: "onChange:(...args)=>{ $self._onInputChange(...args); ($1)(...args); },",
            },
            noWarn: true,
        },
        {
            find: "TEXTAREA_KEYBOARD_SUBMIT_DISABLED",
            replacement: {
                match: /ref:(\i)(?=.{0,200}TEXTAREA_KEYBOARD_SUBMIT_DISABLED)/,
                replace: "ref:(...args)=>{ $self._captureRef(...args); if(typeof $1==='function')($1)(...args); }",
            },
            noWarn: true,
        },
    ],

    _inputEl: null as HTMLTextAreaElement | null,

    _captureRef(el: HTMLTextAreaElement | null) {
        this._inputEl = el;
        patchedInput = el
            ? (text: string) => {
                const nativeInput = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
                nativeInput?.set?.call(el, text);
                el.dispatchEvent(new Event("input", { bubbles: true }));
            }
            : null;
    },

    _onInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
        const channelId = SelectedChannelStore.getChannelId();
        if (!channelId) return;
        saveDraft(channelId, e.target.value).catch(() => { });
    },

    async start() {
        await load();
        addChatBarButton("messageDrafts", DraftsButton, () => null as any);
        FluxDispatcher.subscribe("CHANNEL_SELECT", onChannelSwitch);
    },

    stop() {
        removeChatBarButton("messageDrafts");
        FluxDispatcher.unsubscribe("CHANNEL_SELECT", onChannelSwitch);
        patchedInput = null;
    },
});
