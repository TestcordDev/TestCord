/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { HeaderBarButton } from "@api/HeaderBar";
import definePlugin from "@utils/types";
import { openModal, React } from "@webpack/common";
import { TempMailModal } from "./components/TempMailModal";
function MailIcon(props) {
    return (<svg viewBox="0 0 24 24" width={20} height={20} fill="currentColor" {...props}>
            <path d="M20 4H4C2.9 4 2 4.9 2 6v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/>
        </svg>);
}
function TempMailButton() {
    return (<HeaderBarButton icon={MailIcon} tooltip="Temp Mail" onClick={() => openModal(props => <TempMailModal modalProps={props}/>)}/>);
}
export default definePlugin({
    name: "TempMail",
    description: "Disposable email addresses powered by mail.tm — create, receive and save emails inside Discord",
    tags: ["Utility", "Privacy"],
    authors: [{ name: "lastclipped", id: 0n }],
    dependencies: ["HeaderBarAPI"],
    headerBarButton: {
        icon: MailIcon,
        render: TempMailButton,
        priority: 100,
    },
});
