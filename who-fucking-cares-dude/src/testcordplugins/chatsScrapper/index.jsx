/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { ChatBarButton } from "@api/ChatButtons";
import { addChannelToolbarButton, addHeaderBarButton, ChannelToolbarButton, HeaderBarButton, removeChannelToolbarButton, removeHeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { Button, ChannelStore, ContextMenuApi, Menu, React, RestAPI, Toasts, UserStore } from "@webpack/common";
const settings = definePluginSettings({
    location: {
        type: 4 /* OptionType.SELECT */,
        description: "Where to show the button",
        options: [
            { label: "Chat bar", value: "chatbar", default: true },
            { label: "Header bar", value: "headerbar" },
            { label: "Channel toolbar", value: "channeltoolbar" },
            { label: "Disabled", value: "disabled" },
        ],
        restartNeeded: true,
    },
    whitelist: {
        type: 0 /* OptionType.STRING */,
        description: "Comma-separated user IDs to keep (DM whitelist)",
        default: ""
    }
});
function parseCsv(csv) {
    return csv.split(/[,.\s]+/).map(s => s.trim()).filter(Boolean);
}
function uniq(arr) { return Array.from(new Set(arr)); }
function getWhitelist() { return uniq(parseCsv(settings.store.whitelist)); }
function setWhitelist(ids) { settings.store.whitelist = ids.join(","); }
function DmUserTag({ id, onRemove }) {
    const user = UserStore.getUser(id);
    if (!user)
        return null;
    return (<div style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 10px",
            background: "var(--background-modifier-hover)",
            borderRadius: 8,
            marginRight: 8,
            marginBottom: 8,
            border: "1px solid var(--background-modifier-accent)",
            transition: "all 0.2s ease"
        }}>
            <img src={user.getAvatarURL?.(undefined, 20, false)} width={20} height={20} style={{ borderRadius: "50%" }}/>
            <span style={{ color: "var(--text-normal)", fontWeight: 500 }}>{user.globalName || user.username}</span>
            <button aria-label="remove" onClick={() => onRemove(id)} style={{
            background: "transparent",
            border: 0,
            cursor: "pointer",
            color: "var(--interactive-normal)",
            fontSize: "16px",
            fontWeight: "bold",
            padding: "2px 4px",
            borderRadius: "4px",
            transition: "all 0.2s ease"
        }} onMouseEnter={e => {
            e.currentTarget.style.background = "var(--background-modifier-accent)";
            e.currentTarget.style.color = "var(--text-danger)";
        }} onMouseLeave={e => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--interactive-normal)";
        }}>×</button>
        </div>);
}
function WhitelistModal({ modalProps }) {
    const [wl, setWl] = React.useState(getWhitelist());
    const [query, setQuery] = React.useState("");
    const dms = ChannelStore.getSortedPrivateChannels().filter(c => c.isDM?.());
    const items = React.useMemo(() => {
        const lower = query.toLowerCase();
        return dms
            .filter(c => !wl.includes(c.recipients?.[0]))
            .filter(c => {
            const uid = c.recipients?.[0];
            const u = uid ? UserStore.getUser(uid) : null;
            const name = (u?.globalName || u?.username || c.name || "").toLowerCase();
            return name.includes(lower);
        })
            .slice(0, 30);
    }, [dms, query, wl]);
    async function start() {
        setWhitelist(wl);
        const whitelist = new Set(wl);
        const oneToOne = ChannelStore.getSortedPrivateChannels().filter(c => c.isDM?.());
        const toClose = oneToOne.filter(c => !whitelist.has(c.recipients?.[0]));
        if (toClose.length === 0) {
            Toasts.show({ id: Toasts.genId(), type: Toasts.Type.MESSAGE, message: "Nothing to close." });
            return;
        }
        Toasts.show({ id: Toasts.genId(), type: Toasts.Type.MESSAGE, message: `Closing ${toClose.length} DMs...` });
        let ok = 0, fail = 0;
        for (const ch of toClose) {
            try {
                await RestAPI.del({ url: `/channels/${ch.id}` });
                ok++;
            }
            catch {
                fail++;
            }
        }
        Toasts.show({ id: Toasts.genId(), type: fail ? Toasts.Type.FAILURE : Toasts.Type.SUCCESS, message: `Done. Closed ${ok}${fail ? `, failed ${fail}` : ""}.` });
        modalProps.onClose();
    }
    return (<ModalRoot {...modalProps}>
            <ModalHeader>
                <div style={{ display: "flex", alignItems: "center", width: "100%" }}>
                    <h2 style={{ margin: 0 }}>Chats Scrapper</h2>
                    <div style={{ flex: 1 }}/>
                    <ModalCloseButton onClick={modalProps.onClose}/>
                </div>
            </ModalHeader>
            <ModalContent>
                <div style={{
            marginBottom: 12,
            color: "var(--text-normal)",
            fontWeight: 600,
            fontSize: "14px"
        }}>Whitelist (kept 1:1 DMs):</div>
                <div style={{
            display: "flex",
            flexWrap: "wrap",
            minHeight: "40px",
            padding: "8px",
            background: "var(--background-secondary)",
            borderRadius: "8px",
            border: "1px solid var(--background-modifier-accent)"
        }}>
                    {wl.map(id => <DmUserTag key={id} id={id} onRemove={idToRemove => setWl(wl.filter(x => x !== idToRemove))}/>)}
                    {wl.length === 0 && (<div style={{
                color: "var(--text-muted)",
                fontStyle: "italic",
                alignSelf: "center"
            }}>No users in whitelist</div>)}
                </div>
                <div style={{
            marginTop: 16,
            marginBottom: 8,
            color: "var(--text-normal)",
            fontWeight: 600,
            fontSize: "14px"
        }}>Add from your DMs</div>
                <input placeholder="Search users by name" value={query} onChange={e => setQuery(e.target.value)} style={{
            width: "100%",
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid var(--background-modifier-accent)",
            background: "var(--input-background)",
            color: "var(--text-normal)",
            fontSize: "14px",
            outline: "none",
            transition: "border-color 0.2s ease"
        }} onFocus={e => {
            e.target.style.borderColor = "var(--brand-experiment)";
        }} onBlur={e => {
            e.target.style.borderColor = "var(--background-modifier-accent)";
        }}/>
                <div style={{
            marginTop: 12,
            maxHeight: 280,
            overflow: "auto",
            background: "var(--background-secondary)",
            borderRadius: "8px",
            border: "1px solid var(--background-modifier-accent)"
        }}>
                    {items.map(c => {
            const recipientId = c.recipients?.[0];
            const u = recipientId ? UserStore.getUser(recipientId) : null;
            const label = (u?.globalName || u?.username || c.name || recipientId || "Unknown");
            const avatar = u?.getAvatarURL?.(undefined, 32, false);
            return (<div key={c.id} style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "12px",
                    borderRadius: 6,
                    gap: 12,
                    borderBottom: "1px solid var(--background-modifier-accent)",
                    transition: "background-color 0.2s ease"
                }} onMouseEnter={e => {
                    e.currentTarget.style.background = "var(--background-modifier-hover)";
                }} onMouseLeave={e => {
                    e.currentTarget.style.background = "transparent";
                }}>
                                {avatar && <img src={avatar} width={32} height={32} style={{ borderRadius: "50%" }}/>}
                                <div style={{
                    flex: 1,
                    color: "var(--text-normal)",
                    fontWeight: 500,
                    fontSize: "14px"
                }}>{label}</div>
                                <Button size={Button.Sizes.SMALL} onClick={() => setWl(uniq([...wl, recipientId]))} disabled={!recipientId} style={{
                    background: "var(--brand-experiment)",
                    color: "var(--white-500)"
                }}>Add</Button>
                            </div>);
        })}
                    {items.length === 0 && (<div style={{
                padding: "20px",
                textAlign: "center",
                color: "var(--text-muted)",
                fontStyle: "italic"
            }}>No matches found</div>)}
                </div>
            </ModalContent>
            <ModalFooter>
                <div style={{
            display: "flex",
            justifyContent: "space-between",
            width: "100%",
            gap: "12px"
        }}>
                    <Button onClick={() => { setWhitelist(wl); modalProps.onClose(); }} style={{
            background: "var(--background-modifier-hover)",
            color: "var(--text-normal)",
            border: "1px solid var(--background-modifier-accent)"
        }}>Save</Button>
                    <Button color={Button.Colors.RED} onClick={start} style={{
            background: "var(--button-danger-background)",
            color: "var(--white-500)"
        }}>Start</Button>
                </div>
            </ModalFooter>
        </ModalRoot>);
}
export default definePlugin({
    name: "ChatsScrapper",
    description: "Adds an × button near DM UI to close all 1:1 DMs except whitelist.",
    tags: ["Chat", "Utility"],
    authors: [TestcordDevs.x2b],
    dependencies: ["HeaderBarAPI"],
    settings,
    chatBarButton: {
        icon: (() => (<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">
                <path fill="currentColor" d="M12 2a10 10 0 1 0 0 20a10 10 0 0 0 0-20Z"/>
            </svg>)),
        render: (({ isMainChat }) => {
            if (!isMainChat || settings.store.location !== "chatbar")
                return null;
            return (<ChatBarButton tooltip="Chats Scrapper" onClick={() => openModal((props) => <WhitelistModal modalProps={props}/>)} onContextMenu={(e) => ContextMenuApi.openContextMenu(e, () => (<Menu.Menu navId="pc-chats-scrapper-menu" onClose={ContextMenuApi.closeContextMenu} aria-label="Chats Scrapper">
                            <Menu.MenuItem id="pc-chats-scrapper-open" label="Open Chats Scrapper" action={() => openModal((props) => <WhitelistModal modalProps={props}/>)}/>
                        </Menu.Menu>))}>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">
                    <path fill="currentColor" d="M12 2a10 10 0 1 0 0 20a10 10 0 0 0 0-20Z"/>
                </svg>
            </ChatBarButton>);
        }),
    },
    start() {
        const { location } = settings.store;
        if (location === "headerbar") {
            addHeaderBarButton("ChatsScrapper", () => (<HeaderBarButton icon={() => (<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">
                            <path fill="currentColor" d="M12 2a10 10 0 1 0 0 20a10 10 0 0 0 0-20Z"/>
                        </svg>)} tooltip="Chats Scrapper" onClick={() => openModal((props) => <WhitelistModal modalProps={props}/>)}/>), 5);
        }
        else if (location === "channeltoolbar") {
            addChannelToolbarButton("ChatsScrapper", () => (<ChannelToolbarButton icon={() => (<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">
                            <path fill="currentColor" d="M12 2a10 10 0 1 0 0 20a10 10 0 0 0 0-20Z"/>
                        </svg>)} tooltip="Chats Scrapper" onClick={() => openModal((props) => <WhitelistModal modalProps={props}/>)}/>), 5);
        }
    },
    stop() {
        removeHeaderBarButton("ChatsScrapper");
        removeChannelToolbarButton("ChatsScrapper");
    },
});
