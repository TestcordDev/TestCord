/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { HeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { openModal, React } from "@webpack/common";

import { TempMailModal } from "./components/TempMailModal";
import { providers } from "./providers";

export const settings = definePluginSettings({
    defaultProvider: {
        type: OptionType.SELECT,
        description: "Default provider for new addresses.",
        options: providers.map(p => ({ label: `${p.name} — ${p.description}`, value: p.id, default: p.id === "mail.tm" })),
    },
    autoRefreshSeconds: {
        type: OptionType.SLIDER,
        description: "Auto-refresh inbox interval (seconds).",
        markers: [0, 10, 15, 30, 60],
        default: 15,
        stickToMarkers: false,
    },
    showHtmlPreview: {
        type: OptionType.BOOLEAN,
        description: "Render HTML preview for messages when available.",
        default: true,
    },
    confirmDelete: {
        type: OptionType.BOOLEAN,
        description: "Confirm before deleting accounts.",
        default: true,
    },
});

function MailIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 24 24" width={20} height={20} fill="currentColor" {...props}>
            <path d="M20 4H4C2.9 4 2 4.9 2 6v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z" />
        </svg>
    );
}

function TempMailButton() {
    return (
        <HeaderBarButton
            icon={MailIcon}
            tooltip="Temp Mail"
            onClick={() => openModal(props => <TempMailModal modalProps={props} />)}
        />
    );
}

export default definePlugin({
    id: "tempMail",
    name: "TempMail",
    description: "Disposable email inbox inside Discord — 5 providers (Mail.tm, Mail.gw, 1SecMail, Guerrilla Mail, TempMail.lol) with Testcord styled UI, search, and auto-refresh.",
    tags: ["Utility", "Privacy"],
    authors: [{ name: "lastclipped", id: 0n }],
    dependencies: ["HeaderBarAPI"],
    settings,

    toolboxActions: {
        "Open Temp Mail"() {
            openModal(props => <TempMailModal modalProps={props} />);
        }
    },

    headerBarButton: {
        icon: MailIcon,
        render: TempMailButton,
        priority: 100,
    },
});
