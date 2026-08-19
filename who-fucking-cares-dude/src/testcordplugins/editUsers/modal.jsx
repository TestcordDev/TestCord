/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { classNameFactory } from "@api/Styles";
import { Flex } from "@components/Flex";
import { Margins } from "@utils/margins";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, openModal } from "@utils/modal";
import { Button, DisplayProfileUtils, showToast, Switch, TabBar, Text, TextInput, Toasts, UsernameUtils, useState } from "@webpack/common";
import { emptyOverride, hasFlag, settings } from "./data";
const cl = classNameFactory("vc-editUsers-");
const Sw = Switch;
function SettingsRow(props) {
    const { name, override, setOverride, overrideKey, placeholder, flagDisable, flagPrefer } = props;
    const namePlural = name + "s";
    const { flags } = override;
    const toggleFlag = (on, flag) => on
        ? flags | flag
        : flags & ~flag;
    return (<>
            <TextInput className={Margins.bottom16} value={override[overrideKey]} onChange={v => setOverride(o => ({ ...o, [overrideKey]: v }))} placeholder={placeholder} autoFocus/>
            <Sw value={hasFlag(flags, flagDisable)} onChange={v => setOverride(o => ({ ...o, flags: toggleFlag(v, flagDisable) }))} note={`Will use the user's global ${name} (or your EditUser configured ${name}) over server specific ${namePlural}`}>
                Disable server specific {namePlural}
            </Sw>
            <Sw value={hasFlag(flags, flagPrefer)} onChange={v => setOverride(o => ({ ...o, flags: toggleFlag(v, flagPrefer) }))} note={`Will use server specific ${namePlural} over the EditUser configured ${name}`} hideBorder>
                Prefer server specific {namePlural}
            </Sw>
        </>);
}
const Tabs = {
    username: {
        name: "Username",
        flagDisable: 2 /* OverrideFlags.DisableNicks */,
        flagPrefer: 1 /* OverrideFlags.PreferServerNicks */,
        placeholder: (user) => UsernameUtils.getName(user),
    },
    avatarUrl: {
        name: "Avatar",
        flagDisable: 8 /* OverrideFlags.DisableServerAvatars */,
        flagPrefer: 4 /* OverrideFlags.KeepServerAvatar */,
        placeholder: (user) => user.getAvatarURL(),
    },
    bannerUrl: {
        name: "Banner",
        flagDisable: 32 /* OverrideFlags.DisableServerBanners */,
        flagPrefer: 16 /* OverrideFlags.KeepServerBanner */,
        placeholder: (user) => DisplayProfileUtils.getDisplayProfile(user.id)?.getBannerURL({ canAnimate: true, size: 64 }) ?? "",
    },
};
const TabKeys = Object.keys(Tabs);
function EditTabs({ user, override, setOverride }) {
    const [currentTabName, setCurrentTabName] = useState(TabKeys[0]);
    const currentTab = Tabs[currentTabName];
    return (<>
            <TabBar type="top" look="brand" className={cl("tabBar")} selectedItem={currentTabName} onItemSelect={setCurrentTabName}>
                {TabKeys.map(key => (<TabBar.Item id={key} key={key} className={cl("tab")}>
                        {Tabs[key].name}
                    </TabBar.Item>))}
            </TabBar>

            <SettingsRow {...currentTab} override={override} overrideKey={currentTabName} setOverride={setOverride} placeholder={currentTab.placeholder(user)}/>
        </>);
}
function EditModal({ user, modalProps }) {
    const [override, setOverride] = useState(() => ({ ...settings.store.users?.[user.id] ?? emptyOverride }));
    return (<ModalRoot {...modalProps} size={"medium" /* ModalSize.MEDIUM */}>
            <ModalHeader>
                <Text variant="heading-lg/semibold" style={{ flexGrow: 1 }}>Edit User {user.username}</Text>
                <ModalCloseButton onClick={modalProps.onClose}/>
            </ModalHeader>

            <ModalContent>
                <div className={cl("modal")}>
                    <EditTabs user={user} override={override} setOverride={setOverride}/>
                </div>
            </ModalContent>

            <ModalFooter>
                <Flex>
                    <Button color={Button.Colors.RED} onClick={() => setOverride({ ...emptyOverride })}>
                        Reset All
                    </Button>
                    <Button onClick={() => {
            const s = settings.store.users ??= {};
            s[user.id] = override;
            modalProps.onClose();
            showToast("Saved! Switch chats for changes to apply everywhere", Toasts.Type.SUCCESS, { position: Toasts.Position.BOTTOM });
        }}>
                        Save
                    </Button>
                </Flex>
            </ModalFooter>
        </ModalRoot>);
}
export function openUserEditModal(user) {
    openModal(props => <EditModal user={user} modalProps={props}/>);
}
