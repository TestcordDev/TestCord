/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { ChatBarButton } from "@api/ChatButtons";
import { addChannelToolbarButton, addHeaderBarButton, ChannelToolbarButton, HeaderBarButton, removeChannelToolbarButton, removeHeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { classNameFactory } from "@api/Styles";
import { TestcordDevs } from "@utils/constants";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { Button, ContextMenuApi, Menu, React, RelationshipStore, RestAPI, Toasts, UserStore } from "@webpack/common";
const cl = classNameFactory("pc-friends-scrapper-");
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
        description: "Comma-separated user IDs to keep (whitelist)",
        default: ""
    }
});
function parseCsv(csv) {
    return csv
        .split(/[,\s]+/)
        .map(s => s.trim())
        .filter(Boolean);
}
function uniq(arr) {
    return Array.from(new Set(arr));
}
function getWhitelist() {
    return uniq(parseCsv(settings.store.whitelist));
}
function setWhitelist(ids) {
    settings.store.whitelist = ids.join(",");
}
function FriendTag({ id, onRemove }) {
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
    const [query, setQuery] = React.useState("");
    const [wl, setWl] = React.useState(getWhitelist());
    const friendIds = RelationshipStore.getFriendIDs();
    const candidates = React.useMemo(() => {
        const lower = query.toLowerCase();
        return friendIds
            .filter(id => !wl.includes(id))
            .map(id => UserStore.getUser(id))
            .filter(Boolean)
            .filter((u) => (u.globalName || u.username || "").toLowerCase().includes(lower))
            .slice(0, 25);
    }, [query, wl, friendIds]);
    function save() {
        setWhitelist(wl);
        modalProps.onClose();
    }
    async function startScrap() {
        // Persist latest selection
        setWhitelist(wl);
        const whitelistSet = new Set(wl);
        const allFriends = RelationshipStore.getFriendIDs();
        const toRemove = allFriends.filter(id => !whitelistSet.has(id));
        if (!toRemove.length) {
            Toasts.show({ id: Toasts.genId(), type: Toasts.Type.MESSAGE, message: "Whitelist covers all friends. Nothing to remove." });
            return;
        }
        Toasts.show({ id: Toasts.genId(), type: Toasts.Type.MESSAGE, message: `Removing ${toRemove.length} friends...` });
        let success = 0, fail = 0;
        for (const id of toRemove) {
            try {
                await RestAPI.del({ url: `/users/@me/relationships/${id}` });
                success++;
            }
            catch {
                fail++;
            }
        }
        Toasts.show({ id: Toasts.genId(), type: fail ? Toasts.Type.FAILURE : Toasts.Type.SUCCESS, message: `Done. Removed ${success}${fail ? `, failed ${fail}` : ""}.` });
        modalProps.onClose();
    }
    return (<ModalRoot {...modalProps}>
            <ModalHeader>
                <div style={{ display: "flex", alignItems: "center", width: "100%" }}>
                    <h2 style={{ margin: 0 }}>Friends Scrapper</h2>
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
        }}>Whitelist (kept friends):</div>
                <div style={{
            display: "flex",
            flexWrap: "wrap",
            minHeight: "40px",
            padding: "8px",
            background: "var(--background-secondary)",
            borderRadius: "8px",
            border: "1px solid var(--background-modifier-accent)"
        }}>
                    {wl.map(id => <FriendTag key={id} id={id} onRemove={idToRemove => setWl(wl.filter(x => x !== idToRemove))}/>)}
                    {wl.length === 0 && (<div style={{
                color: "var(--text-muted)",
                fontStyle: "italic",
                alignSelf: "center"
            }}>No friends in whitelist</div>)}
                </div>
                <div style={{
            marginTop: 16,
            marginBottom: 8,
            color: "var(--text-normal)",
            fontWeight: 600,
            fontSize: "14px"
        }}>Add from your friends</div>
                <input placeholder="Search friends by name" value={query} onChange={e => setQuery(e.target.value)} style={{
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
                    {candidates.map((u) => (<div key={u.id} style={{
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
                            <img src={u.getAvatarURL?.(undefined, 32, false)} width={32} height={32} style={{ borderRadius: "50%" }}/>
                            <div style={{
                flex: 1,
                color: "var(--text-normal)",
                fontWeight: 500,
                fontSize: "14px"
            }}>{u.globalName || u.username}</div>
                            <Button size={Button.Sizes.SMALL} onClick={() => setWl(uniq([...wl, u.id]))} style={{
                background: "var(--brand-experiment)",
                color: "var(--white-500)"
            }}>Add</Button>
                        </div>))}
                    {candidates.length === 0 && (<div style={{
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
                    <Button onClick={save} style={{
            background: "var(--background-modifier-hover)",
            color: "var(--text-normal)",
            border: "1px solid var(--background-modifier-accent)"
        }}>Save</Button>
                    <Button color={Button.Colors.RED} onClick={startScrap} style={{
            background: "var(--button-danger-background)",
            color: "var(--white-500)"
        }}>Start</Button>
                </div>
            </ModalFooter>
        </ModalRoot>);
}
export default definePlugin({
    name: "FriendsRemover",
    description: "Adds a Scrap button to Friends > All to unfriend everyone except whitelisted.",
    tags: ["Friends", "Utility"],
    authors: [TestcordDevs.x2b],
    dependencies: ["HeaderBarAPI"],
    settings,
    chatBarButton: {
        icon: (() => (<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d="M12 12a5 5 0 1 0 0-10a5 5 0 0 0 0 10Zm0 2c-4.418 0-8 2.239-8 5v1h16v-1c0-2.761-3.582-5-8-5Z"/>
            </svg>)),
        render: (({ isMainChat }) => {
            if (!isMainChat || settings.store.location !== "chatbar")
                return null;
            return (<ChatBarButton tooltip="Friends Scrapper" onClick={() => openModal((props) => <WhitelistModal modalProps={props}/>)} onContextMenu={e => ContextMenuApi.openContextMenu(e, () => (<Menu.Menu navId="pc-friends-scrapper-menu" onClose={ContextMenuApi.closeContextMenu} aria-label="Friends Scrapper">
                                <Menu.MenuItem id="pc-friends-scrapper-open" label="Open Friends Scrapper" action={() => openModal((props) => <WhitelistModal modalProps={props}/>)}/>
                            </Menu.Menu>))}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                        <path fill="currentColor" d="M12 12a5 5 0 1 0 0-10a5 5 0 0 0 0 10Zm0 2c-4.418 0-8 2.239-8 5v1h16v-1c0-2.761-3.582-5-8-5Z"/>
                    </svg>
                </ChatBarButton>);
        }),
    },
    start() {
        const { location } = settings.store;
        if (location === "headerbar") {
            addHeaderBarButton("FriendsRemover", () => (<HeaderBarButton icon={() => (<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">
                            <path fill="currentColor" d="M12 12a5 5 0 1 0 0-10a5 5 0 0 0 0 10Zm0 2c-4.418 0-8 2.239-8 5v1h16v-1c0-2.761-3.582-5-8-5Z"/>
                        </svg>)} tooltip="Friends Scrapper" onClick={() => openModal((props) => <WhitelistModal modalProps={props}/>)}/>), 5);
        }
        else if (location === "channeltoolbar") {
            addChannelToolbarButton("FriendsRemover", () => (<ChannelToolbarButton icon={() => (<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">
                            <path fill="currentColor" d="M12 12a5 5 0 1 0 0-10a5 5 0 0 0 0 10Zm0 2c-4.418 0-8 2.239-8 5v1h16v-1c0-2.761-3.582-5-8-5Z"/>
                        </svg>)} tooltip="Friends Scrapper" onClick={() => openModal((props) => <WhitelistModal modalProps={props}/>)}/>), 5);
        }
    },
    stop() {
        removeHeaderBarButton("FriendsRemover");
        removeChannelToolbarButton("FriendsRemover");
    },
});
