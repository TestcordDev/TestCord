/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Modal, openModal } from "@webpack/common";
import { getQuestifySettings } from "./access";
import { resetDangerousSettings } from "./dangerous";
import { promptToRestartIfDirty } from "./restartTracking";
const oneTimeNotices = [
    {
        id: "quest-ban-warning-2026-08-07",
        title: "Questify Notice",
        renderBody: () => <div className="questify-startup-notice-body">
            <p>
                Discord has implemented a Quest Ban system which will temporarily or permanently limit your access to completing Quests and claiming their rewards if you are found to be completing them through unofficial means. Modifying the completion of Quests is against their <a href="https://discord.com/safety/platform-manipulation-policy-explainer" target="_blank" rel="noreferrer">Terms of Service</a>.
            </p>
            <br />
            <p>
                The punishment appears limited to loss of access to Quests and their rewards, but Discord may escalate at any time.
            </p>
            <br />
            <p>
                Due to the various methods Discord uses to track users, there's no way to realistically evade detection. If you proceed, understand that Discord likely will detect it at some point.
            </p>
        </div>,
        condition: () => {
            const settings = getQuestifySettings();
            return settings.enabled && settings.allowChangingDangerousSettings;
        },
        autoAcknowledgeCondition: () => !getQuestifySettings().allowChangingDangerousSettings,
        actions: [
            {
                text: "Keep Using Dangerous Questify Settings",
                variant: "critical-primary",
            },
            {
                text: "Disable Dangerous Questify Settings",
                variant: "secondary",
                run: resetDangerousSettings,
                promptForRestart: true,
            },
        ],
    },
];
function acknowledgeNotice(id) {
    const settings = getQuestifySettings();
    settings.acknowledgedNotices = {
        ...settings.acknowledgedNotices,
        [id]: true,
    };
}
function runNoticeAction(notice, action, onClose) {
    acknowledgeNotice(notice.id);
    action.run?.();
    onClose();
    setTimeout(() => {
        if (!action.promptForRestart || !promptToRestartIfDirty({ onDecline: showPendingQuestifyNotice })) {
            showPendingQuestifyNotice();
        }
    }, 0);
}
function OneTimeNoticeModal({ notice, ...modalProps }) {
    return (<Modal {...modalProps} role="alertdialog" size="lg" title={notice.title} actions={notice.actions.map(action => ({
            text: action.text,
            variant: action.variant ?? "primary",
            onClick: () => runNoticeAction(notice, action, modalProps.onClose),
        }))}>
            {notice.renderBody()}
        </Modal>);
}
export function showPendingQuestifyNotice() {
    for (const notice of oneTimeNotices) {
        if (getQuestifySettings().acknowledgedNotices[notice.id]) {
            continue;
        }
        if (!notice.condition()) {
            if (notice.autoAcknowledgeCondition?.()) {
                acknowledgeNotice(notice.id);
            }
            continue;
        }
        openModal(modalProps => <OneTimeNoticeModal {...modalProps} notice={notice}/>);
        return;
    }
}
