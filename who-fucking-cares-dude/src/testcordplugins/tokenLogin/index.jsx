/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import "./styles.css";
import { DataStore } from "@api/index";
import { Flex } from "@components/Flex";
import SettingsPlugin from "@plugins/_core/settings";
import { TestcordDevs } from "@utils/constants";
import * as Modal from "@utils/modal";
import definePlugin from "@utils/types";
import { Button, React, Text, TextInput } from "@webpack/common";
function KeyIcon({ height = 20, width = 20, className }) {
    return (<svg className={className} aria-hidden="true" role="img" xmlns="http://www.w3.org/2000/svg" width={width} height={height} fill="none" viewBox="0 0 24 24">
            <path fill="currentColor" fillRule="evenodd" d="M21.41 5.41A2 2 0 1 0 18.6 2.6l-7.75 7.74a.53.53 0 0 1-.58.11 6 6 0 1 0 3.3 3.28.51.51 0 0 1 .1-.55c.19-.19.5-.19.68 0l1.25 1.24a2 2 0 1 0 2.82-2.82l-1.23-1.24a.5.5 0 0 1 0-.7l.47-.47c.2-.2.5-.2.7 0l1.24 1.23A2 2 0 1 0 22.4 7.6l-1.23-1.24a.5.5 0 0 1 0-.7l.23-.24ZM10 16a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z" clipRule="evenodd"/>
        </svg>);
}
const loginWithToken = (token) => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const { contentWindow } = iframe;
    if (contentWindow) {
        const interval = setInterval(() => {
            contentWindow.localStorage.token = `"${token}"`;
        }, 50);
        setTimeout(() => {
            clearInterval(interval);
            location.reload();
        }, 2500);
    }
    else {
        console.error("Failed to access iframe contentWindow");
    }
};
class TokenLoginManager {
    accounts = {};
    async init() {
        const stored = await DataStore.get("tokenLoginManager.data");
        if (stored) {
            this.accounts = stored;
        }
    }
    async save() {
        await DataStore.set("tokenLoginManager.data", this.accounts);
    }
    addAccount(account) {
        const id = crypto.randomUUID();
        this.accounts[id] = { ...account, id };
        this.save();
    }
    deleteAccount(id) {
        delete this.accounts[id];
        this.save();
    }
}
const AddAccountModal = ({ manager, onClose, ...props }) => {
    const [username, setUsername] = React.useState("");
    const [token, setToken] = React.useState("");
    return (<Modal.ModalRoot {...props}>
            <Modal.ModalHeader separator={false}>
                <Text variant="heading-lg/semibold">Add Account</Text>
            </Modal.ModalHeader>
            <Modal.ModalContent className="token-login-modal-content">
                <div className="token-login-section">
                    <Text variant="heading-sm/medium" style={{ marginBottom: "8px" }}>Username</Text>
                    <TextInput placeholder="Username" value={username} onChange={e => setUsername(e)}/>
                </div>
                <div className="token-login-section">
                    <Text variant="heading-sm/medium" style={{ marginBottom: "8px" }}>Token</Text>
                    <TextInput placeholder="User Token" value={token} onChange={e => setToken(e)}/>
                </div>
            </Modal.ModalContent>
            <Modal.ModalFooter className="token-login-footer">
                <Flex style={{ justifyContent: "flex-end", gap: "10px" }}>
                    <Button color={Button.Colors.BRAND} disabled={!username || !token} onClick={() => {
            manager.addAccount({ username, token });
            onClose();
        }}>
                        Save
                    </Button>
                    <Button color={Button.Colors.TRANSPARENT} onClick={onClose}>
                        Cancel
                    </Button>
                </Flex>
            </Modal.ModalFooter>
        </Modal.ModalRoot>);
};
const AccountEntryComponent = ({ account, manager, onDelete }) => {
    const [showToken, setShowToken] = React.useState(false);
    return (<div className="account-entry" key={account.id}>
            <div>
                <Text variant="heading-sm/medium">{account.username}</Text>
                <Text className={showToken ? "" : "token-field"}>{showToken ? account.token : "••••••••••••••••"}</Text>
            </div>
            <div className="account-actions">
                <Button size={Button.Sizes.SMALL} onClick={() => setShowToken(!showToken)}>
                    {showToken ? "Hide Token" : "Show Token"}
                </Button>
                <Button size={Button.Sizes.SMALL} color={Button.Colors.BRAND} onClick={() => loginWithToken(account.token)}>
                    Login
                </Button>
                <Button size={Button.Sizes.SMALL} color={Button.Colors.RED} onClick={() => {
            manager.deleteAccount(account.id);
            onDelete();
        }}>
                    Delete
                </Button>
            </div>
        </div>);
};
class TokenLoginManagerUI {
    manager;
    forceUpdate;
    constructor(manager) {
        this.manager = manager;
        this.forceUpdate = () => { };
    }
    render = () => {
        const [, setUpdateKey] = React.useState({});
        this.forceUpdate = () => setUpdateKey({});
        return (<div className="token-login-container">
                <Flex style={{ justifyContent: "space-between", alignItems: "center" }}>
                    <Text variant="heading-lg/semibold">Token Login Manager</Text>
                    <Button onClick={() => {
                Modal.openModal((props) => (<AddAccountModal {...props} manager={this.manager} onClose={() => {
                        props.onClose();
                        this.forceUpdate();
                    }}/>));
            }}>
                        Add Account
                    </Button>
                </Flex>
                {Object.values(this.manager.accounts).map(account => (<AccountEntryComponent key={account.id} account={account} manager={this.manager} onDelete={this.forceUpdate}/>))}
            </div>);
    };
}
export default definePlugin({
    name: "TokenLoginManager",
    description: "Manage and login with user tokens",
    tags: ["Privacy", "Utility"],
    authors: [TestcordDevs.x2b, TestcordDevs.nnenaza],
    tokenLoginManager: null,
    ui: null,
    sectionFunc: null,
    async start() {
        this.tokenLoginManager = new TokenLoginManager();
        await this.tokenLoginManager.init();
        this.ui = new TokenLoginManagerUI(this.tokenLoginManager);
        const { customEntries, customSections } = SettingsPlugin;
        customEntries.push({
            key: "tokenLoginManager",
            title: "Token Login Manager",
            Component: () => this.ui.render(),
            Icon: KeyIcon
        });
        this.sectionFunc = () => ({
            section: "TokenLoginManager",
            label: "Token Login Manager",
            element: () => this.ui.render(),
            id: "TokenLoginManager"
        });
        customSections.push(this.sectionFunc);
    },
    stop() {
        const { customEntries, customSections } = SettingsPlugin;
        const entry = customEntries.findIndex(entry => entry.key === "tokenLoginManager");
        if (entry !== -1)
            customEntries.splice(entry, 1);
        if (this.sectionFunc) {
            const idx = customSections.indexOf(this.sectionFunc);
            if (idx !== -1)
                customSections.splice(idx, 1);
            this.sectionFunc = null;
        }
        this.tokenLoginManager = null;
        this.ui = null;
    }
});
