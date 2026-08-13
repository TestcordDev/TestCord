/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { TestcordDevs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { Logger } from "@utils/Logger";
import { sleep } from "@utils/misc";
import { ModalContent, ModalFooter, ModalHeader, ModalRoot, ModalSize, openModal, RenderModalProps } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import type { User } from "@vencord/discord-types";
import { Button, ChannelActionCreators, ChannelStore, Constants, Menu, React, RestAPI, Text, useEffect, UserStore, useState } from "@webpack/common";

const cl = classNameFactory("vc-purgedms-");
const logger = new Logger("PurgeDMs");

// message types the API will actually let you delete (default + reply)
const DELETABLE_TYPES = new Set([0, 19]);

const settings = definePluginSettings({
    deleteDelayMs: {
        type: OptionType.SLIDER,
        description: "Delay between each deletion in ms. Lower is faster but more likely to hit rate limits.",
        markers: [50, 100, 200, 350, 500, 750, 1000],
        default: 200,
        stickToMarkers: false
    },
    confirmBeforeRun: {
        type: OptionType.BOOLEAN,
        description: "Ask for confirmation before a purge starts.",
        default: true
    }
});

async function getDMChannelId(userId: string): Promise<string | null> {
    const existing = ChannelStore.getDMFromUserId?.(userId);
    if (existing) return existing;
    try {
        return await ChannelActionCreators.getOrEnsurePrivateChannel(userId);
    } catch (e) {
        logger.error("Could not resolve DM channel", e);
        return null;
    }
}

interface RawMessage {
    id: string;
    type: number;
    content?: string;
    author?: { id: string; };
    attachments?: unknown[];
}

async function fetchBatch(channelId: string, before?: string): Promise<RawMessage[]> {
    const base = Constants.Endpoints.MESSAGES(channelId);
    const url = `${base}?limit=100${before ? `&before=${before}` : ""}`;
    for (let attempt = 0; attempt < 6; attempt++) {
        try {
            const res = await RestAPI.get({ url });
            return res.body ?? [];
        } catch (e: any) {
            const retry = e?.body?.retry_after;
            if (e?.status === 429 && retry) { await sleep(retry * 1000 + 100); continue; }
            logger.error("fetchBatch failed", e);
            return [];
        }
    }
    return [];
}

async function deleteOne(channelId: string, id: string): Promise<boolean> {
    const url = Constants.Endpoints.MESSAGE(channelId, id);
    for (let attempt = 0; attempt < 6; attempt++) {
        try {
            await RestAPI.del({ url });
            return true;
        } catch (e: any) {
            const retry = e?.body?.retry_after;
            if (e?.status === 429 && retry) { await sleep(retry * 1000 + 100); continue; }
            if (e?.status === 404) return false; // already gone
            logger.error("delete failed", id, e);
            return false;
        }
    }
    return false;
}

type PurgeState = "running" | "done" | "stopped" | "error";

interface PurgeCallbacks {
    alive: () => boolean;
    onStatus: (s: PurgeState) => void;
    onScan: (n: number) => void;
    onKill: (msg: RawMessage, ok: boolean) => void;
}

async function runPurge(userId: string, cb: PurgeCallbacks) {
    const channelId = await getDMChannelId(userId);
    if (!channelId) { cb.onStatus("error"); return; }

    const me = UserStore.getCurrentUser();
    let before: string | undefined;
    cb.onStatus("running");

    // walk newest to oldest. snowflake cursor is stable even as we delete.
    while (cb.alive()) {
        const batch = await fetchBatch(channelId, before);
        if (!batch.length) break;
        before = batch[batch.length - 1].id;
        cb.onScan(batch.length);

        const mine = batch.filter(m => m.author?.id === me.id && DELETABLE_TYPES.has(m.type));
        for (const m of mine) {
            if (!cb.alive()) break;
            const ok = await deleteOne(channelId, m.id);
            cb.onKill(m, ok);
            await sleep(settings.store.deleteDelayMs);
        }
    }

    cb.onStatus(cb.alive() ? "done" : "stopped");
}

interface FeedLine {
    id: string;
    content: string;
    ok: boolean;
}

function PurgeModal({ rootProps, user }: { rootProps: RenderModalProps; user: User; }) {
    const [armed, setArmed] = useState(!settings.store.confirmBeforeRun);
    const [state, setState] = useState<PurgeState>("running");
    const [scanned, setScanned] = useState(0);
    const [deleted, setDeleted] = useState(0);
    const [lines, setLines] = useState<FeedLine[]>([]);
    const aliveRef = React.useRef(true);

    useEffect(() => {
        if (!armed) return;
        aliveRef.current = true;
        runPurge(user.id, {
            alive: () => aliveRef.current,
            onStatus: setState,
            onScan: n => setScanned(s => s + n),
            onKill: (m, ok) => {
                if (ok) setDeleted(d => d + 1);
                const content = (m.content || "").replace(/\n/g, " ").trim()
                    || (m.attachments?.length ? `[${m.attachments.length} attachment(s)]` : "[embed / empty]");
                setLines(prev => [{ id: m.id, content, ok }, ...prev].slice(0, 250));
            }
        });
        return () => { aliveRef.current = false; };
    }, [armed]);

    const stop = () => { aliveRef.current = false; setState("stopped"); };

    const username = user.globalName || user.username || "user";

    return (
        <ModalRoot {...rootProps} size={ModalSize.MEDIUM}>
            <ModalHeader>
                <Text variant="heading-lg/semibold" style={{ flexGrow: 1 }}>
                    Purge DMs — @{username}
                </Text>
            </ModalHeader>

            <ModalContent>
                <div className={cl("modal")}>
                    {!armed ? (
                        <Text variant="text-md/normal">
                            This will permanently delete <b>every message you sent</b> in your DM with{" "}
                            <b>@{username}</b>. This cannot be undone.
                        </Text>
                    ) : (
                        <>
                            <div className={cl("stats")}>
                                <div className={cl("stat")}>
                                    <span className={cl("stat-num")}>{deleted}</span>
                                    <span className={cl("stat-label")}>Deleted</span>
                                </div>
                                <div className={cl("stat")}>
                                    <span className={cl("stat-num")}>{scanned}</span>
                                    <span className={cl("stat-label")}>Scanned</span>
                                </div>
                                <span className={cl("status")} data-state={state}>
                                    {state === "running" && "Purging…"}
                                    {state === "done" && "Done. DM cleared."}
                                    {state === "stopped" && "Stopped."}
                                    {state === "error" && "No DM channel found."}
                                </span>
                            </div>

                            <div className={cl("feed")}>
                                {lines.length === 0 && state === "running" && (
                                    <Text variant="text-sm/normal" style={{ color: "var(--text-muted)" }}>
                                        scanning history…
                                    </Text>
                                )}
                                {lines.map(line => (
                                    <div
                                        key={line.id}
                                        className={cl("line") + " " + cl(line.ok ? "line-killed" : "line-failed")}
                                    >
                                        <span className={cl("tag")}>{line.ok ? "DEL" : "FAIL"}</span>
                                        <span className={cl("content")}>{line.content}</span>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            </ModalContent>

            <ModalFooter>
                {!armed ? (
                    <>
                        <Button color={Button.Colors.RED} onClick={() => setArmed(true)}>
                            Purge everything
                        </Button>
                        <Button color={Button.Colors.PRIMARY} look={Button.Looks.LINK} onClick={rootProps.onClose}>
                            Cancel
                        </Button>
                    </>
                ) : state === "running" ? (
                    <Button color={Button.Colors.RED} onClick={stop}>
                        Stop
                    </Button>
                ) : (
                    <Button color={Button.Colors.BRAND} onClick={rootProps.onClose}>
                        Close
                    </Button>
                )}
            </ModalFooter>
        </ModalRoot>
    );
}

function openPurgeModal(user: User) {
    openModal(props => (
        <ErrorBoundary>
            <PurgeModal rootProps={props} user={user} />
        </ErrorBoundary>
    ));
}

const userContextPatch: NavContextMenuPatchCallback = (children, props: { user?: User; }) => {
    const user = props?.user;
    if (!user) return;
    if (user.id === UserStore.getCurrentUser()?.id) return;

    children.push(
        <Menu.MenuGroup>
            <Menu.MenuItem
                id="vc-purgedms"
                label="Purge DMs"
                color="danger"
                action={() => openPurgeModal(user)}
            />
        </Menu.MenuGroup>
    );
};

export default definePlugin({
    name: "PurgeDMs",
    description: "Right-click a user and delete every message you ever sent them, with a live feed of each deletion.",
    authors: [TestcordDevs.x2b],
    tags: ["Chat", "Utility", "Privacy"],
    settings,
    contextMenus: {
        "user-context": userContextPatch
    }
});
